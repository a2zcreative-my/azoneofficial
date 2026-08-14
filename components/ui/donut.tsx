"use client";

/* v1.8.0 — a small SVG donut (the reference dashboard's attendance ring).
   Pure SVG arcs, no chart library (house rule). Center shows a headline
   number; the legend renders beside it. Colours come from the semantic
   tokens so light/dark both work. */

export interface DonutSlice { label: string; value: number; color: string }

export function Donut({ slices, centerLabel, centerSub, size = 120 }: {
  slices: DonutSlice[];
  centerLabel: string;
  centerSub?: string;
  size?: number;
}) {
  const total = Math.max(1, slices.reduce((a, s) => a + s.value, 0));
  const r = 42;
  const stroke = 14;
  const C = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div className="flex items-center gap-4">
      <svg width={size} height={size} viewBox="0 0 100 100" role="img"
        aria-label={slices.map((s) => `${s.label}: ${s.value}`).join(", ")}>
        <circle cx="50" cy="50" r={r} fill="none" stroke="var(--secondary)" strokeWidth={stroke} />
        {slices.map((s) => {
          const frac = s.value / total;
          const dash = frac * C;
          const el = (
            <circle key={s.label} cx="50" cy="50" r={r} fill="none"
              stroke={s.color} strokeWidth={stroke}
              strokeDasharray={`${dash} ${C - dash}`}
              strokeDashoffset={-offset}
              transform="rotate(-90 50 50)"
              strokeLinecap="butt" />
          );
          offset += dash;
          return el;
        })}
        <text x="50" y="48" textAnchor="middle" className="fill-foreground" style={{ font: "700 16px var(--font-sans, sans-serif)" }}>{centerLabel}</text>
        {centerSub && <text x="50" y="62" textAnchor="middle" style={{ font: "500 7px var(--font-sans, sans-serif)", fill: "var(--muted-foreground)" }}>{centerSub}</text>}
      </svg>
      <div className="space-y-1">
        {slices.map((s) => (
          <p key={s.label} className="flex items-center gap-2 text-xs">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: s.color }} aria-hidden />
            <span className="text-muted-foreground">{s.label}</span>
            <span className="ml-auto pl-3 font-semibold tabular-nums">{s.value}</span>
          </p>
        ))}
      </div>
    </div>
  );
}
