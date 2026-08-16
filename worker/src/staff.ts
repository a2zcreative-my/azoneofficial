/**
 * Staff Portal API (/api/v1/staff/*) — see 0003_staff_portal.sql
 * Mounted from index.ts after session resolution. All routes require auth.
 */

import type { Env } from "./index";
import { handleErp } from "./erp";
import { logError as sharedLogError, postJournal } from "./shared";
import { fillM2eTemplate, type M2eRow } from "./m2e";
import { createPasswordHash } from "./index";
import { sendPush, type PushKeys } from "./webpush";

import { Role, can } from "./permissions";

/** v1.6.0: VAPID keys, or null when push isn't configured (push simply off). */
function pushKeys(env: Env): PushKeys | null {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY || !env.VAPID_SUBJECT) return null;
  return { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT };
}

/** v1.6.0: fire a web-push to every device a user has registered. Best-effort;
    dead subscriptions (404/410) are pruned. Never throws. */
export async function pushToUser(env: Env, userId: number, title: string, body: string, ref?: string): Promise<void> {
  const keys = pushKeys(env);
  if (!keys) return;
  try {
    const { results } = await env.DB.prepare(
      `SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?1`,
    ).bind(userId).all<{ id: number; endpoint: string; p256dh: string; auth: string }>();
    for (const s of results) {
      const status = await sendPush(keys, s, { title, body, ref: ref ?? null, url: "/portal" });
      if (status === 404 || status === 410) {
        await env.DB.prepare(`DELETE FROM push_subscriptions WHERE id = ?1`).bind(s.id).run();
      }
    }
  } catch { /* push is best-effort; the in-app record is already saved */ }
}

export interface StaffUser {
  id: number;
  email: string;
  name: string;
  role: Role;
}

const POSTAGE_STATUSES = ["preparing", "shipped", "in_transit", "delivered", "returned"];
const BD_STATUSES = ["open", "pending", "kiv", "closed_won", "closed_lost"];

/** v1.8.0: "HH:MM" + n minutes → "HH:MM" (same day, clamped). */
function addMinutes(hhmm: string, mins: number): string {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) return hhmm;
  const total = Math.min(23 * 60 + 59, Number(m[1]) * 60 + Number(m[2]) + mins);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

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

/* v1.9.1 — office geofence for clock in/out (replaces the selfie step).
   One system_meta row holds the office point + radius; the punch route
   refuses punches taken outside it. Honest limitation, stated to the CEO:
   browser GPS comes from the client and can be spoofed by a determined
   user with dev tools — this stops casual "clock in from bed", it is not
   forensic proof of presence. The IP + user-agent already stored on every
   punch remain the cross-check. */
const GEOFENCE_KEY = "attendance_geofence";
const GEOFENCE_ADMIN_ROLES = ["super_admin", "ceo", "coo"];

interface Geofence { lat: number; lng: number; radius_m: number; label: string }

async function getGeofence(env: Env): Promise<Geofence | null> {
  try {
    const row = await env.DB.prepare(`SELECT value FROM system_meta WHERE key = ?1`)
      .bind(GEOFENCE_KEY).first<{ value: string }>();
    if (!row) return null;
    const g = JSON.parse(row.value) as Partial<Geofence>;
    if (typeof g.lat !== "number" || typeof g.lng !== "number" || typeof g.radius_m !== "number") return null;
    return { lat: g.lat, lng: g.lng, radius_m: g.radius_m, label: typeof g.label === "string" && g.label ? g.label : "the office" };
  } catch { return null; } // pre-0057 (no system_meta) — geofence simply off
}

/** Great-circle distance in metres (haversine — plenty for a 100 m fence). */
function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLng = (lng2 - lng1) * rad;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/* One gate used by BOTH the clock punch and the OT punch (review finding:
   gating only clock in/out left OT — the PAID punches — open to a sofa).
   When a fence is configured, body.gps must be present and valid — the
   location itself is REQUIRED (that is the anti-cheating rule), but being
   OUTSIDE the fence no longer refuses the punch.

   v1.21.0 (CEO chose "allow but flag"): a punch outside radius +
   min(acc, 150) m grace is RECORDED, and management views mark it red as
   "outside office". Nobody is ever locked out by fuzzy GPS; HR reviews the
   flags instead. CEO/COO/CCO are exempt from the flag (their location is
   still captured and shown). The flag itself is computed at READ time from
   the stored gps against the current fence — no schema change, and moving
   the office retro-corrects every historical flag. */
async function gateGeofence(
  env: Env, body: Record<string, unknown> | null, verb: string,
): Promise<{ resp: Response; gps?: undefined } | { resp?: undefined; gps: string | null }> {
  const gpsRaw = str(body?.gps, 100) ? (body!.gps as string).trim() : null;
  /* v1.21.4 (CEO: "still appear that the location is not capture which is
     it is incorrect flow data system requirement"): location is required on
     EVERY punch, fence configured or not. Before, a database that hadn't
     run migration 0072 yet silently accepted location-less punches — the
     exact "no location" rows he saw. The fence now only decides FLAGGING;
     the location requirement itself no longer depends on it. */
  const gm = gpsRaw ? /^(-?\d{1,2}(?:\.\d+)?),\s*(-?\d{1,3}(?:\.\d+)?)(?:,\s*(\d+(?:\.\d+)?))?$/.exec(gpsRaw) : null;
  const plat = gm ? Number(gm[1]) : NaN;
  const plng = gm ? Number(gm[2]) : NaN;
  if (!gm || plat < -90 || plat > 90 || plng < -180 || plng > 180) {
    return { resp: err("location_required", `Location is required to ${verb} — allow location access in your browser and try again.`, 400) };
  }
  return { gps: gpsRaw };
}

