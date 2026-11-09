// The brand editor's smaller sections: name, logo, icons and graphics, voice, and writing.
// Colours, fonts and guidelines live in their own files.
import { Button, Chip, Group, Slider } from "@mantine/core";
import { ArrowsClockwise, Play, UploadSimple } from "@phosphor-icons/react";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, getPath } from "../shared/api";
import { AnimatedItem, AnimatedList, PulseDot, Reveal, duration, ease, spring } from "../shared/motion";
import { Field, InlineConfirm, Message } from "../shared/ui";
import { useEditor } from "./context";
import { BoundNumber, BoundSelect, BoundText, DeleteFile, FilePicker, InlineError, Report, SubHead, UploadReport, icon, type UploadResult } from "./parts";

const GROUPS = ["colours", "fonts", "logo", "icons", "voice", "tone of voice", "guidelines", "rules"];
const ICON_WEIGHTS = ["thin", "light", "regular", "bold", "fill", "duotone"];
const capitalise = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);

/** Rises in when a file has been chosen: the one step left is to send it. */
function WhenChosen({ show, children }: { show: boolean; children: ReactNode }) {
  return (
    <AnimatePresence initial={false}>
      {show ? (
        <motion.div
          className="buttons buttons-gap-sm"
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0, transition: spring.snappy }}
          exit={{ opacity: 0, transition: { duration: duration.fast, ease: ease.out } }}
        >
          {children}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

// ---------- name ----------

export function AboutSection() {
  const { id, draft, edit, setValue } = useEditor();
  const prov: string[] = draft.provisional ?? [];
  const groups = [...new Set([...GROUPS, ...prov])];
  return (
    <>
      <BoundText path="name" label="Name" maxLength={80} />
      <BoundText path="description" label="Description (optional)" hint="One sentence about the organisation, for the script writer." multiline rows={3} maxLength={400} />
      <label className="choice field-gap">
        <input type="checkbox" id="f-fictional" checked={Boolean(draft.fictional)} onChange={(e) => setValue("fictional", e.target.checked)} />
        <span>This is a sample, not a real organisation</span>
      </label>
      <fieldset className="field-gap" aria-describedby="still-hint">
        <legend className="label">Still to confirm</legend>
        <p className="hint" id="still-hint">
          Tick placeholders the real guidelines have not confirmed yet.
        </p>
        <Chip.Group
          multiple
          value={prov}
          onChange={(v) =>
            edit((d) => {
              d.provisional = v;
            })
          }
        >
          <Group gap={8} className="chips">
            {groups.map((g) => (
              <Chip key={g} value={g} variant="outline" radius="xl" className="chip">
                {capitalise(g)}
              </Chip>
            ))}
          </Group>
        </Chip.Group>
      </fieldset>
      <p className="field-gap meta-line">{`Brand id: ${id}. It names the folder and cannot change.`}</p>
    </>
  );
}

// ---------- logo ----------

export function LogoSection() {
  const { id, draft, edit, check, files, setFiles } = useEditor();
  const upload = useRef<HTMLInputElement>(null);
  const [logoFor, setLogoFor] = useState("both");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [chosen, setChosen] = useState(0);
  const [report, setReport] = useState<{ key: number; node: ReactNode } | null>(null);
  const stamp = useMemo(() => Date.now(), [files]); // eslint-disable-line react-hooks/exhaustive-deps
  const logos: string[] = (files.logos ?? []).map((l: any) => l.file);
  const unused = logos.filter((l) => l !== draft.logo.onLight && l !== draft.logo.onDark);

  const box = (key: "onLight" | "onDark", label: string, surface: "light" | "dark") => {
    const bg = draft.colours?.[draft.surfaces?.[surface]?.background]?.value ?? (surface === "dark" ? "#0B0C0C" : "#FFFFFF");
    const src = draft.logo[key];
    // Logo problems shown next to the logo itself, with the white-version button when it would help.
    const found = (check?.issues ?? []).filter((i) => i.field === `logo.${key}` && !/^PNG logos/.test(i.message));
    return (
      <div className="logo-box">
        <div className="logo-stage" style={{ background: bg }}>
          {src ? <img key={`${src}-${stamp}`} className="logo-img" src={`/brand-files/${encodeURIComponent(id)}/${src}?t=${stamp}`} alt={`${draft.logo.alt} logo on the ${surface} background`} /> : null}
        </div>
        <div className="logo-box__body">
          <h3 className="h4">{label}</h3>
          <p className="hint">{key === "onDark" ? "Used on title and end cards." : "Not used in videos yet."}</p>
          <div id={`logo-${key}-warn`}>
            {found.map((i, k) => (
              <div className="logo-warn" key={k}>
                <Message tone={i.level === "error" ? "bad" : "warn"}>
                  <p>
                    <strong>{i.level === "error" ? "Problem: " : "Check: "}</strong>
                    {i.message.replace(/ Upload a white or reversed logo for dark backgrounds, or use Make a white version in the Logo section\.$/, " Upload a white or reversed logo, or make a white version.")}
                  </p>
                  {key === "onDark" && /\.svg$/i.test(draft.logo.onLight || "") ? (
                    <Button variant="default" className="small" onClick={() => document.getElementById("reverse-logo-button")?.click()}>
                      Make a white version
                    </Button>
                  ) : null}
                </Message>
              </div>
            ))}
          </div>
          <BoundSelect path={`logo.${key}`} id={`logo-${key}`} label="File" options={logos.map((l) => ({ value: l, label: l.replace(/^logo\//, "") }))} />
        </div>
      </div>
    );
  };

  async function uploadLogo() {
    const f = upload.current?.files?.[0];
    if (!f) return setStatus("Choose a logo file first.");
    if (busy) return;
    const fd = new FormData();
    fd.append("file", f, f.name);
    fd.append("logoFor", logoFor);
    setStatus(null);
    setBusy(true);
    try {
      const r = await api<any>("POST", `/api/brands/${encodeURIComponent(id)}/files/logo`, fd);
      edit((d) => {
        d.logo.onLight = r.raw.logo.onLight;
        d.logo.onDark = r.raw.logo.onDark;
      });
      setFiles(r.files);
      if (upload.current) upload.current.value = "";
      setChosen(0);
      setReport({ key: Date.now(), node: <UploadReport results={r.results} /> });
    } catch (e) {
      setStatus((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function reverse(): Promise<string | void> {
    try {
      const r = await api<any>("POST", `/api/brands/${encodeURIComponent(id)}/reverse-logo`, { path: draft.logo.onLight });
      edit((d) => (d.logo.onDark = r.raw.logo.onDark));
      setFiles(r.files);
      setReport({
        key: Date.now(),
        node: (
          <Report tone={r.warnings?.length ? "warn" : "ok"}>
            <p>White version made and used on dark backgrounds.</p>
            {r.warnings?.length ? (
              <ul>
                {r.warnings.map((w: string, i: number) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            ) : null}
          </Report>
        ),
      });
    } catch (e) {
      return (e as Error).message;
    }
  }

  return (
    <>
      <div className="logo-pair">
        {box("onDark", "On dark", "dark")}
        {box("onLight", "On light", "light")}
      </div>
      <div className="section-gap">
        <BoundText path="logo.alt" label="Logo description" hint="What it says, for people who cannot see it. Usually the name." maxLength={120} />
        <BoundNumber path="logo.minHeight" label="Smallest height (px)" min={24} max={240} hint="The smallest the guidelines allow at 1080p. 24 to 240." />
      </div>

      <fieldset className="section-gap">
        <legend className="label">Add a logo for</legend>
        <div className="choices choices--inline">
          {(["both", "onLight", "onDark"] as const).map((v) => (
            <label className="choice" key={v}>
              <input type="radio" name="logo-for" value={v} checked={logoFor === v} onChange={() => setLogoFor(v)} />
              <span>{{ onLight: "Light only", onDark: "Dark only", both: "Light and dark" }[v]}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="field-gap">
        <FilePicker id="logo-upload" label="Logo file" hint="SVG or PNG, up to 25 MB. SVG stays sharpest." accept=".svg,.png,image/svg+xml,image/png" inputRef={upload} onPick={setChosen} />
      </div>
      <WhenChosen show={chosen > 0}>
        <Button variant="default" id="logo-upload-button" onClick={uploadLogo} aria-disabled={busy || undefined} leftSection={icon(UploadSimple)}>
          {busy ? "Uploading..." : "Upload logo"}
        </Button>
      </WhenChosen>
      {/\.svg$/i.test(draft.logo.onLight) ? (
        <div className="buttons buttons-gap-sm">
          <InlineConfirm
            trigger="Make a white version"
            triggerProps={{ id: "reverse-logo-button", variant: "subtle", leftSection: icon(ArrowsClockwise) }}
            question="Make a white version of the logo?"
            detail={["Every colour in the light logo turns white, for dark backgrounds.", "Only if the guidelines allow a one-colour white logo. If there is an official reversed logo, upload that instead."]}
            yes="Make white version"
            danger={false}
            onYes={reverse}
          />
        </div>
      ) : null}
      <div aria-live="polite">
        <InlineError text={status} />
      </div>
      {report ? <div key={report.key}>{report.node}</div> : null}
      {unused.length ? (
        <>
          <SubHead>Not in use</SubHead>
          <ul className="file-rows plain-list block-gap-sm">
            {unused.map((l) => (
              <li key={l}>
                <span className="file-rows__name">{l.replace(/^logo\//, "")}</span>
                <DeleteFile rel={l} word="Delete" hidden={` ${l}`} />
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </>
  );
}

// ---------- icons and graphics ----------

export function IconsSection() {
  const { id, files, setFiles, icons, setIcons } = useEditor();
  const up = useRef<HTMLInputElement>(null);
  const gUp = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [chosen, setChosen] = useState({ icon: 0, graphic: 0 });
  const [report, setReport] = useState<{ key: number; kind: string; results: UploadResult[] } | null>(null);
  const own: any[] = files.icons ?? [];
  const graphics: any[] = files.graphics ?? [];

  async function uploadKind(kind: "icon" | "graphic", input: HTMLInputElement | null) {
    if (!input?.files?.length) return setStatus("Choose a file first.");
    if (busy) return;
    const fd = new FormData();
    for (const f of input.files) fd.append("file", f, f.name);
    if (kind === "icon" && name.trim() && input.files.length === 1) fd.append("iconName", name.trim());
    setStatus(null);
    setBusy(kind);
    try {
      const r = await api<any>("POST", `/api/brands/${encodeURIComponent(id)}/files/${kind}`, fd);
      setFiles(r.files);
      if (r.icons) setIcons(r.icons);
      input.value = "";
      setChosen((c) => ({ ...c, [kind]: 0 }));
      if (kind === "icon") setName("");
      setReport({ key: Date.now(), kind, results: r.results });
    } catch (e) {
      setStatus((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <BoundSelect path="icons.weight" id="icon-weight" label="Icon weight" hint={icons.library ? `${icons.library.toLocaleString("en-GB")} library icons, in six weights.` : undefined} options={ICON_WEIGHTS.map((w) => ({ value: w, label: capitalise(w) }))} />

      <SubHead>Your own icons</SubHead>
      {own.length ? (
        <AnimatedList className="icon-grid plain-list">
          {own.map((i) => (
            <AnimatedItem key={i.file}>
              <span className="icon-grid__tile">
                <img src={`/brand-files/${encodeURIComponent(id)}/${i.file}`} alt="" />
              </span>
              <span className="name">{i.name}</span>
              <span className="file-rows__meta">{[i.weight ? capitalise(String(i.weight)) : "", i.overridesLibrary ? "Replaces a library icon" : ""].filter(Boolean).join(" · ")}</span>
              <DeleteFile rel={i.file} word="Delete" hidden={` icon ${i.name}`} />
            </AnimatedItem>
          ))}
        </AnimatedList>
      ) : (
        <p className="block-gap-sm">None yet. Videos use the library icons.</p>
      )}
      <div className="section-gap">
        <FilePicker id="icon-upload" label="Add icons" hint="SVG. bin.svg becomes the “bin” icon." accept=".svg,image/svg+xml" multiple inputRef={up} onPick={(n) => setChosen((c) => ({ ...c, icon: n }))} />
      </div>
      <AnimatePresence initial={false}>
        {chosen.icon === 1 ? (
          <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0, transition: spring.snappy }} exit={{ opacity: 0, transition: { duration: duration.fast } }}>
            <Field id="icon-name" label="Icon name (optional)" hint="Lower case with hyphens, like brown-bin." className="field-gap">
              <input className="input" type="text" id="icon-name" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} aria-describedby="icon-name-hint" />
            </Field>
          </motion.div>
        ) : null}
      </AnimatePresence>
      <WhenChosen show={chosen.icon > 0}>
        <Button variant="default" id="icon-upload-button" onClick={() => uploadKind("icon", up.current)} aria-disabled={busy === "icon" || undefined} leftSection={icon(UploadSimple)}>
          {busy === "icon" ? "Uploading..." : "Upload icons"}
        </Button>
      </WhenChosen>
      {report?.kind === "icon" ? <UploadReport key={report.key} results={report.results} /> : null}

      <SubHead>Graphics</SubHead>
      {graphics.length ? (
        <AnimatedList className="file-rows plain-list block-gap-sm">
          {graphics.map((g) => (
            <AnimatedItem key={g.file}>
              <span className="file-rows__name">{g.file}</span>
              <DeleteFile rel={g.file} word="Delete" hidden={` ${g.file}`} />
            </AnimatedItem>
          ))}
        </AnimatedList>
      ) : (
        <p className="block-gap-sm">None yet.</p>
      )}
      <div className="section-gap">
        <FilePicker id="graphic-upload" label="Add graphics" hint="SVG, PNG, JPEG or WebP." accept=".svg,.png,.jpg,.jpeg,.webp" multiple inputRef={gUp} onPick={(n) => setChosen((c) => ({ ...c, graphic: n }))} />
      </div>
      <WhenChosen show={chosen.graphic > 0}>
        <Button variant="default" id="graphic-upload-button" onClick={() => uploadKind("graphic", gUp.current)} aria-disabled={busy === "graphic" || undefined} leftSection={icon(UploadSimple)}>
          {busy === "graphic" ? "Uploading..." : "Upload graphics"}
        </Button>
      </WhenChosen>
      {report?.kind === "graphic" ? <UploadReport key={report.key} results={report.results} /> : null}
      <div aria-live="polite">
        <InlineError text={status} />
      </div>
    </>
  );
}

// ---------- voice ----------

export function VoiceSection() {
  const { draft, edit, detail, meta } = useEditor();
  const voices: Array<{ id: string; label: string }> = detail.voices ?? meta.voices;
  const [player, setPlayer] = useState<{ busy?: boolean; url?: string; error?: string } | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const speed = Number(draft.voice.speed ?? 1);

  useEffect(() => {
    if (player?.url) audioRef.current?.play().catch(() => {});
  }, [player?.url]);

  async function play() {
    if (player?.busy) return;
    setPlayer({ busy: true });
    try {
      const r = await api<any>("POST", "/api/voice-sample", { voice: draft.voice.id, speed: draft.voice.speed });
      setPlayer({ url: r.url });
    } catch (e) {
      setPlayer({ error: (e as Error).message });
    }
  }

  return (
    <>
      <Field id="voice-id" label="Voice" hint="British voices first. Each video can still pick another.">
        <select
          className="select"
          id="voice-id"
          value={draft.voice.id}
          aria-describedby="voice-id-hint"
          onChange={(e) =>
            edit((d) => {
              d.voice.id = e.target.value;
              d.voice.lang = e.target.value.startsWith("b") ? "en-gb" : "en-us";
            })
          }
        >
          {voices.map((v) => (
            <option key={v.id} value={v.id}>
              {v.label}
            </option>
          ))}
        </select>
      </Field>
      <div className="field field-gap">
        <p className="label" id="voice-speed-label">
          Speed
        </p>
        <p className="hint" id="voice-speed-hint">
          0.8 is slower, 1.2 is faster.
        </p>
        <div className="speed">
          <Slider
            className="speed__slider"
            min={0.8}
            max={1.2}
            step={0.05}
            value={speed}
            onChange={(v) => edit((d) => (d.voice.speed = Number(v.toFixed(2))))}
            label={null}
            size="lg"
            color="ink.8"
            marks={[{ value: 0.8 }, { value: 1 }, { value: 1.2 }]}
            thumbProps={{ id: "voice-speed", "aria-labelledby": "voice-speed-label", "aria-describedby": "voice-speed-hint", "aria-valuetext": `${speed.toFixed(2)} times normal speed` }}
          />
          <output htmlFor="voice-speed" className="speed__out">{`${speed.toFixed(2)}×`}</output>
        </div>
      </div>
      <div className="buttons buttons-gap-sm">
        <Button variant="default" onClick={play} aria-disabled={player?.busy || undefined} leftSection={icon(Play)}>
          Play a sample
        </Button>
      </div>
      <div aria-live="polite" className="voice-status">
        {player?.busy ? (
          <Reveal y={4}>
            <p className="busy-line__text">
              <PulseDot /> Making the sample...
            </p>
          </Reveal>
        ) : null}
        {player?.error ? <InlineError text={player.error} /> : null}
        {player?.url ? (
          <Reveal y={4}>
            <audio ref={audioRef} controls src={player.url} aria-label="Voice sample" className="sample-audio" />
          </Reveal>
        ) : null}
      </div>
    </>
  );
}

// ---------- writing ----------

/** One rule per line, kept as typed (blank lines and all) until it is saved into the draft as a list. */
function RulesBox({ path, label, hint }: { path: string; label: string; hint: string }) {
  const { draft, setValue, revision } = useEditor();
  const id = `f-${path.replace(/\./g, "-")}`;
  const list: string[] = getPath(draft, path) ?? [];
  const [text, setText] = useState(list.join("\n"));
  useEffect(() => {
    const now = text
      .split("\n")
      .map((x) => x.trim())
      .filter(Boolean);
    if (JSON.stringify(now) !== JSON.stringify(list)) setText(list.join("\n"));
  }, [revision, JSON.stringify(list)]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Field id={id} label={label} hint={hint}>
      <textarea
        className="textarea"
        id={id}
        rows={4}
        value={text}
        aria-describedby={`${id}-hint`}
        onChange={(e) => {
          setText(e.target.value);
          setValue(
            path,
            e.target.value
              .split("\n")
              .map((x) => x.trim())
              .filter(Boolean),
          );
        }}
      />
    </Field>
  );
}

export function WritingSection() {
  return (
    <>
      <p className="section-intro">The script writer reads this for every video.</p>
      <div className="section-gap">
        <BoundText path="toneOfVoice" label="Tone of voice" hint="For example: calm and helpful, short sentences, no jargon." multiline rows={4} max={4000} />
        <RulesBox path="rules.do" label="Do" hint="One rule per line." />
        <RulesBox path="rules.dont" label="Don't" hint="One rule per line." />
        <BoundText path="guidelines" label="Other writing guidelines" hint="Dates and numbers, words to use or avoid, what every video must include." multiline rows={6} max={20000} />
      </div>
    </>
  );
}

