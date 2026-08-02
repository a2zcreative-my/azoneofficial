/**
 * Staff Portal API (/api/v1/staff/*) — see 0003_staff_portal.sql
 * Mounted from index.ts after session resolution. All routes require auth.
 */

import type { Env } from "./index";
import { createPasswordHash } from "./index";

type Role =
  | "super_admin" | "admin"
  | "editor" | "marketing" | "live_host"
  | "hr_admin" | "sales_marketing"
  | "ceo" | "coo" | "cco";

export interface StaffUser {
  id: number;
  email: string;
  name: string;
  role: Role;
}

/* ---------------- module permissions ---------------- */

const PERMS: Record<string, readonly Role[]> = {
  // Approve leave / view attendance / manage staff / birthdays.
  // COO & CCO are HR-level in this model, alongside hr_admin.
  // v1.4.34 rank rework: the CEO (higher rank) EDITS staff/HR data; COO and
  // CCO read. Their read access flows through exec_view; the leave approval
  // chain (COO/CCO pre-approve) is a workflow role and stays unchanged.
  hr_manage: ["super_admin", "admin", "hr_admin", "ceo"],
  // Post announcements & create/assign tasks.
  team_manage: ["super_admin", "admin", "hr_admin", "coo", "cco"],
  // Company events (training / classes / meetings) — v1.4.73. CEO included:
  // the boss schedules trainings. Everyone can VIEW; these roles manage.
  events_manage: ["super_admin", "admin", "hr_admin", "ceo", "coo", "cco"],
  // Expense claims (v1.4.75) — per the CEO's spec: CEO, COO, CCO and HR
  // submit; EVERY decision is the CEO's alone (super_admin only as the
  // system-recovery fallback, admin deliberately excluded).
  claims_submit: ["super_admin", "admin", "hr_admin", "ceo", "coo", "cco", "sales_marketing", "editor", "marketing", "live_host"], // v1.4.106: every staff role claims
  claims_decide: ["super_admin", "ceo"],
  // Sales revenue dashboard (v1.4.75) — per the CEO's list.
  revenue_view: ["super_admin", "admin", "ceo", "coo", "cco", "sales_marketing", "marketing", "hr_admin"],
  // Company expenses (v1.4.87) — CEO and COO per the CEO's spec.
  expenses: ["super_admin", "admin", "ceo", "coo"],
  // Documentation: quotations / delivery orders / invoices (QT, DO, INV).
  sales: ["super_admin", "admin", "hr_admin", "coo", "cco", "ceo", "sales_marketing"],
  // Invoice finance status changes.
  // v1.4.96: ceo added — the CEO was hitting "Insufficient rights" creating
  // invoices because finance omitted him while the UI offered the option.
  // v1.4.97: sales_marketing added on the CEO's instruction — they insert
  // sales including invoices; the printed authorised signature auto-falls
  // back to the CEO for non-CEO/COO creators.
  finance: ["super_admin", "admin", "hr_admin", "coo", "cco", "ceo", "sales_marketing"],
  // HR task reports (daily / weekly / monthly).
  task_reports: ["super_admin", "admin", "hr_admin", "coo", "cco"],
  // Inventory, postage tracking, marketing materials — sales_marketing only
  // among staff (editor/marketing explicitly do NOT get inventory visibility).
  inventory: ["super_admin", "admin", "ceo", "coo", "cco", "sales_marketing", "marketing", "hr_admin"],
  // Read tasks across all roles (management oversight), excluding CEO exec data.
  task_view: ["super_admin", "admin", "coo", "cco"],
  // Attendance CSV export for payroll processing.
  payroll_export: ["super_admin", "admin", "hr_admin", "ceo", "coo", "cco"],
  // Read-only visibility across every module (CEO review & monitoring) — no
  // write. Leave decisions and suspensions stay with the admin tier.
  exec_view: ["super_admin", "admin", "ceo", "coo", "cco"],
};

const POSTAGE_STATUSES = ["preparing", "shipped", "in_transit", "delivered", "returned"];
const BD_STATUSES = ["open", "pending", "kiv", "closed_won", "closed_lost"];

function stockStatus(stock: number): string {
  return stock === 0 ? "out_of_stock" : stock <= 5 ? "low" : "in_stock";
}

/** Company working shift (Malaysia time). Used to flag attendance events. */
const SHIFT = {
  label: "10:00–18:00 MYT, Monday–Friday",
  startMinutes: 10 * 60,
  // Arriving after 12:00 counts the day as a half day (v1.4.38).
  halfDayMinutes: 12 * 60,
  endMinutes: 18 * 60,
} as const;

function can(user: StaffUser, perm: keyof typeof PERMS): boolean {
  return PERMS[perm]!.includes(user.role);
}

/* ---------------- helpers ---------------- */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
function err(code: string, message: string, status: number): Response {
  return json({ error: { code, message } }, status);
}
function str(v: unknown, max = 2000): v is string {
  return typeof v === "string" && v.trim().length > 0 && v.length <= max;
}

