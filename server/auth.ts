// Sign-in for a hosted copy of the app. Off unless APP_PASSWORD is set, so the app on a Mac is unchanged.
//
// When APP_PASSWORD is set, every page, API route and file needs either:
//   - the sign-in cookie, set by the password page at /login (for people in a browser), or
//   - HTTP Basic Auth with any user name and the password (for scripts and curl).
// /healthz stays open so the host can check the app is up.
//
// The cookie holds an expiry time and an HMAC of it, keyed from a random secret kept in DATA_DIR/.cache
// (or SESSION_SECRET) plus the password, so a copied cookie cannot be used to guess the password offline.
// Changing the password signs everyone out. Passwords and signatures are compared in constant time.
//
// Fail closed: when the app listens on anything other than this machine (HOST is not 127.0.0.1, as in Docker)
// and APP_PASSWORD is empty, every page is refused. Set ALLOW_NO_PASSWORD=1 to open it on purpose.
import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { CACHE_DIR } from "../engine/paths";

const PASSWORD = process.env.APP_PASSWORD ?? "";
export const AUTH_ENABLED = PASSWORD.length > 0;

const LISTEN_HOST = process.env.HOST || "127.0.0.1";
const LOOPBACK = ["127.0.0.1", "localhost", "::1"].includes(LISTEN_HOST);
/** Listening beyond this machine with no password, and not opened on purpose: refuse everything. */
const FAIL_CLOSED = !AUTH_ENABLED && !LOOPBACK && process.env.ALLOW_NO_PASSWORD !== "1";
if (FAIL_CLOSED) console.error("APP_PASSWORD is not set, so every page is refused. Set APP_PASSWORD (or ALLOW_NO_PASSWORD=1 to open the site to anyone).");
else if (AUTH_ENABLED && PASSWORD.length < 12) console.warn("APP_PASSWORD is shorter than 12 characters. Use a longer one.");

/** A random secret that lasts across restarts, so sign-ins survive a restart. Never logged. */
function sessionSecret(): string {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const file = path.join(CACHE_DIR, "session-secret");
  try {
    const s = fs.readFileSync(file, "utf8").trim();
    if (s.length >= 32) return s;
  } catch {
    /* not made yet */
  }
  const s = crypto.randomBytes(32).toString("hex");
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(file, s, { mode: 0o600 });
  } catch {
    /* read-only disk: sign-ins last until the next restart */
  }
  return s;
}

const COOKIE = "va_session";
const SESSION_DAYS = 14;
const KEY = AUTH_ENABLED ? crypto.createHash("sha256").update(`video-assembly-session\0${sessionSecret()}\0${PASSWORD}`).digest() : Buffer.alloc(32);
/** Mark the cookie Secure even when the proxy does not say the visitor used HTTPS (Tailscale Funnel is HTTPS only). */
const FORCE_SECURE = process.env.COOKIE_SECURE === "1";

/** Constant-time comparison of two strings of any length. */
function sameSecret(a: string, b: string): boolean {
  const ha = crypto.createHash("sha256").update(a).digest();
  const hb = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function sign(expires: number): string {
  return crypto.createHmac("sha256", KEY).update(String(expires)).digest("base64url");
}

function cookieValue(): string {
  const expires = Date.now() + SESSION_DAYS * 24 * 3600 * 1000;
  return `${expires}.${sign(expires)}`;
}

function validCookie(value: string | undefined): boolean {
  if (!value) return false;
  const [exp, sig] = value.split(".");
  const expires = Number(exp);
  if (!Number.isFinite(expires) || expires < Date.now() || !sig) return false;
  return sameSecret(sig, sign(expires));
}

function readCookie(req: http.IncomingMessage, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return undefined;
}

/** "none" when there is no Basic Auth header, otherwise whether its password is right. */
function basicAuth(req: http.IncomingMessage): "none" | "ok" | "wrong" {
  const h = req.headers.authorization ?? "";
  if (!/^Basic /i.test(h)) return "none";
  const decoded = Buffer.from(h.slice(6).trim(), "base64").toString("utf8");
  const colon = decoded.indexOf(":");
  return colon >= 0 && sameSecret(decoded.slice(colon + 1), PASSWORD) ? "ok" : "wrong";
}

/** HTTPS as the visitor sees it: directly, or through a proxy such as Caddy that sets X-Forwarded-Proto. */
function isHttps(req: http.IncomingMessage): boolean {
  const xf = String(req.headers["x-forwarded-proto"] ?? "").split(",")[0].trim();
  return FORCE_SECURE || xf === "https" || (req.socket as { encrypted?: boolean }).encrypted === true;
}

/**
 * Refuse requests that change something when they come from another website (cross-site request forgery).
 * The cookie is SameSite=Lax already; this also covers Basic Auth and older browsers.
 */
function crossSite(req: http.IncomingMessage): boolean {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method ?? "GET")) return false;
  const site = String(req.headers["sec-fetch-site"] ?? "");
  if (site) return site === "cross-site";
  const origin = String(req.headers.origin ?? "");
  if (!origin) return false; // curl and scripts send no Origin
  let host: string;
  try {
    host = new URL(origin).host;
  } catch {
    return true;
  }
  const allowed = [req.headers.host, req.headers["x-forwarded-host"]].flatMap((h) => String(h ?? "").split(",")).map((h) => h.trim()).filter(Boolean);
  return !allowed.includes(host);
}

