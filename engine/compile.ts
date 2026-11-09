// The compiler: spec + timeline + brand -> one HyperFrames composition per format.
// This is the only code that writes HTML. Scenes supply markup and per-format layout CSS;
// the compiler adds brand tokens, timing attributes, captions, audio and the GSAP timeline.
import fs from "node:fs";
import path from "node:path";
import { loadConfig, getFormat, type FormatConfig, type FormatId } from "./config";
import { brandCss, brandAssetName, fontAssetName, fontLoadList, type LoadedBrand } from "./brand";
import { getScene, type AnyScene, type Rect, type SceneContext } from "./scenes";
import { TYPE_CLASSES, SHARED_SCENE_CSS, keepTogether } from "./scenes/common";
import { ENTRANCES, HOUSE_CURVE, BEZIER_SOURCE, STAGGER, MAX_RISE, DRIFT, RASTER_FLOOR_OPACITY, type EntranceName } from "./motion";
import { transitionCss, wipeDistance, sceneTransitionSeconds } from "./transitions";
import { resolvePhoto, resolveClip, displayPhoto, coverPlacement, MediaError, type ResolvedMedia } from "./media";
import { contrastRatio } from "./contrast";
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
];

/** Scene CSS may only use brand tokens. Returns problems found. */
export function checkSceneCss(css: string): string[] {
  const out: string[] = [];
  for (const [re, what] of FORBIDDEN_IN_SCENE_CSS) if (re.test(css)) out.push(`Scene CSS uses ${what}. Use var(--token) values only.`);
  return out;
}

interface SceneBuild {
  id: string;
  def: AnyScene;
  html: string;
  css: string;
  elements: Array<{ domId: string; entrance: EntranceName; slot?: string; order: number }>;
  /** A video scene's clip and where it sits. */
  clip?: { media: ResolvedMedia; rect: Rect; above: boolean };
  /** True when the scene has photos with the slow drift. */
  drift: boolean;
}

