// Brand pack loader. Reads brands/<id>/brand.json, checks it, and turns tokens into CSS.
// Scenes only ever see CSS variables made here, so a new brand folder changes the look with no code changes.
//
// Colour model (schemaVersion 2): a palette of named colours (with 10% and 25% tints) and any number of colour
// schemes. Each scheme is background, text, key words (highlight) and shape. Every enabled scheme is checked on
// its own: a failing scheme is saved but left out of videos ("not used until fixed"). The brand is blocked only
// when no scheme can be used, or none can open and close a video. Version 1 files are migrated on load.
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { BRANDS_DIR } from "./paths";
import { BrandSchemaV2, type Brand, type Scheme } from "./schema";
import { checkContrast, type ContrastResult } from "./contrast";
import {
  AAA,
  AAA_SAFE,
  NON_TEXT,
  MIN_HIGHLIGHT_DIFFERENCE,
  MIN_SHAPE_DIFFERENCE,
  contrastRatio,
  colourDifference,
  resolveRef,
  refName,
  refVar,
  expandPalette,
  schemeVars as coreSchemeVars,
  logoVariant as coreLogoVariant,
  toneOf,
  strong as coreStrong,
  iconColour,
  ratioWords,
  isPale,
} from "./colour-core";
import { migrateBrand } from "./brand/migrate";
import { loadConfig, type FormatConfig } from "./config";
import { logoVisibility, LOGO_ERROR_SHARE, LOGO_WARN_SHARE } from "./logocheck";

export interface BrandIssue {
  level: "error" | "warning";
  /** Where the problem is, such as schemes.navy.text or fonts.heading. */
  field: string;
  message: string;
  /**
   * False for a problem that only takes one scheme out of use: the brand still renders with its other schemes.
   * Such problems are errors (the scheme must be fixed to be used) but do not block the brand.
   */
  blocking?: boolean;
}

export interface ContrastPair {
  id: string;
  label: string;
  result: ContrastResult;
}

/** One scheme as the engine sees it: whether it can be used, its tone and its CSS values. */
export interface SchemeStatus {
  id: string;
  name: string;
  enabled: boolean;
  /** Enabled and passes every check that would make text hard to read. */
  usable: boolean;
  /** Usable, allowed to open and close videos, and the logo shows on it. */
  bookends: boolean;
  tone: "dark" | "light";
  /** Dark, or a full-strength saturated background: good for titles and end cards. */
  strong: boolean;
  /** A very light background, such as a 10% or 25% tint. */
  pale: boolean;
  logo: "onLight" | "onDark";
  /** Share of the logo that stands out on this background (0 to 1), when the logo file could be read. */
  logoShare: number | null;
  fit: Scheme["fit"];
  vars: Record<string, string>;
  /** Plain-English reasons it cannot be used. */
  problems: string[];
}

export interface LoadedBrand {
  brand: Brand;
  dir: string;
  /** True when brand.json is still version 1 on disk (it was migrated in memory). */
  migrated: boolean;
  /** Hex value of a colour reference ("navy", "golden.t10"). Throws for an unknown reference. */
  colour(ref: string): string;
  /** "Golden 10%" */
  colourName(ref: string): string;
  scheme(id: string): Scheme | undefined;
  /** Every scheme, in brand order, with its status. */
  schemes(): SchemeStatus[];
  /** Enabled schemes that pass, in brand order (order is priority). */
  usableSchemes(): SchemeStatus[];
  /** Usable schemes that can open and close a video. */
  bookendSchemes(): SchemeStatus[];
  /** CSS variables of a scheme (any scheme, even one not in use). */
  schemeVars(scheme: Scheme | string): Record<string, string>;
  /** The logo file for a scheme. */
  logoFor(scheme: Scheme | string): "onLight" | "onDark";
  /** Weight of key words in schemes that make them bold. */
  emphasisWeight: number;
  file(rel: string): string;
  contrast: ContrastPair[];
  issues: BrandIssue[];
  ok: boolean;
}

export function brandDir(idOrDir: string): string {
  if (idOrDir.includes("/") || idOrDir.includes("\\")) return path.resolve(idOrDir);
  return path.join(BRANDS_DIR, idOrDir);
}

