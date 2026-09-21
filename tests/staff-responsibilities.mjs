#!/usr/bin/env node
/* Guard #95 — v1.174.0: ROLES AND RESPONSIBILITIES on the Staff tab.
 *
 * The CEO, 21-09-2026: *"On the staff tabs, I want to add Roles and
 * Responsibilities of the staff that currently working for me. I need to make
 * sure that I can edit the roles and responsibilities in staff tabs."* He
 * chose a role title plus a list (one per line), written by the CEO and the
 * HR tier, read by everyone on the Staff tab and by the person on Profile.
 *
 * Five properties, each a way this could quietly go wrong:
 *
 *   1. ONE RULE, BOTH SIDES. PERMS.responsibilities_edit in the worker and the
 *      canEditResponsibilities the page passes are the SAME four roles - and
 *      the CEO is one of them (he asked to edit). coo / cco read only.
 *   2. ITS OWN DOOR, NO LOCK. The write is PUT /users/:id/responsibilities
 *      behind that permission - not a field on PATCH /users/:id, whose
 *      fill-once lock and 200-character cap are the wrong rules for a job
 *      description. Working staff only (409 for a leaver); the whole text is
 *      validated (30 lines, 200 chars each, title 120) and audited before/after.
 *   3. THE MIGRATION IS REGISTERED IN ALL THREE PLACES and is additive only;
 *      the list and profile reads have a skew rung of their own so the Staff
 *      tab never goes blank before 0137 applies.
 *   4. THE TAB SHOWS IT AND THE CEO CAN EDIT IT. The record card draws the
 *      block for working staff, the button is hidden when the viewer may not
 *      write, the editor is one title + one textarea (one per line), a toast
 *      on success AND refusal, the saved record shows without a refetch, and
 *      the summary tier counts who is written.
 *   5. THE PERSON READS IT. The Profile draws the read-only view from
 *      GET /profile, which now returns the columns.
 *
 * Negative-tested by: adding "coo" to responsibilities_edit (1 fails); moving
 * the write onto PATCH /users/:id (2 fails); dropping the is_active check
 * (2 fails); removing the 0137 probe (3 fails); removing canEdit from the
 * block (4 fails); dropping ResponsibilitiesView from profile.tsx (5 fails).
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");
let failed = 0, passed = 0;
const ok = (label, cond, why = "") => { if (cond) passed++; else { failed++; console.log(`  ✗ ${label}${why ? ` — ${why}` : ""}`); } };

const perms = read("worker/src/permissions.ts");
const staff = read("worker/src/staff.ts");
const index = read("worker/src/index.ts");
const page = read("app/portal/page.tsx");
const dir = read("components/staff/staff-directory.tsx");
const block = read("components/staff/responsibilities.tsx");
const blockCss = read("components/staff/responsibilities.module.css");
const profile = read("components/portal/profile.tsx");

/* ---- 1. one rule, both sides ---- */
const workerRoles = perms.match(/responsibilities_edit: \[([^\]]+)\]/)?.[1]?.match(/"[a-z_]+"/g)?.map((s) => s.slice(1, -1)) ?? [];
const pageRoles = page.match(/canEditResponsibilities=\{\[([^\]]+)\]\.includes\(user\.role\)\}/)?.[1]?.match(/"[a-z_]+"/g)?.map((s) => s.slice(1, -1)) ?? [];
const FOUR = ["super_admin", "admin", "hr_admin", "ceo"];
ok("responsibilities_edit is the HR tier the CEO chose: super_admin, admin, hr_admin, ceo", JSON.stringify([...workerRoles].sort()) === JSON.stringify([...FOUR].sort()), workerRoles.join(","));
ok("the page passes the SAME four roles", JSON.stringify([...pageRoles].sort()) === JSON.stringify([...workerRoles].sort()), pageRoles.join(","));
ok("the CEO can edit (he asked to)", workerRoles.includes("ceo") && pageRoles.includes("ceo"));
for (const r of ["coo", "cco", "sales_marketing", "live_host", "marketing", "editor", "customer"]) {
  ok(`${r} reads, never writes`, !workerRoles.includes(r));
}
ok("hr_manage is untouched (the CEO's other staff fields keep their rule)", /hr_manage: \["super_admin", "admin", "hr_admin", "ceo"\],/.test(perms));

