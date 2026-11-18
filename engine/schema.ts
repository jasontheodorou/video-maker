// Zod rules for brand.json, spec facts, icon references, timeline.json and decision.json.
// The spec schema itself is built in spec.ts from the scene registry, so new scenes extend it.
import { z } from "zod";
import { SIZE_IDS, FORMAT_IDS } from "./config";
import { ENTRANCE_IDS, TRANSITION_IDS, TEXT_EFFECT_IDS, SHAPE_MOTION_IDS, MOTION_STYLES } from "./motion-rules";

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
//
// Two versions. schemaVersion 1 had seven fixed colour roles and three fixed surfaces (dark, light, tint).
// schemaVersion 2 has a palette of named colours in groups, with 10% and 25% tints, and any number of colour
// schemes. Version 1 files still load: engine/brand/migrate.ts turns them into version 2 in code, before
// validation, so everything past the parse boundary sees version 2 only.

export const COLOUR_ROLES = ["primary", "text", "background", "accent", "tint"] as const;
export const OPTIONAL_COLOUR_ROLES = ["accent2", "line"] as const;
export type ColourRole = (typeof COLOUR_ROLES)[number] | (typeof OPTIONAL_COLOUR_ROLES)[number];

/** The three surfaces of a version 1 brand. Version 2 turns them into schemes with these ids. */
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
/** Headings may set the weight of bold key words (schemes whose key words are bold). */
const HeadingRole = z
  .object({ family: z.string().min(1), weight: z.number().int().min(100).max(900), emphasisWeight: z.number().int().min(100).max(900).optional() })
  .strict();

const ColourToken = z
  .object({
    value: HEX,
    name: z.string().max(40).optional(),
  })
  .strict();

/** Parts both versions share. */
const typeScale = z
  .object({
    display: z.number().min(60).max(200),
    heading: z.number().min(48).max(160),
    body: z.number().min(42).max(110),
    label: z.number().min(42).max(80),
    caption: z.number().min(42).max(80),
  })
  .strict();
const lineHeight = z
  .object({
    display: z.number().min(0.95).max(1.6),
    heading: z.number().min(1.0).max(1.6),
    body: z.number().min(1.1).max(1.8),
  })
  .strict();
const letterSpacing = z
  .object({ display: z.number().min(-0.05).max(0.1).default(0), heading: z.number().min(-0.05).max(0.1).default(0) })
  .strict()
  .default({ display: 0, heading: 0 });
const logo = z
  .object({
    onLight: RELATIVE_FILE,
    onDark: RELATIVE_FILE,
    alt: z.string().min(1).max(120),
    /** Smallest logo height in px at 1080p the guidelines allow. */
    minHeight: z.number().min(24).max(240).default(56),
  })
  .strict();
const graphics = z
  .object({ dir: RELATIVE_FILE.default("graphics") })
  .strict()
  .default({ dir: "graphics" });
const voice = z
  .object({
    id: z.string().min(1),
    speed: z.number().min(0.8).max(1.2).default(1),
    lang: z.string().optional(),
  })
  .strict();
const writingRules = z
  .object({ do: z.array(z.string().max(300)).default([]), dont: z.array(z.string().max(300)).default([]) })
  .strict()
  .default({ do: [], dont: [] });

export const BrandSchemaV1 = z
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
    typeScale,
    lineHeight,
    letterSpacing,
    /** Base spacing unit in px at 1080p. Layouts use multiples of it. */
    spacing: z.object({ unit: z.number().int().min(4).max(16) }).strict(),
    radius: z.number().min(0).max(48),
    logo,
    icons: z
      .object({
        weight: z.enum(ICON_WEIGHTS).default("regular"),
        dir: RELATIVE_FILE.default("icons"),
        duotoneOpacity: z.number().min(0.1).max(0.6).default(0.2),
        duotoneColour: ColourName.optional(),
      })
      .strict()
      .default({ weight: "regular", dir: "icons", duotoneOpacity: 0.2 }),
    graphics,
    captions: z
      .object({
        background: ColourName,
        text: ColourName,
        weight: z.number().int().min(400).max(800).default(400),
      })
      .strict(),
    voice,
    toneOfVoice: z.string().max(4000).default(""),
    guidelines: z.string().max(20000).default(""),
    guidelinesFile: RELATIVE_FILE.optional(),
    rules: writingRules,
  })
  .strict();
export type BrandV1 = z.infer<typeof BrandSchemaV1>;

// ---------- version 2: palette and schemes ----------

/** A palette colour id: lower case, such as "navy" or "hmcts-blue". Version 1 role names (accent2) stay valid. */
export const ColourId = z.string().regex(/^[a-z][a-z0-9-]{0,39}$/, "Use lower-case letters, numbers and hyphens, starting with a letter");
/** A colour reference: a palette id, or one of its tints ("navy", "golden.t10", "blue.t25"). */
export const ColourRef = z.string().regex(/^[a-z][a-z0-9-]{0,39}(\.t(10|25))?$/, "Refer to a palette colour by its id, such as navy or golden.t10");
export const SchemeId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/, "Use lower-case letters, numbers and hyphens");

