/* v1.45.0 — the authorization rules that the 27-08-2026 security audit found
   broken, turned into checks a build can fail.

   Every finding below was a RULE the code was supposed to follow, written in
   a comment, believed by everyone, and quietly not true:

     A1  only a super admin may mint authority — but ceo/coo/cco were
         creatable, resettable and offboardable by any admin, so an admin
         could issue themselves the money approvals the matrix denies them.
     A2  2FA is mandatory for every staff role — but nothing on the server
         ever refused a request for lacking it; the gate lived in the UI,
         where curl does not go.
     A3  "has 2FA" must mean ENABLED — but the flag read `totp_secret`, so
         merely STARTING setup and abandoning it cleared the requirement.
     S1  payroll writes belong to the payroll processors — but one route
         used a read permission (`payroll_export`) that also admits hr_admin
         and cco, the two roles deliberately removed from payroll.
     S2  a task's conversation belongs to the people on that task — but the
         comment routes checked nothing at all.
     S3  /content GET and POST lacked the gate their PATCH/DELETE siblings
         carry.

   A comment cannot fail a build. This file can.

   Run: node tests/authz-guard.mjs */
import { readFileSync } from "node:fs";

let failed = 0;
const fail = (msg) => { console.log(`FAIL ${msg}`); failed++; };
const ok = (msg) => console.log(`ok   ${msg}`);

const index = readFileSync("worker/src/index.ts", "utf8");
const staff = readFileSync("worker/src/staff.ts", "utf8");
const perms = readFileSync("worker/src/permissions.ts", "utf8");

/* ---- A1: executive roles are protected everywhere authority is minted ---- */
{
  const m = index.match(/const PROTECTED_ROLES: string\[\] = \[([^\]]*)\]/);
  if (!m) {
    fail("PROTECTED_ROLES is gone from index.ts — the admin→ceo escalation guard has been removed (AUDIT A1)");
  } else {
    const list = [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
    for (const role of ["super_admin", "admin", "ceo", "coo", "cco"]) {
      if (!list.includes(role)) {
        fail(`PROTECTED_ROLES no longer contains "${role}" — an admin could mint or take over that account (AUDIT A1)`);
      }
    }
    if (list.length >= 5) ok(`PROTECTED_ROLES covers every authority-bearing role (${list.length})`);
  }

  /* The four places that must consult it. Each was a real hole. */
  const sites = [
    [/PROTECTED_ROLES\.includes\(roleWantedC\)/, "POST /users (create) does not check PROTECTED_ROLES"],
    [/PROTECTED_ROLES\.includes\(target\.role\)[\s\S]{0,200}Only a super admin can modify/, "PATCH /users/:id does not protect executive targets"],
    [/PROTECTED_ROLES\.includes\(String\(body\.role \?\? ""\)\)/, "PATCH /users/:id does not protect executive role GRANTS"],
    [/PROTECTED_ROLES\.includes\(target\.role\)[\s\S]{0,200}offboarded by the super admin/, "the offboard route does not protect executive targets"],
  ];
  for (const [re, msg] of sites) if (!re.test(index)) fail(`${msg} (AUDIT A1)`);
  if (sites.every(([re]) => re.test(index))) ok("create / update / role-grant / offboard all consult PROTECTED_ROLES");

  /* The specific old shape must not come back. */
  if (/\["super_admin", "admin"\]\.includes\(target\.role\)/.test(index)) {
    fail('a user route still gates on ["super_admin","admin"].includes(target.role) — that is the exact hole A1 described');
  }
}

