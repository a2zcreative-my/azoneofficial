/**
 * PROJECT WORKSPACE — v1.245.0.
 *
 * The owner's brief "A2Z OS — Quotation-linked Project Workspace & Task
 * Report", approved 31-10-2026 with decisions P-1 to P-6
 * (claude/PROJECT-WORKSPACE-AUDIT.md):
 *   P-1 a brief is created on a press of "Create project brief", never on
 *       save - one per quotation (UNIQUE quotation_id), a second press
 *       returns the same project;
 *   P-2 the Project Owner is assigned by the CEO or COO (pre-filled with the
 *       quotation's salesperson); nothing records who acquired a client, so
 *       it is never guessed, and changing it never touches the closer or
 *       commission;
 *   P-3 Completed is confirmed by the CEO or COO (project_complete); the
 *       owner and the CCO request it;
 *   P-4 the quotation page with the reference's tabs (client side);
 *   P-5 a simple timeline view of the tasks (client side);
 *   P-6 the assigned team sees the customer contact's phone and email.
 *
 * WHAT IS NOT HERE, ON PURPOSE: no task table (project tasks are ordinary
 * tasks with link_kind 'project', created through POST /tasks), no customer
 * or package copies (read from the quotation each time, frozen only as the
 * activation snapshot), no audit engine (audit_log), no notification engine
 * (notify), no write to sales_documents, commission, payroll or the cash
 * book - tests/go-live-p.mjs fails if one appears.
 *
 * AUTHORIZATION is decided HERE, per request, from the database: the role's
 * capabilities (permissions.ts), whether the person is this project's owner,
 * and whether they hold a task on it. Nothing comes from the request body.
 */
import type { Env } from "./index";
import type { StaffUser } from "./staff";
import { notify, currentStaffSql, staffRolesSql } from "./staff";
import { can } from "./permissions";
import { audit, err, json, str } from "./shared";
import { appendTaskUpdate, appendProjectNote, latestUpdates, loadTask, storeTaskFile, streamTaskFile, taskAccess } from "./tasks-progress"; // v1.246.0 - one progress record for every task (T-1)

export const PROJECT_STATUSES = ["draft", "ready", "in_progress", "waiting_client", "on_hold", "completed", "cancelled"] as const;
type PStatus = typeof PROJECT_STATUSES[number];
/* v1.246.0 (T-1) - a project-level entry (no task): a note to the team, a
   completion request, an offer to help, a general progress line. Task
   progress is the task's own (tasks-progress.ts) - the same table. */
const PROJECT_KINDS = ["progress", "note", "done_request", "assist_request", "correction"] as const;
const OPEN: PStatus[] = ["draft", "ready", "in_progress", "waiting_client", "on_hold"];

export interface ProjectRow {
  id: number; quotation_id: number; customer_id: number; owner_id: number | null; owner_set_by: number | null; owner_set_at: string | null;
  status: PStatus; title: string; description: string | null; start_date: string | null; due_date: string | null; notes: string | null;
  deliverables: string | null; scope_revision: number | null; scope_snapshot: string | null; activated_at: string | null; activated_by: number | null;
  activation_reason: string | null; completion_requested_at: string | null; completion_requested_by: number | null; completed_at: string | null;
  completed_by: number | null; cancelled_at: string | null; cancelled_by: number | null; cancel_reason: string | null; version: number;
  created_by: number | null; created_at: string; updated_by: number | null; updated_at: string;
}
interface QtRow {
  id: number; doc_number: string; doc_type: string; customer_id: number; items: string; total_cents: number; discount_cents: number | null;
  tax_percent: number | null; delivery_cents: number | null; valid_until: string | null; revision: number | null; salesperson_id: number | null;
  created_by: number | null; created_at: string; issuer_code: string | null; package_id: number | null; package_version: number | null;
  package_customized: number | null; reference: string | null; kind: string | null;
}

