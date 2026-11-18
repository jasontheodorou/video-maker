// Suggested colour schemes from a palette (and the colour rules read from the brand guidelines).
// Deterministic: the same palette always gives the same suggestions in the same order. Ties break by palette order,
// then id. See docs/design/studio-spec.md, section 4.4.
//
// The aim is the look of good public-sector explainer videos: calm pale tints with dark text and bold key words,
// one strong (deep) scheme to open and close with, and variety of hue across the set. Every suggestion passes AAA
// for its text and key words, and its icons reach 3 to 1 on its shape.
import {
  AAA,
  AAA_SAFE,
  NON_TEXT,
  MIN_HIGHLIGHT_DIFFERENCE,
  WHITE,
  ENGINE_BLACK,
  contrastRatio,
  colourDifference,
  expandPalette,
  hueDistance,
  suggestPassingColour,
  makeRef,
  parseRef,
  type ExpandedColour,
  type PaletteLike,
  type PaletteRulesLike,
  type SchemeLike,
} from "../colour-core";

export interface RecommendOptions {
  rules?: PaletteRulesLike;
  /** Follow rules.text (and avoid rules.never). Default true. */
  useRules?: boolean;
  /** The brand has a bold heading face heavier than its headings, so bold key words stand out. */
  emphasisWeightAvailable: boolean;
  /** How many to return (at most 12). Default 6. */
  limit?: number;
}

export interface RecommendedScheme extends Required<Pick<SchemeLike, "id" | "name" | "background" | "text" | "highlight" | "shape" | "emphasis" | "fit" | "logo">> {
  source: "suggested";
  score: number;
  reasons: string[];
  contrast: { text: number; highlight: number; icon: number };
  /** "pale", "mid" or "deep" background. */
  kind: "pale" | "mid" | "deep";
  /** Colours this suggestion needs that the palette does not have yet (white or black), to add with it. */
  adds: Array<{ id: string; name: string; value: string; group: string }>;
}

export interface NearMiss {
  scheme: Omit<RecommendedScheme, "score" | "reasons" | "contrast" | "kind" | "adds">;
  problem: string;
  fix: { path: "text"; value: string };
}

export interface Recommendation {
  schemes: RecommendedScheme[];
  nearMisses: NearMiss[];
  rules: PaletteRulesLike;
  notes: string[];
}

type Entry = ExpandedColour & { added?: boolean };

const GROUP_SCORE: Record<string, number> = { core: 12, accent: 9, secondary: 6, neutral: 8 };

/** Shapes are "related" when their hues are close. */
const RELATED_HUE = 0.12;

