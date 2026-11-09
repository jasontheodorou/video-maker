// Icon choice for the interpreter. The model names an icon by meaning ("calendar", "recycling");
// this file turns that into an icon the brand can really use.
//
// Order: an exact name the brand can use (client icons first, then the library), then the engine's
// icon search if it exports one (searchIcons), then a simple word match over the library index
// (engine/icons/index.json: names and tags). If nothing matches, the icon is left out.
import fs from "node:fs";
import path from "node:path";
import { ICONS_DIR } from "../paths";
import { listIcons } from "../icons";
import type { LoadedBrand } from "../brand";

interface IndexEntry {
  name: string;
  tags?: string[];
  categories?: string[];
}

let indexCache: IndexEntry[] | null = null;
function libraryIndex(): IndexEntry[] {
  if (indexCache) return indexCache;
  const file = path.join(ICONS_DIR, "index.json");
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as { icons?: IndexEntry[] };
    indexCache = raw.icons ?? [];
  } catch {
    indexCache = [];
  }
  return indexCache;
}

type SearchFn = (query: string, opts?: { brand?: LoadedBrand | string; limit?: number }) => Array<{ name: string; score?: number }> | Promise<Array<{ name: string; score?: number }>>;

/** The engine's own icon search, when the icons work exports one. */
function engineSearch(): SearchFn | null {
  for (const mod of ["../icons", "../api"]) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const m = require(mod) as { searchIcons?: SearchFn };
      if (typeof m.searchIcons === "function") return m.searchIcons;
    } catch {
      /* not available */
    }
  }
  return null;
}

const words = (s: string) =>
  s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1)
    .map((w) => w.replace(/(ies)$/, "y").replace(/([^s])s$/, "$1"));

function simpleSearch(query: string, available: Set<string>, limit: number): string[] {
  const q = words(query);
  if (!q.length) return [];
  const scored: Array<{ name: string; score: number }> = [];
  const entries = libraryIndex();
  const seen = new Set<string>();
  const score = (name: string, tags: string[]) => {
    const nameWords = words(name);
    const tagWords = tags.flatMap(words);
    let s = 0;
    for (const w of q) {
      if (nameWords.includes(w)) s += 3;
      else if (tagWords.includes(w)) s += 1.5;
      else if (nameWords.some((n) => n.startsWith(w) || w.startsWith(n))) s += 1;
    }
    // Prefer short, plain names (calendar over calendar-dots-slash).
    return s - nameWords.length * 0.05;
  };
  for (const e of entries) {
    if (!available.has(e.name)) continue;
    seen.add(e.name);
    const s = score(e.name, [...(e.tags ?? []), ...(e.categories ?? [])]);
    if (s > 0.9) scored.push({ name: e.name, score: s });
  }
  for (const name of available) {
    if (seen.has(name)) continue;
    const s = score(name, []) + 0.5; // client icons win ties
    if (s > 0.9) scored.push({ name, score: s });
  }
  return scored
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, limit)
    .map((x) => x.name);
}

export interface IconChoice {
  name: string | null;
  note?: string;
}

/** Turn a wanted icon (a name or a few words) into an icon this brand has. */
export async function chooseIcon(wanted: string, context: string, brand: LoadedBrand): Promise<IconChoice> {
  const all = listIcons(brand);
  const available = new Set(all.map((i) => i.name));
  const slug = wanted.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  if (available.has(slug)) return { name: slug };
  const search = engineSearch();
  if (search) {
    try {
      const hits = await search(wanted, { brand, limit: 5 });
      const hit = hits.find((h) => available.has(h.name));
      if (hit) return { name: hit.name, note: `Icon "${wanted}" is not available, so "${hit.name}" is used.` };
      const ctxHits = await search(`${wanted} ${context}`, { brand, limit: 5 });
      const ctxHit = ctxHits.find((h) => available.has(h.name));
      if (ctxHit) return { name: ctxHit.name, note: `Icon "${wanted}" is not available, so "${ctxHit.name}" is used.` };
    } catch {
      /* fall back to the simple search */
    }
  }
  const hit = simpleSearch(wanted, available, 1)[0] ?? simpleSearch(`${wanted} ${context}`, available, 1)[0];
  if (hit) return { name: hit, note: `Icon "${wanted}" is not available, so "${hit}" is used.` };
  return { name: null, note: `No icon matches "${wanted}", so the scene has no icon.` };
}

// Plain library icons that suit public information videos. Only those the library really has are offered.
const USEFUL =
  "calendar calendar-check clock timer house buildings bank trash recycle leaf tree plant flower car bus train bicycle road-horizon traffic-sign map-pin signpost phone envelope chat-circle globe laptop device-mobile users users-three user baby heart heartbeat first-aid hospital stethoscope pill wheelchair graduation-cap book-open books student money currency-gbp coins wallet credit-card receipt hand-coins piggy-bank briefcase handshake megaphone bell warning info question check-circle x-circle shield-check lock key drop shower thermometer sun snowflake cloud-rain umbrella lightning fire wrench hammer toolbox clipboard-text file-text note-pencil list-checks magnifying-glass chart-bar chart-line trend-up target lightbulb star trophy ticket storefront shopping-cart basket fork-knife coffee paw-print dog newspaper television camera microphone headset wifi-high plug charging-station broom bed door identification-card scales gavel police-car siren ambulance fire-truck hand-heart smiley person-simple-walk ear eye hand-waving".split(
    " ",
  );

/** Icon names worth offering the model: every client icon and a list of plain library names. */
export function iconHints(brand: LoadedBrand): { client: string[]; library: string[] } {
  const all = listIcons(brand);
  const client = all.filter((i) => i.source === "brand").map((i) => i.name);
  const lib = new Set(all.filter((i) => i.source === "library").map((i) => i.name));
  return { client, library: USEFUL.filter((n) => lib.has(n) && !client.includes(n)) };
}
