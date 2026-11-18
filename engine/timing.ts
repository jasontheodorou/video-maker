// Timing step: scene length = lead-in + phrases + hold, then the reading-time rule, then whole frames.
// Scene k+1 starts one transition overlap before scene k ends (crossfade 0.5 s, wipe 0.8 s, push 0.7 s, colour
// sweep 0.5 s). Each scene's colour scheme (engine/schemes.ts) and motion (engine/motion-plan.ts) are decided here
// and written to timeline.json, so the compiler, the contact sheet and lint all use the same choices.
// Every time is on the engine's time grid.
import { loadConfig, readingSeconds, ceilToGrid, roundToGrid, type FormatId } from "./config";
import { getScene } from "./scenes";
import { assignSchemes } from "./schemes";
import { resolveMotion, type MotionFixed } from "./motion-plan";
import { SETTLED_SHARE } from "./motion-rules";
import type { LoadedBrand } from "./brand";
import { countWords } from "./text";
import { buildCaptions } from "./captions";
import type { CaptionFits } from "./captionfit";
import { sceneId, specFormats, type Spec } from "./spec";
import type { Decision, Timeline, SceneTiming, WordTiming } from "./schema";

export interface PhraseInput {
  text: string;
  /** Path stored in timeline.json (relative to the job folder). */
  file: string;
  audioSeconds: number;
  /** Word timings relative to the phrase audio's start. */
  words: WordTiming[];
}

export class TimingError extends Error {}

interface Draft {
  id: string;
  type: string;
  enterAt: number;
  leadIn: number;
  phrasesLocal: Array<PhraseInput & { start: number; end: number }>;
  text: Array<{ slot: string; words: number; visibleFrom: number; appearAt: number; requiredSeconds: number }>;
  base: number;
  limitedBy: SceneTiming["limitedBy"];
  extra: number;
}

