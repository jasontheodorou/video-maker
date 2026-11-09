// Align step: whisper.cpp gives word timings for each phrase; we match them back to the known script,
// so caption words are always spelled exactly as written. Results are cached by audio content.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { CACHE_DIR } from "./paths";
import { normWord, speakable, words as splitWords } from "./text";
import { readWav } from "./wav";
import type { WordTiming } from "./schema";

const ALIGN_CACHE = path.join(CACHE_DIR, "align");
const WHISPER_MODEL = "small.en";

interface HeardWord {
  text: string;
  start: number;
  end: number;
}

function fileHash(file: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex").slice(0, 24);
}

/** Word timings heard by whisper in one audio file (seconds from the file's start). Cached. */
export async function hearWords(audioFile: string): Promise<HeardWord[]> {
  fs.mkdirSync(ALIGN_CACHE, { recursive: true });
  const cacheFile = path.join(ALIGN_CACHE, `${fileHash(audioFile)}-${WHISPER_MODEL}.json`);
  if (fs.existsSync(cacheFile)) return JSON.parse(fs.readFileSync(cacheFile, "utf8"));
  const api = await import("hyperframes/api");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "va-align-"));
  try {
    const res = await api.transcribe({ input: audioFile, dir, engine: "whisper", model: WHISPER_MODEL, language: "en" });
    if (res.kind !== "transcribed") throw new Error("Transcription returned no words");
    const raw = JSON.parse(fs.readFileSync(res.transcriptPath, "utf8")) as Array<{ text: string; start: number; end: number }>;
    const heard = raw.map((w) => ({ text: String(w.text).trim(), start: Number(w.start), end: Number(w.end) })).filter((w) => w.text);
    fs.writeFileSync(cacheFile, JSON.stringify(heard));
    return heard;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Edit-distance similarity between two normalised words, 0 to 1. */
function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (!a || !b) return 0;
  const m = a.length, n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...new Array(n).fill(0)]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return 1 - d[m][n] / Math.max(m, n);
}

/** Rough syllable count of a script word as the voice says it (digits one by one, web addresses with "dot"). */
export function spokenSyllables(word: string): number {
  const spoken = speakable(word).toLowerCase();
  let n = 0;
  for (const part of spoken.split(/[^a-z0-9]+/).filter(Boolean)) {
    if (/^\d+$/.test(part)) {
      // Short numbers are said as numbers ("25", "1"); longer runs digit by digit.
      n += part.length <= 2 ? 2 : part.length * 1.4;
      continue;
    }
    const groups = part.replace(/e$/, "").match(/[aeiouy]+/g);
    n += Math.max(1, groups ? groups.length : 1);
  }
  if (/%$/.test(word)) n += 2;
  return Math.max(1, n);
}

/** Longest believable time for one word, in seconds. Whisper times longer than this are not used. */
function maxWordSeconds(word: string): number {
  return Math.max(1.2, 0.36 * spokenSyllables(word) + 0.5);
}

export interface Pause {
  start: number;
  end: number;
}

/**
 * Pauses in a phrase recording: stretches quieter than 35 dB below the loud speech, at least minPause long.
 * Measured on 10 ms windows. Leading and trailing silence are left out; speech start and end are returned too.
 */
export function findPauses(samples: Int16Array, sampleRate: number, minPause = 0.12): { pauses: Pause[]; speechStart: number; speechEnd: number } {
  const win = Math.max(1, Math.round(sampleRate * 0.01));
  const rms: number[] = [];
  for (let i = 0; i + win <= samples.length; i += win) {
    let acc = 0;
    for (let k = i; k < i + win; k++) acc += samples[k] * samples[k];
    rms.push(Math.sqrt(acc / win));
  }
  if (!rms.length) return { pauses: [], speechStart: 0, speechEnd: samples.length / sampleRate };
  const sorted = [...rms].sort((a, b) => a - b);
  const loud = sorted[Math.floor(sorted.length * 0.95)] || 1;
  const threshold = Math.max(30, loud * 10 ** (-35 / 20));
  const voiced = rms.map((v) => v > threshold);
  const first = voiced.indexOf(true);
  const last = voiced.lastIndexOf(true);
  if (first < 0) return { pauses: [], speechStart: 0, speechEnd: samples.length / sampleRate };
  const pauses: Pause[] = [];
  let runStart = -1;
  for (let i = first; i <= last; i++) {
    if (!voiced[i]) {
      if (runStart < 0) runStart = i;
    } else if (runStart >= 0) {
      if ((i - runStart) * 0.01 >= minPause) pauses.push({ start: runStart * 0.01, end: i * 0.01 });
      runStart = -1;
    }
  }
  return { pauses, speechStart: first * 0.01, speechEnd: (last + 1) * 0.01 };
}

