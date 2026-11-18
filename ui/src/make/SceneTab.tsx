// Inspector › Scene: the selected scene's words, highlights, spoken lines and icon. Edits are staged.
import { Plus, X } from "@phosphor-icons/react";
import { announce, plural } from "../shared/api";
import { Group } from "../shared/studio";
import { CharCount, countShown } from "../shared/ui";
import { phrase, slotLabel } from "./ScriptEditor";
import type { Meta } from "./types";
import type { useStaged } from "./useStaged";

const COUNT_WITHIN = 20;

type Staged = ReturnType<typeof useStaged>;

export function SceneTab({ index, spec, meta, staged, fieldErrors, icons }: { index: number; spec: any; meta: Meta; staged: Staged; fieldErrors: Record<string, string>; icons: string[] }) {
  const scene = spec.scenes[index];
  const sd = staged.state?.draft.scenes[index];
  if (!scene || !sd) return null;
  const def = meta.scenes.find((s) => s.type === scene.type);
  const si = index;
  const edit = (fn: (d: NonNullable<Staged["state"]>["draft"]) => void) => staged.update((s) => fn(s.draft));

  const input = (id: string, label: string, value: string, onChange: (v: string) => void, opts: { max?: number; hint?: string; list?: string; data?: Record<string, string>; describe?: string } = {}) => {
    const e = fieldErrors[id];
    const counted = opts.max ? countShown(value, opts.max, COUNT_WITHIN) : false;
    const described = [e ? `${id}-error` : "", opts.hint ? `${id}-hint` : "", counted ? `${id}-count` : "", opts.describe ?? ""].filter(Boolean).join(" ") || undefined;
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

  const words: React.ReactNode[] = [];
  for (const t of def?.text ?? []) {
    if (t.slot === "items" && Array.isArray(scene.slots.items)) {
      const items = scene.slots.items;
      const key = items[0] && "label" in items[0] ? "label" : "text";
      const max = items.length >= 4 && t.maxCharsWhenFull ? t.maxCharsWhenFull : t.maxChars;
      items.forEach((_: unknown, k: number) => {
        words.push(input(`s${si}-items-${k}`, `Point ${k + 1}`, sd.items[k] ?? "", (v) => edit((d) => void (d.scenes[si].items[k] = v)), { max, data: { "data-scene": String(si), "data-item": String(k), "data-key": key } }));
      });
      continue;
    }
    if (t.slot === "items" || (scene.slots[t.slot] != null && typeof scene.slots[t.slot] !== "string")) continue;
    const id = `s${si}-${t.slot}`;
    const required = (def?.required ?? []).includes(t.slot);
    words.push(input(id, `${slotLabel(t.slot)}${required ? "" : " (optional)"}`, sd.slots[t.slot] ?? "", (v) => edit((d) => void (d.scenes[si].slots[t.slot] = v)), { max: t.maxChars, data: { "data-scene": String(si), "data-slot": t.slot } }));
  }

  const mainText = [...(def?.text ?? []).map((t) => sd.slots[t.slot] ?? ""), ...sd.items].join(" ").toLowerCase();
  const highlights = sd.emphasis.split(",").map((x) => x.trim()).filter(Boolean);
  const missing = highlights.filter((h) => !mainText.includes(h.toLowerCase()));
  const hlError = fieldErrors[`s${si}-emphasis`] ?? (highlights.length > 3 ? "3 at most" : missing.length ? `Not in the main text: ${missing.join(", ")}` : undefined);
  const hasHighlights = "emphasis" in ((def?.sample as Record<string, unknown>) ?? {}) || scene.slots.emphasis;
  const hasIcon = scene.slots.icon || "icon" in ((def?.sample as Record<string, unknown>) ?? {});

  return (
    <form id="script-form" noValidate onSubmit={(e) => e.preventDefault()}>
      <Group title="Words" defaultOpen id={`scene-${si}-words`}>
        {words.length ? words : <p className="hint">This scene has no words on screen.</p>}
        {hasHighlights ? (
          <div className="field" data-error={hlError ? "true" : undefined}>
            <label className="label" htmlFor={`s${si}-emphasis`}>
              Highlights
            </label>
            <p className="hint" id={`s${si}-emphasis-hint`}>
              Up to 3, from the main text, with commas between.
            </p>
            {hlError ? (
              <p className="error-msg" id={`s${si}-emphasis-error`}>
                <span className="visually-hidden">Error: </span>
                {hlError}
              </p>
            ) : null}
            <input
              className="input"
              type="text"
              id={`s${si}-emphasis`}
              value={sd.emphasis}
              data-scene={si}
              data-emphasis="1"
              aria-invalid={hlError ? true : undefined}
              aria-describedby={[`s${si}-emphasis-hint`, hlError ? `s${si}-emphasis-error` : ""].filter(Boolean).join(" ")}
              onChange={(e) => edit((d) => void (d.scenes[si].emphasis = e.target.value))}
            />
          </div>
        ) : null}
      </Group>

      <Group title="Spoken lines" defaultOpen id={`scene-${si}-vo`}>
        <p className="hint">Captions match these words exactly.</p>
        {sd.vo.map((p, k) => {
          const id = `s${si}-vo-${p.k}`;
          const counted = countShown(p.text, 220, COUNT_WITHIN);
          const hasLink = /https?:\/\//i.test(p.text);
          const hasDate = /\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b/.test(p.text);
          return (
            <div className="field phrase" key={p.k}>
              <div className="phrase__head">
                <label className="label" htmlFor={id}>{`Line ${k + 1}`}</label>
                {sd.vo.length > 1 ? (
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => {
                      const nextKey = sd.vo[k + 1]?.k ?? sd.vo[k - 1]?.k;
                      edit((d) => void d.scenes[si].vo.splice(k, 1));
                      announce(`Line ${k + 1} removed.`);
                      requestAnimationFrame(() => document.getElementById(`s${si}-vo-${nextKey}`)?.focus());
                    }}
                  >
                    <X size={18} weight="bold" aria-hidden="true" />
                    Remove<span className="visually-hidden">{` line ${k + 1}`}</span>
                  </button>
                ) : null}
              </div>
              <textarea className="textarea short" id={id} rows={3} data-scene={si} data-vo="1" value={p.text} aria-describedby={counted ? `${id}-count` : undefined} onChange={(ev) => edit((d) => void (d.scenes[si].vo[k].text = ev.target.value))} />
              <CharCount id={`${id}-count`} value={p.text} max={220} within={COUNT_WITHIN} />
              {hasLink || hasDate ? (
                <div className="buttons">
                  {hasLink ? (
                    <button type="button" className="ghost-button fix-button" onClick={() => edit((d) => void (d.scenes[si].vo[k].text = d.scenes[si].vo[k].text.replace(/https?:\/\//gi, "")))}>
                      Remove https://
                    </button>
                  ) : null}
                  {hasDate ? <p className="hint">Write dates as 3 March.</p> : null}
                </div>
              ) : null}
            </div>
          );
        })}
        {sd.vo.length < 4 ? (
          <button
            type="button"
            className="ghost-button"
            id={`s${si}-add`}
            onClick={() => {
              const p = phrase("");
              edit((d) => void d.scenes[si].vo.push(p));
              requestAnimationFrame(() => document.getElementById(`s${si}-vo-${p.k}`)?.focus());
            }}
          >
            <Plus size={18} weight="bold" aria-hidden="true" />
            Add line
          </button>
        ) : null}
      </Group>

      {hasIcon ? (
        <Group title="Icon" id={`scene-${si}-icon`} meta={sd.icon || "None"}>
          <datalist id="icon-names">
            {icons.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
          {input(`s${si}-icon`, "Icon", sd.icon, (v) => edit((d) => void (d.scenes[si].icon = v)), { hint: "Such as calendar or recycle. Empty for none.", list: "icon-names", data: { "data-scene": String(si), "data-icon": "1" } })}
        </Group>
      ) : null}
      {Object.keys(fieldErrors).some((k) => k.startsWith(`s${si}-`)) ? <p className="visually-hidden">{plural(Object.keys(fieldErrors).filter((k) => k.startsWith(`s${si}-`)).length, "problem")}</p> : null}
    </form>
  );
}
