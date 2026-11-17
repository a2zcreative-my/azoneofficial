/* COMMISSION WORKSPACE 5.0 (v1.311.0) - runtime guard: the WHOLE worker
 * bundled against SQLite with every migration applied (0196 included), by
 * direct request as each role. Fixed clock: Tuesday 10-11-2026, 12:00
 * Malaysia time. Invented fixtures only - no production data.
 *
 * The CEO's "approve as per recommend", 15-11-2026 (K-0..K-13 in
 * claude/COMMISSION-WORKSPACE-5.0-BLUEPRINT.md):
 *   K-2  the database itself keeps a policy version and an entitlement (0196)
 *   K-3  the CEO owner alone confirms paid - not the COO, not the Super Admin,
 *        not a second CEO account that is not the owner
 *   K-4  the Super Admin no longer approves a policy or authorises a payout
 *   K-5  the CEO authorises an agent payout, Finance (the COO) settles it
 *   K-7  the CEO's own sale never earns (RM 0, void, with the note) - the
 *        agent's 7% on it is untouched
 *   F-2  "eligible" is the salespeople's money; the agents' is apart
 * and the five read routes of the six views: the Overview, Transactions,
 * Agent Deals, Payroll Sync and the Audit History - their figures, the
 * company filter, a salesperson's own scope, the agent refused everywhere
 * and never shown the 3%, and reads that write nothing.
 *
 *   node tests/commission5.mjs              the current worker, then mutations
 *   NOMUT=1 node tests/commission5.mjs      the current worker only
 */
