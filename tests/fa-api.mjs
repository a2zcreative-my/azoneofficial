/* v1.284.0 - Financial Advisory, Release 1, by direct request against the
   whole worker (index.ts bundled) on SQLite with every migration applied
   (claude/FINANCIAL-ADVISORY-BLUEPRINT.md, the CEO's acceptance tests 1-36).
   Each rule is also MUTATED: the guard fails unless every mutation is caught.

   Proven here: one client identity (phone and IC); scope by owner, member or
   fa_decide - never HR, admin or an agent; consent before any figure; no
   credentials; the IC never stored whole; declared income never qualifies;
   draft criteria never match; a concern is a review path, an override needs
   a reason and keeps the computed result; banker feedback never sets an
   approval; an official decision needs the bank's document; notes and the
   timeline are append only; consolidation removes a facility only with its
   settlement letter, once; the legal gates (agreement, fee, disclosure) are
   shut; tasks are the existing tasks; notifications carry no figure or name;
   Finance, invoices, payments and commission are untouched throughout.

     node tests/fa-api.mjs        (NOMUT=1 skips the mutations) */
import { readFileSync, readdirSync, mkdtempSync, writeFileSync, cpSync, rmSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const root = fileURLToPath(new URL("..", import.meta.url));
const bundle = (srcRoot, entry, out) => execSync(`npx esbuild "${join(srcRoot, entry)}" --bundle --format=esm --platform=neutral --outfile="${out}" --log-level=error`, { cwd: root, stdio: "inherit" });
const sha = (s) => createHash("sha256").update(s).digest("hex");
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 1, 2, 3, 4, 5, 6, 7, 8]);
globalThis.FixedLengthStream ??= class { constructor() { const t = new TransformStream(); this.readable = t.readable; this.writable = t.writable; } };

