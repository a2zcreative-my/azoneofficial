/* PHASE 0 - NO ORDINARY SELF-DECISION (v1.271.0). Runtime guard: the WHOLE
 * worker (index.ts, bundled) against SQLite with every migration applied, by
 * direct request (claude/PHASE0-SAFETY-REVIEW.md; the CEO, 06-11-2026:
 * "Do overall phase 0", D10: "I am a CEO why I need to get an approval?").
 *
 *   rule       whoever holds a decision permission may not use it on their own
 *              record (applicant, payee, subject, recipient): claims decide and
 *              paid, forgotten punches, manual punches, punch edits and
 *              deletions, unpaid days (record, change, remove), commission
 *              decisions - 10 routes; refused 403 self_approval, audited
 *   owner      the verified company owner's own record is an EXECUTIVE RECORD:
 *              it goes through, is audited auth.executive_self_record and the
 *              COO is told; the route's own code (claim approval) still applies
 *   not owner  the Super Admin, a second CEO-role account, HR admin, the COO -
 *              and any role given these permissions in Roles & Permissions -
 *              are refused on their own records and allowed on others'
 *   pending    a refused forgotten punch stays pending for another approver
 *   buttons    the claim list stops offering approve / pay on one's own claim
 * Then mutated copies must each fail a check. Invented people only.
 *
 *   node tests/self-approval.mjs
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
    for (const st of readFileSync(join(root, "worker/migrations", f), "utf8").split(/;\s*\n/)) { try { db.exec(st); } catch { /* a statement SQLite reads differently, or a column 0081 already made */ } }
  }
  const shim = (sql) => { const st = db.prepare(sql); let b = []; const o = {
    bind: (...a) => { b = a.map((x) => (x === undefined ? null : x)); return o; },
    first: async () => st.get(...b) ?? null, all: async () => ({ results: st.all(...b) }),
    run: async () => ({ meta: { changes: Number(st.run(...b).changes) } }), _run: () => ({ meta: { changes: Number(st.run(...b).changes) } }) }; return o; };
  const env = {
    DB: { prepare: shim, batch: async (list) => { db.exec("BEGIN"); try { const r = list.map((s) => s._run()); db.exec("COMMIT"); return r; } catch (e) { db.exec("ROLLBACK"); throw e; } } },
    SESSION_PEPPER: "pepper", COMPANY_DOMAIN: "a2z.test", ALLOWED_ORIGINS: "https://portal.a2z.test",
    MEDIA: { put: async () => {}, head: async () => null, get: async () => null, list: async () => ({ objects: [] }) },
  };
  /* invented people: 1 the CEO (company owner), 2 the Super Admin, 3 COO, 7 HR, 10 editor, 12 a second CEO-role account */
  db.exec(`INSERT INTO users (id, name, full_name, email, role, is_active, password_hash, totp_enabled, totp_secret) VALUES
    (1,'Owner','Owner Person','owner@a2z.test','ceo',1,'x',1,'${SECRET}'),
    (2,'Super Admin','Root Person','root@a2z.test','super_admin',1,'x',1,'${SECRET}'),
    (3,'Coo','Coo Person','coo@a2z.test','coo',1,'x',1,'${SECRET}'),
    (7,'Hr','Hr Person','hr@a2z.test','hr_admin',1,'x',1,'${SECRET}'),
    (10,'Ed','Ed Person','ed@a2z.test','editor',1,'x',1,'${SECRET}'),
    (12,'Second','Second Ceo','ceo2@a2z.test','ceo',1,'x',1,'${SECRET}')`);
  db.exec(`INSERT INTO system_meta (key, value) VALUES ('company_owner', '{"user_id":1,"set_by":2,"set_by_name":"Super Admin","set_at":"2026-11-02 06:00:54","reason":"test"}')`);
  const RealDate = globalThis.Date; let fixed = new RealDate("2026-11-05T02:00:00Z").getTime();
  globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [fixed])); } static now() { return fixed; } };
  const code = () => { fixed += 31000; return totpAt(fixed); };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("{}", { status: 200 });
  const worker = (await import(pathToFileURL(workerBundle).href + `?v=${Math.random()}`)).default;
  const tok = {};
  for (const id of [1, 2, 3, 7, 10, 12]) {
    tok[id] = `t-${id}-${Math.random()}`;
    db.prepare(`INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, datetime('now', '+12 hours'), datetime('now'))`).run(sha(tok[id]), id);
  }
  const call = async (path, uid, method = "GET", body) => {
    const headers = { "content-type": "application/json", origin: "https://portal.a2z.test", cookie: `azone_session=${tok[uid]}; csrf_token=c1`, "x-csrf-token": "c1" };
    const r = await worker.fetch(new Request(`https://api.a2z.test/api/v1/staff${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined }), env);
    const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch { /* */ }
    return { status: r.status, j, text };
  };
  const selfRefused = (r) => r.status === 403 && r.j?.error?.code === "self_approval";
  const audits = (a) => db.prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE action = ?`).get(a).n;
  const claim = (uid, payee = null, status = "pending") => Number(db.prepare(
    `INSERT INTO claims (user_id, claim_date, category, amount_cents, description, status, payee_user_id) VALUES (?, '2026-11-04', 'travel', 5000, 'Parking', ?, ?) RETURNING id`,
  ).get(uid, status, payee).id);
  const claimRow = (id) => db.prepare(`SELECT status, decided_by, paid_at FROM claims WHERE id = ?`).get(id);
  const punch = (uid, pending = 0) => Number(db.prepare(
    `INSERT INTO attendance_records (user_id, type, created_at, pending_approval) VALUES (?, 'clock_in', '2026-11-04 01:00:00', ?) RETURNING id`,
  ).get(uid, pending).id);
  const unpaidDay = (uid) => Number(db.prepare(
    `INSERT INTO leave_requests (user_id, type, start_date, end_date, days, status, recorded_direct) VALUES (?, 'unpaid', '2026-11-03', '2026-11-03', 1, 'approved', 1) RETURNING id`,
  ).get(uid).id);
  const ledger = (uid, key) => Number(db.prepare(
    `INSERT INTO commission_ledger (source_key, kind, invoice_id, user_id, amount_cents, status) VALUES (?, 'earn', 1, ?, 1000, 'review') RETURNING id`,
  ).get(key, uid).id);

  try {
    /* ---------- claims: decide ---------- */
    const cSA = claim(2);
    const r1 = await call(`/claims/${cSA}/decide`, 2, "POST", { action: "approve", totp: code() });
    ok(selfRefused(r1) && claimRow(cSA).status === "pending", "the Super Admin cannot approve their own claim", r1.text);
    ok(selfRefused(await call(`/claims/${cSA}/decide`, 2, "POST", { action: "reject" })), "...nor reject it");
    ok(audits("auth.self_approval_refused") >= 2, "a refusal is audited");
    const cPayee = claim(10, 2);
    ok(selfRefused(await call(`/claims/${cPayee}/decide`, 2, "POST", { action: "approve", totp: code() })), "the Super Admin cannot approve a claim paid to them");
    const cEd = claim(10);
    const r2 = await call(`/claims/${cEd}/decide`, 2, "POST", { action: "approve", totp: code() });
    ok(r2.status === 200 && claimRow(cEd).status === "approved", "the Super Admin still approves someone else's claim", r2.text);
    const c12 = claim(12);
    ok(selfRefused(await call(`/claims/${c12}/decide`, 12, "POST", { action: "approve", totp: code() })), "a second CEO-role account that is not the owner cannot approve its own claim");
    const cOwn = claim(1);
    ok((await call(`/claims/${cOwn}/decide`, 1, "POST", { action: "approve" })).status === 401, "the owner's own claim approval still asks for his authenticator code");
    const before = audits("auth.executive_self_record");
    const r3 = await call(`/claims/${cOwn}/decide`, 1, "POST", { action: "approve", totp: code() });
    ok(r3.status === 200 && claimRow(cOwn).status === "approved", "the company owner approves his own claim (executive record)", r3.text);
    ok(audits("auth.executive_self_record") === before + 1, "...recorded as an executive record");
    ok(db.prepare(`SELECT COUNT(*) AS n FROM notifications WHERE user_id = 3 AND message LIKE 'For the record: the CEO%'`).get().n >= 1, "...and the COO is told");

    /* ---------- claims: paid ---------- */
    const cSA2 = claim(2, null, "approved");
    ok(selfRefused(await call(`/claims/${cSA2}/paid`, 2, "POST", {})) && !claimRow(cSA2).paid_at, "the Super Admin cannot mark their own claim paid");
    ok(db.prepare(`SELECT COUNT(*) AS n FROM cashflow_entries WHERE ref = ?`).get(`CLM-${cSA2}`).n === 0, "...and no cash book row is written");
    const cPay2 = claim(10, 2, "approved");
    ok(selfRefused(await call(`/claims/${cPay2}/paid`, 2, "POST", {})), "...nor a claim paid to them");
    const r4 = await call(`/claims/${cEd}/paid`, 2, "POST", {});
    ok(r4.status === 200 && claimRow(cEd).paid_at, "the Super Admin still pays someone else's claim", r4.text);
    const r5 = await call(`/claims/${cOwn}/paid`, 1, "POST", {});
    ok(r5.status === 200 && claimRow(cOwn).paid_at, "the owner marks his own claim paid (executive record)", r5.text);

    /* ---------- the permission matrix cannot open the hole ---------- */
    db.exec(`INSERT INTO system_meta (key, value) VALUES ('role_permissions', '{"perms":{"claims_decide":["super_admin","ceo","hr_admin"]}}')`);
    const cHr = claim(7);
    ok(selfRefused(await call(`/claims/${cHr}/decide`, 7, "POST", { action: "approve", totp: code() })), "HR admin given claims_decide in Roles & Permissions still cannot approve their own claim");
    const r6 = await call(`/claims/${claim(10)}/decide`, 7, "POST", { action: "approve", totp: code() });
    ok(r6.status === 200, "...and can approve someone else's (the grant works)", r6.text);
    db.exec(`DELETE FROM system_meta WHERE key = 'role_permissions'`);

    /* ---------- the claim list's buttons follow the rule ---------- */
    const list = await call("/claims?scope=all", 2);
    const mine = (list.j?.claims ?? []).find((c) => c.id === cSA);
    ok(list.status === 200 && mine && !(mine.actions ?? []).includes("approve"), "the Super Admin is not offered approve on their own claim", list.text.slice(0, 200));
    const listO = await call("/claims?scope=all", 1);
    const theirs = (listO.j?.claims ?? []).find((c) => c.id === cSA);
    ok(theirs && (theirs.actions ?? []).includes("approve"), "...the owner is offered approve on the Super Admin's claim", JSON.stringify(theirs ?? {}).slice(0, 200));

    /* ---------- forgotten punches ---------- */
    const pSA = punch(2, 1);
    ok(selfRefused(await call("/attendance/pending/decide", 2, "POST", { id: pSA, action: "approve" })), "the Super Admin cannot approve their own forgotten punch");
    ok(db.prepare(`SELECT pending_approval AS p FROM attendance_records WHERE id = ?`).get(pSA).p === 1, "...it stays pending for another approver");
    ok(selfRefused(await call("/attendance/pending/decide", 2, "POST", { id: pSA, action: "reject" })), "...nor reject (delete) it");
    ok((await call("/attendance/pending/decide", 1, "POST", { id: pSA, action: "approve" })).status === 200, "the owner approves the Super Admin's forgotten punch");
    const pOwn = punch(1, 1);
    ok((await call("/attendance/pending/decide", 1, "POST", { id: pOwn, action: "approve" })).status === 200, "the owner's own forgotten punch is an executive record");

    /* ---------- manual punches, edits, deletions ---------- */
    const man = (uid, who, myt = "2026-11-04 09:00") => call("/attendance/manual", who, "POST", { user_id: uid, type: "clock_in", myt });
    ok(selfRefused(await man(7, 7)), "HR admin cannot add a punch to their own record");
    ok(selfRefused(await man(3, 3)), "the COO cannot add a punch to their own record");
    const m1 = await man(10, 7);
    ok(m1.status === 201, "HR admin still adds a punch for someone else", m1.text);
    const m0 = await man(1, 1, "2026-11-04 11:15");
    ok(m0.status === 201, "the owner adds a punch to his own record (executive record)", m0.status + " " + m0.text);
    const own7 = punch(7);
    ok(selfRefused(await call(`/attendance/${own7}`, 7, "PATCH", { myt: "2026-11-04 08:30" })), "HR admin cannot move their own punch");
    ok(selfRefused(await call(`/attendance/${own7}`, 7, "DELETE")) && db.prepare(`SELECT 1 FROM attendance_records WHERE id = ?`).get(own7), "...nor delete it");
    const ed10 = punch(10);
    ok((await call(`/attendance/${ed10}`, 7, "PATCH", { myt: "2026-11-04 08:30" })).status === 200, "HR admin still moves someone else's punch");
    ok((await call(`/attendance/${ed10}`, 7, "DELETE")).status === 200, "...and deletes it");

    /* ---------- unpaid days ---------- */
    ok(selfRefused(await call("/attendance/unpaid", 2, "POST", { user_id: 2, date: "2026-11-03", days: 1, reason: "Absent without notice" })), "the Super Admin cannot record an unpaid day on their own pay");
    const uSA = unpaidDay(2);
    ok(selfRefused(await call(`/attendance/unpaid?id=${uSA}`, 2, "PATCH", { days: 0.5 })), "...nor change one");
    ok(selfRefused(await call(`/attendance/unpaid?id=${uSA}`, 2, "DELETE")) && db.prepare(`SELECT 1 FROM leave_requests WHERE id = ?`).get(uSA), "...nor remove one");
    const uEd = await call("/attendance/unpaid", 2, "POST", { user_id: 10, date: "2026-11-03", days: 1, reason: "Absent without notice" });
    ok(uEd.status !== 403, "the Super Admin still records an unpaid day for someone else", uEd.text);

    /* ---------- commission decisions ---------- */
    const lSA = ledger(2, "t:sa");
    ok(selfRefused(await call(`/commission/ledger/${lSA}/decide`, 2, "POST", { decision: "dismiss", note: "Testing the self rule" })), "the Super Admin cannot decide their own commission entry");
    const lEd = ledger(10, "t:ed");
    const rc = await call(`/commission/ledger/${lEd}/decide`, 2, "POST", { decision: "dismiss", note: "Testing the self rule" });
    ok(rc.status === 200, "...and still decides someone else's", rc.text);

    /* ---------- the wiring ---------- */
    const staffSrc = readFileSync(join(root, "worker/src/staff.ts"), "utf8");
    ok((staffSrc.match(/await refuseSelf\(env, user, "/g) ?? []).length === 9, "staff.ts calls the rule in exactly nine routes");
    ok(/await refuseSelf\(env, user, "commission\.decide"/.test(readFileSync(join(root, "worker/src/commission.ts"), "utf8")), "commission.ts calls it in the ledger decision");
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
const dir = mkdtempSync(join(tmpdir(), "sap-"));
bundle(root, "worker/src/index.ts", join(dir, "worker.mjs"));
report(await runtime(join(dir, "worker.mjs")));
const checks = n;

const S = "worker/src/staff.ts", P = "worker/src/decision-policy.ts";
const MUT = [
  [S, "claims decide not guarded", [['    const selfDec = await refuseSelf(env, user, "claim.decide", [row.user_id, row.payee_user_id], "claims", clMatch[1]!);\n    if (selfDec) return selfDec;\n', ""]]],
  [S, "claims decide ignores the payee", [['[row.user_id, row.payee_user_id], "claims"', '[row.user_id], "claims"']]],
  [S, "claims paid not guarded", [['    const selfPaid = await refuseSelf(env, user, "claim.paid", [cRow.user_id, cRow.recipient_id], "claims", claimPaid[1]!);\n    if (selfPaid) return selfPaid;\n', ""]]],
  [S, "forgotten punch not guarded", [['    const selfPunch = await refuseSelf(env, user, "punch.forgotten", [rowP.user_id], "attendance_records", idP);\n    if (selfPunch) return selfPunch;\n', ""]]],
  [S, "manual punch not guarded", [['    const selfManual = await refuseSelf(env, user, "attendance.manual", [body.user_id as number], "users", body.user_id as number);\n    if (selfManual) return selfManual;\n', ""]]],
  [S, "punch edit not guarded", [['    const selfAmend = await refuseSelf(env, user, "attendance.amend", [beforeA?.user_id], "attendance_records", attMatch[1]!);\n    if (selfAmend) return selfAmend;\n', ""]]],
  [S, "punch delete not guarded", [['    const selfDel = await refuseSelf(env, user, "attendance.delete", [beforeD?.user_id], "attendance_records", attMatch[1]!);\n    if (selfDel) return selfDel;\n', ""]]],
  [S, "unpaid record not guarded", [['    const selfUnpaid = await refuseSelf(env, user, "unpaid.record", [body.user_id as number], "users", body.user_id as number);\n    if (selfUnpaid) return selfUnpaid;', ""]]],
  [S, "unpaid change not guarded", [['    if (selfUnpaidP) return selfUnpaidP;\n', ""]]],
  [S, "unpaid remove not guarded", [['    if (selfUnpaidD) return selfUnpaidD;\n', ""]]],
  ["worker/src/commission.ts", "commission decide not guarded", [['    if (selfCom) return selfCom;\n', ""]]],
  [P, "everyone treated as the owner", [['export const isExecutiveOwner = (actor: Actor): boolean => actor.role === "ceo" && actor.is_owner === true;', "export const isExecutiveOwner = (actor: Actor): boolean => actor.role === \"ceo\" || actor.role === \"super_admin\";"]]],
  [P, "any CEO-role account treated as the owner", [['actor.role === "ceo" && actor.is_owner === true;', 'actor.role === "ceo";']]],
  [P, "the owner refused too", [["  if (isExecutiveOwner(actor)) {", "  if (false) {"]]],
  [P, "no audit of a refusal", [['  await audit(env, actor.id, "auth.self_approval_refused", entity, String(entityId), { action, role: actor.role });\n', ""]]],
  ["worker/src/claim-chain.ts", "buttons offered on one's own claim", [['DECIDERS.includes(actor.role) && (!(own || payee) || (actor.role === "ceo" && actor.is_owner === true));', "DECIDERS.includes(actor.role);"]]],
];
for (const [file, name, reps] of NOMUT ? [] : MUT) {
  n++;
  let src = readFileSync(join(root, file), "utf8");
  let applied = true;
  for (const [from, to] of reps) { if (!src.includes(from)) { applied = false; break; } src = src.replace(from, to); }
  if (!applied) { fail++; console.error(`FAIL mutation did not apply: ${name}`); continue; }
  const mdir = mkdtempSync(join(tmpdir(), "sap-m-"));
  cpSync(join(root, "worker"), join(mdir, "worker"), { recursive: true, filter: (s) => !s.includes("node_modules") });
  cpSync(join(root, "package.json"), join(mdir, "package.json"));
  for (const d of ["lib", "constants", "types"]) { try { cpSync(join(root, d), join(mdir, d), { recursive: true }); } catch { /* not every folder exists */ } }
  writeFileSync(join(mdir, file), src);
  try { bundle(mdir, "worker/src/index.ts", join(mdir, "worker.mjs")); } catch { fail++; console.error(`FAIL mutation did not build: ${name}`); continue; }
  const res = await runtime(join(mdir, "worker.mjs"));
  if (!res.some(([p]) => !p)) { fail++; console.error(`FAIL mutation not caught: ${name}`); }
}
if (fail) { console.error(`self-approval: ${fail} of ${n} failed`); process.exit(1); }
console.log(`self-approval: ${checks} checks passed (${NOMUT ? "mutations skipped" : `${MUT.length} mutations caught`}) - nobody decides their own record; the owner's own is an executive record`);
