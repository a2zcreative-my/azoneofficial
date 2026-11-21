/**
 * COLLECTIONS - v1.401.0, Sales Command Center Phase 5 (the CEO, 21-11-2026, "As recommended" on the seven
 * Phase 5 decisions). The sales side of getting paid, beside Payments - it NEVER touches the money:
 *
 *   GET /collections?scope=mine|all     every unpaid invoice (not paid, not void) with its VERIFIED balance
 *                                       (invoice_payments, the only money), what is reported and waiting for
 *                                       the CEO (never counted as paid), its age bucket, its collector (the
 *                                       invoice's salesperson - read, never changed here), its open collection
 *                                       follow-up (customer_followups with doc_id) and one flag.
 *   GET /collections/deal/:id           the payment status of a won deal's invoices (decision 6), read only.
 *
 * Booking the next collection action is the existing POST /customers/:id/followups with doc_id (business.ts):
 * one open follow-up per invoice. Reporting, evidence, verification, Mark Paid, the switch, receipts, credit
 * notes, Finance, the closer and commission are untouched - this file only reads.
 *
 * WHO (decision 5): Everyone is the same rule as GET /payments' "all" (seesAllPayments); anyone else sees the
 * invoices they are the salesperson of. Mine is the default for everyone.
 */
import type { Env } from "./index";
import { type StaffUser } from "./staff";
import { canUser } from "./permissions";
import { err, json } from "./shared";
import { PENDING, seesAllPayments } from "./payment-verify";

const NAME = (a: string) => `COALESCE(NULLIF(TRIM(${a}.full_name), ''), ${a}.name)`;
const mytToday = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
const missing = (e: unknown) => /no such (table|column)/i.test(String(e));
const dayNum = (iso: string) => Math.floor(Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) / 86400000);
const mytDay = (ts: string) => {
  const t = Date.parse(ts.replace(" ", "T") + (/[zZ]$/.test(ts) ? "" : "Z"));
  return Number.isNaN(t) ? ts.slice(0, 10) : new Date(t + 8 * 3600 * 1000).toISOString().slice(0, 10);
};
export const BUCKETS = ["0_30", "31_60", "61_90", "90_plus"] as const;
export const bucketOf = (age: number) => (age <= 30 ? "0_30" : age <= 60 ? "31_60" : age <= 90 ? "61_90" : "90_plus");

interface Row {
  id: number; doc_number: string; customer_id: number; customer: string; phone: string | null; issuer_code: string | null;
  total_cents: number; payment_status: string | null; due_date: string | null; created_at: string;
  collector_id: number | null; collector: string | null; verified_cents: number;
  fu_id: number | null; fu_due: string | null; fu_note: string | null; fu_owner: string | null;
}

async function pendingFor(env: Env, ids: number[]): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  if (!ids.length) return out;
  try {
    const { results } = await env.DB.prepare(
      `SELECT invoice_id, SUM(amount_cents) AS n FROM invoice_payment_reports
        WHERE state IN (${PENDING.map(() => "?").join(",")}) AND invoice_id IN (${ids.map(() => "?").join(",")}) GROUP BY invoice_id`,
    ).bind(...PENDING, ...ids).all<{ invoice_id: number; n: number }>();
    for (const r of results ?? []) out.set(Number(r.invoice_id), Number(r.n ?? 0));
  } catch (e) { if (!missing(e)) throw e; }
  return out;
}

