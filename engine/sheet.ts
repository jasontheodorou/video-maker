// Contact sheet: one still per scene per format from the real compiled video, tiled into one image
// with scene names and times. Claude looks at it first; then a person approves it before the full render.
import fs from "node:fs";
import path from "node:path";
import { getFormat, type FormatId } from "./config";
import { ENTRANCES, STAGGER } from "./motion";
import { getScene } from "./scenes";
import { sceneTransitionSeconds } from "./transitions";
import { snapshotBuild } from "./render";
import { screenshotFile } from "./browser";
import { escapeHtml } from "./text";
import type { Spec } from "./spec";
import type { Timeline } from "./schema";

/** The moment each scene is settled: all entrances done, before the next scene starts to cover it. */
export function settledTimes(spec: Spec, timeline: Timeline): number[] {
  return timeline.scenes.map((s, i) => {
    const def = getScene(s.type);
    const els = def.elements(spec.scenes[i].slots as Record<string, unknown>);
    const settled = s.enterAt + Math.max(0, ...els.map((e, k) => k * STAGGER + ENTRANCES[e.entrance].duration)) + 0.4;
    const next = timeline.scenes[i + 1];
    const latest = s.duration - (next ? sceneTransitionSeconds(next, timeline.crossfade) : 0) - 0.1;
    // Prefer a moment when a caption is showing, so the sheet shows the caption style too.
    const want = Math.min(settled, latest);
    const abs = s.start + want;
    const cue = timeline.captions.find((c) => c.end > abs && c.start < s.start + latest);
    const t = cue && cue.start > abs ? Math.min(cue.start + 0.2, s.start + latest) : abs;
    return Math.round(t * 30) / 30;
  });
}

/** Plain words for the contact sheet labels. */
const BEAT_WORDS: Record<string, string> = { hook: "The opening", problem: "The problem", message: "The main message", insight: "What it means", proof: "The evidence", summary: "The summary", action: "What to do" };
const LIMIT_WORDS: Record<string, string> = {
  voice: "As long as the voice",
  reading: "Held so the text can be read",
  minimum: "Shortest scene length",
  target: "Held to reach the video's length",
};

export interface SheetResult {
  sheet: string;
  stills: Record<FormatId, string[]>;
  times: number[];
}

export async function makeContactSheet(spec: Spec, timeline: Timeline, buildDirs: Record<FormatId, string>, reviewDir: string, signal?: AbortSignal): Promise<SheetResult> {
  const times = settledTimes(spec, timeline);
  const stills = {} as Record<FormatId, string[]>;
  const formats = Object.keys(buildDirs) as FormatId[];
  for (const f of formats) {
    if (signal?.aborted) throw new Error("Stopped.");
    const dir = path.join(reviewDir, "stills", f);
    const shots = await snapshotBuild(buildDirs[f], times, path.join(reviewDir, ".snap-" + f));
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    stills[f] = shots.map((p, i) => {
      const dest = path.join(dir, `${String(i + 1).padStart(2, "0")}-${timeline.scenes[i].id}.png`);
      fs.copyFileSync(p, dest);
      return dest;
    });
    fs.rmSync(path.join(reviewDir, ".snap-" + f), { recursive: true, force: true });
  }

  // Lay the stills out: one row per scene, one column per format, scaled to the same height.
  const rowH = 300;
  const colW = (f: FormatId) => Math.round((getFormat(f).width / getFormat(f).height) * rowH);
  const labelW = 300;
  const gap = 24;
  const width = labelW + formats.reduce((w, f) => w + colW(f) + gap, 0) + gap;
  const height = 120 + timeline.scenes.length * (rowH + gap) + gap;
  const rows = timeline.scenes
    .map((s, i) => {
      const cells = formats
        .map((f) => `<img src="${path.relative(reviewDir, stills[f][i])}" style="width:${colW(f)}px;height:${rowH}px">`)
        .join("");
      const sc = spec.scenes[i];
      return `<div class="row"><div class="label"><b>${i + 1}. ${escapeHtml(getScene(s.type).label)}</b><br>${escapeHtml(BEAT_WORDS[sc.beat] ?? sc.beat)}<br>${s.start.toFixed(1)} to ${(s.start + s.duration).toFixed(1)} seconds<br>Picture from ${times[i].toFixed(1)} seconds<br>${escapeHtml(LIMIT_WORDS[s.limitedBy] ?? "")}</div>${cells}</div>`;
    })
    .join("");
  const head = formats.map((f) => `<div style="width:${colW(f)}px">${escapeHtml(getFormat(f).label)}</div>`).join("");
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;background:#FFFFFF;color:#0B0C0C;font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:20px}
.wrap{padding:${gap}px}
h1{font-size:28px;margin:0 0 8px}
.head,.row{display:flex;gap:${gap}px;align-items:flex-start;margin-bottom:${gap}px}
.head{font-weight:700;padding-left:${labelW + gap}px;margin-left:-${gap}px}
.label{width:${labelW - gap}px;line-height:1.4}
img{display:block;border:2px solid #0B0C0C}
</style></head><body><div class="wrap"><h1>${escapeHtml(spec.title)}: contact sheet (${timeline.duration.toFixed(1)} seconds)</h1>
<div class="head">${head}</div>${rows}</div></body></html>`;
  const htmlFile = path.join(reviewDir, "contact-sheet.html");
  fs.writeFileSync(htmlFile, html);
  const sheet = path.join(reviewDir, "contact-sheet.png");
  await screenshotFile(htmlFile, width, height, sheet);
  return { sheet, stills, times };
}
