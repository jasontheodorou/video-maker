// Temporary: settled stills of every scene sample in every format, for before/after comparison.
import fs from "node:fs";
import path from "node:path";
import { loadBrand } from "../engine/brand";
import { compileStill, writePage } from "../engine/compile";
import { SCENES } from "../engine/scenes";
import { FORMAT_IDS, getFormat } from "../engine/config";
import { newPage, closeBrowser } from "../engine/browser";
import { main } from "./cli";
main(async () => {
  const out = process.argv[2];
  const brandId = process.argv[3] ?? "demo";
  fs.mkdirSync(out, { recursive: true });
  const b = loadBrand(brandId);
  for (const def of SCENES) {
    for (const f of FORMAT_IDS) {
      const page = compileStill({ type: def.type, slots: def.sample as Record<string, unknown>, id: def.type.replace(/[^a-z]/g, "") }, b, f, { caption: "Captions look like this on screen" });
      const file = writePage(page, path.join(out, "html"), `${def.type}-${f}.html`);
      const fmt = getFormat(f);
      const pg = await newPage();
      await pg.setViewport({ width: fmt.width, height: fmt.height, deviceScaleFactor: 1 });
      await pg.goto("file://" + file, { waitUntil: "load" });
      await pg.evaluate(async () => { await document.fonts.ready; await new Promise((r) => setTimeout(r, 100)); });
      await pg.screenshot({ path: path.join(out, `${def.type}-${f}.png`) as `${string}.png` });
      await pg.close();
    }
  }
  await closeBrowser();
});
