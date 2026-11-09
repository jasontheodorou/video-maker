// The brief interpreter: plain-English brief -> a valid spec.json.
//
// 1. Understand: the model extracts facts (key messages, purpose, channel, audience, steps, any length asked for).
// 2. The engine picks short, medium or long from those facts (decideSize) and sets the word budget and beats.
// 3. Write: the model writes the title, beats, script, scene types, icons and photo choices for that size.
// 4. Check: the engine's own rules (Zod spec schema, word budget, estimated length, text fit with the real
//    fonts). Any problem is fed back to the model, up to two more times.
//
// The model only ever fills the JSON spec. It never writes HTML, CSS or animation.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { loadConfig, FORMAT_IDS, type FormatId } from "../config";
import { loadBrand, type LoadedBrand } from "../brand";
import { brandBriefing, validateSpec, KOKORO_VOICES } from "../api";
import { decideSize, makeDecision, SizeError } from "../size";
import { captionFitter } from "../captionfit";
import { speakable } from "../text";
import { computeTimeline, TimingError } from "../timing";
import { textFitCheck } from "../lint";
import { retainBrowser, releaseBrowser } from "../browser";
import { PURPOSES, CHANNELS, type Facts } from "../schema";
import { listMedia } from "../media";
import type { Spec } from "../spec";
import { callModel, InterpreterError, type ModelResult } from "./backends";
import { interpreterSettings, type InterpreterSettings } from "./settings";
import { chooseIcon, iconHints } from "./icons";
import {
  UNDERSTAND_SCHEMA,
  understandSystem,
  understandPrompt,
  writeSchema,
  writeSystem,
  writePrompt,
  retryPrompt,
  type Understanding,
  type WritePlan,
  type MediaItem,
} from "./prompt";

export { interpreterSettings, InterpreterError, type InterpreterSettings, type MediaItem, type Understanding };

export interface InterpretProgress {
  stage: "understand" | "write" | "check";
  status: "start" | "done" | "retry";
  message: string;
  attempt?: number;
}

export interface InterpretInput {
  brief: string;
  /** Brand id (a folder in brands/). */
  brand: string;
  formats?: FormatId[];
  /** Kokoro voice id. Left out of the spec when it is the brand's own voice. */
  voice?: string;
  /** Photos and clips uploaded with the brief, named as they are in the job's media folder. */
  media?: MediaItem[];
  settings?: Partial<InterpreterSettings>;
  signal?: AbortSignal;
  onProgress?: (e: InterpretProgress) => void;
  /** Check text fit with the real fonts before returning. Default true. */
  checkFit?: boolean;
  /** Where the fit check writes its pages. Default: a temporary folder. */
  workDir?: string;
}

export interface InterpretResult {
  spec: Spec;
  understanding: Understanding;
  facts: Facts;
  size: { size: string; rule: string; reasons: string[] };
  /** Number of write attempts used (1 to 3). */
  attempts: number;
  /** Things the person should know: icons swapped, details the brief did not give. */
  notes: string[];
  /** Problems still present on the last attempt that are warnings only. */
  warnings: string[];
  /** The problems found on each attempt that failed, fed back to the model. */
  retries: Array<{ attempt: number; problems: string[] }>;
  backend: string;
  model: string;
  seconds: number;
}

const UnderstandingSchema = z.object({
  usable: z.boolean(),
  unusableReason: z.string().max(400),
  specific: z.boolean(),
  questions: z.array(z.string().max(300)).max(6),
  title: z.string().min(1).max(160),
  summary: z.string().max(400),
  keyMessages: z.array(z.string()).min(1).max(8),
  purpose: z.enum(PURPOSES),
  channel: z.enum(CHANNELS),
  audience: z.string().max(400),
  steps: z.number().int().min(0).max(12),
  requestedLength: z.enum(["none", "short", "medium", "long"]),
  requestedSeconds: z.number().int().min(0).max(600),
  requestedSecondsIsLimit: z.boolean(),
  action: z.string().max(400),
  mustKeep: z.array(z.string()),
  missing: z.array(z.string()),
});

