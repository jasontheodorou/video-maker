// The icon library: Phosphor Icons (MIT), one family, six weights, stored in engine/icons/<weight>/<name>.svg.
// This file gives the rest of the engine (and the brief interpreter) three things:
//   - searchIcons(query): ranked icon names by meaning, with synonyms ("money", "growth", "team").
//   - checkIconName(name): whether a name exists, with "did you mean" suggestions.
//   - colourIconSvg(svg, weight, brand): brand colouring, including duotone.
// The index (index.json) is written by scripts/icons-ingest.ts. Do not edit it by hand.
import fs from "node:fs";
import path from "node:path";
import { ICONS_DIR, BRANDS_DIR } from "../paths";
import { ICON_WEIGHTS, type IconWeight } from "../schema";
import { CONCEPTS, WORD_MAP, STOP_WORDS } from "./synonyms";

export interface IconIndexEntry {
  name: string;
  /** An older name that still works. */
  alias?: string;
  weights: IconWeight[];
  tags: string[];
  categories: string[];
  /** A company logo (Phosphor's "brands" category). Left out of search unless asked for. */
  brandLogo?: boolean;
}

export interface IconIndex {
  family: string;
  source: { package: string; version: string; licence: string; url: string };
  viewBox: string;
  weights: IconWeight[];
  categories: string[];
  count: number;
  icons: IconIndexEntry[];
}

let cached: { index: IconIndex; byName: Map<string, IconIndexEntry>; byAlias: Map<string, IconIndexEntry> } | null = null;

/** The library index. Read once and kept in memory. */
export function loadIconIndex(): IconIndex {
  return lib().index;
}

function lib() {
  if (cached) return cached;
  const file = path.join(ICONS_DIR, "index.json");
  if (!fs.existsSync(file)) {
    const empty: IconIndex = { family: "none", source: { package: "", version: "", licence: "", url: "" }, viewBox: "0 0 256 256", weights: [...ICON_WEIGHTS], categories: [], count: 0, icons: [] };
    cached = { index: empty, byName: new Map(), byAlias: new Map() };
    return cached;
  }
  const index = JSON.parse(fs.readFileSync(file, "utf8")) as IconIndex;
  const byName = new Map(index.icons.map((i) => [i.name, i]));
  const byAlias = new Map(index.icons.filter((i) => i.alias).map((i) => [i.alias!, i]));
  cached = { index, byName, byAlias };
  return cached;
}

/** The library entry for a name or an old alias. */
export function iconInfo(name: string): IconIndexEntry | undefined {
  const l = lib();
  return l.byName.get(name) ?? l.byAlias.get(name);
}

/** The current library name for a name or alias, or undefined if the library does not have it. */
export function canonicalIconName(name: string): string | undefined {
  return iconInfo(name)?.name;
}

// ---------- brand icons (read straight from the folder, so this works for unsaved brands too) ----------

export interface BrandIconFile {
  name: string;
  /** Set when the file is named <name>-<weight>.svg. */
  weight?: IconWeight;
  file: string;
}

/** Client icons in a brand folder. Accepts a brand id or a folder path. */
export function brandIconFiles(brandIdOrDir: string, iconsDir?: string): BrandIconFile[] {
  const dir = brandIdOrDir.includes("/") || brandIdOrDir.includes("\\") ? path.resolve(brandIdOrDir) : path.join(BRANDS_DIR, brandIdOrDir);
  let sub = iconsDir;
  if (!sub) {
    try {
      sub = JSON.parse(fs.readFileSync(path.join(dir, "brand.json"), "utf8"))?.icons?.dir;
    } catch {
      /* no brand.json yet */
    }
  }
  const folder = path.join(dir, sub || "icons");
  if (!fs.existsSync(folder)) return [];
  const out: BrandIconFile[] = [];
  for (const f of fs.readdirSync(folder)) {
    if (!f.toLowerCase().endsWith(".svg")) continue;
    const base = f.slice(0, -4).toLowerCase();
    const m = new RegExp(`^(.+)-(${ICON_WEIGHTS.join("|")})$`).exec(base);
    if (m && !iconInfo(base)) out.push({ name: m[1], weight: m[2] as IconWeight, file: path.join(folder, f) });
    else out.push({ name: base, file: path.join(folder, f) });
  }
  return out;
}

