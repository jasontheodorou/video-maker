// Pure colour maths shared by the engine and the web app (the UI imports this file through a Vite alias).
// No imports, no Node APIs: contrast (WCAG 2.x), colour difference (CIE76), tints, colour references and the
// derived values of a colour scheme. The server stays the authority; the app uses this for instant previews.

// ---------- contrast ----------

/** AAA contrast for text (WCAG 1.4.6). The engine requires it for every piece of text, at every size. */
export const AAA = 7;
export const AA = 4.5;
/**
 * Contrast with a safety margin. Video is colour-managed differently by each player: Chrome on a Mac showed the
 * demo blue #0B3B60 as #06436D, taking yellow on blue from 8.39 to 7.73 to 1. Pairs between 7 and this pass AAA
 * but get a warning ("Close to the limit").
 */
export const AAA_SAFE = 7.5;
/** Non-text contrast (WCAG 1.4.11): icons on their circle, the line under the spoken word, a logo. */
export const NON_TEXT = 3;
/** The least colour difference between key words and the text around them, so a highlight stands out. */
export const MIN_HIGHLIGHT_DIFFERENCE = 20;
/** Under this colour difference a shape (circle) can hardly be told from its background. */
export const MIN_SHAPE_DIFFERENCE = 5;
/** The near-black the engine uses when it needs a black. */
export const ENGINE_BLACK = "#0B0C0C";
export const WHITE = "#FFFFFF";

function channel(v: number): number {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function isHex(v: unknown): v is string {
  return typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);
}

