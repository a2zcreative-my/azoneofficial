"use client";

/* v1.321.0 - THE COMPACT SUMMARY STRIP, shared (the CEO's "Tasks Module
   Unified Workspace Redesign", 16-11-2026: "Replace large KPI cards with
   compact summary strips"). One row of figures, never a second row of
   cards: a small tinted well, the label, the figure, one short line.

   Moved here from components/portal/sales-shell.tsx (Sales Workspace 4.0,
   v1.292.0), where it was born, so Sales and Tasks draw the same strip -
   sales-shell.tsx re-exports it unchanged. A cell with `onClick` is a
   button and may be `pressed` (a strip cell that is also the list's filter).
   It fetches nothing and invents nothing. */

import type { ReactNode } from "react";
import { AppIcon, type AppIconName } from "@/components/ui/app-icon";
import css from "./metric-strip.module.css";

export type StripTone = "gold" | "ok" | "bad" | "info" | "neutral";
export interface StripCell {
  key: string; icon: AppIconName; tone: StripTone; label: string; value: ReactNode; sub?: ReactNode;
  busy?: boolean; onClick?: () => void; title?: string;
  /** v1.321.0 - the cell is the filter in force */
  pressed?: boolean;
}

export function MetricStrip({ cells, label, testid = "metric-strip" }: { cells: StripCell[]; label: string; testid?: string }) {
  return (
    <div className={css.strip} role="group" aria-label={label} data-testid={testid} data-cells={cells.length}>
      {cells.map((c) => {
        const body = (
          <>
            <span className={`${css.well} ${css[`w_${c.tone}`]}`} aria-hidden><AppIcon name={c.icon} /></span>
            <span className={css.cellText}>
              <span className={css.cellLabel}>{c.label}</span>
              <strong className={css.cellValue} aria-busy={c.busy || undefined}>{c.busy ? "···" : c.value}</strong>
              {c.sub && !c.busy && <span className={css.cellSub}>{c.sub}</span>}
            </span>
          </>
        );
        return c.onClick
          ? <button key={c.key} type="button" className={css.cell} onClick={c.onClick} title={c.title} aria-pressed={c.pressed ?? undefined} data-cell={c.key}>{body}</button>
          : <div key={c.key} className={css.cell} title={c.title} data-cell={c.key}>{body}</div>;
      })}
    </div>
  );
}
