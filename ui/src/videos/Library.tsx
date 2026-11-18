// Videos (/videos): the full library. Grid or list; the inspector shows the selected video.
import { Button } from "@mantine/core";
import { useEffect, useState } from "react";
import { api, formatBytes, formatDate } from "../shared/api";
import { Link, navigate, setQuery, useRoute } from "../shared/router";
import { AppShell, Panel, Toolbar } from "../shared/studio";
import { toast } from "../shared/ui";
import { ConfirmDelete } from "../make/ConfirmDelete";
import { FILTERS, matchFilter, shortDate, stateWord, useStudioData } from "../make/MakeWorkspace";
import { isBusy, type JobRow, type JobViewData } from "../make/types";

const FORMAT_NAME: Record<string, string> = { "16x9": "Landscape 16:9", "9x16": "Portrait 9:16", "1x1": "Square 1:1" };

export function VideosLibrary() {
  const route = useRoute();
  const data = useStudioData();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<string>("all");
  const [brand, setBrand] = useState("");
  const [sort, setSort] = useState("new");
  const [layout, setLayout] = useState<"grid" | "list">("grid");
  const selectedId = route.query.get("video");

  useEffect(() => {
    document.title = "Videos · Video maker";
  }, []);

  const rows = (data.history ?? [])
    .filter((r) => matchFilter(filter, r.state) && (!brand || r.brand === brand) && (!q || r.title.toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => (sort === "title" ? a.title.localeCompare(b.title) : sort === "old" ? a.createdAt.localeCompare(b.createdAt) : b.createdAt.localeCompare(a.createdAt)));
  const brandName = (id: string) => data.brands.find((b) => b.id === id)?.name ?? id;
  const selected = data.history?.find((r) => r.id === selectedId) ?? null;

  const monitor = (
    <>
      <Toolbar className="library-toolbar">
        <h1 id="videos-h1" tabIndex={-1}>
          Videos
        </h1>
        <div className="library-filters">
          <div className="lib-field">
            <label className="label" htmlFor="lib-search">
              Find a video
            </label>
            <input className="input" id="lib-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="lib-field">
            <label className="label" htmlFor="lib-brand">
              Brand
            </label>
            <select className="select" id="lib-brand" value={brand} onChange={(e) => setBrand(e.target.value)}>
              <option value="">All brands</option>
              {data.brands.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
          <div className="lib-field">
            <label className="label" htmlFor="lib-sort">
              Sort
            </label>
            <select className="select" id="lib-sort" value={sort} onChange={(e) => setSort(e.target.value)}>
              <option value="new">Newest</option>
              <option value="old">Oldest</option>
              <option value="title">Title</option>
            </select>
          </div>
        </div>
        <div className="chips" role="group" aria-label="Show">
          {[...FILTERS, { id: "stopped", label: "Stopped" }].map((f) => (
            <button key={f.id} type="button" className="filter-chip" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
              {f.label}
            </button>
          ))}
        </div>
        <div className="chips" role="group" aria-label="Layout">
          <button type="button" className="filter-chip" aria-pressed={layout === "grid"} onClick={() => setLayout("grid")}>
            Grid
          </button>
          <button type="button" className="filter-chip" aria-pressed={layout === "list"} onClick={() => setLayout("list")}>
            List
          </button>
        </div>
      </Toolbar>
      <div className="library-body">
        {data.historyError ? <p className="bad-text">{data.historyError}</p> : null}
        {!data.history ? (
          <p role="status">Loading</p>
        ) : !rows.length ? (
          <div className="empty-note">
            <p>{data.history.length ? "No videos match." : "No videos yet."}</p>
            <Link to="/make">Make a video</Link>
          </div>
        ) : (
          <ul className={`library library--${layout}`} aria-label={`${rows.length} videos`}>
            {rows.map((r) => (
              <li key={r.id} className="lib-card" data-selected={r.id === selectedId || undefined}>
                <button type="button" className="lib-card__pick" aria-pressed={r.id === selectedId} onClick={() => setQuery({ video: r.id })}>
                  {layout === "grid" ? <Poster id={r.id} state={r.state} /> : null}
                  <span className="lib-card__title">{r.title}</span>
                  <span className="lib-card__meta">
                    <span className={`state-word${r.state === "error" ? " state-word--bad" : r.state === "done" ? " state-word--good" : ""}`}>{stateWord(r)}</span>
                    {` · ${brandName(r.brand)} · ${shortDate(r.createdAt)}`}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );

  return (
    <AppShell
      workspace="videos"
      monitor={monitor}
      inspector={{
        label: "Selected video",
        content: selected ? (
          <Selected
            key={selected.id}
            row={selected}
            brandName={brandName(selected.brand)}
            onDeleted={() => {
              data.setHistory((data.history ?? []).filter((r) => r.id !== selected.id));
              setQuery({ video: null });
              toast("Video deleted");
              requestAnimationFrame(() => document.getElementById("videos-h1")?.focus());
            }}
          />
        ) : (
          <Panel title="Selected video">
            <p className="hint">Choose a video.</p>
          </Panel>
        ),
      }}
    />
  );
}

/** The poster of a ready video (first still), fetched lazily. */
const posterCache = new Map<string, string | null>();
function Poster({ id, state }: { id: string; state: string }) {
  const [src, setSrc] = useState<string | null>(posterCache.get(id) ?? null);
  useEffect(() => {
    if (state !== "done" || posterCache.has(id)) return;
    api<JobViewData>("GET", `/api/jobs/${encodeURIComponent(id)}`)
      .then((v) => {
        const p = v.outputs.find((o) => o.format === "16x9")?.poster ?? v.outputs[0]?.poster ?? null;
        posterCache.set(id, p);
        setSrc(p);
      })
      .catch(() => posterCache.set(id, null));
  }, [id, state]);
  return <span className="lib-card__poster">{src ? <img src={src} alt="" loading="lazy" /> : <span className="lib-card__noposter">{state === "done" ? "" : stateWord({ state })}</span>}</span>;
}

function Selected({ row, brandName, onDeleted }: { row: JobRow; brandName: string; onDeleted: () => void }) {
  const [view, setView] = useState<JobViewData | null>(null);
  const [asking, setAsking] = useState(false);
  useEffect(() => {
    api<JobViewData>("GET", `/api/jobs/${encodeURIComponent(row.id)}`).then(setView).catch(() => setView(null));
  }, [row.id]);
  const poster = view?.outputs[0]?.poster;
  return (
    <Panel title={row.title}>
      <div className="stack-16">
        {poster ? <img className="selected-poster" src={poster} alt="" /> : null}
        <dl className="facts facts--stack">
          <div>
            <dt>Brand</dt>
            <dd>{brandName}</dd>
          </div>
          <div>
            <dt>Made</dt>
            <dd>{formatDate(row.createdAt)}</dd>
          </div>
          <div>
            <dt>State</dt>
            <dd>{stateWord(row)}</dd>
          </div>
          {view?.duration ? (
            <div>
              <dt>Length</dt>
              <dd>{`${Math.round(view.duration)} s`}</dd>
            </div>
          ) : null}
        </dl>
        <Button onClick={() => navigate(`/v/${encodeURIComponent(row.id)}`)}>Open</Button>
        {view?.outputs.length ? (
          <ul className="downloads">
            {view.outputs.map((o) => (
              <li key={o.format}>
                <a className="download" href={o.download} download>{`Download MP4 · ${FORMAT_NAME[o.format] ?? o.format} · ${formatBytes(o.bytes)}`}</a>
              </li>
            ))}
            {view.srt ? (
              <li>
                <a className="download" href={view.srt} download>
                  Download subtitles (SRT)
                </a>
              </li>
            ) : null}
          </ul>
        ) : null}
        {!isBusy(row.state) ? (
          asking ? (
            <ConfirmDelete
              title={row.title}
              onYes={async () => {
                try {
                  await api("DELETE", `/api/jobs/${encodeURIComponent(row.id)}`);
                } catch (e) {
                  return (e as Error).message;
                }
                onDeleted();
              }}
              onCancel={() => setAsking(false)}
            />
          ) : (
            <Button variant="default" className="danger-outline" data-delete={row.id} onClick={() => setAsking(true)}>
              Delete video
            </Button>
          )
        ) : null}
      </div>
    </Panel>
  );
}
