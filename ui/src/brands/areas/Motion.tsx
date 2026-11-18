// Motion area: the brand's motion style. Each style shows a short preview in this brand's fonts and
// colours. Previews sit still until you point at them, focus them or press Play, and never play on
// their own when the computer asks for reduced motion.
import { Button } from "@mantine/core";
import { Pause, Play } from "@phosphor-icons/react";
import { useElementSize } from "@mantine/hooks";
import { useEffect, useRef, useState } from "react";
import { announce, api, reducedMotion } from "../../shared/api";
import { useEditor } from "../context";

const FALLBACK = [
  { id: "calm", label: "Calm", line: "Gentle fades and rises. Crossfades." },
  { id: "crisp", label: "Crisp", line: "Clean slides, wipes and drawn underlines." },
  { id: "lively", label: "Lively", line: "Word by word titles and colour sweeps. Still no bounce." },
  { id: "still", label: "Still", line: "Fades only. For sensitive subjects." },
];

function MotionTile({ style, label, line, chosen, onChoose }: { style: string; label: string; line: string; chosen: boolean; onChoose: () => void }) {
  const { id, draft } = useEditor();
  const { ref, width } = useElementSize();
  const frame = useRef<HTMLIFrameElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [playing, setPlaying] = useState(false);
  const firstScheme = draft.schemes.find((s: any) => s.enabled !== false)?.id;
  const key = JSON.stringify([style, draft.fonts, draft.palette, draft.schemes, draft.logo]);

  useEffect(() => {
    let live = true;
    const t = setTimeout(async () => {
      try {
        const r = await api<{ url: string }>("POST", `/api/brands/${encodeURIComponent(id)}/motion/preview`, { brand: draft, kind: "style", id: style, scheme: firstScheme, format: "16x9" });
        if (live) setUrl(r.url);
      } catch {
        if (live) setFailed(true);
      }
    }, 300);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = (msg: object) => frame.current?.contentWindow?.postMessage(msg, location.origin);
  const play = () => {
    send({ play: true });
    setPlaying(true);
  };
  const pause = () => {
    send({ pause: true });
    setPlaying(false);
  };
  const scale = width ? width / 1920 : 0;
  const auto = !reducedMotion();

  return (
    <li className={`mtile${chosen ? " mtile--on" : ""}`} onMouseEnter={auto ? play : undefined} onMouseLeave={auto ? pause : undefined}>
      <div className="mtile__stage" ref={ref} style={{ height: scale ? Math.round(1080 * scale) : undefined }} aria-hidden="true">
        {url && scale ? <iframe ref={frame} src={url} title={`${label} preview`} tabIndex={-1} width={1920} height={1080} style={{ transform: `scale(${scale})` }} onLoad={() => send({ pause: true })} /> : null}
        {failed ? <p className="sp__none">No preview yet</p> : null}
      </div>
      <div className="mtile__body">
        <label className="mtile__choice">
          <input type="radio" name="motion-style" value={style} checked={chosen} onChange={onChoose} onFocus={auto ? play : undefined} onBlur={auto ? pause : undefined} />
          <span className="mtile__name">{label}</span>
          {style === "calm" ? <span className="mtile__default">Default</span> : null}
        </label>
        <p className="mtile__line">{line}</p>
        <Button variant="default" onClick={playing ? pause : play} disabled={!url} leftSection={playing ? <Pause size={20} aria-hidden="true" /> : <Play size={20} aria-hidden="true" />}>
          {playing ? "Pause" : "Play"}
          <span className="visually-hidden">{` ${label} preview`}</span>
        </Button>
      </div>
    </li>
  );
}

export function MotionCanvas() {
  const { meta, draft, edit } = useEditor();
  const styles: Array<{ id: string; label: string; line: string }> = (meta as any).motion?.styles ?? FALLBACK;
  const current = draft.motion?.style ?? "calm";
  return (
    <fieldset className="area-band mfield">
      <legend className="band-h">Motion style</legend>
      <p className="band-note">Used for every video with this brand. A video can still pick its own.</p>
      <ul className="plain-list mgrid">
        {styles.map((s) => (
          <MotionTile
            key={s.id}
            style={s.id}
            label={s.label}
            line={s.line}
            chosen={current === s.id}
            onChoose={() => {
              edit((d) => (d.motion = { ...(d.motion ?? {}), style: s.id }));
              announce(`Motion style: ${s.label}.`);
            }}
          />
        ))}
      </ul>
    </fieldset>
  );
}