/* ---- 2. its own door, no lock ---- */
const route = staff.slice(staff.indexOf('const respRoute = path.match(/^\\/users\\/(\\d+)\\/responsibilities$/);'), staff.indexOf('const reportsTo = path.match('));
ok("the route exists, PUT or PATCH on /users/:id/responsibilities", route.length > 200 && /if \(respRoute && \(method === "PUT" \|\| method === "PATCH"\)\)/.test(route));
ok("the route is behind responsibilities_edit", /if \(!can\(user\.role, "responsibilities_edit"\)\)/.test(route));
ok("working staff only - a leaver's record is refused with 409", /if \(!person\.is_active\) return err\("inactive", [^,]+, 409\);/.test(route));
ok("customers are not staff", /AND role <> 'customer'/.test(route));
ok("the title is capped at 120, each line at 200, the list at 30", /\.slice\(0, 120\)/.test(route) && /l\.length > 200/.test(route) && /lines\.length > 30/.test(route));
ok("blank lines and leading bullets are dropped, the same rule the client previews", /\.map\(\(l\) => l\.replace\(\/\^\\s\*\[-•\*\]\\s\*\/, ""\)\.trim\(\)\)\.filter\(Boolean\)/.test(route)
   && /\.map\(\(l\) => l\.replace\(\/\^\\s\*\[-•\*\]\\s\*\/, ""\)\.trim\(\)\)\.filter\(Boolean\)/.test(block));
