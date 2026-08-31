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
const { incompleteCents, unpaidDaysFromHours, unpaidCents, WORK_DAY_MINUTES, unpaidDeduction,
        publicHolidayWorkedCents, partTimeHolidayPremiumCents } =
  await import(`file://${out}`);

/* August 2026 — the real month the CEO was looking at. 21 weekdays, two
   public holidays on weekdays (Maulidur Rasul 25-08, Merdeka 31-08), so 19
   working days and 10 rest days. */
const AUG = (() => {
  const HOL = new Set(["2026-08-25", "2026-08-31"]);
  const working = [], rest = [];
  for (let n = 1; n <= 31; n++) {
    const d = new Date(Date.UTC(2026, 7, n));
    const iso = d.toISOString().slice(0, 10);
    if (HOL.has(iso)) continue;
    const w = d.getUTCDay();
    if (w >= 1 && w <= 5) working.push(iso); else rest.push(iso);
  }
  return { working, rest };
})();

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

/* ---- 4A. THE SECOND REGRESSION: Zul Hisyam, August 2026 ----

   CEO, 31-08-2026: *"Zul Hisyam should entitle 2 PH but seem like the payroll
   make it around 5++ which is not correct!"*

   He was absent every one of August's 19 working days. Deducting them at the
   Employment Act's 1/26 rate takes 19/26 and leaves 7/26 — RM 538.46 for a
   month in which he did nothing. Those seven days are the five Saturdays plus
   the two public holidays: his "2 PH" was exact and his "5++" was exact.

   The cause is a divisor mismatch, not a rounding error. 26 assumes a six-day
   week; this company works five, so no number of unpaid working days can ever
   reach the whole salary.

   These run the arithmetic rather than reading the source, because this is a
   figure that goes in somebody's bank account. */
{
  const B = 200000; // RM 2,000
  const orp = B / 26;
  const call = (fullyUnpaid, extra = {}) => unpaidDeduction({
    basicCents: B, workingDays: AUG.working, restDays: AUG.rest,
    publicHolidays: 2, fullyUnpaid, unpaidDays: fullyUnpaid.length,
    incompleteCents: 0, ...extra,
  });

  ok("August 2026 is 19 working days and 10 rest days",
     AUG.working.length === 19 && AUG.rest.length === 10,
     `got ${AUG.working.length} / ${AUG.rest.length} — if this is wrong every figure below is meaningless`);

  /* What the OLD rule paid, reconstructed so the change is stated in ringgit
     rather than described. */
  const oldNet = B - Math.round(orp * 19);
  ok("the old rule paid him RM 538.46 for a month he did not work", oldNet === 53846,
     `got ${oldNet}`);
  ok("that was exactly seven days of pay", Math.round(oldNet / orp) === 7,
     "five Saturdays and two public holidays — the CEO's 5++ and his 2 PH");

  const zul = call(AUG.working);
  ok("every week being unpaid costs its rest days too", zul.restDays === 8,
     `got ${zul.restDays} — the four whole weeks inside the month, not the stub weeks at either end`);
  ok("the cap bites, because the raw figure exceeds the salary", zul.capped === true);
  ok("he is now paid his two public holidays and nothing else",
     B - zul.cents === Math.round(orp * 2),
     `got ${B - zul.cents}, expected ${Math.round(orp * 2)} — this is the number the CEO asked for`);
  ok("that is RM 153.85", B - zul.cents === 15385, `got ${B - zul.cents}`);
  ok("the change is worth RM 384.61 to the company this month", oldNet - (B - zul.cents) === 38461);

  /* THE THING THAT MUST NOT MOVE. A scattered absence is still deducted at
     the statutory rate and nothing else — the Act is deliberately generous
     about a day or two off, and this change must not quietly end that. */
  const scattered = call(["2026-08-06"]);
  ok("one day off in a week otherwise worked costs no rest days", scattered.restDays === 0);
  ok("and is deducted at exactly 1/26", scattered.cents === Math.round(orp),
     `got ${scattered.cents}`);
  ok("Nur Nasuha's 2.75 days are untouched by this change",
     unpaidDeduction({
       basicCents: B, workingDays: AUG.working, restDays: AUG.rest, publicHolidays: 2,
       fullyUnpaid: ["2026-08-06", "2026-08-13"], unpaidDays: 2.75, incompleteCents: 0,
     }).cents === 21154,
     "her August deduction was RM 211.54 and the rule change must not move it");

  /* No cliff — the reason this rule was chosen over "absent all month = zero". */
  const threeWeeks = AUG.working.filter((d) => d <= "2026-08-21");
  const partial = call(threeWeeks);
  ok("three whole weeks unpaid loses three weeks of rest days", partial.restDays === 6);
  ok("a heavy but partial month tapers instead of jumping",
     B - partial.cents === 38462,
     `got ${B - partial.cents} — RM 384.62 for four days worked, between the full month and a normal one`);
  ok("the taper is monotonic: more unpaid never pays more",
     (B - partial.cents) > (B - zul.cents));

  /* Public holidays are the floor, whatever else is happening. */
  const joiner = unpaidDeduction({
    basicCents: B, workingDays: AUG.working.filter((d) => d >= "2026-08-17"),
    restDays: AUG.rest.filter((d) => d >= "2026-08-17"), publicHolidays: 1,
    fullyUnpaid: AUG.working.filter((d) => d >= "2026-08-17"),
    unpaidDays: AUG.working.filter((d) => d >= "2026-08-17").length,
    incompleteCents: Math.round((B * 10) / 19),
  });
  const joinerNet = B - Math.round((B * 10) / 19) - joiner.cents;
  ok("a joiner absent for all of their employment still keeps their holiday",
     joinerNet === Math.round(orp * 1), `got ${joinerNet}`);
  ok("incomplete month and unpaid leave together never exceed the basic",
     joinerNet >= 0,
     "before the cap these were two independent deductions and could print a negative payslip");
  ok("nobody with no unpaid leave is affected at all",
     unpaidDeduction({
       basicCents: B, workingDays: AUG.working, restDays: AUG.rest, publicHolidays: 2,
       fullyUnpaid: [], unpaidDays: 0, incompleteCents: 0,
     }).cents === 0);
}

