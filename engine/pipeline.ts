// The pipeline: size, voice, align, timing, compile, lint, sheet, render.
// Each step reads and writes files in the job folder, so any step can be re-run on its own.
import fs from "node:fs";
import path from "node:path";
import { jobPaths, JOBS_DIR, type JobPaths } from "./paths";
import { loadConfig, type FormatId, FORMAT_IDS } from "./config";
import { readSpec, parseSpec, sceneId, specFormats, type Spec } from "./spec";
import { loadBrand, assertBrandOk, type LoadedBrand } from "./brand";
import { makeDecision, SizeError } from "./size";
import { synthesise, voiceLang } from "./voice";
import { alignPhrase } from "./align";
import { computeTimeline, type PhraseInput } from "./timing";
import { mixTrack, writeWav } from "./wav";
import { toSrt } from "./captions";
import { captionFitter } from "./captionfit";
import { compileVideo, writePage } from "./compile";
import { hyperframesLint, textFitCheck, timingCheck, writeLintReport, type LintFinding } from "./lint";
import { makeContactSheet, type SheetResult } from "./sheet";
import { renderBuild, probe } from "./render";
import { retainBrowser, releaseBrowser } from "./browser";
import { pool } from "./proc";
import { DecisionSchema, TimelineSchema, type Decision, type Timeline } from "./schema";

export const STEPS = ["size", "voice", "align", "timing", "compile", "lint", "sheet", "render"] as const;
export type StepName = (typeof STEPS)[number];

const WEIGHTS: Record<StepName, number> = { size: 0.01, voice: 0.1, align: 0.06, timing: 0.01, compile: 0.02, lint: 0.06, sheet: 0.04, render: 0.7 };

export interface ProgressEvent {
  step: StepName;
  status: "start" | "progress" | "done" | "error" | "skipped";
  message: string;
  /** Progress through the whole job, 0 to 1. */
  overall: number;
  /** Progress through this step, 0 to 1. */
  fraction?: number;
  format?: FormatId;
}
export type OnProgress = (e: ProgressEvent) => void;

export class PipelineError extends Error {
  constructor(readonly step: StepName, message: string, readonly findings?: LintFinding[]) {
    super(message);
  }
}

/** Thrown when a job's stop signal fires. Every step checks for it between its slow parts. */
export class StoppedError extends PipelineError {
  readonly stopped = true;
  constructor(step: StepName) {
    super(step, "Stopped.");
  }
}

/** Throw StoppedError if the job has been asked to stop. */
export function stopIfAsked(ctx: { signal?: AbortSignal }, step: StepName): void {
  if (ctx.signal?.aborted) throw new StoppedError(step);
}

function writeJson(file: string, data: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}
function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

/** Progress reporter that also keeps jobs/<name>/status.json up to date for the web server. */
export function reporter(job: JobPaths, steps: readonly StepName[], onProgress?: OnProgress) {
  const total = steps.reduce((t, s) => t + WEIGHTS[s], 0);
  const before = (s: StepName) => steps.slice(0, steps.indexOf(s)).reduce((t, x) => t + WEIGHTS[x], 0);
  const history: ProgressEvent[] = [];
  return (step: StepName, status: ProgressEvent["status"], message: string, fraction = status === "done" ? 1 : 0, format?: FormatId) => {
    const overall = Math.min(1, (before(step) + WEIGHTS[step] * fraction) / total);
    const e: ProgressEvent = { step, status, message, overall, fraction, format };
    if (status !== "progress") history.push(e);
    try {
      writeJson(job.status, { step, status, message, overall, format, updated: new Date().toISOString(), history });
    } catch {
      /* status is best effort */
    }
    onProgress?.(e);
  };
}
type Report = ReturnType<typeof reporter>;

// ---------- context ----------

export interface JobContext {
  job: JobPaths;
  spec: Spec;
  brand: LoadedBrand;
  formats: FormatId[];
  /** Fires when a person presses Stop. Steps check it between their slow parts. */
  signal?: AbortSignal;
}

