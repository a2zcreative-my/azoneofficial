/* v1.268.0 - SECURE AUTHENTICATION 2.0, PHASE R: EXECUTIVE RECOVERY
   (claude/PHASE-R-GOVERNANCE.md revision 2, the CEO approved 05-11-2026).

   Only the company owner (the CEO) and the Super Admin can be recovered here;
   every other account keeps today's recovery (owner or Super Admin, identity
   check, reason, code). The panel - COO and CCO, named in advance by the
   owner - holds ONE narrow power: two different members (one requests, the
   other approves, each with a fresh authenticator code) reset the target's
   second factor and end their sessions, 12 hours after approval unless anyone
   on the panel, the owner or the target cancels. It can never change a role,
   the owner designation, a permission, an email, payroll, finance or any
   other account. No second identity store: the existing users, sessions,
   TOTP, backup codes, audit and notifications, in one guarded batch. */
import type { Env } from "./index";
import type { StaffUser } from "./staff";
import { notify, requireFreshTotp } from "./staff";
import { audit, err, json, logError } from "./shared";
import { assertOne, clearAsserts } from "./accounts";
import { mailReady, sendMail } from "./mail";

const PANEL_ROLES = ["coo", "cco"] as const;       // the CEO's choice, 05-11-2026
const MAX_MEMBERS = 3;
const EFFECTIVE_AFTER_H = 24;                        // a new member counts after 24 hours
const APPROVE_WITHIN_H = 24;                         // approval within 24 hours or the request lapses
const EXECUTE_AFTER_H = 12;                          // the waiting period
const LOCK_AFTER = 3;                                // refused / cancelled / lapsed requests in 30 days

type Member = { id: number; user_id: number; name: string; role: string; accepted_at: string | null; effective_at: string; is_active: number; employment_status: string | null; totp_enabled: number; added_at: string };
type Req = {
  id: number; target_id: number; requested_by: number; reason: string; identity_checked: string; identity_method: string; unlink_google: number;
  status: string; created_at: string; approve_by: string; approved_by: number | null; approved_at: string | null; approver_identity: string | null;
  execute_after: string | null; executed_at: string | null; cancelled_by: number | null; cancelled_at: string | null; cancel_reason: string | null;
};
const NAME = `COALESCE(NULLIF(TRIM(u.full_name), ''), u.name)`;
/* the database's clock, the same one every datetime('now') in these rows used */
const dbNow = async (env: Env) => (await env.DB.prepare(`SELECT datetime('now') AS n`).first<{ n: string }>())!.n;

