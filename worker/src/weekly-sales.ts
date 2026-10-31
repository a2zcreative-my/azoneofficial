/* v1.223.0 - WEEKLY SALES: TARGETS, SCORECARD, RECOVERY PLANS.
 *
 * The owner's brief and answers, 28-10-2026 (claude/WEEKLY-SALES-AUDIT.md):
 *   "Approved weekly targets" - a target is a row from a week onward, set by
 *     the CEO, COO or super admin with a reason; a change is a new row, so
 *     the history stays; with none, "Target not set" - nothing is prorated
 *     or invented;
 *   "Paid in full" - the basis is the Sales "Collected" rule exactly
 *     (invoices paid in full, on their paid day in Malaysia time, by closer);
 *     the CEO/COO-confirmed amount is shown beside it, never instead;
 *   "Tasks with a link" - sales work is a Task (staff.ts /tasks) that names
 *     its customer, enquiry, quotation or recovery plan; this file creates a
 *     task only when a plan is approved, through the same table, once;
 *   "CEO, COO, super admin" - they set targets and approve plans; the CCO
 *     and admin read and comment; a consultant reads only their own week.
 *
 * Nothing here is disciplinary: a status is a prompt to act. No message is
 * sent to a customer, no sale is promised, no commission is calculated
 * (Phase B waits for the policy). A finished week is written down ONCE; a
 * later change shows beside it, it never rewrites it.
 */
import type { Env } from "./index";
import type { StaffUser } from "./staff";
import { PERMS, can } from "./permissions";
import { buildOrg, reportingLine, type OrgNode, type OrgPerson } from "../../lib/org-tree";
import { audit, err, json, str } from "./shared";

/* v1.239.0 - who sets targets is the matrix capability sales_week_target
   (default super admin, CEO, COO); this name stays for the readers of 1.223 */
export const WEEK_TARGET_ROLES: readonly string[] = PERMS.sales_week_target ?? [];
/* v1.239.0 - CONTRIBUTION GOALS (the owner, 31-10-2026, claude/WEEKLY-TARGET-
   DASHBOARD-AUDIT.md: "Revenue + goals"). Besides revenue, management may
   give a person a weekly COUNT on one of these, each counted from the record
   that already owns it - never typed in, never estimated. */
export const GOAL_METRICS = ["quotations", "followups", "qualified_enquiries", "introductions"] as const;
export type GoalMetric = typeof GOAL_METRICS[number];
const VIEW_ALL = (u: StaffUser) => can(u.role, "exec_view"); // super admin, admin, CEO, COO, CCO
const SELLER_ROLES = ["sales_marketing"];
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const mytToday = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const dow = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay(); // 0 Sunday

/** The first day of the business week holding `d` (default Monday). */
export function weekStartOf(d: string, startDow = 1): string {
  return addDays(d, -((dow(d) - startDow + 7) % 7));
}

async function weekStartDow(env: Env): Promise<number> {
  try {
    const r = await env.DB.prepare(`SELECT value FROM business_settings WHERE key = 'sales_week_start'`).first<{ value: string | null }>();
    const n = Number(r?.value);
    return Number.isInteger(n) && n >= 0 && n <= 6 ? n : 1;
  } catch { return 1; }
}

type Resolved = { target_cents: number | null; target_count: number | null; from: string | null; set_by: string | null; reason: string | null; id: number | null };
const NONE: Resolved = { target_cents: null, target_count: null, from: null, set_by: null, reason: null, id: null };
/** The approved target for a week: the latest row from that week or before,
    for one metric (revenue unless named; rows from before 0156 are revenue). */
async function targetFor(env: Env, scope: "person" | "team" | "company", key: number | string | null, week: string, metric: "revenue" | GoalMetric = "revenue"): Promise<Resolved> {
  const where = scope === "person" ? "t.user_id = ?2" : scope === "team" ? "t.team = ?2" : "?2 IS NULL";
  type Row = { id: number; target_cents: number | null; target_count?: number | null; week_from: string; reason: string; who: string | null };
  let r: Row | null = null;
  try {
    r = await env.DB.prepare(
      `SELECT t.id, t.target_cents, t.target_count, t.week_from, t.reason, COALESCE(NULLIF(TRIM(u.full_name), ''), u.name) AS who
         FROM sales_week_targets t LEFT JOIN users u ON u.id = t.set_by
        WHERE t.scope = ?1 AND ${where} AND COALESCE(t.metric, 'revenue') = ?4 AND t.week_from <= ?3 ORDER BY t.week_from DESC, t.id DESC LIMIT 1`,
    ).bind(scope, scope === "company" ? null : key, week, metric).first<Row>();
  } catch (e) {
    if (metric !== "revenue" || !/no such column/i.test(String(e))) return NONE;
    try { // pre-0156: every row is revenue
      r = await env.DB.prepare(
        `SELECT t.id, t.target_cents, t.week_from, t.reason, COALESCE(NULLIF(TRIM(u.full_name), ''), u.name) AS who
           FROM sales_week_targets t LEFT JOIN users u ON u.id = t.set_by
          WHERE t.scope = ?1 AND ${where} AND t.week_from <= ?3 ORDER BY t.week_from DESC, t.id DESC LIMIT 1`,
      ).bind(scope, scope === "company" ? null : key, week).first<Row>();
    } catch { return NONE; }
  }
  if (!r) return NONE;
  return { target_cents: r.target_cents === null ? null : Number(r.target_cents), target_count: r.target_count == null ? null : Number(r.target_count),
    from: r.week_from, set_by: r.who, reason: r.reason, id: r.id };
}

/** A person's contribution goals for the week: each metric with a count in
    force, and what the records show for it. An introduction counts only once
    somebody else (Sales) has marked it qualified. */
async function goalsFor(env: Env, uid: number, from: string, to: string) {
  const out: { metric: GoalMetric; target: number; actual: number; pct: number; from: string | null; set_by: string | null }[] = [];
  const count = async (sql: string) => { try { return Number((await env.DB.prepare(sql).bind(uid, from, to).first<{ n: number }>())?.n ?? 0); } catch { return 0; } };
  const SQL: Record<GoalMetric, string> = {
    quotations: `SELECT COUNT(*) AS n FROM sales_documents WHERE doc_type = 'QT' AND salesperson_id = ?1 AND date(created_at, '+8 hours') BETWEEN ?2 AND ?3`,
    followups: `SELECT COUNT(*) AS n FROM customer_followups WHERE owner_id = ?1 AND done_at IS NOT NULL AND date(done_at, '+8 hours') BETWEEN ?2 AND ?3`,
    qualified_enquiries: `SELECT COUNT(*) AS n FROM enquiries WHERE qualified_by = ?1 AND qualified_at IS NOT NULL AND date(qualified_at, '+8 hours') BETWEEN ?2 AND ?3`,
    introductions: `SELECT COUNT(*) AS n FROM enquiries WHERE referred_by = ?1 AND qualified_at IS NOT NULL AND COALESCE(qualified_by, 0) != ?1 AND date(qualified_at, '+8 hours') BETWEEN ?2 AND ?3`,
  };
  for (const m of GOAL_METRICS) {
    const t = await targetFor(env, "person", uid, from, m);
    if (t.target_count === null || t.target_count <= 0) continue;
    const actual = await count(SQL[m]);
    out.push({ metric: m, target: t.target_count, actual, pct: Math.round((actual / t.target_count) * 100), from: t.from, set_by: t.set_by });
  }
  return out;
}

