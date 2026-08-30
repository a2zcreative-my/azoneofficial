/**
 * Unpaid leave, task delete and the CEO override (v1.72.0) — guard #20.
 *
 * Three CEO-only powers landed in one release, and all three are the kind
 * that are quiet when they break:
 *
 *   1. DELETE /tasks/:id destroys work that cannot be recovered. If the
 *      permission ever widens, or a child table is forgotten in the cascade,
 *      nothing throws — a manager can simply delete, or a deleted task keeps
 *      occupying somebody's week on the roster forever.
 *   2. The leave override skips HR and the COO/CCO. The one rule it must
 *      never relax is that nobody approves their own leave. That check is
 *      four lines of code and no test would notice its removal.
 *   3. Recording an unpaid day takes 1/26 of a month's wage off a person.
 *      The deduction is computed in THREE places — the payslip, the payroll
 *      recompute, and the payroll panel in the browser — and they have to
 *      agree. They also have to keep excluding those days from the
 *      incomplete-month proration, or the same absence is deducted twice
 *      and the staff member is the one who finds out.
 *
 * None of that is visible on screen. It is visible here.
 *
 *   node tests/unpaid-leave.mjs
 */
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(p, "utf8");
const staff = read("worker/src/staff.ts");
const index = read("worker/src/index.ts");
const perms = read("worker/src/permissions.ts");
const page = read("app/portal/page.tsx");
const panels = read("components/portal/role-panels.tsx");
const payroll = read("components/portal/payroll-panel.tsx");

let pass = 0;
const fails = [];
const ok = (label, cond, extra = "") => {
  if (cond) pass++;
  else fails.push(`${label}${extra ? ` — ${extra}` : ""}`);
};

/* ---- 1. the two new permissions admit the CEO and nobody else ----
   Asserted as a SET, not as a string match: "does the matrix contain this
   line" would still pass if hr_admin were appended to it. */
for (const [perm, why] of [
  ["task_delete", "deleting a task destroys its scope, comments and roster blocks"],
  ["unpaid_leave", "recording an unpaid day removes a day of somebody's pay"],
]) {
  const m = perms.match(new RegExp(`\\n\\s*${perm}: \\[([^\\]]*)\\]`));
  ok(`${perm} exists in the permission matrix`, Boolean(m));
  if (!m) continue;
  const roles = [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]).sort();
  ok(`${perm} is CEO-only`, JSON.stringify(roles) === JSON.stringify(["ceo", "super_admin"]),
     `admits ${roles.join(", ")} — ${why}`);
}

/* ---- 2. the routes consult them ---- */
ok("DELETE /tasks/:id checks task_delete",
   /taskMatch && method === "DELETE"[\s\S]{0,200}?can\(user\.role, "task_delete"\)/.test(staff),
   "the route would be open to anyone who can reach the tasks API");
ok("POST /attendance/unpaid checks unpaid_leave",
   /"\/attendance\/unpaid" && method === "POST"[\s\S]{0,400}?can\(user\.role, "unpaid_leave"\)/.test(staff));
ok("DELETE /attendance/unpaid checks unpaid_leave",
   /"\/attendance\/unpaid" && method === "DELETE"[\s\S]{0,400}?can\(user\.role, "unpaid_leave"\)/.test(staff));

