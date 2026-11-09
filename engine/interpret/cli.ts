// Command line for the brief interpreter.
//
//   npm run interpret -- jobs/<name> [--brand=demo] [--voice=bf_emma] [--formats=16x9,1x1] [--no-fit]
//
// Reads jobs/<name>/brief.md, writes jobs/<name>/spec.json and jobs/<name>/interpret.json.
// Then run: npm run make -- jobs/<name>
import fs from "node:fs";
import path from "node:path";
import { interpretBrief, InterpretError } from "./index";
import { FORMAT_IDS, type FormatId } from "../config";

function arg(name: string): string | undefined {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : undefined;
}

async function main() {
  const dir = process.argv.slice(2).find((a) => !a.startsWith("--"));
  if (!dir) {
    console.error("Usage: npm run interpret -- jobs/<name> [--brand=demo] [--voice=bf_emma] [--formats=16x9,9x16,1x1] [--no-fit]");
    process.exit(2);
  }
  const jobDir = path.resolve(dir);
  const briefFile = path.join(jobDir, "brief.md");
  if (!fs.existsSync(briefFile)) {
    console.error(`No brief.md in ${jobDir}. Write the brief there first.`);
    process.exit(2);
  }
  const brief = fs.readFileSync(briefFile, "utf8");
  const formats = arg("formats")
    ?.split(",")
    .map((f) => f.trim())
    .filter((f): f is FormatId => (FORMAT_IDS as readonly string[]).includes(f));
  const mediaDir = path.join(jobDir, "media");
  const media = fs.existsSync(mediaDir)
    ? fs
        .readdirSync(mediaDir)
        .filter((f) => /\.(jpe?g|png|webp|mp4|mov|webm)$/i.test(f))
        .map((f) => ({ file: f, kind: /\.(mp4|mov|webm)$/i.test(f) ? ("clip" as const) : ("photo" as const) }))
    : [];
  try {
    const r = await interpretBrief({
      brief,
      brand: arg("brand") ?? "demo",
      voice: arg("voice"),
      formats,
      media,
      checkFit: !process.argv.includes("--no-fit"),
      onProgress: (e) => console.log(`[${e.stage}] ${e.message}`),
    });
    fs.writeFileSync(path.join(jobDir, "spec.json"), JSON.stringify(r.spec, null, 2) + "\n");
    const { spec: _spec, ...rest } = r;
    fs.writeFileSync(path.join(jobDir, "interpret.json"), JSON.stringify(rest, null, 2) + "\n");
    console.log(`\nWrote ${path.relative(process.cwd(), path.join(jobDir, "spec.json"))}: ${r.spec.scenes.length} scenes, size ${r.size.size}, ${r.attempts} attempt(s), ${r.seconds.toFixed(1)} s with ${r.backend} (${r.model}).`);
    for (const n of r.notes) console.log(`Note: ${n}`);
  } catch (e) {
    if (e instanceof InterpretError) {
      console.error(e.message);
      if (e.lastSpec) fs.writeFileSync(path.join(jobDir, "spec.rejected.json"), JSON.stringify(e.lastSpec, null, 2) + "\n");
      process.exit(1);
    }
    throw e;
  }
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
