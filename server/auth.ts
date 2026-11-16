// Sign-in for a hosted copy of the app. Off unless a password is set, so the app on a Mac is unchanged.
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
//
// The desktop app (APP_SETUP=1) starts with no password: every page goes to /setup, where the owner chooses one.
// The password can also be changed later on /settings (see settings.ts), so it is read on every request.
import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { CACHE_DIR } from "../engine/paths";
import { getPassword, setPassword, setApiKey, SETUP_MODE } from "./settings";

export const authEnabled = () => getPassword().length > 0;

const LISTEN_HOST = process.env.HOST || "127.0.0.1";
const LOOPBACK = ["127.0.0.1", "localhost", "::1"].includes(LISTEN_HOST);
/** Listening beyond this machine with no password, and not opened on purpose: refuse everything. */
const failClosed = () => !authEnabled() && !SETUP_MODE && !LOOPBACK && process.env.ALLOW_NO_PASSWORD !== "1";
if (failClosed()) console.error("APP_PASSWORD is not set, so every page is refused. Set APP_PASSWORD (or ALLOW_NO_PASSWORD=1 to open the site to anyone).");
else if (authEnabled() && getPassword().length < 12) console.warn("APP_PASSWORD is shorter than 12 characters. Use a longer one.");

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
// The signing key comes from the password, so changing the password signs everyone out.
let keyFor = { password: "", key: Buffer.alloc(32) };
function signingKey(): Buffer {
  const password = getPassword();
  if (keyFor.password !== password) keyFor = { password, key: crypto.createHash("sha256").update(`video-assembly-session\0${sessionSecret()}\0${password}`).digest() };
  return keyFor.key;
}
/** Mark the cookie Secure even when the proxy does not say the visitor used HTTPS (Tailscale Funnel is HTTPS only). */
const FORCE_SECURE = process.env.COOKIE_SECURE === "1";

