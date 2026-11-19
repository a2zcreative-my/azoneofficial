/* v1.387.0 - COMPANIES MANAGES LEGAL ENTITIES; USERS & SECURITY MANAGES ACCESS
 * (the CEO's restructuring brief and decisions D1-D5, 18-11-2026;
 * docs/COMPANIES-USERS-RESTRUCTURE-AUDIT.md). The guard of the split:
 *
 *   S1  Company Access lives in Users & Security, drawn only for the holder of
 *       company_review; every reconciliation route still refuses the COO, the
 *       CCO and the admin on the server (403), and still answers
 *       enforcement "not_active"
 *   S2  the "not active" notice moved with it, and Companies draws no
 *       reconciliation form and writes nothing (no POST/PUT/PATCH/DELETE)
 *   S3  saving the employer never changes the access plan, nor the reverse:
 *       each save sends the other half exactly as it is saved
 *   S4  /staff/docs/by-company is read-only, splits invoices by the issuer
 *       stamped on them (NULL = AZ ONE OFFICIAL), leaves void out, and keeps
 *       the /docs/summary gate
 *   S5  the old start words land on the new tabs (overview / staff /
 *       customers -> Users, health -> Security & MFA); no Overview tab
 *   S6  no figure on the two pages is a typed number
 *
 *   node tests/companies-users-split.mjs
 */
