// The local web app: npm run app, then open http://localhost:3006
// A small Node server with no framework. It serves the built pages in ui/dist (the classic pages in web/ at
// /classic), a JSON API, job files and brand files.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { ROOT, CACHE_DIR, DATA_DIR } from "../engine/paths";
import { KOKORO_VOICES, sceneCatalogue, loadConfig, FORMAT_IDS, checkContrast, suggestPassingColour, listIcons, loadBrand, specJsonSchema, type FormatId } from "../engine";
import { synthesise, voiceLang } from "../engine/voice";
import { interpreterSettings } from "../engine/interpret";
import { HttpError, sendJson, readJson, sendFile, safeJoin, readMultipart } from "./http";
import { JobQueue, jobView, jobDir, STAGES } from "./jobs";
import * as brands from "./brands";
import { proposeSurfaces } from "../engine/brand/index";
import { readGuidelines } from "./guidelines";
import { handleAuth, AUTH_ENABLED } from "./auth";

const PORT = Number(process.env.PORT || 3006);
const HOST = process.env.HOST || "127.0.0.1";
const WEB = path.join(ROOT, "web");
const UI = path.join(ROOT, "ui", "dist");

const queue = new JobQueue();

type Handler = (req: http.IncomingMessage, res: http.ServerResponse, params: string[], url: URL) => Promise<void> | void;
const routes: Array<{ method: string; re: RegExp; fn: Handler }> = [];
const route = (method: string, pattern: string, fn: Handler) => {
  const re = new RegExp("^" + pattern.replace(/:[a-z]+/gi, "([^/]+)").replace(/\*$/, "(.*)") + "$");
  routes.push({ method, re, fn });
};

// ---------- pages ----------

// The pages are built from ui/ (React and Mantine) into ui/dist by `npm run app:build`. The first version
// of the pages (plain HTML in web/) stays at /classic for comparison. Until a build exists, / and /brands
// fall back to it.
const page = (name: "index" | "brands"): string => {
  const built = path.join(UI, `${name}.html`);
  if (fs.existsSync(built)) return built;
  if (!warnedNoBuild) {
    warnedNoBuild = true;
    console.warn("The new pages have not been built yet. Run npm run app:build. Showing the classic pages for now.");
  }
  return path.join(WEB, `${name}.html`);
};
let warnedNoBuild = false;
route("GET", "/", (req, res) => sendFile(req, res, page("index")));
route("GET", "/brands", (req, res) => sendFile(req, res, page("brands")));
route("GET", "/assets/*", (req, res, [rel]) => sendFile(req, res, safeJoin(path.join(UI, "assets"), rel), { cache: "public, max-age=31536000, immutable" }));
route("GET", "/classic", (req, res) => sendFile(req, res, path.join(WEB, "index.html")));
route("GET", "/classic/brands", (req, res) => sendFile(req, res, path.join(WEB, "brands.html")));
route("GET", "/static/*", (req, res, [rel]) => sendFile(req, res, safeJoin(WEB, rel)));
route("GET", "/favicon.ico", (_req, res) => {
  res.writeHead(204);
  res.end();
});

// ---------- general ----------

/** Required slots for each scene type, read from the spec's JSON Schema. */
function requiredSlots(): Record<string, string[]> {
  const schema = specJsonSchema() as { properties?: { scenes?: { items?: { oneOf?: Array<{ properties?: { type?: { const?: string }; slots?: { required?: string[] } } }> } } } };
  const out: Record<string, string[]> = {};
  for (const v of schema.properties?.scenes?.items?.oneOf ?? []) {
    const t = v.properties?.type?.const;
    if (t) out[t] = v.properties?.slots?.required ?? [];
  }
  return out;
}

route("GET", "/api/meta", (_req, res) => {
  const cfg = loadConfig();
  const s = interpreterSettings();
  sendJson(res, 200, {
    voices: KOKORO_VOICES,
    formats: FORMAT_IDS.map((f) => ({ id: f, label: cfg.formats[f].label, width: cfg.formats[f].width, height: cfg.formats[f].height })),
    sizes: cfg.sizes,
    scenes: sceneCatalogue().map((sc) => ({ ...sc, required: requiredSlots()[sc.type] ?? [] })),
    stages: STAGES,
    interpreter: { backend: s.backend, model: s.model },
  });
});

route("POST", "/api/contrast", async (req, res) => {
  const b = await readJson<{ foreground?: string; background?: string }>(req);
  const hex = /^#[0-9A-Fa-f]{6}$/;
  if (!hex.test(b.foreground ?? "") || !hex.test(b.background ?? "")) throw new HttpError(400, "Use six-digit hex colours such as #0B3B60.");
  sendJson(res, 200, { result: checkContrast(b.foreground!, b.background!), suggestion: suggestPassingColour(b.foreground!, b.background!) });
});

