"use client";

/* v1.8.0 — the reference design's mini month calendar. Dots mark days with
   sessions; picking a day jumps the roster to that week. Pure CSS grid. */

import { useState } from "react";
import { btnSm } from "@/lib/ui-styles";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DOW = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];

export function MiniCalendar({ selected, marked, onPick }: {
  selected: string;              // YYYY-MM-DD (the roster's week start)
  marked: Set<string>;           // days that have sessions
  onPick: (dayISO: string) => void;
}) {
  const [month, setMonth] = useState(() => selected.slice(0, 7)); // YYYY-MM
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const first = new Date(Date.UTC(y, m - 1, 1));
  const startPad = (first.getUTCDay() + 6) % 7; // Monday-first
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const todayS = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
  const weekStart = Date.parse(selected + "T00:00:00Z");
  const weekEnd = weekStart + 6 * 86400_000;

  const nav = (delta: number) => {
    const d = new Date(Date.UTC(y, m - 1 + delta, 1));
    setMonth(d.toISOString().slice(0, 7));
  };

  return (
    <div className="border-border rounded-lg border p-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">{MONTHS[m - 1]} <span className="text-muted-foreground font-normal">{y}</span></p>
        <span className="flex gap-1">
          <button type="button" className={btnSm} aria-label="Previous month" onClick={() => nav(-1)}>‹</button>
          <button type="button" className={btnSm} aria-label="Next month" onClick={() => nav(1)}>›</button>
        </span>
      </div>
      <div className="mt-2 grid grid-cols-7 gap-0.5 text-center">
        {DOW.map((d) => <span key={d} className="text-muted-foreground text-[9px] font-semibold">{d}</span>)}
        {Array.from({ length: startPad }, (_, i) => <span key={`p${i}`} />)}
        {Array.from({ length: daysInMonth }, (_, i) => {
          const iso = `${month}-${String(i + 1).padStart(2, "0")}`;
          const t = Date.parse(iso + "T00:00:00Z");
          const inWeek = t >= weekStart && t <= weekEnd;
          return (
            <button key={iso} type="button" onClick={() => onPick(iso)}
              className={`relative rounded-md py-1 text-[11px] tabular-nums transition-colors ${
                iso === todayS ? "bg-brand font-bold text-white"
                : inWeek ? "bg-gold-soft/60 font-medium"
                : "hover:bg-secondary"
              }`}>
              {i + 1}
              {marked.has(iso) && <span className="bg-gold-deep absolute bottom-0.5 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full" aria-hidden />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