/* ---- 4B. WORKING ON A PUBLIC HOLIDAY ----

   CEO, 31-08-2026: *"if they are working on Public Holiday, then only will be
   paid as double. if they are not working on public holiday consider that
   they will receive 1 day of paid instead of double paid of working day which
   is we need to follow on the regulation"*.

   Until this the payroll paid NOTHING extra for a holiday worked. The rate is
   the Act's, confirmed with the CEO against the word "double": s.60D(3)(a)(i),
   two days' wages at ORP in addition to the holiday pay already in the month.
   For a part-timer: twice the hourly rate (Part-Time Employees Regs 2010). */
{
  const B = 200000;
  const orp = B / 26;
  ok("one public holiday worked earns two days' ORP on top of the salary",
     publicHolidayWorkedCents(B, 1) === Math.round(orp * 2),
     `got ${publicHolidayWorkedCents(B, 1)} — s.60D(3)(a)(i): TWO days' wages, in addition to the holiday pay`);
  ok("that is RM 153.85 on RM 2,000", publicHolidayWorkedCents(B, 1) === 15385);
  ok("two holidays worked is twice that", publicHolidayWorkedCents(B, 2) === 30769);
  ok("not working the holiday earns nothing extra — the day is already in the salary",
     publicHolidayWorkedCents(B, 0) === 0,
     "this is the CEO's '1 day of paid instead of double'");
  ok("a part-timer's holiday hours earn a second RM15/h",
     partTimeHolidayPremiumCents(8 * 60, 1500) === 12000,
     `got ${partTimeHolidayPremiumCents(480, 1500)} — eight hours on Merdeka Day is RM 120 on top of the RM 120 already paid`);
  ok("no hours on a holiday, no premium", partTimeHolidayPremiumCents(0, 1500) === 0);

  const staff = read("worker/src/staff.ts");
  const panel = read("components/portal/payroll-panel.tsx");
  ok("the worker has one public-holiday-work resolver", /const phWorkResolver = async \(month: string\)/.test(staff));
  ok("it uses the Act's rate for monthly staff",
     /: Math\.round\(\(opts\.orpBase \/ 26\) \* 2 \* mine\.length\);/.test(staff),
     "two days' ORP per holiday worked");
  ok("and the second hourly rate for part-timers",
     /\? Math\.round\(\(minutes \* PART_TIME_LH_RATE_CENTS\) \/ 60\)/.test(staff));
  ok("only gazetted holidays and their replacements carry the premium",
     /AND kind IN \('public', 'replacement'\)/.test(staff),
     "a company day off is the company's gift, not a statutory holiday");
  ok("a pending punch does not earn a holiday premium",
     /WHERE strftime\('%Y-%m', created_at, '\+8 hours'\) = \?1\$\{notPendingP\}/.test(staff),
     "an unapproved claim of having worked Merdeka Day would otherwise pay three days");
  ok("every writer of net_cents adds it",
     (staff.match(/await phWorkResolver\(/g) ?? []).length === 4,
     "the payslip, /payroll/attendance-days, /payroll/recompute and the hourly save — four surfaces, one resolver");
  ok("recompute adds it to a monthly net", /e\.basic_cents \+ phW \+ e\.commission_cents/.test(staff));
  ok("recompute adds it to an hourly net", /basicR \+ phH \+ e\.commission_cents/.test(staff));
  ok("the hourly save adds it", /basicH \+ phH \+ cents\(body\.commission_cents\)/.test(staff));
  ok("the payslip prints it as its own earnings line, naming the days",
     /PUBLIC HOLIDAY WORKED \(\$\{when\} — \$\{n\} × 2 DAYS ORP, EA s\.60D\(3\)\)/.test(panel),
     "a premium nobody can see is a premium nobody can check");
  ok("the browser adds the server's figure to every net it shows",
     /const phW = unpaidInfo\[id\]\?\.ph_worked_cents \?\? 0;/.test(panel) &&
     /const phH = unpaidInfo\[id\]\?\.ph_worked_cents \?\? 0;/.test(panel) &&
     /a\.ph \+= phW;/.test(panel) && /a\.ph \+= phH;/.test(panel) &&
     /\(extras\?\.ph_worked_cents \?\? 0\)/.test(panel),
     "netFor, the totals row and the staff self-view");
  ok("the hourly rate constant is at module scope",
     /^export const PART_TIME_LH_RATE_CENTS = 1500;/m.test(staff),
     "phWorkResolver runs from payslipExtras, above where the constant used to be declared — a TDZ waiting to happen");
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
  /* v1.77.0 — this used to assert the exact text of employedDays, and broke
     the moment the function grew a re-join clause it should have had all
     along. What matters is the BEHAVIOUR: payable days come from employment
     dates, and a re-join ends the gap. */
  ok("the worker's payable days come from employment dates",
     /if \(joined && d < joined\.slice\(0, 10\)\) return false;/.test(staff) &&
     /if \(left && d > left\.slice\(0, 10\)\)/.test(staff));
  ok("somebody who left and came back is employed again from the re-join date",
     /return Boolean\(rejoined && d >= rejoined\.slice\(0, 10\)\);/.test(staff),
     "reading only left_on charged a returning employee an incomplete month for every day since they first resigned");
  ok("EVERY payable-days site passes the re-join date",
     (staff.match(/employedDays\([^)]*rejoined[^)]*\)/g) ?? []).length === 6 &&
     !/employedDays\((?:(?!rejoined)[^)])*\)/.test(staff),
     "six call sites — the payslip, the panel's two, the absence scan and recompute; one left behind is one surface disagreeing about who was employed");
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

  /* ---- v1.77.0: ONE unpaid-leave rule, reached from every surface ---- */
  const panel = read("components/portal/payroll-panel.tsx");
  ok("the worker has one unpaid-leave resolver", /const unpaidResolver = async \(month: string\)/.test(staff));
  ok("the week clause is in it",
     /if \(work\.every\(\(d\) => fully\.has\(d\)\)\) restDays \+= restByWeek\.get\(k\) \?\? 0;/.test(staff),
     "a week in which every working day was unpaid loses that week's rest days");
  ok("a part day never makes a week 'unworked'",
     /if \(span\.length > 0 && r\.days >= span\.length\)/.test(staff),
     "somebody who worked half of Tuesday did work that week");
  ok("public holidays are the floor under every deduction",
     /const room = Math\.max\(0, opts\.orpBase - opts\.incompleteCents - Math\.round\(orp \* opts\.phCount\)\);/.test(staff),
     "s.60D(2) removes holiday pay only for absence WITHOUT consent — recorded unpaid leave has consent");
  ok("the worker's cap matches the library's exactly",
     /const room = Math\.max\(0, inp\.basicCents - inp\.incompleteCents - Math\.round\(orp \* inp\.publicHolidays\)\);/
       .test(read("lib/payroll-days.ts")),
     "the library is the one this guard RUNS; the worker is the one that pays people");
  ok("both writers of net_cents call the same resolver",
     (staff.match(/await unpaidResolver\(/g) ?? []).length === 3,
     "the payslip, /payroll/attendance-days and /payroll/recompute — recompute is the one that WRITES net_cents, " +
     "so a formula there that disagreed with the payslip is a figure in the bank no slip can explain");
  /* Not "the old expression is gone" — ANY per-day arithmetic on the client.
     The first draft of this check named the exact old line and passed when
     the same formula came back with a different variable in it. Overtime's
     ÷26÷8 hourly rate is the one legitimate divisor here. */
  {
    const code = (l) => l
      .replace(/\/\/.*$/, "")                    // line comment
      .replace(/`(?:[^`\\]|\\.)*`/g, '""')       // template literal
      .replace(/"(?:[^"\\]|\\.)*"/g, '""')       // string
      .replace(/'(?:[^'\\]|\\.)*'/g, '""');      // string
    /* Block comments are tracked across lines — a JSX {/* … *​/} comment does
       not start each of its lines with a star, and one of them talks about
       "1/26" in prose. A guard that reads prose as arithmetic gets muted. */
    let inBlock = false;
    const offenders = [];
    panel.split(/\r?\n/).forEach((raw, i) => {
      let l = raw;
      if (inBlock) {
        const end = l.indexOf("*/");
        if (end < 0) return;
        l = l.slice(end + 2);
        inBlock = false;
      }
      const open = l.lastIndexOf("/*");
      if (open >= 0 && l.indexOf("*/", open) < 0) { inBlock = true; l = l.slice(0, open); }
      l = code(l);
      if (/\/\s*26\b/.test(l) && !/\/ 26 \/ 8/.test(l)) offenders.push(i + 1);
    });
    ok("the browser derives no per-day pay of its own", offenders.length === 0,
       `payroll-panel.tsx line(s) ${offenders.join(", ")} — three copies of the formula became three answers ` +
       "the moment the rule grew a week clause; the client's job is to print the server's number");
  }
  ok("the browser prints the server's figure",
     /const ulDed = unpaidInfo\[id\]\?\.cents \?\? 0;/.test(panel) &&
     /const ulDed = unpaidInfo\[u\.id\]\?\.cents \?\? 0;/.test(panel));
  ok("the payslip states what the deduction is made of",
     /REST DAY\$\{rest === 1 \? "" : "S"\} IN FULLY UNPAID WEEKS/.test(panel) &&
     /CAPPED — \$\{x\.public_holiday\} PUBLIC HOLIDAY/.test(panel),
     "a payslip showing only a total leaves the person holding it unable to check the number that changed their pay");
  ok("the reason is on the screen, not in a hover",
     /incomplete month — employed \$\{payableDays\[u\.id\] \?\? monthDays\} of \$\{monthDays\} working days/.test(panel) &&
     /unpaid leave — \$\{ud\?\.days \?\? ul\} day/.test(panel),
     "two different deductions both rendered as '− RM X auto', which is how RM 1,052.63 sat on a row unexplained");
  ok("a row whose clock and employment dates contradict each other is flagged",
     /clocked_beyond_employment: \(wd\?\.n \?\? 0\) > mine\.length/.test(staff) &&
     /ud\?\.clocked_beyond_employment && \(/.test(panel),
     "Nurfarah: employed for 9 working days, clocked in on 12 — both cannot be true, and it is money either way");
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
