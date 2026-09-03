/**
 * Company order & replacement leave — guard #29 (v1.78.0).
 *
 * CEO, 31-08-2026, two asks that both come down to "one rule, everywhere":
 *
 *   *"payroll should ascending with position which is CEO, COO, CCO,
 *    HR_admin, Sales Executive, Sales Marketing, Marketing Designer and
 *    lastly Live host and Part time last host."*
 *
 *   *"in Staff table should appear a list of replacement leave for the staff
 *    that working on weekend which is for me to credit the replacement leave
 *    either half day or full day depend on their in and out time."*
 *
 * WHY THE ORDER NEEDS A GUARD. It is written twice on purpose — once in
 * TypeScript for the browser (lib/staff-order.ts), once in SQL for the
 * worker (STAFF_ORDER_SQL in staff.ts), because the worker cannot import
 * from lib/. The M2E salary file pays people in the order its rows come out,
 * so the day those two disagree is the day the payment file stops matching
 * the screen it was checked against. This guard COMPILES the module, RUNS
 * it on a made-up company, and reads the same ranks back out of the SQL.
 *
 * WHY THE CREDIT NEEDS ONE. Crediting replacement leave grants somebody a
 * paid day off. Three things make that safe and each is one line somebody
 * could delete: it must be a rest day on that person's own schedule, it must
 * have an approved clock-in behind it, and it must be impossible to credit
 * the same day twice.
 *
 *   node tests/staff-order.mjs
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

const out = path.join(mkdtempSync(path.join(tmpdir(), "order-guard-")), "so.mjs");
try {
  execFileSync(
    process.platform === "win32" ? "npx.cmd" : "npx",
    ["esbuild", path.join(root, "lib/staff-order.ts"), "--format=esm", `--outfile=${out}`],
    { stdio: "pipe" },
  );
} catch (e) {
  console.log(`FAIL — lib/staff-order.ts does not compile: ${e.message}`);
  process.exit(1);
}
const { ROLE_RANK, bySeniority, staffRank, positionRank } = await import(`file://${out}`);

const staff = read("worker/src/staff.ts");
const payroll = read("components/portal/payroll-panel.tsx");
const dir = read("components/staff/staff-directory.tsx");
/* v1.86.0 - the card moved to components/portal/ and lost its unpaid
   half: an unpaid day is a leave record, and leave records live in the
   register on the Leave tab. */
const card = read("components/portal/rest-day-credits.tsx");
const page = read("app/portal/page.tsx");

/* ---- 1. the order the CEO named, RUN rather than read ---- */
{
  /* His eight, deliberately fed in backwards so a comparator that does
     nothing cannot pass by accident. */
  const company = [
    { name: "Dini", role: "live_host", employment_status: "part_time", position: "Live Host" },
    { name: "Farah", role: "marketing", position: "Designer" },
    { name: "Zul", role: "sales_marketing", position: "Marketing Executive" },
    { name: "Nasuha", role: "sales_marketing", position: "Sales Executive" },
    { name: "Wani", role: "hr_admin", position: "Administrative Executive" },
    { name: "Izzudin", role: "cco", position: "Chief Commercial Officer" },
    { name: "Zolkefli", role: "coo", position: "Chief Operational Officer" },
    { name: "Alif", role: "ceo", position: "Chief Executive Officer" },
  ];
  const order = [...company].sort(bySeniority).map((u) => u.name);
  ok("the payroll run comes out in the order the CEO named",
     order.join(" ") === "Alif Zolkefli Izzudin Wani Nasuha Zul Farah Dini",
     `got ${order.join(" ")} — expected CEO, COO, CCO, HR, Sales Exec, Sales Marketing, Designer, part-time host`);

  ok("a full-time host still sorts above a part-time one",
     staffRank({ role: "live_host", employment_status: "full_time" })
       < staffRank({ role: "live_host", employment_status: "part_time" }),
     "the CEO's 'and lastly Live host and Part time last host'");
  ok("an unknown role lands last, not first",
     staffRank({ role: "typo_role" }) > staffRank({ role: "live_host", employment_status: "part_time" }),
     "a missing key read as 0 would put a typo'd role above the CEO");
  ok("job title only ever breaks a tie inside one role",
     staffRank({ role: "ceo", position: "Designer" }) < staffRank({ role: "coo", position: "Sales Executive" }),
     "position is free text somebody types; role is structured, so role wins");
  ok("sales, then marketing, then design",
     positionRank("Sales Executive") < positionRank("Marketing Executive")
       && positionRank("Marketing Executive") < positionRank("Senior Designer"));
  ok("an unrecognised job title sits in the middle", positionRank("Storekeeper") === 2,
     "being wrong about an unknown title must not move somebody to either end of a salary run");
}

