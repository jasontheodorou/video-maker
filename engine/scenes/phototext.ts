// Photo with text scene: a photo beside (landscape) or above (portrait and square) a heading and a line of text,
// on a light background. Text never sits on the photo, so it keeps AAA contrast.
import { z } from "zod";
import type { SceneDefinition, SceneContext, Rect } from "./types";
import { textField, emphasisField, checkEmphasis, photoMarkup, photoCss } from "./common";
import { PhotoRef } from "../media";

const Slots = z
  .object({
    photo: PhotoRef,
    heading: textField(42),
    text: textField(90).optional(),
    emphasis: emphasisField,
  })
  .strict()
  .superRefine((s, ctx) => checkEmphasis(s, ["heading"], ctx));
type Slots = z.infer<typeof Slots>;

/** The photo's box in each format. */
function photoRect(ctx: SceneContext<Slots>): Rect {
  const f = ctx.format;
  if (f.id === "16x9") {
    const w = Math.round(f.width * 0.44);
    return { x: f.width - w, y: 0, w, h: f.height };
  }
  if (f.id === "9x16") return { x: 0, y: 0, w: f.width, h: Math.round(f.height * 0.28) };
  return { x: 0, y: 0, w: f.width, h: Math.round(f.height * 0.3) };
}

const layout = (ctx: SceneContext<Slots>, o: { heading: string; gap: string }) => {
  const id = `#${ctx.sceneId}`;
  const r = photoRect(ctx);
  const c = ctx.content;
  const f = ctx.format;
  const fit = photoCss(ctx, ctx.photo(ctx.slots.photo), { w: r.w, h: r.h }, ctx.slots.photo.src);
  const box = `${id} .media-box{left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px}`;
  let area: string;
  if (f.id === "16x9") {
    // Text column on the left, one margin clear of the photo.
    const right = r.x - Math.round(96 * f.typeMultiplier);
    area = `${id} .content{display:flex;flex-direction:column;justify-content:center}\n${id} .copy{width:${right - c.x}px}`;
  } else {
    const top = r.y + r.h + Math.round(56 * f.typeMultiplier);
    area = `${id} .content{top:${top}px;height:${c.y + c.h - top}px;display:flex;flex-direction:column;justify-content:center}\n${id} .copy{width:100%}`;
  }
  return `${box}
${fit}
${area}
${id} .bar{width:var(--sp-12);height:var(--sp-1);background:var(--light-accent);margin-bottom:var(--sp-4)}
${id} .heading{font-size:${o.heading}}
${id} .text{margin-top:${o.gap}}`;
};

export const phototext: SceneDefinition<Slots> = {
  type: "photo-text",
  label: "Photo with text",
  description:
    "A photo beside a heading and an optional line of text. Use it when a picture helps explain the message. Heading up to 42 characters, text up to 90. The photo must be in the brand's media folder; add a focus point [x, y] (0 to 1) if the subject is not in the middle.",
  beats: ["problem", "message", "insight", "proof", "summary"],
  surface: "light",
  media: true,
  slots: Slots,
  text: [
    { slot: "heading", maxChars: 42, maxLines: { "16x9": 3, "9x16": 3, "1x1": 2 } },
    { slot: "text", maxChars: 90, maxLines: { "16x9": 3, "9x16": 4, "1x1": 3 } },
  ],
  sample: {
    photo: { src: "library-reading-room.jpg" },
    heading: "Your library card is free",
    text: "Join at any Northvale library. Bring proof of your address.",
  },
  elements: (s) => [
    { id: "bar", entrance: "fade" },
    { id: "heading", entrance: "rise", slot: "heading" },
    ...(s.text ? [{ id: "text", entrance: "rise" as const, slot: "text" }] : []),
  ],
  markup: (ctx) => {
    const s = ctx.slots;
    const id = ctx.sceneId;
    const m = ctx.photo(s.photo);
    return `
${m ? photoMarkup(id, m.asset) : ""}
<div class="content">
  <div class="copy">
    <div class="bar anim" id="${id}-bar"></div>
    <h2 class="heading t-heading anim" id="${id}-heading" data-fit="heading">${ctx.rich(s.heading, s.emphasis)}</h2>
    ${s.text ? `<p class="text t-body anim" id="${id}-text" data-fit="text">${ctx.esc(s.text)}</p>` : ""}
  </div>
</div>`;
  },
  layouts: {
    "16x9": (ctx) => layout(ctx, { heading: "var(--t-heading)", gap: "var(--sp-5)" }),
    "9x16": (ctx) => layout(ctx, { heading: "var(--t-heading)", gap: "var(--sp-5)" }),
    "1x1": (ctx) => layout(ctx, { heading: "calc(var(--t-heading) * 0.8)", gap: "var(--sp-3)" }),
  },
};
