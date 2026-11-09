// Quote scene: words from a real person, with their name and role. On the tint background.
import { z } from "zod";
import type { SceneDefinition, SceneContext } from "./types";
import { textField, emphasisField, checkEmphasis, QUOTE_MARK_SVG } from "./common";

const Slots = z
  .object({
    quote: textField(104).refine((q) => !/^["'“‘]|["'”’]$/.test(q), "Leave out the quotation marks. The engine adds them."),
    name: textField(36),
    role: textField(50).optional(),
    emphasis: emphasisField,
  })
  .strict()
  .superRefine((s, ctx) => checkEmphasis(s, ["quote"], ctx));
type Slots = z.infer<typeof Slots>;

const css = (ctx: SceneContext<Slots>, o: { mark: number; layout: "side" | "top"; quote: string; gap: string }) => {
  const id = `#${ctx.sceneId}`;
  const side = o.layout === "side";
  return `
${id} .content{display:flex;align-items:safe center}
${id} .q{display:flex;${side ? "flex-direction:row;gap:var(--sp-6);align-items:flex-start" : "flex-direction:column;gap:var(--sp-4)"};width:100%}
${id} .mark{flex:none;width:${o.mark}px;height:${Math.round(o.mark * 0.774)}px;color:var(--tint-accent)${side ? ";margin-top:var(--sp-2)" : ""}}
${id} .body{flex:1;min-width:0;max-width:1480px}
${id} .quote{font-size:${o.quote}}
${id} .name{margin-top:${o.gap};font-weight:var(--weight-heading)}`;
};

export const quote: SceneDefinition<Slots> = {
  type: "quote",
  label: "Quote",
  description:
    "Words from a real person, such as a resident or a member of staff, with their name and role. Use it for proof. Quote up to 104 characters without quotation marks, name up to 36, role up to 50. Only quote what the person really said.",
  beats: ["proof", "insight", "problem", "summary"],
  surface: "tint",
  slots: Slots,
  text: [
    { slot: "quote", maxChars: 104, maxLines: { "16x9": 4, "9x16": 7, "1x1": 5 } },
    { slot: "name", maxChars: 36, maxLines: { "16x9": 1, "9x16": 2, "1x1": 2 } },
    { slot: "role", maxChars: 50, maxLines: { "16x9": 2, "9x16": 2, "1x1": 2 } },
  ],
  sample: {
    quote: "The new collection day was easy to find. It took me two minutes online.",
    name: "Priya Shah",
    role: "Resident, Eastbrook ward",
  },
  elements: (s) => [
    { id: "mark", entrance: "fade" },
    { id: "quote", entrance: "rise", slot: "quote" },
    { id: "name", entrance: "riseSmall", slot: "name" },
    ...(s.role ? [{ id: "role", entrance: "riseSmall" as const, slot: "role" }] : []),
  ],
  markup: (ctx) => {
    const s = ctx.slots;
    const id = ctx.sceneId;
    return `
<div class="content">
  <figure class="q">
    <div class="mark anim" id="${id}-mark">${QUOTE_MARK_SVG}</div>
    <div class="body">
      <blockquote class="quote t-heading anim" id="${id}-quote" data-fit="quote">${ctx.rich(s.quote, s.emphasis)}</blockquote>
      <figcaption>
        <p class="name t-body anim" id="${id}-name" data-fit="name">${ctx.esc(s.name)}</p>
        ${s.role ? `<p class="role t-body anim" id="${id}-role" data-fit="role">${ctx.esc(s.role)}</p>` : ""}
      </figcaption>
    </div>
  </figure>
</div>`;
  },
  layouts: {
    "16x9": (ctx) => css(ctx, { mark: 124, layout: "side", quote: "var(--t-heading)", gap: "var(--sp-6)" }),
    "9x16": (ctx) => css(ctx, { mark: 120, layout: "top", quote: "calc(var(--t-heading) * 0.85)", gap: "var(--sp-6)" }),
    "1x1": (ctx) => css(ctx, { mark: 72, layout: "top", quote: "calc(var(--t-heading) * 0.86)", gap: "var(--sp-3)" }),
  },
};
