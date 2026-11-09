// Lint step: hyperframes lint on each build, plus our own checks with the real brand fonts in Chrome.
// Text that does not fit fails. The engine never shrinks text to make it fit.
import fs from "node:fs";
import path from "node:path";
import { HF_BIN } from "./paths";
import { run } from "./proc";
import { getFormat, loadConfig, type FormatId } from "./config";
import { fullyVisibleSeconds, cueShift } from "./captions";
import { timingProblems } from "./align";
import { getScene } from "./scenes";
import { SLOT_WORDS } from "./scenes/common";
import { compileStill, writePage, contentRect, captionRect } from "./compile";
import { newPage } from "./browser";
import { sceneId, type Spec } from "./spec";
import type { LoadedBrand } from "./brand";
import type { Timeline } from "./schema";

export interface LintFinding {
  level: "error" | "warning";
  check: string;
  format?: FormatId;
  scene?: string;
  slot?: string;
  message: string;
}

/**
 * HyperFrames hints about editing in its Studio app (splitting scenes into sub-compositions and so on).
 * The engine compiles one generated file per format and never edits it by hand, so these do not apply.
 */
const STUDIO_ONLY_CODES = new Set(["nested_structure_needs_subcomposition", "timeline_track_too_dense", "duplicate_media_discovery_risk", "studio_missing_editable_id"]);

export async function hyperframesLint(buildDir: string, format: FormatId): Promise<LintFinding[]> {
  const r = await run(HF_BIN, ["lint", buildDir, "--json"]);
  let parsed: { findings?: Array<{ code: string; severity: string; message: string }> };
  try {
    parsed = JSON.parse(r.stdout);
  } catch {
    return [{ level: "error", check: "hyperframes-lint", format, message: `hyperframes lint did not return JSON: ${(r.stderr || r.stdout).slice(0, 300)}` }];
  }
  return (parsed.findings ?? [])
    .filter((f) => f.severity === "error" || f.severity === "warning")
    .filter((f) => !STUDIO_ONLY_CODES.has(f.code))
    .map((f) => ({ level: f.severity === "error" ? ("error" as const) : ("warning" as const), check: `hyperframes:${f.code}`, format, message: f.message }));
}

interface Measured {
  slot: string;
  lines: number;
  overflowX: boolean;
  overflowY: boolean;
  rect: { left: number; top: number; right: number; bottom: number };
}

/** Measure every [data-fit] element in a page after fonts load. */
async function measurePage(htmlFile: string, width: number, height: number, fontChecks: string[]) {
  const page = await newPage();
  try {
    await page.setViewport({ width, height, deviceScaleFactor: 1 });
    await page.goto("file://" + htmlFile, { waitUntil: "load" });
    return await page.evaluate(async (checks: string[]) => {
      await Promise.all(checks.map((c) => document.fonts.load(c)));
      await document.fonts.ready;
      const fontsOk = checks.map((c) => ({ font: c, ok: document.fonts.check(c) }));
      const lineCount = (el: Element) => {
        const cs = getComputedStyle(el);
        const lh = parseFloat(cs.lineHeight);
        const h = el.getBoundingClientRect().height - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
        return Math.round(h / lh);
      };
      const items = Array.from(document.querySelectorAll("[data-fit]")).map((el) => {
        const r = el.getBoundingClientRect();
        const h = el as HTMLElement;
        return {
          slot: h.dataset.fit as string,
          lines: lineCount(el),
          overflowX: h.scrollWidth > h.clientWidth + 1,
          overflowY: h.scrollHeight > h.clientHeight + 1,
          rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom },
        };
      });
      const content = document.querySelector(".content") as HTMLElement | null;
      const contentOverflow = content ? content.scrollHeight > content.clientHeight + 1 || content.scrollWidth > content.clientWidth + 1 : false;
      const images = Array.from(document.images).map((i) => ({ src: i.getAttribute("src"), ok: i.complete && i.naturalWidth > 0 }));
      // Union of all visible content boxes, to catch anything drawn outside the content area.
      let box = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
      if (content) {
        for (const el of Array.from(content.querySelectorAll("*"))) {
          const r = el.getBoundingClientRect();
          if (r.width < 1 || r.height < 1) continue;
          box = { left: Math.min(box.left, r.left), top: Math.min(box.top, r.top), right: Math.max(box.right, r.right), bottom: Math.max(box.bottom, r.bottom) };
        }
      }
      // An empty scene (a photo with no text) has no box. Infinity does not survive the trip back from Chrome.
      if (!Number.isFinite(box.left)) box = { left: 0, top: 0, right: 0, bottom: 0 };
      return { fontsOk, items, contentOverflow, images, box, empty: box.right === 0 && box.bottom === 0 };
    }, fontChecks);
  } finally {
    await page.close();
  }
}

