// Staged edits to a finished video: words (the script draft), per-scene scheme and motion, and the
// whole-video look. Nothing is sent until Remake. Builds the full spec for PUT /api/jobs/:id/spec.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { clone } from "../shared/api";
import { collect, toDraft, type Draft } from "./ScriptEditor";
import type { Look } from "./types";

export type SceneMotion = { entrance?: string; transition?: string; text?: string; shape?: string };
interface Staged {
  draft: Draft;
  /** scene index → scheme id, or "" for Auto. Absent: unchanged. */
  schemes: Record<number, string>;
  motion: Record<number, SceneMotion>;
  look: Look | null;
}

export interface Change {
  key: string;
  text: string;
  kind: "look" | "words";
  undo: () => void;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const cleanMotion = (m: SceneMotion | undefined) => {
  if (!m) return undefined;
  const out: SceneMotion = {};
  for (const [k, v] of Object.entries(m)) if (v) (out as Record<string, string>)[k] = v;
  return Object.keys(out).length ? out : undefined;
};

export function useStaged(spec: any | null, sceneLabel: (i: number) => string, schemeName: (id: string) => string) {
  const sig = spec ? JSON.stringify(spec) : "";
  const [state, setState] = useState<Staged | null>(null);
  const baseSig = useRef("");
  const history = useRef<Staged[]>([]);
  const future = useRef<Staged[]>([]);

  const reset = useCallback(() => {
    if (!spec) {
      setState(null);
      return;
    }
    baseSig.current = sig;
    history.current = [];
    future.current = [];
    setState({ draft: toDraft(spec), schemes: {}, motion: {}, look: null });
  }, [sig]); // eslint-disable-line react-hooks/exhaustive-deps

  // A new script from the server replaces the staged edits only when nothing is staged.
  const built = useMemo(() => (spec && state ? build(spec, state) : null), [sig, state]); // eslint-disable-line react-hooks/exhaustive-deps
  // Compare against the script as the editor would write it back, so tidying alone is not a change.
  const norm = useMemo(() => (spec ? collect(spec, toDraft(spec)) : null), [sig]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = Boolean(norm && built && !same(built, norm));
  useEffect(() => {
    if (baseSig.current === sig) return;
    if (!dirty) reset();
  }, [sig]); // eslint-disable-line react-hooks/exhaustive-deps

  const update = useCallback((fn: (s: Staged) => void) => {
    setState((cur) => {
      if (!cur) return cur;
      history.current = [...history.current.slice(-50), cur];
      future.current = [];
      const n = clone(cur);
      fn(n);
      return n;
    });
  }, []);

  const undoStep = useCallback(() => {
    setState((cur) => {
      const prev = history.current.pop();
      if (!prev || !cur) return cur;
      future.current.push(cur);
      return prev;
    });
  }, []);
  const redoStep = useCallback(() => {
    setState((cur) => {
      const next = future.current.pop();
      if (!next || !cur) return cur;
      history.current.push(cur);
      return next;
    });
  }, []);

  const changes: Change[] = [];
  if (norm && state && built) {
    const base = toDraft(spec);
    const ref = norm;
    if ((built.title ?? "") !== (ref.title ?? "")) changes.push({ key: "title", kind: "look", text: "Title", undo: () => update((s) => void (s.draft.title = base.title)) });
    if (!same(built.look, ref.look)) changes.push({ key: "look", kind: "look", text: "Look for the whole video", undo: () => update((s) => void (s.look = null)) });
    built.scenes.forEach((sc: any, i: number) => {
      const was = ref.scenes[i];
      if (!same(sc.slots, was.slots) || !same(sc.voiceover, was.voiceover))
        changes.push({ key: `w${i}`, kind: "words", text: `Scene ${i + 1}: words`, undo: () => update((s) => void (s.draft.scenes[i] = base.scenes[i])) });
      if (!same(sc.scheme, was.scheme))
        changes.push({ key: `s${i}`, kind: "look", text: `Scene ${i + 1}: scheme ${sc.scheme ? schemeName(sc.scheme) : "Auto"}`, undo: () => update((s) => void delete s.schemes[i]) });
      if (!same(sc.motion, was.motion)) changes.push({ key: `m${i}`, kind: "look", text: `Scene ${i + 1}: motion`, undo: () => update((s) => void delete s.motion[i]) });
    });
  }
  void sceneLabel;

  return {
    state,
    built,
    dirty,
    changes,
    update,
    reset,
    undoStep,
    redoStep,
    lookOnly: changes.length > 0 && changes.every((c) => c.kind === "look"),
  };
}

function build(spec: any, s: Staged): any {
  const next = collect(spec, s.draft);
  for (const [k, v] of Object.entries(s.schemes)) {
    const sc = next.scenes[Number(k)];
    if (!sc) continue;
    if (v) sc.scheme = v;
    else delete sc.scheme;
  }
  for (const [k, v] of Object.entries(s.motion)) {
    const sc = next.scenes[Number(k)];
    if (!sc) continue;
    const m = cleanMotion(v);
    if (m) sc.motion = m;
    else delete sc.motion;
  }
  if (s.look) {
    const l: Look = {};
    if (s.look.schemes) l.schemes = s.look.schemes;
    if (s.look.schemes === "single" && s.look.scheme) l.scheme = s.look.scheme;
    if (s.look.motionStyle) l.motionStyle = s.look.motionStyle;
    if (Object.keys(l).length) next.look = l;
    else delete next.look;
  }
  return next;
}