/** Working days in [from, to] for one person: Monday to Friday, less public
    holidays and that person's approved leave (a half day counts half). */
async function workingDays(env: Env, uid: number, from: string, to: string): Promise<{ total: number; days: { day: string; weight: number }[] }> {
  const holidays = new Set<string>();
  try {
    const { results } = await env.DB.prepare(`SELECT holiday_date FROM holidays WHERE holiday_date BETWEEN ?1 AND ?2`).bind(from, to).all<{ holiday_date: string }>();
    for (const h of results ?? []) holidays.add(h.holiday_date);
  } catch { /* no holidays table */ }
  const leave = new Map<string, number>();
  try {
    const { results } = await env.DB.prepare(
      `SELECT start_date, end_date, days, day_part FROM leave_requests WHERE user_id = ?1 AND status = 'approved' AND start_date <= ?3 AND end_date >= ?2`,
    ).bind(uid, from, to).all<{ start_date: string; end_date: string; days: number; day_part: string | null }>();
    for (const l of results ?? []) {
      const half = (l.day_part && l.day_part !== "full") || (l.start_date === l.end_date && Number(l.days) > 0 && Number(l.days) < 1);
      for (let d = l.start_date > from ? l.start_date : from; d <= (l.end_date < to ? l.end_date : to); d = addDays(d, 1)) leave.set(d, Math.max(leave.get(d) ?? 0, half ? 0.5 : 1));
    }
  } catch {
    try {
      const { results } = await env.DB.prepare(`SELECT start_date, end_date FROM leave_requests WHERE user_id = ?1 AND status = 'approved' AND start_date <= ?3 AND end_date >= ?2`).bind(uid, from, to).all<{ start_date: string; end_date: string }>();
      for (const l of results ?? []) for (let d = l.start_date > from ? l.start_date : from; d <= (l.end_date < to ? l.end_date : to); d = addDays(d, 1)) leave.set(d, 1);
    } catch { /* no leave table */ }
  }
  /* v1.223.1 - only the days they were employed: not before joining, not
     after the last day on the Staff record (a re-joiner counts again) */
  let emp: { joined_on: string | null; left_on: string | null; rejoined_on: string | null } | null = null;
  try { emp = await env.DB.prepare(`SELECT joined_on, left_on, rejoined_on FROM users WHERE id = ?1`).bind(uid).first(); } catch { emp = null; }
  const employed = (d: string) => {
    if (emp?.joined_on && d < emp.joined_on.slice(0, 10)) return false;
    if (emp?.left_on && d > emp.left_on.slice(0, 10)) return Boolean(emp.rejoined_on && d >= emp.rejoined_on.slice(0, 10));
    return true;
  };
  const days: { day: string; weight: number }[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const w = dow(d);
    if (w === 0 || w === 6 || holidays.has(d) || !employed(d)) continue;
    const weight = 1 - (leave.get(d) ?? 0);
    if (weight > 0) days.push({ day: d, weight });
  }
  return { total: days.reduce((s, x) => s + x.weight, 0), days };
}

export type WeekStatus = "no_target" | "not_working" | "planning" | "achieved" | "on_track" | "at_risk" | "action" | "missed";

/** The week's numbers for one person - each from the record that owns it. */
async function personWeek(env: Env, uid: number, from: string, to: string, today: string) {
  const one = async <T>(sql: string, ...b: unknown[]) => { try { return (await env.DB.prepare(sql).bind(...b).first<T>()) as T; } catch { return null as T; } };
  const PAID_DAY = `date(COALESCE(d.paid_at, d.created_at), '+8 hours')`;
  const basis = await one<{ c: number; n: number }>(
    `SELECT COALESCE(SUM(d.total_cents), 0) AS c, COUNT(*) AS n FROM sales_documents d
      WHERE d.doc_type = 'INV' AND d.payment_status = 'paid' AND d.salesperson_id = ?1 AND ${PAID_DAY} BETWEEN ?2 AND ?3`, uid, from, to);
  const confirmed = await one<{ c: number; n: number }>(
    `SELECT COALESCE(SUM(d.total_cents), 0) AS c, COUNT(*) AS n FROM sales_documents d
      WHERE d.doc_type = 'INV' AND d.payment_status = 'paid' AND d.salesperson_id = ?1 AND ${PAID_DAY} BETWEEN ?2 AND ?3
        AND EXISTS (SELECT 1 FROM invoice_paid_confirmations k WHERE k.invoice_id = d.id AND k.revoked_at IS NULL)`, uid, from, to);
  const quotes = await one<{ c: number; n: number }>(
    `SELECT COALESCE(SUM(total_cents), 0) AS c, COUNT(*) AS n FROM sales_documents WHERE doc_type = 'QT' AND salesperson_id = ?1 AND date(created_at, '+8 hours') BETWEEN ?2 AND ?3`, uid, from, to);
  const won = await one<{ c: number; n: number }>(
    `SELECT COALESCE(SUM(total_cents), 0) AS c, COUNT(*) AS n FROM sales_documents WHERE doc_type = 'INV' AND converted_from IS NOT NULL AND salesperson_id = ?1 AND date(created_at, '+8 hours') BETWEEN ?2 AND ?3`, uid, from, to);
  const open = await one<{ c: number; n: number }>(
    `SELECT COALESCE(SUM(q.total_cents), 0) AS c, COUNT(*) AS n FROM sales_documents q
      WHERE q.doc_type = 'QT' AND q.salesperson_id = ?1
        AND NOT EXISTS (SELECT 1 FROM sales_documents i WHERE i.converted_from = q.id AND i.doc_type = 'INV')
        AND (q.valid_until IS NULL OR substr(q.valid_until, 1, 10) >= ?2)`, uid, today);
  const fuDone = await one<{ n: number }>(`SELECT COUNT(*) AS n FROM customer_followups WHERE owner_id = ?1 AND done_at IS NOT NULL AND date(done_at, '+8 hours') BETWEEN ?2 AND ?3`, uid, from, to);
  const fuOver = await one<{ n: number }>(`SELECT COUNT(*) AS n FROM customer_followups WHERE owner_id = ?1 AND done_at IS NULL AND cancelled_at IS NULL AND due_on < ?2`, uid, today);
  const enq = await one<{ n: number }>(`SELECT COUNT(*) AS n FROM enquiries WHERE assigned_to = ?1 AND date(created_at, '+8 hours') BETWEEN ?2 AND ?3`, uid, from, to);
  const cust = await one<{ n: number }>(`SELECT COUNT(*) AS n FROM customers WHERE created_by = ?1 AND date(created_at, '+8 hours') BETWEEN ?2 AND ?3`, uid, from, to);
  const tasks = await one<{ open: number; done: number; overdue: number }>(
    `SELECT COALESCE(SUM(CASE WHEN status != 'completed' THEN 1 ELSE 0 END), 0) AS open,
            COALESCE(SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END), 0) AS done,
            COALESCE(SUM(CASE WHEN status != 'completed' AND deadline IS NOT NULL AND deadline < ?2 THEN 1 ELSE 0 END), 0) AS overdue
       FROM tasks WHERE assigned_to = ?1 AND link_kind IS NOT NULL`, uid, today);
  return {
    basis_cents: Number(basis?.c ?? 0), paid_invoices: Number(basis?.n ?? 0),
    confirmed_cents: Number(confirmed?.c ?? 0), confirmed_invoices: Number(confirmed?.n ?? 0),
    quotations: { n: Number(quotes?.n ?? 0), cents: Number(quotes?.c ?? 0) },
    won: { n: Number(won?.n ?? 0), cents: Number(won?.c ?? 0) },
    open_quotations: { n: Number(open?.n ?? 0), cents: Number(open?.c ?? 0) },
    followups_done: Number(fuDone?.n ?? 0), followups_overdue: Number(fuOver?.n ?? 0),
    enquiries: enq === null ? null : Number(enq?.n ?? 0), new_customers: Number(cust?.n ?? 0),
    tasks: { open: Number(tasks?.open ?? 0), done: Number(tasks?.done ?? 0), overdue: Number(tasks?.overdue ?? 0) },
  };
}