/** Plain name of a scene's text part for messages ("the title", "item 2"). */
export function partName(slot: string): string {
  return SLOT_WORDS[slot] ?? slot;
}

function joinOr(list: string[]): string {
  return list.length <= 1 ? list.join("") : `${list.slice(0, -1).join(", ")} or ${list[list.length - 1]}`;
}

/**
 * Text-fit check for one scene in one format, as a settled still with the real fonts. The messages name the
 * part to shorten. Used by lint, the brief interpreter, the script editor and scripts/limits-check.ts.
 */
export async function sceneFitCheck(
  scene: { type: string; slots: Record<string, unknown>; id: string },
  brand: LoadedBrand,
  formatId: FormatId,
  dir: string,
  fontChecks = brand.brand.fonts.faces.map((f) => `${f.style === "italic" ? "italic " : ""}${f.weight} 40px "${f.family}"`),
  number?: number,
): Promise<LintFinding[]> {
  const findings: LintFinding[] = [];
  const format = getFormat(formatId);
  const content = contentRect(format);
  const id = scene.id;
  const def = getScene(scene.type);
  const where = number ? `Scene ${number} (${def.label})` : def.label;
  const fmt = FORMAT_WORDS[formatId];
  const page = compileStill({ type: scene.type, slots: scene.slots, id }, brand, formatId);
  for (const iss of page.issues) findings.push({ level: iss.level, check: "compile", format: formatId, scene: id, message: iss.message });
  const file = writePage(page, dir, `${id}.html`);
  const m = await measurePage(file, format.width, format.height, fontChecks);
  for (const f of m.fontsOk) if (!f.ok) findings.push({ level: "error", check: "fonts", format: formatId, scene: id, message: `Font ${f.font} did not load.` });
  for (const img of m.images) if (!img.ok) findings.push({ level: "error", check: "images", format: formatId, scene: id, message: `Image ${img.src} did not load.` });
  // Which parts to shorten: every text part the scene shows, longest first.
  const present = [...new Set((m.items as Measured[]).map((it) => it.slot))]
    .map((slot) => ({ slot, len: textLength(scene.slots[slot]) }))
    .sort((a, b) => b.len - a.len)
    .map((x) => partName(x.slot));
  const shorten = present.length ? `Shorten ${joinOr(present)}.` : "Shorten the text.";
  let together = false;
  if (m.contentOverflow) {
    together = true;
    findings.push({ level: "error", check: "text-fit", format: formatId, scene: id, message: `${where}: together, the text is too tall for the ${fmt} video. ${shorten}` });
  }
  const tol = 1;
  if (!together && !m.empty && (m.box.left < content.x - tol || m.box.top < content.y - tol || m.box.right > content.x + content.w + tol || m.box.bottom > content.y + content.h + tol)) {
    findings.push({ level: "error", check: "safe-area", format: formatId, scene: id, message: `${where}: the text goes outside the safe area or into the captions in the ${fmt} video. ${shorten}` });
  }
  for (const it of m.items as Measured[]) {
    const spec = def.text.find((t) => t.slot === it.slot);
    if (!spec) continue;
    const max = spec.maxLines[formatId];
    const name = partName(it.slot);
    if (it.lines > max)
      findings.push({ level: "error", check: "text-fit", format: formatId, scene: id, slot: it.slot, message: `${where}: ${name} runs to ${it.lines} lines in the ${fmt} video, and the most is ${max}. Shorten ${name}.` });
    if (it.overflowX)
      findings.push({ level: "error", check: "text-fit", format: formatId, scene: id, slot: it.slot, message: `${where}: ${name} is too wide for the ${fmt} video. A word or web address may be too long. Shorten ${name}.` });
  }
  return findings;
}

function textLength(v: unknown): number {
  if (typeof v === "string") return v.length;
  if (Array.isArray(v)) return v.reduce((t: number, x) => t + (typeof x === "object" && x && "text" in x ? String((x as { text: unknown }).text).length : typeof x === "object" && x && "label" in x ? String((x as { label: unknown }).label).length : 0), 0);
  return 0;
}

const FORMAT_WORDS: Record<FormatId, string> = { "16x9": "landscape", "9x16": "portrait", "1x1": "square" };

/**
 * Text-fit check: each scene of the spec as a settled still, in each format, with the real fonts.
 * Also checks every caption cue fits the caption band in at most the allowed lines.
 */
