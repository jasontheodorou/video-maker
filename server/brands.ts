// Brand management for the web app. A thin layer over the engine's brand module (engine/brand/),
// so the Brands page, the command line import and the renderer all use the same rules and checks.
import fs from "node:fs";
import path from "node:path";
import { CACHE_DIR, BRANDS_DIR } from "../engine/paths";
import crypto from "node:crypto";
import { listBrands, loadBrand, previewBrand, listIcons, KOKORO_VOICES } from "../engine";
import * as store from "../engine/brand/index";
import { inspectBrand, safeParseBrand, emphasisWeightAvailable } from "../engine/brand";
import { tintValue } from "../engine/colour-core";
import { compileStill, writePage } from "../engine/compile";
import { getFormat, FORMAT_IDS, type FormatId } from "../engine/config";
import { getScene } from "../engine/scenes";
import { renderMotionPreview, type MotionPreviewKind } from "../engine/motion-preview";
import type { Scheme } from "../engine/schema";
import { HttpError } from "./http";

export const PREVIEW_ROOT = path.join(CACHE_DIR, "web-previews");

/** Run a brand-module call and turn its plain-English errors into HTTP errors. */
function wrap<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof HttpError) throw e;
    const msg = (e as Error).message;
    throw new HttpError(/^There is no brand/.test(msg) ? 404 : 400, msg);
  }
}
async function wrapAsync<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(400, (e as Error).message);
  }
}

export function brandFolder(id: string): string {
  const dir = wrap(() => store.brandFolder(id));
  if (!fs.existsSync(path.join(dir, "brand.json"))) throw new HttpError(404, `There is no brand called ${id}.`);
  return dir;
}

export function brandSummaries() {
  return listBrands().map((b) => {
    let logo: string | undefined;
    let logoDark: string | undefined;
    let primary: string | undefined;
    let voice: string | undefined;
    let schemes = 0;
    try {
      const l = loadBrand(b.id);
      logo = `/brand-files/${b.id}/${l.brand.logo.onLight}`;
      logoDark = `/brand-files/${b.id}/${l.brand.logo.onDark}`;
      // The first core colour (else the first colour) stands for the brand in lists.
      primary = (l.brand.palette.colours.find((c) => c.group === "core") ?? l.brand.palette.colours[0])?.value;
      schemes = l.usableSchemes().length;
      voice = l.brand.voice.id;
    } catch {
      /* a broken brand is listed with its errors */
    }
    return { ...b, logo, logoDark, primary, schemes, voice, protected: store.PROTECTED_BRANDS.includes(b.id) };
  });
}

function iconNames(id: string, raw: unknown): { client: string[]; library: number } {
  const check = store.checkBrand(raw, brandFolder(id));
  if (!check.brand) return { client: [], library: listIcons().length };
  try {
    const all = listIcons(loadBrand(id));
    return { client: all.filter((i) => i.source === "brand").map((i) => i.name), library: all.filter((i) => i.source === "library").length };
  } catch {
    return { client: [], library: 0 };
  }
}

/** A check with one-click fixes for each failing contrast pair (see engine/brand/fixes.ts). */
function withFixes<T extends object>(check: T, raw: unknown): T & { fixes: Record<string, store.ContrastFix[]> } {
  let fixes: Record<string, store.ContrastFix[]> = {};
  try {
    fixes = store.contrastFixes((raw ?? {}) as Parameters<typeof store.contrastFixes>[0]);
  } catch {
    /* fixes are only a help */
  }
  return { ...check, fixes };
}

/** Every palette colour with its tint values resolved, for swatches. */
function paletteView(raw: unknown) {
  const p = safeParseBrand(raw);
  const pal = (p.success ? p.data!.palette : (p.raw as { palette?: { colours?: unknown[] } }).palette) as { colours?: Array<{ id: string; name: string; value: string; group: string; tints?: boolean; tintValues?: { t10?: string; t25?: string } }> } | undefined;
  return (pal?.colours ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    value: c.value,
    group: c.group,
    tints: c.tints === false ? null : { t10: tintValue(c, 10), t25: tintValue(c, 25) },
  }));
}

export function brandDetail(id: string) {
  brandFolder(id);
  const r = wrap(() => store.readBrand(id));
  return {
    id,
    raw: r.raw,
    migrated: Boolean(r.migrated),
    palette: paletteView(r.raw),
    check: withFixes(r.check, r.raw),
    files: r.files,
    icons: iconNames(id, r.raw),
    protected: store.PROTECTED_BRANDS.includes(id),
    voices: KOKORO_VOICES,
  };
}