export function openJob(jobDir: string): JobContext {
  const job = jobPaths(jobDir);
  if (!fs.existsSync(job.spec)) throw new Error(`No spec.json in ${job.dir}`);
  const spec = readSpec(job.spec);
  const brand = loadBrand(spec.brand);
  assertBrandOk(brand);
  return { job, spec, brand, formats: specFormats(spec) as FormatId[] };
}

// ---------- steps ----------

export function stepSize(ctx: JobContext, report?: Report): Decision {
  report?.("size", "start", "Choosing the length");
  try {
    const d = makeDecision(ctx.spec);
    writeJson(ctx.job.decision, d);
    report?.("size", "done", `Length chosen: ${d.size}, ${d.targetSeconds.min} to ${d.targetSeconds.max} seconds`);
    return d;
  } catch (e) {
    if (e instanceof SizeError) {
      const d = (e as SizeError & { decision?: Decision }).decision;
      if (d) writeJson(ctx.job.decision, { ...d, error: e.message });
      report?.("size", "error", e.message);
      throw new PipelineError("size", e.message);
    }
    throw e;
  }
}

interface PhraseManifestEntry {
  scene: string;
  index: number;
  text: string;
  file: string;
  seconds: number;
  sampleRate: number;
  voice: string;
}

/**
 * Check that every scene's text fits, with the real fonts, before the voice is recorded. Captions are checked
 * later, at lint, once their words are timed. This makes a script that does not fit fail in seconds.
 */
export async function stepPreflight(ctx: JobContext, report?: Report): Promise<void> {
  report?.("size", "progress", "Checking the text fits each format before recording the voice", 0.9);
  const findings = await textFitCheck(ctx.spec, ctx.brand, null, ctx.formats, path.join(ctx.job.review, "fit"), ctx.signal);
  stopIfAsked(ctx, "size");
  const errors = findings.filter((f) => f.level === "error");
  if (errors.length) {
    writeLintReport(path.join(ctx.job.review, "lint.json"), findings);
    const msg = errors.map((e) => `- ${e.message}`).join("\n");
    report?.("lint", "error", msg);
    throw new PipelineError("lint", `Some text does not fit:\n${msg}`, findings);
  }
}

export async function stepVoice(ctx: JobContext, report?: Report): Promise<PhraseManifestEntry[]> {
  const voice = ctx.spec.voice ?? ctx.brand.brand.voice.id;
  const speed = ctx.brand.brand.voice.speed;
  const lang = voiceLang(voice, ctx.brand.brand.voice.lang);
  const reqs = ctx.spec.scenes.flatMap((s, i) => s.voiceover.map((text, k) => ({ scene: sceneId(s, i), index: k, text, voice, speed, lang })));
  report?.("voice", "start", `Recording ${reqs.length} spoken line${reqs.length === 1 ? "" : "s"}`);
  let audio: Awaited<ReturnType<typeof synthesise>>;
  try {
    audio = await synthesise(
      reqs,
      (d, n, slow) => report?.("voice", "progress", `Recorded ${d} of ${n} spoken lines.${slow ? " This is taking longer than usual. The computer may be busy with other work." : ""}`, n ? d / n : 1),
      ctx.signal,
    );
  } catch (e) {
    stopIfAsked(ctx, "voice");
    throw e;
  }
  stopIfAsked(ctx, "voice");
  const dir = path.join(ctx.job.audio, "phrases");
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const manifest = audio.map((a, i) => {
    const r = reqs[i];
    const rel = path.join("audio", "phrases", `${r.scene}-${r.index + 1}.wav`);
    fs.copyFileSync(a.file, path.join(ctx.job.dir, rel));
    return { scene: r.scene, index: r.index, text: r.text, file: rel, seconds: a.seconds, sampleRate: a.sampleRate, voice };
  });
  writeJson(path.join(ctx.job.audio, "phrases.json"), manifest);
  const cached = audio.filter((a) => a.cached).length;
  report?.("voice", "done", `Voice ready: ${manifest.length} spoken line${manifest.length === 1 ? "" : "s"}${cached ? ` (${cached} reused from earlier)` : ""}`);
  return manifest;
}

