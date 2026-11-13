/* SALES PAYMENT VERIFICATION (v1.272.0). Runtime guard: the WHOLE worker
 * (index.ts, bundled) against SQLite with every migration applied, by direct
 * request (claude/PAYMENT-VERIFICATION-AUDIT.md; the CEO, 10-11-2026:
 * "Every payment requires CEO verification", answers P1-P9 as recommended).
 *
 *   switch     the company owner alone turns it on, with a reason and a code
 *   report     sales on their own invoices, the COO and CCO on all; a report
 *              is NOT money (no payment row, no cash, no commission)
 *   verify     the CEO alone, with a code; never their own report until the
 *              COO checked its bank evidence; proof required; the account
 *              must be the invoice's company's; a retry changes nothing
 *   partial    two verified parts settle one invoice; outstanding is right
 *              at every step; only the last verification marks it paid,
 *              books cash once and writes the confirmation once
 *   commission direct 10%, agent 7% + closer 3%, written once, only at the
 *              final verification; nothing for a rejected or partial payment
 *   review     duplicates flagged and verified only with a reason;
 *              overpayment verified at most to the balance; reject, clarify,
 *              answer; reversal unmarks the invoice, reverses the cash and
 *              commission, keeps every row; the timeline is append only
 *   gates      with the switch on, Mark Paid, a direct part payment and voiding
 *              a verified part are refused; with it off, today's flow works
 * Then mutated copies must each fail a check. Invented people only.
 *
 *   node tests/payment-verify.mjs
 */
