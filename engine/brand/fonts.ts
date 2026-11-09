// Font files for brands: read what a font file is, turn text into outlines, and fetch open fonts.
// Rendering only ever reads local files. installOpenFont downloads once into brands/<id>/fonts/.
import fs from "node:fs";
import path from "node:path";
import { CACHE_DIR } from "../paths";

// fontkit ships CommonJS and ES builds; require keeps tsx and tsc happy in this CommonJS project.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fontkit = require("fontkit");

export const FONT_EXTENSIONS = [".woff2", ".woff", ".ttf", ".otf"] as const;

export interface FontFileInfo {
  family: string;
  /** Weight from the font's OS/2 table, such as 400 or 700. */
  weight: number;
  style: "normal" | "italic";
  /** Variable fonts cover a range of weights from one file. */
  variable: boolean;
  weightRange?: [number, number];
  postscriptName?: string;
  /** Characters the font lacks from the ones videos commonly need. */
  missingCharacters: string[];
  format: "woff2" | "woff" | "truetype" | "opentype";
}

/** Characters a UK public sector video is likely to need. */
const NEEDED = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.,:;!?'\"()-/&£%@’‘“”–ŵŷâêîôû";

/** Read a font file (or bytes) and say what it is. Throws a plain-English error if it is not a usable font. */
export function inspectFontFile(fileOrBytes: string | Buffer, fileName?: string): FontFileInfo {
  let font: any;
  const name = fileName ?? (typeof fileOrBytes === "string" ? path.basename(fileOrBytes) : "font");
  try {
    font = typeof fileOrBytes === "string" ? fontkit.openSync(fileOrBytes) : fontkit.create(fileOrBytes);
  } catch {
    throw new Error(`${name} is not a font file the engine can read. Use WOFF2, WOFF, TTF or OTF.`);
  }
  if (font.fonts) font = font.fonts[0]; // a collection: use the first face
  const os2 = font["OS/2"];
  const axes = font.variationAxes ?? {};
  const wght = axes.wght as { min: number; max: number; default: number } | undefined;
  const sub = String(font.subfamilyName ?? "").toLowerCase();
  const italic = (font.italicAngle ?? 0) !== 0 || /italic|oblique/.test(sub) || Boolean(os2?.fsSelection?.italic);
  // Older fonts put the weight in the family name ("Source Sans 3 Light"). Group them under one family.
  const preferred = font.getName?.("preferredFamily");
  const family = String(preferred ?? font.familyName ?? "")
    .trim()
    .replace(preferred ? /$^/ : /\s+(Hairline|Thin|ExtraLight|Extra Light|UltraLight|Light|Book|Regular|Medium|SemiBold|Semi Bold|DemiBold|Bold|ExtraBold|Extra Bold|UltraBold|Black|Heavy)$/i, "")
    .trim();
  if (!family) throw new Error(`${name} has no family name inside it, so it cannot be used.`);
  const missingCharacters: string[] = [];
  for (const ch of NEEDED) if (!font.hasGlyphForCodePoint(ch.codePointAt(0))) missingCharacters.push(ch);
  const ext = (fileName ?? (typeof fileOrBytes === "string" ? fileOrBytes : "")).toLowerCase();
  const format = ext.endsWith(".woff2") ? "woff2" : ext.endsWith(".woff") ? "woff" : ext.endsWith(".otf") ? "opentype" : "truetype";
  return {
    family,
    weight: wght ? Math.round(wght.default) : Number(os2?.usWeightClass ?? 400),
    style: italic ? "italic" : "normal",
    variable: Boolean(wght),
    weightRange: wght ? [Math.round(wght.min), Math.round(wght.max)] : undefined,
    postscriptName: font.postscriptName ?? undefined,
    missingCharacters,
    format,
  };
}

/** Lay out text as one SVG path. Used for placeholder logos, so the SVG needs no font. */
export function textToPath(fontFile: string, text: string, x: number, baseline: number, size: number): { d: string; width: number } {
  let font = fontkit.openSync(fontFile);
  if (font.fonts) font = font.fonts[0];
  const run = font.layout(text);
  const scale = size / font.unitsPerEm;
  let pen = 0;
  const parts: string[] = [];
  run.glyphs.forEach((g: any, i: number) => {
    const pos = run.positions[i];
    const ox = x + (pen + pos.xOffset) * scale;
    const oy = baseline - pos.yOffset * scale;
    let d = "";
    for (const c of g.path.commands as Array<{ command: string; args: number[] }>) {
      const a = c.args;
      const P = (ix: number) => `${(ox + a[ix] * scale).toFixed(2)} ${(oy - a[ix + 1] * scale).toFixed(2)}`;
      if (c.command === "moveTo") d += `M${P(0)}`;
      else if (c.command === "lineTo") d += `L${P(0)}`;
      else if (c.command === "quadraticCurveTo") d += `Q${P(0)} ${P(2)}`;
      else if (c.command === "bezierCurveTo") d += `C${P(0)} ${P(2)} ${P(4)}`;
      else if (c.command === "closePath") d += "Z";
    }
    parts.push(d);
    pen += pos.xAdvance;
  });
  return { d: parts.join(""), width: pen * scale };
}

// ---------- open fonts (Google Fonts and others, through Fontsource) ----------

export interface OpenFont {
  id: string;
  family: string;
  category: string;
  weights: number[];
  styles: string[];
  subsets: string[];
  variable: boolean;
  license: string;
}

