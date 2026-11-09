// Points scene: a short heading and 2 to 4 points, each with an optional icon. On a light background.
import { z } from "zod";
import type { SceneDefinition, SceneContext } from "./types";
import { textField, emphasisField, checkEmphasis, checkFullList, listField, DOT } from "./common";
import { IconRef } from "../schema";

const Item = z
  .object({
    text: textField(40),
    icon: IconRef.optional(),
  })
  .strict();

const Slots = z
  .object({
    kicker: textField(28).optional(),
    heading: textField(48),
    items: listField(Item),
    emphasis: emphasisField,
  })
  .strict()
  .superRefine((s, ctx) => {
    checkEmphasis(s, ["heading"], ctx);
    const withIcon = s.items.filter((i) => i.icon).length;
    if (withIcon && withIcon !== s.items.length)
      ctx.addIssue({ code: "custom", path: ["items"], message: "Give every point an icon, or none of them" });
    checkFullList(s.items, "text", 24, ctx, "point");
  });
type Slots = z.infer<typeof Slots>;

const css = (ctx: SceneContext<Slots>, o: { gapHead: string; gapItems: string; icon: number; iconPad: number; barW: string }) => {
  const id = `#${ctx.sceneId}`;
  return `
${id} .content{display:flex;flex-direction:column;justify-content:center}
${id} .bar{width:${o.barW};height:var(--sp-1);background:var(--light-accent);margin-bottom:var(--sp-4)}
${id} .kicker{color:var(--light-accent);margin-bottom:var(--sp-2)}
${id} .items{list-style:none;display:flex;flex-direction:column;gap:${o.gapItems};margin-top:${o.gapHead}}
${id} .item{display:flex;align-items:center;gap:var(--sp-4)}
${id} .item .dot{color:var(--light-accent)}
${id} .item .ic{flex:none;width:${o.icon}px;height:${o.icon}px;border-radius:50%;background:var(--tint-bg);color:var(--light-accent);padding:${o.iconPad}px}
${id} .item-text{flex:1;min-width:0}`;
};

export const points: SceneDefinition<Slots> = {
  type: "points",
  label: "Points",
  description:
    "A short heading and 2 to 4 points, each with an optional icon. Use it for steps, options, or what changes. Heading up to 48 characters, each point up to 40, or 24 when there are 4 points (shorter reads better). Give every point an icon or none.",
  beats: ["message", "problem", "insight", "proof", "summary", "action"],
  surface: "light",
  slots: Slots,
  text: [
    { slot: "kicker", maxChars: 28, maxLines: { "16x9": 1, "9x16": 1, "1x1": 1 } },
    { slot: "heading", maxChars: 48, maxLines: { "16x9": 2, "9x16": 3, "1x1": 3 } },
    { slot: "items", maxChars: 40, maxCharsWhenFull: 24, maxLines: { "16x9": 1, "9x16": 2, "1x1": 2 } },
  ],
  sample: {
    heading: "Three ways to check your bin day",
    items: [
      { text: "Online at northvale.example/bins", icon: { icon: "globe" } },
      { text: "On the Northvale app", icon: { icon: "device-mobile" } },
      { text: "Call us on 0300 555 0199", icon: { icon: "phone" } },
    ],
  },
  elements: (s) => [
    { id: "bar", entrance: "fade" },
    ...(s.kicker ? [{ id: "kicker", entrance: "riseSmall" as const, slot: "kicker" }] : []),
    { id: "heading", entrance: "rise", slot: "heading" },
    ...s.items.map((it, i) => ({ id: `item${i + 1}`, entrance: "rise" as const, slot: "items", text: it.text })),
  ],
  markup: (ctx) => {
    const s = ctx.slots;
    const id = ctx.sceneId;
    const items = s.items
      .map(
        (it, i) =>
          `<li class="item anim" id="${id}-item${i + 1}">${it.icon ? `<span class="ic">${ctx.icon(it.icon)}</span>` : DOT}<span class="item-text t-body" data-fit="items">${ctx.esc(it.text)}</span></li>`,
      )
      .join("");
    return `
<div class="content">
  <div class="bar anim" id="${id}-bar"></div>
  ${s.kicker ? `<p class="kicker t-label anim" id="${id}-kicker" data-fit="kicker">${ctx.esc(s.kicker)}</p>` : ""}
  <h2 class="heading t-heading anim" id="${id}-heading" data-fit="heading">${ctx.rich(s.heading, s.emphasis)}</h2>
  <ul class="items">${items}</ul>
</div>`;
  },
  layouts: {
    "16x9": (ctx) => css(ctx, { gapHead: "var(--sp-7)", gapItems: "var(--sp-4)", icon: 104, iconPad: 9, barW: "var(--sp-12)" }) + `\n#${ctx.sceneId} .content>*{max-width:1400px}`,
    "9x16": (ctx) => css(ctx, { gapHead: "var(--sp-8)", gapItems: "var(--sp-6)", icon: 124, iconPad: 11, barW: "var(--sp-12)" }),
    "1x1": (ctx) => css(ctx, { gapHead: "var(--sp-4)", gapItems: "var(--sp-2)", icon: 84, iconPad: 7, barW: "var(--sp-10)" }) + `\n#${ctx.sceneId} .bar{margin-bottom:var(--sp-3)}`,
  },
};