export class InterpretError extends Error {
  /** False when trying the same brief again cannot help: the brief itself must change. */
  retryable = true;
  constructor(
    message: string,
    readonly problems: string[] = [],
    readonly lastSpec?: unknown,
  ) {
    super(message);
  }
}

/** An error that only a changed brief can fix (nonsense, too short, too long, too vague). */
function briefError(message: string, problems: string[] = []): InterpretError {
  const e = new InterpretError(message, problems);
  e.retryable = false;
  return e;
}

/**
 * Speech estimate before any audio exists, measured from 275 Kokoro phrases (bf_emma, 6 November 2026):
 * a phrase lasts about 0.29 s for each spoken word (after dates, numbers and web addresses are expanded
 * for speech) plus 0.15 s. These values are a little slower than measured (0.30 and 0.25), so the length
 * check errs on the long side and a script that passes here does not fail the timing step later.
 */
const SECONDS_PER_SPOKEN_WORD = 0.3;
const SECONDS_PER_PHRASE = 0.25;

/** Seconds of video that one written word adds, on average (speech, phrase gaps), and the fixed cost per scene. */
const SECONDS_PER_WRITTEN_WORD = 0.355;
const SECONDS_PER_SCENE = 1.0;
const SECONDS_FIXED = 1.3;

/** How far the estimate may be from a requested length before the writer is asked to adjust. */
const REQUESTED_TOLERANCE = 0.12;

function factsFrom(u: Understanding): Facts {
  // A limit ("under 20 seconds") is aimed a little under; "about 90 seconds" is aimed at 90.
  const seconds = u.requestedSeconds > 0 ? (u.requestedSecondsIsLimit ? Math.max(5, Math.round(u.requestedSeconds * 0.9)) : u.requestedSeconds) : 0;
  return {
    keyMessages: Math.min(8, Math.max(1, u.keyMessages.length)),
    purpose: u.purpose,
    channel: u.channel,
    ...(u.steps > 0 ? { steps: u.steps } : {}),
    ...(u.audience.trim() ? { audience: u.audience.trim().slice(0, 200) } : {}),
    ...(u.requestedLength !== "none" ? { requestedSize: u.requestedLength } : {}),
    ...(seconds >= 5 ? { requestedSeconds: Math.min(600, seconds) } : {}),
  };
}

function planFor(facts: Facts, u?: Understanding): WritePlan {
  const cfg = loadConfig();
  const d = decideSize(facts);
  const t = cfg.sizes[d.size];
  const wps = cfg.voice.wordsPerSecond;
  const budget = Math.floor(t.maxSeconds * wps * cfg.voice.budgetFactor);
  // Aim for the middle of the range: holds and reading time add a few seconds to the speech.
  let target = Math.min(budget, Math.round(((t.minSeconds + t.maxSeconds) / 2) * wps * 0.72));
  const asked = facts.requestedSeconds;
  if (asked) {
    // Words for the length asked for, kept inside the size's range and a little under the hard word budget.
    const aim = Math.min(Math.max(asked, t.minSeconds), t.maxSeconds);
    const words = (aim - t.beats.length * SECONDS_PER_SCENE - SECONDS_FIXED) / SECONDS_PER_WRITTEN_WORD;
    target = Math.max(10, Math.min(Math.round(budget * 0.95), Math.round(words)));
  }
  return {
    size: d.size,
    minSeconds: t.minSeconds,
    maxSeconds: t.maxSeconds,
    beats: t.beats,
    wordBudget: budget,
    wordTarget: target,
    reasons: d.reasons,
    ...(asked ? { requestedSeconds: u?.requestedSeconds || asked, requestedIsLimit: Boolean(u?.requestedSecondsIsLimit) } : {}),
  };
}

/** A web address as the end card's link slot shows it: a domain, then an optional path. */
const WEB_ADDRESS = /^(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/\S*)?$/i;
/** A Stat source that is really an action ("Book your free check"). */
const ACTION_START = /^(book|apply|call|visit|find|go|check|sign|register|contact|email|text|search|download|join|renew|order|report|ask|see|read|watch|get|pay)\b/i;

/**
 * The slot each scene type's emphasis must come from (see checkEmphasis in engine/scenes/*.ts). An emphasis
 * phrase not in that slot (often the web address on an end card) is dropped here rather than costing a retry.
 * A type not listed keeps every phrase found in any of its text slots.
 */
