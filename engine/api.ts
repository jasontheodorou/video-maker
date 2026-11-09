// Programmatic API for the web server. Import from "engine/api" (or "engine").
// Everything here is safe to call from a long-running process.
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { BRANDS_DIR, JOBS_DIR, jobPaths } from "./paths";
import { loadConfig, FORMAT_IDS, type FormatId } from "./config";
import { BrandSchema, type Brand } from "./schema";
import { loadBrand, inspectBrand, listBrands, brandDir, type LoadedBrand, type BrandIssue, type ContrastPair } from "./brand";
import { SpecSchema, type Spec } from "./spec";
import { SCENES, sceneCatalogue, getScene } from "./scenes";
import { compileStill, writePage } from "./compile";
import { newPage, retainBrowser, releaseBrowser } from "./browser";
import { getFormat } from "./config";
import { listIcons, iconBriefing } from "./icons";
import { KOKORO_VOICES } from "./voice";
import { decideSize } from "./size";

export { makeVideo, prepareJob, STEPS, PipelineError, StoppedError, type MakeOptions, type MakeResult, type ProgressEvent, type OnProgress, type StepName } from "./pipeline";
export { checkContrast, contrastRatio, suggestPassingColour, AAA } from "./contrast";
export { listMedia, mediaManifest, PhotoRef, ClipRef, MEDIA_DIR, PHOTO_EXT, CLIP_EXT, type MediaInfo } from "./media";
export { chooseTransition } from "./transitions";
export { listBrands, loadBrand, sceneCatalogue, listIcons, KOKORO_VOICES, decideSize, loadConfig, FORMAT_IDS };
export type { Spec, Brand, LoadedBrand, BrandIssue, ContrastPair, FormatId };
// Icon library and brand module (create, update, files, fonts, import, guidelines). See CONTRACTS.md sections 4 and 8.
export { searchIcons, checkIconName, suggestIconNames, iconInfo, loadIconIndex, renderIcon, iconBriefing, type IconSearchResult, type IconSearchOptions, type IconIndexEntry, type IconNameCheck } from "./icons";
export * from "./brand/index";

// ---------- specs ----------

export interface Issue {
  path: string;
  message: string;
}

/** Check a spec without throwing. Use before makeVideo to show problems to a person. */
export function validateSpec(raw: unknown): { ok: true; spec: Spec; issues: [] } | { ok: false; issues: Issue[] } {
  const r = SpecSchema.safeParse(raw);
  if (r.success) return { ok: true, spec: r.data, issues: [] };
  return { ok: false, issues: r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) };
}

/** The JSON Schema of the spec, for a brief interpreter that uses structured output. */
export function specJsonSchema(): unknown {
  return z.toJSONSchema(SpecSchema, { io: "input", unrepresentable: "any" });
}

// ---------- brands ----------

export interface BrandCheck {
  ok: boolean;
  /** Present when brand.json itself is valid. */
  brand?: Brand;
  /** Schema problems (wrong shape) and brand problems (contrast, missing files, sizes). */
  issues: BrandIssue[];
  /** Every text colour pairing with its AAA result and a plain-English message. */
  contrast: ContrastPair[];
}

/** Check brand JSON (an object) against a folder of brand files. Never throws. */
export function validateBrand(raw: unknown, dir: string): BrandCheck {
  const r = BrandSchema.safeParse(raw);
  if (!r.success) {
    return {
      ok: false,
      issues: r.error.issues.map((i) => ({ level: "error" as const, field: i.path.join("."), message: i.message })),
      contrast: [],
    };
  }
  try {
    const b = inspectBrand(r.data, dir);
    return { ok: b.ok, brand: r.data, issues: b.issues, contrast: b.contrast };
  } catch (e) {
    return { ok: false, brand: r.data, issues: [{ level: "error", field: "brand", message: (e as Error).message }], contrast: [] };
  }
}

/**
 * Write brand.json into brands/<id>/ (or a given folder). The JSON must match the schema.
 * Brand problems such as failing contrast do not stop the save, but they stop rendering;
 * the returned check lists them so the web app can show them.
 */
export function saveBrand(raw: unknown, opts: { dir?: string } = {}): BrandCheck & { file?: string } {
  const r = BrandSchema.safeParse(raw);
  if (!r.success) return validateBrand(raw, opts.dir ?? BRANDS_DIR);
  const dir = path.resolve(opts.dir ?? path.join(BRANDS_DIR, r.data.id));
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "brand.json");
  fs.writeFileSync(file, JSON.stringify(raw, null, 2) + "\n");
  return { ...validateBrand(raw, dir), file };
}

/**
 * Start a new brand by copying an existing one (fonts, logos, icons and tokens), then renaming it.
 * Every token group is marked provisional until the person confirms it.
 */
export function scaffoldBrand(id: string, name: string, from = "demo"): BrandCheck & { dir: string } {
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(id)) throw new Error("Use lower-case letters, numbers and hyphens for the brand id");
  const src = brandDir(from);
  const dest = path.join(BRANDS_DIR, id);
  if (fs.existsSync(dest)) throw new Error(`A brand called ${id} already exists`);
  fs.cpSync(src, dest, { recursive: true });
  const raw = JSON.parse(fs.readFileSync(path.join(dest, "brand.json"), "utf8"));
  raw.id = id;
  raw.name = name;
  raw.fictional = false;
  // No description: the brief interpreter reads it, so a note about the starting brand would steer the scripts.
  delete raw.description;
  raw.provisional = ["colours", "fonts", "logo", "voice", "icons", "tone of voice", "guidelines"];
  if (raw.logo) raw.logo.alt = name;
  delete raw.guidelinesFile;
  fs.rmSync(path.join(dest, "guidelines.md"), { force: true });
  fs.writeFileSync(path.join(dest, "brand.json"), JSON.stringify(raw, null, 2) + "\n");
  return { ...validateBrand(raw, dest), dir: dest };
}

