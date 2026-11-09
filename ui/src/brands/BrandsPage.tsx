// Brands page, one column: the list of brands as one bordered list of rows (each row opens the editor;
// duplicate and delete sit in a small More menu and are asked in the row, not in dialogs), the new-brand
// form, and the brand editor.
import { Button, Menu } from "@mantine/core";
import { ArrowRight, CaretDown, CaretRight, Copy, Plus, Trash } from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, plural } from "../shared/api";
import { AnimatedItem, AnimatedList, Collapse, Reveal } from "../shared/motion";
import { ErrorSummary, Field, Message, PageHeader, Shell, SkeletonBlock, SkeletonLines, Tag, describedBy, type SummaryItem } from "../shared/ui";
import type { BrandSummary, Meta } from "../make/types";
import { BrandEditor, DELETE_DETAIL } from "./BrandEditor";

type View = { kind: "loading" } | { kind: "list"; message?: string; error?: string } | { kind: "editor"; id: string; notes?: string[] };

export function BrandsPage() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [brands, setBrands] = useState<BrandSummary[]>([]);
  const [view, setView] = useState<View>({ kind: "loading" });
  const [loadError, setLoadError] = useState<string | null>(null);

  const showList = useCallback(async (message?: string, error?: string) => {
    document.title = "Brands - Video maker";
    window.history.replaceState(null, "", "/brands");
    try {
      setBrands(await api<BrandSummary[]>("GET", "/api/brands"));
    } catch {
      /* keep the old list */
    }
    setView({ kind: "list", message, error });
    window.scrollTo({ top: 0 });
  }, []);

  const openEditor = useCallback((id: string, notes?: string[]) => {
    setView({ kind: "editor", id, notes });
    window.scrollTo({ top: 0 });
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const [m, b] = await Promise.all([api<Meta>("GET", "/api/meta"), api<BrandSummary[]>("GET", "/api/brands")]);
        setMeta(m);
        setBrands(b);
      } catch (e) {
        setLoadError((e as Error).message);
        return;
      }
      const id = new URLSearchParams(location.search).get("brand");
      if (id) openEditor(id);
      else setView({ kind: "list" });
    })();
  }, [openEditor]);

  /** Delete a brand (the question has already been asked in the page). Returns an error message if it fails. */
  async function removeBrand(b: { id: string; name: string }): Promise<string | void> {
    try {
      await api("DELETE", `/api/brands/${encodeURIComponent(b.id)}`, { confirm: b.id });
    } catch (e) {
      return (e as Error).message;
    }
    await showList(`${b.name} has been deleted.`);
  }

  return (
    <Shell current="brands">
      {loadError ? (
        <div className="page-head">
          <ErrorSummary items={[loadError]} />
        </div>
      ) : view.kind === "loading" ? (
        // No heading until the list is ready: the page title and the brands arrive together.
        <div className="page-head">
          <SkeletonLines lines={1} height={44} label="Loading brands" />
          <div className="brands-section">
            <SkeletonBlock height={232} label="" />
          </div>
        </div>
      ) : view.kind === "list" ? (
        <BrandList key={`${view.message ?? ""}${view.error ?? ""}`} brands={brands} message={view.message} error={view.error} onOpen={openEditor} onRemove={removeBrand} />
      ) : meta ? (
        <Reveal key={view.id} y={8}>
          <BrandEditor id={view.id} notes={view.notes} meta={meta} onBack={() => showList()} onLoadError={(msg) => showList(undefined, msg)} removeBrand={removeBrand} />
        </Reveal>
      ) : null}
    </Shell>
  );
}

// ---------- list ----------