export function listBrands(): Array<{ id: string; name: string; fictional: boolean; provisional: string[]; ok: boolean; errors: string[] }> {
  if (!fs.existsSync(BRANDS_DIR)) return [];
  return fs
    .readdirSync(BRANDS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(BRANDS_DIR, d.name, "brand.json")))
    .map((d) => {
      try {
        const b = loadBrand(d.name);
        return {
          id: b.brand.id,
          name: b.brand.name,
          fictional: b.brand.fictional,
          provisional: b.brand.provisional,
          ok: b.ok,
          errors: b.issues.filter((i) => i.level === "error" && i.blocking !== false).map((i) => `${i.field}: ${i.message}`),
        };
      } catch (e) {
        return { id: d.name, name: d.name, fictional: false, provisional: [], ok: false, errors: [(e as Error).message] };
      }
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

export interface ParsedBrand {
  success: boolean;
  data?: Brand;
  issues: Array<{ path: string; message: string }>;
  /** The JSON after migration (version 2), whether or not it is valid. */
  raw: Record<string, unknown>;
  migrated: boolean;
  notes: string[];
}

/** Migrate (version 1 to 2) and validate brand JSON. Never throws. */
export function safeParseBrand(raw: unknown): ParsedBrand {
  const m = migrateBrand(raw);
  const r = BrandSchemaV2.safeParse(m.raw);
  if (r.success) return { success: true, data: r.data, issues: [], raw: m.raw, migrated: m.migrated, notes: m.notes };
  return { success: false, issues: r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })), raw: m.raw, migrated: m.migrated, notes: m.notes };
}

/** Parse brand JSON (an object) without touching the disk. Throws with readable messages. */
export function parseBrand(raw: unknown): Brand {
  const m = migrateBrand(raw);
  const parsed = BrandSchemaV2.safeParse(m.raw);
  if (!parsed.success) throw new Error(`brand.json is not valid:\n${z.prettifyError(parsed.error)}`);
  return parsed.data;
}

export function loadBrand(idOrDir: string): LoadedBrand {
  const dir = brandDir(idOrDir);
  const file = path.join(dir, "brand.json");
  if (!fs.existsSync(file)) throw new Error(`No brand.json found in ${dir}`);
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  const loaded = inspectBrand(parseBrand(raw), dir);
  loaded.migrated = migrateBrand(raw).migrated;
  return loaded;
}

/** Weight of bold key words: the brand's choice, else the heaviest bold heading face (700 when there is one). */
export function emphasisWeightOf(brand: Brand): number {
  if (brand.fonts.heading.emphasisWeight) return brand.fonts.heading.emphasisWeight;
  const weights = brand.fonts.faces.filter((f) => f.family === brand.fonts.heading.family && f.style === "normal").map((f) => f.weight);
  if (weights.includes(700)) return 700;
  const bold = weights.filter((w) => w >= 600).sort((a, b) => b - a)[0];
  return bold ?? 700;
}

/** Bold key words can be told from the rest of the headline (the brand has a heavier heading face). */
export function emphasisWeightAvailable(brand: Brand): boolean {
  const w = emphasisWeightOf(brand);
  const has = brand.fonts.faces.some((f) => f.family === brand.fonts.heading.family && f.weight === w && f.style === "normal");
  return has && w >= Math.max(600, brand.fonts.heading.weight + 200);
}

const PART_WORDS: Record<string, string> = { background: "background", text: "text", highlight: "key words", shape: "shape" };

