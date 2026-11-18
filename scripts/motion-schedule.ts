// The animation schedule of a compiled page: every movement as a time window, read from the arrays the compiler
// writes (engine/compile.ts). Shared by scripts/motion-check.ts and scripts/verify.ts.
//   smooth: an eased movement (entrances, transitions, text effects, count up, grow): every frame should change.
//   steady: an even, slow movement (photo pan, shape drift, clips).
//   edge:   a switch or a short fade (captions, the spoken-word line, clips starting and ending).
/**
 * tail: seconds at the end of a smooth window where an unchanged frame is expected. A scale of a few per cent on an
 * ease-out curve moves an edge by well under half a pixel a frame in its last quarter (a 184 px circle growing from
 * 0.94 moves about 0.05 px in total there), so Chrome draws the same pixels.
 */
export type Win = { a: number; b: number; kind: "smooth" | "steady" | "edge"; label: string; tail?: number };

export function readArray(html: string, name: string): unknown[][] {
  const m = new RegExp(`var ${name} = (\\[.*?\\]);\\n`).exec(html);
  return m ? (JSON.parse(m[1]) as unknown[][]) : [];
}

/** Words in the element with this id (for word-by-word windows). */
function wordCount(html: string, sel: string): number {
  const id = /^#([^ ]+)/.exec(sel)?.[1];
  const m = id ? new RegExp(`<(h1|h2|p|blockquote)\\b[^>]*\\bid="${id}"[^>]*>([\\s\\S]*?)</\\1>`).exec(html) : null;
  return Math.max(1, (m?.[2].match(/class="ww"/g) ?? []).length);
}

export function schedule(html: string): Win[] {
  const num = (v: unknown) => v as number;
  const w: Win[] = [];
  for (const e of readArray(html, "E")) {
    // [sel, x, y, scale, duration, at] (older pages: [sel, rise, duration, at]).
    const [dur, at] = e.length >= 6 ? [num(e[4]), num(e[5])] : [num(e[2]), num(e[3])];
    const scaleOnly = e.length >= 6 && num(e[3]) !== 1 && num(e[1]) === 0 && num(e[2]) === 0;
    w.push({ a: at, b: at + dur, kind: "smooth", label: `entrance ${e[0]}`, ...(scaleOnly ? { tail: dur * 0.25 } : {}) });
  }
  for (const m of readArray(html, "M")) w.push({ a: num(m[2]), b: num(m[2]) + num(m[1]), kind: "smooth", label: `reveal ${m[0]}` });
  for (const x of readArray(html, "X")) w.push({ a: num(x[2]), b: num(x[2]) + num(x[1]), kind: "smooth", label: `crossfade ${x[0]}` });
  for (const x of readArray(html, "W")) w.push({ a: num(x[4]), b: num(x[4]) + num(x[3]), kind: "smooth", label: `wipe ${x[0]}` });
  for (const p of readArray(html, "P")) w.push({ a: num(p[4]), b: num(p[4]) + num(p[3]), kind: "smooth", label: `push ${p[1]}` });
  for (const s of readArray(html, "S")) w.push({ a: num(s[2]), b: num(s[2]) + num(s[1]), kind: "smooth", label: `sweep ${s[0]}` });
  for (const t of readArray(html, "T")) {
    const n = t[1] === "words" ? wordCount(html, String(t[0])) : 1;
    w.push({ a: num(t[3]), b: num(t[3]) + num(t[2]) + num(t[4]) * (n - 1), kind: "smooth", label: `${t[1]} ${t[0]}` });
  }
  for (const k of readArray(html, "K")) w.push({ a: num(k[3]), b: num(k[3]) + num(k[2]), kind: "smooth", label: `count ${k[0]}` });
  for (const g of readArray(html, "G"))
    w.push({ a: num(g[3]), b: num(g[3]) + num(g[2]), kind: g[1] === "drift" ? "steady" : "smooth", label: `${g[1]} ${g[0]}`, ...(g[1] === "grow" ? { tail: num(g[2]) * 0.25 } : {}) });
  for (const d of readArray(html, "D")) w.push({ a: num(d[4]), b: num(d[4]) + num(d[3]), kind: "steady", label: `photo drift ${d[0]}` });
  for (const c of readArray(html, "C")) w.push({ a: num(c[4]), b: num(c[4]) + num(c[3]), kind: "edge", label: `caption fade ${c[0]}` });
  for (const h of readArray(html, "H")) {
    w.push({ a: num(h[1]), b: num(h[1]) + num(h[3]), kind: "edge", label: `word line ${h[0]}` });
    w.push({ a: num(h[2]), b: num(h[2]) + num(h[3]), kind: "edge", label: `word line ${h[0]}` });
  }
  // Timed elements switch on and off at their data-start and end. Videos play throughout.
  const re = /<(div|video)[^>]*\bid="([^"]+)"[^>]*\bdata-start="([\d.]+)"[^>]*\bdata-duration="([\d.]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const [, tag, id, s, d] = m;
    const a = Number(s);
    const b = a + Number(d);
    if (tag === "video") w.push({ a, b, kind: "steady", label: `clip ${id}` });
    w.push({ a: a - 0.02, b: a + 0.02, kind: "edge", label: `${id} starts` });
    w.push({ a: b - 0.02, b: b + 0.02, kind: "edge", label: `${id} ends` });
  }
  return w;
}
