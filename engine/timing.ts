// Timing step: scene length = lead-in + phrases + hold, then the reading-time rule, then whole frames.
// Scene k+1 starts one transition length before scene k ends (crossfade 0.5 s, wipe 0.8 s).
// Every time is on the engine's time grid.
import { loadConfig, readingSeconds, ceilToGrid, roundToGrid, type FormatId } from "./config";
import { ENTRANCES, STAGGER } from "./motion";
import { getScene } from "./scenes";
import { countWords } from "./text";
import { buildCaptions } from "./captions";
import type { CaptionFits } from "./captionfit";
import { chooseTransition, transitionSeconds } from "./transitions";
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
  text: Array<{ slot: string; words: number; visibleFrom: number; requiredSeconds: number }>;
  base: number;
  limitedBy: SceneTiming["limitedBy"];
  extra: number;
}

export function computeTimeline(
  spec: Spec,
  phrases: PhraseInput[][],
  decision: Decision | null,
  voice: { id: string; speed: number; file: string; sampleRate: number },
  /** captionFits: the real caption width test (captionFitter in captionfit.ts). Without it, chunks use word and character limits only. */
  opts: { captionFits?: CaptionFits | null } = {},
): Timeline {
  const cfg = loadConfig();
  const T = cfg.timing;
  const xf = T.crossfade;
  const last = spec.scenes.length - 1;
  // How each scene arrives, and so how long it overlaps the scene before.
  const transitions = spec.scenes.map((s, i) => chooseTransition(i === 0 ? null : getScene(spec.scenes[i - 1].type), getScene(s.type)));
  const overlapOut = (i: number) => (i < last ? transitionSeconds(transitions[i + 1], T) : 0);
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
    const text = def
      .elements(slots)
      .map((e, order) => ({ e, order }))
      .filter(({ e }) => e.slot && (typeof e.text === "string" || typeof slots[e.slot] === "string"))
      .map(({ e, order }) => {
        const words = countWords(e.text ?? (slots[e.slot!] as string));
        return {
          slot: e.slot!,
          words,
          visibleFrom: enterAt + order * STAGGER + ENTRANCES[e.entrance].duration,
          requiredSeconds: readingSeconds(words),
        };
      });
    const xfOut = overlapOut(i);
    const byVoice = speechEnd + (i === last ? T.endHold : T.hold);
    const byReading = Math.max(0, ...text.map((t) => t.visibleFrom + t.requiredSeconds)) + xfOut;
    const byMin = T.minSceneSeconds;
    let base = Math.max(byVoice, byReading, byMin);
    const limitedBy: SceneTiming["limitedBy"] = base === byVoice ? "voice" : base === byReading ? "reading" : "minimum";
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
    const s: SceneTiming = {
      id: d.id,
      type: d.type,
      index: i,
      start: roundToGrid(start),
      duration,
      transitionIn: transitions[i],
      transitionSeconds: transitionSeconds(transitions[i], T),
      enterAt: d.enterAt,
      phrases: d.phrasesLocal.map((p) => ({
        text: p.text,
        file: p.file,
        audioSeconds: p.audioSeconds,
        start: roundToGrid(start + p.start),
        end: start + p.end,
        words: p.words.map((w) => ({ ...w, start: start + p.start + w.start, end: start + p.start + w.end })),
      })),
      text: d.text.map((t) => ({ ...t, visibleUntil: duration - xfOut })),
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