/** The status rule (the audit, sec. 3). Never judges a week before its
    early-warning day, never on revenue alone. */
export function statusOf(p: { target: number | null; basis: number; open: number; activity: number; total: number; elapsed: number; ended: boolean; checkpoint: boolean }): { status: WeekStatus; expected: number | null } {
  if (p.target === null) return { status: "no_target", expected: null };
  if (p.total <= 0) return { status: "not_working", expected: null };
  if (p.basis >= p.target) return { status: "achieved", expected: p.target };
  if (p.ended) return { status: "missed", expected: p.target };
  const expected = Math.round(p.target * (p.elapsed / p.total));
  if (!p.checkpoint) return { status: "planning", expected };
  if (p.basis >= expected) return { status: "on_track", expected };
  const gap = p.target - p.basis;
  if (p.open >= gap && p.activity > 0) return { status: "at_risk", expected };
  return { status: "action", expected };
}

/** v1.223.1 (the owner, 28-10-2026: a resigned consultant was still listed,
    and the people who really close sales were missing). ON STAFF FOR THE
    WEEK, from the Staff record: someone whose last day (left_on) is before
    the week is gone; someone marked Resigned or Terminated on the Staff tab
    with no last day is gone too; a re-joiner is back. Someone who leaves
    mid-week still counts for that week. Bound: ?1 = week start, ?2 = week end. */
export const onStaffForWeekSql = (a = "u.") =>
  `((${a}left_on IS NULL AND COALESCE(${a}employment_status, '') NOT IN ('resigned', 'terminated'))
    OR substr(${a}left_on, 1, 10) >= ?1
    OR (${a}rejoined_on IS NOT NULL AND substr(${a}rejoined_on, 1, 10) <= ?2))`;

/** The scorecard's people for a week: staff on the books that week (never
    a leaver, never a system account) who are sales consultants, OR have an
    approved target in force, OR closed a sale that week (salesperson on a
    quotation raised or an invoice paid in it). */
async function staffList(env: Env, from: string, to: string): Promise<{ id: number; name: string; role: string; department?: string | null }[]> {
  /* v1.239.0 - "a target in force" is the latest row per metric (0156); a
     person with only a contribution goal is on the list too */
  const IN_FORCE_0156 = `EXISTS (SELECT 1 FROM sales_week_targets t WHERE t.scope = 'person' AND t.user_id = u.id AND t.week_from <= ?1
        AND t.id = (SELECT t2.id FROM sales_week_targets t2 WHERE t2.scope = 'person' AND t2.user_id = u.id AND COALESCE(t2.metric, 'revenue') = COALESCE(t.metric, 'revenue')
                     AND t2.week_from <= ?1 ORDER BY t2.week_from DESC, t2.id DESC LIMIT 1)
        AND (t.target_cents IS NOT NULL OR COALESCE(t.target_count, 0) > 0))`;
  const IN_FORCE_0149 = `(SELECT t.target_cents FROM sales_week_targets t WHERE t.scope = 'person' AND t.user_id = u.id AND t.week_from <= ?1
                  ORDER BY t.week_from DESC, t.id DESC LIMIT 1) IS NOT NULL`;
  const run = (inForce: string) => env.DB.prepare(
    `SELECT u.id, COALESCE(NULLIF(TRIM(u.full_name), ''), u.name) AS name, u.role, u.department FROM users u
      WHERE u.is_active = 1 AND u.role NOT IN ('customer', 'super_admin', 'admin') AND ${onStaffForWeekSql()}
        AND (u.role IN (${SELLER_ROLES.map((r) => `'${r}'`).join(", ")})
             OR ${inForce}
             OR EXISTS (SELECT 1 FROM sales_documents d WHERE d.salesperson_id = u.id
                  AND ((d.doc_type = 'QT' AND date(d.created_at, '+8 hours') BETWEEN ?1 AND ?2)
                    OR (d.doc_type = 'INV' AND d.payment_status = 'paid' AND date(COALESCE(d.paid_at, d.created_at), '+8 hours') BETWEEN ?1 AND ?2)))
             /* v1.227.0 - the owner's answer "Weekly: anyone who closed": a
                person who closed any quotation or invoice in the 90 days up to
                this week stays on the scorecard, showing RM 0.00 in a quiet
                week, whatever their role. Commission does not read this list. */
             OR EXISTS (SELECT 1 FROM sales_documents d2 WHERE d2.salesperson_id = u.id AND d2.doc_type IN ('QT', 'INV')
                  AND date(d2.created_at, '+8 hours') BETWEEN date(?1, '-90 days') AND ?2))
      ORDER BY name`,
  ).bind(from, to).all<{ id: number; name: string; role: string; department: string | null }>();
  try { return (await run(IN_FORCE_0156)).results ?? []; } catch (e) {
    if (!/no such column/i.test(String(e))) throw e;
    return (await run(IN_FORCE_0149)).results ?? [];
  }
}

/** Everyone a target can be set for that week: staff on the books, any role
    but customers and the system accounts (the CEO closes sales too). */
async function targetCandidates(env: Env, from: string, to: string): Promise<{ id: number; name: string; role: string }[]> {
  const { results } = await env.DB.prepare(
    `SELECT u.id, COALESCE(NULLIF(TRIM(u.full_name), ''), u.name) AS name, u.role FROM users u
      WHERE u.is_active = 1 AND u.role NOT IN ('customer', 'super_admin', 'admin') AND ${onStaffForWeekSql()}
      ORDER BY name`,
  ).bind(from, to).all<{ id: number; name: string; role: string }>();
  return results ?? [];
}

async function planOf(env: Env, uid: number, week: string) {
  try {
    return await env.DB.prepare(`SELECT p.*, COALESCE(NULLIF(TRIM(u.full_name), ''), u.name) AS reviewer FROM sales_recovery_plans p LEFT JOIN users u ON u.id = p.reviewed_by WHERE p.user_id = ?1 AND p.week_from = ?2`)
      .bind(uid, week).first<{ id: number; status: string; actions: string; note: string | null; gap_cents: number | null; submitted_at: string | null; reviewed_at: string | null; review_note: string | null; reviewer: string | null; updated_at: string }>();
  } catch { return null; }
}