export async function handleCollections(env: Env, path: string, method: string, user: StaffUser, params: URLSearchParams): Promise<Response | null> {
  if (path !== "/collections" && !path.startsWith("/collections/")) return null;
  if (["agent", "customer"].includes(user.role)) return err("forbidden", "Sales access required", 403);
  if (!canUser(user, "sales") && !canUser(user, "exec_view") && !canUser(user, "payment_report")) return err("forbidden", "Sales access required", 403);
  if (method !== "GET") return err("method_not_allowed", "Collections only reads; book a follow-up on the customer", 405);
  const all = seesAllPayments(user);
  const today = mytToday();

  if (path === "/collections") {
    const scope = params.get("scope") === "all" && all ? "all" : "mine";
    const { results } = await env.DB.prepare(
      `SELECT d.id, d.doc_number, d.customer_id, c.company AS customer, c.phone, d.issuer_code, d.total_cents, d.payment_status, d.due_date, d.created_at,
              d.salesperson_id AS collector_id, ${NAME("s")} AS collector,
              COALESCE((SELECT SUM(p.amount_cents) FROM invoice_payments p WHERE p.invoice_id = d.id AND p.voided_at IS NULL), 0) AS verified_cents,
              f.id AS fu_id, f.due_on AS fu_due, f.note AS fu_note, ${NAME("fo")} AS fu_owner
         FROM sales_documents d JOIN customers c ON c.id = d.customer_id LEFT JOIN users s ON s.id = d.salesperson_id
         LEFT JOIN customer_followups f ON f.id = (SELECT x.id FROM customer_followups x WHERE x.doc_id = d.id AND x.done_at IS NULL AND x.cancelled_at IS NULL ORDER BY x.due_on LIMIT 1)
         LEFT JOIN users fo ON fo.id = f.owner_id
        WHERE d.doc_type = 'INV' AND COALESCE(d.payment_status, 'unpaid') NOT IN ('paid', 'void') AND (?1 = 1 OR d.salesperson_id = ?2)
        ORDER BY d.created_at, d.id LIMIT 500`,
    ).bind(scope === "all" ? 1 : 0, user.id).all<Row>();
    const rows = results ?? [];
    const pend = await pendingFor(env, rows.map((r) => r.id));
    const t = dayNum(today);
    const items = rows.map((r) => {
      const verified = Number(r.verified_cents ?? 0);
      const balance = Math.max(0, Number(r.total_cents) - verified);
      const age = Math.max(0, t - dayNum(mytDay(r.created_at)));
      const overdue = r.payment_status === "overdue" || (!!r.due_date && r.due_date < today);
      const flag = r.fu_due ? (r.fu_due < today ? "overdue" : r.fu_due === today ? "today" : "booked") : "no_next";
      return {
        id: r.id, doc_number: r.doc_number, customer_id: r.customer_id, customer: r.customer, phone: r.phone, issuer_code: r.issuer_code,
        total_cents: Number(r.total_cents), verified_cents: verified, waiting_cents: pend.get(r.id) ?? 0, balance_cents: balance,
        due_date: r.due_date, invoice_overdue: overdue, age_days: age, bucket: bucketOf(age),
        collector_id: r.collector_id, collector: r.collector, flag,
        followup: r.fu_id ? { id: r.fu_id, due_on: r.fu_due, note: r.fu_note, owner: r.fu_owner } : null,
      };
    });
    const sum = (f: (i: (typeof items)[number]) => boolean) => items.filter(f).reduce((n, i) => n + i.balance_cents, 0);
    return json({
      today, scope, can_all: all, items,
      summary: {
        invoices: items.length, balance_cents: sum(() => true), waiting_cents: items.reduce((n, i) => n + i.waiting_cents, 0),
        buckets: Object.fromEntries(BUCKETS.map((b) => [b, { n: items.filter((i) => i.bucket === b).length, cents: sum((i) => i.bucket === b) }])),
        no_next: items.filter((i) => i.flag === "no_next").length, late: items.filter((i) => i.flag === "overdue").length,
        invoice_overdue: items.filter((i) => i.invoice_overdue).length,
      },
    });
  }

  const m = /^\/collections\/deal\/(\d+)$/.exec(path);
  if (m) {
    try {
      const deal = await env.DB.prepare(`SELECT id, customer_id, owner_id FROM sales_opportunities WHERE id = ?1`).bind(Number(m[1])).first<{ id: number; owner_id: number | null }>();
      if (!deal) return err("not_found", "Deal not found", 404);
      const { results } = await env.DB.prepare(
        `SELECT i.id, i.doc_number, i.total_cents, i.payment_status, i.salesperson_id,
                COALESCE((SELECT SUM(p.amount_cents) FROM invoice_payments p WHERE p.invoice_id = i.id AND p.voided_at IS NULL), 0) AS verified_cents,
                EXISTS (SELECT 1 FROM invoice_paid_confirmations k WHERE k.invoice_id = i.id AND k.revoked_at IS NULL) AS confirmed
           FROM opportunity_quotations l JOIN sales_documents i ON i.converted_from = l.doc_id AND i.doc_type = 'INV'
          WHERE l.opportunity_id = ?1 AND l.unlinked_at IS NULL AND COALESCE(i.payment_status, '') != 'void' ORDER BY i.id`,
      ).bind(deal.id).all<{ id: number; doc_number: string; total_cents: number; payment_status: string | null; salesperson_id: number | null; verified_cents: number; confirmed: number }>();
      const rows = results ?? [];
      const pend = await pendingFor(env, rows.map((r) => r.id));
      /* the amounts only for someone who may read that invoice's payments; everyone else gets the words */
      const mayRead = (sp: number | null) => all || sp === user.id;
      return json({
        invoices: rows.map((r) => {
          const verified = Number(r.verified_cents ?? 0), total = Number(r.total_cents);
          const status = r.payment_status === "paid" ? (r.confirmed ? "paid_verified" : "paid") : verified > 0 ? "part_paid" : "invoiced";
          return { id: r.id, doc_number: r.doc_number, status, waiting: (pend.get(r.id) ?? 0) > 0,
            ...(mayRead(r.salesperson_id) ? { total_cents: total, verified_cents: verified } : {}) };
        }),
      });
    } catch (e) {
      if (missing(e)) return json({ invoices: [] });
      throw e;
    }
  }
  return err("not_found", "Not found", 404);
}
