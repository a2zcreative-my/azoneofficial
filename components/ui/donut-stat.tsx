"use client";

/* v1.8.0 — DonutStat (UI-REDESIGN-PLAN.md Phase 0).
   The reference dashboard's "Attendance today" ring: a center headline number
   with N status segments and a legend that ALWAYS carries label + count —
   identity is never color-alone (dataviz rule). Pure SVG, no library.

   Palette note (validated with the dataviz six-checks script): amber↔red fail
   CVD separation side by side, so "not clocked in" is the NEUTRAL slate
   segment, not red — semantically right too: absent-so-far is a watch state,
   not an alarm. Segments get a 2px surface gap (stroke ring) per mark spec. */

const TONES = {
  success: "var(--success)",
  warning: "var(--warning)",
  danger: "var(--danger)",
  info: "var(--info)",
  muted: "var(--muted-foreground)",
  gold: "var(--gold-solid)",
  navy: "var(--brand-primary)",
} as const;

export interface DonutSegment {
  label: string;
  value: number;
  tone: keyof typeof TONES;
}

export function DonutStat({ title, centerValue, centerLabel, segments, size = 148 }: {
  title?: string;
  /** The big number in the middle (defaults to the segment total). */
  centerValue?: string | number;
  centerLabel?: string;
  segments: DonutSegment[];
  size?: number;
}) {
  const total = segments.reduce((s, x) => s + Math.max(0, x.value), 0);
  const R = 40; // viewBox units
  const C = 2 * Math.PI * R;
  const thickness = 12;
  let acc = 0;

  return (
    <div className="flex flex-wrap items-center gap-4">
      <div className="relative" style={{ width: size, height: size }}>
        <svg viewBox="0 0 100 100" width={size} height={size} role="img"
          aria-label={`${title ?? "Breakdown"}: ${segments.map((s) => `${s.label} ${s.value}`).join(", ")}`}>
          {/* track */}
          <circle cx="50" cy="50" r={R} fill="none" stroke="var(--secondary)" strokeWidth={thickness} />
          {total > 0 && segments.map((s, i) => {
            const frac = Math.max(0, s.value) / total;
            if (frac === 0) return null;
            const dash = frac * C;
            const offset = C * 0.25 - acc; // start at 12 o'clock, clockwise
            acc += dash;
            return (
              <circle
                key={i}
                cx="50" cy="50" r={R} fill="none"
                stroke={TONES[s.tone]}
                strokeWidth={thickness}
                strokeDasharray={`${Math.max(0, dash - 2)} ${C - Math.max(0, dash - 2)}`}
                strokeDashoffset={offset - 1} /* the 2px surface gap between fills */
                strokeLinecap="butt"
              />
            );
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-semibold tabular-nums">{centerValue ?? total}</span>
          {centerLabel && <span className="text-muted-foreground text-[11px]">{centerLabel}</span>}
        </div>
      </div>
      <div className="min-w-32 flex-1">
        {title && <p className="mb-2 text-sm font-semibold">{title}</p>}
        <ul className="space-y-2">
          {segments.map((s, i) => {
            const pct = total > 0 ? Math.round((Math.max(0, s.value) / total) * 100) : 0;
            return (
              <li key={i} className="text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: TONES[s.tone] }} aria-hidden />
                    <span className="text-muted-foreground">{s.label}</span>
                  </span>
                  <span className="font-medium tabular-nums">
                    {s.value}
                    <span className="text-muted-foreground ml-1.5 text-xs font-normal">{pct}%</span>
                  </span>
                </div>
                {/* v1.8.1 infographic pass: a quiet proportion bar per row —
                    the % as geometry, not only as a number. */}
                <span className="bg-secondary mt-1 block h-1 w-full overflow-hidden rounded-full" aria-hidden>
                  <span className="block h-full rounded-full" style={{ width: `${pct}%`, background: TONES[s.tone] }} />
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
