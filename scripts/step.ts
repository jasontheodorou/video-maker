// Run one pipeline step on a job: npm run <step> -- jobs/<name>
// Steps: size, voice, align, timing, compile, lint, sheet, render.
import { openJob, reporter, stepSize, stepVoice, stepAlign, stepTiming, stepCompile, stepLint, stepSheet, stepRender, STEPS, type StepName } from "../engine/pipeline";
import { closeBrowser } from "../engine/browser";
import { parseArgs, formatsFlag, printProgress, main } from "./cli";

main(async () => {
  const args = parseArgs();
  const [step, jobDir] = args.positional as [StepName, string];
  if (!STEPS.includes(step) || !jobDir) {
    console.error(`Usage: npm run <step> -- jobs/<name>   (steps: ${STEPS.join(", ")})`);
    process.exit(2);
  }
  const ctx = openJob(jobDir);
  const f = formatsFlag(args);
  if (f) ctx.formats = f;
  const report = reporter(ctx.job, [step], printProgress);
  try {
    switch (step) {
      case "size": stepSize(ctx, report); break;
      case "voice": await stepVoice(ctx, report); break;
      case "align": await stepAlign(ctx, report); break;
      case "timing": stepTiming(ctx, report); break;
      case "compile": stepCompile(ctx, report); break;
      case "lint": await stepLint(ctx, report); break;
      case "sheet": await stepSheet(ctx, report); break;
      case "render": await stepRender(ctx, { draft: !!args.flags.draft, final: !args.flags["no-final"], softwareGpu: !!args.flags["software-gpu"] }, report); break;
    }
  } finally {
    await closeBrowser();
  }
});
