// Voice step: Kokoro speaks each phrase once. Files are cached by text, voice, speed and language,
// so changing one phrase only re-speaks that phrase. The voice adapter is this one file:
// a paid voice service could replace synthesise() without touching anything else.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { CACHE_DIR, ENGINE_DIR, HF_BIN } from "./paths";
import { run, runOk } from "./proc";
import { readWav } from "./wav";
import { speakable } from "./text";

export const KOKORO_VOICES = [
  { id: "bf_emma", label: "Emma (British, female)", lang: "en-gb" },
  { id: "bf_isabella", label: "Isabella (British, female)", lang: "en-gb" },
  { id: "bm_george", label: "George (British, male)", lang: "en-gb" },
  { id: "af_heart", label: "Heart (American, female)", lang: "en-us" },
  { id: "af_nova", label: "Nova (American, female)", lang: "en-us" },
  { id: "af_sky", label: "Sky (American, female)", lang: "en-us" },
  { id: "am_adam", label: "Adam (American, male)", lang: "en-us" },
  { id: "am_michael", label: "Michael (American, male)", lang: "en-us" },
] as const;

export function voiceLang(voice: string, lang?: string): string {
  if (lang) return lang;
  return voice.startsWith("b") ? "en-gb" : "en-us";
}

export interface PhraseRequest {
  text: string;
  voice: string;
  speed: number;
  lang?: string;
}

export interface PhraseAudio extends PhraseRequest {
  file: string;
  seconds: number;
  sampleRate: number;
  cached: boolean;
}

const VOICE_CACHE = path.join(CACHE_DIR, "voice");
const MODEL_DIR = path.join(os.homedir(), ".cache", "hyperframes", "tts");
const MODEL_FILE = path.join(MODEL_DIR, "models", "kokoro-v1.0.onnx");
const VOICES_FILE = path.join(MODEL_DIR, "voices", "voices-v1.0.bin");

export function phraseKey(p: PhraseRequest): string {
  const payload = JSON.stringify({ t: speakable(p.text), v: p.voice, s: p.speed, l: voiceLang(p.voice, p.lang), m: "kokoro-v1.0" });
  return crypto.createHash("sha256").update(payload).digest("hex").slice(0, 24);
}

/** Make sure the Kokoro model files exist. The first run downloads them through HyperFrames. */
export async function ensureKokoro(): Promise<void> {
  if (fs.existsSync(MODEL_FILE) && fs.existsSync(VOICES_FILE)) return;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "va-tts-"));
  await runOk(HF_BIN, ["tts", "Ready.", "-v", "bf_emma", "-o", path.join(tmp, "warm.wav"), "--json"]);
  if (!fs.existsSync(MODEL_FILE)) throw new Error(`Kokoro model not found at ${MODEL_FILE} after download.`);
}

/** Seconds with no new spoken line before progress says the step is taking longer than usual. */
export const VOICE_SLOW_SECONDS = Number(process.env.VIDEO_VOICE_SLOW_SECONDS) || 30;
/** Seconds with no new spoken line before the Kokoro process is stopped and started again (once). */
export const VOICE_STALL_SECONDS = Number(process.env.VIDEO_VOICE_STALL_SECONDS) || 120;

/**
 * Speak every phrase that is not already cached. Returns one entry per request, in order.
 * onProgress gets `slow: true` while no new line has been made for VOICE_SLOW_SECONDS. A batch that makes
 * nothing for VOICE_STALL_SECONDS is stopped and started again for the lines still to make; after that,
 * anything left is made one line at a time with the HyperFrames CLI.
 */
