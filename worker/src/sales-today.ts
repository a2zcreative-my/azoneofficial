/**
 * SALES TODAY - v1.397.0, Sales Command Center Phase 1 (the CEO, 21-11-2026).
 *
 * GET /api/v1/staff/sales/today  - READ ONLY. It writes nothing, anywhere.
 *
 * The one answer behind three places, so they can never disagree:
 *   Sales -> Overview -> My Sales Action Center   the full list (this route)
 *   the Desk's "Sales actions today" line         salesTodayCounts() (desk.ts)
 *   the Dashboard's "Sales today" line            this route, summary only
 *
 * WHAT IS AN ACTION. One existing record that needs someone today, read from its
 * own table - never copied, never a second task list (lib/sales-priority.ts says the
 * order and the words):
 *   followup   an open customer_followups row due today or earlier
 *   quotation  an open quotation (weekly-sales openQuotationSql) with nothing booked
 *              next, or accepted and not yet invoiced
 *   invoice    an unpaid invoice with nothing booked next and no payment waiting
 *              on the CEO; red when its stored status is overdue
 *   enquiry    a website enquiry still "new" (red after the 24 hours enquiries.ts sets)
 *   growth     a Business Growth Check entry to pick up, to contact, or due a follow-up
 *              (the same three conditions the Desk used, desk.ts v1.369.0)
 *
 * WHO SEES WHAT (decision 2, option A: the existing visibility, unchanged):
 *   scope=mine   follow-ups that are mine or nobody's, my quotations and invoices,
 *                enquiries taken by me or by nobody, my growth entries and the unpicked ones
 *   scope=all    everyone's, as the Sales tab already lists them - EXCEPT quotations,
 *                which stay the viewer's own unless they hold exec_view, exactly as
 *                GET /sales/week/opportunities answers today
 *   team         exec_view only (the managers' table), as the Overview shows it today
 *   payments     the count of reported payments waiting on the verifier - for the
 *                verifier only, as a link to Payments (the queue stays there)
 *
 * DONE TODAY counts only what the viewer's own records show they did today
 * (Malaysia time): a follow-up closed, a next follow-up booked on a document, an
 * enquiry answered, a Growth Check contact / finding / advice / follow-up / quotation
 * recorded, a quotation issued, a payment reported. Opening a record, pressing
 * WhatsApp or ticking anything is never read, because none of it is stored.
 */
import type { Env } from "./index";
import type { StaffUser } from "./staff";
import { canUser } from "./permissions";
import { err, json } from "./shared";
import { growthViewer } from "./growth";
import { hoursWaiting, isOverdue as enquiryLate } from "./enquiries";
import { openQuotationSql, personWeek, staffList, targetFor, weekStartDow, weekStartOf } from "./weekly-sales";
import { actionCounts, followupFlag, rankActions, type SalesAction, type SalesActivity, type SalesDone } from "../../lib/sales-priority";

const mytToday = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const mytDay = (ts: string | null | undefined) => {
  if (!ts) return null;
  const t = Date.parse(ts.replace(" ", "T") + (/[zZ]|[+-]\d\d:?\d\d$/.test(ts) ? "" : "Z"));
  return Number.isNaN(t) ? ts.slice(0, 10) : new Date(t + 8 * 3600 * 1000).toISOString().slice(0, 10);
};
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
const NAME = (a: string) => `COALESCE(NULLIF(TRIM(${a}.full_name), ''), ${a}.name)`;
/** a table this database does not have yet reads as empty, never as a failure of the whole answer */
const quiet = async <T>(fn: () => Promise<T[]>): Promise<T[]> => {
  try { return await fn(); } catch (e) { if (/no such (table|column)/i.test(String(e))) return []; throw e; }
};

export type SalesScope = "mine" | "all";
export interface SalesViewer { user: StaffUser; scope: SalesScope }

/** May this person read the Action Center at all? The rule GET /docs uses. */
export const readsSales = (user: StaffUser) => canUser(user, "sales") || canUser(user, "exec_view");

