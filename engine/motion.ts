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
 * Transitions between scenes. Both use the house curve. A crossfade lasts config timing.crossfade (0.5 s),
 * a wipe timing.wipe (0.8 s), so its edge never moves faster than about 210 px a frame.
 * - crossfade: the next scene fades in over the last one (opacity only).
 * - wipe: the next scene is revealed from left to right behind a wide, soft edge. Nothing on screen moves:
 *   a masked wrapper slides in while the scene inside it slides the same distance the other way (transform only).
 * The engine picks one per cut (engine/transitions.ts). A spec never chooses.
 */
export const TRANSITIONS = ["crossfade", "wipe"] as const;
export type TransitionName = (typeof TRANSITIONS)[number];

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
