/* RELEASE C OF THE GO-LIVE PLAN (v1.243.0) - runtime guard: the WHOLE worker
 * (index.ts, bundled) against SQLite with every migration applied (0158
 * included), by direct request, on a fixed clock: Thursday 29-10-2026,
 * 10:00 Malaysia time.
 *
 * claude/GO-LIVE-AUDIT.md, claude/FINAL-RELEASE-GATE-PLAN-V2.md Release C, and
 * the owner's decisions of 31-10-2026: D-5 October payroll waits for this
 * release; D-3 "leave as it is" (D11 not built).
 *
 * The phone side of F3 (queued / held for sign-in / needs HR) runs in
 * tests/outbox.mjs against a fake IndexedDB; this file is the server side.
 *
 *   node tests/go-live-c.mjs                                  the current worker, then mutations
 *   WORKER_BUNDLE=/path/worker.mjs node tests/go-live-c.mjs   a given bundle (the pre-fix bundle must FAIL)
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
const NOW = Date.parse("2026-10-29T02:00:00Z"); // Thu 29-10-2026 10:00 MYT

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
    MEDIA: { put: async () => {}, head: async () => null, get: async () => null, list: async () => ({ objects: [] }) },
  };
  const RealDate = globalThis.Date;
  let fixed = NOW;
  globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [fixed])); } static now() { return fixed; } };
  const code = () => { fixed += 31000; return totpAt(fixed); };
  const U = { ceo: 1, coo: 2, hr: 4, aina: 5, lia: 6, gone: 7, root: 8, shop: 9, adm: 11, future: 12, nobank: 13, susp: 14 };
  db.exec(`INSERT INTO users (id, name, full_name, email, role, is_active, password_hash, totp_enabled, totp_secret, department, employment_status, joined_on, left_on, bank_name, bank_account) VALUES
    (1,'Alif','Alif Farhan','alif@a2z.test','ceo',1,'x',1,'${SECRET}','Management','permanent','2020-01-01',NULL,'Maybank','111'),
    (2,'Ops','Ops Lead','ops@a2z.test','coo',1,'x',1,'${SECRET}','Management','permanent','2020-01-01',NULL,'Maybank','222'),
    (4,'Hana','Hana HR','hana@a2z.test','hr_admin',1,'x',1,'${SECRET}','HR','permanent','2020-01-01',NULL,'Maybank','444'),
    (5,'Aina','Aina Seller','aina@a2z.test','sales_marketing',1,'x',1,'${SECRET}','Sales','permanent','2020-01-01',NULL,'Maybank','555'),
    (6,'Lia','Lia Seller','lia@a2z.test','sales_marketing',1,'x',1,'${SECRET}','Sales','permanent','2020-01-01',NULL,'Maybank','666'),
    (7,'Gone','Gone Seller','gone@a2z.test','sales_marketing',1,'x',1,'${SECRET}','Sales','resigned','2020-01-01','2026-10-01','Maybank','777'),
    (8,'Root','Root','root@a2z.test','super_admin',1,'x',1,'${SECRET}',NULL,'permanent','2020-01-01',NULL,NULL,NULL),
    (9,'Shop','Shop','shop@gmail.com','customer',1,'x',0,NULL,NULL,'permanent',NULL,NULL,NULL,NULL),
    (11,'Tech','Tech','tech@a2z.test','admin',1,'x',1,'${SECRET}',NULL,'permanent','2020-01-01',NULL,NULL,NULL),
    (12,'New','New Joiner','new@a2z.test','sales_marketing',1,'x',1,'${SECRET}','Sales','permanent','2026-12-01',NULL,'Maybank','121'),
    (13,'Nobank','No Bank','nobank@a2z.test','sales_marketing',1,'x',1,'${SECRET}','Sales','permanent','2020-01-01',NULL,NULL,NULL),
    (14,'Susp','Suspended Seller','susp@a2z.test','sales_marketing',0,'x',1,'${SECRET}','Sales','permanent','2020-01-01',NULL,'CIMB Bank','1414')`);
  const worker = (await import(pathToFileURL(workerBundle).href + `?v=${Math.random()}`)).default;
  const tok = {};
  for (const id of [1, 2, 4, 5, 6, 7, 8, 9, 11, 13]) {
    tok[id] = `t-${id}`;
    db.prepare(`INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, datetime('now', '+12 hours'), datetime('now'))`).run(sha(tok[id]), id);
  }
  const call = async (path, uid, method = "GET", body) => {
    const headers = { "content-type": "application/json", origin: "https://portal.a2z.test", cookie: `azone_session=${tok[uid]}; csrf_token=c1`, "x-csrf-token": "c1" };
    const r = await worker.fetch(new Request(`https://api.a2z.test/api/v1${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined }), env);
    const text = await r.text();
    let j = null; try { j = JSON.parse(text); } catch { /* not json */ }
    return { status: r.status, j, text };
  };
  const GPS = "3.1390,101.6869";

  try {
    /* ---------- D1 + D3: an overnight shift entered by HR derives its overtime ---------- */
    ok((await call("/staff/attendance/manual", U.hr, "POST", { user_id: U.aina, type: "clock_in", myt: "2026-10-27 20:00" })).status === 201, "HR enters a clock-in at 20:00 on Tue 27-10");
    const mo = await call("/staff/attendance/manual", U.hr, "POST", { user_id: U.aina, type: "clock_out", myt: "2026-10-28 00:30" });
    ok(mo.status === 201, "HR enters the clock-out at 00:30 the next morning", mo.text.slice(0, 160));
    const ot = db.prepare(`SELECT type, created_at FROM ot_records WHERE user_id = 5 AND user_agent = 'clock:derived' ORDER BY created_at`).all();
    ok(ot.length === 2 && ot[0].type === "ot_in" && ot[0].created_at === "2026-10-27 12:00:00", "D1/D3 the night 20:00-00:30 outside an office day derives overtime, filed on the clock-in day", JSON.stringify(ot));
    ok((await call("/staff/attendance/manual", U.hr, "POST", { user_id: U.aina, type: "clock_out", myt: "2026-10-28 00:31" })).status === 409, "F3 a manual punch within two minutes of the same punch is refused (no double)");
    ok((await call("/staff/attendance/manual", U.hr, "POST", { user_id: U.aina, type: "clock_in", myt: "2026-11-05 10:00" })).status === 400, "a manual punch in the future is refused");
    let ver = (await call("/staff/attendance/verification?month=2026-10", U.hr)).j;
    let aina = ver?.staff?.find((r) => r.user_id === U.aina);
    ok(aina && !aina.open_dates.includes("2026-10-27"), "D1 the verification report pairs the night (27-10 is not an open session)", JSON.stringify(aina?.open_dates));

    /* ---------- D2: a session across the month boundary is paid in the clock-in month ---------- */
    db.exec(`INSERT INTO attendance_records (user_id, type, created_at) VALUES (5, 'clock_in', '2026-09-30 14:00:00'), (5, 'clock_out', '2026-09-30 17:00:00')`);
    ver = (await call("/staff/attendance/verification?month=2026-09", U.hr)).j;
    aina = ver?.staff?.find((r) => r.user_id === U.aina);
    ok(aina && aina.no_clock_out === 0 && !aina.open_dates.includes("2026-09-30"), "D2 30-09 22:00 to 01-10 01:00 is one closed session in September", JSON.stringify({ n: aina?.no_clock_out, o: aina?.open_dates }));

    /* ---------- D5: days still ahead are not reconciled yet ---------- */
    ver = (await call("/staff/attendance/verification?month=2026-10", U.hr)).j;
    const nb = ver?.staff?.find((r) => r.user_id === U.nobank);
    ok(nb && nb.scheduled_ahead === 1 && nb.balances === true, "D5 Friday 30-10 is scheduled ahead, not owed: the row adds up on the days that have happened", JSON.stringify({ a: nb?.scheduled_ahead, s: nb?.scheduled, b: nb?.balances }));

    /* ---------- D7: approved leave closes the shift ---------- */
    db.exec(`INSERT INTO leave_requests (user_id, type, start_date, end_date, days, status, stage) VALUES (6, 'annual', '2026-10-29', '2026-10-29', 1, 'approved', 'approved')`);
    const lv = await call("/staff/attendance", U.lia, "POST", { type: "clock_in", gps: GPS });
    ok(lv.status === 409 && lv.j?.error?.code === "on_leave" && /annual/.test(lv.j.error.message), "D7 a clock-in on a day of approved annual leave is refused, naming the leave", lv.text.slice(0, 200));
    ok(db.prepare(`SELECT COUNT(*) AS n FROM attendance_records WHERE user_id = 6`).get().n === 0, "D7 nothing was stored");
    const okIn = await call("/staff/attendance", U.aina, "POST", { type: "clock_in", gps: GPS });
    ok(okIn.status < 300, "D7 a colleague without leave clocks in as before", okIn.text.slice(0, 160));

    /* ---------- D9: leavers, joiners, managers ---------- */
    const gone = await call("/staff/attendance", U.gone, "POST", { type: "clock_in", gps: GPS });
    ok(gone.status === 403 && gone.j?.error?.code === "not_on_staff", "D9 somebody past their last day cannot clock in", gone.text.slice(0, 160));
    ok((await call("/staff/tasks", U.ceo, "POST", { title: "Follow up the hotel", assigned_to: U.gone })).status === 400, "D9 a task cannot be given to a leaver");
    ok((await call("/staff/tasks", U.ceo, "POST", { title: "Follow up the hotel", assigned_to: U.shop })).status === 400, "D9 nor to a customer");
    ok((await call(`/staff/users/${U.aina}/reports-to`, U.coo, "PUT", { reports_to: U.shop })).status === 404, "D9 a customer cannot be anybody's manager");
    const mon = (await call("/staff/attendance/monitor", U.ceo)).j?.staff ?? [];
    ok(mon.length > 0 && !mon.some((r) => r.id === U.gone || r.user_id === U.gone) && !mon.some((r) => r.id === U.future || r.user_id === U.future), "D9 the monitor lists neither the leaver nor the future joiner", JSON.stringify(mon.map((r) => r.id ?? r.user_id)));

    /* ---------- D4: the CEO signs a COO's leave once ---------- */
    db.exec(`INSERT INTO leave_requests (id, user_id, type, start_date, end_date, days, status, stage) VALUES (40, 2, 'annual', '2026-11-16', '2026-11-16', 1, 'pending', 'hr_reviewed')`);
    const d4 = await call("/staff/leave/40", U.ceo, "PATCH", { action: "approve", totp: code() });
    ok(d4.status === 200 && db.prepare(`SELECT stage, status FROM leave_requests WHERE id = 40`).get().stage === "approved", "D4 one CEO approval finalises a COO's leave (no second signature)", `${d4.status} ${JSON.stringify(db.prepare(`SELECT stage FROM leave_requests WHERE id = 40`).get())}`);

    /* ---------- D6: what a leave request must be ---------- */
    const ap = (b) => call("/staff/leave", U.aina, "POST", { type: "annual", reason: "Family", ...b });
    ok((await ap({ start_date: "2026-11-03", end_date: "2026-11-03", days: 1 })).status === 201, "a normal annual leave day is applied for");
    const ov = await ap({ start_date: "2026-11-03", end_date: "2026-11-04", days: 2 });
    ok(ov.status === 409 && ov.j?.error?.code === "overlap", "D6 an overlapping request is refused", ov.text.slice(0, 140));
    const over = await ap({ start_date: "2026-11-09", end_date: "2026-12-31", days: 30 });
    ok(over.status === 400 && over.j?.error?.code === "over_entitlement", "D6 30 annual days against 14 is refused", over.text.slice(0, 160));
    ok((await ap({ start_date: "2025-03-02", end_date: "2025-03-02", days: 1 })).status === 400, "D6 a date in 2025 is refused");
    const sun = await ap({ start_date: "2026-11-08", end_date: "2026-11-08", days: 1 });
    ok(sun.status === 400 && /rest day/.test(sun.j?.error?.message ?? ""), "D6 a full day of leave on a rest day (Sunday) is refused", sun.text.slice(0, 160));
    ok((await ap({ start_date: "2026-11-10", end_date: "2026-11-10", days: 3 })).status === 400, "D6 more days than the span holds is refused");

    /* ---------- D8: HR reads a named person's balance ---------- */
    const bal = await call(`/staff/leave/balance?user_id=${U.aina}`, U.hr);
    ok(bal.status === 200 && bal.j?.user_id === U.aina, "D8 HR reads Aina's balance", bal.text.slice(0, 120));
    ok((await call(`/staff/leave/balance?user_id=${U.lia}`, U.aina)).status === 403, "D8 a colleague cannot");

    /* ---------- D10: the staff record ---------- */
    ok((await call(`/staff/users/${U.nobank}`, U.hr, "PATCH", { joined_on: "yesterday" })).status === 400, "D10 a joined date must be a real date");
    ok((await call(`/staff/users/${U.nobank}`, U.hr, "PATCH", { left_on: "2019-01-01", joined_on: "2020-01-01" })).status === 400, "D10 left before joined is refused");
    const st1 = await call(`/staff/users/${U.nobank}`, U.hr, "PATCH", { employment_status: "contract" });
    ok(st1.status === 200, "D10 HR sets the status on a record that only had the database default", st1.text.slice(0, 160));
    ok((await call(`/staff/users/${U.nobank}`, U.hr, "PATCH", { employment_status: "probation" })).status === 403, "D10 once set, it locks for HR as before");

    /* ---------- payroll: E2, E5, E7 ---------- */
    const save = (who, month, extra = {}) => call("/staff/payroll", who, "POST", { user_id: U.aina, month, basic_cents: 300000, commission_cents: 0, allowance_cents: 0, deduction_cents: 0, ...extra });
    const e2 = await save(U.ceo, "2026-08");
    ok(e2.status === 409 && e2.j?.error?.code === "month_released", "E2 August's payslips are out by the automatic 5-September gate: saving needs force", e2.text.slice(0, 160));
    ok((await save(U.adm, "2026-08", { force_released: true })).status === 403, "E5 an admin (payroll_process, no payroll_release) cannot force it");
    const e5 = await save(U.ceo, "2026-08", { force_released: true });
    ok(e5.status < 300 && db.prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'payroll.force_released'`).get().n === 1, "E5 the CEO can, and it is audited as forced", e5.text.slice(0, 160));
    ok((await call("/staff/payroll", U.ceo, "POST", { user_id: U.shop, month: "2026-10", basic_cents: 1 })).status === 400, "E7 a customer has no payroll row");

    /* ---------- E1, E3, E6: September's run ---------- */
    db.exec(`INSERT INTO payroll_entries (user_id, month, basic_cents, net_cents) VALUES (5, '2026-09', 300000, 300000), (13, '2026-09', 250000, 250000), (14, '2026-09', 200000, 200000), (9, '2026-09', 1000, 1000)`);
    db.exec(`INSERT INTO payslip_releases (month, released_by) VALUES ('2026-09', 1)`);
    const pl = (await call("/staff/payroll?month=2026-09", U.ceo)).j?.population;
    ok(pl && pl.in_run === 3 && pl.file_payees === 2 && pl.file_total_cents === 500000 && pl.blocking === 1, "E1 the run: 3 in it (the customer row is out), 2 in the file - the suspended login included - 1 blocking", JSON.stringify(pl && { r: pl.in_run, f: pl.file_payees, t: pl.file_total_cents, b: pl.blocking }));
    ok(pl?.exceptions?.some((e) => e.user_id === U.nobank && e.kind === "no_bank" && e.blocking) && pl.exceptions.some((e) => e.user_id === U.susp && e.kind === "login_suspended" && !e.blocking), "E1 the exceptions name the missing bank (blocking) and the suspended login (not blocking)");
    ok(db.prepare(`SELECT COUNT(*) AS n FROM payroll_exceptions WHERE month = '2026-09' AND user_id = 13 AND kind = 'no_bank' AND resolved_at IS NULL`).get().n === 1, "E1 the blocking exception is recorded (0158)");
    const csv = await call("/staff/payroll/payment-file?month=2026-09", U.ceo);
    ok(csv.status === 200 && /SUSPENDED SELLER/.test(csv.text) && /AINA SELLER/.test(csv.text) && !/NO BANK/.test(csv.text.split("\n").filter((l) => !l.startsWith("#")).join("\n")), "E1/E6 the bank file pays the suspended login and leaves the person with no bank out of the rows", csv.text.slice(0, 300));
    ok(/# EXCEPTION - MISSING BANK DETAILS[^\n]*No Bank/.test(csv.text) && /TOTAL RM 5000\.00 across 2 payees/.test(csv.text), "E6 the file names the exception and its total is the ready subset", csv.text.split("\n").filter((l) => l.startsWith("#")).join(" | "));
    const paid1 = await call("/staff/payroll/paid", U.ceo, "POST", { month: "2026-09" });
    ok(paid1.status === 409 && paid1.j?.error?.code === "exceptions_open" && /No Bank/.test(paid1.j.error.message), "E1 Paid is refused while somebody in the run cannot be paid", paid1.text.slice(0, 200));
    ok((await call("/staff/payroll/manual-payment", U.ceo, "POST", { month: "2026-09", user_id: U.nobank, method: "cash", reference: "voucher 12", amount_cents: 1 })).status === 400, "E1 a manual payment must equal the payslip's net");
    ok((await call("/staff/payroll/manual-payment", U.ceo, "POST", { month: "2026-09", user_id: U.nobank, method: "cash", reference: "voucher 12", amount_cents: 250000 })).status === 201, "E1 the CEO records that No Bank was paid by hand");
    const paid2 = await call("/staff/payroll/paid", U.ceo, "POST", { month: "2026-09" });
    ok(paid2.status === 200 && paid2.j?.file_total_cents === 500000 && paid2.j?.manual_total_cents === 250000, "E1 now Paid is recorded: file RM 5,000.00 + by hand RM 2,500.00", paid2.text.slice(0, 200));
    const pp = db.prepare(`SELECT release_id, file_total_cents, file_payees, manual_total_cents FROM payroll_payments WHERE month = '2026-09'`).get();
    ok(pp && pp.release_id !== null && pp.file_payees === 2, "E3 the payment names the release it paid", JSON.stringify(pp));
    const cash = db.prepare(`SELECT amount_cents FROM cashflow_entries WHERE ref = 'PAYROLL-2026-09'`).get();
    ok(cash?.amount_cents === 750000, "E1 the bank movement is what was paid (RM 7,500.00), never the customer's stray row", JSON.stringify(cash));
    ok((await call("/staff/payroll/paid", U.ceo, "POST", { month: "2026-09" })).status === 409, "E3 Paid twice is refused");
    ok((await call("/staff/payroll/release", U.ceo, "POST", { month: "2026-09", undo: true })).status === 409, "E3 the release a bank run paid cannot be undone");
    ok((await save(U.ceo, "2026-09", { force_released: true })).status === 409, "E3 a paid month is closed even to force");
    const paidOct = await call("/staff/payroll/paid", U.ceo, "POST", { month: "2026-10" });
    ok(paidOct.status === 409 && paidOct.j?.error?.code === "release_required", "E3 Paid before the payslips are out is refused", paidOct.text.slice(0, 120));
  } catch (e) {
    out.push([false, `runtime: ${e?.stack ?? e}`]);
  } finally {
    globalThis.Date = RealDate;
  }
  return out;
}

/* ---- what a runtime check cannot reach cheaply: E4, D12 ---- */
function sourceChecks() {
  const out = [];
  const ok = (c, m) => out.push([!!c, m]);
  const staff = readFileSync(join(root, "worker/src/staff.ts"), "utf8");
  const comm = readFileSync(join(root, "worker/src/commission.ts"), "utf8");
  ok(/markCommissionPaid\(env, mP, popP\.rows\.filter\(\(r\) => r\.ready \|\| r\.manual\)\.map\(\(r\) => r\.user_id\)\)/.test(staff) && /export async function markCommissionPaid\(env: Env, month: string, paidUsers\?: number\[\]\)/.test(comm), "E4 commission is marked paid only for the people the run paid");
  ok(/\} else if \(closesYesterday\) \{[\s\S]{0,700}earlyAgainst\(shY\.windows, mins \+ 24 \* 60\)/.test(staff), "D12 a clock-out that closes yesterday's shift is judged on yesterday's windows (minute + 1440) - source check only");
  return out;
}

let fail = 0, n = 0;
const report = (list) => { for (const [p, m] of list) { n++; if (!p) { fail++; console.error(`FAIL ${m}`); } } };
const given = process.env.WORKER_BUNDLE;
const NOMUT = process.env.NOMUT === "1" || !!given;
const dir = mkdtempSync(join(tmpdir(), "golive-c-"));
if (!given) bundle(root, "worker/src/index.ts", join(dir, "worker.mjs"));
report(await runtime(given ?? join(dir, "worker.mjs")));
if (!given) report(sourceChecks());
const checks = n;

const MUT = [
  ["worker/src/staff.ts", "D1 reverted: the day window does not read forward", "BETWEEN date(?${args.length}, '-1 day') AND date(?${args.length}, '+1 day')`);", "BETWEEN date(?${args.length}, '-1 day') AND ?${args.length}`);"],
  ["worker/src/staff.ts", "D2 reverted: the month window does not read the next month's first morning", "\n      + ` OR strftime('%Y-%m', created_at, '+8 hours', '-1 day') = ?${args.length}`);", ");"],
  ["worker/src/staff.ts", "D3 reverted: a manual punch derives nothing", "    await reDeriveDays(env, body.user_id, [dayM, new Date(Date.parse(`${dayM}T00:00:00Z`) - 86400000).toISOString().slice(0, 10)]);", ""],
  ["worker/src/staff.ts", "D7 reverted: leave does not close the shift", "    if (body.type === \"clock_in\" && !openNow && leaveToday.length && slotsAll.length > 0 && slotsToday.length === 0) {", "    if (false) {"],
  ["worker/src/staff.ts", "D9 reverted: a leaver may clock in", "      if (!onStaff) return err(\"not_on_staff\"", "      if (false) return err(\"not_on_staff\""],
  ["worker/src/staff.ts", "E1 reverted: Paid ignores the exceptions", "    if (popP.blocking > 0) {", "    if (false) {"],
  ["worker/src/staff.ts", "E2 reverted: the automatic gate is not honoured", "  if (await payslipsOutFor(env, month)) {\n    return err(\"month_released\",", "  if (false) {\n    return err(\"month_released\","],
  ["worker/src/staff.ts", "E5 reverted: anyone with payroll_process forces", "    if (who && !can(who.role, \"payroll_release\")) {", "    if (false) {"],
  ["worker/src/staff.ts", "D6 reverted: no overlap check", "    if (clashL) return err(\"overlap\"", "    if (false) return err(\"overlap\""],
  ["worker/src/leave-chain.ts", "D4 reverted: the CEO signs twice", "return applicantRole === \"coo\" || applicantRole === \"cco\" ? \"approved\" : \"pre_approved\";", "return applicantRole === \"coo\" || applicantRole === \"cco\" ? \"pending_final\" : \"pre_approved\";"],
];
for (const [file, name, from, to] of NOMUT ? [] : MUT) {
  n++;
  const src = readFileSync(join(root, file), "utf8");
  if (!src.includes(from)) { fail++; console.error(`FAIL mutation did not apply: ${name}`); continue; }
  const mdir = mkdtempSync(join(tmpdir(), "golive-c-m-"));
  cpSync(join(root, "worker"), join(mdir, "worker"), { recursive: true, filter: (p) => !p.includes("node_modules") });
  cpSync(join(root, "package.json"), join(mdir, "package.json"));
  for (const d of ["lib", "constants", "types"]) { try { cpSync(join(root, d), join(mdir, d), { recursive: true }); } catch { /* not every folder exists */ } }
  writeFileSync(join(mdir, file), src.replace(from, to));
  try { bundle(mdir, "worker/src/index.ts", join(mdir, "worker.mjs")); } catch { fail++; console.error(`FAIL mutation did not build: ${name}`); continue; }
  const res = await runtime(join(mdir, "worker.mjs"));
  if (!res.some(([p]) => !p)) { fail++; console.error(`FAIL mutation not caught: ${name}`); }
  else console.log(`caught: ${name} -> ${res.filter(([p]) => !p).slice(0, 2).map(([, m]) => m.split(" - ")[0]).join("; ")}`);
}
if (fail) { console.error(`go-live-c: ${fail} of ${n} failed${given ? ` (bundle: ${given})` : ""}`); process.exit(1); }
console.log(`go-live-c: ${checks} checks passed (${NOMUT ? "mutations skipped" : `${MUT.length} mutations caught`}) - overnight and month-edge sessions paired, HR punches derive, leave closes the shift, leavers out, leave requests real, one payroll population, Paid once and never with anyone left behind`);
