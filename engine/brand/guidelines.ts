// Read brand guidelines (PDF, Markdown or plain text) and suggest brand tokens from them.
// Suggestions are never applied silently: the web app shows them and the person confirms each one.
import fs from "node:fs";
import path from "node:path";
import { normaliseHex } from "./palette";
import { cachedOpenFonts } from "./fonts";
import { toHex } from "../contrast";
import { KOKORO_VOICES } from "../voice";

export interface GuidelinesText {
  text: string;
  /** Number of pages, for PDFs. */
  pages?: number;
  kind: "pdf" | "text";
  /** Problems reading the file, such as a scanned PDF with no text. */
  warnings: string[];
}

/** Text from a guidelines file: PDF, Markdown or plain text. Pass a path, or bytes and a file name. */
export async function extractGuidelinesText(input: string | Buffer, fileName?: string): Promise<GuidelinesText> {
  const name = (fileName ?? (typeof input === "string" ? input : "")).toLowerCase();
  const bytes = typeof input === "string" ? fs.readFileSync(input) : input;
  const isPdf = name.endsWith(".pdf") || bytes.subarray(0, 5).toString("latin1") === "%PDF-";
  if (!isPdf) {
    if (/\.(docx?|pptx?|key|pages|indd|ai)$/.test(name)) throw new Error(`The engine cannot read ${path.extname(name)} files. Save the guidelines as a PDF or plain text.`);
    return { text: bytes.toString("utf8").replace(/\r\n/g, "\n"), kind: "text", warnings: [] };
  }
  const pdfjs: any = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: false, isEvalSupported: false, disableFontFace: true, verbosity: 0 });
  let doc: any;
  try {
    doc = await task.promise;
  } catch (e) {
    throw new Error(`The PDF could not be read (${(e as Error).message}). If it has a password, remove it and try again.`);
  }
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    // Rebuild lines from text positions so tables and colour swatches read in order.
    let line = "";
    let lastY: number | null = null;
    const lines: string[] = [];
    for (const item of content.items as Array<{ str: string; transform: number[]; hasEOL?: boolean }>) {
      if (typeof item.str !== "string") continue;
      const y = Math.round(item.transform[5]);
      if (lastY !== null && Math.abs(y - lastY) > 2) {
        lines.push(line.trim());
        line = "";
      }
      line += (line && !line.endsWith(" ") && !item.str.startsWith(" ") ? " " : "") + item.str;
      lastY = y;
      if (item.hasEOL) {
        lines.push(line.trim());
        line = "";
        lastY = null;
      }
    }
    if (line.trim()) lines.push(line.trim());
    pages.push(lines.filter(Boolean).join("\n"));
    page.cleanup();
  }
  const numPages = doc.numPages as number;
  await task.destroy();
  const text = pages.join("\n\n");
  const warnings: string[] = [];
  if (text.replace(/\s/g, "").length < 50 * numPages) {
    warnings.push("Little or no text was found. The PDF may be scanned images. Type the key colours, fonts and rules into the form instead.");
  }
  return { text, pages: numPages, kind: "pdf", warnings };
}

export interface SuggestedColour {
  value: string;
  name?: string;
  /** Role hinted by the words around it, such as primary or text. */
  role?: string;
  /** The line it was found on. */
  context: string;
  /** How the value was written: hex, rgb or cmyk (cmyk is converted roughly). */
  from: "hex" | "rgb" | "cmyk";
  /** Index of the line it was found on. */
  line?: number;
  /** Palette group from the heading it sits under: core, accent, secondary or neutral. */
  group?: string;
  /** For a listed tint ("Golden" under "10% tints"): the parent colour's name, and the step. */
  tintOf?: string;
  tintStep?: 10 | 25;
}

export interface SuggestedFont {
  family: string;
  /** Heading or body, when the text says. */
  role?: "heading" | "body";
  context: string;
  /** True when it is a known open font that can be downloaded. */
  openFont: boolean;
}