/** Constant-time comparison of two strings of any length. */
function sameSecret(a: string, b: string): boolean {
  const ha = crypto.createHash("sha256").update(a).digest();
  const hb = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function sign(expires: number): string {
  return crypto.createHmac("sha256", signingKey()).update(String(expires)).digest("base64url");
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
  return colon >= 0 && sameSecret(decoded.slice(colon + 1), getPassword()) ? "ok" : "wrong";
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

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** A plain one-column page in the sign-in style, used by the sign-in, setup and settings pages. */
export function pageShell(title: string, body: string, focusId?: string): string {
  return `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} - Video maker</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; background: #ffffff; color: #0b0c0c; font: 19px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif; }
  main { max-width: 640px; margin: 0 auto; padding: 48px 16px; }
  h1 { font-size: 40px; line-height: 1.2; margin: 0 0 24px; }
  h2 { font-size: 27px; line-height: 1.25; margin: 48px 0 16px; }
  p { margin: 0 0 16px; }
  a { color: #1d4f91; }
  label { display: block; font-weight: 700; margin-bottom: 8px; }
  .field { margin-bottom: 24px; }
  .hint { color: #0b0c0c; margin: 0 0 8px; }
  input[type=password], input[type=text] { box-sizing: border-box; width: 100%; max-width: 480px; font: inherit; padding: 8px; border: 2px solid #0b0c0c; border-radius: 0; }
  input:focus, button:focus, a:focus { outline: 3px solid #ffdd00; outline-offset: 0; box-shadow: inset 0 0 0 2px #0b0c0c; }
  .field-error { color: #942514; font-weight: 700; margin: 0 0 8px; }
  .has-error input { border-color: #942514; }
  .has-error { border-left: 5px solid #942514; padding-left: 16px; }
  button { font: inherit; font-weight: 700; color: #ffffff; background: #005a30; border: 0; box-shadow: 0 2px 0 #002d18; padding: 10px 16px; cursor: pointer; }
  button:hover { background: #003d20; }
  button.secondary { color: #0b0c0c; background: #e5e6e7; box-shadow: 0 2px 0 #6f7072; }
  button.secondary:hover { background: #cfd0d2; }
  .error-summary { border: 5px solid #942514; padding: 16px; margin-bottom: 32px; }
  .error-summary:focus, .notice:focus { outline: 3px solid #ffdd00; outline-offset: 0; }
  .error-summary h2 { margin: 0 0 8px; font-size: 24px; }
  .error-summary a { color: #942514; font-weight: 700; }
  .notice { border: 5px solid #005a30; padding: 16px; margin-bottom: 32px; }
  .notice h2 { margin: 0 0 8px; font-size: 24px; }
  .status { font-weight: 700; }
  .link-box { font-size: 24px; font-weight: 700; word-break: break-all; padding: 16px; background: #f3f2f1; border-left: 5px solid #1d4f91; margin-bottom: 16px; }
  .back { display: inline-block; margin-bottom: 32px; }
  .visually-hidden { position: absolute; left: -9999px; }
</style>
</head>
<body>
<main>
${body}
</main>
${focusId ? `<script>document.getElementById(${JSON.stringify(focusId)}).focus();</script>` : ""}
</body>
</html>`;
}

/** The error summary at the top of a form page. Each error links to its field. */
export function errorSummary(errors: Array<{ field: string; text: string }>): string {
  if (!errors.length) return "";
  return `<div class="error-summary" role="alert" tabindex="-1" id="error-summary">
    <h2>There is a problem</h2>
    ${errors.map((e) => `<p><a href="#${e.field}">${escapeHtml(e.text)}</a></p>`).join("")}
  </div>`;
}

/** One labelled input, with its hint and inline error. */
export function field(o: { id: string; label: string; hint?: string; type?: string; autocomplete?: string; error?: string }): string {
  const describedBy = [o.hint ? `${o.id}-hint` : "", o.error ? `${o.id}-error` : ""].filter(Boolean).join(" ");
  return `<div class="field${o.error ? " has-error" : ""}">
    <label for="${o.id}">${escapeHtml(o.label)}</label>
    ${o.hint ? `<p class="hint" id="${o.id}-hint">${escapeHtml(o.hint)}</p>` : ""}
    ${o.error ? `<p class="field-error" id="${o.id}-error"><span class="visually-hidden">Error:</span> ${escapeHtml(o.error)}</p>` : ""}
    <input type="${o.type ?? "password"}" id="${o.id}" name="${o.id}" autocomplete="${o.autocomplete ?? "off"}" spellcheck="false"${describedBy ? ` aria-describedby="${describedBy}"` : ""}${o.error ? ' aria-invalid="true"' : ""}>
  </div>`;
}

function loginPage(next: string, error?: string): string {
  const body = `${errorSummary(error ? [{ field: "password", text: error }] : [])}
  <h1>Sign in</h1>
  <form method="post" action="/login" novalidate>
    <input type="hidden" name="next" value="${escapeHtml(next)}">
    ${field({ id: "password", label: "Password", hint: "Ask the person who runs this site for the password.", autocomplete: "current-password", error })}
    <button type="submit">Sign in</button>
  </form>`;
  return pageShell(`${error ? "Error: " : ""}Sign in`, body, error ? "error-summary" : undefined);
}

/** Checks a new password and its repeat. Returns the errors to show, or none. */
export function checkNewPassword(pw: string, pw2: string, fieldId = "password"): Array<{ field: string; text: string }> {
  if (!pw) return [{ field: fieldId, text: "Enter a password" }];
  if (pw.length < 12) return [{ field: fieldId, text: "Password must be 12 characters or more" }];
  if (pw !== pw2) return [{ field: `${fieldId}-again`, text: "Enter the same password twice" }];
  return [];
}

function setupPage(errors: Array<{ field: string; text: string }> = []): string {
  const err = (f: string) => errors.find((e) => e.field === f)?.text;
  const body = `${errorSummary(errors)}
  <h1>Set up the video maker</h1>
  <p>Choose the password your team will use to sign in. You can change everything here later in Settings.</p>
  <form method="post" action="/setup" novalidate>
    ${field({ id: "password", label: "Team password", hint: "At least 12 characters. Four random words works well.", autocomplete: "new-password", error: err("password") })}
    ${field({ id: "password-again", label: "Type the password again", autocomplete: "new-password", error: err("password-again") })}
    ${field({ id: "api-key", label: "Anthropic API key (optional for now)", hint: "The app uses it to read briefs. It starts with sk-ant-. You can add it later in Settings.", type: "password", error: err("api-key") })}
    <button type="submit">Save and continue</button>
  </form>`;
  return pageShell(`${errors.length ? "Error: " : ""}Set up`, body, errors.length ? "error-summary" : undefined);
}

/** Signs this browser in and sends it on. */
export function signIn(req: http.IncomingMessage, res: http.ServerResponse, location: string) {
  const secure = isHttps(req) ? "; Secure" : "";
  res.writeHead(303, {
    Location: location,
    "Set-Cookie": `${COOKIE}=${encodeURIComponent(cookieValue())}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 24 * 3600}${secure}`,
    "Cache-Control": "no-store",
  });
  res.end();
}

export function sendHtml(res: http.ServerResponse, status: number, html: string) {
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Content-Length": Buffer.byteLength(html) });
  res.end(html);
}

export async function readForm(req: http.IncomingMessage): Promise<URLSearchParams> {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 10_000) break;
  }
  return new URLSearchParams(body);
}

