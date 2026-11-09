// Create, read, update and delete brands, and add or remove their files.
// The web app's brand manager and scripts/brand-import.ts both use these functions.
// Every write goes through the same checks as rendering, so what the app shows is what will render.
import fs from "node:fs";
import path from "node:path";
import { BRANDS_DIR } from "../paths";
import { BrandSchema, ICON_WEIGHTS, type Brand, type IconWeight } from "../schema";
import { inspectBrand, type BrandIssue, type ContrastPair } from "../brand";
import { canonicalIconName } from "../icons/library";
import { inspectFontFile, installOpenFont, textToPath, FONT_EXTENSIONS, type FontFileInfo } from "./fonts";
import { inspectImage, sanitiseUploadedSvg, prepareIconSvg, logoWarnings, svgColours } from "./assets";
import { assignColourRoles, proposeSurfaces } from "./palette";
import { logoVisibility, LOGO_ERROR_SHARE } from "../logocheck";

export const BRAND_ID = /^[a-z0-9][a-z0-9-]{0,62}$/;
/** The sample brand. It can be copied and edited, but not deleted. */
export const PROTECTED_BRANDS = ["demo"];

export interface BrandCheck {
  ok: boolean;
  brand?: Brand;
  issues: BrandIssue[];
  contrast: ContrastPair[];
}

export interface BrandFiles {
  fonts: Array<{ file: string; info?: FontFileInfo; error?: string; usedBy: string[] }>;
  logos: Array<{ file: string; kind: string; usedAs: Array<"onLight" | "onDark"> }>;
  icons: Array<{ file: string; name: string; weight?: IconWeight; overridesLibrary: boolean }>;
  graphics: Array<{ file: string; kind: string }>;
  documents: string[];
}

export interface BrandRecord {
  id: string;
  dir: string;
  /** brand.json as stored. */
  raw: Record<string, unknown>;
  check: BrandCheck;
  files: BrandFiles;
}

// ---------- paths and checks ----------

export function brandFolder(id: string): string {
  if (!BRAND_ID.test(id)) throw new Error("A brand id uses lower-case letters, numbers and hyphens, such as northvale-council.");
  return path.join(BRANDS_DIR, id);
}

export function brandExists(id: string): boolean {
  return BRAND_ID.test(id) && fs.existsSync(path.join(BRANDS_DIR, id, "brand.json"));
}

/** A brand id made from a name, without checking it is free: "Northvale Council" becomes "northvale-council". */
export function slugifyBrandName(name: string): string {
  const base =
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 50) || "brand";
  return /^[a-z0-9]/.test(base) ? base : `b-${base}`;
}

/** A free brand id made from a name: "Northvale Council" becomes "northvale-council" (or "-2" and so on if taken). */
export function brandIdFromName(name: string): string {
  const base = slugifyBrandName(name);
  let id = base;
  let n = 2;
  while (fs.existsSync(path.join(BRANDS_DIR, id))) id = `${base}-${n++}`;
  return id;
}

/** Check brand JSON against a folder of files without saving. Never throws. Same checks as rendering. */
export function checkBrand(raw: unknown, dir: string): BrandCheck {
  const r = BrandSchema.safeParse(raw);
  if (!r.success) {
    return { ok: false, issues: r.error.issues.map((i) => ({ level: "error" as const, field: i.path.join("."), message: i.message })), contrast: [] };
  }
  try {
    const b = inspectBrand(r.data, path.resolve(dir));
    return { ok: b.ok, brand: r.data, issues: b.issues, contrast: b.contrast };
  } catch (e) {
    return { ok: false, brand: r.data, issues: [{ level: "error", field: "brand", message: (e as Error).message }], contrast: [] };
  }
}

function readRaw(dir: string): Record<string, unknown> {
  const file = path.join(dir, "brand.json");
  if (!fs.existsSync(file)) throw new Error(`There is no brand in ${path.relative(BRANDS_DIR, dir) || dir}.`);
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeRaw(dir: string, raw: Record<string, unknown>): void {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "brand.json");
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(raw, null, 2) + "\n");
  fs.renameSync(tmp, file);
}

// ---------- read ----------

/** A brand with its checks and a list of its files. */
export function readBrand(id: string): BrandRecord {
  const dir = brandFolder(id);
  const raw = readRaw(dir);
  return { id, dir, raw, check: checkBrand(raw, dir), files: listBrandFiles(id, raw) };
}