/* ---- 3. the delete cascade is complete ----
   These tables have no ON DELETE CASCADE. Every child a task owns has to be
   named here, or the row survives its parent. */
{
  const block = staff.slice(staff.indexOf('if (taskMatch && method === "DELETE")'));
  const body = block.slice(0, block.indexOf("return json({ ok: true });"));
  for (const t of ["task_items", "task_events", "task_comments", "task_blocks"]) {
    ok(`the task delete removes ${t}`, new RegExp(`DELETE FROM ${t} WHERE task_id`).test(body),
       t === "task_blocks"
         ? "the roster reads task_blocks by DATE, so an orphan block occupies a working week forever"
         : "the rows would outlive the task they belong to");
  }
  ok("the task itself is deleted last", /DELETE FROM tasks WHERE id/.test(body));
  ok("the audit row records the title, not just an id",
     /audit\(env, user\.id, "task\.delete"[\s\S]{0,120}?title: row\.title/.test(body),
     "an audit line saying only 'task 41 deleted' cannot tell anyone what was lost");
  ok("the people carrying the task are told", /notify\(env, row\.assigned_to/.test(body));
}

/* ---- 4. the leave override ---- */
{
  ok("override is refused to everyone but the CEO",
     /body\?\.override === true && !OVERRIDE_ROLES\.includes\(user\.role\)/.test(staff));
  const m = staff.match(/const OVERRIDE_ROLES: readonly Role\[\] = \[([^\]]*)\]/);
  const roles = m ? [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]).sort() : [];
  ok("OVERRIDE_ROLES is the CEO and the break-glass account",
     JSON.stringify(roles) === JSON.stringify(["ceo", "super_admin"]), roles.join(", "));
  ok("nobody approves their own leave, override or not",
     /override && row\.user_id === user\.id[\s\S]{0,120}?You cannot approve your own leave/.test(staff),
     "this is the one rule the bypass must never relax");
  ok("a closed request cannot be re-decided by override",
     /override && \["approved", "rejected", "cancelled"\]\.includes\(row\.stage\)/.test(staff));
  ok("the override writes the CEO as the final signature only",
     /stage = 'approved', status = 'approved',[\s\S]{0,140}?final_by = \?3/.test(staff),
     "hr_by and preapp_by must stay NULL — that unsigned shape IS the record that stages were skipped");
  ok("the skipped stage is audited",
     /"leave\.override_approve"[\s\S]{0,120}?from_stage: row\.stage/.test(staff));
  ok("the normal path still requires the right stage",
     /if \(!leaveCanActAt\(user, row\.stage, row\.applicant_role, row\.user_id\)\)/.test(staff),
     "the override must be an extra door, not a replacement for the chain");
  ok("the client only offers the override to the CEO",
     /const canOverride = \["ceo", "super_admin"\]\.includes\(user\.role\)/.test(page));
  ok("the client never offers it on your own application",
     /canOverride && l\.user_id !== user\.id/.test(page));
}

/* ---- 5. recording an unpaid day ---- */
{
  const i = staff.indexOf('if (path === "/attendance/unpaid" && method === "POST")');
  const body = staff.slice(i, staff.indexOf('if (path === "/attendance/unpaid" && method === "DELETE")'));
  ok("the day is stored as an APPROVED unpaid leave request",
     /type[\s\S]{0,10}?'unpaid'[\s\S]{0,200}?'approved', 'approved'/.test(body) ||
     /VALUES \(\?1, 'unpaid', \?2, \?2, 1, \?3, 'approved', 'approved'/.test(body),
     "payroll counts approved unpaid leave — anything else is a day that deducts nothing");
  ok("it is marked as recorded by management", /recorded_direct\)[\s\S]{0,200}?, 1\)/.test(body));
  ok("one row is one day", /\?2, \?2, 1,/.test(body),
     "start = end = the date, days = 1; a range here would deduct more than a day");
  ok("a day that is already unpaid is refused",
     /start_date <= \?2 AND end_date >= \?2[\s\S]{0,200}?already unpaid leave/.test(body),
     "two rows over one day is two deductions");
  ok("the staff member is notified", /notify\(env, body\.user_id, "leave"[\s\S]{0,140}?UNPAID LEAVE/.test(body),
     "a deduction first discovered on the payslip is how trust in a payroll system ends");
  ok("a missing 0097 says so instead of failing silently",
     /no such column[\s\S]{0,160}?Migration 0097/.test(body));
  const del = staff.slice(staff.indexOf('if (path === "/attendance/unpaid" && method === "DELETE")'));
  ok("undo can only remove a day the COMPANY recorded",
     /DELETE FROM leave_requests WHERE id = \?1 AND recorded_direct = 1/.test(del),
     "otherwise the undo button could erase a staff member's own approved application");
  ok("undo notifies the staff member too", /notify\(env, rowD2\.user_id, "leave"/.test(del));
}

/* ---- 6. the money: one rate, in every place that computes it ----
   Employment Act 1955 s.60I — monthly wages ÷ 26 per day. A FIXED divisor,
   deliberately not the month's working days. */
{
  ok("the payslip deducts at basic ÷ 26",
     /unpaidDays > 0 \? Math\.round\(\(orpBase \/ 26\) \* unpaidDays\) : 0/.test(staff));
  ok("the payroll recompute deducts at the same rate",
     /ul > 0 \? Math\.round\(\(\(e\.base_salary_cents \|\| e\.basic_cents\) \/ 26\) \* ul\) : 0/.test(staff));
  /* EVERY site, not "a" site. The panel computes this figure in three
     places (the auto-fill, the table row and the save loop) and the server
     in two. A first draft of this guard asserted that ONE of them said 26,
     which still passed with another quietly changed to 22 — the failure
     that only shows up as an underpaid salary. So: find every unpaid-leave
     rate expression in the codebase and require all of them to be 26. */
  {
    const RATE = /\/ (\d+)\) \* (?:ul|unpaidDays)\)/g;
    const sites = [];
    for (const [file, src] of [["payroll-panel.tsx", payroll], ["staff.ts", staff]]) {
      for (const m of src.matchAll(RATE)) sites.push([file, Number(m[1])]);
    }
    ok("every unpaid-leave rate in the codebase was found", sites.length >= 4,
       `found ${sites.length} — expected the payslip, the recompute and the panel's three`);
    const wrong = sites.filter(([, n]) => n !== 26);
    ok("every one of them divides by 26 (Employment Act 1955 s.60I)", wrong.length === 0,
       wrong.map(([f, n]) => `${f} uses ${n}`).join(", ") +
       " — the divisor is FIXED by statute and is deliberately not the month's working days");
  }
  ok("the recompute subtracts the unpaid deduction from net",
     /- e\.deduction_cents - ulDed - adj/.test(staff));
  ok("unpaid days are excluded from the incomplete-month proration (server)",
     /Math\.max\(0, workD - \(e\.worked_days as number\)\) - ul/.test(staff),
     "without this the same absence is deducted twice");
  ok("unpaid days are excluded from the proration (browser)",
     /Math\.max\(0, missing - unpaidLeaveDays\)/.test(payroll));
  ok("the payslip shows the deduction as its own line",
     /UNPAID LEAVE \(\$\{n2v\(d\)\} DAY/.test(payroll),
     "a smaller number with no line explaining it is what makes staff distrust a payslip");
}

