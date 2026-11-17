// The Settings page: the team link (Tailscale Funnel), the Anthropic API key and the team password.
// Plain server-made HTML in the sign-in page's style, so it works before and without the built pages.
// Only people who are signed in reach it (handleAuth runs first), and then only with the admin password, which is
// separate from the team password: the team can make videos, but only the admin can change these settings.
import http from "node:http";
import crypto from "node:crypto";
import { pageShell, errorSummary, field, sendHtml, readForm, escapeHtml, signIn, checkNewPassword, checkApiKey, authEnabled, sessionSecret, sameSecret, readCookie, isHttps, clientIp, lockedOut, noteFailure } from "./auth";
import { getPassword, setPassword, setApiKey, apiKeyHint, hasApiKey, PASSWORD_FROM_ENV, KEY_FROM_ENV, shareAvailable, shareWanted, setShareWanted, shareStatus, hasAdminPassword, setAdminPassword, checkAdminPassword, adminPasswordStamp } from "./settings";

type Route = (method: string, pattern: string, fn: (req: http.IncomingMessage, res: http.ServerResponse, params: string[], url: URL) => Promise<void> | void) => void;
type Errors = Array<{ field: string; text: string }>;

const SAVED: Record<string, string> = {
  password: "Team password changed. Everyone needs to sign in again with the new password.",
  admin: "Admin password changed.",
  key: "API key saved.",
  "key-removed": "API key removed.",
  "share-on": "Making the team link. This takes a few seconds.",
  "share-off": "The team link is off. Only this computer can use the video maker now.",
};

// ---------- the admin sign-in ----------
// A separate cookie, signed with a key made from the admin password's hash, so changing that password ends every
// admin sign-in. It lasts 12 hours.

const ADMIN_COOKIE = "va_admin";
const ADMIN_HOURS = 12;

function adminSign(expires: number): string {
  const key = crypto.createHash("sha256").update(`video-assembly-admin\0${sessionSecret()}\0${adminPasswordStamp()}`).digest();
  return crypto.createHmac("sha256", key).update(String(expires)).digest("base64url");
}

function isAdmin(req: http.IncomingMessage): boolean {
  if (!hasAdminPassword()) return false;
  const [exp, sig] = (readCookie(req, ADMIN_COOKIE) ?? "").split(".");
  const expires = Number(exp);
  return Number.isFinite(expires) && expires > Date.now() && !!sig && sameSecret(sig, adminSign(expires));
}

function adminCookie(req: http.IncomingMessage, on: boolean): string {
  const secure = isHttps(req) ? "; Secure" : "";
  if (!on) return `${ADMIN_COOKIE}=; Path=/settings; HttpOnly; SameSite=Strict; Max-Age=0${secure}`;
  const expires = Date.now() + ADMIN_HOURS * 3600 * 1000;
  return `${ADMIN_COOKIE}=${encodeURIComponent(`${expires}.${adminSign(expires)}`)}; Path=/settings; HttpOnly; SameSite=Strict; Max-Age=${ADMIN_HOURS * 3600}${secure}`;
}

function adminLoginPage(error?: string): string {
  const body = `<a class="back" href="/">Back to Make a video</a>
  ${errorSummary(error ? [{ field: "admin-password", text: error }] : [])}
  <h1>Settings</h1>
  <p>Settings are for the person who runs the video maker. Enter the admin password to continue.</p>
  <form method="post" action="/settings/admin-login" novalidate>
    ${field({ id: "admin-password", label: "Admin password", autocomplete: "current-password", error })}
    <button type="submit">Continue</button>
  </form>`;
  return pageShell(`${error ? "Error: " : ""}Settings`, body, error ? "error-summary" : undefined);
}

function adminCreatePage(errors: Errors = []): string {
  const err = (f: string) => errors.find((e) => e.field === f)?.text;
  const body = `<a class="back" href="/">Back to Make a video</a>
  ${errorSummary(errors)}
  <h1>Choose an admin password</h1>
  <p>Settings need their own password, different from the team password, so only you can change them.</p>
  <form method="post" action="/settings/admin-create" novalidate>
    ${field({ id: "admin-password", label: "Admin password", hint: "At least 12 characters. Do not use the team password.", autocomplete: "new-password", error: err("admin-password") })}
    ${field({ id: "admin-password-again", label: "Type the admin password again", autocomplete: "new-password", error: err("admin-password-again") })}
    <button type="submit">Save admin password</button>
  </form>`;
  return pageShell(`${errors.length ? "Error: " : ""}Choose an admin password`, body, errors.length ? "error-summary" : undefined);
}

/** Checks a new admin password: long enough, typed twice, and not the team password. */
export function checkNewAdminPassword(pw: string, pw2: string): Errors {
  const errors = checkNewPassword(pw, pw2, "admin-password");
  if (!errors.length && pw === getPassword()) return [{ field: "admin-password", text: "Admin password must be different from the team password" }];
  return errors;
}

