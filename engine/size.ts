// Size step: a fixed rule table picks short, medium or long from the spec's facts.
// Claude only extracts facts; the engine decides. Every reason is written to decision.json.
import { loadConfig, SIZE_IDS, type SizeId, type SizeRule } from "./config";
import type { Spec } from "./spec";
import { voiceoverWordCount } from "./spec";
import type { Decision, Facts } from "./schema";

function ruleMatches(rule: SizeRule, f: Facts): boolean {
  const w = rule.when;
  if (w.stepsAtLeast != null && (f.steps ?? 0) < w.stepsAtLeast) return false;
  if (w.keyMessagesAtLeast != null && f.keyMessages < w.keyMessagesAtLeast) return false;
  if (w.purposeIn && !w.purposeIn.includes(f.purpose)) return false;
  if (w.channelIn && !w.channelIn.includes(f.channel)) return false;
  return true;
}

/** Plain names for the channels, for the reasons people read. */
const CHANNEL_WORDS: Record<string, string> = { social: "social media", website: "a website", email: "email", screens: "screens in public places", presentation: "presentations", internal: "staff" };

/** The size whose range holds a length in seconds, or the nearest one. */
export function sizeForSeconds(seconds: number): SizeId {
  const cfg = loadConfig();
  let best: SizeId = SIZE_IDS[0];
  let bestGap = Infinity;
  for (const id of SIZE_IDS) {
    const t = cfg.sizes[id];
    const gap = seconds < t.minSeconds ? t.minSeconds - seconds : seconds > t.maxSeconds ? seconds - t.maxSeconds : 0;
    if (gap < bestGap) {
      best = id;
      bestGap = gap;
    }
  }
  return best;
}

export function decideSize(facts: Facts): { size: SizeId; rule: string; reasons: string[] } {
  const cfg = loadConfig();
  if (facts.requestedSeconds) {
    const s = facts.requestedSeconds;
    const size = sizeForSeconds(s);
    const t = cfg.sizes[size];
    const fits = s >= t.minSeconds && s <= t.maxSeconds;
    const longest = cfg.sizes[SIZE_IDS[SIZE_IDS.length - 1]].maxSeconds;
    const shortest = cfg.sizes[SIZE_IDS[0]].minSeconds;
    const reasons = [`The brief asks for a video of about ${s} seconds.`];
    if (!fits)
      reasons.push(
        s > longest
          ? `The longest video the engine makes is ${longest} seconds, so this one is ${size}.`
          : s < shortest
            ? `The shortest video the engine makes is ${shortest} seconds, so this one is ${size}.`
            : `That is between the engine's sizes, so this one is ${size}, the nearest.`,
      );
    return { size, rule: "requested-seconds", reasons };
  }
  if (facts.requestedSize) {
    return { size: facts.requestedSize, rule: "requested", reasons: [`The brief asks for a ${facts.requestedSize} video.`] };
  }
  const rule = cfg.sizeRules.find((r) => ruleMatches(r, facts));
  if (!rule) throw new Error("No size rule matched. The last rule in config/engine.json should match everything.");
  let size = rule.size;
  const reasons = [rule.reason];
  const cap = cfg.channelCaps[facts.channel];
  if (cap && SIZE_IDS.indexOf(size) > SIZE_IDS.indexOf(cap)) {
    reasons.push(`Videos for ${CHANNEL_WORDS[facts.channel] ?? facts.channel} are kept ${cap} or shorter, so this one is ${cap}.`);
    size = cap;
  }
  return { size, rule: rule.id, reasons };
}

export class SizeError extends Error {}

/** Decide the size for a spec and check its script fits the word budget. */
export function makeDecision(spec: Spec): Decision {
  const cfg = loadConfig();
  const { size, rule, reasons } = decideSize(spec.facts);
  const target = cfg.sizes[size];
  const wps = cfg.voice.wordsPerSecond;
  const budget = Math.floor(target.maxSeconds * wps * cfg.voice.budgetFactor);
  const minWords = Math.floor(target.minSeconds * wps * 0.5);
  const wordCount = voiceoverWordCount(spec);
  const warnings: string[] = [];
  const beatsFound = spec.scenes.map((s) => s.beat);
  const expected = target.beats;
  for (const b of new Set(expected)) if (!beatsFound.includes(b as never)) warnings.push(`A ${size} video usually has a "${b}" beat. This spec has none.`);
  if (wordCount < minWords) warnings.push(`The script has ${wordCount} words. A ${size} video usually needs at least ${minWords}. The engine will hold scenes longer to reach ${target.minSeconds} seconds.`);
  reasons.push(`A ${size} video lasts ${target.minSeconds} to ${target.maxSeconds} seconds, which leaves room for about ${budget} spoken words.`);
  const decision: Decision = {
    version: 1,
    size,
    targetSeconds: { min: target.minSeconds, max: target.maxSeconds },
    rule,
    reasons,
    facts: spec.facts,
    ...(spec.facts.requestedSeconds ? { requestedSeconds: spec.facts.requestedSeconds } : {}),
    wordCount,
    wordBudget: budget,
    wordsPerSecond: wps,
    beatsExpected: expected,
    beatsFound,
    warnings,
  };
  if (wordCount > budget) {
    throw Object.assign(
      new SizeError(
        `The script has ${wordCount} words. A ${size} video allows ${budget}. Cut ${wordCount - budget} words, or change the facts if this really is a longer video.`,
      ),
      { decision },
    );
  }
  return decision;
}