interface AlignmentEntry extends PhraseManifestEntry {
  words: PhraseInput["words"];
  matchedShare: number;
  warning?: string;
}

export async function stepAlign(ctx: JobContext, report?: Report): Promise<AlignmentEntry[]> {
  const manifest = readJson<PhraseManifestEntry[]>(path.join(ctx.job.audio, "phrases.json"));
  report?.("align", "start", "Timing the captions word by word");
  let done = 0;
  const out = await pool(manifest, 2, async (m) => {
    stopIfAsked(ctx, "align");
    const a = await alignPhrase(m.text, path.join(ctx.job.dir, m.file), m.seconds);
    done++;
    report?.("align", "progress", `Timed ${done} of ${manifest.length} spoken lines`, done / manifest.length);
    return { ...m, words: a.words, matchedShare: a.matchedShare, warning: a.warning };
  });
  stopIfAsked(ctx, "align");
  writeJson(path.join(ctx.job.audio, "alignment.json"), out);
  const warnings = out.filter((o) => o.warning).map((o) => o.warning!);
  report?.("align", "done", warnings.length ? `Captions timed. ${warnings.join(" ")}` : "Captions timed");
  return out;
}

export function stepTiming(ctx: JobContext, report?: Report): Timeline {
  report?.("timing", "start", "Setting how long each scene lasts");
  const decision = DecisionSchema.parse(readJson(ctx.job.decision));
  const aligned = readJson<AlignmentEntry[]>(path.join(ctx.job.audio, "alignment.json"));
  const byScene = ctx.spec.scenes.map((s, i) =>
    aligned
      .filter((a) => a.scene === sceneId(s, i))
      .sort((a, b) => a.index - b.index)
      .map((a) => ({ text: a.text, file: a.file, audioSeconds: a.seconds, words: a.words })),
  );
  const sampleRate = aligned[0]?.sampleRate ?? 24000;
  const voiceRel = path.join("audio", "voice.wav");
  let timeline: Timeline;
  try {
    timeline = computeTimeline(
      ctx.spec,
      byScene,
      decision,
      { id: aligned[0]?.voice ?? "", speed: ctx.brand.brand.voice.speed, file: voiceRel, sampleRate },
      { captionFits: captionFitter(ctx.brand, specFormats(ctx.spec) as FormatId[]) },
    );
  } catch (e) {
    report?.("timing", "error", (e as Error).message);
    throw new PipelineError("timing", (e as Error).message);
  }
  const clips = timeline.scenes.flatMap((s) => s.phrases.map((p) => ({ file: path.join(ctx.job.dir, p.file), at: p.start })));
  writeWav(path.join(ctx.job.dir, voiceRel), sampleRate, mixTrack(timeline.duration, sampleRate, clips));
  writeJson(ctx.job.timeline, TimelineSchema.parse(timeline));
  fs.mkdirSync(ctx.job.out, { recursive: true });
  fs.writeFileSync(path.join(ctx.job.out, `${ctx.job.name}.srt`), toSrt(timeline.captions));
  report?.("timing", "done", `The video will be ${timeline.duration.toFixed(1)} seconds long`);
  return timeline;
}

export function loadTimeline(ctx: JobContext): Timeline {
  return TimelineSchema.parse(readJson(ctx.job.timeline));
}

