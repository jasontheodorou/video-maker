// Icon row scene: 2 to 4 icons, each with a short label, and an optional heading. On a light background.
import { z } from "zod";
import type { SceneDefinition, SceneContext } from "./types";
import { textField, emphasisField, checkEmphasis, checkFullList, listField } from "./common";
import { IconRef } from "../schema";

const Item = z
  .object({
    icon: IconRef,
    label: textField(26),
  })
  .strict();

const Slots = z
  .object({
    heading: textField(48).optional(),
    items: listField(Item),
    emphasis: emphasisField,
  })
  .strict()
  .superRefine((s, ctx) => {
    checkEmphasis(s, ["heading"], ctx);
    checkFullList(s.items, "label", 22, ctx, "label");
  });
type Slots = z.infer<typeof Slots>;

/** Columns per format: a row in landscape, a list in portrait, and in square a pair or a list. */
function columns(format: string, n: number): number {
  if (format === "16x9") return n;
  if (format === "9x16") return 1;
  // Square: two side by side; three or four as a list, which gives each label the full width.
  return n === 2 ? 2 : 1;
}

const css = (ctx: SceneContext<Slots>, o: { icon: number; pad: number; gapHead: string; gapCells: string }) => {
  const id = `#${ctx.sceneId}`;
  const n = ctx.slots.items.length;
  const cols = columns(ctx.format.id, n);
  const list = cols === 1;
  return `
${id} .content{display:flex;flex-direction:column;justify-content:center}
${id} .heading{margin-bottom:${o.gapHead}${list ? "" : ";text-align:center;align-self:center;max-width:1300px"}}
${id} .grid{display:grid;grid-template-columns:repeat(${cols},minmax(0,1fr));gap:${o.gapCells};width:100%}
${id} .cell{display:flex;${list ? "flex-direction:row;align-items:center;gap:var(--sp-5)" : "flex-direction:column;align-items:center;text-align:center;gap:var(--sp-3)"}}
${id} .ic{flex:none;width:${o.icon}px;height:${o.icon}px;border-radius:50%;background:var(--tint-bg);color:var(--light-accent);padding:${o.pad}px}
${id} .label{font-weight:var(--weight-heading);text-wrap:balance${list ? ";flex:1;min-width:0" : ";width:100%"}}`;
};

export const iconrow: SceneDefinition<Slots> = {
  type: "icons",
  label: "Icon row",
  description:
    "2 to 4 icons, each with a short label, and an optional heading. Use it to show options, services or things to bring at a glance. Labels up to 26 characters (22 when there are 4 icons; 2 to 4 words is best), heading up to 48.",
  beats: ["message", "insight", "proof", "summary", "action"],
  surface: "light",
  slots: Slots,
  text: [
    { slot: "heading", maxChars: 48, maxLines: { "16x9": 2, "9x16": 3, "1x1": 3 } },
    { slot: "items", maxChars: 26, maxCharsWhenFull: 22, maxLines: { "16x9": 3, "9x16": 2, "1x1": 2 } },
  ],
  sample: {
    heading: "What goes in your green bin",
    items: [
      { icon: { icon: "leaf" }, label: "Grass and leaves" },
      { icon: { icon: "tree" }, label: "Small branches" },
      { icon: { icon: "flower" }, label: "Flowers and plants" },
    ],
  },
  elements: (s) => [
    ...(s.heading ? [{ id: "heading", entrance: "rise" as const, slot: "heading" }] : []),
    ...s.items.map((it, i) => ({ id: `item${i + 1}`, entrance: "rise" as const, slot: "items", text: it.label })),
  ],
  markup: (ctx) => {
    const s = ctx.slots;
    const id = ctx.sceneId;
    const cells = s.items
      .map((it, i) => `<div class="cell anim" id="${id}-item${i + 1}"><span class="ic">${ctx.icon(it.icon)}</span><p class="label t-body" data-fit="items">${ctx.esc(it.label)}</p></div>`)
      .join("");
    return `
<div class="content">
  ${s.heading ? `<h2 class="heading t-heading anim" id="${id}-heading" data-fit="heading">${ctx.rich(s.heading, s.emphasis)}</h2>` : ""}
  <div class="grid">${cells}</div>
</div>`;
  },
  layouts: {
    "16x9": (ctx) => css(ctx, { icon: 168, pad: 28, gapHead: "var(--sp-8)", gapCells: "var(--sp-6)" }),
    "9x16": (ctx) => css(ctx, { icon: 140, pad: 22, gapHead: "var(--sp-8)", gapCells: "var(--sp-6)" }),
    "1x1": (ctx) => {
      const n = ctx.slots.items.length;
      if (n === 4) return css(ctx, { icon: 88, pad: 13, gapHead: "var(--sp-5)", gapCells: "var(--sp-3)" });
      if (n === 3) return css(ctx, { icon: 112, pad: 17, gapHead: "var(--sp-6)", gapCells: "var(--sp-4)" });
      return css(ctx, { icon: 128, pad: 19, gapHead: "var(--sp-6)", gapCells: "var(--sp-5)" });
    },
  },
};
