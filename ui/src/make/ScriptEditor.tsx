// Edit the script: the words on screen and the voiceover for each scene, then make the video again.
import { Button, Loader } from "@mantine/core";
import { ArrowClockwise, CaretDown, Plus, X } from "@phosphor-icons/react";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { announce, api, clone, plural, type ApiError } from "../shared/api";
import { AnimatedItem, AnimatedList, Collapse, PulseDot, Reveal, duration, ease, spring } from "../shared/motion";
import { CharCount, ErrorSummary, countShown, type SummaryItem } from "../shared/ui";

/** A field's character count shows only once this few characters are left. */
const COUNT_WITHIN = 20;
import { isBusy, type JobViewData, type Meta } from "./types";

/** What each story beat does, in plain words. */
const BEAT_WORDS: Record<string, string> = { hook: "the opening", problem: "the problem", message: "the main message", insight: "what it means", proof: "the evidence", summary: "the summary", action: "what to do" };

const SLOT_LABELS: Record<string, string> = {
  title: "Title",
  eyebrow: "Small heading above the title",
  subtitle: "Line under the title",
  kicker: "Small heading",
  text: "Main text",
  support: "Supporting line",
  action: "What to do",
  link: "Web address",
  detail: "Extra detail",
  heading: "Heading",
  value: "Number",
  label: "What the number means",
  source: "Where the number comes from",
  quote: "Quote",
  name: "Name of the person quoted",
  role: "Their job or role",
  items: "List",
  emphasis: "Words to highlight",
  icon: "Icon",
  photo: "Photo",
  clip: "Video clip",
};

/** The label people see for a slot. Never the raw slot name. */
function slotLabel(slot: string) {
  return SLOT_LABELS[slot] ?? String(slot).charAt(0).toUpperCase() + String(slot).slice(1).replace(/([A-Z])/g, " $1").toLowerCase();
}

interface Phrase {
  k: string;
  text: string;
}
interface SceneDraft {
  slots: Record<string, string>;
  items: string[];
  emphasis: string;
  icon: string;
  vo: Phrase[];
}
interface Draft {
  title: string;
  scenes: SceneDraft[];
}

let phraseSeq = 0;
const phrase = (text: string): Phrase => ({ k: `p${++phraseSeq}`, text });

function toDraft(spec: any): Draft {
  return {
    title: spec.title ?? "",
    scenes: spec.scenes.map((s: any) => {
      const items: any[] = Array.isArray(s.slots.items) ? s.slots.items : [];
      const key = items[0] && "label" in items[0] ? "label" : "text";
      const slots: Record<string, string> = {};
      for (const [k, v] of Object.entries(s.slots)) if (typeof v === "string") slots[k] = v;
      return { slots, items: items.map((it) => it[key] ?? ""), emphasis: (s.slots.emphasis ?? []).join(", "), icon: s.slots.icon?.icon ?? "", vo: (s.voiceover ?? []).map(phrase) };
    }),
  };
}

