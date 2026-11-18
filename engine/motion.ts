// The closed set of motion values. Scenes pick a preset by name; they never write easing or durations.
// House curve: ease-out cubic-bezier(0.2, 0.8, 0.2, 1). Entrances 400 to 800 ms, 60 ms stagger,
// small fades and rises (24 px at most), crossfade transitions. No bounce, no overshoot.
// Only transform and opacity are animated.

export const HOUSE_CURVE = [0.2, 0.8, 0.2, 1] as const;
export const HOUSE_CURVE_CSS = `cubic-bezier(${HOUSE_CURVE.join(", ")})`;

export const DURATION = {
  /** Small things: labels, captions, icons. */
  short: 0.4,
  /** Default entrance for text blocks. */
  medium: 0.6,
  /** Large display text and logos. */
  long: 0.8,
} as const;

export const STAGGER = 0.06;

/**
 * Entrances start at this opacity, not 0. It is invisible (under half of one 8-bit level, so it rounds to
 * nothing), but it makes Chrome draw each text layer once, at its exact whole-pixel start position, before it
 * moves. At 0 Chrome skips the layer until the first visible frame, which differs between parallel render
 * workers, so settled text came out at slightly different sub-pixel positions frame to frame (a shimmer).
 */
export const RASTER_FLOOR_OPACITY = 0.002;

/** Rise distances in px at 1080p. Never more than 24. The compiler rounds them to whole pixels per format. */
export const RISE = {
  none: 0,
  small: 12,
  medium: 18,
  large: 24,
} as const;

export const MAX_RISE = 24;

/**
 * Entrance presets. A scene element names one of these. The compiler turns it into a GSAP fromTo
 * on opacity and y (translate) only.
 */
export const ENTRANCES = {
  /** Fade in and rise a little. The default for text. */
  rise: { duration: DURATION.medium, rise: RISE.medium },
  /** Display text: a slower, slightly longer rise. */
  riseLarge: { duration: DURATION.long, rise: RISE.large },
  /** Small elements: labels, accent bars, icons. */
  riseSmall: { duration: DURATION.short, rise: RISE.small },
  /** Fade only. For logos, backgrounds and anything that must not move. */
  fade: { duration: DURATION.medium, rise: RISE.none },
  /** Slow fade for large images and logos. */
  fadeLong: { duration: DURATION.long, rise: RISE.none },
} as const;
export type EntranceName = keyof typeof ENTRANCES;
export const ENTRANCE_NAMES = Object.keys(ENTRANCES) as EntranceName[];

/**
 * Transitions between scenes (into a scene). All use the house curve except push and sweep, which use an even
 * ease-in-out so the frame moves as one. A spec never writes timings: it may name a transition, and the engine
 * owns its length (config timing.transitions).
 * - cut: no transition. Never between two scenes with the same scheme (it reads as a glitch).
 * - crossfade: the next scene fades in over the last one (opacity only).
 * - wipe: the next scene is revealed from left to right behind a wide, soft edge. Nothing on screen moves:
 *   a masked wrapper slides in while the scene inside it slides the same distance the other way (transform only).
 * - push: the old scene slides out to the left as the new one slides in from the right (transform only).
 * - sweep: a full-frame layer in the next scheme's colour sweeps across, the next scene starts under it at the
 *   midpoint, and the layer carries on off the frame (transform only).
 */
export { TRANSITION_IDS as TRANSITIONS } from "./motion-rules";
export type { TransitionId as TransitionName } from "./motion-rules";

/** Curve for push and sweep: an even ease-in-out, so the whole frame moves together. */
export const SLIDE_CURVE = [0.65, 0, 0.35, 1] as const;

/** The soft edge of a wipe, as a share of the frame width. */
export const WIPE_FEATHER = 0.3;

/**
 * The slow drift on photos: the photo is held DRIFT.scale larger than its box and pans sideways at an even
 * speed across the whole scene, by a quarter of the spare width each way (about 19 px each side of centre
 * on a full 16:9 frame). Small enough to feel like a steady camera.
 * A pan, not a push-in: measured frame by frame, Chrome draws a slowly scaling photo unevenly (every second
 * or third frame moves more), while a pan moves the same amount every frame. The photo has no compositor
 * layer (no will-change, 2D transform): it is repainted every frame, which is just as even and gives the
 * same pixels in every render worker. As a moving layer, one worker sometimes drew it slightly differently.
 */