/** Every file in a brand folder, grouped, with what uses each one. */
export function listBrandFiles(id: string, rawIn?: Record<string, unknown>): BrandFiles {
  const dir = brandFolder(id);
  const raw = (rawIn ?? readRaw(dir)) as any;
  const walk = (sub: string): string[] => {
    const d = path.join(dir, sub);
    if (!fs.existsSync(d)) return [];
    return fs
      .readdirSync(d, { withFileTypes: true })
      .filter((e) => e.isFile() && !e.name.startsWith("."))
      .map((e) => `${sub}/${e.name}`)
      .sort();
  };
  const faces: Array<{ src: string; family: string; weight: number; style: string }> = raw?.fonts?.faces ?? [];
  const fonts = walk("fonts")
    .filter((f) => FONT_EXTENSIONS.some((e) => f.toLowerCase().endsWith(e)))
    .map((file) => {
      const usedBy = faces.filter((x) => x.src === file).map((x) => `${x.family} ${x.weight}${x.style === "italic" ? " italic" : ""}`);
      try {
        return { file, info: inspectFontFile(path.join(dir, file)), usedBy };
      } catch (e) {
        return { file, error: (e as Error).message, usedBy };
      }
    });
  const logos = walk("logo").map((file) => ({
    file,
    kind: path.extname(file).slice(1).toLowerCase(),
    usedAs: (["onLight", "onDark"] as const).filter((k) => raw?.logo?.[k] === file),
  }));
  const iconsDir = raw?.icons?.dir ?? "icons";
  const icons = walk(iconsDir)
    .filter((f) => f.toLowerCase().endsWith(".svg"))
    .map((file) => {
      const base = path.basename(file, ".svg");
      const m = new RegExp(`^(.+)-(${ICON_WEIGHTS.join("|")})$`).exec(base);
      const name = m && !canonicalIconName(base) ? m[1] : base;
      return { file, name, weight: (m && !canonicalIconName(base) ? m[2] : undefined) as IconWeight | undefined, overridesLibrary: Boolean(canonicalIconName(name)) };
    });
  const graphics = walk(raw?.graphics?.dir ?? "graphics").map((file) => ({ file, kind: path.extname(file).slice(1).toLowerCase() }));
  const documents = [...walk("guidelines"), ...fs.readdirSync(dir).filter((f) => /\.(md|txt|pdf)$/i.test(f))];
  return { fonts, logos, icons, graphics, documents };
}

// ---------- create, update, delete ----------

export interface CreateBrandInput {
  name: string;
  /** Folder name. Made from the name when left out. */
  id?: string;
  /** Brand to copy fonts and tokens from. Default "demo". Its logo, icons and guidelines are not copied. */
  from?: string;
  /** Colours to start with. Roles are guessed and surfaces chosen so every text pair passes AAA. */
  colours?: Array<{ value: string; name?: string; role?: string }>;
  description?: string;
  /** Start from plain placeholder colours (BLANK_COLOURS) instead of the starting brand's colours. */
  blank?: boolean;
}

/** Plain colours for a blank brand. They pass every check, so the preview works before the real colours are in. */
export const BLANK_COLOURS: Array<{ value: string; name: string; role: string }> = [
  { value: "#1F3A5A", name: "Primary", role: "primary" },
  { value: "#0B0C0C", name: "Text", role: "text" },
  { value: "#FFFFFF", name: "Background", role: "background" },
  { value: "#9BE7C4", name: "Accent", role: "accent" },
  { value: "#EFF2F5", name: "Tint", role: "tint" },
];

/** Names for colours by role, used when a new brand starts from another brand's colours. */
const ROLE_NAMES: Record<string, string> = { primary: "Primary", text: "Text", background: "Background", accent: "Accent", tint: "Tint", accent2: "Second accent", line: "Line" };

/**
 * Start a new brand. It copies the starting brand's fonts and tokens, makes a plain placeholder
 * wordmark from the name (so nothing from another organisation appears), and marks everything
 * provisional until the person confirms it.
 */
