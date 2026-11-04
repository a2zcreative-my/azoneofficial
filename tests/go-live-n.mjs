/* AGENT PARTNERSHIP COMMISSION (v1.255.0) - runtime guard: the WHOLE worker
 * bundled against SQLite with every migration applied (0168 included), by
 * direct request as each role. Fixed clock: Tuesday 03-11-2026, 12:00
 * Malaysia time. Deterministic fixtures only - no production data.
 *
 * The owner's "Final CEO Commission Policy Clarification & Audit
 * Corrections", claude/AGENT-COMMISSION-AUDIT.md revision 3 and his
 * "approved" (03-11-2026), with the open decisions at their defaults:
 * renewals and repeat orders of an agent customer go to review (R3); an
 * agent payout is settled by a different person than the authoriser.
 *
 *   NO AGENT                 -> the closer earns 10%
 *   QUALIFIED AGENT REFERRAL -> the agent earns 7% and the verified closer 3%
 *   UNCERTAIN ATTRIBUTION    -> held for review, NOT a direct sale
 *
 * The brief's tests A-L are named in each check, plus the review decisions,
 * renewals (S2), disputes (S3), the kill switch, revocation, rounding,
 * F1 / F3 / F12 and a true race on the settlement.
 *
 *   node tests/go-live-n.mjs                                  the current worker, then mutations
 *   WORKER_BUNDLE=/path/bundle.mjs node tests/go-live-n.mjs   a given bundle (the 1.254.2 bundle must FAIL)
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
  const entry = join(srcRoot, "golive-n-entry.ts");
  writeFileSync(entry, `export { default } from "./worker/src/index.ts";\n`);
  try { execSync(`npx esbuild "${entry}" --bundle --format=esm --platform=neutral --outfile="${out}" --log-level=error`, { cwd: root, stdio: "inherit" }); }
  finally { rmSync(entry, { force: true }); }
};
const sha = (s) => createHash("sha256").update(s).digest("hex");
const MIGS = readdirSync(join(root, "worker/migrations")).filter((x) => x.endsWith(".sql")).sort();
const applyFile = (db, f) => {
  const src = readFileSync(join(root, "worker/migrations", f), "utf8");
  let buf = "";
  for (const st of src.split(/;\s*\n/)) {
    buf = buf ? `${buf};\n${st}` : st;
    if (/CREATE TRIGGER/i.test(buf) && !/\bEND\s*$/i.test(buf.trim())) continue;
    try { db.exec(buf); } catch { /* an older statement the later ones replace */ }
    buf = "";
  }
};

