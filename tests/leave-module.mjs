#!/usr/bin/env node
/* Guard - v1.206.0: ONE LEAVE REQUEST. ONE APPROVAL WORKFLOW. ONE
 * AUTHORITATIVE LEAVE BALANCE. MULTIPLE CONNECTED VIEWS.
 *
 * The owner's Leave brief, 25-10-2026, and the audit before it:
 *
 *   1. "DAYS USED" IS WRITTEN FOUR TIMES in the worker - the Leave tab's
 *      balance, the company entitlement table, the eligibility editor and
 *      the payslip. They agree today (the payslip deliberately stops at the
 *      end of its payroll month). The owner approved a guard, not a rewrite:
 *      the four must keep the same rule - approved leave, of the type, whose
 *      start falls in the year - and each must meet leaveAccrual().
 *   2. ONE APPROVAL RULE. The page's canActOnStage lists are the worker's
 *      leave-chain lists; the roles that see the company board are the
 *      worker's leaveSeesAll roles; only leave.tsx calls the decision route.
 *   3. THE DRAWER ONLY POINTS. The related records are links drawn where the
 *      tab strip already shows the tab; no figure, no pay, no punch, no
 *      write. Its actions are the page's own functions behind the page's own
 *      gates (the stage that waits on you, the CEO override, the CEO's amend
 *      and remove, your own cancel).
 *   4. WHO IS AWAY, NOT WHY. The Overview and the Team Calendar draw names,
 *      types and dates - never a reason (the owner kept /leave/month as it is
 *      for now; the screens do not use the reason it carries).
 *
 * Negative-tested by: dropping status = 'approved' from the payslip's sum
 * (1); adding "cco" to the page's final approvers (2); a POST from
 * LeaveRelated (3); printing l.reason in the upcoming list (4).
 */
import { readFileSync, readdirSync, mkdtempSync } from "node:fs";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");
let failed = 0, passed = 0;
const ok = (label, cond, why = "") => { if (cond) passed++; else { failed++; console.log(`  ✗ ${label}${why ? ` — ${why}` : ""}`); } };
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

const staff = read("worker/src/staff.ts");
const leave = read("components/portal/leave.tsx");
const overview = read("components/portal/leave-overview.tsx");