/**
 * Time a run of words that whisper could not time believably, between two known points.
 * Words share the speaking time by their spoken syllables. Real pauses in the audio are then given to the
 * nearest word boundary (a boundary after a comma or full stop is preferred), and each part is shared out again.
 */
function timeFromPauses(words: string[], from: number, to: number, pauses: Pause[]): Array<{ start: number; end: number }> {
  const n = words.length;
  if (!n) return [];
  const inside = pauses.filter((p) => p.start > from + 0.05 && p.end < to - 0.05);
  const weight = words.map(spokenSyllables);
  // Share [a, b] between words i..j-1 by weight, skipping the given pauses.
  const share = (i: number, j: number, a: number, b: number, skip: Pause[]): Array<{ start: number; end: number }> => {
    const gaps = skip.filter((p) => p.start > a && p.end < b);
    const voiced = Math.max(0.05 * (j - i), b - a - gaps.reduce((t, p) => t + (p.end - p.start), 0));
    const at = (v: number) => {
      // Clock time after v seconds of voiced time from a.
      let t = a;
      let left = v;
      for (const p of gaps) {
        if (t + left <= p.start) break;
        left -= p.start - t;
        t = p.end;
      }
      return t + left;
    };
    const total = weight.slice(i, j).reduce((x, y) => x + y, 0);
    const out: Array<{ start: number; end: number }> = [];
    let acc = 0;
    for (let k = i; k < j; k++) {
      const s = at((voiced * acc) / total);
      acc += weight[k];
      const e = k === j - 1 ? b : at((voiced * acc) / total);
      out.push({ start: s, end: e });
    }
    return out;
  };
  const first = share(0, n, from, to, inside);
  if (n < 2 || !inside.length) return first;
  // Give each clear pause to the nearest free word boundary.
  const boundaries = new Map<number, Pause>(); // boundary k: between word k-1 and word k
  for (const p of [...inside].sort((x, y) => y.end - y.start - (x.end - x.start))) {
    if (p.end - p.start < 0.15) continue;
    const mid = (p.start + p.end) / 2;
    let best = -1;
    let bestCost = Infinity;
    for (let k = 1; k < n; k++) {
      if (boundaries.has(k)) continue;
      const t = (first[k - 1].end + first[k].start) / 2;
      const punct = /[.,;:!?]$/.test(words[k - 1]) ? 0.35 : 0;
      const cost = Math.abs(t - mid) - punct;
      if (cost < bestCost) {
        bestCost = cost;
        best = k;
      }
    }
    if (best > 0 && bestCost < 1.2) {
      // Keep boundaries in order: a pause cannot sit before an earlier-assigned later boundary.
      const ok = [...boundaries.entries()].every(([k, q]) => (k < best ? q.end <= p.start : q.start >= p.end));
      if (ok) boundaries.set(best, p);
    }
  }
  if (!boundaries.size) return first;
  const cuts = [...boundaries.keys()].sort((a, b) => a - b);
  const out: Array<{ start: number; end: number }> = [];
  let i = 0;
  let a = from;
  for (const k of [...cuts, n]) {
    const b = k === n ? to : boundaries.get(k)!.start;
    out.push(...share(i, k, a, b, inside.filter((p) => !cuts.some((c) => boundaries.get(c) === p))));
    if (k < n) a = boundaries.get(k)!.end;
    i = k;
  }
  return out;
}

/**
 * Match script words to heard words with a global alignment (Needleman-Wunsch).
 * Matched words take whisper's times only when they are believable: inside the audio, in order, and not
 * stretched far past how long the word takes to say. Whisper sometimes hears a long web address as one
 * word lasting most of the phrase, which would push every later word to the end. Other words are timed
 * from the pauses in the audio (when the recording is given) or spread by syllables.
 */
