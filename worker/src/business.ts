/**
 * BUSINESS JOINS - the ERP roadmap, phase by phase. v1.181.13 onward.
 *
 * The CEO, 20-10-2026: *"I want to make my system like a HRM, CRM, inventory
 * management, sales and recording"* - and then: *"Proceed with the
 * implementation phase by phase, and also do not change any logic since my
 * system are currently use by staff."*
 *
 * That second sentence is the contract of this file. Every route here is
 * ADDITIVE: it reads what the portal already records, or it writes to a table
 * of its own. Nothing here changes how an existing figure is computed, how an
 * invoice becomes paid, what payroll pays, what the cash book says, or what a
 * staff member already sees. The roadmap (docs/ERP-ROADMAP.md) lists each
 * phase and the rule it keeps; the guard tests/business-joins.mjs holds the
 * file to it.
 *
 * Each route carries the authority of the screen its data already lives on.
 * A join is never a softer road to something a role could not open before:
 * the customer timeline shows documents to whoever may open Sales, enquiries
 * only to whoever may open Enquiries, engagements only as Sales Performance
 * would show them, live sessions only to the management that schedules them.
 *
 * Routes are written against the FULL staff sub-path (/docs/12/payments), so
 * tests/api-routes.mjs can read this file with the staff base and prove that
 * every button in the portal has somebody listening.
 */
import type { Env } from "./index";
import type { StaffUser } from "./staff";
import { json, err, audit, str, num } from "./shared";
import { can } from "./permissions";
import { glMonthFigures } from "./ledger"; // v1.222.0 - the ledger in the month-close snapshot (reads only)

