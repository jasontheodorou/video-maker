// Fast checks of the engine's rules. No voice or rendering, so it runs in seconds.
// Run: npm run selftest
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { decideSize } from "../engine/size";
import { validateSpec, validateBrand } from "../engine/api";
import { parseSpec } from "../engine/spec";
import { loadBrand } from "../engine/brand";
import { textFitCheck } from "../engine/lint";
import { computeTimeline } from "../engine/timing";
import { closeBrowser } from "../engine/browser";
import { groupWords, buildCaptions, fullyVisibleSeconds } from "../engine/captions";
import { captionFitter } from "../engine/captionfit";
import { matchWords } from "../engine/align";
import { contrastFixes } from "../engine/brand/fixes";
import { migrateBrand } from "../engine/brand/migrate";
import { recommendSchemes } from "../engine/brand/recommend";
import { contrastRatio } from "../engine/contrast";
import { resolveRef } from "../engine/colour-core";
import { compileStill } from "../engine/compile";
import { getScene } from "../engine/scenes";
import { assignSchemes } from "../engine/schemes";
import { resolveMotion } from "../engine/motion-plan";
import { motionCheck } from "../engine/lint";
import { peakEdgeSpeed } from "../engine/transitions";
import { readingSeconds } from "../engine/config";
import { BRANDS_DIR } from "../engine/paths";
import { main } from "./cli";

