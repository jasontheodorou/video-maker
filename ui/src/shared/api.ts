// Calls to the Video maker's JSON API, and small formatting helpers shared by both pages.

export class ApiError extends Error {
  data: any;
  status: number;
  constructor(message: string, status: number, data: any) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

/** Call the API. Throws an ApiError with the server's plain-English message (and .data for details). */
export async function api<T = any>(method: string, url: string, body?: unknown): Promise<T> {
  const opts: RequestInit = { method, headers: {} };
  if (body instanceof FormData) opts.body = body;
  else if (body !== undefined) {
    (opts.headers as Record<string, string>)["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  let res: Response;
  try {
    res = await fetch(url, opts);
  } catch {
    throw new ApiError("Could not reach the Video maker. Check it is still running (npm run app).", 0, null);
  }
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) throw new ApiError((data && data.error) || `Something went wrong (${res.status}).`, res.status, data);
  return data as T;
}

/** GOV.UK style: "6 November 2026 at 12:06am", "at midday", "at midnight". */
export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const date = d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const h = d.getHours();
  const m = d.getMinutes();
  let time: string;
  if (m === 0 && h === 0) time = "midnight";
  else if (m === 0 && h === 12) time = "midday";
  else time = `${h % 12 || 12}:${String(m).padStart(2, "0")}${h < 12 ? "am" : "pm"}`;
  return `${date} at ${time}`;
}

export function formatBytes(n: number): string {
  if (n > 1e6) return `${(n / 1e6).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(n / 1e3))} KB`;
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export const FORMAT_LABELS: Record<string, string> = { "16x9": "Landscape 16:9", "9x16": "Portrait 9:16", "1x1": "Square 1:1" };

export const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

export function getPath(obj: any, path: string): any {
  return path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

export function setPath(obj: any, path: string, value: unknown): void {
  const keys = path.split(".");
  let o = obj;
  for (const k of keys.slice(0, -1)) {
    if (o[k] == null || typeof o[k] !== "object") o[k] = {};
    o = o[k];
  }
  if (value === undefined) delete o[keys[keys.length - 1]];
  else o[keys[keys.length - 1]] = value;
}

/** Announce a short status to screen readers through the page's polite live region. */
export function announce(text: string): void {
  let live = document.getElementById("live-status");
  if (!live) {
    live = document.createElement("div");
    live.id = "live-status";
    live.className = "visually-hidden";
    live.setAttribute("aria-live", "polite");
    document.body.append(live);
  }
  live.textContent = "";
  setTimeout(() => (live!.textContent = text), 50);
}

/** Focus a heading, message or report that is not normally focusable. */
export function focusNode(node: Element | null | undefined, opts?: FocusOptions): void {
  if (!(node instanceof HTMLElement)) return;
  if (!node.hasAttribute("tabindex") && !/^(A|BUTTON|INPUT|SELECT|TEXTAREA)$/.test(node.tagName)) node.setAttribute("tabindex", "-1");
  node.focus(opts);
}

export const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