/** Checks a pasted Anthropic API key. Empty is allowed: it can be added later. */
export function checkApiKey(key: string, fieldId = "api-key"): Array<{ field: string; text: string }> {
  if (key && !/^sk-ant-[A-Za-z0-9_-]{20,}$/.test(key)) return [{ field: fieldId, text: "Anthropic API key must start with sk-ant- and have no spaces" }];
  return [];
}

/** The desktop app before a password is chosen: only the setup page is served. */
async function handleSetup(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<boolean> {
  if (crossSite(req)) {
    const body = JSON.stringify({ error: "That request came from another website, so it was refused." });
    res.writeHead(403, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "Content-Length": Buffer.byteLength(body) });
    res.end(body);
    return true;
  }
  if (url.pathname === "/setup" && req.method === "POST") {
    const form = await readForm(req);
    const pw = form.get("password") ?? "";
    const key = (form.get("api-key") ?? "").trim();
    const errors = [...checkNewPassword(pw, form.get("password-again") ?? ""), ...checkApiKey(key)];
    if (errors.length) {
      sendHtml(res, 400, setupPage(errors));
      return true;
    }
    if (key) setApiKey(key);
    setPassword(pw);
    signIn(req, res, "/");
    return true;
  }
  if (url.pathname === "/setup") {
    sendHtml(res, 200, setupPage());
    return true;
  }
  const wantsPage = (req.method === "GET" || req.method === "HEAD") && /text\/html/.test(String(req.headers.accept ?? ""));
  if (wantsPage) {
    res.writeHead(303, { Location: "/setup", "Cache-Control": "no-store" });
    res.end();
    return true;
  }
  const body = JSON.stringify({ error: "Finish setting up first." });
  res.writeHead(503, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "Content-Length": Buffer.byteLength(body) });
  res.end(body);
  return true;
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
  if (SETUP_MODE && !authEnabled()) return handleSetup(req, res, url);
  if (url.pathname === "/setup") {
    res.writeHead(303, { Location: "/settings", "Cache-Control": "no-store" });
    res.end();
    return true;
  }
  if (failClosed()) {
    const body = "The site password (APP_PASSWORD) is not set, so the site is closed. The person who runs it needs to set one.";
    res.writeHead(503, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "Content-Length": Buffer.byteLength(body) });
    res.end(body);
    return true;
  }
  if (!authEnabled()) return false;

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
      if (!sameSecret(password, getPassword())) {
        noteFailure(ip);
        // A short pause makes guessing slower.
        await new Promise((r) => setTimeout(r, 500));
        sendHtml(res, 401, loginPage(next, "The password is not right. Check it and try again."));
        return true;
      }
      failures.delete(ip);
      signIn(req, res, next);
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