export interface TokenSuggestions {
  name?: string;
  colours: SuggestedColour[];
  fonts: SuggestedFont[];
  toneOfVoice?: string;
  rules: { do: string[]; dont: string[] };
  logo: { minHeightPx?: number; notes: string[] };
  iconWeight?: "thin" | "light" | "regular" | "bold" | "fill" | "duotone";
  voice?: { id: string; reason: string };
  /** Short summary of the guidelines for the brief interpreter (the brand's free-text guidelines). */
  guidelines: string;
  /** What could not be found, in plain English. */
  gaps: string[];
  /** Colour groups, listed tints and colour rules ("Text should be in navy or black"). */
  colourRules?: ColourStructure["rules"];
}

/** Role words, used only when the colour's name says so or the text says "<role> colour". */
const ROLE_WORDS: Array<[RegExp, string]> = [
  [/\b(primary|main|core|lead|corporate|master)( brand)? colou?r\b|^primary\b/i, "primary"],
  [/\b(text|body text|body copy|type) colou?r\b|^text\b/i, "text"],
  [/\bbackground colou?r\b|^background\b/i, "background"],
  [/\b(accent|highlight|secondary) colou?r\b|^accent\b/i, "accent"],
  [/\btint colou?r\b|^tint\b/i, "tint"],
];

