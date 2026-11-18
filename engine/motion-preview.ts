// Short looping previews of the motion library, made by the same compiler as real videos, so a tile in the app
// shows exactly what a video will do. No voice, no captions. See docs/design/studio-spec.md, section 5.9.
//
// A style or a transition plays a Statement then a Points scene (in the brand's first two usable schemes); an
// entrance, a text effect or a shape motion plays one Statement (a Stat for Count up). The page loops with a
// 0.8 s pause, shows its settled last frame while idle, and answers postMessage({ play }) and ({ pause }).
// Under prefers-reduced-motion it never plays on its own.
import crypto from "node:crypto";
import path from "node:path";
import fs from "node:fs";
import { compileVideo, writePage } from "./compile";
import { computeTimeline } from "./timing";
import type { LoadedBrand } from "./brand";
import type { FormatId } from "./config";
import type { Spec } from "./spec";
import { MOTION_STYLES, ENTRANCE_IDS, TRANSITION_IDS, TEXT_EFFECT_IDS, SHAPE_MOTION_IDS } from "./motion-rules";
import { listIcons } from "./icons";

/** Seconds each preview scene holds. */
const PREVIEW_SCENE = 3.2;

export type MotionPreviewKind = "style" | "entrance" | "transition" | "text" | "shape";

const STATEMENT = { kicker: "From 3 March", text: "Bins are collected every two weeks", icon: { icon: "calendar" }, emphasis: ["every two weeks"] };
const POINTS = { heading: "Three ways to check your day", items: [{ text: "Online" }, { text: "On the app" }, { text: "By phone" }] };
const STAT = { value: "45%", label: "of homes recycle food waste" };

const ALLOWED: Record<MotionPreviewKind, readonly string[]> = {
  style: MOTION_STYLES,
  entrance: ENTRANCE_IDS,
  transition: TRANSITION_IDS,
  text: TEXT_EFFECT_IDS,
  shape: SHAPE_MOTION_IDS,
};

export interface MotionPreviewInput {
  kind: MotionPreviewKind;
  id: string;
  /** Scheme for the first scene. Default: the brand's first usable scheme for the middle of a video. */
  scheme?: string;
  format?: FormatId;
}