export async function textFitCheck(spec: Spec, brand: LoadedBrand, timeline: Timeline | null, formats: FormatId[], workDir: string, signal?: AbortSignal): Promise<LintFinding[]> {
  const findings: LintFinding[] = [];
  const fontChecks = brand.brand.fonts.faces.map((f) => `${f.style === "italic" ? "italic " : ""}${f.weight} 40px "${f.family}"`);
  for (const formatId of formats) {
    const format = getFormat(formatId);
    const content = contentRect(format);
    const dir = path.join(workDir, formatId);
    for (let i = 0; i < spec.scenes.length; i++) {
      if (signal?.aborted) return findings;
      const s = spec.scenes[i];
      findings.push(...(await sceneFitCheck({ type: s.type, slots: s.slots as Record<string, unknown>, id: sceneId(s, i) }, brand, formatId, dir, fontChecks, i + 1)));
    }
    // Captions: render each cue in the caption band and count lines.
    if (timeline) {
      const capPage = compileStill({ type: spec.scenes[0].type, slots: spec.scenes[0].slots as Record<string, unknown>, id: "capcheck" }, brand, formatId, { caption: "Caption" });
      const capFile = writePage(capPage, dir, `captions.html`);
      const band = captionRect(format);
      const p = await newPage();
      try {
        await p.setViewport({ width: format.width, height: format.height, deviceScaleFactor: 1 });
        await p.goto("file://" + capFile, { waitUntil: "load" });
        const res = await p.evaluate(async (texts: string[]) => {
          await document.fonts.ready;
          const el = document.getElementById("cap-0-box") as HTMLElement;
          return texts.map((t) => {
            el.textContent = t;
            const cs = getComputedStyle(el);
            const r = el.getBoundingClientRect();
            const lines = Math.round((r.height - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)) / parseFloat(cs.lineHeight));
            return { lines, top: r.top, left: r.left, right: r.right, bottom: r.bottom };
          });
        }, timeline.captions.map((c) => c.text));
        res.forEach((r, k) => {
          const cue = timeline.captions[k];
          if (r.lines > 2) findings.push({ level: "error", check: "captions", format: formatId, message: `The caption "${cue.text}" runs to ${r.lines} lines in the ${FORMAT_WORDS[formatId]} video, and the most is 2. Shorten the spoken line it comes from.` });
          if (r.top < band.y - 1 || r.left < band.x - 1 || r.right > band.x + band.w + 1 || r.bottom > band.y + band.h + 1)
            findings.push({ level: "error", check: "captions", format: formatId, message: `Caption "${cue.text}" does not fit the caption band in ${format.label}.` });
        });
      } finally {
        await p.close();
      }
    }
  }
  return findings;
}

/** Timing checks on timeline.json: reading time, caption length and no flashing captions. */
export function timingCheck(timeline: Timeline, minCaption: number): LintFinding[] {
  const out: LintFinding[] = [];
  for (const s of timeline.scenes) {
    for (const t of s.text) {
      const shown = t.visibleUntil - t.visibleFrom;
      if (shown + 1e-6 < t.requiredSeconds) out.push({ level: "error", check: "reading-time", scene: s.id, slot: t.slot, message: `${t.slot} is fully visible for ${shown.toFixed(2)} s; it needs ${t.requiredSeconds.toFixed(2)} s.` });
    }
  }
  const cfg = loadConfig().captions;
  for (const c of timeline.captions) {
    const words = c.text.split(/\s+/).length;
    const shown = fullyVisibleSeconds(c, cfg.fade);
    if (shown + 1e-6 < Math.min(minCaption, 0.8)) out.push({ level: "error", check: "captions", message: `Caption "${c.text}" is fully visible for only ${shown.toFixed(2)} s.` });
    else if (shown + 1e-3 < minCaption) out.push({ level: "warning", check: "captions", message: `Caption "${c.text}" is fully visible for ${shown.toFixed(2)} s, under the ${minCaption} s target, because the voice moves on quickly.` });
    const shift = cueShift(c);
    if (Math.abs(shift) > cfg.maxShift + 1e-6)
      out.push({ level: "warning", check: "captions", message: `Caption "${c.text}" appears ${Math.abs(shift).toFixed(2)} s ${shift > 0 ? "after" : "before"} its first word is spoken, to give the captions around it time to be read.` });
    if (words > 7) out.push({ level: "error", check: "captions", message: `Caption "${c.text}" has ${words} words. Keep captions to about 6.` });
  }
  // Word timings that would put captions out of step with the voice (for example whisper running one word
  // over most of a phrase). The align step already avoids these; this catches anything it missed.
  for (const s of timeline.scenes) {
    for (const p of s.phrases) {
      const local = p.words.map((w) => ({ ...w, start: w.start - p.start, end: w.end - p.start }));
      const problems = timingProblems(local, p.audioSeconds);
      if (problems.length) out.push({ level: "warning", check: "word-timing", scene: s.id, message: `Captions may be out of step with the voice in "${p.text.slice(0, 50)}": ${problems.join("; ")}.` });
    }
  }
  return out;
}

export function writeLintReport(file: string, findings: LintFinding[]): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ ok: !findings.some((f) => f.level === "error"), findings }, null, 2));
}