async function runtime(workerBundle) {
  const out = [];
  const ok = (c, m, why = "") => out.push([!!c, why && !c ? `${m} - ${why}` : m]);
  const db = new DatabaseSync(":memory:");
  for (const f of readdirSync(join(root, "worker/migrations")).filter((x) => x.endsWith(".sql")).sort()) {
    for (const st of readFileSync(join(root, "worker/migrations", f), "utf8").split(/;\s*\n/)) { try { db.exec(st); } catch { /* a statement SQLite reads differently */ } }
  }
  const shim = (sql) => { const st = db.prepare(sql); let b = []; const o = {
    bind: (...a) => { b = a.map((x) => (x === undefined ? null : x)); return o; },
    first: async () => st.get(...b) ?? null, all: async () => ({ results: st.all(...b) }),
    run: async () => ({ meta: { changes: Number(st.run(...b).changes) } }), _run: () => ({ meta: { changes: Number(st.run(...b).changes) } }) }; return o; };
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
  /* invented people: 1 CEO, 2 super admin, 3 COO, 6 CCO, 7 HR, 9 and 15 sales, 21 an agent, 22 admin */
  db.exec(`INSERT INTO users (id, name, full_name, email, role, is_active, password_hash, totp_enabled, totp_secret) VALUES
    (1,'Owner','Owner Person','owner@a2z.test','ceo',1,'x',1,'JBSWY3DPEHPK3PXP'), (2,'Root','Root Person','root@a2z.test','super_admin',1,'x',1,'JBSWY3DPEHPK3PXP'),
    (3,'Coo','Coo Person','coo@a2z.test','coo',1,'x',1,'JBSWY3DPEHPK3PXP'), (6,'Cco','Cco Person','cco@a2z.test','cco',1,'x',1,'JBSWY3DPEHPK3PXP'),
    (7,'Hr','Hr Person','hr@a2z.test','hr_admin',1,'x',1,'JBSWY3DPEHPK3PXP'), (9,'Aina','Aina Seller','aina@a2z.test','sales_marketing',1,'x',1,'JBSWY3DPEHPK3PXP'),
    (15,'Lia','Lia Seller','lia@a2z.test','sales_marketing',1,'x',1,'JBSWY3DPEHPK3PXP'), (21,'Ros','Ros Agent','ros@a2z.test','agent',1,'x',1,'JBSWY3DPEHPK3PXP'),
    (22,'Adm','Adm Person','adm@a2z.test','admin',1,'x',1,'JBSWY3DPEHPK3PXP')`);
  db.exec(`INSERT INTO customers (id, company, phone) VALUES (1, 'Existing Client One', '019-888 7777')`);
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("{}", { status: 200 });
  const worker = (await import(pathToFileURL(workerBundle).href + `?v=${Math.random()}`)).default;
  const tok = {};
  for (const id of [1, 2, 3, 6, 7, 9, 15, 21, 22]) {
    tok[id] = `t-${id}-${Math.random()}`;
    db.prepare(`INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, datetime('now', '+12 hours'), datetime('now'))`).run(sha(tok[id]), id);
  }
  const hdr = (uid, ct = "application/json") => ({ "content-type": ct, origin: "https://portal.a2z.test", cookie: `azone_session=${tok[uid]}; csrf_token=c1`, "x-csrf-token": "c1" });
  const call = async (path, uid, method = "GET", body) => {
    const r = await worker.fetch(new Request(`https://api.a2z.test/api/v1/staff${path}`, { method, headers: hdr(uid), body: body ? JSON.stringify(body) : undefined }), env, { waitUntil() {} });
    const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch { /* a file */ }
    return { status: r.status, j, text };
  };
  const upload = async (caseId, uid, kind) => {
    const r = await worker.fetch(new Request(`https://api.a2z.test/api/v1/staff/fa/cases/${caseId}/documents?kind=${kind}&date=2026-11-10`, { method: "POST", headers: { ...hdr(uid, "image/png"), "content-length": String(PNG.length) }, body: PNG }), env, { waitUntil() {} });
    const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { /* */ }
    return { status: r.status, j, text: t };
  };
  const n = (sql, ...a) => Number(db.prepare(sql).get(...a)?.n ?? 0);
  const finance = () => ["cashflow_entries", "sales_documents", "invoice_payments", "commission_ledger", "journal_entries"].map((t) => { try { return n(`SELECT COUNT(*) AS n FROM ${t}`); } catch { return -1; } }).join(",");
  const before = finance();

  try {
    /* ---------- who may open it at all ---------- */
    for (const [uid, who] of [[7, "HR"], [2, "super admin"], [22, "admin"], [21, "an agent"]]) {
      ok((await call("/fa/summary", uid)).status === 403 && (await call("/fa/cases", uid)).status === 403, `${who} cannot open Financial Advisory (by direct request)`);
    }

    /* ---------- one client identity ---------- */
    const c1 = await call("/fa/cases", 9, "POST", { product: "personal_financing", issuer_code: "a2z", new_customer: { name: "Encik Contoh", phone: "012-345 6789" }, purpose: "Personal financing" });
    ok(c1.status === 201 && c1.j?.case_ref === "FA-000001", "Sales opens a case for a new client", c1.text);
    const cust = c1.j?.customer_id;
    ok(n(`SELECT COUNT(*) AS n FROM customers WHERE company = 'Encik Contoh'`) === 1, "...the client is ONE customers row (no second client table)");
    const dup = await call("/fa/cases", 15, "POST", { product: "personal_financing", issuer_code: "a2z", new_customer: { name: "E. Contoh", phone: "+60 12-3456789" } });
    ok(dup.status === 409 && dup.j?.error?.code === "duplicate_customer" && dup.j?.customer_id === cust && n(`SELECT COUNT(*) AS n FROM customers`) === 2, "the same phone is the same client, never a duplicate", dup.text);
    const exist = await call("/fa/cases", 15, "POST", { product: "personal_financing", issuer_code: "a2z", customer_id: cust });
    ok(exist.status === 409 && exist.j?.error?.code === "case_exists", "one open case per client and product");
    const c2 = await call("/fa/cases", 15, "POST", { product: "debt_consolidation", issuer_code: "azoo", customer_id: 1 });
    ok(c2.status === 201, "an existing customer's case links to that customer", c2.text);
    const id1 = c1.j?.id, id2 = c2.j?.id;
    ok((await call("/fa/cases", 9, "POST", { product: "personal_financing", issuer_code: "x", customer_id: 1 })).status === 400, "the issuing company is required (A2Z or AZ ONE)");

    /* ---------- scope ---------- */
    const liaOpens = await call(`/fa/cases/${id1}`, 15);
    ok(liaOpens.status === 403 && n(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'fa.case_refused' AND user_id = 15`) === 1, "another salesperson cannot open the case - and the attempt is audited");
    const ainaList = (await call("/fa/cases", 9)).j?.cases ?? [];
    ok(ainaList.length === 1 && ainaList[0].id === id1, "a salesperson's list is their own cases only");
    ok(((await call("/fa/cases", 1)).j?.cases ?? []).length === 2 && ((await call("/fa/cases", 3)).j?.cases ?? []).length === 2, "the CEO and COO see every case");
    /* v1.288.0 - the CCO reviews (decision D1 of DSR blueprint v1.2), so the CCO sees every case like the CEO and COO */
    ok(((await call("/fa/cases", 6)).j?.cases ?? []).length === 2, "the CCO, a reviewer now, sees every case");
    ok(!/income|monthly_cents|ic_|phone/.test(JSON.stringify(ainaList)), "the list carries no income, figures, IC or phone");

    /* ---------- consent first; no credentials ---------- */
    const early = await call(`/fa/cases/${id1}/items`, 9, "POST", { side: "income", kind: "gross_salary", monthly_cents: 560000 });
    ok(early.status === 409 && early.j?.error?.code === "consent_required", "no figure before the privacy notice and the assessment consent");
    const cred = await call(`/fa/cases/${id1}/items`, 9, "POST", { side: "income", kind: "gross_salary", monthly_cents: 1, online_banking_password: "secret" });
    ok(cred.status === 400 && cred.j?.error?.code === "credential_refused", "anything shaped like a banking password is refused");
    ok((await call(`/fa/cases/${id1}/consents`, 9, "POST", { kind: "privacy_notice", notice_version: "v1-draft", captured_how: "signed_form", given_at: "2026-11-09" })).status === 201
      && (await call(`/fa/cases/${id1}/consents`, 9, "POST", { kind: "assessment", notice_version: "v1-draft", captured_how: "signed_form", given_at: "2026-11-09" })).status === 201, "the two consents are recorded");
    const discNoScope = await call(`/fa/cases/${id1}/consents`, 9, "POST", { kind: "disclosure", captured_how: "email", given_at: "2026-11-09", institution: "Bank A" });
    ok(discNoScope.status === 400, "a disclosure consent must name the documents it covers");

    /* ---------- the IC ---------- */
    const pr = await call(`/fa/cases/${id1}/profile`, 9, "PUT", { ic: "880101-14-5678", employment_status: "employed", employment_category: "permanent", service_months: 30 });
    const prof = db.prepare(`SELECT ic_masked, ic_hash FROM fa_profiles WHERE case_id = ?`).get(id1);
    ok(pr.status === 200 && prof?.ic_masked === "••••••-••-5678" && /^[0-9a-f]{64}$/.test(prof?.ic_hash ?? ""), "the IC is stored masked and as a keyed hash", pr.text);
    const whole = db.prepare(`SELECT * FROM fa_profiles`).all().concat(db.prepare(`SELECT detail FROM audit_log`).all(), db.prepare(`SELECT detail FROM fa_events`).all());
    ok(!JSON.stringify(whole).includes("880101") && !JSON.stringify(whole).includes("880101145678"), "the full IC is stored nowhere (profile, audit, timeline)");
    await call(`/fa/cases/${id2}/consents`, 15, "POST", { kind: "privacy_notice", notice_version: "v1-draft", captured_how: "signed_form", given_at: "2026-11-09" });
    await call(`/fa/cases/${id2}/consents`, 15, "POST", { kind: "assessment", notice_version: "v1-draft", captured_how: "signed_form", given_at: "2026-11-09" });
    const same = await call(`/fa/cases/${id2}/profile`, 15, "PUT", { ic: "880101145678" });
    ok(same.status === 409 && same.j?.error?.code === "ic_elsewhere", "the same IC on another client is refused: one person, one client");

    /* ---------- figures, evidence, DSR ---------- */
    const add = (cid, uid, side, kind, cents, extra = {}) => call(`/fa/cases/${cid}/items`, uid, "POST", { side, kind, monthly_cents: cents, ...extra });
    const gross = await add(id1, 9, "income", "gross_salary", 560000, { source: "payslip" });
    await add(id1, 9, "deduction", "epf", 60000);
    await add(id1, 9, "commitment", "personal_financing", 200000);
    const a0 = await call(`/fa/cases/${id1}/assess`, 9, "POST", { instalment_cents: 50000 });
    ok(a0.status === 201 && a0.j?.result?.outcome === "incomplete" && a0.j?.result?.current_dsr_bp === null, "declared income never qualifies: Insufficient Information", a0.text.slice(0, 200));
    ok((await call(`/fa/items/${gross.j.id}/verify`, 9, "POST", {})).status === 400, "an item is verified only with a document on the case");
    const slip = await upload(id1, 9, "payslip");
    ok(slip.status === 201, "the payslip is uploaded to private storage", slip.text);
    await call(`/fa/items/${gross.j.id}/verify`, 9, "POST", { evidence_id: slip.j.id });
    const a1 = await call(`/fa/cases/${id1}/assess`, 9, "POST", { instalment_cents: 50000 });
    ok(a1.j?.result?.income_net_cents === 500000 && a1.j?.result?.current_dsr_bp === 4000 && a1.j?.result?.projected_dsr_bp === 5000, "net RM 5,000, current 40%, projected 50%", JSON.stringify(a1.j?.result ?? {}).slice(0, 200));
    ok(a1.j?.result?.outcome === "manual_review", "no verified bank criterion yet: manual review, never a pass or a rejection");

    /* ---------- criteria: verified only ---------- */
    /* v1.286.0 - the bank comes from the one bank registry */
    const bankA = await call("/fa/banks", 1, "POST", { name: "Bank A", kind: "commercial" });
    await call(`/fa/banks/${bankA.j.id}/products`, 1, "POST", { product: "personal_financing", channel: "branch", source: "Invented test bank, test data" });
    ok((await call("/fa/criteria", 9, "POST", { bank: "Bank A", product: "personal_financing", source: "Typed bank name only" })).status === 400, "a criterion's bank cannot be typed - it is chosen from the registry");
    const dr = await call("/fa/criteria", 9, "POST", { bank_id: bankA.j.id, product: "personal_financing", dsr_guideline_pct: 60, required_documents: ["payslip", "epf"], source: "Bank A RM email, 01-11-2026" });
    ok(dr.status === 201, "Sales may propose a criterion (a draft)");
    ok((await call(`/fa/criteria/${dr.j.id}/verify`, 9, "POST", { last_verified_on: "2026-11-01" })).status === 403, "...but only management verifies it");
    ok((await call(`/fa/cases/${id1}/assess`, 9, "POST", { instalment_cents: 50000 })).j?.result?.outcome === "manual_review", "a draft criterion is never matched or treated as official");
    ok((await call(`/fa/criteria/${dr.j.id}/verify`, 1, "POST", { last_verified_on: "2026-11-01" })).status === 200, "the CEO verifies it, with the date");
    const a2 = await call(`/fa/cases/${id1}/assess`, 9, "POST", { instalment_cents: 50000 });
    const m = a2.j?.result?.matches?.[0];
    ok(a2.j?.result?.outcome === "potentially_suitable" && m?.bank === "Bank A" && m.checks.some((k) => k.key === "dsr" && k.state === "ok") && JSON.stringify(m.missing_documents) === '["epf"]', "Potentially Suitable - preliminary, with the reasons and the missing documents", JSON.stringify(m));
    const sys = db.prepare(`SELECT body FROM fa_notes WHERE case_id = ? AND note_type = 'system' ORDER BY id DESC`).get(id1)?.body ?? "";
    ok(/preliminary/i.test(sys) && !/approv/i.test(sys), "the system note says preliminary, never approved");

    /* ---------- affordability, override ---------- */
    await add(id1, 9, "commitment", "car", 150000);
    const a3 = await call(`/fa/cases/${id1}/assess`, 9, "POST", { instalment_cents: 50000 });
    ok(a3.j?.result?.outcome === "affordability_concern" && db.prepare(`SELECT stage FROM fa_cases WHERE id = ?`).get(id1)?.stage !== "closed", "80% gives Affordability Concern - a review path, the case stays open");
    ok((await call(`/fa/cases/${id1}/override`, 9, "POST", { outcome: "potentially_suitable", reason: "The car loan ends next month per the statement" })).status === 403, "Sales cannot override");
    ok((await call(`/fa/cases/${id1}/override`, 1, "POST", { outcome: "manual_review", reason: "short" })).status === 400, "an override needs a real reason");
    const nA = n(`SELECT COUNT(*) AS n FROM fa_assessments WHERE case_id = ?`, id1);
    const ov = await call(`/fa/cases/${id1}/override`, 1, "POST", { outcome: "manual_review", reason: "The car loan ends next month per the facility statement" });
    ok(ov.status === 200 && db.prepare(`SELECT override_result, prescreen FROM fa_cases WHERE id = ?`).get(id1)?.override_result === "manual_review" && db.prepare(`SELECT prescreen FROM fa_cases WHERE id = ?`).get(id1)?.prescreen === "affordability_concern" && n(`SELECT COUNT(*) AS n FROM fa_assessments WHERE case_id = ?`, id1) === nA && n(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'fa.override'`) === 1, "the CEO overrides with a reason; the computed result is kept and the override audited");

    /* ---------- notes ---------- */
    const bf = await call(`/fa/cases/${id1}/notes`, 9, "POST", { type: "banker", bank_id: bankA.j.id, source: "call", status: "indicatively_suitable", body: "Profile looks acceptable subject to full documents", follow_up_on: "2026-11-14" });
    const cs = () => db.prepare(`SELECT banker_status, application_status FROM fa_cases WHERE id = ?`).get(id1);
    ok(bf.status === 201 && cs().banker_status === "indicatively_suitable" && cs().application_status === "not_submitted", "banker feedback moves the banker status only, never the application");
    ok((await call(`/fa/cases/${id1}/notes`, 9, "POST", { type: "banker", bank_id: bankA.j.id, status: "officially_approved", body: "Banker says approved" })).status === 400, "a banker's word can never be recorded as an approval");
    ok((await call(`/fa/cases/${id1}/notes`, 9, "POST", { type: "decision", bank_id: bankA.j.id, status: "officially_approved", body: "Approved" })).status === 403, "Sales cannot record an official decision");
    ok((await call(`/fa/cases/${id1}/notes`, 1, "POST", { type: "decision", bank_id: bankA.j.id, status: "officially_approved", body: "Approved" })).j?.error?.code === "evidence_required", "an official decision needs the bank's document");
    const letter = await upload(id1, 9, "bank_decision");
    const dc = await call(`/fa/cases/${id1}/notes`, 1, "POST", { type: "decision", bank_id: bankA.j.id, status: "officially_approved", body: "Letter of offer received", bank_reference: "BA-REF-1", approved_cents: 3000000, evidence_id: letter.j.id });
    ok(dc.status === 201 && cs().application_status === "officially_approved", "with the letter, the CEO records the official decision", dc.text);
    let blocked = 0;
    for (const sql of [`UPDATE fa_notes SET body = 'x'`, `DELETE FROM fa_notes`, `UPDATE fa_events SET event = 'x'`, `DELETE FROM fa_assessments`]) { try { db.exec(sql); } catch { blocked++; } }
    ok(blocked === 4, "notes, assessments and the timeline are append only");
    const corr = await call(`/fa/notes/${bf.j.id}/correct`, 9, "POST", { body: "Correction: the banker asked for 6 months of statements" });
    ok(corr.status === 201 && db.prepare(`SELECT corrects_id FROM fa_notes WHERE id = ?`).get(corr.j.id)?.corrects_id === bf.j.id && db.prepare(`SELECT body FROM fa_notes WHERE id = ?`).get(bf.j.id)?.body.startsWith("Profile looks"), "a correction is a new note; the original stays");
    ok(Number(db.prepare(`SELECT approved_cents FROM fa_notes WHERE id = ?`).get(dc.j.id)?.approved_cents) === 3000000 && finance() === before, "the approved amount is a fact on the case - no cash row, invoice, payment or commission");

    /* ---------- documents: scope and audit ---------- */
    ok((await call(`/fa/documents/${slip.j.id}`, 15)).status === 403 && n(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'fa.document_refused'`) >= 1, "another salesperson cannot open the payslip (audited)");
    ok((await call(`/fa/documents/${slip.j.id}`, 7)).status === 403 && (await call(`/fa/documents/${slip.j.id}`, 21)).status === 403, "HR and an agent cannot either");
    const view = await call(`/fa/documents/${slip.j.id}`, 1);
    ok(view.status === 200 && n(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'fa.document_view'`) === 1, "the CEO can - and the view is audited");
    await call(`/fa/cases/${id1}/members`, 9, "POST", { user_id: 15 });
    ok((await call(`/fa/cases/${id1}`, 15)).status === 200 && (await call(`/fa/cases/${id1}/items`, 15, "POST", { side: "income", kind: "allowance", monthly_cents: 1000 })).status === 403, "an assisting member reads the case but cannot change the client's figures");

    /* ---------- debt consolidation: three periods ---------- */
    await add(id2, 15, "income", "gross_salary", 600000);
    const s2 = await upload(id2, 15, "payslip");
    const it2 = db.prepare(`SELECT id FROM fa_items WHERE case_id = ? AND side = 'income'`).get(id2).id;
    await call(`/fa/items/${it2}/verify`, 15, "POST", { evidence_id: s2.j.id });
    await add(id2, 15, "commitment", "car", 65000);
    const pf = await add(id2, 15, "commitment", "personal_financing", 85000);
    const card = await add(id2, 15, "commitment", "credit_card", 35000);
    ok((await call(`/fa/items/${card.j.id}/settlement`, 15, "POST", {})).status === 400, "a facility is marked settled only with its settlement letter");
    const sl = await upload(id2, 15, "settlement_letter");
    await call(`/fa/items/${pf.j.id}/settlement`, 15, "POST", { settlement_doc_id: sl.j.id });
    await call(`/fa/items/${pf.j.id}/settlement`, 15, "POST", { settlement_doc_id: sl.j.id });
    const k1 = (await call(`/fa/cases/${id2}/assess`, 15, "POST", { instalment_cents: 120000 })).j?.result?.consolidation;
    ok(k1?.before?.dsr_bp === 3083 && k1?.overlap?.dsr_bp === 5083 && k1?.after?.commitments_cents === 100000 && k1?.after?.dsr_bp === 3666, "before 30.8%, overlap 50.8%, after removes the evidenced facility once (36.6%)", JSON.stringify(k1));

    /* ---------- the legal gates ---------- */
    /* v1.288.0 - sending to a bank opened by the CEO's decision D5, but only after a management Proceed (fa-dsr.mjs proves the rest) */
    const disc = await call(`/fa/cases/${id1}/disclosures`, 1, "POST", { enquiry_id: 1, document_ids: [1], channel: "work_email", purpose: "Assessment" });
    ok(disc.status === 409 && disc.j?.error?.code === "review_required", "nothing goes to a bank before Management decides Proceed - even for the CEO", disc.text);
    const ag = await call(`/fa/cases/${id1}/agreement`, 1, "POST", {});
    ok(ag.status === 409 && ag.j?.error?.code === "legal_gate", "the client agreement (sending, signing) is shut - even for the CEO");
    /* v1.298.0 - the CEO switched the fee on (13-11-2026, without legal review); it still bills nothing from here */
    const fin0 = finance();
    const fe = await call(`/fa/cases/${id1}/fee`, 1, "POST", { percent: 15 });
    ok(fe.status === 409 && fe.j?.error?.code === "fee_after_disbursement" && finance() === fin0, "the fee is on, but nothing is billed from an estimate - only after a recorded disbursement, through Sales", fe.text);
    ok((await call(`/fa/cases/${id2}`, 15, "PATCH", { stage: "application" })).j?.error?.code === "legal_gate", "a formal application step is shut too");
    ok((await call(`/fa/cases/${id2}`, 15, "PATCH", { stage: "decision" })).j?.error?.code === "invalid_transition", "stages move only by allowed transitions");

    /* ---------- tasks and notifications ---------- */
    const tk = await call(`/fa/cases/${id1}/tasks`, 9, "POST", { title: "Request EPF statement", deadline: "2026-11-12" });
    const trow = db.prepare(`SELECT title, link_kind, link_id FROM tasks WHERE id = ?`).get(tk.j?.id);
    ok(tk.status === 201 && trow?.link_kind === "fa_case" && trow?.link_id === id1 && trow?.title === "FA-000001: Request EPF statement", "a next action is an ordinary task linked to the case, titled by reference");
    const notes = db.prepare(`SELECT message FROM notifications`).all().map((r) => r.message).join(" | ");
    ok(!/RM|Encik|Contoh|5678|%/.test(notes), "notifications carry the case reference only - no figure, name or IC", notes);

    /* ---------- consent withdrawal, closing ---------- */
    const pc = db.prepare(`SELECT id FROM fa_consents WHERE case_id = ? AND kind = 'assessment'`).get(id1).id;
    ok((await call(`/fa/consents/${pc}/withdraw`, 9, "POST", { note: "Client asked by email to stop" })).status === 200, "a consent is withdrawn, with how");
    ok((await call(`/fa/cases/${id1}/items`, 9, "POST", { side: "income", kind: "allowance", monthly_cents: 1000 })).j?.error?.code === "consent_required", "after a withdrawal no new figure is taken");
    ok((await call(`/fa/cases/${id1}`, 9, "PATCH", { stage: "closed" })).status === 400, "closing needs a reason");
    ok((await call(`/fa/cases/${id1}`, 9, "PATCH", { stage: "closed", closed_reason: "Client withdrew consent" })).status === 200, "the case closes with its reason");
    ok((await call("/fa/cases", 9, "POST", { product: "personal_financing", issuer_code: "a2z", customer_id: cust })).status === 201, "a closed case lets a new one open for the same client");
    ok(finance() === before, "Finance, invoices, payments, commission and journals are untouched throughout", `${before} -> ${finance()}`);
  } catch (e) {
    out.push([false, `runtime: ${e?.stack ?? e}`]);
  } finally {
    globalThis.fetch = realFetch;
  }
  return out;
}

