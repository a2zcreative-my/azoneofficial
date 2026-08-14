"use client";

/* v1.8.0 — BarChart (UI-REDESIGN-PLAN.md Phase 0).
   The reference dashboard's monthly bars: an optional background series
   (soft navy tint — "total") with the emphasis series in brand gold in
   front ("completed"), one hover/tap tooltip bubble, direct label on the
   active bar only. Pure divs — no chart library, per the codebase rule
   (sales-by-hour-card set the precedent).

   Color per the dataviz validation run: solid gold #c9a227 is only 2.4:1 on
   white, so the emphasis series uses gold-DEEP (5:1, and the token already
   lightens itself in dark mode); solid gold is the hover highlight. The
   background series is a tint, separated by geometry (front/back bars),
   and both series are named in the legend — identity never rides on color
   alone. One y-scale only. */

import { useState } from "react";

export interface BarDatum {
  label: string;      // x label ("Jan")
  value: number;      // emphasis series
  bg?: number;        // optional background series (>= value usually)
  hint?: string;      // tooltip line ("76 completed")
}

export function BarChart({ data, height = 160, seriesLabel, bgLabel, format = (n) => String(n) }: {
  data: BarDatum[];
  height?: number;
  /** Legend names — required when bg series present (never color-alone). */
  seriesLabel: string;
  bgLabel?: string;
  format?: (n: number) => string;
}) {
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((d) => Math.max(d.value, d.bg ?? 0)));
  const hasBg = data.some((d) => d.bg !== undefined);

  return (
    <div>
      <div className="flex items-end gap-1.5 sm:gap-2" style={{ height }} role="img"
        aria-label={`${seriesLabel}: ${data.map((d) => `${d.label} ${format(d.value)}`).join(", ")}`}>
        {data.map((d, i) => {
          const hPct = (d.value / max) * 100;
          const bgPct = ((d.bg ?? 0) / max) * 100;
          const isActive = active === i;
          return (
            <button
              key={i}
              type="button"
              className="group relative flex h-full flex-1 cursor-default items-end justify-center outline-none"
              onMouseEnter={() => setActive(i)}
              onMouseLeave={() => setActive((a) => (a === i ? null : a))}
              onFocus={() => setActive(i)}
              onBlur={() => setActive((a) => (a === i ? null : a))}
              aria-label={`${d.label}: ${format(d.value)}${d.hint ? ` — ${d.hint}` : ""}`}
            >
              {/* background series (total) — behind, full width of the slot */}
              {hasBg && (
                <span aria-hidden className="bg-tint-navy absolute inset-x-0 bottom-0 rounded-t-[4px]"
                  style={{ height: `${bgPct}%` }} />
              )}
              {/* emphasis series — thinner, in front, 4px rounded data-end */}
              <span aria-hidden
                className={`relative w-3/5 rounded-t-[4px] transition-colors sm:w-1/2 ${isActive ? "bg-gold-solid" : "bg-gold-deep"}`}
                style={{ height: `${hPct}%`, minHeight: d.value > 0 ? 3 : 0 }} />
              {/* tooltip bubble — active bar only (selective direct labels) */}
              {isActive && (
                <span className="bg-brand pointer-events-none absolute -top-1 left-1/2 z-10 -translate-x-1/2 -translate-y-full rounded-lg px-2.5 py-1.5 text-center whitespace-nowrap text-white shadow-soft">
                  <span className="block text-xs font-semibold tabular-nums">{format(d.value)}</span>
                  {d.hint && <span className="block text-[10px] text-white/75">{d.hint}</span>}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <div className="mt-1 flex gap-1.5 sm:gap-2">
        {data.map((d, i) => (
          <span key={i} className={`flex-1 text-center text-[10px] ${active === i ? "text-foreground font-medium" : "text-muted-foreground"}`}>
            {d.label}
          </span>
        ))}
      </div>
      {/* legend — always when two series exist */}
      {hasBg && bgLabel && (
        <div className="text-muted-foreground mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
          <span className="flex items-center gap-1.5"><span className="bg-gold-deep h-2 w-3 rounded-sm" aria-hidden />{seriesLabel}</span>
          <span className="flex items-center gap-1.5"><span className="bg-tint-navy border-border h-2 w-3 rounded-sm border" aria-hidden />{bgLabel}</span>
        </div>
      )}
    </div>
  );
}