const SAMPLE_LINE = "Garden waste collections are changing. From 3 March, we will collect your brown bin every two weeks.";
route("POST", "/api/voice-sample", async (req, res) => {
  const b = await readJson<{ voice?: string; speed?: number; text?: string }>(req);
  const voice = KOKORO_VOICES.find((v) => v.id === b.voice);
  if (!voice) throw new HttpError(400, "Choose a voice.");
  const speed = Math.min(1.2, Math.max(0.8, Number(b.speed) || 1));
  const text = (b.text || SAMPLE_LINE).slice(0, 220);
  const [a] = await synthesise([{ text, voice: voice.id, speed, lang: voiceLang(voice.id) }]);
  sendJson(res, 200, { url: `/voice-cache/${path.basename(a.file)}`, seconds: a.seconds });
});
route("GET", "/voice-cache/*", (req, res, [rel]) => sendFile(req, res, safeJoin(path.join(CACHE_DIR, "voice"), rel)));

// ---------- jobs ----------

route("GET", "/api/jobs", (_req, res) => {
  sendJson(
    res,
    200,
    queue.list().map((j) => ({ id: j.id, title: j.title, brand: j.brand, state: j.state, createdAt: j.createdAt, progress: j.progress, message: j.message, fromApp: j.fromApp })),
  );
});

route("POST", "/api/jobs", async (req, res) => {
  const { fields, files } = await readMultipart(req, { maxFileBytes: 500_000_000, maxFiles: 12 });
  const one = (k: string) => (fields[k]?.[0] ?? "").trim();
  const formats = (fields.formats ?? []).flatMap((f) => f.split(",")).map((f) => f.trim()) as FormatId[];
  const descriptions = fields.mediaDescription ?? [];
  const media = files
    .filter((f) => f.field === "media")
    .map((f, i) => {
      if (!/\.(jpe?g|png|webp|mp4|mov|m4v|webm)$/i.test(f.name)) throw new HttpError(400, `${f.name} is not a photo or clip. Use JPEG, PNG, WebP, MP4, MOV or WebM.`);
      if (!/\.(mp4|mov|m4v|webm)$/i.test(f.name) && f.data.length > 30_000_000) throw new HttpError(413, `${f.name} is larger than 30 MB. Use a smaller photo.`);
      return { name: f.name, data: f.data, description: descriptions[i] };
    });
  const rec = queue.create({ brief: one("brief"), brand: one("brand") || "demo", voice: one("voice") || undefined, formats: formats.length ? formats : [...FORMAT_IDS], media });
  sendJson(res, 201, jobView(queue, rec.id));
});

route("GET", "/api/jobs/:id", (_req, res, [id]) => sendJson(res, 200, jobView(queue, id)));

route("PUT", "/api/jobs/:id/spec", async (req, res, [id]) => {
  const b = await readJson<{ spec?: unknown }>(req);
  await queue.rerender(id, b.spec);
  sendJson(res, 200, jobView(queue, id));
});

route("POST", "/api/jobs/:id/stop", (_req, res, [id]) => {
  queue.stop(id);
  sendJson(res, 200, jobView(queue, id));
});

route("POST", "/api/jobs/:id/retry", (_req, res, [id]) => {
  queue.retry(id);
  sendJson(res, 200, jobView(queue, id));
});

// Delete a video that has finished, failed or been stopped. A video being made is refused (409).
route("DELETE", "/api/jobs/:id", (_req, res, [id]) => {
  queue.remove(id);
  sendJson(res, 200, { deleted: id });
});

// Only finished videos, subtitles and the contact sheet are served from a job folder.
route("GET", "/job-files/:id/*", (req, res, [id, rel], url) => {
  const dir = jobDir(id);
  const clean = path.posix.normalize(decodeURIComponent(rel));
  // Videos, subtitles, the contact sheet and its stills (used as video posters).
  if (!/^(out\/[^/]+\.(mp4|srt|vtt)|review\/contact-sheet\.png|review\/stills\/(16x9|9x16|1x1)\/[a-z0-9-]+\.png)$/.test(clean)) throw new HttpError(404, "File not found.");
  // Captions for the video player (a <track>), made from the subtitle file when asked for.
  if (clean.endsWith(".vtt")) {
    const srtFile = safeJoin(dir, clean.replace(/\.vtt$/, ".srt"));
    if (!fs.existsSync(srtFile)) throw new HttpError(404, "File not found.");
    const vtt = srtToVtt(fs.readFileSync(srtFile, "utf8"));
    res.writeHead(200, { "Content-Type": "text/vtt; charset=utf-8", "Cache-Control": "no-cache", "Content-Length": Buffer.byteLength(vtt) });
    res.end(req.method === "HEAD" ? undefined : vtt);
    return;
  }
  const file = safeJoin(dir, clean);
  // Downloads are named after the video's title, such as library-opens-on-sundays-16x9.mp4.
  let download: string | undefined;
  if (url.searchParams.has("download")) {
    const title = queue.get(id).title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || id;
    const m = path.basename(file).match(/-(16x9|9x16|1x1)\.mp4$/);
    download = m ? `${title}-${m[1]}.mp4` : path.extname(file) === ".srt" ? `${title}.srt` : path.basename(file);
  }
  sendFile(req, res, file, { download });
});

