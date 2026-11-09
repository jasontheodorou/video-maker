// Run a child process, stream its lines, and collect output.
import { spawn } from "node:child_process";

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export function run(
  cmd: string,
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv; onLine?: (line: string, stream: "stdout" | "stderr") => void; signal?: AbortSignal } = {},
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: opts.cwd, env: { ...process.env, ...opts.env }, stdio: ["ignore", "pipe", "pipe"], signal: opts.signal });
    let stdout = "";
    let stderr = "";
    const split = (stream: "stdout" | "stderr") => {
      let rest = "";
      return (chunk: Buffer) => {
        const text = chunk.toString("utf8");
        if (stream === "stdout") stdout += text;
        else stderr += text;
        if (!opts.onLine) return;
        rest += text;
        const lines = rest.split(/\r?\n|\r/);
        rest = lines.pop() ?? "";
        for (const l of lines) if (l.trim()) opts.onLine(l, stream);
      };
    };
    child.stdout.on("data", split("stdout"));
    child.stderr.on("data", split("stderr"));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

export async function runOk(cmd: string, args: string[], opts: Parameters<typeof run>[2] = {}): Promise<RunResult> {
  const r = await run(cmd, args, opts);
  if (r.code !== 0) {
    const tail = (r.stderr || r.stdout).split("\n").slice(-25).join("\n");
    throw new Error(`${cmd} ${args.slice(0, 3).join(" ")} failed (exit ${r.code}):\n${tail}`);
  }
  return r;
}

/** Run async tasks with a concurrency limit, keeping result order. */
export async function pool<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}
