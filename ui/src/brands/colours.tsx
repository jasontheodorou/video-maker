// Colours: the brand's colours, the contrast checks with one-click fixes, and which colour each surface uses.
import { Button } from "@mantine/core";
import { MagicWand, Plus, X } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { announce, api, focusNode, setPath } from "../shared/api";
import { AnimatedItem, AnimatedList, Reveal } from "../shared/motion";
import { Disclosure, Tag } from "../shared/ui";
import { useEditor } from "./context";
import { BoundSelect, SubHead, icon } from "./parts";

export const ROLES = [
  { key: "primary", label: "Primary", hint: "Openings and endings", required: true },
  { key: "text", label: "Text", hint: "Near black", required: true },
  { key: "background", label: "Background", hint: "Usually white", required: true },
  { key: "accent", label: "Accent", hint: "Highlighted words", required: true },
  { key: "tint", label: "Tint", hint: "Softer backgrounds", required: true },
  { key: "accent2", label: "Second accent", hint: "Optional", required: false },
  { key: "line", label: "Line", hint: "Rules and borders", required: false },
];
const SURFACES = [
  { key: "dark", label: "Dark surface", hint: "title and end card" },
  { key: "light", label: "Light surface", hint: "messages" },
  { key: "tint", label: "Tint surface", hint: "softer scenes" },
];
const isHex = (v: string) => /^#[0-9A-Fa-f]{6}$/.test(v);

/** A picture of a colour pair, drawn as SVG so failing pairs show as they look while the page's own text keeps AAA. */
function ContrastSample({ fg, bg }: { fg: string; bg: string }) {
  return (
    <svg className="sample" viewBox="0 0 72 44" aria-hidden="true" focusable="false">
      <rect width="72" height="44" rx="8" fill={bg} />
      <text x="36" y="29" textAnchor="middle" fontSize="20" fontWeight="700" fill={fg}>
        Aa
      </text>
    </svg>
  );
}

function ColourRow({ r }: { r: (typeof ROLES)[number] }) {
  const { draft, edit } = useEditor();
  const tok = draft.colours[r.key];
  const hexId = `c-${r.key}-hex`;
  const [hex, setHex] = useState<string>(tok?.value ?? "");
  const [err, setErr] = useState(false);
  useEffect(() => {
    if (!tok) return;
    const typed = /^[0-9A-Fa-f]{6}$/.test(hex.trim()) ? `#${hex.trim()}` : hex.trim();
    if (typed.toUpperCase() !== String(tok.value).toUpperCase()) {
      setHex(tok.value);
      setErr(false);
    }
  }, [tok?.value]); // eslint-disable-line react-hooks/exhaustive-deps
  const setVal = (v: string) => edit((d) => (d.colours[r.key] = { ...(d.colours[r.key] ?? {}), value: v.toUpperCase() }));

  if (!tok && !r.required) {
    return (
      <div className="colour-row colour-row--unused">
        <p className="colour-row__role">{r.label}</p>
        <Button
          id={`c-${r.key}-add`}
          variant="subtle"
          className="small"
          leftSection={icon(Plus, 20)}
          onClick={() => {
            edit((d) => (d.colours[r.key] = { value: "#505A5F", name: r.label }));
            requestAnimationFrame(() => document.getElementById(hexId)?.focus());
          }}
        >
          Add<span className="visually-hidden">{` a ${r.label.toLowerCase()} colour`}</span>
        </Button>
      </div>
    );
  }
  return (
    <Reveal y={4}>
      <fieldset className="colour-row" aria-describedby={`c-${r.key}-hint`}>
        <legend className="visually-hidden">{`${r.label} colour`}</legend>
        <input
          type="color"
          className="colour-pick"
          id={`c-${r.key}-pick`}
          value={String(tok?.value ?? "#000000").toLowerCase()}
          aria-label={`${r.label} colour picker`}
          onChange={(e) => {
            setHex(e.target.value.toUpperCase());
            setErr(false);
            setVal(e.target.value);
          }}
        />
        <div className="colour-row__main">
          <p className="colour-row__role" aria-hidden="true">
            {r.label}
            <span className="colour-row__hint" id={`c-${r.key}-hint`}>
              {r.hint}
            </span>
          </p>
          <div className="colour-row__fields">
            <div className="colour-row__field colour-row__field--hex">
              <label className="label label--small" htmlFor={hexId}>
                Hex<span className="visually-hidden">{` value for ${r.label.toLowerCase()}`}</span>
              </label>
              <input
                className="input"
                type="text"
                id={hexId}
                value={hex}
                maxLength={7}
                spellCheck={false}
                autoComplete="off"
                aria-invalid={err ? true : undefined}
                aria-describedby={[err ? `${hexId}-err` : "", `c-${r.key}-hint`].filter(Boolean).join(" ")}
                onChange={(e) => {
                  setHex(e.target.value);
                  let v = e.target.value.trim();
                  if (/^[0-9A-Fa-f]{6}$/.test(v)) v = `#${v}`;
                  if (isHex(v)) {
                    setErr(false);
                    setVal(v);
                  } else setErr(true);
                }}
              />
            </div>
            <div className="colour-row__field">
              <label className="label label--small" htmlFor={`c-${r.key}-name`}>
                Name<span className="visually-hidden">{` of the ${r.label.toLowerCase()} colour`}</span>
              </label>
              <input
                className="input"
                type="text"
                id={`c-${r.key}-name`}
                maxLength={40}
                value={tok?.name ?? ""}
                onChange={(e) =>
                  edit((d) => {
                    const v = e.target.value;
                    if (v.trim()) d.colours[r.key].name = v;
                    else delete d.colours[r.key].name;
                  })
                }
              />
            </div>
            {r.required ? null : (
              <button
                type="button"
                className="icon-btn"
                onClick={() => {
                  edit((d) => delete d.colours[r.key]);
                  requestAnimationFrame(() => document.getElementById(`c-${r.key}-add`)?.focus());
                }}
              >
                <X size={20} weight="bold" aria-hidden="true" />
                <span className="icon-btn__text">
                  Remove<span className="visually-hidden">{` the ${r.label.toLowerCase()} colour`}</span>
                </span>
              </button>
            )}
          </div>
          {err ? (
            <p className="error-msg" id={`${hexId}-err`}>
              <span className="visually-hidden">Error: </span>Enter # and 6 letters or numbers, like #0B3B60
            </p>
          ) : null}
        </div>
      </fieldset>
    </Reveal>
  );
}

