// Brand management for the web app. A thin layer over the engine's brand module (engine/brand/),
// so the Brands page, the command line import and the renderer all use the same rules and checks.
import fs from "node:fs";
import path from "node:path";
import { CACHE_DIR, BRANDS_DIR } from "../engine/paths";
import { listBrands, loadBrand, previewBrand, listIcons, KOKORO_VOICES } from "../engine";
import * as store from "../engine/brand/index";
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
    try {
      const l = loadBrand(b.id);
      logo = `/brand-files/${b.id}/${l.brand.logo.onLight}`;
      logoDark = `/brand-files/${b.id}/${l.brand.logo.onDark}`;
      primary = l.brand.colours.primary.value;
      voice = l.brand.voice.id;
    } catch {
      /* a broken brand is listed with its errors */
    }
    return { ...b, logo, logoDark, primary, voice, protected: store.PROTECTED_BRANDS.includes(b.id) };
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

export function brandDetail(id: string) {
  brandFolder(id);
  const r = wrap(() => store.readBrand(id));
  return {
    id,
    raw: r.raw,
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
  const current = JSON.parse(fs.readFileSync(path.join(dir, "brand.json"), "utf8"));
  const r = wrap(() => store.updateBrand(id, patchFor(current, draft) as Record<string, unknown>));
  return { saved: r.saved, check: withFixes(r.check, r.saved ? r.raw : draft), raw: r.raw, files: r.files };
}

export function deleteBrand(id: string, busy: (id: string) => boolean) {
  brandFolder(id);
  if (busy(id)) throw new HttpError(409, "A video using this brand is being made. Wait for it to finish, then delete the brand.");
  wrap(() => store.deleteBrand(id));
}

export function checkDraft(id: string, raw: unknown) {
  return withFixes(store.checkBrand(raw, brandFolder(id)), raw);
}

// ---------- previews ----------

let previewCounter = 0;

/** Stills of Title, Statement and End card in every format for unsaved edits. Served from /previews/. */
export async function previewDraft(id: string, raw: unknown, opts: { caption?: string } = {}) {
  const dir = brandFolder(id);
  const name = `${id}-${Date.now().toString(36)}-${(previewCounter++).toString(36)}`;
  const outDir = path.join(PREVIEW_ROOT, name);
  const r = await previewBrand({ brand: raw, dir }, { outDir, png: false, caption: opts.caption });
  try {
    const old = fs
      .readdirSync(PREVIEW_ROOT)
      .filter((d) => d.startsWith(`${id}-`) && d !== name)
      .map((d) => ({ d, t: fs.statSync(path.join(PREVIEW_ROOT, d)).mtimeMs }))
      .sort((a, b) => b.t - a.t)
      .slice(4);
    for (const o of old) fs.rmSync(path.join(PREVIEW_ROOT, o.d), { recursive: true, force: true });
  } catch {
    /* tidying up is best effort */
  }
  return {
    check: r.check,
    items: r.items.map((i) => ({ scene: i.scene, format: i.format, width: i.width, height: i.height, issues: i.issues, url: `/previews/${name}/${path.basename(i.html)}` })),
  };
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
