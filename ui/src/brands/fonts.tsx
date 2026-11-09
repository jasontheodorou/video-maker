// Fonts: which font and weight headings and body text use (with a live sample in the real font), the
// font files, uploading files, adding an open-licence font, and type sizes and spacing.
import { Button } from "@mantine/core";
import { DownloadSimple, MagnifyingGlass, UploadSimple } from "@phosphor-icons/react";
import { useRef, useState } from "react";
import { announce, api, clone, focusNode } from "../shared/api";
import { AnimatedItem, AnimatedList } from "../shared/motion";
import { Disclosure, Field } from "../shared/ui";
import { useEditor } from "./context";
import { BoundNumber, DeleteFile, FilePicker, InlineError, Report, SubHead, UploadReport, icon, type UploadResult } from "./parts";

/** Adding an open font, used from Fonts and from the guidelines suggestions. */
export function useFontActions() {
  const { id, edit, setFiles, setFontReport, setOpen } = useEditor();
  const mergeFonts = (raw: any) =>
    edit((d) => {
      d.fonts = clone(raw.fonts);
      if (raw.captions?.weight) d.captions.weight = raw.captions.weight;
    });
  async function useOpenFont(family: string, roles: boolean) {
    announce(`Downloading ${family}...`);
    try {
      const r = await api<any>("POST", `/api/brands/${encodeURIComponent(id)}/fonts/open`, { family, weights: [400, 700], roles });
      mergeFonts(r.raw);
      setFiles(r.files);
      setFontReport({ key: Date.now(), ok: true, text: `${family} added and saved with the brand.`, warnings: r.warnings ?? [] });
    } catch (e) {
      setFontReport({ key: Date.now(), ok: false, text: `Error: ${(e as Error).message}`, warnings: [] });
    }
    setOpen("sec-fonts", true);
    requestAnimationFrame(() => document.getElementById("sec-fonts-h")?.scrollIntoView({ block: "start" }));
  }
  return { mergeFonts, useOpenFont };
}

/** @font-face rules for the brand's own font files, so the samples show the real fonts. */
function FontFaces() {
  const { id, draft } = useEditor();
  const faces: any[] = draft.fonts.faces ?? [];
  const css = faces
    .map((f) => `@font-face{font-family:"bp-${String(f.family).replace(/"/g, "")}";src:url("/brand-files/${encodeURIComponent(id)}/${f.src}");font-weight:${f.weight};font-style:${f.style ?? "normal"};font-display:swap;${f.unicodeRange ? `unicode-range:${f.unicodeRange};` : ""}}`)
    .join("\n");
  return <style>{css}</style>;
}

