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
import { getLang } from "@/lib/i18n";

const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);

const api = makeApi("/staff");

interface Invoice { id: number; doc_number: string; doc_type: string; total_cents: number; payment_status?: string | null; company?: string | null; created_at: string; due_date?: string | null }
/* issuer_code (v1.28.0, migration 0073): NULL = legacy row issued by AZ ONE
   OFFICIAL, 'a2z' = A2Z CREATIVE MARKETING — printBusinessDoc() needs it so a
   re-print carries the letterhead of the entity that actually issued it. */
interface Receipt { id: number; receipt_number: string; invoice_number: string; amount_cents: number; payment_method?: string | null; payment_ref?: string | null; paid_at?: string | null; company?: string | null; created_at: string; issuer_code?: string | null }
interface CreditNote { id: number; cn_number: string; invoice_number: string; amount_cents: number; reason?: string | null; company?: string | null; created_at: string; issuer_code?: string | null }
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
    if (!r.ok) { showToast(L("No change", "Tiada perubahan"), r.data?.error?.message ?? L("Could not issue receipt", "Tidak dapat mengeluarkan resit"), "notice"); return; }
    showToast(L("Issued", "Dikeluarkan"), L(`Receipt ${r.data?.receipt_number} for ${inv.doc_number}`, `Resit ${r.data?.receipt_number} untuk ${inv.doc_number}`));
    loadAll();
  };

  const issueCreditNote = async (inv: Invoice) => {
    const amountRes = await prompt({ title: L(`Credit note for ${inv.doc_number}`, `Nota kredit untuk ${inv.doc_number}`), message: L(`Invoice total ${fmtRM(inv.total_cents)}. Enter the amount to credit (RM).`, `Jumlah invois ${fmtRM(inv.total_cents)}. Masukkan amaun untuk dikreditkan (RM).`), label: L("Amount (RM)", "Amaun (RM)"), placeholder: L("e.g. 150.00", "cth. 150.00"), required: true });
    if (!amountRes) return;
    const cents = Math.round(Number(amountRes.value) * 100);
    if (!cents || cents <= 0) { showToast(L("No change", "Tiada perubahan"), L("Enter a valid amount", "Masukkan amaun yang sah"), "notice"); return; }
    const reasonRes = await prompt({ title: L("Reason", "Sebab"), message: L("Why is this credit note being issued? (optional)", "Mengapa nota kredit ini dikeluarkan? (pilihan)"), label: L("Reason", "Sebab"), placeholder: L("e.g. returned goods", "cth. barang dipulangkan") });
    const r = await api<{ cn_number?: string; error?: { message?: string } }>(`/docs/${inv.id}/credit-note`, { method: "POST", body: JSON.stringify({ amount_cents: cents, reason: reasonRes?.value ?? "" }) });
    if (!r.ok) { showToast(L("No change", "Tiada perubahan"), r.data?.error?.message ?? L("Could not issue credit note", "Tidak dapat mengeluarkan nota kredit"), "notice"); return; }
    showToast(L("Issued", "Dikeluarkan"), L(`Credit note ${r.data?.cn_number}`, `Nota kredit ${r.data?.cn_number}`));
    loadAll();
  };

  const paidInvoices = invoices.filter((i) => (i.payment_status ?? "").toLowerCase() === "paid");

  return (
    <div className={card}>
      {toastNode}{promptNode}
      <p className="text-sm font-semibold">{L("🧾 Documents — receipts, credit notes & outstanding", "🧾 Dokumen — resit, nota kredit & tertunggak")}</p>
      <p className="text-muted-foreground mt-0.5 text-xs">
        {L("Issue a numbered receipt for a paid invoice, raise a credit note, and track every unpaid invoice in one place. Print carries the company letterhead.",
          "Keluarkan resit bernombor untuk invois berbayar, keluarkan nota kredit, dan jejak setiap invois belum dibayar di satu tempat. Cetakan membawa kepala surat syarikat.")}
      </p>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {([["outstanding", "Outstanding"], ["receipts", "Receipts"], ["credit", "Credit notes"]] as const).map(([v, l]) => (
          <button key={v} type="button" className={`rounded-full px-3 py-1 text-xs font-medium ${tab === v ? "bg-primary text-primary-foreground" : "bg-secondary"}`} onClick={() => setTab(v)}>{L(l, l === "Outstanding" ? "Tertunggak" : l === "Receipts" ? "Resit" : "Nota kredit")}</button>
        ))}
      </div>

      {tab === "outstanding" && (
        <div className="mt-3">
          {!outstanding ? <SkelText lines={3} className="mt-2" /> : outstanding.invoices.length === 0 ? (
            <p className="text-muted-foreground text-sm">{L("✅ No outstanding invoices — everything is paid.", "✅ Tiada invois tertunggak — semuanya telah dibayar.")}</p>
          ) : (
            <>
              <p className="mb-2 text-sm">{L("Total outstanding:", "Jumlah tertunggak:")} <span className="font-bold tabular-nums">{fmtRM(outstanding.total_cents)}</span> {L("across", "merangkumi")} {outstanding.invoices.length} {L(`invoice${outstanding.invoices.length === 1 ? "" : "s"}`, "invois")}.</p>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead><tr className="border-border border-b"><th className={th}>{L("INVOICE", "INVOIS")}</th><th className={th}>{L("CLIENT", "KLIEN")}</th><th className={th}>{L("DUE", "TARIKH AKHIR")}</th><th className={thR2}>{L("AMOUNT", "AMAUN")}</th></tr></thead>
                  <tbody>
                    {outstanding.invoices.map((o) => {
                      const overdue = o.due_date && o.due_date < new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
                      return (
                        <tr key={o.id} className="border-border border-b last:border-0">
                          <td className={td}>{o.doc_number}</td>
                          <td className={td}>{o.company ?? "—"}</td>
                          <td className={td}>{o.due_date ? <span className={overdue ? "text-danger font-medium" : ""}>{dmy(o.due_date)}{overdue ? L(" · overdue", " · lewat tempoh") : ""}</span> : "—"}</td>
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
            <p className="text-muted-foreground text-[10px] font-semibold tracking-wider uppercase">{L("Issue a receipt (paid invoices)", "Keluarkan resit (invois berbayar)")}</p>
            {paidInvoices.length === 0 ? <p className="text-muted-foreground mt-1 text-xs">{L("No paid invoices yet.", "Tiada invois berbayar lagi.")}</p> : (
              <div className="mt-1.5 space-y-1">
                {paidInvoices.slice(0, 12).map((inv) => {
                  const has = receipts.find((r) => r.invoice_number === inv.doc_number);
                  return (
                    <div key={inv.id} className="flex items-center justify-between gap-2 text-sm">
                      <span>{inv.doc_number}<span className="text-muted-foreground ml-1.5 text-xs">{inv.company ?? ""} · {fmtRM(inv.total_cents)}</span></span>
                      {has
                        ? <span className={chipSuccess}>{L("receipt", "resit")} {has.receipt_number}</span>
                        : <button type="button" className={btnSm} onClick={() => void issueReceipt(inv)}>{L("Issue receipt", "Keluarkan resit")}</button>}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          <div>
            <p className="text-muted-foreground text-[10px] font-semibold tracking-wider uppercase">{L("Issued receipts", "Resit yang dikeluarkan")}</p>
            {receipts.length === 0 ? <p className="text-muted-foreground mt-1 text-xs">{L("None yet.", "Tiada lagi.")}</p> : (
              <div className="mt-1.5 space-y-1">
                {receipts.map((r) => (
                  <div key={r.id} className="flex items-center justify-between gap-2 text-sm">
                    <span>{r.receipt_number}<span className="text-muted-foreground ml-1.5 text-xs">{r.company ?? ""} · {r.invoice_number} · {fmtRM(r.amount_cents)}</span></span>
                    <button type="button" className={btnSm} onClick={() => printBusinessDoc({ kind: "RECEIPT", number: r.receipt_number, date: r.paid_at ?? r.created_at, customer: r.company, invoiceNumber: r.invoice_number, amountCents: r.amount_cents, method: r.payment_method, reference: r.payment_ref, issuer_code: r.issuer_code })}>{L("🖨 Print", "🖨 Cetak")}</button>
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
            <p className="text-muted-foreground text-[10px] font-semibold tracking-wider uppercase">{L("Raise a credit note (against an invoice)", "Keluarkan nota kredit (terhadap invois)")}</p>
            {invoices.length === 0 ? <p className="text-muted-foreground mt-1 text-xs">{L("No invoices yet.", "Tiada invois lagi.")}</p> : (
              <div className="mt-1.5 space-y-1">
                {invoices.slice(0, 12).map((inv) => (
                  <div key={inv.id} className="flex items-center justify-between gap-2 text-sm">
                    <span>{inv.doc_number}<span className="text-muted-foreground ml-1.5 text-xs">{inv.company ?? ""} · {fmtRM(inv.total_cents)} · <span className={(inv.payment_status ?? "").toLowerCase() === "paid" ? chipSuccess : chipWarn}>{inv.payment_status ?? L("unpaid", "belum dibayar")}</span></span></span>
                    <button type="button" className={btnSm} onClick={() => void issueCreditNote(inv)}>{L("Credit note", "Nota kredit")}</button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div>
            <p className="text-muted-foreground text-[10px] font-semibold tracking-wider uppercase">{L("Issued credit notes", "Nota kredit yang dikeluarkan")}</p>
            {creditNotes.length === 0 ? <p className="text-muted-foreground mt-1 text-xs">{L("None yet.", "Tiada lagi.")}</p> : (
              <div className="mt-1.5 space-y-1">
                {creditNotes.map((n) => (
                  <div key={n.id} className="flex items-center justify-between gap-2 text-sm">
                    <span>{n.cn_number}<span className="text-muted-foreground ml-1.5 text-xs">{n.company ?? ""} · {n.invoice_number} · {fmtRM(n.amount_cents)}{n.reason ? ` · ${n.reason}` : ""}</span></span>
                    <button type="button" className={btnSm} onClick={() => printBusinessDoc({ kind: "CREDIT NOTE", number: n.cn_number, date: n.created_at, customer: n.company, invoiceNumber: n.invoice_number, amountCents: n.amount_cents, reason: n.reason, issuer_code: n.issuer_code })}>{L("🖨 Print", "🖨 Cetak")}</button>
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
