// Motion for the Video maker: one personality, "Quiet-Clear". Short (150 to 350ms), ease-out or a
// high-damping spring, no bounce, opacity and transform only (height only for disclosure).
// Everything honours prefers-reduced-motion through <MotionRoot> (MotionConfig reducedMotion="user")
// and useReducedMotion. Nothing here ever blocks input. See DESIGN.md.
import {
  AnimatePresence,
  LayoutGroup,
  MotionConfig,
  motion,
  useReducedMotion,
  type HTMLMotionProps,
  type Transition,
  type Variants,
} from "framer-motion";
import { useId, type ReactNode } from "react";

// ─── Tokens ──────────────────────────────────────────────────────────────

/** Durations in seconds. fast: hovers, presses, crossfades. base: most entrances. slow: page, disclosure. */
export const duration = { fast: 0.15, base: 0.22, slow: 0.35 } as const;

/** Cubic-bezier curves. `out` is the house curve (matches --ease-out in styles.css). */
export const ease = {
  out: [0.22, 1, 0.36, 1] as [number, number, number, number],
  inOut: [0.65, 0, 0.35, 1] as [number, number, number, number],
};

/** Springs. All critically damped or close: they settle without overshoot. */
export const spring = {
  /** Presses, toggles, small things. */
  snappy: { type: "spring", stiffness: 520, damping: 38, mass: 0.6 } as Transition,
  /** Entrances, layout changes, the nav pill. */
  gentle: { type: "spring", stiffness: 320, damping: 34, mass: 0.8 } as Transition,
  /** Progress bars and larger surfaces. */
  soft: { type: "spring", stiffness: 160, damping: 28, mass: 1 } as Transition,
};

/** Shorthand transitions. */
export const transition = {
  fast: { duration: duration.fast, ease: ease.out } as Transition,
  base: { duration: duration.base, ease: ease.out } as Transition,
  slow: { duration: duration.slow, ease: ease.out } as Transition,
};

// ─── Variants ────────────────────────────────────────────────────────────

/** Fade and rise 8px. The default entrance. */
export const riseVariants: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: transition.slow },
};

/** Fade only. For things that must not move (status text, overlays). */
export const fadeVariants: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: transition.base },
};

/** Parent for staggered children (40ms apart by default). */
export function staggerVariants(gap = 0.04, delay = 0): Variants {
  return { hidden: {}, show: { transition: { staggerChildren: gap, delayChildren: delay } } };
}

/** whileHover for cards and rows: a 2px lift. */
export const hoverLift = { y: -2, transition: spring.snappy };
/** whileTap for anything pressable: a small squeeze. */
export const tapPress = { scale: 0.97, transition: spring.snappy };

// ─── Root ────────────────────────────────────────────────────────────────

/** Wrap the whole app once (Shell does this). Turns transform motion off for people who ask for less. */
export function MotionRoot({ children }: { children: ReactNode }) {
  return (
    <MotionConfig reducedMotion="user" transition={transition.base}>
      {children}
    </MotionConfig>
  );
}

// ─── Entrances ───────────────────────────────────────────────────────────

type DivProps = Omit<HTMLMotionProps<"div">, "children"> & { children?: ReactNode };

/** The page's content, fading and rising in once on load. Shell wraps <main>'s children in this. */
export function PageEnter({ children, ...rest }: DivProps) {
  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: duration.slow, ease: ease.out }} {...rest}>
      {children}
    </motion.div>
  );
}

/**
 * Enters on mount: fade plus a small rise. Use for things that appear because of what the person did
 * (a result, a message, a new section). `delay` in seconds; `y` in px (0 for fade only).
 */
export function Reveal({ children, delay = 0, y = 8, as = "div", ...rest }: DivProps & { delay?: number; y?: number; as?: "div" | "section" | "li" | "span" }) {
  const M = motion[as] as typeof motion.div;
  return (
    <M initial={{ opacity: 0, y }} animate={{ opacity: 1, y: 0 }} transition={{ duration: duration.slow, ease: ease.out, delay }} {...rest}>
      {children}
    </M>
  );
}

