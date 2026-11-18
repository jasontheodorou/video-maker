// Read the brand guidelines: upload a file, then pick which suggestions to use. Nothing changes until you choose.
import { Button } from "@mantine/core";
import { Check as CheckIcon, DownloadSimple, Sparkle, UploadSimple } from "@phosphor-icons/react";
import { useRef, useState } from "react";
import { announce, api, focusNode } from "../shared/api";
import { ProgressBar, PulseDot, Reveal, Stagger, StaggerItem } from "../shared/motion";
import { useEditor } from "./context";
import { slugId } from "./colour";
import { useFontActions } from "./fonts";
import { FilePicker, InlineError, icon } from "./parts";

export function GuidelinesSection() {
  const { id, files, setFiles, suggestions, setSuggestions } = useEditor();
  const input = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<{ kind: "error" | "busy" | "ok"; text: string } | null>(null);
  const [reading, setReading] = useState(false);

  async function read() {
    const f = input.current?.files?.[0];
    if (!f) {
      setStatus({ kind: "error", text: "Choose a guidelines file first." });
      input.current?.focus();
      return;
    }
    if (reading) return;
    const fd = new FormData();
    fd.append("file", f, f.name);
    setReading(true);
    setStatus({ kind: "busy", text: "Reading. A long document can take a minute." });
    try {
      const r = await api<any>("POST", `/api/brands/${encodeURIComponent(id)}/guidelines`, fd);
      setFiles(r.files);
      setSuggestions(r.suggestions);
      setStatus({ kind: "ok", text: `Read ${r.suggestions.pages ? `${r.suggestions.pages} pages, ` : ""}${r.suggestions.chars.toLocaleString("en-GB")} characters. The file is kept with the brand.` });
      requestAnimationFrame(() => document.getElementById("suggestions-h")?.focus());
    } catch (e) {
      setStatus({ kind: "error", text: (e as Error).message });
    } finally {
      setReading(false);
    }
  }

  return (
    <>
      <p className="section-intro">Upload your guidelines and get suggested colours, fonts, tone and rules. You choose what to use.</p>
      <div className="section-gap">
        <FilePicker id="guidelines-file" label="Guidelines file" hint="PDF, Markdown or text, up to 25 MB." accept=".pdf,.md,.txt,application/pdf,text/plain,text/markdown" inputRef={input} />
      </div>
      {files.documents?.length ? <p className="files-note">{`Already added: ${files.documents.join(", ")}`}</p> : null}
      <div className="buttons buttons-gap-sm">
        <Button variant="default" onClick={read} aria-disabled={reading || undefined} leftSection={icon(UploadSimple)}>
          Read guidelines
        </Button>
      </div>
      <div aria-live="polite" className="read-status">
        {status?.kind === "error" ? (
          <InlineError text={status.text} />
        ) : status?.kind === "busy" ? (
          <Reveal y={4} className="busy-line">
            <p className="busy-line__text">
              <PulseDot /> {status.text}
            </p>
            <ProgressBar label="Reading the guidelines" />
          </Reveal>
        ) : status ? (
          <Reveal y={4}>
            <p className="ok-text">{status.text}</p>
          </Reveal>
        ) : null}
      </div>
      <div id="suggestions">{suggestions ? <Suggestions s={suggestions} /> : null}</div>
    </>
  );
}

