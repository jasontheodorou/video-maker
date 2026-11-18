// One-click fixes for a colour scheme that fails, for the Brands page. A fix is never a dead end and never breaks
// anything else: it changes one part of one scheme (or the captions), or adds a darker or lighter version of a colour
// to the palette for that one part. Recolouring a palette colour in place happens only when nothing else uses it.
//
// Keys of the result are the check ids: schemes.<id>.text, schemes.<id>.highlight, schemes.<id>.emphasis,
// schemes.<id>.shape and captions. Each list holds at most three fixes, the most useful first.
import {
  AAA,
  NON_TEXT,
  MIN_HIGHLIGHT_DIFFERENCE,
  MIN_SHAPE_DIFFERENCE,
  contrastRatio,
  colourDifference,
  suggestPassingColour,
  resolveRef,
  refName,
  parseRef,
  makeRef,
  expandPalette,
  iconColour,
  ratioWords,
  type PaletteLike,
  type SchemeLike,
} from "../colour-core";
import { migrateBrand } from "./migrate";

export interface ContrastFix {
  /**
   * "use": point one part at another palette colour (path and colour).
   * "recolour": a darker or lighter version: either a new palette colour (addColour) the part then uses, or a
   * colour changed in place when nothing else uses it (path is palette.colours.<i>.value).
   * "set": set a plain value (path and value), such as key words in bold.
   */
  kind: "use" | "recolour" | "set";
  /** Button text, plain English. */
  label: string;
  /** brand.json path to change, with array indexes: schemes.1.highlight, captions.text, palette.colours.3.value. */
  path: string;
  /** For "use" and a new colour: the colour reference to set ("golden.t25"). */
  colour?: string;
  /** For "set" and an in-place recolour: the value to set. */
  value?: string;
  /** For "recolour" with a new colour: add this to the palette first. */
  addColour?: { id: string; name: string; value: string; group: string; tints: boolean };
  /** For a tint of a colour whose tints are off: switch them on (palette.colours.<i>.tints). */
  enableTints?: string;
  /** One line on what else changes. */
  note: string;
  /** Check ids this fix mends. */
  mends: string[];
}

type Draft = {
  palette?: PaletteLike;
  schemes?: SchemeLike[];
  captions?: { background?: string; text?: string };
  fonts?: unknown;
};

