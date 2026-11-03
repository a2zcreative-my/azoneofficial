/**
 * TASK PROGRESS - v1.246.0.
 *
 * The owner's brief "A2Z OS - Task Assignment, Progress Reporting, Comments &
 * Quotation Project Integration", approved 01-11-2026 with decisions T-1 to
 * T-9 (claude/TASK-PROGRESS-AUDIT.md):
 *   T-1 one append-only progress record for EVERY task (task_updates) - a
 *       project task's rows also name the project, so the Project Workspace
 *       reads the same rows; there is no second store;
 *   T-2 a task set by somebody else is completed by its reviewer (whoever set
 *       it, the Project Owner or management) - the assignee asks for review;
 *       a self-set task closes as before;
 *   T-3 the assignee still edits title, priority and deadline - staff.ts
 *       records old and new values and tells the assigner;
 *   T-4 a PROJECT task is managed by project_manage (CEO, COO, CCO) and that
 *       project's Owner - not by team_manage alone (HR admin, Admin);
 *   T-5 assistants tick the checklist; T-6 other staff read a project task
 *       and ask to assist, they do not comment; T-7 Cancelled is completed
 *       plus stage cancelled, with a reason.
 *
 * ONE PLACE decides who may do what on a task: taskAccess(). Nothing comes
 * from the request body - not the author, not the project, not a role.
 *
 * WHAT IS NOT HERE, ON PURPOSE: no task table, no comment store (the
 * existing task_comments, staff.ts), no notification or audit engine, no
 * write to sales, commission, payroll or customer tables - tests/go-live-t.mjs
 * fails if one appears.
 */
import type { Env } from "./index";
import type { StaffUser } from "./staff";
import { notify, currentStaffSql, staffRolesSql } from "./staff";
import { queueTaskMailTo, taskForMail } from "./task-mail"; // v1.247.0 - the email leg
import { can } from "./permissions";
import { audit, err, json, putGuarded } from "./shared";
import { projectAccess, type ProjectRow, type Access as ProjectAccess } from "./projects";

export interface TaskRow {
  id: number; title: string; description: string | null; assigned_to: number; created_by: number | null; priority: string;
  deadline: string | null; status: "open" | "in_progress" | "completed"; progress: number; created_at: string;
  link_kind: string | null; link_id: number | null; stage: string | null; progress_source: string | null;
}
export interface TaskAccess {
  view: boolean;       // may read the task, its checklist, its updates and files
  team: boolean;       // on the task: comments are theirs to read and write
  assignee: boolean;   // the primary responsible person
  assistant: boolean;
  creator: boolean;
  selfSet: boolean;    // set by the person doing it - closes without review
  manage: boolean;     // edit, assign, add assistants, cancel
  review: boolean;     // approve or return a completion
  update: boolean;     // post a formal progress update, tick, upload evidence
  open: boolean;       // the task (and its project) still take changes
  project: ProjectRow | null;
  pa: ProjectAccess | null;
}

const OPEN_PROJECT = ["draft", "ready", "in_progress", "waiting_client", "on_hold"];
const PERSON = (a: string) => `COALESCE(NULLIF(TRIM(${a}.full_name), ''), ${a}.name)`;
const missing = (e: unknown) => /no such table|no such column/i.test(String(e));
const MIGRATION = () => err("migration_missing", "Run migration 0159 first (PUSH.bat)", 503);
const today = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
export const FILE_TYPES: Record<string, { max: number; kind: "image" | "document" }> = {
  "application/pdf": { max: 20 * 1048576, kind: "document" },
  "image/jpeg": { max: 8 * 1048576, kind: "image" },
  "image/png": { max: 8 * 1048576, kind: "image" },
  "image/webp": { max: 8 * 1048576, kind: "image" },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": { max: 20 * 1048576, kind: "document" },
  "application/msword": { max: 20 * 1048576, kind: "document" },
};
/** The kinds an update on a TASK may be posted as (review_* and cancel are written by /review). */
const TASK_KINDS = ["progress", "blocker", "waiting_client", "review_request", "correction", "assist_request"] as const;
/** The kinds that count as the task's LATEST UPDATE - never a comment, never a file. */
export const LATEST_KINDS = ["progress", "blocker", "waiting_client", "review_request", "review_approved", "review_returned", "correction", "cancel", "closed", "closed_with_exception", "reopened"];
/** v1.257.0 (0170) - an update's own text may be edited or the update withdrawn by its
    author or the task's management, while the task is open; a decision (approve, return,
    close, cancel, reopen) is never edited or withdrawn - it is undone by the next decision */
export const EDITABLE_KINDS = ["progress", "blocker", "waiting_client", "review_request", "correction", "assist_request"];
/** rows that change another row, never shown as entries of their own */
const META_KINDS = ["edit", "withdrawn"];
/** v1.256.0 - the rows that close a task (the latest one after the latest reopening is THE closure) */
export const CLOSING_KINDS = ["review_approved", "closed", "closed_with_exception", "cancel"];

export async function loadTask(env: Env, id: number | string): Promise<TaskRow | null> {
  return env.DB.prepare(`SELECT * FROM tasks WHERE id = ?1`).bind(Number(id)).first<TaskRow>();
}

/** Who may do what on THIS task - the one place it is decided. */
export async function taskAccess(env: Env, user: StaffUser, t: TaskRow): Promise<TaskAccess> {
  const assignee = t.assigned_to === user.id;
  const creator = t.created_by !== null && t.created_by === user.id;
  const selfSet = t.created_by === null || t.created_by === t.assigned_to;
  let assistant = false;
  try {
    assistant = !!(await env.DB.prepare(`SELECT 1 AS x FROM task_assistants WHERE task_id = ?1 AND user_id = ?2 AND removed_at IS NULL`).bind(t.id, user.id).first());
  } catch (e) { if (!missing(e)) throw e; }
  let project: ProjectRow | null = null;
  let pa: ProjectAccess | null = null;
  if (t.link_kind === "project" && t.link_id) {
    project = await env.DB.prepare(`SELECT * FROM projects WHERE id = ?1`).bind(t.link_id).first<ProjectRow>().catch(() => null);
    if (project) pa = await projectAccess(env, user, project);
  }
  /* T-4: a project task is managed by the project's Owner and project_manage;
     a standalone task by team_manage, as it always was */
  const manage = project ? !!pa?.manage : can(user.role, "team_manage");
  const view = assignee || assistant || creator || manage || (project ? !!pa?.view : false);
  const team = assignee || assistant || creator || manage;
  /* T-2: the reviewer - whoever set it, or those who manage it; never the
     person doing the work (a self-set task is closed by its owner) */
  const review = selfSet ? (assignee || manage) : ((creator || manage) && !assignee);
  const open = t.status !== "completed" && (!project || OPEN_PROJECT.includes(project.status));
  return { view, team, assignee, assistant, creator, selfSet, manage, review, update: assignee || assistant || manage || creator, open, project, pa };
}

