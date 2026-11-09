// End card: the logo, one call to action, and where to do it (a web address or phone number).
import { z } from "zod";
import type { SceneDefinition } from "./types";
import { textField, emphasisField, checkEmphasis, unbreakableLink } from "./common";

const Slots = z
  .object({
    action: textField(54),
    link: textField(30).optional(),
    detail: textField(52).optional(),
    emphasis: emphasisField,
  })
  .strict()
  .superRefine((s, ctx) => checkEmphasis(s, ["action"], ctx));
type Slots = z.infer<typeof Slots>;

export const endcard: SceneDefinition<Slots> = {
  type: "end",
  label: "End card",
  description: "Closing card with the logo, one call to action and a web address or phone number. Always the last scene. Action up to 54 characters, web address up to 30, detail up to 52.",
  beats: ["action"],
  surface: "dark",
  slots: Slots,
  text: [
    { slot: "action", maxChars: 54, maxLines: { "16x9": 2, "9x16": 4, "1x1": 3 } },
    { slot: "link", maxChars: 30, maxLines: { "16x9": 1, "9x16": 2, "1x1": 1 } },
    { slot: "detail", maxChars: 52, maxLines: { "16x9": 1, "9x16": 2, "1x1": 2 } },
  ],
  sample: {
    action: "Check your new collection day online",
    link: "example.org/garden-waste",
    detail: "Or call 0300 555 0199",
  },
  elements: (s) => [
    { id: "logo", entrance: "fadeLong" },
    { id: "action", entrance: "rise", slot: "action" },
    ...(s.link ? [{ id: "link", entrance: "riseSmall" as const, slot: "link" }] : []),
    ...(s.detail ? [{ id: "detail", entrance: "riseSmall" as const, slot: "detail" }] : []),
  ],
  markup: (ctx) => {
    const s = ctx.slots;
    const id = ctx.sceneId;
    return `
<div class="content">
  <div class="stack">
    <div class="logo anim" id="${id}-logo"><img src="${ctx.logo("onDark")}" alt="${ctx.esc(ctx.brand.brand.logo.alt)}"></div>
    <p class="action t-heading anim" id="${id}-action" data-fit="action">${ctx.rich(s.action, s.emphasis)}</p>
    ${s.link ? `<p class="link t-body anim" id="${id}-link" data-fit="link"><span>${unbreakableLink(s.link, ctx.esc)}</span></p>` : ""}
    ${s.detail ? `<p class="detail t-body anim" id="${id}-detail" data-fit="detail">${ctx.esc(s.detail)}</p>` : ""}
  </div>
</div>`;
  },
  layouts: {
    "16x9": (ctx) => `
#${ctx.sceneId} .content{display:flex;align-items:center;justify-content:center;text-align:center}
#${ctx.sceneId} .stack p{text-wrap:balance}
#${ctx.sceneId} .stack{display:flex;flex-direction:column;align-items:center;max-width:1400px}
#${ctx.sceneId} .logo img{height:calc(var(--logo-h) * 1.5);width:auto;display:block}
#${ctx.sceneId} .action{margin-top:var(--sp-10)}
#${ctx.sceneId} .link{margin-top:var(--sp-5);color:var(--dark-accent);font-weight:var(--weight-heading)}
#${ctx.sceneId} .link span{border-bottom:var(--sp-1) solid var(--dark-accent);padding-bottom:4px}
#${ctx.sceneId} .detail{margin-top:var(--sp-4)}`,
    "9x16": (ctx) => `
#${ctx.sceneId} .content{display:flex;align-items:center;justify-content:center;text-align:center}
#${ctx.sceneId} .stack p{text-wrap:balance}
#${ctx.sceneId} .stack{display:flex;flex-direction:column;align-items:center;width:100%}
#${ctx.sceneId} .logo img{height:calc(var(--logo-h) * 1.5);width:auto;display:block}
#${ctx.sceneId} .action{margin-top:var(--sp-12)}
#${ctx.sceneId} .link{margin-top:var(--sp-6);color:var(--dark-accent);font-weight:var(--weight-heading)}
#${ctx.sceneId} .link span{border-bottom:var(--sp-1) solid var(--dark-accent);padding-bottom:4px}
#${ctx.sceneId} .detail{margin-top:var(--sp-5)}`,
    "1x1": (ctx) => `
#${ctx.sceneId} .content{display:flex;align-items:center;justify-content:center;text-align:center}
#${ctx.sceneId} .stack p{text-wrap:balance}
#${ctx.sceneId} .stack{display:flex;flex-direction:column;align-items:center;width:100%}
#${ctx.sceneId} .logo img{height:calc(var(--logo-h) * 1.3);width:auto;display:block}
#${ctx.sceneId} .action{margin-top:var(--sp-8)}
#${ctx.sceneId} .link{margin-top:var(--sp-4);color:var(--dark-accent);font-weight:var(--weight-heading)}
#${ctx.sceneId} .link span{border-bottom:var(--sp-1) solid var(--dark-accent);padding-bottom:4px}
#${ctx.sceneId} .detail{margin-top:var(--sp-3)}`,
  },
};