export function computeTimeline(
  spec: Spec,
  phrases: PhraseInput[][],
  decision: Decision | null,
  voice: { id: string; speed: number; file: string; sampleRate: number },
  /**
   * captionFits: the real caption width test (captionFitter in captionfit.ts). Without it, chunks use word and
   * character limits only. brand: for colour schemes and the brand's motion; without it, each scene type keeps
   * its version 1 surface and the Calm style. fixed: choices to keep from an earlier timeline.
   */
  opts: { captionFits?: CaptionFits | null; brand?: LoadedBrand | null; fixed?: Array<MotionFixed | undefined> } = {},
): Timeline {
  const cfg = loadConfig();
  const T = cfg.timing;
  const xf = T.crossfade;
  const last = spec.scenes.length - 1;
  // Colour schemes, then motion: how each scene arrives, and so how long it overlaps the scene before.
  const assigned = opts.brand ? assignSchemes(spec, opts.brand) : null;
  const schemes = assigned ? assigned.scenes.map((c) => c.scheme) : spec.scenes.map((s) => getScene(s.type).legacyScheme);
  const motion = resolveMotion(spec, opts.brand ?? null, schemes, opts.fixed ?? []);
  const overlapOut = (i: number) => (i < last ? motion.scenes[i + 1].overlap : 0);
  // A colour sweep covers the scene before for a moment before the next scene starts under it.
  const coverOut = (i: number) => (i < last ? motion.scenes[i + 1].overlap + motion.scenes[i + 1].lead : 0);
  if (phrases.length !== spec.scenes.length) throw new TimingError("Each scene needs its voiceover audio. Run the voice step again.");

  const drafts: Draft[] = spec.scenes.map((s, i) => {
    const def = getScene(s.type);
    const enterAt = i === 0 ? T.firstEnterDelay : T.enterDelay;
    const leadIn = i === 0 ? T.firstLeadIn : T.leadIn;
    let cursor = leadIn;
    const phrasesLocal = phrases[i].map((p) => {
      const start = roundToGrid(cursor);
      const end = start + p.audioSeconds;
      cursor = end + cfg.voice.phraseGap;
      return { ...p, start, end };
    });
    const speechEnd = phrasesLocal.length ? phrasesLocal[phrasesLocal.length - 1].end : leadIn;
    const slots = s.slots as Record<string, unknown>;
    const plan = motion.scenes[i];
    const text = def
      .elements(slots)
      .map((e, order) => ({ e, order, p: plan.elements[order] }))
      .filter(({ e }) => e.slot && (typeof e.text === "string" || typeof slots[e.slot] === "string"))
      .map(({ e, p }) => {
        const words = countWords(e.text ?? (slots[e.slot!] as string));
        return {
          slot: e.slot!,
          words,
          visibleFrom: enterAt + p.settled,
          appearAt: enterAt + p.delay,
          requiredSeconds: readingSeconds(words),
        };
      });
    const xfOut = coverOut(i);
    const byVoice = speechEnd + (i === last ? T.endHold : T.hold);
    const byReading = Math.max(0, ...text.map((t) => t.visibleFrom + t.requiredSeconds)) + xfOut;
    // Text is settled for at least 75% of its time on screen: visibleUntil - visibleFrom >= 0.75 x (visibleUntil - appearAt).
    const bySettled = Math.max(0, ...text.map((t) => (t.visibleFrom - SETTLED_SHARE * t.appearAt) / (1 - SETTLED_SHARE))) + xfOut;
    const byMin = T.minSceneSeconds;
    let base = Math.max(byVoice, byReading, bySettled, byMin);
    const limitedBy: SceneTiming["limitedBy"] = base === byVoice ? "voice" : base === byReading || base === bySettled ? "reading" : "minimum";
    base = ceilToGrid(base);
    return { id: sceneId(s, i), type: s.type, enterAt, leadIn, phrasesLocal, text, base, limitedBy, extra: 0 };
  });

  const total = () => drafts.reduce((t, d, i) => t + d.base + d.extra - overlapOut(i), 0);

  // Reach the size's minimum length by holding every scene a little longer (the end card a little more).
  if (decision) {
    const short = decision.targetSeconds.min - total();
    if (short > 0) {
      const weights = drafts.map((_, i) => (i === last ? 2 : 1));
      const wsum = weights.reduce((a, b) => a + b, 0);
      drafts.forEach((d, i) => {
        d.extra = ceilToGrid((short * weights[i]) / wsum);
        d.limitedBy = "target";
      });
    }
    const len = total();
    if (len > decision.targetSeconds.max + 0.5) {
      throw new TimingError(
        `This video would be ${len.toFixed(1)} seconds. A ${decision.size} video should be at most ${decision.targetSeconds.max} seconds. Shorten the voiceover or reduce the number of scenes.`,
      );
    }
  }

  let start = 0;
  const scenes: SceneTiming[] = drafts.map((d, i) => {
    const duration = roundToGrid(d.base + d.extra);
    const xfOut = overlapOut(i);
    const plan = motion.scenes[i];
    const s: SceneTiming = {
      id: d.id,
      type: d.type,
      index: i,
      start: roundToGrid(start),
      duration,
      transitionIn: plan.transition,
      transitionSeconds: plan.overlap,
      ...(assigned ? { scheme: assigned.scenes[i].scheme, schemeAuto: assigned.scenes[i].auto } : {}),
      motionStyle: plan.style,
      entrance: plan.entrance,
      textEffect: plan.textEffect,
      shape: plan.shape,
      ...(plan.transitionColour ? { transitionColour: plan.transitionColour } : {}),
      enterAt: d.enterAt,
      phrases: d.phrasesLocal.map((p) => ({
        text: p.text,
        file: p.file,
        audioSeconds: p.audioSeconds,
        start: roundToGrid(start + p.start),
        end: start + p.end,
        words: p.words.map((w) => ({ ...w, start: start + p.start + w.start, end: start + p.start + w.end })),
      })),
      text: d.text.map(({ appearAt: _a, ...t }) => ({ ...t, visibleUntil: duration - coverOut(i) })),
      limitedBy: d.limitedBy,
    };
    start = start + duration - xfOut;
    return s;
  });
  const duration = roundToGrid(scenes[last].start + scenes[last].duration);

  // The reading rule, checked again on the final numbers.
  for (const s of scenes) {
    for (const t of s.text) {
      if (t.visibleUntil - t.visibleFrom + 1e-6 < t.requiredSeconds) {
        throw new TimingError(`Scene ${s.id}: "${t.slot}" would be readable for ${(t.visibleUntil - t.visibleFrom).toFixed(2)} s but needs ${t.requiredSeconds.toFixed(2)} s.`);
      }
    }
  }
  if (assigned?.errors.length) throw new TimingError(assigned.errors.map((e) => e.message).join(" "));

  const captions = buildCaptions(scenes.flatMap((s) => s.phrases), duration, opts.captionFits);
  return {
    version: 1,
    grid: cfg.timeGrid,
    crossfade: xf,
    duration,
    voice,
    scenes,
    captions,
    formats: specFormats(spec) as FormatId[],
  };
}
