// Make: one video (/v/:id). Progress, error or the finished video in the monitor; the scene strip below;
// Scene, Look and Video tabs in the inspector; staged changes go out with one Remake.
import { Button, Loader, Modal } from "@mantine/core";
import { ArrowClockwise, ArrowSquareOut, ClosedCaptioning, DownloadSimple, FileText, Pause, Play, Plus, SkipBack, SkipForward } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { announce, api, formatBytes, formatDate, plural, type ApiError } from "../shared/api";
import { ProgressBar } from "../shared/motion";
import { Link, navigate, setQuery, useRoute, addNavigationGuard } from "../shared/router";
import { Group, InspectorTabs, ShowPanelButtons, Toolbar, useShortcuts } from "../shared/studio";
import { ErrorSummary, Message, type SummaryItem } from "../shared/ui";
import { ConfirmDelete } from "./ConfirmDelete";
import { SchemeSwatch } from "./Composer";
import { Decision, DIMS, JobError, JobProgress, ORDER, RATIO, SHAPE_WORD, Steps, vttFor } from "./JobView";
import { SceneTab } from "./SceneTab";
import { slotLabel } from "./ScriptEditor";
import { Segmented } from "./Segmented";
import { STATE_TEXT, isBusy, type BrandSummary, type JobViewData, type Meta, type PlanScene } from "./types";
import { useJob } from "./useJob";
import { useStaged, type SceneMotion } from "./useStaged";

const TRANSITION_GLYPH: Record<string, string> = { cut: "|", crossfade: "×", wipe: "▶", push: "»", sweep: "◢", none: "" };

