/* v1.247.0 - TASK EMAIL NOTIFICATIONS: the email leg of the ONE notification
   engine (the owner's brief, 01-11-2026, claude/TASK-EMAIL-AUDIT.md, and his
   answers: emails first, the digest off until he turns it on, overdue on day
   1, 3 and 7 then stop, the sender A2Z Creative Marketing
   <hello@a2zcreative.my>).

   HOW IT FITS. Every task event already writes the in-app bell and the push
   through notify() (staff.ts), idempotent by `ref`. Beside those calls the
   same event now also queues ONE email per recipient into mail_outbox (0161),
   under the same ref, so a retried request, a second cron pass or a redeploy
   can never queue it twice (unique index). The five-minute cron drains the
   outbox through mail.ts (Cloudflare Email Sending): accepted, or failed and
   retried with backoff, or dead after three attempts. "accepted" means
   Cloudflare took the message - it is never called inbox delivery.

   WHAT NEVER HAPPENS. An email failure never touches a task: the task row is
   committed before any of this runs, and every function here swallows its
   own errors. Nothing is queued while the sender is not configured (the
   settings page says so) - a flood of stale mail on the day the domain is
   onboarded would be worse than silence. No amounts, no customer phone or
   email, no login tokens in a link. A customer account, a suspended
   account or a leaver gets nothing. */
import type { Env } from "./index";
import { primaryOrigin } from "./index";
import { mailReady, sendMailResult } from "./mail";
import { currentStaffSql, staffRolesSql } from "./staff";

/* ---------------------------------------------------------------- settings */

export interface MailSettings {
  enabled: boolean;
  triggers: Record<MailKind, boolean>;
  lead_hours: number;        // deadline reminder, hours before (24..168)
  escalation_days: number;   // overdue days before the HOD hears (1..14)
  overdue_days: number[];    // the overdue emails: day 1, 3, 7 then stop
  digest_on: boolean;
  digest_time: string;       // "08:30" MYT (the cron fires at :30 on the hour it is set to)
  quiet_from: string;        // "21:00" MYT
  quiet_to: string;          // "08:00" MYT
  cap_per_day: number;       // task emails per person per day (digest excluded)
  updated_by?: number | null;
  updated_at?: string | null;
}
export type MailKind = "assigned" | "moved" | "update" | "mention" | "review" | "decision" | "due" | "overdue" | "escalation" | "reminder" | "digest" | "test";
export const MAIL_KINDS: MailKind[] = ["assigned", "moved", "update", "mention", "review", "decision", "due", "overdue", "escalation", "reminder", "digest", "test"];
const SETTINGS_KEY = "task_mail_settings";

export const DEFAULT_SETTINGS: MailSettings = {
  enabled: true,
  triggers: { assigned: true, moved: true, update: true, mention: true, review: true, decision: true, due: true, overdue: true, escalation: true, reminder: true, digest: false, test: true },
  lead_hours: 24, escalation_days: 2, overdue_days: [1, 3, 7], digest_on: false, digest_time: "08:30",
  quiet_from: "21:00", quiet_to: "08:00", cap_per_day: 8,
};

export async function readMailSettings(env: Env): Promise<MailSettings> {
  try {
    const row = await env.DB.prepare(`SELECT value FROM system_meta WHERE key = ?1`).bind(SETTINGS_KEY).first<{ value: string }>();
    if (!row?.value) return { ...DEFAULT_SETTINGS, triggers: { ...DEFAULT_SETTINGS.triggers } };
    const v = JSON.parse(row.value) as Partial<MailSettings>;
    return { ...DEFAULT_SETTINGS, ...v, triggers: { ...DEFAULT_SETTINGS.triggers, ...(v.triggers ?? {}) }, overdue_days: DEFAULT_SETTINGS.overdue_days };
  } catch { return { ...DEFAULT_SETTINGS, triggers: { ...DEFAULT_SETTINGS.triggers } }; }
}

