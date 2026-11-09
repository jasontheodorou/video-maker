// The brand editor, one column: a status card (saved or not, ready or not, and a Save button that only
// appears when there is something to save), then each part of the brand as a card that opens and closes,
// with a short summary on its header. Changes are checked and previewed as you type; uploads save
// straight away. When there are unsaved changes and the status card has scrolled away, a small save bar
// rises at the bottom; saving from it turns the bar into a tick and "Saved" before it slides away (and
// Ctrl or Cmd + S saves from anywhere).
import { Button, Loader } from "@mantine/core";
import { ArrowLeft, CheckCircle, FileText, FloppyDisk, IdentificationCard, ImageSquare, ListChecks, Microphone, Monitor, Palette, PenNib, Shapes, TextAa, Trash, WarningCircle } from "@phosphor-icons/react";
import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { announce, api, clone, focusNode, setPath } from "../shared/api";
import { Collapse, PulseDot, Reveal, SuccessCheck, Swap, duration, ease, spring } from "../shared/motion";
import { ErrorSummary, InlineConfirm, Message, PageTitle, SkeletonBlock, SkeletonLines, type SummaryItem } from "../shared/ui";
import type { Meta } from "../make/types";
import { EditorContext, checkCounts, plural, problemsBySection, sectionFor, type Check, type EditorCtx, type FontReport } from "./context";
import { ColoursSection } from "./colours";
import { FontsSection } from "./fonts";
import { GuidelinesSection } from "./guidelines";
import { EditorSection } from "./parts";
import { Checks, Preview, type PreviewItem } from "./preview";
import { AboutSection, IconsSection, LogoSection, VoiceSection, WritingSection } from "./sections";

const capitalise = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);

export const DELETE_DETAIL = ["The brand and all its files go. This cannot be undone.", "Videos already made are kept, but cannot be remade with this brand."];

const CLOSED_KEY = "brand-editor-closed";
function readClosed(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(CLOSED_KEY) ?? "[]"));
  } catch {
    return new Set();
  }
}
function writeClosed(s: Set<string>) {
  try {
    localStorage.setItem(CLOSED_KEY, JSON.stringify([...s]));
  } catch {
    /* private window: nothing to remember */
  }
}

interface Props {
  id: string;
  notes?: string[];
  meta: Meta;
  onBack: () => void;
  onLoadError: (msg: string) => void;
  removeBrand: (b: { id: string; name: string }) => Promise<string | void>;
}

type SaveState = { kind: "idle" } | { kind: "saving" } | { kind: "saved"; ok: boolean; at: number } | { kind: "failed"; text: string };

