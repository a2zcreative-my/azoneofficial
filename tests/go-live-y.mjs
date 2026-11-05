/* SECURE AUTHENTICATION 2.0, PHASE R - EXECUTIVE RECOVERY (v1.268.0). Runtime
 * guard: the WHOLE worker (index.ts, bundled) against SQLite with every
 * migration applied, by direct request.
 *
 * claude/PHASE-R-GOVERNANCE.md revision 2 (the CEO approved 05-11-2026):
 *   panel     only the company owner names it (COO, CCO), with a reason and a
 *             code; a member counts only after accepting with their OWN code
 *             and 24 hours; never the Super Admin, never an unenrolled person
 *   targets   only the company owner and the Super Admin
 *   two       one member asks, a DIFFERENT member approves; never the
 *             target; each step needs that person's fresh code - a stolen
 *             session alone does nothing
 *   wait      runs 12 hours after approval; anyone on the panel, the owner
 *             or the target can cancel; a request not approved in 24 hours
 *             lapses; three cancelled or lapsed in 30 days lock it until the
 *             owner (for the owner: the Super Admin) reviews
 *   effect    one guarded batch: 2FA off, backup codes, challenges, sessions,
 *             set-password and Google requests voided, forced rotation;
 *             optional Google disconnect - and NOTHING else: no role, owner,
 *             email, permission, payroll or finance change; other accounts
 *             untouched; owner authority pauses until 2FA is back
 *   changed   a member removed or switched off before the run: it does not run
 * Then mutated copies must each fail a check. Invented people only.
 *
 *   node tests/go-live-y.mjs
 */
