// Settings for the brief interpreter. Everything can be changed with environment variables,
// so the web server, the command line and the Claude Code skill all behave the same way.
//
//   VIDEO_INTERPRETER_BACKEND   auto (default), cli, or sdk (also accepted as api)
//   VIDEO_INTERPRETER_MODEL     model id, default claude-sonnet-5-5
//   VIDEO_INTERPRETER_CLAUDE    path to the Claude Code CLI, default: found on the PATH
//   VIDEO_INTERPRETER_TIMEOUT   seconds for one model call, default 240
//
// "auto" uses the Anthropic SDK when ANTHROPIC_API_KEY is set, and the local Claude Code CLI otherwise.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export type Backend = "cli" | "sdk";

export interface InterpreterSettings {
  backend: Backend;
  model: string;
  claudePath: string;
  timeoutMs: number;
  /** Extra attempts after the first when the spec fails validation. */
  retries: number;
}

export const DEFAULT_MODEL = "claude-sonnet-5-5";

function findClaude(): string {
  const fromEnv = process.env.VIDEO_INTERPRETER_CLAUDE;
  if (fromEnv) return fromEnv;
  const candidates = [
    ...(process.env.PATH ?? "").split(path.delimiter).map((d) => path.join(d, "claude")),
    path.join(os.homedir(), ".npm-global", "bin", "claude"),
    path.join(os.homedir(), ".claude", "local", "claude"),
    "/opt/homebrew/bin/claude",
    "/usr/local/bin/claude",
  ];
  for (const c of candidates) {
    try {
      if (c && fs.statSync(c).isFile()) return c;
    } catch {
      /* keep looking */
    }
  }
  return "claude";
}

export function interpreterSettings(overrides: Partial<InterpreterSettings> = {}): InterpreterSettings {
  const raw = (process.env.VIDEO_INTERPRETER_BACKEND ?? "auto").toLowerCase();
  const want = raw === "api" ? "sdk" : raw;
  const backend: Backend = want === "cli" || want === "sdk" ? want : process.env.ANTHROPIC_API_KEY ? "sdk" : "cli";
  return {
    backend,
    model: process.env.VIDEO_INTERPRETER_MODEL || DEFAULT_MODEL,
    claudePath: findClaude(),
    timeoutMs: Number(process.env.VIDEO_INTERPRETER_TIMEOUT || 240) * 1000,
    retries: 2,
    ...overrides,
  };
}
