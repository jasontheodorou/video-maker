// One video: its heading, live progress with Stop, problems, and the results once it is ready.
import { Button, Skeleton } from "@mantine/core";
import { ArrowClockwise, ArrowSquareOut, CaretRight, Check, DownloadSimple, FileText, Stop, Trash } from "@phosphor-icons/react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { announce, api, formatBytes, formatDate, FORMAT_LABELS, focusNode, plural } from "../shared/api";
import { Collapse, ProgressBar, PulseDot, Reveal, Stagger, StaggerItem, SuccessCheck, Swap, spring, usePillId } from "../shared/motion";
import { ErrorSummary, ICON, Message } from "../shared/ui";
import { ConfirmDelete } from "./ConfirmDelete";
import { ScriptEditor } from "./ScriptEditor";
import { Segmented } from "./Segmented";
import { STATE_TEXT, isBusy, type BrandSummary, type JobViewData, type Meta } from "./types";

interface Props {
  view: JobViewData | null;
  brands: BrandSummary[];
  meta: Meta | null;
  pollError: string | null;
  poll: () => void;
  applyView: (v: JobViewData) => void;
  loadHistory: () => void;
  onChangeBrief: (text: string) => void;
  focusJob: () => void;
  /** Whether to send a browser notification when this video is ready, and a way to change it. */
  notify: boolean;
  setNotify: (on: boolean) => void;
  /** Delete this video. Returns an error message if it could not be deleted. */
  onDelete: () => Promise<string | void>;
}

/** A quiet link that folds content open and closed. Kept mounted, so what is inside stays in the page. */
function Fold({ summary, children, id, defaultOpen = false }: { summary: string; children: React.ReactNode; id: string; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="fold">
      <button type="button" className="disclosure__toggle" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
        <motion.span className="disclosure__chevron" animate={{ rotate: open ? 90 : 0 }} transition={spring.snappy} aria-hidden="true">
          <CaretRight size={18} weight="bold" />
        </motion.span>
        {summary}
      </button>
      <Collapse open={open} keepMounted id={id} className="bleed">
        <div className="fold__body bleed__inner">{children}</div>
      </Collapse>
    </div>
  );
}

/** The job's shape while it loads: a title bar, a tag and one card, so nothing jumps when it arrives. */
function JobSkeleton({ pollError }: { pollError: string | null }) {
  return (
    <div id="job-head" className="job-head job-skeleton">
      <h2 className="visually-hidden" id="job-title" tabIndex={-1}>
        Loading the video
      </h2>
      {pollError ? (
        <ErrorSummary items={[pollError]} focus={false} headingLevel={3} />
      ) : (
        <>
          <span className="visually-hidden" role="status">
            Getting the latest progress
          </span>
          <div aria-hidden="true">
            <Skeleton height={34} width="72%" />
            <Skeleton height={30} width={180} radius="xl" mt={20} />
            <Skeleton height={168} radius="lg" mt={48} />
          </div>
        </>
      )}
    </div>
  );
}

/** The job's state in words. Shown as a tag only when finished; otherwise the card below says it, so it is read out only. */
function StateTag({ state, fresh }: { state: string; fresh: boolean }) {
  if (state === "done") {
    return (
      <span className="tag good">
        <SuccessCheck size={18} still={!fresh} />
        <span className="tag__text">{STATE_TEXT.done}</span>
      </span>
    );
  }
  return <span className="tag visually-hidden">{STATE_TEXT[state] ?? state}</span>;
}

