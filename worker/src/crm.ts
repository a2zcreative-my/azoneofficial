/**
 * LEADS & CRM - v1.398.0, Sales Command Center Phase 2 (the CEO, 21-11-2026: decisions
 * 1-7, and "As recommended" on the six Phase 2 decisions). Migration 0226.
 *
 * The customer record IS the lead (decision 3). This module adds what it lacked - an
 * owner, a source, the services the lead is interested in, a relationship status set by
 * staff, and a log of the contact made - and never changes a quotation, an invoice, a
 * payment, a verification, a closer or a commission.
 *
 *   GET  /crm/options                       sources, statuses, services (Packages library
 *                                           names only, never a price), people who can own
 *   GET  /crm/summary?scope=                the Leads & CRM figures
 *   GET  /crm/leads?view=&q=&status=&source=&owner=&sort=&page=
 *                                           the paged, searchable lead list (25 a page)
 *   GET  /crm/leads/:id                     one lead: profile, next action, activities,
 *                                           ownership and status history, linked entries
 *   POST /crm/leads/:id/activities          log a call, WhatsApp, email, meeting, note or
 *                                           proposal (client_key: a replay is the same row)
 *   PUT  /crm/leads/:id/profile             source, source details, interested services
 *   POST /crm/leads/:id/status              the relationship status (+ reason when it ends)
 *   POST /crm/leads/:id/assign              crm_assign only: assign, reassign, unassign
 *   GET  /crm/suggestions                   crm_assign: an owner for each unowned customer,
 *                                           from the salesperson on its latest document
 *   POST /crm/suggestions/confirm           crm_assign: set the ones a manager ticked
 *   POST /crm/convert                       an enquiry or Growth Check entry -> a customer,
 *                                           after the duplicate check (link or create once)
 *
 * WHO (decision 2, option A): everyone with Sales reads every lead, as GET /customers
 * already answers; writes need Sales; ownership needs crm_assign (CEO, COO, CCO, super
 * admin). Agents and customers are refused by role before anything is read.
 *
 * ONCE ONLY: an activity carries source_key (client:<key>, followup:<id>); a converted
 * entry makes a customer keyed crm_key (enquiry:<id> / growth:<id>); every edit carries
 * the version it started from. The three event tables are append-only (triggers).
 */
import type { Env } from "./index";
import { notify, currentStaffSql, staffRolesSql, STAFF_ORDER_SQL, type StaffUser } from "./staff";
import { can, canUser } from "./permissions";
import { audit, bumpVersion, err, json, str } from "./shared";

export const LEAD_SOURCES = ["website", "growth_check", "agent", "referral", "walk_in", "social", "tiktok", "existing", "other"] as const;
export const LEAD_STATUSES = ["new_lead", "contacted", "qualified", "customer", "inactive", "disqualified"] as const;
export const ACTIVITY_KINDS = ["call", "whatsapp", "email", "meeting", "note", "proposal"] as const;
/** statuses a lead is still being worked in: it needs an owner and a next action */
export const OPEN_LEAD = ["new_lead", "contacted", "qualified"] as const;
const PER = 25;

const NAME = (a: string) => `COALESCE(NULLIF(TRIM(${a}.full_name), ''), ${a}.name)`;
const mytToday = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
const missing = (e: unknown) => /no such (table|column)/i.test(String(e));
const skewErr = () => err("migration_missing", "Run migration 0226 first (PUSH.bat)", 503);
/** a lead still being worked: no status yet, or new / contacted / qualified */
const OPEN_SQL = (a = "c.") => `(${a}relationship_status IS NULL OR ${a}relationship_status IN ('new_lead', 'contacted', 'qualified'))`;
/** v1.408.0 - an OPEN TASK on the lead (the CEO: "Next action should check the task, because it
    is already there"): a task linked to the customer itself, to one of its quotations, to a
    project of its own, or to an enquiry converted into it. Open = not completed (a cancelled
    task is completed with stage cancelled). `id` is the customer id expression. Exported:
    sales-today's lead row reads the same rule. */
export const TASK_LINK_SQL = (id = "c.id") => `t.status != 'completed' AND ${LINKED_SQL(id)}`;
/** v1.412.0 (the CEO: "if there is a Task completed, the status should change to the Closed") - a task on
    the lead that was COMPLETED (closed, not cancelled). With nothing open or booked, the lead's next action
    reads "Task closed" instead of No next action; the lead's relationship status is never touched. */
export const DONE_TASK_SQL = (id = "c.id") => `t.status = 'completed' AND COALESCE(t.stage, '') != 'cancelled' AND ${LINKED_SQL(id)}`;
/** linked to the customer, one of its quotations, a project of its own, or an enquiry converted into it */
const LINKED_SQL = (id: string) => `(
      (t.link_kind = 'customer' AND t.link_id = ${id})
   OR (t.link_kind = 'quotation' AND t.link_id IN (SELECT d.id FROM sales_documents d WHERE d.customer_id = ${id} AND d.doc_type = 'QT'))
   OR (t.link_kind = 'project' AND t.link_id IN (SELECT p.id FROM projects p WHERE p.customer_id = ${id}))
   OR (t.link_kind = 'enquiry' AND t.link_id IN (SELECT e.id FROM enquiries e WHERE e.customer_id = ${id})))`;
