// Shared command-line helpers for the scripts in this folder.
import path from "node:path";
import { FORMAT_IDS, type FormatId } from "../engine/config";
import { STEPS, type StepName, type ProgressEvent } from "../engine/pipeline";

export interface CliArgs {
  positional: string[];
  flags: Record<string, string | true>;
}

export function parseArgs(argv = process.argv.slice(2)): CliArgs {
  const positional: string[] = [];
  const flags: Record<string, string | true> = {};
  for (const a of argv) {
    if (a.startsWith("--")) {
      const [k, v] = a.slice(2).split("=", 2);
      flags[k] = v ?? true;
    } else positional.push(a);
  }
  return { positional, flags };
}

export function jobArg(args: CliArgs, usage: string): string {
  const j = args.positional[0];
  if (!j) {
    console.error(`Usage: ${usage}`);
    process.exit(2);
  }
  return path.resolve(j);
}

export function formatsFlag(args: CliArgs): FormatId[] | undefined {
  const v = args.flags.formats;
  if (typeof v !== "string") return undefined;
  const list = v.split(",").map((s) => s.trim()) as FormatId[];
  for (const f of list) if (!FORMAT_IDS.includes(f)) throw new Error(`Unknown format ${f}. Use ${FORMAT_IDS.join(", ")}.`);
  return list;
}

export function stepFlag(args: CliArgs, name: string): StepName | undefined {
  const v = args.flags[name];
  if (typeof v !== "string") return undefined;
  if (!STEPS.includes(v as StepName)) throw new Error(`Unknown step ${v}. Steps: ${STEPS.join(", ")}`);
  return v as StepName;
}

let lastLine = "";
export function printProgress(e: ProgressEvent): void {
  const pct = `${Math.round(e.overall * 100)}%`.padStart(4);
  const line = `[${pct}] ${e.step}: ${e.message}`;
  if (e.status === "progress") {
    if (line !== lastLine && process.stdout.isTTY) process.stdout.write(`\r${line.slice(0, 120).padEnd(120)}`);
    lastLine = line;
    return;
  }
  if (process.stdout.isTTY) process.stdout.write("\r" + " ".repeat(120) + "\r");
  console.log(line);
}

export async function main(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    process.exit(0);
  } catch (e) {
    console.error(`\n${(e as Error).message}`);
    process.exit(1);
  }
}