/** Check a parsed brand against its folder: colours, schemes, contrast, font files, logo files. */
export function inspectBrand(brand: Brand, dir: string): LoadedBrand {
  const issues: BrandIssue[] = [];
  const palette = brand.palette;
  const cfg = loadConfig();
  const colour = (ref: string): string => {
    const v = resolveRef(ref, palette);
    if (!v) throw new Error(`Colour "${ref}" is not defined in brand ${brand.id}`);
    return v;
  };
  const name = (ref: string) => refName(ref, palette);
  const emphasisWeight = emphasisWeightOf(brand);
  const headingWeight = brand.fonts.heading.weight;
  const varOpts = { emphasisWeight, headingWeight };
  const contrast: ContrastPair[] = [];

  // ---- captions ----
  const capBg = resolveRef(brand.captions.background, palette);
  const capFg = resolveRef(brand.captions.text, palette);
  if (!capBg) issues.push({ level: "error", field: "captions.background", message: `Refers to a colour called "${brand.captions.background}", which is not defined.` });
  if (!capFg) issues.push({ level: "error", field: "captions.text", message: `Refers to a colour called "${brand.captions.text}", which is not defined.` });
  if (capBg && capFg) {
    const result = checkContrast(capFg, capBg, { foreground: name(brand.captions.text), background: name(brand.captions.background) });
    contrast.push({ id: "captions", label: "Captions: text", result });
    if (!result.passesAAA) issues.push({ level: "error", field: "captions", message: result.message });
    else if (result.ratio < AAA_SAFE) issues.push({ level: "warning", field: "captions", message: `Close to the limit: ${ratioWords(result.ratio)}. ${AAA_SAFE} to 1 or more is safer on every screen.` });
  }
  if (brand.icons.duotoneColour && !resolveRef(brand.icons.duotoneColour, palette))
    issues.push({ level: "error", field: "icons.duotoneColour", message: `Refers to a colour called "${brand.icons.duotoneColour}", which is not defined.` });

  // ---- fonts ----
  for (const face of brand.fonts.faces) {
    const p = path.join(dir, face.src);
    if (!fs.existsSync(p)) issues.push({ level: "error", field: "fonts.faces", message: `Font file ${face.src} is missing.` });
    else if (!/\.(woff2|woff|ttf|otf)$/i.test(face.src)) issues.push({ level: "error", field: "fonts.faces", message: `${face.src} is not a font file. Use WOFF2, WOFF, TTF or OTF.` });
  }
  for (const role of ["heading", "body"] as const) {
    const r = brand.fonts[role];
    const has = brand.fonts.faces.some((f) => f.family === r.family && f.weight === r.weight && f.style === "normal");
    if (!has) issues.push({ level: "error", field: `fonts.${role}`, message: `No font file for ${r.family} at weight ${r.weight}. Upload that weight or pick another.` });
  }
  const capWeightOk = brand.fonts.faces.some((f) => f.family === brand.fonts.body.family && f.weight === brand.captions.weight);
  if (!capWeightOk) issues.push({ level: "error", field: "captions.weight", message: `No ${brand.fonts.body.family} file at weight ${brand.captions.weight} for captions.` });
  const hasEmphasisFace = brand.fonts.faces.some((f) => f.family === brand.fonts.heading.family && f.weight === emphasisWeight && f.style === "normal");

  // ---- logo files ----
  const logoOk: Record<"onLight" | "onDark", boolean> = { onLight: false, onDark: false };
  for (const k of ["onLight", "onDark"] as const) {
    const rel = brand.logo[k];
    const p = path.join(dir, rel);
    if (!fs.existsSync(p)) issues.push({ level: "error", field: `logo.${k}`, message: `Logo file ${rel} is missing.` });
    else if (!/\.(svg|png)$/i.test(rel)) issues.push({ level: "error", field: `logo.${k}`, message: `Use an SVG or PNG logo.` });
    else {
      logoOk[k] = true;
      if (/\.png$/i.test(rel)) issues.push({ level: "warning", field: `logo.${k}`, message: `PNG logos can look soft. An SVG stays sharp at every size.` });
    }
  }

  // ---- schemes ----
  const statuses: SchemeStatus[] = [];
  const rules = palette.rules;
  for (const s of brand.schemes) {
    const enabled = s.enabled !== false;
    const problems: string[] = [];
    const field = (part: string) => `schemes.${s.id}.${part}`;
    const unusable = (part: string, message: string) => {
      problems.push(message);
      if (enabled) issues.push({ level: "error", field: field(part), message, blocking: false });
    };
    const warn = (part: string, message: string) => {
      if (enabled) issues.push({ level: "warning", field: field(part), message });
    };
    const bg = resolveRef(s.background, palette);
    const fg = resolveRef(s.text, palette);
    const hl = resolveRef(s.highlight, palette);
    const shape = resolveRef(s.shape, palette);
    for (const [part, v] of [["background", bg], ["text", fg], ["highlight", hl], ["shape", shape]] as const) {
      if (!v) unusable(part, `The ${PART_WORDS[part]} colour "${s[part]}" is not in the palette.`);
    }
    const emphasis = s.emphasis ?? "colour";
    if (bg && fg) {
      const result = checkContrast(fg, bg, { foreground: name(s.text), background: name(s.background) });
      if (enabled) contrast.push({ id: field("text"), label: `${s.name}: text`, result });
      if (!result.passesAAA) unusable("text", `Fails AAA: ${name(s.text)} text on ${name(s.background)} is ${ratioWords(result.ratio)}. Text needs 7 to 1.`);
      else if (result.ratio < AAA_SAFE) warn("text", `Close to the limit: ${name(s.text)} on ${name(s.background)} is ${ratioWords(result.ratio)}.`);
    }
    if (bg && hl && emphasis !== "weight") {
      const result = checkContrast(hl, bg, { foreground: name(s.highlight), background: name(s.background) });
      if (enabled) contrast.push({ id: field("highlight"), label: `${s.name}: key words`, result });
      if (!result.passesAAA) unusable("highlight", `Fails AAA: ${name(s.highlight)} key words on ${name(s.background)} are ${ratioWords(result.ratio)}. Key words need 7 to 1.`);
      else if (result.ratio < AAA_SAFE) warn("highlight", `Close to the limit: ${name(s.highlight)} key words on ${name(s.background)} are ${ratioWords(result.ratio)}.`);
    }
    if (hl && fg && emphasis === "colour" && colourDifference(hl, fg) < MIN_HIGHLIGHT_DIFFERENCE)
      warn("emphasis", `Key words in ${name(s.highlight)} look almost the same as the ${name(s.text)} text around them. Make them bold, or pick another colour.`);
    if (emphasis !== "colour") {
      if (!hasEmphasisFace) unusable("emphasis", `Bold key words need a ${brand.fonts.heading.family} font file at weight ${emphasisWeight}. Upload it, or show key words in a colour.`);
      else if (emphasisWeight < headingWeight + 200 && emphasis === "weight")
        warn("emphasis", `Headings are already weight ${headingWeight}, so bold key words (${emphasisWeight}) barely stand out. Use a lighter heading weight, or show key words in a colour.`);
    }
    if (bg && shape && colourDifference(bg, shape) < MIN_SHAPE_DIFFERENCE) warn("shape", `The shape barely shows on ${name(s.background)}.`);
    const icon = iconColour(s, palette);
    if (shape && icon && contrastRatio(icon, shape) < NON_TEXT)
      unusable("shape", `Icons can't be seen on the ${name(s.shape)} shape: ${ratioWords(contrastRatio(icon, shape))}. They need 3 to 1.`);
    if (rules?.text?.length && !rules.text.includes(s.text.split(".")[0]) && !(bg && toneOf(bg) === "dark" && fg && contrastRatio(fg, "#FFFFFF") < 1.1))
      warn("text", `Your guide limits text to ${rules.text.map((t) => name(t)).join(", ")}.`);
    for (const n of rules?.never ?? []) {
      if ((n.text === s.text && n.background === s.background) || (n.text === s.highlight && n.background === s.background && emphasis !== "weight"))
        warn(n.text === s.text ? "text" : "highlight", `Your guide says never to put ${name(n.text)} on ${name(n.background)}.`);
    }

    // Logo: which file shows here, and can it be seen?
    const variant = coreLogoVariant(s, palette);
    let logoShare: number | null = null;
    let logoVisible = logoOk[variant];
    if (bg && logoOk[variant]) {
      const v = logoVisibility(path.join(dir, brand.logo[variant]), bg);
      if (v) {
        logoShare = v.empty ? 0 : v.visibleShare;
        const where = name(s.background);
        if (v.empty || v.visibleShare < LOGO_ERROR_SHARE) {
          logoVisible = false;
          warn("logo", `Can't see the logo on ${where}, so this scheme can't open or close videos.`);
        } else if (v.visibleShare < LOGO_WARN_SHARE) {
          warn("logo", `Part of the logo disappears on ${where}: ${Math.round((1 - v.visibleShare) * 100)}% of it is too close to the background.`);
        }
      }
    }
    const usable = enabled && problems.length === 0;
    const tone = bg ? toneOf(bg) : "light";
    statuses.push({
      id: s.id,
      name: s.name,
      enabled,
      usable,
      bookends: usable && s.fit !== "middle" && logoVisible,
      tone,
      strong: coreStrong(s, palette),
      pale: bg ? isPale(bg) : false,
      logo: variant,
      logoShare,
      fit: s.fit,
      vars: coreSchemeVars(s, palette, varOpts),
      problems,
    });
  }
  const usable = statuses.filter((s) => s.usable);
  if (!usable.length) issues.push({ level: "error", field: "schemes", message: "No colour scheme can be used yet. Fix one, or switch one on." });
  else if (!usable.some((s) => s.bookends))
    issues.push({ level: "error", field: "schemes", message: "No usable scheme can open and close a video: the logo must show on it. Upload a logo that shows, or allow a scheme to open and close videos." });

  // The placeholder wordmark is still in use for dark backgrounds while a real logo is up for light ones.
  const isPlaceholder = (rel: string) => /(^|\/)placeholder-logo(-white)?\.svg$/i.test(rel);
  if (isPlaceholder(brand.logo.onDark) && !isPlaceholder(brand.logo.onLight) && statuses.some((s) => s.enabled && s.logo === "onDark"))
    issues.push({
      level: "warning",
      field: "logo.onDark",
      message: "Dark schemes still show the placeholder logo made from the brand name. Upload a white or reversed logo, or use Make a white version.",
    });

  // ---- sizes ----
  for (const f of Object.values(cfg.formats)) {
    const body = brand.typeScale.body * f.typeMultiplier;
    if (body < cfg.minimumTextPx.body)
      issues.push({ level: "error", field: "typeScale.body", message: `Body text would be ${body.toFixed(0)} px in ${f.label}. It must be at least ${cfg.minimumTextPx.body} px.` });
    const cap = brand.typeScale.caption * f.typeMultiplier;
    const capBox = Math.round(cap) * 1.3 * 2 + 2 * Math.round(brand.spacing.unit * f.typeMultiplier);
    if (capBox > f.captionBand) {
      const maxCap = Math.floor((f.captionBand - 2 * brand.spacing.unit * f.typeMultiplier) / 2.6 / f.typeMultiplier);
      issues.push({ level: "error", field: "typeScale.caption", message: `Two lines of captions would not fit the caption band in ${f.label}. Use a caption size of ${maxCap} or less.` });
    }
    if (cap < cfg.minimumTextPx.caption)
      issues.push({ level: "error", field: "typeScale.caption", message: `Captions would be ${cap.toFixed(0)} px in ${f.label}. They must be at least ${cfg.minimumTextPx.caption} px.` });
  }

  for (const p of brand.provisional) issues.push({ level: "warning", field: "provisional", message: `${p} is provisional and still needs confirming.` });

  const find = (s: Scheme | string) => (typeof s === "string" ? brand.schemes.find((x) => x.id === s) : s);
  return {
    brand,
    dir,
    migrated: false,
    colour,
    colourName: name,
    scheme: (id) => brand.schemes.find((s) => s.id === id),
    schemes: () => statuses,
    usableSchemes: () => statuses.filter((s) => s.usable),
    bookendSchemes: () => statuses.filter((s) => s.bookends),
    schemeVars: (s) => {
      const sc = find(s);
      if (!sc) throw new Error(`There is no scheme called "${String(s)}" in brand ${brand.id}.`);
      return coreSchemeVars(sc, palette, varOpts);
    },
    logoFor: (s) => {
      const sc = find(s);
      return sc ? coreLogoVariant(sc, palette) : "onDark";
    },
    emphasisWeight,
    file: (rel) => path.join(dir, rel),
    contrast,
    issues,
    ok: !issues.some((i) => i.level === "error" && i.blocking !== false),
  };
}