async function checklistCount(env: Env, taskId: number): Promise<{ n: number; d: number }> {
  const r = await env.DB.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(done), 0) AS d FROM task_items WHERE task_id = ?1`).bind(taskId).first<{ n: number; d: number }>().catch(() => null);
  return { n: Number(r?.n ?? 0), d: Number(r?.d ?? 0) };
}
async function nameOf(env: Env, id: number | null | undefined): Promise<string | null> {
  if (!id) return null;
  const r = await env.DB.prepare(`SELECT ${PERSON("u")} AS n FROM users u WHERE u.id = ?1`).bind(id).first<{ n: string }>().catch(() => null);
  return r?.n ?? null;
}
async function tell(env: Env, ids: (number | null | undefined)[], except: number, msg: string, ref: string) {
  for (const id of [...new Set(ids.filter((x): x is number => typeof x === "number" && x !== except))]) {
    try { await notify(env, id, "task", msg, `${ref}:${id}`, { once: true }); } catch { /* a bell never blocks the work */ }
  }
}
async function assistantsOf(env: Env, taskId: number): Promise<{ id: number; name: string; photo_key: string | null; added_at: string }[]> {
  try {
    return (await env.DB.prepare(
      `SELECT a.user_id AS id, ${PERSON("u")} AS name, u.photo_key, a.added_at FROM task_assistants a JOIN users u ON u.id = a.user_id
        WHERE a.task_id = ?1 AND a.removed_at IS NULL ORDER BY a.id`,
    ).bind(taskId).all<{ id: number; name: string; photo_key: string | null; added_at: string }>()).results;
  } catch (e) { if (missing(e)) return []; throw e; }
}
/** Who reviews a completion of this task: the person who set it, else the
    Project Owner, else (no owner yet) the CEO/COO/CCO. Never the assignee. */
async function reviewersOf(env: Env, t: TaskRow, project: ProjectRow | null): Promise<number[]> {
  const out: number[] = [];
  if (t.created_by && t.created_by !== t.assigned_to) out.push(t.created_by);
  if (project?.owner_id && project.owner_id !== t.assigned_to) out.push(project.owner_id);
  if (!out.length && project) {
    const roles = ["ceo", "coo", "cco"].filter((r) => can(r as StaffUser["role"], "project_manage"));
    out.push(...(await env.DB.prepare(`SELECT id FROM users WHERE is_active = 1 AND role IN (${roles.map((_, i) => `?${i + 1}`).join(",")}) AND ${currentStaffSql()}`)
      .bind(...roles).all<{ id: number }>()).results.map((r) => r.id));
  }
  return out;
}
async function event(env: Env, taskId: number, kind: string, userId: number) {
  try { await env.DB.prepare(`INSERT INTO task_events (task_id, kind, user_id, on_date) VALUES (?1, ?2, ?3, ?4)`).bind(taskId, kind, userId, today()).run(); }
  catch { /* pre-0083 */ }
}

/**
 * Append one update - the one INSERT into task_updates for a task, used by
 * POST /tasks/:id/updates and by the project routes alike. The server stamps
 * the author, the project, the time and the snapshot.
 */
export async function appendTaskUpdate(
  env: Env, user: StaffUser, t: TaskRow, a: TaskAccess, body: Record<string, unknown> | null, key: string | null,
): Promise<Response> {
  const kind = typeof body?.kind === "string" && (TASK_KINDS as readonly string[]).includes(body.kind) ? body.kind as typeof TASK_KINDS[number] : "progress";
  if (!a.open) return err("task_closed", t.status === "completed" ? "This task is closed - nothing more is added to it" : "This task's project is closed - nothing more is added", 409);
  if (kind === "assist_request") {
    if (!a.project) return err("invalid_input", "Offering help is for project tasks - ask the person who set this task", 400);
    if (a.team || a.update) return err("invalid_input", "You are already on this task", 400);
    if (!a.view) return err("forbidden", "That task is not yours to see", 403);
  } else if (!a.update) {
    return err("forbidden", a.view ? "Only the people on this task post progress on it - offer to help instead" : "That task is not yours", 403);
  }
  if (kind === "review_request" && !a.assignee) return err("forbidden", "The person responsible for the task submits it for review", 403);
  if (kind === "review_request" && a.selfSet) return err("invalid_input", "You set this task yourself - close it when it is done", 400);
  const text = typeof body?.body === "string" ? body.body.trim() : "";
  if (!text || text.length > 500) return err("invalid_input", "Write the update (up to 500 characters)", 400);
  const extra = (k: string) => typeof body?.[k] === "string" && String(body[k]).trim() ? String(body[k]).trim().slice(0, 1000) : null;
  if (kind === "blocker" && !extra("blockers") && !text) return err("invalid_input", "Say what is blocking the task", 400);
  const forbidden = ["author_id", "project_id", "assigned_to", "owner_id", "customer_id", "quotation_id", "price", "unit_price_cents", "total_cents", "items", "salesperson_id"].filter((k) => body && k in body && body[k] !== undefined && body[k] !== null);
  /* author_id is ignored silently in the 1.245.0 guard's sense: the server
     takes the signed-in person; anything that would change master data is refused */
  const refuse = forbidden.filter((k) => k !== "author_id");
  if (refuse.length) return err("forbidden", `${refuse.join(", ")} cannot be changed from a progress update`, 403);

  if (key) {
    const again = await env.DB.prepare(`SELECT id FROM task_updates WHERE author_id = ?1 AND client_key = ?2`).bind(user.id, key).first<{ id: number }>();
    if (again) return json({ id: again.id, existing: true });
  }
  let corrects: number | null = null;
  if (kind === "correction") {
    const c = await env.DB.prepare(`SELECT id, author_id FROM task_updates WHERE id = ?1 AND task_id = ?2`).bind(Number(body?.corrects_id), t.id).first<{ id: number; author_id: number }>();
    if (!c) return err("invalid_input", "A correction names the update it corrects", 400);
    if (c.author_id !== user.id && !a.manage) return err("forbidden", "You correct your own updates; the owner or management correct others", 403);
    corrects = c.id;
  }
  /* progress: from the checklist when it has lines (read-only here); a
     number only for a task without one, and only inside an update */
  const cl = await checklistCount(env, t.id);
  let progress = Number(t.progress ?? 0);
  let source: "checklist" | "manual" = cl.n > 0 ? "checklist" : "manual";
  if (typeof body?.progress === "number" && kind !== "assist_request" && kind !== "correction") {
    if (cl.n > 0) {
      const derived = Math.round((cl.d / cl.n) * 100);
      if (Math.round(body.progress) !== derived) return err("progress_from_checklist", `This task's progress comes from its checklist (${cl.d}/${cl.n} = ${derived}%) - tick the items instead`, 409);
    } else {
      if (!(body.progress >= 0 && body.progress <= 100)) return err("invalid_input", "progress is 0 to 100", 400);
      progress = Math.round(body.progress);
    }
  }
  if (cl.n > 0) { progress = Math.round((cl.d / cl.n) * 100); source = "checklist"; }
  /* v1.257.0 - the REPORTED percentage, kept on the update beside the official
     one: on a checklist task it never moves the checklist figure */
  let reported: number | null = null;
  if (body?.reported_progress !== undefined && body.reported_progress !== null && kind !== "assist_request" && kind !== "correction") {
    const rp = Number(body.reported_progress);
    if (!(Number.isInteger(rp) && rp >= 0 && rp <= 100)) return err("invalid_input", "The reported progress is a whole percentage, 0 to 100", 400);
    reported = rp;
  }
  if (reported === null && cl.n === 0 && typeof body?.progress === "number" && kind !== "assist_request" && kind !== "correction") reported = Math.round(body.progress);
  /* the state this update leaves the task in */
  let status = t.status;
  let stage = t.stage;
  if (kind === "progress") { if (status === "open") status = "in_progress"; if (stage === "blocked" || stage === "waiting_client") stage = null; }
  if (kind === "blocker") { status = "in_progress"; stage = "blocked"; }
  if (kind === "waiting_client") { status = "in_progress"; stage = "waiting_client"; }
  if (kind === "review_request") { status = "in_progress"; stage = "review"; }
  const moves = kind !== "assist_request" && kind !== "correction";
  if (moves) {
    await env.DB.prepare(`UPDATE tasks SET status = ?1, stage = ?2, progress = ?3, progress_source = ?4 WHERE id = ?5 AND status != 'completed'`)
      .bind(status, stage, progress, source, t.id).run();
    if (status !== t.status) await event(env, t.id, `status:${status}`, user.id);
    if (stage !== t.stage) await event(env, t.id, `stage:${stage ?? "none"}`, user.id);
  }
  const row = await env.DB.prepare(
    `INSERT INTO task_updates (task_id, project_id, author_id, kind, body, completed_work, blockers, next_action, status_to, stage_to, progress_snapshot, progress_source, corrects_id, client_key${reported !== null ? ", reported_progress" : ""})
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14${reported !== null ? ", ?15" : ""})
     ON CONFLICT(author_id, client_key) WHERE client_key IS NOT NULL DO NOTHING RETURNING id`,
  ).bind(t.id, a.project?.id ?? null, user.id, kind, text, extra("completed_work"), extra("blockers"), extra("next_action"),
    moves ? status : null, moves ? stage : null, moves ? progress : null, moves ? source : null, corrects, key, ...(reported !== null ? [reported] : [])).first<{ id: number }>();
  if (!row) {
    const again = await env.DB.prepare(`SELECT id FROM task_updates WHERE author_id = ?1 AND client_key = ?2`).bind(user.id, key).first<{ id: number }>();
    return json({ id: again?.id, existing: true });
  }
  const who = user.name;
  const owner = a.project?.owner_id ?? null;
  const ref = `task:${t.id}:u:${row.id}`;
  if (kind === "review_request") {
    await tell(env, await reviewersOf(env, t, a.project), user.id, `🔎 Ready for review: ${t.title} (${who})`, ref);
  } else if (kind === "blocker") {
    await tell(env, [t.created_by, owner, t.assigned_to], user.id, `⚠ Blocked: ${t.title} - ${text.slice(0, 120)} (${who})`, ref);
  } else if (kind === "assist_request") {
    await tell(env, [owner, t.created_by, t.assigned_to], user.id, `🙋 ${who} offers to help on ${t.title}: ${text.slice(0, 120)}`, ref);
  } else {
    await tell(env, [t.created_by, owner, ...(a.assignee ? [] : [t.assigned_to])], user.id, `📝 ${who} updated ${t.title}: ${text.slice(0, 120)}`, ref);
  }
  /* v1.247.0 - by email: a review request to the reviewers (each at once); an
     important update (progress, blocker, waiting, correction) to the Owner
     and the assigner, AT MOST ONE AN HOUR PER TASK - the ref carries the
     hour, so a burst of updates lands as one email with the latest in it.
     An offer to help is not an email. */
  const tm = await taskForMail(env, t.id);
  if (tm) {
    const upd = { task: { ...tm, status, stage, progress }, by: who, summary: text, next: typeof body?.next_action === "string" ? body.next_action.slice(0, 200) : null };
    if (kind === "review_request") {
      await queueTaskMailTo(env, "review", await reviewersOf(env, t, a.project), user.id, `task:${t.id}:review:${row.id}`, upd);
    } else if (kind !== "assist_request") {
      const hour = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 13);
      await queueTaskMailTo(env, "update", [t.created_by, owner, ...(a.assignee ? [] : [t.assigned_to])], user.id, `task:${t.id}:update:${hour}`, upd);
    }
  }
  return json({ id: row.id, existing: false, status, stage, progress, progress_source: source }, 201);
}