/* ------------------------------------------------------------------ */
/* the actions                                                         */
/* ------------------------------------------------------------------ */
export async function salesActions(env: Env, v: SalesViewer, today = mytToday()): Promise<{ items: SalesAction[]; verify: number | null }> {
  const { user, scope } = v;
  const mine = scope === "mine";
  const allQuotes = !mine && canUser(user, "exec_view");
  const items: SalesAction[] = [];

  /* follow-ups due today or earlier - the Desk's own rule for "mine" (mine or nobody's) */
  type F = { id: number; customer_id: number; company: string; phone: string | null; due_on: string; note: string; owner_id: number | null; owner_name: string | null;
    doc_id: number | null; doc_number: string | null; doc_type: string | null; total_cents: number | null; doc_revision: number | null; acc_rev: number | null };
  const fus = await quiet(async () => (await env.DB.prepare(
    `SELECT f.id, f.customer_id, c.company, c.phone, f.due_on, f.note, f.owner_id, ${NAME("u")} AS owner_name,
            f.doc_id, d.doc_number, d.doc_type, d.total_cents, COALESCE(d.revision, 0) AS doc_revision,
            (SELECT a.revision FROM quotation_acceptances a WHERE a.doc_id = d.id ORDER BY a.revision DESC, a.id DESC LIMIT 1) AS acc_rev
       FROM customer_followups f JOIN customers c ON c.id = f.customer_id
       LEFT JOIN users u ON u.id = f.owner_id
       LEFT JOIN sales_documents d ON d.id = f.doc_id
      WHERE f.done_at IS NULL AND f.cancelled_at IS NULL AND f.due_on <= ?1
        AND (?2 = 0 OR f.owner_id = ?3 OR f.owner_id IS NULL)
      ORDER BY f.due_on, f.id LIMIT 300`,
  ).bind(today, mine ? 1 : 0, user.id).all<F>()).results ?? []);
  const followedDocs = new Set<number>();
  for (const f of fus) {
    const flag = followupFlag(f.due_on, today);
    if (!flag) continue;
    if (f.doc_id) followedDocs.add(f.doc_id);
    items.push({
      key: `followup:${f.id}`, kind: "followup", flag, record_id: f.id, customer_id: f.customer_id, customer: f.company,
      ref: f.doc_number, doc_id: f.doc_id, note: f.note, cents: f.total_cents === null ? null : Number(f.total_cents),
      owner_id: f.owner_id, owner_name: f.owner_name, due_on: f.due_on, age_days: null, waited_hours: null,
      since: f.due_on, phone: f.phone, accepted: f.doc_type === "QT" && f.acc_rev !== null && Number(f.acc_rev) === Number(f.doc_revision),
    });
  }

  /* open quotations: nothing booked next, or accepted and not yet invoiced. ONE query
     (the weekly engine's openQuotations asks three per quotation); its "next" is the
     same rule - an open follow-up on the quotation, or on the customer with no document */
  type Q = { id: number; doc_number: string; customer_id: number; company: string | null; phone: string | null; total_cents: number; created_at: string;
    revision: number; salesperson_id: number | null; owner_name: string | null; next_id: number | null; acc_rev: number | null };
  const qs = await quiet(async () => (await env.DB.prepare(
    `SELECT q.id, q.doc_number, q.customer_id, c.company, c.phone, q.total_cents, q.created_at, COALESCE(q.revision, 0) AS revision, q.salesperson_id, ${NAME("u")} AS owner_name,
            (SELECT f.id FROM customer_followups f WHERE f.done_at IS NULL AND f.cancelled_at IS NULL
                AND (f.doc_id = q.id OR (f.doc_id IS NULL AND f.customer_id = q.customer_id)) ORDER BY (f.doc_id IS NULL), f.due_on LIMIT 1) AS next_id,
            (SELECT a.revision FROM quotation_acceptances a WHERE a.doc_id = q.id ORDER BY a.revision DESC, a.id DESC LIMIT 1) AS acc_rev
       FROM sales_documents q LEFT JOIN customers c ON c.id = q.customer_id LEFT JOIN users u ON u.id = q.salesperson_id
      WHERE ${openQuotationSql("q", "?1")} AND (?2 = 1 OR q.salesperson_id = ?3)
      ORDER BY q.created_at, q.id LIMIT 200`,
  ).bind(today, allQuotes ? 1 : 0, user.id).all<Q>()).results ?? []);
  for (const q of qs) {
    if (followedDocs.has(q.id)) continue; // said once, on its follow-up row
    const accepted = q.acc_rev !== null && Number(q.acc_rev) === Number(q.revision);
    if (!accepted && q.next_id !== null) continue; // something is booked: planned, not waiting
    const created = mytDay(q.created_at) ?? today;
    items.push({
      key: `quotation:${q.id}`, kind: "quotation", flag: accepted ? "ready" : "no_next", record_id: q.id, customer_id: q.customer_id,
      customer: q.company ?? q.doc_number, ref: q.doc_number, doc_id: q.id, note: null, cents: Number(q.total_cents),
      owner_id: q.salesperson_id, owner_name: q.owner_name, due_on: null, age_days: Math.max(0, daysBetween(created, today)), waited_hours: null,
      since: created, phone: q.phone,
    });
  }

  /* unpaid invoices: nothing booked next and nothing waiting on the CEO */
  type I = { id: number; doc_number: string; customer_id: number; company: string | null; phone: string | null; total_cents: number; paid_cents: number;
    payment_status: string | null; created_at: string; salesperson_id: number | null; owner_name: string | null; next_id: number | null; pending: number };
  const invs = await quiet(async () => (await env.DB.prepare(
    `SELECT d.id, d.doc_number, d.customer_id, c.company, c.phone, d.total_cents, d.payment_status, d.created_at, d.salesperson_id, ${NAME("u")} AS owner_name,
            COALESCE((SELECT SUM(p.amount_cents) FROM invoice_payments p WHERE p.invoice_id = d.id AND p.voided_at IS NULL), 0) AS paid_cents,
            (SELECT f.id FROM customer_followups f WHERE f.doc_id = d.id AND f.done_at IS NULL AND f.cancelled_at IS NULL LIMIT 1) AS next_id,
            (SELECT COUNT(*) FROM invoice_payment_reports r WHERE r.invoice_id = d.id AND r.state IN ('reported', 'evidence_checked', 'clarify')) AS pending
       FROM sales_documents d LEFT JOIN customers c ON c.id = d.customer_id LEFT JOIN users u ON u.id = d.salesperson_id
      WHERE d.doc_type = 'INV' AND d.voided_at IS NULL AND COALESCE(d.payment_status, 'unpaid') NOT IN ('paid', 'void')
        AND (?1 = 0 OR d.salesperson_id = ?2 OR (d.salesperson_id IS NULL AND d.created_by = ?2))
      ORDER BY d.created_at, d.id LIMIT 300`,
  ).bind(mine ? 1 : 0, user.id).all<I>()).results ?? []);
  for (const i of invs) {
    if (followedDocs.has(i.id) || i.next_id !== null || Number(i.pending) > 0) continue;
    const created = mytDay(i.created_at) ?? today;
    const balance = Math.max(0, Number(i.total_cents) - Number(i.paid_cents));
    items.push({
      key: `invoice:${i.id}`, kind: "invoice", flag: i.payment_status === "overdue" ? "payment_overdue" : "no_next", record_id: i.id, customer_id: i.customer_id,
      customer: i.company ?? i.doc_number, ref: i.doc_number, doc_id: i.id, note: null, cents: balance,
      owner_id: i.salesperson_id, owner_name: i.owner_name, due_on: null, age_days: Math.max(0, daysBetween(created, today)), waited_hours: null,
      since: created, phone: i.phone,
    });
  }

  /* website enquiries still new: taken by me or by nobody (mine), all (everyone) */
  if (canUser(user, "enquiry_manage")) {
    type E = { id: number; name: string; company: string | null; phone: string | null; message: string; status: string; created_at: string; replied_at: string | null;
      assigned_to: number | null; assigned_name: string | null };
    const enq = await quiet(async () => (await env.DB.prepare(
      `SELECT e.id, e.name, e.company, e.phone, e.message, e.status, e.created_at, e.replied_at, e.assigned_to, ${NAME("a")} AS assigned_name
         FROM enquiries e LEFT JOIN users a ON a.id = e.assigned_to
        WHERE e.status = 'new' AND (?1 = 0 OR e.assigned_to = ?2 OR e.assigned_to IS NULL)
        ORDER BY e.created_at LIMIT 200`,
    ).bind(mine ? 1 : 0, user.id).all<E>()).results ?? []);
    for (const e of enq) {
      if (e.replied_at) continue; // answered: waiting on the customer now
      items.push({
        key: `enquiry:${e.id}`, kind: "enquiry", flag: enquiryLate(e) ? "waiting" : "new", record_id: e.id, customer_id: null,
        customer: (e.company ?? "").trim() || e.name, ref: null, doc_id: null, note: e.message.slice(0, 140), cents: null,
        owner_id: e.assigned_to, owner_name: e.assigned_name, due_on: null, age_days: null, waited_hours: Math.round(hoursWaiting(e.created_at)),
        since: e.created_at, phone: e.phone,
      });
    }
  }

  /* Business Growth Check: the Desk's three conditions (v1.369.0), now said here */
  if (growthViewer(user)) {
    type G = { id: number; ref: string; full_name: string; business_name: string; whatsapp: string; status: string; owner_id: number | null; owner_name: string | null;
      created_at: string; picked_at: string | null; first_response_at: string | null; next_follow_up_on: string | null };
    const gs = await quiet(async () => (await env.DB.prepare(
      `SELECT g.id, g.ref, g.full_name, g.business_name, g.whatsapp, g.status, g.owner_id, ${NAME("u")} AS owner_name, g.created_at, g.picked_at, g.first_response_at, g.next_follow_up_on
         FROM business_growth_enquiries g LEFT JOIN users u ON u.id = g.owner_id
        WHERE g.status IN ('new', 'assigned', 'contacted', 'problem_identified', 'advice_delivered', 'qualified', 'follow_up')
          AND (g.status = 'new' OR ?1 = 0 OR g.owner_id = ?2) ORDER BY g.id LIMIT 200`,
    ).bind(mine ? 1 : 0, user.id).all<G>()).results ?? []);
    const hours = (ts: string) => hoursWaiting(ts);
    for (const g of gs) {
      const base = { kind: "growth" as const, record_id: g.id, customer_id: null, customer: g.business_name, ref: g.ref, doc_id: null, cents: null,
        owner_id: g.owner_id, owner_name: g.owner_name, age_days: null, phone: g.whatsapp, key: `growth:${g.id}` };
      if (g.status === "new" && g.owner_id === null) {
        items.push({ ...base, flag: hours(g.created_at) > 4 ? "waiting" : "new", note: `${g.full_name} - not picked up`, due_on: null, waited_hours: Math.round(hours(g.created_at)), since: g.created_at });
      } else if (g.owner_id !== null && !g.first_response_at) {
        const from = g.picked_at ?? g.created_at;
        items.push({ ...base, flag: hours(from) > 24 ? "waiting" : "new", note: `${g.full_name} - no contact yet`, due_on: null, waited_hours: Math.round(hours(from)), since: from });
      } else if (g.owner_id !== null && g.next_follow_up_on) {
        const flag = followupFlag(g.next_follow_up_on, today);
        if (flag) items.push({ ...base, flag, note: `${g.full_name} - follow-up`, due_on: g.next_follow_up_on, waited_hours: null, since: g.next_follow_up_on });
      }
    }
  }

  /* v1.398.0 (Phase 2, Leads & CRM) - a lead someone owns, marked new / contacted / qualified,
     with nothing booked next and no other row on this list: amber "No next action". A customer
     already on the list (a follow-up, a quotation, an invoice) is not listed twice. */
  {
    const listed = new Set(items.map((i) => i.customer_id).filter((x): x is number => x !== null));
    type L = { id: number; company: string; phone: string | null; owner_id: number; owner_name: string | null; created_at: string; status: string };
    for (const l of await quiet(async () => (await env.DB.prepare(
      `SELECT c.id, c.company, c.phone, c.owner_id, ${NAME("u")} AS owner_name, c.created_at, c.relationship_status AS status
         FROM customers c LEFT JOIN users u ON u.id = c.owner_id
        WHERE c.owner_id IS NOT NULL AND c.relationship_status IN ('new_lead', 'contacted', 'qualified')
          AND (?1 = 0 OR c.owner_id = ?2)
          AND NOT EXISTS (SELECT 1 FROM customer_followups f WHERE f.customer_id = c.id AND f.done_at IS NULL AND f.cancelled_at IS NULL)
        ORDER BY c.created_at LIMIT 300`,
    ).bind(mine ? 1 : 0, user.id).all<L>()).results ?? [])) {
      if (listed.has(l.id)) continue;
      items.push({ key: `lead:${l.id}`, kind: "lead", flag: "no_next", record_id: l.id, customer_id: l.id, customer: l.company, ref: null, doc_id: null,
        note: null, cents: null, owner_id: l.owner_id, owner_name: l.owner_name, due_on: null, age_days: daysBetween(mytDay(l.created_at) ?? today, today),
        waited_hours: null, since: l.created_at, phone: l.phone, lead_status: l.status });
    }
  }

  /* reported payments waiting on the one verifier (payment-verify.ts) - a count and a link, never the queue */
  let verify: number | null = null;
  if (canUser(user, "payment_verify") && user.role === "ceo" && user.is_owner === true) {
    const r = await quiet(async () => [await env.DB.prepare(`SELECT COUNT(*) AS n FROM invoice_payment_reports WHERE state IN ('reported', 'evidence_checked')`).first<{ n: number }>()]);
    verify = Number(r[0]?.n ?? 0);
  }
  return { items: rankActions(items), verify };
}

