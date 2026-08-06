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

/** Neutral action — Edit, Print, Revert, Send PDF. */
export const rowBtn =
  "border-border inline-flex h-7 items-center rounded-lg border px-2.5 text-xs whitespace-nowrap hover:bg-secondary";

/** Destructive — Delete, Remove. Bordered, never filled: a red block on every
    row reads as an alarm, and most rows have one. */
export const rowBtnDanger =
  "inline-flex h-7 items-center rounded-lg border border-red-200 px-2.5 text-xs whitespace-nowrap text-red-600 hover:bg-red-50";

/** The one action a row is FOR — → Invoice, Mark paid, Approve. At most one
    per row; two filled buttons and neither reads as the main one. */
export const rowBtnPrimary =
  "bg-primary text-primary-foreground inline-flex h-7 items-center rounded-lg px-2.5 text-xs font-medium whitespace-nowrap hover:opacity-90";

/** Positive but not primary — Mark paid on an expense, Credit a return. */
export const rowBtnGood =
  "inline-flex h-7 items-center rounded-lg border border-green-700 px-2.5 text-xs font-medium whitespace-nowrap text-green-700 hover:bg-green-50";

/* NOT for inline form controls. A "Cancel" beside a Save, a "+ Add line"
   inside a form, a "Refresh" in a card header — those are text links on
   purpose. Boxing every one of them in a bordered pill adds weight to forms
   that are already dense, and makes the row actions stop standing out. The
   rule: it gets a button if it acts on a RECORD, a link if it acts on the
   FORM you are filling in. */

/** The wrapper every row's action group uses (v1.4.247: it must wrap). */
export const rowActions = "flex flex-wrap items-center justify-end gap-1.5";
