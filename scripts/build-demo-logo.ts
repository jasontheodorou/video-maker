// Builds the fictional Northvale Council logo (SVG) for brands/demo.
// The words are converted to vector outlines with fontkit, so the SVG needs no font and stays sharp.
// Run: npx tsx scripts/build-demo-logo.ts
import fs from "node:fs";
import path from "node:path";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fontkit = require("fontkit");
import { ROOT } from "../engine/paths";

const brandDir = path.join(ROOT, "brands", "demo");
const bold = fontkit.openSync(path.join(brandDir, "fonts", "atkinson-hyperlegible-next-latin-700-normal.woff2"));
const regular = fontkit.openSync(path.join(brandDir, "fonts", "atkinson-hyperlegible-next-latin-400-normal.woff2"));

const NAVY = "#0B3B60";
const INK = "#0B0C0C";
const WHITE = "#FFFFFF";
const YELLOW = "#FFD84D";

/** Lay out a string as one SVG path at (x, baseline y) with the given font size. */
function textPath(font: any, text: string, x: number, y: number, size: number): { d: string; width: number } {
  const run = font.layout(text);
  const scale = size / font.unitsPerEm;
  let pen = 0;
  const parts: string[] = [];
  run.glyphs.forEach((g: any, i: number) => {
    const pos = run.positions[i];
    const ox = x + (pen + pos.xOffset) * scale;
    const oy = y - pos.yOffset * scale;
    const cmds = g.path.commands as Array<{ command: string; args: number[] }>;
    let d = "";
    for (const c of cmds) {
      const a = c.args;
      const P = (ix: number) => `${(ox + a[ix] * scale).toFixed(2)} ${(oy - a[ix + 1] * scale).toFixed(2)}`;
      if (c.command === "moveTo") d += `M${P(0)}`;
      else if (c.command === "lineTo") d += `L${P(0)}`;
      else if (c.command === "quadraticCurveTo") d += `Q${P(0)} ${P(2)}`;
      else if (c.command === "bezierCurveTo") d += `C${P(0)} ${P(2)} ${P(4)}`;
      else if (c.command === "closePath") d += "Z";
    }
    parts.push(d);
    pen += pos.xAdvance;
  });
  return { d: parts.join(""), width: pen * scale };
}

function mark(variant: "light" | "dark"): string {
  // 100 x 100 mark: a rounded square, two hills meeting in a vale, and a north chevron.
  const hills = "M12 80 L37 44 L50 60 L63 44 L88 80 Z";
  const chevron = "M40 31 L50 19 L60 31";
  if (variant === "light") {
    return `<rect x="0" y="0" width="100" height="100" rx="14" fill="${NAVY}"/>` +
      `<path d="${hills}" fill="${WHITE}"/>` +
      `<path d="${chevron}" fill="none" stroke="${YELLOW}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>`;
  }
  return `<rect x="3" y="3" width="94" height="94" rx="12" fill="none" stroke="${WHITE}" stroke-width="6"/>` +
    `<path d="${hills}" fill="${WHITE}"/>` +
    `<path d="${chevron}" fill="none" stroke="${YELLOW}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>`;
}

function logo(variant: "light" | "dark"): string {
  const textColour = variant === "light" ? INK : WHITE;
  const line1 = textPath(bold, "Northvale", 124, 50, 52);
  const line2 = textPath(regular, "Council", 124, 96, 40);
  const width = Math.ceil(124 + Math.max(line1.width, line2.width) + 4);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} 100" width="${width}" height="100" role="img" aria-label="Northvale Council (fictional)">` +
    `<title>Northvale Council</title>` +
    mark(variant) +
    `<path d="${line1.d}" fill="${textColour}"/>` +
    `<path d="${line2.d}" fill="${textColour}"/>` +
    `</svg>\n`;
}

fs.mkdirSync(path.join(brandDir, "logo"), { recursive: true });
fs.writeFileSync(path.join(brandDir, "logo", "northvale-logo.svg"), logo("light"));
fs.writeFileSync(path.join(brandDir, "logo", "northvale-logo-white.svg"), logo("dark"));
fs.writeFileSync(
  path.join(brandDir, "logo", "northvale-mark.svg"),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100" role="img" aria-label="Northvale Council mark (fictional)"><title>Northvale Council mark</title>${mark("light")}</svg>\n`,
);
console.log("Wrote brands/demo/logo/northvale-logo.svg, northvale-logo-white.svg and northvale-mark.svg");
