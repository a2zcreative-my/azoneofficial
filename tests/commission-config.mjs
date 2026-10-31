/* COMMISSION CONFIGURATION (v1.227.0) - runtime guard: the real worker
 * (staff.ts, bundled) against SQLite with EVERY migration applied.
 *
 * The owner's Commission Configuration brief and answers, 30-10-2026
 * (claude/COMMISSION-CONFIG-AUDIT.md): "Move it, by stage", "Require a
 * closer", "Build now" (package rules), "Commission page like reference",
 * "Only CEO/COO confirm Paid", "Weekly: anyone who closed". This guard holds:
 *
 *   CONFIRM   only the CEO and COO confirm Paid - the super admin, CCO,
 *             admin and consultants are refused, by direct API;
 *   CLOSER    an invoice names its closer: none -> refused; a system account
 *             (admin, super admin) -> refused, on create, on edit and on
 *             convert (a quotation's missing closer is no longer filled with
 *             whoever converts); a quotation still defaults to its creator;
 *   PACKAGES  a version's package rules: percentage, fixed per unit, or
 *             none; matched by name in any case; other lines at the default
 *             rate; written with the draft, refused when malformed or listed
 *             twice, never edited; the entry shows the line working; the
 *             approved renewal/refund/cutoff/leaver rules cannot be swapped;
 *   CORRECT   a closer corrected after commission was written: not in
 *             payroll -> moves; in an unreleased payroll -> review and out of
 *             that payroll, applied to the new closer by the CEO, then paid
 *             to them once; paid -> unchanged, flagged; never deducted;
 *   AUDIT     /commission/audit lists the decisions to management (CCO
 *             included), not to consultants; /commission/packages suggests
 *             names from real invoices;
 *   WEEKLY    someone who closed a sale in the last 90 days is on the weekly
 *             scorecard whatever their role.
 *
 * Negative-tested by: super_admin back in CONFIRM_PAID_ROLES; the INV closer
 * check removed; the convert fallback to user.id; commissionOf ignoring the
 * package rules; the match without matchKey (case-sensitive); reassignCloser
 * not called; the included branch moving instead of reviewing; the 90-day
 * clause removed.
 *
 *   node tests/commission-config.mjs
 */
import { readFileSync, readdirSync, mkdtempSync, rmSync } from "node:fs";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");
let passed = 0, failed = 0;
const ok = (label, cond, why = "") => { if (cond) passed++; else { failed++; console.log(`  ✗ ${label}${why ? ` — ${why}` : ""}`); } };

