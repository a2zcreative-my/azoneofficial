#!/usr/bin/env node
/* Guard - v1.208.0: ONE WORK SESSION. ONE AUTHORITATIVE RECORD. TWO
 * CONSISTENT INTERFACES. ZERO DUPLICATION.
 *
 * The owner's On Shift brief, 25-10-2026, and the audit before it. He chose:
 * build the screen as proposed; keep the approved offline outbox and show a
 * held punch as NOT confirmed; one pairing rule for hours on every screen;
 * and the server fix for two phones pressing at the same instant.
 *
 *   1. ONE PAIRING RULE. lib/clock-sessions.ts is the browser's copy of the
 *      server's pairSessions (worker/src/clock-day.ts). Both are bundled and
 *      RUN on the same punches here - a split day, a double clock-in, a
 *      stray clock-out, a night across midnight - and must agree. The
 *      Dashboard and Attendance read it; first-in-to-last-out is gone.
 *   2. ONE PUNCH AT A TIME. The punch route reads the day's count first and
 *      saves with one INSERT ... SELECT that only lands while the count is
 *      unchanged - checked in the source AND run against SQLite: the second
 *      of two simultaneous clock-ins stores nothing.
 *   3. ONE PUNCH PATH. On Shift's button and link call the Dashboard's own
 *      punch(); the new file makes no request of its own except the two
 *      READS it names (the roster, the outbox), never a write.
 *   4. NOTHING IS SHOWN AS DONE BEFORE THE SERVER SAYS SO. A punch held on
 *      the phone is "not confirmed" and holds the button; the timer runs
 *      only from the server's open_since, and not at all before a clock-in.
 *   5. WHO SEES WHAT. The team section is drawn for the roles the monitor
 *      route answers (MANAGE_ROLES on the page, hr_manage/exec_view in the
 *      worker), and never draws a position. Location is asked for only by
 *      the punch and the "Check my location" tap.
 *
 * Negative-tested by: dropping `if (open) continue;` from the browser copy
 * (1); the plain VALUES insert back (2); a POST from on-shift.tsx (3); the
 * timer ticking while idle (4); TeamOnShift drawn without the role check (5).
 */
import { readFileSync, mkdtempSync } from "node:fs";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");
let failed = 0, passed = 0;
const ok = (label, cond, why = "") => { if (cond) passed++; else { failed++; console.log(`  ✗ ${label}${why ? ` — ${why}` : ""}`); } };
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

const dir = mkdtempSync(join(tmpdir(), "onshift-"));
const bundle = async (src, name) => {
  const out = join(dir, `${name}.mjs`);
  execSync(`npx esbuild "${join(root, src)}" --bundle --format=esm --platform=neutral --outfile="${out}" --log-level=error`, { cwd: root, stdio: "inherit" });
  return import(pathToFileURL(out).href);
};