/** The owner's / CEO's edit: validated, whole-object, audited by the caller. */
export function validateSettings(body: Record<string, unknown> | null, current: MailSettings): MailSettings | string {
  if (!body || typeof body !== "object") return "Settings are required";
  const out: MailSettings = { ...current, triggers: { ...current.triggers } };
  if (typeof body.enabled === "boolean") out.enabled = body.enabled;
  if (body.triggers && typeof body.triggers === "object") {
    for (const k of MAIL_KINDS) { const v = (body.triggers as Record<string, unknown>)[k]; if (typeof v === "boolean") out.triggers[k] = v; }
  }
  const hm = /^([01]\d|2[0-3]):[0-5]\d$/;
  const num = (v: unknown, lo: number, hi: number, what: string): number | string => {
    if (typeof v !== "number" || !Number.isInteger(v) || v < lo || v > hi) return `${what} must be a whole number from ${lo} to ${hi}`;
    return v;
  };
  if (body.lead_hours !== undefined) { const r = num(body.lead_hours, 1, 168, "The reminder lead time (hours)"); if (typeof r === "string") return r; out.lead_hours = r; }
  if (body.escalation_days !== undefined) { const r = num(body.escalation_days, 1, 14, "The escalation (days overdue)"); if (typeof r === "string") return r; out.escalation_days = r; }
  if (body.cap_per_day !== undefined) { const r = num(body.cap_per_day, 1, 50, "The daily cap"); if (typeof r === "string") return r; out.cap_per_day = r; }
  if (typeof body.digest_on === "boolean") { out.digest_on = body.digest_on; out.triggers.digest = body.digest_on; }
  for (const k of ["digest_time", "quiet_from", "quiet_to"] as const) {
    if (body[k] !== undefined) { if (typeof body[k] !== "string" || !hm.test(body[k] as string)) return `${k.replace("_", " ")} must be HH:MM`; out[k] = body[k] as string; }
  }
  return out;
}

export async function writeMailSettings(env: Env, s: MailSettings, by: number): Promise<void> {
  const v = JSON.stringify({ ...s, updated_by: by, updated_at: new Date().toISOString() });
  await env.DB.prepare(`INSERT INTO system_meta (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = ?2`).bind(SETTINGS_KEY, v).run();
}

/* ---------------------------------------------------------------- people */

export interface Recipient { id: number; email: string; name: string; first: string; role: string }

/** Who may receive a task email: a current, active staff member with an
    email, who has not switched task emails off. `why` says why not. */
export async function recipientFor(env: Env, userId: number | null | undefined, pref: "email_tasks" | "email_digest" = "email_tasks"): Promise<{ to: Recipient | null; why: string | null }> {
  if (!userId) return { to: null, why: "nobody" };
  try {
    const u = await env.DB.prepare(
      `SELECT id, email, name, full_name, role, is_active, ${currentStaffSql()} AS current, ${staffRolesSql()} AS staff FROM users WHERE id = ?1`,
    ).bind(userId).first<{ id: number; email: string | null; name: string; full_name: string | null; role: string; is_active: number; current: number; staff: number }>();
    if (!u) return { to: null, why: "unknown user" };
    if (!u.staff) return { to: null, why: "not a staff account" };
    if (!u.is_active) return { to: null, why: "account suspended" };
    if (!u.current) return { to: null, why: "no longer on staff" };
    if (!u.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(u.email)) return { to: null, why: "no email on the account" };
    const off = await env.DB.prepare(`SELECT enabled FROM notification_prefs WHERE user_id = ?1 AND pref_key = ?2`).bind(userId, pref).first<{ enabled: number }>().catch(() => null);
    if (off && off.enabled === 0) return { to: null, why: "switched off by the person" };
    const name = (u.full_name ?? "").trim() || u.name;
    return { to: { id: u.id, email: u.email, name, first: name.split(/\s+/)[0] ?? name, role: u.role }, why: null };
  } catch { return { to: null, why: "lookup failed" }; }
}

/* ---------------------------------------------------------------- time */

const MYT = 8 * 3600 * 1000;
const mytDate = (ms = Date.now()) => new Date(ms + MYT).toISOString().slice(0, 10);
const mytHM = (ms = Date.now()) => new Date(ms + MYT).toISOString().slice(11, 16);
/** The UTC instant of HH:MM MYT on an ISO day. */
const atMyt = (day: string, hm: string) => new Date(`${day}T${hm}:00+08:00`).toISOString().slice(0, 19).replace("T", " ");

