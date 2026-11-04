/* LEAVE APPROVAL FOLLOWS THE ORGANISATION CHART (v1.260.0) - runtime guard:
 * the WHOLE worker bundled against SQLite with every migration applied, by
 * direct request as each person. Fixed clock: Wednesday 04-11-2026, 12:00 MYT.
 *
 * claude/LEAVE-ROUTING-AUDIT.md revision 2 and the CEO's "approved"
 * (04-11-2026): D1 (c) an ordinary employee's REPORTING MANAGER is the final
 * approver - no HR stage, no CEO stage; D2 (b) the COO and the CCO go to the
 * CEO; D3 (a) the CEO's own leave is an Executive Leave Record; D4 reassign
 * with a reason, escalation by the start date, never auto-approved; D7 the
 * override decides in the approver's place with a reason; D8 requests from
 * before are re-routed only one at a time; D9 the CEO's switch, default off.
 * Section 13 (security) and 14 (regression) of the audit are named in the
 * checks.
 *
 *   node tests/go-live-v.mjs                                  the current worker, then mutations
 *   WORKER_BUNDLE=/path/bundle.mjs node tests/go-live-v.mjs   a given bundle (the 1.259.0 bundle must FAIL)
 */
import { readFileSync, readdirSync, mkdtempSync, cpSync, writeFileSync, rmSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash, createHmac } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const root = fileURLToPath(new URL("..", import.meta.url));
const bundle = (srcRoot, out) => {
  const entry = join(srcRoot, "golive-v-entry.ts");
  writeFileSync(entry, `export { default } from "./worker/src/index.ts";\nexport { leaveEscalationSweep } from "./worker/src/staff.ts";\n`);
  try { execSync(`npx esbuild "${entry}" --bundle --format=esm --platform=neutral --outfile="${out}" --log-level=error`, { cwd: root, stdio: "inherit" }); }
  finally { rmSync(entry, { force: true }); }
};
const sha = (s) => createHash("sha256").update(s).digest("hex");
const MIGS = readdirSync(join(root, "worker/migrations")).filter((x) => x.endsWith(".sql")).sort();
const applyFile = (db, f) => {
  const src = readFileSync(join(root, "worker/migrations", f), "utf8");
  let buf = "";
  for (const st of src.split(/;\s*\n/)) {
    buf = buf ? `${buf};\n${st}` : st;
    if (/CREATE TRIGGER/i.test(buf) && !/\bEND\s*$/i.test(buf.trim())) continue;
    try { db.exec(buf); } catch { /* an older statement the later ones replace */ }
    buf = "";
  }
};
const SECRET = "JBSWY3DPEHPK3PXP";
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const b32 = (s) => { let bits = 0, v = 0; const o = []; for (const ch of s) { v = (v << 5) | B32.indexOf(ch); bits += 5; if (bits >= 8) { o.push((v >>> (bits - 8)) & 255); bits -= 8; } } return Buffer.from(o); };
const totpAt = (ms) => { const c = Math.floor(ms / 30000); const b = Buffer.alloc(8); b.writeUInt32BE(Math.floor(c / 2 ** 32), 0); b.writeUInt32BE(c >>> 0, 4); const h = createHmac("sha1", b32(SECRET)).update(b).digest(); const o = h[h.length - 1] & 15; return String((((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1e6).padStart(6, "0"); };

async function runtime(workerBundle) {
  const out = [];
  const ok = (c, m, why = "") => out.push([!!c, why && !c ? `${m} - ${why}` : m]);
  const db = new DatabaseSync(":memory:");
  /* ONE CLOCK: SQLite's 'now' reads the same fixed clock as the worker (see go-live-k) */
  const realClock = new DatabaseSync(":memory:");
  const pinTs = () => new Date().toISOString().slice(0, 19).replace("T", " ");
  for (const fn of ["datetime", "date", "time", "julianday"]) db.function(fn, { varargs: true }, (...a) => realClock.prepare(`SELECT ${fn}(${(a.length ? a : ["now"]).map(() => "?").join(",")}) AS v`).get(...(a.length ? a : ["now"]).map((x) => (typeof x === "string" && x.toLowerCase() === "now" ? pinTs() : x))).v);
  db.function("strftime", { varargs: true }, (...a) => realClock.prepare(`SELECT strftime(${a.map(() => "?").join(",")}) AS v`).get(...a.map((x, i) => (i > 0 && typeof x === "string" && x.toLowerCase() === "now" ? pinTs() : x))).v);
  for (const f of MIGS) applyFile(db, f);
  const shim = (sql) => { const st = db.prepare(sql); let b = []; const o = {
    bind: (...a) => { b = a.map((x) => (x === undefined ? null : x)); return o; },
    first: async () => st.get(...b) ?? null, all: async () => ({ results: st.all(...b) }),
    run: async () => ({ meta: { changes: Number(st.run(...b).changes) } }), _run: () => st.run(...b) }; return o; };
  const env = {
    DB: { prepare: shim, batch: async (list) => { db.exec("BEGIN"); try { for (const s of list) s._run(); db.exec("COMMIT"); } catch (e) { db.exec("ROLLBACK"); throw e; } return []; } },
    SESSION_PEPPER: "pepper", COMPANY_DOMAIN: "a2z.test", ALLOWED_ORIGINS: "https://portal.a2z.test",
    MEDIA: { put: async () => {}, get: async () => null, head: async () => null, list: async () => ({ objects: [] }), delete: async () => {} },
  };
  if (!globalThis.FixedLengthStream) globalThis.FixedLengthStream = class extends TransformStream { constructor() { super(); } };
  const RealDate = globalThis.Date;
  let fixed = Date.parse("2026-11-04T04:00:00Z");
  globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [fixed])); } static now() { return fixed; } };
  const code = () => { fixed += 31000; return totpAt(fixed); };
  /* the production chart's shape (claude/LEAVE-ROUTING-AUDIT.md section 3), invented people */
  const U = { ceo: 1, sa: 2, coo: 3, cco: 4, aina: 5, hana: 6, lia: 7, hani: 8, nora: 9, tim: 10, kim: 11 };
  db.exec(`INSERT INTO users (id, name, full_name, email, role, is_active, password_hash, totp_enabled, totp_secret, employment_status, base_salary_cents, position, department, reports_to) VALUES
    (1,'Alif','Alif Farhan','alif@a2z.test','ceo',1,'x',1,'${SECRET}','permanent',900000,'Chief Executive Officer','Management',NULL),
    (2,'Root','System Root','root@a2z.test','super_admin',1,'x',1,'${SECRET}','permanent',0,NULL,NULL,NULL),
    (3,'Ops','Ops Lead','ops@a2z.test','coo',1,'x',1,'${SECRET}','permanent',800000,'Chief Operational Officer','Management',1),
    (4,'Cee','Cee Officer','cco@a2z.test','cco',1,'x',1,'${SECRET}','permanent',800000,'Chief Commercial Officer','Management',1),
    (5,'Aina','Aina Seller','aina@a2z.test','sales_marketing',1,'x',1,'${SECRET}','permanent',300000,'Designer','Sales and Marketing',4),
    (6,'Hana','Hana HR','hana@a2z.test','hr_admin',1,'x',1,'${SECRET}','permanent',400000,'Administrative Executive','HR and Admin',4),
    (7,'Lia','Lia Seller','lia@a2z.test','sales_marketing',1,'x',1,'${SECRET}','permanent',300000,'Creative','Sales and Marketing',3),
    (8,'Hani','Hani HR','hani@a2z.test','hr_admin',1,'x',1,'${SECRET}','permanent',400000,'HR Officer','HR and Admin',4),
    (9,'Nora','Nora New','nora@a2z.test','sales_marketing',1,'x',1,'${SECRET}','permanent',300000,'Sales Executive','Sales and Marketing',NULL),
    (10,'Tim','Tim Lead','tim@a2z.test','sales_marketing',1,'x',1,'${SECRET}','permanent',350000,'Team Lead','Sales and Marketing',3),
    (11,'Kim','Kim Junior','kim@a2z.test','sales_marketing',1,'x',1,'${SECRET}','permanent',250000,'Sales Executive','Sales and Marketing',10)`);
  const mod = (await import(pathToFileURL(workerBundle).href + `?v=${Math.random()}`));
  const app = mod.default;
  const tok = {};
  const session = (id) => { tok[id] = `t-${id}-${Math.random()}`; db.prepare(`INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, datetime('now', '+30 days'), datetime('now'))`).run(sha(tok[id]), id); };
  for (const id of Object.values(U)) session(id);
  const call = async (path, uid, method = "GET", body) => {
    const h = { origin: "https://portal.a2z.test", cookie: `azone_session=${tok[uid]}; csrf_token=c1`, "x-csrf-token": "c1", "content-type": "application/json" };
    const r = await app.fetch(new Request(`https://api.a2z.test/api/v1/staff${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }), env, { waitUntil() {} });
    const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch { /* not json */ }
    return { status: r.status, j, text };
  };
  const one = (sql, ...a) => db.prepare(sql).get(...a);
  const n = (sql, ...a) => Number(db.prepare(sql).get(...a)?.n ?? 0);
  const noticed = (uid, like) => n(`SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND ref LIKE ?`, uid, like);
  const rowOf = async (uid, id) => ((await call(`/leave?all=1`, uid)).j?.leave ?? []).find((l) => l.id === id);
  const states = (l) => (l?.timeline ?? []).map((s) => `${s.key}:${s.state}`).join(" ");
  const apply = async (uid, start, end = start, days = 1, extra = {}) => call(`/leave`, uid, "POST", { type: "emergency", start_date: start, end_date: end, days, reason: "Family matter", ...extra });
  const patch = (id, uid, body) => call(`/leave/${id}`, uid, "PATCH", body);
  const money = () => sha(JSON.stringify([
    (() => { try { return db.prepare(`SELECT * FROM payroll_entries ORDER BY rowid`).all(); } catch { return []; } })(),
    (() => { try { return db.prepare(`SELECT * FROM leave_balances ORDER BY rowid`).all(); } catch { return []; } })(),
  ]));
  const money0 = money();
  try {
    /* ---------- D9: the switch, off by default ---------- */
    ok((await call(`/leave/routing`, U.aina)).j?.mode === "legacy", "D9 the switch is OFF until the CEO turns it on");
    const L0 = (await apply(U.aina, "2026-11-23")).j?.id;
    ok(one(`SELECT stage, route_json FROM leave_requests WHERE id = ?`, L0)?.stage === "applied" && one(`SELECT route_json FROM leave_requests WHERE id = ?`, L0).route_json === null, "with the switch off, a request follows the previous rules (HR first) and carries no route");
    ok((await call(`/leave/routing`, U.coo, "PUT", { mode: "organisation" })).status === 403 && (await call(`/leave/routing`, U.hana, "PUT", { mode: "organisation" })).status === 403 && (await call(`/leave/routing`, U.sa, "PUT", { mode: "organisation" })).status === 403, "13: only the CEO turns it on - not the COO, HR or the Super Admin");
    ok((await call(`/leave/routing`, U.ceo, "PUT", { mode: "organisation" })).status === 401, "...and with his authenticator code");
    ok((await call(`/leave/routing`, U.ceo, "PUT", { mode: "organisation", totp: code() })).j?.mode === "organisation" && n(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'leave.routing_mode'`) === 1, "the CEO turns it on; it is audited");
    ok((await call(`/leave/routing`, U.aina)).j?.my_route?.steps?.[0]?.approver?.name === "Cee Officer" && (await call(`/leave/routing`, U.ceo)).j?.my_route?.kind === "executive_record", "Your approval route: Aina -> the CCO; the CEO -> Executive Leave Record");
    /* ---------- 1, 2: an ordinary employee -> their reporting manager, final ---------- */
    const A = await apply(U.aina, "2026-11-24");
    const a = A.j?.id;
    ok(A.status === 201 && A.j?.stage === "routed" && A.j?.approver === "Cee Officer" && one(`SELECT approver_id FROM leave_requests WHERE id = ?`, a).approver_id === U.cco, "1-2: Aina (reports to the CCO) is routed to the CCO", A.text.slice(0, 160));
    let l = await rowOf(U.aina, a);
    ok(states(l) === "submitted:done line:now effect:todo" && l.timeline[1].flags?.approver_name === "Cee Officer" && l.timeline[1].flags?.approver_position === "Chief Commercial Officer" && l.waiting_on === "approver", "the timeline holds only the route's step - no HR, no COO/CCO, no CEO stage", states(l));
    ok(noticed(U.cco, `leave:${a}:%`) === 1 && noticed(U.coo, `leave:${a}:%`) === 0 && noticed(U.hana, `leave:${a}:%`) === 0 && noticed(U.ceo, `leave:${a}:%`) === 0, "12: only the routed approver is asked - not every executive");
    ok((await rowOf(U.cco, a))?.can_act === true && (await rowOf(U.coo, a))?.can_act === false && (await rowOf(U.hana, a))?.can_act === false && (await rowOf(U.ceo, a))?.can_act === false, "can_act: the CCO only (the server's answer per person)");
    ok((await patch(a, U.coo, { action: "approve", totp: code() })).status === 403 && (await patch(a, U.hana, { action: "approve" })).status === 403 && (await patch(a, U.ceo, { action: "approve", totp: code() })).status === 403, "5, 16: the COO, HR and the CEO cannot approve it - visibility is not authority");
    ok((await patch(a, U.aina, { action: "approve", totp: code() })).status === 403 && (await patch(a, U.aina, { action: "approve", override: true, totp: code() })).status === 403, "16: the applicant cannot approve her own (nor by override)");
    ok((await patch(a, U.coo, { action: "approve", approver_id: U.coo, totp: code() })).status === 403, "13: a forged approver in the body is ignored");
    ok((await patch(a, U.cco, { action: "approve" })).status === 401, "the final approval asks for the approver's code");
    ok((await patch(a, U.cco, { action: "approve", totp: code() })).j?.stage === "approved", "the CCO approves - final, no further stage");
    const ar = one(`SELECT status, final_by, hr_by, preapp_by FROM leave_requests WHERE id = ?`, a);
    l = await rowOf(U.aina, a);
    ok(ar.status === "approved" && ar.final_by === U.cco && ar.hr_by === null && ar.preapp_by === null && states(l) === "submitted:done line:done effect:done" && l.timeline[1].who === "Cee Officer" && l.timeline[1].flags?.by_role === "cco", "11: approved by the CCO, who and when on the timeline; no HR or pre-approval signature invented", JSON.stringify(ar));
    ok((await patch(a, U.cco, { action: "approve", totp: code() })).status === 403 && n(`SELECT COUNT(*) AS n FROM leave_decisions WHERE leave_id = ? AND kind = 'approved'`, a) === 1, "13: a second approval is refused - one decision row");
    ok((await call(`/leave/${a}/signature/ceo`, U.ceo)).j?.error?.message === "No signature applies at this stage", "no CEO chop on a decision the CCO made");
    /* ---------- 2: the COO's report ---------- */
    const b = (await apply(U.lia, "2026-11-25")).j?.id;
    ok(one(`SELECT approver_id FROM leave_requests WHERE id = ?`, b).approver_id === U.coo && (await rowOf(U.cco, b))?.can_act === false, "Lia (reports to the COO) is routed to the COO - never 'either COO or CCO'");
    /* ---------- 5: HR's own leave ---------- */
    const c = (await apply(U.hana, "2026-11-26")).j?.id;
    l = await rowOf(U.hana, c);
    ok(one(`SELECT stage, approver_id FROM leave_requests WHERE id = ?`, c).approver_id === U.cco && !l.timeline.some((s) => s.key === "hr"), "5: HR's own leave goes to her manager (the CCO) - no HR stage waiting on herself", states(l));
    ok((await patch(c, U.hani, { action: "approve", totp: code() })).status === 403, "5: another HR officer has no approval authority either");
    /* ---------- B: HR's administrative check - never an approval ---------- */
    ok((await patch(c, U.hana, { action: "hr_verify" })).status === 403, "B: HR never verifies her own request");
    ok((await patch(c, U.hani, { action: "hr_flag", comment: "x" })).j?.error?.code === "reason_required", "B: a flag says what the issue is");
    ok((await patch(c, U.hani, { action: "hr_verify", comment: "Balance checked" })).j?.stage === "routed" && one(`SELECT stage FROM leave_requests WHERE id = ?`, c).stage === "routed", "B: HR verifies - the request still waits on its manager (it neither approves nor blocks)");
    l = await rowOf(U.hana, c);
    ok(l.timeline[1].flags?.hr_check === "verified" && l.timeline[1].flags?.hr_by === "Hani HR", "B: the check is said on the step, with who", JSON.stringify(l.timeline[1]));
    ok((await patch(c, U.aina, { action: "hr_verify" })).status === 403, "B: nobody outside HR checks");
    /* ---------- 6: the COO -> the CEO ---------- */
    const d = (await apply(U.coo, "2026-11-27")).j?.id;
    ok(one(`SELECT approver_id FROM leave_requests WHERE id = ?`, d).approver_id === U.ceo && noticed(U.hana, `leave:${d}:%`) === 0, "6, D2: the COO's leave goes straight to the CEO - no HR stage");
    ok((await patch(d, U.ceo, { action: "approve", totp: code() })).j?.stage === "approved", "the CEO approves the COO's leave");
    l = await rowOf(U.coo, d);
    ok(states(l) === "submitted:done line:done effect:done" && l.timeline[1].flags?.by_role === "ceo" && (await call(`/leave/${d}/signature/ceo`, U.ceo)).j?.error?.message !== "No signature applies at this stage", "his decision, his chop", states(l));
    /* ---------- 7, D3: the CEO's Executive Leave Record ---------- */
    ok((await apply(U.ceo, "2026-11-30")).status === 401, "D3: recording his own leave asks for the CEO's code");
    const E = await apply(U.ceo, "2026-11-30", "2026-11-30", 1, { totp: code() });
    const e = E.j?.id;
    const er = one(`SELECT stage, status, final_by, approver_id FROM leave_requests WHERE id = ?`, e);
    l = await rowOf(U.ceo, e);
    ok(E.j?.route === "executive_record" && er.status === "approved" && er.final_by === null && er.approver_id === null && states(l) === "submitted:done exec:done effect:done", "7: an Executive Leave Record - approved for Attendance, no approver, no approval event", states(l) + JSON.stringify(er));
    ok(n(`SELECT COUNT(*) AS n FROM leave_decisions WHERE leave_id = ? AND kind = 'recorded'`, e) === 1 && n(`SELECT COUNT(*) AS n FROM leave_decisions WHERE leave_id = ? AND kind IN ('approved', 'override')`, e) === 0, "...recorded once; nobody approved it (no false approval)");
    ok(noticed(U.coo, `leave:${e}:exec`) === 1 && noticed(U.cco, `leave:${e}:exec`) === 1 && noticed(U.hana, `leave:${e}:exec`) === 1, "the COO, CCO and HR are told, for awareness");
    ok((await call(`/leave/${e}/signature/ceo`, U.ceo)).j?.error?.message === "No signature applies at this stage", "no signature on a record nobody approved");
    /* ---------- 8: no reporting manager -> requires configuration ---------- */
    const f = (await apply(U.nora, "2026-12-01")).j?.id;
    ok(one(`SELECT stage, approver_id FROM leave_requests WHERE id = ?`, f).stage === "routing_required" && noticed(U.ceo, `leave:${f}:routing_required%`) === 1 && noticed(U.hana, `leave:${f}:routing_required%`) === 1 && noticed(U.coo, `leave:${f}:%`) === 0, "8: no manager -> 'Approval Routing Requires Configuration', the CEO and HR told - never a random approver");
    ok((await patch(f, U.cco, { action: "approve", totp: code() })).status === 403 && (await patch(f, U.ceo, { action: "approve", totp: code() })).status === 403, "...nobody approves it until it is routed");
    ok((await patch(f, U.hana, { action: "route" })).status === 409, "Route now waits for a reporting line");
    ok((await call(`/users/${U.nora}/reports-to`, U.ceo, "PATCH", { reports_to: U.coo })).status === 200 && noticed(U.hana, `leave:${f}:line%`) === 1, "setting her line tells HR the request can be routed - nothing is redirected by itself");
    ok(one(`SELECT stage FROM leave_requests WHERE id = ?`, f).stage === "routing_required", "...it still waits for Route now");
    ok((await patch(f, U.aina, { action: "route" })).status === 403 && (await patch(f, U.hana, { action: "route" })).j?.stage === "routed" && one(`SELECT approver_id FROM leave_requests WHERE id = ?`, f).approver_id === U.coo && n(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'leave.route' AND entity_id = ?`, String(f)) === 1, "HR presses Route now: it goes to her new manager (the COO), audited");
    /* ---------- a manager below the executives ---------- */
    const g = (await apply(U.kim, "2026-12-02")).j?.id;
    const timSees = ((await call(`/leave`, U.tim)).j?.leave ?? []).find((x) => x.id === g);
    ok(one(`SELECT approver_id FROM leave_requests WHERE id = ?`, g).approver_id === U.tim && timSees?.can_act === true, "Kim -> her team lead Tim, who sees it in his list to decide (he is not in the management tier)");
    ok((await patch(g, U.coo, { action: "approve", totp: code() })).status === 403 && (await patch(g, U.tim, { action: "approve", totp: code() })).j?.stage === "approved", "...Tim decides it; the COO above him does not");
    ok((await call(`/leave/${g}/comments`, U.tim)).status === 200, "the routed approver reads the request's thread");
    /* ---------- 14: a change of manager does not rewrite a pending route ---------- */
    const h = (await apply(U.lia, "2026-12-03")).j?.id;
    ok((await call(`/users/${U.lia}/reports-to`, U.ceo, "PATCH", { reports_to: U.cco })).status === 200, "the CEO moves Lia under the CCO");
    l = await rowOf(U.ceo, h);
    ok(one(`SELECT approver_id FROM leave_requests WHERE id = ?`, h).approver_id === U.coo && l.line_changed === "Cee Officer" && noticed(U.hana, `leave:${h}:line%`) === 1, "14: her pending request stays with the COO (frozen), says the line changed, and HR is told", JSON.stringify([l.line_changed]));
    /* ---------- D4: reassign, with a reason, only upward ---------- */
    ok((await patch(h, U.lia, { action: "reassign", to_user: U.ceo, comment: "Please decide this one" })).status === 403, "the applicant cannot reassign her own");
    ok((await patch(h, U.aina, { action: "reassign", to_user: U.ceo, comment: "Please decide this one" })).status === 403, "nor a stranger");
    ok((await patch(h, U.hana, { action: "reassign", to_user: U.ceo, comment: "short" })).j?.error?.code === "reason_required", "a reassignment needs a real reason");
    ok((await patch(h, U.hana, { action: "reassign", to_user: U.hana, comment: "I will take this one myself" })).status === 400 && (await patch(h, U.hana, { action: "reassign", to_user: U.aina, comment: "Aina can decide this one" })).status === 400, "4, 13: never to HR or a peer - only someone above the applicant");
    ok((await patch(h, U.hana, { action: "reassign", to_user: U.ceo, comment: "The COO is at the Melaka event all week" })).j?.approver === "Alif Farhan", "HR reassigns the step to the CEO (above Lia)");
    ok(one(`SELECT approver_id FROM leave_requests WHERE id = ?`, h).approver_id === U.ceo && noticed(U.ceo, `leave:${h}:routed:r%`) === 1 && n(`SELECT COUNT(*) AS n FROM leave_decisions WHERE leave_id = ? AND kind = 'reassigned' AND from_user = 3 AND to_user = 1`, h) === 1, "15: audited - from, to, why - and the new approver is told");
    ok((await patch(h, U.coo, { action: "approve", totp: code() })).status === 403, "the COO no longer decides it");
    l = await rowOf(U.lia, h);
    ok(l.timeline[1].flags?.reassigned_from === "Ops Lead" && l.timeline[1].flags?.approver_name === "Alif Farhan", "the timeline says who it was reassigned from and to", JSON.stringify(l.timeline[1]));
    /* ---------- D7: the override decides in the approver's place, with a reason ---------- */
    const k = (await apply(U.aina, "2026-12-07")).j?.id;
    ok((await patch(k, U.ceo, { action: "approve", override: true, totp: code() })).j?.error?.code === "reason_required", "D7: deciding in the approver's place needs a reason");
    ok((await patch(k, U.ceo, { action: "approve", override: true, comment: "Cee is on leave - approved as discussed", totp: code() })).j?.stage === "approved" && noticed(U.cco, `leave:${k}:override`) === 1, "D7: the CEO decides it, and the routed approver is told");
    l = await rowOf(U.aina, k);
    ok(l.timeline[1].state === "done" && l.timeline[1].flags?.override === true && l.timeline[1].who === "Alif Farhan" && n(`SELECT COUNT(*) AS n FROM leave_decisions WHERE leave_id = ? AND kind = 'override'`, k) === 1, "...shown as an override, never as the CCO's approval", JSON.stringify(l.timeline[1]));
    /* ---------- 10: rejection ends it ---------- */
    const m = (await apply(U.aina, "2026-12-08")).j?.id;
    ok((await patch(m, U.cco, { action: "reject", comment: "Year-end stock count" })).j?.stage === "rejected" && states(await rowOf(U.aina, m)) === "submitted:done line:rejected effect:off", "10: the manager rejects; the route stops");
    /* ---------- returned and resubmitted, on the same step ---------- */
    const q = (await apply(U.aina, "2026-12-09")).j?.id;
    ok((await patch(q, U.cco, { action: "return", comment: "Who covers the Zainab shoot?" })).j?.stage === "returned" && (await patch(q, U.aina, { action: "resubmit", comment: "Lia covers it" })).j?.stage === "routed" && one(`SELECT approver_id FROM leave_requests WHERE id = ?`, q).approver_id === U.cco, "return and resubmit come back to the same approver");
    /* ---------- D8: a request from before, re-routed one at a time ---------- */
    ok((await patch(L0, U.ceo, { action: "reroute" })).j?.error?.code === "reason_required", "D8: re-routing needs a reason");
    ok((await patch(L0, U.aina, { action: "reroute", comment: "Follow the chart" })).status === 403, "...and is for HR or the CEO");
    ok((await patch(L0, U.ceo, { action: "reroute", comment: "Follow the Organisation chart" })).j?.stage === "routed" && one(`SELECT approver_id FROM leave_requests WHERE id = ?`, L0).approver_id === U.cco, "D8: the CEO re-routes it - it goes to Aina's manager, the CCO");
    const B0 = (await call(`/leave`, U.lia, "POST", { type: "emergency", start_date: "2026-12-14", end_date: "2026-12-14", days: 1 })).j?.id;
    /* ---------- 9, 12: pending is not absence ---------- */
    const cal = (await call(`/leave/calendar?from=2026-11-01&to=2026-12-31`, U.ceo)).j?.leave ?? [];
    ok(!cal.some((x) => x.start_date === "2026-12-09") && cal.some((x) => x.start_date === "2026-11-24"), "9, 12: Attendance's calendar holds approved leave only - a routed request is not absence until approved");
    /* ---------- D4: escalation by the start date ---------- */
    const u = (await apply(U.lia, "2026-11-05")).j?.id; // starts tomorrow; Lia's manager is now the CCO
    ok(one(`SELECT approver_id FROM leave_requests WHERE id = ?`, u).approver_id === U.cco && /URGENT/.test(one(`SELECT message FROM notifications WHERE user_id = ? AND ref LIKE ?`, U.cco, `leave:${u}:%`)?.message ?? ""), "an urgent request is marked URGENT to its approver at once");
    await mod.leaveEscalationSweep(env);
    ok(noticed(U.ceo, `leave:${u}:esc:%`) === 0, "...not escalated before 4 hours");
    fixed += 5 * 3600000;
    await mod.leaveEscalationSweep(env);
    await mod.leaveEscalationSweep(env);
    ok(noticed(U.ceo, `leave:${u}:esc:urgent`) === 1 && noticed(U.hana, `leave:${u}:esc:urgent`) === 1 && noticed(U.lia, `leave:${u}:esc:%`) === 0, "D4: starting tomorrow, after 4 hours the approver's own manager (the CEO) and HR are told - once");
    ok(one(`SELECT stage FROM leave_requests WHERE id = ?`, u).stage === "routed", "never auto-approved");
    /* ---------- D9: switching back keeps every frozen route ---------- */
    ok((await call(`/leave/routing`, U.ceo, "PUT", { mode: "legacy", totp: code() })).j?.mode === "legacy", "the CEO switches it back (the operational rollback)");
    ok(one(`SELECT stage, approver_id FROM leave_requests WHERE id = ?`, q).approver_id === U.cco && (await rowOf(U.cco, q))?.can_act === true && (await rowOf(U.hana, q))?.can_act === false, "a routed request in flight keeps its approver and route - nothing re-staged");
    const z = (await apply(U.aina, "2026-12-15")).j?.id;
    ok(one(`SELECT stage FROM leave_requests WHERE id = ?`, z).stage === "applied", "a new request follows the previous rules again");
    ok((await patch(q, U.cco, { action: "approve", totp: code() })).j?.stage === "approved", "...and the frozen route is still decided by its approver");
    void B0;
    ok(money() === money0, "no payroll or balance row was written");
  } catch (e) {
    out.push([false, `runtime: ${e?.stack ?? e}`]);
  } finally {
    globalThis.Date = RealDate;
  }
  return out;
}

let fail = 0, n = 0;
const report = (list) => { for (const [p, m] of list) { n++; if (!p) { fail++; console.error(`FAIL ${m}`); } } };
const given = process.env.WORKER_BUNDLE;
const dir = mkdtempSync(join(tmpdir(), "golive-v-"));
const main = given ?? join(dir, "worker.mjs");
if (!given) bundle(root, main);
report(await runtime(main));
const checks = n;
if (given || process.env.NOMUT) {
  if (fail) { console.error(`go-live-v: ${fail} of ${n} failed`); process.exit(1); }
  console.log(`go-live-v: ${n} checks passed`); process.exit(0);
}

const MUT = [
  ["worker/src/leave-chain.ts", "anyone may decide a routed request", "  if (stage === \"routed\") return approverId != null && user.id === Number(approverId);", "  if (stage === \"routed\") return true;"],
  ["worker/src/leave-chain.ts", "the route ignores the chart and goes to the CEO", "steps: [{ n: 1, key: \"line\", approver: personOf(sup),", "steps: [{ n: 1, key: \"line\", approver: personOf(list.find((x) => x.role === \"ceo\") ?? sup),"],
  ["worker/src/staff.ts", "a step is reassigned to anyone", "      if (!target) return err(\"invalid_input\", \"The new approver must be above the applicant on the Organisation chart\", 400);", "      if (!target && to !== to) return err(\"invalid_input\", \"x\", 400);"],
  ["worker/src/staff.ts", "the Executive Leave Record without the CEO's code", "        const stepUp = await requireFreshTotp(env, user, b.totp, err, \"record your own leave\");\n        if (stepUp) return stepUp;", "        const stepUp = null;\n        if (stepUp) return stepUp;"],
  ["worker/src/staff.ts", "HR verifies her own request", "      if (row.user_id === user.id) return err(\"forbidden\", \"You cannot check your own request", "      if (false) return err(\"forbidden\", \"You cannot check your own request"],
  ["worker/src/staff.ts", "anyone flips the switch", "    if (user.role !== \"ceo\") return err(\"forbidden\", \"Only the CEO switches how leave is approved\", 403);", "    if (false) return err(\"forbidden\", \"Only the CEO switches how leave is approved\", 403);"],
  ["worker/src/staff.ts", "escalation ignores the start date", "    if (wd <= 1) { if (waited >= 4)", "    if (wd <= 1) { if (waited >= 72)"],
  ["worker/src/staff.ts", "every executive is asked", "      const who = stage === \"routed\" ? (approverId ? [approverId] : [])", "      const who = stage === \"routed\" ? [1, 3, 4, ...(approverId ? [approverId] : [])]"],
  ["worker/src/staff.ts", "the override needs no reason", "    if (override && route && (!comment || comment.length < 5)) {", "    if (false) {"],
  ["worker/src/staff.ts", "a line change redirects the pending request", "    try {\n      const pend = (await env.DB.prepare(", "    try { await env.DB.prepare(`UPDATE leave_requests SET approver_id = ?1 WHERE user_id = ?2 AND stage = 'routed'`).bind(managerId, id).run();\n      const pend = (await env.DB.prepare("],
];
for (const [file, name, from, to] of MUT) {
  n++;
  const src = readFileSync(join(root, file), "utf8");
  if (!src.includes(from)) { fail++; console.error(`FAIL mutation did not apply: ${name}`); continue; }
  const mdir = mkdtempSync(join(tmpdir(), "golive-v-m-"));
  cpSync(join(root, "worker"), join(mdir, "worker"), { recursive: true, filter: (p) => !p.includes("node_modules") });
  cpSync(join(root, "package.json"), join(mdir, "package.json"));
  for (const d of ["lib", "constants", "types"]) { try { cpSync(join(root, d), join(mdir, d), { recursive: true }); } catch { /* not every folder exists */ } }
  writeFileSync(join(mdir, file), src.replace(from, to));
  try { bundle(mdir, join(mdir, "w.mjs")); } catch { fail++; console.error(`FAIL mutation did not build: ${name}`); continue; }
  const res = await runtime(join(mdir, "w.mjs"));
  const bad = res.filter(([p]) => !p).map(([, m]) => m);
  if (!bad.length) { fail++; console.error(`FAIL mutation not caught: ${name}`); }
  else console.log(`caught: ${name} -> ${bad.slice(0, 2).join("; ")}`);
  rmSync(mdir, { recursive: true, force: true });
}
rmSync(dir, { recursive: true, force: true });
if (fail) { console.error(`go-live-v: ${fail} of ${n} failed`); process.exit(1); }
console.log(`go-live-v: ${checks} checks passed (${MUT.length} mutations caught) - leave approval follows the Organisation chart: the reporting manager is final (no HR or CEO stage), the COO and CCO to the CEO, the CEO's Executive Leave Record, Requires configuration until Route now, the frozen route kept through a line change and the switch, reassignment upward with a reason, the override with a reason, HR's check never an approval, escalation by the start date, never auto-approved`);
