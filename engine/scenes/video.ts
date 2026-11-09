// Video clip scene: a muted clip with an optional short line of text.
// When the clip is sharp enough to fill the frame, it does, and the text sits on a solid brand panel over it.
// When filling the frame would enlarge it too much (a landscape clip in portrait), the clip sits in a box at the
// top and the text sits below it on the brand background. Either way text keeps AAA contrast.
// The compiler places the clip itself as a timed video (HyperFrames times video only at the top level).
import { z } from "zod";
import type { SceneDefinition, SceneContext, Rect } from "./types";
import { textField, emphasisField, checkEmphasis, photoCss } from "./common";
import { ClipRef, coverPlacement, ENLARGE_WARN } from "../media";
import { panelCss, panelMarkup, panelComposition } from "./photo";

const Slots = z
  .object({
    clip: ClipRef,
    text: textField(48).optional(),
    emphasis: emphasisField,
  })
  .strict()
  .superRefine((s, ctx) => checkEmphasis(s, ["text"], ctx));
type Slots = z.infer<typeof Slots>;

/** Full frame when the clip stays sharp, otherwise a box across the top. */
function place(ctx: SceneContext<Slots>): { rect: Rect; above: boolean } {
  const f = ctx.format;
  const full: Rect = { x: 0, y: 0, w: f.width, h: f.height };
  const m = ctx.clip(ctx.slots.clip);
  if (!m || coverPlacement(m, f.width, f.height).enlargement <= ENLARGE_WARN) return { rect: full, above: false };
  // A box across the top, as tall as the clip allows without enlarging it, between 40% and 45% of the frame.
  const h = Math.round(Math.min(f.height * 0.45, Math.max(f.height * 0.4, m.height)) / 8) * 8;
  const rect: Rect = { x: 0, y: 0, w: f.width, h };
  return { rect, above: true };
}

const layout = (ctx: SceneContext<Slots>, maxWidth: string, pad: string, textSize?: string) => {
  const id = `#${ctx.sceneId}`;
  const m = ctx.clip(ctx.slots.clip);
  const { rect, above } = place(ctx);
  const fit = photoCss(ctx, m, { w: rect.w, h: rect.h }, ctx.slots.clip.src);
  const c = ctx.content;
  const gap = Math.round(48 * ctx.format.typeMultiplier);
  const box = `${id} .media-box{left:${rect.x}px;top:${rect.y}px;width:${rect.w}px;height:${rect.h}px}`;
  // Full frame: the panel goes to the side and edge away from the clip's focal point (the crop stays centred
  // on it, as the compiler places the clip itself).
  if (!above) return `${id} .scene-inner{background:transparent}\n${box}\n${fit}\n${panelCss(ctx, maxWidth, pad, textSize, panelComposition(m, ctx.format, !!ctx.slots.text).place)}`;
  // Boxed: the text area starts below the clip.
  const top = Math.max(c.y, rect.y + rect.h + gap);
  return `${box}\n${fit}\n${panelCss(ctx, "100%", "0", textSize)}
${id} .content{top:${top}px;height:${c.y + c.h - top}px;justify-content:flex-start}`;
};

export const video: SceneDefinition<Slots> = {
  type: "video",
  label: "Video clip",
  description:
    "A short muted clip, with an optional short line of text. Use it to show a place or service in action. The clip must be in the brand's media folder and last at least as long as the scene from its start point. Text up to 48 characters.",
  beats: ["hook", "problem", "message", "insight", "proof", "summary"],
  surface: "dark",
  media: true,
  slots: Slots,
  text: [{ slot: "text", maxChars: 48, maxLines: { "16x9": 2, "9x16": 4, "1x1": 3 } }],
  sample: {
    clip: { src: "river-canyon.mp4", start: 1 },
    text: "Help us keep our rivers clean",
  },
  clip: (s) => s.clip,
  clipLayout: (ctx) => place(ctx),
  elements: (s) => (s.text ? [{ id: "panel", entrance: "rise", slot: "text" }] : []),
  markup: (ctx) => {
    const m = ctx.clip(ctx.slots.clip);
    const poster = ctx.still && m?.posterAsset ? `<div class="media-box" aria-hidden="true"><img class="photo" src="${m.posterAsset}" alt=""></div>` : "";
    return `
${poster}
<div class="content">${panelMarkup(ctx)}</div>`;
  },
  layouts: {
    "16x9": (ctx) => layout(ctx, "1400px", "var(--sp-5) var(--sp-6) var(--sp-6)"),
    "9x16": (ctx) => layout(ctx, "100%", "var(--sp-5) var(--sp-5) var(--sp-6)", "calc(var(--t-heading) * 0.85)"),
    "1x1": (ctx) => layout(ctx, "100%", "var(--sp-4) var(--sp-5) var(--sp-5)"),
  },
};
