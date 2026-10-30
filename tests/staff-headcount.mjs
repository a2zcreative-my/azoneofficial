/* ONE STAFF STATUS (v1.230.0) - guard.
 *
 * The owner's brief, 30-10-2026: "ONE AUTHORITATIVE STAFF STATUS DEFINITION.
 * CONSISTENT DASHBOARD COUNTS. HISTORICAL RECORDS PRESERVED. NO
 * DUPLICATION." The Staff tab counted Active by the account switch, which
 * offboarding leaves on so a leaver's last month is paid: Active 9 beside a
 * Staff Status chart of 7 / 0 / 2. Answers: future joiners "Not yet, show
 * 'Starting'", "Yes, a note under Active" (leave), employment type "Current
 * staff only". This guard holds:
 *
 *   A the browser's staffState() and the worker's headcountSql /
 *     currentStaffSql give the same answer on every scenario of the brief
 *     (run for real: lib/staff-order.ts bundled, the SQL run in SQLite) -
 *     and the search label's copy of the rule agrees too;
 *   B the Staff tab's Active, Roles written, Needs Attention, Departments &
 *     Roles, Employment type and Staff Status all read that one set;
 *     the screenshot's nine records give 9 / 7 / 7-0-2 / of 7 / 5-1-1;
 *   C the Dashboard's Active staff tile and its "not clocked in" list use
 *     headcountSql; pickers keep currentStaffSql; payroll keeps its own
 *     month rule (untouched);
 *   D the on-leave note reads Leave's calendar for today and never changes
 *     the headcount; nothing here writes.
 *
 * Negative-tested below (each mutation must fail a check).
 *
 *   node tests/staff-headcount.mjs
 */
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const real = {
  order: read("lib/staff-order.ts"),
  dir: read("components/staff/staff-directory.tsx"),
  staff: read("worker/src/staff.ts"),
  search: read("worker/src/search.ts"),
  org: read("lib/org-tree.ts"),
};

const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
const day = (n) => new Date(Date.parse(today) + n * 864e5).toISOString().slice(0, 10);
/* the brief's twelve, and the three edges the audit found */
const ROWS = [
  { n: "1 active, login on", is_active: 1, role: "sales_marketing", employment_status: "permanent", joined_on: "2025-01-01", expect: "active" },
  { n: "2 account switched off", is_active: 0, role: "live_host", employment_status: "permanent", joined_on: "2025-01-01", expect: "inactive" },
  { n: "3 on approved leave today", is_active: 1, role: "marketing", employment_status: "contract", joined_on: "2025-01-01", expect: "active", leave: true },
  { n: "4 resigned, last day ahead", is_active: 1, role: "sales_marketing", employment_status: "resigned", joined_on: "2024-01-01", left_on: day(20), expect: "active" },
  { n: "5 resigned, last day passed", is_active: 1, role: "live_host", employment_status: "resigned", joined_on: "2024-01-01", left_on: day(-10), expect: "left" },
  { n: "6 terminated, payroll history", is_active: 1, role: "editor", employment_status: "terminated", joined_on: "2023-01-01", left_on: "2026-08-31", expect: "left" },
  { n: "7 permanent", is_active: 1, role: "hr_admin", employment_status: "permanent", expect: "active" },
  { n: "8 contract", is_active: 1, role: "live_host", employment_status: "contract", expect: "active" },
  { n: "9 part-time", is_active: 1, role: "live_host", employment_status: "part_time", expect: "active" },
  { n: "10 nothing written", is_active: 1, role: "marketing", employment_status: "probation", expect: "active" },
  { n: "resigned, no last day", is_active: 1, role: "marketing", employment_status: "resigned", expect: "left" },
  { n: "re-joined", is_active: 1, role: "live_host", employment_status: "resigned", left_on: "2025-01-31", rejoined_on: "2025-06-01", expect: "active" },
  { n: "starts in 14 days", is_active: 1, role: "live_host", employment_status: "probation", joined_on: day(14), expect: "starting" },
  { n: "starts today", is_active: 1, role: "live_host", employment_status: "contract", joined_on: today, expect: "active" },
  { n: "admin account", is_active: 1, role: "admin", employment_status: "permanent", expect: "system" },
];

const sqlTemplate = (src, name) => (src.match(new RegExp(`export const ${name} = \\(alias = ""\\) =>\\s*\`([\\s\\S]*?)\`;`)) ?? [])[1] ?? "";
function serverSql(staff) {
  const cur = sqlTemplate(staff, "currentStaffSql").replace(/\$\{alias\}/g, "");
  const head = sqlTemplate(staff, "headcountSql").replace(/\$\{currentStaffSql\(alias\)\}/g, cur).replace(/\$\{alias\}/g, "");
  return { cur, head };
}
async function staffStateOf(order) {
  const ts = order.replace(/^import .*$/gm, "");
  try {
    const js = execSync("npx esbuild --loader=ts --format=esm --log-level=error", { input: ts, cwd: root }).toString();
    return (await import("data:text/javascript," + encodeURIComponent(js)));
  } catch { return {}; }
}