// ---------- name checks ----------

export interface IconNameCheck {
  ok: boolean;
  /** "brand" when a client icon supplies it, "library" for Phosphor. */
  source?: "brand" | "library";
  /** Library name to use, when the name given was an old alias. */
  canonical?: string;
  message?: string;
  suggestions: string[];
}

/**
 * Check an icon name (and weight) for a brand. Client icons count; library names and aliases count.
 * When the name is unknown the message says "did you mean" with up to three suggestions.
 */
export function checkIconName(name: string, opts: { weight?: IconWeight; brand?: string } = {}): IconNameCheck {
  const brandIcons = opts.brand ? safeBrandIcons(opts.brand) : [];
  if (brandIcons.some((b) => b.name === name && (!b.weight || !opts.weight || b.weight === opts.weight))) return { ok: true, source: "brand", suggestions: [] };
  const entry = iconInfo(name);
  if (entry) {
    if (opts.weight && !entry.weights.includes(opts.weight)) {
      return { ok: false, source: "library", canonical: entry.name, suggestions: [], message: `The icon "${name}" has no ${opts.weight} weight. It has: ${entry.weights.join(", ")}.` };
    }
    return { ok: true, source: "library", canonical: entry.name, suggestions: [] };
  }
  const suggestions = suggestIconNames(name, { brand: opts.brand });
  const hint = suggestions.length ? ` Did you mean ${suggestions.map((s) => `"${s}"`).join(", ")}?` : " Use searchIcons() to find one by meaning.";
  return { ok: false, suggestions, message: `There is no icon called "${name}".${hint}` };
}

function safeBrandIcons(brand: string): BrandIconFile[] {
  try {
    return brandIconFiles(brand);
  } catch {
    return [];
  }
}

/** Close names for a misspelt or invented icon name: spelling first, then meaning. */
export function suggestIconNames(name: string, opts: { brand?: string; limit?: number } = {}): string[] {
  const limit = opts.limit ?? 3;
  const l = lib();
  const pool = new Set<string>([...l.byName.keys(), ...(opts.brand ? safeBrandIcons(opts.brand).map((b) => b.name) : [])]);
  const scored: Array<[string, number]> = [];
  const max = Math.max(2, Math.floor(name.length / 3));
  for (const cand of pool) {
    if (Math.abs(cand.length - name.length) > max) continue;
    const d = editDistance(name, cand);
    if (d <= max) scored.push([cand, d]);
  }
  scored.sort((a, b) => a[1] - b[1] || a[0].length - b[0].length || a[0].localeCompare(b[0]));
  const out = scored.map(([n]) => n);
  // Then by meaning: treat the hyphenated name as a search.
  for (const r of searchIcons(name.replace(/-/g, " "), { limit: 6, brand: opts.brand })) if (!out.includes(r.name)) out.push(r.name);
  return out.slice(0, limit);
}

function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}

// ---------- search ----------

export interface IconSearchResult {
  name: string;
  score: number;
  source: "brand" | "library";
  weights: string[];
  /** Why it matched, for people checking the choice. */
  matched: string[];
}

export interface IconSearchOptions {
  /** Most results to return. Default 12. */
  limit?: number;
  /** Only icons that have this weight. */
  weight?: IconWeight;
  /** Only icons in this category, such as "health & wellness". */
  category?: string;
  /** Include company logos (Phosphor's brands category). Default false. */
  includeBrandLogos?: boolean;
  /** Brand id or folder: its client icons are searched too, by file name, and win ties. */
  brand?: string;
}

