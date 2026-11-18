// brand.json version 1 to version 2, in code. Pure and deterministic.
//
// Version 1 had seven fixed colour roles (primary, text, background, accent, tint, accent2, line) and three
// fixed surfaces (dark, light, tint), and every scene type sat on one surface. Version 2 has a palette of named
// colours in groups and any number of colour schemes. A version 1 brand becomes:
//   - a palette colour per role, with the same id, value and name, tints off (nothing new appears unasked);
//   - the schemes "dark" (Dark), "light" (Light) and "tint" (Soft), one per surface;
//   - schemeUse "by-type", so each scene type keeps the surface it always had and videos look the same.
// Runs before validation wherever brand JSON is read, so everything past the parse boundary sees version 2.
import { contrastRatio, colourDifference, isHex, toneOf, MIN_SHAPE_DIFFERENCE, NON_TEXT } from "../colour-core";

const ROLE_ORDER = ["primary", "text", "background", "accent", "tint", "accent2", "line"];
const ROLE_GROUP: Record<string, string> = { primary: "core", text: "core", accent: "accent", accent2: "accent", tint: "secondary", line: "secondary", background: "neutral" };
const ROLE_NAMES: Record<string, string> = { primary: "Primary", text: "Text", background: "Background", accent: "Accent", tint: "Tint", accent2: "Accent 2", line: "Line" };
export const STANDARD_GROUPS = [
  { id: "core", name: "Core" },
  { id: "accent", name: "Accent" },
  { id: "secondary", name: "Secondary" },
  { id: "neutral", name: "Neutral" },
];
const SURFACE_SCHEMES: Array<{ id: "dark" | "light" | "tint"; name: string }> = [
  { id: "dark", name: "Dark" },
  { id: "light", name: "Light" },
  { id: "tint", name: "Soft" },
];

export interface MigrateResult {
  raw: Record<string, unknown>;
  migrated: boolean;
  notes: string[];
}

type Obj = Record<string, any>;

/** Is this brand JSON version 1 (roles and surfaces)? */
export function isV1(raw: unknown): boolean {
  if (!raw || typeof raw !== "object") return false;
  const r = raw as Obj;
  return r.schemaVersion === 1 || (r.schemaVersion == null && r.colours && r.surfaces && !r.palette);
}

/** Turn version 1 brand JSON into version 2. Version 2 (or anything else) is returned unchanged. */
export function migrateBrand(raw: unknown): MigrateResult {
  if (!isV1(raw)) return { raw: raw as Record<string, unknown>, migrated: false, notes: [] };
  const src = structuredClone(raw) as Obj;
  const notes: string[] = [];
  const colours: Obj = src.colours && typeof src.colours === "object" ? src.colours : {};
  const surfaces: Obj = src.surfaces && typeof src.surfaces === "object" ? src.surfaces : {};

  const roles = [...ROLE_ORDER.filter((r) => colours[r]), ...Object.keys(colours).filter((r) => !ROLE_ORDER.includes(r) && colours[r])];
  const paletteColours = roles.map((role) => {
    const tok = colours[role] as Obj;
    return {
      id: role.toLowerCase(),
      name: typeof tok?.name === "string" && tok.name.trim() ? String(tok.name).slice(0, 40) : (ROLE_NAMES[role] ?? role),
      value: tok?.value,
      group: ROLE_GROUP[role] ?? "secondary",
      tints: false,
    };
  });
  const valueOf = (id: unknown): string | null => {
    const c = paletteColours.find((x) => x.id === id);
    return c && isHex(c.value) ? c.value : null;
  };

  const schemes = SURFACE_SCHEMES.filter((s) => surfaces[s.id]).map((s) => {
    const surf = surfaces[s.id] as Obj;
    const scheme: Obj = {
      id: s.id,
      name: s.name,
      enabled: true,
      background: surf.background,
      text: surf.text,
      highlight: surf.accent,
      emphasis: "colour",
      shape: "tint",
      fit: "any",
      logo: "auto",
      source: "migrated",
    };
    const bg = valueOf(surf.background);
    // Version 1 drew icon circles in the tint colour with the highlight colour on top. When that icon would not
    // stand out on a dark scheme, the circle takes the background (the icon sits straight on it) instead.
    const tint = valueOf("tint");
    const icon = valueOf(surf.accent) ?? valueOf(surf.text);
    if (bg && tint && icon && contrastRatio(icon, tint) < NON_TEXT && contrastRatio(icon, bg) >= NON_TEXT && colourDifference(tint, bg) >= MIN_SHAPE_DIFFERENCE) {
      scheme.shape = surf.background;
    }
    if (!valueOf("tint")) scheme.shape = surf.background;
    // Version 1 always showed the dark-background logo on the dark surface. Keep that, even when that surface is
    // light in tone, so titles and end cards look exactly as before.
    if (s.id === "dark" && bg && toneOf(bg) === "light") {
      scheme.logo = "onDark";
      notes.push("The Dark scheme has a light background, so it keeps the logo for dark backgrounds, as before.");
    }
    return scheme;
  });

  const out: Obj = {};
  // Keep the familiar key order, swapping colours and surfaces for the palette and schemes.
  for (const [k, v] of Object.entries(src)) {
    if (k === "schemaVersion") out.schemaVersion = 2;
    else if (k === "colours") out.palette = { groups: STANDARD_GROUPS.map((g) => ({ ...g })), colours: paletteColours };
    else if (k === "surfaces") {
      out.schemes = schemes;
      out.schemeUse = { mode: "by-type" };
    } else out[k] = v;
  }
  if (!out.palette) out.palette = { groups: STANDARD_GROUPS.map((g) => ({ ...g })), colours: paletteColours };
  if (!out.schemes) {
    out.schemes = schemes;
    out.schemeUse = { mode: "by-type" };
  }
  out.schemaVersion = 2;
  if (!out.motion) out.motion = { style: "calm" };
  notes.push("Moved to the new colour model: the colour roles became palette colours and the three surfaces became the schemes Dark, Light and Soft. Videos look as before.");
  return { raw: out, migrated: true, notes };
}