export function createBrand(input: { name?: string; from?: string; id?: string; colours?: Array<{ value: string; name?: string; role?: string }> }) {
  const r = wrap(() =>
    store.createBrand({
      name: input.name ?? "",
      // "blank" (the default on the Brands page) starts from plain colours, with the sample brand's open font and sizes.
      from: !input.from || input.from === "blank" ? "demo" : input.from,
      blank: input.from === "blank",
      id: input.id?.trim() || undefined,
      colours: input.colours?.length ? input.colours : undefined,
    }),
  );
  return { id: r.id, notes: r.notes };
}

export function duplicateBrand(from: string, name: string) {
  brandFolder(from);
  const clean = name.trim();
  if (!clean) throw new HttpError(400, "Enter a name for the copy.");
  const r = wrap(() => store.duplicateBrand(from, clean));
  return { id: r.id };
}

/** A patch that turns current into next: changed values, and null for anything next leaves out. */
function patchFor(current: unknown, next: unknown): unknown {
  if (typeof next !== "object" || next === null || Array.isArray(next) || typeof current !== "object" || current === null || Array.isArray(current)) return next;
  const out: Record<string, unknown> = {};
  const c = current as Record<string, unknown>;
  const n = next as Record<string, unknown>;
  for (const k of Object.keys(n)) out[k] = patchFor(c[k], n[k]);
  for (const k of Object.keys(c)) if (!(k in n)) out[k] = null;
  return out;
}

/** Save the whole brand as edited on the Brands page. */
export function saveBrandDraft(id: string, draft: unknown) {
  const dir = brandFolder(id);
  if (!draft || typeof draft !== "object") throw new HttpError(400, "Send the brand as JSON.");
  if ((draft as { id?: unknown }).id !== id) throw new HttpError(400, "The brand id cannot be changed. Duplicate the brand to give it a new id.");
  // Diff against the brand as version 2 (a version 1 file is migrated in memory), so the first save of a version 1
  // brand writes the whole version 2 document.
  const current = store.migrateBrand(JSON.parse(fs.readFileSync(path.join(dir, "brand.json"), "utf8"))).raw;
  const next = store.migrateBrand(draft).raw;
  const r = wrap(() => store.updateBrand(id, patchFor(current, next) as Record<string, unknown>));
  return { saved: r.saved, check: withFixes(r.check, r.saved ? r.raw : next), raw: r.raw, palette: paletteView(r.raw), files: r.files };
}

export function deleteBrand(id: string, busy: (id: string) => boolean) {
  brandFolder(id);
  if (busy(id)) throw new HttpError(409, "A video using this brand is being made. Wait for it to finish, then delete the brand.");
  wrap(() => store.deleteBrand(id));
}

export function checkDraft(id: string, raw: unknown) {
  return { ...withFixes(store.checkBrand(raw, brandFolder(id)), raw), palette: paletteView(raw) };
}

// ---------- previews ----------

let previewCounter = 0;

/** Folders under PREVIEW_ROOT: "<brand>.full-<stamp>" (full previews), "<brand>.s-<hash>" (scheme cards). */
function prune(prefix: string, keep: string, count: number) {
  try {
    const old = fs
      .readdirSync(PREVIEW_ROOT)
      .filter((d) => d.startsWith(prefix) && d !== keep)
      .map((d) => ({ d, t: fs.statSync(path.join(PREVIEW_ROOT, d)).mtimeMs }))
      .sort((a, b) => b.t - a.t)
      .slice(count);
    for (const o of old) fs.rmSync(path.join(PREVIEW_ROOT, o.d), { recursive: true, force: true });
  } catch {
    /* tidying up is best effort */
  }
}

function asFormats(v: unknown): FormatId[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const f = v.filter((x): x is FormatId => (FORMAT_IDS as readonly string[]).includes(String(x)));
  return f.length ? f : undefined;
}