/* =====================================================================
 * v1.256.0 - ONE TRANSITION (the owner's "Task Progress Timeline 2.1,
 * Status Updates, Closure & Reopen Workflow", claude/TASK-CLOSURE-AUDIT.md,
 * his "approved", 03-11-2026: D1 a manager may close with outstanding
 * deliverables, with a reason, recorded as an exception; D2 whoever may
 * close a task reopens it, a cancelled one only a manager; D3 0169 adds the
 * closed / closed_with_exception / reopened kinds; D4 the card and footer
 * dropdowns are gone - every screen calls this).
 *
 * Closed is the existing `completed` state (Cancelled = completed +
 * stage cancelled); no second status, no second state machine. Each
 * decision is ONE batch: the progress row is written only if the task is
 * still in the state that was read, and the task moves only if that row
 * was written - so two presses, a retry or two people at once make one
 * decision, one row, one notice. A percentage never closes a task.
 * ===================================================================== */
export type TaskDecision = "close" | "return" | "cancel" | "reopen";
const OPEN_OF = (p: ProjectRow | null) => !p || OPEN_PROJECT.includes(p.status);
/** what this person may decide on this task now (the screens show exactly these) */
export function decisionsOf(t: TaskRow, a: TaskAccess) {
  const projectOpen = OPEN_OF(a.project);
  return {
    close: a.open && a.review,                                   // self-set: the assignee or a manager; else the reviewer (never the assignee)
    close_exception: a.open && a.manage,                         // D1
    return: a.open && a.review && !a.selfSet && t.stage === "review",
    cancel: a.open && (a.manage || (a.creator && !a.assignee)),
    reopen: t.status === "completed" && projectOpen && (t.stage === "cancelled" ? a.manage : a.review), // D2
  };
}
async function outstandingOf(env: Env, taskId: number): Promise<{ id: number; title: string }[]> {
  return (await env.DB.prepare(`SELECT id, title FROM task_items WHERE task_id = ?1 AND done = 0 ORDER BY sort, id`).bind(taskId).all<{ id: number; title: string }>().catch(() => ({ results: [] as { id: number; title: string }[] }))).results;
}