export const EntranceName = z.enum(ENTRANCE_IDS);
export const TransitionName = z.enum(TRANSITION_IDS);
export const TextEffectName = z.enum(TEXT_EFFECT_IDS);
export const ShapeMotionName = z.enum(SHAPE_MOTION_IDS);
export const MotionStyleName = z.enum(MOTION_STYLES);

export const PaletteColour = z
  .object({
    id: ColourId,
    name: z.string().min(1).max(40),
    value: HEX,
    group: ColourId,
    /** Make 10% and 25% tints of this colour (mixed with white). */
    tints: z.boolean().default(true),
    /** Exact tint values from the guidelines, used instead of the computed mix. */
    tintValues: z.object({ t10: HEX.optional(), t25: HEX.optional() }).strict().optional(),
  })
  .strict();
export type PaletteColour = z.infer<typeof PaletteColour>;

export const SchemeSchema = z
  .object({
    id: SchemeId,
    name: z.string().min(1).max(40),
    enabled: z.boolean().default(true),
    background: ColourRef,
    text: ColourRef,
    /** Key words: the highlighted words of a headline. */
    highlight: ColourRef,
    /** Circles behind icons and illustrations. May be a tint. */
    shape: ColourRef,
    /** How key words stand out: in the highlight colour, in bold, or both. */
    emphasis: z.enum(["colour", "weight", "both"]).default("colour"),
    /** Where the engine may use it: anywhere, only to open and close videos, or only in the middle. */
    fit: z.enum(["any", "bookends", "middle"]).default("any"),
    /** Which logo file shows on it. Automatic: by how dark the background is. */
    logo: z.enum(["auto", "onLight", "onDark"]).default("auto"),
    /** Who made it: a person, the suggestions, or the move from version 1. */
    source: z.enum(["you", "suggested", "migrated"]).default("you"),
  })
  .strict();
export type Scheme = z.infer<typeof SchemeSchema>;
export type SchemeInput = z.input<typeof SchemeSchema>;

export const PaletteRules = z
  .object({
    /** Colours text may use, in order of preference ("Text should be in navy or black"). */
    text: z.array(ColourId).max(6).optional(),
    /** Pairs the guidelines forbid ("Never white text on golden"). */
    never: z.array(z.object({ text: ColourRef, background: ColourRef }).strict()).max(24).optional(),
    /** The line of the guidelines the rules come from. */
    source: z.string().max(400).optional(),
  })
  .strict();
export type PaletteRules = z.infer<typeof PaletteRules>;

export const PaletteSchema = z
  .object({
    groups: z.array(z.object({ id: ColourId, name: z.string().min(1).max(30) }).strict()).min(1).max(12),
    colours: z.array(PaletteColour).min(2).max(48),
    rules: PaletteRules.optional(),
  })
  .strict();
export type Palette = z.infer<typeof PaletteSchema>;

export const SCHEME_USE_MODES = ["spread", "single", "by-type"] as const;

export const BrandMotion = z
  .object({
    style: MotionStyleName.default("calm"),
    entrance: EntranceName.optional(),
    transition: TransitionName.optional(),
    textEffect: TextEffectName.optional(),
    shape: ShapeMotionName.optional(),
  })
  .strict();
export type BrandMotion = z.infer<typeof BrandMotion>;