interface Term {
  word: string;
  weight: number;
  /** Index of the query word this term came from, so coverage counts query words, not synonyms. */
  from: number;
}

const NEGATIVE_PARTS = new Set(["x", "slash", "none", "off", "minus", "dashed", "break", "broken", "low", "disconnected", "dotted"]);

function stem(w: string): string {
  if (w.length > 5 && w.endsWith("ies")) return w.slice(0, -3) + "y";
  if (w.length > 4 && /(ches|shes|sses|xes)$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  if (w.length > 5 && w.endsWith("ing")) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith("ed")) return w.slice(0, -2);
  return w;
}

function queryTerms(query: string): { words: string[]; terms: Term[]; concepts: Array<{ icons: string[]; from: number }> } {
  const words = query
    .toLowerCase()
    .replace(/&/g, " and ")
    .split(/[^a-z0-9]+/)
    .filter((w) => w && !STOP_WORDS.has(w))
    .map((w) => WORD_MAP[w] ?? w);
  const terms: Term[] = [];
  const concepts: Array<{ icons: string[]; from: number }> = [];
  const add = (word: string, weight: number, from: number) => {
    if (!word) return;
    const cur = terms.find((t) => t.word === word && t.from === from);
    if (cur) cur.weight = Math.max(cur.weight, weight);
    else terms.push({ word, weight, from });
  };
  // Two-word phrases first ("council tax", "mental health"), then single words.
  const phraseUsed = new Set<number>();
  for (let i = 0; i < words.length - 1; i++) {
    const phrase = `${words[i]} ${words[i + 1]}`;
    const c = CONCEPTS[phrase];
    if (c) {
      concepts.push({ icons: c.icons, from: i });
      concepts.push({ icons: c.icons, from: i + 1 });
      for (const s of c.words ?? []) add(s, 0.7, i);
      phraseUsed.add(i).add(i + 1);
    }
  }
  words.forEach((w, i) => {
    add(w, 1, i);
    const s = stem(w);
    if (s !== w) add(s, 0.9, i);
    const c = CONCEPTS[w] ?? CONCEPTS[s];
    if (c && !phraseUsed.has(i)) {
      concepts.push({ icons: c.icons, from: i });
      for (const syn of c.words ?? []) add(syn, 0.7, i);
    }
  });
  return { words, terms, concepts };
}

/**
 * Icons ranked by how well they match a plain-English query, such as "money", "growth",
 * "security", "team" or "bin collection". Uses names, Phosphor's tags and categories,
 * British spellings and a curated list of meanings for public sector topics.
 */