export function recommendSchemes(palette: Pick<PaletteLike, "colours" | "rules">, opts: RecommendOptions): Recommendation {
  const useRules = opts.useRules !== false;
  const rules: PaletteRulesLike = (useRules ? (opts.rules ?? palette.rules) : undefined) ?? {};
  const limit = Math.max(1, Math.min(12, opts.limit ?? 6));
  const notes: string[] = [];

  // 1. Expand: every colour and its tints, plus white and black as text colours when the palette has none.
  const entries: Entry[] = expandPalette(palette);
  const order = new Map(palette.colours.map((c, i) => [c.id, i]));
  const hasWhite = entries.some((e) => e.value === WHITE);
  const hasBlack = entries.some((e) => contrastRatio(e.value, "#000000") < 1.15);
  const extra: Entry[] = [];
  if (!hasWhite) extra.push({ ref: "white", base: "white", name: "White", value: WHITE, step: 100, group: "neutral", order: 1000, L: 1, H: 0, S: 0, added: true });
  if (!hasBlack) extra.push({ ref: "black", base: "black", name: "Black", value: ENGINE_BLACK, step: 100, group: "neutral", order: 1001, L: 0.0058, H: 0, S: 0, added: true });
  const all = [...entries, ...extra];
  const byRef = new Map(all.map((e) => [e.ref, e]));
  const never = (text: string, bg: string) => (rules.never ?? []).some((n) => n.text === text && n.background === bg);

  // 2. Backgrounds.
  const darkText = all.filter((e) => e.L < 0.05);
  const bgs = all.filter((e) => {
    if (e.added && e.ref === "black") return false;
    const whiteOk = contrastRatio(WHITE, e.value) >= AAA;
    const blackOk = contrastRatio(ENGINE_BLACK, e.value) >= AAA;
    if (e.step === 100 && !whiteOk && !blackOk) return false;
    // A full-strength bright colour (golden, lime) is loud as a whole background; only when the guide says so.
    if (e.step === 100 && e.L > 0.6 && e.S > 0.6) return false;
    // Mid tints of very dark colours are muddy grey-blues, never the guide's look.
    if (e.step === 25 && e.L < 0.5) return false;
    return Boolean(darkText.length || whiteOk);
  });
  const kindOf = (e: Entry): RecommendedScheme["kind"] => (e.L > 0.7 ? "pale" : contrastRatio(WHITE, e.value) >= AAA ? "deep" : "mid");

  // 3. Text candidates.
  const textPool = (): Entry[] => {
    if (rules.text?.length) return rules.text.map((id) => byRef.get(id) ?? (id === "white" ? extra.find((x) => x.ref === "white") : id === "black" ? extra.find((x) => x.ref === "black") : undefined)).filter(Boolean) as Entry[];
    return all.filter((e) => e.step === 100 && (e.group === "core" || e.group === "neutral" || e.added) && (e.L < 0.08 || e.L > 0.9));
  };
  const texts = textPool();
  const groupRank = (e: Entry) => (e.group === "core" ? 0 : e.group === "neutral" ? 1 : 2);

  interface Candidate {
    bg: Entry;
    text: Entry;
    hl: Entry;
    emphasis: "colour" | "weight";
    shape: Entry;
    icon: string;
    ratios: { text: number; highlight: number; icon: number };
    score: number;
    reasons: string[];
    kind: RecommendedScheme["kind"];
  }
  const candidates: Candidate[] = [];
  const nearMisses: NearMiss[] = [];

  for (const bg of bgs) {
    const kind = kindOf(bg);
    // Text: rules order, then core, then a comfortable margin, then the highest ratio.
    // A guide's text rule is about light backgrounds: on a deep one, white is always a choice.
    const whiteEntry = all.find((e) => e.value === WHITE);
    const pool = kind === "deep" && whiteEntry && !texts.includes(whiteEntry) ? [...texts, whiteEntry] : texts;
    const ranked = pool
      .filter((t) => t.ref !== bg.ref && !never(t.ref, bg.ref))
      .map((t) => ({ t, r: contrastRatio(t.value, bg.value), ruleIdx: rules.text?.indexOf(t.base) ?? -1 }))
      .sort((a, b) => {
        const ra = a.r >= AAA ? 0 : 1;
        const rb = b.r >= AAA ? 0 : 1;
        if (ra !== rb) return ra - rb;
        if (rules.text?.length && a.ruleIdx !== b.ruleIdx) return (a.ruleIdx < 0 ? 99 : a.ruleIdx) - (b.ruleIdx < 0 ? 99 : b.ruleIdx);
        if (groupRank(a.t) !== groupRank(b.t)) return groupRank(a.t) - groupRank(b.t);
        const sa = a.r >= AAA_SAFE ? 0 : 1;
        const sb = b.r >= AAA_SAFE ? 0 : 1;
        if (sa !== sb) return sa - sb;
        return b.r - a.r || a.t.order - b.t.order;
      });
    const best = ranked[0];
    if (!best) continue;
    if (best.r < AAA) {
      if (best.r >= 6 && bg.step === 100) {
        const fixed = suggestPassingColour(best.t.value, bg.value);
        if (fixed)
          nearMisses.push({
            scheme: { id: schemeId(bg), name: schemeName(bg), background: bg.ref, text: best.t.ref, highlight: best.t.ref, shape: bg.ref, emphasis: "weight", fit: "any", logo: "auto", source: "suggested" },
            problem: `Text ${ratioText(best.r)}`,
            fix: { path: "text", value: fixed },
          });
      }
      continue;
    }
    const text = best.t;
    const textRatio = best.r;

    // 4. Key words: a different, full-strength colour that passes on its own, else the text colour in bold.
    const hlPick = all
      .filter((e) => e.step === 100 && !e.added && e.ref !== text.ref && e.ref !== bg.ref && !never(e.ref, bg.ref))
      .filter((e) => contrastRatio(e.value, bg.value) >= AAA && colourDifference(e.value, text.value) >= MIN_HIGHLIGHT_DIFFERENCE)
      .sort((a, b) => hlGroupRank(a, kind) - hlGroupRank(b, kind) || contrastRatio(b.value, bg.value) - contrastRatio(a.value, bg.value) || a.order - b.order)[0];
    let hl: Entry;
    let emphasis: "colour" | "weight";
    if (hlPick && !(kind === "pale" && opts.emphasisWeightAvailable)) {
      hl = hlPick;
      emphasis = "colour";
    } else if (opts.emphasisWeightAvailable) {
      hl = text;
      emphasis = "weight";
    } else if (hlPick) {
      hl = hlPick;
      emphasis = "colour";
    } else continue;
    const iconColourOn = (shape: Entry) => (emphasis === "colour" && contrastRatio(hl.value, shape.value) >= NON_TEXT ? hl.value : text.value);

    // 5. Shape: a deeper step of the same colour; on deep backgrounds, the brightest core colour the icon shows on.
    const shapeFor = (): Entry | null => {
      const step = (base: string, s: 100 | 25 | 10) => byRef.get(makeRef(base, s));
      const tries: Array<Entry | undefined> = [];
      if (kind === "deep") {
        const core = all.filter((e) => e.step === 100 && e.group === "core" && e.ref !== bg.ref && !e.added).sort((a, b) => b.L - a.L || a.order - b.order);
        tries.push(...core);
        tries.push(step(bg.base, 25));
      } else if (bg.added || bg.S < 0.05 || bg.group === "neutral") {
        // White or a neutral: a pale tint of the first core colour, then the next step of a grey.
        const core = all.find((e) => e.group === "core" && e.step === 100 && !e.added);
        if (bg.step === 10) tries.push(step(bg.base, 25));
        if (core) tries.push(step(core.base, 25), step(core.base, 10));
      } else if (bg.step === 10) tries.push(step(bg.base, 25), step(bg.base, 100));
      else if (bg.step === 25) tries.push(step(bg.base, 100));
      else tries.push(step(bg.base, 25));
      for (const t of tries) if (t && t.ref !== bg.ref && contrastRatio(iconColourOn(t), t.value) >= NON_TEXT) return t;
      // Then any accent or secondary colour at full strength the icon shows on, nearest hue first.
      const any = all
        .filter((e) => e.step === 100 && !e.added && e.ref !== bg.ref && (e.group === "accent" || e.group === "secondary") && contrastRatio(iconColourOn(e), e.value) >= NON_TEXT)
        .sort((a, b) => hueDistance(a.H, bg.H) - hueDistance(b.H, bg.H) || a.order - b.order);
      return any[0] ?? (tries.find(Boolean) as Entry | undefined) ?? null;
    };
    const shape = shapeFor();
    if (!shape) continue;
    const icon = contrastRatio(iconColourOn(shape), shape.value);
    if (icon < NON_TEXT) continue;
    const hlRatio = contrastRatio(hl.value, bg.value);

    // 6. Score.
    const reasons: string[] = [];
    // Readability counts up to 10 to 1; beyond that more contrast adds nothing anyone can see.
    let score = 30 * clamp((Math.min(textRatio, hlRatio) - 7) / 3, 0, 1);
    const isWhite = bg.value === WHITE;
    if (kind === "pale" && !isWhite) score += 15;
    if (isWhite) score += 10;
    score += GROUP_SCORE[bg.group] ?? 4;
    if (shape.base === bg.base) score += 10;
    else if (hueDistance(shape.H, bg.H) < RELATED_HUE) score += 6;
    const followsRules = Boolean(rules.text?.length && rules.text.includes(text.base));
    if (followsRules) score += 10;
    if (never(text.ref, bg.ref) || never(hl.ref, bg.ref)) score -= 10;
    // Presence: core colours read best at 25% (their 10% is close to white); accents and neutrals at 10% (their
    // 25% competes with the key words).
    if (bg.step === 25 && bg.group === "core") score += 10;
    if (bg.step === 10 && bg.group !== "core") score += 10;
    if (Math.min(textRatio, hlRatio) < AAA_SAFE && kind !== "deep") score -= 20;
    const bgWord = kind === "pale" ? `Pale ${baseName(bg).toLowerCase()}` : kind === "deep" ? baseName(bg) : baseName(bg);
    reasons.push(`${bgWord}, ${baseName(text).toLowerCase()} text, ${emphasis === "weight" ? "bold key words" : `${baseName(hl).toLowerCase()} key words`}${followsRules ? ": matches your guide" : ""}`);
    if (Math.min(textRatio, hlRatio) < AAA_SAFE) reasons.push(`Close to the limit: ${ratioText(Math.min(textRatio, hlRatio))}`);
    candidates.push({ bg, text, hl, emphasis, shape, icon: iconColourOn(shape), ratios: { text: textRatio, highlight: hlRatio, icon }, score, reasons, kind });
  }

  // The strong scheme is the brand's own deep colour: core colours first, then any colour with real chroma, black
  // and greys last; then by score. Only that one gets the deep bonus.
  const deepRank = (c: Candidate) => (c.bg.S < 0.15 ? 3 : c.bg.group === "core" ? 0 : c.bg.group === "accent" ? 1 : 2);
  const deep = candidates.filter((c) => c.kind === "deep").sort((a, b) => deepRank(a) - deepRank(b) || b.score - a.score || cmp(a, b));
  deep.forEach((c, i) => {
    if (i === 0) c.score += 15;
  });
  // A set that hangs together: pale tints of the strong scheme's key-word and shape colours echo it, and one calm
  // neutral (a grey tint) suits busy scenes.
  const strong0 = deep[0];
  for (const c of candidates) {
    if (c.kind !== "pale") continue;
    if (strong0 && (c.bg.base === strong0.hl.base || c.bg.base === strong0.shape.base)) {
      c.score += 12;
      c.reasons[0] += strong0.hl.base === c.bg.base ? ` (echoes the ${baseName(strong0.hl).toLowerCase()} key words)` : "";
    }
    if (c.bg.S < 0.1 && c.bg.step !== 100 && !c.bg.added) c.score += 12;
  }

  // 7. Choose with variety (maximal marginal relevance).
  const chosen: Candidate[] = [];
  const pool = [...candidates].sort((a, b) => b.score - a.score || cmp(a, b));
  // Variety is of hue: two pale tints of near hues (or two greys) are alike; a pale golden and a pale blue are not.
  const neutral = (c: Candidate) => c.bg.S < 0.1 || c.bg.added === true;
  const similarity = (a: Candidate, b: Candidate) => {
    if (a.bg.base === b.bg.base) return 1;
    if (a.kind !== b.kind) return 0;
    if (neutral(a) || neutral(b)) return neutral(a) && neutral(b) ? 0.5 : 0;
    return hueDistance(a.bg.H, b.bg.H) < 0.08 ? 0.5 : 0;
  };
  const strongPick = deep[0];
  if (strongPick) chosen.push(strongPick);
  const paleCount = () => chosen.filter((c) => c.kind === "pale").length;
  const deepCount = () => chosen.filter((c) => c.kind === "deep").length;
  while (chosen.length < limit) {
    const left = pool.filter((c) => !chosen.includes(c) && !(c.kind === "deep" && deepCount() >= 2));
    if (!left.length) break;
    const needPale = paleCount() < 2 && left.some((c) => c.kind === "pale");
    const options = needPale ? left.filter((c) => c.kind === "pale") : left;
    const value = (c: Candidate) => c.score - 30 * Math.max(0, ...chosen.map((x) => similarity(c, x)));
    options.sort((a, b) => value(b) - value(a) || cmp(a, b));
    chosen.push(options[0]);
  }

  // 8. Order: the first three pale schemes and the strong one make a complete set (what a new brand starts with);
  // the rest follow by score.
  const paleSorted = chosen.filter((c) => c !== strongPick && c.kind === "pale").sort((a, b) => b.score - a.score || cmp(a, b));
  const head = [...paleSorted.slice(0, 3), ...(strongPick ? [strongPick] : [])];
  const ordered = [...head, ...chosen.filter((c) => !head.includes(c)).sort((a, b) => b.score - a.score || cmp(a, b))];
  if (!strongPick) notes.push("No colour in the palette is dark enough for white text, so there is no strong scheme to open and close videos.");
  if (rules.text?.length) notes.push(`Following your guide: text in ${rules.text.map((t) => byRef.get(t)?.name ?? t).join(", ")}.`);

  const used = new Set<string>();
  const schemes = ordered.map((c) => {
    let id = schemeId(c.bg);
    for (let n = 2; used.has(id); n++) id = `${schemeId(c.bg)}-${n}`;
    used.add(id);
    const adds = [c.bg, c.text, c.hl, c.shape].filter((e) => e.added).map((e) => ({ id: e.base, name: e.name, value: e.value, group: "neutral" }));
    return {
      id,
      name: schemeName(c.bg),
      background: c.bg.ref,
      text: c.text.ref,
      highlight: c.hl.ref,
      shape: c.shape.ref,
      emphasis: c.emphasis,
      fit: "any" as const,
      logo: "auto" as const,
      source: "suggested" as const,
      score: Math.round(c.score),
      reasons: c.reasons,
      contrast: { text: round2(c.ratios.text), highlight: round2(c.ratios.highlight), icon: round2(c.ratios.icon) },
      kind: c.kind,
      adds: dedupeAdds(adds),
    };
  });
  return { schemes, nearMisses: nearMisses.slice(0, 4), rules, notes };

  function cmp(a: Candidate, b: Candidate) {
    return (order.get(a.bg.base) ?? a.bg.order) - (order.get(b.bg.base) ?? b.bg.order) || b.bg.step - a.bg.step || a.bg.ref.localeCompare(b.bg.ref);
  }
}

