// Stat scene: one big number with a label saying what it means, and where it comes from. On the tint background.
import { z } from "zod";
import type { SceneDefinition, SceneContext } from "./types";
import { textField } from "./common";

const Slots = z
  .object({
    kicker: textField(28).optional(),
    value: textField(8).refine((v) => /\d/.test(v), "The value must contain a number, such as 93% or 1 in 4"),
    label: textField(64),
    source: textField(70).optional(),
  })
  .strict();
type Slots = z.infer<typeof Slots>;

const css = (ctx: SceneContext<Slots>, o: { value: string; gap: string; align: "left" | "center" }) => {
  const id = `#${ctx.sceneId}`;
  const centre = o.align === "center";
  return `
${id} .content{display:flex;flex-direction:column;justify-content:center;${centre ? "align-items:center;text-align:center" : ""}}
${id} .bar{width:var(--sp-12);height:var(--sp-1);background:var(--tint-accent);margin-bottom:var(--sp-4)}
${id} .kicker{color:var(--tint-accent);margin-bottom:var(--sp-2)}
${id} .value{font-family:var(--font-heading);font-weight:var(--weight-heading);font-size:${o.value};line-height:1.05;letter-spacing:var(--ls-display);color:var(--tint-accent);white-space:nowrap;font-variant-numeric:lining-nums tabular-nums}
${id} .label{margin-top:${o.gap};font-size:calc(var(--t-heading) * 0.85)}
${id} .source{margin-top:var(--sp-5);font-weight:var(--weight-body)}`;
};

export const stat: SceneDefinition<Slots> = {
  type: "stat",
  label: "Stat",
  description:
    "One big number and what it means, such as 93% or 1 in 4, with an optional source. Use it for proof. Value up to 8 characters, label up to 64, source up to 70. Write the number as people say it.",
  beats: ["proof", "insight", "problem", "message", "summary"],
  surface: "tint",
  slots: Slots,
  text: [
    { slot: "kicker", maxChars: 28, maxLines: { "16x9": 1, "9x16": 1, "1x1": 1 } },
    { slot: "value", maxChars: 8, maxLines: { "16x9": 1, "9x16": 1, "1x1": 1 } },
    { slot: "label", maxChars: 64, maxLines: { "16x9": 2, "9x16": 4, "1x1": 3 } },
    { slot: "source", maxChars: 70, maxLines: { "16x9": 1, "9x16": 2, "1x1": 2 } },
  ],
  sample: {
    value: "3 in 4",
    label: "households already recycle their food waste",
    source: "Northvale resident survey, 2026",
  },
  elements: (s) => [
    { id: "bar", entrance: "fade" },
    ...(s.kicker ? [{ id: "kicker", entrance: "riseSmall" as const, slot: "kicker" }] : []),
    { id: "value", entrance: "riseLarge", slot: "value" },
    { id: "label", entrance: "rise", slot: "label" },
    ...(s.source ? [{ id: "source", entrance: "riseSmall" as const, slot: "source" }] : []),
  ],
  markup: (ctx) => {
    const s = ctx.slots;
    const id = ctx.sceneId;
    return `
<div class="content">
  <div class="bar anim" id="${id}-bar"></div>
  ${s.kicker ? `<p class="kicker t-label anim" id="${id}-kicker" data-fit="kicker">${ctx.esc(s.kicker)}</p>` : ""}
  <p class="value anim" id="${id}-value" data-fit="value">${ctx.esc(s.value)}</p>
  <p class="label t-heading anim" id="${id}-label" data-fit="label">${ctx.esc(s.label)}</p>
  ${s.source ? `<p class="source t-label anim" id="${id}-source" data-fit="source">${ctx.esc(s.source)}</p>` : ""}
</div>`;
  },
  layouts: {
    "16x9": (ctx) => css(ctx, { value: "calc(var(--t-display) * 2)", gap: "var(--sp-3)", align: "left" }),
    "9x16": (ctx) => css(ctx, { value: "calc(var(--t-display) * 1.25)", gap: "var(--sp-4)", align: "left" }),
    "1x1": (ctx) => css(ctx, { value: "calc(var(--t-display) * 1.6)", gap: "var(--sp-3)", align: "left" }),
  },
};