ok("the whole text is written each time, with who and when", /UPDATE users SET role_title = \?1, responsibilities = \?2, responsibilities_updated_at = datetime\('now'\), responsibilities_updated_by = \?3 WHERE id = \?4/.test(route));
ok("the change is audited with the text before and after", /audit\(env, user\.id, "staff\.responsibilities_update", "users", String\(id\), \{[\s\S]*?role_title_before[\s\S]*?responsibilities_after/.test(route));
ok("a missing 0137 is a 503 that names the migration, never a 500", /err\("migration_pending", "Roles and responsibilities need migration 0137/.test(route));
const patchFields = staff.match(/const fields = \[([^\]]+)\] as const;/)?.[1] ?? "";
ok("PATCH /users/:id (the fill-once form) does NOT carry the new fields", !/role_title|responsibilities/.test(patchFields));

/* ---- 3. the migration, registered and additive ---- */
ok("migration 0137 exists", existsSync(join(root, "worker/migrations/0137_staff_responsibilities.sql")));
const mig = read("worker/migrations/0137_staff_responsibilities.sql");
for (const c of ["role_title TEXT", "responsibilities TEXT", "responsibilities_updated_at TEXT", "responsibilities_updated_by INTEGER"]) {
  ok(`0137 adds users.${c.split(" ")[0]}`, mig.includes(`ALTER TABLE users ADD COLUMN ${c};`));
}
ok("0137 is additive only", !/^\s*(?:DROP|DELETE|UPDATE|CREATE TABLE)\b/im.test(mig.replace(/^--.*$/gm, "")) && (mig.match(/^ALTER TABLE users ADD COLUMN/gm) ?? []).length === 4);
const latest = index.match(/const LATEST_MIGRATION = "(\d+)_/)?.[1] ?? "0";
ok("LATEST_MIGRATION is at or past 0137", Number(latest) >= 137, latest);
ok("EXPECTED_MIGRATIONS lists 0137 and the health probe reads the four columns", /"0137_staff_responsibilities",/.test(index)
   && /\["0137 \(roles and responsibilities on the staff record\)", `SELECT role_title, responsibilities, responsibilities_updated_at, responsibilities_updated_by FROM users LIMIT 1`\]/.test(index));
ok("GET /users has a skew rung of its own for 0137 (the Staff tab never goes blank)", /GET \/users: 0137 responsibilities columns missing/.test(staff)
   && /u\.role_title, u\.responsibilities, u\.responsibilities_updated_at,\s*\(SELECT w\.name FROM users w WHERE w\.id = u\.responsibilities_updated_by\) AS responsibilities_updated_by_name/.test(staff));
ok("GET /profile returns the columns, with its own skew rung", /GET \/profile: 0137 responsibilities columns missing/.test(staff)
   && /role_title, responsibilities, responsibilities_updated_at\s*FROM users WHERE id = \?1/.test(staff));

/* ---- 4. the tab shows it and the CEO can edit it ---- */
ok("the directory imports the block", /import \{ ResponsibilitiesBlock, responsibilityLines \} from "@\/components\/staff\/responsibilities";/.test(dir));
ok("the block is drawn for working staff (a leaver's text stays readable)", /\{open\.has\(u\.id\) && \(u\.is_active \|\| u\.role_title \|\| u\.responsibilities\) && \(\s*<ResponsibilitiesBlock/.test(dir));
ok("the button follows the permission AND the record being active", /canEdit=\{canEditResponsibilities && Boolean\(u\.is_active\)\}/.test(dir));
ok("the saved record shows at once and the view refetches behind it", /setStaff\(merge\); setAllStaff\(merge\); void load\(\);/.test(dir));
ok("the summary tier counts who is written, against the working headcount", /label=\{L\("Roles written", "Peranan ditulis"\)\} value=\{writtenCount\}/.test(dir) && /const writtenCount = staff\.filter\(\(u\) => u\.is_active && /.test(dir));
ok("the block hides the button it may not press", /\{canEdit && !editing && \(\s*<button type="button" className=\{btnSm\} onClick=\{open\}/.test(block));
ok("the editor is one title and one textarea, one responsibility per line", /<input className=\{inputClass\} value=\{title\} maxLength=\{RESPONSIBILITY_LIMITS\.title\}/.test(block)
   && /<textarea className=\{`\$\{textareaClass\} \$\{css\.textarea\}`\} value=\{text\}/.test(block) && /responsibilities: lines \}/.test(block));
ok("the write goes to the worker's own route", /`\/staff\/users\/\$\{userId\}\/responsibilities`,\s*\{ method: "PUT"/.test(block));
ok("a toast on success AND on refusal, and the text survives a failed save", /toast\(L\("Not saved", "Tidak disimpan"\), r\.data\?\.error\?\.message/.test(block) && /toast\(L\("Saved", "Disimpan"\)/.test(block) && !/setText\(""\)/.test(block));
ok("the client's limits are the worker's", /RESPONSIBILITY_LIMITS = \{ title: 120, line: 200, lines: 30 \}/.test(block));
ok("the block wears the shared classes and its own module, no utility class", /import css from "\.\/responsibilities\.module\.css";/.test(block)
   && !/className="(?:[^"]* )?(?:mt-\d|flex|grid|text-sm|gap-\d|space-y-\d)(?: [^"]*)?"/.test(block) && !/#[0-9a-fA-F]{3,6}\b/.test(blockCss) && /var\(--secondary\)/.test(blockCss));

/* ---- 5. the person reads it ---- */
ok("the Profile draws the read-only view from its own record", /import \{ ResponsibilitiesView \} from "@\/components\/staff\/responsibilities";/.test(profile)
   && /<ResponsibilitiesView loaded=\{loaded\}\s*value=\{\{ role_title: profile\.role_title, responsibilities: profile\.responsibilities, responsibilities_updated_at: profile\.responsibilities_updated_at \}\}/.test(profile));
ok("the Profile never writes it", !/responsibilities`, \{ method: "PUT"/.test(profile) && !/ResponsibilitiesBlock/.test(profile));
ok("the same view draws the list on both tabs", /export function ResponsibilitiesView\(/.test(block) && /<ResponsibilitiesView value=\{value\}/.test(block));

/* ---- registration ---- */
ok("the guard is registered", /\["staff-responsibilities", "/.test(read("scripts/run-guards.mjs")));

console.log(`  ${passed} check(s) passed.`);
if (failed) { console.log(`\n${failed} check(s) failed.`); process.exit(1); }
