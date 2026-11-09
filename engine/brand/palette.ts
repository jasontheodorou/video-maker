// Colours for brands: every pair's contrast, a guess at each colour's role, and surfaces that pass AAA.
import { checkContrast, contrastRatio, colourDifference, luminance, parseHex, toHex, suggestPassingColour, AAA, MIN_HIGHLIGHT_DIFFERENCE, type ContrastResult } from "../contrast";
import { COLOUR_ROLES, OPTIONAL_COLOUR_ROLES } from "../schema";

export interface ColourToken {
  value: string;
  name?: string;
}
export type ColourSet = Record<string, ColourToken | undefined>;

export interface PairResult {
  foreground: string;
  background: string;
  result: ContrastResult;
}

/** Every text-on-background pair in a set of colours, with its AAA result. Strongest pairs first. */
export function contrastMatrix(colours: ColourSet): PairResult[] {
  const entries = Object.entries(colours).filter(([, v]) => v) as Array<[string, ColourToken]>;
  const out: PairResult[] = [];
  for (const [fg, f] of entries) {
    for (const [bg, b] of entries) {
      if (fg === bg || f.value.toUpperCase() === b.value.toUpperCase()) continue;
      out.push({ foreground: fg, background: bg, result: checkContrast(f.value, b.value, { foreground: f.name ?? fg, background: b.name ?? bg }) });
    }
  }
  return out.sort((a, b) => b.result.ratio - a.result.ratio);
}

/** For each background, the colours that can be text on it (AAA). */
export function legalTextColours(colours: ColourSet): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const p of contrastMatrix(colours)) {
    if (!p.result.passesAAA) continue;
    (out[p.background] ??= []).push(p.foreground);
  }
  return out;
}

function hsl(hex: string): { h: number; s: number; l: number } {
  const [r, g, b] = parseHex(hex).map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h /= 6;
  return { h, s, l };
}

/** Mix a colour with white: amount 0 is the colour, 1 is white. */
export function mixWithWhite(hex: string, amount: number): string {
  const [r, g, b] = parseHex(hex);
  return toHex([r + (255 - r) * amount, g + (255 - g) * amount, b + (255 - b) * amount]);
}

export interface RoleGuess {
  colours: ColourSet;
  /** Plain-English notes on each choice, and on anything made up because it was missing. */
  notes: string[];
  /** Roles that were made up, not taken from the list. */
  invented: string[];
  /** Colours from the list that were not given a role. */
  unused: ColourToken[];
}

/**
 * Give each colour in a list a role: primary, text, background, accent, tint, accent2 and line.
 * Names in the list (such as "Primary blue") are used first; otherwise the guess goes by lightness
 * and saturation. Anything missing is made up from the others and listed in `invented`.
 */
