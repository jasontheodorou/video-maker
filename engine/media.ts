// Photos and video clips. A spec names a file in the brand's media folder:
//   { "src": "park-trail.jpg", "focus": [0.2, 0.7] }
// Files live in brands/<id>/media/. An optional brands/<id>/media/assets.json records, per file,
// the focal point, a description, and where it came from (licence, author, source). The engine reads
// the focal point from the spec first, then assets.json, then uses the centre.
//
// The engine checks every photo and clip before it renders:
//   - the file exists and is a photo (JPEG, PNG, WebP) or a clip (MP4, MOV, WebM, M4V);
//   - it is big enough for the space it fills (a soft, upscaled photo is a warning, a very small one an error);
//   - a clip is long enough for its scene;
//   - a clip's frame rate fits the video's frame rate. Clips at 24, 25 or 50 frames a second would judder
//     at 60, so the engine makes a conformed copy (each frame shown for an equal time) in .cache/media.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { z } from "zod";
import { CACHE_DIR } from "./paths";
import type { LoadedBrand } from "./brand";

export const MEDIA_DIR = "media";
export const PHOTO_EXT = [".jpg", ".jpeg", ".png", ".webp"];
export const CLIP_EXT = [".mp4", ".mov", ".m4v", ".webm"];

const MEDIA_SRC = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .regex(/^[A-Za-z0-9][A-Za-z0-9 ._\-/]*$/, "Use a file name from the brand's media folder, such as park-trail.jpg")
  .refine((p) => !p.split("/").includes(".."), "Use a file inside the brand's media folder");

const Focus = z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]);

/** How a spec names a photo: a file in brands/<id>/media/ and an optional focal point (0 to 1, from the top left). */
export const PhotoRef = z
  .object({
    src: MEDIA_SRC.refine((p) => PHOTO_EXT.includes(path.extname(p).toLowerCase()), "Use a JPEG, PNG or WebP photo"),
    focus: Focus.optional(),
  })
  .strict();
export type PhotoRef = z.infer<typeof PhotoRef>;

/** How a spec names a video clip: a file in brands/<id>/media/, where to start in it (seconds) and an optional focal point. */
export const ClipRef = z
  .object({
    src: MEDIA_SRC.refine((p) => CLIP_EXT.includes(path.extname(p).toLowerCase()), "Use an MP4, MOV or WebM clip"),
    start: z.number().min(0).max(3600).optional(),
    focus: Focus.optional(),
  })
  .strict();
export type ClipRef = z.infer<typeof ClipRef>;

/** One entry in brands/<id>/media/assets.json. */
export const MediaInfo = z
  .object({
    description: z.string().max(300).optional(),
    focus: Focus.optional(),
    licence: z.string().max(120).optional(),
    author: z.string().max(120).optional(),
    source: z.string().max(400).optional(),
    consent: z.string().max(300).optional(),
  })
  .passthrough();
export type MediaInfo = z.infer<typeof MediaInfo>;

export interface ResolvedMedia {
  kind: "photo" | "clip";
  /** Absolute path of the file to use (a conformed copy for some clips). */
  file: string;
  /** Path inside the build folder. */
  asset: string;
  width: number;
  height: number;
  focus: [number, number];
  /** Clips only. */
  fps?: number;
  /** Clips only: seconds of usable footage after the start point (after conforming). */
  seconds?: number;
  /** Clips only: start point in the file the engine uses (after conforming). */
  start?: number;
  /** Clips only: a still frame at the start point, for previews and checks. */
  poster?: string;
  posterAsset?: string;
  info?: MediaInfo;
  notes: string[];
}

export class MediaError extends Error {}

function mediaRoot(brand: LoadedBrand): string {
  return path.join(brand.dir, MEDIA_DIR);
}

const manifestCache = new Map<string, { mtime: number; data: Record<string, MediaInfo> }>();

