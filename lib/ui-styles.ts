/**
 * v1.4.254 — the shared look, in one file.
 *
 * These strings were copy-pasted into sixteen files. `card` had drifted into
 * three different paddings — the portal's own page and its panels rendered
 * cards on the SAME tab at different sizes — and nobody would ever have
 * noticed until the whole set sat side by side. That is what a duplicated
 * constant does: it doesn't break, it drifts.
 *
 * Class strings, not components: every consumer is already a plain element
 * with its own props, so swapping a className cannot change behaviour.
 *
 * Row buttons live in components/ui/row-button.tsx (v1.4.253) — this file is
 * for surfaces and form fields.
 */

/** Every card in every app. One padding, everywhere. */
export const card = "rounded-lg border border-border bg-card p-4 md:p-5";

/** Standard form field (v1.4.154 width standard applies to the wrapper). */
export const inputClass =
  "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring";

/** Public-site field — larger type and touch target for the marketing pages,
    where visitors arrive cold on a phone. Deliberately not the same. */
export const inputClassLg =
  "w-full rounded-lg border border-input bg-background px-4 py-2.5 text-base text-foreground outline-none focus:ring-2 focus:ring-ring sm:text-sm";

/** Standard primary button. */
export const btnClass =
  "bg-primary text-primary-foreground hover:bg-primary/85 inline-flex h-9 items-center rounded-lg px-4 text-sm font-medium transition-colors disabled:opacity-50";

/** Full-width variant — sign-in and other single-action forms. */
export const btnClassBlock =
  "bg-primary text-primary-foreground hover:bg-primary/85 inline-flex h-11 w-full items-center justify-center rounded-lg text-sm font-medium transition-colors disabled:opacity-50";

/** A row of labelled fields.
 *
 * v1.4.259: two columns on a phone, a flowing row from `sm` up. A bare
 * `flex gap-2` looks fine on a laptop and quietly ruins the same form on a
 * 390px screen: three fields share ~110px each and every placeholder is
 * clipped mid-word — "e.g. J&T, Po:" — so the hint that tells you what to
 * type is the first thing lost, exactly when you need it most.
 *
 * This is the v1.4.154 width standard with a name. Give any field that needs
 * the full width on a phone `col-span-2 sm:col-span-1`. */
export const fieldRow = "grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-end";

/* Table cells. v1.4.198 alignment standard: text left, numbers right.
   v1.4.253: numeric columns never wrap. */
export const th = "px-3 py-2 text-left text-xs font-semibold tracking-wide uppercase text-muted-foreground";
export const td = "px-3 py-2 text-sm";
export const thR2 = "px-3 py-2 text-right text-xs font-semibold tracking-wide uppercase whitespace-nowrap text-muted-foreground";
export const tdR2 = "px-3 py-2 text-right text-sm tabular-nums whitespace-nowrap";
