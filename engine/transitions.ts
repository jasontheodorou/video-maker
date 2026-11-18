// Transitions between scenes: their lengths, the overlap they need, and the CSS they use.
// Which transition each cut gets is decided in engine/motion-plan.ts (resolveMotion), from the video's motion style,
// the brand and the spec, under the rules in engine/motion-rules.ts. The house rule (Calm):
//   - Into or out of a scene that shows a photo or video: crossfade. Pictures dissolve into each other.
//   - Between two text scenes of different tone (a dark card and a light card): the config's
//     timing.darkLightTransition (crossfade by default; "wipe" gives a soft wipe).
//   - Otherwise: crossfade.
// Only opacity and transform change.
import { loadConfig, type FormatConfig, type EngineConfig } from "./config";
import { WIPE_FEATHER } from "./motion";
import type { TransitionId } from "./motion-rules";

export type TransitionIn = "none" | TransitionId;

/** Seconds a transition lasts on screen. */
export function transitionSeconds(t: TransitionIn, timing: Pick<EngineConfig["timing"], "crossfade" | "wipe"> & { transitions?: Partial<Record<TransitionId, number>> } = loadConfig().timing): number {
  if (t === "none" || t === "cut") return 0;
  const tr = timing.transitions ?? {};
  if (t === "crossfade") return tr.crossfade ?? timing.crossfade;
  if (t === "wipe") return tr.wipe ?? timing.wipe;
  if (t === "push") return tr.push ?? 0.7;
  return tr.sweep ?? 1.0;
}

/** Seconds the two scenes overlap. A colour sweep overlaps for half its length: the next scene starts at its midpoint. */
export function transitionOverlap(t: TransitionIn, timing?: Parameters<typeof transitionSeconds>[1]): number {
  const s = transitionSeconds(t, timing);
  return t === "sweep" ? s / 2 : s;
}

/** Seconds before the next scene starts that the transition already covers the scene before (the sweep's first half). */
export function transitionLead(t: TransitionIn, timing?: Parameters<typeof transitionSeconds>[1]): number {
  return transitionSeconds(t, timing) - transitionOverlap(t, timing);
}

/** A scene's overlap with the one before, from timeline.json (older timelines only have the crossfade length). */
export function sceneTransitionSeconds(s: { transitionIn: TransitionIn; transitionSeconds?: number }, crossfade: number): number {
  return s.transitionIn === "none" || s.transitionIn === "cut" ? 0 : (s.transitionSeconds ?? crossfade);
}

/** Seconds a scene's incoming transition covers the end of the scene before, beyond the overlap. */
export function sceneTransitionLead(s: { transitionIn: TransitionIn; transitionSeconds?: number }): number {
  return s.transitionIn === "sweep" ? sceneTransitionSeconds(s, 0) : 0;
}

/** Width of the wipe's soft edge in px for a format. */
export function wipeFeather(format: FormatConfig): number {
  return Math.round(format.width * WIPE_FEATHER);
}

/** CSS for the wipe wrapper and the sweep layer, the same in every compiled page. */
export function transitionCss(format: FormatConfig): string {
  const f = wipeFeather(format);
  const w = format.width;
  return `
.scene-wipe{position:absolute;left:0;top:0;width:${w}px;height:${format.height}px}
.scene-wipe.wipe{width:${w + f}px;will-change:transform;-webkit-mask-image:linear-gradient(to right,#000 0,#000 ${w}px,transparent ${w + f}px);mask-image:linear-gradient(to right,#000 0,#000 ${w}px,transparent ${w + f}px)}
.scene-wipe.wipe>.scene-inner{right:auto;width:${w}px;will-change:transform}
.scene-wipe.push{will-change:transform}
.sweep{position:absolute;left:0;top:0;width:${w}px;height:${format.height}px;background:var(--sweep);will-change:transform;pointer-events:none}`;
}

/** Distance the wipe wrapper travels (frame width plus the soft edge). */
export function wipeDistance(format: FormatConfig): number {
  return format.width + wipeFeather(format);
}

/**
 * Fastest the moving edge of a transition goes, in px a frame at 60 fps, for a frame width. Wipes and pushes move
 * the whole width; the sweep's layer crosses the frame in each half. Measured on the curve itself.
 */
export function peakEdgeSpeed(t: TransitionIn, width: number, fps = 60, timing?: Parameters<typeof transitionSeconds>[1]): number {
  if (t === "none" || t === "cut" || t === "crossfade") return 0;
  const secs = t === "sweep" ? transitionSeconds(t, timing) / 2 : transitionSeconds(t, timing);
  const curve: [number, number, number, number] = t === "wipe" ? [0.2, 0.8, 0.2, 1] : [0.65, 0, 0.35, 1];
  const dist = t === "wipe" ? width * (1 + WIPE_FEATHER) : width;
  // The visible edge of a wipe is the inner scene and the wrapper moving together: half each, so the soft edge
  // moves at the wrapper's speed. Sample the curve finely and take the largest step between frames.
  const frames = Math.max(1, Math.round(secs * fps));
  const ease = bezier(...curve);
  let peak = 0;
  for (let i = 1; i <= frames; i++) peak = Math.max(peak, (ease(i / frames) - ease((i - 1) / frames)) * dist);
  return peak;
}

function bezier(x1: number, y1: number, x2: number, y2: number) {
  const cx = 3 * x1,
    bx = 3 * (x2 - x1) - cx,
    ax = 1 - cx - bx;
  const cy = 3 * y1,
    by = 3 * (y2 - y1) - cy,
    ay = 1 - cy - by;
  const sx = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sy = (t: number) => ((ay * t + by) * t + cy) * t;
  return (p: number) => {
    let lo = 0,
      hi = 1,
      t = p;
    for (let i = 0; i < 50; i++) {
      t = (lo + hi) / 2;
      if (sx(t) < p) lo = t;
      else hi = t;
    }
    return sy(t);
  };
}
