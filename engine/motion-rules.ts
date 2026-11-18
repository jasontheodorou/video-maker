// The motion library as data, and the rules that keep it readable and smooth. Pure: no imports, no Node APIs,
// so the web app imports it too (through a Vite alias) and shows the same reasons the engine gives.
//
// Everything is a named preset. People and the brief interpreter pick names; the engine owns every duration,
// distance and curve (engine/motion.ts). See docs/design/studio-spec.md, section 5.

export const MOTION_STYLES = ["calm", "crisp", "lively", "still"] as const;
export type MotionStyle = (typeof MOTION_STYLES)[number];

export const ENTRANCE_IDS = ["rise", "fade", "slide", "mask", "settle"] as const;
export type EntranceId = (typeof ENTRANCE_IDS)[number];

export const TRANSITION_IDS = ["cut", "crossfade", "wipe", "push", "sweep"] as const;
export type TransitionId = (typeof TRANSITION_IDS)[number];

export const TEXT_EFFECT_IDS = ["none", "words", "underline", "emphasis", "count"] as const;
export type TextEffectId = (typeof TEXT_EFFECT_IDS)[number];

export const SHAPE_MOTION_IDS = ["none", "grow", "drift"] as const;
export type ShapeMotionId = (typeof SHAPE_MOTION_IDS)[number];

/** What an element is, so a style can move each kind of element in its own way. */
export const ELEMENT_ROLES = ["logo", "accent", "eyebrow", "headline", "body", "item", "media", "shape", "value"] as const;
export type ElementRole = (typeof ELEMENT_ROLES)[number];

/** Scene types that show a photo or a clip. Only crossfades go into or out of them. */
export const MEDIA_SCENES = ["photo", "photo-text", "video"] as const;

export const STYLES: Array<{ id: MotionStyle; label: string; line: string }> = [
  { id: "calm", label: "Calm", line: "Gentle fades and rises. Crossfades." },
  { id: "crisp", label: "Crisp", line: "Clean slides, wipes and drawn underlines." },
  { id: "lively", label: "Lively", line: "Word by word titles and colour sweeps. Still no bounce." },
  { id: "still", label: "Still", line: "Fades only. For sensitive subjects." },
];

export const ENTRANCES: Array<{ id: EntranceId; label: string; roles: ElementRole[] }> = [
  { id: "rise", label: "Rise", roles: [...ELEMENT_ROLES] },
  { id: "fade", label: "Fade", roles: [...ELEMENT_ROLES] },
  { id: "slide", label: "Slide", roles: ["headline", "body", "item", "accent", "eyebrow"] },
  { id: "mask", label: "Reveal", roles: ["headline", "body"] },
  { id: "settle", label: "Settle", roles: ["logo", "media", "shape", "value"] },
];

export const TRANSITIONS: Array<{ id: TransitionId; label: string; seconds: number; overlap: number; nextToMedia: boolean }> = [
  { id: "cut", label: "Cut", seconds: 0, overlap: 0, nextToMedia: true },
  { id: "crossfade", label: "Crossfade", seconds: 0.5, overlap: 0.5, nextToMedia: true },
  { id: "wipe", label: "Wipe", seconds: 0.8, overlap: 0.8, nextToMedia: false },
  { id: "push", label: "Push", seconds: 0.7, overlap: 0.7, nextToMedia: false },
  { id: "sweep", label: "Colour sweep", seconds: 1.0, overlap: 0.5, nextToMedia: false },
];

export const TEXT_EFFECTS: Array<{ id: TextEffectId; label: string; scenes: string[] | "any" }> = [
  { id: "none", label: "None", scenes: "any" },
  { id: "words", label: "Word by word", scenes: "any" },
  { id: "underline", label: "Underline", scenes: "any" },
  { id: "emphasis", label: "Highlight fade", scenes: "any" },
  { id: "count", label: "Count up", scenes: ["stat"] },
];

export const SHAPE_MOTIONS: Array<{ id: ShapeMotionId; label: string }> = [
  { id: "none", label: "None" },
  { id: "grow", label: "Grow" },
  { id: "drift", label: "Drift" },
];

export function isMediaScene(type: string): boolean {
  return (MEDIA_SCENES as readonly string[]).includes(type);
}

export function entranceAllowed(entrance: EntranceId, role: ElementRole): boolean {
  return ENTRANCES.find((e) => e.id === entrance)?.roles.includes(role) ?? false;
}

export function transitionInfo(id: TransitionId) {
  return TRANSITIONS.find((t) => t.id === id)!;
}

/** Most words a headline may have for the word-by-word effect. */
export const WORDS_MAX = 12;
/** Text effects need this much scene time. */
export const TEXT_EFFECT_MIN_SCENE = 2.5;
/** Text must be settled for at least this share of its time on screen. */
export const SETTLED_SHARE = 0.75;
/**
 * Fastest a transition edge may move, in px a frame at 60 fps. "About 210" (dec-002): the house wipe (0.8 s over the
 * frame plus its soft edge) peaks at 211 px in its first frame, push at about 89 and the sweep at about 113.
 */
export const MAX_EDGE_PX_PER_FRAME = 212;

/**
 * A single number that can count up: an optional £ or $, digits (with thousands commas), up to 2 decimals, and an
 * optional % or k. "1 in 4" and ranges cannot.
 */