/** when a task was closed (Malaysia time): its newest close / approve row in the task's own history (no column on tasks) */
const CLOSED_AT_SQL = `(SELECT datetime(MAX(u.created_at), '+8 hours') FROM task_updates u WHERE u.task_id = t.id AND u.kind IN ('closed', 'closed_with_exception', 'review_approved'))`;
/** a next action is an open follow-up OR an open task on the lead, and a lead whose task was completed
    reads "Task closed" (v1.412.0) - one rule for the list, the No next action figure and its filter */
const NEXT_SQL = (a = "c.") => `(EXISTS (SELECT 1 FROM customer_followups f WHERE f.customer_id = ${a}id AND f.done_at IS NULL AND f.cancelled_at IS NULL)
   OR EXISTS (SELECT 1 FROM tasks t WHERE ${TASK_LINK_SQL(`${a}id`)})
   OR EXISTS (SELECT 1 FROM tasks t WHERE ${DONE_TASK_SQL(`${a}id`)}))`;

interface Body { [k: string]: unknown }

/** the same number written +60 12..., 012... or with spaces reads as one */
function phoneKeys(phone: unknown): [string, string] {
  const digits = String(phone ?? "").replace(/\D/g, "");
  const local = digits.startsWith("60") ? `0${digits.slice(2)}` : digits;
  const intl = local.startsWith("0") ? `6${local}` : local;
  return [local, intl];
}
const PHONE_SQL = (col: string) => `REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(${col}, ''), ' ', ''), '-', ''), '+', ''), '(', ''), ')', '')`;

/** decision 3 - the duplicate check: the same company name, phone or email already on file */
export async function crmDuplicates(env: Env, company: string, phone: unknown, email: unknown) {
  const [local, intl] = phoneKeys(phone);
  const mail = typeof email === "string" ? email.trim().toLowerCase() : "";
  const { results } = await env.DB.prepare(
    `SELECT id, company, phone, email FROM customers
      WHERE company != 'Walk-in Customer'
        AND (LOWER(TRIM(company)) = LOWER(TRIM(?1))
             OR (LENGTH(?2) >= 7 AND ${PHONE_SQL("phone")} IN (?2, ?3))
             OR (LENGTH(?4) >= 5 AND LOWER(TRIM(COALESCE(email, ''))) = ?4))
      ORDER BY id LIMIT 5`,
  ).bind(company, local, intl, mail).all<{ id: number; company: string; phone: string | null; email: string | null }>();
  return results ?? [];
}

/** v1.398.0 - closing a follow-up writes exactly ONE activity (decision: no double count).
    Called after the close; the unique source_key makes a second call a no-op. */
