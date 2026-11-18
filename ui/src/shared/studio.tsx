// The studio shell: top bar with workspace tabs, then Bin (left), Monitor (centre), Strip (bottom),
// Inspector (right) and Status bar. Every workspace (Make, Videos, Brands) renders one <AppShell>.
// Read DESIGN.md first. This API is shared with the brands workspace: keep it stable.
//
//   <AppShell
//     workspace="brands"                       // which top tab is current
//     bin={{ label: "Brand areas", content }}  // or omit for no bin
//     monitor={content}                        // required: the main area (<main>)
//     strip={content}                          // optional, Make only
//     inspector={{ label: "Inspector", content }}
//     status={content}                         // optional one-line status bar (role=status)
//   />
//
// Inside regions use <Panel>, <InspectorTabs>, <Group> and <Toolbar>. Shortcuts: useShortcuts().
import { MantineProvider, Modal } from "@mantine/core";
import { CaretRight, FilmSlate, Keyboard, SidebarSimple } from "@phosphor-icons/react";
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { MotionRoot } from "./motion";
import { Link, type Workspace } from "./router";
import { theme } from "./theme";
import { Toaster } from "./ui";

const TABS: Array<{ key: Workspace; to: string; label: string }> = [
  { key: "make", to: "/make", label: "Make" },
  { key: "videos", to: "/videos", label: "Videos" },
  { key: "brands", to: "/brands", label: "Brands" },
  { key: "settings", to: "/settings", label: "Settings" },
];

// ─── Storage (wrapped: the layout works without it) ──────────────────────

function readStore<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function writeStore(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* no storage */
  }
}

// ─── Shortcuts ───────────────────────────────────────────────────────────

const keysOffListeners = new Set<() => void>();
let keysOff = readStore<boolean>("va-keys-off", false);
export function singleKeysOn() {
  return !keysOff;
}
function setKeysOff(v: boolean) {
  keysOff = v;
  writeStore("va-keys-off", v);
  keysOffListeners.forEach((l) => l());
}

const inTextField = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || /^(TEXTAREA|SELECT)$/.test(t.tagName) || (t instanceof HTMLInputElement && !/^(checkbox|radio|button|submit|reset|range|color|file)$/.test(t.type)));

/**
 * Keyboard shortcuts for a view. Keys are like "n", "?", "1", ",", "mod+enter", "mod+s", "escape".
 * Single keys fire only outside text fields, and not when switched off in the Keys sheet.
 * A handler may return false to let the key through.
 */
export function useShortcuts(map: Record<string, (e: KeyboardEvent) => boolean | void>) {
  const ref = useRef(map);
  ref.current = map;
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      const name = mod ? `mod+${key}` : e.shiftKey && key === "z" ? "shift+z" : key;
      const fn = ref.current[name];
      if (!fn) return;
      if (!mod && name !== "escape") {
        if (e.altKey || inTextField(e.target) || keysOff) return;
        // Space and Enter keep their own job on buttons, links and choices.
        if ((name === " " || name === "enter") && e.target instanceof HTMLElement && e.target.closest("button, a, input, [role=option], [role=tab], label")) return;
        if (document.querySelector(".mantine-Modal-content")) return;
      }
      if (fn(e) !== false) e.preventDefault();
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);
}

const KEY_LIST: Array<[string, string]> = [
  ["?", "Show these keys"],
  ["N", "New video"],
  ["Ctrl or Cmd + Enter", "Make video, or Remake"],
  ["Ctrl or Cmd + S", "Save brand"],
  ["Space or K", "Play or pause"],
  ["1, 2, 3", "Landscape, portrait, square"],
  [", and .", "Previous or next scene"],
  ["J and L", "Back or forward 5 seconds"],
  ["Esc", "Close or cancel"],
  ["F6", "Next region"],
  ["[ and ]", "Hide or show the list or inspector"],
  ["\\", "Hide or show the scenes"],
];