/** The spec with the edits applied, in the same way the first version of the page collected them. */
function collect(spec: any, d: Draft): any {
  const next = clone(spec);
  next.title = d.title.trim();
  next.scenes.forEach((s: any, si: number) => {
    const sd = d.scenes[si];
    for (const [slot, raw] of Object.entries(sd.slots)) {
      if (typeof spec.scenes[si].slots[slot] !== "string" && raw === "") {
        delete s.slots[slot];
        continue;
      }
      const v = raw.trim();
      if (v) s.slots[slot] = v;
      else delete s.slots[slot];
    }
    if (Array.isArray(s.slots.items)) {
      const key = s.slots.items[0] && "label" in s.slots.items[0] ? "label" : "text";
      s.slots.items.forEach((it: any, k: number) => (it[key] = (sd.items[k] ?? "").trim()));
    }
    const list = sd.emphasis.split(",").map((x) => x.trim()).filter(Boolean);
    if (list.length) s.slots.emphasis = list;
    else delete s.slots.emphasis;
    const icon = sd.icon.trim();
    if (icon) s.slots.icon = { ...(s.slots.icon ?? {}), icon: icon.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") };
    else delete s.slots.icon;
    s.voiceover = sd.vo.map((p) => p.text.trim().replace(/\s+/g, " ")).filter(Boolean);
  });
  return next;
}

interface Props {
  view: JobViewData;
  meta: Meta;
  poll: () => void;
  applyView: (v: JobViewData) => void;
  loadHistory: () => void;
  focusJob: () => void;
  open: boolean;
  setOpen: (v: boolean) => void;
}

export function ScriptEditor({ view, meta, poll, applyView, loadHistory, focusJob, open, setOpen }: Props) {
  const j = view.job;
  const busy = isBusy(j.state);
  const sig = view.spec ? JSON.stringify(view.spec) : "";
  const [base, setBase] = useState<{ sig: string; spec: any } | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [summary, setSummary] = useState<{ title: string; items: SummaryItem[]; key: number }>({ title: "", items: [], key: 0 });
  const [icons, setIcons] = useState<string[]>([]);
  const iconBrand = useRef<string | null>(null);
  // Which scenes are open. The first starts open; a scene with a problem opens so its links lead somewhere.
  const [openScenes, setOpenScenes] = useState<Set<number>>(() => new Set([0]));
  const toggleScene = (si: number) =>
    setOpenScenes((cur) => {
      const next = new Set(cur);
      if (next.has(si)) next.delete(si);
      else next.add(si);
      return next;
    });
  // The floating save bar shows while there are changes and the Save button at the end is out of sight.
  const [endEl, setEndEl] = useState<HTMLDivElement | null>(null);
  const [endInView, setEndInView] = useState(false);
  useEffect(() => {
    if (!endEl || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setEndInView(e.isIntersecting), { rootMargin: "0px 0px -24px 0px" });
    io.observe(endEl);
    return () => io.disconnect();
  }, [endEl]);

  // Take the latest script whenever it changes and nothing has been typed yet.
  useEffect(() => {
    if (!view.spec || dirty) return;
    if (base?.sig === sig) return;
    setBase({ sig, spec: clone(view.spec) });
    setDraft(toDraft(view.spec));
    setFieldErrors({});
  }, [sig, dirty]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (iconBrand.current === j.brand) return;
    iconBrand.current = j.brand;
    api<string[]>("GET", `/api/icons?brand=${encodeURIComponent(j.brand)}`)
      .then(setIcons)
      .catch(() => {
        /* the list is only a help */
      });
  }, [j.brand]);

  const show = Boolean(base && draft && ((view.spec && !busy) || dirty));
  if (!show || !base || !draft) return null;
  const spec = base.spec;

  const edit = (fn: (d: Draft) => void) => {
    setDraft((d) => {
      const n: Draft = clone(d!);
      fn(n);
      return n;
    });
    setDirty(true);
  };

  function undo() {
    setDirty(false);
    setBase({ sig, spec: clone(view.spec) });
    setDraft(toDraft(view.spec));
    setFieldErrors({});
    setSummary((s) => ({ title: "", items: [], key: s.key + 1 }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    const next = collect(spec, draft!);
    setSaving(true);
    try {
      const v = await api<JobViewData>("PUT", `/api/jobs/${encodeURIComponent(j.id)}/spec`, { spec: next });
      setDirty(false);
      setFieldErrors({});
      setSummary((s) => ({ title: "", items: [], key: s.key + 1 }));
      applyView(v);
      poll();
      loadHistory();
      requestAnimationFrame(focusJob);
      announce("The script is saved. The video is being made again.");
    } catch (err) {
      const data = (err as ApiError).data;
      const fields: Array<{ scene: number; slot: string; item?: number; message: string }> = data?.fields ?? [];
      const errs: Record<string, string> = {};
      for (const f of fields) {
        const ids =
          f.slot === "items" ? (f.item != null ? [`s${f.scene}-items-${f.item}`] : draft!.scenes[f.scene].items.map((_, k) => `s${f.scene}-items-${k}`)) : [`s${f.scene}-${f.slot}`];
        for (const id of ids) errs[id] = f.message;
      }
      setFieldErrors(errs);
      if (fields.length) setOpenScenes((cur) => new Set([...cur, ...fields.map((f) => f.scene)]));
      // Summary items link to their fields, named as the editor names them (GOV.UK error summary pattern).
      const seen = new Set<string>();
      const linked: SummaryItem[] = [];
      for (const f of fields) {
        const fid = f.slot === "items" ? (f.item != null ? `s${f.scene}-items-${f.item}` : `s${f.scene}-items-0`) : `s${f.scene}-${f.slot}`;
        const text = /^Scene \d/.test(f.message) ? f.message : `Scene ${f.scene + 1}, ${f.slot === "items" && f.item != null ? `Item ${f.item + 1}` : slotLabel(f.slot)}: ${f.message}`;
        if (seen.has(text)) continue;
        seen.add(text);
        linked.push(document.getElementById(fid) ? { text, target: fid } : { text });
      }
      // Problems the fields do not cover (the video title, spoken lines, the script length) stay as text.
      const covered = (p: string) => fields.some((f) => p.startsWith(`Scene ${f.scene + 1},`) && p.endsWith(f.message)) || seen.has(p);
      const rest: SummaryItem[] = (data?.problems ?? []).filter((p: string) => !covered(p)).map((p: string) => (/^Video title: /.test(p) ? { text: p, target: "spec-title" } : p));
      const items = [...linked, ...rest];
      setSummary((s) => ({ title: fields.length ? (err as Error).message : "There is a problem with the script", items: items.length ? items : [(err as Error).message], key: s.key + 1 }));
    } finally {
      setSaving(false);
    }
  }

  const err = (id: string) => fieldErrors[id];
  const input = (id: string, label: string, value: string, onChange: (v: string) => void, opts: { max?: number; hint?: string; list?: string; data?: Record<string, string> } = {}) => {
    const e = err(id);
    const counted = opts.max ? countShown(value, opts.max, COUNT_WITHIN) : false;
    const described = [e ? `${id}-error` : "", opts.hint ? `${id}-hint` : "", counted ? `${id}-count` : ""].filter(Boolean).join(" ") || undefined;
    return (
      <div className="field" key={id} data-error={e ? "true" : undefined}>
        <label className="label" htmlFor={id}>
          {label}
        </label>
        {opts.hint ? (
          <p className="hint" id={`${id}-hint`}>
            {opts.hint}
          </p>
        ) : null}
        {e ? (
          <p className="error-msg" id={`${id}-error`}>
            <span className="visually-hidden">Error: </span>
            {e}
          </p>
        ) : null}
        <div className="control">
          <input className="input" type="text" id={id} value={value} onChange={(ev) => onChange(ev.target.value)} aria-invalid={e ? true : undefined} aria-describedby={described} list={opts.list} {...opts.data} />
        </div>
        {opts.max ? <CharCount id={`${id}-count`} value={value} max={opts.max} within={COUNT_WITHIN} /> : null}
      </div>
    );
  };

  return (
    <Reveal as="section" id="job-editor" className="job-block editor" aria-labelledby="script-editor">
      <h3 className="h3" id="script-editor" tabIndex={-1}>
        Edit the script
      </h3>
      <p className="block-intro">Change the words, then remake. Unchanged lines keep their voice.</p>
      <div className="buttons editor__toggle">
        <Button
          variant="default"
          aria-expanded={open}
          aria-controls="script-form-wrap"
          leftSection={
            <motion.span style={{ display: "inline-flex" }} animate={{ rotate: open ? 180 : 0 }} transition={spring.snappy} aria-hidden="true">
              <CaretDown size={20} weight="bold" />
            </motion.span>
          }
          onClick={() => setOpen(!open)}
        >
          {open ? "Hide the script" : "Show the script"}
        </Button>
      </div>
      <div id="editor-errors">
        <ErrorSummary title={summary.title || "There is a problem"} items={summary.items} focusKey={summary.key} headingLevel={3} />
      </div>
      <datalist id="icon-names">
        {icons.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>
      <Collapse open={open} keepMounted id="script-form-wrap" className="bleed">
      <form id="script-form" className="bleed__inner" noValidate onSubmit={onSubmit}>
        <ul className="editor-notes">
          <li>
            <strong>Voiceover</strong> is captioned word for word. Write dates as 3 March and web addresses without https.
          </li>
          <li>
            <strong>Words to highlight</strong>: up to 3, separated by commas, each exactly as in the main text.
          </li>
        </ul>
        {input("spec-title", "Video title", draft.title, (v) => edit((d) => (d.title = v)), { hint: "For file names only. Not shown in the video." })}

        {spec.scenes.map((scene: any, si: number) => {
          const def = meta.scenes.find((s) => s.type === scene.type);
          const sd = draft.scenes[si];
          const parts: React.ReactNode[] = [];
          for (const t of def?.text ?? []) {
            // A list (Points, Icon row): one box per item. With 4 items each must be shorter to fit.
            if (t.slot === "items" && Array.isArray(scene.slots.items)) {
              const items = scene.slots.items;
              const key = items[0] && "label" in items[0] ? "label" : "text";
              const max = items.length >= 4 && t.maxCharsWhenFull ? t.maxCharsWhenFull : t.maxChars;
              const noun = key === "label" ? "Label" : "Point";
              items.forEach((_: unknown, k: number) => {
                parts.push(
                  input(`s${si}-items-${k}`, `${noun} ${k + 1}`, sd.items[k] ?? "", (v) => edit((d) => (d.scenes[si].items[k] = v)), { max, data: { "data-scene": String(si), "data-item": String(k), "data-key": key } }),
                );
              });
              if (items.length >= 4 && t.maxCharsWhenFull)
                parts.push(
                  <p className="hint" key={`s${si}-items-note`}>{`With 4 ${noun.toLowerCase()}s, each can have up to ${t.maxCharsWhenFull} characters, so they fit the square and portrait videos.`}</p>,
                );
              continue;
            }
            if (t.slot === "items" || (scene.slots[t.slot] != null && typeof scene.slots[t.slot] !== "string")) continue;
            const id = `s${si}-${t.slot}`;
            const required = (def?.required ?? []).includes(t.slot);
            parts.push(input(id, `${slotLabel(t.slot)}${required ? "" : " (optional)"}`, sd.slots[t.slot] ?? "", (v) => edit((d) => (d.scenes[si].slots[t.slot] = v)), { max: t.maxChars, data: { "data-scene": String(si), "data-slot": t.slot } }));
          }
          if ("emphasis" in (def?.sample ?? {}) || scene.slots.emphasis)
            parts.push(input(`s${si}-emphasis`, "Words to highlight (optional)", sd.emphasis, (v) => edit((d) => (d.scenes[si].emphasis = v)), { data: { "data-scene": String(si), "data-emphasis": "1" } }));
          if (scene.slots.icon || "icon" in (def?.sample ?? {}))
            parts.push(input(`s${si}-icon`, "Icon (optional)", sd.icon, (v) => edit((d) => (d.scenes[si].icon = v)), { hint: "Such as calendar or recycle. Empty for none.", list: "icon-names", data: { "data-scene": String(si), "data-icon": "1" } }));

          const open = openScenes.has(si);
          const sceneErrors = Object.keys(fieldErrors).filter((k) => k.startsWith(`s${si}-`)).length;
          const firstText = def?.text?.map((t) => sd.slots[t.slot]).find((v) => v && v.trim()) ?? sd.items.find((v) => v.trim()) ?? "";
          const bodyId = `scene-${si}-body`;
          return (
            <section className="scene" key={si} data-open={open || undefined} aria-labelledby={`scene-${si}-h`}>
              <h4 className="scene__h" id={`scene-${si}-h`}>
                <button type="button" className="scene__toggle" aria-expanded={open} aria-controls={bodyId} onClick={() => toggleScene(si)}>
                  <span className="scene__num" aria-hidden="true">
                    {si + 1}
                  </span>
                  <span className="scene__text">
                    <span className="scene__title">
                      <span className="visually-hidden">{`Scene ${si + 1}: `}</span>
                      {def?.label ?? scene.type}
                      {BEAT_WORDS[scene.beat] ? <span className="scene__beat">{`, ${BEAT_WORDS[scene.beat]}`}</span> : null}
                    </span>
                    {firstText ? <span className="scene__summary">{firstText}</span> : null}
                  </span>
                  {sceneErrors ? <span className="scene__problems">{plural(sceneErrors, "problem")}</span> : null}
                  <motion.span className="scene__chevron" animate={{ rotate: open ? 180 : 0 }} transition={spring.snappy} aria-hidden="true">
                    <CaretDown size={20} weight="bold" />
                  </motion.span>
                </button>
              </h4>
              <Collapse open={open} keepMounted id={bodyId}>
                <div className="scene__body">
                  <div className="scene__fields">{parts}</div>
                  <h5 className="h4 scene__vo-h">Voiceover</h5>
                  <AnimatedList as="div" className="phrases">
                    {sd.vo.map((p, k) => {
                      const id = `s${si}-vo-${p.k}`;
                      const counted = countShown(p.text, 220, COUNT_WITHIN);
                      return (
                        <AnimatedItem as="div" className="field phrase" key={p.k}>
                          <div className="phrase__head">
                            <label className="label" htmlFor={id}>{`Spoken line ${k + 1}`}</label>
                            {sd.vo.length > 1 ? (
                              <Button
                                variant="subtle"
                                className="small phrase__remove"
                                leftSection={<X size={16} weight="bold" aria-hidden="true" />}
                                onClick={() => {
                                  edit((d) => d.scenes[si].vo.splice(k, 1));
                                  announce(`Spoken line ${k + 1} removed.`);
                                  requestAnimationFrame(() => document.getElementById(`s${si}-add`)?.focus());
                                }}
                              >
                                Remove<span className="visually-hidden">{` spoken line ${k + 1}`}</span>
                              </Button>
                            ) : null}
                          </div>
                          <div className="control">
                            <textarea className="textarea short" id={id} rows={2} data-scene={si} data-vo="1" value={p.text} aria-describedby={counted ? `${id}-count` : undefined} onChange={(ev) => edit((d) => (d.scenes[si].vo[k].text = ev.target.value))} />
                          </div>
                          <CharCount id={`${id}-count`} value={p.text} max={220} within={COUNT_WITHIN} />
                        </AnimatedItem>
                      );
                    })}
                  </AnimatedList>
                  {sd.vo.length < 4 ? (
                    <div className="buttons scene__add">
                      <Button
                        id={`s${si}-add`}
                        variant="subtle"
                        className="small"
                        leftSection={<Plus size={20} weight="bold" aria-hidden="true" />}
                        onClick={() => {
                          const p = phrase("");
                          edit((d) => d.scenes[si].vo.push(p));
                          requestAnimationFrame(() => document.getElementById(`s${si}-vo-${p.k}`)?.focus());
                        }}
                      >
                        Add a spoken line
                      </Button>
                    </div>
                  ) : null}
                </div>
              </Collapse>
            </section>
          );
        })}

        <div className="buttons buttons-gap editor__end" ref={setEndEl}>
          <Button type="submit" aria-disabled={saving || undefined} leftSection={saving ? <Loader size={20} color="#fff" aria-hidden="true" /> : undefined}>
            {saving ? "Checking the text fits..." : "Save script and make the video again"}
          </Button>
          {dirty ? (
            <Button variant="subtle" onClick={undo}>
              Undo my changes
            </Button>
          ) : null}
        </div>
      </form>
      </Collapse>

      {/* Save from anywhere once something has changed, like the brand editor's save bar. */}
      <div className="save-bar-wrap">
        <AnimatePresence>
          {dirty && open && !endInView ? (
            <motion.div
              className="save-bar"
              role="region"
              aria-label="Unsaved script changes"
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0, transition: spring.gentle }}
              exit={{ opacity: 0, y: 16, transition: { duration: duration.fast, ease: ease.out } }}
            >
              <PulseDot />
              <span className="save-bar__text">Unsaved changes</span>
              <Button
                className="save-bar__button"
                aria-disabled={saving || undefined}
                leftSection={saving ? <Loader size={18} color="ink.8" aria-hidden="true" /> : <ArrowClockwise size={20} weight="bold" aria-hidden="true" />}
                onClick={() => (document.getElementById("script-form") as HTMLFormElement | null)?.requestSubmit()}
              >
                Save and remake
              </Button>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    </Reveal>
  );
}
