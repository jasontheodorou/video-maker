// resolveMotion: the one place that decides how every element of a video moves. Timing (visibleFrom and
// overlaps), the compiler (the animation arrays), the contact sheet (settled times), lint and the checking
// scripts all read its answer, so they always agree.
//
// Resolution order, per scene: the scene's own motion (spec scenes[].motion) -> the video's motion style
// (spec look.motionStyle) -> the brand's motion choices -> the brand's style -> the scene's defaults.
// Calm reproduces exactly what the engine always did. Automatic choices never fail: a combination the rules refuse
// is quietly made calmer (a sweep next to a photo becomes a crossfade) and noted. Only a scene's own choice can
// fail, with a plain message.
import { loadConfig } from "./config";
import { getScene } from "./scenes";
import type { SceneElement } from "./scenes/types";
import { countWords } from "./text";
import {
  ENTRANCES,
  RISE,
  SLIDE,
  SETTLE_SCALE,
  NEW_ENTRANCE_SECONDS,
  WORDS,
  COUNT_SECONDS,
  STYLE_DURATION_SCALE,
  STYLE_STAGGER,
  type EntranceName,
} from "./motion";
import {
  entranceProblem,
  textEffectProblem,
  textEffectDropped,
  transitionProblem,
  shapeProblem,
  isMediaScene,
  entranceAllowed,
  type MotionStyle,
  type EntranceId,
  type TransitionId,
  type TextEffectId,
  type ShapeMotionId,
  type ElementRole,
} from "./motion-rules";
import { transitionSeconds, transitionOverlap, transitionLead, type TransitionIn } from "./transitions";
import { contrastRatio, resolveRef } from "./colour-core";
import type { LoadedBrand } from "./brand";

export interface PlannedElement {
  /** Element id suffix (the DOM id is `${sceneId}-${id}`). */
  id: string;
  role: ElementRole;
  slot?: string;
  text?: string;
  /** How it enters. "none": it is there from the start (its words or digits move instead). */
  kind: "rise" | "fade" | "slide" | "mask" | "settle" | "none";
  /** Start offsets in px at 1080p (the compiler scales and rounds them per format). */
  dx: number;
  dy: number;
  scale: number;
  duration: number;
  /** Seconds after the scene's enter time that the entrance starts. */
  delay: number;
  /** Seconds after the scene's enter time that this element is settled (fully readable). */
  settled: number;
}

export interface SceneMotionPlan {
  style: MotionStyle;
  elements: PlannedElement[];
  /** Entrance of the headline, for the timeline and the app. */
  entrance: EntranceId | "none";
  transition: TransitionIn;
  /** Seconds this scene overlaps the one before. */
  overlap: number;
  /** Seconds the transition lasts on screen. */
  seconds: number;
  /** Seconds before this scene starts that its transition covers the scene before (a colour sweep's first half). */
  lead: number;
  /** Colour of a colour sweep into this scene. */
  transitionColour?: string;
  textEffect: TextEffectId;
  /** The element the text effect is on. */
  textElement?: string;
  /** Seconds after the enter time that the headline settles (underline and highlight fade start after it). */
  headlineSettled: number;
  shape: ShapeMotionId;
}

export interface MotionProblem {
  /** Scene index, 0-based. */
  scene: number;
  field: "motion.entrance" | "motion.transition" | "motion.text" | "motion.shape" | "look.motionStyle";
  message: string;
}

export interface MotionPlan {
  scenes: SceneMotionPlan[];
  notes: string[];
  /** Explicit choices (a scene's own motion) the rules refuse. */
  problems: MotionProblem[];
  style: MotionStyle;
}

/** Choices already made for a scene, read back from timeline.json so the compiler matches the timing exactly. */
export interface MotionFixed {
  style?: string;
  transitionIn?: TransitionIn;
  textEffect?: string;
  shape?: string;
  entrance?: string;
  transitionColour?: string;
}

type SpecLike = {
  look?: { motionStyle?: MotionStyle };
  scenes: Array<{ type: string; slots: unknown; motion?: { entrance?: EntranceId; transition?: TransitionId; text?: TextEffectId; shape?: ShapeMotionId } }>;
};

const ENTRANCE_LABEL: Record<EntranceId, string> = { rise: "Rise", fade: "Fade", slide: "Slide", mask: "Reveal", settle: "Settle" };

/** The entrance a style gives each role. "calm": the element's own house preset. */
const STYLE_ENTRANCES: Record<MotionStyle, Partial<Record<ElementRole, EntranceId | "calm">>> = {
  calm: {},
  crisp: { headline: "slide", body: "fade", item: "slide", accent: "fade", eyebrow: "fade", logo: "fade", media: "fade", shape: "fade", value: "fade" },
  lively: { headline: "calm", body: "slide", item: "slide", accent: "fade", eyebrow: "fade", logo: "settle", media: "settle", shape: "settle", value: "settle" },
  still: { headline: "fade", body: "fade", item: "fade", accent: "fade", eyebrow: "fade", logo: "fade", media: "fade", shape: "fade", value: "fade" },
};