export async function notify(
  env: Env, userId: number, kind: string, message: string, ref?: string,
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO notifications (user_id, kind, message, ref) VALUES (?1, ?2, ?3, ?4)`,
  ).bind(userId, kind, message, ref ?? null).run();

  // v1.6.0: web-push to the person's devices (best-effort, off when no VAPID).
  await pushToUser(env, userId, "AZ ONE OFFICIAL", message, ref);

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

/** v1.4.114: non-fatal error-log writer for this module.
    v1.18.0 (CODE-AUDIT item 1): this copy was a bare INSERT while index.ts
    carried the v1.5.0 six-hour dedupe — and THIS is the copy the whole portal
    API calls, so recurring conditions still bell-spammed management and
    evicted real errors from the 500-row window. Now delegates to the shared
    deduped writer; the 10 call sites are unchanged. */
async function logError(env: Env, source: string, message: string): Promise<void> {
  return sharedLogError(env, source, message);
}

/* v1.19.0 (consolidation C2) — ONE ringgit, one bank row. When money
   actually moves (expense marked paid, payroll bank run recorded, claim paid
   out), the matching bank-movement row is created HERE, automatically and
   idempotently — the `ref` is unique per event, so re-toggling "paid" can
   never write a second row. Pre-0071 DBs (no cashflow_entries table) no-op
   silently: the legacy flows must never break on an unmigrated database. */
async function recordBankMovement(
  env: Env, userId: number, ref: string, amountCents: number, category: string, description: string,
  direction: "in" | "out" = "out",
): Promise<void> {
  if (amountCents <= 0) return;
  try {
    const dup = await env.DB.prepare(`SELECT id FROM cashflow_entries WHERE ref = ?1 LIMIT 1`)
      .bind(ref).first<{ id: number }>();
    if (dup) return;
    await env.DB.prepare(
      `INSERT INTO cashflow_entries (entry_date, type, category, amount_cents, description, ref, created_by)
       VALUES (date('now', '+8 hours'), ?6, ?1, ?2, ?3, ?4, ?5)`,
    ).bind(category, amountCents, description.slice(0, 200), ref, userId, direction).run();
    // v1.20.0 C5: the movement drafts its journal entry — same ref, same
    // idempotency, so the books can never double-post.
    // v1.21.0: money-in joined (paid invoices, channel settlements) — the
    // CEO's "cash flow must sync with Finance, semi-automation not manual".
    await postJournal(env, userId, ref, description, category, amountCents, direction);
  } catch { /* pre-0071 — Finance bank section simply not in use yet */ }
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

async function docNumber(env: Env, docType: "QT" | "DO" | "INV" | "RC" | "CN"): Promise<string> {
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

/* v1.4.202/203 — payment-date rule (CEO: pay on the 5th, or EARLIER when the
   5th is a weekend; deliberately opposite to payslip RELEASE which shifts
   forward) and the M2E bank-code map from the template's own list. Hoisted to
   module scope so the CSV route and the filled-.xlsm route share them. */
export function paymentDateFor(payMonth: string): string {
  const [py, pm] = payMonth.split("-").map(Number);
  const ny = pm === 12 ? py + 1 : py;
  const nm = pm === 12 ? 1 : pm + 1;
  const d = new Date(Date.UTC(ny, nm - 1, 5));
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

const M2E_BANKS: [string, string][] = [
  ["maybank", "MBBEMYKL"], ["malayan banking", "MBBEMYKL"],
  ["cimb", "CIBBMYKL"], ["public bank", "PBBEMYKL"], ["rhb", "RHBBMYKL"],
  ["hong leong", "HLBBMYKL"], ["ambank", "ARBKMYKL"],
  ["bank islam", "BIMBMYKL"], ["muamalat", "BMMBMYKL"],
  ["bsn", "BSNAMYK1"], ["simpanan nasional", "BSNAMYK1"],
  ["bank rakyat", "BKRMMYKL"], ["kerjasama rakyat", "BKRMMYKL"],
  ["agrobank", "AGOBMYKL"], ["pertanian", "AGOBMYKL"],
  ["affin", "PHBMMYKL"], ["alliance", "MFBBMYKL"],
  ["al-rajhi", "RJHIMYKL"], ["al rajhi", "RJHIMYKL"],
  ["mbsb", "AFBQMYKL"], ["ocbc", "OCBCMYKL"], ["uob", "UOVBMYKL"],
  ["united overseas", "UOVBMYKL"], ["hsbc", "HBMBMYKL"],
  ["standard chartered", "SCBLMYKX"], ["citibank", "CITIMYKL"],
  ["kuwait finance", "KFHOMYKL"], ["bank of china", "BKCHMYKL"],
];
function bankCode(name: string): string | null {
  const n = name.toLowerCase();
  for (const [frag, code] of M2E_BANKS) if (n.includes(frag)) return code;
  return null;
}

const M2E_TEMPLATE_KEY = "private/m2e/template.xlsm";

/* v1.4.281 — THE ONE revenue arithmetic, now split by BUSINESS LINE
   (CEO: "my company do 2 business which is one for product sales and the
   other one is for service sales… make it expandable").
   revenueLines() buckets every ringgit into a named line:
     product = TikTok + Shopee/walk-in postage + manual sales + paid INV kind='product'
     service = paid INV kind='service'
     invoices = paid INV on a DB that predates migration 0061 (kind column
       missing) — honest bucket, never guessed into a line.
   revenueByMonth() = the SUM of all lines, so /revenue, /finance/pnl and
   the business-lines card can never disagree. Adding a future line =
   one more bucket here; every consumer inherits it. Each query armored. */
async function revenueLines(env: Env): Promise<Record<string, Record<string, number>>> {
  const lines: Record<string, Record<string, number>> = {};
  const add = (line: string, m: string | null, c: number) => {
    if (!m) return;
    const bucket = (lines[line] ??= {});
    bucket[m] = (bucket[m] ?? 0) + c;
  };
  try {
    const { results } = await env.DB.prepare(
      `SELECT strftime('%Y-%m', created_at, '+8 hours') AS m, COALESCE(SUM(order_amount_cents), 0) AS cents
       FROM postage_records WHERE order_ref LIKE 'TT-%' AND status != 'returned' GROUP BY m`,
    ).all<{ m: string; cents: number }>();
    for (const r of results) add("product", r.m, r.cents);
  } catch { /* pre-postage */ }
  try {
    const { results } = await env.DB.prepare(
      `SELECT strftime('%Y-%m', created_at, '+8 hours') AS m, COALESCE(SUM(order_amount_cents), 0) AS cents
       FROM postage_records WHERE order_ref NOT LIKE 'TT-%' AND status != 'returned' GROUP BY m`,
    ).all<{ m: string; cents: number }>();
    for (const r of results) add("product", r.m, r.cents);
  } catch { /* pre-0048 */ }
  try {
    const { results } = await env.DB.prepare(
      `SELECT (CASE WHEN out_date IS NOT NULL THEN substr(out_date, 1, 7)
                    ELSE strftime('%Y-%m', created_at, '+8 hours') END) AS m,
              COALESCE(SUM(total_cents), 0) AS cents
       FROM manual_sales GROUP BY m`,
    ).all<{ m: string; cents: number }>();
    for (const r of results) add("product", r.m, r.cents);
  } catch {
    try {
      const { results } = await env.DB.prepare(
        `SELECT strftime('%Y-%m', created_at, '+8 hours') AS m, COALESCE(SUM(total_cents), 0) AS cents
         FROM manual_sales GROUP BY m`,
      ).all<{ m: string; cents: number }>();
      for (const r of results) add("product", r.m, r.cents);
    } catch { /* pre-manual-sales */ }
  }
  try {
    const { results } = await env.DB.prepare(
      `SELECT strftime('%Y-%m', COALESCE(paid_at, created_at), '+8 hours') AS m,
              (CASE WHEN kind = 'service' THEN 'service' ELSE 'product' END) AS line,
              COALESCE(SUM(total_cents), 0) AS cents
       FROM sales_documents WHERE doc_type = 'INV' AND payment_status = 'paid' GROUP BY m, line`,
    ).all<{ m: string; line: string; cents: number }>();
    for (const r of results) add(r.line, r.m, r.cents);
  } catch { /* pre-0061: no kind column — honest unclassified bucket */
    try {
      const { results } = await env.DB.prepare(
        `SELECT strftime('%Y-%m', COALESCE(paid_at, created_at), '+8 hours') AS m, COALESCE(SUM(total_cents), 0) AS cents
         FROM sales_documents WHERE doc_type = 'INV' AND payment_status = 'paid' GROUP BY m`,
      ).all<{ m: string; cents: number }>();
      for (const r of results) add("invoices", r.m, r.cents);
    } catch { /* pre-0060 */ }
  }
  try {
    /* v1.19.0 (CEO decision, consolidation Q2): stokis purchases join the
       revenue lines. Before this they were visible ONLY on the Stokis tab —
       reseller money was invisible to /revenue, the P&L and commission base. */
    const { results } = await env.DB.prepare(
      `SELECT strftime('%Y-%m', created_at, '+8 hours') AS m, COALESCE(SUM(amount_cents), 0) AS cents
       FROM stokis_orders GROUP BY m`,
    ).all<{ m: string; cents: number }>();
    for (const r of results) add("stokis", r.m, r.cents);
  } catch { /* pre-0069 */ }
  return lines;
}

async function revenueByMonth(env: Env): Promise<Record<string, number>> {
  const lines = await revenueLines(env);
  const acc: Record<string, number> = {};
  for (const bucket of Object.values(lines)) {
    for (const [m, c] of Object.entries(bucket)) acc[m] = (acc[m] ?? 0) + c;
  }
  return acc;
}

/* ===================== v1.6.0 — sales attribution & commission ============ */

// Who may set targets and edit commission rules.
const TARGET_ADMIN_ROLES = ["super_admin", "admin", "ceo", "coo", "cco"];

interface CommissionRule {
  id: number; name: string; base_pct: number; bonus_pct: number; applies_to: string; active: number;
}

/** Attributed sales (sen) per user for a month (YYYY-MM, MYT): paid invoices
    where they are the salesperson + TikTok GMV landing inside their completed
    live-session windows (the same attribution the LIVE GMV card already uses).
    Returns Map<user_id, cents>. Armoured against pre-migration schemas. */
async function attributedSalesByUser(env: Env, month: string): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  const add = (uid: number | null, cents: number) => {
    if (!uid) return;
    out.set(uid, (out.get(uid) ?? 0) + (cents ?? 0));
  };
  try {
    const { results } = await env.DB.prepare(
      `SELECT salesperson_id AS uid, COALESCE(SUM(total_cents), 0) AS cents
         FROM sales_documents
        WHERE doc_type = 'INV' AND salesperson_id IS NOT NULL
          AND paid_at IS NOT NULL AND strftime('%Y-%m', paid_at) = ?1
        GROUP BY salesperson_id`,
    ).bind(month).all<{ uid: number; cents: number }>();
    for (const r of results) add(r.uid, r.cents);
  } catch { /* pre-salesperson / pre-paid_at */ }
  try {
    const { results } = await env.DB.prepare(
      `SELECT s.host_user_id AS uid, COALESCE(SUM(p.order_amount_cents), 0) AS cents
         FROM postage_records p
         JOIN live_sessions s
           ON s.status != 'cancelled' AND s.end_time IS NOT NULL
          AND s.session_date = date(p.created_at, '+8 hours')
          AND strftime('%H:%M', p.created_at, '+8 hours') >= s.start_time
          AND strftime('%H:%M', p.created_at, '+8 hours') <= s.end_time
        WHERE p.order_ref LIKE 'TT-%' AND p.status != 'returned'
          AND p.order_amount_cents IS NOT NULL
          AND strftime('%Y-%m', p.created_at, '+8 hours') = ?1
        GROUP BY s.host_user_id`,
    ).bind(month).all<{ uid: number; cents: number }>();
    for (const r of results) add(r.uid, r.cents);
  } catch { /* pre-live_sessions */ }
  return out;
}

/** Commission (sen) for a person's attributed `sales` against their `target`,
    under whichever active rule that applies to `role` yields the most (staff-
    friendly): base_pct on all sales + bonus_pct on the amount above target. */
function commissionFor(sales: number, target: number, role: string, rules: CommissionRule[]): number {
  let best = 0;
  for (const r of rules) {
    if (!r.active) continue;
    if (r.applies_to !== "all" && r.applies_to !== role) continue;
    const base = sales * (r.base_pct / 100);
    const over = target > 0 ? Math.max(0, sales - target) * (r.bonus_pct / 100) : 0;
    best = Math.max(best, base + over);
  }
  return Math.round(best);
}

async function activeCommissionRules(env: Env): Promise<CommissionRule[]> {
  try {
    const { results } = await env.DB.prepare(
      `SELECT id, name, base_pct, bonus_pct, applies_to, active FROM commission_rules WHERE active = 1`,
    ).all<CommissionRule>();
    return results;
  } catch { return []; }
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
  // v1.7.0: the claims receipt upload is /claims/:id/receipt (binary); the new
  // /docs/:id/receipt is JSON, so exclude only the claims one, not any /receipt.
  const isClaimsReceipt = path.endsWith("/receipt") && path.startsWith("/claims/");
  const body =
    ["POST", "PUT", "PATCH"].includes(method) && !path.endsWith("/photo") && !isClaimsReceipt && !path.endsWith("/payment-proof") && !path.endsWith("/documents") && !path.endsWith("/m2e-template")
      ? ((await request.json().catch(() => null)) as Record<string, unknown> | null)
      : null;

  /* ---- ERP modules (v1.18.0): orders, cash flow, reconciliation,
     commission, ads fund, purchasing, accounting — see erp.ts ---- */
  if (path.startsWith("/erp/")) {
    return handleErp(env, path.slice("/erp".length), method, body, user);
  }

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
    const vals: (string | number | null)[] = [];
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
    // HR-scoped staff creation. Deliberately cannot mint admin/super_admin,
    // executive, or customer accounts; those stay in /admin/super-admin flows.
    if (!can(user.role, "hr_manage")) return err("forbidden", "HR access required", 403);
    const STAFF_ROLES = ["editor", "marketing", "live_host", "hr_admin", "sales_marketing"];
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

  /* v1.4.156/157 — role & employment-status changes: Google sign-ups always
     land as `customer` (self-registration can never mint anything else), and
     ONLY the super_admin may change roles — per the CEO (v1.4.157): keeping
     promotion out of every business account means a compromised Google or
     staff sign-in can never escalate itself or anyone else. Rules:
       - super_admin ONLY (admin and ceo deliberately excluded)
       - admin-tier accounts (super_admin/admin) can never be touched here,
         and those roles can never be assigned here
       - you cannot change your own role
       - DOMAIN POLICY nuance: personal-email (Google) accounts may hold
         staff roles ONLY as part_time — permanent staff still require an
         @COMPANY_DOMAIN account created through staff onboarding
     Takes effect immediately: getSessionUser reads the role per request. */
  const roleMatch = path.match(/^\/users\/(\d+)\/role$/);
  if (roleMatch && method === "POST") {
    if (user.role !== "super_admin") {
      return err("forbidden", "Only the system super admin can change account roles — this keeps sign-ups from ever escalating themselves", 403);
    }
    const ASSIGNABLE = ["editor", "marketing", "live_host", "hr_admin", "sales_marketing", "ceo", "coo", "cco", "customer"];
    const EMP_STATUSES = ["permanent", "contract", "part_time", "probation"];
    const newRole = typeof body?.role === "string" ? body.role : "";
    const newStatus = typeof body?.employment_status === "string" && body.employment_status !== "" ? body.employment_status : null;
    if (!ASSIGNABLE.includes(newRole)) {
      return err("invalid_input", `role must be one of: ${ASSIGNABLE.join(", ")}`, 400);
    }
    if (newStatus && !EMP_STATUSES.includes(newStatus)) {
      return err("invalid_input", `employment_status must be one of: ${EMP_STATUSES.join(", ")}`, 400);
    }
    const id = Number(roleMatch[1]!);
    if (id === user.id) return err("self_change", "You can't change your own role — ask another authorised account.", 400);
    const target = await env.DB.prepare(`SELECT id, email, role, employment_status FROM users WHERE id = ?1`)
      .bind(id).first<{ id: number; email: string; role: string; employment_status: string | null }>();
    if (!target) return err("not_found", "User not found", 404);
    if (["super_admin", "admin"].includes(target.role)) {
      return err("forbidden", "Admin-tier accounts are managed in /admin only", 403);
    }
    const isCompanyEmail = target.email.toLowerCase().endsWith(`@${env.COMPANY_DOMAIN.toLowerCase()}`);
    let status = newStatus;
    if (newRole !== "customer" && !isCompanyEmail) {
      // Personal-email promotion → part-time only.
      if (status && status !== "part_time") {
        return err("domain_policy", `Personal-email accounts can only hold part-time roles — permanent staff need an @${env.COMPANY_DOMAIN} account`, 400);
      }
      status = "part_time";
    }
    await env.DB.prepare(
      `UPDATE users SET role = ?1, employment_status = COALESCE(?2, employment_status) WHERE id = ?3`,
    ).bind(newRole, status, id).run();
    await audit(env, user.id, "staff.role_change", "users", String(id), {
      from: target.role, to: newRole,
      employment_status: status ?? target.employment_status ?? "unchanged",
    });
    return json({ ok: true, role: newRole, employment_status: status ?? target.employment_status });
  }

  /* v1.9.1 — office geofence (replaces the v1.9.0 selfie step; selfies
     already on record stay viewable through the media route).
     GET: every staff member learns whether a fence is on (their punch flow
     needs to know to ask for location) + radius/label for the hint text.
     Coordinates themselves go only to the roles that can edit them.
     POST: super_admin/ceo/coo set, move or clear the fence. */
  if (path === "/attendance/geofence" && method === "GET") {
    const fence = await getGeofence(env);
    const isGeoAdmin = GEOFENCE_ADMIN_ROLES.includes(user.role);
    if (!fence) return json({ configured: false, can_edit: isGeoAdmin });
    return json({
      configured: true,
      can_edit: isGeoAdmin,
      radius_m: fence.radius_m,
      label: fence.label,
      ...(isGeoAdmin ? { lat: fence.lat, lng: fence.lng } : {}),
    });
  }
  /* v1.17.0 — "Check my location": the SAME rule the punch gate applies,
     run on demand so staff can see where they stand BEFORE tapping Clock in
     (CEO: "I still cant see the gps detection for the clock in"). Fence
     coordinates stay server-side — only the distance goes back. Deliberately
     no audit row and no punch record: this is a mirror, not an event. */
  if (path === "/attendance/geofence/check" && method === "POST") {
    const fence = await getGeofence(env);
    if (!fence) return json({ configured: false });
    const gpsRaw = str(body?.gps, 100) ? (body!.gps as string).trim() : null;
    const gm = gpsRaw ? /^(-?\d{1,2}(?:\.\d+)?),\s*(-?\d{1,3}(?:\.\d+)?)(?:,\s*(\d+(?:\.\d+)?))?$/.exec(gpsRaw) : null;
    const plat = gm ? Number(gm[1]) : NaN;
    const plng = gm ? Number(gm[2]) : NaN;
    if (!gm || plat < -90 || plat > 90 || plng < -180 || plng > 180) {
      return err("location_required", "Location is required — allow location access in your browser and try again.", 400);
    }
    const acc = gm[3] ? Math.min(Number(gm[3]), 150) : 0;
    const dist = haversineM(plat, plng, fence.lat, fence.lng);
    return json({
      configured: true,
      inside: dist <= fence.radius_m + acc,
      distance_m: Math.round(dist),
      accuracy_m: Math.round(acc),
      radius_m: fence.radius_m,
      label: fence.label,
    });
  }
  if (path === "/attendance/geofence" && method === "POST") {
    if (!GEOFENCE_ADMIN_ROLES.includes(user.role)) {
      return err("forbidden", "Only the CEO, COO or super admin can change the office geofence", 403);
    }
    if (body && body.clear === true) {
      await env.DB.prepare(`DELETE FROM system_meta WHERE key = ?1`).bind(GEOFENCE_KEY).run();
      await audit(env, user.id, "attendance.geofence_clear", "system_meta", GEOFENCE_KEY);
      return json({ ok: true, configured: false });
    }
    /* Review fix: NUMBERS ONLY. A NaN on the client serialises to JSON null,
       and Number(null) === 0 — which would silently save a fence at 0°,0°
       (the Gulf of Guinea) and lock the whole company out of clocking in.
       typeof checks close that hole. */
    const latG = typeof body?.lat === "number" && Number.isFinite(body.lat) ? body.lat : NaN;
    const lngG = typeof body?.lng === "number" && Number.isFinite(body.lng) ? body.lng : NaN;
    const radiusG = typeof body?.radius_m === "number" && Number.isFinite(body.radius_m) ? Math.round(body.radius_m) : NaN;
    if (!Number.isFinite(latG) || latG < -90 || latG > 90 || !Number.isFinite(lngG) || lngG < -180 || lngG > 180) {
      return err("invalid_input", "lat/lng must be valid coordinates (use the 'Use my current location' button at the office)", 400);
    }
    if (!Number.isFinite(radiusG) || radiusG < 20 || radiusG > 2000) {
      return err("invalid_input", "radius_m must be 20–2000 metres (100–200 m is typical: GPS in a building is rarely sharper)", 400);
    }
    const labelG = str(body?.label, 60) ? (body!.label as string).trim() : "the office";
    const fenceG: Geofence = { lat: Math.round(latG * 1e6) / 1e6, lng: Math.round(lngG * 1e6) / 1e6, radius_m: radiusG, label: labelG };
    await env.DB.prepare(
      `INSERT INTO system_meta (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = ?2`,
    ).bind(GEOFENCE_KEY, JSON.stringify(fenceG)).run();
    await audit(env, user.id, "attendance.geofence_set", "system_meta", GEOFENCE_KEY, { ...fenceG });
    return json({ ok: true, configured: true, ...fenceG });
  }

  const photoMatch = path.match(/^\/users\/(\d+)\/photo$/);
  if (photoMatch && method === "POST") {
    if (!can(user.role, "hr_manage")) return err("forbidden", "HR access required", 403);
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
    if (!["image/jpeg", "image/png", "image/webp"].includes(ct)) return err("invalid_input", "Only JPEG/PNG/WEBP images are allowed", 400);
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
      `SELECT COALESCE(NULLIF(TRIM(full_name), ''), name) AS name, birthday FROM users
       WHERE is_active = 1 AND role NOT IN ('customer', 'super_admin', 'admin') AND birthday IS NOT NULL`,
    ).all();
    return json({ birthdays: results });
  }
  /* v1.5.0: prospects CRUD routes removed with the Social tab (data retained in DB). */

  /* v1.4.270: ONE fetch for the Dashboard's status-breakdown card — cheap
     COUNTs, each armored per table so a pending migration can never blank
     the band (the v1.4.218 lesson applied to a new surface). Counts are
     universal facts; the CARD decides per role what to show. */
  if (path === "/dashboard/summary" && method === "GET") {
    const n = async (sql: string): Promise<number | null> => {
      try { return (await env.DB.prepare(sql).first<{ c: number }>())?.c ?? 0; }
      catch { return null; }
    };
    const todayS = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
    return json({
      today: todayS,
      // real schema: table `claims`, and both flows keep status='pending'
      // through the review chain (0010/0038 track the chain in columns).
      pending_leave: await n(`SELECT COUNT(*) AS c FROM leave_requests WHERE status = 'pending'`),
      pending_claims: await n(`SELECT COUNT(*) AS c FROM claims WHERE status = 'pending'`),
      pending_ot: await n(`SELECT COUNT(*) AS c FROM ot_records WHERE status = 'pending'`),
      low_stock: await n(`SELECT COUNT(*) AS c FROM inventory_items WHERE stock <= 5`),
      // v1.4.280: open quotations = QT docs not yet converted to an invoice
      open_quotations: await n(`SELECT COUNT(*) AS c FROM sales_documents WHERE doc_type = 'QT' AND converted_from IS NULL`),
      // v1.7.0 company-pulse tiles for the dashboard
      clients: await n(`SELECT COUNT(*) AS c FROM customers WHERE COALESCE(company, '') != 'Walk-in Customer'`),
      active_stokis: await n(`SELECT COUNT(*) AS c FROM stokis WHERE status = 'active'`),
      lives_today: await n(`SELECT COUNT(*) AS c FROM live_sessions WHERE session_date = date('now', '+8 hours') AND status != 'cancelled'`),
      attendance_today: await n(`SELECT COUNT(DISTINCT user_id) AS c FROM attendance_records WHERE type = 'clock_in' AND date(created_at, '+8 hours') = date('now', '+8 hours')`),
      /* v1.8.0 — the attendance donut: on-time (first clock-in <= 10:00 MYT,
         same rule the punch flag uses), late (after 10:00), and the active
         staff headcount so "not clocked in" is derivable. */
      attendance_on_time: await n(`SELECT COUNT(*) AS c FROM (
        SELECT a.user_id, MIN(strftime('%H:%M', a.created_at, '+8 hours')) AS t FROM attendance_records a
        JOIN users u ON u.id = a.user_id AND u.is_active = 1 AND u.role NOT IN ('customer', 'super_admin', 'admin')
        WHERE a.type = 'clock_in' AND date(a.created_at, '+8 hours') = date('now', '+8 hours') GROUP BY a.user_id
      ) WHERE t <= '10:00'`),
      attendance_late: await n(`SELECT COUNT(*) AS c FROM (
        SELECT a.user_id, MIN(strftime('%H:%M', a.created_at, '+8 hours')) AS t FROM attendance_records a
        JOIN users u ON u.id = a.user_id AND u.is_active = 1 AND u.role NOT IN ('customer', 'super_admin', 'admin')
        WHERE a.type = 'clock_in' AND date(a.created_at, '+8 hours') = date('now', '+8 hours') GROUP BY a.user_id
      ) WHERE t > '10:00'`),
      staff_total: await n(`SELECT COUNT(*) AS c FROM users WHERE is_active = 1 AND role NOT IN ('customer', 'super_admin', 'admin')`),
      outstanding_invoices: await n(`SELECT COUNT(*) AS c FROM sales_documents WHERE doc_type = 'INV' AND COALESCE(payment_status, 'unpaid') != 'paid'`),
      // Cash flow proxy for the month: cash IN (paid invoices) - cash OUT (expenses).
      cash_in_cents: await n(`SELECT COALESCE(SUM(total_cents), 0) AS c FROM sales_documents WHERE doc_type = 'INV' AND payment_status = 'paid' AND strftime('%Y-%m', COALESCE(paid_at, created_at), '+8 hours') = strftime('%Y-%m', 'now', '+8 hours')`),
      cash_out_cents: await n(`SELECT COALESCE(SUM(amount_cents), 0) AS c FROM expenses WHERE strftime('%Y-%m', expense_date) = strftime('%Y-%m', 'now', '+8 hours')`),
    });
  }

  /* v1.5.0: /trends/my removed with the Social tab. */

  if (path === "/staff-list" && method === "GET") {
    // v1.4.93: minimal staff list (id, name, role) for pickers like the
    // Sales-person dropdown — available to every staff role, exposes nothing
    // sensitive (no phone/IC/bank/salary).
    const { results } = await env.DB.prepare(
      `SELECT id, COALESCE(NULLIF(TRIM(full_name), ''), name) AS name, role FROM users
       WHERE is_active = 1 AND role NOT IN ('customer', 'super_admin', 'admin')
       ORDER BY 2`,
    ).all();
    return json({ staff: results });
  }
  if (path === "/users/activity" && method === "GET") {
    // v1.4.153: user log for the Users tab — recent sign-ins and account
    // events from the audit trail. Same readers as the Users tab (exec_view /
    // hr_manage); shows auth + account actions only, not the full audit.
    if (!can(user.role, "hr_manage") && !can(user.role, "exec_view")) {
      return err("forbidden", "HR access required", 403);
    }
    const { results } = await env.DB.prepare(
      `SELECT a.action, a.created_at, COALESCE(NULLIF(TRIM(u.full_name), ''), u.name) AS name, u.email
       FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
       WHERE a.action IN ('auth.login', 'auth.login_2fa', 'auth.login_google', 'auth.2fa_challenge', 'auth.2fa_backup_used', 'auth.2fa_enabled', 'auth.2fa_disabled')
       ORDER BY a.created_at DESC LIMIT 60`,
    ).all();
    return json({ events: results });
  }
  if (path === "/users" && method === "GET") {
    // hr_manage writes; exec_view (CEO) reads — the Birthdays tab and the
    // Overview need the staff list even for read-only executives.
    if (!can(user.role, "hr_manage") && !can(user.role, "exec_view")) {
      return err("forbidden", "HR access required", 403);
    }
    /* v1.4.218 MIGRATION-SKEW ARMOR (the Staff tab went BLANK when the
       v1.4.213 code deployed before migrations 0058/0059 ran — "no such
       column: address" killed the whole SELECT and with it the entire
       directory). The staff list is too important to die over optional
       columns: if the profile columns don't exist yet, fall back to the
       pre-0059 column list so the directory always renders; the seven
       profile fields simply arrive after `wrangler d1 migrations apply`. */
    let results: unknown[];
    try {
      ({ results } = await env.DB.prepare(
        `SELECT id, name, full_name, email, role, employee_id, position, department, phone, employment_status, is_active, id_issued_on, birthday, blood_type, photo_key, bank_name, bank_account, joined_on, ic_number, left_on, rejoined_on,
                address, emergency_name, emergency_phone, emergency_relation, epf_no, socso_no, tax_no,
                CASE WHEN totp_secret IS NOT NULL THEN 1 ELSE 0 END AS totp_enabled
         FROM users ORDER BY name`,
      ).all());
    } catch (e) {
      if (!(e instanceof Error && e.message.includes("no such column"))) throw e;
      await logError(env, "migration_skew", "GET /users: 0059 profile columns missing — run wrangler d1 migrations apply");
      ({ results } = await env.DB.prepare(
        `SELECT id, name, full_name, email, role, employee_id, position, department, phone, employment_status, is_active, id_issued_on, birthday, blood_type, photo_key, bank_name, bank_account, joined_on, ic_number, left_on, rejoined_on,
                CASE WHEN totp_secret IS NOT NULL THEN 1 ELSE 0 END AS totp_enabled
         FROM users ORDER BY name`,
      ).all());
    }
    return json({ users: results, staff: results });
  }
  const staffUser = path.match(/^\/users\/(\d+)$/);
  if (staffUser && method === "PATCH") {
    // hr_admin/coo/cco/admin tier manage staff fields. CEO is read-only
    // everywhere EXCEPT staff birthdays, which policy lets the CEO maintain.
    const onlyBirthday = body && Object.keys(body).length > 0 &&
      Object.keys(body).every((k) => k === "birthday");
    const allowed = can(user.role, "hr_manage") || (onlyBirthday && user.role === "ceo");
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
    /* v1.4.183 (CEO: "live host I should have either part time or
       contract/permanent. this need to be justify!"): an ACTIVE live host is
       exactly one of those three — probation is not a live-host status.
       Resigned/terminated stay allowed (lifecycle). */
    if (typeof body?.employment_status === "string" && body.employment_status === "probation") {
      const roleRow = await env.DB.prepare(`SELECT role FROM users WHERE id = ?1`).bind(id).first<{ role: string }>();
      if (roleRow?.role === "live_host") {
        return err("invalid_input", "A live host is part-time, contract or permanent — probation is not a live-host status (CEO rule)", 400);
      }
    }
    // v1.4.213 profile fields: emergency contact + address (duty of care)
    // and EPF/SOCSO/tax numbers (ready for the pending statutory registration).
    const fields = ["employee_id", "position", "department", "employment_status", "birthday", "id_issued_on", "full_name", "phone", "blood_type", "bank_name", "bank_account", "joined_on", "ic_number", "left_on", "rejoined_on", "address", "emergency_name", "emergency_phone", "emergency_relation", "epf_no", "socso_no", "tax_no"] as const;
    let current: Record<string, string | null> | null;
    try {
      current = await env.DB.prepare(
        `SELECT employee_id, position, department, employment_status, birthday, id_issued_on, full_name, phone, blood_type,
                address, emergency_name, emergency_phone, emergency_relation, epf_no, socso_no, tax_no
         FROM users WHERE id = ?1`,
      ).bind(id).first<Record<string, string | null>>();
    } catch (e) {
      // v1.4.218 migration-skew armor — see GET /users above.
      if (!(e instanceof Error && e.message.includes("no such column"))) throw e;
      current = await env.DB.prepare(
        `SELECT employee_id, position, department, employment_status, birthday, id_issued_on, full_name, phone, blood_type
         FROM users WHERE id = ?1`,
      ).bind(id).first<Record<string, string | null>>();
    }
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
    /* v1.9.1 — OFFICE GEOFENCE (replaces the selfie step). Placed AFTER the
       dup/no_clock_in checks (an "already punched" answer never needs
       location, and a refusal creates no record) and BEFORE the INSERT.
       Server-side check — the UI hint is courtesy, this line is the rule.
       No fence configured → punches behave exactly as before. */
    const gate = await gateGeofence(env, body, body.type === "clock_in" ? "clock in" : "clock out");
    if (gate.resp) return gate.resp;
    const gpsVal = gate.gps;
    await env.DB.prepare(
      `INSERT INTO attendance_records (user_id, type, ip, user_agent, gps)
       VALUES (?1, ?2, ?3, ?4, ?5)`,
    ).bind(
      user.id, body.type,
      request.headers.get("CF-Connecting-IP"),
      (request.headers.get("User-Agent") ?? "").slice(0, 300),
      gpsVal,
    ).run();
    return json({ ok: true, flag }, 201);
  }

  /* ---- overtime punches (v1.4.155) ----
     OT in / OT out open at 18:00 MYT. Overtime must already be approved by the
     staff member's Section HOD — the buttons record the hours, they are not the
     approval. Part-time staff (the live hosts) are not eligible, enforced here
     and hidden in the UI. Requires today's clock-in (you can't OT a day you
     never worked), and OT out requires today's OT in. One of each per day. */

  /* v1.4.191 OT APPROVAL CHAIN (CEO's gap list): OT day-pairs are decided
     by management — approvers = ceo/coo + admin tier. Only APPROVED OT will
     ever feed payroll. Decisions bell-notify the staff member. */
  /* v1.4.191 LOW-STOCK ALERTS: when an item's stock crosses to ≤5 (or drops
     further while low), bell-notify sales_marketing + the CEO once — the
     low_alerted column remembers the level already alerted at and resets
     when stock recovers above 5. Called from manual adjusts here and from
     the sync/cron sweep in index.ts. */
  const checkLowStock = async (itemId: number) => {
    try {
      const it = await env.DB.prepare(`SELECT sku, name, stock, low_alerted FROM inventory_items WHERE id = ?1`)
        .bind(itemId).first<{ sku: string; name: string; stock: number; low_alerted: number | null }>();
      if (!it) return;
      if (it.stock > 5) {
        if (it.low_alerted != null) await env.DB.prepare(`UPDATE inventory_items SET low_alerted = NULL WHERE id = ?1`).bind(itemId).run();
        return;
      }
      if (it.low_alerted != null && it.stock >= it.low_alerted) return; // already alerted at this level or lower
      const { results: staffRows } = await env.DB.prepare(
        `SELECT id FROM users WHERE is_active = 1 AND role IN ('sales_marketing', 'ceo')`,
      ).all<{ id: number }>();
      const msg = it.stock <= 0
        ? `🛑 OUT OF STOCK: ${it.sku} ${it.name}`
        : `⚠ Low stock: ${it.sku} ${it.name} — ${it.stock} left`;
      for (const st of staffRows) await notify(env, st.id, "stock", msg, `stock:${itemId}`);
      await env.DB.prepare(`UPDATE inventory_items SET low_alerted = ?1 WHERE id = ?2`).bind(it.stock, itemId).run();
    } catch { /* pre-0056 or best-effort */ }
  };

  /* v1.4.193 (CEO: "insert live GMV into my /portal at dashboard tabs for my
     staff view their live GMV daily results"): TikTok Live GMV for EVERY
     staff role — today, this month, and the last 7 days, from order amounts
     on TT- postage records (returned excluded). When the viewer has live
     sessions scheduled with an end time, orders landing INSIDE their session
     windows today are attributed as "during your live" (motivation, not
     payroll — window-based attribution, EXISTS to avoid double counting). */
  if (path === "/gmv" && method === "GET") {
    const base = `FROM postage_records WHERE order_ref LIKE 'TT-%' AND status != 'returned' AND order_amount_cents IS NOT NULL`;
    const today = await env.DB.prepare(
      `SELECT COALESCE(SUM(order_amount_cents), 0) AS c, COUNT(*) AS n ${base}
       AND date(created_at, '+8 hours') = date('now', '+8 hours')`,
    ).first<{ c: number; n: number }>();
    const monthG = await env.DB.prepare(
      `SELECT COALESCE(SUM(order_amount_cents), 0) AS c, COUNT(*) AS n ${base}
       AND strftime('%Y-%m', created_at, '+8 hours') = strftime('%Y-%m', 'now', '+8 hours')`,
    ).first<{ c: number; n: number }>();
    const { results: week } = await env.DB.prepare(
      `SELECT date(created_at, '+8 hours') AS d, COALESCE(SUM(order_amount_cents), 0) AS c, COUNT(*) AS n ${base}
       AND date(created_at, '+8 hours') >= date('now', '+8 hours', '-6 days')
       GROUP BY d ORDER BY d DESC`,
    ).all<{ d: string; c: number; n: number }>();
    let mine: { c: number; n: number } | null = null;
    try {
      const m = await env.DB.prepare(
        `SELECT COALESCE(SUM(order_amount_cents), 0) AS c, COUNT(*) AS n ${base}
         AND date(created_at, '+8 hours') = date('now', '+8 hours')
         AND EXISTS (
           SELECT 1 FROM live_sessions s
           WHERE s.host_user_id = ?1 AND s.status != 'cancelled' AND s.end_time IS NOT NULL
             AND s.session_date = date(postage_records.created_at, '+8 hours')
             AND strftime('%H:%M', postage_records.created_at, '+8 hours') >= s.start_time
             AND strftime('%H:%M', postage_records.created_at, '+8 hours') <= s.end_time
         )`,
      ).bind(user.id).first<{ c: number; n: number }>();
      const hasToday = await env.DB.prepare(
        `SELECT COUNT(*) AS n FROM live_sessions WHERE host_user_id = ?1 AND status != 'cancelled'
         AND session_date = date('now', '+8 hours')`,
      ).bind(user.id).first<{ n: number }>();
      if ((hasToday?.n ?? 0) > 0) mine = { c: m?.c ?? 0, n: m?.n ?? 0 };
    } catch { /* pre-0056 — company figures still return */ }
    return json({
      today: { cents: today?.c ?? 0, orders: today?.n ?? 0 },
      month: { cents: monthG?.c ?? 0, orders: monthG?.n ?? 0 },
      week,
      my_sessions_today: mine,
    });
  }

  if (path === "/attendance/ot/pending" && method === "GET") {
    if (!["ceo", "coo", "super_admin", "admin"].includes(user.role)) {
      return err("forbidden", "OT approvals are for the CEO/COO", 403);
    }
    try {
      const { results } = await env.DB.prepare(
        `SELECT o.user_id, u.name, date(o.created_at, '+8 hours') AS d, o.status,
                MIN(CASE WHEN o.type = 'ot_in'  THEN strftime('%H:%M', o.created_at, '+8 hours') END) AS ot_in,
                MAX(CASE WHEN o.type = 'ot_out' THEN strftime('%H:%M', o.created_at, '+8 hours') END) AS ot_out
         FROM ot_records o JOIN users u ON u.id = o.user_id
         GROUP BY o.user_id, d
         HAVING o.status = 'pending' AND ot_out IS NOT NULL
         ORDER BY d DESC LIMIT 100`,
      ).all();
      return json({ pending: results });
    } catch (e) {
      if (String(e).includes("no such column")) return err("migration_missing", "Run: npx wrangler d1 migrations apply azoneofficial --remote (0054_ot_approval)", 500);
      throw e;
    }
  }
  if (path === "/attendance/ot/decide" && method === "POST") {
    if (!["ceo", "coo", "super_admin", "admin"].includes(user.role)) {
      return err("forbidden", "OT approvals are for the CEO/COO", 403);
    }
    const uid = Number(body?.user_id); const day = typeof body?.date === "string" ? body.date : "";
    const decision = body?.decision === "approved" ? "approved" : body?.decision === "rejected" ? "rejected" : null;
    if (!uid || !/^\d{4}-\d{2}-\d{2}$/.test(day) || !decision) {
      return err("invalid_input", "user_id, date (YYYY-MM-DD) and decision (approved/rejected) required", 400);
    }
    if (uid === user.id) return err("forbidden", "You cannot decide your own OT", 403);
    const note = typeof body?.note === "string" ? body.note.slice(0, 300) : null;
    const r = await env.DB.prepare(
      `UPDATE ot_records SET status = ?1, decided_by = ?2, decided_at = datetime('now'), decision_note = ?3
       WHERE user_id = ?4 AND date(created_at, '+8 hours') = ?5 AND status = 'pending'`,
    ).bind(decision, user.id, note, uid, day).run();
    if ((r.meta?.changes ?? 0) === 0) return err("not_found", "No pending OT punches for that day", 404);
    await notify(env, uid, "ot", `Your overtime on ${day.split("-").reverse().join("-")} was ${decision}${note ? ` — ${note}` : ""}`, `ot:${day}`);
    await audit(env, user.id, "ot.decide", "users", String(uid), { date: day, decision });
    return json({ ok: true });
  }

  /* v1.4.191 LIVE SESSION ROSTER: which host, which client, which platform,
     what slot — the schedule a live commerce agency runs on. Managers =
     ceo/coo/cco/hr_admin + admin tier; hosts see their own. */
  if (path === "/live-sessions" && method === "GET") {
    const mgr = ["ceo", "coo", "cco", "hr_admin", "super_admin", "admin"].includes(user.role);
    try {
      const { results } = await env.DB.prepare(
        mgr
          ? `SELECT s.*, u.name AS host_name, c.company AS client_company
             FROM live_sessions s JOIN users u ON u.id = s.host_user_id
             LEFT JOIN customers c ON c.id = s.client_id
             WHERE s.session_date >= date('now', '+8 hours', '-14 days')
             ORDER BY s.session_date, s.start_time LIMIT 200`
          : `SELECT s.*, u.name AS host_name, c.company AS client_company
             FROM live_sessions s JOIN users u ON u.id = s.host_user_id
             LEFT JOIN customers c ON c.id = s.client_id
             WHERE s.host_user_id = ?1 AND s.session_date >= date('now', '+8 hours', '-14 days')
             ORDER BY s.session_date, s.start_time LIMIT 100`,
      ).bind(...(mgr ? [] : [user.id])).all();
      return json({ sessions: results, manager: mgr });
    } catch (e) {
      if (String(e).includes("no such table")) return err("migration_missing", "Run: npx wrangler d1 migrations apply azoneofficial --remote (0056_live_sessions)", 500);
      throw e;
    }
  }
  if (path === "/live-sessions" && method === "POST") {
    if (!["ceo", "coo", "cco", "hr_admin", "super_admin", "admin"].includes(user.role)) {
      return err("forbidden", "Session scheduling is for management", 403);
    }
    const d = typeof body?.session_date === "string" ? body.session_date : "";
    const st = typeof body?.start_time === "string" ? body.start_time : "";
    const host = Number(body?.host_user_id);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !/^\d{2}:\d{2}$/.test(st) || !host) {
      return err("invalid_input", "session_date, start_time and host_user_id are required", 400);
    }
    const hostRow = await env.DB.prepare(`SELECT name, role, is_active FROM users WHERE id = ?1`)
      .bind(host).first<{ name: string; role: string; is_active: number }>();
    if (!hostRow || !hostRow.is_active || ["customer", "super_admin", "admin"].includes(hostRow.role)) {
      return err("invalid_input", "Host must be an active staff member", 400);
    }
    const platform = ["tiktok", "shopee", "other"].includes(String(body?.platform)) ? String(body?.platform) : "tiktok";
    const clientId = Number(body?.client_id) || null;
    const res = await env.DB.prepare(
      `INSERT INTO live_sessions (session_date, start_time, end_time, platform, client_id, client_name, host_user_id, notes, created_by)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9) RETURNING id`,
    ).bind(
      d, st,
      typeof body?.end_time === "string" && /^\d{2}:\d{2}$/.test(body.end_time) ? body.end_time : null,
      platform, clientId,
      typeof body?.client_name === "string" && body.client_name.trim() ? body.client_name.trim().slice(0, 120) : null,
      host,
      typeof body?.notes === "string" ? body.notes.slice(0, 500) : null,
      user.id,
    ).first<{ id: number }>();
    // v1.4.273 idea 5: a new booking re-arms the gone-quiet alert
    if (clientId) { try { await env.DB.prepare(`UPDATE customers SET quiet_alerted_on = NULL WHERE id = ?1`).bind(clientId).run(); } catch { /* pre-0067 */ } }
    await notify(env, host, "live", `📺 Live session assigned: ${d.split("-").reverse().join("-")} ${st} (${platform})`, `live:${res?.id}`);
    await audit(env, user.id, "live.schedule", "users", String(host), { date: d, start: st, platform });
    return json({ ok: true, id: res?.id }, 201);
  }
  {
    const mLS = path.match(/^\/live-sessions\/(\d+)$/);
    if (mLS && method === "PATCH") {
      if (!["ceo", "coo", "cco", "hr_admin", "super_admin", "admin"].includes(user.role)) {
        return err("forbidden", "Session scheduling is for management", 403);
      }
      /* v1.9.0: PATCH also reschedules (date/time/host) — the roster's
         drag-and-drop backend. Status keeps its old contract. */
      const setsLS: string[] = [];
      const argsLS: unknown[] = [];
      const putLS = (col: string, v: unknown) => { setsLS.push(`${col} = ?${argsLS.length + 1}`); argsLS.push(v); };
      const st = ["scheduled", "completed", "cancelled"].includes(String(body?.status)) ? String(body?.status) : null;
      if (st) putLS("status", st);
      if (typeof body?.session_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.session_date)) putLS("session_date", body.session_date);
      if (typeof body?.start_time === "string" && /^\d{2}:\d{2}$/.test(body.start_time)) putLS("start_time", body.start_time);
      if (typeof body?.end_time === "string" && /^\d{2}:\d{2}$/.test(body.end_time)) putLS("end_time", body.end_time);
      else if (body?.end_time === "" || body?.end_time === null) putLS("end_time", null); // v1.22.6: an edit may clear the end time
      if (Number(body?.host_user_id)) {
        const nh = await env.DB.prepare(`SELECT id, is_active, role FROM users WHERE id = ?1`).bind(Number(body!.host_user_id)).first<{ id: number; is_active: number; role: string }>();
        if (!nh || !nh.is_active || ["customer", "super_admin", "admin"].includes(nh.role)) return err("invalid_input", "Host must be an active staff member", 400);
        putLS("host_user_id", nh.id);
      }
      /* v1.22.6 (CEO: "I want to have an option for CEO, COO and CCO to
         amend or to update the roster / schedule if necessary or any typo"):
         the DETAILS — client, platform, notes — are amendable too, but only
         by the roles he named (+ the admin tier safety net). hr_admin keeps
         its scheduling powers (status/date/time/host) untouched. */
      const wantsDetails = body?.client_name !== undefined || body?.platform !== undefined || body?.notes !== undefined;
      if (wantsDetails) {
        if (!["ceo", "coo", "cco", "super_admin", "admin"].includes(user.role)) {
          return err("forbidden", "Only the CEO, COO or CCO can amend session details", 403);
        }
        if (typeof body?.client_name === "string") putLS("client_name", body.client_name.trim() ? body.client_name.trim().slice(0, 120) : null);
        if (["tiktok", "shopee", "other"].includes(String(body?.platform))) putLS("platform", String(body!.platform));
        if (typeof body?.notes === "string") putLS("notes", body.notes.trim() ? body.notes.slice(0, 500) : null);
      }
      if (setsLS.length === 0) return err("invalid_input", "Nothing to update (status, session_date, start_time, end_time, host_user_id, client_name, platform, notes)", 400);
      const before = await env.DB.prepare(`SELECT session_date, start_time, host_user_id FROM live_sessions WHERE id = ?1`).bind(mLS[1]).first<{ session_date: string; start_time: string; host_user_id: number }>();
      await env.DB.prepare(`UPDATE live_sessions SET ${setsLS.join(", ")} WHERE id = ?${argsLS.length + 1}`).bind(...argsLS, mLS[1]).run();
      const after = await env.DB.prepare(`SELECT session_date, start_time, end_time, host_user_id FROM live_sessions WHERE id = ?1`).bind(mLS[1]).first<{ session_date: string; start_time: string; end_time: string | null; host_user_id: number }>();
      // Tell the host when their session moved (or when it became theirs).
      if (after && before && (before.session_date !== after.session_date || before.start_time !== after.start_time || before.host_user_id !== after.host_user_id)) {
        await notify(env, after.host_user_id, "live",
          `📺 Live session ${before.host_user_id !== after.host_user_id ? "assigned to you" : "rescheduled"}: ${after.session_date.split("-").reverse().join("-")} ${after.start_time}${after.end_time ? `–${after.end_time}` : ""}`,
          `live:${mLS[1]}`);
        if (before.host_user_id !== after.host_user_id) {
          await notify(env, before.host_user_id, "live",
            `📺 Your live session on ${before.session_date.split("-").reverse().join("-")} ${before.start_time} was reassigned to another host.`,
            `live:${mLS[1]}`);
        }
      }
      await audit(env, user.id, "live.update", "live_sessions", mLS[1]!, (body ?? {}) as Record<string, unknown>);
      return json({ ok: true });
    }
  }

  /* v1.9.0 — orders by buyer city (the ops-map card). revenue_view. */
  if (path === "/orders/geo" && method === "GET") {
    if (!can(user.role, "revenue_view")) return err("forbidden", "Revenue access required", 403);
    try {
      const { results } = await env.DB.prepare(
        `SELECT lower(TRIM(buyer_city)) AS city, COUNT(*) AS orders, COALESCE(SUM(order_amount_cents), 0) AS cents
         FROM postage_records
         WHERE buyer_city IS NOT NULL AND TRIM(buyer_city) != '' AND status != 'returned'
         GROUP BY lower(TRIM(buyer_city)) ORDER BY orders DESC LIMIT 100`,
      ).all<{ city: string; orders: number; cents: number }>();
      return json({ cities: results });
    } catch (e) {
      if (String(e).includes("no such column")) return json({ cities: [] });
      throw e;
    }
  }

  /* ================= v1.8.0 — Schedule & Roster board ======================
     One aggregate for the week grid: sessions, approved leave, conflicts
     (overlapping sessions per host, or a session whose host is on leave),
     unassigned requests (new client enquiries), and who is free today.
     Managers see everyone; other staff see their own sessions only. */
  if (path === "/roster" && method === "GET") {
    const mgrR = ["ceo", "coo", "cco", "hr_admin", "super_admin", "admin"].includes(user.role);
    const wk = new URL(request.url).searchParams.get("week");
    // Week starts Monday. Default: the Monday of the current MYT week.
    const todayMY = new Date(Date.now() + 8 * 3600 * 1000);
    const dow = (todayMY.getUTCDay() + 6) % 7; // 0 = Monday
    const defStart = new Date(todayMY.getTime() - dow * 86400_000).toISOString().slice(0, 10);
    const start = wk && /^\d{4}-\d{2}-\d{2}$/.test(wk) ? wk : defStart;
    const startMs = Date.parse(start + "T00:00:00Z");
    if (!Number.isFinite(startMs)) return err("invalid_input", "week must be YYYY-MM-DD", 400);
    const days: string[] = [];
    for (let i = 0; i < 7; i++) days.push(new Date(startMs + i * 86400_000).toISOString().slice(0, 10));
    const end = days[6]!;
    try {
      const { results: sessions } = await env.DB.prepare(
        mgrR
          ? `SELECT s.id, s.session_date, s.start_time, s.end_time, s.platform, s.status,
                    s.client_id, COALESCE(c.company, s.client_name) AS client, s.notes,
                    s.host_user_id, COALESCE(NULLIF(TRIM(u.full_name), ''), u.name) AS host_name, u.photo_key
             FROM live_sessions s JOIN users u ON u.id = s.host_user_id
             LEFT JOIN customers c ON c.id = s.client_id
             WHERE s.session_date BETWEEN ?1 AND ?2
             ORDER BY s.session_date, s.start_time LIMIT 400`
          : `SELECT s.id, s.session_date, s.start_time, s.end_time, s.platform, s.status,
                    s.client_id, COALESCE(c.company, s.client_name) AS client, s.notes,
                    s.host_user_id, COALESCE(NULLIF(TRIM(u.full_name), ''), u.name) AS host_name, u.photo_key
             FROM live_sessions s JOIN users u ON u.id = s.host_user_id
             LEFT JOIN customers c ON c.id = s.client_id
             WHERE s.host_user_id = ?3 AND s.session_date BETWEEN ?1 AND ?2
             ORDER BY s.session_date, s.start_time LIMIT 100`,
      ).bind(...(mgrR ? [start, end] : [start, end, user.id]))
        .all<{ id: number; session_date: string; start_time: string; end_time: string | null; host_user_id: number; status: string }>();

      /* PDPA: leave (especially its TYPE) is HR data. Managers get the whole
         floor WITHOUT the type; non-managers get only their own rows. The
         conflict engine below still sees the manager-scope rows it needs. */
      let onLeave: unknown[] = [];
      try {
        onLeave = (await env.DB.prepare(
          mgrR
            ? `SELECT l.user_id, COALESCE(NULLIF(TRIM(u.full_name), ''), u.name) AS name, l.start_date, l.end_date
               FROM leave_requests l JOIN users u ON u.id = l.user_id
               WHERE l.status = 'approved' AND l.start_date <= ?2 AND l.end_date >= ?1`
            : `SELECT l.user_id, COALESCE(NULLIF(TRIM(u.full_name), ''), u.name) AS name, l.start_date, l.end_date
               FROM leave_requests l JOIN users u ON u.id = l.user_id
               WHERE l.user_id = ?3 AND l.status = 'approved' AND l.start_date <= ?2 AND l.end_date >= ?1`,
        ).bind(...(mgrR ? [start, end] : [start, end, user.id])).all()).results;
      } catch { /* pre-migration */ }

      // Conflicts: overlapping sessions for the same host, and sessions whose
      // host has approved leave covering the session day.
      const conflicts: { kind: string; session_ids: number[]; host_user_id: number; date: string }[] = [];
      const live = sessions.filter((x) => x.status !== "cancelled");
      const endOf = (x: { start_time: string; end_time: string | null }) => x.end_time ?? addMinutes(x.start_time, 60);
      for (let i = 0; i < live.length; i++) {
        for (let j = i + 1; j < live.length; j++) {
          const a = live[i]!, b = live[j]!;
          if (a.host_user_id !== b.host_user_id || a.session_date !== b.session_date) continue;
          if (a.start_time < endOf(b) && b.start_time < endOf(a)) {
            conflicts.push({ kind: "overlap", session_ids: [a.id, b.id], host_user_id: a.host_user_id, date: a.session_date });
          }
        }
      }
      const leaveRows = onLeave as { user_id: number; start_date: string; end_date: string }[];
      for (const sess of live) {
        if (leaveRows.some((l) => l.user_id === sess.host_user_id && l.start_date <= sess.session_date && l.end_date >= sess.session_date)) {
          conflicts.push({ kind: "host_on_leave", session_ids: [sess.id], host_user_id: sess.host_user_id, date: sess.session_date });
        }
      }

      // Unassigned requests: new customer enquiries (live/package) — the rail's
      // "clients still requiring a host". Managers only.
      let requests: unknown[] = [];
      if (mgrR) {
        try {
          requests = (await env.DB.prepare(
            `SELECT id, name, company, category, created_at FROM enquiries
             WHERE status = 'new' ORDER BY created_at DESC LIMIT 8`,
          ).all()).results;
        } catch { /* enquiries always exists, but stay armoured */ }
      }

      // Available today: active staff (host-capable roles) with no live
      // session today and no approved leave covering today.
      const todayS = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
      let available: unknown[] = [];
      if (mgrR) {
        const { results } = await env.DB.prepare(
          `SELECT u.id, COALESCE(NULLIF(TRIM(u.full_name), ''), u.name) AS name, u.role, u.photo_key
           FROM users u
           WHERE u.is_active = 1 AND u.role NOT IN ('customer', 'super_admin', 'admin')
             AND NOT EXISTS (SELECT 1 FROM live_sessions s2 WHERE s2.host_user_id = u.id
                               AND s2.session_date = ?1 AND s2.status != 'cancelled')
             AND NOT EXISTS (SELECT 1 FROM leave_requests l2 WHERE l2.user_id = u.id
                               AND l2.status = 'approved' AND l2.start_date <= ?1 AND l2.end_date >= ?1)
           ORDER BY 2 LIMIT 12`,
        ).bind(todayS).all();
        available = results;
      }

      return json({
        week_start: start, days, manager: mgrR,
        sessions, on_leave: onLeave, conflicts, requests, available_today: available,
      });
    } catch (e) {
      if (String(e).includes("no such table")) return err("migration_missing", "Run migration 0056 (live sessions) first", 409);
      throw e;
    }
  }

  /* v1.4.191 STAFF DOCUMENT VAULT + onboarding checklist. Vault: contracts /
     offer letters / resignation letters into R2 (private/staff-docs/), index
     in staff_documents. Upload/delete = hr_manage; each staff member can
     list + download their OWN documents. */
  {
    const mDoc = path.match(/^\/users\/(\d+)\/documents$/);
    if (mDoc && method === "GET") {
      const uidD = Number(mDoc[1]);
      if (!can(user.role, "hr_manage") && user.id !== uidD) return err("forbidden", "Not your documents", 403);
      try {
        const { results } = await env.DB.prepare(
          `SELECT d.id, d.kind, d.label, d.filename, d.size, d.created_at, u.name AS uploaded_by_name
           FROM staff_documents d LEFT JOIN users u ON u.id = d.uploaded_by
           WHERE d.user_id = ?1 ORDER BY d.created_at DESC`,
        ).bind(uidD).all();
        let onboarding: Record<string, boolean> = {};
        try {
          const ob = await env.DB.prepare(`SELECT onboarding_json FROM users WHERE id = ?1`)
            .bind(uidD).first<{ onboarding_json: string | null }>();
          onboarding = ob?.onboarding_json ? (JSON.parse(ob.onboarding_json) as Record<string, boolean>) : {};
        } catch { /* pre-0057 */ }
        return json({ documents: results, onboarding });
      } catch (e) {
        if (String(e).includes("no such table")) return err("migration_missing", "Run: npx wrangler d1 migrations apply azoneofficial --remote (0057_staff_docs_vault)", 500);
        throw e;
      }
    }
    if (mDoc && method === "POST") {
      if (!can(user.role, "hr_manage")) return err("forbidden", "HR access required", 403);
      if (!request.body) return err("invalid_input", "File body required", 400);
      const ctD = request.headers.get("Content-Type") ?? "application/octet-stream";
      if (!["application/pdf", "image/jpeg", "image/png"].includes(ctD)) return err("invalid_input", "Only PDF/JPEG/PNG documents allowed", 400);
      const kindD = ["contract", "offer_letter", "resignation", "other"].includes(request.headers.get("X-Doc-Kind") ?? "") ? request.headers.get("X-Doc-Kind")! : "other";
      const fnameD = (request.headers.get("X-Doc-Filename") ?? "document").slice(0, 160);
      const labelD = (request.headers.get("X-Doc-Label") ?? "").slice(0, 160) || null;
      const keyD = `private/staff-docs/${mDoc[1]}-${Date.now()}-${fnameD.replace(/[^A-Za-z0-9._-]/g, "_")}`;
      await env.MEDIA.put(keyD, request.body, { httpMetadata: { contentType: ctD } });
      const head = await env.MEDIA.head(keyD);
      await env.DB.prepare(
        `INSERT INTO staff_documents (user_id, kind, label, r2_key, filename, size, uploaded_by)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
      ).bind(mDoc[1], kindD, labelD, keyD, fnameD, head?.size ?? null, user.id).run();
      await audit(env, user.id, "staff.document_upload", "users", mDoc[1]!, { kind: kindD, filename: fnameD });
      return json({ ok: true }, 201);
    }
  }
  {
    const mDocOne = path.match(/^\/staff-documents\/(\d+)$/);
    if (mDocOne && method === "GET") {
      const row = await env.DB.prepare(`SELECT user_id, r2_key, filename FROM staff_documents WHERE id = ?1`)
        .bind(mDocOne[1]).first<{ user_id: number; r2_key: string; filename: string | null }>();
      if (!row) return err("not_found", "Document not found", 404);
      if (!can(user.role, "hr_manage") && user.id !== row.user_id) return err("forbidden", "Not your document", 403);
      const obj = await env.MEDIA.get(row.r2_key);
      if (!obj) return err("not_found", "File missing from storage", 404);
      return new Response(obj.body, {
        headers: {
          "Content-Type": obj.httpMetadata?.contentType ?? "application/octet-stream",
          "Content-Disposition": `attachment; filename="${(row.filename ?? "document").replace(/[^A-Za-z0-9._ -]/g, "_")}"`,
        },
      });
    }
    if (mDocOne && method === "DELETE") {
      if (!can(user.role, "hr_manage")) return err("forbidden", "HR access required", 403);
      const row = await env.DB.prepare(`SELECT r2_key FROM staff_documents WHERE id = ?1`)
        .bind(mDocOne[1]).first<{ r2_key: string }>();
      if (!row) return err("not_found", "Document not found", 404);
      try { await env.MEDIA.delete(row.r2_key); } catch { /* best effort */ }
      await env.DB.prepare(`DELETE FROM staff_documents WHERE id = ?1`).bind(mDocOne[1]).run();
      await audit(env, user.id, "staff.document_delete", "staff_documents", mDocOne[1]!);
      return json({ ok: true });
    }
  }
  {
    const mChk = path.match(/^\/users\/(\d+)\/onboarding$/);
    if (mChk && method === "POST") {
      if (!can(user.role, "hr_manage")) return err("forbidden", "HR access required", 403);
      const items = body?.items;
      if (typeof items !== "object" || items === null) return err("invalid_input", "items object required", 400);
      try {
        await env.DB.prepare(`UPDATE users SET onboarding_json = ?1 WHERE id = ?2`)
          .bind(JSON.stringify(items).slice(0, 4000), mChk[1]).run();
      } catch (e) {
        if (String(e).includes("no such column")) return err("migration_missing", "Run: npx wrangler d1 migrations apply azoneofficial --remote (0057_staff_docs_vault)", 500);
        throw e;
      }
      await audit(env, user.id, "staff.onboarding", "users", mChk[1]!);
      return json({ ok: true });
    }
  }

  if (path === "/attendance/ot" && method === "POST") {
    const otTypes = ["ot_in", "ot_out"];
    if (!body || typeof body.type !== "string" || !otTypes.includes(body.type)) {
      return err("invalid_input", `type must be one of: ${otTypes.join(", ")}`, 400);
    }
    // v1.4.156 — two changes here:
    // (1) BUG FIX: v1.4.155 queried a non-existent `status` column; the real
    //     column is `employment_status` — the route would have thrown.
    // (2) CEO's clarified rule: OT eligibility follows EMPLOYMENT STATUS, not
    //     role. Permanent live hosts DO work overtime; part-time staff
    //     (part-time live hosts, part-time designers) are not eligible.
    // v1.4.158 (CEO): OT does not appear for ceo/coo/cco — executives are not
    // OT-paid staff (admin tier likewise; they're system accounts). Combined
    // with the part-time rule, OT eligibility is: a non-executive staff role
    // whose employment_status isn't part_time.
    if (["ceo", "coo", "cco", "super_admin", "admin"].includes(user.role)) {
      return err("not_eligible", "Executive roles (CEO/COO/CCO) are not eligible for OT punches.", 403);
    }
    const me = await env.DB.prepare(`SELECT employment_status FROM users WHERE id = ?1`)
      .bind(user.id).first<{ employment_status: string | null }>();
    if (me?.employment_status === "part_time") {
      return err("not_eligible", "Part-time staff are not eligible for OT punches.", 403);
    }
    /* v1.4.179 (CEO: "for OT there should be appear on Weekend … except of
       executive"): WEEKENDS (Sat/Sun MYT) are rest days — any work IS
       overtime, so OT punches are open ALL DAY and need no prior clock-in
       (there is no normal shift to extend). WEEKDAYS keep the original
       rule: window from 18:00 MYT, after a clocked-in working day. The
       executive/part-time exclusions above apply on every day. */
    const mytNow = new Date(Date.now() + 8 * 3600 * 1000);
    const isWeekendOT = [0, 6].includes(mytNow.getUTCDay());
    const nowMins = mytNow.getUTCHours() * 60 + mytNow.getUTCMinutes();
    if (!isWeekendOT && nowMins < 18 * 60) {
      return err("too_early", "Overtime punches open at 18:00 MYT, after the normal shift ends. (Weekends: OT is open all day.)", 400);
    }
    const todayMYT = mytNow.toISOString().slice(0, 10);
    if (!isWeekendOT) {
      // Weekday OT extends a worked day — must have clocked in today.
      const dayIn = await env.DB.prepare(
        `SELECT id FROM attendance_records
         WHERE user_id = ?1 AND type = 'clock_in' AND date(created_at, '+8 hours') = ?2 LIMIT 1`,
      ).bind(user.id, todayMYT).first<{ id: number }>();
      if (!dayIn) {
        return json(
          { error: { code: "no_clock_in", message: "No clock-in recorded today — weekday overtime can only follow a worked day." } },
          400,
        );
      }
    }
    try {
      if (body.type === "ot_out") {
        const otIn = await env.DB.prepare(
          `SELECT id FROM ot_records
           WHERE user_id = ?1 AND type = 'ot_in' AND date(created_at, '+8 hours') = ?2 LIMIT 1`,
        ).bind(user.id, todayMYT).first<{ id: number }>();
        if (!otIn) {
          return json(
            { error: { code: "no_ot_in", message: "You haven't recorded OT in — tap OT in when overtime starts, then OT out when you finish." } },
            400,
          );
        }
      }
      // One OT in and one OT out per day, enforced server-side like clock punches.
      const dup = await env.DB.prepare(
        `SELECT id, created_at FROM ot_records
         WHERE user_id = ?1 AND type = ?2 AND date(created_at, '+8 hours') = ?3 LIMIT 1`,
      ).bind(user.id, body.type, todayMYT).first<{ id: number; created_at: string }>();
      if (dup) {
        const at = new Date(new Date(dup.created_at.replace(" ", "T") + "Z").getTime() + 8 * 3600 * 1000)
          .toISOString().slice(11, 16);
        return json(
          {
            error: {
              code: "already_punched",
              message: body.type === "ot_in"
                ? `You already recorded OT in today at ${at} MYT.`
                : `You already recorded OT out today at ${at} MYT.`,
            },
            already: true,
            at,
          },
          409,
        );
      }
      /* v1.9.1 review fix: OT punches are gated by the SAME office fence as
         clock punches — OT hours are the paid ones, leaving them open would
         let the fence be bypassed for exactly the records that feed payroll.
         (ot_records has no gps column — the check gates, it doesn't store;
         the IP below remains the stored cross-check.) */
      const otGate = await gateGeofence(env, body, body.type === "ot_in" ? "record OT in" : "record OT out");
      if (otGate.resp) return otGate.resp;
      await env.DB.prepare(
        `INSERT INTO ot_records (user_id, type, ip, user_agent)
         VALUES (?1, ?2, ?3, ?4)`,
      ).bind(
        user.id,
        body.type,
        request.headers.get("CF-Connecting-IP"),
        (request.headers.get("User-Agent") ?? "").slice(0, 300),
      ).run();
    } catch (e) {
      if (String(e).includes("no such table")) {
        return err("migration_missing", "Run: npx wrangler d1 migrations apply azoneofficial --remote (0044_overtime)", 500);
      }
      throw e;
    }
    const hhmm = mytNow.toISOString().slice(11, 16);
    return json({ ok: true, at: hhmm }, 201);
  }

  if (path === "/attendance" && method === "GET") {
    const url = new URL(request.url);
    const month = url.searchParams.get("month") ?? new Date().toISOString().slice(0, 7);
    const targetUser = url.searchParams.get("user_id");
    const forUser = targetUser && can(user.role, "hr_manage") ? Number(targetUser) : user.id;
    // v1.9.1: the selfie step was replaced by the office geofence, so
    // selfie_key no longer rides along (nothing in the UI rendered it).
    // Selfies already in R2 stay behind the owner/HR media gate.
    const results = (await env.DB.prepare(
      `SELECT type, ip, created_at FROM attendance_records
       WHERE user_id = ?1 AND created_at LIKE ?2 || '%'
       ORDER BY created_at DESC LIMIT 400`,
    ).bind(forUser, month).all()).results;
    // v1.4.155: overtime punches ride along (own dashboard + HR views). Guarded
    // so the endpoint keeps working before migration 0044 lands.
    let ot: unknown[] = [];
    try {
      const o = await env.DB.prepare(
        `SELECT type, created_at FROM ot_records
         WHERE user_id = ?1 AND created_at LIKE ?2 || '%'
         ORDER BY created_at DESC LIMIT 100`,
      ).bind(forUser, month).all();
      ot = o.results;
    } catch { /* table not migrated yet — return empty */ }
    // Eligibility flag drives whether the dashboard shows the OT buttons at
    // all. v1.4.156: by employment_status (v1.4.155 queried a non-existent
    // `status` column), and by STATUS ONLY — permanent live hosts are
    // eligible; part-time anything is not.
    const meRow = await env.DB.prepare(`SELECT employment_status FROM users WHERE id = ?1`)
      .bind(user.id).first<{ employment_status: string | null }>();
    // v1.4.158: executives (ceo/coo/cco) and admin-tier accounts never get
    // the OT buttons, alongside the part-time exclusion.
    const ot_eligible = !["ceo", "coo", "cco", "super_admin", "admin"].includes(user.role)
      && meRow?.employment_status !== "part_time";
    return json({ month, records: results, ot, ot_eligible });
  }

  if (path === "/attendance/monitor" && method === "GET") {
    /* v1.4.173 (CEO: "monitoring of the Staff who is not clock in or clock
       out for me to aware"): today's snapshot per active staff member —
       first clock-in and last clock-out (MYT). The UI sorts the missing
       ones to the top. Same readers as the Team report. */
    if (!can(user.role, "hr_manage") && !can(user.role, "exec_view")) {
      return err("forbidden", "HR access required", 403);
    }
    const todayM = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
    const { results } = await env.DB.prepare(
      `SELECT u.id, COALESCE(NULLIF(TRIM(u.full_name), ''), u.name) AS name, u.role, u.employment_status,
              /* v1.4.177 HOTFIX: punches are stored as clock_in/clock_out —
                 v1.4.173 filtered on 'in'/'out', matched nothing, and showed
                 EVERYONE as not clocked in despite real data. */
              (SELECT MIN(a.created_at) FROM attendance_records a
                WHERE a.user_id = u.id AND a.type = 'clock_in'  AND date(a.created_at, '+8 hours') = ?1) AS in_at,
              (SELECT MAX(a.created_at) FROM attendance_records a
                WHERE a.user_id = u.id AND a.type = 'clock_out' AND date(a.created_at, '+8 hours') = ?1) AS out_at,
              /* v1.18.1 (CEO: "get user clock in accurately without cheating"):
                 the position stored on the FIRST clock-in of the day, so
                 management sees where each punch happened. */
              (SELECT a.gps FROM attendance_records a
                WHERE a.user_id = u.id AND a.type = 'clock_in' AND date(a.created_at, '+8 hours') = ?1
                ORDER BY a.created_at LIMIT 1) AS in_gps
       FROM users u
       WHERE u.is_active = 1
         AND u.role IN ('ceo','coo','cco','hr_admin','sales_marketing','marketing','editor','live_host')
         AND COALESCE(u.employment_status, 'permanent') NOT IN ('resigned','terminated')
       ORDER BY u.name`,
    ).bind(todayM).all();
    // v1.21.0: ship the fence with the list so management screens flag
    // "outside office" against the REAL configured fence (not a client
    // constant that could drift from it).
    return json({ date: todayM, staff: results, geofence: await getGeofence(env) });
  }

  if (path === "/attendance/report" && method === "GET") {
    // HR + CEO manage; COO/CCO (exec_view) read.
    if (!can(user.role, "hr_manage") && !can(user.role, "exec_view")) {
      return err("forbidden", "HR access required", 403);
    }
    const url = new URL(request.url);
    const month = url.searchParams.get("month") ?? new Date().toISOString().slice(0, 7);
    const { results } = await env.DB.prepare(
      `SELECT a.id, COALESCE(NULLIF(TRIM(u.full_name), ''), u.name) AS name, u.email, u.role, a.user_id, a.type, a.created_at, a.manual_by, a.amended_by, a.gps
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
    /* v1.21.0 (CEO: "I can see who is the person that apply leave and
       waiting for their Head approval"): the whole approval chain reads the
       full list — HR tier (hr_manage) AND the COO/CCO pre-approvers, who
       previously fell through to "own requests only" and saw an empty
       board even with applications pending. */
    const all = url.searchParams.get("all") === "1" &&
      (can(user.role, "hr_manage") || PREAPP_ROLES.includes(user.role) || FINAL_ROLES.includes(user.role));
    // v1.4.134: identities + per-day sequence for the printable Leave
    // Application Form (mirrors the claim form's data needs).
    const LSEL = `SELECT l.*,
        (SELECT COUNT(*) FROM leave_requests l2 WHERE date(l2.created_at) = date(l.created_at) AND l2.id <= l.id) AS day_seq,
        u.name AS user_name, u.full_name AS user_full, u.position AS user_position, u.department AS user_department, u.role AS applicant_role,
        hu.name AS hr_by_name, pu.name AS preapp_by_name, pu.full_name AS preapp_by_full, pu.role AS preapp_by_role,
        fu.name AS final_by_name, fu.full_name AS final_by_full
      FROM leave_requests l JOIN users u ON u.id = l.user_id
      LEFT JOIN users hu ON hu.id = l.hr_by
      LEFT JOIN users pu ON pu.id = l.preapp_by
      LEFT JOIN users fu ON fu.id = l.final_by`;
    const { results } = await env.DB.prepare(
      all
        ? `${LSEL} ORDER BY l.created_at DESC LIMIT 200`
        : `${LSEL} WHERE l.user_id = ?1 ORDER BY l.created_at DESC LIMIT 100`,
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
    if (!can(user.role, "team_manage")) return err("forbidden", "Management access required", 403);
    if (!body || !str(body.title, 200) || !str(body.body, 5000)) {
      return err("invalid_input", "title and body are required", 400);
    }
    const cats = ["news", "meeting", "holiday", "kpi", "training", "memo"]; // v1.4.215: internal memo
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

  /* v1.4.274 — the .ics served over HTTPS, because the SHARE SHEET was the
     wrong door: iOS's share sheet does not offer Calendar as a target for
     .ics files, and Android's rarely does — so v1.4.264's "pick Calendar in
     the share sheet" ended nowhere and nothing saved. Navigating to a URL
     whose response is text/calendar IS the door both phones understand:
     iOS Safari shows its built-in event preview with "Add All", Android
     opens the file straight into Google Calendar's import dialog. Any staff
     role — same audience as the events list. */
  {
    const mIcs = path.match(/^\/events\/(\d+)\/ics$/);
    if (mIcs && method === "GET") {
      const ev = await env.DB.prepare(`SELECT id, title, category, event_date, start_time, end_time, location, details FROM events WHERE id = ?1`)
        .bind(Number(mIcs[1])).first<{ id: number; title: string; category: string; event_date: string; start_time: string | null; end_time: string | null; location: string | null; details: string | null }>();
      if (!ev) return err("not_found", "Event not found", 404);
      const esc = (t: string) => t.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
      const pad2 = (n: number) => String(n).padStart(2, "0");
      const fold = (line: string) => {
        const out: string[] = []; let t = line;
        while (t.length > 74) { out.push(t.slice(0, 74)); t = " " + t.slice(74); }
        out.push(t); return out.join("\r\n");
      };
      const [y, mo, d] = ev.event_date.split("-").map(Number);
      const lines: string[] = [
        "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//AZ ONE OFFICIAL//Staff Portal//EN", "METHOD:PUBLISH",
        "BEGIN:VEVENT",
        `UID:event-${ev.id}@azoneofficial.com`, // stable: re-adding UPDATES, never duplicates
        `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`,
        `SUMMARY:${esc(ev.title)}`,
      ];
      if (ev.start_time && /^\d{2}:\d{2}/.test(ev.start_time)) {
        const [sh, sm] = ev.start_time.split(":").map(Number);
        const startUtc = new Date(Date.UTC(y!, mo! - 1, d!, sh! - 8, sm!)); // MYT → UTC instant
        let endUtc: Date;
        if (ev.end_time && /^\d{2}:\d{2}/.test(ev.end_time)) {
          const [eh, em] = ev.end_time.split(":").map(Number);
          endUtc = new Date(Date.UTC(y!, mo! - 1, d!, eh! - 8, em!));
          if (endUtc <= startUtc) endUtc = new Date(startUtc.getTime() + 3600_000);
        } else endUtc = new Date(startUtc.getTime() + 3600_000);
        const z = (dt: Date) => `${dt.getUTCFullYear()}${pad2(dt.getUTCMonth() + 1)}${pad2(dt.getUTCDate())}T${pad2(dt.getUTCHours())}${pad2(dt.getUTCMinutes())}00Z`;
        lines.push(`DTSTART:${z(startUtc)}`, `DTEND:${z(endUtc)}`);
      } else {
        const next = new Date(Date.UTC(y!, mo! - 1, d! + 1)); // RFC 5545 DTEND is EXCLUSIVE
        lines.push(`DTSTART;VALUE=DATE:${y}${pad2(mo!)}${pad2(d!)}`,
                   `DTEND;VALUE=DATE:${next.getUTCFullYear()}${pad2(next.getUTCMonth() + 1)}${pad2(next.getUTCDate())}`);
      }
      if (ev.location) lines.push(`LOCATION:${esc(ev.location)}`);
      const desc = [ev.category ? `Category: ${ev.category}` : "", ev.details ?? ""].filter(Boolean).join("\n");
      if (desc) lines.push(`DESCRIPTION:${esc(desc)}`);
      lines.push(
        "BEGIN:VALARM", "TRIGGER:-PT15H", "ACTION:DISPLAY", `DESCRIPTION:${esc(ev.title)} — tomorrow`, "END:VALARM",
        "BEGIN:VALARM", "TRIGGER:-PT0M", "ACTION:DISPLAY", `DESCRIPTION:${esc(ev.title)}`, "END:VALARM",
        "END:VEVENT", "END:VCALENDAR",
      );
      const body = lines.map(fold).join("\r\n") + "\r\n";
      const slug = ev.title.replace(/[^\w-]+/g, "-").slice(0, 40) || "event";
      return new Response(body, {
        headers: {
          // inline (not attachment): iOS Safari only shows its calendar
          // preview for an inline text/calendar navigation.
          "Content-Type": "text/calendar; charset=utf-8",
          "Content-Disposition": `inline; filename="${ev.event_date}-${slug}.ics"`,
          "Cache-Control": "no-store",
        },
      });
    }
  }

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
    if (!can(user.role, "events_manage")) return err("forbidden", "Management access required", 403);
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
    if (!can(user.role, "events_manage")) return err("forbidden", "Management access required", 403);
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
    if (!can(user.role, "events_manage")) return err("forbidden", "Management access required", 403);
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
  /* v1.4.175 (CEO: "how to counter this?"): a chain stage whose approver IS
     the payee is WAIVED BY DESIGN — the notification routes straight to the
     CEO instead of pinging someone who is forbidden from acting, and the CEO
     is told why. payeeRole is the payee's role (null = no payee). */
  const notifyClaimFirstStage = async (claimantRole: string, claimantName: string, claimId: string | number, cents: number, prefix: string, payeeRole?: string | null) => {
    const chain = claimChain(claimantRole);
    const msg = `${prefix}: ${claimantName} — RM ${(cents / 100).toFixed(2)}`;
    if (chain === "staff" && payeeRole !== "hr_admin") await notifyRoles(["hr_admin"], 0, `${msg} (HR review needed)`, `claim:${claimId}`);
    else if (chain === "hr" && payeeRole !== "cco") await notifyRoles(["cco"], 0, `${msg} (pre-approval needed)`, `claim:${claimId}`);
    else if (chain === "staff" || chain === "hr") await notifyRoles(["ceo"], 0, `${msg} (pre-approver is the payee — for your direct decision)`, `claim:${claimId}`);
    else await notifyRoles(["ceo"], 0, msg, `claim:${claimId}`);
  };
  if (path === "/claims" && method === "GET") {
    if (!can(user.role, "claims_submit")) return err("forbidden", "Claims access required", 403);
    // Deciders see everyone's claims (the approval queue); submitters their own.
    const all = can(user.role, "claims_decide");
    // v1.4.106: reviewers see the claims their stage covers, plus their own.
    // v1.4.173: py = the payee (who to actually PAY) — internal remark for
    // the CEO/admin tier + hr_admin only; stripped for everyone else below
    // and never printed on the claim form.
    const PAYEE_JOIN = ` LEFT JOIN users py ON py.id = c.payee_user_id`;
    const mkSel = (withPayee: boolean) => `SELECT c.*,
                  (SELECT COUNT(*) FROM claims c2 WHERE date(c2.created_at) = date(c.created_at) AND c2.id <= c.id) AS day_seq,
                  u.name AS claimant, u.full_name AS claimant_full, u.position AS claimant_position,
                  u.department AS claimant_department, u.role AS claimant_role,
                  d.name AS decided_by_name, d.full_name AS decided_by_full, hb.name AS hr_reviewed_by_name,
                  pb.name AS pre_approved_by_name, pb.full_name AS pre_approved_by_full, pb.role AS pre_approved_by_role${withPayee ? `,
                  py.name AS payee_name, py.full_name AS payee_full, py.role AS payee_role` : ""} FROM claims c
           LEFT JOIN users u ON u.id = c.user_id LEFT JOIN users d ON d.id = c.decided_by
           LEFT JOIN users hb ON hb.id = c.hr_reviewed_by LEFT JOIN users pb ON pb.id = c.pre_approved_by${withPayee ? PAYEE_JOIN : ""}`;
    const SEL = mkSel(true);
    const STAFF_CHAIN = "('marketing','sales_marketing','editor','live_host')";
    /* v1.4.174 (CEO: "if the payee is COO or CCO how? or on behalf of the
       staff how? they need to view what the claim status is"): the PAYEE
       always sees the claim raised in their name — every non-decider scope
       gains OR c.payee_user_id = me, so the person being paid can track the
       status (pending → approved → PAID) even though someone else submitted
       it. mkScope(false) keeps a pre-0051 fallback without the column. */
    const mkScope = (withPayee: boolean) => {
      const P = withPayee ? " OR c.payee_user_id = ?1" : "";
      return all ? ""
        // v1.4.121: HR keeps the full APPROVED history too (read-only, for
        // printing claim forms + payout proofs for compilation).
        : user.role === "hr_admin" ? ` WHERE (c.user_id = ?1 OR u.role IN ${STAFF_CHAIN} OR c.status = 'approved'${P})`
        : ["coo", "admin"].includes(user.role) ? ` WHERE (c.user_id = ?1 OR u.role IN ${STAFF_CHAIN}${P})`
          : user.role === "cco" ? ` WHERE (c.user_id = ?1 OR u.role = 'hr_admin'${P})`
            : ` WHERE (c.user_id = ?1${P})`;
    };
    let results: unknown[];
    try {
      results = (await env.DB.prepare(
        `${SEL}${mkScope(true)} ORDER BY CASE c.status WHEN 'pending' THEN 0 ELSE 1 END, c.created_at DESC LIMIT 200`,
      ).bind(...(all ? [] : [user.id])).all()).results;
    } catch {
      // pre-0051: same query without the payee join/columns/clause
      results = (await env.DB.prepare(
        `${mkSel(false)}${mkScope(false)} ORDER BY CASE c.status WHEN 'pending' THEN 0 ELSE 1 END, c.created_at DESC LIMIT 200`,
      ).bind(...(all ? [] : [user.id])).all()).results;
    }
    // v1.4.173/174: the payee remark stays a CEO/HR matter — EXCEPT on the
    // payee's OWN rows: whoever the money goes to (a staff member, the COO,
    // the CCO…) keeps the field on those rows so the banner and status make
    // sense to them. Everyone else still never receives it.
    if (!["super_admin", "admin", "ceo", "hr_admin"].includes(user.role)) {
      for (const r of results as Record<string, unknown>[]) {
        if (r.payee_user_id !== user.id) { delete r.payee_user_id; delete r.payee_name; delete r.payee_full; delete r.payee_role; }
      }
    }
    return json({ claims: results, can_decide: all });
  }
  const claimPayee = path.match(/^\/claims\/(\d+)\/payee$/);
  if (claimPayee && method === "POST") {
    /* v1.4.176 (CEO: "I want to know who is the payees and to insert the
       payees"): set or change the payee on an EXISTING claim — including
       ones approved before the payee feature existed. The payee is a
       payment-routing remark, not claim content, so this never restarts
       the chain; every change is audited with before → after. */
    if (!["super_admin", "admin", "ceo", "hr_admin"].includes(user.role)) {
      return err("forbidden", "Only the CEO, HR or the admin tier set the payee", 403);
    }
    const pid = typeof body?.payee_user_id === "number" ? Math.floor(body.payee_user_id) : NaN;
    if (!Number.isFinite(pid) || pid < 0) return err("invalid_input", "payee_user_id required (0 = pay the submitter)", 400);
    let cur: { id: number; payee_user_id?: number | null; status: string } | null = null;
    try {
      cur = await env.DB.prepare(`SELECT id, payee_user_id, status FROM claims WHERE id = ?1`).bind(claimPayee[1]).first();
    } catch {
      return err("migration_missing", "Run: npx wrangler d1 migrations apply azoneofficial --remote (0051_claim_payee)", 500);
    }
    if (!cur) return err("not_found", "Claim not found", 404);
    let newPayee: number | null = null;
    if (pid > 0) {
      const pu = await env.DB.prepare(
        `SELECT id FROM users WHERE id = ?1 AND is_active = 1 AND role NOT IN ('customer')`,
      ).bind(pid).first<{ id: number }>();
      if (!pu) return err("invalid_input", "Payee must be an active staff account", 400);
      newPayee = pu.id;
    }
    if ((cur.payee_user_id ?? null) === newPayee) return json({ ok: true, unchanged: true });
    await env.DB.prepare(`UPDATE claims SET payee_user_id = ?1 WHERE id = ?2`).bind(newPayee, claimPayee[1]).run();
    await audit(env, user.id, "claim.payee_set", "claims", claimPayee[1],
      { from: cur.payee_user_id ?? null, to: newPayee, claim_status: cur.status });
    return json({ ok: true });
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
    // v1.4.174: the no-self-review principle covers the PAYEE too — whoever
    // the money goes to doesn't review that claim; the next stage / CEO does.
    try {
      const pv = await env.DB.prepare(`SELECT payee_user_id FROM claims WHERE id = ?1`)
        .bind(claimReview[1]).first<{ payee_user_id: number | null }>();
      if (pv?.payee_user_id === user.id) return err("forbidden", "This claim pays to you — the next stage or the CEO handles it (no self-review)", 403);
    } catch { /* pre-0051 — no payee column yet */ }
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
    // v1.4.174: a COO/CCO who is the PAYEE of this claim doesn't pre-approve
    // it — conflict of interest; the CEO decides directly (override exists).
    try {
      const pvP = await env.DB.prepare(`SELECT payee_user_id FROM claims WHERE id = ?1`)
        .bind(claimPre[1]).first<{ payee_user_id: number | null }>();
      if (pvP?.payee_user_id === user.id) return err("forbidden", "This claim pays to you — the CEO decides it directly (no self-approval)", 403);
    } catch { /* pre-0051 */ }
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
    if (!can(user.role, "claims_submit")) return err("forbidden", "Claims access required", 403);
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
    // v1.4.173: payee remark travels with the edit (undefined = unchanged; 0 clears).
    if (typeof body?.payee_user_id === "number") {
      try {
        await env.DB.prepare(`UPDATE claims SET payee_user_id = ?1 WHERE id = ?2`)
          .bind(body.payee_user_id > 0 ? body.payee_user_id : null, claimEdit[1]).run();
      } catch { /* pre-0051 — ignore */ }
    }
    // v1.4.106: an edit restarts the chain from stage one.
    // v1.4.175: with the payee's role, so a conflicted stage reroutes to the CEO.
    let payeeRoleE: string | null = null;
    try {
      const prE = await env.DB.prepare(
        `SELECT py.role AS r FROM claims c LEFT JOIN users py ON py.id = c.payee_user_id WHERE c.id = ?1`,
      ).bind(claimEdit[1]).first<{ r: string | null }>();
      payeeRoleE = prE?.r ?? null;
    } catch { /* pre-0051 */ }
    await notifyClaimFirstStage(user.role, user.name, claimEdit[1]!, centsE,
      wasRejected ? "Resubmitted after rejection" : "Updated claim", payeeRoleE);
    await audit(env, user.id, wasRejected ? "claim.resubmit" : "claim.edit", "claims", claimEdit[1]!, { amount_cents: centsE });
    return json({ ok: true, resubmitted: wasRejected });
  }
  const claimDel = path.match(/^\/claims\/(\d+)\/delete$/);
  if (claimDel && method === "POST") {
    // v1.4.133: the claimant can DELETE their own claim while it is still
    // pending or rejected (not valid / submitted by mistake). Approved and
    // paid claims are records — never deletable.
    const rowD = await env.DB.prepare(`SELECT user_id, status, paid_at, receipt_key FROM claims WHERE id = ?1`)
      .bind(claimDel[1]).first<{ user_id: number; status: string; paid_at: string | null; receipt_key: string | null }>();
    if (!rowD) return err("not_found", "Claim not found", 404);
    if (rowD.user_id !== user.id) return err("forbidden", "Not your claim", 403);
    if (rowD.status === "approved" || rowD.paid_at) return err("invalid_state", "An approved or paid claim is a permanent record and cannot be deleted", 400);
    if (rowD.receipt_key) { try { await env.MEDIA.delete(rowD.receipt_key); } catch { /* best effort */ } }
    await env.DB.prepare(`DELETE FROM claims WHERE id = ?1`).bind(claimDel[1]).run();
    await audit(env, user.id, "claim.delete", "claims", claimDel[1]!, { status: rowD.status });
    return json({ ok: true });
  }
  const claimProof = path.match(/^\/claims\/(\d+)\/payment-proof$/);
  if (claimProof && method === "POST") {
    // v1.4.118: the payout proof (bank slip) — CEO only, after Mark paid.
    if (!can(user.role, "claims_decide")) return err("forbidden", "Only the CEO attaches payment proof", 403);
    const rowP = await env.DB.prepare(`SELECT status, paid_at, user_id FROM claims WHERE id = ?1`)
      .bind(claimProof[1]).first<{ status: string; paid_at: string | null; user_id: number }>();
    if (!rowP) return err("not_found", "Claim not found", 404);
    if (!rowP.paid_at) return err("invalid_state", "Mark the claim paid first, then attach the payment proof", 400);
    const ctP = request.headers.get("content-type") ?? "image/jpeg";
    if (!["application/pdf", "image/jpeg", "image/png"].includes(ctP)) return err("invalid_input", "Only PDF/JPEG/PNG proofs allowed", 400);
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
    // v1.4.121: HR reads payout proofs for compilation (proof exists ⇒ paid).
    if (rowG.user_id !== user.id && !can(user.role, "claims_decide") && user.role !== "hr_admin") return err("forbidden", "Not your claim", 403);
    const objP = await env.MEDIA.get(rowG.payment_proof_key);
    if (!objP) return err("not_found", "Payment proof file missing", 404);
    return new Response(objP.body, { headers: { "Content-Type": objP.httpMetadata?.contentType ?? "application/octet-stream", "Cache-Control": "private, max-age=300" } });
  }
  const claimPaid = path.match(/^\/claims\/(\d+)\/paid$/);
  if (claimPaid && method === "POST") {
    // v1.4.101: after approval the CEO records the actual payment — the
    // claimant sees PAID and the date on their submission.
    if (!can(user.role, "claims_decide")) return err("forbidden", "Only the CEO marks claims paid", 403);
    const cRow = await env.DB.prepare(`SELECT user_id, status, amount_cents FROM claims WHERE id = ?1`)
      .bind(claimPaid[1]).first<{ user_id: number; status: string; amount_cents: number }>();
    if (!cRow) return err("not_found", "Claim not found", 404);
    if (cRow.status !== "approved") return err("invalid_input", "Only approved claims can be marked paid", 400);
    await env.DB.prepare(`UPDATE claims SET paid_at = COALESCE(paid_at, datetime('now')) WHERE id = ?1`)
      .bind(claimPaid[1]).run();
    // v1.19.0 C2: the reimbursement becomes a bank movement, once.
    await recordBankMovement(env, user.id, `CLM-${claimPaid[1]}`, cRow.amount_cents, "claims", "Staff claim reimbursement");
    await notify(env, cRow.user_id, "claim", `Your claim (RM ${(cRow.amount_cents / 100).toFixed(2)}) has been PAID`, `claim:${claimPaid[1]}`);
    await audit(env, user.id, "claim.paid", "claims", claimPaid[1]!);
    return json({ ok: true });
  }
  if (path === "/claims" && method === "POST") {
    if (!can(user.role, "claims_submit")) return err("forbidden", "Claims access required", 403);
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
    /* v1.4.173 (CEO): the PAYEE — who the claim money actually goes to when
       HR raises a claim on behalf of someone. Internal remark only: never
       printed on the form; surfaced to the CEO/admin tier + hr_admin. */
    let payeeId: number | null = null;
    let payeeRole: string | null = null; // v1.4.175: drives conflict rerouting
    if (typeof body?.payee_user_id === "number" && body.payee_user_id > 0) {
      const pu = await env.DB.prepare(
        `SELECT id, role FROM users WHERE id = ?1 AND is_active = 1 AND role NOT IN ('customer')`,
      ).bind(body.payee_user_id).first<{ id: number; role: string }>();
      if (!pu) return err("invalid_input", "Payee must be an active staff account", 400);
      payeeId = pu.id;
      payeeRole = pu.role;
    }
    let res: { id: number } | null = null;
    try {
      res = await env.DB.prepare(
        `INSERT INTO claims (user_id, claim_date, category, amount_cents, description, items, payee_user_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) RETURNING id`,
      ).bind(user.id, claimDate, category, cents, purpose, itemsJson, payeeId).first<{ id: number }>();
    } catch (e) {
      if (!String(e).includes("no such column")) throw e;
      if (payeeId !== null) return err("migration_missing", "Run: npx wrangler d1 migrations apply azoneofficial --remote (0051_claim_payee)", 500);
      res = await env.DB.prepare(
        `INSERT INTO claims (user_id, claim_date, category, amount_cents, description, items)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6) RETURNING id`,
      ).bind(user.id, claimDate, category, cents, purpose, itemsJson).first<{ id: number }>();
    }
    // v1.4.106: tell the FIRST stage of this claimant's chain.
    await notifyClaimFirstStage(user.role, user.name, res?.id ?? 0, cents, "New claim", payeeRole);
    await audit(env, user.id, "claim.create", "claims", String(res?.id), { category, amount_cents: cents, ...(payeeId ? { payee_user_id: payeeId } : {}) });
    return json({ id: res?.id }, 201);
  }
  const clMatch = path.match(/^\/claims\/(\d+)(\/receipt|\/decide)?$/);
  if (clMatch && clMatch[2] === "/receipt" && method === "POST") {
    if (!can(user.role, "claims_submit")) return err("forbidden", "Claims access required", 403);
    const row = await env.DB.prepare(`SELECT user_id, status FROM claims WHERE id = ?1`).bind(clMatch[1]).first<{ user_id: number; status: string }>();
    if (!row) return err("not_found", "Claim not found", 404);
    if (row.user_id !== user.id) return err("forbidden", "Only the claimant attaches receipts", 403);
    if (!["pending", "rejected"].includes(row.status)) return err("invalid_state", "Approved claims are locked", 400);
    const ct = request.headers.get("content-type") ?? "image/jpeg";
    if (!["application/pdf", "image/jpeg", "image/png"].includes(ct)) return err("invalid_input", "Only PDF/JPEG/PNG receipts allowed", 400);
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
      let payeeRoleR: string | null = null;
      try {
        const prR = await env.DB.prepare(
          `SELECT py.role AS r FROM claims c LEFT JOIN users py ON py.id = c.payee_user_id WHERE c.id = ?1`,
        ).bind(clMatch[1]).first<{ r: string | null }>();
        payeeRoleR = prR?.r ?? null;
      } catch { /* pre-0051 */ }
      await notifyClaimFirstStage(user.role, user.name, clMatch[1]!, cRow?.amount_cents ?? 0, "Resubmitted with receipt", payeeRoleR);
      await audit(env, user.id, "claim.resubmit", "claims", clMatch[1]!, { via: "receipt_attach" });
      resubmittedR = true;
    }
    return json({ ok: true, resubmitted: resubmittedR });
  }
  if (clMatch && clMatch[2] === "/receipt" && method === "GET") {
    if (!can(user.role, "claims_submit")) return err("forbidden", "Claims access required", 403);
    const row = await env.DB.prepare(
      `SELECT c.user_id, c.status, c.receipt_key, u.role AS claimant_role
       FROM claims c LEFT JOIN users u ON u.id = c.user_id WHERE c.id = ?1`,
    ).bind(clMatch[1]).first<{ user_id: number; status: string; receipt_key: string | null; claimant_role: string | null }>();
    if (!row?.receipt_key) return err("not_found", "No receipt attached", 404);
    // v1.4.133: receipt visibility mirrors claim-list visibility — anyone who
    // can see the claim (chain reviewers included) can open its receipt.
    // Fixes the CCO's raw "Not your claim" 403 when opening a receipt link.
    const STAFF_CHAIN_ROLES = ["marketing", "sales_marketing", "editor", "live_host"];
    const canView =
      row.user_id === user.id ||
      can(user.role, "claims_decide") ||
      (user.role === "hr_admin" && (row.status === "approved" || STAFF_CHAIN_ROLES.includes(row.claimant_role ?? ""))) ||
      (["coo", "admin"].includes(user.role) && STAFF_CHAIN_ROLES.includes(row.claimant_role ?? "")) ||
      (user.role === "cco" && row.claimant_role === "hr_admin");
    if (!canView) return err("forbidden", "Not your claim", 403);
    const obj = await env.MEDIA.get(row.receipt_key);
    if (!obj) return err("not_found", "Receipt file missing", 404);
    return new Response(obj.body, { headers: { "Content-Type": obj.httpMetadata?.contentType ?? "application/octet-stream", "Cache-Control": "private, max-age=300" } });
  }
  if (clMatch && clMatch[2] === "/decide" && method === "POST") {
    // Per the CEO's instruction: EVERY claim decision is the CEO's.
    if (!can(user.role, "claims_decide")) return err("forbidden", "Only the CEO decides claims", 403);
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
    let conflictWaived: string | null = null;
    if (action === "approve") {
      const chainD = claimChain(row.claimant_role);
      /* v1.4.175: a stage whose approver IS the payee is WAIVED — the guard
         (v1.4.174) forbids them from acting, so their missing signature is
         the DESIGNED route to the CEO, not a bypass. Only genuinely skipped
         stages count as an override. Pre-0051 tolerant. */
      let payeeRoleD: string | null = null;
      try {
        const pr = await env.DB.prepare(
          `SELECT py.role AS r FROM claims c LEFT JOIN users py ON py.id = c.payee_user_id WHERE c.id = ?1`,
        ).bind(clMatch[1]).first<{ r: string | null }>();
        payeeRoleD = pr?.r ?? null;
      } catch { /* pre-0051 */ }
      const skipped: string[] = [];
      const waived: string[] = [];
      if (chainD === "staff") {
        if (!row.hr_reviewed_at) (payeeRoleD === "hr_admin" ? waived : skipped).push("HR review");
        if (!row.pre_approved_at) (payeeRoleD === "coo" ? waived : skipped).push("COO pre-approval");
      } else if (chainD === "hr" && !row.pre_approved_at) {
        (payeeRoleD === "cco" ? waived : skipped).push("CCO pre-approval");
      }
      if (skipped.length > 0) chainOverride = skipped.join(" + ");
      if (waived.length > 0) conflictWaived = waived.join(" + ");
    }
    const status = action === "approve" ? "approved" : "rejected";
    const noteBase = typeof body?.note === "string" && body.note ? body.note.slice(0, 400) : "";
    const parts = [noteBase];
    if (chainOverride) parts.push(`CEO direct approval (${chainOverride} bypassed)`);
    if (conflictWaived) parts.push(`${conflictWaived} waived — approver is the payee (conflict of interest)`);
    const noteFinal = parts.filter(Boolean).join(" · ") || null;
    await env.DB.prepare(
      `UPDATE claims SET status = ?1, decided_by = ?2, decided_at = datetime('now'), decision_note = ?3 WHERE id = ?4`,
    ).bind(status, user.id, noteFinal, clMatch[1]).run();
    await notify(env, row.user_id, "claim",
      `Your claim of RM ${(row.amount_cents / 100).toFixed(2)} was ${status}${typeof body?.note === "string" && body.note ? ` — ${body.note.slice(0, 200)}` : ""}`,
      `claim:${clMatch[1]}`);
    await audit(env, user.id, `claim.${action}`, "claims", clMatch[1],
      chainOverride || conflictWaived ? { ...(chainOverride ? { chain_override: chainOverride } : {}), ...(conflictWaived ? { conflict_waived: conflictWaived } : {}) } : undefined);
    return json({ ok: true });
  }

  /* ---- company expenses (v1.4.87): CEO + COO ---- */

  /* v1.4.278 — 💹 P&L by month ("powerful system for my sales track and
     also expenses"). Revenue comes from revenueByMonth() — the ONE revenue
     arithmetic; payroll uses the SAME net expression the M2E file uses
     (net_cents with the additive fallback — never a second formula);
     expenses by expense_date; claims = APPROVED, by claim_date. Every
     source armored; a month appears if ANY source has it. */
  /* v1.4.281 — 🧩 business lines: the two businesses (product / service)
     reported separately, from the SAME revenueLines() buckets that feed
     every total. Expandable: response is lines[] — a future line appears
     here automatically the day the helper buckets it. */
  if (path === "/revenue/lines" && method === "GET") {
    if (!can(user.role, "revenue_view")) return err("forbidden", "Revenue access required", 403);
    const buckets = await revenueLines(env);
    const LABELS: Record<string, string> = {
      product: "Product sales",
      service: "Service sales",
      invoices: "Invoices (run migration 0061 to split product/service)",
    };
    const lines = Object.entries(buckets)
      .map(([key, months]) => {
        const ms = Object.entries(months).sort(([a], [b]) => (a < b ? -1 : 1))
          .map(([month, cents]) => ({ month, cents }));
        return { key, label: LABELS[key] ?? key, total_cents: ms.reduce((a, x) => a + x.cents, 0), months: ms };
      })
      .filter((l) => l.total_cents > 0)
      .sort((a, b) => b.total_cents - a.total_cents);
    return json({ lines });
  }

  if (path === "/finance/pnl" && method === "GET") {
    if (!can(user.role, "expenses")) return err("forbidden", "Expenses access required", 403);
    const rev = await revenueByMonth(env);
    const exp: Record<string, number> = {}; const pay: Record<string, number> = {}; const clm: Record<string, number> = {};
    try {
      const { results } = await env.DB.prepare(
        `SELECT substr(expense_date, 1, 7) AS m, COALESCE(SUM(amount_cents), 0) AS cents FROM expenses GROUP BY m`,
      ).all<{ m: string; cents: number }>();
      for (const r of results) exp[r.m] = r.cents;
    } catch { /* pre-0032 */ }
    try {
      const { results } = await env.DB.prepare(
        `SELECT month AS m, COALESCE(SUM(COALESCE(net_cents,
                MAX(0, basic_cents + commission_cents + allowance_cents + COALESCE(ot_cents, 0) - deduction_cents))), 0) AS cents
         FROM payroll_entries GROUP BY month`,
      ).all<{ m: string; cents: number }>();
      for (const r of results) pay[r.m] = r.cents;
    } catch { /* pre-0017/0041 skew — try the plain additive form */
      try {
        const { results } = await env.DB.prepare(
          `SELECT month AS m, COALESCE(SUM(MAX(0, basic_cents + commission_cents + allowance_cents - deduction_cents)), 0) AS cents
           FROM payroll_entries GROUP BY month`,
        ).all<{ m: string; cents: number }>();
        for (const r of results) pay[r.m] = r.cents;
      } catch { /* pre-payroll */ }
    }
    try {
      const { results } = await env.DB.prepare(
        `SELECT substr(claim_date, 1, 7) AS m, COALESCE(SUM(amount_cents), 0) AS cents
         FROM claims WHERE status = 'approved' GROUP BY m`,
      ).all<{ m: string; cents: number }>();
      for (const r of results) clm[r.m] = r.cents;
    } catch { /* pre-claims */ }
    const monthsSet = new Set([...Object.keys(rev), ...Object.keys(exp), ...Object.keys(pay), ...Object.keys(clm)]);
    const months = [...monthsSet].sort().map((m) => {
      const revenue = rev[m] ?? 0, expenses = exp[m] ?? 0, payroll = pay[m] ?? 0, claims = clm[m] ?? 0;
      return { month: m, revenue_cents: revenue, expenses_cents: expenses, payroll_cents: payroll, claims_cents: claims,
               net_cents: revenue - expenses - payroll - claims };
    });
    return json({ months });
  }

  /* v1.5.0: /prospects/insights removed with the Social tab. */

  if (path === "/expenses" && method === "GET") {
    if (!can(user.role, "expenses")) return err("forbidden", "Expenses access required", 403);
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
      // v1.4.124: SAME scope as the Payroll tab — active staff, no customer /
      // super_admin, lifecycle window applied. Entries outside this scope
      // (test users, resigned staff, disabled accounts) were inflating the
      // Expenses figure vs the panel total.
      const mStart = `${prevM}-01`, mEnd = `${prevM}-31`;
      const { results: pes } = await env.DB.prepare(
        `SELECT p.user_id, p.basic_cents, p.commission_cents, p.allowance_cents,
                COALESCE(p.ot_cents, 0) AS ot_cents, p.deduction_cents, p.net_cents,
                p.worked_days, p.month_working_days, u.base_salary_cents, u.name AS uname
         FROM payroll_entries p JOIN users u ON u.id = p.user_id
         WHERE p.month = ?1 AND u.is_active = 1
           AND u.role NOT IN ('customer', 'super_admin')
           AND NOT (u.left_on IS NOT NULL AND u.left_on < ?2
                    AND (u.rejoined_on IS NULL OR u.rejoined_on > ?3))`,
      ).bind(prevM, mStart, mEnd).all<{ user_id: number; basic_cents: number; commission_cents: number; allowance_cents: number; ot_cents: number; deduction_cents: number; net_cents: number | null; worked_days: number | null; month_working_days: number | null; base_salary_cents: number }>();
      const { results: uls } = await env.DB.prepare(
        `SELECT user_id, COALESCE(SUM(days), 0) AS days FROM leave_requests
         WHERE type = 'unpaid' AND status = 'approved' AND start_date LIKE ?1 || '%' GROUP BY user_id`,
      ).bind(prevM).all<{ user_id: number; days: number }>();
      const ulMap = new Map(uls.map((r) => [r.user_id, r.days]));
      let sum = 0;
      // v1.4.126: per-person breakdown in the response — a mismatch with the
      // Payroll tab now NAMES the row causing it (stale save or ghost entry).
      const rowsOut: { name: string; cents: number; saved_net: boolean }[] = [];
      for (const e of pes) {
        // v1.4.124: the net the panel SAVED is authoritative; the formula
        // below only covers rows saved before net_cents existed.
        if (e.net_cents !== null && e.net_cents !== undefined) {
          sum += e.net_cents;
          rowsOut.push({ name: (e as unknown as { uname: string }).uname, cents: e.net_cents, saved_net: true });
          continue;
        }
        const ul = ulMap.get(e.user_id) ?? 0;
        const ulDed = ul > 0 ? Math.round(((e.base_salary_cents || e.basic_cents) / 26) * ul) : 0;
        let adj = 0;
        if (e.worked_days !== null && e.worked_days !== undefined && e.month_working_days && e.month_working_days > 0) {
          const adjustable = Math.max(0, Math.max(0, e.month_working_days - e.worked_days) - ul);
          adj = Math.round((e.basic_cents * adjustable) / e.month_working_days);
        }
        const rowNet = Math.max(0, e.basic_cents + e.commission_cents + e.allowance_cents + e.ot_cents - e.deduction_cents - ulDed - adj);
        sum += rowNet;
        rowsOut.push({ name: (e as unknown as { uname: string }).uname, cents: rowNet, saved_net: false });
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
      staffPayroll = { month: prevM, cents: sum, paid_at: paidAtP, entries: rowsOut } as { month: string; cents: number; paid_at?: string | null };
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
    ).bind(mE).all()); // v1.5.0 fix: was `month` (undefined here) — every Expenses load 500'd
    ({ results: claimsPaid } = await env.DB.prepare(
      `SELECT c.id, c.amount_cents, c.paid_at, u.name AS claimant FROM claims c
       LEFT JOIN users u ON u.id = c.user_id
       WHERE c.paid_at IS NOT NULL AND strftime('%Y-%m', c.paid_at) = ?1
       ORDER BY c.paid_at DESC`,
    ).bind(mE).all()); // v1.5.0 fix: was `month` (undefined here)
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
    if (!can(user.role, "expenses")) return err("forbidden", "Expenses access required", 403);
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
    // v1.4.208 (CEO wants paid/outstanding tracking): now a TOGGLE — body
    // { paid: false } clears the mark so a misclick is one click to undo.
    if (!can(user.role, "expenses")) return err("forbidden", "Expenses access required", 403);
    const unpay = body?.paid === false;
    await env.DB.prepare(
      unpay
        ? `UPDATE expenses SET paid_at = NULL WHERE id = ?1`
        : `UPDATE expenses SET paid_at = datetime('now') WHERE id = ?1`,
    ).bind(exPaid[1]).run();
    if (!unpay) {
      // v1.19.0 C2: the paid expense becomes a bank movement, once.
      const exRow = await env.DB.prepare(`SELECT amount_cents, category, vendor, description FROM expenses WHERE id = ?1`)
        .bind(exPaid[1]).first<{ amount_cents: number; category: string; vendor: string | null; description: string | null }>();
      if (exRow) {
        await recordBankMovement(env, user.id, `EXP-${exPaid[1]}`, exRow.amount_cents,
          exRow.category, [exRow.vendor, exRow.description].filter(Boolean).join(" — ") || "Expense payment");
      }
    }
    await audit(env, user.id, "expense.paid", "expenses", exPaid[1], { paid: !unpay });
    return json({ ok: true });
  }
  if (path === "/expenses" && method === "POST") {
    if (!can(user.role, "expenses")) return err("forbidden", "Expenses access required", 403);
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
    if (!can(user.role, "expenses")) return err("forbidden", "Expenses access required", 403);
    await env.DB.prepare(`DELETE FROM expenses WHERE id = ?1`).bind(exMatch[1]).run();
    await audit(env, user.id, "expense.delete", "expenses", exMatch[1]);
    return json({ ok: true });
  }

  /* ---- sales revenue (v1.4.75): dashboard figures, TikTok included ---- */

  /* v1.19.0 (consolidation C1): the duplicate GET /pnl endpoint is gone.
     It served only the Overview tab's private PnlCard copy — /finance/pnl is
     the single P&L and the only one any surviving UI calls. */
  if (path === "/revenue" && method === "GET") {
    if (!can(user.role, "revenue_view")) return err("forbidden", "Revenue access required", 403);
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
    // v1.4.169 (CEO: "invoice also need to count it beside of TikTok or any
    // Postage tracking — non-TikTok orders… everything count correctly"):
    // two more channels join the totals — non-TikTok shipments (their order
    // amount, from the new form field) and manual sales (an Out − with a
    // sold price). Tolerant of migration 0048 not being applied yet.
    const otherPostage = (m: string) => env.DB.prepare(
      `SELECT COALESCE(SUM(order_amount_cents), 0) AS cents,
              SUM(CASE WHEN order_amount_cents IS NOT NULL THEN 1 ELSE 0 END) AS orders
       FROM postage_records
       WHERE order_ref NOT LIKE 'TT-%' AND status != 'returned'
         AND strftime('%Y-%m', created_at, '+8 hours') = ?1`,
    ).bind(m).first<{ cents: number; orders: number }>();
    const manualSales = async (m: string) => {
      // v1.4.172: attribute by the backdatable out_date when present.
      try {
        return await env.DB.prepare(
          `SELECT COALESCE(SUM(total_cents), 0) AS cents, COALESCE(SUM(qty), 0) AS units
           FROM manual_sales
           WHERE (CASE WHEN out_date IS NOT NULL THEN substr(out_date, 1, 7)
                       ELSE strftime('%Y-%m', created_at, '+8 hours') END) = ?1`,
        ).bind(m).first<{ cents: number; units: number }>();
      } catch {
        try {
          return await env.DB.prepare(
            `SELECT COALESCE(SUM(total_cents), 0) AS cents, COALESCE(SUM(qty), 0) AS units
             FROM manual_sales WHERE strftime('%Y-%m', created_at, '+8 hours') = ?1`,
          ).bind(m).first<{ cents: number; units: number }>();
        } catch { return { cents: 0, units: 0 }; }
      }
    };
    const targetOf = (m: string) => env.DB.prepare(
      `SELECT target_cents FROM sales_targets WHERE month = ?1`,
    ).bind(m).first<{ target_cents: number }>();
    // v1.4.95: targets are per-month rows, so each new month RESETS by
    // construction; last month's KPI result stays on the card for the team,
    // and next month's target can be set before month-end.
    const nextMonth = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 1)).toISOString().slice(0, 7);
    // v1.4.156 (CEO: "show today sales to motivate my Sales team") — same
    // bases as the monthly figures, scoped to today in Malaysia time.
    const todayMYT = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
    // v1.4.206 (CEO: trend arrow vs yesterday): same four channel bases,
    // scoped to yesterday MYT, summed into one comparable number.
    const yesterdayMYT = new Date(Date.now() + 8 * 3600 * 1000 - 24 * 3600 * 1000).toISOString().slice(0, 10);
    const tiktokDay = (d: string) => env.DB.prepare(
      `SELECT COALESCE(SUM(order_amount_cents), 0) AS cents, COUNT(*) AS orders
       FROM postage_records
       WHERE order_ref LIKE 'TT-%' AND status != 'returned'
         AND date(created_at, '+8 hours') = ?1`,
    ).bind(d).first<{ cents: number; orders: number }>();
    const invoicedDay = (d: string) => env.DB.prepare(
      `SELECT COALESCE(SUM(total_cents), 0) AS cents, COUNT(*) AS docs
       FROM sales_documents WHERE doc_type = 'INV' AND payment_status = 'paid'
         AND date(COALESCE(paid_at, created_at), '+8 hours') = ?1`,
    ).bind(d).first<{ cents: number; docs: number }>();
    const otherDay = (d: string) => env.DB.prepare(
      `SELECT COALESCE(SUM(order_amount_cents), 0) AS cents
       FROM postage_records
       WHERE order_ref NOT LIKE 'TT-%' AND status != 'returned'
         AND date(created_at, '+8 hours') = ?1`,
    ).bind(d).first<{ cents: number }>();
    const manualDay = async (d: string) => {
      try {
        return await env.DB.prepare(
          `SELECT COALESCE(SUM(total_cents), 0) AS cents FROM manual_sales
           WHERE (CASE WHEN out_date IS NOT NULL THEN out_date
                       ELSE date(created_at, '+8 hours') END) = ?1`,
        ).bind(d).first<{ cents: number }>();
      } catch {
        try {
          return await env.DB.prepare(
            `SELECT COALESCE(SUM(total_cents), 0) AS cents FROM manual_sales
             WHERE date(created_at, '+8 hours') = ?1`,
          ).bind(d).first<{ cents: number }>();
        } catch { return { cents: 0 }; }
      }
    };
    const overallByMonth = () => revenueByMonth(env); // v1.4.278: shared module helper (was local in 276)
    const [tThis, tLast, iThis, iLast, out, tgt, tgtLast, tgtNext, tToday, iToday, oThis, oLast, mThis, mLast, oToday, mToday, tYest, iYest, oYest, mYest] = await Promise.all([
      tiktok(month), tiktok(lastMonth), invoiced(month), invoiced(lastMonth), outstanding,
      targetOf(month), targetOf(lastMonth), targetOf(nextMonth), tiktokDay(todayMYT), invoicedDay(todayMYT),
      otherPostage(month), otherPostage(lastMonth), manualSales(month), manualSales(lastMonth), otherDay(todayMYT), manualDay(todayMYT),
      tiktokDay(yesterdayMYT), invoicedDay(yesterdayMYT), otherDay(yesterdayMYT), manualDay(yesterdayMYT),
    ]);
    const byMonth = await overallByMonth(); // v1.4.276
    const overallMonths = Object.entries(byMonth).sort((a, b) => (a[0] < b[0] ? -1 : 1));
    const overallTotal = overallMonths.reduce((a, [, c]) => a + c, 0);
    const best = overallMonths.reduce<{ month: string; cents: number } | null>(
      (b, [m, c]) => (b && b.cents >= c ? b : { month: m, cents: c }), null);
    return json({
      month, last_month: lastMonth, next_month: nextMonth,
      today: {
        date: todayMYT,
        tiktok_cents: tToday?.cents ?? 0, tiktok_orders: tToday?.orders ?? 0,
        invoiced_cents: iToday?.cents ?? 0, invoiced_docs: iToday?.docs ?? 0,
        other_cents: oToday?.cents ?? 0, manual_cents: mToday?.cents ?? 0, // v1.4.169
      },
      yesterday: { // v1.4.206: one comparable all-channel number for the trend arrow
        date: yesterdayMYT,
        total_cents: (tYest?.cents ?? 0) + (iYest?.cents ?? 0) + (oYest?.cents ?? 0) + (mYest?.cents ?? 0),
      },
      tiktok: { this_cents: tThis?.cents ?? 0, this_orders: tThis?.orders ?? 0, last_cents: tLast?.cents ?? 0, last_orders: tLast?.orders ?? 0 },
      invoiced: { this_cents: iThis?.cents ?? 0, this_docs: iThis?.docs ?? 0, last_cents: iLast?.cents ?? 0, last_docs: iLast?.docs ?? 0 },
      outstanding: { cents: out?.cents ?? 0, docs: out?.docs ?? 0 },
      other: { this_cents: oThis?.cents ?? 0, this_orders: oThis?.orders ?? 0, last_cents: oLast?.cents ?? 0, last_orders: oLast?.orders ?? 0 }, // v1.4.169
      manual: { this_cents: mThis?.cents ?? 0, this_units: mThis?.units ?? 0, last_cents: mLast?.cents ?? 0, last_units: mLast?.units ?? 0 }, // v1.4.169
      overall: { // v1.4.276: all-time, all four channels, by MYT month
        total_cents: overallTotal,
        months: overallMonths.map(([m, c]) => ({ month: m, cents: c })),
        best: best ?? undefined,
      },
      target_cents: tgt?.target_cents ?? null,
      last_target_cents: tgtLast?.target_cents ?? null,
      next_target_cents: tgtNext?.target_cents ?? null,
    });
  }

  /* ================= v1.4.212 EXTENSIONS (approved architecture review) =================
     Two additive routes for the new Sales-tab cards. Nothing above or
     below altered; same guards as /revenue (revenue_view). */

  if (path === "/sales/by-hour" && method === "GET") {
    // Hourly MYT sales histogram over the last 7 days — for choosing LIVE
    // hours. Bases mirror /revenue: postage_records with an order amount
    // (TikTok TT- + other shipments, returned excluded) + manual sales.
    if (!can(user.role, "revenue_view")) return err("forbidden", "Revenue access required", 403);
    const sinceBH = new Date(Date.now() + 8 * 3600 * 1000 - 7 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const post = await env.DB.prepare(
      `SELECT CAST(strftime('%H', created_at, '+8 hours') AS INTEGER) AS h,
              COALESCE(SUM(order_amount_cents), 0) AS cents, COUNT(*) AS orders
       FROM postage_records
       WHERE order_amount_cents IS NOT NULL AND status != 'returned'
         AND date(created_at, '+8 hours') >= ?1
       GROUP BY h`,
    ).bind(sinceBH).all<{ h: number; cents: number; orders: number }>();
    const man = await env.DB.prepare(
      `SELECT CAST(strftime('%H', created_at, '+8 hours') AS INTEGER) AS h,
              COALESCE(SUM(total_cents), 0) AS cents, COUNT(*) AS orders
       FROM manual_sales
       WHERE date(created_at, '+8 hours') >= ?1
       GROUP BY h`,
    ).bind(sinceBH).all<{ h: number; cents: number; orders: number }>();
    const buckets = Array.from({ length: 24 }, (_, h) => ({ hour: h, cents: 0, orders: 0 }));
    for (const r of [...(post.results ?? []), ...(man.results ?? [])]) {
      const b = buckets[r.h]; if (b) { b.cents += r.cents; b.orders += r.orders; }
    }
    return json({ since: sinceBH, days: 7, buckets });
  }

  if (path === "/fulfilment/summary" && method === "GET") {
    // Orders by fulfilment status this month (MYT) + the oldest order still
    // preparing — postage_records.status: preparing | shipped | in_transit
    // | delivered | returned (schema since 0007).
    if (!can(user.role, "revenue_view")) return err("forbidden", "Revenue access required", 403);
    const monthFS = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 7);
    const { results: byStatus } = await env.DB.prepare(
      `SELECT status, COUNT(*) AS n FROM postage_records
       WHERE strftime('%Y-%m', created_at, '+8 hours') = ?1
       GROUP BY status`,
    ).bind(monthFS).all<{ status: string; n: number }>();
    const oldest = await env.DB.prepare(
      `SELECT order_ref, created_at FROM postage_records
       WHERE status = 'preparing'
       ORDER BY created_at ASC LIMIT 1`,
    ).first<{ order_ref: string; created_at: string }>();
    const oldestDays = oldest
      ? Math.floor((Date.now() - Date.parse(oldest.created_at + "Z")) / (24 * 3600 * 1000))
      : null;
    /* v1.4.222 (CEO: "clickable card which will appear the data of the
       fulfillment"): additive ?status= drills into one status — the
       month's orders behind that chip, newest first. */
    const drill = new URL(request.url).searchParams.get("status"); // v1.5.0 fix: `url` was undefined here — drill-down clicks 500'd
    let orders: unknown[] | undefined;
    if (drill && ["preparing", "shipped", "in_transit", "delivered", "returned"].includes(drill)) {
      const { results } = await env.DB.prepare(
        `SELECT order_ref, status, courier, tracking_no, buyer_city, order_amount_cents, created_at
         FROM postage_records
         WHERE status = ?1 AND strftime('%Y-%m', created_at, '+8 hours') = ?2
         ORDER BY created_at DESC LIMIT 200`,
      ).bind(drill, monthFS).all();
      orders = results ?? [];
    }
    return json({
      month: monthFS,
      by_status: Object.fromEntries((byStatus ?? []).map((r) => [r.status, r.n])),
      oldest_preparing: oldest ? { order_ref: oldest.order_ref, days: oldestDays } : null,
      ...(orders !== undefined ? { status: drill, orders } : {}),
    });
  }

  /* ================= v1.4.213: company asset register =================
     Team feedback via the CEO. View = the Staff-Details tier; edits =
     the same tier (HR keeps the register). Assets are never deleted —
     status moves to lost/disposed so history and audit survive. */

  if (path === "/assets" && method === "GET") {
    if (!can(user.role, "hr_manage") && !can(user.role, "exec_view")) return err("forbidden", "HR access required", 403);
    const { results } = await env.DB.prepare(
      `SELECT a.*, u.name AS assigned_name FROM assets a
       LEFT JOIN users u ON u.id = a.assigned_to
       ORDER BY a.status = 'disposed', a.status = 'lost', a.asset_tag`,
    ).all();
    return json({ assets: results ?? [] });
  }

  if (path === "/assets" && method === "POST") {
    if (!can(user.role, "hr_manage")) return err("forbidden", "HR access required", 403);
    const nameA = str(body?.name, 120) ? (body!.name as string).trim() : null;
    if (!nameA) return err("invalid_input", "Asset name is required", 400);
    const CATS = ["electronics", "furniture", "vehicle", "studio", "other"];
    const cat = CATS.includes(String(body?.category)) ? String(body!.category) : "other";
    let tag = str(body?.asset_tag, 30) ? (body!.asset_tag as string).trim().toUpperCase() : "";
    if (!tag) {
      // auto tag AZOA-001, 002 … from the highest existing number
      const maxRow = await env.DB.prepare(
        `SELECT asset_tag FROM assets WHERE asset_tag LIKE 'AZOA-%' ORDER BY LENGTH(asset_tag) DESC, asset_tag DESC LIMIT 1`,
      ).first<{ asset_tag: string }>();
      const n = maxRow ? parseInt(maxRow.asset_tag.slice(5), 10) + 1 : 1;
      tag = `AZOA-${String(Number.isFinite(n) ? n : 1).padStart(3, "0")}`;
    }
    const priceC = body?.purchase_price != null && String(body.purchase_price).trim() !== ""
      ? Math.round(Number(body.purchase_price) * 100) : null;
    if (priceC !== null && (!Number.isFinite(priceC) || priceC < 0)) return err("invalid_input", "purchase_price must be a number", 400);
    const asgn = body?.assigned_to != null && String(body.assigned_to) !== "" ? Number(body.assigned_to) : null;
    try {
      const r = await env.DB.prepare(
        `INSERT INTO assets (asset_tag, name, category, brand_model, serial_no, purchase_date, purchase_price_cents, vendor, warranty_until, location, assigned_to, status, condition_note, created_by)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)`,
      ).bind(
        tag, nameA, cat,
        str(body?.brand_model, 120) ? (body!.brand_model as string).trim() : null,
        str(body?.serial_no, 120) ? (body!.serial_no as string).trim() : null,
        str(body?.purchase_date, 10) ? (body!.purchase_date as string) : null,
        priceC,
        str(body?.vendor, 120) ? (body!.vendor as string).trim() : null,
        str(body?.warranty_until, 10) ? (body!.warranty_until as string) : null,
        str(body?.location, 120) ? (body!.location as string).trim() : null,
        asgn,
        ["in_use", "spare", "repair", "lost", "disposed"].includes(String(body?.status)) ? String(body!.status) : "in_use",
        str(body?.condition_note, 300) ? (body!.condition_note as string).trim() : null,
        user.id,
      ).run();
      await audit(env, user.id, "asset.create", "assets", String(r.meta.last_row_id), { tag });
      return json({ ok: true, id: r.meta.last_row_id, asset_tag: tag });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("UNIQUE")) return err("invalid_input", `Asset tag ${tag} already exists`, 400);
      throw e;
    }
  }

  /* v1.4.226 (CEO: "add commission which is 1.5% for me to pay"): the
     month's all-channel sales as a commission base — SAME four bases as
     /revenue (TikTok TT- order amounts excl. returned; payments received
     in-month; other shipments; manual sales), self-contained here because
     /revenue's helpers are scoped inside that route. */
  if (path === "/payroll/commission-base" && method === "GET") {
    // v1.5.0 fix: PAYROLL_PROC was referenced before its declaration and
    // `url` was undefined — the commission card 500'd on every open.
    const PAYROLL_PROC_CB = ["super_admin", "admin", "ceo", "coo"];
    if (!PAYROLL_PROC_CB.includes(user.role)) return err("forbidden", "Payroll access required", 403);
    const mCB = new URL(request.url).searchParams.get("month") ?? new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(mCB)) return err("invalid_input", "month must be YYYY-MM", 400);
    // Queries mirror /revenue verbatim (v1.4.169/172 bases).
    const tt = await env.DB.prepare(
      `SELECT COALESCE(SUM(order_amount_cents), 0) AS cents FROM postage_records
       WHERE order_ref LIKE 'TT-%' AND status != 'returned'
         AND strftime('%Y-%m', created_at, '+8 hours') = ?1`,
    ).bind(mCB).first<{ cents: number }>();
    const inv = await env.DB.prepare(
      `SELECT COALESCE(SUM(total_cents), 0) AS cents
       FROM sales_documents WHERE doc_type = 'INV' AND payment_status = 'paid'
         AND strftime('%Y-%m', COALESCE(paid_at, created_at), '+8 hours') = ?1`,
    ).bind(mCB).first<{ cents: number }>();
    const oth = await env.DB.prepare(
      `SELECT COALESCE(SUM(order_amount_cents), 0) AS cents FROM postage_records
       WHERE order_ref NOT LIKE 'TT-%' AND status != 'returned'
         AND strftime('%Y-%m', created_at, '+8 hours') = ?1`,
    ).bind(mCB).first<{ cents: number }>();
    let man: { cents: number } | null = null;
    try {
      man = await env.DB.prepare(
        `SELECT COALESCE(SUM(total_cents), 0) AS cents FROM manual_sales
         WHERE (CASE WHEN out_date IS NOT NULL THEN substr(out_date, 1, 7)
                     ELSE strftime('%Y-%m', created_at, '+8 hours') END) = ?1`,
      ).bind(mCB).first<{ cents: number }>();
    } catch {
      try {
        man = await env.DB.prepare(
          `SELECT COALESCE(SUM(total_cents), 0) AS cents FROM manual_sales
           WHERE strftime('%Y-%m', created_at, '+8 hours') = ?1`,
        ).bind(mCB).first<{ cents: number }>();
      } catch { man = { cents: 0 }; }
    }
    const total = (tt?.cents ?? 0) + (inv?.cents ?? 0) + (oth?.cents ?? 0) + (man?.cents ?? 0);
    return json({
      month: mCB,
      total_cents: total,
      breakdown: { tiktok_cents: tt?.cents ?? 0, invoiced_cents: inv?.cents ?? 0, other_cents: oth?.cents ?? 0, manual_cents: man?.cents ?? 0 },
    });
  }

  /* ================= v1.4.219: CEO tab access control =================
     One system_meta row (key tab_access) holds { [tab]: role[] } overrides.
     Absent tab = built-in default. Safety rails: Dashboard + Profile are
     not configurable (clock-in and payslips must never disappear), and
     super_admin ignores overrides entirely — the escape hatch if an
     assignment locks everyone (even the CEO) out of a tab. */
  /* v1.21.4 — resynced with ALL_TABS (page.tsx). The old list still allowed
     Overview/Pipeline/Expenses/Birthdays (retired or folded) and REFUSED
     Finance and the five ERP tabs, so the CEO could not override the tabs
     the portal actually shows. Stale override keys in system_meta are
     harmless — the client only reads keys for tabs it knows. */
  const TAB_ACCESS_TABS = ["Announcements", "HR", "Staff Details", "Attendance", "Leave", "Tasks", "Content", "Claims", "Payroll", "Finance", "Sales", "Reconciliation", "Commission", "Ads Fund", "Purchasing", "Accounting", "Inventory", "Stokis", "Ecommerce", "Assets", "Users"];
  const TAB_ACCESS_ROLES = ["admin", "ceo", "coo", "cco", "hr_admin", "sales_marketing", "marketing", "editor", "live_host"];

  if (path === "/tabs/access" && method === "GET") {
    // Every staff member needs this to compute their own tab strip.
    const row = await env.DB.prepare(`SELECT value FROM system_meta WHERE key = 'tab_access'`).first<{ value: string }>();
    let overrides: Record<string, string[]> = {};
    try { overrides = row?.value ? (JSON.parse(row.value) as Record<string, string[]>) : {}; } catch { overrides = {}; }
    return json({ overrides });
  }

  if (path === "/tabs/access" && method === "POST") {
    if (user.role !== "ceo" && user.role !== "super_admin") return err("forbidden", "Only the CEO manages tab access", 403);
    const tabName = typeof body?.tab === "string" ? body.tab : "";
    if (!TAB_ACCESS_TABS.includes(tabName)) return err("invalid_input", `tab must be one of: ${TAB_ACCESS_TABS.join(", ")}`, 400);
    const row = await env.DB.prepare(`SELECT value FROM system_meta WHERE key = 'tab_access'`).first<{ value: string }>();
    let overrides: Record<string, string[]> = {};
    try { overrides = row?.value ? (JSON.parse(row.value) as Record<string, string[]>) : {}; } catch { overrides = {}; }
    if (body?.reset === true || body?.roles == null) {
      delete overrides[tabName]; // back to the built-in default
    } else {
      if (!Array.isArray(body.roles)) return err("invalid_input", "roles must be an array", 400);
      const roles = (body.roles as unknown[]).map(String).filter((r) => TAB_ACCESS_ROLES.includes(r));
      overrides[tabName] = roles; // empty array = admin tier only (super_admin bypass)
    }
    await env.DB.prepare(
      `INSERT INTO system_meta (key, value) VALUES ('tab_access', ?1) ON CONFLICT(key) DO UPDATE SET value = ?1`,
    ).bind(JSON.stringify(overrides)).run();
    await audit(env, user.id, "tabs.access_change", "system_meta", "tab_access", { tab: tabName, roles: overrides[tabName] ?? "default" });
    return json({ ok: true, overrides });
  }

  const assetPatch = path.match(/^\/assets\/(\d+)$/);
  if (assetPatch && method === "PATCH") {
    if (!can(user.role, "hr_manage")) return err("forbidden", "HR access required", 403);
    const idA = assetPatch[1]!;
    const sets: string[] = []; const vals: (string | number | null)[] = [];
    const put = (col: string, v: string | number | null) => { sets.push(`${col} = ?${sets.length + 1}`); vals.push(v); };
    for (const f of ["name", "brand_model", "serial_no", "purchase_date", "vendor", "warranty_until", "location", "condition_note"] as const) {
      if (typeof body?.[f] === "string") put(f, (body[f] as string).trim() || null);
    }
    if (typeof body?.category === "string" && ["electronics", "furniture", "vehicle", "studio", "other"].includes(body.category)) put("category", body.category);
    if (typeof body?.status === "string" && ["in_use", "spare", "repair", "lost", "disposed"].includes(body.status)) put("status", body.status);
    if (body && "assigned_to" in body) put("assigned_to", body.assigned_to != null && String(body.assigned_to) !== "" ? Number(body.assigned_to) : null);
    if (body && "purchase_price" in body) {
      const pc = String(body.purchase_price ?? "").trim() === "" ? null : Math.round(Number(body.purchase_price) * 100);
      if (pc !== null && !Number.isFinite(pc)) return err("invalid_input", "purchase_price must be a number", 400);
      put("purchase_price_cents", pc);
    }
    if (sets.length === 0) return err("invalid_input", "Nothing to update", 400);
    put("updated_at", new Date().toISOString().slice(0, 19).replace("T", " "));
    vals.push(idA);
    await env.DB.prepare(`UPDATE assets SET ${sets.join(", ")} WHERE id = ?${vals.length}`).bind(...vals).run();
    await audit(env, user.id, "asset.update", "assets", idA, body as Record<string, unknown>);
    return json({ ok: true });
  }
  if (path === "/revenue/target" && method === "POST") {
    // v1.4.90 / v1.6.1: monthly sales KPI target — set on the Dashboard by
    // the super admin, CEO or COO only (the CEO's explicit list).
    if (!["super_admin", "ceo", "coo"].includes(user.role)) {
      return err("forbidden", "Only the super admin, CEO or COO set the sales KPI target", 403);
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
    const all = url.searchParams.get("all") === "1" && can(user.role, "team_manage");
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
    if (assignedTo !== user.id && !can(user.role, "team_manage")) {
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
    if (row.assigned_to !== user.id && !can(user.role, "team_manage")) {
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

  /* v1.4.191 CLIENT LAYER (CEO gap list): per-client view for an agency —
     the customers registry IS the client list; this summary joins invoiced /
     paid totals from sales docs and scheduled live sessions per client. */
  if (path === "/clients/summary" && method === "GET") {
    if (!can(user.role, "revenue_view")) return err("forbidden", "Sales access required", 403);
    const { results } = await env.DB.prepare(
      `SELECT c.id, c.company, c.name, c.phone, c.email,
              (SELECT COUNT(*) FROM sales_documents d WHERE d.customer_id = c.id AND d.doc_type = 'INV') AS invoices,
              (SELECT COALESCE(SUM(d.total_cents), 0) FROM sales_documents d WHERE d.customer_id = c.id AND d.doc_type = 'INV') AS invoiced_cents,
              (SELECT COALESCE(SUM(d.total_cents), 0) FROM sales_documents d WHERE d.customer_id = c.id AND d.doc_type = 'INV' AND d.payment_status = 'paid') AS paid_cents,
              (SELECT COUNT(*) FROM sales_documents d WHERE d.customer_id = c.id AND d.doc_type = 'QT') AS quotations
       FROM customers c
       WHERE c.company != 'Walk-in Customer'
       ORDER BY invoiced_cents DESC, c.company LIMIT 200`,
    ).all();
    // live-session counts ride along when 0056 is applied
    let sessions: Record<string, number> = {};
    try {
      const { results: sess } = await env.DB.prepare(
        `SELECT client_id, COUNT(*) AS n FROM live_sessions WHERE client_id IS NOT NULL AND status != 'cancelled' GROUP BY client_id`,
      ).all<{ client_id: number; n: number }>();
      sessions = Object.fromEntries(sess.map((r) => [String(r.client_id), r.n]));
    } catch { /* pre-0056 */ }
    return json({ clients: results, sessions });
  }

  /* ============ v1.4.273 — THE GROWTH PACK (CEO: "all!") ============ */

  // Idea 1: the client report link. One tokened, public, read-only monthly
  // page per client — same share-link idea as sales documents. POST is
  // idempotent: returns the existing token if one exists.
  {
    const mRL = path.match(/^\/clients\/(\d+)\/report-link$/);
    if (mRL && method === "POST") {
      if (!can(user.role, "revenue_view")) return err("forbidden", "Sales access required", 403);
      const cid = Number(mRL[1]);
      const c = await env.DB.prepare(`SELECT company FROM customers WHERE id = ?1`).bind(cid).first<{ company: string }>();
      if (!c) return err("not_found", "Client not found", 404);
      try {
        const ex = await env.DB.prepare(`SELECT token FROM client_report_links WHERE customer_id = ?1`)
          .bind(cid).first<{ token: string }>();
        if (ex) return json({ ok: true, token: ex.token });
        const token = crypto.randomUUID().replace(/-/g, "");
        await env.DB.prepare(`INSERT INTO client_report_links (customer_id, token) VALUES (?1, ?2)`)
          .bind(cid, token).run();
        await audit(env, user.id, "client.report_link", "customers", String(cid), { company: c.company });
        return json({ ok: true, token }, 201);
      } catch (e) {
        if (String(e).includes("no such table")) return err("migration_missing", "Run migration 0067 (growth pack) first", 409);
        throw e;
      }
    }
  }

  // Idea 6: live-hour economics — RM per live hour, per client and per host,
  // current MYT month. The one number a live agency runs on. Each half is
  // armored separately so a pending migration can't blank the card.
  if (path === "/clients/live-economics" && method === "GET") {
    if (!can(user.role, "revenue_view")) return err("forbidden", "Sales access required", 403);
    const monthMY = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 7);
    let clients: unknown[] = []; let hosts: unknown[] = [];
    try {
      // Per client: completed session hours this month + PAID invoice RM this
      // month (mirrors /revenue's payment-received basis).
      const { results } = await env.DB.prepare(
        `SELECT c.id, c.company,
                (SELECT COALESCE(SUM(CASE WHEN s.end_time IS NOT NULL
                        THEN (CAST(substr(s.end_time,1,2) AS INTEGER)*60 + CAST(substr(s.end_time,4,2) AS INTEGER))
                           - (CAST(substr(s.start_time,1,2) AS INTEGER)*60 + CAST(substr(s.start_time,4,2) AS INTEGER))
                        ELSE 0 END), 0)
                 FROM live_sessions s WHERE s.client_id = c.id AND s.status != 'cancelled'
                   AND substr(s.session_date, 1, 7) = ?1) AS minutes,
                (SELECT COALESCE(SUM(d.total_cents), 0) FROM sales_documents d
                 WHERE d.customer_id = c.id AND d.doc_type = 'INV' AND d.payment_status = 'paid'
                   AND substr(COALESCE(d.paid_at, d.created_at), 1, 7) = ?1) AS paid_cents
         FROM customers c WHERE c.company != 'Walk-in Customer'
         ORDER BY paid_cents DESC LIMIT 50`,
      ).bind(monthMY).all();
      clients = results.filter((r) => Number((r as { minutes: number }).minutes) > 0 || Number((r as { paid_cents: number }).paid_cents) > 0);
    } catch { /* pre-0056/0060 — card shows what it can */ }
    try {
      // Per host: session hours this month + TikTok GMV landing inside their
      // session windows (the /gmv attribution pattern; motivation, not payroll).
      const { results } = await env.DB.prepare(
        `SELECT u.id, COALESCE(NULLIF(TRIM(u.full_name), ''), u.name) AS name,
                COALESCE(SUM(CASE WHEN s.end_time IS NOT NULL
                    THEN (CAST(substr(s.end_time,1,2) AS INTEGER)*60 + CAST(substr(s.end_time,4,2) AS INTEGER))
                       - (CAST(substr(s.start_time,1,2) AS INTEGER)*60 + CAST(substr(s.start_time,4,2) AS INTEGER))
                    ELSE 0 END), 0) AS minutes,
                (SELECT COALESCE(SUM(p.order_amount_cents), 0) FROM postage_records p
                 WHERE p.tracking_ref LIKE 'TT-%' AND COALESCE(p.status, '') != 'returned'
                   AND EXISTS (SELECT 1 FROM live_sessions s2
                        WHERE s2.host_user_id = u.id AND s2.status != 'cancelled' AND s2.end_time IS NOT NULL
                          AND substr(s2.session_date, 1, 7) = ?1
                          AND substr(datetime(p.created_at, '+8 hours'), 1, 10) = s2.session_date
                          AND substr(datetime(p.created_at, '+8 hours'), 12, 5) BETWEEN s2.start_time AND s2.end_time)) AS gmv_cents
         FROM live_sessions s JOIN users u ON u.id = s.host_user_id
         WHERE s.status != 'cancelled' AND substr(s.session_date, 1, 7) = ?1
         GROUP BY u.id ORDER BY minutes DESC LIMIT 20`,
      ).bind(monthMY).all();
      hosts = results;
    } catch { /* pre-0056 */ }
    return json({ month: monthMY, clients, hosts });
  }

  // Idea 3: the public package rate card — ONE system_meta row, edited from
  // the portal, served unauthenticated by index.ts. The public page renders
  // only when real tiers exist (house rule: never display zero stats).
  if (path === "/sales/packages" && method === "GET") {
    if (!can(user.role, "revenue_view")) return err("forbidden", "Sales access required", 403);
    const row = await env.DB.prepare(`SELECT value FROM system_meta WHERE key = 'packages_json'`).first<{ value: string }>();
    return json({ packages: row ? JSON.parse(row.value) : null });
  }
  if (path === "/sales/packages" && method === "POST") {
    if (!["ceo", "super_admin"].includes(user.role)) return err("forbidden", "CEO only", 403);
    const raw = Array.isArray(body?.packages) ? body.packages : [];
    const tiers = raw.slice(0, 6).map((t: { name?: unknown; price_label?: unknown; points?: unknown }) => ({
      name: String(t?.name ?? "").trim().slice(0, 60),
      price_label: String(t?.price_label ?? "").trim().slice(0, 60),
      points: (Array.isArray(t?.points) ? t.points : []).map((p: unknown) => String(p).trim().slice(0, 120)).filter(Boolean).slice(0, 8),
    })).filter((t: { name: string }) => t.name);
    await env.DB.prepare(
      `INSERT INTO system_meta (key, value) VALUES ('packages_json', ?1)
       ON CONFLICT(key) DO UPDATE SET value = ?1`,
    ).bind(JSON.stringify(tiers)).run();
    await audit(env, user.id, "sales.packages_update", "system_meta", "packages_json", { tiers: tiers.length });
    return json({ ok: true, packages: tiers });
  }

  if (path === "/customers" && (method === "GET" || method === "POST")) {
    if (method === "GET" ? !can(user.role, "sales") && !can(user.role, "exec_view") : !can(user.role, "sales")) {
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
    if (!can(user.role, "sales")) return err("forbidden", "Sales access required", 403);
    /* v1.4.235: sending "" clears a field (→ NULL) — before, a field could
       never be emptied once set. company itself can't be cleared. */
    const fields = ["company", "contact_person", "phone", "email", "address", "notes"] as const;
    const sets: string[] = [];
    const vals: (string | null)[] = [];
    for (const f of fields) {
      const v = body?.[f];
      if (v === undefined) continue;
      if (v === "" || v === null) {
        if (f === "company") return err("invalid_input", "Company name cannot be empty", 400);
        sets.push(`${f} = ?${sets.length + 1}`); vals.push(null);
      } else if (str(v, 2000)) {
        sets.push(`${f} = ?${sets.length + 1}`); vals.push(v as string);
      }
    }
    if (sets.length === 0) return err("invalid_input", "Nothing to update", 400);
    await env.DB.prepare(`UPDATE customers SET ${sets.join(", ")} WHERE id = ?${sets.length + 1}`)
      .bind(...vals, custMatch[1]!).run();
    await audit(env, user.id, "customer.update", "customers", custMatch[1]!);
    return json({ ok: true });
  }
  if (custMatch && method === "DELETE") {
    /* v1.4.235 (CEO: "delete if require"): a customer with documents is
       NEVER deleted — quotations/invoices must keep their party for
       records; the message tells him what blocks it. */
    if (!can(user.role, "sales")) return err("forbidden", "Sales access required", 403);
    const refs = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM sales_documents WHERE customer_id = ?1`,
    ).bind(custMatch[1]!).first<{ n: number }>();
    if ((refs?.n ?? 0) > 0) {
      return err("invalid_input", `This customer has ${refs!.n} document${refs!.n === 1 ? "" : "s"} (quotation/invoice/DO) — records must keep their customer. Edit the details instead.`, 409);
    }
    const gone = await env.DB.prepare(`SELECT company FROM customers WHERE id = ?1`).bind(custMatch[1]!).first<{ company: string }>();
    if (!gone) return err("not_found", "Customer not found", 404);
    await env.DB.prepare(`DELETE FROM customers WHERE id = ?1`).bind(custMatch[1]!).run();
    await audit(env, user.id, "customer.delete", "customers", custMatch[1]!, { company: gone.company });
    return json({ ok: true });
  }

  /* ---- sales documents (QT / DO / INV) ---- */

  if (path === "/docs" && method === "GET") {
    if (!can(user.role, "sales") && !can(user.role, "exec_view")) return err("forbidden", "Sales access required", 403);
    const url = new URL(request.url);
    const t = url.searchParams.get("type");
    // v1.5.0: bound parameter instead of string interpolation (defence in depth)
    const typed = t && ["QT", "DO", "INV"].includes(t) ? t : null;
    const stmt = env.DB.prepare(
      `SELECT d.*, c.company, c.phone AS customer_phone, sp.name AS salesperson_name FROM sales_documents d
       LEFT JOIN users sp ON sp.id = d.salesperson_id
       JOIN customers c ON c.id = d.customer_id ${typed ? "WHERE d.doc_type = ?1" : ""}
       ORDER BY d.created_at DESC LIMIT 200`,
    );
    const { results } = await (typed ? stmt.bind(typed) : stmt).all();
    return json({ docs: results });
  }
  if (path === "/docs" && method === "POST") {
    if (!body || typeof body.doc_type !== "string" || !["QT", "DO", "INV"].includes(body.doc_type)) {
      return err("invalid_input", "doc_type must be QT, DO, or INV", 400);
    }
    const docType = body.doc_type as "QT" | "DO" | "INV";
    if (docType === "INV" ? !can(user.role, "finance") : !can(user.role, "sales")) {
      return err("forbidden", "Insufficient rights for this document type", 403);
    }
    /* v1.4.234 (CEO: two business lines — "details just filled by one
       details"): every document is for ONE line, product or service.
       Delivery Orders are product-only — a service delivers nothing
       physical, so a service DO is refused outright. */
    const kindD = typeof body.kind === "string" && ["product", "service"].includes(body.kind) ? body.kind : "product";
    if (docType === "DO" && kindD === "service") {
      return err("invalid_input", "A Delivery Order is for goods — services have nothing to physically deliver. Use a Quotation or Invoice for the service.", 400);
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
    /* v1.4.243 (CEO's Malaysian-standard document): a line may now carry a
       SKU, a unit of measure, its own discount and up to 10 detail lines —
       the inclusions that used to be typed as separate RM 0.00 rows. All
       optional; a line without them is exactly the old shape, so every
       existing document still parses. */
    const lineExtras = (i: Record<string, unknown>, qty: number, unit: number) => {
      const o: { sku?: string; uom?: string; disc_cents?: number; sub?: string[] } = {};
      if (str(i.sku, 60)) o.sku = String(i.sku).slice(0, 60);
      if (str(i.uom, 12)) o.uom = String(i.uom).slice(0, 12).toUpperCase();
      if (typeof i.disc_cents === "number" && i.disc_cents > 0) {
        o.disc_cents = Math.min(Math.round(i.disc_cents), qty * unit); // never below zero
      }
      if (Array.isArray(i.sub)) {
        const s = (i.sub as unknown[]).filter((x) => str(x, 160)).slice(0, 10).map((x) => String(x).slice(0, 160));
        if (s.length) o.sub = s;
      }
      return o;
    };
    const items = (body.items as Record<string, unknown>[])
      .filter((i) => str(i.name, 200) && typeof i.qty === "number" && i.qty > 0 && typeof i.unit_price_cents === "number" && i.unit_price_cents >= 0)
      .map((i) => ({
        name: i.name as string, qty: i.qty as number, unit_price_cents: i.unit_price_cents as number,
        ...lineExtras(i, i.qty as number, i.unit_price_cents as number),
      }));
    if (items.length === 0) return err("invalid_input", "Each item needs name, qty, unit_price_cents", 400);

    // Line discounts come off before the document-level discount.
    const subtotal = items.reduce((s, i) => s + i.qty * i.unit_price_cents - (i.disc_cents ?? 0), 0);
    const discount = typeof body.discount_cents === "number" && body.discount_cents >= 0 ? body.discount_cents : 0;
    const taxPct = typeof body.tax_percent === "number" && body.tax_percent >= 0 ? body.tax_percent : 0;
    // v1.4.160: delivery / postage fee — quoted on the QT, billed on the INV,
    // never on a DO (Malaysian standard: the DO carries goods only, no
    // charges). Added AFTER discount + tax: delivery is a pass-through
    // charge, not part of the taxable goods value.
    /* v1.4.238 (CEO conflict check: "for Service, there is no Delivery /
       postage right?"): correct — a service ships nothing, so delivery is
       forced 0 on service documents BEFORE the total computes. */
    const deliveryFee = docType !== "DO" && kindD !== "service" && typeof body.delivery_cents === "number" && body.delivery_cents >= 0
      ? Math.round(body.delivery_cents) : 0;
    const total = Math.max(0, Math.round((subtotal - discount) * (1 + taxPct / 100))) + deliveryFee;

    const number = await docNumber(env, docType);
    // v1.4.93: salesperson — any staff member; defaults to whoever created it.
    const salespersonId = typeof body.salesperson_id === "number" && body.salesperson_id > 0
      ? Math.round(body.salesperson_id) : user.id;
    // v1.4.94: backdating — payments received before this system existed can
    // be invoiced on their true date. Past dates only, never the future.
    const todayMyt = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
    const docDate = typeof body.doc_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.doc_date) && body.doc_date <= todayMyt
      ? body.doc_date : null;
    // v1.4.243: buyer's own PO reference + ship-to address (migration 0062).
    const referenceD = str(body.reference, 60) ? String(body.reference).slice(0, 60) : null;
    const shipToD = docType !== "DO" && kindD === "service" ? null
      : (str(body.delivery_address, 300) ? String(body.delivery_address).slice(0, 300) : null);
    let res: { id: number } | null = null;
    const insertCols = (extra: boolean) => `INSERT INTO sales_documents
         (doc_type, doc_number, customer_id, items, discount_cents, tax_percent, delivery_cents, total_cents,
          notes, valid_until, delivery_status, payment_status, due_date, salesperson_id, created_by, created_at, kind${extra ? ", reference, delivery_address" : ""})
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, COALESCE(?16, datetime('now')), ?17${extra ? ", ?18, ?19" : ""}) RETURNING id`;
    const insertArgs = [
        docType, number, customerId, JSON.stringify(items), discount, taxPct, deliveryFee, total,
        str(body.notes, 2000) ? body.notes : null,
        docType === "QT" && str(body.valid_until, 10) ? body.valid_until : null,
        docType === "DO" ? "pending" : null,
        docType === "INV" ? "unpaid" : null,
        docType === "INV" && str(body.due_date, 10) ? body.due_date : null,
        salespersonId,
        user.id,
        docDate ? `${docDate} 00:00:00` : null,
        kindD, // v1.4.234
    ];
    try {
      res = await env.DB.prepare(insertCols(true))
        .bind(...insertArgs, referenceD, shipToD).first<{ id: number }>();
    } catch (e) {
      /* v1.4.218 lesson — never let an OPTIONAL column take down a critical
         write: on a database that has not had 0062 applied yet the document
         is still created, just without its reference / ship-to. */
      if (String(e).includes("no such column")) {
        try {
          res = await env.DB.prepare(insertCols(false)).bind(...insertArgs).first<{ id: number }>();
          await logError(env, "migration_skew", "sales_documents missing 0062 columns (reference/delivery_address)");
        } catch (e2) {
          if (String(e2).includes("no such column")) {
            return err("migration_missing", "Run: npx wrangler d1 migrations apply azoneofficial --remote", 500);
          }
          throw e2;
        }
      } else throw e;
    }
    // v1.4.91: payment already in hand — the invoice is born paid (bank
    // transfer) and counts in revenue immediately.
    if (docType === "INV" && body.paid_received === true && res?.id) {
      const payDate = typeof body.paid_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.paid_date) && body.paid_date <= todayMyt
        ? `${body.paid_date} 00:00:00` : (docDate ? `${docDate} 00:00:00` : null);
      await env.DB.prepare(
        `UPDATE sales_documents SET payment_status = 'paid', payment_method = 'bank_transfer',
         payment_ref = ?1, paid_at = COALESCE(?2, datetime('now')) WHERE id = ?3`,
      ).bind(typeof body.payment_ref === "string" ? body.payment_ref.slice(0, 120) : null, payDate, res.id).run();
      // v1.21.0: a born-paid invoice books its money-in the same way the
      // mark-paid route does — one ref (INV-<id>), one row, one journal entry.
      await recordBankMovement(env, user.id, `INV-${res.id}`, total, "sales", `Invoice ${number} paid`, "in");
    }
    // v1.4.263: a product invoice moves stock the moment it exists.
    let stockMove: Awaited<ReturnType<typeof deductForInvoice>> | null = null;
    if (docType === "INV" && kindD !== "service" && res?.id) {
      stockMove = await deductForInvoice(env, res.id, number, JSON.stringify(items), docDate, user.id);
    }
    await audit(env, user.id, `doc.create_${docType.toLowerCase()}`, "sales_documents", String(res?.id));
    return json({ id: res?.id, doc_number: number, total_cents: total, stock: stockMove }, 201);
  }
  const docGet = path.match(/^\/docs\/(\d+)$/);
  if (docGet && method === "GET") {
    if (!can(user.role, "sales")) return err("forbidden", "Sales access required", 403);
    /* v1.4.243: the customer's default ship-to rides along so the printed
       document can fall back to it when the document itself carries none.
       Wrapped for 0062 skew (v1.4.218 lesson) — a pre-0062 database must
       still be able to print. */
    const docSelect = (extra: boolean) =>
      `SELECT d.*, c.company, c.contact_person, c.email AS customer_email, c.phone AS customer_phone, c.address,
              ${extra ? "c.delivery_address AS customer_delivery_address," : ""}
              sp.name AS salesperson_name, cb.role AS created_by_role
       FROM sales_documents d JOIN customers c ON c.id = d.customer_id
       LEFT JOIN users sp ON sp.id = d.salesperson_id
       LEFT JOIN users cb ON cb.id = d.created_by WHERE d.id = ?1`;
    let d: Record<string, unknown> | null;
    try {
      d = await env.DB.prepare(docSelect(true)).bind(docGet[1]).first<Record<string, unknown>>();
    } catch (e) {
      if (!String(e).includes("no such column")) throw e;
      d = await env.DB.prepare(docSelect(false)).bind(docGet[1]).first<Record<string, unknown>>();
    }
    if (!d) return err("not_found", "Document not found", 404);
    /* v1.4.233 signer rule (CEO): a document prepared by the CEO, COO or
       CCO carries THAT officer's uploaded signature. Prepared by anyone
       else (hr_admin, sales_marketing, …) → the "Prepared by" block shows
       the PREPARER's own name and position with a BLANK line — they sign
       in ink themselves; no officer's signature is borrowed.
       Exception: an INVOICE's block is "Authorised signature" — an
       authorisation act, so a non-officer preparer's invoice still carries
       the CEO's signature (raising invoices already needs finance rights). */
    const MGMT_SIGNERS = ["ceo", "coo", "cco"];
    const roleOfCreator = String(d.created_by_role ?? "");
    let signRole: string | null;
    if (MGMT_SIGNERS.includes(roleOfCreator)) signRole = roleOfCreator;
    else signRole = d.doc_type === "INV" ? "ceo" : null; // null = manual ink signature
    let signer: { signer_name: string; position: string | null } | null;
    if (signRole) {
      signer = await env.DB.prepare(
        `SELECT COALESCE(full_name, name) AS signer_name, position FROM users
         WHERE role = ?1 AND is_active = 1 ORDER BY id LIMIT 1`,
      ).bind(signRole).first<{ signer_name: string; position: string | null }>();
    } else {
      signer = await env.DB.prepare(
        `SELECT COALESCE(full_name, name) AS signer_name, position FROM users WHERE id = ?1`,
      ).bind(d.created_by as number).first<{ signer_name: string; position: string | null }>();
    }
    return json({ doc: {
      ...d,
      signer_role: signRole,
      signer_name: signer?.signer_name ?? "AZ ONE OFFICIAL",
      signer_position: signer?.position ?? (signRole === "coo" ? "Chief Operating Officer" : signRole === "cco" ? "Chief Commercial Officer" : signRole === "ceo" ? "Chief Executive Officer" : ""),
    } });
  }

  const docMatch = path.match(/^\/docs\/(\d+)$/);
  if (docMatch && method === "PATCH") {
    const id = docMatch[1]!;
    const doc = await env.DB.prepare(`SELECT doc_type, doc_number, total_cents FROM sales_documents WHERE id = ?1`)
      .bind(id).first<{ doc_type: string; doc_number: string; total_cents: number }>();
    if (!doc) return err("not_found", "Document not found", 404);
    if (doc.doc_type === "INV") {
      if (!can(user.role, "finance")) return err("forbidden", "Finance access required", 403);
      const ok = typeof body?.payment_status === "string" && ["unpaid", "paid", "overdue"].includes(body.payment_status);
      if (!ok) return err("invalid_input", "payment_status must be unpaid|paid|overdue", 400);
      // v1.4.90: paid = payment received — record method (bank transfer),
      // optional reference, and the moment. Revenue counts from paid_at.
      if (body!.payment_status === "paid") {
        const methods = ["bank_transfer", "cash", "cheque", "other"];
        const methodP = typeof body!.payment_method === "string" && methods.includes(body!.payment_method)
          ? (body!.payment_method as string) : "bank_transfer";
        const refP = typeof body!.payment_ref === "string" ? body!.payment_ref.slice(0, 120) : null;
        /* v1.4.250 (CEO: "a calendar for me to pick which date they make the
           payment for accurate tracking"): the day the money actually landed,
           not the moment the box was ticked. Revenue buckets invoices by
           paid_at (+8 hours), so it is stored at 04:00 UTC = midday MYT —
           that way the shift can never move it onto the neighbouring day.
           An explicit date OVERRIDES an earlier one; without it the old
           COALESCE-to-now behaviour stands, so nothing existing changes.
           Future dates are refused: you cannot receive tomorrow's money. */
        const rawOn = typeof body!.paid_on === "string" ? body!.paid_on : "";
        const todayMyt = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
        const paidOn = /^\d{4}-\d{2}-\d{2}$/.test(rawOn) && rawOn <= todayMyt ? rawOn : null;
        if (rawOn && !paidOn) return err("invalid_input", "Payment date must be a real date, today or earlier", 400);
        if (paidOn) {
          await env.DB.prepare(
            `UPDATE sales_documents SET payment_status = 'paid', payment_method = ?1, payment_ref = ?2,
             paid_at = ?3 WHERE id = ?4`,
          ).bind(methodP, refP, `${paidOn} 04:00:00`, id).run();
        } else {
          await env.DB.prepare(
            `UPDATE sales_documents SET payment_status = 'paid', payment_method = ?1, payment_ref = ?2,
             paid_at = COALESCE(paid_at, datetime('now')) WHERE id = ?3`,
          ).bind(methodP, refP, id).run();
        }
        /* v1.21.0 (CEO: "cash flow should sync with Finance — semi
           automation instead of manually logged"): a PAID invoice IS money
           in the bank, so it writes its own money-in row + journal entry.
           Ref INV-<id> — unmark/remark can never double-book. */
        await recordBankMovement(env, user.id, `INV-${id}`, doc.total_cents ?? 0,
          "sales", `Invoice ${doc.doc_number} paid`, "in");
      } else {
        await env.DB.prepare(
          `UPDATE sales_documents SET payment_status = ?1, payment_method = NULL, payment_ref = NULL, paid_at = NULL WHERE id = ?2`,
        ).bind(body!.payment_status, id).run();
      }
    } else if (doc.doc_type === "DO") {
      if (!can(user.role, "sales")) return err("forbidden", "Sales access required", 403);
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
    if (!can(user.role, "finance")) return err("forbidden", "Finance access required to raise invoices", 403);
    const qt = await env.DB.prepare(
      `SELECT * FROM sales_documents WHERE id = ?1 AND doc_type = 'QT'`,
    ).bind(docConv[1]).first<Record<string, unknown>>();
    if (!qt) return err("not_found", "Quotation not found", 404);
    const numberC = await docNumber(env, "INV");
    const resC = await env.DB.prepare(
      `INSERT INTO sales_documents
       (doc_type, doc_number, customer_id, items, discount_cents, tax_percent, delivery_cents, total_cents,
        notes, payment_status, salesperson_id, created_by, converted_from, kind)
       VALUES ('INV', ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'unpaid', ?9, ?10, ?11, ?12) RETURNING id`,
    ).bind(
      numberC, qt.customer_id, qt.items, qt.discount_cents ?? 0, qt.tax_percent ?? 0,
      (qt as { delivery_cents?: number }).delivery_cents ?? 0, qt.total_cents ?? 0,
      qt.notes ?? null, qt.salesperson_id ?? user.id, user.id, qt.id,
      (qt as { kind?: string | null }).kind ?? "product", // v1.4.234: the invoice inherits the quotation's line
    ).first<{ id: number }>();
    // v1.4.263: the invoice born from a quotation deducts stock too — the QT
    // itself never moved any, so this is the sale's single deduction.
    let stockMoveC: Awaited<ReturnType<typeof deductForInvoice>> | null = null;
    if (((qt as { kind?: string | null }).kind ?? "product") !== "service" && resC?.id) {
      stockMoveC = await deductForInvoice(env, resC.id, numberC, String(qt.items ?? "[]"), null, user.id);
    }
    await audit(env, user.id, "doc.convert_qt_inv", "sales_documents", String(resC?.id), { from: qt.doc_number });
    return json({ id: resC?.id, doc_number: numberC, stock: stockMoveC }, 201);
  }

  /* v1.4.233 (CEO: "reversal button for the Quotation if accidentally click
     invoice"): undo a conversion — allowed ONLY while the invoice is still
     an untouched result of the click: doc_type INV, carries converted_from,
     and payment_status is 'unpaid'. The invoice row is deleted (audited
     with its number); the quotation was never modified by the conversion,
     so it simply stands as before. A paid invoice can never be reversed. */
  const docUnconv = path.match(/^\/docs\/(\d+)\/unconvert$/);
  if (docUnconv && method === "POST") {
    if (!can(user.role, "finance")) return err("forbidden", "Finance access required", 403);
    const inv = await env.DB.prepare(
      `SELECT id, doc_type, doc_number, payment_status, converted_from FROM sales_documents WHERE id = ?1`,
    ).bind(docUnconv[1]).first<{ id: number; doc_type: string; doc_number: string; payment_status: string | null; converted_from: number | null }>();
    if (!inv || inv.doc_type !== "INV") return err("not_found", "Invoice not found", 404);
    if (!inv.converted_from) return err("invalid_input", "This invoice was not created from a quotation", 400);
    if (inv.payment_status === "paid") return err("invalid_input", "A PAID invoice cannot be reversed — unmark the payment first if this is truly a mistake", 400);
    const restoredU = await restoreForInvoice(env, inv.id, inv.doc_number); // v1.4.263
    await env.DB.prepare(`DELETE FROM sales_documents WHERE id = ?1`).bind(inv.id).run();
    await audit(env, user.id, "doc.unconvert", "sales_documents", String(inv.id), { doc_number: inv.doc_number, back_to_qt: inv.converted_from, stock_restored_rows: restoredU });
    return json({ ok: true });
  }

  /* v1.4.237 (CEO: delete a document so the aging card follows, with a
     confirm first): general document delete. ONE guard — a PAID invoice is
     an accounting record and cannot be deleted; unmark the payment first
     if it is truly a mistake. Unpaid INV / QT / DO delete freely; the
     aging card recomputes from the list, so a deleted unpaid invoice
     disappears from it immediately. Audited with the document number. */
  const docDel = path.match(/^\/docs\/(\d+)$/);
  if (docDel && method === "DELETE") {
    if (!can(user.role, "finance")) return err("forbidden", "Finance access required", 403);
    const dd = await env.DB.prepare(
      `SELECT id, doc_type, doc_number, payment_status FROM sales_documents WHERE id = ?1`,
    ).bind(docDel[1]).first<{ id: number; doc_type: string; doc_number: string; payment_status: string | null }>();
    if (!dd) return err("not_found", "Document not found", 404);
    if (dd.doc_type === "INV" && dd.payment_status === "paid") {
      return err("invalid_input", "A PAID invoice is an accounting record and cannot be deleted — unmark the payment first if this is truly a mistake", 400);
    }
    const restoredD = dd.doc_type === "INV" ? await restoreForInvoice(env, dd.id, dd.doc_number) : 0; // v1.4.263
    await env.DB.prepare(`DELETE FROM sales_documents WHERE id = ?1`).bind(dd.id).run();
    await audit(env, user.id, "doc.delete", "sales_documents", String(dd.id), { doc_number: dd.doc_number, doc_type: dd.doc_type, stock_restored_rows: restoredD });
    return json({ ok: true });
  }
  /* v1.4.244 (CEO: "if I click on PDF button I want the format can be deliver
     to my customer using mobile instead of I need to download"): minting a
     share token turns the document into a link the customer can open on any
     phone — no sign-in, no download, no app. Sending the link is one tap in
     the phone's own share sheet, which is where WhatsApp lives.
     Body {revoke:true} clears the token and the link dies immediately. */
  const docShare = path.match(/^\/docs\/(\d+)\/share$/);
  if (docShare && method === "POST") {
    const idS = docShare[1]!;
    const dS = await env.DB.prepare(`SELECT doc_type FROM sales_documents WHERE id = ?1`)
      .bind(idS).first<{ doc_type: string }>();
    if (!dS) return err("not_found", "Document not found", 404);
    if (dS.doc_type === "INV" ? !can(user.role, "finance") : !can(user.role, "sales")) {
      return err("forbidden", "Insufficient rights for this document type", 403);
    }
    const origin = env.ALLOWED_ORIGIN;
    try {
      if (body && body.revoke === true) {
        await env.DB.prepare(`UPDATE sales_documents SET share_token = NULL WHERE id = ?1`).bind(idS).run();
        await audit(env, user.id, "doc.share_revoke", "sales_documents", idS);
        return json({ ok: true, token: null, url: null });
      }
      const existing = await env.DB.prepare(`SELECT share_token FROM sales_documents WHERE id = ?1`)
        .bind(idS).first<{ share_token: string | null }>();
      let token = existing?.share_token ?? null;
      if (!token) {
        // 32 hex characters — unguessable, and short enough to sit in a URL.
        token = Array.from(crypto.getRandomValues(new Uint8Array(16)))
          .map((b) => b.toString(16).padStart(2, "0")).join("");
        await env.DB.prepare(`UPDATE sales_documents SET share_token = ?1 WHERE id = ?2`).bind(token, idS).run();
        await audit(env, user.id, "doc.share", "sales_documents", idS);
      }
      return json({ ok: true, token, url: `${origin}/doc?t=${token}` });
    } catch (e) {
      if (String(e).includes("no such column")) {
        return err("migration_missing", "Run: npx wrangler d1 migrations apply azoneofficial --remote (0063_doc_share_token)", 500);
      }
      throw e;
    }
  }

  const docEdit = path.match(/^\/docs\/(\d+)\/edit$/);
  if (docEdit && method === "POST") {
    // v1.4.94: fix typos on an existing document — items, amounts, customer,
    // salesperson, date. The document NUMBER never changes; totals recompute;
    // audited. Invoice edits need finance rights, like invoice creation.
    const idE = docEdit[1]!;
    let docE: { doc_type: string; kind?: string | null } | null;
    try {
      docE = await env.DB.prepare(`SELECT doc_type, kind FROM sales_documents WHERE id = ?1`)
        .bind(idE).first<{ doc_type: string; kind?: string | null }>();
    } catch {
      // v1.4.238 migration-skew armor (v1.4.218 lesson): pre-0061 DB has no
      // kind column — editing must keep working; kind treated as absent.
      docE = await env.DB.prepare(`SELECT doc_type FROM sales_documents WHERE id = ?1`)
        .bind(idE).first<{ doc_type: string }>();
    }
    if (!docE) return err("not_found", "Document not found", 404);
    if (docE.doc_type === "INV" ? !can(user.role, "finance") : !can(user.role, "sales")) {
      return err("forbidden", "Insufficient rights to edit this document type", 403);
    }
    if (!body || !Array.isArray(body.items) || body.items.length === 0) {
      return err("invalid_input", "items are required", 400);
    }
    const extrasE = (i: Record<string, unknown>, qty: number, unit: number) => {
      const o: { sku?: string; uom?: string; disc_cents?: number; sub?: string[] } = {};
      if (str(i.sku, 60)) o.sku = String(i.sku).slice(0, 60);
      if (str(i.uom, 12)) o.uom = String(i.uom).slice(0, 12).toUpperCase();
      if (typeof i.disc_cents === "number" && i.disc_cents > 0) o.disc_cents = Math.min(Math.round(i.disc_cents), qty * unit);
      if (Array.isArray(i.sub)) {
        const s = (i.sub as unknown[]).filter((x) => str(x, 160)).slice(0, 10).map((x) => String(x).slice(0, 160));
        if (s.length) o.sub = s;
      }
      return o;
    };
    const itemsE = (body.items as Record<string, unknown>[])
      .filter((i) => str(i.name, 200) && typeof i.qty === "number" && i.qty > 0 && typeof i.unit_price_cents === "number" && i.unit_price_cents >= 0)
      .map((i) => ({
        name: i.name as string, qty: i.qty as number, unit_price_cents: i.unit_price_cents as number,
        ...extrasE(i, i.qty as number, i.unit_price_cents as number),
      }));
    if (itemsE.length === 0) return err("invalid_input", "Each item needs name, qty, unit_price_cents", 400);
    const subE = itemsE.reduce((a, i) => a + i.qty * i.unit_price_cents - (i.disc_cents ?? 0), 0);
    const discE = typeof body.discount_cents === "number" && body.discount_cents >= 0 ? body.discount_cents : 0;
    const taxE = typeof body.tax_percent === "number" && body.tax_percent >= 0 ? body.tax_percent : 0;
    // v1.4.160: delivery fee editable like the rest; never on a DO.
    // v1.4.238: a service document can't gain delivery through an edit either.
    const delE = docE.doc_type !== "DO" && docE.kind !== "service" && typeof body.delivery_cents === "number" && body.delivery_cents >= 0
      ? Math.round(body.delivery_cents) : 0;
    const totalE = Math.max(0, Math.round((subE - discE) * (1 + taxE / 100))) + delE;
    let custE: number | null = typeof body.customer_id === "number" && body.customer_id > 0 ? body.customer_id : null;
    if (body.customer_id === 0) {
      const wi = await env.DB.prepare(`SELECT id FROM customers WHERE company = 'Walk-in Customer'`).first<{ id: number }>();
      custE = wi?.id ?? null;
    }
    const spE = typeof body.salesperson_id === "number" && body.salesperson_id > 0 ? Math.round(body.salesperson_id) : null;
    const todayE = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
    const dateE = typeof body.doc_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.doc_date) && body.doc_date <= todayE
      ? `${body.doc_date} 00:00:00` : null;
    const refE = str(body.reference, 60) ? String(body.reference).slice(0, 60) : null;
    const shipE = docE.kind === "service" ? null
      : (str(body.delivery_address, 300) ? String(body.delivery_address).slice(0, 300) : null);
    const baseSet = `items = ?1, discount_cents = ?2, tax_percent = ?3, delivery_cents = ?4, total_cents = ?5,
         customer_id = COALESCE(?6, customer_id), salesperson_id = COALESCE(?7, salesperson_id),
         created_at = COALESCE(?8, created_at)`;
    const baseArgs = [JSON.stringify(itemsE), discE, taxE, delE, totalE, custE, spE, dateE];
    try {
      await env.DB.prepare(`UPDATE sales_documents SET ${baseSet}, reference = ?10, delivery_address = ?11 WHERE id = ?9`)
        .bind(...baseArgs, idE, refE, shipE).run();
    } catch (e) {
      // 0062 skew: the edit still saves, minus the two optional fields.
      if (String(e).includes("no such column")) {
        try {
          await env.DB.prepare(`UPDATE sales_documents SET ${baseSet} WHERE id = ?9`).bind(...baseArgs, idE).run();
        } catch (e2) {
          if (String(e2).includes("no such column")) {
            return err("migration_missing", "Run: npx wrangler d1 migrations apply azoneofficial --remote", 500);
          }
          throw e2;
        }
      } else throw e;
    }
    /* v1.4.265 (the gap flagged in v1.4.263): editing a product invoice's
       items now RE-BALANCES stock — the old deduction is restored in full,
       then the new items deduct, so the shelf always reflects the invoice as
       it reads NOW. Two steps rather than a diff because a line can change
       SKU, not just quantity, and restore-then-deduct is right in every case. */
    let stockE: Awaited<ReturnType<typeof deductForInvoice>> | null = null;
    let edited: { doc_type: string; doc_number: string; kind?: string | null } | null = null;
    try {
      edited = await env.DB.prepare(
        `SELECT doc_type, doc_number, kind FROM sales_documents WHERE id = ?1`,
      ).bind(idE).first<{ doc_type: string; doc_number: string; kind: string | null }>();
    } catch (e) {
      if (String(e).includes("no such column")) {
        edited = await env.DB.prepare(
          `SELECT doc_type, doc_number FROM sales_documents WHERE id = ?1`,
        ).bind(idE).first<{ doc_type: string; doc_number: string; kind?: string | null }>();
      } else throw e;
    }
    if (edited && edited.doc_type === "INV" && (edited.kind ?? "product") !== "service") {
      await restoreForInvoice(env, Number(idE), edited.doc_number);
      stockE = await deductForInvoice(env, Number(idE), edited.doc_number, JSON.stringify(itemsE), null, user.id);
    }
    await audit(env, user.id, "doc.edit", "sales_documents", idE, { total_cents: totalE });
    return json({ ok: true, total_cents: totalE, stock: stockE });
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
    if (!can(user.role, "hr_manage")) return err("forbidden", "HR access required", 403);
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
    if (!can(user.role, "hr_manage")) return err("forbidden", "HR access required", 403);
    await env.DB.prepare(`DELETE FROM holidays WHERE id = ?1`).bind(holMatch[1]).run();
    await audit(env, user.id, "holiday.delete", "holidays", holMatch[1]);
    return json({ ok: true });
  }

  /* ---- Leave entitlement editor (admin/HR) ---- */

  if (path === "/leave/entitlement" && method === "GET") {
    if (!can(user.role, "hr_manage")) return err("forbidden", "HR access required", 403);
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
    if (!can(user.role, "hr_manage")) return err("forbidden", "HR access required", 403);
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
    if (!can(user.role, "payroll_export")) return err("forbidden", "Payroll access required", 403);
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

  /* v1.4.183 (CEO): PART-TIME LIVE HOSTS are paid RM15.00/hour on their
     clocked time — first clock-in to last clock-out per MYT day, summed for
     the month. Contract/permanent live hosts stay on the salary model (and
     keep OT eligibility; part-time never had it). One helper feeds the GET
     view, the save route and the recompute button — single source of truth. */
  const PART_TIME_LH_RATE_CENTS = 1500; // RM15.00/hour — CEO's rule, one place to change
  const isHourlyUser = (role: string | null | undefined, emp: string | null | undefined) =>
    role === "live_host" && emp === "part_time";
  const clockedMinutes = async (userId: number, month: string): Promise<number> => {
    const { results } = await env.DB.prepare(
      `SELECT date(created_at, '+8 hours') AS d,
              MIN(CASE WHEN type = 'clock_in'  THEN created_at END) AS i,
              MAX(CASE WHEN type = 'clock_out' THEN created_at END) AS o
       FROM attendance_records
       WHERE user_id = ?1 AND strftime('%Y-%m', created_at, '+8 hours') = ?2
       GROUP BY d`,
    ).bind(userId, month).all<{ d: string; i: string | null; o: string | null }>();
    let mins = 0;
    for (const r of results) {
      if (!r.i || !r.o) continue; // an unpaired day earns nothing until fixed
      const diff = (new Date(r.o + "Z").getTime() - new Date(r.i + "Z").getTime()) / 60000;
      if (diff > 0) mins += Math.round(diff);
    }
    return mins;
  };
  const hourlyPayCents = (mins: number) => Math.round((mins * PART_TIME_LH_RATE_CENTS) / 60);

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
              u.employment_status, u.role AS user_role, u.bank_name, u.bank_account, u.ic_number
       FROM payroll_entries p JOIN users u ON u.id = p.user_id
       WHERE p.month = ?1 ORDER BY u.name`,
    ).bind(month).all();
    // v1.4.183: hourly users get live clocked minutes so the panel shows the
    // CURRENT month figure even before the entry is saved/recomputed.
    for (const r of results as Record<string, unknown>[]) {
      if (isHourlyUser(r.user_role as string, r.employment_status as string)) {
        const mins = await clockedMinutes(r.user_id as number, month);
        r.hourly_minutes_live = mins;
        r.hourly_rate_live = PART_TIME_LH_RATE_CENTS;
        r.hourly_pay_live = hourlyPayCents(mins);
      }
    }
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
    if (!can(user.role, "expenses")) return err("forbidden", "Expenses access required", 403);
    const mP = typeof body?.month === "string" && /^\d{4}-\d{2}$/.test(body.month) ? body.month : null;
    if (!mP) return err("invalid_input", "month (YYYY-MM) is required", 400);
    await env.DB.prepare(
      `INSERT INTO payroll_payments (month, paid_by) VALUES (?1, ?2) ON CONFLICT(month) DO NOTHING`,
    ).bind(mP, user.id).run();
    // v1.19.0 C2: the salary run becomes ONE bank movement for the month.
    try {
      const net = await env.DB.prepare(
        `SELECT COALESCE(SUM(net_cents), 0) AS n FROM payroll_entries WHERE month = ?1`,
      ).bind(mP).first<{ n: number }>();
      await recordBankMovement(env, user.id, `PAYROLL-${mP}`, net?.n ?? 0, "salaries", `Payroll bank run ${mP}`);
    } catch { /* pre-0041 net_cents */ }
    await audit(env, user.id, "payroll.paid", "payroll_payments", mP);
    return json({ ok: true });
  }
  if (path === "/payroll/pull-commission" && method === "POST") {
    /* v1.19.0 (consolidation C3) — closes the DOUBLE-PAYMENT path. Approved
       commission entries for the month flow into payroll_entries.commission_cents
       and are marked paid in the same pass; a second click finds nothing
       approved and applies nothing. Entries without a payroll row are
       reported back, not silently dropped. */
    if (!can(user.role, "payroll_export")) return err("forbidden", "Payroll access required", 403);
    const mC = typeof body?.month === "string" && /^\d{4}-\d{2}$/.test(body.month) ? body.month : null;
    if (!mC) return err("invalid_input", "month (YYYY-MM) is required", 400);
    const entries = await env.DB.prepare(
      `SELECT e.id, e.host_id, e.amount_cents, COALESCE(NULLIF(TRIM(u.full_name), ''), u.name) AS name
         FROM commission_entries e JOIN users u ON u.id = e.host_id
        WHERE e.period = ?1 AND e.status = 'approved'`,
    ).bind(mC).all<{ id: number; host_id: number; amount_cents: number; name: string }>().catch(() => ({ results: [] as { id: number; host_id: number; amount_cents: number; name: string }[] }));
    const applied: { name: string; amount_cents: number }[] = [];
    const skipped: string[] = [];
    for (const e of entries.results ?? []) {
      const upd = await env.DB.prepare(
        `UPDATE payroll_entries SET commission_cents = commission_cents + ?1 WHERE user_id = ?2 AND month = ?3`,
      ).bind(e.amount_cents, e.host_id, mC).run();
      if (upd.meta.changes) {
        await env.DB.prepare(`UPDATE commission_entries SET status = 'paid' WHERE id = ?1`).bind(e.id).run();
        applied.push({ name: e.name, amount_cents: e.amount_cents });
      } else {
        skipped.push(e.name); // no payroll row for that person+month yet
      }
    }
    if (applied.length) await audit(env, user.id, "payroll.pull_commission", "payroll_entries", mC,
      { applied: applied.length, total: applied.reduce((a, x) => a + x.amount_cents, 0) });
    return json({ applied, skipped });
  }
  if (path === "/payroll/release" && method === "POST") {
    // Early manual release for a month (e.g. the 5th falls badly and the
    // CEO decides to release before the automatic moment). Audited.
    // v1.4.210 (CEO caught the flow bug — he released 08-2026 while the
    // run being PAID in early August is July's): body { undo: true }
    // deletes an early release so the automatic 5th-of-next-month gate
    // resumes. After the automatic moment, undo is a no-op for staff
    // visibility — the gate is open regardless of the override row.
    if (!PAYROLL_PROC.includes(user.role)) return err("forbidden", "Payroll access required", 403);
    const mR = typeof body?.month === "string" && /^\d{4}-\d{2}$/.test(body.month) ? body.month : null;
    if (!mR) return err("invalid_input", "month (YYYY-MM) is required", 400);
    if (body?.undo === true) {
      await env.DB.prepare(`DELETE FROM payslip_releases WHERE month = ?1`).bind(mR).run();
      await audit(env, user.id, "payroll.release_undo", "payslip_releases", mR);
      return json({ ok: true });
    }
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

  if (path === "/payroll/m2e-settings" && method === "GET") {
    // v1.4.203: one-time M2E setup — Corporate ID + payer account (CEO asked
    // to store them so the button emits a fully-filled workbook). The M2E
    // USER ID and password are login credentials and are NEVER stored.
    if (!PAYROLL_PROC.includes(user.role)) return err("forbidden", "Payroll access required", 403);
    const cid = await env.DB.prepare(`SELECT value FROM system_meta WHERE key = 'm2e_corporate_id'`).first<{ value: string }>();
    const acc = await env.DB.prepare(`SELECT value FROM system_meta WHERE key = 'm2e_payer_account'`).first<{ value: string }>();
    const cbid = await env.DB.prepare(`SELECT value FROM system_meta WHERE key = 'm2e_client_batch_id'`).first<{ value: string }>();
    const tpl = await env.MEDIA.head(M2E_TEMPLATE_KEY);
    return json({ corporate_id: cid?.value ?? "", payer_account: acc?.value ?? "", client_batch_id: cbid?.value ?? "", has_template: tpl !== null });
  }
  if (path === "/payroll/m2e-settings" && method === "POST") {
    if (!PAYROLL_PROC.includes(user.role)) return err("forbidden", "Payroll access required", 403);
    const cid = String(body?.corporate_id ?? "").trim().toUpperCase().slice(0, 20);
    const acc = String(body?.payer_account ?? "").replace(/[^0-9]/g, "").slice(0, 20);
    const cbid = String(body?.client_batch_id ?? "").trim().toUpperCase().slice(0, 20);
    if (!cid || !acc || !cbid) return err("invalid_input", "corporate_id, client_batch_id and payer_account required", 400);
    await env.DB.prepare(`INSERT INTO system_meta (key, value) VALUES ('m2e_corporate_id', ?1) ON CONFLICT(key) DO UPDATE SET value = ?1`).bind(cid).run();
    await env.DB.prepare(`INSERT INTO system_meta (key, value) VALUES ('m2e_payer_account', ?1) ON CONFLICT(key) DO UPDATE SET value = ?1`).bind(acc).run();
    await env.DB.prepare(`INSERT INTO system_meta (key, value) VALUES ('m2e_client_batch_id', ?1) ON CONFLICT(key) DO UPDATE SET value = ?1`).bind(cbid).run();
    await audit(env, user.id, "payroll.m2e_settings", "payroll", "m2e", {});
    return json({ ok: true });
  }
  if (path === "/payroll/m2e-template" && method === "POST") {
    // Binary body (on the exclusion list): the BLANK official template,
    // stored once in R2 and reused every month.
    if (!PAYROLL_PROC.includes(user.role)) return err("forbidden", "Payroll access required", 403);
    const lenT = parseInt(request.headers.get("Content-Length") ?? "0", 10);
    if (!lenT || lenT > 12 * 1024 * 1024) return err("invalid_input", "Template file required (max 12MB)", 400);
    const bytesT = new Uint8Array(await request.arrayBuffer());
    if (!(bytesT[0] === 0x50 && bytesT[1] === 0x4b)) return err("invalid_input", "Not an .xlsm file", 400);
    try {
      // must contain both sheets before we accept it
      await fillM2eTemplate(bytesT, { corporateId: "X", clientBatchId: "X", payerAccount: "0", valueDate: "01011970" }, []);
    } catch {
      return err("invalid_input", "This doesn't look like the M2E RCGEN2 template (Home / Salary Bulk Payment (MY) sheets not found)", 400);
    }
    await env.MEDIA.put(M2E_TEMPLATE_KEY, bytesT, { httpMetadata: { contentType: "application/vnd.ms-excel.sheet.macroEnabled.12" } });
    await audit(env, user.id, "payroll.m2e_template", "payroll", "m2e", { bytes: bytesT.length });
    return json({ ok: true });
  }
  if (path === "/payroll/m2e-file" && method === "GET") {
    /* v1.4.203 (CEO: "I WANT the button can generate like this files!"):
       the filled .xlsm itself — Home sheet (Corporate ID, Client Batch ID
       AZOO{MM}{YYYY}, payer account, Value Date per the v1.4.202 rule) plus
       the salary rows from row 5 — macros untouched, ready to upload. */
    if (!PAYROLL_PROC.includes(user.role)) return err("forbidden", "Payroll access required", 403);
    const urlM = new URL(request.url);
    const monthM = urlM.searchParams.get("month");
    if (!monthM || !/^\d{4}-\d{2}$/.test(monthM)) return err("invalid_input", "month (YYYY-MM) required", 400);
    const tplObj = await env.MEDIA.get(M2E_TEMPLATE_KEY);
    if (!tplObj) return err("template_missing", "Upload the blank M2E template once via M2E setup", 409);
    const cidM = await env.DB.prepare(`SELECT value FROM system_meta WHERE key = 'm2e_corporate_id'`).first<{ value: string }>();
    const accM = await env.DB.prepare(`SELECT value FROM system_meta WHERE key = 'm2e_payer_account'`).first<{ value: string }>();
    const cbidM = await env.DB.prepare(`SELECT value FROM system_meta WHERE key = 'm2e_client_batch_id'`).first<{ value: string }>();
    if (!cidM?.value || !accM?.value || !cbidM?.value) return err("settings_missing", "Save Corporate ID, Client Batch ID + payer account once via M2E setup", 409);
    const vdP = urlM.searchParams.get("value_date");
    const vdM = vdP && /^\d{4}-\d{2}-\d{2}$/.test(vdP) ? vdP : paymentDateFor(monthM);
    const [my, mm, md] = vdM.split("-");
    const valueDateM = `${md}${mm}${my}`;
    const { results: rowsM } = await env.DB.prepare(
      `SELECT u.full_name, u.name, u.employee_id, u.bank_name, u.bank_account, u.ic_number, p.net_cents,
              p.basic_cents, p.commission_cents, p.allowance_cents,
              COALESCE(p.ot_cents, 0) AS ot_cents, p.deduction_cents
       FROM payroll_entries p JOIN users u ON u.id = p.user_id
       WHERE p.month = ?1 AND u.is_active = 1
         AND u.role NOT IN ('customer', 'super_admin')
       ORDER BY u.name`,
    ).bind(monthM).all<{ full_name: string | null; name: string; employee_id: string | null; bank_name: string | null; bank_account: string | null; ic_number: string | null; net_cents: number | null; basic_cents: number; commission_cents: number; allowance_cents: number; ot_cents: number; deduction_cents: number }>();
    const [yM, moM] = monthM.split("-");
    /* v1.4.205 (his real working batch, screenshots): Own Ref is UNIQUE per
       row — PAYROLL + value date as MMDDYY + 2-digit row number
       (PAYROLL08052601..05 for value date 05082026). Favourite Recipient
       Code = the staff employee_id (AZOOM002, AZOOA001, …) — he registered
       his M2E favourites under the portal's employee IDs. */
    const refBase = `PAYROLL${vdM.slice(5, 7)}${vdM.slice(8, 10)}${vdM.slice(2, 4)}`;
    const descM = `SALARY ${moM}-${yM}`;
    const skipped: string[] = [];
    const m2eRows: M2eRow[] = [];
    let totalM = 0;
    for (const r of rowsM) {
      const net = r.net_cents ?? Math.max(0, r.basic_cents + r.commission_cents + r.allowance_cents + r.ot_cents - r.deduction_cents);
      if (net <= 0) continue;
      const code = r.bank_name ? bankCode(r.bank_name) : null;
      if (!r.bank_name || !r.bank_account || !code) { skipped.push(r.full_name || r.name); continue; }
      m2eRows.push({
        mode: code === "MBBEMYKL" ? "IT" : "IG",
        valueDate: valueDateM,
        name: (r.full_name || r.name).toUpperCase().replace(/[^A-Z0-9 @\/\-.]/g, " ").slice(0, 40).trim(),
        faveCode: (r.employee_id ?? "").toUpperCase(),
        amount: net / 100,
        account: r.bank_account.replace(/[^0-9]/g, ""),
        bankCode: code,
        newIc: (r.ic_number ?? "").replace(/[^0-9]/g, ""),
        ownRef: `${refBase}${String(m2eRows.length + 1).padStart(2, "0")}`,
        recipientDesc: descM,
        payerDesc: descM,
      });
      totalM += net;
    }
    if (m2eRows.length === 0) return err("no_payees", `No payable rows for ${monthM}${skipped.length ? ` (missing bank details/code: ${skipped.join("; ")})` : ""}`, 409);
    const filled = await fillM2eTemplate(new Uint8Array(await tplObj.arrayBuffer()), {
      corporateId: cidM.value,
      clientBatchId: cbidM.value,
      payerAccount: accM.value,
      valueDate: valueDateM,
    }, m2eRows);
    await audit(env, user.id, "payroll.m2e_file", "payroll", monthM, { payees: m2eRows.length, total_cents: totalM, skipped: skipped.length, value_date: valueDateM });
    const headersM: Record<string, string> = {
      "Content-Type": "application/vnd.ms-excel.sheet.macroEnabled.12",
      "Content-Disposition": `attachment; filename="azoo-m2e-salary-${monthM}.xlsm"`,
    };
    if (skipped.length > 0) headersM["X-M2E-Skipped"] = encodeURIComponent(skipped.join("; "));
    return new Response(filled, { headers: headersM });
  }
  if (path === "/payroll/payment-file" && method === "GET") {
    /* v1.4.201 (CEO uploaded the official Maybank2E "RCGEN2 - Funds Transfer"
       template, sheet "Salary Bulk Payment (MY)"): the export now matches that
       sheet's columns EXACTLY (headers row 4, data from row 5, cols A..Q used)
       so rows can be pasted straight into the template at cell A5.
       - Payment Mode: IT (intrabank) when the recipient bank is Maybank —
         payer account is Maybank — else IG (GIRO/ACH).
       - Recipient Bank Code: mapped from the staff member's free-text
         bank_name to M2E's official code list (template "Recipient Bank Code"
         sheet). Unmatched banks are listed at the bottom so the CEO fixes the
         bank name in Staff Details or fills the code by hand.
       - Value date: optional ?value_date=YYYY-MM-DD (defaults to today MYT),
         emitted DDMMYYYY as the template requires.
       PAYROLL_PROC only; audited. */
    if (!PAYROLL_PROC.includes(user.role)) return err("forbidden", "Payroll access required", 403);
    const urlPF = new URL(request.url);
    const monthPF = urlPF.searchParams.get("month");
    if (!monthPF || !/^\d{4}-\d{2}$/.test(monthPF)) return err("invalid_input", "month (YYYY-MM) required", 400);
    const vdParam = urlPF.searchParams.get("value_date");
    const vd = vdParam && /^\d{4}-\d{2}-\d{2}$/.test(vdParam) ? vdParam : paymentDateFor(monthPF);
    const [vy, vm, vdd] = vd.split("-");
    const valueDate = `${vdd}${vm}${vy}`; // DDMMYYYY per the template
    const { results: rows } = await env.DB.prepare(
      `SELECT u.full_name, u.name, u.employee_id, u.bank_name, u.bank_account, u.ic_number, p.net_cents,
              p.basic_cents, p.commission_cents, p.allowance_cents,
              COALESCE(p.ot_cents, 0) AS ot_cents, p.deduction_cents
       FROM payroll_entries p JOIN users u ON u.id = p.user_id
       WHERE p.month = ?1 AND u.is_active = 1
         AND u.role NOT IN ('customer', 'super_admin')
       ORDER BY u.name`,
    ).bind(monthPF).all<{ full_name: string | null; name: string; employee_id: string | null; bank_name: string | null; bank_account: string | null; ic_number: string | null; net_cents: number | null; basic_cents: number; commission_cents: number; allowance_cents: number; ot_cents: number; deduction_cents: number }>();
    const missing: string[] = [];
    const noCode: string[] = [];
    const [yPF, mPF] = monthPF.split("-");
    // v1.4.205: Own Ref unique per row — PAYROLL + value date MMDDYY + seq
    const refBasePF = `PAYROLL${vd.slice(5, 7)}${vd.slice(8, 10)}${vd.slice(2, 4)}`;
    const desc = `SALARY ${mPF}-${yPF}`;
    const cell = (v: string) => `"${v.replace(/"/g, '""')}"`;
    // Header mirrors the template's row 4 (cols A..Q) so column alignment can
    // be verified — PASTE FROM THE DATA ROWS ONLY, into the template's A5.
    const lines = [
      [
        "Payment Mode", "Value Date", "Recipient Name 1", "Favourite Recipient Code",
        "Transaction Amount (RM)", "Recipient Account No.", "Recipient Bank Code",
        "Recipient Name 2", "Recipient Name 3", "New IC No", "Old IC No",
        "Business Registration No", "Police/ Army ID/ Passport No", "Own Ref.",
        "Recipient Description", "Email", "Payer Description",
      ].join(","),
    ];
    let totalC = 0;
    let payees = 0;
    for (const r of rows) {
      const net = r.net_cents ?? Math.max(0, r.basic_cents + r.commission_cents + r.allowance_cents + r.ot_cents - r.deduction_cents);
      if (net <= 0) continue; // e.g. the CEO's own RM 0 row
      if (!r.bank_name || !r.bank_account) { missing.push(r.full_name || r.name); continue; }
      const code = bankCode(r.bank_name);
      if (!code) noCode.push(`${r.full_name || r.name} (${r.bank_name})`);
      const nm = (r.full_name || r.name).toUpperCase().replace(/[^A-Z0-9 @\/\-.]/g, " ").slice(0, 40).trim();
      const acct = r.bank_account.replace(/[^0-9]/g, "");
      const mode = code === "MBBEMYKL" ? "IT" : "IG"; // payer account is Maybank
      const ic = (r.ic_number ?? "").replace(/[^0-9]/g, "");
      lines.push([
        mode, valueDate, cell(nm), (r.employee_id ?? "").toUpperCase(), (net / 100).toFixed(2), acct, code ?? "FILL-IN",
        "", "", ic, "", "", "", `${refBasePF}${String(payees + 1).padStart(2, "0")}`, cell(desc), "", cell(desc),
      ].join(","));
      totalC += net;
      payees += 1;
    }
    lines.push("");
    lines.push(`# TOTAL RM ${(totalC / 100).toFixed(2)} across ${payees} payees — paste ONLY the data rows into the M2E template sheet "Salary Bulk Payment (MY)" starting at cell A5 (do NOT paste this header or these # lines).`);
    lines.push(`# Value Date ${valueDate} = the 5th of the following month, moved earlier when it falls on a weekend (company payment rule). Override with &value_date=YYYY-MM-DD or edit in the template.`);
    lines.push(`# In Excel, account numbers and IC numbers that start with 0 need a leading apostrophe — paste-as-text or format the columns as Text first.`);
    if (missing.length > 0) lines.push(`# MISSING BANK DETAILS (add in Staff Details, then re-download): ${missing.join("; ")}`);
    if (noCode.length > 0) lines.push(`# BANK NOT RECOGNISED — fix the bank name in Staff Details or type the M2E Recipient Bank Code by hand: ${noCode.join("; ")}`);
    await audit(env, user.id, "payroll.payment_file", "payroll", monthPF, { payees, total_cents: totalC, format: "m2e_salary" });
    return new Response(lines.join("\r\n"), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="azoo-m2e-salary-${monthPF}.csv"`,
      },
    });
  }
  if (path === "/payroll/recompute" && method === "POST") {
    // v1.4.131: one-click reconciliation. Recomputes the month's working days
    // from the holiday calendar and re-derives + STORES every entry's
    // month_working_days and net_cents server-side — fixing stale rows
    // regardless of what the browser has loaded or saved.
    if (!PAYROLL_PROC.includes(user.role)) return err("forbidden", "Payroll access required", 403);
    const monthR = typeof body?.month === "string" && /^\d{4}-\d{2}$/.test(body.month) ? body.month : null;
    if (!monthR) return err("invalid_input", "month (YYYY-MM) required", 400);
    // Mon–Fri count minus weekday holidays on the calendar.
    const yR = Number(monthR.slice(0, 4)), moR = Number(monthR.slice(5, 7));
    const lastD = new Date(Date.UTC(yR, moR, 0)).getUTCDate();
    let workD = 0;
    const weekdaySet = new Set<string>();
    for (let d = 1; d <= lastD; d++) {
      const dt = new Date(Date.UTC(yR, moR - 1, d));
      const dow = dt.getUTCDay();
      if (dow >= 1 && dow <= 5) { workD++; weekdaySet.add(dt.toISOString().slice(0, 10)); }
    }
    let holCount = 0;
    try {
      const { results: hols } = await env.DB.prepare(
        `SELECT holiday_date FROM holidays WHERE holiday_date LIKE ?1 || '%'`,
      ).bind(monthR).all<{ holiday_date: string }>();
      for (const h of hols) if (weekdaySet.has(h.holiday_date)) holCount++;
    } catch { /* holidays table always present since 0029 */ }
    workD -= holCount;
    const { results: ents } = await env.DB.prepare(
      `SELECT p.user_id, p.basic_cents, p.commission_cents, p.allowance_cents,
              COALESCE(p.ot_cents, 0) AS ot_cents, p.deduction_cents,
              p.worked_days, u.base_salary_cents, u.role AS user_role, u.employment_status
       FROM payroll_entries p JOIN users u ON u.id = p.user_id WHERE p.month = ?1`,
    ).bind(monthR).all<{ user_id: number; basic_cents: number; commission_cents: number; allowance_cents: number; ot_cents: number; deduction_cents: number; worked_days: number | null; base_salary_cents: number; user_role: string; employment_status: string | null }>();
    const { results: ulsR } = await env.DB.prepare(
      `SELECT user_id, COALESCE(SUM(days), 0) AS days FROM leave_requests
       WHERE type = 'unpaid' AND status = 'approved' AND start_date LIKE ?1 || '%' GROUP BY user_id`,
    ).bind(monthR).all<{ user_id: number; days: number }>();
    const ulMapR = new Map(ulsR.map((r) => [r.user_id, r.days]));
    let fixed = 0;
    for (const e of ents) {
      /* v1.4.183: hourly (part-time live host) rows re-derive from the
         attendance clock — same formula as the save route. */
      if (isHourlyUser(e.user_role, e.employment_status)) {
        const minsR = await clockedMinutes(e.user_id, monthR);
        const basicR = hourlyPayCents(minsR);
        const netHR = Math.max(0, basicR + e.commission_cents + e.allowance_cents - e.deduction_cents);
        try {
          await env.DB.prepare(
            `UPDATE payroll_entries SET basic_cents = ?1, ot_hours = NULL, ot_cents = 0,
               worked_days = NULL, month_working_days = NULL, net_cents = ?2,
               hourly_minutes = ?3, hourly_rate_cents = ?4, updated_at = datetime('now')
             WHERE user_id = ?5 AND month = ?6`,
          ).bind(basicR, netHR, minsR, PART_TIME_LH_RATE_CENTS, e.user_id, monthR).run();
          fixed++;
        } catch (errH) {
          await logError(env, "payroll_recompute", errH instanceof Error ? errH.message : String(errH));
          return err("migration_missing", "Migration 0053 is not applied — run: npx wrangler d1 migrations apply azoneofficial --remote, then press this button again.", 500);
        }
        continue;
      }
      const ul = ulMapR.get(e.user_id) ?? 0;
      const ulDed = ul > 0 ? Math.round(((e.base_salary_cents || e.basic_cents) / 26) * ul) : 0;
      const hasDaysR = e.worked_days !== null && e.worked_days !== undefined;
      let adj = 0;
      if (hasDaysR && workD > 0) {
        const adjustable = Math.max(0, Math.max(0, workD - (e.worked_days as number)) - ul);
        adj = Math.round((e.basic_cents * adjustable) / workD);
      }
      const net = Math.max(0, e.basic_cents + e.commission_cents + e.allowance_cents + e.ot_cents - e.deduction_cents - ulDed - adj);
      try {
        await env.DB.prepare(
          `UPDATE payroll_entries SET month_working_days = ?1, net_cents = ?2, updated_at = datetime('now') WHERE user_id = ?3 AND month = ?4`,
        ).bind(hasDaysR ? workD : null, net, e.user_id, monthR).run();
        fixed++;
      } catch (err2) {
        // net_cents arrives with migration 0041 — surface it instead of half-fixing
        await logError(env, "payroll_recompute", err2 instanceof Error ? err2.message : String(err2));
        return err("migration_missing", "Migration 0041 is not applied — run: npx wrangler d1 migrations apply azoneofficial --remote, then press this button again.", 500);
      }
    }
    await audit(env, user.id, "payroll.recompute", "payroll", monthR, { working_days: workD, rows: fixed });
    return json({ ok: true, month: monthR, working_days: workD, rows: fixed });
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
    // v1.4.124: the panel sends the net it computed with THE shared formula —
    // stored so /expenses can sum identical figures (no re-derivation drift).
    const netCents = typeof body.net_cents === "number" && body.net_cents >= 0 ? Math.round(body.net_cents) : null;
    /* v1.4.183: hourly (part-time live host) entries are computed by the
       SERVER from attendance, whatever the client sent — basic = minutes ×
       RM15/60, OT forced 0, no worked-days proration, net = hourly +
       commission + allowance − deduction. Tamper-proof and always in step
       with the clock records. */
    const tRow = await env.DB.prepare(`SELECT role, employment_status FROM users WHERE id = ?1`)
      .bind(body.user_id).first<{ role: string; employment_status: string | null }>();
    if (tRow && isHourlyUser(tRow.role, tRow.employment_status)) {
      const minsH = await clockedMinutes(body.user_id, month);
      const basicH = hourlyPayCents(minsH);
      const netH = Math.max(0, basicH + cents(body.commission_cents) + cents(body.allowance_cents) - cents(body.deduction_cents));
      try {
        await env.DB.prepare(
          `INSERT INTO payroll_entries (user_id, month, basic_cents, commission_cents, allowance_cents, ot_hours, ot_cents, deduction_cents, worked_days, month_working_days, net_cents, hourly_minutes, hourly_rate_cents, note, created_by)
           VALUES (?1, ?2, ?3, ?4, ?5, NULL, 0, ?6, NULL, NULL, ?7, ?8, ?9, ?10, ?11)
           ON CONFLICT (user_id, month) DO UPDATE SET
             basic_cents = ?3, commission_cents = ?4, allowance_cents = ?5,
             ot_hours = NULL, ot_cents = 0, net_cents = ?7,
             deduction_cents = ?6, worked_days = NULL, month_working_days = NULL,
             hourly_minutes = ?8, hourly_rate_cents = ?9,
             note = ?10, updated_at = datetime('now')`,
        ).bind(
          body.user_id, month, basicH, cents(body.commission_cents), cents(body.allowance_cents),
          cents(body.deduction_cents), netH, minsH, PART_TIME_LH_RATE_CENTS,
          str(body.note, 300) ? body.note : null, user.id,
        ).run();
      } catch (eH) {
        if (!String(eH).includes("no such column")) throw eH;
        return err("migration_missing", "Run: npx wrangler d1 migrations apply azoneofficial --remote (0053_hourly_payroll)", 500);
      }
      await audit(env, user.id, "payroll.save", "users", String(body.user_id), { month, hourly: true, minutes: minsH, rate_cents: PART_TIME_LH_RATE_CENTS });
      return json({ ok: true, hourly: true, minutes: minsH, basic_cents: basicH, net_cents: netH });
    }
    await env.DB.prepare(
      `INSERT INTO payroll_entries (user_id, month, basic_cents, commission_cents, allowance_cents, ot_hours, ot_cents, deduction_cents, worked_days, month_working_days, net_cents, note, created_by)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?13, ?11, ?12)
       ON CONFLICT (user_id, month) DO UPDATE SET
         basic_cents = ?3, commission_cents = ?4, allowance_cents = ?5,
         ot_hours = ?6, ot_cents = ?7, net_cents = ?13,
         deduction_cents = ?8, worked_days = ?9, month_working_days = ?10,
         note = ?11, updated_at = datetime('now')`,
    ).bind(
      body.user_id, month,
      cents(body.basic_cents), cents(body.commission_cents),
      cents(body.allowance_cents), otHours, cents(body.ot_cents),
      cents(body.deduction_cents),
      intOrNull(body.worked_days), intOrNull(body.month_working_days),
      str(body.note, 300) ? body.note : null, user.id, netCents,
    ).run();
    await audit(env, user.id, "payroll.save", "users", String(body.user_id), { month });
    return json({ ok: true });
  }

  if (path === "/attendance/export" && method === "GET") {
    if (!can(user.role, "payroll_export")) return err("forbidden", "Payroll export access required", 403);
    const url = new URL(request.url);
    const month = url.searchParams.get("month") ?? new Date().toISOString().slice(0, 7);
    const { results } = await env.DB.prepare(
      `SELECT COALESCE(NULLIF(TRIM(u.full_name), ''), u.name) AS name, u.email, u.employee_id, a.type, a.created_at
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
    if (!can(user.role, "task_reports") && !can(user.role, "exec_view")) {
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
    if (!can(user.role, "task_reports")) return err("forbidden", "HR access required", 403);
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
      `SELECT COALESCE(NULLIF(TRIM(full_name), ''), name) AS name, birthday FROM users
       WHERE birthday IS NOT NULL AND is_active = 1 AND role != 'customer'
       ORDER BY substr(birthday, 6)`,
    ).all();
    return json({ birthdays: results });
  }

  /* v1.4.263 (CEO: "if sales invoice created, inventory should be deducted to
   tally the inventory"): a product INVOICE moves stock the moment it exists.

   Only the INV deducts — a quotation is a promise, and a DO for the same sale
   would double-deduct. Lines match inventory by SKU first, then exact name
   (the product form's datalist inserts inventory names, so most lines match);
   unmatched lines are reported back, never guessed. Each deduction is logged
   in manual_stockouts with NO sale price — the revenue is counted by the PAID
   invoice (v1.4.90), so pricing the movement would count the sale twice. */
