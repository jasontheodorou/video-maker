// End-to-end test of the web app with Playwright. It drives the real pages in a real browser.
//
//   npm run e2e                 brands checks, then a short brief made into video, then playback checks
//   npm run e2e -- --no-video   brands checks only (fast)
//   npm run e2e -- --rerender   also edit the script and make the video again
//   npm run e2e -- --no-brands --job=<id>   only check the results page of a finished video
//
// It starts its own server on port 3016 (or uses E2E_URL), saves a screenshot of each state in
// server/test/screenshots/, and exits with code 1 if any check fails.
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";

const ROOT = path.resolve(__dirname, "..", "..");
const SHOTS = path.join(__dirname, "screenshots");
const PORT = 3016;
const BASE = process.env.E2E_URL ?? `http://localhost:${PORT}`;
const args = new Set(process.argv.slice(2));
const BRIEF =
  "From 2 February, the Northvale library on Castle Street will open on Sundays from 10am to 4pm. Tell residents in a short video for social media. They can find out more at northvale.example/libraries.";

let failures = 0;
let shot = 0;
function check(ok: boolean, what: string) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${what}`);
  if (!ok) failures++;
}
async function snap(page: Page, name: string) {
  shot++;
  const file = path.join(SHOTS, `${String(shot).padStart(2, "0")}-${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  console.log(`      screenshot ${path.relative(ROOT, file)}`);
}