export function createBrand(input: CreateBrandInput): BrandRecord & { notes: string[] } {
  const name = input.name.trim();
  if (!name) throw new Error("Enter a name for the brand.");
  if (name.length > 80) throw new Error("The brand name must be 80 characters or fewer.");
  const id = input.id ?? brandIdFromName(name);
  const dir = brandFolder(id);
  if (fs.existsSync(dir)) throw new Error(`A brand with the id ${id} already exists. Choose another name or id.`);
  const fromDir = brandFolder(input.from ?? "demo");
  const template = readRaw(fromDir) as any;
  const notes: string[] = [];
  if (input.blank && !input.colours?.length) input = { ...input, colours: BLANK_COLOURS };

  fs.mkdirSync(dir, { recursive: true });
  for (const sub of ["fonts", "logo", "icons", "graphics", "guidelines"]) fs.mkdirSync(path.join(dir, sub), { recursive: true });
  // Fonts: copy only the files the template's faces use, plus licence files.
  const tplFonts = path.join(fromDir, "fonts");
  if (fs.existsSync(tplFonts)) {
    for (const f of fs.readdirSync(tplFonts)) if (/\.(woff2?|ttf|otf|txt)$/i.test(f)) fs.copyFileSync(path.join(tplFonts, f), path.join(dir, "fonts", f));
  }
  const raw: any = structuredClone(template);
  raw.id = id;
  raw.name = name;
  raw.fictional = false;
  // No description by default: the brief interpreter reads it, and a note about the starting brand would
  // steer a client's videos towards that brand.
  if (input.description) raw.description = input.description;
  else delete raw.description;
  raw.provisional = ["colours", "fonts", "logo", "icons", "voice", "tone of voice", "guidelines", "rules"];
  raw.icons = { ...(template.icons ?? {}), dir: "icons" };
  raw.graphics = { dir: "graphics" };
  delete raw.guidelinesFile;
  raw.toneOfVoice = "";
  raw.guidelines = "";
  raw.rules = { do: [], dont: [] };

  // Optional colours the starting brand uses for its own extras (such as a second accent) are not carried
  // over unless the new brand's surfaces or captions use them.
  if (!input.colours?.length) {
    const used = new Set<string>([
      ...Object.values(raw.surfaces ?? {}).flatMap((x: any) => [x.background, x.text, x.accent]),
      raw.captions?.background,
      raw.captions?.text,
      raw.icons?.duotoneColour,
    ]);
    for (const k of ["accent2", "line"]) if (raw.colours?.[k] && !used.has(k)) delete raw.colours[k];
    if (raw.icons?.duotoneColour && !raw.colours?.[raw.icons.duotoneColour]) delete raw.icons.duotoneColour;
    // The starting brand's colour names ("Vale Blue") belong to that brand. Name the copies by role, so
    // messages never call a client's own colour by another organisation's name.
    for (const [k, c] of Object.entries(raw.colours ?? {})) if (c && typeof c === "object") (c as { name?: string }).name = ROLE_NAMES[k] ?? k;
  }

  if (input.colours?.length) {
    const roles = assignColourRoles(input.colours);
    const surf = proposeSurfaces(roles.colours);
    raw.colours = roles.colours;
    raw.surfaces = surf.surfaces;
    raw.captions = { ...raw.captions, ...surf.captions };
    notes.push(...roles.notes, ...surf.notes);
  }

  // Placeholder wordmark in the brand's own heading font.
  writeRaw(dir, raw);
  const logo = writePlaceholderLogo(id);
  raw.logo = { ...raw.logo, ...logo, alt: name };
  writeRaw(dir, raw);
  notes.push("The logo is a plain placeholder made from the name. Upload the real logo.");
  return { ...readBrand(id), notes };
}

/** Copy a brand, files and all, under a new id and name. */
export function duplicateBrand(fromId: string, name: string, id?: string): BrandRecord {
  const src = brandFolder(fromId);
  const newId = id ?? brandIdFromName(name);
  const dest = brandFolder(newId);
  if (fs.existsSync(dest)) throw new Error(`A brand with the id ${newId} already exists.`);
  fs.cpSync(src, dest, { recursive: true });
  const raw: any = readRaw(dest);
  raw.id = newId;
  raw.name = name;
  if (raw.logo) raw.logo.alt = raw.logo.alt === readRaw(src).name ? name : raw.logo.alt;
  writeRaw(dest, raw);
  return readBrand(newId);
}

/**
 * Change a brand. The patch is merged into brand.json: objects merge, arrays and values replace,
 * and null removes a field. The id cannot change. A patch with the wrong shape is not saved;
 * one that fails contrast is saved (so work is not lost) but rendering stays blocked until it passes.
 */
