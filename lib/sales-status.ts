/* v1.320.0 - SALES 2.0, STAGE 1 (the CEO's "Proceed the recommend" on
   claude/SALES-2.0-STAGE-0-AUDIT.md, S2-4 and S2-5). WHAT A SALES RECORD'S
   STATE MEANS ON THE SCREEN, worked out once and with no React, so every
   Sales 2.0 screen draws the same word for the same record and the guard
   (tests/sales2.mjs) can run it.

   NOTHING IS STORED for any of this. A quotation has no status column: its
   word is read from what the records already hold - an invoice made from it
   (sales_documents.converted_from), the customer's acceptance, a follow-up
   booked or a contact recorded. An invoice's word is its stored
   payment_status, with the CEO-verified part beside it. The images' Draft
   and Sent are not drawn: nothing records them (S2-4).

     quoteStatus      Open · Follow-up · Accepted · Partially invoiced · Invoiced
     invoiceStatus    Unpaid · Partially paid · Paid · Void, and the Overdue tag
     pipelineCounts   the seven steps of the Sales Pipeline (S2-5): a count per
                      step, read from each record's own table. Nothing is
                      "moved"; a count is what each table holds today. */

export type QuoteKey = "open" | "follow_up" | "accepted" | "part_invoiced" | "invoiced";
export type InvoiceKey = "unpaid" | "part_paid" | "paid" | "void";
export type PipeKey = "enquiry" | "quotation" | "follow_up" | "invoice" | "reported" | "verified" | "closed";
export const PIPELINE: readonly PipeKey[] = ["enquiry", "quotation", "follow_up", "invoice", "reported", "verified", "closed"];

export interface QuoteLike {
  id: number; total_cents: number;
  acceptance?: { current: boolean } | null;
  next?: { due_on: string } | null;
  last_contact?: { at: string | null } | null;
}
export interface InvoiceLike {
  id: number; doc_type?: string; total_cents: number; payment_status: string | null; created_at?: string;
  converted_from?: number | null; paid_at?: string | null; paid_confirmed_at?: string | null;
}
/** the CEO-verified and the reported-not-verified parts of one invoice (the payment engine's own figures) */
export interface PayFacts { verified_cents: number; pending_cents: number }

/** the invoices made from each quotation, a voided one left out */
export function invoicesByQuote(invoices: readonly InvoiceLike[]): Map<number, InvoiceLike[]> {
  const m = new Map<number, InvoiceLike[]>();
  for (const i of invoices) {
    if (i.converted_from == null || i.payment_status === "void") continue;
    m.set(i.converted_from, [...(m.get(i.converted_from) ?? []), i]);
  }
  return m;
}

/** S2-4 - a quotation's word, from the records that already exist */
export function quoteStatus(q: QuoteLike, made: readonly InvoiceLike[] = []): QuoteKey {
  const invoiced = made.reduce((a, i) => a + i.total_cents, 0);
  if (made.length && invoiced >= q.total_cents) return "invoiced";
  if (made.length) return "part_invoiced";
  if (q.acceptance?.current) return "accepted";
  if (q.next || q.last_contact?.at) return "follow_up";
  return "open";
}

/** S2-4 - an invoice's word: the stored status, with the verified part beside it */
export function invoiceStatus(i: InvoiceLike, pay?: PayFacts | null): { key: InvoiceKey; overdue: boolean; verified_cents: number; balance_cents: number } {
  if (i.payment_status === "void") return { key: "void", overdue: false, verified_cents: 0, balance_cents: 0 };
  const verified = Math.max(0, pay?.verified_cents ?? 0);
  if (i.payment_status === "paid") return { key: "paid", overdue: false, verified_cents: verified, balance_cents: 0 };
  const balance = Math.max(0, i.total_cents - verified);
  return { key: verified > 0 ? "part_paid" : "unpaid", overdue: i.payment_status === "overdue", verified_cents: verified, balance_cents: balance };
}

/* S2-5 - THE SALES PIPELINE, a count per step. Each record is counted where
   it stands now, once:
     enquiry    an enquiry not yet closed
     quotation  an open quotation nobody has followed up yet
     follow_up  an open quotation being followed up, or accepted and not yet invoiced
     invoice    an invoice with money still owed and nothing waiting for the CEO
     reported   an invoice with a payment reported and not yet verified
     verified   an invoice paid in full (CEO-verified) and not yet confirmed for commission
     closed     an invoice paid and confirmed, in the period asked for
   A quotation already invoiced is not counted again: its invoice is. */
export interface PipelineInput {
  enquiries: readonly { status: string }[];
  quotes: readonly QuoteLike[];
  invoices: readonly InvoiceLike[];
  pay: Readonly<Record<number, PayFacts>> | null;
  /** YYYY-MM: the month whose closed sales are counted */
  month: string;
}
export function pipelineCounts(p: PipelineInput): Record<PipeKey, number> {
  const out: Record<PipeKey, number> = { enquiry: 0, quotation: 0, follow_up: 0, invoice: 0, reported: 0, verified: 0, closed: 0 };
  out.enquiry = p.enquiries.filter((e) => e.status !== "closed").length;
  const made = invoicesByQuote(p.invoices);
  for (const q of p.quotes) {
    const s = quoteStatus(q, made.get(q.id) ?? []);
    if (s === "open") out.quotation += 1;
    else if (s === "follow_up" || s === "accepted") out.follow_up += 1;
  }
  for (const i of p.invoices) {
    if (i.doc_type !== undefined && i.doc_type !== "INV") continue;
    const st = invoiceStatus(i, p.pay?.[i.id]);
    if (st.key === "void") continue;
    if (st.key === "paid") {
      if (i.paid_confirmed_at) { if ((i.paid_confirmed_at ?? "").slice(0, 7) === p.month) out.closed += 1; }
      else out.verified += 1;
      continue;
    }
    if ((p.pay?.[i.id]?.pending_cents ?? 0) > 0) out.reported += 1;
    else out.invoice += 1;
  }
  return out;
}