export async function recordFollowupActivity(env: Env, followupId: number): Promise<void> {
  try {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO sales_activities (customer_id, kind, outcome, note, occurred_at, followup_id, doc_id, source_key, created_by)
       SELECT f.customer_id, 'followup', f.outcome, COALESCE(NULLIF(TRIM(f.done_note), ''), f.note), f.done_at, f.id, f.doc_id, 'followup:' || f.id, f.done_by
         FROM customer_followups f WHERE f.id = ?1 AND f.done_at IS NOT NULL AND f.done_by IS NOT NULL`,
    ).bind(followupId).run();
  } catch (e) { if (!missing(e)) throw e; }
}

/** people who may own a lead: current staff whose role holds Sales */
async function owners(env: Env): Promise<{ id: number; name: string; role: string }[]> {
  const { results } = await env.DB.prepare(
    `SELECT id, ${NAME("u")} AS name, role FROM users u
      WHERE u.is_active = 1 AND ${staffRolesSql("u.")} AND ${currentStaffSql("u.")}
      ORDER BY ${STAFF_ORDER_SQL}`, // v1.405.0 - staff only (never the super admin or a test account), by seniority
  ).all<{ id: number; name: string; role: string }>();
  return (results ?? []).filter((u) => can(u.role, "sales"));
}

/** interested services: Packages library ids ("pkg:12") and "other:<words>"; names only */
async function cleanServices(env: Env, v: unknown): Promise<string[] | Response> {
  if (v == null) return [];
  if (!Array.isArray(v) || v.length > 10) return err("invalid_input", "Choose up to 10 services.", 400);
  const out: string[] = [];
  for (const s of v) {
    if (typeof s !== "string") return err("invalid_input", "A service is a package or other words.", 400);
    const pkg = /^pkg:(\d+)$/.exec(s);
    if (pkg) {
      const p = await env.DB.prepare(`SELECT id FROM sales_packages WHERE id = ?1`).bind(Number(pkg[1])).first();
      if (!p) return err("invalid_input", "That package is not in the Packages library.", 400);
      out.push(s);
    } else if (/^other:/.test(s) && s.slice(6).trim().length >= 2 && s.length <= 66) {
      out.push(`other:${s.slice(6).trim()}`);
    } else return err("invalid_input", "A service is a package or other words.", 400);
  }
  return [...new Set(out)];
}

const VIEW_SQL: Record<string, string> = {
  all: "1 = 1",
  mine: "c.owner_id = ?1",
  unassigned: `c.owner_id IS NULL AND COALESCE(c.relationship_status, '') NOT IN ('inactive', 'disqualified')`,
  active: "c.relationship_status = 'customer'",
};

async function listLeads(env: Env, user: StaffUser, p: URLSearchParams) {
  const view = VIEW_SQL[p.get("view") ?? "all"] ? (p.get("view") ?? "all") : "all";
  /* ?1 is always the viewer, so every view binds the same first value */
  const where: string[] = [`c.company != 'Walk-in Customer'`, "?1 IS NOT NULL", VIEW_SQL[view]!];
  const binds: (string | number)[] = [user.id];
  const q = (p.get("q") ?? "").trim().slice(0, 80);
  if (q) {
    binds.push(`%${q.toLowerCase()}%`);
    const n = binds.length;
    const [local] = phoneKeys(q);
    let phone = "";
    if (local.length >= 4) { binds.push(`%${local.replace(/^0/, "")}%`); phone = ` OR ${PHONE_SQL("c.phone")} LIKE ?${binds.length}`; }
    where.push(`(LOWER(c.company) LIKE ?${n} OR LOWER(COALESCE(c.contact_person, '')) LIKE ?${n} OR LOWER(COALESCE(c.email, '')) LIKE ?${n}${phone})`);
  }
  const status = p.get("status") ?? "";
  if (status === "none") where.push("c.relationship_status IS NULL");
  else if ((LEAD_STATUSES as readonly string[]).includes(status)) { binds.push(status); where.push(`c.relationship_status = ?${binds.length}`); }
  const source = p.get("source") ?? "";
  if ((LEAD_SOURCES as readonly string[]).includes(source)) { binds.push(source); where.push(`c.lead_source = ?${binds.length}`); }
  const owner = Number(p.get("owner"));
  if (Number.isInteger(owner) && owner > 0) { binds.push(owner); where.push(`c.owner_id = ?${binds.length}`); }
  if (p.get("flag") === "no_next") where.push(`${OPEN_SQL()} AND NOT ${NEXT_SQL()}`);
  if (p.get("flag") === "no_owner") where.push(`c.owner_id IS NULL AND ${OPEN_SQL()}`);
  const sort = p.get("sort") === "name" ? "x.company COLLATE NOCASE ASC, x.id ASC"
    : p.get("sort") === "recent" ? "x.created_at DESC, x.id DESC"
    : /* attention first: the earliest next action, then an undated task, then the leads with none, newest first */
      "CASE WHEN next_due IS NOT NULL THEN 0 WHEN task_id IS NOT NULL THEN 1 ELSE 2 END, next_due ASC, x.created_at DESC, x.id DESC";
  const page = Math.max(1, Math.min(10000, Number(p.get("page")) || 1));
  const w = where.join(" AND ");
  const total = await env.DB.prepare(`SELECT COUNT(*) AS n FROM customers c WHERE ${w}`).bind(...binds).first<{ n: number }>();
  const { results } = await env.DB.prepare(
    /* v1.408.0 - the next action is the earlier of the next follow-up and the next open task on
       the lead (an undated task still counts as a next action, it only has no day) */
    `SELECT x.*, COALESCE(MIN(x.fu_due, x.task_due), x.fu_due, x.task_due) AS next_due FROM (
     SELECT c.id, c.company, c.contact_person, c.phone, c.email, c.owner_id, ${NAME("o")} AS owner_name,
            c.lead_source, c.lead_source_detail, c.relationship_status, c.interested_services, c.created_at, c.crm_version,
            (SELECT MIN(f.due_on) FROM customer_followups f WHERE f.customer_id = c.id AND f.done_at IS NULL AND f.cancelled_at IS NULL) AS fu_due,
            (SELECT f.note FROM customer_followups f WHERE f.customer_id = c.id AND f.done_at IS NULL AND f.cancelled_at IS NULL ORDER BY f.due_on, f.id LIMIT 1) AS fu_note,
            (SELECT t.id FROM tasks t WHERE ${TASK_LINK_SQL()} ORDER BY t.deadline IS NULL, substr(t.deadline, 1, 10), t.id LIMIT 1) AS task_id,
            (SELECT t.title FROM tasks t WHERE ${TASK_LINK_SQL()} ORDER BY t.deadline IS NULL, substr(t.deadline, 1, 10), t.id LIMIT 1) AS task_title,
            (SELECT MIN(substr(t.deadline, 1, 10)) FROM tasks t WHERE ${TASK_LINK_SQL()} AND t.deadline IS NOT NULL) AS task_due,
            (SELECT t.title FROM tasks t WHERE ${DONE_TASK_SQL()} ORDER BY COALESCE(${CLOSED_AT_SQL}, '') DESC, t.id DESC LIMIT 1) AS closed_title,
            (SELECT MAX(COALESCE(${CLOSED_AT_SQL}, '')) FROM tasks t WHERE ${DONE_TASK_SQL()}) AS closed_at,
            (SELECT MAX(a.occurred_at) FROM sales_activities a WHERE a.customer_id = c.id) AS last_activity,
            (SELECT COUNT(*) FROM sales_documents d WHERE d.customer_id = c.id AND d.doc_type = 'QT') AS quotations,
            (SELECT COUNT(*) FROM sales_documents d WHERE d.customer_id = c.id AND d.doc_type = 'INV' AND COALESCE(d.payment_status, '') != 'void') AS invoices
       FROM customers c LEFT JOIN users o ON o.id = c.owner_id
      WHERE ${w}) x ORDER BY ${sort} LIMIT ${PER} OFFSET ${(page - 1) * PER}`,
  ).bind(...binds).all<Record<string, unknown> & { relationship_status: string | null; owner_id: number | null; next_due: string | null;
    fu_due: string | null; fu_note: string | null; task_id: number | null; task_title: string | null; task_due: string | null;
    closed_title: string | null; closed_at: string | null }>();
  const today = mytToday();
  const rows = (results ?? []).map((r) => {
    const open = r.relationship_status === null || (OPEN_LEAD as readonly string[]).includes(r.relationship_status);
    /* which one is next: the follow-up when it is due first (or there is no task), else the task */
    const fuFirst = r.fu_due !== null && (r.task_due === null || r.fu_due <= r.task_due);
    const { fu_due: _fd, fu_note, task_due: _td, ...rest } = r;
    return {
      ...rest,
      interested_services: parseServices(r.interested_services),
      /* v1.412.0 - nothing open or booked, but a task was completed: "closed" (never a status change) */
      next_kind: fuFirst ? "followup" : r.task_id !== null ? "task" : r.next_due === null && r.closed_title !== null ? "closed" : null,
      next_note: fuFirst ? fu_note : r.task_id !== null ? r.task_title : r.next_due === null ? r.closed_title : null,
      closed_at: r.closed_at || null,
      no_owner: open && r.owner_id === null,
      no_next: open && r.next_due === null && r.task_id === null && r.closed_title === null,
      next_late: r.next_due !== null && r.next_due < today,
    };
  });
  return { view, page, per: PER, total: total?.n ?? 0, rows, today };
}

const parseServices = (v: unknown): string[] => {
  try { const a = JSON.parse(String(v ?? "[]")); return Array.isArray(a) ? a.filter((x) => typeof x === "string") : []; } catch { return []; }
};

async function summary(env: Env, user: StaffUser, scope: "mine" | "all") {
  const mine = scope === "mine";
  const own = mine ? "AND c.owner_id = ?1" : "AND ?1 IS NOT NULL";
  const today = mytToday();
  const r = await env.DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM customers c WHERE c.company != 'Walk-in Customer' AND ${OPEN_SQL()} ${own}) AS leads,
       (SELECT COUNT(*) FROM customers c WHERE c.company != 'Walk-in Customer' AND c.created_at >= datetime('now', '-7 days') ${own}) AS new_week,
       (SELECT COUNT(*) FROM customers c WHERE c.company != 'Walk-in Customer' AND c.owner_id IS NULL AND ${OPEN_SQL()}) AS unassigned,
       (SELECT COUNT(*) FROM customers c WHERE c.company != 'Walk-in Customer' AND ${OPEN_SQL()} AND NOT ${NEXT_SQL()} ${own}) AS no_next,
       (SELECT COUNT(*) FROM customer_followups f JOIN customers c ON c.id = f.customer_id
         WHERE f.done_at IS NULL AND f.cancelled_at IS NULL AND f.due_on < ?2 ${mine ? "AND (f.owner_id = ?1 OR f.owner_id IS NULL)" : "AND ?1 IS NOT NULL"}) AS followups_overdue,
       (SELECT COUNT(*) FROM customers c WHERE c.relationship_status = 'customer' ${own}) AS active_customers`,
  ).bind(user.id, today).first<Record<string, number>>();
  return { scope, today, ...r };
}

