// WCAG 2.2 contrast. The engine requires AAA (7 to 1) for every piece of text, at every size.

export const AAA = 7;
export const AA = 4.5;
/**
 * Contrast with a safety margin. Video is colour-managed differently by each player: Chrome on a Mac showed the
 * demo blue #0B3B60 as #06436D, taking yellow on blue from 8.39 to 7.73 to 1. Pairs between 7 and this pass AAA
 * but get a warning.
 */
export const AAA_SAFE = 7.5;

function channel(v: number): number {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
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

export function luminance(hex: string): number {
  const [r, g, b] = parseHex(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** CIE Lab of an sRGB hex colour (D65). */
function lab(hex: string): [number, number, number] {
  const [r, g, b] = parseHex(hex).map(channel);
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

/**
 * How different two colours look (CIE76 distance in Lab). Under about 20, highlighted words can hardly be
 * told apart from the text around them, even when both pass contrast against the background.
 */
export function colourDifference(a: string, b: string): number {
  const p = lab(a);
  const q = lab(b);
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

/** The least colour difference between highlighted words and the text around them. */
export const MIN_HIGHLIGHT_DIFFERENCE = 20;

export interface ContrastResult {
  foreground: string;
  background: string;
  ratio: number;
  /** Ratio rounded down to two decimals, so 6.999 never shows as 7.00. */
  ratioText: string;
  passesAAA: boolean;
  passesAA: boolean;
  message: string;
  /** A foreground colour close to the original that passes AAA, when it fails. */
  suggestion?: string;
}

export function checkContrast(
  foreground: string,
  background: string,
  labels: { foreground?: string; background?: string } = {},
): ContrastResult {
  const ratio = contrastRatio(foreground, background);
  const ratioText = (Math.floor(ratio * 100) / 100).toFixed(2);
  const passesAAA = ratio >= AAA;
  const fg = labels.foreground ?? foreground.toUpperCase();
  const bg = labels.background ?? background.toUpperCase();
  let message: string;
  let suggestion: string | undefined;
  if (passesAAA) {
    message = `${fg} on ${bg} has a contrast of ${ratioText} to 1. This passes AAA (7 to 1).`;
  } else {
    suggestion = suggestPassingColour(foreground, background) ?? undefined;
    message =
      `${fg} on ${bg} has a contrast of ${ratioText} to 1. Text needs 7 to 1 to pass AAA. ` +
      (suggestion
        ? `Try ${suggestion} for the text, or change the background.`
        : `Use a much darker or much lighter colour for one of them.`);
  }
  return { foreground, background, ratio, ratioText, passesAAA, passesAA: ratio >= AA, message, suggestion };
}

// HSL helpers for the suggestion.
function rgbToHsl([r, g, b]: [number, number, number]): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
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
function hslToRgb([h, s, l]: [number, number, number]): [number, number, number] {
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

/** Keep the hue, move lightness towards black or white until the pair passes AAA. */
export function suggestPassingColour(foreground: string, background: string): string | null {
  const [h, s, l] = rgbToHsl(parseHex(foreground));
  const bgLum = luminance(background);
  const goDarker = bgLum > 0.18;
  for (let i = 1; i <= 100; i++) {
    const nl = goDarker ? l * (1 - i / 100) : l + (1 - l) * (i / 100);
    const candidate = toHex(hslToRgb([h, s, nl]));
    if (contrastRatio(candidate, background) >= AAA) return candidate;
  }
  return null;
}
