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
    gold: "bg-[#C9A227]",
    green: "bg-green-500",
    red: "bg-red-400",
    navy: "bg-[#1A2946]",
    muted: "bg-muted-foreground/40",
  }[tone];
  return (
    <span className={`bg-secondary block h-1.5 w-full overflow-hidden rounded-full ${className}`}>
      <span className={`block h-full rounded-full ${fill}`} style={{ width: `${p}%` }} />
    </span>
  );
}

/** One KPI card. `solid` = the navy hero (AT MOST ONE per band). */
export function StatCard({ label, value, sub, bar, solid = false, accent }: {
  label: string;                 // tiny uppercase label
  value: ReactNode;              // the big figure
  sub?: ReactNode;               // one quiet line under it
  bar?: { pct: number; label?: string; tone?: "gold" | "green" | "red" | "navy" | "muted" };
  solid?: boolean;
  accent?: "gold" | "red" | "green"; // thin top edge on white cards
}) {
  const edge = accent === "red" ? "border-t-red-400" : accent === "green" ? "border-t-green-500" : "border-t-[#C9A227]";
  return (
    <div className={solid
      ? "rounded-xl bg-[#1A2946] p-4 text-white shadow-sm"
      : `border-border bg-card rounded-xl border border-t-2 ${edge} p-4 shadow-sm`}>
      <p className={`text-[10px] font-semibold tracking-wider uppercase ${solid ? "text-white/70" : "text-muted-foreground"}`}>{label}</p>
      <p className="mt-1 text-2xl leading-tight font-bold tabular-nums">{value}</p>
      {bar && (
        <div className="mt-2">
          <MiniBar pct={bar.pct} tone={solid ? "gold" : (bar.tone ?? "gold")} className={solid ? "bg-white/20" : ""} />
          {bar.label && <p className={`mt-1 text-[11px] ${solid ? "text-white/70" : "text-muted-foreground"}`}>{bar.label}</p>}
        </div>
      )}
      {sub && <p className={`mt-1 text-xs ${solid ? "text-white/80" : "text-muted-foreground"}`}>{sub}</p>}
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
  if (d < 0) return { text: `${-d}d overdue`, cls: "bg-red-100 text-red-700" };
  if (d === 0) return { text: "today", cls: "bg-amber-100 text-amber-800" };
  if (d <= 7) return { text: `in ${d}d`, cls: "bg-secondary text-foreground" };
  return null; // far-off dates need no chip — chips are for urgency, not decoration
}
