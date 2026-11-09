// Icon resolution. A spec reserves an icon as { "icon": "<name>", "weight"?: "regular" }.
// Lookup order (first match wins):
//   1. brands/<id>/<icons.dir>/<name>-<weight>.svg   client icon for that weight
//   2. brands/<id>/<icons.dir>/<name>.svg            client icon (overrides the library by name)
//   3. engine/icons/<weight>/<name>.svg              library icon at that weight
//   4. engine/icons/<name>.svg                       library icon with a single weight
// Library icons should draw with currentColor so the scene can colour them from brand tokens.
import fs from "node:fs";
import path from "node:path";
import { ICONS_DIR, BRANDS_DIR } from "./paths";
import type { LoadedBrand } from "./brand";
import { ICON_WEIGHTS, type IconRef, type IconWeight } from "./schema";
import { canonicalIconName, colourIconSvg, checkIconName, brandIconFiles, loadIconIndex } from "./icons/library";

export { searchIcons, checkIconName, suggestIconNames, iconInfo, loadIconIndex, canonicalIconName, brandIconFiles, colourIconSvg } from "./icons/library";
export type { IconSearchResult, IconSearchOptions, IconIndexEntry, IconNameCheck } from "./icons/library";

export interface ResolvedIcon {
  name: string;
  weight: IconWeight;
  file: string;
  source: "brand" | "library";
  svg: string;
}

export function iconCandidates(ref: IconRef, brand: LoadedBrand): Array<{ file: string; source: "brand" | "library" }> {
  const weight = ref.weight ?? brand.brand.icons.weight;
  const brandIcons = path.join(brand.dir, brand.brand.icons.dir);
  // Old Phosphor names (aliases) resolve to the current library name.
  const libName = canonicalIconName(ref.icon) ?? ref.icon;
  return [
    { file: path.join(brandIcons, `${ref.icon}-${weight}.svg`), source: "brand" },
    { file: path.join(brandIcons, `${ref.icon}.svg`), source: "brand" },
    { file: path.join(ICONS_DIR, weight, `${libName}.svg`), source: "library" },
    { file: path.join(ICONS_DIR, `${libName}.svg`), source: "library" },
  ];
}

export function resolveIcon(ref: IconRef, brand: LoadedBrand): ResolvedIcon | null {
  const weight = ref.weight ?? brand.brand.icons.weight;
  for (const c of iconCandidates(ref, brand)) {
    if (fs.existsSync(c.file)) {
      const svg = colourIconSvg(sanitiseSvg(fs.readFileSync(c.file, "utf8")), brand.brand.icons);
      return { name: ref.icon, weight, file: c.file, source: c.source, svg };
    }
  }
  return null;
}

/** Names of every icon a brand can use: client icons plus library icons. */
export function listIcons(brand?: LoadedBrand): Array<{ name: string; source: "brand" | "library"; weights: string[] }> {
  const map = new Map<string, { name: string; source: "brand" | "library"; weights: Set<string> }>();
  const add = (name: string, source: "brand" | "library", weight: string) => {
    const cur = map.get(name);
    if (cur && cur.source === "brand" && source === "library") {
      cur.weights.add(weight);
      return;
    }
    if (!cur || source === "brand") map.set(name, { name, source, weights: new Set([...(cur?.weights ?? []), weight]) });
    else cur.weights.add(weight);
  };
  const scan = (dir: string, source: "brand" | "library", weight: string) => {
    if (!fs.existsSync(dir)) return;
    for (const f of fs.readdirSync(dir)) if (f.endsWith(".svg")) add(f.replace(/\.svg$/, ""), source, weight);
  };
  scan(ICONS_DIR, "library", "any");
  for (const w of ICON_WEIGHTS) scan(path.join(ICONS_DIR, w), "library", w);
  if (brand) scan(path.join(brand.dir, brand.brand.icons.dir), "brand", "any");
  return [...map.values()].map((v) => ({ name: v.name, source: v.source, weights: [...v.weights] })).sort((a, b) => a.name.localeCompare(b.name));
}

/** Strip anything active or external from an SVG and make it fill its box. */
export function sanitiseSvg(svg: string): string {
  let s = svg
    .replace(/<\?xml[^>]*>/gi, "")
    .replace(/<!DOCTYPE[^>]*>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, "")
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*')/gi, "")
    .replace(/(href|xlink:href)\s*=\s*("(?!#)[^"]*"|'(?!#)[^']*')/gi, "")
    .trim();
  // Make the root svg scale to its container.
  s = s.replace(/<svg\b([^>]*)>/i, (_m, attrs: string) => {
    const cleaned = attrs.replace(/\s(width|height)\s*=\s*("[^"]*"|'[^']*')/gi, "");
    return `<svg${cleaned} width="100%" height="100%" aria-hidden="true" focusable="false">`;
  });
  return s;
}

/** Why an icon reference cannot be found, with "did you mean" suggestions. */
export function missingIconMessage(ref: IconRef, brand: LoadedBrand): string {
  const weight = ref.weight ?? brand.brand.icons.weight;
  const check = checkIconName(ref.icon, { weight, brand: brand.dir });
  return check.message ?? `Icon "${ref.icon}" (${weight}) was not found in the brand icons or engine/icons.`;
}

/**
 * An icon as inline SVG coloured from brand tokens, for use outside a scene (previews, icon sheets, the web app).
 * colour is a colour token name such as "primary"; values are written in, so the SVG works on its own.
 */
export function renderIcon(ref: IconRef, brand: LoadedBrand, opts: { colour?: string; size?: number } = {}): string | null {
  const r = resolveIcon(ref, brand);
  if (!r) return null;
  const colour = brand.colour(opts.colour ?? brand.brand.surfaces.light.accent);
  const svg = r.svg.replace(/var\(--c-([a-zA-Z0-9]+)\)/g, (_m, name: string) => brand.colour(name));
  const size = opts.size ? ` width="${opts.size}" height="${opts.size}"` : "";
  return svg.replace(/<svg\b([^>]*?) width="100%" height="100%"/, `<svg$1${size}`).replace(/<svg\b/, `<svg style="color:${colour}"`);
}

/** What the brief interpreter needs to know about icons for a brand, as plain text. */
export function iconBriefing(brandId: string): string {
  const b = loadBrandIconsOnly(brandId);
  const client = [...new Set(brandIconFiles(brandId).map((i) => i.name))].sort();
  const idx = loadIconIndex();
  return [
    `Icons: ${idx.count} ${idx.family === "phosphor" ? "Phosphor" : idx.family} library icons, one family only. Default weight: ${b.weight}.`,
    client.length ? `Client icons (use these first; they replace library icons with the same name): ${client.join(", ")}` : "Client icons: none.",
    `Pick library icons by meaning with searchIcons("money"), searchIcons("growth") and so on. Write { "icon": "<name>" } and leave out the weight unless the guidelines need another.`,
  ].join("\n");
}

function loadBrandIconsOnly(brandId: string): { weight: string } {
  try {
    const dir = brandId.includes("/") ? brandId : path.join(BRANDS_DIR, brandId);
    return { weight: JSON.parse(fs.readFileSync(path.join(dir, "brand.json"), "utf8"))?.icons?.weight ?? "regular" };
  } catch {
    return { weight: "regular" };
  }
}
