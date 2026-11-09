// Model backends for the brief interpreter. Each takes a system prompt, a user prompt and a JSON Schema,
// and returns one parsed JSON object. Validation against the engine's Zod rules happens in index.ts.
//
// cli: the local Claude Code CLI, run headless (claude -p) with no tools, no hooks, no CLAUDE.md,
//      no session saved, and structured output checked against the schema by the CLI.
// sdk: the Anthropic SDK, used when ANTHROPIC_API_KEY is set (or VIDEO_INTERPRETER_BACKEND=sdk).
import { spawn } from "node:child_process";
import os from "node:os";
import Anthropic from "@anthropic-ai/sdk";
import type { InterpreterSettings } from "./settings";

export interface ModelCall {
  system: string;
  prompt: string;
  schema: unknown;
  signal?: AbortSignal;
}

export interface ModelResult {
  data: unknown;
  backend: "cli" | "sdk";
  model: string;
  ms: number;
  costUsd?: number;
}

export class InterpreterError extends Error {}

export async function callModel(call: ModelCall, s: InterpreterSettings): Promise<ModelResult> {
  if (s.backend === "sdk") return callSdk(call, s);
  try {
    return await callCli(call, s);
  } catch (e) {
    // A call that never answers is usually a stalled process (for example after the Mac slept), not a
    // problem with the brief. Try once more with a fresh process before giving up.
    if (e instanceof TimeoutError && !call.signal?.aborted) return callCli(call, s);
    throw e;
  }
}

class TimeoutError extends InterpreterError {}

/** Pull one JSON object out of model text: plain JSON, or JSON inside a code fence. */
export function parseJsonText(text: string): unknown {
  const t = text.trim();
  try {
    return JSON.parse(t);
  } catch {
    /* try harder */
  }
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) {
    try {
      return JSON.parse(fence[1]);
    } catch {
      /* fall through */
    }
  }
  const first = t.indexOf("{");
  const last = t.lastIndexOf("}");
  if (first >= 0 && last > first) return JSON.parse(t.slice(first, last + 1));
  throw new InterpreterError("The model did not return JSON.");
}

function callCli(call: ModelCall, s: InterpreterSettings): Promise<ModelResult> {
  const args = [
    "-p",
    "--safe-mode",
    "--tools",
    "",
    "--strict-mcp-config",
    "--no-session-persistence",
    "--output-format",
    "json",
    "--model",
    s.model,
    "--system-prompt",
    call.system,
    "--json-schema",
    JSON.stringify(call.schema),
  ];
  const started = Date.now();
  return new Promise((resolve, reject) => {
    // Run outside the project and the home folder so no CLAUDE.md or project settings are read.
    const child = spawn(s.claudePath, args, { cwd: os.tmpdir(), env: { ...process.env }, stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      // A stalled process can ignore SIGTERM and keep its pipes open, which keeps this process waiting too.
      setTimeout(() => child.exitCode == null && child.kill("SIGKILL"), 3000).unref();
      reject(new TimeoutError(`Claude did not answer within ${Math.round(s.timeoutMs / 1000)} seconds.`));
    }, s.timeoutMs);
    const onAbort = () => {
      child.kill("SIGTERM");
      reject(new InterpreterError("Stopped."));
    };
    call.signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(new InterpreterError(`Could not start Claude Code at ${s.claudePath}: ${e.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      call.signal?.removeEventListener("abort", onAbort);
      let res: Record<string, unknown>;
      try {
        res = JSON.parse(out);
      } catch {
        return reject(new InterpreterError(`Claude Code did not return a result (exit ${code}). ${err.trim().slice(0, 400)}`));
      }
      if (res.is_error || res.subtype !== "success") {
        const msg = String(res.result ?? res.api_error_status ?? res.subtype ?? "unknown error");
        if (/log ?in|auth|credential/i.test(msg)) return reject(new InterpreterError(`Claude Code is not logged in. Run "claude" once in a terminal and log in. (${msg})`));
        return reject(new InterpreterError(`Claude Code returned an error: ${msg.slice(0, 400)}`));
      }
      let data: unknown = res.structured_output;
      if (data == null) {
        try {
          data = parseJsonText(String(res.result ?? ""));
        } catch (e) {
          return reject(e);
        }
      }
      resolve({ data, backend: "cli", model: s.model, ms: Date.now() - started, costUsd: typeof res.total_cost_usd === "number" ? res.total_cost_usd : undefined });
    });
    child.stdin.end(call.prompt);
  });
}

async function callSdk(call: ModelCall, s: InterpreterSettings): Promise<ModelResult> {
  const started = Date.now();
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) throw new InterpreterError("The brief interpreter is set to use the Anthropic API, but ANTHROPIC_API_KEY is not set.");
  const client = new Anthropic({ timeout: s.timeoutMs });
  const prompt = `${call.prompt}\n\nReply with one JSON object only, no other text. It must match this JSON Schema:\n${JSON.stringify(call.schema)}`;
  let response;
  try {
    response = await client.beta.messages.create(
      {
        model: s.model,
        max_tokens: 16000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: "medium" },
        system: call.system,
        messages: [{ role: "user", content: prompt }],
      } as Parameters<typeof client.beta.messages.create>[0],
      { signal: call.signal },
    );
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw new InterpreterError("The Anthropic API key was not accepted. Check ANTHROPIC_API_KEY.");
    if (e instanceof Anthropic.RateLimitError) throw new InterpreterError("The Anthropic API is busy (rate limit). Try again in a minute.");
    if (e instanceof Anthropic.APIError) throw new InterpreterError(`The Anthropic API returned an error: ${e.message}`);
    throw e;
  }
  const msg = response as unknown as { stop_reason: string; content: Array<{ type: string; text?: string }> };
  if (msg.stop_reason === "refusal") throw new InterpreterError("The model declined this brief. Reword it and try again.");
  if (msg.stop_reason === "max_tokens") throw new InterpreterError("The model's answer was cut off. Try a shorter brief.");
  const text = msg.content.filter((b) => b.type === "text").map((b) => b.text ?? "").join("");
  return { data: parseJsonText(text), backend: "sdk", model: s.model, ms: Date.now() - started };
}