export function ColoursSection() {
  const { id, draft, edit, check, bump } = useEditor();
  const [notes, setNotes] = useState<{ ok: boolean; notes: string[]; error?: string } | null>(null);
  const [proposing, setProposing] = useState(false);
  const notesRef = useRef<HTMLDivElement>(null);

  async function propose(focusAfter = false) {
    if (proposing) return;
    setProposing(true);
    try {
      const p = await api<any>("POST", `/api/brands/${encodeURIComponent(id)}/propose-surfaces`, { colours: draft.colours });
      edit((d) => {
        d.surfaces = p.surfaces;
        d.captions = { ...d.captions, ...p.captions };
      });
      setNotes({ ok: p.ok, notes: p.notes ?? [] });
    } catch (e) {
      setNotes({ ok: false, notes: [], error: (e as Error).message });
    } finally {
      setProposing(false);
    }
    if (focusAfter) requestAnimationFrame(() => focusNode(notesRef.current));
  }

  function applyFix(f: any) {
    edit((d) => {
      if (f.kind === "use") setPath(d, f.path, f.token);
      else if (f.kind === "recolour" && d.colours[f.colour]) d.colours[f.colour].value = String(f.value).toUpperCase();
    });
    bump();
    // The list is rebuilt when the check comes back; keep focus on the heading above it meanwhile.
    focusNode(document.getElementById("contrast-h"));
    announce(`${String(f.label).replace(/^Use/, "Using").replace(/^Change/, "Changed")}. The contrast checks are updating.`);
  }

  const pairs = check?.contrast ?? [];
  const failing = pairs.filter((p) => !p.result.passesAAA).length;
  const colourOptions = Object.keys(draft.colours)
    .filter((k) => draft.colours[k])
    .map((k) => ({ value: k, label: `${draft.colours[k].name || k} (${draft.colours[k].value})` }));
  const weights = [...new Set<number>((draft.fonts.faces ?? []).filter((f: any) => f.family === draft.fonts.body.family).map((f: any) => f.weight))].filter((w) => w >= 400 && w <= 800).sort();

  return (
    <>
      <p className="section-intro">Every text colour needs 7:1 contrast with its background (AAA).</p>
      <div className="colour-rows">
        {ROLES.map((r) => (
          <ColourRow key={r.key} r={r} />
        ))}
      </div>

      <SubHead id="contrast-h">
        Contrast <span className="sub-h__count">{pairs.length ? (failing ? `${failing} of ${pairs.length} fail` : `all ${pairs.length} pass`) : ""}</span>
      </SubHead>
      <div id="contrast">
        {!pairs.length ? (
          <p className="block-gap-sm">Shown once every colour has a valid value.</p>
        ) : (
          <AnimatedList className="contrast plain-list">
            {pairs.map((p) => {
              const r = p.result;
              const fixes = check?.fixes?.[p.id] ?? [];
              return (
                <AnimatedItem key={p.id} className={r.passesAAA ? "" : "fails"}>
                  <ContrastSample fg={r.foreground} bg={r.background} />
                  <div className="result">
                    <p className="result__head">
                      <span className="result__label">{p.label}</span> {r.passesAAA ? <Tag tone="good">{`Passes AAA: ${r.ratioText} to 1`}</Tag> : <Tag tone="bad">{`Fails AAA: ${r.ratioText} to 1`}</Tag>}
                    </p>
                    {!r.passesAAA ? (
                      <>
                        <p className="result__msg">{r.message.replace(/ Try #[0-9A-F]{6} for the text, or change the background\.$/, "")}</p>
                        {fixes.length ? (
                          <ul className="fix-list plain-list">
                            {fixes.map((f, k) => (
                              <li key={k}>
                                <Button variant="default" className="small" leftSection={icon(MagicWand, 20)} onClick={() => applyFix(f)}>
                                  {f.label}
                                </Button>
                                <span className="fix-list__note">{f.note}</span>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <div className="fixes">
                            <p>No single change fixes this. Let the video maker pick each surface's colours, or change the colours above.</p>
                            <Button variant="default" className="small" onClick={() => propose(true)} aria-disabled={proposing || undefined} leftSection={icon(MagicWand, 20)}>
                              Choose passing colours for me
                            </Button>
                          </div>
                        )}
                      </>
                    ) : null}
                  </div>
                </AnimatedItem>
              );
            })}
          </AnimatedList>
        )}
      </div>
      <div id="propose-notes" aria-live="polite" ref={notesRef} tabIndex={-1} className="propose-notes">
        {notes ? (
          <Reveal y={4}>
            {notes.error ? <p className="bad-text">{`Error: ${notes.error}`}</p> : notes.ok ? <p className="ok-text">Every pair now passes AAA.</p> : <p className="bad-text">Some pairs still fail. Change the colours themselves.</p>}
            {notes.notes.length ? (
              <ul className="list">
                {notes.notes.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            ) : null}
          </Reveal>
        ) : null}
      </div>

      <div className="section-gap">
        <Disclosure summary="Where each colour is used">
          <p>Scenes use surfaces. Pick each surface's colours, or let the video maker choose.</p>
          <div className="buttons buttons-gap-sm">
            <Button variant="default" id="propose-button" onClick={() => propose(false)} aria-disabled={proposing || undefined} leftSection={icon(MagicWand, 20)}>
              Choose passing colours for me
            </Button>
          </div>
          <div id="surface-selects" className="surface-grid">
            {SURFACES.map((s) => (
              <fieldset className="surface" key={s.key}>
                <legend className="label">
                  {s.label} <span className="surface__hint">{`for ${s.hint}`}</span>
                </legend>
                <BoundSelect path={`surfaces.${s.key}.background`} id={`s-surfaces-${s.key}-background`} label="Background" options={colourOptions} />
                <BoundSelect path={`surfaces.${s.key}.text`} id={`s-surfaces-${s.key}-text`} label="Text" options={colourOptions} />
                <BoundSelect path={`surfaces.${s.key}.accent`} id={`s-surfaces-${s.key}-accent`} label="Highlighted words" options={colourOptions} />
              </fieldset>
            ))}
            <fieldset className="surface">
              <legend className="label">Captions</legend>
              <BoundSelect path="captions.background" id="s-captions-background" label="Caption box" options={colourOptions} />
              <BoundSelect path="captions.text" id="s-captions-text" label="Caption text" options={colourOptions} />
              <BoundSelect path="captions.weight" id="s-captions-weight" label="Caption font weight" options={(weights.length ? weights : [400]).map((w) => ({ value: String(w), label: String(w) }))} toValue={Number} />
            </fieldset>
          </div>
        </Disclosure>
      </div>
    </>
  );
}