async function ownerId(env: Env): Promise<number | null> {
  try {
    const r = await env.DB.prepare(`SELECT value FROM system_meta WHERE key = 'company_owner'`).first<{ value: string }>();
    const v = r?.value ? (JSON.parse(r.value) as { user_id?: number }) : null;
    return typeof v?.user_id === "number" ? v.user_id : null;
  } catch { return null; }
}
async function liveMembers(env: Env): Promise<Member[]> {
  return (await env.DB.prepare(
    `SELECT p.id, p.user_id, ${NAME} AS name, u.role, p.accepted_at, p.effective_at, p.added_at, u.is_active, u.employment_status, COALESCE(u.totp_enabled, 0) AS totp_enabled
     FROM exec_recovery_panel p JOIN users u ON u.id = p.user_id WHERE p.removed_at IS NULL ORDER BY p.id`,
  ).all<Member>()).results;
}
/** Why a member cannot act now - null when they can. */
function memberBlock(m: Member, now: string): string | null {
  if (!m.accepted_at) return "not_accepted";
  if (m.effective_at > now) return "not_yet_effective";
  if (!m.is_active || ["resigned", "terminated"].includes(m.employment_status ?? "")) return "account_not_active";
  if (!m.totp_enabled) return "no_two_factor";
  if (!(PANEL_ROLES as readonly string[]).includes(m.role)) return "role_changed";
  return null;
}
/** The accounts the panel may recover: the company owner and every active Super Admin. */
async function targets(env: Env): Promise<{ id: number; name: string; role: string }[]> {
  const oid = await ownerId(env);
  return (await env.DB.prepare(
    `SELECT u.id, ${NAME} AS name, u.role FROM users u WHERE (u.role = 'super_admin' OR (u.role = 'ceo' AND u.id = ?1)) ORDER BY u.role, u.id`,
  ).bind(oid ?? -1).all<{ id: number; name: string; role: string }>()).results;
}
async function lapse(env: Env): Promise<void> {
  await env.DB.prepare(`UPDATE exec_recovery_requests SET status = 'lapsed' WHERE status = 'requested' AND approve_by <= datetime('now')`).run();
}
/** Refused / cancelled / lapsed requests for this target since the last owner review, within 30 days. */
async function lockCount(env: Env, targetId: number): Promise<number> {
  const last = await env.DB.prepare(`SELECT MAX(created_at) AS at FROM audit_log WHERE action = 'auth.exec_recovery_unlocked' AND entity_id = ?1`).bind(String(targetId)).first<{ at: string | null }>();
  const r = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM exec_recovery_requests WHERE target_id = ?1 AND status IN ('cancelled', 'lapsed') AND created_at >= datetime('now', '-30 days') AND created_at > ?2`,
  ).bind(targetId, last?.at ?? "1970-01-01").first<{ n: number }>();
  return Number(r?.n ?? 0);
}
/** Everyone who must hear about a request: the target, every live member, the owner. */
async function tell(env: Env, targetId: number, text: string, ref: string): Promise<void> {
  const ids = new Set<number>([targetId, ...(await liveMembers(env)).map((m) => m.user_id)]);
  const oid = await ownerId(env);
  if (oid) ids.add(oid);
  for (const id of ids) {
    try { await notify(env, id, "security", text, `${ref}:${id}`); } catch { /* a notice never decides */ }
  }
}
/** A fresh authenticator code - and the account must HAVE two-factor (requireFreshTotp alone lets an unenrolled account through). */
async function freshCode(env: Env, user: StaffUser, code: unknown, what: string): Promise<Response | null> {
  const t = await env.DB.prepare(`SELECT COALESCE(totp_enabled, 0) AS t FROM users WHERE id = ?1`).bind(user.id).first<{ t: number }>();
  if (!t?.t) return err("twofa_required", "Two-factor must be on for this.", 403);
  return await requireFreshTotp(env, user, code, err, what);
}

/** Run every approved request whose 12 hours are over (the five-minute tick, and every panel read). */
export async function runDueRecoveries(env: Env): Promise<number> {
  try { await lapse(env); } catch { return 0; } // before migration 0177
  const due = (await env.DB.prepare(`SELECT * FROM exec_recovery_requests WHERE status = 'approved' AND execute_after <= datetime('now') ORDER BY id`).all<Req>()).results;
  let done = 0;
  for (const r of due) {
    /* both people must still be active members, and the target still one the panel may recover */
    const ms = await liveMembers(env);
    const now = await dbNow(env);
    const ok = (uid: number | null) => { const m = ms.find((x) => x.user_id === uid); return !!m && !memberBlock(m, now); };
    const tg = (await targets(env)).some((t) => t.id === r.target_id);
    if (!ok(r.requested_by) || !ok(r.approved_by) || !tg) {
      await env.DB.prepare(`UPDATE exec_recovery_requests SET status = 'cancelled', cancelled_at = datetime('now'), cancel_reason = 'panel or target changed before execution' WHERE id = ?1 AND status = 'approved'`).bind(r.id).run();
      await audit(env, r.approved_by ?? r.requested_by, "auth.exec_recovery_cancelled", "users", String(r.target_id), { request_id: r.id, reason: "panel_or_target_changed" });
      continue;
    }
    try {
      await env.DB.batch([
        env.DB.prepare(`UPDATE exec_recovery_requests SET status = 'executed', executed_at = datetime('now') WHERE id = ?1 AND status = 'approved' AND execute_after <= datetime('now')`).bind(r.id),
        assertOne(env),
        env.DB.prepare(`UPDATE users SET totp_enabled = 0, totp_secret = NULL, recovery_rotation_required = 1${r.unlink_google ? ", google_sub = NULL" : ""} WHERE id = ?1`).bind(r.target_id),
        assertOne(env),
        env.DB.prepare(`DELETE FROM twofa_backup_codes WHERE user_id = ?1`).bind(r.target_id),
        env.DB.prepare(`DELETE FROM twofa_challenges WHERE user_id = ?1`).bind(r.target_id),
        env.DB.prepare(`DELETE FROM sessions WHERE user_id = ?1`).bind(r.target_id),
        env.DB.prepare(`UPDATE account_tokens SET used_at = datetime('now') WHERE user_id = ?1 AND used_at IS NULL`).bind(r.target_id),
        env.DB.prepare(`UPDATE oauth_requests SET used_at = datetime('now') WHERE user_id = ?1 AND used_at IS NULL`).bind(r.target_id),
        env.DB.prepare(`UPDATE email_codes SET used_at = datetime('now') WHERE user_id = ?1 AND used_at IS NULL`).bind(r.target_id),
        clearAsserts(env),
      ]);
    } catch (e) {
      await logError(env, "exec_recovery", `request ${r.id}: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    done++;
    await audit(env, r.approved_by!, "auth.exec_recovery_executed", "users", String(r.target_id), { request_id: r.id, requested_by: r.requested_by, approved_by: r.approved_by, unlink_google: !!r.unlink_google });
    await tell(env, r.target_id, "Executive recovery was carried out on your account: two-factor was reset and every device was signed out. Sign in with your password and set up two-factor again.", `exec_rec_done:${r.id}`);
    const t = await env.DB.prepare(`SELECT email FROM users WHERE id = ?1`).bind(r.target_id).first<{ email: string }>();
    if (t && mailReady(env)) await sendMail(env, { to: t.email, subject: "A2Z OS: your account was recovered", text: "Executive recovery was carried out on your A2Z OS account: two-factor was reset and every device was signed out. Sign in with your password and set up two-factor again.\n\nIf you did not expect this, tell the CEO and the COO at once." });
  }
  return done;
}