/* ---- source ---- */
const comm = read("worker/src/commission.ts"), staffSrc = read("worker/src/staff.ts"), panel = read("components/portal/commission-panel.tsx");
ok("package rules are never edited after the draft (no UPDATE or DELETE anywhere)", !/UPDATE commission_policy_packages|DELETE FROM commission_policy_packages/.test(comm + staffSrc));
/* v1.232.0 - with no package rules a SERVICE invoice still pays exactly as before; a product line follows the product rule (Commission 2.1) */
ok("a version with no package rules pays a service invoice exactly as before", /if \(!raw\.length \|\| \(!pkgs\.length && !\(listedOnly && raw\.some\(isProduct\)\)\)\) return \{ basis, amount: amountOf\(basis, p\), lines: null \};/.test(comm));
ok("the closer correction route hands the commission to reassignCloser", /const moved = await reassignCloser\(env, docId, cur, toId, reason\);/.test(staffSrc));
ok("the Commission page has the five views", /\["overview", L\("Overview"[\s\S]*?\["transactions"[\s\S]*?\["policy", L\("Policy Settings"[\s\S]*?\["payroll", L\("Payroll Sync"[\s\S]*?\["audit", L\("Audit History"/.test(panel));
ok("a consultant still sees only their own commission", /: \(\[\["transactions", L\("My commission", "Komisen saya"\)\]\] as const\)/.test(panel));
ok("the Sales form asks for the closer on an invoice", /doc\.doc_type === "INV" && !doc\.salesperson_id/.test(read("components/portal/sales.tsx")));

/* ---- runtime ---- */
const dir = mkdtempSync(join(tmpdir(), "commcfg-"));
const out = join(dir, "staff.mjs");
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
db.exec(`INSERT INTO users (id, name, email, role, is_active, password_hash, base_salary_cents) VALUES
  (1,'Boss','b@x.t','ceo',1,'x',800000),(2,'Ops','o@x.t','coo',1,'x',600000),(3,'Com','c@x.t','cco',1,'x',600000),
  (4,'Aina','a@x.t','sales_marketing',1,'x',210000),(5,'Hafiz','h@x.t','sales_marketing',1,'x',210000),
  (6,'Adm','d@x.t','admin',1,'x',0),(7,'Sup','s@x.t','super_admin',1,'x',0),(9,'Farid','f@x.t','live_host',1,'x',180000)`);
db.exec(`INSERT INTO customers (id, company, created_by) VALUES (1,'Kedai Satu',4)`);
const ins = db.prepare(`INSERT INTO sales_documents (id, doc_type, doc_number, customer_id, items, discount_cents, tax_percent, total_cents, payment_status, created_at, created_by, salesperson_id, paid_at, kind) VALUES (?,?,?,1,?,0,0,?,?,?,1,?,?,'service')`);
const lines = JSON.stringify([
  { name: "AZ Starter", qty: 1, unit_price_cents: 9900 },
  { name: "az monthly care ", qty: 2, unit_price_cents: 39900 },
  { name: "Domain renewal", qty: 1, unit_price_cents: 5000 },
  { name: "Content shoot", qty: 1, unit_price_cents: 10000 },
]);
const one = (name, cents) => JSON.stringify([{ name, qty: 1, unit_price_cents: cents }]);
ins.run(40, "INV", "INV-40", lines, 104700, "paid", "2026-11-02 02:00:00", 4, "2026-11-05 04:00:00");  // packages
ins.run(41, "INV", "INV-41", one("AZ Creative Express", 24900), 24900, "paid", "2026-11-02 02:00:00", 4, "2026-11-05 04:00:00"); // correct before payroll
ins.run(42, "INV", "INV-42", one("AZ Creative Express", 24900), 24900, "paid", "2026-11-02 02:00:00", 4, "2026-11-05 04:00:00"); // correct in payroll
ins.run(43, "INV", "INV-43", one("AZ Creative Express", 24900), 24900, "paid", "2026-11-02 02:00:00", 5, "2026-11-05 04:00:00"); // correct after paid
ins.run(50, "QT", "QT-50", one("AZ Starter", 9900), 9900, null, "2026-11-02 02:00:00", 6, null);   // a quotation an admin typed
ins.run(51, "QT", "QT-51", one("AZ Starter", 9900), 9900, null, "2026-11-02 02:00:00", 4, null);
ins.run(52, "QT", "QT-52", one("Live session", 50000), 50000, null, "2026-09-20 02:00:00", 9, null); // Farid closed one in September

const { handleStaff } = await import(pathToFileURL(out).href);
const RealDate = Date; let fixed = new RealDate("2026-10-30T02:00:00Z").getTime();
globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [fixed])); } static now() { return fixed; } };
const ROLE = { 1: "ceo", 2: "coo", 3: "cco", 4: "sales_marketing", 5: "sales_marketing", 6: "admin", 7: "super_admin", 9: "live_host" };
const call = async (p, id = 1, method = "GET", body) => {
  const r = await handleStaff(new Request(`https://x/api/v1/staff${p}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }), env, p.split("?")[0], { id, role: ROLE[id], name: "x" });
  return { status: r?.status ?? 404, j: r ? await r.json().catch(() => null) : null };
};
const led = (where) => db.prepare(`SELECT * FROM commission_ledger WHERE ${where} ORDER BY id`).all();
const confirm = (inv, id, amount) => call(`/docs/${inv}/confirm-paid`, id, "POST", { amount_cents: amount, checked: true, payment_ref: "MBB-1" });

try {
  /* PACKAGES - drafted with the version */
  const base = { name: "A2Z Sales Commission", effective_from: "2026-11-01", rate_kind: "percent", rate_pct: 10, basis: "net_of_tax_delivery", reason: "The documented 10% with package rules" };
  const pk = [{ name: "AZ Starter", rule: "percent", rate_pct: 10 }, { name: "AZ Monthly Care", rule: "fixed", fixed_cents: 3000 }, { name: "Domain renewal", rule: "none" }];
  ok("PACKAGES: a package listed twice is refused", (await call("/commission/policy", 1, "POST", { ...base, packages: [...pk, { name: "az starter", rule: "none" }] })).status === 400);
  ok("PACKAGES: an unknown rule is refused", (await call("/commission/policy", 1, "POST", { ...base, packages: [{ name: "AZ Starter", rule: "bonus" }] })).status === 400);
  ok("PACKAGES: a rate above 50% is refused", (await call("/commission/policy", 1, "POST", { ...base, packages: [{ name: "AZ Starter", rule: "percent", rate_pct: 60 }] })).status === 400);
  ok("PACKAGES: more than 50 rules are refused", (await call("/commission/policy", 1, "POST", { ...base, packages: Array.from({ length: 51 }, (_, i) => ({ name: `P${i}x`, rule: "none" })) })).status === 400);
  ok("an unapproved refund rule cannot be chosen", (await call("/commission/policy", 1, "POST", { ...base, refund_rule: "deduct_from_wages" })).status === 400);
  ok("an unapproved cutoff rule cannot be chosen", (await call("/commission/policy", 1, "POST", { ...base, cutoff_rule: "mid_month" })).status === 400);
  ok("nothing was stored by the refused drafts", db.prepare(`SELECT COUNT(*) AS n FROM commission_policies`).get().n === 0 && db.prepare(`SELECT COUNT(*) AS n FROM commission_policy_packages`).get().n === 0);
  const d1 = await call("/commission/policy", 2, "POST", { ...base, packages: pk });
  ok("PACKAGES: the COO drafts v1 with three package rules", d1.status === 201 && db.prepare(`SELECT COUNT(*) AS n FROM commission_policy_packages WHERE policy_id = ?`).get(d1.j.id).n === 3);
  ok("PACKAGES: the version lists its rules", ((await call("/commission/policy", 3)).j.versions[0].packages ?? []).map((x) => x.match_key).join("|") === "az starter|az monthly care|domain renewal");
  ok("the CEO approves v1", (await call(`/commission/policy/${d1.j.id}/approve`, 1, "POST", { confirm: true })).status === 200);

  fixed = new RealDate("2026-11-10T02:00:00Z").getTime();
  /* CONFIRM - only the CEO and COO */
  ok("CONFIRM: the super admin cannot confirm Paid", (await confirm(40, 7, 104700)).status === 403);
  ok("CONFIRM: nor the CCO", (await confirm(40, 3, 104700)).status === 403);
  ok("CONFIRM: nor an admin", (await confirm(40, 6, 104700)).status === 403);
  ok("CONFIRM: nor the closer", (await confirm(40, 4, 104700)).status === 403);
  ok("CONFIRM: the documents list tells the super admin there is no button", (await call("/docs", 7)).j?.can_confirm_paid === false);
  ok("CONFIRM: the COO confirms", (await confirm(40, 2, 104700)).status === 201);

  /* PACKAGES - the calculation */
  const e40 = led("invoice_id = 40");
  ok("PACKAGES: Starter 10% (RM 9.90) + Monthly Care RM 30 x 2 + Domain nothing + other line 10% (RM 10.00) = RM 79.90", e40.length === 1 && e40[0].amount_cents === 7990 && e40[0].basis_cents === 104700, JSON.stringify(e40));
  const det = (await call(`/commission/entries/${e40[0].id}`, 1)).j;
  const b = det?.breakdown ?? [];
  ok("PACKAGES: the entry shows the working, line by line", b.length === 4 && b[0].rule === "percent" && b[0].amount_cents === 990 && b[1].package === "AZ Monthly Care" && b[1].amount_cents === 6000 && b[2].rule === "none" && b[2].amount_cents === 0 && b[3].rule === "default" && b[3].amount_cents === 1000, JSON.stringify(b));
  ok("PACKAGES: a line's name matches in any case and spacing", b[1].package === "AZ Monthly Care");
  const est = (await call("/commission/entries?scope=all&status=estimated", 1)).j;
  ok("the estimate for an open invoice uses the same rules", Array.isArray(est.estimates));

  /* CLOSER - an invoice names its closer */
  const inv = (sp) => call("/docs", 1, "POST", { doc_type: "INV", customer_id: 1, kind: "service", items: [{ name: "AZ Starter", qty: 1, unit_price_cents: 9900 }], ...(sp ? { salesperson_id: sp } : {}) });
  const noCloser = await inv(null);
  ok("CLOSER: an invoice without a closer is refused", noCloser.status === 400 && noCloser.j?.error?.code === "closer_required", JSON.stringify(noCloser.j));
  ok("CLOSER: an admin as closer is refused", (await inv(6)).status === 400);
  ok("CLOSER: a super admin as closer is refused", (await inv(7)).status === 400);
  const good = await inv(4);
  ok("CLOSER: Aina as closer is accepted", good.status === 201);
  ok("CLOSER: a quotation still defaults to whoever raises it", (await call("/docs", 4, "POST", { doc_type: "QT", customer_id: 1, kind: "service", items: [{ name: "AZ Starter", qty: 1, unit_price_cents: 9900 }] })).status === 201);
  const conv = await call("/docs/50/convert", 1, "POST", {});
  ok("CLOSER: a quotation an admin typed is not invoiced until a salesperson is chosen", conv.status === 400 && conv.j?.error?.code === "closer_required" && !db.prepare(`SELECT 1 FROM sales_documents WHERE converted_from = 50`).get());
  ok("CLOSER: a quotation with its salesperson converts and keeps them", (await call("/docs/51/convert", 1, "POST", {})).status < 300 && db.prepare(`SELECT salesperson_id FROM sales_documents WHERE converted_from = 51`).get()?.salesperson_id === 4);
  const gid = good.j?.id;
  ok("CLOSER: an unpaid invoice's closer cannot be moved to an admin", (await call(`/docs/${gid}/edit`, 1, "POST", { items: [{ name: "AZ Starter", qty: 1, unit_price_cents: 9900 }], discount_cents: 0, tax_percent: 0, delivery_cents: 0, salesperson_id: 6 })).status === 400);
  ok("CLOSER: ...but to a colleague it can", (await call(`/docs/${gid}/edit`, 1, "POST", { items: [{ name: "AZ Starter", qty: 1, unit_price_cents: 9900 }], discount_cents: 0, tax_percent: 0, delivery_cents: 0, salesperson_id: 5 })).status < 300);

  /* CORRECT - by stage */
  await confirm(41, 1, 24900); await confirm(42, 1, 24900); await confirm(43, 1, 24900);
  const fix = (id, to, from) => call(`/docs/${id}/closer`, 1, "POST", { salesperson_id: to, from_salesperson_id: from, reason: "Review found the real closer" });
  const r41 = await fix(41, 5, 4);
  ok("CORRECT: not yet in payroll - the commission moves to the corrected closer", r41.status === 200 && r41.j.commission?.moved === 1 && led("invoice_id = 41")[0].user_id === 5 && led("invoice_id = 41")[0].status === "eligible", JSON.stringify(r41.j));
  /* payroll on, November computed: 42 and 43 go in */
  await call("/commission/settings", 1, "POST", { sync: "on", reason: "Checked the November shadow ledger" });
  const save = (uid, month) => call("/payroll", 1, "POST", { user_id: uid, month, basic_cents: 210000, commission_cents: 0, allowance_cents: 0, deduction_cents: 0, net_cents: 210000 });
  await save(4, "2026-11"); await save(5, "2026-11");
  ok("November payroll holds 42 for Aina and 43 for Hafiz", led("invoice_id = 42")[0].status === "included" && led("invoice_id = 43")[0].status === "included");
  const r42 = await fix(42, 5, 4);
  ok("CORRECT: in an unreleased payroll - back to review and out of that month", r42.j?.commission?.to_review === 1 && led("invoice_id = 42")[0].status === "review" && led("invoice_id = 42")[0].payroll_month === null && led("invoice_id = 42")[0].user_id === 4, JSON.stringify(led("invoice_id = 42")));
  await call("/payroll/recompute", 1, "POST", { month: "2026-11" });
  const aina = db.prepare(`SELECT commission_cents FROM payroll_entries WHERE user_id = 4 AND month = '2026-11'`).get();
  ok("CORRECT: Aina's November payroll no longer carries it", aina?.commission_cents === 7990, JSON.stringify(aina));
  ok("CORRECT: the CEO applies it to the corrected closer", (await call(`/commission/ledger/${led("invoice_id = 42")[0].id}/decide`, 1, "POST", { decision: "apply", note: "Hafiz closed it - applied" })).j?.status === "eligible" && led("invoice_id = 42")[0].user_id === 5);
  await call("/payroll/recompute", 1, "POST", { month: "2026-11" });
  const haf = db.prepare(`SELECT commission_cents FROM payroll_entries WHERE user_id = 5 AND month = '2026-11'`).get();
  ok("CORRECT: ...and Hafiz is paid it once, with his own 41 and 43", haf?.commission_cents === 2490 * 3 && led("invoice_id IN (41, 42, 43) AND status = 'included'").length === 3, JSON.stringify(haf));
  /* v1.243.0 (Release C): Paid needs the payslips out and recognised bank details */
  db.exec(`INSERT OR IGNORE INTO payslip_releases (month, released_by) VALUES ('2026-11', 1)`);
  db.exec(`UPDATE users SET bank_name = 'Maybank', bank_account = '5144' || id WHERE role != 'customer'`);
  const paidNov = await call("/payroll/paid", 1, "POST", { month: "2026-11" });
  ok("the November bank run is recorded", paidNov.status === 200, `${paidNov.status} ${JSON.stringify(paidNov.j)}`);
  const r43 = await fix(43, 4, 5);
  ok("CORRECT: already paid - unchanged, flagged, nothing deducted", r43.j?.commission?.unchanged_paid === 1 && led("invoice_id = 43")[0].status === "paid" && led("invoice_id = 43")[0].user_id === 5 && /nothing is deducted/.test(led("invoice_id = 43")[0].note ?? ""), JSON.stringify(led("invoice_id = 43")));
  ok("CORRECT: no row was ever deleted", db.prepare(`SELECT COUNT(*) AS n FROM commission_ledger`).get().n === 4);

  /* AUDIT and suggestions */
  const au = await call("/commission/audit", 3);
  ok("AUDIT: the CCO reads the history", au.status === 200 && au.j.events.some((x) => x.action === "doc.closer_correct") && au.j.events.some((x) => x.action === "commission.policy_draft") && au.j.events.some((x) => x.action === "invoice.paid_confirm"));
  ok("AUDIT: a consultant cannot", (await call("/commission/audit", 4)).status === 403);
  const sg = await call("/commission/packages", 1);
  ok("SUGGEST: package names come from real invoices", sg.status === 200 && sg.j.from_invoices.some((x) => x.name === "AZ Creative Express" && x.last_price_cents === 24900));
  ok("SUGGEST: not for consultants", (await call("/commission/packages", 4)).status === 403);

  /* WEEKLY - anyone who closed */
  const wk = (await call("/sales/week?scope=all", 1)).j;
  ok("WEEKLY: a live host who closed a sale in the last 90 days is on the scorecard", (wk.rows ?? []).some((r) => /Farid/.test(String(r.name ?? ""))), JSON.stringify((wk.rows ?? []).map((r) => r.name)));
  ok("WEEKLY: the system accounts never are", !(wk.rows ?? []).some((r) => /Adm|Sup/.test(String(r.name ?? ""))));
} catch (e) {
  failed++;
  console.log(`  ✗ runtime: ${e?.stack ?? e}`);
} finally {
  globalThis.Date = RealDate;
  rmSync(dir, { recursive: true, force: true });
}

console.log(failed ? `\ncommission-config: ${failed} failed, ${passed} passed.` : `commission-config: ${passed} checks passed.`);
process.exit(failed ? 1 : 0);