/** A group whose <StaggerItem> children enter one after another. Renders a div (or `as`). */
export function Stagger({ children, gap = 0.04, delay = 0, as = "div", ...rest }: DivProps & { gap?: number; delay?: number; as?: "div" | "ul" | "ol" | "section" }) {
  const M = motion[as] as typeof motion.div;
  return (
    <M variants={staggerVariants(gap, delay)} initial="hidden" animate="show" {...rest}>
      {children}
    </M>
  );
}

/** One item in a <Stagger>. */
export function StaggerItem({ children, as = "div", ...rest }: DivProps & { as?: "div" | "li" | "section" }) {
  const M = motion[as] as typeof motion.div;
  return (
    <M variants={riseVariants} {...rest}>
      {children}
    </M>
  );
}

// ─── Disclosure ──────────────────────────────────────────────────────────

/**
 * Animates its children open and closed (height + fade). Content is unmounted when closed, so put
 * nothing that must keep state inside, or pass `keepMounted` to hide it instead.
 */
export function Collapse({ open, children, id, keepMounted = false, className }: { open: boolean; children: ReactNode; id?: string; keepMounted?: boolean; className?: string }) {
  const reduce = useReducedMotion();
  const t: Transition = reduce ? { duration: 0 } : { height: { duration: duration.slow, ease: ease.out }, opacity: { duration: duration.base, ease: ease.out } };
  if (keepMounted) {
    return (
      <motion.div
        id={id}
        className={className}
        initial={false}
        animate={open ? { height: "auto", opacity: 1 } : { height: 0, opacity: 0 }}
        transition={t}
        style={{ overflow: "hidden" }}
        aria-hidden={!open || undefined}
        inert={!open || undefined}
      >
        {children}
      </motion.div>
    );
  }
  return (
    <AnimatePresence initial={false}>
      {open ? (
        <motion.div
          key="c"
          id={id}
          className={className}
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0, transition: reduce ? { duration: 0 } : { duration: duration.base, ease: ease.out } }}
          transition={t}
          style={{ overflow: "hidden" }}
        >
          {children}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

/**
 * Cross-fades when `id` changes: for a status line, a step label or a number that updates. Old content
 * leaves fast (100ms) so the new content is never late.
 */
export function Swap({ id, children, className, as = "span" }: { id: string | number; children: ReactNode; className?: string; as?: "span" | "div" }) {
  const M = motion[as] as typeof motion.span;
  return (
    <AnimatePresence mode="popLayout" initial={false}>
      <M
        key={id}
        className={className}
        style={{ display: as === "span" ? "inline-block" : undefined }}
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0, transition: transition.base }}
        exit={{ opacity: 0, y: -4, transition: { duration: 0.1 } }}
      >
        {children}
      </M>
    </AnimatePresence>
  );
}

// ─── Interaction ─────────────────────────────────────────────────────────

/**
 * Adds press (and optional hover lift) to any block, e.g. a clickable card. Mantine Buttons already
 * squeeze on press through styles.css, so do not wrap them.
 */
export function Pressable({ children, lift = false, ...rest }: DivProps & { lift?: boolean }) {
  return (
    <motion.div whileTap={tapPress} whileHover={lift ? hoverLift : undefined} {...rest}>
      {children}
    </motion.div>
  );
}

// ─── Lists ───────────────────────────────────────────────────────────────

/**
 * A list whose items animate in when added, out when removed, and glide when reordered.
 * Give every <AnimatedItem> a stable `key`.
 */
export function AnimatedList({ children, as = "ul", className, ...rest }: DivProps & { as?: "ul" | "ol" | "div" }) {
  const M = motion[as] as typeof motion.div;
  return (
    <LayoutGroup>
      <M className={className} {...rest}>
        <AnimatePresence initial={false}>{children}</AnimatePresence>
      </M>
    </LayoutGroup>
  );
}

