"use client";

/* v1.14.0 — the context panel's month grid.
 *
 * Monday-first, because that is the Malaysian working week. Days carrying
 * something (a punch, approved leave, an event) get a gold dot; the selected
 * day gets the navy square. Pure divs — no calendar library, per the
 * codebase's no-heavy-deps rule.
 *
 * Dates are handled as MYT `YYYY-MM-DD` STRINGS end to end. Building a
 * `new Date(y, m, d)` here and reading `.getDate()` back would silently shift
 * the whole grid by a day for anyone whose browser is not on UTC+8 — the same
 * class of bug as the `slice(11,16)` timestamp already in the portal.
 */

import { getLang } from "@/lib/i18n";

const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);

/* Monday-first weekday headers; the BM short forms follow the roster board. */
const DOW_EN = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];
const DOW_MS = ["Isn", "Sel", "Rab", "Kha", "Jum", "Sab", "Ahd"];

export function MiniCalendar({
  /** MYT month to render, "YYYY-MM". */
  month,
  /** MYT day currently selected, "YYYY-MM-DD". */
  selected,
  /** MYT days that should carry a dot, "YYYY-MM-DD". */
  marked = [],
  onSelect,
  onMonth,
  label,
}: {
  month: string;
  selected?: string;
  marked?: string[];
  onSelect?: (day: string) => void;
  onMonth?: (delta: -1 | 1) => void;
  /** Heading, e.g. "August 2026". Caller formats it so language stays there. */
  label: string;
}) {
  const [y, m] = month.split("-").map(Number);
  if (!y || !m) return null;

  const daysIn = new Date(Date.UTC(y, m, 0)).getUTCDate();
  // 0=Sun..6=Sat from UTC (no local-timezone drift), shifted to Monday-first.
  const firstDow = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;
  const prevDays = new Date(Date.UTC(y, m - 1, 0)).getUTCDate();
  const mark = new Set(marked);
  const pad = (n: number) => String(n).padStart(2, "0");
  const iso = (d: number) => `${y}-${pad(m)}-${pad(d)}`;

  const cells: { key: string; n: number; out: boolean; day?: string }[] = [];
  for (let i = firstDow - 1; i >= 0; i--) cells.push({ key: `p${i}`, n: prevDays - i, out: true });
  for (let d = 1; d <= daysIn; d++) cells.push({ key: iso(d), n: d, out: false, day: iso(d) });
  for (let i = 1; cells.length % 7 !== 0; i++) cells.push({ key: `n${i}`, n: i, out: true });

  return (
    <div className="border-border bg-card rounded-card border p-3">
      <div className="mb-2 flex items-center justify-between">
        <b className="text-[12.5px] font-semibold">{label}</b>
        {onMonth ? (
          <div className="flex gap-1">
            <button type="button" aria-label={L("Previous month", "Bulan sebelumnya")} onClick={() => onMonth(-1)}
              className="text-muted-foreground hover:bg-secondary hover:text-foreground grid h-6 w-6 place-items-center rounded-md text-xs">‹</button>
            <button type="button" aria-label={L("Next month", "Bulan seterusnya")} onClick={() => onMonth(1)}
              className="text-muted-foreground hover:bg-secondary hover:text-foreground grid h-6 w-6 place-items-center rounded-md text-xs">›</button>
          </div>
        ) : null}
      </div>
      <div className="grid grid-cols-7 gap-px text-center">
        {(getLang() === "ms" ? DOW_MS : DOW_EN).map((d) => (
          <div key={d} className="text-muted-foreground pb-1 text-[9px] font-semibold">{d}</div>
        ))}
        {cells.map((c) => {
          if (c.out) return <div key={c.key} className="text-muted-foreground grid aspect-square place-items-center text-[11px] opacity-40">{c.n}</div>;
          const on = c.day === selected;
          const has = mark.has(c.day!);
          return (
            <button
              key={c.key}
              type="button"
              onClick={onSelect ? () => onSelect(c.day!) : undefined}
              aria-current={on ? "date" : undefined}
              className={`relative grid aspect-square place-items-center rounded-md text-[11px] tabular-nums transition-colors ${
                on ? "bg-primary text-primary-foreground font-semibold" : "hover:bg-secondary"
              }`}
            >
              {c.n}
              {has && <span aria-hidden className={`absolute bottom-[3px] h-[3px] w-[3px] rounded-full ${on ? "bg-primary-foreground" : "bg-gold-solid"}`} />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
