/* v1.238.0 - ACCOUNT IDENTITY (the owner, 31-10-2026; claude/ACCOUNT-
   RECOVERY-AUDIT.md: "CEO CAN SECURELY MANAGE STAFF LOGIN EMAILS. STAFF CAN
   RECOVER ACCOUNT ACCESS SAFELY. GOOGLE AUTHENTICATION REMAINS CORRECTLY
   LINKED. HISTORICAL BUSINESS RECORDS REMAIN INTACT. ONE AUTHORITATIVE USER
   ACCOUNT.").

   One users row is the person. A login email change rewrites users.email on
   THAT row - never a new account, never a business row: every table points
   at users.id. It waits in email_changes until it is proven by one of three
   routes, then applies in one batch with every session signed out:
     email      - a single-use link to the new address (Cloudflare Email
                  Sending, worker/src/mail.ts), 24 hours
     google     - the person signs in with Google AS the new address; Google
                  has proven they own it (users.google_sub decides who they are)
     in_person  - the old mailbox is lost: the owner or super admin checked
                  the person's identity, and the person typed their OWN
                  authenticator code on that screen; an Admin, COO, CCO or a
                  holder of payroll or money permissions also needs the other
                  of owner / super admin to approve
   Tokens are stored as a SHA-256 hash only and never logged. */
import type { Env } from "./index";
import { can } from "./permissions";
import { notify } from "./staff";
import { mailReady, sendMail } from "./mail";

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const CHANGE_TTL_HOURS = 24;
export const SET_PASSWORD_TTL_HOURS = 24;

