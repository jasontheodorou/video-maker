// A small history router for the one-page app. Back and Forward work; no dependency.
//
//   const route = useRoute();          // { workspace, path, params, query }
//   navigate("/v/abc");                // pushState
//   navigate("/v/abc?scene=2", { replace: true });
//   <Link to="/videos">Videos</Link>   // a real <a>, so middle-click and copy link work
import { useSyncExternalStore, type AnchorHTMLAttributes, type ReactNode } from "react";

export type Workspace = "make" | "videos" | "brands" | "settings";

export interface Route {
  workspace: Workspace;
  /** The path, for example "/v/abc". */
  path: string;
  /** Named parts of the path: `jobId` on /v/:jobId, `brandId` and `area` on /brands/:brandId/:area. */
  params: { jobId?: string; brandId?: string; area?: string };
  query: URLSearchParams;
}

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
let snapshotKey = "";
let snapshot: Route | null = null;

/** Legacy links, rewritten once on load: /?job=ID → /v/ID. (/brands?brand=ID is left for the brands page.) */
function legacy() {
  const q = new URLSearchParams(location.search);
  const job = q.get("job");
  if ((location.pathname === "/" || location.pathname === "/make") && job) {
    history.replaceState(null, "", `/v/${encodeURIComponent(job)}`);
  }
}
if (typeof window !== "undefined") {
  legacy();
  window.addEventListener("popstate", emit);
}

export function parseRoute(pathname: string, search: string): Route {
  const query = new URLSearchParams(search);
  const parts = pathname.split("/").filter(Boolean).map(decodeURIComponent);
  const path = pathname;
  if (parts[0] === "v" && parts[1]) return { workspace: "make", path, params: { jobId: parts[1] }, query };
  if (parts[0] === "videos") return { workspace: "videos", path, params: {}, query };
  if (parts[0] === "brands") return { workspace: "brands", path, params: { brandId: parts[1], area: parts[2] }, query };
  if (parts[0] === "settings") return { workspace: "settings", path, params: {}, query };
  return { workspace: "make", path, params: {}, query };
}

function current(): Route {
  const key = location.pathname + location.search;
  if (key !== snapshotKey || !snapshot) {
    snapshotKey = key;
    snapshot = parseRoute(location.pathname, location.search);
  }
  return snapshot;
}

/** The current route. Re-renders on navigate() and on Back and Forward. */
export function useRoute(): Route {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    current,
    current,
  );
}

/** Guards that can stop a navigation (for example "Discard 3 changes?"). Return false to stay. */
const guards = new Set<(to: string) => boolean>();
export function addNavigationGuard(fn: (to: string) => boolean): () => void {
  guards.add(fn);
  return () => guards.delete(fn);
}

/** Go to a path inside the app. Server pages (/settings, /logout) load normally. */
export function navigate(to: string, opts: { replace?: boolean } = {}) {
  if (/^\/(settings|logout|login|setup|classic)/.test(to)) {
    location.assign(to);
    return;
  }
  if (!opts.replace) for (const g of guards) if (!g(to)) return;
  if (opts.replace) history.replaceState(null, "", to);
  else history.pushState(null, "", to);
  emit();
}

/** Change query values on the current path without adding a history entry. `null` removes a value. */
export function setQuery(values: Record<string, string | null>) {
  const url = new URL(location.href);
  for (const [k, v] of Object.entries(values)) {
    if (v == null) url.searchParams.delete(k);
    else url.searchParams.set(k, v);
  }
  history.replaceState(null, "", url.pathname + url.search);
  emit();
}

/** A link inside the app. Plain clicks use the router; modified clicks behave like any link. */
export function Link({ to, children, replace, onClick, ...rest }: { to: string; children: ReactNode; replace?: boolean } & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href">) {
  return (
    <a
      href={to}
      {...rest}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        if (/^\/(settings|logout|classic)/.test(to)) return;
        e.preventDefault();
        navigate(to, { replace });
      }}
    >
      {children}
    </a>
  );
}