/** What the Desk and the Dashboard print: the viewer's own (mine) count, from the same list */
export async function salesTodayCounts(env: Env, user: { id: number; role: string }): Promise<ReturnType<typeof actionCounts>> {
  /* the Desk hands its session user (a StaffUser at run time: is_owner and custom_role ride along) */
  return actionCounts((await salesActions(env, { user: user as StaffUser, scope: "mine" })).items);
}

/* ------------------------------------------------------------------ */
/* done today - only the viewer's own recorded actions                 */
/* ------------------------------------------------------------------ */
export async function doneToday(env: Env, uid: number, today = mytToday()): Promise<SalesDone[]> {
  const out: SalesDone[] = [];
  type R = { id: number; at: string; customer: string | null; ref: string | null; detail: string | null; customer_id: number | null; doc_id: number | null };
  const add = (kind: SalesDone["kind"], rows: R[]) => {
    for (const r of rows) out.push({ key: `${kind}:${r.id}`, kind, at: r.at, customer: r.customer ?? "", ref: r.ref, detail: r.detail, customer_id: r.customer_id, doc_id: r.doc_id, record_id: r.id });
  };
  add("followup_done", await quiet(async () => (await env.DB.prepare(
    `SELECT f.id, f.done_at AS at, c.company AS customer, d.doc_number AS ref, COALESCE(f.outcome, f.done_note) AS detail, f.customer_id, f.doc_id
       FROM customer_followups f JOIN customers c ON c.id = f.customer_id LEFT JOIN sales_documents d ON d.id = f.doc_id
      WHERE f.done_by = ?1 AND f.done_at IS NOT NULL AND date(f.done_at, '+8 hours') = ?2`,
  ).bind(uid, today).all<R>()).results ?? []));
  add("next_booked", await quiet(async () => (await env.DB.prepare(
    `SELECT f.id, f.created_at AS at, c.company AS customer, d.doc_number AS ref, f.due_on AS detail, f.customer_id, f.doc_id
       FROM customer_followups f JOIN customers c ON c.id = f.customer_id LEFT JOIN sales_documents d ON d.id = f.doc_id
      WHERE f.created_by = ?1 AND date(f.created_at, '+8 hours') = ?2 AND f.cancelled_at IS NULL`,
  ).bind(uid, today).all<R>()).results ?? []));
  add("enquiry_replied", await quiet(async () => (await env.DB.prepare(
    `SELECT e.id, e.replied_at AS at, COALESCE(NULLIF(TRIM(e.company), ''), e.name) AS customer, NULL AS ref, e.status AS detail, NULL AS customer_id, NULL AS doc_id
       FROM enquiries e WHERE e.replied_by = ?1 AND e.replied_at IS NOT NULL AND date(e.replied_at, '+8 hours') = ?2`,
  ).bind(uid, today).all<R>()).results ?? []));
  add("growth_recorded", await quiet(async () => (await env.DB.prepare(
    `SELECT MIN(ev.id) AS id, MAX(ev.created_at) AS at, g.business_name AS customer, g.ref AS ref, GROUP_CONCAT(ev.kind, ', ') AS detail, NULL AS customer_id, NULL AS doc_id
       FROM business_growth_events ev JOIN business_growth_enquiries g ON g.id = ev.enquiry_id
      WHERE ev.actor_id = ?1 AND date(ev.created_at, '+8 hours') = ?2 AND ev.kind IN ('contact', 'problem', 'advice', 'follow_up', 'quotation', 'qualified', 'not_interested')
      GROUP BY ev.enquiry_id`,
  ).bind(uid, today).all<R>()).results ?? []));
  add("quotation_issued", await quiet(async () => (await env.DB.prepare(
    `SELECT d.id, d.created_at AS at, c.company AS customer, d.doc_number AS ref, NULL AS detail, d.customer_id, d.id AS doc_id
       FROM sales_documents d LEFT JOIN customers c ON c.id = d.customer_id
      WHERE d.doc_type = 'QT' AND d.created_by = ?1 AND date(d.created_at, '+8 hours') = ?2`,
  ).bind(uid, today).all<R>()).results ?? []));
  add("payment_reported", await quiet(async () => (await env.DB.prepare(
    `SELECT r.id, r.reported_at AS at, c.company AS customer, d.doc_number AS ref, NULL AS detail, d.customer_id, d.id AS doc_id
       FROM invoice_payment_reports r JOIN sales_documents d ON d.id = r.invoice_id LEFT JOIN customers c ON c.id = d.customer_id
      WHERE r.reported_by = ?1 AND date(r.reported_at, '+8 hours') = ?2`,
  ).bind(uid, today).all<R>()).results ?? []));
  /* v1.398.0 - a call, WhatsApp, email, meeting, note or proposal logged in Leads & CRM (a closed
     follow-up is already counted above as followup_done, so its activity row is left out) */
  add("activity_logged", await quiet(async () => (await env.DB.prepare(
    `SELECT a.id, a.occurred_at AS at, c.company AS customer, NULL AS ref, a.kind || CASE WHEN a.outcome IS NOT NULL THEN ': ' || a.outcome ELSE '' END AS detail, a.customer_id, NULL AS doc_id
       FROM sales_activities a JOIN customers c ON c.id = a.customer_id
      WHERE a.created_by = ?1 AND a.kind != 'followup' AND date(a.created_at, '+8 hours') = ?2`,
  ).bind(uid, today).all<R>()).results ?? []));
  return out.sort((a, b) => b.at.localeCompare(a.at));
}