export function updateBrand(id: string, patch: Record<string, unknown>): BrandRecord & { saved: boolean } {
  const dir = brandFolder(id);
  const current = readRaw(dir);
  const next = merge(current, patch) as Record<string, unknown>;
  next.id = id;
  const check = checkBrand(next, dir);
  const shapeOk = BrandSchema.safeParse(next).success;
  if (!shapeOk) return { id, dir, raw: current, check, files: listBrandFiles(id, current), saved: false };
  writeRaw(dir, next);
  return { id, dir, raw: next, check, files: listBrandFiles(id, next), saved: true };
}

/** Mark token groups as confirmed (removes them from provisional), or provisional again. */
export function setProvisional(id: string, groups: string[], provisional: boolean): BrandRecord {
  const raw: any = readRaw(brandFolder(id));
  const cur = new Set<string>(raw.provisional ?? []);
  for (const g of groups) provisional ? cur.add(g) : cur.delete(g);
  return updateBrand(id, { provisional: [...cur] });
}

/** Delete a brand folder. The sample brand cannot be deleted. */
export function deleteBrand(id: string): void {
  if (PROTECTED_BRANDS.includes(id)) throw new Error(`The ${id} brand is the sample brand and cannot be deleted. Copy it instead.`);
  const dir = brandFolder(id);
  if (!fs.existsSync(path.join(dir, "brand.json"))) throw new Error(`There is no brand called ${id}.`);
  fs.rmSync(dir, { recursive: true, force: true });
}

function merge(base: unknown, patch: unknown): unknown {
  if (patch === null) return undefined;
  if (typeof patch !== "object" || Array.isArray(patch) || typeof base !== "object" || base === null || Array.isArray(base)) return structuredClone(patch);
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    const m = merge(out[k], v);
    if (m === undefined) delete out[k];
    else out[k] = m;
  }
  return out;
}

// ---------- files ----------

export type BrandFileKind = "font" | "logo" | "icon" | "graphic" | "document";

export interface AddFileOptions {
  /** Logo: which backgrounds it is for. Default "onLight". "both" uses it everywhere. */
  logoFor?: "onLight" | "onDark" | "both";
  /** Icon: the name scenes use. Default: the file name. A library name overrides that library icon. */
  iconName?: string;
  /** Icon: the weight this file is for. Default: every weight. */
  iconWeight?: IconWeight;
  /** Font: make this family the heading and body font. Default: only when the brand still uses its starting font. */
  useForRoles?: boolean;
  /** Font: weights to register for a variable font. Default [400, 700] within its range. */
  weights?: number[];
}

export interface AddFileResult {
  /** Path relative to the brand folder. */
  file: string;
  warnings: string[];
  brand: BrandRecord;
  font?: FontFileInfo;
}

const safeName = (n: string) =>
  n
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+\./g, ".") || "file";