function BrandList({ brands, message, error, onOpen, onRemove }: { brands: BrandSummary[]; message?: string; error?: string; onOpen: (id: string, notes?: string[]) => void; onRemove: (b: BrandSummary) => Promise<string | void> }) {
  const [name, setName] = useState("");
  const [from, setFrom] = useState("blank");
  const [nameError, setNameError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<{ items: SummaryItem[]; key: number }>({ items: error ? [error] : [], key: 0 });
  const messageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.title = "Brands - Video maker";
    if (message) messageRef.current?.focus();
  }, [message]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!name.trim()) {
      setNameError("Enter a name for the brand");
      setSummary((s) => ({ items: [{ text: "Enter a name for the brand", target: "new-name" }], key: s.key + 1 }));
      return;
    }
    setNameError(null);
    setBusy(true);
    try {
      const r = await api<{ id: string; notes?: string[] }>("POST", "/api/brands", { name: name.trim(), from });
      onOpen(r.id, r.notes);
    } catch (err) {
      setSummary((s) => ({ items: [(err as Error).message], key: s.key + 1 }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="Brands" lede="Colours, fonts, logo and voice for every video." />
      {message ? (
        <Reveal className="list-message">
          <Message tone="ok" role="status" focusRef={messageRef}>
            <p>{message}</p>
          </Message>
        </Reveal>
      ) : null}
      <div id="list-errors" className="list-errors">
        <ErrorSummary items={summary.items} focusKey={summary.key} />
      </div>

      <section className="brands-section" aria-labelledby="your-brands">
        <h2 className="visually-hidden" id="your-brands">
          Your brands
        </h2>
        <AnimatedList className="brand-rows plain-list">
          {brands.map((b, i) => (
            <BrandRow key={b.id} b={b} index={i} onOpen={onOpen} onRemove={onRemove} />
          ))}
        </AnimatedList>
      </section>

      <section className="brands-section add-brand" aria-labelledby="add-brand">
        <h2 className="h3" id="add-brand">
          New brand
        </h2>
        <form noValidate onSubmit={create} className="add-brand__form card">
          <Field id="new-name" label="Name of the organisation or brand" hint="For example, Riverside District Council." error={nameError}>
            <input className="input" type="text" id="new-name" maxLength={80} autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} aria-invalid={nameError ? true : undefined} aria-describedby={describedBy("new-name", { hint: 1, error: nameError })} />
          </Field>
          <Field id="new-from" label="Base it on" hint="Fonts and settings only.">
            <select className="select" id="new-from" value={from} onChange={(e) => setFrom(e.target.value)} aria-describedby="new-from-hint">
              <option value="blank">Nothing, start blank</option>
              {brands.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </Field>
          <div className="buttons buttons-gap">
            <Button type="submit" aria-disabled={busy || undefined} leftSection={<Plus size={22} weight="bold" aria-hidden="true" />}>
              {busy ? "Creating..." : "Create brand"}
            </Button>
          </div>
        </form>
      </section>
    </>
  );
}

/**
 * One brand as a row. The name is the link (its hit area covers the whole row, like Your videos on the
 * Make page). Duplicate and Delete live in a labelled More menu; choosing one opens its question under
 * the row, and Cancel puts focus back on More.
 */
function BrandRow({ b, index, onOpen, onRemove }: { b: BrandSummary; index: number; onOpen: (id: string, notes?: string[]) => void; onRemove: (b: BrandSummary) => Promise<string | void> }) {
  const [mode, setMode] = useState<null | "dup" | "delete">(null);
  const [dupName, setDupName] = useState(`${b.name} copy`);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const dupInput = useRef<HTMLInputElement>(null);
  const yesRef = useRef<HTMLButtonElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);
  const id = `dup-${b.id}`;

  useEffect(() => {
    // After the menu has closed, so it cannot take focus back.
    const t = requestAnimationFrame(() => {
      if (mode === "dup") {
        dupInput.current?.focus();
        dupInput.current?.select();
      } else if (mode === "delete") yesRef.current?.focus();
      else if (returnFocus.current) {
        returnFocus.current = false;
        moreRef.current?.focus();
      }
    });
    return () => cancelAnimationFrame(t);
  }, [mode]);

  function close() {
    returnFocus.current = true;
    setError(null);
    setMode(null);
  }

  async function makeCopy(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!dupName.trim()) return setError("Enter a name for the copy");
    setBusy(true);
    try {
      const r = await api<{ id: string }>("POST", "/api/brands", { duplicate: true, from: b.id, name: dupName.trim() });
      onOpen(r.id);
    } catch (er) {
      setError((er as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const err = await onRemove(b);
      if (err) setError(err);
    } finally {
      setBusy(false);
    }
  }

  const href = `/brands?brand=${encodeURIComponent(b.id)}`;
  const nProblems = b.errors?.length ?? 0;
  return (
    <AnimatedItem className={`brand-row${mode ? " brand-row--open" : ""}`} style={{ ["--i" as string]: index }}>
      <div className="brand-row__line">
        <span className="brand-row__logo" aria-hidden="true">
          {b.logo ? <img src={b.logo} alt="" /> : <span className="brand-row__initial" style={{ background: b.primary ?? "var(--ink)" }} />}
        </span>
        <div className="brand-row__main">
          <h3 className="brand-row__name">
            <a
              className="brand-row__link"
              href={href}
              onClick={(e) => {
                e.preventDefault();
                onOpen(b.id);
              }}
            >
              {b.name}
            </a>
          </h3>
          <p className="brand-row__tags">
            {b.ok ? <Tag tone="good">Ready</Tag> : <Tag tone="bad">{nProblems ? plural(nProblems, "problem") : "Has problems"}</Tag>}
            {b.fictional ? (
              <Tag tone="" plain>
                Sample
              </Tag>
            ) : null}
          </p>
        </div>
        {mode ? null : (
          <Menu position="bottom-end" offset={6} radius="md" shadow="md" returnFocus={false} transitionProps={{ transition: "pop-top-right", duration: 150 }}>
            <Menu.Target>
              <Button ref={moreRef} variant="subtle" className="small brand-row__more" rightSection={<CaretDown size={16} weight="bold" aria-hidden="true" />}>
                More<span className="visually-hidden">{` for ${b.name}`}</span>
              </Button>
            </Menu.Target>
            <Menu.Dropdown className="brand-menu">
              <Menu.Item leftSection={<Copy size={20} aria-hidden="true" />} onClick={() => setMode("dup")}>
                Duplicate
              </Menu.Item>
              {b.protected ? null : (
                <Menu.Item className="brand-menu__danger" leftSection={<Trash size={20} aria-hidden="true" />} onClick={() => setMode("delete")}>
                  Delete
                </Menu.Item>
              )}
            </Menu.Dropdown>
          </Menu>
        )}
        <span className="brand-row__chevron" aria-hidden="true">
          <CaretRight size={20} weight="bold" />
        </span>
      </div>
      <Collapse open={mode === "dup"}>
        <form className="brand-row__panel" noValidate onSubmit={makeCopy}>
          <Field id={id} label="Name for the copy" hint="Exact copy, including logo and colours." error={error}>
            <input ref={dupInput} className="input" type="text" id={id} maxLength={80} value={dupName} onChange={(e) => setDupName(e.target.value)} aria-invalid={error ? true : undefined} aria-describedby={describedBy(id, { hint: 1, error })} />
          </Field>
          <div className="buttons buttons-gap-sm">
            <Button type="submit" variant="default" aria-disabled={busy || undefined} rightSection={<ArrowRight size={20} weight="bold" aria-hidden="true" />}>
              {busy ? "Copying..." : "Duplicate"}
            </Button>
            <Button variant="subtle" onClick={close}>
              Cancel
            </Button>
          </div>
        </form>
      </Collapse>
      <Collapse open={mode === "delete"}>
        <div className="brand-row__panel confirm" role="group" aria-labelledby={`del-${b.id}`}>
          <Message tone="warn">
            <h4 id={`del-${b.id}`}>{`Delete ${b.name}?`}</h4>
            {DELETE_DETAIL.map((d, i) => (
              <p key={i}>{d}</p>
            ))}
            {error ? (
              <p className="error-msg" role="alert">
                <span className="visually-hidden">Error: </span>
                {error}
              </p>
            ) : null}
            <div className="buttons">
              <Button ref={yesRef} className="danger" color="red" aria-disabled={busy || undefined} onClick={remove}>
                Yes, delete this brand
              </Button>
              <Button variant="default" onClick={close}>
                Cancel
              </Button>
            </div>
          </Message>
        </div>
      </Collapse>
    </AnimatedItem>
  );
}
