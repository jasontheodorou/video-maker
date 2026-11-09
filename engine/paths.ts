// Project paths. Works whether tsx runs this file as CommonJS or as an ES module.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function engineDir(): string {
  if (typeof __dirname !== "undefined") return __dirname;
  // ES module fallback. In CommonJS builds import.meta is empty, but __dirname exists first.
  return path.dirname(fileURLToPath(import.meta.url));
}

export const ENGINE_DIR = engineDir();
export const ROOT = process.env.VIDEO_ASSEMBLY_ROOT ?? path.resolve(ENGINE_DIR, "..");
export const CONFIG_FILE = path.join(ROOT, "config", "engine.json");
// Where jobs, brands and caches live. DATA_DIR moves them out of the project folder (for example to a
// mounted disk on a server). When it is not set they stay in the project folder, as before.
export const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : ROOT;
export const BRANDS_DIR = path.join(DATA_DIR, "brands");
export const JOBS_DIR = path.join(DATA_DIR, "jobs");
export const ICONS_DIR = path.join(ENGINE_DIR, "icons");
export const CACHE_DIR = path.join(DATA_DIR, ".cache");

// A new data folder starts with the sample brand (brands/demo from the project folder), so the app and
// `npm run make` work on first start. A brand already there is never overwritten.
if (DATA_DIR !== ROOT) {
  const seed = path.join(ROOT, "brands", "demo");
  const dest = path.join(BRANDS_DIR, "demo");
  if (fs.existsSync(seed) && !fs.existsSync(dest)) {
    fs.mkdirSync(BRANDS_DIR, { recursive: true });
    // Copy to a temporary name first, so a half-copied brand is never seen.
    const tmp = `${dest}.seeding-${process.pid}`;
    fs.cpSync(seed, tmp, { recursive: true });
    try {
      fs.renameSync(tmp, dest);
    } catch {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }
  fs.mkdirSync(JOBS_DIR, { recursive: true });
}
export const HF_BIN = path.join(ROOT, "node_modules", ".bin", "hyperframes");
export const GSAP_FILE = path.join(ROOT, "node_modules", "gsap", "dist", "gsap.min.js");

export function jobPaths(jobDir: string) {
  const dir = path.resolve(jobDir);
  return {
    dir,
    name: path.basename(dir),
    brief: path.join(dir, "brief.md"),
    spec: path.join(dir, "spec.json"),
    decision: path.join(dir, "decision.json"),
    timeline: path.join(dir, "timeline.json"),
    audio: path.join(dir, "audio"),
    review: path.join(dir, "review"),
    out: path.join(dir, "out"),
    build: path.join(dir, "build"),
    status: path.join(dir, "status.json"),
  };
}
export type JobPaths = ReturnType<typeof jobPaths>;
