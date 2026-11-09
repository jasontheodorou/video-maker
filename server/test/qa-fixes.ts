// Playwright checks for the QA round 1 web fixes. Runs its own server on port 3017.
//   npx tsx server/test/qa-fixes.ts [--no-job]
// 1. Phone width (390 px): no sideways scrolling on the Make a video page or the brand editor.
// 2. Brand editor: tabbing through every control, no focused control is hidden behind the sticky save bar.
// 3. Brief: the character count shows, and a brief over 20,000 characters gets an inline error.
// 4. A running job: Stop keeps focus across progress updates, asks to confirm (focus on "No, carry on"), shows "Stopping" at once,
//    and the job reaches "stopped" within a few seconds.
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { chromium, type Page } from "playwright";

const ROOT = path.resolve(__dirname, "..", "..");
const PORT = 3017;
const BASE = `http://localhost:${PORT}`;
const noJob = process.argv.includes("--no-job");
let failures = 0;

function check(name: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `: ${detail}` : ""}`);
}

async function startServer(): Promise<ChildProcess> {
  const child = spawn(path.join(ROOT, "node_modules", ".bin", "tsx"), ["server/index.ts"], { cwd: ROOT, env: { ...process.env, PORT: String(PORT) }, stdio: ["ignore", "pipe", "pipe"] });
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${BASE}/api/meta`)).ok) return child;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("The server did not start");
}

async function scrollWidth(page: Page) {
  return page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
}