/** Add a file to a brand (font, logo, icon, graphic or guidelines document) and update brand.json to use it. */
export function addBrandFile(id: string, kind: BrandFileKind, fileName: string, bytes: Buffer, opts: AddFileOptions = {}): AddFileResult {
  const dir = brandFolder(id);
  const raw: any = readRaw(dir);
  const warnings: string[] = [];
  const ext = path.extname(fileName).toLowerCase();
  let rel: string;
  let font: FontFileInfo | undefined;
  if (bytes.length === 0) throw new Error("The selected file is empty.");
  if (bytes.length > 25 * 1024 * 1024) throw new Error("The selected file must be smaller than 25 MB.");

  if (kind === "font") {
    if (!(FONT_EXTENSIONS as readonly string[]).includes(ext)) throw new Error("The selected file must be a WOFF2, WOFF, TTF or OTF font.");
    font = inspectFontFile(bytes, fileName);
    const famSlug = safeName(font.family);
    rel = `fonts/${famSlug}-${font.variable ? "variable" : font.weight}-${font.style}${ext}`;
    fs.mkdirSync(path.join(dir, "fonts"), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), bytes);
    const weights = font.variable ? (opts.weights ?? [400, 700]).filter((w) => w >= font!.weightRange![0] && w <= font!.weightRange![1]) : [font.weight];
    const faces = (raw.fonts.faces as any[]).filter((f) => !(f.family === font!.family && f.style === font!.style && weights.includes(f.weight)));
    for (const w of weights) faces.push({ family: font.family, weight: w, style: font.style, src: rel });
    raw.fonts.faces = faces;
    if (font.missingCharacters.length) warnings.push(`This font has no ${font.missingCharacters.slice(0, 12).join(" ")} characters. Text using them will fall back to another font.`);
    // Switch headings and body text to this font when the brand still has only its starting font.
    const families = new Set((raw.fonts.faces as any[]).map((f) => f.family));
    const onlyStartingFont = raw.provisional?.includes("fonts") && raw.fonts.heading.family === raw.fonts.body.family && families.size === 2;
    const useRoles = opts.useForRoles ?? (onlyStartingFont && font.family !== raw.fonts.body.family);
    if (useRoles && font.style === "normal") {
      const have = (raw.fonts.faces as any[]).filter((f) => f.family === font!.family && f.style === "normal").map((f) => f.weight as number);
      const near = (w: number) => [...have].sort((a, b) => Math.abs(a - w) - Math.abs(b - w))[0];
      raw.fonts.heading = { family: font.family, weight: near(700) };
      raw.fonts.body = { family: font.family, weight: near(400) };
      raw.captions.weight = Math.min(800, Math.max(400, near(400)));
      if (raw.fonts.heading.weight < 600) warnings.push(`There is no bold ${font.family} yet, so headings use weight ${raw.fonts.heading.weight}. Upload the bold file too.`);
      dropUnusedFamilies(raw, dir);
    } else if (font.style === "normal" && !font.variable) {
      // A new weight of a family already in use: use it where it fits better.
      if (font.family === raw.fonts.heading.family && font.weight >= 600 && Math.abs(font.weight - 700) < Math.abs(raw.fonts.heading.weight - 700)) raw.fonts.heading.weight = font.weight;
      if (font.family === raw.fonts.body.family && Math.abs(font.weight - 400) < Math.abs(raw.fonts.body.weight - 400)) {
        raw.fonts.body.weight = font.weight;
        raw.captions.weight = Math.min(800, Math.max(400, font.weight));
      }
    }
  } else if (kind === "logo") {
    const info = inspectImage(bytes, fileName);
    warnings.push(...logoWarnings(info));
    if (info.kind !== "svg" && info.kind !== "png") throw new Error("The selected file must be an SVG or PNG logo.");
    const base = safeName(path.basename(fileName, ext)) || "logo";
    rel = `logo/${base}.${info.kind}`;
    fs.mkdirSync(path.join(dir, "logo"), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), info.kind === "svg" ? sanitiseUploadedSvg(bytes.toString("utf8")) : bytes);
    let target = opts.logoFor ?? "both";
    // "Both": a logo that cannot be seen on the dark surface is used on light backgrounds only, and the person is
    // told that videos (which show the dark-background logo) still need a white or reversed version.
    if (target === "both") {
      const bg = raw.colours?.[raw.surfaces?.dark?.background]?.value;
      const v = bg ? logoVisibility(path.join(dir, rel), bg) : null;
      const lightBg = raw.colours?.[raw.surfaces?.light?.background]?.value;
      const vl = lightBg ? logoVisibility(path.join(dir, rel), lightBg) : null;
      const unseen = (x: typeof v) => Boolean(x && (x.empty || x.visibleShare < LOGO_ERROR_SHARE));
      if (unseen(v) && !unseen(vl)) {
        target = "onLight";
        warnings.push("This logo cannot be seen on the dark background, so it is used on light backgrounds only. Videos show the logo on dark backgrounds: upload a white or reversed version, or use Make a white version.");
      } else if (unseen(vl) && !unseen(v)) {
        target = "onDark";
        warnings.push("This logo cannot be seen on the light background, so it is used on dark backgrounds only. Upload a version for light backgrounds too.");
      }
    }
    if (target === "onLight" || target === "both") raw.logo.onLight = rel;
    if (target === "onDark" || target === "both") raw.logo.onDark = rel;
    removeUnusedPlaceholder(raw, dir);
    if (info.kind === "svg" && target !== "both" && !warnings.some((w) => w.startsWith("This logo cannot be seen"))) {
      const cols = svgColours(bytes.toString("utf8"));
      if (cols.length <= 2)
        warnings.push(
          target === "onLight"
            ? "Videos show the logo on dark backgrounds. Upload a version for dark backgrounds too, or use Make a white version."
            : "Upload a version of the logo for light backgrounds too.",
        );
    }
  } else if (kind === "icon") {
    if (ext !== ".svg") throw new Error("The selected file must be an SVG icon.");
    const prepared = prepareIconSvg(bytes.toString("utf8"));
    warnings.push(...prepared.warnings);
    const name = safeName(opts.iconName ?? path.basename(fileName, ext)).replace(/\./g, "-");
    if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) throw new Error("Icon names use lower-case letters, numbers and hyphens.");
    const iconsDir = raw.icons?.dir ?? "icons";
    rel = `${iconsDir}/${name}${opts.iconWeight ? `-${opts.iconWeight}` : ""}.svg`;
    fs.mkdirSync(path.join(dir, iconsDir), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), prepared.svg);
    if (canonicalIconName(name)) warnings.push(`This replaces the library icon "${name}" in this brand's videos.`);
  } else if (kind === "graphic") {
    const info = inspectImage(bytes, fileName);
    if (info.kind === "png" && (info.width ?? 0) < 800) warnings.push("This picture is small and may look soft in a 1080p video.");
    const graphicsDir = raw.graphics?.dir ?? "graphics";
    rel = `${graphicsDir}/${safeName(path.basename(fileName, ext))}.${info.kind === "jpeg" ? "jpg" : info.kind}`;
    fs.mkdirSync(path.join(dir, graphicsDir), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), info.kind === "svg" ? sanitiseUploadedSvg(bytes.toString("utf8")) : bytes);
  } else if (kind === "document") {
    if (!/\.(pdf|md|txt)$/i.test(ext)) throw new Error("The selected file must be a PDF, Markdown or text file.");
    rel = `guidelines/${safeName(path.basename(fileName, ext))}${ext}`;
    fs.mkdirSync(path.join(dir, "guidelines"), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), bytes);
  } else {
    throw new Error(`Unknown file kind: ${kind}`);
  }
  writeRaw(dir, raw);
  return { file: rel, warnings, brand: readBrand(id), font };
}