export async function transitionTask(
  env: Env, user: StaffUser, t: TaskRow, a: TaskAccess, decision: TaskDecision,
  input: { summary?: string; reason?: string; exception?: boolean; key?: string | null },
): Promise<Response> {
  const can = decisionsOf(t, a);
  const summary = (input.summary ?? "").trim().slice(0, 1000);
  const reason = (input.reason ?? "").trim().slice(0, 500);
  if (input.key) {
    const again = await env.DB.prepare(`SELECT id, kind, status_to, stage_to FROM task_updates WHERE author_id = ?1 AND client_key = ?2 AND task_id = ?3`).bind(user.id, input.key, t.id)
      .first<{ id: number; kind: string; status_to: string | null; stage_to: string | null }>();
    if (again) return json({ ok: true, existing: true, id: again.id, kind: again.kind, status: again.status_to, stage: again.stage_to });
  }
  const cl = await checklistCount(env, t.id);
  let kind: string, nextStatus: TaskRow["status"], nextStage: string | null, text: string, progress = Number(t.progress ?? 0), blockers: string | null = null;
  if (decision === "close") {
    if (!a.open) return err("task_closed", t.status === "completed" ? "This task is already closed" : "This task's project is closed", 409);
    if (!can.close) {
      return err("forbidden", a.assignee && !a.selfSet ? "Submit it for review - the person who set it (or the Project Owner or management) closes it"
        : "Only the person who set the task, the Project Owner or management close it", 403);
    }
    const approving = t.stage === "review" && !a.selfSet;
    if (!approving && summary.length < 10) return err("summary_required", "Write the completion summary (at least 10 characters) - what was delivered", 400);
    const left = cl.n > cl.d ? await outstandingOf(env, t.id) : [];
    if (left.length) {
      if (!input.exception) {
        return json({ error: { code: "deliverables_outstanding", message: `${left.length} deliverable(s) still open: ${left.map((x) => x.title).join("; ").slice(0, 300)}. Tick them when they are done${can.close_exception ? ", or close with an exception and the reason" : ""}.` }, outstanding: left }, 409);
      }
      if (!can.close_exception) return err("forbidden", "Only management (or the Project Owner, on a project task) closes a task with deliverables still open", 403);
      if (reason.length < 10) return err("reason_required", "Give the reason for closing with deliverables still open (at least 10 characters)", 400);
      blockers = `Open at closing: ${left.map((x) => x.title).join("; ")}`.slice(0, 1000);
    }
    kind = left.length ? "closed_with_exception" : approving ? "review_approved" : "closed";
    text = left.length ? `${summary || "Closed"} - Exception: ${reason}` : (summary || "Approved as completed");
    nextStatus = "completed"; nextStage = null;
    progress = cl.n > 0 ? Math.round((cl.d / cl.n) * 100) : 100; // never ticks a deliverable; a task with no checklist is done when closed
  } else if (decision === "return") {
    if (!can.return) return err(a.review && !a.selfSet ? "invalid_input" : "forbidden", a.review && !a.selfSet ? "Only a task waiting for review is returned" : "Only the reviewer returns a task", a.review && !a.selfSet ? 409 : 403);
    if (reason.length < 5) return err("invalid_input", "Say what still needs doing (at least 5 characters)", 400);
    kind = "review_returned"; text = reason; nextStatus = "in_progress"; nextStage = null;
  } else if (decision === "cancel") {
    if (!a.open) return err("task_closed", "This task is already closed", 409);
    if (!can.cancel) return err("forbidden", "Only the person who set the task, the Project Owner or management cancel it", 403);
    if (reason.length < 10) return err("invalid_input", "Give the reason for cancelling (at least 10 characters)", 400);
    kind = "cancel"; text = reason; nextStatus = "completed"; nextStage = "cancelled";
  } else {
    if (t.status !== "completed") return err("invalid_input", "Only a closed task is reopened", 409);
    if (!can.reopen) return err("forbidden", t.stage === "cancelled" ? "Only management (or the Project Owner) reopens a cancelled task" : "Only the person who closes this task (or management) reopens it", 403);
    if (reason.length < 10) return err("reason_required", "Say why the task is reopened (at least 10 characters)", 400);
    kind = "reopened"; text = reason; nextStatus = "in_progress"; nextStage = null; // checklist and progress stay exactly as they are
  }
  const source = cl.n > 0 ? "checklist" : "manual";
  const key = input.key || crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT OR IGNORE INTO task_updates (task_id, project_id, author_id, kind, body, blockers, status_to, stage_to, progress_snapshot, progress_source, client_key)
       SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11 WHERE EXISTS (SELECT 1 FROM tasks WHERE id = ?1 AND status = ?12 AND stage IS ?13)`,
    ).bind(t.id, a.project?.id ?? null, user.id, kind, text, blockers, nextStatus, nextStage, progress, source, key, t.status, t.stage),
    env.DB.prepare(
      `UPDATE tasks SET status = ?1, stage = ?2, progress = ?3, progress_source = ?4
        WHERE id = ?5 AND status = ?6 AND stage IS ?7 AND EXISTS (SELECT 1 FROM task_updates WHERE author_id = ?8 AND client_key = ?9 AND task_id = ?5)`,
    ).bind(nextStatus, nextStage, progress, source, t.id, t.status, t.stage, user.id, key),
  ]);
  const row = await env.DB.prepare(`SELECT id FROM task_updates WHERE author_id = ?1 AND client_key = ?2 AND task_id = ?3`).bind(user.id, key, t.id).first<{ id: number }>();
  if (!row) return err("stale", "The task changed a moment ago - reload it and decide again", 409);
  if (nextStatus !== t.status) await event(env, t.id, `status:${nextStatus}`, user.id);
  if (nextStage !== t.stage) await event(env, t.id, `stage:${nextStage ?? "none"}`, user.id);
  await audit(env, user.id, `task.${kind}`, "tasks", String(t.id), { ...(reason ? { reason } : {}), ...(summary ? { summary } : {}), from: { status: t.status, stage: t.stage }, to: { status: nextStatus, stage: nextStage } });
  const team = [t.assigned_to, ...(await assistantsOf(env, t.id)).map((x) => x.id)];
  const watchers = decision === "close" || decision === "cancel" ? [...team, t.created_by, a.project?.owner_id ?? null] : team;
  const msg = kind === "review_approved" ? `✅ Approved: ${t.title} (${user.name}) - closed`
    : kind === "closed" ? `✅ Closed: ${t.title} (${user.name})`
    : kind === "closed_with_exception" ? `✅ Closed with deliverables open: ${t.title} (${user.name}) - ${reason.slice(0, 120)}`
    : kind === "review_returned" ? `↩ Returned for more work: ${t.title} - ${reason.slice(0, 120)}`
    : kind === "cancel" ? `⛔ Cancelled: ${t.title} - ${reason.slice(0, 120)}`
    : `🔁 Reopened: ${t.title} (${user.name}) - ${reason.slice(0, 120)}`;
  await tell(env, watchers, user.id, msg, `task:${t.id}:u:${row.id}`);
  const tmd = await taskForMail(env, t.id);
  if (tmd) await queueTaskMailTo(env, "decision", team, user.id, `task:${t.id}:decision:${row.id}`, { task: { ...tmd, status: nextStatus, stage: nextStage }, by: user.name,
    summary: kind === "review_approved" || kind === "closed" ? `Closed as completed: ${text}` : kind === "closed_with_exception" ? `Closed: ${text}` : kind === "reopened" ? `Reopened: ${reason}` : `${kind === "review_returned" ? "Returned for more work" : "Cancelled"}: ${reason}` });
  return json({ ok: true, id: row.id, kind, status: nextStatus, stage: nextStage, progress });
}

/** The closure in force (the latest closing row after the latest reopening), for
    one task or a list. A task closed before 1.256.0 by the old dropdown has
    no row: its closing time is its last status:completed event. */
export async function closuresOf(env: Env, ids: number[]): Promise<Map<number, { kind: string; at: string; by: string | null; summary: string | null }>> {
  const out = new Map<number, { kind: string; at: string; by: string | null; summary: string | null }>();
  if (!ids.length) return out;
  const kinds = [...CLOSING_KINDS, "reopened"].map((k) => `'${k}'`).join(",");
  try {
    for (let i = 0; i < ids.length; i += 90) {
      const chunk = ids.slice(i, i + 90);
      const ph = chunk.map((_, j) => `?${j + 1}`).join(",");
      for (const r of (await env.DB.prepare(
        `SELECT x.task_id, x.kind, x.body, x.created_at AS at, ${PERSON("u")} AS by_name FROM task_updates x JOIN users u ON u.id = x.author_id
          WHERE x.id IN (SELECT MAX(y.id) FROM task_updates y WHERE y.task_id IN (${ph}) AND y.kind IN (${kinds}) GROUP BY y.task_id)`,
      ).bind(...chunk).all<{ task_id: number; kind: string; body: string; at: string; by_name: string | null }>()).results) {
        if (r.kind !== "reopened") out.set(r.task_id, { kind: r.kind, at: r.at, by: r.by_name, summary: r.body });
      }
      const missingIds = chunk.filter((id) => !out.has(id));
      if (missingIds.length) {
        const ph2 = missingIds.map((_, j) => `?${j + 1}`).join(",");
        for (const r of (await env.DB.prepare(
          `SELECT e.task_id, e.created_at AS at, ${PERSON("u")} AS by_name FROM task_events e LEFT JOIN users u ON u.id = e.user_id
            WHERE e.id IN (SELECT MAX(f.id) FROM task_events f WHERE f.task_id IN (${ph2}) AND f.kind = 'status:completed' GROUP BY f.task_id)`,
        ).bind(...missingIds).all<{ task_id: number; at: string; by_name: string | null }>().catch(() => ({ results: [] as { task_id: number; at: string; by_name: string | null }[] }))).results) {
          out.set(r.task_id, { kind: "closed", at: r.at, by: r.by_name, summary: null });
        }
      }
    }
  } catch (e) { if (!missing(e)) throw e; }
  return out;
}
/** days after the due date the task was closed (0 = on time); null without a due date */
export const lateDays = (deadline: string | null, closedAtUtc: string | null) => {
  if (!deadline || !closedAtUtc) return null;
  const closedDay = new Date(Date.parse(`${closedAtUtc.replace(" ", "T")}Z`) + 8 * 3600 * 1000).toISOString().slice(0, 10);
  return Math.max(0, Math.round((Date.parse(closedDay) - Date.parse(deadline.slice(0, 10))) / 86400000));
};

/** THE TASK TIMELINE - the stages a task walks, from what happened only (the
    shared StageTimeline draws it, as for Leave and Claims). */
export async function taskTimeline(env: Env, t: TaskRow, a: TaskAccess) {
  type Step = { key: string; state: "done" | "now" | "todo" | "rejected" | "returned" | "skipped"; who: string | null; at: string | null; text: string | null; flags?: Record<string, string | number | boolean> };
  const ups = (await env.DB.prepare(
    `SELECT x.id, x.kind, x.body, x.created_at, ${PERSON("u")} AS who FROM task_updates x JOIN users u ON u.id = x.author_id
      WHERE x.task_id = ?1 AND x.kind NOT IN ('edit', 'withdrawn') AND NOT EXISTS (SELECT 1 FROM task_updates w WHERE w.corrects_id = x.id AND w.kind = 'withdrawn') ORDER BY x.id`,
  ).bind(t.id).all<{ id: number; kind: string; body: string; created_at: string; who: string | null }>().catch(() => ({ results: [] as { id: number; kind: string; body: string; created_at: string; who: string | null }[] }))).results;
  const evs = (await env.DB.prepare(
    `SELECT e.kind, e.created_at, ${PERSON("u")} AS who FROM task_events e LEFT JOIN users u ON u.id = e.user_id WHERE e.task_id = ?1 AND (e.kind = 'ack' OR e.kind LIKE 'status:%') ORDER BY e.id`,
  ).bind(t.id).all<{ kind: string; created_at: string; who: string | null }>().catch(() => ({ results: [] as { kind: string; created_at: string; who: string | null }[] }))).results;
  const lastReopen = [...ups].reverse().find((u) => u.kind === "reopened") ?? null;
  const cycle = ups.filter((u) => !lastReopen || u.id > lastReopen.id);
  const steps: Step[] = [{ key: "created", state: "done", who: await nameOf(env, t.created_by), at: t.created_at, text: null }];
  if (!a.selfSet) {
    const ack = evs.find((e) => e.kind === "ack");
    steps.push(ack ? { key: "acknowledged", state: "done", who: ack.who, at: ack.created_at, text: null } : { key: "acknowledged", state: t.status === "open" ? "now" : "skipped", who: null, at: null, text: null });
  }
  const started = ups.find((u) => u.kind !== "assist_request" && u.kind !== "file") ?? null;
  const startEv = evs.find((e) => e.kind === "status:in_progress");
  const closed = t.status === "completed";
  const working: Step = { key: "in_progress", state: closed ? "done" : "now", /* open or started, the work is the current stage */ who: started?.who ?? startEv?.who ?? null, at: started?.created_at ?? startEv?.created_at ?? null, text: null, flags: {} };
  if (!closed && t.stage === "blocked") { working.state = "rejected"; working.flags!.blocked = true; }
  if (!closed && t.stage === "waiting_client") working.flags!.waiting = true;
  if (lastReopen) { working.flags!.reopened_at = lastReopen.created_at; working.flags!.reopened_by = lastReopen.who ?? ""; working.text = lastReopen.body; }
  if (t.stage === "review" && !closed) working.state = "done";
  steps.push(working);
  if (!a.selfSet) {
    const req = [...cycle].reverse().find((u) => u.kind === "review_request") ?? null;
    const ret = [...cycle].reverse().find((u) => u.kind === "review_returned") ?? null;
    const approved = closed && t.stage !== "cancelled" ? [...cycle].reverse().find((u) => u.kind === "review_approved") ?? null : null;
    if (approved) steps.push({ key: "review", state: "done", who: approved.who, at: approved.created_at, text: null });
    else if (t.stage === "review" && req) steps.push({ key: "review", state: "now", who: req.who, at: req.created_at, text: null });
    else if (ret && (!req || ret.id > req.id) && !closed) steps.push({ key: "review", state: "returned", who: ret.who, at: ret.created_at, text: ret.body });
    else steps.push({ key: "review", state: closed ? "skipped" : "todo", who: null, at: null, text: null });
  }
  if (closed) {
    const c = [...cycle].reverse().find((u) => CLOSING_KINDS.includes(u.kind)) ?? null;
    const ev = [...evs].reverse().find((e) => e.kind === "status:completed");
    const at = c?.created_at ?? ev?.created_at ?? null;
    steps.push({ key: t.stage === "cancelled" ? "cancelled" : "closed", state: t.stage === "cancelled" ? "rejected" : "done", who: c?.who ?? ev?.who ?? null, at, text: c?.body ?? null,
      flags: { ...(c?.kind === "closed_with_exception" ? { exception: true } : {}), ...(lateDays(t.deadline, at) ? { late_days: lateDays(t.deadline, at)! } : {}) } });
  } else steps.push({ key: "closed", state: "todo", who: null, at: null, text: null });
  return steps;
}

/** A project-level entry: a note, a completion request or an offer to help on the project as a whole. */
export async function appendProjectNote(
  env: Env, user: StaffUser, p: ProjectRow, kind: "note" | "done_request" | "assist_request" | "progress", text: string, extras: { completed_work: string | null; blockers: string | null; next_action: string | null }, key: string | null,
): Promise<{ id: number | undefined; existing: boolean }> {
  if (key) {
    const again = await env.DB.prepare(`SELECT id FROM task_updates WHERE author_id = ?1 AND client_key = ?2`).bind(user.id, key).first<{ id: number }>();
    if (again) return { id: again.id, existing: true };
  }
  const row = await env.DB.prepare(
    `INSERT INTO task_updates (task_id, project_id, author_id, kind, body, completed_work, blockers, next_action, client_key)
     VALUES (NULL, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
     ON CONFLICT(author_id, client_key) WHERE client_key IS NOT NULL DO NOTHING RETURNING id`,
  ).bind(p.id, user.id, kind, text, extras.completed_work, extras.blockers, extras.next_action, key).first<{ id: number }>();
  if (!row) {
    const again = await env.DB.prepare(`SELECT id FROM task_updates WHERE author_id = ?1 AND client_key = ?2`).bind(user.id, key).first<{ id: number }>();
    return { id: again?.id, existing: true };
  }
  return { id: row.id, existing: false };
}

/** Store one file (private R2 + media + task_files). The caller has checked who may. */
export async function storeTaskFile(
  env: Env, user: StaffUser, request: Request, where: { taskId: number | null; projectId: number | null; updateId: number | null; commentId: number | null }, level: "team" | "restricted",
): Promise<Response> {
  const ct = (request.headers.get("Content-Type") ?? "").split(";")[0]!.trim();
  const ft = FILE_TYPES[ct];
  if (!ft) return err("invalid_input", "PDF, JPEG, PNG, WEBP or Word files only", 400);
  if (!request.body) return err("invalid_input", "File body required", 400);
  const name = (request.headers.get("X-File-Name") ?? "file").slice(0, 160);
  const ck = (request.headers.get("Idempotency-Key") ?? "").slice(0, 80) || null;
  if (ck) {
    const again = await env.DB.prepare(`SELECT id, media_id FROM task_files WHERE uploader_id = ?1 AND client_key = ?2`).bind(user.id, ck).first<{ id: number; media_id: number }>();
    if (again) return json({ id: again.id, media_id: again.media_id, existing: true });
  }
  const prefix = where.taskId ? `private/tasks/${where.taskId}` : `private/projects/${where.projectId}`;
  const key = `${prefix}/${Date.now()}-${name.replace(/[^A-Za-z0-9._-]/g, "_")}`;
  const rejected = await putGuarded(env.MEDIA, key, request, { max: ft.max, contentType: ct });
  if (rejected) return rejected;
  const len = Number(request.headers.get("Content-Length") ?? 0) || null;
  const media = await env.DB.prepare(`INSERT INTO media (r2_key, kind, alt, uploaded_by) VALUES (?1, ?2, ?3, ?4) RETURNING id`).bind(key, ft.kind, name, user.id).first<{ id: number }>();
  const row = await env.DB.prepare(
    `INSERT INTO task_files (task_id, project_id, media_id, update_id, comment_id, uploader_id, file_name, content_type, size_bytes, level, client_key)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11) RETURNING id`,
  ).bind(where.taskId, where.projectId, media?.id ?? null, where.updateId, where.commentId, user.id, name, ct, len, level, ck).first<{ id: number }>();
  return json({ id: row?.id, media_id: media?.id, name }, 201);
}

/** Stream one stored file back, after the caller's visibility check. */
export async function streamTaskFile(env: Env, f: { r2_key: string; file_name: string }): Promise<Response> {
  const obj = await env.MEDIA.get(f.r2_key);
  if (!obj) return err("not_found", "File missing from storage", 404);
  const ct = obj.httpMetadata?.contentType ?? "application/octet-stream";
  const inline = /^image\/(jpeg|png|webp)$|^application\/pdf$/.test(ct);
  return new Response(obj.body, { headers: {
    "Content-Type": ct,
    "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${(f.file_name ?? "file").replace(/[^A-Za-z0-9._ -]/g, "_")}"`,
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "private, no-store",
  } });
}

