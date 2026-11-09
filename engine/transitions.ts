// Transitions between scenes. The engine picks one per cut from a fixed rule; a spec never chooses.
//
// The rule:
//   - Into or out of a scene that shows a photo or video: crossfade. Pictures dissolve into each other.
//   - Between two text scenes on surfaces of different brightness (a dark card and a light card): the
//     config's timing.darkLightTransition. The default is a crossfade, as the motion rules ask. "wipe" gives a
//     soft wipe, which keeps both cards crisp but whose edge crosses the frame in about 0.3 s.
//   - Otherwise (same kind of surface): crossfade.
//
// Both last config timing.crossfade and use the house curve. Only opacity and transform change.
import { loadConfig, type FormatConfig } from "./config";
import type { AnyScene } from "./scenes/types";
import type { SurfaceId } from "./schema";
import { WIPE_FEATHER, type TransitionName } from "./motion";

export type TransitionIn = "none" | TransitionName;

function tone(s: SurfaceId): "dark" | "light" {
  return s === "dark" ? "dark" : "light";
}

export function chooseTransition(prev: AnyScene | null, next: AnyScene): TransitionIn {
  if (!prev) return "none";
  if (prev.media || next.media) return "crossfade";
  if (tone(prev.surface) !== tone(next.surface)) return loadConfig().timing.darkLightTransition === "wipe" ? "wipe" : "crossfade";
  return "crossfade";
}

/** Seconds a transition lasts: the overlap between the two scenes. */
export function transitionSeconds(t: TransitionIn, timing: { crossfade: number; wipe: number }): number {
  return t === "none" ? 0 : t === "wipe" ? timing.wipe : timing.crossfade;
}

/** A scene's transition length from timeline.json (older timelines only have the crossfade length). */
export function sceneTransitionSeconds(s: { transitionIn: TransitionIn; transitionSeconds?: number }, crossfade: number): number {
  return s.transitionIn === "none" ? 0 : (s.transitionSeconds ?? crossfade);
}

/** Width of the wipe's soft edge in px for a format. */
export function wipeFeather(format: FormatConfig): number {
  return Math.round(format.width * WIPE_FEATHER);
}

/** CSS for the wipe wrapper, the same in every compiled page. */
export function transitionCss(format: FormatConfig): string {
  const f = wipeFeather(format);
  const w = format.width;
  return `
.scene-wipe{position:absolute;left:0;top:0;width:${w}px;height:${format.height}px}
.scene-wipe.wipe{width:${w + f}px;will-change:transform;-webkit-mask-image:linear-gradient(to right,#000 0,#000 ${w}px,transparent ${w + f}px);mask-image:linear-gradient(to right,#000 0,#000 ${w}px,transparent ${w + f}px)}
.scene-wipe.wipe>.scene-inner{right:auto;width:${w}px;will-change:transform}`;
}

/** Distance the wipe wrapper travels (frame width plus the soft edge). */
export function wipeDistance(format: FormatConfig): number {
  return format.width + wipeFeather(format);
}
