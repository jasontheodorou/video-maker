// Fast checks for the icon library and the brand module. Run: npm run icons-check
// No network, no rendering. Prints one line per check and exits 1 if any fail.
import fs from "node:fs";
import path from "node:path";
import { ICONS_DIR } from "../engine/paths";
import { ICON_WEIGHTS } from "../engine/schema";
import { loadIconIndex, searchIcons, checkIconName } from "../engine/icons/library";
import { CONCEPTS } from "../engine/icons/synonyms";
import { resolveIcon } from "../engine/icons";
import { loadBrand, inspectBrand } from "../engine/brand";
import { validateSpec } from "../engine/api";
import { assignColourRoles, proposeSurfaces, suggestTokensFromText, parseColourList, prepareIconSvg, sanitiseUploadedSvg, normaliseHex, checkBrand } from "../engine/brand/index";

let failed = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? `: ${detail}` : ""}`);
  if (!ok) failed++;
}

// ---- library ----
const idx = loadIconIndex();
check("library has about 1,500 icons", idx.count >= 1500, `${idx.count} icons, ${idx.source.package} ${idx.source.version}`);
let files = 0;
let bad: string[] = [];
for (const w of ICON_WEIGHTS) {
  for (const f of fs.readdirSync(path.join(ICONS_DIR, w))) {
    files++;
    const s = fs.readFileSync(path.join(ICONS_DIR, w, f), "utf8");
    if (!/viewBox="0 0 256 256"/.test(s) || !/fill="currentColor"/.test(s) || /<script|\son\w+=|href=/i.test(s)) bad.push(`${w}/${f}`);
  }
}
check("every library SVG is clean, has a viewBox and draws in currentColor", bad.length === 0, `${files} files${bad.length ? `, bad: ${bad.slice(0, 5).join(", ")}` : ""}`);
const missingFiles = idx.icons.flatMap((i) => i.weights.filter((w) => !fs.existsSync(path.join(ICONS_DIR, w, `${i.name}.svg`))).map((w) => `${w}/${i.name}`));
check("every weight in index.json has a file", missingFiles.length === 0, missingFiles.slice(0, 5).join(", "));
const missingConcepts = [...new Set(Object.values(CONCEPTS).flatMap((c) => c.icons))].filter((n) => !idx.icons.some((i) => i.name === n));
check("every icon named in synonyms.ts exists", missingConcepts.length === 0, missingConcepts.join(", "));

// ---- search ----
const top = (q: string, n = 3) => searchIcons(q, { limit: n }).map((r) => r.name);
const expect: Array<[string, string[], number]> = [
  ["money", ["currency-gbp", "money", "coins"], 3],
  ["growth", ["chart-line-up", "trend-up"], 2],
  ["security", ["shield-check"], 1],
  ["team", ["users-three"], 1],
  ["bin collection", ["trash"], 2],
  ["recycling", ["recycle"], 1],
  ["doctor", ["first-aid", "stethoscope"], 2],
  ["council tax", ["receipt"], 1],
  ["colour", ["palette"], 3],
  ["wifi", ["wifi-high"], 1],
];
for (const [q, want, n] of expect) {
  const got = top(q, n);
  check(`search "${q}" finds ${want.join(" or ")} in the top ${n}`, want.some((w) => got.includes(w)), got.join(", "));
}
check("company logos are left out of search", !top("twitter", 5).length);
const brandHit = searchIcons("bin", { brand: "demo", limit: 1 })[0];
check("client icons win in search", brandHit?.name === "bin" && brandHit.source === "brand");

// ---- names ----
const dym = checkIconName("chart-line-upp");
check("an unknown name gets a did-you-mean", !dym.ok && dym.suggestions[0] === "chart-line-up", dym.message);
check("an old Phosphor name still works", checkIconName("caduceus").ok && checkIconName("caduceus").canonical === "asclepius");
check("a client icon name counts for its brand", checkIconName("bin", { brand: "demo" }).ok && !checkIconName("bin").ok);

const spec = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "jobs", "demo-short", "spec.json"), "utf8"));
const bad1 = structuredClone(spec);
const st = bad1.scenes.find((s: { type: string }) => s.type === "statement");
if (st) {
  st.slots.icon = { icon: "calender" };
  const r = validateSpec(bad1);
  const msg = r.ok ? "" : r.issues.map((i) => i.message).join(" ");
  check("validateSpec rejects an unknown icon with a suggestion", !r.ok && /did you mean "calendar"/i.test(msg), msg);
  st.slots.icon = { icon: "chart-line-up", weight: "light" };
  check("validateSpec accepts a library icon", validateSpec(bad1).ok);
}

// ---- colouring ----
const demo = loadBrand("demo");
const duo = resolveIcon({ icon: "chart-line-up", weight: "duotone" }, demo);
check("duotone icons get the brand's light-layer opacity", Boolean(duo && /opacity="0\.2"/.test(duo.svg) && !/data-layer/.test(duo.svg)));
const tinted = inspectBrand({ ...demo.brand, icons: { ...demo.brand.icons, duotoneColour: "accent", duotoneOpacity: 0.4 } }, demo.dir);
const duo2 = resolveIcon({ icon: "chart-line-up", weight: "duotone" }, tinted);
check("duotone light layer can use a colour token", Boolean(duo2 && /opacity="0\.4" fill="var\(--c-accent\)"/.test(duo2.svg)));
const own = resolveIcon({ icon: "calendar" }, demo);
check("client icons override library icons by name", own?.source === "brand");

// ---- brand module ----
const demoColours = Object.entries(demo.brand.colours).map(([, v]) => ({ value: v!.value, name: v!.name }));
const roles = assignColourRoles(demoColours);
const surf = proposeSurfaces(roles.colours);
check("colour roles are guessed from a plain list", roles.colours.primary?.value === "#0B3B60" && roles.colours.text?.value === "#0B0C0C" && roles.colours.accent?.value === "#FFD84D", roles.notes.join(" | "));
check("proposed surfaces match the hand-made demo surfaces", JSON.stringify(surf.surfaces) === JSON.stringify(demo.brand.surfaces) && surf.ok);
const yellowOnWhite = proposeSurfaces({ primary: { value: "#FFD84D" }, text: { value: "#0B0C0C" }, background: { value: "#FFFFFF" }, accent: { value: "#FFD84D" }, tint: { value: "#FFF7D6" } });
check("a light primary is never used under white text", yellowOnWhite.ok && yellowOnWhite.surfaces.dark.background !== "primary", yellowOnWhite.notes[0]);
const sug = suggestTokensFromText(fs.readFileSync(path.join(demo.dir, "guidelines.md"), "utf8"));
check("guidelines text gives colours, tone and rules", sug.colours.length === 7 && Boolean(sug.toneOfVoice) && sug.rules.dont.length >= 3, `${sug.colours.length} colours, ${sug.rules.do.length} do, ${sug.rules.dont.length} don't`);
const pdfLike = suggestTokensFromText("Brand colours\nVale Blue RGB 11 59 96\nSunrise C0 M42 Y93 K0\nOur typeface is Source Sans 3.");
check("RGB and CMYK values are read", pdfLike.colours[0]?.value === "#0B3B60" && pdfLike.colours[1]?.from === "cmyk");
check("colour lists are read", parseColourList("Vale Blue #0B3B60 primary\nInk: #0b0c0c").length === 2 && parseColourList('{"primary":"#0B3B60"}')[0].name === "primary");
check("short hex and rgb() are normalised", normaliseHex("#abc") === "#AABBCC" && normaliseHex("rgb(11, 59, 96)") === "#0B3B60");
const icon = prepareIconSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" onload="x()"><script>x()</script><path fill="#123456" d="M0 0h24v24H0z"/></svg>');
check("uploaded icons are cleaned and recoloured", icon.recoloured && !/script|onload|#123456/.test(icon.svg) && /currentColor/.test(icon.svg));
const logo = sanitiseUploadedSvg('<svg><a href="https://example.com"><rect/></a><image xlink:href="http://x/y.png"/><use href="#a"/></svg>');
check("uploaded SVGs lose external links but keep #links", !/example\.com|http:\/\/x/.test(logo) && /href="#a"/.test(logo));
check("checkBrand accepts the demo brand", checkBrand(JSON.parse(fs.readFileSync(path.join(demo.dir, "brand.json"), "utf8")), demo.dir).ok);

console.log(failed ? `\n${failed} check(s) failed.` : "\nAll icon and brand checks passed.");
process.exit(failed ? 1 : 0);
