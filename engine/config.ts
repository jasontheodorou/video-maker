// Loads and validates config/engine.json. Every timing, target length and format comes from here.
import fs from "node:fs";
import { z } from "zod";
import { CONFIG_FILE } from "./paths";

export const FORMAT_IDS = ["16x9", "9x16", "1x1"] as const;
export type FormatId = (typeof FORMAT_IDS)[number];
export const SIZE_IDS = ["short", "medium", "long"] as const;
export type SizeId = (typeof SIZE_IDS)[number];

const Margins = z.object({ top: z.number(), right: z.number(), bottom: z.number(), left: z.number() });

const FormatConfig = z.object({
  label: z.string(),
  width: z.number().int(),
  height: z.number().int(),
  typeMultiplier: z.number().positive(),
  safe: Margins,
  captionBand: z.number(),
  captionGap: z.number(),
  captionMaxWidth: z.number(),
});
export type FormatConfig = z.infer<typeof FormatConfig> & { id: FormatId };

const SizeConfig = z.object({
  minSeconds: z.number().positive(),
  maxSeconds: z.number().positive(),
  beats: z.array(z.string()),
});

const SizeRule = z.object({
  id: z.string(),
  when: z.object({
    stepsAtLeast: z.number().optional(),
    keyMessagesAtLeast: z.number().optional(),
    purposeIn: z.array(z.string()).optional(),
    channelIn: z.array(z.string()).optional(),
  }),
  size: z.enum(SIZE_IDS),
  reason: z.string(),
});
export type SizeRule = z.infer<typeof SizeRule>;

export const EngineConfigSchema = z.object({
  fps: z.union([z.literal(30), z.literal(60)]),
  draftFps: z.number().int(),
  timeGrid: z.number().int(),
  sizes: z.object({ short: SizeConfig, medium: SizeConfig, long: SizeConfig }),
  sizeRules: z.array(SizeRule).min(1),
  channelCaps: z.record(z.string(), z.enum(SIZE_IDS)),
  voice: z.object({
    default: z.string(),
    british: z.array(z.string()),
    wordsPerSecond: z.number().positive(),
    budgetFactor: z.number().positive(),
    phraseGap: z.number().min(0),
  }),
  timing: z.object({
    firstLeadIn: z.number().min(0),
    leadIn: z.number().min(0),
    hold: z.number().min(0),
    endHold: z.number().min(0),
    crossfade: z.number().min(0.2).max(1.0),
    /** Length of a soft wipe (engine/transitions.ts). Longer than a crossfade so the edge moves calmly. */
    wipe: z.number().min(0.3).max(1.2).default(0.8),
    /**
     * The cut between a dark and a light text scene: "crossfade" (default, as the motion rules ask) or "wipe"
     * (a soft wipe; its visible edge crosses the frame in about 0.3 s, so it reads as fast).
     */
    darkLightTransition: z.enum(["crossfade", "wipe"]).default("crossfade"),
    enterDelay: z.number().min(0),
    firstEnterDelay: z.number().min(0),
    minSceneSeconds: z.number().positive(),
  }),
  reading: z.object({ minSeconds: z.number(), wordsPerSecond: z.number(), extraSeconds: z.number() }),
  captions: z.object({
    maxWords: z.number().int().min(2).max(8),
    /** Most characters in one caption chunk (spaces included), so a chunk fits two lines in portrait. */
    maxChars: z.number().int().min(16).max(80).default(40),
    maxLines: z.number().int().min(1).max(2),
    /** Least time each chunk is fully visible (after its fade in, before its fade out). */
    minSeconds: z.number(),
    /** Gaps shorter than this between chunks are closed, so a caption never blinks off and on. */
    closeGap: z.number().min(0).max(1).default(0.35),
    /** A chunk may move at most this far from its words (seconds) to stay readable. Further is reported. */
    maxShift: z.number().min(0).max(2).default(0.6),
    tail: z.number(),
    fade: z.number(),
    gapForFade: z.number(),
  }),
  formats: z.object({ "16x9": FormatConfig, "9x16": FormatConfig, "1x1": FormatConfig }),
  minimumTextPx: z.object({ body: z.number(), caption: z.number() }),
  render: z.object({ finalQuality: z.string(), draftQuality: z.string(), workers: z.union([z.string(), z.number()]) }),
});
export type EngineConfig = z.infer<typeof EngineConfigSchema>;

let cached: EngineConfig | null = null;

export function loadConfig(fresh = false): EngineConfig {
  if (cached && !fresh) return cached;
  const raw = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
  delete raw.$comment;
  const parsed = EngineConfigSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`config/engine.json is not valid:\n${z.prettifyError(parsed.error)}`);
  }
  cached = parsed.data;
  return cached;
}

export function getFormat(id: FormatId, config = loadConfig()): FormatConfig {
  return { ...config.formats[id], id };
}

/** The reading-time rule: seconds a text element must stay fully visible. */
export function readingSeconds(words: number, config = loadConfig()): number {
  const r = config.reading;
  return Math.max(r.minSeconds, words / r.wordsPerSecond + r.extraSeconds);
}

/** Round a time up to the engine's time grid (whole frames at both 30 and 60 fps). */
export function ceilToGrid(t: number, config = loadConfig()): number {
  const g = config.timeGrid;
  return Math.ceil(t * g - 1e-6) / g;
}
export function roundToGrid(t: number, config = loadConfig()): number {
  const g = config.timeGrid;
  return Math.round(t * g) / g;
}
