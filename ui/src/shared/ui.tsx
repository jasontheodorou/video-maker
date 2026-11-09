// Shared building blocks for both pages: the frame, headings, sections, cards, messages, fields,
// empty states, skeletons and toasts. Read DESIGN.md before adding to this file.
import { Button, MantineProvider, Skeleton } from "@mantine/core";
import { CaretRight, CheckCircle, FilmSlate, Info, WarningCircle, Warning, CircleNotch, Clock, Prohibit, X } from "@phosphor-icons/react";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { theme } from "./theme";
import { Collapse, MotionRoot, PageEnter, Pill, Reveal, duration, ease, spring, usePillId } from "./motion";

export const ICON = { size: 24, weight: "light" as const };

const NAV = [
  { key: "make", href: "/", label: "Make a video" },
  { key: "brands", href: "/brands", label: "Brands" },
] as const;

/** The top bar's links. A pill sits behind the current page and glides to whichever link you point at. */
function TopNav({ current }: { current: "make" | "brands" }) {
  const [hover, setHover] = useState<string | null>(null);
  const pill = usePillId("nav");
  const shown = hover ?? current;
  return (
    <nav className="topnav" aria-label="Main">
      <ul onMouseLeave={() => setHover(null)}>
        {NAV.map((n) => (
          <li key={n.key}>
            {shown === n.key ? <Pill layoutId={pill} className={`topnav__pill${n.key !== current ? " topnav__pill--hover" : ""}`} /> : null}
            <a href={n.href} aria-current={current === n.key ? "page" : undefined} onMouseEnter={() => setHover(n.key)} onFocus={() => setHover(n.key)} onBlur={() => setHover(null)}>
              {n.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** True once the page has scrolled, so the sticky top bar can show its hairline. */
function useScrolled() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 4);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  return scrolled;
}

/** The frame of every page: providers, skip link, sticky top bar, the 720px column, and the toaster. */
export function Shell({ current, children, modals }: { current: "make" | "brands"; children: ReactNode; modals?: ReactNode }) {
  const scrolled = useScrolled();
  return (
    <MantineProvider theme={theme}>
      <MotionRoot>
        <a className="skip-link" href="#main">
          Skip to main content
        </a>
        <header className="topbar" data-scrolled={scrolled || undefined}>
          <div className="container topbar__inner">
            <a className="wordmark" href="/">
              <FilmSlate size={28} weight="regular" aria-hidden="true" />
              <span className="wordmark__text">Video maker</span>
            </a>
            <TopNav current={current} />
          </div>
        </header>
        <main id="main" tabIndex={-1} className="container">
          <PageEnter>{children}</PageEnter>
        </main>
        {modals}
        <Toaster />
      </MotionRoot>
    </MantineProvider>
  );
}

/** The page's one h1, with the signature orange dot. */
export function PageTitle({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <h1 className="page-title" id={id} tabIndex={id ? -1 : undefined}>
      {children}
      <motion.span className="dot" aria-hidden="true" initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ ...spring.snappy, delay: 0.2 }} />
    </h1>
  );
}

/** Title plus an optional one-line lede, with the page-top gap. Use once at the top of each view. */
export function PageHeader({ title, lede, id, before }: { title: ReactNode; lede?: ReactNode; id?: string; before?: ReactNode }) {
  return (
    <div className="page-head">
      {before}
      <PageTitle id={id}>{title}</PageTitle>
      {lede ? <p className="lede">{lede}</p> : null}
    </div>
  );
}

/** A titled block of the page, one after another. `reveal` fades it in when it first appears. */
export function Section({ title, intro, id, level = 2, children, className = "", reveal = false, labelId }: { title?: ReactNode; intro?: ReactNode; id?: string; level?: 2 | 3; children?: ReactNode; className?: string; reveal?: boolean; labelId?: string }) {
  const H = level === 3 ? "h3" : "h2";
  const hid = labelId ?? (id ? `${id}-h` : undefined);
  const body = (
    <>
      {title ? (
        <div className="section__head">
          <H className={level === 3 ? "h3" : "h2"} id={hid}>
            {title}
          </H>
          {intro ? <p className="section__intro">{intro}</p> : null}
        </div>
      ) : null}
      {children}
    </>
  );
  if (reveal) {
    return (
      <Reveal as="section" id={id} className={`section ${className}`} aria-labelledby={title ? hid : undefined}>
        {body}
      </Reveal>
    );
  }
  return (
    <section id={id} className={`section ${className}`} aria-labelledby={title ? hid : undefined}>
      {body}
    </section>
  );
}

/** A white surface on the paper. `interactive` adds a hover lift for whole-card links. */
export function Card({ children, className = "", interactive, as = "div", ...rest }: { children: ReactNode; className?: string; interactive?: boolean; as?: "div" | "section" | "article" | "li" } & Record<string, unknown>) {
  const Tag = as as "div";
  return (
    <Tag className={`card${interactive ? " card--interactive" : ""} ${className}`} {...rest}>
      {children}
    </Tag>
  );
}

/** Nothing here yet: an icon, a short title, at most one line, and at most one action. */
export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <Reveal className="empty">
      {icon ? (
        <span className="empty__icon" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <p className="empty__title">{title}</p>
      {children ? <p className="empty__body">{children}</p> : null}
      {action ? <div className="buttons">{action}</div> : null}
    </Reveal>
  );
}

/**
 * Placeholder lines while something loads. Screen readers hear `label` once (polite); the bars are hidden.
 */
export function SkeletonLines({ lines = 3, label = "Loading", height = 20, className = "" }: { lines?: number; label?: string; height?: number; className?: string }) {
  return (
    <div className={`skeleton ${className}`}>
      <span className="visually-hidden" role="status">
        {label}
      </span>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} height={height} width={i === lines - 1 && lines > 1 ? "62%" : "100%"} aria-hidden="true" />
      ))}
    </div>
  );
}