let fail = 0, n = 0;
const report = (list) => { for (const [p, m] of list) { n++; if (!p) { fail++; console.error(`FAIL ${m}`); } } };
const NOMUT = process.env.NOMUT === "1";
const dir = mkdtempSync(join(tmpdir(), "fa-"));
bundle(root, "worker/src/index.ts", join(dir, "worker.mjs"));
report(await runtime(join(dir, "worker.mjs")));
const checks = n;
const F = "worker/src/fa.ts", E = "worker/src/fa-engine.ts";
const MUT = [
  [F, "no scope check", [["  return isAll(u) || c.owner_id === u.id || (await isMember(env, c.id, u.id));", "  return true;"]]],
  [F, "no consent gate", [["  return (await liveConsent(env, caseId, \"privacy_notice\")) && (await liveConsent(env, caseId, \"assessment\"));", "  return true;"]]],
  [F, "credentials accepted", [["  if (body && hasCredential(body)) {", "  if (false) {"]]],
  [F, "the IC stored whole", [["const maskIc = (d: string) => `••••••-••-${d.slice(-4)}`;", "const maskIc = (d: string) => d;"]]],
  [F, "a banker may approve", [["const BANKER_STATUS = [\"enquiry_sent\",", "const BANKER_STATUS = [\"officially_approved\", \"enquiry_sent\","]]],
  [F, "a decision without evidence", [["      if (!ev) return err(\"evidence_required\"", "      if (false) return err(\"evidence_required\""]]],
  [F, "Sales verifies criteria", [["    if (!can(user.role, \"fa_criteria\")) return err(\"forbidden\", \"Only management verifies bank criteria\", 403);", ""]]],
  [F, "the agreement gate open", [['if (sub === "agreement" && method === "POST") {', "if (false) {"]]],
  [F, "a fee billed from the case", [['if (sub === "fee" && method === "POST") {', "if (false) {"]]],
  [F, "a duplicate client by phone", [["      if (hit) return json(", "      if (false) return json("]]],
  [F, "an override with no reason", [["    if (reason.length < 20) return err(\"invalid_input\", \"Explain the override", "    if (false) return err(\"invalid_input\", \"Explain the override"]]],
  [F, "assisting members edit figures", [["const mayEdit = (u: StaffUser, c: Case) => can(u.role, \"fa_edit\") && (isAll(u) || c.owner_id === u.id);", "const mayEdit = (u: StaffUser, c: Case) => can(u.role, \"fa_edit\");"]]],
  [E, "declared income qualifies", [["inc.filter((i) => i.state === \"verified\" && INCOME_KINDS.includes(i.kind))", "inc.filter((i) => INCOME_KINDS.includes(i.kind))"]]],
  [E, "draft criteria match", [["input.criteria.filter((c) => c.state === \"verified\" && c.product === product && ", "input.criteria.filter((c) => c.state !== \"retired\" && c.product === product && "]]],
  /* the engine's own evidence condition is mutation-covered by tests/fa-engine.mjs (period C); here the route that sets it */
  ["worker/src/fa.ts", "a settlement without its letter", [['if (!doc) return err("evidence_required", "Choose the settlement letter on this case.", 400);', 'void doc;']]],
  ["worker/src/permissions.ts", "HR opens Financial Advisory", [['  fa_view: ["ceo", "coo", "cco", "sales_marketing"],', '  fa_view: ["ceo", "coo", "cco", "sales_marketing", "hr_admin"],']]],
];
for (const [file, name, reps] of NOMUT ? [] : MUT) {
  n++;
  let src = readFileSync(join(root, file), "utf8");
  let applied = true;
  for (const [from, to] of reps) { if (!src.includes(from)) { applied = false; break; } src = src.replace(from, to); }
  if (!applied) { fail++; console.error(`FAIL mutation did not apply: ${name}`); continue; }
  const mdir = mkdtempSync(join(tmpdir(), "fa-m-"));
  cpSync(join(root, "worker"), join(mdir, "worker"), { recursive: true, filter: (s) => !s.includes("node_modules") });
  cpSync(join(root, "package.json"), join(mdir, "package.json"));
  for (const d of ["lib", "constants", "types"]) { try { cpSync(join(root, d), join(mdir, d), { recursive: true }); } catch { /* not every folder exists */ } }
  writeFileSync(join(mdir, file), src);
  try { bundle(mdir, "worker/src/index.ts", join(mdir, "worker.mjs")); } catch { fail++; console.error(`FAIL mutation did not build: ${name}`); continue; }
  const res = await runtime(join(mdir, "worker.mjs"));
  rmSync(mdir, { recursive: true, force: true });
  if (!res.some(([p]) => !p)) { fail++; console.error(`FAIL mutation not caught: ${name}`); }
}
rmSync(dir, { recursive: true, force: true });
if (fail) { console.error(`fa-api: ${fail} of ${n} failed`); process.exit(1); }
console.log(`fa-api: ${checks} checks passed (${NOMUT ? "mutations skipped" : `${MUT.length} mutations caught`}) - one client, scoped by case, consent first, nothing official without evidence, the legal gates shut, Finance untouched`);