const fmtTime = (t: number) => {
  if (!Number.isFinite(t)) t = 0;
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${String(m).padStart(2, "0")}:${s.toFixed(1).padStart(4, "0")}`;
};

type Tab = "scene" | "look" | "video";

export function useJobWorkspace({ jobId, meta, brands, initial, onListChange, onDeleted }: { jobId: string; meta: Meta | null; brands: BrandSummary[]; initial: JobViewData | null; onListChange: () => void; onDeleted: (id: string) => void }) {
  const route = useRoute();
  const { view, pollError, poll, apply, notify, setNotify } = useJob(jobId, { initial, onStateChange: onListChange });
  const [tab, setTab] = useState<Tab>(() => (new URLSearchParams(location.search).get("scene") ? "scene" : "video"));
  const [retryError, setRetryError] = useState<{ text: string; key: number } | null>(null);
  const [remaking, setRemaking] = useState(false);
  const [summary, setSummary] = useState<{ items: SummaryItem[]; key: number }>({ items: [], key: 0 });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [lookProblems, setLookProblems] = useState<Array<{ scene: number; field: string; message: string }>>([]);
  const [preview, setPreview] = useState<{ url: string; width: number; height: number; scene: number } | null>(null);
  const [icons, setIcons] = useState<string[]>([]);
  const [showChanges, setShowChanges] = useState(false);
  const [askDelete, setAskDelete] = useState(false);
  const [leaveTo, setLeaveTo] = useState<string | null>(null);
  const leaving = useRef(false);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [captions, setCaptions] = useState(true);
  const videoRef = useRef<HTMLVideoElement>(null);
  const carry = useRef<{ time: number; playing: boolean } | null>(null);

  const j = view?.job;
  const busy = j ? isBusy(j.state) : false;
  const done = j?.state === "done";
  const plan = view?.plan ?? null;
  const spec = view?.spec ?? null;
  const schemes = plan?.schemes ?? [];
  const schemeName = (id: string) => schemes.find((s) => s.id === id)?.name ?? id;
  const staged = useStaged(!busy ? spec : null, (i) => `Scene ${i + 1}`, schemeName);
  const editable = Boolean(spec && !busy && meta);
  const hasScript = Boolean(spec?.scenes?.length) || busy;

  const outs = view ? [...view.outputs].sort((a, b) => ORDER.indexOf(a.format) - ORDER.indexOf(b.format)) : [];
  const wantFormat = route.query.get("format");
  const out = outs.find((o) => o.format === wantFormat) ?? outs[0];
  const scenes: PlanScene[] = plan?.scenes ?? [];
  const sceneParam = route.query.get("scene");
  const selected = sceneParam != null && scenes.length ? Math.max(0, Math.min(scenes.length - 1, Number(sceneParam) - 1)) : spec?.scenes?.length && sceneParam != null ? Math.max(0, Number(sceneParam) - 1) : null;
  const playingScene = scenes.findIndex((s, i) => time >= s.start && (i === scenes.length - 1 || time < scenes[i + 1].start));

  // The brand's icons, for the Icon field.
  useEffect(() => {
    if (!j?.brand) return;
    api<string[]>("GET", `/api/icons?brand=${encodeURIComponent(j.brand)}`).then(setIcons).catch(() => {});
  }, [j?.brand]);

  // Selecting a scene opens the Scene tab; nothing selected shows the Video tab.
  useEffect(() => {
    if (!view) return;
    if (selected == null) setTab((t) => (t === "scene" || t === "look" ? "video" : t));
  }, [selected, Boolean(view)]); // eslint-disable-line react-hooks/exhaustive-deps

  // Leave guard while changes are staged.
  useEffect(() => {
    if (!staged.dirty) return;
    const off = addNavigationGuard((to) => {
      if (to.startsWith(`/v/${jobId}`) || leaving.current) return true;
      setLeaveTo(to);
      return false;
    });
    const unload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", unload);
    return () => {
      off();
      window.removeEventListener("beforeunload", unload);
    };
  }, [staged.dirty, staged.changes.length, jobId]);

  // Check look choices with the server as they change.
  useEffect(() => {
    if (!staged.dirty || !staged.built || !staged.lookOnly) {
      setLookProblems([]);
      return;
    }
    const t = window.setTimeout(() => {
      api<{ problems: Array<{ scene: number; field: string; message: string }> }>("POST", `/api/jobs/${encodeURIComponent(jobId)}/look-check`, { spec: staged.built })
        .then((r) => setLookProblems(r.problems ?? []))
        .catch(() => setLookProblems([]));
    }, 300);
    return () => window.clearTimeout(t);
  }, [staged.built, staged.dirty, staged.lookOnly, jobId]);

  function selectScene(i: number | null, opts: { seek?: boolean; tab?: Tab } = {}) {
    setQuery({ scene: i == null ? null : String(i + 1) });
    setPreview(null);
    if (i != null) {
      setTab(opts.tab ?? (tab === "look" ? "look" : "scene"));
      const v = videoRef.current;
      const s = scenes[i];
      if (opts.seek !== false && v && s) v.currentTime = s.start + 0.1;
    }
  }

  function chooseFormat(f: string) {
    const v = videoRef.current;
    if (v) carry.current = { time: v.currentTime, playing: !v.paused && !v.ended };
    setQuery({ format: f });
  }

  function togglePlay() {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
  }

  async function retry() {
    try {
      const v = await api<JobViewData>("POST", `/api/jobs/${encodeURIComponent(jobId)}/retry`);
      setRetryError(null);
      apply(v);
      poll();
      onListChange();
    } catch (e) {
      setRetryError({ text: (e as Error).message, key: Date.now() });
    }
  }

  async function remake() {
    if (remaking || !staged.built || !staged.dirty) return;
    setRemaking(true);
    try {
      const v = await api<JobViewData>("PUT", `/api/jobs/${encodeURIComponent(jobId)}/spec`, { spec: staged.built });
      setFieldErrors({});
      setSummary((s) => ({ items: [], key: s.key + 1 }));
      setPreview(null);
      apply(v);
      staged.reset();
      poll();
      onListChange();
      announce(v.remake === "look" ? "Remake started. Look only." : "Remake started.");
      requestAnimationFrame(() => document.getElementById("progress-h")?.focus());
    } catch (err) {
      const data = (err as ApiError).data;
      const fields: Array<{ scene: number; slot: string; item?: number; message: string }> = data?.fields ?? [];
      const errs: Record<string, string> = {};
      const items: SummaryItem[] = [];
      for (const f of fields) {
        const fid = f.slot === "items" ? `s${f.scene}-items-${f.item ?? 0}` : `s${f.scene}-${f.slot}`;
        errs[fid] = f.message;
        items.push({ text: /^Scene \d/.test(f.message) ? f.message : `Scene ${f.scene + 1}, ${f.slot === "items" ? `Point ${(f.item ?? 0) + 1}` : slotLabel(f.slot)}: ${f.message}`, target: fid });
      }
      for (const p of (data?.problems ?? []) as string[]) if (!items.some((i) => typeof i !== "string" && i.text === p)) items.push(p);
      setFieldErrors(errs);
      if (fields.length) {
        setQuery({ scene: String(fields[0].scene + 1) });
        setTab(/^(scheme|motion)/.test(fields[0].slot) ? "look" : "scene");
      }
      setSummary((s) => ({ items: items.length ? items : [(err as Error).message], key: s.key + 1 }));
    } finally {
      setRemaking(false);
    }
  }

  async function showSchemePreview(i: number, scheme: string) {
    try {
      const r = await api<{ url: string; width: number; height: number }>("POST", `/api/jobs/${encodeURIComponent(jobId)}/scene-preview`, { scene: i, scheme: scheme || undefined, format: out?.format ?? "16x9", spec: staged.built ?? undefined });
      setPreview({ ...r, scene: i });
    } catch {
      setPreview(null);
    }
  }

  async function deleteJob(): Promise<string | void> {
    try {
      await api("DELETE", `/api/jobs/${encodeURIComponent(jobId)}`);
    } catch (e) {
      return (e as Error).message;
    }
    onDeleted(jobId);
  }

  useShortcuts({
    "mod+enter": () => (staged.dirty ? void remake() : false),
    " ": () => (out ? togglePlay() : false),
    k: () => (out ? togglePlay() : false),
    j: () => {
      const v = videoRef.current;
      if (!v) return false;
      v.currentTime = Math.max(0, v.currentTime - 5);
    },
    l: () => {
      const v = videoRef.current;
      if (!v) return false;
      v.currentTime = Math.min(v.duration || 0, v.currentTime + 5);
    },
    c: () => (out ? setCaptions((c) => !c) : false),
    "1": () => (outs[0] ? chooseFormat(outs[0].format) : false),
    "2": () => (outs[1] ? chooseFormat(outs[1].format) : false),
    "3": () => (outs[2] ? chooseFormat(outs[2].format) : false),
    ",": () => (scenes.length ? selectScene(Math.max(0, (selected ?? playingScene ?? 0) - 1)) : false),
    ".": () => (scenes.length ? selectScene(Math.min(scenes.length - 1, (selected ?? playingScene ?? -1) + 1)) : false),
    escape: () => (preview ? setPreview(null) : false),
    "mod+z": () => (staged.dirty ? staged.undoStep() : false),
    "shift+z": () => staged.redoStep(),
  });

  // Captions follow the CC toggle.
  useEffect(() => {
    const v = videoRef.current;
    const t = v?.textTracks?.[0];
    if (t) t.mode = captions ? "showing" : "hidden";
  }, [captions, out?.format]);

  // ── Monitor ──
  const brand = brands.find((b) => b.id === j?.brand);
  const stateTag = j ? (
    <span className={`tag ${j.state === "done" ? "good" : j.state === "error" ? "bad" : busy ? "busy" : ""}`}>
      <span className="tag__text">{STATE_TEXT[j.state] ?? j.state}</span>
    </span>
  ) : null;

  const monitor = (
    <div id="job-videos" className="job-monitor">
      <Toolbar>
        <div id="job-head" className="job-head-bar">
          <h1 id="job-title" tabIndex={-1} title={j?.title}>
            {j?.title ?? "Loading the video"}
          </h1>
          {stateTag}
        </div>
        {outs.length > 1 && done ? (
          <Segmented
            name="video-format"
            legend="Format"
            legendHidden
            className="format-switch"
            value={out?.format ?? ""}
            onChange={chooseFormat}
            options={outs.map((x) => ({
              value: x.format,
              label: (
                <>
                  <span className="visually-hidden">{`${SHAPE_WORD[x.format] ?? ""} `}</span>
                  {RATIO[x.format] ?? x.format}
                </>
              ),
            }))}
          />
        ) : null}
        <ShowPanelButtons bin="Show list" inspector="Show inspector" strip={scenes.length ? "Show scenes" : undefined} />
        <Link to="/make" className="ghost-button new-video-link" aria-keyshortcuts="N">
          <Plus size={18} weight="bold" aria-hidden="true" />
          New video
        </Link>
      </Toolbar>
      <div className="job-monitor__body">
        {pollError && !view ? <ErrorSummary items={[pollError]} focus={false} /> : null}
        {!view && !pollError ? (
          <p className="monitor-note" role="status">
            <Loader size={20} aria-hidden="true" /> Loading
          </p>
        ) : null}
        <div id="job-error">
          {retryError ? <ErrorSummary items={[retryError.text]} focusKey={retryError.key} /> : null}
          {view && j?.state === "error" && j.error ? (
            <div className="monitor-card">
              <JobError
                view={view}
                onRetry={retry}
                onChangeBrief={() => navigate(`/make?from=${encodeURIComponent(jobId)}`)}
                onEditScript={() => {
                  selectScene(0, { seek: false, tab: "scene" });
                  requestAnimationFrame(() => (document.querySelector("#script-form input, #script-form textarea") as HTMLElement | null)?.focus());
                }}
              />
            </div>
          ) : null}
        </div>
        {view && (busy || j?.state === "stopped") ? (
          <div className="monitor-card">
            <JobProgress view={view} onRetry={retry} poll={poll} applyView={apply} notify={notify} setNotify={setNotify} />
          </div>
        ) : null}
        {view && done && out ? (
          preview ? (
            <div className="preview-area">
              <p className="preview-banner">
                <span>Preview. Not remade yet.</span>
                <button type="button" className="ghost-button" onClick={() => setPreview(null)} aria-keyshortcuts="Escape">
                  Back to video
                </button>
              </p>
              <PreviewFrame url={preview.url} width={preview.width} height={preview.height} />
            </div>
          ) : (
            <div className="well">
              <div className={`well__stage well__stage--${out.format}`}>
                <video
                  key={out.format}
                  ref={videoRef}
                  preload="metadata"
                  playsInline
                  poster={out.poster ?? undefined}
                  src={out.url}
                  width={DIMS[out.format]?.[0]}
                  height={DIMS[out.format]?.[1]}
                  data-format={out.format}
                  aria-label={`${SHAPE_WORD[out.format] ?? ""} video`}
                  onClick={togglePlay}
                  onPlay={() => setPlaying(true)}
                  onPause={() => setPlaying(false)}
                  onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
                  onLoadedMetadata={(e) => {
                    const v = e.currentTarget;
                    const t = v.textTracks?.[0];
                    if (t) t.mode = captions ? "showing" : "hidden";
                    const c = carry.current;
                    carry.current = null;
                    if (!c) return;
                    if (c.time > 0 && c.time < v.duration) v.currentTime = c.time;
                    if (c.playing) v.play().catch(() => {});
                  }}
                >
                  {vttFor(view.srt) ? <track kind="captions" src={vttFor(view.srt)!} srcLang="en-GB" label="English captions" default /> : null}
                </video>
              </div>
              <div className="transport">
                <button type="button" className="transport__btn" onClick={() => selectScene(Math.max(0, (selected ?? playingScene ?? 0) - 1))} aria-keyshortcuts=",">
                  <SkipBack size={22} weight="fill" aria-hidden="true" />
                  <span className="visually-hidden">Previous scene</span>
                </button>
                <button type="button" className="transport__btn transport__play" onClick={togglePlay} aria-keyshortcuts="Space K">
                  {playing ? <Pause size={24} weight="fill" aria-hidden="true" /> : <Play size={24} weight="fill" aria-hidden="true" />}
                  <span>{playing ? "Pause" : "Play"}</span>
                </button>
                <button type="button" className="transport__btn" onClick={() => selectScene(Math.min(scenes.length - 1, (selected ?? playingScene ?? -1) + 1))} aria-keyshortcuts=".">
                  <SkipForward size={22} weight="fill" aria-hidden="true" />
                  <span className="visually-hidden">Next scene</span>
                </button>
                <label className="visually-hidden" htmlFor="scrub">
                  Position
                </label>
                <input
                  id="scrub"
                  className="transport__scrub"
                  type="range"
                  min={0}
                  max={view.duration ?? 0}
                  step={0.1}
                  value={time}
                  aria-valuetext={`${Math.round(time)} seconds of ${Math.round(view.duration ?? 0)}`}
                  onChange={(e) => {
                    const v = videoRef.current;
                    if (v) v.currentTime = Number(e.target.value);
                  }}
                />
                <span className="transport__time">{`${fmtTime(time)} / ${fmtTime(view.duration ?? 0)}`}</span>
                <button type="button" className="transport__btn" aria-pressed={captions} onClick={() => setCaptions((c) => !c)} aria-keyshortcuts="C">
                  <ClosedCaptioning size={22} weight={captions ? "fill" : "regular"} aria-hidden="true" />
                  <span>Captions</span>
                </button>
              </div>
            </div>
          )
        ) : null}
      </div>
    </div>
  );

  // ── Strip ──
  const stripScenes: Array<{ i: number; label: string; text: string; plan?: PlanScene }> = scenes.length
    ? scenes.map((s, i) => ({ i, label: s.label, text: firstLine(spec?.scenes?.[i]), plan: s }))
    : (spec?.scenes ?? []).map((s: any, i: number) => ({ i, label: meta?.scenes.find((d) => d.type === s.type)?.label ?? s.type, text: firstLine(s) }));
  const total = view?.duration ?? scenes.reduce((a, s) => a + s.duration, 0);
  const changedScene = (i: number) => staged.changes.some((c) => c.key.slice(1) === String(i) && /^[wsm]/.test(c.key));
  const problemCount = (i: number) => Object.keys(fieldErrors).filter((k) => k.startsWith(`s${i}-`)).length + lookProblems.filter((p) => p.scene === i).length + (scenes[i]?.problems?.length ?? 0);

  const strip = stripScenes.length ? (
    <div className="strip">
      <div className="strip__head">
        <h2 className="strip__title">Scenes</h2>
        {busy ? <span className="hint">You can edit when it’s finished.</span> : null}
      </div>
      <div
        className="strip__clips"
        role="listbox"
        aria-orientation="horizontal"
        aria-label="Scenes"
        onKeyDown={(e) => {
          const at = selected ?? 0;
          let n = -1;
          if (e.key === "ArrowRight") n = Math.min(stripScenes.length - 1, at + 1);
          else if (e.key === "ArrowLeft") n = Math.max(0, at - 1);
          else if (e.key === "Home") n = 0;
          else if (e.key === "End") n = stripScenes.length - 1;
          else if (e.key === "Enter" && selected != null) {
            videoRef.current?.play().catch(() => {});
            e.preventDefault();
            return;
          }
          if (n < 0) return;
          e.preventDefault();
          selectScene(n);
          requestAnimationFrame(() => document.getElementById(`clip-${n}`)?.focus());
        }}
      >
        {stripScenes.map((c, k) => {
          const p = c.plan;
          const sch = p?.scheme ? schemes.find((s) => s.id === p.scheme) : null;
          const staging = staged.state?.schemes[c.i];
          const schemeShown = staging !== undefined ? (staging ? schemeName(staging) : "Auto") : sch ? `${sch.name}${p?.schemeAuto ? "" : ""}` : "";
          const width = p && total ? Math.max(140, Math.round((p.duration / total) * 1400)) : 160;
          const probs = problemCount(c.i);
          const isSel = selected === c.i;
          return (
            <div className="strip__item" key={c.i}>
              {k > 0 && p?.transitionIn && p.transitionIn !== "none" ? (
                <button
                  type="button"
                  className="transition-marker"
                  aria-label={`Transition into scene ${c.i + 1}: ${meta?.motion?.transitions.find((t) => t.id === p.transitionIn)?.label ?? p.transitionIn}`}
                  title={meta?.motion?.transitions.find((t) => t.id === p.transitionIn)?.label ?? p.transitionIn}
                  tabIndex={-1}
                  onClick={() => selectScene(c.i, { tab: "look" })}
                >
                  <span aria-hidden="true">{TRANSITION_GLYPH[p.transitionIn] ?? "·"}</span>
                </button>
              ) : null}
              <div
                id={`clip-${c.i}`}
                role="option"
                className="clip"
                aria-selected={isSel}
                aria-current={done && playingScene === c.i && playing ? "true" : undefined}
                tabIndex={isSel || (selected == null && k === 0) ? 0 : -1}
                style={{ width }}
                aria-label={`Scene ${c.i + 1} of ${stripScenes.length}, ${c.label}${schemeShown ? `, ${schemeShown}` : ""}${p ? `, ${p.duration.toFixed(1)} seconds` : ""}${changedScene(c.i) ? ", changed" : ""}${probs ? `, ${plural(probs, "problem")}` : ""}`}
                onClick={() => selectScene(c.i)}
              >
                {p?.stills?.[out?.format ?? "16x9"] && !busy ? <span className="clip__still" aria-hidden="true" style={{ backgroundImage: `url("${p.stills[out?.format ?? "16x9"]!}")`, backgroundColor: sch?.vars?.["--bg"] }} /> : <span className="clip__text">{c.text}</span>}
                <span className="clip__foot">
                  <span className="clip__name">{`${c.i + 1} · ${c.label}`}</span>
                  {schemeShown ? (
                    <span className="clip__scheme">
                      <SchemeSwatch vars={(staging ? schemes.find((s) => s.id === staging) : sch)?.vars} size={18} />
                      {schemeShown}
                    </span>
                  ) : null}
                </span>
                {changedScene(c.i) ? <span className="clip__badge">Changed</span> : null}
                {probs ? <span className="clip__badge clip__badge--bad">{`! ${plural(probs, "problem")}`}</span> : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  ) : null;

  // ── Inspector ──
  const sceneIndex = selected ?? 0;
  const ps = scenes[sceneIndex];
  const sceneHeader =
    editable && spec?.scenes?.[sceneIndex] ? (
      <div className="scene-head">
        <h2 className="scene-head__title">{`Scene ${sceneIndex + 1} · ${ps?.label ?? spec.scenes[sceneIndex].type}${ps ? ` · ${ps.duration.toFixed(1)} s` : ""}`}</h2>
        <div className="scene-head__nav">
          <button type="button" className="ghost-button" disabled={sceneIndex === 0} onClick={() => selectScene(sceneIndex - 1)} aria-keyshortcuts=",">
            Previous
          </button>
          <button type="button" className="ghost-button" disabled={sceneIndex >= spec.scenes.length - 1} onClick={() => selectScene(sceneIndex + 1)} aria-keyshortcuts=".">
            Next
          </button>
        </div>
      </div>
    ) : null;

  const sceneTab =
    editable && meta ? (
      selected == null ? (
        <p className="hint">Choose a scene in the strip.</p>
      ) : (
        <>
          {sceneHeader}
          <SceneTab index={sceneIndex} spec={spec} meta={meta} staged={staged} fieldErrors={fieldErrors} icons={icons} />
        </>
      )
    ) : (
      <p className="hint">{busy ? "You can edit when it’s finished." : "Nothing to edit yet."}</p>
    );

  const sceneScheme = staged.state?.schemes[sceneIndex] ?? spec?.scenes?.[sceneIndex]?.scheme ?? "";
  const sceneMotion: SceneMotion = staged.state?.motion[sceneIndex] ?? spec?.scenes?.[sceneIndex]?.motion ?? {};
  const motionMeta = meta?.motion;
  const styleLabel = (id?: string) => motionMeta?.styles.find((s) => s.id === id)?.label ?? "Brand";
  const optLabel = (list: Array<{ id: string; label: string }> | undefined, id?: string) => list?.find((x) => x.id === id)?.label ?? id ?? "None";
  const autoScheme = ps?.schemeAuto ? schemeName(ps.scheme ?? "") : null;
  const sceneLookProblems = lookProblems.filter((p) => p.scene === sceneIndex);

  const lookTab =
    editable && selected != null ? (
      <>
        {sceneHeader}
        <fieldset className="field">
          <legend className="label">Colour scheme</legend>
          <div className="scheme-picks" role="radiogroup" aria-label="Colour scheme">
            <label className="scheme-pick" htmlFor={`sc-${sceneIndex}-auto`}>
              <input
                type="radio"
                name={`sc-${sceneIndex}`}
                id={`sc-${sceneIndex}-auto`}
                checked={!sceneScheme}
                onChange={() => {
                  staged.update((s) => void (s.schemes[sceneIndex] = ""));
                  void showSchemePreview(sceneIndex, "");
                }}
              />
              <span className="scheme-pick__card scheme-pick__card--auto" aria-hidden="true">
                Auto
              </span>
              <span className="scheme-pick__name">{autoScheme ? `Auto (${autoScheme})` : "Auto"}</span>
            </label>
            {schemes.map((s) => (
              <label key={s.id} className="scheme-pick" htmlFor={`sc-${sceneIndex}-${s.id}`} data-off={!s.usable || undefined}>
                <input
                  type="radio"
                  name={`sc-${sceneIndex}`}
                  id={`sc-${sceneIndex}-${s.id}`}
                  checked={sceneScheme === s.id}
                  disabled={!s.usable}
                  onChange={() => {
                    staged.update((st) => void (st.schemes[sceneIndex] = s.id));
                    void showSchemePreview(sceneIndex, s.id);
                  }}
                />
                <span className="scheme-pick__card" style={{ background: s.vars["--bg"], color: s.vars["--fg"] }} aria-hidden="true">
                  <span className="scheme-pick__a">Aa</span>
                  <span className="scheme-pick__bar" style={{ background: s.vars["--hl"] }} />
                </span>
                <span className="scheme-pick__name">{s.name}</span>
                {!s.usable ? <span className="hint">Needs fixing in the brand</span> : null}
              </label>
            ))}
          </div>
        </fieldset>
        <Group title="Motion" defaultOpen={Boolean(spec?.scenes?.[sceneIndex]?.motion)} id={`scene-${sceneIndex}-motion`}>
          {(
            [
              ["entrance", "Entrance", motionMeta?.entrances],
              ["transition", "Transition in", motionMeta?.transitions],
              ["text", "Text effect", motionMeta?.textEffects?.filter((t) => t.scenes === "any" || !t.scenes || (Array.isArray(t.scenes) && t.scenes.includes(spec.scenes[sceneIndex].type)))],
              ["shape", "Shape", motionMeta?.shapes],
            ] as const
          ).map(([key, label, list]) => {
            const id = `m-${sceneIndex}-${key}`;
            const cur = (sceneMotion as Record<string, string | undefined>)[key] ?? "";
            const planVal = key === "transition" ? ps?.transitionIn : (ps?.motion as Record<string, string | undefined> | undefined)?.[key];
            const prob = sceneLookProblems.find((p) => p.field === `motion.${key}`) ?? (fieldErrors[`s${sceneIndex}-motion.${key}`] ? { message: fieldErrors[`s${sceneIndex}-motion.${key}`] } : null);
            return (
              <div className="field" key={key} data-error={prob ? "true" : undefined}>
                <label className="label" htmlFor={id}>
                  {label}
                </label>
                {prob ? (
                  <p className="error-msg" id={`${id}-error`}>
                    <span className="visually-hidden">Error: </span>
                    {prob.message}
                  </p>
                ) : null}
                <select className="select" id={id} value={cur} aria-describedby={prob ? `${id}-error` : undefined} onChange={(e) => staged.update((s) => void (s.motion[sceneIndex] = { ...sceneMotion, [key]: e.target.value }))}>
                  <option value="">{`Video style (${optLabel(list as Array<{ id: string; label: string }>, planVal)})`}</option>
                  {(list ?? []).map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
            );
          })}
        </Group>
      </>
    ) : (
      <p className="hint">{editable ? "Choose a scene in the strip." : busy ? "You can edit when it’s finished." : "Nothing to change yet."}</p>
    );

  const look = staged.state?.look ?? view?.look ?? spec?.look ?? {};
  const setLook = (patch: Record<string, unknown>) => staged.update((s) => void (s.look = { ...(s.look ?? spec?.look ?? {}), ...patch }));

  const videoTab = view ? (
    <div className="video-tab">
      {j?.notes?.length ? (
        <Group title="To check" defaultOpen id="to-check" meta={String(j.notes.length)}>
          <ul className="check-list">
            {j.notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </Group>
      ) : null}
      {done && (outs.length || view.srt) ? (
        <section className="group" aria-labelledby="videos-title">
          <h2 className="group__h-static" id="videos-title" tabIndex={-1}>
            Downloads
          </h2>
          <ul className="downloads">
            {out ? (
              <li>
                <a className="download" href={out.download} download>
                  <DownloadSimple size={22} weight="bold" aria-hidden="true" />
                  <span>{`Download MP4 · ${SHAPE_WORD[out.format]} ${RATIO[out.format]} · ${formatBytes(out.bytes)}`}</span>
                </a>
              </li>
            ) : null}
            {view.srt ? (
              <li id="job-subtitles">
                <a className="download" href={view.srt} download>
                  <FileText size={22} weight="bold" aria-hidden="true" />
                  Download subtitles (SRT)
                </a>
              </li>
            ) : null}
          </ul>
          <p className="tag-line">
            <span className="tag">
              <span className="tag__text">Stand-in voice</span>
            </span>
          </p>
          {outs.length > 1 ? (
            <div className="other-formats">
              <p className="small-h">Other formats</p>
              <ul className="plain-list">
                {outs
                  .filter((o) => o.format !== out?.format)
                  .map((o) => (
                    <li key={o.format}>
                      <a href={o.download} download>{`${SHAPE_WORD[o.format]} ${RATIO[o.format]} MP4 · ${formatBytes(o.bytes)}`}</a>
                    </li>
                  ))}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}
      {editable && staged.state ? (
        <section className="group">
          <div className="field">
            <label className="label" htmlFor="video-title">
              Title
            </label>
            <p className="hint" id="video-title-hint">
              File names only.
            </p>
            <input className="input" id="video-title" type="text" aria-describedby="video-title-hint" value={staged.state.draft.title} onChange={(e) => staged.update((s) => void (s.draft.title = e.target.value))} />
          </div>
        </section>
      ) : null}
      {editable ? (
        <Group title="Look for the whole video" id="video-look">
          <fieldset className="field">
            <legend className="label">Colour</legend>
            <div className="choices">
              <label className="choice" htmlFor="vl-mix">
                <input type="radio" name="vl-colour" id="vl-mix" checked={look.schemes !== "single"} onChange={() => setLook({ schemes: "spread", scheme: null })} />
                <span>Mix the brand’s schemes</span>
              </label>
              <label className="choice" htmlFor="vl-one">
                <input type="radio" name="vl-colour" id="vl-one" checked={look.schemes === "single"} onChange={() => setLook({ schemes: "single", scheme: look.scheme ?? schemes.find((s) => s.usable)?.id ?? null })} />
                <span>One scheme</span>
              </label>
            </div>
          </fieldset>
          {look.schemes === "single" ? (
            <div className="field">
              <label className="label" htmlFor="vl-scheme">
                Scheme
              </label>
              <select className="select" id="vl-scheme" value={look.scheme ?? ""} onChange={(e) => setLook({ scheme: e.target.value })}>
                {schemes
                  .filter((s) => s.usable)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
              </select>
            </div>
          ) : null}
          <div className="field">
            <label className="label" htmlFor="vl-style">
              Motion style
            </label>
            <select className="select" id="vl-style" value={look.motionStyle ?? ""} onChange={(e) => setLook({ motionStyle: e.target.value || null })}>
              <option value="">Brand style</option>
              {motionMeta?.styles.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            className="ghost-button"
            onClick={() =>
              staged.update((s) => {
                spec.scenes.forEach((_: unknown, i: number) => {
                  s.schemes[i] = "";
                  s.motion[i] = {};
                });
              })
            }
          >
            Reset scenes to Auto
          </button>
          <p className="hint">{`Now: ${styleLabel(plan?.scenes?.[0]?.motion?.style)} motion`}</p>
        </Group>
      ) : null}
      {view.decision ? (
        <Group title="Length" id="video-length" meta={view.duration ? `${Math.round(view.duration)} s` : undefined}>
          <Decision view={view} />
        </Group>
      ) : null}
      {view.sheet ? (
        <Group title="Files" id="video-files">
          <p className="sheet">
            <a href={view.sheet} target="_blank" rel="noopener">
              <img src={view.sheet} alt="Contact sheet: one still of each scene in each format." />
              <span className="sheet__open">
                <ArrowSquareOut size={20} weight="bold" aria-hidden="true" />
                Open contact sheet<span className="visually-hidden"> (new tab)</span>
              </span>
            </a>
          </p>
        </Group>
      ) : null}
      <Group title="Brief" id="video-brief">
        <p className="brief-text">{j?.brief || "No brief was saved."}</p>
        <p>
          <a
            href={`/make?from=${encodeURIComponent(jobId)}`}
            onClick={(e) => {
              e.preventDefault();
              navigate(`/make?from=${encodeURIComponent(jobId)}`);
            }}
          >
            Make a new video from this brief
          </a>
        </p>
      </Group>
      {!busy ? (
        <Group title="Steps" id="video-steps">
          <Steps view={view} />
          <p className="progress-text">{`${Math.round((j?.progress ?? 0) * 100)}% complete`}</p>
          <ProgressBar value={Math.round((j?.progress ?? 0) * 100)} label="Progress" className="job-bar" />
        </Group>
      ) : null}
      <p className="hint video-meta">{`${brand?.name ?? j?.brand ?? ""} · ${j ? formatDate(j.createdAt) : ""}`}</p>
      {!busy ? (
        <div className="video-delete">
          {askDelete ? (
            <ConfirmDelete
              title={j?.title ?? ""}
              onYes={deleteJob}
              onCancel={() => {
                setAskDelete(false);
                requestAnimationFrame(() => document.getElementById("delete-video")?.focus());
              }}
            />
          ) : (
            <Button id="delete-video" variant="default" className="danger-outline" onClick={() => setAskDelete(true)}>
              Delete video
            </Button>
          )}
        </div>
      ) : null}
    </div>
  ) : null;

  const tray =
    staged.dirty && editable ? (
      <div className="change-tray" role="region" aria-label="Changes">
        <p className="change-tray__count">{plural(staged.changes.length, "change")}</p>
        <p className="change-tray__line">{staged.lookOnly ? "Look only: voice and timing stay." : "Words changed: unchanged lines keep their voice."}</p>
        <button type="button" className="ghost-button" aria-expanded={showChanges} aria-controls="change-list" onClick={() => setShowChanges((s) => !s)}>
          {showChanges ? "Hide changes" : "Show changes"}
        </button>
        {showChanges ? (
          <ul className="change-list" id="change-list">
            {staged.changes.map((c) => (
              <li key={c.key}>
                <span>{c.text}</span>
                <button type="button" className="ghost-button" onClick={c.undo}>
                  Undo<span className="visually-hidden">{` ${c.text}`}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="buttons">
          <Button variant="default" onClick={() => staged.reset()}>
            Undo all
          </Button>
          <Button onClick={() => void remake()} aria-keyshortcuts="Control+Enter Meta+Enter" aria-disabled={remaking || undefined} leftSection={remaking ? <Loader size={18} color="#fff" aria-hidden="true" /> : <ArrowClockwise size={20} weight="bold" aria-hidden="true" />}>
            {remaking ? "Checking it fits" : "Remake"}
          </Button>
        </div>
      </div>
    ) : null;

  const leaveDialog = (
    <Modal opened={leaveTo != null} onClose={() => setLeaveTo(null)} title={`Discard ${plural(staged.changes.length, "change")}?`} size="md">
      <p>The video stays as it is.</p>
      <div className="buttons">
        <Button
          className="danger"
          color="red"
          onClick={() => {
            const to = leaveTo;
            setLeaveTo(null);
            staged.reset();
            leaving.current = true;
            if (to) navigate(to);
            leaving.current = false;
          }}
        >
          Discard
        </Button>
        <Button variant="default" data-autofocus onClick={() => setLeaveTo(null)}>
          Keep editing
        </Button>
      </div>
    </Modal>
  );

  const inspector = (
    <div className="inspector-col">
      {leaveDialog}
      {summary.items.length ? (
        <div className="inspector-errors">
          <ErrorSummary items={summary.items} focusKey={summary.key} />
        </div>
      ) : null}
      <div className="inspector-col__tabs">
        <InspectorTabs
          value={hasScript ? tab : "video"}
          onChange={(t) => {
            setTab(t as Tab);
            if ((t === "scene" || t === "look") && selected == null && spec?.scenes?.length) setQuery({ scene: "1" });
          }}
          tabs={[
            // Scene and Look only once there is a script (or one is on its way); a brief that stopped early has nothing to edit.
            ...(hasScript
              ? [
                  { id: "scene", label: "Scene", content: sceneTab },
                  { id: "look", label: "Look", content: lookTab },
                ]
              : []),
            { id: "video", label: "Video", badge: j?.notes?.length || null, content: videoTab },
          ]}
        />
      </div>
      {tray}
    </div>
  );

  const pct = Math.round((j?.progress ?? 0) * 100);
  const status = j ? (
    <>
      <span>{busy ? (j.state === "queued" ? "Waiting" : `${STATE_TEXT[j.state]} · ${pct - (pct % 10)}%`) : STATE_TEXT[j.state]}</span>
      {view?.duration && done ? <span>{`${Math.round(view.duration)} s`}</span> : null}
      {outs.length ? <span>{plural(outs.length, "format")}</span> : null}
      {brand ? <span>{brand.name}</span> : null}
      {j.notes?.length ? (
        <button
          type="button"
          className="ghost-button status-btn"
          onClick={() => {
            setTab("video");
            requestAnimationFrame(() => (document.querySelector("#to-check .group__toggle") as HTMLElement | null)?.focus());
          }}
        >
          {`${j.notes.length} to check`}
        </button>
      ) : null}
      {staged.dirty ? <span className="status-right">{`${plural(staged.changes.length, "change")} · Remake with Ctrl+Enter`}</span> : null}
    </>
  ) : (
    <span>Loading</span>
  );

  return { monitor, strip, inspector: view ? inspector : null, status, view };
}

function firstLine(s: any): string {
  if (!s) return "";
  const slots = s.slots ?? {};
  for (const k of ["title", "heading", "text", "quote", "value", "action"]) if (typeof slots[k] === "string" && slots[k]) return slots[k];
  if (Array.isArray(slots.items) && slots.items[0]) return slots.items[0].text ?? slots.items[0].label ?? "";
  return (s.voiceover ?? [])[0] ?? "";
}

/** A same-origin page (one still) scaled to fit the space it has, whole and centred. */
function PreviewFrame({ url, width, height }: { url: string; width: number; height: number }) {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.4);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => setScale(Math.max(0.05, Math.min(el.clientWidth / width, (el.clientHeight || 9999) / height)));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [width, height]);
  return (
    <div className="preview-stage" ref={box}>
      <div className="preview-frame" style={{ width: Math.floor(width * scale), height: Math.floor(height * scale) }}>
        <iframe src={url} title="Preview of this scene" width={width} height={height} style={{ transform: `scale(${scale})` }} tabIndex={-1} />
      </div>
    </div>
  );
}

export { Message };
