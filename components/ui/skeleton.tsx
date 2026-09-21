/* v1.25.0 — the skeleton kit (CEO: "I want to have a dead skeleton waiting
   for my website like a Threads so that my staff wont see any loading").
 *
 * Rules that make skeletons help instead of annoy:
 *   1. SHAPE-MATCHED — a skeleton must occupy the same space as the real
 *      thing, or the page jumps when data lands (worse than a spinner).
 *   2. NO minimum display time — the instant data exists, real content wins.
 *   3. Pure CSS shimmer (.skel in globals.css), so the first-paint shell
 *      renders with zero JavaScript and freezes under reduced-motion.
 *
 * These are plain presentational pieces: no state, no effects, safe to
 * render during the static prerender that becomes portal.html.
 *
 * v1.172.2 (Tailwind retired): a block is sized by `w` / `h` (px numbers or
 * any CSS length) and rounded by `round`; the compositions live in
 * skeleton.module.css. `className` stays for the legacy callers that still
 * pass utility sizes - those strings are frozen in legacy-utilities.css and
 * shrink as the callers migrate.
 */

import type { CSSProperties } from "react";
import { card } from "@/lib/ui-styles";
import { getLang } from "@/lib/i18n";
import s from "./skeleton.module.css";

const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);

type Len = number | string;
const len = (v: Len | undefined) => (typeof v === "number" ? `${v}px` : v);

/** One shimmering block. Size it with `w` / `h`; `round` picks the corner. */
export function Skel({ className = "", w, h, round, style }: {
  className?: string;
  w?: Len;
  h?: Len;
  /** "lg" (the card radius, default), "full" (a pill or circle), "none" */
  round?: "lg" | "full" | "none";
  style?: CSSProperties;
}) {
  // Default corner radius, unless the caller picked one (a `round` prop, or
  // a legacy rounded-* utility in className).
  const legacyRadius = /(^|\s)rounded(-|$|\s)/.test(className);
  const radius = round === "full" ? "9999px" : round === "none" ? "0" : legacyRadius ? undefined : "var(--radius)";
  return <div className={`skel ${className}`} style={{ width: len(w), height: len(h), borderRadius: radius, ...style }} aria-hidden />;
}

/** A run of text lines; the last line is short, like real prose. */
export function SkelText({ lines = 2, className = "" }: { lines?: number; className?: string }) {
  return (
    <div className={`${s.lines} ${className}`} aria-hidden>
      {Array.from({ length: lines }, (_, i) => (
        <Skel key={i} h={12} w={i === lines - 1 ? "50%" : "100%"} />
      ))}
    </div>
  );
}

/** Card heading + subtitle — every AZ ONE card starts with these two. */
export function SkelHead({ sub = true }: { sub?: boolean }) {
  return (
    <div className={s.stack2} aria-hidden>
      <Skel h={16} w={160} />
      {sub && <Skel h={12} w={224} style={{ maxWidth: "100%" }} />}
    </div>
  );
}

/** A whole card: heading, optional subtitle, body lines. */
export function SkelCard({ lines = 3, sub = true, className = "" }: { lines?: number; sub?: boolean; className?: string }) {
  return (
    <div className={`${card} ${className}`} aria-hidden>
      <SkelHead sub={sub} />
      <SkelText lines={lines} className="erp-mt-3" />
    </div>
  );
}

/** Stat tile — label over a big number (the ticker row). */
export function SkelStat({ className = "" }: { className?: string }) {
  return (
    <div className={`${card} ${className}`} aria-hidden>
      <Skel h={10} w={96} />
      <Skel className="erp-mt-2" h={28} w={128} />
      <Skel className="erp-mt-2" h={8} w="100%" />
    </div>
  );
}

/** Agenda / list rows: fixed left column, flexible middle, right chip. */
export function SkelRows({ rows = 4, className = "" }: { rows?: number; className?: string }) {
  return (
    <div className={className} aria-hidden>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className={s.row}>
          <Skel className="erp-fixed" h={32} w={52} />
          <div className={s.rowMid}>
            <Skel h={14} w="66.666667%" />
            <Skel h={10} w="33.333333%" />
          </div>
          <Skel className="erp-fixed" h={20} w={64} round="full" />
        </div>
      ))}
    </div>
  );
}

/** Table body placeholder — matches a header + N rows. */
export function SkelTable({ rows = 5, cols = 4, className = "" }: { rows?: number; cols?: number; className?: string }) {
  return (
    <div className={`${s.stack2} ${className}`} aria-hidden>
      <div className={s.cells}>
        {Array.from({ length: cols }, (_, i) => <Skel key={i} className={s.cell} h={10} />)}
      </div>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className={s.cells}>
          {Array.from({ length: cols }, (_, i) => <Skel key={i} className={s.cell} h={16} />)}
        </div>
      ))}
    </div>
  );
}

/** Donut / ring card (attendance today). */
export function SkelDonut() {
  return (
    <div className={card} aria-hidden>
      <Skel h={16} w={144} />
      <div className={s.donut}>
        <Skel className="erp-fixed" h={112} w={112} round="full" />
        <div className={s.donutLines}>
          <Skel h={12} w="100%" />
          <Skel h={12} w="100%" />
          <Skel h={12} w="66.666667%" />
        </div>
      </div>
    </div>
  );
}

/** Bar-chart block (sales by month). Heights vary so it reads as a chart. */
const BAR_H = [32, 56, 40, 64, 48, 80, 44, 64];
export function SkelChart({ bars = 6 }: { bars?: number }) {
  return (
    <div className={card} aria-hidden>
      <SkelHead />
      <div className={s.bars}>
        {Array.from({ length: bars }, (_, i) => (
          <Skel key={i} className={s.bar} h={BAR_H[i % BAR_H.length]} />
        ))}
      </div>
    </div>
  );
}

/* v1.25.0 — the "updating…" hint. Per the CEO's choice, cards that show
   MONEY render their remembered figures instantly but say so until the
   fresh numbers land, so nobody acts on a stale amount. */
export function StaleHint({ show, className = "" }: { show: boolean; className?: string }) {
  if (!show) return null;
  return (
    <span className={`${s.stale} ${className}`}>
      <span className={s.staleDot} aria-hidden />
      {L("updating…", "mengemas kini…")}
    </span>
  );
}