const EMPHASIS_SLOT: Record<string, string> = {
  title: "title",
  statement: "text",
  points: "heading",
  quote: "quote",
  photo: "text",
  "photo-text": "heading",
  icons: "heading",
  video: "text",
  end: "action",
};

/** Notes about uploaded photos being "missing" are wrong when photos were uploaded. */
const MEDIA_WORDS = /\b(photo|photos|picture|pictures|image|images|attach|attached|attachment|upload|uploaded|clip|clips|footage)\b/i;

/** Slots that hold an icon reference, in any scene type. */
function iconSlots(slots: Record<string, unknown>): string[] {
  return Object.keys(slots).filter((k) => {
    const v = slots[k];
    return v && typeof v === "object" && !Array.isArray(v) && typeof (v as { icon?: unknown }).icon === "string";
  });
}

function textOf(slots: Record<string, unknown>): string {
  return Object.values(slots)
    .filter((v): v is string => typeof v === "string")
    .join(" ");
}

/** Fix what can be fixed without the model: trim text, resolve icons by meaning, drop empty optional bits. */
async function tidy(raw: unknown, brand: LoadedBrand, notes: string[]): Promise<unknown> {
  if (!raw || typeof raw !== "object") return raw;
  const out = JSON.parse(JSON.stringify(raw)) as { title?: unknown; scenes?: Array<Record<string, unknown>> };
  if (!Array.isArray(out.scenes)) return out;
  for (const scene of out.scenes) {
    const slots = scene.slots as Record<string, unknown> | undefined;
    if (!slots || typeof slots !== "object") continue;
    for (const [k, v] of Object.entries(slots)) {
      if (typeof v === "string") {
        const t = v.replace(/\s+/g, " ").trim();
        if (!t) delete slots[k];
        else slots[k] = t;
      }
      if (Array.isArray(v) && k === "emphasis" && v.length === 0) delete slots[k];
    }
    // Slots used for the wrong job. The end card shows link as a web address, so anything else moves to the
    // detail line (or is dropped when that is taken). A Stat source that is an action is dropped: the action
    // belongs on the end card.
    if (scene.type === "end" && typeof slots.link === "string" && !WEB_ADDRESS.test(slots.link)) {
      const link = slots.link;
      delete slots.link;
      if (typeof slots.detail !== "string" && link.length <= 52) slots.detail = link;
      notes.push(`"${link}" is not a web address, so the end card shows it as a detail line instead of a link.`);
    }
    if (scene.type === "stat" && typeof slots.source === "string" && ACTION_START.test(slots.source)) delete slots.source;
    if (Array.isArray(slots.emphasis)) {
      const key = EMPHASIS_SLOT[String(scene.type)];
      const text = key ? (typeof slots[key] === "string" ? (slots[key] as string) : "") : textOf(slots);
      const kept = (slots.emphasis as unknown[]).filter((e) => typeof e === "string" && e.trim() && text.includes(e));
      if (kept.length) slots.emphasis = kept;
      else delete slots.emphasis;
    }
    for (const k of iconSlots(slots)) {
      const ref = slots[k] as { icon: string; weight?: string };
      const choice = await chooseIcon(ref.icon, textOf(slots), brand);
      if (choice.note) notes.push(choice.note);
      if (choice.name) slots[k] = { icon: choice.name, ...(ref.weight ? { weight: ref.weight } : {}) };
      else delete slots[k];
    }
    if (Array.isArray(scene.voiceover)) {
      scene.voiceover = (scene.voiceover as unknown[]).map((p) => (typeof p === "string" ? p.replace(/\s+/g, " ").trim() : p)).filter((p) => p !== "");
    }
    if (scene.id === "" || scene.id == null) delete scene.id;
  }
  return out;
}