/** The parts of a brand the brief interpreter should read, as plain text. */
export function brandBriefing(brandId: string): string {
  const b = loadBrand(brandId).brand;
  const colours = Object.entries(b.colours)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}: ${v!.name ?? k} ${v!.value}`)
    .join("; ");
  return [
    `Brand: ${b.name}${b.fictional ? " (fictional)" : ""}`,
    b.description ? `About: ${b.description}` : "",
    `Tone of voice: ${b.toneOfVoice || "Not given."}`,
    b.guidelines ? `Guidelines:\n${b.guidelines}` : "",
    b.rules.do.length ? `Do:\n${b.rules.do.map((d) => `- ${d}`).join("\n")}` : "",
    b.rules.dont.length ? `Do not:\n${b.rules.dont.map((d) => `- ${d}`).join("\n")}` : "",
    `Colours (for reference only; the engine applies them): ${colours}`,
    iconBriefing(brandId),
  ]
    .filter(Boolean)
    .join("\n\n");
}

// ---------- previews ----------

export interface PreviewItem {
  scene: string;
  format: FormatId;
  /** Absolute path of a self-contained HTML still (relative asset links). Serve its folder to show it in an iframe. */
  html: string;
  /** Absolute path of the PNG still, when png is true. */
  png?: string;
  width: number;
  height: number;
  issues: string[];
}

export interface PreviewOptions {
  /** Folder to write the stills into. It is cleared first. */
  outDir: string;
  formats?: FormatId[];
  /** Scene types to show. Default: title, statement and end. */
  scenes?: string[];
  /** Override sample slots per scene type. */
  samples?: Record<string, Record<string, unknown>>;
  /** Sample caption text shown in the caption band. */
  caption?: string;
  /** Also screenshot each still to PNG. Default true. */
  png?: boolean;
}

/**
 * Stills of the Title, Statement and End card in every format for a brand, as it would render.
 * Pass a brand id, a brand folder, or { brand, dir } for unsaved edits (dir holds its fonts and logos).
 */
export async function previewBrand(input: string | { brand: unknown; dir: string }, opts: PreviewOptions): Promise<{ items: PreviewItem[]; check: BrandCheck }> {
  let loaded: LoadedBrand;
  let check: BrandCheck;
  if (typeof input === "string") {
    loaded = loadBrand(input);
    check = { ok: loaded.ok, brand: loaded.brand, issues: loaded.issues, contrast: loaded.contrast };
  } else {
    check = validateBrand(input.brand, input.dir);
    if (!check.brand) return { items: [], check };
    loaded = inspectBrand(check.brand, path.resolve(input.dir));
  }
  const formats = opts.formats ?? [...FORMAT_IDS];
  const types = opts.scenes ?? ["title", "statement", "end"];
  fs.rmSync(opts.outDir, { recursive: true, force: true });
  fs.mkdirSync(opts.outDir, { recursive: true });
  const items: PreviewItem[] = [];
  retainBrowser();
  try {
    for (const type of types) {
      const def = getScene(type);
      const slots = { ...(def.sample as Record<string, unknown>), ...(opts.samples?.[type] ?? {}) };
      // Drop the sample icon if this brand and the library do not have it, rather than failing the preview.
      if (slots.icon && !listIcons(loaded).some((i) => i.name === (slots.icon as { icon: string }).icon)) delete slots.icon;
      for (const f of formats) {
        const page = compileStill({ type, slots, id: type }, loaded, f, { caption: opts.caption ?? "Captions look like this on screen" });
        const file = writePage(page, opts.outDir, `${type}-${f}.html`);
        const fmt = getFormat(f);
        const item: PreviewItem = { scene: type, format: f, html: file, width: fmt.width, height: fmt.height, issues: page.issues.map((i) => i.message) };
        if (opts.png !== false) {
          const png = path.join(opts.outDir, `${type}-${f}.png`);
          const pg = await newPage();
          try {
            await pg.setViewport({ width: fmt.width, height: fmt.height, deviceScaleFactor: 1 });
            await pg.goto("file://" + file, { waitUntil: "load" });
            await pg.evaluate(async () => {
              await document.fonts.ready;
            });
            await pg.screenshot({ path: png as `${string}.png` });
          } finally {
            await pg.close();
          }
          item.png = png;
        }
        items.push(item);
      }
    }
  } finally {
    await releaseBrowser();
  }
  return { items, check };
}

// ---------- jobs ----------

/** The latest progress for a job, written by the pipeline as it runs. */
export function jobStatus(jobDir: string): unknown {
  const f = jobPaths(jobDir).status;
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : null;
}

/** Job folders under jobs/. */
export function listJobs(): Array<{ name: string; dir: string; hasSpec: boolean; status: unknown }> {
  if (!fs.existsSync(JOBS_DIR)) return [];
  return fs
    .readdirSync(JOBS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => {
      const dir = path.join(JOBS_DIR, d.name);
      return { name: d.name, dir, hasSpec: fs.existsSync(path.join(dir, "spec.json")), status: jobStatus(dir) };
    });
}

/** Scene types, their slots and limits: what a brief interpreter may use. */
export function sceneTypes() {
  return sceneCatalogue();
}

export const SCENE_TYPES = SCENES.map((s) => s.type);