/* ------------------------------------------------------------------ */
/* recent activities - the records themselves, newest first           */
/* ------------------------------------------------------------------ */
export async function recentActivities(env: Env, v: SalesViewer, today = mytToday()): Promise<SalesActivity[]> {
  const mine = v.scope === "mine" ? 1 : 0, uid = v.user.id, since = addDays(today, -30);
  const out: SalesActivity[] = [];
  type D = { id: number; doc_type: string; doc_number: string; at: string; customer: string | null; cents: number; customer_id: number | null };
  for (const d of await quiet(async () => (await env.DB.prepare(
    `SELECT d.id, d.doc_type, d.doc_number, d.created_at AS at, c.company AS customer, d.total_cents AS cents, d.customer_id
       FROM sales_documents d LEFT JOIN customers c ON c.id = d.customer_id
      WHERE d.doc_type IN ('QT', 'INV') AND d.voided_at IS NULL AND date(d.created_at, '+8 hours') >= ?1
        AND (?2 = 0 OR d.salesperson_id = ?3 OR (d.salesperson_id IS NULL AND d.created_by = ?3))
      ORDER BY d.created_at DESC LIMIT 20`,
  ).bind(since, mine, uid).all<D>()).results ?? [])) {
    out.push({ key: `doc:${d.id}`, group: "sales", kind: d.doc_type === "QT" ? "quotation" : "invoice", at: d.at,
      title: d.doc_number, customer: d.customer, cents: Number(d.cents), detail: null, doc_id: d.id, customer_id: d.customer_id, record_id: d.id });
  }
  type F = { id: number; at: string; customer: string; ref: string | null; outcome: string | null; customer_id: number; doc_id: number | null; by: string | null };
  for (const f of await quiet(async () => (await env.DB.prepare(
    `SELECT f.id, f.done_at AS at, c.company AS customer, d.doc_number AS ref, COALESCE(f.outcome, f.done_note) AS outcome, f.customer_id, f.doc_id, ${NAME("u")} AS by
       FROM customer_followups f JOIN customers c ON c.id = f.customer_id LEFT JOIN sales_documents d ON d.id = f.doc_id LEFT JOIN users u ON u.id = f.done_by
      WHERE f.done_at IS NOT NULL AND date(f.done_at, '+8 hours') >= ?1 AND (?2 = 0 OR f.done_by = ?3 OR f.owner_id = ?3)
      ORDER BY f.done_at DESC LIMIT 20`,
  ).bind(since, mine, uid).all<F>()).results ?? [])) {
    out.push({ key: `fu:${f.id}`, group: "followups", kind: "followup_done", at: f.at, title: f.ref ?? f.customer, customer: f.customer, cents: null,
      detail: [f.outcome, f.by].filter(Boolean).join(" · ") || null, doc_id: f.doc_id, customer_id: f.customer_id, record_id: f.id });
  }
  type P = { id: number; state: string; reported_at: string; decided_at: string | null; amount_cents: number; verified_cents: number | null; doc_number: string; invoice_id: number; customer: string | null; customer_id: number | null; reporter: string | null };
  for (const p of await quiet(async () => (await env.DB.prepare(
    `SELECT r.id, r.state, r.reported_at, r.decided_at, r.amount_cents, r.verified_cents, d.doc_number, d.id AS invoice_id, c.company AS customer, d.customer_id, ${NAME("u")} AS reporter
       FROM invoice_payment_reports r JOIN sales_documents d ON d.id = r.invoice_id LEFT JOIN customers c ON c.id = d.customer_id LEFT JOIN users u ON u.id = r.reported_by
      WHERE date(COALESCE(r.decided_at, r.reported_at), '+8 hours') >= ?1 AND (?2 = 0 OR r.reported_by = ?3 OR d.salesperson_id = ?3)
      ORDER BY COALESCE(r.decided_at, r.reported_at) DESC LIMIT 20`,
  ).bind(since, mine, uid).all<P>()).results ?? [])) {
    const verified = p.state === "verified" && p.decided_at;
    out.push({ key: `pay:${p.id}`, group: "payments", kind: verified ? "payment_verified" : "payment_reported", at: verified ? p.decided_at! : p.reported_at,
      title: p.doc_number, customer: p.customer, cents: Number(verified ? (p.verified_cents ?? p.amount_cents) : p.amount_cents),
      detail: verified ? null : [p.state, p.reporter].filter(Boolean).join(" · "), doc_id: p.invoice_id, customer_id: p.customer_id, record_id: p.id });
  }
  if (canUser(v.user, "enquiry_manage")) {
    type E = { id: number; at: string; customer: string; category: string | null };
    for (const e of await quiet(async () => (await env.DB.prepare(
      `SELECT e.id, e.created_at AS at, COALESCE(NULLIF(TRIM(e.company), ''), e.name) AS customer, e.category FROM enquiries e
        WHERE date(e.created_at, '+8 hours') >= ?1 AND (?2 = 0 OR e.assigned_to = ?3 OR e.assigned_to IS NULL)
        ORDER BY e.created_at DESC LIMIT 20`,
    ).bind(since, mine, uid).all<E>()).results ?? [])) {
      out.push({ key: `enq:${e.id}`, group: "enquiries", kind: "enquiry", at: e.at, title: e.customer, customer: e.customer, cents: null, detail: e.category, doc_id: null, customer_id: null, record_id: e.id });
    }
  }
  /* v1.398.0 - contact logged in Leads & CRM (the closed follow-ups are listed above) */
  {
    type A = { id: number; at: string; customer: string; kind: string; outcome: string | null; by_name: string | null; customer_id: number };
    for (const a of await quiet(async () => (await env.DB.prepare(
      `SELECT a.id, a.occurred_at AS at, c.company AS customer, a.kind, a.outcome, ${NAME("u")} AS by_name, a.customer_id
         FROM sales_activities a JOIN customers c ON c.id = a.customer_id LEFT JOIN users u ON u.id = a.created_by
        WHERE a.kind != 'followup' AND date(a.occurred_at, '+8 hours') >= ?1 AND (?2 = 0 OR a.created_by = ?3 OR c.owner_id = ?3)
        ORDER BY a.occurred_at DESC LIMIT 20`,
    ).bind(since, mine, uid).all<A>()).results ?? [])) {
      out.push({ key: `act:${a.id}`, group: "followups", kind: "activity", at: a.at, title: a.customer, customer: a.customer, cents: null,
        detail: [a.kind, a.outcome, a.by_name].filter(Boolean).join(" · "), doc_id: null, customer_id: a.customer_id, record_id: a.id });
    }
  }
  if (growthViewer(v.user)) {
    type G = { id: number; at: string; ref: string; business_name: string; source: string };
    for (const g of await quiet(async () => (await env.DB.prepare(
      `SELECT g.id, g.created_at AS at, g.ref, g.business_name, g.source FROM business_growth_enquiries g
        WHERE date(g.created_at, '+8 hours') >= ?1 AND (?2 = 0 OR g.owner_id = ?3 OR g.owner_id IS NULL)
        ORDER BY g.created_at DESC LIMIT 20`,
    ).bind(since, mine, uid).all<G>()).results ?? [])) {
      out.push({ key: `growth:${g.id}`, group: "enquiries", kind: "growth", at: g.at, title: g.ref, customer: g.business_name, cents: null, detail: g.source, doc_id: null, customer_id: null, record_id: g.id });
    }
  }
  const stamp = (s: string) => Date.parse(s.replace(" ", "T") + (/[zZ]$/.test(s) ? "" : "Z")) || 0;
  return out.sort((a, b) => stamp(b.at) - stamp(a.at)).slice(0, 40);
}