/* ---- 2. the SQL says the same thing as the module ---- */
{
  const m = staff.match(/export const STAFF_ORDER_SQL = `([\s\S]*?)`;/);
  ok("the worker has the order in SQL", Boolean(m));
  const sql = m?.[1] ?? "";
  const sqlRanks = Object.fromEntries(
    [...sql.matchAll(/WHEN '(\w+)' THEN (\d+)/g)].map(([, r, n]) => [r, Number(n)]),
  );
  const mismatched = Object.entries(ROLE_RANK).filter(([r, n]) => sqlRanks[r] !== n);
  ok("every role ranks the same in SQL as in the module", mismatched.length === 0,
     `${mismatched.map(([r, n]) => `${r}: module ${n}, SQL ${sqlRanks[r] ?? "missing"}`).join("; ")} — ` +
     "the M2E file pays people in the order its rows come out, so this disagreeing with the screen is a file nobody can check");
  ok("SQL ranks nothing the module does not",
     Object.keys(sqlRanks).every((r) => r in ROLE_RANK),
     `${Object.keys(sqlRanks).filter((r) => !(r in ROLE_RANK)).join(", ")} is ranked in SQL only`);
  ok("the part-time offset matches", /part_time' THEN 5/.test(sql.replace(/\s+/g, " ")));
  ok("SQL breaks ties the same way — sales 1, design 3, everything else 2",
     /LIKE '%sales%'\s*THEN 1/.test(sql) && /LIKE '%design%' THEN 3/.test(sql) && /ELSE 2 END/.test(sql));

  /* Every payroll query that feeds a screen or a payment file. */
  const uses = (staff.match(/ORDER BY \$\{STAFF_ORDER_SQL\}/g) ?? []).length;
  /* v1.84.0 — `=== 3` failed when a FOURTH listing correctly adopted the
     order (the verification report). More surfaces sharing one order is the
     goal, not a regression; too few is the failure this guards. */
  ok("every payroll listing uses it", uses >= 3,
     `${uses} of 3 — the payroll table, the M2E file and the M2E preview; one left on ORDER BY u.name ` +
     "is one surface disagreeing with the other two");
  ok("no payroll query still orders by name alone",
     !/FROM payroll_entries p JOIN users u ON u\.id = p\.user_id[\s\S]{0,400}?ORDER BY u\.name`/.test(staff));
}

/* ---- 3. both screens read the one order ---- */
{
  ok("the payroll table opens in company order",
     /useState<\{ col: PrCol; asc: boolean \}>\(\{ col: "rank", asc: true \}\)/.test(payroll)
       && /case "rank": return dir \* bySeniority\(a, b\)/.test(payroll));
  ok("the staff directory uses the same comparator",
     /\.sort\(bySeniority\)/.test(dir),
     "it had its own inlined RANK map — two orders drift");
  ok("neither screen keeps a private copy of the ranks",
     !/ceo: 1, coo: 2, cco: 3/.test(dir) && !/const RANK: Record<string, number>/.test(dir));
  ok("the STAFF header still sorts alphabetically",
     /case "staff": return dir \* displayName\(a\)\.localeCompare\(displayName\(b\)\)/.test(payroll),
     "company order is the resting state, not a cage");
}

/* ---- 4. crediting a rest day cannot invent a paid day ---- */
{
  ok("the rest-day list exists", /path === "\/rest-day-work" && method === "GET"/.test(staff));
  ok("crediting exists", /path === "\/replacement-credit" && method === "POST"/.test(staff));
  ok("a credit can be undone", /path === "\/replacement-credit" && method === "DELETE"/.test(staff));
  ok("only the CEO credits",
     (staff.match(/can\(user\.role, "leave_entitlement"\)[\s\S]{0,120}?Only the CEO can credit replacement leave/g) ?? []).length === 3,
     "granting a paid day off is the same class of decision as raising an entitlement");
  ok("it must be a rest day on THAT person's schedule",
     /if \(shC\.kind !== "rest_day"\)/.test(staff) && /shiftAtW\(p\.user_id, p\.d\)/.test(staff),
     "not Saturday and Sunday — somebody rostered to work Saturdays is not owed a day for it");
  ok("there must be an approved clock-in behind it",
     /if \(!dayC\?\.i\) return err\("invalid_input", "There is no approved clock-in for that day"/.test(staff),
     "otherwise this route grants leave for any date at all");
  ok("a pending punch is not evidence",
     /const notPendingR = await notPendingSql\(env, "a\."\);/.test(staff)
       && /const notPendingC = await notPendingSql\(env, "a\."\);/.test(staff),
     "an unapproved claim of having worked Saturday would otherwise buy a day off");
  ok("half a day or a whole one, nothing else",
     /if \(daysC !== 0\.5 && daysC !== 1\)/.test(staff),
     "a typo here silently grants leave nobody earned");
  ok("the same day cannot be credited twice",
     /CREATE UNIQUE INDEX IF NOT EXISTS idx_replacement_credits_once/.test(read("worker/migrations/0101_replacement_credits.sql"))
       && /already_credited/.test(staff),
     "buttons get pressed twice; a double tap must cost the company nothing");
  ok("an hourly part-timer is skipped",
     /if \(isHourlyUser\(who\.role, who\.employment_status\)\) continue;/.test(staff)
       && /is paid for the hours they clocked that day, so there is nothing to replace/.test(staff),
     "they were already paid for that Saturday — crediting leave pays for it twice");
  ok("the credit lands on the balance and is audited",
     /INSERT INTO leave_balances \(user_id, year, type, entitled, adjust\)\s*\n\s*VALUES \(\?1, \?2, 'replacement', \?3, \?4\)/.test(staff)
       && /"leave\.replacement_credit"/.test(staff));
  ok("undoing takes the same amount back off, floored at zero",
     /Math\.max\(0, Math\.round\(\(\(balU\.adjust \?\? 0\) - rowU\.days\) \* 100\) \/ 100\)/.test(staff),
     "a hand-edited entitlement in between must not push a balance negative");
  ok("the staff member is told, both ways",
     (staff.match(/notify\(env, (uidC|rowU\.user_id), "leave"/g) ?? []).length === 2);
  ok("0101 is registered and probed",
     read("worker/src/index.ts").includes('"0101_replacement_credits",')
       && /0101 \(a rest day worked, credited as leave\)/.test(read("worker/src/index.ts")));
}

/* ---- 4A. THE SYSTEM ACCOUNT IS NOT AN EMPLOYEE ----

   CEO, 31-08-2026: *"Take note, super_Admin is not a staff. Super_admin is
   system controller which is handling everything about the system."*

   He was reading the payroll screen, where "Days with no clock-in" opened
   with a SUPER ADMIN block listing nineteen absent days. Those queries asked
   for `role != 'customer'` — everyone who is not a shopper — while the
   payroll and M2E queries beside them asked for staff. Two halves of one
   screen disagreeing about who works here.

   This checks the BEHAVIOUR, not the spelling: no query that builds a list
   of people may use the loose predicate. */
{
  const looseLines = [];
  {
    /* Comments are stripped first — including block comments, whose middle
       lines do not start with a star. This guard's own explanation quotes
       the loose predicate, and a guard that reads its own prose as code
       fails on itself. */
    let inBlock = false;
    staff.split(/\r?\n/).forEach((raw, i) => {
      let l = raw;
      if (inBlock) {
        const end = l.indexOf("*/");
        if (end < 0) return;
        l = l.slice(end + 2); inBlock = false;
      }
      const open = l.lastIndexOf("/*");
      if (open >= 0 && l.indexOf("*/", open) < 0) { inBlock = true; l = l.slice(0, open); }
      const code = l.replace(/\/\/.*$/, "");
      /* A single-row lookup by id is a "does this user exist" check, not a
         list of the workforce, and is left alone. */
      if (/\bid = \?1\b/.test(code)) return;
      if (/\brole != 'customer'/.test(code)) looseLines.push(i + 1);
      if (/role NOT IN \('customer'\)/.test(code)) looseLines.push(i + 1);
    });
  }
  ok("no staff list asks for 'not a customer' instead of for staff", looseLines.length === 0,
     `worker/src/staff.ts line(s) ${looseLines.join(", ")} — the system account acquires an ` +
     "attendance record, an absence history and a place in every list");
  ok("there is one predicate for it",
     /export const staffRolesSql = \(alias = ""\) =>/.test(staff)
       && /role NOT IN \('customer', 'super_admin'\)/.test(staff));
  const uses = (staff.match(/\$\{staffRolesSql\(/g) ?? []).length;
  ok("every staff list uses it", uses >= 10,
     `${uses} — the shift resolver, the entitlement editor, the rest-day scan, the two ` +
     "attendance-days lists, the absence scan, birthdays, the task board and the two broadcasts");
  ok("the client agrees about who is staff",
     /export const NON_STAFF_ROLES: readonly string\[\] = \["customer", "super_admin"\];/.test(read("lib/staff-order.ts"))
       && /\.filter\(\(u\) => isStaffRole\(u\.role\)\)/.test(dir));
  /* v1.87.0 — this pinned the scan's WHERE clause verbatim, so adding the
     leaver rule to it failed a check about the SYSTEM ACCOUNT. The property
     is that the scan's people query filters on staffRolesSql; what else it
     filters on is another check's business. */
  ok("the absence scan cannot propose a day for the system account",
     /FROM users WHERE \$\{staffRolesSql\(\)\}[^`]{0,200}`,\n\s*\)\.all<\{ id: number; name: string; full_name/.test(staff),
     "this is the query behind the Super Admin block the CEO was looking at");
}

/* ---- 5. the review card, and what left the attendance panel ---- */
{
  /* v1.86.0 (CEO: "leave to review should inside the leave and also why looks
     like Leave applications — whole company like having same function as
     leave to review?") — it was on the Staff tab and it had TWO halves. The
     unpaid half listed rows the Leave register already carried, with a second
     way to delete one, which is what made the two cards read as one function.
     The chips are gone and the rest-day half moved to the Leave tab, ABOVE
     the register, because crediting is what turns work into a leave record
     and the register is where that record then appears. */
  ok("the card is on the Leave tab, above the whole-company register",
     /<RestDayCreditCard role=\{user\.role\} \/>[\s\S]{0,2000}?Leave — whole company/.test(page),
     "on the Staff tab it sat beside a directory that has nothing to do with leave");
  ok("the unpaid chips are gone from it",
     !/Unpaid days recorded this month/.test(card) && !/undoUnpaid/.test(card),
     "two lists of the same records is how two screens start disagreeing about what was deducted");
  ok("and the register is where an unpaid record is now managed",
     /l\.type === "unpaid" \? "text-danger font-medium"/.test(page),
     "the chips were the only thing making an unpaid day stand out - the register has to do that job now");
  ok("it is CEO-only on the client too",
     /const canReview = \["ceo", "super_admin"\]\.includes\(role\);/.test(card)
       && /if \(!canReview\) return null;/.test(card),
     "a button that 403s is worse than no button");
  ok("it shows the in and out time the decision rests on",
     /\{r\.in_myt \?\? "—"\}–\{r\.out_myt/.test(card),
     "the CEO asked for half or full day 'depend on their in and out time'");
  ok("both amounts are always offered, the suggestion is only a chip",
     /Half day", "Setengah hari"/.test(card) && /Full day", "Sehari penuh"/.test(card)
       && /suggested/.test(card));
  ok("the unpaid chip list has left the attendance panel",
     !/unpaid\.map\(\(u\)/.test(read("components/portal/role-panels.tsx")),
     "the CEO asked for it to move to the staff table, and two copies of a list is two places to undo from");
  ok("the attendance panel says where it went",
     /Recorded days are listed on the Staff tab/.test(read("components/portal/role-panels.tsx")));
}

/* ---- v1.87.0: a leaver leaves the lists ----
   The CEO: "If staff already resigned after that day, the day after it no
   more listed the staff on task, payroll after their payroll released and etc
   except staff tabs which is for recording purposes."

   Offboarding sets left_on and kills every session but DELIBERATELY leaves
   is_active = 1 — flipping it would drop the leaver from their own final
   payroll run and they would not be paid for their last month. That decision
   was never paid down: a leaver stayed in every picker forever. */
{
  const w = read("worker/src/staff.ts");
  ok("there is one predicate for who works here today",
     /export const currentStaffSql = \(alias = ""\) =>/.test(w));
  ok("the last day is a working day",
     /left_on >= date\('now', '\+8 hours'\)/.test(w),
     "left_on is the last PAID day, so somebody leaving on the 30th is on staff on the 30th");
  ok("a re-joiner is back on the list",
     /rejoined_on IS NOT NULL AND \$\{alias\}rejoined_on <= date\('now', '\+8 hours'\)/.test(w),
     "rejoined_on has meant that since v1.4.101 and the payroll honours it - a list that did not would hide somebody sitting in the office");
  const uses = (w.match(/\$\{currentStaffSql\(\)\}/g) ?? []).length;
  ok("every picker and fan-out uses it", uses >= 10,
     `${uses} uses — the task assignee check, the staff pickers, the birthday lists, the counts and the notification fan-outs`);
  ok("work cannot be assigned to somebody who has left",
     /WHERE id = \?1 AND is_active = 1 AND \$\{currentStaffSql\(\)\} AND role NOT IN \('customer'\)/.test(w),
     "hiding them from the dropdown is not the same as refusing the assignment");

  /* THE EXCEPTION THE CEO NAMED HIMSELF. */
  ok("payroll asks a different question",
     /export function payrollMonthStaffSql\(month: string, alias = ""\): string \{/.test(w));
  ok("a leaver stays on the payroll of every month they worked",
     /substr\(\$\{alias\}left_on, 1, 7\) >= '\$\{month\}'/.test(w),
     "their final salary depends on it - dropping them the day they leave means they are not paid for their last month");
  ok("the spliced month is validated where it is spliced, and throws otherwise",
     /if \(!\/\^\\d\{4\}-\\d\{2\}\$\/\.test\(month\)\) \{[\s\S]{0,160}?throw new Error/.test(w),
     "every caller has its own ?1..?n numbering, so the month is spliced rather than bound - which is only safe if nothing else can get through");
  ok("the payroll month that reached three queries unchecked is checked",
     /const mA = urlA\.searchParams\.get\("month"\)[\s\S]{0,320}?test\(mA\)\) return err\("invalid_input"/.test(w),
     "it decides which month's salary is computed");

  /* THE EXCEPTION THAT IS THE WHOLE POINT: the record stays readable. */
  ok("the Staff tab still carries leavers",
     /WHERE \$\{staffRolesSql\("u\."\)\} AND \(u\.is_active = 1 OR u\.left_on IS NOT NULL\)/.test(w) &&
     !/\/users" && method === "GET"[\s\S]{0,900}?currentStaffSql/.test(w),
     "a record you cannot look up is not a record - and /users feeds BOTH the directory and the pickers, so it is filtered in the picker, not at the source");
  ok("the browser has the same rule for the one list it must filter itself",
     /export function isCurrentStaff\(/.test(read("lib/staff-order.ts")) &&
     /isCurrentStaff\(x\)/.test(read("components/portal/role-panels.tsx")));
}

console.log(
  fails.length === 0
    ? `PASS — one company order on every surface, and a rest day cannot be credited twice (${pass} checks)`
    : `\n${fails.map((f) => `  ✗ ${f}`).join("\n")}\n\n${fails.length} check(s) failed.`,
);
process.exit(fails.length === 0 ? 0 : 1);