/** Fixes for every failing or weak part of every enabled scheme, and for the captions. Version 1 drafts are migrated first. */
export function contrastFixes(input: unknown): Record<string, ContrastFix[]> {
  const draft = migrateBrand(input).raw as Draft;
  const palette = draft.palette;
  const out: Record<string, ContrastFix[]> = {};
  if (!palette?.colours?.length) return out;
  const all = expandPalette(palette);
  const name = (ref: string) => refName(ref, palette);
  const r = (ref: string) => resolveRef(ref, palette);
  const usedRefs = (except?: { scheme: number; part: string }) => {
    const refs: string[] = [];
    (draft.schemes ?? []).forEach((s, i) => {
      for (const part of ["background", "text", "highlight", "shape"] as const) if (!(except && except.scheme === i && except.part === part)) refs.push(s[part]);
    });
    if (draft.captions?.background) refs.push(draft.captions.background);
    if (draft.captions?.text) refs.push(draft.captions.text);
    return refs;
  };
  const taken = new Set(palette.colours.map((c) => c.id));
  const newId = (base: string, word: string) => {
    let id = `${base}-${word}`.slice(0, 40);
    for (let n = 2; taken.has(id); n++) id = `${base}-${word}-${n}`.slice(0, 40);
    return id;
  };

  /** Darker or lighter version of the foreground for this one part. */
  const recolour = (key: string, schemeIndex: number | null, part: string, fgRef: string, bgHex: string, what: string, target = AAA): ContrastFix | null => {
    const fg = r(fgRef);
    if (!fg) return null;
    const value = suggestPassingColour(fg, bgHex, target);
    if (!value) return null;
    const { base } = parseRef(fgRef);
    const baseIndex = palette.colours.findIndex((c) => c.id === base);
    const basePal = palette.colours[baseIndex];
    const path = schemeIndex == null ? `captions.${part}` : `schemes.${schemeIndex}.${part}`;
    const label = `Change ${what} to ${value}`;
    // Only this part uses the colour itself: change it in place.
    const usedElsewhere = usedRefs(schemeIndex == null ? undefined : { scheme: schemeIndex, part }).some((x) => parseRef(x).base === base);
    if (parseRef(fgRef).step === 100 && !usedElsewhere && baseIndex >= 0)
      return { kind: "recolour", label, path: `palette.colours.${baseIndex}.value`, value, note: `${basePal.name} changes. Nothing else uses it.`, mends: [key] };
    const lighter = contrastRatio(value, "#000000") > contrastRatio(fg, "#000000");
    const id = newId(base, lighter ? "lighter" : "darker");
    taken.add(id);
    const nm = `${basePal?.name ?? base} (${lighter ? "lighter" : "darker"})`.slice(0, 40);
    return {
      kind: "recolour",
      label,
      path,
      colour: id,
      addColour: { id, name: nm, value, group: basePal?.group ?? "secondary", tints: false },
      note: `Adds ${nm} to the palette for this. ${basePal?.name ?? base} stays as it is.`,
      mends: [key],
    };
  };

  (draft.schemes ?? []).forEach((s, i) => {
    if (s.enabled === false) return;
    const bg = r(s.background);
    if (!bg) return;
    const fg = r(s.text);
    const hl = r(s.highlight);
    const shape = r(s.shape);
    const emphasis = s.emphasis ?? "colour";
    const key = (part: string) => `schemes.${s.id}.${part}`;
    const sname = s.name;

    // Text.
    if (fg && contrastRatio(fg, bg) < AAA) {
      const k = key("text");
      const fixes: ContrastFix[] = [];
      const options = all
        .filter((c) => c.ref !== s.background && contrastRatio(c.value, bg) >= AAA)
        .sort((a, b) => (a.step === 100 ? 0 : 1) - (b.step === 100 ? 0 : 1) || contrastRatio(b.value, bg) - contrastRatio(a.value, bg))
        .slice(0, 2);
      for (const o of options)
        fixes.push({ kind: "use", label: `Use ${o.name} for text (${ratioWords(contrastRatio(o.value, bg))})`, path: `schemes.${i}.text`, colour: o.ref, note: `Only the text of ${sname} changes.`, mends: [k] });
      const rc = recolour(k, i, "text", s.text, bg, `text of ${sname}`);
      if (rc) fixes.push(rc);
      out[k] = fixes.slice(0, 3);
    }
    // Key words.
    if (hl && emphasis !== "weight" && contrastRatio(hl, bg) < AAA) {
      const k = key("highlight");
      const fixes: ContrastFix[] = [];
      const options = all
        .filter((c) => c.ref !== s.background && c.ref !== s.text && contrastRatio(c.value, bg) >= AAA && (!fg || colourDifference(c.value, fg) >= MIN_HIGHLIGHT_DIFFERENCE))
        .sort((a, b) => colourDifference(b.value, bg) - colourDifference(a.value, bg))
        .slice(0, 1);
      for (const o of options)
        fixes.push({ kind: "use", label: `Use ${o.name} for key words (${ratioWords(contrastRatio(o.value, bg))})`, path: `schemes.${i}.highlight`, colour: o.ref, note: `Only the key words of ${sname} change.`, mends: [k] });
      fixes.push({ kind: "set", label: "Make key words bold instead", path: `schemes.${i}.emphasis`, value: "weight", note: "Key words take the text colour, in bold.", mends: [k] });
      const rc = recolour(k, i, "highlight", s.highlight, bg, `key words of ${sname}`);
      if (rc) fixes.push(rc);
      out[k] = fixes.slice(0, 3);
    } else if (hl && fg && emphasis !== "weight" && contrastRatio(hl, bg) < 7.5) {
      // Passes, but close to the limit: offer a stronger step of the same colour.
      const k = key("highlight");
      const { base } = parseRef(s.highlight);
      const better = all.filter((c) => c.base === base && c.ref !== s.highlight && contrastRatio(c.value, bg) >= 7.5).sort((a, b) => contrastRatio(b.value, bg) - contrastRatio(a.value, bg))[0];
      if (better) out[k] = [{ kind: "use", label: `Use ${better.name} for key words (${ratioWords(contrastRatio(better.value, bg))})`, path: `schemes.${i}.highlight`, colour: better.ref, note: "Safer on every screen.", mends: [k] }];
    }
    // Key words that look like the text.
    if (hl && fg && emphasis === "colour" && colourDifference(hl, fg) < MIN_HIGHLIGHT_DIFFERENCE) {
      const k = key("emphasis");
      out[k] = [{ kind: "set", label: "Use bold key words", path: `schemes.${i}.emphasis`, value: "weight", note: "Key words stand out by weight, in the text colour.", mends: [k] }];
    }
    // Shape.
    if (shape) {
      const icon = iconColour(s, palette);
      const iconFails = icon ? contrastRatio(icon, shape) < NON_TEXT : false;
      const faint = colourDifference(shape, bg) < MIN_SHAPE_DIFFERENCE;
      if (iconFails || faint) {
        const k = key("shape");
        const fixes: ContrastFix[] = [];
        const { base, step } = parseRef(s.background);
        // A deeper step of the background's own colour first (the guide's look), then any colour the icon shows on.
        const deeper: Array<{ ref: string; enable?: string }> = [];
        if (step === 10) deeper.push({ ref: makeRef(base, 25) }, { ref: base });
        else if (step === 25) deeper.push({ ref: base });
        else {
          const pal = palette.colours.find((c) => c.id === base);
          if (pal) deeper.push({ ref: makeRef(base, 25), enable: pal.tints === false ? base : undefined });
        }
        const valueOf = (ref: string, enable?: string) => {
          if (!enable) return r(ref);
          const pal = palette.colours.find((c) => c.id === enable);
          return pal ? resolveRef(ref, { colours: [{ ...pal, tints: true }] }) : null;
        };
        const iconOn = (v: string) => (icon && contrastRatio(icon, v) >= NON_TEXT ? true : fg ? contrastRatio(fg, v) >= NON_TEXT : false);
        for (const d of deeper) {
          const v = valueOf(d.ref, d.enable);
          if (!v || colourDifference(v, bg) < MIN_SHAPE_DIFFERENCE || !iconOn(v)) continue;
          const nm = d.enable ? `${palette.colours.find((c) => c.id === d.enable)?.name ?? base} 25%` : name(d.ref);
          fixes.push({ kind: "use", label: `Use ${nm} for the shape`, path: `schemes.${i}.shape`, colour: d.ref, ...(d.enable ? { enableTints: d.enable } : {}), note: d.enable ? `Switches on tints for ${nm.replace(/ 25%$/, "")}.` : `Only the shape of ${sname} changes.`, mends: [k] });
          break;
        }
        const others = all
          .filter((c) => c.ref !== s.shape && c.ref !== s.background && colourDifference(c.value, bg) >= MIN_SHAPE_DIFFERENCE * 2 && iconOn(c.value))
          .sort((a, b) => colourDifference(a.value, bg) - colourDifference(b.value, bg))
          .slice(0, 2);
        for (const o of others) if (fixes.length < 3) fixes.push({ kind: "use", label: `Use ${o.name} for the shape`, path: `schemes.${i}.shape`, colour: o.ref, note: `Only the shape of ${sname} changes.`, mends: [k] });
        out[k] = fixes;
      }
    }
  });

  // Captions.
  const capBg = draft.captions?.background ? r(draft.captions.background) : null;
  const capFg = draft.captions?.text ? r(draft.captions.text) : null;
  if (capBg && capFg && contrastRatio(capFg, capBg) < AAA) {
    const fixes: ContrastFix[] = [];
    const o = all.filter((c) => contrastRatio(c.value, capBg) >= AAA).sort((a, b) => contrastRatio(b.value, capBg) - contrastRatio(a.value, capBg))[0];
    if (o) fixes.push({ kind: "use", label: `Use ${o.name} for caption text (${ratioWords(contrastRatio(o.value, capBg))})`, path: "captions.text", colour: o.ref, note: "Only the caption text changes.", mends: ["captions"] });
    const rc = recolour("captions", null, "text", draft.captions!.text!, capBg, "caption text");
    if (rc) fixes.push(rc);
    out.captions = fixes;
  }
  return out;
}
