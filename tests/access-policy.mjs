/* ONE ACCESS POLICY (v1.234.0) - runtime guard: the real worker (staff.ts,
 * bundled) against SQLite with EVERY migration applied.
 *
 * The owner, 30-10-2026 (claude/USERS-ACCESS-AUDIT.md): "ONE AUTHORIZATION
 * SOURCE. ONE ROLE PERMISSION MANAGEMENT INTERFACE. NO CONFLICTING USER
 * OVERRIDES." Answers: keep per-user exceptions inside Roles & Permissions;
 * CEO, COO, Super Admin only for Mark paid, Release payslips and the payroll
 * bank run; the geofence stays in Users; build with the export.
 *
 *   1 the published policy IS the enforcement: for each money action, every
 *     role's direct request is allowed exactly when the policy says so
 *   2 the Admin account no longer marks paid, releases payslips or records
 *     the bank run; it keeps credit notes and refunds; the CCO is refused all
 *   3 an exception needs a reason, never draws a tab the server refuses,
 *     ends on its date, and is audited; old ones are reported, never deleted
 *   4 a stored grant never opens a server door
 *   5 the review is the CEO's, read-only, with history
 * Then mutated copies must each fail a check.
 *
 *   node tests/access-policy.mjs
 */
import { readFileSync, readdirSync, mkdtempSync, writeFileSync, cpSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";

const root = fileURLToPath(new URL("..", import.meta.url));
const bundle = (srcRoot, out) => execSync(`npx esbuild "${join(srcRoot, "worker/src/staff.ts")}" --bundle --format=esm --platform=neutral --outfile="${out}" --log-level=error`, { cwd: root, stdio: "inherit" });

async function runtime(staffBundle) {
  const out = [];
  const ok = (c, m, why = "") => out.push([!!c, why && !c ? `${m} - ${why}` : m]);
  const db = new DatabaseSync(":memory:");
  for (const f of readdirSync(join(root, "worker/migrations")).filter((x) => x.endsWith(".sql")).sort()) {
    for (const st of readFileSync(join(root, "worker/migrations", f), "utf8").split(/;\s*\n/)) { try { db.exec(st); } catch { /* a statement SQLite reads differently */ } }
  }
  const shim = (sql) => { const st = db.prepare(sql); let b = []; const o = {
    bind: (...a) => { b = a.map((x) => (x === undefined ? null : x)); return o; },
    first: async () => st.get(...b) ?? null, all: async () => ({ results: st.all(...b) }),
    run: async () => ({ meta: { changes: Number(st.run(...b).changes) } }), _run: () => st.run(...b) }; return o; };
  const env = { DB: { prepare: shim, batch: async (list) => { db.exec("BEGIN"); try { for (const s of list) s._run(); db.exec("COMMIT"); } catch (e) { db.exec("ROLLBACK"); throw e; } return []; } } };
  const ROLES = ["ceo", "coo", "cco", "hr_admin", "sales_marketing", "marketing", "editor", "live_host", "admin", "super_admin"];
  db.exec(`INSERT INTO users (id, name, email, role, is_active, password_hash, base_salary_cents) VALUES ${ROLES.map((r, i) => `(${i + 1},'${r}','${r}@x.t','${r}',1,'x',200000)`).join(",")}, (20,'Aina','aina@x.t','sales_marketing',1,'x',210000), (21,'Shop','shop@x.t','customer',1,'x',0)`);
  const ID = Object.fromEntries(ROLES.map((r, i) => [r, i + 1]));
  const roleOf = { ...Object.fromEntries(ROLES.map((r, i) => [i + 1, r])), 20: "sales_marketing", 21: "customer" };
  db.exec(`INSERT INTO customers (id, company, created_by) VALUES (1,'Kedai',20)`);
  const inv = db.prepare(`INSERT INTO sales_documents (id, doc_type, doc_number, customer_id, items, discount_cents, tax_percent, total_cents, payment_status, created_at, created_by, salesperson_id, kind) VALUES (?,'INV',?,1,'[{"name":"Live","qty":1,"unit_price_cents":10000}]',0,0,10000,'unpaid','2026-10-20 02:00:00',20,20,'service')`);
  for (let i = 0; i < 12; i++) inv.run(100 + i, `INV-${i}`);
  const RealDate = globalThis.Date; let fixed = new RealDate("2026-10-30T02:00:00Z").getTime();
  globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [fixed])); } static now() { return fixed; } };
  const { handleStaff } = await import(pathToFileURL(staffBundle).href + `?v=${Math.random()}`);
  const call = async (p, id, method = "GET", body) => {
    const r = await handleStaff(new Request(`https://x/api/v1/staff${p}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }), env, p.split("?")[0], { id, role: roleOf[id], name: roleOf[id] });
    return { status: r?.status ?? 404, j: r ? await r.json().catch(() => null) : null };
  };
  const meta = () => JSON.parse(db.prepare(`SELECT value FROM system_meta WHERE key = 'tab_access_people'`).get()?.value ?? "{}");

  try {
    /* 1 - the policy */
    ok((await call("/access/policy", ID.sales_marketing)).status === 403 && (await call("/access/policy", 21)).status === 403, "staff and customers cannot read the policy");
    const pol = await call("/access/policy", ID.cco);
    ok(pol.status === 200 && pol.j.roles.join() === ROLES.join(), "the CCO reads the policy (read-only)", JSON.stringify(pol.j?.roles));
    const act = (k) => pol.j?.actions.find((a) => a.key === k)?.roles ?? null;
    ok(act("confirm_paid")?.join() === "ceo,coo", "Confirm Paid: CEO and COO only", String(act("confirm_paid")));
    ok(act("mark_paid")?.join() === "ceo,coo,super_admin", "Mark paid: CEO, COO, super admin (Admin removed)", String(act("mark_paid")));
    ok(act("payroll_release")?.join() === "ceo,coo,super_admin" && act("bank_run")?.join() === "ceo,coo,super_admin", "Release payslips and the bank run: CEO, COO, super admin", `${act("payroll_release")} / ${act("bank_run")}`);
    ok(act("credit_refund")?.includes("admin"), "credit notes and refunds keep the Admin account (unchanged)");
    ok(!act("commission_decide")?.includes("cco") && !act("commission_approve")?.includes("cco"), "the CCO cannot decide or approve commission");
    ok(pol.j?.actions.every((a) => Array.isArray(a.roles)), "every published action resolves to a real role list");
    ok(pol.j?.tabs.find((t) => t.tab === "Payroll")?.reads?.join() === "ceo,coo,admin,super_admin", "the Payroll tab's server read rule is published");

    /* 1/2 - policy = enforcement, role by role, by direct request */
    let n = 0;
    for (const r of ROLES) {
      const id = ID[r];
      const mp = await call(`/docs/${100 + (n++ % 12)}`, id, "PATCH", { payment_status: "paid", paid_on: "2026-10-29" });
      ok((mp.status !== 403) === act("mark_paid").includes(r), `mark paid: ${r} ${act("mark_paid").includes(r) ? "allowed" : "refused"} as published`, String(mp.status));
      const rel = await call("/payroll/release", id, "POST", { month: "2026-09" });
      ok((rel.status !== 403) === act("payroll_release").includes(r), `release payslips: ${r} as published`, String(rel.status));
      if (rel.status !== 403) await call("/payroll/release", id, "POST", { month: "2026-09", undo: true });
      const bank = await call("/payroll/paid", id, "POST", { month: "2026-09" });
      ok((bank.status !== 403) === act("bank_run").includes(r), `payroll bank run: ${r} as published`, String(bank.status));
      const sw = await call("/commission/settings", id, "POST", { sync: "off", reason: "checking who may switch" });
      ok((sw.status !== 403) === act("commission_decide").includes(r), `commission switch: ${r} as published`, String(sw.status));
      const geo = await call("/attendance/geofence", id, "POST", { lat: 2.2, lng: 102.2, radius_m: 150 });
      ok((geo.status !== 403) === act("geofence").includes(r), `office geofence: ${r} as published`, String(geo.status));
    }
    const cn = await call("/docs/111/credit-note", ID.admin, "POST", { amount_cents: 100, reason: "Goodwill credit" });
    ok(cn.status !== 403, "the Admin account still issues a credit note", String(cn.status));
    const rel = (await call("/payroll?month=2026-09", ID.admin)).j?.release;
    ok(rel && rel.can_release === false && rel.can_record_paid === false, "the payroll screen tells the Admin account it cannot release or record the bank run", JSON.stringify(rel));
    ok((await call("/payroll?month=2026-09", ID.coo)).j?.release?.can_release === true, "...and tells the COO it can");

    /* 3 - exceptions */
    const person = (by, body) => call("/tabs/access/person", by, "POST", body);
    ok((await person(ID.coo, { user_id: 20, tab: "Sales", mode: "deny", reason: "COO tries an exception" })).status === 403, "only the CEO or super admin keeps exceptions");
    ok((await person(ID.ceo, { user_id: 20, tab: "Sales", mode: "deny" })).status === 400, "an exception needs a reason");
    ok((await person(ID.ceo, { user_id: 20, tab: "Sales", mode: "deny", reason: "Too short" })).status === 400, "...of at least 10 characters");
    const hollow = await person(ID.ceo, { user_id: ID.live_host, tab: "Payroll", mode: "allow", reason: "Wants to see payroll" });
    ok(hollow.status === 409 && hollow.j?.error?.code === "server_refuses", "an exception cannot draw a tab the server refuses the role", `${hollow.status} ${JSON.stringify(hollow.j)}`);
    ok((await person(ID.ceo, { user_id: 20, tab: "Sales", mode: "deny", reason: "Focus on hotels this month", expires_on: "2026-10-01" })).status === 400, "an end date in the past is refused");
    const d1 = await person(ID.ceo, { user_id: 20, tab: "Sales", mode: "deny", reason: "Focus on hotels this month", expires_on: "2026-11-15" });
    ok(d1.status === 200 && meta()["20"]?.meta?.Sales?.reason === "Focus on hotels this month" && meta()["20"].meta.Sales.by === ID.ceo, "a hide is stored with its reason, approver and end date", JSON.stringify(meta()["20"]));
    ok((await call("/tabs/access", 20)).j?.mine?.deny?.includes("Sales"), "the person's own strip applies it");
    ok((await call("/docs", 20)).status !== 403, "hiding a tab never changes what the server answers (it is not a permission)");
    ok(db.prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'tabs.person_access'`).get().n === 1, "the exception is audited");
    fixed = new RealDate("2026-11-20T02:00:00Z").getTime();
    ok(!(await call("/tabs/access", 20)).j?.mine?.deny?.includes("Sales") && meta()["20"]?.deny?.includes("Sales"), "after its end date it stops applying - and stays stored");
    fixed = new RealDate("2026-10-30T02:00:00Z").getTime();

    /* 4 - legacy entries: reported, never deleted; a stored grant opens nothing */
    const legacy = { ...meta(), [String(ID.live_host)]: { allow: ["Payroll"], deny: [] }, [String(ID.marketing)]: { allow: ["Sales"], deny: [] } };
    db.exec(`UPDATE system_meta SET value = '${JSON.stringify(legacy)}' WHERE key = 'tab_access_people'`);
    ok((await call("/payroll?month=2026-09", ID.live_host)).status === 403, "a stored Payroll grant never opens the payroll data");
    ok((await call("/access/review", ID.coo)).status === 403, "the access review is the CEO's");
    const rev = await call("/access/review", ID.ceo);
    const ex = (uid, tab) => rev.j?.exceptions?.find((x) => x.user_id === uid && x.tab === tab);
    ok(rev.status === 200 && ex(ID.live_host, "Payroll")?.verdict === "hollow" && ex(ID.live_host, "Payroll").needs_review, "an old grant the server refuses is reported hollow, needing review", JSON.stringify(ex(ID.live_host, "Payroll")));
    ok(ex(ID.marketing, "Sales")?.needs_review && ex(20, "Sales")?.reason === "Focus on hotels this month" && !ex(20, "Sales").needs_review, "old entries need review; new ones carry their reason");
    ok(rev.j?.people?.length >= 10 && !rev.j.people.some((p) => p.role === "super_admin") && rev.j.people.every((p) => Array.isArray(p.tabs)), "every current person's tab strip is in the export");
    ok(rev.j?.history?.some((h) => h.action === "tabs.person_access"), "the access history is in the export");
    ok(JSON.stringify(meta()) === JSON.stringify(legacy), "reading the review deletes and rewrites nothing");
    ok((await person(ID.ceo, { user_id: ID.live_host, tab: "Payroll", mode: "clear" })).status === 200 && !meta()[String(ID.live_host)], "a reviewed entry is removed only by the CEO's own press");
  } catch (e) {
    out.push([false, `runtime: ${e?.stack ?? e}`]);
  } finally {
    globalThis.Date = RealDate;
  }
  return out;
}