async function startServer(): Promise<ChildProcess | null> {
  if (process.env.E2E_URL) return null;
  const child = spawn(path.join(ROOT, "node_modules", ".bin", "tsx"), ["server/index.ts"], { cwd: ROOT, env: { ...process.env, PORT: String(PORT) }, stdio: ["ignore", "pipe", "pipe"] });
  child.stderr?.on("data", (d) => process.stderr.write(`[server] ${d}`));
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${BASE}/api/meta`);
      if (r.ok) return child;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  child.kill();
  throw new Error("The server did not start.");
}

async function launch(): Promise<Browser> {
  // Google Chrome plays H.264 MP4s; Playwright's own Chromium may not.
  try {
    return await chromium.launch({ channel: "chrome" });
  } catch {
    return chromium.launch();
  }
}

// ---------- brands ----------

async function brandsFlow(page: Page) {
  console.log("\nBrands page");
  await page.goto(`${BASE}/brands`);
  await page.getByRole("heading", { name: "Brands", level: 1 }).waitFor();
  check(await page.getByRole("heading", { name: "Northvale Council" }).isVisible(), "the sample brand is listed");
  await snap(page, "brands-list");

  // Create a brand from the sample.
  const name = `E2E Test Council ${Date.now().toString(36)}`;
  await page.getByLabel("Name of the organisation or brand").fill(name);
  await page.getByRole("button", { name: "Create brand" }).click();
  await page.getByRole("heading", { name: `Edit ${name}`, level: 1 }).waitFor();
  check(true, "a new brand can be created and opens in the editor");
  const id = new URL(page.url()).searchParams.get("brand")!;

  // Live preview: nine stills (three scenes, three formats).
  await page.locator("#preview iframe").nth(8).waitFor({ timeout: 20000 });
  check((await page.locator("#preview iframe").count()) === 9, "the live preview shows 3 scenes in 3 formats");
  await page.waitForTimeout(800);
  await snap(page, "brand-editor");

  // Contrast: make the accent fail on the dark background, then use the suggested colour.
  const accent = page.locator("#c-accent-hex");
  await accent.fill("#6A8CA6");
  await page.getByText("Fails AAA").first().waitFor({ timeout: 5000 });
  check(await page.getByText("Fails AAA").first().isVisible(), "a failing colour pair is reported straight away");
  await page.locator("#sec-colours").scrollIntoViewIfNeeded();
  await snap(page, "contrast-fail");
  const fix = page.getByRole("button", { name: /^Change .* to #/ }).first();
  check(await fix.isVisible(), "a passing colour is suggested");
  await fix.click();
  await page.waitForTimeout(600);
  check((await page.getByText("Fails AAA").count()) === 0, "using the suggestion makes every pair pass");

  // Rename and save.
  await page.locator("#f-name").fill(`${name} renamed`);
  await page.getByRole("button", { name: "Save brand" }).first().click();
  await page.getByText(/^Saved/).first().waitFor({ timeout: 10000 });
  check(true, "the brand saves");
  const saved = JSON.parse(fs.readFileSync(path.join(ROOT, "brands", id, "brand.json"), "utf8"));
  check(saved.name === `${name} renamed`, "brand.json has the new name");

  // Upload an icon.
  const iconFile = path.join(SHOTS, "e2e-star.svg");
  fs.writeFileSync(iconFile, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="currentColor" d="M12 2l3 7h7l-5.5 4.5L18 21l-6-4-6 4 1.5-7.5L2 9h7z"/></svg>');
  await page.locator("#icon-upload").setInputFiles(iconFile);
  await page.getByRole("button", { name: "Upload icons" }).click();
  await page.locator(".icon-grid .name", { hasText: "e2e-star" }).waitFor({ timeout: 10000 });
  check(fs.existsSync(path.join(ROOT, "brands", id, "icons", "e2e-star.svg")), "an uploaded icon is saved with the brand");
  fs.rmSync(iconFile, { force: true });

  // Logo upload (SVG) for dark backgrounds.
  const logoFile = path.join(SHOTS, "e2e-logo.svg");
  fs.writeFileSync(logoFile, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 60"><rect width="60" height="60" fill="#FFFFFF"/><text x="70" y="40" fill="#FFFFFF" font-size="28">Test</text></svg>');
  await page.locator("#logo-upload").setInputFiles(logoFile);
  await page.locator('input[name="logo-for"][value="onDark"]').check();
  await page.getByRole("button", { name: "Upload logo" }).click();
  await page.locator("#logo-onDark").filter({ has: page.locator('option[value="logo/e2e-logo.svg"]') }).waitFor({ timeout: 10000 });
  check((await page.locator("#logo-onDark").inputValue()) === "logo/e2e-logo.svg", "an uploaded logo is used for dark backgrounds");
  fs.rmSync(logoFile, { force: true });

  // Guidelines file: read it, then use the suggestions.
  const guide = path.join(SHOTS, "e2e-guidelines.md");
  fs.writeFileSync(guide, "# Riverside Council brand guidelines\n\n## Colour\n\n| Name | Hex |\n| --- | --- |\n| River Teal (primary colour) | #004D4F |\n| Ink (text colour) | #101010 |\n| White (background colour) | #FFFFFF |\n| Sun (accent colour) | #FFC845 |\n| Foam (tint) | #E8F3F2 |\n\n## Tone of voice\n\nFriendly, plain and direct. Short sentences. Say what people need to do.\n\n## Do and don't\n\n- Do use plain English.\n- Don't use jargon.\n");
  await page.locator("#guidelines-file").setInputFiles(guide);
  await page.getByRole("button", { name: "Read guidelines" }).click();
  await page.locator("#suggestions-h").waitFor({ timeout: 120000 });
  await snap(page, "guideline-suggestions");
  check(await page.locator("#suggestions").getByText("#004D4F", { exact: true }).isVisible(), "colours are suggested from the guidelines");
  await page.getByRole("button", { name: "Use the chosen suggestions" }).click();
  await page.waitForTimeout(800);
  check((await page.locator("#c-primary-hex").inputValue()) === "#004D4F", "a chosen suggestion fills the form");
  fs.rmSync(guide, { force: true });

  // Delete, with confirmation.
  await page.getByRole("button", { name: "Delete brand" }).last().click();
  // The question is asked in the page, GOV.UK style, not in a dialog.
  await page.getByRole("group", { name: /^Delete / }).waitFor();
  await snap(page, "delete-confirm");
  await page.getByRole("button", { name: "Yes, delete this brand" }).click();
  await page.getByText("has been deleted").waitFor({ timeout: 10000 });
  check(!fs.existsSync(path.join(ROOT, "brands", id)), "the brand folder is deleted after confirming");
}

// ---------- make a video ----------

async function makeFlow(page: Page) {
  const existing = [...args].find((a) => a.startsWith("--job="))?.slice(6);
  if (existing) {
    console.log(`\nChecking the finished video ${existing}`);
    await page.goto(`${BASE}/?job=${encodeURIComponent(existing)}`);
    await page.locator("video[data-format]").first().waitFor({ timeout: 15000 });
    return resultsFlow(page);
  }
  console.log("\nMake a video");
  await page.goto(BASE);
  await page.getByRole("heading", { name: "Make a video", level: 1 }).waitFor();
  await snap(page, "make-form");

  // Validation: an empty brief is refused with an error summary.
  await page.getByRole("button", { name: "Make video" }).click();
  check(await page.getByRole("alert").getByText("Describe the video in at least one sentence").isVisible(), "an empty brief shows an error summary");

  await page.getByLabel("What is the video about?").fill(BRIEF);
  await page.getByLabel("Brand", { exact: true }).selectOption("demo");
  await page.getByRole("button", { name: "Make video" }).click();
  await page.locator("#job-title").waitFor();
  check(true, "the brief is accepted and a job starts");

  const seen = new Set<string>();
  const started = Date.now();
  let state = "";
  while (Date.now() - started < 10 * 60 * 1000) {
    const active = await page.locator(".steps li.active span:nth-child(2)").first().textContent({ timeout: 1000 }).catch(() => null);
    if (active && !seen.has(active)) {
      seen.add(active);
      const pct = await page.locator(".progress-text").textContent().catch(() => "");
      console.log(`      step: ${active} (${pct})`);
      await snap(page, `progress-${active.toLowerCase().replace(/\s+/g, "-")}`);
    }
    state = (await page.locator("#job-head .tag").first().textContent().catch(() => "")) ?? "";
    if (state === "Ready" || state === "Problem" || state === "Stopped") break;
    await page.waitForTimeout(700);
  }
  check(state === "Ready", `the video finishes (state: ${state}, ${Math.round((Date.now() - started) / 1000)} s)`);
  if (state !== "Ready") {
    await snap(page, "job-failed");
    console.log(await page.locator("#job-error").textContent());
    return;
  }
  for (const step of ["Understanding brief", "Writing script", "Recording voice", "Checking layout", "Making the videos"]) {
    check(seen.has(step) || (await page.locator(".steps li.done", { hasText: step }).count()) === 1, `step shown and finished: ${step}`);
  }
  const bar = await page.locator('[role="progressbar"]').getAttribute("aria-valuenow");
  check(bar === "100", "the progress bar reaches 100%");
  check(await page.getByText("Why this length:").isVisible(), "the chosen length and the reasons are shown");
  check(await page.locator(".sheet img").isVisible(), "the contact sheet is shown");
  await snap(page, "job-done");
  await resultsFlow(page);
}

async function resultsFlow(page: Page) {
  // Videos: one player and a switch for the three formats, each in its own aspect ratio, with real duration and frames.
  const switcher = page.locator("#job-videos .format-switch").getByRole("radio");
  check((await switcher.count()) === 3, "the switcher shows three formats");
  check((await page.locator("video[data-format]").count()) === 1, "one player is shown");
  const formats: Array<[string, RegExp, number, number]> = [
    ["16x9", /Landscape 16:9/, 1920, 1080],
    ["9x16", /Portrait 9:16/, 1080, 1920],
    ["1x1", /Square 1:1/, 1080, 1080],
  ];
  for (const [format, name, w, h] of formats) {
    await page.locator("#job-videos").getByRole("radio", { name }).check();
    const v = page.locator(`video[data-format="${format}"]`);
    await v.waitFor({ timeout: 5000 });
    check((await page.locator("video[data-format]").count()) === 1, `${format} is shown in the one player`);
    await v.scrollIntoViewIfNeeded();
    const info = await v.evaluate(async (node: HTMLVideoElement) => {
      if (node.readyState < 1) await new Promise((r) => node.addEventListener("loadedmetadata", r, { once: true }));
      node.muted = true;
      let frames = 0;
      const count = () => {
        frames++;
        if (frames < 400) node.requestVideoFrameCallback(count);
      };
      node.requestVideoFrameCallback(count);
      await node.play();
      await new Promise((r) => setTimeout(r, 1500));
      node.pause();
      const box = node.getBoundingClientRect();
      return { duration: node.duration, width: node.videoWidth, height: node.videoHeight, time: node.currentTime, frames, boxW: box.width, boxH: box.height, canPlay: node.canPlayType('video/mp4; codecs="avc1.640028"') };
    });
    console.log(`      ${format}: ${info.width}x${info.height}, ${info.duration.toFixed(2)} s, played to ${info.time.toFixed(2)} s, ${info.frames} frames painted`);
    check(info.duration > 10 && info.duration < 30, `${format} has a short-video duration`);
    check(info.width === w && info.height === h, `${format} is ${w} x ${h}`);
    check(Math.abs(info.boxW / info.boxH - w / h) < 0.02, `${format} is shown in its real aspect ratio`);
    check(info.time > 0.5 && info.frames > 20, `${format} plays and paints frames`);
    // Each format keeps its own download.
    const href = await page.getByRole("link", { name: /Download MP4/ }).getAttribute("href");
    const r = await fetch(new URL(href!, BASE), { method: "HEAD" });
    check(r.ok && r.headers.get("content-type") === "video/mp4" && !!href?.includes(format), `MP4 download works (${href?.split("/").pop()})`);
  }
  const srt = await page.getByRole("link", { name: /Download subtitles/ }).getAttribute("href");
  const res = await fetch(new URL(srt!, BASE));
  const text = await res.text();
  check(res.ok && /-->/.test(text), "the SRT downloads and has cues");
  await page.locator("#job-videos").getByRole("radio", { name: /16:9/ }).check();
  await page.locator('video[data-format="16x9"]').waitFor();
  await page.locator("video").first().evaluate((n: HTMLVideoElement) => (n.currentTime = 3));
  await page.waitForTimeout(500);
  await snap(page, "videos");

  if (args.has("--rerender")) {
    console.log("\nEdit the script and make it again");
    await page.getByRole("button", { name: "Show the script" }).click();
    const first = page.locator('textarea[data-vo]').first();
    await first.scrollIntoViewIfNeeded();
    const before = await first.inputValue();
    await first.fill(before.replace(/\.$/, "") + ", every week.");
    await snap(page, "script-edited");
    await page.getByRole("button", { name: "Save script and make the video again" }).click();
    const t0 = Date.now();
    await page.locator("#job-head .tag", { hasText: "In progress" }).waitFor({ timeout: 15000 }).catch(() => {});
    let st = "";
    while (Date.now() - t0 < 6 * 60 * 1000) {
      st = (await page.locator("#job-head .tag").first().textContent()) ?? "";
      if (st === "Ready" || st === "Problem") break;
      await page.waitForTimeout(1000);
    }
    check(st === "Ready", `the edited script renders again without reading the brief (${Math.round((Date.now() - t0) / 1000)} s)`);
    await snap(page, "rerendered");
  }

  // History lists the job.
  check((await page.locator("#history a", { hasText: /library/i }).count()) >= 1, "the video appears in Your videos");
}

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true });
  for (const f of fs.readdirSync(SHOTS)) if (f.endsWith(".png")) fs.rmSync(path.join(SHOTS, f));
  const server = await startServer();
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  // tsx adds a __name helper to functions passed to evaluate(); define it in the page.
  await page.addInitScript("globalThis.__name = globalThis.__name || ((f) => f);");
  page.on("pageerror", (e) => {
    console.log(`FAIL  page error: ${e.message}`);
    failures++;
  });
  try {
    if (!args.has("--no-brands")) await brandsFlow(page);
    if (!args.has("--no-video")) await makeFlow(page);
  } catch (e) {
    failures++;
    console.log(`FAIL  ${(e as Error).message}`);
    await snap(page, "error").catch(() => {});
  } finally {
    await browser.close();
    server?.kill();
  }
  console.log(failures ? `\n${failures} check(s) failed.` : "\nEvery check passed.");
  process.exit(failures ? 1 : 0);
}

main();
