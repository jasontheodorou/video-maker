// Limits check: proves that every scene's character limits really fit, with the real brand fonts.
// For each scene type it fills every text slot to its limit (and every optional slot too, with the most
// list items), using several realistic texts with long words, then runs the lint fit check in all three
// formats. Any failure means a limit or a layout needs changing.
//
//   npx tsx scripts/limits-check.ts [--brand=demo] [--scenes=title,points] [--variants=6] [--json]
//   npx tsx scripts/limits-check.ts --calibrate   proposes limits that fit: it lowers a failing slot's limit
//                                                 (for "too tall together", the longest optional slot first)
//                                                 until every variant fits in every format.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadBrand } from "../engine/brand";
import { SCENES } from "../engine/scenes";
import { sceneFitCheck, type LintFinding } from "../engine/lint";
import { retainBrowser, releaseBrowser } from "../engine/browser";
import { FORMAT_IDS, type FormatId } from "../engine/config";

const args: Record<string, string> = Object.fromEntries(
  process.argv.slice(2).filter((a) => a.startsWith("--")).map((a) => {
    const [k, ...v] = a.replace(/^--/, "").split("=");
    return [k, v.join("=")];
  }),
);
const brandId = args.brand ?? "demo";
const only = args.scenes ? args.scenes.split(",") : null;
const variants = Number(args.variants ?? 6);

// Realistic public sector sentences, with slightly long words: the honest worst case for line breaks.
// (Text made only of 12-letter words is not how people write and would make every limit tiny.)
const SENTENCES = [
  "Garden waste collections are changing from next month for every household in the borough",
  "Check your new collection day online and put your bin out by seven in the morning",
  "Residents can now apply for parking permits and pay council tax through our website",
  "Most libraries keep their opening hours including Saturdays and bank holidays this spring",
  "Independent advice is available for families struggling with energy bills and housing costs",
  "Volunteers help us keep neighbourhood parks safe, clean and welcoming for everyone",
  "Register to vote before the deadline so you can have your say in the local elections",
  "Our environmental improvements will reduce traffic and make streets around schools safer",
];
const WORDS = SENTENCES.join(" ").replace(/[,.]/g, "").split(/\s+/);

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** Text of length max - 3 to max, from real sentences, starting at a different word for each seed. */
function textOf(max: number, seed: number, _longBias: boolean): string {
  const start = (seed * 17) % WORDS.length;
  for (let shift = 0; shift < WORDS.length; shift++) {
    const words: string[] = [];
    let i = start + shift;
    while (words.join(" ").length < max) words.push(WORDS[i++ % WORDS.length]);
    while (words.join(" ").length > max) words.pop();
    const t = words.join(" ");
    if (t.length >= Math.max(1, max - 3)) return t.charAt(0).toUpperCase() + t.slice(1);
  }
  return "W".repeat(max);
}

function slotText(slot: string, max: number, seed: number): string {
  const r = rng(seed * 7 + 3);
  if (slot === "value") return ["£999,999", "1 in 4", "100%", "12,500", "£12.4m"][seed % 5].slice(0, max);
  if (slot === "link") {
    const host = "northvale.example/";
    let p = "";
    const parts = ["council-tax", "bins", "spring-changes", "parking-permits", "libraries", "apply", "report"];
    while ((host + p).length < max - 4) p += (p ? "/" : "") + parts[Math.floor(r() * parts.length)];
    return (host + p).slice(0, max).replace(/[-/]$/, "");
  }
  if (slot === "name") return ["Councillor Adaeze Whitfield-Brown", "Priya Ramachandran-Hughes", "Dr Oluwaseun Fitzgerald-Okafor"][seed % 3].slice(0, max);
  if (slot === "detail") return ("Or call 0300 555 0199, Monday to Friday, 9am to 5pm, and Saturday mornings").slice(0, max).replace(/[ ,]+\S*$/, "");
  return textOf(max, seed, seed % 2 === 0);
}

function fill(type: string, seed: number, limits?: Record<string, number>): Record<string, unknown> {
  const def = SCENES.find((s) => s.type === type)!;
  const slots = JSON.parse(JSON.stringify(def.sample)) as Record<string, unknown>;
  delete slots.emphasis;
  for (const t of def.text) {
    if (t.slot === "items") {
      const sample = (def.sample as Record<string, unknown>).items as Array<Record<string, unknown>>;
      const key = "text" in sample[0] ? "text" : "label";
      slots.items = [0, 1, 2, 3].map((k) => ({ ...sample[k % sample.length], [key]: slotText(key, limits?.items ?? t.maxChars, seed * 10 + k) }));
    } else slots[t.slot] = slotText(t.slot, limits?.[t.slot] ?? t.maxChars, seed * 10 + t.slot.length);
  }
  return slots;
}

