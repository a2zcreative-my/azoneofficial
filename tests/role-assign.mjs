/**
 * THE ROLE ON THE STAFF RECORD — guard #78, v1.157.0.
 *
 * The CEO, 13-09-2026, on a staff record: *"I want to have a roles assigned
 * for me to assigned her role. this is only visible for CEO and COO to update
 * the roles"*.
 *
 * A role is the door list - it decides which tabs a person sees and which
 * register measures them - so the properties below are about who may change
 * it and what they may change it TO, not about markup:
 *
 *   1. THE TWO THE CEO NAMED. PERMS.role_assign is exactly ceo and coo, and
 *      the client's ROLE_ASSIGN_ROLES is the same list, so the control and
 *      the door agree (the server is the authority either way).
 *   2. WORKING ROLES ONLY. What they may hand out is the five working roles.
 *      The executive roles, customer and the admin tier are still the
 *      super_admin's alone (v1.4.157) - both to ASSIGN and to TOUCH - so a
 *      compromised executive sign-in cannot promote itself, demote another
 *      executive, or turn a stranger's Google sign-up into staff.
 *   3. NEVER YOURSELF. The self-change refusal is still in the route.
 *   4. AUDITED. staff.role_change carries from, to, who (by_role) and the
 *      optional reason.
 *   5. ONLY THEY SEE IT. The control renders behind canSetRole and is not
 *      part of Save (the COO is read-only on the record's fields, and a role
 *      is not a field). An executive account shows it locked.
 *   6. A CONFIRMATION THAT NAMES BOTH ROLES, in both languages.
 *
 * Negative-tested by: adding "cco" to role_assign (1); adding "ceo" to the
 * route's WORKING_ROLES (2); removing the self_change line (3); dropping
 * by_role from the audit (4); removing the canSetRole condition (5).
 *
 * Run: node tests/role-assign.mjs
 */
import { readFileSync } from "node:fs";
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

const perms = read("worker/src/permissions.ts");
const staff = read("worker/src/staff.ts");
const tree = read("lib/org-tree.ts");
const dir = read("components/staff/staff-directory.tsx");
const route = staff.slice(staff.indexOf('path.match(/^\\/users\\/(\\d+)\\/role$/)'), staff.indexOf("/attendance/geofence"));

/* ---- 1. the two the CEO named ---- */
{
  const server = list(perms, /role_assign: \[([^\]]*)\]/);
  const client = list(tree, /export const ROLE_ASSIGN_ROLES: readonly string\[\] = \[([^\]]*)\]/);
  ok("PERMS.role_assign is exactly ceo and coo", JSON.stringify(server) === JSON.stringify(["ceo", "coo"]), server.join(","));
  ok("the client's ROLE_ASSIGN_ROLES is the same list", JSON.stringify(client) === JSON.stringify(server), client.join(","));
  ok("the route reads that permission", /can\(user\.role, "role_assign"\)/.test(route));
}

/* ---- 2. working roles only ---- */
{
  const working = list(route, /const WORKING_ROLES = \[([^\]]*)\]/);
  const clientWorking = list(tree, /export const WORKING_ROLES: readonly string\[\] = \[([^\]]*)\]/);
  ok("the route's working roles are the five", JSON.stringify(working) === JSON.stringify(["editor", "hr_admin", "live_host", "marketing", "sales_marketing"]), working.join(","));
  ok("the client offers the same five", JSON.stringify(clientWorking) === JSON.stringify(working), clientWorking.join(","));
  ok("an executive may assign only those", /const ASSIGNABLE = executive\s*\?\s*WORKING_ROLES/.test(route));
  ok("the super_admin still has the executive and customer roles", /\[\.\.\.WORKING_ROLES, "ceo", "coo", "cco", "customer"\]/.test(route));
  ok("an executive may not touch an executive, customer or admin account", /if \(executive && !WORKING_ROLES\.includes\(target\.role\)\)/.test(route) && /\["super_admin", "admin"\]\.includes\(target\.role\)/.test(route));
  ok("nobody else gets in", /if \(user\.role !== "super_admin" && !executive\)/.test(route));
}

