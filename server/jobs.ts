// Jobs for the web app: a folder per video in jobs/, a job.json the app keeps, and a queue that runs
// one job at a time (understand the brief, write the script, then the engine's pipeline).
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { JOBS_DIR } from "../engine/paths";
import { makeVideo, validateSpec, loadBrand, PipelineError, FORMAT_IDS, type FormatId, type ProgressEvent } from "../engine";
import { makeDecision, SizeError } from "../engine/size";
import { readSpec, sceneId } from "../engine/spec";
import { textFitCheck } from "../engine/lint";
import { interpretBrief, InterpretError, type MediaItem } from "../engine/interpret";
import { HttpError } from "./http";

export type Stage = "understand" | "write" | "voice" | "layout" | "render";
export const STAGES: Array<{ id: Stage; label: string }> = [
  { id: "understand", label: "Understanding brief" },
  { id: "write", label: "Writing script" },
  { id: "voice", label: "Recording voice" },
  { id: "layout", label: "Checking layout" },
  { id: "render", label: "Making the videos" },
];

export interface JobRecord {
  id: string;
  title: string;
  brief: string;
  brand: string;
  voice?: string;
  formats: FormatId[];
  createdAt: string;
  updatedAt: string;
  state: "queued" | "running" | "done" | "error" | "stopped";
  /** Stop has been pressed; the job stops at its next safe point (a few seconds at most). */
  stopping?: boolean;
  mode: "full" | "rerender";
  stage: Stage | null;
  stagesDone: Stage[];
  progress: number;
  message: string;
  error?: { stage: Stage | null; message: string; problems?: string[]; retryable?: boolean };
  notes: string[];
  interpret?: { backend: string; model: string; attempts: number; seconds: number; size: string; keyMessages: string[] };
  media: MediaItem[];
  /** The app made this job. Jobs made from the command line are shown but have no record of their own. */
  fromApp: boolean;
  startedAt?: string;
  finishedAt?: string;
}

const RECORD = "job.json";
const STAGE_OF: Record<string, Stage> = { size: "voice", voice: "voice", align: "voice", timing: "voice", compile: "layout", lint: "layout", sheet: "layout", render: "render" };

function now() {
  return new Date().toISOString();
}

function slug(s: string, max = 40): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, max)
      .replace(/-+$/, "") || "video"
  );
}

export function jobDir(id: string): string {
  if (!/^[a-z0-9][a-z0-9-]{0,80}$/.test(id)) throw new HttpError(400, "Unknown video.");
  const d = path.join(JOBS_DIR, id);
  if (!fs.existsSync(d)) throw new HttpError(404, "There is no video with that id.");
  return d;
}

function writeRecord(r: JobRecord) {
  r.updatedAt = now();
  const dir = path.join(JOBS_DIR, r.id);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, RECORD + ".tmp");
  fs.writeFileSync(tmp, JSON.stringify(r, null, 2) + "\n");
  fs.renameSync(tmp, path.join(dir, RECORD));
}

function readJsonFile<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}

/** A record for a job folder made outside the app (for example the demo jobs). */
function synthesise(id: string): JobRecord | null {
  const dir = path.join(JOBS_DIR, id);
  const specFile = path.join(dir, "spec.json");
  if (!fs.existsSync(specFile)) return null;
  const spec = readJsonFile<{ title?: string; brand?: string; voice?: string; formats?: FormatId[] }>(specFile);
  if (!spec) return null;
  const brief = fs.existsSync(path.join(dir, "brief.md")) ? fs.readFileSync(path.join(dir, "brief.md"), "utf8") : "";
  const outs = fs.existsSync(path.join(dir, "out")) ? fs.readdirSync(path.join(dir, "out")).filter((f) => f.endsWith(".mp4")) : [];
  const st = fs.statSync(specFile);
  return {
    id,
    title: spec.title ?? id,
    brief,
    brand: spec.brand ?? "demo",
    voice: spec.voice,
    formats: spec.formats ?? [...FORMAT_IDS],
    createdAt: st.mtime.toISOString(),
    updatedAt: st.mtime.toISOString(),
    state: outs.length ? "done" : "stopped",
    mode: "full",
    stage: null,
    stagesDone: outs.length ? STAGES.map((s) => s.id) : [],
    progress: outs.length ? 1 : 0,
    message: outs.length ? "Made from the command line" : "Not made yet",
    notes: [],
    media: [],
    fromApp: false,
  };
}