/** Stills of Title, Statement and End card (or the scenes asked for) in every format for unsaved edits. Served from /previews/. */
export async function previewDraft(id: string, raw: unknown, opts: { caption?: string; scenes?: unknown; formats?: unknown; scheme?: unknown } = {}) {
  const dir = brandFolder(id);
  const name = `${id}.full-${Date.now().toString(36)}-${(previewCounter++).toString(36)}`;
  const outDir = path.join(PREVIEW_ROOT, name);
  const scenes = Array.isArray(opts.scenes) ? opts.scenes.map(String).filter((t) => { try { return Boolean(getScene(t)); } catch { return false; } }) : undefined;
  const scheme = typeof opts.scheme === "string" || (opts.scheme && typeof opts.scheme === "object") ? (opts.scheme as string | Scheme) : undefined;
  const r = await previewBrand({ brand: store.migrateBrand(raw).raw, dir }, { outDir, png: false, caption: opts.caption, scenes: scenes?.length ? scenes : undefined, formats: asFormats(opts.formats), scheme });
  prune(`${id}.full-`, name, 4);
  return {
    check: r.check,
    items: r.items.map((i) => ({ scene: i.scene, format: i.format, width: i.width, height: i.height, issues: i.issues, url: `/previews/${name}/${path.basename(i.html)}` })),
  };
}

// ---------- schemes ----------

/** Suggested schemes for a brand (saved, or the draft sent), hiding ones it already has. */
export function recommend(id: string, body: { brand?: unknown; useRules?: boolean; limit?: number; includeExisting?: boolean }) {
  const dir = brandFolder(id);
  const raw = body.brand ? store.migrateBrand(body.brand).raw : store.readBrand(id).raw;
  const p = safeParseBrand(raw);
  if (!p.success || !p.data) throw new HttpError(400, "The brand has problems that stop suggestions. Fix them first.", { problems: p.issues.map((i) => `${i.path}: ${i.message}`) });
  void dir;
  const limit = Math.min(12, Math.max(1, Number(body.limit) || 6));
  const r = store.recommendSchemes(p.data.palette, { rules: p.data.palette.rules, useRules: body.useRules !== false, emphasisWeightAvailable: emphasisWeightAvailable(p.data), limit: body.includeExisting ? limit : Math.min(12, limit + p.data.schemes.length) });
  const same = (a: { background: string; text: string; highlight: string; emphasis?: string }, b: typeof a) => a.background === b.background && a.text === b.text && a.highlight === b.highlight && (a.emphasis ?? "colour") === (b.emphasis ?? "colour");
  const schemes = (body.includeExisting ? r.schemes : r.schemes.filter((s) => !p.data!.schemes.some((x) => same(x, s)))).slice(0, limit);
  // Ids that clash with existing schemes get a number.
  const ids = new Set(p.data.schemes.map((s) => s.id));
  for (const s of schemes) {
    let sid = s.id;
    for (let n = 2; ids.has(sid); n++) sid = `${s.id}-${n}`;
    ids.add(sid);
    s.id = sid;
  }
  return { schemes, nearMisses: r.nearMisses, rules: r.rules, notes: r.notes };
}

/**
 * One still of a scene in one scheme (an id, or an unsaved scheme) for the scheme cards, with the scheme's CSS
 * variables so the app can change colours in place. Cached by content: the same draft gives the same folder.
 */
export function schemePreview(id: string, body: { brand?: unknown; scheme?: unknown; scene?: unknown; format?: unknown }) {
  const dir = brandFolder(id);
  const raw = body.brand ? store.migrateBrand(body.brand).raw : store.readBrand(id).raw;
  const p = safeParseBrand(raw);
  if (!p.success || !p.data) throw new HttpError(400, "The brand has problems that stop the preview. Fix them first.", { problems: p.issues.map((i) => `${i.path}: ${i.message}`) });
  const scene = typeof body.scene === "string" ? body.scene : "statement";
  let def;
  try {
    def = getScene(scene);
  } catch {
    throw new HttpError(400, `Unknown scene "${scene}".`);
  }
  const format = (FORMAT_IDS as readonly string[]).includes(String(body.format)) ? (body.format as FormatId) : "16x9";
  const scheme = body.scheme && typeof body.scheme === "object" ? (body.scheme as Scheme) : typeof body.scheme === "string" ? body.scheme : undefined;
  if (typeof scheme === "string" && !p.data.schemes.some((s) => s.id === scheme)) throw new HttpError(400, `There is no scheme called "${scheme}".`);
  const loaded = inspectBrand(p.data, dir);
  const slots = { ...(def.sample as Record<string, unknown>) };
  if (slots.icon && !listIcons(loaded).some((i) => i.name === (slots.icon as { icon: string }).icon)) delete slots.icon;
  // The folder is named by what changes the page apart from colours: scene, format, type, fonts, logo and scheme tone.
  const page = compileStill({ type: scene, slots, id: scene.replace(/[^a-z]/g, "") || "s1" }, loaded, format, { scheme, live: true });
  const hash = crypto.createHash("sha1").update(page.html).digest("hex").slice(0, 12);
  const name = `${id}.s-${hash}`;
  const file = `${scene}-${format}.html`;
  const out = path.join(PREVIEW_ROOT, name);
  if (!fs.existsSync(path.join(out, file))) writePage(page, out, file);
  else fs.utimesSync(out, new Date(), new Date());
  prune(`${id}.s-`, name, 40);
  const schemeId = /data-scheme="([^"]*)"/.exec(page.html)?.[1] ?? "";
  const logo = /data-logo="([^"]*)"/.exec(page.html)?.[1] ?? "onDark";
  const fmt = getFormat(format);
  const vars = typeof scheme === "object" ? inspectBrand({ ...p.data, schemes: [...p.data.schemes.filter((s) => s.id !== scheme.id), scheme] }, dir).schemeVars(scheme.id) : loaded.schemeVars(schemeId || p.data.schemes[0].id);
  return { url: `/previews/${name}/${file}`, width: fmt.width, height: fmt.height, scheme: schemeId, vars, logo, issues: page.issues.map((i) => i.message) };
}

