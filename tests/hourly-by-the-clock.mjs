#!/usr/bin/env node
/* Guard #44 — v1.109.0: a part-time live host is paid by the clock, less the break.
 *
 * The CEO, 05-09-2026, with a Saturday on the register: *"if live host part
 * time should count as part time working which is based on their working
 * hour and minus 1 hour of break"*. The rule is RUN here on the day he was
 * looking at and on the edges around it, then the wiring is read.
 *
 * Negative-tested by: deducting the break on every day (the 3h case fails);
 * deducting it at >= 5h instead of > 5h (the exact-5h case fails); putting
 * `minutesInWindows` back into clockedMinutes (the pattern check fails).
 */
import { readFileSync, mkdtempSync } from "node:fs";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = new URL("..", import.meta.url).pathname;
const read = (p) => readFileSync(join(root, p), "utf8");
const staff = read("worker/src/staff.ts");
const panels = read("components/portal/role-panels.tsx");
const payroll = read("components/portal/payroll-panel.tsx");
const page = read("app/portal/page.tsx");

let failed = 0, passed = 0;
const ok = (label, cond, why = "") => {
  if (cond) passed++; else { failed++; console.log(`  ✗ ${label}${why ? ` — ${why}` : ""}`); }
};

const dir = mkdtempSync(join(tmpdir(), "hourly-"));
const out = join(dir, "hourly.mjs");
execSync(`npx esbuild ${join(root, "worker/src/hourly.ts")} --bundle --format=esm --platform=neutral --outfile=${out} --log-level=error`, { cwd: root, stdio: "inherit" });
const { hourlyBreakFor, hourlyPaidMinutes, HOURLY_BREAK_MINUTES, BREAK_AFTER_MINUTES } = await import(pathToFileURL(out).href);

/* ---- the rule, run ---- */
{
  const h = (hh, mm = 0) => hh * 60 + mm;
  ok("the CEO's Saturday: in 11:05, out 22:30 = 11h25 clocked, 10h25 paid", hourlyPaidMinutes(h(11, 25)) === h(10, 25), `${hourlyPaidMinutes(h(11, 25))} min`);
  ok("a three-hour evening session took no break and is paid in full", hourlyPaidMinutes(h(3)) === h(3), "docking an hour from three is the rule misread");
  ok("exactly five hours earns no break - the Act says MORE than five", hourlyPaidMinutes(h(5)) === h(5));
  ok("five hours and one minute earns the hour", hourlyPaidMinutes(h(5, 1)) === h(4, 1));
  ok("an eight-hour day pays seven", hourlyPaidMinutes(h(8)) === h(7));
  ok("the break is one hour", HOURLY_BREAK_MINUTES === 60 && hourlyBreakFor(h(9)) === 60);
  ok("the trigger is the statutory five hours", BREAK_AFTER_MINUTES === 300);
  ok("a day that never pairs pays nothing, not a negative", hourlyPaidMinutes(0) === 0 && hourlyPaidMinutes(-30) === 0);
  ok("at RM15/h the Saturday is RM 156.25", Math.round((hourlyPaidMinutes(h(11, 25)) * 1500) / 60) === 15625);
}

/* ---- the wiring ---- */
{
  ok("clockedMinutes pays the span less the break", /const brk = hourlyBreakFor\(span\);[\s\S]{0,120}?counted \+= span - brk;/.test(staff));
  ok("...and no longer trims to a pattern", !/let day = minutesInWindows\(sh, from, to\);/.test(staff) && !/counted \+= day > 0 \? day : span;/.test(staff),
     "a part-timer has no pattern to be measured against");
  ok("...and still excludes pending punches", /const clockedMinutes[\s\S]{0,900}?\$\{notPending\}/.test(staff), "an unapproved claim is not wages");
  ok("the payslip row carries clocked, break and days", /r\.hourly_break_live = cm\.breaks;/.test(staff) && /r\.hourly_days_live = cm\.days;/.test(staff));
  ok("the register marks a part-timer by the clock, not as a rest day", /day_kind: hourly \? "hourly" : shR\.kind,/.test(staff) && /part-time · by the clock/.test(panels),
     "the CEO's screenshot: two punches on a Saturday, both saying rest day");
  ok("a part-timer's punch is not late, early or resting", /if \(hourlyPunch && !assigned\) \{\s*flag = "hourly";/.test(staff) && /hourly: L\("Counted by the clock"/.test(page));
  ok("the payroll row explains the deduction where the figure is", /hourly_break_live \?\? 0\) > 0 &&/.test(payroll) && /One hour of unpaid break is deducted on each day that ran past five hours/.test(payroll),
     "a figure an hour a day under the clock must say why on the row");
  ok("the old off-schedule chip is gone", !/off-schedule/.test(payroll));
}

if (failed) { console.log(`\n${failed} check(s) failed.`); process.exit(1); }
console.log(`PASS — a part-timer is paid what the clock says, less one hour of break past five (${passed} checks)`);