export function matchWords(script: string, heard: HeardWord[], audioSeconds: number, audio?: { samples: Int16Array; sampleRate: number }): WordTiming[] {
  const sw = splitWords(script);
  const sn = sw.map(normWord);
  const hn = heard.map((h) => normWord(h.text));
  const m = sw.length, n = heard.length;
  const GAP = -0.4;
  const score = Array.from({ length: m + 1 }, () => new Float64Array(n + 1));
  const move = Array.from({ length: m + 1 }, () => new Uint8Array(n + 1)); // 1 diag, 2 up (skip script), 3 left (skip heard)
  for (let i = 1; i <= m; i++) { score[i][0] = i * GAP; move[i][0] = 2; }
  for (let j = 1; j <= n; j++) { score[0][j] = j * GAP; move[0][j] = 3; }
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const sim = similarity(sn[i - 1], hn[j - 1]);
      const diag = score[i - 1][j - 1] + (sim >= 0.5 ? sim : sim - 1);
      const up = score[i - 1][j] + GAP;
      const left = score[i][j - 1] + GAP;
      if (diag >= up && diag >= left) { score[i][j] = diag; move[i][j] = 1; }
      else if (up >= left) { score[i][j] = up; move[i][j] = 2; }
      else { score[i][j] = left; move[i][j] = 3; }
    }
  }
  const match: Array<number | null> = new Array(m).fill(null);
  let i = m, j = n;
  while (i > 0 || j > 0) {
    const mv = move[i][j];
    if (mv === 1) {
      if (similarity(sn[i - 1], hn[j - 1]) >= 0.5) match[i - 1] = j - 1;
      i--; j--;
    } else if (mv === 2) i--;
    else j--;
  }

  const sound = audio ? findPauses(audio.samples, audio.sampleRate) : null;
  const pauses = sound?.pauses ?? [];
  const out: WordTiming[] = sw.map((text, k) => {
    const h = match[k] != null ? heard[match[k]!] : null;
    return { text, start: h ? h.start : NaN, end: h ? h.end : NaN, matched: !!h };
  });
  // Keep only believable whisper times.
  let lastEnd = -Infinity;
  for (const w of out) {
    if (!w.matched) continue;
    const ok =
      Number.isFinite(w.start) && Number.isFinite(w.end) && w.end > w.start && w.start >= -0.05 && w.end <= audioSeconds + 0.05 &&
      w.end - w.start <= maxWordSeconds(w.text) && w.start >= lastEnd - 0.05;
    if (!ok) w.matched = false;
    else lastEnd = w.end;
  }
  // A word that whisper ran on far past the next word's start is not believable either.
  for (let q = 0; q + 1 < out.length; q++) if (out[q].matched && out[q + 1].matched && out[q].end > out[q + 1].start + 0.15) out[q].matched = false;

  // Time the rest: each run of untimed words fills the time between its timed neighbours.
  const speechStart = sound ? sound.speechStart : heard.length ? Math.max(0, heard[0].start) : 0.05;
  const speechEnd = sound ? Math.min(audioSeconds, sound.speechEnd) : heard.length ? Math.min(audioSeconds, heard[heard.length - 1].end) : Math.max(0.1, audioSeconds - 0.1);
  let k = 0;
  while (k < out.length) {
    if (out[k].matched) { k++; continue; }
    let e = k;
    while (e < out.length && !out[e].matched) e++;
    const from = k > 0 ? out[k - 1].end : Math.min(speechStart, e < out.length ? out[e].start : speechStart);
    const to = e < out.length ? out[e].start : Math.max(speechEnd, from + 0.05 * (e - k));
    const times = timeFromPauses(out.slice(k, e).map((w) => w.text), from, Math.max(to, from + 0.05 * (e - k)), pauses);
    times.forEach((t, q) => {
      out[k + q].start = t.start;
      out[k + q].end = t.end;
    });
    k = e;
  }
  snapClearPauses(out, pauses);
  // Keep times ordered and inside the audio.
  for (let q = 0; q < out.length; q++) {
    out[q].start = Math.max(0, Math.min(out[q].start, audioSeconds));
    out[q].end = Math.max(out[q].start + 0.01, Math.min(out[q].end, audioSeconds));
    if (q > 0 && out[q].start < out[q - 1].start) out[q].start = out[q - 1].start;
  }
  return out;
}

/** A pause this long is a real break in speech; no word can run across it. */
export const CLEAR_PAUSE = 0.25;

/** The word whose middle a clear pause falls in (not just its edges), or -1. */
function wordAcrossPause(words: WordTiming[], p: Pause): number {
  const edge = 0.08;
  // Already at a boundary: some word ends by the pause's start and the next starts by its end.
  for (let k = 1; k < words.length; k++) if (words[k - 1].end <= p.start + edge && words[k].start >= p.end - edge) return -1;
  const mid = (p.start + p.end) / 2;
  return words.findIndex((w) => w.start < mid - edge && w.end > mid + edge);
}

/**
 * Whisper sometimes gives believable but early times around a long word (a web address, a phone number):
 * one word then runs straight across a clear pause in the recording, and its caption changes while the
 * previous words are still being said. Each clear pause must fall between two words. For each one that does
 * not, the words around it are timed again from the recording (sharing by syllables, with the pause given to
 * the nearest boundary, a comma or full stop preferred). Only those few words change.
 */