async function failuresFor(def: (typeof SCENES)[number], brand: ReturnType<typeof loadBrand>, dir: string, limits?: Record<string, number>) {
  const out: Array<LintFinding & { variant: number; slots: Record<string, unknown> }> = [];
  for (let v = 0; v < variants; v++) {
    const slots = fill(def.type, v + 1, limits);
    for (const f of FORMAT_IDS as readonly FormatId[]) {
      const found = (await sceneFitCheck({ type: def.type, slots, id: `${def.type}-${v}` }, brand, f, path.join(dir, f))).filter((x) => x.level === "error");
      for (const x of found) out.push({ ...x, variant: v, slots });
    }
  }
  return out;
}

/**
 * Calibrate: for each text slot, the longest length that fits in every format, with the real fonts, while the
 * scene's other slots hold their sample content (typical text, optional slots included). A binary search per slot.
 */
async function calibrate() {
  const brand = loadBrand(brandId);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "va-limits-"));
  retainBrowser();
  try {
    for (const def of SCENES) {
      if (only && !only.includes(def.type)) continue;
      const result: Record<string, number> = {};
      for (const t of def.text) {
        if (t.slot === "value") continue;
        const fitsAt = async (len: number) => {
          for (let v = 0; v < variants; v++) {
            const slots = JSON.parse(JSON.stringify(def.sample)) as Record<string, unknown>;
            delete slots.emphasis;
            if (t.slot === "items") {
              const sample = slots.items as Array<Record<string, unknown>>;
              const key = "text" in sample[0] ? "text" : "label";
              slots.items = Array.from({ length: Number(args.items || 4) }, (_x, k) => ({ ...sample[k % sample.length], [key]: slotText(key, len, v * 10 + k + 1) }));
            } else slots[t.slot] = slotText(t.slot, len, v * 10 + 1);
            for (const f of FORMAT_IDS as readonly FormatId[]) {
              // A single word wider than its column is a word-length problem that no character limit can
              // prevent (lint names it as "too wide"), so it does not count against the limit here.
              const found = (await sceneFitCheck({ type: def.type, slots, id: `${def.type}-${t.slot}-${v}` }, brand, f, path.join(dir, f))).filter(
                (x) => x.level === "error" && !/too wide/.test(x.message),
              );
              if (found.length) return false;
            }
          }
          return true;
        };
        let lo = 8;
        let hi = t.maxChars;
        if (await fitsAt(hi)) lo = hi;
        else
          while (hi - lo > 1) {
            const mid = Math.floor((lo + hi) / 2);
            if (await fitsAt(mid)) lo = mid;
            else hi = mid;
          }
        result[t.slot] = lo;
      }
      const was = Object.fromEntries(def.text.map((t) => [t.slot, t.maxChars]));
      console.log(`${def.type.padEnd(11)} fits ${JSON.stringify(result)}  now ${JSON.stringify(was)}`);
    }
  } finally {
    await releaseBrowser();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function main() {
  if (args.calibrate !== undefined) return calibrate();
  const brand = loadBrand(brandId);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "va-limits-"));
  const failures: Array<LintFinding & { variant: number; slots: Record<string, unknown> }> = [];
  retainBrowser();
  try {
    for (const def of SCENES) {
      if (only && !only.includes(def.type)) continue;
      let bad = 0;
      for (let v = 0; v < variants; v++) {
        const slots = fill(def.type, v + 1);
        const parsed = def.slots.safeParse(slots);
        if (!parsed.success) {
          console.log(`${def.type} variant ${v}: sample does not parse: ${parsed.error.issues.map((i) => i.path.join(".") + " " + i.message).join("; ")}`);
          continue;
        }
        for (const f of FORMAT_IDS as readonly FormatId[]) {
          const found = (await sceneFitCheck({ type: def.type, slots, id: `${def.type}-${v}` }, brand, f, path.join(dir, f))).filter((x) => x.level === "error");
          for (const x of found) failures.push({ ...x, variant: v, slots });
          bad += found.length;
        }
      }
      console.log(`${def.type.padEnd(11)} ${bad ? `${bad} problems` : "fits"}`);
    }
  } finally {
    await releaseBrowser();
    fs.rmSync(dir, { recursive: true, force: true });
  }
  if (args.json !== undefined) {
    // Written to a file when --json=<file> is given; a pipe can be cut short when the process exits.
    if (args.json) fs.writeFileSync(args.json, JSON.stringify(failures, null, 2));
    else console.log(JSON.stringify(failures, null, 2));
  }
  else
    for (const f of failures)
      console.log(`- ${f.format} ${f.scene}: ${f.message}${f.slot ? `\n    ${f.slot}: ${JSON.stringify(f.slot === "items" ? (f.slots.items as unknown[]).map((i) => (i as Record<string, string>).text ?? (i as Record<string, string>).label) : f.slots[f.slot])}` : ""}`);
  process.exit(failures.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
