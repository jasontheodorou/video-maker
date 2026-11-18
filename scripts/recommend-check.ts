// Gate for the scheme recommender (engine/brand/recommend.ts): the HMCTS palette must give the looks of HMCTS's
// own explainer videos, and the demo brand must get schemes like its own.
// Run: npx tsx scripts/recommend-check.ts [--verbose]
import { recommendSchemes } from "../engine/brand/recommend";
import { loadBrand, emphasisWeightAvailable } from "../engine/brand";
import { resolveRef, contrastRatio } from "../engine/colour-core";
import { main, parseArgs } from "./cli";

/** The HMCTS colour guide (brand-guidelines-colour.pdf): core, accent and secondary colours, and its listed tints. */
export const HMCTS_PALETTE = {
  groups: [
    { id: "core", name: "Core" },
    { id: "accent", name: "Accent" },
    { id: "secondary", name: "Secondary" },
    { id: "neutral", name: "Neutral" },
  ],
  colours: [
    { id: "blue", name: "HMCTS blue", value: "#0096D6", group: "core", tints: true, tintValues: { t25: "#D1E4F7", t10: "#EDF5FC" } },
    { id: "navy", name: "Navy", value: "#002D59", group: "core", tints: true, tintValues: { t25: "#B5BAD0", t10: "#E0E2ED" } },
    { id: "black", name: "Black", value: "#000000", group: "core", tints: false },
    { id: "green", name: "Grass green", value: "#11A63C", group: "accent", tints: true, tintValues: { t25: "#D7E9D0", t10: "#F0F6ED" } },
    { id: "magenta", name: "Magenta", value: "#E72B78", group: "accent", tints: true, tintValues: { t25: "#FAD6E1", t10: "#FDEFF4" } },
    { id: "golden", name: "Golden", value: "#F9AE00", group: "accent", tints: true, tintValues: { t25: "#FFEBCB", t10: "#FFF7EB" } },
    { id: "purple", name: "Purple", value: "#724695", group: "accent", tints: true, tintValues: { t25: "#D9CFE8", t10: "#F0ECF7" } },
    { id: "teal", name: "Teal", value: "#008C9D", group: "secondary", tints: true, tintValues: { t25: "#C6E1E7", t10: "#E9F3F6" } },
    { id: "lime", name: "Lime", value: "#95C11F", group: "secondary", tints: true, tintValues: { t25: "#E8F0D0", t10: "#F6F9ED" } },
    { id: "orchid", name: "Orchid", value: "#75295A", group: "secondary", tints: true, tintValues: { t25: "#D7C3D4", t10: "#EFE6EE" } },
    { id: "rose", name: "Rose red", value: "#B1005A", group: "secondary", tints: true, tintValues: { t25: "#ECC7D5", t10: "#F7E9EF" } },
    { id: "grey", name: "Grey", value: "#878787", group: "secondary", tints: true, tintValues: { t25: "#E3E3E3", t10: "#F4F4F4" } },
    { id: "orange", name: "Orange", value: "#E9531D", group: "secondary", tints: true, tintValues: { t25: "#FCD9C4", t10: "#FEF0E8" } },
    { id: "white", name: "White", value: "#FFFFFF", group: "neutral", tints: false },
  ],
  rules: { text: ["navy", "black", "white"], source: "Text should be in HMCTS navy or black. (page 3)" },
};

let failures = 0;
function expect(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `: ${detail}` : ""}`);
  if (!ok) failures++;
}

main(async () => {
  const verbose = Boolean(parseArgs().flags.verbose);
  for (const variant of ["guide tints", "computed tints"] as const) {
    const palette = structuredClone(HMCTS_PALETTE) as typeof HMCTS_PALETTE;
    if (variant === "computed tints") for (const c of palette.colours) delete (c as { tintValues?: unknown }).tintValues;
    const r = recommendSchemes(palette, { emphasisWeightAvailable: true, limit: 6 });
    const show = r.schemes.map((s) => `${s.name} [${s.background} / ${s.text} / ${s.highlight} ${s.emphasis} / ${s.shape}] ${s.score}`);
    if (verbose) console.log(`HMCTS (${variant}):\n  ${show.join("\n  ")}\n  near misses: ${r.nearMisses.map((n) => n.scheme.name).join(", ")}`);
    const first4 = new Set(r.schemes.slice(0, 4).map((s) => s.id));
    expect(`HMCTS (${variant}): first four are Golden 10%, Blue 25%, Grey 10% and Navy`, ["golden-10", "blue-25", "grey-10", "navy"].every((id) => first4.has(id)), [...first4].join(", "));
    const pale = r.schemes.filter((s) => s.kind === "pale");
    expect(`HMCTS (${variant}): pale tints have navy text and bold navy key words`, pale.length >= 3 && pale.every((s) => s.text === "navy" && s.highlight === "navy" && s.emphasis === "weight"));
    const navy = r.schemes.find((s) => s.id === "navy");
    expect(`HMCTS (${variant}): Navy has white text, golden key words and a blue circle`, navy?.text === "white" && navy?.highlight === "golden" && navy?.emphasis === "colour" && navy?.shape === "blue", JSON.stringify(navy && { t: navy.text, h: navy.highlight, s: navy.shape }));
    expect(`HMCTS (${variant}): Navy is the only strong one`, r.schemes.filter((s) => s.kind === "deep").length === 1);
    const golden = r.schemes.find((s) => s.id === "golden-10");
    expect(`HMCTS (${variant}): Golden 10% has a deeper golden circle`, golden?.shape === "golden.t25");
    const later = r.schemes.slice(4);
    expect(`HMCTS (${variant}): schemes 5 and 6 are pale tints of other hues`, later.length === 2 && later.every((s) => s.kind === "pale") && new Set(later.map((s) => s.background.split(".")[0])).size === 2 && later.every((s) => !first4.has(s.id)), later.map((s) => s.name).join(", "));
    const allPass = r.schemes.every((s) => {
      const bg = resolveRef(s.background, palette)!;
      return contrastRatio(resolveRef(s.text, palette)!, bg) >= 7 && contrastRatio(resolveRef(s.highlight, palette)!, bg) >= 7 && s.contrast.icon >= 3;
    });
    expect(`HMCTS (${variant}): every suggestion passes AAA and icons reach 3 to 1`, allPass);
    const again = recommendSchemes(palette, { emphasisWeightAvailable: true, limit: 6 });
    expect(`HMCTS (${variant}): the same palette gives the same suggestions`, JSON.stringify(again) === JSON.stringify(r));
  }

  const demo = loadBrand("demo");
  const r = recommendSchemes(demo.brand.palette, { emphasisWeightAvailable: emphasisWeightAvailable(demo.brand), limit: 6 });
  if (verbose) console.log(`Demo:\n  ${r.schemes.map((s) => `${s.name} [${s.background} / ${s.text} / ${s.highlight} ${s.emphasis} / ${s.shape}] ${s.score}`).join("\n  ")}`);
  const dark = demo.scheme("dark")!;
  const light = demo.scheme("light")!;
  expect("demo: a suggestion matches its Dark scheme", r.schemes.some((s) => s.background === dark.background && s.text === dark.text && s.highlight === dark.highlight));
  expect("demo: a suggestion matches its Light scheme", r.schemes.some((s) => s.background === light.background && s.text === light.text && s.highlight === light.highlight));
  if (failures) throw new Error(`${failures} check(s) failed`);
  console.log("\nAll recommendation checks passed.");
});
