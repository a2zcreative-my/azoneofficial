"use client";

/* v1.4.270 — the brand-toned KPI primitives (CEO approved the plan:
   "firmly brand-toned, and hero band + row bars on Inventory and Social").

   The reference screenshot's structure is adopted — big number, tiny label,
   a progress bar INSIDE the card, an urgency tint on rows — but not its
   rainbow: four full-saturation blocks would break the navy/gold, must-not-
   look-AI-generated brief instantly. Here the ONE most important number gets
   the solid navy card, everything else is a white card with a gold bar —
   the same rule as row buttons (v1.4.253): one fill, or nothing reads as
   primary. */

import type { ReactNode } from "react";

/** The small in-card / in-row progress bar. Gold by default; green for done,
    red for danger, muted for empty. Pure divs — no SVG, no library. */
export function MiniBar({ pct, tone = "gold", className = "" }: {
  pct: number;
  tone?: "gold" | "green" | "red" | "navy" | "muted";
  className?: string;
}) {
  const p = Math.max(0, Math.min(100, pct));
  const fill = {
    gold: "bg-gold-solid", // v1.5.0: token, not hex
    green: "bg-bull",
    red: "bg-bear",
    navy: "bg-brand",
    muted: "bg-muted-foreground/40",
  }[tone];
  return (
    <span className={`bg-secondary block h-1.5 w-full overflow-hidden rounded-full ${className}`}>
      <span className={`block h-full rounded-full ${fill}`} style={{ width: `${p}%` }} />
    </span>
  );
}

/** One KPI card. `solid` = the navy hero (AT MOST ONE per band).
    v1.8.0 (UI-REDESIGN-PLAN.md): optional `icon` squircle, `trend` line and
    `hero` numerals — all additive, every existing call site renders as
    before. */
export function StatCard({ label, value, sub, bar, solid = false, accent, onClick, icon, trend, hero = false }: {
  label: string;                 // tiny uppercase label
  value: ReactNode;              // the big figure
  sub?: ReactNode;               // one quiet line under it
  bar?: { pct: number; label?: string; tone?: "gold" | "green" | "red" | "navy" | "muted" };
  solid?: boolean;
  accent?: "gold" | "red" | "green"; // thin top edge on white cards
  onClick?: () => void;
  /** v1.8.0 — emoji/glyph in a soft-tinted squircle, top-right. */
  icon?: ReactNode;
  /** v1.8.0 — "+13% last month" style line; up = green, down = red. */
  trend?: { text: string; dir?: "up" | "down" | "flat" };
  /** v1.8.0 — oversized numerals (dashboard top band). */
  hero?: boolean;
}) {
  const edge = accent === "red" ? "border-t-bear" : accent === "green" ? "border-t-bull" : "border-t-gold-solid"; // v1.5.0 tokens
  const trendCls =
    trend?.dir === "down" ? (solid ? "text-red-300" : "text-bear") :
    trend?.dir === "flat" ? (solid ? "text-white/70" : "text-muted-foreground") :
    solid ? "text-green-300" : "text-bull";

  const inner = (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className={`text-[10px] font-semibold tracking-wider uppercase ${solid ? "text-white/70" : "text-muted-foreground"}`}>{label}</p>
        {icon && (
          <span aria-hidden className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-base ${solid ? "bg-white/10" : "bg-tint-gold"}`}>
            {icon}
          </span>
        )}
      </div>
      <p className={hero
        ? "mt-1 text-3xl leading-none font-semibold tracking-tight tabular-nums md:text-4xl"
        : "mt-1 text-2xl leading-tight font-bold tabular-nums"}>{value}</p>
      {trend && (
        <p className="mt-1.5 text-xs">
          <span className={`font-medium ${trendCls}`}>
            {trend.dir === "down" ? "▾ " : trend.dir === "flat" ? "" : "▴ "}{trend.text}
          </span>
        </p>
      )}
      {bar && (
        <div className="mt-2">
          <MiniBar pct={bar.pct} tone={solid ? "gold" : (bar.tone ?? "gold")} className={solid ? "bg-white/20" : ""} />
          {bar.label && <p className={`mt-1 text-[11px] ${solid ? "text-white/70" : "text-muted-foreground"}`}>{bar.label}</p>}
        </div>
      )}
      {sub && <p className={`mt-2 text-xs leading-snug ${solid ? "text-white/80" : "text-muted-foreground"}`}>{sub}</p>}
    </>
  );

  const baseClasses = solid
    ? "rounded-card bg-brand shadow-soft p-4 text-white"
    : `border-border bg-card rounded-card shadow-soft border border-t-2 ${edge} p-4`;

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={`block w-full text-left transition-colors hover:border-primary focus:border-primary outline-none ${baseClasses}`}>
        {inner}
      </button>
    );
  }

  return (
    <div className={baseClasses}>
      {inner}
    </div>
  );
}

/** Urgency tint for a list/table row: red = act now, amber = watch.
    Apply to the row's first cell (border on <tr> is unreliable). */
export const accentCellDanger = "border-l-4 border-l-red-400";
export const accentRowDanger = "bg-red-50/60";
export const accentCellWarn = "border-l-4 border-l-amber-400";
export const accentRowWarn = "bg-amber-50/60";

/** "in 3d" / "today" / "5d overdue" — the how-worried-to-be chip that sits
    next to a date. Dates say WHEN; this says whether to act. */
export function dueChip(dateISO: string | null | undefined, todayISO: string): { text: string; cls: string } | null {
  if (!dateISO) return null;
  const d = Math.round((new Date(dateISO + "T00:00:00Z").getTime() - new Date(todayISO + "T00:00:00Z").getTime()) / 86400_000);
  if (Number.isNaN(d)) return null;
  if (d < 0) return { text: `${-d}d overdue`, cls: "bg-danger-soft text-danger" }; // v1.5.0 tokens
  if (d === 0) return { text: "today", cls: "bg-warning-soft text-warning" };
  if (d <= 7) return { text: `in ${d}d`, cls: "bg-secondary text-foreground" };
  return null; // far-off dates need no chip — chips are for urgency, not decoration
}
