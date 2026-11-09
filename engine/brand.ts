// Brand pack loader. Reads brands/<id>/brand.json, checks it, and turns tokens into CSS.
// Scenes only ever see CSS variables made here, so a new brand folder changes the look with no code changes.
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { BRANDS_DIR } from "./paths";
import { BrandSchema, type Brand, type SurfaceId, SURFACE_IDS } from "./schema";
import { colourDifference, MIN_HIGHLIGHT_DIFFERENCE, checkContrast, AAA_SAFE, type ContrastResult } from "./contrast";
import { loadConfig, type FormatConfig } from "./config";
import { logoVisibility, LOGO_ERROR_SHARE, LOGO_WARN_SHARE } from "./logocheck";

export interface BrandIssue {
  level: "error" | "warning";
  /** Where the problem is, such as colours.accent or surfaces.dark. */
  field: string;
  message: string;
}

export interface ContrastPair {
  id: string;
  label: string;
  result: ContrastResult;
}

export interface LoadedBrand {
  brand: Brand;
  dir: string;
  /** Hex value for a colour token name. */
  colour(name: string): string;
  surface(id: SurfaceId): { background: string; text: string; accent: string };
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
          errors: b.issues.filter((i) => i.level === "error").map((i) => `${i.field}: ${i.message}`),
        };
      } catch (e) {
        return { id: d.name, name: d.name, fictional: false, provisional: [], ok: false, errors: [(e as Error).message] };
      }
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** Parse brand JSON (an object) without touching the disk. Throws with readable messages. */
export function parseBrand(raw: unknown): Brand {
  const parsed = BrandSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`brand.json is not valid:\n${z.prettifyError(parsed.error)}`);
  return parsed.data;
}

export function loadBrand(idOrDir: string): LoadedBrand {
  const dir = brandDir(idOrDir);
  const file = path.join(dir, "brand.json");
  if (!fs.existsSync(file)) throw new Error(`No brand.json found in ${dir}`);
  const brand = parseBrand(JSON.parse(fs.readFileSync(file, "utf8")));
  return inspectBrand(brand, dir);
}

