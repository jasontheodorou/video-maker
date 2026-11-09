// Captions: short chunks of the known script, timed from aligned words. Max about 6 words, 40 characters and 2 lines.
// A chunk never flashes: every chunk is fully visible for at least captions.minSeconds. When speech is quick,
// neighbouring chunks move a little (an exact least-squares fit, see fitCues) rather than one chunk being cut short.
import { loadConfig, roundToGrid } from "./config";
import type { CaptionCue, WordTiming } from "./schema";
import type { CaptionFits } from "./captionfit";

const CLAUSE_END = /[.,;:!?)]$|[\u2013\u2014]$/;

const WEAK = new Set(["a", "an", "the", "of", "in", "on", "at", "to", "for", "and", "or", "but", "your", "our", "my", "their", "its", "with", "by", "from", "as", "is", "are", "be", "will", "we", "you", "it", "this", "that", "if", "so", "not", "no", "her", "his", "them",
  "near", "about", "across", "around", "through", "into", "onto", "over", "under", "between", "without", "within", "behind", "beside", "against", "along", "during"]);

/** Words that usually start what is said about a noun ("households | still put", "the plan | will start"). */
const PREDICATE_START = new Set(["will", "can", "must", "should", "may", "might", "could", "would", "is", "are", "was", "were", "has", "have", "had", "still", "also", "now", "already", "often", "usually", "only", "just", "always", "never", "says", "said", "do", "does", "did", "need", "needs", "get", "gets", "cut", "cuts"]);

/** Words that start a noun phrase: a break straight after "<one of these> <word>" usually splits the phrase. */
const DETERMINER = /^(a|an|the|your|our|their|my|her|his|its|this|that|these|those|each|every|some|any|no|one|two|three|four|five|six|seven|eight|nine|ten|\d+)$/i;

/** Words a speaker naturally pauses before: a good place to start a new caption. */
const BREAK_BEFORE = new Set(["in", "on", "at", "to", "for", "with", "and", "but", "or", "so", "because", "when", "if", "every", "each", "by", "from", "as", "until", "before", "after", "which", "who", "where", "while", "then",
  "near", "about", "across", "around", "through", "into", "over", "under", "between", "without", "within", "behind", "against", "along", "during"]);

const MONTH = /^(January|February|March|April|May|June|July|August|September|October|November|December)\b/;

