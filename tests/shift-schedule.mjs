/**
 * Working-hours guard (v1.76.0) — guard #24.
 *
 * Two things here are quiet when they break, and both cost somebody either
 * money or a day of their record.
 *
 *   1. A PENDING PUNCH MUST COUNT FOR NOTHING. A forgotten clock-out is a
 *      CLAIM — it is stored so the day is not lost, but until the CEO
 *      approves it, it is not evidence that anybody was anywhere. Five
 *      queries count attendance (hourly pay, the payslip's working days, the
 *      payroll day-fill, the absence scan and the payroll export) and every
 *      one of them has to exclude it. Miss one and an unapproved claim
 *      quietly pays an hourly host, or cancels the very absence it is
 *      claiming about.
 *
 *   2. NOBODY MAY READ THE OLD CONSTANT. Working hours were a single
 *      `SHIFT` — 10:00–18:00, Mon–Fri — and the company had already moved
 *      its Friday finish by announcement without the code knowing. Every
 *      flag has to come from `shiftOn()` now; a stray `SHIFT.startMinutes`
 *      is that bug growing back.
 *
 *   node tests/shift-schedule.mjs
 */
import { readFileSync } from "node:fs";
import path from "node:path";

const root = new URL("..", import.meta.url).pathname;
const read = (p) => readFileSync(path.join(root, p), "utf8");
const staff = read("worker/src/staff.ts");
const index = read("worker/src/index.ts");
const panels = read("components/portal/role-panels.tsx");
const page = read("app/portal/page.tsx");

let pass = 0;
const fails = [];
const ok = (label, cond, extra = "") => {
  if (cond) pass++;
  else fails.push(`${label}${extra ? ` — ${extra}` : ""}`);
};

