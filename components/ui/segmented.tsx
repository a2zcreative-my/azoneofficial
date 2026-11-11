"use client";

/* v1.280.0 - MINIMAL EXECUTIVE WORKSPACE: the segmented control (This Week /
   This Month / YTD on the Dashboard's Sales Performance). A radio group: one
   choice, Left / Right (and Up / Down) move it, the chosen one is the gold
   pill. It only draws; the caller owns the value. */

import { useRef, type KeyboardEvent } from "react";
import css from "./segmented.module.css";

export function Segmented<K extends string>({ value, onChange, options, label }: {
  value: K;
  onChange: (k: K) => void;
  options: readonly (readonly [K, string])[];
  /** the group's accessible name ("Period") */
  label: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const i = options.findIndex(([k]) => k === value);
    const next = options[(i + step + options.length) % options.length]![0];
    onChange(next);
    requestAnimationFrame(() => ref.current?.querySelector<HTMLButtonElement>(`[data-key="${next}"]`)?.focus());
  };
  return (
    <div ref={ref} className={css.group} role="radiogroup" aria-label={label} onKeyDown={onKey}>
      {options.map(([k, text]) => (
        <button key={k} type="button" role="radio" data-key={k} aria-checked={k === value} tabIndex={k === value ? 0 : -1}
          className={`${css.option} ${k === value ? css.on : ""}`} onClick={() => onChange(k)}>
          {text}
        </button>
      ))}
    </div>
  );
}