import { readFileSync, readdirSync, mkdtempSync, writeFileSync, cpSync, rmSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash, createHmac } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const root = fileURLToPath(new URL("..", import.meta.url));
const bundle = (srcRoot, entry, out) => execSync(`npx esbuild "${join(srcRoot, entry)}" --bundle --format=esm --platform=neutral --outfile="${out}" --log-level=error`, { cwd: root, stdio: "inherit" });
const SECRET = "JBSWY3DPEHPK3PXP";
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const b32 = (s) => { let bits = 0, v = 0; const o = []; for (const ch of s) { v = (v << 5) | B32.indexOf(ch); bits += 5; if (bits >= 8) { o.push((v >>> (bits - 8)) & 255); bits -= 8; } } return Buffer.from(o); };
const totpAt = (ms) => { const c = Math.floor(ms / 30000); const b = Buffer.alloc(8); b.writeUInt32BE(Math.floor(c / 2 ** 32), 0); b.writeUInt32BE(c >>> 0, 4); const h = createHmac("sha1", b32(SECRET)).update(b).digest(); const o = h[h.length - 1] & 15; return String((((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1e6).padStart(6, "0"); };
const sha = (s) => createHash("sha256").update(s).digest("hex");
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 1, 2, 3, 4, 5, 6, 7, 8]);

/* a Workers stream the node runtime lacks: put() reads the readable side */
globalThis.FixedLengthStream ??= class { constructor() { const t = new TransformStream(); this.readable = t.readable; this.writable = t.writable; } };

async function runtime(workerBundle) {
  const out = [];
  const ok = (c, m, why = "") => out.push([!!c, why && !c ? `${m} - ${why}` : m]);
  const db = new DatabaseSync(":memory:");
  for (const f of readdirSync(join(root, "worker/migrations")).filter((x) => x.endsWith(".sql")).sort()) {
    for (const st of readFileSync(join(root, "worker/migrations", f), "utf8").split(/;\s*\n/)) { try { db.exec(st); } catch { /* a statement SQLite reads differently, or a column 0081 already made */ } }
  }
  /* v1.283.0 - failure injection: the next write whose SQL matches throws, as a Worker failing mid-request would */
  let inject = null;
  const boom = (sql) => { if (inject && inject.test(sql)) { inject = null; throw new Error("injected failure"); } };
  const shim = (sql) => { const st = db.prepare(sql); let b = []; const o = {
    bind: (...a) => { b = a.map((x) => (x === undefined ? null : x)); return o; },
    first: async () => { boom(sql); return st.get(...b) ?? null; }, all: async () => ({ results: st.all(...b) }),
    run: async () => { boom(sql); return { meta: { changes: Number(st.run(...b).changes) } }; }, _run: () => { boom(sql); return { meta: { changes: Number(st.run(...b).changes) } }; } }; return o; };
  const store = new Map();
  const env = {
    DB: { prepare: shim, batch: async (list) => { db.exec("BEGIN"); try { const r = list.map((s) => s._run()); db.exec("COMMIT"); return r; } catch (e) { db.exec("ROLLBACK"); throw e; } } },
    SESSION_PEPPER: "pepper", COMPANY_DOMAIN: "a2z.test", ALLOWED_ORIGINS: "https://portal.a2z.test",
    MEDIA: {
      put: async (key, body, opts) => { store.set(key, { buf: Buffer.from(await new Response(body).arrayBuffer()), ct: opts?.httpMetadata?.contentType }); },
      head: async () => null, get: async (key) => (store.has(key) ? { body: store.get(key).buf, httpMetadata: { contentType: store.get(key).ct } } : null),
      list: async () => ({ objects: [] }), delete: async () => {},
    },
  };
  /* invented people: 1 the CEO (owner), 3 COO, 6 CCO, 7 HR, 9 and 15 sales, 12 a second CEO-role account, 21 an agent */
  db.exec(`INSERT INTO users (id, name, full_name, email, role, is_active, password_hash, totp_enabled, totp_secret) VALUES
    (1,'Owner','Owner Person','owner@a2z.test','ceo',1,'x',1,'${SECRET}'),
    (2,'Root','Root Person','root@a2z.test','super_admin',1,'x',1,'${SECRET}'),
    (3,'Coo','Coo Person','coo@a2z.test','coo',1,'x',1,'${SECRET}'),
    (6,'Cco','Cco Person','cco@a2z.test','cco',1,'x',1,'${SECRET}'),
    (7,'Hr','Hr Person','hr@a2z.test','hr_admin',1,'x',1,'${SECRET}'),
    (9,'Aina','Aina Seller','aina@a2z.test','sales_marketing',1,'x',1,'${SECRET}'),
    (12,'Second','Second Ceo','ceo2@a2z.test','ceo',1,'x',1,'${SECRET}'),
    (15,'Lia','Lia Seller','lia@a2z.test','sales_marketing',1,'x',1,'${SECRET}'),
    (21,'Ros','Ros Agent','ros@a2z.test','agent',1,'x',1,'${SECRET}')`);
  db.exec(`INSERT INTO system_meta (key, value) VALUES ('company_owner', '{"user_id":1,"set_by":2,"set_by_name":"Root","set_at":"2026-11-02 06:00:54","reason":"test"}')`);
  db.exec(`INSERT INTO commission_policies (id, version, name, status, effective_from, rate_kind, rate_bp, basis, reason, created_by, approved_by, approved_at, agent_rate_bp, agent_closer_rate_bp, agent_renewal_rule)
           VALUES (1, 1, 'Sales commission 2026', 'active', '2026-11-01', 'percent', 1000, 'net_of_tax_delivery', 'Approved 10 percent', 1, 1, '2026-10-30 02:00:00', 700, 300, 'review')`);
  db.exec(`INSERT INTO bank_accounts (id, name, bank, number_masked, active) VALUES (1, 'A2Z account', 'Maybank', '****1111', 1), (2, 'AZ ONE account', 'Maybank', '****2222', 1), (3, 'New account', 'CIMB', '****3333', 1)`);
  db.exec(`INSERT INTO company_review_decisions (record_kind, record_id, proposed_company, source_json, reason, version, reviewed_by) VALUES
    ('bank_accounts', 1, 'a2z', '{}', 'Named A2Z', 1, 1), ('bank_accounts', 2, 'azoo', '{}', 'Named AZ ONE', 1, 1)`);
  for (let c = 1; c <= 9; c++) db.exec(`INSERT INTO customers (id, company) VALUES (${c}, 'Client ${c} Sdn Bhd')`);
  const ITEMS = (cents) => JSON.stringify([{ name: "Website", qty: 1, unit_price_cents: cents }]);
  const doc = (id, type, cents, sp, issuer = "a2z", from = null, status = "unpaid", cust = 1) => db.prepare(
    `INSERT INTO sales_documents (id, doc_type, doc_number, customer_id, items, discount_cents, tax_percent, total_cents, payment_status, created_at, created_by, salesperson_id, kind, issuer_code, converted_from, revision)
     VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?, '2026-11-01 01:00:00', 1, ?, 'service', ?, ?, 0)`,
  ).run(id, type, `${type}-T-${id}`, cust, ITEMS(cents), cents, type === "INV" ? status : null, sp, issuer, from);
  doc(101, "INV", 120000, 9); doc(102, "INV", 50000, 9); doc(103, "INV", 80000, 15); doc(104, "INV", 30000, 6, "azoo");
  doc(105, "INV", 100000, 1); doc(107, "INV", 20000, 9); doc(108, "INV", 10000, 9); doc(109, "INV", 40000, 9); doc(110, "INV", 50000, 9);
  doc(111, "INV", 20000, 9); doc(112, "INV", 10000, 9); // v1.283.0 - B1 and B2 (failure injection)
  doc(113, "INV", 30000, 9); // v1.285.0 - the CEO marks a salesperson's invoice paid on her behalf
  /* an agent deal: quotation 206, the agent's won request assigned to Aina, the client's acceptance, invoice 106 */
  doc(206, "QT", 100000, 9, "a2z", null, null, 6); doc(106, "INV", 100000, 9, "a2z", 206, "unpaid", 6);
  db.prepare(`INSERT INTO agent_requests (id, agent_id, client_name, status, assigned_to, quotation_id, published_doc_id, published_revision, created_at, submitted_at) VALUES (1, 21, 'Client 6', 'won', 9, 206, 206, 0, '2026-11-01 01:00:00', '2026-11-01 01:00:00')`).run();
  db.prepare(`INSERT INTO quotation_acceptances (doc_id, revision, accepted_name, accepted_at) VALUES (206, 0, 'Puan Client', '2026-11-02 03:00:00')`).run();

  const RealDate = globalThis.Date; let fixed = new RealDate("2026-11-05T02:00:00Z").getTime();
  globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [fixed])); } static now() { return fixed; } };
  const code = () => { fixed += 31000; return totpAt(fixed); };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("{}", { status: 200 });
  const worker = (await import(pathToFileURL(workerBundle).href + `?v=${Math.random()}`)).default;
  const tok = {};
  for (const id of [1, 2, 3, 6, 7, 9, 12, 15, 21]) {
    tok[id] = `t-${id}-${Math.random()}`;
    db.prepare(`INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, datetime('now', '+12 hours'), datetime('now'))`).run(sha(tok[id]), id);
  }
  const hdr = (uid, ct = "application/json") => ({ "content-type": ct, origin: "https://portal.a2z.test", cookie: `azone_session=${tok[uid]}; csrf_token=c1`, "x-csrf-token": "c1" });
  const call = async (path, uid, method = "GET", body) => {
    const r = await worker.fetch(new Request(`https://api.a2z.test/api/v1/staff${path}`, { method, headers: hdr(uid), body: body ? JSON.stringify(body) : undefined }), env, { waitUntil() {} });
    const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch { /* */ }
    return { status: r.status, j, text };
  };
  const proof = async (rid, uid, bytes = PNG, ct = "image/png") => {
    const r = await worker.fetch(new Request(`https://api.a2z.test/api/v1/staff/payment-reports/${rid}/proof`, { method: "POST", headers: { ...hdr(uid, ct), "content-length": String(bytes.length) }, body: bytes }), env, { waitUntil() {} });
    return { status: r.status, text: await r.text() };
  };
  const n = (sql, ...a) => Number(db.prepare(sql).get(...a)?.n ?? 0);
  const inv = (id) => db.prepare(`SELECT payment_status, paid_at FROM sales_documents WHERE id = ?`).get(id);
  const parts = (id) => n(`SELECT COALESCE(SUM(amount_cents), 0) AS n FROM invoice_payments WHERE invoice_id = ? AND voided_at IS NULL`, id);
  const cashRows = (id) => n(`SELECT COUNT(*) AS n FROM cashflow_entries WHERE ref LIKE ? AND reversal_of IS NULL`, `INV-${id}%`);
  const confs = (id) => n(`SELECT COUNT(*) AS n FROM invoice_paid_confirmations WHERE invoice_id = ? AND revoked_at IS NULL`, id);
  const earn = (id) => db.prepare(`SELECT user_id, amount_cents, recipient_role, status FROM commission_ledger WHERE invoice_id = ? AND kind = 'earn' AND status != 'void' ORDER BY user_id`).all(id);
  const state = (rid) => db.prepare(`SELECT state FROM invoice_payment_reports WHERE id = ?`).get(rid)?.state;
  const report = (invId, uid, cents, reference, method = "bank_transfer", on = "2026-11-04") => call(`/docs/${invId}/payment-reports`, uid, "POST", { amount_cents: cents, received_on: on, method, reference });
  const verify = (rid, extra = {}) => call(`/payment-reports/${rid}/verify`, 1, "POST", { bank_id: 1, verify_method: "bank_statement", totp: code(), ...extra });
  const R = "Checked against the bank statement";

  try {
    /* ---------- the owner's switch ---------- */
    ok((await call("/payments/settings", 3, "PUT", { on: true, reason: "Start verification", totp: code() })).status === 403, "the COO cannot switch payment verification on");
    ok((await call("/payments/settings", 12, "PUT", { on: true, reason: "Start verification", totp: code() })).status === 403, "a second CEO-role account that is not the owner cannot either");
    ok((await call("/payments/settings", 1, "PUT", { on: true, reason: "Start verification" })).status === 401, "the owner needs a fresh authenticator code");
    ok((await report(101, 9, 60000, "MBB 0001")).j?.error?.code === "payment_verification_off", "while it is off, nobody can report a payment");
    const sw = await call("/payments/settings", 1, "PUT", { on: true, reason: "Start verification", totp: code() });
    ok(sw.status === 200 && n(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'payment.settings'`) === 1, "the owner switches it on, audited", sw.text);

    /* ---------- with it on, nobody finalises Paid by hand ---------- */
    const mp = await call("/docs/102", 3, "PATCH", { payment_status: "paid", payment_method: "bank_transfer" });
    ok(mp.status === 409 && mp.j?.error?.code === "payment_verification_on" && inv(102).payment_status === "unpaid" && cashRows(102) === 0, "the COO can no longer mark an invoice paid (no status, no cash)", mp.text);
    ok((await call("/docs/102", 1, "PATCH", { payment_status: "paid" })).status === 409, "...nor can the CEO by hand");
    const dp = await call("/docs/102/payments", 3, "POST", { amount_cents: 1000, received_on: "2026-11-04" });
    ok(dp.status === 409 && parts(102) === 0, "a direct part payment is refused too", dp.text);
    ok(/paid_received === true && await paymentVerificationOn\(env\)/.test(readFileSync(join(root, "worker/src/staff.ts"), "utf8")), "an invoice cannot be created already paid while it is on");
    /* v1.278.0 (the CEO, 11-11-2026: "paid seem doesnt change the status on sales for COO") - the documents
       list no longer offers the refused Paid dropdown while verification is on, and a refusal says why */
    {
      const ui = readFileSync(join(root, "components/portal/sales.tsx"), "utf8");
      ok(/paysByReport && pv\?\.on && d\.payment_status !== "void"/.test(ui) && /canPay && !pv\?\.on && d\.payment_status !== "void" && \(\s*<select/.test(ui),
        "while it is on, the Sales list shows the money state and Record payment instead of the Paid dropdown");
      ok(/r\.data\?\.error\?\.message \?\? L\(`\$\{d\.doc_number\} is unchanged/.test(ui), "a refused status change shows the server's reason, not only 'try again'");
    }

    /* ---------- reporting: scope, reference, a report is not money ---------- */
    ok((await report(103, 9, 80000, "MBB 0003")).status === 403, "a salesperson cannot report on someone else's invoice");
    ok((await report(101, 7, 60000, "MBB 0001")).status === 403, "HR cannot report payments");
    ok((await report(101, 9, 60000, "")).j?.error?.code === "invalid_reference", "a bank transfer without a reference is refused");
    ok((await report(101, 9, 60000, "<script>")).j?.error?.code === "invalid_reference", "...and a reference a bank cannot print");
    ok((await report(101, 9, 60000, "MBB 0001", "bank_transfer", "2026-11-09")).status === 400, "a received day in the future is refused");
    const r1 = await report(101, 9, 60000, "MBB 0001");
    const rid1 = r1.j?.id;
    ok(r1.status === 201 && state(rid1) === "reported", "the salesperson reports RM 600.00 on her invoice", r1.text);
    ok(parts(101) === 0 && inv(101).payment_status === "unpaid" && cashRows(101) === 0 && earn(101).length === 0, "the report is not money: no payment row, no cash, no commission");
    ok(r1.j?.verified_cents === 0 && r1.j?.pending_cents === 60000 && r1.j?.outstanding_cents === 120000 && r1.j?.status === "reported", "verified RM 0.00, pending RM 600.00, outstanding RM 1,200.00", JSON.stringify(r1.j ?? {}).slice(0, 200));
    ok(n(`SELECT COUNT(*) AS n FROM notifications WHERE user_id = 1 AND ref LIKE 'pay_report:%'`) === 1, "the CEO is told there is a payment to verify");
    const again = await report(101, 9, 60000, "MBB 0001");
    ok(again.j?.repeated === true && again.j?.id === rid1 && n(`SELECT COUNT(*) AS n FROM invoice_payment_reports WHERE invoice_id = 101`) === 1, "the same report sent twice is the first one");
    ok((await proof(rid1, 3)).status === 403, "only the reporter attaches its proof");
    ok((await proof(rid1, 9, Uint8Array.from([0x3c, 0x68, 0x74, 0x6d, 0x6c, 0x3e]), "image/png")).status >= 400, "a file that is not what it claims is refused");
    ok((await proof(rid1, 9)).status === 200, "the salesperson attaches the transfer proof");
    const pf = await call(`/payment-reports/${rid1}/proof`, 15, "GET");
    ok(pf.status === 403, "another salesperson cannot open it");
    ok((await call(`/payment-reports/${rid1}/proof`, 1, "GET")).status === 200, "the CEO can");

    /* ---------- who verifies ---------- */
    ok((await call(`/payment-reports/${rid1}/verify`, 9, "POST", { bank_id: 1, verify_method: "bank_statement", totp: code() })).status === 403, "the salesperson cannot verify (by direct request)");
    ok((await call(`/payment-reports/${rid1}/verify`, 3, "POST", { bank_id: 1, verify_method: "bank_statement", totp: code() })).status === 403, "the COO cannot verify");
    ok((await call(`/payment-reports/${rid1}/verify`, 1, "POST", { bank_id: 1, verify_method: "bank_statement" })).status === 401, "the CEO's verification needs a fresh code");
    ok((await verify(rid1, { bank_id: 2 })).j?.error?.code === "company_mismatch", "an AZ ONE account cannot receive an A2Z invoice's money");
    ok((await verify(rid1, { bank_id: 3 })).j?.error?.code === "bank_company_unknown", "an account with no company decision cannot be used");
    ok(state(rid1) === "reported" && parts(101) === 0, "...and nothing changed");

    /* ---------- partial: RM 600 of RM 1,200 ---------- */
    const v1 = await verify(rid1);
    ok(v1.status === 200 && state(rid1) === "verified" && parts(101) === 60000, "the CEO verifies RM 600.00", v1.text.slice(0, 200));
    ok(v1.j?.verified_cents === 60000 && v1.j?.outstanding_cents === 60000 && v1.j?.status === "partial" && inv(101).payment_status === "unpaid", "partially paid: verified RM 600.00, outstanding RM 600.00");
    ok(cashRows(101) === 0 && confs(101) === 0 && earn(101).length === 0, "no settlement, no confirmation, no commission on a partial payment");
    ok(db.prepare(`SELECT bank_id FROM cashbook_marks WHERE item_key = ?`).get(`PART:${db.prepare(`SELECT payment_id FROM invoice_payment_reports WHERE id = ?`).get(rid1).payment_id}`)?.bank_id === 1, "the receiving account is recorded on the payment");
    const v1b = await verify(rid1);
    ok(v1b.status === 200 && v1b.j?.repeated === true && parts(101) === 60000 && n(`SELECT COUNT(*) AS n FROM invoice_payment_events WHERE event = 'verified' AND report_id = ?`, rid1) === 1, "verifying again changes nothing and writes no second event");
    const r2 = await report(101, 9, 60000, "MBB 0002");
    const rid2 = r2.j?.id;
    await proof(rid2, 9);
    ok(r2.j?.verified_cents === 60000 && r2.j?.pending_cents === 60000 && r2.j?.status === "fully_reported", "the second RM 600.00 is pending; the verified amount stays RM 600.00");
    const v2 = await verify(rid2);
    ok(v2.status === 200 && v2.j?.invoice_paid === true && inv(101).payment_status === "paid" && String(inv(101).paid_at).startsWith("2026-11-04"), "the second verification settles it: paid, on the day the money landed", v2.text.slice(0, 200));
    ok(cashRows(101) === 1 && n(`SELECT amount_cents AS n FROM cashflow_entries WHERE ref = 'INV-101'`) === 120000, "the cash book gets RM 1,200.00 once, the existing booking");
    ok(confs(101) === 1 && n(`SELECT confirmed_by AS n FROM invoice_paid_confirmations WHERE invoice_id = 101`) === 1, "the CEO's verification is the paid confirmation");
    const e101 = earn(101);
    ok(e101.length === 1 && e101[0].user_id === 9 && e101[0].amount_cents === 12000, "direct sale: the closer's 10% (RM 120.00), written once", JSON.stringify(e101));
    ok(v2.j?.outstanding_cents === 0 && v2.j?.status === "paid", "outstanding RM 0.00, Paid - CEO verified");

    /* ---------- duplicates and the COO's full report ---------- */
    const d1 = await report(102, 9, 50000, "mbb-0001");
    ok(d1.j?.possible_duplicate === true, "the same reference in the same company is flagged", d1.text.slice(0, 200));
    await proof(d1.j.id, 9);
    ok((await verify(d1.j.id)).j?.error?.code === "duplicate_reason_required", "a flagged duplicate is verified only with a reason");
    const dv = await verify(d1.j.id, { dup_reason: "A different transfer from the same customer account" });
    ok(dv.status === 200 && inv(102).payment_status === "paid" && cashRows(102) === 1 && cashRows(101) === 1, "with a reason it is verified, and each invoice is booked once");
    const c1 = await report(103, 3, 80000, "CIMB 777");
    await proof(c1.j.id, 3);
    const cv = await verify(c1.j.id);
    ok(c1.status === 201 && cv.status === 200 && inv(103).payment_status === "paid", "the COO reports a full payment on any invoice; the CEO verifies it");

    /* ---------- the CCO, the other company ---------- */
    const k1 = await report(104, 6, 10000, "MBB 9001");
    await proof(k1.j.id, 6);
    ok((await verify(k1.j.id)).j?.error?.code === "company_mismatch", "the AZ ONE invoice cannot be paid into the A2Z account");
    const kv = await verify(k1.j.id, { bank_id: 2 });
    ok(kv.status === 200 && kv.j?.status === "partial" && kv.j?.outstanding_cents === 20000, "the CCO's partial payment on AZ ONE, verified into AZ ONE's account");
    const k2 = await report(104, 6, 5000, "MBB 9002");
    ok((await verify(k2.j.id, { bank_id: 2 })).j?.error?.code === "proof_required", "a payment with no proof attached cannot be verified");
    await proof(k2.j.id, 6);
    const race = await Promise.all([verify(k2.j.id, { bank_id: 2 }), verify(k2.j.id, { bank_id: 2 })]);
    ok(race.every((x) => x.status === 200) && parts(104) === 15000 && n(`SELECT COUNT(*) AS n FROM invoice_payments WHERE invoice_id = 104 AND voided_at IS NULL`) === 2, "two verifications at the same moment record the payment once", race.map((x) => x.text.slice(0, 80)).join(" | "));
    /* v1.297.0 - the CEO, 13-11-2026: a payment may land in either company's
       account ("Allow, flagged"). Only with the cross-company confirmation and
       a reason; recorded as such in the event, the audit and the cash book. */
    const k3 = await report(104, 6, 5000, "MBB 9003");
    await proof(k3.j.id, 6);
    ok((await verify(k3.j.id, { bank_id: 1 })).j?.error?.code === "company_mismatch", "another company's account without the cross-company confirmation is refused");
    ok((await verify(k3.j.id, { bank_id: 1, cross_company: true, cross_reason: "short" })).j?.error?.code === "company_mismatch", "...and with a reason under 10 characters");
    ok((await verify(k3.j.id, { bank_id: 3, cross_company: true, cross_reason: "Customer paid the wrong account" })).j?.error?.code === "bank_company_unknown", "...an account with no company is still refused, confirmation or not");
    ok(state(k3.j.id) === "reported" && parts(104) === 15000, "...and nothing changed");
    const kx = await verify(k3.j.id, { bank_id: 1, cross_company: true, cross_reason: "Customer transferred into the A2Z Maybank account" });
    ok(kx.status === 200 && parts(104) === 20000, "confirmed, the AZ ONE invoice is verified with the money in the A2Z account", kx.text.slice(0, 200));
    const kAudit = JSON.parse(db.prepare(`SELECT detail FROM audit_log WHERE action = 'payment.verified' AND entity_id = ? ORDER BY id DESC LIMIT 1`).get(String(k3.j.id))?.detail ?? "{}");
    ok(kAudit.cross_company === true && kAudit.invoice_company === "azoo" && kAudit.received_company === "a2z" && /A2Z Maybank/.test(kAudit.cross_reason), "the audit says it is cross-company, whose invoice, whose account and why", JSON.stringify(kAudit));
    const kMark = db.prepare(`SELECT bank_id, bank_note FROM cashbook_marks WHERE item_key = ?`).get(`PART:${db.prepare(`SELECT payment_id FROM invoice_payment_reports WHERE id = ?`).get(k3.j.id).payment_id}`);
    ok(kMark?.bank_id === 1 && /cross-company/.test(kMark?.bank_note ?? ""), "the cash book mark records the account it really landed in, marked cross-company", JSON.stringify(kMark));
    ok(n(`SELECT COUNT(*) AS n FROM invoice_payment_events WHERE event = 'verified' AND report_id = ? AND detail LIKE '%"cross_company":true%'`, k3.j.id) === 1, "the payment timeline carries the cross-company mark");

    /* ---------- v1.285.0 - the CEO's own Paid is final (the CEO, 12-11-2026) ----------
       "If I update the paid status, no further verification are required
       since I am a CEO!" and "need to know that when I click paid it is
       behalf of someone or it is belong to my own sales". The old P3 checks
       (the COO's evidence check before the CEO's own report) are replaced by
       these: the rule changed, by the owner's decision. */
    const o1 = await report(105, 1, 100000, "MBB 5555");
    ok(o1.status === 201 && state(o1.j.id) === "reported", "the CEO reports his own sale's payment");
    ok(n(`SELECT COUNT(*) AS n FROM notifications WHERE ref LIKE 'pay_evidence:%'`) === 0 && n(`SELECT COUNT(*) AS n FROM notifications WHERE ref LIKE 'pay_report:${o1.j.id}:%'`) === 0, "nobody is asked to check or verify the CEO's own payment");
    const evNo = await call(`/payment-reports/${o1.j.id}/evidence`, 3, "POST", { checked: true, note: "Seen in Maybank", totp: code() });
    ok(evNo.status === 409 && evNo.j?.error?.code === "not_needed" && state(o1.j.id) === "reported", "no COO evidence check exists any more", evNo.text.slice(0, 120));
    const second = await call(`/payment-reports/${o1.j.id}/verify`, 12, "POST", { bank_id: 1, verify_method: "bank_statement", totp: code() });
    ok(second.status === 403 && state(o1.j.id) === "reported" && n(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'auth.payment_verify_refused' AND user_id = 12`) === 1, "a second CEO-role account that is not the owner cannot verify (audited)", second.text.slice(0, 120));
    ok((await call(`/payment-reports/${o1.j.id}/verify`, 3, "POST", { bank_id: 1, verify_method: "bank_statement", totp: code() })).status === 403, "the COO cannot verify");
    ok((await call(`/payment-reports/${o1.j.id}/verify`, 6, "POST", { bank_id: 1, verify_method: "bank_statement", totp: code() })).status === 403, "the CCO cannot verify");
    ok((await call(`/payment-reports/${o1.j.id}/verify`, 1, "POST", { bank_id: 1, verify_method: "bank_statement" })).status === 401 && state(o1.j.id) === "reported", "the CEO still confirms with his authenticator code");
    const ov2 = await verify(o1.j.id);
    ok(ov2.status === 200 && inv(105).payment_status === "paid" && parts(105) === 100000 && cashRows(105) === 1, "the CEO's own Paid is final at once - no second person, proof optional", ov2.text.slice(0, 200));
    const ownEv = JSON.parse(db.prepare(`SELECT detail FROM invoice_payment_events WHERE event = 'verified' AND report_id = ?`).get(o1.j.id)?.detail ?? "{}");
    ok(ownEv.own_sale === true && ownEv.ceo_marked === true && ownEv.has_proof === false, "the record says it is the CEO's own sale", JSON.stringify(ownEv));
    ok(n(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'payment.ceo_marked_paid' AND entity_id = ?`, String(o1.j.id)) === 1, "...audited as the CEO marking it paid");
    ok(n(`SELECT COUNT(*) AS n FROM notifications WHERE ref LIKE 'pay_ceo_rec:${o1.j.id}:%' AND user_id IN (3, 6) AND message LIKE '%his own sale%'`) === 2, "the COO and CCO are told, for the record: his own sale");

    /* on behalf of a salesperson: Aina's invoice, the CEO marks it paid himself */
    const o2 = await report(113, 1, 30000, "MBB 1313");
    const ob = await verify(o2.j.id);
    ok(ob.status === 200 && inv(113).payment_status === "paid", "the CEO marks Aina's invoice paid himself");
    const obEv = JSON.parse(db.prepare(`SELECT detail FROM invoice_payment_events WHERE event = 'verified' AND report_id = ?`).get(o2.j.id)?.detail ?? "{}");
    ok(obEv.own_sale === false && obEv.salesperson_id === 9 && obEv.salesperson === "Aina Seller", "the record says it was on behalf of Aina", JSON.stringify(obEv));
    ok(n(`SELECT COUNT(*) AS n FROM notifications WHERE user_id = 9 AND ref = 'pay_ceo_sp:${o2.j.id}'`) === 1, "Aina is told it was marked paid on her behalf");
    ok(n(`SELECT COUNT(*) AS n FROM notifications WHERE ref LIKE 'pay_ceo_rec:${o2.j.id}:%' AND message LIKE '%on behalf of Aina Seller%'`) === 2, "the COO and CCO are told: on behalf of Aina");
    ok(earn(113).length > 0 && earn(113).every((e) => e.user_id === 9), "commission stays with the invoice's closer, never moved to the CEO", JSON.stringify(earn(113)));

    /* the COO's Paid request still waits for the CEO */
    const c2 = await report(110, 3, 50000, "MBB 1100");
    await proof(c2.j.id, 3);
    ok(state(c2.j.id) === "reported" && inv(110).payment_status !== "paid" && n(`SELECT COUNT(*) AS n FROM notifications WHERE user_id = 1 AND ref LIKE 'pay_report:${c2.j.id}:%'`) === 1, "the COO's Paid request waits for the CEO, who is told");

    /* ---------- clarify, answer, reject ---------- */
    const j1 = await report(107, 9, 20000, "MBB 7007");
    await proof(j1.j.id, 9);
    ok((await call(`/payment-reports/${j1.j.id}/evidence`, 3, "POST", { checked: true, note: "Seen in the statement", totp: code() })).status === 409 && state(j1.j.id) === "reported", "a salesperson's report needs no COO evidence check - the CEO verifies it");
    ok((await call(`/payment-reports/${j1.j.id}/clarify`, 1, "POST", { question: "Which account did it go to?" })).status === 200 && state(j1.j.id) === "clarify", "the CEO asks a question");
    ok(n(`SELECT COUNT(*) AS n FROM notifications WHERE user_id = 9 AND ref LIKE 'pay_q:%'`) === 1, "...the reporter is told");
    ok((await verify(j1.j.id)).status === 409, "a payment with an open question cannot be verified");
    ok((await call(`/payment-reports/${j1.j.id}/answer`, 15, "POST", { answer: "Not mine" })).status === 403, "only the reporter answers");
    ok((await call(`/payment-reports/${j1.j.id}/answer`, 9, "POST", { answer: "The A2Z Maybank account" })).status === 200 && state(j1.j.id) === "reported", "the reporter answers; it is back for review");
    ok((await call(`/payment-reports/${j1.j.id}/reject`, 1, "POST", { reason: "short", totp: code() })).status === 400, "a rejection needs a reason");
    const rj = await call(`/payment-reports/${j1.j.id}/reject`, 1, "POST", { reason: "No such transfer in the statement", totp: code() });
    ok(rj.status === 200 && state(j1.j.id) === "rejected" && parts(107) === 0 && earn(107).length === 0 && inv(107).payment_status === "unpaid", "a rejected payment is not money and earns nothing");
    ok(db.prepare(`SELECT proof_key FROM invoice_payment_reports WHERE id = ?`).get(j1.j.id)?.proof_key, "...its evidence is kept");

    /* ---------- overpayment ---------- */
    const ovp = await report(108, 9, 15000, "MBB 8008");
    await proof(ovp.j.id, 9);
    ok(ovp.status === 201 && ovp.j?.over_cents === 5000, "RM 150.00 on a RM 100.00 invoice is accepted and flagged: RM 50.00 over");
    ok((await verify(ovp.j.id, { amount_cents: 15000 })).j?.error?.code === "over_balance", "the CEO cannot verify more than the balance");
    const ovv = await verify(ovp.j.id);
    ok(ovv.status === 200 && parts(108) === 10000 && inv(108).payment_status === "paid", "verified at the balance; the excess is never applied anywhere");

    /* ---------- the agent deal: 7% + 3% ---------- */
    const a1 = await report(106, 9, 100000, "MBB 6006");
    await proof(a1.j.id, 9);
    ok((await verify(a1.j.id)).status === 200 && inv(106).payment_status === "paid", "the agent deal is verified in full");
    const e106 = earn(106);
    ok(e106.length === 2 && e106.find((r) => r.user_id === 21)?.amount_cents === 7000 && e106.find((r) => r.user_id === 9)?.amount_cents === 3000, "agent sale: the agent 7% (RM 70.00), the closer 3% (RM 30.00)", JSON.stringify(e106));

    /* ---------- reversal ---------- */
    const pid2 = db.prepare(`SELECT payment_id FROM invoice_payment_reports WHERE id = ?`).get(rid2).payment_id;
    ok((await call(`/payment-reports/${rid2}/reverse`, 1, "POST", { reason: "Bounced" })).status === 400, "a reversal needs a real reason");
    ok((await call(`/docs/101/payments/${pid2}/void`, 1, "POST", { reason: "Trying the old door" })).status === 409, "a verified payment cannot be voided by the old part-payment door");
    ok((await call("/docs/101", 1, "PATCH", { payment_status: "unpaid" })).status === 409, "...nor its invoice unmarked by hand");
    const rv = await call(`/payment-reports/${rid2}/reverse`, 1, "POST", { reason: "The transfer bounced back", totp: code() });
    ok(rv.status === 200 && rv.j?.invoice_unpaid === true && inv(101).payment_status === "unpaid", "the CEO reverses the second payment: the invoice is unpaid again", rv.text.slice(0, 200));
    ok(parts(101) === 60000 && db.prepare(`SELECT voided_at FROM invoice_payments WHERE id = ?`).get(pid2)?.voided_at, "the payment row is voided, never deleted");
    ok(confs(101) === 0 && n(`SELECT COUNT(*) AS n FROM cashflow_entries WHERE ref = 'INV-101'`) === 1 && n(`SELECT COUNT(*) AS n FROM cashflow_entries WHERE reversal_of = (SELECT id FROM cashflow_entries WHERE ref = 'INV-101')`) === 1, "the confirmation is taken back and the cash row reversed - both rows kept");
    ok(earn(101).length === 0, "the commission is voided before payroll");
    let blocked = 0;
    try { db.exec(`UPDATE invoice_payment_events SET event = 'x'`); } catch { blocked++; }
    try { db.exec(`DELETE FROM invoice_payment_events`); } catch { blocked++; }
    ok(blocked === 2 && n(`SELECT COUNT(*) AS n FROM invoice_payment_events WHERE invoice_id = 101`) >= 6, "the payment timeline is append only");
    const tl = await call("/docs/101/payment-reports", 9, "GET");
    const evs = (tl.j?.events ?? []).map((e) => e.event);
    ok(["reported", "proof_uploaded", "verified", "outstanding_updated", "invoice_paid", "reversed"].every((e) => evs.includes(e)), "the timeline shows every real step", evs.join(","));

    /* ---------- scope of the Payments tab ---------- */
    const lia = await call("/payments", 15, "GET");
    ok(lia.status === 200 && (lia.j?.reports ?? []).every((r) => r.salesperson_id === 15 || r.reported_by === 15) && (lia.j?.invoices ?? []).every((i) => i.salesperson_id === 15), "a salesperson sees only her own invoices and reports");
    const ceo = await call("/payments", 1, "GET");
    ok(ceo.j?.can?.verify === true && (ceo.j?.banks ?? []).find((b) => b.id === 1)?.company === "a2z", "the CEO sees the queue and each account's company");
    ok((await call("/payments", 9, "GET")).j?.banks?.length === 0, "...a salesperson sees no bank accounts");
    const pic = await call("/docs/104/payment-reports", 6, "GET");
    ok(pic.j?.verified_cents === parts(104) && pic.j?.outstanding_cents === 30000 - parts(104), "the drawer's figures are the payment record's");

    /* ---------- v1.283.0 Track B (Payment Verification 3.0) ---------- */
    /* B4 - a receipt alone is not proof */
    const b4 = await report(111, 9, 20000, "MBB 1110");
    await proof(b4.j.id, 9);
    const rcpt = await verify(b4.j.id, { verify_method: "receipt_only" });
    ok(rcpt.status === 400 && state(b4.j.id) === "reported" && parts(111) === 0, "B4: 'receipt only' is not accepted as a verification method", rcpt.text.slice(0, 160));
    /* B1 - the verification is one atomic step: a failure between the claim and the money changes nothing */
    inject = /INSERT INTO invoice_payments/;
    const crash1 = await verify(b4.j.id).catch((e) => ({ status: 0, text: String(e) }));
    inject = null;
    ok(crash1.status !== 200 && state(b4.j.id) === "reported" && parts(111) === 0 && n(`SELECT COUNT(*) AS n FROM invoice_payment_events WHERE event = 'verified' AND report_id = ?`, b4.j.id) === 0, "B1: a failure mid-verify leaves the report waiting and no money - never verified without its payment", `${crash1.status} ${state(b4.j.id)} ${parts(111)}`);
    const v111 = await verify(b4.j.id);
    ok(v111.status === 200 && parts(111) === 20000 && inv(111).payment_status === "paid" && cashRows(111) === 1 && confs(111) === 1 && db.prepare(`SELECT payment_id FROM invoice_payment_reports WHERE id = ?`).get(b4.j.id)?.payment_id > 0, "B1: verified again, it is recorded once, linked to its payment, and settles", v111.text.slice(0, 160));
    /* B2 - a settlement that stopped half way is finished by the retry, never doubled */
    const b2 = await report(112, 9, 10000, "MBB 1120");
    await proof(b2.j.id, 9);
    inject = /INSERT OR IGNORE INTO invoice_paid_confirmations/;
    const crash2 = await verify(b2.j.id).catch((e) => ({ status: 0, text: String(e) }));
    inject = null;
    ok(crash2.status !== 200 && inv(112).payment_status === "paid" && confs(112) === 0 && earn(112).length === 0, "B2 (setup): the settlement stopped after 'paid' - no confirmation, no commission yet", `${crash2.status} ${inv(112).payment_status} ${confs(112)}`);
    const again2 = await verify(b2.j.id);
    ok(again2.status === 200 && again2.j?.repeated === true && confs(112) === 1 && cashRows(112) === 1 && parts(112) === 10000 && n(`SELECT COUNT(*) AS n FROM invoice_payment_events WHERE event = 'invoice_paid' AND invoice_id = 112`) === 1, "B2: the retry finishes the settlement - one confirmation, one cash row, one payment", again2.text.slice(0, 160));
    const again3 = await verify(b2.j.id);
    ok(again3.status === 200 && confs(112) === 1 && cashRows(112) === 1 && n(`SELECT COUNT(*) AS n FROM invoice_payment_events WHERE event = 'invoice_paid' AND invoice_id = 112`) === 1 && n(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'invoice.paid_confirm' AND entity_id = '112'`) === 1, "B2: a further retry changes nothing");
    /* B5 - Verified this month is the Malaysian month */
    const vr = db.prepare(`SELECT id FROM invoice_payment_reports WHERE state = 'verified' ORDER BY id`).all().map((r) => r.id);
    db.prepare(`UPDATE invoice_payment_reports SET decided_at = '2026-10-31 17:30:00' WHERE id = ?`).run(vr[0]); // 01:30 MYT on 1 November: November
    db.prepare(`UPDATE invoice_payment_reports SET decided_at = '2026-11-30 16:30:00' WHERE id = ?`).run(vr[1]); // 00:30 MYT on 1 December: not November
    for (const id of vr.slice(2)) db.prepare(`UPDATE invoice_payment_reports SET decided_at = '2026-11-05 02:00:00' WHERE id = ?`).run(id);
    const want = db.prepare(`SELECT verified_cents, decided_at FROM invoice_payment_reports WHERE state = 'verified'`).all()
      .filter((r) => new RealDate(new RealDate(`${r.decided_at.replace(" ", "T")}Z`).getTime() + 8 * 3600e3).toISOString().slice(0, 7) === "2026-11").reduce((a, r) => a + r.verified_cents, 0);
    const tiles = (await call("/payments", 1, "GET")).j?.tiles;
    ok(vr.length >= 3 && tiles?.verified_month_cents === want, "B5: Verified this month counts the Malaysian month (1 Nov 01:30 MYT in, 1 Dec 00:30 MYT out)", `${tiles?.verified_month_cents} vs ${want}`);
    /* B6 - the cross-invoice audit trail, read only */
    const au = await call("/payments/events?limit=5", 1, "GET");
    const ids = (au.j?.events ?? []).map((e) => e.id);
    ok(au.status === 200 && ids.length === 5 && ids.every((x, i) => i === 0 || x < ids[i - 1]) && au.j.events.every((e) => "doc_number" in e && "actor" in e), "B6: the CEO reads the payment audit trail, newest first", au.text.slice(0, 160));
    ok((await call("/payments/events", 3, "GET")).status === 200 && (await call("/payments/events", 6, "GET")).status === 200, "B6: the COO and the CCO read it too");
    ok((await call("/payments/events", 9, "GET")).status === 403 && (await call("/payments/events", 7, "GET")).status === 403, "B6: a salesperson and HR cannot (by direct request)");
    ok((await call("/payments/events", 1, "POST", {})).status !== 200 && n(`SELECT COUNT(*) AS n FROM invoice_payment_events`) > 0, "B6: it writes nothing");
    /* B3 - switching off never bypasses a pending verification */
    const waitingNow = n(`SELECT COUNT(*) AS n FROM invoice_payment_reports WHERE state IN ('reported', 'evidence_checked', 'clarify')`);
    const offTry = await call("/payments/settings", 1, "PUT", { on: false, reason: "Back to the old flow for a test", totp: code() });
    ok(waitingNow > 0 && offTry.status === 409 && offTry.j?.error?.code === "pending_reports", "B3: the owner cannot switch off while reported payments wait", `${waitingNow} ${offTry.text.slice(0, 160)}`);
    for (const r of db.prepare(`SELECT id FROM invoice_payment_reports WHERE state IN ('reported', 'evidence_checked', 'clarify')`).all()) {
      await call(`/payment-reports/${r.id}/reject`, 1, "POST", { reason: "Closing the test queue before switching off", totp: code() });
    }

    /* ---------- off again: today's flow, unchanged ---------- */
    await call("/payments/settings", 1, "PUT", { on: false, reason: "Back to the old flow for a test", totp: code() });
    const old = await call("/docs/109", 3, "PATCH", { payment_status: "paid", payment_method: "bank_transfer" });
    ok(old.status === 200 && inv(109).payment_status === "paid" && cashRows(109) === 1, "switched off, the COO marks a legacy invoice paid as before", old.text);
    ok((await report(109, 9, 100, "MBB 1")).status === 409, "...and reports are refused");
    /* B3 - even switched off, a report still waiting (from before) is never bypassed by Mark Paid or a part payment */
    db.prepare(`INSERT INTO invoice_payment_reports (invoice_id, issuer_code, amount_cents, received_on, method, reference, reported_by, state) VALUES (110, 'a2z', 5000, '2026-11-04', 'bank_transfer', 'MBB 9110', 9, 'reported')`).run();
    const mp110 = await call("/docs/110", 3, "PATCH", { payment_status: "paid", payment_method: "bank_transfer" });
    ok(mp110.status === 409 && inv(110).payment_status !== "paid" && cashRows(110) === 0, "B3: switched off, Mark Paid is refused on an invoice whose reported payment still waits", mp110.text.slice(0, 160));
    const pp110 = await call("/docs/110/payments", 3, "POST", { amount_cents: 5000, received_on: "2026-11-04", method: "bank_transfer", reference: "MBB 9110" });
    ok(pp110.status === 409 && parts(110) === 0, "B3: ...and so is a direct part payment", pp110.text.slice(0, 160));
  } catch (e) {
    out.push([false, `runtime: ${e?.stack ?? e}`]);
  } finally {
    globalThis.Date = RealDate;
    globalThis.fetch = realFetch;
  }
  return out;
}

let fail = 0, n = 0;
const report = (list) => { for (const [p, m] of list) { n++; if (!p) { fail++; console.error(`FAIL ${m}`); } } };
const NOMUT = process.env.NOMUT === "1";
const dir = mkdtempSync(join(tmpdir(), "pv-"));
bundle(root, "worker/src/index.ts", join(dir, "worker.mjs"));
report(await runtime(join(dir, "worker.mjs")));
const checks = n;

const V = "worker/src/payment-verify.ts", S = "worker/src/staff.ts";
const MUT = [
  /* v1.285.0 - the CEO's own Paid is final; whose sale it is, is recorded */
  [V, "every CEO Paid is recorded as his own sale", [["    const ownSale = inv.salesperson_id === user.id;", "    const ownSale = true;"]]],
  [V, "any CEO-role account verifies", [["const verifier = (u: StaffUser) => can(u.role, \"payment_verify\") && isExecutiveOwner(u);", "const verifier = (u: StaffUser) => can(u.role, \"payment_verify\");"]]],
  [V, "the COO and CCO are not told of the CEO's own Paid", [["      for (const x of execs ?? []) await notify(", "      for (const x of [] as { id: number }[]) await notify("]]],
  [V, "the salesperson is not told it was on her behalf", [["      if (inv.salesperson_id && !ownSale) await notify(", "      if (false) await notify("]]],
  [V, "any company's account takes the money, unflagged", [["const crossCompany = bank.company !== rep.issuer_code;", "const crossCompany = false;"]]],
  [V, "an unassigned account takes the money", [["if (!bank.company) return err(\"bank_company_unknown\"", "if (false) return err(\"bank_company_unknown\""]]],
  [V, "a cross-company receipt without its confirmation", [["if (crossCompany && (body?.cross_company !== true || crossReason.length < 10)) {", "if (false) {"]]],
  [V, "a cross-company receipt not recorded", [["...sale, ...(cross ?? {}),\n    });", "...sale,\n    });"]]],
  [V, "a partial payment settles the invoice", [["  if (verified < inv.total_cents) return false;\n", ""]]],
  [V, "the invoice is never settled", [["    const paid = await settle(env, user, inv, bankId, rep.reference);", "    const paid = false;"]]],
  [V, "duplicates are not flagged", [["      if (refKey) {\n        const d1", "      if (false) {\n        const d1"]]],
  [V, "no proof needed", [["if (!rep.proof_key && !ownReport) return err(\"proof_required\"", "if (false) return err(\"proof_required\""]]],
  [V, "verify needs no fresh code", [["    const stepUp = await requireFreshTotp(env, user, body?.totp, err, \"verify this payment\");\n    if (stepUp) return stepUp;\n", ""]]],
  [V, "a retried verify pays again", [["          WHERE id = ?6 AND state = ?7 AND payment_id IS NULL\n", "          WHERE id = ?6 AND ?7 IS NOT NULL\n"], ["SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7 WHERE EXISTS (SELECT 1 FROM invoice_payment_reports WHERE id = ?8 AND state = 'verified' AND payment_id IS NULL)", "SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7 WHERE ?8 IS NOT NULL"]]],
  /* v1.283.0 - Track B */
  [V, "B1: verify runs as separate writes", [["    const done = await env.DB.batch(steps);", "    const done = []; for (const st of steps) done.push(await st.run());"]]],
  [V, "B2: a retry does not finish a stopped settlement", [["        const paidNow = rep.payment_id ? await settle(env, user, inv, rep.bank_id, rep.reference) : false;", "        const paidNow = false;"]]],
  [V, "B2: an already-paid invoice is never resumed", [["    if (cur?.payment_status !== \"paid\") return false;\n  }", "    return false;\n  }"]]],
  [V, "B3: the switch goes off over pending reports", [["      if (nWait > 0) return err(\"pending_reports\"", "      if (false) return err(\"pending_reports\""]]],
  [S, "B3: switched off, Mark Paid bypasses a pending report", [["        if (Number(waiting?.n ?? 0) > 0) return err(\"payment_report_pending\"", "        if (false) return err(\"payment_report_pending\""]]],
  ["worker/src/business.ts", "B3: switched off, a part payment bypasses a pending report", [["      if (Number(waitingRep?.n ?? 0) > 0) return err(\"payment_report_pending\"", "      if (false) return err(\"payment_report_pending\""]]],
  [V, "B4: a receipt alone verifies", [["const VERIFY_METHODS = [\"bank_statement\", \"bank_app\"] as const;", "const VERIFY_METHODS = [\"bank_statement\", \"bank_app\", \"receipt_only\"] as const;"]]],
  [V, "B5: the month is the UTC month", [["substr(datetime(r.decided_at, '+8 hours'), 1, 7) = ?1", "substr(r.decided_at, 1, 7) = ?1"]]],
  [V, "B6: anyone reads the audit trail", [["      return err(\"forbidden\", \"Only the CEO, COO and CCO read the payment audit trail\", 403);", "      void 0;"]]],
  [V, "anyone reports on any invoice", [["  return REPORT_ALL_ROLES.includes(user.role) || inv.salesperson_id === user.id;", "  return true;"]]],
  [V, "the COO's evidence check comes back", [["    return err(\"not_needed\", \"No evidence check is needed: the CEO's own payment is final when the CEO verifies it.\", 409);\n", ""]]],
  [V, "a reversal leaves the invoice paid", [["if (inv.payment_status === \"paid\" && (await verifiedOf(env, inv.id)) < inv.total_cents) {", "if (false) {"]]],
  [V, "anyone may verify", [["  if (!verifier(user)) {", "  if (false) {"]]],
  [V, "more than the balance is verified", [["    if (asked > balance) return err(\"over_balance\"", "    if (false) return err(\"over_balance\""], ["WHERE invoice_id = ?8 AND voided_at IS NULL), 0) >= ?3`,", "WHERE invoice_id = ?8 AND voided_at IS NULL), 0) >= 0 - ?3`,"]]],
  [S, "Mark Paid still works with verification on", [["        if (body!.payment_status === \"paid\") return err(\"payment_verification_on\"", "        if (false) return err(\"payment_verification_on\""]]],
  /* v1.285.0 - the permission alone no longer decides (the owner check stands too), so the COO is let through at the one gate */
  [V, "the COO may verify", [["const verifier = (u: StaffUser) => can(u.role, \"payment_verify\") && isExecutiveOwner(u);", "const verifier = (u: StaffUser) => (can(u.role, \"payment_verify\") && isExecutiveOwner(u)) || u.role === \"coo\";"]]],
];
for (const [file, name, reps] of NOMUT ? [] : MUT) {
  n++;
  let src = readFileSync(join(root, file), "utf8");
  let applied = true;
  for (const [from, to] of reps) { if (!src.includes(from)) { applied = false; break; } src = src.replace(from, to); }
  if (!applied) { fail++; console.error(`FAIL mutation did not apply: ${name}`); continue; }
  const mdir = mkdtempSync(join(tmpdir(), "pv-m-"));
  cpSync(join(root, "worker"), join(mdir, "worker"), { recursive: true, filter: (s) => !s.includes("node_modules") });
  cpSync(join(root, "package.json"), join(mdir, "package.json"));
  for (const d of ["lib", "constants", "types"]) { try { cpSync(join(root, d), join(mdir, d), { recursive: true }); } catch { /* not every folder exists */ } }
  writeFileSync(join(mdir, file), src);
  try { bundle(mdir, "worker/src/index.ts", join(mdir, "worker.mjs")); } catch { fail++; console.error(`FAIL mutation did not build: ${name}`); continue; }
  const res = await runtime(join(mdir, "worker.mjs"));
  rmSync(mdir, { recursive: true, force: true }); // v1.272.0 - leave no copy behind
  if (!res.some(([p]) => !p)) { fail++; console.error(`FAIL mutation not caught: ${name}`); }
}
rmSync(dir, { recursive: true, force: true });
if (fail) { console.error(`payment-verify: ${fail} of ${n} failed`); process.exit(1); }
console.log(`payment-verify: ${checks} checks passed (${NOMUT ? "mutations skipped" : `${MUT.length} mutations caught`}) - a report is not money; only the CEO's verification is, once, in the right company`);
