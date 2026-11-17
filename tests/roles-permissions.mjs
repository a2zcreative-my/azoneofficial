#!/usr/bin/env node
/* v1.331.0 - ROLES & PERMISSIONS, A ROLE AT A TIME (the CEO, 17-11-2026:
   "REPLACE LEGACY ROLES & PERMISSIONS UI ... Role changes must be persisted
   and actually enforced, not simulated in the UI").

   What this holds, in the source:
     R1  the route draws the new editor, and the old wide matrix, the "Who sees
         each tab" fold and the stacked exceptions zone are gone from it
     R2  a permission is saved ONLY through POST /staff/access/policy with the
         step-up code, a reason of 10+ and {cap, roles} per changed cell
     R3  a locked cell (LOCKED_CELLS) never gets a switch: the screen's rule is
         the server's rule
     R4  the verbs only GROUP the server's catalogue: every key named exists in
         ACTION_CATALOGUE, and a switch changes catalogue caps, nothing else
     R5  Assign a user is the existing role door (POST /staff/users/:id/role,
         step-up, reason 10+); the screen decides nothing about who may
     R6  v1.350.0 (the CEO's "A2Z OS - CUSTOM ROLE MANAGEMENT"): the built-in
         roles stay fixed; + Create Role and the custom role's Edit / Duplicate
         / Deactivate / Delete are drawn only for role_custom (the CEO and the
         super admin, can_manage_custom from the server) and write only through
         /staff/access/custom-roles with the step-up code; a custom role's
         switches are the same cells through the same POST /staff/access/policy
     R7  the connected strip has its five figures, CEO Access worked out from
         the published cells (never a written-in "Equivalent")
     R8  the directory and the editor are one 35:65 split held to the screen
     R9  an address that opens on the view reads the policy
     R10 tokens, --type-* roles, house breakpoints and named grid tracks only
   Each rule is proven to catch its own breakage (the mutation pass).

     node tests/roles-permissions.mjs     (NOMUT=1 skips the mutation pass) */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");
const FILES = {
  rp: "components/portal/roles-permissions.tsx", rpc: "components/portal/roles-permissions.module.css",
  users: "components/portal/users-panel.tsx", ap: "components/portal/access-policy.tsx",
  perms: "worker/src/permissions.ts", ws: "components/ui/workspace-split.tsx", wsc: "components/ui/workspace-split.module.css",
};

