// Helpers shared by scene definitions.
import { z } from "zod";
import { coverPlacement, ENLARGE_FAIL, ENLARGE_WARN, type ResolvedMedia } from "../media";
import { DRIFT } from "../motion";

/** Plain names of text parts, for messages people read ("Shorten the title or the line under the title"). */
export const SLOT_WORDS: Record<string, string> = {
  title: "the title",
  eyebrow: "the small heading above the title",
  subtitle: "the line under the title",
  kicker: "the small heading",
  text: "the main text",
  support: "the supporting line",
  action: "what to do",
  link: "the web address",
  detail: "the extra detail",
  heading: "the heading",
  items: "a list item",
  value: "the number",
  label: "the label",
  source: "the source",
  quote: "the quote",
  name: "the name",
  role: "the role",
};

/** A single-line-of-thought text field: trimmed, no line breaks, no HTML. */
export function textField(maxChars: number, minChars = 1) {
  return z
    .string()
    .trim()
    .min(minChars)
    .max(maxChars, `Keep this to ${maxChars} characters or fewer`)
    .refine((s) => !/[\r\n]/.test(s), "Use one line, with no line breaks")
    .refine((s) => !/[<>]/.test(s), "Do not use < or > in on-screen text");
}

/** Words to emphasise. Each must appear, exactly, in one of the named text slots. */
export const emphasisField = z.array(z.string().trim().min(1).max(40)).max(3).optional();

export function checkEmphasis(slots: Record<string, unknown>, textSlots: string[], ctx: z.RefinementCtx) {
  const em = slots.emphasis as string[] | undefined;
  if (!em) return;
  const all = textSlots.map((k) => (typeof slots[k] === "string" ? (slots[k] as string) : "")).join("\n");
  for (const e of em) {
    if (!all.includes(e)) {
      ctx.addIssue({ code: "custom", path: ["emphasis"], message: `"${e}" is not in the on-screen text, so it cannot be emphasised` });
    }
  }
}

/**
 * A web address or similar that may wrap only after a slash, never at a hyphen or dot.
 * Each segment is kept whole; if a segment is still too wide, lint fails it.
 */
export function unbreakableLink(text: string, esc: (s: string) => string): string {
  return text
    .split(/(?<=\/)/)
    .map((seg) => `<span style="white-space:nowrap">${esc(seg)}</span>`)
    .join("<wbr>");
}

/** Shared CSS for a text block. */
export const TYPE_CLASSES = `
.t-display{font-family:var(--font-heading);font-weight:var(--weight-heading);font-size:var(--t-display);line-height:var(--lh-display);letter-spacing:var(--ls-display);text-wrap:balance}
.t-heading{font-family:var(--font-heading);font-weight:var(--weight-heading);font-size:var(--t-heading);line-height:var(--lh-heading);letter-spacing:var(--ls-heading);text-wrap:balance}
.t-body{font-family:var(--font-body);font-weight:var(--weight-body);font-size:var(--t-body);line-height:var(--lh-body);text-wrap:pretty}
.t-label{font-family:var(--font-heading);font-weight:var(--weight-heading);font-size:var(--t-label);line-height:var(--lh-heading)}
`;

// ---------- shared pieces for the newer scenes ----------

/** Items of a list: 2 to 4, each one line of thought. */
export function listField<T extends z.ZodTypeAny>(item: T, min = 2, max = 4) {
  return z.array(item).min(min, `Use at least ${min} items`).max(max, `Use ${max} items or fewer`);
}

/** With 4 items a list needs shorter items to fit the square and portrait videos. */
export function checkFullList(items: Array<Record<string, unknown>>, key: string, max: number, ctx: z.RefinementCtx, noun: string) {
  if (items.length < 4) return;
  items.forEach((it, i) => {
    const t = it[key];
    if (typeof t === "string" && t.length > max)
      ctx.addIssue({ code: "custom", path: ["items", i, key], message: `With 4 ${noun}s, keep each ${noun} to ${max} characters or fewer so they fit every format. Or use 3 ${noun}s.` });
  });
}

/** A small filled marker for list items without an icon. Coloured by the surface accent. */
export const DOT = `<span class="dot" aria-hidden="true"></span>`;