export function AnimatedItem({ children, as = "li", ...rest }: DivProps & { as?: "li" | "div" }) {
  const M = motion[as] as typeof motion.div;
  return (
    <M
      layout="position"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0, transition: transition.base }}
      exit={{ opacity: 0, transition: { duration: duration.fast } }}
      transition={spring.gentle}
      {...rest}
    >
      {children}
    </M>
  );
}

// ─── Status ──────────────────────────────────────────────────────────────

/** The signature orange dot, breathing while something is working. Decorative: pair it with words. */
export function PulseDot({ active = true, className = "" }: { active?: boolean; className?: string }) {
  const reduce = useReducedMotion();
  return (
    <span className={`pulse-dot ${className}`} aria-hidden="true">
      {active && !reduce ? (
        <motion.span
          className="pulse-dot__halo"
          initial={{ opacity: 0.5, scale: 1 }}
          animate={{ opacity: 0, scale: 2.4 }}
          transition={{ duration: 1.4, ease: "easeOut", repeat: Infinity }}
        />
      ) : null}
      <span className="pulse-dot__core" />
    </span>
  );
}

/**
 * A progress bar. Pass `value` 0 to 100, or leave it out for "working, no estimate".
 * It is a real progressbar for screen readers; give it a `label`.
 */
export function ProgressBar({ value, label, className = "" }: { value?: number | null; label: string; className?: string }) {
  const reduce = useReducedMotion();
  const known = typeof value === "number" && isFinite(value);
  const v = known ? Math.max(0, Math.min(100, value as number)) : 0;
  return (
    <div
      className={`progress${known ? "" : " progress--indeterminate"} ${className}`}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={known ? Math.round(v) : undefined}
    >
      {known ? (
        <motion.span className="progress__fill" initial={false} animate={{ scaleX: v / 100 }} transition={spring.soft} />
      ) : (
        <motion.span
          className="progress__fill"
          initial={{ x: "-100%" }}
          animate={reduce ? { x: "0%" } : { x: ["-100%", "300%"] }}
          transition={reduce ? { duration: 0 } : { duration: 1.4, ease: ease.inOut, repeat: Infinity }}
        />
      )}
    </div>
  );
}

/**
 * The moment something finishes: a circle and a tick that draw themselves (about 450ms in all).
 * Pass `still` to show it already drawn, for things that finished before the page was opened.
 */
export function SuccessCheck({ size = 40, label, still = false }: { size?: number; label?: string; still?: boolean }) {
  const reduce = useReducedMotion() || still;
  const draw = (delay: number) => (reduce ? { duration: 0 } : { pathLength: { delay, duration: 0.3, ease: ease.out }, opacity: { delay, duration: 0.01 } });
  return (
    <motion.span
      className="success-check"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      initial={still ? false : { scale: 0.8, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={spring.snappy}
    >
      <svg width={size} height={size} viewBox="0 0 40 40" fill="none">
        <motion.circle cx="20" cy="20" r="18" stroke="currentColor" strokeWidth="2.5" initial={still ? false : { pathLength: 0, opacity: 0 }} animate={{ pathLength: 1, opacity: 1 }} transition={draw(0)} />
        <motion.path d="M12.5 20.5l5 5 10-11" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" initial={still ? false : { pathLength: 0, opacity: 0 }} animate={{ pathLength: 1, opacity: 1 }} transition={draw(0.18)} />
      </svg>
    </motion.span>
  );
}

// ─── Hover pill for a set of links or tabs ───────────────────────────────

/** A shared id for one group's gliding pill, so two groups on a page never fight. */
export function usePillId(name: string) {
  return `${name}-${useId()}`;
}

/** The pill drawn behind the hovered or current item; give each group its own `layoutId`. */
export function Pill({ layoutId, className = "topnav__pill" }: { layoutId: string; className?: string }) {
  return <motion.span layoutId={layoutId} className={className} transition={spring.gentle} aria-hidden="true" />;
}
