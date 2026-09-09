/**
 * THE 09-09 AUDIT, KEPT FIXED — guard #68, v1.148.0.
 *
 * The CEO asked for an audit of every file and got a ranked list. This guard
 * is the half that stops the list coming back. Each block below is one
 * finding, stated as the property that has to hold - not as the shape of the
 * fix, so a later rewrite that keeps the property passes.
 *
 * 1. A PAYSLIP CANNOT CALL THE SAME DAY PAID AND DEDUCT IT.
 *    v1.146.0 made emergency leave unpaid from 01-09-2026 and changed only
 *    the arithmetic. The slip went on printing "EMERGENCY LEAVE (PAID)" and
 *    counted its UNPAID LEAVE line from type = 'unpaid' alone, so two
 *    emergency days in September printed "UNPAID LEAVE (0 DAYS)" against a
 *    real ringgit figure. Worse, the payroll screen still told the person
 *    running it that emergency leave is "never deducted" - an instruction to
 *    key the deduction in a second time and charge somebody twice.
 *
 * 2. A RELEASED MONTH IS PROTECTED ON EVERY ROUTE THAT SETS PAY.
 *    releasedMonthBlock existed for overtime only, because its message named
 *    overtime. Recording an unpaid day, undoing one, saving a payroll row
 *    and recomputing a whole month could all rewrite a month whose payslips
 *    were in people's hands, silently. The refusal must also be answerable:
 *    a correction to a released month has to stay possible, deliberately and
 *    under audit, or the guard is worse than the bug.
 *
 * 3. A HEALTH PROBE MUST BE ABLE TO FAIL.
 *    The 0121 probe read `SELECT 1 FROM postage_records WHERE order_ref='x'`.
 *    order_ref has been a column since 0007, so it passed whether or not
 *    0121 had ever run - a green banner over a database in which the TikTok
 *    double-count race was wide open.
 *
 * 4. ONE COMPANY ORDER FOR PEOPLE, EVERYWHERE.
 *    payroll-panel.tsx carried a second, hand-written role order that put
 *    admin after hr_admin - the opposite of the order the CEO gave on
 *    04-09-2026 - and /commission/rates ordered alphabetically while the
 *    host picker above it used the company order.
 *
 * 5. NOTHING SHIPS THAT NOTHING RENDERS.
 *    BirthdaysPanel: ~90 lines, exported, rendered by no tab since v1.93.0,
 *    and still compiled into the chunk every other panel in that file pulls
 *    down. Its nav icon outlived it too.
 *
 * 6. THE COMMIT GATE IS REAL, NOT A COMMENT.
 *    .gitignore claimed a real signature scan "must not reach GitHub even
 *    for the minutes before that guard runs". Git ignores by NAME; the five
 *    placeholders are tracked under exactly the names a real scan would be
 *    saved as. The size check has to live somewhere that can actually check
 *    a size before a commit exists.
 *
 * Negative-tested by: restoring the old emergency display; removing each
 * release check; putting the no-op probe back; reinstating the local RANK
 * and the alphabetical commission order; re-adding the dead panel; and
 * deleting the pre-commit hook.
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/* v1.139.1 - fileURLToPath, NOT .pathname (Windows: "C:\\C:\\Users\\..."). */
const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(root, p), "utf8");

let passed = 0, failed = 0;
const ok = (label, cond, why = "") => {
  if (cond) passed += 1;
  else { failed += 1; console.log(`  ✗ ${label}${why ? ` — ${why}` : ""}`); }
};

const staff = read("worker/src/staff.ts");
const index = read("worker/src/index.ts");
const erp = read("worker/src/erp.ts");
const pay = read("components/portal/payroll-panel.tsx");
const rolePanels = read("components/portal/role-panels.tsx");
const navIcons = read("components/layout/nav-icons.tsx");
const gitignore = read(".gitignore");

/* ---- 1. the payslip cannot contradict itself ---- */
{
  ok("the days printed as unpaid are the days the deduction was computed from",
     /unpaid_leave: ub\.days/.test(staff),
     "printing type='unpaid' alone gave 0 DAYS beside a real ringgit deduction");
  ok("emergency days are split at the same cutoff the money uses",
     /start_date < '\$\{UNPAID_FROM\}'/.test(staff) && /start_date >= '\$\{UNPAID_FROM\}'/.test(staff));
  ok("only genuinely paid days are labelled paid",
     /emergency_leave: emergencyPaidDays/.test(staff));
  ok("the charged-for days are named rather than hidden",
     /emergency_unpaid: emergencyUnpaidDays/.test(staff) &&
     /EMERGENCY LEAVE \(UNPAID — IN THE DEDUCTION ABOVE\)/.test(pay));
  ok("the deduction line says when emergency days are inside it",
     /EMERGENCY LEAVE — UNPAID FROM 01-09-2026/.test(pay));
  ok("the screen no longer tells the processor emergency leave is never deducted",
     !/Emergency leave is paid, never deducted/.test(pay) &&
     !/Cuti kecemasan dibayar, tidak sekali-kali dipotong/.test(pay),
     "that sentence is an instruction to deduct the same day a second time");
  ok("and warns against keying it in twice, in both languages",
     /never key it in again as a manual deduction/.test(pay) &&
     /jangan sekali-kali memasukkannya semula/.test(pay));
}

