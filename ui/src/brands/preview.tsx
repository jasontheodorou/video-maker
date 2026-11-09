// The live preview (three scenes in three formats) and the checks, both in the editor's one column.
import { useElementSize } from "@mantine/hooks";
import { CheckCircle } from "@phosphor-icons/react";
import { motion } from "framer-motion";
import { useState } from "react";
import { Reveal, duration, ease } from "../shared/motion";
import { Message, SkeletonBlock } from "../shared/ui";
import { plural, sectionFor, useEditor } from "./context";

const SCENE_LABELS: Record<string, string> = { title: "Title", statement: "Statement", end: "End card" };
const FORMAT_SHORT: Record<string, string> = { "16x9": "16:9", "9x16": "9:16", "1x1": "1:1" };

export interface PreviewItem {
  scene: string;
  format: string;
  url: string;
  width: number;
  height: number;
  issues?: string[];
}

/** One frame: a scaled iframe that fades in once it has drawn. */
function Frame({ it, H, scene }: { it: PreviewItem; H: number; scene: string }) {
  const [loaded, setLoaded] = useState(false);
  const scale = H / it.height;
  const label = SCENE_LABELS[scene] ?? scene;
  return (
    <li className="frame" data-key={`${scene}-${it.format}`}>
      <a className="preview-link" href={it.url} target="_blank" rel="noopener" style={{ width: Math.round(it.width * scale), height: H }}>
        <motion.iframe
          src={it.url}
          title={`${label} preview, ${FORMAT_SHORT[it.format]}`}
          tabIndex={-1}
          aria-hidden="true"
          width={it.width}
          height={it.height}
          style={{ transform: `scale(${scale})` }}
          initial={false}
          animate={{ opacity: loaded ? 1 : 0 }}
          transition={{ duration: duration.base, ease: ease.out }}
          onLoad={() => setLoaded(true)}
        />
        <span className="visually-hidden">{`${label} in ${FORMAT_SHORT[it.format]}, opens full size in a new tab`}</span>
      </a>
      <p className="preview-label" aria-hidden="true">
        {FORMAT_SHORT[it.format]}
      </p>
    </li>
  );
}

export function Preview({ items, error }: { items: PreviewItem[] | null; error: string | null }) {
  const { ref, width } = useElementSize();
  const scenes = items ? [...new Set(items.map((i) => i.scene))] : [];
  // Each scene's formats share one row at the same height, each in its real shape.
  const ratios = (scene: string) => (items ?? []).filter((i) => i.scene === scene).reduce((t, i) => t + i.width / i.height, 0);
  const gap = 12;
  return (
    <div id="preview" className="previews" ref={ref}>
      {error ? <p className="bad-text">{`The preview could not be made: ${error}`}</p> : null}
      {!items ? (
        <SkeletonBlock height={180} label="Loading the preview" />
      ) : !items.length ? (
        <p>Fix the problems under Checks to see a preview.</p>
      ) : (
        scenes.map((scene) => {
          const sceneItems = items.filter((i) => i.scene === scene);
          const H = width ? Math.max(48, Math.min(220, Math.floor((width - gap * (sceneItems.length - 1)) / ratios(scene)))) : 120;
          const issues = sceneItems.flatMap((it) => (it.issues ?? []).map((m) => `${FORMAT_SHORT[it.format]}: ${m}`));
          return (
            <div className="scene-row" key={scene} data-scene-row={scene}>
              <h3 className="scene-row__h">{SCENE_LABELS[scene] ?? scene}</h3>
              <ul className="frames plain-list">
                {sceneItems.map((it) => (
                  <Frame key={`${scene}-${it.format}`} it={it} H={H} scene={scene} />
                ))}
              </ul>
              {issues.length ? (
                <ul className="list preview-issues">
                  {issues.map((m, k) => (
                    <li key={k}>{m}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          );
        })
      )}
    </div>
  );
}

// ---------- checks ----------

export function Checks() {
  const { check, go } = useEditor();
  const issues = check?.issues ?? [];
  const errors = issues.filter((i) => i.level === "error");
  // "Still to confirm" groups are one line, so they do not bury a real warning.
  const unconfirmed = issues.filter((i) => i.level === "warning" && i.field === "provisional").map((i) => i.message.replace(/ is provisional and still needs confirming\.$/, ""));
  const warnings = issues.filter((i) => i.level === "warning" && i.field !== "provisional");
  const link = (id: string, label: string) => (
    <a
      href={`#${id}`}
      onClick={(e) => {
        e.preventDefault();
        go(id);
      }}
    >
      {label}
    </a>
  );
  const item = (i: { field: string; message: string }, k: number) => {
    const s = sectionFor(i.field);
    return (
      <li key={k}>
        {link(s.id, s.label)}
        {`: ${i.message}`}
      </li>
    );
  };
  return (
    <div id="checks" aria-live="polite" className="checks">
      {errors.length ? (
        <Message tone="bad">
          <h3>{`${plural(errors.length, "problem")} stop${errors.length === 1 ? "s" : ""} this brand being used`}</h3>
          <ul className="issues">{errors.map(item)}</ul>
        </Message>
      ) : (
        <Reveal className="checks__ok" y={4}>
          <CheckCircle size={28} weight="fill" aria-hidden="true" />
          <p className="ok-text">{warnings.length ? "Ready to use. Passes AAA contrast." : "Passes every check, including AAA contrast."}</p>
        </Reveal>
      )}
      {warnings.length ? (
        <div className="worth-checking">
          <h3 className="h4">Worth a look</h3>
          <ul className="list issues">{warnings.map(item)}</ul>
        </div>
      ) : null}
      {unconfirmed.length ? (
        <p className="unconfirmed">
          {link("sec-about", "Still to confirm")}
          {`: ${unconfirmed.join(", ")}. These do not stop videos.`}
        </p>
      ) : null}
    </div>
  );
}