function Suggestions({ s }: { s: any }) {
  const { edit, bump, go, draft } = useEditor();
  const fonts = useFontActions();
  // Each suggested colour goes into a palette group, or is skipped. Listed tints fold into their parent.
  const colours: any[] = s.colours ?? [];
  const [groups, setGroups] = useState<string[]>(() => colours.map((c: any) => (c.tintOf ? "tint" : c.group ?? (c.role === "accent" ? "accent" : c.role === "background" ? "neutral" : "core"))));
  const [useRules, setUseRules] = useState(true);
  const [ticks, setTicks] = useState<Record<string, boolean>>({ tone: true, guidelines: true, rules: true, voice: false, iconWeight: true, logoMin: true });
  const tick = (key: string, id: string, label: string) => (
    <label className="choice" htmlFor={id}>
      <input type="checkbox" id={id} checked={ticks[key]} onChange={(e) => setTicks((t) => ({ ...t, [key]: e.target.checked }))} />
      <span>{label}</span>
    </label>
  );

  function apply() {
    const chosen = colours.map((c: any, i: number) => ({ c, group: groups[i] })).filter((x: any) => x.group && x.group !== "skip");
    const nColours = chosen.filter((x: any) => x.group !== "tint").length;
    const rules = s.colourRules && useRules && (s.colourRules.text?.length || s.colourRules.never?.length) ? s.colourRules : null;
    const done: string[] = nColours ? [`${nColours} colour${nColours === 1 ? "" : "s"}`] : [];
    if (rules) done.push("colour rules");
    const tone = s.toneOfVoice && ticks.tone;
    const guide = s.guidelines && ticks.guidelines;
    const writingRules = (s.rules?.do?.length || s.rules?.dont?.length) && ticks.rules;
    const voice = s.voice && ticks.voice;
    const iconWeight = s.iconWeight && ticks.iconWeight;
    const logoMin = s.logoMinHeight && ticks.logoMin;
    if (tone) done.push("tone of voice");
    if (guide) done.push("guidelines");
    if (writingRules) done.push("rules");
    if (voice) done.push("voice");
    if (iconWeight) done.push("icon weight");
    if (logoMin) done.push("logo size");
    edit((d) => {
      const pal = d.palette;
      const byName = (n: string) => pal.colours.find((x: any) => x.name.toLowerCase() === String(n).toLowerCase());
      for (const { c, group } of chosen.filter((x: any) => x.group !== "tint")) {
        const value = c.value.toUpperCase();
        const name = String(c.name || value).slice(0, 40);
        // A colour with a role updates the palette colour with that id; one with a known name updates that colour.
        const hit = (c.role && pal.colours.find((x: any) => x.id === c.role)) || (c.name && byName(c.name));
        if (!pal.groups.some((g: any) => g.id === group)) pal.groups.push({ id: group, name: group[0].toUpperCase() + group.slice(1) });
        if (hit) {
          hit.value = value;
          hit.name = name;
          hit.group = group;
        } else pal.colours.push({ id: slugId(name, pal.colours.map((x: any) => x.id)), name, value, group, tints: true });
      }
      for (const { c } of chosen.filter((x: any) => x.group === "tint")) {
        const parent = byName(c.tintOf);
        if (!parent || !c.tintStep) continue;
        parent.tints = true;
        parent.tintValues = { ...(parent.tintValues ?? {}), [`t${c.tintStep}`]: c.value.toUpperCase() };
      }
      if (rules) {
        const id = (n: string) => byName(n)?.id ?? pal.colours.find((x: any) => x.id === n)?.id;
        const text = (rules.text ?? []).map(id).filter(Boolean).slice(0, 6);
        const never = (rules.never ?? []).map((p: any) => ({ text: id(p.text), background: id(p.background) })).filter((p: any) => p.text && p.background).slice(0, 24);
        pal.rules = { ...(text.length ? { text } : {}), ...(never.length ? { never } : {}), ...(rules.source ? { source: String(rules.source).slice(0, 400) } : {}) };
      }
      if (tone) d.toneOfVoice = s.toneOfVoice.slice(0, 4000);
      if (guide) d.guidelines = s.guidelines.slice(0, 20000);
      if (writingRules) d.rules = { do: (s.rules.do ?? []).map((r: string) => r.slice(0, 300)), dont: (s.rules.dont ?? []).map((r: string) => r.slice(0, 300)) };
      if (voice) d.voice.id = s.voice.id;
      if (iconWeight) d.icons = { ...(d.icons ?? {}), weight: s.iconWeight };
      if (logoMin) d.logo.minHeight = s.logoMinHeight;
    });
    bump();
    announce(done.length ? `Added: ${done.join(", ")}. Check the schemes, then save.` : "No suggestions were chosen.");
    if (nColours || rules) go("sec-colours");
  }

  return (
    <Reveal className="suggestions">
      <h3 className="h3 suggestions__h" id="suggestions-h" tabIndex={-1}>
        <Sparkle size={24} weight="regular" aria-hidden="true" /> Suggestions
      </h3>
      <Stagger>
        {colours.length ? (
          <StaggerItem className="suggest-block">
            <h4 className="h4">Colours</h4>
            <ul className="suggest-colours plain-list">
              {colours.map((c: any, i: number) => (
                <li key={i}>
                  <span className="swatch" style={{ background: c.value }} aria-hidden="true" />
                  <span className="suggest-colours__text">
                    <strong>{c.value}</strong> {c.name ?? ""}
                    {c.tintOf ? ` (${c.tintStep}% tint of ${c.tintOf})` : ""}
                    {c.context ? <span className="suggest-colours__ctx">{`"${c.context.slice(0, 90)}"`}</span> : null}
                  </span>
                  <label className="visually-hidden" htmlFor={`sg-colour-${i}`}>{`Group for ${c.value}${c.name ? ` (${c.name})` : ""}`}</label>
                  <select className="select select--compact" id={`sg-colour-${i}`} value={groups[i]} onChange={(e) => setGroups((g) => g.map((x, k) => (k === i ? e.target.value : x)))}>
                    {c.tintOf ? <option value="tint">Use as the tint</option> : null}
                    {[...new Set(["core", "accent", "secondary", "neutral", ...draft.palette.groups.map((g: any) => g.id)])].map((g) => (
                      <option key={g} value={g}>
                        {draft.palette.groups.find((x: any) => x.id === g)?.name ?? g[0].toUpperCase() + g.slice(1)}
                      </option>
                    ))}
                    <option value="skip">Skip</option>
                  </select>
                </li>
              ))}
            </ul>
            {s.colourRules && (s.colourRules.text?.length || s.colourRules.never?.length) ? (
              <label className="choice" htmlFor="sg-colour-rules">
                <input type="checkbox" id="sg-colour-rules" checked={useRules} onChange={(e) => setUseRules(e.target.checked)} />
                <span>
                  {`Colour rules: ${[s.colourRules.text?.length ? `text in ${s.colourRules.text.join(" or ")}` : "", ...(s.colourRules.never ?? []).map((p: any) => `never ${p.text} text on ${p.background}`)].filter(Boolean).join("; ")}`}
                </span>
              </label>
            ) : null}
          </StaggerItem>
        ) : null}
        {s.fonts.length ? (
          <StaggerItem className="suggest-block">
            <h4 className="h4">Fonts</h4>
            <ul className="file-rows plain-list">
              {s.fonts.map((f: any, i: number) => (
                <li key={i}>
                  <span className="file-rows__name">{f.family}</span>
                  <span className="file-rows__meta">{f.role ? `For ${f.role === "heading" ? "headings" : "body text"}` : ""}</span>
                  {f.openFont ? (
                    <Button variant="default" className="small" onClick={() => fonts.useOpenFont(f.family, true)} leftSection={icon(DownloadSimple, 20)}>
                      {`Use ${f.family}`}
                    </Button>
                  ) : (
                    <span className="file-rows__meta">Not downloadable. Upload the files under Fonts.</span>
                  )}
                </li>
              ))}
            </ul>
          </StaggerItem>
        ) : null}
        {s.toneOfVoice ? (
          <StaggerItem className="suggest-block">
            <h4 className="h4">Tone of voice</h4>
            <div className="quote" tabIndex={0}>
              {s.toneOfVoice}
            </div>
            {tick("tone", "sg-tone", "Use as the tone of voice")}
          </StaggerItem>
        ) : null}
        {s.guidelines ? (
          <StaggerItem className="suggest-block">
            <h4 className="h4">Writing guidelines</h4>
            <div className="quote" tabIndex={0}>
              {s.guidelines}
            </div>
            {tick("guidelines", "sg-guide", "Use as the writing guidelines")}
          </StaggerItem>
        ) : null}
        {s.rules?.do?.length || s.rules?.dont?.length ? (
          <StaggerItem className="suggest-block">
            <h4 className="h4">Do and don't</h4>
            <div className="quote" tabIndex={0}>
              {[...(s.rules.do ?? []).map((r: string) => `Do: ${r}`), ...(s.rules.dont ?? []).map((r: string) => `Don't: ${r}`)].join("\n")}
            </div>
            {tick("rules", "sg-rules", "Use these rules (replaces the current ones)")}
          </StaggerItem>
        ) : null}
        {s.voice || s.iconWeight || s.logoMinHeight ? (
          <StaggerItem className="suggest-block choices">
            {s.voice ? tick("voice", "sg-voice", `Use the voice ${s.voice.id}. ${s.voice.reason}`) : null}
            {s.iconWeight ? tick("iconWeight", "sg-iconweight", `Use ${s.iconWeight} icons`) : null}
            {s.logoMinHeight ? tick("logoMin", "sg-logomin", `Keep the logo at least ${s.logoMinHeight}px tall`) : null}
          </StaggerItem>
        ) : null}
        {s.notes?.length ? (
          <StaggerItem className="suggest-block">
            <h4 className="h4">Notes</h4>
            <ul className="list">
              {s.notes.map((n: string, i: number) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          </StaggerItem>
        ) : null}
      </Stagger>
      <div className="buttons buttons-gap">
        <Button variant="default" onClick={apply} leftSection={<CheckIcon size={20} weight="bold" aria-hidden="true" />}>
          Use the chosen suggestions
        </Button>
      </div>
    </Reveal>
  );
}
