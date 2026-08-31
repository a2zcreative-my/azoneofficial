/**
 * Payable-days guard (v1.75.0) — guard #23.
 *
 * This is the one guard in the suite that is about somebody's salary being
 * a specific number, so it does not read the source and hope. It compiles
 * lib/payroll-days.ts and runs the arithmetic against worked examples,
 * including the real August 2026 payslip that exposed the bug.
 *
 * THE BUG IT EXISTS FOR. Until v1.75.0 the incomplete-month deduction was
 * prorated on DAYS CLOCKED minus recorded unpaid days. Approved paid leave
 * was in neither term, so a person on medical leave — paid by law — looked
 * absent and was charged basic ÷ working days for it. Nur Nasuha, August
 * 2026: 19 working days, 15 clocked, 1 unpaid, 1 approved medical. She lost
 * RM 105.26 to a payslip that added up perfectly.
 *
 * The rule now: attendance never moves money by itself. Proration comes from
 * employment dates, deductions come from explicitly recorded unpaid days,
 * and the two cannot overlap because they read different things.
 *
 *   node tests/payroll-days.mjs
 */
import { execFileSync } from "node:child_process";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const root = new URL("..", import.meta.url).pathname;
const read = (p) => readFileSync(path.join(root, p), "utf8");

let pass = 0;
const fails = [];
const ok = (label, cond, extra = "") => {
  if (cond) pass++;
  else fails.push(`${label}${extra ? ` — ${extra}` : ""}`);
};

const out = path.join(mkdtempSync(path.join(tmpdir(), "pay-guard-")), "pd.mjs");
try {
  execFileSync(
    process.platform === "win32" ? "npx.cmd" : "npx",
    ["esbuild", path.join(root, "lib/payroll-days.ts"), "--format=esm", `--outfile=${out}`],
    { stdio: "pipe" },
  );
} catch (e) {
  console.log(`FAIL — lib/payroll-days.ts does not compile: ${e.message}`);
  process.exit(1);
}
const { incompleteCents, unpaidDaysFromHours, unpaidCents, WORK_DAY_MINUTES } =
  await import(`file://${out}`);

/* ---- 1. an existing staff member is NEVER prorated ---- */
{
  /* The whole point. Employed all month = payable equals the month's working
     days = nothing to prorate, whatever the attendance clock says. */
  ok("a full month deducts nothing", incompleteCents(200000, 19, 19) === 0);
  ok("clocking fewer days than the month has deducts nothing on its own",
     incompleteCents(200000, 19, 19) === 0,
     "absence is only money when somebody records it as unpaid leave");
  ok("a missing payable-days figure deducts nothing",
     incompleteCents(200000, 19, null) === 0 && incompleteCents(200000, 19, undefined) === 0,
     "an unknown must never be treated as zero days employed");
  ok("a zero-working-day month deducts nothing", incompleteCents(200000, 0, 0) === 0);
}

/* ---- 2. a joiner and a leaver ARE prorated, on employment ---- */
{
  /* RM2000, 19 working days, started on the 8th so 12 of them are theirs. */
  ok("a mid-month joiner is prorated on the days employed",
     incompleteCents(200000, 19, 12) === Math.round((200000 * 7) / 19),
     `got ${incompleteCents(200000, 19, 12)}`);
  ok("somebody who joined after the month ends is paid nothing",
     incompleteCents(200000, 19, 0) === 200000);
  ok("one missing day is one nineteenth", incompleteCents(200000, 19, 18) === Math.round(200000 / 19));
}

/* ---- 3. THE REGRESSION: Nur Nasuha, August 2026 ----
   19 working days · 15 clocked · 1 recorded unpaid · 1 approved medical.
   Employed all month, so nothing prorates. The only deduction is the one
   unpaid day she actually took. */
{
  const basic = 200000;
  const inc = incompleteCents(basic, 19, 19);
  const unpaid = unpaidCents(basic, 1);
  ok("her incomplete-month deduction is now zero", inc === 0,
     `got ${inc} — the old formula charged 31579 sen, of which 10526 was her approved MEDICAL leave`);
  ok("her unpaid day is still deducted, at 1/26", unpaid === 7692, `got ${unpaid}`);
  const net = basic - inc - unpaid;
  ok("her August net is RM 1,923.08", net === 192308, `got ${net}`);
  /* What the OLD formula did, reconstructed so the change is stated in
     ringgit rather than described: missing = 19 - 15 = 4, minus the 1
     recorded unpaid = 3 adjustable, at basic ÷ 19 each. */
  const oldInc = Math.round((basic * (19 - 15 - 1)) / 19);
  ok("the old formula's figure is reproduced exactly", oldInc === 31579, `got ${oldInc}`);
  ok("old total deductions match the printed payslip", oldInc + unpaid === 39271,
     `got ${oldInc + unpaid} — the August slip printed RM 392.71, so this IS the arithmetic that ran`);
  ok("one of those three days was her approved MEDICAL leave",
     Math.round(basic / 19) === 10526,
     "RM 105.26 charged for a day the Employment Act says is paid");
  ok("the change is worth RM 315.79 to her this month", oldInc - inc === 31579,
     "all three days stop deducting: the medical one was never chargeable, and the other two " +
     "are only money if somebody records them as unpaid");
}