/* ------------------------------------------------------------------ */
/* the team - the weekly engine's own figures, managers only           */
/* ------------------------------------------------------------------ */
export async function teamFigures(env: Env, period: "week" | "month", today = mytToday()) {
  const startDow = await weekStartDow(env);
  const from = period === "week" ? weekStartOf(today, startDow) : `${today.slice(0, 7)}-01`;
  const to = period === "week" ? addDays(from, 6) : addDays(`${new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 1)).toISOString().slice(0, 10)}`, -1);
  const people = await staffList(env, from, to);
  type TeamRow = { user_id: number; name: string; enquiries: number | null; followups_done: number; quotations: number; paid_invoices: number; collected_cents: number; target_cents: number | null; pct: number | null };
  const rows: TeamRow[] = [];
  for (const p of people) {
    const w = await personWeek(env, p.id, from, to, today);
    let target: number | null = null;
    if (period === "week") target = (await targetFor(env, "person", p.id, from)).target_cents;
    else {
      const t = await env.DB.prepare(`SELECT target_cents FROM user_sales_targets WHERE user_id = ?1 AND month = ?2`).bind(p.id, from.slice(0, 7)).first<{ target_cents: number }>().catch(() => null);
      target = t ? Number(t.target_cents) : null;
    }
    rows.push({
      user_id: p.id, name: p.name,
      /* activity */
      enquiries: w.enquiries, followups_done: w.followups_done, quotations: w.quotations.n,
      /* results - the engine's basis: invoices paid in full, by closer */
      paid_invoices: w.paid_invoices, collected_cents: w.basis_cents, target_cents: target,
      pct: target && target > 0 ? Math.round((w.basis_cents / target) * 1000) / 10 : null,
    });
  }
  rows.sort((a, b) => b.collected_cents - a.collected_cents || a.name.localeCompare(b.name));
  const sum = (k: "followups_done" | "quotations" | "paid_invoices" | "collected_cents") => rows.reduce((s, r) => s + r[k], 0);
  const tgt = rows.every((r) => r.target_cents === null) ? null : rows.reduce((s, r) => s + (r.target_cents ?? 0), 0);
  return {
    period, from, to, rows,
    total: { enquiries: rows.reduce((s, r) => s + (r.enquiries ?? 0), 0), followups_done: sum("followups_done"), quotations: sum("quotations"),
      paid_invoices: sum("paid_invoices"), collected_cents: sum("collected_cents"), target_cents: tgt,
      pct: tgt && tgt > 0 ? Math.round((sum("collected_cents") / tgt) * 1000) / 10 : null },
  };
}

/* ------------------------------------------------------------------ */
/* the route                                                           */
/* ------------------------------------------------------------------ */
export async function handleSalesToday(env: Env, path: string, method: string, user: StaffUser, params: URLSearchParams): Promise<Response | null> {
  if (path !== "/sales/today") return null;
  if (method !== "GET") return err("method_not_allowed", "Read only", 405);
  if (["agent", "customer"].includes(user.role) || !readsSales(user)) return err("forbidden", "Sales access required", 403);
  const today = mytToday();
  const scope: SalesScope = params.get("scope") === "all" ? "all" : "mine";
  const { items, verify } = await salesActions(env, { user, scope }, today);
  const counts = actionCounts(items);
  if (params.get("summary") === "1") return json({ today, scope, counts, verify });
  const done = await doneToday(env, user.id, today);
  const recent = await recentActivities(env, { user, scope }, today);
  const period = params.get("period") === "month" ? "month" : "week";
  /* the team table follows the permission, not the list's Mine/Everyone (decision 2: a manager's list opens on Mine) */
  const team = canUser(user, "exec_view") ? await teamFigures(env, period, today) : null;
  return json({ today, scope, items, counts, verify, done, progress: { done: done.length, open: counts.total }, recent, team });
}
