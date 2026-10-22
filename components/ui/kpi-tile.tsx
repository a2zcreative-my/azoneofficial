"use client";

/* v1.191.0 - THE REFERENCE FIGURE TILE (the owner's photos for Ecommerce,
   Sales and Attendance, 22-10-2026): a tinted icon well on the left, then the
   label (with an optional period chip at the right), the figure, one line
   under it - a delta with its arrow, or a plain sentence - and, where the
   photo draws one, a share bar or a small bar run. One component so the three
   pages cannot drift apart. Everything it shows is handed in: it fetches
   nothing and invents nothing. */

import type { ReactNode } from "react";
import { AppIcon, type AppIconName } from "@/components/ui/app-icon";
import css from "./kpi-tile.module.css";

export type KpiTone = "gold" | "green" | "red" | "blue" | "navy" | "purple";

export function KpiRow({ children, label }: { children: ReactNode; label?: string }) {
  return <div className={css.row} role={label ? "group" : undefined} aria-label={label}>{children}</div>;
}

export function KpiTile({ icon, tone, label, value, busy = false, period, sub, delta, bar, spark, link, onClick, title }: {
  icon: AppIconName;
  tone: KpiTone;
  label: ReactNode;
  value: ReactNode;
  /** the figure is not known yet: a placeholder, never a false zero */
  busy?: boolean;
  /** a static period word at the top right ("This month") */
  period?: string;
  /** a plain line under the figure */
  sub?: ReactNode;
  /** a change against a previous period; null pct = nothing to compare */
  delta?: { pct: number | null; text: string } | null;
  /** a share bar under the line (0-100) */
  bar?: { pct: number; tone: "green" | "gold" | "red" | "blue" };
  /** up to 14 values drawn as a small bar run, the last one emphasised */
  spark?: readonly number[];
  /** a quiet link under the figure ("View live status"); not drawn on a
      pressable tile, which is itself the way in */
  link?: { label: string; onClick: () => void };
  onClick?: () => void;
  title?: string;
}) {
  const max = spark && spark.length > 0 ? Math.max(1, ...spark) : 1;
  const body = (
    <>
      <span className={`${css.well} ${css[tone]}`}><AppIcon name={icon} /></span>
      <span className={css.body}>
        <span className={css.top}>
          <span className={css.label}>{label}</span>
          {period && <span className={css.period}>{period}</span>}
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
          <span className={delta.pct >= 0 ? css.up : css.down}>{delta.pct >= 0 ? "↑" : "↓"} {delta.text}</span>
        )}
        {sub && <span className={css.sub}>{sub}</span>}
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
    ? <button type="button" className={`erp-card ${css.tile} ${css.press}`} onClick={onClick} title={title}>{body}</button>
    : <div className={`erp-card ${css.tile}`} title={title}>{body}</div>;
}
