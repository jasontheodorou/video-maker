// The brand studio: the bin on the left lists the brand's areas and holds the save footer; the monitor
// shows one area at a time; the inspector on the right edits whatever is selected (or shows the
// area's defaults). Changes are checked as you type; Save brand (or Ctrl/Cmd+S) writes brand.json.
// Uploads save on their own.
import { Button, Loader } from "@mantine/core";
import { ArrowLeft, CheckCircle, FloppyDisk, WarningCircle } from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { announce, api, clone, focusNode, setPath } from "../shared/api";
import { ErrorSummary, InlineConfirm, Message, SkeletonBlock, SkeletonLines, Tag, type SummaryItem } from "../shared/ui";
import type { Meta } from "../make/types";
import { navigate, Link } from "../shared/router";
import { AppShell } from "../shared/studio";
import { AREAS, EditorContext, useEditor as useEditorSafe, checkCounts, plural, sectionFor, type Check, type EditorCtx, type FontReport, type Selection } from "./context";
import { ColourInspector, ColoursCanvas, ColoursDefaults, SchemeInspector, schemeState } from "./areas/Colours";
import { MotionCanvas } from "./areas/Motion";
import { FontsSection } from "./fonts";
import { GuidelinesSection } from "./guidelines";
import { Checks, Preview, type PreviewItem } from "./preview";
import { AboutSection, IconsSection, LogoSection, VoiceSection, WritingSection } from "./sections";
import { DELETE_DETAIL } from "./BrandsPage";

interface Props {
  id: string;
  area: string;
  notes?: string[];
  meta: Meta;
  onLoadError: (msg: string) => void;
  removeBrand: (b: { id: string; name: string }) => Promise<string | void>;
  /** Tell the workspace whether leaving should ask first. */
  setDirty: (dirty: boolean) => void;
  /** The "Leave without saving?" question, when it is being asked. */
  leaveBar?: ReactNode;
}

type SaveState = { kind: "idle" } | { kind: "saving" } | { kind: "saved"; at: number } | { kind: "failed"; text: string };

const AREA_IDS = AREAS.map((a) => a.id) as string[];
/** Areas with nothing to inspect: their canvas is a single column. */
const NO_INSPECTOR = new Set(["guidelines", "type", "logo", "icons", "voice", "writing", "checks", "motion"]);