function ShortcutsSheet({ opened, onClose }: { opened: boolean; onClose: () => void }) {
  const [off, setOff] = useState(keysOff);
  useEffect(() => {
    const l = () => setOff(keysOff);
    keysOffListeners.add(l);
    return () => void keysOffListeners.delete(l);
  }, []);
  return (
    <Modal opened={opened} onClose={onClose} title="Keys" size="lg" padding={24}>
      <table className="keys-table">
        <caption className="visually-hidden">Keyboard shortcuts</caption>
        <thead>
          <tr>
            <th scope="col">Keys</th>
            <th scope="col">Does</th>
          </tr>
        </thead>
        <tbody>
          {KEY_LIST.map(([k, d]) => (
            <tr key={k}>
              <td>
                <kbd>{k}</kbd>
              </td>
              <td>{d}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <label className="choice keys-off" htmlFor="keys-off">
        <input type="checkbox" id="keys-off" checked={off} onChange={(e) => setKeysOff(e.target.checked)} />
        <span>Turn off single-key shortcuts</span>
      </label>
    </Modal>
  );
}

// ─── Panels state ────────────────────────────────────────────────────────

type PanelsState = { bin: boolean; inspector: boolean; strip: boolean };
const PanelsContext = createContext<{ panels: PanelsState; toggle: (k: keyof PanelsState) => void }>({ panels: { bin: true, inspector: true, strip: true }, toggle: () => {} });
/** Which regions are shown, and a way to hide or show one ("bin", "inspector", "strip"). */
export const usePanels = () => useContext(PanelsContext);

// ─── The shell ───────────────────────────────────────────────────────────

export interface AppShellProps {
  workspace: Workspace;
  /** The list on the left. Omit for no bin. */
  bin?: { label: string; content: ReactNode } | null;
  /** The main area. Rendered as <main id="main">. */
  monitor: ReactNode;
  /** The scene strip under the monitor (Make only). */
  strip?: ReactNode | null;
  /** The right-hand panel. */
  inspector?: { label?: string; content: ReactNode } | null;
  /** One line at the foot (role=status, the page's live region). */
  status?: ReactNode | null;
  /** Extra things after the shell (dialogs). */
  modals?: ReactNode;
}

/** Providers plus the frame. Use once per workspace view. */
export function AppShell(props: AppShellProps) {
  return (
    <MantineProvider theme={theme}>
      <MotionRoot>
        <ShellFrame {...props} />
        <Toaster />
      </MotionRoot>
    </MantineProvider>
  );
}

function ShellFrame({ workspace, bin, monitor, strip, inspector, status, modals }: AppShellProps) {
  const [panels, setPanels] = useState<PanelsState>(() => ({ bin: true, inspector: true, strip: true, ...readStore<Partial<PanelsState>>("va-panels", {}) }));
  const [keysOpen, setKeysOpen] = useState(false);
  const toggle = useCallback((k: keyof PanelsState) => {
    setPanels((p) => {
      const n = { ...p, [k]: !p[k] };
      writeStore("va-panels", n);
      return n;
    });
  }, []);

  useShortcuts({
    "?": () => setKeysOpen(true),
    "[": () => (bin ? toggle("bin") : false),
    "]": () => (inspector ? toggle("inspector") : false),
    "\\": () => (strip ? toggle("strip") : false),
    f6: (e) => {
      const regions = [...document.querySelectorAll<HTMLElement>("[data-region]")].filter((r) => r.offsetParent !== null);
      if (!regions.length) return;
      const at = regions.findIndex((r) => r.contains(document.activeElement));
      const next = regions[(at + (e.shiftKey ? -1 : 1) + regions.length) % regions.length];
      next.focus();
    },
  });

  const showBin = Boolean(bin) && panels.bin;
  const showInspector = Boolean(inspector) && panels.inspector;
  const showStrip = Boolean(strip) && panels.strip;

  return (
    <PanelsContext.Provider value={{ panels, toggle }}>
      <div className="studio" data-bin={showBin || undefined} data-inspector={showInspector || undefined} data-strip={showStrip || undefined} data-status={status ? true : undefined}>
        <a className="skip-link" href="#main">
          Skip to main content
        </a>
        {inspector ? (
          <a className="skip-link" href="#inspector">
            Skip to inspector
          </a>
        ) : null}
        <TopBar workspace={workspace} onKeys={() => setKeysOpen(true)} />
        <div className="studio__row">
        {bin && showBin ? (
          <aside className="region region--bin" aria-label={bin.label} data-region tabIndex={-1}>
            {bin.content}
          </aside>
        ) : null}
        <main id="main" className="region region--monitor" data-region tabIndex={-1}>
          {monitor}
        </main>
        {inspector && showInspector ? (
          <aside id="inspector" className="region region--inspector" aria-label={inspector.label ?? "Inspector"} data-region tabIndex={-1}>
            {inspector.content}
          </aside>
        ) : null}
        </div>
        {strip && showStrip ? (
          <section className="region region--strip" aria-label="Scenes" data-region tabIndex={-1}>
            {strip}
          </section>
        ) : null}
        {status ? (
          <footer className="region region--status" role="status">
            {status}
          </footer>
        ) : null}
      </div>
      <ShortcutsSheet opened={keysOpen} onClose={() => setKeysOpen(false)} />
      {modals}
    </PanelsContext.Provider>
  );
}

/** Top bar: wordmark, workspace tabs, Keys. */
export function TopBar({ workspace, onKeys }: { workspace: Workspace; onKeys?: () => void }) {
  return (
    <header className="topbar">
      <Link to="/make" className="wordmark" aria-label="Video maker, new video">
        <FilmSlate size={26} weight="regular" aria-hidden="true" />
        <span className="wordmark__text">Video maker</span>
        <span className="dot" aria-hidden="true" />
      </Link>
      <nav className="tabs-nav" aria-label="Main">
        <ul>
          {TABS.map((t) => (
            <li key={t.key}>
              <Link to={t.to} aria-current={workspace === t.key ? "page" : undefined}>
                {t.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      {onKeys ? (
        <button type="button" className="topbar__keys" onClick={onKeys} aria-keyshortcuts="?">
          <Keyboard size={22} weight="regular" aria-hidden="true" />
          Keys
        </button>
      ) : null}
    </header>
  );
}

// ─── Region parts ────────────────────────────────────────────────────────

/** A panel: a header with a title and actions, then a body that scrolls on its own. */
export function Panel({ title, titleId, actions, children, footer, level = 2, className = "" }: { title?: ReactNode; titleId?: string; actions?: ReactNode; children: ReactNode; footer?: ReactNode; level?: 1 | 2; className?: string }) {
  const H = level === 1 ? "h1" : "h2";
  return (
    <div className={`panel-box ${className}`}>
      {title || actions ? (
        <div className="panel-box__head">
          {title ? (
            <H className="panel-box__title" id={titleId} tabIndex={titleId ? -1 : undefined}>
              {title}
            </H>
          ) : null}
          {actions ? <div className="panel-box__actions">{actions}</div> : null}
        </div>
      ) : null}
      <div className="panel-box__body">{children}</div>
      {footer ? <div className="panel-box__foot">{footer}</div> : null}
    </div>
  );
}

/** A button that hides a region ("Hide list"). */
export function HidePanelButton({ which, label }: { which: "bin" | "inspector" | "strip"; label: string }) {
  const { toggle } = usePanels();
  const key = which === "bin" ? "[" : which === "inspector" ? "]" : "\\";
  return (
    <button type="button" className="ghost-button" onClick={() => toggle(which)} aria-keyshortcuts={key}>
      <SidebarSimple size={20} weight="regular" aria-hidden="true" />
      {label}
    </button>
  );
}

/** Buttons to bring back hidden regions. Put it in the monitor toolbar. */
export function ShowPanelButtons({ bin, inspector, strip }: { bin?: string; inspector?: string; strip?: string }) {
  const { panels, toggle } = usePanels();
  return (
    <>
      {bin && !panels.bin ? (
        <button type="button" className="ghost-button" onClick={() => toggle("bin")} aria-keyshortcuts="[">
          {bin}
        </button>
      ) : null}
      {strip && !panels.strip ? (
        <button type="button" className="ghost-button" onClick={() => toggle("strip")} aria-keyshortcuts="\">
          {strip}
        </button>
      ) : null}
      {inspector && !panels.inspector ? (
        <button type="button" className="ghost-button" onClick={() => toggle("inspector")} aria-keyshortcuts="]">
          {inspector}
        </button>
      ) : null}
    </>
  );
}

/** A 48px toolbar at the top of the monitor. */
export function Toolbar({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`toolbar ${className}`}>{children}</div>;
}

export interface InspectorTab {
  id: string;
  label: string;
  /** A count or short word after the label ("2"). */
  badge?: string | number | null;
  content: ReactNode;
}

/** WAI-ARIA tabs with manual activation: arrows move focus, Enter or Space opens. One tab's content at a time. */
export function InspectorTabs({ tabs, value, onChange, label = "Inspector" }: { tabs: InspectorTab[]; value: string; onChange: (id: string) => void; label?: string }) {
  const base = useId().replace(/:/g, "");
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const current = tabs.find((t) => t.id === value) ?? tabs[0];
  function onKey(e: React.KeyboardEvent, i: number) {
    let n = -1;
    if (e.key === "ArrowRight") n = (i + 1) % tabs.length;
    else if (e.key === "ArrowLeft") n = (i - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") n = 0;
    else if (e.key === "End") n = tabs.length - 1;
    if (n < 0) return;
    e.preventDefault();
    refs.current[tabs[n].id]?.focus();
  }
  return (
    <div className="itabs">
      <div className="itabs__list" role="tablist" aria-label={label}>
        {tabs.map((t, i) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`${base}-tab-${t.id}`}
            data-tab={t.id}
            ref={(n) => void (refs.current[t.id] = n)}
            aria-selected={t.id === current?.id}
            aria-controls={`${base}-panel`}
            tabIndex={t.id === current?.id ? 0 : -1}
            onClick={() => onChange(t.id)}
            onKeyDown={(e) => onKey(e, i)}
          >
            {t.label}
            {t.badge != null && t.badge !== "" ? <span className="itabs__badge">{t.badge}</span> : null}
          </button>
        ))}
      </div>
      <div className="itabs__panel" role="tabpanel" id={`${base}-panel`} aria-labelledby={current ? `${base}-tab-${current.id}` : undefined}>
        {current?.content}
      </div>
    </div>
  );
}

/** A disclosure group in a panel: an h3 button header that opens and closes its content. Kept mounted. */
export function Group({ title, children, defaultOpen = false, open: openProp, onOpenChange, id, meta }: { title: ReactNode; children: ReactNode; defaultOpen?: boolean; open?: boolean; onOpenChange?: (o: boolean) => void; id?: string; meta?: ReactNode }) {
  const [own, setOwn] = useState(defaultOpen);
  const open = openProp ?? own;
  const auto = useId().replace(/:/g, "");
  const bodyId = id ? `${id}-body` : `g-${auto}`;
  return (
    <section className="group" data-open={open || undefined} id={id}>
      <h3 className="group__h">
        <button
          type="button"
          className="group__toggle"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => {
            setOwn(!open);
            onOpenChange?.(!open);
          }}
        >
          <CaretRight size={18} weight="bold" className="group__chevron" aria-hidden="true" />
          <span className="group__title">{title}</span>
          {meta ? <span className="group__meta">{meta}</span> : null}
        </button>
      </h3>
      <div className="group__body" id={bodyId} hidden={!open}>
        {children}
      </div>
    </section>
  );
}