async function leadDetail(env: Env, id: number) {
  const lead = await env.DB.prepare(
    `SELECT c.*, ${NAME("o")} AS owner_name FROM customers c LEFT JOIN users o ON o.id = c.owner_id WHERE c.id = ?1 AND c.company != 'Walk-in Customer'`,
  ).bind(id).first<Record<string, unknown>>();
  if (!lead) return null;
  const all = <T>(sql: string) => env.DB.prepare(sql).bind(id).all<T>().then((r) => r.results ?? []);
  const [activities, ownerEvents, statusEvents, followups, tasks, closedTasks, docs, enquiries, growth] = await Promise.all([
    all(`SELECT a.id, a.kind, a.outcome, a.note, a.occurred_at, a.followup_id, a.doc_id, ${NAME("u")} AS by_name, a.created_by
           FROM sales_activities a LEFT JOIN users u ON u.id = a.created_by WHERE a.customer_id = ?1 ORDER BY a.occurred_at DESC, a.id DESC LIMIT 100`),
    all(`SELECT e.id, e.kind, e.reason, e.created_at, ${NAME("f")} AS from_name, ${NAME("t")} AS to_name, ${NAME("b")} AS by_name
           FROM customer_owner_events e LEFT JOIN users f ON f.id = e.from_owner LEFT JOIN users t ON t.id = e.to_owner LEFT JOIN users b ON b.id = e.created_by
          WHERE e.customer_id = ?1 ORDER BY e.id DESC LIMIT 50`),
    all(`SELECT e.id, e.from_status, e.to_status, e.reason, e.created_at, ${NAME("b")} AS by_name
           FROM customer_status_events e LEFT JOIN users b ON b.id = e.created_by WHERE e.customer_id = ?1 ORDER BY e.id DESC LIMIT 50`),
    all(`SELECT f.id, f.due_on, f.note, f.doc_id, ${NAME("u")} AS owner_name FROM customer_followups f LEFT JOIN users u ON u.id = f.owner_id
          WHERE f.customer_id = ?1 AND f.done_at IS NULL AND f.cancelled_at IS NULL ORDER BY f.due_on, f.id`),
    /* v1.408.0 - the open tasks on this lead (the customer, its quotations, its projects, its enquiries) */
    all(`SELECT t.id, t.title, substr(t.deadline, 1, 10) AS due_on, t.status, t.stage, t.link_kind, ${NAME("u")} AS assignee_name
           FROM tasks t LEFT JOIN users u ON u.id = t.assigned_to
          WHERE ${TASK_LINK_SQL("?1")}
          ORDER BY t.deadline IS NULL, substr(t.deadline, 1, 10), t.id LIMIT 20`).catch(() => []),
    /* v1.412.0 - the newest completed task, for "Task closed" when nothing is open */
    all(`SELECT t.id, t.title, ${CLOSED_AT_SQL} AS closed_at FROM tasks t
          WHERE ${DONE_TASK_SQL("?1")} ORDER BY COALESCE(${CLOSED_AT_SQL}, '') DESC, t.id DESC LIMIT 1`).catch(() => []),
    /* v1.406.0 - the lead's quotations and invoices, each with where it stands (the CEO: "link it!") */
    all(`SELECT d.id, d.doc_type, d.doc_number, d.total_cents, d.payment_status, d.created_at, d.valid_until, d.voided_at,
                CASE WHEN d.doc_type = 'QT' THEN EXISTS (SELECT 1 FROM quotation_acceptances a WHERE a.doc_id = d.id AND a.revision = COALESCE(d.revision, 0)) ELSE 0 END AS accepted,
                CASE WHEN d.doc_type = 'QT' THEN (SELECT i.doc_number FROM sales_documents i WHERE i.doc_type = 'INV' AND i.converted_from = d.id AND COALESCE(i.payment_status, '') != 'void' AND i.voided_at IS NULL ORDER BY i.id LIMIT 1) END AS invoiced_as,
                (SELECT l.opportunity_id FROM opportunity_quotations l WHERE l.doc_id = d.id AND l.unlinked_at IS NULL LIMIT 1) AS deal_id
           FROM sales_documents d
          WHERE d.customer_id = ?1 AND d.doc_type IN ('QT', 'INV') ORDER BY d.created_at DESC, d.id DESC LIMIT 30`),
    all(`SELECT id, name, status, created_at FROM enquiries WHERE customer_id = ?1 ORDER BY id DESC LIMIT 10`).catch(() => []),
    all(`SELECT id, ref, status, created_at FROM business_growth_enquiries WHERE customer_id = ?1 AND test_marked_at IS NULL ORDER BY id DESC LIMIT 10`).catch(() => []), // v1.418.0 - never a test entry
  ]);
  return { lead: { ...lead, interested_services: parseServices(lead.interested_services) }, activities, owner_events: ownerEvents, status_events: statusEvents, followups, tasks, closed_task: closedTasks[0] ?? null, docs, enquiries, growth };
}

