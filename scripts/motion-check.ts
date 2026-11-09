// Motion check: is every movement in a rendered video smooth?
// Reads the exact animation schedule from the compiled page (build/<format>/index.html), decodes every frame
// of the MP4 at full size in grey, and compares each frame with the one before. It reports:
//   - frozen frames: no change at all in the middle of an entrance or transition (a stutter);
//   - jumps: one frame changes far more than its neighbours during smooth motion (a jerk);
//   - unexpected change: frames that differ by more than 2 levels when nothing is scheduled to move (jitter or
//     flicker). Smaller changes cannot be seen and are listed as faint.
// It also writes a CSV of the per-frame difference for charts, and can save frames around chosen times.
// Run: npx tsx scripts/motion-check.ts jobs/<name> [--formats=16x9,1x1] [--frames=12.5,30] [--lossless]
// --lossless renders a lossless copy of each format first (CRF 0, kept in review/motion/), so compression
// noise in the delivery MP4 is not mistaken for jitter. Use it when judging the page itself.
// Add --reuse to analyse the lossless copies already in review/motion/ without rendering them again.
// Judge smoothness on the lossless copy: the delivery MP4 adds its own small compression changes.
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { openJob } from "../engine/pipeline";
import { loadConfig, getFormat, type FormatId } from "../engine/config";
import { runOk } from "../engine/proc";
import { renderBuild } from "../engine/render";
import { parseArgs, jobArg, main } from "./cli";

type Win = { a: number; b: number; kind: "smooth" | "steady" | "edge"; label: string };

/** Read the E, X, W, D, C and H arrays the compiler writes into the page, plus timed clips. */
function schedule(html: string): Win[] {
  const arr = (name: string): unknown[][] => {
    const m = new RegExp(`var ${name} = (\\[.*?\\]);\\n`).exec(html);
    return m ? (JSON.parse(m[1]) as unknown[][]) : [];
  };
  const w: Win[] = [];
  for (const e of arr("E")) w.push({ a: e[3] as number, b: (e[3] as number) + (e[2] as number), kind: "smooth", label: `entrance ${e[0]}` });
  for (const x of arr("X")) w.push({ a: x[2] as number, b: (x[2] as number) + (x[1] as number), kind: "smooth", label: `crossfade ${x[0]}` });
  for (const x of arr("W")) w.push({ a: x[4] as number, b: (x[4] as number) + (x[3] as number), kind: "smooth", label: `wipe ${x[0]}` });
  for (const d of arr("D")) w.push({ a: d[4] as number, b: (d[4] as number) + (d[3] as number), kind: "steady", label: `photo drift ${d[0]}` });
  for (const c of arr("C")) w.push({ a: c[4] as number, b: (c[4] as number) + (c[3] as number), kind: "edge", label: `caption fade ${c[0]}` });
  for (const h of arr("H")) {
    w.push({ a: h[1] as number, b: (h[1] as number) + (h[3] as number), kind: "edge", label: `word line ${h[0]}` });
    w.push({ a: h[2] as number, b: (h[2] as number) + (h[3] as number), kind: "edge", label: `word line ${h[0]}` });
  }
  // Timed elements switch on and off at their data-start and end. Videos play throughout.
  const re = /<(div|video)[^>]*\bid="([^"]+)"[^>]*\bdata-start="([\d.]+)"[^>]*\bdata-duration="([\d.]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const [, tag, id, s, d] = m;
    const a = Number(s);
    const b = a + Number(d);
    if (tag === "video") w.push({ a, b, kind: "steady", label: `clip ${id}` });
    w.push({ a: a - 0.02, b: a + 0.02, kind: "edge", label: `${id} starts` });
    w.push({ a: b - 0.02, b: b + 0.02, kind: "edge", label: `${id} ends` });
  }
  return w;
}