function shareSection(): { html: string; refresh: boolean } {
  if (!shareAvailable()) {
    return { html: `<p>Sharing is not available in this copy of the app. The person who runs it can share it another way.</p>`, refresh: false };
  }
  const s = shareStatus();
  const wanted = shareWanted();
  const openLink = (text: string) => (s.actionUrl ? `<p><a href="${escapeHtml(s.actionUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(text)} (opens in a new tab)</a></p>` : "");
  const button = (on: boolean) =>
    `<form method="post" action="/settings/share" novalidate><input type="hidden" name="share" value="${on ? "on" : "off"}"><button type="submit"${on ? "" : ' class="secondary"'}>${on ? "Turn on the team link" : "Turn off the team link"}</button></form>`;

  if (s.tailscale === "missing") {
    return {
      html: `<p>The team link uses Tailscale, which is not installed on this computer.</p>
        <p><a href="https://tailscale.com/download/linux" target="_blank" rel="noopener noreferrer">Install Tailscale (opens in a new tab)</a>, then come back to this page.</p>`,
      refresh: false,
    };
  }
  if (s.on && s.url && wanted) {
    return {
      html: `<p class="status">The team link is on.</p>
        <div class="link-box" id="team-link">${escapeHtml(s.url)}</div>
        <p>Send this link to your team. Send the password separately, for example by phone or chat.</p>
        ${button(false)}`,
      refresh: false,
    };
  }
  if (wanted) {
    const waiting =
      s.tailscale === "needs-login"
        ? `<p class="status">Sign in to Tailscale to make the link.</p>${openLink("Sign in to Tailscale")}<p>Then come back here. This page checks again by itself.</p>`
        : s.actionUrl
          ? `<p class="status">Tailscale needs you to allow sharing for your account, once.</p>${openLink("Allow sharing in Tailscale")}<p>Then come back here. This page checks again by itself.</p>`
          : `<p class="status">Making the link. This page checks again by itself.</p>${s.message ? `<p>${escapeHtml(s.message)}</p>` : ""}`;
    return { html: `${waiting}${button(false)}`, refresh: true };
  }
  return {
    html: `<p class="status">The team link is off.</p>
      <p>Only this computer can use the video maker. Turn on the link to let your team use it from anywhere, with the password.</p>
      ${button(true)}`,
    refresh: false,
  };
}

function settingsPage(o: { saved?: string; errors?: Errors } = {}): string {
  const errors = o.errors ?? [];
  const err = (f: string) => errors.find((e) => e.field === f)?.text;
  const notice = !errors.length && o.saved && SAVED[o.saved] ? `<div class="notice" role="status" tabindex="-1" id="notice"><h2>Done</h2><p>${escapeHtml(SAVED[o.saved])}</p></div>` : "";
  const share = shareSection();
  const keyStatus = hasApiKey() ? `An API key is saved${apiKeyHint() ? `, ${escapeHtml(apiKeyHint())}` : ""}.` : "No API key is saved yet. Briefs cannot be read until you add one.";

  const body = `<a class="back" href="/">Back to Make a video</a>
  ${errorSummary(errors)}${notice}
  <h1>Settings</h1>

  <h2 id="share">Team link</h2>
  ${share.html}

  <h2 id="key">Anthropic API key</h2>
  <p>${keyStatus}</p>
  ${
    KEY_FROM_ENV
      ? `<p>This key is set where the app is installed, so it cannot be changed here.</p>`
      : `<p>The app uses the key to read briefs. Set a monthly spend limit in the <a href="https://console.anthropic.com/settings/limits" target="_blank" rel="noopener noreferrer">Anthropic Console (opens in a new tab)</a>.</p>
  <form method="post" action="/settings/key" novalidate>
    ${field({ id: "api-key", label: hasApiKey() ? "New API key" : "API key", hint: "It starts with sk-ant-.", error: err("api-key") })}
    <button type="submit">Save API key</button>
  </form>`
  }

  <h2 id="password">Team password</h2>
  ${
    PASSWORD_FROM_ENV
      ? `<p>The password is set where the app is installed, so it cannot be changed here.</p>`
      : `<p>The password your team uses to sign in. Changing it signs everyone out, and they sign in again with the new one.</p>
  <form method="post" action="/settings/password" novalidate>
    ${field({ id: "password", label: "New password", hint: "At least 12 characters. Four random words works well.", autocomplete: "new-password", error: err("password") })}
    ${field({ id: "password-again", label: "Type the new password again", autocomplete: "new-password", error: err("password-again") })}
    <button type="submit">Change password</button>
  </form>`
  }

  <h2 id="admin">Admin password</h2>
  <p>The password for this Settings page. Keep it to yourself.</p>
  <form method="post" action="/settings/admin-password" novalidate>
    ${field({ id: "admin-password", label: "New admin password", hint: "At least 12 characters. Do not use the team password.", autocomplete: "new-password", error: err("admin-password") })}
    ${field({ id: "admin-password-again", label: "Type the new admin password again", autocomplete: "new-password", error: err("admin-password-again") })}
    <button type="submit">Change admin password</button>
  </form>

  <h2>Lock settings</h2>
  <form method="post" action="/settings/admin-logout" novalidate><button type="submit" class="secondary">Lock settings on this browser</button></form>
  ${authEnabled() ? `<p><a href="/logout">Sign out of the video maker on this browser</a></p>` : ""}
  ${share.refresh ? `<script>setTimeout(() => location.replace("/settings#share"), 4000);</script>` : ""}`;
  return pageShell(`${errors.length ? "Error: " : ""}Settings`, body, errors.length ? "error-summary" : notice ? "notice" : undefined);
}