export function BrandEditor({ id, notes, meta, onBack, onLoadError, removeBrand }: Props) {
  const [detail, setDetail] = useState<any>(null);
  const [draft, setDraft] = useState<any>(null);
  const [saved, setSaved] = useState("");
  const [check, setCheck] = useState<Check | null>(null);
  const [files, setFiles] = useState<any>(null);
  const [icons, setIcons] = useState<{ client: string[]; library: number }>({ client: [], library: 0 });
  const [suggestions, setSuggestions] = useState<any>(null);
  const [revision, setRevision] = useState(0);
  const [fontReport, setFontReport] = useState<FontReport>(null);
  const [saveState, setSaveState] = useState<SaveState>({ kind: "idle" });
  const [topErrors, setTopErrors] = useState<{ title: string; items: SummaryItem[]; key: number }>({ title: "", items: [], key: 0 });
  const [preview, setPreview] = useState<{ items: PreviewItem[] | null; error: string | null; busy: boolean }>({ items: null, error: null, busy: false });
  const [leaving, setLeaving] = useState(false);
  const [closed, setClosed] = useState<Set<string>>(readClosed);
  const [cardInView, setCardInView] = useState(true);
  // The save bar's "Saved" moment: while set, the bar stays up showing a tick instead of the button.
  const [barDone, setBarDone] = useState(0);
  const lastField = useRef<HTMLElement | null>(null);
  const cardRef = useRef<HTMLElement>(null);
  const leaveRef = useRef<HTMLDivElement>(null);
  const saving = useRef(false);
  const previewSeq = useRef(0);

  const draftJson = draft ? JSON.stringify(draft) : "";
  const dirty = Boolean(draft) && draftJson !== saved;

  // Open: read the brand, then check and preview it.
  useEffect(() => {
    (async () => {
      let d: any;
      try {
        d = await api("GET", `/api/brands/${encodeURIComponent(id)}`);
      } catch (e) {
        onLoadError((e as Error).message);
        return;
      }
      window.history.replaceState(null, "", `/brands?brand=${encodeURIComponent(id)}`);
      document.title = `Edit ${d.raw.name} - Brands - Video maker`;
      setDetail(d);
      setDraft(clone(d.raw));
      setSaved(JSON.stringify(d.raw));
      setCheck(d.check);
      setFiles(d.files);
      setIcons(d.icons);
      requestAnimationFrame(() => document.getElementById("editor-title")?.focus());
    })();
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Live check (250 ms after typing stops) and preview (650 ms).
  useEffect(() => {
    if (!draftJson) return;
    const body = { brand: JSON.parse(draftJson) };
    const t1 = setTimeout(async () => {
      try {
        setCheck(await api<Check>("POST", `/api/brands/${encodeURIComponent(id)}/check`, body));
      } catch (e) {
        setCheck({ ok: false, issues: [{ level: "error", field: "brand", message: (e as Error).message }], contrast: [] });
      }
    }, 250);
    const t2 = setTimeout(async () => {
      const seq = ++previewSeq.current;
      setPreview((p) => ({ ...p, busy: true }));
      try {
        const r = await api<{ items: PreviewItem[] }>("POST", `/api/brands/${encodeURIComponent(id)}/preview`, body);
        if (seq === previewSeq.current) setPreview({ items: r.items, error: null, busy: false });
      } catch (e) {
        if (seq === previewSeq.current) setPreview((p) => ({ items: p.items, error: (e as Error).message, busy: false }));
      }
    }, 650);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [draftJson, id]);

  // Leaving the page with unsaved changes asks first.
  useEffect(() => {
    const fn = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", fn);
    return () => window.removeEventListener("beforeunload", fn);
  }, [dirty]);

  useEffect(() => {
    if (draft?.name) document.title = `Edit ${draft.name} - Brands - Video maker`;
  }, [draft?.name]);

  useEffect(() => {
    if (leaving) leaveRef.current?.focus();
  }, [leaving]);

  // Remember the last control used outside the save bar, so focus can go back there after a bar save.
  useEffect(() => {
    const fn = (e: FocusEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && t !== document.body && !t.closest(".save-bar")) lastField.current = t;
    };
    document.addEventListener("focusin", fn);
    return () => document.removeEventListener("focusin", fn);
  }, []);

  useEffect(() => {
    if (!barDone) return;
    const t = setTimeout(() => setBarDone(0), 1300);
    return () => clearTimeout(t);
  }, [barDone]);

  // Is the status card on screen? If not, the floating save bar takes over.
  const ready = Boolean(draft && detail && files);
  useEffect(() => {
    const el = cardRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setCardInView(e.isIntersecting), { rootMargin: "-72px 0px 0px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [ready]);

  const edit = useCallback((fn: (d: any) => void) => {
    setSaveState((s) => (s.kind === "saving" ? s : { kind: "idle" }));
    setDraft((d: any) => {
      const n = clone(d);
      fn(n);
      return n;
    });
  }, []);
  const setValue = useCallback((path: string, value: unknown) => edit((d) => setPath(d, path, value)), [edit]);
  const bump = useCallback(() => setRevision((r) => r + 1), []);

  const isOpen = useCallback((sid: string) => !closed.has(sid), [closed]);
  const setOpen = useCallback((sid: string, open: boolean) => {
    setClosed((c) => {
      if (open !== c.has(sid)) return c;
      const n = new Set(c);
      if (open) n.delete(sid);
      else n.add(sid);
      writeClosed(n);
      return n;
    });
  }, []);
  const go = useCallback(
    (sid: string) => {
      setOpen(sid, true);
      requestAnimationFrame(() => {
        const h = document.getElementById(`${sid}-h`);
        if (!h) return;
        h.scrollIntoView({ block: "start" });
        h.focus({ preventScroll: true });
      });
    },
    [setOpen],
  );

  const deleteFile = useCallback(
    async (rel: string): Promise<string | void> => {
      try {
        const r = await api<any>("POST", `/api/brands/${encodeURIComponent(id)}/files-delete`, { path: rel });
        setFiles(r.files);
        if (r.icons) setIcons(r.icons);
        // Faces that pointed at the file are gone from the saved brand; drop them from the draft too.
        edit((d) => (d.fonts.faces = d.fonts.faces.filter((f: any) => f.src !== rel)));
        // The Delete button is gone: go back to the top of its section.
        const sec = /^fonts\//.test(rel) ? "sec-fonts-h" : /^logo\//.test(rel) ? "sec-logo-h" : "sec-icons-h";
        requestAnimationFrame(() => focusNode(document.getElementById(sec)));
        announce("The file has been deleted.");
      } catch (e) {
        return `The file could not be deleted. ${(e as Error).message}`;
      }
    },
    [edit, id],
  );

  const ctx = useMemo<EditorCtx | null>(
    () =>
      draft && detail && files
        ? { id, meta, detail, draft, edit, setValue, check, files, setFiles, icons, setIcons, deleteFile, suggestions, setSuggestions, revision, bump, fontReport, setFontReport, isOpen, setOpen, go }
        : null,
    [id, meta, detail, draft, edit, setValue, check, files, icons, deleteFile, suggestions, revision, bump, fontReport, isOpen, setOpen, go],
  );

  async function save(from: "card" | "bar" | "key") {
    // aria-disabled, not disabled: a disabled button drops keyboard focus to the page.
    if (saving.current || !draft) return;
    saving.current = true;
    setSaveState({ kind: "saving" });
    try {
      const r = await api<any>("PUT", `/api/brands/${encodeURIComponent(id)}`, { brand: draft });
      setCheck(r.check);
      setFiles(r.files);
      if (r.saved) {
        setDraft(clone(r.raw));
        setSaved(JSON.stringify(r.raw));
        setTopErrors((t) => ({ title: "", items: [], key: t.key + 1 }));
        setSaveState({ kind: "saved", ok: r.check.ok, at: Date.now() });
        bump();
        const active = document.activeElement as HTMLElement | null;
        if (active?.closest(".save-bar")) {
          // The bar's button is about to go: put focus back where the person was working.
          const back = lastField.current;
          if (back && back.isConnected) back.focus();
          else focusNode(document.getElementById("save-status"), { preventScroll: true });
        } else if (active?.id === "save-button") {
          // The card's button hides once everything is saved: the status line takes focus and says so.
          requestAnimationFrame(() => focusNode(document.getElementById("save-status"), { preventScroll: true }));
        }
        if (!cardInView && from !== "card") setBarDone(Date.now());
      } else {
        const errs = r.check.issues.filter((i: any) => i.level === "error");
        setSaveState({ kind: "failed", text: "Not saved. Fix the problems above." });
        for (const i of errs) setOpen(sectionFor(i.field).id, true);
        setTopErrors((t) => ({
          title: "The brand could not be saved",
          items: errs.map((i: any) => ({ text: `${sectionFor(i.field).label}: ${i.message}`, target: `${sectionFor(i.field).id}-h` })),
          key: t.key + 1,
        }));
      }
    } catch (e) {
      setSaveState({ kind: "failed", text: "Not saved." });
      setTopErrors((t) => ({ title: "The brand could not be saved", items: [(e as Error).message], key: t.key + 1 }));
    } finally {
      saving.current = false;
    }
  }

  // Ctrl or Cmd + S saves from anywhere in the editor.
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        saveRef.current("key");
      }
    };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, []);

  function back(e: React.MouseEvent) {
    e.preventDefault();
    if (dirty) setLeaving(true);
    else onBack();
  }

  if (!ctx) {
    return (
      <div className="page-head">
        <SkeletonLines lines={1} height={44} label="Loading the brand" />
        <div className="section-gap">
          <SkeletonBlock height={120} label="" />
        </div>
        <div className="block-gap-sm">
          <SkeletonBlock height={72} label="" />
        </div>
        <div className="block-gap-sm">
          <SkeletonBlock height={72} label="" />
        </div>
      </div>
    );
  }

  const { errors: nErrors, warnings: nWarnings } = checkCounts(check);
  const problems = problemsBySection(check);
  const isSaving = saveState.kind === "saving";

  // What the status card says, and the matching mark beside it.
  const saveText =
    saveState.kind === "saving"
      ? "Saving..."
      : saveState.kind === "failed"
        ? saveState.text
        : dirty
          ? "Unsaved changes"
          : saveState.kind === "saved"
            ? "Saved"
            : "All changes saved";
  const mark: ReactNode =
    saveState.kind === "saving" ? (
      <Loader size={22} color="ink.8" />
    ) : saveState.kind === "failed" ? (
      <WarningCircle size={30} weight="fill" className="mark--bad" />
    ) : dirty ? (
      <PulseDot />
    ) : saveState.kind === "saved" ? (
      <SuccessCheck key={saveState.at} size={30} />
    ) : (
      <CheckCircle size={30} weight="fill" className="mark--ok" />
    );
  const checkText = nErrors ? `${plural(nErrors, "problem")} stop${nErrors === 1 ? "s" : ""} it being used` : nWarnings ? `Ready to use · ${plural(nWarnings, "warning")}` : "Ready to use";
  const showSave = dirty || saveState.kind === "saving" || saveState.kind === "failed";

  // Header summaries: what is set, in a few words.
  const colourCount = Object.keys(draft.colours ?? {}).filter((k) => draft.colours[k]).length;
  const pairs = check?.contrast ?? [];
  const failing = pairs.filter((p) => !p.result.passesAAA).length;
  const voiceLabel = (detail.voices ?? meta.voices).find((v: any) => v.id === draft.voice?.id)?.label ?? draft.voice?.id;
  const ownIcons = (files.icons ?? []).length;
  const rulesCount = (draft.rules?.do?.length ?? 0) + (draft.rules?.dont?.length ?? 0);
  const prov = (draft.provisional ?? []).length;

  const swatches = (
    <span className="swatches" aria-hidden="true">
      {["primary", "accent", "tint", "text"].map((k) =>
        draft.colours?.[k]?.value ? <span key={k} className="swatches__dot" style={{ background: draft.colours[k].value }} /> : null,
      )}
    </span>
  );

  const sections: Array<{ id: string; title: string; icon: ReactNode; summary?: ReactNode; body: ReactNode }> = [
    { id: "sec-about", title: "Name", icon: <IdentificationCard size={24} />, summary: prov ? `${prov} still to confirm` : draft.fictional ? "Sample brand" : "Confirmed", body: <AboutSection /> },
    { id: "sec-guidelines", title: "Guidelines", icon: <FileText size={24} />, summary: files.documents?.length ? plural(files.documents.length, "file") : "Optional, fills things in for you", body: <GuidelinesSection /> },
    {
      id: "sec-colours",
      title: "Colours",
      icon: <Palette size={24} />,
      summary: (
        <>
          {swatches}
          {`${colourCount} colours · ${pairs.length ? (failing ? `${failing} fail contrast` : "all pass AAA") : "checking"}`}
        </>
      ),
      body: <ColoursSection />,
    },
    {
      id: "sec-preview",
      title: "Preview",
      icon: <Monitor size={24} />,
      summary: preview.busy ? (
        <span className="busy-inline">
          <PulseDot /> Updating
        </span>
      ) : (
        "Title, statement and end card"
      ),
      body: <Preview items={preview.items} error={preview.error} />,
    },
    { id: "sec-fonts", title: "Fonts", icon: <TextAa size={24} />, summary: draft.fonts.heading.family === draft.fonts.body.family ? draft.fonts.body.family : `${draft.fonts.heading.family} and ${draft.fonts.body.family}`, body: <FontsSection /> },
    { id: "sec-logo", title: "Logo", icon: <ImageSquare size={24} />, summary: draft.logo.onDark ? String(draft.logo.onDark).replace(/^logo\//, "") : "Not set", body: <LogoSection /> },
    { id: "sec-icons", title: "Icons and graphics", icon: <Shapes size={24} />, summary: `${capitalise(draft.icons?.weight ?? "regular")} weight${ownIcons ? ` · ${plural(ownIcons, "own icon")}` : ""}`, body: <IconsSection /> },
    { id: "sec-voice", title: "Voice", icon: <Microphone size={24} />, summary: `${voiceLabel} · ${Number(draft.voice?.speed ?? 1).toFixed(2)}×`, body: <VoiceSection /> },
    { id: "sec-writing", title: "Writing", icon: <PenNib size={24} />, summary: draft.toneOfVoice ? `Tone set${rulesCount ? ` · ${plural(rulesCount, "rule")}` : ""}` : "No tone of voice yet", body: <WritingSection /> },
    { id: "sec-checks", title: "Checks", icon: <ListChecks size={24} />, summary: checkText, body: <Checks /> },
  ];
  const allOpen = sections.every((s) => isOpen(s.id));
  const barSaved = barDone > 0 && !dirty;
  const showBar = (dirty && !cardInView && !leaving) || barSaved;

  return (
    <EditorContext.Provider value={ctx}>
      <div className="page-head editor-head">
        <a href="/brands" onClick={back} className="back-link">
          <ArrowLeft size={20} weight="bold" aria-hidden="true" />
          All brands
        </a>
        <Collapse open={leaving}>
          <div className="confirm leave" role="group" aria-labelledby="leave-q" ref={leaveRef} tabIndex={-1}>
            <Message tone="warn">
              <h2 id="leave-q">Leave without saving?</h2>
              <div className="buttons">
                <Button className="danger" color="red" onClick={onBack}>
                  Leave without saving
                </Button>
                <Button variant="default" onClick={() => setLeaving(false)}>
                  Stay
                </Button>
              </div>
            </Message>
          </div>
        </Collapse>
        <PageTitle id="editor-title">{`Edit ${draft.name}`}</PageTitle>
      </div>

      {detail.protected ? (
        <Reveal className="editor-note">
          <Message tone="info">
            <p>The sample brand. You can change it but not delete it. For a real organisation, add or duplicate a brand.</p>
          </Message>
        </Reveal>
      ) : null}
      {notes?.length ? (
        <Reveal className="editor-note">
          <Message tone="warn">
            <h2>Next steps</h2>
            <ul>
              {notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          </Message>
        </Reveal>
      ) : null}
      <div
        id="top-errors"
        className="editor-note-errors"
        onClickCapture={(e) => {
          // A link to a closed card opens it before the summary moves focus to its heading.
          const href = (e.target as HTMLElement).closest("a")?.getAttribute("href") ?? "";
          const m = /^#(sec-[\w-]+?)-h$/.exec(href);
          if (m) setOpen(m[1], true);
        }}
      >
        <ErrorSummary title={topErrors.title || "There is a problem"} items={topErrors.items} focusKey={topErrors.key} />
      </div>

      {/* Where the brand stands, and the one place to save. */}
      <section className="save-card" aria-labelledby="save-h" ref={cardRef}>
        <h2 className="visually-hidden" id="save-h">
          Saving
        </h2>
        <span className="save-card__mark" aria-hidden="true">
          {mark}
        </span>
        <div className="save-card__text">
          <p className="save-card__status" id="save-status" role="status">
            <Swap id={saveText}>{saveText}</Swap>
          </p>
          <Collapse open={dirty}>
            <p className="save-card__note">Uploads save on their own.</p>
          </Collapse>
          <p className="save-card__check">
            <a
              href="#sec-checks"
              id="check-summary"
              className={nErrors ? "bad-text" : "ok-text"}
              onClick={(e) => {
                e.preventDefault();
                go("sec-checks");
              }}
            >
              {checkText}
            </a>
          </p>
        </div>
        <AnimatePresence initial={false}>
          {showSave ? (
            <motion.div
              key="save"
              className="save-card__button-wrap"
              initial={{ opacity: 0, scale: 0.92 }}
              animate={{ opacity: 1, scale: 1, transition: spring.snappy }}
              exit={{ opacity: 0, scale: 0.92, transition: { duration: duration.fast, ease: ease.out } }}
            >
              <Button id="save-button" className="save-card__button" onClick={() => save("card")} aria-disabled={isSaving || undefined} leftSection={isSaving ? <Loader size={18} color="white" /> : <FloppyDisk size={22} weight="regular" aria-hidden="true" />}>
                Save brand
              </Button>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </section>

      <div className="ed-list-head">
        <h2 className="visually-hidden">Parts of the brand</h2>
        <Button
          variant="subtle"
          className="small"
          onClick={() => {
            const n = allOpen ? new Set(sections.map((s) => s.id)) : new Set<string>();
            setClosed(n);
            writeClosed(n);
          }}
        >
          {allOpen ? "Close all" : "Open all"}
        </Button>
      </div>
      <div className="ed-list">
        {sections.map((s) => (
          <EditorSection key={s.id} id={s.id} title={s.title} sectionIcon={s.icon} summary={s.summary} problems={problems[s.id] ?? 0}>
            {s.body}
          </EditorSection>
        ))}
      </div>

      {detail.protected ? null : (
        <section className="danger-zone" id="sec-delete" aria-labelledby="sec-delete-h">
          <h2 className="h4" id="sec-delete-h" tabIndex={-1}>
            <Trash size={22} weight="regular" aria-hidden="true" /> Delete this brand
          </h2>
          <p className="danger-zone__text">Removes the brand and its files. Videos already made are kept.</p>
          <div className="block-gap-sm">
            <InlineConfirm trigger="Delete brand" triggerProps={{ className: "quiet-danger" }} question={`Delete ${draft.name}?`} detail={DELETE_DETAIL} yes="Yes, delete this brand" onYes={() => removeBrand({ id, name: draft.name })} />
          </div>
        </section>
      )}

      {/* The save bar: only when there is something to save and the status card is out of sight. */}
      <div className="save-bar-wrap">
        <AnimatePresence>
          {showBar ? (
            <motion.div
              className={`save-bar${barSaved ? " save-bar--done" : ""}`}
              role="region"
              aria-label="Saving"
              layout
              style={{ borderRadius: 999 }}
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0, transition: spring.gentle }}
              exit={{ opacity: 0, y: 16, transition: { duration: duration.base, ease: ease.out } }}
              transition={spring.snappy}
            >
              <motion.span layout="position" className="save-bar__mark" aria-hidden="true">
                {barSaved ? <SuccessCheck size={26} /> : <PulseDot />}
              </motion.span>
              <motion.span layout="position" className="save-bar__text">
                <Swap id={barSaved ? "saved" : "unsaved"}>
                  {barSaved ? (
                    "Saved"
                  ) : (
                    <>
                      Unsaved<span className="save-bar__long"> changes</span>
                    </>
                  )}
                </Swap>
              </motion.span>
              {barSaved ? null : (
                <motion.span layout="position" className="save-bar__action">
                  <Button className="save-bar__button" onClick={() => save("bar")} aria-disabled={isSaving || undefined} leftSection={isSaving ? <Loader size={18} color="ink.8" /> : <FloppyDisk size={20} weight="regular" aria-hidden="true" />}>
                    Save<span className="save-bar__long"> brand</span>
                  </Button>
                </motion.span>
              )}
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    </EditorContext.Provider>
  );
}