/** Remove a file from a brand and any font faces that point at it. Logos in use cannot be removed. */
export function removeBrandFile(id: string, rel: string): BrandRecord {
  const dir = brandFolder(id);
  const raw: any = readRaw(dir);
  if (rel.startsWith("/") || rel.split(/[\\/]/).includes("..") || rel === "brand.json") throw new Error("That file cannot be removed.");
  if (raw.logo?.onLight === rel || raw.logo?.onDark === rel) throw new Error("That logo is in use. Upload or choose another logo first.");
  fs.rmSync(path.join(dir, rel), { force: true });
  if (Array.isArray(raw.fonts?.faces)) raw.fonts.faces = raw.fonts.faces.filter((f: any) => f.src !== rel);
  if (!raw.fonts.faces.length) throw new Error("A brand needs at least one font. Add another font before removing this one.");
  writeRaw(dir, raw);
  return readBrand(id);
}

/** Download an open font (such as one from Google Fonts) into the brand and use it for headings and body text. */
export async function useOpenFont(id: string, family: string, opts: { weights?: number[]; roles?: boolean } = {}): Promise<BrandRecord & { warnings: string[] }> {
  const dir = brandFolder(id);
  const got = await installOpenFont(dir, family, { weights: opts.weights ?? [400, 700] });
  const raw: any = readRaw(dir);
  const faces = (raw.fonts.faces as any[]).filter((f) => f.family !== got.family);
  raw.fonts.faces = [...faces, ...got.faces];
  const warnings: string[] = [];
  if (opts.roles !== false) {
    const weights = [...new Set(got.faces.map((f) => f.weight))];
    const near = (w: number) => [...weights].sort((a, b) => Math.abs(a - w) - Math.abs(b - w))[0];
    raw.fonts.heading = { family: got.family, weight: near(700) };
    raw.fonts.body = { family: got.family, weight: near(400) };
    raw.captions.weight = Math.min(800, Math.max(400, near(400)));
  }
  if (got.missingWeights.length) warnings.push(`${got.family} has no ${got.missingWeights.join(" or ")} weight.`);
  if (opts.roles !== false) dropUnusedFamilies(raw, dir);
  writeRaw(dir, raw);
  return { ...readBrand(id), warnings };
}

