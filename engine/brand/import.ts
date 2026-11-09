// Turn a folder of client brand assets into a brand: brands/<id>/brand.json plus its files.
// Used by scripts/brand-import.ts and by the web app (for a zip or folder upload).
//
// The folder can hold, in any layout:
//   - logos: SVG (best) or PNG, with "logo" in the name or in a logo/ folder. Names with
//     white, reverse, negative, knockout or "on dark" are used for dark backgrounds.
//   - fonts: WOFF2, WOFF, TTF or OTF.
//   - icons: SVG files in an icons/ folder. They override library icons with the same name.
//   - graphics: other SVG, PNG, JPEG or WebP files in a graphics/ folder.
//   - colours: colours.txt, colours.json, palette.txt (one colour a line, such as "Vale Blue #0B3B60"),
//     or any hex, RGB or CMYK values in the guidelines.
//   - guidelines: PDF, Markdown or text files. Their text is read for colours, fonts, tone and rules.
import fs from "node:fs";
import path from "node:path";
import { createBrand, addBrandFile, updateBrand, readBrand, useOpenFont, brandIdFromName, slugifyBrandName, brandFolder, type BrandRecord } from "./store";
import { extractGuidelinesText, suggestTokensFromText, type TokenSuggestions } from "./guidelines";
import { assignColourRoles, proposeSurfaces, contrastMatrix, normaliseHex, type ColourSet } from "./palette";
import { FONT_EXTENSIONS, cachedOpenFonts, listOpenFonts } from "./fonts";

export interface ImportOptions {
  /** Display name. Default: the name found in the guidelines, or the folder name. */
  name?: string;
  /** Folder name in brands/. Default: made from the name. */
  id?: string;
  /** Brand to take any missing tokens from. Default "demo". */
  from?: string;
  /** Replace an existing brand with the same id. Default false. */
  overwrite?: boolean;
  /** Allow downloading an open font named in the guidelines when no font files are supplied. Default true. */
  network?: boolean;
}

export interface Gap {
  /** The token group, such as colours, fonts or logo. */
  group: string;
  message: string;
}

export interface ImportReport {
  brand: BrandRecord;
  /** What was found and where it went. */
  found: {
    logos: string[];
    fonts: string[];
    icons: string[];
    graphics: string[];
    guidelines: string[];
    colours: Array<{ value: string; name?: string; from: string }>;
  };
  suggestions?: TokenSuggestions;
  /** Every colour pair that passes AAA, as "text on background". */
  legalPairs: string[];
  /** Notes on choices made (colour roles, surfaces, fonts). */
  notes: string[];
  /** Things still missing or guessed. Each group named here is marked provisional in brand.json. */
  gaps: Gap[];
  warnings: string[];
}

const IMAGE = /\.(svg|png|jpe?g|webp)$/i;

function walk(dir: string, out: string[] = [], depth = 0): string[] {
  if (depth > 6) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".") || e.name === "__MACOSX" || e.name === "node_modules") continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out, depth + 1);
    else if (e.isFile()) out.push(p);
  }
  return out;
}

/** Read colours from a colour list file: JSON (array or object) or text lines such as "Vale Blue #0B3B60". */
export function parseColourList(text: string): Array<{ value: string; name?: string; role?: string }> {
  const out: Array<{ value: string; name?: string; role?: string }> = [];
  const trimmed = text.trim();
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    try {
      const j = JSON.parse(trimmed);
      const items = Array.isArray(j) ? j : Object.entries(j).map(([k, v]) => (typeof v === "string" ? { name: k, value: v } : { role: k, ...(v as object) }));
      for (const it of items as any[]) {
        const value = normaliseHex(String(it.value ?? it.hex ?? it.colour ?? it.color ?? ""));
        if (value) out.push({ value, name: it.name, role: it.role });
      }
      return out;
    } catch {
      /* fall through to lines */
    }
  }
  for (const line of text.split(/\r?\n/)) {
    const m = /(#[0-9a-f]{6}\b|#[0-9a-f]{3}\b|rgb\([^)]*\))/i.exec(line);
    if (!m) continue;
    const value = normaliseHex(m[1]);
    if (!value) continue;
    const rest = line.replace(m[0], " ").replace(/[,:;|=\t-]+/g, " ").replace(/\s+/g, " ").trim();
    const roleM = /\b(primary|text|background|accent2|accent|tint|line)\b\s*$/i.exec(rest) ?? /^(primary|text|background|accent2|accent|tint|line)\b/i.exec(rest);
    const role = roleM?.[1].toLowerCase();
    const name = rest.replace(roleM?.[0] ?? "", "").trim() || undefined;
    out.push({ value, name, role });
  }
  return out;
}