async function suggestions(env: Env) {
  const { results } = await env.DB.prepare(
    `SELECT c.id AS customer_id, c.company, d.salesperson_id AS owner_id, ${NAME("u")} AS owner_name, u.role AS owner_role,
            d.doc_number, d.doc_type, d.created_at AS doc_at
       FROM customers c
       JOIN sales_documents d ON d.id = (
         SELECT d2.id FROM sales_documents d2
          WHERE d2.customer_id = c.id AND d2.doc_type IN ('QT', 'INV') AND d2.salesperson_id IS NOT NULL
            AND COALESCE(d2.payment_status, '') != 'void'
          ORDER BY d2.created_at DESC, d2.id DESC LIMIT 1)
       JOIN users u ON u.id = d.salesperson_id
      WHERE c.owner_id IS NULL AND c.company != 'Walk-in Customer'
        AND u.is_active = 1 AND ${staffRolesSql("u.")} AND ${currentStaffSql("u.")}
      ORDER BY c.company COLLATE NOCASE LIMIT 500`,
  ).all<{ customer_id: number; company: string; owner_id: number; owner_name: string; owner_role: string; doc_number: string; doc_type: string; doc_at: string }>();
  return (results ?? []).filter((s) => can(s.owner_role, "sales")).map(({ owner_role: _r, ...s }) => s);
}

function version(b: Body | null): number | null {
  const v = b?.version;
  return typeof v === "number" && Number.isInteger(v) && v > 0 ? v : null;
}