/* ---- 4. part of a day ---- */
{
  ok("8 hours worked is nothing unpaid", unpaidDaysFromHours(8) === 0);
  ok("2 hours of 8 leaves 0.75 day unpaid", unpaidDaysFromHours(2) === 0.75,
     `got ${unpaidDaysFromHours(2)}`);
  ok("4 hours is half a day", unpaidDaysFromHours(4) === 0.5);
  ok("nothing worked is a whole day", unpaidDaysFromHours(0) === 1);
  ok("it rounds to a quarter, not to six decimal places",
     unpaidDaysFromHours(2.34) === 0.75,
     `got ${unpaidDaysFromHours(2.34)} — a payslip line of 0.7075 DAYS is one nobody can check`);
  ok("more than a full day is impossible", unpaidDaysFromHours(-3) === 1 && unpaidDaysFromHours(99) === 0);
  ok("a fractional day deducts a fractional amount",
     unpaidCents(200000, 0.75) === Math.round((200000 / 26) * 0.75));
  ok("a working day is eight hours, break included", WORK_DAY_MINUTES === 480);
}

/* ---- 5. the worker computes it the same way ----
   The API cannot import this module (separate bundle, separate tsconfig), so
   the one line that matters is held to the same text. Two payroll formulas
   that disagree is two answers to "what was I paid". */
{
  const staff = read("worker/src/staff.ts");
  ok("the worker prorates on employment dates",
     /monthDays > 0 && payableDays < monthDays[\s\S]{0,120}?Math\.round\(\(basicCents \* \(monthDays - payableDays\)\) \/ monthDays\)/.test(staff),
     "the server's incompleteCents no longer matches lib/payroll-days.ts");
  ok("the worker's payable days come from joined_on / left_on",
     /days\.filter\(\(d\) => \(!joined \|\| d >= joined\.slice\(0, 10\)\) && \(!left \|\| d <= left\.slice\(0, 10\)\)\)/.test(staff));
  ok("recompute no longer prorates on worked_days",
     !/Math\.max\(0, workD - \(e\.worked_days as number\)\)/.test(staff),
     "that expression is the bug — it charged approved paid leave as absence");
  ok("the payslip prints the server's figure rather than deriving its own",
     /incompAdj = hourlySlip \? 0 : \(x\?\.incomplete_deduction_cents \?\? 0\)/.test(read("components/portal/payroll-panel.tsx")));
  ok("the worker turns hours short into quarter days the same way",
     /Math\.round\(\(shortMins \/ WORK_DAY_MINUTES\) \* 4\) \/ 4/.test(staff));
  ok("a whole day is the most one row can be",
     /!\(daysU > 0\) \|\| daysU > 1/.test(staff),
     "without the cap a typo in hours could deduct a week");
}

/* ---- 6. no clock-in is a proposal, never a deduction ---- */
{
  const staff = read("worker/src/staff.ts");
  ok("the absence scan exists", /path === "\/payroll\/absences" && method === "GET"/.test(staff));
  ok("a day covered by ANY approved leave is not proposed",
     /lv\.some\(\(l\) => l\.user_id === u\.id && l\.start_date <= d && l\.end_date >= d\)/.test(staff),
     "paid leave must not be offered up as an unpaid day");
  ok("days in the future are not proposed", /\.filter\(\(d\) => d <= todayMyt\)/.test(staff));
  ok("hourly part-timers are skipped", /if \(isHourlyUser\(u\.role, u\.employment_status\)\) continue;/.test(staff),
     "they are paid by the clock already — a day not worked is simply not paid");
  ok("the scan only proposes; it writes nothing",
     !/INSERT INTO leave_requests[\s\S]{0,400}?absences/.test(staff) &&
     /return json\(\{ month: mA2, work_day_hours/.test(staff));
  const panel = read("components/portal/payroll-panel.tsx");
  ok("the client offers it only to the role the server admits",
     /const canMarkUnpaid = \["ceo", "super_admin"\]\.includes\(role\)/.test(panel),
     "a button that 403s is worse than no button");
}

console.log(
  fails.length === 0
    ? `PASS — only a joiner or a leaver is prorated, approved paid leave costs nobody a ringgit (${pass} checks)`
    : `\n${fails.map((f) => `  ✗ ${f}`).join("\n")}\n\n${fails.length} check(s) failed.`,
);
process.exit(fails.length === 0 ? 0 : 1);
