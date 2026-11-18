// Colour maths for the brand studio. Everything comes from the engine's pure colour-core, so the
// ratios and live preview variables here are the same numbers the renderer uses.
import {
  contrastRatio,
  expandPalette,
  hslToRgb,
  isHex,
  parseHex,
  parseRef,
  refName,
  resolveRef,
  rgbToHsl,
  schemeVars,
  toHex,
  tone,
  toneOf,
  type ExpandedColour,
  type SchemeLike,
} from "../../../engine/colour-core";

export { contrastRatio, expandPalette, isHex, parseRef, refName, resolveRef, schemeVars, tone, toneOf, type ExpandedColour, type SchemeLike };

/** "12.9 to 1": rounded down, so 6.99 never reads as 7.0. */
export const ratioText = (r: number) => `${(Math.floor(r * 10) / 10).toFixed(1)} to 1`;

export type Part = "background" | "text" | "highlight" | "shape";
export const PART_LABEL: Record<Part, string> = { background: "Background", text: "Text", highlight: "Key words", shape: "Shape" };
/** The lower-case word used in sentences: "Change text of Golden 10%". */
export const PART_WORD: Record<Part, string> = { background: "background", text: "text", highlight: "key words", shape: "shape" };

/** Each part is checked against this other part, and needs this ratio. */
export function counterpart(part: Part): { against: Part; need: number } {
  if (part === "background") return { against: "text", need: 7 };
  if (part === "shape") return { against: "background", need: 1 };
  return { against: "background", need: 7 };
}

export function hexToHsl(hex: string) {
  const [h, s, l] = rgbToHsl(parseHex(hex));
  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
}
export function hslToHex(h: number, s: number, l: number) {
  return toHex(hslToRgb([(h % 360) / 360, s / 100, l / 100]));
}

/** A lower-case id from a name ("HMCTS blue" → "hmcts-blue"), unique among `taken`. */
export function slugId(name: string, taken: string[], fallback = "colour") {
  let base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/^[^a-z]+/, "")
    .slice(0, 34);
  if (!base) base = fallback;
  let id = base;
  for (let n = 2; taken.includes(id); n++) id = `${base}-${n}`;
  return id;
}

/** The variables a live preview sets for a scheme, from the draft. */
export function liveVars(scheme: SchemeLike, draft: any): Record<string, string> {
  const headingWeight = Number(draft.fonts?.heading?.weight ?? 700);
  const emphasisWeight = Number(draft.fonts?.heading?.emphasisWeight ?? 700);
  return schemeVars(scheme, draft.palette, { headingWeight, emphasisWeight });
}

/** Schemes that use a colour (any tint of it). */
export function schemesUsing(draft: any, colourId: string): any[] {
  return (draft.schemes ?? []).filter((s: any) => (["background", "text", "highlight", "shape"] as Part[]).some((p) => parseRef(s[p]).base === colourId));
}

/** Readable text colour (ink or white) on a swatch, for labels drawn on it. */
export const inkOn = (hex: string) => (contrastRatio("#FFFFFF", hex) > contrastRatio("#11161B", hex) ? "#FFFFFF" : "#11161B");