/** The latest update of each task, by id - for lists. */
export async function latestUpdates(env: Env, ids: number[]): Promise<Map<number, { id: number; kind: string; body: string; at: string; by: string | null; by_id: number }>> {
  const out = new Map<number, { id: number; kind: string; body: string; at: string; by: string | null; by_id: number }>();
  if (!ids.length) return out;
  try {
    for (let i = 0; i < ids.length; i += 90) {
      const chunk = ids.slice(i, i + 90);
      const ph = chunk.map((_, j) => `?${j + 1}`).join(",");
      const kinds = LATEST_KINDS.map((k) => `'${k}'`).join(",");
      const rows = (await env.DB.prepare(
        `SELECT x.task_id, x.id, x.kind, COALESCE((SELECT e.body FROM task_updates e WHERE e.corrects_id = x.id AND e.kind = 'edit' ORDER BY e.id DESC LIMIT 1), x.body) AS body,
                x.created_at AS at, x.author_id AS by_id, ${PERSON("u")} AS by_name
           FROM task_updates x JOIN users u ON u.id = x.author_id
          WHERE x.id IN (SELECT MAX(y.id) FROM task_updates y WHERE y.task_id IN (${ph}) AND y.kind IN (${kinds})
                           AND NOT EXISTS (SELECT 1 FROM task_updates w WHERE w.corrects_id = y.id AND w.kind = 'withdrawn') GROUP BY y.task_id)`, /* v1.257.0 - a withdrawn update is not the latest; an edited one reads as edited */
      ).bind(...chunk).all<{ task_id: number; id: number; kind: string; body: string; at: string; by_id: number; by_name: string | null }>()).results;
      for (const r of rows) out.set(r.task_id, { id: r.id, kind: r.kind, body: r.body, at: r.at, by: r.by_name, by_id: r.by_id });
    }
  } catch (e) { if (!missing(e)) throw e; }
  return out;
}

/* ===================================================================== */

export async function handleTaskProgress(
  env: Env, path: string, method: string, body: Record<string, unknown> | null, user: StaffUser, request: Request,
): Promise<Response | null> {
  const em = /^\/tasks\/(\d+)\/updates\/(\d+)\/(edit|withdraw)$/.exec(path);
  if (em) {
    if (method !== "POST") return null;
    try {
      const t = await loadTask(env, em[1]!);
      if (!t) return err("not_found", "Task not found", 404);
      const a = await taskAccess(env, user, t);
      if (!a.view) return err("forbidden", "That task is not yours", 403);
      const key = (request.headers.get("Idempotency-Key") ?? (typeof body?.client_key === "string" ? body.client_key : "")).slice(0, 80) || null;
      return await editTaskUpdate(env, user, t, a, Number(em[2]), em[3] as "edit" | "withdraw", body, key);
    } catch (e) { if (missing(e)) return err("migration_missing", "Run migration 0170 first (PUSH.bat)", 503); throw e; }
  }
  const m = /^\/tasks\/(\d+)(\/updates|\/review|\/close|\/reopen|\/assistants(?:\/(\d+))?|\/files(?:\/(\d+))?|\/activity)?$/.exec(path);
  if (!m) return null;
  const sub = m[2] ?? "";
  /* GET /tasks/:id is new here; PATCH and DELETE /tasks/:id stay in staff.ts */
  if (sub === "" && method !== "GET") return null;
  try {
    const t = await loadTask(env, m[1]!);
    if (!t) return err("not_found", "Task not found", 404);
    const a = await taskAccess(env, user, t);
    if (!a.view) return err("forbidden", "That task is not yours", 403);
    return await route(env, sub, method, body, user, request, t, a, m);
  } catch (e) {
    if (missing(e)) return MIGRATION();
    throw e;
  }
}