function buildScene(
  def: AnyScene,
  id: string,
  slots: Record<string, unknown>,
  format: FormatConfig,
  brand: LoadedBrand,
  issues: CompileIssue[],
  assets: Record<string, string>,
  still = false,
): SceneBuild {
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
  const ctx: SceneContext<Record<string, unknown>> = {
    sceneId: id,
    format,
    content: contentRect(format),
    brand,
    slots,
    esc: (text: string) => keepTogether(escapeHtml(text)),
    rich: (text: string, emphasis?: string[]) => keepTogether(withEmphasis(text, emphasis)),
    icon: (ref: IconRef) => {
      const r = resolveIcon(ref, brand);
      if (!r) {
        issues.push({ level: "error", scene: id, message: missingIconMessage(ref, brand) });
        return "";
      }
      return r.svg;
    },
    logo: (variant) => {
      const rel = brand.brand.logo[variant];
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
  const html = def.markup(ctx);
  const css = def.layouts[format.id](ctx);
  for (const p of checkSceneCss(css)) issues.push({ level: "error", scene: id, message: `${def.type}: ${p}` });
  const elements = def.elements(slots).map((e, i) => ({ domId: `${id}-${e.id}`, entrance: e.entrance, slot: e.slot, order: i }));
  for (const e of elements) {
    if (!html.includes(`id="${e.domId}"`)) issues.push({ level: "error", scene: id, message: `${def.type}: element ${e.domId} is listed but not in the markup.` });
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
  return { id, def, html, css, elements, clip, drift: /class="[^"]*\bdrift\b/.test(html) };
}

function baseCss(format: FormatConfig): string {
  const c = contentRect(format);
  const cap = captionRect(format);
  return `
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:${format.width}px;height:${format.height}px;overflow:hidden;background:var(--dark-bg)}
body{-webkit-font-smoothing:antialiased;text-rendering:geometricPrecision;font-kerning:normal;font-family:var(--font-body)}
#root{position:relative;width:${format.width}px;height:${format.height}px;overflow:hidden}
.scene{position:absolute;left:0;top:0;width:${format.width}px;height:${format.height}px}
.scene-inner{position:absolute;inset:0;overflow:hidden}
.surface-dark{background:var(--dark-bg);color:var(--dark-text)}
.surface-dark .em{color:var(--dark-accent)}
.surface-light{background:var(--light-bg);color:var(--light-text)}
.surface-light .em{color:var(--light-accent)}
.surface-tint{background:var(--tint-bg);color:var(--tint-text)}
.surface-tint .em{color:var(--tint-accent)}
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
${SHARED_SCENE_CSS}
${transitionCss(format)}
`;
}

/**
 * The colour of the line under the spoken word in captions. It is not text, so it needs 3 to 1 against
 * the caption box (WCAG non-text contrast). The engine picks the first brand colour that passes:
 * the dark surface accent, the accent, the primary, then the caption text colour.
 */
export function captionHighlight(brand: LoadedBrand): string {
  const bg = brand.colour(brand.brand.captions.background);
  const tries = [brand.brand.surfaces.dark.accent, "accent", brand.brand.surfaces.light.accent, "primary", brand.brand.captions.text];
  for (const name of tries) {
    try {
      const c = brand.colour(name);
      if (contrastRatio(c, bg) >= 3) return c;
    } catch {
      /* colour not defined */
    }
  }
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
}

/** Compile one format of a video. */
export function compileVideo(spec: Spec, timeline: Timeline, brand: LoadedBrand, formatId: FormatId, opts: CompileOptions = {}): CompiledPage {
  const cfg = loadConfig();
  const format = getFormat(formatId);
  const issues: CompileIssue[] = [];
  const assets: Record<string, string> = {};
  assets["assets/gsap.min.js"] = GSAP_FILE;
  collectFontAssets(brand, assets);

  const scenes: SceneBuild[] = spec.scenes.map((s, i) => buildScene(getScene(s.type), sceneId(s, i), s.slots as Record<string, unknown>, format, brand, issues, assets));
  if (scenes.length !== timeline.scenes.length) throw new Error("Timeline does not match the spec. Run the timing step again.");

  const E: Array<[string, number, number, number]> = []; // entrances: selector, rise, duration, at
  const X: Array<[string, number, number]> = []; // crossfades: selector, duration, at
  const W: Array<[string, string, number, number, number]> = []; // wipes: wrapper, inner, distance, duration, at
  const D: Array<[string, number, number, number, number]> = []; // photo drift: selector, scale, share, duration, at
  const C: Array<[string, number, number, number, number]> = []; // caption fades: selector, from, to, duration, at
  const H: Array<[string, number, number, number]> = []; // spoken-word line: selector, on at, off at, fade

  const sceneHtml = scenes
    .map((sb, i) => {
      const t = timeline.scenes[i];
      if (t.id !== sb.id) throw new Error(`Timeline scene ${t.id} does not match spec scene ${sb.id}. Run the timing step again.`);
      for (const el of sb.elements) {
        const p = ENTRANCES[el.entrance];
        // Whole pixels, so text starts and ends on the pixel grid in every format.
        const rise = Math.round(Math.min(MAX_RISE, p.rise) * format.typeMultiplier);
        E.push([`#${el.domId}`, n(rise), p.duration, n(t.start + t.enterAt + el.order * STAGGER)]);
      }
      const wipe = t.transitionIn === "wipe";
      const tlen = sceneTransitionSeconds(t, timeline.crossfade);
      if (t.transitionIn === "crossfade") X.push([`#${sb.id}-inner`, tlen, n(t.start)]);
      if (wipe) W.push([`#${sb.id}-wipe`, `#${sb.id}-inner`, wipeDistance(format), tlen, n(t.start)]);
      if (sb.drift) D.push([`#${sb.id} .drift`, DRIFT.scale, DRIFT.share, n(t.duration), n(t.start)]);
      let video = "";
      if (sb.clip) {
        const { media: m, rect, above } = sb.clip;
        if ((m.seconds ?? 0) + 1e-3 < t.duration) {
          issues.push({ level: "error", scene: sb.id, message: `The clip ${path.basename(m.file)} has ${(m.seconds ?? 0).toFixed(1)} seconds of footage after its start point, but the scene lasts ${t.duration.toFixed(1)} seconds. Use a longer clip, an earlier start point or a shorter voiceover.` });
        }
        const place = coverPlacement(m, rect.w, rect.h).css;
        video = `<video id="${sb.id}-clip" class="clip clip-media" src="${m.asset}" muted playsinline data-start="${n(t.start)}" data-duration="${n(t.duration)}" data-media-start="${n(m.start ?? 0)}" data-track-index="4" style="left:${rect.x}px;top:${rect.y}px;width:${rect.w}px;height:${rect.h}px;${place};z-index:${10 + i}"></video>`;
        if (t.transitionIn !== "none") X.push([`#${sb.id}-clip`, tlen, n(t.start)]);
      }
      const scene = `<div id="${sb.id}" class="scene clip" data-start="${n(t.start)}" data-duration="${n(t.duration)}" data-track-index="1" style="z-index:${10 + i}">
<div id="${sb.id}-wipe" class="scene-wipe${wipe ? " wipe" : ""}"><div id="${sb.id}-inner" class="scene-inner surface-${sb.def.surface}">${sb.html}</div></div>
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
  const audioHtml = `<audio id="voice" class="clip" src="${voiceAsset}" data-start="0" data-duration="${n(timeline.duration)}" data-track-index="3" data-volume="1"></audio>`;

  const css = [brandCss(brand, format), `:root{--caption-highlight:${captionHighlight(brand)}}`, baseCss(format), ...scenes.map((s) => s.css)].join("\n");
  const fontLoads = JSON.stringify(fontLoadList(brand));

  const script = `
(function(){
${BEZIER_SOURCE}
var ease = __bezier(${HOUSE_CURVE.join(",")});
try { ${fontLoads}.forEach(function(f){ document.fonts.load(f); }); } catch (e) {}
var tl = gsap.timeline({ paused: true });
var E = ${JSON.stringify(E)};
var X = ${JSON.stringify(X)};
var C = ${JSON.stringify(C)};
var W = ${JSON.stringify(W)};
var D = ${JSON.stringify(D)};
var H = ${JSON.stringify(H)};
E.forEach(function(e){
  var from = { opacity: ${RASTER_FLOOR_OPACITY}, force3D: true }, to = { opacity: 1, duration: e[2], ease: ease, force3D: true };
  if (e[1] > 0) { from.y = e[1]; to.y = 0; }
  tl.fromTo(e[0], from, to, e[3]);
});
X.forEach(function(x){ tl.fromTo(x[0], { opacity: 0 }, { opacity: 1, duration: x[1], ease: ease }, x[2]); });
W.forEach(function(w){
  tl.fromTo(w[0], { x: -w[2], force3D: true }, { x: 0, duration: w[3], ease: ease, force3D: true }, w[4]);
  tl.fromTo(w[1], { x: w[2], force3D: true }, { x: 0, duration: w[3], ease: ease, force3D: true }, w[4]);
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
${sceneHtml}
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
}

/**
 * Compile one scene as a still page in its settled state (every entrance finished).
 * Used for brand previews and the text-fit check. No timeline, no audio.
 */
export function compileStill(
  scene: { type: string; slots: Record<string, unknown>; id?: string },
  brand: LoadedBrand,
  formatId: FormatId,
  opts: StillOptions = {},
): CompiledPage {
  const format = getFormat(formatId);
  const issues: CompileIssue[] = [];
  const assets: Record<string, string> = {};
  collectFontAssets(brand, assets);
  const def = getScene(scene.type);
  const parsed = def.slots.safeParse(scene.slots);
  if (!parsed.success) {
    for (const i of parsed.error.issues) issues.push({ level: "error", message: `${scene.type}.${i.path.join(".")}: ${i.message}` });
  }
  const slots = (parsed.success ? parsed.data : scene.slots) as Record<string, unknown>;
  const sb = buildScene(def, scene.id ?? "s1", slots, format, brand, issues, assets, true);
  const caption = opts.caption
    ? `<div id="cap-0" class="cap" style="z-index:100"><div class="cap-band"><span id="cap-0-box" class="cap-box" data-fit="caption">${escapeHtml(opts.caption)}</span></div></div>`
    : "";
  const css = [brandCss(brand, format), `:root{--caption-highlight:${captionHighlight(brand)}}`, baseCss(format), sb.css].join("\n");
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
<div id="root" data-still="true" data-scene-type="${def.type}" data-format="${format.id}">
<div id="${sb.id}" class="scene" style="z-index:10">
<div id="${sb.id}-inner" class="scene-inner surface-${def.surface}">${sb.html}</div>
</div>
${caption}
</div>
</body>
</html>
`;
  return { format: formatId, html, assets, issues };
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
