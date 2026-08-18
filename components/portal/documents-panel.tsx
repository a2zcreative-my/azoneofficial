"use client";

/* v1.7.0 — 🧾 Documents: extends QT → INV → Payment with Receipts, Credit
   Notes and a consolidated Outstanding-payments report. Issue a numbered
   receipt for any paid invoice, raise a credit note against an invoice, and
   print either with the company letterhead. */

import { useCallback, useEffect, useState } from "react";
import { SkelText } from "@/components/ui/skeleton";
import { makeApi } from "@/lib/api";
import { useSaveToast } from "@/components/ui/save-toast";
import { usePrompt } from "@/components/ui/prompt-dialog";
import { card, btnSm, chipSuccess, chipWarn, th, td, thR2, tdR2 } from "@/lib/ui-styles";
import { dmy, fmtRM } from "@/lib/format";
import { printBusinessDoc } from "@/lib/receipt-print";

const api = makeApi("/staff");

interface Invoice { id: number; doc_number: string; doc_type: string; total_cents: number; payment_status?: string | null; company?: string | null; created_at: string; due_date?: string | null }
interface Receipt { id: number; receipt_number: string; invoice_number: string; amount_cents: number; payment_method?: string | null; payment_ref?: string | null; paid_at?: string | null; company?: string | null; created_at: string }
interface CreditNote { id: number; cn_number: string; invoice_number: string; amount_cents: number; reason?: string | null; company?: string | null; created_at: string }
interface Outstanding { id: number; doc_number: string; total_cents: number; due_date?: string | null; created_at: string; company?: string | null; phone?: string | null }