/**
 * A full-bleed or boxed photo. The <img> carries class "drift", so the compiler gives it the slow sideways
 * drift (motion.ts DRIFT). Its placement (crop) comes from photoCss() in each layout.
 */
export function photoMarkup(id: string, url: string, cls = "media-box"): string {
  return `<div class="${cls}" aria-hidden="true"><img id="${id}-img" class="photo drift" src="${url}" alt=""></div>`;
}

/**
 * Layout CSS that crops a photo or clip to its box around the focal point. Reports a soft (enlarged)
 * picture through ctx.issue, so lint can warn or fail. Photos are held DRIFT.scale larger for the drift.
 */
export function photoCss(
  ctx: { sceneId: string; issue(level: "error" | "warning", message: string): void },
  media: ResolvedMedia | null,
  box: { w: number; h: number },
  name: string,
  selector = ".photo",
  aim?: [number, number],
): string {
  if (!media) return "";
  const extra = media.kind === "photo" ? DRIFT.scale : 1;
  const p = coverPlacement(media, box.w, box.h, extra, aim);
  const what = media.kind === "clip" ? "clip" : "photo";
  if (p.enlargement > ENLARGE_FAIL)
    ctx.issue("error", `The ${what} ${name} is too small for this space. It would be shown at ${Math.round(p.enlargement * 100)}% of its real size and look blurred. Use one at least ${Math.ceil((box.w * extra) / 10) * 10} by ${Math.ceil((box.h * extra) / 10) * 10} pixels.`);
  else if (p.enlargement > ENLARGE_WARN)
    ctx.issue("warning", `The ${what} ${name} is shown at ${Math.round(p.enlargement * 100)}% of its real size here, so it may look a little soft. A larger file would be sharper.`);
  return `#${ctx.sceneId} ${selector}{display:block;width:${box.w}px;height:${box.h}px;${p.css}}`;
}

/** A simple, original quotation mark drawn as a vector, coloured with currentColor. */
export const QUOTE_MARK_SVG = `<svg viewBox="0 0 124 96" aria-hidden="true" focusable="false"><path fill="currentColor" d="M0 96V58C0 24 17 5 50 0l5 15C37 21 28 31 27 44h23v52H0Zm69 0V58c0-34 17-53 50-58l5 15c-18 6-27 16-28 29h23v52H69Z"/></svg>`;

/** Shared CSS for list markers and media boxes. Uses tokens only. */
export const SHARED_SCENE_CSS = `
.nb{white-space:nowrap}
.dot{display:block;flex:none;width:var(--sp-3);height:var(--sp-3);border-radius:calc(var(--radius) / 2);background:currentColor}
.media-box{position:absolute;overflow:hidden}
.media-box img{display:block}
`;

const MONTHS = "January|February|March|April|May|June|July|August|September|October|November|December";
const KEEP_TOGETHER = new RegExp(
  [
    "\\b0\\d{2,4}(?: \\d{3,4}){1,2}\\b", // phone numbers: 0300 555 0199
    `\\b\\d{1,2} (?:${MONTHS})(?: \\d{4})?\\b`, // dates: 3 March 2027
    "\\b\\d{1,2}(?::\\d{2})?(?:am|pm)\\b", // times are one word already; kept for clarity
    "\\b\\d+ in \\d+\\b", // 1 in 4
    "£\\d[\\d,.]*(?: ?(?:million|billion|m|bn|k))?\\b", // money
  ].join("|"),
  "g",
);

/** Hyphenated words such as names (Whitfield-Brown) and words like "drop-in": never broken at the hyphen. */
const HYPHENATED = /[A-Za-z\u00C0-\u024F]+(?:-[A-Za-z\u00C0-\u024F]+)+/g;

/**
 * Keep phone numbers, dates, "1 in 4", amounts of money and hyphenated words on one line. Works on escaped
 * HTML: only the text between tags is changed, never a tag.
 */
export function keepTogether(html: string): string {
  return html
    .split(/(<[^>]*>)/)
    .map((part) =>
      part.startsWith("<")
        ? part
        : part.replace(KEEP_TOGETHER, (m) => (m.includes(" ") ? `<span class="nb">${m}</span>` : m)).replace(HYPHENATED, (m) => `<span class="nb">${m}</span>`),
    )
    .join("");
}