export async function handleRecovery(env: Env, path: string, method: string, body: Record<string, unknown> | null, user: StaffUser): Promise<Response> {
  try { await env.DB.prepare(`SELECT id FROM exec_recovery_requests LIMIT 0`).all(); } catch { return err("migration_missing", "Run migration 0177 first (PUSH.bat).", 503); }
  const now = await dbNow(env);
  const oid = await ownerId(env);
  const isOwner = user.role === "ceo" && user.is_owner === true && oid === user.id;
  const members = await liveMembers(env);
  const mine = members.find((m) => m.user_id === user.id) ?? null;
  const myBlock = mine ? memberBlock(mine, now) : "not_a_member";
  const actingMember = !!mine && !myBlock;
  const reasonOf = (min: number) => (typeof body?.reason === "string" ? body.reason.trim().slice(0, 300) : "").length >= min ? (body!.reason as string).trim().slice(0, 300) : null;

  /* ---- the person who was recovered: review, then clear the flag ---- */
  if (path === "/recovery/review" && method === "GET") {
    const f = await env.DB.prepare(`SELECT recovery_rotation_required AS r, COALESCE(totp_enabled, 0) AS t FROM users WHERE id = ?1`).bind(user.id).first<{ r: number | null; t: number }>();
    const history = (await env.DB.prepare(`SELECT action, created_at FROM audit_log WHERE (user_id = ?1 OR entity_id = ?2) AND action LIKE 'auth.%' AND created_at >= datetime('now', '-30 days') ORDER BY id DESC LIMIT 30`).bind(user.id, String(user.id)).all()).results;
    return json({ required: !!f?.r, two_factor_on: !!f?.t, history });
  }
  if (path === "/recovery/review" && method === "POST") {
    const f = await env.DB.prepare(`SELECT recovery_rotation_required AS r FROM users WHERE id = ?1`).bind(user.id).first<{ r: number | null }>();
    if (!f?.r) return json({ ok: true });
    const su = await freshCode(env, user, body?.totp, "confirm you reviewed your account");
    if (su) return su;
    await env.DB.prepare(`UPDATE users SET recovery_rotation_required = NULL WHERE id = ?1`).bind(user.id).run();
    await audit(env, user.id, "auth.exec_recovery_reviewed", "users", String(user.id));
    return json({ ok: true });
  }

  const tgs = await targets(env);
  const isTarget = tgs.some((t) => t.id === user.id);
  if (!isOwner && !mine && user.role !== "super_admin" && !isTarget) return err("forbidden", "Only the company owner, the recovery panel and the Super Admin see executive recovery.", 403);

  /* ---- the panel and its requests ---- */
  if (path === "/recovery" && method === "GET") {
    await runDueRecoveries(env);
    const active = members.filter((m) => !memberBlock(m, now));
    const reqs = (await env.DB.prepare(
      `SELECT r.*, ${NAME} AS target_name, (SELECT COALESCE(NULLIF(TRIM(a.full_name), ''), a.name) FROM users a WHERE a.id = r.requested_by) AS requested_by_name,
              (SELECT COALESCE(NULLIF(TRIM(b.full_name), ''), b.name) FROM users b WHERE b.id = r.approved_by) AS approved_by_name
       FROM exec_recovery_requests r JOIN users u ON u.id = r.target_id ORDER BY r.id DESC LIMIT 20`,
    ).all<Req & { target_name: string; requested_by_name: string; approved_by_name: string | null }>()).results;
    const locks: { target_id: number; count: number }[] = [];
    for (const t of tgs) { const n = await lockCount(env, t.id); if (n >= LOCK_AFTER) locks.push({ target_id: t.id, count: n }); }
    return json({
      me: { is_owner: isOwner, member: mine ? { accepted: !!mine.accepted_at, effective_at: mine.effective_at, can_act: actingMember, why: myBlock } : null, is_target: isTarget },
      panel: members.map((m) => ({ id: m.id, user_id: m.user_id, name: m.name, role: m.role, accepted: !!m.accepted_at, effective_at: m.effective_at, active: !memberBlock(m, now), why: memberBlock(m, now) })),
      available: active.length >= 2,
      eligible: isOwner ? (await env.DB.prepare(`SELECT u.id, ${NAME} AS name, u.role FROM users u WHERE u.role IN ('coo', 'cco') AND u.is_active = 1 AND COALESCE(u.totp_enabled, 0) = 1 AND u.id NOT IN (SELECT user_id FROM exec_recovery_panel WHERE removed_at IS NULL) ORDER BY u.role`).all()).results : [],
      targets: tgs,
      locked: locks,
      requests: reqs.map((r) => ({
        id: r.id, target_id: r.target_id, target_name: r.target_name, requested_by_name: r.requested_by_name, approved_by_name: r.approved_by_name,
        reason: r.reason, identity_checked: r.identity_checked, identity_method: r.identity_method, unlink_google: !!r.unlink_google,
        status: r.status, created_at: r.created_at, approve_by: r.approve_by, approved_at: r.approved_at, execute_after: r.execute_after, executed_at: r.executed_at,
        cancelled_at: r.cancelled_at, cancel_reason: r.cancel_reason,
        can_approve: actingMember && r.status === "requested" && r.requested_by !== user.id && r.target_id !== user.id && r.approve_by > now,
        can_cancel: ["requested", "approved"].includes(r.status) && (actingMember || isOwner || r.target_id === user.id),
      })),
      limits: { approve_within_hours: APPROVE_WITHIN_H, execute_after_hours: EXECUTE_AFTER_H, effective_after_hours: EFFECTIVE_AFTER_H },
    });
  }

  /* the owner names a member: COO or CCO, two-factor on, counts after 24 hours and their own acceptance */
  if (path === "/recovery/panel" && method === "POST") {
    if (!isOwner) return err("forbidden", "Only the company owner names the recovery panel.", 403);
    const uid = Number(body?.user_id);
    const reason = reasonOf(10);
    if (!reason) return err("reason_required", "Give the reason (at least 10 characters).", 400);
    const t = await env.DB.prepare(`SELECT id, role, is_active, COALESCE(totp_enabled, 0) AS totp, employment_status, ${NAME.replace(/u\./g, "")} AS name FROM users WHERE id = ?1`).bind(uid).first<{ id: number; role: string; is_active: number; totp: number; employment_status: string | null; name: string }>();
    if (!t || !(PANEL_ROLES as readonly string[]).includes(t.role)) return err("invalid_member", "The recovery panel is the COO and the CCO.", 400);
    if (!t.is_active || ["resigned", "terminated"].includes(t.employment_status ?? "") || !t.totp) return err("invalid_member", "A panel member must be active with two-factor on.", 400);
    if (members.length >= MAX_MEMBERS) return err("panel_full", "The panel has its members already.", 409);
    if (members.some((m) => m.user_id === uid)) return err("already_member", "Already on the panel.", 409);
    const su = await freshCode(env, user, body?.totp, "name a recovery panel member");
    if (su) return su;
    await env.DB.prepare(`INSERT INTO exec_recovery_panel (user_id, added_by, added_reason, effective_at) VALUES (?1, ?2, ?3, datetime('now', '+${EFFECTIVE_AFTER_H} hours'))`).bind(uid, user.id, reason).run();
    await audit(env, user.id, "auth.exec_panel_added", "users", String(uid), { reason });
    await tell(env, uid, `${t.name} was named to the executive recovery panel. It counts after they accept with their own authenticator code, and 24 hours from now.`, `exec_panel_add:${uid}:${Date.now()}`);
    return json({ ok: true });
  }
  const rm = path.match(/^\/recovery\/panel\/(\d+)\/remove$/);
  if (rm && method === "POST") {
    if (!isOwner) return err("forbidden", "Only the company owner changes the recovery panel.", 403);
    const reason = reasonOf(10);
    if (!reason) return err("reason_required", "Give the reason (at least 10 characters).", 400);
    const m = members.find((x) => x.id === Number(rm[1]));
    if (!m) return err("not_found", "No such member", 404);
    const su = await freshCode(env, user, body?.totp, "remove a recovery panel member");
    if (su) return su;
    await env.DB.prepare(`UPDATE exec_recovery_panel SET removed_at = datetime('now'), removed_by = ?2, removed_reason = ?3 WHERE id = ?1 AND removed_at IS NULL`).bind(m.id, user.id, reason).run();
    await audit(env, user.id, "auth.exec_panel_removed", "users", String(m.user_id), { reason });
    await tell(env, m.user_id, `${m.name} was removed from the executive recovery panel.`, `exec_panel_rm:${m.id}`);
    return json({ ok: true });
  }
  if (path === "/recovery/panel/accept" && method === "POST") {
    if (!mine) return err("forbidden", "You are not named to the recovery panel.", 403);
    if (mine.accepted_at) return json({ ok: true });
    const su = await freshCode(env, user, body?.totp, "accept the recovery panel role");
    if (su) return su;
    await env.DB.prepare(`UPDATE exec_recovery_panel SET accepted_at = datetime('now') WHERE id = ?1 AND accepted_at IS NULL AND removed_at IS NULL`).bind(mine.id).run();
    await audit(env, user.id, "auth.exec_panel_accepted", "users", String(user.id));
    return json({ ok: true });
  }

  /* a member asks to recover the owner or the Super Admin */
  if (path === "/recovery/requests" && method === "POST") {
    if (!actingMember) return err("forbidden", "Only an active recovery panel member can ask.", 403);
    const tid = Number(body?.target_id);
    if (!tgs.some((t) => t.id === tid)) return err("invalid_target", "The panel recovers only the company owner and the Super Admin.", 400);
    if (tid === user.id) return err("self", "Never your own account.", 400);
    const reason = reasonOf(10);
    const checked = typeof body?.identity_checked === "string" ? body.identity_checked.trim().slice(0, 200) : "";
    const how = body?.identity_method === "in_person" || body?.identity_method === "video_call" ? body.identity_method : "";
    if (!reason) return err("reason_required", "Give the reason (at least 10 characters).", 400);
    if (checked.length < 10 || !how) return err("identity_required", "Say how you checked who they are (in person or by video call, ID document seen).", 400);
    if (members.filter((m) => !memberBlock(m, now) && m.user_id !== user.id && m.user_id !== tid).length < 1) return err("panel_unavailable", "No second panel member can approve right now - the owner must name one, or use the Level 2 procedure.", 409);
    if ((await lockCount(env, tid)) >= LOCK_AFTER) return err("locked", "Three requests for this account were cancelled or lapsed in 30 days - the owner (or, for the owner, the Super Admin) must review first.", 423);
    const su = await freshCode(env, user, body?.totp, "ask for an executive recovery");
    if (su) return su;
    try {
      await env.DB.prepare(
        `INSERT INTO exec_recovery_requests (target_id, requested_by, reason, identity_checked, identity_method, unlink_google, approve_by) VALUES (?1, ?2, ?3, ?4, ?5, ?6, datetime('now', '+${APPROVE_WITHIN_H} hours'))`,
      ).bind(tid, user.id, reason, checked, how, body?.unlink_google === true ? 1 : 0).run();
    } catch (e) {
      if (/UNIQUE/i.test(String(e))) return err("open_request", "There is already an open recovery request for this account.", 409);
      throw e;
    }
    const t = tgs.find((x) => x.id === tid)!;
    await audit(env, user.id, "auth.exec_recovery_requested", "users", String(tid), { reason, identity_method: how, unlink_google: body?.unlink_google === true });
    await tell(env, tid, `${user.name} asked for an executive recovery of ${t.name}'s account. A second panel member must approve within 24 hours; it then runs 12 hours later. If this is wrong, cancel it in Profile -> Security.`, `exec_rec_req:${tid}:${Date.now()}`);
    return json({ ok: true });
  }
  const act = path.match(/^\/recovery\/requests\/(\d+)\/(approve|cancel)$/);
  if (act && method === "POST") {
    await lapse(env);
    const r = await env.DB.prepare(`SELECT * FROM exec_recovery_requests WHERE id = ?1`).bind(Number(act[1])).first<Req>();
    if (!r) return err("not_found", "No such request", 404);
    if (act[2] === "approve") {
      if (!actingMember) return err("forbidden", "Only an active recovery panel member can approve.", 403);
      if (r.requested_by === user.id) return err("same_person", "A second member must approve - not the one who asked.", 403);
      if (r.target_id === user.id) return err("self", "Never your own account.", 403);
      if (r.status !== "requested") return err("invalid_state", `This request is ${r.status}.`, 409);
      const confirmed = typeof body?.identity_confirmed === "string" ? body.identity_confirmed.trim().slice(0, 200) : "";
      if (confirmed.length < 10) return err("identity_required", "Say how YOU checked who they are - independently of the request.", 400);
      const su = await freshCode(env, user, body?.totp, "approve an executive recovery");
      if (su) return su;
      const u = await env.DB.prepare(
        `UPDATE exec_recovery_requests SET status = 'approved', approved_by = ?2, approved_at = datetime('now'), approver_identity = ?3, execute_after = datetime('now', '+${EXECUTE_AFTER_H} hours')
         WHERE id = ?1 AND status = 'requested' AND approve_by > datetime('now') AND requested_by != ?2 AND target_id != ?2`,
      ).bind(r.id, user.id, confirmed).run();
      if (Number(u.meta?.changes ?? 0) !== 1) return err("changed_meanwhile", "The request changed meanwhile - reload.", 409);
      await audit(env, user.id, "auth.exec_recovery_approved", "users", String(r.target_id), { request_id: r.id });
      await tell(env, r.target_id, `${user.name} approved the executive recovery request #${r.id}. It runs in 12 hours unless someone on the panel, the owner or the account holder cancels it.`, `exec_rec_ok:${r.id}`);
      return json({ ok: true });
    }
    /* cancel: any active member, the owner, or the target - each with a fresh code */
    if (!(actingMember || isOwner || r.target_id === user.id)) return err("forbidden", "Only the panel, the owner or the account holder can cancel.", 403);
    if (!["requested", "approved"].includes(r.status)) return err("invalid_state", `This request is ${r.status}.`, 409);
    const reason = reasonOf(5);
    if (!reason) return err("reason_required", "Give the reason.", 400);
    const su = await freshCode(env, user, body?.totp, "cancel an executive recovery");
    if (su) return su;
    const u = await env.DB.prepare(`UPDATE exec_recovery_requests SET status = 'cancelled', cancelled_by = ?2, cancelled_at = datetime('now'), cancel_reason = ?3 WHERE id = ?1 AND status IN ('requested', 'approved')`).bind(r.id, user.id, reason).run();
    if (Number(u.meta?.changes ?? 0) !== 1) return err("changed_meanwhile", "The request changed meanwhile - reload.", 409);
    await audit(env, user.id, "auth.exec_recovery_cancelled", "users", String(r.target_id), { request_id: r.id, reason });
    await tell(env, r.target_id, `${user.name} cancelled the executive recovery request #${r.id}.`, `exec_rec_x:${r.id}`);
    return json({ ok: true });
  }
  /* after three cancelled or lapsed requests the flow locks for that account until reviewed */
  if (path === "/recovery/unlock" && method === "POST") {
    const tid = Number(body?.target_id);
    const allowed = tid === oid ? user.role === "super_admin" : isOwner;
    if (!allowed) return err("forbidden", "The owner reviews a locked recovery (the Super Admin, when it is the owner's).", 403);
    const reason = reasonOf(10);
    if (!reason) return err("reason_required", "Give the reason (at least 10 characters).", 400);
    const su = await freshCode(env, user, body?.totp, "reopen executive recovery");
    if (su) return su;
    await audit(env, user.id, "auth.exec_recovery_unlocked", "users", String(tid), { reason });
    return json({ ok: true });
  }
  return err("not_found", "Not found", 404);
}