export function stepCompile(ctx: JobContext, report?: Report): Record<FormatId, string> {
  report?.("compile", "start", "Laying out each scene");
  const timeline = loadTimeline(ctx);
  const dirs = {} as Record<FormatId, string>;
  const issues: string[] = [];
  for (const f of ctx.formats) {
    const page = compileVideo(ctx.spec, timeline, ctx.brand, f, { voiceFile: path.join(ctx.job.dir, timeline.voice.file) });
    for (const i of page.issues) if (i.level === "error") issues.push(`${f} ${i.scene ?? ""}: ${i.message}`);
    const dir = path.join(ctx.job.build, f);
    writePage(page, dir);
    dirs[f] = dir;
  }
  if (issues.length) {
    report?.("compile", "error", issues.join("\n"));
    throw new PipelineError("compile", `The compiler found problems:\n${issues.join("\n")}`);
  }
  report?.("compile", "done", "Scenes laid out");
  return dirs;
}

export async function stepLint(ctx: JobContext, report?: Report): Promise<LintFinding[]> {
  report?.("lint", "start", "Checking that all the text fits and is easy to read");
  const timeline = loadTimeline(ctx);
  const findings: LintFinding[] = [];
  let k = 0;
  for (const f of ctx.formats) {
    stopIfAsked(ctx, "lint");
    findings.push(...(await hyperframesLint(path.join(ctx.job.build, f), f)));
    report?.("lint", "progress", `Checked the ${FORMAT_WORDS[f]} layout`, (++k / (ctx.formats.length * 2)));
  }
  stopIfAsked(ctx, "lint");
  findings.push(...(await textFitCheck(ctx.spec, ctx.brand, timeline, ctx.formats, path.join(ctx.job.review, "fit"), ctx.signal)));
  stopIfAsked(ctx, "lint");
  findings.push(...timingCheck(timeline, loadConfig().captions.minSeconds));
  writeLintReport(path.join(ctx.job.review, "lint.json"), findings);
  const errors = findings.filter((x) => x.level === "error");
  if (errors.length) {
    const msg = errors.map((e) => `- [${e.check}${e.format ? " " + e.format : ""}${e.scene ? " " + e.scene : ""}] ${e.message}`).join("\n");
    report?.("lint", "error", msg);
    throw new PipelineError("lint", `Checks failed:\n${msg}`, findings);
  }
  const warnings = findings.filter((x) => x.level === "warning");
  report?.("lint", "done", warnings.length ? `Checks passed, with ${warnings.length} thing${warnings.length === 1 ? "" : "s"} to look at` : "All checks passed");
  return findings;
}

export async function stepSheet(ctx: JobContext, report?: Report): Promise<SheetResult> {
  report?.("sheet", "start", "Making the contact sheet");
  const timeline = loadTimeline(ctx);
  const dirs = Object.fromEntries(ctx.formats.map((f) => [f, path.join(ctx.job.build, f)])) as Record<FormatId, string>;
  const res = await makeContactSheet(ctx.spec, timeline, dirs, ctx.job.review, ctx.signal);
  stopIfAsked(ctx, "sheet");
  report?.("sheet", "done", "Contact sheet ready");
  return res;
}

export interface RenderedFile {
  format: FormatId;
  kind: "draft" | "final";
  file: string;
  seconds: number;
  probe: Awaited<ReturnType<typeof probe>>;
}

/** Plain names for the formats in progress messages. */
const FORMAT_WORDS: Record<string, string> = { "16x9": "landscape", "9x16": "portrait", "1x1": "square" };