function source() {
  const out = [];
  const ok = (c, m) => out.push([!!c, m]);
  const read = (p) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");
  const perms = read("worker/src/permissions.ts");
  const staff = read("worker/src/staff.ts");
  const caps = new Set([...perms.matchAll(/^\s{2}([a-z_]+):\s*\[/gm)].map((m) => m[1]));
  const catCaps = [...perms.matchAll(/cap: "([a-z_]+)"/g)].map((m) => m[1]);
  ok(catCaps.length > 20 && catCaps.every((c) => caps.has(c)), "every catalogue capability exists in PERMS");
  ok(/Payroll: \(r\) => \["super_admin", "admin", "ceo", "coo"\]\.includes\(r\), \/\/ = PAYROLL_PROC/.test(staff) && /const PAYROLL_PROC = \["super_admin", "admin", "ceo", "coo"\];/.test(staff), "the Payroll read rule mirrors PAYROLL_PROC exactly");
  ok(/const canPay = \["super_admin", "ceo", "coo"\]\.includes\(user\.role\)/.test(read("components/portal/sales.tsx")), "the Sales screen offers Mark paid only to the CEO, COO and super admin");
  const users = read("components/portal/users-panel.tsx");
  ok(!/<AccessReviewCard/.test(users) && /<ExceptionsCard/.test(users) && /<AccessPolicyCard/.test(users), "Who sees what is gone from Security & Settings; exceptions live in Roles & Permissions");
  ok(/<GeofenceCard \/>/.test(users), "the office geofence stays in Users (the owner's answer)");
  ok(!/method: "(POST|PUT|PATCH|DELETE)"/.test(read("components/portal/access-policy.tsx").replace(/\/staff\/tabs\/access\/person", \{ method: "POST"/g, "")), "the policy view writes nothing except through the exceptions route");
  return out;
}

let fail = 0, n = 0;
const report = (list) => { for (const [p, m] of list) { n++; if (!p) { fail++; console.error(`FAIL ${m}`); } } };
const dir = mkdtempSync(join(tmpdir(), "accpol-"));
bundle(root, join(dir, "staff.mjs"));
report(await runtime(join(dir, "staff.mjs")));
report(source());

const MUT = [
  ["worker/src/permissions.ts", "the Admin account marks paid again", 'invoice_payment: ["super_admin", "ceo", "coo"],', 'invoice_payment: ["super_admin", "admin", "ceo", "coo"],'],
  ["worker/src/staff.ts", "the Admin account releases payslips again", 'export const PAYROLL_RELEASE_ROLES = ["super_admin", "ceo", "coo"];', 'export const PAYROLL_RELEASE_ROLES = ["super_admin", "admin", "ceo", "coo"];'],
  ["worker/src/staff.ts", "the bank-run check is dropped", 'if (!BANK_RUN_ROLES.includes(user.role)) return err("forbidden", "Only the CEO, COO or super admin records the payroll bank run", 403);', ""],
  ["worker/src/staff.ts", "the release check is dropped (policy no longer = enforcement)", 'if (!PAYROLL_RELEASE_ROLES.includes(user.role)) return err("forbidden", "Only the CEO, COO or super admin releases payslips", 403);', ""],
  ["worker/src/staff.ts", "a hollow exception is accepted", 'if (mode === "allow" && TAB_READ[tabName] && !TAB_READ[tabName]!(target.role)) {', "if (false) {"],
  ["worker/src/staff.ts", "an exception without a reason is accepted", 'if ((mode === "allow" || mode === "deny") && reasonX.length < 10)', "if (false)"],
  ["worker/src/staff.ts", "an ended exception keeps applying", "const liveEx = (p: PersonAccess, tab: string) => { const e = p.meta?.[tab]?.expires_on; return !e || e >= todayTA; };", "const liveEx = (_p: PersonAccess, _tab: string) => true;"],
];
for (const [file, name, from, to] of MUT) {
  n++;
  const src = readFileSync(join(root, file), "utf8");
  if (!src.includes(from)) { fail++; console.error(`FAIL mutation did not apply: ${name}`); continue; }
  const mdir = mkdtempSync(join(tmpdir(), "accpol-m-"));
  cpSync(join(root, "worker"), join(mdir, "worker"), { recursive: true, filter: (p) => !p.includes("node_modules") });
  cpSync(join(root, "package.json"), join(mdir, "package.json"));
  for (const d of ["lib", "constants", "types"]) { try { cpSync(join(root, d), join(mdir, d), { recursive: true }); } catch { /* not every folder exists */ } }
  writeFileSync(join(mdir, file), src.replace(from, to));
  try { bundle(mdir, join(mdir, "staff.mjs")); } catch { fail++; console.error(`FAIL mutation did not build: ${name}`); continue; }
  const res = await runtime(join(mdir, "staff.mjs"));
  if (!res.some(([p]) => !p)) { fail++; console.error(`FAIL mutation not caught: ${name}`); }
}
if (fail) { console.error(`access-policy: ${fail} of ${n} failed`); process.exit(1); }
console.log(`access-policy: ${n} checks passed (${MUT.length} mutations caught) - the published policy is the enforced one; exceptions with reasons, never wider than the server`);
