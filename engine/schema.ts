// Zod rules for brand.json, spec facts, icon references, timeline.json and decision.json.
// The spec schema itself is built in spec.ts from the scene registry, so new scenes extend it.
import { z } from "zod";
import { SIZE_IDS, FORMAT_IDS } from "./config";

// ---------- shared pieces ----------

export const HEX = z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Use a six-digit hex colour such as #0B3B60");
export const SLUG = z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/, "Use lower-case letters, numbers and hyphens");
export const RELATIVE_FILE = z
  .string()
  .min(1)
  .refine((p) => !p.startsWith("/") && !p.split(/[\\/]/).includes(".."), "Use a path inside the brand folder");

export const ICON_WEIGHTS = ["thin", "light", "regular", "bold", "fill", "duotone"] as const;
export type IconWeight = (typeof ICON_WEIGHTS)[number];

/** How a spec reserves an icon: { "icon": "recycle", "weight": "regular" }. */
export const IconRef = z
  .object({
    icon: SLUG,
    weight: z.enum(ICON_WEIGHTS).optional(),
  })
  .strict();
export type IconRef = z.infer<typeof IconRef>;

// ---------- brand.json ----------

export const COLOUR_ROLES = ["primary", "text", "background", "accent", "tint"] as const;
export const OPTIONAL_COLOUR_ROLES = ["accent2", "line"] as const;
export type ColourRole = (typeof COLOUR_ROLES)[number] | (typeof OPTIONAL_COLOUR_ROLES)[number];

export const SURFACE_IDS = ["dark", "light", "tint"] as const;
export type SurfaceId = (typeof SURFACE_IDS)[number];

const ColourName = z.string().regex(/^[a-zA-Z][a-zA-Z0-9]*$/, "Refer to a colour by its token name, such as primary");

const Surface = z
  .object({
    background: ColourName,
    text: ColourName,
    accent: ColourName,
  })
  .strict();

const FontFace = z
  .object({
    family: z.string().min(1).max(80),
    weight: z.number().int().min(100).max(900),
    style: z.enum(["normal", "italic"]).default("normal"),
    src: RELATIVE_FILE,
    unicodeRange: z.string().optional(),
  })
  .strict();

const FontRole = z.object({ family: z.string().min(1), weight: z.number().int().min(100).max(900) }).strict();

const ColourToken = z
  .object({
    value: HEX,
    name: z.string().max(40).optional(),
  })
  .strict();

export const BrandSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: SLUG,
    name: z.string().min(1).max(80),
    fictional: z.boolean().default(false),
    description: z.string().max(400).optional(),
    /** Token groups that are placeholders until the client confirms them. */
    provisional: z.array(z.string()).default([]),
    colours: z
      .object({
        primary: ColourToken,
        text: ColourToken,
        background: ColourToken,
        accent: ColourToken,
        tint: ColourToken,
        accent2: ColourToken.optional(),
        line: ColourToken.optional(),
      })
      .strict(),
    surfaces: z.object({ dark: Surface, light: Surface, tint: Surface }).strict(),
    fonts: z
      .object({
        heading: FontRole,
        body: FontRole,
        faces: z.array(FontFace).min(1),
      })
      .strict(),
    /** Type sizes in px for a 1920 x 1080 frame. The engine scales them per format and enforces minimums. */
    typeScale: z
      .object({
        display: z.number().min(60).max(200),
        heading: z.number().min(48).max(160),
        body: z.number().min(42).max(110),
        label: z.number().min(42).max(80),
        caption: z.number().min(42).max(80),
      })
      .strict(),
    lineHeight: z
      .object({
        display: z.number().min(0.95).max(1.6),
        heading: z.number().min(1.0).max(1.6),
        body: z.number().min(1.1).max(1.8),
      })
      .strict(),
    letterSpacing: z
      .object({ display: z.number().min(-0.05).max(0.1).default(0), heading: z.number().min(-0.05).max(0.1).default(0) })
      .strict()
      .default({ display: 0, heading: 0 }),
    /** Base spacing unit in px at 1080p. Layouts use multiples of it. */
    spacing: z.object({ unit: z.number().int().min(4).max(16) }).strict(),
    radius: z.number().min(0).max(48),
    logo: z
      .object({
        onLight: RELATIVE_FILE,
        onDark: RELATIVE_FILE,
        alt: z.string().min(1).max(120),
        /** Smallest logo height in px at 1080p the guidelines allow. */
        minHeight: z.number().min(24).max(240).default(56),
      })
      .strict(),
    icons: z
      .object({
        weight: z.enum(ICON_WEIGHTS).default("regular"),
        /** Folder of client icons. A file icons/<name>.svg overrides the library icon of that name. */
        dir: RELATIVE_FILE.default("icons"),
        /** Opacity of the light layer of duotone icons (the brand's secondary opacity). */
        duotoneOpacity: z.number().min(0.1).max(0.6).default(0.2),
        /** Colour token for the light layer of duotone icons. Default: the icon's own colour. */
        duotoneColour: ColourName.optional(),
      })
      .strict()
      .default({ weight: "regular", dir: "icons", duotoneOpacity: 0.2 }),
    graphics: z
      .object({ dir: RELATIVE_FILE.default("graphics") })
      .strict()
      .default({ dir: "graphics" }),
    captions: z
      .object({
        background: ColourName,
        text: ColourName,
        weight: z.number().int().min(400).max(800).default(400),
      })
      .strict(),
    voice: z
      .object({
        id: z.string().min(1),
        speed: z.number().min(0.8).max(1.2).default(1),
        lang: z.string().optional(),
      })
      .strict(),
    toneOfVoice: z.string().max(4000).default(""),
    /** Free-text guidelines the brief interpreter reads. Markdown allowed. */
    guidelines: z.string().max(20000).default(""),
    /** Optional longer guidelines file in the brand folder, for people to read. */
    guidelinesFile: RELATIVE_FILE.optional(),
    rules: z
      .object({ do: z.array(z.string().max(300)).default([]), dont: z.array(z.string().max(300)).default([]) })
      .strict()
      .default({ do: [], dont: [] }),
  })
  .strict();