/** Remove faces (and their files) of font families that no role uses any more, so old fonts do not pile up. */
function dropUnusedFamilies(raw: any, dir: string): void {
  const roles = new Set([raw.fonts.heading?.family, raw.fonts.body?.family]);
  const drop = (raw.fonts.faces as any[]).filter((f) => !roles.has(f.family));
  raw.fonts.faces = (raw.fonts.faces as any[]).filter((f) => roles.has(f.family));
  const stillUsed = new Set((raw.fonts.faces as any[]).map((f) => f.src));
  for (const f of drop) if (!stillUsed.has(f.src)) fs.rmSync(path.join(dir, f.src), { force: true });
}

// ---------- logos ----------

/**
 * A plain placeholder wordmark: the brand name as vector outlines in the brand's heading font,
 * in the text colour (for light backgrounds) and white (for dark backgrounds).
 */
export function writePlaceholderLogo(id: string): { onLight: string; onDark: string } {
  const dir = brandFolder(id);
  const raw: any = readRaw(dir);
  const face =
    (raw.fonts.faces as any[]).find((f) => f.family === raw.fonts.heading.family && f.weight === raw.fonts.heading.weight && !f.unicodeRange) ??
    (raw.fonts.faces as any[]).find((f) => f.family === raw.fonts.heading.family && f.weight === raw.fonts.heading.weight);
  if (!face) throw new Error("The brand has no heading font file, so a placeholder logo cannot be made.");
  const name = String(raw.name);
  const t = textToPath(path.join(dir, face.src), name, 4, 70, 64);
  const width = Math.ceil(t.width + 8);
  const svg = (colour: string) =>
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} 100" width="${width}" height="100" role="img" aria-label="${escapeXml(name)} (placeholder logo)"><title>${escapeXml(name)}</title><path d="${t.d}" fill="${colour}"/></svg>\n`;
  fs.mkdirSync(path.join(dir, "logo"), { recursive: true });
  const text = raw.colours?.text?.value ?? "#0B0C0C";
  const white = raw.colours?.background?.value ?? "#FFFFFF";
  fs.writeFileSync(path.join(dir, "logo", "placeholder-logo.svg"), svg(text));
  fs.writeFileSync(path.join(dir, "logo", "placeholder-logo-white.svg"), svg(white));
  return { onLight: "logo/placeholder-logo.svg", onDark: "logo/placeholder-logo-white.svg" };
}

/**
 * Make a one-colour white version of an SVG logo for dark backgrounds and use it as logo.onDark.
 * Only for simple logos: guidelines often forbid recolouring, so the web app should ask first.
 */
export function makeReverseLogo(id: string, rel?: string): BrandRecord & { file: string; warnings: string[] } {
  const dir = brandFolder(id);
  const raw: any = readRaw(dir);
  const src = rel ?? raw.logo.onLight;
  if (!src.toLowerCase().endsWith(".svg")) throw new Error("Only SVG logos can be turned white. Upload a white version instead.");
  const svg = fs.readFileSync(path.join(dir, src), "utf8");
  const white = raw.colours?.background?.value ?? "#FFFFFF";
  const cols = svgColours(svg);
  let out = svg;
  for (const c of cols) out = out.replace(new RegExp(c.replace("#", "#?") + "\\b", "gi"), white);
  out = out.replace(/(fill|stroke|stop-color)\s*([:=])\s*(["']?)(black|white|rgb\([^)]*\))/gi, `$1$2$3${white}`);
  if (!/fill=/.test(out.slice(0, out.indexOf(">")))) out = out.replace(/<svg\b/i, `<svg fill="${white}"`);
  const file = src.replace(/\.svg$/i, "-white.svg");
  fs.writeFileSync(path.join(dir, file), out);
  raw.logo.onDark = file;
  removeUnusedPlaceholder(raw, dir);
  writeRaw(dir, raw);
  const warnings = cols.length > 2 ? ["The logo has several colours. Check the white version keeps its meaning, or upload the official reversed logo."] : [];
  return { ...readBrand(id), file, warnings };
}

/** Remove the placeholder wordmark once real logos replace it on both backgrounds. */
function removeUnusedPlaceholder(raw: any, dir: string): void {
  if (String(raw.logo.onLight).includes("placeholder-logo") || String(raw.logo.onDark).includes("placeholder-logo")) return;
  for (const f of ["placeholder-logo.svg", "placeholder-logo-white.svg"]) fs.rmSync(path.join(dir, "logo", f), { force: true });
}

function escapeXml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);
}
