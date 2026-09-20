#!/usr/bin/env node
/**
 * Guard #90 - v1.170.0: THE DASHBOARD'S MONTH IS THE PAYROLL'S MONTH.
 *
 * `myMonthDays()` classifies one person's month for the Dashboard card. It
 * must reach the SAME verdict per day as the verification report and payroll
 * do - the shift in force, the block the punch was for, roster assignments,
 * leave, holidays - and it must never invent attendance. These cases run the
 * real worker module (esbuild-bundled) against a real SQLite database
 * (node:sqlite) with the real migration schemas, behind a D1-shaped shim.
 *
 * Properties, not implementation:
 *   - a punch before the block starts is on time; after it, late; past the
 *     half-day line, a half day
 *   - the SECOND block of a split day is judged against its own start
 *   - a rest day with punches is a day worked, never "late"
 *   - a scheduled day with no punch is absent only once it is OVER; today
 *     without a punch is pending
 *   - approved full-day leave is leave; a public holiday is a holiday
 *   - a roster/live-board assignment outside the pattern is "assigned"
 *   - pending (unapproved) punches count for nothing
 *   - days before the person joined do not exist
 *   - the response is additive: `days` rides beside records/today_shift
 */
import { readFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import { pathToFileURL, fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(root, p), "utf8");
let passed = 0, failed = 0;
const ok = (label, cond, why = "") => { if (cond) passed++; else { failed++; console.log(`  x ${label}${why ? ` - ${why}` : ""}`); } };

/* ---- 1. the real module ---- */
const dir = mkdtempSync(join(tmpdir(), "month-"));
const out = join(dir, "staff.mjs");
execSync(`npx esbuild "${join(root, "worker/src/staff.ts")}" --bundle --format=esm --platform=neutral --outfile="${out}" --log-level=error`, { cwd: root, stdio: "inherit", shell: true });
const S = await import(pathToFileURL(out).href);
ok("myMonthDays is exported by the worker", typeof S.myMonthDays === "function");

/* ---- 2. a real database, real schemas ---- */
const db = new DatabaseSync(":memory:");
db.exec("PRAGMA foreign_keys = OFF");
db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, full_name TEXT, role TEXT, is_active INTEGER DEFAULT 1, joined_on TEXT, left_on TEXT, rejoined_on TEXT);`);
for (const m of ["0003_staff_portal.sql", "0011_holidays.sql", "0099_shift_patterns.sql", "0100_attendance_pending.sql", "0102_split_shifts.sql", "0103_unpaid_break.sql", "0119_shift_categories_ot_amend.sql", "0129_shift_pattern_retire.sql", "0130_holiday_replaces.sql", "0133_half_day_coverage.sql"]) {
  const sql = read(`worker/migrations/${m}`).replace(/--[^\n]*/g, "");
  /* only the statements about the tables under test - the migrations also
     touch tables this fixture has no need for */
  for (const stmt of sql.split(";")) {
    const s = stmt.trim();
    if (!s) continue;
    if (!/attendance_records|holidays|shift_patterns|staff_shifts|leave_requests/.test(s)) continue;
    try { db.exec(s); } catch (e) { if (!/already exists|duplicate column/.test(String(e))) throw e; }
  }
}
const prep = (sql) => {
  const plain = sql.replace(/\?(\d+)/g, "?");
  const used = [...sql.matchAll(/\?(\d+)/g)].map((m) => Number(m[1]));
  return {
    _b: [],
    bind(...b) { this._b = b.map((v) => (v === undefined ? null : typeof v === "boolean" ? (v ? 1 : 0) : v)); return this; },
    _a() { return used.length ? used.map((n) => this._b[n - 1] ?? null) : this._b; },
    async first() { const r = db.prepare(plain).get(...this._a()); return r === undefined ? null : r; },
    async all() { return { results: db.prepare(plain).all(...this._a()), success: true }; },
    async run() { const r = db.prepare(plain).run(...this._a()); return { success: true, meta: { changes: r.changes } }; },
  };
};
const env = { DB: { prepare: prep, async batch(st) { const r = []; for (const s of st) r.push(await s.run()); return r; } } };
const q = (sql, ...b) => db.prepare(sql).run(...b);

/* ---- 3. the fixture: a month that is entirely in the past ---- */
/* every date below is in the past relative to any run of this guard, so
   "today" never falls inside the month and absence is unambiguous */
const MONTH = "2026-06";                     // June 2026: 1st is a Monday
q(`INSERT INTO users (id,name,role,joined_on) VALUES (1,'Aina','sales_marketing','2026-06-03'),(2,'Zaf','live_host','2026-01-01')`);
q(`DELETE FROM shift_patterns`);
/* Mon-Fri 10:00-18:00, Sat 10:00-14:00 + 20:00-22:00 (a split day), Sun rest; half day at 13:00 */
q(`INSERT INTO shift_patterns (id,name,mon_start,mon_end,tue_start,tue_end,wed_start,wed_end,thu_start,thu_end,fri_start,fri_end,sat_start,sat_end,sat_start2,sat_end2,half_day_minutes,is_default,break_minutes)
   VALUES (1,'Office',600,1080,600,1080,600,1080,600,1080,600,1080,600,840,1200,1320,780,1,60)`);
q(`INSERT INTO staff_shifts (user_id,pattern_id,effective_from) VALUES (1,1,'2026-01-01'),(2,1,'2026-01-01')`);
q(`INSERT INTO holidays (holiday_date,name,kind) VALUES ('2026-06-08','Agong''s Birthday','public')`);
q(`INSERT INTO leave_requests (user_id,type,start_date,end_date,days,status) VALUES (1,'annual','2026-06-10','2026-06-10',1,'approved')`);

/* MYT wall-clock -> the UTC stamp the table stores */
const at = (day, hhmm) => {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(Date.parse(`${day}T00:00:00Z`) + ((h - 8) * 60 + m) * 60000).toISOString().slice(0, 19).replace("T", " ");
};
const punch = (uid, day, type, hhmm, pending = null) =>
  q(`INSERT INTO attendance_records (user_id,type,created_at,pending_approval) VALUES (?,?,?,?)`, uid, type, at(day, hhmm), pending);

punch(1, "2026-06-03", "clock_in", "09:52"); punch(1, "2026-06-03", "clock_out", "18:05");   // Wed - on time
punch(1, "2026-06-04", "clock_in", "10:14"); punch(1, "2026-06-04", "clock_out", "18:00");   // Thu - late
punch(1, "2026-06-05", "clock_in", "13:30"); punch(1, "2026-06-05", "clock_out", "18:00");   // Fri - half day
punch(1, "2026-06-06", "clock_in", "19:50"); punch(1, "2026-06-06", "clock_out", "22:05");   // Sat - evening block only, early for it
punch(1, "2026-06-07", "clock_in", "11:00"); punch(1, "2026-06-07", "clock_out", "15:00");   // Sun - rest day, worked
/* 2026-06-09 Tue: nothing - absent. 2026-06-10 Wed: leave. 2026-06-08 Mon: holiday. */
punch(1, "2026-06-11", "clock_in", "10:00");                                                 // Thu - on time, never clocked out
punch(1, "2026-06-12", "clock_in", "10:40", 1);                                              // Fri - PENDING punch: counts for nothing

const days = await S.myMonthDays(env, 1, MONTH);
const by = Object.fromEntries(days.map((d) => [d.date, d]));

ok("days before the person joined do not exist", !by["2026-06-01"] && !by["2026-06-02"], JSON.stringify(days.slice(0, 2)));
ok("a punch before the block starts is on time", by["2026-06-03"]?.status === "ok" && by["2026-06-03"].in === "09:52" && by["2026-06-03"].out === "18:05", JSON.stringify(by["2026-06-03"]));
ok("a punch after the block started is late", by["2026-06-04"]?.status === "late", JSON.stringify(by["2026-06-04"]));
ok("a punch past the half-day line is a half day", by["2026-06-05"]?.status === "half_day", JSON.stringify(by["2026-06-05"]));
ok("the evening block of a split day is judged against ITS start - 19:50 for 20:00 is on time", by["2026-06-06"]?.status === "ok", JSON.stringify(by["2026-06-06"]));
ok("a rest day worked is a rest day with punches, never late", by["2026-06-07"]?.status === "rest_day" && by["2026-06-07"].worked === true && by["2026-06-07"].scheduled === false, JSON.stringify(by["2026-06-07"]));
ok("a public holiday is a holiday", by["2026-06-08"]?.status === "holiday", JSON.stringify(by["2026-06-08"]));
ok("a scheduled day that is over with no punch is absent", by["2026-06-09"]?.status === "absent" && by["2026-06-09"].worked === false, JSON.stringify(by["2026-06-09"]));
ok("approved full-day leave is leave", by["2026-06-10"]?.status === "leave", JSON.stringify(by["2026-06-10"]));
ok("clocked in and never out: on time, open, no out time", by["2026-06-11"]?.status === "ok" && by["2026-06-11"].open === true && by["2026-06-11"].out === null, JSON.stringify(by["2026-06-11"]));
ok("a punch awaiting the CEO is neither present nor absent - it is awaiting approval", by["2026-06-12"]?.status === "awaiting_approval" && by["2026-06-12"].worked === false, JSON.stringify(by["2026-06-12"]));
ok("Sundays on the pattern are rest days", by["2026-06-14"]?.status === "rest_day" && by["2026-06-14"].worked === false);
ok("the month is complete up to its last day (all in the past)", days.length === 28 && days[days.length - 1].date === "2026-06-30", `${days.length}`);
ok("no day is 'pending' in a month that is over", days.every((d) => d.status !== "pending"));

/* ---- assigned work outside the pattern: a live booked on a rest day ---- */
db.exec(`CREATE TABLE live_sessions (id INTEGER PRIMARY KEY, host_user_id INTEGER, session_date TEXT, start_time TEXT, end_time TEXT, client_name TEXT, status TEXT DEFAULT 'scheduled')`);
q(`INSERT INTO live_sessions (host_user_id,session_date,start_time,end_time,client_name) VALUES (2,'2026-06-14','20:00','22:00','Client X')`);
punch(2, "2026-06-14", "clock_in", "19:55"); punch(2, "2026-06-14", "clock_out", "22:10");
punch(2, "2026-06-15", "clock_in", "10:00"); punch(2, "2026-06-15", "clock_out", "18:00");
const host = Object.fromEntries((await S.myMonthDays(env, 2, MONTH)).map((d) => [d.date, d]));
ok("a live booked on a rest day makes it a working day the host was ASSIGNED to", ["assigned", "ok"].includes(host["2026-06-14"]?.status) && host["2026-06-14"].worked === true, JSON.stringify(host["2026-06-14"]));
ok("...and an ordinary on-time day beside it is still on time", host["2026-06-15"]?.status === "ok");

/* ---- today is never absent before it is over ---- */
{
  const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
  const thisMonth = today.slice(0, 7);
  q(`INSERT INTO users (id,name,role,joined_on) VALUES (3,'Now','editor','2026-01-01')`);
  q(`INSERT INTO staff_shifts (user_id,pattern_id,effective_from) VALUES (3,1,'2026-01-01')`);
  const now = Object.fromEntries((await S.myMonthDays(env, 3, thisMonth)).map((d) => [d.date, d]));
  const t = now[today];
  ok("today without a punch is pending (or a rest day / holiday), never absent", t && (t.status === "pending" || t.status === "rest_day" || t.status === "holiday"), JSON.stringify(t));
  ok("no day after today is listed", Object.keys(now).every((d) => d <= today));
}

/* ---- the route carries it, additively ---- */
const staff = read("worker/src/staff.ts");
ok("GET /staff/attendance answers with `days` beside records and today_shift",
  /return json\(\{ month, as_of: [^}]*records: results, ot, ot_eligible, today_shift, days \}\)/.test(staff));
ok("...and a classifier that cannot run leaves the punches intact", /try \{ days = await myMonthDays\(env, forUser, month\); \} catch/.test(staff));
ok("the classifier uses the report's own verdict functions, not a copy",
  /export async function myMonthDays[\s\S]*?shiftResolver\(env, assignedAt\)[\s\S]*?lateAgainst\(sh, inMin\)[\s\S]*?sh\.halfDay/.test(staff));

console.log(failed === 0 ? `month-days: ${passed} checks passed.` : `\n${failed} month-days check(s) failed (${passed} passed).`);
process.exitCode = failed === 0 ? 0 : 1;
