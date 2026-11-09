// Verifies a job's rendered MP4s:
//   1. ffprobe: right size, frame rate, frame count, duration and an audio track.
//   2. No duplicate frames while anything is moving (entrances and crossfades), which would read as a stutter.
//   3. Frames extracted at each scene's settled moment and mid-transition, for a person to look at.
//   4. With --determinism: renders 16:9 again and compares every decoded frame with the first render.
// Run: npx tsx scripts/verify.ts jobs/<name> [--determinism]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openJob, loadTimeline } from "../engine/pipeline";
import { probe, renderBuild } from "../engine/render";
import { loadConfig, type FormatId } from "../engine/config";
import { getScene } from "../engine/scenes";
import { ENTRANCES, STAGGER } from "../engine/motion";
import { settledTimes } from "../engine/sheet";
import { sceneTransitionSeconds } from "../engine/transitions";
import { run, runOk } from "../engine/proc";
import { parseArgs, jobArg, main } from "./cli";

async function frameHashes(file: string, from?: number, to?: number): Promise<string[]> {
  const args = ["-v", "error"];
  if (from != null) args.push("-ss", from.toFixed(3));
  args.push("-i", file);
  if (to != null && from != null) args.push("-t", (to - from).toFixed(3));
  args.push("-map", "0:v:0", "-f", "framemd5", "-");
  const r = await runOk("ffmpeg", args);
  return r.stdout.split("\n").filter((l) => l && !l.startsWith("#")).map((l) => l.split(",").pop()!.trim());
}

main(async () => {
  const args = parseArgs();
  const ctx = openJob(jobArg(args, "npx tsx scripts/verify.ts jobs/<name> [--determinism]"));
  const timeline = loadTimeline(ctx);
  const cfg = loadConfig();
  const problems: string[] = [];
  const report: Record<string, unknown> = { job: ctx.job.name, duration: timeline.duration, fps: cfg.fps, formats: {} };

  // Motion windows: every entrance and crossfade, in absolute seconds.
  const windows: Array<[number, number, string]> = [];
  timeline.scenes.forEach((s, i) => {
    const def = getScene(s.type);
    const els = def.elements(ctx.spec.scenes[i].slots as Record<string, unknown>);
    els.forEach((e, k) => {
      const a = s.start + s.enterAt + k * STAGGER;
      windows.push([a, a + ENTRANCES[e.entrance].duration, `${s.id} ${e.id} entrance`]);
    });
    if (s.transitionIn !== "none") windows.push([s.start, s.start + sceneTransitionSeconds(s, timeline.crossfade), `${s.id} ${s.transitionIn}`]);
  });

  for (const f of ctx.formats as FormatId[]) {
    const file = path.join(ctx.job.out, `${ctx.job.name}-${f}.mp4`);
    if (!fs.existsSync(file)) { problems.push(`${f}: ${path.basename(file)} is missing`); continue; }
    const p = await probe(file);
    const fmt = cfg.formats[f];
    const expectFrames = Math.round(timeline.duration * cfg.fps);
    const r: Record<string, unknown> = { ...p };
    if (p.width !== fmt.width || p.height !== fmt.height) problems.push(`${f}: size ${p.width}x${p.height}, expected ${fmt.width}x${fmt.height}`);
    if (p.fps !== `${cfg.fps}/1`) problems.push(`${f}: frame rate ${p.fps}, expected ${cfg.fps}/1`);
    if (p.frames !== expectFrames) problems.push(`${f}: ${p.frames} frames, expected ${expectFrames}`);
    if (!p.audio) problems.push(`${f}: no audio track`);

    // Duplicate frames inside motion windows (trim 1 frame at each edge, where the ease is nearly flat).
    const hashes = await frameHashes(file);
    let dupes = 0;
    const dupeDetail: string[] = [];
    for (const [a, b, label] of windows) {
      const i0 = Math.ceil(a * cfg.fps) + 1;
      const i1 = Math.floor(b * cfg.fps) - 2;
      for (let i = i0 + 1; i <= i1 && i < hashes.length; i++) {
        if (hashes[i] === hashes[i - 1]) { dupes++; if (dupeDetail.length < 5) dupeDetail.push(`${label} at frame ${i}`); }
      }
    }
    r.duplicateFramesInMotion = dupes;
    if (dupes) problems.push(`${f}: ${dupes} duplicate frames during motion (${dupeDetail.join("; ")})`);

    // Frames for a person to look at.
    const dir = path.join(ctx.job.review, "frames", f);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    const times = [...settledTimes(ctx.spec, timeline), ...timeline.scenes.filter((s) => s.transitionIn !== "none").map((s) => s.start + sceneTransitionSeconds(s, timeline.crossfade) / 2)];
    for (const t of times) await runOk("ffmpeg", ["-v", "error", "-y", "-ss", t.toFixed(3), "-i", file, "-frames:v", "1", path.join(dir, `at-${t.toFixed(2)}s.png`)]);
    r.framesDir = path.relative(ctx.job.dir, dir);
    (report.formats as Record<string, unknown>)[f] = r;
  }

  if (args.flags.determinism) {
    const f: FormatId = ctx.formats.includes("16x9") ? "16x9" : ctx.formats[0];
    const first = path.join(ctx.job.out, `${ctx.job.name}-${f}.mp4`);
    const again = path.join(os.tmpdir(), `va-determinism-${ctx.job.name}-${f}.mp4`);
    await renderBuild(path.join(ctx.job.build, f), again, { fps: cfg.fps, quality: cfg.render.finalQuality, workers: cfg.render.workers });
    const [a, b] = await Promise.all([frameHashes(first), frameHashes(again)]);
    const differ = a.reduce((n, h, i) => n + (h !== b[i] ? 1 : 0), 0) + Math.abs(a.length - b.length);
    report.determinism = { format: f, frames: a.length, framesThatDiffer: differ };
    if (differ) problems.push(`Determinism: ${differ} of ${a.length} frames differ between two renders of ${f}`);
    const audioA = (await run("ffmpeg", ["-v", "error", "-i", first, "-map", "0:a:0", "-f", "md5", "-"])).stdout.trim();
    const audioB = (await run("ffmpeg", ["-v", "error", "-i", again, "-map", "0:a:0", "-f", "md5", "-"])).stdout.trim();
    (report.determinism as Record<string, unknown>).audioIdentical = audioA === audioB;
    if (audioA !== audioB) problems.push("Determinism: audio differs between two renders");
    fs.rmSync(again, { force: true });
  }

  report.problems = problems;
  report.ok = problems.length === 0;
  fs.mkdirSync(ctx.job.review, { recursive: true });
  fs.writeFileSync(path.join(ctx.job.review, "verify.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
  if (problems.length) throw new Error(`Verification found ${problems.length} problem(s).`);
});