/** Estimated timeline before any audio exists: speech at the configured rate, the real reading-time rule. */
function estimateLength(spec: Spec, brand: LoadedBrand, formats: FormatId[]): { problem?: string; timeline?: ReturnType<typeof computeTimeline> } {
  const decision = makeDecision(spec);
  const speed = brand.brand.voice.speed || 1;
  const phrases = spec.scenes.map((s) =>
    s.voiceover.map((text) => {
      const ws = text.split(/\s+/).filter(Boolean);
      const spoken = speakable(text).split(/\s+/).filter(Boolean).length;
      const audioSeconds = (spoken * SECONDS_PER_SPOKEN_WORD) / speed + SECONDS_PER_PHRASE;
      const step = (audioSeconds - SECONDS_PER_PHRASE) / Math.max(1, ws.length);
      return { text, file: "", audioSeconds, words: ws.map((w, i) => ({ text: w, start: 0.1 + i * step, end: 0.1 + (i + 0.9) * step, matched: true })) };
    }),
  );
  try {
    return {
      timeline: computeTimeline(spec, phrases, decision, { id: "estimate", speed, file: "", sampleRate: 24000 }, { captionFits: captionFitter(brand, formats) }),
    };
  } catch (e) {
    if (e instanceof TimingError) return { problem: `${e.message} (This is an estimate from the word count.)` };
    throw e;
  }
}

/**
 * Check a candidate spec. `problems` break the engine's rules and must be fixed. `soft` problems (length far
 * from what the brief asked for) are sent back to the writer too, but a script with only soft problems can
 * still be used.
 */
async function check(
  candidate: unknown,
  brand: LoadedBrand,
  formats: FormatId[],
  opts: { checkFit: boolean; workDir: string; plan: WritePlan },
): Promise<{ spec?: Spec; problems: string[]; soft: string[]; softNotes: string[]; seconds?: number }> {
  const v = validateSpec(candidate);
  if (!v.ok) return { problems: v.issues.map((i) => (i.path ? `${i.path}: ${i.message}` : i.message)), soft: [], softNotes: [] };
  const spec = v.spec;
  const problems: string[] = [];
  const soft: string[] = [];
  /** What the person is told if a soft problem is still there at the end. */
  const softNotes: string[] = [];
  let wordCount = 0;
  try {
    wordCount = makeDecision(spec).wordCount;
  } catch (e) {
    if (e instanceof SizeError) problems.push(e.message);
    else throw e;
  }
  if (problems.length) return { spec, problems, soft, softNotes };
  const est = estimateLength(spec, brand, formats);
  if (est.problem) problems.push(est.problem);
  const seconds = est.timeline?.duration;
  const asked = opts.plan.requestedSeconds;
  if (asked && seconds != null) {
    const p = opts.plan;
    const aim = Math.min(Math.max(p.requestedIsLimit ? asked * 0.9 : asked, p.minSeconds), p.maxSeconds);
    const words = (d: number) => Math.max(5, Math.round(Math.abs(d) / SECONDS_PER_WRITTEN_WORD / 5) * 5);
    const over = p.requestedIsLimit ? seconds > asked : seconds > aim * (1 + REQUESTED_TOLERANCE);
    if (over) {
      soft.push(
        `The video would last about ${Math.round(seconds)} seconds, but the brief asks for ${p.requestedIsLimit ? "at most" : "about"} ${asked} seconds. Cut about ${words(seconds - aim)} words of voiceover.`,
      );
      softNotes.push(`The video is about ${Math.round(seconds)} seconds long, a little over the ${asked} seconds asked for. Shorten the script if the length matters.`);
    }
    else if (seconds < aim * (1 - REQUESTED_TOLERANCE) && wordCount < p.wordBudget - 10) {
      const add = Math.min(words(aim - seconds), p.wordBudget - 5 - wordCount);
      if (add >= 5) {
        soft.push(
          `The video would last about ${Math.round(seconds)} seconds, but the brief asks for about ${asked} seconds. Add about ${add} words of voiceover, using details the brief gives (one more scene if needed). Never add filler or claims the brief does not make. If the brief has nothing more to say, keep the script as it is.`,
        );
        softNotes.push(
          `The video is about ${Math.round(seconds)} seconds long, shorter than the ${asked} seconds asked for, because the brief does not have more to say. For a longer video, add more detail to the brief. The engine does not pad videos with filler.`,
        );
      }
    }
  }
  if (opts.checkFit) {
    const findings = await textFitCheck(spec, brand, est.timeline ?? null, formats, opts.workDir);
    const seen = new Set<string>();
    for (const f of findings) {
      if (f.level !== "error") continue;
      if (f.check === "fonts" || f.check === "images") continue; // brand problems, not the script's
      const where = f.scene ? `scene ${f.scene}` : "captions";
      const key = `${where}|${f.slot ?? ""}|${f.check}`;
      if (seen.has(key)) continue;
      seen.add(key);
      problems.push(`${where}: ${f.message}`);
    }
  }
  return { spec, problems, soft, softNotes, seconds };
}

