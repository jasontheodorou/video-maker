// Title scene: the opening card. Logo, an optional eyebrow label, a large title and an optional subtitle.
import { z } from "zod";
import type { SceneDefinition } from "./types";
import { textField, emphasisField, checkEmphasis } from "./common";

const Slots = z
  .object({
    eyebrow: textField(40).optional(),
    title: textField(42),
    subtitle: textField(70).optional(),
    emphasis: emphasisField,
  })
  .strict()
  .superRefine((s, ctx) => checkEmphasis(s, ["title"], ctx));
type Slots = z.infer<typeof Slots>;

export const title: SceneDefinition<Slots> = {
  type: "title",
  label: "Title",
  description: "Opening card with the logo and a short headline. Use it for the hook. Title up to 42 characters, line under it up to 70.",
  beats: ["hook"],
  surface: "dark",
  slots: Slots,
  text: [
    { slot: "eyebrow", maxChars: 40, maxLines: { "16x9": 1, "9x16": 2, "1x1": 1 } },
    { slot: "title", maxChars: 42, maxLines: { "16x9": 3, "9x16": 5, "1x1": 4 } },
    { slot: "subtitle", maxChars: 70, maxLines: { "16x9": 2, "9x16": 4, "1x1": 3 } },
  ],
  sample: {
    eyebrow: "Waste and recycling",
    title: "Garden waste collections are changing",
    subtitle: "What you need to know before 3 March",
    emphasis: ["changing"],
  },
  elements: (s) => [
    { id: "logo", entrance: "fade" },
    { id: "bar", entrance: "fade" },
    ...(s.eyebrow ? [{ id: "eyebrow", entrance: "riseSmall" as const, slot: "eyebrow" }] : []),
    { id: "title", entrance: "riseLarge", slot: "title" },
    ...(s.subtitle ? [{ id: "subtitle", entrance: "rise" as const, slot: "subtitle" }] : []),
  ],
  markup: (ctx) => {
    const s = ctx.slots;
    const id = ctx.sceneId;
    return `
<div class="content">
  <div class="logo anim" id="${id}-logo"><img src="${ctx.logo("onDark")}" alt="${ctx.esc(ctx.brand.brand.logo.alt)}"></div>
  <div class="block">
    <div class="bar anim" id="${id}-bar"></div>
    ${s.eyebrow ? `<p class="eyebrow t-label anim" id="${id}-eyebrow" data-fit="eyebrow">${ctx.esc(s.eyebrow)}</p>` : ""}
    <h1 class="title t-display anim" id="${id}-title" data-fit="title">${ctx.rich(s.title, s.emphasis)}</h1>
    ${s.subtitle ? `<p class="subtitle t-body anim" id="${id}-subtitle" data-fit="subtitle">${ctx.esc(s.subtitle)}</p>` : ""}
  </div>
</div>`;
  },
  layouts: {
    "16x9": (ctx) => `
#${ctx.sceneId} .content{display:flex;flex-direction:column}
#${ctx.sceneId} .logo img{height:var(--logo-h);width:auto;display:block}
#${ctx.sceneId} .block{margin:auto 0;max-width:1632px;padding-top:var(--sp-5);padding-bottom:var(--sp-4)}
#${ctx.sceneId} .bar{width:var(--sp-12);height:var(--sp-1);background:var(--dark-accent);margin-bottom:var(--sp-5)}
#${ctx.sceneId} .eyebrow{color:var(--dark-accent);margin-bottom:var(--sp-3)}
#${ctx.sceneId} .subtitle{margin-top:var(--sp-5);max-width:1400px}`,
    "9x16": (ctx) => `
#${ctx.sceneId} .content{display:flex;flex-direction:column}
#${ctx.sceneId} .logo img{height:var(--logo-h);width:auto;display:block}
#${ctx.sceneId} .block{margin:auto 0;width:100%;padding-top:var(--sp-5)}
#${ctx.sceneId} .title{font-size:calc(var(--t-display) * 0.9)}
#${ctx.sceneId} .bar{width:var(--sp-12);height:var(--sp-1);background:var(--dark-accent);margin-bottom:var(--sp-5)}
#${ctx.sceneId} .eyebrow{color:var(--dark-accent);margin-bottom:var(--sp-3)}
#${ctx.sceneId} .subtitle{margin-top:var(--sp-6)}`,
    "1x1": (ctx) => `
#${ctx.sceneId} .content{display:flex;flex-direction:column}
#${ctx.sceneId} .logo img{height:var(--logo-h);width:auto;display:block}
#${ctx.sceneId} .block{margin:auto 0;width:100%;padding-top:var(--sp-3)}
#${ctx.sceneId} .title{font-size:calc(var(--t-display) * 0.85)}
#${ctx.sceneId} .bar{width:var(--sp-10);height:var(--sp-1);background:var(--dark-accent);margin-bottom:var(--sp-4)}
#${ctx.sceneId} .eyebrow{color:var(--dark-accent);margin-bottom:var(--sp-2)}
#${ctx.sceneId} .subtitle{margin-top:var(--sp-4)}`,
  },
};
