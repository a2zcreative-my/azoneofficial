/* v1.307.0 - ATTENDANCE WORKSPACE 4.0 (the CEO, 14-11-2026: "approve as the
   recommendation and correct it the error issue", A-0 ... A-12 in
   claude/ATTENDANCE-WORKSPACE-4.0-BLUEPRINT.md). The one day verdict, by the
   pure function and by DIRECT request against the whole worker on SQLite;
   the screens by their source. Invented people only. Each rule is MUTATED.

   What must hold:
     - a Saturday rest day, a public holiday and approved leave are never
       "not clocked in" or absent;
     - before the shift starts (and inside the dated grace) a person is
       "not due yet"; after the start and before the end "not in"; only a
       working day that is over with no punch is absent;
     - late is after the person's own start plus the grace (10 min from
       16-11-2026, none before) - not a fixed 10:00;
     - a forgotten punch waiting for approval counts nowhere until approved;
     - the day register, the roster, the month chart and the month report
       agree on the same day;
     - raw coordinates go to attendance_location_raw (the CEO) only;
     - the workspace has five views, no On Shift or Settings tab, and the
       operational roster board lives in Tasks > Calendar;
     - no permission but attendance_location_raw, and no table, changed.

     node tests/attendance4.mjs        (NOMUT=1 skips the mutations) */