/* ---- 1. a pending punch is excluded EVERYWHERE attendance is counted ---- */
{
  ok("there is one shared not-pending clause", /export async function notPendingSql/.test(staff));
  const uses = (staff.match(/notPendingSql\(env/g) ?? []).length;
  ok("every counting query uses it", uses >= 6,
     `${uses} references (1 definition + 5 call sites expected) — a counting query without it pays out on an unapproved claim`);
  for (const [what, re] of [
    ["hourly pay", /const clockedMinutes[\s\S]{0,600}?\$\{notPending\}/],
    ["the payslip's working days", /const wd = await env\.DB\.prepare\([\s\S]{0,300}?\$\{notPendingX\}/],
    ["the payroll day-fill", /COUNT\(DISTINCT date\(created_at, '\+8 hours'\)\) AS days[\s\S]{0,200}?\$\{notPendingA\}/],
    ["the absence scan", /const notPendingS = await notPendingSql\(env\);[\s\S]{0,500}?\$\{notPendingS\}/],
    ["the payroll export", /\$\{notPendingE\}/],
  ]) {
    ok(`${what} excludes pending punches`, re.test(staff),
       "an unapproved claim would be counted as time worked");
  }
  ok("the clause is only added when the column exists",
     /pendingColKnown \? ` AND COALESCE\(\$\{alias\}pending_approval, 0\) != 1` : ""/.test(staff),
     "a pre-0100 database must keep working rather than 500 on every payroll query");
}

/* ---- 2. the old single shift is no longer the rule ---- */
{
  /* SHIFT survives only as a fallback inside shiftOn() and as the classifier's
     `?? SHIFT.x` default. Anything else reading it is the old bug. */
  const lines = staff.split(/\r?\n/);
  const offenders = [];
  lines.forEach((l, i) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(l)) return;
    if (!/SHIFT\.(startMinutes|endMinutes|halfDayMinutes)/.test(l)) return;
    if (/\?\? SHIFT\./.test(l)) return;          // a null-safe default inside a shiftOn result
    if (/weekday \? SHIFT\./.test(l)) return;     // the fallback inside shiftOn itself
    if (/windows: weekday \? \[\{ start: SHIFT\./.test(l)) return; // v1.80.0: the same fallback, as a block
    if (/halfDay: SHIFT\.halfDayMinutes/.test(l)) return;
    offenders.push(i + 1);
  });
  ok("nothing flags attendance against the old company-wide shift", offenders.length === 0,
     `worker/src/staff.ts lines ${offenders.join(", ")} — hours come from shiftOn() now`);
  ok("the punch classifier resolves the person's shift",
     /const sh = await shiftOn\(env, user\.id, todayMYT\);/.test(staff));
  ok("a rest-day punch is flagged as one, not as an early-out",
     /if \(sh\.kind === "rest_day"\) \{\s*flag = "rest_day";/.test(staff),
     "measuring a Saturday against hours that do not apply produced a false early_out");
  ok("the register annotates against each person's own schedule",
     /const shR = shiftAtR\(r\.user_id, dateIso\)/.test(staff));
  /* v1.80.0 — this named the export's columns verbatim, so widening the
     export to carry BOTH blocks failed a guard about traceability. It now
     asserts the PROPERTY: whatever the columns are called, the export must
     carry the hours judged against and the pattern they came from. */
  ok("the payroll export carries which schedule it judged against",
     /"day_kind", "pattern", "shift_hours"/.test(staff) && /shiftLabel\(shE\)/.test(staff),
     "a late flag nobody can trace back to a set of hours is a late flag nobody can dispute");
  ok("the export shows the evening block, not just the first one",
     /"scheduled_minutes"/.test(staff) && /"assigned_work"/.test(staff),
     "a split day exported as 11:00-17:00 hides the two hours that make it eight");
  ok("the short-day scan measures against the person's scheduled length",
     /const scheduled = scheduledMinutes\(shD\) \|\| WORK_DAY_MINUTES/.test(staff),
     "somebody on 11:00-19:00 is not short at 18:00, and a split day owes both blocks");
  ok("the short-day scan compares like with like",
     /const inside = minutesInWindows\(shD, fromD, fromD \+ span\);/.test(staff),
     "11:00 to 22:30 is 11.5 hours elapsed and 8 hours worked - comparing the span against a scheduled 8 reports a short day as a long one");
}

/* ---- 3. effective dating ---- */
{
  ok("the pattern in force is the latest one that had started",
     /a\.effective_from <= \?2[\s\S]{0,120}?ORDER BY a\.effective_from DESC/.test(staff),
     "without the date bound, changing hours today would re-flag a month already paid");
  ok("a person with no assignment falls back to the default pattern",
     /FROM shift_patterns WHERE is_default = 1 LIMIT 1/.test(staff));
  ok("a database without 0099 still resolves hours", /catch \{\s*return fallback\(\); \/\/ pre-0099/.test(staff));
}

/* ---- 3A. NO SHIFT LOOKUP INSIDE A LOOP ----
   `shiftOn` is two remote D1 queries. Inside the absence scan that is two per
   person PER DAY, and inside the attendance export two per PUNCH: the Payroll
   tab sat on "TOTAL - 0 staff" for the better part of a minute because of it
   (CEO, 31-08-2026: *"why seem too take longer to load? this is abnormal!"*).

   `shiftResolver` reads the whole schedule once - a handful of patterns and
   one row per assignment - and answers in memory afterwards. The invariant is
   not "call the fast one", which is advice; it is that NO await'd shift
   lookup may sit inside a loop, which is checkable. Brace-tracked, because a
   line-window would not know where a loop ends. */
{
  const lines = staff.split(/\r?\n/);
  let depth = 0;
  const open = [];
  const inLoop = [];
  lines.forEach((l, i) => {
    const code = l.replace(/\/\/.*$/, "");
    const loopHere = /\b(for|while)\s*\(/.test(code) ||
                     /\.(map|forEach|flatMap)\s*\(\s*(async\s*)?\(/.test(code);
    const o = (code.match(/\{/g) ?? []).length;
    const c = (code.match(/\}/g) ?? []).length;
    if (/await shiftOn\(env/.test(code) && open.length) inLoop.push(i + 1);
    if (loopHere && o > c) open.push(depth);
    depth += o - c;
    while (open.length && depth <= open[open.length - 1]) open.pop();
  });
  ok("no shift lookup runs inside a loop", inLoop.length === 0,
     `worker/src/staff.ts line(s) ${inLoop.join(", ")} — that is two database round trips per iteration; ` +
     "read the schedule once with shiftResolver() before the loop");
  ok("the batch resolver exists and reads everything in two queries",
     /export async function shiftResolver/.test(staff) &&
     /SELECT \* FROM shift_patterns/.test(staff) &&
     /SELECT user_id, pattern_id, effective_from FROM staff_shifts/.test(staff));
  ok("the three loops that used to query per iteration all use it",
     ["shiftAtR", "shiftAtA", "shiftAtE"].every((n) => new RegExp(`const ${n} = await shiftResolver\\(env\\)`).test(staff)),
     "the register, the absence scan and the attendance export");
  ok("both paths read a pattern row the same way",
     /function dayShiftFrom\(/.test(staff) &&
     (staff.match(/dayShiftFrom\(/g) ?? []).length >= 3,
     "two readings of the same row is two answers to whether a blank start means a rest day");
  ok("the resolver still honours the effective date",
     /\.find\(\(x\) => x\.effective_from <= iso\)/.test(staff) &&
     /sort\(\(a, b\) => b\.effective_from\.localeCompare\(a\.effective_from\)\)/.test(staff),
     "sorted newest-first, so the first match at or before the date is the one in force");
  ok("a pre-0099 database still gets hours out of the resolver",
     /return \(_u, iso\) => shiftFallback\(new Date\(`\$\{iso\}T00:00:00Z`\)\.getUTCDay\(\)\); \/\/ pre-0099/.test(staff));

  /* And the client half: the tab must not wait on the scan to draw a table. */
  const pay = read("components/portal/payroll-panel.tsx");
  ok("the payroll table does not wait for the absence scan",
     /void api<\{ staff: AbsenceRow\[\] \}>\(`\/payroll\/absences\?month=\$\{month\}`\)/.test(pay) &&
     !/const ab = await api<\{ staff: AbsenceRow\[\] \}>/.test(pay),
     "awaiting it mid-load left the page reading TOTAL - 0 staff, which looks like a payroll with nobody in it");
}

/* ---- 4. the approval ---- */
{
  const i = staff.indexOf('if (path === "/attendance/pending/decide" && method === "POST")');
  ok("the decide route exists", i > 0);
  const body = staff.slice(i, i + 3000);
  ok("only the CEO decides", /can\(user\.role, "unpaid_leave"\)[\s\S]{0,120}?Only the CEO can approve a forgotten punch/.test(body),
     "approving one creates paid time out of a claim nobody can verify");
  ok("approving can set the real time",
     /UPDATE attendance_records SET pending_approval = 0, created_at = \?2/.test(body),
     "the CEO asked for exactly this — the claimed time is the one thing nobody can check");
  ok("approving without a time accepts the claim as it stands",
     /`UPDATE attendance_records SET pending_approval = 0,\s*\n\s*amended_by = \?2/.test(body));
  ok("rejecting deletes the punch",
     /DELETE FROM attendance_records WHERE id = \?1 AND pending_approval = 1/.test(body),
     "a rejected claim left in the table is a row that gets counted by something later");
  ok("the staff member is told either way",
     (body.match(/notify\(env, rowP\.user_id, "attendance"/g) ?? []).length === 2);
  ok("both decisions are audited",
     /"attendance\.forgot_reject"/.test(body) && /"attendance\.forgot_approve"/.test(body));
  ok("the CEO is notified when one arrives",
     /Forgotten \$\{body\.type === "clock_in" \? "clock-in" : "clock-out"\} to approve/.test(staff));
}

/* ---- 5. the client ---- */
{
  ok("a forgotten clock-out is offered, not refused",
     /if \(type === "clock_out" && !today\.some\(\(r\) => r\.type === "clock_in"\) && !forgot\)/.test(page),
     "refusing meant a worked day could not be recorded at all and vanished from payroll");
  ok("it takes a second, deliberate tap", /setForgotArmed\(true\)/.test(page) && /punch\("clock_out", forgotArmed\)/.test(page));
  ok("the person is told it does not count yet",
     /does not count towards your hours until the CEO approves/.test(page));
  ok("the approvals card is CEO-only, like the route",
     /\{canUnpaid && pending\.length > 0 && \(/.test(panels));
  ok("the schedule editor writes minutes, not text",
     /half_day_minutes: toMins\(editP\.half\) \?\? 720/.test(panels));
  ok("an empty day means a rest day, and says so",
     /Leave both boxes empty for a rest day/.test(panels));
  ok("the assignment carries its effective date",
     /disabled=\{!assign\.user_id \|\| !assign\.pattern_id \|\| !assign\.effective_from\}/.test(panels));
  ok("the register can filter to rest days and to waiting punches",
     /<option value="rest_day">/.test(panels) && /<option value="pending">/.test(panels));
}

/* ---- 7. SPLIT SHIFTS (v1.80.0, guard #24 extended) ----
 *
 * The CEO: *"require 8 hours, 11:00am to 5:00pm then continue work at 8:30pm
 * to 10:30pm"*. A day is two blocks now, and every one of these checks is a
 * place where reaching for `sh.start` or `sh.end` — which still exist, and
 * still mean the FIRST block — gives a confidently wrong answer about the
 * evening. Each of these was wrong before this release:
 *
 *   - 20:28 for a 20:30 block measured against 11:00 is not "late by nine
 *     hours", and past `half_day_minutes` it silently docked half a day.
 *   - Leaving at 22:30 measured against a 17:00 first-block end said "ok",
 *     and leaving at 17:05 said "ok" too — the flag meant nothing.
 *   - 11:00 to 22:30 clocked is 11.5 hours. At RM15/h the three and a half
 *     hours spent at home was RM 52.50 a day.
 */
{
  const helpers = ["windowAt", "lateAgainst", "endOfDay", "scheduledMinutes", "minutesInWindows", "shiftLabel"];
  for (const h of helpers) {
    ok(`${h} exists`, new RegExp(`export function ${h}\\(`).test(staff),
       "the split-shift maths must live in one place, not be re-derived at each call site");
  }
  ok("a day carries every block, not just the first",
     /windows: ShiftWindow\[\]/.test(staff) && /windows\.sort\(\(a, b\) => a\.start - b\.start\)/.test(staff),
     "blocks out of order would make endOfDay() name the wrong finish");
  ok("a block needs BOTH ends to exist",
     /if \(row\.s2 !== null && row\.s2 !== undefined && row\.e2 !== null && row\.e2 !== undefined\)/.test(staff),
     "half a block would put scheduled hours on the payroll that nobody typed");
  ok("a rest day is still no FIRST block",
     /kind: row\.s === null \|\| row\.s === undefined \? "rest_day" : "workday"/.test(staff),
     "changing this test would reclassify every existing pattern");

  /* The three classifiers. Named individually because they drift apart —
     that is exactly what happened between the register and the CSV export
     in v1.76, where one used > start and the other used <= start. */
  const lateUses = (staff.match(/lateAgainst\(/g) ?? []).length;
  ok("every clock-in flag is measured against the right block", lateUses >= 4,
     `${lateUses} references (1 definition + the live route, the register and the CSV export) — a call site still on sh.start calls the evening shift late`);
  const endUses = (staff.match(/endOfDay\(/g) ?? []).length;
  ok("every clock-out flag is measured against the LAST block", endUses >= 4,
     `${endUses} references — sh.end is the first block's finish, so an early-out against it is meaningless on a split day`);

  /* Assigned work. */
  ok("there is a batch resolver for assigned work", /export async function assignedResolver/.test(staff));
  ok("it reads BOTH places the company schedules work",
     /FROM live_sessions/.test(staff) && /FROM task_blocks b/.test(staff),
     "a host is booked on the live board and a designer on the roster - one source would vouch for half the company");
  ok("a cancelled live session vouches for nothing",
     /status != 'cancelled'/.test(staff),
     "turning up for a session that was called off is not assigned work");
  ok("an open-ended block does not cover the rest of the night",
     /const OPEN_BLOCK_MINUTES = 180/.test(staff),
     "task_blocks.end_time is nullable, and treating a blank as open-ended would vouch for a punch at midnight");
  ok("assigned work is only looked up when the schedule says nothing",
     /const inWindow = windowAt\(sh, mins\);/.test(staff) &&
     /const asg = inWin \? null : assignedAtR\(/.test(staff),
     "inside a scheduled block the schedule is already the answer, and the lookup would cost queries to confirm it");
  ok("the resolver is built ONCE per request, not per punch",
     /const assignedAtR = await assignedResolver\(env, `\$\{month\}-01`/.test(staff) &&
     /const assignedAtE = await assignedResolver\(env, `\$\{month\}-01`/.test(staff),
     "the v1.77.0 rule: a lookup inside a loop comes from a resolver read once");

  /* The money. */
  ok("hourly pay counts the overlap with the schedule, not the span",
     /let day = minutesInWindows\(sh, from, to\);/.test(staff),
     "last-out minus first-in pays for the gap between an afternoon and an evening shift");
  ok("assigned minutes are never paid twice",
     /if \(windowAt\(sh, m\)\) continue;/.test(staff),
     "an evening session overlapping a scheduled block would be counted by both");
  ok("nothing to measure against means the whole span still counts",
     /counted \+= day > 0 \? day : span;/.test(staff),
     "a rest day worked, or a database without 0099, must never silently zero a wage");
  ok("the payslip shows what was clocked as well as what was counted",
     /hourly_clocked_live/.test(staff) && /hourly_trimmed_live/.test(staff) &&
     /off-schedule/.test(read("components/portal/payroll-panel.tsx")),
     "a change that reduces a wage has to say so on the row");

  /* The editor. */
  ok("the second block cannot start before the first one finishes",
     /the second block starts before the first one finishes/.test(staff),
     "overlapping blocks would count the same minute twice");
  ok("a second block cannot exist without a first",
     /a second block needs a first one/.test(staff));
  ok("the editor can bulk-apply days", /const \[bulkDays, setBulkDays\]/.test(panels) &&
     /Apply to \$\{bulkDays\.length \|\| 0\} day/.test(panels),
     "the CEO: bulk choose day for me to update easily");
  ok("the editor shows what a day and a week come to",
     /const dayMinutes = /.test(panels) && /Week: \$\{hLabel\(/.test(panels),
     "eight hours split across two blocks is not a sum to do in your head");
  ok("the card opens one section at a time",
     /const \[section, setSection\] = useState<"find" \| "add" \| "unpaid" \| "hours">/.test(panels),
     "the CEO: I want minimalist interface for me to easier to choose which area that I want to update");
  ok("the register can filter to assigned-work punches",
     /<option value="assigned">/.test(panels));
  /* THE DEPLOY WINDOW. The worker publishes before the migrations run, and
     shiftOn names its columns explicitly - so for a few minutes it asks a
     database with no mon_start2 for mon_start2. The outer catch would have
     turned that into the 10:00-18:00 constant on the one path that
     classifies a live clock-in. */
  /* ONE regex spanning the whole recovery, not two independent ones: staff.ts
     already contained the line `if (!String(e2).includes("no such column"))
     throw e2;` in two unrelated places, so a check that merely found that text
     somewhere in the file passed with this recovery deleted. It did, on the
     first run of this very check. */
  ok("a database without 0102 still reads its own patterns",
     /use = await withBlocks\(true\);[\s\S]{0,220}?no such column[\s\S]{0,120}?use = await withBlocks\(false\)/.test(staff),
     "falling back to the hard-coded shift would flag every punch between the deploy and the migration against hours nobody works");
}

/* ---- 6. registered and probed ---- */
for (const [name, probe] of [
  ["0099_shift_patterns", "0099 \\(working-hour schedules\\)"],
  ["0100_attendance_pending", "0100 \\(a forgotten punch waits for approval\\)"],
  ["0102_split_shifts", "0102 \\(a working day in two blocks\\)"],
]) {
  ok(`${name} is in EXPECTED_MIGRATIONS`, index.includes(`"${name}",`));
  ok(`${name} has a health probe`, new RegExp(probe).test(index));
}

console.log(
  fails.length === 0
    ? `PASS — hours come from a schedule that can split a day, and an unapproved punch counts for nothing (${pass} checks)`
    : `\n${fails.map((f) => `  ✗ ${f}`).join("\n")}\n\n${fails.length} check(s) failed.`,
);
process.exit(fails.length === 0 ? 0 : 1);