async function notify(
  env: Env, userId: number, kind: string, message: string, ref?: string,
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO notifications (user_id, kind, message, ref) VALUES (?1, ?2, ?3, ?4)`,
  ).bind(userId, kind, message, ref ?? null).run();

  // Off-platform delivery (email / WhatsApp relay). Only fires when a webhook
  // is configured; otherwise this is a no-op and notifications stay in-app.
  // The relay decides the channel; we just hand it who + what.
  const hook = (env as unknown as { NOTIFY_WEBHOOK?: string }).NOTIFY_WEBHOOK;
  if (hook) {
    try {
      const target = await env.DB.prepare(
        `SELECT email, phone, name FROM users WHERE id = ?1`,
      ).bind(userId).first<{ email: string; phone: string | null; name: string }>();
      if (target) {
        // Fire-and-forget: a slow relay must never block the request.
        await fetch(hook, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind, message, ref, to: target }),
        }).catch(() => {});
      }
    } catch {
      /* delivery is best-effort; in-app record already saved */
    }
  }
}

async function audit(
  env: Env, userId: number, action: string, entity?: string, entityId?: string,
  detail?: Record<string, unknown>,
): Promise<void> {
  // detail lands in audit_log.detail as JSON — quantities, roles, reasons.
  // Never fatal (v1.4.69): the trail records actions, it must not break them.
  try {
    await env.DB.prepare(
      `INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?1, ?2, ?3, ?4, ?5)`,
    ).bind(userId, action, entity ?? null, entityId ?? null,
           detail ? JSON.stringify(detail) : null).run();
  } catch (e) {
    console.error("audit write failed:", action, e);
    // v1.4.72: surface it in the error log too (table has no FKs; guarded).
    try {
      await env.DB.prepare(
        `INSERT INTO error_log (source, message) VALUES ('audit', ?1)`,
      ).bind(`${action}: ${e instanceof Error ? e.message : String(e)}`.slice(0, 500)).run();
    } catch { /* pre-0024 or DB down — console above is the fallback */ }
  }
}

/** v1.4.114: non-fatal error-log writer for this module (index.ts has its own). */
async function logError(env: Env, source: string, message: string): Promise<void> {
  try {
    await env.DB.prepare(
      `INSERT INTO error_log (source, message) VALUES (?1, ?2)`,
    ).bind(source, message.slice(0, 500)).run();
  } catch (e) {
    console.error("error_log write failed:", source, message, e);
  }
}

const LEAVE_TYPES = ["annual", "medical", "emergency", "unpaid", "replacement"] as const;
const DEFAULT_ENTITLEMENT: Record<string, number> = { annual: 14, medical: 14, emergency: 3, replacement: 0, unpaid: 0 };

/**
 * Document numbers (v1.4.4): {TYPE}-AZOO{DDMMYY}-{X}, e.g. QT-AZOO300726-1.
 * X is the running number for that document type on that day (no padding, per
 * the format the business specified). Previous format {TYPE}{YYYYMMDD}-{NN}-AZOO
 * (v1.2.7) remains valid on documents already issued — numbers are never
 * reissued or rewritten.
 * Daily counter per type (Asia/Kuala_Lumpur); widens past 99/day automatically.
 * Legacy numbers (QT202600001) issued before v1.2.7 remain valid — never renumbered.
 * Spec: DOCUMENT-NUMBERING.md
 */
function todayKL(): string {
  const now = new Date(Date.now() + 8 * 60 * 60 * 1000); // UTC+8, no DST
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

async function docNumber(env: Env, docType: "QT" | "DO" | "INV"): Promise<string> {
  // Malaysia time (UTC+8) decides which business day the number belongs to
  const now = new Date(Date.now() + 8 * 3600 * 1000);
  const day = now.toISOString().slice(0, 10).replace(/-/g, ""); // YYYYMMDD (counter key)
  const dd = day.slice(6, 8);
  const mm = day.slice(4, 6);
  const yy = day.slice(2, 4);
  await env.DB.prepare(
    `INSERT INTO doc_counters_daily (doc_type, day, counter) VALUES (?1, ?2, 1)
     ON CONFLICT(doc_type, day) DO UPDATE SET counter = counter + 1`,
  ).bind(docType, day).run();
  const row = await env.DB.prepare(
    `SELECT counter FROM doc_counters_daily WHERE doc_type = ?1 AND day = ?2`,
  ).bind(docType, day).first<{ counter: number }>();
  return `${docType}-AZOO${dd}${mm}${yy}-${row?.counter ?? 1}`;
}

/* ---------------- router ---------------- */

/* ---------------- leave approval chain ---------------- */
//
// Staff route:   applied -> hr_reviewed -> pre_approved -> approved
// COO/CCO route: applied -> hr_reviewed ->               -> approved
//                (they skip pre-approval — no one pre-approves their own tier)
// Reject at any active stage is terminal.

const HR_STAGE_ROLES: readonly Role[] = ["super_admin", "admin", "hr_admin"];
const PREAPP_ROLES: readonly Role[] = ["super_admin", "admin", "coo", "cco"];
const FINAL_ROLES: readonly Role[] = ["super_admin", "admin", "ceo"];

function leaveNextStage(stage: string, applicantRole: string): string {
  if (stage === "applied") return "hr_reviewed";
  if (stage === "hr_reviewed") {
    // COO/CCO applicants skip pre-approval and go straight to final.
    return applicantRole === "coo" || applicantRole === "cco" ? "pending_final" : "pre_approved";
  }
  return "approved"; // pre_approved or pending_final -> final approval
}

function leaveCanActAt(
  user: StaffUser,
  stage: string,
  applicantRole: string,
  applicantId: number,
): boolean {
  // No one reviews their own request at any stage.
  if (user.id === applicantId) return false;
  if (stage === "applied") return HR_STAGE_ROLES.includes(user.role);
  if (stage === "hr_reviewed") {
    // COO/CCO applicants go straight to CEO; staff need COO/CCO pre-approval.
    return applicantRole === "coo" || applicantRole === "cco"
      ? FINAL_ROLES.includes(user.role)
      : PREAPP_ROLES.includes(user.role);
  }
  if (stage === "pre_approved" || stage === "pending_final") return FINAL_ROLES.includes(user.role);
  return false; // approved / rejected / cancelled are terminal
}

function leaveStageLabel(stage: string): string {
  return ({
    applied: "applied",
    hr_reviewed: "HR review done",
    pre_approved: "pre-approved (COO/CCO)",
    pending_final: "awaiting CEO",
    approved: "approved",
    rejected: "rejected",
    cancelled: "cancelled",
  } as Record<string, string>)[stage] ?? stage;
}

export async function handleStaff(
  request: Request,
  env: Env,
  path: string, // already stripped of /api/v1/staff prefix, starts with /
  user: StaffUser,
): Promise<Response | null> {
  const method = request.method;
  // The photo route carries a binary body — JSON-parsing it would consume the
  // stream, so it is excluded here and reads request.body directly.
  // v1.4.115: /receipt carries a binary body exactly like /photo — JSON-parsing
  // it consumed the stream, which is why every claim receipt upload failed
  // (the R2 put received a disturbed body). Both binary routes are excluded.
  const body =
    ["POST", "PUT", "PATCH"].includes(method) && !path.endsWith("/photo") && !path.endsWith("/receipt") && !path.endsWith("/payment-proof")
      ? ((await request.json().catch(() => null)) as Record<string, unknown> | null)
      : null;

  /* ---- me / profile ---- */

  if (path === "/profile" && method === "GET") {
    const row = await env.DB.prepare(
      `SELECT id, email, name, role, employee_id, position, department, phone, employment_status
       FROM users WHERE id = ?1`,
    ).bind(user.id).first();
    return json({ profile: row });
  }
  if (path === "/profile" && method === "PATCH") {
    // staff may update their own phone + name only
    const sets: string[] = [];
    const vals: (string | number)[] = [];
    if (typeof body?.phone === "string" && body.phone.length <= 40) {
      sets.push(`phone = ?${sets.length + 1}`);
      vals.push(body.phone.trim() || null);
    }
    if (typeof body?.name === "string" && body.name.trim().length > 0 && body.name.length <= 120) {
      sets.push(`name = ?${sets.length + 1}`);
      vals.push(body.name.trim());
    }
    if (sets.length === 0) return err("invalid_input", "Nothing to update", 400);
    await env.DB.prepare(`UPDATE users SET ${sets.join(", ")} WHERE id = ?${sets.length + 1}`)
      .bind(...vals, user.id).run();
    await audit(env, user.id, "staff.profile_update");
    return json({ ok: true });
  }

  /* ---- staff directory (managers) ---- */

  if (path === "/users" && method === "POST") {
    // HR-scoped staff creation. Deliberately cannot mint admin/super_admin/
    // customer — those stay in /admin. HR onboards staff-level roles only.
    if (!can(user, "hr_manage")) return err("forbidden", "HR access required", 403);
    const STAFF_ROLES = ["editor", "marketing", "live_host", "hr_admin", "sales_marketing", "ceo", "coo", "cco"];
    if (
      !body || !str(body.email, 200) || !str(body.name, 120) ||
      !str(body.password, 200) || (body.password as string).length < 10 ||
      typeof body.role !== "string" || !STAFF_ROLES.includes(body.role)
    ) {
      return err("invalid_input", "email, name, a staff role, and a 10+ character password are required", 400);
    }
    const email = (body.email as string).toLowerCase().trim();
    // Domain policy (v1.4.42): staff roles require a company email —
    // personal emails (gmail etc.) belong to customer accounts.
    if (!email.endsWith(`@${env.COMPANY_DOMAIN.toLowerCase()}`)) {
      return err("domain_policy", `Staff roles require an @${env.COMPANY_DOMAIN} email — personal emails stay as customer accounts`, 400);
    }
    const existing = await env.DB.prepare(`SELECT id FROM users WHERE email = ?1`)
      .bind(email).first<{ id: number }>();
    if (existing) return err("email_exists", "A user with this email already exists", 409);
    const hash = await createPasswordHash(body.password as string, env.SESSION_PEPPER);
    try {
      const res = await env.DB.prepare(
        `INSERT INTO users (email, password_hash, name, role, employee_id, position, department, birthday, id_issued_on, blood_type, bank_name, bank_account, ic_number)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13) RETURNING id`,
      ).bind(
        email, hash, (body.name as string).trim(), body.role,
        str(body.employee_id, 60) ? body.employee_id : null,
        str(body.position, 120) ? body.position : null,
        str(body.department, 120) ? body.department : null,
        str(body.birthday, 10) ? body.birthday : null,
        str(body.id_issued_on, 10) ? body.id_issued_on : null,
        str(body.blood_type, 5) ? body.blood_type : null,
        str(body.bank_name, 60) ? body.bank_name : null,
        str(body.bank_account, 40) ? body.bank_account : null,
        str(body.ic_number, 20) ? body.ic_number : null,
      ).first<{ id: number }>();
      await audit(env, user.id, "staff.create", "users", String(res?.id), { role: body.role });
      return json({ id: res?.id }, 201);
    } catch {
      return err("db_constraint", "The database rejected this staff account — check the role and try again", 500);
    }
  }

  const photoMatch = path.match(/^\/users\/(\d+)\/photo$/);
  if (photoMatch && method === "POST") {
    if (!can(user, "hr_manage")) return err("forbidden", "HR access required", 403);
    const id = photoMatch[1]!;
    const target = await env.DB.prepare(`SELECT photo_key FROM users WHERE id = ?1`)
      .bind(id).first<{ photo_key: string | null }>();
    if (!target) return err("not_found", "Staff not found", 404);
    // Same amendment policy as the record fields: HR sets the first photo,
    // replacing an existing one is admin/CEO-only.
    const adminTier = user.role === "super_admin" || user.role === "admin" || user.role === "ceo";
    if (target.photo_key && !adminTier) {
      return err("locked", "A photo is already set — replacements need an admin (/admin → Staff).", 403);
    }
    if (!request.body) return err("invalid_input", "Image body required", 400);
    const ct = request.headers.get("Content-Type") ?? "";
    if (!ct.startsWith("image/")) return err("invalid_input", "Upload must be an image", 400);
    const ext = ct.includes("png") ? "png" : ct.includes("webp") ? "webp" : "jpg";
    // private/ prefix: serving requires staff auth (badge preview/print run signed in)
    const key = `private/staff-photos/${id}-${Date.now()}.${ext}`;
    await env.MEDIA.put(key, request.body, { httpMetadata: { contentType: ct } });
    await env.DB.prepare(`UPDATE users SET photo_key = ?1 WHERE id = ?2`).bind(key, id).run();
    await audit(env, user.id, "staff.photo", "users", id);
    return json({ photo_key: key, url: `/api/v1/media/file/${encodeURIComponent(key)}` }, 201);
  }

  if (path === "/birthdays-lite" && method === "GET") {
    // v1.4.101: name + birthday only, for the calendar and dashboard —
    // available to every staff role, nothing sensitive.
    const { results } = await env.DB.prepare(
      `SELECT name, birthday FROM users
       WHERE is_active = 1 AND role NOT IN ('customer', 'super_admin', 'admin') AND birthday IS NOT NULL`,
    ).all();
    return json({ birthdays: results });
  }
  if (path === "/staff-list" && method === "GET") {
    // v1.4.93: minimal staff list (id, name, role) for pickers like the
    // Sales-person dropdown — available to every staff role, exposes nothing
    // sensitive (no phone/IC/bank/salary).
    const { results } = await env.DB.prepare(
      `SELECT id, name, role FROM users
       WHERE is_active = 1 AND role NOT IN ('customer', 'super_admin', 'admin')
       ORDER BY name`,
    ).all();
    return json({ staff: results });
  }
  if (path === "/users" && method === "GET") {
    // hr_manage writes; exec_view (CEO) reads — the Birthdays tab and the
    // Overview need the staff list even for read-only executives.
    if (!can(user, "hr_manage") && !can(user, "exec_view")) {
      return err("forbidden", "HR access required", 403);
    }
    const { results } = await env.DB.prepare(
      `SELECT id, name, full_name, email, role, employee_id, position, department, phone, employment_status, is_active, id_issued_on, birthday, blood_type, photo_key, bank_name, bank_account, joined_on, ic_number, left_on, rejoined_on
       FROM users ORDER BY name`,
    ).all();
    return json({ users: results, staff: results });
  }
  const staffUser = path.match(/^\/users\/(\d+)$/);
  if (staffUser && method === "PATCH") {
    // hr_admin/coo/cco/admin tier manage staff fields. CEO is read-only
    // everywhere EXCEPT staff birthdays, which policy lets the CEO maintain.
    const onlyBirthday = body && Object.keys(body).length > 0 &&
      Object.keys(body).every((k) => k === "birthday");
    const allowed = can(user, "hr_manage") || (onlyBirthday && user.role === "ceo");
    if (!allowed) return err("forbidden", "HR access required", 403);
    const id = staffUser[1]!;
    // Amendment policy (v1.4.22): HR may FILL a field that is still empty;
    // once a value is saved it locks, and changing it needs an admin. This
    // keeps records stable — corrections go through /admin deliberately.
    const adminTier = user.role === "super_admin" || user.role === "admin" || user.role === "ceo";
    // Validate up front so a bad value is a clear 400, never a DB 500.
    const STATUSES = ["permanent", "contract", "part_time", "probation", "resigned", "terminated"];
    if (typeof body?.employment_status === "string" && body.employment_status !== "" &&
        !STATUSES.includes(body.employment_status)) {
      return err("invalid_input", `employment_status must be one of: ${STATUSES.join(", ")}`, 400);
    }
    const fields = ["employee_id", "position", "department", "employment_status", "birthday", "id_issued_on", "full_name", "phone", "blood_type", "bank_name", "bank_account", "joined_on", "ic_number", "left_on", "rejoined_on"] as const;
    const current = await env.DB.prepare(
      `SELECT employee_id, position, department, employment_status, birthday, id_issued_on, full_name, phone, blood_type
       FROM users WHERE id = ?1`,
    ).bind(id).first<Record<string, string | null>>();
    if (!current) return err("not_found", "Staff not found", 404);
    const sets: string[] = [];
    const vals: string[] = [];
    const locked: string[] = [];
    for (const f of fields) {
      if (!str(body?.[f], 200)) continue;
      const incoming = (body![f] as string).trim();
      const existing = (current[f] ?? "").trim();
      if (existing && existing !== incoming && !adminTier) {
        locked.push(f);
        continue;
      }
      sets.push(`${f} = ?${sets.length + 1}`);
      vals.push(incoming);
    }
    if (locked.length > 0) {
      return err(
        "locked",
        `Already set and locked: ${locked.join(", ")}. Amendments need an admin (/admin → Staff).`,
        403,
      );
    }
    if (sets.length === 0) return err("invalid_input", "Nothing to update", 400);
    await env.DB.prepare(`UPDATE users SET ${sets.join(", ")} WHERE id = ?${sets.length + 1}`)
      .bind(...vals, id).run();
    await audit(env, user.id, "staff.hr_update", "users", id);
    return json({ ok: true });
  }

  /* ---- attendance ---- */

  if (path === "/attendance" && method === "POST") {
    // Lunch is not monitored — only clock_in and clock_out exist now.
    const types = ["clock_in", "clock_out"];
    if (!body || typeof body.type !== "string" || !types.includes(body.type)) {
      return err("invalid_input", `type must be one of: ${types.join(", ")}`, 400);
    }
    // One clock-in and one clock-out per day (v1.4.29). Enforced here, not
    // just in the UI — a double-click or stale tab can't duplicate a punch.
    const todayMYT = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
    const dup = await env.DB.prepare(
      `SELECT id, created_at FROM attendance_records
       WHERE user_id = ?1 AND type = ?2 AND date(created_at, '+8 hours') = ?3 LIMIT 1`,
    ).bind(user.id, body.type, todayMYT).first<{ id: number; created_at: string }>();
    // v1.4.113 (CEO's rule): the flow is clock IN first, then clock OUT.
    // A clock-out without today's clock-in is refused with a clear message —
    // enforced here, not just in the UI.
    if (body.type === "clock_out") {
      const inRow = await env.DB.prepare(
        `SELECT id FROM attendance_records
         WHERE user_id = ?1 AND type = 'clock_in' AND date(created_at, '+8 hours') = ?2 LIMIT 1`,
      ).bind(user.id, todayMYT).first<{ id: number }>();
      if (!inRow) {
        return json(
          { error: { code: "no_clock_in", message: "You haven't clocked in today — clock in first, then clock out at the end of your shift." } },
          400,
        );
      }
    }
    if (dup) {
      // Tell them WHEN they punched, so the confirmation is useful rather
      // than just a refusal. Time returned in Malaysia time.
      const at = new Date(new Date(dup.created_at.replace(" ", "T") + "Z").getTime() + 8 * 3600 * 1000)
        .toISOString().slice(11, 16);
      return json(
        {
          error: {
            code: "already_punched",
            message: body.type === "clock_in"
              ? `You already clocked in today at ${at} MYT.`
              : `You already clocked out today at ${at} MYT.`,
          },
          already: true,
          at,
        },
        409,
      );
    }
    // Classify against the shift in Malaysia time, so the record already carries
    // the payroll meaning (v1.4.38 thresholds):
    //   clock_in : <=10:00 ok · 10:01–12:00 late · after 12:00 half_day
    //   clock_out: before 18:00 early_out · >=18:00 completed
    const myt = new Date(Date.now() + 8 * 3600 * 1000);
    const mins = myt.getUTCHours() * 60 + myt.getUTCMinutes();
    let flag: string;
    if (body.type === "clock_in") {
      flag = mins <= 10 * 60 ? "ok" : mins <= 12 * 60 ? "late" : "half_day";
    } else {
      flag = mins < 18 * 60 ? "early_out" : "completed";
    }
    await env.DB.prepare(
      `INSERT INTO attendance_records (user_id, type, ip, user_agent, gps)
       VALUES (?1, ?2, ?3, ?4, ?5)`,
    ).bind(
      user.id,
      body.type,
      request.headers.get("CF-Connecting-IP"),
      (request.headers.get("User-Agent") ?? "").slice(0, 300),
      // Store the computed flag in the gps column's place would be wrong; keep
      // gps as-is and return the flag so the UI can confirm it to the user.
      str(body.gps, 100) ? body.gps : null,
    ).run();
    return json({ ok: true, flag }, 201);
  }

  if (path === "/attendance" && method === "GET") {
    const url = new URL(request.url);
    const month = url.searchParams.get("month") ?? new Date().toISOString().slice(0, 7);
    const targetUser = url.searchParams.get("user_id");
    const forUser = targetUser && can(user, "hr_manage") ? Number(targetUser) : user.id;
    const { results } = await env.DB.prepare(
      `SELECT type, ip, created_at FROM attendance_records
       WHERE user_id = ?1 AND created_at LIKE ?2 || '%'
       ORDER BY created_at DESC LIMIT 400`,
    ).bind(forUser, month).all();
    return json({ month, records: results });
  }

  if (path === "/attendance/report" && method === "GET") {
    // HR + CEO manage; COO/CCO (exec_view) read.
    if (!can(user, "hr_manage") && !can(user, "exec_view")) {
      return err("forbidden", "HR access required", 403);
    }
    const url = new URL(request.url);
    const month = url.searchParams.get("month") ?? new Date().toISOString().slice(0, 7);
    const { results } = await env.DB.prepare(
      `SELECT a.id, u.name, u.email, a.user_id, a.type, a.created_at, a.manual_by, a.amended_by
       FROM attendance_records a JOIN users u ON u.id = a.user_id
       WHERE a.created_at LIKE ?1 || '%' ORDER BY a.created_at`,
    ).bind(month).all();
    // Working shift: 10:00–18:00 Malaysia time, Monday–Friday. Timestamps are
    // stored UTC; annotate each event against the shift so HR verifies at a
    // glance instead of doing timezone arithmetic per row.
    const annotated = (results as { created_at: string; type: string }[]).map((r) => {
      const myt = new Date(new Date(r.created_at + "Z").getTime() + 8 * 3600 * 1000);
      const dayIdx = myt.getUTCDay(); // after +8h shift this is the MYT weekday
      const minutes = myt.getUTCHours() * 60 + myt.getUTCMinutes();
      const workday = dayIdx >= 1 && dayIdx <= 5;
      return {
        ...r,
        myt_time: myt.toISOString().slice(0, 16).replace("T", " "),
        workday,
        // Same thresholds as the punch classifier (v1.4.38) so HR's table and
        // the staff member's confirmation never disagree.
        flag:
          !workday ? "weekend"
          : r.type === "clock_in"
            ? (minutes <= SHIFT.startMinutes ? "ok" : minutes <= SHIFT.halfDayMinutes ? "late" : "half_day")
            : (minutes < SHIFT.endMinutes ? "early_out" : "ok"),
      };
    });
    return json({ month, shift: SHIFT.label, records: annotated });
  }

  /* ---- leave ---- */

  if (path === "/leave" && method === "POST") {
    if (
      !body || typeof body.type !== "string" || !LEAVE_TYPES.includes(body.type as never) ||
      !str(body.start_date, 10) || !str(body.end_date, 10) ||
      typeof body.days !== "number" || body.days <= 0 || body.days > 60
    ) {
      return err("invalid_input", "type, start_date, end_date, and days are required", 400);
    }
    const res = await env.DB.prepare(
      `INSERT INTO leave_requests (user_id, type, start_date, end_date, days, reason, mc_media_id)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) RETURNING id`,
    ).bind(
      user.id, body.type, body.start_date, body.end_date, body.days,
      str(body.reason, 1000) ? body.reason : null,
      typeof body.mc_media_id === "number" ? body.mc_media_id : null,
    ).first<{ id: number }>();
    await audit(env, user.id, "leave.apply", "leave_requests", String(res?.id));
    return json({ id: res?.id }, 201);
  }

  if (path === "/leave" && method === "GET") {
    const url = new URL(request.url);
    const all = url.searchParams.get("all") === "1" && can(user, "hr_manage");
    const { results } = await env.DB.prepare(
      all
        ? `SELECT l.*, u.name AS user_name, u.role AS applicant_role FROM leave_requests l JOIN users u ON u.id = l.user_id ORDER BY l.created_at DESC LIMIT 200`
        : `SELECT * FROM leave_requests WHERE user_id = ?1 ORDER BY created_at DESC LIMIT 100`,
    ).bind(...(all ? [] : [user.id])).all();
    return json({ leave: results });
  }

  if (path === "/leave/balance" && method === "GET") {
    const year = new Date().getFullYear();
    // Monthly release (v1.4.30): entitlement accrues pro-rata over the
    // months the company actually operates in the year. AZ ONE started
    // 20 Jul 2026, so 2026 divides the annual entitlement across Jul–Dec
    // (6 months): 14 AL/year → ~2.0 eligible by end of July, 4.5 by end of
    // August … full 14 by December. From 2027 the window is the normal
    // Jan–Dec twelve months. Half-day steps.
    const COMPANY_START = { year: 2026, month: 7 };
    const monthMYT = new Date(Date.now() + 8 * 3600 * 1000).getUTCMonth() + 1;
    const windowStart = year === COMPANY_START.year ? COMPANY_START.month : 1;
    const monthsTotal = 12 - windowStart + 1;
    const monthsElapsed = Math.min(Math.max(monthMYT - windowStart + 1, 0), monthsTotal);
    const balances: Record<string, { entitled: number; used: number; accrued: number }> = {};
    for (const t of LEAVE_TYPES) {
      const ent = await env.DB.prepare(
        `SELECT entitled FROM leave_balances WHERE user_id = ?1 AND year = ?2 AND type = ?3`,
      ).bind(user.id, year, t).first<{ entitled: number }>();
      const used = await env.DB.prepare(
        `SELECT COALESCE(SUM(days), 0) AS used FROM leave_requests
         WHERE user_id = ?1 AND type = ?2 AND status = 'approved'
         AND start_date LIKE ?3 || '%'`,
      ).bind(user.id, t, String(year)).first<{ used: number }>();
      const entitled = ent?.entitled ?? DEFAULT_ENTITLEMENT[t] ?? 0;
      // Medical (sick) leave is a statutory entitlement under Malaysia's
      // Employment Act — fully available from day one, never pro-rated.
      // Unpaid leave is also never pro-rated: it costs the company nothing,
      // so whatever total is entitled is eligible in full.
      const accrued = t === "medical" || t === "unpaid"
        ? entitled
        : Math.floor(((entitled * monthsElapsed) / monthsTotal) * 2) / 2;
      balances[t] = { entitled, used: used?.used ?? 0, accrued };
    }
    return json({ year, month: monthMYT, balances });
  }

  const leaveMatch = path.match(/^\/leave\/(\d+)$/);
  if (leaveMatch && method === "PATCH") {
    const id = leaveMatch[1]!;
    const row = await env.DB.prepare(
      `SELECT l.user_id, l.stage, u.role AS applicant_role
       FROM leave_requests l JOIN users u ON u.id = l.user_id WHERE l.id = ?1`,
    ).bind(id).first<{ user_id: number; stage: string; applicant_role: string }>();
    if (!row) return err("not_found", "Leave request not found", 404);

    const action = body?.action;
    const comment = str(body?.comment, 500) ? (body!.comment as string) : null;

    // Owner may cancel while the request is still moving.
    if (action === "cancel") {
      if (row.user_id !== user.id) return err("forbidden", "Not your request", 403);
      if (["approved", "rejected", "cancelled"].includes(row.stage)) {
        return err("invalid_input", "This request is already closed", 400);
      }
      await env.DB.prepare(`UPDATE leave_requests SET stage = 'cancelled', status = 'cancelled' WHERE id = ?1`).bind(id).run();
      return json({ ok: true });
    }

    // Reject at any active stage ends the request.
    if (action === "reject") {
      if (!leaveCanActAt(user, row.stage, row.applicant_role, row.user_id)) {
        return err("forbidden", "You cannot act on this request at its current stage", 403);
      }
      await env.DB.prepare(
        `UPDATE leave_requests SET stage = 'rejected', status = 'rejected',
           review_comment = ?2, final_by = ?3, final_at = datetime('now') WHERE id = ?1`,
      ).bind(id, comment, user.id).run();
      await notify(env, row.user_id, "leave", `Your leave request #${id} was rejected`, `leave:${id}`);
      await audit(env, user.id, "leave.reject", "leave_requests", id);
      return json({ ok: true });
    }

    // Approve advances one stage along the applicant's chain.
    if (action === "approve") {
      if (!leaveCanActAt(user, row.stage, row.applicant_role, row.user_id)) {
        return err("forbidden", "You cannot approve this request at its current stage", 403);
      }
      const next = leaveNextStage(row.stage, row.applicant_role);
      const done = next === "approved";
      const col =
        row.stage === "applied" ? "hr_by = ?3, hr_at = datetime('now')"
        : row.stage === "hr_reviewed" ? "preapp_by = ?3, preapp_at = datetime('now')"
        : "final_by = ?3, final_at = datetime('now')";
      await env.DB.prepare(
        `UPDATE leave_requests SET stage = ?2, status = ?4, review_comment = COALESCE(?5, review_comment), ${col} WHERE id = ?1`,
      ).bind(id, next, user.id, done ? "approved" : "pending", comment).run();
      await notify(
        env, row.user_id, "leave",
        done ? `Your leave request #${id} is fully approved`
             : `Your leave request #${id} advanced to ${leaveStageLabel(next)}`,
        `leave:${id}`,
      );
      await audit(env, user.id, `leave.advance.${next}`, "leave_requests", id);
      return json({ ok: true, stage: next });
    }
    return err("invalid_input", "action must be cancel, approve, or reject", 400);
  }

  /* ---- announcements ---- */

  if (path === "/announcements" && method === "GET") {
    const { results } = await env.DB.prepare(
      `SELECT a.*, (SELECT COUNT(*) FROM announcement_acks k
                    WHERE k.announcement_id = a.id AND k.user_id = ?1) AS acked
       FROM announcements a ORDER BY a.created_at DESC LIMIT 50`,
    ).bind(user.id).all();
    return json({ announcements: results });
  }
  if (path === "/announcements" && method === "POST") {
    if (!can(user, "team_manage")) return err("forbidden", "Management access required", 403);
    if (!body || !str(body.title, 200) || !str(body.body, 5000)) {
      return err("invalid_input", "title and body are required", 400);
    }
    const cats = ["news", "meeting", "holiday", "kpi", "training"];
    const category = typeof body.category === "string" && cats.includes(body.category) ? body.category : "news";
    const res = await env.DB.prepare(
      `INSERT INTO announcements (title, body, category, created_by) VALUES (?1, ?2, ?3, ?4) RETURNING id`,
    ).bind(body.title, body.body, category, user.id).first<{ id: number }>();
    // Ring the bell: every active staff member gets a notification (and the
    // off-platform relay, when configured). The poster already knows.
    const { results: recipients } = await env.DB.prepare(
      `SELECT id FROM users WHERE role != 'customer' AND is_active = 1 AND id != ?1`,
    ).bind(user.id).all();
    for (const r of recipients as { id: number }[]) {
      await notify(env, r.id, "announcement", `New announcement: ${body.title as string}`, `announcement:${res?.id}`);
    }
    await audit(env, user.id, "announcement.create", "announcements", String(res?.id));
    return json({ id: res?.id }, 201);
  }
  const ackMatch = path.match(/^\/announcements\/(\d+)\/ack$/);
  if (ackMatch && method === "POST") {
    await env.DB.prepare(
      `INSERT INTO announcement_acks (announcement_id, user_id) VALUES (?1, ?2)
       ON CONFLICT(announcement_id, user_id) DO NOTHING`,
    ).bind(ackMatch[1], user.id).run();
    return json({ ok: true });
  }

  /* ---- company events (v1.4.73) ---- */

  if (path === "/events" && method === "GET") {
    // Every staff member sees events. v1.4.76: includes the previous month
    // onwards so the calendar view can show recent history; the list view
    // filters to upcoming client-side.
    const { results } = await env.DB.prepare(
      `SELECT e.*, u.name AS created_by_name FROM events e
       LEFT JOIN users u ON u.id = e.created_by
       WHERE e.event_date >= date('now', '+8 hours', 'start of month', '-1 month')
       ORDER BY e.event_date ASC, e.start_time ASC LIMIT 200`,
    ).all();
    return json({ events: results });
  }
  if (path === "/events" && method === "POST") {
    if (!can(user, "events_manage")) return err("forbidden", "Management access required", 403);
    if (!body || !str(body.title, 200) || !/^\d{4}-\d{2}-\d{2}$/.test(String(body.event_date ?? ""))) {
      return err("invalid_input", "title and event_date (YYYY-MM-DD) are required", 400);
    }
    const cats = ["training", "class", "meeting", "event"];
    const category = typeof body.category === "string" && cats.includes(body.category) ? body.category : "event";
    const hhmm = (v: unknown) => (typeof v === "string" && /^\d{2}:\d{2}$/.test(v) ? v : null);
    const res = await env.DB.prepare(
      `INSERT INTO events (title, category, event_date, start_time, end_time, location, details, created_by)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8) RETURNING id`,
    ).bind(
      body.title, category, body.event_date,
      hhmm(body.start_time), hhmm(body.end_time),
      typeof body.location === "string" ? body.location.slice(0, 200) : null,
      typeof body.details === "string" ? body.details.slice(0, 2000) : null,
      user.id,
    ).first<{ id: number }>();
    // Ring the bell for every active staff member (same pattern as
    // announcements) — awareness is the whole point of this feature.
    const d = String(body.event_date);
    const dmy = `${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(0, 4)}`;
    const { results: recipients } = await env.DB.prepare(
      `SELECT id FROM users WHERE role != 'customer' AND is_active = 1 AND id != ?1`,
    ).bind(user.id).all();
    for (const r of recipients as { id: number }[]) {
      await notify(env, r.id, "event", `Upcoming ${category}: ${body.title as string} on ${dmy}`, `event:${res?.id}`);
    }
    await audit(env, user.id, "event.create", "events", String(res?.id), { category, event_date: d });
    return json({ id: res?.id }, 201);
  }
  const evMatch = path.match(/^\/events\/(\d+)$/);
  if (evMatch && method === "PATCH") {
    if (!can(user, "events_manage")) return err("forbidden", "Management access required", 403);
    if (!body) return err("invalid_input", "No fields", 400);
    const sets: string[] = [];
    const vals: unknown[] = [];
    if (str(body.title, 200)) { sets.push(`title = ?${vals.length + 1}`); vals.push(body.title); }
    if (typeof body.event_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.event_date)) { sets.push(`event_date = ?${vals.length + 1}`); vals.push(body.event_date); }
    if (typeof body.category === "string" && ["training", "class", "meeting", "event"].includes(body.category)) { sets.push(`category = ?${vals.length + 1}`); vals.push(body.category); }
    for (const f of ["start_time", "end_time", "location", "details"] as const) {
      if (typeof body[f] === "string") { sets.push(`${f} = ?${vals.length + 1}`); vals.push((body[f] as string).slice(0, 2000) || null); }
    }
    if (sets.length === 0) return err("invalid_input", "No valid fields", 400);
    await env.DB.prepare(`UPDATE events SET ${sets.join(", ")} WHERE id = ?${vals.length + 1}`)
      .bind(...vals, evMatch[1]).run();
    await audit(env, user.id, "event.update", "events", evMatch[1]);
    return json({ ok: true });
  }
  if (evMatch && method === "DELETE") {
    if (!can(user, "events_manage")) return err("forbidden", "Management access required", 403);
    await env.DB.prepare(`DELETE FROM events WHERE id = ?1`).bind(evMatch[1]).run();
    await audit(env, user.id, "event.delete", "events", evMatch[1]);
    return json({ ok: true });
  }

  /* ---- expense claims (v1.4.75): CEO/COO/CCO/HR submit, CEO decides ---- */

  /* v1.4.106: role-based claim approval chains (mirrors the leave chain).
     staff  (marketing/sales_marketing/editor/live_host): HR review -> COO pre-approval -> CEO
     hr     (hr_admin):                                   CCO pre-approval -> CEO
     exec   (coo/cco):                                    CEO only
     top    (ceo/admin tier):                             CEO only */
  const claimChain = (role: string): "staff" | "hr" | "exec" | "top" =>
    ["marketing", "sales_marketing", "editor", "live_host"].includes(role) ? "staff"
      : role === "hr_admin" ? "hr"
        : ["coo", "cco"].includes(role) ? "exec" : "top";
  const notifyRoles = async (roles: string[], excludeId: number, message: string, ref: string) => {
    const { results } = await env.DB.prepare(
      `SELECT id FROM users WHERE role IN (${roles.map(() => "?").join(",")}) AND is_active = 1`,
    ).bind(...roles).all<{ id: number }>();
    for (const r of results) if (r.id !== excludeId) await notify(env, r.id, "claim", message, ref);
  };
  const notifyClaimFirstStage = async (claimantRole: string, claimantName: string, claimId: string | number, cents: number, prefix: string) => {
    const chain = claimChain(claimantRole);
    const msg = `${prefix}: ${claimantName} — RM ${(cents / 100).toFixed(2)}`;
    if (chain === "staff") await notifyRoles(["hr_admin"], 0, `${msg} (HR review needed)`, `claim:${claimId}`);
    else if (chain === "hr") await notifyRoles(["cco"], 0, `${msg} (pre-approval needed)`, `claim:${claimId}`);
    else await notifyRoles(["ceo"], 0, msg, `claim:${claimId}`);
  };
  if (path === "/claims" && method === "GET") {
    if (!can(user, "claims_submit")) return err("forbidden", "Claims access required", 403);
    // Deciders see everyone's claims (the approval queue); submitters their own.
    const all = can(user, "claims_decide");
    // v1.4.106: reviewers see the claims their stage covers, plus their own.
    const SEL = `SELECT c.*,
                  (SELECT COUNT(*) FROM claims c2 WHERE date(c2.created_at) = date(c.created_at) AND c2.id <= c.id) AS day_seq,
                  u.name AS claimant, u.full_name AS claimant_full, u.position AS claimant_position,
                  u.department AS claimant_department, u.role AS claimant_role,
                  d.name AS decided_by_name, hb.name AS hr_reviewed_by_name, pb.name AS pre_approved_by_name FROM claims c
           LEFT JOIN users u ON u.id = c.user_id LEFT JOIN users d ON d.id = c.decided_by
           LEFT JOIN users hb ON hb.id = c.hr_reviewed_by LEFT JOIN users pb ON pb.id = c.pre_approved_by`;
    const STAFF_CHAIN = "('marketing','sales_marketing','editor','live_host')";
    const scope =
      all ? ""
        : ["hr_admin", "coo", "admin"].includes(user.role) ? ` WHERE (c.user_id = ?1 OR u.role IN ${STAFF_CHAIN})`
          : user.role === "cco" ? ` WHERE (c.user_id = ?1 OR u.role = 'hr_admin')`
            : ` WHERE c.user_id = ?1`;
    const { results } = await env.DB.prepare(
      `${SEL}${scope} ORDER BY CASE c.status WHEN 'pending' THEN 0 ELSE 1 END, c.created_at DESC LIMIT 200`,
    ).bind(...(all ? [] : [user.id])).all();
    return json({ claims: results, can_decide: all });
  }
  const claimReview = path.match(/^\/claims\/(\d+)\/review$/);
  if (claimReview && method === "POST") {
    // v1.4.106 stage 1 (staff chain only): HR reviews, then the COO pre-approves.
    if (!["hr_admin", "admin", "super_admin"].includes(user.role)) {
      return err("forbidden", "HR review is done by HR", 403);
    }
    const cr = await env.DB.prepare(
      `SELECT c.user_id, c.status, c.amount_cents, c.hr_reviewed_at, u.role AS claimant_role, u.name AS claimant_name
       FROM claims c LEFT JOIN users u ON u.id = c.user_id WHERE c.id = ?1`,
    ).bind(claimReview[1]).first<{ user_id: number; status: string; amount_cents: number; hr_reviewed_at: string | null; claimant_role: string; claimant_name: string }>();
    if (!cr) return err("not_found", "Claim not found", 404);
    if (cr.status !== "pending") return err("invalid_state", "Already decided", 400);
    if (claimChain(cr.claimant_role) !== "staff") return err("invalid_state", "This claim does not need an HR review", 400);
    if (cr.hr_reviewed_at) return err("invalid_state", "Already reviewed by HR", 400);
    if (cr.user_id === user.id) return err("forbidden", "No self-review", 403);
    await env.DB.prepare(
      `UPDATE claims SET hr_reviewed_by = ?1, hr_reviewed_at = datetime('now') WHERE id = ?2`,
    ).bind(user.id, claimReview[1]).run();
    await notifyRoles(["coo"], user.id, `Claim HR-reviewed, your pre-approval needed: ${cr.claimant_name} — RM ${(cr.amount_cents / 100).toFixed(2)}`, `claim:${claimReview[1]}`);
    await audit(env, user.id, "claim.hr_review", "claims", claimReview[1]!);
    return json({ ok: true });
  }
  const claimPre = path.match(/^\/claims\/(\d+)\/preapprove$/);
  if (claimPre && method === "POST") {
    // v1.4.106 stage 2: COO pre-approves staff-chain claims (after HR),
    // CCO pre-approves hr_admin claims. Admin tier as backstop.
    const cp = await env.DB.prepare(
      `SELECT c.user_id, c.status, c.amount_cents, c.hr_reviewed_at, c.pre_approved_at, u.role AS claimant_role, u.name AS claimant_name
       FROM claims c LEFT JOIN users u ON u.id = c.user_id WHERE c.id = ?1`,
    ).bind(claimPre[1]).first<{ user_id: number; status: string; amount_cents: number; hr_reviewed_at: string | null; pre_approved_at: string | null; claimant_role: string; claimant_name: string }>();
    if (!cp) return err("not_found", "Claim not found", 404);
    if (cp.status !== "pending") return err("invalid_state", "Already decided", 400);
    const chainP = claimChain(cp.claimant_role);
    const adminTier = ["admin", "super_admin"].includes(user.role);
    if (chainP === "staff") {
      if (user.role !== "coo" && !adminTier) return err("forbidden", "COO pre-approves staff claims", 403);
      if (!cp.hr_reviewed_at) return err("invalid_state", "HR review comes first", 400);
    } else if (chainP === "hr") {
      if (user.role !== "cco" && !adminTier) return err("forbidden", "CCO pre-approves HR claims", 403);
    } else {
      return err("invalid_state", "This claim goes straight to the CEO", 400);
    }
    if (cp.pre_approved_at) return err("invalid_state", "Already pre-approved", 400);
    if (cp.user_id === user.id) return err("forbidden", "No self-approval", 403);
    await env.DB.prepare(
      `UPDATE claims SET pre_approved_by = ?1, pre_approved_at = datetime('now') WHERE id = ?2`,
    ).bind(user.id, claimPre[1]).run();
    await notifyRoles(["ceo"], user.id, `Claim pre-approved, your FINAL approval needed: ${cp.claimant_name} — RM ${(cp.amount_cents / 100).toFixed(2)}`, `claim:${claimPre[1]}`);
    await audit(env, user.id, "claim.preapprove", "claims", claimPre[1]!);
    return json({ ok: true });
  }
  const claimEdit = path.match(/^\/claims\/(\d+)\/edit$/);
  if (claimEdit && method === "POST") {
    // v1.4.104: the claimant edits their own claim while it is PENDING, or
    // after a REJECTION — an edited rejected claim goes back to pending and
    // the CEO is notified of the resubmission. APPROVED claims are locked.
    if (!can(user, "claims_submit")) return err("forbidden", "Claims access required", 403);
    const cur = await env.DB.prepare(
      `SELECT user_id, status, paid_at FROM claims WHERE id = ?1`,
    ).bind(claimEdit[1]).first<{ user_id: number; status: string; paid_at: string | null }>();
    if (!cur) return err("not_found", "Claim not found", 404);
    if (cur.user_id !== user.id) return err("forbidden", "Only the claimant edits their claim", 403);
    if (cur.status === "approved" || cur.paid_at) return err("invalid_state", "Approved claims are locked — submit a new claim instead", 400);
    const catsE = ["travel", "meal", "accommodation", "equipment", "medical", "other"];
    if (!Array.isArray(body?.items) || body!.items.length === 0 || body!.items.length > 10) {
      return err("invalid_input", "1–10 items are required", 400);
    }
    const parsedE = (body!.items as { claim_date?: unknown; category?: unknown; description?: unknown; amount?: unknown }[])
      .map((i) => ({
        claim_date: typeof i.claim_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(i.claim_date) ? i.claim_date : null,
        category: typeof i.category === "string" && catsE.includes(i.category) ? i.category : "other",
        description: typeof i.description === "string" ? i.description.slice(0, 300) : "",
        amount_cents: Math.round(Number(i.amount) * 100),
      }));
    if (parsedE.some((i) => !i.claim_date || !Number.isFinite(i.amount_cents) || i.amount_cents <= 0 || i.amount_cents > 100000000)) {
      return err("invalid_input", "Every item needs a date and a positive amount", 400);
    }
    const centsE = parsedE.reduce((a, i) => a + i.amount_cents, 0);
    const purposeE = typeof body?.purpose === "string" ? body.purpose.slice(0, 1000) : null;
    const wasRejected = cur.status === "rejected";
    await env.DB.prepare(
      `UPDATE claims SET claim_date = ?1, category = ?2, amount_cents = ?3, description = ?4, items = ?5,
       status = 'pending', decided_by = NULL, decided_at = NULL, decision_note = NULL,
       hr_reviewed_by = NULL, hr_reviewed_at = NULL, pre_approved_by = NULL, pre_approved_at = NULL WHERE id = ?6`,
    ).bind(parsedE[0]!.claim_date, parsedE[0]!.category, centsE, purposeE, JSON.stringify(parsedE), claimEdit[1]).run();
    // v1.4.106: an edit restarts the chain from stage one.
    await notifyClaimFirstStage(user.role, user.name, claimEdit[1]!, centsE,
      wasRejected ? "Resubmitted after rejection" : "Updated claim");
    await audit(env, user.id, wasRejected ? "claim.resubmit" : "claim.edit", "claims", claimEdit[1]!, { amount_cents: centsE });
    return json({ ok: true, resubmitted: wasRejected });
  }
  const claimProof = path.match(/^\/claims\/(\d+)\/payment-proof$/);
  if (claimProof && method === "POST") {
    // v1.4.118: the payout proof (bank slip) — CEO only, after Mark paid.
    if (!can(user, "claims_decide")) return err("forbidden", "Only the CEO attaches payment proof", 403);
    const rowP = await env.DB.prepare(`SELECT status, paid_at, user_id FROM claims WHERE id = ?1`)
      .bind(claimProof[1]).first<{ status: string; paid_at: string | null; user_id: number }>();
    if (!rowP) return err("not_found", "Claim not found", 404);
    if (!rowP.paid_at) return err("invalid_state", "Mark the claim paid first, then attach the payment proof", 400);
    const ctP = request.headers.get("content-type") ?? "image/jpeg";
    if (!/^image\//.test(ctP) && ctP !== "application/pdf") return err("invalid_input", "Payment proof must be an image or PDF", 400);
    const lenP = Number(request.headers.get("content-length") ?? 0);
    if (lenP > 8 * 1024 * 1024) return err("too_large", "Payment proof too large — maximum 8 MB.", 413);
    if (!request.body) return err("invalid_input", "Payment proof body required", 400);
    const keyP = `claims/${claimProof[1]}-proof-${Date.now()}`;
    await env.MEDIA.put(keyP, request.body, { httpMetadata: { contentType: ctP } });
    await env.DB.prepare(`UPDATE claims SET payment_proof_key = ?1 WHERE id = ?2`).bind(keyP, claimProof[1]).run();
    await notify(env, rowP.user_id, "claim", "Payment proof for your claim has been attached — view it on your claim", `claim:${claimProof[1]}`);
    await audit(env, user.id, "claim.payment_proof", "claims", claimProof[1]!);
    return json({ ok: true });
  }
  if (claimProof && method === "GET") {
    const rowG = await env.DB.prepare(`SELECT user_id, payment_proof_key FROM claims WHERE id = ?1`)
      .bind(claimProof[1]).first<{ user_id: number; payment_proof_key: string | null }>();
    if (!rowG?.payment_proof_key) return err("not_found", "No payment proof attached", 404);
    if (rowG.user_id !== user.id && !can(user, "claims_decide")) return err("forbidden", "Not your claim", 403);
    const objP = await env.MEDIA.get(rowG.payment_proof_key);
    if (!objP) return err("not_found", "Payment proof file missing", 404);
    return new Response(objP.body, { headers: { "Content-Type": objP.httpMetadata?.contentType ?? "application/octet-stream", "Cache-Control": "private, max-age=300" } });
  }
  const claimPaid = path.match(/^\/claims\/(\d+)\/paid$/);
  if (claimPaid && method === "POST") {
    // v1.4.101: after approval the CEO records the actual payment — the
    // claimant sees PAID and the date on their submission.
    if (!can(user, "claims_decide")) return err("forbidden", "Only the CEO marks claims paid", 403);
    const cRow = await env.DB.prepare(`SELECT user_id, status, amount_cents FROM claims WHERE id = ?1`)
      .bind(claimPaid[1]).first<{ user_id: number; status: string; amount_cents: number }>();
    if (!cRow) return err("not_found", "Claim not found", 404);
    if (cRow.status !== "approved") return err("invalid_input", "Only approved claims can be marked paid", 400);
    await env.DB.prepare(`UPDATE claims SET paid_at = COALESCE(paid_at, datetime('now')) WHERE id = ?1`)
      .bind(claimPaid[1]).run();
    await notify(env, cRow.user_id, "claim", `Your claim (RM ${(cRow.amount_cents / 100).toFixed(2)}) has been PAID`, `claim:${claimPaid[1]}`);
    await audit(env, user.id, "claim.paid", "claims", claimPaid[1]!);
    return json({ ok: true });
  }
  if (path === "/claims" && method === "POST") {
    if (!can(user, "claims_submit")) return err("forbidden", "Claims access required", 403);
    const cats = ["travel", "meal", "accommodation", "equipment", "medical", "other"];
    // v1.4.95: multi-item claims — one form, several expense lines, exactly
    // like the paper AZOO-HR-CLM-001. Legacy single-line submissions still work.
    let itemsJson: string | null = null;
    let cents = 0;
    let claimDate = "";
    let category = "other";
    if (Array.isArray(body?.items) && body!.items.length > 0) {
      if (body!.items.length > 10) return err("invalid_input", "At most 10 items per claim", 400);
      const parsed = (body!.items as { claim_date?: unknown; category?: unknown; description?: unknown; amount?: unknown }[])
        .map((i) => ({
          claim_date: typeof i.claim_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(i.claim_date) ? i.claim_date : null,
          category: typeof i.category === "string" && cats.includes(i.category) ? i.category : "other",
          description: typeof i.description === "string" ? i.description.slice(0, 300) : "",
          amount_cents: Math.round(Number(i.amount) * 100),
        }));
      if (parsed.some((i) => !i.claim_date || !Number.isFinite(i.amount_cents) || i.amount_cents <= 0 || i.amount_cents > 100000000)) {
        return err("invalid_input", "Every item needs a date and a positive amount", 400);
      }
      cents = parsed.reduce((a, i) => a + i.amount_cents, 0);
      claimDate = parsed[0]!.claim_date as string;
      category = parsed[0]!.category;
      itemsJson = JSON.stringify(parsed);
    } else {
      cents = Math.round(Number(body?.amount) * 100);
      if (!body || !/^\d{4}-\d{2}-\d{2}$/.test(String(body.claim_date ?? "")) || !Number.isFinite(cents) || cents <= 0 || cents > 100000000) {
        return err("invalid_input", "claim_date (YYYY-MM-DD) and a positive amount are required", 400);
      }
      claimDate = body.claim_date as string;
      category = typeof body.category === "string" && cats.includes(body.category) ? body.category : "other";
    }
    const purpose = typeof body?.purpose === "string" ? body.purpose.slice(0, 1000)
      : typeof body?.description === "string" ? body.description.slice(0, 1000) : null;
    const res = await env.DB.prepare(
      `INSERT INTO claims (user_id, claim_date, category, amount_cents, description, items)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6) RETURNING id`,
    ).bind(user.id, claimDate, category, cents, purpose, itemsJson).first<{ id: number }>();
    // v1.4.106: tell the FIRST stage of this claimant's chain.
    await notifyClaimFirstStage(user.role, user.name, res?.id ?? 0, cents, "New claim");
    await audit(env, user.id, "claim.create", "claims", String(res?.id), { category, amount_cents: cents });
    return json({ id: res?.id }, 201);
  }
  const clMatch = path.match(/^\/claims\/(\d+)(\/receipt|\/decide)?$/);
  if (clMatch && clMatch[2] === "/receipt" && method === "POST") {
    if (!can(user, "claims_submit")) return err("forbidden", "Claims access required", 403);
    const row = await env.DB.prepare(`SELECT user_id, status FROM claims WHERE id = ?1`).bind(clMatch[1]).first<{ user_id: number; status: string }>();
    if (!row) return err("not_found", "Claim not found", 404);
    if (row.user_id !== user.id) return err("forbidden", "Only the claimant attaches receipts", 403);
    if (!["pending", "rejected"].includes(row.status)) return err("invalid_state", "Approved claims are locked", 400);
    const ct = request.headers.get("content-type") ?? "image/jpeg";
    if (!/^image\//.test(ct) && ct !== "application/pdf") return err("invalid_input", "Receipt must be an image or PDF", 400);
    // v1.4.110: hard size cap so staff get a clear message instead of a
    // silent failure. 8 MB is generous — receipts compress to ~200 KB.
    const lenR = Number(request.headers.get("content-length") ?? 0);
    if (lenR > 8 * 1024 * 1024) {
      return err("too_large", "Receipt too large — maximum 8 MB. Tip: send the photo to yourself on WhatsApp, save it back from the chat (WhatsApp compresses it), then upload that copy.", 413);
    }
    if (!request.body) return err("invalid_input", "Receipt body required", 400);
    const key = `claims/${clMatch[1]}-${Date.now()}`;
    await env.MEDIA.put(key, request.body, { httpMetadata: { contentType: ct } });
    await env.DB.prepare(`UPDATE claims SET receipt_key = ?1 WHERE id = ?2`).bind(key, clMatch[1]).run();
    // v1.4.117: attaching a receipt to a REJECTED claim resubmits it — the
    // missing receipt was the fix, so the claim goes straight back through
    // the chain (decision + chain stamps cleared, first stage notified).
    let resubmittedR = false;
    if (row.status === "rejected") {
      const cRow = await env.DB.prepare(`SELECT amount_cents FROM claims WHERE id = ?1`).bind(clMatch[1]).first<{ amount_cents: number }>();
      await env.DB.prepare(
        `UPDATE claims SET status = 'pending', decided_by = NULL, decided_at = NULL, decision_note = NULL,
         hr_reviewed_by = NULL, hr_reviewed_at = NULL, pre_approved_by = NULL, pre_approved_at = NULL WHERE id = ?1`,
      ).bind(clMatch[1]).run();
      await notifyClaimFirstStage(user.role, user.name, clMatch[1]!, cRow?.amount_cents ?? 0, "Resubmitted with receipt");
      await audit(env, user.id, "claim.resubmit", "claims", clMatch[1]!, { via: "receipt_attach" });
      resubmittedR = true;
    }
    return json({ ok: true, resubmitted: resubmittedR });
  }
  if (clMatch && clMatch[2] === "/receipt" && method === "GET") {
    if (!can(user, "claims_submit")) return err("forbidden", "Claims access required", 403);
    const row = await env.DB.prepare(`SELECT user_id, receipt_key FROM claims WHERE id = ?1`).bind(clMatch[1]).first<{ user_id: number; receipt_key: string | null }>();
    if (!row?.receipt_key) return err("not_found", "No receipt attached", 404);
    if (row.user_id !== user.id && !can(user, "claims_decide")) return err("forbidden", "Not your claim", 403);
    const obj = await env.MEDIA.get(row.receipt_key);
    if (!obj) return err("not_found", "Receipt file missing", 404);
    return new Response(obj.body, { headers: { "Content-Type": obj.httpMetadata?.contentType ?? "application/octet-stream", "Cache-Control": "private, max-age=300" } });
  }
  if (clMatch && clMatch[2] === "/decide" && method === "POST") {
    // Per the CEO's instruction: EVERY claim decision is the CEO's.
    if (!can(user, "claims_decide")) return err("forbidden", "Only the CEO decides claims", 403);
    const action = body?.action;
    if (action !== "approve" && action !== "reject") return err("invalid_input", "action must be approve or reject", 400);
    const row = await env.DB.prepare(
      `SELECT c.user_id, c.status, c.amount_cents, c.hr_reviewed_at, c.pre_approved_at, u.role AS claimant_role
       FROM claims c LEFT JOIN users u ON u.id = c.user_id WHERE c.id = ?1`,
    ).bind(clMatch[1]).first<{ user_id: number; status: string; amount_cents: number; hr_reviewed_at: string | null; pre_approved_at: string | null; claimant_role: string }>();
    if (!row) return err("not_found", "Claim not found", 404);
    if (row.status !== "pending") return err("invalid_state", "Already decided", 400);
    // v1.4.106: approval normally waits for the chain; a REJECT can happen at
    // any point. v1.4.107: the CEO is the company's final authority — he CAN
    // approve before the chain completes, and the bypass is RECORDED (audit
    // meta + a line on the claim's decision note) so the record shows it was
    // a deliberate override, not a skipped process.
    let chainOverride: string | null = null;
    if (action === "approve") {
      const chainD = claimChain(row.claimant_role);
      const skipped: string[] = [];
      if (chainD === "staff") {
        if (!row.hr_reviewed_at) skipped.push("HR review");
        if (!row.pre_approved_at) skipped.push("COO pre-approval");
      } else if (chainD === "hr" && !row.pre_approved_at) {
        skipped.push("CCO pre-approval");
      }
      if (skipped.length > 0) chainOverride = skipped.join(" + ");
    }
    const status = action === "approve" ? "approved" : "rejected";
    const noteBase = typeof body?.note === "string" && body.note ? body.note.slice(0, 400) : "";
    const noteFinal = chainOverride
      ? `${noteBase ? noteBase + " · " : ""}CEO direct approval (${chainOverride} bypassed)`
      : (noteBase || null);
    await env.DB.prepare(
      `UPDATE claims SET status = ?1, decided_by = ?2, decided_at = datetime('now'), decision_note = ?3 WHERE id = ?4`,
    ).bind(status, user.id, noteFinal, clMatch[1]).run();
    await notify(env, row.user_id, "claim",
      `Your claim of RM ${(row.amount_cents / 100).toFixed(2)} was ${status}${typeof body?.note === "string" && body.note ? ` — ${body.note.slice(0, 200)}` : ""}`,
      `claim:${clMatch[1]}`);
    await audit(env, user.id, `claim.${action}`, "claims", clMatch[1], chainOverride ? { chain_override: chainOverride } : undefined);
    return json({ ok: true });
  }

  /* ---- company expenses (v1.4.87): CEO + COO ---- */

  if (path === "/expenses" && method === "GET") {
    if (!can(user, "expenses")) return err("forbidden", "Expenses access required", 403);
    const urlE = new URL(request.url);
    const mE = urlE.searchParams.get("month"); // optional YYYY-MM filter
    const { results } = await env.DB.prepare(
      mE
        ? `SELECT e.*, u.name AS created_by_name FROM expenses e
           LEFT JOIN users u ON u.id = e.created_by
           WHERE e.expense_date LIKE ?1 || '%' ORDER BY e.expense_date DESC, e.id DESC LIMIT 300`
        : `SELECT e.*, u.name AS created_by_name FROM expenses e
           LEFT JOIN users u ON u.id = e.created_by
           ORDER BY e.expense_date DESC, e.id DESC LIMIT 300`,
    ).bind(...(mE ? [mE] : [])).all();
    // v1.4.88: carry recurring expenses forward — the latest recurring row of
    // each (category · vendor · description) group from EARLIER months that
    // has no row yet in the viewed month appears as "due to record".
    let upcoming: unknown[] = [];
    if (mE) {
      const { results: rec } = await env.DB.prepare(
        `SELECT * FROM expenses WHERE recurring = 1 AND expense_date < ?1 || '-01'
         ORDER BY expense_date DESC, id DESC LIMIT 200`,
      ).bind(mE).all<Record<string, unknown>>();
      const keyOf = (r: Record<string, unknown>) =>
        `${r.category}|${(r.vendor as string) ?? ""}|${(r.description as string) ?? ""}`;
      const existing = new Set((results as Record<string, unknown>[]).map(keyOf));
      const seen = new Set<string>();
      for (const r of rec) {
        const k = keyOf(r);
        if (existing.has(k) || seen.has(k)) continue;
        seen.add(k);
        upcoming.push(r);
      }
    }
    // v1.4.91: staff payroll paid during this month = the PREVIOUS month's
    // payroll (cycle closes on the 5th). Net per entry uses the same formula
    // as the payslip: basic + commission + allowance + OT − manual deduction
    // − unpaid leave (base ÷ 26 × days) − incomplete month.
    let staffPayroll: { month: string; cents: number } | null = null;
    if (mE) {
      const yP = Number(mE.slice(0, 4));
      const moP = Number(mE.slice(5, 7));
      const prevM = new Date(Date.UTC(yP, moP - 2, 1)).toISOString().slice(0, 7);
      const { results: pes } = await env.DB.prepare(
        `SELECT p.user_id, p.basic_cents, p.commission_cents, p.allowance_cents,
                COALESCE(p.ot_cents, 0) AS ot_cents, p.deduction_cents,
                p.worked_days, p.month_working_days, u.base_salary_cents
         FROM payroll_entries p JOIN users u ON u.id = p.user_id WHERE p.month = ?1`,
      ).bind(prevM).all<{ user_id: number; basic_cents: number; commission_cents: number; allowance_cents: number; ot_cents: number; deduction_cents: number; worked_days: number | null; month_working_days: number | null; base_salary_cents: number }>();
      const { results: uls } = await env.DB.prepare(
        `SELECT user_id, COALESCE(SUM(days), 0) AS days FROM leave_requests
         WHERE type = 'unpaid' AND status = 'approved' AND start_date LIKE ?1 || '%' GROUP BY user_id`,
      ).bind(prevM).all<{ user_id: number; days: number }>();
      const ulMap = new Map(uls.map((r) => [r.user_id, r.days]));
      let sum = 0;
      for (const e of pes) {
        const ul = ulMap.get(e.user_id) ?? 0;
        const ulDed = ul > 0 ? Math.round(((e.base_salary_cents || e.basic_cents) / 26) * ul) : 0;
        let adj = 0;
        if (e.worked_days !== null && e.worked_days !== undefined && e.month_working_days && e.month_working_days > 0) {
          const adjustable = Math.max(0, Math.max(0, e.month_working_days - e.worked_days) - ul);
          adj = Math.round((e.basic_cents * adjustable) / e.month_working_days);
        }
        sum += Math.max(0, e.basic_cents + e.commission_cents + e.allowance_cents + e.ot_cents - e.deduction_cents - ulDed - adj);
      }
      let paidAtP: string | null = null;
      try {
        const paidRow = await env.DB.prepare(
          `SELECT paid_at FROM payroll_payments WHERE month = ?1`,
        ).bind(prevM).first<{ paid_at: string }>();
        paidAtP = paidRow?.paid_at ?? null;
      } catch (e) {
        // payroll_payments arrives with migration 0037 — degrade, don't die.
        await logError(env, "expenses_payroll_paid", e instanceof Error ? e.message : String(e));
      }
      staffPayroll = { month: prevM, cents: sum, paid_at: paidAtP } as { month: string; cents: number; paid_at?: string | null };
    }
    // v1.4.112 (CEO's rule): a claim belongs to the month its CLAIM DATES
    // fall in (1st → month end) once APPROVED — that month's expense, whether
    // the money moved yet or not. Payments-completed still lists actual
    // payments by paid_at (cash movements), and approved-unpaid claims sit
    // on Payments due.
    let claimsInMonth: unknown[] = [], claimsPaid: unknown[] = [], claimsDue: unknown[] = [];
    try {
      ({ results: claimsInMonth } = await env.DB.prepare(
      `SELECT c.id, c.amount_cents, c.paid_at, c.claim_date, u.name AS claimant FROM claims c
       LEFT JOIN users u ON u.id = c.user_id
       WHERE c.status = 'approved' AND strftime('%Y-%m', c.claim_date) = ?1
       ORDER BY c.claim_date ASC`,
    ).bind(month).all());
    ({ results: claimsPaid } = await env.DB.prepare(
      `SELECT c.id, c.amount_cents, c.paid_at, u.name AS claimant FROM claims c
       LEFT JOIN users u ON u.id = c.user_id
       WHERE c.paid_at IS NOT NULL AND strftime('%Y-%m', c.paid_at) = ?1
       ORDER BY c.paid_at DESC`,
    ).bind(month).all());
    ({ results: claimsDue } = await env.DB.prepare(
      `SELECT c.id, c.amount_cents, c.decided_at, u.name AS claimant FROM claims c
       LEFT JOIN users u ON u.id = c.user_id
       WHERE c.status = 'approved' AND c.paid_at IS NULL ORDER BY c.decided_at ASC`,
    ).all());
    } catch (e) {
      // claims.paid_at arrives with migration 0037 — degrade, don't die.
      await logError(env, "expenses_claims", e instanceof Error ? e.message : String(e));
    }
    return json({ expenses: results, upcoming, staff_payroll: staffPayroll, staff_claims: { in_month: claimsInMonth, paid: claimsPaid, due: claimsDue } });
  }
  const exEdit = path.match(/^\/expenses\/(\d+)$/);
  if (exEdit && method === "PATCH") {
    // v1.4.91: fix typos on a recorded expense. (Staff payroll is computed
    // from the Payroll tab and is not editable here — by design.)
    if (!can(user, "expenses")) return err("forbidden", "Expenses access required", 403);
    const catsP = ["rent", "utilities", "software", "marketing", "equipment", "logistics", "supplies", "other"];
    const sets: string[] = [];
    const vals: unknown[] = [];
    const setV = (col: string, v: unknown) => { vals.push(v); sets.push(`${col} = ?${vals.length}`); };
    if (typeof body?.expense_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.expense_date)) setV("expense_date", body.expense_date);
    if (typeof body?.category === "string" && catsP.includes(body.category)) setV("category", body.category);
    if (typeof body?.amount === "number" && body.amount > 0) setV("amount_cents", Math.round(body.amount * 100));
    if (typeof body?.vendor === "string") setV("vendor", body.vendor.slice(0, 200) || null);
    if (typeof body?.description === "string") setV("description", body.description.slice(0, 1000) || null);
    if (typeof body?.due_day === "number" && body.due_day >= 1 && body.due_day <= 31) setV("due_day", Math.round(body.due_day));
    else if (body?.due_day === null) sets.push("due_day = NULL");
    if (body?.recurring === true || body?.recurring === false) setV("recurring", body.recurring ? 1 : 0);
    if (sets.length === 0) return err("invalid_input", "Nothing to update", 400);
    await env.DB.prepare(`UPDATE expenses SET ${sets.join(", ")} WHERE id = ?${vals.length + 1}`)
      .bind(...vals, exEdit[1]).run();
    await audit(env, user.id, "expense.update", "expenses", exEdit[1]);
    return json({ ok: true });
  }
  const exPaid = path.match(/^\/expenses\/(\d+)\/paid$/);
  if (exPaid && method === "POST") {
    // v1.4.88: mark an expense paid — the due chip turns into PAID.
    if (!can(user, "expenses")) return err("forbidden", "Expenses access required", 403);
    await env.DB.prepare(`UPDATE expenses SET paid_at = datetime('now') WHERE id = ?1`).bind(exPaid[1]).run();
    await audit(env, user.id, "expense.paid", "expenses", exPaid[1]);
    return json({ ok: true });
  }
  if (path === "/expenses" && method === "POST") {
    if (!can(user, "expenses")) return err("forbidden", "Expenses access required", 403);
    const catsE = ["rent", "utilities", "software", "marketing", "equipment", "logistics", "supplies", "other"];
    const centsE = Math.round(Number(body?.amount) * 100);
    if (!body || !/^\d{4}-\d{2}-\d{2}$/.test(String(body.expense_date ?? "")) || !Number.isFinite(centsE) || centsE <= 0 || centsE > 1000000000) {
      return err("invalid_input", "expense_date (YYYY-MM-DD) and a positive amount are required", 400);
    }
    const categoryE = typeof body.category === "string" && catsE.includes(body.category) ? body.category : "other";
    const dueDay = typeof body.due_day === "number" && body.due_day >= 1 && body.due_day <= 31
      ? Math.round(body.due_day) : null;
    const res = await env.DB.prepare(
      `INSERT INTO expenses (expense_date, category, amount_cents, vendor, description, recurring, due_day, paid_at, created_by)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9) RETURNING id`,
    ).bind(
      body.expense_date, categoryE, centsE,
      typeof body.vendor === "string" ? body.vendor.slice(0, 200) : null,
      typeof body.description === "string" ? body.description.slice(0, 1000) : null,
      body.recurring === true || body.recurring === 1 ? 1 : 0,
      dueDay,
      body.paid === true ? new Date().toISOString().replace("T", " ").slice(0, 19) : null,
      user.id,
    ).first<{ id: number }>();
    await audit(env, user.id, "expense.create", "expenses", String(res?.id), { category: categoryE, amount_cents: centsE });
    return json({ id: res?.id }, 201);
  }
  const exMatch = path.match(/^\/expenses\/(\d+)$/);
  if (exMatch && method === "DELETE") {
    if (!can(user, "expenses")) return err("forbidden", "Expenses access required", 403);
    await env.DB.prepare(`DELETE FROM expenses WHERE id = ?1`).bind(exMatch[1]).run();
    await audit(env, user.id, "expense.delete", "expenses", exMatch[1]);
    return json({ ok: true });
  }

  /* ---- sales revenue (v1.4.75): dashboard figures, TikTok included ---- */

  if (path === "/pnl" && method === "GET") {
    // v1.4.101: month-by-month P&L — revenue (TikTok + PAID invoices, cash
    // basis) against expenses (recorded expenses + payroll nets), profit line.
    if (!can(user, "exec_view")) return err("forbidden", "Executive access required", 403);
    const months: string[] = [];
    const nowM = new Date(Date.now() + 8 * 3600 * 1000);
    for (let i = 5; i >= 0; i--) {
      months.push(new Date(Date.UTC(nowM.getUTCFullYear(), nowM.getUTCMonth() - i, 1)).toISOString().slice(0, 7));
    }
    const rows = [] as { month: string; tiktok_cents: number; invoiced_cents: number; expenses_cents: number; payroll_cents: number; claims_cents: number; profit_cents: number }[];
    for (const m of months) {
      const tt = await env.DB.prepare(
        `SELECT COALESCE(SUM(order_amount_cents), 0) AS c FROM postage_records
         WHERE order_ref LIKE 'TT-%' AND status != 'returned' AND strftime('%Y-%m', created_at, '+8 hours') = ?1`,
      ).bind(m).first<{ c: number }>();
      const inv = await env.DB.prepare(
        `SELECT COALESCE(SUM(total_cents), 0) AS c FROM sales_documents
         WHERE doc_type = 'INV' AND payment_status = 'paid' AND strftime('%Y-%m', COALESCE(paid_at, created_at), '+8 hours') = ?1`,
      ).bind(m).first<{ c: number }>();
      const ex = await env.DB.prepare(
        `SELECT COALESCE(SUM(amount_cents), 0) AS c FROM expenses WHERE strftime('%Y-%m', expense_date) = ?1`,
      ).bind(m).first<{ c: number }>();
      let clm: { c: number } | null = null;
      try {
        clm = await env.DB.prepare(
          `SELECT COALESCE(SUM(amount_cents), 0) AS c FROM claims
           WHERE status = 'approved' AND strftime('%Y-%m', claim_date) = ?1`,
        ).bind(m).first<{ c: number }>();
      } catch { /* pre-0037 DB — claims column set incomplete */ }
      // payroll of month m-1 is PAID during m (the 5th cycle) — cash basis.
      const prevPm = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 2, 1)).toISOString().slice(0, 7);
      const pr = await env.DB.prepare(
        `SELECT COALESCE(SUM(p.basic_cents + p.commission_cents + p.allowance_cents + COALESCE(p.ot_cents, 0) - p.deduction_cents), 0) AS c
         FROM payroll_entries p WHERE p.month = ?1`,
      ).bind(prevPm).first<{ c: number }>();
      const revenue = (tt?.c ?? 0) + (inv?.c ?? 0);
      const cost = (ex?.c ?? 0) + (pr?.c ?? 0) + (clm?.c ?? 0);
      rows.push({ month: m, tiktok_cents: tt?.c ?? 0, invoiced_cents: inv?.c ?? 0, expenses_cents: ex?.c ?? 0, payroll_cents: pr?.c ?? 0, claims_cents: clm?.c ?? 0, profit_cents: revenue - cost });
    }
    return json({ months: rows });
  }
  if (path === "/revenue" && method === "GET") {
    if (!can(user, "revenue_view")) return err("forbidden", "Revenue access required", 403);
    const month = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 7);
    const lastMonth = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 2, 1)).toISOString().slice(0, 7);
    const tiktok = (m: string) => env.DB.prepare(
      `SELECT COALESCE(SUM(order_amount_cents), 0) AS cents, COUNT(*) AS orders
       FROM postage_records
       WHERE order_ref LIKE 'TT-%' AND status != 'returned'
         AND strftime('%Y-%m', created_at, '+8 hours') = ?1`,
    ).bind(m).first<{ cents: number; orders: number }>();
    // v1.4.90: invoiced revenue counts on a PAYMENT-RECEIVED basis — paid
    // invoices, in the month the payment landed (bank transfer etc.). Billed
    // but unpaid invoices are shown separately as outstanding.
    const invoiced = (m: string) => env.DB.prepare(
      `SELECT COALESCE(SUM(total_cents), 0) AS cents, COUNT(*) AS docs
       FROM sales_documents WHERE doc_type = 'INV' AND payment_status = 'paid'
         AND strftime('%Y-%m', COALESCE(paid_at, created_at), '+8 hours') = ?1`,
    ).bind(m).first<{ cents: number; docs: number }>();
    const outstanding = env.DB.prepare(
      `SELECT COALESCE(SUM(total_cents), 0) AS cents, COUNT(*) AS docs
       FROM sales_documents WHERE doc_type = 'INV' AND payment_status != 'paid'`,
    ).first<{ cents: number; docs: number }>();
    const targetOf = (m: string) => env.DB.prepare(
      `SELECT target_cents FROM sales_targets WHERE month = ?1`,
    ).bind(m).first<{ target_cents: number }>();
    // v1.4.95: targets are per-month rows, so each new month RESETS by
    // construction; last month's KPI result stays on the card for the team,
    // and next month's target can be set before month-end.
    const nextMonth = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 1)).toISOString().slice(0, 7);
    const [tThis, tLast, iThis, iLast, out, tgt, tgtLast, tgtNext] = await Promise.all([
      tiktok(month), tiktok(lastMonth), invoiced(month), invoiced(lastMonth), outstanding,
      targetOf(month), targetOf(lastMonth), targetOf(nextMonth),
    ]);
    return json({
      month, last_month: lastMonth, next_month: nextMonth,
      tiktok: { this_cents: tThis?.cents ?? 0, this_orders: tThis?.orders ?? 0, last_cents: tLast?.cents ?? 0, last_orders: tLast?.orders ?? 0 },
      invoiced: { this_cents: iThis?.cents ?? 0, this_docs: iThis?.docs ?? 0, last_cents: iLast?.cents ?? 0, last_docs: iLast?.docs ?? 0 },
      outstanding: { cents: out?.cents ?? 0, docs: out?.docs ?? 0 },
      target_cents: tgt?.target_cents ?? null,
      last_target_cents: tgtLast?.target_cents ?? null,
      next_target_cents: tgtNext?.target_cents ?? null,
    });
  }
  if (path === "/revenue/target" && method === "POST") {
    // v1.4.90: monthly sales KPI target — leadership only.
    if (!["super_admin", "admin", "ceo", "coo"].includes(user.role)) {
      return err("forbidden", "Only the CEO/COO set sales targets", 403);
    }
    const mT = typeof body?.month === "string" && /^\d{4}-\d{2}$/.test(body.month) ? body.month : null;
    const cT = Math.round(Number(body?.target_cents));
    if (!mT || !Number.isFinite(cT) || cT < 0) return err("invalid_input", "month (YYYY-MM) and target_cents required", 400);
    await env.DB.prepare(
      `INSERT INTO sales_targets (month, target_cents, set_by) VALUES (?1, ?2, ?3)
       ON CONFLICT(month) DO UPDATE SET target_cents = ?2, set_by = ?3`,
    ).bind(mT, cT, user.id).run();
    await audit(env, user.id, "revenue.target_set", "sales_targets", mT, { target_cents: cT });
    return json({ ok: true });
  }

  /* ---- tasks ---- */

  if (path === "/tasks" && method === "GET") {
    const url = new URL(request.url);
    const all = url.searchParams.get("all") === "1" && can(user, "team_manage");
    const { results } = await env.DB.prepare(
      all
        ? `SELECT t.*, u.name AS assignee FROM tasks t JOIN users u ON u.id = t.assigned_to ORDER BY t.created_at DESC LIMIT 200`
        : `SELECT * FROM tasks WHERE assigned_to = ?1 ORDER BY created_at DESC LIMIT 100`,
    ).bind(...(all ? [] : [user.id])).all();
    return json({ tasks: results });
  }
  if (path === "/tasks" && method === "POST") {
    // Staff create their own tasks (they know their work). Managers may also
    // assign to others; a plain staff member can only assign to themselves.
    if (!body || !str(body.title, 200)) {
      return err("invalid_input", "title is required", 400);
    }
    const assignedTo = typeof body.assigned_to === "number" ? body.assigned_to : user.id;
    if (assignedTo !== user.id && !can(user, "team_manage")) {
      return err("forbidden", "You can only create tasks for yourself", 403);
    }
    const prio = ["low", "normal", "high", "urgent"];
    const res = await env.DB.prepare(
      `INSERT INTO tasks (title, description, assigned_to, created_by, priority, deadline)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6) RETURNING id`,
    ).bind(
      body.title, str(body.description, 5000) ? body.description : null,
      assignedTo, user.id,
      typeof body.priority === "string" && prio.includes(body.priority) ? body.priority : "normal",
      str(body.deadline, 10) ? body.deadline : null,
    ).first<{ id: number }>();
    if (assignedTo !== user.id) {
      await notify(env, assignedTo, "task", `New task assigned: ${body.title as string}`, `task:${res?.id}`);
    }
    await audit(env, user.id, "task.create", "tasks", String(res?.id));
    return json({ id: res?.id }, 201);
  }
  const taskMatch = path.match(/^\/tasks\/(\d+)$/);
  if (taskMatch && method === "PATCH") {
    const id = taskMatch[1]!;
    const row = await env.DB.prepare(`SELECT assigned_to FROM tasks WHERE id = ?1`)
      .bind(id).first<{ assigned_to: number }>();
    if (!row) return err("not_found", "Task not found", 404);
    if (row.assigned_to !== user.id && !can(user, "team_manage")) {
      return err("forbidden", "Not your task", 403);
    }
    const sets: string[] = [];
    const vals: (string | number)[] = [];
    if (typeof body?.progress === "number" && body.progress >= 0 && body.progress <= 100) {
      sets.push(`progress = ?${sets.length + 1}`); vals.push(body.progress);
    }
    if (typeof body?.status === "string" && ["open", "in_progress", "completed"].includes(body.status)) {
      sets.push(`status = ?${sets.length + 1}`); vals.push(body.status);
    }
    if (sets.length === 0) return err("invalid_input", "Nothing to update", 400);
    await env.DB.prepare(`UPDATE tasks SET ${sets.join(", ")} WHERE id = ?${sets.length + 1}`)
      .bind(...vals, id).run();
    return json({ ok: true });
  }
  const commentMatch = path.match(/^\/tasks\/(\d+)\/comments$/);
  if (commentMatch && method === "POST") {
    if (!body || !str(body.comment, 2000)) return err("invalid_input", "comment is required", 400);
    await env.DB.prepare(
      `INSERT INTO task_comments (task_id, user_id, comment, attachment_media_id) VALUES (?1, ?2, ?3, ?4)`,
    ).bind(
      commentMatch[1], user.id, body.comment,
      typeof body.attachment_media_id === "number" ? body.attachment_media_id : null,
    ).run();
    return json({ ok: true }, 201);
  }
  if (commentMatch && method === "GET") {
    const { results } = await env.DB.prepare(
      `SELECT c.comment, c.created_at, u.name FROM task_comments c
       JOIN users u ON u.id = c.user_id WHERE c.task_id = ?1 ORDER BY c.created_at`,
    ).bind(commentMatch[1]).all();
    return json({ comments: results });
  }

  /* ---- CRM customers ---- */

  if (path === "/customers" && (method === "GET" || method === "POST")) {
    if (method === "GET" ? !can(user, "sales") && !can(user, "exec_view") : !can(user, "sales")) {
      return err("forbidden", "Sales access required", 403);
    }
    if (method === "GET") {
      const { results } = await env.DB.prepare(
        `SELECT * FROM customers WHERE company != 'Walk-in Customer' ORDER BY company LIMIT 300`,
      ).all();
      return json({ customers: results });
    }
    if (!body || !str(body.company, 200)) return err("invalid_input", "company is required", 400);
    const res = await env.DB.prepare(
      `INSERT INTO customers (company, contact_person, phone, email, address, notes, created_by)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) RETURNING id`,
    ).bind(
      body.company,
      str(body.contact_person, 120) ? body.contact_person : null,
      str(body.phone, 40) ? body.phone : null,
      str(body.email, 200) ? body.email : null,
      str(body.address, 500) ? body.address : null,
      str(body.notes, 2000) ? body.notes : null,
      user.id,
    ).first<{ id: number }>();
    await audit(env, user.id, "customer.create", "customers", String(res?.id));
    return json({ id: res?.id }, 201);
  }
  const custMatch = path.match(/^\/customers\/(\d+)$/);
  if (custMatch && method === "PUT") {
    if (!can(user, "sales")) return err("forbidden", "Sales access required", 403);
    const fields = ["company", "contact_person", "phone", "email", "address", "notes"] as const;
    const sets: string[] = [];
    const vals: string[] = [];
    for (const f of fields) {
      if (str(body?.[f], 2000)) { sets.push(`${f} = ?${sets.length + 1}`); vals.push(body![f] as string); }
    }
    if (sets.length === 0) return err("invalid_input", "Nothing to update", 400);
    await env.DB.prepare(`UPDATE customers SET ${sets.join(", ")} WHERE id = ?${sets.length + 1}`)
      .bind(...vals, custMatch[1]!).run();
    return json({ ok: true });
  }

  /* ---- sales documents (QT / DO / INV) ---- */

  if (path === "/docs" && method === "GET") {
    if (!can(user, "sales") && !can(user, "exec_view")) return err("forbidden", "Sales access required", 403);
    const url = new URL(request.url);
    const t = url.searchParams.get("type");
    const filter = t && ["QT", "DO", "INV"].includes(t) ? `WHERE d.doc_type = '${t}'` : "";
    const { results } = await env.DB.prepare(
      `SELECT d.*, c.company, c.phone AS customer_phone, sp.name AS salesperson_name FROM sales_documents d
       LEFT JOIN users sp ON sp.id = d.salesperson_id
       JOIN customers c ON c.id = d.customer_id ${filter}
       ORDER BY d.created_at DESC LIMIT 200`,
    ).all();
    return json({ docs: results });
  }
  if (path === "/docs" && method === "POST") {
    if (!body || typeof body.doc_type !== "string" || !["QT", "DO", "INV"].includes(body.doc_type)) {
      return err("invalid_input", "doc_type must be QT, DO, or INV", 400);
    }
    const docType = body.doc_type as "QT" | "DO" | "INV";
    if (docType === "INV" ? !can(user, "finance") : !can(user, "sales")) {
      return err("forbidden", "Insufficient rights for this document type", 403);
    }
    if (typeof body.customer_id !== "number" || !Array.isArray(body.items) || body.items.length === 0) {
      return err("invalid_input", "customer_id and items are required", 400);
    }
    // v1.4.91: walk-in buyer — customer_id 0 bills the shared "Walk-in
    // Customer" record (created once), so a payment can be invoiced even
    // when the buyer's identity isn't known.
    let customerId = body.customer_id as number;
    if (customerId === 0) {
      const existing = await env.DB.prepare(
        `SELECT id FROM customers WHERE company = 'Walk-in Customer'`,
      ).first<{ id: number }>();
      if (existing) customerId = existing.id;
      else {
        const created = await env.DB.prepare(
          `INSERT INTO customers (company, notes, created_by) VALUES ('Walk-in Customer', 'Shared record for unidentified buyers', ?1) RETURNING id`,
        ).bind(user.id).first<{ id: number }>();
        customerId = created?.id ?? 0;
      }
      if (!customerId) return err("server_error", "Could not prepare the walk-in customer record", 500);
    }
    const items = (body.items as { name?: unknown; qty?: unknown; unit_price_cents?: unknown }[])
      .filter((i) => str(i.name, 200) && typeof i.qty === "number" && i.qty > 0 && typeof i.unit_price_cents === "number" && i.unit_price_cents >= 0)
      .map((i) => ({ name: i.name as string, qty: i.qty as number, unit_price_cents: i.unit_price_cents as number }));
    if (items.length === 0) return err("invalid_input", "Each item needs name, qty, unit_price_cents", 400);

    const subtotal = items.reduce((s, i) => s + i.qty * i.unit_price_cents, 0);
    const discount = typeof body.discount_cents === "number" && body.discount_cents >= 0 ? body.discount_cents : 0;
    const taxPct = typeof body.tax_percent === "number" && body.tax_percent >= 0 ? body.tax_percent : 0;
    const total = Math.max(0, Math.round((subtotal - discount) * (1 + taxPct / 100)));

    const number = await docNumber(env, docType);
    // v1.4.93: salesperson — any staff member; defaults to whoever created it.
    const salespersonId = typeof body.salesperson_id === "number" && body.salesperson_id > 0
      ? Math.round(body.salesperson_id) : user.id;
    // v1.4.94: backdating — payments received before this system existed can
    // be invoiced on their true date. Past dates only, never the future.
    const todayMyt = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
    const docDate = typeof body.doc_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.doc_date) && body.doc_date <= todayMyt
      ? body.doc_date : null;
    const res = await env.DB.prepare(
      `INSERT INTO sales_documents
       (doc_type, doc_number, customer_id, items, discount_cents, tax_percent, total_cents,
        notes, valid_until, delivery_status, payment_status, due_date, salesperson_id, created_by, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, COALESCE(?15, datetime('now'))) RETURNING id`,
    ).bind(
      docType, number, customerId, JSON.stringify(items), discount, taxPct, total,
      str(body.notes, 2000) ? body.notes : null,
      docType === "QT" && str(body.valid_until, 10) ? body.valid_until : null,
      docType === "DO" ? "pending" : null,
      docType === "INV" ? "unpaid" : null,
      docType === "INV" && str(body.due_date, 10) ? body.due_date : null,
      salespersonId,
      user.id,
      docDate ? `${docDate} 00:00:00` : null,
    ).first<{ id: number }>();
    // v1.4.91: payment already in hand — the invoice is born paid (bank
    // transfer) and counts in revenue immediately.
    if (docType === "INV" && body.paid_received === true && res?.id) {
      const payDate = typeof body.paid_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.paid_date) && body.paid_date <= todayMyt
        ? `${body.paid_date} 00:00:00` : (docDate ? `${docDate} 00:00:00` : null);
      await env.DB.prepare(
        `UPDATE sales_documents SET payment_status = 'paid', payment_method = 'bank_transfer',
         payment_ref = ?1, paid_at = COALESCE(?2, datetime('now')) WHERE id = ?3`,
      ).bind(typeof body.payment_ref === "string" ? body.payment_ref.slice(0, 120) : null, payDate, res.id).run();
    }
    await audit(env, user.id, `doc.create_${docType.toLowerCase()}`, "sales_documents", String(res?.id));
    return json({ id: res?.id, doc_number: number, total_cents: total }, 201);
  }
  const docGet = path.match(/^\/docs\/(\d+)$/);
  if (docGet && method === "GET") {
    if (!can(user, "sales")) return err("forbidden", "Sales access required", 403);
    const d = await env.DB.prepare(
      `SELECT d.*, c.company, c.contact_person, c.email AS customer_email, c.phone AS customer_phone, c.address,
              sp.name AS salesperson_name, cb.role AS created_by_role
       FROM sales_documents d JOIN customers c ON c.id = d.customer_id
       LEFT JOIN users sp ON sp.id = d.salesperson_id
       LEFT JOIN users cb ON cb.id = d.created_by WHERE d.id = ?1`,
    ).bind(docGet[1]).first<Record<string, unknown>>();
    if (!d) return err("not_found", "Document not found", 404);
    // v1.4.99: the printed signature block names the signer — the COO on the
    // COO's own documents, otherwise the CEO — full name + position.
    const signRole = d.created_by_role === "coo" ? "coo" : "ceo";
    const signer = await env.DB.prepare(
      `SELECT COALESCE(full_name, name) AS signer_name, position FROM users
       WHERE role = ?1 AND is_active = 1 ORDER BY id LIMIT 1`,
    ).bind(signRole).first<{ signer_name: string; position: string | null }>();
    return json({ doc: {
      ...d,
      signer_role: signRole,
      signer_name: signer?.signer_name ?? "AZ ONE OFFICIAL",
      signer_position: signer?.position ?? (signRole === "coo" ? "Chief Operating Officer" : "Chief Executive Officer"),
    } });
  }

  const docMatch = path.match(/^\/docs\/(\d+)$/);
  if (docMatch && method === "PATCH") {
    const id = docMatch[1]!;
    const doc = await env.DB.prepare(`SELECT doc_type FROM sales_documents WHERE id = ?1`)
      .bind(id).first<{ doc_type: string }>();
    if (!doc) return err("not_found", "Document not found", 404);
    if (doc.doc_type === "INV") {
      if (!can(user, "finance")) return err("forbidden", "Finance access required", 403);
      const ok = typeof body?.payment_status === "string" && ["unpaid", "paid", "overdue"].includes(body.payment_status);
      if (!ok) return err("invalid_input", "payment_status must be unpaid|paid|overdue", 400);
      // v1.4.90: paid = payment received — record method (bank transfer),
      // optional reference, and the moment. Revenue counts from paid_at.
      if (body!.payment_status === "paid") {
        const methods = ["bank_transfer", "cash", "cheque", "other"];
        const methodP = typeof body!.payment_method === "string" && methods.includes(body!.payment_method)
          ? (body!.payment_method as string) : "bank_transfer";
        const refP = typeof body!.payment_ref === "string" ? body!.payment_ref.slice(0, 120) : null;
        await env.DB.prepare(
          `UPDATE sales_documents SET payment_status = 'paid', payment_method = ?1, payment_ref = ?2,
           paid_at = COALESCE(paid_at, datetime('now')) WHERE id = ?3`,
        ).bind(methodP, refP, id).run();
      } else {
        await env.DB.prepare(
          `UPDATE sales_documents SET payment_status = ?1, payment_method = NULL, payment_ref = NULL, paid_at = NULL WHERE id = ?2`,
        ).bind(body!.payment_status, id).run();
      }
    } else if (doc.doc_type === "DO") {
      if (!can(user, "sales")) return err("forbidden", "Sales access required", 403);
      const ok = typeof body?.delivery_status === "string" && ["pending", "delivered"].includes(body.delivery_status);
      if (!ok) return err("invalid_input", "delivery_status must be pending|delivered", 400);
      await env.DB.prepare(`UPDATE sales_documents SET delivery_status = ?1 WHERE id = ?2`)
        .bind(body!.delivery_status, id).run();
    } else {
      return err("invalid_input", "Quotations have no status updates yet", 400);
    }
    await audit(env, user.id, "doc.update_status", "sales_documents", id);
    return json({ ok: true });
  }
  const docConv = path.match(/^\/docs\/(\d+)\/convert$/);
  if (docConv && method === "POST") {
    // v1.4.101: one-click Quotation → Invoice — accepted quotes are never
    // retyped. Same items/customer/salesperson, fresh INV number, audited.
    if (!can(user, "finance")) return err("forbidden", "Finance access required to raise invoices", 403);
    const qt = await env.DB.prepare(
      `SELECT * FROM sales_documents WHERE id = ?1 AND doc_type = 'QT'`,
    ).bind(docConv[1]).first<Record<string, unknown>>();
    if (!qt) return err("not_found", "Quotation not found", 404);
    const numberC = await docNumber(env, "INV");
    const resC = await env.DB.prepare(
      `INSERT INTO sales_documents
       (doc_type, doc_number, customer_id, items, discount_cents, tax_percent, total_cents,
        notes, payment_status, salesperson_id, created_by)
       VALUES ('INV', ?1, ?2, ?3, ?4, ?5, ?6, ?7, 'unpaid', ?8, ?9) RETURNING id`,
    ).bind(
      numberC, qt.customer_id, qt.items, qt.discount_cents ?? 0, qt.tax_percent ?? 0, qt.total_cents ?? 0,
      qt.notes ?? null, qt.salesperson_id ?? user.id, user.id,
    ).first<{ id: number }>();
    await audit(env, user.id, "doc.convert_qt_inv", "sales_documents", String(resC?.id), { from: qt.doc_number });
    return json({ id: resC?.id, doc_number: numberC }, 201);
  }
  const docEdit = path.match(/^\/docs\/(\d+)\/edit$/);
  if (docEdit && method === "POST") {
    // v1.4.94: fix typos on an existing document — items, amounts, customer,
    // salesperson, date. The document NUMBER never changes; totals recompute;
    // audited. Invoice edits need finance rights, like invoice creation.
    const idE = docEdit[1]!;
    const docE = await env.DB.prepare(`SELECT doc_type FROM sales_documents WHERE id = ?1`)
      .bind(idE).first<{ doc_type: string }>();
    if (!docE) return err("not_found", "Document not found", 404);
    if (docE.doc_type === "INV" ? !can(user, "finance") : !can(user, "sales")) {
      return err("forbidden", "Insufficient rights to edit this document type", 403);
    }
    if (!body || !Array.isArray(body.items) || body.items.length === 0) {
      return err("invalid_input", "items are required", 400);
    }
    const itemsE = (body.items as { name?: unknown; qty?: unknown; unit_price_cents?: unknown }[])
      .filter((i) => str(i.name, 200) && typeof i.qty === "number" && i.qty > 0 && typeof i.unit_price_cents === "number" && i.unit_price_cents >= 0)
      .map((i) => ({ name: i.name as string, qty: i.qty as number, unit_price_cents: i.unit_price_cents as number }));
    if (itemsE.length === 0) return err("invalid_input", "Each item needs name, qty, unit_price_cents", 400);
    const subE = itemsE.reduce((a, i) => a + i.qty * i.unit_price_cents, 0);
    const discE = typeof body.discount_cents === "number" && body.discount_cents >= 0 ? body.discount_cents : 0;
    const taxE = typeof body.tax_percent === "number" && body.tax_percent >= 0 ? body.tax_percent : 0;
    const totalE = Math.max(0, Math.round((subE - discE) * (1 + taxE / 100)));
    let custE: number | null = typeof body.customer_id === "number" && body.customer_id > 0 ? body.customer_id : null;
    if (body.customer_id === 0) {
      const wi = await env.DB.prepare(`SELECT id FROM customers WHERE company = 'Walk-in Customer'`).first<{ id: number }>();
      custE = wi?.id ?? null;
    }
    const spE = typeof body.salesperson_id === "number" && body.salesperson_id > 0 ? Math.round(body.salesperson_id) : null;
    const todayE = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
    const dateE = typeof body.doc_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.doc_date) && body.doc_date <= todayE
      ? `${body.doc_date} 00:00:00` : null;
    await env.DB.prepare(
      `UPDATE sales_documents SET items = ?1, discount_cents = ?2, tax_percent = ?3, total_cents = ?4,
       customer_id = COALESCE(?5, customer_id), salesperson_id = COALESCE(?6, salesperson_id),
       created_at = COALESCE(?7, created_at) WHERE id = ?8`,
    ).bind(JSON.stringify(itemsE), discE, taxE, totalE, custE, spE, dateE, idE).run();
    await audit(env, user.id, "doc.edit", "sales_documents", idE, { total_cents: totalE });
    return json({ ok: true, total_cents: totalE });
  }

  /* ---- notifications ---- */

  /* ---- Holidays / company calendar ---- */

  if (path === "/holidays" && method === "GET") {
    // Any signed-in staff can see the calendar.
    const url = new URL(request.url);
    const year = url.searchParams.get("year") ?? String(new Date().getFullYear());
    const { results } = await env.DB.prepare(
      `SELECT id, holiday_date, name, kind FROM holidays
       WHERE holiday_date LIKE ?1 || '%' ORDER BY holiday_date`,
    ).bind(year).all();
    return json({ holidays: results });
  }
  if (path === "/holidays" && method === "POST") {
    if (!can(user, "hr_manage")) return err("forbidden", "HR access required", 403);
    if (!body || !str(body.holiday_date, 10) || !str(body.name, 120)) {
      return err("invalid_input", "holiday_date (YYYY-MM-DD) and name are required", 400);
    }
    const kinds = ["public", "company", "replacement"];
    const kind = kinds.includes(body.kind as string) ? (body.kind as string) : "public";
    try {
      await env.DB.prepare(
        `INSERT INTO holidays (holiday_date, name, kind, created_by) VALUES (?1, ?2, ?3, ?4)`,
      ).bind(body.holiday_date, body.name, kind, user.id).run();
    } catch {
      return err("conflict", "A holiday already exists on that date", 409);
    }
    await audit(env, user.id, "holiday.create");
    // v1.4.81 company policy: a PUBLIC holiday landing on Saturday or Sunday
    // is auto-replaced on Monday — or the next free working day when Monday
    // is itself a holiday. (Manual replacements remain possible via
    // kind = replacement; delete the auto row to follow the state gazette,
    // which replaces Sundays only.)
    let replacement: string | null = null;
    const dow = new Date(body.holiday_date + "T00:00:00Z").getUTCDay();
    if (kind === "public" && (dow === 0 || dow === 6)) {
      const d = new Date(body.holiday_date + "T00:00:00Z");
      d.setUTCDate(d.getUTCDate() + (dow === 6 ? 2 : 1)); // → Monday
      for (let i = 0; i < 14; i++) {
        const iso = d.toISOString().slice(0, 10);
        const wd = d.getUTCDay();
        const taken = wd === 0 || wd === 6
          ? { x: 1 }
          : await env.DB.prepare(`SELECT 1 AS x FROM holidays WHERE holiday_date = ?1`).bind(iso).first();
        if (!taken) { replacement = iso; break; }
        d.setUTCDate(d.getUTCDate() + 1);
      }
      if (replacement) {
        await env.DB.prepare(
          `INSERT OR IGNORE INTO holidays (holiday_date, name, kind, created_by) VALUES (?1, ?2, 'replacement', ?3)`,
        ).bind(replacement, `${body.name as string} (Replacement)`, user.id).run();
        await audit(env, user.id, "holiday.create", "holidays", replacement, { auto_replacement_for: body.holiday_date });
      }
    }
    return json({ ok: true, replacement }, 201);
  }
  const holMatch = path.match(/^\/holidays\/(\d+)$/);
  if (holMatch && method === "DELETE") {
    if (!can(user, "hr_manage")) return err("forbidden", "HR access required", 403);
    await env.DB.prepare(`DELETE FROM holidays WHERE id = ?1`).bind(holMatch[1]).run();
    await audit(env, user.id, "holiday.delete", "holidays", holMatch[1]);
    return json({ ok: true });
  }

  /* ---- Leave entitlement editor (admin/HR) ---- */

  if (path === "/leave/entitlement" && method === "GET") {
    if (!can(user, "hr_manage")) return err("forbidden", "HR access required", 403);
    const url = new URL(request.url);
    const year = Number(url.searchParams.get("year") ?? new Date().getFullYear());
    const uid = Number(url.searchParams.get("user_id"));
    if (!uid) return err("invalid_input", "user_id required", 400);
    const { results } = await env.DB.prepare(
      `SELECT type, entitled FROM leave_balances WHERE user_id = ?1 AND year = ?2`,
    ).bind(uid, year).all();
    const map: Record<string, number> = {};
    for (const r of results as { type: string; entitled: number }[]) map[r.type] = r.entitled;
    return json({ year, user_id: uid, entitlement: map });
  }
  if (path === "/leave/entitlement" && method === "PUT") {
    if (!can(user, "hr_manage")) return err("forbidden", "HR access required", 403);
    const year = Number(body?.year ?? new Date().getFullYear());
    const uid = Number(body?.user_id);
    const type = str(body?.type, 40) ? (body!.type as string) : "";
    const entitled = Number(body?.entitled);
    if (!uid || !type || !(entitled >= 0)) {
      return err("invalid_input", "user_id, type and entitled (>=0) are required", 400);
    }
    await env.DB.prepare(
      `INSERT INTO leave_balances (user_id, year, type, entitled) VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT(user_id, year, type) DO UPDATE SET entitled = ?4`,
    ).bind(uid, year, type, entitled).run();
    await audit(env, user.id, "leave.entitlement", "users", String(uid), { type, entitled });
    return json({ ok: true });
  }

  /* ---- Payslip (basic payroll output) ---- */

  if (path === "/payslip" && method === "GET") {
    if (!can(user, "payroll_export")) return err("forbidden", "Payroll access required", 403);
    const url = new URL(request.url);
    const month = url.searchParams.get("month") ?? new Date().toISOString().slice(0, 7);
    const uid = Number(url.searchParams.get("user_id"));
    if (!uid) return err("invalid_input", "user_id required", 400);
    const staff = await env.DB.prepare(
      `SELECT name, email, employee_id, position, department FROM users WHERE id = ?1`,
    ).bind(uid).first<Record<string, string>>();
    if (!staff) return err("not_found", "Staff not found", 404);
    // Attendance summary for the month (MYT), by clock event flag.
    const { results: att } = await env.DB.prepare(
      `SELECT type, created_at FROM attendance_records WHERE user_id = ?1 AND created_at LIKE ?2 || '%'`,
    ).bind(uid, month).all();
    let present = 0, late = 0, halfDay = 0, earlyOut = 0;
    const days = new Set<string>();
    for (const r of att as { type: string; created_at: string }[]) {
      const myt = new Date(new Date(r.created_at + "Z").getTime() + 8 * 3600 * 1000);
      const mins = myt.getUTCHours() * 60 + myt.getUTCMinutes();
      const day = myt.toISOString().slice(0, 10);
      if (r.type === "clock_in") {
        days.add(day);
        if (mins > 10 * 60 + 5 && mins < 13 * 60) late++;
        else if (mins >= 13 * 60) halfDay++;
        else present++;
      } else if (r.type === "clock_out" && mins < 18 * 60 && mins > 13 * 60) earlyOut++;
    }
    // Approved leave days in the month.
    const leave = await env.DB.prepare(
      `SELECT COALESCE(SUM(days), 0) AS d FROM leave_requests
       WHERE user_id = ?1 AND status = 'approved' AND start_date LIKE ?2 || '%'`,
    ).bind(uid, month).first<{ d: number }>();
    return json({
      month,
      staff,
      attendance: {
        days_present: days.size,
        on_time: present,
        late,
        half_days: halfDay,
        early_outs: earlyOut,
      },
      approved_leave_days: leave?.d ?? 0,
    });
  }

  /* ---- HR / payroll: attendance CSV export ---- */

  /* ---- attendance corrections (CEO + admin tier, v1.4.28) ----
     Manual entries cover days worked before the system existed; amendments
     fix wrong punches. Every action names its actor and is audit-logged. */

  const ATT_ADMIN = user.role === "super_admin" || user.role === "admin" || user.role === "ceo";

  if (path === "/attendance/manual" && method === "POST") {
    if (!ATT_ADMIN) return err("forbidden", "CEO or admin access required", 403);
    const types = ["clock_in", "clock_out"];
    const myt = str(body?.myt, 16) ? (body!.myt as string) : ""; // "YYYY-MM-DD HH:MM" Malaysia time
    if (!body || typeof body.user_id !== "number" || typeof body.type !== "string" ||
        !types.includes(body.type) || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(myt)) {
      return err("invalid_input", "user_id, type (clock_in|clock_out) and myt (YYYY-MM-DD HH:MM) are required", 400);
    }
    // Store UTC like every real punch: MYT − 8h.
    const utc = new Date(new Date(myt.replace(" ", "T") + ":00Z").getTime() - 8 * 3600 * 1000);
    const createdAt = utc.toISOString().slice(0, 19).replace("T", " ");
    await env.DB.prepare(
      `INSERT INTO attendance_records (user_id, type, created_at, manual_by)
       VALUES (?1, ?2, ?3, ?4)`,
    ).bind(body.user_id, body.type, createdAt, user.id).run();
    await audit(env, user.id, "attendance.manual", "users", String(body.user_id));
    return json({ ok: true }, 201);
  }

  const attMatch = path.match(/^\/attendance\/(\d+)$/);
  if (attMatch && method === "PATCH") {
    if (!ATT_ADMIN) return err("forbidden", "CEO or admin access required", 403);
    const myt = str(body?.myt, 16) ? (body!.myt as string) : "";
    if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(myt)) {
      return err("invalid_input", "myt (YYYY-MM-DD HH:MM, Malaysia time) is required", 400);
    }
    const utc = new Date(new Date(myt.replace(" ", "T") + ":00Z").getTime() - 8 * 3600 * 1000);
    const createdAt = utc.toISOString().slice(0, 19).replace("T", " ");
    const res = await env.DB.prepare(
      `UPDATE attendance_records SET created_at = ?1, amended_by = ?2, amended_at = datetime('now') WHERE id = ?3`,
    ).bind(createdAt, user.id, attMatch[1]).run();
    if (!res.meta.changes) return err("not_found", "Record not found", 404);
    await audit(env, user.id, "attendance.amend", "attendance_records", attMatch[1]);
    return json({ ok: true });
  }
  if (attMatch && method === "DELETE") {
    if (!ATT_ADMIN) return err("forbidden", "CEO or admin access required", 403);
    const res = await env.DB.prepare(`DELETE FROM attendance_records WHERE id = ?1`).bind(attMatch[1]).run();
    if (!res.meta.changes) return err("not_found", "Record not found", 404);
    await audit(env, user.id, "attendance.delete", "attendance_records", attMatch[1]);
    return json({ ok: true });
  }

  /* ---- Payroll processing (v1.4.36) ----
     hr_manage (CEO now, hr_admin from next month, admin tier) writes;
     exec_view reads. Amounts stored in sen. */

  const PAYROLL_PROC = ["super_admin", "admin", "ceo", "coo"];

  /** Payslip side-data (v1.4.41): the month's working days, public holidays,
      approved leave, and remaining annual/medical balances — the OTHERS and
      BALANCE sections of the Malaysian payslip layout. */
  /** v1.4.80: when a payroll month's slips become visible to staff —
      the 5th of the FOLLOWING month, 10:00 MYT, shifted forward past
      weekends and public holidays (never earlier). Returns "YYYY-MM-DD 10:00"
      in MYT wall time. */
  const payslipAvailableFrom = async (month: string): Promise<string> => {
    const y = Number(month.slice(0, 4));
    const m = Number(month.slice(5, 7)); // 1-based payroll month
    const d = new Date(Date.UTC(y, m, 5)); // 5th of the NEXT month
    for (let i = 0; i < 14; i++) {
      const iso = d.toISOString().slice(0, 10);
      const dow = d.getUTCDay();
      const hol = dow !== 0 && dow !== 6
        ? await env.DB.prepare(`SELECT 1 AS x FROM holidays WHERE holiday_date = ?1`).bind(iso).first()
        : null;
      if (dow !== 0 && dow !== 6 && !hol) break;
      d.setUTCDate(d.getUTCDate() + 1);
    }
    return `${d.toISOString().slice(0, 10)} 10:00`;
  };

  const payslipExtras = async (uid: number, month: string) => {
    const wd = await env.DB.prepare(
      `SELECT COUNT(DISTINCT date(created_at, '+8 hours')) AS n FROM attendance_records
       WHERE user_id = ?1 AND type = 'clock_in' AND strftime('%Y-%m', created_at, '+8 hours') = ?2`,
    ).bind(uid, month).first<{ n: number }>();
    const ph = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM holidays WHERE holiday_date LIKE ?1 || '%'`,
    ).bind(month).first<{ n: number }>();
    const leaveDays = async (t: string) =>
      (await env.DB.prepare(
        `SELECT COALESCE(SUM(days), 0) AS n FROM leave_requests
         WHERE user_id = ?1 AND type = ?2 AND status = 'approved' AND start_date LIKE ?3 || '%'`,
      ).bind(uid, t, month).first<{ n: number }>())?.n ?? 0;
    // Balances: same accrual rules as /leave/balance (annual accrues monthly
    // from the company-start window; medical is statutory-full).
    const year = Number(month.slice(0, 4));
    const monthNum = Number(month.slice(5, 7));
    const windowStart = year === 2026 ? 7 : 1;
    const monthsTotal = 12 - windowStart + 1;
    const monthsElapsed = Math.min(Math.max(monthNum - windowStart + 1, 0), monthsTotal);
    const bal = async (t: string, full: boolean) => {
      const ent = await env.DB.prepare(
        `SELECT entitled FROM leave_balances WHERE user_id = ?1 AND year = ?2 AND type = ?3`,
      ).bind(uid, year, t).first<{ entitled: number }>();
      // Usage counted only up to the END of the payroll month — the slip
      // reflects that month's eligibility, not the day it was printed.
      const used = await env.DB.prepare(
        `SELECT COALESCE(SUM(days), 0) AS used FROM leave_requests
         WHERE user_id = ?1 AND type = ?2 AND status = 'approved'
         AND start_date LIKE ?3 || '%' AND start_date <= ?4`,
      ).bind(uid, t, String(year), `${month}-31`).first<{ used: number }>();
      const entitled = ent?.entitled ?? DEFAULT_ENTITLEMENT[t] ?? 0;
      const accrued = full ? entitled : Math.floor(((entitled * monthsElapsed) / monthsTotal) * 2) / 2;
      return Math.max(0, accrued - (used?.used ?? 0));
    };
    // v1.4.79: unpaid leave now appears as an EXPLICIT payslip deduction —
    // basic stays full and the slip shows why the pay is lower (fairness).
    // Rate follows the Employment Act 1955 s.60I ordinary rate of pay:
    // monthly wages ÷ 26 per day. Emergency leave is PAID (own 3-day
    // entitlement, common Malaysian practice) — shown in OTHERS, never
    // deducted.
    const unpaidDays = await leaveDays("unpaid");
    const emergencyDays = await leaveDays("emergency");
    let orpBase = (await env.DB.prepare(
      `SELECT base_salary_cents FROM users WHERE id = ?1`,
    ).bind(uid).first<{ base_salary_cents: number }>())?.base_salary_cents ?? 0;
    if (!orpBase) {
      orpBase = (await env.DB.prepare(
        `SELECT basic_cents FROM payroll_entries WHERE user_id = ?1 AND month = ?2`,
      ).bind(uid, month).first<{ basic_cents: number }>())?.basic_cents ?? 0;
    }
    const unpaidDeduction = unpaidDays > 0 ? Math.round((orpBase / 26) * unpaidDays) : 0;
    return {
      working_day: wd?.n ?? 0,
      public_holiday: ph?.n ?? 0,
      annual_leave: await leaveDays("annual"),
      medical_leave: await leaveDays("medical"),
      emergency_leave: emergencyDays,
      unpaid_leave: unpaidDays,
      unpaid_deduction_cents: unpaidDeduction,
      annual_bal: await bal("annual", false),
      sick_bal: await bal("medical", true),
    };
  };

  // Every staff member can view (and print) their OWN payslip — never edit.
  if (path === "/payroll/self" && method === "GET") {
    const url0 = new URL(request.url);
    const m0 = url0.searchParams.get("month") ?? new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 7);
    // v1.4.80: a month's slip is visible only from the release moment (5th of
    // the next month, 10:00 MYT, next working day if that's a holiday or
    // weekend) — or once the month is manually released.
    // v1.4.83: NO exceptions — the CEO's instruction is that "My payslip" is
    // locked for EVERYONE before release, payroll processors included. (The
    // Payroll processing tab necessarily still shows figures to processors —
    // they type them there; this lock governs the payslip view itself.)
    {
      const availableFrom = await payslipAvailableFrom(m0);
      const released = await env.DB.prepare(
        `SELECT released_at FROM payslip_releases WHERE month = ?1`,
      ).bind(m0).first<{ released_at: string }>();
      const nowMyt = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 16).replace("T", " ");
      if (!released && nowMyt < availableFrom) {
        return json({ month: m0, entry: null, extras: null, locked: true, available_from: availableFrom });
      }
    }
    const entry = await env.DB.prepare(
      `SELECT p.*, u.name, u.full_name, u.employee_id, u.position, u.department,
              u.employment_status, u.bank_name, u.bank_account, u.joined_on, u.ic_number
       FROM payroll_entries p JOIN users u ON u.id = p.user_id
       WHERE p.user_id = ?1 AND p.month = ?2`,
    ).bind(user.id, m0).first();
    const joined = await env.DB.prepare(`SELECT joined_on FROM users WHERE id = ?1`)
      .bind(user.id).first<{ joined_on: string | null }>();
    return json({
      month: m0,
      entry: entry ?? null,
      extras: entry ? await payslipExtras(user.id, m0) : null,
      joined_on: joined?.joined_on ?? null,
    });
  }

  if (path === "/payroll" && method === "GET") {
    // Full payroll is for the processors only (v1.4.40): CEO and COO run it,
    // admin tier as backstop. hr_admin and CCO no longer see other people's pay.
    if (!PAYROLL_PROC.includes(user.role)) {
      return err("forbidden", "Payroll access required", 403);
    }
    const url = new URL(request.url);
    const month = url.searchParams.get("month") ?? new Date().toISOString().slice(0, 7);
    const { results } = await env.DB.prepare(
      `SELECT p.*, u.name, u.full_name, u.employee_id, u.position, u.department,
              u.employment_status, u.bank_name, u.bank_account, u.ic_number
       FROM payroll_entries p JOIN users u ON u.id = p.user_id
       WHERE p.month = ?1 ORDER BY u.name`,
    ).bind(month).all();
    const releasedRow = await env.DB.prepare(
      `SELECT released_at, released_by FROM payslip_releases WHERE month = ?1`,
    ).bind(month).first();
    return json({
      month, entries: results,
      release: { available_from: await payslipAvailableFrom(month), released: releasedRow ?? null },
    });
  }
  if (path === "/payroll/paid" && method === "POST") {
    // v1.4.101: the Expenses "Payments due" card records that the payroll
    // bank run for a month has been DONE.
    if (!can(user, "expenses")) return err("forbidden", "Expenses access required", 403);
    const mP = typeof body?.month === "string" && /^\d{4}-\d{2}$/.test(body.month) ? body.month : null;
    if (!mP) return err("invalid_input", "month (YYYY-MM) is required", 400);
    await env.DB.prepare(
      `INSERT INTO payroll_payments (month, paid_by) VALUES (?1, ?2) ON CONFLICT(month) DO NOTHING`,
    ).bind(mP, user.id).run();
    await audit(env, user.id, "payroll.paid", "payroll_payments", mP);
    return json({ ok: true });
  }
  if (path === "/payroll/release" && method === "POST") {
    // Early manual release for a month (e.g. the 5th falls badly and the
    // CEO decides to release before the automatic moment). One-way; audited.
    if (!PAYROLL_PROC.includes(user.role)) return err("forbidden", "Payroll access required", 403);
    const mR = typeof body?.month === "string" && /^\d{4}-\d{2}$/.test(body.month) ? body.month : null;
    if (!mR) return err("invalid_input", "month (YYYY-MM) is required", 400);
    await env.DB.prepare(
      `INSERT INTO payslip_releases (month, released_by) VALUES (?1, ?2)
       ON CONFLICT(month) DO NOTHING`,
    ).bind(mR, user.id).run();
    await audit(env, user.id, "payroll.release", "payslip_releases", mR);
    return json({ ok: true });
  }
  if (path === "/payroll/base" && method === "GET") {
    // v1.4.78: fixed basic salaries — the source Payroll auto-fills from.
    if (!PAYROLL_PROC.includes(user.role)) return err("forbidden", "Payroll access required", 403);
    const { results } = await env.DB.prepare(
      `SELECT id AS user_id, base_salary_cents FROM users
       WHERE role NOT IN ('customer', 'super_admin') AND is_active = 1`,
    ).all();
    return json({ base: results });
  }
  if (path === "/payroll/base" && method === "POST") {
    // Set / adjust one person's fixed basic (increments happen here).
    if (!PAYROLL_PROC.includes(user.role)) return err("forbidden", "Payroll access required", 403);
    const uid = Number(body?.user_id);
    const cents = Math.round(Number(body?.base_salary_cents));
    if (!uid || !Number.isFinite(cents) || cents < 0 || cents > 100000000) {
      return err("invalid_input", "user_id and a non-negative base_salary_cents are required", 400);
    }
    await env.DB.prepare(`UPDATE users SET base_salary_cents = ?1 WHERE id = ?2`).bind(cents, uid).run();
    await audit(env, user.id, "payroll.base_update", "users", String(uid), { base_salary_cents: cents });
    return json({ ok: true });
  }
  if (path === "/payroll/attendance-days" && method === "GET") {
    // v1.4.77: auto-calculation source — how many distinct days each staff
    // member clocked in during the month (MYT dates). Payroll fills the
    // "days worked" inputs from this; the inputs STAY editable so a wrong or
    // dishonest punch can be overridden (and permanently corrected in
    // Attendance → corrections & back-entry).
    if (!PAYROLL_PROC.includes(user.role)) return err("forbidden", "Payroll access required", 403);
    const urlA = new URL(request.url);
    const mA = urlA.searchParams.get("month") ?? new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 7);
    const { results } = await env.DB.prepare(
      `SELECT user_id, COUNT(DISTINCT date(created_at, '+8 hours')) AS days
       FROM attendance_records
       WHERE type = 'clock_in' AND strftime('%Y-%m', created_at, '+8 hours') = ?1
       GROUP BY user_id`,
    ).bind(mA).all<{ user_id: number; days: number }>();
    // v1.4.79: approved unpaid-leave days too — the panel flags them so the
    // processor knows the payslip will auto-deduct (and doesn't double-deduct).
    const { results: unpaid } = await env.DB.prepare(
      `SELECT user_id, COALESCE(SUM(days), 0) AS days FROM leave_requests
       WHERE type = 'unpaid' AND status = 'approved' AND start_date LIKE ?1 || '%'
       GROUP BY user_id`,
    ).bind(mA).all<{ user_id: number; days: number }>();
    // v1.4.84: the month's TRUE working-day count, computed — Mon–Fri minus
    // every holiday on the calendar (public, replacement and company days).
    // This is what "working days" means on the payslip; July 2026 = 22
    // (23 weekdays − Hari Hol 21-07), NOT a blanket 26. The statutory ÷26
    // used for unpaid leave is a separate, fixed Employment Act rate.
    const yA = Number(mA.slice(0, 4));
    const moA = Number(mA.slice(5, 7));
    const lastDay = new Date(Date.UTC(yA, moA, 0)).getUTCDate();
    const { results: hols } = await env.DB.prepare(
      `SELECT holiday_date FROM holidays WHERE holiday_date LIKE ?1 || '%'`,
    ).bind(mA).all<{ holiday_date: string }>();
    const holSet = new Set(hols.map((h) => h.holiday_date));
    let workingDays = 0;
    for (let d = 1; d <= lastDay; d++) {
      const dt = new Date(Date.UTC(yA, moA - 1, d));
      const dow = dt.getUTCDay();
      if (dow >= 1 && dow <= 5 && !holSet.has(dt.toISOString().slice(0, 10))) workingDays++;
    }
    return json({ month: mA, days: results, unpaid, working_days: workingDays });
  }
  if (path === "/payroll/detail" && method === "GET") {
    if (!PAYROLL_PROC.includes(user.role)) return err("forbidden", "Payroll access required", 403);
    const urlD = new URL(request.url);
    const uid = Number(urlD.searchParams.get("user_id"));
    const mD = urlD.searchParams.get("month") ?? new Date().toISOString().slice(0, 7);
    if (!uid) return err("invalid_input", "user_id is required", 400);
    return json({ extras: await payslipExtras(uid, mD) });
  }

  if (path === "/payroll" && method === "POST") {
    if (!PAYROLL_PROC.includes(user.role)) return err("forbidden", "Payroll access required", 403);
    const month = str(body?.month, 7) && /^\d{4}-\d{2}$/.test(body!.month as string) ? (body!.month as string) : null;
    if (!body || typeof body.user_id !== "number" || !month) {
      return err("invalid_input", "user_id and month (YYYY-MM) are required", 400);
    }
    const cents = (v: unknown) => (typeof v === "number" && v >= 0 ? Math.round(v) : 0);
    // v1.4.82: worked_days + month_working_days persist the incomplete-month
    // basis (null = full month, no adjustment). Basic itself stays FULL.
    const intOrNull = (v: unknown) =>
      typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 31 ? Math.round(v) : null;
    // v1.4.85: overtime — hours (0–300, halves allowed) + the computed sen.
    const otHours = typeof body.ot_hours === "number" && Number.isFinite(body.ot_hours) && body.ot_hours > 0 && body.ot_hours <= 300
      ? Math.round(body.ot_hours * 2) / 2 : null;
    await env.DB.prepare(
      `INSERT INTO payroll_entries (user_id, month, basic_cents, commission_cents, allowance_cents, ot_hours, ot_cents, deduction_cents, worked_days, month_working_days, note, created_by)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
       ON CONFLICT (user_id, month) DO UPDATE SET
         basic_cents = ?3, commission_cents = ?4, allowance_cents = ?5,
         ot_hours = ?6, ot_cents = ?7,
         deduction_cents = ?8, worked_days = ?9, month_working_days = ?10,
         note = ?11, updated_at = datetime('now')`,
    ).bind(
      body.user_id, month,
      cents(body.basic_cents), cents(body.commission_cents),
      cents(body.allowance_cents), otHours, cents(body.ot_cents),
      cents(body.deduction_cents),
      intOrNull(body.worked_days), intOrNull(body.month_working_days),
      str(body.note, 300) ? body.note : null, user.id,
    ).run();
    await audit(env, user.id, "payroll.save", "users", String(body.user_id), { month });
    return json({ ok: true });
  }

  if (path === "/attendance/export" && method === "GET") {
    if (!can(user, "payroll_export")) return err("forbidden", "Payroll export access required", 403);
    const url = new URL(request.url);
    const month = url.searchParams.get("month") ?? new Date().toISOString().slice(0, 7);
    const { results } = await env.DB.prepare(
      `SELECT u.name, u.email, u.employee_id, a.type, a.created_at
       FROM attendance_records a JOIN users u ON u.id = a.user_id
       WHERE a.created_at LIKE ?1 || '%' ORDER BY u.name, a.created_at`,
    ).bind(month).all();
    // Convert each event to Malaysia time and flag against the shift, so the
    // CSV that goes to payroll already reflects local working hours.
    const rows = (results as { name: string; email: string; employee_id: string | null; type: string; created_at: string }[]).map((r) => {
      const myt = new Date(new Date(r.created_at + "Z").getTime() + 8 * 3600 * 1000);
      const dayIdx = myt.getUTCDay();
      const minutes = myt.getUTCHours() * 60 + myt.getUTCMinutes();
      const workday = dayIdx >= 1 && dayIdx <= 5;
      const flag = !workday ? "weekend"
        : r.type === "clock_in" && minutes > SHIFT.startMinutes ? "late"
        : r.type === "clock_out" && minutes < SHIFT.endMinutes ? "early_out"
        : "ok";
      const date = myt.toISOString().slice(0, 10);
      const time = myt.toISOString().slice(11, 16);
      return [r.employee_id ?? "", r.name, r.email, date, time, r.type, flag];
    });
    const header = ["employee_id", "name", "email", "date_myt", "time_myt", "event", "shift_flag"];
    const esc = (v: string) => /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
    const csv = [header, ...rows].map((row) => row.map((c) => esc(String(c))).join(",")).join("\r\n");
    await audit(env, user.id, "attendance.export", "attendance_records", month);
    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="attendance-${month}.csv"`,
      },
    });
  }

  /* ---- HR: task reports (daily / weekly / monthly) ---- */

  if (path === "/task-reports" && method === "GET") {
    if (!can(user, "task_reports") && !can(user, "exec_view")) {
      return err("forbidden", "HR or executive access required", 403);
    }
    const { results } = await env.DB.prepare(
      `SELECT t.id, t.period, t.report_date, t.content, t.created_at, u.name AS author
       FROM task_reports t LEFT JOIN users u ON u.id = t.created_by
       ORDER BY t.report_date DESC, t.id DESC LIMIT 100`,
    ).all();
    return json({ reports: results });
  }
  if (path === "/task-reports" && method === "POST") {
    if (!can(user, "task_reports")) return err("forbidden", "HR access required", 403);
    const periods = ["daily", "weekly", "monthly"];
    if (
      !body || typeof body.period !== "string" || !periods.includes(body.period) ||
      !str(body.report_date, 10) || !str(body.content, 8000)
    ) {
      return err("invalid_input", "period (daily/weekly/monthly), report_date and content are required", 400);
    }
    await env.DB.prepare(
      `INSERT INTO task_reports (period, report_date, content, created_by) VALUES (?1, ?2, ?3, ?4)`,
    ).bind(body.period, body.report_date, body.content, user.id).run();
    await audit(env, user.id, "hr.task_report", "task_reports");
    return json({ ok: true }, 201);
  }

  /* ---- HR: upcoming staff birthdays ---- */

  if (path === "/birthdays" && method === "GET") {
    // Any staff member can see upcoming birthdays; HR maintains them via
    // PATCH /users/:id (birthday field).
    const { results } = await env.DB.prepare(
      `SELECT name, birthday FROM users
       WHERE birthday IS NOT NULL AND is_active = 1 AND role != 'customer'
       ORDER BY substr(birthday, 6)`,
    ).all();
    return json({ birthdays: results });
  }

  /* ---- Sales & marketing: inventory ---- */

  if (path === "/inventory" && method === "GET") {
    if (!can(user, "inventory") && !can(user, "exec_view")) {
      return err("forbidden", "Inventory access required", 403);
    }
    const { results } = await env.DB.prepare(
      `SELECT i.*, u.name AS updated_by_name FROM inventory_items i
       LEFT JOIN users u ON u.id = i.updated_by ORDER BY i.name`,
    ).all();
    return json({ items: results });
  }
  if (path === "/inventory" && method === "POST") {
    if (!can(user, "inventory")) return err("forbidden", "Inventory access required", 403);
    if (!body || !str(body.sku, 60) || !str(body.name, 200)) {
      return err("invalid_input", "sku and name are required", 400);
    }
    const stock = typeof body.stock === "number" && body.stock >= 0 ? Math.floor(body.stock) : 0;
    const priceC = typeof body.unit_price === "number" && body.unit_price >= 0 ? Math.round(body.unit_price * 100) : 0; // v1.4.101
    try {
      await env.DB.prepare(
        `INSERT INTO inventory_items (sku, name, stock, status, note, unit_price_cents, updated_by)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
      ).bind(body.sku, body.name, stock, stockStatus(stock), str(body.note, 500) ? body.note : null, priceC, user.id).run();
    } catch {
      return err("conflict", "An item with this SKU already exists", 409);
    }
    await audit(env, user.id, "inventory.create");
    return json({ ok: true }, 201);
  }
  const invMatch = path.match(/^\/inventory\/(\d+)$/);
  if (invMatch && method === "PATCH") {
    if (!can(user, "inventory")) return err("forbidden", "Inventory access required", 403);
    if (!body || typeof body.stock !== "number" || body.stock < 0) {
      return err("invalid_input", "stock (>= 0) is required", 400);
    }
    const stock = Math.floor(body.stock);
    const priceU = typeof body.unit_price === "number" && body.unit_price >= 0 ? Math.round(body.unit_price * 100) : null; // v1.4.101
    await env.DB.prepare(
      `UPDATE inventory_items SET stock = ?1, status = ?2,
         note = COALESCE(?3, note), unit_price_cents = COALESCE(?4, unit_price_cents),
         updated_by = ?5, updated_at = datetime('now')
       WHERE id = ?6`,
    ).bind(stock, stockStatus(stock), str(body.note, 500) ? body.note : null, priceU, user.id, invMatch[1]).run();
    await audit(env, user.id, "inventory.update", "inventory_items", invMatch[1]);
    return json({ ok: true });
  }

  /* ---- Sales & marketing: postage tracking ---- */

  if (path === "/postage" && method === "GET") {
    if (!can(user, "inventory") && !can(user, "exec_view")) {
      return err("forbidden", "Access required", 403);
    }
    const { results } = await env.DB.prepare(
      `SELECT p.*, i.name AS item_name,
         (SELECT group_concat(pi.qty || '× ' || ii.name, ', ')
          FROM postage_items pi JOIN inventory_items ii ON ii.id = pi.inventory_item_id
          WHERE pi.postage_id = p.id) AS items_label
       FROM postage_records p LEFT JOIN inventory_items i ON i.id = p.inventory_item_id
       ORDER BY p.updated_at DESC LIMIT 200`,
    ).all();
    return json({ records: results });
  }
  if (path === "/postage" && method === "POST") {
    if (!can(user, "inventory")) return err("forbidden", "Access required", 403);
    if (!body || !str(body.order_ref, 100)) return err("invalid_input", "order_ref is required", 400);
    // Multi-item stock movement (v1.4.32). An order may ship several items in
    // different quantities. Accuracy guarantees, in order:
    //   1. Lines for the same item are MERGED before checking — 2× A + 3× A = 5× A.
    //   2. Every line is validated against current stock FIRST — if ANY line
    //      is short, the WHOLE order is refused; nothing deducts partially.
    //   3. Each deduction uses a guarded UPDATE — "AND stock >= qty" — so even
    //      two people shipping the same item at the same instant cannot push
    //      stock negative; the slower one is refused.
    //   4. Every deduction is audit-logged with item + qty — visible in /admin → Audit.
    type Line = { inventory_item_id: number; qty: number };
    const rawLines: Line[] = Array.isArray(body.items)
      ? (body.items as Line[])
      : typeof body.inventory_item_id === "number"
        ? [{ inventory_item_id: body.inventory_item_id, qty: Number(body.qty) }]
        : [];
    const merged = new Map<number, number>();
    for (const l of rawLines) {
      if (typeof l?.inventory_item_id !== "number" || !(Number(l.qty) >= 1)) {
        return err("invalid_input", "Each line needs inventory_item_id and qty >= 1", 400);
      }
      merged.set(l.inventory_item_id, (merged.get(l.inventory_item_id) ?? 0) + Math.floor(Number(l.qty)));
    }
    if (merged.size > 20) return err("invalid_input", "Maximum 20 item lines per order", 400);
    const lines = [...merged.entries()].map(([id, qty]) => ({ id, qty }));

    // Validate every line before touching anything.
    const shortages: string[] = [];
    for (const l of lines) {
      const item = await env.DB.prepare(
        `SELECT stock, name FROM inventory_items WHERE id = ?1`,
      ).bind(l.id).first<{ stock: number; name: string }>();
      if (!item) return err("not_found", `Inventory item #${l.id} not found`, 404);
      if (item.stock < l.qty) shortages.push(`${item.name}: only ${item.stock} in stock, order needs ${l.qty}`);
    }
    if (shortages.length > 0) {
      return err("insufficient_stock", `Order refused — ${shortages.join("; ")}`, 409);
    }

    // Create the order, then apply guarded deductions + line rows.
    const rec = await env.DB.prepare(
      `INSERT INTO postage_records (order_ref, courier, tracking_no, status, note, updated_by)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6) RETURNING id`,
    ).bind(
      body.order_ref,
      str(body.courier, 80) ? body.courier : null,
      str(body.tracking_no, 120) ? body.tracking_no : null,
      POSTAGE_STATUSES.includes(body.status as string) ? (body.status as string) : "preparing",
      str(body.note, 500) ? body.note : null,
      user.id,
    ).first<{ id: number }>();
    for (const l of lines) {
      const upd = await env.DB.prepare(
        `UPDATE inventory_items SET stock = stock - ?1, updated_by = ?2, updated_at = datetime('now')
         WHERE id = ?3 AND stock >= ?1`,
      ).bind(l.qty, user.id, l.id).run();
      if (!upd.meta.changes) {
        // Race lost between validation and deduction — undo lines already
        // taken for this order and refuse it honestly.
        const { results: taken } = await env.DB.prepare(
          `SELECT inventory_item_id, qty FROM postage_items WHERE postage_id = ?1`,
        ).bind(rec!.id).all();
        for (const t of taken as { inventory_item_id: number; qty: number }[]) {
          await env.DB.prepare(`UPDATE inventory_items SET stock = stock + ?1 WHERE id = ?2`)
            .bind(t.qty, t.inventory_item_id).run();
        }
        await env.DB.prepare(`DELETE FROM postage_items WHERE postage_id = ?1`).bind(rec!.id).run();
        await env.DB.prepare(`DELETE FROM postage_records WHERE id = ?1`).bind(rec!.id).run();
        return err("insufficient_stock", "Order refused — stock changed while saving; nothing was deducted", 409);
      }
      await env.DB.prepare(
        `INSERT INTO postage_items (postage_id, inventory_item_id, qty) VALUES (?1, ?2, ?3)`,
      ).bind(rec!.id, l.id, l.qty).run();
      await env.DB.prepare(
        `UPDATE inventory_items SET status = CASE WHEN stock = 0 THEN 'out_of_stock' WHEN stock <= 5 THEN 'low' ELSE 'in_stock' END WHERE id = ?1`,
      ).bind(l.id).run();
      await audit(env, user.id, "inventory.out", "inventory_items", String(l.id), { qty: l.qty, order: body.order_ref as string });
    }
    await audit(env, user.id, "postage.create", "postage_records", String(rec?.id), { lines: lines.length });
    return json({ ok: true, id: rec?.id }, 201);
  }
  const postMatch = path.match(/^\/postage\/(\d+)$/);
  if (postMatch && method === "PATCH") {
    if (!can(user, "inventory")) return err("forbidden", "Access required", 403);
    if (!body || !POSTAGE_STATUSES.includes(body.status as string)) {
      return err("invalid_input", `status must be one of: ${POSTAGE_STATUSES.join(", ")}`, 400);
    }
    // A shipment marked 'returned' puts its quantity back into stock — once
    // (the restocked flag prevents double-counting on repeated saves).
    if (body.status === "returned") {
      const rec = await env.DB.prepare(
        `SELECT inventory_item_id, qty, restocked FROM postage_records WHERE id = ?1`,
      ).bind(postMatch[1]).first<{ inventory_item_id: number | null; qty: number | null; restocked: number }>();
      if (rec && !rec.restocked) {
        // Restock every line of the order. Multi-item lines live in
        // postage_items; older single-item records used the legacy columns.
        const { results } = await env.DB.prepare(
          `SELECT inventory_item_id, qty FROM postage_items WHERE postage_id = ?1`,
        ).bind(postMatch[1]).all();
        const lines = (results as { inventory_item_id: number; qty: number }[]).length > 0
          ? (results as { inventory_item_id: number; qty: number }[])
          : rec.inventory_item_id && rec.qty
            ? [{ inventory_item_id: rec.inventory_item_id, qty: rec.qty }]
            : [];
        for (const l of lines) {
          await env.DB.prepare(
            `UPDATE inventory_items SET stock = stock + ?1,
               status = CASE WHEN stock + ?1 = 0 THEN 'out_of_stock' WHEN stock + ?1 <= 5 THEN 'low' ELSE 'in_stock' END,
               updated_by = ?2, updated_at = datetime('now') WHERE id = ?3`,
          ).bind(l.qty, user.id, l.inventory_item_id).run();
          await audit(env, user.id, "inventory.in", "inventory_items", String(l.inventory_item_id), { qty: l.qty, reason: "returned" });
        }
        if (lines.length > 0) {
          await env.DB.prepare(`UPDATE postage_records SET restocked = 1 WHERE id = ?1`).bind(postMatch[1]).run();
        }
      }
    }
    await env.DB.prepare(
      `UPDATE postage_records SET status = ?1, tracking_no = COALESCE(?2, tracking_no),
         note = COALESCE(?3, note), updated_by = ?4, updated_at = datetime('now') WHERE id = ?5`,
    ).bind(body.status, str(body.tracking_no, 120) ? body.tracking_no : null,
           str(body.note, 500) ? body.note : null, user.id, postMatch[1]).run();
    await audit(env, user.id, "postage.update", "postage_records", postMatch[1]);
    return json({ ok: true });
  }

  /* ---- Manual stock in/out (v1.4.31) ---- */
  const invAdjust = path.match(/^\/inventory\/(\d+)\/adjust$/);
  if (invAdjust && method === "POST") {
    if (!can(user, "inventory")) return err("forbidden", "Inventory access required", 403);
    const delta = typeof body?.delta === "number" ? Math.trunc(body.delta) : 0;
    if (!delta) return err("invalid_input", "delta (non-zero integer) is required", 400);
    const item = await env.DB.prepare(
      `SELECT stock, name FROM inventory_items WHERE id = ?1`,
    ).bind(invAdjust[1]).first<{ stock: number; name: string }>();
    if (!item) return err("not_found", "Item not found", 404);
    const newStock = item.stock + delta;
    if (newStock < 0) {
      return err("insufficient_stock", `Only ${item.stock} in stock for ${item.name} — cannot remove ${-delta}`, 409);
    }
    await env.DB.prepare(
      `UPDATE inventory_items SET stock = ?1, status = ?2, updated_by = ?3, updated_at = datetime('now') WHERE id = ?4`,
    ).bind(newStock, stockStatus(newStock), user.id, invAdjust[1]).run();
    await audit(env, user.id, delta > 0 ? "inventory.in" : "inventory.out", "inventory_items", invAdjust[1], { qty: Math.abs(delta) });
    return json({ ok: true, stock: newStock, status: stockStatus(newStock) });
  }

  /* ---- Marketing materials ---- */

  if (path === "/materials" && method === "GET") {
    if (!can(user, "inventory") && !can(user, "exec_view")) {
      return err("forbidden", "Access required", 403);
    }
    const { results } = await env.DB.prepare(
      `SELECT m.*, u.name AS requested_by_name FROM material_requests m
       LEFT JOIN users u ON u.id = m.requested_by ORDER BY m.created_at DESC LIMIT 100`,
    ).all();
    return json({ materials: results });
  }
  if (path === "/materials" && method === "POST") {
    if (!can(user, "inventory")) return err("forbidden", "Access required", 403);
    if (!body || !str(body.title, 200)) return err("invalid_input", "title is required", 400);
    await env.DB.prepare(
      `INSERT INTO material_requests (title, description, requested_by) VALUES (?1, ?2, ?3)`,
    ).bind(body.title, str(body.description, 2000) ? body.description : null, user.id).run();
    await audit(env, user.id, "materials.create");
    return json({ ok: true }, 201);
  }
  const matMatch = path.match(/^\/materials\/(\d+)$/);
  if (matMatch && method === "PATCH") {
    if (!can(user, "inventory")) return err("forbidden", "Access required", 403);
    const statuses = ["requested", "in_progress", "done", "rejected"];
    if (!body || !statuses.includes(body.status as string)) {
      return err("invalid_input", `status must be one of: ${statuses.join(", ")}`, 400);
    }
    await env.DB.prepare(
      `UPDATE material_requests SET status = ?1, updated_at = datetime('now') WHERE id = ?2`,
    ).bind(body.status, matMatch[1]).run();
    return json({ ok: true });
  }

  /* ---- CCO: business development pipeline ---- */

  if (path === "/bd" && method === "GET") {
    if (!can(user, "exec_view")) {
      return err("forbidden", "Commercial access required", 403);
    }
    const { results } = await env.DB.prepare(
      `SELECT b.*, u.name AS owner_name FROM bd_pipeline b
       LEFT JOIN users u ON u.id = b.owner_id
       ORDER BY CASE b.status WHEN 'open' THEN 0 WHEN 'pending' THEN 1 WHEN 'kiv' THEN 2 ELSE 3 END,
                b.updated_at DESC LIMIT 200`,
    ).all();
    return json({ pipeline: results });
  }
  if (path === "/bd" && method === "POST") {
    if (!can(user, "hr_manage")) return err("forbidden", "Admin tier required", 403);
    if (!body || !str(body.client, 200)) return err("invalid_input", "client is required", 400);
    await env.DB.prepare(
      `INSERT INTO bd_pipeline (client, status, value_note, strategy, next_action, owner_id)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
    ).bind(
      body.client,
      BD_STATUSES.includes(body.status as string) ? (body.status as string) : "open",
      str(body.value_note, 300) ? body.value_note : null,
      str(body.strategy, 2000) ? body.strategy : null,
      str(body.next_action, 300) ? body.next_action : null,
      user.id,
    ).run();
    await audit(env, user.id, "bd.create");
    return json({ ok: true }, 201);
  }
  const bdMatch = path.match(/^\/bd\/(\d+)$/);
  if (bdMatch && method === "PATCH") {
    if (!can(user, "hr_manage")) return err("forbidden", "Admin tier required", 403);
    if (!body) return err("invalid_input", "Body required", 400);
    const sets: string[] = [];
    const vals: (string | number)[] = [];
    if (BD_STATUSES.includes(body.status as string)) { sets.push(`status = ?${sets.length + 1}`); vals.push(body.status as string); }
    if (str(body.strategy, 2000)) { sets.push(`strategy = ?${sets.length + 1}`); vals.push(body.strategy as string); }
    if (str(body.next_action, 300)) { sets.push(`next_action = ?${sets.length + 1}`); vals.push(body.next_action as string); }
    if (str(body.value_note, 300)) { sets.push(`value_note = ?${sets.length + 1}`); vals.push(body.value_note as string); }
    if (sets.length === 0) return err("invalid_input", "Nothing to update", 400);
    sets.push(`updated_at = datetime('now')`);
    await env.DB.prepare(`UPDATE bd_pipeline SET ${sets.join(", ")} WHERE id = ?${vals.length + 1}`)
      .bind(...vals, bdMatch[1]!).run();
    await audit(env, user.id, "bd.update", "bd_pipeline", bdMatch[1]);
    return json({ ok: true });
  }

  /* ---- COO: daily operational + sales reports ---- */

  if (path === "/ops-reports" && method === "GET") {
    if (!can(user, "exec_view")) {
      return err("forbidden", "Operations access required", 403);
    }
    const { results } = await env.DB.prepare(
      `SELECT o.*, u.name AS author FROM ops_reports o
       LEFT JOIN users u ON u.id = o.created_by
       ORDER BY o.report_date DESC LIMIT 60`,
    ).all();
    return json({ reports: results });
  }
  if (path === "/ops-reports" && method === "POST") {
    if (!can(user, "hr_manage")) return err("forbidden", "Admin tier required", 403);
    if (!body || !str(body.report_date, 10) || !str(body.operational_summary, 8000)) {
      return err("invalid_input", "report_date and operational_summary are required", 400);
    }
    await env.DB.prepare(
      `INSERT INTO ops_reports (report_date, operational_summary, sales_summary, strategy_note, created_by)
       VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT(report_date, created_by) DO UPDATE SET
         operational_summary = ?2, sales_summary = ?3, strategy_note = ?4`,
    ).bind(
      body.report_date,
      body.operational_summary,
      str(body.sales_summary, 8000) ? body.sales_summary : null,
      str(body.strategy_note, 4000) ? body.strategy_note : null,
      user.id,
    ).run();
    await audit(env, user.id, "ops.report", "ops_reports");
    return json({ ok: true }, 201);
  }

  /* ---- CEO: whole-company overview (read-only) ---- */

  if (path === "/overview" && method === "GET") {
    if (!can(user, "exec_view")) return err("forbidden", "Executive access required", 403);
    const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
    const [attendance, pendingLeave, docs, lowStock, bd, upcomingEvents, eventCount, latestOps, taskAgg, taskByStaff, inventory] = await Promise.all([
      env.DB.prepare(
        `SELECT COUNT(DISTINCT user_id) AS n FROM attendance_records
         WHERE type = 'clock_in' AND date(created_at, '+8 hours') = ?1`,
      ).bind(today).first(),
      env.DB.prepare(`SELECT COUNT(*) AS n FROM leave_requests WHERE status = 'pending'`).first(),
      env.DB.prepare(
        `SELECT doc_type, COUNT(*) AS n FROM sales_documents GROUP BY doc_type`,
      ).all(),
      env.DB.prepare(
        `SELECT COUNT(*) AS n FROM inventory_items WHERE status IN ('low', 'out_of_stock')`,
      ).first(),
      env.DB.prepare(`SELECT status, COUNT(*) AS n FROM bd_pipeline GROUP BY status`).all(),
      // Upcoming company events (v1.4.73) — next 60 days for the list, and a
      // 30-day count for the headline stat.
      env.DB.prepare(
        `SELECT id, title, category, event_date, start_time, location FROM events
         WHERE event_date >= date('now', '+8 hours')
           AND event_date <= date('now', '+8 hours', '+60 days')
         ORDER BY event_date ASC, start_time ASC LIMIT 6`,
      ).all(),
      env.DB.prepare(
        `SELECT COUNT(*) AS n FROM events
         WHERE event_date >= date('now', '+8 hours')
           AND event_date <= date('now', '+8 hours', '+30 days')`,
      ).first(),
      env.DB.prepare(
        `SELECT report_date, operational_summary, sales_summary FROM ops_reports
         ORDER BY report_date DESC LIMIT 1`,
      ).first(),
      // Task progress across the whole company (open/in_progress/completed).
      env.DB.prepare(`SELECT status, COUNT(*) AS n FROM tasks GROUP BY status`).all(),
      // Per-staff task load — who has open work, for monitoring.
      env.DB.prepare(
        `SELECT u.name, u.role,
                SUM(CASE WHEN t.status != 'completed' THEN 1 ELSE 0 END) AS open_tasks,
                SUM(CASE WHEN t.status = 'completed' THEN 1 ELSE 0 END) AS done_tasks
         FROM users u LEFT JOIN tasks t ON t.assigned_to = u.id
         WHERE u.role NOT IN ('customer')
         GROUP BY u.id HAVING open_tasks > 0 OR done_tasks > 0
         ORDER BY open_tasks DESC LIMIT 30`,
      ).all(),
      // Inventory status breakdown for monitoring.
      env.DB.prepare(`SELECT status, COUNT(*) AS n FROM inventory_items GROUP BY status`).all(),
    ]);
    return json({
      date: today,
      clocked_in_today: (attendance as { n: number } | null)?.n ?? 0,
      pending_leave: (pendingLeave as { n: number } | null)?.n ?? 0,
      documents: docs.results,
      low_stock_items: (lowStock as { n: number } | null)?.n ?? 0,
      bd_pipeline: bd.results,
      upcoming_events: upcomingEvents.results,
      upcoming_events_30d: (eventCount as { n: number } | null)?.n ?? 0,
      latest_ops_report: latestOps,
      task_summary: taskAgg.results,
      task_by_staff: taskByStaff.results,
      inventory_status: inventory.results,
    });
  }

  if (path === "/notifications" && method === "GET") {
    // Backfill (v1.4.34): any announcement from the last 7 days that has no
    // notification row for this user gets one now. This makes announcement
    // alerts independent of publish/deploy ordering — the bell always knows.
    const { results: missing } = await env.DB.prepare(
      `SELECT a.id, a.title, a.created_at FROM announcements a
       WHERE a.created_at >= datetime('now', '-7 days')
         AND a.created_by != ?1
         AND NOT EXISTS (
           SELECT 1 FROM notifications n
           WHERE n.user_id = ?1 AND n.ref = 'announcement:' || a.id
         )`,
    ).bind(user.id).all();
    for (const a of missing as { id: number; title: string; created_at: string }[]) {
      await env.DB.prepare(
        `INSERT INTO notifications (user_id, kind, message, ref, created_at)
         VALUES (?1, 'announcement', ?2, ?3, ?4)`,
      ).bind(user.id, `New announcement: ${a.title}`, `announcement:${a.id}`, a.created_at).run();
    }
    const { results } = await env.DB.prepare(
      `SELECT id, kind, message, ref, is_read, created_at FROM notifications
       WHERE user_id = ?1 AND created_at >= datetime('now', '-7 days')
       ORDER BY created_at DESC LIMIT 50`,
    ).bind(user.id).all();
    return json({ notifications: results });
  }
  if (path === "/notifications/read" && method === "POST") {
    await env.DB.prepare(`UPDATE notifications SET is_read = 1 WHERE user_id = ?1`)
      .bind(user.id).run();
    return json({ ok: true });
  }

  return null; // not a staff route
}