async function main() {
  const server = await startServer();
  const browser = await chromium.launch({ channel: "chrome" }).catch(() => chromium.launch());
  try {
    // 1. Reflow at 390 px.
    const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await phone.addInitScript("globalThis.__name = globalThis.__name || ((f) => f);");
    await phone.goto(BASE + "/");
    await phone.waitForSelector("#history li, #history p");
    const a = await scrollWidth(phone);
    check("Make a video page has no sideways scroll at 390 px", a.sw <= a.cw + 1, `${a.sw} against ${a.cw}`);
    await phone.goto(BASE + "/brands?brand=demo");
    await phone.waitForSelector(".save-bar-wrap", { state: "attached", timeout: 20000 });
    const b = await scrollWidth(phone);
    check("Brand editor has no sideways scroll at 390 px", b.sw <= b.cw + 1, `${b.sw} against ${b.cw}`);
    const unlabelled = await phone.evaluate(() => Array.from(document.querySelectorAll("main input:not([type=hidden]), main select, main textarea")).filter((el) => !(el as HTMLInputElement).labels?.length && !el.getAttribute("aria-label") && !el.getAttribute("aria-labelledby")).length);
    check("Every brand editor field has a label", unlabelled === 0, `${unlabelled} without`);

    // 2. Focus not hidden by the save bar, desktop and phone.
    for (const [label, vp] of [["desktop", { width: 1280, height: 800 }], ["phone", { width: 390, height: 844 }]] as const) {
      const page = await browser.newPage({ viewport: vp });
      await page.addInitScript("globalThis.__name = globalThis.__name || ((f) => f);");
      await page.goto(BASE + "/brands?brand=demo");
      await page.waitForSelector(".save-bar-wrap", { state: "attached", timeout: 20000 });
      await page.waitForTimeout(800);
      let hidden: string[] = [];
      let count = 0;
      for (let i = 0; i < 220; i++) {
        await page.keyboard.press("Tab");
        const r = await page.evaluate(() => {
          const el = document.activeElement as HTMLElement | null;
          if (!el || el === document.body) return null;
          if (el.closest(".save-bar")) return { inBar: true, id: "", covered: 0 };
          const bar = document.querySelector(".save-bar") as HTMLElement | null;
          const rb = el.getBoundingClientRect();
          const bb = bar?.getBoundingClientRect();
          const overlap = bb ? Math.max(0, Math.min(rb.bottom, bb.bottom) - Math.max(rb.top, bb.top)) : 0;
          return { inBar: false, id: el.id || el.tagName + ":" + (el.textContent ?? "").trim().slice(0, 20), covered: rb.height ? overlap / rb.height : 0 };
        });
        if (!r) continue;
        count++;
        if (!r.inBar && r.covered > 0.01) hidden.push(`${r.id} (${Math.round(r.covered * 100)}%)`);
      }
      hidden = [...new Set(hidden)];
      check(`No focused control hidden by the save bar (${label}, ${count} tab stops)`, hidden.length === 0, hidden.slice(0, 6).join(", "));
      await page.close();
    }

    // 3. Brief counter and inline error.
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.addInitScript("globalThis.__name = globalThis.__name || ((f) => f);");
    await page.goto(BASE + "/");
    await page.waitForSelector("#brand option", { state: "attached" });
    await page.fill("#brief", "x".repeat(20010));
    await page.waitForTimeout(100);
    const countText = await page.textContent("#brief-count");
    check("Brief count shows characters over the limit", /10 characters too many/.test(countText ?? ""), countText ?? "");
    await page.click("#make-button");
    const inline = await page.textContent("#brief-error");
    const linked = await page.$('.error-summary a[href="#brief"]');
    check("A too-long brief gets an inline error linked from the summary", /20,000 characters or fewer/.test(inline ?? "") && !!linked, inline ?? "");

    // 4. Stop.
    if (!noJob) {
      await page.fill("#brief", "From 2 March 2027 the Northvale library on Market Street opens until 8pm on Thursdays. Tell residents to check opening times at northvale.example/libraries.");
      await page.click("#make-button");
      await page.waitForSelector("#job-progress button:has-text('Stop')", { timeout: 30000 });
      // Wait until the engine's own steps are running (voice onwards), where Stop used to take 25 seconds.
      const jid = new URL(page.url()).searchParams.get("job");
      for (let i = 0; i < 240; i++) {
        const v = await (await fetch(`${BASE}/api/jobs/${jid}`)).json();
        if (["voice", "layout", "render"].includes(v.job.stage)) break;
        await new Promise((r) => setTimeout(r, 250));
      }
      await page.focus("#job-progress button:has-text('Stop')");
      const focusLog: string[] = [];
      for (let i = 0; i < 5; i++) {
        await page.waitForTimeout(1500);
        focusLog.push(await page.evaluate(() => `${document.activeElement?.tagName} ${document.activeElement?.textContent?.trim()}`));
      }
      check("Stop keeps keyboard focus while progress updates", focusLog.every((f) => f === "BUTTON Stop"), focusLog.join(" | "));
      await page.keyboard.press("Enter");
      // The question opens with focus on the safe choice, so a stray Enter never stops a job.
      await page.waitForFunction(() => document.activeElement?.textContent?.trim() === "No, carry on", null, { timeout: 2000 }).catch(() => {});
      const confirmFocus = await page.evaluate(() => document.activeElement?.textContent?.trim());
      check("Stop asks to confirm, with focus on the safe choice", confirmFocus === "No, carry on", confirmFocus ?? "");
      const t0 = Date.now();
      await page.click("#job-progress button:has-text('Yes, stop it')");
      await page.waitForTimeout(300);
      const msg = await page.textContent(".progress-message");
      const btn = await page.textContent("#job-progress .progress-actions button");
      check("The page says it is stopping (or has stopped) straight away", /Stopping|Stopped/.test(msg ?? ""), `${msg} / ${btn}`);
      const id = new URL(page.url()).searchParams.get("job");
      let state = "";
      let stage = "";
      for (let i = 0; i < 60; i++) {
        const v = await (await fetch(`${BASE}/api/jobs/${id}`)).json();
        state = v.job.state;
        stage = v.job.stage ?? "";
        if (state !== "running" && state !== "queued") break;
        await new Promise((r) => setTimeout(r, 500));
      }
      const secs = (Date.now() - t0) / 1000;
      check("The job stops within 15 seconds", state === "stopped" && secs < 15, `${state} after ${secs.toFixed(1)} s (stage ${stage})`);
      await page.waitForSelector("#job-progress button:has-text('Try again')", { timeout: 10000 });
      check("Try again is offered after stopping", true);
    }
  } finally {
    await browser.close();
    server.kill();
  }
  console.log(failures ? `\n${failures} checks failed.` : "\nAll checks passed.");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
