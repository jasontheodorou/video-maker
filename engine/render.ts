// Render step: HyperFrames turns each compiled format into an MP4 with the voice track muxed in.
import fs from "node:fs";
import path from "node:path";
import { HF_BIN, CACHE_DIR } from "./paths";
import { run } from "./proc";

export interface RenderProgress {
  phase: string;
  /** 0 to 1 for this render. */
  fraction: number;
}

export interface RenderOptions {
  fps: number;
  quality: string;
  workers?: string | number;
  /** Software rendering in Chrome (SwiftShader). Slower, but the same pixels on any machine. */
  softwareGpu?: boolean;
  onProgress?: (p: RenderProgress) => void;
  signal?: AbortSignal;
  /** Extra hyperframes render arguments, such as ["--crf", "0"] for a lossless check copy. */
  extraArgs?: string[];
  /** Called while this render waits for another process's render to finish (every few seconds). */
  onWait?: (info: { seconds: number; holder: RenderLockInfo | null }) => void;
}

// ---------- one render at a time, across processes ----------
// Two renders at once on a 16 GB Mac (the web app and the command line, say) each run several Chrome workers;
// memory runs out and both slow down about 40 times, without failing. So renders take turns: a lock file in
// .cache/ names the process rendering, and any other render waits for it. A lock left by a process that has
// ended is taken over.

export interface RenderLockInfo {
  pid: number;
  since: string;
  what: string;
}

export const RENDER_LOCK = path.join(CACHE_DIR, "render.lock");

function alive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

function readLock(): RenderLockInfo | null {
  try {
    return JSON.parse(fs.readFileSync(RENDER_LOCK, "utf8")) as RenderLockInfo;
  } catch {
    return null;
  }
}

// True while this process holds the lock. A lock file naming this process's id when it does not hold it was
// left by an earlier run: in a container restarted with a kept data folder the new process often gets the same id.
let holding = false;

/** Try to take the lock once. True when this process now holds it. */
function tryLock(what: string): boolean {
  holding = tryLockOnce(what);
  return holding;
}

