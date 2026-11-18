// The compiler: spec + timeline + brand -> one HyperFrames composition per format.
// This is the only code that writes HTML. Scenes supply markup and per-format layout CSS;
// the compiler adds brand tokens, timing attributes, captions, audio and the GSAP timeline.
import fs from "node:fs";
import path from "node:path";
import { loadConfig, getFormat, type FormatConfig, type FormatId } from "./config";
import { brandCss, brandAssetName, fontAssetName, fontLoadList, schemeClass, inspectBrand, type LoadedBrand } from "./brand";
import { getScene, type AnyScene, type Rect, type SceneContext } from "./scenes";
import { TYPE_CLASSES, SHARED_SCENE_CSS, keepTogether } from "./scenes/common";
import {
  HOUSE_CURVE,
  SLIDE_CURVE,
  BEZIER_SOURCE,
  MAX_RISE,
  MAX_SLIDE,
  MIN_SCALE,
  DRIFT,
  RASTER_FLOOR_OPACITY,
  MASK_FADE,
  WORDS,
  UNDERLINE,
  EMPHASIS_FADE,
  COUNT_SECONDS,
  GROW,
  SHAPE_DRIFT,
} from "./motion";
import { resolveMotion, type SceneMotionPlan, type MotionFixed } from "./motion-plan";
import { assignSchemes, bookendScheme } from "./schemes";
import type { TextEffectId } from "./motion-rules";
import { transitionCss, wipeDistance, sceneTransitionSeconds } from "./transitions";
import { resolvePhoto, resolveClip, displayPhoto, coverPlacement, MediaError, type ResolvedMedia } from "./media";
import { contrastRatio, resolveRef, isHex, NON_TEXT } from "./colour-core";
import type { Scheme } from "./schema";
import { resolveIcon, missingIconMessage } from "./icons";
import { escapeHtml, withEmphasis } from "./text";
import { GSAP_FILE } from "./paths";
import type { Spec } from "./spec";
import { sceneId } from "./spec";
import type { Timeline, IconRef } from "./schema";

export interface CompileIssue {
  level: "error" | "warning";
  scene?: string;
  message: string;
}

export interface CompiledPage {
  format: FormatId;
  html: string;
  /** Files to copy next to index.html: build-relative path -> absolute source path. */
  assets: Record<string, string>;
  issues: CompileIssue[];
}

export function contentRect(f: FormatConfig): Rect {
  const s = f.safe;
  return {
    x: s.left,
    y: s.top,
    w: f.width - s.left - s.right,
    h: f.height - s.top - s.bottom - f.captionBand - f.captionGap,
  };
}

export function captionRect(f: FormatConfig): Rect {
  const s = f.safe;
  return { x: s.left, y: f.height - s.bottom - f.captionBand, w: f.width - s.left - s.right, h: f.captionBand };
}

