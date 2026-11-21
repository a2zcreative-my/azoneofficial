"use client";

/**
 * v1.416.0 - INVOICE & PAYMENT DETAILS in a document's expanded row (the CEO's
 * Quotations & Invoices reference, 21-11-2026, "As recommended").
 *
 * The Status column keeps one short badge; what used to crowd it - which
 * invoices a quotation became, what was paid, when and with which reference -
 * lives here. A PURE READ of records that already exist:
 *   - each linked invoice and its VERIFIED payments: GET /staff/docs/:id/payments
 *     (invoice_payments; a voided payment is shown as voided and never counts);
 *   - a payment REPORTED but not verified: the pending figure the page already
 *     holds from /staff/payments - an amount only, never deducted, never "paid";
 *   - the old Mark paid date and reference, from the invoice row itself.
 * Nothing here writes, and an invoice is never "paid" because it exists: the
 * badge comes from the stored status first and verified money second
 * (invoiceState, the one reading).
 */

import { useEffect, useState } from "react";

import { SkelRows } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { dmy, fmtRM } from "@/lib/format";
import { getLang } from "@/lib/i18n";
import { btnSmQuiet, chipSmNeutral, chipSmSuccess, chipSmWarn } from "@/lib/ui-styles";

import css from "./doc-money.module.css";

const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);

interface Pay {
  id: number; amount_cents: number; received_on: string; method: string | null; reference: string | null;
  voided_at: string | null; void_reason: string | null;
}
interface InvMoney {
  invoice: { id: number; doc_number: string; total_cents: number; payment_status: string | null; paid_at: string | null; created_at: string };
  payments: Pay[]; received_cents: number; balance_cents: number;
}
/** what the page already knows about an invoice: the Mark paid reference and a reported, unverified amount */
export interface InvoiceExtra { payment_ref?: string | null; pending_cents?: number }

/** THE reading of an invoice's payment badge: the stored status first, verified money second.
    Never "paid" because the invoice exists or because a payment was only reported. */
export function invoiceState(status: string | null | undefined, verifiedCents: number): { key: string; word: string; tone: string } {
  if (status === "paid") return { key: "paid", word: L("Paid", "Dibayar"), tone: chipSmSuccess };
  if (status === "void") return { key: "void", word: L("Void", "Batal"), tone: chipSmNeutral };
  if (verifiedCents > 0) return { key: "partial", word: L("Partially paid", "Dibayar sebahagian"), tone: chipSmWarn };
  if (status === "overdue") return { key: "overdue", word: L("Overdue", "Tertunggak"), tone: chipSmWarn };
  return { key: "unpaid", word: L("Unpaid", "Belum dibayar"), tone: chipSmNeutral };
}

/** each invoice's verified payments, read once per open row */
function useInvoiceMoney(ids: number[]) {
  const key = ids.join(",");
  const [data, setData] = useState<Record<number, InvMoney | null>>({});
  const [problem, setProblem] = useState("");
  const [seen, setSeen] = useState("");
  if (seen !== key) { setSeen(key); setData({}); setProblem(""); }
  useEffect(() => {
    if (!key) return;
    const c = new AbortController();
    void Promise.all(key.split(",").map(Number).map((id) => api<InvMoney>(`/staff/docs/${id}/payments`, { signal: c.signal }).then((r) => [id, r] as const)))
      .then((all) => {
        if (c.signal.aborted) return;
        const next: Record<number, InvMoney | null> = {};
        let failed = false;
        for (const [id, r] of all) { next[id] = r.ok && r.data?.invoice ? r.data : null; if (!next[id]) failed = true; }
        setData(next);
        if (failed) setProblem(L("Some payment details could not be read. Try Refresh.", "Sebahagian butiran bayaran tidak dapat dibaca. Cuba Muat semula."));
      });
    return () => c.abort();
  }, [key]);
  return { data, problem, loading: !!key && Object.keys(data).length === 0 && !problem };
}

/**
 * The section. `ids` are the live invoices: a quotation's invoices, or one invoice itself.
 * `quotation` adds the Quoted / Invoiced / Balance to invoice line; `showPayments` is off for an
 * invoice's own row, whose payments the Part payments panel already lists (with its actions).
 */