function styleTextEffect(style: MotionStyle, type: string): TextEffectId {
  if (style === "crisp") return type === "stat" ? "count" : "underline";
  if (style === "lively") return type === "title" || type === "statement" ? "words" : type === "stat" ? "count" : type === "points" ? "underline" : "none";
  return "none";
}

function styleShape(style: MotionStyle): ShapeMotionId {
  return style === "crisp" || style === "lively" ? "grow" : "none";
}

/** The house (Calm) preset of an element as an entrance kind with its distances. */
function calmPreset(name: EntranceName): { kind: "rise" | "fade"; dy: number; duration: number } {
  const p = ENTRANCES[name];
  return { kind: p.rise > 0 ? "rise" : "fade", dy: p.rise, duration: p.duration };
}

function entranceFor(el: SceneElement, entrance: EntranceId | "calm", style: MotionStyle): Omit<PlannedElement, "id" | "role" | "slot" | "text" | "delay" | "settled"> {
  const calm = calmPreset(el.entrance);
  const large = el.entrance === "riseLarge" || el.entrance === "fadeLong";
  const scale = STYLE_DURATION_SCALE[style];
  const dur = (d: number) => (scale === 1 ? d : Math.max(0.4, Math.round(d * scale * 100) / 100));
  if (entrance === "calm") return { kind: calm.kind, dx: 0, dy: calm.dy, scale: 1, duration: dur(calm.duration) };
  switch (entrance) {
    case "rise":
      return calm.kind === "rise"
        ? { kind: "rise", dx: 0, dy: calm.dy, scale: 1, duration: dur(calm.duration) }
        : { kind: "rise", dx: 0, dy: RISE.small, scale: 1, duration: dur(ENTRANCES.riseSmall.duration) };
    case "fade":
      return { kind: "fade", dx: 0, dy: 0, scale: 1, duration: dur(large ? NEW_ENTRANCE_SECONDS.fadeLong : NEW_ENTRANCE_SECONDS.fade) };
    case "slide":
      return { kind: "slide", dx: -SLIDE, dy: 0, scale: 1, duration: dur(NEW_ENTRANCE_SECONDS.slide) };
    case "mask":
      return { kind: "mask", dx: 0, dy: 0, scale: 1, duration: dur(NEW_ENTRANCE_SECONDS.mask) };
    case "settle":
      return { kind: "settle", dx: 0, dy: 0, scale: SETTLE_SCALE, duration: dur(NEW_ENTRANCE_SECONDS.settle) };
  }
}

function headlineText(slots: Record<string, unknown>, els: SceneElement[]): string {
  const h = els.find((e) => e.role === "headline");
  if (!h?.slot) return "";
  const v = slots[h.slot];
  return typeof v === "string" ? v : "";
}

function isMediaType(type: string) {
  return isMediaScene(type) || Boolean(getScene(type).media);
}

/**
 * Decide every scene's motion. `schemes` gives each scene's colour scheme (engine/schemes.ts); `fixed` gives
 * choices already recorded in timeline.json. Pure: the same inputs always give the same plan.
 */