const PERSON = (a: string) => `COALESCE(NULLIF(TRIM(${a}.full_name), ''), ${a}.name)`;
const myt = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
function validDay(d: unknown): d is string {
  if (typeof d !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  const t = Date.parse(`${d}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().startsWith(d);
}
const missing = (e: unknown) => /no such table|no such column/i.test(String(e));
const MIGRATION = () => err("migration_missing", "Run migration 0159 first (PUSH.bat)", 503);

async function loadProject(env: Env, id: number): Promise<ProjectRow | null> {
  return env.DB.prepare(`SELECT * FROM projects WHERE id = ?1`).bind(id).first<ProjectRow>();
}
async function loadQt(env: Env, id: number): Promise<QtRow | null> {
  return env.DB.prepare(`SELECT * FROM sales_documents WHERE id = ?1 AND doc_type = 'QT'`).bind(id).first<QtRow>();
}

/** The quotation's state, from the same facts the Sales screen reads:
    accepted (the customer accepted the CURRENT revision on the shared link),
    invoiced (a live - not void - invoice made from it), expired (past its
    validity and not invoiced). Nothing is written onto the quotation. */
export async function quotationState(env: Env, qt: QtRow): Promise<{ accepted: boolean; accepted_at: string | null; accepted_name: string | null; invoiced: boolean; invoice: string | null; expired: boolean; label: string }> {
  const acc = await env.DB.prepare(`SELECT accepted_at, accepted_name FROM quotation_acceptances WHERE doc_id = ?1 AND revision = ?2`)
    .bind(qt.id, Number(qt.revision ?? 0)).first<{ accepted_at: string; accepted_name: string }>().catch(() => null);
  const inv = await env.DB.prepare(
    `SELECT doc_number FROM sales_documents WHERE doc_type = 'INV' AND converted_from = ?1 AND COALESCE(payment_status, '') != 'void' ORDER BY id DESC LIMIT 1`,
  ).bind(qt.id).first<{ doc_number: string }>().catch(() => null);
  const expired = !inv && !!qt.valid_until && qt.valid_until.slice(0, 10) < myt();
  const label = inv ? "invoiced" : acc ? "accepted" : expired ? "expired" : "open";
  return { accepted: !!acc, accepted_at: acc?.accepted_at ?? null, accepted_name: acc?.accepted_name ?? null, invoiced: !!inv, invoice: inv?.doc_number ?? null, expired, label };
}

export interface Access { view: boolean; manage: boolean; owner: boolean; assigned: boolean; ownerAssign: boolean; complete: boolean; prices: boolean; contact: boolean; mgmt: boolean }
/** Who may do what on THIS project - the one place it is decided. */
export async function projectAccess(env: Env, user: StaffUser, p: ProjectRow): Promise<Access> {
  const view = can(user.role, "project_view");
  const mgmt = can(user.role, "project_manage");
  const owner = p.owner_id !== null && p.owner_id === user.id;
  const assigned = !!(await env.DB.prepare(`SELECT 1 AS x FROM tasks WHERE link_kind = 'project' AND link_id = ?1 AND assigned_to = ?2 LIMIT 1`)
    .bind(p.id, user.id).first().catch(() => null));
  const manage = view && (mgmt || owner);
  return {
    view, manage, owner, assigned: view && assigned, mgmt,
    ownerAssign: can(user.role, "project_owner_assign"),
    complete: can(user.role, "project_complete"),
    prices: view && (mgmt || owner || can(user.role, "sales")),
    contact: view && (mgmt || owner || assigned || can(user.role, "sales")),
  };
}

/** For staff.ts: may this person create a task on project #id, or reassign /
    edit a project task? The project's owner and project_manage, while the
    project is open. Returns null when allowed, else the Response. */
/* v1.246.2 - ONE way a project comes to exist: from its quotation, by the
   quotation's salesperson, its creator or the CEO, COO or CCO - pressed on
   the quotation page, on the Projects board, or implied by a task set under
   the quotation. The Owner is chosen by management afterwards (P-2); until
   then the quotation's salesperson may set tasks under it (projectTaskGate).
   UNIQUE(quotation_id): two presses that cross make one. */
export async function ensureProject(env: Env, user: StaffUser, qid: number): Promise<{ id: number; existing: boolean } | Response> {
  let qt: QtRow | null = null;
  try { qt = await loadQt(env, qid); } catch (e) { if (missing(e)) return MIGRATION(); throw e; }
  if (!qt) return err("not_found", "Quotation not found", 404);
  /* an existing project is simply found (its own gates decide what the
     caller may do with it); creating one is for the people below */
  const existing = await env.DB.prepare(`SELECT id FROM projects WHERE quotation_id = ?1`).bind(qid).first<{ id: number }>();
  if (existing) return { id: existing.id, existing: true };
  const manager = can(user.role, "project_manage");
  const mayCreate = manager || qt.salesperson_id === user.id || qt.created_by === user.id;
  if (!mayCreate) return err("forbidden", "The quotation's salesperson or the CEO, COO or CCO create its project brief", 403);
  /* v1.246.3 - the owner, 01-11-2026: a project starts only once the
     customer has agreed to proceed - accepted on the shared link, recorded
     by staff (POST /docs/:id/acceptance), or already invoiced. */
  const st = await quotationState(env, qt);
  if (!st.accepted && !st.invoiced) return err("not_accepted", "Record the customer's acceptance of this quotation first - a project starts once the customer has agreed to proceed", 409);
  const cust = await env.DB.prepare(`SELECT id, company FROM customers WHERE id = ?1`).bind(qt.customer_id).first<{ id: number; company: string }>();
  if (!cust) return err("invalid_input", "The quotation's customer was not found", 409);
  let title = `${cust.company} - ${qt.doc_number}`;
  if (qt.package_id) {
    const pk = await env.DB.prepare(`SELECT name FROM sales_packages WHERE id = ?1`).bind(qt.package_id).first<{ name: string }>().catch(() => null);
    if (pk?.name) title = `${pk.name} - ${cust.company}`;
  }
  const ins = await env.DB.prepare(
    `INSERT INTO projects (quotation_id, customer_id, title, status, created_by, updated_by) VALUES (?1, ?2, ?3, 'draft', ?4, ?4)
     ON CONFLICT(quotation_id) DO NOTHING RETURNING id`,
  ).bind(qid, qt.customer_id, title.slice(0, 200), user.id).first<{ id: number }>();
  if (!ins) {
    const again = await env.DB.prepare(`SELECT id FROM projects WHERE quotation_id = ?1`).bind(qid).first<{ id: number }>();
    return { id: again?.id ?? 0, existing: true };
  }
  await audit(env, user.id, "project.create", "projects", String(ins.id), { quotation_id: qid, doc_number: qt.doc_number });
  return { id: ins.id, existing: false };
}
/* v1.247.1 - "Edited the project (start_date, due_date)" read like a database
   log (the owner's screenshot, 01-11-2026): the activity says it in words,
   with the dates from and to when the edit recorded them. */
const FIELD_WORDS: Record<string, string> = { title: "the title", description: "the description", notes: "the notes", deliverables: "the deliverables", start_date: "the start date", due_date: "the due date" };
const dayWords = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? new Date(`${v.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "not set");
function editText(d: Record<string, unknown>): string {
  const dates = (d.dates ?? {}) as Record<string, [unknown, unknown]>;
  const parts: string[] = [];
  for (const f of (d.fields as string[] | undefined) ?? []) {
    if (dates[f]) parts.push(`${f === "start_date" ? "Start date" : "Due date"} ${dayWords(dates[f]![0])} → ${dayWords(dates[f]![1])}`);
    else parts.push(`changed ${FIELD_WORDS[f] ?? f.replace(/_/g, " ")}`);
  }
  if (!parts.length) return "Edited the project";
  const text = parts.join("; ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export async function projectTaskGate(env: Env, user: StaffUser, projectId: number): Promise<Response | null> {
  let p: ProjectRow | null = null;
  try { p = await loadProject(env, projectId); } catch (e) { if (missing(e)) return MIGRATION(); throw e; }
  if (!p) return err("not_found", "That project was not found", 404);
  if (!OPEN.includes(p.status)) return err("project_closed", `This project is ${p.status.replace("_", " ")} - its tasks no longer change`, 409);
  const a = await projectAccess(env, user, p);
  if (a.manage) return null;
  /* v1.246.2 - no Owner chosen yet: the quotation's own salesperson (or
     whoever raised it) sets its first tasks - they are the ones who know the
     work, and the owner asked for a task to "capture the quotation" from
     the Create Task drawer. Once an Owner is named, the Owner and management
     run the tasks, as before. */
  if (p.owner_id == null) {
    const qt = await env.DB.prepare(`SELECT salesperson_id, created_by FROM sales_documents WHERE id = ?1`).bind(p.quotation_id).first<{ salesperson_id: number | null; created_by: number | null }>();
    if (qt && (qt.salesperson_id === user.id || qt.created_by === user.id)) return null;
  }
  return err("forbidden", "Only the Project Owner or the CEO, COO or CCO manage this project's tasks", 403);
}
/** For staff.ts: the project a task belongs to, if any. */
export async function taskProject(env: Env, taskId: number | string): Promise<number | null> {
  const t = await env.DB.prepare(`SELECT link_kind, link_id FROM tasks WHERE id = ?1`).bind(taskId)
    .first<{ link_kind: string | null; link_id: number | null }>().catch(() => null);
  return t?.link_kind === "project" && t.link_id ? Number(t.link_id) : null;
}

/** The agreed scope, frozen when a project becomes active (one definition for every door that activates). */
function scopeSnapshot(qt: QtRow): string {
  return JSON.stringify({ revision: Number(qt.revision ?? 0), lines: parseLines(qt.items), package_id: qt.package_id, package_version: qt.package_version, package_customized: qt.package_customized, total_cents: qt.total_cents, discount_cents: Number(qt.discount_cents ?? 0), tax_percent: Number(qt.tax_percent ?? 0), delivery_cents: Number(qt.delivery_cents ?? 0) });
}

type Line = { name?: string; qty?: number; uom?: string; unit_price_cents?: number; disc_cents?: number; sub?: string[] };
function parseLines(items: string | null): Line[] {
  try { const v = JSON.parse(items ?? "[]"); return Array.isArray(v) ? v : []; } catch { return []; }
}
function scopeOf(lines: Line[], prices: boolean) {
  return lines.map((l) => ({
    name: String(l.name ?? ""), qty: Number(l.qty ?? 0), uom: l.uom ?? null, sub: Array.isArray(l.sub) ? l.sub : [],
    ...(prices ? { unit_price_cents: Number(l.unit_price_cents ?? 0), disc_cents: Number(l.disc_cents ?? 0), line_cents: Math.round(Number(l.qty ?? 0) * Number(l.unit_price_cents ?? 0)) - Number(l.disc_cents ?? 0) } : {}),
  }));
}

async function managersOf(env: Env, cap: "project_manage" | "project_complete"): Promise<number[]> {
  const roles = ["ceo", "coo", "cco"].filter((r) => can(r as StaffUser["role"], cap));
  if (!roles.length) return [];
  const rows = (await env.DB.prepare(
    `SELECT id FROM users WHERE is_active = 1 AND role IN (${roles.map((_, i) => `?${i + 1}`).join(",")}) AND ${currentStaffSql()}`,
  ).bind(...roles).all<{ id: number }>()).results;
  return rows.map((r) => r.id);
}
async function tell(env: Env, ids: (number | null | undefined)[], except: number, msg: string, ref: string) {
  for (const id of [...new Set(ids.filter((x): x is number => typeof x === "number" && x !== except))]) {
    try { await notify(env, id, "task", msg, `${ref}:${id}`, { once: true }); } catch { /* a bell never blocks the work */ }
  }
}

export async function handleProjects(
  env: Env, path: string, method: string, body: Record<string, unknown> | null, user: StaffUser, q: URLSearchParams, request: Request,
): Promise<Response | null> {
  if (!(path === "/projects" || path.startsWith("/projects/"))) return null;
  if (!can(user.role, "project_view")) return err("forbidden", "Projects are for staff", 403);
  try {
    return await route(env, path, method, body, user, q, request);
  } catch (e) {
    if (missing(e)) return MIGRATION();
    throw e;
  }
}

async function route(env: Env, path: string, method: string, body: Record<string, unknown> | null, user: StaffUser, q: URLSearchParams, request: Request): Promise<Response | null> {
  /* ---------------- the list: mine / I'm on / all ---------------- */
  if (path === "/projects" && method === "GET") {
    const scope = q.get("scope") ?? "all";
    const st = q.get("status");
    const where: string[] = []; const args: unknown[] = [];
    if (scope === "mine") { args.push(user.id); where.push(`p.owner_id = ?${args.length}`); }
    else if (scope === "assigned") { args.push(user.id); where.push(`EXISTS (SELECT 1 FROM tasks t WHERE t.link_kind = 'project' AND t.link_id = p.id AND t.assigned_to = ?${args.length})`); }
    if (st && (PROJECT_STATUSES as readonly string[]).includes(st)) { args.push(st); where.push(`p.status = ?${args.length}`); }
    else if (st === "open") where.push(`p.status NOT IN ('completed', 'cancelled')`);
    const rows = (await env.DB.prepare(
      `SELECT p.id, p.quotation_id, p.title, p.status, p.due_date, p.owner_id, p.updated_at, d.doc_number, c.company,
              ${PERSON("o")} AS owner_name,
              (SELECT COUNT(*) FROM tasks t WHERE t.link_kind = 'project' AND t.link_id = p.id) AS tasks,
              (SELECT COUNT(*) FROM tasks t WHERE t.link_kind = 'project' AND t.link_id = p.id AND t.status = 'completed') AS done,
              (SELECT COALESCE(AVG(CASE WHEN t.status = 'completed' THEN 100 ELSE t.progress END), 0) FROM tasks t WHERE t.link_kind = 'project' AND t.link_id = p.id) AS progress,
              (SELECT COUNT(*) FROM tasks t WHERE t.link_kind = 'project' AND t.link_id = p.id AND t.assigned_to = ?${args.length + 1} AND t.status != 'completed') AS my_open
         FROM projects p JOIN sales_documents d ON d.id = p.quotation_id JOIN customers c ON c.id = p.customer_id
         LEFT JOIN users o ON o.id = p.owner_id
        ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
        ORDER BY p.status IN ('completed', 'cancelled'), p.updated_at DESC LIMIT 200`,
    ).bind(...args, user.id).all()).results;
    return json({ projects: rows.map((r) => ({ ...r, progress: Math.round(Number((r as { progress: number }).progress ?? 0)) })), can_manage: can(user.role, "project_manage") });
  }

  /* ---------------- the quotation's project (or none) ---------------- */
  const byQt = /^\/projects\/by-quotation\/(\d+)$/.exec(path);
  if (byQt && method === "GET") {
    const qt = await loadQt(env, Number(byQt[1]));
    if (!qt) return err("not_found", "Quotation not found", 404);
    const p = await env.DB.prepare(`SELECT id, status, title, owner_id FROM projects WHERE quotation_id = ?1`).bind(qt.id).first<{ id: number; status: string; title: string; owner_id: number | null }>();
    const st = await quotationState(env, qt);
    /* the quotation's own events, for the Activity Log tab before a project exists */
    const events: { at: string; kind: string; text: string; by: string | null }[] = [{ at: qt.created_at, kind: "quotation_created", text: `${qt.doc_number} created`, by: await nameOf(env, qt.created_by) }];
    try {
      for (const r of (await env.DB.prepare(`SELECT r.revision, r.replaced_at, ${PERSON("u")} AS who FROM sales_document_revisions r LEFT JOIN users u ON u.id = r.replaced_by WHERE r.doc_id = ?1 ORDER BY r.revision`).bind(qt.id).all<{ revision: number; replaced_at: string; who: string | null }>()).results)
        events.push({ at: r.replaced_at, kind: "quotation_revised", text: `Revision ${r.revision + 1} replaced revision ${r.revision}`, by: r.who });
    } catch { /* pre-0139 */ }
    try {
      for (const r of (await env.DB.prepare(`SELECT revision, accepted_name, accepted_at FROM quotation_acceptances WHERE doc_id = ?1 ORDER BY id`).bind(qt.id).all<{ revision: number; accepted_name: string; accepted_at: string }>()).results)
        events.push({ at: r.accepted_at, kind: "quotation_accepted", text: `Accepted by ${r.accepted_name} (revision ${r.revision})`, by: null });
    } catch { /* pre-0143 */ }
    for (const r of (await env.DB.prepare(`SELECT doc_number, created_at, payment_status FROM sales_documents WHERE doc_type = 'INV' AND converted_from = ?1 ORDER BY id`).bind(qt.id).all<{ doc_number: string; created_at: string; payment_status: string | null }>()).results)
      events.push({ at: r.created_at, kind: "quotation_invoiced", text: `Invoiced as ${r.doc_number}${r.payment_status === "void" ? " (voided)" : ""}`, by: null });
    events.sort((a, b) => b.at.localeCompare(a.at));
    const mayCreate = can(user.role, "project_manage") || qt.salesperson_id === user.id || qt.created_by === user.id;
    return json({
      project: p ?? null, quotation_state: st, events,
      can_create: !p && mayCreate && (st.accepted || st.invoiced), // v1.246.3 - only once the customer agreed
      can_record_acceptance: !p && mayCreate && !st.accepted && !st.invoiced && !st.expired,
      suggested_owner: qt.salesperson_id ? { id: qt.salesperson_id, name: await nameOf(env, qt.salesperson_id) } : null,
    });
  }

  /* ---------------- create the brief (P-1: on a press, once) ---------------- */
  if (path === "/projects" && method === "POST") {
    const qid = typeof body?.quotation_id === "number" ? body.quotation_id : NaN;
    if (!Number.isInteger(qid)) return err("invalid_input", "quotation_id is required", 400);
    /* v1.246.4 - the start and due dates picked in the Start project sheet */
    const dates: { start_date?: string; due_date?: string } = {};
    for (const f of ["start_date", "due_date"] as const) {
      if (body?.[f] === undefined || body?.[f] === null || body?.[f] === "") continue;
      if (!validDay(body[f])) return err("invalid_input", `${f.replace("_", " ")} must be a real date`, 400);
      dates[f] = String(body[f]);
    }
    if (dates.start_date && dates.due_date && dates.due_date < dates.start_date) return err("invalid_input", "The due date is before the start date", 400);
    const made = await ensureProject(env, user, qid);
    if (made instanceof Response) return made;
    if (!made.existing && (dates.start_date || dates.due_date)) {
      await env.DB.prepare(`UPDATE projects SET start_date = COALESCE(?1, start_date), due_date = COALESCE(?2, due_date) WHERE id = ?3`).bind(dates.start_date ?? null, dates.due_date ?? null, made.id).run();
    }
    /* v1.247.1 - the owner's screenshot: "Start project" left the project a
       "Draft brief" while its work was under way. The button says start, the
       quotation is accepted (ensureProject refuses otherwise), so the project
       starts: in progress, the agreed scope frozen, exactly as the status
       route activates it. */
    if (!made.existing && body?.start === true) {
      const qt = await loadQt(env, qid);
      if (qt) {
        await env.DB.prepare(
          `UPDATE projects SET status = 'in_progress', scope_revision = ?1, scope_snapshot = ?2, activated_at = datetime('now'), activated_by = ?3, updated_by = ?3, updated_at = datetime('now'), version = version + 1 WHERE id = ?4 AND status = 'draft'`,
        ).bind(Number(qt.revision ?? 0), scopeSnapshot(qt), user.id, made.id).run();
        await audit(env, user.id, "project.status", "projects", String(made.id), { from: "draft", to: "in_progress", activated: true, quotation: (await quotationState(env, qt)).label });
      }
    }
    return json(made, made.existing ? 200 : 201);
  }

  /* v1.246.2 - the quotations a task can be set under (the Create Task
     drawer) and the ones with no project yet (the Projects board). The CEO,
     COO and CCO see every live quotation; a salesperson sees their own. */
  if (path === "/projects/quotations" && method === "GET") {
    const all = can(user.role, "project_manage");
    const rows = (await env.DB.prepare(
      `SELECT d.id, d.doc_number, d.valid_until, d.revision, d.salesperson_id, d.created_by, c.company, c.contact_person,
              p.id AS project_id, p.status AS project_status, p.title AS project_title
         FROM sales_documents d JOIN customers c ON c.id = d.customer_id
         LEFT JOIN projects p ON p.quotation_id = d.id
        WHERE d.doc_type = 'QT' AND COALESCE(d.void_reason, '') = '' AND d.created_at >= datetime('now', '-365 days')
          AND (?1 = 1 OR d.salesperson_id = ?2 OR d.created_by = ?2)
          AND COALESCE(p.status, 'draft') NOT IN ('completed', 'cancelled')
        ORDER BY d.id DESC LIMIT 300`,
    ).bind(all ? 1 : 0, user.id).all<QtRow & { company: string; project_id: number | null; project_status: string | null; project_title: string | null }>().catch(() => ({ results: [] as (QtRow & { company: string; project_id: number | null; project_status: string | null; project_title: string | null })[] }))).results;
    const out = [];
    for (const r of rows) {
      const st = await quotationState(env, r);
      if (st.expired && !r.project_id) continue; // an expired, unaccepted quotation is revised first
      out.push({ id: r.id, doc_number: r.doc_number, company: r.company, contact_person: (r as { contact_person?: string | null }).contact_person ?? null, label: st.label, can_start: st.accepted || st.invoiced, project_id: r.project_id, project_status: r.project_status, project_title: r.project_title });
    }
    return json({ quotations: out, can_manage: all });
  }

  const m = /^\/projects\/(\d+)(\/[a-z]+)?(?:\/(\d+))?$/.exec(path);
  if (!m) return null;
  const pid = Number(m[1]);
  const sub = m[2] ?? "";
  const p = await loadProject(env, pid);
  if (!p) return err("not_found", "Project not found", 404);
  const a = await projectAccess(env, user, p);
  if (!a.view) return err("forbidden", "Projects are for staff", 403);

  /* ---------------- the workspace, cut to what this person may see ---------------- */
  if (sub === "" && method === "GET") {
    const qt = await loadQt(env, p.quotation_id);
    if (!qt) return err("not_found", "The project's quotation was not found", 404);
    const st = await quotationState(env, qt);
    const cust = await env.DB.prepare(`SELECT id, company, contact_person, phone, email FROM customers WHERE id = ?1`).bind(p.customer_id)
      .first<{ id: number; company: string; contact_person: string | null; phone: string | null; email: string | null }>();
    let pkg: { id: number; name: string; version: number | null; customized: boolean } | null = null;
    const snap = p.scope_snapshot ? JSON.parse(p.scope_snapshot) as { lines: Line[]; package_id: number | null; package_version: number | null; package_customized: number | null; revision: number; total_cents: number; discount_cents: number; tax_percent: number; delivery_cents: number } : null;
    const pkgId = snap ? snap.package_id : qt.package_id;
    if (pkgId) {
      const pk = await env.DB.prepare(`SELECT name FROM sales_packages WHERE id = ?1`).bind(pkgId).first<{ name: string }>().catch(() => null);
      pkg = { id: pkgId, name: pk?.name ?? `Package #${pkgId}`, version: snap ? snap.package_version : qt.package_version, customized: !!(snap ? snap.package_customized : qt.package_customized) };
    }
    const lines = snap ? snap.lines : parseLines(qt.items);
    const totals = a.prices ? (snap
      ? { total_cents: snap.total_cents, discount_cents: snap.discount_cents, tax_percent: snap.tax_percent, delivery_cents: snap.delivery_cents }
      : { total_cents: qt.total_cents, discount_cents: Number(qt.discount_cents ?? 0), tax_percent: Number(qt.tax_percent ?? 0), delivery_cents: Number(qt.delivery_cents ?? 0) }) : null;
    const rawTasks = (await env.DB.prepare(
      `SELECT t.id, t.title, t.description, t.assigned_to, ${PERSON("u")} AS assignee, u.photo_key, t.status, t.stage, t.progress, t.progress_source, t.priority, t.deadline, t.created_at, t.created_by
         FROM tasks t JOIN users u ON u.id = t.assigned_to WHERE t.link_kind = 'project' AND t.link_id = ?1 ORDER BY t.deadline IS NULL, t.deadline, t.id`,
    ).bind(p.id).all<{ id: number; title: string; assigned_to: number; assignee: string; photo_key: string | null; status: string; stage: string | null; progress: number; deadline: string | null }>()).results;
    const latest = await latestUpdates(env, rawTasks.map((t) => t.id));
    const tasks = rawTasks.map((t) => {
      const l = latest.get(t.id) ?? null;
      return {
        ...t,
        last_update_at: l?.at ?? null, last_update_by: l?.by ?? null, last_update_kind: l?.kind ?? null, last_update: l?.body ?? null,
        /* v1.246.0 - the label is the task's own stage now, not guessed from
           the latest update: Pending = blocked or waiting for the client */
        label: t.status === "completed" ? (t.stage === "cancelled" ? "cancelled" : "completed") : t.stage === "review" ? "review" : (t.stage === "blocked" || t.stage === "waiting_client") ? "pending" : t.status === "in_progress" || Number(t.progress) > 0 ? "in_progress" : "not_started",
        mine: t.assigned_to === user.id,
      };
    });
    const updates = await updatesFor(env, p.id, a, 50);
    const team = [...new Map(tasks.map((t) => [t.assigned_to, { id: t.assigned_to, name: t.assignee, photo_key: t.photo_key }])).values()];
    const live = tasks.filter((t) => t.stage !== "cancelled");
    const progress = live.length ? Math.round(live.reduce((s, t) => s + (t.status === "completed" ? 100 : Number(t.progress ?? 0)), 0) / live.length) : 0;
    const fileCount = (await env.DB.prepare(`SELECT COUNT(*) AS n FROM task_files WHERE project_id = ?1`).bind(p.id).first<{ n: number }>())?.n ?? 0;
    const revisedAfter = !!snap && Number(qt.revision ?? 0) !== Number(p.scope_revision ?? 0);
    return json({
      project: {
        id: p.id, title: p.title, description: p.description, status: p.status, start_date: p.start_date, due_date: p.due_date,
        deliverables: p.deliverables ? JSON.parse(p.deliverables) : [], notes: a.manage ? p.notes : null, version: p.version,
        created_at: p.created_at, updated_at: p.updated_at, activated_at: p.activated_at, activation_reason: a.manage ? p.activation_reason : null,
        completed_at: p.completed_at, cancelled_at: p.cancelled_at, cancel_reason: p.cancel_reason,
        completion_requested_at: p.completion_requested_at, completion_requested_by: await nameOf(env, p.completion_requested_by),
        owner: p.owner_id ? { id: p.owner_id, name: await nameOf(env, p.owner_id), set_at: p.owner_set_at, set_by: await nameOf(env, p.owner_set_by) } : null,
        progress,
      },
      quotation: {
        id: qt.id, doc_number: qt.doc_number, state: st, created_at: qt.created_at, valid_until: qt.valid_until, revision: Number(qt.revision ?? 0),
        issuer_code: qt.issuer_code, reference: qt.reference,
        salesperson: qt.salesperson_id ? { id: qt.salesperson_id, name: await nameOf(env, qt.salesperson_id) } : null,
      },
      client: cust ? { id: cust.id, company: cust.company, contact_person: cust.contact_person, ...(a.contact ? { phone: cust.phone, email: cust.email } : {}) } : null,
      package: pkg,
      scope: { frozen: !!snap, revision: snap ? snap.revision : Number(qt.revision ?? 0), revised_after_activation: revisedAfter, lines: scopeOf(lines, a.prices), totals },
      tasks, team, updates, file_count: Number(fileCount),
      suggested_owner: !p.owner_id && qt.salesperson_id ? { id: qt.salesperson_id, name: await nameOf(env, qt.salesperson_id) } : null,
      can: {
        edit: a.manage && OPEN.includes(p.status), add_task: a.manage && OPEN.includes(p.status), assign_owner: a.ownerAssign && OPEN.includes(p.status),
        update: (a.manage || a.assigned) && OPEN.includes(p.status), assist: !a.manage && !a.assigned && OPEN.includes(p.status),
        status: a.manage, complete: a.complete && ["in_progress", "waiting_client", "on_hold"].includes(p.status),
        prices: a.prices, contact: a.contact, files: a.manage || a.assigned, restricted_files: a.manage,
        is_owner: a.owner, is_assigned: a.assigned, manage: a.manage,
      },
      transitions: transitionsFor(p.status, a, st),
    });
  }

  /* ---------------- edit the brief (owner + management) ---------------- */
  if (sub === "" && method === "PATCH") {
    if (!a.manage) return err("forbidden", "Only the Project Owner or the CEO, COO or CCO edit the project", 403);
    if (!OPEN.includes(p.status)) return err("project_closed", `This project is ${p.status} - it no longer changes`, 409);
    if (typeof body?.version !== "number") return err("invalid_input", "version is required", 400);
    const forbidden = ["owner_id", "status", "quotation_id", "customer_id", "scope_snapshot", "price", "items", "total_cents", "unit_price_cents", "salesperson_id"].filter((k) => body && k in body);
    if (forbidden.length) return err("forbidden", `${forbidden.join(", ")} cannot be changed here`, 403);
    const sets: string[] = []; const vals: unknown[] = []; const changed: string[] = [];
    const put = (col: string, v: unknown) => { vals.push(v); sets.push(`${col} = ?${vals.length}`); changed.push(col); };
    if (body && "title" in body) { if (!str(body.title, 200)) return err("invalid_input", "A title of up to 200 characters is required", 400); put("title", String(body.title).trim()); }
    for (const f of ["description", "notes"] as const) if (body && f in body) put(f, typeof body[f] === "string" && String(body[f]).trim() ? String(body[f]).slice(0, 4000) : null);
    for (const f of ["start_date", "due_date"] as const) if (body && f in body) {
      if (body[f] === "" || body[f] === null) put(f, null);
      else if (validDay(body[f])) put(f, body[f]);
      else return err("invalid_input", `${f.replace("_", " ")} must be a real date`, 400);
    }
    if (body && "deliverables" in body) {
      if (!Array.isArray(body.deliverables)) return err("invalid_input", "deliverables must be a list", 400);
      put("deliverables", JSON.stringify((body.deliverables as unknown[]).filter((x) => str(x, 300)).slice(0, 40).map((x) => String(x).trim())));
    }
    const sd = changed.includes("start_date") ? vals[changed.indexOf("start_date")] : p.start_date;
    const dd = changed.includes("due_date") ? vals[changed.indexOf("due_date")] : p.due_date;
    if (sd && dd && String(dd) < String(sd)) return err("invalid_input", "The due date is before the start date", 400);
    if (!sets.length) return err("invalid_input", "Nothing to update", 400);
    vals.push(user.id); sets.push(`updated_by = ?${vals.length}`);
    sets.push(`updated_at = datetime('now')`, `version = version + 1`);
    vals.push(p.id, body!.version);
    const r = await env.DB.prepare(`UPDATE projects SET ${sets.join(", ")} WHERE id = ?${vals.length - 1} AND version = ?${vals.length}`).bind(...vals).run();
    if (!(r.meta?.changes ?? 0)) return err("stale", "Somebody else saved this project a moment ago - reload it and make your change again", 409);
    /* v1.247.1 - the dates are kept from and to, so the activity can say what moved */
    const dates: Record<string, [string | null, string | null]> = {};
    for (const f of ["start_date", "due_date"] as const) if (changed.includes(f)) dates[f] = [p[f] ?? null, (vals[changed.indexOf(f)] as string | null) ?? null];
    await audit(env, user.id, "project.edit", "projects", String(p.id), { fields: changed, ...(Object.keys(dates).length ? { dates } : {}) });
    return json({ ok: true, version: p.version + 1 });
  }

  /* ---------------- the Project Owner (P-2: CEO / COO) ---------------- */
  if (sub === "/owner" && method === "POST") {
    if (!a.ownerAssign) return err("forbidden", "Only the CEO or COO assign the Project Owner", 403);
    if (!OPEN.includes(p.status)) return err("project_closed", `This project is ${p.status}`, 409);
    const to = body?.owner_id === null ? null : typeof body?.owner_id === "number" ? body.owner_id : NaN;
    if (to !== null && !Number.isInteger(to)) return err("invalid_input", "owner_id is required", 400);
    if (to === p.owner_id) return json({ ok: true, unchanged: true });
    const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
    if (p.owner_id !== null && reason.length < 5) return err("invalid_input", "Say why the project changes hands (at least 5 characters)", 400);
    if (to !== null) {
      const ok = await env.DB.prepare(`SELECT 1 AS x FROM users WHERE id = ?1 AND is_active = 1 AND ${staffRolesSql()} AND ${currentStaffSql()}`).bind(to).first();
      if (!ok) return err("invalid_input", "The Project Owner must be a current staff member", 400);
    }
    const r = await env.DB.prepare(
      `UPDATE projects SET owner_id = ?1, owner_set_by = ?2, owner_set_at = datetime('now'), updated_by = ?2, updated_at = datetime('now'), version = version + 1
        WHERE id = ?3 AND owner_id IS ?4`,
    ).bind(to, user.id, p.id, p.owner_id).run();
    if (!(r.meta?.changes ?? 0)) return err("stale", "The owner was changed a moment ago - reload and try again", 409);
    await audit(env, user.id, "project.owner_set", "projects", String(p.id), { from: p.owner_id, to, ...(reason ? { reason } : {}) });
    await tell(env, [to], user.id, `📁 You are now the Project Owner of ${p.title}`, `proj:${p.id}:owner:${to}:${Date.now()}`);
    if (p.owner_id) await tell(env, [p.owner_id], user.id, `📁 ${p.title} has a new Project Owner${reason ? ` - ${reason}` : ""}`, `proj:${p.id}:owner_off:${p.owner_id}:${Date.now()}`);
    return json({ ok: true });
  }

  /* ---------------- the project's status ---------------- */
  if (sub === "/status" && method === "POST") {
    const to = typeof body?.to === "string" ? body.to as PStatus : null;
    if (!to || !(PROJECT_STATUSES as readonly string[]).includes(to)) return err("invalid_input", "to must be a project status", 400);
    const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
    const qt = await loadQt(env, p.quotation_id);
    if (!qt) return err("not_found", "The project's quotation was not found", 404);
    const st = await quotationState(env, qt);
    const t = transitionsFor(p.status, a, st).find((x) => x.to === to);
    if (!t) {
      if (to === "completed" && !a.complete) return err("forbidden", "Completed is confirmed by the CEO or COO - the owner requests it with a progress update", 403);
      if (!a.manage) return err("forbidden", "Only the Project Owner or the CEO, COO or CCO change the project status", 403);
      return err("invalid_transition", `A ${p.status.replace("_", " ")} project cannot move to ${to.replace("_", " ")}`, 409);
    }
    if (t.blocked) return err(t.code ?? "not_ready", t.blocked, 409);
    if (t.needs_reason && reason.length < 10) return err("invalid_input", "Give the reason (at least 10 characters)", 400);
    const sets = [`status = ?1`, `updated_by = ?2`, `updated_at = datetime('now')`, `version = version + 1`];
    const vals: unknown[] = [to, user.id];
    if (to === "in_progress" && !p.activated_at) {
      /* ACTIVATION freezes the agreed scope: the quotation's lines and
         package at this revision. A later package edit or a later revision
         does not change it. */
      vals.push(Number(qt.revision ?? 0)); sets.push(`scope_revision = ?${vals.length}`);
      vals.push(scopeSnapshot(qt));
      sets.push(`scope_snapshot = ?${vals.length}`);
      sets.push(`activated_at = datetime('now')`);
      vals.push(user.id); sets.push(`activated_by = ?${vals.length}`);
      vals.push(t.needs_reason ? reason : null); sets.push(`activation_reason = ?${vals.length}`);
    }
    if (to === "completed") { sets.push(`completed_at = datetime('now')`); vals.push(user.id); sets.push(`completed_by = ?${vals.length}`); }
    if (to === "cancelled") { sets.push(`cancelled_at = datetime('now')`); vals.push(user.id); sets.push(`cancelled_by = ?${vals.length}`); vals.push(reason); sets.push(`cancel_reason = ?${vals.length}`); }
    vals.push(p.id, p.status);
    const r = await env.DB.prepare(`UPDATE projects SET ${sets.join(", ")} WHERE id = ?${vals.length - 1} AND status = ?${vals.length}`).bind(...vals).run();
    if (!(r.meta?.changes ?? 0)) return err("stale", "The status was changed a moment ago - reload and try again", 409);
    await audit(env, user.id, `project.status`, "projects", String(p.id), { from: p.status, to, ...(reason ? { reason } : {}), ...(to === "in_progress" && !p.activated_at ? { activated: true, quotation: st.label } : {}) });
    const team = (await env.DB.prepare(`SELECT DISTINCT assigned_to AS id FROM tasks WHERE link_kind = 'project' AND link_id = ?1`).bind(p.id).all<{ id: number }>()).results.map((x) => x.id);
    if (to === "completed") await tell(env, [p.owner_id, ...team], user.id, `✅ Project completed: ${p.title}`, `proj:${p.id}:completed`);
    else if (to === "cancelled") await tell(env, [p.owner_id, ...team], user.id, `⛔ Project cancelled: ${p.title} - ${reason}`, `proj:${p.id}:cancelled`);
    else if (to === "in_progress" && !p.activated_at) await tell(env, [p.owner_id, ...team], user.id, `▶ Project started: ${p.title}`, `proj:${p.id}:started`);
    return json({ ok: true, status: to });
  }

  /* ---------------- append a progress update (append-only) ---------------- */
  if (sub === "/updates" && method === "GET") {
    return json({ updates: await updatesFor(env, p.id, a, 500) });
  }
  if (sub === "/updates" && method === "POST") {
    const key = (request.headers.get("Idempotency-Key") ?? (typeof body?.client_key === "string" ? body.client_key : "")).slice(0, 80) || null;
    if (!OPEN.includes(p.status)) return err("project_closed", `This project is ${p.status} - nothing more is added`, 409);
    /* v1.246.0 (T-1) - an update ABOUT A TASK is the task's own record: the
       same rules and the same row as POST /tasks/:id/updates */
    let taskOf: number | null = body?.task_id !== undefined && body.task_id !== null ? Number(body.task_id) : null;
    if (body?.kind === "correction" && body?.corrects_id) {
      const c = await env.DB.prepare(`SELECT task_id FROM task_updates WHERE id = ?1 AND project_id = ?2`).bind(Number(body.corrects_id), p.id).first<{ task_id: number | null }>();
      if (!c) return err("invalid_input", "A correction names the update it corrects", 400);
      if (c.task_id) taskOf = c.task_id;
    }
    if (taskOf !== null && body?.kind !== "assist_request") {
      const t = await loadTask(env, taskOf);
      if (!t || t.link_kind !== "project" || Number(t.link_id) !== p.id) return err("invalid_input", "That task is not on this project", 400);
      const ta = await taskAccess(env, user, t); // appendTaskUpdate refuses anybody not on the task
      const b = { ...(body ?? {}), kind: body?.kind === "done_request" ? "review_request" : body?.kind === "comment" ? "progress" : body?.kind, ...(typeof body?.task_progress === "number" ? { progress: body.task_progress } : {}) };
      if (body?.task_status === "completed" && !ta.selfSet) (b as Record<string, unknown>).kind = "review_request";
      return appendTaskUpdate(env, user, t, ta, b as Record<string, unknown>, key);
    }
    const asked = body?.kind === "comment" ? "note" : body?.kind;
    const kind = typeof asked === "string" && (PROJECT_KINDS as readonly string[]).includes(asked) ? asked as typeof PROJECT_KINDS[number] : "progress";
    if (kind === "assist_request") {
      if (a.manage || a.assigned) return err("invalid_input", "You are already on this project", 400);
    } else if (!a.manage && !a.assigned) {
      return err("forbidden", "Only the Project Owner, the assigned team or the CEO, COO or CCO post progress on this project - ask to help instead", 403);
    }
    const text = typeof body?.body === "string" ? body.body.trim() : "";
    if (!text || text.length > 500) return err("invalid_input", "Write the update (up to 500 characters)", 400);
    const extra = (k: string) => typeof body?.[k] === "string" && String(body[k]).trim() ? String(body[k]).trim().slice(0, 1000) : null;
    if (kind === "correction") {
      const c = await env.DB.prepare(`SELECT id, author_id FROM task_updates WHERE id = ?1 AND project_id = ?2`).bind(Number(body?.corrects_id), p.id).first<{ id: number; author_id: number }>();
      if (!c) return err("invalid_input", "A correction names the update it corrects", 400);
      if (c.author_id !== user.id && !a.manage) return err("forbidden", "You correct your own updates; the owner or management correct others", 403);
    }
    const row = await appendProjectNote(env, user, p, kind === "correction" ? "note" : kind, text, { completed_work: extra("completed_work"), blockers: extra("blockers"), next_action: extra("next_action") }, key);
    if (row.existing) return json({ id: row.id, existing: true });
    if (kind === "done_request" && a.manage && !p.completion_requested_at) {
      await env.DB.prepare(`UPDATE projects SET completion_requested_at = datetime('now'), completion_requested_by = ?1 WHERE id = ?2 AND completion_requested_at IS NULL`).bind(user.id, p.id).run();
    }
    const who = user.name;
    if (kind === "done_request") await tell(env, [p.owner_id, ...(await managersOf(env, "project_complete"))], user.id, `🏁 ${who} says the project is done: ${p.title}`, `proj:${p.id}:u:${row.id}`);
    else if (kind === "assist_request") await tell(env, [p.owner_id, ...(p.owner_id ? [] : await managersOf(env, "project_manage"))], user.id, `🙋 ${who} asks to help on ${p.title}: ${text.slice(0, 120)}`, `proj:${p.id}:u:${row.id}`);
    else await tell(env, [p.owner_id], user.id, `📝 ${who} updated ${p.title}: ${text.slice(0, 120)}`, `proj:${p.id}:u:${row.id}`);
    return json({ id: row.id, existing: false }, 201);
  }

  /* ---------------- files (private, project-scoped) ---------------- */
  if (sub === "/files" && method === "POST") {
    if (!OPEN.includes(p.status)) return err("project_closed", `This project is ${p.status}`, 409);
    const level = request.headers.get("X-File-Level") === "restricted" ? "restricted" : "team";
    const tHdr = request.headers.get("X-Task-Id");
    /* v1.246.0 - a file on a task is the task's own (private/tasks/...);
       a project-level file has no task. One table, task_files. */
    if (tHdr) {
      const t = await loadTask(env, Number(tHdr));
      if (!t || t.link_kind !== "project" || Number(t.link_id) !== p.id) return err("invalid_input", "That task is not on this project", 400);
      const ta = await taskAccess(env, user, t);
      if (!ta.update) return err("forbidden", "That task is somebody else's", 403);
      if (level === "restricted" && !ta.manage) return err("forbidden", "Only the owner or management add restricted files", 403);
      const res = await storeTaskFile(env, user, request, { taskId: t.id, projectId: p.id, updateId: null, commentId: null }, level);
      if (res.status === 201) await tell(env, [p.owner_id], user.id, `📎 ${user.name} attached a file to ${p.title}`, `proj:${p.id}:f:${Date.now()}`);
      return res;
    }
    if (!a.manage && !a.assigned) return err("forbidden", "Only the Project Owner, the assigned team or management add files", 403);
    if (level === "restricted" && !a.manage) return err("forbidden", "Only the owner or management add restricted files", 403);
    const res = await storeTaskFile(env, user, request, { taskId: null, projectId: p.id, updateId: null, commentId: null }, level);
    if (res.status === 201) await tell(env, [p.owner_id], user.id, `📎 ${user.name} attached a file to ${p.title}`, `proj:${p.id}:f:${Date.now()}`);
    return res;
  }
  if (sub === "/files" && method === "GET" && !m[3]) {
    const rows = (await env.DB.prepare(
      `SELECT f.id, f.task_id, t.title AS task_title, f.file_name, f.content_type, f.size_bytes, f.level, f.created_at, f.uploader_id, ${PERSON("u")} AS uploader
         FROM task_files f JOIN users u ON u.id = f.uploader_id LEFT JOIN tasks t ON t.id = f.task_id
        WHERE f.project_id = ?1 AND f.comment_id IS NULL ORDER BY f.id DESC`,
    ).bind(p.id).all<{ id: number; level: string }>()).results;
    return json({ files: rows.map((f) => ({ ...f, open: f.level !== "restricted" || a.manage })) });
  }
  if (sub === "/files" && method === "GET" && m[3]) {
    const f = await env.DB.prepare(
      `SELECT f.file_name, f.level, f.comment_id, md.r2_key FROM task_files f JOIN media md ON md.id = f.media_id WHERE f.project_id = ?1 AND f.id = ?2`,
    ).bind(p.id, Number(m[3])).first<{ file_name: string; level: string; comment_id: number | null; r2_key: string }>();
    if (!f || f.comment_id !== null) return err("not_found", "File not found on this project", 404);
    if (f.level === "restricted" && !a.manage) return err("forbidden", "This file is restricted to the owner and management", 403);
    return streamTaskFile(env, f);
  }

  /* ---------------- the activity timeline (read-only) ---------------- */
  if (sub === "/activity" && method === "GET") {
    return json({ activity: await activityFor(env, p, a) });
  }

  return null;
}

async function nameOf(env: Env, id: number | null | undefined): Promise<string | null> {
  if (!id) return null;
  const r = await env.DB.prepare(`SELECT ${PERSON("u")} AS n FROM users u WHERE u.id = ?1`).bind(id).first<{ n: string }>().catch(() => null);
  return r?.n ?? null;
}

async function updatesFor(env: Env, projectId: number, a: Access, limit: number) {
  /* v1.246.0 - the project's feed is its tasks' own updates plus the
     project-level notes: one table (task_updates), read, never copied */
  const rows = (await env.DB.prepare(
    `SELECT x.id, x.task_id, t.title AS task_title, x.author_id, ${PERSON("u")} AS author, u.photo_key, x.kind, x.body, x.completed_work, x.blockers, x.next_action,
            x.status_to, x.stage_to, x.progress_snapshot, x.corrects_id, x.created_at
       FROM task_updates x JOIN users u ON u.id = x.author_id LEFT JOIN tasks t ON t.id = x.task_id
      WHERE x.project_id = ?1 ORDER BY x.id DESC LIMIT ?2`,
  ).bind(projectId, limit).all<Record<string, unknown>>()).results;
  const files = (await env.DB.prepare(
    `SELECT id, update_id, file_name, level FROM task_files WHERE project_id = ?1 AND update_id IS NOT NULL`,
  ).bind(projectId).all<{ id: number; update_id: number; file_name: string; level: string }>()).results;
  /* a restricted file is named to everybody (the record stays whole) but only
     the owner and management can open it */
  return rows.map((r): Record<string, unknown> => ({ ...r, files: files.filter((f) => f.update_id === r.id).map((f) => ({ ...f, open: f.level !== "restricted" || a.manage })) }));
}

type Transition = { to: PStatus; label: string; needs_reason?: boolean; blocked?: string; code?: string };
/** The lifecycle (§5 of the plan), for this person and this quotation. */
export function transitionsFor(from: PStatus, a: Access, st: { accepted: boolean; invoiced: boolean; expired: boolean }): Transition[] {
  const out: Transition[] = [];
  if (!a.manage && !a.complete) return out;
  const m = a.manage;
  if (from === "draft" && m) out.push({ to: "ready", label: "Ready - awaiting acceptance" });
  if ((from === "draft" || from === "ready") && m) {
    if (st.accepted || st.invoiced) out.push({ to: "in_progress", label: "Start the project" });
    else if (st.expired) out.push({ to: "in_progress", label: "Start the project", blocked: "The quotation has expired and was neither accepted nor invoiced - revise it first", code: "quotation_expired" });
    else if (a.mgmt) out.push({ to: "in_progress", label: "Start without acceptance on the link", needs_reason: true });
    else out.push({ to: "in_progress", label: "Start the project", blocked: "The customer has not accepted the quotation yet - management can start it with a reason", code: "not_accepted" });
  }
  if (from === "in_progress" && m) out.push({ to: "waiting_client", label: "Waiting for client" }, { to: "on_hold", label: "On hold", needs_reason: true });
  if ((from === "waiting_client" || from === "on_hold") && m) out.push({ to: "in_progress", label: "Back in progress" });
  if (from === "waiting_client" && m) out.push({ to: "on_hold", label: "On hold", needs_reason: true });
  if (["in_progress", "waiting_client", "on_hold"].includes(from) && a.complete) out.push({ to: "completed", label: "Confirm completed" });
  if (OPEN.includes(from) && m) out.push({ to: "cancelled", label: "Cancel the project", needs_reason: true });
  return out;
}

async function activityFor(env: Env, p: ProjectRow, a: Access) {
  type Ev = { key: string; at: string; kind: string; text: string; by: string | null; by_id: number | null; photo_key?: string | null; quote?: string | null };
  const out = new Map<string, Ev>();
  const add = (e: Ev) => { if (!out.has(e.key)) out.set(e.key, e); };
  const auditRows = (await env.DB.prepare(
    `SELECT a.id, a.action, a.detail, a.created_at, a.user_id, ${PERSON("u")} AS who, u.photo_key FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
      WHERE a.entity = 'projects' AND a.entity_id = ?1 ORDER BY a.id`,
  ).bind(String(p.id)).all<{ id: number; action: string; detail: string | null; created_at: string; user_id: number | null; who: string | null; photo_key: string | null }>()).results;
  for (const r of auditRows) {
    let d: Record<string, unknown> = {};
    try { d = JSON.parse(r.detail ?? "{}"); } catch { /* keep {} */ }
    const text = r.action === "project.create" ? `Created the project brief from ${String(d.doc_number ?? "the quotation")}`
      : r.action === "project.edit" ? editText(d)
      : r.action === "project.owner_set" ? (d.to ? `Set the Project Owner to ${await nameOf(env, Number(d.to))}` : "Cleared the Project Owner")
      : r.action === "project.status" ? `Status ${String(d.from ?? "").replace("_", " ")} → ${String(d.to ?? "").replace("_", " ")}${d.activated ? ` (quotation ${String(d.quotation)})` : ""}`
      : r.action;
    add({ key: `a${r.id}`, at: r.created_at, kind: r.action, text, by: r.who, by_id: r.user_id, photo_key: r.photo_key, quote: a.manage || r.action !== "project.status" ? (d.reason as string | undefined) ?? null : (d.reason as string | undefined) ?? null });
  }
  const tasks = (await env.DB.prepare(
    `SELECT t.id, t.title, t.created_at, t.created_by, ${PERSON("c")} AS creator, c.photo_key, ${PERSON("u")} AS assignee FROM tasks t JOIN users u ON u.id = t.assigned_to LEFT JOIN users c ON c.id = t.created_by
      WHERE t.link_kind = 'project' AND t.link_id = ?1`,
  ).bind(p.id).all<{ id: number; title: string; created_at: string; created_by: number | null; creator: string | null; photo_key: string | null; assignee: string }>()).results;
  for (const t of tasks) add({ key: `t${t.id}`, at: t.created_at, kind: "task.create", text: `Added task "${t.title}" for ${t.assignee}`, by: t.creator, by_id: t.created_by, photo_key: t.photo_key });
  if (tasks.length) {
    const ids = tasks.map((t) => t.id);
    const ph = ids.map((_, i) => `?${i + 1}`).join(",");
    const titles = new Map(tasks.map((t) => [t.id, t.title]));
    for (const e of (await env.DB.prepare(
      `SELECT e.id, e.task_id, e.kind, e.created_at, e.user_id, ${PERSON("u")} AS who, u.photo_key FROM task_events e LEFT JOIN users u ON u.id = e.user_id WHERE e.task_id IN (${ph}) AND e.kind LIKE 'status:%'`,
    ).bind(...ids).all<{ id: number; task_id: number; kind: string; created_at: string; user_id: number | null; who: string | null; photo_key: string | null }>()).results)
      add({ key: `e${e.id}`, at: e.created_at, kind: "task.status", text: `"${titles.get(e.task_id)}" → ${e.kind.slice(7).replace("_", " ")}`, by: e.who, by_id: e.user_id, photo_key: e.photo_key });
    for (const r of (await env.DB.prepare(
      `SELECT a.id, a.entity_id, a.detail, a.created_at, a.user_id, ${PERSON("u")} AS who, u.photo_key FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
        WHERE a.entity = 'tasks' AND a.action = 'task.update' AND a.entity_id IN (${ph}) AND a.detail LIKE '%reassigned_to%'`,
    ).bind(...ids.map(String)).all<{ id: number; entity_id: string; detail: string; created_at: string; user_id: number | null; who: string | null; photo_key: string | null }>()).results) {
      let d: { reassigned_to?: number } = {};
      try { d = JSON.parse(r.detail); } catch { /* keep */ }
      add({ key: `r${r.id}`, at: r.created_at, kind: "task.reassign", text: `Reassigned "${titles.get(Number(r.entity_id))}" to ${await nameOf(env, d.reassigned_to)}`, by: r.who, by_id: r.user_id, photo_key: r.photo_key });
    }
  }
  for (const f of (await env.DB.prepare(
    `SELECT f.id, f.file_name, f.level, f.created_at, f.uploader_id, ${PERSON("u")} AS who, u.photo_key, t.title AS task_title FROM task_files f JOIN users u ON u.id = f.uploader_id LEFT JOIN tasks t ON t.id = f.task_id
      WHERE f.project_id = ?1 AND f.comment_id IS NULL`,
  ).bind(p.id).all<{ id: number; file_name: string; level: string; created_at: string; uploader_id: number; who: string; photo_key: string | null; task_title: string | null }>()).results)
    add({ key: `f${f.id}`, at: f.created_at, kind: "file", text: `File${f.task_title ? ` on "${f.task_title}"` : ""}`, by: f.who, by_id: f.uploader_id, photo_key: f.photo_key, quote: `Attached ${f.file_name}${f.level === "restricted" ? " (restricted)" : ""}` });
  for (const u of await updatesFor(env, p.id, a, 500)) {
    const kindText: Record<string, string> = { progress: "Progress", blocker: "Blocker", waiting_client: "Waiting for client", done_request: "Says the project is done", note: "Note", correction: "Correction", assist_request: "Asked to help", review_request: "Ready for review", review_approved: "Approved", review_returned: "Returned for more work", cancel: "Cancelled" };
    const st = u.progress_snapshot !== null && u.progress_snapshot !== undefined && u.kind === "progress" ? ` - ${String(u.progress_snapshot)}%` : "";
    add({ key: `u${u.id}`, at: String(u.created_at), kind: `update.${u.kind}`, text: `${kindText[String(u.kind)] ?? "Update"}${u.task_title ? ` on "${u.task_title}"` : ""}${st}`, by: String(u.author), by_id: Number(u.author_id), photo_key: u.photo_key as string | null, quote: String(u.body) });
  }
  return [...out.values()].sort((x, y) => y.at.localeCompare(x.at) || y.key.localeCompare(x.key));
}
