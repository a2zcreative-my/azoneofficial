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
 *
 * v1.88.0 — A TILE CAN BE OPENED. CEO, 03-09-2026: *"ensure that all the tabs
 * have a function of clickable data without me need to open another new
 * tabs."* This component had no `onClick` AT ALL, which made every one of its
 * twenty-two call sites a dead end by construction: a figure you can read and
 * cannot follow. `stat-card.tsx` has taken an `onClick` since v1.13.0, so the
 * two halves of the same idea disagreed about whether a number is a door.
 *
 * A tile WITHOUT `onClick` still renders exactly as it did — a div, no
 * hover, no focus ring, nothing to promise an action that is not there. The
 * button only appears when something is behind it, because a tile that looks
 * clickable and does nothing is worse than one that never offered.
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
  label, value, tone = "brand", icon, hint, onClick, title, active,
}: {
  label: string;
  value: ReactNode;
  tone?: StatTone;
  /** Watermark glyph, right-aligned and dimmed. Decorative only. */
  icon?: ReactNode;
  /** Optional small line under the label. */
  hint?: string;
  /** v1.88.0 — what this figure opens. Omit and the tile stays a plain div. */
  onClick?: () => void;
  /** Why it is worth pressing — the figure alone rarely says. */
  title?: string;
  /** This tile's filter is the one currently applied. */
  active?: boolean;
}) {
  const body = (
    <>
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
    </>
  );
  const shell = `rounded-card relative overflow-hidden p-4 ${TONE[tone]}`;
  if (!onClick) return <div className={shell}>{body}</div>;
  return (
    <button
      type="button"
      className={`${shell} w-full cursor-pointer text-left transition hover:brightness-110 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none ${active ? "ring-2 ring-offset-2" : ""}`}
      aria-pressed={active}
      title={title}
      onClick={onClick}
    >
      {body}
      {active ? (
        <span aria-hidden className="absolute top-2 right-3 text-[13px] font-bold opacity-80">✕</span>
      ) : null}
    </button>
  );
}

/** The four-across strip the reference uses at the top of every module page. */
export function StatStrip({ children }: { children: ReactNode }) {
  return <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">{children}</div>;
}
