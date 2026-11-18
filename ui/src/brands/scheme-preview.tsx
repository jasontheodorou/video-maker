// A live still of one scheme: the server compiles the scene once, then every colour change is set
// straight onto the page's CSS variables, so the picture follows the picker with no round trip.
import { useElementSize } from "@mantine/hooks";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../shared/api";
import { liveVars, toneOf, type SchemeLike } from "./colour";
import { useEditor } from "./context";

// At most 4 stills are asked for at once.
let inFlight = 0;
const waiting: Array<() => void> = [];
async function queued<T>(fn: () => Promise<T>): Promise<T> {
  if (inFlight >= 4) await new Promise<void>((r) => waiting.push(r));
  inFlight++;
  try {
    return await fn();
  } finally {
    inFlight--;
    waiting.shift()?.();
  }
}

const SCENE_NAME: Record<string, string> = { title: "Title", statement: "Statement", points: "Points", stat: "Stat", end: "End card" };
const DIMS: Record<string, [number, number]> = { "16x9": [1920, 1080], "9x16": [1080, 1920], "1x1": [1080, 1080] };

/** A scaled, same-origin iframe of one scene in one scheme. It is a picture, so it is hidden from screen readers. */
export function SchemePreview({ scheme, scene = "statement", format = "16x9", maxHeight }: { scheme: SchemeLike; scene?: string; format?: string; maxHeight?: number }) {
  const { id, draft } = useEditor();
  const { ref, width } = useElementSize();
  const frame = useRef<HTMLIFrameElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const vars = useMemo(() => {
    try {
      return liveVars(scheme, draft);
    } catch {
      return null;
    }
  }, [scheme, draft]);
  const dark = vars ? isDark(vars["--bg"]) : false;
  // A new still is needed only when what the server draws changes: fonts, logo, scene, format, or a tone flip (logo variant).
  const key = JSON.stringify([scene, format, dark, scheme.logo ?? "auto", draft.fonts, draft.logo, draft.name]);

  useEffect(() => {
    let live = true;
    const t = setTimeout(async () => {
      try {
        const r = await queued(() => api<{ url: string }>("POST", `/api/brands/${encodeURIComponent(id)}/schemes/preview`, { brand: draft, scheme, scene, format }));
        if (live) {
          setUrl(r.url);
          setFailed(false);
        }
      } catch {
        if (live) setFailed(true);
      }
    }, 400);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [key, id]); // eslint-disable-line react-hooks/exhaustive-deps

  const apply = () => {
    const root = frame.current?.contentDocument?.documentElement;
    if (!root || !vars) return;
    for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  };
  useEffect(apply, [vars]); // eslint-disable-line react-hooks/exhaustive-deps

  const [w, h] = DIMS[format] ?? DIMS["16x9"];
  let scale = width ? width / w : 0;
  if (maxHeight && scale * h > maxHeight) scale = maxHeight / h;
  return (
    <div className="sp" ref={ref} style={{ height: scale ? Math.round(h * scale) : undefined, background: vars?.["--bg"] }} aria-hidden="true">
      {url && scale ? (
        <iframe ref={frame} src={url} title={`${SCENE_NAME[scene] ?? scene} preview`} tabIndex={-1} width={w} height={h} style={{ transform: `scale(${scale})` }} onLoad={apply} />
      ) : null}
      {failed && !url ? <p className="sp__none">No preview yet</p> : null}
    </div>
  );
}

const isDark = (hex: string) => toneOf(hex) === "dark";

export { SCENE_NAME };