async function deductForInvoice(
  env: Env, docId: number, docNumber: string, itemsJson: string, docDate: string | null, byUser: number,
): Promise<{ deducted: { sku: string; name: string; qty: number; stock: number }[]; unmatched: string[]; short: string[] }> {
  const out = { deducted: [] as { sku: string; name: string; qty: number; stock: number }[], unmatched: [] as string[], short: [] as string[] };
  let items: { name?: string; sku?: string; qty?: number }[] = [];
  try { items = JSON.parse(itemsJson); } catch { return out; }
  for (const it of items) {
    const qty = Math.round(Number(it.qty ?? 0));
    if (!qty || qty <= 0) continue;
    const sku = (it.sku ?? "").trim();
    const name = (it.name ?? "").trim();
    const inv = await env.DB.prepare(
      sku
        ? `SELECT id, sku, name, stock FROM inventory_items WHERE UPPER(sku) = UPPER(?1) LIMIT 1`
        : `SELECT id, sku, name, stock FROM inventory_items WHERE UPPER(name) = UPPER(?1) LIMIT 1`,
    ).bind(sku || name).first<{ id: number; sku: string; name: string; stock: number }>();
    if (!inv) { if (name || sku) out.unmatched.push(name || sku); continue; }
    const newStock = Math.max(0, inv.stock - qty);
    if (inv.stock < qty) out.short.push(`${inv.sku} (had ${inv.stock}, invoice needs ${qty})`);
    // v1.4.271 audit fix: this was the ONE movement site that skipped the
    // status column and the low-stock bell — an invoice could drain a SKU to
    // zero with the row still saying in_stock and nobody notified.
    await env.DB.prepare(
      `UPDATE inventory_items SET stock = ?1,
              status = CASE WHEN ?1 = 0 THEN 'out_of_stock' WHEN ?1 <= 5 THEN 'low' ELSE 'in_stock' END
       WHERE id = ?2`,
    ).bind(newStock, inv.id).run();
    await checkLowStock(inv.id);
    const remark = `Invoice ${docNumber} — stock deducted on invoice${inv.stock < qty ? ` (SHORT: had ${inv.stock}, needed ${qty})` : ""}`;
    const args = [inv.id, inv.sku, inv.name, qty, remark, docDate, byUser];
    try {
      await env.DB.prepare(
        `INSERT INTO manual_stockouts (item_id, sku, item_name, qty, unit_sale_cents, remark, out_date, created_by, direction, doc_id)
         VALUES (?1, ?2, ?3, ?4, NULL, ?5, ?6, ?7, 'out', ?8)`,
      ).bind(...args, docId).run();
    } catch (e) {
      if (!String(e).includes("no such column")) throw e;
      /* pre-0065 (or pre-0064) skew: the stock still moves; the trail row is
         written with whatever columns exist, and restoration falls back to
         the remark prefix, which this route alone writes. */
      try {
        await env.DB.prepare(
          `INSERT INTO manual_stockouts (item_id, sku, item_name, qty, unit_sale_cents, remark, out_date, created_by, direction)
           VALUES (?1, ?2, ?3, ?4, NULL, ?5, ?6, ?7, 'out')`,
        ).bind(...args).run();
      } catch (e2) {
        if (!String(e2).includes("no such column")) throw e2;
        await env.DB.prepare(
          `INSERT INTO manual_stockouts (item_id, sku, item_name, qty, unit_sale_cents, remark, out_date, created_by)
           VALUES (?1, ?2, ?3, ?4, NULL, ?5, ?6, ?7)`,
        ).bind(...args).run();
        await logError(env, "migration_skew", "manual_stockouts missing 0064/0065 — invoice deduction logged without direction/doc_id");
      }
    }
  }
  return out;
}