function tryLockOnce(what: string): boolean {
  fs.mkdirSync(path.dirname(RENDER_LOCK), { recursive: true });
  try {
    const fd = fs.openSync(RENDER_LOCK, "wx");
    fs.writeSync(fd, JSON.stringify({ pid: process.pid, since: new Date().toISOString(), what }));
    fs.closeSync(fd);
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
  }
  const held = readLock();
  // A lock with no readable owner, or one whose process has gone, is stale. A lock this process already holds
  // (a nested call) is not re-entered: renders within one process are already one at a time.
  if (!held || !alive(held.pid) || (held.pid === process.pid && !holding)) {
    // Only remove it if it is still the same stale file, then try again.
    try {
      const again = readLock();
      if (!again || again.pid === held?.pid) fs.rmSync(RENDER_LOCK, { force: true });
    } catch {
      /* someone else took it */
    }
    try {
      const fd = fs.openSync(RENDER_LOCK, "wx");
      fs.writeSync(fd, JSON.stringify({ pid: process.pid, since: new Date().toISOString(), what }));
      fs.closeSync(fd);
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

function releaseLock(): void {
  holding = false;
  const held = readLock();
  if (held?.pid === process.pid) fs.rmSync(RENDER_LOCK, { force: true });
}

// Never leave a lock behind when this process ends.
let exitHooked = false;
function hookExit() {
  if (exitHooked) return;
  exitHooked = true;
  process.on("exit", releaseLock);
}

// Within one process, renders also queue (several jobs can run in one process through the API).
let localQueue: Promise<unknown> = Promise.resolve();

/** Run fn while holding the render lock, waiting for other processes' renders first. */
export async function withRenderLock<T>(what: string, fn: () => Promise<T>, opts: { signal?: AbortSignal; onWait?: RenderOptions["onWait"] } = {}): Promise<T> {
  const prev = localQueue;
  let done!: () => void;
  localQueue = new Promise<void>((r) => (done = r));
  try {
    await prev;
    hookExit();
    const t0 = Date.now();
    let lastReport = -Infinity;
    while (!tryLock(what)) {
      if (opts.signal?.aborted) throw new Error("Stopped while waiting for another video to finish.");
      if (Date.now() - lastReport >= 4000) {
        lastReport = Date.now();
        opts.onWait?.({ seconds: (Date.now() - t0) / 1000, holder: readLock() });
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    try {
      return await fn();
    } finally {
      releaseLock();
    }
  } finally {
    done();
  }
}

export interface RenderResult {
  file: string;
  seconds: number;
  log: string;
}

export async function renderBuild(buildDir: string, outFile: string, opts: RenderOptions): Promise<RenderResult> {
  return withRenderLock(path.relative(path.dirname(CACHE_DIR), outFile), () => renderUnlocked(buildDir, outFile, opts), { signal: opts.signal, onWait: opts.onWait });
}

async function renderUnlocked(buildDir: string, outFile: string, opts: RenderOptions): Promise<RenderResult> {
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  // PNG frames from video clips: JPEG frames decoded slightly differently from render to render (up to 3 levels),
  // which broke frame-for-frame repeatability. PNG is exact. It only affects compositions with clips.
  const args = ["render", buildDir, "-o", outFile, "--fps", String(opts.fps), "--quality", opts.quality, "--strict", "--video-frame-format", "png"];
  if (opts.workers != null) args.push("--workers", String(opts.workers));
  if (opts.softwareGpu) args.push("--no-browser-gpu");
  if (opts.extraArgs) args.push(...opts.extraArgs);
  const t0 = Date.now();
  let log = "";
  const r = await run(HF_BIN, args, {
    signal: opts.signal,
    onLine: (line) => {
      log += line + "\n";
      const m = /^@hf-progress (\{.*\})$/.exec(line.trim());
      if (m && opts.onProgress) {
        try {
          const j = JSON.parse(m[1]);
          opts.onProgress({ phase: j.code ?? "render", fraction: Math.min(1, (j.pct ?? 0) / 100) });
        } catch {
          /* ignore */
        }
      }
    },
  });
  if (r.code !== 0 || !fs.existsSync(outFile)) {
    const tail = (r.stderr + "\n" + r.stdout).split("\n").filter((l) => !l.startsWith("@hf-progress")).slice(-30).join("\n");
    throw new Error(`Render failed for ${buildDir}:\n${tail}`);
  }
  return { file: outFile, seconds: (Date.now() - t0) / 1000, log };
}

/** Take PNG stills from a build at exact times. Returns the PNG paths in order. */
export async function snapshotBuild(buildDir: string, times: number[], outDir: string): Promise<string[]> {
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  const r = await run(HF_BIN, ["snapshot", buildDir, "--at", times.map((t) => t.toFixed(3)).join(","), "--no-end", "-o", outDir, "--json"]);
  let parsed: { ok?: boolean; frames?: Array<{ path: string; time: number }> } = {};
  try {
    parsed = JSON.parse(r.stdout);
  } catch {
    throw new Error(`hyperframes snapshot failed:\n${(r.stderr || r.stdout).slice(-1500)}`);
  }
  if (!parsed.frames || parsed.frames.length !== times.length) throw new Error(`hyperframes snapshot returned ${parsed.frames?.length ?? 0} frames, expected ${times.length}`);
  return parsed.frames.map((f) => f.path);
}

/** ffprobe summary of a rendered file. */
export async function probe(file: string): Promise<{ width: number; height: number; fps: string; frames: number; duration: number; audio: boolean }> {
  const r = await run("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,width,height,r_frame_rate,nb_frames,duration", "-of", "json", file]);
  const j = JSON.parse(r.stdout) as { streams: Array<Record<string, string | number>> };
  const v = j.streams.find((s) => s.codec_type === "video");
  if (!v) throw new Error(`${file} has no video stream`);
  return {
    width: Number(v.width),
    height: Number(v.height),
    fps: String(v.r_frame_rate),
    frames: Number(v.nb_frames),
    duration: Number(v.duration),
    audio: j.streams.some((s) => s.codec_type === "audio"),
  };
}