export function assertBrandOk(b: LoadedBrand): void {
  if (b.ok) return;
  const lines = b.issues.filter((i) => i.level === "error" && i.blocking !== false).map((i) => `- ${i.field}: ${i.message}`);
  throw new Error(`Brand "${b.brand.id}" has problems that stop rendering:\n${lines.join("\n")}`);
}

/** Path of a font face inside the build folder, relative to index.html. */
export function fontAssetName(src: string): string {
  return "assets/brand/" + src.replace(/[\\/]/g, "_");
}
export function brandAssetName(src: string): string {
  return "assets/brand/" + src.replace(/[\\/]/g, "_");
}

/** CSS class of a scheme on a scene. */
export function schemeClass(id: string): string {
  return `scheme-${id}`;
}

export interface BrandCssOptions {
  /**
   * Live preview: one scheme's variables on :root instead of a class per scheme, so the web app can change them
   * in place on every colour input.
   */
  live?: Scheme;
}

/** CSS custom properties (tokens), scheme classes and font faces for one format. */
export function brandCss(b: LoadedBrand, format: FormatConfig, assetUrl: (rel: string) => string = fontAssetName, opts: BrandCssOptions = {}): string {
  const br = b.brand;
  const m = format.typeMultiplier;
  const cfg = loadConfig();
  const px = (n: number, min = 0) => `${Math.max(min, Math.round(n * m))}px`;
  const faces = br.fonts.faces
    .map(
      (f) =>
        `@font-face{font-family:"${f.family}";src:url("${assetUrl(f.src)}") format("${fontFormat(f.src)}");font-weight:${f.weight};font-style:${f.style};font-display:block;${f.unicodeRange ? `unicode-range:${f.unicodeRange};` : ""}}`,
    )
    .join("\n");
  const vars: Record<string, string> = {};
  for (const c of expandPalette(br.palette)) vars[refVar(c.ref)] = c.value;
  vars["--caption-bg"] = b.colour(br.captions.background);
  vars["--caption-text"] = b.colour(br.captions.text);
  vars["--caption-weight"] = String(br.captions.weight);
  vars["--font-heading"] = `"${br.fonts.heading.family}"`;
  vars["--font-body"] = `"${br.fonts.body.family}"`;
  vars["--weight-heading"] = String(br.fonts.heading.weight);
  vars["--weight-body"] = String(br.fonts.body.weight);
  vars["--t-display"] = px(br.typeScale.display);
  vars["--t-heading"] = px(br.typeScale.heading);
  vars["--t-body"] = px(br.typeScale.body, cfg.minimumTextPx.body);
  vars["--t-label"] = px(br.typeScale.label, cfg.minimumTextPx.body);
  vars["--t-caption"] = px(br.typeScale.caption, cfg.minimumTextPx.caption);
  vars["--lh-display"] = String(br.lineHeight.display);
  vars["--lh-heading"] = String(br.lineHeight.heading);
  vars["--lh-body"] = String(br.lineHeight.body);
  vars["--ls-display"] = `${br.letterSpacing.display}em`;
  vars["--ls-heading"] = `${br.letterSpacing.heading}em`;
  const u = br.spacing.unit;
  for (let i = 1; i <= 16; i++) vars[`--sp-${i}`] = `${Math.round(u * i * m)}px`;
  vars["--radius"] = `${br.radius}px`;
  vars["--logo-h"] = `${Math.max(br.logo.minHeight, Math.round(72 * m))}px`;
  if (opts.live) Object.assign(vars, b.schemeVars(opts.live));
  const decl = (o: Record<string, string>) =>
    Object.entries(o)
      .map(([k, v]) => `${k}:${v};`)
      .join("");
  const classes = opts.live ? "" : br.schemes.map((s) => `.${schemeClass(s.id)}{${decl(b.schemeVars(s))}}`).join("\n");
  return `${faces}\n:root{${decl(vars)}}${classes ? `\n${classes}` : ""}`;
}

function fontFormat(src: string): string {
  const ext = path.extname(src).toLowerCase();
  return ext === ".woff2" ? "woff2" : ext === ".woff" ? "woff" : ext === ".otf" ? "opentype" : "truetype";
}

/** Every font family/weight pair the page uses, for explicit loading before frame 0. */
export function fontLoadList(b: LoadedBrand): string[] {
  const br = b.brand;
  const set = new Set<string>();
  set.add(`${br.fonts.heading.weight} 40px "${br.fonts.heading.family}"`);
  set.add(`${br.fonts.body.weight} 40px "${br.fonts.body.family}"`);
  set.add(`${br.captions.weight} 40px "${br.fonts.body.family}"`);
  if (br.schemes.some((s) => s.emphasis !== "colour")) set.add(`${b.emphasisWeight} 40px "${br.fonts.heading.family}"`);
  return [...set];
}

export { AAA };
