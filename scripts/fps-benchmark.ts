// Measures render time for all three formats at 60 and 30 fps on this machine and records the result.
// Rule: use 60 fps if a 30-second video renders in all three formats in under 6 minutes, else 30 fps.
// Run: npx tsx scripts/fps-benchmark.ts jobs/<name>  (the job must already be compiled)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openJob, loadTimeline } from "../engine/pipeline";
import { renderBuild } from "../engine/render";
import { loadConfig } from "../engine/config";
import { ROOT } from "../engine/paths";
import { parseArgs, jobArg, main } from "./cli";

main(async () => {
  const args = parseArgs();
  const ctx = openJob(jobArg(args, "npx tsx scripts/fps-benchmark.ts jobs/<name> [--only=60]"));
  const timeline = loadTimeline(ctx);
  const cfg = loadConfig();
  const rates = typeof args.flags.only === "string" ? [Number(args.flags.only)] : [60, 30];
  const results: Array<{ fps: number; perFormat: Record<string, number>; totalSeconds: number; scaledTo30s: number }> = [];
  for (const fps of rates) {
    const perFormat: Record<string, number> = {};
    for (const f of ctx.formats) {
      const out = path.join(os.tmpdir(), `va-bench-${f}-${fps}.mp4`);
      const r = await renderBuild(path.join(ctx.job.build, f), out, { fps, quality: cfg.render.finalQuality, workers: cfg.render.workers });
      perFormat[f] = Number(r.seconds.toFixed(1));
      fs.rmSync(out, { force: true });
      console.log(`${fps} fps ${f}: ${r.seconds.toFixed(1)} s`);
    }
    const total = Object.values(perFormat).reduce((a, b) => a + b, 0);
    results.push({ fps, perFormat, totalSeconds: Number(total.toFixed(1)), scaledTo30s: Number(((total * 30) / timeline.duration).toFixed(1)) });
  }
  const r60 = results.find((r) => r.fps === 60);
  const chosen = r60 && r60.scaledTo30s < 360 ? 60 : 30;
  const record = {
    measuredOn: new Date().toISOString().slice(0, 10),
    machine: `${os.cpus()[0]?.model ?? "unknown"}, ${os.cpus().length} cores, ${Math.round(os.totalmem() / 2 ** 30)} GB, ${os.platform()} ${os.arch()}`,
    job: path.relative(ROOT, ctx.job.dir),
    videoSeconds: timeline.duration,
    quality: cfg.render.finalQuality,
    rule: "60 fps if a 30-second video renders in all three formats in under 6 minutes (360 s), else 30 fps.",
    results,
    chosenFps: chosen,
  };
  fs.writeFileSync(path.join(ROOT, "config", "fps-measurement.json"), JSON.stringify(record, null, 2) + "\n");
  console.log(`\nChosen: ${chosen} fps. Recorded in config/fps-measurement.json.`);
});