export function JobView({ view, brands, meta, pollError, poll, applyView, loadHistory, onChangeBrief, focusJob, notify, setNotify, onDelete }: Props) {
  const [retryError, setRetryError] = useState<{ text: string; key: number } | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  // Celebrate only what this page watched finish: an old video opens with its tick already drawn.
  const sawBusy = useRef(false);
  if (view && isBusy(view.job.state)) sawBusy.current = true;

  if (!view) return <JobSkeleton pollError={pollError} />;
  const j = view.job;
  const busy = isBusy(j.state);
  const done = j.state === "done";
  const brand = brands.find((b) => b.id === j.brand);
  const facts = done ? [view.duration ? `${view.duration.toFixed(1)} s` : "", view.outputs.length ? plural(view.outputs.length, "format") : ""].filter(Boolean) : [];

  async function retry() {
    try {
      const v = await api<JobViewData>("POST", `/api/jobs/${encodeURIComponent(j.id)}/retry`);
      setRetryError(null);
      applyView(v);
      poll();
      loadHistory();
    } catch (e) {
      setRetryError({ text: (e as Error).message, key: Date.now() });
    }
  }

  return (
    <>
      {/* Updated in place, never rebuilt: the heading often has keyboard focus. */}
      <div id="job-head" className="job-head">
        <h2 className="h2 job-title" id="job-title" tabIndex={-1}>
          {j.title}
        </h2>
        <p className="job-meta">
          <StateTag state={j.state} fresh={sawBusy.current} />
          <span>
            {facts.length ? <span className="job-meta__facts">{`${facts.join(" · ")} · `}</span> : null}
            {`${brand?.name ?? j.brand} · ${formatDate(j.createdAt)}`}
          </span>
        </p>
        <div className="job-folds">
          <Fold summary="Brief" id="job-brief">
            <p className="brief-text">{j.brief || "No brief was saved."}</p>
          </Fold>
          {!busy ? <StepsFold view={view} /> : null}
        </div>
      </div>

      <div id="job-error">
        {pollError ? <ErrorSummary items={[pollError]} focus={false} headingLevel={3} /> : null}
        {retryError ? <ErrorSummary items={[retryError.text]} focusKey={retryError.key} headingLevel={3} /> : null}
        {j.state === "error" && j.error ? <JobError view={view} onRetry={retry} onChangeBrief={onChangeBrief} onEditScript={() => setEditorOpen(true)} /> : null}
      </div>

      <JobProgress view={view} onRetry={retry} poll={poll} applyView={applyView} notify={notify} setNotify={setNotify} />

      {j.notes?.length ? (
        <Reveal id="job-notes" className="job-block">
          <Message tone="warn">
            <h3>Things to check</h3>
            <ul>
              {j.notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          </Message>
        </Reveal>
      ) : null}

      {!busy && (view.outputs.length || view.srt) ? <Videos view={view} /> : null}
      {view.decision ? <Decision view={view} /> : null}
      {view.sheet ? <Sheet src={view.sheet} /> : null}
      {meta ? <ScriptEditor view={view} meta={meta} poll={poll} applyView={applyView} loadHistory={loadHistory} focusJob={focusJob} open={editorOpen} setOpen={setEditorOpen} /> : null}
      {!busy ? <DeleteJob title={j.title} onDelete={onDelete} /> : null}
    </>
  );
}

// ---------- progress ----------

/** A running step with no change for this long gets a "taking longer than usual" note. */
const SLOW_STEP_MS = 60000;

/** The round marker on each step: a number, a spinner ring while working, a tick when done. */
function StepMark({ kind, n }: { kind: "done" | "active" | "failed" | "waiting"; n: number }) {
  const reduce = useReducedMotion();
  return (
    <span className="mark" aria-hidden="true">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.i
          key={kind}
          className="mark__inner"
          initial={reduce ? false : { scale: 0.4, opacity: 0 }}
          animate={{ scale: 1, opacity: 1, transition: spring.snappy }}
          exit={{ scale: 0.6, opacity: 0, transition: { duration: 0.1 } }}
        >
          {kind === "done" ? <Check size={20} weight="bold" /> : kind === "failed" ? "!" : String(n)}
        </motion.i>
      </AnimatePresence>
    </span>
  );
}

/** The steps, one under the other: a number, a turning ring at work, a tick when done, a red mark on a problem. */
function Steps({ view, stopping = false }: { view: JobViewData; stopping?: boolean }) {
  const j = view.job;
  const busy = isBusy(j.state);
  const hl = usePillId("step");
  return (
    <Stagger as="ol" className="steps" gap={0.05}>
      {view.stages.map((s, i) => {
        const isDone = j.stagesDone.includes(s.id);
        const active = busy && j.stage === s.id;
        const failed = j.state === "error" && j.error?.stage === s.id;
        const kind = failed ? "failed" : active ? "active" : isDone ? "done" : "waiting";
        // The marker and the highlight say it; the word is for screen readers.
        const word = failed ? "Problem" : active ? (stopping ? "Stopping" : "In progress") : isDone ? "Done" : "Not started";
        return (
          <StaggerItem as="li" key={s.id} className={kind === "waiting" ? "" : kind} aria-current={active ? "step" : undefined}>
            <StepMark kind={kind} n={i + 1} />
            <span className="step-label">{s.label}</span>
            <span className="state visually-hidden">{`, ${word}`}</span>
            {/* Last, so the label stays the second span (the end-to-end test reads it). */}
            {active ? <motion.i layoutId={hl} className="steps__hl" transition={spring.gentle} aria-hidden="true" /> : null}
          </StaggerItem>
        );
      })}
    </Stagger>
  );
}

/** Steps for a job that has ended, folded away beside the brief. */
function StepsFold({ view }: { view: JobViewData }) {
  const pct = Math.round((view.job.progress ?? 0) * 100);
  return (
    <Fold summary="Steps" id="done-steps">
      <Steps view={view} />
      <div className="bar-area">
        <p className="progress-text" id="progress-label">{`${pct}% complete`}</p>
        <ProgressBar value={pct} label="Progress" className="job-bar" />
      </div>
    </Fold>
  );
}

function JobProgress({ view, onRetry, poll, applyView, notify, setNotify }: { view: JobViewData; onRetry: () => void; poll: () => void; applyView: (v: JobViewData) => void; notify: boolean; setNotify: (on: boolean) => void }) {
  const j = view.job;
  const busy = isBusy(j.state);
  const [askStop, setAskStop] = useState(false);
  const [stopSent, setStopSent] = useState(false);
  const [stopError, setStopError] = useState<string | null>(null);
  const stopping = busy && (j.stopping || stopSent);
  const box = useRef<HTMLElement>(null);
  const stopRef = useRef<HTMLButtonElement>(null);
  const retryRef = useRef<HTMLButtonElement>(null);
  const messageRef = useRef<HTMLParagraphElement>(null);
  const noRef = useRef<HTMLButtonElement>(null);
  const focusStop = useRef(false);

  // The question takes the place of Stop. Focus goes to the safe answer ("No"), and back to Stop afterwards.
  useEffect(() => {
    if (askStop) noRef.current?.focus();
    else if (focusStop.current) {
      focusStop.current = false;
      stopRef.current?.focus();
    }
  }, [askStop]);
  function cancelStop() {
    focusStop.current = true;
    setAskStop(false);
  }
  // The job ended while the question was open: close it.
  useEffect(() => {
    if (!busy && askStop) setAskStop(false);
  }, [busy, askStop]);
  const [live, setLive] = useState("");

  const pct = Math.round((j.progress ?? 0) * 100);

  // A running step that has not moved for a while says so, so nobody thinks the page has stopped working.
  const moved = useRef<{ key: string; at: number }>({ key: "", at: Date.now() });
  const moveKey = `${j.state}:${j.stage}:${pct}:${j.message}`;
  if (moved.current.key !== moveKey) moved.current = { key: moveKey, at: Date.now() };
  let message = j.state === "queued" ? (view.queuePosition > 0 ? `Waiting for ${plural(view.queuePosition, "other video")} to finish.` : "Starting...") : j.message || "";
  if (j.state === "running" && !stopping && Date.now() - moved.current.at > SLOW_STEP_MS && !/longer than usual|^Waiting/i.test(message))
    message = `${message.replace(/\.?$/, ".")} This step is taking longer than usual. It is still working.`;
  if (stopSent && busy && !j.stopping) message = "Stopping. This can take a few seconds.";

  // Tell screen reader users about a new step or the end, not every percentage.
  const stageKey = `${j.state}:${j.stage}:${stopping ? "s" : ""}`;
  const lastStage = useRef<string | null>(null);
  useEffect(() => {
    if (lastStage.current !== null && lastStage.current !== stageKey) {
      const label = view.stages.find((s) => s.id === j.stage)?.label;
      const say = stopping ? "Stopping." : j.state === "stopped" ? "Stopped." : busy && label ? `${label}.` : "";
      if (say) setLive(say);
    }
    lastStage.current = stageKey;
  }, [stageKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // The job has just ended: if focus was on Stop (now gone) or nowhere, put it on what comes next.
  const lastState = useRef(j.state);
  useLayoutEffect(() => {
    const was = lastState.current;
    lastState.current = j.state;
    if (!isBusy(was) || busy) return;
    setStopSent(false);
    setStopError(null);
    const active = document.activeElement;
    const lost = !active || active === document.body || (box.current?.contains(active) ?? false) || (document.getElementById("job")?.contains(active) ?? false);
    if (!lost) return;
    if (j.state === "stopped" && retryRef.current) retryRef.current.focus();
    else if (j.state === "stopped") focusNode(document.getElementById("stopped-h"));
    else if (j.state === "error") focusNode(document.querySelector("#job-error h3[tabindex]") ?? document.getElementById("job-title"));
    else requestAnimationFrame(() => focusNode(document.getElementById("videos-title") ?? document.getElementById("job-title")));
  }, [j.state, busy]);

  async function confirmStop() {
    focusStop.current = true;
    setStopSent(true);
    setStopError(null);
    setAskStop(false);
    setLive("Stopping.");
    try {
      const v = await api<JobViewData>("POST", `/api/jobs/${encodeURIComponent(j.id)}/stop`);
      if (v?.job) applyView(v);
    } catch (e) {
      // The video is still being made: bring Stop back, say why in the page, and give Stop focus again.
      // The error itself is a role="alert", so it is read out once; the live region is cleared so it is not read twice.
      const text = `It did not stop. ${(e as Error).message}`;
      setStopSent(false);
      setStopError(text);
      setLive("");
      requestAnimationFrame(() => stopRef.current?.focus());
    }
    poll();
  }

  const showRetry = j.state === "stopped" && (j.fromApp || view.spec);

  if (j.state === "stopped") {
    const said = j.message && !/^stopped\.?$/i.test(j.message.trim()) ? j.message : "";
    return (
      <section id="job-progress" className="job-block" aria-labelledby="stopped-h" ref={box}>
        <Message tone="plain" className="job-status">
          <h3 id="stopped-h" tabIndex={-1}>
            Stopped
          </h3>
          {said ? (
            <p className="pre" ref={messageRef}>
              {said}
            </p>
          ) : null}
          {showRetry ? (
            <div className="buttons">
              <Button ref={retryRef} onClick={onRetry} leftSection={<ArrowClockwise size={22} weight="bold" aria-hidden="true" />}>
                Try again
              </Button>
            </div>
          ) : null}
        </Message>
        <p className="visually-hidden" aria-live="polite">
          {live}
        </p>
      </section>
    );
  }

  if (!busy) {
    // Done or a problem: the steps are folded beside the brief. Only the live region stays here.
    return (
      <div id="job-progress" ref={box as React.RefObject<HTMLDivElement>}>
        <p className="visually-hidden" aria-live="polite">
          {live}
        </p>
      </div>
    );
  }

  return (
    <section id="job-progress" className="job-block" aria-labelledby="progress-h" ref={box}>
      <div className="card progress-card">
        <div className="progress-card__head">
          <h3 className="h3" id="progress-h" tabIndex={-1}>
            {j.state === "queued" ? "Waiting to start" : "Making your video"}
          </h3>
          <span className="progress-text pct" id="progress-label">
            <Swap id={pct}>{`${pct}%`}</Swap>
            <span className="visually-hidden"> complete</span>
          </span>
        </div>
        <ProgressBar value={pct} label="Progress" className="job-bar" />
        <p className="progress-message progress-message--live" ref={messageRef}>
          <PulseDot active={!stopping} />
          {message ? (
            <Swap id={message} as="span" className="progress-message__text">
              {message}
            </Swap>
          ) : null}
        </p>
        {!stopping ? <NotifyToggle on={notify} setOn={setNotify} /> : null}
        <Steps view={view} stopping={stopping} />

        {!askStop ? (
          <div className="buttons progress-actions">
            {/* aria-disabled, not disabled, so a focused Stop keeps focus. */}
            <Button
              ref={stopRef}
              variant="subtle"
              aria-disabled={stopping || undefined}
              aria-describedby={stopError ? "stop-error" : undefined}
              leftSection={<Stop size={20} weight="fill" aria-hidden="true" />}
              onClick={() => {
                if (!stopping) setAskStop(true);
              }}
            >
              {stopping ? "Stopping..." : "Stop"}
            </Button>
            {stopError ? (
              <p className="error-msg stop-error" id="stop-error" role="alert">
                <span className="visually-hidden">Error: </span>
                {stopError}
              </p>
            ) : null}
          </div>
        ) : null}
        {askStop && !stopping ? (
          <Reveal
            className="confirm stop-question"
            role="group"
            aria-labelledby="stop-question"
            onKeyDown={(e: React.KeyboardEvent) => {
              if (e.key === "Escape") {
                e.stopPropagation();
                cancelStop();
              }
            }}
          >
            <Message tone="warn">
              <h4 id="stop-question" className="h4">
                Stop making this video?
              </h4>
              <p>The work so far will be lost.</p>
              <div className="buttons">
                <Button className="danger" color="red" onClick={confirmStop}>
                  Yes, stop it
                </Button>
                <Button ref={noRef} variant="default" onClick={cancelStop}>
                  No, carry on
                </Button>
              </div>
            </Message>
          </Reveal>
        ) : null}
      </div>
      <p className="visually-hidden" aria-live="polite">
        {live}
      </p>
    </section>
  );
}

// ---------- problems ----------

function JobError({ view, onRetry, onChangeBrief, onEditScript }: { view: JobViewData; onRetry: () => void; onChangeBrief: (t: string) => void; onEditScript: () => void }) {
  const j = view.job;
  const e = j.error!;
  const needsDetail = e.retryable === false;
  return (
    <Reveal className="job-block">
      <Message tone={needsDetail ? "warn" : "bad"} className="job-error">
        <h3 tabIndex={-1}>{needsDetail ? "The brief needs more detail" : "The video could not be made"}</h3>
        <p className="pre">{e.message}</p>
        {e.problems?.length ? (
          <ul>
            {e.problems.slice(0, 12).map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        ) : null}
        <div className="buttons">
          {view.spec ? (
            <Button
              component="a"
              href="#script-editor"
              variant="default"
              onClick={(ev: React.MouseEvent) => {
                ev.preventDefault();
                onEditScript();
                requestAnimationFrame(() => {
                  const h = document.getElementById("script-editor");
                  h?.scrollIntoView({ block: "start" });
                  h?.focus({ preventScroll: true });
                });
              }}
            >
              Edit the script
            </Button>
          ) : null}
          {!view.spec && j.brief ? (
            <Button
              component="a"
              href="#brief"
              variant={needsDetail ? "filled" : "default"}
              onClick={(ev: React.MouseEvent) => {
                ev.preventDefault();
                onChangeBrief(j.brief);
              }}
            >
              Change the brief
            </Button>
          ) : null}
          {(j.fromApp || view.spec) && e.retryable !== false ? (
            <Button onClick={onRetry} leftSection={<ArrowClockwise size={22} weight="bold" aria-hidden="true" />}>
              Try again
            </Button>
          ) : null}
        </div>
      </Message>
    </Reveal>
  );
}

// ---------- results ----------

function Decision({ view }: { view: JobViewData }) {
  const d = view.decision;
  const size = ({ short: "Short", medium: "Medium", long: "Long" } as Record<string, string>)[d.size] ?? d.size;
  return (
    <Reveal as="section" id="job-decision" className="job-block" aria-labelledby="decision-h">
      <h3 className="h3" id="decision-h">
        Length
      </h3>
      <dl className="facts">
        <div>
          <dt>Chosen</dt>
          <dd>{`${size}, ${d.targetSeconds.min}–${d.targetSeconds.max} s`}</dd>
        </div>
        {view.duration ? (
          <div>
            <dt>This video</dt>
            <dd>{`${view.duration.toFixed(1)} s`}</dd>
          </div>
        ) : null}
        <div>
          <dt>Spoken words</dt>
          <dd>{`${d.wordCount} of ${d.wordBudget}`}</dd>
        </div>
      </dl>
      <p className="why-h">Why this length:</p>
      <ul className="list why-list">
        {d.reasons.map((r: string, i: number) => (
          <li key={i}>{r}</li>
        ))}
      </ul>
      {d.warnings?.length ? (
        <Fold summary={`${plural(d.warnings.length, "note")} about the story`} id="story-notes">
          <ul className="list">
            {d.warnings.map((w: string, i: number) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </Fold>
      ) : null}
    </Reveal>
  );
}

const DIMS: Record<string, [number, number]> = { "16x9": [1920, 1080], "9x16": [1080, 1920], "1x1": [1080, 1080] };
const ORDER = ["16x9", "9x16", "1x1"];
const SHAPE_WORD: Record<string, string> = { "16x9": "Landscape", "9x16": "Portrait", "1x1": "Square" };
const RATIO: Record<string, string> = { "16x9": "16:9", "9x16": "9:16", "1x1": "1:1" };
const vttFor = (srt: string | null) => (srt ? srt.replace(/\.srt(\?.*)?$/, ".vtt") : null);

/** The shape of a format, drawn small, for the switcher. */
function Shape({ format }: { format: string }) {
  const [w, h] = DIMS[format] ?? [1, 1];
  const s = 20 / Math.max(w, h);
  return <span className="shape" style={{ width: Math.round(w * s), height: Math.round(h * s) }} />;
}

/**
 * One player and a switch between the formats. The player keeps its place: switching formats carries on
 * from the same moment (and keeps playing if it was). Each format keeps its own download.
 */
function Videos({ view }: { view: JobViewData }) {
  const outs = [...view.outputs].sort((a, b) => ORDER.indexOf(a.format) - ORDER.indexOf(b.format));
  const vtt = vttFor(view.srt);
  const [chosen, setChosen] = useState(outs[0]?.format ?? "");
  const o = outs.find((x) => x.format === chosen) ?? outs[0];
  const videoRef = useRef<HTMLVideoElement>(null);
  const carry = useRef<{ time: number; playing: boolean } | null>(null);
  const label = o ? (FORMAT_LABELS[o.format] ?? o.format) : "";

  function choose(f: string) {
    const v = videoRef.current;
    if (v) carry.current = { time: v.currentTime, playing: !v.paused && !v.ended };
    setChosen(f);
  }

  return (
    <section id="job-videos" className="job-block" aria-labelledby="videos-title">
      <h3 className="h3" id="videos-title" tabIndex={-1}>
        {outs.length ? "Watch and download" : "Download"}
      </h3>
      {o ? (
        <>
          {outs.length > 1 ? (
            <Segmented
              name="video-format"
              legend="Format"
              legendHidden
              className="format-switch"
              value={o.format}
              onChange={choose}
              options={outs.map((x) => ({
                value: x.format,
                icon: <Shape format={x.format} />,
                label: (
                  <>
                    <span className="visually-hidden">{`${SHAPE_WORD[x.format] ?? ""} `}</span>
                    {RATIO[x.format] ?? x.format}
                  </>
                ),
              }))}
            />
          ) : null}
          <div className="player" aria-live="off">
            <AnimatePresence mode="wait" initial={false}>
              <motion.figure
                key={o.format}
                className={`video video--${o.format}`}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0, transition: { duration: 0.22, ease: [0.22, 1, 0.36, 1] } }}
                exit={{ opacity: 0, transition: { duration: 0.1 } }}
              >
                <div className="video__frame">
                  <video
                    ref={videoRef}
                    controls
                    preload="metadata"
                    playsInline
                    poster={o.poster ?? undefined}
                    src={o.url}
                    width={DIMS[o.format]?.[0]}
                    height={DIMS[o.format]?.[1]}
                    data-format={o.format}
                    aria-label={`${label} video`}
                    onLoadedMetadata={(e) => {
                      const c = carry.current;
                      carry.current = null;
                      if (!c) return;
                      const v = e.currentTarget;
                      if (c.time > 0 && c.time < v.duration) v.currentTime = c.time;
                      if (c.playing) v.play().catch(() => {});
                    }}
                  >
                    {vtt ? <track kind="captions" src={vtt} srcLang="en-GB" label="English captions" /> : null}
                  </video>
                </div>
              </motion.figure>
            </AnimatePresence>
          </div>
        </>
      ) : null}
      <ul className="downloads">
        {o ? (
          <li>
            <a className="download" href={o.download} download>
              <DownloadSimple size={22} weight="bold" aria-hidden="true" />
              <span>
                Download MP4 <span className="download__size">{formatBytes(o.bytes)}</span>
                <span className="visually-hidden">{`, ${label}`}</span>
              </span>
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
    </section>
  );
}

/** Delete a finished, failed or stopped video, after asking. */
function DeleteJob({ title, onDelete }: { title: string; onDelete: () => Promise<string | void> }) {
  const [asking, setAsking] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const back = useRef(false);
  useEffect(() => {
    if (!asking && back.current) {
      back.current = false;
      triggerRef.current?.focus();
    }
  }, [asking]);
  return (
    <section className="job-block job-delete" aria-label="Delete this video">
      {asking ? (
        <ConfirmDelete
          title={title}
          onYes={onDelete}
          onCancel={() => {
            back.current = true;
            setAsking(false);
          }}
        />
      ) : (
        <Button ref={triggerRef} variant="subtle" className="job-delete__button" leftSection={<Trash size={20} weight="regular" aria-hidden="true" />} onClick={() => setAsking(true)}>
          Delete video
        </Button>
      )}
    </section>
  );
}

/**
 * "Tell me when it's ready": asks the browser for permission only when ticked, then the page sends one quiet
 * notification when the video is ready and the tab is hidden. Not shown where notifications do not exist.
 */
function NotifyToggle({ on, setOn }: { on: boolean; setOn: (on: boolean) => void }) {
  const [note, setNote] = useState("");
  if (typeof window === "undefined" || !("Notification" in window)) return null;
  const blocked = "Notifications are blocked for this site. Allow them in your browser settings.";
  async function change(want: boolean) {
    setNote("");
    if (!want) return setOn(false);
    let perm: NotificationPermission = Notification.permission;
    if (perm === "default") {
      try {
        // Older Safari takes a callback and returns nothing.
        perm = await new Promise<NotificationPermission>((resolve) => {
          const p = Notification.requestPermission(resolve);
          if (p && typeof p.then === "function") p.then(resolve, () => resolve("denied"));
        });
      } catch {
        perm = "denied";
      }
    }
    if (perm === "granted") setOn(true);
    else {
      setOn(false);
      setNote(perm === "denied" ? blocked : "");
    }
  }
  return (
    <div className="notify">
      <label className="notify__choice" htmlFor="notify-ready">
        <input type="checkbox" id="notify-ready" checked={on} onChange={(e) => void change(e.target.checked)} aria-describedby={note ? "notify-note" : undefined} />
        <span>Tell me when it’s ready</span>
      </label>
      <p className="notify__note" id="notify-note" aria-live="polite">
        {note}
      </p>
    </div>
  );
}

/** The contact sheet as a short preview; the whole sheet opens full size. */
function Sheet({ src }: { src: string }) {
  return (
    <Reveal as="section" id="job-sheet" className="job-block" aria-labelledby="sheet-h">
      <h3 className="h3" id="sheet-h">
        Contact sheet
      </h3>
      <p className="sheet">
        <a href={src} target="_blank" rel="noopener">
          <img src={src} alt="Contact sheet: one still of each scene in each format." />
          <span className="sheet__open">
            <ArrowSquareOut size={20} weight="bold" aria-hidden="true" />
            Open full size<span className="visually-hidden"> (new tab)</span>
          </span>
        </a>
      </p>
    </Reveal>
  );
}

export { ICON };