/** A block-sized placeholder (a card, a video) while it loads. */
export function SkeletonBlock({ height = 160, label = "Loading" }: { height?: number; label?: string }) {
  return (
    <div className="skeleton">
      <span className="visually-hidden" role="status">
        {label}
      </span>
      <Skeleton height={height} radius="lg" aria-hidden="true" />
    </div>
  );
}

/**
 * A quiet link that opens more, GOV.UK details style, animated with Framer Motion. Keyboard and
 * screen-reader friendly (a real button with aria-expanded and aria-controls).
 */
export function Disclosure({ summary, children, defaultOpen = false, open: openProp, onOpenChange, className = "" }: { summary: ReactNode; children: ReactNode; defaultOpen?: boolean; open?: boolean; onOpenChange?: (open: boolean) => void; className?: string }) {
  const [own, setOwn] = useState(defaultOpen);
  const open = openProp ?? own;
  const id = useRef(`d-${Math.random().toString(36).slice(2, 8)}`).current;
  return (
    <div className={`disclosure ${className}`}>
      <button
        type="button"
        className="disclosure__toggle"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => {
          setOwn(!open);
          onOpenChange?.(!open);
        }}
      >
        <motion.span className="disclosure__chevron" animate={{ rotate: open ? 90 : 0 }} transition={spring.snappy} aria-hidden="true">
          <CaretRight size={18} weight="bold" />
        </motion.span>
        {summary}
      </button>
      <Collapse open={open} id={id}>
        <div className="disclosure__body">{children}</div>
      </Collapse>
    </div>
  );
}

// ─── Toasts ──────────────────────────────────────────────────────────────

export type ToastTone = "ok" | "info" | "bad";
type ToastItem = { id: number; text: string; tone: ToastTone };
let toasts: ToastItem[] = [];
let nextToast = 1;
const toastListeners = new Set<() => void>();
const emitToasts = () => toastListeners.forEach((l) => l());

/** Dismiss a toast by id. */
export function dismissToast(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  emitToasts();
}

/**
 * Show a short confirmation at the bottom of the screen ("Saved", "Copied"). Screen readers hear it
 * through a polite live region. Never put the only copy of important information in a toast: it goes
 * after `ms` (default 4s; errors stay until closed).
 */
export function toast(text: string, opts: { tone?: ToastTone; ms?: number } = {}) {
  const tone = opts.tone ?? "ok";
  const id = nextToast++;
  toasts = [...toasts.slice(-2), { id, text, tone }];
  emitToasts();
  const ms = opts.ms ?? (tone === "bad" ? 0 : 4000);
  if (ms > 0) setTimeout(() => dismissToast(id), ms);
  return id;
}

function useToasts() {
  return useSyncExternalStore(
    (l) => {
      toastListeners.add(l);
      return () => toastListeners.delete(l);
    },
    () => toasts,
    () => toasts,
  );
}

