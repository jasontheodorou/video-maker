// A segmented switch built on native radio buttons, so arrow keys, Tab and screen readers work as they do on
// any radio group. A pill glides to the chosen option (framer-motion layoutId, off when motion is reduced).
import type { ReactNode } from "react";
import { Pill, usePillId } from "../shared/motion";

export interface SegmentOption {
  value: string;
  label: ReactNode;
  /** Shown before the label, hidden from screen readers. */
  icon?: ReactNode;
}

export function Segmented({ name, legend, legendHidden = false, options, value, onChange, className = "" }: { name: string; legend: string; legendHidden?: boolean; options: SegmentOption[]; value: string; onChange: (v: string) => void; className?: string }) {
  const pill = usePillId(name);
  return (
    <fieldset className={`segmented ${className}`}>
      <legend className={legendHidden ? "visually-hidden" : "segmented__legend"}>{legend}</legend>
      <div className="segmented__track">
        {options.map((o) => {
          const on = o.value === value;
          const id = `${name}-${o.value}`;
          return (
            <label key={o.value} className={`segmented__option${on ? " segmented__option--on" : ""}`} htmlFor={id}>
              {on ? <Pill layoutId={pill} className="segmented__pill" /> : null}
              <input className="segmented__input" type="radio" id={id} name={name} value={o.value} checked={on} onChange={() => onChange(o.value)} />
              {o.icon ? (
                <span className="segmented__icon" aria-hidden="true">
                  {o.icon}
                </span>
              ) : null}
              <span className="segmented__label">{o.label}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