/** Headers for every response: no framing by other sites, no MIME sniffing, no referrer leaks. */
function securityHeaders(res: http.ServerResponse) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Content-Security-Policy", "frame-ancestors 'self'; object-src 'none'; base-uri 'self'; form-action 'self'");
}

/** The visitor's address. Behind a proxy (Caddy, Tailscale Funnel) the last X-Forwarded-For entry is the one it added. */
function clientIp(req: http.IncomingMessage): string {
  const xf = String(req.headers["x-forwarded-for"] ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return xf[xf.length - 1] ?? req.socket.remoteAddress ?? "unknown";
}

// Slow down guessing: after 10 wrong passwords from one address in 15 minutes, refuse for 15 minutes.
const FAIL_LIMIT = 10;
const FAIL_WINDOW_MS = 15 * 60 * 1000;
const failures = new Map<string, { count: number; first: number }>();

// The address can be faked if the proxy in front does not set X-Forwarded-For, so there is also a limit for
// everyone together: after 100 wrong passwords in 15 minutes, nobody new can sign in until it passes. People
// already signed in are not affected.
const GLOBAL_FAIL_LIMIT = 100;
let globalFailures: number[] = [];

function lockedOut(ip: string): boolean {
  const now = Date.now();
  globalFailures = globalFailures.filter((t) => now - t < FAIL_WINDOW_MS);
  if (globalFailures.length >= GLOBAL_FAIL_LIMIT) return true;
  const f = failures.get(ip);
  if (!f) return false;
  if (now - f.first > FAIL_WINDOW_MS) {
    failures.delete(ip);
    return false;
  }
  return f.count >= FAIL_LIMIT;
}

function noteFailure(ip: string) {
  globalFailures.push(Date.now());
  const f = failures.get(ip);
  if (!f || Date.now() - f.first > FAIL_WINDOW_MS) failures.set(ip, { count: 1, first: Date.now() });
  else f.count++;
  if (failures.size > 10_000) failures.clear();
}

/** Only same-site paths are allowed after signing in, never another website. */
function safeNext(next: string | null | undefined): string {
  // Browsers drop tabs and new lines from addresses, so "/\t/evil.example" would become "//evil.example".
  if (!next || !next.startsWith("/") || /[\\\u0000-\u001f\u007f]/.test(next)) return "/";
  try {
    const u = new URL(next, "http://same.invalid");
    if (u.origin !== "http://same.invalid") return "/";
    return u.pathname + u.search + u.hash;
  } catch {
    return "/";
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function loginPage(next: string, error?: string): string {
  const err = error
    ? `<div class="error-summary" role="alert" tabindex="-1" id="error-summary">
        <h2>There is a problem</h2>
        <p><a href="#password">${escapeHtml(error)}</a></p>
      </div>`
    : "";
  return `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${error ? "Error: " : ""}Sign in - Video maker</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; background: #ffffff; color: #0b0c0c; font: 19px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif; }
  main { max-width: 640px; margin: 0 auto; padding: 48px 16px; }
  h1 { font-size: 40px; line-height: 1.2; margin: 0 0 24px; }
  label { display: block; font-weight: 700; margin-bottom: 8px; }
  .hint { color: #0b0c0c; margin: 0 0 8px; }
  input[type=password] { box-sizing: border-box; width: 100%; max-width: 400px; font: inherit; padding: 8px; border: 2px solid #0b0c0c; border-radius: 0; }
  input[type=password]:focus, button:focus, a:focus { outline: 3px solid #ffdd00; outline-offset: 0; box-shadow: inset 0 0 0 2px #0b0c0c; }
  .field-error { color: #942514; font-weight: 700; margin: 0 0 8px; }
  .has-error input[type=password] { border-color: #942514; }
  .has-error { border-left: 5px solid #942514; padding-left: 16px; }
  button { margin-top: 24px; font: inherit; font-weight: 700; color: #ffffff; background: #005a30; border: 0; box-shadow: 0 2px 0 #002d18; padding: 10px 16px; cursor: pointer; }
  button:hover { background: #003d20; }
  .error-summary { border: 5px solid #942514; padding: 16px; margin-bottom: 32px; }
  .error-summary:focus { outline: 3px solid #ffdd00; outline-offset: 0; }
  .error-summary h2 { margin: 0 0 8px; font-size: 24px; }
  .error-summary a { color: #942514; font-weight: 700; }
</style>
</head>
<body>
<main>
  ${err}
  <h1>Sign in</h1>
  <form method="post" action="/login" novalidate>
    <input type="hidden" name="next" value="${escapeHtml(next)}">
    <div class="${error ? "has-error" : ""}">
      <label for="password">Password</label>
      <p class="hint" id="password-hint">Ask the person who runs this site for the password.</p>
      ${error ? `<p class="field-error" id="password-error"><span style="position:absolute;left:-9999px">Error:</span> ${escapeHtml(error)}</p>` : ""}
      <input type="password" id="password" name="password" autocomplete="current-password" aria-describedby="password-hint${error ? " password-error" : ""}" ${error ? 'aria-invalid="true"' : ""}>
    </div>
    <button type="submit">Sign in</button>
  </form>
</main>
${error ? `<script>document.getElementById("error-summary").focus();</script>` : ""}
</body>
</html>`;
}

function sendHtml(res: http.ServerResponse, status: number, html: string) {
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Content-Length": Buffer.byteLength(html) });
  res.end(html);
}

async function readForm(req: http.IncomingMessage): Promise<URLSearchParams> {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 10_000) break;
  }
  return new URLSearchParams(body);
}

/**
 * Run before every route. Returns true when the request has been answered here (the sign-in page, a refusal,
 * or a redirect) and false when the app should handle it.
 */
export async function handleAuth(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<boolean> {
  securityHeaders(res);
  if (url.pathname === "/healthz") {
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify({ ok: true }));
    return true;
  }
  if (FAIL_CLOSED) {
    const body = "The site password (APP_PASSWORD) is not set, so the site is closed. The person who runs it needs to set one.";
    res.writeHead(503, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "Content-Length": Buffer.byteLength(body) });
    res.end(body);
    return true;
  }
  if (!AUTH_ENABLED) return false;

  if (crossSite(req)) {
    const body = JSON.stringify({ error: "That request came from another website, so it was refused." });
    res.writeHead(403, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "Content-Length": Buffer.byteLength(body) });
    res.end(body);
    return true;
  }

  if (url.pathname === "/login") {
    if (req.method === "POST") {
      const form = await readForm(req);
      const next = safeNext(form.get("next"));
      const ip = clientIp(req);
      if (lockedOut(ip)) {
        sendHtml(res, 429, loginPage(next, "Too many wrong passwords. Wait 15 minutes, then try again."));
        return true;
      }
      const password = form.get("password") ?? "";
      if (!password) {
        sendHtml(res, 400, loginPage(next, "Enter the password"));
        return true;
      }
      if (!sameSecret(password, PASSWORD)) {
        noteFailure(ip);
        // A short pause makes guessing slower.
        await new Promise((r) => setTimeout(r, 500));
        sendHtml(res, 401, loginPage(next, "The password is not right. Check it and try again."));
        return true;
      }
      failures.delete(ip);
      const secure = isHttps(req) ? "; Secure" : "";
      res.writeHead(303, {
        Location: next,
        "Set-Cookie": `${COOKIE}=${encodeURIComponent(cookieValue())}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 24 * 3600}${secure}`,
        "Cache-Control": "no-store",
      });
      res.end();
      return true;
    }
    sendHtml(res, 200, loginPage(safeNext(url.searchParams.get("next"))));
    return true;
  }

  if (url.pathname === "/logout") {
    const secure = isHttps(req) ? "; Secure" : "";
    res.writeHead(303, { Location: "/login", "Set-Cookie": `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`, "Cache-Control": "no-store" });
    res.end();
    return true;
  }

  if (validCookie(readCookie(req, COOKIE))) return false;
  // Basic Auth (for scripts) counts towards the same limit on wrong passwords as the sign-in page.
  const basic = basicAuth(req);
  if (basic !== "none") {
    const ip = clientIp(req);
    if (lockedOut(ip)) {
      const body = JSON.stringify({ error: "Too many wrong passwords. Wait 15 minutes, then try again." });
      res.writeHead(429, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "Content-Length": Buffer.byteLength(body) });
      res.end(body);
      return true;
    }
    if (basic === "ok") return false;
    noteFailure(ip);
    await new Promise((r) => setTimeout(r, 500));
  }

  // Not signed in. People asking for a page are sent to the sign-in page; everything else is refused.
  const wantsPage = (req.method === "GET" || req.method === "HEAD") && /text\/html/.test(String(req.headers.accept ?? ""));
  if (wantsPage) {
    res.writeHead(303, { Location: `/login?next=${encodeURIComponent(url.pathname + url.search)}`, "Cache-Control": "no-store" });
    res.end();
    return true;
  }
  const body = JSON.stringify({ error: "Sign in first." });
  res.writeHead(401, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "Content-Length": Buffer.byteLength(body) });
  res.end(body);
  return true;
}