let failures = 0;
const getSceneSample = (type: string) => getScene(type).sample as Record<string, unknown>;
function expect(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `: ${detail}` : ""}`);
  if (!ok) failures++;
}

const base = {
  version: 1,
  brand: "demo",
  title: "Test",
  facts: { keyMessages: 1, purpose: "inform", channel: "social" },
  scenes: [
    { type: "title", beat: "hook", slots: { title: "Bins are changing" }, voiceover: ["Bins are changing."] },
    { type: "statement", beat: "message", slots: { text: "We collect every two weeks" }, voiceover: ["We collect every two weeks."] },
    { type: "end", beat: "action", slots: { action: "Find out more" }, voiceover: ["Find out more online."] },
  ],
};

main(async () => {
  // Size table.
  expect("one message on social is short", decideSize({ keyMessages: 1, purpose: "inform", channel: "social" }).size === "short");
  expect("three messages to explain is medium", decideSize({ keyMessages: 3, purpose: "explain", channel: "website" }).size === "medium");
  expect("five steps on the website is long", decideSize({ keyMessages: 2, purpose: "explain", channel: "website", steps: 5 }).size === "long");
  expect("four short messages on the website is medium", decideSize({ keyMessages: 4, purpose: "inform", channel: "website" }).size === "medium");
  expect("about 90 seconds asked for is long", decideSize({ keyMessages: 1, purpose: "explain", channel: "website", requestedSeconds: 90 }).size === "long");
  expect("about 45 seconds asked for is medium", decideSize({ keyMessages: 1, purpose: "inform", channel: "social", requestedSeconds: 45 }).size === "medium");
  expect("2 minutes asked for is long, the longest size", decideSize({ keyMessages: 1, purpose: "inform", channel: "social", requestedSeconds: 120 }).size === "long");
  expect("social caps long at medium", decideSize({ keyMessages: 5, purpose: "inform", channel: "social" }).size === "medium");

  // Spec rules.
  expect("a valid spec passes", validateSpec(base).ok);
  const unknown = validateSpec({ ...base, scenes: [base.scenes[0], { ...base.scenes[1], type: "spinning-cube" }, base.scenes[2]] });
  expect("an unknown scene type is rejected", !unknown.ok);
  const longTitle = validateSpec({ ...base, scenes: [{ ...base.scenes[0], slots: { title: "x".repeat(43) } }, base.scenes[1], base.scenes[2]] });
  expect("a title over 42 characters is rejected", !longTitle.ok);
  const noEnd = validateSpec({ ...base, scenes: [base.scenes[0], base.scenes[1]] });
  expect("a spec without an end card is rejected", !noEnd.ok);
  const html = validateSpec({ ...base, scenes: [{ ...base.scenes[0], slots: { title: "<b>Hi</b>" } }, base.scenes[1], base.scenes[2]] });
  expect("HTML in on-screen text is rejected", !html.ok);

  // Text fit: a long unbroken word fails in every format. It is never shrunk.
  const brand = loadBrand("demo");
  // Built from a valid spec, then given text over the limits, so that lint (not the schema) has to catch it.
  const tooWide = parseSpec(base);
  (tooWide.scenes[0].slots as Record<string, unknown>).title = "Pneumonoultramicroscopicsilicovolcanoconiosis is here";
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "va-selftest-"));
  const fit = await textFitCheck(tooWide, brand, null, ["16x9", "9x16", "1x1"], dir);
  const fitErrors = fit.filter((f) => f.level === "error" && f.check === "text-fit");
  expect("a word too long for the box fails text-fit", fitErrors.length >= 2, `${fitErrors.length} errors`);
  const tooLong = parseSpec(base);
  (tooLong.scenes[0].slots as Record<string, unknown>).title = "Garden waste and food waste collections are changing across every ward in the borough";
  const fit2 = await textFitCheck(tooLong, brand, null, ["16x9"], dir);
  expect("a long title runs over its line limit and fails", fit2.some((f) => f.level === "error"), fit2.map((f) => f.message).join(" | ").slice(0, 160));
  const good = await textFitCheck(parseSpec(base), brand, null, ["16x9", "9x16", "1x1"], dir);
  expect("the short sample spec fits", !good.some((f) => f.level === "error"), good.map((f) => f.message).join(" | "));
  fs.rmSync(dir, { recursive: true, force: true });

  // Contrast. The demo brand is still version 1 on disk: it loads through the migration.
  const raw = JSON.parse(fs.readFileSync(path.join(BRANDS_DIR, "demo", "brand.json"), "utf8"));
  expect("the demo brand passes AAA everywhere", validateBrand(raw, path.join(BRANDS_DIR, "demo")).ok);
  const bad = { ...raw, surfaces: { ...raw.surfaces, light: { background: "background", text: "text", accent: "accent" } } };
  const badCheck = validateBrand(bad, path.join(BRANDS_DIR, "demo"));
  const lightIssue = badCheck.issues.find((i) => i.field === "schemes.light.highlight");
  expect("yellow key words on white fail AAA, and only that scheme is left out", badCheck.ok && /^Fails AAA/.test(lightIssue?.message ?? "") && badCheck.schemes?.find((x) => x.id === "light")?.usable === false, lightIssue?.message ?? "no issue");

  // Reading time: even with very short voiceover, every text element stays up long enough.
  const spec = parseSpec(base);
  const fake = spec.scenes.map((s) => s.voiceover.map((text) => ({ text, file: "x.wav", audioSeconds: 0.6, words: text.split(" ").map((w, i) => ({ text: w, start: i * 0.1, end: i * 0.1 + 0.1, matched: true })) })));
  const tl = computeTimeline(spec, fake, null, { id: "bf_emma", speed: 1, file: "voice.wav", sampleRate: 24000 });
  const ok = tl.scenes.every((s) => s.text.every((t) => t.visibleUntil - t.visibleFrom + 1e-6 >= t.requiredSeconds));
  expect("every text element meets the reading-time rule", ok);
  expect("reading time for 10 words is 4.8 s", Math.abs(readingSeconds(10) - 4.8) < 1e-9);
  expect("scene times are whole frames", tl.scenes.every((s) => Math.abs(s.start * 30 - Math.round(s.start * 30)) < 1e-6 && Math.abs(s.duration * 30 - Math.round(s.duration * 30)) < 1e-6));

  // Captions.
  const w = "Residents who want to keep a weekly service can pay for an extra bin through the council website".split(" ").map((t) => ({ text: t, start: 0, end: 0, matched: true }));
  expect("captions are at most 6 words", groupWords(w).every((g) => g.length <= 6));
  expect("captions are at most 40 characters", groupWords(w).every((g) => g.map((i) => w[i].text).join(" ").length <= 40));
  // A web address cannot break, so 40 characters can still need 3 lines in portrait. The real width test splits it.
  const fits = captionFitter(loadBrand("demo"));
  const url = "Visit northvale.example/summer for more.".split(" ").map((t) => ({ text: t, start: 0, end: 0, matched: true }));
  const urlGroups = groupWords(url, 6, 40, fits ?? undefined).map((g) => g.map((i) => url[i].text).join(" "));
  expect("a caption with a web address is split to fit portrait", Boolean(fits) && urlGroups.length === 2 && urlGroups[0] === "Visit northvale.example/summer", urlGroups.join(" | "));

  // Quick speech: every caption is still fully visible for at least 1 second.
  const quick = "Close the lid, put it out by 7am, and bring it back in the same day. Four bins, each with its own day."
    .split(" ")
    .map((t, i) => ({ text: t, start: 0.3 + i * 0.28, end: 0.3 + i * 0.28 + 0.25, matched: true }));
  const cues = buildCaptions([{ words: quick, start: 0, end: quick[quick.length - 1].end + 0.2 }]);
  const shortest = Math.min(...cues.map((c) => fullyVisibleSeconds(c)));
  expect("fast speech still gives captions of at least 1 s", shortest >= 1 - 1e-6, `${shortest.toFixed(2)} s`);

  // Whisper can run one word (a long web address) past the end of the audio. Its times must not be used,
  // and the words after it must not be squeezed into the last moment.
  const heard = [
    { text: "Find", start: 0.1, end: 0.29 }, { text: "out", start: 0.29, end: 0.5 }, { text: "more", start: 0.5, end: 0.79 }, { text: "at", start: 0.79, end: 0.93 },
    { text: "Northvale.example.sprinkchangers.com", start: 1.06, end: 8.07 }, { text: "or", start: 8.07, end: 8.37 }, { text: "call", start: 8.37, end: 8.67 },
    { text: "0300", start: 8.67, end: 8.97 }, { text: "555", start: 8.97, end: 9.27 }, { text: "0199.", start: 9.27, end: 9.57 },
  ];
  const timed = matchWords("Find out more at northvale.example/spring-changes, or call 0300 555 0199.", heard, 8.192);
  const address = timed[4];
  const phone = timed[7];
  expect("a stretched whisper word is not trusted", !address.matched && address.end - address.start < 5, `${address.start.toFixed(2)} to ${address.end.toFixed(2)}`);
  expect("words after it are not squeezed to the end", phone.start < 7 && timed.every((t) => t.end - t.start >= 0.1), `phone number at ${phone.start.toFixed(2)} s`);

  // A word whisper times across a clear pause is moved off it (synthetic recording: speech, 0.45 s silence, speech).
  {
    const rate = 24000;
    const tone = (sec: number) => Array.from({ length: Math.round(sec * rate) }, (_, i) => Math.round(8000 * Math.sin(i / 7)));
    const silence = (sec: number) => new Array(Math.round(sec * rate)).fill(0);
    const samples = Int16Array.from([...silence(0.05), ...tone(1.6), ...silence(0.45), ...tone(0.9), ...silence(0.05)]);
    const heard = [
      { text: "Apply", start: 0.05, end: 0.4 }, { text: "at", start: 0.4, end: 0.5 }, { text: "northvale.example/permits,", start: 0.5, end: 1.3 },
      { text: "or", start: 1.3, end: 1.55 }, { text: "call", start: 1.55, end: 2.12 }, { text: "us.", start: 2.3, end: 3.0 },
    ];
    const timed = matchWords("Apply at northvale.example/permits, or call us.", heard, samples.length / rate, { samples, sampleRate: rate });
    const pauseEnd = 0.05 + 1.6 + 0.45;
    expect("no word runs across a clear pause in the voice", timed[3].start >= pauseEnd - 0.08 && timed[2].end <= 1.65 + 0.08, `"or" at ${timed[3].start.toFixed(2)} s, pause ends ${pauseEnd.toFixed(2)} s`);
  }

  // Contrast fixes: a failing scheme gets a fix that changes only that scheme, never a dead end.
  {
    const demo = JSON.parse(fs.readFileSync(path.join(process.cwd(), "brands", "demo", "brand.json"), "utf8"));
    demo.colours.primary.value = "#F2C200";
    const fixes = contrastFixes(demo);
    const textFix = fixes["schemes.dark.text"]?.find((f) => f.kind === "use");
    const migrated = migrateBrand(demo).raw as unknown as { palette: Parameters<typeof resolveRef>[1] };
    const valueOf = (ref: string) => resolveRef(ref, migrated.palette)!;
    expect("a fix can point the dark scheme's text at a colour that passes", !!textFix && contrastRatio(valueOf(textFix.colour!), "#F2C200") >= 7, textFix?.label ?? "none");
    const all = Object.values(fixes).flat();
    expect("recolour fixes never change a colour other schemes use", all.filter((f) => f.kind === "recolour" && f.path.startsWith("palette.")).every((f) => !/primary|background|text/.test(f.path)) && all.some((f) => /^Change .* to #/.test(f.label)), all.map((f) => f.label).slice(0, 4).join("; "));
  }

  // A logo the same colour as the dark background: that scheme can't open or close videos; another one does.
  {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "va-logo-"));
    fs.cpSync(path.join(process.cwd(), "brands", "demo"), dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "logo", "same.svg"), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 40"><rect width="100" height="40" fill="#0B3B60"/></svg>');
    const raw = JSON.parse(fs.readFileSync(path.join(dir, "brand.json"), "utf8"));
    raw.logo.onDark = "logo/same.svg";
    const v = validateBrand(raw, dir);
    const dark = v.schemes?.find((x) => x.id === "dark");
    expect("a logo that can't be seen on the dark scheme stops it opening and closing videos", dark?.usable === true && dark.bookends === false && v.issues.some((i) => i.field === "schemes.dark.logo" && /Can't see the logo/.test(i.message)), v.issues.find((i) => i.field === "schemes.dark.logo")?.message ?? "no issue");
    fs.writeFileSync(path.join(dir, "logo", "white.svg"), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 40"><rect width="100" height="40" fill="#FFFFFF"/></svg>');
    raw.logo.onLight = "logo/white.svg";
    const v2 = validateBrand(raw, dir);
    expect("with no scheme the logo shows on, the brand can't render", !v2.ok && v2.issues.some((i) => i.field === "schemes" && i.level === "error"));
    fs.rmSync(dir, { recursive: true, force: true });
  }

  // ---- colour model version 2 ----
  {
    const demoRaw = JSON.parse(fs.readFileSync(path.join(BRANDS_DIR, "demo", "brand.json"), "utf8"));
    const m = migrateBrand(demoRaw);
    const v2 = m.raw as { schemaVersion: number; schemes: Array<{ id: string }>; schemeUse: { mode: string } };
    expect("version 1 brands migrate to three schemes used by scene type", m.migrated && v2.schemaVersion === 2 && v2.schemes.map((x) => x.id).join() === "dark,light,tint" && v2.schemeUse.mode === "by-type");
    expect("migration is pure and repeatable", JSON.stringify(migrateBrand(demoRaw).raw) === JSON.stringify(m.raw) && JSON.stringify(migrateBrand(m.raw).raw) === JSON.stringify(m.raw));
    // The demo compiles to the same page from version 1 and from its migrated version 2.
    const a = compileStill({ type: "statement", slots: getSceneSample("statement"), id: "s1" }, loadBrand("demo"), "16x9").html;
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "va-v2-"));
    fs.cpSync(path.join(BRANDS_DIR, "demo"), tmp, { recursive: true });
    fs.writeFileSync(path.join(tmp, "brand.json"), JSON.stringify(m.raw));
    const b = compileStill({ type: "statement", slots: getSceneSample("statement"), id: "s1" }, loadBrand(tmp), "16x9").html;
    expect("the demo compiles the same from version 1 and version 2", a === b);
    fs.rmSync(tmp, { recursive: true, force: true });

    // Scheme assignment: by type for the migrated demo; spread with no equal neighbours and shared bookends.
    const demoBrand = loadBrand("demo");
    const byType = assignSchemes(parseSpec(base), demoBrand).scenes.map((c) => c.scheme);
    expect("migrated brands keep each scene type's old surface", byType.join() === "dark,light,dark", byType.join());
    const long = parseSpec({
      ...base,
      scenes: [base.scenes[0], base.scenes[1], { ...base.scenes[1] }, { type: "stat", beat: "proof", slots: { value: "45%", label: "of homes recycle" }, voiceover: ["Most homes recycle."] }, { ...base.scenes[1] }, base.scenes[2]],
    });
    const spread = assignSchemes({ ...long, look: { schemes: "spread" } }, demoBrand).scenes.map((c) => c.scheme);
    expect("spread: title and end share a scheme", spread[0] === spread[spread.length - 1], spread.join());
    expect("spread: no two neighbours share a scheme", spread.every((x, i) => i === 0 || x !== spread[i - 1]), spread.join());
    const single = assignSchemes({ ...long, look: { schemes: "single", scheme: "light" } }, demoBrand).scenes.map((c) => c.scheme);
    expect("one scheme for the whole video", single.every((x) => x === "light"), single.join());
    const singleTint = assignSchemes({ ...long, look: { schemes: "single", scheme: "tint" } }, { ...demoBrand, bookendSchemes: () => demoBrand.bookendSchemes().filter((x) => x.id !== "tint"), usableSchemes: () => demoBrand.usableSchemes().map((x) => (x.id === "tint" ? { ...x, bookends: false } : x)) }).scenes.map((c) => c.scheme);
    expect("one scheme the logo can't show on still opens and closes on a scheme it can", singleTint.slice(1, -1).every((x) => x === "tint") && singleTint[0] !== "tint" && singleTint[0] === singleTint[singleTint.length - 1], singleTint.join());
    const own = assignSchemes({ ...long, scenes: long.scenes.map((sc, i) => (i === 2 ? { ...sc, scheme: "tint" } : sc)) }, demoBrand);
    expect("a scene's own scheme wins", own.scenes[2].scheme === "tint" && own.scenes[2].auto === false);
    const wrong = validateSpec({ ...base, scenes: base.scenes.map((sc, i) => (i === 1 ? { ...sc, scheme: "nope" } : sc)) }, demoBrand);
    expect("an unknown scheme is refused before rendering", !wrong.ok && wrong.issues.some((i) => i.path === "scenes.1.scheme"));

    // Recommender: deterministic, and every suggestion passes.
    const rec = recommendSchemes(demoBrand.brand.palette, { emphasisWeightAvailable: false });
    expect("recommended schemes are the same every time", JSON.stringify(rec) === JSON.stringify(recommendSchemes(demoBrand.brand.palette, { emphasisWeightAvailable: false })));
    expect("every recommended scheme passes AAA", rec.schemes.every((x) => x.contrast.text >= 7 && x.contrast.highlight >= 7 && x.contrast.icon >= 3));
  }

  // ---- motion library ----
  {
    const demoBrand = loadBrand("demo");
    const calm = resolveMotion(parseSpec(base), demoBrand, ["dark", "light", "dark"]);
    expect("Calm uses crossfades and no text effects", calm.scenes.slice(1).every((x) => x.transition === "crossfade") && calm.scenes.every((x) => x.textEffect === "none" && x.shape === "none"));
    const long = parseSpec({ ...base, scenes: [base.scenes[0], { ...base.scenes[1], slots: { text: "We will collect your brown garden waste bin every two weeks from the start of next month" } }, base.scenes[2]] });
    const words = resolveMotion({ ...long, scenes: long.scenes.map((sc, i) => (i === 1 ? { ...sc, motion: { text: "words" as const } } : sc)) }, demoBrand, ["dark", "light", "dark"]);
    expect("word by word is refused on a long headline", words.problems.some((p) => p.scene === 1 && p.field === "motion.text" && /short titles/.test(p.message)));
    const push = resolveMotion({ ...base, scenes: base.scenes.map((sc, i) => (i === 1 ? { ...sc, motion: { transition: "cut" as const } } : sc)) } as never, demoBrand, ["light", "light", "dark"]);
    expect("a cut between matching scenes is refused", push.problems.some((p) => /glitch/.test(p.message)));
    const count = resolveMotion({ ...base, scenes: [base.scenes[0], { type: "stat", beat: "proof", slots: { value: "1 in 4", label: "homes" }, voiceover: ["One in four."], motion: { text: "count" } }, base.scenes[2]] } as never, demoBrand, ["dark", "tint", "dark"]);
    expect("count up is refused on a value that is not a single number", count.problems.some((p) => /single number/.test(p.message)));
    const lively = resolveMotion({ ...parseSpec(base), look: { motionStyle: "lively" } }, demoBrand, ["dark", "light", "dark"]);
    expect("Lively words the title and pushes or sweeps between scenes", lively.scenes[0].textEffect === "words" && ["push", "sweep"].includes(lively.scenes[1].transition));
    const photoNext = resolveMotion({ ...parseSpec(base), look: { motionStyle: "lively" }, scenes: [base.scenes[0], { type: "photo", beat: "message", slots: { photo: { src: "park-trail.jpg" } }, voiceover: ["A park."] }, base.scenes[2]] } as never, demoBrand, ["dark", "dark", "dark"]);
    expect("automatic choices next to a photo become crossfades", photoNext.scenes.slice(1).every((x) => x.transition === "crossfade") && photoNext.problems.length === 0);
    expect("every transition edge stays under 212 px a frame", ["wipe", "push", "sweep"].every((t) => peakEdgeSpeed(t as never, 1920) <= 212));
    // Text stays settled for most of its time on screen, whatever the style.
    for (const style of ["calm", "crisp", "lively", "still"] as const) {
      const sp = { ...parseSpec(base), look: { motionStyle: style } };
      const tl = computeTimeline(sp, fake, null, { id: "bf_emma", speed: 1, file: "voice.wav", sampleRate: 24000 }, { brand: demoBrand });
      const mc = motionCheck(sp, tl, demoBrand).filter((f) => f.level === "error");
      expect(`${style}: timing passes the motion rules`, mc.length === 0, mc.map((f) => f.message).join(" | "));
    }
  }

  await closeBrowser();
  if (failures) throw new Error(`${failures} check(s) failed`);
  console.log("\nAll checks passed.");
});
