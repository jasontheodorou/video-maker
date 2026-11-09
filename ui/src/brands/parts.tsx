// Small parts the brand editor's sections share: the collapsible section card, bound fields, file
// pickers, upload reports and the in-page delete question.
import { CaretDown, UploadSimple } from "@phosphor-icons/react";
import { motion } from "framer-motion";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { getPath } from "../shared/api";
import { Collapse, spring } from "../shared/motion";
import { CharCount, Field, InlineConfirm, Message, Tag, describedBy } from "../shared/ui";
import { plural, useEditor } from "./context";

export const icon = (I: React.ComponentType<{ size?: number; weight?: "light" | "regular"; "aria-hidden"?: boolean | "true" }>, size = 22) => <I size={size} weight="regular" aria-hidden="true" />;

// ---------- the section card ----------

/**
 * One part of the brand. The header is a real button inside the h2 (GOV.UK accordion pattern), showing
 * the title, a short summary of what is set, and a problem count. The body opens and closes smoothly and
 * stays mounted, so typed values and chosen files survive closing it.
 */
export function EditorSection({ id, title, sectionIcon, summary, problems = 0, children }: { id: string; title: string; sectionIcon: ReactNode; summary?: ReactNode; problems?: number; children: ReactNode }) {
  const { isOpen, setOpen } = useEditor();
  const open = isOpen(id);
  return (
    <section className="ed-sec" id={id} aria-labelledby={`${id}-h`} data-open={open || undefined}>
      <h2 className="ed-sec__h" id={`${id}-h`} tabIndex={-1}>
        <button type="button" className="ed-sec__toggle" aria-expanded={open} aria-controls={`${id}-body`} onClick={() => setOpen(id, !open)}>
          <span className="ed-sec__icon" aria-hidden="true">
            {sectionIcon}
          </span>
          <span className="ed-sec__text">
            <span className="ed-sec__title">{title}</span>
            {summary ? <span className="ed-sec__summary">{summary}</span> : null}
          </span>
          {problems ? (
            <Tag tone="bad" className="ed-sec__tag">
              {plural(problems, "problem")}
            </Tag>
          ) : null}
          <motion.span className="ed-sec__chevron" animate={{ rotate: open ? 180 : 0 }} transition={spring.snappy} aria-hidden="true">
            <CaretDown size={20} weight="bold" />
          </motion.span>
        </button>
      </h2>
      <Collapse open={open} id={`${id}-body`} keepMounted>
        <div className="ed-sec__body">{children}</div>
      </Collapse>
    </section>
  );
}

/** A small heading inside a section. */
export function SubHead({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <h3 className="h4 sub-h" id={id} tabIndex={id ? -1 : undefined}>
      {children}
    </h3>
  );
}

// ---------- reports ----------

/** A status or report that takes focus when it appears, so it is read out after an action rebuilt the controls. */
export function Report({ tone = "info", children, role = "status" }: { tone?: "info" | "ok" | "bad" | "warn"; children: ReactNode; role?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
  }, []);
  return (
    <div className="report rise">
      <Message tone={tone} role={role} focusRef={ref}>
        {children}
      </Message>
    </div>
  );
}

export type UploadResult = { name: string; warnings: string[]; error?: string };

export function UploadReport({ results }: { results: UploadResult[] }) {
  const failed = results.some((r) => r.error);
  return (
    <Report tone={failed ? "warn" : "ok"}>
      <ul className="plain-list report__list">
        {results.flatMap((r, i) =>
          r.error
            ? [
                <li key={`${i}e`} className="bad-text">
                  {`${r.name}: ${r.error}`}
                </li>,
              ]
            : [<li key={`${i}a`}>{`${r.name} added and saved.`}</li>, ...r.warnings.map((w, k) => <li key={`${i}w${k}`}>{`${r.name}: ${w}`}</li>)],
        )}
      </ul>
    </Report>
  );
}

export function InlineError({ text }: { text: string | null | undefined }) {
  if (!text) return null;
  return (
    <p className="error-msg" role="alert">
      <span className="visually-hidden">Error: </span>
      {text}
    </p>
  );
}

// ---------- bound fields ----------

const fieldId = (path: string) => `f-${path.replace(/\./g, "-")}`;

