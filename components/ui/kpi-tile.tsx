"use client";

/* v1.191.0 - THE REFERENCE FIGURE TILE (the owner's photos for Ecommerce,
   Sales and Attendance, 22-10-2026): a tinted icon well on the left, then the
   label, the figure, one line
   under it - a delta with its arrow, or a plain sentence - and, where the
   photo draws one, a share bar or a small bar run. One component so the three
   pages cannot drift apart. Everything it shows is handed in: it fetches
   nothing and invents nothing.

   v1.323.0 - THE ONE KPI STRIP (the CEO's Global UI System brief, approved
   16-11-2026; claude/UI-SYSTEM-STAGE-0-AUDIT.md R-1): KpiRow IS the strip -
   one connected card - and KpiTile is a segment of it, never a card of its
   own. Every page that draws figures draws them here (MetricStrip in
   metric-strip.tsx is this same strip, fed a list); the props are unchanged,
   so every page took the new strip without being edited. */

import { Children, Fragment, isValidElement, type ReactElement, type ReactNode } from "react";
import { AppIcon, type AppIconName } from "@/components/ui/app-icon";
import css from "./kpi-tile.module.css";

export type KpiTone = "gold" | "green" | "red" | "blue" | "navy" | "purple";

/** how many segments the strip lays out: a fragment's own children count, not the fragment */
function segments(children: ReactNode): number {
  return Children.toArray(children).reduce<number>((n, c) => n + (!isValidElement(c) ? 0 : c.type === Fragment ? segments((c as ReactElement<{ children?: ReactNode }>).props.children) : 1), 0);
}

/** the strip: one card; its segments connected, `data-cells` the count it lays out.
    `cols` (v1.320.0) is kept for the pages that pass it - the count decides now. */
export function KpiRow({ children, label, cols, testid }: { children: ReactNode; label?: string; cols?: 4 | 5 | 6; testid?: string }) {
  const n = segments(children);
  return (
    <div className={`${css.row} ${cols ? css[`cols${cols}`] : ""}`} role={label ? "group" : undefined} aria-label={label}
      data-cols={cols} data-cells={n} data-testid={testid} data-kpi-strip="">
      {children}
    </div>
  );
}

export function KpiTile({ icon, tone, label, value, busy = false, sub, delta, bar, spark, link, onClick, title, pressed, cell, testid }: {
  icon: AppIconName;
  tone: KpiTone;
  label: ReactNode;
  value: ReactNode;
  /** the figure is not known yet: a placeholder, never a false zero */
  busy?: boolean;
  /* v1.274.0 - no period chip: the page's month picker says the period once,
     and the sub-line says it in words ("This month · ...") - the same on every tab */
  /** a plain line under the figure */
  sub?: ReactNode;
  /** a change against a previous period; null pct = nothing to compare.
      v1.279.0 - `vs` ("vs last month") is drawn beside the pill, as the photo */
  delta?: { pct: number | null; text: string; vs?: string } | null;
  /** a share bar under the line (0-100) */
  bar?: { pct: number; tone: "green" | "gold" | "red" | "blue" };
  /** up to 14 values drawn as a small bar run, the last one emphasised */
  spark?: readonly number[];
  /** a quiet link under the figure ("View live status"); not drawn on a
      pressable tile, which is itself the way in */
  link?: { label: string; onClick: () => void };
  onClick?: () => void;
  title?: string;
  /** v1.307.0 - a pressable tile that is also a filter says whether it is on */
  pressed?: boolean;
  /** v1.323.0 - the segment's own name (MetricStrip's cell key), for tests and links */
  cell?: string;
  /** v1.323.0 - a page's own test id for this segment (the Desk's desk-fig-*) */
  testid?: string;
}) {
  const max = spark && spark.length > 0 ? Math.max(1, ...spark) : 1;
  const body = (
    <>
      <span className={`${css.well} ${css[tone]}`}><AppIcon name={icon} /></span>
      <span className={css.body}>
        <span className={css.top}>
          <span className={css.label}>{label}</span>
        </span>
        <span className={css.mid}>
          <span className={css.value} aria-busy={busy}>{busy ? "···" : value}</span>
          {spark && spark.length > 1 && !busy && (
            <span className={css.spark} aria-hidden>
              {spark.slice(-14).map((v, i, a) => (
                <span key={i} className={i === a.length - 1 ? css.sparkLast : css.sparkBar} style={{ height: `${Math.max(8, Math.round((v / max) * 100))}%` }} />
              ))}
            </span>
          )}
        </span>
        {delta && delta.pct != null && !busy && (
          <span className={css.change}>
            <span className={delta.pct >= 0 ? css.up : css.down}>{delta.pct >= 0 ? "▲" : "▼"} {delta.text}</span>
            {delta.vs && <span>{delta.vs}</span>}
          </span>
        )}
        {sub && <span className={css.sub} title={typeof sub === "string" ? sub : undefined}>{sub}</span>}
        {bar && !busy && (
          <span className={css.bar} role="img" aria-label={`${Math.round(bar.pct)}%`}>
            <span className={`${css.fill} ${css[`fill_${bar.tone}`]}`} style={{ width: `${Math.max(0, Math.min(100, bar.pct))}%` }} />
          </span>
        )}
        {link && !onClick && (
          <button type="button" className={css.link} onClick={link.onClick}>{link.label} →</button>
        )}
      </span>
    </>
  );
  return onClick
    ? <button type="button" className={`${css.tile} ${css.press}`} onClick={onClick} title={title} aria-pressed={pressed} data-cell={cell} data-testid={testid}>{body}</button>
    : <div className={css.tile} title={title} data-cell={cell} data-testid={testid}>{body}</div>;
}
