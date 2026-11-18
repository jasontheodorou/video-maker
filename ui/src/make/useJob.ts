// Polls one video (1 s while busy, 3 s after an error), keeps the tab title and the ended notification.
import { useCallback, useEffect, useRef, useState } from "react";
import { announce, api } from "../shared/api";
import { isBusy, type Job, type JobViewData } from "./types";

const APP_NAME = "Video maker";
const ENDED_TITLE: Record<string, string> = { done: "Ready", error: "Problem", stopped: "Stopped" };

function notifyEnded(job: Job) {
  try {
    if (!("Notification" in window) || Notification.permission !== "granted" || !document.hidden) return;
    const n = new Notification(job.state === "done" ? "Your video is ready" : "There was a problem making your video", { body: job.title, tag: job.id, silent: true });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch {
    /* the tab title still says it */
  }
}

export function useJob(jobId: string | null, opts: { onStateChange?: () => void; initial?: JobViewData | null } = {}) {
  const [view, setView] = useState<JobViewData | null>(opts.initial && opts.initial.job.id === jobId ? opts.initial : null);
  const [pollError, setPollError] = useState<string | null>(null);
  const [notify, setNotifyState] = useState(false);
  const [endedTitle, setEndedTitle] = useState<string | null>(null);
  const idRef = useRef(jobId);
  const timer = useRef<number | undefined>(undefined);
  const lastState = useRef<string | null>(view?.job.state ?? null);
  const notifyRef = useRef(notify);
  notifyRef.current = notify;
  const onChange = useRef(opts.onStateChange);
  onChange.current = opts.onStateChange;

  const apply = useCallback((v: JobViewData) => {
    if (v.job.id !== idRef.current) return;
    setPollError(null);
    const before = lastState.current;
    lastState.current = v.job.state;
    setView(v);
    if (before && before !== v.job.state) {
      onChange.current?.();
      if (v.job.state === "done") announce("Your video is ready.");
      if (v.job.state === "error") announce("There was a problem making the video.");
      if (isBusy(before) && !isBusy(v.job.state)) {
        setEndedTitle(ENDED_TITLE[v.job.state] ?? null);
        if (notifyRef.current && v.job.state !== "stopped") notifyEnded(v.job);
        setNotifyState(false);
      }
    }
  }, []);

  const poll = useCallback(async () => {
    window.clearTimeout(timer.current);
    const id = idRef.current;
    if (!id) return;
    try {
      const v = await api<JobViewData>("GET", `/api/jobs/${encodeURIComponent(id)}`);
      if (id !== idRef.current) return;
      apply(v);
      if (isBusy(v.job.state)) timer.current = window.setTimeout(poll, 1000);
    } catch (e) {
      if (id !== idRef.current) return;
      setPollError((e as Error).message);
      if ((e as { status?: number }).status !== 404) timer.current = window.setTimeout(poll, 3000);
    }
  }, [apply]);

  useEffect(() => {
    idRef.current = jobId;
    const init = opts.initial && opts.initial.job.id === jobId ? opts.initial : null;
    setView(init);
    lastState.current = init?.job.state ?? null;
    setPollError(null);
    setEndedTitle(null);
    if (jobId) poll();
    return () => window.clearTimeout(timer.current);
  }, [jobId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Tab title.
  const j = view?.job;
  const title = j && jobId && j.id === jobId ? (j.state === "running" ? `${Math.round((j.progress ?? 0) * 100)}% · ${APP_NAME}` : j.state === "queued" ? `Waiting · ${APP_NAME}` : endedTitle ? `${endedTitle} · ${APP_NAME}` : `${j.title} · ${APP_NAME}`) : APP_NAME;
  useEffect(() => {
    document.title = title;
  }, [title]);
  useEffect(() => {
    if (!endedTitle) return;
    const clear = () => setEndedTitle(null);
    if (!document.hidden && document.hasFocus()) {
      const t = window.setTimeout(clear, 6000);
      return () => window.clearTimeout(t);
    }
    const onVisible = () => !document.hidden && clear();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", clear);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", clear);
    };
  }, [endedTitle]);

  return { view, pollError, poll, apply, notify, setNotify: setNotifyState };
}
