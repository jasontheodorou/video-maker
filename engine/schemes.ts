// Which colour scheme each scene of a video uses. Deterministic: the same spec and brand always give the same
// answer. See docs/design/studio-spec.md, section 4.6.
//
// - A scene's own "scheme" in the spec wins, when the brand can use it there.
// - "by-type" (brands moved from version 1): each scene type keeps its old surface (dark, light or tint).
// - "single": one scheme for the whole video (the title and end card still need one the logo shows on).
// - "spread" (the default): the title and end card share the bookend scheme; the scenes between take the other
//   schemes in turn, least used first, never the same as the scene before where that can be helped.
import { getScene } from "./scenes";
import { sceneId, type Spec } from "./spec";
import type { LoadedBrand, SchemeStatus } from "./brand";

export interface SchemeChoice {
  sceneId: string;
  scheme: string;
  /** True when the engine chose it; false when the spec named it. */
  auto: boolean;
}

export interface SchemeAssignment {
  scenes: SchemeChoice[];
  /** Things a person may want to know, such as two neighbours sharing a scheme. */
  notes: string[];
  /** Spec choices the brand cannot use, as plain messages with the scene index (0-based). */
  errors: Array<{ scene: number; message: string }>;
  mode: "spread" | "single" | "by-type";
  bookends: string;
}

type SceneLike = { type: string; scheme?: string; id?: string };
type SpecLike = { scenes: SceneLike[]; look?: { schemes?: "spread" | "single"; scheme?: string } };

/** The scheme that opens and closes videos: the brand's choice, else the first strong one, else the first that can. */
export function bookendScheme(brand: LoadedBrand): SchemeStatus | null {
  const can = brand.bookendSchemes();
  const chosen = brand.brand.schemeUse.bookends;
  return can.find((s) => s.id === chosen) ?? can.find((s) => s.strong) ?? can[0] ?? brand.usableSchemes()[0] ?? null;
}

export function assignSchemes(spec: SpecLike | Spec, brand: LoadedBrand): SchemeAssignment {
  const scenes = spec.scenes as SceneLike[];
  const usable = brand.usableSchemes();
  const notes: string[] = [];
  const errors: SchemeAssignment["errors"] = [];
  const ids = scenes.map((s, i) => sceneId(s as Parameters<typeof sceneId>[0], i));
  if (!usable.length) throw new Error(`Brand "${brand.brand.id}" has no colour scheme that can be used.`);
  const look = (spec as SpecLike).look;
  const mode: SchemeAssignment["mode"] = look?.schemes ?? brand.brand.schemeUse.mode ?? "spread";
  const byId = new Map(usable.map((s) => [s.id, s]));
  const bookend = bookendScheme(brand)!;
  const needsBookends = (i: number) => getScene(scenes[i].type).schemeNeed === "bookends";
  const label = (id: string) => brand.scheme(id)?.name ?? id;

  const out: Array<SchemeChoice | null> = scenes.map(() => null);
  // 1. The spec's own choices.
  scenes.forEach((s, i) => {
    if (!s.scheme) return;
    const st = byId.get(s.scheme);
    if (!st) {
      errors.push({ scene: i, message: `Scene ${i + 1}: the scheme ${label(s.scheme)} is not in use in this brand.` });
      return;
    }
    if (needsBookends(i) && !st.bookends) {
      errors.push({ scene: i, message: `Scene ${i + 1}: ${st.name} can't open or close a video. Pick a scheme the logo shows on.` });
      return;
    }
    out[i] = { sceneId: ids[i], scheme: st.id, auto: false };
  });

  if (mode === "single") {
    const wanted = look?.scheme ?? brand.brand.schemeUse.single ?? usable[0].id;
    let one = byId.get(wanted);
    if (!one) {
      one = usable[0];
      notes.push(`The scheme ${label(wanted)} is not in use, so ${one.name} is used for the whole video.`);
    }
    scenes.forEach((_, i) => {
      if (out[i]) return;
      if (needsBookends(i) && !one!.bookends) {
        out[i] = { sceneId: ids[i], scheme: bookend.id, auto: true };
        return;
      }
      out[i] = { sceneId: ids[i], scheme: one!.id, auto: true };
    });
    if (!one.bookends) notes.push(`The logo can't be seen on ${one.name}, so the title and end card use ${bookend.name}.`);
    return { scenes: out as SchemeChoice[], notes, errors, mode, bookends: bookend.id };
  }

  if (mode === "by-type") {
    scenes.forEach((s, i) => {
      if (out[i]) return;
      const legacy = byId.get(getScene(s.type).legacyScheme);
      if (legacy && (!needsBookends(i) || legacy.bookends)) out[i] = { sceneId: ids[i], scheme: legacy.id, auto: true };
    });
  }

  // Spread: title and end card on the bookend scheme.
  scenes.forEach((_, i) => {
    if (!out[i] && needsBookends(i)) out[i] = { sceneId: ids[i], scheme: bookend.id, auto: true };
  });

  // The scenes between take the other schemes in turn.
  let middle = usable.filter((s) => s.fit !== "bookends");
  if (usable.length >= 3) middle = middle.filter((s) => s.id !== bookend.id);
  if (!middle.length) middle = usable.filter((s) => s.fit !== "bookends");
  if (!middle.length) middle = usable;
  const used = new Map<string, number>();
  for (const c of out) if (c) used.set(c.scheme, (used.get(c.scheme) ?? 0) + 1);
  const rank = (id: string) => usable.findIndex((s) => s.id === id);
  const lastIndex = scenes.length - 1;
  scenes.forEach((s, i) => {
    if (out[i]) return;
    const prev = i > 0 ? out[i - 1]?.scheme : undefined;
    const next = i < lastIndex ? out[i + 1] : null;
    const endNext = i + 1 === lastIndex ? out[lastIndex]?.scheme : undefined;
    const prefersPale = getScene(s.type).schemeNeed === "prefer-pale";
    // Rules, strongest last: relaxed in this order when nothing is left.
    const rules: Array<(x: SchemeStatus) => boolean> = [
      (x) => !(endNext && x.id === endNext),
      (x) => !(next && next.scheme === x.id),
      (x) => x.id !== prev,
    ];
    let pool: SchemeStatus[] = [];
    let relaxed = 0;
    for (; relaxed <= rules.length; relaxed++) {
      pool = middle.filter((x) => rules.slice(relaxed).every((r) => r(x)));
      if (pool.length) break;
    }
    if (!pool.length) pool = middle;
    if (prefersPale && pool.some((x) => x.pale)) pool = pool.filter((x) => x.pale);
    pool.sort((a, b) => (used.get(a.id) ?? 0) - (used.get(b.id) ?? 0) || rank(a.id) - rank(b.id));
    const pick = pool[0];
    if (relaxed >= rules.length && pick.id === prev) notes.push(`Two scenes in a row share a scheme (scenes ${i} and ${i + 1}).`);
    out[i] = { sceneId: ids[i], scheme: pick.id, auto: true };
    used.set(pick.id, (used.get(pick.id) ?? 0) + 1);
  });
  return { scenes: out as SchemeChoice[], notes, errors, mode, bookends: bookend.id };
}
