// Checks and clean-up for files people add to a brand: logos, icons and graphics.
// Everything here works on bytes, so the web app can check an upload before saving it.

export interface ImageInfo {
  kind: "svg" | "png" | "jpeg" | "webp";
  width?: number;
  height?: number;
  /** For SVG: the viewBox, if it has one. */
  viewBox?: string;
  /** For SVG: the distinct fill and stroke colours it uses. */
  colours?: string[];
}

/** What kind of image some bytes are. Throws a plain-English error for anything else. */
export function inspectImage(bytes: Buffer, fileName = "file"): ImageInfo {
  if (bytes.length >= 24 && bytes.readUInt32BE(0) === 0x89504e47) {
    return { kind: "png", width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) return { kind: "jpeg", ...jpegSize(bytes) };
  if (bytes.length > 30 && bytes.toString("latin1", 0, 4) === "RIFF" && bytes.toString("latin1", 8, 12) === "WEBP") return { kind: "webp" };
  const text = bytes.toString("utf8").replace(/^﻿/, "").trim();
  if (/<svg\b/i.test(text.slice(0, 4000))) {
    const root = /<svg\b[^>]*>/i.exec(text)?.[0] ?? "";
    const attr = (n: string) => new RegExp(`\\s${n}\\s*=\\s*["']([^"']+)["']`, "i").exec(root)?.[1];
    const viewBox = attr("viewBox");
    const num = (v?: string) => (v && /^[\d.]+(px)?$/.test(v) ? parseFloat(v) : undefined);
    let width = num(attr("width"));
    let height = num(attr("height"));
    if (viewBox && (!width || !height)) {
      const p = viewBox.split(/[\s,]+/).map(Number);
      if (p.length === 4) {
        width ??= p[2];
        height ??= p[3];
      }
    }
    return { kind: "svg", width, height, viewBox, colours: svgColours(text) };
  }
  throw new Error(`${fileName} is not an image the engine can use. Use SVG (best) or PNG.`);
}

function jpegSize(b: Buffer): { width?: number; height?: number } {
  let i = 2;
  while (i < b.length - 9) {
    if (b[i] !== 0xff) return {};
    const marker = b[i + 1];
    const len = b.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
    i += 2 + len;
  }
  return {};
}

/** Distinct colours in an SVG's fill, stroke, stop-color and style attributes, upper-case hex. */
export function svgColours(svg: string): string[] {
  const set = new Set<string>();
  for (const m of svg.matchAll(/(?:fill|stroke|stop-color|color)\s*[:=]\s*["']?\s*(#[0-9a-f]{3,6}\b|rgb\([^)]*\)|black|white)/gi)) {
    let v = m[1].toLowerCase();
    if (v === "black") v = "#000000";
    if (v === "white") v = "#ffffff";
    if (/^#[0-9a-f]{3}$/.test(v)) v = "#" + [...v.slice(1)].map((c) => c + c).join("");
    set.add(v.toUpperCase());
  }
  return [...set];
}

/**
 * Remove anything active or external from an uploaded SVG: scripts, event handlers, external links,
 * foreign objects, embedded fonts and processing instructions. Keeps shapes, gradients and #fragment links.
 */
export function sanitiseUploadedSvg(svg: string): string {
  let s = svg
    .replace(/^﻿/, "")
    .replace(/<\?xml[^>]*>/gi, "")
    .replace(/<!DOCTYPE[\s\S]*?>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<script[\s\S]*?<\/script\s*>/gi, "")
    .replace(/<script\b[^>]*\/>/gi, "")
    .replace(/<foreignObject[\s\S]*?<\/foreignObject\s*>/gi, "")
    .replace(/<(iframe|embed|object|audio|video|animate\w*|set)\b[\s\S]*?(<\/\1\s*>|\/>)/gi, "")
    .replace(/<metadata[\s\S]*?<\/metadata\s*>/gi, "")
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s(href|xlink:href)\s*=\s*("(?!#)[^"]*"|'(?!#)[^']*')/gi, "")
    .replace(/url\(\s*["']?(?!#)[^)]*\)/gi, "none")
    .replace(/@import[^;]*;/gi, "")
    .trim();
  if (!/^<svg\b/i.test(s)) s = s.slice(s.search(/<svg\b/i));
  if (!/<svg\b/i.test(s)) throw new Error("This SVG has no <svg> element.");
  if (!/xmlns=/.test(s.slice(0, s.indexOf(">")))) s = s.replace(/<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"');
  return s + (s.endsWith("\n") ? "" : "\n");
}

export interface IconUploadResult {
  svg: string;
  warnings: string[];
  /** True when the icon's single colour was replaced with currentColor, so it takes brand colours. */
  recoloured: boolean;
}

/**
 * Prepare a client icon: sanitise it, make sure it has a viewBox, and replace a single fixed colour with
 * currentColor so scenes colour it from brand tokens. Icons with several colours are kept as they are,
 * with a warning, because recolouring them would lose meaning.
 */
export function prepareIconSvg(raw: string): IconUploadResult {
  const warnings: string[] = [];
  let svg = sanitiseUploadedSvg(raw);
  const info = inspectImage(Buffer.from(svg), "icon");
  if (!info.viewBox) {
    if (info.width && info.height) {
      svg = svg.replace(/<svg\b/i, `<svg viewBox="0 0 ${info.width} ${info.height}"`);
      warnings.push("The icon had no viewBox, so one was added from its width and height.");
    } else throw new Error("The icon has no viewBox or size, so it cannot be scaled. Export it again as SVG with a viewBox.");
  }
  const colours = (info.colours ?? []).filter((c) => c !== "NONE");
  let recoloured = false;
  if (colours.length === 1) {
    const c = colours[0];
    const short = c.length === 7 && c[1] === c[2] && c[3] === c[4] && c[5] === c[6] ? `#${c[1]}${c[3]}${c[5]}` : null;
    const variants = [c, c.toLowerCase(), ...(short ? [short, short.toLowerCase()] : [])];
    if (c === "#000000") variants.push("black", "BLACK", "Black");
    if (c === "#FFFFFF") variants.push("white", "WHITE", "White");
    for (const v of variants) svg = svg.split(v).join("currentColor");
    recoloured = true;
  } else if (colours.length > 1) {
    warnings.push(`The icon uses ${colours.length} colours (${colours.join(", ")}), so it keeps them and will not change with brand colours. Single-colour icons work best.`);
  } else if (!/currentColor/.test(svg)) {
    // No colour given: SVG draws black by default. Make that follow the brand.
    svg = svg.replace(/<svg\b/i, '<svg fill="currentColor"');
    recoloured = true;
  }
  if (/<text\b/i.test(svg)) warnings.push("The icon contains text. Convert text to outlines so it looks the same everywhere.");
  if (/<image\b/i.test(svg)) warnings.push("The icon contains an embedded picture, which can look soft. Use vector shapes only.");
  return { svg, warnings, recoloured };
}

/** Warnings for a logo upload. */
export function logoWarnings(info: ImageInfo): string[] {
  const w: string[] = [];
  if (info.kind === "png") {
    w.push("PNG logos can look soft. An SVG stays sharp at every size.");
    if (info.height && info.height < 300) w.push(`This PNG is only ${info.height} px tall. Use one at least 300 px tall, or an SVG.`);
  } else if (info.kind === "svg") {
    if (!info.viewBox) w.push("The logo SVG has no viewBox, so it may not scale well. Export it again with a viewBox.");
  } else {
    w.push(`${info.kind.toUpperCase()} logos are not accepted. Use SVG (best) or PNG.`);
  }
  return w;
}