function checks(src) {
  const res = [];
  const ok = (name, cond, detail = "") => res.push([name, Boolean(cond), detail]);
  const { rp, rpc, users, ap, perms, ws, wsc } = src;
  const rolesView = users.slice(users.indexOf('<div hidden={view !== "roles"}'), users.indexOf('<div hidden={view !== "security"}'));
  /* R1 */
  ok("R1 the roles view draws RolesPermissions, with the exceptions and tab visibility handed in as drawers",
    /<RolesPermissions policy=\{policy\}/.test(rolesView) && /exceptions=\{holds \? \(\s*<ExceptionsCard bare /.test(rolesView) && /tabVisibility=\{<TabAccessCard /.test(rolesView));
  ok("R1 the old matrix, the 'Who sees each tab' fold and the stacked exceptions zone are gone",
    !/<AccessPolicyCard|function AccessPolicyCard|function ModuleRows|function EditCell/.test(users + ap) && !/sees-editor|<details/.test(rolesView) && !/Exceptions and accounts/.test(rolesView) && !/Access policy matrix/.test((rp + ap).replace(/\/\*[\s\S]*?\*\//g, "")));
  /* R2 */
  ok("R2 one write: POST /staff/access/policy through withStepUp, {cap, roles} per changed cell, the reason",
    /withStepUp<[^>]*>\(\s*\(totp\) => api\("\/staff\/access\/policy", \{ method: "POST", body: JSON\.stringify\(\{ \.\.\.body, \.\.\.\(totp \? \{ totp \} : \{\}\) \}\) \}\)/.test(rp)
    && /send\(\{ changes: pending\.map\(\(\[cap, r\]\) => \(\{ cap, roles: r \}\)\), reason: reason\.trim\(\) \}/.test(rp)
    && (rp.match(/method: "(POST|PUT|PATCH|DELETE)"/g) ?? []).length === 1);
  ok("R2 Save waits for a reason of 10 characters", /disabled=\{busy \|\| reason\.trim\(\)\.length < 10 \|\| pending\.length === 0\}/.test(rp));
  ok("R2 after a save the caps are read again from /auth/me and the policy reloads (nothing assumed)", /api<\{ user: \{ caps\?: string\[\] \} \}>\("\/auth\/me"\)\.then\(\(m\) => \{ if \(m\.ok && m\.data\) setCaps\(m\.data\.user\.caps\); \}\);\s*onChanged\(\);/.test(rp));
  /* R3 */
  ok("R3 a locked cell never gets a switch (super_admin_only for everyone, the super admin's own keeps cell)",
    /return a\.locked\.rule === "super_admin_only" \|\| role === "super_admin";/.test(rp) && /const editableFor = \(a: PolicyAction, role: string\) => !!a\.cap && !!a\.editable && !cellLocked\(a, role\);/.test(rp)
    && /for \(const a of list\) if \(editableFor\(a, r\)\)/.test(rp) && /canEditRole && editableFor\(a, role\)/.test(rp)
    && /if \(a\.custom_forbidden && isCustomRole\(role\)\) return true;/.test(rp)
    && /rule: "super_admin_only" \| "super_admin_keeps"/.test(perms));
  /* R4 */
  const catKeys = new Set([...perms.slice(perms.indexOf("export const ACTION_CATALOGUE")).matchAll(/key: "([a-z_]+)"/g)].map((m) => m[1]));
  const verbBlock = rp.slice(rp.indexOf("const VERB_OF"), rp.indexOf("export const verbOf"));
  const named = [...verbBlock.matchAll(/([a-z_]+): "(view|create|edit|approve|delete|export|manage)"/g)].map((m) => m[1]);
  const stale = named.filter((k) => !catKeys.has(k));
  ok("R4 every action the verbs name exists in the server's ACTION_CATALOGUE (nothing invented)", named.length >= 50 && stale.length === 0, stale.join(", "));
  ok("R4 a switch changes catalogue caps only (out[a.cap!]), from the published actions", /out\[a\.cap!\] = setFor\(a\.cap!, out\[a\.cap!\] \?\? current\(a\.cap!\), r, on\)/.test(rp) && /\(d0\?\.actions \?\? \[\]\)\.map/.test(rp));
  /* R5 */
  ok("R5 Assign a user = the existing role door, with the step-up code and a reason of 10+",
    /const assignRole = async \(u: Account, to: string\): Promise<boolean> => \{/.test(users) && /if \(!why \|\| why\.value\.trim\(\)\.length < 10\) return false;/.test(users)
    && /\(totp\) => api\(`\/staff\/users\/\$\{u\.id\}\/role`, \{ method: "POST", body: JSON\.stringify\(\{ role: to, /.test(users) && /onAssign=\{assignRole\}/.test(rolesView));
  ok("R5 the role door is offered only to the owner / super admin (canEdit), the server deciding each change", /canAssign=\{canEdit\}/.test(rolesView) && /const mayAssign = cr \? canManageCustom && crActive : canAssign && assignable\.includes\(role\);/.test(rp));
  /* R6 */
  ok("R6 + Create Role sits in the Role Directory heading, drawn only for role_custom (can_manage_custom, the server's answer)",
    /const canManageCustom = !!d0\?\.can_manage_custom;/.test(rp) && /actions=\{canManageCustom \? <button type="button" className=\{btnAccent\} onClick=\{\(\) => openForm\("create"\)\} data-testid="role-create">/.test(rp)
    && /\{canManageCustom && \(\s*<div className=\{css\.inline\} data-testid="cr-actions">/.test(rp));
  ok("R6 every custom-role change goes to /staff/access/custom-roles with the step-up code; nothing else writes a role",
    /\(totp\) => api\(`\/staff\/access\/custom-roles\$\{path\}`, \{ method, body: JSON\.stringify\(\{ \.\.\.body, \.\.\.\(totp \? \{ totp \} : \{\}\) \}\) \}\)/.test(rp)
    && (rp.match(/api\(`\/staff\/access\/custom-roles/g) ?? []).length === 1 && /disabled=\{busy \|\| delReason\.trim\(\)\.length < 10\}/.test(rp));
  /* R7 */
  ok("R7 the strip: Total Roles, Assigned Users, Modules Controlled, Edited Permissions, CEO Access",
    ['cell="roles"', 'cell="assigned"', 'cell="modules"', 'cell="edited"', 'cell="ceo"'].every((c) => rp.includes(c)) && /<KpiRow label=/.test(rp));
  ok("R7 CEO Access is worked out from the published cells (what the super admin holds that the CEO does not)",
    /const saOnly = acts\.filter\(\(a\) => a\.roles\.includes\("super_admin"\) && !a\.roles\.includes\("ceo"\)\);/.test(rp) && /value=\{gapActs\.length === 0 \? L\("Equivalent"/.test(rp));
  /* R8 */
  ok("R8 one 35:65 split (the directory, the editor), held to the screen from 1024px",
    /<WorkspaceSplit testid="roles-split" ratio="35-65">/.test(rp) && /"35-65"/.test(ws) && /\.r35_65 > \* \{ flex-grow: 35; \}\s*\.r35_65 > \* \+ \* \{ flex-grow: 65; \}/.test(wsc));
  /* R9 */
  ok("R9 an address that opens on Roles & Permissions reads the policy", /const rolesOn = seenRoles \|\| view === "roles";\s*const policy = usePolicy\(rolesOn, policyTick\);/.test(users));
  ok("R10 a switch is the house Switch (components/ui/switch.tsx), never a private track", /import \{ Switch \} from "@\/components\/ui\/switch";/.test(rp) && /<Switch checked=\{st === "on"\} mixed=/.test(rp) && !/\.(track|thumb|toggle)\b/.test(rpc));
  /* R10 */
  ok("R10 tokens and --type-* only, house breakpoints, every grid names its tracks",
    !/#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(rpc) && (rpc.match(/@media \(([^)]+)\)/g) ?? []).every((m) => /prefers-reduced-motion|min-width: (640|768|1024|1280)px|max-width: (639|767|1023|1279)px/.test(m))
    && !/font-size: \d/.test(rpc) && !/border-radius: \d/.test(rpc) && !/grid-template-columns: (?!minmax\(0,|repeat\(\d, minmax\(0,)/.test(rpc));
  return res;
}

const base = Object.fromEntries(Object.entries(FILES).map(([k, p]) => [k, read(p)]));
const res = checks(base);
let failed = res.filter(([, c]) => !c);
for (const [n, c, d] of res) if (!c) console.log(`  ✗ ${n}${d ? `  [${d}]` : ""}`);

const MUT = [
  ["the old matrix back", "ap", "export function ExceptionsCard(", "export function AccessPolicyCard() { return null; }\nexport function ExceptionsCard("],
  ["the exceptions stacked on the page again", "users", '<TabZone label={L("Roles & Permissions", "Peranan & Kebenaran")}>', '<TabZone label={L("Exceptions and accounts", "Pengecualian dan akaun")}>'],
  ["a save without the code", "rp", "(totp) => api(\"/staff/access/policy\", { method: \"POST\", body: JSON.stringify({ ...body, ...(totp ? { totp } : {}) }) })", "() => api(\"/staff/access/policy\", { method: \"POST\", body: JSON.stringify(body) })"],
  ["a save without a reason", "rp", "disabled={busy || reason.trim().length < 10 || pending.length === 0}", "disabled={busy || pending.length === 0}"],
  ["a locked cell switchable", "rp", "const editableFor = (a: PolicyAction, role: string) => !!a.cap && !!a.editable && !cellLocked(a, role);", "const editableFor = (a: PolicyAction, _role: string) => !!a.cap && !!a.editable;"],
  ["a verb invents an action", "rp", '  task_delete: "delete",', '  task_delete: "delete", role_create: "manage",'],
  ["the role door bypassed", "users", "(totp) => api(`/staff/users/${u.id}/role`, { method: \"POST\", body: JSON.stringify({ role: to, ", "() => api(`/staff/users/${u.id}/role`, { method: \"PATCH\", body: JSON.stringify({ role: to, "],
  ["Create Role for everyone", "rp", 'actions={canManageCustom ? <button type="button" className={btnAccent}', 'actions={true ? <button type="button" className={btnAccent}'],
  ["a custom role change without the code", "rp", "(totp) => api(`/staff/access/custom-roles${path}`, { method, body: JSON.stringify({ ...body, ...(totp ? { totp } : {}) }) })", "() => api(`/staff/access/custom-roles${path}`, { method, body: JSON.stringify(body) })"],
  ["a custom role switched on a protected cell", "rp", "  if (a.custom_forbidden && isCustomRole(role)) return true;", ""],
  ["CEO Access written in", "rp", 'value={gapActs.length === 0 ? L("Equivalent", "Setara")', 'value={true ? L("Equivalent", "Setara")'],
  ["the split back to 60:40", "rp", '<WorkspaceSplit testid="roles-split" ratio="35-65">', '<WorkspaceSplit testid="roles-split">'],
  ["a deep link reads nothing", "users", "const policy = usePolicy(rolesOn, policyTick);", "const policy = usePolicy(seenRoles, policyTick);"],
  ["a private switch track", "rpc", ".cellSwitch {", ".track { display: block; }\n.cellSwitch {"],
  ["a hex colour", "rpc", ".gain { color: var(--success); }", ".gain { color: #15803d; }"],
];
let caught = 0;
for (const [name, file, from, to] of (process.env.NOMUT === "1" ? [] : MUT)) {
  if (!base[file].includes(from)) { console.log(`  ✗ mutation anchor missing: ${name}`); failed = [...failed, [name]]; continue; }
  const r = checks({ ...base, [file]: base[file].replace(from, to) });
  if (r.some(([, c]) => !c)) caught++;
  else { console.log(`  ✗ mutation NOT caught: ${name}`); failed = [...failed, [name]]; }
}
if (failed.length) { console.log(`\nroles-permissions: ${failed.length} failed`); process.exit(1); }
console.log(`roles-permissions: ${res.length} checks passed (${caught} mutations caught)`);