export function assignColourRoles(list: Array<{ value: string; name?: string; role?: string }>): RoleGuess {
  const notes: string[] = [];
  const invented: string[] = [];
  const pool = dedupe(list.map((c) => ({ ...c, value: normaliseHex(c.value) })).filter((c) => c.value));
  const taken = new Set<string>();
  const colours: ColourSet = {};
  const roles = [...COLOUR_ROLES, ...OPTIONAL_COLOUR_ROLES] as string[];
  const take = (role: string, c: { value: string; name?: string } | undefined, why: string) => {
    if (!c || colours[role]) return;
    colours[role] = { value: c.value, ...(c.name ? { name: c.name.slice(0, 40) } : {}) };
    taken.add(c.value);
    notes.push(`${role}: ${c.name ?? c.value} (${c.value}), ${why}.`);
  };
  const free = () => pool.filter((c) => !taken.has(c.value));

  // 1. Explicit roles and telling names.
  for (const c of pool) if (c.role && roles.includes(c.role)) take(c.role, c, "as labelled");
  const byName = (re: RegExp) => free().find((c) => c.name && re.test(c.name));
  take("primary", byName(/primary|main|core|brand\b/i), "named as the main colour");
  take("text", byName(/\btext\b|body|ink|black|charcoal/i), "named as a text colour");
  take("background", byName(/background|\bwhite\b|paper/i), "named as a background colour");
  take("accent", byName(/accent|highlight|secondary|focus/i), "named as an accent");
  take("tint", byName(/tint|light|pale|mist|wash/i), "named as a light tint");
  take("line", byName(/grey|gray|line|border|slate|neutral/i), "named as a neutral");

  // 2. By lightness and saturation.
  if (!colours.background) {
    const light = free().filter((c) => luminance(c.value) > 0.9).sort((a, b) => luminance(b.value) - luminance(a.value))[0];
    if (light) take("background", light, "the lightest colour");
    else {
      colours.background = { value: "#FFFFFF", name: "White" };
      invented.push("background");
      notes.push("background: no near-white colour was given, so white (#FFFFFF) is used.");
    }
  }
  if (!colours.text) {
    const dark = free().filter((c) => luminance(c.value) < 0.03 && hsl(c.value).s < 0.35).sort((a, b) => luminance(a.value) - luminance(b.value))[0];
    if (dark) take("text", dark, "the darkest neutral colour");
    else {
      colours.text = { value: "#0B0C0C", name: "Black" };
      invented.push("text");
      notes.push("text: no near-black colour was given, so #0B0C0C is used for text.");
    }
  }
  if (!colours.primary) {
    // The main brand colour: a real colour (not grey), dark enough to carry white text.
    // Palettes usually list the main colour first, so list order wins over saturation.
    const cands = free().filter((c) => hsl(c.value).s > 0.2 && contrastRatio(c.value, colours.background!.value) >= 4.5);
    const best = cands.find((c) => contrastRatio(c.value, colours.background!.value) >= AAA) ?? cands[0];
    if (best) take("primary", best, "a strong colour that can carry white text");
    else {
      const any = free().sort((a, b) => hsl(b.value).s - hsl(a.value).s)[0];
      if (any) {
        const darker = suggestPassingColour(any.value, colours.background!.value) ?? "#0B3B60";
        colours.primary = { value: darker, name: any.name ? `${any.name} dark` : "Primary" };
        invented.push("primary");
        notes.push(`primary: no colour was dark enough for white text, so ${darker} (a darker ${any.name ?? any.value}) is suggested.`);
      } else {
        colours.primary = { value: colours.text!.value, name: colours.text!.name };
        invented.push("primary");
        notes.push("primary: no brand colour was given, so the text colour is used.");
      }
    }
  }
  if (!colours.accent) {
    // An accent should stand out on the primary (it is used for emphasis on dark surfaces).
    const cands = free().sort((a, b) => contrastRatio(b.value, colours.primary!.value) - contrastRatio(a.value, colours.primary!.value));
    const best = cands.find((c) => hsl(c.value).s > 0.3 && contrastRatio(c.value, colours.primary!.value) >= AAA) ?? cands.find((c) => hsl(c.value).s > 0.3);
    if (best) take("accent", best, "the colour that stands out best on the primary");
    else {
      colours.accent = { value: colours.background!.value, name: colours.background!.name };
      invented.push("accent");
      notes.push("accent: no second brand colour was given, so emphasis uses the background colour.");
    }
  }
  if (!colours.tint) {
    const light = free().filter((c) => luminance(c.value) > 0.6).sort((a, b) => luminance(b.value) - luminance(a.value))[0];
    if (light) take("tint", light, "a light colour for quiet backgrounds");
    else {
      const t = mixWithWhite(colours.primary!.value, 0.92);
      colours.tint = { value: t, name: `${colours.primary!.name ?? "Primary"} tint` };
      invented.push("tint");
      notes.push(`tint: made from the primary mixed with white (${t}).`);
    }
  }
  if (!colours.accent2) take("accent2", free().filter((c) => hsl(c.value).s > 0.25).sort((a, b) => hsl(b.value).s - hsl(a.value).s)[0], "a second accent");
  if (!colours.line) take("line", free().filter((c) => hsl(c.value).s < 0.2)[0], "a neutral for lines");

  return { colours, notes, invented, unused: free() };
}

export interface SurfaceProposal {
  surfaces: Record<"dark" | "light" | "tint", { background: string; text: string; accent: string }>;
  captions: { background: string; text: string };
  /** Every pairing the proposal uses, with its contrast. */
  pairs: Array<{ id: string; label: string; result: ContrastResult }>;
  /** True when every pairing passes AAA. */
  ok: boolean;
  notes: string[];
}

/**
 * Pick text and accent colours for the dark, light and tint surfaces, and for captions, using only
 * pairs that pass AAA. Where nothing passes, it says so and suggests a passing colour.
 */
