// Make: the composer (/make). The brief and brand sit in the monitor; length, formats, voice, media and
// look sit in the inspector tabs. Returns both parts so the workspace can place them in the shell.
import { Button, Loader } from "@mantine/core";
import { ArrowRight, CheckCircle, UploadSimple, WarningCircle, X } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { announce, api, formatBytes, plural } from "../shared/api";
import { Link, navigate, useRoute } from "../shared/router";
import { InspectorTabs, useShortcuts } from "../shared/studio";
import { CharCount, ErrorSummary, Field, countShown, describedBy, type SummaryItem } from "../shared/ui";
import type { BrandSummary, JobViewData, Meta } from "./types";

const BRIEF_MAX = 20000;
const BRIEF_COUNT_WITHIN = 1000;
const MEDIA_MAX = 12;
const MEDIA_ACCEPT = ".jpg,.jpeg,.png,.webp,.mp4,.mov,.m4v,.webm,image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm";
const MEDIA_TYPE = /\.(jpe?g|png|webp|mp4|mov|m4v|webm)$/i;

/** Example briefs for the sample council, shown only while the box is empty. */
const DEMO_EXAMPLES = [
  { label: "Bin collections", text: "From Monday 12 January, Northvale Council will collect garden waste bins every two weeks instead of every week. Tell residents in a short video. They can check their new collection day at northvale.example/bins." },
  { label: "Library hours", text: "From 2 February, the Northvale library on Castle Street will open on Sundays from 10am to 4pm. Tell residents in a short video for social media. They can find out more at northvale.example/libraries." },
  { label: "Bus pass", text: "Older and disabled residents in Northvale can now apply for a free bus pass online. It takes about 10 minutes. Tell people how in a short video. Apply at northvale.example/buspass." },
];

const SHAPE_NAME: Record<string, string> = { "16x9": "Landscape", "9x16": "Portrait", "1x1": "Square" };
const RATIO: Record<string, string> = { "16x9": "16:9", "9x16": "9:16", "1x1": "1:1" };

interface BrandScheme {
  id: string;
  name: string;
  usable: boolean;
  enabled?: boolean;
  vars?: Record<string, string>;
}
interface BrandInfo {
  id: string;
  schemes: BrandScheme[];
  style: string;
  voice?: string;
  examples: Array<{ label: string; text: string }>;
}

function remembered(): string | null {
  try {
    return localStorage.getItem("va-brand");
  } catch {
    return null;
  }
}

function FormatShape({ w, h }: { w: number; h: number }) {
  const scale = 28 / Math.max(w, h);
  return (
    <span className="format-shape" aria-hidden="true">
      <span style={{ width: Math.round(w * scale), height: Math.round(h * scale) }} />
    </span>
  );
}

/** A small swatch of a scheme: its background with an "A" in its text colour and a key-word bar. */
export function SchemeSwatch({ vars, size = 24 }: { vars?: Record<string, string>; size?: number }) {
  if (!vars) return null;
  return (
    <span className="scheme-swatch" aria-hidden="true" style={{ width: size, height: size, background: vars["--bg"], color: vars["--fg"] }}>
      <span className="scheme-swatch__a">A</span>
      <span className="scheme-swatch__bar" style={{ background: vars["--hl"] }} />
    </span>
  );
}

type Tab = "settings" | "media" | "look";