/** A short looping preview of a motion option, in this brand's fonts and schemes. */
export async function motionPreview(id: string, body: { brand?: unknown; kind?: unknown; id?: unknown; scheme?: unknown; format?: unknown }) {
  const dir = brandFolder(id);
  const raw = body.brand ? store.migrateBrand(body.brand).raw : store.readBrand(id).raw;
  const p = safeParseBrand(raw);
  if (!p.success || !p.data) throw new HttpError(400, "The brand has problems that stop the preview. Fix them first.");
  const kinds = ["style", "entrance", "transition", "text", "shape"];
  if (!kinds.includes(String(body.kind))) throw new HttpError(400, "Say which kind of motion to preview: style, entrance, transition, text or shape.");
  const format = (FORMAT_IDS as readonly string[]).includes(String(body.format)) ? (body.format as FormatId) : "16x9";
  try {
    const r = renderMotionPreview(inspectBrand(p.data, dir), { kind: body.kind as MotionPreviewKind, id: String(body.id ?? ""), scheme: typeof body.scheme === "string" ? body.scheme : undefined, format }, path.join(PREVIEW_ROOT, "motion"));
    return { url: `/previews/motion/${r.folder}/${r.file}`, seconds: r.seconds };
  } catch (e) {
    throw new HttpError(400, (e as Error).message);
  }
}

// ---------- files ----------

export type UploadKind = "font" | "logo" | "icon" | "graphic" | "document";

export function addFile(id: string, kind: UploadKind, fileName: string, bytes: Buffer, opts: store.AddFileOptions) {
  brandFolder(id);
  const r = wrap(() => store.addBrandFile(id, kind, fileName, bytes, opts));
  return { file: r.file, warnings: r.warnings, font: r.font, raw: r.brand.raw, check: r.brand.check, files: r.brand.files };
}

export function removeFile(id: string, rel: string) {
  brandFolder(id);
  const r = wrap(() => store.removeBrandFile(id, rel));
  return { raw: r.raw, check: r.check, files: r.files };
}

export function reverseLogo(id: string, rel?: string) {
  brandFolder(id);
  const r = wrap(() => store.makeReverseLogo(id, rel));
  return { file: r.file, warnings: r.warnings, raw: r.raw, check: r.check, files: r.files };
}

const STARTER_FONTS = ["Atkinson Hyperlegible Next", "Atkinson Hyperlegible", "Inter", "Source Sans 3", "Noto Sans", "Lexend", "Public Sans", "Open Sans", "Lato", "IBM Plex Sans", "Work Sans", "Figtree"];

export async function searchFonts(q: string) {
  return wrapAsync(async () => {
    if (q.trim()) return store.searchOpenFonts(q, 12);
    const list = await store.listOpenFonts();
    return STARTER_FONTS.map((f) => list.find((x) => x.family === f)).filter(Boolean);
  });
}

export async function useOpenFont(id: string, family: string, weights: number[], roles: boolean) {
  brandFolder(id);
  const r = await wrapAsync(() => store.useOpenFont(id, family, { weights, roles }));
  return { warnings: r.warnings, raw: r.raw, check: r.check, files: r.files };
}

export function brandsDir() {
  return BRANDS_DIR;
}