export function Studio({ id, area: areaIn, notes, meta, onLoadError, removeBrand, setDirty, leaveBar }: Props) {
  const area = AREA_IDS.includes(areaIn) ? areaIn : "overview";
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
  const [preview, setPreview] = useState<{ items: PreviewItem[] | null; error: string | null }>({ items: null, error: null });
  const [selection, setSelection] = useState<Selection>(null);
  const saving = useRef(false);
  const previewSeq = useRef(0);

  const draftJson = draft ? JSON.stringify(draft) : "";
  const dirty = Boolean(draft) && draftJson !== saved;
  useEffect(() => setDirty(dirty), [dirty, setDirty]);

  // Open: read the brand.
  useEffect(() => {
    (async () => {
      let d: any;
      try {
        d = await api("GET", `/api/brands/${encodeURIComponent(id)}`);
      } catch (e) {
        onLoadError((e as Error).message);
        return;
      }
      setDetail(d);
      setDraft(clone(d.raw));
      setSaved(JSON.stringify(d.raw));
      setCheck(d.check);
      setFiles(d.files);
      setIcons(d.icons);
      requestAnimationFrame(() => focusNode(document.getElementById(`sec-${AREA_IDS.includes(areaIn) ? areaIn : "overview"}-h`)));
    })();
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  // A new area starts with nothing selected; its heading takes focus.
  const firstArea = useRef(true);
  useEffect(() => {
    setSelection(null);
    if (firstArea.current) {
      firstArea.current = false;
      return;
    }
    requestAnimationFrame(() => focusNode(document.getElementById(`sec-${area}-h`)));
  }, [area]);

  useEffect(() => {
    if (draft?.name) document.title = `${AREAS.find((a) => a.id === area)?.label} - ${draft.name} - Brands - Video maker`;
  }, [draft?.name, area]);

  // Live check 250 ms after typing stops; the full preview (Overview only) after 650 ms.
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
    let t2: ReturnType<typeof setTimeout> | undefined;
    if (area === "overview") {
      t2 = setTimeout(async () => {
        const seq = ++previewSeq.current;
        try {
          const r = await api<{ items: PreviewItem[] }>("POST", `/api/brands/${encodeURIComponent(id)}/preview`, body);
          if (seq === previewSeq.current) setPreview({ items: r.items, error: null });
        } catch (e) {
          if (seq === previewSeq.current) setPreview((p) => ({ items: p.items, error: (e as Error).message }));
        }
      }, 650);
    }
    return () => {
      clearTimeout(t1);
      if (t2) clearTimeout(t2);
    };
  }, [draftJson, id, area]);

  // Closing the tab with unsaved changes asks first.
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
  const goArea = useCallback((a: string) => navigate(`/brands/${encodeURIComponent(id)}/${a}`), [id]);
  const go = useCallback((sectionId: string) => goArea(sectionId.replace(/^sec-/, "")), [goArea]);
  const select = useCallback((s: Selection) => {
    setSelection(s);
    // On narrow screens the inspector sits below the canvas: bring it into view.
    if (s && window.matchMedia("(max-width: 1023px)").matches) requestAnimationFrame(() => document.getElementById("bw-inspector")?.scrollIntoView({ block: "start" }));
  }, []);

  const deleteFile = useCallback(
    async (rel: string): Promise<string | void> => {
      try {
        const r = await api<any>("POST", `/api/brands/${encodeURIComponent(id)}/files-delete`, { path: rel });
        setFiles(r.files);
        if (r.icons) setIcons(r.icons);
        edit((d) => (d.fonts.faces = d.fonts.faces.filter((f: any) => f.src !== rel)));
        requestAnimationFrame(() => focusNode(document.getElementById(`sec-${area}-h`)));
        announce("The file has been deleted.");
      } catch (e) {
        return `The file could not be deleted. ${(e as Error).message}`;
      }
    },
    [edit, id, area],
  );

  const ctx = useMemo<EditorCtx | null>(
    () =>
      draft && detail && files
        ? { id, meta, detail, draft, edit, setValue, check, files, setFiles, icons, setIcons, deleteFile, suggestions, setSuggestions, revision, bump, fontReport, setFontReport, isOpen: () => true, setOpen: () => undefined, go, area, selection, select }
        : null,
    [id, meta, detail, draft, edit, setValue, check, files, icons, deleteFile, suggestions, revision, bump, fontReport, go, area, selection, select],
  );

  async function save() {
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
        setSaveState({ kind: "saved", at: Date.now() });
        bump();
      } else {
        const errs = r.check.issues.filter((i: any) => i.level === "error" && i.blocking !== false);
        const list = errs.length ? errs : r.check.issues.filter((i: any) => i.level === "error");
        setSaveState({ kind: "failed", text: `Not saved: ${plural(list.length, "problem")}` });
        setTopErrors((t) => ({
          title: "The brand could not be saved",
          items: list.map((i: any) => ({ text: `${sectionFor(i.field).label}: ${i.message}`, target: `${sectionFor(i.field).id}-h` })),
          key: t.key + 1,
        }));
      }
    } catch (e) {
      setSaveState({ kind: "failed", text: "Not saved" });
      setTopErrors((t) => ({ title: "The brand could not be saved", items: [(e as Error).message], key: t.key + 1 }));
    } finally {
      saving.current = false;
    }
  }

  // Ctrl or Cmd + S saves from anywhere in the studio.
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        saveRef.current();
      }
    };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, []);

  if (!ctx) {
    return (
      <AppShell
        workspace="brands"
        bin={{ label: "Brand areas", content: <div className="bw-pad"><SkeletonLines lines={6} height={28} label="Loading the brand" /></div> }}
        monitor={<div className="bw-pad"><SkeletonBlock height={320} label="" /></div>}
      />
    );
  }

  // Problems per area, for the bin badges. Scheme problems count once per scheme.
  const problems: Record<string, number> = {};
  for (const i of check?.issues ?? []) {
    if (i.level !== "error") continue;
    const a = sectionFor(i.field).id.replace(/^sec-/, "");
    problems[a] = (problems[a] ?? 0) + 1;
  }
  const failingSchemes = draft.schemes.filter((s: any) => !schemeState(s, draft.palette).ok).length;
  problems.colours = Math.max(problems.colours ?? 0, failingSchemes) || 0;
  const { errors: nErrors } = checkCounts(check);
  problems.checks = nErrors;

  const saveText =
    saveState.kind === "saving" ? "Saving" : saveState.kind === "failed" ? saveState.text : dirty ? "Unsaved changes" : saveState.kind === "saved" ? "Saved" : "All changes saved";
  const mark: ReactNode =
    saveState.kind === "saving" ? (
      <Loader size={20} color="dark" />
    ) : saveState.kind === "failed" ? (
      <WarningCircle size={24} weight="fill" className="mark--bad" />
    ) : dirty ? (
      <span className="dirty-dot" />
    ) : (
      <CheckCircle size={24} weight="fill" className="mark--ok" />
    );

  const hasInspector = !NO_INSPECTOR.has(area);
  const areaLabel = AREAS.find((a) => a.id === area)!.label;

  const bin = (
    <div className="bw-bin">
      <div className="bw-pad">
        <Link to="/brands" className="back-link">
          <ArrowLeft size={20} weight="bold" aria-hidden="true" />
          All brands
        </Link>
        <h1 className="ws-title" id="editor-title" tabIndex={-1}>{`Edit ${draft.name}`}</h1>
        {detail.protected ? (
          <p className="bin-note">
            <Tag tone="" plain>
              Sample
            </Tag>{" "}
            Duplicate it to make a real brand.
          </p>
        ) : null}
        <nav aria-label="Brand areas">
          <ul className="plain-list area-list">
            {AREAS.map((a) => (
              <li key={a.id}>
                <Link to={`/brands/${encodeURIComponent(id)}/${a.id}`} className="area-link" aria-current={a.id === area ? "page" : undefined}>
                  <span>{a.label}</span>
                  {problems[a.id] ? <span className="area-badge">{plural(problems[a.id], "problem")}</span> : null}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
      <div className="bin-foot">
        <p className="save-line" id="save-status" role="status">
          <span className="save-line__mark" aria-hidden="true">
            {mark}
          </span>
          <span>{saveText}</span>
        </p>
        <Button id="save-button" fullWidth onClick={save} loading={saveState.kind === "saving"} aria-keyshortcuts="Control+S Meta+S" leftSection={<FloppyDisk size={22} aria-hidden="true" />}>
          Save brand
        </Button>
        <p className="bin-foot__hint">Uploads save on their own.</p>
      </div>
    </div>
  );

  const monitor = (
    <div className={`bw-pad bw-canvas${hasInspector ? "" : " bw-canvas--column"}`}>
      {leaveBar}
      <div className="area-jump field">
        <label className="label" htmlFor="area-jump">Brand area</label>
        <select className="select" id="area-jump" value={area} onChange={(e) => goArea(e.target.value)}>
          {AREAS.map((a) => (
            <option key={a.id} value={a.id}>
              {problems[a.id] ? `${a.label} (${plural(problems[a.id], "problem")})` : a.label}
            </option>
          ))}
        </select>
      </div>
      <div id="top-errors">
        <ErrorSummary title={topErrors.title || "There is a problem"} items={topErrors.items} focusKey={topErrors.key} />
      </div>
      {notes?.length && area === "overview" ? (
        <div className="area-band">
          <Message tone="warn">
            <h3>Next steps</h3>
            <ul>
              {notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          </Message>
        </div>
      ) : null}
      <section id={`sec-${area}`} aria-labelledby={`sec-${area}-h`} className={`area area--${area}`}>
        <h2 className="area-h" id={`sec-${area}-h`} tabIndex={-1}>
          {areaLabel}
        </h2>
        <AreaCanvas area={area} preview={preview} />
      </section>
    </div>
  );

  return (
    <EditorContext.Provider value={ctx}>
      <AppShell
        workspace="brands"
        bin={{ label: "Brand areas", content: bin }}
        monitor={monitor}
        inspector={hasInspector ? { label: "Inspector", content: <div className="bw-pad" id="bw-inspector"><Inspector area={area} removeBrand={removeBrand} /></div> } : null}
      />
    </EditorContext.Provider>
  );
}

function AreaCanvas({ area, preview }: { area: string; preview: { items: PreviewItem[] | null; error: string | null } }) {
  switch (area) {
    case "overview":
      return <Overview preview={preview} />;
    case "guidelines":
      return <GuidelinesSection />;
    case "colours":
      return <ColoursCanvas />;
    case "motion":
      return <MotionCanvas />;
    case "type":
      return <FontsSection />;
    case "logo":
      return <LogoSection />;
    case "icons":
      return <IconsSection />;
    case "voice":
      return <VoiceSection />;
    case "writing":
      return <WritingSection />;
    default:
      return <Checks />;
  }
}

function Inspector({ area, removeBrand }: { area: string; removeBrand: Props["removeBrand"] }) {
  const { selection, detail, draft, id } = useEditorSafe();
  if (area === "colours") {
    if (selection?.kind === "colour") return <ColourInspector key={selection.id} colourId={selection.id} />;
    if (selection?.kind === "scheme") return <SchemeInspector key={selection.id} schemeId={selection.id} />;
    return <ColoursDefaults />;
  }
  // Overview: the brand's details.
  return (
    <div className="insp-body">
      <h2 className="insp-h" id="insp-h">
        Details
      </h2>
      <AboutSection />
      {detail.protected ? null : (
        <div className="insp-danger">
          <h3 className="insp-sub">Delete brand</h3>
          <InlineConfirm trigger="Delete brand" triggerProps={{ className: "quiet-danger" }} question={`Delete ${draft.name}?`} detail={DELETE_DETAIL} yes="Yes, delete this brand" onYes={() => removeBrand({ id, name: draft.name })} />
        </div>
      )}
    </div>
  );
}

/** The kit at a glance, then the nine-frame preview. */
function Overview({ preview }: { preview: { items: PreviewItem[] | null; error: string | null } }) {
  const { draft, go, meta } = useEditorSafe();
  const styles: any[] = (meta as any).motion?.styles ?? [];
  const style = styles.find((s) => s.id === (draft.motion?.style ?? "calm"));
  const usable = draft.schemes.filter((s: any) => s.enabled !== false && schemeState(s, draft.palette).ok);
  return (
    <>
      <ul className="plain-list kit">
        <li className="kit__item">
          <h3 className="kit__h">
            <a href="#" onClick={(e) => (e.preventDefault(), go("sec-colours"))}>
              Colours
            </a>
          </h3>
          <span className="kit__sw" aria-hidden="true">
            {draft.palette.colours.slice(0, 8).map((c: any) => (
              <span key={c.id} style={{ background: c.value }} />
            ))}
          </span>
          <p>{`${plural(draft.palette.colours.length, "colour")}, ${plural(usable.length, "scheme")} in use`}</p>
        </li>
        <li className="kit__item">
          <h3 className="kit__h">
            <a href="#" onClick={(e) => (e.preventDefault(), go("sec-type"))}>
              Type
            </a>
          </h3>
          <p style={{ fontFamily: `"${draft.fonts.heading.family}", system-ui` }} className="kit__type">
            {draft.fonts.heading.family === draft.fonts.body.family ? draft.fonts.body.family : `${draft.fonts.heading.family} and ${draft.fonts.body.family}`}
          </p>
        </li>
        <li className="kit__item">
          <h3 className="kit__h">
            <a href="#" onClick={(e) => (e.preventDefault(), go("sec-motion"))}>
              Motion
            </a>
          </h3>
          <p>{style ? `${style.label}. ${style.line}` : "Calm"}</p>
        </li>
        <li className="kit__item">
          <h3 className="kit__h">
            <a href="#" onClick={(e) => (e.preventDefault(), go("sec-checks"))}>
              Checks
            </a>
          </h3>
          <OverviewChecks />
        </li>
      </ul>
      <div className="area-band">
        <h3 className="band-h">All formats</h3>
        <Preview items={preview.items} error={preview.error} />
      </div>
    </>
  );
}

function OverviewChecks() {
  const { check } = useEditorSafe();
  const { errors, warnings } = checkCounts(check);
  return <p>{errors ? `${plural(errors, "problem")} to fix` : warnings ? `Ready. ${plural(warnings, "thing")} worth a look` : "Ready. Passes every check"}</p>;
}

