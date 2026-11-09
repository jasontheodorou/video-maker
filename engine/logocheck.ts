// Can the logo be seen on the background it is drawn on?
// Draws the logo file (SVG or PNG) with resvg and measures how much of it stands out from the background
// with a non-text contrast of at least 3 to 1 (WCAG 1.4.11). A purple logo on a purple surface passes every
// text contrast check, yet nothing of it shows; this catches that.
import fs from "node:fs";
import { Resvg } from "@resvg/resvg-js";
import { contrastRatio, toHex } from "./contrast";

/** Non-text contrast a logo needs against its background (WCAG 1.4.11). */
export const LOGO_MIN_CONTRAST = 3;
/** Under this share of the logo standing out, the logo is treated as unseen (an error). */
export const LOGO_ERROR_SHARE = 0.3;
/** Under this share, part of the logo disappears (a warning). */
export const LOGO_WARN_SHARE = 0.6;

export interface LogoVisibility {
  /** Share of the logo's drawn pixels that stand out from the background (0 to 1). */
  visibleShare: number;
  /** The colours covering most of the logo, most first, as hex. */
  mainColours: string[];
  /** True when the file drew nothing at all. */
  empty: boolean;
}

const cache = new Map<string, LogoVisibility>();

function pngSize(b: Buffer): { width: number; height: number } | null {
  if (b.length < 24 || b.readUInt32BE(0) !== 0x89504e47) return null;
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

/** SVG markup for a logo file: the SVG itself, or a PNG wrapped in an SVG image. */
function asSvg(file: string, bytes: Buffer): string | null {
  if (/\.svg$/i.test(file)) return bytes.toString("utf8");
  if (/\.png$/i.test(file)) {
    const s = pngSize(bytes);
    if (!s) return null;
    return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${s.width}" height="${s.height}"><image width="${s.width}" height="${s.height}" xlink:href="data:image/png;base64,${bytes.toString("base64")}"/></svg>`;
  }
  return null;
}

/**
 * How much of a logo file stands out from a background colour. Returns null when the file cannot be read
 * or drawn (other checks report that). Cached by file, modification time and background.
 */
export function logoVisibility(file: string, background: string): LogoVisibility | null {
  let st: fs.Stats;
  try {
    st = fs.statSync(file);
  } catch {
    return null;
  }
  const key = `${file}|${st.mtimeMs}|${st.size}|${background.toUpperCase()}`;
  const hit = cache.get(key);
  if (hit) return hit;
  let result: LogoVisibility | null = null;
  try {
    const svg = asSvg(file, fs.readFileSync(file));
    if (!svg) return null;
    // About 480 px wide is plenty to measure shares of area; keeps the check to a few milliseconds.
    // System fonts take about 200 ms to load, so they are loaded only for logos that still contain text.
    const hasText = /<text[\s>]/i.test(svg);
    const img = new Resvg(svg, { fitTo: { mode: "width", value: 480 }, background: "rgba(0,0,0,0)", font: { loadSystemFonts: hasText } }).render();
    const px = img.pixels;
    const bg = background.replace("#", "");
    const br = parseInt(bg.slice(0, 2), 16);
    const bgG = parseInt(bg.slice(2, 4), 16);
    const bb = parseInt(bg.slice(4, 6), 16);
    let ink = 0;
    let visible = 0;
    const counts = new Map<string, number>();
    const ratioCache = new Map<number, boolean>();
    for (let i = 0; i < px.length; i += 4) {
      const a = px[i + 3] / 255;
      if (a < 0.5) continue;
      ink++;
      // resvg gives premultiplied alpha: composite over the background.
      const r = Math.round(px[i] + br * (1 - a));
      const g = Math.round(px[i + 1] + bgG * (1 - a));
      const b = Math.round(px[i + 2] + bb * (1 - a));
      const packed = (r << 16) | (g << 8) | b;
      let ok = ratioCache.get(packed);
      if (ok === undefined) {
        ok = contrastRatio(toHex([r, g, b]), background) >= LOGO_MIN_CONTRAST;
        ratioCache.set(packed, ok);
      }
      if (ok) visible++;
      // Group colours coarsely so anti-aliased edges do not count as colours of their own.
      const q = toHex([Math.round(r / 16) * 16, Math.round(g / 16) * 16, Math.round(b / 16) * 16]);
      counts.set(q, (counts.get(q) ?? 0) + 1);
    }
    const mainColours = [...counts.entries()]
      .sort((x, y) => y[1] - x[1])
      .filter(([, n]) => n / Math.max(1, ink) >= 0.05)
      .slice(0, 3)
      .map(([c]) => c);
    result = { visibleShare: ink ? visible / ink : 0, mainColours, empty: ink === 0 };
  } catch {
    result = null;
  }
  if (result) cache.set(key, result);
  return result;
}