/** One person's whole week: figures, target, status, plan. */
async function weekFor(env: Env, uid: number, name: string, from: string, to: string, today: string, startDow: number) {
  const ended = to < today;
  const target = await targetFor(env, "person", uid, from);
  const f = await personWeek(env, uid, from, to, today);
  const wd = await workingDays(env, uid, from, to);
  /* elapsed = working days already over (before today); the early warning
     starts on the week's third day (Wednesday for a Monday week) */
  const elapsed = wd.days.filter((d) => d.day < today || ended).reduce((s, d) => s + d.weight, 0);
  const checkpoint = ended || today >= addDays(from, 2);
  const activity = f.followups_done + f.quotations.n + f.tasks.done + (f.enquiries ?? 0) + f.new_customers;
  const st = statusOf({ target: target.target_cents, basis: f.basis_cents, open: f.open_quotations.cents, activity, total: wd.total, elapsed, ended, checkpoint });
  const plan = await planOf(env, uid, from);
  const goals = await goalsFor(env, uid, from, to);
  let final: { status: string | null; basis_cents: number; target_cents: number | null; finalised_at: string } | null = null;
  try { final = await env.DB.prepare(`SELECT status, basis_cents, target_cents, finalised_at FROM sales_week_results WHERE week_from = ?1 AND user_id = ?2`).bind(from, uid).first(); } catch { final = null; }
  return {
    user_id: uid, name, week_start_dow: startDow,
    target_cents: target.target_cents, target_from: target.from, target_set_by: target.set_by, target_reason: target.reason,
    ...f,
    pct: target.target_cents ? Math.round((f.basis_cents / target.target_cents) * 100) : null,
    gap_cents: target.target_cents === null ? null : Math.max(0, target.target_cents - f.basis_cents),
    working_days: wd.total, elapsed_days: elapsed, expected_cents: st.expected, status: st.status, activity, goals,
    plan: plan ? { id: plan.id, status: plan.status, updated_at: plan.updated_at, reviewed_at: plan.reviewed_at, reviewer: plan.reviewer } : null,
    final: final ? { ...final, changed_cents: f.basis_cents - Number(final.basis_cents) } : null,
  };
}