/** Pull suggested tokens out of guidelines text. Never throws. */
export function suggestTokensFromText(text: string): TokenSuggestions {
  const lines = text.split(/\n/).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  const gaps: string[] = [];

  // ---- colours ----
  const colours: SuggestedColour[] = [];
  const seen = new Set<string>();
  const addColour = (value: string, i: number, from: SuggestedColour["from"], matchIndex: number) => {
    if (!value || seen.has(value)) return;
    seen.add(value);
    const line = lines[i];
    const before = line.slice(0, matchIndex);
    // A name is the words just before the value on the line, or the line above when the line holds only codes.
    const codesOnly = /^[#\s\w:,().%/-]*$/.test(line) && !/[a-z]{3,}/i.test(before.replace(/\b(hex|rgb|cmyk|pantone|pms|ral)\b/gi, ""));
    let name = colourName(before) ?? (i > 0 && codesOnly ? colourName(lines[i - 1]) : undefined);
    if (!name && i > 1 && codesOnly && /^\s*(hex|rgb|cmyk)\b/i.test(lines[i - 1])) name = colourName(lines[i - 2]);
    if (name && name.length > 40) name = name.slice(0, 40).trim();
    const role = ROLE_WORDS.find(([re]) => (name && re.test(name)) || re.test(line))?.[1];
    colours.push({ value, name, role, context: line.slice(0, 160), from, line: i });
  };
  // A colour usually lists hex, RGB and CMYK on lines next to each other. When it gives a hex value, the RGB and CMYK
  // lines near it are the same colour (and guides have typos in them), so only the hex value is read.
  const hexNear = (i: number) => [i - 2, i - 1, i, i + 1, i + 2].some((k) => k >= 0 && k < lines.length && /#\s?[0-9a-f]{6}\b|\bhex\s*:?\s*#?\s?[0-9a-f]{6}\b/i.test(lines[k]));
  lines.forEach((line, i) => {
    for (const m of line.matchAll(/#\s?([0-9a-f]{6}|[0-9a-f]{3})\b/gi)) addColour(normaliseHex(m[1]), i, "hex", m.index ?? 0);
    for (const m of line.matchAll(/\bhex\s*:?\s*([0-9a-f]{6})\b/gi)) addColour(normaliseHex(m[1]), i, "hex", m.index ?? 0);
    if (hexNear(i)) return;
    for (const m of line.matchAll(/\bR\s*:?\s*(\d{1,3})\s*,?\s*G\s*:?\s*(\d{1,3})\s*,?\s*B\s*:?\s*(\d{1,3})\b/g)) addColour(rgbHex(m[1], m[2], m[3]), i, "rgb", m.index ?? 0);
    for (const m of line.matchAll(/\bRGB\s*:?\s*\(?\s*(\d{1,3})[\s,/]+(\d{1,3})[\s,/]+(\d{1,3})\b/gi)) addColour(rgbHex(m[1], m[2], m[3]), i, "rgb", m.index ?? 0);
    for (const m of line.matchAll(/\brgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)/gi)) addColour(rgbHex(m[1], m[2], m[3]), i, "rgb", m.index ?? 0);
    // CMYK only when the line has no RGB or hex value: the conversion is rough.
    if (!/#[0-9a-f]{3,6}\b|\bRGB\b|\bhex\b/i.test(line)) {
      for (const m of line.matchAll(/\bC\s*:?\s*(\d{1,3})\s*,?\s*M\s*:?\s*(\d{1,3})\s*,?\s*Y\s*:?\s*(\d{1,3})\s*,?\s*K\s*:?\s*(\d{1,3})\b/g)) addColour(cmykHex(+m[1], +m[2], +m[3], +m[4]), i, "cmyk", m.index ?? 0);
    }
  });
  const structure = extractColourStructure(lines, colours);
  if (!colours.length) gaps.push("No colour values (hex, RGB or CMYK) were found.");
  if (colours.some((c) => c.from === "cmyk")) gaps.push("Some colours were only given as CMYK. They were converted roughly; check them against the screen (RGB or hex) values.");

  // ---- fonts ----
  const fonts: SuggestedFont[] = [];
  const known = cachedOpenFonts();
  const fontLines = lines.filter((l) => /\b(font|typeface|typography|type family|typefaces|headings?|body text|body copy)\b/i.test(l));
  const addFont = (family: string, context: string, openFont: boolean) => {
    const fam = family.replace(/\s+(Regular|Bold|Light|Medium|Semibold|Book|Italic|Pro|Std)$/i, "").trim();
    if (!fam || fonts.some((f) => f.family.toLowerCase() === fam.toLowerCase())) return;
    const role = /\bhead(ing|line)s?\b|title/i.test(context) ? "heading" : /\bbody|paragraph|copy\b/i.test(context) ? "body" : undefined;
    fonts.push({ family: fam, role, context: context.slice(0, 160), openFont });
  };
  if (known) {
    const families = known.map((f) => f.family).filter((f) => f.length > 3).sort((a, b) => b.length - a.length);
    for (const l of lines) {
      for (const fam of families) {
        if (l.includes(fam) && new RegExp(`(^|[^A-Za-z])${escapeRe(fam)}([^A-Za-z]|$)`).test(l)) {
          addFont(fam, l, true);
          break;
        }
      }
    }
  }
  for (const l of fontLines) {
    const m = /(?:typeface|font(?: family)?|typography)\s*(?:is|:|-|–)\s*([A-Z][\w]*(?:\s+[A-Z0-9][\w]*){0,3})/.exec(l) ?? /\b(?:use|uses|set in)\s+([A-Z][\w]*(?:\s+[A-Z0-9][\w]*){0,3})\s+(?:for|font|typeface)/.exec(l);
    if (m && !fonts.some((f) => f.family.toLowerCase().startsWith(m[1].toLowerCase()))) addFont(m[1], l, Boolean(known?.some((f) => f.family.toLowerCase() === m[1].toLowerCase())));
  }
  if (!fonts.length) gaps.push("No font names were found.");
  if (fonts.some((f) => !f.openFont)) gaps.push(`These fonts cannot be downloaded here, so upload their font files in the Fonts section: ${fonts.filter((f) => !f.openFont).map((f) => f.family).join(", ")}.`);

  // ---- sections: tone of voice, do and don't ----
  const sections = splitSections(lines);
  const toneSection = sections.find((s) => /tone of voice|voice and tone|tone\b|writing style|how we write|our voice/i.test(s.heading));
  const toneOfVoice = toneSection ? toneSection.body.join("\n").slice(0, 1500) : undefined;
  if (!toneOfVoice) gaps.push("No tone of voice section was found.");

  const rules = { do: [] as string[], dont: [] as string[] };
  for (const s of sections) {
    const isDont = /\b(don'?t|do not|avoid|never|misuse|incorrect)\b/i.test(s.heading);
    const isDo = !isDont && /^(do|dos|do's|always|correct use|good practice)\b/i.test(s.heading);
    for (const raw of s.body) {
      const l = raw.replace(/^[-•*✓✔✗✘×]\s*/, "").trim();
      if (l.length < 6 || l.length > 300) continue;
      if (isDont) rules.dont.push(l);
      else if (isDo) rules.do.push(l);
    }
  }
  for (const raw of lines) {
    const l = raw.replace(/^[-•*✓✔✗✘×]\s*/, "").trim();
    if (l.length < 12 || l.length > 300) continue;
    if (/^(do not|don'?t|never|avoid)\b/i.test(l) && !rules.dont.includes(l)) rules.dont.push(l);
    else if (/^(always)\b/i.test(l) && !rules.do.includes(l)) rules.do.push(l);
  }
  rules.do = rules.do.slice(0, 20);
  rules.dont = rules.dont.slice(0, 20);

  // ---- logo ----
  const logoNotes = lines.filter((l) => /\blogo\b/i.test(l) && /(clear ?space|exclusion|minimum|smallest|never|do not|don'?t|size)/i.test(l)).slice(0, 8);
  let minHeightPx: number | undefined;
  for (const l of logoNotes) {
    const m = /minimum[^.]*?(\d{2,3})\s*px/i.exec(l);
    if (m) minHeightPx = Math.min(240, Math.max(24, +m[1]));
  }

  // ---- icons ----
  let iconWeight: TokenSuggestions["iconWeight"];
  const iconLine = lines.find((l) => /\bicons?\b/i.test(l) && /\b(line|outline|stroke|filled|solid|duotone|two-tone|thin|light|bold)\b/i.test(l));
  if (iconLine) {
    iconWeight = /duotone|two-tone/i.test(iconLine) ? "duotone" : /filled|solid/i.test(iconLine) ? "fill" : /\bthin\b/i.test(iconLine) ? "thin" : /\blight\b/i.test(iconLine) ? "light" : /\bbold|heavy|thick\b/i.test(iconLine) ? "bold" : "regular";
  }

  // ---- voice ----
  let voice: TokenSuggestions["voice"];
  const all = lines.join(" ");
  if (/\b(male|man's|men's) voice\b/i.test(all)) voice = { id: "bm_george", reason: "The guidelines mention a male voice." };
  else if (/\b(female|woman's|women's) voice\b/i.test(all)) voice = { id: "bf_emma", reason: "The guidelines mention a female voice." };
  if (voice && !(KOKORO_VOICES as readonly unknown[]).some((v) => (typeof v === "string" ? v : (v as { id: string }).id) === voice!.id)) voice = undefined;

  // ---- name ----
  const nameLine = lines.slice(0, 8).find((l) => /brand (guidelines|guide|book|standards)|visual identity|style guide/i.test(l));
  const name = nameLine?.replace(/^#+\s*/, "").replace(/\b(brand (guidelines|guide|book|standards)|visual identity( guidelines)?|style guide)\b.*$/i, "").replace(/[-–:|]+\s*$/, "").trim() || undefined;

  // ---- summary for the brief interpreter ----
  const keep = sections
    .filter((s) => /writ|voice|tone|messag|audience|values|personality|accessib|imagery|photo|icon|motion|video|caption/i.test(s.heading))
    .map((s) => `${s.heading}\n${s.body.slice(0, 12).map((b) => `- ${b.replace(/^[-•*]\s*/, "")}`).join("\n")}`);
  const guidelines = keep.join("\n\n").slice(0, 6000);

  return { name, colours: structure.colours, fonts, toneOfVoice, rules, logo: { minHeightPx, notes: logoNotes }, iconWeight, voice, guidelines, gaps, colourRules: structure.rules };
}

// ---------- colour structure: groups, listed tints and colour rules ----------

export interface ColourStructure {
  colours: SuggestedColour[];
  rules: { text?: string[]; never?: Array<{ text: string; background: string }>; source?: string };
}

const GROUP_WORDS: Array<[RegExp, string]> = [
  [/\b(core|primary|main|corporate)\b/i, "core"],
  [/\b(accent|highlight)\b/i, "accent"],
  [/\b(secondary|supporting|design|extended|complementary)\b/i, "secondary"],
  [/\b(neutral|neutrals|greys?|grays?)\b/i, "neutral"],
];

/**
 * Read the structure of a colour guide: the group of each colour (from the heading it sits under), the tints it
 * lists (a "10%" or "25%" section names its parents again), and rules about text colours. Pure and deterministic.
 * Rules name colours by their names in the guide ("navy", "black"); the import maps them to palette ids.
 */
export function extractColourStructure(lines: string[], colours: SuggestedColour[]): ColourStructure {
  // Sections: a short heading-like line about colours sets the group, or a tint step.
  const sections: Array<{ at: number; group?: string; tint?: 10 | 25 }> = [];
  lines.forEach((l, i) => {
    const short = l.length <= 60 && l.split(/\s+/).length <= 4 && !/[.;,]$/.test(l) && !/#\s?[0-9a-f]{3}/i.test(l) && !/\b(hex|rgb|cmyk)\b/i.test(l);
    const tint = /\b(10|25)\s?%/.exec(l);
    if (short && tint && /\btints?\b/i.test(l)) {
      sections.push({ at: i, tint: Number(tint[1]) as 10 | 25 });
      return;
    }
    if (short && /\b(colou?rs?|palette)\b/i.test(l)) {
      let group = GROUP_WORDS.find(([re]) => re.test(l))?.[1];
      // "Design colour palette", then a body line "Our secondary colours complement ...": the body says which.
      if (!group || group === "secondary") {
        const body = lines.slice(i + 1, i + 3).join(" ");
        const m = /\b(core|primary|accent|secondary|supporting|neutral)\s+colou?r/i.exec(body);
        if (m) group = GROUP_WORDS.find(([re]) => re.test(m[1]))?.[1] ?? group;
      }
      if (group) sections.push({ at: i, group });
    }
  });
  const sectionAt = (line: number) => [...sections].reverse().find((s) => s.at <= line);
  const norm = (n?: string) => (n ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  const parents = new Map<string, SuggestedColour>();
  const out: SuggestedColour[] = [];
  for (const c of colours) {
    const sec = c.line != null ? sectionAt(c.line) : undefined;
    if (sec?.tint && c.name) {
      out.push({ ...c, tintStep: sec.tint, tintOf: c.name });
      continue;
    }
    const withGroup = { ...c, group: sec?.group ?? c.group };
    out.push(withGroup);
    if (c.name) parents.set(norm(c.name), withGroup);
  }
  // A core section often names its core colours in its first sentence ("The brand blue, navy and black are to be
  // visible") and lists others after them ("The remaining colours ... add detail"): those others are accents.
  for (const sec of sections.filter((x) => x.group === "core")) {
    const next = sections.find((x) => x.at > sec.at)?.at ?? lines.length;
    const inSec = out.filter((c) => !c.tintOf && c.line != null && c.line > sec.at && c.line < next && c.group === "core");
    if (inSec.length < 3) continue;
    const names = inSec.map((c) => c.name ?? "");
    for (let i = sec.at + 1; i < Math.min(next, sec.at + 8); i++) {
      const low = lines[i].toLowerCase();
      const named = inSec.filter((c) => c.name && new RegExp(`\\b${c.name.toLowerCase().split(" ").pop()}\\b`).test(low));
      if (named.length >= 2 && named.length < inSec.length) {
        for (const c of inSec) if (!named.includes(c)) c.group = "accent";
        break;
      }
    }
    void names;
  }
  // A listed tint names its parent, perhaps a little differently ("HMCTS Blue" for "HMCTS blue").
  for (const t of out) {
    if (!t.tintOf) continue;
    const key = norm(t.tintOf);
    const parent = parents.get(key) ?? [...parents.entries()].find(([k]) => k.endsWith(` ${key}`) || key.endsWith(` ${k}`) || k.split(" ").pop() === key.split(" ").pop())?.[1];
    if (parent?.name) t.tintOf = parent.name;
    else {
      delete t.tintOf;
      delete t.tintStep;
    }
  }

  // Rules: which colours text may use, and pairs to avoid.
  const named = [...parents.values()].filter((c) => c.name);
  const mentions = (l: string) => {
    const low = l.toLowerCase();
    return named
      .map((c) => {
        const full = norm(c.name);
        const last = full.split(" ").pop()!;
        const at = low.indexOf(full) >= 0 ? low.indexOf(full) : new RegExp(`\\b${last}\\b`).test(low) ? low.search(new RegExp(`\\b${last}\\b`)) : -1;
        return { c, at };
      })
      .filter((x) => x.at >= 0)
      .sort((a, b) => a.at - b.at)
      .map((x) => x.c.name!);
  };
  const rules: ColourStructure["rules"] = {};
  for (const l of lines) {
    if (rules.text) break;
    if (!/\b(text|type|copy|headlines?|body)\b.{0,60}\b(must|should|only|always)\b/i.test(l) && !/\b(must|should|only|always)\b.{0,60}\b(text|type|copy)\b/i.test(l)) continue;
    const names = mentions(l);
    if (names.length) {
      rules.text = [...new Set(names)];
      rules.source = l.slice(0, 400);
    }
  }
  if (rules.text && lines.some((l) => /\bwhite text\b/i.test(l) && /\b(titles?|headings?|graphics|flexib|can|may)\b/i.test(l))) {
    const white = named.find((c) => /^white$/i.test(c.name!.trim()));
    rules.text.push(white?.name ?? "White");
  }
  for (const l of lines) {
    if (!/\b(never|avoid|do not|don'?t)\b/i.test(l)) continue;
    const m = /([A-Za-z][A-Za-z ]{1,30}?)\s+(?:text\s+)?on\s+(?:a\s+|an\s+)?([A-Za-z][A-Za-z ]{1,30})/i.exec(l);
    if (!m) continue;
    const a = mentions(m[1]);
    const b = mentions(m[2]);
    const lastWord = (x: string) => x.trim().split(" ").pop()!.toLowerCase();
    const fg = a[a.length - 1] ?? (lastWord(m[1]) === "white" ? "White" : undefined);
    const bg = b[0];
    if (fg && bg && fg !== bg) (rules.never ??= []).push({ text: fg, background: bg });
  }
  return { colours: out, rules };
}

function splitSections(lines: string[]): Array<{ heading: string; body: string[] }> {
  const out: Array<{ heading: string; body: string[] }> = [];
  let cur = { heading: "", body: [] as string[] };
  for (const l of lines) {
    const md = /^#{1,4}\s+(.+)$/.exec(l);
    // A heading: a Markdown heading, or a short line without a full stop followed by body lines.
    const looksHeading = md || (l.length <= 48 && !/[.;,]$/.test(l) && /^[A-Z0-9]/.test(l) && l.split(" ").length <= 7 && !/^[-•*]/.test(l) && !/#[0-9a-f]{3}/i.test(l));
    if (looksHeading) {
      if (cur.heading || cur.body.length) out.push(cur);
      cur = { heading: md ? md[1] : l, body: [] };
    } else cur.body.push(l);
  }
  if (cur.heading || cur.body.length) out.push(cur);
  return out;
}

function colourName(before: string | undefined): string | undefined {
  if (!before) return undefined;
  const cleaned = before
    .replace(/\b(hex|rgb|cmyk|pantone|pms|ral|colou?r|web|screen|print)\b\s*:?/gi, " ")
    .replace(/[|:–-]+\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const m = /([A-Z][A-Za-z]+(?:\s+[A-Za-z]+){0,3})$/.exec(cleaned);
  return m ? m[1].trim() : undefined;
}

function rgbHex(r: string, g: string, b: string): string {
  const v = [+r, +g, +b];
  if (v.some((n) => n > 255)) return "";
  return toHex(v as [number, number, number]);
}

function cmykHex(c: number, m: number, y: number, k: number): string {
  if ([c, m, y, k].some((n) => n > 100)) return "";
  const f = (x: number) => 255 * (1 - x / 100) * (1 - k / 100);
  return toHex([f(c), f(m), f(y)]);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