/**
 * Import a folder of client assets as a brand. Writes brands/<id>/ and returns a report with the gaps.
 * Never guesses silently: every guess is in `notes`, and every group still to confirm is in `gaps`.
 */
export async function importBrandFromFolder(srcDir: string, opts: ImportOptions = {}): Promise<ImportReport> {
  const src = path.resolve(srcDir);
  if (!fs.existsSync(src) || !fs.statSync(src).isDirectory()) throw new Error(`There is no folder at ${srcDir}.`);
  const files = walk(src);
  const rel = (f: string) => path.relative(src, f);
  const lower = (f: string) => rel(f).toLowerCase();
  const warnings: string[] = [];
  const notes: string[] = [];
  const gaps: Gap[] = [];

  // ---- sort the files ----
  const fontFiles = files.filter((f) => (FONT_EXTENSIONS as readonly string[]).includes(path.extname(f).toLowerCase()));
  const docFiles = files.filter((f) => /\.(pdf|md|txt)$/i.test(f) && !/colou?rs?|palette/i.test(path.basename(f)) && !/licen[cs]e|ofl/i.test(path.basename(f)));
  const colourFiles = files.filter((f) => /colou?rs?|palette/i.test(path.basename(f)) && /\.(txt|json|csv|md)$/i.test(f));
  const iconFiles = files.filter((f) => /\.svg$/i.test(f) && /(^|[\\/])icons?[\\/]/i.test(lower(f)));
  const logoFiles = files.filter((f) => IMAGE.test(f) && !iconFiles.includes(f) && /logo|wordmark|lockup|crest|mark/i.test(lower(f)) && /\.(svg|png)$/i.test(f));
  const graphicFiles = files.filter((f) => IMAGE.test(f) && !iconFiles.includes(f) && !logoFiles.includes(f));

  // ---- guidelines text ----
  let suggestions: TokenSuggestions | undefined;
  const texts: string[] = [];
  for (const d of docFiles) {
    try {
      const t = await extractGuidelinesText(d);
      texts.push(t.text);
      warnings.push(...t.warnings.map((w) => `${rel(d)}: ${w}`));
    } catch (e) {
      warnings.push(`${rel(d)}: ${(e as Error).message}`);
    }
  }
  if (texts.length) {
    if (opts.network !== false && !cachedOpenFonts()) await listOpenFonts().catch(() => null);
    suggestions = suggestTokensFromText(texts.join("\n\n"));
  }

  // ---- name and id ----
  const name = opts.name ?? suggestions?.name ?? titleCase(path.basename(src));
  const id = opts.id ?? (opts.overwrite ? slugifyBrandName(name) : brandIdFromName(name));
  const dest = brandFolder(id);
  if (fs.existsSync(dest)) {
    if (!opts.overwrite) throw new Error(`A brand with the id ${id} already exists. Use another id, or overwrite it.`);
    if (id === "demo") throw new Error("The sample brand cannot be overwritten by an import.");
    fs.rmSync(dest, { recursive: true, force: true });
  }

  // ---- colours ----
  const colourList: Array<{ value: string; name?: string; role?: string; from: string }> = [];
  for (const f of colourFiles) for (const c of parseColourList(fs.readFileSync(f, "utf8"))) colourList.push({ ...c, from: rel(f) });
  if (!colourList.length && suggestions) for (const c of suggestions.colours) colourList.push({ value: c.value, name: c.name, role: c.role, from: "guidelines" });

  const record0 = createBrand({ name, id, from: opts.from ?? "demo", colours: colourList.length ? colourList : undefined, description: `Imported from ${path.basename(src)} on ${new Date().toISOString().slice(0, 10)}.` });
  notes.push(...record0.notes.filter((n) => !/placeholder/.test(n)));
  const provisional = new Set<string>(["voice"]);
  if (!colourList.length) {
    provisional.add("colours");
    gaps.push({ group: "colours", message: "No colours were supplied. The starting brand's colours are used until you add the real ones." });
  } else {
    const roles = assignColourRoles(colourList);
    if (roles.invented.length) {
      provisional.add("colours");
      gaps.push({ group: "colours", message: `These colour roles were made up because the list did not include them: ${roles.invented.join(", ")}.` });
    }
    if (roles.unused.length) notes.push(`Colours not used for any role: ${roles.unused.map((c) => `${c.name ?? ""} ${c.value}`.trim()).join(", ")}.`);
    const surf = proposeSurfaces(roles.colours);
    if (!surf.ok) {
      provisional.add("colours");
      gaps.push({ group: "colours", message: "Some text colour pairs do not pass AAA. See the contrast messages." });
    }
    if (!colourList.some((c) => c.role)) {
      provisional.add("colours");
      gaps.push({ group: "colours", message: "Colour roles (primary, text, background, accent, tint) were guessed from the colours. Confirm them." });
    }
  }

  // ---- fonts ----
  for (const f of fontFiles) {
    try {
      const r = addBrandFile(id, "font", path.basename(f), fs.readFileSync(f));
      warnings.push(...r.warnings.map((w) => `${rel(f)}: ${w}`));
    } catch (e) {
      warnings.push(`${rel(f)}: ${(e as Error).message}`);
    }
  }
  let current = readBrand(id);
  const raw0: any = current.raw;
  const families = [...new Set((raw0.fonts.faces as any[]).map((f) => f.family))];
  const startFamily = readBrand(opts.from ?? "demo").raw as any;
  if (fontFiles.length) {
    // Prefer the family the guidelines name for headings and body text.
    const named = suggestions?.fonts ?? [];
    const pick = (role: "heading" | "body") => named.find((n) => n.role === role && families.includes(n.family))?.family;
    // Otherwise the family with the most files, for both roles.
    const count = (fam: string) => (raw0.fonts.faces as any[]).filter((f) => f.family === fam).length;
    const main = [...families].filter((f) => f !== startFamily.fonts.body.family || families.length === 1).sort((a, b) => count(b) - count(a))[0];
    const heading = pick("heading") ?? main;
    const body = pick("body") ?? main;
    const patch: any = { fonts: {} };
    const weightsOf = (fam: string) => (raw0.fonts.faces as any[]).filter((f) => f.family === fam && f.style === "normal").map((f) => f.weight as number);
    const near = (fam: string, w: number) => [...weightsOf(fam)].sort((a, b) => Math.abs(a - w) - Math.abs(b - w))[0];
    if (heading && weightsOf(heading).length) patch.fonts.heading = { family: heading, weight: near(heading, 700) };
    if (body && weightsOf(body).length) {
      patch.fonts.body = { family: body, weight: near(body, 400) };
      patch.captions = { weight: Math.max(400, near(body, 400)) };
    }
    if (Object.keys(patch.fonts).length) current = updateBrand(id, patch);
    const r: any = current.raw;
    if (r.fonts.body.family === startFamily.fonts.body.family) {
      provisional.add("fonts");
      gaps.push({ group: "fonts", message: "The font files could not be used, so the starting brand's font is used. See the warnings." });
    } else {
      notes.push(`Fonts: headings in ${r.fonts.heading.family} ${r.fonts.heading.weight}, body text in ${r.fonts.body.family} ${r.fonts.body.weight}.`);
      if (r.fonts.heading.weight < 600) gaps.push({ group: "fonts", message: `No bold weight of ${r.fonts.heading.family} was supplied. Headings use weight ${r.fonts.heading.weight}.` });
    }
  } else {
    const open = suggestions?.fonts.find((f) => f.openFont);
    if (open && opts.network !== false) {
      try {
        current = await useOpenFont(id, open.family);
        notes.push(`Fonts: ${open.family} was named in the guidelines and is an open font, so it was downloaded.`);
        provisional.add("fonts");
        gaps.push({ group: "fonts", message: `${open.family} was downloaded from the open font service. Check it is the right font and weights.` });
      } catch (e) {
        warnings.push(`Could not download ${open.family}: ${(e as Error).message}`);
      }
    }
    if ((current.raw as any).fonts.body.family === startFamily.fonts.body.family) {
      provisional.add("fonts");
      const named = suggestions?.fonts.map((f) => f.family).join(", ");
      gaps.push({ group: "fonts", message: named ? `No font files were supplied. The guidelines name ${named}. Upload the font files (or pick an open font).` : "No font files were supplied. The starting brand's font is used until you add one." });
    }
  }

  // ---- logos ----
  const isDarkVariant = (f: string) => /white|reverse|reversed|negative|knock-?out|inverse|mono-?white|on[-_ ]?dark|dark[-_ ]?bg/i.test(path.basename(f));
  const pref = (list: string[]) => [...list].sort((a, b) => (a.endsWith(".svg") === b.endsWith(".svg") ? rel(a).length - rel(b).length : a.endsWith(".svg") ? -1 : 1))[0];
  const lightLogo = pref(logoFiles.filter((f) => !isDarkVariant(f)));
  const darkLogo = pref(logoFiles.filter(isDarkVariant));
  if (lightLogo) {
    const r = addBrandFile(id, "logo", path.basename(lightLogo), fs.readFileSync(lightLogo), { logoFor: darkLogo ? "onLight" : "both" });
    warnings.push(...r.warnings.filter((w) => !/Upload a version/.test(w)).map((w) => `${rel(lightLogo)}: ${w}`));
  }
  if (darkLogo) {
    const r = addBrandFile(id, "logo", path.basename(darkLogo), fs.readFileSync(darkLogo), { logoFor: "onDark" });
    warnings.push(...r.warnings.filter((w) => !/Upload a version/.test(w)).map((w) => `${rel(darkLogo)}: ${w}`));
  }
  if (!lightLogo && !darkLogo) {
    provisional.add("logo");
    gaps.push({ group: "logo", message: "No logo was found. A plain placeholder made from the name is used. Add the logo as SVG." });
  } else if (!darkLogo && !/placeholder-logo/.test(String((readBrand(id).raw as any).logo?.onDark))) {
    // One logo that also shows clearly on the dark background: it is used on both.
    provisional.add("logo");
    gaps.push({ group: "logo", message: "Only one logo was found. It is used on light and dark backgrounds. Add the official reversed logo if there is one." });
  } else if (!lightLogo || !darkLogo) {
    provisional.add("logo");
    gaps.push({ group: "logo", message: `Only a logo for ${lightLogo ? "light" : "dark"} backgrounds was found. The placeholder is used on ${lightLogo ? "dark" : "light"} backgrounds, and videos show the logo on dark backgrounds. Add the other version.` });
  }
  if (suggestions?.logo.minHeightPx) current = updateBrand(id, { logo: { minHeight: suggestions.logo.minHeightPx } });

  // ---- icons and graphics ----
  for (const f of iconFiles) {
    try {
      const r = addBrandFile(id, "icon", path.basename(f), fs.readFileSync(f));
      warnings.push(...r.warnings.map((w) => `${rel(f)}: ${w}`));
    } catch (e) {
      warnings.push(`${rel(f)}: ${(e as Error).message}`);
    }
  }
  for (const f of graphicFiles) {
    try {
      const r = addBrandFile(id, "graphic", path.basename(f), fs.readFileSync(f));
      warnings.push(...r.warnings.map((w) => `${rel(f)}: ${w}`));
    } catch (e) {
      warnings.push(`${rel(f)}: ${(e as Error).message}`);
    }
  }
  if (!iconFiles.length) {
    provisional.add("icons");
    gaps.push({ group: "icons", message: `No client icons were supplied. Videos use the Phosphor library at ${suggestions?.iconWeight ?? "regular"} weight.` });
  }
  for (const d of docFiles) addBrandFile(id, "document", path.basename(d), fs.readFileSync(d));

  // ---- words: tone, rules, guidelines ----
  const patch: any = { icons: {} };
  if (suggestions?.iconWeight) patch.icons.weight = suggestions.iconWeight;
  if (suggestions?.toneOfVoice) patch.toneOfVoice = suggestions.toneOfVoice.slice(0, 4000);
  else {
    provisional.add("tone of voice");
    gaps.push({ group: "tone of voice", message: "No tone of voice was found. Write a few lines on how the brand speaks." });
  }
  if (suggestions && (suggestions.rules.do.length || suggestions.rules.dont.length)) patch.rules = { do: suggestions.rules.do, dont: suggestions.rules.dont };
  else {
    provisional.add("rules");
    gaps.push({ group: "rules", message: "No do and don't rules were found." });
  }
  if (suggestions?.guidelines) patch.guidelines = suggestions.guidelines.slice(0, 20000);
  else {
    provisional.add("guidelines");
    gaps.push({ group: "guidelines", message: "No guidelines text was found for the brief interpreter to read." });
  }
  if (suggestions?.voice) {
    patch.voice = { id: suggestions.voice.id };
    notes.push(`Voice: ${suggestions.voice.id}. ${suggestions.voice.reason}`);
  }
  gaps.push({ group: "voice", message: `The voice is ${suggestions?.voice?.id ?? (current.raw as any).voice.id}, a Kokoro voice. Listen to a sample and confirm it.` });
  if (suggestions?.gaps.length) for (const g of suggestions.gaps) warnings.push(`Guidelines: ${g}`);
  patch.provisional = [...provisional];
  current = updateBrand(id, patch);

  // ---- contrast summary ----
  const legalPairs = contrastMatrix((current.raw as any).colours as ColourSet)
    .filter((p) => p.result.passesAAA)
    .map((p) => `${p.foreground} on ${p.background} (${p.result.ratioText} to 1)`);
  for (const i of current.check.issues.filter((x) => x.level === "error")) gaps.push({ group: i.field.split(".")[0], message: i.message });

  return {
    brand: readBrand(id),
    found: {
      logos: logoFiles.map(rel),
      fonts: fontFiles.map(rel),
      icons: iconFiles.map(rel),
      graphics: graphicFiles.map(rel),
      guidelines: docFiles.map(rel),
      colours: colourList.map((c) => ({ value: c.value, name: c.name, from: c.from })),
    },
    suggestions,
    legalPairs,
    notes,
    gaps,
    warnings,
  };
}

function titleCase(s: string): string {
  return s.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).trim();
}