/** "YYYY-MM-DD HH:MM:SS" UTC, the way SQLite writes datetime('now') - but
    from the Worker's clock, so every time the outbox compares is one clock. */
const sqlTime = (ms = Date.now()) => new Date(ms).toISOString().slice(0, 19).replace("T", " ");

/** Quiet hours: an email decided at 23:00 waits for the morning. */
export function heldUntil(s: MailSettings, now = Date.now()): string | null {
  const hm = mytHM(now);
  const from = s.quiet_from, to = s.quiet_to;
  const inQuiet = from > to ? (hm >= from || hm < to) : (hm >= from && hm < to);
  if (!inQuiet) return null;
  const day = hm >= from && from > to ? mytDate(now + 86400000) : mytDate(now);
  return atMyt(day, to);
}

/** Approved leave or a public holiday on this MYT day - the person is off. */
export async function offToday(env: Env, userId: number, day: string): Promise<boolean> {
  try {
    const lv = await env.DB.prepare(`SELECT 1 AS x FROM leave_requests WHERE user_id = ?1 AND status = 'approved' AND start_date <= ?2 AND end_date >= ?2 LIMIT 1`).bind(userId, day).first();
    if (lv) return true;
    const h = await env.DB.prepare(`SELECT 1 AS x FROM holidays WHERE holiday_date = ?1 AND COALESCE(kind, 'public') IN ('public', 'replacement') LIMIT 1`).bind(day).first();
    return Boolean(h);
  } catch { return false; }
}

/* ---------------------------------------------------------------- template */

export interface TaskMailData {
  task: { id: number; title: string; priority?: string | null; deadline?: string | null; description?: string | null; status?: string | null; stage?: string | null; progress?: number | null; link_label?: string | null };
  by?: string | null;        // the person who did the thing
  summary?: string | null;   // the update / comment / reason
  next?: string | null;      // next action, when the update carried one
  to: Recipient;
  extra?: string | null;     // a free line (the manual reminder's reason)
}

const NAVY = "#1a2946", GOLD = "#c8a96a", INK = "#14213d", MUTED = "#5b6478";
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const dmy = (iso?: string | null) => (iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10).split("-").reverse().join("-") : null);
const cap = (s?: string | null) => (s ? s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, " ") : "");

const HEADLINE: Record<MailKind, string> = {
  assigned: "New task assigned", moved: "A task was moved to you", update: "Progress update", mention: "You were mentioned",
  review: "Ready for your review", decision: "Your task was reviewed", due: "Deadline reminder", overdue: "Task overdue",
  escalation: "Overdue task in your team", reminder: "Reminder from management", digest: "Your tasks today", test: "Test email",
};
const INTRO: Record<MailKind, (d: TaskMailData) => string> = {
  assigned: (d) => `A new task has been assigned to you in A2Z OS${d.by ? ` by ${d.by}` : ""}.`,
  moved: (d) => `This task is now yours${d.by ? ` (moved by ${d.by})` : ""}. Please acknowledge it in A2Z OS.`,
  update: (d) => `${d.by ?? "A team member"} posted a progress update on a task you are responsible for.`,
  mention: (d) => `${d.by ?? "A colleague"} mentioned you in a comment.`,
  review: (d) => `${d.by ?? "The assignee"} has submitted this task for your review.`,
  decision: (d) => `${d.by ?? "The reviewer"} has reviewed your task.`,
  due: () => "This task is due soon. Please update its progress before the deadline.",
  overdue: () => "This task is past its deadline. Please update it, or ask for help on the task.",
  escalation: (d) => `A task assigned to ${d.by ?? "a member of your team"} is overdue and has had no progress. You are told as their reporting line.`,
  reminder: (d) => `${d.by ?? "Management"} asks you to update this task.`,
  digest: () => "Here is where your work stands this morning.",
  test: () => "This is a test of A2Z OS task emails. If you can read this, the sender is working.",
};