async function route(
  env: Env, sub: string, method: string, body: Record<string, unknown> | null, user: StaffUser, request: Request, t: TaskRow, a: TaskAccess, m: RegExpExecArray,
): Promise<Response | null> {
  /* ---------------- the task, whole, cut to this person ---------------- */
  if (sub === "" && method === "GET") {
    const [assignee, creator, items, assistants, ack, latest] = await Promise.all([
      env.DB.prepare(`SELECT ${PERSON("u")} AS name, u.position, u.photo_key FROM users u WHERE u.id = ?1`).bind(t.assigned_to).first<{ name: string; position: string | null; photo_key: string | null }>(),
      nameOf(env, t.created_by),
      env.DB.prepare(`SELECT i.id, i.title, i.done, i.done_at, ${PERSON("u")} AS done_by_name FROM task_items i LEFT JOIN users u ON u.id = i.done_by WHERE i.task_id = ?1 ORDER BY i.sort, i.id`).bind(t.id).all().then((r) => r.results).catch(() => []),
      assistantsOf(env, t.id),
      env.DB.prepare(`SELECT created_at FROM task_events WHERE task_id = ?1 AND kind = 'ack' ORDER BY id LIMIT 1`).bind(t.id).first<{ created_at: string }>().catch(() => null),
      latestUpdates(env, [t.id]),
    ]);
    const counts = await env.DB.prepare(
      `SELECT (SELECT COUNT(*) FROM task_updates WHERE task_id = ?1 AND kind NOT IN ('edit', 'withdrawn')
                 AND NOT EXISTS (SELECT 1 FROM task_updates w WHERE w.corrects_id = task_updates.id AND w.kind = 'withdrawn')) AS updates, (SELECT COUNT(*) FROM task_files WHERE task_id = ?1) AS files,
              (SELECT COUNT(*) FROM task_comments WHERE task_id = ?1) AS comments`,
    ).bind(t.id).first<{ updates: number; files: number; comments: number }>();
    let link: { kind: string; id: number; label: string; project_id?: number; quotation_id?: number; quotation?: string; customer?: string } | null = null;
    if (a.project) {
      const qt = await env.DB.prepare(`SELECT d.doc_number, c.company FROM sales_documents d JOIN customers c ON c.id = d.customer_id WHERE d.id = ?1`).bind(a.project.quotation_id).first<{ doc_number: string; company: string }>().catch(() => null);
      link = { kind: "project", id: a.project.id, label: a.project.title, project_id: a.project.id, quotation_id: a.project.quotation_id, quotation: qt?.doc_number, customer: qt?.company };
    } else if (t.link_kind && t.link_id) {
      const label = t.link_kind === "customer" ? (await env.DB.prepare(`SELECT company AS l FROM customers WHERE id = ?1`).bind(t.link_id).first<{ l: string }>().catch(() => null))?.l
        : t.link_kind === "quotation" ? (await env.DB.prepare(`SELECT doc_number AS l FROM sales_documents WHERE id = ?1`).bind(t.link_id).first<{ l: string }>().catch(() => null))?.l : null;
      link = { kind: t.link_kind, id: t.link_id, label: label ?? `${t.link_kind} #${t.link_id}` };
    }
    const cl = (items as { done: number }[]).length;
    /* v1.256.0 - the decisions, the closure in force, what is still open, the timeline, the one next step */
    const dec = decisionsOf(t, a);
    const closure = t.status === "completed" ? (await closuresOf(env, [t.id])).get(t.id) ?? null : null;
    const outstanding = (items as { id: number; title: string; done: number }[]).filter((i) => !i.done).map((i) => ({ id: i.id, title: i.title }));
    const next = t.status === "completed" ? (t.stage === "cancelled" ? "cancelled" : "closed")
      : t.stage === "review" ? (dec.close ? "review_decide" : "review_wait")
      : t.stage === "blocked" ? "blocked" : t.stage === "waiting_client" ? "waiting_client"
      : outstanding.length ? "outstanding"
      : a.selfSet ? (dec.close ? "close_ready" : "in_progress")
      : a.assignee ? "submit_review" : dec.close ? "close_ready" : "in_progress";
    const timeline = await taskTimeline(env, t, a);
    /* v1.257.0 - the latest REPORTED percentage (not withdrawn), beside the official one */
    const reported = await env.DB.prepare(
      `SELECT x.reported_progress AS value, x.created_at AS at, ${PERSON("u")} AS by_name FROM task_updates x JOIN users u ON u.id = x.author_id
        WHERE x.task_id = ?1 AND x.reported_progress IS NOT NULL AND NOT EXISTS (SELECT 1 FROM task_updates w WHERE w.corrects_id = x.id AND w.kind = 'withdrawn') ORDER BY x.id DESC LIMIT 1`,
    ).bind(t.id).first<{ value: number; at: string; by_name: string | null }>().catch(() => null);
    return json({
      task: {
        ...t, assignee: assignee?.name ?? null, assignee_position: assignee?.position ?? null, assignee_photo: assignee?.photo_key ?? null,
        creator, acknowledged_at: ack?.created_at ?? null, assistants, items, link,
        progress_source: cl > 0 ? "checklist" : (t.progress_source ?? "manual"),
        latest_update: latest.get(t.id) ?? null,
        closure: closure ? { ...closure, late_days: lateDays(t.deadline, closure.at) } : null, outstanding, next, timeline,
        reported: reported ? { value: Number(reported.value), at: reported.at, by: reported.by_name } : null,
        counts: { updates: Number(counts?.updates ?? 0), files: Number(counts?.files ?? 0), comments: a.team ? Number(counts?.comments ?? 0) : null },
      },
      me: user.id,
      can: {
        edit: (a.assignee || a.manage) && a.open, reassign: a.manage && a.open, assistants: a.manage && a.open, tick: (a.assignee || a.assistant || a.manage) && a.open,
        update: a.update && a.open, comment: a.team, files: a.update && a.open, restricted_files: a.manage || (a.review && !a.assignee),
        request_review: a.assignee && !a.selfSet && a.open && t.stage !== "review", review: a.review && a.open && !a.selfSet && t.stage === "review",
        approve: dec.close, cancel: dec.cancel, close: dec.close, close_exception: dec.close_exception, reopen: dec.reopen, return: dec.return,
        assist: !!a.project && !a.team && !a.update && a.open, self_set: a.selfSet, is_assignee: a.assignee, is_assistant: a.assistant,
        remind: (a.manage || a.creator) && !a.assignee && a.open, // v1.247.0 - a manual reminder to the assignee (POST /tasks/:id/remind)
      },
    });
  }

  /* ---------------- progress updates (append-only) ---------------- */
  if (sub === "/updates" && method === "GET") {
    const all = (await env.DB.prepare(
      `SELECT x.id, x.task_id, x.project_id, x.author_id, ${PERSON("u")} AS author, u.photo_key, x.kind, x.body, x.completed_work, x.blockers, x.next_action,
              x.status_to, x.stage_to, x.progress_snapshot, x.progress_source, x.corrects_id, x.created_at, x.reported_progress
         FROM task_updates x JOIN users u ON u.id = x.author_id WHERE x.task_id = ?1 ORDER BY x.id DESC LIMIT 800`,
    ).bind(t.id).all<Record<string, unknown>>()).results;
    const files = await filesOf(env, t.id, a);
    /* v1.257.0 - an edit and a withdrawal are folded into the update they change:
       the original stays as it was written, its edits newest last, and who withdrew it and why */
    const meta = all.filter((r) => META_KINDS.includes(String(r.kind)));
    const rows = all.filter((r) => !META_KINDS.includes(String(r.kind)));
    return json({ updates: rows.map((r) => {
      const edits = meta.filter((x) => x.kind === "edit" && x.corrects_id === r.id).reverse()
        .map((x) => ({ id: x.id, body: x.body, completed_work: x.completed_work, blockers: x.blockers, next_action: x.next_action, by: x.author, by_id: x.author_id, at: x.created_at }));
      const w = meta.find((x) => x.kind === "withdrawn" && x.corrects_id === r.id);
      const withdrawn = w ? { by: w.author, at: w.created_at, reason: w.body } : null;
      const editable = !withdrawn && a.open && EDITABLE_KINDS.includes(String(r.kind)) && (r.author_id === user.id || a.manage);
      return { ...r, files: files.filter((f) => f.update_id === r.id), edits, withdrawn, can_edit: editable };
    }) });
  }
  if (sub === "/updates" && method === "POST") {
    const key = (request.headers.get("Idempotency-Key") ?? (typeof body?.client_key === "string" ? body.client_key : "")).slice(0, 80) || null;
    return appendTaskUpdate(env, user, t, a, body, key);
  }

  /* ---------------- review: approve, return, cancel (T-2, T-7) ---------------- */
  if (sub === "/review" && method === "POST") {
    const decision = typeof body?.decision === "string" ? body.decision : "";
    const reason = typeof body?.reason === "string" ? body.reason : "";
    const key = (request.headers.get("Idempotency-Key") ?? (typeof body?.client_key === "string" ? body.client_key : "")).slice(0, 80) || null;
    /* v1.256.0 - the review's approve is a close through the one transition
       (the reviewer's note is the summary; the checklist is checked) */
    if (decision === "approve") return transitionTask(env, user, t, a, "close", { summary: reason || (typeof body?.summary === "string" ? body.summary : ""), reason: typeof body?.exception_reason === "string" ? body.exception_reason : "", exception: body?.exception === true, key });
    if (decision === "return" || decision === "cancel") return transitionTask(env, user, t, a, decision, { reason, key });
    return err("invalid_input", "decision is approve, return or cancel", 400);
  }
  /* v1.256.0 - Close task (completion summary; a manager's exception) and Reopen (reason) */
  if ((sub === "/close" || sub === "/reopen") && method === "POST") {
    const key = (request.headers.get("Idempotency-Key") ?? (typeof body?.client_key === "string" ? body.client_key : "")).slice(0, 80) || null;
    return sub === "/close"
      ? transitionTask(env, user, t, a, "close", { summary: typeof body?.summary === "string" ? body.summary : "", reason: typeof body?.exception_reason === "string" ? body.exception_reason : "", exception: body?.exception === true, key })
      : transitionTask(env, user, t, a, "reopen", { reason: typeof body?.reason === "string" ? body.reason : "", key });
  }

  /* ---------------- assistants ---------------- */
  if (sub.startsWith("/assistants") && method === "POST" && !m[3]) {
    if (!a.manage) return err("forbidden", a.project ? "Only the Project Owner or the CEO, COO or CCO add people to a project task" : "Only management add people to a task", 403);
    if (!a.open) return err("task_closed", "This task is closed", 409);
    const uid = Number(body?.user_id);
    if (!Number.isInteger(uid) || uid <= 0) return err("invalid_input", "user_id is required", 400);
    if (uid === t.assigned_to) return err("invalid_input", "That is the person responsible for the task already", 400);
    const ok = await env.DB.prepare(`SELECT 1 AS x FROM users WHERE id = ?1 AND is_active = 1 AND ${staffRolesSql()} AND ${currentStaffSql()}`).bind(uid).first();
    if (!ok) return err("invalid_input", "That must be a current staff member", 400);
    const ins = await env.DB.prepare(
      `INSERT INTO task_assistants (task_id, user_id, added_by) SELECT ?1, ?2, ?3 WHERE NOT EXISTS (SELECT 1 FROM task_assistants WHERE task_id = ?1 AND user_id = ?2 AND removed_at IS NULL) RETURNING id`,
    ).bind(t.id, uid, user.id).first<{ id: number }>();
    if (!ins) return json({ ok: true, existing: true });
    await event(env, t.id, `assist_add:${uid}`, user.id);
    await audit(env, user.id, "task.assistant_add", "tasks", String(t.id), { user_id: uid });
    await tell(env, [uid], user.id, `🤝 You are helping on: ${t.title} - it is in your Tasks`, `task:${t.id}:assist:${ins.id}`);
    return json({ ok: true, id: ins.id }, 201);
  }
  if (sub.startsWith("/assistants") && method === "DELETE" && m[3]) {
    if (!a.manage) return err("forbidden", "Only those who manage the task remove a helper", 403);
    const r = await env.DB.prepare(`UPDATE task_assistants SET removed_at = datetime('now'), removed_by = ?1 WHERE task_id = ?2 AND user_id = ?3 AND removed_at IS NULL`).bind(user.id, t.id, Number(m[3])).run();
    if (!(r.meta?.changes ?? 0)) return err("not_found", "That person is not helping on this task", 404);
    await event(env, t.id, `assist_remove:${m[3]}`, user.id);
    await audit(env, user.id, "task.assistant_remove", "tasks", String(t.id), { user_id: Number(m[3]) });
    return json({ ok: true });
  }

  /* ---------------- files (private) ---------------- */
  if (sub === "/files" && method === "GET") {
    return json({ files: await filesOf(env, t.id, a) });
  }
  if (sub.startsWith("/files") && method === "POST" && !m[4]) {
    if (!a.update) return err("forbidden", "Only the people on this task add files to it", 403);
    if (!a.open) return err("task_closed", "This task is closed", 409);
    const level = request.headers.get("X-File-Level") === "restricted" ? "restricted" : "team";
    if (level === "restricted" && !(a.manage || (a.review && !a.assignee))) return err("forbidden", "Only the Project Owner, the person who set the task or management add restricted files", 403);
    let updateId: number | null = null;
    let commentId: number | null = null;
    const uh = request.headers.get("X-Update-Id");
    if (uh) {
      const u = await env.DB.prepare(`SELECT id FROM task_updates WHERE id = ?1 AND task_id = ?2 AND author_id = ?3`).bind(Number(uh), t.id, user.id).first<{ id: number }>();
      if (!u) return err("invalid_input", "A file is attached to your own update on this task", 400);
      updateId = u.id;
    }
    const ch = request.headers.get("X-Comment-Id");
    if (ch) {
      const c = await env.DB.prepare(`SELECT id FROM task_comments WHERE id = ?1 AND task_id = ?2 AND user_id = ?3`).bind(Number(ch), t.id, user.id).first<{ id: number }>();
      if (!c) return err("invalid_input", "A file is attached to your own comment on this task", 400);
      commentId = c.id;
    }
    const res = await storeTaskFile(env, user, request, { taskId: t.id, projectId: a.project?.id ?? null, updateId, commentId }, level);
    if (res.status === 201) await tell(env, [t.created_by, a.project?.owner_id, ...(a.assignee ? [] : [t.assigned_to])], user.id, `📎 ${user.name} attached a file to ${t.title}`, `task:${t.id}:f:${Date.now()}`);
    return res;
  }
  if (sub.startsWith("/files") && method === "GET" && m[4]) {
    const f = await env.DB.prepare(`SELECT f.file_name, f.level, md.r2_key FROM task_files f JOIN media md ON md.id = f.media_id WHERE f.id = ?1 AND f.task_id = ?2`)
      .bind(Number(m[4]), t.id).first<{ file_name: string; level: string; r2_key: string }>();
    if (!f) return err("not_found", "File not found on this task", 404);
    if (f.level === "restricted" && !(a.manage || a.review || a.creator)) return err("forbidden", "This file is restricted to the owner, the person who set the task and management", 403);
    return streamTaskFile(env, f);
  }

  /* ---------------- the activity timeline ---------------- */
  if (sub === "/activity" && method === "GET") {
    return json({ activity: await taskActivity(env, t, a) });
  }
  return null;
}

