// The scene registry: the closed list of scene types. A spec can only use types listed here.
// To add a scene, create engine/scenes/<name>.ts that exports a SceneDefinition and add it to SCENES.
import type { AnyScene } from "./types";
import { title } from "./title";
import { statement } from "./statement";
import { endcard } from "./endcard";
import { points } from "./points";
import { stat } from "./stat";
import { quote } from "./quote";
import { photo } from "./photo";
import { phototext } from "./phototext";
import { iconrow } from "./iconrow";
import { video } from "./video";

export const SCENES: AnyScene[] = [title, statement, points, stat, quote, photo, phototext, iconrow, video, endcard];

export function getScene(type: string): AnyScene {
  const s = SCENES.find((d) => d.type === type);
  if (!s) throw new Error(`Unknown scene type "${type}". Known types: ${SCENES.map((d) => d.type).join(", ")}`);
  return s;
}

/** A summary of every scene type, for the brief interpreter and the web app. */
export function sceneCatalogue() {
  return SCENES.map((s) => ({
    type: s.type,
    label: s.label,
    description: s.description,
    beats: s.beats,
    surface: s.surface,
    media: s.media ?? false,
    text: s.text,
    sample: s.sample,
  }));
}

export type { AnyScene, SceneDefinition, SceneContext, SceneElement, TextSlot, Rect } from "./types";
