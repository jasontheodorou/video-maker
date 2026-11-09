// Day-1 proof: a 5-second MP4 with a Kokoro voice and burned-in captions in 16:9, 9:16 and 1:1,
// using the HyperFrames CLI directly (tts, transcribe, lint, render). It proves the toolchain on this machine,
// separately from the engine. Output: jobs/day1-proof/out/.
// Run: npx tsx scripts/day1-proof.ts
import fs from "node:fs";
import path from "node:path";
import { HF_BIN, JOBS_DIR, GSAP_FILE } from "../engine/paths";
import { runOk } from "../engine/proc";
import { loadBrand, brandCss, fontAssetName } from "../engine/brand";
import { getFormat, FORMAT_IDS } from "../engine/config";
import { probe } from "../engine/render";
import { escapeHtml } from "../engine/text";
import { main } from "./cli";

main(async () => {
  const dir = path.join(JOBS_DIR, "day1-proof");
  const audio = path.join(dir, "audio");
  const out = path.join(dir, "out");
  fs.mkdirSync(audio, { recursive: true });
  fs.mkdirSync(out, { recursive: true });
  const text = "Welcome to Northvale Council. Your new bins arrive in March.";
  const wav = path.join(audio, "voice.wav");
  console.log("1. Kokoro voice (bf_emma)");
  await runOk(HF_BIN, ["tts", text, "-v", "bf_emma", "-o", wav, "--json"]);
  console.log("2. Whisper word timings");
  await runOk(HF_BIN, ["transcribe", wav, "--model", "small.en", "--engine", "whisper", "-d", audio, "--json"]);
  const words = JSON.parse(fs.readFileSync(path.join(audio, "transcript.json"), "utf8")) as Array<{ text: string; start: number; end: number }>;
  // Two caption groups, split at the sentence end.
  const cut = words.findIndex((w) => /\.$/.test(w.text)) + 1;
  const groups = [words.slice(0, cut), words.slice(cut)].filter((g) => g.length);
  const offset = 0.5;
  const brand = loadBrand("demo");
  for (const f of FORMAT_IDS) {
    const format = getFormat(f);
    const build = path.join(dir, "build", f);
    fs.mkdirSync(path.join(build, "assets"), { recursive: true });
    fs.copyFileSync(GSAP_FILE, path.join(build, "assets", "gsap.min.js"));
    fs.copyFileSync(wav, path.join(build, "assets", "voice.wav"));
    for (const face of brand.brand.fonts.faces) {
      const dest = path.join(build, fontAssetName(face.src));
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(brand.file(face.src), dest);
    }
    const caps = groups
      .map((g, i) => {
        const start = offset + g[0].start;
        const end = i + 1 < groups.length ? offset + groups[i + 1][0].start : 5;
        return `<div id="c${i}" class="cap clip" data-start="${start.toFixed(3)}" data-duration="${(end - start).toFixed(3)}"><span>${escapeHtml(g.map((w) => w.text).join(" "))}</span></div>`;
      })
      .join("\n");
    const html = `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=${format.width}, height=${format.height}">
<script src="assets/gsap.min.js"></script>
<style>${brandCss(brand, format)}
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:${format.width}px;height:${format.height}px;overflow:hidden;background:var(--dark-bg)}
#root{position:relative;width:100%;height:100%;font-family:var(--font-heading)}
#title{position:absolute;left:${format.safe.left}px;right:${format.safe.right}px;top:${Math.round(format.height * 0.3)}px;color:var(--dark-text);font-size:var(--t-display);font-weight:var(--weight-heading);line-height:var(--lh-display);opacity:0}
.cap{position:absolute;left:0;right:0;bottom:${format.safe.bottom + 20}px;text-align:center}
.cap span{display:inline-block;max-width:${format.captionMaxWidth}px;background:var(--caption-bg);color:var(--caption-text);font-family:var(--font-body);font-size:var(--t-caption);line-height:1.3;padding:8px 24px;border-radius:var(--radius)}
</style></head><body>
<div id="root" data-composition-id="main" data-start="0" data-duration="5" data-width="${format.width}" data-height="${format.height}">
<h1 id="title">Northvale Council</h1>
<audio id="voice" class="clip" src="assets/voice.wav" data-start="${offset}" data-volume="1"></audio>
${caps}
</div>
<script>
window.__timelines = window.__timelines || {};
var tl = gsap.timeline({ paused: true });
tl.fromTo("#title", { opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: 0.6, ease: "power2.out" }, 0.2);
window.__timelines["main"] = tl;
</script></body></html>`;
    fs.writeFileSync(path.join(build, "index.html"), html);
    console.log(`3. Lint and render ${f}`);
    await runOk(HF_BIN, ["lint", build]);
    const file = path.join(out, `day1-proof-${f}.mp4`);
    await runOk(HF_BIN, ["render", build, "-o", file, "--fps", "60", "--quality", "delivery", "--quiet"]);
    const p = await probe(file);
    console.log(`   ${path.relative(process.cwd(), file)}: ${p.width}x${p.height}, ${p.fps} fps, ${p.duration.toFixed(2)} s, audio ${p.audio ? "yes" : "no"}`);
  }
});
