import fs from "node:fs";
import path from "node:path";
import { openJob, stepTiming } from "../engine/pipeline";
import { main } from "./cli";
main(async () => {
  const out = process.argv[2];
  for (const name of process.argv.slice(3)) {
    const src = path.join("jobs", name);
    const tmp = path.join(out, "jobs", name);
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.mkdirSync(tmp, { recursive: true });
    for (const f of ["spec.json", "decision.json"]) fs.copyFileSync(path.join(src, f), path.join(tmp, f));
    fs.cpSync(path.join(src, "audio"), path.join(tmp, "audio"), { recursive: true });
    const ctx = openJob(tmp);
    const tl = stepTiming(ctx);
    fs.writeFileSync(path.join(out, `${name}-timeline.json`), JSON.stringify(tl, null, 1));
  }
});
