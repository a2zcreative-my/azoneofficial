/**
 * THE WEEK, WHOLE — guard #79, v1.158.0.
 *
 * Two things the CEO asked for on the Schedule & Roster, 13-09-2026:
 *
 *   "Public Holiday should appear at here also since it is no working day"
 *   "beside of Assigned Live, I need to assigned them to perform Sales for
 *    the Sales person which is need to perform based on the day/date that I
 *    pick and assigned"
 *
 * The properties, not the markup:
 *
 *   1. THE HOLIDAY IS ON THE BOARD. The roster reads the same `holidays`
 *      table the Events calendar and payroll read (no second list), and the
 *      holiday is named in the day header, tinted down the column, on the
 *      timeline, on the phone agenda and in the mini calendar. It is shown,
 *      never locked: a host booked on a holiday is paid under s.60D.
 *   2. SALES DUTY IS THE THIRD THING A WEEK IS MADE OF. Its own table
 *      (0128, one row per person per day, no FOREIGN KEY), its own routes,
 *      returned by /roster beside sessions and task blocks - never merged
 *      into either.
 *   3. FOR THE SALES PERSON. The server refuses anyone outside the roles the
 *      Sales Performance register measures (MEASURED_ROLES), and the client
 *      offers the same list, so the dialog never offers what the door
 *      refuses.
 *   4. A PLAN, NOT A CLAIM. The chip carries `evidence` - what the person put
 *      on the register that day, counted server-side from the sp_* tables
 *      with deleted rows excluded - and turns amber once a planned day has
 *      passed with nothing logged. The shift itself writes nothing to the
 *      register and earns no KPI credit (v1.155.0).
 *   5. THE SAME RULES AS A TASK. Management only, a run of dates written as a
 *      whole, the 62-day cap, the approved-leave refusal (with the same
 *      override door), audited on the way in and on the way out.
 *   6. TRIPLE-BUMPED. package.json, LATEST_MIGRATION and the probe agree on
 *      0128, and the migration is registered where registry-parity looks.
 *
 * Negative-tested by: removing the `/holidays?year=` fetch (1); dropping
 * `sales_shifts:` from the /roster reply (2); adding "marketing" to
 * SALES_DUTY_ROLES (3); removing `deleted_at IS NULL` from one evidence
 * subquery (4); removing the refuseIfOnLeave call from the POST (5).
 *
 * Run: node tests/roster-week.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(root, p), "utf8");

let passed = 0, failed = 0;
const ok = (label, cond, why = "") => {
  if (cond) passed += 1;
  else { failed += 1; console.log(`  ✗ ${label}${why ? ` — ${why}` : ""}`); }
};
const list = (src, re) => [...(src.match(re)?.[1] ?? "").matchAll(/"([a-z_]+)"/g)].map((m) => m[1]).sort();

const board = read("components/portal/roster-board.tsx");
const mini = read("components/portal/mini-calendar.tsx");
const staff = read("worker/src/staff.ts");
const sp = read("worker/src/sales-performance.ts");
const index = read("worker/src/index.ts");
const pkg = JSON.parse(read("package.json"));

/* ---- 1. the holiday is on the board ---- */
{
  ok("the roster reads the company holidays table, not a list of its own", /`\/holidays\?year=\$\{y\}`/.test(board) && !/Hari Malaysia|Malaysia Day/.test(board));
  ok("...and only once per year, so paging weeks costs nothing", /holidayYears\.current\.has\(y\)/.test(board));
  ok("the day header names it", /\{hol && <p className="text-danger truncate text-\[10px\] font-medium">\{hol\.name\}<\/p>\}/.test(board));
  ok("the column is tinted on the grid, the timeline and the phone agenda", (board.match(/holidayAt\(d\) \? "bg-danger-soft\/20"/g) ?? []).length >= 2 && /hol \? "bg-danger-soft\/20"/.test(board));
  ok("the week's holidays are chips above the board", /data\.days\.filter\(\(d\) => holidayAt\(d\)\)\.map/.test(board) && /<AppIcon name="holiday"/.test(board));
  ok("the mini calendar paints it too", /holidays=\{holidays\}/.test(board) && /holidays\?: Record<string, \{ name: string \}>;/.test(mini) && /hol \? "text-danger font-bold/.test(mini));
  ok("it is in the legend", /\{L\("Public holiday", "Cuti umum"\)\}/.test(board));
  ok("it is shown, never locked: no cell refuses a drop for a holiday", !/holidayAt\(d\)\s*&&\s*!canDrop|!holidayAt\(d\)\s*&&\s*\(canManage/.test(board) && /const canDrop = armed != null && !placing && !leave\s*&& \(canManage/.test(board));
  ok("the sales-duty dialog names a holiday in the run instead of refusing it", /Public holiday in this run: /.test(board) && /a holiday worked is paid at the holiday rate/.test(board));
}

/* ---- 2. sales duty is the third thing ---- */
{
  ok("migration 0128 exists and makes one row per person per day, with no FOREIGN KEY",
    existsSync(join(root, "worker/migrations/0128_sales_shifts.sql"))
    && /CREATE TABLE IF NOT EXISTS sales_shifts/.test(read("worker/migrations/0128_sales_shifts.sql"))
    && /UNIQUE \(user_id, shift_date\)/.test(read("worker/migrations/0128_sales_shifts.sql"))
    && !/FOREIGN KEY/.test(read("worker/migrations/0128_sales_shifts.sql").replace(/--[^\n]*/g, "")));
  ok("/roster returns the shifts beside sessions and task blocks, never merged", /sales_shifts: salesShifts,/.test(staff) && /FROM sales_shifts s JOIN users u ON u\.id = s\.user_id/.test(staff) && !/UNION[\s\S]{0,200}sales_shifts/.test(staff));
  ok("a sales person sees their own; a manager sees everyone", /WHERE s\.user_id = \?3 AND s\.shift_date BETWEEN \?1 AND \?2/.test(staff));
  ok("the board types it and lists it separately", /interface SalesShift \{/.test(board) && /sales_shifts\?: SalesShift\[\];/.test(board) && /const shifts: SalesShift\[\] = data\.sales_shifts \?\? \[\];/.test(board));
  ok("it is the third item on New assignment", /\{L\("Sales duty", "Tugas jualan"\)\}/.test(board) && /setSalesOpen\(true\)/.test(board));
  ok("a manager can take it off the plan", /`\/sales-shifts\/\$\{sh\.id\}`, \{ method: "DELETE" \}/.test(board) && /salesShiftMatch && method === "DELETE"/.test(staff));
}

/* ---- 3. for the sales person ---- */
{
  const measured = list(sp, /export const MEASURED_ROLES: readonly string\[\] = \[([^\]]*)\]/);
  const client = list(board, /const SALES_DUTY_ROLES: readonly string\[\] = \[([^\]]*)\]/);
  ok("the server refuses anyone the register does not measure", /if \(!MEASURED_ROLES\.includes\(u\.role\)\)/.test(staff) && /import \{ handleSalesPerformance, MEASURED_ROLES \} from "\.\/sales-performance"/.test(staff));
  ok("the client offers exactly that list", JSON.stringify(client) === JSON.stringify(measured), `${client.join(",")} vs ${measured.join(",")}`);
  ok("...and the dialog draws from it", /const salesStaff = staff\.filter\(\(u\) => SALES_DUTY_ROLES\.includes\(u\.role \?\? ""\)\);/.test(board) && /\{salesStaff\.map\(\(u\) => <option/.test(board));
}

/* ---- 4. a plan, not a claim ---- */
{
  const roster = staff.slice(staff.indexOf("let salesShifts: unknown[] = [];"), staff.indexOf("sales_shifts: salesShifts,"));
  ok("evidence is counted server-side from the register's three activity tables", /FROM sp_social_posts p WHERE/.test(roster) && /FROM sp_engagements e WHERE/.test(roster) && /FROM sp_other_activities o WHERE/.test(roster));
  ok("...with deleted rows excluded, in every subquery", (roster.match(/deleted_at IS NULL/g) ?? []).length === 6);
  ok("...on that day, in MYT-date terms", (roster.match(/substr\(\w\.\w+_at, 1, 10\) = s\.shift_date/g) ?? []).length === 6);
  ok("the shift writes nothing to the register", !/INSERT INTO sp_/.test(staff.slice(staff.indexOf('path === "/sales-shifts"'), staff.indexOf('path === "/roster"'))));
  ok("a passed day with nothing logged turns amber", /sh\.shift_date < todayS && sh\.evidence === 0\s*\? "border-warning bg-warning-soft"/.test(board));
  ok("and the note says a planned day earns nothing by itself", /a planned day earns nothing by itself/.test(board));
}

/* ---- 5. the same rules as a task ---- */
{
  const route = staff.slice(staff.indexOf('path === "/sales-shifts" && method === "POST"'), staff.indexOf('path === "/roster" && method === "GET"'));
  ok("management only, both ways", (route.match(/can\(user\.role, "team_manage"\)/g) ?? []).length === 2);
  ok("a run is validated as a whole, capped at 62 days", /dates\.length > 62/.test(route) && /Array\.isArray\(body\?\.dates\)/.test(route));
  ok("approved leave refuses it, with the same override door", /refuseIfOnLeave\(env, user, who, dates, body\?\.leave_override === true\)/.test(route));
  ok("the end must follow the start", /if \(et <= st\) return err/.test(route));
  ok("a second assignment on the same day is the same duty, and the reply says how many landed", /INSERT OR IGNORE INTO sales_shifts/.test(route) && /skipped: dates\.length - made/.test(route));
  ok("audited in and out", /"roster\.sales_shift"/.test(route) && /"roster\.sales_shift_remove"/.test(route));
  ok("the person must be active staff", /if \(!u \|\| !u\.is_active\) return err/.test(route));
  ok("the target is bounded and in cents", /target > 100_000_000/.test(route) && /Math\.round\(Number\(sDraft\.target\) \* 100\)/.test(board));
}

/* ---- 6. triple-bumped ---- */
{
  ok("package.json is 1.158.0 or later", /^1\.(158|159|1[6-9]\d|[2-9]\d\d)\./.test(pkg.version), pkg.version);
  ok("LATEST_MIGRATION is 0128", /const LATEST_MIGRATION = "0128_sales_shifts";/.test(index));
  ok("the probe reads the new table", /\["0128 \(sales duty on the roster\)", `SELECT focus FROM sales_shifts LIMIT 1`\]/.test(index));
}

console.log(failed === 0
  ? `roster-week: ${passed} checks passed.`
  : `\n${failed} roster-week check(s) failed.`);
process.exitCode = failed === 0 ? 0 : 1;