export async function handleCrm(env: Env, path: string, method: string, user: StaffUser, params: URLSearchParams, body: Body | null): Promise<Response | null> {
  if (path !== "/crm" && !path.startsWith("/crm/")) return null;
  if (["agent", "customer"].includes(user.role)) return err("forbidden", "Sales access required", 403);
  const reads = canUser(user, "sales") || canUser(user, "exec_view");
  if (!reads) return err("forbidden", "Sales access required", 403);
  const writes = canUser(user, "sales");
  try {
    if (path === "/crm/options" && method === "GET") {
      const pk = await env.DB.prepare(`SELECT id, name, status FROM sales_packages WHERE status != 'draft' ORDER BY status, name COLLATE NOCASE`).all<{ id: number; name: string; status: string }>()
        .then((r) => r.results ?? []).catch(() => []);
      return json({ sources: LEAD_SOURCES, statuses: LEAD_STATUSES, activity_kinds: ACTIVITY_KINDS, packages: pk, owners: (await owners(env)).map(({ id, name }) => ({ id, name })), can_assign: canUser(user, "crm_assign"), can_write: writes });
    }
    if (path === "/crm/summary" && method === "GET") return json(await summary(env, user, params.get("scope") === "all" ? "all" : "mine"));
    if (path === "/crm/leads" && method === "GET") return json(await listLeads(env, user, params));
    if (path === "/crm/suggestions" && method === "GET") {
      if (!canUser(user, "crm_assign")) return err("forbidden", "Only a manager assigns leads", 403);
      return json({ rows: await suggestions(env) });
    }
    if (path === "/crm/suggestions/confirm" && method === "POST") {
      if (!canUser(user, "crm_assign")) return err("forbidden", "Only a manager assigns leads", 403);
      const reason = str(body?.reason, 300) ? String(body!.reason).trim() : "";
      if (reason.length < 5) return err("invalid_input", "Say why, in a few words.", 400);
      const items = Array.isArray(body?.items) ? (body!.items as unknown[]) : [];
      if (items.length === 0 || items.length > 100) return err("invalid_input", "Tick 1 to 100 customers.", 400);
      const now = new Map((await suggestions(env)).map((s) => [s.customer_id, s.owner_id]));
      let applied = 0; const skipped: number[] = [];
      for (const it of items) {
        const cid = Number((it as Body)?.customer_id), oid = Number((it as Body)?.owner_id);
        /* only the suggestion as it stands now - never an owner the server did not suggest */
        if (!Number.isInteger(cid) || now.get(cid) !== oid) { skipped.push(cid); continue; }
        const [ev] = await env.DB.batch([
          env.DB.prepare(`INSERT INTO customer_owner_events (customer_id, from_owner, to_owner, kind, reason, created_by)
                          SELECT ?1, NULL, ?2, 'suggestion', ?3, ?4 WHERE EXISTS (SELECT 1 FROM customers WHERE id = ?1 AND owner_id IS NULL)`).bind(cid, oid, reason, user.id),
          env.DB.prepare(`UPDATE customers SET owner_id = ?2, crm_version = crm_version + 1 WHERE id = ?1 AND owner_id IS NULL`).bind(cid, oid),
        ]);
        if (ev?.meta?.changes) {
          applied++;
          await notify(env, oid, "enquiry", `A lead is now yours: confirmed by ${user.name}`, `lead:${cid}`);
        } else skipped.push(cid);
      }
      await audit(env, user.id, "crm.owner_suggestions", "customers", undefined, { applied, skipped: skipped.length, reason });
      return json({ ok: true, applied, skipped });
    }
    if (path === "/crm/convert" && method === "POST") {
      if (!writes) return err("forbidden", "Sales access required", 403);
      const source = body?.source === "growth" ? "growth" : body?.source === "enquiry" ? "enquiry" : null;
      const id = Number(body?.id);
      if (!source || !Number.isInteger(id) || id <= 0) return err("invalid_input", "Name the enquiry or Growth Check entry.", 400);
      const table = source === "growth" ? "business_growth_enquiries" : "enquiries";
      const e = source === "growth"
        ? await env.DB.prepare(`SELECT id, customer_id, business_name AS company, full_name AS contact, whatsapp AS phone, email, owner_id, source AS src, ref FROM business_growth_enquiries WHERE id = ?1 AND test_marked_at IS NULL`).bind(id).first<Record<string, unknown>>() // v1.418.0 - a test entry never becomes a lead
        : await env.DB.prepare(`SELECT id, customer_id, COALESCE(NULLIF(TRIM(company), ''), name) AS company, name AS contact, phone, email, assigned_to AS owner_id, site AS src, NULL AS ref FROM enquiries WHERE id = ?1`).bind(id).first<Record<string, unknown>>();
      if (!e) return err("not_found", "Entry not found", 404);
      if (e.customer_id) return json({ ok: true, customer_id: e.customer_id, existing: true });
      const key = `${source}:${id}`;
      const linkTo = body?.customer_id == null ? null : Number(body.customer_id);
      if (linkTo !== null) {
        const c = await env.DB.prepare(`SELECT id FROM customers WHERE id = ?1 AND company != 'Walk-in Customer'`).bind(linkTo).first();
        if (!c) return err("not_found", "Customer not found", 404);
        await env.DB.prepare(`UPDATE ${table} SET customer_id = ?2 WHERE id = ?1 AND customer_id IS NULL`).bind(id, linkTo).run();
        const now = await env.DB.prepare(`SELECT customer_id FROM ${table} WHERE id = ?1`).bind(id).first<{ customer_id: number }>();
        await audit(env, user.id, "crm.link", table, String(id), { customer_id: now?.customer_id });
        await bumpVersion(env, source === "growth" ? "business-growth" : "enquiries");
        return json({ ok: true, customer_id: now?.customer_id, linked: true });
      }
      const company = String(e.company ?? "").trim();
      if (!company) return err("invalid_input", "The entry has no name to make a customer from.", 400);
      if (body?.confirm_duplicate !== true) {
        const dupes = await crmDuplicates(env, company, e.phone, e.email);
        if (dupes.length) return json({ error: { code: "possible_duplicate", message: `Already on file: ${dupes.map((d) => d.company).join(", ")}. Link to one of them, or confirm a new customer.` }, candidates: dupes }, 409);
      }
      const own = e.owner_id ? (await owners(env)).find((o) => o.id === Number(e.owner_id))?.id ?? null : null;
      const lsrc = source === "growth" ? "growth_check" : "website";
      const detail = source === "growth" ? [e.ref, e.src].filter(Boolean).join(" · ") : String(e.src ?? "");
      await env.DB.batch([
        env.DB.prepare(
          `INSERT INTO customers (company, contact_person, phone, email, created_by, lead_source, lead_source_detail, relationship_status, owner_id, crm_key)
           SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, 'new_lead', ?8, ?9
            WHERE NOT EXISTS (SELECT 1 FROM customers WHERE crm_key = ?9)
              AND NOT EXISTS (SELECT 1 FROM ${table} WHERE id = ?10 AND customer_id IS NOT NULL)`,
        ).bind(company.slice(0, 200), e.contact ? String(e.contact).slice(0, 120) : null, e.phone ? String(e.phone).slice(0, 40) : null, e.email ? String(e.email).slice(0, 200) : null, user.id, lsrc, detail.slice(0, 200) || null, own, key, id),
        env.DB.prepare(`UPDATE ${table} SET customer_id = (SELECT id FROM customers WHERE crm_key = ?1) WHERE id = ?2 AND customer_id IS NULL`).bind(key, id),
        env.DB.prepare(`INSERT INTO customer_status_events (customer_id, from_status, to_status, reason, created_by)
                        SELECT c.id, NULL, 'new_lead', ?2, ?3 FROM customers c WHERE c.crm_key = ?1
                           AND NOT EXISTS (SELECT 1 FROM customer_status_events s WHERE s.customer_id = c.id)`).bind(key, `Converted from ${source === "growth" ? "Business Growth Check" : "website enquiry"} #${id}`, user.id),
        env.DB.prepare(`INSERT INTO customer_owner_events (customer_id, from_owner, to_owner, kind, reason, created_by)
                        SELECT c.id, NULL, c.owner_id, 'convert', ?2, ?3 FROM customers c WHERE c.crm_key = ?1 AND c.owner_id IS NOT NULL
                           AND NOT EXISTS (SELECT 1 FROM customer_owner_events o WHERE o.customer_id = c.id)`).bind(key, "The owner of the entry it came from", user.id),
      ]);
      const now = await env.DB.prepare(`SELECT customer_id FROM ${table} WHERE id = ?1`).bind(id).first<{ customer_id: number }>();
      await audit(env, user.id, "crm.convert", table, String(id), { customer_id: now?.customer_id });
      /* the customer list and the inbox the entry came from refresh on every screen (the "crm" topic is bumped by the route itself) */
      await bumpVersion(env, "customers");
      await bumpVersion(env, source === "growth" ? "business-growth" : "enquiries");
      return json({ ok: true, customer_id: now?.customer_id, created: true }, 201);
    }

    const m = /^\/crm\/leads\/(\d+)(?:\/(activities|profile|status|assign))?$/.exec(path);
    if (!m) return err("not_found", "Not found", 404);
    const id = Number(m[1]);
    const act = m[2] ?? "";
    if (!act && method === "GET") {
      const d = await leadDetail(env, id);
      return d ? json(d) : err("not_found", "Lead not found", 404);
    }
    if (method !== "POST" && method !== "PUT") return err("method_not_allowed", "Not allowed", 405);
    if (act === "assign" ? !canUser(user, "crm_assign") : !writes) return err("forbidden", act === "assign" ? "Only a manager assigns leads" : "Sales access required", 403);
    const cur = await env.DB.prepare(`SELECT id, owner_id, relationship_status, crm_version, company FROM customers WHERE id = ?1 AND company != 'Walk-in Customer'`)
      .bind(id).first<{ id: number; owner_id: number | null; relationship_status: string | null; crm_version: number; company: string }>();
    if (!cur) return err("not_found", "Lead not found", 404);

    if (act === "activities" && method === "POST") {
      const kind = String(body?.kind ?? "");
      if (!(ACTIVITY_KINDS as readonly string[]).includes(kind)) return err("invalid_input", "Choose call, WhatsApp, email, meeting, note or proposal.", 400);
      const note = str(body?.note, 1000) ? String(body!.note).trim() : "";
      if (note.length < 3) return err("invalid_input", "Say what happened.", 400);
      const outcome = str(body?.outcome, 120) ? String(body!.outcome).trim() : null;
      const ck = typeof body?.client_key === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(body.client_key) ? body.client_key : null;
      if (!ck) return err("invalid_input", "client_key is required.", 400);
      /* when it happened: now, or earlier today / in the last 30 days (Malaysia time), never later */
      let at = new Date().toISOString().slice(0, 19).replace("T", " ");
      if (typeof body?.occurred_at === "string" && body.occurred_at) {
        const t = Date.parse(`${body.occurred_at}+08:00`);
        if (Number.isNaN(t) || t > Date.now() + 60000 || t < Date.now() - 30 * 86400000) return err("invalid_input", "When it happened: in the last 30 days, never later than now.", 400);
        at = new Date(t).toISOString().slice(0, 19).replace("T", " ");
      }
      await env.DB.prepare(
        `INSERT OR IGNORE INTO sales_activities (customer_id, kind, outcome, note, occurred_at, source_key, created_by) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
      ).bind(id, kind, outcome, note, at, `client:${ck}`, user.id).run();
      const row = await env.DB.prepare(`SELECT id, customer_id, created_by FROM sales_activities WHERE source_key = ?1`).bind(`client:${ck}`).first<{ id: number; customer_id: number; created_by: number }>();
      if (!row || row.customer_id !== id || row.created_by !== user.id) return err("invalid_input", "That key was already used.", 409);
      await audit(env, user.id, "crm.activity", "customers", String(id), { activity_id: row.id, kind });
      return json({ ok: true, id: row.id }, 201);
    }

    const v = version(body);
    if (v === null) return err("invalid_input", "version is required.", 400);
    /* the version is checked IN the write (crm_version = ?), so two people pressing at once cannot both land */

    if (act === "profile" && method === "PUT") {
      const src = body?.lead_source == null || body.lead_source === "" ? null : String(body.lead_source);
      if (src !== null && !(LEAD_SOURCES as readonly string[]).includes(src)) return err("invalid_input", "Choose a source from the list.", 400);
      const detail = str(body?.lead_source_detail, 200) ? String(body!.lead_source_detail).trim() : null;
      const services = await cleanServices(env, body?.interested_services);
      if (services instanceof Response) return services;
      const r = await env.DB.prepare(
        `UPDATE customers SET lead_source = ?2, lead_source_detail = ?3, interested_services = ?4, crm_version = crm_version + 1 WHERE id = ?1 AND crm_version = ?5`,
      ).bind(id, src, detail, JSON.stringify(services), v).run();
      if (!r.meta?.changes) return err("changed", "Someone changed this lead a moment ago. Open it again and retry.", 409);
      await audit(env, user.id, "crm.profile", "customers", String(id), { lead_source: src, services: services.length });
      return json({ ok: true, version: v + 1 });
    }

    if (act === "status" && method === "POST") {
      const to = String(body?.to ?? "");
      if (!(LEAD_STATUSES as readonly string[]).includes(to)) return err("invalid_input", "Choose a status from the list.", 400);
      if (to === cur.relationship_status) return err("invalid_input", "It already has that status.", 400);
      const reason = str(body?.reason, 300) ? String(body!.reason).trim() : "";
      if ((to === "disqualified" || to === "inactive") && reason.length < 10) return err("invalid_input", "Say why, in at least 10 characters.", 400);
      const [ev] = await env.DB.batch([
        env.DB.prepare(`INSERT INTO customer_status_events (customer_id, from_status, to_status, reason, created_by)
                        SELECT ?1, ?2, ?3, ?4, ?5 WHERE EXISTS (SELECT 1 FROM customers WHERE id = ?1 AND crm_version = ?6)`).bind(id, cur.relationship_status, to, reason || null, user.id, v),
        env.DB.prepare(`UPDATE customers SET relationship_status = ?2, crm_version = crm_version + 1 WHERE id = ?1 AND crm_version = ?3`).bind(id, to, v),
      ]);
      if (!ev?.meta?.changes) return err("changed", "Someone changed this lead a moment ago. Open it again and retry.", 409);
      await audit(env, user.id, "crm.status", "customers", String(id), { from: cur.relationship_status, to, reason: reason || null });
      return json({ ok: true, version: v + 1 });
    }

    if (act === "assign" && method === "POST") {
      const to = body?.owner_id == null ? null : Number(body.owner_id);
      if (to !== null && !(await owners(env)).some((o) => o.id === to)) return err("invalid_input", "The owner must be a current member of the sales team.", 400);
      if (to === cur.owner_id) return err("invalid_input", "That person already owns it.", 400);
      const reason = str(body?.reason, 300) ? String(body!.reason).trim() : "";
      const kind = to === null ? "unassign" : cur.owner_id === null ? "assign" : "reassign";
      if (kind !== "assign" && reason.length < 5) return err("invalid_input", "Say why, in a few words.", 400);
      const [ev] = await env.DB.batch([
        env.DB.prepare(`INSERT INTO customer_owner_events (customer_id, from_owner, to_owner, kind, reason, created_by)
                        SELECT ?1, ?2, ?3, ?4, ?5, ?6 WHERE EXISTS (SELECT 1 FROM customers WHERE id = ?1 AND crm_version = ?7)`).bind(id, cur.owner_id, to, kind, reason || null, user.id, v),
        env.DB.prepare(`UPDATE customers SET owner_id = ?2, crm_version = crm_version + 1 WHERE id = ?1 AND crm_version = ?3`).bind(id, to, v),
      ]);
      if (!ev?.meta?.changes) return err("changed", "Someone changed this lead a moment ago. Open it again and retry.", 409);
      await audit(env, user.id, `crm.${kind}`, "customers", String(id), { from: cur.owner_id, to, reason: reason || null });
      if (to !== null) await notify(env, to, "enquiry", `Lead assigned to you: ${cur.company}`, `lead:${id}`);
      if (cur.owner_id !== null && cur.owner_id !== to) await notify(env, cur.owner_id, "enquiry", `${cur.company} is no longer your lead`, `lead:${id}`);
      return json({ ok: true, version: v + 1, kind });
    }
    return err("method_not_allowed", "Not allowed", 405);
  } catch (e) {
    if (missing(e)) return skewErr();
    throw e;
  }
}