export function searchIcons(query: string, opts: IconSearchOptions = {}): IconSearchResult[] {
  const limit = opts.limit ?? 12;
  const { words, terms, concepts } = queryTerms(query);
  if (!words.length) return [];
  const l = lib();
  const results = new Map<string, IconSearchResult & { covered: Set<number> }>();

  const scoreEntry = (name: string, parts: string[], tags: string[], categories: string[], alias?: string) => {
    let score = 0;
    const covered = new Set<number>();
    const matched: string[] = [];
    const tagWords = new Set(tags.flatMap((t) => t.split(/[^a-z0-9]+/)));
    const aliasParts = alias ? alias.split("-") : [];
    for (const t of terms) {
      let s = 0;
      if (parts.includes(t.word)) s = Math.max(s, 30 + (parts[0] === t.word ? 8 : 0));
      else if (aliasParts.includes(t.word)) s = Math.max(s, 20);
      if (tags.includes(t.word)) s = Math.max(s, 22);
      else if (tagWords.has(t.word)) s = Math.max(s, 12);
      else if (t.word.length >= 4 && tags.some((tg) => tg.startsWith(t.word))) s = Math.max(s, 6);
      if (t.word.length >= 4 && !s && parts.some((p) => p.startsWith(t.word))) s = Math.max(s, 10);
      if (categories.some((c) => c.split(/[^a-z]+/).includes(t.word))) s = Math.max(s, 5);
      if (s) {
        score += s * t.weight;
        covered.add(t.from);
        matched.push(t.word);
      }
    }
    concepts.forEach((c) => {
      const rank = c.icons.indexOf(name);
      if (rank >= 0) {
        score += Math.max(18, 45 - rank * 4);
        covered.add(c.from);
        if (!matched.includes("meaning")) matched.push("meaning");
      }
    });
    if (words.join("-") === name || words.join("-") === alias) score += 100;
    if (!score) return null;
    // Favour icons that match every word of the query, and plain names over long variants.
    score *= (covered.size / words.length) ** 1.5;
    score -= (parts.length - 1) * 1.5;
    // "Off" and "broken" variants (wifi-x, bell-slash) only when the query asks for them.
    const negative = parts.filter((p) => NEGATIVE_PARTS.has(p) && !words.includes(p));
    const wantsNegative = words.some((w) => ["no", "not", "without", "off", "cancel", "stop", "lost", "broken"].includes(w));
    if (negative.length) score += (wantsNegative ? 12 : -15) * negative.length;
    return { score, covered, matched };
  };

  for (const e of l.index.icons) {
    if (e.brandLogo && !opts.includeBrandLogos) continue;
    if (opts.weight && !e.weights.includes(opts.weight)) continue;
    if (opts.category && !e.categories.includes(opts.category)) continue;
    const r = scoreEntry(e.name, e.name.split("-"), e.tags, e.categories, e.alias);
    if (r && r.score > 0) results.set(e.name, { name: e.name, score: r.score, source: "library", weights: e.weights, matched: r.matched, covered: r.covered });
  }
  if (opts.brand) {
    const byName = new Map<string, BrandIconFile[]>();
    for (const b of safeBrandIcons(opts.brand)) byName.set(b.name, [...(byName.get(b.name) ?? []), b]);
    for (const [name, files] of byName) {
      const lib = iconInfo(name);
      const r = scoreEntry(name, name.split("-"), lib?.tags ?? [], lib?.categories ?? []);
      if (!r || r.score <= 0) continue;
      const weights = files.some((f) => !f.weight) ? ["any"] : files.map((f) => f.weight!);
      // Client icons win: they replace the library icon and rank a little higher.
      results.set(name, { name, score: r.score + 15, source: "brand", weights, matched: r.matched, covered: r.covered });
    }
  }
  return [...results.values()]
    .sort((a, b) => b.score - a.score || a.name.length - b.name.length || a.name.localeCompare(b.name))
    .slice(0, limit)
    .map(({ covered: _c, ...r }) => ({ ...r, score: Math.round(r.score * 10) / 10 }));
}

// ---------- colouring ----------

export interface IconColouring {
  /** Opacity of the light layer of duotone icons. */
  duotoneOpacity: number;
  /** Colour token for the light layer. Default: the icon's own colour (currentColor). */
  duotoneColour?: string;
}

/**
 * Brand colouring for an icon SVG. Icons draw in currentColor, so the scene's CSS colour
 * (a brand token) sets the main colour. Duotone icons get their light layer at the brand's
 * duotone opacity, in the brand's duotone colour token if it names one.
 */
export function colourIconSvg(svg: string, colouring: IconColouring, opts: { tokenValue?: (name: string) => string } = {}): string {
  const op = Math.min(1, Math.max(0, colouring.duotoneOpacity));
  const fill = colouring.duotoneColour ? (opts.tokenValue ? opts.tokenValue(colouring.duotoneColour) : `var(--c-${colouring.duotoneColour})`) : null;
  return svg.replace(/\sdata-layer="secondary"/g, ` opacity="${op}"${fill ? ` fill="${fill}"` : ""}`);
}
