// One command runs everything: npm run make -- jobs/<name>
// Flags:
//   --draft            also make quick 30 fps drafts in out/draft/
//   --no-final         skip the final renders
//   --until=<step>     stop after a step (for example --until=sheet to review first)
//   --from=<step>      start at a step, reusing earlier files
//   --formats=16x9,1x1 only some formats
//   --software-gpu     render with software Chrome (slower, identical on any machine)
import path from "node:path";
import { makeVideo } from "../engine/pipeline";
import { parseArgs, jobArg, formatsFlag, stepFlag, printProgress, main } from "./cli";

main(async () => {
  const args = parseArgs();
  const job = jobArg(args, "npm run make -- jobs/<name> [--draft] [--no-final] [--until=<step>] [--from=<step>] [--formats=16x9,9x16,1x1]");
  const t0 = Date.now();
  const res = await makeVideo(
    job,
    {
      draft: !!args.flags.draft,
      final: !args.flags["no-final"],
      until: stepFlag(args, "until"),
      from: stepFlag(args, "from"),
      formats: formatsFlag(args),
      softwareGpu: !!args.flags["software-gpu"],
    },
    printProgress,
  );
  console.log(`\nDone in ${((Date.now() - t0) / 1000).toFixed(1)} s. Size ${res.decision.size}, length ${res.timeline.duration.toFixed(2)} s.`);
  if (res.sheet) console.log(`Contact sheet: ${path.relative(process.cwd(), res.sheet)}`);
  console.log(`Subtitles: ${path.relative(process.cwd(), res.srt)}`);
  for (const o of res.outputs) console.log(`${o.kind} ${o.format}: ${path.relative(process.cwd(), o.file)} (${o.probe.width}x${o.probe.height}, ${o.probe.fps} fps, ${o.probe.duration.toFixed(2)} s, rendered in ${o.seconds.toFixed(1)} s)`);
});