export async function sha256(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
export function newToken(): string {
  const b = new Uint8Array(32); crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

export async function auditAcct(env: Env, userId: number | null, action: string, entityId: string, detail: Record<string, unknown>): Promise<void> {
  try {
    await env.DB.prepare(`INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?1, ?2, 'users', ?3, ?4)`)
      .bind(userId, action, entityId, JSON.stringify(detail)).run();
  } catch { /* the trail never breaks the action */ }
}

/** An Admin, COO or CCO account, or one whose role holds payroll or money
    permissions (read through can(), so the matrix decides). */
export function privilegedTarget(role: string): boolean {
  if (["admin", "coo", "cco", "ceo", "super_admin"].includes(role)) return true;
  return (["payroll_process", "payroll_release", "bank_run", "invoice_payment", "cashflow_manage", "cashbook_correct"] as const).some((c) => can(role, c));
}

export interface ChangeRow {
  id: number; user_id: number; old_email: string; new_email: string; route: string; status: string;
  needs_second: number; approved_by: number | null; requested_by: number; reason: string; expires_at: string;
}

/** Mark pending changes past their time as expired. */
export async function expireChanges(env: Env): Promise<void> {
  try { await env.DB.prepare(`UPDATE email_changes SET status = 'expired' WHERE status = 'pending' AND expires_at <= datetime('now')`).run(); } catch { /* pre-0155 */ }
}

/** Is this address free - no account and no other pending change holds it? */
export async function emailTaken(env: Env, email: string, exceptChange = 0): Promise<boolean> {
  const u = await env.DB.prepare(`SELECT 1 FROM users WHERE email = ?1`).bind(email).first();
  if (u) return true;
  const p = await env.DB.prepare(`SELECT 1 FROM email_changes WHERE new_email = ?1 AND status = 'pending' AND expires_at > datetime('now') AND id != ?2`).bind(email, exceptChange).first();
  return !!p;
}

/* ---- v1.264.0 - GUARDED IDENTITY BATCHES (claude/AUTH-2.0-AUDIT.md rev 3
   sec. 5; migration 0173). Tested on Cloudflare's own D1 engine: inside a
   batch an UPDATE that matches no row COMMITS, and everything after it runs -
   a change that did not happen would be recorded as done. So every step of an
   identity change is followed by an ASSERTION: a row in auth_assert that can
   only be written when the step changed exactly one row (and, for a link, the
   row now holds the intended value). Otherwise NOT NULL / CHECK fail, D1 rolls
   the WHOLE batch back and the caller gets an error - never a zero-row
   "success". auth_assert is emptied at the end of every batch. ---- */
type Stmt = ReturnType<Env["DB"]["prepare"]>;
/** The assertion after a write: exactly one row changed. */
export const assertOne = (env: Env): Stmt => env.DB.prepare(`INSERT INTO auth_assert (ok) SELECT CASE WHEN changes() = 1 THEN 1 END`);
/** ...and the account now holds this Google identity. */
export const assertLinked = (env: Env, userId: number, sub: string): Stmt =>
  env.DB.prepare(`INSERT INTO auth_assert (ok) SELECT CASE WHEN changes() = 1 AND (SELECT google_sub FROM users WHERE id = ?1) = ?2 THEN 1 END`).bind(userId, sub);
export const clearAsserts = (env: Env): Stmt => env.DB.prepare(`DELETE FROM auth_assert`);
/** The account may still sign in (the same rule as POST /auth/login). */
const STILL_OK = `is_active = 1 AND COALESCE(employment_status, '') NOT IN ('resigned', 'terminated')`;

/** Attach a Google identity to an account that has none: guarded. `legacy`
    restricts it to the Google-created customers from before 1.238.0. */
export function linkGoogleStatements(env: Env, userId: number, sub: string, opts: { legacy?: boolean } = {}): Stmt[] {
  const legacy = opts.legacy ? ` AND role = 'customer' AND password_hash = 'oauth$google' AND created_at < '${LEGACY_GOOGLE_BEFORE}'` : "";
  return [
    env.DB.prepare(`UPDATE users SET google_sub = ?2, email_verified_at = COALESCE(email_verified_at, datetime('now')) WHERE id = ?1 AND google_sub IS NULL AND ${STILL_OK}${legacy}`).bind(userId, sub),
    assertLinked(env, userId, sub),
  ];
}
/** Google-created customers from before migration 0155 (31-10-2026) carry no
    Google id; only they may take the restricted one-time legacy link. */
export const LEGACY_GOOGLE_BEFORE = "2026-10-31 00:00:00";

/** The guarded statements of a proven login email change (and, when given, the
    Google identity that proved it). The change must still be pending, unexpired
    and approved where it needs a second approval; the account must still carry
    the old address and still be allowed in. */
export function emailChangeStatements(env: Env, c: ChangeRow, googleSub?: string | null): Stmt[] {
  const out: Stmt[] = [
    env.DB.prepare(`UPDATE users SET email = ?1, email_verified_at = datetime('now') WHERE id = ?2 AND email = ?3 AND ${STILL_OK}`).bind(c.new_email, c.user_id, c.old_email),
    assertOne(env),
  ];
  if (googleSub) out.push(...linkGoogleStatements(env, c.user_id, googleSub));
  out.push(
    env.DB.prepare(`UPDATE email_changes SET status = 'applied', applied_at = datetime('now'), token_hash = NULL
                     WHERE id = ?1 AND status = 'pending' AND expires_at > datetime('now') AND (needs_second = 0 OR approved_by IS NOT NULL)`).bind(c.id),
    assertOne(env),
    env.DB.prepare(`UPDATE email_changes SET status = 'cancelled' WHERE user_id = ?1 AND status = 'pending' AND id != ?2`).bind(c.user_id, c.id),
    env.DB.prepare(`DELETE FROM sessions WHERE user_id = ?1`).bind(c.user_id),
  );
  return out;
}

/** What follows a change that really applied: the audit, the notices, the mail. */
export async function afterEmailChange(env: Env, c: ChangeRow, via: string): Promise<void> {
  await auditAcct(env, c.requested_by, "user.email_change", String(c.user_id), {
    from: c.old_email, to: c.new_email, route: c.route, via, change_id: c.id, reason: c.reason,
    ...(c.approved_by ? { approved_by: c.approved_by } : {}),
  });
  try {
    await notify(env, c.user_id, "security", `Your A2Z OS login email is now ${c.new_email}. You were signed out everywhere - sign in again with the new address.`, `email_change:${c.id}`);
    if (c.requested_by !== c.user_id) await notify(env, c.requested_by, "security", `Login email changed: ${c.old_email} -> ${c.new_email}`, `email_change_done:${c.id}`);
  } catch { /* a notice never undoes it */ }
  if (mailReady(env)) {
    await sendMail(env, { to: c.old_email, subject: "Your A2Z OS login email was changed", text: `The login email of your A2Z OS account is now ${c.new_email}.\n\nIf you did not expect this, tell A2Z Creative Marketing at once.` });
  }
}

/** Apply a proven change: same users.id, every session out, audited, told.
    v1.264.0 - one GUARDED batch: if the account, the change or the address
    moved meanwhile, nothing at all is written (it used to mark the change
    applied and sign the person out before finding out). */
export async function applyEmailChange(env: Env, c: ChangeRow, opts: { googleSub?: string | null; via: string }): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
  if (c.status !== "pending") return { ok: false, code: "not_pending", message: "This change is no longer waiting." };
  if (c.needs_second && !c.approved_by) return { ok: false, code: "needs_approval", message: "This change still needs the second approval." };
  const clash = await env.DB.prepare(`SELECT 1 FROM users WHERE email = ?1 AND id != ?2`).bind(c.new_email, c.user_id).first();
  if (clash) {
    await env.DB.prepare(`UPDATE email_changes SET status = 'cancelled' WHERE id = ?1`).bind(c.id).run();
    return { ok: false, code: "email_taken", message: "That address now belongs to another account - the change was cancelled." };
  }
  try {
    await env.DB.batch([...emailChangeStatements(env, c, opts.googleSub), clearAsserts(env)]);
  } catch (e) {
    if (/no such table: auth_assert/i.test(String(e))) return { ok: false, code: "migration_missing", message: "Run migration 0173 first (PUSH.bat)." };
    return { ok: false, code: "changed_meanwhile", message: "The account changed while this was waiting - nothing was applied." };
  }
  await afterEmailChange(env, c, opts.via);
  return { ok: true };
}

/* ---- v1.264.0 - GOOGLE SIGN-IN SETTINGS (rev 3 sec. 10), enforced by the
   worker. `enabled` is the kill switch: Google off, every other method on.
   `customer_signup` decides whether an unknown Google account may become a
   customer (R10 - on, as today, until the CEO decides). There is NO setting
   that brings back email-match linking for an internal account. ---- */
export interface GoogleAuthSettings { enabled: boolean; customer_signup: boolean; legacy_link_until: string | null; updated_at?: string | null; updated_by?: string | null }
/* v1.266.0 (rev 3 sec. 3.4, R11) - the legacy link window: the last day
   (YYYY-MM-DD, Malaysia time) on which a Google-created customer from before
   1.238.0 may take the one-time legacy link. None set = closed. The owner
   opens it (at most 90 days) when the notice to those customers is approved. */
export function legacyWindowOpen(g: Pick<GoogleAuthSettings, "legacy_link_until">, now = Date.now()): boolean {
  const d = g.legacy_link_until;
  if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  return now <= Date.parse(`${d}T23:59:59+08:00`);
}
/** Google-created customers from before 1.238.0 still without a Google id. */
export const LEGACY_CUSTOMER_SQL = `role = 'customer' AND password_hash = 'oauth$google' AND google_sub IS NULL AND is_active = 1 AND created_at < '${LEGACY_GOOGLE_BEFORE}'`;
export async function googleAuthSettings(env: Env): Promise<GoogleAuthSettings> {
  try {
    const r = await env.DB.prepare(`SELECT s.value, s.updated_at, COALESCE(NULLIF(TRIM(u.full_name), ''), u.name) AS who FROM business_settings s LEFT JOIN users u ON u.id = s.updated_by WHERE s.key = 'auth_google'`)
      .first<{ value: string | null; updated_at: string | null; who: string | null }>();
    const v = r?.value ? JSON.parse(r.value) as Record<string, unknown> : {};
    const until = typeof v.legacy_link_until === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v.legacy_link_until) ? v.legacy_link_until : null;
    return { enabled: v.enabled !== false, customer_signup: v.customer_signup !== false, legacy_link_until: until, updated_at: r?.updated_at ?? null, updated_by: r?.who ?? null };
  } catch { return { enabled: true, customer_signup: true, legacy_link_until: null }; }
}

/** The pending change a Google sign-in as `email` would complete, if any. */
export async function pendingGoogleChange(env: Env, email: string): Promise<ChangeRow | null> {
  await expireChanges(env);
  return await env.DB.prepare(
    `SELECT * FROM email_changes WHERE new_email = ?1 AND route = 'google' AND status = 'pending' AND expires_at > datetime('now') ORDER BY id DESC LIMIT 1`,
  ).bind(email).first<ChangeRow>();
}