/* ---- 3 + 4. never yourself, and audited ---- */
{
  ok("you cannot change your own role", /if \(id === user\.id\) return err\("self_change"/.test(route));
  ok("the change is audited with from, to, who and the reason", /"staff\.role_change"/.test(route) && /from: target\.role, to: newRole/.test(route) && /by_role: user\.role/.test(route) && /\.\.\.\(reason \? \{ reason \} : \{\}\)/.test(route));
  ok("the reason is bounded", /body\.reason\.trim\(\)\.slice\(0, 300\)/.test(route));
}

/* ---- 5 + 6. only they see it, and a confirmation that names both roles ---- */
{
  ok("the control renders only for ROLE_ASSIGN_ROLES", /const canSetRole = ROLE_ASSIGN_ROLES\.includes\(role\);/.test(dir) && /sec\.title === "Employment" && canSetRole && \(/.test(dir));
  ok("it is its own route, not a field of Save", /`\/users\/\$\{u\.id\}\/role`/.test(dir) && !/\["role", /.test(dir.slice(dir.indexOf("const RECORD_SECTIONS"), dir.indexOf("const RECORD_FIELDS"))));
  ok("an executive account shows it locked", /disabled=\{!WORKING_ROLES\.includes\(u\.role\)\}/.test(dir));
  ok("the confirmation names both roles, in both languages", /\$\{roleLabel\(u\.role\)\} → \$\{roleLabel\(next\)\}\. This changes which tabs/.test(dir) && /Tukar peranan \$\{displayName\(u\)\}\?/.test(dir));
  ok("and asks for an optional reason", /Reason \(optional\)/.test(dir) && /reason: r\.value/.test(dir));
}

/* ---- 7. the super admin's choice wins (CEO, 13-09-2026: "it is supposed to
   Live Host instead of Live Host Part Time!") - a personal email no longer
   forces part time on any of the three doors; the alias still does; a plain
   role lifts a part-time account to permanent on the Users page; the admin
   tier still needs a company email. ---- */
{
  const index = read("worker/src/index.ts");
  const admin = read("app/admin/page.tsx");
  const patch = index.slice(index.indexOf("v1.157.0 - THE SUPER ADMIN'S CHOICE WINS"), index.indexOf("revoke-sessions"));
  ok("PATCH /users/:id no longer forces part time by email", !/if \(!companyMail\) forcePartTime = true/.test(patch) && !/forcePartTime\b/.test(patch));
  ok("...the alias still means part time", /if \(isPartTimeAlias\) \{\s*await env\.DB\.prepare\(`UPDATE users SET role = \?1, employment_status = 'part_time'/.test(patch));
  ok("...a plain role lifts a part-time account to permanent", /target\.employment_status === "part_time"\) \{\s*await env\.DB\.prepare\(`UPDATE users SET role = \?1, employment_status = 'permanent'/.test(patch));
  ok("...and the admin tier still needs a company email", /Admin-tier roles require an @\$\{env\.COMPANY_DOMAIN\} email/.test(patch));
  ok("POST /users forces part time only for the alias", /const forcePartTimeC = isPartTimeAliasC;/.test(index));
  ok("the staff route honours the status given and forces nothing by email", /const status = newStatus;/.test(route) && !/Personal-email promotion/.test(route) && !/status = "part_time"/.test(route));
  ok("the Users page says what happens to the status before it happens", /status becomes permanent/.test(admin) && /status becomes part time/.test(admin) && /\$\{statusNote\}/.test(admin));
}

console.log(failed === 0
  ? `role-assign: ${passed} checks passed.`
  : `\n${failed} role-assign check(s) failed.`);
process.exitCode = failed === 0 ? 0 : 1;
