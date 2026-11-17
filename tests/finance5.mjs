/* FINANCE WORKSPACE 5.0 (v1.312.0) - runtime guard: the WHOLE worker bundled
 * against SQLite with every migration applied (0197 and 0198 included), by
 * direct request as each role. Fixed clock: Tuesday 10-11-2026, 12:00
 * Malaysia time. Invented fixtures only - no production data.
 *
 * The CEO's "approve as per recommend", 15-11-2026 (CEO-1..CEO-14 in
 * claude/FINANCE-WORKSPACE-5.0-BLUEPRINT.md), Phase A + B:
 *   CEO-1   Money In counts verified receipts only; the rest "awaiting"
 *   CEO-2   one company at a time; accounts, movements and expenses name
 *           their company; no transfer, assignment or payment crosses
 *   F-2     reconciliation DIFFERENCE = SOURCE - CASH BOOK (the payroll
 *           example: 13,156.66 - 13,161.66 = -5.00, never -13,161.66)
 *   CEO-6   reviewed is not resolved; only the CEO accepts a difference
 *   CEO-4   the expense lifecycle: recorded, approved (the CEO; the COO for
 *           the CEO's own), authorised (the CEO), paid by Finance (the COO)
 *           with bank date, account and evidence - the only step that
 *           books cash; a paid expense is locked; never deleted
 *   F-10    a manual movement: CEO/COO only, its company and reason, the
 *           server's reference, once per idempotency key, never a module's
 *   F-12    a transfer is CEO/COO and stays inside one company
 *   CEO-10  the Super Admin reads Finance and never posts or corrects
 *   F-5     an agent payout (AGT-) is Commission, not a typed row
 *
 *   node tests/finance5.mjs              the current worker, then mutations
 *   NOMUT=1 node tests/finance5.mjs      the current worker only
 */