export function DocMoney({ ids, quotation, showPayments = true, extra, onOpenInvoice, onViewPayments }: {
  ids: number[];
  quotation?: { total_cents: number; invoiced_cents: number | null } | null;
  showPayments?: boolean;
  extra: (invoiceId: number) => InvoiceExtra;
  onOpenInvoice?: (id: number, docNumber: string) => void;
  onViewPayments?: () => void;
}) {
  const { data, problem, loading } = useInvoiceMoney(ids);
  const invoices = ids.map((id) => data[id]).filter((x): x is InvMoney => !!x);
  const invoiced = quotation ? (quotation.invoiced_cents ?? invoices.reduce((a, m) => a + m.invoice.total_cents, 0)) : 0;
  return (
    <section className={css.money} data-testid="doc-money" aria-label={quotation ? L("Linked invoice & payment details", "Butiran invois & bayaran berkaitan") : L("Invoice & payment details", "Butiran invois & bayaran")}>
      {quotation && (
        <dl className={css.summary} data-testid="doc-money-summary">
          <div><dt>{L("Quoted", "Disebut harga")}</dt><dd>{fmtRM(quotation.total_cents)}</dd></div>
          <div><dt>{L("Invoiced", "Diinvois")}</dt><dd>{fmtRM(invoiced)}</dd></div>
          <div><dt>{L("Balance to invoice", "Baki untuk diinvois")}</dt><dd>{fmtRM(Math.max(0, quotation.total_cents - invoiced))}</dd></div>
        </dl>
      )}
      {loading && <SkelRows rows={2} />}
      {problem && <p className={css.problem} role="alert">{problem}</p>}
      {invoices.map((m) => {
        const inv = m.invoice;
        const ex = extra(inv.id);
        const live = m.payments.filter((p) => !p.voided_at);
        const st = invoiceState(inv.payment_status, m.received_cents);
        const remaining = inv.payment_status === "paid" || inv.payment_status === "void" ? 0 : m.balance_cents;
        const pending = inv.payment_status === "paid" ? 0 : Number(ex.pending_cents ?? 0);
        return (
          <article key={inv.id} className={css.invoice} data-testid="doc-money-invoice" data-invoice={inv.id} data-state={st.key}>
            <div className={css.invHead}>
              <span className={css.invNo}>
                {onOpenInvoice ? <button type="button" className={css.link} onClick={() => onOpenInvoice(inv.id, inv.doc_number)} data-testid="doc-money-open">{inv.doc_number}</button> : <strong>{inv.doc_number}</strong>}
                {inv.created_at && <small>{L("Issued", "Dikeluarkan")} {dmy(inv.created_at.slice(0, 10))}</small>}
              </span>
              <span className={css.fig}><small>{L("Invoice amount", "Jumlah invois")}</small>{fmtRM(inv.total_cents)}</span>
              <span className={css.fig}><small>{L("Remaining", "Baki")}</small>{fmtRM(remaining)}</span>
              <span className={st.tone} data-testid="doc-money-state">{st.word}</span>
            </div>
            {showPayments && m.payments.length > 0 && (
              <ul className={css.pays} aria-label={L("Verified payments", "Bayaran disahkan")}>
                {m.payments.map((p) => (
                  <li key={p.id} className={p.voided_at ? css.payVoid : undefined} data-testid="doc-money-payment">
                    <span>{dmy(p.received_on)}</span>
                    <span className={css.ref}>{p.reference || L("No reference", "Tiada rujukan")}{p.method ? ` · ${p.method}` : ""}</span>
                    <span className={css.amt}>{fmtRM(p.amount_cents)}</span>
                    {p.voided_at && <span className={chipSmNeutral} title={p.void_reason ?? undefined}>{L("Voided", "Dibatalkan")}</span>}
                  </li>
                ))}
              </ul>
            )}
            {/* the old Mark paid path: the invoice row's own date and reference (no payment record behind it) */}
            {inv.payment_status === "paid" && live.length === 0 && (
              <p className={css.line} data-testid="doc-money-markpaid">
                {L("Marked paid", "Ditanda dibayar")}{inv.paid_at ? ` · ${dmy(inv.paid_at.slice(0, 10))}` : ""}{ex.payment_ref ? ` · ${L("Ref", "Ruj")} ${ex.payment_ref}` : ""}
              </p>
            )}
            {showPayments && inv.payment_status !== "paid" && live.length === 0 && pending === 0 && (
              <p className={css.line} data-testid="doc-money-none">{L("No payment recorded.", "Tiada bayaran direkodkan.")}</p>
            )}
            {pending > 0 && (
              <p className={css.line}><span className={chipSmWarn} data-testid="doc-money-pending" title={L("Reported, not money until the CEO verifies it", "Dilapor, bukan wang sehingga CEO mengesahkan")}>{fmtRM(pending)} {L("reported · awaiting CEO", "dilapor · menunggu CEO")}</span></p>
            )}
          </article>
        );
      })}
      {onViewPayments && invoices.length > 0 && (
        <div className={css.foot}><button type="button" className={btnSmQuiet} onClick={onViewPayments} data-testid="doc-money-payments">{L("View in Payments", "Lihat dalam Bayaran")}</button></div>
      )}
    </section>
  );
}