/** Mean absolute difference between consecutive grey frames, for every frame. */
async function frameDiffs(file: string, width: number, height: number): Promise<{ mean: number[]; changed: number[]; strong: number[] }> {
  const size = width * height;
  const mean: number[] = [];
  // Change beyond 2 levels per pixel. Slow fades between similar colours step by 1 level every few frames
  // in 8-bit video; that is not a jerk, so jumps are judged on this measure.
  const strong: number[] = [];
  const changed: number[] = [];
  let prev: Buffer | null = null;
  let buf: Buffer = Buffer.alloc(0);
  await new Promise<void>((resolve, reject) => {
    const p = spawn("ffmpeg", ["-v", "error", "-i", file, "-map", "0:v:0", "-f", "rawvideo", "-pix_fmt", "gray", "-"]);
    p.stdout.on("data", (chunk: Buffer) => {
      buf = buf.length ? Buffer.concat([buf, chunk]) : Buffer.from(chunk);
      while (buf.length >= size) {
        const frame = Buffer.from(buf.subarray(0, size));
        buf = buf.subarray(size);
        if (prev) {
          let sum = 0;
          let n = 0;
          let big = 0;
          for (let i = 0; i < size; i++) {
            const d = Math.abs(frame[i] - prev[i]);
            sum += d;
            if (d > 2) {
              n++;
              big += d - 2;
            }
          }
          mean.push(sum / size);
          strong.push(big / size);
          changed.push(n / size);
        } else {
          mean.push(0);
          changed.push(0);
          strong.push(0);
        }
        prev = frame;
      }
    });
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`))));
  });
  return { mean, changed, strong };
}

main(async () => {
  const args = parseArgs();
  const ctx = openJob(jobArg(args, "npx tsx scripts/motion-check.ts jobs/<name>"));
  const cfg = loadConfig();
  const fps = cfg.fps;
  const formats = (typeof args.flags.formats === "string" ? (args.flags.formats as string).split(",") : ctx.formats) as FormatId[];
  const report: Record<string, unknown> = {};
  let problems = 0;
  for (const f of formats) {
    const fmt = getFormat(f);
    let file = path.join(ctx.job.out, `${ctx.job.name}-${f}.mp4`);
    if (args.flags.lossless) {
      file = path.join(ctx.job.review, "motion", `lossless-${f}.mp4`);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      if (!(args.flags.reuse && fs.existsSync(file))) await renderBuild(path.join(ctx.job.build, f), file, { fps, quality: cfg.render.finalQuality, workers: cfg.render.workers, extraArgs: ["--crf", "0"] });
    }
    const html = fs.readFileSync(path.join(ctx.job.build, f, "index.html"), "utf8");
    const wins = schedule(html);
    const { mean, changed, strong } = await frameDiffs(file, fmt.width, fmt.height);
    // Frame i shows time i / fps. The change into frame i happens between (i - 1) / fps and i / fps.
    const active = (i: number, kinds: Win["kind"][], pad = 0) => {
      const t0 = (i - 1) / fps - pad;
      const t1 = i / fps + pad;
      return wins.filter((w) => kinds.includes(w.kind) && w.a < t1 && w.b > t0);
    };
    const frozen: string[] = [];
    const jumps: string[] = [];
    const unexpected: string[] = [];
    const faint: string[] = [];
    for (let i = 1; i < mean.length; i++) {
      const t = i / fps;
      const smooth = active(i, ["smooth"]);
      const steady = active(i, ["steady"]);
      const edges = active(i, ["edge"], 1 / fps);
      const clipOn = steady.some((w) => w.label.startsWith("clip"));
      // Inside the body of a smooth movement (not its first or last 3 frames, where the curve is nearly flat).
      const body = smooth.filter((w) => t > w.a + 3 / fps && t < w.b - 3 / fps);
      if (body.length && !clipOn && mean[i] === 0) frozen.push(`${t.toFixed(3)} s (${body.map((w) => w.label).join(", ")})`);
      if (body.length && !edges.length && !clipOn && i > 1 && i + 1 < mean.length) {
        const around = Math.max(strong[i - 1], strong[i + 1]);
        if (strong[i] > 0.05 && strong[i] > 2 * around + 0.02) jumps.push(`${t.toFixed(3)} s: ${strong[i].toFixed(3)} against ${around.toFixed(3)} (${body.map((w) => w.label).join(", ")})`);
      }
      if (!smooth.length && !steady.length && !edges.length && mean[i] > 0) {
        // Changes of 1 or 2 levels on a few pixels cannot be seen; they are listed as faint, not as problems.
        if (changed[i] > 0) unexpected.push(`${t.toFixed(3)} s: mean ${mean[i].toFixed(4)}, ${(changed[i] * 100).toFixed(3)}% of pixels change by more than 2 levels`);
        else faint.push(`${t.toFixed(3)} s`);
      }
    }
    // Steady movements (photo drift, clips) should change every frame by a similar amount.
    const steadyFrozen: string[] = [];
    for (const w of wins.filter((x) => x.kind === "steady")) {
      const i0 = Math.ceil(w.a * fps) + 2;
      const i1 = Math.floor(w.b * fps) - 2;
      let zeros = 0;
      for (let i = i0; i <= i1 && i < mean.length; i++) if (mean[i] === 0) zeros++;
      const frames = i1 - i0 + 1;
      // A 30 fps clip at 60 fps repeats each frame once by design (an even cadence), so allow up to half.
      const allowed = w.label.startsWith("clip") ? Math.ceil(frames / 2) + 1 : 0;
      if (zeros > allowed) steadyFrozen.push(`${w.label}: ${zeros} unchanged frames of ${frames}`);
    }
    const csv = ["frame,time,mean,strong,changed", ...mean.map((m, i) => `${i},${(i / fps).toFixed(4)},${m.toFixed(5)},${strong[i].toFixed(5)},${changed[i].toFixed(6)}`)].join("\n");
    const dir = path.join(ctx.job.review, "motion");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `diff-${f}.csv`), csv + "\n");
    const r = { frames: mean.length, frozen, jumps, unexpected: unexpected.slice(0, 40), unexpectedCount: unexpected.length, faintCount: faint.length, faint: faint.slice(0, 40), steadyFrozen };
    report[f] = r;
    const n = frozen.length + jumps.length + unexpected.length + steadyFrozen.length;
    problems += n;
    console.log(`${f}: ${mean.length} frames. Frozen in motion: ${frozen.length}. Jumps: ${jumps.length}. Unexpected change: ${unexpected.length}. Steady motion frozen: ${steadyFrozen.length}. Faint (1 or 2 levels, not counted): ${faint.length}.`);
    for (const line of [...frozen, ...jumps, ...unexpected.slice(0, 15), ...steadyFrozen].slice(0, 30)) console.log("  " + line);
    if (typeof args.flags.frames === "string") {
      const fd = path.join(dir, `frames-${f}`);
      fs.mkdirSync(fd, { recursive: true });
      for (const t of (args.flags.frames as string).split(",").map(Number)) {
        await runOk("ffmpeg", ["-v", "error", "-y", "-ss", Math.max(0, t - 0.1).toFixed(3), "-i", file, "-frames:v", "13", path.join(fd, `at-${t.toFixed(2)}-%02d.png`)]);
      }
    }
  }
  fs.writeFileSync(path.join(ctx.job.review, "motion", "motion.json"), JSON.stringify(report, null, 2) + "\n");
  if (problems) throw new Error(`Motion check found ${problems} problem(s).`);
});