import { readFileSync, readdirSync, mkdtempSync, cpSync, writeFileSync, rmSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const root = fileURLToPath(new URL("..", import.meta.url));
const bundle = (srcRoot, out) => {
  const entry = join(srcRoot, "commission5-entry.ts");
  writeFileSync(entry, `export { default } from "./worker/src/index.ts";\n`);
  try { execSync(`npx esbuild "${entry}" --bundle --format=esm --platform=neutral --outfile="${out}" --log-level=error`, { cwd: root, stdio: "inherit" }); }
  finally { rmSync(entry, { force: true }); }
};
const sha = (s) => createHash("sha256").update(s).digest("hex");
const applyAll = (db, migDir) => {
  for (const f of readdirSync(migDir).filter((x) => x.endsWith(".sql")).sort()) {
    let buf = "";
    for (const st of readFileSync(join(migDir, f), "utf8").split(/;\s*\n/)) {
      buf = buf ? `${buf};\n${st}` : st;
      if (/CREATE TRIGGER/i.test(buf) && !/\bEND\s*$/i.test(buf.trim())) continue;
      try { db.exec(buf); } catch { /* an older statement the later ones replace */ }
      buf = "";
    }
  }
};

async function runtime(workerBundle, migDir) {
  const out = [];
  const ok = (c, m, why = "") => out.push([!!c, why && !c ? `${m} - ${why}` : m]);
  const db = new DatabaseSync(":memory:");
  const realClock = new DatabaseSync(":memory:");
  const pinTs = () => new Date().toISOString().slice(0, 19).replace("T", " ");
  for (const fn of ["datetime", "date", "time", "julianday"]) db.function(fn, { varargs: true }, (...a) => realClock.prepare(`SELECT ${fn}(${(a.length ? a : ["now"]).map(() => "?").join(",")}) AS v`).get(...(a.length ? a : ["now"]).map((x) => (typeof x === "string" && x.toLowerCase() === "now" ? pinTs() : x))).v);
  db.function("strftime", { varargs: true }, (...a) => realClock.prepare(`SELECT strftime(${a.map(() => "?").join(",")}) AS v`).get(...a.map((x, i) => (i > 0 && typeof x === "string" && x.toLowerCase() === "now" ? pinTs() : x))).v);
  const RealDate = globalThis.Date;
  const fixed = Date.parse("2026-11-10T04:00:00Z");
  globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [fixed])); } static now() { return fixed; } };
  applyAll(db, migDir);
  const shim = (sql) => { const st = db.prepare(sql); let b = []; const o = {
    bind: (...a) => { b = a.map((x) => (x === undefined ? null : x)); return o; },
    first: async () => st.get(...b) ?? null, all: async () => ({ results: st.all(...b) }),
    run: async () => ({ meta: { changes: Number(st.run(...b).changes) } }), _run: () => st.run(...b) }; return o; };
  const env = {
    DB: { prepare: shim, batch: async (list) => { db.exec("BEGIN"); try { for (const s of list) s._run(); db.exec("COMMIT"); } catch (e) { db.exec("ROLLBACK"); throw e; } return []; } },
    SESSION_PEPPER: "pepper", COMPANY_DOMAIN: "a2z.test", ALLOWED_ORIGINS: "https://portal.a2z.test",
    MEDIA: { put: async () => {}, get: async () => null, head: async () => null, list: async () => ({ objects: [] }), delete: async () => {} },
  };
  if (!globalThis.FixedLengthStream) globalThis.FixedLengthStream = class extends TransformStream { constructor() { super(); } };
  const U = { ceo: 1, sa: 2, coo: 3, cco: 4, aina: 5, lia: 6, hr: 7, ceo2: 8, ros: 21 };
  db.exec(`INSERT INTO users (id, name, full_name, email, role, is_active, password_hash, totp_enabled, totp_secret, employment_status, base_salary_cents, joined_on) VALUES
    (1,'Alif','Alif Owner','owner@a2z.test','ceo',1,'x',1,'JBSWY3DPEHPK3PXP','permanent',900000,'2024-01-01'),
    (2,'Root','System Root','root@a2z.test','super_admin',1,'x',1,'JBSWY3DPEHPK3PXP','permanent',0,'2024-01-01'),
    (3,'Ops','Ops Lead','ops@a2z.test','coo',1,'x',1,'JBSWY3DPEHPK3PXP','permanent',800000,'2024-01-01'),
    (4,'Cee','Cee Officer','cco@a2z.test','cco',1,'x',1,'JBSWY3DPEHPK3PXP','permanent',800000,'2024-01-01'),
    (5,'Aina','Aina Seller','aina@a2z.test','sales_marketing',1,'x',1,'JBSWY3DPEHPK3PXP','permanent',300000,'2024-01-01'),
    (6,'Lia','Lia Seller','lia@a2z.test','sales_marketing',1,'x',1,'JBSWY3DPEHPK3PXP','permanent',300000,'2024-01-01'),
    (7,'Hana','Hana HR','hana@a2z.test','hr_admin',1,'x',1,'JBSWY3DPEHPK3PXP','permanent',400000,'2024-01-01'),
    (8,'Second','Second Chief','chief2@a2z.test','ceo',1,'x',1,'JBSWY3DPEHPK3PXP','permanent',0,'2024-01-01'),
    (21,'Ros','Ros Agent','ros.agent@gmail.com','agent',1,'x',1,'JBSWY3DPEHPK3PXP','permanent',0,NULL)`);
  db.exec(`INSERT INTO system_meta (key, value) VALUES ('company_owner', '{"user_id":1}')`);
  for (let c = 1; c <= 9; c++) db.exec(`INSERT INTO customers (id, company, contact_person, created_by) VALUES (${c}, 'Client ${c} Sdn Bhd', 'Contact ${c}', 5)`);
  db.exec(`INSERT INTO commission_policies (id, version, name, status, effective_from, rate_kind, rate_bp, basis, reason, created_by, approved_by, approved_at)
           VALUES (1, 1, 'Sales commission 2026', 'active', '2026-11-01', 'percent', 1000, 'net_of_tax_delivery', 'The owner approved 10 percent', 1, 1, '2026-10-30 02:00:00')`);
  db.exec(`INSERT INTO commission_policies (id, version, name, status, effective_from, rate_kind, rate_bp, basis, reason, created_by, approved_by, approved_at, agent_rate_bp, agent_closer_rate_bp, agent_renewal_rule)
           VALUES (2, 2, 'Agent partnership 2026', 'active', '2026-11-02', 'percent', 1000, 'net_of_tax_delivery', 'Agent 7 percent and closer 3 percent', 3, 1, '2026-11-01 02:00:00', 700, 300, 'review')`);
  db.exec(`INSERT OR REPLACE INTO business_settings (key, value) VALUES ('commission_sync', 'on')`);
  db.exec(`INSERT INTO agent_assignments (agent_id, salesperson_id, effective_from, set_by, reason) VALUES (21, 5, '2026-11-01', 1, 'Ros works with Aina')`);
  db.exec(`INSERT INTO sales_targets (month, target_cents, set_by) VALUES ('2026-11', 1000000, 1)`);
  db.exec(`INSERT INTO user_sales_targets (user_id, month, target_cents, set_by) VALUES (5, '2026-11', 400000, 1)`);
  const ITEMS = (cents) => JSON.stringify([{ name: "Website", qty: 1, unit_price_cents: cents }]);
  const docIns = db.prepare(`INSERT INTO sales_documents (id, doc_type, doc_number, customer_id, items, discount_cents, tax_percent, total_cents, payment_status, paid_at, created_at, created_by, salesperson_id, kind, issuer_code, converted_from, revision)
                             VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?, ?, '2026-11-03 01:00:00', 5, ?, 'service', ?, ?, 0)`);
  const deal = ({ inv, cust, closer, agent = null, cents = 100000, pay = "paid", issuer = "a2z" }) => {
    let qt = null;
    if (agent) {
      qt = inv + 100;
      docIns.run(qt, "QT", `QT-T-${qt}`, cust, ITEMS(cents), cents, null, null, closer, issuer, null);
      db.prepare(`INSERT INTO agent_requests (id, agent_id, client_name, status, assigned_to, quotation_id, published_doc_id, published_revision, created_at, submitted_at) VALUES (?, ?, ?, 'won', ?, ?, ?, 0, '2026-11-03 01:00:00', '2026-11-03 01:00:00')`)
        .run(inv, agent, `Client ${cust}`, closer, qt, qt);
      db.prepare(`INSERT INTO quotation_acceptances (doc_id, revision, accepted_name, accepted_at) VALUES (?, 0, 'Puan Client', '2026-11-04 03:00:00')`).run(qt);
    }
    docIns.run(inv, "INV", `INV-T-${inv}`, cust, ITEMS(cents), cents, pay, pay === "paid" ? "2026-11-05 02:00:00" : null, closer, issuer, qt);
  };
  deal({ inv: 201, cust: 1, closer: U.aina });                               // direct, A2Z: Aina 10%
  deal({ inv: 202, cust: 2, closer: U.aina, agent: U.ros });                 // agent deal, A2Z: Ros 7%, Aina 3%
  deal({ inv: 203, cust: 3, closer: U.ceo, issuer: "azoo" });                // the CEO's own direct sale (K-7)
  deal({ inv: 204, cust: 4, closer: U.ceo, agent: U.ros });                  // the CEO closes an agent deal (K-7)
  deal({ inv: 205, cust: 5, closer: U.lia, cents: 50000, issuer: "azoo" });  // direct, AZ ONE: Lia 10%
  deal({ inv: 206, cust: 6, closer: U.aina, cents: 40000, pay: "unpaid" });  // not yet paid: pending only

  const app = (await import(pathToFileURL(workerBundle).href + `?v=${Math.random()}`)).default;
  const tok = {};
  for (const id of Object.values(U)) { tok[id] = `t-${id}-${Math.random()}`; db.prepare(`INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, datetime('now', '+12 hours'), datetime('now'))`).run(sha(tok[id]), id); }
  const req = async (full, uid, method = "GET", body) => {
    const h = { origin: "https://portal.a2z.test", cookie: `azone_session=${tok[uid]}; csrf_token=c1`, "x-csrf-token": "c1", "content-type": "application/json" };
    const r = await app.fetch(new Request(`https://api.a2z.test/api/v1${full}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }), env, { waitUntil() {} });
    const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch { /* not json */ }
    return { status: r.status, j, text };
  };
  const call = (p, uid, method, body) => req(`/staff${p}`, uid, method, body);
  const n = (sql, ...a) => Number(db.prepare(sql).get(...a)?.n ?? 0);
  const earn = (inv) => db.prepare(`SELECT id, recipient_role, user_id, amount_cents, rate_bp, status, note, payroll_month, payout_id FROM commission_ledger WHERE invoice_id = ? AND kind = 'earn' ORDER BY id`).all(inv);
  const role = (inv, r) => earn(inv).find((x) => x.recipient_role === r);
  const confirm = (inv, who) => call(`/docs/${inv}/confirm-paid`, who, "POST", { amount_cents: Number(db.prepare(`SELECT total_cents AS c FROM sales_documents WHERE id = ?`).get(inv).c), checked: true, payment_ref: `MBB-${inv}` });
  const sqlRefused = (sql) => { try { db.exec(sql); return false; } catch { return true; } };
  const fmt = (x) => JSON.stringify(x)?.slice(0, 300);
  try {
    /* ---------- K-3: the CEO owner alone confirms paid ---------- */
    ok((await confirm(201, U.coo)).status === 403, "K-3 the COO can no longer confirm paid");
    ok((await confirm(201, U.sa)).status === 403, "K-3 nor the Super Admin");
    ok((await confirm(201, U.ceo2)).status === 403, "K-3 nor a CEO account that is not the company owner");
    ok((await confirm(201, U.aina)).status === 403 && earn(201).length === 0, "K-3 nor the salesperson - and nothing earned yet");
    for (const inv of [201, 202, 203, 204, 205]) ok((await confirm(inv, U.ceo)).status === 201, `K-3 the CEO owner confirms INV-T-${inv}`);
    const rv = (who) => call(`/docs/205/confirm-paid/revoke`, who, "POST", { reason: "Checking who may take this back" });
    ok((await rv(U.coo)).status === 403 && (await rv(U.ceo2)).status === 403 && n(`SELECT COUNT(*) AS n FROM invoice_paid_confirmations WHERE invoice_id = 205 AND revoked_at IS NULL`) === 1, "K-3 neither the COO nor a non-owner CEO takes back a confirmation");
    ok((await call("/docs?type=INV", U.coo)).j?.can_confirm_paid === false && (await call("/docs?type=INV", U.ceo)).j?.can_confirm_paid === true, "K-3 the screen offers Confirm only to the owner");

    /* ---------- the rules: 10% direct, 7% + 3% agent ---------- */
    ok(role(201, "closer")?.amount_cents === 10000 && role(201, "closer").status === "eligible" && !role(201, "agent"), "direct sale: Aina RM 100.00 (10%), no agent row", fmt(earn(201)));
    ok(role(202, "agent")?.amount_cents === 7000 && role(202, "agent").user_id === U.ros && role(202, "closer")?.amount_cents === 3000 && role(202, "closer").user_id === U.aina, "agent deal: Ros RM 70.00 (7%) and Aina RM 30.00 (3%)", fmt(earn(202)));

    /* ---------- K-7: the CEO's own sale never earns ---------- */
    const c203 = role(203, "closer");
    ok(c203 && c203.amount_cents === 0 && c203.status === "void" && /K-7/.test(c203.note ?? ""), "K-7 the CEO's own direct sale: RM 0, void, with the note", fmt(earn(203)));
    ok(role(204, "agent")?.amount_cents === 7000 && role(204, "agent").status === "eligible" && role(204, "closer")?.amount_cents === 0 && role(204, "closer").status === "void", "K-7 an agent deal the CEO closed: the agent keeps 7%, the CEO's 3% is RM 0 void", fmt(earn(204)));

    /* ---------- F-2: eligible is the salespeople's; the agents' apart ---------- */
    const sum = (await call("/commission/summary?scope=all", U.ceo)).j;
    ok(sum?.eligible?.cents === 18000 && sum?.agent?.eligible?.cents === 14000, "F-2 eligible RM 180.00 (Aina 130 + Lia 50); the agents' RM 140.00 apart", fmt(sum));

    /* ---------- the Overview ---------- */
    const ov = (await call("/commission/overview?month=2026-11", U.ceo)).j;
    ok(ov?.confirmed?.n === 5 && ov.confirmed.cents === 450000, "Overview: 5 sales verified paid, RM 4,500.00", fmt(ov?.confirmed));
    ok(ov?.payable?.cents === 32000 && ov.to_payroll?.cents === 18000 && ov.to_payroll.n === 2, "Overview: payable RM 320.00; to Payroll RM 180.00 for 2 employees (no agent in payroll)", fmt([ov?.payable, ov?.to_payroll]));
    ok(ov?.by_role?.agent === 14000 && ov.by_role.salesperson === 3000 && ov.by_role.direct === 15000, "Overview by role: agents RM 140, salesperson 3% RM 30, direct RM 150", fmt(ov?.by_role));
    ok(ov?.pending?.n === 1 && ov.pending.cents === 4000, "Overview pending: the unpaid invoice, estimated RM 40.00 - never payable", fmt(ov?.pending));
    ok(ov?.performance?.target_cents === 1000000 && ov.performance.actual_cents === 450000 && ov.performance.pct === 45, "Overview performance: the Sales target RM 10,000, actual RM 4,500 (45%)", fmt(ov?.performance));
    ok(ov?.policy?.agent_rate_bp === 700 && ov.attention?.payouts_to_authorise?.n === 1 && ov.attention.payouts_to_authorise.cents === 14000 && ov.attention.ready_payroll?.cents === 18000, "Overview attention: Ros's RM 140 to authorise, RM 180 ready for payroll", fmt(ov?.attention));
    const az = (await call("/commission/overview?month=2026-11&company=azoo", U.ceo)).j, a2 = (await call("/commission/overview?month=2026-11&company=a2z", U.ceo)).j;
    ok(az?.confirmed?.n === 2 && az.confirmed.cents === 150000 && a2?.confirmed?.n === 3 && a2.confirmed.cents === 300000, "K-8 the company filter: AZ ONE 2 sales RM 1,500, A2Z 3 sales RM 3,000", fmt([az?.confirmed, a2?.confirmed]));
    ok(az?.by_role?.direct === 5000 && az.by_role.agent === 0, "K-8 AZ ONE: only Lia's RM 50 (the CEO's own earns nothing)", fmt(az?.by_role));

    /* ---------- a salesperson: their own, never the agent, never the 3% of another ---------- */
    const mine = await call("/commission/overview?month=2026-11&scope=all", U.aina);
    ok(mine.j?.scope === "mine" && mine.j.confirmed.n === 2 && mine.j.payable.cents === 13000 && mine.j.by_role === null && mine.j.attention === null, "Aina asking for everyone gets her own: 2 sales, RM 130 payable", fmt(mine.j));
    ok(mine.j?.performance?.target_cents === 400000 && !("agent_rate_bp" in (mine.j?.policy ?? {})), "Aina: her own target; the policy shows no agent rates", fmt(mine.j?.performance));
    const mtx = await call("/commission/transactions?month=2026-11&staff=6", U.aina);
    ok(mtx.status === 200 && mtx.j.rows.length === 3 && mtx.j.rows.every((r) => !("agent_name" in r) && !("agent_cents" in r) && "mine_bp" in r.rates), "Aina's transactions: her 3 (2 paid, 1 pending), no agent name or amount; the staff filter ignored", fmt(mtx.j?.rows));
    ok(!/Ros|Lia/.test(mtx.text) && mtx.j.staff.length === 0, "Aina's transactions never name the agent or another salesperson");
    ok(mtx.j.rows.find((r) => r.invoice_id === 202)?.commission_cents === 3000 && mtx.j.rows.find((r) => r.invoice_id === 202)?.rates.mine_bp === 300, "Aina sees her own 3% on the agent deal - not the agent's 7%");
    for (const p of ["/commission/agents", "/commission/payroll-preview", "/commission/audit"]) ok((await call(p, U.aina)).status === 403, `a salesperson is refused ${p}`);

    /* ---------- the agent: refused all of it; the agent portal has only the 7% ---------- */
    for (const p of ["/commission/overview", "/commission/transactions", "/commission/agents", "/commission/payroll-preview", "/commission/audit", "/commission/summary"]) {
      const r = await call(p, U.ros);
      ok(r.status >= 400 && !/3000|"closer/.test(r.text), `the agent is refused ${p}`, `${r.status}`);
    }
    const ag = await call("/agent/commission", U.ros);
    ok(ag.status === 200 && ag.j.rows.length >= 2 && ag.j.rows.every((r) => r.rate_bp === 700 || r.rate_bp === null) && !/closer|"amount_cents":3000|Aina/.test(ag.text), "the agent portal: Ros's 7% rows only - never the 3%, the closer or the salesperson", ag.text.slice(0, 200));

    /* ---------- Transactions (management) ---------- */
    const tx = (await call("/commission/transactions?month=2026-11", U.ceo)).j;
    const t202 = tx?.rows?.find((r) => r.invoice_id === 202);
    ok(tx?.total === 6 && t202?.deal === "partnership" && t202.agent_cents === 7000 && t202.closer_cents === 3000 && t202.rates.agent_bp === 700 && t202.rates.closer_bp === 300 && t202.commission_cents === 10000, "Transactions: 6 rows; the agent deal shows 7% RM 70 + 3% RM 30", fmt(t202));
    ok(tx?.rows?.find((r) => r.invoice_id === 203)?.commission_cents === 0 && tx.rows.find((r) => r.invoice_id === 206)?.status === "pending", "Transactions: the CEO's own sale RM 0; the unpaid one pending");
    ok((await call("/commission/transactions?month=2026-11&status=pending", U.ceo)).j?.total === 1 && (await call("/commission/transactions?month=2026-11&type=partnership", U.ceo)).j?.total === 2, "Transactions filters: status and deal type");
    ok((await call("/commission/transactions?month=2026-11&staff=6", U.ceo)).j?.total === 1 && (await call("/commission/transactions?month=2026-11&company=azoo", U.ceo)).j?.total === 2, "Transactions filters: salesperson and company");
    ok((await call("/commission/transactions?month=2026-11&q=INV-T-205", U.ceo)).j?.rows?.[0]?.invoice_id === 205, "Transactions search by invoice");

    /* ---------- Agent Deals ---------- */
    const ad = (await call("/commission/agents?month=2026-11", U.ceo)).j;
    const ros = ad?.agents?.find((a) => a.id === U.ros);
    ok(ad?.rate?.agent_bp === 700 && ad.rate.closer_bp === 300 && ros?.salesperson === "Aina Seller" && ros.deals === 2 && ros.agent_cents === 14000, "Agent Deals: the rate in force 7% + 3%; Ros with Aina, 2 deals, RM 140", fmt(ad));

    /* ---------- the hold switch (K-1) ---------- */
    ok((await call("/commission/settings", U.coo, "POST", { agent_partnership: "off", reason: "Hold while the audit runs" })).status === 403, "K-1 the COO cannot hold new agent sales");
    ok((await call("/commission/settings", U.ceo, "POST", { agent_partnership: "off", reason: "Hold while the audit runs" })).status === 200 && (await call("/commission/policy", U.ceo)).j?.agent_partnership === "off", "K-1 the CEO holds new agent sales; the policy screen shows it");
    ok(role(202, "agent")?.amount_cents === 7000 && role(202, "agent").status === "eligible", "K-1 the hold never rewrites a deal already earned");
    await call("/commission/settings", U.ceo, "POST", { agent_partnership: "on", reason: "Audit done, release the hold" });

    /* ---------- K-4: the Super Admin no longer approves ---------- */
    const d3 = await call("/commission/policy", U.coo, "POST", { name: "December review", effective_from: "2026-12-01", rate_kind: "percent", rate_pct: 10, basis: "net_of_tax_delivery", reason: "A draft only, never approved here", agent_rate_pct: 7, agent_closer_rate_pct: 3 });
    ok(d3.status === 201, "the COO drafts a version", d3.text.slice(0, 160));
    ok((await call(`/commission/policy/${d3.j?.id}/approve`, U.sa, "POST", { confirm: true })).status === 403, "K-4 the Super Admin cannot approve a policy");
    ok((await call(`/commission/policy/${d3.j?.id}/approve`, U.coo, "POST", { confirm: true })).status === 403, "the COO cannot approve one either");
    ok((await call("/commission/payouts", U.sa, "POST", { agent_id: U.ros })).status === 403, "K-4 the Super Admin cannot authorise an agent payout");

    /* ---------- Payroll Sync (K-6) ---------- */
    const pp = (await call("/commission/payroll-preview?month=2026-11", U.coo)).j;
    const pA = pp?.employees?.find((e) => e.user_id === U.aina);
    ok(pp?.employees?.length === 2 && pA?.ready === 13000 && pp.employees.find((e) => e.user_id === U.lia)?.ready === 5000 && !pp.employees.some((e) => e.user_id === U.ceo || e.user_id === U.ros), "Payroll Sync: Aina RM 130 and Lia RM 50 ready; neither the CEO nor the agent", fmt(pp?.employees));
    ok(pp?.can_sync === true && pp.agents?.can_settle === true && pp.agents.can_authorise === false && pp.agents.due?.[0]?.cents === 14000, "Payroll Sync as the COO: may sync, may settle, may not authorise; Ros RM 140 due", fmt(pp?.agents));
    const pc = (await call("/commission/payroll-preview?month=2026-11", U.ceo)).j;
    ok(pc?.can_sync === true && pc.agents?.can_authorise === true && pc.agents.can_settle === false, "Payroll Sync as the CEO: may sync and authorise, never settle");
    for (const uid of [U.aina, U.lia]) await call("/payroll", U.coo, "POST", { user_id: uid, month: "2026-11", basic_cents: 300000, commission_cents: 0, allowance_cents: 0, deduction_cents: 0, net_cents: 300000 });
    const rc = await call("/payroll/recompute", U.coo, "POST", { month: "2026-11" });
    ok(rc.status === 200, "K-6 Sync to Payroll is Payroll's own recompute (the COO)", rc.text.slice(0, 160));
    await call("/payroll/recompute", U.coo, "POST", { month: "2026-11" });
    const pay = (uid) => db.prepare(`SELECT commission_cents AS c FROM payroll_entries WHERE user_id = ? AND month = '2026-11'`).get(uid)?.c;
    ok(pay(U.aina) === 13000 && pay(U.lia) === 5000 && n(`SELECT COUNT(*) AS n FROM payroll_entries WHERE user_id IN (1, 21)`) === 0, "K-6 synced twice: Aina RM 130, Lia RM 50 - once; the CEO and the agent never in payroll", fmt([pay(U.aina), pay(U.lia)]));
    ok(role(202, "agent").payroll_month === null && role(201, "closer").status === "included", "the agent's row never joins a payroll month");
    const pp2 = (await call("/commission/payroll-preview?month=2026-11", U.coo)).j;
    ok(pp2?.employees?.find((e) => e.user_id === U.aina)?.in_payroll === 13000 && pp2.employees.find((e) => e.user_id === U.aina).ready === 0 && pp2.employees.find((e) => e.user_id === U.aina).on_payroll === true, "Payroll Sync after: Aina RM 130 in payroll, nothing left ready", fmt(pp2?.employees));
    ok((await call("/payroll/recompute", U.aina, "POST", { month: "2026-11" })).status === 403, "a salesperson cannot sync payroll");

    /* ---------- K-5: the CEO authorises, Finance (the COO) settles ---------- */
    ok((await call("/commission/payouts", U.coo, "POST", { agent_id: U.ros })).status === 403, "K-5 the COO cannot authorise an agent payout");
    const au = await call("/commission/payouts", U.ceo, "POST", { agent_id: U.ros, note: "November agent payout" });
    ok(au.status === 201 && au.j?.amount_cents === 14000, "K-5 the CEO authorises Ros's RM 140", au.text.slice(0, 160));
    const ceoSettle = await call(`/commission/payouts/${au.j?.id}/settle`, U.ceo, "POST", { bank_ref: "MBB-55120", settled_on: "2026-11-10" });
    ok(ceoSettle.status === 403 && ceoSettle.j?.error?.code === "forbidden", "K-5 the CEO never settles (Finance does) - refused by role, not only by dual control", ceoSettle.text.slice(0, 160));
    ok((await call(`/commission/payouts/${au.j?.id}/settle`, U.sa, "POST", { bank_ref: "MBB-55120", settled_on: "2026-11-10" })).status === 403, "K-5 nor the Super Admin");
    ok((await call(`/commission/payouts/${au.j?.id}/cancel`, U.coo, "POST", { reason: "Wrong bank account on file" })).status === 403, "K-5 the COO cannot cancel the CEO's authorisation");
    const st = await call(`/commission/payouts/${au.j?.id}/settle`, U.coo, "POST", { bank_ref: "MBB-55120", settled_on: "2026-11-10" });
    ok(st.status === 200 && earn(202).find((x) => x.recipient_role === "agent").status === "paid" && earn(204).find((x) => x.recipient_role === "agent").status === "paid", "K-5 the COO settles in Finance: both agent rows paid", st.text.slice(0, 160));
    const cash = db.prepare(`SELECT amount_cents, type, category FROM cashflow_entries WHERE ref = ?`).all(`AGT-${au.j?.id}`);
    ok(cash.length === 1 && cash[0].amount_cents === 14000 && cash[0].type === "out" && cash[0].category === "agent_commission", "K-9 one cash-book row under the AGT- reference, RM 140 out", fmt(cash));
    const again = await call(`/commission/payouts/${au.j?.id}/settle`, U.coo, "POST", { bank_ref: "MBB-55120", settled_on: "2026-11-10" });
    ok(again.j?.already_settled === true && n(`SELECT COUNT(*) AS n FROM cashflow_entries WHERE ref = ?`, `AGT-${au.j?.id}`) === 1, "settling again books nothing");

    /* ---------- the Audit History ---------- */
    const auP = (await call("/commission/audit?action=payment", U.ceo)).j;
    ok(auP?.total === 5 && auP.events.every((e) => /paid_confirm/.test(e.action) && e.who_role === "ceo" && /^INV-T-/.test(e.doc_number ?? "")), "Audit: 5 payment confirmations, each by the CEO with its invoice", fmt(auP?.events?.[0]));
    const auO = (await call("/commission/audit?action=payout", U.ceo)).j;
    ok(auO?.events?.map((e) => e.action).sort().join(",") === "commission.payout_authorise,commission.payout_settle", "Audit: the payout's authorisation and settlement", fmt(auO?.events?.map((e) => e.action)));
    const auU = (await call(`/commission/audit?user=${U.coo}`, U.ceo)).j;
    ok(auU?.total > 0 && auU.events.every((e) => e.who_role === "coo") && auU.people.some((p) => p.id === U.coo), "Audit: filter by person (the COO's only)", fmt(auU?.events?.map((e) => e.action)));
    ok((await call("/commission/audit?from=2026-11-11", U.ceo)).j?.total === 0 && (await call("/commission/audit?from=2026-11-10&to=2026-11-10", U.ceo)).j?.total > 0, "Audit: date filters");
    ok((await call("/commission/audit?action=policy", U.ceo)).j?.events?.some((e) => e.action === "commission.agent_switch"), "Audit: the hold switch is a policy event");

    /* ---------- reads write nothing ---------- */
    const before = [n(`SELECT COUNT(*) AS n FROM commission_ledger`), n(`SELECT COUNT(*) AS n FROM audit_log`), n(`SELECT COUNT(*) AS n FROM commission_attributions`)].join();
    for (let i = 0; i < 2; i++) for (const p of ["/commission/overview", "/commission/transactions", "/commission/agents", "/commission/payroll-preview", "/commission/audit"]) await call(`${p}?month=2026-11`, U.ceo);
    ok([n(`SELECT COUNT(*) AS n FROM commission_ledger`), n(`SELECT COUNT(*) AS n FROM audit_log`), n(`SELECT COUNT(*) AS n FROM commission_attributions`)].join() === before, "the five views read and write nothing");

    /* ---------- K-2: the database keeps the history (0196) ---------- */
    const lid = role(201, "closer").id, paidId = earn(202).find((x) => x.recipient_role === "agent").id, voidId = c203.id;
    ok(sqlRefused(`UPDATE commission_ledger SET amount_cents = 99999 WHERE id = ${lid}`), "K-2 an entitlement's amount cannot be rewritten");
    ok(sqlRefused(`UPDATE commission_ledger SET rate_bp = 2000 WHERE id = ${lid}`) && sqlRefused(`UPDATE commission_ledger SET recipient_role = 'agent' WHERE id = ${lid}`), "K-2 nor its rate or recipient");
    ok(sqlRefused(`DELETE FROM commission_ledger WHERE id = ${lid}`), "K-2 an entitlement is never deleted");
    ok(sqlRefused(`UPDATE commission_ledger SET status = 'eligible' WHERE id = ${paidId}`) && sqlRefused(`UPDATE commission_ledger SET status = 'eligible' WHERE id = ${voidId}`), "K-2 a paid or void row is final");
    ok(!sqlRefused(`UPDATE commission_ledger SET note = COALESCE(note, '') || ' checked' WHERE id = ${lid}`), "K-2 a row's note may still grow (what the engine writes)");
    ok(sqlRefused(`UPDATE commission_policies SET rate_bp = 1200 WHERE id = 1`) && sqlRefused(`UPDATE commission_policies SET status = 'rejected' WHERE id = 1`), "K-2 an approved policy version is never changed");
    ok(sqlRefused(`DELETE FROM commission_policies WHERE id = 1`), "K-2 a policy version is never deleted");
    ok(sqlRefused(`UPDATE commission_policies SET rate_bp = 900 WHERE id = ${d3.j?.id}`), "K-2 a draft keeps the terms it was drafted with");
    const rj = await call(`/commission/policy/${d3.j?.id}/reject`, U.ceo, "POST", { reason: "Not needed this year after all" });
    ok(rj.status === 200 && db.prepare(`SELECT status FROM commission_policies WHERE id = ?`).get(d3.j?.id)?.status === "rejected", "K-2 the CEO can still reject a draft through the route", rj.text.slice(0, 160));
    ok(sqlRefused(`UPDATE commission_policies SET status = 'active' WHERE id = ${d3.j?.id}`), "K-2 a rejected version stays rejected");
    ok(role(201, "closer").amount_cents === 10000 && role(202, "closer").amount_cents === 3000, "history unchanged: every amount as it was earned");
  } catch (e) { ok(false, "the run threw", String(e?.stack ?? e).slice(0, 400)); }
  globalThis.Date = RealDate;
  return out;
}

let n = 0, fail = 0;
const report = (res) => { for (const [p, m] of res) { n++; if (!p) { fail++; console.error(`FAIL ${m}`); } } };
const dir = mkdtempSync(join(tmpdir(), "commission5-"));
const main = join(dir, "worker.mjs");
bundle(root, main);
report(await runtime(main, join(root, "worker/migrations")));
const checks = n;
if (process.env.NOMUT) {
  rmSync(dir, { recursive: true, force: true });
  if (fail) { console.error(`commission5: ${fail} of ${n} failed`); process.exit(1); }
  console.log(`commission5: ${n} checks passed`); process.exit(0);
}
if (fail) { console.error(`commission5: ${fail} of ${n} failed (mutations not run)`); process.exit(1); }

const MUT = [
  ["worker/src/staff.ts", "K-3 any CEO-role account confirms paid", `if (!(canUser(user, "confirm_paid") && user.is_owner === true)) return err("forbidden", "Only the CEO (the company owner) confirms that an invoice is paid.", 403);`, `if (!canUser(user, "confirm_paid")) return err("forbidden", "Only the CEO (the company owner) confirms that an invoice is paid.", 403);`],
  ["worker/src/staff.ts", "K-3 any CEO-role account takes back a confirmation", `if (!(canUser(user, "confirm_paid") && user.is_owner === true)) return err("forbidden", "Only the CEO (the company owner) takes back a paid confirmation.", 403);`, `if (!canUser(user, "confirm_paid")) return err("forbidden", "Only the CEO (the company owner) takes back a paid confirmation.", 403);`],
  ["worker/src/permissions.ts", "K-4 the Super Admin approves a policy again", `commission_approve: ["ceo"],`, `commission_approve: ["ceo", "super_admin"],`],
  ["worker/src/commission.ts", "K-5 the CEO settles the payout he authorised", `po[2] === "cancel" ? !decider : !canUser(user, "agent_payout_settle")`, `po[2] === "cancel" ? !decider : !(canUser(user, "agent_payout_settle") || user.role === "ceo")`],
  ["worker/src/commission.ts", "K-7 the CEO's own sale earns", `  return r?.role === "ceo";\n}`, `  return r?.role === "ceo" && false;\n}`],
  ["worker/src/commission.ts", "F-2 eligible counts the agents' money", "const eligible = await sum(`status = 'eligible' AND recipient_role = 'closer'`);", "const eligible = await sum(`status = 'eligible'`);"],
  ["worker/src/commission.ts", "Overview: the agents' money counted for payroll", `const emp = payable.filter((r) => r.recipient_role === "closer");`, `const emp = payable;`],
  ["worker/src/commission.ts", "a salesperson's scope shows the agent's row", "AND l.user_id = ${Number(me)} AND l.recipient_role = 'closer'", "AND (l.user_id = ${Number(me)} OR l.recipient_role = 'agent')"],
  ["worker/src/commission.ts", "the company filter ignored", `const companySql = (c: string | null, col = "d.issuer_code") => c === "a2z"`, `const companySql = (c: string | null, col = "d.issuer_code") => c === "never"`],
  ["worker/src/commission.ts", "Agent Deals open to a salesperson", `  if (!all) return err("forbidden", "Management access required", 403);\n\n  /* ---------------- Agent Deals (ref 3) ---------------- */`, `  /* ---------------- Agent Deals (ref 3) ---------------- */`],
  ["worker/src/commission.ts", "Payroll Sync lists the agents as employees", `WHERE l.recipient_role = 'closer' AND u.role != 'agent' AND l.status IN ('eligible', 'included', 'paid')`, `WHERE l.status IN ('eligible', 'included', 'paid')`],
  ["worker/migrations/0196_commission_guards.sql", "K-2 the amount guard dropped", `BEFORE UPDATE ON commission_ledger\nWHEN NEW.source_key IS NOT OLD.source_key`, `BEFORE UPDATE ON commission_ledger_gone\nWHEN NEW.source_key IS NOT OLD.source_key`],
  ["worker/migrations/0196_commission_guards.sql", "K-2 paid rows reopened", `WHEN OLD.status IN ('paid', 'void') AND NEW.status IS NOT OLD.status`, `WHEN OLD.status IN ('never') AND NEW.status IS NOT OLD.status`],
  ["worker/migrations/0196_commission_guards.sql", "K-2 an approved policy edited", `WHEN OLD.status != 'draft'\nBEGIN`, `WHEN OLD.status = 'never'\nBEGIN`],
];
for (const [file, name, from, to] of MUT) {
  n++;
  const src = readFileSync(join(root, file), "utf8");
  if (!src.includes(from)) { fail++; console.error(`FAIL mutation did not apply: ${name}`); continue; }
  const mdir = mkdtempSync(join(tmpdir(), "commission5-m-"));
  cpSync(join(root, "worker"), join(mdir, "worker"), { recursive: true, filter: (p) => !p.includes("node_modules") });
  cpSync(join(root, "package.json"), join(mdir, "package.json"));
  for (const d of ["lib", "constants", "types"]) { try { cpSync(join(root, d), join(mdir, d), { recursive: true }); } catch { /* not every folder exists */ } }
  writeFileSync(join(mdir, file), src.replace(from, to));
  try { bundle(mdir, join(mdir, "w.mjs")); } catch { fail++; console.error(`FAIL mutation did not build: ${name}`); continue; }
  const res = await runtime(join(mdir, "w.mjs"), join(mdir, "worker/migrations"));
  const bad = res.filter(([p]) => !p).map(([, m]) => m);
  if (!bad.length) { fail++; console.error(`FAIL mutation not caught: ${name}`); }
  else console.log(`caught: ${name} -> ${bad.slice(0, 2).join("; ")}`);
  rmSync(mdir, { recursive: true, force: true });
}
rmSync(dir, { recursive: true, force: true });
if (fail) { console.error(`commission5: ${fail} of ${n} failed`); process.exit(1); }
console.log(`commission5: ${checks} checks passed (${MUT.length} mutations caught) - Commission 5.0: the CEO owner alone confirms paid; the CEO authorises agent payouts and Finance (the COO) settles; the Super Admin neither approves nor authorises; the CEO's own sale never earns while the agent keeps 7%; eligible is the salespeople's money, the agents' apart; the five views' figures, company filter and scopes; the agent refused and never shown the 3%; Payroll Sync is Payroll's own recompute, once; reads write nothing; the database refuses a rewritten amount, a reopened paid row and an edited or deleted policy version`);