/** The brand's media manifest (assets.json), or an empty one. */
export function mediaManifest(brand: LoadedBrand): Record<string, MediaInfo> {
  const file = path.join(mediaRoot(brand), "assets.json");
  if (!fs.existsSync(file)) return {};
  const mtime = fs.statSync(file).mtimeMs;
  const hit = manifestCache.get(file);
  if (hit && hit.mtime === mtime) return hit.data;
  let data: Record<string, MediaInfo> = {};
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    const files = (raw && typeof raw === "object" && raw.files) || {};
    for (const [k, v] of Object.entries(files)) {
      const p = MediaInfo.safeParse(v);
      if (p.success) data[k] = p.data;
    }
  } catch {
    data = {};
  }
  manifestCache.set(file, { mtime, data });
  return data;
}

/** Every photo and clip a brand has, for the web app and the brief interpreter. */
export function listMedia(brand: LoadedBrand): Array<{ src: string; kind: "photo" | "clip"; info?: MediaInfo }> {
  const root = mediaRoot(brand);
  if (!fs.existsSync(root)) return [];
  const manifest = mediaManifest(brand);
  const out: Array<{ src: string; kind: "photo" | "clip"; info?: MediaInfo }> = [];
  const walk = (dir: string, rel: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith(".")) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(dir, e.name), r);
      else {
        const ext = path.extname(e.name).toLowerCase();
        if (PHOTO_EXT.includes(ext)) out.push({ src: r, kind: "photo", info: manifest[r] });
        else if (CLIP_EXT.includes(ext)) out.push({ src: r, kind: "clip", info: manifest[r] });
      }
    }
  };
  walk(root, "");
  return out.sort((a, b) => a.src.localeCompare(b.src));
}

// ---------- probing (ffprobe, cached by path, size and time) ----------

interface Probe {
  width: number;
  height: number;
  fps?: number;
  seconds?: number;
  rotation?: number;
}
const probeCache = new Map<string, Probe>();

function probeFile(file: string): Probe {
  const st = fs.statSync(file);
  const key = `${file}:${st.size}:${st.mtimeMs}`;
  const hit = probeCache.get(key);
  if (hit) return hit;
  let out: string;
  try {
    out = execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,r_frame_rate,avg_frame_rate,duration:stream_side_data=rotation:format=duration", "-of", "json", file], { encoding: "utf8" });
  } catch (e) {
    throw new MediaError(`Could not read ${path.basename(file)}. It may be damaged or in a format the engine cannot use.`);
  }
  const j = JSON.parse(out) as { streams?: Array<Record<string, unknown>>; format?: { duration?: string } };
  const s = j.streams?.[0];
  if (!s) throw new MediaError(`${path.basename(file)} has no picture in it.`);
  const rate = (v: unknown) => {
    const m = /^(\d+)\/(\d+)$/.exec(String(v ?? ""));
    return m && Number(m[2]) ? Number(m[1]) / Number(m[2]) : undefined;
  };
  const sideData = (s.side_data_list as Array<{ rotation?: number }> | undefined) ?? [];
  const rotation = Math.abs(sideData.find((d) => d.rotation != null)?.rotation ?? 0);
  let width = Number(s.width);
  let height = Number(s.height);
  if (rotation === 90 || rotation === 270) [width, height] = [height, width];
  const p: Probe = {
    width,
    height,
    fps: rate(s.avg_frame_rate) ?? rate(s.r_frame_rate),
    seconds: Number(s.duration ?? j.format?.duration ?? NaN),
    rotation,
  };
  probeCache.set(key, p);
  return p;
}

function hashFile(file: string): string {
  const st = fs.statSync(file);
  return crypto.createHash("sha1").update(`${path.resolve(file)}:${st.size}:${st.mtimeMs}`).digest("hex").slice(0, 16);
}

/** Frame rates that divide evenly into the video's frame rate show every frame for the same time. */
export function cadenceOk(fps: number, videoFps: number): boolean {
  const ratio = videoFps / fps;
  return Math.abs(ratio - Math.round(ratio)) < 0.01 && Math.round(ratio) >= 1;
}