export const COUNTABLE = /^[£$]?(\d{1,3}(,\d{3})+|\d+)(\.\d{1,2})?(%|k)?$/;

export function countable(value: string): boolean {
  return COUNTABLE.test(value.trim());
}

// ---------- rules, as plain messages (null when allowed) ----------

export interface TextEffectContext {
  sceneType: string;
  /** Words in the headline (main text) slot. */
  headlineWords: number;
  /** The scene highlights at least one word or phrase. */
  hasHighlights: boolean;
  /** The scene's scheme shows key words in a colour (emphasis colour or both). */
  emphasisColour: boolean;
  /** Stat value, for count up. */
  value?: string;
  /** Headline entrance. */
  entrance?: EntranceId;
  /** Transition into this scene. */
  transitionIn?: TransitionId | "none";
  /** Scene length in seconds, when known. */
  sceneSeconds?: number;
}

export function textEffectProblem(effect: TextEffectId, c: TextEffectContext): string | null {
  if (effect === "none") return null;
  if (c.sceneSeconds != null && c.sceneSeconds < TEXT_EFFECT_MIN_SCENE) return "This scene is too short for a text effect.";
  if (effect === "words") {
    if (c.sceneType === "stat") return "Word by word needs a headline. Use Count up on a stat.";
    if (c.headlineWords > WORDS_MAX) return "Word by word works on short titles only.";
    if (c.entrance === "mask") return "Word by word can't go with Reveal.";
    if (c.transitionIn === "push" || c.transitionIn === "sweep") return "Too much moving at once.";
  }
  if (effect === "underline") {
    if (c.sceneType === "stat") return "Underline needs highlighted words.";
    if (!c.hasHighlights) return "Underline needs at least one highlighted word.";
  }
  if (effect === "emphasis") {
    if (c.sceneType === "stat") return "Highlight fade needs highlighted words.";
    if (!c.hasHighlights) return "Highlight fade needs at least one highlighted word.";
  }
  if (effect === "count") {
    if (c.sceneType !== "stat") return "Count up works on a stat's number only.";
    if (!c.value || !countable(c.value)) return "Count up needs a single number, like 45%.";
  }
  return null;
}

/** A text effect the scheme makes pointless: dropped with a note, never an error. */
export function textEffectDropped(effect: TextEffectId, c: Pick<TextEffectContext, "emphasisColour">): string | null {
  if (effect === "emphasis" && !c.emphasisColour) return "Highlight fade needs key words in a colour. This scheme makes them bold, so the effect is left out.";
  return null;
}

export interface EntranceContext {
  role: ElementRole;
  /** Transition into the scene. */
  transitionIn?: TransitionId | "none";
  /** Text effect on this element. */
  textEffect?: TextEffectId;
}

export function entranceProblem(entrance: EntranceId, c: EntranceContext): string | null {
  if (!entranceAllowed(entrance, c.role)) {
    const label = ENTRANCES.find((e) => e.id === entrance)?.label ?? entrance;
    return `${label} can't be used on this part.`;
  }
  if (c.role === "headline" && entrance === "mask" && (c.transitionIn === "push" || c.transitionIn === "sweep")) return "Too much moving at once.";
  if (c.role === "headline" && entrance === "mask" && c.textEffect === "words") return "Word by word can't go with Reveal.";
  return null;
}

export interface TransitionContext {
  /** Scene types on each side. */
  fromType: string;
  toType: string;
  /** Scheme ids on each side. */
  fromScheme?: string;
  toScheme?: string;
  /** Background colours on each side. */
  fromBackground?: string;
  toBackground?: string;
  /** Transitions already chosen into the two scenes before this one, nearest first. */
  previous?: Array<TransitionId | "none">;
}

export function transitionProblem(t: TransitionId, c: TransitionContext): string | null {
  const media = isMediaScene(c.fromType) || isMediaScene(c.toType);
  if ((t === "push" || t === "sweep" || t === "wipe") && media) return "Next to photos or video, use a crossfade or a cut.";
  if (t === "cut" && c.fromScheme && c.fromScheme === c.toScheme) return "A cut between matching scenes looks like a glitch.";
  if (t === "sweep") {
    if (c.fromBackground && c.toBackground && c.fromBackground.toUpperCase() === c.toBackground.toUpperCase()) return "A colour sweep needs two different backgrounds.";
    if ((c.previous ?? []).slice(0, 2).includes("sweep")) return "One colour sweep in any three transitions.";
  }
  return null;
}

export interface ShapeContext {
  /** The scene draws a circle or icon tile. */
  hasShape: boolean;
  /** The scene has a panning photo. */
  hasPhotoPan: boolean;
}

export function shapeProblem(s: ShapeMotionId, c: ShapeContext): string | null {
  if (s === "none") return null;
  if (!c.hasShape) return "This scene has no circle to move.";
  if (s === "drift" && c.hasPhotoPan) return "Drift can't go with a moving photo.";
  return null;
}

/** "Lively suits short videos." */
export function styleWarning(style: MotionStyle, videoSeconds: number): string | null {
  if (style === "lively" && videoSeconds > 60) return "Lively suits short videos.";
  return null;
}
