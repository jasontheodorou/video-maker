// Caption fit: will a caption chunk fit the caption box in at most captions.maxLines lines, in every format?
//
// The chunker (captions.ts) limits a chunk to about 6 words and 40 characters. That is not enough on its own:
// a web address such as "northvale.example/summer" cannot break inside, so "Visit northvale.example/summer
// for more." (40 characters) takes 3 lines in portrait. This module measures each word with the brand's real
// caption font (fontkit, the same file Chrome loads) and simulates the line wrap, so the chunker splits such a
// chunk itself. Caption fit stays an engine job, never the script writer's.
//
// The simulation is deliberately strict: a word never breaks inside (Chrome may break a web address after a
// slash; we do not count on it), and widths get a small safety margin. Lint still measures every cue in Chrome.
import fs from "node:fs";
import { loadConfig, FORMAT_IDS, type FormatId } from "./config";
import type { LoadedBrand } from "./brand";

// fontkit ships CommonJS and ES builds; require keeps tsx and tsc happy in this CommonJS project.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fontkit = require("fontkit");

/** Widths are multiplied by this before comparing with the box, to allow for small differences from Chrome. */
const SAFETY = 1.03;

export type CaptionFits = (text: string) => boolean;

interface Box {
  format: FormatId;
  /** Font size in px. */
  size: number;
  /** Width available for text inside the caption box, in px. */
  width: number;
}

const fontCache = new Map<string, any>();

function openFont(file: string): any | null {
  if (fontCache.has(file)) return fontCache.get(file);
  let font: any = null;
  try {
    if (fs.existsSync(file)) {
      font = fontkit.openSync(file);
      if (font?.fonts) font = font.fonts[0];
    }
  } catch {
    font = null;
  }
  fontCache.set(file, font);
  return font;
}

/** The font file Chrome uses for captions: the body family at the caption weight (nearest weight if not exact). */
function captionFontFile(brand: LoadedBrand): string | null {
  const b = brand.brand;
  const family = b.fonts.body.family;
  const weight = b.captions.weight;
  const faces = b.fonts.faces.filter((f) => f.family === family && f.style !== "italic");
  if (!faces.length) return null;
  // Prefer a face whose unicode range covers basic Latin (or has no range).
  const latin = (f: (typeof faces)[number]) => !f.unicodeRange || /U\+0000-00FF/i.test(f.unicodeRange);
  const sorted = [...faces].sort((a, c) => Math.abs(a.weight - weight) - Math.abs(c.weight - weight) || Number(latin(c)) - Number(latin(a)));
  return brand.file(sorted[0].src);
}

function boxes(brand: LoadedBrand, formats: readonly FormatId[]): Box[] {
  const cfg = loadConfig();
  return formats.map((id) => {
    const f = cfg.formats[id];
    const m = f.typeMultiplier;
    const size = Math.max(cfg.minimumTextPx.caption, Math.round(brand.brand.typeScale.caption * m));
    const padX = Math.round(brand.brand.spacing.unit * 3 * m);
    const bandWidth = f.width - f.safe.left - f.safe.right;
    return { format: id, size, width: Math.min(f.captionMaxWidth, bandWidth) - 2 * padX };
  });
}

/** Number of lines a greedy wrap gives, words never broken. Balanced wrapping never needs more lines than this. */
export function wrapLines(words: number[], space: number, width: number): number {
  let lines = 1;
  let line = 0;
  for (const w of words) {
    if (line === 0) line = w;
    else if (line + space + w <= width) line += space + w;
    else {
      lines++;
      line = w;
    }
  }
  return lines;
}

/**
 * A test for caption chunks, using the brand's caption font and the caption box of each format.
 * Returns null when the font cannot be read (the chunker then keeps its word and character limits only).
 */
export function captionFitter(brand: LoadedBrand, formats: readonly FormatId[] = FORMAT_IDS): CaptionFits | null {
  const file = captionFontFile(brand);
  const font = file ? openFont(file) : null;
  if (!font) return null;
  const maxLines = loadConfig().captions.maxLines;
  const bx = boxes(brand, formats.length ? formats : FORMAT_IDS);
  const units = font.unitsPerEm as number;
  const widthCache = new Map<string, number>();
  const em = (s: string): number => {
    let v = widthCache.get(s);
    if (v == null) {
      try {
        v = (font.layout(s).advanceWidth as number) / units;
      } catch {
        v = s.length * 0.6;
      }
      widthCache.set(s, v);
    }
    return v;
  };
  const space = em(" ");
  const cache = new Map<string, boolean>();
  return (text: string) => {
    const t = text.trim();
    let ok = cache.get(t);
    if (ok != null) return ok;
    const ws = t.split(/\s+/).filter(Boolean);
    // One word alone is as good as it gets; lint reports it if it is still too wide.
    if (ws.length <= 1) ok = true;
    else {
      const widths = ws.map(em);
      ok = bx.every((b) => wrapLines(widths.map((w) => w * b.size * SAFETY), space * b.size, b.width) <= maxLines);
    }
    cache.set(t, ok);
    return ok;
  };
}