// ---------- the store and the queue ----------

interface Running {
  id: string;
  abort: AbortController;
}

export class JobQueue {
  private records = new Map<string, JobRecord>();
  private queue: string[] = [];
  private running: Running | null = null;
  private runningDone: Promise<void> | null = null;
  private closing = false;

  constructor() {
    fs.mkdirSync(JOBS_DIR, { recursive: true });
    for (const d of fs.readdirSync(JOBS_DIR, { withFileTypes: true })) {
      if (!d.isDirectory()) continue;
      const rec = readJsonFile<JobRecord>(path.join(JOBS_DIR, d.name, RECORD));
      if (rec) {
        if (rec.state === "queued" || rec.state === "running") {
          rec.state = "stopped";
          rec.message = "The app was restarted before this video finished. Press Try again to make it.";
          rec.stage = null;
          writeRecord(rec);
        }
        this.records.set(rec.id, rec);
      }
    }
  }

  list(): JobRecord[] {
    const ids = fs.existsSync(JOBS_DIR) ? fs.readdirSync(JOBS_DIR, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name) : [];
    const out: JobRecord[] = [];
    for (const id of ids) {
      const r = this.records.get(id) ?? synthesise(id);
      if (r) out.push(r);
    }
    return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  get(id: string): JobRecord {
    jobDir(id);
    const r = this.records.get(id) ?? synthesise(id);
    if (!r) throw new HttpError(404, "There is no video with that id.");
    return r;
  }

  brandBusy(brand: string): boolean {
    return [...this.records.values()].some((r) => r.brand === brand && (r.state === "queued" || r.state === "running"));
  }

  /** How many videos must finish before this one starts: the running one plus those queued ahead. -1 if not queued. */
  queuePosition(id: string): number {
    const i = this.queue.indexOf(id);
    if (i < 0) return i;
    return i + (this.running && this.running.id !== id ? 1 : 0);
  }

  /** Create a job folder for a new brief. Media files are saved into media/. */
  create(input: { brief: string; brand: string; voice?: string; formats: FormatId[]; media: Array<{ name: string; data: Buffer; description?: string }> }): JobRecord {
    const brief = input.brief.trim();
    if (brief.length < 10) throw new HttpError(400, "Write a brief of at least a sentence: what the video is about, who it is for, and what they should do.");
    if (brief.length > 20000) throw new HttpError(400, "The brief must be 20,000 characters or fewer.");
    let brandOk = false;
    try {
      brandOk = loadBrand(input.brand).ok;
    } catch {
      throw new HttpError(400, `There is no brand called ${input.brand}.`);
    }
    if (!brandOk) throw new HttpError(400, "This brand has problems that stop videos being made. Fix them on the Brands page first.");
    const formats = input.formats.filter((f) => (FORMAT_IDS as readonly string[]).includes(f));
    if (!formats.length) throw new HttpError(400, "Choose at least one format.");
    const d = new Date();
    const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}-${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}`;
    const words = brief.split(/\s+/).slice(0, 6).join(" ");
    let id = `${stamp}-${slug(words, 32)}`;
    for (let n = 2; fs.existsSync(path.join(JOBS_DIR, id)); n++) id = `${stamp}-${slug(words, 32)}-${n}`;
    const dir = path.join(JOBS_DIR, id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "brief.md"), brief + "\n");
    // Photos and clips live in the brand's media folder (the engine reads them from there),
    // in a folder for this job: brands/<brand>/media/uploads/<job id>/.
    const media: MediaItem[] = [];
    const brandMedia = path.join(loadBrand(input.brand).dir, "media");
    const uploadRel = `uploads/${id}`;
    for (const m of input.media) {
      const ext = path.extname(m.name).toLowerCase();
      const kind = [".mp4", ".mov", ".webm", ".m4v"].includes(ext) ? "clip" : "photo";
      const base = slug(path.basename(m.name, ext), 40);
      const folder = path.join(brandMedia, uploadRel);
      fs.mkdirSync(folder, { recursive: true });
      let file = `${base}${ext}`;
      for (let n = 2; fs.existsSync(path.join(folder, file)); n++) file = `${base}-${n}${ext}`;
      fs.writeFileSync(path.join(folder, file), m.data);
      media.push({ file: `${uploadRel}/${file}`, kind, description: m.description?.trim() || undefined, ...probeMedia(path.join(folder, file)) });
    }
    const rec: JobRecord = {
      id,
      title: words.length < brief.length ? `${words}...` : words,
      brief,
      brand: input.brand,
      voice: input.voice || undefined,
      formats,
      createdAt: now(),
      updatedAt: now(),
      state: "queued",
      mode: "full",
      stage: null,
      stagesDone: [],
      progress: 0,
      message: "Waiting to start",
      notes: [],
      media,
      fromApp: true,
    };
    this.records.set(id, rec);
    writeRecord(rec);
    this.enqueue(id);
    return rec;
  }

  /** Save an edited spec and make the video again from it, without reading the brief again. */
  async rerender(id: string, rawSpec: unknown): Promise<JobRecord> {
    const dir = jobDir(id);
    const r = this.get(id);
    if (r.state === "queued" || r.state === "running") throw new HttpError(409, "This video is still being made. Wait for it to finish or stop it first.");
    const v = validateSpec(rawSpec);
    if (!v.ok)
      throw new HttpError(400, "The script has problems. Fix them and try again.", {
        problems: v.issues.map((i) => `${describePath(i.path, rawSpec)}${plainMessage(i.message)}`),
        fields: v.issues.map((i) => fieldOf(i.path, plainMessage(i.message))).filter(Boolean),
      });
    try {
      makeDecision(v.spec);
    } catch (e) {
      if (e instanceof SizeError) throw new HttpError(400, e.message, { problems: [e.message] });
      throw e;
    }
    try {
      if (!loadBrand(v.spec.brand).ok) throw new HttpError(400, "This brand has problems that stop videos being made. Fix them on the Brands page first.");
    } catch (e) {
      if (e instanceof HttpError) throw e;
      throw new HttpError(400, `There is no brand called ${v.spec.brand}.`);
    }
    // Measure the text with the real fonts now, so the person hears about text that does not fit in seconds,
    // next to the box to shorten, instead of after the voice is recorded.
    const formats = ((v.spec.formats as FormatId[] | undefined) ?? r.formats) as FormatId[];
    const fit = (await textFitCheck(v.spec, loadBrand(v.spec.brand), null, formats, path.join(dir, "review", "fit"))).filter((f) => f.level === "error");
    if (fit.length) {
      const index = (sid?: string) => v.spec.scenes.findIndex((sc, i) => sceneId(sc, i) === sid);
      throw new HttpError(400, "Some text does not fit. Shorten the parts shown and try again.", {
        problems: [...new Set(fit.map((f) => f.message))],
        // A problem with the scene as a whole ("too tall together") is shown at its longest text part.
        fields: fit
          .filter((f) => index(f.scene) >= 0)
          .map((f) => {
            const sc = v.spec.scenes[index(f.scene)];
            const longest = Object.entries(sc.slots as Record<string, unknown>)
              .filter(([, x]) => typeof x === "string")
              .sort((a, b) => String(b[1]).length - String(a[1]).length)[0]?.[0];
            return { scene: index(f.scene), slot: f.slot ?? longest, message: f.message };
          })
          .filter((f) => f.slot),
      });
    }
    fs.writeFileSync(path.join(dir, "spec.json"), JSON.stringify(rawSpec, null, 2) + "\n");
    const rec: JobRecord = this.records.get(id) ?? { ...r, fromApp: true };
    rec.title = v.spec.title;
    rec.brand = v.spec.brand;
    rec.formats = (v.spec.formats as FormatId[] | undefined) ?? rec.formats;
    rec.state = "queued";
    rec.mode = "rerender";
    rec.stage = null;
    rec.stagesDone = ["understand", "write"];
    rec.progress = 0;
    rec.message = "Waiting to start";
    rec.error = undefined;
    this.records.set(id, rec);
    writeRecord(rec);
    this.enqueue(id);
    return rec;
  }

  /** Run a stopped or failed job again from the start. */
  retry(id: string): JobRecord {
    const found = this.get(id);
    if (found.state === "queued" || found.state === "running") throw new HttpError(409, "This video is already being made.");
    const hasSpec = fs.existsSync(path.join(jobDir(id), "spec.json"));
    // A job made from the command line has no record of its own: make one, and reuse its script.
    if (!found.fromApp && !hasSpec) throw new HttpError(400, "This video has no script to make it from.");
    const r: JobRecord = this.records.get(id) ?? { ...found, stagesDone: hasSpec ? ["understand", "write"] : [] };
    this.records.set(id, r);
    r.state = "queued";
    // Reuse the script if it was already written; read the brief again only if it was not.
    r.mode = hasSpec && r.stagesDone.includes("write") ? "rerender" : "full";
    r.stage = null;
    r.stagesDone = r.mode === "rerender" ? ["understand", "write"] : [];
    r.progress = 0;
    r.message = "Waiting to start";
    r.error = undefined;
    writeRecord(r);
    this.enqueue(id);
    return r;
  }

  stop(id: string): JobRecord {
    const r = this.get(id);
    const qi = this.queue.indexOf(id);
    if (qi >= 0) {
      this.queue.splice(qi, 1);
      r.state = "stopped";
      r.message = "Stopped before it started.";
      writeRecord(r);
    } else if (this.running?.id === id) {
      this.running.abort.abort();
      r.stopping = true;
      r.message = "Stopping. This can take a few seconds.";
      writeRecord(r);
    }
    return r;
  }

  /**
   * Delete a finished, failed or stopped video: its folder in jobs/ and any photos or clips uploaded for it.
   * Refuses a video that is waiting or being made. Only ever removes a folder directly inside the jobs folder.
   */
  remove(id: string): void {
    // jobDir checks the id (lower-case letters, digits and hyphens only) and that the folder exists.
    const dir = jobDir(id);
    const r = this.records.get(id) ?? synthesise(id);
    if (this.running?.id === id || this.queue.includes(id) || r?.state === "queued" || r?.state === "running")
      throw new HttpError(409, "This video is still being made. Stop it first, then delete it.");
    const root = path.resolve(JOBS_DIR);
    const target = path.resolve(dir);
    if (path.dirname(target) !== root || path.basename(target) !== id) throw new HttpError(400, "Unknown video.");
    const st = fs.lstatSync(target);
    if (st.isSymbolicLink()) fs.unlinkSync(target);
    else if (st.isDirectory()) fs.rmSync(target, { recursive: true, force: true });
    else throw new HttpError(400, "Unknown video.");
    // Uploaded photos and clips live in brands/<brand>/media/uploads/<id>/: remove them too, if they are there.
    if (r?.media?.length) {
      try {
        const uploads = path.resolve(loadBrand(r.brand).dir, "media", "uploads");
        const folder = path.resolve(uploads, id);
        if (path.dirname(folder) === uploads && fs.existsSync(folder) && !fs.lstatSync(folder).isSymbolicLink()) fs.rmSync(folder, { recursive: true, force: true });
      } catch {
        /* the brand may have gone; the video itself is deleted */
      }
    }
    this.records.delete(id);
  }

  /**
   * The app is shutting down (SIGTERM). Waiting jobs and the running job are marked stopped, with the same
   * message as after a restart, so Try again works when the app is back. Resolves when the running job has
   * stopped, or after waitMs.
   */
  async shutdown(waitMs: number): Promise<void> {
    this.closing = true;
    const restarted = "The app was restarted before this video finished. Press Try again to make it.";
    for (const id of this.queue.splice(0)) {
      const r = this.records.get(id);
      if (r) this.update(r, { state: "stopped", stage: null, message: restarted, finishedAt: now() });
    }
    if (!this.running) return;
    this.running.abort.abort();
    const done = this.runningDone;
    await Promise.race([done, new Promise((r) => setTimeout(r, waitMs).unref())]);
    // If the job has not stopped in time, record it as stopped anyway: the process is about to end.
    const r = this.running ? this.records.get(this.running.id) : null;
    if (r && r.state === "running") this.update(r, { state: "stopped", stopping: false, stage: null, message: restarted, finishedAt: now() });
  }

  private enqueue(id: string) {
    if (this.closing) return;
    if (!this.queue.includes(id)) this.queue.push(id);
    void this.pump();
  }

  private async pump() {
    if (this.running) return;
    const id = this.queue.shift();
    if (!id) return;
    const rec = this.records.get(id);
    if (!rec) return void this.pump();
    const abort = new AbortController();
    this.running = { id, abort };
    this.runningDone = this.run(rec, abort.signal);
    try {
      await this.runningDone;
    } finally {
      this.running = null;
      this.runningDone = null;
      if (!this.closing) void this.pump();
    }
  }

  private update(rec: JobRecord, patch: Partial<JobRecord>) {
    // While stopping, progress from the steps still finishing must not replace the "Stopping" message.
    if (rec.stopping && patch.state !== "stopped" && patch.state !== "error" && patch.state !== "done") {
      const { message: _m, ...rest } = patch;
      patch = rest;
    }
    Object.assign(rec, patch);
    try {
      writeRecord(rec);
    } catch {
      /* best effort */
    }
  }

  private async run(rec: JobRecord, signal: AbortSignal) {
    const dir = path.join(JOBS_DIR, rec.id);
    const markDone = (s: Stage) => {
      if (!rec.stagesDone.includes(s)) rec.stagesDone.push(s);
    };
    rec.stopping = false;
    this.update(rec, { state: "running", startedAt: now(), finishedAt: undefined, error: undefined, notes: rec.mode === "full" ? [] : rec.notes });
    // The interpreter takes the first 15% of the bar on a full run; the engine's pipeline the rest.
    const start = rec.mode === "full" ? 0.15 : 0;
    try {
      if (rec.mode === "full") {
        this.update(rec, { stage: "understand", progress: 0.02, message: "Reading the brief" });
        const result = await interpretBrief({
          brief: rec.brief,
          brand: rec.brand,
          voice: rec.voice,
          formats: rec.formats,
          media: rec.media,
          signal,
          workDir: path.join(dir, "review", "interpret"),
          onProgress: (e) => {
            if (e.stage === "understand" && e.status === "done") {
              markDone("understand");
              this.update(rec, { stage: "write", progress: 0.06, message: e.message });
            } else if (e.stage === "write") {
              this.update(rec, { stage: "write", progress: e.status === "retry" ? 0.1 : 0.07, message: e.message });
            } else if (e.stage === "check") {
              this.update(rec, { stage: "write", progress: e.status === "done" ? 0.15 : 0.12, message: e.message });
            } else {
              this.update(rec, { message: e.message });
            }
          },
        });
        markDone("write");
        fs.writeFileSync(path.join(dir, "spec.json"), JSON.stringify(result.spec, null, 2) + "\n");
        const { spec: _s, ...rest } = result;
        fs.writeFileSync(path.join(dir, "interpret.json"), JSON.stringify(rest, null, 2) + "\n");
        this.update(rec, {
          title: result.spec.title,
          notes: result.notes,
          interpret: { backend: result.backend, model: result.model, attempts: result.attempts, seconds: result.seconds, size: result.size.size, keyMessages: result.understanding.keyMessages },
          progress: start,
        });
      }
      if (signal.aborted) throw new PipelineError("size", "Stopped.");
      await makeVideo(dir, { formats: rec.formats, signal }, (e: ProgressEvent) => {
        const stage = STAGE_OF[e.step] ?? rec.stage;
        if (e.status === "done" && e.step === "timing") markDone("voice");
        if (e.status === "done" && e.step === "sheet") markDone("layout");
        if (e.status === "done" && e.step === "render") markDone("render");
        this.update(rec, { stage, progress: start + (1 - start) * e.overall, message: e.message });
      });
      if (signal.aborted) throw new PipelineError("render", "Stopped.");
      for (const s of STAGES) markDone(s.id);
      this.update(rec, { state: "done", stopping: false, stage: null, progress: 1, message: "Your video is ready", finishedAt: now() });
    } catch (e) {
      const stopped = signal.aborted;
      const stage = rec.stage;
      let message = (e as Error).message;
      let problems: string[] | undefined;
      if (e instanceof InterpretError) problems = e.problems;
      if (e instanceof PipelineError && e.findings) problems = e.findings.filter((f) => f.level === "error").map((f) => `${f.format ? f.format + " " : ""}${f.scene ? f.scene + ": " : ""}${f.message}`);
      if (e instanceof PipelineError && e.step === "lint") message = "Some text does not fit the layout. Edit the script to shorten it, then make the video again.";
      if (!(e instanceof PipelineError) && !(e instanceof InterpretError) && !stopped) console.error(`[job ${rec.id}]`, e);
      this.update(rec, {
        state: stopped ? "stopped" : "error",
        stopping: false,
        message: stopped ? (this.closing ? "The app was restarted before this video finished. Press Try again to make it." : "Stopped. Press Try again to make it.") : message,
        error: stopped ? undefined : { stage, message, problems, ...(e instanceof InterpretError && !e.retryable ? { retryable: false } : {}) },
        finishedAt: now(),
      });
    }
  }
}

/** Plain names for the parts of a scene, matching the script editor's labels. */
const PART_NAMES: Record<string, string> = {
  title: "title",
  eyebrow: "small heading above the title",
  subtitle: "line under the title",
  kicker: "small heading",
  text: "main text",
  support: "supporting line",
  action: "what to do",
  link: "web address",
  detail: "extra detail",
  heading: "heading",
  value: "number",
  label: "label",
  source: "source",
  quote: "quote",
  name: "name",
  role: "role",
  emphasis: "words to highlight",
  icon: "icon",
  photo: "photo",
  clip: "video clip",
  items: "list",
  voiceover: "spoken lines",
};

/** Plain wording for Zod's own messages. */
function plainMessage(m: string): string {
  return m
    .replace(/^Too small: expected array to have >=(\d+) items?$/, (_x, n) => `Add at least ${n}.`)
    .replace(/^Too big: expected array to have <=(\d+) items?$/, (_x, n) => `Use ${n} or fewer.`)
    .replace(/^Too small: expected string to have >=1 characters?$/, "Fill this in.")
    .replace(/^Invalid input.*$/, "This is not filled in correctly.");
}

/** The editor field a schema problem belongs to: { scene, slot, item? }. */
function fieldOf(p: string, message: string): { scene: number; slot: string; item?: number; message: string } | null {
  const m = p.match(/^scenes\.(\d+)\.slots\.([a-z]+)(?:\.(\d+))?/);
  if (!m) return null;
  return { scene: Number(m[1]), slot: m[2], item: m[3] != null ? Number(m[3]) : undefined, message };
}

/** "scenes.1.slots.icon.icon" -> "Scene 2, icon: " so messages make sense to people. */
function describePath(p: string, _spec: unknown): string {
  if (!p) return "";
  const m = p.match(/^scenes\.(\d+)\.(?:slots\.)?(.+)$/);
  if (!m) return p === "title" ? "Video title: " : "";
  const parts = m[2].split(".");
  let words = PART_NAMES[parts[0]] ?? parts[0];
  if (parts[0] === "items" && parts[1] != null) words = `item ${Number(parts[1]) + 1}${parts[2] === "icon" ? " icon" : ""}`;
  else if (parts[0] === "voiceover" && parts[1] != null) words = `spoken line ${Number(parts[1]) + 1}`;
  else if (parts[0] === "emphasis" && parts[1] != null) words = "words to highlight";
  return `Scene ${Number(m[1]) + 1}, ${words}: `;
}

// ---------- details for the page ----------

function probeMedia(file: string): { width?: number; height?: number; seconds?: number } {
  try {
    const r = spawnSync("ffprobe", ["-v", "error", "-show_entries", "stream=width,height:format=duration", "-of", "json", file], { encoding: "utf8", timeout: 15000 });
    const j = JSON.parse(r.stdout) as { streams?: Array<{ width?: number; height?: number }>; format?: { duration?: string } };
    const s = j.streams?.find((x) => x.width);
    const dur = Number(j.format?.duration);
    return { width: s?.width, height: s?.height, ...(dur > 0.2 && /\.(mp4|mov|webm)$/i.test(file) ? { seconds: dur } : {}) };
  } catch {
    return {};
  }
}

/** The first contact-sheet still of a format, shown on the video before it plays (so it is not a black box). */
function posterFor(dir: string, base: string, f: string): string | null {
  const stills = path.join(dir, "review", "stills", f);
  try {
    const first = fs.readdirSync(stills).filter((x) => x.endsWith(".png")).sort()[0];
    return first ? `${base}/review/stills/${f}/${first}?t=${Math.round(fs.statSync(path.join(stills, first)).mtimeMs)}` : null;
  } catch {
    return null;
  }
}

/** Everything the page shows for one job: the record, the decision, the spec, outputs and the contact sheet. */
export function jobView(q: JobQueue, id: string) {
  const r = q.get(id);
  const dir = jobDir(id);
  const base = `/job-files/${id}`;
  const decision = readJsonFile<Record<string, unknown>>(path.join(dir, "decision.json"));
  let spec: unknown = null;
  try {
    spec = fs.existsSync(path.join(dir, "spec.json")) ? readSpec(path.join(dir, "spec.json")) : null;
  } catch {
    spec = readJsonFile(path.join(dir, "spec.json"));
  }
  const timeline = readJsonFile<{ duration?: number }>(path.join(dir, "timeline.json"));
  const name = path.basename(dir);
  const busy = r.state === "queued" || r.state === "running";
  const outputs = FORMAT_IDS.filter((f) => fs.existsSync(path.join(dir, "out", `${name}-${f}.mp4`))).map((f) => ({
        format: f,
        url: `${base}/out/${name}-${f}.mp4`,
        download: `${base}/out/${name}-${f}.mp4?download=1`,
        bytes: fs.statSync(path.join(dir, "out", `${name}-${f}.mp4`)).size,
        poster: posterFor(dir, base, f),
      }));
  const srt = fs.existsSync(path.join(dir, "out", `${name}.srt`)) ? `${base}/out/${name}.srt?download=1` : null;
  const sheetFile = path.join(dir, "review", "contact-sheet.png");
  const sheetFresh = fs.existsSync(sheetFile) && (!busy || r.stagesDone.includes("layout"));
  return {
    job: r,
    queuePosition: q.queuePosition(id),
    stages: STAGES,
    decision,
    duration: timeline?.duration ?? null,
    spec,
    outputs: busy ? [] : outputs,
    srt: busy ? null : srt,
    sheet: sheetFresh ? `${base}/review/contact-sheet.png?t=${Math.round(fs.statSync(sheetFile).mtimeMs)}` : null,
  };
}