export const DRIFT = { scale: 1.04, share: 0.25 } as const;

/** Caption groups fade with this preset (opacity only, never movement). */
export const CAPTION_FADE = { durationFromConfig: true } as const;

/**
 * Solve the house cubic-bezier for a given progress. Shared by the compiler (as inline source)
 * and by any Node-side check that needs the curve. Pure and deterministic.
 */
export function bezierEase(x1: number, y1: number, x2: number, y2: number) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sx = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sy = (t: number) => ((ay * t + by) * t + cy) * t;
  const dx = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  return (p: number): number => {
    if (p <= 0) return 0;
    if (p >= 1) return 1;
    let t = p;
    for (let i = 0; i < 8; i++) {
      const err = sx(t) - p;
      if (Math.abs(err) < 1e-7) break;
      const d = dx(t);
      if (Math.abs(d) < 1e-6) break;
      t -= err / d;
    }
    let lo = 0, hi = 1;
    if (Math.abs(sx(t) - p) > 1e-6) {
      t = p;
      for (let i = 0; i < 40; i++) {
        const v = sx(t);
        if (Math.abs(v - p) < 1e-7) break;
        if (v < p) lo = t; else hi = t;
        t = (lo + hi) / 2;
      }
    }
    return sy(t);
  };
}

/** The same solver as browser source, emitted once into every compiled page. */
export const BEZIER_SOURCE = `function __bezier(x1,y1,x2,y2){var cx=3*x1,bx=3*(x2-x1)-cx,ax=1-cx-bx,cy=3*y1,by=3*(y2-y1)-cy,ay=1-cy-by;function sx(t){return((ax*t+bx)*t+cx)*t}function sy(t){return((ay*t+by)*t+cy)*t}function dx(t){return(3*ax*t+2*bx)*t+cx}return function(p){if(p<=0)return 0;if(p>=1)return 1;var t=p,i;for(i=0;i<8;i++){var e=sx(t)-p;if(Math.abs(e)<1e-7)break;var d=dx(t);if(Math.abs(d)<1e-6)break;t-=e/d}if(Math.abs(sx(t)-p)>1e-6){var lo=0,hi=1;t=p;for(i=0;i<40;i++){var v=sx(t);if(Math.abs(v-p)<1e-7)break;if(v<p)lo=t;else hi=t;t=(lo+hi)/2}}return sy(t)}}`;

/** Time (seconds from the element's entrance start) when an entrance has fully settled. */
export function entranceEnd(name: EntranceName): number {
  return ENTRANCES[name].duration;
}

// ---------- the motion library (styles and presets beyond Calm) ----------

/** Slide distance in px at 1080p (from the reading start side). Never more than 40. */
export const SLIDE = 32;
export const MAX_SLIDE = 40;
/** Settle starts at this scale. Scale stays within 0.94 to 1. */
export const SETTLE_SCALE = 0.96;
export const MIN_SCALE = 0.94;
export const NEW_ENTRANCE_SECONDS = { slide: 0.6, mask: 0.6, settle: 0.7, fade: DURATION.medium, fadeLong: DURATION.long } as const;
/** Mask: the outer block fades from the floor to full over this time while the inner block rises into view. */
export const MASK_FADE = 0.1;

/** Word by word: each word fades and rises this far (px at 1080p), over this time, this far apart. */
export const WORDS = { rise: 8, duration: 0.4, stagger: 0.06 } as const;
/** Underline: drawn over this time, starting this long after the headline settles. */
export const UNDERLINE = { duration: 0.5, delay: 0.15, gap: 0.12 } as const;
/** Highlight fade: the text-coloured copy over the key words fades out over this time after the headline settles. */
export const EMPHASIS_FADE = { duration: 0.5, delay: 0.15 } as const;
/** Count up: the digits roll to the number over this time. */
export const COUNT_SECONDS = 1.2;
/** Grow: circles scale from this size over this time. Drift: circles move this far (px at 1080p) each way. */
export const GROW = { scale: 0.94, duration: 0.8 } as const;
export const SHAPE_DRIFT = 6;

/** How long each style's entrances take, as a share of the house durations (never under 0.4 s). */
export const STYLE_DURATION_SCALE = { calm: 1, crisp: 0.85, lively: 1, still: 1 } as const;
export const STYLE_STAGGER = { calm: STAGGER, crisp: 0.05, lively: STAGGER, still: STAGGER } as const;