/** WebVTT from SubRip: a header, and a full stop in place of the comma in each time. */
function srtToVtt(srt: string): string {
  const body = srt
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2")
    .trim();
  return `WEBVTT\n\n${body}\n`;
}

// ---------- brands ----------

route("GET", "/api/brands", (_req, res) => sendJson(res, 200, brands.brandSummaries()));

route("POST", "/api/brands", async (req, res) => {
  const b = await readJson<{ name?: string; from?: string; id?: string; duplicate?: boolean; colours?: Array<{ value: string; name?: string; role?: string }> }>(req);
  if (b.duplicate) return sendJson(res, 201, brands.duplicateBrand(b.from ?? "", b.name ?? ""));
  sendJson(res, 201, brands.createBrand(b));
});

route("GET", "/api/brands/:id", (_req, res, [id]) => sendJson(res, 200, brands.brandDetail(id)));

route("PUT", "/api/brands/:id", async (req, res, [id]) => {
  const b = await readJson<{ brand?: unknown }>(req);
  sendJson(res, 200, brands.saveBrandDraft(id, b.brand));
});

route("DELETE", "/api/brands/:id", async (req, res, [id]) => {
  const b = await readJson<{ confirm?: string }>(req);
  if (b.confirm !== id) throw new HttpError(400, "Confirm which brand to delete.");
  brands.deleteBrand(id, (x) => queue.brandBusy(x));
  sendJson(res, 200, { deleted: id });
});

route("POST", "/api/brands/:id/check", async (req, res, [id]) => {
  const b = await readJson<{ brand?: unknown }>(req);
  sendJson(res, 200, brands.checkDraft(id, b.brand));
});

route("POST", "/api/brands/:id/preview", async (req, res, [id]) => {
  const b = await readJson<{ brand?: unknown; caption?: string }>(req);
  sendJson(res, 200, await brands.previewDraft(id, b.brand, { caption: b.caption }));
});

// Upload a font, logo, icon, graphic or guidelines document. The file is saved and brand.json updated at once.
route("POST", "/api/brands/:id/files/:kind", async (req, res, [id, kind]) => {
  if (!["font", "logo", "icon", "graphic", "document"].includes(kind)) throw new HttpError(404, "Unknown upload type.");
  const { fields, files } = await readMultipart(req, { maxFileBytes: 25_000_000, maxFiles: 20 });
  if (!files.length) throw new HttpError(400, "Choose a file to upload.");
  const one = (k: string) => fields[k]?.[0]?.trim() || undefined;
  const weights = (fields.weights ?? []).flatMap((w) => w.split(",")).map(Number).filter((w) => w >= 100 && w <= 900);
  const results: Array<{ name: string; file?: string; warnings: string[]; error?: string }> = [];
  let last: ReturnType<typeof brands.addFile> | null = null;
  for (const f of files) {
    try {
      last = brands.addFile(id, kind as brands.UploadKind, f.name, f.data, {
        logoFor: (one("logoFor") as "onLight" | "onDark" | "both" | undefined) ?? undefined,
        iconName: files.length === 1 ? one("iconName") : undefined,
        iconWeight: one("iconWeight") as never,
        useForRoles: one("useForRoles") ? one("useForRoles") === "yes" : undefined,
        weights: weights.length ? weights : undefined,
      });
      results.push({ name: f.name, file: last.file, warnings: last.warnings });
    } catch (e) {
      results.push({ name: f.name, warnings: [], error: (e as Error).message });
    }
  }
  if (!last) throw new HttpError(400, results.map((r) => r.error).join(" "));
  // Files are added one at a time, so an early warning ("There is no bold ... yet") can be out of date by
  // the end of the upload. Keep only warnings that are still true.
  const finalRaw = last.raw as { fonts?: { heading?: { weight?: number } } };
  if ((finalRaw.fonts?.heading?.weight ?? 0) >= 600) for (const r of results) r.warnings = r.warnings.filter((w) => !/^There is no bold /.test(w));
  sendJson(res, 200, { results, raw: last.raw, check: last.check, files: last.files, icons: brands.brandDetail(id).icons });
});

route("POST", "/api/brands/:id/files-delete", async (req, res, [id]) => {
  const b = await readJson<{ path?: string }>(req);
  sendJson(res, 200, { ...brands.removeFile(id, b.path ?? ""), icons: brands.brandDetail(id).icons });
});