import { readFileSync, readdirSync, mkdtempSync, writeFileSync, cpSync, rmSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const root = fileURLToPath(new URL("..", import.meta.url));
const bundle = (srcRoot, entry, out) => execSync(`npx esbuild "${join(srcRoot, entry)}" --bundle --format=esm --platform=neutral --outfile="${out}" --log-level=error`, { cwd: root, stdio: "inherit" });
const sha = (s) => createHash("sha256").update(s).digest("hex");
globalThis.FixedLengthStream ??= class { constructor() { const t = new TransformStream(); this.readable = t.readable; this.writable = t.writable; } };

/* ---- 1. the verdict itself (pure) ---- */
async function pure(dayBundle) {
  const out = [];
  const ok = (c, m, why = "") => out.push([!!c, why && !c ? `${m} - ${why}` : m]);
  const { dayVerdict, graceOn } = await import(pathToFileURL(dayBundle).href + `?v=${Math.random()}`);
  const office = [{ start: 600, end: 1080 }];
  const base = { employed: true, restDay: false, holiday: null, fullLeave: null, partialLeave: false, pattern: office, assigned: [], sessions: [], pendingPunches: 0 };
  const v = (x) => dayVerdict({ ...base, ...x }).status;
  ok(v({ day: "2026-11-14", today: "2026-11-14", nowMin: 700, restDay: true, pattern: [] }) === "rest_day", "a Saturday rest day with no punch is a rest day, not 'not clocked in'");
  ok(v({ day: "2026-11-07", today: "2026-11-14", nowMin: 700, restDay: true, pattern: [] }) === "rest_day", "...and a past one is not absent");
  ok(v({ day: "2026-11-09", today: "2026-11-14", nowMin: 700, holiday: "Deepavali" }) === "holiday", "a public holiday is a holiday, never absent");
  ok(v({ day: "2026-11-12", today: "2026-11-14", nowMin: 700, fullLeave: "annual" }) === "leave", "approved full-day leave is leave");
  ok(v({ day: "2026-11-20", today: "2026-11-20", nowMin: 595 }) === "not_due", "before the shift starts the day is not due yet");
  ok(v({ day: "2026-11-20", today: "2026-11-20", nowMin: 608 }) === "not_due", "...and inside the 10-minute grace it is still not due");
  ok(v({ day: "2026-11-20", today: "2026-11-20", nowMin: 611 }) === "not_in", "after the start and the grace, before the end: not in yet");
  ok(v({ day: "2026-11-20", today: "2026-11-20", nowMin: 1100 }) === "absent", "after the shift ends with no punch: absent");
  ok(v({ day: "2026-11-25", today: "2026-11-20", nowMin: 700 }) === "not_due", "a future day is not due, never absent");
  ok(graceOn("2026-11-15") === 0 && graceOn("2026-11-16") === 10 && graceOn("2027-01-04") === 10, "the grace is dated: none before 16-11-2026, 10 minutes from it");
  const late = (day, inMin) => dayVerdict({ ...base, day, today: "2026-12-31", nowMin: 0, sessions: [{ inMin, outMin: 1080 }] });
  ok(late("2026-11-20", 609).status === "present" && !late("2026-11-20", 609).late, "in at 10:09 from the 16th is on time (inside the grace)");
  ok(late("2026-11-20", 611).status === "late" && late("2026-11-20", 611).lateMinutes === 11, "in at 10:11 from the 16th is late by 11 minutes (from the start, not the grace)");
  ok(late("2026-11-10", 605).late && late("2026-11-10", 605).lateMinutes === 5, "before the 16th there is no grace: 10:05 is 5 minutes late");
  ok(!dayVerdict({ ...base, day: "2026-11-20", today: "2026-12-31", nowMin: 0, pattern: [{ start: 780, end: 1320 }], sessions: [{ inMin: 770, outMin: 1320 }] }).late, "late is against the person's own start (13:00), not a fixed 10:00");
  ok(v({ day: "2026-11-10", today: "2026-11-14", nowMin: 0, pendingPunches: 1 }) === "pending", "a punch waiting for approval is pending - not present, not absent");
  ok(v({ day: "2026-11-10", today: "2026-11-14", nowMin: 0, partialLeave: true }) === "leave", "a half day of leave and no punch is not absent");
  ok(v({ day: "2026-11-14", today: "2026-11-14", nowMin: 1150, sessions: [{ inMin: 600, outMin: null }] }) === "missing_out", "still clocked in an hour past the end: missing clock-out");
  ok(v({ day: "2026-11-14", today: "2026-11-14", nowMin: 1100, sessions: [{ inMin: 600, outMin: null }] }) === "on_shift", "...and inside the hour: on shift");
  ok(v({ day: "2026-11-14", today: "2026-11-14", nowMin: 700, employed: false }) === "not_employed", "a day outside employment is not counted");
  return out;
}

/* ---- 2. the routes (direct requests, the whole worker) ---- */
async function runtime(workerBundle) {
  const out = [];
  const ok = (c, m, why = "") => out.push([!!c, why && !c ? `${m} - ${why}` : m]);
  const db = new DatabaseSync(":memory:");
  for (const f of readdirSync(join(root, "worker/migrations")).filter((x) => x.endsWith(".sql")).sort()) {
    for (const st of readFileSync(join(root, "worker/migrations", f), "utf8").split(/;\s*\n/)) { try { db.exec(st); } catch { /* a statement SQLite reads differently */ } }
  }
  for (const f of ["0194_asset_custody.sql", "0195_asset_care.sql"]) { try { db.exec(readFileSync(join(root, "worker/migrations", f), "utf8")); } catch { /* already there */ } }
  const shim = (sql) => { const st = db.prepare(sql); let b = []; const o = {
    bind: (...a) => { b = a.map((x) => (x === undefined ? null : x)); return o; },
    first: async () => st.get(...b) ?? null, all: async () => ({ results: st.all(...b) }),
    run: async () => ({ meta: { changes: Number(st.run(...b).changes), last_row_id: Number(db.prepare("SELECT last_insert_rowid() AS id").get().id) } }),
    _run: () => ({ meta: { changes: Number(st.run(...b).changes) } }) }; return o; };
  const env = {
    DB: { prepare: shim, batch: async (list) => { db.exec("BEGIN"); try { const r = list.map((s) => s._run()); db.exec("COMMIT"); return r; } catch (e) { db.exec("ROLLBACK"); throw e; } } },
    SESSION_PEPPER: "pepper", COMPANY_DOMAIN: "a2z.test", ALLOWED_ORIGINS: "https://portal.a2z.test",
    MEDIA: { put: async () => {}, head: async () => null, get: async () => null, list: async () => ({ objects: [] }), delete: async () => {} },
  };
  /* invented people: 1 CEO (owner), 3 COO, 7 HR, 15 Lia and 16 Ben (sales), 17 Eve (editor) */
  db.exec(`INSERT INTO users (id, name, full_name, email, role, is_active, password_hash, totp_enabled, totp_secret, joined_on) VALUES
    (1,'Owner','Owner Person','owner@a2z.test','ceo',1,'x',1,'J','2026-01-01'), (3,'Coo','Coo Person','coo@a2z.test','coo',1,'x',1,'J','2026-01-01'),
    (7,'Hr','Hr Person','hr@a2z.test','hr_admin',1,'x',1,'J','2026-01-01'), (15,'Lia','Lia Seller','lia@a2z.test','sales_marketing',1,'x',1,'J','2026-01-01'),
    (16,'Ben','Ben Seller','ben@a2z.test','sales_marketing',1,'x',1,'J','2026-01-01'), (17,'Eve','Eve Editor','eve@a2z.test','editor',1,'x',1,'J','2026-01-01'),
    (18,'Rez','Rez Resigned','rez@a2z.test','editor',1,'x',1,'J','2026-01-01'), (19,'Neo','Neo Starter','neo@a2z.test','editor',1,'x',1,'J','2099-01-05')`);
  /* Rez is marked Resigned with no last day; Neo starts in 2099 - neither is on staff (the headcount rule) */
  db.exec(`UPDATE users SET employment_status = 'resigned' WHERE id = 18`);
  db.exec(`INSERT INTO system_meta (key, value) VALUES ('company_owner', '{"user_id":1,"set_by":1,"set_by_name":"Owner","set_at":"2026-11-02 06:00:54","reason":"test"}')`);
  /* the default office pattern (migration 0099): Mon-Thu 10:00-18:00, Fri 17:30, Sat and Sun rest */
  const at = (day, hhmm) => { const [h, m] = hhmm.split(":").map(Number); return new Date(Date.parse(`${day}T00:00:00Z`) + ((h - 8) * 60 + m) * 60000).toISOString().slice(0, 19).replace("T", " "); };
  const punch = (uid, day, type, hhmm, gps = null, pending = null) => db.prepare(`INSERT INTO attendance_records (user_id, type, created_at, gps, pending_approval) VALUES (?, ?, ?, ?, ?)`).run(uid, type, at(day, hhmm), gps, pending);
  /* the 2026 holidays are seeded (0029): 08-11 Hari Deepavali (a Sunday), 09-11 its replacement */
  db.exec(`INSERT INTO leave_requests (user_id, type, start_date, end_date, days, status) VALUES (7, 'annual', '2026-11-10', '2026-11-10', 1, 'approved')`);
  /* Tue 10-11: Lia 10:05 (late, no grace before the 16th), Ben 09:55 (on time), Eve nothing (absent),
     HR on leave, the COO's only punch is a forgotten one waiting for approval, the CEO nothing */
  punch(15, "2026-11-10", "clock_in", "10:05", "3.1390,101.6869,12"); punch(15, "2026-11-10", "clock_out", "18:00");
  punch(16, "2026-11-10", "clock_in", "09:55"); punch(16, "2026-11-10", "clock_out", "18:02");
  punch(3, "2026-11-10", "clock_in", "10:00", null, 1);
  /* Sat 07-11 and the 09-11 holiday: nobody punched */
  /* today: Ben clocked in an hour ago, with a position */
  /* an hour ago, but never before Malaysia midnight (a run at 00:14 MYT must still be "today") */
  const mytMidnightUtc = Date.parse(`${new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10)}T00:00:00Z`) - 8 * 3600000;
  const nowUtc = new Date(Math.max(Date.now() - 3600000, mytMidnightUtc + 60000)).toISOString().slice(0, 19).replace("T", " ");
  db.prepare(`INSERT INTO attendance_records (user_id, type, created_at, gps) VALUES (16, 'clock_in', ?, '3.1500,101.7000,9')`).run(nowUtc);
  db.exec(`INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES
    (1, 'attendance.forgot_approve', 'attendance_records', '1', '{"user_id":15}'), (1, 'payroll.run', 'payroll', '1', '{"user_id":15}'), (1, 'auth.login', 'users', '1', '{}')`);
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("{}", { status: 200 });
  const worker = (await import(pathToFileURL(workerBundle).href + `?v=${Math.random()}`)).default;
  const tok = {};
  for (const id of [1, 3, 7, 15, 16, 17]) {
    tok[id] = `t-${id}-${Math.random()}`;
    db.prepare(`INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, datetime('now', '+12 hours'), datetime('now'))`).run(sha(tok[id]), id);
  }
  const hdr = (uid) => ({ "content-type": "application/json", origin: "https://portal.a2z.test", cookie: `azone_session=${tok[uid]}; csrf_token=c1`, "x-csrf-token": "c1" });
  const call = async (path, uid) => {
    const r = await worker.fetch(new Request(`https://api.a2z.test/api/v1/staff${path}`, { headers: hdr(uid) }), env, { waitUntil() {} });
    const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch { /* */ }
    return { status: r.status, j, text };
  };
  const statusIn = (res, id) => res.j?.staff?.find((p) => p.id === id)?.verdict?.status;
  const tables = () => db.prepare(`SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table'`).get().n;
  const before = { tables: tables(), punches: db.prepare(`SELECT COUNT(*) AS n FROM attendance_records`).get().n };

  try {
    const sat = await call("/attendance/day?date=2026-11-07", 7);
    ok(sat.status === 200 && sat.j.staff.length === 6 && sat.j.staff.every((p) => p.verdict.status === "rest_day"), "Saturday 07-11: everyone is on a rest day - nobody 'not clocked in', nobody absent", sat.text.slice(0, 300));
    ok(!sat.j.staff.some((p) => p.id === 18 || p.id === 19), "a Resigned record with no last day and a future joiner are not on the register (the headcount rule, by day)");
    const tueRows = (await call("/attendance/day?date=2026-11-10", 7)).j?.staff ?? [];
    ok(!tueRows.some((p) => p.id === 18 || p.id === 19), "...so neither is ever 'absent'");
    const hol = await call("/attendance/day?date=2026-11-09", 7);
    ok(hol.status === 200 && hol.j.staff.every((p) => p.verdict.status === "holiday" && p.holiday_name === "Hari Deepavali (Replacement)"), "the 09-11 replacement holiday: everyone on holiday, named", hol.text.slice(0, 300));
    const tue = await call("/attendance/day?date=2026-11-10", 7);
    ok(statusIn(tue, 15) === "late" && tue.j.staff.find((p) => p.id === 15).verdict.lateMinutes === 5, "10-11: Lia in at 10:05 is late by 5 minutes (no grace before the 16th)", tue.text.slice(0, 400));
    ok(statusIn(tue, 16) === "present", "10-11: Ben in at 09:55 is present");
    ok(statusIn(tue, 17) === "absent" && statusIn(tue, 1) === "absent", "10-11: Eve and the CEO, due and never in, are absent");
    ok(statusIn(tue, 7) === "leave", "10-11: HR on approved leave is on leave, not absent");
    ok(statusIn(tue, 3) === "pending" && tue.j.staff.find((p) => p.id === 3).worked_minutes === 0 && !tue.j.staff.find((p) => p.id === 3).first_in, "10-11: the COO's forgotten punch waits - pending, no worked time, no clock-in counted");
    ok(tue.j.grace_minutes === 0 && (await call("/attendance/day?date=2026-11-16", 7)).j.grace_minutes === 10, "the register says the grace of its day: 0 on the 10th, 10 from the 16th");

    /* one verdict across routes */
    const ros = await call("/attendance/roster?from=2026-11-07&to=2026-11-10", 7);
    const kind = (id, d) => ros.j?.staff?.find((p) => p.id === id)?.days?.find((x) => x.d === d)?.kind;
    ok(ros.status === 200 && kind(17, "2026-11-07") === "rest" && kind(17, "2026-11-09") === "holiday" && kind(7, "2026-11-10") === "leave" && kind(17, "2026-11-10") === "work", "the roster says the same day the same way: rest, holiday, leave, work", ros.text.slice(0, 300));
    const md = await call("/attendance/month-days?month=2026-11", 7);
    const d10 = md.j?.days?.find((x) => x.d === "2026-11-10"), d07 = md.j?.days?.find((x) => x.d === "2026-11-07"), d09 = md.j?.days?.find((x) => x.d === "2026-11-09");
    ok(md.status === 200 && d10?.late === 1 && d10?.on_time === 1 && d10?.absent === 2 && d10?.leave === 1, "the month chart counts the 10th from the same verdict: 1 on time, 1 late, 2 absent, 1 leave", JSON.stringify(d10));
    ok(d07?.due === 0 && d07?.absent === 0 && d09?.due === 0 && d09?.absent === 0, "...and nobody is due, or absent, on the Saturday or the holiday", JSON.stringify([d07, d09]));
    const ver = await call("/attendance/verification?month=2026-11", 7);
    const vr = (id) => ver.j?.staff?.find((r) => r.user_id === id);
    ok(ver.status === 200 && vr(17)?.absent_dates?.includes("2026-11-10") && !vr(17)?.absent_dates?.some((d) => d === "2026-11-07" || d === "2026-11-08" || d === "2026-11-09"), "the month report: Eve absent on the 10th, never on the weekend or the holiday", JSON.stringify(vr(17))?.slice(0, 300));
    ok(!vr(15)?.absent_dates?.includes("2026-11-10") && vr(15)?.late >= 1 && !vr(7)?.absent_dates?.includes("2026-11-10"), "...Lia late, not absent; HR on leave, not absent");

    /* who may read */
    ok((await call("/attendance/day?date=2026-11-10", 15)).status === 403 && (await call("/attendance/month-days?month=2026-11", 17)).status === 403 && (await call("/attendance/audit?user_id=15", 16)).status === 403, "staff cannot read the team register, the month chart or a colleague's audit (hr_manage | exec_view)");
    const own = await call("/attendance/roster?from=2026-11-07&to=2026-11-10", 15);
    ok(own.status === 200 && own.j.scope === "own" && own.j.staff.length === 1 && own.j.staff[0].id === 15, "a member of staff reads their own roster row only");
    ok((await call("/attendance/policy", 17)).j?.grace?.[0]?.minutes === 10 && (await call("/attendance/policy", 17)).j?.ot_auto_approved === false, "anyone reads the policy: the dated grace, and overtime never automatic");

    /* raw coordinates: the CEO only (A-8) */
    const hrDay = (await call("/attendance/day?date=2026-11-10", 7)).text, ceoDay = (await call("/attendance/day?date=2026-11-10", 1)).text;
    ok(!hrDay.includes("101.6869") && /"loc":\{/.test(hrDay), "HR reads where Lia punched as an outcome, never the coordinates", hrDay.slice(0, 200));
    ok(ceoDay.includes("101.6869"), "the CEO reads the coordinates");
    const hrMon = await call("/attendance/monitor", 7), ceoMon = await call("/attendance/monitor", 1), cooMon = await call("/attendance/monitor", 3);
    const ben = (r) => r.j?.staff?.find((s) => s.id === 16);
    ok(hrMon.status === 200 && ben(hrMon) && !("in_gps" in ben(hrMon)) && !hrMon.text.includes("101.7000") && !cooMon.text.includes("101.7000"), "the monitor sends HR and the COO no coordinates", hrMon.text.slice(0, 300));
    ok(ceoMon.text.includes("101.7000"), "...and the CEO the coordinates", `${ceoMon.status} ${JSON.stringify(ben(ceoMon))}`.slice(0, 400));
    ok(typeof ben(hrMon)?.status === "string" && hrMon.j.staff.every((s) => typeof s.status === "string"), "every monitor row carries the day verdict, so no screen decides 'not clocked in' itself");
    const rep = await call("/attendance/report?month=2026-11", 7);
    ok(rep.status === 200 && !rep.text.includes("101.6869"), "the month punch log sends HR the outcome, not the coordinates", rep.text.slice(0, 200));

    /* the person's audit: attendance events only */
    const au = await call("/attendance/audit?user_id=15", 7);
    ok(au.status === 200 && au.j.entries.length === 1 && au.j.entries[0].action === "attendance.forgot_approve" && !/payroll|auth\.login/.test(au.text), "a person's audit is their attendance events, never payroll or sign-ins", au.text.slice(0, 300));

    /* nothing written */
    ok(tables() === before.tables && db.prepare(`SELECT COUNT(*) AS n FROM attendance_records`).get().n === before.punches, "reading the workspace writes nothing and adds no table");
  } catch (e) {
    out.push([false, `runtime: ${e?.stack ?? e}`]);
  } finally {
    globalThis.fetch = realFetch;
  }
  return out;
}

/* ---- 3. the screens (source) ---- */
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
function sourceChecks(read) {
  const out = [];
  const ok = (c, m, why = "") => out.push([!!c, why && !c ? `${m} - ${why}` : m]);
  const panel = strip(read("components/portal/attendance-panel.tsx"));
  ok(/const ALL: readonly AttView\[\] = \["overview", "records", "roster", "exceptions", "reports"\];/.test(panel) && /const STAFF_VIEWS: readonly AttView\[\] = \["records", "roster"\];/.test(panel), "five views for the managing roles, the records and the roster for staff (A-0)");
  ok(!/"onshift"|"settings"|<RosterBoard|<OtApprovalsCard|<VerificationCard|<TodayAssignmentsCard/.test(panel), "no On Shift or Settings tab, no roster board, no second OT card, no retired report");
  ok(/"ot-approvals": "exceptions", "pending-punches": "exceptions"/.test(panel) && /<span id="pending-punches" \/>/.test(read("components/portal/attendance-exceptions.tsx")) && /<span id="ot-approvals" \/>/.test(read("components/portal/attendance-exceptions.tsx")), "the Desk's anchors open Exceptions & Approvals, where they are");
  const ex = strip(read("components/portal/attendance-exceptions.tsx"));
  ok(/\/staff\/attendance\/pending\/decide/.test(ex) && /\/staff\/attendance\/ot\/decide/.test(ex) && !/\/staff\/attendance\/(approve|exceptions)\b/.test(ex), "the decisions are the existing ones - no second approval workflow (A-6)");
  const tasks = strip(read("components/portal/tasks.tsx"));
  ok(/<RosterBoard\s+canManage=/.test(tasks) && /canDeleteTask=\{holds\("task_delete", \["ceo", "super_admin"\]\.includes\(user\.role\)\)\}/.test(tasks), "the operational roster board is in Tasks > Calendar, with the same gates (A-3)");
  const os = strip(read("components/portal/on-shift.tsx"));
  ok(/: m\.status && VERDICT_STATE\[m\.status\] \? VERDICT_STATE\[m\.status\]!/.test(os) && /rest_day: "off", holiday: "off"/.test(os) && /not_due: "due"/.test(os), "Team On Shift takes the monitor's verdict: a rest day or holiday is not scheduled, before the start is 'shift not started' (A-9)");
  ok(/const stillIn = s\.status !== undefined \? s\.status === "missing_out"/.test(strip(read("components/portal/users-overview.tsx"))), "the Users overview's missing clock-out is the verdict, not a fixed 18:00");
  ok(/today\?\.status === "rest_day" \|\| today\?\.status === "holiday"/.test(strip(read("components/staff/staff-directory.tsx"))), "the staff peek says 'not scheduled' on a rest day or holiday");
  const day = read("worker/src/attendance-day.ts");
  ok(/export const LATE_GRACE: readonly \{ from: string; minutes: number \}\[\] = \[\s*\{ from: "2026-11-16", minutes: 10 \}/.test(day), "the grace is 10 minutes from 16-11-2026, effective-dated (A-5)");
  const staff = read("worker/src/staff.ts");
  ok(!/on_time:[^\n]*'10:00'|first_in <= '10:00'|cutoff: "10:00"/.test(staff), "no fixed 10:00 cut-off is left in the attendance figures");
  const perms = read("worker/src/permissions.ts");
  ok(/attendance_location_raw: \["ceo"\],/.test(perms) && ['hr_manage: ["super_admin", "admin", "hr_admin", "ceo"]', 'exec_view: ["super_admin", "admin", "ceo", "coo", "cco"]', 'unpaid_leave: ["super_admin", "ceo"]', 'attendance_correct: ["super_admin", "admin", "ceo", "coo", "cco", "hr_admin"]', 'task_delete: ["super_admin", "ceo"]', 'geofence_admin: ["super_admin", "ceo", "coo"]'].every((x) => perms.includes(x)), "raw coordinates are the CEO's; no other permission changed (A-8)");
  /* v1.311.0 - 0196 (Commission 5.0, K-2) came after; Attendance itself still adds none until P3 (A-7) */
  ok(/const LATEST_MIGRATION = "(0195_asset_care|0196_commission_guards)";/.test(read("worker/src/index.ts")) && !readdirSync(join(root, "worker/migrations")).some((f) => /attendance/.test(f) && f >= "0196"), "no migration: corrections stay as they are until P3 (A-7)");
  ok(/(?:view|shown) === "manage" && holds\("unpaid_leave", \["ceo", "super_admin"\]\.includes\(user\.role\)\)/.test(strip(read("components/portal/leave.tsx"))) && /<AttendanceAdminPanel role=\{user\.role\} areas=\{\["unpaid"\]\} showPending=\{false\} \/>/.test(read("components/portal/leave.tsx")), "unpaid days moved to Leave, CEO-only as before");
  ok(/<AttendancePolicyCard \/>/.test(read("components/portal/automation-rules.tsx")) && !/method: "(POST|PUT|PATCH)"/.test(read("components/portal/automation-rules.tsx")), "the policy card in Automation & Rules reads the rule and edits nothing");
  ok(!/Illustrative|UI reference only/.test(["attendance-overview", "attendance-records", "shift-roster", "attendance-exceptions", "attendance-reports"].map((f) => read(`components/portal/${f}.tsx`)).join("\n")), "none of the reference's illustrative labels is copied");
  return out;
}

let fail = 0, n = 0;
const report = (list) => { for (const [p, m] of list) { n++; if (!p) { fail++; console.error(`FAIL ${m}`); } } };
const NOMUT = process.env.NOMUT === "1";
const dir = mkdtempSync(join(tmpdir(), "att4-"));
bundle(root, "worker/src/attendance-day.ts", join(dir, "day.mjs"));
bundle(root, "worker/src/index.ts", join(dir, "worker.mjs"));
report(await pure(join(dir, "day.mjs")));
report(await runtime(join(dir, "worker.mjs")));
report(sourceChecks((f) => readFileSync(join(root, f), "utf8")));
const checks = n;
const D = "worker/src/attendance-day.ts", S = "worker/src/staff.ts";
const MUT = [
  [D, "a holiday is not a day off", [["  if (x.holiday) return { ...base, status: \"holiday\", workedOffDay: worked };\n", ""]]],
  [S, "a resigned record without a last day counted", [["  return !gone || Boolean(u.rejoined_on && u.rejoined_on.slice(0, 10) <= day);", "  return true || !gone || Boolean(u.rejoined_on && u.rejoined_on.slice(0, 10) <= day);"]]],
  [D, "a pending punch counts as absent", [["  if (x.pendingPunches > 0) return { ...base, status: \"pending\" };\n", ""]]],
  [D, "no grace", [["  const grace = graceOn(x.day);", "  const grace = 0;"]]],
  [D, "today counts as absent before the start", [["    if (start !== null && x.nowMin < start + grace) return { ...base, status: \"not_due\" };\n", ""]]],
  [D, "a fixed 10:00 cut-off", [["    const lm = lateBy(x.pattern, x.assigned, first.inMin, grace);", "    const lm = Math.max(0, first.inMin - 600);"]]],
  [S, "the register leaks coordinates", [["loc: locOutcome(p.gps, fence), ...(raw ? { gps: p.gps } : {}),", "loc: locOutcome(p.gps, fence), gps: p.gps,"]]],
  [S, "the monitor leaks coordinates", [["      if (!rawGps) delete row.in_gps;\n", ""]]],
  [S, "the register without its gate", [["  if (path === \"/attendance/day\") {\n    if (!team) return err(\"forbidden\", \"HR access required\", 403);", "  if (path === \"/attendance/day\") {"]]],
  ["worker/src/permissions.ts", "HR given the raw coordinates", [["attendance_location_raw: [\"ceo\"],", "attendance_location_raw: [\"ceo\", \"hr_admin\"],"]]],
  ["components/portal/on-shift.tsx", "Team On Shift decides 'not clocked in' itself", [["    : m.status && VERDICT_STATE[m.status] ? VERDICT_STATE[m.status]!\n", ""]]],
  ["components/portal/attendance-panel.tsx", "the Settings tab back", [["const STAFF_VIEWS: readonly AttView[] = [\"records\", \"roster\"];", "const STAFF_VIEWS: readonly AttView[] = [\"records\", \"roster\"]; const _s = \"settings\";"]]],
];
for (const [file, name, reps] of NOMUT ? [] : MUT) {
  n++;
  let src = readFileSync(join(root, file), "utf8");
  let applied = true;
  for (const [from, to] of reps) { if (!src.includes(from)) { applied = false; break; } src = src.replace(from, to); }
  if (!applied) { fail++; console.error(`FAIL mutation did not apply: ${name}`); continue; }
  let res;
  if (file.startsWith("worker/")) {
    const mdir = mkdtempSync(join(tmpdir(), "att4-m-"));
    cpSync(join(root, "worker"), join(mdir, "worker"), { recursive: true, filter: (s) => !s.includes("node_modules") });
    cpSync(join(root, "package.json"), join(mdir, "package.json"));
    for (const d of ["lib", "constants", "types"]) { try { cpSync(join(root, d), join(mdir, d), { recursive: true }); } catch { /* not every folder exists */ } }
    writeFileSync(join(mdir, file), src);
    try { bundle(mdir, "worker/src/attendance-day.ts", join(mdir, "day.mjs")); bundle(mdir, "worker/src/index.ts", join(mdir, "worker.mjs")); } catch { fail++; console.error(`FAIL mutation did not build: ${name}`); continue; }
    res = [...await pure(join(mdir, "day.mjs")), ...await runtime(join(mdir, "worker.mjs")), ...sourceChecks((f) => readFileSync(join(f === file ? mdir : root, f), "utf8"))];
    rmSync(mdir, { recursive: true, force: true });
  } else {
    res = sourceChecks((f) => (f === file ? src : readFileSync(join(root, f), "utf8")));
  }
  if (!res.some(([p]) => !p)) { fail++; console.error(`FAIL mutation not caught: ${name}`); }
}
rmSync(dir, { recursive: true, force: true });
if (fail) { console.error(`attendance4: ${fail} of ${n} failed`); process.exit(1); }
console.log(`attendance4: ${checks} checks passed (${NOMUT ? "mutations skipped" : `${MUT.length} mutations caught`}) - one day verdict: a rest day, a holiday and leave are never 'not clocked in'; before the start is not due; late after the person's own start and the dated grace; a waiting punch counts nowhere; the register, roster, month chart and report agree; raw coordinates for the CEO only; five views, the roster board in Tasks; no other permission or table changed`);
