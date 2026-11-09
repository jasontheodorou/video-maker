// Make a video, one column: the brief (with options folded away), then the open video, then every video so far.
// Once a video is open the brief folds into a "New video" button, so the page shows one thing at a time.
import { Button, Loader, Skeleton } from "@mantine/core";
import { ArrowRight, CaretRight, CheckCircle, Plus, Trash, UploadSimple, WarningCircle, X } from "@phosphor-icons/react";
import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import { announce, api, formatBytes, plural } from "../shared/api";
import { AnimatedItem, AnimatedList, Collapse, Reveal, spring, transition } from "../shared/motion";
import { CharCount, ErrorSummary, Field, PageHeader, Shell, Tag, countShown, describedBy, toast, type SummaryItem } from "../shared/ui";
import { ConfirmDelete } from "./ConfirmDelete";
import { JobView } from "./JobView";
import { Segmented } from "./Segmented";
import { STATE_TEXT, STATE_TONE, isBusy, type BrandSummary, type Job, type JobRow, type JobViewData, type Meta } from "./types";

const BRIEF_MAX = 20000;
/** The brief's character count appears once this few characters are left. */
const BRIEF_COUNT_WITHIN = 1000;
const HISTORY_FIRST = 12;
const MEDIA_MAX = 12;
const MEDIA_ACCEPT = ".jpg,.jpeg,.png,.webp,.mp4,.mov,.m4v,.webm,image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm";
const MEDIA_TYPE = /\.(jpe?g|png|webp|mp4|mov|m4v|webm)$/i;

/** Short example briefs under the brief box, for the sample council. */
const EXAMPLES = [
  {
    label: "Bin collections",
    text: "From Monday 12 January, Northvale Council will collect garden waste bins every two weeks instead of every week. Tell residents in a short video. They can check their new collection day at northvale.example/bins.",
  },
  {
    label: "Library hours",
    text: "From 2 February, the Northvale library on Castle Street will open on Sundays from 10am to 4pm. Tell residents in a short video for social media. They can find out more at northvale.example/libraries.",
  },
  {
    label: "Bus pass",
    text: "Older and disabled residents in Northvale can now apply for a free bus pass online. It takes about 10 minutes. Tell people how in a short video. Apply at northvale.example/buspass.",
  },
];

const APP_NAME = "Video maker";
const ENDED_TITLE: Record<string, string> = { done: "✓ Ready", error: "Problem", stopped: "Stopped" };

/** Send one quiet browser notification, if allowed. Never throws (some browsers only allow them from a service worker). */
function notifyEnded(job: Job) {
  try {
    if (!("Notification" in window) || Notification.permission !== "granted" || !document.hidden) return;
    const n = new Notification(job.state === "done" ? "Your video is ready" : "There was a problem making your video", { body: job.title, tag: job.id, silent: true });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch {
    /* not supported here: the tab title still says it */
  }
}

/** The job named in the address, read once before the first render so a shared link never flashes the form. */
const jobInAddress = () => new URLSearchParams(location.search).get("job");

/** "9 Nov at 2:41pm" this year, "9 Nov 2025" before: short enough for one line on a phone. */
function shortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const thisYear = d.getFullYear() === new Date().getFullYear();
  const date = d.toLocaleDateString("en-GB", thisYear ? { day: "numeric", month: "short" } : { day: "numeric", month: "short", year: "numeric" });
  if (!thisYear) return date;
  const h = d.getHours();
  const m = d.getMinutes();
  return `${date} at ${h % 12 || 12}:${String(m).padStart(2, "0")}${h < 12 ? "am" : "pm"}`;
}

/** Load the brand list, trying again a few times: a server that has just started can be slow to answer. */
async function loadBrandsWithRetry(onWait: (t: string) => void): Promise<BrandSummary[]> {
  let last: Error | null = null;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const brands = await api<BrandSummary[]>("GET", "/api/brands");
      if (Array.isArray(brands) && brands.length) return brands;
      last = new Error("No brands were found. Add one on the Brands page.");
    } catch (e) {
      last = e as Error;
    }
    if (attempt < 4) {
      onWait("Still loading brands. Trying again.");
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
  throw last;
}

function remembered(): string | null {
  try {
    return localStorage.getItem("va-brand");
  } catch {
    return null;
  }
}

