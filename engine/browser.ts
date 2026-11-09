// Headless Chrome for checks and stills. Uses the Chrome HyperFrames already installed.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import puppeteer, { type Browser } from "puppeteer-core";

export function findChrome(): string {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  const base = path.join(os.homedir(), ".cache", "puppeteer", "chrome-headless-shell");
  if (fs.existsSync(base)) {
    const versions = fs.readdirSync(base).sort().reverse();
    for (const v of versions) {
      const dir = path.join(base, v);
      for (const sub of fs.readdirSync(dir)) {
        const exe = path.join(dir, sub, "chrome-headless-shell");
        if (fs.existsSync(exe)) return exe;
      }
    }
  }
  const system = ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"];
  for (const s of system) if (fs.existsSync(s)) return s;
  throw new Error("Chrome not found. Run: npx hyperframes browser ensure");
}

let shared: Promise<Browser> | null = null;

export async function getBrowser(): Promise<Browser> {
  if (!shared) {
    shared = puppeteer.launch({
      executablePath: findChrome(),
      headless: true,
      args: [
        "--allow-file-access-from-files",
        "--disable-gpu",
        "--font-render-hinting=none",
        "--force-color-profile=srgb",
        "--hide-scrollbars",
        // In a container Chrome's own sandbox cannot start (no user namespaces); the container is the sandbox.
        // The Docker image sets CHROME_NO_SANDBOX=1. HyperFrames already does the same for its renders.
        ...(process.env.CHROME_NO_SANDBOX === "1" ? ["--no-sandbox"] : []),
      ],
    });
    const b = await shared;
    b.on("disconnected", () => {
      shared = null;
    });
  }
  return shared;
}

/** A new page with the esbuild __name helper defined, so functions passed to evaluate() run. */
export async function newPage() {
  const browser = await getBrowser();
  const page = await browser.newPage();
  await page.evaluateOnNewDocument("globalThis.__name = function (f) { return f; };");
  return page;
}

let users = 0;

/** Mark the shared browser as in use. Pair every call with releaseBrowser(). */
export function retainBrowser(): void {
  users++;
}

/** Done with the shared browser. It closes when nothing else is using it. */
export async function releaseBrowser(): Promise<void> {
  users = Math.max(0, users - 1);
  if (users === 0) await closeBrowser();
}

/** Close the shared browser now. Command-line scripts call this before exiting. */
export async function closeBrowser(): Promise<void> {
  if (!shared) return;
  const pending = shared;
  shared = null;
  try {
    const b = await pending;
    await b.close();
  } catch {
    /* already closed */
  }
}

/** Screenshot an HTML file at a given size. Waits for fonts and images. */
export async function screenshotFile(htmlFile: string, width: number, height: number, outPng: string): Promise<void> {
  const page = await newPage();
  try {
    await page.setViewport({ width, height, deviceScaleFactor: 1 });
    await page.goto("file://" + htmlFile, { waitUntil: "load" });
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all([...document.images].map((i) => (i.complete ? null : new Promise((r) => { i.onload = i.onerror = r; }))));
    });
    await page.screenshot({ path: outPng as `${string}.png`, clip: { x: 0, y: 0, width, height } });
  } finally {
    await page.close();
  }
}
