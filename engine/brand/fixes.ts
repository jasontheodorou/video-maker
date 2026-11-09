// One-click fixes for a failing contrast pair, for the Brands page.
// A colour token is often shared (White is the light background and the caption text, for example), so
// changing it to make one pair pass can make others fail. Every fix offered here is tried on the whole
// brand first, and offered only when no pair that passed before would fail after it.
import { contrastRatio, colourDifference, suggestPassingColour, AAA, MIN_HIGHLIGHT_DIFFERENCE } from "../contrast";
import { SURFACE_IDS } from "../schema";

type Colours = Record<string, { value?: string; name?: string } | undefined>;
type Surfaces = Record<string, { background?: string; text?: string; accent?: string } | undefined>;

export interface ContrastFix {
  /** "use" points one part of a surface (or the captions) at another colour; "recolour" changes a colour's value. */
  kind: "use" | "recolour";
  /** Button text, plain English. */
  label: string;
  /** For "use": the brand.json path to set, such as surfaces.dark.text, and the colour token to set it to. */
  path?: string;
  token?: string;
  /** For "recolour": the colour token and its new value. */
  colour?: string;
  value?: string;
  /** One line that says what else changes. */
  note: string;
  /** How many failing pairs this fix mends (this one included). Fixes are ordered by it. */
  mends: number;
}

interface Draft {
  colours?: Colours;
  surfaces?: Surfaces;
  captions?: { background?: string; text?: string };
}

const isHex = (v: unknown): v is string => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);

interface Pair {
  id: string;
  fg: string;
  bg: string;
  /** brand.json path of the foreground token. */
  path: string;
  /** For highlight colours: the text token they must differ from. */
  textToken?: string;
  /** Words for what the foreground is. */
  what: string;
}

function pairsOf(d: Draft): Pair[] {
  const out: Pair[] = [];
  for (const s of SURFACE_IDS) {
    const surf = d.surfaces?.[s];
    if (!surf?.background) continue;
    if (surf.text) out.push({ id: `surfaces.${s}.text`, fg: surf.text, bg: surf.background, path: `surfaces.${s}.text`, what: `text on the ${s} background` });
    if (surf.accent) out.push({ id: `surfaces.${s}.accent`, fg: surf.accent, bg: surf.background, path: `surfaces.${s}.accent`, textToken: surf.text, what: `highlighted words on the ${s} background` });
  }
  if (d.captions?.text && d.captions.background) out.push({ id: "captions", fg: d.captions.text, bg: d.captions.background, path: "captions.text", what: "caption text" });
  return out;
}

/** Ids of the pairs that fail AAA, plus highlight colours too close to their text ("<id>#diff"). */
function problems(d: Draft): Set<string> {
  const out = new Set<string>();
  const c = d.colours ?? {};
  for (const p of pairsOf(d)) {
    const fg = c[p.fg]?.value;
    const bg = c[p.bg]?.value;
    if (!isHex(fg) || !isHex(bg)) {
      out.add(p.id);
      continue;
    }
    if (contrastRatio(fg, bg) < AAA) out.add(p.id);
    const tv = p.textToken ? c[p.textToken]?.value : undefined;
    if (isHex(tv) && colourDifference(fg, tv) < MIN_HIGHLIGHT_DIFFERENCE) out.add(`${p.id}#diff`);
  }
  return out;
}

function withPath(d: Draft, path: string, token: string): Draft {
  const next: Draft = structuredClone(d);
  const [a, b, k] = path.split(".");
  if (a === "captions") next.captions = { ...(next.captions ?? {}), [b]: token };
  else if (a === "surfaces" && next.surfaces?.[b]) (next.surfaces[b] as Record<string, string>)[k] = token;
  return next;
}

function withColour(d: Draft, token: string, value: string): Draft {
  const next: Draft = structuredClone(d);
  next.colours = { ...(next.colours ?? {}), [token]: { ...(next.colours?.[token] ?? {}), value } };
  return next;
}

