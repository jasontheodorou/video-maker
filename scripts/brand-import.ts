// Import a folder of client brand assets as a new brand.
//
//   npm run brand-import -- <folder> [--name="Client Name"] [--id=client] [--from=demo] [--overwrite] [--offline] [--preview] [--json]
//
// Writes brands/<id>/ (brand.json, fonts, logos, icons, graphics, guidelines) and prints what it found,
// the colour pairs that pass AAA, the choices it made, and the gaps still to fill (marked provisional).
// A thin wrapper over importBrandFromFolder in engine/brand, which the web app also uses.
import path from "node:path";
import { importBrandFromFolder, renderBrandPreview } from "../engine/brand/index";
import { closeBrowser } from "../engine/browser";

function arg(name: string): string | undefined {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

async function main() {
  const folder = process.argv.slice(2).find((a) => !a.startsWith("--"));
  if (!folder) {
    console.error("Give the folder of client assets: npm run brand-import -- <folder> [--name=\"Client Name\"] [--id=client]");
    process.exit(2);
  }
  const report = await importBrandFromFolder(folder, {
    name: arg("name"),
    id: arg("id"),
    from: arg("from"),
    overwrite: flag("overwrite"),
    network: !flag("offline"),
  });
  if (flag("json")) {
    console.log(JSON.stringify({ ...report, brand: { id: report.brand.id, dir: report.brand.dir, check: report.brand.check } }, null, 2));
    return;
  }
  const b = report.brand;
  const raw = b.raw as any;
  const out: string[] = [];
  out.push(`Brand "${raw.name}" written to ${path.relative(process.cwd(), b.dir)}/`);
  out.push("");
  out.push("Found:");
  out.push(`- Logos: ${report.found.logos.join(", ") || "none"}`);
  out.push(`- Fonts: ${report.found.fonts.join(", ") || "none"}`);
  out.push(`- Icons: ${report.found.icons.length ? `${report.found.icons.length} (${report.found.icons.slice(0, 8).join(", ")}${report.found.icons.length > 8 ? " and more" : ""})` : "none"}`);
  out.push(`- Graphics: ${report.found.graphics.length || "none"}`);
  out.push(`- Guidelines: ${report.found.guidelines.join(", ") || "none"}`);
  out.push(`- Colours: ${report.found.colours.map((c) => `${c.name ?? ""} ${c.value}`.trim()).join(", ") || "none"}`);
  out.push("");
  out.push("Colours by role:");
  for (const [role, c] of Object.entries(raw.colours as Record<string, { value: string; name?: string }>)) out.push(`- ${role}: ${c.name ?? ""} ${c.value}`.replace("  ", " "));
  out.push("");
  out.push("Surfaces (every text pair here must pass AAA, 7 to 1):");
  for (const p of b.check.contrast) out.push(`- ${p.result.passesAAA ? "Passes" : "FAILS "} ${p.label}: ${p.result.ratioText} to 1${p.result.passesAAA ? "" : `. ${p.result.message}`}`);
  out.push("");
  out.push(`Colour pairs that pass AAA (${report.legalPairs.length}):`);
  for (const p of report.legalPairs.slice(0, 20)) out.push(`- ${p}`);
  if (report.notes.length) {
    out.push("");
    out.push("Choices made:");
    for (const n of report.notes) out.push(`- ${n}`);
  }
  if (report.warnings.length) {
    out.push("");
    out.push("Warnings:");
    for (const w of report.warnings) out.push(`- ${w}`);
  }
  out.push("");
  out.push(`Gaps (marked provisional in brand.json: ${(raw.provisional as string[]).join(", ") || "none"}):`);
  for (const g of report.gaps) out.push(`- ${g.group}: ${g.message}`);
  out.push("");
  out.push(b.check.ok ? "The brand passes every check and can render." : "The brand has errors that stop rendering. Fix the gaps above, then run npm run doctor.");
  console.log(out.join("\n"));

  if (flag("preview")) {
    const dir = path.join(b.dir, ".preview");
    const r = await renderBrandPreview(b.id, { outDir: dir });
    console.log(`\nPreview stills: ${r.items.filter((i) => i.png).length} PNGs in ${path.relative(process.cwd(), dir)}/`);
    await closeBrowser();
  }
}

main().catch(async (e) => {
  console.error(e instanceof Error ? e.message : e);
  await closeBrowser();
  process.exit(1);
});