function isWeak(w: string): boolean {
  return WEAK.has(w.toLowerCase().replace(/[^a-z']/g, ""));
}

/** "next | to", "due | to", "up | to": two words that work as one. */
const BEFORE_TO = /^(next|close|due|up|according|prior|thanks|owing|similar|compared|able|unable|going|need|needs|needed|have|has|had|want|wants|wanted|used|likely|try|trying|plan|planning|hope|ought)$/i;

/** Cost of breaking between two words: high inside names, numbers with their unit, dates and noun phrases. */
function joinCost(last: string, next: string, beforeLast?: string, earlier: string[] = []): number {
  if (CLAUSE_END.test(last)) return 0;
  const cap = (w: string) => /^[A-Z][a-z]/.test(w);
  let c = 0;
  if (cap(last) && cap(next)) c += 7; // "Direct | Debit", "Northvale | Council"
  if (/^\d/.test(last) && (MONTH.test(next) || /^(per|pounds?|minutes?|hours?|days?|weeks?|months?|years?|in|%)$/i.test(next))) c += 8; // "3 | March", "4 | weeks"
  if (/^(£|\$)?\d/.test(next) && /^(in|of|per)$/i.test(last)) c += 3; // "1 in | 4"
  // "twelve point four | million pounds"
  const NUM = /^(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion|point|and|[\d.,]+)$/i;
  if (NUM.test(last) && !/^and$/i.test(last) && /^(hundred|thousand|million|billion|point|pounds?|pence|per|percent)$/i.test(next.replace(/[^a-z]/gi, ""))) c += 8;
  // "a council | tax payment", "four Northvale | households": the phrase usually carries on.
  const nextBare = next.toLowerCase().replace(/[^a-z]/g, "");
  const carriesOn = /^[a-z]/.test(next) && !BREAK_BEFORE.has(nextBare) && !isWeak(next) && !PREDICATE_START.has(nextBare);
  if (beforeLast && DETERMINER.test(beforeLast) && carriesOn) c += 5;
  // "a free food | caddy": a noun phrase that began a few words back usually carries on to a plain word.
  else if (earlier.length && carriesOn && !CLAUSE_END.test(beforeLast ?? "")) {
    const back = [...earlier, beforeLast ?? ""].reverse();
    const d = back.findIndex((w) => DETERMINER.test(w));
    // Only when nothing between the determiner and the break starts a new phrase.
    if (d >= 0 && d <= 2 && back.slice(0, d).every((w) => !isWeak(w) && !BREAK_BEFORE.has(w.toLowerCase()) && !CLAUSE_END.test(w))) c += 3;
  }
  // "next | to them", "need | to know": cancels the usual bonus for a break before "to", and more.
  if (nextBare === "to" && BEFORE_TO.test(last.replace(/[^a-z]/gi, ""))) c += 15;
  // "black | bin", "food | waste": a plain lower-case word before another plain word is often one phrase. A small
  // cost, so a break before "in", "to", "and" and the like is preferred.
  if (/^[a-z]+$/.test(last) && carriesOn && !isWeak(last)) c += 3;
  return c;
}

/** "the", "a", "your" at the end of a caption leave the reader hanging: worse than other weak words. */
function weakEndCost(w: string): number {
  if (DETERMINER.test(w.replace(/[^a-z0-9]/gi, "")) && !/^\d/.test(w)) return 12;
  return isWeak(w) ? 6 : 0;
}

function chunkChars(idx: number[], words: WordTiming[]): number {
  return idx.reduce((t, i) => t + words[i].text.length, 0) + Math.max(0, idx.length - 1);
}

/**
 * Does a chunk fit? Word and character limits always; with a measuring test (captionfit.ts), also the real
 * width in every format, so a chunk holding a web address that cannot break is split before it needs 3 lines.
 */
function chunkFits(idx: number[], words: WordTiming[], maxWords: number, maxChars: number, measure?: CaptionFits): boolean {
  if (idx.length > maxWords || chunkChars(idx, words) > maxChars) return false;
  return !measure || measure(idx.map((i) => words[i].text).join(" "));
}

/** Split one clause into n chunks within the word and character limits, preferring even sizes and strong last words. */
function bestSplit(idx: number[], n: number, maxWords: number, maxChars: number, words: WordTiming[], measure?: CaptionFits): { groups: number[][]; cost: number } | null {
  if (n <= 1) return chunkFits(idx, words, maxWords, maxChars, measure) ? { groups: [idx], cost: 0 } : null;
  const L = idx.length;
  const ideal = L / n;
  let best: { cost: number; cuts: number[] } | null = null;
  const fits = (a: number, b: number) => chunkFits(idx.slice(a, b), words, maxWords, maxChars, measure);
  const search = (start: number, left: number, cuts: number[], cost: number) => {
    if (best && cost >= best.cost) return;
    if (left === 1) {
      const len = L - start;
      if (len < 1 || !fits(start, L)) return;
      const total = cost + (len - ideal) ** 2;
      if (!best || total < best.cost) best = { cost: total, cuts: [...cuts] };
      return;
    }
    for (let len = 1; len <= maxWords && start + len < L; len++) {
      if (!fits(start, start + len)) break;
      const last = words[idx[start + len - 1]].text;
      const nextRaw = words[idx[start + len]].text;
      const beforeLast = len >= 2 ? words[idx[start + len - 2]].text : undefined;
      const earlier = idx.slice(Math.max(start, start + len - 4), start + len - 2).map((q) => words[q].text);
      const next = nextRaw.toLowerCase().replace(/[^a-z]/g, "");
      const c = (len - ideal) ** 2 + weakEndCost(last) + (len === 1 ? 4 : 0) - (BREAK_BEFORE.has(next) ? 5 : 0) + joinCost(last, nextRaw, beforeLast, earlier);
      search(start + len, left - 1, [...cuts, start + len], cost + c);
    }
  };
  search(0, n, [], 0);
  if (!best) return null;
  const b = best as { cuts: number[]; cost: number };
  const cuts = [0, ...b.cuts, L];
  return { groups: cuts.slice(0, -1).map((c, i) => idx.slice(c, cuts[i + 1])), cost: b.cost };
}

/** Each extra chunk costs this much, so a clause is only split further when that avoids a bad break. */
const EXTRA_CHUNK_COST = 3;

/**
 * Split a phrase's words into caption groups (indexes into the word list). `measure`, when given, is the real
 * width test from captionFitter: a chunk must also fit the caption box in every format.
 */
export function groupWords(words: WordTiming[], maxWords = loadConfig().captions.maxWords, maxChars = loadConfig().captions.maxChars, measure?: CaptionFits): number[][] {
  // 1. Clauses at punctuation.
  const clauses: number[][] = [];
  let cur: number[] = [];
  words.forEach((w, i) => {
    cur.push(i);
    if (CLAUSE_END.test(w.text)) {
      clauses.push(cur);
      cur = [];
    }
  });
  if (cur.length) clauses.push(cur);
  // 2. Chunks inside each clause: as even as possible, never ending on a weak word such as "the" or "in".
  const groups: number[][] = [];
  for (const c of clauses) {
    let n = Math.max(Math.ceil(c.length / maxWords), Math.ceil(chunkChars(c, words) / maxChars));
    let split: { groups: number[][]; cost: number } | null = null;
    for (; n <= c.length && !split; n++) split = bestSplit(c, n, maxWords, maxChars, words, measure);
    // One more chunk can avoid splitting a phrase ("a free food | caddy"): use it when it is clearly better.
    if (split && n <= c.length && c.length >= 6) {
      const more = bestSplit(c, n, maxWords, maxChars, words, measure);
      if (more && more.cost + EXTRA_CHUNK_COST < split.cost) split = more;
    }
    groups.push(...(split?.groups ?? c.map((i) => [i])));
  }
  // 3. Fold tiny groups (one or two words) into a neighbour when it stays within the limits.
  const fits = (g: number[]) => chunkFits(g, words, maxWords, maxChars, measure);
  for (let i = 0; i < groups.length; i++) {
    if (groups[i].length > 2 || groups.length === 1) continue;
    if (i > 0 && fits(groups[i - 1].concat(groups[i]))) {
      groups[i - 1] = groups[i - 1].concat(groups[i]);
      groups.splice(i, 1);
      i--;
    } else if (i + 1 < groups.length && fits(groups[i].concat(groups[i + 1]))) {
      groups[i + 1] = groups[i].concat(groups[i + 1]);
      groups.splice(i, 1);
      i--;
    }
  }
  return groups;
}

/**
 * Join a chunk that would be spoken too quickly to read (under minSeconds) to a neighbour, when the two
 * together stay within the limits. Prefers the neighbour that makes the shorter chunk.
 */
export function mergeQuick(
  groups: number[][],
  words: WordTiming[],
  minSeconds: number,
  maxWords = loadConfig().captions.maxWords,
  maxChars = loadConfig().captions.maxChars,
  measure?: CaptionFits,
): number[][] {
  const out = groups.map((g) => [...g]);
  const dur = (g: number[]) => words[g[g.length - 1]].end - words[g[0]].start;
  for (let guard = 0; guard < 50; guard++) {
    let best: { i: number; j: number; size: number } | null = null;
    out.forEach((g, i) => {
      if (dur(g) >= minSeconds) return;
      for (const j of [i - 1, i + 1]) {
        if (j < 0 || j >= out.length) continue;
        const joined = i < j ? [...g, ...out[j]] : [...out[j], ...g];
        const size = joined.length;
        if (chunkFits(joined, words, maxWords, maxChars, measure) && (!best || size < best.size)) best = { i, j, size };
      }
    });
    if (!best) break;
    const { i, j } = best as { i: number; j: number };
    const a = Math.min(i, j);
    out.splice(a, 2, [...out[a], ...out[a + 1]]);
  }
  return out;
}

/**
 * Weighted isotonic regression (pool adjacent violators): the non-decreasing sequence closest to the targets
 * in weighted least squares.
 */
function isotonic(target: number[], weight: number[]): number[] {
  const blocks: Array<{ sum: number; w: number; n: number }> = [];
  target.forEach((t, i) => {
    blocks.push({ sum: t * weight[i], w: weight[i], n: 1 });
    while (blocks.length > 1 && blocks[blocks.length - 2].sum / blocks[blocks.length - 2].w > blocks[blocks.length - 1].sum / blocks[blocks.length - 1].w) {
      const b = blocks.pop()!;
      const a = blocks[blocks.length - 1];
      a.sum += b.sum;
      a.w += b.w;
      a.n += b.n;
    }
  });
  return blocks.flatMap((b) => new Array(b.n).fill(b.sum / b.w));
}

interface RawCue {
  start: number;
  end: number;
  text: string;
  words: Array<{ text: string; start: number; end: number }>;
}

/**
 * Place cues so that each is fully visible for at least minSeconds, as close to its words as possible.
 * Chunks spoken with little or no gap between them form a run: they swap in place with no gap (a gap of a
 * few frames would make the caption blink). A run fades in at its start and out at its end.
 * The points (each run's start, the swaps inside it, its end) must stay in order and far enough apart;
 * subtracting the least spacing turns that into "non-decreasing", which isotonic regression solves exactly.
 */
export function fitCues(raw: RawCue[], opts: { minSeconds: number; fade: number; closeGap: number; grid: number; total?: number }): Array<RawCue & { fadeIn: boolean; fadeOut: boolean }> {
  if (!raw.length) return [];
  const step = (s: number) => Math.ceil(s * opts.grid - 1e-6) / opts.grid;
  // Runs: a new run starts where the words leave a clear gap.
  const runStart = raw.map((c, i) => i === 0 || c.start - raw[i - 1].end >= opts.closeGap);
  const runEnd = raw.map((_, i) => i === raw.length - 1 || runStart[i + 1]);
  // Points in time order: for cue i, its start point (shared with the previous cue's end inside a run) and,
  // for the last cue of a run, its end point.
  const target: number[] = [];
  const weight: number[] = [];
  const spacing: number[] = []; // least distance from the previous point
  const startPoint: number[] = [];
  const endPoint: number[] = [];
  raw.forEach((c, i) => {
    const need = step(opts.minSeconds + (runStart[i] ? opts.fade : 0) + (runEnd[i] ? opts.fade : 0));
    startPoint[i] = target.length;
    target.push(c.start);
    weight.push(2); // a chunk should appear as its first word is spoken
    spacing.push(runStart[i] ? 0 : step(opts.minSeconds + (runStart[i - 1] ? opts.fade : 0) + (runEnd[i - 1] ? opts.fade : 0)) /* set below */);
    if (runEnd[i]) {
      endPoint[i] = target.length;
      target.push(c.end);
      weight.push(1);
      spacing.push(need);
    } else endPoint[i] = target.length; // the next cue's start point
  });
  // Spacing before a start point inside a run is the previous cue's need.
  raw.forEach((_, i) => {
    if (i > 0 && !runStart[i]) spacing[startPoint[i]] = step(opts.minSeconds + (runStart[i - 1] ? opts.fade : 0) + (runEnd[i - 1] ? opts.fade : 0));
  });
  const offset: number[] = [];
  let acc = 0;
  spacing.forEach((sp, k) => {
    acc += k === 0 ? 0 : sp;
    offset.push(acc);
  });
  const y = isotonic(target.map((t, k) => t - offset[k]), weight).map((v) => Math.max(0, v));
  const x = y.map((v, k) => Math.round((v + offset[k]) * opts.grid) / opts.grid);
  const out = raw.map((c, i) => ({ ...c, start: x[startPoint[i]], end: x[endPoint[i]], fadeIn: runStart[i], fadeOut: runEnd[i] }));
  // Close any gap the fit squeezed below closeGap, so captions never blink.
  for (let i = 0; i + 1 < out.length; i++) {
    const gap = out[i + 1].start - out[i].end;
    if (gap < opts.closeGap) {
      out[i].end = out[i + 1].start;
      out[i].fadeOut = false;
      out[i + 1].fadeIn = false;
    }
  }
  if (opts.total != null) for (const c of out) c.end = Math.min(c.end, opts.total);
  return out;
}

/**
 * Build caption cues for the whole video from phrases with absolute word timings. Pass `measure`
 * (captionFitter(brand, formats)) so chunks are also checked against the real caption width.
 */
export function buildCaptions(phrases: Array<{ words: WordTiming[]; start: number; end: number }>, total?: number, measure?: CaptionFits | null): CaptionCue[] {
  const cfg = loadConfig().captions;
  const grid = loadConfig().timeGrid;
  const m = measure ?? undefined;
  const raw: RawCue[] = [];
  for (const p of phrases) {
    for (const g of mergeQuick(groupWords(p.words, cfg.maxWords, cfg.maxChars, m), p.words, cfg.minSeconds, cfg.maxWords, cfg.maxChars, m)) {
      const ws = g.map((i) => p.words[i]);
      raw.push({
        start: Math.max(p.start, ws[0].start - 0.05),
        end: Math.min(p.end + cfg.tail, ws[ws.length - 1].end + cfg.tail),
        text: ws.map((w) => w.text).join(" "),
        words: ws.map((w) => ({ text: w.text, start: Math.round(w.start * 1000) / 1000, end: Math.round(w.end * 1000) / 1000 })),
      });
    }
  }
  const fitted = fitCues(raw, { minSeconds: cfg.minSeconds, fade: cfg.fade, closeGap: cfg.closeGap, grid, total });
  return fitted.map((r, i) => ({ id: `cap-${i}`, start: roundToGrid(r.start), end: roundToGrid(r.end), text: r.text, fadeIn: r.fadeIn, fadeOut: r.fadeOut, words: r.words }));
}

/** How long a cue is fully visible: its length minus the fades the compiler draws. */
export function fullyVisibleSeconds(c: Pick<CaptionCue, "start" | "end" | "fadeIn" | "fadeOut">, fade = loadConfig().captions.fade): number {
  const dur = c.end - c.start;
  const f = Math.min(fade, dur / 4);
  return dur - (c.fadeIn ? f : 0) - (c.fadeOut ? f : 0);
}

/** How far a cue sits from its own words: positive when it appears after the first word starts. */
export function cueShift(c: CaptionCue): number {
  return c.words?.length ? c.start - c.words[0].start : 0;
}

function srtTime(t: number): string {
  const ms = Math.round(t * 1000);
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const r = ms % 1000;
  const p = (v: number, w = 2) => String(v).padStart(w, "0");
  return `${p(h)}:${p(m)}:${p(s)},${p(r, 3)}`;
}

export function toSrt(cues: CaptionCue[]): string {
  return cues.map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.text}\n`).join("\n");
}
