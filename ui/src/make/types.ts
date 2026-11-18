export interface Stage {
  id: string;
  label: string;
}
export interface Meta {
  voices: Array<{ id: string; label: string }>;
  formats: Array<{ id: string; label: string; width: number; height: number }>;
  scenes: Array<{ type: string; label: string; text?: Array<{ slot: string; maxChars: number; maxCharsWhenFull?: number }>; sample?: Record<string, unknown>; required?: string[] }>;
  stages: Stage[];
  lengths?: Array<{ id: string; label: string; min?: number; max?: number }>;
  motion?: {
    styles: Array<{ id: string; label: string; line?: string }>;
    entrances: Array<{ id: string; label: string; roles?: string[] }>;
    transitions: Array<{ id: string; label: string; seconds?: number; nextToMedia?: boolean }>;
    textEffects: Array<{ id: string; label: string; scenes?: string[] | "any" }>;
    shapes: Array<{ id: string; label: string }>;
  };
}
export interface Look {
  schemes?: "spread" | "single" | null;
  scheme?: string | null;
  motionStyle?: string | null;
}
export interface PlanScene {
  index: number;
  id: string;
  type: string;
  label: string;
  beat?: string;
  start: number;
  duration: number;
  scheme: string | null;
  schemeAuto: boolean;
  transitionIn: string;
  transitionSeconds: number;
  motion: { style?: string; entrance?: string; text?: string; shape?: string };
  stills: Record<string, string | null>;
  problems: string[];
}
export interface PlanScheme {
  id: string;
  name: string;
  usable: boolean;
  bookends?: boolean;
  tone?: string;
  vars: Record<string, string>;
}
export interface Plan {
  scenes: PlanScene[];
  schemes: PlanScheme[];
}
export interface BrandSummary {
  id: string;
  name: string;
  ok: boolean;
  fictional?: boolean;
  provisional?: string[];
  errors?: string[];
  voice?: string;
  logo?: string;
  primary?: string;
  protected?: boolean;
}
export interface Job {
  id: string;
  title: string;
  brief: string;
  brand: string;
  createdAt: string;
  state: "queued" | "running" | "done" | "error" | "stopped";
  stopping?: boolean;
  stage: string | null;
  stagesDone: string[];
  progress: number;
  message: string;
  error?: { stage: string | null; message: string; problems?: string[]; retryable?: boolean };
  notes: string[];
  fromApp: boolean;
  mode?: "full" | "rerender" | "relook";
  formats?: string[];
}
export interface JobRow {
  id: string;
  title: string;
  brand: string;
  state: Job["state"];
  createdAt: string;
  progress: number;
}
export interface Output {
  format: string;
  url: string;
  download: string;
  bytes: number;
  poster?: string | null;
}
export interface JobViewData {
  job: Job;
  queuePosition: number;
  stages: Stage[];
  decision: any;
  duration: number | null;
  spec: any;
  outputs: Output[];
  srt: string | null;
  sheet: string | null;
  look?: Look | null;
  plan?: Plan | null;
  remake?: "look" | "words";
}

export const STATE_TEXT: Record<string, string> = { queued: "Waiting", running: "In progress", done: "Ready", error: "Problem", stopped: "Stopped" };
export const STATE_TONE: Record<string, "busy" | "good" | "bad" | ""> = { queued: "busy", running: "busy", done: "good", error: "bad", stopped: "" };
export const isBusy = (s?: string) => s === "queued" || s === "running";