/** The shape of each format, drawn small: a quick way to see landscape, portrait and square. */
function FormatShape({ w, h }: { w: number; h: number }) {
  const scale = 28 / Math.max(w, h);
  return (
    <span className="format-shape" aria-hidden="true">
      <span style={{ width: Math.round(w * scale), height: Math.round(h * scale) }} />
    </span>
  );
}

/** Run a function once the browser has painted twice: after React commits and any inert region opens. */
const afterPaint = (fn: () => void) => requestAnimationFrame(() => requestAnimationFrame(fn));

export function MakePage() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [brands, setBrands] = useState<BrandSummary[]>([]);
  const [brandStatus, setBrandStatus] = useState("Loading brands.");
  const [summary, setSummary] = useState<{ items: SummaryItem[]; key: number }>({ items: [], key: 0 });

  // The form.
  const [brief, setBrief] = useState("");
  const [brand, setBrand] = useState("");
  const [voice, setVoice] = useState("");
  const [formats, setFormats] = useState<string[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [descriptions, setDescriptions] = useState<string[]>([]);
  const [errors, setErrors] = useState<{ brief?: string; formats?: string; brand?: string }>({});
  const [sending, setSending] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(() => !jobInAddress());
  const [dragOver, setDragOver] = useState(false);
  const [filled, setFilled] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  // The open job.
  const [jobId, setJobId] = useState<string | null>(jobInAddress);
  const [view, setView] = useState<JobViewData | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);
  const jobIdRef = useRef<string | null>(jobId);
  const timerRef = useRef<number | undefined>(undefined);
  const lastStateRef = useRef<string | null>(null);
  const focusOnLoad = useRef<"title" | "progress" | false>(false);
  // Jobs to send a browser notification for when they end, and the tab title's "✓ Ready" until the person is back.
  const [notifyIds, setNotifyIds] = useState<Set<string>>(() => new Set());
  const notifyRef = useRef(notifyIds);
  notifyRef.current = notifyIds;
  const [endedTitle, setEndedTitle] = useState<string | null>(null);

  // Every video made so far.
  const [history, setHistory] = useState<JobRow[] | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [filter, setFilter] = useState<"all" | "done">("all");

  const loadHistory = useCallback(async () => {
    try {
      setHistory(await api<JobRow[]>("GET", "/api/jobs"));
      setHistoryError(null);
    } catch (e) {
      setHistoryError((e as Error).message);
    }
  }, []);

  const applyView = useRef<(v: JobViewData) => void>(() => {});
  applyView.current = (v: JobViewData) => {
    setPollError(null);
    const before = lastStateRef.current;
    lastStateRef.current = v.job.state;
    setView(v);
    if (before && before !== v.job.state) {
      loadHistory();
      if (v.job.state === "done") announce("Your video is ready.");
      if (v.job.state === "error") announce("There was a problem making the video.");
      // Watched it finish: say so in the tab title, and in a notification if asked for.
      if (isBusy(before) && !isBusy(v.job.state)) {
        setEndedTitle(ENDED_TITLE[v.job.state] ?? null);
        if (notifyRef.current.has(v.job.id)) {
          if (v.job.state !== "stopped") notifyEnded(v.job);
          setNotifyIds((cur) => {
            const next = new Set(cur);
            next.delete(v.job.id);
            return next;
          });
        }
      }
    }
  };

  const poll = useCallback(async () => {
    window.clearTimeout(timerRef.current);
    const id = jobIdRef.current;
    if (!id) return;
    try {
      const v = await api<JobViewData>("GET", `/api/jobs/${encodeURIComponent(id)}`);
      if (id !== jobIdRef.current) return;
      applyView.current(v);
      if (isBusy(v.job.state)) timerRef.current = window.setTimeout(poll, 1000);
    } catch (e) {
      if (id !== jobIdRef.current) return;
      setPollError((e as Error).message);
      timerRef.current = window.setTimeout(poll, 3000);
    }
  }, []);

  const openJob = useCallback(
    (id: string, focus: "title" | "progress" | false, initial?: JobViewData) => {
      jobIdRef.current = id;
      lastStateRef.current = initial?.job.state ?? null;
      setEndedTitle(null);
      focusOnLoad.current = focus;
      setJobId(id);
      setView(initial ?? null);
      setPollError(null);
      setFormOpen(false);
      // An old error summary would point into the folded form, so it goes with it.
      setSummary((s) => (s.items.length ? { items: [], key: s.key + 1 } : s));
      setErrors({});
      const url = new URL(location.href);
      url.searchParams.set("job", id);
      window.history.replaceState(null, "", url);
      poll();
    },
    [poll],
  );

  /** Close the open job (after it is deleted): back to the list, with the address tidied. */
  const closeJob = useCallback(() => {
    window.clearTimeout(timerRef.current);
    jobIdRef.current = null;
    lastStateRef.current = null;
    setJobId(null);
    setView(null);
    setPollError(null);
    setEndedTitle(null);
    const url = new URL(location.href);
    url.searchParams.delete("job");
    window.history.replaceState(null, "", url);
  }, []);

  /** Delete a video. Returns the server's message if it could not be deleted. */
  async function deleteJob(id: string): Promise<string | void> {
    try {
      await api("DELETE", `/api/jobs/${encodeURIComponent(id)}`);
    } catch (e) {
      return (e as Error).message;
    }
    setHistory((h) => (h ? h.filter((r) => r.id !== id) : h));
    if (id === jobIdRef.current) {
      closeJob();
      afterPaint(() => focusJob("history-title"));
    }
    toast("Video deleted");
  }

  // The tab title: progress while a video is being made, then how it ended until the person is back.
  const baseTitle = useRef(document.title);
  const tabJob = jobId && view?.job.id === jobId ? view.job : null;
  const tabTitle = tabJob && tabJob.state === "running" ? `${Math.round((tabJob.progress ?? 0) * 100)}% · ${APP_NAME}` : tabJob && tabJob.state === "queued" ? `Waiting · ${APP_NAME}` : endedTitle ? `${endedTitle} · ${APP_NAME}` : baseTitle.current;
  useEffect(() => {
    document.title = tabTitle;
  }, [tabTitle]);
  useEffect(() => () => void (document.title = baseTitle.current), []);
  useEffect(() => {
    if (!endedTitle) return;
    const clear = () => setEndedTitle(null);
    // Watching already: let the title say it for a moment. Away: keep it until they come back.
    if (!document.hidden && document.hasFocus()) {
      const t = window.setTimeout(clear, 6000);
      return () => window.clearTimeout(t);
    }
    const onVisible = () => {
      if (!document.hidden) clear();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", clear);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", clear);
    };
  }, [endedTitle]);

  function setNotify(on: boolean) {
    const id = jobIdRef.current;
    if (!id) return;
    setNotifyIds((cur) => {
      const next = new Set(cur);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function fillExample(text: string) {
    setBrief(text);
    setFilled((n) => n + 1);
    setErrors((e) => (e.brief ? { ...e, brief: undefined } : e));
    const box = document.getElementById("brief") as HTMLTextAreaElement | null;
    if (box) {
      box.focus();
      requestAnimationFrame(() => box.setSelectionRange(text.length, text.length));
    }
  }

  // Bring the job into view and give it focus once it has loaded, so the progress is in view.
  useEffect(() => {
    if (!view || !focusOnLoad.current) return;
    const target = focusOnLoad.current;
    focusOnLoad.current = false;
    focusJob(target === "progress" ? "progress-h" : "job-title");
  }, [view]);

  // Start: any job named in the address straight away, then meta and brands, then the list of videos.
  useEffect(() => {
    const id = jobInAddress();
    if (id) openJob(id, false);
    (async () => {
      try {
        const [m, b] = await Promise.all([api<Meta>("GET", "/api/meta"), loadBrandsWithRetry(setBrandStatus)]);
        setMeta(m);
        setBrands(b);
        setFormats(m.formats.map((f) => f.id));
        const want = remembered();
        setBrand(b.find((x) => x.id === want) ? want! : b.find((x) => x.id === "demo") ? "demo" : (b[0]?.id ?? ""));
        setBrandStatus("");
      } catch (e) {
        setBrandStatus("");
        setSummary((s) => ({ items: [(e as Error).message], key: s.key + 1 }));
        return;
      }
      await loadHistory();
    })();
    return () => window.clearTimeout(timerRef.current);
  }, [loadHistory, openJob]);

  const current = brands.find((b) => b.id === brand);
  useEffect(() => {
    if (!current) return;
    try {
      localStorage.setItem("va-brand", current.id);
    } catch {
      /* no storage */
    }
  }, [current]);

  const brandVoice = meta?.voices.find((v) => v.id === current?.voice);
  const voiceLabel = voice ? meta?.voices.find((v) => v.id === voice)?.label : null;

  /** Add chosen or dropped files to the list (the same file twice is kept once). */
  function addFiles(list: FileList | File[] | null) {
    const incoming = list ? [...list].filter((f) => MEDIA_TYPE.test(f.name)) : [];
    if (fileRef.current) fileRef.current.value = "";
    if (list && incoming.length < list.length) announce("Some files were left out. Use JPEG, PNG, WebP, MP4, MOV or WebM.");
    if (!incoming.length) return;
    const key = (f: File) => `${f.name}|${f.size}|${f.lastModified}`;
    const have = new Set(files.map(key));
    const fresh = incoming.filter((f) => !have.has(key(f)));
    setFiles((cur) => [...cur, ...fresh]);
    setDescriptions((cur) => [...cur, ...fresh.map(() => "")]);
    if (fresh.length) announce(`${plural(fresh.length, "file")} added.`);
  }

  function removeFile(i: number) {
    const name = files[i]?.name;
    setFiles((cur) => cur.filter((_, k) => k !== i));
    setDescriptions((cur) => cur.filter((_, k) => k !== i));
    announce(`${name} removed.`);
    // Focus the next row's Remove, or the file picker when the list is empty.
    requestAnimationFrame(() => {
      const next = document.querySelector<HTMLButtonElement>(`[data-remove="${Math.min(i, files.length - 2)}"]`);
      (next ?? fileRef.current)?.focus();
    });
  }

  function clearFiles() {
    setFiles([]);
    setDescriptions([]);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (sending) return;
    const text = brief.trim();
    const next: typeof errors = {};
    const items: SummaryItem[] = [];
    if (text.length < 10) {
      next.brief = "Describe the video in at least one sentence";
      items.push({ text: next.brief, target: "brief" });
    } else if (text.length > BRIEF_MAX) {
      next.brief = `The brief must be ${BRIEF_MAX.toLocaleString("en-GB")} characters or fewer. Remove ${(text.length - BRIEF_MAX).toLocaleString("en-GB")} characters.`;
      items.push({ text: next.brief, target: "brief" });
    }
    if (!formats.length) {
      next.formats = "Choose at least one format";
      items.push({ text: next.formats, target: `format-${meta?.formats[0]?.id ?? "16x9"}` });
    }
    if (current && !current.ok) {
      next.brand = "This brand has problems that stop videos being made";
      items.push({ text: "Choose a brand that is ready to use, or fix this brand first", target: "brand" });
    }
    if (files.length > MEDIA_MAX) items.push({ text: `Choose ${MEDIA_MAX} files or fewer`, target: "media" });
    setErrors(next);
    // A problem inside the options opens them, so the error summary's links lead somewhere.
    if (next.formats || files.length > MEDIA_MAX) setOptionsOpen(true);
    if (items.length) {
      setSummary((s) => ({ items, key: s.key + 1 }));
      return;
    }
    setSummary((s) => ({ items: [], key: s.key + 1 }));
    const fd = new FormData();
    fd.append("brief", text);
    fd.append("brand", brand);
    fd.append("voice", voice);
    for (const f of formats) fd.append("formats", f);
    files.forEach((f, i) => {
      fd.append("mediaDescription", (descriptions[i] ?? "").trim());
      fd.append("media", f, f.name);
    });
    setSending(true);
    try {
      const v = await api<JobViewData>("POST", "/api/jobs", fd);
      clearFiles();
      openJob(v.job.id, "progress", v);
      loadHistory();
    } catch (err) {
      setSummary((s) => ({ items: [(err as Error).message], key: s.key + 1 }));
    } finally {
      setSending(false);
    }
  }

  function focusBrief() {
    afterPaint(() => {
      const box = document.getElementById("brief");
      box?.scrollIntoView({ block: "center", behavior: "smooth" });
      box?.focus({ preventScroll: true });
    });
  }

  function changeBrief(text: string) {
    setBrief(text);
    setFormOpen(true);
    focusBrief();
  }

  function newVideo() {
    setFormOpen(true);
    focusBrief();
  }

  const formatSummary = meta ? (formats.length === meta.formats.length ? `All ${meta.formats.length} formats` : formats.length ? plural(formats.length, "format") : "No formats") : "";
  const optionsSummary = [formatSummary, voiceLabel ?? "Brand voice", files.length ? plural(files.length, "file") : ""].filter(Boolean).join(" · ");

  return (
    <Shell current="make">
      <PageHeader title="Make a video" lede={jobId ? undefined : "Describe it in plain English. Get on-brand videos in every format."} />

      <div id="form-errors" className="form-errors">
        <ErrorSummary items={summary.items} focusKey={summary.key} />
      </div>

      <AnimatePresence initial={false}>
        {!formOpen ? (
          <motion.div key="new" className="new-video" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0, transition: transition.base }} exit={{ opacity: 0, transition: { duration: 0.1 } }}>
            <Button variant="default" onClick={newVideo} leftSection={<Plus size={20} weight="bold" aria-hidden="true" />} aria-controls="make-form" aria-expanded={false}>
              New video
            </Button>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <Collapse open={formOpen} keepMounted className="bleed">
        <div className="bleed__inner">
        <form id="make-form" className="make-form card" noValidate onSubmit={onSubmit}>
          <Field id="brief" label="What is the video about?" hint="Who it’s for, what’s happening and what to do. Write dates and links exactly." error={errors.brief}>
            <textarea
              className={`textarea brief-box${filled ? ` brief-box--filled-${filled % 2}` : ""}`}
              id="brief"
              name="brief"
              rows={6}
              spellCheck
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              aria-invalid={errors.brief ? true : undefined}
              aria-describedby={describedBy("brief", { hint: 1, error: errors.brief, extra: countShown(brief, BRIEF_MAX, BRIEF_COUNT_WITHIN) ? ["brief-count"] : [] })}
            />
            <CharCount id="brief-count" value={brief} max={BRIEF_MAX} within={BRIEF_COUNT_WITHIN} />
            <AnimatePresence initial={false}>
              {!brief ? (
                <motion.div key="examples" className="examples" role="group" aria-labelledby="examples-label" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0, transition: transition.base }} exit={{ opacity: 0, transition: { duration: 0.12 } }}>
                  <span className="examples__label" id="examples-label">
                    Try an example
                  </span>
                  <ul className="examples__list">
                    {EXAMPLES.map((x) => (
                      <li key={x.label}>
                        <button type="button" className="chip" onClick={() => fillExample(x.text)}>
                          {x.label}
                        </button>
                      </li>
                    ))}
                  </ul>
                </motion.div>
              ) : null}
            </AnimatePresence>
          </Field>

          <Field
            id="brand"
            label="Brand"
            error={errors.brand}
            extra={
              <p id="brand-status" className="brand-status" aria-live="polite">
                {brandStatus ? (
                  <span className="brand-status__line">
                    <Loader size={18} aria-hidden="true" />
                    {brandStatus}
                  </span>
                ) : !current ? null : current.ok ? (
                  <span className="brand-status__line">
                    <CheckCircle size={22} weight="fill" className="ok-icon" aria-hidden="true" />
                    <span>
                      <span className="ok-text">Ready</span>
                      {" · "}
                      <a href="/brands">Manage brands</a>
                    </span>
                  </span>
                ) : (
                  <span className="brand-status__line">
                    <WarningCircle size={22} weight="fill" className="bad-icon" aria-hidden="true" />
                    <span>
                      <span className="bad-text">This brand has problems that stop videos being made. </span>
                      <a href={`/brands?brand=${encodeURIComponent(current.id)}`}>Fix the brand</a>
                    </span>
                  </span>
                )}
              </p>
            }
          >
            <select className="select" id="brand" name="brand" value={brand} onChange={(e) => setBrand(e.target.value)} aria-invalid={errors.brand ? true : undefined} aria-describedby={describedBy("brand", { error: errors.brand, extra: ["brand-status"] })}>
              {!brands.length ? <option value="">Loading brands...</option> : null}
              {brands.map((b) => (
                <option key={b.id} value={b.id}>
                  {`${b.name}${b.fictional ? " (sample)" : ""}${b.ok ? "" : " - has problems"}`}
                </option>
              ))}
            </select>
          </Field>

          {/* Voice, formats and media: sensible defaults, folded away until wanted. Kept mounted so choices and files survive closing. */}
          <div className="options">
            <button type="button" className="options__toggle" aria-expanded={optionsOpen} aria-controls="make-options" onClick={() => setOptionsOpen((o) => !o)}>
              <motion.span className="options__chevron" animate={{ rotate: optionsOpen ? 90 : 0 }} transition={spring.snappy} aria-hidden="true">
                <CaretRight size={18} weight="bold" />
              </motion.span>
              <span className="options__title">Options</span>
              <span className="options__summary">{optionsSummary}</span>
            </button>
            <Collapse open={optionsOpen} keepMounted id="make-options" className="bleed">
              <div className="options__body bleed__inner">
                <Field id="voice" label="Voice">
                  <select className="select" id="voice" name="voice" value={voice} onChange={(e) => setVoice(e.target.value)}>
                    <option value="">{`Brand voice${brandVoice ? `: ${brandVoice.label}` : ""}`}</option>
                    {meta?.voices.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.label}
                      </option>
                    ))}
                  </select>
                </Field>

                <fieldset className="field" id="formats-field" data-error={errors.formats ? "true" : undefined} aria-describedby={describedBy("formats", { error: errors.formats })}>
                  <legend className="label">Formats</legend>
                  {errors.formats ? (
                    <p className="error-msg" id="formats-error">
                      <span className="visually-hidden">Error: </span>
                      {errors.formats}
                    </p>
                  ) : null}
                  <div className="format-choices" id="formats">
                    {meta?.formats.map((f) => (
                      <label className="format-choice" key={f.id}>
                        <input
                          type="checkbox"
                          name="formats"
                          id={`format-${f.id}`}
                          value={f.id}
                          checked={formats.includes(f.id)}
                          onChange={(e) => setFormats((cur) => (e.target.checked ? meta.formats.map((x) => x.id).filter((x) => x === f.id || cur.includes(x)) : cur.filter((x) => x !== f.id)))}
                        />
                        <FormatShape w={f.width} h={f.height} />
                        <span className="format-choice__text">
                          <span className="format-choice__name">{f.label}</span>
                          <span className="format-choice__dims">{`${f.width} × ${f.height}`}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>

                <div className="field" data-error={files.length > MEDIA_MAX ? "true" : undefined}>
                  <label className="label" htmlFor="media">
                    Photos or clips (optional)
                  </label>
                  <p className="hint" id="media-hint">
                    JPEG, PNG, WebP, MP4, MOV or WebM. Use only ones you have rights to.
                  </p>
                  {files.length > MEDIA_MAX ? (
                    <p className="error-msg" id="media-error">
                      <span className="visually-hidden">Error: </span>
                      {`Choose ${MEDIA_MAX} files or fewer. Remove ${plural(files.length - MEDIA_MAX, "file")}.`}
                    </p>
                  ) : null}
                  {/* The browser's own input, kept focusable but drawn as a drop area with a "Choose files" pill. */}
                  <div
                    className={`drop drop--pick${dragOver ? " drop--over" : ""}`}
                    onDragEnter={(e) => {
                      e.preventDefault();
                      setDragOver(true);
                    }}
                    onDragOver={(e) => e.preventDefault()}
                    onDragLeave={(e) => {
                      if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      setDragOver(false);
                      addFiles(e.dataTransfer.files);
                    }}
                  >
                    <span className="drop__icon" aria-hidden="true">
                      <UploadSimple size={24} weight="regular" />
                    </span>
                    <input
                      ref={fileRef}
                      className="drop__native"
                      type="file"
                      id="media"
                      name="media"
                      multiple
                      accept={MEDIA_ACCEPT}
                      aria-describedby={["media-hint", files.length > MEDIA_MAX ? "media-error" : ""].filter(Boolean).join(" ")}
                      onChange={(e) => addFiles(e.target.files)}
                    />
                    <label htmlFor="media" className="drop__pick" aria-hidden="true">
                      Choose files
                    </label>
                    <span className="drop__or" aria-hidden="true">
                      or drop them here
                    </span>
                  </div>
                  <div id="media-list">
                    {files.length ? (
                      <AnimatedList as="ul" className="media-list" aria-label={`${plural(files.length, "file")} chosen`}>
                        {files.map((f, i) => (
                          <AnimatedItem key={`${f.name}-${f.size}-${f.lastModified}`} className="media-item">
                            <div className="media-item__head">
                              <span className="media-item__name">{f.name}</span>
                              <span className="media-item__size">{formatBytes(f.size)}</span>
                              <Button variant="subtle" className="small media-item__remove" data-remove={i} onClick={() => removeFile(i)} leftSection={<X size={18} weight="bold" aria-hidden="true" />}>
                                Remove<span className="visually-hidden">{` ${f.name}`}</span>
                              </Button>
                            </div>
                            <label className="label media-item__label" htmlFor={`media-desc-${i}`}>
                              What does it show? <span className="media-item__opt">(optional)</span>
                              <span className="visually-hidden">{` ${f.name}`}</span>
                            </label>
                            <div className="control">
                              <input className="input" type="text" id={`media-desc-${i}`} maxLength={200} value={descriptions[i] ?? ""} onChange={(e) => setDescriptions((d) => d.map((x, k) => (k === i ? e.target.value : x)))} />
                            </div>
                          </AnimatedItem>
                        ))}
                      </AnimatedList>
                    ) : null}
                  </div>
                </div>
              </div>
            </Collapse>
          </div>

          <div className="buttons make-actions">
            <Button
              type="submit"
              id="make-button"
              size="lg"
              aria-disabled={sending || undefined}
              leftSection={sending ? <Loader size={20} color="#fff" aria-hidden="true" /> : undefined}
              rightSection={sending ? undefined : <ArrowRight size={22} weight="bold" aria-hidden="true" className="make-arrow" />}
            >
              {sending ? "Sending..." : "Make video"}
            </Button>
          </div>
        </form>
        </div>
      </Collapse>

      {jobId ? (
        <Reveal as="section" key={jobId} y={0} className="job" id="job" aria-labelledby="job-title">
          <JobView
            view={view}
            brands={brands}
            meta={meta}
            pollError={pollError}
            poll={poll}
            applyView={(v) => applyView.current(v)}
            loadHistory={loadHistory}
            onChangeBrief={changeBrief}
            focusJob={() => focusJob("job-title")}
            notify={notifyIds.has(jobId)}
            setNotify={setNotify}
            onDelete={() => deleteJob(jobId)}
          />
        </Reveal>
      ) : null}

      <section className="history" aria-labelledby="history-title">
        <h2 className="h3" id="history-title" tabIndex={-1}>
          Your videos
        </h2>
        {history?.length ? (
          <Segmented
            name="history-filter"
            legend="Show"
            legendHidden
            className="history-filter"
            value={filter}
            onChange={(v) => setFilter(v as "all" | "done")}
            options={[
              { value: "all", label: "All" },
              { value: "done", label: "Ready" },
            ]}
          />
        ) : null}
        <div id="history" className="history__body">
          {historyError ? (
            <p className="bad-text">{historyError}</p>
          ) : !history ? (
            <HistorySkeleton />
          ) : !history.length ? (
            <p className="history__empty">None yet.</p>
          ) : (
            <History rows={history} live={view?.job} openId={jobId} brands={brands} showAll={showAll} setShowAll={setShowAll} onOpen={(id) => openJob(id, "title")} filter={filter} onDelete={deleteJob} />
          )}
        </div>
      </section>
    </Shell>
  );
}

/** Move focus to part of the job (its title or its progress) and scroll it to the top of the screen. */
function focusJob(id = "job-title") {
  const t = document.getElementById(id) ?? document.getElementById("job-title");
  if (!t) return;
  t.scrollIntoView({ block: "start" });
  t.focus({ preventScroll: true });
}

function historyStatus(j: { state: string; progress?: number }) {
  return j.state === "running" ? `${STATE_TEXT[j.state]} ${Math.round((j.progress ?? 0) * 100)}%` : (STATE_TEXT[j.state] ?? j.state);
}

/** Placeholder rows built like the real ones (white list, two lines and a tag), so nothing jumps on load. */
function HistorySkeleton() {
  return (
    <div className="skeleton-rows">
      <span className="visually-hidden" role="status">
        Loading your videos
      </span>
      <ul className="jobs-list" aria-hidden="true">
        {[68, 52, 60].map((w, i) => (
          <li className="job-row" key={i}>
            <span className="job-row__link">
              <Skeleton height={20} width={`${w}%`} />
            </span>
            <span className="job-row__meta">
              <Skeleton height={16} width="38%" mt={8} />
            </span>
            <span className="job-row__tag">
              <Skeleton height={30} width={88} radius="xl" />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function History({ rows, live, openId, brands, showAll, setShowAll, onOpen, filter, onDelete }: { rows: JobRow[]; live?: Job; openId: string | null; brands: BrandSummary[]; showAll: boolean; setShowAll: (v: boolean) => void; onOpen: (id: string) => void; filter: "all" | "done"; onDelete: (id: string) => Promise<string | void> }) {
  const [asking, setAsking] = useState<string | null>(null);
  // The open job's row keeps in step with the progress above it, without reloading the list.
  const merged = rows.slice(0, 50).map((r) => (live && live.id === r.id ? { ...r, title: live.title, state: live.state, progress: live.progress } : r));
  const all = filter === "done" ? merged.filter((r) => r.state === "done") : merged;
  const shown = showAll ? all : all.slice(0, HISTORY_FIRST);
  const brandName = (id: string) => brands.find((b) => b.id === id)?.name ?? id;

  // Escape or Cancel: back to that row's Delete button.
  function cancel(id: string) {
    setAsking(null);
    requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(`[data-delete="${CSS.escape(id)}"]`)?.focus());
  }
  async function confirm(id: string) {
    const i = shown.findIndex((r) => r.id === id);
    const next = shown[i + 1] ?? shown[i - 1];
    const err = await onDelete(id);
    if (err) return err;
    setAsking(null);
    // Focus the next video in the list (or the heading when none are left), while the row fades out.
    requestAnimationFrame(() => {
      const link = next ? document.querySelector<HTMLElement>(`[data-job="${CSS.escape(next.id)}"] .job-row__link`) : null;
      (link ?? document.getElementById("history-title"))?.focus();
    });
  }

  if (!all.length) return <p className="history__empty">No ready videos yet.</p>;
  return (
    <>
      <AnimatedList as="ul" className="jobs-list" aria-label={filter === "done" ? "Ready videos, newest first" : "Videos made so far, newest first"}>
        {shown.map((j) => (
          <AnimatedItem key={j.id} className={`job-row${openId === j.id ? " job-row--open" : ""}${asking === j.id ? " job-row--asking" : ""}`} data-job={j.id}>
            <a
              className="job-row__link"
              href={`/?job=${encodeURIComponent(j.id)}`}
              aria-current={openId === j.id ? "true" : undefined}
              onClick={(e) => {
                e.preventDefault();
                onOpen(j.id);
              }}
            >
              {j.title}
            </a>
            <span className="job-row__meta">{`${brandName(j.brand)} · ${shortDate(j.createdAt)}`}</span>
            <Tag tone={STATE_TONE[j.state]} className="job-row__tag">
              {historyStatus(j)}
            </Tag>
            {!isBusy(j.state) && asking !== j.id ? (
              <button type="button" className="link-button job-row__delete" data-delete={j.id} onClick={() => setAsking(j.id)}>
                <Trash size={18} weight="regular" aria-hidden="true" />
                Delete<span className="visually-hidden">{` ${j.title}`}</span>
              </button>
            ) : null}
            {asking === j.id ? (
              <div className="job-row__confirm">
                <ConfirmDelete title={j.title} onYes={() => confirm(j.id)} onCancel={() => cancel(j.id)} />
              </div>
            ) : null}
          </AnimatedItem>
        ))}
      </AnimatedList>
      {all.length > HISTORY_FIRST ? (
        <p className="history__more">
          <button type="button" className="link-button" onClick={() => setShowAll(!showAll)} aria-controls="history" aria-expanded={showAll}>
            {showAll ? `Show the newest ${HISTORY_FIRST}` : `Show all ${all.length}`}
          </button>
        </p>
      ) : null}
    </>
  );
}
