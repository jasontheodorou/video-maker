// The contract every scene type follows. See docs/CONTRACTS.md, "How to add a scene".
import type { z } from "zod";
import type { FormatConfig, FormatId } from "../config";
import type { LoadedBrand } from "../brand";
import type { EntranceName } from "../motion";
import type { Beat, IconRef, SurfaceId } from "../schema";
import type { ClipRef, PhotoRef, ResolvedMedia } from "../media";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Fit limits for one text slot. The strictest format's maxChars applies to the spec. */
export interface TextSlot {
  slot: string;
  /** Hard character limit, checked by the spec schema before anything renders. */
  maxChars: number;
  /** Most lines allowed in each format, checked with the real font by the lint step. */
  maxLines: Record<FormatId, number>;
  /** List slots only: a lower limit for each item when the list has its most items (4), so it still fits. */
  maxCharsWhenFull?: number;
}

/** An element that animates in. Order sets the 60 ms stagger. Text elements name their slot. */
export interface SceneElement {
  /** Element id suffix. The full DOM id is `${sceneId}-${id}`. */
  id: string;
  entrance: EntranceName;
  /** Text slot this element shows, for the reading-time rule. */
  slot?: string;
  /**
   * The text this element shows, when the slot is not a plain string (for example one item of a list,
   * with slot "items"). The reading-time rule counts these words.
   */
  text?: string;
}

export interface SceneContext<S> {
  sceneId: string;
  format: FormatConfig;
  /** Where content may go: inside the safe area and above the caption band. */
  content: Rect;
  brand: LoadedBrand;
  slots: S;
  /** Escape plain text. */
  esc(text: string): string;
  /** Escape text and wrap emphasised words in <span class="em">. */
  rich(text: string, emphasis?: string[]): string;
  /** Inline SVG for an icon reference. Records a lint error when it cannot be found. */
  icon(ref: IconRef): string;
  /** URL of a brand logo inside the build. */
  logo(variant: "onLight" | "onDark"): string;
  /** A photo from the brand's media folder, copied into the build. Null (and a lint error) when it cannot be used. */
  photo(ref: PhotoRef): ResolvedMedia | null;
  /** A video clip from the brand's media folder. Null (and a lint error) when it cannot be used. */
  clip(ref: ClipRef): ResolvedMedia | null;
  /** True when compiling a settled still (previews and checks), false for the video. */
  still: boolean;
  /** Record a problem found while laying out (for example a photo too small for its box). */
  issue(level: "error" | "warning", message: string): void;
}

export interface SceneDefinition<S extends Record<string, unknown> = Record<string, unknown>> {
  /** The name used in spec.json, such as "title". Lower case. */
  type: string;
  label: string;
  /** One or two sentences for the brief interpreter: when to use this scene. */
  description: string;
  /** Story beats this scene suits. */
  beats: Beat[];
  /** Brand surface the scene sits on: dark, light or tint. */
  surface: SurfaceId;
  /** True when the scene shows a photo or video. Such scenes always crossfade (engine/transitions.ts). */
  media?: boolean;
  /**
   * For a video scene: the clip that fills the frame behind the scene. The compiler places it as a
   * top-level timed video under the scene (HyperFrames times video only at the top level) and fades it
   * with the scene. In stills, a frame from the clip is shown instead.
   */
  clip?(slots: S): ClipRef | undefined;
  /**
   * Where the clip sits in this format, and whether it sits above the scene (boxed, with text beside it on the
   * scene's own background) or below it (full frame, with the scene see-through and text on a solid panel).
   */
  clipLayout?(ctx: SceneContext<S>): { rect: Rect; above: boolean };
  /** Zod schema for the scene's slots. Must be strict. */
  slots: z.ZodType<S>;
  /** Fit limits for every text slot. */
  text: TextSlot[];
  /** Sample content, used for brand previews and tests. */
  sample: S;
  /** Elements in entrance order. Return only the ones present for these slots. */
  elements(slots: S): SceneElement[];
  /** Markup. The same markup is used in every format. Ids are `${ctx.sceneId}-<element id>`. */
  markup(ctx: SceneContext<S>): string;
  /** One hand-designed layout per format. Return CSS scoped to `#${ctx.sceneId}`. Use only var(--token) values. */
  layouts: Record<FormatId, (ctx: SceneContext<S>) => string>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyScene = SceneDefinition<any>;