export async function stepRender(ctx: JobContext, opts: { draft?: boolean; final?: boolean; softwareGpu?: boolean; signal?: AbortSignal }, report?: Report): Promise<RenderedFile[]> {
  const cfg = loadConfig();
  const kinds: Array<"draft" | "final"> = [];
  if (opts.draft) kinds.push("draft");
  if (opts.final !== false) kinds.push("final");
  const total = kinds.length * ctx.formats.length;
  report?.("render", "start", `Making ${total} video${total === 1 ? "" : "s"}`);
  let videoSeconds = 30;
  try {
    videoSeconds = loadTimeline(ctx).duration;
  } catch {
    /* only used to spot a slow render */
  }
  const out: RenderedFile[] = [];
  let n = 0;
  for (const kind of kinds) {
    for (const f of ctx.formats) {
      const file = kind === "final" ? path.join(ctx.job.out, `${ctx.job.name}-${f}.mp4`) : path.join(ctx.job.out, "draft", `${ctx.job.name}-${f}-draft.mp4`);
      const base = n;
      const name = kind === "final" ? `the ${FORMAT_WORDS[f]} video` : `a quick draft of the ${FORMAT_WORDS[f]} video`;
      // A render takes about as long as the video on this Mac (section 10 of CONTRACTS.md). Far longer than that
      // means the machine is busy, so the message says so rather than sitting on a still percentage.
      const expected = Math.max(20, videoSeconds) * (kind === "final" ? 1 : 0.5);
      const attempt = async (workers: string | number) => {
        let started = 0;
        let fraction = 0;
        const say = () => {
          const slow = started && (Date.now() - started) / 1000 > 3 * expected;
          report?.(
            "render",
            "progress",
            `Making ${name}: ${Math.round(fraction * 100)}%.${slow ? " This is taking longer than usual. The computer may be busy with other work." : ""}`,
            (base + fraction) / total,
            f,
          );
        };
        const timer = setInterval(() => started && say(), 10000);
        try {
          return await renderBuild(path.join(ctx.job.build, f), file, {
            fps: kind === "final" ? cfg.fps : cfg.draftFps,
            quality: kind === "final" ? cfg.render.finalQuality : cfg.render.draftQuality,
            workers,
            softwareGpu: opts.softwareGpu,
            signal: opts.signal,
            onWait: (w) =>
              report?.("render", "progress", `Waiting for another video to finish before making ${name} (${Math.round(w.seconds)} seconds so far). Videos are made one at a time so each is quick.`, base / total, f),
            onProgress: (p) => {
              if (!started) started = Date.now();
              fraction = p.fraction;
              say();
            },
          });
        } finally {
          clearInterval(timer);
        }
      };
      let r: Awaited<ReturnType<typeof renderBuild>>;
      try {
        r = await attempt(cfg.render.workers);
      } catch (e) {
        // A busy machine can make Chrome miss a frame capture (CAPTURE_PROTOCOL_TIMEOUT). Try once more with
        // one worker, which needs less memory. A stopped job is not retried.
        if (opts.signal?.aborted) throw new StoppedError("render");
        report?.("render", "progress", `Making ${name} again, more slowly, because the first try failed`, base / total, f);
        await new Promise((res) => setTimeout(res, 2000));
        try {
          r = await attempt(1);
        } catch (e2) {
          throw new PipelineError("render", `Could not make ${name}. The computer may be short of memory: close other apps and try again.\n${(e2 as Error).message}`);
        }
      }
      n++;
      const pr = await probe(file);
      out.push({ format: f, kind, file, seconds: r.seconds, probe: pr });
      report?.("render", "progress", `Finished ${name} in ${Math.round(r.seconds)} seconds`, n / total, f);
    }
  }
  writeJson(path.join(ctx.job.out, "renders.json"), out.map((o) => ({ ...o, file: path.relative(ctx.job.dir, o.file) })));
  report?.("render", "done", `Made ${out.length} video${out.length === 1 ? "" : "s"}`);
  return out;
}

// ---------- the whole thing ----------

export interface MakeOptions {
  /** Skip the text-fit check before the voice step (lint still checks everything). */
  skipPreflight?: boolean;
  /** Where the job lives when a spec object is passed. Default jobs/<slug of title>. */
  jobDir?: string;
  /** Brief text to save as brief.md when a spec object is passed. */
  brief?: string;
  /** Override the spec's formats. */
  formats?: FormatId[];
  /** Make quick drafts too (30 fps, draft quality) in out/draft/. */
  draft?: boolean;
  /** Make the final 1080p renders. Default true. */
  final?: boolean;
  /** Stop after this step (for example "sheet" to review before rendering). */
  until?: StepName;
  /** Start from this step, reusing files from earlier steps. */
  from?: StepName;
  softwareGpu?: boolean;
  signal?: AbortSignal;
}