async function runtime(workerBundle) {
  const out = [];
  const ok = (c, m, why = "") => out.push([!!c, why && !c ? `${m} - ${why}` : m]);
  const db = new DatabaseSync(":memory:");
  /* v1.259.0 - ONE CLOCK. The worker reads the fixed test clock through Date,
     but SQLite's 'now' (column defaults, datetime('now') in a write) was the
     real one. Once the real date passed the fixed date, a stamp SQLite wrote
     came out after the bank date the test sends, and these checks failed for
     the calendar, not for the code - the same 5 failed on the 1.258.0
     bundle. SQLite's date functions now read 'now' from the same fixed clock
     (an application function of the same name overrides the built-in, and
     delegates everything else to a plain SQLite); no expectation changed. */
  const realClock = new DatabaseSync(":memory:");
  const pinTs = () => new Date().toISOString().slice(0, 19).replace("T", " ");
  for (const fn of ["datetime", "date", "time", "julianday"]) db.function(fn, { varargs: true }, (...a) => realClock.prepare(`SELECT ${fn}(${(a.length ? a : ["now"]).map(() => "?").join(",")}) AS v`).get(...(a.length ? a : ["now"]).map((x) => (typeof x === "string" && x.toLowerCase() === "now" ? pinTs() : x))).v);
  db.function("strftime", { varargs: true }, (...a) => realClock.prepare(`SELECT strftime(${a.map(() => "?").join(",")}) AS v`).get(...a.map((x, i) => (i > 0 && typeof x === "string" && x.toLowerCase() === "now" ? pinTs() : x))).v);
  for (const f of MIGS) applyFile(db, f);
  /* A TRUE RACE: while `barrier` is set, the route's read holding
     `barrier.sql` waits until both requests have read - two people at once */
  let barrier = null;
  const shim = (sql) => { const st = db.prepare(sql); let b = []; const o = {
    bind: (...a) => { b = a.map((x) => (x === undefined ? null : x)); return o; },
    first: async () => {
      const r = st.get(...b) ?? null;
      if (barrier && sql.includes(barrier.sql)) { barrier.n += 1; if (barrier.n >= 2) barrier.go(); await barrier.p; }
      return r;
    }, all: async () => ({ results: st.all(...b) }),
    run: async () => ({ meta: { changes: Number(st.run(...b).changes) } }), _run: () => st.run(...b) }; return o; };
  const env = {
    DB: { prepare: shim, batch: async (list) => { db.exec("BEGIN"); try { for (const s of list) s._run(); db.exec("COMMIT"); } catch (e) { db.exec("ROLLBACK"); throw e; } return []; } },
    SESSION_PEPPER: "pepper", COMPANY_DOMAIN: "a2z.test", ALLOWED_ORIGINS: "https://portal.a2z.test",
    MEDIA: { put: async () => {}, get: async () => null, head: async () => null, list: async () => ({ objects: [] }), delete: async () => {} },
  };
  if (!globalThis.FixedLengthStream) globalThis.FixedLengthStream = class extends TransformStream { constructor() { super(); } };
  const RealDate = globalThis.Date;
  const fixed = Date.parse("2026-11-03T04:00:00Z");
  globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [fixed])); } static now() { return fixed; } };
  const U = { ceo: 1, sa: 2, coo: 3, cco: 4, aina: 5, lia: 6, hr: 7, ros: 21, bee: 22 };
  db.exec(`INSERT INTO users (id, name, full_name, email, role, is_active, password_hash, totp_enabled, totp_secret, employment_status, base_salary_cents, joined_on) VALUES
    (1,'Alif','Alif Farhan','alif@a2z.test','ceo',1,'x',1,'JBSWY3DPEHPK3PXP','permanent',900000,'2024-01-01'),
    (2,'Root','System Root','root@a2z.test','super_admin',1,'x',1,'JBSWY3DPEHPK3PXP','permanent',0,'2024-01-01'),
    (3,'Ops','Ops Lead','ops@a2z.test','coo',1,'x',1,'JBSWY3DPEHPK3PXP','permanent',800000,'2024-01-01'),
    (4,'Cee','Cee Officer','cco@a2z.test','cco',1,'x',1,'JBSWY3DPEHPK3PXP','permanent',800000,'2024-01-01'),
    (5,'Aina','Aina Seller','aina@a2z.test','sales_marketing',1,'x',1,'JBSWY3DPEHPK3PXP','permanent',300000,'2024-01-01'),
    (6,'Lia','Lia Seller','lia@a2z.test','sales_marketing',1,'x',1,'JBSWY3DPEHPK3PXP','permanent',300000,'2024-01-01'),
    (7,'Hana','Hana HR','hana@a2z.test','hr_admin',1,'x',1,'JBSWY3DPEHPK3PXP','permanent',400000,'2024-01-01'),
    (21,'Ros','Ros Agent','ros.agent@gmail.com','agent',1,'x',1,'JBSWY3DPEHPK3PXP','permanent',0,NULL),
    (22,'Bee','Bee Agent','bee.agent@gmail.com','agent',1,'x',1,'JBSWY3DPEHPK3PXP','permanent',0,NULL)`);
  db.exec(`INSERT INTO system_meta (key, value) VALUES ('company_owner', '{"user_id":1}')`);
  for (let c = 1; c <= 14; c++) db.exec(`INSERT INTO customers (id, company, contact_person, created_by) VALUES (${c}, 'Client ${c} Sdn Bhd', 'Contact ${c}', 5)`);
  db.exec(`INSERT INTO sales_packages (id, name, category, description, kind, issuers, status, current_version, updated_by) VALUES (1, 'Website Package', 'Web', 'A website', 'service', 'a2z', 'active', 1, 1)`);
  db.exec(`INSERT INTO sales_package_versions (package_id, version, items, discount_cents, subtotal_cents, total_cents, created_by) VALUES (1, 1, '[{"name":"Website","qty":1,"unit_price_cents":100000}]', 0, 100000, 100000, 1)`);
  /* v1 - 10%, from 01-11, exactly as approved in production */
  db.exec(`INSERT INTO commission_policies (id, version, name, status, effective_from, rate_kind, rate_bp, basis, reason, created_by, approved_by, approved_at)
           VALUES (1, 1, 'Sales commission 2026', 'active', '2026-11-01', 'percent', 1000, 'net_of_tax_delivery', 'The owner approved 10 percent', 1, 1, '2026-10-30 02:00:00')`);
  db.exec(`INSERT OR REPLACE INTO business_settings (key, value) VALUES ('commission_sync', 'on')`);
  const ITEMS = (cents, name = "Website") => JSON.stringify([{ name, qty: 1, unit_price_cents: cents }]);
  const docIns = db.prepare(`INSERT INTO sales_documents (id, doc_type, doc_number, customer_id, items, discount_cents, tax_percent, total_cents, payment_status, paid_at, created_at, created_by, salesperson_id, kind, issuer_code, converted_from, revision)
                             VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?, ?, '2026-11-01 01:00:00', 5, ?, 'service', 'a2z', ?, ?)`);
  /* one deal: a quotation (its revision), the agent's request and its state, the acceptance, the invoice */
  const deal = ({ inv, cust, closer = U.aina, agent = U.ros, status = "won", accepted = true, pubRev = 0, qtRev = 0, assigned = U.aina, cents = 100000, paid = "2026-11-03 01:00:00", pay = "paid", name = "Website", noQt = false }) => {
    const qt = inv + 100;
    if (!noQt) {
      docIns.run(qt, "QT", `QT-A2Z-${qt}`, cust, ITEMS(cents, name), cents, null, null, closer, null, qtRev);
      if (agent) db.prepare(`INSERT INTO agent_requests (id, agent_id, client_name, status, assigned_to, quotation_id, published_doc_id, published_revision, created_at, submitted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '2026-11-01 01:00:00', '2026-11-01 01:00:00')`)
        .run(inv, agent, `Client ${cust}`, status, assigned, qt, qt, pubRev);
      if (accepted) db.prepare(`INSERT INTO quotation_acceptances (doc_id, revision, accepted_name, accepted_at) VALUES (?, ?, 'Puan Client', '2026-11-02 03:00:00')`).run(qt, pubRev);
    }
    docIns.run(inv, "INV", `INV-A2Z-${inv}`, cust, ITEMS(cents, name), cents, pay, pay === "paid" ? paid : null, closer, noQt ? null : qt, 0);
  };
  const worker = (await import(pathToFileURL(workerBundle).href + `?v=${Math.random()}`));
  const app = worker.default;
  const tok = {};
  const session = (id) => { tok[id] = `t-${id}-${Math.random()}`; db.prepare(`INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, datetime('now', '+12 hours'), datetime('now'))`).run(sha(tok[id]), id); };
  for (const id of Object.values(U)) session(id);
  const call = async (path, uid, method = "GET", body) => {
    const h = { origin: "https://portal.a2z.test", cookie: `azone_session=${tok[uid]}; csrf_token=c1`, "x-csrf-token": "c1", "content-type": "application/json" };
    const r = await app.fetch(new Request(`https://api.a2z.test/api/v1/staff${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }), env, { waitUntil() {} });
    const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch { /* not json */ }
    return { status: r.status, j, text };
  };
  const n = (sql, ...a) => Number(db.prepare(sql).get(...a)?.n ?? 0);
  const rows = (inv) => db.prepare(`SELECT source_key, recipient_role, user_id, amount_cents, rate_bp, status, payroll_month, payout_id FROM commission_ledger WHERE invoice_id = ? AND kind = 'earn' ORDER BY id`).all(inv);
  const live = (inv) => rows(inv).filter((r) => r.status !== "void");
  const attr = (inv) => db.prepare(`SELECT * FROM commission_attributions WHERE invoice_id = ? ORDER BY id DESC LIMIT 1`).get(inv);
  const confirm = (inv, cents = 100000, who = U.ceo) => call(`/docs/${inv}/confirm-paid`, who, "POST", { amount_cents: cents, checked: true, payment_ref: `MBB-${inv}` });
  const R = "The owner decided this after checking the evidence";
  const race = (sqlPart) => { let go; const p = new Promise((r) => { go = r; }); barrier = { n: 0, p, go, sql: sqlPart }; };
  const fmt = (r) => JSON.stringify(r);
  try {
    /* ---------- A. a direct sale: no agent - the closer earns 10% ---------- */
    deal({ inv: 101, cust: 2, noQt: true });
    ok((await confirm(101)).status === 201, "A the CEO confirms a direct sale paid");
    let L = live(101);
    ok(L.length === 1 && L[0].recipient_role === "closer" && L[0].user_id === U.aina && L[0].amount_cents === 10000 && L[0].rate_bp === 1000 && L[0].status === "eligible" && L[0].source_key === "earn:" + one(db, 101),
      "A no agent: Aina RM 100.00 (10%) eligible; no agent row; total RM 100.00", fmt(L));
    ok(attr(101)?.classification === "direct" && attr(101)?.closer_cents === 10000, "A the attribution records a direct sale with its evidence");

    /* ---------- E. agent-linked before an agent version is approved: HELD ---------- */
    deal({ inv: 105, cust: 5, paid: "2026-11-02 03:00:00" });
    ok((await confirm(105)).status === 201, "E an agent-linked invoice is confirmed before any agent rates exist");
    L = live(105);
    ok(L.length === 1 && L[0].amount_cents === 0 && L[0].status === "review" && attr(105)?.classification === "review" && /agent_policy_missing/.test(attr(105)?.reasons ?? ""),
      "E held for review (agent_policy_missing): one RM 0.00 hold - NEVER 10% to the closer, nothing eligible", fmt(L));
    ok(n(`SELECT COUNT(*) AS n FROM notifications WHERE user_id = 1 AND message LIKE 'Attribution review needed: INV-A2Z-105%'`) === 1, "E the CEO is told: Attribution review needed: INV-A2Z-105");

    /* ---------- the policy: v2 = v1's direct terms + agent 7% + closer 3% ---------- */
    const v2b = { name: "Agent partnership 2026", effective_from: "2026-11-03", rate_kind: "percent", rate_pct: 10, basis: "net_of_tax_delivery", reason: "The owner's final commission policy of 03-11-2026", agent_rate_pct: 7, agent_closer_rate_pct: 3, packages: [{ name: "Special Package", rule: "percent", rate_pct: 15 }] };
    ok((await call(`/commission/policy`, U.cco, "POST", v2b)).status === 403, "the CCO cannot draft a policy (review and monitor only)");
    ok((await call(`/commission/policy`, U.coo, "POST", { ...v2b, agent_renewal_rule: "every_paid" })).status === 400, "R3: another agent renewal rule needs the owner's approval first");
    ok((await call(`/commission/policy`, U.coo, "POST", { ...v2b, agent_closer_rate_pct: undefined })).status === 400, "both agent rates or neither");
    const d2 = await call(`/commission/policy`, U.coo, "POST", v2b);
    ok(d2.status === 201 && db.prepare(`SELECT agent_rate_bp a, agent_closer_rate_bp c, agent_renewal_rule r, rate_bp d FROM commission_policies WHERE id = ?`).get(d2.j.id)?.a === 700, "the COO drafts v2: agent 700 bp, closer 300 bp, direct 1000 bp", d2.text.slice(0, 200));
    ok((await call(`/commission/policy/${d2.j.id}/approve`, U.coo, "POST", { confirm: true })).status === 403, "only the CEO or super admin approves");
    ok((await call(`/commission/policy/${d2.j.id}/approve`, U.ceo, "POST", { confirm: true })).status === 200, "the CEO approves v2");
    const d3 = await call(`/commission/policy`, U.coo, "POST", { ...v2b, name: "Odd rates", effective_from: "2026-11-04", agent_rate_pct: 6, packages: [] });
    const ap3 = await call(`/commission/policy/${d3.j.id}/approve`, U.ceo, "POST", { confirm: true });
    ok(ap3.status === 400 && ap3.j?.error?.code === "rate_mismatch" && /6%.*3%.*9%.*10%/.test(ap3.j.error.message), "K agent rates that do not add up to the direct rate are refused without a typed reason - the screen says 6% + 3% = 9% vs 10%", ap3.text.slice(0, 200));
    await call(`/commission/policy/${d3.j.id}/reject`, U.ceo, "POST", { reason: "Rates must add up to ten percent" });

    /* ---------- B. a qualified agent sale: agent 7%, verified closer 3% ---------- */
    deal({ inv: 102, cust: 1 });
    ok((await confirm(102)).status === 201, "B the CEO confirms the agent's deal paid");
    L = live(102);
    const ag = L.find((r) => r.recipient_role === "agent"), cl = L.find((r) => r.recipient_role === "closer");
    ok(L.length === 2 && ag?.user_id === U.ros && ag.amount_cents === 7000 && ag.rate_bp === 700 && ag.status === "eligible" && cl?.user_id === U.aina && cl.amount_cents === 3000 && cl.rate_bp === 300 && cl.status === "eligible",
      "B Ros RM 70.00 (7%) and Aina RM 30.00 (3%), both eligible; total RM 100.00", fmt(L));
    ok(!L.some((r) => r.amount_cents === 10000) && attr(102)?.classification === "partnership" && attr(102)?.agent_id === U.ros && attr(102)?.accepted_name === "Puan Client" && attr(102)?.published_revision === 0,
      "B no 10% row; the attribution keeps the request, the published revision and the acceptance");

    /* ---------- rounding reconciles ---------- */
    deal({ inv: 112, cust: 12, cents: 100005 });
    await confirm(112, 100005);
    L = live(112);
    ok(L.find((r) => r.recipient_role === "agent")?.amount_cents === 7000 && L.find((r) => r.recipient_role === "closer")?.amount_cents === 3001 && L.reduce((a, r) => a + r.amount_cents, 0) === 10001,
      "rounding: RM 1,000.05 -> total RM 100.01 = agent RM 70.00 + closer RM 30.01", fmt(L));

    /* ---------- D. not qualified: held, never direct ---------- */
    deal({ inv: 104, cust: 4, status: "with_client", accepted: false });
    deal({ inv: 106, cust: 6, qtRev: 1 }); // Sales revised the quotation after it was published and accepted
    await confirm(104); await confirm(106);
    ok(attr(104)?.classification === "review" && /not_won/.test(attr(104).reasons) && /no_acceptance/.test(attr(104).reasons) && live(104).every((r) => r.amount_cents === 0),
      "D not Won, no acceptance: review - no 10% to Aina, nothing eligible", fmt(live(104)));
    ok(attr(106)?.classification === "review" && /revision_mismatch/.test(attr(106).reasons) && live(106).every((r) => r.amount_cents === 0),
      "D accepted on another revision than the one invoiced: review (revision_mismatch)", attr(106)?.reasons);

    /* ---------- G. the closer is not the agent's assigned salesperson ---------- */
    deal({ inv: 107, cust: 7, closer: U.lia, assigned: U.aina });
    await confirm(107);
    L = live(107);
    ok(L.find((r) => r.recipient_role === "agent")?.status === "eligible" && L.find((r) => r.recipient_role === "agent")?.amount_cents === 7000
      && L.find((r) => r.recipient_role === "closer")?.status === "review" && L.find((r) => r.recipient_role === "closer")?.user_id === U.lia,
      "G Ros's 7% is eligible and unchanged; Lia's 3% goes to review (closer differs)", fmt(L));

    /* ---------- K. a package rule on an agent-linked line ---------- */
    deal({ inv: 108, cust: 8, name: "Special Package" });
    await confirm(108);
    ok(attr(108)?.classification === "review" && attr(108).reasons === "policy_conflict" && live(108).every((r) => r.amount_cents === 0),
      "K a line under a package rule: review (policy_conflict) - the split is not substituted", attr(108)?.reasons);
    deal({ inv: 114, cust: 14, noQt: true, name: "Special Package" });
    await confirm(114);
    ok(live(114)[0]?.amount_cents === 15000 && attr(114)?.classification === "direct", "K the same package on a direct sale still earns its own rule (15%)", fmt(live(114)));

    /* ---------- S2 (R3). a renewal / repeat order of an agent customer ---------- */
    deal({ inv: 109, cust: 1, noQt: true });
    await confirm(109);
    ok(attr(109)?.classification === "review" && attr(109).reasons === "agent_customer_repeat" && attr(109).agent_id === U.ros && live(109).every((r) => r.amount_cents === 0),
      "R3 a later invoice for the agent's customer (no link to the source) is held for review - never assumed direct", attr(109)?.reasons);

    /* ---------- S3. a disputed attribution ---------- */
    ok((await call(`/commission/disputes`, U.cco, "POST", { scope: "customer", ref_id: 10, reason: "Another agent claims this client" })).status === 403, "S3 the CCO cannot flag a dispute");
    ok((await call(`/commission/disputes`, U.coo, "POST", { scope: "customer", ref_id: 10, reason: "Another agent claims this client" })).status === 201, "S3 the COO flags customer 10 as disputed");
    deal({ inv: 110, cust: 10, noQt: true });
    await confirm(110);
    ok(attr(110)?.classification === "review" && attr(110).reasons === "disputed" && live(110).every((r) => r.amount_cents === 0), "S3 a disputed customer's sale is held, even with no agent request");

    /* ---------- the kill switch ---------- */
    ok((await call(`/commission/settings`, U.coo, "POST", { agent_partnership: "off", reason: "Pausing agent deals for audit" })).status === 403, "only the CEO or super admin uses the agent switch");
    ok((await call(`/commission/settings`, U.ceo, "POST", { agent_partnership: "off", reason: "Pausing agent deals for audit" })).status === 200, "the CEO switches agent deals off");
    deal({ inv: 111, cust: 11 });
    await confirm(111);
    ok(attr(111)?.classification === "review" && /agent_partnership_off/.test(attr(111).reasons) && live(111).every((r) => r.amount_cents === 0), "switch off: a qualified agent deal is HELD - never paid as direct");
    await call(`/commission/settings`, U.ceo, "POST", { agent_partnership: "on", reason: "Audit done, agent deals back on" });

    /* ---------- C. unpaid and part-paid: estimates only, each to themselves ---------- */
    deal({ inv: 103, cust: 3, pay: "unpaid" });
    deal({ inv: 113, cust: 13, pay: "partial" });
    db.exec(`INSERT INTO invoice_payments (invoice_id, amount_cents, received_on, created_by) VALUES (113, 40000, '2026-11-02', 1)`);
    const ainaE = await call(`/commission/entries`, U.aina);
    const e103 = ainaE.j?.estimates?.find((e) => e.invoice_id === 103), e113 = ainaE.j?.estimates?.find((e) => e.invoice_id === 113);
    ok(e103?.estimate_cents === 3000 && e103.deal === "partnership" && e103.closer_rate_bp === 300 && e113?.estimate_cents === 3000 && !("agent_estimate_cents" in e103) && live(103).length === 0 && live(113).length === 0,
      "C unpaid / part-paid agent deals: Aina's estimate is her 3% only, nothing eligible", fmt(e103));
    const rosC = await call(`/agent/commission`, U.ros);
    const r103 = rosC.j?.rows?.find((r) => r.invoice_number === "INV-A2Z-103");
    ok(r103?.stage === "estimated" && r103.amount_cents === 7000 && r103.rate_bp === 700 && rosC.j.totals.estimated === 14000, "C ...and Ros's estimate is his 7% only", fmt(r103));

    /* ---------- H. refresh, replay, sync x N: one attribution, the same rows ---------- */
    const snap = () => sha(JSON.stringify([db.prepare(`SELECT id, source_key, status, amount_cents, user_id FROM commission_ledger ORDER BY id`).all(), db.prepare(`SELECT id, confirmation_id, classification FROM commission_attributions ORDER BY id`).all()]));
    const s0 = snap();
    for (let i = 0; i < 3; i++) { await call(`/commission/summary?scope=all`, U.ceo); await call(`/commission/entries?scope=all`, U.ceo); await call(`/commission/flow`, U.ceo); await call(`/agent/commission`, U.ros); await call(`/commission/attributions`, U.ceo); }
    const again = await confirm(102);
    ok(snap() === s0 && n(`SELECT COUNT(*) AS n FROM commission_attributions WHERE invoice_id = 102`) === 1 && again.status === 409, "H every refresh, replay and catch-up pass writes nothing new: one attribution, the same rows", String(again.status));

    /* ---------- I. the agent: own 7% only, in the portal and by direct API ---------- */
    const rosI = await call(`/agent/commission`, U.ros);
    const rosText = rosI.text;
    ok(rosI.status === 200 && rosI.j.rate_bp === 700 && rosI.j.rows.every((r) => r.rate_bp === 700 || r.rate_bp === null) && !/closer|basis|"rate_bp":(300|1000)|3000|3001|10000/.test(rosText),
      "I Ros sees 'Your commission rate: 7%' and his own amounts - no closer, no 3%, no 10%, no basis", rosText.slice(0, 300));
    ok(rosI.j.rows.filter((r) => r.stage === "under_review").every((r) => r.amount_cents === null) && rosI.j.rows.some((r) => r.invoice_number === "INV-A2Z-109" && r.stage === "under_review"), "I held deals show to the agent as Under review, with no amount");
    for (const p of ["/commission/summary", "/commission/entries", `/commission/entries/${db.prepare(`SELECT id FROM commission_ledger WHERE source_key = 'agent:' || (SELECT id FROM invoice_paid_confirmations WHERE invoice_id = 102)`).get().id}`, "/commission/payouts", "/commission/attributions", "/commission/flow", "/payroll/commission-sources?month=2026-11"]) {
      ok((await call(p, U.ros)).status === 403, `I the agent is refused ${p} on the server`);
    }
    const beeI = await call(`/agent/commission`, U.bee);
    ok(beeI.status === 200 && beeI.j.rows.length === 0 && !/INV-A2Z-10/.test(beeI.text), "I another agent sees none of Ros's sales");
    ok((await call(`/agent/commission`, U.aina)).status === 403, "I sales staff cannot read the agent's commission route");

    /* ---------- J. the salesperson: 10% direct, 3% agent deals, never the agent's amount ---------- */
    const ainaJ = await call(`/commission/entries`, U.aina);
    const mine = ainaJ.j.entries;
    ok(mine.find((e) => e.invoice_id === 101)?.rate_bp === 1000 && mine.find((e) => e.invoice_id === 102)?.rate_bp === 300 && mine.find((e) => e.invoice_id === 102)?.amount_cents === 3000
      && mine.every((e) => e.recipient_role === "closer" && e.user_id === U.aina) && !mine.some((e) => "agent_request_id" in e && e.agent_request_id !== undefined),
      "J Aina: 10% on her direct sale, 3% on the agent deal - her rows only", fmt(mine.map((e) => [e.invoice_id, e.rate_bp, e.amount_cents, e.recipient_role])));
    const clId = db.prepare(`SELECT id FROM commission_ledger WHERE source_key = 'earn:' || (SELECT id FROM invoice_paid_confirmations WHERE invoice_id = 102)`).get().id;
    const det = await call(`/commission/entries/${clId}`, U.aina);
    ok(det.status === 200 && det.j.related.length === 1 && det.j.related[0].id === clId && det.j.breakdown === null && JSON.stringify(Object.keys(det.j.attribution ?? {}).sort()) === JSON.stringify(["agent_name", "classification", "decision"]) && det.j.attribution.agent_name === "Ros Agent" && !/7000/.test(det.text),
      "J (F1) the entry detail shows Aina her own row only, the agent's name - never the agent's RM 70.00", det.text.slice(0, 300));
    const agId = db.prepare(`SELECT id FROM commission_ledger WHERE source_key = 'agent:' || (SELECT id FROM invoice_paid_confirmations WHERE invoice_id = 102)`).get().id;
    ok((await call(`/commission/entries/${agId}`, U.aina)).status === 403, "J Aina cannot open the agent's row by direct request");
    const mgmt = await call(`/commission/entries/${clId}`, U.cco);
    ok(mgmt.j?.related?.length === 2 && mgmt.j.attribution?.classification === "partnership" && !("write_key" in (mgmt.j.attribution ?? {})), "management (the CCO, read only) sees both rows and the classification");

    /* ---------- the review decisions ---------- */
    const aE = attr(105).id, aD = attr(104).id, aD2 = attr(106).id;
    const holdE = db.prepare(`SELECT id FROM commission_ledger WHERE invoice_id = 105 AND status = 'review'`).get().id;
    ok((await call(`/commission/ledger/${holdE}/decide`, U.ceo, "POST", { decision: "apply", note: R })).j?.error?.code === "attribution_review", "a held sale cannot be 'applied' as a plain review entry - it is decided on its attribution");
    ok((await call(`/commission/attributions/${aE}/decide`, U.coo, "POST", { decision: "direct", note: R })).status === 403 && (await call(`/commission/attributions/${aE}/decide`, U.cco, "POST", { decision: "direct", note: R })).status === 403, "only the CEO or super admin decides (not the COO, not the CCO)");
    const retro = await call(`/commission/attributions/${aE}/decide`, U.ceo, "POST", { decision: "partnership", policy_id: d2.j.id, note: R });
    ok(retro.status === 409 && retro.j?.error?.code === "retrospective" && live(105).every((r) => r.amount_cents === 0), "confirming a partnership paid before v2 started is a retrospective allocation - it needs the tick", retro.text.slice(0, 200));
    const okE = await call(`/commission/attributions/${aE}/decide`, U.ceo, "POST", { decision: "partnership", policy_id: d2.j.id, note: R, confirm_retro: true });
    L = live(105);
    ok(okE.status === 200 && L.length === 2 && L.find((r) => r.recipient_role === "agent")?.amount_cents === 7000 && L.find((r) => r.recipient_role === "closer")?.amount_cents === 3000 && attr(105).decision === "partnership" && attr(105).decided_by === U.ceo,
      "decision 'partnership': 7% + 3% written, the decision recorded with who and why", fmt(L));
    ok((await call(`/commission/attributions/${aE}/decide`, U.sa, "POST", { decision: "direct", note: R })).status === 409, "a decision is made once");
    await call(`/commission/attributions/${aD}/decide`, U.ceo, "POST", { decision: "direct", note: R });
    ok(live(104).length === 1 && live(104)[0].amount_cents === 10000 && live(104)[0].status === "eligible" && attr(104).decision === "direct", "decision 'direct' (referral rejected): Aina's 10%, citing the decision", fmt(live(104)));
    await call(`/commission/attributions/${aD2}/decide`, U.ceo, "POST", { decision: "none", note: R });
    ok(live(106).length === 0 && attr(106).decision === "none", "decision 'none': nothing payable, the hold voided with the reason");
    ok(attr(106).evidence && JSON.parse(attr(106).evidence).invoiced_revision === 1, "the evidence is kept as it was");
    let threw = false; try { db.exec(`UPDATE commission_attributions SET classification = 'direct' WHERE id = ${aD2}`); } catch { threw = true; }
    ok(threw, "the database refuses to rewrite an attribution after the fact");

    /* ---------- revocation of a held sale ---------- */
    await call(`/docs/109/confirm-paid/revoke`, U.ceo, "POST", { reason: "The transfer bounced back" });
    await call(`/commission/summary`, U.ceo);
    ok(attr(109).closed_reason === "confirmation_revoked" && live(109).length === 0 && (await call(`/commission/attributions/${attr(109).id}/decide`, U.ceo, "POST", { decision: "direct", note: R })).status === 409,
      "a held sale whose confirmation is taken back closes with no rows - nothing to decide");
    await call(`/docs/107/confirm-paid/revoke`, U.ceo, "POST", { reason: "The transfer bounced back" });
    await call(`/commission/summary`, U.ceo);
    ok(live(107).length === 0, "a revoked agent deal before payout: both rows void (per row)", fmt(rows(107)));

    /* ---------- F. reassignment never rewrites history ---------- */
    const before = fmt([attr(102), rows(102), db.prepare(`SELECT assigned_to FROM agent_requests WHERE id = 102`).get()]);
    ok((await call(`/agent/assignments`, U.aina, "POST", { agent_id: U.ros, salesperson_id: U.lia, reason: "Lia covers the north region now" })).status === 403, "F only management assigns");
    ok((await call(`/agent/assignments`, U.ceo, "POST", { agent_id: U.ros, salesperson_id: U.lia, effective_from: "2026-11-01", reason: "Lia covers the north region now" })).status === 400, "F an assignment cannot start in the past");
    ok((await call(`/agent/assignments`, U.ceo, "POST", { agent_id: U.ros, salesperson_id: U.lia, reason: "Lia covers the north region now" })).status === 201, "F the CEO assigns Ros to Lia from today");
    ok(fmt([attr(102), rows(102), db.prepare(`SELECT assigned_to FROM agent_requests WHERE id = 102`).get()]) === before, "F the earlier sale's attribution, rows and request are unchanged");
    const nr = await call(`/agent/requests`, U.ros, "POST", { client_name: "Fresh Client", contact_person: "Encik Fresh", client_phone: "0129999999", client_email: "fresh@client.test", package_id: 1, requirement: "A website", client_key: "k-fresh-1" });
    ok(nr.status === 201 && db.prepare(`SELECT assigned_to FROM agent_requests WHERE id = ?`).get(nr.j.id)?.assigned_to === U.lia, "F Ros's next request goes to Lia", nr.text.slice(0, 160));
    /* F3: a closer correction moves the closer's row only */
    await call(`/docs/112/closer`, U.ceo, "POST", { salesperson_id: U.lia, reason: "Lia closed it, not Aina" });
    L = live(112);
    ok(L.find((r) => r.recipient_role === "closer")?.user_id === U.lia && L.find((r) => r.recipient_role === "agent")?.user_id === U.ros, "F3 correcting the closer moves the closer's 3% only - the agent's 7% stays with Ros", fmt(L));

    /* ---------- L. payroll for the closer, a payout for the agent ---------- */
    const save = (uid) => call("/payroll", U.ceo, "POST", { user_id: uid, month: "2026-11", basic_cents: 300000, commission_cents: 0, allowance_cents: 0, deduction_cents: 0, net_cents: 300000 });
    await save(U.aina);
    const ainaRows = db.prepare(`SELECT amount_cents, payroll_month, recipient_role FROM commission_ledger WHERE user_id = 5 AND kind = 'earn' AND status = 'included'`).all();
    const slip = db.prepare(`SELECT commission_cents FROM payroll_entries WHERE user_id = 5 AND month = '2026-11'`).get()?.commission_cents;
    ok(ainaRows.length >= 3 && ainaRows.every((r) => r.payroll_month === "2026-11" && r.recipient_role === "closer") && slip === ainaRows.reduce((a, r) => a + r.amount_cents, 0),
      "L Aina's 10% and 3% join the November payroll once, on her payslip", fmt([slip, ainaRows]));
    await save(U.aina);
    ok(db.prepare(`SELECT commission_cents FROM payroll_entries WHERE user_id = 5 AND month = '2026-11'`).get()?.commission_cents === slip, "L saving again adds nothing");
    ok(n(`SELECT COUNT(*) AS n FROM commission_ledger WHERE recipient_role = 'agent' AND payroll_month IS NOT NULL`) === 0 && n(`SELECT COUNT(*) AS n FROM payroll_entries WHERE user_id IN (21, 22)`) === 0, "L an agent's commission never enters payroll");
    const src = await call(`/payroll/commission-sources?month=2026-11`, U.ceo);
    ok(src.j?.rows?.find((r) => r.invoice_id === 102)?.commission_cents === 3000, "L (F12) the payroll month view shows the closer's RM 30.00 beside INV-A2Z-102 - never the agent's", fmt(src.j?.rows?.find((r) => r.invoice_id === 102)));
    /* the payout */
    ok((await call(`/commission/payouts`, U.coo, "POST", { agent_id: U.ros })).status === 403 && (await call(`/commission/payouts`, U.cco)).status === 200, "L the COO cannot authorise a payout; the CCO reads the payouts");
    const due = (await call(`/commission/payouts`, U.ceo)).j?.due?.find((d) => d.agent_id === U.ros);
    ok(due?.cents === 21000 && due.n === 3, "L Ros has RM 210.00 eligible (INV 102, 105, 112)", fmt(due));
    const au = await call(`/commission/payouts`, U.ceo, "POST", { agent_id: U.ros, note: "November agent payout" });
    ok(au.status === 201 && au.j.amount_cents === 21000 && n(`SELECT COUNT(*) AS n FROM cashflow_entries WHERE ref = 'AGT-${au.j.id}'`) === 0
      && n(`SELECT COUNT(*) AS n FROM commission_ledger WHERE payout_id = ${au.j.id} AND status = 'included'`) === 3, "L the CEO authorises RM 210.00 - the rows are in the batch, NO cash is booked yet", au.text.slice(0, 160));
    ok((await call(`/commission/payouts`, U.ceo, "POST", { agent_id: U.ros })).status === 409, "L the same rows cannot join a second batch");
    const self = await call(`/commission/payouts/${au.j.id}/settle`, U.ceo, "POST", { bank_ref: "MBB-77821", settled_on: "2026-11-03" });
    ok(self.status === 403 && self.j?.error?.code === "dual_control", "L dual control: the authoriser cannot confirm the settlement");
    ok((await call(`/commission/payouts/${au.j.id}/settle`, U.sa, "POST", { settled_on: "2026-11-03" })).status === 400 && (await call(`/commission/payouts/${au.j.id}/settle`, U.sa, "POST", { bank_ref: "MBB-77821", settled_on: "2026-11-04" })).status === 400,
      "L a settlement needs the bank reference and a date no later than today");
    race("FROM agent_payouts o LEFT JOIN users u ON u.id = o.agent_id WHERE o.id = ?1");
    const both = await Promise.all([call(`/commission/payouts/${au.j.id}/settle`, U.sa, "POST", { bank_ref: "MBB-77821", settled_on: "2026-11-03" }), call(`/commission/payouts/${au.j.id}/settle`, U.sa, "POST", { bank_ref: "MBB-99999", settled_on: "2026-11-03" })]);
    barrier = null;
    const cash = db.prepare(`SELECT * FROM cashflow_entries WHERE ref = 'AGT-${au.j.id}'`).all();
    ok(both.map((r) => r.status).sort().join() === "200,409" && cash.length === 1 && cash[0].amount_cents === 21000 && cash[0].type === "out" && cash[0].effective_date === "2026-11-03" && cash[0].category === "agent_commission",
      "L two settlements pressed at once: ONE stands, ONE cash-book row (RM 210.00 out, the bank date, agent_commission)", fmt([both.map((r) => [r.status, r.text.slice(0, 80)]), cash]));
    ok(n(`SELECT COUNT(*) AS n FROM commission_ledger WHERE payout_id = ${au.j.id} AND status = 'paid'`) === 3 && db.prepare(`SELECT status, bank_ref, settled_by FROM agent_payouts WHERE id = ?`).get(au.j.id).bank_ref === "MBB-77821", "L the rows are paid only now, with the bank reference");
    const retry = await call(`/commission/payouts/${au.j.id}/settle`, U.sa, "POST", { bank_ref: "MBB-77821", settled_on: "2026-11-03" });
    ok(retry.j?.already_settled === true && n(`SELECT COUNT(*) AS n FROM cashflow_entries WHERE ref = 'AGT-${au.j.id}'`) === 1 && n(`SELECT COUNT(*) AS n FROM journal_entries WHERE ref = 'AGT-${au.j.id}'`) <= 1, "L a retry books nothing");
    ok((await call(`/commission/payouts/${au.j.id}/cancel`, U.ceo, "POST", { reason: "Changed my mind about it" })).status === 409, "L a settled payout is never cancelled");
    const rosL = await call(`/agent/commission`, U.ros);
    ok(rosL.j.totals.paid === 21000 && rosL.j.rows.filter((r) => r.stage === "paid").every((r) => r.payout?.bank_ref === "MBB-77821" && r.payout?.settled_on === "2026-11-03") && n(`SELECT COUNT(*) AS n FROM notifications WHERE user_id = 21 AND message LIKE 'A payout of RM 210.00 was settled%'`) === 1,
      "L Ros sees RM 210.00 paid with the date and the bank reference, and is told once");
    /* cancel before settlement returns the rows */
    deal({ inv: 115, cust: 9 });
    await confirm(115);
    const au2 = await call(`/commission/payouts`, U.ceo, "POST", { agent_id: U.ros });
    ok(au2.status === 201 && (await call(`/commission/payouts/${au2.j.id}/cancel`, U.sa, "POST", { reason: "Wrong bank account on file" })).status === 200
      && n(`SELECT COUNT(*) AS n FROM commission_ledger WHERE invoice_id = 115 AND recipient_role = 'agent' AND status = 'eligible' AND payout_id IS NULL`) === 1 && n(`SELECT COUNT(*) AS n FROM cashflow_entries WHERE ref = 'AGT-${au2.j.id}'`) === 0,
      "L cancelling an authorised payout returns its rows to eligible; no cash was booked");
    ok((await call(`/commission/payouts/${au2.j.id}/settle`, U.sa, "POST", { bank_ref: "MBB-1", settled_on: "2026-11-03" })).status === 409, "L a cancelled payout cannot be settled");
    /* the whole picture reconciles */
    const sumAll = n(`SELECT COALESCE(SUM(amount_cents), 0) AS n FROM commission_ledger WHERE kind = 'earn' AND status != 'void' AND invoice_id IN (102, 105, 112)`);
    ok(sumAll === 10000 + 10000 + 10001, "no double commission: each agent deal pays exactly its total once (agent + closer)", String(sumAll));
  } catch (e) {
    ok(false, `the run did not finish: ${e?.stack ?? e}`);
  } finally {
    globalThis.Date = RealDate;
  }
  return out;
}
function one(db, inv) { return db.prepare(`SELECT id FROM invoice_paid_confirmations WHERE invoice_id = ?`).get(inv)?.id; }

let n = 0, fail = 0;
const report = (res) => { for (const [p, m] of res) { n++; if (!p) { fail++; console.error(`FAIL ${m}`); } } };
const given = process.env.WORKER_BUNDLE;
const dir = mkdtempSync(join(tmpdir(), "golive-n-"));
const main = given ?? join(dir, "worker.mjs");
if (!given) bundle(root, main);
report(await runtime(main));
const checks = n;
if (given || process.env.NOMUT) {
  if (fail) { console.error(`go-live-n: ${fail} of ${n} failed`); process.exit(1); }
  console.log(`go-live-n: ${n} checks passed`); process.exit(0);
}

const MUT = [
  ["worker/src/commission.ts", "uncertain attribution falls back to a direct sale", `if (reasons.length) return { ...base, cls: "review", reasons,`, `if (reasons.length) return { ...base, cls: "direct", reasons,`],
  ["worker/src/commission.ts", "the closer's 3% does not reconcile to the total", "return { conflict: false, eligible, agent, closer: total - agent, total };", "return { conflict: false, eligible, agent, closer: half(Number(p.agent_closer_rate_bp)) + 1, total };"],
  ["worker/src/commission.ts", "dual control removed", `    if (Number(o.authorized_by) === user.id) return err("dual_control",`, `    if (false) return err("dual_control",`],
  ["worker/src/commission.ts", "the entry detail shows every recipient (F1)", "const own = all ? \"\" : ` AND l.user_id = ${Number(user.id)}`;", "const own = \"\";"],
  ["worker/src/commission.ts", "a closer correction moves the agent's row (F3)", "WHERE invoice_id = ?1 AND status != 'void' AND recipient_role = 'closer' ORDER BY id`", "WHERE invoice_id = ?1 AND status != 'void' ORDER BY id`"],
  ["worker/src/commission.ts", "an agent reads another agent's rows", "WHERE l.recipient_role = 'agent' AND l.user_id = ?1 AND l.status != 'void' ORDER BY l.id DESC LIMIT 300`", "WHERE l.recipient_role = 'agent' AND ?1 > 0 AND l.status != 'void' ORDER BY l.id DESC LIMIT 300`"],
  ["worker/src/commission.ts", "the kill switch is ignored", `ctx.on = sw?.value !== "off";`, "ctx.on = true;"],
  ["worker/src/commission.ts", "a renewal of an agent customer is assumed direct (R3)", `  if (!reqs.length && s2 !== undefined) reasons.push("agent_customer_repeat");`, ""],
  ["worker/src/commission.ts", "the settlement books before checking it won", `    if (after?.status !== "settled" || Number(after.settled_by) !== user.id || after.bank_ref !== bank) return err(`, `    if (false) return err(`],
  ["worker/src/staff.ts", "the payroll month view shows the agent's amount (F12)", "WHERE kind = 'earn' AND status != 'void' AND recipient_role = 'closer' AND invoice_id IN", "WHERE kind = 'earn' AND status != 'void' AND invoice_id IN"],
  ["worker/src/agent.ts", "a new request ignores the standing assignment", "draft ? null : t0, standing?.salesperson_id ?? null).first", "draft ? null : t0, null).first"],
];
for (const [file, name, from, to] of MUT) {
  n++;
  const src = readFileSync(join(root, file), "utf8");
  if (!src.includes(from)) { fail++; console.error(`FAIL mutation did not apply: ${name}`); continue; }
  const mdir = mkdtempSync(join(tmpdir(), "golive-n-m-"));
  cpSync(join(root, "worker"), join(mdir, "worker"), { recursive: true, filter: (p) => !p.includes("node_modules") });
  cpSync(join(root, "package.json"), join(mdir, "package.json"));
  for (const d of ["lib", "constants", "types"]) { try { cpSync(join(root, d), join(mdir, d), { recursive: true }); } catch { /* not every folder exists */ } }
  writeFileSync(join(mdir, file), src.replace(from, to));
  try { bundle(mdir, join(mdir, "w.mjs")); } catch { fail++; console.error(`FAIL mutation did not build: ${name}`); continue; }
  const res = await runtime(join(mdir, "w.mjs"));
  const bad = res.filter(([p]) => !p).map(([, m]) => m);
  if (!bad.length) { fail++; console.error(`FAIL mutation not caught: ${name}`); }
  else console.log(`caught: ${name} -> ${bad.slice(0, 2).join("; ")}`);
  rmSync(mdir, { recursive: true, force: true });
}
rmSync(dir, { recursive: true, force: true });
if (fail) { console.error(`go-live-n: ${fail} of ${n} failed`); process.exit(1); }
console.log(`go-live-n: ${checks} checks passed (${MUT.length} mutations caught) - agent partnership commission: no agent = the closer 10%; a qualified agent referral = the agent 7% + the verified closer 3% of the eligible net sales value, reconciled to the total; uncertain attribution (not won, no acceptance, another revision, no agent rates, a package conflict, a renewal of an agent customer, a dispute, the switch off) HELD for review, never direct; decisions by the CEO or super admin once, with the reason and a retrospective warning; reassignment and closer corrections never rewrite the agent's history; the agent sees only their own 7%, the salesperson only their own rate; the closer in payroll once, the agent never; payouts authorised then settled by a different person with the bank reference - one cash row under a true race, never twice`);
