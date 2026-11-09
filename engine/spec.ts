// The spec: the only thing Claude (or the brief interpreter) writes for a video.
// Built from the scene registry, so the list of scene types stays closed and in one place.
import fs from "node:fs";
import { z } from "zod";
import { SCENES } from "./scenes";
import { BEATS, FactsSchema, SLUG } from "./schema";
import { FORMAT_IDS } from "./config";
import { checkIconName } from "./icons/library";

const Phrase = z
  .string()
  .trim()
  .min(2)
  .max(220, "Keep each voiceover phrase to 220 characters or fewer. Split long sentences.")
  .refine((s) => !/[\r\n]/.test(s), "Use one line per phrase")
  .refine((s) => !/[<>{}]/.test(s), "Do not use < > { } in the voiceover");

function sceneSchema(def: (typeof SCENES)[number]) {
  return z
    .object({
      type: z.literal(def.type),
      id: SLUG.optional(),
      beat: z.enum(BEATS),
      slots: def.slots,
      voiceover: z.array(Phrase).min(1).max(4),
    })
    .strict();
}

const sceneSchemas = SCENES.map(sceneSchema);
// discriminatedUnion needs at least two members; the registry always has three or more.
const SceneSchema = z.discriminatedUnion("type", sceneSchemas as unknown as [ReturnType<typeof sceneSchema>, ReturnType<typeof sceneSchema>]);

export const SpecSchema = z
  .object({
    version: z.literal(1),
    brand: SLUG,
    title: z.string().trim().min(1).max(120),
    language: z.literal("en-GB").default("en-GB"),
    /** Optional voice override. Defaults to the brand's voice. */
    voice: z.string().optional(),
    /** Which formats to make. Defaults to all three. */
    formats: z.array(z.enum(FORMAT_IDS)).min(1).optional(),
    facts: FactsSchema,
    scenes: z.array(SceneSchema).min(2).max(16),
  })
  .strict()
  .superRefine((spec, ctx) => {
    const types = spec.scenes.map((s) => s.type);
    if (types[0] !== "title") ctx.addIssue({ code: "custom", path: ["scenes", 0, "type"], message: "The first scene must be a title" });
    if (types[types.length - 1] !== "end")
      ctx.addIssue({ code: "custom", path: ["scenes", types.length - 1, "type"], message: "The last scene must be an end card" });
    if (types.filter((t) => t === "title").length > 1) ctx.addIssue({ code: "custom", path: ["scenes"], message: "Use only one title scene" });
    if (types.filter((t) => t === "end").length > 1) ctx.addIssue({ code: "custom", path: ["scenes"], message: "Use only one end card" });
    const ids = new Set<string>();
    spec.scenes.forEach((s, i) => {
      const id = s.id ?? `s${i + 1}`;
      if (ids.has(id)) ctx.addIssue({ code: "custom", path: ["scenes", i, "id"], message: `Scene id "${id}" is used twice` });
      ids.add(id);
    });
    // Icons: every name must exist for this brand (client icons) or in the library, with a "did you mean".
    spec.scenes.forEach((s, i) => {
      for (const [key, value] of Object.entries(s.slots as Record<string, unknown>)) {
        const refs = Array.isArray(value) ? value.map((v, j) => [v, [key, j]] as const) : [[value, [key]] as const];
        for (const [v, p] of refs) {
          if (!v || typeof v !== "object" || typeof (v as { icon?: unknown }).icon !== "string") continue;
          const ref = v as { icon: string; weight?: (typeof import("./schema").ICON_WEIGHTS)[number] };
          const check = checkIconName(ref.icon, { weight: ref.weight, brand: spec.brand });
          if (!check.ok) ctx.addIssue({ code: "custom", path: ["scenes", i, "slots", ...p, "icon"], message: check.message ?? `Unknown icon "${ref.icon}"` });
        }
      }
    });
  });

export type Spec = z.infer<typeof SpecSchema>;
export type SpecInput = z.input<typeof SpecSchema>;
export type SpecScene = Spec["scenes"][number];

export class SpecError extends Error {
  constructor(message: string, readonly issues: Array<{ path: string; message: string }>) {
    super(message);
  }
}

export function parseSpec(raw: unknown): Spec {
  const parsed = SpecSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
    throw new SpecError(`spec.json is not valid:\n${z.prettifyError(parsed.error)}`, issues);
  }
  return parsed.data;
}

export function readSpec(file: string): Spec {
  return parseSpec(JSON.parse(fs.readFileSync(file, "utf8")));
}

/** Stable scene id: the spec's id, or s1, s2 and so on. Ids are also DOM ids, so they start with a letter. */
export function sceneId(scene: SpecScene, index: number): string {
  const id = scene.id ?? `s${index + 1}`;
  return /^[a-z]/.test(id) ? id : `s-${id}`;
}

export function specFormats(spec: Spec) {
  return spec.formats ?? [...FORMAT_IDS];
}

/** Every voiceover word in the spec, for the word budget. */
export function voiceoverWordCount(spec: Spec): number {
  return spec.scenes.reduce((n, s) => n + s.voiceover.reduce((m, p) => m + p.trim().split(/\s+/).length, 0), 0);
}