export function parseHex(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error(`Not a six-digit hex colour: ${hex}`);
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function toHex([r, g, b]: [number, number, number]): string {
  return "#" + [r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("").toUpperCase();
}

/** Relative luminance (WCAG). 0 is black, 1 is white. */
export function luminance(hex: string): number {
  const [r, g, b] = parseHex(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** A ratio as people read it: rounded down to one decimal, so 6.99 never shows as 7.0. "12.9 to 1". */
export function ratioWords(ratio: number): string {
  return `${(Math.floor(ratio * 10) / 10).toFixed(1)} to 1`;
}

/** CIE Lab of an sRGB hex colour (D65). */
function lab(hex: string): [number, number, number] {
  const [r, g, b] = parseHex(hex).map(channel);
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

/**
 * How different two colours look (CIE76 distance in Lab, written ΔE). Under about 20, key words can hardly be
 * told apart from the text around them, even when both pass contrast against the background.
 */
export function colourDifference(a: string, b: string): number {
  const p = lab(a);
  const q = lab(b);
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

// ---------- HSL ----------

export function rgbToHsl([r, g, b]: [number, number, number]): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h / 6, s, l];
}

export function hslToRgb([h, s, l]: [number, number, number]): [number, number, number] {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const hue = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [hue(p, q, h + 1 / 3) * 255, hue(p, q, h) * 255, hue(p, q, h - 1 / 3) * 255];
}

/** Hue (0 to 1), saturation and lightness of a hex colour. */
export function hsl(hex: string): { h: number; s: number; l: number } {
  const [h, s, l] = rgbToHsl(parseHex(hex));
  return { h, s, l };
}

/** Distance between two hues, 0 (same) to 0.5 (opposite). */
export function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 1;
  return Math.min(d, 1 - d);
}

/** Mix a colour with white: amount 0 is the colour, 1 is white. A 10% tint is mixWithWhite(c, 0.9). */
export function mixWithWhite(hex: string, amount: number): string {
  const [r, g, b] = parseHex(hex);
  return toHex([r + (255 - r) * amount, g + (255 - g) * amount, b + (255 - b) * amount]);
}

/** Keep the hue, move lightness towards black or white until the pair reaches the target (AAA by default). */
export function suggestPassingColour(foreground: string, background: string, target = AAA): string | null {
  const [h, s, l] = rgbToHsl(parseHex(foreground));
  const bgLum = luminance(background);
  const goDarker = bgLum > 0.18;
  for (let i = 1; i <= 100; i++) {
    const nl = goDarker ? l * (1 - i / 100) : l + (1 - l) * (i / 100);
    const candidate = toHex(hslToRgb([h, s, nl]));
    if (contrastRatio(candidate, background) >= target) return candidate;
  }
  return null;
}

// ---------- palette and references ----------

export type TintStep = 100 | 25 | 10;

export interface PaletteColourLike {
  id: string;
  name: string;
  value: string;
  group: string;
  /** Make 10% and 25% tints (mixed with white). Default true. */
  tints?: boolean;
  /** Exact tint values from the guidelines, used instead of the computed mix. */
  tintValues?: { t10?: string; t25?: string };
}

export interface PaletteRulesLike {
  /** Colour ids text may use, in order of preference. */
  text?: string[];
  /** Pairs the guidelines forbid. */
  never?: Array<{ text: string; background: string }>;
  source?: string;
}

export interface PaletteLike {
  groups: Array<{ id: string; name: string }>;
  colours: PaletteColourLike[];
  rules?: PaletteRulesLike;
}

export type Emphasis = "colour" | "weight" | "both";
export type SchemeFit = "any" | "bookends" | "middle";
export type LogoChoice = "auto" | "onLight" | "onDark";

export interface SchemeLike {
  id: string;
  name: string;
  enabled?: boolean;
  background: string;
  text: string;
  highlight: string;
  shape: string;
  emphasis?: Emphasis;
  fit?: SchemeFit;
  logo?: LogoChoice;
  source?: string;
}

/** A colour reference: a palette id, optionally with a tint step ("navy", "golden.t10"). */
export function parseRef(ref: string): { base: string; step: TintStep } {
  const m = /^([a-z][a-z0-9-]{0,39})(?:\.t(10|25))?$/.exec(ref);
  if (!m) return { base: ref, step: 100 };
  return { base: m[1], step: m[2] === "10" ? 10 : m[2] === "25" ? 25 : 100 };
}

export function makeRef(base: string, step: TintStep): string {
  return step === 100 ? base : `${base}.t${step}`;
}

/** The CSS custom property name for a reference: "golden.t10" is --c-golden-t10. */
export function refVar(ref: string): string {
  const { base, step } = parseRef(ref);
  return step === 100 ? `--c-${base}` : `--c-${base}-t${step}`;
}

/** The value of one tint of a colour: the guide's exact value when given, otherwise the mix with white. */
export function tintValue(c: PaletteColourLike, step: 10 | 25): string {
  const exact = step === 10 ? c.tintValues?.t10 : c.tintValues?.t25;
  if (exact && isHex(exact)) return exact.toUpperCase();
  return mixWithWhite(c.value, step === 10 ? 0.9 : 0.75);
}

/** Hex value of a colour reference, or null when it does not resolve (unknown id, or a tint of a colour without tints). */
export function resolveRef(ref: string, palette: Pick<PaletteLike, "colours">): string | null {
  const { base, step } = parseRef(ref);
  const c = palette.colours.find((x) => x.id === base);
  if (!c || !isHex(c.value)) return null;
  if (step === 100) return c.value.toUpperCase();
  if (c.tints === false) return null;
  return tintValue(c, step);
}

/** A reference as people read it: "Golden 10%", "Navy". */
export function refName(ref: string, palette: Pick<PaletteLike, "colours">): string {
  const { base, step } = parseRef(ref);
  const c = palette.colours.find((x) => x.id === base);
  const name = c?.name ?? base;
  return step === 100 ? name : `${name} ${step}%`;
}

export interface ExpandedColour {
  ref: string;
  base: string;
  name: string;
  value: string;
  step: TintStep;
  group: string;
  /** Position of the base colour in the palette (for deterministic ordering). */
  order: number;
  /** Relative luminance. */
  L: number;
  /** HSL hue and saturation. */
  H: number;
  S: number;
}

/** Every colour of a palette, plus its 25% and 10% tints where tints are on. */
export function expandPalette(palette: Pick<PaletteLike, "colours">): ExpandedColour[] {
  const out: ExpandedColour[] = [];
  palette.colours.forEach((c, order) => {
    if (!isHex(c.value)) return;
    const steps: TintStep[] = c.tints === false ? [100] : [100, 25, 10];
    for (const step of steps) {
      const value = step === 100 ? c.value.toUpperCase() : tintValue(c, step);
      const { h, s } = hsl(value);
      out.push({ ref: makeRef(c.id, step), base: c.id, name: step === 100 ? c.name : `${c.name} ${step}%`, value, step, group: c.group, order, L: luminance(value), H: h, S: s });
    }
  });
  return out;
}

// ---------- schemes ----------

/** "dark" when white text reaches a higher contrast on the background than near-black, else "light". */
export function toneOf(background: string): "dark" | "light" {
  return contrastRatio(WHITE, background) > contrastRatio(ENGINE_BLACK, background) ? "dark" : "light";
}

export function tone(scheme: Pick<SchemeLike, "background">, palette: Pick<PaletteLike, "colours">): "dark" | "light" {
  const bg = resolveRef(scheme.background, palette);
  return bg ? toneOf(bg) : "light";
}

/** A pale background: very light, such as a 10% or 25% tint or white. */
export function isPale(background: string): boolean {
  return luminance(background) > 0.7;
}

/**
 * A strong scheme opens and closes a video well: a dark background, or a full-strength (not tint) background of a
 * saturated colour.
 */
export function strong(scheme: Pick<SchemeLike, "background">, palette: Pick<PaletteLike, "colours">): boolean {
  const bg = resolveRef(scheme.background, palette);
  if (!bg) return false;
  if (toneOf(bg) === "dark") return true;
  return parseRef(scheme.background).step === 100 && hsl(bg).s >= 0.45 && !isPale(bg);
}

/** Which logo file a scheme shows: its own choice, or by tone (the dark-background logo on dark schemes). */
export function logoVariant(scheme: Pick<SchemeLike, "background" | "logo">, palette: Pick<PaletteLike, "colours">): "onLight" | "onDark" {
  if (scheme.logo === "onLight" || scheme.logo === "onDark") return scheme.logo;
  return tone(scheme, palette) === "dark" ? "onDark" : "onLight";
}

export interface SchemeVarOptions {
  /** Font weight of key words when the scheme makes them bold. */
  emphasisWeight: number;
  /** Font weight of headings (key words in a colour-only scheme keep it). */
  headingWeight: number;
}

/** The colour values of a scheme, resolved. Null parts do not resolve. */
export function schemeColours(scheme: SchemeLike, palette: Pick<PaletteLike, "colours">) {
  return {
    bg: resolveRef(scheme.background, palette),
    fg: resolveRef(scheme.text, palette),
    hl: resolveRef(scheme.highlight, palette),
    shape: resolveRef(scheme.shape, palette),
  };
}

/** The colour icons are drawn in on the scheme's shape: the key-word colour when it reaches 3 to 1 there, else the text colour. */
export function iconColour(scheme: SchemeLike, palette: Pick<PaletteLike, "colours">): string | null {
  const c = schemeColours(scheme, palette);
  if (!c.shape) return c.hl ?? c.fg;
  if (c.hl && contrastRatio(c.hl, c.shape) >= NON_TEXT) return c.hl;
  return c.fg;
}

/**
 * The CSS variables a scheme sets on a scene: --bg --fg --hl --shape --icon --hl-weight --underline.
 * The same function feeds brandCss (renders) and the app's live previews, so they never drift apart.
 */
export function schemeVars(scheme: SchemeLike, palette: Pick<PaletteLike, "colours">, opts: SchemeVarOptions): Record<string, string> {
  const c = schemeColours(scheme, palette);
  const bg = c.bg ?? WHITE;
  const fg = c.fg ?? ENGINE_BLACK;
  const hl = c.hl ?? fg;
  const shape = c.shape ?? bg;
  const emphasis = scheme.emphasis ?? "colour";
  const icon = iconColour(scheme, palette) ?? fg;
  let underline: string;
  if (emphasis !== "weight") underline = hl;
  else underline = [shape, fg].find((x) => contrastRatio(x, bg) >= NON_TEXT) ?? fg;
  return {
    "--bg": bg,
    "--fg": fg,
    "--hl": emphasis === "weight" ? fg : hl,
    "--shape": shape,
    "--icon": icon,
    "--hl-weight": String(emphasis === "colour" ? opts.headingWeight : opts.emphasisWeight),
    "--underline": underline,
  };
}

/** A short plain description of a scheme ("Pale golden, navy text, bold key words"). */
export function describeScheme(scheme: SchemeLike, palette: Pick<PaletteLike, "colours">): string {
  const bg = resolveRef(scheme.background, palette);
  const { step } = parseRef(scheme.background);
  const bgName = refName(parseRef(scheme.background).base, palette).toLowerCase();
  const kind = !bg ? bgName : step !== 100 || isPale(bg) ? `Pale ${bgName}` : toneOf(bg) === "dark" ? `Deep ${bgName}` : bgName[0].toUpperCase() + bgName.slice(1);
  const text = `${refName(scheme.text, palette).toLowerCase()} text`;
  const emphasis = scheme.emphasis ?? "colour";
  const kw =
    emphasis === "weight" ? "bold key words" : emphasis === "both" ? `bold ${refName(scheme.highlight, palette).toLowerCase()} key words` : `${refName(scheme.highlight, palette).toLowerCase()} key words`;
  return `${kind}, ${text}, ${kw}`;
}