// Choose surface and caption colours from the brand's colours so every text pair passes AAA.
route("POST", "/api/brands/:id/propose-surfaces", async (req, res, [id]) => {
  brands.brandFolder(id);
  const b = await readJson<{ colours?: Record<string, { value: string; name?: string } | undefined> }>(req);
  if (!b.colours || typeof b.colours !== "object") throw new HttpError(400, "Send the brand's colours.");
  sendJson(res, 200, proposeSurfaces(b.colours));
});

route("POST", "/api/brands/:id/reverse-logo", async (req, res, [id]) => {
  const b = await readJson<{ path?: string }>(req);
  sendJson(res, 200, brands.reverseLogo(id, b.path || undefined));
});

// Read a guidelines file and suggest tokens. The file is kept in the brand's guidelines folder.
route("POST", "/api/brands/:id/guidelines", async (req, res, [id]) => {
  brands.brandFolder(id);
  const { files } = await readMultipart(req, { maxFileBytes: 25_000_000, maxFiles: 1 });
  const f = files[0];
  if (!f) throw new HttpError(400, "Choose a guidelines file to upload.");
  let read;
  try {
    read = await readGuidelines(f.data, f.name);
  } catch (e) {
    throw new HttpError(400, (e as Error).message);
  }
  const saved = brands.addFile(id, "document", f.name, f.data, {});
  sendJson(res, 200, { file: saved.file, excerpt: read.text.slice(0, 1500), suggestions: read.suggestions, files: saved.files });
});

route("GET", "/api/icons", (_req, res, _p, url) => {
  const id = url.searchParams.get("brand") || "demo";
  brands.brandFolder(id);
  sendJson(res, 200, listIcons(loadBrand(id)).map((i) => i.name));
});

route("GET", "/api/fonts", async (_req, res, _p, url) => sendJson(res, 200, await brands.searchFonts(url.searchParams.get("q") ?? "")));

route("POST", "/api/brands/:id/fonts/open", async (req, res, [id]) => {
  const b = await readJson<{ family?: string; weights?: number[]; roles?: boolean }>(req);
  const weights = (b.weights?.length ? b.weights : [400, 700]).map(Number).filter((w) => w >= 100 && w <= 900);
  sendJson(res, 200, await brands.useOpenFont(id, b.family ?? "", weights, b.roles !== false));
});

route("GET", "/brand-files/:id/*", (req, res, [id, rel]) => sendFile(req, res, safeJoin(brands.brandFolder(id), rel)));
route("GET", "/previews/*", (req, res, [rel]) => sendFile(req, res, safeJoin(brands.PREVIEW_ROOT, rel)));

// ---------- server ----------

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const method = req.method === "HEAD" ? "GET" : (req.method ?? "GET");
  try {
    // /healthz, and the sign-in page when APP_PASSWORD is set. Nothing else is served before signing in.
    if (await handleAuth(req, res, url)) return;
    for (const r of routes) {
      if (r.method !== method) continue;
      const m = url.pathname.match(r.re);
      if (!m) continue;
      await r.fn(req, res, m.slice(1), url);
      return;
    }
    throw new HttpError(404, "Page not found.");
  } catch (e) {
    if (res.headersSent) return void res.end();
    if (e instanceof HttpError) return sendJson(res, e.status, { error: e.message, ...(e.extra ?? {}) });
    console.error(e);
    // The detail goes to the log only: it can name files and folders on the server.
    sendJson(res, 500, { error: "Something went wrong on the server. Try again, or ask whoever runs it to check the logs." });
  }
});

server.requestTimeout = 0;
server.listen(PORT, HOST, () => {
  const s = interpreterSettings();
  console.log(`Video maker is running at http://localhost:${PORT}`);
  console.log(`Brief interpreter: ${s.backend === "sdk" ? "Anthropic SDK" : "Claude Code CLI"} (${s.model}). One video is made at a time.`);
  if (DATA_DIR !== ROOT) console.log(`Jobs, brands and caches are in ${DATA_DIR}.`);
  if (AUTH_ENABLED) console.log("Sign-in is on (APP_PASSWORD is set).");
});

// Stop cleanly when the host asks (docker stop or a restart sends SIGTERM): stop taking requests, stop the video being
// made and mark it stopped so Try again works after the restart, then exit.
let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received. Stopping the video being made and shutting down.`);
  server.close();
  server.closeIdleConnections?.();
  const force = setTimeout(() => {
    server.closeAllConnections?.();
    process.exit(0);
  }, 20_000);
  force.unref();
  try {
    await queue.shutdown(15_000);
  } catch (e) {
    console.error(e);
  }
  server.closeAllConnections?.();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