/** The frame rate a clip is conformed to: the nearest even divisor of the video's frame rate. */
export function conformTarget(fps: number, videoFps: number): number {
  const options = [videoFps, videoFps / 2].filter((f) => Number.isInteger(f));
  return options.reduce((best, f) => (Math.abs(f - fps) < Math.abs(best - fps) ? f : best), options[0]);
}

/**
 * A copy of the clip with a frame rate that divides evenly into the video's, made once and cached.
 * Footage is retimed (each source frame kept, played slightly faster or slower), never blended,
 * so there are no smeared in-between frames. A 25 fps clip becomes 30 fps and plays 20% faster.
 */
function conformClip(file: string, fps: number, videoFps: number): { file: string; fps: number; factor: number } {
  const target = conformTarget(fps, videoFps);
  const factor = fps / target; // new duration = old duration * factor
  const dir = path.join(CACHE_DIR, "media");
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, `${hashFile(file)}-${target}fps.mp4`);
  if (!fs.existsSync(out)) {
    const tmp = out + ".part.mp4";
    execFileSync(
      "ffmpeg",
      ["-v", "error", "-y", "-i", file, "-an", "-vf", `setpts=PTS*${fps}/${target},fps=${target},format=yuv420p`, "-r", String(target), "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-g", String(target), "-movflags", "+faststart", "-map_metadata", "-1", tmp],
      { stdio: "ignore" },
    );
    fs.renameSync(tmp, out);
  }
  return { file: out, fps: target, factor };
}

function posterFrame(file: string, at: number): string {
  const dir = path.join(CACHE_DIR, "media");
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, `${hashFile(file)}-poster-${Math.round(at * 1000)}.jpg`);
  if (!fs.existsSync(out)) {
    execFileSync("ffmpeg", ["-v", "error", "-y", "-ss", at.toFixed(3), "-i", file, "-frames:v", "1", "-q:v", "2", out], { stdio: "ignore" });
  }
  return out;
}

function assetName(src: string, suffix = ""): string {
  const ext = path.extname(src);
  const base = src.slice(0, src.length - ext.length).replace(/[^A-Za-z0-9._-]+/g, "_");
  return `assets/media/${base}${suffix}${ext}`;
}

/** Find and check a photo. Throws MediaError with a plain-English message. */
export function resolvePhoto(ref: PhotoRef, brand: LoadedBrand): ResolvedMedia {
  const file = path.join(mediaRoot(brand), ref.src);
  if (!fs.existsSync(file)) throw new MediaError(`The photo ${ref.src} is not in the ${brand.brand.name} media folder (brands/${brand.brand.id}/media).`);
  const p = probeFile(file);
  const info = mediaManifest(brand)[ref.src];
  return {
    kind: "photo",
    file,
    asset: assetName(ref.src),
    width: p.width,
    height: p.height,
    focus: ref.focus ?? (info?.focus as [number, number] | undefined) ?? [0.5, 0.5],
    info,
    notes: [],
  };
}

/**
 * A copy of a photo resized (Lanczos, high quality) so that it covers a frame of the given size at the
 * given extra scale, made once and cached in .cache/media. Chrome then draws the photo at almost exactly
 * its own size instead of shrinking it on the GPU, which is sharper and gives the same pixels every render.
 * Returns the photo unchanged when it is already small enough.
 */
export function displayPhoto(m: ResolvedMedia, frameW: number, frameH: number, extraScale: number): ResolvedMedia {
  const s = Math.max(frameW / m.width, frameH / m.height) * extraScale;
  if (s >= 0.95) return m;
  const w = Math.ceil((m.width * s) / 2) * 2;
  const h = Math.ceil((m.height * s) / 2) * 2;
  const dir = path.join(CACHE_DIR, "media");
  fs.mkdirSync(dir, { recursive: true });
  const ext = path.extname(m.file).toLowerCase() === ".png" ? ".png" : ".jpg";
  const out = path.join(dir, `${hashFile(m.file)}-${w}x${h}${ext}`);
  if (!fs.existsSync(out)) {
    const tmp = out.replace(/(\.[a-z]+)$/, ".part$1");
    execFileSync("ffmpeg", ["-v", "error", "-y", "-i", m.file, "-vf", `scale=${w}:${h}:flags=lanczos`, ...(ext === ".jpg" ? ["-q:v", "2"] : []), "-map_metadata", "-1", tmp], { stdio: "ignore" });
    fs.renameSync(tmp, out);
  }
  return { ...m, file: out, asset: m.asset.replace(/(\.[^.]+)$/, `-${w}x${h}${ext}`), width: w, height: h };
}