/** A text box or text area bound to a path in the draft. */
export function BoundText({ path, label, hint, multiline, rows, max, maxLength }: { path: string; label: string; hint?: string; multiline?: boolean; rows?: number; max?: number; maxLength?: number }) {
  const { draft, setValue } = useEditor();
  const id = fieldId(path);
  const value = (getPath(draft, path) ?? "") as string;
  const describe = describedBy(id, { hint, extra: max ? [`${id}-count`] : [] });
  return (
    <Field id={id} label={label} hint={hint} extra={max ? <CharCount id={`${id}-count`} value={value} max={max} /> : undefined}>
      {multiline ? (
        <textarea className="textarea" id={id} rows={rows ?? 4} value={value} maxLength={maxLength} onChange={(e) => setValue(path, e.target.value)} aria-describedby={describe} />
      ) : (
        <input className="input" type="text" id={id} value={value} maxLength={maxLength} onChange={(e) => setValue(path, e.target.value)} aria-describedby={describe} />
      )}
    </Field>
  );
}

/** A number box bound to a path. It keeps what you type until it is a number, so "1." can become "1.2". */
export function BoundNumber({ path, label, min, max, step = 1, hint }: { path: string; label: string; min: number; max: number; step?: number; hint?: string }) {
  const { draft, setValue, revision } = useEditor();
  const id = fieldId(path);
  const current = getPath(draft, path);
  const [text, setText] = useState(current == null ? "" : String(current));
  useEffect(() => {
    if (text === "" ? current != null : Number(text) !== current) setText(current == null ? "" : String(current));
  }, [current, revision]); // eslint-disable-line react-hooks/exhaustive-deps
  const h = hint ?? `${min} to ${max}`;
  return (
    <Field id={id} label={label} hint={h} className="field--number">
      <input
        className="input input--number"
        type="number"
        id={id}
        min={min}
        max={max}
        step={step}
        inputMode="decimal"
        value={text}
        aria-describedby={`${id}-hint`}
        onChange={(e) => {
          setText(e.target.value);
          setValue(path, e.target.value === "" ? undefined : Number(e.target.value));
        }}
      />
    </Field>
  );
}

/** A drop-down list bound to a path. */
export function BoundSelect({ path, id, label, options, toValue, hint }: { path: string; id: string; label: string; options: Array<{ value: string; label: string }>; toValue?: (v: string) => unknown; hint?: string }) {
  const { draft, setValue } = useEditor();
  const cur = getPath(draft, path);
  const missing = cur != null && !options.some((o) => o.value === String(cur));
  return (
    <Field id={id} label={label} hint={hint}>
      <select className="select" id={id} value={cur == null ? "" : String(cur)} aria-describedby={hint ? `${id}-hint` : undefined} onChange={(e) => setValue(path, toValue ? toValue(e.target.value) : e.target.value)}>
        {missing || cur == null ? <option value={cur == null ? "" : String(cur)}>{`${cur ?? "None"} (missing)`}</option> : null}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

// ---------- files ----------

/**
 * A file picker drawn as a soft drop area. It is the browser's own file input, so dropping files onto
 * it, keyboard use and screen readers all work, and it shows the chosen file names itself.
 */
export function FilePicker({ id, label, hint, accept, multiple, inputRef, onPick }: { id: string; label: string; hint?: string; accept: string; multiple?: boolean; inputRef: React.RefObject<HTMLInputElement | null>; onPick?: (count: number) => void }) {
  const [over, setOver] = useState(false);
  return (
    <div className="field">
      <label className="label" htmlFor={id}>
        {label}
      </label>
      {hint ? (
        <p className="hint" id={`${id}-hint`}>
          {hint}
        </p>
      ) : null}
      <div className={`drop${over ? " drop--over" : ""}`} onDragEnter={() => setOver(true)} onDragLeave={() => setOver(false)} onDrop={() => setOver(false)}>
        <span className="drop__icon" aria-hidden="true">
          <UploadSimple size={24} weight="regular" />
        </span>
        <input ref={inputRef} className="file drop__input" type="file" id={id} accept={accept} multiple={multiple} aria-describedby={hint ? `${id}-hint` : undefined} onChange={(e) => onPick?.(e.target.files?.length ?? 0)} />
      </div>
    </div>
  );
}

/** Delete a brand file, after asking in the page. */
export function DeleteFile({ rel, word, hidden }: { rel: string; word: string; hidden: string }) {
  const { deleteFile } = useEditor();
  return (
    <InlineConfirm
      linkStyle
      trigger={
        <>
          {word}
          <span className="visually-hidden">{hidden}</span>
        </>
      }
      question={`Delete ${rel.split("/").pop()}?`}
      detail={["It is removed from the brand straight away."]}
      yes="Yes, delete the file"
      onYes={() => deleteFile(rel)}
    />
  );
}