/* ---- A2: mandatory 2FA is enforced by the SERVER ---- */
{
  if (!/async function enforce2fa\(/.test(index)) {
    fail("enforce2fa() is gone — mandatory 2FA would again be a client-side suggestion (AUDIT A2)");
  } else if (!/twofaGate\s*\?\?\s*await route\(/.test(index) && !/if \(twofaGate\)/.test(index)) {
    fail("enforce2fa() exists but is never applied in the request path (AUDIT A2)");
  } else {
    ok("mandatory 2FA is enforced before routing");
  }
  /* The exemptions must stay minimal: enrolment, identity, sign-in, health.
     Anything else on that list would be a hole big enough to drive through. */
  const ex = index.match(/const TWOFA_EXEMPT_PREFIXES = \[([\s\S]*?)\];/);
  if (ex) {
    const list = [...ex[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
    const allowed = /^\/api\/v1\/(auth\/(2fa|me|logout|login|google)|health|setup)/;
    for (const p of list) {
      if (!allowed.test(p)) fail(`TWOFA_EXEMPT_PREFIXES contains "${p}" — that is not an enrolment or sign-in route (AUDIT A2)`);
    }
    if (list.every((p) => allowed.test(p))) ok(`the 2FA exemption list stays minimal (${list.length} entries)`);
  }
  if (!/MANDATORY_2FA_ROLES/.test(perms)) fail("MANDATORY_2FA_ROLES is gone from permissions.ts");
}

/* ---- A3: "has 2FA" means ENABLED, not "started setting up" ---- */
{
  if (/CASE WHEN u\.totp_secret IS NULL THEN 1 ELSE 0 END AS missing_2fa/.test(index)) {
    fail("missing_2fa is computed from totp_secret again — starting setup would clear the 2FA requirement without finishing it (AUDIT A3)");
  } else if (/COALESCE\(u\.totp_enabled, 0\) = 1 THEN 0 ELSE 1 END AS missing_2fa/.test(index)) {
    ok("the 2FA requirement is computed from totp_enabled");
  } else {
    fail("the missing_2fa computation has changed shape — re-check it against AUDIT A3 before editing this guard");
  }
}

/* ---- C6: a TOTP code is single-use ---- */
{
  if (!/async function totpVerifyOnce\(/.test(index)) {
    fail("totpVerifyOnce() is gone — TOTP codes would be replayable inside their window (AUDIT C6)");
  } else {
    const loginBurns = /let ok = await totpVerifyOnce\(env, ch\.user_id/.test(index);
    const enableBurns = /totpVerifyOnce\(env, me\.id/.test(index);
    if (!loginBurns) fail("the 2FA sign-in path no longer burns the code it accepts (AUDIT C6)");
    if (!enableBurns) fail("the 2FA enrolment path no longer burns the code it accepts (AUDIT C6)");
    if (loginBurns && enableBurns) ok("both 2FA paths consume the code they accept");
  }
}

/* ---- C5: a failed sign-in costs the same whether the email exists ---- */
{
  if (!/DUMMY_PASSWORD_HASH/.test(index)) {
    fail("DUMMY_PASSWORD_HASH is gone — an unknown email would answer faster than a wrong password, enumerating staff accounts (AUDIT C5)");
  } else ok("login timing is equalised for unknown emails");
}

/* ---- S1: every payroll WRITE uses the processor set ---- */
{
  /* Check the ROLES a gate actually admits, not the name it is spelled with.
     `/payroll/paid` legitimately gates on `expenses`, whose membership is
     identical to PAYROLL_PROC — naming is not the rule; who gets in is. So
     resolve every gate to its role set and require that set to be a subset of
     the payroll processors. That is what S1 was really about: `payroll_export`
     failed not because of its name but because it lets in hr_admin and cco. */
  const permSets = Object.fromEntries(
    [...perms.matchAll(/^\s{2}([a-z_]+):\s*\[([^\]]*)\]/gm)]
      .map(([, name, list]) => [name, [...list.matchAll(/"([^"]+)"/g)].map((x) => x[1])]),
  );
  const procM = staff.match(/const PAYROLL_PROC = \[([^\]]*)\]/);
  const PROC = new Set([...(procM?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((x) => x[1]));
  if (PROC.size === 0) fail("PAYROLL_PROC is gone from staff.ts — payroll's role set can no longer be checked (AUDIT S1)");

  const starts = [...staff.matchAll(/if \(path === "(\/payroll[^"]*)" && method === "(POST|PUT|PATCH|DELETE)"\)/g)];
  if (starts.length === 0) fail("authz-guard found no payroll write routes — the matcher needs updating WITH the code");
  let clean = 0;
  for (const m of starts) {
    const head = staff.slice(m.index, m.index + 1800);
    let admits = null;                                     // null = no gate found
    if (/PAYROLL_PROC(?:_CB)?\.includes\(user\.role\)/.test(head)) {
      admits = [...PROC];
    } else {
      const canM = head.match(/can\(user\.role, "([a-z_]+)"\)/);
      if (canM) admits = permSets[canM[1]] ?? [];
    }
    if (admits === null) {
      fail(`POST ${m[1]} has no permission gate at all (AUDIT S1)`);
      continue;
    }
    const extra = admits.filter((r) => !PROC.has(r));
    if (extra.length) {
      fail(`POST ${m[1]} is a payroll WRITE but its gate also admits ${extra.join(", ")} — outside the payroll processors (AUDIT S1)`);
    } else clean++;
  }
  if (clean === starts.length) ok(`every payroll write route (${starts.length}) admits only the payroll processors`);
}

/* ---- S2: task comments are scoped to the people on the task ---- */
{
  const hasScope = /const taskScopeOk = async \(taskId: string\)/.test(staff);
  const postChecks = /if \(commentMatch && method === "POST"\)[\s\S]{0,600}?await taskScopeOk\(/.test(staff);
  const getChecks = /if \(commentMatch && method === "GET"\)[\s\S]{0,300}?await taskScopeOk\(/.test(staff);
  if (!hasScope) fail("taskScopeOk() is gone — task comments would be readable and writable by any staff member (AUDIT S2)");
  if (!postChecks) fail("POST /tasks/:id/comments no longer checks task scope (AUDIT S2)");
  if (!getChecks) fail("GET /tasks/:id/comments no longer checks task scope (AUDIT S2)");
  if (hasScope && postChecks && getChecks) ok("task comments are scoped to assignee / creator / team manager");
}

/* ---- S3: /content GET and POST carry the same gate as PATCH/DELETE ---- */
{
  const contentStarts = [...staff.matchAll(/if \(path === "\/content" && method === "(GET|POST|PATCH|DELETE)"\)/g)];
  if (contentStarts.length === 0) fail("authz-guard found no /content routes — the matcher needs updating WITH the code");
  const ungated = contentStarts
    .filter((m) => !/CONTENT_MANAGE\.includes\(user\.role\)/.test(staff.slice(m.index, m.index + 600)))
    .map((m) => m[1]);
  if (ungated.length) fail(`/content ${ungated.join(", ")} lack the CONTENT_MANAGE gate their siblings have (AUDIT S3)`);
  else if (contentStarts.length) ok(`every /content route (${contentStarts.length}) checks CONTENT_MANAGE`);
}

/* ---- C7: the print flows escape what they interpolate ---- */
{
  const PRINTERS = [
    ["components/staff/staff-directory.tsx", "ID badges"],
    ["components/admin/hr-admin-panel.tsx", "attendance payslip"],
    ["components/portal/payroll-panel.tsx", "payslip"],
    ["components/portal/role-panels.tsx", "claim form"],
    ["app/portal/page.tsx", "leave form + statement of account"],
  ];
  for (const [file, what] of PRINTERS) {
    const src = readFileSync(file, "utf8");
    if (!/document\.write\(/.test(src)) continue;          // no longer builds HTML by hand
    if (!/from "@\/lib\/escape-html"/.test(src)) {
      fail(`${file} builds a print document with document.write but no longer imports esc() — the ${what} would render staff-typed markup as markup (AUDIT C7)`);
    }
  }
  ok("every hand-built print document imports the HTML escaper (or has stopped hand-building)");
}

if (failed) { console.error(`\n${failed} authorization check(s) failed.`); process.exit(1); }
console.log("\nauthz-guard: the rules the audit found broken are still fixed.");