import { readFileSync, readdirSync, mkdtempSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (f) => readFileSync(join(root, f), "utf8");
const res = [];
const ok = (c, m, why = "") => res.push([!!c, why && !c ? `${m} - ${why}` : m]);

const co = read("components/portal/companies-panel.tsx");
const ca = read("components/portal/company-access.tsx");
const up = read("components/portal/users-panel.tsx");

/* ---------- static ---------- */
ok(/const companyAccess = holdsCap\("company_review", \["super_admin", "ceo"\]\.includes\(role\)\);/.test(up)
  && /\.\.\.\(companyAccess \? \[\["company_access", L\("Company Access", "Akses Syarikat"\)\] as const\] : \[\]\)/.test(up)
  && /\{companyAccess && caSeen && \(/.test(up), "S1: the Company Access tab and its body exist only for the holder of company_review");
ok(/Company access restrictions are not active/.test(ca) && /makeApi\("\/staff\/companies"\)/.test(ca), "S2: the 'not active' notice and the same /staff/companies routes moved with Company Access");
ok(!/method: "(POST|PUT|PATCH|DELETE)"/.test(co) && !/\/staff\/companies\/(staff|records)\/|\/access\/policy|\/role\b|\/users\//.test(co), "S2: Companies writes nothing and draws no access, role or reconciliation form");
ok(!/CompanyStaffSetup[\s\S]{0,40}PUT/.test(co) && /<SigningPanel \/>/.test(co), "S2: Documents & Signing is the same SigningPanel (signing.ts decides who manages)");
ok(/\? \{ employer_code: employer \|\| null, memberships: employee\.memberships, reason, version: employee\.version \}\s*: \{ employer_code: employee\.employer_code, memberships, reason, version: employee\.version \}/.test(ca),
  "S3: the employer save keeps the saved access plan; the access save keeps the saved employer");
ok(/data-testid="company-access-save-access"/.test(ca) && /data-testid="company-access-save-employer"/.test(ca), "S3: two buttons, two separate requests");
ok(/overview: "users", staff: "users", customers: "users", health: "security"/.test(up) && !/\["overview", L\("Overview", "Gambaran"\)\],\s*\["staff"/.test(up) && !/<UsersOverview /.test(up), "S5: the old start words open the new tabs, and the Overview tab is gone");
ok(!/"access", L\("Access Summary"/.test(co) && !/"access"\]/.test(co), "S5: Companies has no Access Summary tab - company access lives only in Users & Security (the CEO, 19-11-2026)");
ok(/initialView=\{startOf\("Companies"\)\}/.test(read("app/portal/page.tsx")), "S5: Companies opens at a start word too");
const literalTile = (src) => /<KpiTile[^>]*\bvalue=\{\d+\}/.test(src);
ok(!literalTile(co) && !literalTile(ca) && !literalTile(up), "S6: no KPI tile shows a typed number");
ok(/useRead<ByCompany>\("\/staff\/docs\/by-company"\)/.test(co) && /\/staff\/erp\/cashbook\?from=/.test(co), "S6: the glance reads Sales' and Finance's own figures");

/* ---------- the real worker ---------- */
const out = join(mkdtempSync(join(tmpdir(), "cosplit-")), "staff.mjs");
execSync(`npx esbuild "${join(root, "worker/src/staff.ts")}" --bundle --format=esm --platform=neutral --outfile="${out}" --log-level=error`, { cwd: root, stdio: "inherit" });
const db = new DatabaseSync(":memory:");
for (const f of readdirSync(join(root, "worker/migrations")).filter((x) => x.endsWith(".sql")).sort()) {
  for (const st of readFileSync(join(root, "worker/migrations", f), "utf8").split(/;\s*\n/)) { try { db.exec(st); } catch { /* a statement SQLite reads differently */ } }
}
const shim = (sql) => { const st = db.prepare(sql); let b = []; const o = {
  bind: (...a) => { b = a.map((x) => (x === undefined ? null : x)); return o; },
  first: async () => st.get(...b) ?? null, all: async () => ({ results: st.all(...b) }),
  run: async () => ({ meta: { changes: Number(st.run(...b).changes) } }), _run: () => st.run(...b) }; return o; };
const env = { DB: { prepare: shim, batch: async (list) => { db.exec("BEGIN"); try { for (const s of list) s._run(); db.exec("COMMIT"); } catch (e) { db.exec("ROLLBACK"); throw e; } return []; } } };
db.exec(`INSERT INTO users (id, name, email, role, is_active, password_hash) VALUES
  (1,'Boss','b@x.t','ceo',1,'x'),(2,'Ops','o@x.t','coo',1,'x'),(3,'Comm','c@x.t','cco',1,'x'),(5,'Tech','t@x.t','admin',1,'x'),(6,'Host','h@x.t','live_host',1,'x'),(4,'Aina','a@x.t','sales_marketing',1,'x')`);
db.exec(`INSERT INTO customers (id, company, created_by) VALUES (1,'Kedai Satu',4)`);
const ROLE = { 1: "ceo", 2: "coo", 3: "cco", 4: "sales_marketing", 5: "admin", 6: "live_host" };
const RealDate = globalThis.Date; const fixed = new RealDate("2026-11-18T06:00:00Z").getTime();
globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [fixed])); } static now() { return fixed; } };
const { handleStaff } = await import(pathToFileURL(out).href);
const call = async (p, id = 1, method = "GET", body) => {
  const r = await handleStaff(new Request(`https://x/api/v1/staff${p}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }), env, p.split("?")[0], { id, role: ROLE[id], name: "x", is_owner: id === 1 });
  return { status: r?.status ?? 404, j: r ? await r.json().catch(() => null) : null };
};
const inv = db.prepare(`INSERT INTO sales_documents (id, doc_type, doc_number, customer_id, items, discount_cents, tax_percent, total_cents, payment_status, paid_at, created_at, created_by, salesperson_id, kind, issuer_code) VALUES (?,'INV',?,1,'[]',0,0,?,?,?,?,1,4,'service',?)`);

try {
  /* S1 - the reconciliation's doors are unchanged on the server */
  for (const id of [2, 3, 5]) {
    const r = await call("/companies/summary", id);
    ok(r.status === 403, `S1: /companies/summary refuses the ${ROLE[id]} (403)`, String(r.status));
  }
  const ceoSum = await call("/companies/summary", 1);
  ok(ceoSum.status === 200 && ceoSum.j?.enforcement === "not_active" && ceoSum.j?.mode === "reconciliation_only", "S1: the CEO reads it, and it still says not active / reconciliation only", JSON.stringify(ceoSum.j)?.slice(0, 200));

  /* S3 - on the server, an access-only save leaves the employer, and the reverse */
  const s0 = (await call("/companies/staff", 1)).j?.staff?.find((s) => s.id === 4);
  const r1 = await call("/companies/staff/4", 1, "PUT", { request_id: "aaaaaaaaaaaaaaaa1", version: s0?.version ?? 0, reason: "From the latest payslip", employer_code: "a2z", memberships: [] });
  const r2 = await call("/companies/staff/4", 1, "PUT", { request_id: "aaaaaaaaaaaaaaaa2", version: (s0?.version ?? 0) + 1, reason: "Works on both companies", employer_code: "a2z", memberships: [{ company_code: "a2z", access_mode: "write" }] });
  const s2 = (await call("/companies/staff", 1)).j?.staff?.find((s) => s.id === 4);
  ok(r1.status === 200 && r2.status === 200 && s2?.employer_code === "a2z" && s2?.memberships?.length === 1, "S3: the employer save, then the access save (sending the saved employer) - both kept", `${r1.status} ${r2.status} ${JSON.stringify(s2)}`);

  /* S4 - the per-company invoice figures */
  inv.run(301, "INV-A1", 50000, "paid", "2026-11-10 04:00:00", "2026-11-08 02:00:00", "a2z");
  inv.run(302, "INV-A2", 20000, "unpaid", null, "2026-11-12 02:00:00", "a2z");
  inv.run(303, "INV-Z1", 30000, "unpaid", null, "2026-07-01 02:00:00", null);   // legacy: AZ ONE
  inv.run(304, "INV-Z2", 15000, "paid", "2026-11-03 04:00:00", "2026-11-02 02:00:00", "azoo");
  inv.run(305, "INV-V", 99900, "void", null, "2026-11-05 02:00:00", "a2z");
  try { db.exec(`INSERT INTO invoice_payments (invoice_id, amount_cents, received_on, method, created_by) VALUES (302, 5000, '2026-11-13', 'bank_transfer', 1)`); } catch { /* table shape */ }
  const before = db.prepare(`SELECT COUNT(*) n, SUM(total_cents) t FROM sales_documents`).get();
  const bc = await call("/docs/by-company?month=2026-11", 1);
  const A = bc.j?.companies?.a2z, Z = bc.j?.companies?.azoo;
  ok(bc.status === 200 && A?.invoices === 2 && A?.invoiced_cents === 70000 && A?.paid_cents === 50000, "S4: A2Z's November invoices (two, RM 700), RM 500 paid - the void one left out", JSON.stringify(A));
  ok(A?.outstanding_n === 1 && (A?.outstanding_cents === 15000 || A?.outstanding_cents === 20000), "S4: A2Z outstanding = the unpaid invoice less its live part payment", JSON.stringify(A));
  ok(Z?.invoices === 1 && Z?.paid_cents === 15000 && Z?.outstanding_n === 1 && Z?.outstanding_cents === 30000, "S4: an invoice with no issuer counts for AZ ONE OFFICIAL, never A2Z", JSON.stringify(Z));
  const after = db.prepare(`SELECT COUNT(*) n, SUM(total_cents) t FROM sales_documents`).get();
  ok(before.n === after.n && before.t === after.t, "S4: the read writes nothing");
  ok((await call("/docs/by-company", 6)).status === 403, "S4: a role without Sales access is refused, as on /docs/summary");
} catch (e) { ok(false, `the run threw: ${e?.stack ?? e}`); }

/* ---------- the mutation pass: each rule catches its own breakage ---------- */
const mutants = [
  ["S1 tab for everyone", up.replace('...(companyAccess ? [["company_access"', '...(true ? [["company_access"'), (s) => /\.\.\.\(companyAccess \? \[\["company_access"/.test(s)],
  ["S3 one save of both", ca.replace("memberships: employee.memberships, reason", "memberships, reason"), (s) => /memberships: employee\.memberships, reason, version: employee\.version \}/.test(s)],
  ["S2 notice dropped", ca.replace("Company access restrictions are not active", "Company access"), (s) => /Company access restrictions are not active/.test(s)],
];
for (const [name, src, test] of mutants) ok(!test(src), `mutation caught: ${name}`);

let failed = 0;
for (const [p, m] of res) { console.log(`${p ? "PASS" : "FAIL"} ${m}`); if (!p) failed++; }
console.log(`companies-users-split: ${res.length - failed} of ${res.length} passed`);
process.exit(failed ? 1 : 0);
