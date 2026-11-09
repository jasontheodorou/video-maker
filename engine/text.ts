// Small text helpers shared by scenes, timing and captions.

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function words(s: string): string[] {
  return s.trim().split(/\s+/).filter(Boolean);
}

export function countWords(s: string | undefined | null): number {
  return s ? words(s).length : 0;
}

/** Normalise a word for matching: lower case, letters and digits only. */
export function normWord(w: string): string {
  return w
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Escape text and wrap emphasised phrases in <span class="em">. Emphasis entries must appear in the text
 * (checked by the spec schema). Matching is case-sensitive and takes the first occurrence of each.
 */
export function withEmphasis(text: string, emphasis: string[] = []): string {
  type Range = [number, number];
  const ranges: Range[] = [];
  for (const e of emphasis) {
    const i = text.indexOf(e);
    if (i < 0) continue;
    const r: Range = [i, i + e.length];
    if (!ranges.some(([a, b]) => r[0] < b && a < r[1])) ranges.push(r);
  }
  ranges.sort((a, b) => a[0] - b[0]);
  let out = "";
  let pos = 0;
  for (const [a, b] of ranges) {
    out += escapeHtml(text.slice(pos, a)) + `<span class="em">${escapeHtml(text.slice(a, b))}</span>`;
    pos = b;
  }
  return out + escapeHtml(text.slice(pos));
}

/** Make text safe for speech: expand a few symbols Kokoro reads badly. Display text is never changed. */
const MONTHS = "January|February|March|April|May|June|July|August|September|October|November|December";

function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${n % 10 > 3 ? "th" : s}`;
}

export function speakable(s: string): string {
  return (
    s
      .replace(/&/g, " and ")
      // GOV.UK dates: "3 March" is spoken "the 3rd of March".
      .replace(new RegExp(`\\b(\\d{1,2}) (${MONTHS})\\b`, "g"), (_m, d: string, mo: string) => `the ${ordinal(Number(d))} of ${mo}`)
      // Phone numbers such as 0300 555 0199: read digit by digit.
      .replace(/\b0\d{2,4}(?:[ -]\d{3,4}){1,3}\b/g, (m) => m.split(/[ -]/).map((g) => g.split("").join(" ")).join(", "))
      // Web addresses: say "dot".
      .replace(/\b([a-z0-9-]+)\.(example|gov\.uk|org\.uk|co\.uk|uk|com|org)(\/[a-z0-9-/]*)?/gi, (_m, host: string, tld: string, p?: string) =>
        `${host} dot ${tld.replace(/\./g, " dot ")}${p ? " slash " + p.replace(/^\//, "").replace(/\//g, " slash ") : ""}`,
      )
      .replace(/\s+/g, " ")
      .trim()
  );
}
