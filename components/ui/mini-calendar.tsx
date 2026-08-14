"use client";

/* v1.8.0 — MiniCalendar (UI-REDESIGN-PLAN.md Phase 0).
   The reference's context-panel month grid: Monday-first (Malaysian working
   convention and the reference itself), dot markers under days that have
   items, selected day as a navy pill, today ringed. Controlled component —
   the parent owns the selected date, this only renders and reports taps. */

import { useState } from "react";

const DOW = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Local YYYY-MM-DD (the portal's date convention everywhere). */
function iso(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function MiniCalendar({ selected, onSelect, marked, todayISO }: {
  selected?: string;               // YYYY-MM-DD
  onSelect?: (dateISO: string) => void;
  /** Days that carry a dot (sessions/events/leave), as YYYY-MM-DD strings. */
  marked?: Set<string> | string[];
  /** Injected so SSR/static export can't disagree with the client clock. */
  todayISO: string;
}) {
  const base = selected ?? todayISO;
  const [view, setView] = useState({ y: +base.slice(0, 4), m: +base.slice(5, 7) - 1 });
  const markSet = marked instanceof Set ? marked : new Set(marked ?? []);

  const first = new Date(Date.UTC(view.y, view.m, 1));
  const startCol = (first.getUTCDay() + 6) % 7; // Monday-first
  const daysInMonth = new Date(Date.UTC(view.y, view.m + 1, 0)).getUTCDate();
  const cells: (number | null)[] = [
    ...Array.from({ length: startCol }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const nav = (dir: -1 | 1) =>
    setView((v) => {
      const m = v.m + dir;
      return m < 0 ? { y: v.y - 1, m: 11 } : m > 11 ? { y: v.y + 1, m: 0 } : { y: v.y, m };
    });

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <p className="text-sm font-semibold">{MONTHS[view.m]} <span className="text-muted-foreground font-normal">{view.y}</span></p>
        <div className="flex gap-1">
          <button type="button" onClick={() => nav(-1)} aria-label="Previous month"
            className="border-border hover:bg-secondary flex h-7 w-7 items-center justify-center rounded-lg border text-sm">‹</button>
          <button type="button" onClick={() => nav(1)} aria-label="Next month"
            className="border-border hover:bg-secondary flex h-7 w-7 items-center justify-center rounded-lg border text-sm">›</button>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-y-0.5 text-center">
        {DOW.map((d) => (
          <span key={d} className="text-muted-foreground pb-1 text-[10px] font-medium">{d}</span>
        ))}
        {cells.map((d, i) => {
          if (d === null) return <span key={i} />;
          const dISO = iso(view.y, view.m, d);
          const isSel = dISO === selected;
          const isToday = dISO === todayISO;
          return (
            <button
              key={i}
              type="button"
              onClick={() => onSelect?.(dISO)}
              aria-label={dISO}
              aria-pressed={isSel}
              className={`relative mx-auto flex h-8 w-8 items-center justify-center rounded-full text-xs tabular-nums transition-colors ${
                isSel
                  ? "bg-primary text-primary-foreground font-semibold"
                  : isToday
                    ? "ring-gold-solid text-foreground font-semibold ring-1"
                    : "hover:bg-secondary"
              }`}
            >
              {d}
              {markSet.has(dISO) && !isSel && (
                <span aria-hidden className="bg-gold-solid absolute bottom-0.5 h-1 w-1 rounded-full" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
