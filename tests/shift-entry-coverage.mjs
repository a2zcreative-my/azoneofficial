import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { execSync } from "node:child_process";

const dir = mkdtempSync(join(tmpdir(), "shift-entry-"));
const bundle = async (file, name) => {
  const out = join(dir, name + ".mjs");
  execSync(`npx --no-install esbuild "${file}" --bundle --format=esm --platform=node --outfile="${out}"`, { stdio: "pipe" });
  return import(pathToFileURL(out).href);
};
try {
  const { halfDayWindows, leaveOverlaps, remainingWindows, savedCoverage } = await bundle("lib/leave-coverage.ts", "coverage");
  const { shiftEntry } = await bundle("worker/src/shift-entry.ts", "entry");
  const blocks = [{ start: 660, end: 1020 }, { start: 1230, end: 1350 }];
  assert.deepEqual(halfDayWindows(blocks, "first_half"), [{ start: 660, end: 900 }]);
  assert.deepEqual(halfDayWindows(blocks, "second_half"), [{ start: 900, end: 1020 }, { start: 1230, end: 1350 }]);
  assert.deepEqual(halfDayWindows([{ start: 600, end: 900 }, { start: 800, end: 1080 }], "first_half"), [{ start: 600, end: 840 }]);
  assert.deepEqual(halfDayWindows([], "first_half"), []);
  const day = "2026-09-17";
  const leave = { start_date: day, end_date: day, days: 0.5, day_part: "second_half", coverage_json: JSON.stringify(halfDayWindows(blocks, "second_half")) };
  assert.equal(leaveOverlaps(leave, day, { start: 660, end: 900 }), false);
  assert.equal(leaveOverlaps(leave, day, { start: 899, end: 901 }), true);
  assert.equal(leaveOverlaps(leave, day, { start: 1020, end: 1230 }), false);
  assert.deepEqual(remainingWindows(blocks, [leave], day), [{ start: 660, end: 900 }]);
  const legacy = { start_date: day, end_date: day, days: 0.5 };
  assert.equal(savedCoverage(legacy), null);
  assert.equal(remainingWindows(blocks, [legacy], day), null);
  assert.equal(leaveOverlaps(legacy, day, { start: 660, end: 900 }), true);
  assert.equal(savedCoverage({ ...leave, coverage_json: "broken" }), null);
  assert.equal(leaveOverlaps({ start_date: "2026-09-16", end_date: day, days: 2 }, day, blocks[0]), true);
  assert.deepEqual(remainingWindows(blocks, [{ start_date: day, end_date: day, days: 1 }], day), []);
  const overnight = { ...leave, coverage_json: '[{"start":1380,"end":1500}]' };
  assert.equal(leaveOverlaps(overnight, "2026-09-18", { start: 0, end: 30 }), true);
  assert.equal(leaveOverlaps(overnight, "2026-09-18", { start: 60, end: 90 }), false);
  const state = (clock, punches = [], slots = blocks) => shiftEntry(new Date(`${day}T${clock}:00+08:00`), day, slots, [], punches);
  assert.equal(state("10:29").launch_shift, false);
  assert.equal(state("10:30").launch_shift, true);
  const punch = { type: "clock_in", created_at: `${day} 03:00:00` };
  assert.equal(state("11:01", [punch]).launch_shift, false);
  assert.equal(state("11:01", [punch]).clocked_in, true);
  assert.equal(state("11:01", [punch]).clock_out_at, `${day}T09:00:00.000Z`);
  const closed = [punch, { type: "clock_out", created_at: `${day} 09:00:00` }];
  assert.equal(state("17:00", closed).launch_shift, false);
  assert.equal(state("20:00", closed).launch_shift, true);
  assert.equal(state("23:00", closed).launch_shift, false);
  assert.equal(state("11:00", [], []).launch_shift, false);
  assert.equal(shiftEntry(new Date(`${day}T11:00:00+08:00`), day, blocks, [], [], true).launch_shift, false);
  const night = shiftEntry(new Date("2026-09-18T00:45:00+08:00"), "2026-09-18", [], [{ start: 1380, end: 1500 }], [{ type: "clock_in", created_at: `${day} 15:00:00` }]);
  assert.equal(night.clocked_in, true);
  assert.equal(night.clock_out_at, `${day}T17:00:00.000Z`);
  const staff = readFileSync("worker/src/staff.ts", "utf8");
  assert.match(staff, /day_part, coverage_json\)\s*VALUES/);
  assert.match(staff, /coverage_review/);
  assert.match(staff, /partial_review\.push/);
  // Exercise the API against an isolated SQLite copy of the real schema.
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=OFF");
  for (const file of readdirSync("worker/migrations").filter(f => f.endsWith(".sql")).sort()) {
    const sql = readFileSync(`worker/migrations/${file}`, "utf8");
    try { db.exec(sql); } catch {
      for (const part of sql.split(/;\s*(?:\r?\n|$)/)) {
        if (!part.trim() || part.trim().startsWith("--")) continue;
        try { db.exec(part + ";"); } catch { /* cumulative legacy replay, as in sql-schema-check */ }
      }
    }
  }
  db.exec("INSERT INTO users(id,email,password_hash,name,role,is_active) VALUES(9001,'test@example.test','fixture','Employee','editor',1),(9002,'manager@example.test','fixture','Manager','ceo',1)");
  db.exec("UPDATE shift_patterns SET thu_start=660, thu_end=1020, thu_start2=1230, thu_end2=1350 WHERE is_default=1");
  const DB = { prepare(sql) {
    let values = [];
    const run = (method) => {
      const args = [];
      const query = sql.replace(/\?(\d+)/g, (_, n) => { args.push(values[Number(n) - 1] ?? null); return "?"; });
      return db.prepare(query)[method](...args);
    };
    return { bind(...args) { values = args; return this; },
      async first() { return run("get") ?? null; }, async all() { return { results: run("all") }; },
      async run() { const r = run("run"); return { success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; } };
  } };
  const { handleStaff } = await bundle("worker/src/staff.ts", "staff");
  const env = { DB, MEDIA: { get: async () => null } };
  const user = { id: 9001, email: 'test@example.test', name: 'Employee', role: 'editor' };
  const call = (path, body, method = "POST", actor = user) => handleStaff(new Request(`https://fixture.test/api/v1/staff${path}`, {
    method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined,
  }), env, path.split("?")[0], actor);
  const draft = { type: "annual", start_date: day, end_date: day, days: 0.5, reason: "Fixture" };
  assert.equal((await call("/leave", draft)).status, 400);
  assert.equal((await call("/leave", { ...draft, end_date: "2026-09-18", day_part: "first_half" })).status, 400);
  const created = await call("/leave", { ...draft, day_part: "second_half", coverage_json: "client must not choose coverage" });
  assert.equal(created.status, 201, await created.clone().text());
  const id = (await created.json()).id;
  const saved = db.prepare("SELECT * FROM leave_requests WHERE id=?").get(id);
  assert.equal(saved.day_part, "second_half");
  assert.deepEqual(JSON.parse(saved.coverage_json), halfDayWindows(blocks, "second_half"));
  assert.equal(saved.status, "pending");
  db.exec(`UPDATE leave_requests SET status='approved', stage='approved' WHERE id=${id}`);
  const manager = { ...user, id: 9002, role: "ceo" };
  const booking = { session_date: day, start_time: "11:00", end_time: "15:00", host_user_id: 9001 };
  const available = await call("/live-sessions", booking, "POST", manager);
  assert.equal(available.status, 201, await available.clone().text());
  assert.equal((await call("/live-sessions", { ...booking, start_time: "15:00", end_time: "16:00" }, "POST", manager)).status, 409);
  const sessionId = (await available.json()).id;
  assert.equal((await call(`/live-sessions/${sessionId}`, { start_time: "15:00", end_time: "16:00" }, "PATCH", manager)).status, 409);
  assert.equal((await call(`/live-sessions/${sessionId}`, { status: "cancelled" }, "PATCH", manager)).status, 200);
  const scan = await call("/payroll/absences?month=2026-09", null, "GET", manager);
  assert.equal(scan.status, 200, await scan.clone().text());
  const absence = (await scan.json()).staff.find(r => r.user_id === user.id);
  assert(absence.partial_review.some(r => r.d === day && r.unresolved === false));
  assert(!absence.missing.includes(day));
  assert(!absence.short.some(r => r.d === day));
  const report = await call("/attendance/verification?month=2026-09", null, "GET", manager);
  assert.equal(report.status, 200, await report.clone().text());
  const employeeReport = (await report.json()).staff.find(r => r.user_id === user.id);
  assert.equal(employeeReport.leave_total, 0.5);
  assert(employeeReport.partial_review_dates.includes(day));
  assert(!employeeReport.absent_dates.includes(day));
  db.exec("INSERT INTO leave_requests(id,user_id,type,start_date,end_date,days,status,stage) VALUES(9901,9001,'annual','2026-09-18','2026-09-18',0.5,'pending','applied')");
  assert.equal((await call("/leave/9901", { action: "approve" }, "PATCH", manager)).status, 409);
  db.exec("UPDATE shift_patterns SET thu_end=1080 WHERE is_default=1");
  const amended = await call(`/leave/${id}/amend`, { reason: "Corrected spelling only" }, "PUT", manager);
  assert.equal(amended.status, 200, await amended.clone().text());
  assert.equal(db.prepare("SELECT coverage_json FROM leave_requests WHERE id=?").get(id).coverage_json, saved.coverage_json);
  const overnightBooking = await call("/live-sessions", { ...booking, start_time: "23:00", end_time: "01:00" }, "POST", manager);
  assert.equal(overnightBooking.status, 201);
  db.exec("INSERT INTO attendance_records(user_id,type,created_at) VALUES(9001,'clock_in','2026-09-17 15:00:00'),(9001,'clock_out','2026-09-17 16:45:00')");
  const { runShiftReminders } = await bundle("worker/src/shift-reminders-cron.ts", "reminders");
  await runShiftReminders(env, new Date("2026-09-18T00:55:00+08:00"));
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id=9001 AND kind='attendance' AND ref LIKE 'shift_%'").get().n, 0);
  db.close();
  console.log("Shift entry and half-day coverage behavioral checks passed.");
} finally { rmSync(dir, { recursive: true, force: true }); }