export function FontsSection() {
  const { id, draft, edit, files, setFiles, fontReport } = useEditor();
  const { mergeFonts, useOpenFont } = useFontActions();
  const upload = useRef<HTMLInputElement>(null);
  const [useRoles, setUseRoles] = useState(false);
  const [rolesForOpen, setRolesForOpen] = useState(true);
  const [upStatus, setUpStatus] = useState<{ error?: string; busy?: boolean; results?: UploadResult[]; key?: number } | null>(null);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<{ busy?: boolean; error?: string; list?: any[] } | null>(null);
  const families = [...new Set<string>((draft.fonts.faces ?? []).map((f: any) => f.family))];
  const faces: any[] = draft.fonts.faces ?? [];
  const used = new Set(faces.map((f) => f.src));
  const unused = (files.fonts ?? []).filter((f: any) => !used.has(f.file) && !(f.usedBy ?? []).length);

  const roleCard = (role: "heading" | "body", label: string, sample: string) => {
    const famId = `font-${role}-family`;
    const wId = `font-${role}-weight`;
    const fam = draft.fonts[role].family;
    const ws = [...new Set<number>(faces.filter((f) => f.family === fam && f.style === "normal").map((f) => f.weight))].sort((a, b) => a - b);
    const cur = draft.fonts[role].weight;
    return (
      <fieldset className="font-role">
        <legend className="label">{label}</legend>
        <p className={`font-role__sample font-role__sample--${role}`} style={{ fontFamily: `"bp-${fam}", system-ui, sans-serif`, fontWeight: cur }} aria-hidden="true">
          {sample}
        </p>
        <div className="font-role__fields">
          <div className="field font-role__field">
            <label className="label label--small" htmlFor={famId}>
              Font
            </label>
            <div className="control">
              <select
                className="select"
                id={famId}
                value={fam}
                onChange={(e) => {
                  const f = e.target.value;
                  const want = role === "heading" ? 700 : 400;
                  const best = faces.filter((x) => x.family === f && x.style === "normal").map((x) => x.weight).sort((a, b) => Math.abs(a - want) - Math.abs(b - want))[0] ?? want;
                  edit((d) => (d.fonts[role] = { family: f, weight: best }));
                }}
              >
                {families.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="field font-role__field font-role__field--weight">
            <label className="label label--small" htmlFor={wId}>
              Weight
            </label>
            <div className="control">
              <select className="select" id={wId} value={String(cur)} onChange={(e) => edit((d) => (d.fonts[role].weight = Number(e.target.value)))}>
                {!ws.includes(cur) ? <option value={String(cur)}>{`${cur} (no file)`}</option> : null}
                {ws.map((w) => (
                  <option key={w} value={String(w)}>
                    {w}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </fieldset>
    );
  };

  async function uploadFonts() {
    const list = upload.current?.files;
    if (!list?.length) return setUpStatus({ error: "Choose one or more font files first." });
    if (upStatus?.busy) return;
    const fd = new FormData();
    for (const f of list) fd.append("file", f, f.name);
    fd.append("useForRoles", useRoles ? "yes" : "no");
    setUpStatus({ busy: true });
    try {
      const r = await api<any>("POST", `/api/brands/${encodeURIComponent(id)}/files/font`, fd);
      mergeFonts(r.raw);
      setFiles(r.files);
      if (upload.current) upload.current.value = "";
      setUpStatus({ results: r.results, key: Date.now() });
    } catch (e) {
      setUpStatus({ error: (e as Error).message });
    }
  }

  async function search() {
    setResults({ busy: true });
    try {
      const list = await api<any[]>("GET", `/api/fonts?q=${encodeURIComponent(q)}`);
      setResults({ list });
    } catch (e) {
      setResults({ error: (e as Error).message });
    }
  }

  return (
    <>
      <FontFaces />
      {fontReport ? (
        <Report key={fontReport.key} tone={fontReport.ok ? "ok" : "bad"} role={fontReport.ok ? "status" : "alert"}>
          <p>{fontReport.text}</p>
          {fontReport.warnings.length ? (
            <ul>
              {fontReport.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          ) : null}
        </Report>
      ) : null}
      <div className="font-roles">
        {roleCard("heading", "Headings", "Clear, calm and on brand")}
        {roleCard("body", "Body text and captions", "Every word and caption in your videos uses this font.")}
      </div>

      <SubHead id="font-files-h">Font files</SubHead>
      <p className="section-intro">Stored with the brand, so videos never need the internet.</p>
      <AnimatedList className="file-rows plain-list">
        {faces.map((f, i) => (
          <AnimatedItem key={`${f.src}-${f.weight}-${f.style}`}>
            <span className="file-rows__name">{`${f.family} ${f.weight}${f.style === "normal" ? "" : ` ${f.style}`}`}</span>
            <span className="file-rows__meta">{`${f.src.replace(/^fonts\//, "")}${f.unicodeRange ? " (part of the character set)" : ""}`}</span>
            <button
              type="button"
              className="link-button"
              onClick={() => {
                if (faces.length <= 1) return announce("A brand needs at least one font.");
                edit((d) => d.fonts.faces.splice(i, 1));
                requestAnimationFrame(() => focusNode(document.getElementById("font-files-h")));
              }}
            >
              Remove<span className="visually-hidden">{` ${f.family} ${f.weight} ${f.src}`}</span>
            </button>
          </AnimatedItem>
        ))}
      </AnimatedList>
      {unused.length ? (
        <div className="block-gap-sm">
          <p>Files not used by any font:</p>
          <ul className="file-rows plain-list">
            {unused.map((f: any) => (
              <li key={f.file}>
                <span className="file-rows__name">{f.file.replace(/^fonts\//, "")}</span>
                <DeleteFile rel={f.file} word="Delete" hidden={` ${f.file}`} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="disclosures">
        <Disclosure summary="Upload font files">
          <FilePicker id="font-upload" label="Font files" hint="WOFF2 is best; WOFF, TTF and OTF work. Regular and bold at least. Only fonts licensed for video." accept=".woff2,.woff,.ttf,.otf" multiple inputRef={upload} />
          <label className="choice field-gap-sm">
            <input type="checkbox" id="font-upload-roles" checked={useRoles} onChange={(e) => setUseRoles(e.target.checked)} />
            <span>Use for headings and body text</span>
          </label>
          <div className="buttons buttons-gap-sm">
            <Button variant="default" id="font-upload-button" onClick={uploadFonts} aria-disabled={upStatus?.busy || undefined} leftSection={icon(UploadSimple)}>
              {upStatus?.busy ? "Uploading..." : "Upload fonts"}
            </Button>
          </div>
          <div aria-live="polite">{upStatus?.error ? <InlineError text={upStatus.error} /> : null}</div>
          {upStatus?.results ? <UploadReport key={upStatus.key} results={upStatus.results} /> : null}
        </Disclosure>

        <Disclosure summary="Use an open-licence font">
          <Field id="font-search" label="Search open fonts" hint="Google Fonts and others, through Fontsource.">
            <div className="search-row">
              <input
                className="input"
                type="search"
                id="font-search"
                autoComplete="off"
                value={q}
                aria-describedby="font-search-hint"
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    search();
                  }
                }}
              />
              <Button variant="default" onClick={search} aria-disabled={results?.busy || undefined} leftSection={icon(MagnifyingGlass)}>
                Search
              </Button>
            </div>
          </Field>
          <label className="choice field-gap-sm">
            <input type="checkbox" id="open-font-roles" checked={rolesForOpen} onChange={(e) => setRolesForOpen(e.target.checked)} />
            <span>Use for headings and body text</span>
          </label>
          <div aria-live="polite">
            {results?.busy ? <p className="block-gap-sm">Searching...</p> : null}
            {results?.error ? <p className="bad-text block-gap-sm">{`Error: ${results.error}`}</p> : null}
            {results?.list && !results.list.length ? <p className="block-gap-sm">No open fonts match. Try another name, or upload the files.</p> : null}
            {results?.list?.length ? (
              <AnimatedList className="file-rows plain-list block-gap-sm">
                {results.list.map((f) => (
                  <AnimatedItem key={f.family}>
                    <span className="file-rows__name">{f.family}</span>
                    <span className="file-rows__meta">{`${f.category} · ${f.weights.join(", ")} · ${f.license}`}</span>
                    <Button variant="default" className="small" onClick={() => useOpenFont(f.family, rolesForOpen)} leftSection={icon(DownloadSimple, 20)}>
                      Use<span className="visually-hidden">{` ${f.family}`}</span>
                    </Button>
                  </AnimatedItem>
                ))}
              </AnimatedList>
            ) : null}
          </div>
        </Disclosure>

        <Disclosure summary="Sizes and spacing">
          <p>Pixels for a 1080p video; portrait is 20% larger. Text never goes under 42px. Most brands leave these alone.</p>
          <div className="surface-grid">
            <fieldset className="surface">
              <legend className="label">Text sizes</legend>
              <div className="number-grid">
                <BoundNumber path="typeScale.display" label="Title" min={60} max={200} />
                <BoundNumber path="typeScale.heading" label="Heading" min={48} max={160} />
                <BoundNumber path="typeScale.body" label="Body text" min={42} max={110} />
                <BoundNumber path="typeScale.label" label="Label" min={42} max={80} />
                <BoundNumber path="typeScale.caption" label="Caption" min={42} max={80} />
              </div>
            </fieldset>
            <fieldset className="surface">
              <legend className="label">Line height</legend>
              <div className="number-grid">
                <BoundNumber path="lineHeight.display" label="Titles" min={0.95} max={1.6} step={0.01} />
                <BoundNumber path="lineHeight.heading" label="Headings" min={1} max={1.6} step={0.01} />
                <BoundNumber path="lineHeight.body" label="Body text" min={1.1} max={1.8} step={0.01} />
              </div>
            </fieldset>
            <fieldset className="surface">
              <legend className="label">Spacing</legend>
              <div className="number-grid">
                <BoundNumber path="letterSpacing.display" label="Title letter spacing (em)" min={-0.05} max={0.1} step={0.005} />
                <BoundNumber path="letterSpacing.heading" label="Heading letter spacing (em)" min={-0.05} max={0.1} step={0.005} />
                <BoundNumber path="spacing.unit" label="Spacing unit (px)" min={4} max={16} />
                <BoundNumber path="radius" label="Corner radius (px)" min={0} max={48} />
              </div>
            </fieldset>
          </div>
        </Disclosure>
      </div>
    </>
  );
}
