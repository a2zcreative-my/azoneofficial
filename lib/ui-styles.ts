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

/** Every card in every app. One padding, everywhere.
    v1.10.0: phones get the reference design's rounder, calmer card
    (rounded-2xl); the desktop kept its v1.8.0 8px look (md:rounded-lg).
    v1.12.0: the desktop steps up to the shell's 16px card radius
    (`rounded-card`), so phone and desktop finally agree and cards sit
    correctly inside the 26px rounded canvas. Changing this ONE string
    restyles every card in the portal, admin and account — which is the
    whole reason it lives here. */
export const card = "rounded-2xl md:rounded-card border border-border bg-card p-4 md:p-5";

/* v1.70.0 — ONE standard content width for the whole portal.
   (CEO: "make the width globally standardize instead of inconsistent")

   The portal shell carried `md:max-w-none`, so every screen was as wide as
   the window. On a laptop that looks fine; on a wide monitor a paragraph in
   one card runs to two hundred characters while the card beside it holds a
   table pinned to 760px, and nothing on the page shares a measure.

   1600px is chosen from the widest thing the portal actually draws — the
   seven-column roster grid and the payroll tables — plus room to breathe.
   Anything narrower would make those scroll on a screen with space to spare.

   Use this on the OUTER container of a screen, never on a card: cards are
   meant to fill their column, and capping them individually is how the
   inconsistency started. */
/* v1.74.0 (CEO: "I want it full fit to the website width... just make it
   fit only") — the cap is gone, the RULE is not.

   1600px was chosen for line length, and on a 1920 monitor it left a band of
   page background down both sides that reads as a window that failed to
   maximise. The portal is a dense work surface, not an article: the roster,
   the payroll table and the attendance list all want every pixel, and the
   person using it is looking at data, not reading prose.

   What this still is: ONE width for every screen, set in ONE place, applied
   to the OUTER container and never to a card. Change this line and every
   screen changes together — which was the whole point of it existing. */
export const PORTAL_WIDTH = "mx-auto w-full max-w-none";

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

/* ===================== v1.5.0 — global style consolidation =====================
   These strings existed as copy-pasted literals across the portal, admin and
   account pages (btnGhost alone was pasted into four files with two different
   paddings). One definition each, everywhere. */

/** Secondary (outline) button — was duplicated in 4 files. */
export const btnGhost =
  "inline-flex h-9 items-center rounded-lg border border-border px-4 text-sm font-medium transition-colors hover:bg-secondary";

/** Compact header control (phones share one row).
    v1.10.0: phones get the reference design's soft rounded square (h-9,
    rounded-xl); desktop keeps its previous look. */
export const btnHdr =
  "inline-flex h-9 min-w-9 items-center justify-center rounded-xl border border-border px-2 text-sm font-medium transition-colors hover:bg-secondary md:rounded-lg md:px-2.5";

/** Header control that exists ONLY from `md` up (sound, push, theme, EN/BM).
 *
 * v1.15.0 — this token exists because `${btnHdr} hidden md:inline-flex` DOES
 * NOT WORK: btnHdr already carries a bare `inline-flex`, and when one element
 * holds two unprefixed display utilities the stylesheet's order decides — in
 * this Tailwind build `.inline-flex` is emitted AFTER `.hidden`, so the
 * button stayed visible on every phone. That is why the v1.10.0 "calm mobile
 * header" was never actually calm in production: all four set-once switches
 * kept rendering at 390px and squeezed the screen title to zero width. The
 * fix is the standard Tailwind pattern — `hidden` as the ONLY base display
 * class, the visible display arriving with the `md:` variant. */
export const btnHdrDesktop =
  "hidden h-9 min-w-9 items-center justify-center rounded-xl border border-border px-2 text-sm font-medium transition-colors hover:bg-secondary md:inline-flex md:rounded-lg md:px-2.5";

/** Small buttons for table rows and dense cards. */
export const btnSm =
  "border-border inline-flex h-8 items-center rounded-lg border px-3 text-xs font-medium hover:bg-secondary";
export const btnSmPrimary =
  "bg-primary text-primary-foreground inline-flex h-8 items-center rounded-lg px-3 text-xs font-medium disabled:opacity-50";

/** Field labels — the two spellings that existed are now named. */
export const fieldLabel = "text-muted-foreground mb-0.5 block text-[11px] font-medium";
export const fieldLabelSm = "text-muted-foreground mb-1 block text-xs";

/** Compact inputs (the ad-hoc `border-input bg-background px-2 py-1 …` family). */
export const inputClassSm =
  "rounded-lg border border-input bg-background px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-ring";

/** Card-header row: title left, actions right, wraps politely on phones. */
export const rowHead = "flex flex-wrap items-center justify-between gap-2";

/** Bordered list row (the 5× duplicated `border-b py-2 last:border-0` row). */
export const listRow =
  "border-border flex flex-wrap items-center justify-between gap-2 border-b py-2 text-sm last:border-0";

/** Status chips — semantic tokens instead of the six hand-mixed palettes. */
export const chip = "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium";
export const chipNeutral = `${chip} bg-secondary`;
export const chipSuccess = `${chip} bg-success-soft text-success`;
export const chipWarn = `${chip} bg-warning-soft text-warning`;
export const chipDanger = `${chip} bg-danger-soft text-danger`;
export const chipInfo = `${chip} bg-info-soft text-info`;

/** Dashboard tile styling. */
export const tile = card;
