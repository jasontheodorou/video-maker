export interface Stage {
  id: string;
  label: string;
}
export interface Meta {
  voices: Array<{ id: string; label: string }>;
  formats: Array<{ id: string; label: string; width: number; height: number }>;
  scenes: Array<{ type: string; label: string; text?: Array<{ slot: string; maxChars: number; maxCharsWhenFull?: number }>; sample?: Record<string, unknown>; required?: string[] }>;
  stages: Stage[];
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
}

export const STATE_TEXT: Record<string, string> = { queued: "Waiting", running: "In progress", done: "Ready", error: "Problem", stopped: "Stopped" };
export const STATE_TONE: Record<string, "busy" | "good" | "bad" | ""> = { queued: "busy", running: "busy", done: "good", error: "bad", stopped: "" };
export const isBusy = (s?: string) => s === "queued" || s === "running";
