// Small HTTP helpers: JSON bodies, safe file serving with byte ranges (so videos can seek), and multipart uploads.
import fs from "node:fs";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import Busboy from "busboy";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly extra?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export function sendJson(res: ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "Content-Length": Buffer.byteLength(body) });
  res.end(body);
}

export async function readJson<T = unknown>(req: IncomingMessage, limit = 2_000_000): Promise<T> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > limit) throw new HttpError(413, "The request is too large.");
    chunks.push(c as Buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new HttpError(400, "The request was not valid JSON.");
  }
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".wav": "audio/wav",
  ".srt": "application/x-subrip; charset=utf-8",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".pdf": "application/pdf",
  ".ico": "image/x-icon",
};

/** Resolve a relative path inside a root folder, refusing anything that escapes it. */
export function safeJoin(root: string, rel: string): string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(rel).replace(/\\/g, "/");
  } catch {
    throw new HttpError(400, "That path is not allowed.");
  }
  if (decoded.includes("\0")) throw new HttpError(400, "That path is not allowed.");
  const full = path.resolve(root, "." + path.posix.normalize("/" + decoded));
  const r = path.resolve(root);
  if (full !== r && !full.startsWith(r + path.sep)) throw new HttpError(403, "That path is not allowed.");
  return full;
}

/** Serve a file. Supports Range requests and optional download names. */
export function sendFile(req: IncomingMessage, res: ServerResponse, file: string, opts: { download?: string; cache?: string } = {}): void {
  let st: fs.Stats;
  try {
    st = fs.statSync(file);
    if (!st.isFile()) throw new Error();
  } catch {
    throw new HttpError(404, "File not found.");
  }
  const type = TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream";
  const headers: Record<string, string | number> = {
    "Content-Type": type,
    "Accept-Ranges": "bytes",
    "Cache-Control": opts.cache ?? "no-cache",
    "Last-Modified": st.mtime.toUTCString(),
    "X-Content-Type-Options": "nosniff",
  };
  if (opts.download) headers["Content-Disposition"] = `attachment; filename="${opts.download.replace(/[^A-Za-z0-9._-]/g, "_")}"`;
  // An SVG opened on its own is a page on this site, so it gets no scripts, no forms and no outside requests.
  if (type === "image/svg+xml") headers["Content-Security-Policy"] = "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; sandbox; frame-ancestors 'self'";
  const range = req.headers.range;
  if (range) {
    const m = range.match(/bytes=(\d*)-(\d*)/);
    if (m) {
      let start = m[1] ? parseInt(m[1], 10) : NaN;
      let end = m[2] ? parseInt(m[2], 10) : st.size - 1;
      if (isNaN(start)) {
        start = st.size - end;
        end = st.size - 1;
      }
      if (start >= st.size || start < 0 || end < start) {
        res.writeHead(416, { "Content-Range": `bytes */${st.size}` });
        res.end();
        return;
      }
      end = Math.min(end, st.size - 1);
      res.writeHead(206, { ...headers, "Content-Range": `bytes ${start}-${end}/${st.size}`, "Content-Length": end - start + 1 });
      if (req.method === "HEAD") return void res.end();
      fs.createReadStream(file, { start, end }).pipe(res);
      return;
    }
  }
  res.writeHead(200, { ...headers, "Content-Length": st.size });
  if (req.method === "HEAD") return void res.end();
  fs.createReadStream(file).pipe(res);
}

export interface UploadedFile {
  field: string;
  name: string;
  mime: string;
  data: Buffer;
}

/** Read a multipart form into fields and in-memory files. */
// Uploads are held in memory, so the whole upload is capped too (12 files of 500 MB would need 6 GB).
const DEFAULT_MAX_TOTAL_BYTES = Number(process.env.MAX_UPLOAD_TOTAL_BYTES) || 1_000_000_000;

export function readMultipart(req: IncomingMessage, opts: { maxFileBytes: number; maxFiles: number; maxTotalBytes?: number }): Promise<{ fields: Record<string, string[]>; files: UploadedFile[] }> {
  const maxTotal = opts.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES;
  let total = 0;
  return new Promise((resolve, reject) => {
    const ct = req.headers["content-type"] ?? "";
    if (!ct.startsWith("multipart/form-data")) return reject(new HttpError(400, "Send the form as multipart/form-data."));
    let bb: ReturnType<typeof Busboy>;
    try {
      bb = Busboy({ headers: req.headers, limits: { fileSize: opts.maxFileBytes, files: opts.maxFiles, fields: 50, fieldSize: 200_000 } });
    } catch (e) {
      return reject(new HttpError(400, (e as Error).message));
    }
    const fields: Record<string, string[]> = {};
    const files: UploadedFile[] = [];
    let failed: Error | null = null;
    bb.on("field", (name, value) => (fields[name] ??= []).push(value));
    bb.on("file", (field, stream, info) => {
      const chunks: Buffer[] = [];
      stream.on("data", (d: Buffer) => {
        total += d.length;
        if (total > maxTotal) {
          failed ??= new HttpError(413, `The upload is too large. The limit is ${Math.round(maxTotal / 1_000_000)} MB in total.`);
          return; // keep reading so the reply can be sent, but stop holding the bytes
        }
        chunks.push(d);
      });
      stream.on("limit", () => {
        failed = new HttpError(413, `${info.filename} is too large. The limit is ${Math.round(opts.maxFileBytes / 1_000_000)} MB.`);
      });
      stream.on("end", () => {
        if (!info.filename) return;
        files.push({ field, name: path.basename(info.filename), mime: info.mimeType, data: Buffer.concat(chunks) });
      });
    });
    bb.on("filesLimit", () => (failed = new HttpError(413, `Upload at most ${opts.maxFiles} files at once.`)));
    bb.on("error", (e) => reject(new HttpError(400, (e as Error).message)));
    bb.on("close", () => (failed ? reject(failed) : resolve({ fields, files })));
    req.pipe(bb);
  });
}

/** A file name that is safe on disk: lower case, letters, numbers and hyphens, keeping the extension. */
export function safeFileName(name: string, fallback = "file"): string {
  const ext = path.extname(name).toLowerCase().replace(/[^.a-z0-9]/g, "");
  const base =
    path
      .basename(name, path.extname(name))
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || fallback;
  return base + ext;
}