export function DocumentsPanel() {
  const { show: showToast, node: toastNode } = useSaveToast();
  const { prompt, node: promptNode } = usePrompt();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [creditNotes, setCreditNotes] = useState<CreditNote[]>([]);
  const [outstanding, setOutstanding] = useState<{ invoices: Outstanding[]; total_cents: number } | null>(null);
  const [tab, setTab] = useState<"outstanding" | "receipts" | "credit">("outstanding");

  const loadAll = useCallback(() => {
    void api<{ docs: Invoice[] }>(`/docs?type=INV`).then((r) => { if (r.ok && r.data?.docs) setInvoices(r.data.docs); });
    void api<{ receipts: Receipt[] }>(`/receipts`).then((r) => { if (r.ok && r.data?.receipts) setReceipts(r.data.receipts); });
    void api<{ credit_notes: CreditNote[] }>(`/credit-notes`).then((r) => { if (r.ok && r.data?.credit_notes) setCreditNotes(r.data.credit_notes); });
    void api<{ invoices: Outstanding[]; total_cents: number }>(`/reports/outstanding`).then((r) => { if (r.ok && r.data) setOutstanding(r.data); });
  }, []);
  useEffect(() => { loadAll(); }, [loadAll]);

  const issueReceipt = async (inv: Invoice) => {
    const r = await api<{ receipt_number?: string; error?: { message?: string } }>(`/docs/${inv.id}/receipt`, { method: "POST", body: JSON.stringify({}) });
    if (!r.ok) { showToast("No change", r.data?.error?.message ?? "Could not issue receipt", "notice"); return; }
    showToast("Issued", `Receipt ${r.data?.receipt_number} for ${inv.doc_number}`);
    loadAll();
  };

  const issueCreditNote = async (inv: Invoice) => {
    const amountRes = await prompt({ title: `Credit note for ${inv.doc_number}`, message: `Invoice total ${fmtRM(inv.total_cents)}. Enter the amount to credit (RM).`, label: "Amount (RM)", placeholder: "e.g. 150.00", required: true });
    if (!amountRes) return;
    const cents = Math.round(Number(amountRes.value) * 100);
    if (!cents || cents <= 0) { showToast("No change", "Enter a valid amount", "notice"); return; }
    const reasonRes = await prompt({ title: "Reason", message: "Why is this credit note being issued? (optional)", label: "Reason", placeholder: "e.g. returned goods" });
    const r = await api<{ cn_number?: string; error?: { message?: string } }>(`/docs/${inv.id}/credit-note`, { method: "POST", body: JSON.stringify({ amount_cents: cents, reason: reasonRes?.value ?? "" }) });
    if (!r.ok) { showToast("No change", r.data?.error?.message ?? "Could not issue credit note", "notice"); return; }
    showToast("Issued", `Credit note ${r.data?.cn_number}`);
    loadAll();
  };

  const paidInvoices = invoices.filter((i) => (i.payment_status ?? "").toLowerCase() === "paid");

  return (
    <div className={card}>
      {toastNode}{promptNode}
      <p className="text-sm font-semibold">🧾 Documents — receipts, credit notes &amp; outstanding</p>
      <p className="text-muted-foreground mt-0.5 text-xs">
        Issue a numbered receipt for a paid invoice, raise a credit note, and track every unpaid invoice in one place. Print carries the company letterhead.
      </p>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {([["outstanding", "Outstanding"], ["receipts", "Receipts"], ["credit", "Credit notes"]] as const).map(([v, l]) => (
          <button key={v} type="button" className={`rounded-full px-3 py-1 text-xs font-medium ${tab === v ? "bg-primary text-primary-foreground" : "bg-secondary"}`} onClick={() => setTab(v)}>{l}</button>
        ))}
      </div>

      {tab === "outstanding" && (
        <div className="mt-3">
          {!outstanding ? <SkelText lines={3} className="mt-2" /> : outstanding.invoices.length === 0 ? (
            <p className="text-muted-foreground text-sm">✅ No outstanding invoices — everything is paid.</p>
          ) : (
            <>
              <p className="mb-2 text-sm">Total outstanding: <span className="font-bold tabular-nums">{fmtRM(outstanding.total_cents)}</span> across {outstanding.invoices.length} invoice{outstanding.invoices.length === 1 ? "" : "s"}.</p>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead><tr className="border-border border-b"><th className={th}>INVOICE</th><th className={th}>CLIENT</th><th className={th}>DUE</th><th className={thR2}>AMOUNT</th></tr></thead>
                  <tbody>
                    {outstanding.invoices.map((o) => {
                      const overdue = o.due_date && o.due_date < new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
                      return (
                        <tr key={o.id} className="border-border border-b last:border-0">
                          <td className={td}>{o.doc_number}</td>
                          <td className={td}>{o.company ?? "—"}</td>
                          <td className={td}>{o.due_date ? <span className={overdue ? "text-danger font-medium" : ""}>{dmy(o.due_date)}{overdue ? " · overdue" : ""}</span> : "—"}</td>
                          <td className={tdR2}>{fmtRM(o.total_cents)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {tab === "receipts" && (
        <div className="mt-3 space-y-3">
          <div>
            <p className="text-muted-foreground text-[10px] font-semibold tracking-wider uppercase">Issue a receipt (paid invoices)</p>
            {paidInvoices.length === 0 ? <p className="text-muted-foreground mt-1 text-xs">No paid invoices yet.</p> : (
              <div className="mt-1.5 space-y-1">
                {paidInvoices.slice(0, 12).map((inv) => {
                  const has = receipts.find((r) => r.invoice_number === inv.doc_number);
                  return (
                    <div key={inv.id} className="flex items-center justify-between gap-2 text-sm">
                      <span>{inv.doc_number}<span className="text-muted-foreground ml-1.5 text-xs">{inv.company ?? ""} · {fmtRM(inv.total_cents)}</span></span>
                      {has
                        ? <span className={chipSuccess}>receipt {has.receipt_number}</span>
                        : <button type="button" className={btnSm} onClick={() => void issueReceipt(inv)}>Issue receipt</button>}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          <div>
            <p className="text-muted-foreground text-[10px] font-semibold tracking-wider uppercase">Issued receipts</p>
            {receipts.length === 0 ? <p className="text-muted-foreground mt-1 text-xs">None yet.</p> : (
              <div className="mt-1.5 space-y-1">
                {receipts.map((r) => (
                  <div key={r.id} className="flex items-center justify-between gap-2 text-sm">
                    <span>{r.receipt_number}<span className="text-muted-foreground ml-1.5 text-xs">{r.company ?? ""} · {r.invoice_number} · {fmtRM(r.amount_cents)}</span></span>
                    <button type="button" className={btnSm} onClick={() => printBusinessDoc({ kind: "RECEIPT", number: r.receipt_number, date: r.paid_at ?? r.created_at, customer: r.company, invoiceNumber: r.invoice_number, amountCents: r.amount_cents, method: r.payment_method, reference: r.payment_ref })}>🖨 Print</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {tab === "credit" && (
        <div className="mt-3 space-y-3">
          <div>
            <p className="text-muted-foreground text-[10px] font-semibold tracking-wider uppercase">Raise a credit note (against an invoice)</p>
            {invoices.length === 0 ? <p className="text-muted-foreground mt-1 text-xs">No invoices yet.</p> : (
              <div className="mt-1.5 space-y-1">
                {invoices.slice(0, 12).map((inv) => (
                  <div key={inv.id} className="flex items-center justify-between gap-2 text-sm">
                    <span>{inv.doc_number}<span className="text-muted-foreground ml-1.5 text-xs">{inv.company ?? ""} · {fmtRM(inv.total_cents)} · <span className={(inv.payment_status ?? "").toLowerCase() === "paid" ? chipSuccess : chipWarn}>{inv.payment_status ?? "unpaid"}</span></span></span>
                    <button type="button" className={btnSm} onClick={() => void issueCreditNote(inv)}>Credit note</button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div>
            <p className="text-muted-foreground text-[10px] font-semibold tracking-wider uppercase">Issued credit notes</p>
            {creditNotes.length === 0 ? <p className="text-muted-foreground mt-1 text-xs">None yet.</p> : (
              <div className="mt-1.5 space-y-1">
                {creditNotes.map((n) => (
                  <div key={n.id} className="flex items-center justify-between gap-2 text-sm">
                    <span>{n.cn_number}<span className="text-muted-foreground ml-1.5 text-xs">{n.company ?? ""} · {n.invoice_number} · {fmtRM(n.amount_cents)}{n.reason ? ` · ${n.reason}` : ""}</span></span>
                    <button type="button" className={btnSm} onClick={() => printBusinessDoc({ kind: "CREDIT NOTE", number: n.cn_number, date: n.created_at, customer: n.company, invoiceNumber: n.invoice_number, amountCents: n.amount_cents, reason: n.reason })}>🖨 Print</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