/* ── time ──────────────────────────────────────────────────────────────── */
const mytNow = () => new Date(Date.now() + 8 * 3600 * 1000);
const mytToday = () => mytNow().toISOString().slice(0, 10);
const validDay = (d: unknown): d is string =>
  typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`));
/** A stored UTC "YYYY-MM-DD HH:MM:SS" as the Malaysian clock reads it. */
const utcToMyt = (s: string | null | undefined): string | null => {
  if (!s) return null;
  const t = Date.parse(`${s.replace(" ", "T").slice(0, 19)}Z`);
  if (Number.isNaN(t)) return s;
  return new Date(t + 8 * 3600 * 1000).toISOString().slice(0, 16).replace("T", " ");
};

/** "no such table" / "no such column": a database a migration behind. */
const skew = (e: unknown) => /no such (table|column)/.test(String(e));

/* ── who may do what - the authorities that already exist ─────────────── */
/** Read sales documents: the same test GET /docs uses. */
const canReadDocs = (u: StaffUser) => can(u.role, "sales") || can(u.role, "exec_view");
/** Touch money on an invoice: the same test marking an invoice paid uses. */
/* v1.224.0 (the owner, 29-10-2026): recording or voiding a part payment is
   saying money arrived - the CEO, COO and admins only (invoice_payment) */
const canInvoiceMoney = (u: StaffUser) => can(u.role, "invoice_payment");
/** v1.181.17 - the joining checklist's keys, exactly as Staff Details
    (components/staff/staff-directory.tsx ONBOARDING_ITEMS) writes them */
export const JOINING_KEYS = ["offer_letter", "contract", "bank", "twofa", "badge", "groups"];
/** v1.181.17 - the leaving checklist */
export const LEAVING_KEYS = ["assets_returned", "access_removed", "claims_settled", "final_pay", "exit_letter", "groups_removed"];
/** v1.181.17 - the letters HR issues */
export const LETTER_KINDS = ["offer", "confirmation", "extension", "warning", "resignation_acceptance", "employment_verification"];
/** The roles /live-sessions treats as management. */
const LIVE_MGR = ["ceo", "coo", "cco", "hr_admin", "super_admin", "admin"];

export async function handleBusiness(
  env: Env, path: string, method: string, body: Record<string, unknown> | null, user: StaffUser,
  params: URLSearchParams = new URLSearchParams(),
): Promise<Response | null> {
  /* ════════════════════════════════════════════════════════════════════
     PHASE 1 (v1.181.13) - PART PAYMENTS
     ════════════════════════════════════════════════════════════════════
     The CEO chose, 20-10-2026: a part payment is RECORDED and its balance
     shown, and the invoice stays unpaid - aging, revenue, commission and the
     cash book move only when somebody marks the invoice paid, exactly as
     today. So nothing in this block writes to sales_documents,
     cashflow_entries or the journal. When the parts add up to the total the
     screen says so and offers the existing Mark paid, dated the last part. */

  /* every unpaid invoice that has parts recorded, for the list chips */
  if (path === "/docs/part-payments" && method === "GET") {
    if (!canReadDocs(user)) return err("forbidden", "Sales access required", 403);
    try {
      const { results } = await env.DB.prepare(
        `SELECT p.invoice_id, COALESCE(SUM(p.amount_cents), 0) AS received_cents, COUNT(*) AS parts,
                MAX(p.received_on) AS last_received_on
           FROM invoice_payments p JOIN sales_documents d ON d.id = p.invoice_id
          WHERE p.voided_at IS NULL AND d.doc_type = 'INV'
          GROUP BY p.invoice_id`,
      ).all<{ invoice_id: number; received_cents: number; parts: number; last_received_on: string }>();
      return json({ invoices: results ?? [] });
    } catch (e) {
      if (skew(e)) return json({ invoices: [], pending_migration: true });
      throw e;
    }
  }

  const mPay = path.match(/^\/docs\/(\d+)\/payments$/);
  if (mPay) {
    const invId = Number(mPay[1]);
    if (method === "GET") {
      if (!canReadDocs(user)) return err("forbidden", "Sales access required", 403);
      const inv = await env.DB.prepare(
        `SELECT id, doc_number, total_cents, payment_status, paid_at, created_at FROM sales_documents WHERE id = ?1 AND doc_type = 'INV'`,
      ).bind(invId).first<{ id: number; doc_number: string; total_cents: number; payment_status: string | null; paid_at: string | null; created_at: string }>();
      if (!inv) return err("not_found", "Invoice not found", 404);
      try {
        const { results } = await env.DB.prepare(
          `SELECT p.id, p.amount_cents, p.received_on, p.method, p.reference, p.note, p.created_at,
                  p.voided_at, p.void_reason,
                  COALESCE(NULLIF(TRIM(u.full_name), ''), u.name) AS recorded_by,
                  COALESCE(NULLIF(TRIM(v.full_name), ''), v.name) AS voided_by_name
             FROM invoice_payments p
             LEFT JOIN users u ON u.id = p.created_by
             LEFT JOIN users v ON v.id = p.voided_by
            WHERE p.invoice_id = ?1
            ORDER BY p.received_on, p.id`,
        ).bind(invId).all<{ amount_cents: number; voided_at: string | null }>();
        const received = (results ?? []).filter((p) => !p.voided_at).reduce((a, p) => a + p.amount_cents, 0);
        return json({
          invoice: inv, payments: results ?? [],
          received_cents: received, balance_cents: Math.max(0, inv.total_cents - received),
          can_record: canInvoiceMoney(user),
        });
      } catch (e) {
        if (skew(e)) return json({ invoice: inv, payments: [], received_cents: 0, balance_cents: inv.total_cents, can_record: false, pending_migration: true });
        throw e;
      }
    }
    if (method === "POST") {
      if (!canInvoiceMoney(user)) return err("forbidden", "Finance access required", 403);
      const inv = await env.DB.prepare(
        `SELECT id, doc_number, total_cents, payment_status FROM sales_documents WHERE id = ?1 AND doc_type = 'INV'`,
      ).bind(invId).first<{ id: number; doc_number: string; total_cents: number; payment_status: string | null }>();
      if (!inv) return err("not_found", "Invoice not found", 404);
      if (inv.payment_status === "paid") {
        return err("invalid_input", `${inv.doc_number} is already marked paid - there is nothing left to receive on it.`, 400);
      }
      if (inv.payment_status === "void") return err("voided", `${inv.doc_number} is void - no payment can be recorded on it.`, 409); // v1.242.0 (B2)
      const amount = num(body?.amount_cents);
      if (amount === null || !Number.isInteger(amount) || amount <= 0) {
        return err("invalid_input", "Enter the amount received, more than RM 0.00.", 400);
      }
      const on = body?.received_on;
      if (!validDay(on) || on > mytToday()) {
        return err("invalid_input", "The day the money was received must be a real date, today or earlier.", 400);
      }
      try {
        const got = await env.DB.prepare(
          `SELECT COALESCE(SUM(amount_cents), 0) AS c FROM invoice_payments WHERE invoice_id = ?1 AND voided_at IS NULL`,
        ).bind(invId).first<{ c: number }>();
        const left = inv.total_cents - (got?.c ?? 0);
        if (amount > left) {
          return err("invalid_input",
            `That is more than is left on ${inv.doc_number}: RM ${(left / 100).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} remains. An overpayment is not a part payment.`, 400);
        }
        /* v1.242.0 (go-live audit B3) - the read above is the friendly
           message; the WRITE is the rule. ONE conditional insert: the row
           lands only if, at that instant, the live parts plus this amount
           still fit the total - so two part payments recorded in the same
           second can never collect more than the invoice. */
        const res = await env.DB.prepare(
          `INSERT INTO invoice_payments (invoice_id, amount_cents, received_on, method, reference, note, created_by)
           SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7
            WHERE (SELECT total_cents FROM sales_documents WHERE id = ?1)
                  - COALESCE((SELECT SUM(amount_cents) FROM invoice_payments WHERE invoice_id = ?1 AND voided_at IS NULL), 0) >= ?2
           RETURNING id`,
        ).bind(
          invId, amount, on,
          str(body?.method, 40) ? String(body!.method).trim() : "bank_transfer",
          str(body?.reference, 120) ? String(body!.reference).trim() : null,
          str(body?.note, 300) ? String(body!.note).trim() : null,
          user.id,
        ).first<{ id: number }>();
        if (!res?.id) {
          return err("invalid_input", `Another payment was recorded on ${inv.doc_number} at the same moment, and together they would exceed its total. Nothing was recorded - check the invoice and try again.`, 400);
        }
        await audit(env, user.id, "invoice.part_payment", "invoice_payments", String(res?.id), {
          invoice: inv.doc_number, amount_cents: amount, received_on: on, balance_cents: left - amount,
        });
        return json({ ok: true, id: res?.id, balance_cents: left - amount }, 201);
      } catch (e) {
        if (skew(e)) return err("migration_missing", "Run: npx wrangler d1 migrations apply azoneofficial --remote (0140_part_payments)", 500);
        throw e;
      }
    }
  }

  const mVoid = path.match(/^\/docs\/(\d+)\/payments\/(\d+)\/void$/);
  if (mVoid && method === "POST") {
    if (!canInvoiceMoney(user)) return err("forbidden", "Finance access required", 403);
    const reason = str(body?.reason, 300) ? String(body!.reason).trim() : "";
    if (reason.length < 3) return err("invalid_input", "Say why this part payment is being voided.", 400);
    try {
      const row = await env.DB.prepare(
        `SELECT p.id, p.amount_cents, p.voided_at, d.doc_number FROM invoice_payments p
           JOIN sales_documents d ON d.id = p.invoice_id
          WHERE p.id = ?1 AND p.invoice_id = ?2`,
      ).bind(Number(mVoid[2]), Number(mVoid[1])).first<{ id: number; amount_cents: number; voided_at: string | null; doc_number: string }>();
      if (!row) return err("not_found", "Part payment not found", 404);
      if (row.voided_at) return err("invalid_input", "That part payment is already voided.", 400);
      await env.DB.prepare(
        `UPDATE invoice_payments SET voided_at = datetime('now'), voided_by = ?2, void_reason = ?3 WHERE id = ?1 AND voided_at IS NULL`,
      ).bind(row.id, user.id, reason).run();
      await audit(env, user.id, "invoice.part_payment_void", "invoice_payments", String(row.id), {
        invoice: row.doc_number, amount_cents: row.amount_cents, reason,
      });
      return json({ ok: true });
    } catch (e) {
      if (skew(e)) return err("migration_missing", "Run: npx wrangler d1 migrations apply azoneofficial --remote (0140_part_payments)", 500);
      throw e;
    }
  }

  /* ════════════════════════════════════════════════════════════════════
     PHASE 1 (v1.181.13) - THE CUSTOMER TIMELINE
     ════════════════════════════════════════════════════════════════════
     One client's story in date order, newest first: every document and its
     revisions, payments, receipts, credit notes, and - for the roles whose
     own screens show them - enquiries, engagements and live sessions. A
     pure read. Each source is asked separately and a source a role may not
     open is not asked at all, so the response says what was left out
     (`hidden`) rather than pretending there was nothing. */
  const mTl = path.match(/^\/customers\/(\d+)\/timeline$/);
  if (mTl && method === "GET") {
    if (!canReadDocs(user)) return err("forbidden", "Sales access required", 403);
    const cid = Number(mTl[1]);
    const c = await env.DB.prepare(`SELECT id, company, contact_person, phone, email FROM customers WHERE id = ?1`)
      .bind(cid).first<{ id: number; company: string; contact_person: string | null; phone: string | null; email: string | null }>();
    if (!c) return err("not_found", "Customer not found", 404);

    type Ev = { at: string; kind: string; title: string; detail?: string | null; amount_cents?: number | null; doc_id?: number | null; tab?: string };
    const out: Ev[] = [];
    const hidden: string[] = [];
    const run = async <T>(sql: string, ...b: unknown[]): Promise<T[]> => {
      try { return ((await env.DB.prepare(sql).bind(...b).all<T>()).results ?? []) as T[]; }
      catch (e) { if (skew(e)) return []; throw e; }
    };
    const KIND_WORD: Record<string, string> = { QT: "Quotation", DO: "Delivery order", INV: "Invoice" };

    /* documents - Sales */
    const docs = await run<{ id: number; doc_type: string; doc_number: string; total_cents: number; created_at: string; payment_status: string | null; paid_at: string | null; delivery_status: string | null }>(
      `SELECT id, doc_type, doc_number, total_cents, created_at, payment_status, paid_at, delivery_status
         FROM sales_documents WHERE customer_id = ?1 ORDER BY id DESC LIMIT 300`, cid);
    for (const d of docs) {
      out.push({ at: utcToMyt(d.created_at) ?? d.created_at, kind: `doc_${d.doc_type.toLowerCase()}`, doc_id: d.id, tab: "Sales",
        title: `${KIND_WORD[d.doc_type] ?? d.doc_type} ${d.doc_number}`, amount_cents: d.total_cents,
        detail: d.doc_type === "INV" ? (d.payment_status === "paid" ? "paid" : "unpaid") : d.doc_type === "DO" ? (d.delivery_status ?? "pending") : null });
      if (d.doc_type === "INV" && d.payment_status === "paid" && d.paid_at) {
        out.push({ at: utcToMyt(d.paid_at) ?? d.paid_at, kind: "paid", doc_id: d.id, tab: "Sales",
          title: `${d.doc_number} marked paid`, amount_cents: d.total_cents });
      }
    }
    /* revisions of those quotations (0139) */
    for (const r of await run<{ doc_id: number; revision: number; replaced_at: string; doc_number: string; total_cents: number }>(
      `SELECT r.doc_id, r.revision, r.replaced_at, d.doc_number, d.total_cents
         FROM sales_document_revisions r JOIN sales_documents d ON d.id = r.doc_id
        WHERE d.customer_id = ?1 ORDER BY r.id DESC LIMIT 200`, cid)) {
      out.push({ at: utcToMyt(r.replaced_at) ?? r.replaced_at, kind: "revision", doc_id: r.doc_id, tab: "Sales",
        title: `${r.doc_number} revised to REV ${r.revision + 1}`, detail: `REV ${r.revision === 0 ? "original" : r.revision} kept in History` });
    }
    /* part payments (0140) */
    for (const p of await run<{ invoice_id: number; amount_cents: number; received_on: string; reference: string | null; doc_number: string }>(
      `SELECT p.invoice_id, p.amount_cents, p.received_on, p.reference, d.doc_number
         FROM invoice_payments p JOIN sales_documents d ON d.id = p.invoice_id
        WHERE d.customer_id = ?1 AND p.voided_at IS NULL ORDER BY p.id DESC LIMIT 200`, cid)) {
      out.push({ at: p.received_on, kind: "part_payment", doc_id: p.invoice_id, tab: "Sales",
        title: `Part payment on ${p.doc_number}`, amount_cents: p.amount_cents, detail: p.reference });
    }
    /* receipts and credit notes (0069) */
    for (const r of await run<{ receipt_number: string; invoice_number: string; amount_cents: number; created_at: string }>(
      `SELECT receipt_number, invoice_number, amount_cents, created_at FROM receipts WHERE customer_id = ?1 ORDER BY id DESC LIMIT 200`, cid)) {
      out.push({ at: utcToMyt(r.created_at) ?? r.created_at, kind: "receipt", tab: "Sales",
        title: `Receipt ${r.receipt_number} for ${r.invoice_number}`, amount_cents: r.amount_cents });
    }
    for (const n of await run<{ cn_number: string; invoice_number: string; amount_cents: number; reason: string | null; created_at: string }>(
      `SELECT cn_number, invoice_number, amount_cents, reason, created_at FROM credit_notes WHERE customer_id = ?1 ORDER BY id DESC LIMIT 200`, cid)) {
      out.push({ at: utcToMyt(n.created_at) ?? n.created_at, kind: "credit_note", tab: "Sales",
        title: `Credit note ${n.cn_number} on ${n.invoice_number}`, amount_cents: n.amount_cents, detail: n.reason });
    }
    /* live sessions - the management that schedules them */
    if (LIVE_MGR.includes(user.role)) {
      for (const s of await run<{ session_date: string; start_time: string | null; end_time: string | null; status: string | null; host: string | null }>(
        `SELECT s.session_date, s.start_time, s.end_time, s.status, COALESCE(NULLIF(TRIM(u.full_name), ''), u.name) AS host
           FROM live_sessions s LEFT JOIN users u ON u.id = s.host_user_id
          WHERE s.client_id = ?1 ORDER BY s.session_date DESC LIMIT 200`, cid)) {
        out.push({ at: `${s.session_date} ${s.start_time ?? "00:00"}`, kind: "live", tab: "Ecommerce",
          title: `Live session${s.host ? ` with ${s.host}` : ""}`, detail: [s.start_time && s.end_time ? `${s.start_time}-${s.end_time}` : null, s.status].filter(Boolean).join(" · ") || null });
      }
    } else hidden.push("live_sessions");
    /* enquiries - the business team; matched by phone or company name,
       because an enquiry is typed by the public and carries no customer id */
    if (can(user.role, "enquiry_manage")) {
      const digits = (c.phone ?? "").replace(/\D/g, "").slice(-9);
      for (const q of await run<{ name: string; company: string | null; message: string; status: string; created_at: string }>(
        `SELECT name, company, message, status, created_at FROM enquiries
          WHERE (?1 != '' AND LENGTH(REPLACE(REPLACE(REPLACE(COALESCE(phone, ''), ' ', ''), '-', ''), '+', '')) >= 9
                 AND SUBSTR(REPLACE(REPLACE(REPLACE(COALESCE(phone, ''), ' ', ''), '-', ''), '+', ''), -9) = ?1)
             OR (LOWER(TRIM(COALESCE(company, ''))) != '' AND LOWER(TRIM(company)) = LOWER(TRIM(?2)))
          ORDER BY id DESC LIMIT 100`, digits, c.company)) {
        out.push({ at: utcToMyt(q.created_at) ?? q.created_at, kind: "enquiry", tab: "Enquiries",
          title: `Enquiry from ${q.name}`, detail: `${q.status} · ${q.message.slice(0, 120)}` });
      }
    } else hidden.push("enquiries");
    /* engagements - Sales Performance: a manager sees all, a seller their own */
    if (can(user.role, "sales_perf_manage") || can(user.role, "sales_perf_view")) {
      const mine = !can(user.role, "sales_perf_manage");
      for (const g of await run<{ happened_at: string; channel: string | null; interaction: string | null; outcome: string | null; status: string | null; staff: string | null }>(
        `SELECT e.happened_at, e.channel, e.interaction_type AS interaction, e.outcome, e.status, COALESCE(NULLIF(TRIM(u.full_name), ''), u.name) AS staff
           FROM sp_engagements e LEFT JOIN users u ON u.id = e.user_id
          WHERE e.customer_id = ?1 AND e.deleted_at IS NULL ${mine ? "AND e.user_id = ?2" : ""}
          ORDER BY e.id DESC LIMIT 200`, ...(mine ? [cid, user.id] : [cid]))) {
        out.push({ at: utcToMyt(g.happened_at) ?? g.happened_at, kind: "engagement", tab: "Sales Performance",
          title: `${g.staff ?? "Staff"}: ${[g.channel, g.interaction].filter(Boolean).join(" · ") || "engagement"}`,
          detail: [g.outcome, g.status].filter(Boolean).join(" · ") || null });
      }
    } else hidden.push("engagements");

    /* v1.181.16 (phase 4): follow-ups and what the customer accepted on a
       shared link (0143) - Sales, like the documents they sit beside */
    for (const f of await run<{ due_on: string; note: string; done_at: string | null; done_note: string | null; cancelled_at: string | null; owner: string | null }>(
      `SELECT f.due_on, f.note, f.done_at, f.done_note, f.cancelled_at, COALESCE(NULLIF(TRIM(u.full_name), ''), u.name) AS owner
         FROM customer_followups f LEFT JOIN users u ON u.id = f.owner_id WHERE f.customer_id = ?1 ORDER BY f.id DESC LIMIT 100`, cid)) {
      out.push({ at: f.done_at ? (utcToMyt(f.done_at) ?? f.done_at) : f.due_on, kind: "followup", tab: "Sales",
        title: `Follow-up${f.owner ? ` by ${f.owner}` : ""}: ${f.note}`,
        detail: f.done_at ? `done${f.done_note ? ` · ${f.done_note}` : ""}` : f.cancelled_at ? "cancelled" : `due ${f.due_on}` });
    }
    for (const q of await run<{ doc_id: number; doc_number: string; revision: number; accepted_name: string; accepted_position: string | null; accepted_at: string }>(
      `SELECT a.doc_id, d.doc_number, a.revision, a.accepted_name, a.accepted_position, a.accepted_at
         FROM quotation_acceptances a JOIN sales_documents d ON d.id = a.doc_id WHERE d.customer_id = ?1 ORDER BY a.id DESC LIMIT 100`, cid)) {
      out.push({ at: utcToMyt(q.accepted_at) ?? q.accepted_at, kind: "accepted", doc_id: q.doc_id, tab: "Sales",
        title: `${q.doc_number}${q.revision ? ` REV ${q.revision}` : ""} accepted on the shared link`,
        detail: [q.accepted_name, q.accepted_position].filter(Boolean).join(", ") });
    }

    out.sort((a, b) => b.at.localeCompare(a.at));
    return json({ customer: c, events: out.slice(0, 400), hidden });
  }

  /* ════════════════════════════════════════════════════════════════════
     PHASE 2 (v1.181.14) - RECEIVING STOCK
     ════════════════════════════════════════════════════════════════════
     The owner, 20-10-2026: Purchasing stays retired; stock comes in through
     a Receive stock form on Inventory. This phase and phase 3's stock take
     are the only routes here that write to an existing table, and they
     write nothing a manual stock in or out does not already write: each line raises inventory_items.stock and logs a
     manual_stockouts row (direction 'in', purpose 'restock') - the same
     trail, the same status rule, the same low-stock reset as POST
     /inventory/:id/adjust. Two things are new and both are opt-in: the
     unit cost may move to the moving average (a box on the form, ticked by
     default), and the receipt may record a supplier bill with a due date.
     Neither writes an expense, a cash entry or a journal line, so the
     profit and loss and the cash book read exactly as before. */

  if (path === "/inventory/receipts" && method === "GET") {
    if (!can(user.role, "inventory")) return err("forbidden", "Inventory access required", 403);
    try {
      const { results } = await env.DB.prepare(
        `SELECT r.id, r.supplier, r.received_on, r.reference, r.note, r.total_cents, r.bill_due_on, r.bill_paid_on,
                r.created_at, r.voided_at, r.void_reason,
                COALESCE(NULLIF(TRIM(u.full_name), ''), u.name) AS received_by,
                (SELECT COUNT(*) FROM stock_receipt_lines l WHERE l.receipt_id = r.id) AS lines
           FROM stock_receipts r LEFT JOIN users u ON u.id = r.created_by
          ORDER BY r.received_on DESC, r.id DESC LIMIT 100`,
      ).all();
      const { results: reorder } = await env.DB.prepare(
        `SELECT id, sku, name, stock, reorder_level, reorder_qty, unit_cost_cents FROM inventory_items
          WHERE reorder_level IS NOT NULL AND stock <= reorder_level AND COALESCE(status, '') != 'discontinued'
          ORDER BY stock - reorder_level ASC, sku LIMIT 200`,
      ).all();
      const { results: levels } = await env.DB.prepare(
        `SELECT id, sku, name, stock, reorder_level, reorder_qty FROM inventory_items WHERE reorder_level IS NOT NULL ORDER BY sku`,
      ).all();
      const { results: suppliers } = await env.DB.prepare(
        `SELECT supplier, MAX(received_on) AS last_on FROM stock_receipts WHERE voided_at IS NULL GROUP BY LOWER(supplier) ORDER BY last_on DESC LIMIT 50`,
      ).all();
      return json({ receipts: results ?? [], reorder: reorder ?? [], levels: levels ?? [], suppliers: (suppliers ?? []).map((x) => (x as { supplier: string }).supplier), can_write: true });
    } catch (e) {
      if (skew(e)) return json({ receipts: [], reorder: [], levels: [], suppliers: [], can_write: false, pending_migration: true });
      throw e;
    }
  }

  const mRcv = path.match(/^\/inventory\/receipts\/(\d+)$/);
  if (mRcv && method === "GET") {
    if (!can(user.role, "inventory")) return err("forbidden", "Inventory access required", 403);
    const { results } = await env.DB.prepare(
      `SELECT id, item_id, sku, item_name, qty, unit_cost_cents, stock_before, stock_after, cost_before_cents, cost_after_cents
         FROM stock_receipt_lines WHERE receipt_id = ?1 ORDER BY id`,
    ).bind(Number(mRcv[1])).all();
    return json({ lines: results ?? [] });
  }

  if (path === "/inventory/receipts" && method === "POST") {
    if (!can(user.role, "inventory")) return err("forbidden", "Inventory access required", 403);
    const supplier = str(body?.supplier, 120) ? String(body!.supplier).trim() : "";
    if (supplier.length < 2) return err("invalid_input", "Who supplied it? Enter the supplier's name.", 400);
    const on = body?.received_on;
    if (!validDay(on) || on > mytToday()) return err("invalid_input", "The day the stock arrived must be a real date, today or earlier.", 400);
    const due = body?.bill_due_on;
    if (due !== undefined && due !== null && due !== "" && !validDay(due)) return err("invalid_input", "The bill's due date is not a real date.", 400);
    const updateCost = body?.update_cost !== false;
    const raw = Array.isArray(body?.lines) ? (body!.lines as Record<string, unknown>[]) : [];
    if (raw.length === 0 || raw.length > 30) return err("invalid_input", "A receipt has 1 to 30 lines.", 400);
    const lines: { item_id: number; qty: number; unit_cost_cents: number }[] = [];
    for (const [i, l] of raw.entries()) {
      const itemId = num(l.item_id), qty = num(l.qty), cost = num(l.unit_cost_cents);
      if (itemId === null || !Number.isInteger(itemId)) return err("invalid_input", `Line ${i + 1}: pick the item.`, 400);
      if (qty === null || !Number.isInteger(qty) || qty <= 0 || qty > 100000) return err("invalid_input", `Line ${i + 1}: the quantity must be a whole number from 1.`, 400);
      if (cost === null || !Number.isInteger(cost) || cost < 0 || cost > 1_000_000_000) return err("invalid_input", `Line ${i + 1}: the unit cost must be RM 0.00 or more.`, 400);
      if (lines.some((x) => x.item_id === itemId)) return err("invalid_input", `Line ${i + 1}: that item is already on this receipt - add the quantities together.`, 400);
      lines.push({ item_id: itemId, qty, unit_cost_cents: cost });
    }
    try {
      const items = new Map<number, { id: number; sku: string; name: string; stock: number; unit_cost_cents: number | null }>();
      for (const l of lines) {
        const it = await env.DB.prepare(`SELECT id, sku, name, stock, unit_cost_cents FROM inventory_items WHERE id = ?1`)
          .bind(l.item_id).first<{ id: number; sku: string; name: string; stock: number; unit_cost_cents: number | null }>();
        if (!it) return err("not_found", `No inventory item ${l.item_id}`, 404);
        items.set(l.item_id, it);
      }
      const total = lines.reduce((a, l) => a + l.qty * l.unit_cost_cents, 0);
      const head = await env.DB.prepare(
        `INSERT INTO stock_receipts (supplier, received_on, reference, note, total_cents, bill_due_on, created_by)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) RETURNING id`,
      ).bind(supplier, on,
        str(body?.reference, 120) ? String(body!.reference).trim() : null,
        str(body?.note, 300) ? String(body!.note).trim() : null,
        total, validDay(due) ? due : null, user.id,
      ).first<{ id: number }>();
      const rid = head!.id;
      const grn = `GRN-${String(rid).padStart(5, "0")}`;
      const stmts: D1PreparedStatement[] = [];
      for (const l of lines) {
        const it = items.get(l.item_id)!;
        const before = it.stock;
        const after = before + l.qty;
        const costBefore = it.unit_cost_cents;
        /* the moving average: what the shelf held, at what it cost, plus
           what arrived, at what it cost. A shelf that was empty or never
           costed simply takes the new cost. A zero-cost line (a free
           sample) never drags the average down - it moves stock only. */
        const costAfter = !updateCost || l.unit_cost_cents <= 0 ? costBefore
          : (costBefore === null || costBefore <= 0 || before <= 0) ? l.unit_cost_cents
            : Math.round((before * costBefore + l.qty * l.unit_cost_cents) / (before + l.qty));
        stmts.push(env.DB.prepare(
          `INSERT INTO stock_receipt_lines (receipt_id, item_id, sku, item_name, qty, unit_cost_cents, stock_before, stock_after, cost_before_cents, cost_after_cents)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
        ).bind(rid, it.id, it.sku, it.name, l.qty, l.unit_cost_cents, before, after, costBefore, costAfter));
        /* stock moves RELATIVELY (another movement may land between the read
           and this write); the status rule is staff.ts stockStatus(), word
           for word; low_alerted resets above 5 exactly as checkLowStock does */
        stmts.push(env.DB.prepare(
          `UPDATE inventory_items SET stock = stock + ?1,
                  status = CASE WHEN stock + ?1 = 0 THEN 'out_of_stock' WHEN stock + ?1 <= 5 THEN 'low' ELSE 'in_stock' END,
                  low_alerted = CASE WHEN stock + ?1 > 5 THEN NULL ELSE low_alerted END,
                  unit_cost_cents = ?2, updated_by = ?3, updated_at = datetime('now')
            WHERE id = ?4`,
        ).bind(l.qty, costAfter, user.id, it.id));
        stmts.push(env.DB.prepare(
          `INSERT INTO manual_stockouts (item_id, sku, item_name, qty, unit_sale_cents, remark, out_date, created_by, direction, purpose)
           VALUES (?1, ?2, ?3, ?4, NULL, ?5, ?6, ?7, 'in', 'restock')`,
        ).bind(it.id, it.sku, it.name, l.qty, `${grn} received from ${supplier}${str(body?.reference, 120) ? ` (${String(body!.reference).trim()})` : ""}`, on, user.id));
      }
      try {
        await env.DB.batch(stmts);
      } catch (e) {
        /* all or nothing: the lines did not land, so neither does the head */
        await env.DB.prepare(`DELETE FROM stock_receipts WHERE id = ?1`).bind(rid).run();
        throw e;
      }
      await audit(env, user.id, "inventory.receive", "stock_receipts", String(rid), {
        grn, supplier, lines: lines.length, total_cents: total, update_cost: updateCost, bill_due_on: validDay(due) ? due : null,
      });
      return json({ ok: true, id: rid, grn, total_cents: total }, 201);
    } catch (e) {
      if (skew(e)) return err("migration_missing", "Run: npx wrangler d1 migrations apply azoneofficial --remote (0141_stock_receipts)", 500);
      throw e;
    }
  }

  const mRcvVoid = path.match(/^\/inventory\/receipts\/(\d+)\/void$/);
  if (mRcvVoid && method === "POST") {
    if (!can(user.role, "inventory")) return err("forbidden", "Inventory access required", 403);
    const reason = str(body?.reason, 300) ? String(body!.reason).trim() : "";
    if (reason.length < 3) return err("invalid_input", "Say why this receipt is being voided.", 400);
    const rid = Number(mRcvVoid[1]);
    try {
      const head = await env.DB.prepare(`SELECT id, supplier, voided_at FROM stock_receipts WHERE id = ?1`)
        .bind(rid).first<{ id: number; supplier: string; voided_at: string | null }>();
      if (!head) return err("not_found", "Receipt not found", 404);
      if (head.voided_at) return err("invalid_input", "That receipt is already voided.", 400);
      const { results: ls } = await env.DB.prepare(
        `SELECT l.item_id, l.qty, l.cost_before_cents, l.cost_after_cents, i.stock, i.sku, i.name, i.unit_cost_cents,
                (SELECT COUNT(*) FROM stock_receipt_lines l2 JOIN stock_receipts r2 ON r2.id = l2.receipt_id
                  WHERE l2.item_id = l.item_id AND l2.receipt_id > l.receipt_id AND r2.voided_at IS NULL) AS later
           FROM stock_receipt_lines l JOIN inventory_items i ON i.id = l.item_id
          WHERE l.receipt_id = ?1`,
      ).bind(rid).all<{ item_id: number; qty: number; cost_before_cents: number | null; cost_after_cents: number | null; stock: number; sku: string; name: string; unit_cost_cents: number | null; later: number }>();
      /* stock that has already left cannot be un-received: say which line */
      const short = (ls ?? []).find((l) => l.stock < l.qty);
      if (short) {
        return err("insufficient_stock", `${short.sku} ${short.name}: only ${short.stock} on the shelf, the receipt brought ${short.qty}. Record the difference as a manual stock out instead.`, 409);
      }
      const grn = `GRN-${String(rid).padStart(5, "0")}`;
      const stmts: D1PreparedStatement[] = [];
      for (const l of ls ?? []) {
        /* the cost goes back only when this receipt is still the last one
           to have set it - a later receipt has already averaged over it */
        const restoreCost = l.later === 0 && l.unit_cost_cents === l.cost_after_cents;
        stmts.push(env.DB.prepare(
          `UPDATE inventory_items SET stock = stock - ?1,
                  status = CASE WHEN stock - ?1 = 0 THEN 'out_of_stock' WHEN stock - ?1 <= 5 THEN 'low' ELSE 'in_stock' END,
                  unit_cost_cents = CASE WHEN ?2 = 1 THEN ?3 ELSE unit_cost_cents END,
                  updated_by = ?4, updated_at = datetime('now')
            WHERE id = ?5`,
        ).bind(l.qty, restoreCost ? 1 : 0, l.cost_before_cents, user.id, l.item_id));
        stmts.push(env.DB.prepare(
          `INSERT INTO manual_stockouts (item_id, sku, item_name, qty, unit_sale_cents, remark, out_date, created_by, direction, purpose)
           VALUES (?1, ?2, ?3, ?4, NULL, ?5, ?6, ?7, 'out', 'correction')`,
        ).bind(l.item_id, l.sku, l.name, l.qty, `${grn} voided: ${reason}`, mytToday(), user.id));
      }
      stmts.push(env.DB.prepare(
        `UPDATE stock_receipts SET voided_at = datetime('now'), voided_by = ?2, void_reason = ?3 WHERE id = ?1 AND voided_at IS NULL`,
      ).bind(rid, user.id, reason));
      await env.DB.batch(stmts);
      await audit(env, user.id, "inventory.receive_void", "stock_receipts", String(rid), { grn, reason });
      return json({ ok: true });
    } catch (e) {
      if (skew(e)) return err("migration_missing", "Run: npx wrangler d1 migrations apply azoneofficial --remote (0141_stock_receipts)", 500);
      throw e;
    }
  }

  const mBill = path.match(/^\/inventory\/receipts\/(\d+)\/bill$/);
  if (mBill && method === "POST") {
    if (!can(user.role, "inventory")) return err("forbidden", "Inventory access required", 403);
    const paidOn = body?.paid_on;
    if (paidOn !== null && (!validDay(paidOn) || paidOn > mytToday())) {
      return err("invalid_input", "The day the supplier was paid must be a real date, today or earlier (or null to undo).", 400);
    }
    try {
      const r = await env.DB.prepare(
        `UPDATE stock_receipts SET bill_paid_on = ?2 WHERE id = ?1 AND voided_at IS NULL AND bill_due_on IS NOT NULL`,
      ).bind(Number(mBill[1]), paidOn).run();
      if (!r.meta?.changes) return err("invalid_input", "That receipt has no supplier bill, or is voided.", 400);
      await audit(env, user.id, paidOn ? "inventory.bill_paid" : "inventory.bill_unpaid", "stock_receipts", mBill[1], { paid_on: paidOn });
      return json({ ok: true });
    } catch (e) {
      if (skew(e)) return err("migration_missing", "Run: npx wrangler d1 migrations apply azoneofficial --remote (0141_stock_receipts)", 500);
      throw e;
    }
  }

  /* a reorder level per item - optional; empty = the portal as it always was */
  const mReo = path.match(/^\/inventory\/(\d+)\/reorder$/);
  if (mReo && method === "PUT") {
    if (!can(user.role, "inventory")) return err("forbidden", "Inventory access required", 403);
    const lvl = body?.reorder_level === null ? null : num(body?.reorder_level);
    const qty = body?.reorder_qty === null || body?.reorder_qty === undefined ? null : num(body?.reorder_qty);
    if (lvl !== null && (!Number.isInteger(lvl) || lvl < 0 || lvl > 100000)) return err("invalid_input", "The reorder level must be a whole number from 0, or empty.", 400);
    if (qty !== null && (!Number.isInteger(qty) || qty <= 0 || qty > 100000)) return err("invalid_input", "The reorder quantity must be a whole number from 1, or empty.", 400);
    try {
      const r = await env.DB.prepare(`UPDATE inventory_items SET reorder_level = ?2, reorder_qty = ?3, updated_by = ?4, updated_at = datetime('now') WHERE id = ?1`)
        .bind(Number(mReo[1]), lvl, lvl === null ? null : qty, user.id).run();
      if (!r.meta?.changes) return err("not_found", "Item not found", 404);
      await audit(env, user.id, "inventory.reorder_level", "inventory_items", mReo[1], { reorder_level: lvl, reorder_qty: qty });
      return json({ ok: true });
    } catch (e) {
      if (skew(e)) return err("migration_missing", "Run: npx wrangler d1 migrations apply azoneofficial --remote (0141_stock_receipts)", 500);
      throw e;
    }
  }

  /* ════════════════════════════════════════════════════════════════════
     PHASE 3 (v1.181.15) - THE BOOKS
     ════════════════════════════════════════════════════════════════════
     Month close, position, audit trail: READS, plus a snapshot table. A
     closed month records its figures as they stood; nothing is locked, so
     no existing screen, save or release behaves any differently. What a
     close buys is the question an accountant asks first: "has anything
     dated in that month changed since you closed it?" - answered by
     recomputing the same figures and showing the difference.
     Gate: accounting_manage, the Accounting tab's own permission. The
     audit trail is narrower still: the CEO and super_admin, because it
     carries every payroll, leave and claim decision in the company. */

  const BOOKS = can(user.role, "accounting_manage");
  const AUDIT_READERS = ["super_admin", "ceo"];
  const validMonth = (m: unknown): m is string => typeof m === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(m);
  const thisMonth = () => mytToday().slice(0, 7);

  /* one month's figures - every one already defined by an existing screen */
  const monthFigures = async (m: string) => {
    const one = async (sql: string, ...b: unknown[]) => {
      try { return Number((await env.DB.prepare(sql).bind(...b).first<{ c: number }>())?.c ?? 0); }
      catch (e) { if (skew(e)) return 0; throw e; }
    };
    return {
      /* invoices raised in the month (Sales: Invoiced) */
      invoiced_cents: await one(`SELECT COALESCE(SUM(total_cents), 0) AS c FROM sales_documents WHERE doc_type = 'INV' AND COALESCE(payment_status, '') != 'void' AND strftime('%Y-%m', created_at, '+8 hours') = ?1`, m),
      /* money received: invoices marked paid, by payment date (/revenue) */
      received_cents: await one(`SELECT COALESCE(SUM(total_cents), 0) AS c FROM sales_documents WHERE doc_type = 'INV' AND payment_status = 'paid' AND strftime('%Y-%m', COALESCE(paid_at, created_at), '+8 hours') = ?1`, m),
      /* part payments received in the month (phase 1) - not revenue */
      part_payments_cents: await one(`SELECT COALESCE(SUM(amount_cents), 0) AS c FROM invoice_payments WHERE voided_at IS NULL AND substr(received_on, 1, 7) = ?1`, m),
      /* expenses by expense date (Finance) */
      expenses_cents: await one(`SELECT COALESCE(SUM(amount_cents), 0) AS c FROM expenses WHERE strftime('%Y-%m', expense_date) = ?1`, m),
      /* stock received at cost (phase 2) */
      stock_received_cents: await one(`SELECT COALESCE(SUM(total_cents), 0) AS c FROM stock_receipts WHERE voided_at IS NULL AND substr(received_on, 1, 7) = ?1`, m),
      /* payroll net saved for the month (Payroll) */
      payroll_net_cents: await one(`SELECT COALESCE(SUM(net_cents), 0) AS c FROM payroll_entries WHERE month = ?1`, m),
      documents: await one(`SELECT COUNT(*) AS c FROM sales_documents WHERE strftime('%Y-%m', created_at, '+8 hours') = ?1`, m),
      /* v1.222.0 (Accounting 2.0, "Soft control"): the ledger's own month -
         income, expense and entries by the day the money moved - so a close
         also notices a later change in the books (ledger.ts reads only) */
      ...(await glMonthFigures(env, m)),
    };
  };
  type Figures = Awaited<ReturnType<typeof monthFigures>>;

  if (path === "/books/months" && method === "GET") {
    if (!BOOKS) return err("forbidden", "Accounting access required", 403);
    const now = thisMonth();
    const months: string[] = [];
    {
      let y = Number(now.slice(0, 4)), mo = Number(now.slice(5, 7));
      for (let i = 0; i < 6; i++) {
        months.push(`${y}-${String(mo).padStart(2, "0")}`);
        mo -= 1; if (mo === 0) { mo = 12; y -= 1; }
      }
    }
    let closes: { id: number; month: string; figures: string; note: string | null; closed_at: string; closed_by_name: string | null; reopened_at: string | null; reopen_reason: string | null }[] = [];
    try {
      closes = (await env.DB.prepare(
        `SELECT p.id, p.month, p.figures, p.note, p.closed_at, p.reopened_at, p.reopen_reason,
                COALESCE(NULLIF(TRIM(u.full_name), ''), u.name) AS closed_by_name
           FROM period_closes p LEFT JOIN users u ON u.id = p.closed_by
          ORDER BY p.id DESC LIMIT 200`,
      ).all<typeof closes[number]>()).results ?? [];
    } catch (e) { if (!skew(e)) throw e; }
    const out = [];
    for (const m of months) {
      const now_ = await monthFigures(m);
      const active = closes.find((c) => c.month === m && !c.reopened_at) ?? null;
      let changed: Partial<Record<keyof Figures, number>> | null = null;
      if (active) {
        let snap: Partial<Figures> = {};
        try { snap = JSON.parse(active.figures) as Partial<Figures>; } catch { snap = {}; }
        changed = {};
        for (const k of Object.keys(now_) as (keyof Figures)[]) {
          /* v1.222.0 - a figure the close did not record (a close taken
             before the ledger joined the snapshot) is not a change */
          if (!(k in snap)) continue;
          const was = Number(snap[k] ?? 0);
          if (was !== now_[k]) changed[k] = now_[k] - was;
        }
      }
      out.push({ month: m, figures: now_, closed: active ? { id: active.id, at: active.closed_at, by: active.closed_by_name, note: active.note } : null,
        changed_since_close: changed, history: closes.filter((c) => c.month === m).map((c) => ({ id: c.id, at: c.closed_at, by: c.closed_by_name, reopened_at: c.reopened_at, reopen_reason: c.reopen_reason })) });
    }
    return json({ months: out, current_month: now });
  }

  if (path === "/books/close" && method === "POST") {
    if (!BOOKS) return err("forbidden", "Accounting access required", 403);
    const m = body?.month;
    if (!validMonth(m)) return err("invalid_input", "month (YYYY-MM) is required", 400);
    if (m >= thisMonth()) return err("invalid_input", "Only a month that has ended can be closed.", 400);
    try {
      const open = await env.DB.prepare(`SELECT id FROM period_closes WHERE month = ?1 AND reopened_at IS NULL`).bind(m).first();
      if (open) return err("invalid_input", `${m} is already closed. Reopen it first to close it again.`, 400);
      const figures = await monthFigures(m);
      const r = await env.DB.prepare(`INSERT INTO period_closes (month, figures, note, closed_by) VALUES (?1, ?2, ?3, ?4) RETURNING id`)
        .bind(m, JSON.stringify(figures), str(body?.note, 300) ? String(body!.note).trim() : null, user.id).first<{ id: number }>();
      await audit(env, user.id, "books.close", "period_closes", String(r?.id), { month: m, ...figures });
      return json({ ok: true, id: r?.id, figures }, 201);
    } catch (e) {
      if (skew(e)) return err("migration_missing", "Run: npx wrangler d1 migrations apply azoneofficial --remote (0142_books_stock_take)", 500);
      throw e;
    }
  }

  if (path === "/books/reopen" && method === "POST") {
    if (!BOOKS) return err("forbidden", "Accounting access required", 403);
    const m = body?.month;
    const reason = str(body?.reason, 300) ? String(body!.reason).trim() : "";
    if (!validMonth(m)) return err("invalid_input", "month (YYYY-MM) is required", 400);
    if (reason.length < 3) return err("invalid_input", "Say why the month is being reopened.", 400);
    try {
      const r = await env.DB.prepare(`UPDATE period_closes SET reopened_at = datetime('now'), reopened_by = ?2, reopen_reason = ?3 WHERE month = ?1 AND reopened_at IS NULL`)
        .bind(m, user.id, reason).run();
      if (!r.meta?.changes) return err("invalid_input", `${m} is not closed.`, 400);
      await audit(env, user.id, "books.reopen", "period_closes", m, { reason });
      return json({ ok: true });
    } catch (e) {
      if (skew(e)) return err("migration_missing", "Run: npx wrangler d1 migrations apply azoneofficial --remote (0142_books_stock_take)", 500);
      throw e;
    }
  }

  /* who owes us, whom we owe, what the shelf is worth - as of now */
  if (path === "/books/position" && method === "GET") {
    if (!BOOKS) return err("forbidden", "Accounting access required", 403);
    const run = async <T>(sql: string, ...b: unknown[]): Promise<T[]> => {
      try { return ((await env.DB.prepare(sql).bind(...b).all<T>()).results ?? []) as T[]; }
      catch (e) { if (skew(e)) return []; throw e; }
    };
    /* debtors: the unpaid invoices the aging list shows, less part payments */
    let debtors = await run<{ id: number; doc_number: string; company: string; total_cents: number; created_at: string; due_date: string | null; received_cents: number }>(
      `SELECT d.id, d.doc_number, c.company, d.total_cents, d.created_at, d.due_date,
              COALESCE((SELECT SUM(p.amount_cents) FROM invoice_payments p WHERE p.invoice_id = d.id AND p.voided_at IS NULL), 0) AS received_cents
         FROM sales_documents d LEFT JOIN customers c ON c.id = d.customer_id
        WHERE d.doc_type = 'INV' AND COALESCE(d.payment_status, 'unpaid') NOT IN ('paid', 'void')
        ORDER BY d.created_at ASC LIMIT 300`);
    if (debtors.length === 0) {
      /* a database without 0140 still has debtors - ask without the parts */
      debtors = await run(`SELECT d.id, d.doc_number, c.company, d.total_cents, d.created_at, d.due_date, 0 AS received_cents
         FROM sales_documents d LEFT JOIN customers c ON c.id = d.customer_id
        WHERE d.doc_type = 'INV' AND COALESCE(d.payment_status, 'unpaid') NOT IN ('paid', 'void') ORDER BY d.created_at ASC LIMIT 300`);
    }
    const creditors = await run<{ id: number; supplier: string; received_on: string; bill_due_on: string; total_cents: number }>(
      `SELECT id, supplier, received_on, bill_due_on, total_cents FROM stock_receipts
        WHERE voided_at IS NULL AND bill_due_on IS NOT NULL AND bill_paid_on IS NULL ORDER BY bill_due_on ASC LIMIT 300`);
    const stock = await run<{ category: string | null; items: number; units: number; value_cents: number; uncosted: number }>(
      `SELECT COALESCE(NULLIF(TRIM(category), ''), 'Uncategorised') AS category, COUNT(*) AS items, COALESCE(SUM(stock), 0) AS units,
              COALESCE(SUM(CASE WHEN unit_cost_cents IS NOT NULL THEN stock * unit_cost_cents ELSE 0 END), 0) AS value_cents,
              SUM(CASE WHEN unit_cost_cents IS NULL AND stock > 0 THEN 1 ELSE 0 END) AS uncosted
         FROM inventory_items WHERE stock > 0 AND COALESCE(status, '') != 'discontinued'
        GROUP BY 1 ORDER BY value_cents DESC`);
    const sum = <T>(xs: T[], f: (x: T) => number) => xs.reduce((a, x) => a + f(x), 0);
    return json({
      as_of: mytToday(),
      debtors: debtors.map((d) => ({ ...d, balance_cents: Math.max(0, d.total_cents - d.received_cents) })),
      debtors_cents: sum(debtors, (d) => Math.max(0, d.total_cents - d.received_cents)),
      creditors, creditors_cents: sum(creditors, (c) => c.total_cents),
      stock, stock_value_cents: sum(stock, (s) => s.value_cents), uncosted_items: sum(stock, (s) => s.uncosted),
    });
  }

  /* the audit trail - who did what, when, to which record */
  if (path === "/books/audit" && method === "GET") {
    if (!AUDIT_READERS.includes(user.role)) return err("forbidden", "The audit trail is for the CEO", 403);
    const where: string[] = [];
    const binds: unknown[] = [];
    const uid = Number(params.get("user") ?? 0);
    if (uid > 0) { binds.push(uid); where.push(`a.user_id = ?${binds.length}`); }
    const act = params.get("action") ?? "";
    if (/^[a-z_.]{2,60}$/.test(act)) { binds.push(`${act}%`); where.push(`a.action LIKE ?${binds.length}`); }
    const from = params.get("from"), to = params.get("to");
    if (validDay(from)) { binds.push(from); where.push(`date(a.created_at, '+8 hours') >= ?${binds.length}`); }
    if (validDay(to)) { binds.push(to); where.push(`date(a.created_at, '+8 hours') <= ?${binds.length}`); }
    const q = (params.get("q") ?? "").trim().slice(0, 60);
    if (q) { binds.push(`%${q}%`); where.push(`(a.entity_id LIKE ?${binds.length} OR a.detail LIKE ?${binds.length} OR a.entity LIKE ?${binds.length})`); }
    const before = Number(params.get("before") ?? 0);
    if (before > 0) { binds.push(before); where.push(`a.id < ?${binds.length}`); }
    const { results } = await env.DB.prepare(
      `SELECT a.id, a.action, a.entity, a.entity_id, a.detail, a.created_at, a.user_id,
              COALESCE(NULLIF(TRIM(u.full_name), ''), u.name) AS who
         FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
        ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
        ORDER BY a.id DESC LIMIT 100`,
    ).bind(...binds).all<{ id: number; detail: string | null }>();
    const { results: actions } = await env.DB.prepare(
      `SELECT substr(action, 1, instr(action || '.', '.') - 1) AS area, COUNT(*) AS n FROM audit_log
        WHERE created_at >= datetime('now', '-90 days') GROUP BY area ORDER BY n DESC LIMIT 40`,
    ).all();
    /* the detail is shown as stored, cut to a length a row can carry */
    return json({ rows: (results ?? []).map((r) => ({ ...r, detail: r.detail ? r.detail.slice(0, 600) : null })), areas: actions ?? [] });
  }

  /* ════════════════════════════════════════════════════════════════════
     PHASE 3 (v1.181.15) - STOCK TAKE
     ════════════════════════════════════════════════════════════════════
     Count the shelf against what the portal held when the count began.
     Nothing is locked while a count is open - sales and receipts carry on -
     because the difference is taken against the snapshot, not the live
     figure: a piece sold during the count was on the shelf when the count
     started and is already out of both. Posting applies each difference as
     a RELATIVE move, through the same manual movement log a manual stock in
     or out writes (variance_found / variance_missing), so What moved and
     every report read it the way they read a manual correction. One count
     open at a time. Permission: inventory, like a manual adjustment. */

  if (path === "/stock-counts" && method === "GET") {
    if (!can(user.role, "inventory")) return err("forbidden", "Inventory access required", 403);
    try {
      const { results } = await env.DB.prepare(
        `SELECT s.id, s.category, s.note, s.status, s.started_at, s.posted_at, s.cancelled_at,
                COALESCE(NULLIF(TRIM(u.full_name), ''), u.name) AS started_by_name,
                (SELECT COUNT(*) FROM stock_count_lines l WHERE l.count_id = s.id) AS lines,
                (SELECT COUNT(*) FROM stock_count_lines l WHERE l.count_id = s.id AND l.counted_qty IS NOT NULL) AS counted,
                (SELECT COUNT(*) FROM stock_count_lines l WHERE l.count_id = s.id AND l.counted_qty IS NOT NULL AND l.counted_qty != l.system_qty) AS variances
           FROM stock_counts s LEFT JOIN users u ON u.id = s.started_by
          ORDER BY s.id DESC LIMIT 30`,
      ).all();
      return json({ counts: results ?? [] });
    } catch (e) {
      if (skew(e)) return json({ counts: [], pending_migration: true });
      throw e;
    }
  }

  if (path === "/stock-counts" && method === "POST") {
    if (!can(user.role, "inventory")) return err("forbidden", "Inventory access required", 403);
    try {
      const open = await env.DB.prepare(`SELECT id FROM stock_counts WHERE status = 'open'`).first<{ id: number }>();
      if (open) return err("invalid_input", `Stock take #${open.id} is still open. Post or cancel it first.`, 400);
      const cat = str(body?.category, 80) ? String(body!.category).trim() : null;
      const head = await env.DB.prepare(`INSERT INTO stock_counts (category, note, started_by) VALUES (?1, ?2, ?3) RETURNING id`)
        .bind(cat, str(body?.note, 300) ? String(body!.note).trim() : null, user.id).first<{ id: number }>();
      const r = await env.DB.prepare(
        `INSERT INTO stock_count_lines (count_id, item_id, sku, item_name, system_qty)
         SELECT ?1, id, sku, name, stock FROM inventory_items
          WHERE COALESCE(status, '') != 'discontinued' ${cat ? "AND COALESCE(NULLIF(TRIM(category), ''), 'Uncategorised') = ?2" : ""}`,
      ).bind(...(cat ? [head!.id, cat] : [head!.id])).run();
      if (!r.meta?.changes) {
        await env.DB.prepare(`DELETE FROM stock_counts WHERE id = ?1`).bind(head!.id).run();
        return err("invalid_input", "No items to count in that category.", 400);
      }
      await audit(env, user.id, "inventory.count_start", "stock_counts", String(head!.id), { category: cat, lines: r.meta.changes });
      return json({ ok: true, id: head!.id, lines: r.meta.changes }, 201);
    } catch (e) {
      if (skew(e)) return err("migration_missing", "Run: npx wrangler d1 migrations apply azoneofficial --remote (0142_books_stock_take)", 500);
      throw e;
    }
  }

  const mCnt = path.match(/^\/stock-counts\/(\d+)$/);
  if (mCnt && method === "GET") {
    if (!can(user.role, "inventory")) return err("forbidden", "Inventory access required", 403);
    const head = await env.DB.prepare(`SELECT id, category, note, status, started_at, posted_at FROM stock_counts WHERE id = ?1`).bind(Number(mCnt[1])).first();
    if (!head) return err("not_found", "Stock take not found", 404);
    const { results } = await env.DB.prepare(
      `SELECT l.id, l.item_id, l.sku, l.item_name, l.system_qty, l.counted_qty, l.posted_delta, i.stock AS stock_now, i.unit_cost_cents
         FROM stock_count_lines l LEFT JOIN inventory_items i ON i.id = l.item_id
        WHERE l.count_id = ?1 ORDER BY l.sku`,
    ).bind(Number(mCnt[1])).all();
    return json({ count: head, lines: results ?? [] });
  }

  const mCntLines = path.match(/^\/stock-counts\/(\d+)\/lines$/);
  if (mCntLines && method === "PUT") {
    if (!can(user.role, "inventory")) return err("forbidden", "Inventory access required", 403);
    const cid = Number(mCntLines[1]);
    const head = await env.DB.prepare(`SELECT status FROM stock_counts WHERE id = ?1`).bind(cid).first<{ status: string }>();
    if (!head) return err("not_found", "Stock take not found", 404);
    if (head.status !== "open") return err("invalid_input", "This stock take is closed.", 400);
    const raw = Array.isArray(body?.lines) ? (body!.lines as Record<string, unknown>[]) : [];
    if (raw.length === 0 || raw.length > 2000) return err("invalid_input", "Send 1 to 2000 counted lines.", 400);
    const stmts: D1PreparedStatement[] = [];
    for (const l of raw) {
      const itemId = num(l.item_id);
      const q = l.counted_qty === null ? null : num(l.counted_qty);
      if (itemId === null || (q !== null && (!Number.isInteger(q) || q < 0 || q > 1_000_000))) {
        return err("invalid_input", "A counted quantity is a whole number from 0, or empty.", 400);
      }
      stmts.push(env.DB.prepare(
        `UPDATE stock_count_lines SET counted_qty = ?3, counted_by = ?4, counted_at = datetime('now') WHERE count_id = ?1 AND item_id = ?2`,
      ).bind(cid, itemId, q, user.id));
    }
    await env.DB.batch(stmts);
    return json({ ok: true, saved: stmts.length });
  }

  const mCntPost = path.match(/^\/stock-counts\/(\d+)\/post$/);
  if (mCntPost && method === "POST") {
    if (!can(user.role, "inventory")) return err("forbidden", "Inventory access required", 403);
    const cid = Number(mCntPost[1]);
    try {
      const head = await env.DB.prepare(`SELECT status FROM stock_counts WHERE id = ?1`).bind(cid).first<{ status: string }>();
      if (!head) return err("not_found", "Stock take not found", 404);
      if (head.status !== "open") return err("invalid_input", "This stock take is already closed.", 400);
      const { results: ls } = await env.DB.prepare(
        `SELECT l.item_id, l.sku, l.item_name, l.system_qty, l.counted_qty, i.stock
           FROM stock_count_lines l JOIN inventory_items i ON i.id = l.item_id
          WHERE l.count_id = ?1 AND l.counted_qty IS NOT NULL AND l.counted_qty != l.system_qty`,
      ).bind(cid).all<{ item_id: number; sku: string; item_name: string; system_qty: number; counted_qty: number; stock: number }>();
      /* a difference that would take the shelf below zero means the shelf
         moved a lot since the count began - recount that item rather than guess */
      const neg = (ls ?? []).find((l) => l.stock + (l.counted_qty - l.system_qty) < 0);
      if (neg) {
        return err("insufficient_stock", `${neg.sku} ${neg.item_name}: the count says ${neg.counted_qty}, the portal held ${neg.system_qty} then and ${neg.stock} now. Recount it, or clear its count, before posting.`, 409);
      }
      const stmts: D1PreparedStatement[] = [];
      const today = mytToday();
      for (const l of ls ?? []) {
        const d = l.counted_qty - l.system_qty;
        stmts.push(env.DB.prepare(
          `UPDATE inventory_items SET stock = stock + ?1,
                  status = CASE WHEN stock + ?1 = 0 THEN 'out_of_stock' WHEN stock + ?1 <= 5 THEN 'low' ELSE 'in_stock' END,
                  low_alerted = CASE WHEN stock + ?1 > 5 THEN NULL ELSE low_alerted END,
                  updated_by = ?2, updated_at = datetime('now')
            WHERE id = ?3`,
        ).bind(d, user.id, l.item_id));
        stmts.push(env.DB.prepare(
          `INSERT INTO manual_stockouts (item_id, sku, item_name, qty, unit_sale_cents, remark, out_date, created_by, direction, purpose)
           VALUES (?1, ?2, ?3, ?4, NULL, ?5, ?6, ?7, ?8, ?9)`,
        ).bind(l.item_id, l.sku, l.item_name, Math.abs(d), `Stock take #${cid}: counted ${l.counted_qty}, the portal held ${l.system_qty}`, today, user.id,
          d > 0 ? "in" : "out", d > 0 ? "variance_found" : "variance_missing"));
        stmts.push(env.DB.prepare(`UPDATE stock_count_lines SET posted_delta = ?3 WHERE count_id = ?1 AND item_id = ?2`).bind(cid, l.item_id, d));
      }
      stmts.push(env.DB.prepare(`UPDATE stock_counts SET status = 'posted', posted_by = ?2, posted_at = datetime('now') WHERE id = ?1 AND status = 'open'`).bind(cid, user.id));
      await env.DB.batch(stmts);
      await audit(env, user.id, "inventory.count_post", "stock_counts", String(cid), {
        variances: (ls ?? []).length, units_found: (ls ?? []).reduce((a, l) => a + Math.max(0, l.counted_qty - l.system_qty), 0),
        units_missing: (ls ?? []).reduce((a, l) => a + Math.max(0, l.system_qty - l.counted_qty), 0),
      });
      return json({ ok: true, variances: (ls ?? []).length });
    } catch (e) {
      if (skew(e)) return err("migration_missing", "Run: npx wrangler d1 migrations apply azoneofficial --remote (0142_books_stock_take)", 500);
      throw e;
    }
  }

  const mCntCancel = path.match(/^\/stock-counts\/(\d+)\/cancel$/);
  if (mCntCancel && method === "POST") {
    if (!can(user.role, "inventory")) return err("forbidden", "Inventory access required", 403);
    const r = await env.DB.prepare(`UPDATE stock_counts SET status = 'cancelled', cancelled_at = datetime('now') WHERE id = ?1 AND status = 'open'`)
      .bind(Number(mCntCancel[1])).run();
    if (!r.meta?.changes) return err("invalid_input", "That stock take is not open.", 400);
    await audit(env, user.id, "inventory.count_cancel", "stock_counts", mCntCancel[1]);
    return json({ ok: true });
  }

  /* ════════════════════════════════════════════════════════════════════
     PHASE 4 (v1.181.16) - CUSTOMERS
     ════════════════════════════════════════════════════════════════════
     A client's file beside the customers table, never in it: contact
     persons, tags, credit terms, dated follow-ups, invoices to raise again
     each month, and what the customer accepted on a shared link. Reads are
     for whoever may open Sales; writes need the sales permission, the same
     test POST /customers uses. Nothing here writes a document: a recurring
     invoice is raised by a person through the normal form, and credit terms
     only reach a NEW invoice through that form, for a client who has terms.
     The prospects pipeline stays retired (v1.21.0): enquiries are the
     funnel, and an enquiry becomes a quotation through the existing handoff. */

  const CRM_WRITE = can(user.role, "sales");
  const crmSkew = () => err("migration_missing", "Run: npx wrangler d1 migrations apply azoneofficial --remote (0143_customer_joins)", 500);
  const tagOf = (t: unknown) => (typeof t === "string" ? t.trim().toLowerCase().replace(/\s+/g, " ") : "");
  const thisYm = () => mytToday().slice(0, 7);
  /** the day a recurring invoice falls due this month: its day, or the
      month's last day when the month is shorter */
  const dueDayThisMonth = (day: number) => {
    const t = mytToday();
    const y = Number(t.slice(0, 4)), m = Number(t.slice(5, 7));
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return `${t.slice(0, 7)}-${String(Math.min(day, last)).padStart(2, "0")}`;
  };
  const recurringRef = (id: number) => `Recurring R-${id}`;

  /* the whole book at once: tags and terms for the list, open follow-ups,
     recurring invoices with whether this month is due or raised */
  if (path === "/customers/crm" && method === "GET") {
    if (!canReadDocs(user)) return err("forbidden", "Sales access required", 403);
    try {
      const tags = (await env.DB.prepare(`SELECT customer_id, tag FROM customer_tags ORDER BY tag`).all<{ customer_id: number; tag: string }>()).results ?? [];
      const terms = (await env.DB.prepare(`SELECT customer_id, terms_days FROM customer_terms`).all<{ customer_id: number; terms_days: number }>()).results ?? [];
      const followups = (await env.DB.prepare(
        `SELECT f.id, f.customer_id, c.company, f.due_on, f.note, f.owner_id,
                COALESCE(NULLIF(TRIM(u.full_name), ''), u.name) AS owner_name
           FROM customer_followups f JOIN customers c ON c.id = f.customer_id LEFT JOIN users u ON u.id = f.owner_id
          WHERE f.done_at IS NULL AND f.cancelled_at IS NULL ORDER BY f.due_on, f.id LIMIT 300`,
      ).all()).results ?? [];
      const recurring = await recurringList();
      return json({ tags, terms, followups, recurring, today: mytToday(), can_write: CRM_WRITE });
    } catch (e) {
      if (skew(e)) return json({ tags: [], terms: [], followups: [], recurring: [], today: mytToday(), can_write: false, pending_migration: true });
      throw e;
    }
  }

  async function recurringList() {
    const ym = thisYm();
    const { results } = await env.DB.prepare(
      `SELECT r.id, r.customer_id, c.company, r.source_doc_id, d.doc_number AS source_number, d.total_cents, r.day_of_month, r.note,
              r.created_at, r.stopped_at,
              (SELECT x.doc_number FROM sales_documents x
                WHERE x.customer_id = r.customer_id AND x.doc_type = 'INV' AND COALESCE(x.payment_status, '') != 'void'
                  AND x.reference LIKE ?1 || r.id || ' %'
                  AND strftime('%Y-%m', x.created_at, '+8 hours') = ?2
                ORDER BY x.id DESC LIMIT 1) AS raised_number
         FROM recurring_invoices r JOIN customers c ON c.id = r.customer_id
         LEFT JOIN sales_documents d ON d.id = r.source_doc_id
        WHERE r.stopped_at IS NULL ORDER BY r.day_of_month, r.id`,
    ).bind("Recurring R-", ym).all<{ id: number; customer_id: number; day_of_month: number; raised_number: string | null; source_number: string | null }>();
    const today = mytToday();
    return (results ?? []).map((r) => {
      const due_on = dueDayThisMonth(r.day_of_month);
      return { ...r, due_on, raised: r.raised_number != null, due: r.raised_number == null && today >= due_on && r.source_number != null };
    });
  }

  /* one client's file */
  const mFile = path.match(/^\/customers\/(\d+)\/file$/);
  if (mFile && method === "GET") {
    if (!canReadDocs(user)) return err("forbidden", "Sales access required", 403);
    const cid = Number(mFile[1]);
    const c = await env.DB.prepare(`SELECT id, company, contact_person, phone, email FROM customers WHERE id = ?1`).bind(cid).first();
    if (!c) return err("not_found", "Customer not found", 404);
    try {
      const contacts = (await env.DB.prepare(
        `SELECT id, name, role, phone, email, note, created_at FROM customer_contacts WHERE customer_id = ?1 AND removed_at IS NULL ORDER BY id`,
      ).bind(cid).all()).results ?? [];
      const tags = ((await env.DB.prepare(`SELECT tag FROM customer_tags WHERE customer_id = ?1 ORDER BY tag`).bind(cid).all<{ tag: string }>()).results ?? []).map((t) => t.tag);
      const terms = await env.DB.prepare(`SELECT terms_days FROM customer_terms WHERE customer_id = ?1`).bind(cid).first<{ terms_days: number }>();
      const followups = (await env.DB.prepare(
        `SELECT f.id, f.due_on, f.note, f.owner_id, f.created_at, f.done_at, f.done_note, f.cancelled_at,
                COALESCE(NULLIF(TRIM(u.full_name), ''), u.name) AS owner_name,
                COALESCE(NULLIF(TRIM(d.full_name), ''), d.name) AS done_by_name
           FROM customer_followups f LEFT JOIN users u ON u.id = f.owner_id LEFT JOIN users d ON d.id = f.done_by
          WHERE f.customer_id = ?1 ORDER BY (f.done_at IS NULL AND f.cancelled_at IS NULL) DESC, f.due_on DESC, f.id DESC LIMIT 60`,
      ).bind(cid).all()).results ?? [];
      const recurring = (await recurringList()).filter((r) => r.customer_id === cid);
      const invoices = (await env.DB.prepare(
        `SELECT id, doc_number, total_cents, created_at, payment_status FROM sales_documents WHERE customer_id = ?1 AND doc_type = 'INV' ORDER BY id DESC LIMIT 24`, // v1.242.0 - payment_status so a voided one is shown struck through
      ).bind(cid).all()).results ?? [];
      const all = ((await env.DB.prepare(`SELECT DISTINCT tag FROM customer_tags ORDER BY tag LIMIT 200`).all<{ tag: string }>()).results ?? []).map((t) => t.tag);
      /* who may own a follow-up: the active sales team, by the same permission */
      const owners = ((await env.DB.prepare(
        `SELECT id, COALESCE(NULLIF(TRIM(full_name), ''), name) AS name, role FROM users WHERE is_active = 1 AND role NOT IN ('customer') ORDER BY name`,
      ).all<{ id: number; name: string; role: string }>()).results ?? []).filter((u) => can(u.role, "sales")).map((u) => ({ id: u.id, name: u.name }));
      return json({ customer: c, contacts, tags, all_tags: all, terms_days: terms?.terms_days ?? null, followups, recurring, invoices, owners, me: user.id, today: mytToday(), can_write: CRM_WRITE });
    } catch (e) {
      if (skew(e)) return json({ customer: c, contacts: [], tags: [], all_tags: [], terms_days: null, followups: [], recurring: [], invoices: [], owners: [], me: user.id, today: mytToday(), can_write: false, pending_migration: true });
      throw e;
    }
  }

  /* contacts */
  const mContacts = path.match(/^\/customers\/(\d+)\/contacts$/);
  if (mContacts && method === "POST") {
    if (!CRM_WRITE) return err("forbidden", "Sales access required", 403);
    const cid = Number(mContacts[1]);
    const name = str(body?.name, 120) ? String(body!.name).trim() : "";
    if (name.length < 2) return err("invalid_input", "A contact needs a name.", 400);
    const opt = (k: string, n: number) => (str(body?.[k], n) ? String(body![k]).trim() || null : null);
    try {
      const ok = await env.DB.prepare(`SELECT id FROM customers WHERE id = ?1`).bind(cid).first();
      if (!ok) return err("not_found", "Customer not found", 404);
      const r = await env.DB.prepare(
        `INSERT INTO customer_contacts (customer_id, name, role, phone, email, note, created_by) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) RETURNING id`,
      ).bind(cid, name, opt("role", 80), opt("phone", 40), opt("email", 200), opt("note", 300), user.id).first<{ id: number }>();
      await audit(env, user.id, "customer.contact_add", "customer_contacts", String(r?.id), { customer_id: cid, name });
      return json({ ok: true, id: r?.id }, 201);
    } catch (e) { if (skew(e)) return crmSkew(); throw e; }
  }
  const mContactRm = path.match(/^\/customers\/(\d+)\/contacts\/(\d+)\/remove$/);
  if (mContactRm && method === "POST") {
    if (!CRM_WRITE) return err("forbidden", "Sales access required", 403);
    const r = await env.DB.prepare(`UPDATE customer_contacts SET removed_at = datetime('now'), removed_by = ?3 WHERE id = ?2 AND customer_id = ?1 AND removed_at IS NULL`)
      .bind(Number(mContactRm[1]), Number(mContactRm[2]), user.id).run();
    if (!r.meta?.changes) return err("not_found", "Contact not found", 404);
    await audit(env, user.id, "customer.contact_remove", "customer_contacts", mContactRm[2], { customer_id: Number(mContactRm[1]) });
    return json({ ok: true });
  }

  /* tags: the client's whole set, replaced */
  const mTags = path.match(/^\/customers\/(\d+)\/tags$/);
  if (mTags && method === "PUT") {
    if (!CRM_WRITE) return err("forbidden", "Sales access required", 403);
    const cid = Number(mTags[1]);
    const raw = Array.isArray(body?.tags) ? (body!.tags as unknown[]) : null;
    if (!raw) return err("invalid_input", "tags (a list) is required", 400);
    const tags = [...new Set(raw.map(tagOf).filter((t) => t.length >= 2 && t.length <= 30))];
    if (tags.length > 12) return err("invalid_input", "Up to 12 tags per client.", 400);
    try {
      const ok = await env.DB.prepare(`SELECT id FROM customers WHERE id = ?1`).bind(cid).first();
      if (!ok) return err("not_found", "Customer not found", 404);
      const stmts: D1PreparedStatement[] = [env.DB.prepare(`DELETE FROM customer_tags WHERE customer_id = ?1`).bind(cid)];
      for (const t of tags) stmts.push(env.DB.prepare(`INSERT INTO customer_tags (customer_id, tag, created_by) VALUES (?1, ?2, ?3)`).bind(cid, t, user.id));
      await env.DB.batch(stmts);
      await audit(env, user.id, "customer.tags", "customer_tags", String(cid), { tags });
      return json({ ok: true, tags });
    } catch (e) { if (skew(e)) return crmSkew(); throw e; }
  }

  /* credit terms: a number of days, or null to clear */
  const mTerms = path.match(/^\/customers\/(\d+)\/terms$/);
  if (mTerms && method === "PUT") {
    if (!CRM_WRITE) return err("forbidden", "Sales access required", 403);
    const cid = Number(mTerms[1]);
    const days = body?.terms_days === null ? null : num(body?.terms_days);
    if (days !== null && (!Number.isInteger(days) || days < 1 || days > 120)) return err("invalid_input", "Terms are 1 to 120 days, or none.", 400);
    try {
      const ok = await env.DB.prepare(`SELECT id FROM customers WHERE id = ?1`).bind(cid).first();
      if (!ok) return err("not_found", "Customer not found", 404);
      if (days === null) await env.DB.prepare(`DELETE FROM customer_terms WHERE customer_id = ?1`).bind(cid).run();
      else await env.DB.prepare(
        `INSERT INTO customer_terms (customer_id, terms_days, updated_by) VALUES (?1, ?2, ?3)
         ON CONFLICT(customer_id) DO UPDATE SET terms_days = ?2, updated_by = ?3, updated_at = datetime('now')`,
      ).bind(cid, days, user.id).run();
      await audit(env, user.id, "customer.terms", "customer_terms", String(cid), { terms_days: days });
      return json({ ok: true, terms_days: days });
    } catch (e) { if (skew(e)) return crmSkew(); throw e; }
  }

  /* follow-ups */
  const mFu = path.match(/^\/customers\/(\d+)\/followups$/);
  if (mFu && method === "POST") {
    if (!CRM_WRITE) return err("forbidden", "Sales access required", 403);
    const cid = Number(mFu[1]);
    const due = body?.due_on;
    const note = str(body?.note, 300) ? String(body!.note).trim() : "";
    if (!validDay(due)) return err("invalid_input", "Pick the day to follow up.", 400);
    if (note.length < 3) return err("invalid_input", "Say what the follow-up is for.", 400);
    let owner = body?.owner_id == null ? user.id : num(body.owner_id);
    if (owner === null) owner = user.id;
    try {
      const ok = await env.DB.prepare(`SELECT id FROM customers WHERE id = ?1`).bind(cid).first();
      if (!ok) return err("not_found", "Customer not found", 404);
      const who = await env.DB.prepare(`SELECT role, is_active FROM users WHERE id = ?1`).bind(owner).first<{ role: string; is_active: number }>();
      if (!who || !who.is_active || !can(who.role, "sales")) return err("invalid_input", "The owner must be an active member of the sales team.", 400);
      const r = await env.DB.prepare(
        `INSERT INTO customer_followups (customer_id, due_on, owner_id, note, created_by) VALUES (?1, ?2, ?3, ?4, ?5) RETURNING id`,
      ).bind(cid, due, owner, note, user.id).first<{ id: number }>();
      await audit(env, user.id, "customer.followup_add", "customer_followups", String(r?.id), { customer_id: cid, due_on: due, owner_id: owner });
      return json({ ok: true, id: r?.id }, 201);
    } catch (e) { if (skew(e)) return crmSkew(); throw e; }
  }
  const mFuAct = path.match(/^\/followups\/(\d+)\/(done|cancel)$/);
  if (mFuAct && method === "POST") {
    if (!CRM_WRITE) return err("forbidden", "Sales access required", 403);
    const id = Number(mFuAct[1]);
    const r = mFuAct[2] === "done"
      ? await env.DB.prepare(`UPDATE customer_followups SET done_at = datetime('now'), done_by = ?2, done_note = ?3 WHERE id = ?1 AND done_at IS NULL AND cancelled_at IS NULL`)
        .bind(id, user.id, str(body?.note, 300) ? String(body!.note).trim() || null : null).run()
      : await env.DB.prepare(`UPDATE customer_followups SET cancelled_at = datetime('now'), done_by = ?2 WHERE id = ?1 AND done_at IS NULL AND cancelled_at IS NULL`)
        .bind(id, user.id).run();
    if (!r.meta?.changes) return err("invalid_input", "That follow-up is already closed.", 400);
    await audit(env, user.id, `customer.followup_${mFuAct[2]}`, "customer_followups", String(id));
    return json({ ok: true });
  }

  /* recurring invoices: what to raise again, never raised by itself */
  if (path === "/customers/recurring" && method === "POST") {
    if (!CRM_WRITE) return err("forbidden", "Sales access required", 403);
    const src = num(body?.source_doc_id);
    const day = num(body?.day_of_month);
    if (src === null) return err("invalid_input", "Pick the invoice to repeat.", 400);
    if (day === null || !Number.isInteger(day) || day < 1 || day > 31) return err("invalid_input", "The day of the month is 1 to 31.", 400);
    try {
      const d = await env.DB.prepare(`SELECT id, customer_id FROM sales_documents WHERE id = ?1 AND doc_type = 'INV'`).bind(src).first<{ id: number; customer_id: number }>();
      if (!d) return err("not_found", "Invoice not found", 404);
      const dup = await env.DB.prepare(`SELECT id FROM recurring_invoices WHERE customer_id = ?1 AND source_doc_id = ?2 AND stopped_at IS NULL`).bind(d.customer_id, src).first();
      if (dup) return err("invalid_input", "That invoice already repeats.", 400);
      const r = await env.DB.prepare(
        `INSERT INTO recurring_invoices (customer_id, source_doc_id, day_of_month, note, created_by) VALUES (?1, ?2, ?3, ?4, ?5) RETURNING id`,
      ).bind(d.customer_id, src, day, str(body?.note, 200) ? String(body!.note).trim() || null : null, user.id).first<{ id: number }>();
      await audit(env, user.id, "invoice.recurring_add", "recurring_invoices", String(r?.id), { source_doc_id: src, day_of_month: day });
      return json({ ok: true, id: r?.id }, 201);
    } catch (e) { if (skew(e)) return crmSkew(); throw e; }
  }
  const mRecStop = path.match(/^\/customers\/recurring\/(\d+)\/stop$/);
  if (mRecStop && method === "POST") {
    if (!CRM_WRITE) return err("forbidden", "Sales access required", 403);
    const r = await env.DB.prepare(`UPDATE recurring_invoices SET stopped_at = datetime('now'), stopped_by = ?2 WHERE id = ?1 AND stopped_at IS NULL`)
      .bind(Number(mRecStop[1]), user.id).run();
    if (!r.meta?.changes) return err("invalid_input", "That recurring invoice is already stopped.", 400);
    await audit(env, user.id, "invoice.recurring_stop", "recurring_invoices", mRecStop[1]);
    return json({ ok: true });
  }
  /* the form's prefill for this month: the source invoice's lines, read */
  const mRecFill = path.match(/^\/customers\/recurring\/(\d+)\/prefill$/);
  if (mRecFill && method === "GET") {
    if (!CRM_WRITE) return err("forbidden", "Sales access required", 403);
    try {
      const r = await env.DB.prepare(
        `SELECT r.id, r.customer_id, d.items, d.kind, d.discount_cents, d.tax_percent, d.delivery_cents, d.issuer_code, d.salesperson_id
           FROM recurring_invoices r JOIN sales_documents d ON d.id = r.source_doc_id WHERE r.id = ?1 AND r.stopped_at IS NULL`,
      ).bind(Number(mRecFill[1])).first<{ id: number; customer_id: number; items: string; kind: string | null; discount_cents: number | null; tax_percent: number | null; delivery_cents: number | null; issuer_code: string | null; salesperson_id: number | null }>();
      if (!r) return err("not_found", "Recurring invoice not found", 404);
      let items: unknown = [];
      try { items = JSON.parse(r.items); } catch { items = []; }
      return json({ prefill: {
        source: "recurring", doc_type: "INV", customer_id: r.customer_id, kind: r.kind ?? "service", items,
        discount_cents: r.discount_cents ?? 0, tax_percent: r.tax_percent ?? 0, delivery_cents: r.delivery_cents ?? 0,
        issuer: r.issuer_code ?? "a2z", salesperson_id: r.salesperson_id ?? 0, reference: `${recurringRef(r.id)} · ${thisYm()}`,
      } });
    } catch (e) { if (skew(e)) return crmSkew(); throw e; }
  }

  /* what the customer accepted on the shared link - record only */
  const mAcc = path.match(/^\/docs\/(\d+)\/acceptance$/);
  if (mAcc && method === "GET") {
    if (!canReadDocs(user)) return err("forbidden", "Sales access required", 403);
    try {
      const { results } = await env.DB.prepare(
        `SELECT revision, accepted_name, accepted_position, accepted_at, ip FROM quotation_acceptances WHERE doc_id = ?1 ORDER BY revision DESC`,
      ).bind(Number(mAcc[1])).all();
      return json({ acceptances: results ?? [] });
    } catch (e) { if (skew(e)) return json({ acceptances: [], pending_migration: true }); throw e; }
  }

  /* ════════════════════════════════════════════════════════════════════
     PHASE 5 (v1.181.17) - PEOPLE
     ════════════════════════════════════════════════════════════════════
     The employee lifecycle around the records HR already keeps: what is
     still open for someone joining (the existing checklist in
     users.onboarding_json, read here, never written) or leaving (a checklist
     of its own), when a probation ends and what was decided, the letters HR
     issues, training attended, and a month of leave for the managers who
     decide it. Deciding a probation records the decision: the employment
     status is still changed in Staff Details, by the route that already
     does it. Gate: hr_manage, the Staff Details permission; the leave
     calendar is team_manage, the roles that decide leave.

     And one sales control the owner asked to have OFF until he sets it: a
     quotation approval limit. With no limit nothing anywhere changes. */

  const HR = can(user.role, "hr_manage");
  const OWNER_ROLES = ["super_admin", "ceo"];
  const hrSkew = () => err("migration_missing", "Run: npx wrangler d1 migrations apply azoneofficial --remote (0144_people)", 500);
  const addDays = (day: string, n: number) => { const d = new Date(`${day}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const addMonths = (day: string, n: number) => { const d = new Date(`${day}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 10); };

  if (path === "/people/overview" && method === "GET") {
    if (!HR) return err("forbidden", "HR access required", 403);
    const today = mytToday();
    const staff = ((await env.DB.prepare(
      `SELECT id, COALESCE(NULLIF(TRIM(full_name), ''), name) AS name, position, department, employment_status, joined_on, left_on, onboarding_json
         FROM users WHERE role NOT IN ('customer', 'super_admin', 'admin') AND (is_active = 1 OR left_on >= ?1) ORDER BY name`,
    ).bind(addDays(today, -60)).all<{ id: number; name: string; position: string | null; department: string | null; employment_status: string | null; joined_on: string | null; left_on: string | null; onboarding_json: string | null }>()).results ?? []);
    try {
      const leavingRows = ((await env.DB.prepare(`SELECT user_id, items FROM leaving_checklists`).all<{ user_id: number; items: string }>()).results ?? []);
      const probRows = ((await env.DB.prepare(
        `SELECT p.id, p.user_id, p.ends_on, p.outcome, p.note, p.decided_at, COALESCE(NULLIF(TRIM(u.full_name), ''), u.name) AS decided_by_name
           FROM probation_reviews p LEFT JOIN users u ON u.id = p.decided_by ORDER BY p.id DESC`,
      ).all<{ id: number; user_id: number; ends_on: string; outcome: string | null; note: string | null; decided_at: string | null; decided_by_name: string | null }>()).results ?? []);
      const assets = ((await env.DB.prepare(`SELECT assigned_to AS user_id, COUNT(*) AS n FROM assets WHERE assigned_to IS NOT NULL AND deleted_at IS NULL GROUP BY assigned_to`)
        .all<{ user_id: number; n: number }>().catch(() => env.DB.prepare(`SELECT assigned_to AS user_id, COUNT(*) AS n FROM assets WHERE assigned_to IS NOT NULL GROUP BY assigned_to`).all<{ user_id: number; n: number }>())).results ?? []);
      const parse = (j: string | null) => { try { return j ? (JSON.parse(j) as Record<string, boolean>) : {}; } catch { return {}; } };
      const joining = staff.filter((u) => u.joined_on && u.joined_on >= addDays(today, -90) && !u.left_on)
        .map((u) => { const done = parse(u.onboarding_json); return { id: u.id, name: u.name, position: u.position, joined_on: u.joined_on, open: JOINING_KEYS.filter((k) => !done[k]) }; });
      const leaving = staff.filter((u) => u.left_on && u.left_on >= addDays(today, -60))
        .map((u) => { const done = parse(leavingRows.find((r) => r.user_id === u.id)?.items ?? null); return { id: u.id, name: u.name, position: u.position, left_on: u.left_on, items: done, open: LEAVING_KEYS.filter((k) => !done[k]), assets_held: assets.find((a) => a.user_id === u.id)?.n ?? 0 }; });
      const probation = staff.filter((u) => u.employment_status === "probation" && !u.left_on).map((u) => {
        const r = probRows.find((x) => x.user_id === u.id) ?? null;
        return { id: u.id, name: u.name, position: u.position, joined_on: u.joined_on, suggested_ends_on: u.joined_on ? addMonths(u.joined_on, 3) : null, review: r };
      });
      const decided = probRows.filter((r) => r.outcome).slice(0, 10).map((r) => ({ ...r, name: staff.find((u) => u.id === r.user_id)?.name ?? null }));
      const letters = (await env.DB.prepare(
        `SELECT l.id, l.user_id, l.kind, l.ref_no, l.issued_on, l.subject, l.voided_at, l.void_reason,
                COALESCE(NULLIF(TRIM(u.full_name), ''), u.name) AS name, COALESCE(NULLIF(TRIM(b.full_name), ''), b.name) AS issued_by_name
           FROM hr_letters l LEFT JOIN users u ON u.id = l.user_id LEFT JOIN users b ON b.id = l.issued_by ORDER BY l.id DESC LIMIT 60`,
      ).all()).results ?? [];
      const training = (await env.DB.prepare(
        `SELECT t.id, t.user_id, t.title, t.provider, t.on_date, t.hours, t.cost_cents, t.paid_by, t.note,
                COALESCE(NULLIF(TRIM(u.full_name), ''), u.name) AS name
           FROM training_records t LEFT JOIN users u ON u.id = t.user_id WHERE t.removed_at IS NULL ORDER BY t.on_date DESC, t.id DESC LIMIT 150`,
      ).all()).results ?? [];
      return json({ today, joining, leaving, probation, decided, letters, training,
        staff: staff.filter((u) => !u.left_on || u.left_on >= today).map((u) => ({ id: u.id, name: u.name, position: u.position })),
        joining_keys: JOINING_KEYS, leaving_keys: LEAVING_KEYS });
    } catch (e) {
      if (skew(e)) return json({ today, joining: [], leaving: [], probation: [], decided: [], letters: [], training: [], staff: [], joining_keys: JOINING_KEYS, leaving_keys: LEAVING_KEYS, pending_migration: true });
      throw e;
    }
  }

  const mLeaving = path.match(/^\/people\/(\d+)\/leaving$/);
  if (mLeaving && method === "PUT") {
    if (!HR) return err("forbidden", "HR access required", 403);
    const raw = body?.items;
    if (typeof raw !== "object" || raw === null) return err("invalid_input", "items is required", 400);
    const items: Record<string, boolean> = {};
    for (const k of LEAVING_KEYS) if ((raw as Record<string, unknown>)[k] === true) items[k] = true;
    try {
      await env.DB.prepare(
        `INSERT INTO leaving_checklists (user_id, items, updated_by) VALUES (?1, ?2, ?3)
         ON CONFLICT(user_id) DO UPDATE SET items = ?2, updated_by = ?3, updated_at = datetime('now')`,
      ).bind(Number(mLeaving[1]), JSON.stringify(items), user.id).run();
      await audit(env, user.id, "staff.leaving_checklist", "users", mLeaving[1], items);
      return json({ ok: true, items });
    } catch (e) { if (skew(e)) return hrSkew(); throw e; }
  }

  const mProb = path.match(/^\/people\/(\d+)\/probation(\/decide)?$/);
  if (mProb && method === "POST") {
    if (!HR) return err("forbidden", "HR access required", 403);
    const uid = Number(mProb[1]);
    try {
      if (!mProb[2]) {
        const ends = body?.ends_on;
        if (!validDay(ends)) return err("invalid_input", "Pick the day the probation ends.", 400);
        const open = await env.DB.prepare(`SELECT id FROM probation_reviews WHERE user_id = ?1 AND outcome IS NULL ORDER BY id DESC LIMIT 1`).bind(uid).first<{ id: number }>();
        if (open) await env.DB.prepare(`UPDATE probation_reviews SET ends_on = ?2, set_by = ?3, set_at = datetime('now') WHERE id = ?1`).bind(open.id, ends, user.id).run();
        else await env.DB.prepare(`INSERT INTO probation_reviews (user_id, ends_on, set_by) VALUES (?1, ?2, ?3)`).bind(uid, ends, user.id).run();
        await audit(env, user.id, "staff.probation_set", "users", String(uid), { ends_on: ends });
        return json({ ok: true });
      }
      const outcome = String(body?.outcome ?? "");
      if (!["confirmed", "extended", "ended"].includes(outcome)) return err("invalid_input", "The outcome is confirmed, extended or ended.", 400);
      const note = str(body?.note, 500) ? String(body!.note).trim() || null : null;
      const open = await env.DB.prepare(`SELECT id FROM probation_reviews WHERE user_id = ?1 AND outcome IS NULL ORDER BY id DESC LIMIT 1`).bind(uid).first<{ id: number }>();
      if (!open) return err("invalid_input", "Set the probation end date first.", 400);
      const nextEnds = body?.next_ends_on;
      if (outcome === "extended" && !validDay(nextEnds)) return err("invalid_input", "An extension needs its new end date.", 400);
      const stmts: D1PreparedStatement[] = [
        env.DB.prepare(`UPDATE probation_reviews SET outcome = ?2, note = ?3, decided_by = ?4, decided_at = datetime('now') WHERE id = ?1`).bind(open.id, outcome, note, user.id),
      ];
      if (outcome === "extended") stmts.push(env.DB.prepare(`INSERT INTO probation_reviews (user_id, ends_on, set_by) VALUES (?1, ?2, ?3)`).bind(uid, nextEnds, user.id));
      await env.DB.batch(stmts);
      await audit(env, user.id, "staff.probation_decide", "users", String(uid), { outcome, next_ends_on: outcome === "extended" ? nextEnds : undefined });
      return json({ ok: true });
    } catch (e) { if (skew(e)) return hrSkew(); throw e; }
  }

  /* what a letter may be filled from: the person's own record, read */
  const mFields = path.match(/^\/people\/(\d+)\/letter-fields$/);
  if (mFields && method === "GET") {
    if (!HR) return err("forbidden", "HR access required", 403);
    const u = await env.DB.prepare(
      `SELECT id, COALESCE(NULLIF(TRIM(full_name), ''), name) AS name, ic_number, position, department, employment_status, joined_on, left_on, base_salary_cents, address
         FROM users WHERE id = ?1`,
    ).bind(Number(mFields[1])).first();
    if (!u) return err("not_found", "Staff member not found", 404);
    return json({ person: u });
  }

  const mLetter = path.match(/^\/people\/(\d+)\/letters$/);
  if (mLetter && method === "POST") {
    if (!HR) return err("forbidden", "HR access required", 403);
    const uid = Number(mLetter[1]);
    const kind = String(body?.kind ?? "");
    if (!LETTER_KINDS.includes(kind)) return err("invalid_input", "Pick the kind of letter.", 400);
    const subject = str(body?.subject, 200) ? String(body!.subject).trim() : "";
    const text = str(body?.body, 8000) ? String(body!.body).trim() : "";
    const on = body?.issued_on ?? mytToday();
    if (subject.length < 3 || text.length < 20) return err("invalid_input", "A letter needs a subject and its text.", 400);
    const signerName = str(body?.signer_name, 120) ? String(body!.signer_name).trim() : "";
    const signerPos = str(body?.signer_position, 120) ? String(body!.signer_position).trim() : "";
    if (signerName.length < 2) return err("invalid_input", "Name who signs the letter.", 400);
    if (!validDay(on)) return err("invalid_input", "Pick the letter's date.", 400);
    try {
      const u = await env.DB.prepare(`SELECT id FROM users WHERE id = ?1`).bind(uid).first();
      if (!u) return err("not_found", "Staff member not found", 404);
      const year = String(on).slice(0, 4);
      const n = await env.DB.prepare(`SELECT COUNT(*) AS c FROM hr_letters WHERE substr(issued_on, 1, 4) = ?1`).bind(year).first<{ c: number }>();
      /* the next number of the year; two letters issued in the same instant
         take the next free one rather than failing */
      let ref = "";
      let r: { id: number } | null = null;
      for (let k = 1; k <= 5 && !r; k++) {
        ref = `A2Z/HR/${year}/${String((n?.c ?? 0) + k).padStart(3, "0")}`;
        try {
          r = await env.DB.prepare(
            `INSERT INTO hr_letters (user_id, kind, ref_no, issued_on, subject, body, signer_name, signer_position, issued_by) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9) RETURNING id`,
          ).bind(uid, kind, ref, on, subject, text, signerName, signerPos, user.id).first<{ id: number }>();
        } catch (e) { if (!/UNIQUE/.test(String(e))) throw e; }
      }
      if (!r) return err("conflict", "Could not number the letter - try again.", 409);
      await audit(env, user.id, "staff.letter_issue", "hr_letters", String(r?.id), { user_id: uid, kind, ref_no: ref });
      return json({ ok: true, id: r?.id, ref_no: ref }, 201);
    } catch (e) { if (skew(e)) return hrSkew(); throw e; }
  }
  const mLetterOne = path.match(/^\/people\/letters\/(\d+)(\/void)?$/);
  if (mLetterOne) {
    if (!HR) return err("forbidden", "HR access required", 403);
    const id = Number(mLetterOne[1]);
    if (!mLetterOne[2] && method === "GET") {
      const l = await env.DB.prepare(
        `SELECT l.*, COALESCE(NULLIF(TRIM(u.full_name), ''), u.name) AS name, u.position, u.ic_number
           FROM hr_letters l LEFT JOIN users u ON u.id = l.user_id WHERE l.id = ?1`,
      ).bind(id).first();
      if (!l) return err("not_found", "Letter not found", 404);
      return json({ letter: l });
    }
    if (mLetterOne[2] && method === "POST") {
      const reason = str(body?.reason, 300) ? String(body!.reason).trim() : "";
      if (reason.length < 3) return err("invalid_input", "Say why the letter is voided.", 400);
      const r = await env.DB.prepare(`UPDATE hr_letters SET voided_at = datetime('now'), voided_by = ?2, void_reason = ?3 WHERE id = ?1 AND voided_at IS NULL`)
        .bind(id, user.id, reason).run();
      if (!r.meta?.changes) return err("invalid_input", "That letter is already voided.", 400);
      await audit(env, user.id, "staff.letter_void", "hr_letters", String(id), { reason });
      return json({ ok: true });
    }
  }

  const mTrain = path.match(/^\/people\/(\d+)\/training$/);
  if (mTrain && method === "POST") {
    if (!HR) return err("forbidden", "HR access required", 403);
    const title = str(body?.title, 200) ? String(body!.title).trim() : "";
    const on = body?.on_date;
    if (title.length < 3) return err("invalid_input", "Name the course.", 400);
    if (!validDay(on)) return err("invalid_input", "Pick the day of the course.", 400);
    const hours = body?.hours == null || body.hours === "" ? null : num(body.hours);
    const cost = body?.cost_cents == null || body.cost_cents === "" ? null : num(body.cost_cents);
    if (hours !== null && (hours < 0 || hours > 1000)) return err("invalid_input", "Hours look wrong.", 400);
    if (cost !== null && (!Number.isInteger(cost) || cost < 0)) return err("invalid_input", "The cost looks wrong.", 400);
    const paidBy = ["company", "self", "sponsor"].includes(String(body?.paid_by)) ? String(body!.paid_by) : null;
    try {
      const r = await env.DB.prepare(
        `INSERT INTO training_records (user_id, title, provider, on_date, hours, cost_cents, paid_by, note, created_by) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9) RETURNING id`,
      ).bind(Number(mTrain[1]), title, str(body?.provider, 200) ? String(body!.provider).trim() || null : null, on, hours, cost, paidBy,
        str(body?.note, 500) ? String(body!.note).trim() || null : null, user.id).first<{ id: number }>();
      await audit(env, user.id, "staff.training_add", "training_records", String(r?.id), { user_id: Number(mTrain[1]), title });
      return json({ ok: true, id: r?.id }, 201);
    } catch (e) { if (skew(e)) return hrSkew(); throw e; }
  }
  const mTrainRm = path.match(/^\/people\/training\/(\d+)\/remove$/);
  if (mTrainRm && method === "POST") {
    if (!HR) return err("forbidden", "HR access required", 403);
    const r = await env.DB.prepare(`UPDATE training_records SET removed_at = datetime('now'), removed_by = ?2 WHERE id = ?1 AND removed_at IS NULL`).bind(Number(mTrainRm[1]), user.id).run();
    if (!r.meta?.changes) return err("not_found", "Training record not found", 404);
    await audit(env, user.id, "staff.training_remove", "training_records", mTrainRm[1]);
    return json({ ok: true });
  }

  /* a month of leave, for the managers who decide it */
  if (path === "/people/leave-calendar" && method === "GET") {
    if (!can(user.role, "team_manage")) return err("forbidden", "Managers only", 403);
    const m = params.get("month") ?? mytToday().slice(0, 7);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(m)) return err("invalid_input", "month (YYYY-MM) is required", 400);
    const first = `${m}-01`;
    const last = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).toISOString().slice(0, 10);
    const { results } = await env.DB.prepare(
      `SELECT l.id, l.user_id, l.type, l.start_date, l.end_date, l.days, l.status,
              COALESCE(NULLIF(TRIM(u.full_name), ''), u.name) AS name, u.department
         FROM leave_requests l JOIN users u ON u.id = l.user_id
        WHERE l.status IN ('approved', 'pending') AND l.start_date <= ?2 AND l.end_date >= ?1
        ORDER BY u.department, name, l.start_date`,
    ).bind(first, last).all();
    return json({ month: m, first, last, leave: results ?? [] });
  }

  /* the quotation approval limit - OFF until the owner sets it */
  if (path === "/quotes/approval" && method === "GET") {
    if (!canReadDocs(user)) return err("forbidden", "Sales access required", 403);
    try {
      const row = await env.DB.prepare(`SELECT value FROM business_settings WHERE key = 'quote_approval'`).first<{ value: string | null }>();
      let setting: { limit_cents: number; since: string } | null = null;
      try { setting = row?.value ? JSON.parse(row.value) : null; } catch { setting = null; }
      if (!setting || !(setting.limit_cents > 0)) return json({ limit_cents: null, pending: [], approved: [], can_set: OWNER_ROLES.includes(user.role) });
      const { results } = await env.DB.prepare(
        `SELECT d.id, d.doc_number, d.total_cents, COALESCE(d.revision, 0) AS revision, d.created_at, c.company,
                (SELECT a.approved_at FROM quotation_approvals a WHERE a.doc_id = d.id AND a.revision = COALESCE(d.revision, 0)) AS approved_at
           FROM sales_documents d LEFT JOIN customers c ON c.id = d.customer_id
          WHERE d.doc_type = 'QT' AND d.total_cents > ?1 AND COALESCE(datetime(d.revised_at, '-8 hours'), d.created_at) >= ?2
          ORDER BY d.id DESC LIMIT 200`,
      ).bind(setting.limit_cents, setting.since).all<{ id: number; approved_at: string | null }>();
      const rows = results ?? [];
      return json({ limit_cents: setting.limit_cents, since: setting.since, pending: rows.filter((r) => !r.approved_at), approved: rows.filter((r) => r.approved_at).map((r) => r.id),
        can_set: OWNER_ROLES.includes(user.role), can_approve: OWNER_ROLES.includes(user.role) });
    } catch (e) {
      if (skew(e)) return json({ limit_cents: null, pending: [], approved: [], can_set: false, pending_migration: true });
      throw e;
    }
  }
  if (path === "/quotes/approval/limit" && method === "PUT") {
    if (!OWNER_ROLES.includes(user.role)) return err("forbidden", "Only the CEO sets the approval limit", 403);
    const v = body?.limit_cents === null ? null : num(body?.limit_cents);
    if (v !== null && (!Number.isInteger(v) || v < 100)) return err("invalid_input", "The limit is at least RM 1.00, or off.", 400);
    try {
      if (v === null) await env.DB.prepare(`DELETE FROM business_settings WHERE key = 'quote_approval'`).run();
      else await env.DB.prepare(
        `INSERT INTO business_settings (key, value, updated_by) VALUES ('quote_approval', ?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = ?1, updated_by = ?2, updated_at = datetime('now')`,
      ).bind(JSON.stringify({ limit_cents: v, since: new Date().toISOString().slice(0, 19).replace("T", " ") }), user.id).run();
      await audit(env, user.id, "sales.quote_approval_limit", "business_settings", "quote_approval", { limit_cents: v });
      return json({ ok: true, limit_cents: v });
    } catch (e) { if (skew(e)) return hrSkew(); throw e; }
  }
  const mApprove = path.match(/^\/docs\/(\d+)\/approve$/);
  if (mApprove && method === "POST") {
    if (!OWNER_ROLES.includes(user.role)) return err("forbidden", "Only the CEO approves quotations", 403);
    try {
      const d = await env.DB.prepare(`SELECT id, doc_type, COALESCE(revision, 0) AS revision FROM sales_documents WHERE id = ?1`).bind(Number(mApprove[1])).first<{ id: number; doc_type: string; revision: number }>();
      if (!d || d.doc_type !== "QT") return err("not_found", "Quotation not found", 404);
      await env.DB.prepare(`INSERT OR IGNORE INTO quotation_approvals (doc_id, revision, approved_by, note) VALUES (?1, ?2, ?3, ?4)`)
        .bind(d.id, d.revision, user.id, str(body?.note, 300) ? String(body!.note).trim() || null : null).run();
      await audit(env, user.id, "sales.quote_approve", "sales_documents", String(d.id), { revision: d.revision });
      return json({ ok: true, revision: d.revision });
    } catch (e) { if (skew(e)) return hrSkew(); throw e; }
  }

  return null;
}