function redirect(res: http.ServerResponse, to: string) {
  res.writeHead(303, { Location: to, "Cache-Control": "no-store" });
  res.end();
}

export function registerSettingsRoutes(route: Route) {
  /** Every settings change needs the admin sign-in. Answers and returns false when it is missing. */
  const admin = (req: http.IncomingMessage, res: http.ServerResponse): boolean => {
    if (isAdmin(req)) return true;
    redirect(res, "/settings");
    return false;
  };

  route("GET", "/settings", (req, res, _p, url) => {
    if (!hasAdminPassword()) return sendHtml(res, 200, adminCreatePage());
    if (!isAdmin(req)) return sendHtml(res, 200, adminLoginPage());
    sendHtml(res, 200, settingsPage({ saved: url.searchParams.get("saved") ?? undefined }));
  });

  route("POST", "/settings/admin-login", async (req, res) => {
    const ip = clientIp(req);
    if (lockedOut(ip)) return sendHtml(res, 429, adminLoginPage("Too many wrong passwords. Wait 15 minutes, then try again."));
    const pw = (await readForm(req)).get("admin-password") ?? "";
    if (!pw) return sendHtml(res, 400, adminLoginPage("Enter the admin password"));
    if (!checkAdminPassword(pw)) {
      noteFailure(ip);
      await new Promise((r) => setTimeout(r, 500));
      return sendHtml(res, 401, adminLoginPage("The admin password is not right. Check it and try again."));
    }
    res.writeHead(303, { Location: "/settings", "Set-Cookie": adminCookie(req, true), "Cache-Control": "no-store" });
    res.end();
  });

  // Only when no admin password exists yet (an install from before admin passwords).
  route("POST", "/settings/admin-create", async (req, res) => {
    if (hasAdminPassword()) return redirect(res, "/settings");
    const form = await readForm(req);
    const pw = form.get("admin-password") ?? "";
    const errors = checkNewAdminPassword(pw, form.get("admin-password-again") ?? "");
    if (errors.length) return sendHtml(res, 400, adminCreatePage(errors));
    setAdminPassword(pw);
    res.writeHead(303, { Location: "/settings", "Set-Cookie": adminCookie(req, true), "Cache-Control": "no-store" });
    res.end();
  });

  route("POST", "/settings/admin-logout", (req, res) => {
    res.writeHead(303, { Location: "/", "Set-Cookie": adminCookie(req, false), "Cache-Control": "no-store" });
    res.end();
  });

  route("POST", "/settings/admin-password", async (req, res) => {
    if (!admin(req, res)) return;
    const form = await readForm(req);
    const pw = form.get("admin-password") ?? "";
    const errors = checkNewAdminPassword(pw, form.get("admin-password-again") ?? "");
    if (errors.length) return sendHtml(res, 400, settingsPage({ errors }));
    setAdminPassword(pw);
    // The new password makes a new signing key, so sign this browser in again with it.
    res.writeHead(303, { Location: "/settings?saved=admin#admin", "Set-Cookie": adminCookie(req, true), "Cache-Control": "no-store" });
    res.end();
  });

  route("POST", "/settings/share", async (req, res) => {
    if (!admin(req, res)) return;
    const on = (await readForm(req)).get("share") === "on";
    if (shareAvailable()) setShareWanted(on);
    redirect(res, `/settings?saved=${on ? "share-on" : "share-off"}#share`);
  });

  route("POST", "/settings/key", async (req, res) => {
    if (!admin(req, res)) return;
    if (KEY_FROM_ENV) return redirect(res, "/settings#key");
    const key = ((await readForm(req)).get("api-key") ?? "").trim();
    const errors = key ? checkApiKey(key) : [{ field: "api-key", text: "Enter the API key" }];
    if (errors.length) return sendHtml(res, 400, settingsPage({ errors }));
    setApiKey(key);
    redirect(res, "/settings?saved=key#key");
  });

  route("POST", "/settings/password", async (req, res) => {
    if (!admin(req, res)) return;
    if (PASSWORD_FROM_ENV) return redirect(res, "/settings#password");
    const form = await readForm(req);
    const pw = form.get("password") ?? "";
    const errors = checkNewPassword(pw, form.get("password-again") ?? "");
    if (!errors.length && hasAdminPassword() && checkAdminPassword(pw)) errors.push({ field: "password", text: "Team password must be different from the admin password" });
    if (errors.length) return sendHtml(res, 400, settingsPage({ errors }));
    setPassword(pw);
    // The team sign-in cookie is signed with the team password, so sign this browser in again with the new one.
    signIn(req, res, "/settings?saved=password#password");
  });
}
