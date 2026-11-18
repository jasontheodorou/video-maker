// Colours area: the palette (groups, colours, automatic tints), the colour schemes as cards with live
// previews, suggested schemes from the server, captions and the full contrast table. The inspector
// edits whichever colour or scheme is selected; with nothing selected it shows a preview and defaults.
import { Button, Menu, Popover } from "@mantine/core";
import { ArrowDown, ArrowUp, CheckCircle, Copy, DotsThree, MagicWand, Plus, Sparkle, Trash, WarningCircle, X } from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { announce, api, clone, focusNode, setPath } from "../../shared/api";
import { Disclosure, Message } from "../../shared/ui";
import { PART_LABEL, PART_WORD, contrastRatio, counterpart, expandPalette, hexToHsl, hslToHex, inkOn, isHex, parseRef, ratioText, refName, resolveRef, schemesUsing, slugId, tone, type Part } from "../colour";
import { plural, useEditor } from "../context";
import { SchemePreview } from "../scheme-preview";

const PARTS: Part[] = ["background", "text", "highlight", "shape"];
const EMPHASIS = [
  { value: "colour", label: "Colour" },
  { value: "weight", label: "Bold" },
  { value: "both", label: "Colour and bold" },
];
const FIT = [
  { value: "any", label: "Anywhere" },
  { value: "bookends", label: "Open and close only" },
  { value: "middle", label: "Middle scenes only" },
];
const LOGO = [
  { value: "auto", label: "Automatic" },
  { value: "onLight", label: "Light-background logo" },
  { value: "onDark", label: "Dark-background logo" },
];

/** Resolved colours and the two text checks for a scheme, worked out here so cards update as you pick. */
export function schemeState(s: any, palette: any) {
  const bg = resolveRef(s.background, palette);
  const fg = resolveRef(s.text, palette);
  const hlRaw = resolveRef(s.highlight, palette);
  const shape = resolveRef(s.shape, palette);
  const bold = s.emphasis === "weight";
  const hl = bold ? fg : hlRaw;
  const text = bg && fg ? contrastRatio(fg, bg) : 0;
  const key = bg && hl ? contrastRatio(hl, bg) : 0;
  const ok = Boolean(bg && fg && hl && shape) && text >= 7 && key >= 7;
  return { bg, fg, hl, hlRaw, shape, text, key, bold, ok };
}

const ratioLine = (r: number) => (r >= 7 ? `Passes AAA: ${ratioText(r)}` : `Fails AAA: ${ratioText(r)}`);

function Result({ label, ratio, id }: { label: string; ratio: number; id?: string }) {
  const pass = ratio >= 7;
  return (
    <p className={`cr ${pass ? "cr--ok" : "cr--bad"}`} id={id}>
      {pass ? <CheckCircle size={22} weight="fill" aria-hidden="true" /> : <WarningCircle size={22} weight="fill" aria-hidden="true" />}
      <span>
        <span className="cr__label">{label}: </span>
        {ratioLine(ratio)}
        {pass && ratio < 7.5 ? ". Close to the limit" : ""}
      </span>
    </p>
  );
}

// ---------- canvas ----------

export function ColoursCanvas() {
  return (
    <>
      <Palette />
      <Schemes />
      <div className="area-band">
        <Disclosure summary="Captions">
          <Captions />
        </Disclosure>
      </div>
      <div className="area-band">
        <Disclosure summary="All contrast pairs">
          <ContrastTable />
        </Disclosure>
      </div>
    </>
  );
}

// ---------- palette ----------