export type Brand = z.infer<typeof BrandSchema>;
export type BrandInput = z.input<typeof BrandSchema>;

// ---------- facts used for the size decision ----------

export const PURPOSES = ["announce", "inform", "explain", "remind", "recruit", "consult", "celebrate", "warn"] as const;
export const CHANNELS = ["social", "website", "email", "screens", "presentation", "internal"] as const;
export const BEATS = ["hook", "problem", "message", "insight", "proof", "summary", "action"] as const;
export type Beat = (typeof BEATS)[number];

export const FactsSchema = z
  .object({
    keyMessages: z.number().int().min(1).max(8),
    purpose: z.enum(PURPOSES),
    channel: z.enum(CHANNELS),
    steps: z.number().int().min(0).max(12).optional(),
    audience: z.string().max(200).optional(),
    /** Set only when the brief explicitly asks for a length. It overrides the rule table and channel caps. */
    requestedSize: z.enum(SIZE_IDS).optional(),
    /**
     * Set only when the brief asks for a length in seconds or minutes ("around a minute and a half" is 90).
     * The length to aim for: for "under 20 seconds" it is a little under, such as 18. It picks the size (the
     * size whose range holds it, or the nearest) and sets the script's word target. Wins over requestedSize.
     */
    requestedSeconds: z.number().int().min(5).max(600).optional(),
  })
  .strict();
export type Facts = z.infer<typeof FactsSchema>;

// ---------- decision.json ----------

export const DecisionSchema = z.object({
  version: z.literal(1),
  size: z.enum(SIZE_IDS),
  targetSeconds: z.object({ min: z.number(), max: z.number() }),
  rule: z.string(),
  reasons: z.array(z.string()),
  facts: FactsSchema,
  /** The length the brief asked for, in seconds, when it gave one (facts.requestedSeconds). */
  requestedSeconds: z.number().optional(),
  wordCount: z.number().int(),
  wordBudget: z.number().int(),
  wordsPerSecond: z.number(),
  beatsExpected: z.array(z.string()),
  beatsFound: z.array(z.string()),
  warnings: z.array(z.string()),
});
export type Decision = z.infer<typeof DecisionSchema>;

// ---------- timeline.json ----------

export const WordTiming = z.object({ text: z.string(), start: z.number(), end: z.number(), matched: z.boolean() });
export type WordTiming = z.infer<typeof WordTiming>;

export const PhraseTiming = z.object({
  text: z.string(),
  file: z.string(),
  audioSeconds: z.number(),
  start: z.number(),
  end: z.number(),
  words: z.array(WordTiming),
});
export type PhraseTiming = z.infer<typeof PhraseTiming>;

export const TextElementTiming = z.object({
  slot: z.string(),
  words: z.number().int(),
  /** Seconds from scene start when the element is fully visible. */
  visibleFrom: z.number(),
  /** Seconds from scene start when the next scene starts covering it (or the scene ends). */
  visibleUntil: z.number(),
  requiredSeconds: z.number(),
});

export const SceneTiming = z.object({
  id: z.string(),
  type: z.string(),
  index: z.number().int(),
  start: z.number(),
  duration: z.number(),
  /** How this scene arrives. Chosen by engine/transitions.ts. */
  transitionIn: z.enum(["none", "crossfade", "wipe"]),
  /** Seconds this scene overlaps the one before (its transition length). 0 for the first scene. */
  transitionSeconds: z.number().optional(),
  enterAt: z.number(),
  phrases: z.array(PhraseTiming),
  text: z.array(TextElementTiming),
  limitedBy: z.enum(["voice", "reading", "minimum", "target"]),
});
export type SceneTiming = z.infer<typeof SceneTiming>;

export const CaptionCue = z.object({
  id: z.string(),
  start: z.number(),
  end: z.number(),
  text: z.string(),
  fadeIn: z.boolean(),
  fadeOut: z.boolean(),
  /** Absolute word timings, one per word of text, for the line under the spoken word. */
  words: z.array(z.object({ text: z.string(), start: z.number(), end: z.number() })).optional(),
});
export type CaptionCue = z.infer<typeof CaptionCue>;

export const TimelineSchema = z.object({
  version: z.literal(1),
  grid: z.number().int(),
  crossfade: z.number(),
  duration: z.number(),
  voice: z.object({ id: z.string(), speed: z.number(), file: z.string(), sampleRate: z.number().int() }),
  scenes: z.array(SceneTiming),
  captions: z.array(CaptionCue),
  formats: z.array(z.enum(FORMAT_IDS)),
});
export type Timeline = z.infer<typeof TimelineSchema>;