/** Check a parsed brand against its folder: colours, contrast, font files, logo files. */
export function inspectBrand(brand: Brand, dir: string): LoadedBrand {
  const issues: BrandIssue[] = [];
  const colours = brand.colours as Record<string, { value: string; name?: string } | undefined>;

  const colour = (name: string): string => {
    const c = colours[name];
    if (!c) throw new Error(`Colour token "${name}" is not defined in brand ${brand.id}`);
    return c.value.toUpperCase();
  };
  const label = (name: string) => colours[name]?.name ?? name;

  // Every colour name a surface or the captions use must exist.
  const refs: Array<[string, string]> = [];
  for (const s of SURFACE_IDS) {
    for (const k of ["background", "text", "accent"] as const) refs.push([`surfaces.${s}.${k}`, brand.surfaces[s][k]]);
  }
  refs.push(["captions.background", brand.captions.background], ["captions.text", brand.captions.text]);
  if (brand.icons.duotoneColour) refs.push(["icons.duotoneColour", brand.icons.duotoneColour]);
  for (const [field, name] of refs) {
    if (!colours[name]) issues.push({ level: "error", field, message: `Refers to a colour called "${name}", which is not defined.` });
  }

  // Contrast: AAA for every text pairing the engine can produce.
  const contrast: ContrastPair[] = [];
  const pair = (id: string, lbl: string, fgName: string, bgName: string) => {
    if (!colours[fgName] || !colours[bgName]) return;
    const result = checkContrast(colour(fgName), colour(bgName), { foreground: label(fgName), background: label(bgName) });
    contrast.push({ id, label: lbl, result });
    if (!result.passesAAA) issues.push({ level: "error", field: id, message: result.message });
    else if (result.ratio < AAA_SAFE)
      issues.push({
        level: "warning",
        field: id,
        message: `${label(fgName)} on ${label(bgName)} passes AAA, but only just (${result.ratioText} to 1). Browsers and social media apps can show video colours slightly lighter, which can take it under 7 to 1. A contrast of ${AAA_SAFE} to 1 or more is safer.`,
      });
  };
  for (const s of SURFACE_IDS) {
    const surf = brand.surfaces[s];
    pair(`surfaces.${s}.text`, `Text on the ${s} background`, surf.text, surf.background);
    pair(`surfaces.${s}.accent`, `Highlighted words on the ${s} background`, surf.accent, surf.background);
  }
  pair("captions", "Caption text on the caption box", brand.captions.text, brand.captions.background);

  // Highlighted words must stand out from the text around them, not only from the background.
  for (const s of SURFACE_IDS) {
    const surf = brand.surfaces[s];
    if (!colours[surf.accent] || !colours[surf.text]) continue;
    const diff = colourDifference(colour(surf.accent), colour(surf.text));
    if (diff < MIN_HIGHLIGHT_DIFFERENCE)
      issues.push({
        level: "warning",
        field: `surfaces.${s}.accent`,
        message: `On the ${s} background, highlighted words (${label(surf.accent)}) look almost the same as the other text (${label(surf.text)}), so the highlight will not stand out. Choose a highlight colour that is clearly different.`,
      });
  }

  // Fonts: the heading and body roles must have a face file at their weight, and files must exist.
  for (const face of brand.fonts.faces) {
    const p = path.join(dir, face.src);
    if (!fs.existsSync(p)) issues.push({ level: "error", field: "fonts.faces", message: `Font file ${face.src} is missing.` });
    else if (!/\.(woff2|woff|ttf|otf)$/i.test(face.src))
      issues.push({ level: "error", field: "fonts.faces", message: `${face.src} is not a font file. Use WOFF2, WOFF, TTF or OTF.` });
  }
  for (const role of ["heading", "body"] as const) {
    const r = brand.fonts[role];
    const has = brand.fonts.faces.some((f) => f.family === r.family && f.weight === r.weight && f.style === "normal");
    if (!has)
      issues.push({
        level: "error",
        field: `fonts.${role}`,
        message: `No font file for ${r.family} at weight ${r.weight}. Upload that weight or pick another.`,
      });
  }
  const capWeightOk = brand.fonts.faces.some((f) => f.family === brand.fonts.body.family && f.weight === brand.captions.weight);
  if (!capWeightOk)
    issues.push({ level: "error", field: "captions.weight", message: `No ${brand.fonts.body.family} file at weight ${brand.captions.weight} for captions.` });

  // Logos.
  for (const k of ["onLight", "onDark"] as const) {
    const rel = brand.logo[k];
    const p = path.join(dir, rel);
    if (!fs.existsSync(p)) issues.push({ level: "error", field: `logo.${k}`, message: `Logo file ${rel} is missing.` });
    else if (!/\.(svg|png)$/i.test(rel)) issues.push({ level: "error", field: `logo.${k}`, message: `Use an SVG or PNG logo.` });
    else if (/\.png$/i.test(rel)) issues.push({ level: "warning", field: `logo.${k}`, message: `PNG logos can look soft. An SVG stays sharp at every size.` });
  }

  // Videos show the dark-background logo (Title, End card). If a real logo was uploaded for light backgrounds
  // only, the video still shows the placeholder wordmark, so say so.
  const isPlaceholder = (rel: string) => /(^|\/)placeholder-logo(-white)?\.svg$/i.test(rel);
  if (isPlaceholder(brand.logo.onDark) && !isPlaceholder(brand.logo.onLight))
    issues.push({
      level: "warning",
      field: "logo.onDark",
      message:
        "Videos show the logo for dark backgrounds, and that is still the placeholder made from the brand name, so your uploaded logo does not appear in videos. Upload a white or reversed logo for dark backgrounds, or use Make a white version in the Logo section.",
    });

  // Logos must be seen on the background they are drawn on: at least 3 to 1 non-text contrast for most of the
  // logo. The dark-background logo is drawn on the dark surface (Title, End card); the light one is not used in
  // videos yet, so a problem with it is only a warning.
  for (const [k, surfaceId] of [["onDark", "dark"], ["onLight", "light"]] as const) {
    const rel = brand.logo[k];
    const bgName = brand.surfaces[surfaceId].background;
    if (!colours[bgName] || !/\.(svg|png)$/i.test(rel)) continue;
    const v = logoVisibility(path.join(dir, rel), colour(bgName));
    if (!v) continue;
    const where = k === "onDark" ? "dark backgrounds" : "light backgrounds";
    const bgText = `${label(bgName)} (${colour(bgName)})`;
    const fix =
      k === "onDark"
        ? "Upload a white or reversed logo for dark backgrounds, or use Make a white version in the Logo section."
        : "Upload a logo made for light backgrounds. Videos do not use this one yet.";
    if (v.empty) {
      issues.push({ level: k === "onDark" ? "error" : "warning", field: `logo.${k}`, message: `The logo for ${where} draws nothing that can be seen. ${fix}` });
    } else if (v.visibleShare < LOGO_ERROR_SHARE) {
      issues.push({
        level: k === "onDark" ? "error" : "warning",
        field: `logo.${k}`,
        message: `The logo for ${where} cannot be seen on ${bgText}: only ${Math.round(v.visibleShare * 100)}% of it stands out (it needs a contrast of at least 3 to 1). ${fix}`,
      });
    } else if (v.visibleShare < LOGO_WARN_SHARE) {
      issues.push({
        level: "warning",
        field: `logo.${k}`,
        message: `Part of the logo for ${where} disappears on ${bgText}: ${Math.round((1 - v.visibleShare) * 100)}% of it is too close to the background colour. Check the preview. ${fix}`,
      });
    }
  }

  // Minimum text sizes from config.
  const cfg = loadConfig();
  for (const f of Object.values(cfg.formats)) {
    const body = brand.typeScale.body * f.typeMultiplier;
    if (body < cfg.minimumTextPx.body)
      issues.push({ level: "error", field: "typeScale.body", message: `Body text would be ${body.toFixed(0)} px in ${f.label}. It must be at least ${cfg.minimumTextPx.body} px.` });
    const cap = brand.typeScale.caption * f.typeMultiplier;
    // Two caption lines (line height 1.3) plus the box padding must fit the caption band.
    const capBox = Math.round(cap) * 1.3 * 2 + 2 * Math.round(brand.spacing.unit * f.typeMultiplier);
    if (capBox > f.captionBand) {
      const maxCap = Math.floor((f.captionBand - 2 * brand.spacing.unit * f.typeMultiplier) / 2.6 / f.typeMultiplier);
      issues.push({ level: "error", field: "typeScale.caption", message: `Two lines of captions would not fit the caption band in ${f.label}. Use a caption size of ${maxCap} or less.` });
    }
    if (cap < cfg.minimumTextPx.caption)
      issues.push({ level: "error", field: "typeScale.caption", message: `Captions would be ${cap.toFixed(0)} px in ${f.label}. They must be at least ${cfg.minimumTextPx.caption} px.` });
  }

  for (const p of brand.provisional) {
    issues.push({ level: "warning", field: "provisional", message: `${p} is provisional and still needs confirming.` });
  }

  return {
    brand,
    dir,
    colour,
    surface: (id) => ({
      background: colour(brand.surfaces[id].background),
      text: colour(brand.surfaces[id].text),
      accent: colour(brand.surfaces[id].accent),
    }),
    file: (rel) => path.join(dir, rel),
    contrast,
    issues,
    ok: !issues.some((i) => i.level === "error"),
  };
}