/* ---- 1. the four "days used" sums keep one rule ---- */
{
  const after = (anchor, span = 2600) => { const i = staff.indexOf(anchor); return i < 0 ? "" : staff.slice(i, i + span); };
  const sumOf = (block) => (block.match(/`SELECT[^`]*?SUM\(days\)[^`]*?FROM leave_requests[^`]*?`/) ?? [""])[0].replace(/\s+/g, " ");
  const sites = {
    balance: sumOf(after('if (path === "/leave/balance" && method === "GET") {')),
    entitlements: sumOf(after('if (path === "/leave/entitlements" && method === "GET") {', 3000)),
    eligible: sumOf(after('if (path === "/leave/eligible" && method === "PUT") {', 2000)),
    payslip: sumOf(after("// Usage counted only up to the END of the payroll month", 600)),
  };
  for (const [k, sql] of Object.entries(sites)) {
    ok(`${k}: counts approved leave only`, /status = 'approved'/.test(sql), sql || "(not found)");
    ok(`${k}: counts the year by the day the leave starts`, /start_date LIKE \?\d \|\| '%'/.test(sql), sql);
    ok(`${k}: sums the days`, /COALESCE\(SUM\(days\), 0\)/.test(sql), sql);
    ok(`${k}: per type`, /type = \?\d|GROUP BY user_id, type/.test(sql), sql);
  }
  ok("only the payslip stops at its payroll month", /AND start_date <= \?4/.test(sites.payslip) && !/start_date <=/.test(sites.balance + sites.entitlements + sites.eligible));
  ok("each meets the one accrual (leaveAccrual)", ["/leave/balance", "/leave/entitlements", "/leave/eligible"].every((r) => /leaveAccrual\(/.test(after(`if (path === "${r}"`, 3600))) && /leaveAccrual\(/.test(after("// Usage counted only up to the END of the payroll month", 900)));
  ok("leaveAccrual is written once", (staff.match(/export function leaveAccrual\(/g) ?? []).length === 1);
}

/* ---- 2. one approval rule, one caller ---- */
{
  const dir = mkdtempSync(join(tmpdir(), "leave-"));
  const out = join(dir, "chain.mjs");
  execSync(`npx esbuild "${join(root, "worker/src/leave-chain.ts")}" --bundle --format=esm --platform=neutral --outfile="${out}" --log-level=error`, { cwd: root, stdio: "inherit" });
  const chain = await import(pathToFileURL(out).href);
  const list = (name) => [...((leave.match(new RegExp(`const ${name} = \\[([^\\]]*)\\]`)) ?? [])[1] ?? "").matchAll(/"([a-z_]+)"/g)].map((m) => m[1]).sort().join();
  ok("the page's HR stage is the worker's", list("HR") === [...chain.HR_STAGE_ROLES].sort().join(), list("HR"));
  ok("the page's pre-approvers are the worker's", list("PRE") === [...chain.PREAPP_ROLES].sort().join(), list("PRE"));
  ok("the page's final approvers are the worker's", list("FIN") === [...chain.FINAL_ROLES].sort().join(), list("FIN"));
  const approvers = [...((leave.match(/const canApprove = \[([^\]]*)\]/) ?? [])[1] ?? "").matchAll(/"([a-z_]+)"/g)].map((m) => m[1]).sort();
  const roles = ["super_admin", "admin", "editor", "marketing", "live_host", "hr_admin", "sales_marketing", "ceo", "coo", "cco"];
  ok("the roles that see the company board are leaveSeesAll's", JSON.stringify(approvers) === JSON.stringify(roles.filter((r) => chain.leaveSeesAll(r)).sort()), `${approvers}`);
  const walk = (d) => readdirSync(join(root, d), { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(join(d, e.name)) : e.name.endsWith(".tsx") ? [join(d, e.name)] : []);
  const callers = [...walk("components"), ...walk("app")].filter((f) => /api\(`\/staff\/leave\/\$\{[^}]+\}`,\s*\{\s*method: "PATCH"/.test(read(f)));
  ok("only the Leave page calls the decision route", !/staff\/leave\/\$\{/.test(strip(read("components/portal/leave-overview.tsx"))) && (leave.match(/api\(`\/staff\/leave\/\$\{(?:id|l\.id)\}`, \{\s*method: "PATCH"/g) ?? []).length === 2 && callers.length === 1 && /leave\.tsx$/.test(callers[0]), callers.join(", "));
}

/* ---- 3. the drawer only points ---- */
{
  const rel = strip(leave.slice(leave.indexOf("export function LeaveRelated("), leave.indexOf("export function leaveNoOf(")));
  ok("the related records are links, gated by the tab strip", /canOpen\("Staff Details"\) &&/.test(rel) && /canOpen\("Attendance"\) &&/.test(rel) && /\{canOpen\("Payroll"\) && \(/.test(rel) && /openRecord\("Staff Details", "staff", l\.user_id!\)/.test(rel));
  ok("…and carry no figure and make no request", !/\bapi\b|csrfFetch|_cents|RM \$|salary|net_pay|gross/.test(rel));
  const drawer = strip(leave.slice(leave.indexOf("THE LEAVE DETAILS DRAWER"), leave.lastIndexOf("</SideDrawer>")));
  ok("the drawer's decisions wait on you (the stage) and never on your own", /const waitsOnMe = d \? inProgress && canActOnStage\(user\.role, d\.stage \?\? "", d\.applicant_role \?\? ""\) && !own : false;/.test(drawer) && /\{waitsOnMe && \(/.test(drawer));
  ok("the override is the CEO's, the amend and remove the CEO's, the cancel your own", /\{!waitsOnMe && inProgress && canOverride && !own && \(/.test(drawer) && /\{canAmend && !inProgress && \(/.test(drawer) && /\{own && inProgress && <button/.test(drawer));
  ok("the drawer calls only the page's own functions", !/\bapi\(|csrfFetch/.test(drawer) && /act\(d\.id, "approve"\)/.test(drawer) && /overrideAct\(d, "approve"\)/.test(drawer) && /removeLeave\(d\)/.test(drawer));
  ok("the gates are the ones they were", /const canOverride = \["ceo", "super_admin"\]\.includes\(user\.role\);/.test(leave) && /const canAmend = \["ceo", "super_admin"\]\.includes\(user\.role\);/.test(leave));
  ok("the drawer sits outside every zone", leave.indexOf("THE LEAVE DETAILS DRAWER") > leave.lastIndexOf("</TabZone>"));
}

/* ---- 4. who is away, not why ---- */
ok("the Overview and the Team Calendar never draw a reason", !/\.reason\b/.test(strip(overview)));
ok("the register's lines do not print a reason (the drawer does, for those who open it)", !/\{l\.reason\}/.test(strip(leave.slice(leave.indexOf("const rows = all"), leave.indexOf("THE LEAVE DETAILS DRAWER")))));
ok("no sample figure or policy from the mockup", !/Nursyazwani|AZOOA0|Hospitalisation|View Leave Policy|Family Trip/.test(leave + overview));

ok("the guard is registered", /\["leave-module", "/.test(read("scripts/run-guards.mjs")));

console.log(`  ${passed} check(s) passed.`);
if (failed) { console.log(`\n${failed} check(s) failed.`); process.exit(1); }
