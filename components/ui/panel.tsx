"use client";

/* v1.320.0 - THE 2.0 PANEL (Sales 2.0 Stage 1, the design foundation; the
   same card every 2.0 picture draws - Sales, Tasks, Claims, Leave, Financial
   Advisory): a white card whose head is a tinted icon well, the title with
   an optional count, one quiet line under it, and the card's own controls
   at the right ("View all", a period switch, a filter).

     <Panel icon="orders" title="Sales Worklist" count={7} sub="Active ..." aside={...}>
       ...body...
     </Panel>

   And WorkspaceGrid: the pictures' page shape - the main column and a
   narrower rail of panels beside it from 1280px, one column below that.

   One component so the modules cannot drift apart (claude/SALES-2.0-STAGE-0-AUDIT.md,
   Stage 1). It fetches nothing and invents nothing; everything is handed in. */

import type { ReactNode } from "react";
import { AppIcon, type AppIconName } from "@/components/ui/app-icon";
import css from "./panel.module.css";

export type PanelTone = "blue" | "gold" | "green" | "red" | "purple" | "navy";

export function PanelHead({ icon, tone = "blue", title, count, sub, aside, level = 2 }: {
  icon: AppIconName; tone?: PanelTone; title: ReactNode;
  /** a number beside the title, as "(7)" in the pictures; null or undefined draws none */
  count?: number | null;
  sub?: ReactNode; aside?: ReactNode;
  /** the heading level inside the page (h2 by default) */
  level?: 2 | 3;
}) {
  const H = level === 3 ? "h3" : "h2";
  return (
    <header className={css.head}>
      <span className={`${css.well} ${css[tone]}`} aria-hidden><AppIcon name={icon} /></span>
      <span className={css.text}>
        <H className={css.title}>{title}{count != null && <span className={css.count} data-testid="panel-count">({count})</span>}</H>
        {sub && <span className={css.sub}>{sub}</span>}
      </span>
      {aside && <span className={css.aside}>{aside}</span>}
    </header>
  );
}

export function Panel({ icon, tone, title, count, sub, aside, level, children, testid, label, className = "", flush = false }: {
  icon: AppIconName; tone?: PanelTone; title: ReactNode; count?: number | null; sub?: ReactNode; aside?: ReactNode; level?: 2 | 3;
  children?: ReactNode; testid?: string;
  /** the region's name for a screen reader when the title is not plain text */
  label?: string;
  className?: string;
  /** a table that runs to the card's edges */
  flush?: boolean;
}) {
  return (
    <section className={`erp-card ${css.panel} ${flush ? css.flush : ""} ${className}`} data-testid={testid} aria-label={label ?? (typeof title === "string" ? title : undefined)}>
      <PanelHead icon={icon} tone={tone} title={title} count={count} sub={sub} aside={aside} level={level} />
      {children}
    </section>
  );
}

/** the pictures' page shape: the main column, and the rail beside it from 1280px */
export function WorkspaceGrid({ main, rail, testid }: { main: ReactNode; rail: ReactNode; testid?: string }) {
  return (
    <div className={css.grid} data-testid={testid}>
      <div className={css.main}>{main}</div>
      <aside className={css.rail}>{rail}</aside>
    </div>
  );
}

/** a pill switch inside a panel's head ("This Week · This Month · YTD", "Everyone · Mine") */
export function PillSwitch<T extends string>({ value, options, onChange, label, testid }: {
  value: T; options: readonly (readonly [T, string])[]; onChange: (v: T) => void; label: string; testid?: string;
}) {
  return (
    <span className={css.pills} role="group" aria-label={label} data-testid={testid}>
      {options.map(([k, text]) => (
        <button key={k} type="button" aria-pressed={k === value} onClick={() => onChange(k)}>{text}</button>
      ))}
    </span>
  );
}