function Palette() {
  const { draft, edit, select, selection } = useEditor();
  const groups: any[] = draft.palette.groups;
  const colours: any[] = draft.palette.colours;
  const chips = useRef<HTMLDivElement>(null);

  function addColour(group: string) {
    const ids = colours.map((c) => c.id);
    const id = slugId("New colour", ids);
    edit((d) => d.palette.colours.push({ id, name: "New colour", value: "#505A5F", group, tints: true }));
    select({ kind: "colour", id });
    announce("Colour added. Set its name and hex.");
    requestAnimationFrame(() => focusNode(document.getElementById("ci-name")));
  }

  // Arrow keys move between chips, across groups.
  function onKey(e: React.KeyboardEvent) {
    if (!["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
    const all = [...(chips.current?.querySelectorAll<HTMLButtonElement>(".chip-c") ?? [])];
    const i = all.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    e.preventDefault();
    const n = e.key === "Home" ? 0 : e.key === "End" ? all.length - 1 : e.key === "ArrowRight" || e.key === "ArrowDown" ? Math.min(all.length - 1, i + 1) : Math.max(0, i - 1);
    all[n]?.focus();
  }

  return (
    <section className="area-band" id="palette" aria-labelledby="palette-h">
      <div className="band-head">
        <h3 className="band-h" id="palette-h">
          Palette <span className="band-count">{plural(colours.length, "colour")}</span>
        </h3>
      </div>
      <div ref={chips} onKeyDown={onKey}>
        {groups.map((g) => {
          const list = colours.filter((c) => c.group === g.id);
          return (
            <div className="pal-group" key={g.id} role="group" aria-labelledby={`pg-${g.id}`}>
              <h4 className="pal-group__h" id={`pg-${g.id}`}>
                {g.name}
              </h4>
              <ul className="pal-row plain-list">
                {list.map((c) => {
                  const used = schemesUsing(draft, c.id).length;
                  const on = selection?.kind === "colour" && selection.id === c.id;
                  const t25 = c.tints !== false ? resolveRef(`${c.id}.t25`, draft.palette) : null;
                  const t10 = c.tints !== false ? resolveRef(`${c.id}.t10`, draft.palette) : null;
                  return (
                    <li key={c.id}>
                      <button
                        type="button"
                        className="chip-c"
                        data-colour={c.id}
                        aria-pressed={on}
                        aria-label={`${c.name}, ${c.value}, ${used ? `used in ${plural(used, "scheme")}` : "not used yet"}`}
                        onClick={() => select(on ? null : { kind: "colour", id: c.id })}
                      >
                        <span className="chip-c__swatch" style={{ background: isHex(c.value) ? c.value : "#FFFFFF" }} />
                        {t25 && t10 ? (
                          <span className="chip-c__tints">
                            <span style={{ background: t25 }} />
                            <span style={{ background: t10 }} />
                          </span>
                        ) : null}
                        <span className="chip-c__name">{c.name}</span>
                        <span className="chip-c__hex">{c.value}</span>
                      </button>
                    </li>
                  );
                })}
                <li>
                  <button type="button" className="chip-add" onClick={() => addColour(g.id)}>
                    <Plus size={22} weight="bold" aria-hidden="true" />
                    <span>
                      Add colour<span className="visually-hidden">{` to ${g.name}`}</span>
                    </span>
                  </button>
                </li>
              </ul>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function ColourInspector({ colourId }: { colourId: string }) {
  const { draft, edit, select, revision } = useEditor();
  const c = draft.palette.colours.find((x: any) => x.id === colourId);
  const [hex, setHex] = useState<string>(c?.value ?? "");
  const [err, setErr] = useState(false);
  const [replaceWith, setReplaceWith] = useState("");
  const [askDelete, setAskDelete] = useState(false);
  useEffect(() => {
    if (!c) return;
    if (hex.toUpperCase() !== String(c.value).toUpperCase() || revision) {
      setHex(c.value);
      setErr(false);
    }
  }, [c?.value, colourId, revision]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!c) return <p>That colour has gone.</p>;
  const index = draft.palette.colours.indexOf(c);
  const hexId = `c-${c.id}-hex`;
  const set = (fn: (x: any) => void) => edit((d) => fn(d.palette.colours.find((x: any) => x.id === colourId)));
  const setVal = (v: string) => set((x) => (x.value = v.toUpperCase()));
  const hsl = isHex(c.value) ? hexToHsl(c.value) : { h: 0, s: 0, l: 50 };
  const users = schemesUsing(draft, c.id);
  const others = draft.palette.colours.filter((x: any) => x.id !== c.id);

  function move(dir: -1 | 1) {
    edit((d) => {
      const list = d.palette.colours;
      const i = list.findIndex((x: any) => x.id === colourId);
      const j = i + dir;
      if (j < 0 || j >= list.length) return;
      [list[i], list[j]] = [list[j], list[i]];
    });
    announce(dir < 0 ? "Moved up." : "Moved down.");
  }
  function remove() {
    edit((d) => {
      d.palette.colours = d.palette.colours.filter((x: any) => x.id !== colourId);
    });
    select(null);
    announce(`${c.name} deleted.`);
    requestAnimationFrame(() => focusNode(document.getElementById("palette-h")));
  }
  function replaceEverywhere() {
    if (!replaceWith) return;
    edit((d) => {
      for (const s of d.schemes) {
        for (const p of PARTS) {
          const r = parseRef(s[p]);
          if (r.base !== colourId) continue;
          const target = d.palette.colours.find((x: any) => x.id === replaceWith);
          s[p] = r.step !== 100 && target?.tints !== false ? `${replaceWith}.t${r.step}` : replaceWith;
        }
      }
      for (const k of ["background", "text"]) if (parseRef(d.captions?.[k] ?? "").base === colourId) d.captions[k] = replaceWith;
    });
    announce(`Replaced with ${refName(replaceWith, draft.palette)}. You can delete it now.`);
  }

  const slider = (key: "h" | "s" | "l", label: string, max: number) => (
    <div className="field hsl">
      <label className="label" htmlFor={`ci-${key}`}>
        {label}
      </label>
      <div className="hsl__row">
        <input
          type="range"
          id={`ci-${key}`}
          min={0}
          max={max}
          value={hsl[key]}
          aria-valuetext={`${label} ${hsl[key]}${key === "h" ? " degrees" : "%"}`}
          onChange={(e) => {
            const n = { ...hsl, [key]: Number(e.target.value) };
            setVal(hslToHex(n.h, n.s, n.l));
          }}
        />
        <output htmlFor={`ci-${key}`} className="hsl__out">
          {hsl[key]}
          {key === "h" ? "°" : "%"}
        </output>
      </div>
    </div>
  );

  const tintRow = (step: 10 | 25) => {
    const v = resolveRef(`${c.id}.t${step}`, draft.palette);
    if (!v) return null;
    const exact = step === 10 ? c.tintValues?.t10 : c.tintValues?.t25;
    return (
      <li className="tint-row" key={step}>
        <span className="tint-row__sw" style={{ background: v }} aria-hidden="true" />
        <span>
          <strong>{`${step}%`}</strong> {v}
          <br />
          {`Ink text ${ratioText(contrastRatio("#0B0C0C", v))}`}
          {exact ? (
            <>
              <br />
              From your guide.{" "}
              <button type="button" className="link-button" onClick={() => set((x) => delete x.tintValues[`t${step}`])}>
                Work it out instead
              </button>
            </>
          ) : null}
        </span>
      </li>
    );
  };

  return (
    <div className="insp-body">
      <h2 className="insp-h" id="insp-h" tabIndex={-1}>
        <span className="insp-sw" style={{ background: isHex(c.value) ? c.value : "#fff" }} aria-hidden="true" />
        {c.name}
      </h2>
      <div className="field">
        <label className="label" htmlFor="ci-name">
          Name
        </label>
        <input className="input" id="ci-name" maxLength={40} value={c.name} onChange={(e) => set((x) => (x.name = e.target.value))} />
      </div>
      <div className="field">
        <label className="label" htmlFor={hexId}>
          Hex
        </label>
        <div className="hex-row">
          <input
            className="input hex-input"
            id={hexId}
            value={hex}
            maxLength={7}
            spellCheck={false}
            autoComplete="off"
            aria-invalid={err || undefined}
            aria-describedby={err ? `${hexId}-err` : undefined}
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
          <input
            type="color"
            className="colour-pick"
            aria-label="Pick from the colour wheel"
            value={isHex(c.value) ? c.value.toLowerCase() : "#000000"}
            onChange={(e) => {
              setHex(e.target.value.toUpperCase());
              setErr(false);
              setVal(e.target.value);
            }}
          />
        </div>
        {err ? (
          <p className="error-msg" id={`${hexId}-err`}>
            <span className="visually-hidden">Error: </span>Use # and 6 characters, like #002D59.
          </p>
        ) : null}
      </div>
      {slider("h", "Hue", 360)}
      {slider("s", "Saturation", 100)}
      {slider("l", "Lightness", 100)}
      <div className="field">
        <label className="label" htmlFor="ci-group">
          Group
        </label>
        <select className="select" id="ci-group" value={c.group} onChange={(e) => set((x) => (x.group = e.target.value))}>
          {draft.palette.groups.map((g: any) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
      </div>
      <label className="switch-row" htmlFor="ci-tints">
        <input
          type="checkbox"
          role="switch"
          id="ci-tints"
          checked={c.tints !== false}
          disabled={users.some((s: any) => PARTS.some((p) => s[p].startsWith(`${c.id}.t`)))}
          onChange={(e) => set((x) => (x.tints = e.target.checked))}
        />
        <span>Make 10% and 25% tints</span>
      </label>
      {users.some((s: any) => PARTS.some((p) => s[p].startsWith(`${c.id}.t`))) ? <p className="hint">A scheme uses a tint, so tints stay on.</p> : null}
      {c.tints !== false ? <ul className="plain-list tint-list">{[tintRow(25), tintRow(10)]}</ul> : null}

      <h3 className="insp-sub">Used in</h3>
      {users.length ? (
        <ul className="plain-list used-list">
          {users.map((s: any) => (
            <li key={s.id}>
              <button type="button" className="link-button" onClick={() => select({ kind: "scheme", id: s.id })}>
                {s.name}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p>No schemes yet.</p>
      )}

      <div className="buttons insp-actions">
        <Button variant="default" onClick={() => move(-1)} disabled={index === 0} leftSection={<ArrowUp size={20} aria-hidden="true" />}>
          Move up
        </Button>
        <Button variant="default" onClick={() => move(1)} disabled={index === draft.palette.colours.length - 1} leftSection={<ArrowDown size={20} aria-hidden="true" />}>
          Move down
        </Button>
      </div>

      <h3 className="insp-sub">Delete</h3>
      {users.length || ["background", "text"].some((k) => parseRef(draft.captions?.[k] ?? "").base === c.id) ? (
        <>
          <p>{users.length ? `Used by ${plural(users.length, "scheme")}. Change those first.` : "Used by the captions. Change those first."}</p>
          <div className="field">
            <label className="label" htmlFor="ci-replace">
              Replace with
            </label>
            <select className="select" id="ci-replace" value={replaceWith} onChange={(e) => setReplaceWith(e.target.value)}>
              <option value="">Choose a colour</option>
              {others.map((o: any) => (
                <option key={o.id} value={o.id}>
                  {`${o.name} ${o.value}`}
                </option>
              ))}
            </select>
          </div>
          <div className="buttons">
            <Button variant="default" onClick={replaceEverywhere} disabled={!replaceWith}>
              Replace everywhere
            </Button>
          </div>
        </>
      ) : askDelete ? (
        <div className="confirm" role="group" aria-labelledby="ci-del-q">
          <Message tone="warn">
            <p id="ci-del-q">{`Delete ${c.name}?`}</p>
            <div className="buttons">
              <Button color="red" className="danger" onClick={remove} autoFocus>
                Yes, delete it
              </Button>
              <Button variant="default" onClick={() => setAskDelete(false)}>
                Cancel
              </Button>
            </div>
          </Message>
        </div>
      ) : (
        <Button variant="default" className="quiet-danger" onClick={() => setAskDelete(true)} disabled={draft.palette.colours.length <= 2} leftSection={<Trash size={20} aria-hidden="true" />}>
          Delete colour
        </Button>
      )}
    </div>
  );
}

// ---------- the palette picker ----------

/** A swatch button that opens the palette: every colour and tint, each with its ratio against the part it must stand out from. */
export function ColourField({ schemeIndex, part, big }: { schemeIndex: number; part: Part; big?: boolean }) {
  const { draft, edit } = useEditor();
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState("");
  const [customErr, setCustomErr] = useState(false);
  const s = draft.schemes[schemeIndex];
  const value = resolveRef(s[part], draft.palette) ?? "#FFFFFF";
  const { against, need } = counterpart(part);
  const other = resolveRef(s[against], draft.palette);
  const nowRatio = other ? contrastRatio(value, other) : 0;
  const options = expandPalette(draft.palette);
  const scored = options.map((o) => ({ ...o, ratio: other ? contrastRatio(o.value, other) : 0 }));
  const good = scored.filter((o) => o.ratio >= need || part === "shape");
  const low = scored.filter((o) => !(o.ratio >= need || part === "shape"));
  const label = `Change ${PART_WORD[part]} of ${s.name}. Now ${refName(s[part], draft.palette)}${part === "shape" ? "" : `, ${ratioText(nowRatio)}`}`;

  function pick(ref: string) {
    edit((d) => (d.schemes[schemeIndex][part] = ref));
    setOpen(false);
    announce(`${PART_LABEL[part]} is now ${refName(ref, draft.palette)}.`);
  }
  function addCustom() {
    let v = custom.trim();
    if (/^[0-9A-Fa-f]{6}$/.test(v)) v = `#${v}`;
    if (!isHex(v)) return setCustomErr(true);
    const id = slugId(`Extra ${v.slice(1)}`, draft.palette.colours.map((c: any) => c.id));
    edit((d) => {
      if (!d.palette.groups.some((g: any) => g.id === "extra")) d.palette.groups.push({ id: "extra", name: "Extra" });
      d.palette.colours.push({ id, name: `Extra ${v.toUpperCase()}`, value: v.toUpperCase(), group: "extra", tints: false });
      d.schemes[schemeIndex][part] = id;
    });
    setOpen(false);
    setCustom("");
    announce(`Added ${v.toUpperCase()} to the palette and used it.`);
  }
  const opt = (o: (typeof scored)[number]) => (
    <li key={o.ref}>
      <button type="button" className="pick-opt" aria-current={o.ref === s[part] || undefined} onClick={() => pick(o.ref)}>
        <span className="pick-opt__sw" style={{ background: o.value }} aria-hidden="true" />
        <span className="pick-opt__name">{o.name}</span>
        {part === "shape" ? <span className="pick-opt__ratio">{o.value}</span> : <span className="pick-opt__ratio">{ratioText(o.ratio)}</span>}
      </button>
    </li>
  );

  return (
    <Popover opened={open} onChange={setOpen} position="bottom-start" trapFocus returnFocus withinPortal shadow="md" width={320}>
      <Popover.Target>
        <button type="button" className={`sw-btn${big ? " sw-btn--big" : ""}`} aria-label={label} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <span className="sw-btn__sw" style={{ background: value }} aria-hidden="true" />
          <span className="sw-btn__text" aria-hidden="true">
            <span className="sw-btn__part">{PART_LABEL[part]}</span>
            {big ? <span className="sw-btn__name">{refName(s[part], draft.palette)}</span> : null}
          </span>
        </button>
      </Popover.Target>
      <Popover.Dropdown className="pick">
        <p className="pick__h">{`${PART_LABEL[part]} for ${s.name}`}</p>
        <ul className="plain-list pick__list">{good.map(opt)}</ul>
        {low.length ? (
          <>
            <p className="pick__div">Too low for text</p>
            <ul className="plain-list pick__list">{low.map(opt)}</ul>
          </>
        ) : null}
        <div className="field pick__custom">
          <label className="label" htmlFor={`custom-${schemeIndex}-${part}`}>
            Custom colour
          </label>
          <div className="hex-row">
            <input
              className="input hex-input"
              id={`custom-${schemeIndex}-${part}`}
              value={custom}
              maxLength={7}
              placeholder="#"
              aria-invalid={customErr || undefined}
              onChange={(e) => {
                setCustom(e.target.value);
                setCustomErr(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addCustom();
                }
              }}
            />
            <Button variant="default" onClick={addCustom}>
              Add
            </Button>
          </div>
          {customErr ? <p className="error-msg">Use # and 6 characters, like #002D59.</p> : null}
        </div>
      </Popover.Dropdown>
    </Popover>
  );
}

// ---------- schemes ----------

/** Apply one of the server's fixes to the draft. */
export function useApplyFix() {
  const { edit, bump } = useEditor();
  return (f: any) => {
    edit((d) => {
      if (f.addColour && !d.palette.colours.some((c: any) => c.id === f.addColour.id)) {
        if (!d.palette.groups.some((g: any) => g.id === f.addColour.group)) d.palette.groups.push({ id: f.addColour.group, name: f.addColour.group[0].toUpperCase() + f.addColour.group.slice(1) });
        d.palette.colours.push(clone(f.addColour));
      }
      if (f.kind === "set") setPath(d, f.path, f.value);
      else if (f.path && (f.colour || f.token)) setPath(d, f.path, f.colour ?? f.token);
    });
    bump();
    announce(`${String(f.label).replace(/^Use/, "Using").replace(/^Change/, "Changed").replace(/^Make/, "Made")}.`);
  };
}

function Fixes({ schemeId, focusAfter }: { schemeId: string; focusAfter?: string }) {
  const { check } = useEditor();
  const apply = useApplyFix();
  const parts = ["text", "highlight", "shape", "icon", "background"];
  const fixes = parts.flatMap((p) => check?.fixes?.[`schemes.${schemeId}.${p}`] ?? []).slice(0, 3);
  if (!fixes.length) return null;
  return (
    <ul className="plain-list fix-list">
      {fixes.map((f: any, k: number) => (
        <li key={k}>
          <Button
            variant="default"
            leftSection={<MagicWand size={20} aria-hidden="true" />}
            onClick={() => {
              apply(f);
              if (focusAfter) requestAnimationFrame(() => focusNode(document.getElementById(focusAfter)));
            }}
          >
            {f.label}
          </Button>
        </li>
      ))}
    </ul>
  );
}

function schemeMenu(i: number, edit: (fn: (d: any) => void) => void, draft: any, select: (s: any) => void) {
  const s = draft.schemes[i];
  return {
    duplicate() {
      const id = slugId(`${s.id}-copy`, draft.schemes.map((x: any) => x.id), "scheme");
      edit((d) => d.schemes.splice(i + 1, 0, { ...clone(s), id, name: `${s.name} copy`.slice(0, 40), source: "you" }));
      select({ kind: "scheme", id });
      announce(`${s.name} duplicated.`);
    },
    move(dir: -1 | 1) {
      edit((d) => {
        const j = i + dir;
        if (j < 0 || j >= d.schemes.length) return;
        [d.schemes[i], d.schemes[j]] = [d.schemes[j], d.schemes[i]];
      });
      announce(dir < 0 ? "Moved earlier." : "Moved later.");
    },
    bookends() {
      edit((d) => {
        d.schemeUse = { ...(d.schemeUse ?? { mode: "spread" }), bookends: s.id };
      });
      announce(`${s.name} opens and closes videos.`);
    },
    remove() {
      edit((d) => {
        d.schemes.splice(i, 1);
        if (d.schemeUse?.single === s.id) d.schemeUse.single = null;
        if (d.schemeUse?.bookends === s.id) d.schemeUse.bookends = null;
      });
      select(null);
      announce(`${s.name} deleted.`);
      requestAnimationFrame(() => focusNode(document.getElementById("schemes-h")));
    },
  };
}

function SchemeCard({ i }: { i: number }) {
  const { draft, edit, select, selection } = useEditor();
  const s = draft.schemes[i];
  const st = schemeState(s, draft.palette);
  const on = selection?.kind === "scheme" && selection.id === s.id;
  const m = schemeMenu(i, edit, draft, select);
  const enabledCount = draft.schemes.filter((x: any) => x.enabled !== false).length;
  return (
    <li className={`scard${st.ok ? "" : " scard--bad"}${on ? " scard--on" : ""}`} data-scheme={s.id}>
      <button type="button" className="scard__pick" aria-pressed={on} onClick={() => select(on ? null : { kind: "scheme", id: s.id })}>
        <SchemePreview scheme={s} />
        <span className="visually-hidden">{`Edit ${s.name}`}</span>
      </button>
      <div className="scard__body">
        <div className="scard__head">
          <h4 className="scard__name">{s.name}</h4>
          <label className="switch-row switch-row--small" htmlFor={`sw-${s.id}`}>
            <input
              type="checkbox"
              role="switch"
              id={`sw-${s.id}`}
              checked={s.enabled !== false}
              disabled={s.enabled !== false && enabledCount <= 1}
              onChange={(e) => edit((d) => (d.schemes[i].enabled = e.target.checked))}
            />
            <span>
              In use<span className="visually-hidden">{`: ${s.name}`}</span>
            </span>
          </label>
          <Menu position="bottom-end" withinPortal>
            <Menu.Target>
              <button type="button" className="icon-btn-sq" aria-label={`More for ${s.name}`}>
                <DotsThree size={24} weight="bold" aria-hidden="true" />
              </button>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item onClick={m.duplicate} leftSection={<Copy size={20} aria-hidden="true" />}>
                Duplicate
              </Menu.Item>
              <Menu.Item onClick={() => m.move(-1)} disabled={i === 0}>
                Move earlier
              </Menu.Item>
              <Menu.Item onClick={() => m.move(1)} disabled={i === draft.schemes.length - 1}>
                Move later
              </Menu.Item>
              <Menu.Item onClick={m.bookends}>Use to open and close videos</Menu.Item>
              <Menu.Item onClick={m.remove} disabled={draft.schemes.length <= 1} leftSection={<Trash size={20} aria-hidden="true" />}>
                Delete
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        </div>
        <div className="scard__swatches">
          {PARTS.map((p) => (
            <ColourField key={p} schemeIndex={i} part={p} />
          ))}
        </div>
        <Result label="Text" ratio={st.text} />
        {st.bold ? <p className="cr">Key words: bold, in the text colour</p> : <Result label="Key words" ratio={st.key} />}
        {st.ok ? null : (
          <>
            <p className="scard__off">Not used until fixed</p>
            <Fixes schemeId={s.id} />
          </>
        )}
        {s.enabled === false ? <p className="scard__off">Switched off</p> : null}
      </div>
    </li>
  );
}

function Schemes() {
  const { draft, edit, select, id } = useEditor();
  const [rec, setRec] = useState<{ schemes: any[]; notes?: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const inUse = draft.schemes.filter((s: any) => s.enabled !== false && schemeState(s, draft.palette).ok).length;
  const rules = draft.palette.rules;

  async function suggest() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<any>("POST", `/api/brands/${encodeURIComponent(id)}/schemes/recommend`, { brand: draft, useRules: draft.palette.rules ? true : undefined, limit: 6 });
      setRec(r);
      setDismissed([]);
      requestAnimationFrame(() => focusNode(document.getElementById("suggestions-band-h")));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function newScheme() {
    const sid = slugId("scheme", draft.schemes.map((s: any) => s.id), "scheme");
    const first = draft.schemes[0];
    edit((d) => d.schemes.push({ ...clone(first), id: sid, name: "New scheme", enabled: true, source: "you" }));
    select({ kind: "scheme", id: sid });
    announce("New scheme added. Choose its colours.");
    requestAnimationFrame(() => focusNode(document.getElementById("si-name")));
  }

  const same = (a: any, b: any) => PARTS.every((p) => a[p] === b[p]) && (a.emphasis ?? "colour") === (b.emphasis ?? "colour");
  const shown = (rec?.schemes ?? []).filter((s) => !dismissed.includes(s.id) && !draft.schemes.some((x: any) => same(x, s)));

  function add(s: any) {
    const taken = draft.schemes.map((x: any) => x.id);
    edit((d) => {
      for (const c of s.adds ?? []) if (c?.id && !d.palette.colours.some((x: any) => x.id === c.id)) d.palette.colours.push(clone(c));
      const { score, reasons, contrast, kind, adds, ...rest } = s;
      void score, reasons, contrast, kind, adds;
      d.schemes.push({ ...rest, id: slugId(s.id, taken, "scheme"), enabled: true, source: "suggested" });
    });
    announce(`${s.name} added.`);
  }

  return (
    <section className="area-band" id="schemes" aria-labelledby="schemes-h">
      <div className="band-head">
        <h3 className="band-h" id="schemes-h" tabIndex={-1}>
          Schemes <span className="band-count">{`${inUse} in use`}</span>
        </h3>
        <div className="buttons">
          <Button id="propose-button" variant="default" onClick={suggest} loading={busy} leftSection={<Sparkle size={20} aria-hidden="true" />}>
            Suggest schemes
          </Button>
          <Button variant="default" onClick={newScheme} leftSection={<Plus size={20} aria-hidden="true" />}>
            New scheme
          </Button>
        </div>
      </div>
      {rules?.text?.length ? <p className="band-note">{`Following your guide: text in ${rules.text.map((t: string) => refName(t, draft.palette)).join(" or ")}.`}</p> : null}
      {error ? (
        <p className="error-msg" role="alert">
          {error}
        </p>
      ) : null}
      {rec ? (
        <div id="suggestions-band" className="sugg" role="region" aria-labelledby="suggestions-band-h">
          <div className="band-head">
            <h4 className="sugg__h" id="suggestions-band-h" tabIndex={-1}>
              {shown.length ? `Suggested schemes (${shown.length})` : "No new suggestions"}
            </h4>
            <div className="buttons">
              {shown.length > 1 ? (
                <Button variant="default" onClick={() => shown.forEach(add)}>
                  Add all
                </Button>
              ) : null}
              <Button variant="subtle" onClick={() => setRec(null)} leftSection={<X size={20} aria-hidden="true" />}>
                Close suggestions
              </Button>
            </div>
          </div>
          {shown.length ? (
            <ul className="plain-list sugg__grid">
              {shown.map((s) => (
                <li className="sugg__card" key={s.id}>
                  <SchemePreview scheme={s} />
                  <p className="sugg__name">{s.name}</p>
                  <p className="sugg__why">{(s.reasons ?? [])[0] ?? ""}</p>
                  <p className="cr cr--ok">
                    <CheckCircle size={22} weight="fill" aria-hidden="true" />
                    <span>{`Text ${ratioText(s.contrast?.text ?? 0)}`}</span>
                  </p>
                  <div className="buttons">
                    <Button onClick={() => add(s)} leftSection={<Plus size={20} aria-hidden="true" />}>
                      Add<span className="visually-hidden">{` ${s.name}`}</span>
                    </Button>
                    <Button variant="default" onClick={() => setDismissed((d) => [...d, s.id])}>
                      Dismiss<span className="visually-hidden">{` ${s.name}`}</span>
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p>Every good pairing is already a scheme.</p>
          )}
        </div>
      ) : null}
      <div id="surface-selects">
        <ul className="plain-list scheme-grid">
          {draft.schemes.map((s: any, i: number) => (
            <SchemeCard key={s.id} i={i} />
          ))}
        </ul>
      </div>
    </section>
  );
}

export function SchemeInspector({ schemeId }: { schemeId: string }) {
  const { draft, edit, select, check } = useEditor();
  const [scene, setScene] = useState("statement");
  const [format, setFormat] = useState("16x9");
  const i = draft.schemes.findIndex((s: any) => s.id === schemeId);
  if (i < 0) return <p>That scheme has gone.</p>;
  const s = draft.schemes[i];
  const st = schemeState(s, draft.palette);
  const m = schemeMenu(i, edit, draft, select);
  const set = (k: string, v: unknown) => edit((d) => (d.schemes[i][k] = v));
  const iconShape = st.shape && st.hl ? contrastRatio(st.bold ? (st.fg as string) : (st.hl as string), st.shape) : 0;
  const serverIssues = (check?.issues ?? []).filter((x) => x.field.startsWith(`schemes.${s.id}.`) && !/^Fails AAA/.test(x.message));
  const enabledCount = draft.schemes.filter((x: any) => x.enabled !== false).length;
  return (
    <div className="insp-body">
      <h2 className="insp-h" id="insp-h" tabIndex={-1}>
        {s.name}
      </h2>
      <SchemePreview scheme={s} scene={scene} format={format} maxHeight={320} />
      <div className="two-up">
        <div className="field">
          <label className="label" htmlFor="si-scene">
            Scene
          </label>
          <select className="select" id="si-scene" value={scene} onChange={(e) => setScene(e.target.value)}>
            <option value="title">Title</option>
            <option value="statement">Statement</option>
            <option value="points">Points</option>
            <option value="stat">Stat</option>
            <option value="end">End card</option>
          </select>
        </div>
        <div className="field">
          <label className="label" htmlFor="si-format">
            Format
          </label>
          <select className="select" id="si-format" value={format} onChange={(e) => setFormat(e.target.value)}>
            <option value="16x9">16:9</option>
            <option value="9x16">9:16</option>
            <option value="1x1">1:1</option>
          </select>
        </div>
      </div>
      <div className="field">
        <label className="label" htmlFor="si-name">
          Name
        </label>
        <input className="input" id="si-name" maxLength={40} value={s.name} onChange={(e) => set("name", e.target.value)} />
      </div>
      <label className="switch-row" htmlFor="si-on">
        <input type="checkbox" role="switch" id="si-on" checked={s.enabled !== false} disabled={s.enabled !== false && enabledCount <= 1} onChange={(e) => set("enabled", e.target.checked)} />
        <span>In use</span>
      </label>
      <h3 className="insp-sub">Colours</h3>
      <div className="sw-stack">
        {PARTS.map((p) => (
          <ColourField key={p} schemeIndex={i} part={p} big />
        ))}
      </div>
      <fieldset className="field">
        <legend className="label">Key words</legend>
        <div className="seg" role="radiogroup" aria-label="Key words">
          {EMPHASIS.map((o) => (
            <label key={o.value} className="seg__opt">
              <input type="radio" name={`emph-${s.id}`} value={o.value} checked={(s.emphasis ?? "colour") === o.value} onChange={() => set("emphasis", o.value)} />
              <span>{o.label}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <h3 className="insp-sub" id="si-contrast">
        Contrast
      </h3>
      <Result label="Text" ratio={st.text} />
      {st.bold ? <p className="cr">Key words: bold, in the text colour</p> : <Result label="Key words" ratio={st.key} />}
      <p className={`cr ${iconShape >= 3 ? "cr--ok" : "cr--bad"}`}>
        {iconShape >= 3 ? <CheckCircle size={22} weight="fill" aria-hidden="true" /> : <WarningCircle size={22} weight="fill" aria-hidden="true" />}
        <span>{`Icon on shape: ${ratioText(iconShape)} (needs 3 to 1)`}</span>
      </p>
      {serverIssues.map((x, k) => (
        <p className="cr cr--warn" key={k}>
          <WarningCircle size={22} weight="fill" aria-hidden="true" />
          <span>{x.message}</span>
        </p>
      ))}
      {st.ok ? null : <p className="scard__off">Not used until fixed</p>}
      <Fixes schemeId={s.id} focusAfter="si-contrast" />
      <div className="field">
        <label className="label" htmlFor="si-fit">
          Where it's used
        </label>
        <select className="select" id="si-fit" value={s.fit ?? "any"} onChange={(e) => set("fit", e.target.value)}>
          {FIT.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label className="label" htmlFor="si-logo">
          Logo
        </label>
        <select className="select" id="si-logo" value={s.logo ?? "auto"} onChange={(e) => set("logo", e.target.value)}>
          {LOGO.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      <p className="hint">{`Tone: ${tone(s, draft.palette)} background.`}</p>
      <div className="buttons insp-actions">
        <Button variant="default" onClick={m.duplicate} leftSection={<Copy size={20} aria-hidden="true" />}>
          Duplicate
        </Button>
        <Button variant="default" className="quiet-danger" onClick={m.remove} disabled={draft.schemes.length <= 1} leftSection={<Trash size={20} aria-hidden="true" />}>
          Delete scheme
        </Button>
      </div>
    </div>
  );
}

/** The inspector with nothing selected: a preview of any scheme, and how videos use the schemes. */
export function ColoursDefaults() {
  const { draft, edit } = useEditor();
  const usable = draft.schemes.filter((s: any) => s.enabled !== false && schemeState(s, draft.palette).ok);
  const [pick, setPick] = useState<string>(usable[0]?.id ?? draft.schemes[0]?.id);
  const [scene, setScene] = useState("title");
  const s = draft.schemes.find((x: any) => x.id === pick) ?? draft.schemes[0];
  const use = draft.schemeUse ?? { mode: "spread" };
  const setUse = (patch: any) => edit((d) => (d.schemeUse = { ...(d.schemeUse ?? { mode: "spread" }), ...patch }));
  return (
    <div className="insp-body" id="live-preview">
      <h2 className="insp-h" id="insp-h" tabIndex={-1}>
        Preview
      </h2>
      {s ? <SchemePreview scheme={s} scene={scene} maxHeight={300} /> : null}
      <div>
        <div className="field">
          <label className="label" htmlFor="lp-scheme">
            Scheme
          </label>
          <select className="select" id="lp-scheme" value={s?.id} onChange={(e) => setPick(e.target.value)}>
            {draft.schemes.map((x: any) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label className="label" htmlFor="lp-scene">
            Scene
          </label>
          <select className="select" id="lp-scene" value={scene} onChange={(e) => setScene(e.target.value)}>
            <option value="title">Title</option>
            <option value="statement">Statement</option>
            <option value="points">Points</option>
            <option value="stat">Stat</option>
            <option value="end">End card</option>
          </select>
        </div>
      </div>
      <h3 className="insp-sub">In videos</h3>
      {use.mode === "by-type" ? (
        <>
          <p>Videos use one scheme per scene type, as before.</p>
          <div className="buttons">
            <Button variant="default" onClick={() => setUse({ mode: "spread" })}>
              Mix schemes
            </Button>
          </div>
        </>
      ) : (
        <fieldset className="field">
          <legend className="label">Videos use</legend>
          <label className="choice">
            <input type="radio" name="scheme-mode" checked={use.mode === "spread"} onChange={() => setUse({ mode: "spread", single: null })} />
            <span>Mix schemes</span>
          </label>
          <label className="choice">
            <input type="radio" name="scheme-mode" checked={use.mode === "single"} onChange={() => setUse({ mode: "single", single: usable[0]?.id ?? null })} />
            <span>One scheme</span>
          </label>
        </fieldset>
      )}
      {use.mode === "single" ? (
        <div className="field">
          <label className="label" htmlFor="su-single">
            The one scheme
          </label>
          <select className="select" id="su-single" value={use.single ?? ""} onChange={(e) => setUse({ single: e.target.value || null })}>
            {usable.map((x: any) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <div className="field">
          <label className="label" htmlFor="su-bookends">
            Open and close on
          </label>
          <select className="select" id="su-bookends" value={use.bookends ?? ""} onChange={(e) => setUse({ bookends: e.target.value || null })}>
            <option value="">Auto</option>
            {usable.map((x: any) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}

// ---------- captions and the table ----------

function Captions() {
  const { draft, edit } = useEditor();
  const options = expandPalette(draft.palette);
  const bg = resolveRef(draft.captions?.background ?? "", draft.palette) ?? "#0B0C0C";
  const fg = resolveRef(draft.captions?.text ?? "", draft.palette) ?? "#FFFFFF";
  const weights = [...new Set<number>((draft.fonts.faces ?? []).filter((f: any) => f.family === draft.fonts.body.family).map((f: any) => f.weight))].filter((w) => w >= 400 && w <= 800).sort();
  const sel = (k: "background" | "text", label: string) => (
    <div className="field">
      <label className="label" htmlFor={`cap-${k}`}>
        {label}
      </label>
      <select className="select" id={`cap-${k}`} value={draft.captions?.[k] ?? ""} onChange={(e) => edit((d) => (d.captions[k] = e.target.value))}>
        {options.map((o) => (
          <option key={o.ref} value={o.ref}>
            {`${o.name} ${o.value}`}
          </option>
        ))}
      </select>
    </div>
  );
  return (
    <div className="captions">
      <div className="cap-sample" style={{ background: bg, color: fg, fontWeight: draft.captions?.weight ?? 400 }} aria-hidden="true">
        From 1 March you can book online.
      </div>
      <Result label="Caption text" ratio={contrastRatio(fg, bg)} />
      <div className="two-up">
        {sel("background", "Caption box")}
        {sel("text", "Caption text")}
      </div>
      <div className="field">
        <label className="label" htmlFor="cap-weight">
          Caption weight
        </label>
        <select className="select" id="cap-weight" value={String(draft.captions?.weight ?? 400)} onChange={(e) => edit((d) => (d.captions.weight = Number(e.target.value)))}>
          {(weights.length ? weights : [400]).map((w) => (
            <option key={w} value={w}>
              {w}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

function ContrastTable() {
  const { draft } = useEditor();
  const rows = useMemo(() => {
    const out: Array<{ scheme: string; pair: string; ratio: number }> = [];
    for (const s of draft.schemes) {
      const st = schemeState(s, draft.palette);
      out.push({ scheme: s.name, pair: "Text", ratio: st.text });
      if (!st.bold) out.push({ scheme: s.name, pair: "Key words", ratio: st.key });
    }
    const bg = resolveRef(draft.captions?.background ?? "", draft.palette);
    const fg = resolveRef(draft.captions?.text ?? "", draft.palette);
    if (bg && fg) out.push({ scheme: "Captions", pair: "Text", ratio: contrastRatio(fg, bg) });
    return out;
  }, [draft.schemes, draft.palette, draft.captions]);
  return (
    <div className="table-wrap" id="contrast">
      <table className="ctable">
        <thead>
          <tr>
            <th scope="col">Scheme</th>
            <th scope="col">Pair</th>
            <th scope="col">Ratio</th>
            <th scope="col">Result</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, k) => (
            <tr key={k}>
              <td>{r.scheme}</td>
              <td>{r.pair}</td>
              <td className="num">{ratioText(r.ratio)}</td>
              <td>{r.ratio >= 7 ? "Passes AAA" : "Fails AAA"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export const swatchInk = inkOn;
export type { ReactNode };