/* ---- 2. a released month is protected wherever pay is set ---- */
{
  const calls = (staff.match(/releasedMonthBlock\(env,/g) ?? []).length;
  ok("every route that sets pay checks the release, not just overtime",
     calls >= 8, `only ${calls} call sites`);
  ok("recording an unpaid day checks it", /releasedMonthBlock\(env, dateU,[\s\S]{0,80}?Recording an unpaid day/.test(staff));
  ok("undoing one checks it too", /releasedMonthBlock\(env, rowD2\.start_date,[\s\S]{0,80}?Undoing an unpaid day/.test(staff),
     "giving pay back after a release changes the payslip just as much as taking it");
  ok("saving a payroll row checks it", /releasedMonthBlock\(env, `\$\{month\}-01`,[\s\S]{0,80}?Saving a payroll row/.test(staff));
  ok("recomputing a whole month checks it", /releasedMonthBlock\(env, `\$\{monthR\}-01`,[\s\S]{0,80}?Recomputing this month/.test(staff),
     "the most powerful button on the screen had no check at all");
  ok("the refusal names what is being changed rather than always saying overtime",
     /what = "Changing overtime"/.test(staff) && /\$\{what\} now will not change a payslip/.test(staff));
  ok("the refusal is answerable, so a real correction stays possible",
     /releaseOverride/.test(pay) && /force_released: true/.test(pay),
     "a guard with no way through would be worse than the bug it fixes");
  ok("a batch asks once, not once per person",
     /forceAsked\.current/.test(pay) && /forceAsked\.current = false; \/\/ v1\.148\.0/.test(pay));
  ok("the override is still a deliberate act, not a silent retry",
     /confirmLabel: L\("Change it anyway"/.test(pay) && /logged under your name/.test(pay));
}

/* ---- 3. a health probe must be able to fail ---- */
{
  ok("the 0121 probe names the INDEX, which is what 0121 creates",
     /INDEXED BY idx_postage_order_ref/.test(index),
     "order_ref is a column from 0007, so the old probe passed on a database missing 0121");
}

/* ---- 4. one company order for people ---- */
{
  ok("payroll sorts staff with the shared comparator",
     /list\.sort\(bySeniority\)/.test(pay),
     "the Base salaries grid rendered the un-re-sorted array, so the drift was visible exactly where pay is set");
  ok("and carries no second role table of its own",
     !/ceo: 1, coo: 2, cco: 3, hr_admin: 4/.test(pay));
  ok("commission rates use the company order like the host picker above them",
     /ORDER BY \$\{STAFF_ORDER_SQL\}, r\.effective_from DESC/.test(erp) &&
     !/ORDER BY u\.name, r\.effective_from/.test(erp),
     "one screen showed the same people twice in two different orders");
}

/* ---- 5. nothing ships that nothing renders ---- */
{
  ok("the dead birthday panel is gone", !/export function BirthdaysPanel/.test(rolePanels));
  ok("and its orphaned nav icon with it", !/^\s*Birthdays: /m.test(navIcons));
  ok("the removal says why, so it is not re-added by someone reading a gap",
     /RETIRED v1\.148\.0/.test(rolePanels));
}

/* ---- 6. the commit gate is real ---- */
{
  ok("a pre-commit hook exists", existsSync(join(root, ".githooks/pre-commit")));
  const hook = existsSync(join(root, ".githooks/pre-commit")) ? read(".githooks/pre-commit") : "";
  ok("it checks the SIZE of anything under public/signatures",
     /public\/signatures/.test(hook) && /\-gt 1024/.test(hook),
     "the 1KB line is the same one tests/no-public-signatures.mjs uses");
  ok("it reads the size of the STAGED blob, not the working copy",
     /git cat-file -s/.test(hook),
     "checking the file on disk would miss a real image staged and then swapped back");
  ok("it also refuses credential files", /id_rsa|\.dev\.vars/.test(hook));
  ok("the ignore file no longer claims a protection it cannot give",
     /WHAT THIS RULE CANNOT DO/.test(gitignore) && /never by size/.test(gitignore),
     "a comment that overstates the guard is how the next person stops checking");
  ok("the hook itself is not ignored", /!\.githooks\/pre-commit/.test(gitignore),
     "a gate that does not survive a fresh clone is not a gate");
}

console.log(failed === 0
  ? `audit-0909: ${passed} checks passed.`
  : `\n${failed} audit-0909 check(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
