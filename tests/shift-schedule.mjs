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
     /shR = await shiftOn\(env, r\.user_id, dateIso\)/.test(staff));
  ok("the payroll export carries which schedule it judged against",
     /"day_kind", "pattern", "shift_start", "shift_end"/.test(staff),
     "a late flag nobody can trace back to a set of hours is a late flag nobody can dispute");
  ok("the short-day scan measures against the person's scheduled length",
     /const scheduled = shD\.start !== null && shD\.end !== null/.test(staff),
     "somebody on 11:00-19:00 is not short at 18:00");
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

/* ---- 6. registered and probed ---- */
for (const [name, probe] of [
  ["0099_shift_patterns", "0099 \\(working-hour schedules\\)"],
  ["0100_attendance_pending", "0100 \\(a forgotten punch waits for approval\\)"],
]) {
  ok(`${name} is in EXPECTED_MIGRATIONS`, index.includes(`"${name}",`));
  ok(`${name} has a health probe`, new RegExp(probe).test(index));
}

console.log(
  fails.length === 0
    ? `PASS — hours come from a schedule, and an unapproved punch counts for nothing (${pass} checks)`
    : `\n${fails.map((f) => `  ✗ ${f}`).join("\n")}\n\n${fails.length} check(s) failed.`,
);
process.exit(fails.length === 0 ? 0 : 1);