async function filesOf(env: Env, taskId: number, a: TaskAccess) {
  const rows = (await env.DB.prepare(
    `SELECT f.id, f.update_id, f.comment_id, f.file_name, f.content_type, f.size_bytes, f.level, f.created_at, f.uploader_id, ${PERSON("u")} AS uploader
       FROM task_files f JOIN users u ON u.id = f.uploader_id WHERE f.task_id = ?1 ORDER BY f.id DESC`,
  ).bind(taskId).all<{ id: number; update_id: number | null; comment_id: number | null; file_name: string; content_type: string | null; size_bytes: number | null; level: string; created_at: string; uploader_id: number; uploader: string }>()).results;
  const mayRestricted = a.manage || a.review || a.creator;
  /* a restricted file is named to everyone on the record but opened only by
     the reviewer side; a comment's file only by the people in the thread */
  return rows.filter((f) => f.comment_id === null || a.team).map((f) => ({ ...f, open: f.level !== "restricted" || mayRestricted }));
}

/** The task's whole story, oldest first, each entry once (a source key per row). */
export async function taskActivity(env: Env, t: TaskRow, a: TaskAccess) {
  type Ev = { key: string; at: string; kind: string; text: string; by: string | null; by_id: number | null; photo_key?: string | null; quote?: string | null; muted?: boolean };
  const out = new Map<string, Ev>();
  const add = (e: Ev) => { if (!out.has(e.key)) out.set(e.key, e); };
  const creator = t.created_by ? await env.DB.prepare(`SELECT ${PERSON("u")} AS n, u.photo_key FROM users u WHERE u.id = ?1`).bind(t.created_by).first<{ n: string; photo_key: string | null }>() : null;
  add({ key: `c${t.id}`, at: t.created_at, kind: "task.create", text: `Created the task for ${await nameOf(env, t.assigned_to)}`, by: creator?.n ?? null, by_id: t.created_by, photo_key: creator?.photo_key ?? null });
  const label: Record<string, string> = { title: "title", description: "description", priority: "priority", deadline: "deadline" };
  for (const r of (await env.DB.prepare(
    `SELECT a.id, a.action, a.detail, a.created_at, a.user_id, ${PERSON("u")} AS who, u.photo_key FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
      WHERE a.entity = 'tasks' AND a.entity_id = ?1 AND a.action IN ('task.update','task.assistant_add','task.assistant_remove') ORDER BY a.id`,
  ).bind(String(t.id)).all<{ id: number; action: string; detail: string | null; created_at: string; user_id: number | null; who: string | null; photo_key: string | null }>()).results) {
    let d: { reassigned_to?: number; from?: number; reason?: string; changed?: Record<string, [unknown, unknown]>; user_id?: number } = {};
    try { d = JSON.parse(r.detail ?? "{}"); } catch { /* keep */ }
    if (r.action === "task.assistant_add") { add({ key: `a${r.id}`, at: r.created_at, kind: "assist.add", text: `Added ${await nameOf(env, d.user_id)} to help`, by: r.who, by_id: r.user_id, photo_key: r.photo_key }); continue; }
    if (r.action === "task.assistant_remove") { add({ key: `a${r.id}`, at: r.created_at, kind: "assist.remove", text: `${await nameOf(env, d.user_id)} no longer helps`, by: r.who, by_id: r.user_id, photo_key: r.photo_key }); continue; }
    if (d.reassigned_to) add({ key: `a${r.id}r`, at: r.created_at, kind: "task.reassign", text: `Reassigned from ${await nameOf(env, d.from)} to ${await nameOf(env, d.reassigned_to)}`, by: r.who, by_id: r.user_id, photo_key: r.photo_key, quote: d.reason ?? null });
    const ch = d.changed ? Object.entries(d.changed).filter(([k]) => k in label) : [];
    if (ch.length) add({ key: `a${r.id}e`, at: r.created_at, kind: "task.edit", text: `Changed ${ch.map(([k, v]) => `${label[k]} ${k === "description" ? "" : `${String(v[0] ?? "none")} → ${String(v[1] ?? "none")}`}`.trim()).join(", ")}`, by: r.who, by_id: r.user_id, photo_key: r.photo_key });
  }
  const items = new Map((await env.DB.prepare(`SELECT id, title FROM task_items WHERE task_id = ?1`).bind(t.id).all<{ id: number; title: string }>().catch(() => ({ results: [] as { id: number; title: string }[] }))).results.map((i) => [i.id, i.title]));
  for (const e of (await env.DB.prepare(
    `SELECT e.id, e.kind, e.created_at, e.user_id, ${PERSON("u")} AS who, u.photo_key FROM task_events e LEFT JOIN users u ON u.id = e.user_id WHERE e.task_id = ?1 ORDER BY e.id`,
  ).bind(t.id).all<{ id: number; kind: string; created_at: string; user_id: number | null; who: string | null; photo_key: string | null }>().catch(() => ({ results: [] }))).results) {
    const k = e.kind;
    const text = k === "ack" ? "Acknowledged the task"
      : k.startsWith("status:") ? `Status → ${k.slice(7) === "completed" ? "completed" : k.slice(7) === "in_progress" ? "in progress" : "open"}`
      : k.startsWith("stage:") ? (k.slice(6) === "none" ? "Back to work" : `Stage → ${({ waiting_client: "waiting for client", blocked: "blocked", review: "ready for review", cancelled: "cancelled" } as Record<string, string>)[k.slice(6)] ?? k.slice(6)}`)
      : k.startsWith("item_done:") ? `Ticked "${items.get(Number(k.slice(10))) ?? "an item"}"`
      : k.startsWith("item_undone:") ? `Unticked "${items.get(Number(k.slice(12))) ?? "an item"}"`
      : k.startsWith("item_added:") ? (items.has(Number(k.slice(11))) ? `Added "${items.get(Number(k.slice(11)))}" to the checklist` : "Added a deliverable to the checklist (since removed)")
      : k.startsWith("item_removed:") ? `Removed "${k.slice(13).replace(/^\d+:/, "")}" from the checklist`
      : k === "scope_done" ? "Every checklist item is done"
      : k === "ack_nudge" ? "Reminder: not acknowledged yet" : k === "due_reminder" ? "Reminder: due soon" : k === "overdue_alert" ? "Reminder: overdue"
      : k.startsWith("assist_") ? "" : k;
    if (!text) continue;
    add({ key: `e${e.id}`, at: e.created_at, kind: `event.${k.split(":")[0]}`, text, by: ["ack_nudge", "due_reminder", "overdue_alert"].includes(k) ? null : e.who, by_id: e.user_id, photo_key: e.photo_key, muted: ["ack_nudge", "due_reminder", "overdue_alert"].includes(k) });
  }
  const KIND: Record<string, string> = { progress: "Progress update", blocker: "Reported a blocker", waiting_client: "Waiting for the client", review_request: "Submitted for review", review_approved: "Approved and closed", review_returned: "Returned for more work", correction: "Correction", assist_request: "Offered to help", cancel: "Cancelled the task", closed: "Closed the task", closed_with_exception: "Closed with deliverables still open", reopened: "Reopened the task", edit: "Edited an update", withdrawn: "Withdrew an update" };
  for (const u of (await env.DB.prepare(
    `SELECT x.id, x.kind, x.body, x.created_at, x.author_id, x.progress_snapshot, ${PERSON("u")} AS who, u.photo_key FROM task_updates x JOIN users u ON u.id = x.author_id WHERE x.task_id = ?1 ORDER BY x.id`,
  ).bind(t.id).all<{ id: number; kind: string; body: string; created_at: string; author_id: number; progress_snapshot: number | null; who: string; photo_key: string | null }>()).results)
    add({ key: `u${u.id}`, at: u.created_at, kind: `update.${u.kind}`, text: `${KIND[u.kind] ?? "Update"}${u.progress_snapshot !== null && u.kind === "progress" ? ` · ${u.progress_snapshot}%` : ""}`, by: u.who, by_id: u.author_id, photo_key: u.photo_key, quote: u.body });
  if (a.team) {
    for (const c of (await env.DB.prepare(
      `SELECT c.id, c.comment, c.created_at, c.user_id, ${PERSON("u")} AS who, u.photo_key FROM task_comments c JOIN users u ON u.id = c.user_id WHERE c.task_id = ?1 ORDER BY c.id`,
    ).bind(t.id).all<{ id: number; comment: string; created_at: string; user_id: number; who: string; photo_key: string | null }>()).results)
      add({ key: `m${c.id}`, at: c.created_at, kind: "comment", text: "Commented", by: c.who, by_id: c.user_id, photo_key: c.photo_key, quote: c.comment });
  }
  for (const f of await filesOf(env, t.id, a))
    add({ key: `f${f.id}`, at: f.created_at, kind: "file", text: `Attached ${f.file_name}${f.level === "restricted" ? " (restricted)" : ""}`, by: f.uploader, by_id: f.uploader_id });
  return [...out.values()].sort((x, y) => x.at.localeCompare(y.at) || x.key.localeCompare(y.key));
}

