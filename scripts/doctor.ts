// Checks everything the engine needs: Node, FFmpeg, Chrome, HyperFrames version, Kokoro, whisper, Python, brands.
// Run: npm run doctor        Add --fix to download the voice and whisper models if they are missing.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { run } from "../engine/proc";
import { ROOT, HF_BIN, DATA_DIR } from "../engine/paths";
import { interpreterSettings } from "../engine/interpret/settings";
import { findChrome } from "../engine/browser";
import { loadConfig } from "../engine/config";
import { listBrands } from "../engine/brand";
import { ensureKokoro } from "../engine/voice";
import { parseArgs, main } from "./cli";

type Row = { name: string; ok: boolean; detail: string; fix?: string; warn?: boolean };

main(async () => {
  const args = parseArgs();
  const rows: Row[] = [];
  const check = async (name: string, fn: () => Promise<Omit<Row, "name">>) => {
    try {
      rows.push({ name, ...(await fn()) });
    } catch (e) {
      rows.push({ name, ok: false, detail: (e as Error).message.split("\n")[0] });
    }
  };

  await check("Node.js", async () => {
    const major = Number(process.versions.node.split(".")[0]);
    return { ok: major >= 18, detail: process.version, fix: "Install Node 18 or later" };
  });
  await check("HyperFrames", async () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "node_modules", "hyperframes", "package.json"), "utf8"));
    const want = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).dependencies.hyperframes;
    return { ok: pkg.version === want, detail: `${pkg.version} (pinned ${want})`, fix: "Run npm install. Never upgrade by accident." };
  });
  for (const tool of ["ffmpeg", "ffprobe"]) {
    await check(tool, async () => {
      const r = await run(tool, ["-version"]);
      return { ok: r.code === 0, detail: r.stdout.split("\n")[0], fix: "brew install ffmpeg" };
    });
  }
  await check("Chrome", async () => ({ ok: true, detail: findChrome(), fix: "npx hyperframes browser ensure" }));
  await check("Python and Kokoro", async () => {
    const r = await run("python3", ["-c", "import kokoro_onnx, soundfile; print(kokoro_onnx.__name__)"]);
    return { ok: r.code === 0, detail: r.code === 0 ? "kokoro-onnx and soundfile import" : r.stderr.trim().split("\n").pop() ?? "", fix: "pip3 install kokoro-onnx soundfile" };
  });
  await check("Kokoro model", async () => {
    const f = path.join(os.homedir(), ".cache", "hyperframes", "tts", "models", "kokoro-v1.0.onnx");
    if (!fs.existsSync(f) && args.flags.fix) await ensureKokoro();
    return { ok: fs.existsSync(f), detail: fs.existsSync(f) ? f : "not downloaded yet", fix: "npm run doctor -- --fix (downloads about 330 MB)" };
  });
  await check("whisper-cpp", async () => {
    const r = await run("which", ["whisper-cli"]);
    return { ok: r.code === 0, detail: r.stdout.trim() || "not found", fix: "brew install whisper-cpp" };
  });
  await check("Whisper model", async () => {
    const f = path.join(os.homedir(), ".cache", "hyperframes", "whisper", "models", "ggml-small.en.bin");
    if (!fs.existsSync(f) && args.flags.fix) {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "va-doctor-"));
      await run(HF_BIN, ["tts", "Testing.", "-o", path.join(tmp, "t.wav")]);
      await run(HF_BIN, ["transcribe", path.join(tmp, "t.wav"), "--model", "small.en", "--engine", "whisper", "-d", tmp]);
    }
    return { ok: fs.existsSync(f), detail: fs.existsSync(f) ? f : "not downloaded yet", fix: "npm run doctor -- --fix (downloads about 480 MB)" };
  });
  await check("Engine config", async () => {
    const c = loadConfig();
    return { ok: true, detail: `${c.fps} fps, short ${c.sizes.short.minSeconds}-${c.sizes.short.maxSeconds} s, medium ${c.sizes.medium.minSeconds}-${c.sizes.medium.maxSeconds} s, long ${c.sizes.long.minSeconds}-${c.sizes.long.maxSeconds} s` };
  });
  await check("Data folder", async () => {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.accessSync(DATA_DIR, fs.constants.W_OK);
    return { ok: true, detail: DATA_DIR === ROOT ? `${DATA_DIR} (the project folder)` : `${DATA_DIR} (DATA_DIR)` };
  });
  await check("Brief interpreter", async () => {
    const s = interpreterSettings();
    if (s.backend === "sdk") {
      const key = !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
      return { ok: true, warn: !key, detail: key ? `Anthropic API, ${s.model}` : `Anthropic API, ${s.model}, but ANTHROPIC_API_KEY is not set: briefs cannot be read until it is` };
    }
    const r = await run(s.claudePath, ["--version"]).catch(() => ({ code: 1, stdout: "" }));
    return { ok: true, warn: r.code !== 0, detail: r.code === 0 ? `Claude Code CLI ${r.stdout.trim()}, ${s.model}` : `Claude Code CLI not found at ${s.claudePath}: briefs cannot be read. Set ANTHROPIC_API_KEY to use the API instead` };
  });
  for (const b of listBrands()) {
    rows.push({ name: `Brand ${b.id}`, ok: b.ok, detail: b.ok ? `${b.name}${b.provisional.length ? `, provisional: ${b.provisional.join(", ")}` : ""}` : b.errors.join("; ") });
  }

  const w = Math.max(...rows.map((r) => r.name.length));
  for (const r of rows) console.log(`${!r.ok ? "FAIL" : r.warn ? "WARN" : "OK  "}  ${r.name.padEnd(w)}  ${r.detail}${!r.ok && r.fix ? `\n      ${"".padEnd(w)}  Fix: ${r.fix}` : ""}`);
  const failed = rows.filter((r) => !r.ok).length;
  if (failed) throw new Error(`${failed} check(s) failed.`);
  console.log("\nEverything the engine needs is in place.");
});
