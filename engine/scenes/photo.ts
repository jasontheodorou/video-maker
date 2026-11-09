// Full photo scene: a photo fills the frame, with an optional short line of text on a solid brand panel.
// The panel is fully opaque, so text keeps AAA contrast whatever the photo shows.
import { z } from "zod";
import type { SceneDefinition, SceneContext } from "./types";
import { textField, emphasisField, checkEmphasis, photoMarkup, photoCss } from "./common";
import { DRIFT } from "../motion";
import { PhotoRef, coverPlacement } from "../media";

const Slots = z
  .object({
    photo: PhotoRef,
    text: textField(48).optional(),
    emphasis: emphasisField,
  })
  .strict()
  .superRefine((s, ctx) => checkEmphasis(s, ["text"], ctx));
type Slots = z.infer<typeof Slots>;

/** Where the text panel sits inside the content area. */
export interface PanelPlace {
  edge: "top" | "bottom";
  side: "left" | "right";
}

/** The text panel used over photos and video. Shared with the video scene. */
export function panelCss(ctx: { sceneId: string }, maxWidth: string, pad: string, textSize = "var(--t-heading)", place: PanelPlace = { edge: "bottom", side: "left" }): string {
  const id = `#${ctx.sceneId}`;
  return `
${id} .content{display:flex;flex-direction:column;justify-content:${place.edge === "top" ? "flex-start" : "flex-end"};align-items:${place.side === "right" ? "flex-end" : "flex-start"}}
${id} .panel{background:var(--dark-bg);color:var(--dark-text);padding:${pad};border-radius:var(--radius);max-width:${maxWidth}}
${id} .panel .bar{width:var(--sp-10);height:var(--sp-1);background:var(--dark-accent);margin-bottom:var(--sp-3)}
${id} .panel .text{font-size:${textSize}}`;
}

export function panelMarkup(ctx: SceneContext<{ text?: string; emphasis?: string[] }>): string {
  const s = ctx.slots;
  const id = ctx.sceneId;
  if (!s.text) return "";
  return `<div class="panel anim" id="${id}-panel"><div class="bar"></div><p class="text t-heading" data-fit="text">${ctx.rich(s.text, s.emphasis)}</p></div>`;
}

/**
 * Keep the panel off the subject. The panel goes to the side and edge away from where the photo's focal
 * point naturally falls, and the crop then moves the focal point further away from the panel (towards the
 * opposite third), as far as the photo allows. Captions sit at the bottom, so a low subject sends the panel
 * to the top and lifts the subject above the caption band where it can.
 */
export function panelComposition(
  media: { width: number; height: number; focus: [number, number] } | null,
  format: { width: number; height: number },
  hasText: boolean,
): { place: PanelPlace; aim: [number, number] } {
  if (!media || !hasText) return { place: { edge: "bottom", side: "left" }, aim: [0.5, 0.5] };
  const natural = coverPlacement(media, format.width, format.height, DRIFT.scale).focusAt;
  const landscape = format.width > format.height;
  const side: PanelPlace["side"] = landscape && natural[0] < 0.5 ? "right" : "left";
  // People and objects extend below their focus point (legs, a dog, a bin's wheels), so in portrait and square a
  // subject near the middle gets the panel above it, leaving the room below clear.
  const edge: PanelPlace["edge"] = natural[1] > (landscape ? 0.5 : 0.45) ? "top" : "bottom";
  // Aim the focal point at the middle of the picture left clear of the panel and the caption band. A focus point
  // marks the middle of the subject, and people extend below it (legs, a dog), so in square the aim sits well
  // clear of the panel: about a quarter of the way down under a bottom panel, and lower under a top one.
  const square = format.width === format.height;
  const aimY = edge === "bottom" ? (landscape || !square ? 0.38 : 0.24) : landscape ? 0.6 : square ? 0.63 : 0.55;
  const aim: [number, number] = [landscape ? (side === "right" ? 0.3 : 0.7) : 0.5, aimY];
  return { place: { edge, side }, aim };
}

const compose = (ctx: SceneContext<Slots>) => panelComposition(ctx.photo(ctx.slots.photo), ctx.format, !!ctx.slots.text);
const full = (ctx: SceneContext<Slots>) => photoCss(ctx, ctx.photo(ctx.slots.photo), { w: ctx.format.width, h: ctx.format.height }, ctx.slots.photo.src, ".photo", compose(ctx).aim);

export const photo: SceneDefinition<Slots> = {
  type: "photo",
  label: "Full photo",
  description:
    "A photo fills the frame, with an optional short line of text on a solid panel. Use it to show a real place, service or people. Text up to 48 characters. The photo must be in the brand's media folder; add a focus point [x, y] (0 to 1) if the subject is not in the middle.",
  beats: ["hook", "problem", "message", "insight", "proof", "summary"],
  surface: "dark",
  media: true,
  slots: Slots,
  text: [{ slot: "text", maxChars: 48, maxLines: { "16x9": 3, "9x16": 4, "1x1": 3 } }],
  sample: {
    photo: { src: "park-trail.jpg" },
    text: "Our parks are open every day",
  },
  elements: (s) => (s.text ? [{ id: "panel", entrance: "rise", slot: "text" }] : []),
  markup: (ctx) => {
    const m = ctx.photo(ctx.slots.photo);
    return `
${m ? photoMarkup(ctx.sceneId, m.asset) : ""}
<div class="content">${panelMarkup(ctx)}</div>`;
  },
  layouts: {
    // Landscape: a panel narrow enough to sit to one side, away from the subject.
    "16x9": (ctx) => `#${ctx.sceneId} .media-box{inset:0}\n${full(ctx)}\n${panelCss(ctx, "1000px", "var(--sp-5) var(--sp-6) var(--sp-6)", undefined, compose(ctx).place)}`,
    "9x16": (ctx) => `#${ctx.sceneId} .media-box{inset:0}\n${full(ctx)}\n${panelCss(ctx, "100%", "var(--sp-5) var(--sp-5) var(--sp-6)", "calc(var(--t-heading) * 0.85)", compose(ctx).place)}`,
    "1x1": (ctx) => `#${ctx.sceneId} .media-box{inset:0}\n${full(ctx)}\n${panelCss(ctx, "100%", "var(--sp-4) var(--sp-5) var(--sp-5)", undefined, compose(ctx).place)}`,
  },
};
