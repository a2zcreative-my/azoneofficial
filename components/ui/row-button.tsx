"use client";

/**
 * v1.4.253 — the row button, in one place.
 *
 * The Documents list settled on a shape months ago — 28px tall, rounded,
 * bordered, 12px text — but the audit and claim lists were still using bare
 * underlined links, so the same action looked like two different controls
 * depending on which card you were in. Worse on a phone: an underlined word
 * has no tap target, and 44px is the minimum a thumb reliably hits.
 *
 * These are class strings rather than a component on purpose: every row
 * button in the portal is already a plain <button> with its own handler, and
 * swapping a className is a change that can't alter behaviour.
 *
 * Keep it minimalist — these sit five-to-a-row on a 390px screen. No shadows,
 * no fills except on the primary, and always paired with `rowActions` so the
 * group wraps instead of running off the edge (v1.4.247).
 */

/* v1.138.0 — A DISABLED ROW BUTTON HAS TO LOOK DISABLED.
 *
 * The CEO, 08-09-2026, on the Overtime rows: *"when I clicked save there is
 * no popup box appear as per globally style."* He was right that nothing
 * happened, and the reason was that the button was DISABLED — and not one of
 * the four tokens below carried a `disabled:` class, so a dead button was
 * pixel-identical to a live one. Across the portal that is twenty-odd
 * buttons that can look pressable while doing nothing, which is exactly the
 * uncertainty guard #25 exists to remove.
 *
 * `disabled:opacity-50` is the same weight `btnClass` has always used, so the
 * two button families finally agree. `pointer-events-none` stops the hover
 * fill from firing on a control that will not act — a button that lights up
 * under the cursor and then ignores the click is worse than one that does
 * not react at all.
 *
 * A disabled button still owes an explanation. Where the reason is not
 * obvious from the row, prefer LEAVING IT ENABLED and answering with the
 * house toast ("No changes"), which is what the Overtime Save does now. */
const OFF = "disabled:pointer-events-none disabled:opacity-50";

/** Neutral action — Edit, Print, Revert, Send PDF. */
export const rowBtn =
  `border-border inline-flex h-7 items-center rounded-lg border px-2.5 text-xs whitespace-nowrap hover:bg-secondary ${OFF}`;

/** Destructive — Delete, Remove. Bordered, never filled: a red block on every
    row reads as an alarm, and most rows have one. */
export const rowBtnDanger =
  `inline-flex h-7 items-center rounded-lg border border-danger/30 px-2.5 text-xs whitespace-nowrap text-danger hover:bg-danger-soft ${OFF}`;

/** The one action a row is FOR — → Invoice, Mark paid, Approve. At most one
    per row; two filled buttons and neither reads as the main one. */
export const rowBtnPrimary =
  `bg-primary text-primary-foreground inline-flex h-7 items-center rounded-lg px-2.5 text-xs font-medium whitespace-nowrap hover:opacity-90 ${OFF}`;

/** Positive but not primary — Mark paid on an expense, Credit a return. */
export const rowBtnGood =
  `inline-flex h-7 items-center rounded-lg border border-success/30 px-2.5 text-xs font-medium whitespace-nowrap text-success hover:bg-success-soft ${OFF}`;

/* NOT for inline form controls. A "Cancel" beside a Save, a "+ Add line"
   inside a form, a "Refresh" in a card header — those are text links on
   purpose. Boxing every one of them in a bordered pill adds weight to forms
   that are already dense, and makes the row actions stop standing out. The
   rule: it gets a button if it acts on a RECORD, a link if it acts on the
   FORM you are filling in. */

/** The wrapper every row's action group uses (v1.4.247: it must wrap).
 *
 * v1.4.258: left-aligned on phones, right-aligned from `sm` up. Right-aligning
 * a group that has WRAPPED onto its own line strands the last button alone
 * against the right edge — the row reads as two ragged fragments instead of
 * one block. On a phone the buttons sit under the text, so they should start
 * where the text starts; on a desktop they still sit opposite it. */
export const rowActions = "flex flex-wrap items-center justify-start gap-1.5 sm:justify-end";