/** Write a finished week down once (the first read after it ends). */
async function finalise(env: Env, from: string, rows: Awaited<ReturnType<typeof weekFor>>[], company: { target: number | null; basis: number; confirmed: number }) {
  try {
    const stmts = rows.map((r) => env.DB.prepare(
      `INSERT OR IGNORE INTO sales_week_results (week_from, user_id, target_cents, basis_cents, confirmed_cents, status, figures) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
    ).bind(from, r.user_id, r.target_cents, r.basis_cents, r.confirmed_cents, r.status,
      JSON.stringify({ paid_invoices: r.paid_invoices, quotations: r.quotations, won: r.won, followups_done: r.followups_done, enquiries: r.enquiries, new_customers: r.new_customers, tasks: r.tasks, working_days: r.working_days })));
    stmts.push(env.DB.prepare(
      `INSERT OR IGNORE INTO sales_week_results (week_from, user_id, target_cents, basis_cents, confirmed_cents, status, figures) VALUES (?1, 0, ?2, ?3, ?4, ?5, '{}')`,
    ).bind(from, company.target, company.basis, company.confirmed, company.target === null ? "no_target" : company.basis >= company.target ? "achieved" : "missed"));
    await env.DB.batch(stmts);
  } catch { /* pre-0149 - nothing to write to */ }
}

/** v1.223.0 (the owner's "Tasks with a link") - POST /tasks: a sales task
    names the customer, enquiry or quotation it is about. The record must
    exist, and one open task per person and record is enough: a second
    assignment returns the open one instead of making a duplicate (the
    insert in staff.ts also refuses one with NOT EXISTS). Returns null for
    an ordinary task, the link, or the Response to send. */
export async function taskLink(env: Env, body: Record<string, unknown>, assignedTo: number): Promise<{ kind: string; id: number } | Response | null> {
  const LINK_KINDS = ["customer", "enquiry", "quotation"];
  const kind = typeof body.link_kind === "string" && LINK_KINDS.includes(body.link_kind) ? body.link_kind : null;
  const id = kind && typeof body.link_id === "number" && Number.isInteger(body.link_id) && body.link_id > 0 ? body.link_id : null;
  if (body.link_kind !== undefined && body.link_kind !== null && (!kind || !id)) {
    return err("invalid_input", "A linked task needs a customer, enquiry or quotation and its id", 400);
  }
  if (!kind || !id) return null;
  const exists = await env.DB.prepare(
    kind === "customer" ? `SELECT id FROM customers WHERE id = ?1`
      : kind === "enquiry" ? `SELECT id FROM enquiries WHERE id = ?1`
        : `SELECT id FROM sales_documents WHERE id = ?1 AND doc_type = 'QT'`,
  ).bind(id).first().catch(() => null);
  if (!exists) return err("not_found", `That ${kind} was not found`, 404);
  try {
    const open = await env.DB.prepare(
      `SELECT id FROM tasks WHERE link_kind = ?1 AND link_id = ?2 AND assigned_to = ?3 AND status != 'completed' LIMIT 1`,
    ).bind(kind, id, assignedTo).first<{ id: number }>();
    if (open) return json({ id: open.id, existing: true });
  } catch (e) {
    if (/no such column/i.test(String(e))) return err("migration_missing", "Run migration 0149 first (PUSH.bat)", 503);
    throw e;
  }
  return { kind, id };
}

/** The company's week: its approved target and the Collected total (every
    closer), the same rule as each person's basis. One place, read by the
    Sales scorecard and the Dashboard alike. */
async function companyWeek(env: Env, from: string, to: string) {
  const company = await targetFor(env, "company", null, from);
  const PAID_DAY = `date(COALESCE(d.paid_at, d.created_at), '+8 hours')`;
  const tot = await env.DB.prepare(
    `SELECT COALESCE(SUM(d.total_cents), 0) AS c, COUNT(*) AS n,
            COALESCE(SUM(CASE WHEN EXISTS (SELECT 1 FROM invoice_paid_confirmations k WHERE k.invoice_id = d.id AND k.revoked_at IS NULL) THEN d.total_cents ELSE 0 END), 0) AS k
       FROM sales_documents d WHERE d.doc_type = 'INV' AND d.payment_status = 'paid' AND ${PAID_DAY} BETWEEN ?1 AND ?2`,
  ).bind(from, to).first<{ c: number; n: number; k: number }>().catch(async () => await env.DB.prepare(
    `SELECT COALESCE(SUM(d.total_cents), 0) AS c, COUNT(*) AS n, 0 AS k FROM sales_documents d WHERE d.doc_type = 'INV' AND d.payment_status = 'paid' AND ${PAID_DAY} BETWEEN ?1 AND ?2`,
  ).bind(from, to).first<{ c: number; n: number; k: number }>());
  const basis = Number(tot?.c ?? 0);
  return { target_cents: company.target_cents, target_from: company.from, basis_cents: basis, paid_invoices: Number(tot?.n ?? 0), confirmed_cents: Number(tot?.k ?? 0),
    pct: company.target_cents ? Math.round((basis / company.target_cents) * 100) : null,
    gap_cents: company.target_cents === null ? null : Math.max(0, company.target_cents - basis) };
}

/** v1.239.0 - what else was sold in the week and is NOT in the target (the
    owner's answer "Invoices collected": shown beside it, never added): TikTok
    and other shipped orders and manual sales, with the same filters as the
    Dashboard's "Sales this month" (staff.ts /revenue), by the week's days. */
async function otherChannelsWeek(env: Env, from: string, to: string): Promise<number> {
  const one = async (sql: string) => { try { return Number((await env.DB.prepare(sql).bind(from, to).first<{ c: number }>())?.c ?? 0); } catch { return 0; } };
  const postage = await one(`SELECT COALESCE(SUM(order_amount_cents), 0) AS c FROM postage_records WHERE status != 'returned' AND date(created_at, '+8 hours') BETWEEN ?1 AND ?2`);
  const manual = await one(`SELECT COALESCE(SUM(total_cents), 0) AS c FROM manual_sales WHERE COALESCE(substr(out_date, 1, 10), date(created_at, '+8 hours')) BETWEEN ?1 AND ?2`);
  return postage + manual;
}

/** v1.239.0 - the people an HOD leads, from the Organisation chart's own
    tree (lib/org-tree.ts): everyone below them, when the chart makes them
    the head of their department. Null when they are not an HOD. */
async function hodTeam(env: Env, uid: number): Promise<number[] | null> {
  let rows: OrgPerson[];
  try {
    rows = (await env.DB.prepare(
      `SELECT id, name, full_name, role, position, department, photo_key, employment_status, left_on, rejoined_on, reports_to FROM users WHERE role NOT IN ('customer', 'super_admin')`,
    ).all<OrgPerson>()).results ?? [];
  } catch { return null; }
  const line = reportingLine(rows, uid);
  if (!line || line.kind !== "staff" || !line.youAreHod) return null;
  /* the descendants on the chart's own tree (buildOrg skips leavers, lines
     to a missing record and loops, exactly as the chart draws it) */
  const { root } = buildOrg(rows);
  const out: number[] = [];
  const find = (n: OrgNode): OrgNode | null => n.u.id === uid ? n : n.children.reduce<OrgNode | null>((f, c) => f ?? find(c), null);
  const collect = (n: OrgNode) => { for (const c of n.children) { out.push(c.u.id); collect(c); } };
  const mine = root ? find(root) : null;
  if (mine) collect(mine);
  return out;
}

const ACTION_KEYS = ["quotations", "leads", "renewals", "smaller_package", "pricing_review", "new_channel", "own"];

/* ---- v1.239.0 - THE DASHBOARD'S WEEK (the owner, 31-10-2026, claude/
   WEEKLY-TARGET-DASHBOARD-AUDIT.md: "EVERY STAFF MEMBER UNDERSTANDS THE
   COMPANY SALES GOAL ... ONE WEEKLY SALES TARGET ENGINE"). Open to every
   staff member; it reads the same targetFor / personWeek / statusOf /
   staffList as the Sales scorecard and answers only what the asker may see:
     company - target, collected, %, remaining (everyone; the owner's
               "Target, RM and %"); other channels beside it for the
               revenue readers, never added to it;
     me      - my revenue target, my goals, my contribution, my status and the
               counts behind my actions (never anyone else's);
     team    - an HOD on the Organisation chart: each member's target,
               collected, % and status (the owner's "Team progress") - no
               commission, salary or customer names;
     all     - exec_view: every scorecard row, the weakest first, by
               department, and who needs attention.
   Nothing is written here: no finalising, no task, no alert. ---- */
type Slim = { user_id: number; name: string; department: string | null; target_cents: number | null; basis_cents: number; pct: number | null; gap_cents: number | null; status: WeekStatus };
const SEVERITY: Record<WeekStatus, number> = { action: 0, at_risk: 1, missed: 2, planning: 3, on_track: 4, no_target: 5, not_working: 6, achieved: 7 };
async function weekDashboard(env: Env, user: StaffUser): Promise<Response> {
  if (user.role === "customer") return err("forbidden", "Staff only", 403);
  const today = mytToday();
  const startDow = await weekStartDow(env);
  const from = weekStartOf(today, startDow);
  const to = addDays(from, 6);
  const checkpoint = today >= addDays(from, 4) ? "review" : today >= addDays(from, 2) ? "early_warning" : "planning";
  const allowAll = VIEW_ALL(user);
  const company = await companyWeek(env, from, to);
  const other = can(user.role, "revenue_view") ? await otherChannelsWeek(env, from, to) : null;
  const slim = (r: Awaited<ReturnType<typeof weekFor>>, department: string | null): Slim => ({
    user_id: r.user_id, name: r.name, department, target_cents: r.target_cents, basis_cents: r.basis_cents, pct: r.pct, gap_cents: r.gap_cents, status: r.status,
  });
  const run = async <T>(sql: string, ...b: unknown[]) => { try { return ((await env.DB.prepare(sql).bind(...b).all<T>()).results ?? []) as T[]; } catch { return [] as T[]; } };
  const num = async (sql: string, ...b: unknown[]) => { try { return Number((await env.DB.prepare(sql).bind(...b).first<{ n: number }>())?.n ?? 0); } catch { return null; } };

  /* me - every working account; the system accounts hold no sales */
  let me: Record<string, unknown> | null = null;
  if (!["super_admin", "admin"].includes(user.role)) {
    const who = await env.DB.prepare(`SELECT COALESCE(NULLIF(TRIM(full_name), ''), name) AS name FROM users WHERE id = ?1`).bind(user.id).first<{ name: string }>();
    const r = await weekFor(env, user.id, who?.name ?? "", from, to, today, startDow);
    const tasks = await run<{ id: number; title: string; deadline: string | null; link_kind: string | null }>(
      `SELECT id, title, deadline, link_kind FROM tasks WHERE assigned_to = ?1 AND link_kind IS NOT NULL AND status != 'completed' ORDER BY COALESCE(deadline, '9999'), id LIMIT 3`, user.id);
    me = {
      name: r.name, has_target: r.target_cents !== null || r.goals.length > 0,
      target_cents: r.target_cents, target_from: r.target_from, basis_cents: r.basis_cents, paid_invoices: r.paid_invoices, pct: r.pct, gap_cents: r.gap_cents,
      expected_cents: r.expected_cents, status: r.status, working_days: r.working_days, goals: r.goals,
      open_quotations: r.open_quotations, followups_overdue: r.followups_overdue, tasks: r.tasks, top_tasks: tasks,
      enquiries_waiting: can(user.role, "enquiry_manage") ? await num(`SELECT COUNT(*) AS n FROM enquiries WHERE assigned_to = ?1 AND status IN ('new', 'contacted')`, user.id) : null,
      introductions: {
        pending: await num(`SELECT COUNT(*) AS n FROM enquiries WHERE referred_by = ?1 AND qualified_at IS NULL AND status != 'closed'`, user.id),
        verified_week: await num(`SELECT COUNT(*) AS n FROM enquiries WHERE referred_by = ?1 AND qualified_at IS NOT NULL AND COALESCE(qualified_by, 0) != ?1 AND date(qualified_at, '+8 hours') BETWEEN ?2 AND ?3`, user.id, from, to),
      },
      plan: r.plan ? { status: r.plan.status } : null,
    };
  }

  /* team - an HOD on the chart (executives read everyone below) */
  let team: Record<string, unknown> | null = null;
  if (!allowAll) {
    const ids = await hodTeam(env, user.id);
    if (ids && ids.length) {
      const members = await run<{ id: number; name: string; department: string | null }>(
        `SELECT u.id, COALESCE(NULLIF(TRIM(u.full_name), ''), u.name) AS name, u.department FROM users u
          WHERE u.id IN (${[user.id, ...ids].map((x) => Number(x)).join(", ")}) AND u.is_active = 1 AND u.role NOT IN ('customer', 'super_admin', 'admin') AND ${onStaffForWeekSql()}
          ORDER BY name`, from, to);
      const rows: Slim[] = [];
      for (const m of members) rows.push(slim(await weekFor(env, m.id, m.name, from, to, today, startDow), m.department));
      rows.sort((a, b) => SEVERITY[a.status] - SEVERITY[b.status] || (a.pct ?? 999) - (b.pct ?? 999));
      const targets = rows.filter((x) => x.target_cents !== null);
      const t = targets.length ? targets.reduce((n, x) => n + Number(x.target_cents), 0) : null;
      const basis = rows.reduce((n, x) => n + x.basis_cents, 0);
      team = { target_cents: t, basis_cents: basis, pct: t ? Math.round((basis / t) * 100) : null, gap_cents: t === null ? null : Math.max(0, t - basis), rows };
    }
  }

  /* all - management */
  let all: Record<string, unknown> | null = null;
  if (allowAll) {
    const people = await staffList(env, from, to);
    const rows: (Slim & { goals: { metric: string; target: number; actual: number }[] })[] = [];
    for (const p of people) {
      const r = await weekFor(env, p.id, p.name, from, to, today, startDow);
      rows.push({ ...slim(r, (p.department ?? "").trim() || null), goals: r.goals.map((g) => ({ metric: g.metric, target: g.target, actual: g.actual })) });
    }
    rows.sort((a, b) => SEVERITY[a.status] - SEVERITY[b.status] || (a.pct ?? 999) - (b.pct ?? 999));
    const depts = new Map<string, { name: string | null; target_cents: number | null; basis_cents: number; people: number }>();
    for (const r of rows) {
      const k = r.department ?? "";
      const d = depts.get(k) ?? { name: r.department, target_cents: null, basis_cents: 0, people: 0 };
      d.people++; d.basis_cents += r.basis_cents;
      if (r.target_cents !== null) d.target_cents = (d.target_cents ?? 0) + r.target_cents;
      depts.set(k, d);
    }
    const counts: Record<string, number> = {};
    for (const r of rows) counts[r.status] = (counts[r.status] ?? 0) + 1;
    all = {
      rows, counts,
      attention: rows.filter((r) => r.status === "action" || r.status === "at_risk" || r.status === "missed").slice(0, 5),
      departments: [...depts.values()].map((d) => ({ ...d, pct: d.target_cents ? Math.round((d.basis_cents / d.target_cents) * 100) : null }))
        .sort((a, b) => (a.name === null ? 1 : b.name === null ? -1 : b.basis_cents - a.basis_cents)),
    };
  }
  return json({
    week: { from, to, today, checkpoint, start_dow: startDow },
    company: { target_cents: company.target_cents, target_from: company.target_from, basis_cents: company.basis_cents, pct: company.pct, gap_cents: company.gap_cents },
    other_channels_cents: other, me, team, all,
    can_set: can(user.role, "sales_week_target"), can_view_all: allowAll, can_assign: can(user.role, "team_manage"), can_sales: can(user.role, "sales"),
    commission: { policy: false },
  });
}

export async function handleWeeklySales(env: Env, path: string, method: string, body: Record<string, unknown> | null, user: StaffUser, params: URLSearchParams): Promise<Response | null> {
  if (!path.startsWith("/sales/week")) return null;
  if (path === "/sales/week/dashboard" && method === "GET") return weekDashboard(env, user);
  if (!can(user.role, "sales") && !can(user.role, "exec_view")) return err("forbidden", "Sales access required", 403);
  const today = mytToday();
  const startDow = await weekStartDow(env);
  const weekParam = params.get("week") ?? "";
  const from = weekStartOf(DAY.test(weekParam) ? weekParam : today, startDow);
  const to = addDays(from, 6);
  const isSetter = can(user.role, "sales_week_target"); // v1.239.0 - the matrix cell
  const allowAll = VIEW_ALL(user);

  /* ---- the scorecard ---- */
  if (path === "/sales/week" && method === "GET") {
    const wantAll = params.get("scope") === "all" && allowAll; // a consultant only ever gets their own week
    const ended = to < today;
    const checkpoint = ended ? "final" : today >= addDays(from, 4) ? "review" : today >= addDays(from, 2) ? "early_warning" : "planning";
    if (!wantAll) {
      const me = await env.DB.prepare(`SELECT COALESCE(NULLIF(TRIM(full_name), ''), name) AS name FROM users WHERE id = ?1`).bind(user.id).first<{ name: string }>();
      const row = await weekFor(env, user.id, me?.name ?? "", from, to, today, startDow);
      return json({ week: { from, to, today, checkpoint, start_dow: startDow }, scope: "mine", can_set: isSetter, can_view_all: allowAll, me: row, commission: { policy: false } });
    }
    const people = await staffList(env, from, to);
    const rows = [];
    for (const p of people) rows.push(await weekFor(env, p.id, p.name, from, to, today, startDow));
    const companyRow = await companyWeek(env, from, to);
    if (ended) await finalise(env, from, rows, { target: companyRow.target_cents, basis: companyRow.basis_cents, confirmed: companyRow.confirmed_cents });
    return json({ week: { from, to, today, checkpoint, start_dow: startDow }, scope: "all", can_set: isSetter, can_view_all: true, company: companyRow, rows, commission: { policy: false } });
  }

  /* ---- targets: read (management, or your own) and set (CEO, COO, super admin) ---- */
  if (path === "/sales/week/targets" && method === "GET") {
    if (!allowAll) return err("forbidden", "Management access required", 403);
    /* the sales consultants (and anyone who already has a target) - the
       people the weekly scorecard lists */
    const people = await staffList(env, from, to);
    const list = [];
    for (const p of people) {
      const goals: Record<string, number | null> = {};
      for (const m of GOAL_METRICS) goals[m] = (await targetFor(env, "person", p.id, from, m)).target_count;
      list.push({ ...p, ...(await targetFor(env, "person", p.id, from)), goals });
    }
    let history: unknown[] = [];
    try {
      history = (await env.DB.prepare(
        `SELECT t.id, t.scope, t.user_id, t.team, t.week_from, t.target_cents, t.metric, t.target_count, t.reason, t.created_at,
                COALESCE(NULLIF(TRIM(s.full_name), ''), s.name) AS set_by_name, COALESCE(NULLIF(TRIM(p.full_name), ''), p.name) AS person
           FROM sales_week_targets t LEFT JOIN users s ON s.id = t.set_by LEFT JOIN users p ON p.id = t.user_id
          ORDER BY t.id DESC LIMIT 60`,
      ).all()).results ?? [];
    } catch {
      try { // pre-0156: no metric columns - every row is revenue
        history = (await env.DB.prepare(
          `SELECT t.id, t.scope, t.user_id, t.team, t.week_from, t.target_cents, 'revenue' AS metric, NULL AS target_count, t.reason, t.created_at,
                  COALESCE(NULLIF(TRIM(s.full_name), ''), s.name) AS set_by_name, COALESCE(NULLIF(TRIM(p.full_name), ''), p.name) AS person
             FROM sales_week_targets t LEFT JOIN users s ON s.id = t.set_by LEFT JOIN users p ON p.id = t.user_id
            ORDER BY t.id DESC LIMIT 60`,
        ).all()).results ?? [];
      } catch { history = []; }
    }
    return json({ week: { from, to, start_dow: startDow }, can_set: isSetter, people: list, candidates: isSetter ? await targetCandidates(env, from, to) : [], company: await targetFor(env, "company", null, from), history });
  }
  if (path === "/sales/week/targets" && method === "POST") {
    if (!isSetter) return err("forbidden", "Only the CEO, COO or super admin sets a weekly target", 403);
    const scope = body?.scope;
    const week = String(body?.week_from ?? "");
    const reason = str(body?.reason, 300) ? String(body!.reason).trim() : "";
    /* v1.239.0 - a contribution goal is a COUNT on one metric, for a person */
    const metric = body?.metric === undefined || body?.metric === null || body?.metric === "revenue" ? "revenue" : String(body.metric);
    if (metric !== "revenue" && !(GOAL_METRICS as readonly string[]).includes(metric)) return err("validation", `metric is revenue or one of ${GOAL_METRICS.join(", ")}`, 400);
    if (metric !== "revenue" && scope !== "person") return err("validation", "A contribution goal is set for a person; the company target is revenue", 400);
    const raw = metric === "revenue" ? body?.target_cents : null;
    const cents = raw === null || raw === undefined ? null : Math.round(Number(raw));
    const rawN = metric === "revenue" ? null : body?.target_count;
    const count = rawN === null || rawN === undefined ? null : Number(rawN);
    if (metric === "revenue" && raw === undefined) return err("validation", "Give an amount, or null for no target", 400);
    if (metric !== "revenue" && count !== null && (!Number.isInteger(count) || count < 0 || count > 1000)) return err("validation", "A goal is a whole number from 0 to 1000 (or null for none)", 400);
    if (!["person", "company"].includes(String(scope)) || !DAY.test(week) || weekStartOf(week, startDow) !== week || reason.length < 8 || (cents !== null && (!Number.isFinite(cents) || cents < 0 || cents > 100000000))) {
      return err("validation", "Choose a person or the company, the first day of a week, an amount (or none) and a reason of at least 8 characters", 400);
    }
    const uid = scope === "person" ? Math.round(Number(body?.user_id)) : null;
    if (scope === "person") {
      const u = await env.DB.prepare(`SELECT id FROM users WHERE id = ?3 AND is_active = 1 AND role NOT IN ('customer', 'super_admin', 'admin') AND ${onStaffForWeekSql("")}`)
        .bind(week, addDays(week, 6), uid).first();
      if (!u) return err("not_found", "That person is not on staff for that week (resigned, or not found)", 404);
    }
    /* a finished week is written down; its target is not changed after */
    if (week < weekStartOf(today, startDow)) {
      try {
        const done = await env.DB.prepare(`SELECT id FROM sales_week_results WHERE week_from = ?1 LIMIT 1`).bind(week).first();
        if (done) return err("week_final", "That week has ended and its results are final. Set the target from the current week.", 409);
      } catch { /* pre-0149 */ }
    }
    try {
      let r: { id: number } | null;
      try {
        r = await env.DB.prepare(
          `INSERT INTO sales_week_targets (scope, user_id, team, week_from, target_cents, reason, set_by, metric, target_count) VALUES (?1, ?2, NULL, ?3, ?4, ?5, ?6, ?7, ?8) RETURNING id`,
        ).bind(scope, uid, week, cents, reason, user.id, metric, count).first<{ id: number }>();
      } catch (e) {
        if (!/no column named|has no column|no such column/i.test(String(e))) throw e;
        if (metric !== "revenue") return err("migration_missing", "Run migration 0156 first (PUSH.bat)", 503);
        r = await env.DB.prepare(
          `INSERT INTO sales_week_targets (scope, user_id, team, week_from, target_cents, reason, set_by) VALUES (?1, ?2, NULL, ?3, ?4, ?5, ?6) RETURNING id`,
        ).bind(scope, uid, week, cents, reason, user.id).first<{ id: number }>();
      }
      await audit(env, user.id, "sales.week_target", "sales_week_targets", String(r?.id), { scope, user_id: uid, week_from: week, metric, ...(metric === "revenue" ? { target_cents: cents } : { target_count: count }), reason });
      return json({ ok: true, id: r?.id }, 201);
    } catch (e) {
      if (/no such table/i.test(String(e))) return err("migration_missing", "Run migration 0149 first (PUSH.bat)", 503);
      throw e;
    }
  }
  if (path === "/sales/week/settings" && method === "POST") {
    if (!isSetter) return err("forbidden", "Only the CEO, COO or super admin sets the business week", 403);
    const n = Number(body?.start_dow);
    if (!Number.isInteger(n) || n < 0 || n > 6) return err("validation", "start_dow is 0 (Sunday) to 6 (Saturday)", 400);
    await env.DB.prepare(`INSERT INTO business_settings (key, value, updated_by) VALUES ('sales_week_start', ?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = datetime('now')`).bind(String(n), user.id).run();
    await audit(env, user.id, "sales.week_start", "business_settings", "sales_week_start", { start_dow: n });
    return json({ ok: true });
  }

  /* ---- the recovery plan ---- */
  if (path === "/sales/week/plan" && method === "GET") {
    const uid = params.has("user_id") ? Number(params.get("user_id")) : user.id;
    if (uid !== user.id && !allowAll) return err("forbidden", "You can read only your own plan", 403);
    const u = await env.DB.prepare(`SELECT id, COALESCE(NULLIF(TRIM(full_name), ''), name) AS name FROM users WHERE id = ?1`).bind(uid).first<{ id: number; name: string }>();
    if (!u) return err("not_found", "Staff member not found", 404);
    const week = await weekFor(env, uid, u.name, from, to, today, startDow);
    const plan = await planOf(env, uid, from);
    const run = async <T>(sql: string, ...b: unknown[]) => { try { return ((await env.DB.prepare(sql).bind(...b).all<T>()).results ?? []) as T[]; } catch { return [] as T[]; } };
    /* the facts the plan starts from - read, never invented */
    const quotations = await run<{ id: number; doc_number: string; company: string | null; total_cents: number; valid_until: string | null; created_at: string; customer_id: number | null }>(
      `SELECT q.id, q.doc_number, c.company, q.total_cents, q.valid_until, q.created_at, q.customer_id FROM sales_documents q LEFT JOIN customers c ON c.id = q.customer_id
        WHERE q.doc_type = 'QT' AND q.salesperson_id = ?1
          AND NOT EXISTS (SELECT 1 FROM sales_documents i WHERE i.converted_from = q.id AND i.doc_type = 'INV')
          AND (q.valid_until IS NULL OR substr(q.valid_until, 1, 10) >= ?2)
        ORDER BY q.total_cents DESC LIMIT 20`, uid, today);
    const noNext = await run<{ id: number; company: string }>(
      `SELECT DISTINCT c.id, c.company FROM customers c JOIN sales_documents q ON q.customer_id = c.id AND q.doc_type = 'QT' AND q.salesperson_id = ?1
        WHERE NOT EXISTS (SELECT 1 FROM sales_documents i WHERE i.converted_from = q.id AND i.doc_type = 'INV')
          AND (q.valid_until IS NULL OR substr(q.valid_until, 1, 10) >= ?2)
          AND NOT EXISTS (SELECT 1 FROM customer_followups f WHERE f.customer_id = c.id AND f.done_at IS NULL AND f.cancelled_at IS NULL)
        LIMIT 20`, uid, today);
    const overdue = await run<{ id: number; customer_id: number; company: string | null; due_on: string; note: string }>(
      `SELECT f.id, f.customer_id, c.company, f.due_on, f.note FROM customer_followups f LEFT JOIN customers c ON c.id = f.customer_id
        WHERE f.owner_id = ?1 AND f.done_at IS NULL AND f.cancelled_at IS NULL AND f.due_on < ?2 ORDER BY f.due_on LIMIT 20`, uid, today);
    const tasks = await run<{ id: number; title: string; deadline: string | null; status: string; priority: string; link_kind: string | null; link_id: number | null }>(
      `SELECT id, title, deadline, status, priority, link_kind, link_id FROM tasks WHERE assigned_to = ?1 AND link_kind IS NOT NULL AND status != 'completed' ORDER BY COALESCE(deadline, '9999') LIMIT 30`, uid);
    let actions: unknown = [];
    try { actions = plan ? JSON.parse(plan.actions) : []; } catch { actions = []; }
    return json({
      week: { from, to, today }, user: u, figures: week, can_edit: uid === user.id && (!plan || plan.status !== "approved"), can_review: isSetter && uid !== user.id,
      plan: plan ? { ...plan, actions } : null, facts: { quotations, no_next_action: noNext, overdue_followups: overdue, open_tasks: tasks },
    });
  }
  if (path === "/sales/week/plan" && method === "PUT") {
    /* the consultant drafts and submits their own plan */
    const actionsIn = Array.isArray(body?.actions) ? body!.actions as { key?: unknown; text?: unknown }[] : [];
    const actions: { key: string; text: string; task_id?: number }[] = [];
    for (const a of actionsIn.slice(0, 12)) {
      const key = String(a?.key ?? "");
      const text = str(a?.text, 300) ? String(a!.text).trim() : "";
      if (!ACTION_KEYS.includes(key) || text.length < 3) return err("validation", "Each action needs a kind and a few words", 400);
      actions.push({ key, text });
    }
    const submit = body?.submit === true;
    if (submit && actions.length === 0) return err("validation", "Add at least one action before submitting", 400);
    const note = str(body?.note, 1000) ? String(body!.note).trim() : null;
    const prior = await planOf(env, user.id, from);
    if (prior?.status === "approved") return err("plan_approved", "This plan is approved. Ask your manager to return it before you change it.", 409);
    const fig = await weekFor(env, user.id, "", from, to, today, startDow);
    try {
      await env.DB.prepare(
        `INSERT INTO sales_recovery_plans (user_id, week_from, status, actions, note, gap_cents, submitted_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, CASE WHEN ?3 = 'submitted' THEN datetime('now') END)
         ON CONFLICT(user_id, week_from) DO UPDATE SET status = excluded.status, actions = excluded.actions, note = excluded.note,
           gap_cents = excluded.gap_cents, submitted_at = COALESCE(excluded.submitted_at, sales_recovery_plans.submitted_at), updated_at = datetime('now')
         WHERE sales_recovery_plans.status != 'approved'`,
      ).bind(user.id, from, submit ? "submitted" : "draft", JSON.stringify(actions), note, fig.gap_cents).run();
    } catch (e) {
      if (/no such table/i.test(String(e))) return err("migration_missing", "Run migration 0149 first (PUSH.bat)", 503);
      throw e;
    }
    await audit(env, user.id, submit ? "sales.plan_submit" : "sales.plan_draft", "sales_recovery_plans", `${user.id}:${from}`, { actions: actions.length });
    return json({ ok: true, status: submit ? "submitted" : "draft" });
  }
  const rv = /^\/sales\/week\/plan\/(\d+)\/review$/.exec(path);
  if (rv && method === "POST") {
    if (!isSetter) return err("forbidden", "Only the CEO, COO or super admin reviews a recovery plan", 403);
    const plan = await env.DB.prepare(`SELECT * FROM sales_recovery_plans WHERE id = ?1`).bind(Number(rv[1])).first<{ id: number; user_id: number; week_from: string; status: string; actions: string }>();
    if (!plan) return err("not_found", "Plan not found", 404);
    if (plan.user_id === user.id) return err("forbidden", "Your own plan is reviewed by another of the CEO, COO and super admin", 403);
    const decision = body?.decision;
    const note = str(body?.note, 1000) ? String(body!.note).trim() : "";
    if (decision !== "approve" && decision !== "return") return err("validation", "decision is approve or return", 400);
    if (plan.status !== "submitted" && !(plan.status === "approved" && decision === "return")) return err("validation", "Only a submitted plan is reviewed", 409);
    if (decision === "return") {
      if (note.length < 8) return err("validation", "Say what should change (at least 8 characters)", 400);
      await env.DB.prepare(`UPDATE sales_recovery_plans SET status = 'returned', reviewed_by = ?2, reviewed_at = datetime('now'), review_note = ?3, updated_at = datetime('now') WHERE id = ?1`).bind(plan.id, user.id, note).run();
      await audit(env, user.id, "sales.plan_return", "sales_recovery_plans", String(plan.id), { note });
      return json({ ok: true, status: "returned" });
    }
    /* approve: the chosen actions become Tasks for the plan's owner - one
       task per action, linked to the plan; approving twice adds none */
    let actions: { key: string; text: string; task_id?: number }[] = [];
    try { actions = JSON.parse(plan.actions); } catch { actions = []; }
    const pick = Array.isArray(body?.tasks) ? body!.tasks as { index?: unknown; deadline?: unknown; priority?: unknown }[] : [];
    const created: number[] = [];
    for (const t of pick.slice(0, 12)) {
      const i = Number(t?.index);
      const a = actions[i];
      if (!a || a.task_id) continue;
      const deadline = typeof t?.deadline === "string" && DAY.test(t.deadline) ? t.deadline : null;
      const priority = ["low", "normal", "high", "urgent"].includes(String(t?.priority)) ? String(t!.priority) : "normal";
      const title = `Recovery: ${a.text}`.slice(0, 200);
      const ins = await env.DB.prepare(
        `INSERT INTO tasks (title, description, assigned_to, created_by, priority, deadline, link_kind, link_id)
         SELECT ?1, ?2, ?3, ?4, ?5, ?6, 'recovery', ?7
          WHERE NOT EXISTS (SELECT 1 FROM tasks WHERE link_kind = 'recovery' AND link_id = ?7 AND assigned_to = ?3 AND title = ?1)
         RETURNING id`,
      ).bind(title, `From the recovery plan for the week of ${plan.week_from}.${note ? ` Manager: ${note}` : ""}`, plan.user_id, user.id, priority, deadline, plan.id).first<{ id: number }>();
      if (ins?.id) { a.task_id = ins.id; created.push(ins.id); }
    }
    await env.DB.prepare(`UPDATE sales_recovery_plans SET status = 'approved', actions = ?2, reviewed_by = ?3, reviewed_at = datetime('now'), review_note = ?4, updated_at = datetime('now') WHERE id = ?1`)
      .bind(plan.id, JSON.stringify(actions), user.id, note || null).run();
    await audit(env, user.id, "sales.plan_approve", "sales_recovery_plans", String(plan.id), { tasks: created });
    return json({ ok: true, status: "approved", tasks: created });
  }
  return null;
}