const FORBIDDEN_IN_SCENE_CSS: Array<[RegExp, string]> = [
  [/#[0-9a-fA-F]{3,8}\b/, "a hard-coded hex colour"],
  [/\brgba?\(/, "a hard-coded rgb colour"],
  [/\bhsla?\(/, "a hard-coded hsl colour"],
  [/font-family\s*:\s*(?!var\()/, "a hard-coded font family"],
  [/font-size\s*:\s*(?!var\()(?!calc\(var)/, "a hard-coded font size"],
  [/\btransition\s*:/, "a CSS transition (motion belongs to motion.ts)"],
  [/\banimation\s*:/, "a CSS animation (motion belongs to motion.ts)"],
  [/--(dark|light|tint)-(bg|text|accent)\b/, "a version 1 surface variable (use --bg, --fg, --hl, --shape and --icon)"],
];

/** Scene CSS may only use brand tokens. Returns problems found. */
export function checkSceneCss(css: string): string[] {
  const out: string[] = [];
  for (const [re, what] of FORBIDDEN_IN_SCENE_CSS) if (re.test(css)) out.push(`Scene CSS uses ${what}. Use var(--token) values only.`);
  return out;
}

interface PlannedBuildElement {
  domId: string;
  role: string;
  slot?: string;
  order: number;
  kind: SceneMotionPlan["elements"][number]["kind"];
  dx: number;
  dy: number;
  scale: number;
  duration: number;
  delay: number;
}

interface SceneBuild {
  id: string;
  def: AnyScene;
  html: string;
  css: string;
  scheme: string;
  elements: PlannedBuildElement[];
  /** A video scene's clip and where it sits. */
  clip?: { media: ResolvedMedia; rect: Rect; above: boolean };
  /** True when the scene has photos with the slow drift. */
  drift: boolean;
  /** Underline bars and highlight-fade overlays: DOM id and share of the run (by characters). */
  marks: Array<{ id: string; run: number; share: number }>;
  /** Count-up digit columns: DOM id and target digit. */
  digits: Array<{ id: string; digit: number }>;
}

interface BuildOptions {
  scheme: string;
  plan?: SceneMotionPlan;
  still?: boolean;
}

/**
 * Key words, decorated for a text effect. Works on the escaped HTML from withEmphasis and keepTogether: only text
 * between tags changes, never a tag.
 * - words: every word in <span class="ww"> (inline-block, no padding, so lines break where they did).
 * - underline: every key word in <span class="uw"> (inline-block, so its bar keeps to its word) with its bar <i class="ul">.
 * - emphasis: every key word in <span class="ew"> with a text-coloured copy <span class="eo"> on top.
 */
function decorate(html: string, effect: TextEffectId, prefix: string, marks: SceneBuild["marks"]): string {
  if (effect !== "words" && effect !== "underline" && effect !== "emphasis") return html;
  const parts = html.split(/(<[^>]*>)/);
  const stack: boolean[] = [];
  let run = -1;
  let k = 0;
  // Collect key-word tokens per run first, so the last word of each run is known.
  type Tok = { part: number; text: string; em: boolean; run: number };
  const toks: Tok[] = [];
  parts.forEach((p, i) => {
    if (p.startsWith("<")) {
      if (/^<span\b/.test(p)) {
        const em = /\bclass="em"/.test(p);
        if (em) run++;
        stack.push(em);
      } else if (/^<\/span>/.test(p)) stack.pop();
      return;
    }
    const inEm = stack.includes(true);
    for (const w of p.split(/(\s+)/)) if (w && !/^\s+$/.test(w)) toks.push({ part: i, text: w, em: inEm, run: inEm ? run : -1 });
  });
  const runChars = new Map<number, number>();
  for (const t of toks) if (t.em) runChars.set(t.run, (runChars.get(t.run) ?? 0) + t.text.length);
  let j = 0;
  return parts
    .map((p) => {
      if (p.startsWith("<")) return p;
      return p
        .split(/(\s+)/)
        .map((w) => {
          if (!w || /^\s+$/.test(w)) return w;
          const t = toks[j++];
          if (effect === "words") return `<span class="ww">${w}</span>`;
          if (!t.em) return w;
          const id = `${prefix}-m${k++}`;
          marks.push({ id, run: t.run, share: t.text.length / Math.max(1, runChars.get(t.run) ?? 1) });
          // One bar per word: a bar joined across the space would hang past the end of a line where the run wraps.
          if (effect === "underline") return `<span class="uw">${w}<i class="ul" id="${id}" aria-hidden="true"></i></span>`;
          return `<span class="ew">${w}<span class="eo" id="${id}" aria-hidden="true">${w}</span></span>`;
        })
        .join("");
    })
    .join("");
}

/** Wrap the inside of the element with this id (mask reveal, count up). */
function wrapInner(html: string, domId: string, wrap: (inner: string) => string): string {
  const open = new RegExp(`<([a-z0-9]+)\\b[^>]*\\bid="${domId}"[^>]*>`);
  const m = open.exec(html);
  if (!m) return html;
  const tag = m[1];
  const start = m.index + m[0].length;
  const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, "g");
  re.lastIndex = start;
  let depth = 1;
  let r: RegExpExecArray | null;
  while ((r = re.exec(html))) {
    depth += r[1] ? -1 : 1;
    if (depth === 0) return html.slice(0, start) + wrap(html.slice(start, r.index)) + html.slice(r.index);
  }
  return html;
}

/** A number as digit columns that roll to their value: "£1,250" keeps £ and the comma still. */
function countMarkup(value: string, prefix: string, digits: SceneBuild["digits"]): string {
  let k = 0;
  return [...value]
    .map((ch) => {
      if (!/[0-9]/.test(ch)) return escapeHtml(ch);
      const id = `${prefix}-d${k++}`;
      digits.push({ id, digit: Number(ch) });
      return `<span class="dg"><span class="dg-i" id="${id}">${"0123456789".split("").join("<br>")}</span></span>`;
    })
    .join("");
}

function buildScene(
  def: AnyScene,
  id: string,
  slots: Record<string, unknown>,
  format: FormatConfig,
  brand: LoadedBrand,
  issues: CompileIssue[],
  assets: Record<string, string>,
  opts: BuildOptions,
): SceneBuild {
  const still = opts.still ?? false;
  const plan = opts.plan;
  const effect: TextEffectId = plan?.textEffect ?? "none";
  const marks: SceneBuild["marks"] = [];
  const digits: SceneBuild["digits"] = [];
  const media = new Map<string, ResolvedMedia | null>();
  const reported = new Set<string>();
  const report = (level: "error" | "warning", message: string) => {
    if (reported.has(message)) return;
    reported.add(message);
    issues.push({ level, scene: id, message });
  };
  const useMedia = (key: string, load: () => ResolvedMedia): ResolvedMedia | null => {
    if (media.has(key)) return media.get(key)!;
    let m: ResolvedMedia | null = null;
    try {
      m = load();
      for (const note of m.notes) report("warning", note);
    } catch (e) {
      report("error", e instanceof MediaError ? e.message : `Could not use ${key}: ${(e as Error).message}`);
    }
    media.set(key, m);
    return m;
  };
  const textEl = plan?.textElement ? `${id}-${plan.textElement}` : `${id}-text`;
  const ctx: SceneContext<Record<string, unknown>> = {
    sceneId: id,
    schemeId: opts.scheme,
    format,
    content: contentRect(format),
    brand,
    slots,
    esc: (text: string) => keepTogether(escapeHtml(text)),
    // Each scene shows key words in one place: its headline (the main text). Text effects decorate it.
    rich: (text: string, emphasis?: string[]) => decorate(keepTogether(withEmphasis(text, emphasis)), effect, textEl, marks),
    icon: (ref: IconRef) => {
      const r = resolveIcon(ref, brand);
      if (!r) {
        issues.push({ level: "error", scene: id, message: missingIconMessage(ref, brand) });
        return "";
      }
      return r.svg;
    },
    logo: (variant) => {
      const v = variant ?? brand.logoFor(opts.scheme);
      const rel = brand.brand.logo[v];
      const name = brandAssetName(rel);
      assets[name] = brand.file(rel);
      return name;
    },
    photo: (ref) =>
      useMedia(`photo:${ref.src}:${ref.focus ?? ""}`, () => {
        // A copy sized for this format, so Chrome never shrinks a large photo on the GPU.
        const m = displayPhoto(resolvePhoto(ref, brand), format.width, format.height, DRIFT.scale);
        assets[m.asset] = m.file;
        return m;
      }),
    clip: (ref) =>
      useMedia(`clip:${ref.src}:${ref.start ?? 0}:${ref.focus ?? ""}`, () => {
        const m = resolveClip(ref, brand, loadConfig().fps);
        if (still && m.poster && m.posterAsset) assets[m.posterAsset] = m.poster;
        else assets[m.asset] = m.file;
        return m;
      }),
    still,
    issue: report,
  };
  let html = def.markup(ctx);
  const css = def.layouts[format.id](ctx);
  for (const p of checkSceneCss(css)) issues.push({ level: "error", scene: id, message: `${def.type}: ${p}` });
  const defs = def.elements(slots);
  const elements: PlannedBuildElement[] = defs.map((e, i) => {
    const p = plan?.elements[i];
    return {
      domId: `${id}-${e.id}`,
      role: e.role,
      slot: e.slot,
      order: i,
      kind: p?.kind ?? (e.entrance === "fade" || e.entrance === "fadeLong" ? "fade" : "rise"),
      dx: p?.dx ?? 0,
      dy: p?.dy ?? 0,
      scale: p?.scale ?? 1,
      duration: p?.duration ?? 0,
      delay: p?.delay ?? 0,
    };
  });
  for (const e of elements) {
    if (!html.includes(`id="${e.domId}"`)) issues.push({ level: "error", scene: id, message: `${def.type}: element ${e.domId} is listed but not in the markup.` });
  }
  if (!still) {
    for (const e of elements) if (e.kind === "mask") html = wrapInner(html, e.domId, (inner) => `<span class="mk"><span class="mk-i" id="${e.domId}-mi">${inner}</span></span>`);
    if (effect === "count" && typeof slots.value === "string" && plan?.textElement) {
      const vid = `${id}-${plan.textElement}`;
      html = wrapInner(html, vid, () => `<span class="dgv">${countMarkup(slots.value as string, vid, digits)}</span>`);
    }
  }
  let clip: SceneBuild["clip"];
  const clipRef = def.clip?.(slots);
  if (clipRef) {
    const m = ctx.clip(clipRef);
    if (m) {
      const place = def.clipLayout?.(ctx) ?? { rect: { x: 0, y: 0, w: format.width, h: format.height }, above: false };
      clip = { media: m, ...place };
    }
  }
  return { id, def, html, css, scheme: opts.scheme, elements, clip, drift: /class="[^"]*\bdrift\b/.test(html), marks, digits };
}

function baseCss(format: FormatConfig, bodyBackground: string): string {
  const c = contentRect(format);
  const cap = captionRect(format);
  return `
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:${format.width}px;height:${format.height}px;overflow:hidden;background:${bodyBackground}}
body{-webkit-font-smoothing:antialiased;text-rendering:geometricPrecision;font-kerning:normal;font-family:var(--font-body)}
#root{position:relative;width:${format.width}px;height:${format.height}px;overflow:hidden}
.scene{position:absolute;left:0;top:0;width:${format.width}px;height:${format.height}px}
.scene-inner{position:absolute;inset:0;overflow:hidden;background:var(--bg);color:var(--fg)}
.scene-inner .em{color:var(--hl);font-weight:var(--hl-weight)}
.content{position:absolute;left:${c.x}px;top:${c.y}px;width:${c.w}px;height:${c.h}px}
.anim{will-change:transform,opacity;backface-visibility:hidden}
p,h1,h2{overflow-wrap:normal;word-break:normal;hyphens:none}
svg{display:block}
${TYPE_CLASSES}
.cap{position:absolute;left:0;top:0;width:${format.width}px;height:${format.height}px;pointer-events:none}
.cap-band{position:absolute;left:${cap.x}px;top:${cap.y}px;width:${cap.w}px;height:${cap.h}px;display:flex;align-items:flex-end;justify-content:center}
.cap-box{display:inline-block;max-width:${format.captionMaxWidth}px;text-align:center;background:var(--caption-bg);color:var(--caption-text);font-family:var(--font-body);font-weight:var(--caption-weight);font-size:var(--t-caption);line-height:1.3;padding:var(--sp-1) var(--sp-3);border-radius:var(--radius);will-change:opacity;text-wrap:balance}
.font-warm{position:absolute;left:0;top:0;opacity:0;pointer-events:none;font-size:20px;white-space:nowrap}
.cap-box .w{position:relative}
.cap-box .hl{position:absolute;left:0;right:0;bottom:-0.02em;height:0.1em;border-radius:0.05em;background:var(--caption-highlight);opacity:0;will-change:opacity}
.clip-media{position:absolute;display:block;object-fit:cover}
.ww{display:inline-block;will-change:transform,opacity}
.uw,.ew{position:relative;display:inline-block}
.ul{position:absolute;left:0;right:0;bottom:0.02em;height:max(4px,0.08em);border-radius:0.04em;background:var(--underline);transform-origin:0 50%;will-change:transform}
.eo{position:absolute;left:0;top:0;color:var(--fg);white-space:nowrap;will-change:opacity}
.mk{display:block;overflow:hidden;padding-bottom:0.12em;margin-bottom:-0.12em}
.mk-i{display:block;will-change:transform}
.dg{display:inline-block;overflow:hidden;vertical-align:top}
.dg-i{display:block;will-change:transform}
${SHARED_SCENE_CSS}
${transitionCss(format)}
`;
}

/**
 * The colour of the line under the spoken word in captions. It is not text, so it needs 3 to 1 against
 * the caption box (WCAG non-text contrast). The engine picks the first that passes: each usable scheme's key-word
 * colour in brand order, then each palette colour, then the caption text colour.
 */
export function captionHighlight(brand: LoadedBrand): string {
  const bg = brand.colour(brand.brand.captions.background);
  const tries = [
    ...brand.usableSchemes().map((s) => resolveRef(brand.scheme(s.id)!.highlight, brand.brand.palette)),
    ...brand.brand.palette.colours.map((c) => c.value),
  ];
  for (const c of tries) if (c && isHex(c) && contrastRatio(c, bg) >= NON_TEXT) return c.toUpperCase();
  return brand.colour(brand.brand.captions.text);
}

function fontWarmHtml(brand: LoadedBrand): string {
  const faces = brand.brand.fonts.faces;
  const spans = faces
    .map((f) => `<span style="font-family:'${f.family}';font-weight:${f.weight};font-style:${f.style}">Aa Ŵŷ £1</span>`)
    .join("");
  return `<div class="font-warm" aria-hidden="true" data-layout-ignore>${spans}</div>`;
}

function collectFontAssets(brand: LoadedBrand, assets: Record<string, string>) {
  for (const f of brand.brand.fonts.faces) assets[fontAssetName(f.src)] = brand.file(f.src);
}

function preloadLinks(brand: LoadedBrand): string {
  return brand.brand.fonts.faces
    .filter((f) => f.src.endsWith(".woff2"))
    .map((f) => `<link rel="preload" href="${fontAssetName(f.src)}" as="font" type="font/woff2">`)
    .join("\n");
}

// Six decimals: HyperFrames counts frames as round(duration x fps) only within 0.001 frames, otherwise it rounds up.
// With four decimals, 71.96667 s became 71.9667 s, which is 4318.002 frames at 60 fps, so it rendered 4319.
const n = (v: number) => Number(v.toFixed(6));

export interface CompileOptions {
  /** Path of the voice track inside the build. Default assets/voice.wav. */
  voiceAsset?: string;
  /** Absolute path of the voice WAV to copy into the build. */
  voiceFile?: string;
  /** Leave out burned-in captions (the .srt is still written). */
  noCaptions?: boolean;
  /** Leave out the voice track (motion previews). */
  noAudio?: boolean;
}

/** Each scene's scheme: from timeline.json, or worked out now for older timelines. */
export function timelineSchemes(spec: Spec, timeline: Timeline, brand: LoadedBrand): string[] {
  if (timeline.scenes.every((s) => s.scheme && brand.scheme(s.scheme))) return timeline.scenes.map((s) => s.scheme!);
  return assignSchemes(spec, brand).scenes.map((c) => c.scheme);
}

/** The motion choices recorded in timeline.json, so the compiler matches the timing exactly. */
export function timelineFixed(timeline: Timeline): MotionFixed[] {
  return timeline.scenes.map((s) =>
    s.motionStyle ? { style: s.motionStyle, transitionIn: s.transitionIn, textEffect: s.textEffect, shape: s.shape, entrance: s.entrance, transitionColour: s.transitionColour } : { transitionIn: s.transitionIn },
  );
}

/** Compile one format of a video. */
export function compileVideo(spec: Spec, timeline: Timeline, brand: LoadedBrand, formatId: FormatId, opts: CompileOptions = {}): CompiledPage {
  const cfg = loadConfig();
  const format = getFormat(formatId);
  const issues: CompileIssue[] = [];
  const assets: Record<string, string> = {};
  assets["assets/gsap.min.js"] = GSAP_FILE;
  collectFontAssets(brand, assets);
  if (spec.scenes.length !== timeline.scenes.length) throw new Error("Timeline does not match the spec. Run the timing step again.");
  const schemes = timelineSchemes(spec, timeline, brand);
  const motion = resolveMotion(spec, brand, schemes, timelineFixed(timeline));
  const m = format.typeMultiplier;
  const px = (v: number, max: number) => Math.sign(v) * Math.round(Math.min(max, Math.abs(v)) * m);

  const scenes: SceneBuild[] = spec.scenes.map((s, i) =>
    buildScene(getScene(s.type), sceneId(s, i), s.slots as Record<string, unknown>, format, brand, issues, assets, { scheme: schemes[i], plan: motion.scenes[i] }),
  );

  const E: Array<[string, number, number, number, number, number]> = []; // entrances: selector, x, y, scale, duration, at
  const M: Array<[string, number, number]> = []; // mask reveals: inner selector, duration, at
  const X: Array<[string, number, number]> = []; // crossfades: selector, duration, at
  const W: Array<[string, string, number, number, number]> = []; // wipes: wrapper, inner, distance, duration, at
  const P: Array<[string, string, number, number, number]> = []; // pushes: outgoing wrapper, incoming wrapper, distance, duration, at
  const S: Array<[string, number, number, number]> = []; // colour sweeps: layer, duration, at, distance
  const T: Array<[string, string, number, number, number, number]> = []; // text effects: selector, kind, duration, at, stagger, distance
  const K: Array<[string, number, number, number]> = []; // count up: digit column, digit, duration, at
  const G: Array<[string, string, number, number, number]> = []; // shapes: selector, kind, duration, at, distance
  const D: Array<[string, number, number, number, number]> = []; // photo drift: selector, scale, share, duration, at
  const C: Array<[string, number, number, number, number]> = []; // caption fades: selector, from, to, duration, at
  const H: Array<[string, number, number, number]> = []; // spoken-word line: selector, on at, off at, fade
  const layers: string[] = [];
  /** Elements that move sideways or drift: painted in place, with no compositor layer. */
  const noLayer: string[] = [];

  const sceneHtml = scenes
    .map((sb, i) => {
      const t = timeline.scenes[i];
      const plan = motion.scenes[i];
      if (t.id !== sb.id) throw new Error(`Timeline scene ${t.id} does not match spec scene ${sb.id}. Run the timing step again.`);
      const enter = t.start + t.enterAt;
      const growSelf = plan.shape === "grow" ? sb.elements.find((e) => e.role === "shape")?.domId : undefined;
      for (const el of sb.elements) {
        if (el.kind === "none") continue;
        const at = n(enter + el.delay);
        if (el.kind === "mask") {
          E.push([`#${el.domId}`, 0, 0, 1, MASK_FADE, at]);
          M.push([`#${el.domId}-mi`, el.duration, at]);
          continue;
        }
        // Whole pixels, so text starts and ends on the pixel grid in every format.
        const scale = el.domId === growSelf ? 1 : Math.max(MIN_SCALE, el.scale);
        if (el.dx !== 0) noLayer.push(`#${el.domId}`);
        E.push([`#${el.domId}`, px(el.dx, MAX_SLIDE), px(el.dy, MAX_RISE), scale, el.duration, at]);
      }
      // Text effects.
      const textEl = plan.textElement ? sb.elements.find((e) => e.domId === `${sb.id}-${plan.textElement}`) : undefined;
      if (textEl) {
        const start = enter + textEl.delay;
        if (plan.textEffect === "words") T.push([`#${textEl.domId} .ww`, "words", WORDS.duration, n(start), WORDS.stagger, Math.round(WORDS.rise * m)]);
        if (plan.textEffect === "underline" || plan.textEffect === "emphasis") {
          let at = enter + plan.headlineSettled + (plan.textEffect === "underline" ? UNDERLINE.delay : EMPHASIS_FADE.delay);
          let run = -1;
          for (const mk of sb.marks) {
            if (plan.textEffect === "emphasis") {
              T.push([`#${mk.id}`, "emphasis", EMPHASIS_FADE.duration, n(at), 0, 0]);
              continue;
            }
            if (mk.run !== run && run !== -1) at += UNDERLINE.gap;
            run = mk.run;
            const d = n(UNDERLINE.duration * mk.share);
            T.push([`#${mk.id}`, "underline", d, n(at), 0, 0]);
            at += d;
          }
        }
        if (plan.textEffect === "count") for (const dg of sb.digits) K.push([`#${dg.id}`, dg.digit, COUNT_SECONDS, n(start)]);
      }
      // Shapes: the scene's own circle (a statement's icon) or the circles in its items.
      if (plan.shape !== "none") {
        const own = sb.elements.find((e) => e.role === "shape")?.domId;
        const sel = own ? `#${own}` : `#${sb.id} .ic`;
        if (plan.shape === "drift") noLayer.push(sel);
        if (plan.shape === "grow") G.push([sel, "grow", GROW.duration, n(growSelf ? enter + (sb.elements.find((e) => e.domId === growSelf)?.delay ?? 0) : enter), GROW.scale]);
        else G.push([sel, "drift", n(t.duration), n(t.start), Math.round(SHAPE_DRIFT * m)]);
      }
      const tlen = sceneTransitionSeconds(t, timeline.crossfade);
      const wipe = t.transitionIn === "wipe";
      const push = t.transitionIn === "push";
      if (t.transitionIn === "crossfade") X.push([`#${sb.id}-inner`, tlen, n(t.start)]);
      if (wipe) W.push([`#${sb.id}-wipe`, `#${sb.id}-inner`, wipeDistance(format), tlen, n(t.start)]);
      if (push && i > 0) P.push([`#${scenes[i - 1].id}-wipe`, `#${sb.id}-wipe`, format.width, tlen, n(t.start)]);
      if (t.transitionIn === "sweep") {
        const total = tlen * 2;
        const at = n(t.start - tlen);
        const colour = t.transitionColour && isHex(t.transitionColour) ? t.transitionColour : brand.colour(brand.brand.captions.background);
        S.push([`#${sb.id}-sweep`, n(total), at, format.width]);
        layers.push(`<div id="${sb.id}-sweep" class="sweep clip" data-start="${at}" data-duration="${n(total)}" data-track-index="5" style="z-index:90;--sweep:${colour}"></div>`);
      }
      if (sb.drift) D.push([`#${sb.id} .drift`, DRIFT.scale, DRIFT.share, n(t.duration), n(t.start)]);
      let video = "";
      if (sb.clip) {
        const { media: md, rect, above } = sb.clip;
        if ((md.seconds ?? 0) + 1e-3 < t.duration) {
          issues.push({ level: "error", scene: sb.id, message: `The clip ${path.basename(md.file)} has ${(md.seconds ?? 0).toFixed(1)} seconds of footage after its start point, but the scene lasts ${t.duration.toFixed(1)} seconds. Use a longer clip, an earlier start point or a shorter voiceover.` });
        }
        const place = coverPlacement(md, rect.w, rect.h).css;
        video = `<video id="${sb.id}-clip" class="clip clip-media" src="${md.asset}" muted playsinline data-start="${n(t.start)}" data-duration="${n(t.duration)}" data-media-start="${n(md.start ?? 0)}" data-track-index="4" style="left:${rect.x}px;top:${rect.y}px;width:${rect.w}px;height:${rect.h}px;${place};z-index:${10 + i}"></video>`;
        if (t.transitionIn !== "none" && t.transitionIn !== "cut") X.push([`#${sb.id}-clip`, tlen, n(t.start)]);
      }
      const wrapClass = wipe ? " wipe" : push ? " push" : "";
      const scene = `<div id="${sb.id}" class="scene clip" data-start="${n(t.start)}" data-duration="${n(t.duration)}" data-track-index="1" style="z-index:${10 + i}">
<div id="${sb.id}-wipe" class="scene-wipe${wrapClass}"><div id="${sb.id}-inner" class="scene-inner ${schemeClass(sb.scheme)}">${sb.html}</div></div>
</div>`;
      // A full-frame clip sits under its see-through scene; a boxed clip sits on top of the scene's background.
      return sb.clip && sb.clip.above ? `${scene}\n${video}` : `${video}${video ? "\n" : ""}${scene}`;
    })
    .join("\n");

  let captionHtml = "";
  if (!opts.noCaptions) {
    captionHtml = timeline.captions
      .map((c) => {
        const box = `${c.id}-box`;
        const dur = c.end - c.start;
        const fade = Math.min(cfg.captions.fade, dur / 4);
        if (c.fadeIn) C.push([`#${box}`, 0, 1, n(fade), n(c.start)]);
        if (c.fadeOut) C.push([`#${box}`, 1, 0, n(fade), n(c.end - fade)]);
        return `<div id="${c.id}" class="cap clip" data-start="${n(c.start)}" data-duration="${n(dur)}" data-track-index="2" style="z-index:100"><div class="cap-band"><span id="${box}" class="cap-box" data-fit="caption">${captionWords(c, H)}</span></div></div>`;
      })
      .join("\n");
  }

  const voiceAsset = opts.voiceAsset ?? "assets/voice.wav";
  if (opts.voiceFile) assets[voiceAsset] = opts.voiceFile;
  const audioHtml = opts.noAudio ? "" : `<audio id="voice" class="clip" src="${voiceAsset}" data-start="0" data-duration="${n(timeline.duration)}" data-track-index="3" data-volume="1"></audio>`;

  const bodyBg = brand.schemeVars(scenes[0].scheme)["--bg"];
  const css = [
    brandCss(brand, format),
    `:root{--caption-highlight:${captionHighlight(brand)}}`,
    baseCss(format, bodyBg),
    ...scenes.map((s) => s.css),
    ...(noLayer.length ? [`${noLayer.join(",")}{will-change:auto;backface-visibility:visible}`] : []),
  ].join("\n");
  const fontLoads = JSON.stringify(fontLoadList(brand));
  const arr = (name: string, a: unknown[]) => (a.length ? `var ${name} = ${JSON.stringify(a)};\n` : `var ${name} = [];\n`);

  const script = `
(function(){
${BEZIER_SOURCE}
var ease = __bezier(${HOUSE_CURVE.join(",")});
var slide = __bezier(${SLIDE_CURVE.join(",")});
try { ${fontLoads}.forEach(function(f){ document.fonts.load(f); }); } catch (e) {}
var tl = gsap.timeline({ paused: true });
var E = ${JSON.stringify(E)};
var X = ${JSON.stringify(X)};
var C = ${JSON.stringify(C)};
var W = ${JSON.stringify(W)};
var D = ${JSON.stringify(D)};
var H = ${JSON.stringify(H)};
${arr("M", M)}${arr("P", P)}${arr("S", S)}${arr("T", T)}${arr("K", K)}${arr("G", G)}E.forEach(function(e){
  // Sideways moves get no compositor layer: text on a layer moved by a fraction of a pixel sideways is rastered
  // differently by each render worker (a shimmer once settled); painted in place, every worker draws the same pixels.
  var f3 = e[1] === 0;
  var from = { opacity: ${RASTER_FLOOR_OPACITY}, force3D: f3 }, to = { opacity: 1, duration: e[4], ease: ease, force3D: f3 };
  if (e[2] > 0) { from.y = e[2]; to.y = 0; }
  if (e[1] !== 0) { from.x = e[1]; to.x = 0; }
  if (e[3] !== 1) { from.scale = e[3]; to.scale = 1; }
  tl.fromTo(e[0], from, to, e[5]);
});
M.forEach(function(m){ tl.fromTo(m[0], { yPercent: 100, force3D: true }, { yPercent: 0, duration: m[1], ease: ease, force3D: true }, m[2]); });
X.forEach(function(x){ tl.fromTo(x[0], { opacity: 0 }, { opacity: 1, duration: x[1], ease: ease }, x[2]); });
W.forEach(function(w){
  tl.fromTo(w[0], { x: -w[2], force3D: true }, { x: 0, duration: w[3], ease: ease, force3D: true }, w[4]);
  tl.fromTo(w[1], { x: w[2], force3D: true }, { x: 0, duration: w[3], ease: ease, force3D: true }, w[4]);
});
// Push moves whole scenes, whose text sits on its own layers. Chrome reuses a layer's raster when only its offset
// changes, so a fractional offset during the push left settled text drawn differently by each render worker (a
// shimmer). Whole-pixel offsets and no extra layer on the scene make every worker draw the same pixels.
var wholePx = { x: function(v){ return Math.round(parseFloat(v)) + "px"; } };
P.forEach(function(p){
  tl.fromTo(p[1], { x: p[2], force3D: false }, { x: 0, duration: p[3], ease: slide, force3D: false, modifiers: wholePx }, p[4]);
  tl.fromTo(p[0], { x: 0, force3D: false }, { x: -p[2], duration: p[3], ease: slide, force3D: false, modifiers: wholePx, immediateRender: false }, p[4]);
});
S.forEach(function(s){
  tl.fromTo(s[0], { x: -s[3], force3D: true }, { x: 0, duration: s[1] / 2, ease: slide, force3D: true }, s[2]);
  tl.fromTo(s[0], { x: 0, force3D: true }, { x: s[3], duration: s[1] / 2, ease: slide, force3D: true, immediateRender: false }, s[2] + s[1] / 2);
});
T.forEach(function(t){
  if (t[1] === "words") tl.fromTo(gsap.utils.toArray(t[0]), { opacity: ${RASTER_FLOOR_OPACITY}, y: t[5], force3D: true }, { opacity: 1, y: 0, duration: t[2], ease: ease, stagger: t[4], force3D: true }, t[3]);
  else if (t[1] === "underline") tl.fromTo(t[0], { scaleX: 0, force3D: true }, { scaleX: 1, duration: t[2], ease: "none", force3D: true }, t[3]);
  else if (t[1] === "emphasis") tl.fromTo(t[0], { opacity: 1 }, { opacity: 0, duration: t[2], ease: ease }, t[3]);
});
// Count up: each digit column is a strip of 0 to 9, one line tall, rolled to its digit in whole pixels.
var lines = {};
document.querySelectorAll(".dgv").forEach(function(v){
  var lh = Math.round(parseFloat(getComputedStyle(v).lineHeight));
  v.querySelectorAll(".dg").forEach(function(d){ d.style.height = lh + "px"; });
  v.querySelectorAll(".dg-i").forEach(function(d){ d.style.lineHeight = lh + "px"; lines[d.id] = lh; });
});
K.forEach(function(k){ var lh = lines[k[0].slice(1)] || 0; tl.fromTo(k[0], { y: 0, force3D: true }, { y: -k[1] * lh, duration: k[2], ease: ease, force3D: true }, k[3]); });
G.forEach(function(g){
  if (g[1] === "grow") tl.fromTo(g[0], { scale: g[4], force3D: true }, { scale: 1, duration: g[2], ease: ease, force3D: true }, g[3]);
  else gsap.utils.toArray(g[0]).forEach(function(el){ tl.fromTo(el, { x: -g[4], force3D: false }, { x: g[4], duration: g[2], ease: "none", force3D: false, immediateRender: false }, g[3]); });
});
D.forEach(function(d){
  gsap.utils.toArray(d[0]).forEach(function(el){
    // Pan by a share of the spare width each way, in whole pixels, so the photo never shows an edge.
    var k = Math.round(el.offsetWidth * (d[1] - 1) * d[2]);
    // No compositor layer: the photo is repainted every frame, so every render worker draws the same pixels.
    tl.fromTo(el, { scale: d[1], x: -k, force3D: false }, { scale: d[1], x: k, duration: d[3], ease: "none", force3D: false }, d[4]);
  });
});
C.forEach(function(c){ tl.fromTo(c[0], { opacity: c[1] }, { opacity: c[2], duration: c[3], ease: "none", immediateRender: false }, c[4]); });
H.forEach(function(h){
  tl.fromTo(h[0], { opacity: 0 }, { opacity: 1, duration: h[3], ease: "none", immediateRender: false }, h[1]);
  tl.fromTo(h[0], { opacity: 1 }, { opacity: 0, duration: h[3], ease: "none", immediateRender: false }, h[2]);
});
window.__timelines = window.__timelines || {};
window.__timelines["main"] = tl;
})();`;

  const html = `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=${format.width}, height=${format.height}">
<meta name="generator" content="video-assembly engine">
<title>${escapeHtml(spec.title)} (${format.label})</title>
${preloadLinks(brand)}
<script src="assets/gsap.min.js"></script>
<style>
${css}
</style>
</head>
<body>
<div id="root" data-composition-id="main" data-start="0" data-duration="${n(timeline.duration)}" data-width="${format.width}" data-height="${format.height}">
${fontWarmHtml(brand)}
${sceneHtml}${layers.length ? `\n${layers.join("\n")}` : ""}
${captionHtml}
${audioHtml}
</div>
<script>${script}
</script>
</body>
</html>
`;
  return { format: formatId, html, assets, issues };
}

export interface StillOptions {
  /** Sample caption to show in the caption band. */
  caption?: string;
  /** The colour scheme to draw the scene in: an id of the brand, or a scheme (unsaved edits). Default: the one a video would use. */
  scheme?: string | Scheme;
  /**
   * Live preview: the scheme's variables go on :root, with no scheme class, so the web app can set them in place on
   * every colour input (same-origin iframe).
   */
  live?: boolean;
  /** Text effect to lay out (word by word changes nothing visible, but the fit check lays out what the video shows). */
  textEffect?: TextEffectId;
  /** Lay key words out at the heaviest key-word weight any usable scheme uses (the text-fit check). */
  heaviest?: boolean;
}

/** The scheme a lone scene of this type is drawn in when nobody says: what a video would most likely give it. */
export function defaultSchemeFor(type: string, brand: LoadedBrand): string {
  const usable = brand.usableSchemes();
  const all = brand.brand.schemes;
  if (!usable.length) return all[0].id;
  const def = getScene(type);
  if (brand.brand.schemeUse.mode === "by-type") {
    const legacy = usable.find((s) => s.id === def.legacyScheme && (def.schemeNeed !== "bookends" || s.bookends));
    if (legacy) return legacy.id;
  }
  const bookend = bookendScheme(brand);
  if (def.schemeNeed === "bookends") return bookend?.id ?? usable[0].id;
  const middle = usable.filter((s) => s.fit !== "bookends" && (usable.length < 3 || s.id !== bookend?.id));
  const pool = middle.length ? middle : usable;
  if (def.schemeNeed === "prefer-pale") return (pool.find((s) => s.pale) ?? pool[0]).id;
  return pool[0].id;
}

/**
 * Compile one scene as a still page in its settled state (every entrance finished).
 * Used for brand previews, scheme cards and the text-fit check. No timeline, no audio.
 */
export function compileStill(
  scene: { type: string; slots: Record<string, unknown>; id?: string },
  brandIn: LoadedBrand,
  formatId: FormatId,
  opts: StillOptions = {},
): CompiledPage {
  const format = getFormat(formatId);
  const issues: CompileIssue[] = [];
  const assets: Record<string, string> = {};
  // An unsaved scheme is drawn by adding it to a copy of the brand.
  let brand = brandIn;
  let schemeId: string;
  if (opts.scheme && typeof opts.scheme === "object") {
    const draft = { ...opts.scheme, id: brand.scheme(opts.scheme.id) ? opts.scheme.id : opts.scheme.id || "preview" };
    const others = brand.brand.schemes.filter((s) => s.id !== draft.id);
    brand = withSchemes(brandIn, [...others, draft as Scheme]);
    schemeId = draft.id;
  } else schemeId = (opts.scheme as string | undefined) ?? defaultSchemeFor(scene.type, brand);
  if (!brand.scheme(schemeId)) {
    issues.push({ level: "error", message: `There is no scheme called "${schemeId}".` });
    schemeId = brand.brand.schemes[0].id;
  }
  collectFontAssets(brand, assets);
  const def = getScene(scene.type);
  const parsed = def.slots.safeParse(scene.slots);
  if (!parsed.success) {
    for (const i of parsed.error.issues) issues.push({ level: "error", message: `${scene.type}.${i.path.join(".")}: ${i.message}` });
  }
  const slots = (parsed.success ? parsed.data : scene.slots) as Record<string, unknown>;
  const effect = opts.textEffect ?? "none";
  const plan = effect !== "none" ? stillPlan(scene, brand, schemeId, effect) : undefined;
  const sb = buildScene(def, scene.id ?? "s1", slots, format, brand, issues, assets, { scheme: schemeId, plan, still: true });
  const caption = opts.caption
    ? `<div id="cap-0" class="cap" style="z-index:100"><div class="cap-band"><span id="cap-0-box" class="cap-box" data-fit="caption">${escapeHtml(opts.caption)}</span></div></div>`
    : "";
  const vars = brand.schemeVars(schemeId);
  const live = Boolean(opts.live);
  const heaviest = opts.heaviest ? Math.max(...brand.usableSchemes().map((s) => Number(s.vars["--hl-weight"]) || 0), Number(vars["--hl-weight"]) || 0) : 0;
  const css = [
    brandCss(brand, format, undefined, live ? { live: brand.scheme(schemeId) } : {}),
    `:root{--caption-highlight:${captionHighlight(brand)}}`,
    baseCss(format, live ? "var(--bg)" : vars["--bg"]),
    heaviest ? `#root .scene-inner{--hl-weight:${heaviest}}` : "",
    // Settled: highlight-fade copies have faded out.
    ".eo{opacity:0}",
    sb.css,
  ].join("\n");
  const html = `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=${format.width}, height=${format.height}">
<title>${escapeHtml(def.label)} (${format.label})</title>
${preloadLinks(brand)}
<style>
${css}
</style>
</head>
<body>
<div id="root" data-still="true" data-scene-type="${def.type}" data-format="${format.id}" data-scheme="${escapeHtml(schemeId)}" data-logo="${brand.logoFor(schemeId)}">
<div id="${sb.id}" class="scene" style="z-index:10">
<div id="${sb.id}-inner" class="scene-inner${live ? "" : ` ${schemeClass(schemeId)}`}">${sb.html}</div>
</div>
${caption}
</div>
</body>
</html>
`;
  return { format: formatId, html, assets, issues };
}

/** A minimal motion plan for a still that shows a text effect's markup (settled). */
function stillPlan(scene: { type: string; slots: Record<string, unknown> }, brand: LoadedBrand, scheme: string, effect: TextEffectId): SceneMotionPlan | undefined {
  const spec = { scenes: [{ type: scene.type, slots: scene.slots, motion: { text: effect } }] };
  const plan = resolveMotion(spec as never, brand, [scheme]).scenes[0];
  return plan.textEffect === effect ? plan : undefined;
}

/** A copy of a loaded brand with other schemes (for previews of unsaved schemes). */
function withSchemes(brand: LoadedBrand, schemes: Scheme[]): LoadedBrand {
  return inspectBrand({ ...brand.brand, schemes }, brand.dir);
}

/**
 * Caption text as one span per word, each with a thin line that shows under the word while it is spoken.
 * The line fades in and out (opacity only) and moves straight on to the next word when speech is continuous.
 */
function captionWords(c: Timeline["captions"][number], H: Array<[string, number, number, number]>): string {
  const words = c.text.split(" ");
  const timed = c.words && c.words.length === words.length ? c.words : null;
  const fade = 0.08;
  return words
    .map((w, k) => {
      if (!timed) return escapeHtml(w);
      const cur = timed[k];
      const next = timed[k + 1];
      const on = Math.max(c.start, cur.start);
      // Stay on through short pauses so the line steps from word to word instead of blinking.
      let off = next && next.start - cur.end < 0.35 ? next.start : cur.end + 0.12;
      off = Math.min(off, c.end - fade);
      if (off - on < fade * 2) return `<span class="w">${escapeHtml(w)}</span>`;
      const hid = `${c.id}-w${k}`;
      H.push([`#${hid}`, n(on), n(off), fade]);
      return `<span class="w">${escapeHtml(w)}<i class="hl" id="${hid}"></i></span>`;
    })
    .join(" ");
}

/** Write a compiled page and its assets into a folder (index.html unless a name is given). */
export function writePage(page: CompiledPage, dir: string, name = "index.html"): string {
  fs.mkdirSync(dir, { recursive: true });
  for (const [rel, src] of Object.entries(page.assets)) {
    const dest = path.join(dir, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const s = fs.statSync(src);
    if (fs.existsSync(dest)) {
      const d = fs.statSync(dest);
      if (d.size === s.size && d.mtimeMs >= s.mtimeMs) continue;
    }
    fs.copyFileSync(src, dest);
  }
  const file = path.join(dir, name);
  fs.writeFileSync(file, page.html);
  return file;
}