function snapClearPauses(out: WordTiming[], pauses: Pause[]): void {
  if (out.length < 2) return;
  const clear = pauses.filter((p) => p.end - p.start >= CLEAR_PAUSE).sort((a, b) => b.end - b.start - (a.end - a.start));
  for (const p of clear) {
    const m = wordAcrossPause(out, p);
    if (m < 0) continue;
    // A window of words around the pause, wide enough to have speech on both sides of it.
    let a = Math.max(0, m - 1);
    let b = Math.min(out.length - 1, m + 1);
    while (a > 0 && p.start - out[a].start < 0.2 * (m - a + 1)) a--;
    while (b < out.length - 1 && out[b].end - p.end < 0.2 * (b - m + 1)) b++;
    if (b - a < 1) continue;
    const from = out[a].start;
    const to = out[b].end;
    if (!(to > p.end && from < p.start)) continue;
    const times = timeFromPauses(out.slice(a, b + 1).map((w) => w.text), from, to, pauses);
    const trial = out.map((w) => ({ ...w }));
    times.forEach((t, q) => {
      trial[a + q].start = t.start;
      trial[a + q].end = t.end;
      trial[a + q].matched = false;
    });
    if (wordAcrossPause(trial, p) >= 0) continue;
    for (let q = a; q <= b; q++) out[q] = trial[q];
  }
}

/** Words that run across a clear pause in the recording (their captions would change early or late). */
export function wordsAcrossPauses(words: WordTiming[], samples: Int16Array, sampleRate: number): string[] {
  const { pauses } = findPauses(samples, sampleRate);
  return pauses
    .filter((p) => p.end - p.start >= CLEAR_PAUSE)
    .map((p) => wordAcrossPause(words, p))
    .filter((k) => k >= 0)
    .map((k) => words[k].text);
}

/** Problems with a phrase's final word times that would put captions out of step with the voice. */
export function timingProblems(words: WordTiming[], audioSeconds: number): string[] {
  const out: string[] = [];
  for (const w of words) {
    if (w.end - w.start > maxWordSeconds(w.text) + 0.3) out.push(`"${w.text}" is timed at ${(w.end - w.start).toFixed(1)} s, longer than it takes to say`);
  }
  // Whisper often gives one short word ("at") a very short time; that is normal. Several squeezed words in
  // one phrase is the sign of words pushed together at the end.
  const squeezed = words.filter((w) => w.end - w.start < 0.04);
  if (squeezed.length >= 2) out.push(`${squeezed.map((w) => `"${w.text}"`).join(", ")} are squeezed into almost no time`);
  const lastWord = words[words.length - 1];
  if (lastWord && lastWord.start > audioSeconds - 0.05) out.push("the last words are timed after the voice ends");
  return out;
}

/** Align one phrase: hear it, then match to the script. Falls back to timing from pauses if whisper fails. */
export async function alignPhrase(script: string, audioFile: string, audioSeconds: number): Promise<{ words: WordTiming[]; matchedShare: number; warning?: string }> {
  let heard: HeardWord[] = [];
  let warning: string | undefined;
  try {
    heard = await hearWords(audioFile);
  } catch (e) {
    warning = `Whisper could not transcribe "${script.slice(0, 40)}": ${(e as Error).message.split("\n")[0]}. Timed from pauses in the audio instead.`;
  }
  let audio: { samples: Int16Array; sampleRate: number } | undefined;
  try {
    const w = readWav(audioFile);
    audio = { samples: w.samples, sampleRate: w.sampleRate };
  } catch {
    /* timing falls back to spreading by syllables */
  }
  const words = matchWords(script, heard, audioSeconds, audio);
  // Share of words with believable whisper times (rejected times do not count as matched).
  const matchedShare = words.length ? words.filter((w) => w.matched).length / words.length : 0;
  const problems = timingProblems(words, audioSeconds);
  if (audio) {
    const across = wordsAcrossPauses(words, audio.samples, audio.sampleRate);
    if (across.length) problems.push(`${across.map((w) => `"${w}"`).join(", ")} run${across.length === 1 ? "s" : ""} across a pause in the voice`);
  }
  if (!warning && problems.length) warning = `Word timings for "${script.slice(0, 40)}" may be off: ${problems.join("; ")}. Watch the captions for this phrase.`;
  else if (!warning && matchedShare < 0.6) warning = `Only ${(matchedShare * 100).toFixed(0)}% of "${script.slice(0, 40)}" had believable whisper timings; the rest were timed from pauses in the audio. Watch the captions for this phrase.`;
  return { words, matchedShare, warning };
}