export function proposeSurfaces(colours: ColourSet): SurfaceProposal {
  const notes: string[] = [];
  const names = Object.keys(colours).filter((k) => colours[k]);
  const v = (n: string) => colours[n]!.value;
  const ratio = (a: string, b: string) => contrastRatio(v(a), v(b));
  const bestText = (bg: string, prefer: string[]) => {
    for (const p of prefer) if (colours[p] && p !== bg && ratio(p, bg) >= AAA) return p;
    return names.filter((n) => n !== bg).sort((a, b) => ratio(b, bg) - ratio(a, bg))[0];
  };
  const darkBg = colours.primary && ratio("primary", "background") >= AAA ? "primary" : [...names].sort((a, b) => luminance(v(a)) - luminance(v(b)))[0];
  if (darkBg !== "primary" && colours.primary) {
    const better = suggestPassingColour(v("primary"), v("background"));
    notes.push(`The primary colour is too light to carry ${colours.background?.name ?? "white"} text at AAA (${ratio("primary", "background").toFixed(2)} to 1), so ${colours[darkBg]?.name ?? darkBg} is used for dark backgrounds.${better ? ` A darker primary such as ${better} would pass.` : ""}`);
  }
  const lightBg = "background";
  const tintBg = colours.tint ? "tint" : "background";
  // A highlight colour must pass AAA on the background and also look clearly different from the text.
  const bestAccent = (bg: string, text: string, prefer: string[]) => {
    const ok = (n: string) => colours[n] && n !== bg && ratio(n, bg) >= AAA && colourDifference(v(n), v(text)) >= MIN_HIGHLIGHT_DIFFERENCE;
    for (const p of prefer) if (ok(p)) return p;
    const other = names.filter((n) => ok(n)).sort((a, b) => colourDifference(v(b), v(text)) - colourDifference(v(a), v(text)))[0];
    return other ?? text;
  };
  const darkText = bestText(darkBg, ["background", "tint"]);
  const lightText = bestText(lightBg, ["text"]);
  const tintText = bestText(tintBg, ["text"]);
  const surfaces = {
    dark: { background: darkBg, text: darkText, accent: bestAccent(darkBg, darkText, ["accent", "accent2"]) },
    light: { background: lightBg, text: lightText, accent: bestAccent(lightBg, lightText, ["primary", "accent2", "accent"]) },
    tint: { background: tintBg, text: tintText, accent: bestAccent(tintBg, tintText, ["primary", "accent2", "accent"]) },
  };
  for (const sid of ["dark", "light", "tint"] as const)
    if (surfaces[sid].accent === surfaces[sid].text)
      notes.push(`No brand colour both passes AAA on the ${sid} background and stands out from its text, so highlighted words there look like the other text. Add a stronger accent colour to fix this.`);
  if (colours.accent && surfaces.dark.accent !== "accent" && surfaces.dark.accent !== surfaces.dark.text && contrastRatio(v("accent"), v(darkBg)) < AAA)
    notes.push(`${colours.accent.name ?? "The accent"} does not pass AAA on ${colours[darkBg]!.name ?? darkBg} (${contrastRatio(v("accent"), v(darkBg)).toFixed(2)} to 1), so emphasis there uses ${colours[surfaces.dark.accent]!.name ?? surfaces.dark.accent}.`);
  if (surfaces.light.accent !== "primary" && surfaces.light.accent !== surfaces.light.text) notes.push(`The primary colour does not pass AAA on the light background, so emphasis there uses ${colours[surfaces.light.accent]?.name ?? surfaces.light.accent}.`);
  const captionBg = colours.text && ratio("text", "background") >= AAA ? "text" : darkBg;
  const captions = { background: captionBg, text: bestText(captionBg, ["background"]) };
  const pairs: SurfaceProposal["pairs"] = [];
  const add = (id: string, label: string, fg: string, bg: string) =>
    pairs.push({ id, label, result: checkContrast(v(fg), v(bg), { foreground: colours[fg]!.name ?? fg, background: colours[bg]!.name ?? bg }) });
  for (const s of ["dark", "light", "tint"] as const) {
    add(`surfaces.${s}.text`, `Text on the ${s} background`, surfaces[s].text, surfaces[s].background);
    add(`surfaces.${s}.accent`, `Highlighted words on the ${s} background`, surfaces[s].accent, surfaces[s].background);
  }
  add("captions", "Caption text on the caption box", captions.text, captions.background);
  const ok = pairs.every((p) => p.result.passesAAA);
  for (const p of pairs) if (!p.result.passesAAA) notes.push(`${p.label}: ${p.result.message}`);
  return { surfaces, captions, pairs, ok, notes };
}

/** "#abc", "abc", "#AABBCC" or "rgb(1, 2, 3)" to "#AABBCC". Returns "" when it is not a colour. */
export function normaliseHex(input: string): string {
  const s = input.trim();
  let m = /^#?([0-9a-f]{6})$/i.exec(s);
  if (m) return `#${m[1].toUpperCase()}`;
  m = /^#?([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(s);
  if (m) return `#${m[1]}${m[1]}${m[2]}${m[2]}${m[3]}${m[3]}`.toUpperCase();
  const rgb = /^rgb\s*\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i.exec(s);
  if (rgb) return toHex([+rgb[1], +rgb[2], +rgb[3]]);
  return "";
}

function dedupe<T extends { value: string }>(list: T[]): T[] {
  const seen = new Set<string>();
  return list.filter((c) => (seen.has(c.value) ? false : (seen.add(c.value), true)));
}
