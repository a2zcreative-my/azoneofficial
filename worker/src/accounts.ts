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

/** Apply a proven change: same users.id, every session out, audited, told. */
export async function applyEmailChange(env: Env, c: ChangeRow, opts: { googleSub?: string | null; via: string }): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
  if (c.status !== "pending") return { ok: false, code: "not_pending", message: "This change is no longer waiting." };
  if (c.needs_second && !c.approved_by) return { ok: false, code: "needs_approval", message: "This change still needs the second approval." };
  const clash = await env.DB.prepare(`SELECT 1 FROM users WHERE email = ?1 AND id != ?2`).bind(c.new_email, c.user_id).first();
  if (clash) {
    await env.DB.prepare(`UPDATE email_changes SET status = 'cancelled' WHERE id = ?1`).bind(c.id).run();
    return { ok: false, code: "email_taken", message: "That address now belongs to another account - the change was cancelled." };
  }
  const setUser = opts.googleSub
    ? env.DB.prepare(`UPDATE users SET email = ?1, email_verified_at = datetime('now'), google_sub = ?2 WHERE id = ?3 AND email = ?4`).bind(c.new_email, opts.googleSub, c.user_id, c.old_email)
    : env.DB.prepare(`UPDATE users SET email = ?1, email_verified_at = datetime('now') WHERE id = ?2 AND email = ?3`).bind(c.new_email, c.user_id, c.old_email);
  await env.DB.batch([
    setUser,
    env.DB.prepare(`UPDATE email_changes SET status = 'applied', applied_at = datetime('now'), token_hash = NULL WHERE id = ?1 AND status = 'pending'`).bind(c.id),
    env.DB.prepare(`UPDATE email_changes SET status = 'cancelled' WHERE user_id = ?1 AND status = 'pending' AND id != ?2`).bind(c.user_id, c.id),
    env.DB.prepare(`DELETE FROM sessions WHERE user_id = ?1`).bind(c.user_id),
  ]);
  const now = await env.DB.prepare(`SELECT email FROM users WHERE id = ?1`).bind(c.user_id).first<{ email: string }>();
  if (now?.email !== c.new_email) return { ok: false, code: "changed_meanwhile", message: "The account changed while this was waiting - nothing was applied." };
  await auditAcct(env, c.requested_by, "user.email_change", String(c.user_id), {
    from: c.old_email, to: c.new_email, route: c.route, via: opts.via, change_id: c.id, reason: c.reason,
    ...(c.approved_by ? { approved_by: c.approved_by } : {}),
  });
  try {
    await notify(env, c.user_id, "security", `Your A2Z OS login email is now ${c.new_email}. You were signed out everywhere - sign in again with the new address.`, `email_change:${c.id}`);
    if (c.requested_by !== c.user_id) await notify(env, c.requested_by, "security", `Login email changed: ${c.old_email} -> ${c.new_email}`, `email_change_done:${c.id}`);
  } catch { /* a notice never undoes it */ }
  if (mailReady(env)) {
    await sendMail(env, { to: c.old_email, subject: "Your A2Z OS login email was changed", text: `The login email of your A2Z OS account is now ${c.new_email}.\n\nIf you did not expect this, tell A2Z Creative Marketing at once.` });
  }
  return { ok: true };
}

/** The pending change a Google sign-in as `email` would complete, if any. */
export async function pendingGoogleChange(env: Env, email: string): Promise<ChangeRow | null> {
  await expireChanges(env);
  return await env.DB.prepare(
    `SELECT * FROM email_changes WHERE new_email = ?1 AND route = 'google' AND status = 'pending' AND expires_at > datetime('now') ORDER BY id DESC LIMIT 1`,
  ).bind(email).first<ChangeRow>();
}
