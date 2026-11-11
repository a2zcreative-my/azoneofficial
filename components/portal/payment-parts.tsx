"use client";

/* v1.282.0 - SALES PAYMENT VERIFICATION 3.0 (the CEO, 11-11-2026: "Proceed"
   on claude/PAYMENT-VERIFICATION-3.0-BLUEPRINT.md, every decision as
   recommended). The small parts every payment surface shares, so Payments,
   the Sales documents list and the Overview's Needs action say the same
   words and offer the same one action:

     settlementOf  the INVOICE's money: Unpaid, Partially paid, Paid - from
                   verified money only (invoice_payments), never chosen
     reviewOf      the REPORT's review: Awaiting independent evidence review
                   (the CEO's own report, before the COO's check), Pending
                   CEO verification, Clarification required, Verified,
                   Rejected, Reversed - kept apart from settlement (D3)
     actionFor     the invoice's one main button: Report payment, Report
                   remaining payment, View pending payment or Review payment
                   (D1: a fully pending invoice never offers a second report
                   as its main action)
     AmountSummary the four figures; pending is never taken off outstanding
     ReceiptPreview the proof through its own authorized URL, never cached
     PaymentCard   one invoice or payment as a row on a desktop and a card
                   on a phone - one DOM, no sideways scroll

   Nothing here decides anything: every rule is the server's
   (worker/src/payment-verify.ts), and the screen only words it. */

import { useEffect, useState, type ReactNode } from "react";
import { fmtRM } from "@/lib/format";
import { getLang } from "@/lib/i18n";
import { statusOf } from "@/components/ui/status-chip";
import { openAttachment } from "@/components/ui/document-preview";
import { AppIcon } from "@/components/ui/app-icon";
import { Skel } from "@/components/ui/skeleton";
import { chipSmDanger, chipSmInfo, chipSmNeutral, chipSmSuccess, chipSmWarn } from "@/lib/ui-styles";
import css from "./payments-panel.module.css";

const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);

export const PENDING_STATES = ["reported", "evidence_checked", "clarify"] as const;
export const isPendingState = (s: string) => (PENDING_STATES as readonly string[]).includes(s);

const TONE: Record<string, string> = { success: chipSmSuccess, warning: chipSmWarn, danger: chipSmDanger, info: chipSmInfo, neutral: chipSmNeutral };

export type Settlement = "unpaid" | "partial" | "paid" | "void";
/** The invoice's money, from verified payments only. */
export function settlementOf(total: number, verified: number, paidFlag = false, voided = false): Settlement {
  if (voided) return "void";
  if (paidFlag || (total > 0 && verified >= total)) return "paid";
  return verified > 0 ? "partial" : "unpaid";
}

export type Review = "awaiting_independent" | "pending_ceo" | "clarify" | "verified" | "rejected" | "reversed";
/** The report's review. A report by someone who can verify (the CEO) waits
    for another person's evidence check first - the server's P3 rule. */
export function reviewOf(r: { state: string; needs_evidence?: boolean }): Review {
  if (r.state === "reported") return r.needs_evidence ? "awaiting_independent" : "pending_ceo";
  if (r.state === "evidence_checked") return "pending_ceo";
  if (r.state === "clarify") return "clarify";
  if (r.state === "verified" || r.state === "rejected" || r.state === "reversed") return r.state;
  return "pending_ceo";
}

export function SettlementChip({ s, testId }: { s: Settlement; testId?: string }) {
  const { tone, label } = statusOf("settlement", s);
  return <span className={`${TONE[tone]} ${css.chip}`} data-testid={testId}>{label}</span>;
}
export function ReviewChip({ r, testId }: { r: Review; testId?: string }) {
  const { tone, label } = statusOf("review", r);
  return <span className={`${TONE[tone]} ${css.chip}`} data-testid={testId}>{r === "awaiting_independent" || r === "pending_ceo" ? <AppIcon name="time" /> : null}{label}</span>;
}

export type MainAction = { kind: "report" | "report_remaining" | "view_pending" | "review" | "none"; label: string };
/** The invoice's one main button (brief section 7). `reviewable` = a pending
    report on it is one THIS person may decide or check now. */