/** Failing pairs (not highlight warnings) that a change mends. */
function mended(before: Set<string>, after: Set<string>): number {
  return [...before].filter((p) => !p.includes("#") && !after.has(p)).length;
}

const also = (n: number) => (n > 1 ? ` It also mends ${n - 1} other failing pair${n === 2 ? "" : "s"}.` : "");

/** True when the change fixes `id` and adds no problem that was not there before. */
function safe(before: Set<string>, after: Set<string>, id: string): boolean {
  if (after.has(id)) return false;
  for (const p of after) if (!before.has(p)) return false;
  return true;
}

/**
 * Fixes for each failing contrast pair, keyed by pair id (the ids `checkBrand` uses in `contrast`).
 * Each list holds at most three fixes: point the part at another brand colour that passes, change the text
 * colour, or change the background colour, ordered by how many failing pairs each one mends.
 */
export function contrastFixes(draft: Draft): Record<string, ContrastFix[]> {
  const out: Record<string, ContrastFix[]> = {};
  const colours = draft.colours ?? {};
  const name = (t: string) => colours[t]?.name || t;
  const before = problems(draft);
  for (const p of pairsOf(draft)) {
    if (!before.has(p.id)) continue;
    const fixes: ContrastFix[] = [];
    const bgVal = colours[p.bg]?.value;
    const fgVal = colours[p.fg]?.value;
    if (!isHex(bgVal)) continue;

    // 1. Use another brand colour for this part. Only this one part changes.
    const candidates = Object.keys(colours)
      .filter((t) => t !== p.fg && t !== p.bg && isHex(colours[t]?.value))
      .map((t) => ({ t, after: problems(withPath(draft, p.path, t)), ratio: contrastRatio(colours[t]!.value!, bgVal) }))
      .filter((x) => safe(before, x.after, p.id))
      // Highlights: prefer a colour, not the plain text colour. Text: prefer the strongest contrast.
      .sort((a, b) => b.ratio - a.ratio);
    for (const c of candidates.slice(0, 2)) {
      fixes.push({
        kind: "use",
        label: `Use ${name(c.t)} (${colours[c.t]!.value!.toUpperCase()}) for ${p.what}`,
        path: p.path,
        token: c.t,
        note: `Only the colour of ${p.what} changes. No colour values change.`,
        mends: mended(before, c.after),
      });
    }

    // 2. Change the text colour's value, if every other pair that uses it still passes.
    if (isHex(fgVal)) {
      const s = suggestPassingColour(fgVal, bgVal);
      const after = s ? problems(withColour(draft, p.fg, s)) : null;
      if (s && after && safe(before, after, p.id)) {
        const n = mended(before, after);
        fixes.push({ kind: "recolour", label: `Change ${name(p.fg)} to ${s}`, colour: p.fg, value: s, note: `${name(p.fg)} changes everywhere it is used. No pair that passes now will fail.${also(n)} If the brand guidelines set this colour, this moves away from the official value.`, mends: n });
      }
    }

    // 3. Change the background colour's value instead.
    if (isHex(fgVal)) {
      const s = suggestPassingColour(bgVal, fgVal);
      const after = s ? problems(withColour(draft, p.bg, s)) : null;
      if (s && after && safe(before, after, p.id)) {
        const n = mended(before, after);
        fixes.push({ kind: "recolour", label: `Change ${name(p.bg)} to ${s}`, colour: p.bg, value: s, note: `${name(p.bg)} changes everywhere it is used. No pair that passes now will fail.${also(n)} If the brand guidelines set this colour, this moves away from the official value.`, mends: n });
      }
    }
    // The fix that mends the most failing pairs first, so following the first button each time gets there fastest.
    fixes.sort((x, y) => y.mends - x.mends);
    out[p.id] = fixes.slice(0, 3);
  }
  return out;
}
