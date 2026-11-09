// Icon sheet: 60 library icons picked by meaning, drawn in a brand's colours, as a crisp 1920 x 1080 PNG.
//
//   npm run icons-sheet                       demo brand, light and dark schemes
//   npm run icons-sheet -- --brand=<id>       another brand
//   npm run icons-sheet -- --weight=duotone   one weight for every icon (default: a mix, one weight per row)
//
// Writes engine/icons/sheets/<brand>-<scheme>.png and .html. Each icon is found with searchIcons(topic),
// so the sheet also shows what the search returns for 60 everyday topics.
import fs from "node:fs";
import path from "node:path";
import { ICONS_DIR } from "../engine/paths";
import { loadBrand, brandCss, type LoadedBrand } from "../engine/brand";
import { getFormat } from "../engine/config";
import { renderIcon, searchIcons } from "../engine/icons";
import { ICON_WEIGHTS, type IconWeight } from "../engine/schema";
import { newPage, closeBrowser } from "../engine/browser";

export const SHEET_TOPICS = [
  "money", "growth", "security", "team", "calendar", "time", "home", "bin", "recycling", "environment",
  "bus", "car", "cycling", "phone", "email", "website", "help", "information", "warning", "done",
  "no", "document", "signature", "statistics", "idea", "target", "announcement", "reminder", "search", "settings",
  "accessibility", "baby", "older", "doctor", "mental health", "food", "water", "energy", "school", "library",
  "job", "volunteer", "partnership", "community", "law", "police", "fire", "location", "parking", "shop",
  "delivery", "wifi", "laptop", "mobile", "video", "photo", "microphone", "quote", "quality", "love",
];

function arg(name: string): string | undefined {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : undefined;
}

/** One icon name per topic, best search result first, never the same icon twice. */
export function pickSheetIcons(brandId: string, topics = SHEET_TOPICS): Array<{ topic: string; name: string }> {
  const used = new Set<string>();
  return topics.map((topic) => {
    const hit = searchIcons(topic, { limit: 8, brand: brandId }).find((r) => !used.has(r.name));
    if (!hit) throw new Error(`No icon found for "${topic}"`);
    used.add(hit.name);
    return { topic, name: hit.name };
  });
}

function sheetHtml(b: LoadedBrand, scheme: "light" | "dark", icons: Array<{ topic: string; name: string }>, weightFor: (row: number) => IconWeight): string {
  const fmt = getFormat("16x9");
  const surf = b.brand.surfaces[scheme];
  const css = brandCss(b, fmt, (rel) => "file://" + path.join(b.dir, rel));
  const rows: string[] = [];
  for (let r = 0; r < 6; r++) {
    const weight = weightFor(r);
    const cells = icons.slice(r * 10, r * 10 + 10).map(({ topic, name }) => {
      const svg = renderIcon({ icon: name, weight }, b, { colour: surf.accent === surf.text ? surf.text : r % 2 ? surf.text : surf.accent, size: 88 });
      return `<figure><div class="ic">${svg ?? "MISSING"}</div><figcaption>${name}<span>${topic}</span></figcaption></figure>`;
    });
    rows.push(`<div class="row"><div class="w">${weight}</div>${cells.join("")}</div>`);
  }
  return `<!doctype html><html><head><meta charset="utf-8"><style>
${css}
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:1920px;height:1080px;overflow:hidden}
body{background:var(--${scheme}-bg);color:var(--${scheme}-text);font-family:var(--font-body);padding:56px 72px}
h1{font-family:var(--font-heading);font-weight:var(--weight-heading);font-size:34px;line-height:1.2;margin-bottom:28px}
h1 small{font-family:var(--font-body);font-weight:var(--weight-body);font-size:22px;margin-left:16px}
.row{display:flex;align-items:flex-start;height:150px}
.w{width:110px;font-family:var(--font-heading);font-weight:var(--weight-heading);font-size:20px;padding-top:34px}
figure{width:166px;display:flex;flex-direction:column;align-items:center;gap:8px}
.ic{width:88px;height:88px}
.ic svg{display:block}
figcaption{font-size:16px;line-height:1.25;text-align:center;font-weight:var(--weight-body)}
figcaption span{display:block;font-size:16px}
</style></head><body>
<h1>${b.brand.name}: icon library, ${scheme} scheme<small>Phosphor, one family. Each icon is the top search result for the word under it.</small></h1>
${rows.join("\n")}
</body></html>`;
}

async function main() {
  const brandId = arg("brand") ?? "demo";
  const only = arg("weight") as IconWeight | undefined;
  if (only && !ICON_WEIGHTS.includes(only)) throw new Error(`Weight must be one of ${ICON_WEIGHTS.join(", ")}`);
  const b = loadBrand(brandId);
  const icons = pickSheetIcons(brandId);
  const mix: IconWeight[] = ["regular", "light", "bold", "duotone", "fill", "thin"];
  const outDir = path.join(ICONS_DIR, "sheets");
  fs.mkdirSync(outDir, { recursive: true });
  const page = await newPage();
  try {
    await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
    for (const scheme of ["light", "dark"] as const) {
      const html = sheetHtml(b, scheme, icons, (r) => only ?? mix[r]);
      const file = path.join(outDir, `${brandId}-${scheme}.html`);
      fs.writeFileSync(file, html);
      await page.goto("file://" + file, { waitUntil: "load" });
      await page.evaluate(async () => {
        await document.fonts.ready;
      });
      const png = path.join(outDir, `${brandId}-${scheme}.png`);
      await page.screenshot({ path: png as `${string}.png`, clip: { x: 0, y: 0, width: 1920, height: 1080 } });
      console.log(`Wrote ${path.relative(process.cwd(), png)}`);
    }
  } finally {
    await page.close();
    await closeBrowser();
  }
}

if (require.main === module) {
  main().catch(async (e) => {
    console.error(e instanceof Error ? e.message : e);
    await closeBrowser();
    process.exit(1);
  });
}