import { readFileSync, readdirSync, mkdtempSync, cpSync, writeFileSync, rmSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");
const bundle = (srcRoot, out) => {
  const entry = join(srcRoot, "finance5-entry.ts");
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
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(200).fill(0)]);

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
  const stored = new Map();
  const env = {
    DB: { prepare: shim, batch: async (list) => { db.exec("BEGIN"); try { for (const s of list) s._run(); db.exec("COMMIT"); } catch (e) { db.exec("ROLLBACK"); throw e; } return []; } },
    SESSION_PEPPER: "pepper", COMPANY_DOMAIN: "a2z.test", ALLOWED_ORIGINS: "https://portal.a2z.test",
    MEDIA: { put: async (k, body) => { if (body && typeof body === "object" && "getReader" in body) await new Response(body).arrayBuffer(); stored.set(k, true); }, get: async (k) => (stored.has(k) ? { body: "x", httpMetadata: { contentType: "image/png" } } : null), head: async () => null, list: async () => ({ objects: [] }), delete: async () => {} },
  };
  if (!globalThis.FixedLengthStream) globalThis.FixedLengthStream = class extends TransformStream { constructor() { super(); } };
  const U = { ceo: 1, sa: 2, coo: 3, admin: 4, aina: 5, hr: 6 };
  db.exec(`INSERT INTO users (id, name, full_name, email, role, is_active, password_hash, totp_enabled, totp_secret, employment_status, base_salary_cents, joined_on) VALUES
    (1,'Alif','Alif Owner','owner@a2z.test','ceo',1,'x',1,'JBSWY3DPEHPK3PXP','permanent',900000,'2024-01-01'),
    (2,'Root','System Root','root@a2z.test','super_admin',1,'x',1,'JBSWY3DPEHPK3PXP','permanent',0,'2024-01-01'),
    (3,'Ops','Ops Lead','ops@a2z.test','coo',1,'x',1,'JBSWY3DPEHPK3PXP','permanent',800000,'2024-01-01'),
    (4,'Adm','Admin Clerk','admin@a2z.test','admin',1,'x',1,'JBSWY3DPEHPK3PXP','permanent',300000,'2024-01-01'),
    (5,'Aina','Aina Seller','aina@a2z.test','sales_marketing',1,'x',1,'JBSWY3DPEHPK3PXP','permanent',300000,'2024-01-01'),
    (6,'Hana','Hana HR','hana@a2z.test','hr_admin',1,'x',1,'JBSWY3DPEHPK3PXP','permanent',400000,'2024-01-01')`);
  db.exec(`INSERT INTO system_meta (key, value) VALUES ('company_owner', '{"user_id":1}')`);
  for (let c = 1; c <= 4; c++) db.exec(`INSERT INTO customers (id, company, contact_person, created_by) VALUES (${c}, 'Client ${c} Sdn Bhd', 'Contact ${c}', 5)`);
  const ITEMS = (cents) => JSON.stringify([{ name: "Website", qty: 1, unit_price_cents: cents }]);
  const doc = db.prepare(`INSERT INTO sales_documents (id, doc_type, doc_number, customer_id, items, discount_cents, tax_percent, total_cents, payment_status, paid_at, created_at, created_by, salesperson_id, kind, issuer_code, payment_ref)
                          VALUES (?, 'INV', ?, ?, ?, 0, 0, ?, ?, ?, '2026-11-02 01:00:00', 5, 5, 'service', ?, ?)`);
  doc.run(101, "INV-T-101", 1, ITEMS(100000), 100000, "paid", "2026-11-05 02:00:00", "a2z", "MBB-101");   // A2Z, paid, to be verified by the CEO
  doc.run(102, "INV-T-102", 2, ITEMS(50000), 50000, "paid", "2026-11-06 02:00:00", "azoo", "MBB-102");   // AZ ONE, paid, not verified
  doc.run(103, "INV-T-103", 3, ITEMS(90000), 90000, "unpaid", null, "a2z", null);                         // A2Z, a part payment of RM 300
  db.exec(`INSERT INTO invoice_payments (id, invoice_id, amount_cents, received_on, reference, created_by) VALUES (7, 103, 30000, '2026-11-07', 'MBB-P7', 3)`);
  /* the payroll example: the bank run booked RM 13,161.66; payroll now totals RM 13,156.66 */
  db.exec(`INSERT INTO payroll_entries (user_id, month, basic_cents, commission_cents, allowance_cents, deduction_cents, net_cents) VALUES (5, '2026-08', 1315666, 0, 0, 0, 1315666)`);
  db.exec(`INSERT INTO payroll_payments (month, paid_by, paid_at) VALUES ('2026-08', 3, '2026-09-04 02:24:00')`);
  db.exec(`INSERT INTO cashflow_entries (id, entry_date, type, category, amount_cents, description, ref, created_by, effective_date, source_key) VALUES (50, '2026-09-04', 'out', 'salaries', 1316166, 'Payroll bank run 2026-08', 'PAYROLL-2026-08', 3, '2026-09-04', 'PAYROLL-2026-08')`);
  /* an agent payout settled by Finance (Commission 5.0, K-5) */
  db.exec(`INSERT INTO cashflow_entries (id, entry_date, type, category, amount_cents, description, ref, created_by, effective_date, source_key) VALUES (51, '2026-11-09', 'out', 'agent_commission', 7000, 'Agent commission payout AGT-9 - Ros', 'AGT-9', 3, '2026-11-09', 'AGT-9')`);

  const app = (await import(pathToFileURL(workerBundle).href + `?v=${Math.random()}`)).default;
  const tok = {};
  for (const id of Object.values(U)) { tok[id] = `t-${id}-${Math.random()}`; db.prepare(`INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, datetime('now', '+12 hours'), datetime('now'))`).run(sha(tok[id]), id); }
  const hdr = (uid, extra = {}) => ({ origin: "https://portal.a2z.test", cookie: `azone_session=${tok[uid]}; csrf_token=c1`, "x-csrf-token": "c1", "content-type": "application/json", ...extra });
  const call = async (p, uid, method = "GET", body) => {
    const r = await app.fetch(new Request(`https://api.a2z.test/api/v1/staff${p}`, { method, headers: hdr(uid), body: body === undefined ? undefined : JSON.stringify(body) }), env, { waitUntil() {} });
    const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch { /* not json */ }
    return { status: r.status, j, text };
  };
  const attach = async (id, uid) => (await app.fetch(new Request(`https://api.a2z.test/api/v1/staff/expenses/${id}/evidence`, { method: "POST", headers: hdr(uid, { "content-type": "image/png", "content-length": String(PNG.length) }), body: PNG }), env, { waitUntil() {} })).status;
  const n = (sql, ...a) => Number(db.prepare(sql).get(...a)?.n ?? 0);
  const row = (sql, ...a) => db.prepare(sql).get(...a);
  const view = async (company = "all", uid = U.ceo, from = "2026-11-01", to = "2026-11-30") => (await call(`/erp/cashbook?from=${from}&to=${to}&company=${company}`, uid)).j;
  const fmt = (x) => JSON.stringify(x)?.slice(0, 300);
  const R = "Checked against the bank statement";
  try {
    /* ---------- CEO-2: accounts belong to one company ---------- */
    ok((await call("/erp/banks", U.sa, "POST", { name: "SA Account", company: "a2z" })).status === 403, "CEO-10 the Super Admin cannot add an account");
    ok((await call("/erp/banks", U.admin, "POST", { name: "Admin Account", company: "a2z" })).status === 403, "an admin cannot add an account");
    ok((await call("/erp/banks", U.coo, "POST", { name: "No company" })).status === 400, "CEO-2 an account needs its company");
    const A = (await call("/erp/banks", U.coo, "POST", { name: "A2Z - Maybank", bank: "Maybank", number_masked: "•••• 5300", company: "a2z" })).j?.id;
    const B = (await call("/erp/banks", U.ceo, "POST", { name: "AZ ONE - Maybank", bank: "Maybank", number_masked: "•••• 8811", company: "azoo" })).j?.id;
    const C = (await call("/erp/banks", U.coo, "POST", { name: "A2Z - CIMB", bank: "CIMB", number_masked: "•••• 0412", company: "a2z" })).j?.id;
    /* v1.312.1 - the same account is not added twice; the list holds every company's accounts */
    ok((await call("/erp/banks", U.ceo, "POST", { name: "AZ ONE - Maybank again", bank: "Maybank", number_masked: "8811", company: "azoo" })).status === 409, "the same company account (same last four digits) is not added twice");
    ok((await call("/erp/banks", U.ceo, "POST", { name: "A2Z ending 8811", bank: "RHB", number_masked: "•••• 8811", company: "a2z" })).status === 201, "…another company may hold an account ending in the same digits");
    { const l = (await call("/erp/banks", U.coo)).j?.banks ?? []; ok(l.some((b) => b.company === "azoo") && l.some((b) => b.company === "a2z"), "the account list holds both companies' accounts (the drawer reads it whatever company the page shows)"); }
    ok(A && B && C && row(`SELECT company FROM bank_accounts WHERE id = ?`, A)?.company === "a2z" && row(`SELECT company FROM bank_accounts WHERE id = ?`, B)?.company === "azoo", "CEO-2 accounts are saved with their company", fmt([A, B, C]));
    ok((await call("/erp/cashbook?company=xyz", U.ceo)).status === 400, "CEO-2 an unknown company is refused");

    /* ---------- CEO-1: Money In is what the CEO verified ---------- */
    let all = await view("all");
    ok(all?.consolidated === true && all.company === "all", "the consolidated view says it is consolidated");
    ok(all?.totals?.in_cents === 0 && all.totals.awaiting_count === 3 && all.totals.awaiting_cents === 180000, "CEO-1 nothing verified yet: Money In RM 0; RM 1,800 awaiting (3 receipts)", fmt(all?.totals));
    ok(all?.items?.find((i) => i.key === "INV:101")?.counts === null && all.items.find((i) => i.key === "INV:101").awaiting === true, "CEO-1 an unverified receipt is shown, never counted", fmt(all?.items?.find((i) => i.key === "INV:101")));
    ok((await call("/docs/101/confirm-paid", U.ceo, "POST", { amount_cents: 100000, checked: true, payment_ref: "MBB-101" })).status === 201, "the CEO owner verifies INV-T-101");
    db.exec(`INSERT INTO invoice_payment_reports (invoice_id, issuer_code, amount_cents, received_on, method, reference, state, reported_by, payment_id) VALUES (103, 'a2z', 30000, '2026-11-07', 'bank_transfer', 'MBB-P7', 'verified', 5, 7)`);
    const a2z = await view("a2z"), azoo = await view("azoo");
    all = await view("all");
    ok(a2z?.totals?.in_cents === 130000 && a2z.totals.awaiting_cents === 0, "CEO-1 A2Z: RM 1,000 verified + the RM 300 part payment verified by its report = RM 1,300", fmt(a2z?.totals));
    ok(azoo?.totals?.in_cents === 0 && azoo.totals.awaiting_cents === 50000 && azoo.totals.awaiting_count === 1, "CEO-2 AZ ONE: its own unverified RM 500 only, awaiting", fmt(azoo?.totals));
    ok(all?.totals?.in_cents === 130000 && all.totals.awaiting_cents === 50000, "CEO-2 consolidated = A2Z + AZ ONE, when asked for", fmt(all?.totals));
    ok(!a2z.items.some((i) => i.key === "INV:102") && !azoo.items.some((i) => i.key === "INV:101"), "CEO-2 neither company sees the other's receipt");
    ok(a2z.exceptions.every((x) => x.company === "a2z") && azoo.exceptions.every((x) => x.company === "azoo"), "CEO-2 each company's checks are its own");

    /* ---------- F-5: an agent payout is Commission ---------- */
    const agt = all.items.find((i) => i.ref === "AGT-9");
    ok(agt?.source === "commission" && agt.group === "agent_commission" && !all.exceptions.some((x) => x.kind === "duplicate" && x.key === "CF:51"), "F-5 AGT- reads as Commission, never a typed row", fmt(agt));

    /* ---------- F-2: the reconciliation difference ---------- */
    const sep = await view("all", U.ceo, "2026-09-01", "2026-09-30");
    const pay = sep?.exceptions?.find((x) => x.kind === "out_of_step" && x.key === "CF:50");
    ok(pay && pay.source_cents === 1315666 && pay.booked_cents === 1316166 && pay.difference_cents === -500 && pay.mismatch === "amount", "F-2 payroll: source RM 13,156.66, cash book RM 13,161.66, difference -RM 5.00", fmt(pay));
    ok(sep?.totals?.difference_cents === -500, "F-2 the Total difference is -RM 5.00, never -RM 13,161.66", fmt(sep?.totals));
    ok(!(await view("a2z", U.ceo, "2026-09-01", "2026-09-30")).exceptions.some((x) => x.key === "CF:50"), "CEO-2 a movement with no account yet belongs to no company (consolidated only)");
    ok((await call("/erp/cashbook/assign-bank", U.coo, "POST", { item_key: "CF:50", bank_id: A })).status === 200, "the COO assigns the payroll run to the A2Z account");
    ok((await view("a2z", U.ceo, "2026-09-01", "2026-09-30")).totals.difference_cents === -500, "CEO-2 ...and it is now A2Z's, difference -RM 5.00");

    /* ---------- CEO-6: reviewed is not resolved ---------- */
    const key = "out_of_step|CF:50";
    ok((await call("/erp/cashbook/review", U.sa, "POST", { key, note: R })).status === 403, "CEO-10 the Super Admin cannot mark reviewed");
    ok((await call("/erp/cashbook/review", U.coo, "POST", { key, note: R })).status === 200, "the COO marks it reviewed");
    let p2 = (await view("all", U.ceo, "2026-09-01", "2026-09-30")).exceptions.find((x) => x.key === "CF:50" && x.kind === "out_of_step");
    ok(p2?.state === "reviewed" && p2.reviewed?.note === R, "CEO-6 reviewed - and still listed (not resolved)", fmt(p2));
    ok((await call("/erp/cashbook/accept", U.coo, "POST", { key, reason: "Bank paid 13,161.66 per statement" })).status === 403, "CEO-6 the COO cannot accept a difference");
    ok((await call("/erp/cashbook/accept", U.ceo, "POST", { key, reason: "short" })).status === 400, "CEO-6 acceptance needs a reason");
    ok((await call("/erp/cashbook/accept", U.ceo, "POST", { key, reason: "Bank paid 13,161.66 per statement" })).status === 200, "CEO-6 the CEO accepts it, with the reason");
    ok(!(await view("all", U.ceo, "2026-09-01", "2026-09-30")).exceptions.some((x) => x.key === "CF:50" && x.kind === "out_of_step"), "CEO-6 accepted = resolved: it leaves the list");
    ok((await call("/erp/cashbook/accept", U.ceo, "POST", { key, reason: "Bank paid 13,161.66 per statement" })).status === 409, "CEO-6 accepted once");
    const hist = (await call(`/erp/cashbook/history?key=${encodeURIComponent(key)}`, U.ceo)).j?.events ?? [];
    ok(hist.some((e) => e.action === "cashbook.review") && hist.some((e) => e.action === "cashbook.accept" && e.who_role === "ceo"), "the review history names who reviewed and who accepted", fmt(hist));

    /* ---------- F-10: a manual movement ---------- */
    const man = (uid, b) => call("/erp/cashflow", uid, "POST", { type: "in", amount: 1000, entry_date: "2026-11-08", category: "Capital", description: "Owner capital", reason: "Capital top-up by the owner", company: "a2z", idempotency_key: "key-0001-abcdef", ...b });
    ok((await man(U.admin)).status === 403, "F-10 admin cannot enter a manual movement");
    ok((await man(U.sa)).status === 403, "CEO-10 nor the Super Admin");
    ok((await man(U.coo, { company: undefined })).status === 400, "F-10 it names its company");
    ok((await man(U.coo, { reason: "" })).status === 400, "F-10 it gives its reason");
    ok((await man(U.coo, { idempotency_key: undefined })).status === 400, "F-10 it carries an idempotency key");
    ok((await man(U.coo, { category: "claims" })).status === 400 && (await man(U.coo, { category: "salaries" })).status === 400 && (await man(U.coo, { category: "sales" })).status === 400, "F-10 a module's money is never typed (claims, salaries, sales)");
    ok((await man(U.coo, { bank_id: B })).status === 400, "CEO-2 the account must be the same company's");
    const m1 = await man(U.coo, { ref: "INV-101", bank_id: A });
    ok(m1.status === 201 && /^MAN-/.test(m1.j?.ref ?? "") && n(`SELECT COUNT(*) AS n FROM cashflow_entries WHERE ref = 'INV-101'`) === 0, "F-10 the reference is the server's (MAN-...); a typed INV-101 never becomes a ref", fmt(m1.j));
    const m2 = await man(U.coo, { ref: "INV-101", bank_id: A });
    ok(m2.j?.replay === true && n(`SELECT COUNT(*) AS n FROM cashflow_entries WHERE ref LIKE 'MAN-%'`) === 1, "F-10 the same key twice: one row", fmt(m2.j));
    ok(row(`SELECT company FROM cashflow_entries WHERE ref LIKE 'MAN-%'`)?.company === "a2z", "CEO-2 the manual row carries its company");

    /* ---------- F-12: a transfer stays inside one company ---------- */
    const trf = (uid, from, to) => call("/erp/cashbook/transfer", uid, "POST", { date: "2026-11-09", from_bank_id: from, to_bank_id: to, amount: 200, description: "Float" });
    ok((await trf(U.admin, A, C)).status === 403, "F-12 admin cannot transfer");
    ok((await trf(U.coo, A, B)).status === 400, "CEO-2 no transfer between the two companies");
    ok((await trf(U.coo, A, C)).status === 201 && n(`SELECT COUNT(*) AS n FROM cashflow_entries WHERE transfer_id IS NOT NULL AND company = 'a2z'`) === 2, "F-12 a transfer between two A2Z accounts: one pair, A2Z");
    ok((await call(`/erp/cashbook/banks/${A}`, U.coo, "PATCH", { company: "azoo" })).status === 409, "CEO-2 an account with movements keeps its company");
    ok((await call("/erp/cashbook/assign-bank", U.coo, "POST", { item_key: "INV:102", bank_id: A })).status === 409, "CEO-2 an AZ ONE receipt is never assigned to an A2Z account");

    /* ---------- CEO-4: the expense lifecycle ---------- */
    ok((await call("/expenses", U.sa, "POST", { expense_date: "2026-11-05", amount: 500, category: "rent", company: "a2z" })).status === 403, "CEO-10 the Super Admin cannot record an expense");
    ok((await call("/expenses", U.admin, "POST", { expense_date: "2026-11-05", amount: 500, category: "rent" })).status === 400, "CEO-2 an expense names its company");
    ok((await call("/expenses", U.admin, "POST", { expense_date: "2026-11-05", amount: 500, category: "rent", company: "a2z", paid: true })).status === 400, "CEO-4 an expense is never paid at birth");
    const e1 = (await call("/expenses", U.admin, "POST", { expense_date: "2026-11-05", amount: 500, category: "rent", vendor: "Landlord", description: "Studio rent", company: "a2z" })).j?.id;
    const e2 = (await call("/expenses", U.admin, "POST", { expense_date: "2026-11-05", amount: 99, category: "software", vendor: "Canva", description: "Team plan", company: "a2z", recurring: true, due_day: 5 })).j?.id;
    ok(e1 && e2 && n(`SELECT COUNT(*) AS n FROM cashflow_entries WHERE ref IN ('EXP-${e1}', 'EXP-${e2}')`) === 0, "CEO-4 recorded (and recurring) expenses book no cash");
    const dueA = (await call("/erp/cashbook/due?company=a2z", U.ceo)).j?.due ?? [];
    ok(dueA.some((d) => d.key === `EXP-${e1}` && d.stage === "recorded") && !(await call("/erp/cashbook/due?company=azoo", U.ceo)).j?.due?.some((d) => d.key === `EXP-${e1}`), "Due Payments: the commitment is listed for A2Z only, as a commitment", fmt(dueA));
    ok((await call(`/expenses/${e1}/approve`, U.admin, "POST", {})).status === 403, "CEO-4 the recorder (admin) cannot approve");
    ok((await call(`/expenses/${e1}/approve`, U.coo, "POST", {})).status === 403, "CEO-4 the COO approves only the CEO's own expense");
    ok((await call(`/expenses/${e1}/pay`, U.coo, "POST", { paid_on: "2026-11-09", bank_id: A, payment_ref: "MBB-1" })).status === 409, "CEO-4 nothing is paid before approval and authorisation");
    ok((await call(`/expenses/${e1}/approve`, U.ceo, "POST", { due_on: "2026-11-20" })).status === 200, "CEO-4 the CEO approves (scheduled for 20-11)");
    ok((await call(`/expenses/${e1}`, U.admin, "PATCH", { amount: 900 })).status === 409, "CEO-4 an approved expense is no longer edited");
    ok((await call(`/expenses/${e1}/authorise`, U.coo, "POST", {})).status === 403, "CEO-4 only the CEO authorises the payment");
    ok((await call(`/expenses/${e1}/authorise`, U.ceo, "POST", {})).status === 200, "CEO-4 the CEO authorises");
    ok((await call(`/expenses/${e1}/pay`, U.ceo, "POST", { paid_on: "2026-11-09", bank_id: A, payment_ref: "MBB-1" })).status === 403, "CEO-4 the authoriser never completes the payment");
    ok((await call(`/expenses/${e1}/pay`, U.admin, "POST", { paid_on: "2026-11-09", bank_id: A, payment_ref: "MBB-1" })).status === 403, "CEO-4 admin cannot complete a payment");
    ok((await call(`/expenses/${e1}/pay`, U.coo, "POST", { paid_on: "2026-11-09", bank_id: A, payment_ref: "MBB-1" })).status === 409, "CEO-4 no payment without its evidence");
    ok((await attach(e1, U.admin)) === 200, "the evidence is attached");
    ok((await call(`/expenses/${e1}/pay`, U.coo, "POST", { paid_on: "2026-11-09", bank_id: B, payment_ref: "MBB-1" })).status === 400, "CEO-2 never paid from the other company's account");
    ok((await call(`/expenses/${e1}/pay`, U.coo, "POST", { paid_on: "2026-11-12", bank_id: A, payment_ref: "MBB-1" })).status === 400, "CEO-4 the bank date is today or earlier");
    ok((await call(`/expenses/${e1}/pay`, U.coo, "POST", { paid_on: "2026-11-09", bank_id: A, payment_ref: "MBB-55120" })).status === 200, "CEO-4 Finance (the COO) completes it");
    const cash = row(`SELECT amount_cents, effective_date, company, bank_id, type FROM cashflow_entries WHERE ref = 'EXP-${e1}'`);
    ok(cash && cash.amount_cents === 50000 && cash.effective_date === "2026-11-09" && cash.company === "a2z" && cash.bank_id === A && cash.type === "out", "CEO-4 the payment is ONE cash row: RM 500 out, the bank date, A2Z, its account", fmt(cash));
    ok((await call(`/expenses/${e1}/pay`, U.coo, "POST", { paid_on: "2026-11-09", bank_id: A, payment_ref: "MBB-55120" })).status === 409 && n(`SELECT COUNT(*) AS n FROM cashflow_entries WHERE ref LIKE 'EXP-${e1}%'`) === 1, "CEO-4 paid once");
    ok((await call(`/expenses/${e1}`, U.admin, "PATCH", { amount: 1 })).status === 409 && (await call(`/expenses/${e1}/cancel`, U.ceo, "POST", { reason: "Changed our mind about it" })).status === 409, "CEO-4 a paid expense is locked: never edited, never cancelled");
    ok((await call(`/expenses/${e1}`, U.admin, "DELETE")).status === 409, "CEO-4 an expense is never deleted");
    ok((await call(`/expenses/${e1}/paid`, U.coo, "POST", { paid: true })).status === 409, "CEO-4 the old one-click Paid is refused");
    const a2zAfter = await view("a2z");
    ok(a2zAfter.totals.out_cents === 50000 && a2zAfter.totals.in_cents === 230000 && a2zAfter.groups.out.some((g) => g.group === "gl6200" && g.cents === 50000), "A2Z: the paid expense is its Money Out (rent RM 500); the manual RM 1,000 its Money In; the unassigned agent payout is in no company yet", fmt(a2zAfter.totals));
    ok((await call(`/expenses/${e2}/cancel`, U.admin, "POST", { reason: "short" })).status === 400 && (await call(`/expenses/${e2}/cancel`, U.admin, "POST", { reason: "Recorded twice by mistake" })).status === 200
      && row(`SELECT status, cancel_reason FROM expenses WHERE id = ?`, e2)?.status === "cancelled", "CEO-4 cancelled with its reason, kept");
    const e3 = (await call("/expenses", U.ceo, "POST", { expense_date: "2026-11-06", amount: 120, category: "equipment", vendor: "Shop", company: "a2z" })).j?.id;
    ok((await call(`/expenses/${e3}/approve`, U.ceo, "POST", {})).status === 403 && (await call(`/expenses/${e3}/approve`, U.coo, "POST", {})).status === 200, "CEO-4 the CEO's own expense is approved by the COO, never by himself");
    const und = await call(`/expenses/${e1}/paid`, U.coo, "POST", { paid: false, reason: "Bank returned the transfer" });
    ok(und.status === 200 && row(`SELECT status, paid_at FROM expenses WHERE id = ?`, e1)?.status === "authorised" && n(`SELECT COUNT(*) AS n FROM cashflow_entries WHERE reversal_of = (SELECT id FROM cashflow_entries WHERE ref = 'EXP-${e1}')`) === 1, "an undone payment is a reversal row, and the expense is authorised again", und.text.slice(0, 160));

    /* ---------- CEO-10: the Super Admin reads ---------- */
    ok((await call("/erp/cashbook?company=a2z", U.sa)).status === 200 && (await call("/expenses?month=2026-11", U.sa)).status === 200, "CEO-10 the Super Admin reads Finance and its expenses");
    ok((await call(`/erp/cashbook/rows/51/reverse`, U.sa, "POST", { reason: "Testing the gate" })).status === 403, "CEO-10 ...and never reverses");
    ok((await call("/erp/cashbook", U.aina)).status === 403, "a salesperson has no Finance");

    /* ---------- the books: an AGT- or MAN- journal is reversed in Finance only ---------- */
    const jm = row(`SELECT id FROM journal_entries WHERE ref LIKE 'MAN-%'`);
    ok(jm && (await call(`/erp/gl/journal/${jm.id}/reverse`, U.ceo, "POST", { reason: "Testing the books gate" })).status === 409, "a manual Finance movement's journal is not reversed in Accounting", fmt(jm));

    /* ---------- reads write nothing ---------- */
    const before = [n(`SELECT COUNT(*) AS n FROM cashflow_entries`), n(`SELECT COUNT(*) AS n FROM cashbook_marks`), n(`SELECT COUNT(*) AS n FROM expenses`)].join();
    for (const co of ["a2z", "azoo", "all"]) { await view(co); await call(`/erp/cashbook/due?company=${co}`, U.ceo); }
    ok([n(`SELECT COUNT(*) AS n FROM cashflow_entries`), n(`SELECT COUNT(*) AS n FROM cashbook_marks`), n(`SELECT COUNT(*) AS n FROM expenses`)].join() === before, "the views read and write nothing");

    /* ---------- source ---------- */
    const bridge = read("worker/src/bridge.ts");
    ok(/await bookCash\(env, 0, ref,/.test(bridge) && !/INSERT INTO cashflow_entries/.test(bridge), "F-9 ELFIA books through the one booking (bookCash), dated the store's paid day");
    ok(/PHASE B/.test(read("worker/migrations/0197_finance_company.sql")) && !/\b(UPDATE|DELETE|DROP)\b/.test(read("worker/migrations/0197_finance_company.sql").replace(/^--.*$/gm, "")) && !/\b(UPDATE|DELETE|DROP)\b/.test(read("worker/migrations/0198_expense_lifecycle.sql").replace(/^--.*$/gm, "")), "0197 and 0198 only add columns and indexes");
  } catch (e) { ok(false, "the run threw", String(e?.stack ?? e).slice(0, 400)); }
  globalThis.Date = RealDate;
  return out;
}

