/**
 * THE BREAKPOINTS — one canonical definition. P0.2, 22 September 2026.
 *
 * The audit found fifteen distinct width queries across the stylesheets, in
 * TWO syntaxes for the same widths (`min-width: 768px` hand-written and
 * `width >= 48rem` compiled into the frozen legacy sheet), orphans at 900px
 * and 400px, and `matchMedia` literals re-typed in `app/portal/page.tsx` with
 * nothing keeping them in step with the CSS. The shell is effectively binary:
 * phone, or 768px-and-up. Nothing in the codebase responds to width above
 * 1024px at all, so a 1440px window and a 2560px window render identically.
 *
 * This module is the source of truth. `styles/globals.css` states the same
 * four numbers as `--bp-*` custom properties, and `tests/interface-v3.mjs`
 * fails the build if the two disagree or if a V2 stylesheet invents a width
 * outside the scale. Custom properties cannot be used inside `@media`, so the
 * numbers are necessarily written twice — the guard is what makes that safe.
 *
 * A BREAKPOINT IS A CHANGE OF SHAPE, NOT A NUMBER. Each tier below says what
 * the interface becomes, because a scale nobody can describe gets a fifth
 * value added to it within a month.
 */

/** The five tiers. Add one only when the interface genuinely changes shape. */
export const BP = {
  /** ≥640 — LARGE PHONE. Still the phone shell — bottom bar, one column —
      but wide enough to put two things side by side: tiles go three across,
      a row's actions align right instead of wrapping under its words. Found
      in 16 places across the sheet and the modules with exactly that
      meaning, so it is a real tier and naming it beats pretending it away. */
  sm: 640,
  /** ≥768 — TABLET. The shell stops being a phone: the side rail replaces the
      bottom bar, a drawer replaces the bottom sheet, zones may go two-up. */
  md: 768,
  /** ≥1024 — DESKTOP. Tables rather than record cards, module toolbars,
      three-up zones, the topbar stops wrapping. */
  lg: 1024,
  /** ≥1280 — LARGE DESKTOP. The tier that does not exist yet and is P1's
      main prize: context panel, right rail, master-detail instead of a
      covering drawer, and a content measure so a form stops spanning a
      monitor. */
  xl: 1280,
  /** ≥1600 — WIDE. Not a new layout: the same large-desktop shape with wider
      gutters and the full workspace measure for roster and payroll. */
  xxl: 1600,
} as const;

export type Breakpoint = keyof typeof BP;

/** Below `md` — phone: bottom navigation, one column, sheets, record cards. */
export const MOBILE_MAX = BP.md - 1;

/** `matchMedia` text for a tier, so no component re-types a number. */
export const up = (bp: Breakpoint): string => `(min-width: ${BP[bp]}px)`;
/** Only below a tier. Used for the phone-only rules; prefer `up()` otherwise. */
export const below = (bp: Breakpoint): string => `(max-width: ${BP[bp] - 1}px)`;

/**
 * Does the viewport meet this tier right now? SSR-safe: a static export
 * renders on a server with no window, and the honest answer there is "assume
 * the phone", because that is the layout that fits everywhere.
 */
export function atLeast(bp: Breakpoint): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia(up(bp)).matches;
}

/** Subscribe to a tier. Returns an unsubscribe. */
export function onBreakpoint(bp: Breakpoint, cb: (matches: boolean) => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const mq = window.matchMedia(up(bp));
  const handler = (e: MediaQueryListEvent) => cb(e.matches);
  mq.addEventListener("change", handler);
  return () => mq.removeEventListener("change", handler);
}