/** The reverse: a deleted / reversed / re-edited invoice puts its stock back
    and removes its own trail rows (the document they belonged to is gone). */
async function restoreForInvoice(env: Env, docId: number, docNumber: string): Promise<number> {
  let rows: { id: number; item_id: number; qty: number }[] = [];
  try {
    rows = (await env.DB.prepare(
      `SELECT id, item_id, qty FROM manual_stockouts WHERE doc_id = ?1 AND direction = 'out'`,
    ).bind(docId).all<{ id: number; item_id: number; qty: number }>()).results;
  } catch (e) {
    if (!String(e).includes("no such column")) throw e;
    rows = (await env.DB.prepare(
      `SELECT id, item_id, qty FROM manual_stockouts WHERE remark LIKE ?1`,
    ).bind(`Invoice ${docNumber} — stock deducted on invoice%`).all<{ id: number; item_id: number; qty: number }>()).results;
  }
  for (const r of rows) {
    // v1.4.271 audit fix: restoring stock also refreshes status and lets the
    // low-stock alert RESET (checkLowStock re-arms above 5).
    await env.DB.prepare(
      `UPDATE inventory_items SET stock = stock + ?1,
              status = CASE WHEN stock + ?1 = 0 THEN 'out_of_stock' WHEN stock + ?1 <= 5 THEN 'low' ELSE 'in_stock' END
       WHERE id = ?2`,
    ).bind(r.qty, r.item_id).run();
    await checkLowStock(Number(r.item_id));
    await env.DB.prepare(`DELETE FROM manual_stockouts WHERE id = ?1`).bind(r.id).run();
  }
  return rows.length;
}

