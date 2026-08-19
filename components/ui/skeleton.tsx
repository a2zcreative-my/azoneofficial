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
 */

import { card } from "@/lib/ui-styles";
import { getLang } from "@/lib/i18n";

const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);

/** One shimmering block. `w`/`h` are Tailwind classes. */
export function Skel({ className = "" }: { className?: string }) {
  // Default corner radius, unless the caller picked one (rounded-full, etc.).
  const radius = /(^|\s)rounded(-|$|\s)/.test(className) ? "" : "rounded-lg";
  return <div className={`skel ${radius} ${className}`} aria-hidden />;
}

/** A run of text lines; the last line is short, like real prose. */
export function SkelText({ lines = 2, className = "" }: { lines?: number; className?: string }) {
  return (
    <div className={`space-y-1.5 ${className}`} aria-hidden>
      {Array.from({ length: lines }, (_, i) => (
        <Skel key={i} className={`h-3 ${i === lines - 1 ? "w-1/2" : "w-full"}`} />
      ))}
    </div>
  );
}

/** Card heading + subtitle — every AZ ONE card starts with these two. */
export function SkelHead({ sub = true }: { sub?: boolean }) {
  return (
    <div className="space-y-2" aria-hidden>
      <Skel className="h-4 w-40" />
      {sub && <Skel className="h-3 w-56 max-w-full" />}
    </div>
  );
}

/** A whole card: heading, optional subtitle, body lines. */
export function SkelCard({ lines = 3, sub = true, className = "" }: { lines?: number; sub?: boolean; className?: string }) {
  return (
    <div className={`${card} ${className}`} aria-hidden>
      <SkelHead sub={sub} />
      <SkelText lines={lines} className="mt-3" />
    </div>
  );
}

/** Stat tile — label over a big number (the ticker row). */
export function SkelStat({ className = "" }: { className?: string }) {
  return (
    <div className={`${card} ${className}`} aria-hidden>
      <Skel className="h-2.5 w-24" />
      <Skel className="mt-2 h-7 w-32" />
      <Skel className="mt-2 h-2 w-full" />
    </div>
  );
}

/** Agenda / list rows: fixed left column, flexible middle, right chip. */
export function SkelRows({ rows = 4, className = "" }: { rows?: number; className?: string }) {
  return (
    <div className={className} aria-hidden>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="border-border flex items-center gap-2.5 border-b py-2.5 last:border-0">
          <Skel className="h-8 w-[52px] shrink-0" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <Skel className="h-3.5 w-2/3" />
            <Skel className="h-2.5 w-1/3" />
          </div>
          <Skel className="h-5 w-16 shrink-0 rounded-full" />
        </div>
      ))}
    </div>
  );
}

/** Table body placeholder — matches a header + N rows. */
export function SkelTable({ rows = 5, cols = 4, className = "" }: { rows?: number; cols?: number; className?: string }) {
  return (
    <div className={`space-y-2 ${className}`} aria-hidden>
      <div className="flex gap-3">
        {Array.from({ length: cols }, (_, i) => <Skel key={i} className="h-2.5 flex-1" />)}
      </div>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex gap-3">
          {Array.from({ length: cols }, (_, i) => <Skel key={i} className="h-4 flex-1" />)}
        </div>
      ))}
    </div>
  );
}

/** Donut / ring card (attendance today). */
export function SkelDonut() {
  return (
    <div className={card} aria-hidden>
      <Skel className="h-4 w-36" />
      <div className="mt-3 flex items-center gap-4">
        <Skel className="h-28 w-28 shrink-0 rounded-full" />
        <div className="min-w-0 flex-1 space-y-2">
          <Skel className="h-3 w-full" />
          <Skel className="h-3 w-full" />
          <Skel className="h-3 w-2/3" />
        </div>
      </div>
    </div>
  );
}

/** Bar-chart block (sales by month). Heights vary so it reads as a chart. */
const BAR_H = ["h-8", "h-14", "h-10", "h-16", "h-12", "h-20", "h-11", "h-16"];
export function SkelChart({ bars = 6 }: { bars?: number }) {
  return (
    <div className={card} aria-hidden>
      <SkelHead />
      <div className="mt-3 flex h-20 items-end gap-1.5">
        {Array.from({ length: bars }, (_, i) => (
          <Skel key={i} className={`flex-1 ${BAR_H[i % BAR_H.length]}`} />
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
    <span className={`text-muted-foreground/70 inline-flex items-center gap-1 text-[10px] font-medium ${className}`}>
      <span className="bg-gold-solid inline-block h-1.5 w-1.5 animate-pulse rounded-full" aria-hidden />
      {L("updating…", "mengemas kini…")}
    </span>
  );
}
