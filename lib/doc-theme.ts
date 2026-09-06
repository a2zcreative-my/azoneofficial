/**
 * v1.124.0 — THE PAPER PALETTE. One owner for the brand colours that appear
 * on a document.
 *
 * Why this is separate from the app's semantic tokens (styles/globals.css):
 * the app's tokens follow the viewer's theme, and paper does not. An invoice,
 * a claim form, a payslip summary and a client report are DOCUMENTS: they are
 * printed, saved as PDF, and opened by customers on phones we do not control.
 * A customer whose phone is in dark mode must still receive a white invoice
 * with navy ink, or the PDF they save is not the document we sent. So these
 * values are deliberately fixed, deliberately light-only, and deliberately
 * NOT `var(--foreground)`.
 *
 * Why a module at all: before this the same navy was spelled `#1a2946` in six
 * files and `#1A2946` in four more, the gold `#C9A227` in eight and `#c9a227`
 * in one, with the rule-line `#e8ebf1` copied into both. Nothing was wrong on
 * screen — every copy happened to agree — but nothing MADE them agree, so the
 * next document to be added would have picked whichever spelling was nearest.
 *
 * Two consumers, two spellings of the same palette:
 *   - JS/TS  — the print builders write standalone HTML documents into a new
 *              window or an iframe. That document has no access to the app's
 *              stylesheet, so it needs literal hex: `${DOC.navy}`.
 *   - CSS    — /doc and /report are React pages that render paper INSIDE the
 *              app, so their classes read `--doc-*` from styles/globals.css.
 *              Those variables are declared once on :root and are never
 *              redefined by a theme block, which is what makes them paper.
 *
 * tests/doc-theme.mjs asserts the two spellings agree value for value, so the
 * pair cannot drift the way the ten hand-copies did.
 */
export const DOC = {
  /** Brand navy — body ink, table headers, rules, the solid stat tile. */
  navy: "#1a2946",
  /** Brand gold — the letterhead rule and the eyebrow line. */
  gold: "#c9a227",
  /** The light stop in the gold bar's gradient. */
  goldLight: "#e8cb6b",
  /** Hairline between rows and around the page card. */
  line: "#e8ebf1",
  /** Faint fill behind the addressee block. */
  tint: "#f6f7fa",
  /** Secondary ink — labels, the "prepared by" line. */
  inkSoft: "#5b6472",
  /** Tertiary ink — the footer and generated-on stamp. */
  muted: "#8a93a6",
  /** The desk the page card sits on, on /doc. */
  page: "#f4f6fb",
} as const;

export type DocColour = keyof typeof DOC;