/* ---- 7. what payroll counts and what the screen lists are the same month ----
   Payroll attributes a leave to the month it STARTS in. If the attendance
   list used an overlap instead, a July leave would appear under August while
   August pay was untouched. */
{
  ok("payroll counts unpaid leave by start month",
     (staff.match(/type = 'unpaid' AND status = 'approved'[\s\S]{0,120}?start_date LIKE/g) ?? []).length >= 2);
  const g = staff.slice(staff.indexOf('if (path === "/attendance/unpaid" && method === "GET")'));
  ok("the attendance list uses the same month rule",
     /l\.start_date LIKE \?1 \|\| '%'/.test(g.slice(0, 2500)),
     "a screen about money must not disagree with the money");
}

/* ---- 8. the migration is registered and probed ----
   NOT "0097 is the LATEST migration" — that is the assertion that broke
   guard #16 the day after it was written, and again in #17. What must stay
   true forever is that it is registered and probed. */
ok("0097 is in EXPECTED_MIGRATIONS", /"0097_leave_recorded_direct",/.test(index));
ok("0097 has a health probe", /0097 \(unpaid day recorded by management\)/.test(index));

/* ---- 9. the client gates match the server ---- */
ok("the delete button is CEO-only in the browser too",
   /const canDelete = \["ceo", "super_admin"\]\.includes\(user\.role\)/.test(page));
ok("the unpaid control is CEO-only in the browser too",
   /const canUnpaid = \["ceo", "super_admin"\]\.includes\(role\)/.test(panels));
ok("the attendance panel is actually given the role",
   /<AttendanceAdminPanel role=\{user\.role\} \/>/.test(page),
   "without the prop the control renders for nobody, silently");

console.log(
  fails.length === 0
    ? `PASS — CEO-only powers are CEO-only, the cascade is complete, and one unpaid day is deducted once (${pass} checks)`
    : `\n${fails.map((f) => `  ✗ ${f}`).join("\n")}\n\n${fails.length} check(s) failed.`,
);
process.exit(fails.length === 0 ? 0 : 1);