export const BrandSchemaV2 = z
  .object({
    schemaVersion: z.literal(2),
    id: SLUG,
    name: z.string().min(1).max(80),
    fictional: z.boolean().default(false),
    description: z.string().max(400).optional(),
    provisional: z.array(z.string()).default([]),
    palette: PaletteSchema,
    /** Colour schemes in priority order. The engine spreads the usable ones across a video. */
    schemes: z.array(SchemeSchema).min(1).max(24),
    schemeUse: z
      .object({
        mode: z.enum(SCHEME_USE_MODES).default("spread"),
        single: SchemeId.nullable().optional(),
        bookends: SchemeId.nullable().optional(),
      })
      .strict()
      .default({ mode: "spread" }),
    fonts: z
      .object({
        heading: HeadingRole,
        body: FontRole,
        faces: z.array(FontFace).min(1),
      })
      .strict(),
    typeScale,
    lineHeight,
    letterSpacing,
    spacing: z.object({ unit: z.number().int().min(4).max(16) }).strict(),
    radius: z.number().min(0).max(48),
    logo,
    icons: z
      .object({
        weight: z.enum(ICON_WEIGHTS).default("regular"),
        /** Folder of client icons. A file icons/<name>.svg overrides the library icon of that name. */
        dir: RELATIVE_FILE.default("icons"),
        /** Opacity of the light layer of duotone icons (the brand's secondary opacity). */
        duotoneOpacity: z.number().min(0.1).max(0.6).default(0.2),
        /** Colour for the light layer of duotone icons. Default: the icon's own colour. */
        duotoneColour: ColourRef.optional(),
      })
      .strict()
      .default({ weight: "regular", dir: "icons", duotoneOpacity: 0.2 }),
    graphics,
    captions: z
      .object({
        background: ColourRef,
        text: ColourRef,
        weight: z.number().int().min(400).max(800).default(400),
      })
      .strict(),
    motion: BrandMotion.default({ style: "calm" }),
    /** Example briefs shown on the Make page while the brief is empty. */
    examples: z.array(z.string().min(10).max(600)).max(3).optional(),
    voice,
    toneOfVoice: z.string().max(4000).default(""),
    /** Free-text guidelines the brief interpreter reads. Markdown allowed. */
    guidelines: z.string().max(20000).default(""),
    /** Optional longer guidelines file in the brand folder, for people to read. */
    guidelinesFile: RELATIVE_FILE.optional(),
    rules: writingRules,
  })
  .strict()
  .superRefine((b, ctx) => {
    const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: "custom", path, message });
    const ids = new Set<string>();
    const groups = new Set(b.palette.groups.map((g) => g.id));
    const groupIds = new Set<string>();
    b.palette.groups.forEach((g, i) => {
      if (groupIds.has(g.id)) issue(["palette", "groups", i, "id"], `The group id "${g.id}" is used twice.`);
      groupIds.add(g.id);
    });
    b.palette.colours.forEach((c, i) => {
      if (ids.has(c.id)) issue(["palette", "colours", i, "id"], `The colour id "${c.id}" is used twice.`);
      ids.add(c.id);
      if (!groups.has(c.group)) issue(["palette", "colours", i, "group"], `There is no group called "${c.group}".`);
    });
    const tints = new Map(b.palette.colours.map((c) => [c.id, c.tints !== false]));
    const checkRef = (ref: string, path: (string | number)[]) => {
      const m = /^([a-z][a-z0-9-]*)(\.t(10|25))?$/.exec(ref);
      if (!m) return;
      if (!tints.has(m[1])) issue(path, `There is no palette colour called "${m[1]}".`);
      else if (m[2] && !tints.get(m[1])) issue(path, `${m[1]} has no tints. Switch its tints on, or use the colour itself.`);
    };
    const schemeIds = new Set<string>();
    b.schemes.forEach((s, i) => {
      if (schemeIds.has(s.id)) issue(["schemes", i, "id"], `The scheme id "${s.id}" is used twice.`);
      schemeIds.add(s.id);
      for (const part of ["background", "text", "highlight", "shape"] as const) checkRef(s[part], ["schemes", i, part]);
    });
    if (!b.schemes.some((s) => s.enabled !== false)) issue(["schemes"], "Switch on at least one scheme.");
    if (b.schemeUse.single && !schemeIds.has(b.schemeUse.single)) issue(["schemeUse", "single"], `There is no scheme called "${b.schemeUse.single}".`);
    if (b.schemeUse.bookends && !schemeIds.has(b.schemeUse.bookends)) issue(["schemeUse", "bookends"], `There is no scheme called "${b.schemeUse.bookends}".`);
    for (const [i, t] of (b.palette.rules?.text ?? []).entries()) if (!ids.has(t)) issue(["palette", "rules", "text", i], `There is no palette colour called "${t}".`);
    for (const [i, n] of (b.palette.rules?.never ?? []).entries()) {
      checkRef(n.text, ["palette", "rules", "never", i, "text"]);
      checkRef(n.background, ["palette", "rules", "never", i, "background"]);
    }
    checkRef(b.captions.background, ["captions", "background"]);
    checkRef(b.captions.text, ["captions", "text"]);
    if (b.icons.duotoneColour) checkRef(b.icons.duotoneColour, ["icons", "duotoneColour"]);
  });

/** The brand as the engine uses it: always version 2 (version 1 files are migrated first). */
export const BrandSchema = BrandSchemaV2;
export type Brand = z.infer<typeof BrandSchemaV2>;
export type BrandInput = z.input<typeof BrandSchemaV2>;

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
  /** How this scene arrives. Chosen by engine/motion.ts (resolveMotion). */
  transitionIn: z.enum(["none", "cut", "crossfade", "wipe", "push", "sweep"]),
  /** Seconds this scene overlaps the one before. 0 for the first scene. A colour sweep lasts longer than its overlap. */
  transitionSeconds: z.number().optional(),
  /** The colour scheme this scene uses, and whether the engine chose it (true) or the spec did (false). */
  scheme: z.string().optional(),
  schemeAuto: z.boolean().optional(),
  /** Motion style, entrance of the headline, text effect and shape motion (engine/motion-plan.ts). */
  motionStyle: z.string().optional(),
  entrance: z.string().optional(),
  textEffect: z.string().optional(),
  shape: z.string().optional(),
  /** Colour of the colour-sweep layer into this scene. */
  transitionColour: z.string().optional(),
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