export function resolveMotion(spec: SpecLike, brand: LoadedBrand | null, schemes: Array<string | undefined> = [], fixed: Array<MotionFixed | undefined> = []): MotionPlan {
  const cfg = loadConfig();
  const brandMotion = brand?.brand.motion;
  const style: MotionStyle = (spec.look?.motionStyle ?? brandMotion?.style ?? "calm") as MotionStyle;
  const notes: string[] = [];
  const problems: MotionProblem[] = [];
  const out: SceneMotionPlan[] = [];
  const bgOf = (id: string | undefined) => {
    if (!brand || !id) return undefined;
    try {
      return brand.schemeVars(id)["--bg"];
    } catch {
      return undefined;
    }
  };
  const varsOf = (id: string | undefined) => {
    if (!brand || !id) return undefined;
    try {
      return brand.schemeVars(id);
    } catch {
      return undefined;
    }
  };
  const tones = (id: string | undefined, type: string): "dark" | "light" => {
    const st = brand && id ? brand.schemes().find((s) => s.id === id) : undefined;
    if (st) return st.tone;
    return getScene(type).legacyScheme === "dark" ? "dark" : "light";
  };

  spec.scenes.forEach((scene, i) => {
    const def = getScene(scene.type);
    const slots = scene.slots as Record<string, unknown>;
    const els = def.elements(slots);
    const own = scene.motion ?? {};
    const fx = fixed[i];
    const sceneStyle = (fx?.style as MotionStyle | undefined) ?? style;
    const schemeId = schemes[i];
    const scheme = brand && schemeId ? brand.scheme(schemeId) : undefined;
    const emphasisColour = !scheme || (scheme.emphasis ?? "colour") !== "weight";
    const hasHighlights = Array.isArray(slots.emphasis) && (slots.emphasis as unknown[]).length > 0;
    const hasShape = def.hasShape ? def.hasShape(slots) : false;
    const hasPhotoPan = isMediaType(scene.type);

    // ---- transition into this scene ----
    let transition: TransitionIn = "none";
    let transitionColour: string | undefined;
    if (i > 0) {
      const prev = spec.scenes[i - 1];
      const ctx = {
        fromType: prev.type,
        toType: scene.type,
        fromScheme: schemes[i - 1],
        toScheme: schemeId,
        fromBackground: bgOf(schemes[i - 1]),
        toBackground: bgOf(schemeId),
        previous: [out[i - 1]?.transition, out[i - 2]?.transition].filter(Boolean) as Array<TransitionId | "none">,
      };
      const media = isMediaType(prev.type) || isMediaType(scene.type);
      const toneChange = tones(schemes[i - 1], prev.type) !== tones(schemeId, scene.type);
      const auto = (): TransitionIn => {
        if (media) return "crossfade";
        const wanted: TransitionId | undefined = brandMotion?.transition;
        const byStyle = (): TransitionId => {
          if (sceneStyle === "crisp") return toneChange ? "wipe" : "cut";
          if (sceneStyle === "lively") return toneChange ? "sweep" : "push";
          if (sceneStyle === "calm") return toneChange && cfg.timing.darkLightTransition === "wipe" ? "wipe" : "crossfade";
          return "crossfade";
        };
        let t: TransitionId = wanted ?? byStyle();
        if (transitionProblem(t, ctx)) {
          // Calmer in steps: a sweep becomes a push, anything else a crossfade.
          const calmer: TransitionId = t === "sweep" && !transitionProblem("push", ctx) ? "push" : "crossfade";
          if (wanted) notes.push(`Scene ${i + 1}: ${wanted} was made calmer here (${transitionProblem(t, ctx)})`);
          t = calmer;
        }
        return t;
      };
      if (fx?.transitionIn) transition = fx.transitionIn;
      else if (own.transition) {
        const p = transitionProblem(own.transition, ctx);
        if (p) {
          problems.push({ scene: i, field: "motion.transition", message: `Scene ${i + 1}: ${p}` });
          transition = auto();
        } else transition = own.transition;
      } else transition = auto();
      if (transition === "sweep") {
        const v = varsOf(schemeId);
        const prevBg = bgOf(schemes[i - 1]);
        if (v) {
          const shape = v["--shape"];
          const nearBoth = prevBg ? contrastRatio(shape, prevBg) < 1.3 && contrastRatio(shape, v["--bg"]) < 1.3 : false;
          transitionColour = fx?.transitionColour ?? (nearBoth ? v["--bg"] : shape);
        } else transitionColour = fx?.transitionColour ?? (brand ? (resolveRef(brand.brand.captions.background, brand.brand.palette) ?? "#0B0C0C") : "#0B0C0C");
      }
    }

    // ---- text effect ----
    const words = countWords(headlineText(slots, els));
    const valueText = typeof slots.value === "string" ? (slots.value as string) : undefined;
    const effectCtx = (entrance?: EntranceId) => ({
      sceneType: scene.type,
      headlineWords: words,
      hasHighlights,
      emphasisColour,
      value: valueText,
      entrance,
      transitionIn: transition,
    });
    let textEffect: TextEffectId = "none";
    const autoEffect = (): TextEffectId => {
      const wanted = brandMotion?.textEffect;
      let e: TextEffectId = wanted && wanted !== "none" ? wanted : styleTextEffect(sceneStyle, scene.type);
      if (wanted && wanted !== "none" && textEffectProblem(wanted, effectCtx())) e = styleTextEffect(sceneStyle, scene.type);
      if (textEffectProblem(e, effectCtx())) e = "none";
      if (textEffectDropped(e, { emphasisColour })) e = "none";
      return e;
    };
    if (fx?.textEffect) textEffect = fx.textEffect as TextEffectId;
    else if (own.text) {
      const p = textEffectProblem(own.text, effectCtx(own.entrance));
      const dropped = textEffectDropped(own.text, { emphasisColour });
      if (p) {
        problems.push({ scene: i, field: "motion.text", message: `Scene ${i + 1}: ${p}` });
        textEffect = autoEffect();
      } else if (dropped) {
        notes.push(`Scene ${i + 1}: ${dropped}`);
        textEffect = "none";
      } else textEffect = own.text;
    } else textEffect = autoEffect();

    // ---- shape motion ----
    let shape: ShapeMotionId = "none";
    const shapeCtx = { hasShape, hasPhotoPan };
    if (fx?.shape) shape = fx.shape as ShapeMotionId;
    else if (own.shape) {
      const p = shapeProblem(own.shape, shapeCtx);
      if (p) problems.push({ scene: i, field: "motion.shape", message: `Scene ${i + 1}: ${p}` });
      else shape = own.shape;
    } else {
      const wanted = brandMotion?.shape ?? styleShape(sceneStyle);
      shape = shapeProblem(wanted, shapeCtx) ? "none" : wanted;
    }

    // ---- entrances ----
    const stagger = STYLE_STAGGER[sceneStyle];
    const ownEntrance = own.entrance;
    if (ownEntrance) {
      const usableHere = els.some((e) => entranceAllowed(ownEntrance, e.role) && (!e.only || e.only.includes(ownEntrance)));
      const headline = els.some((e) => e.role === "headline");
      let p: string | null = null;
      if (!usableHere) p = `${ENTRANCE_LABEL[ownEntrance]} can't be used in this scene.`;
      else if (headline && entranceAllowed(ownEntrance, "headline")) p = entranceProblem(ownEntrance, { role: "headline", transitionIn: transition, textEffect });
      if (p) problems.push({ scene: i, field: "motion.entrance", message: `Scene ${i + 1}: ${p}` });
    }
    const fixedHeadline = fx?.entrance as EntranceId | "none" | undefined;
    let headlineEntrance: EntranceId | "none" = "rise";
    let headlineSettled = 0;
    const elements: PlannedElement[] = els.map((el, order) => {
      let choice: EntranceId | "calm" = STYLE_ENTRANCES[sceneStyle][el.role] ?? "calm";
      if (brandMotion?.entrance && entranceAllowed(brandMotion.entrance, el.role)) choice = brandMotion.entrance;
      if (ownEntrance && entranceAllowed(ownEntrance, el.role)) choice = ownEntrance;
      if (el.role === "headline" && fixedHeadline && fixedHeadline !== "none") choice = fixedHeadline;
      if (el.only && choice !== "calm" && !el.only.includes(choice)) choice = "calm";
      // Calmer when too much would move at once.
      if (el.role === "headline" && choice === "mask" && (transition === "push" || transition === "sweep" || textEffect === "words")) choice = "calm";
      let plan = entranceFor(el, choice, sceneStyle);
      const delay = Math.round(order * stagger * 1000) / 1000;
      let settled = delay + plan.duration;
      if (el.role === "headline" && textEffect === "words") {
        // The words move instead of the block.
        plan = { kind: "none", dx: 0, dy: 0, scale: 1, duration: 0 };
        settled = delay + Math.max(0, words - 1) * WORDS.stagger + WORDS.duration;
      }
      if (el.role === "value" && textEffect === "count") {
        plan = { ...plan, kind: "fade", dx: 0, dy: 0, scale: 1, duration: Math.min(plan.duration, 0.4) };
        settled = delay + Math.max(plan.duration, COUNT_SECONDS);
      }
      if (el.role === "headline") {
        headlineEntrance = plan.kind === "none" ? "none" : plan.kind === "rise" ? "rise" : plan.kind;
        headlineSettled = settled;
      }
      return { id: el.id, role: el.role, slot: el.slot, text: el.text, ...plan, delay, settled: Math.round(settled * 1000) / 1000 };
    });
    if (!els.some((e) => e.role === "headline")) {
      headlineEntrance = "none";
      headlineSettled = Math.max(0, ...elements.map((e) => e.settled));
    }
    const textElement = textEffect === "count" ? els.find((e) => e.role === "value")?.id : textEffect !== "none" ? els.find((e) => e.role === "headline")?.id : undefined;

    out.push({
      style: sceneStyle,
      elements,
      entrance: headlineEntrance,
      transition,
      overlap: transitionOverlap(transition, cfg.timing),
      seconds: transitionSeconds(transition, cfg.timing),
      lead: transitionLead(transition, cfg.timing),
      transitionColour,
      textEffect,
      textElement,
      headlineSettled: Math.round(headlineSettled * 1000) / 1000,
      shape,
    });
  });
  return { scenes: out, notes: [...new Set(notes)], problems, style };
}

/** Words in a scene's headline (for the word-by-word rule and its timing). */
export function headlineWords(scene: { type: string; slots: unknown }): number {
  const def = getScene(scene.type);
  return countWords(headlineText(scene.slots as Record<string, unknown>, def.elements(scene.slots as Record<string, unknown>)));
}