export function useComposer({ meta, brands, brandsError, onMade, active = true }: { meta: Meta | null; brands: BrandSummary[]; brandsError: string | null; onMade: (v: JobViewData) => void; active?: boolean }) {
  const route = useRoute();
  const fromId = route.query.get("from");
  const [tab, setTab] = useState<Tab>("settings");
  const [summary, setSummary] = useState<{ items: SummaryItem[]; key: number }>({ items: [], key: 0 });
  const [brief, setBrief] = useState("");
  const [brand, setBrand] = useState("");
  const [voice, setVoice] = useState("");
  const [size, setSize] = useState("auto");
  const [formats, setFormats] = useState<string[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [descriptions, setDescriptions] = useState<string[]>([]);
  const [colour, setColour] = useState<"spread" | "single">("spread");
  const [scheme, setScheme] = useState("");
  const [style, setStyle] = useState("");
  const [errors, setErrors] = useState<{ brief?: string; formats?: string; brand?: string; scheme?: string }>({});
  const [sending, setSending] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [info, setInfo] = useState<BrandInfo | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const prefilled = useRef<string | null>(null);

  // Defaults once meta and brands arrive.
  useEffect(() => {
    if (meta && !formats.length) setFormats(meta.formats.map((f) => f.id));
  }, [meta]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!brands.length || brand) return;
    const want = remembered();
    setBrand(brands.find((x) => x.id === want) ? want! : brands.find((x) => x.id === "demo") ? "demo" : brands[0].id);
  }, [brands, brand]);

  // /make?from=:id fills the composer from that video.
  useEffect(() => {
    if (!fromId || prefilled.current === fromId) return;
    prefilled.current = fromId;
    api<JobViewData>("GET", `/api/jobs/${encodeURIComponent(fromId)}`)
      .then((v) => {
        setBrief(v.job.brief ?? "");
        if (v.job.brand) setBrand(v.job.brand);
        if (v.job.formats?.length) setFormats(v.job.formats);
        const req = v.spec?.facts?.requestedSize;
        if (req) setSize(req);
        if (v.look?.schemes === "single" && v.look.scheme) {
          setColour("single");
          setScheme(v.look.scheme);
        }
        if (v.look?.motionStyle && v.spec?.look?.motionStyle) setStyle(v.look.motionStyle);
        requestAnimationFrame(() => document.getElementById("brief")?.focus());
      })
      .catch(() => {
        /* the composer still works empty */
      });
  }, [fromId]);

  // The chosen brand's schemes, style and voice.
  useEffect(() => {
    if (!brand) return;
    try {
      localStorage.setItem("va-brand", brand);
    } catch {
      /* no storage */
    }
    let live = true;
    api<any>("GET", `/api/brands/${encodeURIComponent(brand)}`)
      .then((d) => {
        if (!live) return;
        const checks: BrandScheme[] = d.check?.schemes ?? [];
        const raw: BrandScheme[] = d.raw?.schemes ?? [];
        const schemes = raw.filter((s) => s.enabled !== false).map((s) => ({ ...s, ...(checks.find((c) => c.id === s.id) ?? {}), name: s.name }));
        const ex: Array<{ label: string; text: string }> = Array.isArray(d.raw?.examples) ? d.raw.examples.slice(0, 3).map((e: any, i: number) => (typeof e === "string" ? { label: `Example ${i + 1}`, text: e } : { label: e.label ?? `Example ${i + 1}`, text: e.text ?? e.brief ?? "" })) : brand === "demo" ? DEMO_EXAMPLES : [];
        setInfo({ id: brand, schemes, style: d.raw?.motion?.style ?? "calm", voice: d.raw?.voice?.id, examples: ex.filter((e) => e.text) });
      })
      .catch(() => live && setInfo({ id: brand, schemes: [], style: "calm", examples: brand === "demo" ? DEMO_EXAMPLES : [] }));
    return () => {
      live = false;
    };
  }, [brand]);

  const current = brands.find((b) => b.id === brand);
  const usable = (info?.id === brand ? info.schemes : []).filter((s) => s.usable);
  const styles = meta?.motion?.styles ?? [];
  const brandStyle = styles.find((s) => s.id === (info?.style ?? "calm"));
  const voiceLabel = voice ? meta?.voices.find((v) => v.id === voice)?.label : meta?.voices.find((v) => v.id === (info?.voice ?? current?.voice))?.label;
  const lengths = meta?.lengths ?? [{ id: "auto", label: "Auto" }];
  const lengthLabel = lengths.find((l) => l.id === size)?.label ?? "Auto";

  function addFiles(list: FileList | File[] | null) {
    const incoming = list ? [...list].filter((f) => MEDIA_TYPE.test(f.name)) : [];
    if (fileRef.current) fileRef.current.value = "";
    if (list && incoming.length < list.length) announce("Some files were left out. Use JPEG, PNG, WebP, MP4, MOV or WebM.");
    if (!incoming.length) return;
    const key = (f: File) => `${f.name}|${f.size}|${f.lastModified}`;
    const have = new Set(files.map(key));
    let fresh = incoming.filter((f) => !have.has(key(f)));
    if (files.length + fresh.length > MEDIA_MAX) {
      fresh = fresh.slice(0, Math.max(0, MEDIA_MAX - files.length));
      announce("12 files at most.");
      setSummary((s) => ({ items: [{ text: "12 files at most.", target: "media" }], key: s.key + 1 }));
    }
    setFiles((cur) => [...cur, ...fresh]);
    setDescriptions((cur) => [...cur, ...fresh.map(() => "")]);
    if (fresh.length) {
      announce(`${plural(fresh.length, "file")} added.`);
      setTab("media");
    }
  }

  function removeFile(i: number) {
    const name = files[i]?.name;
    setFiles((cur) => cur.filter((_, k) => k !== i));
    setDescriptions((cur) => cur.filter((_, k) => k !== i));
    announce(`${name} removed.`);
    requestAnimationFrame(() => {
      const next = document.querySelector<HTMLButtonElement>(`[data-remove="${Math.min(i, files.length - 2)}"]`);
      (next ?? fileRef.current)?.focus();
    });
  }

  /** Open an inspector tab and focus a control in it. */
  function openTab(t: Tab, focusId?: string) {
    setTab(t);
    if (focusId) requestAnimationFrame(() => requestAnimationFrame(() => document.getElementById(focusId)?.focus()));
  }

  async function submit() {
    if (sending) return;
    const text = brief.trim();
    const next: typeof errors = {};
    const items: SummaryItem[] = [];
    if (text.length < 10) {
      next.brief = "Describe the video in at least one sentence";
      items.push({ text: next.brief, target: "brief" });
    } else if (text.length > BRIEF_MAX) {
      next.brief = "Keep the brief under 20,000 characters";
      items.push({ text: next.brief, target: "brief" });
    }
    if (!formats.length) {
      next.formats = "Choose at least one format";
      items.push({ text: next.formats, target: `format-${meta?.formats[0]?.id ?? "16x9"}` });
      setTab("settings");
    }
    if (current && !current.ok) {
      next.brand = "Fix the brand first";
      items.push({ text: next.brand, target: "brand" });
    }
    if (colour === "single" && !usable.some((s) => s.id === scheme)) {
      next.scheme = "Choose a colour scheme";
      items.push({ text: next.scheme, target: "look-one" });
      setTab("look");
    }
    setErrors(next);
    if (items.length) {
      setSummary((s) => ({ items, key: s.key + 1 }));
      return;
    }
    setSummary((s) => ({ items: [], key: s.key + 1 }));
    const fd = new FormData();
    fd.append("brief", text);
    fd.append("brand", brand);
    fd.append("voice", voice);
    fd.append("size", size);
    const look: Record<string, string> = {};
    if (colour === "single") {
      look.schemes = "single";
      look.scheme = scheme;
    }
    if (style) look.motionStyle = style;
    if (Object.keys(look).length) fd.append("look", JSON.stringify(look));
    for (const f of formats) fd.append("formats", f);
    files.forEach((f, i) => {
      fd.append("mediaDescription", (descriptions[i] ?? "").trim());
      fd.append("media", f, f.name);
    });
    setSending(true);
    try {
      const v = await api<JobViewData>("POST", "/api/jobs", fd);
      setFiles([]);
      setDescriptions([]);
      setBrief("");
      onMade(v);
    } catch (err) {
      setSummary((s) => ({ items: [(err as Error).message], key: s.key + 1 }));
    } finally {
      setSending(false);
    }
  }

  useShortcuts({
    "mod+enter": () => (active ? void submit() : false),
  });

  const formatSummary = meta ? (formats.length === meta.formats.length ? `${meta.formats.length} formats` : formats.length ? plural(formats.length, "format") : "No formats") : "";
  const schemeName = usable.find((s) => s.id === scheme)?.name;

  const monitor = (
    <div className="composer-wrap" onDragOver={(e) => e.preventDefault()} onDrop={(e) => {
      if (!e.dataTransfer.files.length) return;
      e.preventDefault();
      addFiles(e.dataTransfer.files);
    }}>
      <form
        id="make-form"
        className="composer"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <h1 className="composer__h1" tabIndex={-1} id="make-h1">
          Make a video
        </h1>
        <ErrorSummary items={summary.items} focusKey={summary.key} />
        {brandsError ? <ErrorSummary items={[brandsError]} focus={false} /> : null}

        <Field
          id="brand"
          label="Brand"
          error={errors.brand}
          extra={
            <p id="brand-status" className="brand-status" aria-live="polite">
              {!current ? null : current.ok ? (
                <span className="brand-status__line">
                  <CheckCircle size={22} weight="fill" className="ok-icon" aria-hidden="true" />
                  <span className="ok-text">Ready</span>
                </span>
              ) : (
                <span className="brand-status__line">
                  <WarningCircle size={22} weight="fill" className="bad-icon" aria-hidden="true" />
                  <span>
                    <span className="bad-text">{current.errors?.length ? `${plural(current.errors.length, "problem")} · ` : "Problems · "}</span>
                    <Link to={`/brands/${encodeURIComponent(current.id)}/checks`}>Fix the brand</Link>
                  </span>
                </span>
              )}
            </p>
          }
        >
          <select className="select" id="brand" name="brand" value={brand} onChange={(e) => setBrand(e.target.value)} aria-invalid={errors.brand ? true : undefined} aria-describedby={describedBy("brand", { error: errors.brand, extra: ["brand-status"] })}>
            {!brands.length ? <option value="">Loading brands</option> : null}
            {brands.map((b) => (
              <option key={b.id} value={b.id}>
                {`${b.name}${b.fictional ? " (sample)" : ""}${b.ok ? "" : " (has problems)"}`}
              </option>
            ))}
          </select>
        </Field>

        <Field id="brief" label="What is the video about?" hint="Who it’s for, what’s happening, what to do. Write dates and links exactly." error={errors.brief}>
          <textarea
            className="textarea brief-box"
            id="brief"
            name="brief"
            rows={9}
            spellCheck
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            aria-invalid={errors.brief ? true : undefined}
            aria-describedby={describedBy("brief", { hint: 1, error: errors.brief, extra: countShown(brief, BRIEF_MAX, BRIEF_COUNT_WITHIN) ? ["brief-count"] : [] })}
          />
          <CharCount id="brief-count" value={brief} max={BRIEF_MAX} within={BRIEF_COUNT_WITHIN} />
          {!brief && info?.examples.length ? (
            <div className="examples" role="group" aria-labelledby="examples-label">
              <span className="examples__label" id="examples-label">
                Try an example
              </span>
              <ul className="examples__list">
                {info.examples.map((x) => (
                  <li key={x.label}>
                    <button
                      type="button"
                      className="chip"
                      onClick={() => {
                        setBrief(x.text);
                        const box = document.getElementById("brief") as HTMLTextAreaElement | null;
                        box?.focus();
                      }}
                    >
                      {x.label}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </Field>

        <div className="composer__summary" aria-label="Choices">
          <button type="button" className="summary-part" onClick={() => openTab("settings", `length-${size}`)}>
            {lengthLabel === "Auto" ? "Length: Auto" : lengthLabel}
          </button>
          <button type="button" className="summary-part" onClick={() => openTab("settings", `format-${formats[0] ?? meta?.formats[0]?.id ?? "16x9"}`)}>
            {formatSummary}
          </button>
          <button type="button" className="summary-part" onClick={() => openTab("settings", "voice")}>
            {voiceLabel ? `Voice: ${voiceLabel}` : "Voice"}
          </button>
          <button type="button" className="summary-part" onClick={() => openTab("media", "media")}>
            {files.length ? plural(files.length, "file") : "No media"}
          </button>
          <button type="button" className="summary-part" onClick={() => openTab("look", colour === "single" ? "look-one" : "look-mix")}>
            {colour === "single" ? (schemeName ? `One scheme: ${schemeName}` : "One scheme") : "Mixed schemes"}
          </button>
          <button type="button" className="summary-part" onClick={() => openTab("look", `style-${style || "brand"}`)}>
            {style ? (styles.find((s) => s.id === style)?.label ?? style) : `${brandStyle?.label ?? "Brand"} motion`}
          </button>
        </div>

        <div className="composer__actions">
          <Button
            type="submit"
            id="make-button"
            size="lg"
            aria-keyshortcuts="Control+Enter Meta+Enter"
            aria-disabled={sending || undefined}
            leftSection={sending ? <Loader size={20} color="#fff" aria-hidden="true" /> : undefined}
            rightSection={sending ? undefined : <ArrowRight size={22} weight="bold" aria-hidden="true" />}
          >
            {sending ? "Sending" : "Make video"}
          </Button>
        </div>
      </form>
    </div>
  );

  const settingsTab = (
    <div className="stack-24">
      <fieldset className="field">
        <legend className="label">Length</legend>
        <div className="lenpick" role="radiogroup" aria-label="Length">
          {lengths.map((l) => (
            <label key={l.id} className="lenpick__opt" htmlFor={`length-${l.id}`}>
              <input type="radio" name="length" id={`length-${l.id}`} value={l.id} checked={size === l.id} onChange={() => setSize(l.id)} />
              <span className="lenpick__label">{l.label}</span>
              {l.min ? <span className="lenpick__meta">{`${l.min} to ${l.max} s`}</span> : null}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="field" id="formats-field" data-error={errors.formats ? "true" : undefined}>
        <legend className="label">Formats</legend>
        {errors.formats ? (
          <p className="error-msg" id="formats-error">
            <span className="visually-hidden">Error: </span>
            {errors.formats}
          </p>
        ) : null}
        <div className="format-choices" id="formats">
          {meta?.formats.map((f) => {
            const last = formats.length === 1 && formats[0] === f.id;
            return (
              <label className="format-choice" key={f.id}>
                <input
                  type="checkbox"
                  name="formats"
                  id={`format-${f.id}`}
                  value={f.id}
                  checked={formats.includes(f.id)}
                  aria-disabled={last || undefined}
                  aria-describedby={last ? "formats-keep" : undefined}
                  onChange={(e) => {
                    if (last && !e.target.checked) return;
                    setFormats((cur) => (e.target.checked ? meta.formats.map((x) => x.id).filter((x) => x === f.id || cur.includes(x)) : cur.filter((x) => x !== f.id)));
                  }}
                />
                <FormatShape w={f.width} h={f.height} />
                <span className="format-choice__text">
                  <span className="format-choice__name">{`${SHAPE_NAME[f.id] ?? f.label} ${RATIO[f.id] ?? ""}`}</span>
                </span>
              </label>
            );
          })}
        </div>
        {formats.length === 1 ? (
          <p className="hint" id="formats-keep">
            Keep at least one.
          </p>
        ) : null}
      </fieldset>

      <Field id="voice" label="Voice" hint="Stand-in voice. Replace it before you publish.">
        <select className="select" id="voice" name="voice" value={voice} onChange={(e) => setVoice(e.target.value)} aria-describedby="voice-hint">
          <option value="">{`Brand voice${meta?.voices.find((v) => v.id === (info?.voice ?? current?.voice)) ? `: ${meta?.voices.find((v) => v.id === (info?.voice ?? current?.voice))?.label}` : ""}`}</option>
          {meta?.voices.map((v) => (
            <option key={v.id} value={v.id}>
              {v.label}
            </option>
          ))}
        </select>
      </Field>
    </div>
  );

  const mediaTab = (
    <div className="stack-24">
      <div className="field">
        <label className="label" htmlFor="media">
          Add photos or clips
        </label>
        <p className="hint" id="media-hint">
          Use only files you have rights to.
        </p>
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
            e.stopPropagation();
            setDragOver(false);
            addFiles(e.dataTransfer.files);
          }}
        >
          <span className="drop__icon" aria-hidden="true">
            <UploadSimple size={24} weight="regular" />
          </span>
          <input ref={fileRef} className="drop__native" type="file" id="media" name="media" multiple accept={MEDIA_ACCEPT} aria-describedby="media-hint" onChange={(e) => addFiles(e.target.files)} />
          <label htmlFor="media" className="drop__pick" aria-hidden="true">
            Choose files
          </label>
          <span className="drop__or" aria-hidden="true">
            or drop them here
          </span>
        </div>
      </div>
      {files.length ? (
        <ul className="media-list" aria-label={`${plural(files.length, "file")} chosen`}>
          {files.map((f, i) => (
            <li key={`${f.name}-${f.size}-${f.lastModified}`} className="media-item">
              <div className="media-item__head">
                <span className="media-item__name">{f.name}</span>
                <span className="media-item__size">{formatBytes(f.size)}</span>
                <button type="button" className="ghost-button" data-remove={i} onClick={() => removeFile(i)}>
                  <X size={18} weight="bold" aria-hidden="true" />
                  Remove<span className="visually-hidden">{` ${f.name}`}</span>
                </button>
              </div>
              <label className="label media-item__label" htmlFor={`media-desc-${i}`}>
                What it shows<span className="visually-hidden">{` in ${f.name}`}</span>
              </label>
              <input className="input" type="text" id={`media-desc-${i}`} maxLength={200} value={descriptions[i] ?? ""} onChange={(e) => setDescriptions((d) => d.map((x, k) => (k === i ? e.target.value : x)))} />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );

  const lookTab = (
    <div className="stack-24">
      <fieldset className="field" data-error={errors.scheme ? "true" : undefined}>
        <legend className="label">Colour</legend>
        {errors.scheme ? (
          <p className="error-msg">
            <span className="visually-hidden">Error: </span>
            {errors.scheme}
          </p>
        ) : null}
        <div className="choices">
          <label className="choice" htmlFor="look-mix">
            <input type="radio" name="look-colour" id="look-mix" checked={colour === "spread"} onChange={() => setColour("spread")} />
            <span>Mix the brand’s schemes</span>
          </label>
          <label className="choice" htmlFor="look-one">
            <input type="radio" name="look-colour" id="look-one" checked={colour === "single"} onChange={() => setColour("single")} />
            <span>One scheme for the whole video</span>
          </label>
        </div>
        {colour === "single" ? (
          usable.length ? (
            <div className="scheme-picks" role="radiogroup" aria-label="Scheme">
              {usable.map((s) => (
                <label key={s.id} className="scheme-pick" htmlFor={`look-scheme-${s.id}`}>
                  <input type="radio" name="look-scheme" id={`look-scheme-${s.id}`} checked={scheme === s.id} onChange={() => setScheme(s.id)} />
                  <span className="scheme-pick__card" style={{ background: s.vars?.["--bg"], color: s.vars?.["--fg"] }} aria-hidden="true">
                    <span className="scheme-pick__a">Aa</span>
                    <span className="scheme-pick__bar" style={{ background: s.vars?.["--hl"] }} />
                  </span>
                  <span className="scheme-pick__name">{s.name}</span>
                </label>
              ))}
            </div>
          ) : (
            <p className="hint">This brand has no usable schemes yet.</p>
          )
        ) : null}
      </fieldset>
      <fieldset className="field">
        <legend className="label">Motion</legend>
        <div className="choices">
          <label className="choice choice--two" htmlFor="style-brand">
            <input type="radio" name="look-style" id="style-brand" checked={!style} onChange={() => setStyle("")} />
            <span>
              <span className="choice__name">{`Brand style (${brandStyle?.label ?? "Calm"})`}</span>
            </span>
          </label>
          {styles.map((s) => (
            <label className="choice choice--two" htmlFor={`style-${s.id}`} key={s.id}>
              <input type="radio" name="look-style" id={`style-${s.id}`} checked={style === s.id} onChange={() => setStyle(s.id)} />
              <span>
                <span className="choice__name">{s.label}</span>
                {s.line ? <span className="choice__line">{s.line}</span> : null}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
    </div>
  );

  const inspector = (
    <InspectorTabs
      label="Video settings"
      value={tab}
      onChange={(t) => setTab(t as Tab)}
      tabs={[
        { id: "settings", label: "Settings", content: settingsTab },
        { id: "media", label: "Media", badge: files.length || null, content: mediaTab },
        { id: "look", label: "Look", content: lookTab },
      ]}
    />
  );

  return { monitor, inspector, goNew: () => navigate("/make") };
}