/**
 * Key words on a deep (brand-coloured) background take an accent, which stands apart from it; on light backgrounds
 * they take the brand's core colour.
 */
function hlGroupRank(e: ExpandedColour, kind: "pale" | "mid" | "deep") {
  if (kind === "deep") return e.group === "accent" ? 0 : e.group === "core" ? 1 : 2;
  return e.group === "core" ? 0 : e.group === "accent" ? 1 : 2;
}

function baseName(e: ExpandedColour): string {
  return e.step === 100 ? e.name : e.name.replace(/ \d+%$/, "");
}

/** "Golden 10%", "Navy". */
function schemeName(e: ExpandedColour): string {
  return e.name.slice(0, 40);
}

/** "golden-10", "navy". */
function schemeId(e: ExpandedColour): string {
  const { base, step } = parseRef(e.ref);
  return (step === 100 ? base : `${base}-${step}`).slice(0, 40);
}

function dedupeAdds<T extends { id: string }>(list: T[]): T[] {
  const seen = new Set<string>();
  return list.filter((x) => (seen.has(x.id) ? false : (seen.add(x.id), true)));
}

function clamp(v: number, a: number, b: number) {
  return Math.min(b, Math.max(a, v));
}

function round2(v: number) {
  return Math.floor(v * 100) / 100;
}

function ratioText(r: number) {
  return `${(Math.floor(r * 10) / 10).toFixed(1)} to 1`;
}
