import fs from "node:fs";
import path from "node:path";
import { openJob, loadTimeline } from "../engine/pipeline";
import { compileVideo } from "../engine/compile";
import { computeTimeline } from "../engine/timing";
import { FORMAT_IDS } from "../engine/config";
import { main } from "./cli";
main(async () => {
  const out = process.argv[2];
  for (const name of process.argv.slice(3)) {
    const ctx = openJob(path.join("jobs", name));
    const tl = loadTimeline(ctx);
    for (const f of FORMAT_IDS) {
      const p = compileVideo(ctx.spec, tl, ctx.brand, f, {});
      fs.writeFileSync(path.join(out, `${name}-${f}.html`), p.html);
    }
  }
});
