// Preview stills for a brand: Title, Statement and End card in all three formats.
// A thin wrapper over previewBrand in engine/api.ts, loaded lazily to keep the brand module light.
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import type { PreviewOptions, PreviewItem, BrandCheck } from "../api";

/**
 * Render preview stills for a saved brand (by id) or for unsaved edits ({ brand, dir }).
 * Default output folder: a fresh temporary folder. Returns the stills and the brand check.
 */
export async function renderBrandPreview(
  input: string | { brand: unknown; dir: string },
  opts: Partial<PreviewOptions> = {},
): Promise<{ items: PreviewItem[]; check: BrandCheck; outDir: string }> {
  const api = await import("../api");
  const outDir = opts.outDir ?? fs.mkdtempSync(path.join(os.tmpdir(), "brand-preview-"));
  const r = await api.previewBrand(input, { ...opts, outDir });
  return { ...r, outDir };
}