/* ---- 1. one pairing rule ---- */
{
  const server = await bundle("worker/src/clock-day.ts", "server");
  const client = await bundle("lib/clock-sessions.ts", "client");
  const P = (type, at) => ({ type, at });
  const cases = {
    "split day (11-17 + 20-22)": [P("clock_in", "2026-09-18 03:00:00"), P("clock_out", "2026-09-18 09:00:00"), P("clock_in", "2026-09-18 12:00:00"), P("clock_out", "2026-09-18 14:00:00")],
    "second clock-in while open": [P("clock_in", "2026-09-18 01:00:00"), P("clock_in", "2026-09-18 02:00:00"), P("clock_out", "2026-09-18 09:00:00")],
    "stray clock-out first": [P("clock_out", "2026-09-18 00:30:00"), P("clock_in", "2026-09-18 01:00:00"), P("clock_out", "2026-09-18 05:15:00")],
    "still open": [P("clock_in", "2026-09-18 01:00:00")],
    "out of order input": [P("clock_out", "2026-09-18 09:00:00"), P("clock_in", "2026-09-18 01:00:00")],
    "a very long session": [P("clock_in", "2026-09-17 16:00:00"), P("clock_out", "2026-09-18 15:00:00")],
  };
  for (const [name, list] of Object.entries(cases)) {
    const a = server.pairSessions(list), b = client.pairSessions(list);
    ok(`${name}: the browser pairs as the server does`, JSON.stringify(a) === JSON.stringify(b), `${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
    ok(`${name}: and counts the same minutes`, server.sessionMinutes(a) === client.sessionMinutes(b));
  }
  const split = client.daysOf([
    { type: "clock_in", created_at: "2026-09-18 03:00:00" }, { type: "clock_out", created_at: "2026-09-18 09:00:00" },
    { type: "clock_in", created_at: "2026-09-18 12:00:00" }, { type: "clock_out", created_at: "2026-09-18 14:00:00" },
  ]);
  ok("a split day is 8h, not the 11h first-in-to-last-out made it", split.length === 1 && split[0].minutes === 480 && split[0].sessions.length === 2, JSON.stringify(split));
  const night = client.daysOf([{ type: "clock_in", created_at: "2026-09-17 16:30:00" }]);
  ok("days are Malaysia days (00:30 MYT is the next day)", night[0]?.date === "2026-09-18");

  const att = strip(read("components/portal/attendance.tsx"));
  const dash = strip(read("components/portal/dashboard.tsx"));
  ok("Attendance's hours are the paired shifts", /const paired = new Map\(daysOf\(records\)/.test(att) && /totalMs \+= p\.minutes \* 60000/.test(att));
  ok("…and nothing on the page measures first-in to last-out any more", !/new Date\(lo\.replace|new Date\(lastOut\.replace/.test(att));
  ok("the Dashboard's month reads the same function, with no cap of its own", /const monthDaysPaired = daysOf\(monthRecs\);/.test(dash) && !/Math\.min\(\(x\.t - openAt\)/.test(dash));
  ok("the browser copy stays import-free", !/^import /m.test(read("lib/clock-sessions.ts")));
}

/* ---- 2. one punch at a time ---- */
{
  const staff = read("worker/src/staff.ts");
  const route = staff.slice(staff.indexOf('if (path === "/attendance" && method === "POST")'), staff.indexOf('if (path === "/attendance/ot/pending"'));
  const seenAt = route.indexOf("const seenBefore = ");
  ok("the day's count is read before any decision", seenAt > 0 && seenAt < route.indexOf("const { results: pressedToday }"));
  const inserts = route.match(/INSERT INTO attendance_records[\s\S]*?`/g) ?? [];
  ok("every save in the route is conditional", inserts.length === 3 && inserts.every((q) => /SELECT \?1, \?2[\s\S]*\$\{unchanged\}/.test(q)) && !inserts.some((q) => /VALUES/.test(q)), `${inserts.length}`);
  ok("a save that lost the race stores nothing and says so", /if \(saved === 0\) \{[\s\S]{0,900}?already: true[\s\S]{0,40}?409/.test(route));
  ok("pending and its alerts follow only a punch that was saved", /storedPending = saved > 0 && pending === 1;/.test(route));
  ok("the manual entry route is not touched", /if \(path === "\/attendance\/manual" && method === "POST"\)/.test(staff));

  /* run the condition itself */
  const cond = (route.match(/const unchanged = `([^`]+)`/) ?? [])[1];
  ok("the condition is found", Boolean(cond));
  if (cond) {
    const db = new DatabaseSync(":memory:");
    db.exec(`CREATE TABLE attendance_records (id INTEGER PRIMARY KEY, user_id INTEGER, type TEXT, ip TEXT, user_agent TEXT, gps TEXT, pending_approval INTEGER, created_at TEXT DEFAULT (datetime('now')), offline_sent_at TEXT)`);
    const sql = `INSERT INTO attendance_records (user_id, type, ip, user_agent, gps, pending_approval) SELECT ?1, ?2, ?3, ?4, ?5, ?6 ${cond}`;
    const seen = (u, d) => db.prepare(`SELECT COUNT(*) AS n FROM attendance_records WHERE user_id = ?1 AND date(created_at, '+8 hours') BETWEEN date(?2, '-1 day') AND ?2`).get(u, d).n;
    const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
    const s0 = seen(7, today);
    /* two phones read the same count, then both try to save */
    const a = db.prepare(sql).run(7, "clock_in", null, null, "1,1,1", null, null, null, today, s0).changes;
    const b = db.prepare(sql).run(7, "clock_in", null, null, "1,1,1", null, null, null, today, s0).changes;
    ok("two simultaneous clock-ins: the first is saved, the second is not", a === 1 && b === 0, `${a} ${b}`);
    const c = db.prepare(sql).run(7, "clock_out", null, null, "1,1,1", null, null, null, today, seen(7, today)).changes;
    ok("the next punch, read fresh, is saved", c === 1);
    const d = db.prepare(sql).run(8, "clock_in", null, null, "1,1,1", null, null, null, today, seen(8, today)).changes;
    ok("another person is not held up by it", d === 1);
  }
}

/* ---- 3. one punch path ---- */
{
  const on = strip(read("components/portal/on-shift.tsx"));
  ok("on-shift.tsx makes no write and no request of its own", !/\bapi\(|csrfFetch|fetch\(|method:\s*"/.test(on));
  ok("…its only reads are the roster route and the outbox", /useCachedApi<RosterLite>\("\/staff\/roster"/.test(on) && /outboxAll\(\)/.test(on) && !/enqueue|drainOutbox/.test(on));
  const dash = strip(read("components/portal/dashboard.tsx"));
  ok("one punch function on the page", (dash.match(/const punch = async/g) ?? []).length === 1 && (dash.match(/const punchOt = async/g) ?? []).length === 1);
  const zone = dash.slice(dash.indexOf("const zoneShift = ("), dash.indexOf("const ZONES: Record"));
  ok("On Shift's button and link call it", /void press\(\(\) => punch\("clock_out"\)\)/.test(zone) && /void press\(\(\) => punch\("clock_in"\)\)/.test(zone) && /void press\(\(\) => punch\("clock_out", forgotArmed\)\)/.test(zone));
  ok("…and the day is read again before the button is offered again", /const press = async \(run: \(\) => Promise<void>\) => \{\s*if \(settling\) return;/.test(dash) && /window\.setTimeout\(\(\) => setSettling\(false\), 1500\)/.test(dash) && (dash.slice(dash.indexOf("const punch = async"), dash.indexOf("const punchOt = async")).match(/await load\(\);/g) ?? []).length === 5 && !/void load\(\);/.test(dash.slice(dash.indexOf("const punch = async"), dash.indexOf("const punchOt = async"))));
  /* v1.229.0 - My Day no longer draws the clock (the owner: "summary only"):
     the OT buttons, toast and reminder are drawn by On Shift alone */
  ok("…and On Shift's OT buttons, toast and reminder are drawn there alone", /\{otButtons && /.test(zone) && /\{punchFeedback\}/.test(zone) && /\{clockOutNote\}/.test(zone)
     && (dash.match(/\{otButtons\}/g) ?? []).length === 1 && (dash.match(/\{punchFeedback\}/g) ?? []).length === 1 && (dash.match(/\{clockOutNote\}/g) ?? []).length === 1);
}

/* ---- 4. nothing shown as done before the server says so ---- */
{
  const on = strip(read("components/portal/on-shift.tsx"));
  const dash = strip(read("components/portal/dashboard.tsx"));
  const zone = dash.slice(dash.indexOf("const zoneShift = ("), dash.indexOf("const ZONES: Record"));
  ok("the timer ticks only while a shift is open", /const now = useTick\(state === "open" && !!openSince\);/.test(on));
  ok("…from the clock-in the server recorded", /const openSinceRaw = openNow \? \(todayShift\?\.entry\?\.open_since \?\? today\[0\]\?\.created_at \?\? null\) : null;/.test(dash));
  ok("the state is the server's (unknown until the day is read)", /const shiftState: ShiftState = !attKnown \? \(attendanceError \? "error" : "unknown"\) : openNow \? "open" : hasOut \? "done" : "idle";/.test(dash));
  ok("a punch held on the phone is said to be NOT confirmed", /not confirmed/.test(read("components/portal/on-shift.tsx")) && /e\.kind === "punch"/.test(on));
  ok("…and holds the button until it lands", (zone.match(/disabled=\{!!busy \|\| holding \|\| settling\}/g) ?? []).length === 3);
  ok("a slow answer is said, never resent", /const slow = !!busy && slowAt === busySince && busySince > 0;/.test(dash) && /Do not press again/.test(read("components/portal/dashboard.tsx")));
  ok("the toast still says 'Kept' for a queued punch, never 'recorded'", /if \(res\.queued\) \{[\s\S]{0,200}?Kept — no signal/.test(read("components/portal/dashboard.tsx")));
}

/* ---- 5. who sees what ---- */
{
  const dash = strip(read("components/portal/dashboard.tsx"));
  const on = strip(read("components/portal/on-shift.tsx"));
  const staff = read("worker/src/staff.ts");
  ok("the team is drawn for the roles that read the monitor", /\{MANAGE_ROLES\.includes\(user\.role\) && \(\s*<div className=\{shiftCss\.wide\}>\s*<TeamOnShift /.test(dash));
  ok("…the worker still answers only hr_manage and exec_view", /if \(path === "\/attendance\/monitor" && method === "GET"\) \{[\s\S]{0,600}?if \(!can\(user\.role, "hr_manage"\) && !can\(user\.role, "exec_view"\)\)/.test(staff));
  ok("the team section never draws a position", !/in_gps|geofence|lat\b|lng\b/.test(on));
  ok("the week shows the person's own roster rows", /s\.host_user_id === userId/.test(on) && /b\.user_id === userId/.test(on));
  ok("location is read only by the punch and the tap", (dash.match(/navigator\.geolocation\.getCurrentPosition/g) ?? []).length === 1 && !/geolocation/.test(on));
  ok("no break, face or tracking feature", !/start break|end break|facial|face match|track(ing)? location/i.test(on + dash));
}

/* v1.213.1 - the owner, 27-10-2026: "all_claimed" was printed under the
   clock, and the Check In / Check Out marks are his own drawings */
{
  const d = read("components/portal/dashboard.tsx");
  ok("why Clock in is not offered is said in words, never the server's code",
     /const whyNoClockIn = noClockInWhy\(todayShift\?\.why_not \?\? null\);/.test(d) && (d.match(/\{whyNoClockIn\}/g) ?? []).length === 1
     && /if \(code === "no_slots"\)/.test(d) && !/\{whyNoClockIn \?\?/.test(d) && !/why_not\s*\}/.test(d));
  ok("On Shift punches under the owner's marks: PunchIcon in and out, on the button and its tile",
     (d.match(/<PunchIcon kind="in" \/>/g) ?? []).length === 2 && (d.match(/<PunchIcon kind="out" \/>/g) ?? []).length === 2
     && !/<AppIcon name="(place|offboard)" \/>\s*\{(shiftsToday|L\("Check Out"|busy === "clock_)/.test(d));
  const pi = read("components/ui/punch-icon.tsx"), pc = read("components/ui/punch-icon.module.css");
  ok("the marks are decorative and take the theme's tokens", /aria-hidden focusable="false"/.test(pi) && /fill: var\(--primary\)/.test(pc) && /fill: var\(--info\)/.test(pc) && /fill: var\(--success\)/.test(pc) && !/#[0-9a-f]{3,6}/i.test(pc));
}

ok("the guard is registered", /\["on-shift-module", "/.test(read("scripts/run-guards.mjs")));

console.log(`  ${passed} check(s) passed.`);
if (failed) { console.log(`\n${failed} check(s) failed.`); process.exit(1); }