export function assertBrandOk(b: LoadedBrand): void {
  if (b.ok) return;
  const lines = b.issues.filter((i) => i.level === "error").map((i) => `- ${i.field}: ${i.message}`);
  throw new Error(`Brand "${b.brand.id}" has problems that stop rendering:\n${lines.join("\n")}`);
}

/** Path of a font face inside the build folder, relative to index.html. */
export function fontAssetName(src: string): string {
  return "assets/brand/" + src.replace(/[\\/]/g, "_");
}
export function brandAssetName(src: string): string {
  return "assets/brand/" + src.replace(/[\\/]/g, "_");
}

/** CSS custom properties (tokens) and font faces for one format. */
export function brandCss(b: LoadedBrand, format: FormatConfig, assetUrl: (rel: string) => string = fontAssetName): string {
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
  for (const [name, tok] of Object.entries(br.colours)) if (tok) vars[`--c-${name}`] = tok.value;
  for (const s of SURFACE_IDS) {
    const surf = b.surface(s);
    vars[`--${s}-bg`] = surf.background;
    vars[`--${s}-text`] = surf.text;
    vars[`--${s}-accent`] = surf.accent;
  }
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
  const root = Object.entries(vars)
    .map(([k, v]) => `${k}:${v};`)
    .join("");
  return `${faces}\n:root{${root}}`;
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
  return [...set];
}
