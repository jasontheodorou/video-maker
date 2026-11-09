// Statement scene: one clear message on a light background, with an optional icon, kicker and support line.
import { z } from "zod";
import type { SceneDefinition } from "./types";
import { textField, emphasisField, checkEmphasis } from "./common";
import { IconRef } from "../schema";

const Slots = z
  .object({
    kicker: textField(30).optional(),
    text: textField(88),
    support: textField(64).optional(),
    icon: IconRef.optional(),
    emphasis: emphasisField,
  })
  .strict()
  .superRefine((s, ctx) => checkEmphasis(s, ["text"], ctx));
type Slots = z.infer<typeof Slots>;

function stacked(ctx: { sceneId: string; slots: { icon?: unknown } }, o: { icon: number; pad: number; gapText: string; gapSupport: string; bar: string; textSize?: string }): string {
  const id = `#${ctx.sceneId}`;
  const base = `
${id} .content{display:flex;align-items:safe center}
${id} .row{width:100%}
${id} .bar{width:${o.bar};height:var(--sp-1);background:var(--light-accent);margin-bottom:var(--sp-3)}
${id} .kicker{color:var(--light-accent)}
${id} .text{margin-top:${o.gapText}${o.textSize ? `;font-size:${o.textSize}` : ""}}
${id} .support{margin-top:${o.gapSupport}}`;
  if (!ctx.slots.icon) return base;
  return `${base}
${id} .row{display:grid;grid-template-columns:${o.icon}px minmax(0,1fr);column-gap:var(--sp-5);align-items:center}
${id} .copy{display:contents}
${id} .icon{grid-column:1;grid-row:1 / span 2;width:${o.icon}px;height:${o.icon}px;border-radius:50%;background:var(--tint-bg);color:var(--light-accent);padding:${o.pad}px}
${id} .bar{grid-column:2;grid-row:1;align-self:end}
${id} .kicker{grid-column:2;grid-row:2;align-self:start}
${id} .text{grid-column:1 / -1;grid-row:3}
${id} .support{grid-column:1 / -1;grid-row:4}`;
}

export const statement: SceneDefinition<Slots> = {
  type: "statement",
  label: "Statement",
  description: "One key message in large type, with an optional icon. Use it for a message, problem, insight or summary. Text up to 88 characters, small heading up to 30, supporting line up to 64.",
  beats: ["message", "problem", "insight", "proof", "summary"],
  surface: "light",
  slots: Slots,
  text: [
    { slot: "kicker", maxChars: 30, maxLines: { "16x9": 1, "9x16": 2, "1x1": 1 } },
    { slot: "text", maxChars: 88, maxLines: { "16x9": 4, "9x16": 7, "1x1": 5 } },
    { slot: "support", maxChars: 64, maxLines: { "16x9": 2, "9x16": 4, "1x1": 3 } },
  ],
  sample: {
    kicker: "From 3 March",
    text: "Garden waste is collected every two weeks, on the same day as your recycling",
    support: "Put your brown bin out by 7am",
    icon: { icon: "calendar" },
    emphasis: ["every two weeks"],
  },
  elements: (s) => [
    { id: "bar", entrance: "fade" },
    ...(s.icon ? [{ id: "icon", entrance: "riseSmall" as const }] : []),
    ...(s.kicker ? [{ id: "kicker", entrance: "riseSmall" as const, slot: "kicker" }] : []),
    { id: "text", entrance: "rise", slot: "text" },
    ...(s.support ? [{ id: "support", entrance: "rise" as const, slot: "support" }] : []),
  ],
  markup: (ctx) => {
    const s = ctx.slots;
    const id = ctx.sceneId;
    return `
<div class="content">
  <div class="row${s.icon ? " has-icon" : ""}">
    ${s.icon ? `<div class="icon anim" id="${id}-icon">${ctx.icon(s.icon)}</div>` : ""}
    <div class="copy">
      <div class="bar anim" id="${id}-bar"></div>
      ${s.kicker ? `<p class="kicker t-label anim" id="${id}-kicker" data-fit="kicker">${ctx.esc(s.kicker)}</p>` : ""}
      <p class="text t-heading anim" id="${id}-text" data-fit="text">${ctx.rich(s.text, s.emphasis)}</p>
      ${s.support ? `<p class="support t-body anim" id="${id}-support" data-fit="support">${ctx.esc(s.support)}</p>` : ""}
    </div>
  </div>
</div>`;
  },
  layouts: {
    "16x9": (ctx) => `
#${ctx.sceneId} .content{display:flex;align-items:safe center}
#${ctx.sceneId} .row{display:flex;align-items:flex-start;gap:var(--sp-10);width:100%}
#${ctx.sceneId} .icon{flex:none;width:184px;height:184px;border-radius:50%;background:var(--tint-bg);color:var(--light-accent);padding:28px}
#${ctx.sceneId} .copy{flex:1;max-width:1320px}
#${ctx.sceneId} .bar{width:var(--sp-12);height:var(--sp-1);background:var(--light-accent);margin-bottom:var(--sp-5)}
#${ctx.sceneId} .kicker{color:var(--light-accent);margin-bottom:var(--sp-3)}
#${ctx.sceneId} .support{margin-top:var(--sp-5)}`,
    // Portrait and square: the icon sits beside the bar and small heading, not above everything, so the
    // main text keeps its room. The copy box steps aside (display: contents) so its parts join the grid.
    "9x16": (ctx) => stacked(ctx, { icon: 152, pad: 22, gapText: "var(--sp-6)", gapSupport: "var(--sp-6)", bar: "var(--sp-12)" }),
    // Square: the main text is drawn at 0.9 of the heading size, a layout choice (never shrink-to-fit), so an
    // ordinary message with a small heading, an icon and a supporting line fits the short square frame.
    "1x1": (ctx) => stacked(ctx, { icon: 104, pad: 14, gapText: "var(--sp-4)", gapSupport: "var(--sp-4)", bar: "var(--sp-10)", textSize: "calc(var(--t-heading) * 0.9)" }),
  },
};