let n = 0, fail = 0;
const report = (res) => { for (const [p, m] of res) { n++; if (!p) { fail++; console.error(`FAIL ${m}`); } } };
const dir = mkdtempSync(join(tmpdir(), "finance5-"));
const main = join(dir, "worker.mjs");
bundle(root, main);
report(await runtime(main, join(root, "worker/migrations")));
const checks = n;
if (process.env.NOMUT) {
  rmSync(dir, { recursive: true, force: true });
  if (fail) { console.error(`finance5: ${fail} of ${n} failed`); process.exit(1); }
  console.log(`finance5: ${n} checks passed`); process.exit(0);
}
if (fail) { console.error(`finance5: ${fail} of ${n} failed (mutations not run)`); process.exit(1); }

const MUT = [
  ["worker/src/erp.ts", "the same account added twice", "if (twin) return err(\"duplicate\"", "if (false) return err(\"duplicate\""],
  ["worker/src/cashbook.ts", "CEO-1 an unverified receipt counts as Money In", `counts: inv.confirmed ? "in" : null,`, `counts: "in",`],
  ["worker/src/cashbook.ts", "F-2 the difference is the booked amount", `difference_cents: source - booked,`, `difference_cents: -booked,`],
  ["worker/src/cashbook.ts", "CEO-6 a review hides a mismatch", `if (!isMismatch && m?.reviewed_at) return;`, `if (m?.reviewed_at) return;`],
  ["worker/src/cashbook.ts", "CEO-2 the company filter ignored", `const mine = (i: CashItem) => !company || i.company === company;`, `const mine = (i: CashItem) => !company || i.company === company || true;`],
  ["worker/src/cashbook.ts", "CEO-2 a transfer crosses companies", `if (!coT || coT !== companyOf(both[1]!.company)) return err(`, `if (false) return err(`],
  ["worker/src/cashbook.ts", "CEO-2 an account changes company after use", `if (Number(used?.n ?? 0) > 0) return err("company_locked"`, `if (false) return err("company_locked"`],
  ["worker/src/cashbook.ts", "CEO-2 a receipt assigned to the other company's account", `if (kc && kc !== bankCompany) {`, `if (false) {`],
  ["worker/src/cashbook.ts", "F-5 an agent payout reads as a typed row", `  : ref.startsWith("AGT-") ? "commission"`, `  : ref.startsWith("AGT-NEVER") ? "commission"`],
  ["worker/src/erp.ts", "F-10 admin enters a manual movement", `if (!canUser(user, "cashbook_correct")) return err("forbidden", "Only the CEO or COO enters a manual movement", 403);`, `if (!canUser(user, "cashflow_manage")) return err("forbidden", "Only the CEO or COO enters a manual movement", 403);`],
  ["worker/src/erp.ts", "F-10 a module's money typed by hand", `if (/^(sales|service|claims?|salar(y|ies)|salary_advances?|payroll|agent_commission|commission|transfer)$/i.test(category)) {`, `if (false) {`],
  ["worker/src/staff.ts", "CEO-4 paid without evidence", `if (!cur.receipt_key) return err("evidence_required"`, `if (false) return err("evidence_required"`],
  ["worker/src/staff.ts", "CEO-4 anyone with Expenses completes a payment", `if (!canUser(user, "expense_pay")) return err("forbidden", "Finance (the COO) completes an expense payment", 403);`, `if (!canUser(user, "expenses")) return err("forbidden", "Finance (the COO) completes an expense payment", 403);`],
  ["worker/src/staff.ts", "CEO-4 an approved expense edited", `if (expStage(cur) !== "recorded") return err("locked"`, `if (false) return err("locked"`],
  ["worker/src/staff.ts", "CEO-4 the CEO approves his own expense", `const turn = cur.recorder_role === "ceo" ? "coo" : "ceo";`, `const turn = "ceo";`],
  ["worker/src/permissions.ts", "CEO-6 the COO accepts a difference", `cashbook_accept: ["ceo"],`, `cashbook_accept: ["ceo", "coo"],`],
  ["worker/src/permissions.ts", "CEO-10 the Super Admin corrects the cash book", `cashbook_correct: ["ceo", "coo"],`, `cashbook_correct: ["super_admin", "ceo", "coo"],`],
];
for (const [file, name, from, to] of MUT) {
  n++;
  const src = readFileSync(join(root, file), "utf8");
  if (!src.includes(from)) { fail++; console.error(`FAIL mutation did not apply: ${name}`); continue; }
  const mdir = mkdtempSync(join(tmpdir(), "finance5-m-"));
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
if (fail) { console.error(`finance5: ${fail} of ${n} failed`); process.exit(1); }
console.log(`finance5: ${checks} checks passed (${MUT.length} mutations caught) - Finance 5.0: Money In is what the CEO verified, the rest awaiting; one company at a time - accounts, movements and expenses name their company and no transfer, assignment or payment crosses; the reconciliation difference is source minus cash book (-RM 5.00, never -RM 13,161.66); reviewed is not resolved and only the CEO accepts a difference; an expense is recorded, approved, authorised and paid by Finance with bank date, account and evidence - the only step that books cash, once - and is never edited after approval or deleted; a manual movement is the CEO/COO's, with its company, reason and the server's reference, once per key; the Super Admin reads and never posts; an agent payout reads as Commission`);