/** v1.257.0 - EDIT or WITHDRAW one update (the owner, 03-11-2026: "Edit + Withdraw,
    history kept"). Both are new rows that name the update (corrects_id); the
    update itself is never changed - its original words stay readable. Neither
    moves the task's status, stage or progress. */
export async function editTaskUpdate(
  env: Env, user: StaffUser, t: TaskRow, a: TaskAccess, updateId: number, action: "edit" | "withdraw", body: Record<string, unknown> | null, key: string | null,
): Promise<Response> {
  const u = await env.DB.prepare(`SELECT id, author_id, kind, body, completed_work, blockers, next_action FROM task_updates WHERE id = ?1 AND task_id = ?2`)
    .bind(updateId, t.id).first<{ id: number; author_id: number; kind: string; body: string; completed_work: string | null; blockers: string | null; next_action: string | null }>();
  if (!u) return err("not_found", "Update not found", 404);
  if (!EDITABLE_KINDS.includes(u.kind)) return err("invalid_input", "A decision (approval, return, closing, cancelling, reopening) is not edited or withdrawn - the next decision changes it", 409);
  if (u.author_id !== user.id && !a.manage) return err("forbidden", "You edit or withdraw your own updates; the task's management may edit others", 403);
  if (!a.open) return err("task_closed", "This task is closed - reopen it first to change its record", 409);
  if (key) {
    const again = await env.DB.prepare(`SELECT id FROM task_updates WHERE author_id = ?1 AND client_key = ?2`).bind(user.id, key).first<{ id: number }>();
    if (again) return json({ ok: true, id: again.id, existing: true });
  }
  const gone = await env.DB.prepare(`SELECT 1 AS x FROM task_updates WHERE corrects_id = ?1 AND kind = 'withdrawn'`).bind(u.id).first();
  if (gone) return err("withdrawn", "That update was withdrawn already", 409);
  const clip = (v: unknown, n: number) => typeof v === "string" && v.trim() ? v.trim().slice(0, n) : null;
  if (action === "withdraw") {
    const reason = clip(body?.reason, 500) ?? "";
    if (reason.length < 5) return err("invalid_input", "Say why it is withdrawn (at least 5 characters)", 400);
    const r = await env.DB.prepare(
      `INSERT OR IGNORE INTO task_updates (task_id, project_id, author_id, kind, body, corrects_id, client_key)
       SELECT ?1, ?2, ?3, 'withdrawn', ?4, ?5, ?6 WHERE NOT EXISTS (SELECT 1 FROM task_updates WHERE corrects_id = ?5 AND kind = 'withdrawn')`,
    ).bind(t.id, a.project?.id ?? null, user.id, reason, u.id, key).run();
    if (!r.meta?.changes) return err("withdrawn", "That update was withdrawn already", 409);
    await audit(env, user.id, "task.update_withdraw", "tasks", String(t.id), { update_id: u.id, reason });
    return json({ ok: true });
  }
  const text = clip(body?.body, 500);
  if (!text) return err("invalid_input", "Write the update (up to 500 characters)", 400);
  const last = await env.DB.prepare(`SELECT body, completed_work, blockers, next_action FROM task_updates WHERE corrects_id = ?1 AND kind = 'edit' ORDER BY id DESC LIMIT 1`)
    .bind(u.id).first<{ body: string; completed_work: string | null; blockers: string | null; next_action: string | null }>() ?? u;
  const next = {
    completed_work: body && "completed_work" in body ? clip(body.completed_work, 1000) : last.completed_work,
    blockers: body && "blockers" in body ? clip(body.blockers, 1000) : last.blockers,
    next_action: body && "next_action" in body ? clip(body.next_action, 1000) : last.next_action,
  };
  if (text === last.body && next.completed_work === last.completed_work && next.blockers === last.blockers && next.next_action === last.next_action) return json({ ok: true, unchanged: true });
  const row = await env.DB.prepare(
    `INSERT INTO task_updates (task_id, project_id, author_id, kind, body, completed_work, blockers, next_action, corrects_id, client_key)
     VALUES (?1, ?2, ?3, 'edit', ?4, ?5, ?6, ?7, ?8, ?9) ON CONFLICT(author_id, client_key) WHERE client_key IS NOT NULL DO NOTHING RETURNING id`,
  ).bind(t.id, a.project?.id ?? null, user.id, text, next.completed_work, next.blockers, next.next_action, u.id, key).first<{ id: number }>();
  await audit(env, user.id, "task.update_edit", "tasks", String(t.id), { update_id: u.id });
  return json({ ok: true, id: row?.id }, 201);
}
