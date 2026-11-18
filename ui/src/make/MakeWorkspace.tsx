// The Make workspace: /make (composer) and /v/:id (one video). Bin: recent videos.
import { useCallback, useEffect, useState } from "react";
import { api } from "../shared/api";
import { Link, navigate, useRoute } from "../shared/router";
import { AppShell, HidePanelButton, Panel, ShowPanelButtons, useShortcuts } from "../shared/studio";
import { toast } from "../shared/ui";
import { useComposer } from "./Composer";
import { useJobWorkspace } from "./JobWorkspace";
import { STATE_TEXT, isBusy, type BrandSummary, type JobRow, type JobViewData, type Meta } from "./types";

/** "18 Nov, 10:12" this year; "18 Nov 2025" before. */
export function shortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const thisYear = d.getFullYear() === new Date().getFullYear();
  const date = d.toLocaleDateString("en-GB", thisYear ? { day: "numeric", month: "short" } : { day: "numeric", month: "short", year: "numeric" });
  return thisYear ? `${date}, ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}` : date;
}

export function stateWord(r: { state: string; progress?: number }) {
  return r.state === "running" ? `${STATE_TEXT.running} ${Math.round((r.progress ?? 0) * 100)}%` : (STATE_TEXT[r.state] ?? r.state);
}

type Filter = "all" | "done" | "busy" | "error";
export const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: "all", label: "All" },
  { id: "done", label: "Ready" },
  { id: "busy", label: "Busy" },
  { id: "error", label: "Problems" },
];
export const matchFilter = (f: string, s: string) => f === "all" || (f === "busy" ? isBusy(s) : f === "error" ? s === "error" || s === "stopped" : s === f);

/** Shared data for the Make and Videos workspaces. */
export function useStudioData() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [brands, setBrands] = useState<BrandSummary[]>([]);
  const [brandsError, setBrandsError] = useState<string | null>(null);
  const [history, setHistory] = useState<JobRow[] | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const loadHistory = useCallback(async () => {
    try {
      setHistory(await api<JobRow[]>("GET", "/api/jobs"));
      setHistoryError(null);
    } catch (e) {
      setHistoryError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    api<Meta>("GET", "/api/meta").then(setMeta).catch((e) => setBrandsError((e as Error).message));
    (async () => {
      for (let attempt = 1; attempt <= 4; attempt++) {
        try {
          const b = await api<BrandSummary[]>("GET", "/api/brands");
          if (b.length) {
            setBrands(b);
            setBrandsError(null);
            return;
          }
        } catch (e) {
          if (attempt === 4) setBrandsError((e as Error).message);
        }
        await new Promise((r) => setTimeout(r, 1200 * attempt));
      }
    })();
    void loadHistory();
  }, [loadHistory]);
  return { meta, brands, brandsError, history, historyError, loadHistory, setHistory };
}

function Bin({ history, error, openId, brands }: { history: JobRow[] | null; error: string | null; openId: string | null; brands: BrandSummary[] }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const rows = (history ?? []).filter((r) => matchFilter(filter, r.state) && (!q || r.title.toLowerCase().includes(q.toLowerCase()))).slice(0, 30);
  const brandName = (id: string) => brands.find((b) => b.id === id)?.name ?? id;
  return (
    <Panel
      title={
        <span id="history-title" tabIndex={-1}>
          Videos
        </span>
      }
      actions={<HidePanelButton which="bin" label="Hide list" />}
      footer={
        <Link to="/videos" className="bin-all">
          All videos
        </Link>
      }
    >
      <div className="bin-tools bin-tools--flush">
        <label className="visually-hidden" htmlFor="bin-search">
          Find a video
        </label>
        <input className="input" id="bin-search" type="search" placeholder="Find a video" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="chips" role="group" aria-label="Show">
          {FILTERS.map((f) => (
            <button key={f.id} type="button" className="filter-chip" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
              {f.label}
            </button>
          ))}
        </div>
      </div>
      <div id="history">
        {error ? (
          <p className="bad-text bin-note">{error}</p>
        ) : !history ? (
          <p className="bin-note" role="status">
            Loading
          </p>
        ) : !rows.length ? (
          <p className="bin-note">{history.length ? "No videos match." : "None yet."}</p>
        ) : (
          <ul className="bin-list" aria-label="Recent videos">
            {rows.map((r) => (
              <li key={r.id} className="bin-row" data-job={r.id}>
                <Link to={`/v/${encodeURIComponent(r.id)}`} aria-current={openId === r.id ? "true" : undefined}>
                  <span className="bin-row__title">{r.title}</span>
                  <span className="bin-row__meta">
                    <span className={`state-word${r.state === "error" ? " state-word--bad" : r.state === "done" ? " state-word--good" : ""}`}>{stateWord(r)}</span>
                    <span>{`· ${shortDate(r.createdAt)}`}</span>
                    <span className="visually-hidden">{`, ${brandName(r.brand)}`}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}

export function MakeWorkspace() {
  const route = useRoute();
  const data = useStudioData();
  const jobId = route.params.jobId ?? null;
  const [made, setMade] = useState<JobViewData | null>(null);

  useShortcuts({
    n: () => {
      navigate("/make");
      requestAnimationFrame(() => requestAnimationFrame(() => document.getElementById("brief")?.focus()));
    },
  });

  const composer = useComposer({
    meta: data.meta,
    brands: data.brands,
    brandsError: data.brandsError,
    active: !jobId,
    onMade: (v) => {
      setMade(v);
      void data.loadHistory();
      navigate(`/v/${encodeURIComponent(v.job.id)}`);
      requestAnimationFrame(() => requestAnimationFrame(() => document.getElementById("progress-h")?.focus()));
    },
  });

  useEffect(() => {
    if (!jobId) document.title = "Make a video · Video maker";
  }, [jobId]);

  const bin = { label: "Videos", content: <Bin history={data.history} error={data.historyError} openId={jobId} brands={data.brands} /> };

  if (jobId) return <JobView jobId={jobId} data={data} made={made} bin={bin} />;
  return (
    <AppShell
      workspace="make"
      bin={bin}
      monitor={
        <>
          <div className="toolbar toolbar--plain">
            <ShowPanelButtons bin="Show list" inspector="Show settings" />
          </div>
          {composer.monitor}
        </>
      }
      inspector={{ label: "Video settings", content: composer.inspector }}
    />
  );
}

function JobView({ jobId, data, made, bin }: { jobId: string; data: ReturnType<typeof useStudioData>; made: JobViewData | null; bin: { label: string; content: React.ReactNode } }) {
  const parts = useJobWorkspace({
    jobId,
    meta: data.meta,
    brands: data.brands,
    initial: made,
    onListChange: () => void data.loadHistory(),
    onDeleted: (id) => {
      const list = data.history ?? [];
      const i = list.findIndex((r) => r.id === id);
      const next = list[i + 1] ?? list[i - 1];
      data.setHistory(list.filter((r) => r.id !== id));
      toast("Video deleted");
      navigate("/make", { replace: true });
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          const link = next ? document.querySelector<HTMLElement>(`[data-job="${CSS.escape(next.id)}"] a`) : null;
          (link ?? document.getElementById("history-title"))?.focus();
        }),
      );
    },
  });
  return (
    <AppShell
      workspace="make"
      bin={bin}
      monitor={parts.monitor}
      strip={parts.strip}
      inspector={parts.inspector ? { label: "Inspector", content: parts.inspector } : null}
      status={parts.status}
    />
  );
}
