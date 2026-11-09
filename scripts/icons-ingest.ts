// Ingest the Phosphor icon library into engine/icons/.
//
//   npx tsx scripts/icons-ingest.ts            (or: npm run icons-ingest)
//
// Downloads one pinned version of @phosphor-icons/core with `npm pack` (MIT licence),
// copies every icon in all six weights to engine/icons/<weight>/<name>.svg as clean SVG,
// and writes engine/icons/index.json (names, weights, tags, categories, aliases).
// Run it again only to change the pinned version on purpose. The output is checked in,
// so rendering never needs the network.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { ROOT, ICONS_DIR, CACHE_DIR } from "../engine/paths";
import { ICON_WEIGHTS } from "../engine/schema";

const PACKAGE = "@phosphor-icons/core";
const VERSION = "2.1.1";

interface PhosphorEntry {
  name: string;
  alias?: { name: string };
  categories: string[];
  figma_category: string;
  tags: string[];
  published_in: number;
}

async function main() {
  const work = path.join(CACHE_DIR, "phosphor", VERSION);
  const pkgDir = path.join(work, "package");
  if (!fs.existsSync(path.join(pkgDir, "package.json"))) {
    fs.mkdirSync(work, { recursive: true });
    console.log(`Downloading ${PACKAGE}@${VERSION} ...`);
    const out = execFileSync("npm", ["pack", `${PACKAGE}@${VERSION}`, "--silent"], { cwd: work, encoding: "utf8" }).trim().split("\n").pop()!;
    execFileSync("tar", ["xzf", out], { cwd: work });
  }
  const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, "package.json"), "utf8"));
  if (pkg.version !== VERSION) throw new Error(`Expected ${PACKAGE} ${VERSION}, found ${pkg.version}`);

  // The catalogue is plain data exported from the package's ES module.
  const mod = await import(pathToFileURL(path.join(pkgDir, "dist", "index.mjs")).href);
  const catalogue: PhosphorEntry[] = mod.icons;
  if (!Array.isArray(catalogue) || catalogue.length < 1000) throw new Error("Could not read the Phosphor catalogue");

  // Clear old library files (only weight folders and index.json; leave anything else alone).
  for (const w of ICON_WEIGHTS) fs.rmSync(path.join(ICONS_DIR, w), { recursive: true, force: true });
  for (const w of ICON_WEIGHTS) fs.mkdirSync(path.join(ICONS_DIR, w), { recursive: true });

  const icons: Array<Record<string, unknown>> = [];
  const problems: string[] = [];
  let files = 0;
  for (const entry of [...catalogue].sort((a, b) => a.name.localeCompare(b.name))) {
    const weights: string[] = [];
    for (const w of ICON_WEIGHTS) {
      const srcName = w === "regular" ? `${entry.name}.svg` : `${entry.name}-${w}.svg`;
      const src = path.join(pkgDir, "assets", w, srcName);
      if (!fs.existsSync(src)) continue;
      const svg = cleanSvg(fs.readFileSync(src, "utf8"), w);
      if (!svg) {
        problems.push(`${w}/${entry.name}`);
        continue;
      }
      fs.writeFileSync(path.join(ICONS_DIR, w, `${entry.name}.svg`), svg + "\n");
      weights.push(w);
      files++;
    }
    if (!weights.length) continue;
    const tags = [...new Set(entry.tags.map((t) => t.toLowerCase().trim()).filter((t) => t && !t.startsWith("*")))];
    const categories = [...new Set([...entry.categories, entry.figma_category].filter(Boolean))];
    icons.push({
      name: entry.name,
      ...(entry.alias?.name ? { alias: entry.alias.name } : {}),
      weights,
      tags,
      categories,
      ...(categories.includes("brands") ? { brandLogo: true } : {}),
    });
  }

  const allCategories = [...new Set(icons.flatMap((i) => i.categories as string[]))].sort();
  const index = {
    family: "phosphor",
    source: { package: PACKAGE, version: VERSION, licence: "MIT", url: "https://phosphoricons.com" },
    viewBox: "0 0 256 256",
    weights: ICON_WEIGHTS,
    categories: allCategories,
    count: icons.length,
    icons,
  };
  // One icon per line keeps the file readable and diffs small.
  const body = [
    "{",
    ...Object.entries(index)
      .filter(([k]) => k !== "icons")
      .map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`),
    '  "icons": [',
    icons.map((i) => "    " + JSON.stringify(i)).join(",\n"),
    "  ]",
    "}",
  ].join("\n");
  fs.writeFileSync(path.join(ICONS_DIR, "index.json"), body + "\n");
  fs.copyFileSync(path.join(pkgDir, "LICENSE"), path.join(ICONS_DIR, "LICENSE-phosphor.txt"));

  console.log(`Wrote ${icons.length} icons (${files} SVG files) to ${path.relative(ROOT, ICONS_DIR)}/`);
  if (problems.length) console.log(`Skipped ${problems.length} files that were not clean SVG: ${problems.slice(0, 10).join(", ")}`);
}

/**
 * Keep only what the engine needs: a root <svg> with viewBox and fill="currentColor", and its shapes.
 * Duotone files mark their light layer with data-layer="secondary" instead of a fixed opacity,
 * so the brand decides the colour and opacity at compile time.
 */
function cleanSvg(raw: string, weight: string): string | null {
  let s = raw.replace(/<\?xml[^>]*>/g, "").replace(/<!--[\s\S]*?-->/g, "").trim();
  if (!/^<svg\b[^>]*viewBox="0 0 256 256"/.test(s)) return null;
  if (/<(script|foreignObject|image|use)\b/i.test(s) || /\son[a-z]+=/i.test(s)) return null;
  s = s.replace(/^<svg\b[^>]*>/, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor">');
  if (weight === "duotone") s = s.replace(/\sopacity="0\.2"/g, ' data-layer="secondary"');
  s = s.replace(/>\s+</g, "><");
  return s;
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
