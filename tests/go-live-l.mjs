/* THE LEAVE APPROVAL TIMELINE (v1.252.0) - runtime guard: the WHOLE worker
 * bundled against SQLite with every migration applied, by direct request as
 * each role. Fixed clock: Monday 02-11-2026, 12:00 Malaysia time.
 *
 * The owner's brief "Leave Application Status & Approval Timeline Upgrade",
 * claude/LEAVE-TIMELINE-AUDIT.md, his answers (D1 Returned for more
 * information, D2 a comment thread, D3 notify the next approver) and his
 * "Approved" (02-11-2026). The chain is the one leave-chain.ts already had:
 * HR, then EITHER the COO or the CCO, then the CEO (COO and CCO applicants:
 * HR, then the CEO). The brief's section 11 tests are named in each check.
 *
 *   node tests/go-live-l.mjs                                  the current worker, then mutations
 *   WORKER_BUNDLE=/path/bundle.mjs node tests/go-live-l.mjs   a given bundle (the 1.251.0 bundle must FAIL)
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
  const entry = join(srcRoot, "golive-l-entry.ts");
  writeFileSync(entry, `export { default } from "./worker/src/index.ts";\n`);
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
  for (const f of MIGS) applyFile(db, f);
  /* A TRUE RACE: while `barrier` is set, the decision route's read of the
     request waits until both requests have read it - so both act on the
     same stage, exactly as two officers pressing at once on two Workers. */
  let barrier = null;
  const DECIDE_READ = "FROM leave_requests l JOIN users u ON u.id = l.user_id WHERE l.id = ?1";
  const shim = (sql) => { const st = db.prepare(sql); let b = []; const o = {
    bind: (...a) => { b = a.map((x) => (x === undefined ? null : x)); return o; },
    first: async () => {
      const r = st.get(...b) ?? null;
      if (barrier && sql.includes(DECIDE_READ) && sql.includes("l.returned_from")) { barrier.n += 1; if (barrier.n >= 2) barrier.go(); await barrier.p; }
      return r;
    }, all: async () => ({ results: st.all(...b) }),
    run: async () => ({ meta: { changes: Number(st.run(...b).changes) } }), _run: () => st.run(...b) }; return o; };
  const env = {
    DB: { prepare: shim, batch: async (list) => { db.exec("BEGIN"); try { for (const s of list) s._run(); db.exec("COMMIT"); } catch (e) { db.exec("ROLLBACK"); throw e; } return []; } },
    SESSION_PEPPER: "pepper", COMPANY_DOMAIN: "a2z.test", ALLOWED_ORIGINS: "https://portal.a2z.test",
    MEDIA: { put: async () => {}, get: async () => null, head: async () => null, list: async () => ({ objects: [] }), delete: async () => {} },
  };
  if (!globalThis.FixedLengthStream) globalThis.FixedLengthStream = class extends TransformStream { constructor() { super(); } };
  const RealDate = globalThis.Date;
  let fixed = Date.parse("2026-11-02T04:00:00Z");
  globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [fixed])); } static now() { return fixed; } };
  const code = () => { fixed += 31000; return totpAt(fixed); };
  const U = { ceo: 1, sa: 2, coo: 3, cco: 4, aina: 5, hana: 6, lia: 7, hani: 8 };
  db.exec(`INSERT INTO users (id, name, full_name, email, role, is_active, password_hash, totp_enabled, totp_secret, employment_status, base_salary_cents) VALUES
    (1,'Alif','Alif Farhan','alif@a2z.test','ceo',1,'x',1,'${SECRET}','permanent',900000),
    (2,'Root','System Root','root@a2z.test','super_admin',1,'x',1,'${SECRET}','permanent',0),
    (3,'Ops','Ops Lead','ops@a2z.test','coo',1,'x',1,'${SECRET}','permanent',800000),
    (4,'Cee','Cee Officer','cco@a2z.test','cco',1,'x',1,'${SECRET}','permanent',800000),
    (5,'Aina','Aina Seller','aina@a2z.test','sales_marketing',1,'x',1,'${SECRET}','permanent',300000),
    (6,'Hana','Hana HR','hana@a2z.test','hr_admin',1,'x',1,'${SECRET}','permanent',400000),
    (7,'Lia','Lia Seller','lia@a2z.test','sales_marketing',1,'x',1,'${SECRET}','permanent',300000),
    (8,'Hani','Hani HR','hani@a2z.test','hr_admin',1,'x',1,'${SECRET}','permanent',400000)`);
  /* two old rows as production has them: a withdrawal with no time, an override with stages unsigned */
  db.exec(`INSERT INTO leave_requests (id, user_id, type, start_date, end_date, days, status, stage, created_at, final_by, final_at) VALUES
    (90, 7, 'emergency', '2026-10-05', '2026-10-05', 1, 'cancelled', 'cancelled', '2026-10-01 01:00:00', NULL, NULL),
    (91, 7, 'emergency', '2026-10-12', '2026-10-12', 1, 'approved', 'approved', '2026-10-08 01:00:00', 1, '2026-10-09 02:00:00')`);
  const worker = (await import(pathToFileURL(workerBundle).href + `?v=${Math.random()}`));
  const app = worker.default;
  const tok = {};
  const session = (id) => { tok[id] = `t-${id}-${Math.random()}`; db.prepare(`INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, datetime('now', '+12 hours'), datetime('now'))`).run(sha(tok[id]), id); };
  for (const id of Object.values(U)) session(id);
  const call = async (path, uid, method = "GET", body) => {
    const h = { origin: "https://portal.a2z.test", cookie: `azone_session=${tok[uid]}; csrf_token=c1`, "x-csrf-token": "c1", "content-type": "application/json" };
    const r = await app.fetch(new Request(`https://api.a2z.test/api/v1/staff${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }), env, { waitUntil() {} });
    const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch { /* not json */ }
    return { status: r.status, j, text };
  };
  const one = (sql, ...a) => db.prepare(sql).get(...a);
  const n = (sql, ...a) => Number(db.prepare(sql).get(...a)?.n ?? 0);
  const noticed = (uid, ref) => n(`SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND ref = ?`, uid, ref);
  const rowOf = async (uid, id, all = false) => ((await call(`/leave${all ? "?all=1" : ""}`, uid)).j?.leave ?? []).find((l) => l.id === id);
  const states = (l) => (l?.timeline ?? []).map((s) => `${s.key}:${s.state}`).join(" ");
  const money = () => sha(JSON.stringify([
    (() => { try { return db.prepare(`SELECT * FROM payroll_entries ORDER BY rowid`).all(); } catch { return []; } })(),
    (() => { try { return db.prepare(`SELECT * FROM leave_balances ORDER BY rowid`).all(); } catch { return []; } })(),
  ]));
  const money0 = money();
  try {
    /* ---------- submitted, waiting on HR ---------- */
    const ap = await call(`/leave`, U.aina, "POST", { type: "emergency", start_date: "2026-11-10", end_date: "2026-11-11", days: 2, reason: "Family matter" });
    const A = ap.j?.id;
    let l = await rowOf(U.aina, A);
    ok(ap.status === 201 && states(l) === "submitted:done hr:now pre:todo final:todo effect:todo" && l.waiting_on === "hr" && l.timeline[0].at, "a new application shows Submitted (with its time), then waits on HR", `${ap.status} ${states(l)}`);
    ok(noticed(U.hana, `leave:${A}:applied`) === 1 && noticed(U.hani, `leave:${A}:applied`) === 1 && noticed(U.coo, `leave:${A}:applied`) === 0 && noticed(U.sa, `leave:${A}:applied`) === 0, "HR is notified it waits on them (both HR officers) - nobody else");
    ok(l.can_act === false && (await rowOf(U.hana, A, true))?.can_act === true && (await rowOf(U.coo, A, true))?.can_act === false, "only HR can act at this stage (the server says so per person)");
    ok((await call(`/leave/${A}`, U.coo, "PATCH", { action: "approve" })).status === 403, "an unauthorised officer cannot approve it");
    /* ---------- HR review, then EITHER the COO or the CCO ---------- */
    ok((await call(`/leave/${A}`, U.hana, "PATCH", { action: "approve" })).j?.stage === "hr_reviewed", "HR reviews it");
    l = await rowOf(U.aina, A);
    ok(states(l) === "submitted:done hr:done pre:now final:todo effect:todo" && l.timeline[1].who === "Hana" && l.timeline[1].at && l.waiting_on === "coo_cco", "the timeline shows HR done (who, when) and waits on the COO or the CCO", states(l));
    ok(noticed(U.coo, `leave:${A}:hr_reviewed`) === 1 && noticed(U.cco, `leave:${A}:hr_reviewed`) === 1 && noticed(U.ceo, `leave:${A}:hr_reviewed`) === 0, "both the COO and the CCO are told - either one decides");
    ok((await rowOf(U.coo, A, true))?.can_act === true && (await rowOf(U.cco, A, true))?.can_act === true && (await rowOf(U.ceo, A, true))?.can_act === false, "...and both may act; the CEO waits for his stage");
    { let go; const p = new Promise((r) => { go = r; }); barrier = { n: 0, p, go }; }
    const both = await Promise.all([call(`/leave/${A}`, U.coo, "PATCH", { action: "approve" }), call(`/leave/${A}`, U.cco, "PATCH", { action: "approve" })]);
    barrier = null;
    const sts = both.map((r) => r.status).sort();
    ok(sts[0] === 200 && sts[1] === 409 && JSON.parse(both.find((r) => r.status === 409).text).error.code === "already_decided" && one(`SELECT stage FROM leave_requests WHERE id = ?`, A).stage === "pre_approved" && n(`SELECT COUNT(*) AS n FROM audit_log WHERE entity_id = ? AND action = 'leave.advance.pre_approved'`, String(A)) === 1, "the COO and the CCO pressing at once make ONE pre-approval - the other is refused", JSON.stringify(both.map((r) => [r.status, r.text.slice(0, 90)])));
    /* ---------- returned for more information ---------- */
    ok((await call(`/leave/${A}`, U.ceo, "PATCH", { action: "return", comment: "Why?" })).j?.error?.code === "reason_required", "a return needs a real question");
    ok((await call(`/leave/${A}`, U.ceo, "PATCH", { action: "return", comment: "Who covers your clients on the 10th?" })).j?.stage === "returned", "the CEO returns it with a question");
    l = await rowOf(U.aina, A);
    ok(l.waiting_on === "applicant" && states(l) === "submitted:done hr:done pre:done final:returned effect:todo" && l.timeline[3].text === "Who covers your clients on the 10th?" && l.status === "pending", "the timeline shows it returned at the CEO's step with the question, waiting on the applicant", states(l));
    ok(noticed(U.aina, `leave:${A}:returned`) === 1, "the applicant is told");
    ok((await call(`/leave/${A}`, U.ceo, "PATCH", { action: "approve", totp: code() })).status === 409, "a returned request cannot be approved until it comes back");
    ok((await call(`/leave/${A}`, U.lia, "PATCH", { action: "resubmit", comment: "Me" })).status === 403, "only the applicant resubmits");
    ok((await call(`/leave/${A}`, U.aina, "PATCH", { action: "resubmit" })).j?.error?.code === "reason_required", "...with an answer");
    const B = (await call(`/leave`, U.aina, "POST", { type: "emergency", start_date: "2026-11-20", end_date: "2026-11-20", days: 1 })).j?.id;
    const clash = await call(`/leave/${A}`, U.aina, "PATCH", { action: "resubmit", comment: "Moved to the 20th", start_date: "2026-11-20", end_date: "2026-11-20", days: 1 });
    ok(clash.status === 409 && clash.j?.error?.code === "overlap" && one(`SELECT stage FROM leave_requests WHERE id = ?`, A).stage === "returned", "new dates pass the same checks as a new request (an overlap is refused)", clash.text.slice(0, 120));
    const rs = await call(`/leave/${A}`, U.aina, "PATCH", { action: "resubmit", comment: "Lia covers them - moved one day", start_date: "2026-11-12", end_date: "2026-11-13", days: 2 });
    l = await rowOf(U.aina, A);
    ok(rs.j?.stage === "pre_approved" && one(`SELECT start_date FROM leave_requests WHERE id = ?`, A).start_date === "2026-11-12" && states(l) === "submitted:done hr:done pre:done final:now effect:todo" && l.timeline[3].flags?.returned_resubmitted === true, "resubmitted, it is back at the CEO's step with the new dates - and says it was returned once", `${rs.status} ${rs.text.slice(0, 100)} ${states(l)}`);
    ok(n(`SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND ref LIKE ?`, U.ceo, `leave:${A}:pre_approved:resubmit%`) === 1, "the CEO is told it waits on him again");
    const cm = (await call(`/leave/${A}/comments`, U.aina)).j?.comments ?? [];
    ok(cm.length === 2 && cm[0].body.includes("Who covers") && cm[1].body.includes("Lia covers"), "the question and the answer are kept in the thread");
    /* ---------- the final decision ---------- */
    ok((await call(`/leave/${A}`, U.ceo, "PATCH", { action: "approve" })).status === 401, "the final approval asks for the CEO's code");
    ok((await call(`/leave/${A}`, U.ceo, "PATCH", { action: "approve", totp: code() })).j?.stage === "approved", "the CEO approves");
    l = await rowOf(U.aina, A);
    ok(states(l) === "submitted:done hr:done pre:done final:done effect:done" && l.timeline[3].who === "Alif" && l.timeline[4].at === l.final_at && l.waiting_on === null, "approved: every step done, in Attendance and Payroll from the approval time", states(l));
    ok((await call(`/leave/${A}`, U.ceo, "PATCH", { action: "reject", comment: "Changed my mind" })).status === 403, "a decided request is not decided again");
    /* ---------- rejection ---------- */
    const C = (await call(`/leave`, U.lia, "POST", { type: "emergency", start_date: "2026-11-16", end_date: "2026-11-16", days: 1 })).j?.id;
    ok((await call(`/leave/${C}`, U.hana, "PATCH", { action: "reject" })).j?.error?.code === "reason_required", "a rejection needs the reason the applicant reads");
    ok((await call(`/leave/${C}`, U.hana, "PATCH", { action: "reject", comment: "Stock count that day" })).j?.stage === "rejected", "HR rejects it");
    l = await rowOf(U.lia, C);
    ok(states(l) === "submitted:done hr:rejected pre:off final:off effect:off" && l.timeline[1].text === "Stock count that day" && l.timeline[1].who === "Hana", "rejected: the step it was rejected at, with who and why; nothing after it goes on", states(l));
    ok(/Stock count/.test(one(`SELECT message FROM notifications WHERE user_id = ? AND ref = ?`, U.lia, `leave:${C}`)?.message ?? "") && JSON.parse(one(`SELECT detail FROM audit_log WHERE action = 'leave.reject' AND entity_id = ?`, String(C)).detail).from_stage === "applied", "the applicant reads the reason; the audit keeps the stage");
    /* ---------- approve and reject at once ---------- */
    const D = (await call(`/leave`, U.lia, "POST", { type: "emergency", start_date: "2026-11-17", end_date: "2026-11-17", days: 1 })).j?.id;
    { let go; const p = new Promise((r) => { go = r; }); barrier = { n: 0, p, go }; }
    const race = await Promise.all([call(`/leave/${D}`, U.hana, "PATCH", { action: "approve" }), call(`/leave/${D}`, U.hani, "PATCH", { action: "reject", comment: "Clashes with the audit" })]);
    barrier = null;
    const dr = one(`SELECT stage, hr_by, final_by FROM leave_requests WHERE id = ?`, D);
    ok(race.filter((r) => r.status === 200).length === 1 && race.some((r) => r.status === 409) && ((dr.stage === "hr_reviewed" && dr.hr_by === 6 && dr.final_by === null) || (dr.stage === "rejected" && dr.hr_by === null)), "two HR officers at once, one approving and one rejecting: one decision stands, the other is refused - a rejected request never comes back", JSON.stringify([race.map((r) => r.status), dr]));
    /* ---------- withdrawal ---------- */
    const E = (await call(`/leave`, U.lia, "POST", { type: "emergency", start_date: "2026-11-18", end_date: "2026-11-18", days: 1 })).j?.id;
    await call(`/leave/${E}`, U.hana, "PATCH", { action: "approve" });
    ok((await call(`/leave/${E}`, U.lia, "PATCH", { action: "cancel" })).j?.stage === "cancelled", "the applicant withdraws it");
    l = await rowOf(U.lia, E);
    ok(states(l) === "submitted:done hr:done pre:withdrawn final:off effect:off" && l.timeline[2].at && audit("leave.cancel", E), "withdrawn: the time is kept, the trail has a line, nothing after it goes on", states(l));
    ok(noticed(U.coo, `leave:${E}:hr_reviewed:withdrawn`) === 1 && noticed(U.cco, `leave:${E}:hr_reviewed:withdrawn`) === 1, "the COO and the CCO are told there is nothing to decide");
    /* ---------- COO's own route ---------- */
    const F = (await call(`/leave`, U.coo, "POST", { type: "emergency", start_date: "2026-11-19", end_date: "2026-11-19", days: 1 })).j?.id;
    await call(`/leave/${F}`, U.hana, "PATCH", { action: "approve" });
    l = await rowOf(U.coo, F);
    ok(states(l) === "submitted:done hr:done final:now effect:todo" && l.waiting_on === "ceo" && noticed(U.ceo, `leave:${F}:hr_reviewed`) === 1 && noticed(U.cco, `leave:${F}:hr_reviewed`) === 0, "a COO's leave skips pre-approval: HR, then the CEO (told)", states(l));
    /* ---------- the CEO's override ---------- */
    const G = (await call(`/leave`, U.lia, "POST", { type: "emergency", start_date: "2026-11-23", end_date: "2026-11-23", days: 1 })).j?.id;
    await call(`/leave/${G}`, U.ceo, "PATCH", { action: "approve", override: true, totp: code() });
    l = await rowOf(U.lia, G);
    ok(states(l) === "submitted:done hr:skipped pre:skipped final:done effect:done" && l.timeline[3].flags?.override === true, "a CEO override shows the skipped stages as skipped - never as signed", states(l));
    /* ---------- comments and activity ---------- */
    ok((await call(`/leave/${A}/comments`, U.hana, "POST", { body: "Balance checked", visibility: "internal" })).status === 201, "management writes an internal note");
    const seen = (await call(`/leave/${A}/comments`, U.aina)).j;
    ok(seen.comments.every((c) => c.visibility === "employee") && seen.can_internal === false, "the applicant never reads an internal note");
    ok((await call(`/leave/${A}/comments`, U.aina, "POST", { body: "Sneaky", visibility: "internal" })).status === 403, "...nor writes one");
    ok((await call(`/leave/${A}/comments`, U.lia)).status === 404 && (await call(`/leave/${A}/activity`, U.lia)).status === 404, "another employee reaches nothing of this leave");
    const act = (await call(`/leave/${A}/activity`, U.aina)).j?.activity ?? [];
    ok(act.some((a) => a.action === "leave.return") && act.some((a) => a.action === "leave.resubmit") && !act.some((a) => a.action === "leave.comment" && a.detail) && act.every((a) => a.detail === undefined), "Activity shows the applicant every step, without internal detail", JSON.stringify(act.map((a) => a.action)));
    const mact = (await call(`/leave/${A}/activity`, U.ceo)).j?.activity ?? [];
    ok(mact.length > act.length || mact.some((a) => a.detail), "management sees the full trail with detail");
    /* ---------- who sees whose ---------- */
    const lia = (await call(`/leave?all=1`, U.lia)).j?.leave ?? [];
    ok(lia.length > 0 && lia.every((x) => x.user_id === U.lia), "an employee sees only their own leave (even asking for all)");
    ok(((await call(`/leave?all=1`, U.coo)).j?.leave ?? []).some((x) => x.user_id === U.aina), "management sees the company");
    /* ---------- payroll months already released ---------- */
    db.exec(`INSERT INTO payslip_releases (month, released_by, released_at) VALUES ('2026-11', 1, datetime('now'))`);
    l = await rowOf(U.aina, B);
    ok(l.timeline.at(-1).flags?.released_months === "2026-11", "a pending leave in a released payroll month is flagged for HR");
    /* ---------- old rows ---------- */
    const o90 = await rowOf(U.lia, 90), o91 = await rowOf(U.lia, 91);
    ok(states(o90) === "submitted:done hr:withdrawn pre:off final:off effect:off" && o90.timeline[1].at === null, "an old withdrawal shows no time - none was stored, none is invented");
    ok(states(o91) === "submitted:done hr:skipped pre:skipped final:done effect:done", "an old override shows its skipped stages", states(o91));
    ok(money() === money0, "no payroll or balance row was written");
  } catch (e) {
    out.push([false, `runtime: ${e?.stack ?? e}`]);
  } finally {
    globalThis.Date = RealDate;
  }
  return out;
  function audit(action, id) { return n(`SELECT COUNT(*) AS n FROM audit_log WHERE action = ? AND entity_id = ?`, action, String(id)) === 1; }
}

let fail = 0, n = 0;
const report = (list) => { for (const [p, m] of list) { n++; if (!p) { fail++; console.error(`FAIL ${m}`); } } };
const given = process.env.WORKER_BUNDLE;
const dir = mkdtempSync(join(tmpdir(), "golive-l-"));
const main = given ?? join(dir, "worker.mjs");
if (!given) bundle(root, main);
report(await runtime(main));
const checks = n;
if (given || process.env.NOMUT) {
  if (fail) { console.error(`go-live-l: ${fail} of ${n} failed`); process.exit(1); }
  console.log(`go-live-l: ${n} checks passed`); process.exit(0);
}

const MUT = [
  ["worker/src/staff.ts", "an approval does not check the stage it read", "`UPDATE leave_requests SET stage = ?2, status = ?4, review_comment = COALESCE(?5, review_comment), ${col} WHERE id = ?1 AND stage = ?6`", "`UPDATE leave_requests SET stage = ?2, status = ?4, review_comment = COALESCE(?5, review_comment), ${col} WHERE id = ?1 AND ?6 IS NOT NULL`"],
  ["worker/src/staff.ts", "a rejection does not check the stage it read", "review_comment = ?2, final_by = ?3, final_at = datetime('now') WHERE id = ?1 AND stage = ?4`", "review_comment = ?2, final_by = ?3, final_at = datetime('now') WHERE id = ?1 AND ?4 IS NOT NULL`"],
  ["worker/src/staff.ts", "a resubmission skips the checks", "      const chk = await checkLeave(row.user_id, next, Number(id));\n      if (chk instanceof Response) return chk;", "      const chk = { sdL: String(next.start_date), edL: String(next.end_date), coverage: { day_part: null, coverage_json: null } };"],
  ["worker/src/staff.ts", "a rejection needs no reason", "      if (!comment || comment.length < 5) return err(\"reason_required\", \"Give the reason for the rejection", "      if (false) return err(\"reason_required\", \"Give the reason for the rejection"],
  ["worker/src/staff.ts", "the applicant reads internal notes", "WHERE c.leave_id = ?1 ${internalOk ? \"\" : \"AND c.visibility = 'employee'\"} ORDER BY c.id`", "WHERE c.leave_id = ?1 ORDER BY c.id`"],
  ["worker/src/leave-chain.ts", "an override shows skipped stages as signed", "      : { key: k, state: \"skipped\", who: null, at: null, text: null, flags: { override: true } });", "      : { key: k, state: \"done\", who: null, at: null, text: null, flags: { override: true } });"],
  ["worker/src/staff.ts", "the next approver is not told", "      if (!done) await notifyLeaveActors(", "      if (false) await notifyLeaveActors("],
];
for (const [file, name, from, to] of MUT) {
  n++;
  const src = readFileSync(join(root, file), "utf8");
  if (!src.includes(from)) { fail++; console.error(`FAIL mutation did not apply: ${name}`); continue; }
  const mdir = mkdtempSync(join(tmpdir(), "golive-l-m-"));
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
if (fail) { console.error(`go-live-l: ${fail} of ${n} failed`); process.exit(1); }
console.log(`go-live-l: ${checks} checks passed (${MUT.length} mutations caught) - the leave approval timeline: HR, then either the COO or the CCO, then the CEO, each step with who and when; one decision per stage under concurrent presses; returned with a question and resubmitted through the same checks; rejection and withdrawal terminal with the stage and the time; the override shown as skipped; internal notes never reach the applicant; the next approver told; released payroll months flagged; no payroll row written`);
