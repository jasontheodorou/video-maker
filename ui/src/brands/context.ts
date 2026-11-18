// The brand editor's shared state: the draft and how to change it, the live check, the brand's files,
// and which sections are open. Every section reads and writes through useEditor().
import { createContext, useContext } from "react";
import type { Meta } from "../make/types";

export interface Check {
  ok: boolean;
  issues: Array<{ level: "error" | "warning"; field: string; message: string }>;
  contrast: Array<{ id: string; label: string; result: { ratio: number; ratioText: string; passesAAA: boolean; message: string; foreground: string; background: string } }>;
  fixes?: Record<string, Array<{ kind: "use" | "recolour"; label: string; note: string; path?: string; token?: string; colour?: string; value?: string; mends?: number }>>;
}

export type FontReport = { key: number; ok: boolean; text: string; warnings: string[] } | null;

export interface EditorCtx {
  id: string;
  meta: Meta;
  detail: any;
  draft: any;
  edit: (fn: (d: any) => void) => void;
  setValue: (path: string, value: unknown) => void;
  check: Check | null;
  files: any;
  setFiles: (f: any) => void;
  icons: { client: string[]; library: number };
  setIcons: (i: { client: string[]; library: number }) => void;
  /** Delete a brand file (the question has been asked in the page). Returns an error message if it fails. */
  deleteFile: (rel: string) => Promise<string | void>;
  suggestions: any;
  setSuggestions: (s: any) => void;
  /** Bumped when something outside a section (a suggestion, a fix) changes the draft, so local inputs resync. */
  revision: number;
  bump: () => void;
  /** The report shown at the top of the Fonts section after an open font is added (from Fonts or from the guidelines). */
  fontReport: FontReport;
  setFontReport: (r: FontReport) => void;
  /** Is this section open? */
  isOpen: (sectionId: string) => boolean;
  /** Open or close one section. */
  setOpen: (sectionId: string, open: boolean) => void;
  /** Open a section, bring its heading into view and give it focus. */
  go: (sectionId: string) => void;
  /** The studio area on show ("overview", "colours", ...). */
  area: string;
  /** What the inspector shows: a colour or a scheme, or nothing (the area's defaults). */
  selection: Selection;
  select: (s: Selection) => void;
}

export type Selection = { kind: "colour"; id: string } | { kind: "scheme"; id: string } | null;

/** The brand studio's areas, in bin order. */
export const AREAS = [
  { id: "overview", label: "Overview" },
  { id: "guidelines", label: "Guidelines" },
  { id: "colours", label: "Colours" },
  { id: "motion", label: "Motion" },
  { id: "type", label: "Type" },
  { id: "logo", label: "Logo" },
  { id: "icons", label: "Icons and graphics" },
  { id: "voice", label: "Voice" },
  { id: "writing", label: "Writing" },
  { id: "checks", label: "Checks" },
] as const;
export type AreaId = (typeof AREAS)[number]["id"];

export const EditorContext = createContext<EditorCtx | null>(null);
export const useEditor = () => useContext(EditorContext)!;

// Which section a check's field belongs to, for links from the checks and the error summary.
const FIELD_SECTIONS: Array<[RegExp, string, string]> = [
  [/^palette|^schemes|^schemeUse|^colours|^surfaces|^captions(?!\.weight)/, "sec-colours", "Colours"],
  [/^motion/, "sec-motion", "Motion"],
  [/^fonts|^captions\.weight|^typeScale|^lineHeight|^letterSpacing|^spacing|^radius/, "sec-type", "Type"],
  [/^logo/, "sec-logo", "Logo"],
  [/^icons|^graphics/, "sec-icons", "Icons"],
  [/^voice/, "sec-voice", "Voice"],
  [/^toneOfVoice|^guidelines|^rules/, "sec-writing", "Writing"],
  [/^provisional|^name|^id|^description|^examples/, "sec-overview", "Overview"],
];

export function sectionFor(field: string) {
  for (const [re, id, label] of FIELD_SECTIONS) if (re.test(field || "")) return { id, label };
  return { id: "sec-overview", label: "Overview" };
}

export function checkCounts(check: Check | null) {
  const issues = check?.issues ?? [];
  return { errors: issues.filter((i) => i.level === "error").length, warnings: issues.filter((i) => i.level === "warning" && i.field !== "provisional").length };
}

/** Problems (errors) per section id, for the badge on each section's header. */
export function problemsBySection(check: Check | null): Record<string, number> {
  const out: Record<string, number> = {};
  for (const i of check?.issues ?? []) {
    if (i.level !== "error") continue;
    const s = sectionFor(i.field).id;
    out[s] = (out[s] ?? 0) + 1;
  }
  return out;
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