export async function synthesise(
  requests: PhraseRequest[],
  onProgress?: (done: number, total: number, slow?: boolean) => void,
  signal?: AbortSignal,
): Promise<PhraseAudio[]> {
  fs.mkdirSync(VOICE_CACHE, { recursive: true });
  const items = requests.map((r) => ({ r, key: phraseKey(r), file: path.join(VOICE_CACHE, `${phraseKey(r)}.wav`) }));
  const todo = new Map<string, (typeof items)[number]>();
  for (const it of items) if (!fs.existsSync(it.file)) todo.set(it.key, it);
  let done = items.length - todo.size;
  onProgress?.(done, items.length);

  if (todo.size > 0) {
    await ensureKokoro();
    const tmpOut = (f: string) => `${f}.part.wav`;
    let lastBatch: { code: number; stderr: string } | null = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      const left = [...todo.values()].filter((it) => !fs.existsSync(it.file));
      if (!left.length || signal?.aborted) break;
      const jobsFile = path.join(VOICE_CACHE, `jobs-${process.pid}-${Date.now()}.json`);
      fs.writeFileSync(
        jobsFile,
        JSON.stringify(left.map((it) => ({ text: speakable(it.r.text), voice: it.r.voice, speed: it.r.speed, lang: voiceLang(it.r.voice, it.r.lang), out: tmpOut(it.file) }))),
      );
      const local = new AbortController();
      const onOuter = () => local.abort();
      signal?.addEventListener("abort", onOuter, { once: true });
      let last = Date.now();
      let slow = false;
      let stalled = false;
      const watch = setInterval(() => {
        const idle = (Date.now() - last) / 1000;
        if (idle >= VOICE_SLOW_SECONDS && !slow) {
          slow = true;
          onProgress?.(done, items.length, true);
        }
        if (idle >= VOICE_STALL_SECONDS && !stalled) {
          stalled = true;
          process.stderr.write(`Kokoro made no new line for ${VOICE_STALL_SECONDS} s; starting it again (attempt ${attempt}).\n`);
          local.abort();
        }
      }, 2000);
      try {
        lastBatch = await run("python3", [path.join(ENGINE_DIR, "kokoro_batch.py"), MODEL_FILE, VOICES_FILE, jobsFile], {
          signal: local.signal,
          onLine: (line, stream) => {
            if (stream !== "stdout") return;
            try {
              const j = JSON.parse(line);
              if (j.out) {
                fs.renameSync(j.out, j.out.replace(/\.part\.wav$/, ""));
                done++;
                last = Date.now();
                slow = false;
                onProgress?.(done, items.length, false);
              }
            } catch {
              /* not a progress line */
            }
          },
        });
      } catch (e) {
        if (signal?.aborted) throw new Error("Stopped.");
        if (!stalled) throw e;
        lastBatch = { code: 1, stderr: "Stopped after making no progress." };
      } finally {
        clearInterval(watch);
        signal?.removeEventListener("abort", onOuter);
        fs.rmSync(jobsFile, { force: true });
        for (const it of left) fs.rmSync(tmpOut(it.file), { force: true });
      }
      if (!stalled) break;
    }
    // Fallback: anything the batch did not make is made one at a time with the HyperFrames CLI.
    let said = false;
    for (const it of todo.values()) {
      if (signal?.aborted) throw new Error("Stopped.");
      if (fs.existsSync(it.file)) continue;
      if (!said && lastBatch && lastBatch.code !== 0) {
        said = true;
        process.stderr.write(`Kokoro batch failed, falling back to hyperframes tts:\n${lastBatch.stderr.split("\n").slice(-6).join("\n")}\n`);
      }
      await runOk(HF_BIN, ["tts", speakable(it.r.text), "-v", it.r.voice, "-s", String(it.r.speed), "-l", voiceLang(it.r.voice, it.r.lang), "-o", it.file, "--json"], { signal });
      done++;
      onProgress?.(done, items.length);
    }
  }

  return items.map((it) => {
    const w = readWav(it.file);
    return { ...it.r, file: it.file, seconds: w.samples.length / w.sampleRate, sampleRate: w.sampleRate, cached: !todo.has(it.key) };
  });
}