async function checks(f) {
  const out = [];
  const ok = (c, m) => out.push([!!c, m]);
  const { staffState, isCurrentStaff } = await staffStateOf(f.order);
  const { cur, head } = serverSql(f.staff);

  /* A */
  ok(typeof staffState === "function" && cur && head, "A the rule exists on both sides");
  if (typeof staffState === "function" && cur && head) {
    const db = new DatabaseSync(":memory:");
    db.exec("CREATE TABLE users (id INTEGER, is_active INT, role TEXT, employment_status TEXT, joined_on TEXT, left_on TEXT, rejoined_on TEXT)");
    ROWS.forEach((r, i) => db.prepare("INSERT INTO users VALUES (?,?,?,?,?,?,?)").run(i, r.is_active, r.role, r.employment_status, r.joined_on ?? null, r.left_on ?? null, r.rejoined_on ?? null));
    const ids = (sql) => new Set(db.prepare(sql).all().map((x) => x.id));
    const sHead = ids(`SELECT id FROM users WHERE is_active = 1 AND ${head} AND role NOT IN ('customer', 'super_admin', 'admin')`);
    const sOn = ids(`SELECT id FROM users WHERE ${cur}`);
    const searchCase = (f.search.match(/CASE WHEN (\(\(left_on[\s\S]*?\)\)\)) THEN 1 ELSE 0 END AS here/) ?? [])[1];
    const sSearch = searchCase ? ids(`SELECT id FROM users WHERE ${searchCase}`) : new Set();
    ROWS.forEach((r, i) => {
      const st = staffState(r, today);
      ok(st === r.expect, `A ${r.n}: ${r.expect} (browser said ${st})`);
      ok((st === "active") === sHead.has(i), `A ${r.n}: the worker's headcount agrees`);
      ok(isCurrentStaff(r, today) === sOn.has(i) && sSearch.has(i) === sOn.has(i), `A ${r.n}: "on staff today" agrees in the browser, the worker and the search label`);
    });
  }

  /* B */
  const d = f.dir.replace(/\/\*[\s\S]*?\*\//g, " ");
  ok(/const stateOf = \(u: Staff\): StaffState => staffState\(u, todayS\);/.test(d) && /const headcount = staff\.filter\(isHead\);\s*const activeCount = headcount\.length;/.test(d), "B Active is the headcount set");
  ok(!/staff\.filter\(\(u\) => u\.is_active\)\.length/.test(d) && !/u\.is_active && !writtenOf/.test(d) && !/u\.is_active && \(\(u\.role_title/.test(d), "B no figure counts the account switch as headcount");
  ok(/const writtenCount = headcount\.filter\(/.test(d) && /const notWritten = headcount\.filter\(/.test(d) && /of \$\{activeCount\} working/.test(d), "B Roles written and Needs Attention use the same people as Active");
  ok(/const working = list\.filter\(isHead\);/.test(d) && /list\.filter\(\(u\) => isHead\(u\) && !writtenOf\(u\)\)/.test(d), "B Departments & Roles use them too");
  ok(/const typeCounts = typeKeys\.map\(\(k\) => \[k, headcount\.filter\(\(u\) => typeOf\(u\) === k\)/.test(d) && !/"resigned"|"terminated"/.test((d.match(/const TYPE_ORDER = \[[^\]]*\]/) ?? [""])[0])
     && /const typeOf = \(u: Staff\) => \(DEPARTURE_STATUSES\.includes\(u\.employment_status \?\? ""\) \? "" :/.test(d), "B employment type counts current staff; a departure is never a type (notice or re-joined: Not set)");
  ok(/\.map\(\(k\) => \[k, staff\.filter\(\(u\) => stateOf\(u\) === k\)\.length\] as const\)/.test(d) && /\(\["active", "starting", "inactive", "left", "system"\] as const\)/.test(d), "B Staff Status puts every record in exactly one state");
  ok(/onClick=\{\(\) => showDirectory\("", "active"\)\}/.test(d) && /\.filter\(\(u\) => !stateF \|\| stateOf\(u\) === stateF\)/.test(d), "B the Active tile opens the same people");
  ok(!/\["resigned", "terminated"\]\.includes\(u\.employment_status \?\? ""\) \? b : null/.test(d) && /const gone = \(u: Staff\) => staffState\(u\) === "left";/.test(d), "B Team Map and the orbit read the rule, not the status alone");
  ok(/export const isHere = \(u: OrgPerson\): boolean => isCurrentStaff\(u\);/.test(f.org), "B the Organisation chart reads the rule");
  if (typeof staffState === "function") {
    const shot = [..."PPPPPCT"].map((t) => ({ is_active: 1, role: "sales_marketing", employment_status: { P: "permanent", C: "contract", T: "part_time" }[t] }))
      .concat([{ is_active: 1, role: "live_host", employment_status: "resigned", left_on: day(-30) }, { is_active: 1, role: "marketing", employment_status: "resigned", left_on: day(-60) }]);
    const st = shot.map((u) => staffState(u, today));
    const active = shot.filter((_, i) => st[i] === "active");
    ok(shot.length === 9 && active.length === 7 && st.filter((x) => x === "left").length === 2 && st.filter((x) => x === "inactive").length === 0, "B the screenshot's nine records: Active 7, Inactive 0, Left 2");
    ok(["permanent", "contract", "part_time"].map((k) => active.filter((u) => u.employment_status === k).length).join() === "5,1,1", "B ...and the types are 5 / 1 / 1, adding up to Active");
  }

  /* C */
  ok(/staff_total: await n\(`SELECT COUNT\(\*\) AS c FROM users WHERE is_active = 1 AND \$\{headcountSql\(\)\}/.test(f.staff), "C the Dashboard's Active staff tile is the same headcount");
  ok(/WHERE u\.is_active = 1 AND \$\{headcountSql\("u\."\)\} AND u\.role NOT IN \('customer', 'super_admin', 'admin'\)\s*ORDER BY \$\{STAFF_ORDER_SQL\}`,\s*\)\.all<\{ id: number; name: string; position: string \| null; leave_type/.test(f.staff), "C ...and its not-clocked-in list");
  ok(/path === "\/staff-list"[\s\S]{0,500}?\$\{currentStaffSql\("u\."\)\}/.test(f.staff) && (f.staff.match(/\$\{headcountSql\(/g) ?? []).length === 2, "C pickers keep currentStaffSql (a starter can be rostered); headcount is used for the two counts only");
  ok(/export function payrollMonthStaffSql\(month: string, alias = ""\): string \{/.test(f.staff) && /substr\(\$\{alias\}left_on, 1, 7\) >= '\$\{month\}'/.test(f.staff), "C payroll keeps its month rule - a leaver is paid for every month worked");

  /* D */
  ok(/useCachedApi<\{ leave\?: \{ user_id: number \}\[\] \}>\(`\/staff\/leave\/calendar\?from=\$\{todayS\}&to=\$\{todayS\}`/.test(d) && /const onLeaveToday = headcount\.filter\(/.test(d), "D the on-leave note reads Leave's calendar for today, among the headcount");
  ok(!/activeCount = [^;]*onLeave/.test(d), "D leave never changes the headcount");
  const fn = (f.order.match(/export function staffState[\s\S]*?\n}\n/) ?? [""])[0];
  ok(fn && !/api|fetch|UPDATE|INSERT/.test(fn), "D the rule reads; it writes nothing");
  return out;
}

let fail = 0, n = 0;
for (const [pass, m] of await checks(real)) { n++; if (!pass) { fail++; console.error("FAIL", m); } }

const mutations = [
  ["Active back on the account switch", { dir: real.dir.replace("const headcount = staff.filter(isHead);\n  const activeCount = headcount.length;", "const headcount = staff.filter(isHead);\n  const activeCount = staff.filter((u) => u.is_active).length;") }],
  ["Roles written over every record", { dir: real.dir.replace("const writtenCount = headcount.filter(", "const writtenCount = staff.filter(") }],
  ["types counted over every record", { dir: real.dir.replace("[k, headcount.filter((u) => typeOf(u) === k)", "[k, staff.filter((u) => typeOf(u) === k)") }],
  ["a departure counted as a type again", { dir: real.dir.replace('const typeOf = (u: Staff) => (DEPARTURE_STATUSES.includes(u.employment_status ?? "") ? "" : (u.employment_status ?? ""));', 'const typeOf = (u: Staff) => (u.employment_status ?? "");') }],
  ["the browser forgets the joiner rule", { order: real.order.replace('if (u.joined_on && u.joined_on.slice(0, 10) > today) return "starting";', "") }],
  ["the worker forgets the joiner rule", { staff: real.staff.replace("substr(${alias}joined_on, 1, 10) <= date('now', '+8 hours')", "1 = 1") }],
  ["the search label forgets re-joiners", { search: real.search.replace("OR (rejoined_on IS NOT NULL AND rejoined_on <= date('now', '+8 hours'))) THEN 1", ") THEN 1") }],
  ["leavers read as the status alone again", { order: real.order.replace("if (!isCurrentStaff(u, today)) return \"left\";", "if ([\"resigned\", \"terminated\"].includes(u.employment_status ?? \"\")) return \"left\";") }],
  ["the Dashboard tile back on currentStaffSql", { staff: real.staff.replace("WHERE is_active = 1 AND ${headcountSql()} AND role NOT IN", "WHERE is_active = 1 AND ${currentStaffSql()} AND role NOT IN") }],
];
for (const [name, patch] of mutations) {
  n++;
  const f = { ...real, ...patch };
  if (!Object.keys(patch).every((k) => patch[k] !== real[k])) { fail++; console.error("FAIL mutation did not apply:", name); continue; }
  if (!(await checks(f)).some(([pass]) => !pass)) { fail++; console.error("FAIL mutation not caught:", name); }
}
if (fail) { console.error(`staff-headcount: ${fail} of ${n} failed`); process.exit(1); }
console.log(`staff-headcount: ${n} checks passed (${mutations.length} mutations caught)`);