const API = "https://api.fontsource.org/v1/fonts";
const LIST_CACHE = path.join(CACHE_DIR, "fontsource", "fonts.json");

async function fetchJson(url: string): Promise<any> {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`Could not reach the open font service (${res.status}). Upload the font files instead.`);
  return res.json();
}

/** Every open font on Fontsource (Google Fonts and other open licences). Cached for a week in .cache. */
export async function listOpenFonts(): Promise<OpenFont[]> {
  try {
    const st = fs.statSync(LIST_CACHE);
    if (Date.now() - st.mtimeMs < 7 * 86400_000) return JSON.parse(fs.readFileSync(LIST_CACHE, "utf8"));
  } catch {
    /* no cache yet */
  }
  const raw = (await fetchJson(API)) as any[];
  const list: OpenFont[] = raw
    .filter((f) => /OFL|Apache|UFL|MIT|CC0|GPL/i.test(String(f.license ?? "")))
    .map((f) => ({ id: f.id, family: f.family, category: f.category, weights: f.weights, styles: f.styles, subsets: f.subsets, variable: Boolean(f.variable), license: f.license }));
  fs.mkdirSync(path.dirname(LIST_CACHE), { recursive: true });
  fs.writeFileSync(LIST_CACHE, JSON.stringify(list));
  return list;
}

/** The cached open font list, if one has been downloaded. Never touches the network. */
export function cachedOpenFonts(): OpenFont[] | null {
  try {
    return JSON.parse(fs.readFileSync(LIST_CACHE, "utf8"));
  } catch {
    return null;
  }
}

/** Open fonts whose name matches, best first. Sans-serif fonts rank first because videos need plain type. */
export async function searchOpenFonts(query: string, limit = 12): Promise<OpenFont[]> {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const list = await listOpenFonts();
  const score = (f: OpenFont) => {
    const n = f.family.toLowerCase();
    let s = n === q ? 100 : n.startsWith(q) ? 60 : n.includes(q) ? 30 : 0;
    if (s && f.category === "sans-serif") s += 5;
    if (s && f.weights.includes(400) && f.weights.includes(700)) s += 3;
    return s;
  };
  return list
    .map((f) => [f, score(f)] as const)
    .filter(([, s]) => s > 0)
    .sort((a, b) => b[1] - a[1] || a[0].family.localeCompare(b[0].family))
    .slice(0, limit)
    .map(([f]) => f);
}

export interface InstalledFace {
  family: string;
  weight: number;
  style: "normal" | "italic";
  /** Path relative to the brand folder. */
  src: string;
  unicodeRange?: string;
}

/**
 * Download an open font into <brandDir>/fonts/ as WOFF2, for the weights asked for (default 400 and 700),
 * in the latin and latin-ext subsets. Returns brand.json font face entries. Writes the licence note too.
 */
export async function installOpenFont(
  brandDir: string,
  family: string,
  opts: { weights?: number[]; styles?: Array<"normal" | "italic">; subsets?: string[] } = {},
): Promise<{ family: string; faces: InstalledFace[]; license: string; missingWeights: number[] }> {
  const list = await listOpenFonts();
  const want = family.trim().toLowerCase();
  const hit = list.find((f) => f.family.toLowerCase() === want || f.id === want);
  if (!hit) {
    const close = (await searchOpenFonts(family, 3)).map((f) => f.family);
    throw new Error(`There is no open font called "${family}".${close.length ? ` Did you mean ${close.join(", ")}?` : " Upload the font files instead."}`);
  }
  const meta = await fetchJson(`${API}/${hit.id}`);
  const weights = opts.weights ?? [400, 700];
  const styles = opts.styles ?? ["normal"];
  const subsets = (opts.subsets ?? ["latin", "latin-ext"]).filter((s) => meta.subsets.includes(s));
  const dir = path.join(brandDir, "fonts");
  fs.mkdirSync(dir, { recursive: true });
  const faces: InstalledFace[] = [];
  const missingWeights: number[] = [];
  for (const w of weights) {
    const variant = meta.variants?.[String(w)];
    if (!variant) {
      missingWeights.push(w);
      continue;
    }
    for (const style of styles) {
      for (const subset of subsets) {
        const url = variant?.[style]?.[subset]?.url?.woff2;
        if (!url) continue;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Could not download ${hit.family} ${w} (${res.status}).`);
        const bytes = Buffer.from(await res.arrayBuffer());
        inspectFontFile(bytes, "download.woff2"); // refuse anything that is not a font
        const fileName = `${hit.id}-${subset}-${w}-${style}.woff2`;
        fs.writeFileSync(path.join(dir, fileName), bytes);
        faces.push({ family: hit.family, weight: w, style, src: `fonts/${fileName}`, unicodeRange: meta.unicodeRange?.[subset] });
      }
    }
  }
  if (!faces.length) throw new Error(`${hit.family} has none of the weights asked for (${weights.join(", ")}). It has ${hit.weights.join(", ")}.`);
  const note = `${hit.family}\nLicence: ${meta.license}\nSource: ${meta.source ?? "https://fontsource.org"} (through Fontsource, version ${meta.npmVersion ?? "unknown"})\nDownloaded: ${new Date().toISOString().slice(0, 10)}\n`;
  fs.writeFileSync(path.join(dir, `${hit.id}-LICENCE.txt`), note);
  return { family: hit.family, faces, license: meta.license, missingWeights };
}
