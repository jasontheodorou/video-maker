// Shared helpers for the Video maker pages. Plain JavaScript, no build step.

// Let append, prepend and replaceChildren skip null and false, so optional parts can be written inline
// (cond ? el(...) : null) without the browser printing "null".
for (const name of ["append", "prepend", "replaceChildren"]) {
  const orig = Element.prototype[name];
  Element.prototype[name] = function (...kids) {
    return orig.apply(this, kids.flat().filter((k) => k != null && k !== false));
  };
}

/** Call the API. Throws an Error with the server's plain-English message (and .data for details). */
export async function api(method, url, body) {
  const opts = { method, headers: {} };
  if (body instanceof FormData) opts.body = body;
  else if (body !== undefined) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(url, opts);
  } catch {
    throw new Error("Could not reach the Video maker. Check it is still running (npm run app).");
  }
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const err = new Error((data && data.error) || `Something went wrong (${res.status}).`);
    err.data = data;
    err.status = res.status;
    throw err;
  }
  return data;
}

/** Build an element: el("p", { class: "hint" }, "Text", child). */
export function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v == null) continue;
    if (k === "class") n.className = v;
    else if (k === "text") n.textContent = v;
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
    else if (k === "dataset") Object.assign(n.dataset, v);
    else if (v === true) n.setAttribute(k, "");
    else n.setAttribute(k, String(v));
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    n.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return n;
}

export function debounce(fn, ms) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

/** GOV.UK style: "6 November 2026 at 12:06am", "at midday", "at midnight". */
export function formatDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const date = d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const h = d.getHours();
  const m = d.getMinutes();
  let time;
  if (m === 0 && h === 0) time = "midnight";
  else if (m === 0 && h === 12) time = "midday";
  else time = `${h % 12 || 12}:${String(m).padStart(2, "0")}${h < 12 ? "am" : "pm"}`;
  return `${date} at ${time}`;
}

export function formatBytes(n) {
  if (n > 1e6) return `${(n / 1e6).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(n / 1e3))} KB`;
}

/** Show an error summary at the top of a container and move focus to it. */
/**
 * A link in an error summary, as in the GOV.UK pattern: it moves focus into the field and scrolls its label
 * (or the legend of its group) into view, so the question is seen with the answer box.
 */
export function errorLink(targetId, text) {
  return el(
    "a",
    {
      href: `#${targetId}`,
      onclick: (e) => {
        const target = document.getElementById(targetId);
        if (!target) return;
        e.preventDefault();
        const legend = target.closest("fieldset")?.querySelector("legend");
        const label = document.querySelector(`label[for="${CSS.escape(targetId)}"]`);
        (legend && target.type === "checkbox" ? legend : label ?? target).scrollIntoView({ block: "start" });
        target.focus({ preventScroll: true });
      },
    },
    text,
  );
}

/** Show an error summary. Each message is text, or { text, target } to link it to the field with that id. */
export function showErrors(container, title, messages) {
  container.replaceChildren();
  if (!messages || !messages.length) {
    container.hidden = true;
    return;
  }
  container.hidden = false;
  container.append(
    el(
      "div",
      { class: "error-summary", role: "alert", tabindex: "-1" },
      el("h2", {}, title),
      el("ul", {}, messages.map((m) => el("li", {}, typeof m === "object" && m.target ? errorLink(m.target, m.text) : typeof m === "object" ? m.text : m))),
    ),
  );
  container.firstChild.focus();
}

/** Announce a short status to screen readers through a live region. */
export function announce(text) {
  let live = document.getElementById("live-status");
  if (!live) {
    live = el("div", { id: "live-status", class: "visually-hidden", "aria-live": "polite" });
    document.body.append(live);
  }
  live.textContent = "";
  setTimeout(() => (live.textContent = text), 50);
}

export const FORMAT_LABELS = { "16x9": "Landscape 16:9", "9x16": "Portrait 9:16", "1x1": "Square 1:1" };