/** Renders the toasts. Shell includes it; do not add another. */
export function Toaster() {
  const list = useToasts();
  return (
    <div className="toaster" role="status" aria-live="polite" aria-atomic="false">
      <AnimatePresence initial={false}>
        {list.map((t) => {
          const Icon = t.tone === "bad" ? WarningCircle : t.tone === "info" ? Info : CheckCircle;
          return (
            <motion.div
              key={t.id}
              layout
              className={`toast toast--${t.tone}`}
              initial={{ opacity: 0, y: 16, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1, transition: spring.gentle }}
              exit={{ opacity: 0, y: 8, transition: { duration: duration.fast, ease: ease.out } }}
            >
              <Icon className="toast__icon" size={22} weight="regular" aria-hidden="true" />
              <span className="toast__text">{t.text}</span>
              <button type="button" className="toast__close" aria-label="Dismiss" onClick={() => dismissToast(t.id)}>
                <X size={18} weight="bold" aria-hidden="true" />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

export type SummaryItem = string | { text: string; target?: string };

/** Move focus into a field and bring its label (or its group's legend) into view, as GOV.UK does. */
export function goToField(targetId: string) {
  const target = document.getElementById(targetId) as HTMLInputElement | null;
  if (!target) return false;
  const legend = target.closest("fieldset")?.querySelector("legend");
  const label = document.querySelector(`label[for="${CSS.escape(targetId)}"]`);
  ((legend && target.type === "checkbox") || (legend && target.type === "radio") ? legend : (label ?? target)).scrollIntoView({ block: "start" });
  target.focus({ preventScroll: true });
  return true;
}

/**
 * The GOV.UK error summary: a heading and a list of problems, each linking to its field. It takes focus
 * whenever it appears or its content changes (pass a new `focusKey` to move focus again).
 */
export function ErrorSummary({ title = "There is a problem", items, focusKey, focus = true, headingLevel = 2 }: { title?: string; items: SummaryItem[]; focusKey?: unknown; focus?: boolean; headingLevel?: 2 | 3 }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focus && items.length) ref.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusKey, items.length]);
  if (!items.length) return null;
  const H = headingLevel === 3 ? "h3" : "h2";
  return (
    <div className="message message--bad error-summary rise" role="alert" tabIndex={-1} ref={ref}>
      <WarningCircle {...ICON} aria-hidden="true" />
      <div>
        <H>{title}</H>
        <ul>
          {items.map((m, i) => {
            const it = typeof m === "string" ? { text: m } : m;
            return (
              <li key={i}>
                {it.target ? (
                  <a
                    href={`#${it.target}`}
                    onClick={(e) => {
                      if (goToField(it.target!)) e.preventDefault();
                    }}
                  >
                    {it.text}
                  </a>
                ) : (
                  it.text
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

type Tone = "info" | "warn" | "ok" | "bad" | "plain";
const TONE_ICON = { info: Info, warn: Warning, ok: CheckCircle, bad: WarningCircle, plain: Info };

/** A message on a soft tint, with an icon that says what kind it is. */
export function Message({ tone = "info", children, className = "", role, focusRef, id }: { tone?: Tone; children: ReactNode; className?: string; role?: string; focusRef?: React.Ref<HTMLDivElement>; id?: string }) {
  const Icon = TONE_ICON[tone];
  return (
    <div className={`message message--${tone} ${className}`} role={role} ref={focusRef} tabIndex={focusRef ? -1 : undefined} id={id}>
      <Icon {...ICON} aria-hidden="true" />
      <div>{children}</div>
    </div>
  );
}

export type TagTone = "good" | "bad" | "busy" | "";
export function Tag({ tone, children, className = "", plain }: { tone: TagTone; children: ReactNode; className?: string; plain?: boolean }) {
  const Icon = plain ? Info : tone === "good" ? CheckCircle : tone === "bad" ? WarningCircle : tone === "busy" ? CircleNotch : Prohibit;
  return (
    <span className={`tag ${tone} ${className}`}>
      <Icon size={18} weight="regular" aria-hidden="true" />
      <span className="tag__text">{children}</span>
    </span>
  );
}
export const WaitingIcon = Clock;

/**
 * A character count under a box. The visible count changes as you type; screen readers hear it once you
 * pause (like the GOV.UK character count), not on every key press.
 */
export function CharCount({ id, value, max, idle, within }: { id: string; value: string; max: number; idle?: string; within?: number }) {
  const n = value.length;
  const shown = countShown(value, max, within);
  const text = n === 0 && idle ? idle : n > max ? `${(n - max).toLocaleString("en-GB")} character${n - max === 1 ? "" : "s"} too many` : `${(max - n).toLocaleString("en-GB")} character${max - n === 1 ? "" : "s"} left`;
  const [spoken, setSpoken] = useState("");
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const t = setTimeout(() => setSpoken(shown ? text : ""), 1000);
    return () => clearTimeout(t);
  }, [text, shown]);
  // Out of range, only the (empty) live region stays, so it is ready to speak when the count appears.
  return (
    <p className={`char-count${n > max ? " over" : ""}${shown ? "" : " char-count--idle"}`} id={shown ? id : undefined}>
      {shown ? <span>{text}</span> : null}
      <span className="visually-hidden" aria-live="polite">
        {spoken}
      </span>
    </p>
  );
}

/** Whether a CharCount with `within` is showing: only once `within` or fewer characters are left (or too many). */
export function countShown(value: string, max: number, within?: number) {
  return within == null || max - value.length <= within;
}

/** Label, hint, inline error and the control, in the GOV.UK order. */
export function Field({ id, label, hint, error, children, extra, className = "" }: { id: string; label: ReactNode; hint?: ReactNode; error?: string | null; children: ReactNode; extra?: ReactNode; className?: string }) {
  return (
    <div className={`field ${className}`} data-error={error ? "true" : undefined}>
      <label className="label" htmlFor={id}>
        {label}
      </label>
      {hint ? (
        <p className="hint" id={`${id}-hint`}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p className="error-msg" id={`${id}-error`}>
          <span className="visually-hidden">Error: </span>
          {error}
        </p>
      ) : null}
      <div className="control">{children}</div>
      {extra}
    </div>
  );
}

/** The ids a control should be described by: its hint, error and any extras that exist. */
export function describedBy(id: string, opts: { hint?: unknown; error?: unknown; extra?: string[] }) {
  return [opts.error ? `${id}-error` : "", opts.hint ? `${id}-hint` : "", ...(opts.extra ?? [])].filter(Boolean).join(" ") || undefined;
}

/** Run after the DOM has updated: for moving focus to something that has just appeared. */
export function useAfterRender() {
  const [tick, setTick] = useState(0);
  const queue = useRef<Array<() => void>>([]);
  useLayoutEffect(() => {
    const q = queue.current;
    queue.current = [];
    for (const fn of q) fn();
  }, [tick]);
  return (fn: () => void) => {
    queue.current.push(fn);
    setTick((t) => t + 1);
  };
}

/**
 * A question asked in the page, GOV.UK style, in place of a dialog: the trigger button is swapped for the
 * question and two answers. Focus moves to the question's main answer, and back to the trigger on Cancel.
 * `onYes` may return an error message, which is shown in the question.
 */
export function InlineConfirm({
  trigger,
  triggerProps,
  question,
  detail,
  yes,
  no = "Cancel",
  danger = true,
  onYes,
  linkStyle,
}: {
  trigger: ReactNode;
  triggerProps?: Record<string, unknown>;
  question: string;
  detail?: string[];
  yes: string;
  no?: string;
  danger?: boolean;
  onYes: () => Promise<string | void> | string | void;
  linkStyle?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const yesRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);
  const qid = useRef(`q-${Math.random().toString(36).slice(2, 8)}`).current;
  useEffect(() => {
    if (open) yesRef.current?.focus();
    else if (returnFocus.current) {
      returnFocus.current = false;
      triggerRef.current?.focus();
    }
  }, [open]);
  if (!open) {
    return linkStyle ? (
      <button type="button" className="link-button" ref={triggerRef} onClick={() => setOpen(true)} {...triggerProps}>
        {trigger}
      </button>
    ) : (
      <Button variant="default" ref={triggerRef} onClick={() => setOpen(true)} {...triggerProps}>
        {trigger}
      </Button>
    );
  }
  return (
    <div className="confirm rise" role="group" aria-labelledby={qid}>
      <Message tone="warn">
        <h3 id={qid}>{question}</h3>
        {detail?.map((d, i) => (
          <p key={i}>{d}</p>
        ))}
        {error ? (
          <p className="error-msg" role="alert">
            <span className="visually-hidden">Error: </span>
            {error}
          </p>
        ) : null}
        <div className="buttons">
          <Button
            ref={yesRef}
            className={danger ? "danger" : ""}
            color={danger ? "red" : undefined}
            aria-disabled={busy || undefined}
            onClick={async () => {
              if (busy) return;
              setBusy(true);
              setError(null);
              try {
                const err = await onYes();
                if (err) setError(err);
                else setOpen(false);
              } finally {
                setBusy(false);
              }
            }}
          >
            {yes}
          </Button>
          <Button
            variant="default"
            onClick={() => {
              returnFocus.current = true;
              setError(null);
              setOpen(false);
            }}
          >
            {no}
          </Button>
        </div>
      </Message>
    </div>
  );
}