export function buildTaskMail(env: Env, kind: MailKind, d: TaskMailData): { subject: string; text: string; html: string } {
  const origin = primaryOrigin(env);
  const link = kind === "digest" ? `${origin}/portal?tab=Tasks` : `${origin}/portal?tab=Tasks&task=${d.task.id}`;
  const subject = (kind === "digest" ? `[A2Z OS] Your tasks today — ${d.task.title}` : `[A2Z OS] ${HEADLINE[kind]} — ${d.task.title}`).slice(0, 180);
  const rows: [string, string][] = kind === "digest" ? [] : [["Task", d.task.title]];
  if (d.task.link_label) rows.push(["Project", d.task.link_label]);
  if (d.task.priority) rows.push(["Priority", cap(d.task.priority)]);
  if (d.task.deadline) rows.push(["Deadline", dmy(d.task.deadline) ?? d.task.deadline]);
  if (kind === "assigned" && d.by) rows.push(["Assigned by", d.by]);
  if (kind === "moved" && d.by) rows.push(["Moved by", d.by]);
  if ((kind === "update" || kind === "review" || kind === "decision" || kind === "reminder" || kind === "mention") && d.by) rows.push(["By", d.by]);
  if (kind === "update" || kind === "overdue" || kind === "escalation" || kind === "due") {
    const st = [d.task.status ? cap(d.task.status === "in_progress" ? "in progress" : d.task.status) : null, d.task.stage ? cap(d.task.stage) : null].filter(Boolean).join(" · ");
    if (st) rows.push(["Status", st]);
    if (typeof d.task.progress === "number") rows.push(["Progress", `${d.task.progress}%`]);
  }
  if (d.summary) rows.push([kind === "mention" ? "Comment" : kind === "decision" || kind === "reminder" ? "Message" : "Latest update", d.summary.slice(0, 400)]);
  if (d.next) rows.push(["Next action", d.next.slice(0, 200)]);
  if (d.task.description && (kind === "assigned" || kind === "moved")) rows.push(["Description", d.task.description.slice(0, 300)]);
  const intro = INTRO[kind](d);
  const text = [
    `Hello ${d.to.first},`, "", intro, "",
    ...rows.map(([k, v]) => `${k}: ${v}`), "",
    kind === "test" ? "" : "Please review the task and provide progress updates as the work proceeds.",
    `${kind === "digest" ? "Open My Tasks in A2Z OS" : "View the task in A2Z OS"}: ${link}`, "",
    "Regards,", "A2Z Creative Marketing", "hello@a2zcreative.my", "",
    "This is an automated email from A2Z OS. Please do not reply - update the task in A2Z OS instead.",
  ].filter((l, i, a) => !(l === "" && a[i - 1] === "")).join("\n");
  const trs = rows.map(([k, v]) => `<tr><td style="padding:6px 10px 6px 0;color:${MUTED};font-size:13px;white-space:nowrap;vertical-align:top">${esc(k)}</td><td style="padding:6px 0;color:${INK};font-size:14px;font-weight:600;vertical-align:top">${esc(v).replace(/\n/g, "<br>")}</td></tr>`).join("");
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f4f6"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb">
<tr><td style="background:${NAVY};padding:20px 24px"><span style="color:#ffffff;font-size:22px;font-weight:800;letter-spacing:-0.01em">A2Z <span style="color:${GOLD}">OS</span></span><br><span style="color:${GOLD};font-size:11px;letter-spacing:0.14em;text-transform:uppercase">A2Z Creative Marketing</span></td></tr>
<tr><td style="padding:24px">
<h1 style="margin:0 0 12px;font-size:20px;color:${NAVY}">${esc(HEADLINE[kind])}</h1>
<p style="margin:0 0 6px;color:${INK};font-size:15px">Hello ${esc(d.to.first)},</p>
<p style="margin:0 0 16px;color:${INK};font-size:15px;line-height:1.5">${esc(intro)}</p>
<table role="presentation" cellspacing="0" cellpadding="0" style="width:100%;background:#f8f9fb;border:1px solid #e5e7eb;border-radius:10px;padding:10px 14px;margin:0 0 20px"><tr><td><table role="presentation" cellspacing="0" cellpadding="0">${trs}</table></td></tr></table>
${kind === "test" ? "" : `<p style="margin:0 0 20px;color:${MUTED};font-size:13px;line-height:1.5">Please review the task and provide progress updates as the work proceeds.</p>`}
<table role="presentation" cellspacing="0" cellpadding="0"><tr><td style="background:${GOLD};border-radius:8px"><a href="${esc(link)}" style="display:inline-block;padding:12px 22px;color:${NAVY};font-weight:700;font-size:15px;text-decoration:none">${kind === "digest" ? "Open My Tasks in A2Z OS" : "View Task in A2Z OS"} →</a></td></tr></table>
<p style="margin:20px 0 0;color:${MUTED};font-size:12px;line-height:1.5">You can update your progress, add comments and upload files directly in the task.</p>
</td></tr>
<tr><td style="padding:16px 24px;border-top:1px solid #e5e7eb;color:${MUTED};font-size:12px;line-height:1.5"><strong style="color:${INK}">A2Z Creative Marketing</strong> · hello@a2zcreative.my<br>This is an automated email from A2Z OS. Please do not reply - update the task in A2Z OS instead.</td></tr>
</table></td></tr></table></body></html>`;
  return { subject, text, html };
}

/* ---------------------------------------------------------------- queue */

export interface QueueResult { queued: boolean; why: string | null; to?: string }

/** One email for one person, under one ref. Idempotent by ref. Never throws. */
export { sqlTime };
export async function queueTaskMail(
  env: Env, kind: MailKind, userId: number | null | undefined, ref: string, data: Omit<TaskMailData, "to">,
  opts: { createdBy?: number | null; reason?: string | null; urgent?: boolean; settings?: MailSettings; skipCap?: boolean } = {},
): Promise<QueueResult> {
  try {
    if (!mailReady(env)) return { queued: false, why: "sender not configured" };
    const s = opts.settings ?? await readMailSettings(env);
    if (!s.enabled) return { queued: false, why: "task emails are off" };
    if (!s.triggers[kind]) return { queued: false, why: `${kind} emails are off` };
    const { to, why } = await recipientFor(env, userId, kind === "digest" ? "email_digest" : "email_tasks");
    if (!to) return { queued: false, why };
    const dup = await env.DB.prepare(`SELECT id FROM mail_outbox WHERE ref = ?1`).bind(ref).first<{ id: number }>();
    if (dup) return { queued: false, why: "already queued", to: to.email };
    const built = buildTaskMail(env, kind, { ...data, to });
    let status = "queued", lastError: string | null = null;
    /* the cap is for the steady stream (updates, mentions, reviews, reminders
       of deadlines); a new assignment, a reassignment and a management
       reminder (urgent) always go - missing one of those is the failure */
    if (!opts.skipCap && !opts.urgent && kind !== "digest" && kind !== "test") {
      const n = await env.DB.prepare(
        `SELECT COUNT(*) AS n FROM mail_outbox WHERE user_id = ?1 AND kind NOT IN ('digest', 'test') AND status IN ('queued', 'sending', 'accepted', 'failed') AND date(created_at, '+8 hours') = ?2`, // created_at is written from the Worker clock (sqlTime)
      ).bind(to.id, mytDate()).first<{ n: number }>();
      if (Number(n?.n ?? 0) >= s.cap_per_day) { status = "dead"; lastError = `daily cap of ${s.cap_per_day} reached - left for the digest`; }
    }
    const notBefore = status === "queued" && !opts.urgent ? heldUntil(s) : null;
    const ins = await env.DB.prepare(
      `INSERT INTO mail_outbox (user_id, to_email, kind, ref, subject, body_text, body_html, status, last_error, not_before, created_by, reason, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13) ON CONFLICT(ref) DO NOTHING`,
    ).bind(to.id, to.email, kind, ref, built.subject, built.text, built.html, status, lastError, notBefore, opts.createdBy ?? null, opts.reason ?? null, sqlTime()).run();
    const wrote = Number((ins as { meta?: { changes?: number } }).meta?.changes ?? 0) > 0;
    if (!wrote) return { queued: false, why: "already queued", to: to.email };
    return { queued: status === "queued", why: status === "queued" ? null : lastError, to: to.email };
  } catch (e) {
    return { queued: false, why: /no such table/i.test(String(e)) ? "migration 0161 not applied" : "could not queue" };
  }
}

/** The same email to several people (the author excepted), one ref each. */
export async function queueTaskMailTo(
  env: Env, kind: MailKind, ids: (number | null | undefined)[], except: number | null, refBase: string, data: Omit<TaskMailData, "to">, opts: Parameters<typeof queueTaskMail>[5] = {},
): Promise<void> {
  const s = opts.settings ?? await readMailSettings(env);
  for (const id of [...new Set(ids.filter((x): x is number => typeof x === "number" && x !== except))]) {
    await queueTaskMail(env, kind, id, `${refBase}:${id}`, data, { ...opts, settings: s });
  }
}

/** The task row, shaped for the template (never the money on its quotation). */
export async function taskForMail(env: Env, taskId: number | string): Promise<TaskMailData["task"] | null> {
  try {
    const t = await env.DB.prepare(`SELECT id, title, priority, deadline, description, status, progress, link_kind, link_id FROM tasks WHERE id = ?1`).bind(taskId)
      .first<{ id: number; title: string; priority: string | null; deadline: string | null; description: string | null; status: string; progress: number | null; link_kind: string | null; link_id: number | null }>();
    if (!t) return null;
    let stage: string | null = null;
    try { stage = (await env.DB.prepare(`SELECT stage FROM tasks WHERE id = ?1`).bind(taskId).first<{ stage: string | null }>())?.stage ?? null; } catch { /* pre-0159 */ }
    let link_label: string | null = null;
    if (t.link_kind === "project" && t.link_id) {
      try {
        const p = await env.DB.prepare(`SELECT p.title, d.doc_number FROM projects p JOIN sales_documents d ON d.id = p.quotation_id WHERE p.id = ?1`).bind(t.link_id).first<{ title: string; doc_number: string }>();
        if (p) link_label = `${p.title} (${p.doc_number})`;
      } catch { /* pre-0159 */ }
    }
    return { id: t.id, title: t.title, priority: t.priority, deadline: t.deadline, description: t.description, status: t.status, stage, progress: t.progress, link_label };
  } catch { return null; }
}

/* ---------------------------------------------------------------- drain */

/** The five-minute cron: send what is due, retry what failed, give up at three. */
export async function drainMailOutbox(env: Env, limit = 25): Promise<{ sent: number; failed: number; dead: number }> {
  const out = { sent: 0, failed: 0, dead: 0 };
  try {
    /* a row that waited two days (the sender was off, or quiet hours twice over) is stale */
    const exp = await env.DB.prepare(
      `UPDATE mail_outbox SET status = 'dead', last_error = 'expired before it could be sent' WHERE status IN ('queued', 'failed') AND created_at < ?1`,
    ).bind(sqlTime(Date.now() - 2 * 86400000)).run();
    out.dead += Number((exp as { meta?: { changes?: number } }).meta?.changes ?? 0);
    if (!mailReady(env)) return out;
    const { results } = await env.DB.prepare(
      `SELECT id, to_email, subject, body_text, body_html, attempts FROM mail_outbox
        WHERE status IN ('queued', 'failed') AND (not_before IS NULL OR not_before <= ?2) ORDER BY id LIMIT ?1`,
    ).bind(limit, sqlTime()).all<{ id: number; to_email: string; subject: string; body_text: string; body_html: string | null; attempts: number }>();
    for (const r of results ?? []) {
      /* claim it: a second worker on the same tick finds it already 'sending' */
      const claim = await env.DB.prepare(`UPDATE mail_outbox SET status = 'sending', attempts = attempts + 1 WHERE id = ?1 AND status IN ('queued', 'failed')`).bind(r.id).run();
      if (!Number((claim as { meta?: { changes?: number } }).meta?.changes ?? 0)) continue;
      const res = await sendMailResult(env, { to: r.to_email, subject: r.subject, text: r.body_text, html: r.body_html ?? undefined });
      if (res.ok) {
        await env.DB.prepare(`UPDATE mail_outbox SET status = 'accepted', sent_at = ?2, last_error = NULL WHERE id = ?1`).bind(r.id, sqlTime()).run();
        out.sent++;
      } else {
        const attempts = r.attempts + 1;
        if (attempts >= 3) {
          await env.DB.prepare(`UPDATE mail_outbox SET status = 'dead', last_error = ?2 WHERE id = ?1`).bind(r.id, res.error).run();
          out.dead++;
        } else {
          /* 5 min, then 20 min - never a storm */
          const wait = attempts === 1 ? 5 : 20;
          await env.DB.prepare(`UPDATE mail_outbox SET status = 'failed', last_error = ?2, not_before = ?3 WHERE id = ?1`).bind(r.id, res.error, sqlTime(Date.now() + wait * 60000)).run();
          out.failed++;
        }
      }
    }
  } catch { /* pre-0161, or a transient DB error: the next tick tries again */ }
  return out;
}

/* ---------------------------------------------------------------- sweeps */

const PERSON = (a: string) => `COALESCE(NULLIF(TRIM(${a}.full_name), ''), ${a}.name)`;

/** The hourly pass: deadline reminders (lead time), overdue on day 1/3/7, HOD escalation. */
export async function taskMailSweep(env: Env, now = Date.now()): Promise<{ due: number; overdue: number; escalated: number }> {
  const out = { due: 0, overdue: 0, escalated: 0 };
  try {
    if (!mailReady(env)) return out;
    const s = await readMailSettings(env);
    if (!s.enabled) return out;
    const today = mytDate(now);
    const leadDays = Math.max(1, Math.ceil(s.lead_hours / 24));
    const until = mytDate(now + leadDays * 86400000);
    const open = `t.status != 'completed' AND COALESCE(t.stage, '') != 'cancelled' AND EXISTS (SELECT 1 FROM users ua WHERE ua.id = t.assigned_to AND ua.is_active = 1 AND ${currentStaffSql("ua.")})`;
    if (s.triggers.due) {
      const { results } = await env.DB.prepare(
        `SELECT t.id, t.assigned_to, t.deadline FROM tasks t WHERE ${open} AND t.deadline IS NOT NULL AND t.deadline > ?1 AND t.deadline <= ?2
           AND NOT EXISTS (SELECT 1 FROM mail_outbox m WHERE m.ref = 'task:' || t.id || ':due:' || t.deadline || ':' || t.assigned_to) LIMIT 40`,
      ).bind(today, until).all<{ id: number; assigned_to: number; deadline: string }>();
      for (const r of results ?? []) {
        const task = await taskForMail(env, r.id);
        if (!task) continue;
        const q = await queueTaskMail(env, "due", r.assigned_to, `task:${r.id}:due:${r.deadline}:${r.assigned_to}`, { task }, { settings: s });
        if (q.queued) out.due++;
        /* the person is off today: the row waits for the next working morning */
        if (q.queued && await offToday(env, r.assigned_to, today)) {
          await env.DB.prepare(`UPDATE mail_outbox SET not_before = ?2 WHERE ref = ?1`).bind(`task:${r.id}:due:${r.deadline}:${r.assigned_to}`, atMyt(mytDate(now + 86400000), s.quiet_to)).run();
        }
      }
    }
    if (s.triggers.overdue || s.triggers.escalation) {
      const { results } = await env.DB.prepare(
        `SELECT t.id, t.assigned_to, t.deadline, CAST(julianday(?1) - julianday(t.deadline) AS INTEGER) AS days, u.reports_to, ${PERSON("u")} AS who
           FROM tasks t JOIN users u ON u.id = t.assigned_to WHERE ${open} AND t.deadline IS NOT NULL AND t.deadline < ?1 LIMIT 200`,
      ).bind(today).all<{ id: number; assigned_to: number; deadline: string; days: number; reports_to: number | null; who: string }>();
      for (const r of results ?? []) {
        if (s.triggers.overdue && s.overdue_days.includes(r.days)) {
          const task = await taskForMail(env, r.id);
          if (task && (await queueTaskMail(env, "overdue", r.assigned_to, `task:${r.id}:od:${r.days}:${r.assigned_to}`, { task }, { settings: s })).queued) out.overdue++;
        }
        if (s.triggers.escalation && r.days >= s.escalation_days && r.reports_to && r.reports_to !== r.assigned_to) {
          const task = await taskForMail(env, r.id);
          if (task && (await queueTaskMail(env, "escalation", r.reports_to, `task:${r.id}:esc:${r.deadline}:${r.reports_to}`, { task, by: r.who }, { settings: s })).queued) out.escalated++;
        }
        /* no reporting line: nothing is guessed - the overdue row itself says "no HOD" on the log once */
        if (s.triggers.escalation && r.days === s.escalation_days && !r.reports_to) {
          await env.DB.prepare(
            `INSERT INTO mail_outbox (user_id, to_email, kind, ref, subject, body_text, status, last_error) VALUES (?1, '-', 'escalation', ?2, ?3, '', 'dead', 'no reporting line (HOD) set for the assignee - nobody escalated to') ON CONFLICT(ref) DO NOTHING`,
          ).bind(r.assigned_to, `task:${r.id}:esc:${r.deadline}:none`, `[A2Z OS] Task overdue — no HOD to escalate to`).run().catch(() => {});
        }
      }
    }
  } catch { /* never fatal */ }
  return out;
}

/** 08:30 MYT: one summary per person with open work - never empty, never on a day off. */
export async function taskDigest(env: Env, now = Date.now()): Promise<{ sent: number; skipped: number }> {
  const out = { sent: 0, skipped: 0 };
  try {
    if (!mailReady(env)) return out;
    const s = await readMailSettings(env);
    if (!s.enabled || !s.digest_on) return out;
    const today = mytDate(now);
    const soon = mytDate(now + 3 * 86400000);
    const { results: people } = await env.DB.prepare(
      `SELECT DISTINCT u.id FROM users u JOIN tasks t ON t.assigned_to = u.id OR t.created_by = u.id
        WHERE u.is_active = 1 AND ${staffRolesSql("u.")} AND ${currentStaffSql("u.")} AND t.status != 'completed' LIMIT 300`,
    ).all<{ id: number }>();
    for (const p of people ?? []) {
      if (await offToday(env, p.id, today)) { out.skipped++; continue; }
      const mine = (await env.DB.prepare(
        `SELECT id, title, deadline, priority, status, stage FROM tasks t WHERE assigned_to = ?1 AND status != 'completed' AND COALESCE(stage, '') != 'cancelled' ORDER BY COALESCE(deadline, '9999') LIMIT 30`,
      ).bind(p.id).all<{ id: number; title: string; deadline: string | null; priority: string | null; status: string; stage: string | null }>()).results ?? [];
      const review = (await env.DB.prepare(
        `SELECT id, title FROM tasks WHERE created_by = ?1 AND assigned_to != ?1 AND status != 'completed' AND stage = 'review' LIMIT 20`,
      ).bind(p.id).all<{ id: number; title: string }>().catch(() => ({ results: [] as { id: number; title: string }[] }))).results ?? [];
      const overdue = mine.filter((t) => t.deadline && t.deadline < today);
      const due = mine.filter((t) => t.deadline && t.deadline >= today && t.deadline <= soon);
      const blocked = mine.filter((t) => t.stage === "blocked" || t.stage === "waiting_client");
      if (mine.length === 0 && review.length === 0) { out.skipped++; continue; }
      const line = (t: { id: number; title: string; deadline?: string | null }) => `• ${t.title}${t.deadline ? ` (due ${dmy(t.deadline)})` : ""}`;
      const parts: string[] = [];
      if (overdue.length) parts.push(`Overdue (${overdue.length}):\n${overdue.map(line).join("\n")}`);
      if (due.length) parts.push(`Due in the next 3 days (${due.length}):\n${due.map(line).join("\n")}`);
      if (review.length) parts.push(`Waiting for your review (${review.length}):\n${review.map(line).join("\n")}`);
      if (blocked.length) parts.push(`Blocked or waiting for a client (${blocked.length}):\n${blocked.map(line).join("\n")}`);
      parts.push(`Open tasks assigned to you: ${mine.length}`);
      const summary = parts.join("\n\n");
      const q = await queueTaskMail(env, "digest", p.id, `digest:${p.id}:${today}`, { task: { id: mine[0]?.id ?? review[0]?.id ?? 0, title: `${mine.length} open task${mine.length === 1 ? "" : "s"}` }, summary }, { settings: s, urgent: true });
      if (q.queued) out.sent++; else out.skipped++;
    }
  } catch { /* never fatal */ }
  return out;
}