/* v1.5.0: trendsMY (Google Trends) removed with the Social tab. */

/* ---- Sales & marketing: inventory ---- */

  if (path === "/inventory" && method === "GET") {
    if (!can(user.role, "inventory") && !can(user.role, "exec_view")) {
      return err("forbidden", "Inventory access required", 403);
    }
    const { results } = await env.DB.prepare(
      `SELECT i.*, u.name AS updated_by_name FROM inventory_items i
       LEFT JOIN users u ON u.id = i.updated_by ORDER BY i.name`,
    ).all();
    return json({ items: results });
  }
  /* v1.4.172 (CEO): manual stock-out lifecycle. A shared sale-row locator —
     prefers the sale_id link; legacy rows (pre-0050) fall back to an exact
     field match. Revenue totals stay in step with every action. */
  const findManualSaleId = async (row: { sale_id?: number | null; item_id: number; qty: number; unit_sale_cents?: number | null; created_at: string }): Promise<number | null> => {
    if (row.sale_id) return row.sale_id;
    if (row.unit_sale_cents == null) return null;
    try {
      const m = await env.DB.prepare(
        `SELECT id FROM manual_sales WHERE item_id = ?1 AND qty = ?2 AND unit_sale_cents = ?3 AND created_at = ?4 LIMIT 1`,
      ).bind(row.item_id, row.qty, row.unit_sale_cents, row.created_at).first<{ id: number }>();
      return m?.id ?? null;
    } catch { return null; }
  };
  const moMatch = path.match(/^\/inventory\/manual-outs\/(\d+)\/(edit|revert|delete)$/);
  if (moMatch && method === "POST") {
    if (!can(user.role, "inventory")) return err("forbidden", "Inventory access required", 403);
    let row: { id: number; item_id: number; qty: number; unit_sale_cents: number | null; remark: string; created_at: string; sale_id?: number | null; reverted?: number | null; out_date?: string | null } | null = null;
    try {
      row = await env.DB.prepare(`SELECT * FROM manual_stockouts WHERE id = ?1`).bind(moMatch[1]).first();
    } catch { /* pre-0049 */ }
    if (!row) return err("not_found", "Stock-out record not found", 404);
    const action = moMatch[2];
    const isReverted = (row.reverted ?? 0) === 1;
    if (action === "revert") {
      if (isReverted) return err("invalid_state", "Already reverted — the stock is back on the shelf", 400);
      const item = await env.DB.prepare(`SELECT stock FROM inventory_items WHERE id = ?1`).bind(row.item_id).first<{ stock: number }>();
      if (!item) return err("not_found", "The inventory item behind this record no longer exists", 409);
      const back = item.stock + row.qty;
      await env.DB.prepare(
        `UPDATE inventory_items SET stock = ?1, status = ?2, updated_by = ?3, updated_at = datetime('now') WHERE id = ?4`,
      ).bind(back, stockStatus(back), user.id, row.item_id).run();
      const sid = await findManualSaleId(row);
      if (sid) await env.DB.prepare(`DELETE FROM manual_sales WHERE id = ?1`).bind(sid).run();
      try {
        await env.DB.prepare(`UPDATE manual_stockouts SET reverted = 1 WHERE id = ?1`).bind(row.id).run();
      } catch {
        return err("migration_missing", "Run: npx wrangler d1 migrations apply azoneofficial --remote (0050_manual_out_lifecycle)", 500);
      }
      await checkLowStock(row.item_id); // v1.4.191 (recovery resets the alert)
      await audit(env, user.id, "inventory.manual_out_revert", "manual_stockouts", String(row.id),
        { qty: row.qty, unit_sale_cents: row.unit_sale_cents, sale_removed: !!sid });
      return json({ ok: true, stock: back });
    }
    if (action === "delete") {
      /* v1.21.7 (CEO: "I want to have access to delete it from my inventory
         and database. only roles CEO & COO can do this while the rest no
         access") — supersedes the v1.21.4 blanket retirement. Two rules,
         both from his words:
         1. WHO: ceo / coo (+ super_admin safety net) only. Everyone else
            gets 403 and no button in the UI.
         2. WHAT: the record (and its linked manual sale, so the sales
            totals follow) is removed from the database — but the shelf
            quantity is NEVER touched. The v1.21.4 finding stands: a delete
            that silently pushed stock back made inventory inaccurate.
            Revert remains the one way stock moves back.
         The audit row keeps a full snapshot of what was removed. */
      if (!["super_admin", "ceo", "coo"].includes(user.role)) {
        return err("forbidden", "Only the CEO or COO can delete stock movement records", 403);
      }
      const sid = await findManualSaleId(row);
      if (sid) await env.DB.prepare(`DELETE FROM manual_sales WHERE id = ?1`).bind(sid).run();
      await env.DB.prepare(`DELETE FROM manual_stockouts WHERE id = ?1`).bind(row.id).run();
      await audit(env, user.id, "inventory.manual_out_delete", "manual_stockouts", String(row.id), {
        snapshot: { item_id: row.item_id, qty: row.qty, unit_sale_cents: row.unit_sale_cents, remark: row.remark, out_date: row.out_date ?? null, created_at: row.created_at, was_reverted: isReverted },
        sale_removed: !!sid,
        stock_untouched: true,
      });
      return json({ ok: true });
    }
    // action === "edit"
    if (isReverted) return err("invalid_state", "Reverted records can't be edited — record a fresh stock out instead", 400);
    const newQty = typeof body?.qty === "number" && Math.floor(body.qty) > 0 ? Math.floor(body.qty) : null;
    const priceGiven = body?.sale_price !== undefined; // "" clears the sale
    const newSaleC = priceGiven && `${body!.sale_price}` !== "" && Number.isFinite(Number(body!.sale_price)) && Number(body!.sale_price) >= 0
      ? Math.round(Number(body!.sale_price) * 100) : null;
    const newRemark = str(body?.remark, 300) ? (body!.remark as string).trim() : null;
    const newDate = str(body?.out_date, 10) && /^\d{4}-\d{2}-\d{2}$/.test(body!.out_date as string) ? (body!.out_date as string) : null;
    if (newQty === null && !priceGiven && !newRemark && !newDate) return err("invalid_input", "Nothing to update", 400);
    if (newQty !== null && newQty !== row.qty) {
      const item = await env.DB.prepare(`SELECT stock FROM inventory_items WHERE id = ?1`).bind(row.item_id).first<{ stock: number }>();
      if (!item) return err("not_found", "The inventory item behind this record no longer exists", 409);
      const diff = newQty - row.qty; // positive = take MORE out
      if (diff > 0 && item.stock < diff) {
        return err("insufficient_stock", `Only ${item.stock} in stock — cannot raise the out by ${diff}`, 409);
      }
      const adj = item.stock - diff;
      await env.DB.prepare(
        `UPDATE inventory_items SET stock = ?1, status = ?2, updated_by = ?3, updated_at = datetime('now') WHERE id = ?4`,
      ).bind(adj, stockStatus(adj), user.id, row.item_id).run();
    }
    const qtyF = newQty ?? row.qty;
    const saleF = priceGiven ? newSaleC : (row.unit_sale_cents ?? null);
    const dateF = newDate ?? row.out_date ?? null;
    // Sync the manual_sales row: update / create / remove to match saleF.
    const sid = await findManualSaleId(row);
    let sidF: number | null = sid;
    if (saleF !== null) {
      if (sid) {
        await env.DB.prepare(
          `UPDATE manual_sales SET qty = ?1, unit_sale_cents = ?2, total_cents = ?3 WHERE id = ?4`,
        ).bind(qtyF, saleF, qtyF * saleF, sid).run();
        if (dateF) { try { await env.DB.prepare(`UPDATE manual_sales SET out_date = ?1 WHERE id = ?2`).bind(dateF, sid).run(); } catch { /* pre-0050 */ } }
      } else {
        const snap = await env.DB.prepare(`SELECT sku, name FROM inventory_items WHERE id = ?1`).bind(row.item_id).first<{ sku: string; name: string }>();
        try {
          const sr = await env.DB.prepare(
            `INSERT INTO manual_sales (item_id, sku, item_name, qty, unit_sale_cents, total_cents, out_date, created_by)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8) RETURNING id`,
          ).bind(row.item_id, snap?.sku ?? null, snap?.name ?? null, qtyF, saleF, qtyF * saleF, dateF, user.id).first<{ id: number }>();
          sidF = sr?.id ?? null;
        } catch {
          const sr = await env.DB.prepare(
            `INSERT INTO manual_sales (item_id, sku, item_name, qty, unit_sale_cents, total_cents, created_by)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) RETURNING id`,
          ).bind(row.item_id, snap?.sku ?? null, snap?.name ?? null, qtyF, saleF, qtyF * saleF, user.id).first<{ id: number }>();
          sidF = sr?.id ?? null;
        }
      }
    } else if (sid) {
      await env.DB.prepare(`DELETE FROM manual_sales WHERE id = ?1`).bind(sid).run();
      sidF = null;
    }
    try {
      await env.DB.prepare(
        `UPDATE manual_stockouts SET qty = ?1, unit_sale_cents = ?2, remark = COALESCE(?3, remark),
           out_date = COALESCE(?4, out_date), sale_id = ?5 WHERE id = ?6`,
      ).bind(qtyF, saleF, newRemark, newDate, sidF, row.id).run();
    } catch {
      return err("migration_missing", "Run: npx wrangler d1 migrations apply azoneofficial --remote (0050_manual_out_lifecycle)", 500);
    }
    await checkLowStock(row.item_id); // v1.4.191
    await audit(env, user.id, "inventory.manual_out_edit", "manual_stockouts", String(row.id), {
      from: { qty: row.qty, unit_sale_cents: row.unit_sale_cents, out_date: row.out_date ?? null },
      to: { qty: qtyF, unit_sale_cents: saleF, out_date: dateF },
    });
    return json({ ok: true });
  }
  if (path === "/inventory/manual-outs" && method === "GET") {
    // v1.4.170: the traceability list — last 100 manual stock-outs with the
    // remark and who recorded them. Empty (not an error) before 0049.
    if (!can(user.role, "inventory") && !can(user.role, "exec_view")) {
      return err("forbidden", "Inventory access required", 403);
    }
    try {
      const { results } = await env.DB.prepare(
        `SELECT m.*, u.name AS created_by_name FROM manual_stockouts m
         LEFT JOIN users u ON u.id = m.created_by
         ORDER BY m.created_at DESC LIMIT 100`,
      ).all();
      return json({ outs: results });
    } catch {
      return json({ outs: [] });
    }
  }
  if (path === "/inventory/tiktok-out" && method === "GET") {
    /* v1.4.165 (CEO: "how I will know which item are out during live sales in
       TikTok?") — per-item stock OUT that came from TikTok orders. Source of
       truth = postage_items joined to TT- postage records (exactly the rows
       the sync/webhook wrote when it deducted stock); returned orders
       excluded. Today + this month are Malaysia time. */
    if (!can(user.role, "inventory") && !can(user.role, "exec_view")) {
      return err("forbidden", "Inventory access required", 403);
    }
    const nowMYT = new Date(Date.now() + 8 * 3600 * 1000);
    const todayD = nowMYT.toISOString().slice(0, 10);
    const monthD = todayD.slice(0, 7);
    // v1.4.166: also the ACTUAL average sold price per unit (from TikTok's
    // sale_price on each movement) and this month's sold value — so rebate
    // vs list price is visible per item without any manual entry. Falls back
    // to the plain query before migration 0047 lands.
    let results: unknown[];
    try {
      const r = await env.DB.prepare(
        `SELECT pi.inventory_item_id AS id, i.sku, i.name, i.stock, i.unit_price_cents,
                SUM(CASE WHEN date(p.created_at, '+8 hours') = ?1 THEN pi.qty ELSE 0 END) AS today_qty,
                SUM(CASE WHEN strftime('%Y-%m', p.created_at, '+8 hours') = ?2 THEN pi.qty ELSE 0 END) AS month_qty,
                SUM(pi.qty) AS total_qty,
                CAST(ROUND(AVG(pi.unit_sale_cents)) AS INTEGER) AS avg_sale_cents,
                SUM(CASE WHEN strftime('%Y-%m', p.created_at, '+8 hours') = ?2 THEN pi.qty * COALESCE(pi.unit_sale_cents, 0) ELSE 0 END) AS month_value_cents,
                MAX(p.created_at) AS last_at
         FROM postage_items pi
         JOIN postage_records p ON p.id = pi.postage_id
         JOIN inventory_items i ON i.id = pi.inventory_item_id
         WHERE p.order_ref LIKE 'TT-%' AND p.status != 'returned'
         GROUP BY pi.inventory_item_id, i.sku, i.name, i.stock, i.unit_price_cents
         ORDER BY today_qty DESC, month_qty DESC, i.name`,
      ).bind(todayD, monthD).all();
      results = r.results;
    } catch {
      const r = await env.DB.prepare(
        `SELECT pi.inventory_item_id AS id, i.sku, i.name, i.stock,
                SUM(CASE WHEN date(p.created_at, '+8 hours') = ?1 THEN pi.qty ELSE 0 END) AS today_qty,
                SUM(CASE WHEN strftime('%Y-%m', p.created_at, '+8 hours') = ?2 THEN pi.qty ELSE 0 END) AS month_qty,
                SUM(pi.qty) AS total_qty,
                MAX(p.created_at) AS last_at
         FROM postage_items pi
         JOIN postage_records p ON p.id = pi.postage_id
         JOIN inventory_items i ON i.id = pi.inventory_item_id
         WHERE p.order_ref LIKE 'TT-%' AND p.status != 'returned'
         GROUP BY pi.inventory_item_id, i.sku, i.name, i.stock
         ORDER BY today_qty DESC, month_qty DESC, i.name`,
      ).bind(todayD, monthD).all();
      results = r.results;
    }
    return json({ today: todayD, month: monthD, items: results });
  }
  if (path === "/inventory" && method === "POST") {
    if (!can(user.role, "inventory")) return err("forbidden", "Inventory access required", 403);
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
    if (!can(user.role, "inventory")) return err("forbidden", "Inventory access required", 403);
    if (!body || typeof body.stock !== "number" || body.stock < 0) {
      return err("invalid_input", "stock (>= 0) is required", 400);
    }
    const stock = Math.floor(body.stock);
    const priceU = typeof body.unit_price === "number" && body.unit_price >= 0 ? Math.round(body.unit_price * 100) : null; // v1.4.101
    // v1.4.164: rebate given during TikTok Live — net live price = price − rebate.
    const rebateU = typeof body.live_rebate === "number" && body.live_rebate >= 0 ? Math.round(body.live_rebate * 100) : null;
    try {
      if (rebateU !== null) {
        await env.DB.prepare(
          `UPDATE inventory_items SET stock = ?1, status = ?2,
             note = COALESCE(?3, note), unit_price_cents = COALESCE(?4, unit_price_cents),
             live_rebate_cents = ?5,
             updated_by = ?6, updated_at = datetime('now')
           WHERE id = ?7`,
        ).bind(stock, stockStatus(stock), str(body.note, 500) ? body.note : null, priceU, rebateU, user.id, invMatch[1]).run();
      } else {
        await env.DB.prepare(
          `UPDATE inventory_items SET stock = ?1, status = ?2,
             note = COALESCE(?3, note), unit_price_cents = COALESCE(?4, unit_price_cents),
             updated_by = ?5, updated_at = datetime('now')
           WHERE id = ?6`,
        ).bind(stock, stockStatus(stock), str(body.note, 500) ? body.note : null, priceU, user.id, invMatch[1]).run();
      }
    } catch (e) {
      if (String(e).includes("no such column")) {
        return err("migration_missing", "Run: npx wrangler d1 migrations apply azoneofficial --remote (0046_live_rebate)", 500);
      }
      throw e;
    }
    await audit(env, user.id, "inventory.update", "inventory_items", invMatch[1]);
      await checkLowStock(Number(invMatch[1]));
    return json({ ok: true });
  }
  /* v1.4.162 (CEO): fix a wrongly inserted item — edit SKU/name, or delete
     the row entirely. Deletion is blocked once shipment history exists
     (postage_items) or a supplier return references it: those records join
     the item by id, so removing it would orphan real movements — the CEO
     edits instead. */
  const invEdit = path.match(/^\/inventory\/(\d+)\/edit$/);
  if (invEdit && method === "POST") {
    if (!can(user.role, "inventory")) return err("forbidden", "Inventory access required", 403);
    const newSku = str(body?.sku, 60) ? (body!.sku as string).trim() : null;
    const newName = str(body?.name, 200) ? (body!.name as string).trim() : null;
    if (!newSku && !newName) return err("invalid_input", "Provide a sku and/or name to update", 400);
    const target = await env.DB.prepare(`SELECT id, sku, name FROM inventory_items WHERE id = ?1`)
      .bind(invEdit[1]).first<{ id: number; sku: string; name: string }>();
    if (!target) return err("not_found", "Item not found", 404);
    if (newSku) {
      const clash = await env.DB.prepare(
        `SELECT id FROM inventory_items WHERE lower(trim(sku)) = lower(?1) AND id != ?2 LIMIT 1`,
      ).bind(newSku.toLowerCase(), target.id).first<{ id: number }>();
      if (clash) return err("conflict", "Another item already uses this SKU", 409);
    }
    await env.DB.prepare(
      `UPDATE inventory_items SET sku = COALESCE(?1, sku), name = COALESCE(?2, name),
         updated_by = ?3, updated_at = datetime('now') WHERE id = ?4`,
    ).bind(newSku, newName, user.id, target.id).run();
    await audit(env, user.id, "inventory.edit", "inventory_items", String(target.id),
      { from: { sku: target.sku, name: target.name }, to: { sku: newSku ?? target.sku, name: newName ?? target.name } });
    return json({ ok: true });
  }
  const invDelete = path.match(/^\/inventory\/(\d+)\/delete$/);
  if (invDelete && method === "POST") {
    if (!can(user.role, "inventory")) return err("forbidden", "Inventory access required", 403);
    const target = await env.DB.prepare(`SELECT id, sku, name, stock FROM inventory_items WHERE id = ?1`)
      .bind(invDelete[1]).first<{ id: number; sku: string; name: string; stock: number }>();
    if (!target) return err("not_found", "Item not found", 404);
    const shipped = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM postage_items WHERE inventory_item_id = ?1`,
    ).bind(target.id).first<{ n: number }>();
    if ((shipped?.n ?? 0) > 0) {
      return err("has_history", "This item has shipment history — its records reference it, so edit the SKU/name instead of deleting.", 409);
    }
    let returned = 0;
    try {
      const ret = await env.DB.prepare(
        `SELECT COUNT(*) AS n FROM supplier_returns WHERE item_id = ?1`,
      ).bind(target.id).first<{ n: number }>();
      returned = ret?.n ?? 0;
    } catch { /* 0042 not applied — nothing referencing */ }
    if (returned > 0) {
      return err("has_history", "This item has supplier-return records — edit the SKU/name instead of deleting.", 409);
    }
    await env.DB.prepare(`DELETE FROM inventory_items WHERE id = ?1`).bind(target.id).run();
    await audit(env, user.id, "inventory.delete", "inventory_items", String(target.id),
      { sku: target.sku, name: target.name, stock: target.stock });
    return json({ ok: true });
  }

  /* ---- Sales & marketing: postage tracking ---- */

  if (path === "/postage" && method === "GET") {
    if (!can(user.role, "inventory") && !can(user.role, "exec_view")) {
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
    if (!can(user.role, "inventory")) return err("forbidden", "Access required", 403);
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
    // v1.4.169 (CEO): non-TikTok orders carry their sales value too, so the
    // revenue totals can count EVERY channel, not just TikTok + invoices.
    const amtRaw = Number(body.order_amount);
    const amtC = Number.isFinite(amtRaw) && amtRaw >= 0 && body.order_amount !== undefined && body.order_amount !== null && `${body.order_amount}` !== ""
      ? Math.round(amtRaw * 100) : null;
    const rec = await env.DB.prepare(
      `INSERT INTO postage_records (order_ref, courier, tracking_no, status, note, order_amount_cents, updated_by)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) RETURNING id`,
    ).bind(
      body.order_ref,
      str(body.courier, 80) ? body.courier : null,
      str(body.tracking_no, 120) ? body.tracking_no : null,
      POSTAGE_STATUSES.includes(body.status as string) ? (body.status as string) : "preparing",
      str(body.note, 500) ? body.note : null,
      amtC,
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
      await checkLowStock(l.id); // v1.4.191
    }
    await audit(env, user.id, "postage.create", "postage_records", String(rec?.id), { lines: lines.length });
    return json({ ok: true, id: rec?.id }, 201);
  }
  const postMatch = path.match(/^\/postage\/(\d+)$/);
  if (postMatch && method === "PATCH") {
    if (!can(user.role, "inventory")) return err("forbidden", "Access required", 403);
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
      await checkLowStock(Number(l.inventory_item_id));
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
    if (!can(user.role, "inventory")) return err("forbidden", "Inventory access required", 403);
    const delta = typeof body?.delta === "number" ? Math.trunc(body.delta) : 0;
    if (!delta) return err("invalid_input", "delta (non-zero integer) is required", 400);
    /* v1.4.169 (CEO: "if there is any manual out without any rebate how do I
       know the total sales?"): an optional sold price on a manual OUT makes
       it a SALE — recorded in manual_sales and counted in the revenue
       totals. Without a price it stays a plain correction (damage/samples)
       and is deliberately excluded so corrections never inflate sales. */
    const saleRaw = Number(body?.sale_price);
    const saleC = delta < 0 && Number.isFinite(saleRaw) && saleRaw >= 0 && body?.sale_price !== undefined && body?.sale_price !== null && `${body?.sale_price}` !== ""
      ? Math.round(saleRaw * 100) : null;
    /* v1.4.170 (CEO: "Remark of the reason why stock out to traceability
       purposes"): every manual OUT must say why — remark is MANDATORY and
       logged to manual_stockouts, so no stock leaves the shelf unexplained. */
    const remark = str(body?.remark, 300) ? (body!.remark as string).trim() : null;
    /* v1.4.251 (CEO: "if I want to adjust the variance … what should remark I
       need to indicate?"): a stock movement is only traceable if BOTH
       directions say why. An IN with no reason is how a stock count quietly
       becomes a guess, so the remark is now mandatory either way. */
    if (!remark) {
      return err("invalid_input", `A remark (reason for the stock ${delta < 0 ? "out" : "in"}) is required — for traceability`, 400);
    }
    if (saleC !== null) {
      const tbl = await env.DB.prepare(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'manual_sales'`,
      ).first<{ name: string }>();
      if (!tbl) return err("migration_missing", "Run: npx wrangler d1 migrations apply azoneofficial --remote (0048_manual_sales)", 500);
    }
    {
      const tbl2 = await env.DB.prepare(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'manual_stockouts'`,
      ).first<{ name: string }>();
      if (!tbl2) return err("migration_missing", "Run: npx wrangler d1 migrations apply azoneofficial --remote (0049_manual_stockouts)", 500);
    }
    const item = await env.DB.prepare(
      `SELECT stock, name, sku FROM inventory_items WHERE id = ?1`,
    ).bind(invAdjust[1]).first<{ stock: number; name: string; sku: string }>();
    if (!item) return err("not_found", "Item not found", 404);
    const newStock = item.stock + delta;
    if (newStock < 0) {
      return err("insufficient_stock", `Only ${item.stock} in stock for ${item.name} — cannot remove ${-delta}`, 409);
    }
    await env.DB.prepare(
      `UPDATE inventory_items SET stock = ?1, status = ?2, updated_by = ?3, updated_at = datetime('now') WHERE id = ?4`,
    ).bind(newStock, stockStatus(newStock), user.id, invAdjust[1]).run();
    // v1.4.172: the date the stock actually went out — backdatable from the
    // modal; defaults to today MYT. Sales totals attribute by this date.
    const outDate = str(body?.out_date, 10) && /^\d{4}-\d{2}-\d{2}$/.test(body!.out_date as string)
      ? (body!.out_date as string)
      : new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
    let saleRowId: number | null = null;
    if (saleC !== null) {
      const qty = Math.abs(delta);
      try {
        const sr = await env.DB.prepare(
          `INSERT INTO manual_sales (item_id, sku, item_name, qty, unit_sale_cents, total_cents, out_date, created_by)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8) RETURNING id`,
        ).bind(Number(invAdjust[1]), item.sku, item.name, qty, saleC, qty * saleC, outDate, user.id).first<{ id: number }>();
        saleRowId = sr?.id ?? null;
      } catch (e) {
        if (!String(e).includes("no such column")) throw e;
        const sr = await env.DB.prepare(
          `INSERT INTO manual_sales (item_id, sku, item_name, qty, unit_sale_cents, total_cents, created_by)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) RETURNING id`,
        ).bind(Number(invAdjust[1]), item.sku, item.name, qty, saleC, qty * saleC, user.id).first<{ id: number }>();
        saleRowId = sr?.id ?? null;
      }
    }
    /* v1.4.170: the traceability trail — one row per manual movement, with
       WHY. v1.4.251: ins are logged here too, marked by `direction`. */
    {
      const args = [Number(invAdjust[1]), item.sku, item.name, Math.abs(delta), saleC, remark, outDate, saleRowId, user.id];
      try {
        await env.DB.prepare(
          `INSERT INTO manual_stockouts (item_id, sku, item_name, qty, unit_sale_cents, remark, out_date, sale_id, created_by, direction)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
        ).bind(...args, delta > 0 ? "in" : "out").run();
      } catch (e) {
        if (!String(e).includes("no such column")) throw e;
        /* 0064 skew: an OUT still logs the old way, but an IN must NOT — an
           unmarked row would read as a stock OUT and corrupt the totals. The
           stock still moves; only its trail row waits for the migration. */
        if (delta < 0) {
          try {
            await env.DB.prepare(
              `INSERT INTO manual_stockouts (item_id, sku, item_name, qty, unit_sale_cents, remark, out_date, sale_id, created_by)
               VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
            ).bind(...args).run();
          } catch (e2) {
            if (!String(e2).includes("no such column")) throw e2;
            await env.DB.prepare(
              `INSERT INTO manual_stockouts (item_id, sku, item_name, qty, unit_sale_cents, remark, created_by)
               VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
            ).bind(Number(invAdjust[1]), item.sku, item.name, Math.abs(delta), saleC, remark, user.id).run();
          }
        } else {
          await logError(env, "migration_skew", "manual_stockouts missing 0064 direction — stock in not logged");
        }
      }
    }
    await audit(env, user.id, delta > 0 ? "inventory.in" : "inventory.out", "inventory_items", invAdjust[1],
      saleC !== null ? { qty: Math.abs(delta), unit_sale_cents: saleC, total_cents: Math.abs(delta) * saleC, manual_sale: true, remark } : { qty: Math.abs(delta), remark });
    await checkLowStock(Number(invAdjust[1])); // v1.4.191
    return json({ ok: true, stock: newStock, status: stockStatus(newStock), sale_recorded: saleC !== null });
  }

  /* ---- Supplier returns (v1.4.148): rejected stock back to the supplier,
          costing tracked for the claim-back ---- */

  if (path === "/inventory/returns" && method === "GET") {
    if (!can(user.role, "inventory") && !can(user.role, "exec_view")) {
      return err("forbidden", "Inventory access required", 403);
    }
    try {
      const { results } = await env.DB.prepare(
        `SELECT r.*, u.name AS created_by_name FROM supplier_returns r
         LEFT JOIN users u ON u.id = r.created_by
         ORDER BY r.return_date DESC, r.id DESC LIMIT 200`,
      ).all<{ total_cents: number; status: string; credited_cents: number | null; qty: number; unit_cost_cents: number; replaced_qty?: number | null }>();
      let total = 0, credited = 0, replacedV = 0;
      for (const r of results) {
        total += r.total_cents;
        if (r.status === "credited") credited += r.credited_cents ?? r.total_cents;
        // v1.4.149: replacement resolves value in goods rather than money
        replacedV += (r.replaced_qty ?? 0) * r.unit_cost_cents;
      }
      const outstanding = Math.max(0, total - credited - replacedV);
      return json({ returns: results, totals: { total_cents: total, credited_cents: credited, replaced_cents: replacedV, outstanding_cents: outstanding } });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("no such table")) {
        return err("migration_missing", "Run: npx wrangler d1 migrations apply azoneofficial --remote (0042_supplier_returns)", 500);
      }
      throw e;
    }
  }
  if (path === "/inventory/returns" && method === "POST") {
    if (!can(user.role, "inventory")) return err("forbidden", "Inventory access required", 403);
    const qty = typeof body?.qty === "number" ? Math.floor(body.qty) : 0;
    const itemId = typeof body?.item_id === "number" ? body.item_id : 0;
    if (!itemId || qty <= 0 || !str(body?.supplier, 120) || !str(body?.return_date, 10)) {
      return err("invalid_input", "item_id, qty (>0), supplier and return_date are required", 400);
    }
    const item = await env.DB.prepare(
      `SELECT sku, name, stock, unit_price_cents FROM inventory_items WHERE id = ?1`,
    ).bind(itemId).first<{ sku: string; name: string; stock: number; unit_price_cents: number | null }>();
    if (!item) return err("not_found", "Item not found", 404);
    if (qty > item.stock) {
      return err("insufficient_stock", `Only ${item.stock} in stock for ${item.name} — cannot return ${qty}`, 409);
    }
    const unitC = typeof body.unit_cost === "number" && body.unit_cost >= 0
      ? Math.round(body.unit_cost * 100)
      : (item.unit_price_cents ?? 0);
    const totalC = unitC * qty;
    // Stock leaves the shelf the moment it's boxed for the supplier.
    const newStock = item.stock - qty;
    await env.DB.prepare(
      `UPDATE inventory_items SET stock = ?1, status = ?2, updated_by = ?3, updated_at = datetime('now') WHERE id = ?4`,
    ).bind(newStock, stockStatus(newStock), user.id, itemId).run();
    const res = await env.DB.prepare(
      `INSERT INTO supplier_returns (item_id, sku, item_name, qty, unit_cost_cents, total_cents, supplier, reason, return_date, created_by)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10) RETURNING id`,
    ).bind(itemId, item.sku, item.name, qty, unitC, totalC, body.supplier, str(body.reason, 300) ? body.reason : null, body.return_date, user.id).first<{ id: number }>();
    await audit(env, user.id, "inventory.supplier_return", "supplier_returns", res?.id != null ? String(res.id) : undefined, { qty, total_cents: totalC });
    return json({ ok: true, id: res?.id, stock: newStock }, 201);
  }
  /* v1.4.164 (CEO): edit an OUTSTANDING supplier return — qty, unit cost,
     supplier, date, reason. Settled or partially replaced rows are locked
     (money/goods already moved). A qty change moves stock by the difference:
     lowering the qty puts pieces back on the shelf; raising it boxes more
     (refused if the shelf doesn't have them). Total recomputes. */
  const retEdit = path.match(/^\/inventory\/returns\/(\d+)\/edit$/);
  if (retEdit && method === "POST") {
    if (!can(user.role, "inventory")) return err("forbidden", "Inventory access required", 403);
    const row = await env.DB.prepare(`SELECT * FROM supplier_returns WHERE id = ?1`)
      .bind(retEdit[1]).first<{ id: number; item_id: number; qty: number; unit_cost_cents: number; total_cents: number; supplier: string; reason: string | null; return_date: string; status: string; replaced_qty?: number | null }>();
    if (!row) return err("not_found", "Return not found", 404);
    if (row.status !== "outstanding" || (row.replaced_qty ?? 0) > 0) {
      return err("invalid_state", "Credited or replaced returns are locked — the money/goods already moved. Record a fresh return instead.", 400);
    }
    const newQty = typeof body?.qty === "number" && Math.floor(body.qty) > 0 ? Math.floor(body.qty) : null;
    const newUnit = typeof body?.unit_cost === "number" && body.unit_cost >= 0 ? Math.round(body.unit_cost * 100) : null;
    const newSupplier = str(body?.supplier, 120) ? (body!.supplier as string) : null;
    const newReason = str(body?.reason, 300) ? (body!.reason as string) : null;
    const newDate = str(body?.return_date, 10) ? (body!.return_date as string) : null;
    if (newQty === null && newUnit === null && !newSupplier && !newReason && !newDate) {
      return err("invalid_input", "Nothing to update", 400);
    }
    if (newQty !== null && newQty !== row.qty) {
      const item = await env.DB.prepare(`SELECT stock FROM inventory_items WHERE id = ?1`)
        .bind(row.item_id).first<{ stock: number }>();
      if (!item) return err("not_found", "The inventory item behind this return no longer exists", 409);
      const delta = newQty - row.qty; // positive = box MORE (deduct), negative = put back
      if (delta > 0 && item.stock < delta) {
        return err("insufficient_stock", `Only ${item.stock} in stock — cannot raise the return by ${delta}`, 409);
      }
      const adjStock = item.stock - delta;
      await env.DB.prepare(
        `UPDATE inventory_items SET stock = ?1, status = ?2, updated_by = ?3, updated_at = datetime('now') WHERE id = ?4`,
      ).bind(adjStock, stockStatus(adjStock), user.id, row.item_id).run();
    }
    const qtyF = newQty ?? row.qty;
    const unitF = newUnit ?? row.unit_cost_cents;
    const totalF = qtyF * unitF;
    await env.DB.prepare(
      `UPDATE supplier_returns SET qty = ?1, unit_cost_cents = ?2, total_cents = ?3,
         supplier = COALESCE(?4, supplier), reason = COALESCE(?5, reason), return_date = COALESCE(?6, return_date)
       WHERE id = ?7`,
    ).bind(qtyF, unitF, totalF, newSupplier, newReason, newDate, row.id).run();
    await audit(env, user.id, "inventory.supplier_return_edit", "supplier_returns", String(row.id), {
      from: { qty: row.qty, unit_cost_cents: row.unit_cost_cents, total_cents: row.total_cents },
      to: { qty: qtyF, unit_cost_cents: unitF, total_cents: totalF },
    });
    return json({ ok: true, total_cents: totalF });
  }
  const retCredit = path.match(/^\/inventory\/returns\/(\d+)\/credit$/);
  if (retCredit && method === "POST") {
    if (!can(user.role, "inventory")) return err("forbidden", "Inventory access required", 403);
    const row = await env.DB.prepare(`SELECT status, total_cents FROM supplier_returns WHERE id = ?1`)
      .bind(retCredit[1]).first<{ status: string; total_cents: number }>();
    if (!row) return err("not_found", "Return not found", 404);
    if (row.status === "credited") return err("invalid_state", "Already marked credited", 400);
    const credC = typeof body?.credited === "number" && body.credited >= 0
      ? Math.round(body.credited * 100)
      : row.total_cents;
    await env.DB.prepare(
      `UPDATE supplier_returns SET status = 'credited', credited_at = datetime('now'), credited_cents = ?1 WHERE id = ?2`,
    ).bind(credC, retCredit[1]).run();
    await audit(env, user.id, "inventory.supplier_return_credited", "supplier_returns", retCredit[1], { credited_cents: credC });
    return json({ ok: true });
  }
  const retReplace = path.match(/^\/inventory\/returns\/(\d+)\/replace$/);
  if (retReplace && method === "POST") {
    // v1.4.149: the supplier sent replacement goods — stock walks back onto
    // the shelf and the claim shrinks by the replaced value. Partial
    // deliveries accumulate; the row closes as 'replaced' when complete.
    if (!can(user.role, "inventory")) return err("forbidden", "Inventory access required", 403);
    const row = await env.DB.prepare(
      `SELECT status, item_id, qty, unit_cost_cents, COALESCE(replaced_qty, 0) AS replaced_qty FROM supplier_returns WHERE id = ?1`,
    ).bind(retReplace[1]).first<{ status: string; item_id: number; qty: number; unit_cost_cents: number; replaced_qty: number }>();
    if (!row) return err("not_found", "Return not found", 404);
    if (row.status === "credited") return err("invalid_state", "Already resolved by credit", 400);
    const remaining = row.qty - row.replaced_qty;
    if (remaining <= 0) return err("invalid_state", "Already fully replaced", 400);
    const q = typeof body?.qty === "number" && body.qty > 0 ? Math.floor(body.qty) : remaining;
    if (q > remaining) {
      return err("invalid_input", `Only ${remaining} of ${row.qty} still awaiting replacement`, 400);
    }
    const item = await env.DB.prepare(`SELECT stock FROM inventory_items WHERE id = ?1`)
      .bind(row.item_id).first<{ stock: number }>();
    if (item) {
      const back = item.stock + q;
      await env.DB.prepare(
        `UPDATE inventory_items SET stock = ?1, status = ?2, updated_by = ?3, updated_at = datetime('now') WHERE id = ?4`,
      ).bind(back, stockStatus(back), user.id, row.item_id).run();
    }
    const newReplaced = row.replaced_qty + q;
    const done = newReplaced >= row.qty;
    await env.DB.prepare(
      `UPDATE supplier_returns SET replaced_qty = ?1, replaced_at = datetime('now'),
         status = CASE WHEN ?2 THEN 'replaced' ELSE status END
       WHERE id = ?3`,
    ).bind(newReplaced, done ? 1 : 0, retReplace[1]).run();
    await audit(env, user.id, "inventory.supplier_return_replaced", "supplier_returns", retReplace[1], { qty: q, complete: done });
    return json({ ok: true, replaced_qty: newReplaced, complete: done });
  }
  const retDelete = path.match(/^\/inventory\/returns\/(\d+)\/delete$/);
  if (retDelete && method === "POST") {
    if (!can(user.role, "inventory")) return err("forbidden", "Inventory access required", 403);
    const row = await env.DB.prepare(
      `SELECT status, item_id, qty FROM supplier_returns WHERE id = ?1`,
    ).bind(retDelete[1]).first<{ status: string; item_id: number; qty: number }>();
    if (!row) return err("not_found", "Return not found", 404);
    if (row.status === "credited") return err("invalid_state", "A credited return is a permanent record", 400);
    const repl = await env.DB.prepare(`SELECT COALESCE(replaced_qty, 0) AS rq FROM supplier_returns WHERE id = ?1`)
      .bind(retDelete[1]).first<{ rq: number }>();
    if ((repl?.rq ?? 0) > 0) return err("invalid_state", "Replacement already received — this row is a permanent record", 400);
    // Undo: the stock walks back onto the shelf.
    const item = await env.DB.prepare(`SELECT stock FROM inventory_items WHERE id = ?1`)
      .bind(row.item_id).first<{ stock: number }>();
    if (item) {
      const back = item.stock + row.qty;
      await env.DB.prepare(
        `UPDATE inventory_items SET stock = ?1, status = ?2, updated_by = ?3, updated_at = datetime('now') WHERE id = ?4`,
      ).bind(back, stockStatus(back), user.id, row.item_id).run();
    }
    await env.DB.prepare(`DELETE FROM supplier_returns WHERE id = ?1`).bind(retDelete[1]).run();
    await audit(env, user.id, "inventory.supplier_return_deleted", "supplier_returns", retDelete[1], { qty_restored: row.qty });
    return json({ ok: true });
  }

  /* ---- Marketing materials ---- */

  if (path === "/materials" && method === "GET") {
    if (!can(user.role, "inventory") && !can(user.role, "exec_view")) {
      return err("forbidden", "Access required", 403);
    }
    const { results } = await env.DB.prepare(
      `SELECT m.*, u.name AS requested_by_name FROM material_requests m
       LEFT JOIN users u ON u.id = m.requested_by ORDER BY m.created_at DESC LIMIT 100`,
    ).all();
    return json({ materials: results });
  }
  if (path === "/materials" && method === "POST") {
    if (!can(user.role, "inventory")) return err("forbidden", "Access required", 403);
    if (!body || !str(body.title, 200)) return err("invalid_input", "title is required", 400);
    await env.DB.prepare(
      `INSERT INTO material_requests (title, description, requested_by) VALUES (?1, ?2, ?3)`,
    ).bind(body.title, str(body.description, 2000) ? body.description : null, user.id).run();
    await audit(env, user.id, "materials.create");
    return json({ ok: true }, 201);
  }
  const matMatch = path.match(/^\/materials\/(\d+)$/);
  if (matMatch && method === "PATCH") {
    if (!can(user.role, "inventory")) return err("forbidden", "Access required", 403);
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

  /* v1.19.0 (consolidation C1): /bd and /ops-reports routes deleted. Their
     panels (CommercialPanel, OperationsPanel) were exported but rendered by
     no tab — dead UI over live routes. bd_pipeline and ops_reports TABLES
     remain untouched; only the API surface is gone. */
  if (path === "/overview" && method === "GET") {
    if (!can(user.role, "exec_view")) return err("forbidden", "Executive access required", 403);
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
        `SELECT COALESCE(NULLIF(TRIM(u.full_name), ''), u.name) AS name, u.role,
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

  /* ===================== v1.6.0 — real-time notifications ================== */

  /* SSE live stream: replaces the 60-second poll with ~5-second latency
     without Durable Objects. The connection self-closes after ~20s and the
     browser's EventSource reconnects automatically, so no connection is held
     open indefinitely. `since` is the newest id the client already has. */
  if (path === "/notifications/stream" && method === "GET") {
    let lastId = Number(new URL(request.url).searchParams.get("since") ?? "0") || 0;
    const encoder = new TextEncoder();
    let cancelled = false;
    const stream = new ReadableStream({
      cancel() { cancelled = true; }, // client disconnected — stop polling at once
      async start(controller) {
        const send = (s: string) => { try { controller.enqueue(encoder.encode(s)); } catch { /* closed */ } };
        send("retry: 5000\n\n");
        const started = Date.now();
        try {
          while (!cancelled && Date.now() - started < 20000) {
            const { results } = await env.DB.prepare(
              `SELECT id, kind, message, ref, is_read, created_at FROM notifications
               WHERE user_id = ?1 AND id > ?2 ORDER BY id ASC LIMIT 30`,
            ).bind(user.id, lastId).all<{ id: number }>();
            if (results.length) {
              for (const n of results) lastId = Math.max(lastId, n.id);
              send(`event: notifications\ndata: ${JSON.stringify(results)}\n\n`);
            } else {
              send(`event: ping\ndata: ${lastId}\n\n`);
            }
            await new Promise((r) => setTimeout(r, 5000));
          }
        } catch { /* client disconnected */ }
        send(`event: bye\ndata: ${lastId}\n\n`);
        try { controller.close(); } catch { /* already closed */ }
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Accel-Buffering": "no",
      },
    });
  }

  /* Web-push: the browser fetches the public key, subscribes, and posts the
     subscription here. Unsubscribe removes it. */
  if (path === "/push/public-key" && method === "GET") {
    return json({ key: env.VAPID_PUBLIC_KEY ?? null });
  }
  if (path === "/push/subscribe" && method === "POST") {
    const sub = body?.subscription as { endpoint?: string; keys?: { p256dh?: string; auth?: string } } | undefined;
    const endpoint = sub?.endpoint;
    const p256dh = sub?.keys?.p256dh;
    const auth = sub?.keys?.auth;
    if (!endpoint || !p256dh || !auth) return err("invalid_input", "A full push subscription is required", 400);
    try {
      await env.DB.prepare(
        `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(endpoint) DO UPDATE SET user_id = ?1, p256dh = ?3, auth = ?4`,
      ).bind(user.id, endpoint, p256dh, auth).run();
    } catch (e) {
      if (String(e).includes("no such table")) return err("migration_missing", "Run migration 0068 first", 409);
      throw e;
    }
    return json({ ok: true });
  }
  if (path === "/push/unsubscribe" && method === "POST") {
    const endpoint = typeof body?.endpoint === "string" ? body.endpoint : null;
    if (endpoint) await env.DB.prepare(`DELETE FROM push_subscriptions WHERE endpoint = ?1 AND user_id = ?2`).bind(endpoint, user.id).run();
    return json({ ok: true });
  }

  /* ===================== v1.6.0 — targets · commission · leaderboard ======= */

  /* The leaderboard: attributed sales per person this month, their target,
     progress, and the commission the active rules would pay. Visible to any
     role that can see revenue — it is the motivational heart of the sales
     floor, so everyone who works the numbers sees the ranking. */
  if (path === "/leaderboard" && method === "GET") {
    if (!can(user.role, "revenue_view")) return err("forbidden", "Revenue access required", 403);
    const month = new URL(request.url).searchParams.get("month")
      ?? new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(month)) return err("invalid_input", "month must be YYYY-MM", 400);

    const sales = await attributedSalesByUser(env, month);
    const rules = await activeCommissionRules(env);
    const targets = new Map<number, number>();
    try {
      const { results } = await env.DB.prepare(
        `SELECT user_id, target_cents FROM user_sales_targets WHERE month = ?1`,
      ).bind(month).all<{ user_id: number; target_cents: number }>();
      for (const t of results) targets.set(t.user_id, t.target_cents);
    } catch { /* pre-0068 */ }

    const { results: staff } = await env.DB.prepare(
      `SELECT id, COALESCE(NULLIF(TRIM(full_name), ''), name) AS name, role, photo_key FROM users
       WHERE is_active = 1 AND role NOT IN ('customer', 'super_admin', 'admin')`,
    ).all<{ id: number; name: string; role: string; photo_key: string | null }>();

    const rows = staff
      .map((s) => {
        const sold = sales.get(s.id) ?? 0;
        const target = targets.get(s.id) ?? 0;
        return {
          user_id: s.id, name: s.name, role: s.role, photo_key: s.photo_key,
          sales_cents: sold,
          target_cents: target || null,
          pct: target > 0 ? Math.round((sold / target) * 100) : null,
          commission_cents: commissionFor(sold, target, s.role, rules),
        };
      })
      .filter((r) => r.sales_cents > 0 || r.target_cents)
      .sort((a, b) => b.sales_cents - a.sales_cents)
      .map((r, i) => ({ ...r, rank: i + 1 }));

    // The requesting user always sees their own line even at zero.
    const meIncluded = rows.some((r) => r.user_id === user.id);
    return json({ month, rows, has_rules: rules.length > 0, me_included: meIncluded, me: user.id });
  }

  /* Targets — per-person and per-team (the company target stays on
     /revenue/target). Management only. */
  if (path === "/targets" && method === "GET") {
    if (!TARGET_ADMIN_ROLES.includes(user.role)) return err("forbidden", "Management access required", 403);
    const month = new URL(request.url).searchParams.get("month")
      ?? new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(month)) return err("invalid_input", "month must be YYYY-MM", 400);
    let users: unknown[] = [], teams: unknown[] = [], company: number | null = null;
    try {
      users = (await env.DB.prepare(
        `SELECT t.user_id, t.target_cents, COALESCE(NULLIF(TRIM(u.full_name), ''), u.name) AS name, u.role
         FROM user_sales_targets t JOIN users u ON u.id = t.user_id WHERE t.month = ?1`,
      ).bind(month).all()).results;
      teams = (await env.DB.prepare(`SELECT team, target_cents FROM team_sales_targets WHERE month = ?1`).bind(month).all()).results;
      const c = await env.DB.prepare(`SELECT target_cents FROM sales_targets WHERE month = ?1`).bind(month).first<{ target_cents: number }>();
      company = c?.target_cents ?? null;
    } catch { /* pre-0068 */ }
    const { results: staff } = await env.DB.prepare(
      `SELECT id, COALESCE(NULLIF(TRIM(full_name), ''), name) AS name, role FROM users
       WHERE is_active = 1 AND role NOT IN ('customer', 'super_admin', 'admin') ORDER BY 2`,
    ).all();
    return json({ month, company_target_cents: company, user_targets: users, team_targets: teams, staff });
  }
  if (path === "/targets" && method === "POST") {
    if (!TARGET_ADMIN_ROLES.includes(user.role)) return err("forbidden", "Management access required", 403);
    const scope = String(body?.scope ?? "");
    const month = String(body?.month ?? "");
    const cents = Math.round(Number(body?.target_cents));
    if (!/^\d{4}-\d{2}$/.test(month) || !Number.isFinite(cents) || cents < 0) {
      return err("invalid_input", "scope, month (YYYY-MM) and target_cents are required", 400);
    }
    try {
      if (scope === "user") {
        const uid = Math.round(Number(body?.id));
        if (!uid) return err("invalid_input", "id (user) required", 400);
        await env.DB.prepare(
          `INSERT INTO user_sales_targets (user_id, month, target_cents, set_by) VALUES (?1, ?2, ?3, ?4)
           ON CONFLICT(user_id, month) DO UPDATE SET target_cents = ?3, set_by = ?4`,
        ).bind(uid, month, cents, user.id).run();
        await audit(env, user.id, "target.set_user", "user_sales_targets", String(uid), { month, cents });
      } else if (scope === "team") {
        const team = String(body?.id ?? "").trim().slice(0, 40);
        if (!team) return err("invalid_input", "id (team) required", 400);
        await env.DB.prepare(
          `INSERT INTO team_sales_targets (team, month, target_cents, set_by) VALUES (?1, ?2, ?3, ?4)
           ON CONFLICT(team, month) DO UPDATE SET target_cents = ?3, set_by = ?4`,
        ).bind(team, month, cents, user.id).run();
        await audit(env, user.id, "target.set_team", "team_sales_targets", team, { month, cents });
      } else {
        return err("invalid_input", "scope must be 'user' or 'team'", 400);
      }
      return json({ ok: true });
    } catch (e) {
      if (String(e).includes("no such table")) return err("migration_missing", "Run migration 0068 first", 409);
      throw e;
    }
  }

  /* Commission rules — management CRUD. */
  if (path === "/commission/rules" && method === "GET") {
    if (!TARGET_ADMIN_ROLES.includes(user.role)) return err("forbidden", "Management access required", 403);
    try {
      const { results } = await env.DB.prepare(
        `SELECT id, name, base_pct, bonus_pct, applies_to, active, created_at FROM commission_rules ORDER BY id DESC`,
      ).all();
      return json({ rules: results });
    } catch (e) {
      if (String(e).includes("no such table")) return err("migration_missing", "Run migration 0068 first", 409);
      throw e;
    }
  }
  if (path === "/commission/rules" && method === "POST") {
    if (!TARGET_ADMIN_ROLES.includes(user.role)) return err("forbidden", "Management access required", 403);
    const name = String(body?.name ?? "").trim().slice(0, 80);
    const basePct = Number(body?.base_pct);
    const bonusPct = Number(body?.bonus_pct ?? 0);
    const appliesTo = String(body?.applies_to ?? "all").trim() || "all";
    if (!name || !Number.isFinite(basePct) || basePct < 0 || basePct > 100 || !Number.isFinite(bonusPct) || bonusPct < 0 || bonusPct > 100) {
      return err("invalid_input", "name and base_pct (0–100) are required; bonus_pct 0–100", 400);
    }
    try {
      const res = await env.DB.prepare(
        `INSERT INTO commission_rules (name, base_pct, bonus_pct, applies_to, created_by) VALUES (?1, ?2, ?3, ?4, ?5) RETURNING id`,
      ).bind(name, basePct, bonusPct, appliesTo, user.id).first<{ id: number }>();
      await audit(env, user.id, "commission.rule_create", "commission_rules", String(res?.id), { name, basePct, bonusPct, appliesTo });
      return json({ id: res?.id }, 201);
    } catch (e) {
      if (String(e).includes("no such table")) return err("migration_missing", "Run migration 0068 first", 409);
      throw e;
    }
  }
  {
    const mR = path.match(/^\/commission\/rules\/(\d+)$/);
    if (mR && (method === "PATCH" || method === "DELETE")) {
      if (!TARGET_ADMIN_ROLES.includes(user.role)) return err("forbidden", "Management access required", 403);
      const id = Number(mR[1]);
      if (method === "DELETE") {
        await env.DB.prepare(`DELETE FROM commission_rules WHERE id = ?1`).bind(id).run();
        await audit(env, user.id, "commission.rule_delete", "commission_rules", String(id));
        return json({ ok: true });
      }
      const sets: string[] = [];
      const args: unknown[] = [];
      if (typeof body?.active === "number" || typeof body?.active === "boolean") { sets.push(`active = ?${args.length + 1}`); args.push(body.active ? 1 : 0); }
      if (Number.isFinite(Number(body?.base_pct))) { sets.push(`base_pct = ?${args.length + 1}`); args.push(Number(body!.base_pct)); }
      if (Number.isFinite(Number(body?.bonus_pct))) { sets.push(`bonus_pct = ?${args.length + 1}`); args.push(Number(body!.bonus_pct)); }
      if (typeof body?.name === "string" && body.name.trim()) { sets.push(`name = ?${args.length + 1}`); args.push(body.name.trim().slice(0, 80)); }
      if (typeof body?.applies_to === "string" && body.applies_to.trim()) { sets.push(`applies_to = ?${args.length + 1}`); args.push(body.applies_to.trim()); }
      if (sets.length === 0) return err("invalid_input", "Nothing to update", 400);
      await env.DB.prepare(`UPDATE commission_rules SET ${sets.join(", ")} WHERE id = ?${args.length + 1}`).bind(...args, id).run();
      await audit(env, user.id, "commission.rule_update", "commission_rules", String(id), body ?? {});
      return json({ ok: true });
    }
  }

  /* ===================== v1.7.0 — Sales Pipeline — RETIRED ================= */
  /* v1.21.0 (CEO: "Sales pipeline is really needed?? I dont think so"):
     the LEAD→WON tracker is retired. The `prospects` table and its
     migrations (0066/0067) are KEPT — history is never dropped by a UI
     decision — but the /pipeline routes are gone and the tab with them.
     Customer enquiries (the real inbound funnel) now live on the Sales tab;
     an enquiry that turns into business becomes a quotation directly. */

  /* ===================== v1.7.0 — Content management ======================= */
  {
    const CONTENT_MANAGE = ["super_admin", "admin", "ceo", "coo", "cco", "hr_admin", "sales_marketing", "marketing", "editor", "live_host"];
    if (path === "/content" && method === "GET") {
      try {
        const { results } = await env.DB.prepare(
          `SELECT c.*, COALESCE(NULLIF(TRIM(u.full_name), ''), u.name) AS assigned_name
           FROM content_items c LEFT JOIN users u ON u.id = c.assigned_to
           ORDER BY CASE WHEN c.stage = 'posted' THEN 1 ELSE 0 END,
                    c.scheduled_date IS NULL, c.scheduled_date, c.id DESC LIMIT 300`,
        ).all();
        return json({ content: results });
      } catch (e) {
        if (String(e).includes("no such table")) return err("migration_missing", "Run migration 0069 (content) first", 409);
        throw e;
      }
    }
    if (path === "/content" && method === "POST") {
      const title = String(body?.title ?? "").trim();
      if (!title) return err("invalid_input", "A title is required", 400);
      const KINDS = ["video", "reel", "live", "campaign", "other"];
      const PLATFORMS = ["tiktok", "shopee", "instagram", "facebook", "other"];
      const kind = KINDS.includes(String(body?.kind)) ? String(body?.kind) : "video";
      const platform = PLATFORMS.includes(String(body?.platform)) ? String(body?.platform) : "tiktok";
      const sched = /^\d{4}-\d{2}-\d{2}$/.test(String(body?.scheduled_date ?? "")) ? String(body?.scheduled_date) : null;
      const assigned = Number(body?.assigned_to) || null;
      try {
        const res = await env.DB.prepare(
          `INSERT INTO content_items (title, kind, platform, scheduled_date, script, caption, campaign, assigned_to, notes, created_by)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10) RETURNING id`,
        ).bind(title, kind, platform, sched, String(body?.script ?? "").trim() || null, String(body?.caption ?? "").trim() || null,
               String(body?.campaign ?? "").trim() || null, assigned, String(body?.notes ?? "").trim() || null, user.id).first<{ id: number }>();
        await audit(env, user.id, "content.create", "content_items", String(res?.id), { title });
        if (assigned && assigned !== user.id) await notify(env, assigned, "content", `🎬 Content assigned to you: ${title}`, `content:${res?.id}`);
        return json({ id: res?.id }, 201);
      } catch (e) {
        if (String(e).includes("no such table")) return err("migration_missing", "Run migration 0069 (content) first", 409);
        throw e;
      }
    }
    const mC = path.match(/^\/content\/(\d+)$/);
    if (mC && method === "PATCH") {
      if (!CONTENT_MANAGE.includes(user.role)) return err("forbidden", "Content access required", 403);
      const sets: string[] = [];
      const args: unknown[] = [];
      const put = (col: string, v: unknown) => { sets.push(`${col} = ?${args.length + 1}`); args.push(v); };
      const STAGES = ["idea", "script", "shoot", "edit", "approval", "posted"];
      if (typeof body?.stage === "string" && STAGES.includes(body.stage)) {
        put("stage", body.stage);
        if (body.stage === "posted") put("posted_at", new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10));
      }
      for (const col of ["title", "kind", "platform", "script", "caption", "campaign", "performance", "notes"] as const) {
        if (typeof body?.[col] === "string") put(col, String(body[col]).trim() || null);
      }
      if (typeof body?.scheduled_date === "string") put("scheduled_date", /^\d{4}-\d{2}-\d{2}$/.test(body.scheduled_date) ? body.scheduled_date : null);
      if (body && "assigned_to" in body) put("assigned_to", Number(body.assigned_to) || null);
      if (sets.length === 0) return err("invalid_input", "Nothing to update", 400);
      await env.DB.prepare(`UPDATE content_items SET ${sets.join(", ")} WHERE id = ?${args.length + 1}`).bind(...args, Number(mC[1])).run();
      await audit(env, user.id, "content.update", "content_items", mC[1], body ?? {});
      return json({ ok: true });
    }
    if (mC && method === "DELETE") {
      if (!CONTENT_MANAGE.includes(user.role)) return err("forbidden", "Content access required", 403);
      await env.DB.prepare(`DELETE FROM content_items WHERE id = ?1`).bind(Number(mC[1])).run();
      await audit(env, user.id, "content.delete", "content_items", mC[1]);
      return json({ ok: true });
    }
  }

  /* ===================== v1.7.0 — Stokis management ======================== */
  {
    const STOKIS_MANAGE = ["super_admin", "admin", "ceo", "coo", "cco", "hr_admin", "sales_marketing", "marketing"];
    if (path === "/stokis" && method === "GET") {
      // v1.7.0: stokis rows carry contact PII + finance, so reading is gated to
      // the same tier that manages them (not every staff role).
      if (!STOKIS_MANAGE.includes(user.role)) return err("forbidden", "Sales/management access required", 403);
      const month = new URL(request.url).searchParams.get("month")
        ?? new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 7);
      try {
        const { results } = await env.DB.prepare(
          `SELECT s.*,
             (SELECT COALESCE(SUM(o.amount_cents), 0) FROM stokis_orders o WHERE o.stokis_id = s.id) AS total_cents,
             (SELECT COALESCE(SUM(o.amount_cents), 0) FROM stokis_orders o WHERE o.stokis_id = s.id AND o.payment_status = 'unpaid') AS balance_cents,
             (SELECT COALESCE(SUM(o.amount_cents), 0) FROM stokis_orders o WHERE o.stokis_id = s.id AND strftime('%Y-%m', o.ordered_at) = ?1) AS month_cents,
             (SELECT target_cents FROM stokis_targets t WHERE t.stokis_id = s.id AND t.month = ?1) AS target_cents
           FROM stokis s ORDER BY s.status = 'inactive', s.name`,
        ).bind(month).all<{ id: number; commission_pct: number; month_cents: number }>();
        const rows = results.map((r) => ({ ...r, commission_cents: Math.round((r.month_cents ?? 0) * (r.commission_pct ?? 0) / 100) }));
        return json({ stokis: rows, month });
      } catch (e) {
        if (String(e).includes("no such table")) return err("migration_missing", "Run migration 0069 (stokis) first", 409);
        throw e;
      }
    }
    if (path === "/stokis" && method === "POST") {
      if (!STOKIS_MANAGE.includes(user.role)) return err("forbidden", "Sales tier required", 403);
      const name = String(body?.name ?? "").trim();
      if (!name) return err("invalid_input", "Stokis name is required", 400);
      const pct = Number(body?.commission_pct);
      try {
        const res = await env.DB.prepare(
          `INSERT INTO stokis (name, company, phone, email, location, commission_pct, notes, joined_at, created_by)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9) RETURNING id`,
        ).bind(name, String(body?.company ?? "").trim() || null, String(body?.phone ?? "").trim() || null,
               String(body?.email ?? "").trim() || null, String(body?.location ?? "").trim() || null,
               Number.isFinite(pct) && pct >= 0 ? pct : 0, String(body?.notes ?? "").trim() || null,
               /^\d{4}-\d{2}-\d{2}$/.test(String(body?.joined_at ?? "")) ? String(body?.joined_at) : new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10),
               user.id).first<{ id: number }>();
        await audit(env, user.id, "stokis.create", "stokis", String(res?.id), { name });
        return json({ id: res?.id }, 201);
      } catch (e) {
        if (String(e).includes("no such table")) return err("migration_missing", "Run migration 0069 (stokis) first", 409);
        throw e;
      }
    }
    const mS = path.match(/^\/stokis\/(\d+)$/);
    if (mS && method === "PATCH") {
      if (!STOKIS_MANAGE.includes(user.role)) return err("forbidden", "Sales tier required", 403);
      const sets: string[] = [];
      const args: unknown[] = [];
      const put = (col: string, v: unknown) => { sets.push(`${col} = ?${args.length + 1}`); args.push(v); };
      for (const col of ["name", "company", "phone", "email", "location", "notes"] as const) {
        if (typeof body?.[col] === "string") put(col, String(body[col]).trim() || null);
      }
      if (typeof body?.status === "string" && ["active", "inactive"].includes(body.status)) put("status", body.status);
      if (Number.isFinite(Number(body?.commission_pct))) put("commission_pct", Number(body!.commission_pct));
      if (sets.length === 0) return err("invalid_input", "Nothing to update", 400);
      await env.DB.prepare(`UPDATE stokis SET ${sets.join(", ")} WHERE id = ?${args.length + 1}`).bind(...args, Number(mS[1])).run();
      await audit(env, user.id, "stokis.update", "stokis", mS[1], body ?? {});
      return json({ ok: true });
    }
    if (mS && method === "DELETE") {
      if (!STOKIS_MANAGE.includes(user.role)) return err("forbidden", "Sales tier required", 403);
      await env.DB.prepare(`DELETE FROM stokis WHERE id = ?1`).bind(Number(mS[1])).run();
      await env.DB.prepare(`DELETE FROM stokis_orders WHERE stokis_id = ?1`).bind(Number(mS[1])).run();
      await audit(env, user.id, "stokis.delete", "stokis", mS[1]);
      return json({ ok: true });
    }
    // Orders / purchases under a stokis.
    const mSO = path.match(/^\/stokis\/(\d+)\/orders$/);
    if (mSO && method === "GET") {
      if (!STOKIS_MANAGE.includes(user.role)) return err("forbidden", "Sales/management access required", 403);
      const { results } = await env.DB.prepare(
        `SELECT id, amount_cents, qty, note, payment_status, ordered_at FROM stokis_orders WHERE stokis_id = ?1 ORDER BY ordered_at DESC, id DESC LIMIT 200`,
      ).bind(Number(mSO[1])).all();
      return json({ orders: results });
    }
    if (mSO && method === "POST") {
      if (!STOKIS_MANAGE.includes(user.role)) return err("forbidden", "Sales tier required", 403);
      const cents = Math.round(Number(body?.amount_cents));
      if (!Number.isFinite(cents) || cents < 0) return err("invalid_input", "amount_cents required", 400);
      const paid = body?.payment_status === "paid" ? "paid" : "unpaid";
      const orderedAt = /^\d{4}-\d{2}-\d{2}$/.test(String(body?.ordered_at ?? "")) ? String(body?.ordered_at) : new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
      const res = await env.DB.prepare(
        `INSERT INTO stokis_orders (stokis_id, amount_cents, qty, note, payment_status, ordered_at, created_by)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) RETURNING id`,
      ).bind(Number(mSO[1]), cents, Number(body?.qty) || null, String(body?.note ?? "").trim() || null, paid, orderedAt, user.id).first<{ id: number }>();
      await audit(env, user.id, "stokis.order", "stokis_orders", String(res?.id), { stokis: mSO[1], cents });
      return json({ id: res?.id }, 201);
    }
    const mOrd = path.match(/^\/stokis\/orders\/(\d+)$/);
    if (mOrd && method === "PATCH") {
      if (!STOKIS_MANAGE.includes(user.role)) return err("forbidden", "Sales tier required", 403);
      if (typeof body?.payment_status === "string" && ["paid", "unpaid"].includes(body.payment_status)) {
        await env.DB.prepare(`UPDATE stokis_orders SET payment_status = ?1 WHERE id = ?2`).bind(body.payment_status, Number(mOrd[1])).run();
        await audit(env, user.id, "stokis.order_pay", "stokis_orders", mOrd[1], { payment_status: body.payment_status });
        return json({ ok: true });
      }
      return err("invalid_input", "payment_status required", 400);
    }
    if (mOrd && method === "DELETE") {
      if (!STOKIS_MANAGE.includes(user.role)) return err("forbidden", "Sales tier required", 403);
      await env.DB.prepare(`DELETE FROM stokis_orders WHERE id = ?1`).bind(Number(mOrd[1])).run();
      return json({ ok: true });
    }
    // Monthly target for a stokis.
    const mST = path.match(/^\/stokis\/(\d+)\/target$/);
    if (mST && method === "POST") {
      if (!STOKIS_MANAGE.includes(user.role)) return err("forbidden", "Sales tier required", 403);
      const month = String(body?.month ?? "");
      const cents = Math.round(Number(body?.target_cents));
      if (!/^\d{4}-\d{2}$/.test(month) || !Number.isFinite(cents) || cents < 0) return err("invalid_input", "month + target_cents required", 400);
      await env.DB.prepare(
        `INSERT INTO stokis_targets (stokis_id, month, target_cents, set_by) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(stokis_id, month) DO UPDATE SET target_cents = ?3, set_by = ?4`,
      ).bind(Number(mST[1]), month, cents, user.id).run();
      return json({ ok: true });
    }
  }

  /* ===================== v1.7.0 — Receipts, Credit Notes, Outstanding ====== */
  {
    const DOC_MANAGE = can(user.role, "sales") || can(user.role, "finance") || can(user.role, "exec_view");
    // Issue a payment receipt for a PAID invoice (idempotent — returns the
    // existing receipt if one was already issued).
    const mRcp = path.match(/^\/docs\/(\d+)\/receipt$/);
    if (mRcp && method === "POST") {
      if (!DOC_MANAGE) return err("forbidden", "Sales/finance access required", 403);
      const invId = Number(mRcp[1]);
      const inv = await env.DB.prepare(
        `SELECT id, doc_number, customer_id, total_cents, payment_status, payment_method, payment_ref, paid_at FROM sales_documents WHERE id = ?1 AND doc_type = 'INV'`,
      ).bind(invId).first<{ id: number; doc_number: string; customer_id: number; total_cents: number; payment_status: string; payment_method: string | null; payment_ref: string | null; paid_at: string | null }>();
      if (!inv) return err("not_found", "Invoice not found", 404);
      if (inv.payment_status !== "paid") return err("invalid_input", "Only a PAID invoice can have a receipt", 400);
      try {
        const existing = await env.DB.prepare(`SELECT id, receipt_number FROM receipts WHERE invoice_id = ?1`).bind(invId).first<{ id: number; receipt_number: string }>();
        if (existing) return json({ id: existing.id, receipt_number: existing.receipt_number, existed: true });
        const number = await docNumber(env, "RC");
        const token = crypto.randomUUID().replace(/-/g, "");
        const res = await env.DB.prepare(
          `INSERT INTO receipts (receipt_number, invoice_id, invoice_number, customer_id, amount_cents, payment_method, payment_ref, paid_at, share_token, created_by)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10) RETURNING id`,
        ).bind(number, invId, inv.doc_number, inv.customer_id, inv.total_cents, inv.payment_method, inv.payment_ref, inv.paid_at, token, user.id).first<{ id: number }>();
        await audit(env, user.id, "receipt.issue", "receipts", String(res?.id), { invoice: inv.doc_number, amount: inv.total_cents });
        return json({ id: res?.id, receipt_number: number }, 201);
      } catch (e) {
        if (String(e).includes("no such table")) return err("migration_missing", "Run migration 0069 (receipts) first", 409);
        throw e;
      }
    }
    // Issue a credit note against an invoice.
    const mCn = path.match(/^\/docs\/(\d+)\/credit-note$/);
    if (mCn && method === "POST") {
      if (!DOC_MANAGE) return err("forbidden", "Sales/finance access required", 403);
      const invId = Number(mCn[1]);
      const cents = Math.round(Number(body?.amount_cents));
      const reason = String(body?.reason ?? "").trim();
      if (!Number.isFinite(cents) || cents <= 0) return err("invalid_input", "A positive amount_cents is required", 400);
      const inv = await env.DB.prepare(`SELECT id, doc_number, customer_id, total_cents FROM sales_documents WHERE id = ?1 AND doc_type = 'INV'`).bind(invId).first<{ id: number; doc_number: string; customer_id: number; total_cents: number }>();
      if (!inv) return err("not_found", "Invoice not found", 404);
      if (cents > inv.total_cents) return err("invalid_input", "Credit note cannot exceed the invoice total", 400);
      try {
        const number = await docNumber(env, "CN");
        const token = crypto.randomUUID().replace(/-/g, "");
        const res = await env.DB.prepare(
          `INSERT INTO credit_notes (cn_number, invoice_id, invoice_number, customer_id, amount_cents, reason, share_token, created_by)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8) RETURNING id`,
        ).bind(number, invId, inv.doc_number, inv.customer_id, cents, reason || null, token, user.id).first<{ id: number }>();
        await audit(env, user.id, "credit_note.issue", "credit_notes", String(res?.id), { invoice: inv.doc_number, amount: cents });
        return json({ id: res?.id, cn_number: number }, 201);
      } catch (e) {
        if (String(e).includes("no such table")) return err("migration_missing", "Run migration 0069 (credit notes) first", 409);
        throw e;
      }
    }
    if (path === "/receipts" && method === "GET") {
      if (!DOC_MANAGE) return err("forbidden", "Sales/finance access required", 403);
      try {
        const { results } = await env.DB.prepare(
          `SELECT r.id, r.receipt_number, r.invoice_number, r.amount_cents, r.payment_method, r.payment_ref, r.paid_at, r.share_token, r.created_at, c.company
           FROM receipts r LEFT JOIN customers c ON c.id = r.customer_id ORDER BY r.id DESC LIMIT 200`,
        ).all();
        return json({ receipts: results });
      } catch (e) {
        if (String(e).includes("no such table")) return err("migration_missing", "Run migration 0069 first", 409);
        throw e;
      }
    }
    if (path === "/credit-notes" && method === "GET") {
      if (!DOC_MANAGE) return err("forbidden", "Sales/finance access required", 403);
      try {
        const { results } = await env.DB.prepare(
          `SELECT n.id, n.cn_number, n.invoice_number, n.amount_cents, n.reason, n.share_token, n.created_at, c.company
           FROM credit_notes n LEFT JOIN customers c ON c.id = n.customer_id ORDER BY n.id DESC LIMIT 200`,
        ).all();
        return json({ credit_notes: results });
      } catch (e) {
        if (String(e).includes("no such table")) return err("migration_missing", "Run migration 0069 first", 409);
        throw e;
      }
    }
    // Consolidated outstanding-payments report (unpaid invoices, oldest first).
    if (path === "/reports/outstanding" && method === "GET") {
      if (!DOC_MANAGE) return err("forbidden", "Sales/finance access required", 403);
      const { results } = await env.DB.prepare(
        `SELECT d.id, d.doc_number, d.total_cents, d.due_date, d.created_at, c.company, c.phone
         FROM sales_documents d LEFT JOIN customers c ON c.id = d.customer_id
         WHERE d.doc_type = 'INV' AND COALESCE(d.payment_status, 'unpaid') != 'paid'
         ORDER BY d.due_date IS NULL, d.due_date ASC, d.created_at ASC LIMIT 300`,
      ).all<{ total_cents: number }>();
      const total = results.reduce((a, r) => a + (r.total_cents ?? 0), 0);
      return json({ invoices: results, total_cents: total, count: results.length });
    }
  }

  return null; // not a staff route
}