export interface MakeResult {
  jobDir: string;
  decision: Decision;
  timeline: Timeline;
  lint: LintFinding[];
  sheet?: string;
  srt: string;
  outputs: RenderedFile[];
}

export function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "video";
}

/** Prepare a job folder from a spec object (validated) or return the given job folder. */
export function prepareJob(input: string | unknown, opts: Pick<MakeOptions, "jobDir" | "brief" | "formats"> = {}): string {
  if (typeof input === "string") return path.resolve(input);
  const spec = parseSpec(input);
  const dir = path.resolve(opts.jobDir ?? path.join(JOBS_DIR, slugify(spec.title)));
  const job = jobPaths(dir);
  fs.mkdirSync(job.dir, { recursive: true });
  for (const d of [job.audio, job.review, job.out]) fs.mkdirSync(d, { recursive: true });
  const toWrite = opts.formats ? { ...(input as object), formats: opts.formats } : input;
  writeJson(job.spec, toWrite);
  if (opts.brief != null) fs.writeFileSync(job.brief, opts.brief.endsWith("\n") ? opts.brief : opts.brief + "\n");
  return dir;
}

export async function makeVideo(input: string | unknown, options: MakeOptions = {}, onProgress?: OnProgress): Promise<MakeResult> {
  const dir = prepareJob(input, options);
  const ctx = openJob(dir);
  if (options.formats) ctx.formats = options.formats;
  ctx.signal = options.signal;
  for (const d of [ctx.job.audio, ctx.job.review, ctx.job.out]) fs.mkdirSync(d, { recursive: true });
  const fromIdx = options.from ? STEPS.indexOf(options.from) : 0;
  const untilIdx = options.until ? STEPS.indexOf(options.until) : STEPS.length - 1;
  const steps = STEPS.slice(fromIdx, untilIdx + 1);
  const report = reporter(ctx.job, steps, onProgress);
  const run = (s: StepName) => steps.includes(s);
  retainBrowser();
  try {
    const go = (s: StepName) => {
      if (!run(s)) return false;
      stopIfAsked(ctx, s);
      return true;
    };
    if (go("size")) stepSize(ctx, report);
    if (run("voice") && !options.skipPreflight) await stepPreflight(ctx, report);
    if (go("voice")) await stepVoice(ctx, report);
    if (go("align")) await stepAlign(ctx, report);
    if (go("timing")) stepTiming(ctx, report);
    if (go("compile")) stepCompile(ctx, report);
    let lint: LintFinding[] = [];
    if (go("lint")) lint = await stepLint(ctx, report);
    let sheet: string | undefined;
    if (go("sheet")) sheet = (await stepSheet(ctx, report)).sheet;
    let outputs: RenderedFile[] = [];
    if (go("render")) outputs = await stepRender(ctx, { draft: options.draft, final: options.final, softwareGpu: options.softwareGpu, signal: options.signal }, report);
    return {
      jobDir: dir,
      decision: DecisionSchema.parse(readJson(ctx.job.decision)),
      timeline: loadTimeline(ctx),
      lint,
      sheet,
      srt: path.join(ctx.job.out, `${ctx.job.name}.srt`),
      outputs,
    };
  } catch (e) {
    if (options.signal?.aborted && !(e instanceof StoppedError)) {
      // A step killed by the signal fails with its own error; report it as a stop.
      const stopped = new StoppedError(e instanceof PipelineError ? e.step : steps[0]);
      report(stopped.step, "error", stopped.message);
      throw stopped;
    }
    if (e instanceof StoppedError) report(e.step, "error", e.message);
    else if (!(e instanceof PipelineError)) {
      const step = steps.find((s) => {
        try {
          const st = readJson<{ step: StepName; status: string }>(ctx.job.status);
          return st.step === s;
        } catch {
          return false;
        }
      }) ?? steps[0];
      report(step, "error", (e as Error).message);
    }
    throw e;
  } finally {
    await releaseBrowser();
  }
}

export { FORMAT_IDS };