/** Write a looping preview page. Returns its folder (under outRoot), file name and length in seconds. Cached by content. */
export function renderMotionPreview(brand: LoadedBrand, input: MotionPreviewInput, outRoot: string): { folder: string; file: string; seconds: number } {
  if (!ALLOWED[input.kind]?.includes(input.id)) throw new Error(`Unknown ${input.kind} "${input.id}".`);
  const usable = brand.usableSchemes();
  if (!usable.length) throw new Error("The brand has no scheme that can be used yet.");
  const middle = usable.filter((s) => s.fit !== "bookends");
  const pool = middle.length ? middle : usable;
  const first = input.scheme && usable.some((s) => s.id === input.scheme) ? input.scheme : pool[0].id;
  // The second scene: a different tone if there is one (so transitions show), else the next scheme.
  const tone = usable.find((s) => s.id === first)!.tone;
  const second = (pool.find((s) => s.id !== first && s.tone !== tone) ?? usable.find((s) => s.id !== first && s.tone !== tone) ?? pool.find((s) => s.id !== first) ?? usable[0]).id;
  const hasIcon = listIcons(brand).some((i) => i.name === "calendar");
  const statement = hasIcon ? STATEMENT : { ...STATEMENT, icon: undefined };
  const one = input.kind === "text" && input.id === "count" ? { type: "stat", slots: STAT } : { type: "statement", slots: statement };
  const pair = input.kind === "style" || input.kind === "transition";
  const scenes: Array<Record<string, unknown>> = pair
    ? [
        { type: "statement", beat: "message", slots: statement, voiceover: ["One."], scheme: first },
        { type: "points", beat: "message", slots: POINTS, voiceover: ["Two."], scheme: second },
      ]
    : [{ ...one, beat: "message", voiceover: ["One."], scheme: first }];
  const motionKey = { entrance: "entrance", transition: "transition", text: "text", shape: "shape" } as const;
  if (input.kind !== "style") {
    const target = input.kind === "transition" ? scenes[1] : scenes[0];
    target.motion = { [motionKey[input.kind]]: input.id };
  }
  const spec = {
    version: 1,
    brand: brand.brand.id,
    title: `Motion preview: ${input.kind} ${input.id}`,
    language: "en-GB",
    facts: { keyMessages: 1, purpose: "inform", channel: "social" },
    ...(input.kind === "style" ? { look: { motionStyle: input.id } } : {}),
    scenes: scenes.map((s) => JSON.parse(JSON.stringify(s))),
  } as unknown as Spec;
  // A short phrase per scene: the scenes last as long as their text needs to be read.
  const phrases = spec.scenes.map(() => [{ text: "One.", file: "", audioSeconds: 1.2, words: [] }]);
  const timeline = computeTimeline(spec, phrases, null, { id: "preview", speed: 1, file: "", sampleRate: 24000 }, { brand });
  // A tile is short: each scene holds 3.2 s (longer only if its motion needs it), not its reading time.
  let start = 0;
  timeline.scenes.forEach((sc, i) => {
    const settle = Math.max(0, ...sc.text.map((t) => t.visibleFrom));
    const next = timeline.scenes[i + 1];
    const cover = next ? (next.transitionSeconds ?? 0) * (next.transitionIn === "sweep" ? 2 : 1) : 0;
    sc.start = Math.round(start * 30) / 30;
    sc.duration = Math.ceil(Math.max(PREVIEW_SCENE, settle + 1.2 + cover) * 30) / 30;
    start = sc.start + sc.duration - (next?.transitionSeconds ?? 0);
  });
  const last = timeline.scenes[timeline.scenes.length - 1];
  timeline.duration = Math.round((last.start + last.duration) * 30) / 30;
  timeline.captions = [];
  const format = input.format ?? "16x9";
  const page = compileVideo(spec, timeline, brand, format, { noCaptions: true, noAudio: true });
  const loop = `<script>(function(){
var tl = window.__timelines && window.__timelines.main; if (!tl) return;
var root = document.getElementById("root"), dur = +root.dataset.duration;
document.querySelectorAll("#root .clip[data-start]").forEach(function(el){
  var a = +el.dataset.start, d = +el.dataset.duration;
  tl.set(el, { visibility: "hidden" }, 0); tl.set(el, { visibility: "visible" }, a); if (a + d < dur - 0.001) tl.set(el, { visibility: "hidden" }, a + d);
});
tl.set({}, {}, dur);
var reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
var idle = function(){ tl.pause(); tl.seek(Math.max(0, dur - 0.05)); };
var playing = false;
var play = function(once){ playing = true; tl.repeat(once ? 0 : -1); tl.repeatDelay(0.8); tl.restart(); tl.play(); };
document.fonts.ready.then(function(){
  idle();
  if (/[?&]autoplay=1/.test(location.search) && !reduced) play(false);
});
window.addEventListener("message", function(e){
  var m = e.data || {};
  if (m.play) play(reduced || m.once === true);
  else if (m.pause) { playing = false; idle(); }
});
})();</script>`;
  const html = page.html.replace("</body>", `${loop}\n</body>`);
  const hash = crypto.createHash("sha1").update(html).digest("hex").slice(0, 12);
  const folder = `${brand.brand.id}-${hash}`;
  const file = `${input.kind}-${input.id}-${format}.html`;
  const dir = path.join(outRoot, folder);
  if (!fs.existsSync(path.join(dir, file))) writePage({ ...page, html }, dir, file);
  pruneOld(outRoot, brand.brand.id, 60);
  return { folder, file, seconds: timeline.duration };
}

function pruneOld(root: string, brandId: string, keep: number) {
  try {
    const dirs = fs
      .readdirSync(root)
      .filter((d) => d.startsWith(`${brandId}-`))
      .map((d) => ({ d, t: fs.statSync(path.join(root, d)).mtimeMs }))
      .sort((a, b) => b.t - a.t)
      .slice(keep);
    for (const o of dirs) fs.rmSync(path.join(root, o.d), { recursive: true, force: true });
  } catch {
    /* best effort */
  }
}