/** Turn a plain-English brief into a checked spec. Throws InterpretError with plain-English problems if it cannot. */
export async function interpretBrief(input: InterpretInput): Promise<InterpretResult> {
  const started = Date.now();
  const settings = interpreterSettings(input.settings);
  const progress = input.onProgress ?? (() => {});
  const brief = input.brief.trim();
  if (brief.length < 10) throw briefError("The brief is too short. Say what the video is about, who it is for and what they should do.");
  if (brief.length > 20000) throw briefError("The brief is too long. Keep it under 20,000 characters.");
  const brand = loadBrand(input.brand);
  const briefing = brandBriefing(input.brand);
  const formats = input.formats?.length ? input.formats : [...FORMAT_IDS];
  const voice = input.voice && input.voice !== brand.brand.voice.id ? input.voice : undefined;
  if (voice && !KOKORO_VOICES.some((v) => v.id === voice)) throw new InterpretError(`Unknown voice "${voice}".`);
  const notes: string[] = [];
  let backend = settings.backend;
  let model = settings.model;
  const call = async (system: string, prompt: string, schema: unknown): Promise<ModelResult> => {
    if (input.signal?.aborted) throw new InterpreterError("Stopped.");
    const r = await callModel({ system, prompt, schema, signal: input.signal }, settings);
    backend = r.backend;
    model = r.model;
    return r;
  };

  // 1. Understand.
  progress({ stage: "understand", status: "start", message: "Reading the brief" });
  let understanding: Understanding | null = null;
  const media = input.media ?? [];
  let uPrompt = understandPrompt(brief, briefing, media);
  for (let attempt = 1; attempt <= 2 && !understanding; attempt++) {
    const r = await call(understandSystem(), uPrompt, UNDERSTAND_SCHEMA);
    const parsed = UnderstandingSchema.safeParse(r.data);
    if (parsed.success) understanding = parsed.data;
    else uPrompt = understandPrompt(brief, briefing, media) + "\n\n" + retryPrompt(r.data, parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
  }
  if (!understanding) throw new InterpretError("Could not read the facts from the brief. Try rewording it.");
  // Stop before writing a script when there is nothing real to make a video about. A filler video made from
  // nonsense would waste minutes of rendering and could mislead the public.
  if (!understanding.usable)
    throw briefError(
      `We could not tell what this video should be about.${understanding.unusableReason ? ` ${understanding.unusableReason.trim().replace(/\.?$/, ".")}` : ""} Describe what is happening, who it is for and what they should do, then press Make video again. For example: "From 3 March we will collect garden waste every two weeks. Tell residents with a brown bin to check their new day at northvale.example/bins."`,
    );
  // Stop too when the brief names a topic but not what is happening: the script could only be filler, with a
  // made-up call to action, and it would still take minutes to render.
  if (!understanding.specific) {
    const questions = understanding.questions.map((q) => q.trim()).filter(Boolean);
    const ask = questions.length ? questions : ["What exactly is new or changing?", "When does it start?", "What should people do, and where can they find out more?"];
    throw briefError(
      "The brief does not say enough to make a useful video. It names a topic, but not what is happening. Add the details below to the brief, then press Make video again.",
      ask,
    );
  }
  for (const m of understanding.missing) {
    if (media.length && MEDIA_WORDS.test(m)) continue; // the uploaded photos and clips are there
    notes.push(`The brief does not say: ${m}`);
  }
  const facts = factsFrom(understanding);
  const plan = planFor(facts, understanding);
  progress({
    stage: "understand",
    status: "done",
    message: `${understanding.keyMessages.length} key message${understanding.keyMessages.length === 1 ? "" : "s"}, ${understanding.purpose}, for ${understanding.channel}. Size: ${plan.size}${plan.requestedSeconds ? `, aiming for ${plan.requestedIsLimit ? "under" : "about"} ${plan.requestedSeconds} seconds` : ""}.`,
  });

  // 2. Write, check and retry.
  const mediaSlots = /"(photo|image|media|clip|video)"/i.test(JSON.stringify(writeSchema()));
  if (media.length && !mediaSlots) notes.push("Photos and clips are saved with the job, but no scene type can show them yet.");
  let library: Array<{ src: string; kind: "photo" | "clip"; description?: string }> = [];
  try {
    library = listMedia(brand)
      .filter((m) => !m.src.startsWith("uploads/"))
      .map((m) => ({ src: m.src, kind: m.kind, description: m.info?.description }));
  } catch {
    /* no media library */
  }
  const basePrompt = writePrompt({ brief, brandBriefing: briefing, understanding, plan, icons: iconHints(brand), media, library, mediaSlots });
  const workDir = input.workDir ?? fs.mkdtempSync(path.join(os.tmpdir(), "interpret-"));
  const checkFit = input.checkFit !== false;
  let prompt = basePrompt;
  let last: unknown;
  let problems: string[] = [];
  // The best script so far that breaks no rule (it may still be off the requested length).
  let usable: { spec: Spec; soft: string[]; softNotes: string[]; attempt: number; notes: string[] } | null = null;
  const retries: Array<{ attempt: number; problems: string[] }> = [];
  const maxAttempts = 1 + settings.retries;
  if (checkFit) retainBrowser();
  try {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      progress({ stage: "write", status: attempt === 1 ? "start" : "retry", message: attempt === 1 ? "Writing the script" : `Fixing the script (attempt ${attempt} of ${maxAttempts})`, attempt });
      const r = await call(writeSystem(), prompt, writeSchema());
      const attemptNotes: string[] = [];
      const written = (await tidy(r.data, brand, attemptNotes)) as Record<string, unknown>;
      last = {
        version: 1,
        brand: input.brand,
        title: written?.title,
        ...(voice ? { voice } : {}),
        ...(input.formats?.length ? { formats: input.formats } : {}),
        facts,
        scenes: written?.scenes,
      };
      progress({ stage: "check", status: "start", message: "Checking the script against the rules", attempt });
      const res = await check(last, brand, formats, { checkFit, workDir, plan });
      problems = res.problems;
      const done = (spec: Spec, soft: string[], softNotes: string[], at: number, extraNotes: string[]): InterpretResult => {
        notes.push(...extraNotes, ...softNotes);
        return {
          spec,
          understanding: understanding!,
          facts,
          size: { size: plan.size, rule: decideSize(facts).rule, reasons: plan.reasons },
          attempts: at,
          notes: [...new Set(notes)],
          warnings: soft,
          retries,
          backend,
          model,
          seconds: (Date.now() - started) / 1000,
        };
      };
      if (!problems.length && res.spec) {
        if (!res.soft.length || attempt === maxAttempts) {
          progress({ stage: "check", status: "done", message: "The script passes every check", attempt });
          return done(res.spec, res.soft, res.softNotes, attempt, attemptNotes);
        }
        usable = { spec: res.spec, soft: res.soft, softNotes: res.softNotes, attempt, notes: attemptNotes };
      }
      const feedback = [...problems, ...res.soft];
      retries.push({ attempt, problems: feedback });
      if (attempt === maxAttempts && usable) {
        progress({ stage: "check", status: "done", message: "The script passes every check", attempt: usable.attempt });
        return done(usable.spec, usable.soft, usable.softNotes, usable.attempt, usable.notes);
      }
      prompt = basePrompt + "\n\n" + retryPrompt(written, feedback);
    }
  } finally {
    if (checkFit) await releaseBrowser();
    if (!input.workDir) fs.rmSync(workDir, { recursive: true, force: true });
  }
  throw new InterpretError(`The script still broke the rules after ${maxAttempts} attempts:\n${problems.map((p) => `- ${p}`).join("\n")}`, problems, last);
}