export function actionFor(i: { total_cents: number; verified_cents: number; pending_cents: number; can_report: boolean }, reviewable = false): MainAction {
  const outstanding = Math.max(0, i.total_cents - i.verified_cents);
  if (outstanding === 0) return { kind: "none", label: "" };
  if (i.pending_cents > 0 && reviewable) return { kind: "review", label: L("Review payment", "Semak bayaran") };
  if (i.pending_cents >= outstanding) return { kind: "view_pending", label: L("View pending payment", "Lihat bayaran tertunda") };
  if (i.can_report) {
    return i.verified_cents > 0 || i.pending_cents > 0
      ? { kind: "report_remaining", label: L("Report remaining payment", "Lapor baki bayaran") }
      : { kind: "report", label: L("Report payment", "Lapor bayaran") };
  }
  return i.pending_cents > 0 ? { kind: "view_pending", label: L("View pending payment", "Lihat bayaran tertunda") } : { kind: "none", label: "" };
}

/** The invoice's one action as a button - the Sales documents list's row (v1.282.0). */
export function InvoicePayAction({ inv, className, onReport, onView }: { inv: Parameters<typeof actionFor>[0]; className: string; onReport: () => void; onView: () => void }) {
  const a = actionFor(inv);
  if (a.kind === "none") return null;
  const report = a.kind === "report" || a.kind === "report_remaining";
  return (
    <button type="button" className={className} data-testid="pv-record" data-kind={a.kind} onClick={report ? onReport : onView}
      title={report ? L("Payments are verified by the CEO: report this payment with its proof", "Bayaran disahkan oleh CEO: lapor bayaran ini dengan buktinya") : undefined}>
      {a.label}
    </button>
  );
}

/** The four figures. Pending is shown beside verified money and never taken off it (brief section 6). */
export function AmountSummary({ total, verified, pending, paid }: { total: number; verified: number; pending: number; paid?: boolean }) {
  const outstanding = paid ? 0 : Math.max(0, total - verified);
  return (
    <dl className={css.amounts} data-testid="payment-money">
      <div><dt>{L("Invoice total", "Jumlah invois")}</dt><dd>{fmtRM(total)}</dd></div>
      <div><dt>{L("Verified", "Disahkan")}</dt><dd>{fmtRM(verified)}</dd></div>
      <div><dt>{L("Pending", "Tertunda")}</dt><dd>{fmtRM(pending)}</dd></div>
      <div className={css.amountsKey}><dt>{L("Verified outstanding", "Baki disahkan")}</dt><dd data-testid="payment-outstanding">{fmtRM(outstanding)}</dd></div>
    </dl>
  );
}

/** The proof, read through its own authorized URL: an image shows as a thumbnail, a PDF as a file. */
export function ReceiptPreview({ reportId }: { reportId: number }) {
  const url = `/api/v1/staff/payment-reports/${reportId}/proof`;
  const [thumb, setThumb] = useState<{ src: string | null; kind: "image" | "pdf" | "file" } | null>(null);
  useEffect(() => {
    let live = true, made: string | null = null;
    void fetch(url, { credentials: "same-origin", cache: "no-store" }).then(async (r) => {
      if (!r.ok) { if (live) setThumb({ src: null, kind: "file" }); return; }
      const type = r.headers.get("content-type") ?? "";
      if (type.startsWith("image/")) { made = URL.createObjectURL(await r.blob()); if (live) setThumb({ src: made, kind: "image" }); }
      else if (live) setThumb({ src: null, kind: type.includes("pdf") ? "pdf" : "file" });
    }).catch(() => { if (live) setThumb({ src: null, kind: "file" }); });
    return () => { live = false; if (made) URL.revokeObjectURL(made); };
  }, [url]);
  return (
    <button type="button" className={css.receipt} data-testid="receipt-preview" onClick={() => openAttachment(url, L("Payment proof", "Bukti bayaran"))}>
      <span className={css.thumb} aria-hidden="true">
        {!thumb ? <Skel w="100%" h="100%" round="none" /> : thumb.src ? <img src={thumb.src} alt="" /> : <AppIcon name={thumb.kind === "pdf" ? "document" : "attach"} />}
      </span>
      <span className={css.receiptText}>
        <b>{L("Receipt / proof", "Resit / bukti")}</b>
        <span className={css.sub}>{thumb?.kind === "pdf" ? L("PDF · open to read", "PDF · buka untuk baca") : L("Open full size", "Buka saiz penuh")}</span>
      </span>
      <span className={css.receiptGo}><AppIcon name="preview" /><span className={css.receiptGoWord}>{L("View proof", "Lihat bukti")}</span></span>
    </button>
  );
}

/** One cell of a PaymentCard: a label the phone shows above the value (the desktop shows it in the header row). */
export function Cell({ k, children, num, className }: { k: string; children: ReactNode; num?: boolean; className?: string }) {
  return (
    <span className={`${css.cell} ${num ? css.num : ""} ${className ?? ""}`} role="cell">
      <span className={css.k}>{k}</span>
      <span className={css.v}>{children}</span>
    </span>
  );
}
