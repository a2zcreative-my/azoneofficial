"use client";

/* v1.13.0 — the solid-colour KPI tile from the CEO's DZI reference.
 *
 * A block of flat brand colour, an oversized number, a label under it and a
 * watermark glyph on the right. Deliberately NOT the soft white card in
 * `stat-card.tsx` — that one stays for dense in-page summaries; this one is
 * for the four-across strip at the top of a module page.
 *
 * CONTRAST IS BAKED IN, not left to the caller. Each tone is a dedicated
 * `--tile-*` fill paired with its own `--tile-*-fg`, all verified >= 4.5:1 in
 * BOTH themes. Two traps this avoids:
 *   1. White on the brand gold `#c9a227` is ~2:1 — the gold tone uses navy ink.
 *   2. Reusing `--success` / `--danger` / `--info` as fills breaks in dark
 *      mode, where those tokens flip to LIGHT values (#4ade80, #f87171,
 *      #38bdf8) because they are text-grade. White on them measures ~1.7:1.
 * A caller cannot pick a failing combination because a caller cannot set the
 * foreground at all.
 */

import type { ReactNode } from "react";

export type StatTone = "brand" | "success" | "gold" | "danger" | "info" | "muted";

const TONE: Record<StatTone, string> = {
  brand: "bg-tile-brand text-tile-brand-fg",
  success: "bg-tile-success text-tile-success-fg",
  gold: "bg-tile-gold text-tile-gold-fg",
  danger: "bg-tile-danger text-tile-danger-fg",
  info: "bg-tile-info text-tile-info-fg",
  muted: "bg-tile-muted text-tile-muted-fg",
};

export function StatTile({
  label, value, tone = "brand", icon, hint,
}: {
  label: string;
  value: ReactNode;
  tone?: StatTone;
  /** Watermark glyph, right-aligned and dimmed. Decorative only. */
  icon?: ReactNode;
  /** Optional small line under the label. */
  hint?: string;
}) {
  return (
    <div className={`rounded-card relative overflow-hidden p-4 ${TONE[tone]}`}>
      <div className="relative z-10">
        <p className="text-[26px] leading-none font-bold tracking-tight tabular-nums">{value}</p>
        <p className="mt-2 text-[13px] font-medium opacity-95">{label}</p>
        {hint ? <p className="mt-0.5 text-[11px] opacity-75">{hint}</p> : null}
      </div>
      {icon ? (
        <span aria-hidden className="pointer-events-none absolute right-3 bottom-2 text-[44px] leading-none opacity-25 select-none">
          {icon}
        </span>
      ) : null}
    </div>
  );
}

/** The four-across strip the reference uses at the top of every module page. */
export function StatStrip({ children }: { children: ReactNode }) {
  return <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">{children}</div>;
}