import { readFileSync, readdirSync, mkdtempSync, writeFileSync, cpSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash, createHmac } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const root = fileURLToPath(new URL("..", import.meta.url));
const bundle = (srcRoot, entry, out) => execSync(`npx esbuild "${join(srcRoot, entry)}" --bundle --format=esm --platform=neutral --outfile="${out}" --log-level=error`, { cwd: root, stdio: "inherit" });
const SECRET = "JBSWY3DPEHPK3PXP";
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const b32 = (s) => { let bits = 0, v = 0; const o = []; for (const ch of s) { v = (v << 5) | B32.indexOf(ch); bits += 5; if (bits >= 8) { o.push((v >>> (bits - 8)) & 255); bits -= 8; } } return Buffer.from(o); };
const totpAt = (ms) => { const c = Math.floor(ms / 30000); const b = Buffer.alloc(8); b.writeUInt32BE(Math.floor(c / 2 ** 32), 0); b.writeUInt32BE(c >>> 0, 4); const h = createHmac("sha1", b32(SECRET)).update(b).digest(); const o = h[h.length - 1] & 15; return String((((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1e6).padStart(6, "0"); };
const sha = (s) => createHash("sha256").update(s).digest("hex");

async function runtime(workerBundle) {
  const out = [];
  const ok = (c, m, why = "") => out.push([!!c, why && !c ? `${m} - ${why}` : m]);
  const db = new DatabaseSync(":memory:");
  for (const f of readdirSync(join(root, "worker/migrations")).filter((x) => x.endsWith(".sql")).sort()) {
    for (const st of readFileSync(join(root, "worker/migrations", f), "utf8").split(/;\s*\n/)) { try { db.exec(st); } catch { /* a statement SQLite reads differently */ } }
  }
  const shim = (sql) => { const st = db.prepare(sql); let b = []; const o = {
    bind: (...a) => { b = a.map((x) => (x === undefined ? null : x)); return o; },
    first: async () => st.get(...b) ?? null, all: async () => ({ results: st.all(...b) }),
    run: async () => ({ meta: { changes: Number(st.run(...b).changes) } }), _run: () => st.run(...b) }; return o; };
  const env = {
    DB: { prepare: shim, batch: async (list) => { db.exec("BEGIN"); try { for (const s of list) s._run(); db.exec("COMMIT"); } catch (e) { db.exec("ROLLBACK"); throw e; } return []; } },
    SESSION_PEPPER: "pepper", COMPANY_DOMAIN: "a2z.test", ALLOWED_ORIGINS: "https://portal.a2z.test",
    GOOGLE_CLIENT_ID: "cid", GOOGLE_CLIENT_SECRET: "csecret",
    MEDIA: { put: async () => {}, head: async () => null, get: async () => null, list: async () => ({ objects: [] }) },
  };
  /* invented people: 1 the CEO (company owner), 2 the Super Admin, 3 COO, 6 CCO,
     7 HR, 10 editor, 12 a second CEO-role account, 13 a COO without 2FA */
  db.exec(`INSERT INTO users (id, name, full_name, email, role, is_active, password_hash, totp_enabled, totp_secret, google_sub) VALUES
    (1,'Owner','Owner Person','owner@a2z.test','ceo',1,'x',1,'${SECRET}','g-owner'),
    (2,'Super Admin','Root Person','root@a2z.test','super_admin',1,'x',1,'${SECRET}',NULL),
    (3,'Coo','Coo Person','coo@a2z.test','coo',1,'x',1,'${SECRET}',NULL),
    (6,'Cco','Cco Person','cco@a2z.test','cco',1,'x',1,'${SECRET}',NULL),
    (7,'Hr','Hr Person','hr@a2z.test','hr_admin',1,'x',1,'${SECRET}',NULL),
    (10,'Ed','Ed Person','ed@a2z.test','editor',1,'x',1,'${SECRET}',NULL),
    (12,'Second','Second Ceo','ceo2@a2z.test','ceo',1,'x',1,'${SECRET}',NULL),
    (13,'Coo2','Coo Two','coo2@a2z.test','coo',1,'x',0,NULL,NULL)`);
  db.exec(`INSERT INTO system_meta (key, value) VALUES ('company_owner', '{"user_id":1,"set_by":2,"set_by_name":"Super Admin","set_at":"2026-11-02 06:00:54","reason":"test"}')`);
  for (const id of [1, 2, 3, 6]) for (let i = 0; i < 8; i++) db.prepare(`INSERT INTO twofa_backup_codes (user_id, code_hash) VALUES (?, ?)`).run(id, `h${id}-${i}`);
  const RealDate = globalThis.Date; let fixed = new RealDate("2026-11-05T02:00:00Z").getTime();
  globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [fixed])); } static now() { return fixed; } };
  const code = () => { fixed += 31000; return totpAt(fixed); };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("{}", { status: 200 });
  const worker = (await import(pathToFileURL(workerBundle).href + `?v=${Math.random()}`)).default;
  const tok = {};
  const signIn = (id) => {
    tok[id] = `t-${id}-${Math.random()}`;
    db.prepare(`INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, datetime('now', '+12 hours'), datetime('now'))`).run(sha(tok[id]), id);
  };
  for (const id of [1, 2, 3, 6, 7, 10, 12, 13]) signIn(id);
  const call = async (path, uid, method = "GET", body) => {
    const headers = { "content-type": "application/json", origin: "https://portal.a2z.test", ...(uid ? { cookie: `azone_session=${tok[uid]}; csrf_token=c1`, "x-csrf-token": "c1" } : {}) };
    const r = await worker.fetch(new Request(`https://api.a2z.test/api/v1${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined }), env);
    const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch { /* */ }
    return { status: r.status, j, text };
  };
  const R = (p, uid, body) => call(`/staff/recovery${p}`, uid, "POST", body);
  const state = (uid) => call("/staff/recovery", uid);
  const user = (id) => db.prepare(`SELECT * FROM users WHERE id = ?`).get(id);
  const sessions = (id) => db.prepare(`SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?`).get(id).n;
  const backups = (id) => db.prepare(`SELECT COUNT(*) AS n FROM twofa_backup_codes WHERE user_id = ?`).get(id).n;
  const lastAudit = (a) => { const r = db.prepare(`SELECT * FROM audit_log WHERE action = ? ORDER BY id DESC LIMIT 1`).get(a); return r ? { ...r, d: JSON.parse(r.detail ?? "{}") } : null; };
  const reqRow = (id) => db.prepare(`SELECT * FROM exec_recovery_requests WHERE id = ?`).get(id);
  const lastReq = () => db.prepare(`SELECT * FROM exec_recovery_requests ORDER BY id DESC LIMIT 1`).get();
  const snapshot = () => JSON.stringify(db.prepare(`SELECT id, role, email, is_active, employment_status FROM users ORDER BY id`).all()) + JSON.stringify(db.prepare(`SELECT value FROM system_meta WHERE key = 'company_owner'`).get());
  const pass = (id) => db.exec(`UPDATE exec_recovery_requests SET execute_after = datetime('now', '-1 minute') WHERE id = ${id}`); // 12 hours later
  const RQ = { reason: "Lost the phone with the authenticator", identity_checked: "Seen in the office, MyKad checked by me", identity_method: "in_person" };

  try {
    /* ---------- who sees it ---------- */
    ok((await state(10)).status === 403 && (await state(7)).status === 403, "an editor and HR do not see executive recovery");
    const s0 = await state(1);
    ok(s0.status === 200 && s0.j?.me?.is_owner === true && s0.j.panel.length === 0 && s0.j.available === false, "the owner sees an empty panel, not ready", s0.text.slice(0, 200));
    ok(s0.j?.eligible?.map((e) => e.id).sort().join() === "3,6", "only the COO and the CCO with two-factor can be named (not the COO without it, not the Super Admin)", JSON.stringify(s0.j?.eligible));
    ok(s0.j?.targets?.map((t) => t.id).sort().join() === "1,2", "the panel can recover only the company owner and the Super Admin", JSON.stringify(s0.j?.targets));
    ok((await state(2)).status === 200 && (await state(1)).j?.requests?.length === 0, "the Super Admin sees it too");

    /* ---------- the panel: only the owner names it ---------- */
    const add = (uid, id, extra = {}) => R("/panel", uid, { user_id: id, reason: "Recovery panel member as approved", totp: code(), ...extra });
    ok((await add(3, 6)).status === 403 && (await add(2, 3)).status === 403 && (await add(12, 3)).status === 403, "nobody but the company owner names the panel (not the COO, the Super Admin or a second CEO account)");
    ok((await add(1, 3, { reason: "short" })).j?.error?.code === "reason_required", "a reason is required");
    ok((await add(1, 3, { totp: undefined })).status === 401, "...and the owner's fresh code");
    ok((await add(1, 7)).j?.error?.code === "invalid_member" && (await add(1, 13)).j?.error?.code === "invalid_member" && (await add(1, 2)).j?.error?.code === "invalid_member", "HR, a COO without two-factor and the Super Admin cannot be named");
    ok((await add(1, 3)).status === 200 && lastAudit("auth.exec_panel_added")?.entity_id === "3", "the owner names the COO, audited");
    ok(db.prepare(`SELECT COUNT(*) AS n FROM notifications WHERE user_id = 3 AND kind = 'security'`).get().n >= 1, "...and the COO is told");
    const s1 = await state(3);
    ok(s1.j?.me?.member?.accepted === false && s1.j.me.member.can_act === false && s1.j.panel[0].why === "not_accepted", "the COO does not count until they accept", JSON.stringify(s1.j?.me));
    ok((await R("/panel/accept", 3, {})).status === 401, "accepting needs the member's OWN code");
    ok((await R("/panel/accept", 3, { totp: code() })).status === 200 && (await state(3)).j?.panel?.[0]?.why === "not_yet_effective", "accepted - and still not counting before 24 hours");
    ok((await R("/requests", 3, { target_id: 1, ...RQ, totp: code() })).status === 403, "a member who does not count yet cannot ask");
    db.exec(`UPDATE exec_recovery_panel SET effective_at = datetime('now', '-1 minute') WHERE user_id = 3`); // 24 hours later
    ok((await R("/requests", 3, { target_id: 1, ...RQ, totp: code() })).j?.error?.code === "panel_unavailable", "with one active member there is nobody to approve: the request is refused, Level 2 only");
    ok((await add(1, 6)).status === 200 && (await R("/panel/accept", 6, { totp: code() })).status === 200, "the owner names the CCO, who accepts");
    db.exec(`UPDATE exec_recovery_panel SET effective_at = datetime('now', '-1 minute') WHERE user_id = 6`);
    ok((await state(1)).j?.available === true, "two active members: the panel is ready");

    /* ---------- a request ---------- */
    ok((await R("/requests", 6, { target_id: 3, ...RQ, totp: code() })).j?.error?.code === "invalid_target", "the panel cannot recover a COO (or any other account)");
    ok((await R("/requests", 6, { target_id: 12, ...RQ, totp: code() })).j?.error?.code === "invalid_target", "...nor a second CEO-role account that is not the owner");
    ok((await R("/requests", 6, { target_id: 1, ...RQ, identity_checked: "ok", totp: code() })).j?.error?.code === "identity_required", "how the identity was checked is required");
    ok((await R("/requests", 6, { target_id: 1, ...RQ, identity_method: "email", totp: code() })).j?.error?.code === "identity_required", "...in person or by video call only");
    ok((await R("/requests", 6, { target_id: 1, ...RQ })).status === 401, "a stolen session alone cannot ask: the member's fresh code is required");
    ok((await R("/requests", 10, { target_id: 1, ...RQ, totp: code() })).status === 403, "a non-member cannot ask");
    const before = snapshot();
    const r1 = await R("/requests", 6, { target_id: 1, ...RQ, totp: code() });
    const q1 = lastReq();
    ok(r1.status === 200 && q1.status === "requested" && q1.requested_by === 6 && lastAudit("auth.exec_recovery_requested")?.entity_id === "1", "the CCO asks to recover the CEO", r1.text);
    ok(db.prepare(`SELECT COUNT(*) AS n FROM notifications WHERE user_id = 1 AND kind = 'security' AND message LIKE '%executive recovery%'`).get().n >= 1, "...the CEO is told at once");
    ok((await R("/requests", 3, { target_id: 1, ...RQ, totp: code() })).j?.error?.code === "open_request", "one open request per account");
    ok((await R(`/requests/${q1.id}/cancel`, 2, { reason: "Not for me to decide", totp: code() })).status === 403 && reqRow(q1.id).status === "requested", "the Super Admin (not on the panel, not the owner, not the target) cannot cancel the CEO's request");
    /* ---------- approval ---------- */
    ok((await R(`/requests/${q1.id}/approve`, 6, { identity_confirmed: "Video call, MyKad shown to me", totp: code() })).j?.error?.code === "same_person", "the member who asked cannot approve");
    ok((await R(`/requests/${q1.id}/approve`, 1, { identity_confirmed: "Video call, MyKad shown to me", totp: code() })).status === 403, "the target (the CEO) cannot approve their own recovery");
    ok((await R(`/requests/${q1.id}/approve`, 2, { identity_confirmed: "Video call, MyKad shown to me", totp: code() })).status === 403, "the Super Admin is not on the panel and cannot approve");
    ok((await R(`/requests/${q1.id}/approve`, 3, { identity_confirmed: "ok", totp: code() })).j?.error?.code === "identity_required", "the approver records their OWN identity check");
    ok((await R(`/requests/${q1.id}/approve`, 3, { identity_confirmed: "Video call, MyKad shown to me" })).status === 401, "...with their fresh code");
    const ap = await R(`/requests/${q1.id}/approve`, 3, { identity_confirmed: "Video call, MyKad shown to me", totp: code() });
    const q1b = reqRow(q1.id);
    ok(ap.status === 200 && q1b.status === "approved" && q1b.approved_by === 3 && q1b.execute_after > q1b.approved_at, "a different member approves", ap.text);
    const hrs = (new RealDate(q1b.execute_after.replace(" ", "T") + "Z") - new RealDate(q1b.approved_at.replace(" ", "T") + "Z")) / 3600000;
    ok(Math.abs(hrs - 12) < 0.01, "...and it waits 12 hours", String(hrs));
    await state(1);
    ok(reqRow(q1.id).status === "approved" && user(1).totp_enabled === 1 && sessions(1) >= 1, "nothing happens before the 12 hours are over");
    /* ---------- execution ---------- */
    pass(q1.id);
    signIn(1); // a second device of the CEO, still signed in
    await state(3);
    const u1 = user(1);
    ok(reqRow(q1.id).status === "executed" && u1.totp_enabled === 0 && u1.totp_secret === null && backups(1) === 0 && sessions(1) === 0 && u1.recovery_rotation_required === 1, "after 12 hours it runs: two-factor off, backup codes gone, every session ended, rotation required", JSON.stringify({ s: reqRow(q1.id).status, t: u1.totp_enabled, b: backups(1), n: sessions(1) }));
    ok(snapshot() === before && u1.google_sub === "g-owner", "...and NOTHING else: no role, email, status or owner designation changed; Google kept (not asked)", "");
    ok(user(3).totp_enabled === 1 && backups(3) === 8 && sessions(3) >= 1 && user(2).totp_enabled === 1, "other accounts untouched");
    ok(lastAudit("auth.exec_recovery_executed")?.d?.requested_by === 6 && lastAudit("auth.exec_recovery_executed").d.approved_by === 3, "audited with both members");
    signIn(1);
    const gate = await call("/staff/profile", 1);
    ok(gate.status === 403 && gate.j?.error?.code === "twofa_required", "the CEO signs in with the password and must set up two-factor again (the existing gate)", gate.text.slice(0, 120));
    ok((await call("/staff/recovery/panel", 1, "POST", { user_id: 6, reason: "Recovery panel member as approved", totp: code() })).status === 403, "owner authority pauses until two-factor is back");
    db.prepare(`UPDATE users SET totp_enabled = 1, totp_secret = ? WHERE id = 1`).run(SECRET); // the CEO sets it up again
    const rv = await call("/staff/recovery/review", 1);
    ok(rv.j?.required === true && rv.j.two_factor_on === true && rv.j.history.some((h) => h.action === "auth.exec_recovery_executed"), "the CEO is shown the recovery in their recent activity to review", rv.text.slice(0, 200));
    ok((await R("/review", 1, {})).status === 401, "confirming the review needs a code");
    ok((await R("/review", 1, { totp: code() })).status === 200 && user(1).recovery_rotation_required === null, "...then the flag clears");
    ok((await state(1)).j?.me?.is_owner === true, "owner authority returns by itself");

    /* ---------- cancel ---------- */
    const r2 = await R("/requests", 3, { target_id: 2, ...RQ, unlink_google: true, totp: code() });
    const q2 = lastReq();
    ok(r2.status === 200 && q2.target_id === 2, "the COO asks to recover the Super Admin");
    ok((await R(`/requests/${q2.id}/approve`, 6, { identity_confirmed: "In person, passport seen by me", totp: code() })).status === 200, "the CCO approves");
    ok((await R(`/requests/${q2.id}/cancel`, 10, { reason: "not mine", totp: code() })).status === 403, "an outsider cannot cancel");
    ok((await R(`/requests/${q2.id}/cancel`, 2, { reason: "This was not me" })).status === 401, "the target cancels with their code (a stolen session alone cannot)");
    ok((await R(`/requests/${q2.id}/cancel`, 2, { reason: "This was not me", totp: code() })).status === 200 && reqRow(q2.id).status === "cancelled", "the Super Admin cancels the recovery of their own account during the wait");
    pass(q2.id); await state(3);
    ok(reqRow(q2.id).status === "cancelled" && user(2).totp_enabled === 1, "a cancelled request never runs");

    /* ---------- a member changed before the run ---------- */
    const r3 = await R("/requests", 6, { target_id: 2, ...RQ, totp: code() });
    const q3 = lastReq();
    await R(`/requests/${q3.id}/approve`, 3, { identity_confirmed: "In person, passport seen by me", totp: code() });
    db.exec(`UPDATE users SET totp_enabled = 0 WHERE id = 3`); // the approver loses two-factor
    pass(q3.id); await state(6);
    ok(r3.status === 200 && reqRow(q3.id).status === "cancelled" && user(2).totp_enabled === 1, "if a member is no longer active when it is due, it does not run", JSON.stringify(reqRow(q3.id)));
    db.exec(`UPDATE users SET totp_enabled = 1 WHERE id = 3`);

    /* ---------- lapse and lock ---------- */
    for (let i = 0; i < 2; i++) {
      await R("/requests", 6, { target_id: 2, ...RQ, totp: code() });
      db.exec(`UPDATE exec_recovery_requests SET approve_by = datetime('now', '-1 minute') WHERE id = ${lastReq().id}`); // 24 hours, nobody approved
      await state(6);
    }
    ok(lastReq().status === "lapsed", "a request not approved within 24 hours lapses");
    const lk = await R("/requests", 6, { target_id: 2, ...RQ, totp: code() });
    ok(lk.status === 423 && lk.j?.error?.code === "locked", "three cancelled or lapsed in 30 days lock recovery for that account", lk.text);
    ok((await state(1)).j?.locked?.some((l) => l.target_id === 2), "...shown to the owner");
    ok((await R("/unlock", 3, { target_id: 2, reason: "Reviewed with the team", totp: code() })).status === 403, "a member cannot reopen it");
    ok((await R("/unlock", 1, { target_id: 2, reason: "Reviewed with the team", totp: code() })).status === 200, "the owner reviews and reopens it");
    const r4 = await R("/requests", 6, { target_id: 2, ...RQ, unlink_google: true, totp: code() });
    ok(r4.status === 200, "...then a request can be made again", r4.text);
    db.exec(`UPDATE users SET google_sub = 'g-root' WHERE id = 2`);
    await R(`/requests/${lastReq().id}/approve`, 3, { identity_confirmed: "In person, passport seen by me", totp: code() });
    pass(lastReq().id); await state(1);
    ok(lastReq().status === "executed" && user(2).google_sub === null && user(2).totp_enabled === 0 && user(2).role === "super_admin", "with 'also disconnect Google' asked and approved, Google goes too - the role stays");

    /* ---------- removing a member ---------- */
    const pid = db.prepare(`SELECT id FROM exec_recovery_panel WHERE user_id = 6 AND removed_at IS NULL`).get().id;
    ok((await R(`/panel/${pid}/remove`, 3, { reason: "Leaving the company soon", totp: code() })).status === 403, "only the owner removes a member");
    ok((await R(`/panel/${pid}/remove`, 1, { reason: "Leaving the company soon", totp: code() })).status === 200 && (await state(1)).j?.available === false, "the owner removes the CCO: the panel is not ready");
    ok((await R("/requests", 6, { target_id: 1, ...RQ, totp: code() })).status === 403, "a removed member can no longer ask");
    ok(db.prepare(`SELECT COUNT(*) AS n FROM exec_recovery_panel WHERE removed_at IS NOT NULL`).get().n === 1, "...the membership stays as history");

    /* ---------- the cron runs it too ---------- */
    ok(/runDueRecoveries\(env\)/.test(readFileSync(join(root, "worker/src/index.ts"), "utf8")), "the five-minute tick runs due recoveries");
  } catch (e) {
    out.push([false, `runtime: ${e?.stack ?? e}`]);
  } finally {
    globalThis.Date = RealDate;
    globalThis.fetch = realFetch;
  }
  return out;
}

let fail = 0, n = 0;
const report = (list) => { for (const [p, m] of list) { n++; if (!p) { fail++; console.error(`FAIL ${m}`); } } };
const NOMUT = process.env.NOMUT === "1";
const dir = mkdtempSync(join(tmpdir(), "gly-"));
bundle(root, "worker/src/index.ts", join(dir, "worker.mjs"));
report(await runtime(join(dir, "worker.mjs")));
const checks = n;

/* each must be caught by a check above; a mutation may change several places */
const F = "worker/src/recovery.ts";
const MUT = [
  [F, "the requester approves their own request", [['      if (r.requested_by === user.id) return err("same_person"', '      if (false) return err("same_person"'], [" AND requested_by != ?2 AND target_id != ?2", " AND target_id != ?2"]]],
  [F, "no waiting period", [["execute_after = datetime('now', '+${EXECUTE_AFTER_H} hours')", "execute_after = datetime('now')"]]],
  [F, "no fresh code", [['  if (!t?.t) return err("twofa_required", "Two-factor must be on for this.", 403);\n  return await requireFreshTotp(env, user, code, err, what);', "  return null;"]]],
  [F, "a member counts without accepting", [['  if (!m.accepted_at) return "not_accepted";\n', ""]]],
  [F, "a member counts before 24 hours", [['  if (m.effective_at > now) return "not_yet_effective";\n', ""]]],
  [F, "anyone names the panel", [['    if (!isOwner) return err("forbidden", "Only the company owner names the recovery panel.", 403);', ""]]],
  [F, "any role on the panel", [["const PANEL_ROLES = [\"coo\", \"cco\"] as const;", "const PANEL_ROLES = [\"coo\", \"cco\", \"super_admin\", \"hr_admin\", \"editor\"] as const;"]]],
  [F, "any account recovered", [["WHERE (u.role = 'super_admin' OR (u.role = 'ceo' AND u.id = ?1))", "WHERE (u.role != 'customer' OR ?1 IS NULL)"]]],
  [F, "sessions not ended", [["        env.DB.prepare(`DELETE FROM sessions WHERE user_id = ?1`).bind(r.target_id),\n", ""]]],
  [F, "backup codes kept", [["        env.DB.prepare(`DELETE FROM twofa_backup_codes WHERE user_id = ?1`).bind(r.target_id),\n", ""]]],
  [F, "recovery also changes the email", [["recovery_rotation_required = 1${", "recovery_rotation_required = 1, email = 'x' || id${"]]],
  [F, "no lock after three", [["    if ((await lockCount(env, tid)) >= LOCK_AFTER) return err(", "    if (false) return err("]]],
  [F, "a changed panel still runs", [["    if (!ok(r.requested_by) || !ok(r.approved_by) || !tg) {", "    if (false) {"]]],
  [F, "anyone cancels", [["    if (!(actingMember || isOwner || r.target_id === user.id)) return err(\"forbidden\"", "    if (false) return err(\"forbidden\""]]],
  [F, "a lone member asks", [["    if (members.filter((m) => !memberBlock(m, now) && m.user_id !== user.id && m.user_id !== tid).length < 1) return err(", "    if (false) return err("]]],
  [F, "no lapse", [["  await env.DB.prepare(`UPDATE exec_recovery_requests SET status = 'lapsed' WHERE status = 'requested' AND approve_by <= datetime('now')`).run();", "  await env.DB.prepare(`SELECT 1`).run();"]]],
];
for (const [file, name, reps] of NOMUT ? [] : MUT) {
  n++;
  let src = readFileSync(join(root, file), "utf8");
  let applied = true;
  for (const [from, to] of reps) { if (!src.includes(from)) { applied = false; break; } src = src.replace(from, to); }
  if (!applied) { fail++; console.error(`FAIL mutation did not apply: ${name}`); continue; }
  const mdir = mkdtempSync(join(tmpdir(), "gly-m-"));
  cpSync(join(root, "worker"), join(mdir, "worker"), { recursive: true, filter: (s) => !s.includes("node_modules") });
  cpSync(join(root, "package.json"), join(mdir, "package.json"));
  for (const d of ["lib", "constants", "types"]) { try { cpSync(join(root, d), join(mdir, d), { recursive: true }); } catch { /* not every folder exists */ } }
  writeFileSync(join(mdir, file), src);
  try { bundle(mdir, "worker/src/index.ts", join(mdir, "worker.mjs")); } catch { fail++; console.error(`FAIL mutation did not build: ${name}`); continue; }
  const res = await runtime(join(mdir, "worker.mjs"));
  if (!res.some(([p]) => !p)) { fail++; console.error(`FAIL mutation not caught: ${name}`); }
}
if (fail) { console.error(`go-live-y: ${fail} of ${n} failed`); process.exit(1); }
console.log(`go-live-y: ${checks} checks passed (${NOMUT ? "mutations skipped" : `${MUT.length} mutations caught`}) - two people, never the target, 12 hours, nothing but sign-in reset`);
