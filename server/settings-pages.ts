// The Settings page: the team link (Tailscale Funnel), the Anthropic API key and the team password.
// Plain server-made HTML in the sign-in page's style, so it works before and without the built pages.
// Only people who are signed in reach it (handleAuth runs first).
import http from "node:http";
import { pageShell, errorSummary, field, sendHtml, readForm, escapeHtml, signIn, checkNewPassword, checkApiKey, authEnabled } from "./auth";
import { getPassword, setPassword, setApiKey, apiKeyHint, hasApiKey, PASSWORD_FROM_ENV, KEY_FROM_ENV, shareAvailable, shareWanted, setShareWanted, shareStatus } from "./settings";
import crypto from "node:crypto";

type Route = (method: string, pattern: string, fn: (req: http.IncomingMessage, res: http.ServerResponse, params: string[], url: URL) => Promise<void> | void) => void;
type Errors = Array<{ field: string; text: string }>;

const SAVED: Record<string, string> = {
  password: "Password changed. Everyone else needs to sign in again with the new password.",
  key: "API key saved.",
  "key-removed": "API key removed.",
  "share-on": "Making the team link. This takes a few seconds.",
  "share-off": "The team link is off. Only this computer can use the video maker now.",
};

function sameSecret(a: string, b: string): boolean {
  return crypto.timingSafeEqual(crypto.createHash("sha256").update(a).digest(), crypto.createHash("sha256").update(b).digest());
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
      : `<p>Changing it signs everyone else out. They sign in again with the new password.</p>
  <form method="post" action="/settings/password" novalidate>
    ${authEnabled() ? field({ id: "current-password", label: "Current password", autocomplete: "current-password", error: err("current-password") }) : ""}
    ${field({ id: "password", label: "New password", hint: "At least 12 characters. Four random words works well.", autocomplete: "new-password", error: err("password") })}
    ${field({ id: "password-again", label: "Type the new password again", autocomplete: "new-password", error: err("password-again") })}
    <button type="submit">Change password</button>
  </form>`
  }

  ${authEnabled() ? `<h2>Sign out</h2><p><a href="/logout">Sign out of the video maker on this browser</a></p>` : ""}
  ${share.refresh ? `<script>setTimeout(() => location.replace("/settings#share"), 4000);</script>` : ""}`;
  return pageShell(`${errors.length ? "Error: " : ""}Settings`, body, errors.length ? "error-summary" : notice ? "notice" : undefined);
}

function redirect(res: http.ServerResponse, to: string) {
  res.writeHead(303, { Location: to, "Cache-Control": "no-store" });
  res.end();
}

export function registerSettingsRoutes(route: Route) {
  route("GET", "/settings", (_req, res, _p, url) => sendHtml(res, 200, settingsPage({ saved: url.searchParams.get("saved") ?? undefined })));

  route("POST", "/settings/share", async (req, res) => {
    const on = (await readForm(req)).get("share") === "on";
    if (shareAvailable()) setShareWanted(on);
    redirect(res, `/settings?saved=${on ? "share-on" : "share-off"}#share`);
  });

  route("POST", "/settings/key", async (req, res) => {
    if (KEY_FROM_ENV) return redirect(res, "/settings#key");
    const key = ((await readForm(req)).get("api-key") ?? "").trim();
    const errors = key ? checkApiKey(key) : [{ field: "api-key", text: "Enter the API key" }];
    if (errors.length) return sendHtml(res, 400, settingsPage({ errors }));
    setApiKey(key);
    redirect(res, "/settings?saved=key#key");
  });

  route("POST", "/settings/password", async (req, res) => {
    if (PASSWORD_FROM_ENV) return redirect(res, "/settings#password");
    const form = await readForm(req);
    const errors: Errors = [];
    if (authEnabled() && !sameSecret(form.get("current-password") ?? "", getPassword())) {
      await new Promise((r) => setTimeout(r, 500));
      errors.push({ field: "current-password", text: "The current password is not right" });
    }
    errors.push(...checkNewPassword(form.get("password") ?? "", form.get("password-again") ?? ""));
    if (errors.length) return sendHtml(res, 400, settingsPage({ errors }));
    setPassword(form.get("password") ?? "");
    // The new password makes a new signing key, so sign this browser in again with it.
    signIn(req, res, "/settings?saved=password#password");
  });
}
