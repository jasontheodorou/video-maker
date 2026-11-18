// WCAG 2.2 contrast. The engine requires AAA (7 to 1) for every piece of text, at every size.
// The maths lives in colour-core.ts (pure, shared with the web app); this file adds plain-English results.
export {
  AAA,
  AA,
  AAA_SAFE,
  NON_TEXT,
  MIN_HIGHLIGHT_DIFFERENCE,
  MIN_SHAPE_DIFFERENCE,
  parseHex,
  toHex,
  luminance,
  contrastRatio,
  colourDifference,
  suggestPassingColour,
  mixWithWhite,
  ratioWords,
} from "./colour-core";
import { AAA, AA, contrastRatio, suggestPassingColour } from "./colour-core";

export interface ContrastResult {
  foreground: string;
  background: string;
  ratio: number;
  /** Ratio rounded down to two decimals, so 6.999 never shows as 7.00. */
  ratioText: string;
  passesAAA: boolean;
  passesAA: boolean;
  message: string;
  /** A foreground colour close to the original that passes AAA, when it fails. */
  suggestion?: string;
}

export function checkContrast(
  foreground: string,
  background: string,
  labels: { foreground?: string; background?: string } = {},
): ContrastResult {
  const ratio = contrastRatio(foreground, background);
  const ratioText = (Math.floor(ratio * 100) / 100).toFixed(2);
  const passesAAA = ratio >= AAA;
  const fg = labels.foreground ?? foreground.toUpperCase();
  const bg = labels.background ?? background.toUpperCase();
  let message: string;
  let suggestion: string | undefined;
  if (passesAAA) {
    message = `${fg} on ${bg} has a contrast of ${ratioText} to 1. This passes AAA (7 to 1).`;
  } else {
    suggestion = suggestPassingColour(foreground, background) ?? undefined;
    message =
      `${fg} on ${bg} has a contrast of ${ratioText} to 1. Text needs 7 to 1 to pass AAA. ` +
      (suggestion
        ? `Try ${suggestion} for the text, or change the background.`
        : `Use a much darker or much lighter colour for one of them.`);
  }
  return { foreground, background, ratio, ratioText, passesAAA, passesAA: ratio >= AA, message, suggestion };
}