/** Find and check a clip, conforming its frame rate when needed. Throws MediaError with a plain-English message. */
export function resolveClip(ref: ClipRef, brand: LoadedBrand, videoFps: number): ResolvedMedia {
  const original = path.join(mediaRoot(brand), ref.src);
  if (!fs.existsSync(original)) throw new MediaError(`The clip ${ref.src} is not in the ${brand.brand.name} media folder (brands/${brand.brand.id}/media).`);
  const p = probeFile(original);
  if (!p.fps || !Number.isFinite(p.seconds)) throw new MediaError(`Could not read the frame rate or length of ${ref.src}.`);
  const info = mediaManifest(brand)[ref.src];
  const notes: string[] = [];
  let file = original;
  let fps = p.fps;
  let factor = 1;
  if (!cadenceOk(p.fps, videoFps)) {
    const c = conformClip(original, p.fps, videoFps);
    file = c.file;
    fps = c.fps;
    factor = c.factor;
    notes.push(`${ref.src} is ${p.fps.toFixed(2).replace(/\.00$/, "")} frames a second. The engine plays it at ${c.fps}, so motion stays even. It runs ${Math.round(Math.abs(1 - factor) * 100)}% ${factor < 1 ? "faster" : "slower"}.`);
  }
  const start = (ref.start ?? 0) * factor;
  const seconds = (p.seconds as number) * factor - start;
  if (seconds <= 0) throw new MediaError(`${ref.src} is ${(p.seconds as number).toFixed(1)} seconds long, so it cannot start at ${ref.start} seconds.`);
  const poster = posterFrame(file, start + 0.05);
  return {
    kind: "clip",
    file,
    asset: file === original ? assetName(ref.src) : assetName(ref.src, `-${fps}fps`).replace(/\.[^.]+$/, ".mp4"),
    width: p.width,
    height: p.height,
    focus: ref.focus ?? (info?.focus as [number, number] | undefined) ?? [0.5, 0.5],
    fps,
    seconds,
    start,
    poster,
    posterAsset: assetName(ref.src, "-poster").replace(/\.[^.]+$/, ".jpg"),
    info,
    notes,
  };
}

/**
 * Where to place media that fills a box (object-fit: cover), with the focal point as near the middle
 * as the crop allows. Returns the CSS for object-position, and how much the media is enlarged
 * (above 1 means it is shown bigger than its real pixels). extraScale allows for the photo drift.
 */
/**
 * Crop media to cover a box. The focal point goes to `aim` in the box (default the middle), as near as the
 * crop allows. `focusAt` says where the focal point really ends up (0 to 1 across the box).
 */
export function coverPlacement(m: { width: number; height: number; focus: [number, number] }, boxW: number, boxH: number, extraScale = 1, aim: [number, number] = [0.5, 0.5]) {
  const s = Math.max(boxW / m.width, boxH / m.height);
  const dw = m.width * s;
  const dh = m.height * s;
  const ox = Math.min(0, Math.max(boxW - dw, boxW * aim[0] - m.focus[0] * dw));
  const oy = Math.min(0, Math.max(boxH - dh, boxH * aim[1] - m.focus[1] * dh));
  return {
    css: `object-fit:cover;object-position:${Math.round(ox)}px ${Math.round(oy)}px;transform-origin:50% 50%`,
    enlargement: s * extraScale,
    focusAt: [(ox + m.focus[0] * dw) / boxW, (oy + m.focus[1] * dh) / boxH] as [number, number],
  };
}

/** The enlargement above which a photo looks soft (a warning) or clearly blurred (an error). */
export const ENLARGE_WARN = 1.15;
export const ENLARGE_FAIL = 1.6;