/**
 * PHASE 4 - a customer accepts a quotation on its shared link. Public: the
 * 32-hex share token is the only credential, as for reading the document.
 * Records who accepted which revision, when and from where. It changes no
 * status, sends nothing and confirms nothing on the business's behalf: the
 * team sees it on the document and decides what happens next.
 */
export async function handlePublicAcceptance(
  env: Env, token: string, body: Record<string, unknown> | null, ip: string, userAgent: string,
): Promise<Response> {
  const name = str(body?.name, 120) ? String(body!.name).trim() : "";
  const position = str(body?.position, 120) ? String(body!.position).trim() || null : null;
  if (name.length < 2) return err("invalid_input", "Please type your name.", 400);
  if (body?.agree !== true) return err("invalid_input", "Please tick the box to accept.", 400);
  try {
    const d = await env.DB.prepare(`SELECT id, doc_type, COALESCE(revision, 0) AS revision, valid_until FROM sales_documents WHERE share_token = ?1`)
      .bind(token).first<{ id: number; doc_type: string; revision: number; valid_until: string | null }>();
    if (!d) return err("not_found", "This link is no longer valid — please ask for a new one", 404);
    if (d.doc_type !== "QT") return err("invalid_input", "Only a quotation can be accepted.", 400);
    /* v1.242.0 (go-live audit B6) - a quotation past its valid-until date is
       not open to acceptance; the team issues a revision with a new date */
    if (d.valid_until && /^\d{4}-\d{2}-\d{2}/.test(d.valid_until) && d.valid_until.slice(0, 10) < mytToday()) {
      return err("expired", `This quotation was valid until ${d.valid_until.slice(0, 10)} and can no longer be accepted - please ask us for an updated one.`, 410);
    }
    const had = await env.DB.prepare(`SELECT accepted_name, accepted_at FROM quotation_acceptances WHERE doc_id = ?1 AND revision = ?2`)
      .bind(d.id, d.revision).first<{ accepted_name: string; accepted_at: string }>();
    if (had) return json({ ok: true, already: true, accepted_name: had.accepted_name, accepted_at: had.accepted_at, revision: d.revision });
    await env.DB.prepare(
      `INSERT INTO quotation_acceptances (doc_id, revision, accepted_name, accepted_position, ip, user_agent) VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
    ).bind(d.id, d.revision, name, position, ip.slice(0, 64), userAgent.slice(0, 300)).run();
    /* no audit row: the acceptance row is the record, and it has no staff actor */
    return json({ ok: true, revision: d.revision }, 201);
  } catch (e) {
    if (skew(e)) return err("not_found", "Acceptance is not available on this link yet", 404);
    throw e;
  }
}
