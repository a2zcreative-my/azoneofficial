/* OWNER COVERAGE (v1.236.0) - static guard: the CEO can no longer lose a
 * door by accident when a permission is added.
 *
 * The owner's brief, 30-10-2026 (claude/CEO-OWNER-ACCESS-AUDIT.md): "The CEO
 * should not unexpectedly lose access whenever a new permission is added" -
 * and "Do not grant unsupported actions solely because a role has a high
 * rank." So nothing is granted automatically: every capability, and every
 * named role list in the worker, that the super admin holds and the CEO does
 * not must be CLASSIFIED once, on purpose - in permissions.ts OWNER_GRANTS
 * (the verified owner holds it) or TECHNICAL_ONLY (with its reason), or, for
 * an approval-chain stage, in CHAIN_STAGES below (the owner: do not modify
 * the Leave, Claims, Tasks or Payroll chains). Also: no rank check against
 * the super admin survives (each door has a name the matrix can show), and
 * every owner grant has a row in the published policy.
 * Then mutated copies must each fail a check.
 *
 *   node tests/owner-coverage.mjs
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");
const CHAIN_STAGES = {
  "leave-chain.ts:HR_STAGE_ROLES": "Leave and claims HR stage - the CEO is the final approver, chains unchanged",
  "leave-chain.ts:PREAPP_ROLES": "Leave pre-approval stage - the CEO is the final approver, chains unchanged",
};

function check(files) {
  const out = [];
  const ok = (c, m) => out.push([!!c, m]);
  const perms = files["permissions.ts"];
  const block = perms.slice(perms.indexOf("export const PERMS"), perms.indexOf("\n};", perms.indexOf("export const PERMS")));
  const caps = Object.fromEntries([...block.matchAll(/^\s{2}([a-z_]+):\s*\[([^\]]*)\]/gm)].map((m) => [m[1], [...m[2].matchAll(/"([a-z_]+)"/g)].map((x) => x[1])]));
  const grants = [...(perms.match(/export const OWNER_GRANTS[^=]*=\s*\[([^\]]*)\]/)?.[1] ?? "").matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
  const techBlock = perms.match(/export const TECHNICAL_ONLY[^=]*=\s*\{([\s\S]*?)\n\};/)?.[1] ?? "";
  const tech = Object.fromEntries([...techBlock.matchAll(/^\s+([a-z_]+):\s*"([^"]*)"/gm)].map((m) => [m[1], m[2]]));
  ok(Object.keys(caps).length > 50, `PERMS parsed (${Object.keys(caps).length} capabilities)`);
  ok(grants.length >= 3 && Object.keys(tech).length >= 3, "OWNER_GRANTS and TECHNICAL_ONLY parsed");
  const unclassified = Object.entries(caps).filter(([k, r]) => r.includes("super_admin") && !r.includes("ceo") && !grants.includes(k) && !(k in tech)).map(([k]) => k);
  ok(unclassified.length === 0, `every super-admin capability the CEO lacks is classified (unclassified: ${unclassified.join(", ") || "none"})`);
  ok(grants.every((g) => g in caps) && Object.keys(tech).every((t) => t in caps), "every classified name is a real capability");
  ok(!grants.some((g) => g in tech), "nothing is both an owner grant and technical only");
  ok(Object.values(tech).every((why) => why.trim().length >= 20), "every technical-only capability says why");
  ok(!grants.includes("owner_designate") && !grants.includes("backup_download"), "the owner never names the owner nor downloads the credential backup");
  const catCaps = [...perms.matchAll(/cap: "([a-z_]+)"/g)].map((m) => m[1]);
  ok(grants.every((g) => catCaps.includes(g)), "every owner grant has a row in the published policy");
  /* named role lists across the worker */
  const strays = [];
  for (const [f, src] of Object.entries(files)) {
    if (f === "permissions.ts") continue;
    for (const m of src.matchAll(/(?:export )?const ([A-Z][A-Z_]+)(?::[^=]*)?\s*=\s*\[([^\]]*)\]/g)) {
      const list = [...m[2].matchAll(/"([a-z_]+)"/g)].map((x) => x[1]);
      if (list.includes("super_admin") && !list.includes("ceo") && !CHAIN_STAGES[`${f}:${m[1]}`]) strays.push(`${f}:${m[1]}`);
    }
  }
  ok(strays.length === 0, `every named role list the super admin holds without the CEO is classified (unclassified: ${strays.join(", ") || "none"})`);
  const rank = Object.entries(files).filter(([, src]) => /atLeast\(\s*user\s*,\s*"super_admin"\s*\)/.test(src)).map(([f]) => f);
  ok(rank.length === 0, `no rank check against the super admin survives (found in: ${rank.join(", ") || "none"})`);
  ok(/owner_grant: ownerGrant/.test(files["staff.ts"] ?? "") && /OWNER_GRANTS\.includes\(a\.cap\)/.test(files["staff.ts"] ?? ""), "the policy endpoint publishes the owner's grants from OWNER_GRANTS");
  ok(/export function allows\(/.test(perms) && /actor\.is_owner === true && actor\.role === "ceo" && OWNER_GRANTS\.includes\(perm\)/.test(perms), "allows() adds OWNER_GRANTS only for a verified owner who holds the ceo role");
  return out;
}

const load = () => Object.fromEntries(readdirSync(join(root, "worker/src")).filter((f) => f.endsWith(".ts")).map((f) => [f, read(`worker/src/${f}`)]));
let fail = 0, n = 0;
for (const [p, m] of check(load())) { n++; if (!p) { fail++; console.error(`FAIL ${m}`); } }
const checks = n;
const MUT = [
  ["permissions.ts", "a new super-admin-only capability is added unclassified", "  backup_download: [\"super_admin\"],", "  backup_download: [\"super_admin\"],\n  new_admin_tool: [\"super_admin\"],"],
  ["permissions.ts", "an owner grant loses its policy row", 'cap: "tech_admin_grant"', 'cap: "role_any"'],
  ["index.ts", "a rank check against the super admin comes back", 'if (!user || !allows(user, "backup_download"))', 'if (!user || !atLeast(user, "super_admin"))'],
  ["leave-chain.ts", "a new named list leaves the CEO out", "export const FINAL_ROLES", 'export const NEW_GATE_ROLES = ["super_admin", "admin"];\nexport const FINAL_ROLES'],
  ["permissions.ts", "a technical-only capability loses its reason", "content_manage: \"The website editor", "content_manage: \"\", x_: \"The website editor"],
  ["permissions.ts", "the owner gets the credential backup", '["exec_accounts", "role_any", "tech_admin_grant"]', '["exec_accounts", "role_any", "tech_admin_grant", "backup_download"]'],
];
for (const [file, name, from, to] of MUT) {
  n++;
  const files = load();
  if (!files[file]?.includes(from)) { fail++; console.error(`FAIL mutation did not apply: ${name}`); continue; }
  files[file] = files[file].replace(from, to);
  if (!check(files).some(([p]) => !p)) { fail++; console.error(`FAIL mutation not caught: ${name}`); }
}
if (fail) { console.error(`owner-coverage: ${fail} of ${n} failed`); process.exit(1); }
console.log(`owner-coverage: ${checks} checks passed (${MUT.length} mutations caught) - every super-admin door is either the verified owner's or technical only, on purpose`);
