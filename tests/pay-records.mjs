/* tests/pay-records.mjs - v1.181.4: THREE RECORDS THAT MOVE MONEY, HELD TO THEIR RULES.
 *
 * The CEO, 24-09-2026, three requests in one afternoon, each touching pay:
 *
 *   A. "advance salary need to link with the deduction of the payroll in the
 *      month or the date of the request and the payslip to be appear the
 *      request" - the payslip said only "SALARY ADVANCE (2026-09)".
 *   B. "I should be able to edit the unpaid leave" - a day recorded by the
 *      company could only be undone elsewhere and recorded again.
 *   C. "attendance today cant see the data ... view the data by clickable" -
 *      the donut's numbers had no names behind them.
 *
 * Each is read from source here, because each has a rule whose breaking
 * would not show on screen until a payslip was wrong:
 *
 *   A1 the itemised advance lines use EXACTLY the predicate the deduction
 *      uses, so they always add up to it;
 *   A2 the claim number the payslip prints is built the way the Claims tab
 *      prints it (CLM-AZOO{DDMMYY}-{running no. that day});
 *   A3 the slip only itemises when the items sum to the total, else the old
 *      single line - the net can never move because of this;
 *   A4 creating AND editing an advance refuse a past or released month;
 *   A5 the form sends the derived recovery month, never an earlier one;
 *   B1 the edit route is CEO-only (unpaid_leave), touches only rows the
 *      company recorded (recorded_direct = 1), checks the released month at
 *      BOTH ends of a move, and refuses a day already unpaid;
 *   B2 the table only offers Edit/Undo on those rows, for that role;
 *   C1 the drill-down is gated like the donut and uses the donut's rules
 *      (10:00 cutoff, same staff filter), so names and numbers agree.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");

let failed = 0, passed = 0;
const ok = (label, cond, why = "") => { if (cond) passed++; else { failed++; console.log(`  ✗ ${label}${why ? ` - ${why}` : ""}`); } };

const staff = read("worker/src/staff.ts");
const panels = read("components/portal/role-panels.tsx");
const payroll = read("components/portal/payroll-panel.tsx");
const cards = read("components/portal/dashboard-cards.tsx");

const fnBody = (src, name) => {
  const i = src.indexOf(`async function ${name}(`);
  if (i < 0) return "";
  const j = src.indexOf("\n}\n", i);
  return src.slice(i, j);
};
const route = (src, sig) => {
  const i = src.indexOf(sig);
  if (i < 0) return "";
  const j = src.indexOf("\n  if (path ===", i + sig.length);
  return src.slice(i, j < 0 ? undefined : j);
};
const norm = (s) => s.replace(/\s+/g, " ").trim();

/* ---- A. salary advance ---- */
{
  const cents = fnBody(staff, "salaryAdvanceCents");
  const items = fnBody(staff, "salaryAdvanceItems");
  ok("A. salaryAdvanceItems exists", items.length > 0);
  const where = (b) => norm((/FROM claims(?: c)?\s+WHERE([\s\S]*?)(?:`|ORDER BY)/.exec(b)?.[1] ?? "").replace(/\bc\./g, ""));
  ok("A1. the items use the deduction's own predicate", where(cents) !== "" && where(cents) === where(items),
    `\n      deduction: ${where(cents)}\n      items:     ${where(items)}`);
  ok("A2. the claim number is CLM-AZOO{DDMMYY}-{day seq}",
    /'CLM-AZOO' \|\| strftime\('%d%m', c\.created_at\) \|\| substr\(strftime\('%Y', c\.created_at\), 3, 2\) \|\| '-' \|\|/.test(items)
    && /date\(c2\.created_at\) = date\(c\.created_at\) AND c2\.id <= c\.id/.test(items));
  ok("A2. ...the same scheme the Claims tab prints",
    /return `CLM-AZOO\$\{ddmmyy\}-\$\{c\.day_seq \?\? c\.id\}`;/.test(panels)
    && /\(SELECT COUNT\(\*\) FROM claims c2 WHERE date\(c2\.created_at\) = date\(c\.created_at\) AND c2\.id <= c\.id\) AS day_seq/.test(staff));
  ok("A2. the payslip extras carry the items", /salary_advance_items: salaryAdvanceList,/.test(staff));
  ok("A3. the slip itemises only when the items add up to the total",
    /advItems\.reduce\(\(a, i\) => a \+ i\.amount_cents, 0\) === salaryAdvance/.test(payroll)
    && /deductions\.push\(\[`SALARY ADVANCE \$\{it\.claim_no\}`, it\.amount_cents\]\)/.test(payroll)
    && /else if \(salaryAdvance > 0\) deductions\.push\(\[`SALARY ADVANCE \(\$\{month\}\)`, salaryAdvance\]\)/.test(payroll));
  const monthFn = fnBody(staff, "advanceMonthProblem");
  ok("A4. a past month is refused", /if \(month < nowMonth\)/.test(monthFn));
  ok("A4. a released month is refused", /payslip_releases WHERE month = \?1/.test(monthFn));
  ok("A4. creating an advance checks the month", /const monthBad = await advanceMonthProblem\(env, payrollMonth\);/.test(staff));
  ok("A4. editing an advance checks the month", /const monthBadE = await advanceMonthProblem\(env, payrollMonthE\);/.test(staff));
  ok("A5. the form sends the derived recovery month",
    /payroll_month: recoverMonth/.test(panels) && !/payroll_month: payrollMonth \}/.test(panels));
  ok("A5. the recovery month is never before the request's month",
    /const recoverMonth = payrollMonth < advanceMinMonth \? advanceMinMonth : payrollMonth;/.test(panels));
}

/* ---- B. unpaid leave edit ---- */
{
  const patch = route(staff, 'if (path === "/attendance/unpaid" && method === "PATCH") {');
  ok("B1. the edit route exists", patch.length > 0);
  ok("B1. CEO only (unpaid_leave)", /if \(!can\(user\.role, "unpaid_leave"\)\)/.test(patch));
  ok("B1. only a day the company recorded is read", /l\.type = 'unpaid' AND l\.recorded_direct = 1 AND l\.status = 'approved'/.test(patch));
  ok("B1. ...and only such a row is written", /WHERE id = \?1 AND type = 'unpaid' AND recorded_direct = 1/.test(patch));
  ok("B1. the released month is checked at both ends of a move",
    /for \(const d of new Set\(\[rowP\.start_date, newDate\]\)\)[\s\S]{0,120}releasedMonthBlock\(env, d,/.test(patch));
  ok("B1. a day already unpaid is refused", /That day is already unpaid leave/.test(patch));
  ok("B1. the person is told and it is audited", /await notify\(env, rowP\.user_id, "leave"/.test(patch) && /"leave\.unpaid_edit"/.test(patch));
  ok("B2. the table offers Edit only on company-recorded unpaid days, for the CEO",
    /canUnpaid && l\.leave_type === "unpaid" && l\.recorded_direct === 1 \?/.test(panels));
  ok("B2. the report tells the table which rows those are", /recorded_direct: l\.recorded_direct \? 1 : 0,/.test(staff));
}

/* ---- C. attendance drill-down ---- */
{
  const drill = route(staff, 'if (path === "/dashboard/attendance-today" && method === "GET") {');
  ok("C1. the drill-down route exists", drill.length > 0);
  ok("C1. gated like the donut (hr_manage or exec_view)",
    /if \(!can\(user\.role, "hr_manage"\) && !can\(user\.role, "exec_view"\)\)/.test(drill));
  ok("C1. on time is in by 10:00, like the donut", /r\.first_in <= "10:00"/.test(drill) && /r\.first_in > "10:00"/.test(drill)
    && /WHERE t <= '10:00'`\)/.test(staff) && /WHERE t > '10:00'`\)/.test(staff));
  ok("C1. the same staff filter as the donut's counts",
    /JOIN users u ON u\.id = a\.user_id AND u\.is_active = 1 AND u\.role NOT IN \('customer', 'super_admin', 'admin'\)/.test(drill));
  ok("C1. the card asks for the names", /api<AttWho>\("\/dashboard\/attendance-today"\)/.test(cards));
  ok("C1. the old do-nothing card button is gone", !/export function AttendanceDonutCard/.test(cards));
}

if (failed) {
  console.log(`\npay-records: ${failed} failed, ${passed} passed.`);
  process.exit(1);
}
console.log(`pay-records: ${passed} checks passed - advances name their request, unpaid days edit safely, the donut has names.`);
