/* v1.288.0 - Financial Advisory DSR Pre-Check, Management review and banker
   matching (the CEO approved DSR blueprint v1.2, 12-11-2026: D1-D4 as
   recommended, D5 "proceed without lawyers"), by direct request against the
   whole worker on SQLite with every migration applied. Invented banks and
   people only. Each rule is also MUTATED.

     node tests/fa-dsr.mjs        (NOMUT=1 skips the mutations) */
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
  db.exec(`INSERT INTO system_meta (key, value) VALUES ('company_owner', '{"user_id":1,"set_by":2,"set_by_name":"Root","set_at":"2026-11-02 06:00:54","reason":"test"}')`);
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

  const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 32 * 3600e3).toISOString().slice(0, 10);
  const tables = () => ["fa_cases", "fa_items", "fa_assessments", "customers", "fa_notes"].map((t) => n(`SELECT COUNT(*) AS n FROM ${t}`)).join(",");
  try {
    /* ---------- the registry and one verified criterion (invented) ---------- */
    const bank = await call("/fa/banks", 1, "POST", { name: "Bank A", kind: "commercial" });
    await call(`/fa/banks/${bank.j.id}/products`, 1, "POST", { product: "personal_financing", channel: "branch", source: "Invented test bank" });
    await call(`/fa/banks/${bank.j.id}/products`, 1, "POST", { product: "debt_consolidation", channel: "branch", source: "Invented test bank" });
    const crit = await call("/fa/criteria", 9, "POST", { confidence: "high", bank_id: bank.j.id, product: "personal_financing", dsr_guideline_pct: 60, source: "Invented test bank, test data" });
    await call(`/fa/criteria/${crit.j.id}/verify`, 1, "POST", { last_verified_on: today });
    const future = await call("/fa/criteria", 9, "POST", { confidence: "high", bank_id: bank.j.id, product: "personal_financing", dsr_guideline_pct: 90, effective_from: tomorrow, source: "Invented test bank, future rule" });
    ok(future.status === 201, "a future-dated rule can be drafted", future.text);
    ok(db.prepare(`SELECT state FROM fa_criteria WHERE id = ?`).get(crit.j.id).state === "verified", "verifying a version effective tomorrow leaves today's version in force");
    await call(`/fa/criteria/${future.j.id}/verify`, 1, "POST", { last_verified_on: today });

    /* ---------- Quick Check: the one engine, nothing stored ---------- */
    const t0 = tables();
    const items = [
      { side: "income", kind: "gross_salary", monthly_cents: 700000, verified: true }, { side: "deduction", kind: "epf", monthly_cents: 77000 },
      { side: "deduction", kind: "socso", monthly_cents: 1975 }, { side: "deduction", kind: "tax", monthly_cents: 25000 },
      { side: "commitment", kind: "housing", monthly_cents: 120000 }, { side: "commitment", kind: "car", monthly_cents: 48000 },
      { side: "commitment", kind: "personal_financing", monthly_cents: 35000 }, { side: "commitment", kind: "credit_card", monthly_cents: 20000 },
      { side: "expense", kind: "other", monthly_cents: 140000 },
    ];
    const q = await call("/fa/preview", 9, "POST", { product: "personal_financing", items, proposal: { amount_cents: 5000000, tenure_months: 60, rate_bp: 870 }, final: true });
    const r = q.j?.result;
    ok(q.status === 200 && r?.income_net_cents === 596025 && r?.commitments_cents === 223000, "net = gross - EPF - SOCSO - tax (RM 5,960.25); commitments RM 2,230.00", JSON.stringify(r ?? q.text).slice(0, 200));
    ok(r?.current_dsr_bp === 3741 && r?.instalment_cents === 103066 && r?.projected_dsr_bp === 5470, "current 37.41%, illustrative instalment RM 1,030.66, projected 54.70%", `${r?.current_dsr_bp} ${r?.instalment_cents} ${r?.projected_dsr_bp}`);
    ok(r?.remaining_cents === 269959 && r?.residual_cents === 129959 && r?.living_cents === 140000, "remaining RM 2,699.59; residual after the DECLARED living cost RM 1,299.59", `${r?.remaining_cents} ${r?.residual_cents}`);
    ok(r?.outcome === "potentially_suitable" && r.matches.length === 1 && r.matches[0].criterion_id === crit.j.id, "Potential Match against the current verified rule only - the future-dated rule is not applied", JSON.stringify(r?.matches?.map((m) => m.criterion_id)));
    ok(r?.engine_version === "1.301.0" && r?.breakdown?.length === items.length && r?.confidence?.verified === 1, "the breakdown shows every figure, the engine version and the confidence");
    ok(tables() === t0 && q.j?.stored === false, "a Quick Check stores nothing - no case, figure, assessment, customer or note");
    const ql = db.prepare(`SELECT detail FROM audit_log WHERE action = 'fa.quick_check'`).all();
    ok(ql.length === 1 && !/700000|596025|223000|gross/.test(ql[0].detail), "a pressed Calculate leaves one audit line with no figure in it", ql[0]?.detail);
    ok((await call("/fa/preview", 9, "POST", { items, name: "Encik Contoh" })).j?.error?.code === "identity_refused", "a Quick Check refuses a name (D3: figures only)");
    const z = (await call("/fa/preview", 9, "POST", { items: [{ side: "income", kind: "gross_salary", monthly_cents: 0, verified: true }, { side: "commitment", kind: "car", monthly_cents: 50000 }], proposal: { instalment_cents: 50000 } })).j?.result;
    ok(z?.outcome === "incomplete" && z?.current_dsr_bp === null && z?.projected_dsr_bp === null, "zero income: Information Incomplete, no DSR, no division by zero");
    const dec = (await call("/fa/preview", 9, "POST", { items: [{ side: "income", kind: "gross_salary", monthly_cents: 500000 }], proposal: { instalment_cents: 50000 } })).j?.result;
    ok(dec?.outcome === "incomplete" && dec?.income_net_cents === null, "declared (unverified) income never counts");
    ok((await call("/fa/preview", 7, "POST", { items })).status === 403 && (await call("/fa/preview", 21, "POST", { items })).status === 403, "HR and an agent cannot run it");
    const cons = (await call("/fa/preview", 9, "POST", { product: "debt_consolidation", items: [
      { side: "income", kind: "net_salary", monthly_cents: 600000, verified: true }, { side: "commitment", kind: "car", monthly_cents: 65000 },
      { side: "commitment", kind: "personal_financing", monthly_cents: 85000, settle: true, remaining_months: 24 }, { side: "commitment", kind: "credit_card", monthly_cents: 35000, settle: true, remaining_months: 12 }],
      proposal: { instalment_cents: 100000, tenure_months: 60 } })).j?.result;
    const ct = cons?.consolidation_totals;
    ok(cons?.consolidation?.overlap?.dsr_bp === 4750 && cons?.consolidation?.after?.dsr_bp === 2750, "consolidation: overlap 47.5% (old debts still running), after settlement 27.5%", JSON.stringify(cons?.consolidation));
    ok(ct?.monthly_difference_cents === 20000 && ct?.new_total_cents === 6000000 && ct?.settled_remaining_cents === 2460000 && ct?.total_difference_cents === 3540000, "monthly difference RM 200; total repaid RM 60,000 vs RM 24,600 left - RM 35,400 more", JSON.stringify(ct));
    ok(ct?.risks?.some((x) => /total repaid rises/.test(x)) && ct?.risks?.some((x) => /longer than the longest/.test(x)), "the risks say the total rises and the tenure is longer");

    /* ---------- a case, its figures as one set ---------- */
    const cs = await call("/fa/cases", 9, "POST", { product: "personal_financing", issuer_code: "a2z", new_customer: { name: "Encik Contoh", phone: "012-345 6789" } });
    const cid = cs.j.id;
    const set = (uid, lines) => call(`/fa/cases/${cid}/figures`, uid, "PUT", { items: lines });
    ok((await set(9, [{ side: "income", kind: "gross_salary", monthly_cents: 700000 }])).j?.error?.code === "consent_required", "a case's figures need the privacy notice and the assessment consent");
    for (const kind of ["privacy_notice", "assessment"]) await call(`/fa/cases/${cid}/consents`, 9, "POST", { kind, notice_version: "v1-draft", captured_how: "signed_form", given_at: today });
    const lines = [
      { side: "income", kind: "gross_salary", monthly_cents: 700000, source: "payslip" }, { side: "deduction", kind: "epf", monthly_cents: 77000 },
      { side: "commitment", kind: "credit_card", monthly_cents: 20000, lender_name: "Bank A", account_last4: "1234" },
      { side: "commitment", kind: "credit_card", monthly_cents: 20000, lender_name: "bank a", account_last4: "1234" },
    ];
    const dup = await set(9, lines);
    ok(dup.status === 409 && dup.j?.error?.code === "possible_duplicate" && dup.j?.line === 3 && n(`SELECT COUNT(*) AS n FROM fa_items WHERE case_id = ?`, cid) === 0, "the same card twice (same lender, last four, amount) is refused and nothing is written", dup.text);
    lines[3].account_last4 = "9876";
    const ok1 = await set(9, lines);
    ok(ok1.status === 200 && ok1.j?.added === 4, "two different cards are accepted", ok1.text);
    const live = () => db.prepare(`SELECT id, kind, monthly_cents, state FROM fa_items WHERE case_id = ? AND voided_at IS NULL ORDER BY id`).all(cid);
    const L = live();
    ok(n(`SELECT COUNT(*) AS n FROM fa_item_meta`) === 2, "each card's lender and last four are kept beside it");
    const gross = L.find((x) => x.kind === "gross_salary");
    const slip = await upload(cid, 9, "payslip");
    await call(`/fa/items/${gross.id}/verify`, 9, "POST", { evidence_id: slip.j.id });
    const back = L.map((x) => ({ id: x.id, side: db.prepare(`SELECT side FROM fa_items WHERE id = ?`).get(x.id).side, kind: x.kind, monthly_cents: x.monthly_cents, ...(x.kind === "credit_card" ? { lender_name: x.id === L[2].id ? "Bank A" : "bank a", account_last4: x.id === L[2].id ? "1234" : "9876" } : {}) }));
    const keep = await set(9, back);
    ok(keep.j?.added === 0 && keep.j?.replaced === 0 && keep.j?.removed === 0 && live().find((x) => x.kind === "gross_salary").state === "verified", "saving the same set changes nothing and keeps the verification", keep.text);
    back[1].monthly_cents = 80000; back.pop();
    const rev = await set(9, back);
    const after = live();
    ok(rev.j?.replaced === 1 && rev.j?.removed === 1 && after.length === 3 && after.some((x) => x.kind === "epf" && x.monthly_cents === 80000), "a changed line is replaced and a missing one removed", rev.text);
    ok(n(`SELECT COUNT(*) AS n FROM fa_items WHERE case_id = ? AND voided_at IS NOT NULL`, cid) === 2, "...never edited: the old lines stay, voided");
    ok((await set(15, back)).status === 403, "another salesperson cannot change them");

    /* ---------- save, history, review ---------- */
    const a1 = await call(`/fa/cases/${cid}/assess`, 9, "POST", { amount_cents: 3000000, tenure_months: 60, rate_bp: 800 });
    ok(a1.status === 201 && a1.j?.result?.engine_version === "1.301.0", "a saved assessment carries the engine version", a1.text.slice(0, 200));
    const a2 = await call(`/fa/cases/${cid}/assess`, 9, "POST", { amount_cents: 2000000, tenure_months: 60, rate_bp: 800 });
    const hist = (await call(`/fa/cases/${cid}/assessments`, 9)).j?.assessments ?? [];
    ok(hist.length === 2 && hist[0].id === a2.j.assessment_id && hist[0].engine_version === "1.301.0", "every saved assessment stays in the history, newest first");
    ok((await call(`/fa/cases/${cid}`, 9, "PATCH", { stage: "matching" })).j?.error?.code === "review_required", "Sales cannot move a case to banker matching by themselves");
    ok((await call(`/fa/cases/${cid}/match`, 1, "POST", { state: "JOHOR" })).j?.error?.code === "review_required", "no banker matching before a Proceed - even for the CEO");
    const a3 = await call(`/fa/cases/${cid}/assess`, 9, "POST", {});
    ok(a3.j?.result?.outcome === "incomplete" && (await call(`/fa/cases/${cid}/review`, 9, "POST", { assessment_id: a3.j.assessment_id })).j?.error?.code === "invalid_state", "an assessment with missing information cannot be submitted");
    ok((await call(`/fa/cases/${cid}/review`, 9, "POST", { assessment_id: 999 })).status === 400, "a review is for one of this case's assessments");
    const sub = await call(`/fa/cases/${cid}/review`, 9, "POST", { assessment_id: a2.j.assessment_id, note: "Client prefers 5 years" });
    ok(sub.status === 201 && db.prepare(`SELECT stage FROM fa_cases WHERE id = ?`).get(cid).stage === "review", "Sales submits it; the case waits in review", sub.text);
    ok((await call(`/fa/cases/${cid}/review`, 9, "POST", { assessment_id: a2.j.assessment_id })).j?.error?.code === "already_pending", "one submission at a time");
    ok(db.prepare(`SELECT COUNT(*) AS n FROM notifications WHERE user_id IN (1, 3, 6)`).get().n >= 3, "the CEO, COO and CCO are told");
    const queue = (await call("/fa/reviews", 6)).j?.pending ?? [];
    ok(queue.length === 1 && queue[0].case_id === cid, "it is in the CCO's review queue");
    ok((await call(`/fa/cases/${cid}/review`, 9, "PUT", { decision: "proceed", reason: "Looks fine to me" })).status === 403, "Sales cannot decide (their own submission)");
    await call(`/fa/cases/${cid}/members`, 9, "POST", { user_id: 15 });
    ok((await call(`/fa/cases/${cid}`, 15)).status === 200 && (await call(`/fa/cases/${cid}/review`, 15, "PUT", { decision: "proceed", reason: "Looks fine to me too" })).status === 403, "an assisting salesperson cannot decide either");
    ok((await call(`/fa/cases/${cid}/review`, 6, "PUT", { decision: "proceed", reason: "short" })).status === 400, "a decision needs its reason");
    ok((await call(`/fa/cases/${cid}/review`, 6, "PUT", { decision: "approved", reason: "Bank will approve this" })).status === 400, "there is no 'approved' decision - only proceed, request info, concern, unsuitable");
    const ri = await call(`/fa/cases/${cid}/review`, 6, "PUT", { decision: "request_info", reason: "Need the latest statements", next_action: "Upload 3 months' bank statements" });
    ok(ri.status === 200 && db.prepare(`SELECT stage FROM fa_cases WHERE id = ?`).get(cid).stage === "profile" && n(`SELECT COUNT(*) AS n FROM tasks WHERE link_kind = 'fa_case' AND link_id = ? AND assigned_to = 9`, cid) === 1, "the CCO asks for information: back to profile, a task for the owner", ri.text);
    let threw = false; try { db.exec(`UPDATE fa_reviews SET reason = 'x'`); } catch { threw = true; }
    ok(threw, "review decisions are append only");
    /* the COO submits; the COO cannot decide it; the CEO (owner) can */
    await call(`/fa/cases/${cid}/review`, 3, "POST", { assessment_id: a2.j.assessment_id });
    const self = await call(`/fa/cases/${cid}/review`, 3, "PUT", { decision: "proceed", reason: "Within the verified guideline" });
    ok(self.status === 403 && self.j?.error?.code === "self_approval", "the COO cannot decide a review they submitted", self.text);
    const go = await call(`/fa/cases/${cid}/review`, 1, "PUT", { decision: "proceed", reason: "Within Bank A's verified guideline; documents complete" });
    ok(go.status === 200 && db.prepare(`SELECT stage FROM fa_cases WHERE id = ?`).get(cid).stage === "matching", "the CEO decides Proceed: the case moves to banker matching", go.text);
    const note = db.prepare(`SELECT message FROM notifications WHERE user_id = 9 ORDER BY id DESC LIMIT 1`).get()?.message ?? "";
    ok(/not a loan approval/.test(note) && !/approved\b(?! for internal)/.test(note.replace("not a loan approval", "")), "the salesperson reads 'internal progression - not a loan approval'", note);

    /* ---------- banker matching (D5) ---------- */
    const place = await call("/fa/localities", 1, "POST", { state: "JOHOR", district: "Johor Bahru", city: "Johor Bahru" });
    const br = await call("/fa/branches", 1, "POST", { bank_id: bank.j.id, name: "JB City", postcode: "80000", locality_id: place.j.id });
    const reg = (uid, name, email, extra = {}) => call("/fa/bankers", uid, "POST", { bank_id: bank.j.id, full_name: name, work_email: email, products: ["personal_financing"], assignments: [{ branch_id: br.j.id, coverage: "districts", areas: ["Johor Bahru"] }], ...extra });
    const b1 = await reg(9, "Banker Satu", "satu@banka.test"), b2 = await reg(9, "Banker Dua", "dua@banka.test"), b3 = await reg(9, "Banker Tiga", "tiga@banka.test");
    const vf = (id, fact) => call(`/fa/bankers/${id}/verify`, 3, "POST", { fact, method: "call_branch_line", evidence: "Called the branch official line, manager confirmed", verified_on: today });
    for (const id of [b1.j.id, b2.j.id]) { await vf(id, "identity"); await vf(id, "referral"); }
    await vf(b3.j.id, "identity");
    await call(`/fa/bankers/${b1.j.id}/availability`, 9, "POST", { availability: "available" });
    ok((await call(`/fa/cases/${cid}/match`, 9, "POST", { state: "Johore" })).status === 400, "matching needs the client's state from the list");
    const mt = await call(`/fa/cases/${cid}/match`, 9, "POST", { state: "JOHOR", district: "Johor Bahru" });
    const sl = mt.j?.shortlist ?? [], ex = mt.j?.excluded ?? [];
    ok(mt.status === 201 && sl.map((x) => x.banker).join(",") === "Banker Satu,Banker Dua" && sl[0].tier === "ready" && sl[1].tier === "check", "the shortlist: verified bankers covering the client's district, ready before check", JSON.stringify(sl));
    ok(ex.some((x) => x.banker === "Banker Tiga" && /Referral permission/.test(x.why)), "a banker without referral permission is excluded, with the reason");
    ok(!JSON.stringify(mt.j).match(/score|probab|chance/i), "no score and no approval chance anywhere");
    const other = await call(`/fa/cases/${cid}/match`, 9, "POST", { state: "SABAH" });
    ok(other.j?.shortlist?.length === 0 && other.j?.excluded?.every((x) => /Does not cover|Referral/.test(x.why)), "a client in a state nobody covers gets no banker");
    ok((await call(`/fa/cases/${cid}/allocations`, 9, "POST", { match_id: mt.j.match_id, banker_id: b3.j.id })).status === 400, "only a shortlisted banker can be proposed");
    ok((await call(`/fa/cases/${cid}/allocations`, 9, "POST", { match_id: mt.j.match_id, banker_id: b2.j.id })).status === 400, "a 'check first' banker needs a reason");
    const own = await call(`/fa/cases/${cid}/allocations`, 3, "POST", { match_id: mt.j.match_id, banker_id: b1.j.id });
    const ownAp = await call(`/fa/allocations/${own.j?.id}`, 3, "POST", { action: "approve" });
    ok(own.status === 201 && ownAp.status === 403 && ownAp.j?.error?.code === "self_approval", "the COO cannot approve a banker they proposed", ownAp.text);
    ok((await call(`/fa/allocations/${own.j?.id}`, 3, "POST", { action: "cancel", reason: "Sales will propose" })).status === 200, "...and cancels it");
    const al = await call(`/fa/cases/${cid}/allocations`, 9, "POST", { match_id: mt.j.match_id, banker_id: b1.j.id });
    ok(al.status === 201 && al.j?.state === "pending_review", "Sales proposes Banker Satu - pending approval", al.text);
    ok((await call(`/fa/cases/${cid}/allocations`, 9, "POST", { match_id: mt.j.match_id, banker_id: b2.j.id, reason: "Second opinion from another officer" })).j?.error?.code === "already_allocated", "one active banker per case and product");
    ok((await call(`/fa/allocations/${al.j.id}`, 9, "POST", { action: "approve" })).status === 403 && (await call(`/fa/allocations/${al.j.id}`, 6, "POST", { action: "approve" })).status === 403, "Sales and the CCO cannot approve an allocation (fa_allocate is the CEO's and COO's)");
    const ap = await call(`/fa/allocations/${al.j.id}`, 3, "POST", { action: "approve" });
    ok(ap.status === 200 && ap.j?.state === "awaiting_consent", "the COO approves; without a disclosure consent it waits for the client", ap.text);
    const enq0 = await call(`/fa/cases/${cid}/enquiries`, 9, "POST", { allocation_id: al.j.id, summary: "Introduced the client's case" });
    ok(enq0.status === 409 && enq0.j?.error?.code === "consent_required" && n(`SELECT COUNT(*) AS n FROM fa_enquiries`) === 0, "no enquiry before the client consents to disclosure to that bank");
    await call(`/fa/cases/${cid}/consents`, 9, "POST", { kind: "disclosure", captured_how: "signed_form", given_at: today, institution: "Bank A", documents: ["payslip"] });
    const enq = await call(`/fa/cases/${cid}/enquiries`, 9, "POST", { allocation_id: al.j.id, channel: "work_email", summary: "Introduced the client's case for personal financing" });
    const cs2 = db.prepare(`SELECT stage, banker_status, application_status FROM fa_cases WHERE id = ?`).get(cid);
    ok(enq.status === 201 && cs2.stage === "enquiry" && cs2.banker_status === "enquiry_sent" && cs2.application_status === "not_submitted", "the enquiry is recorded; the case is in enquiry; no application is claimed", JSON.stringify(cs2));
    const ic = await upload(cid, 9, "ic");
    const dx = (docs) => call(`/fa/cases/${cid}/disclosures`, 9, "POST", { enquiry_id: enq.j.id, document_ids: docs, channel: "work_email", purpose: "Pre-assessment by the bank" });
    const no = await dx([slip.j.id, ic.j.id]);
    ok(no.status === 409 && no.j?.error?.code === "consent_scope" && n(`SELECT COUNT(*) AS n FROM fa_disclosures`) === 0, "a document the consent does not cover (IC) is not sent - and nothing else in that batch either", no.text);
    const yes = await dx([slip.j.id]);
    ok(yes.status === 201 && yes.j?.recipient === "satu@banka.test", "the payslip goes to the banker's verified work email, under the consent", yes.text);
    ok((await dx([slip.j.id])).j?.error?.code === "already_sent", "the same document once per enquiry");
    let t2 = false; try { db.exec(`DELETE FROM fa_disclosures`); } catch { t2 = true; }
    ok(t2 && n(`SELECT COUNT(*) AS n FROM fa_disclosures WHERE consent_id IS NOT NULL AND banker_id = ?`, b1.j.id) === 1, "the disclosure record is append only and names the consent and the banker");
    await call(`/fa/consents/${db.prepare(`SELECT id FROM fa_consents WHERE kind = 'disclosure' AND case_id = ?`).get(cid).id}/withdraw`, 9, "POST", { note: "Client withdrew by email" });
    const slip2 = await upload(cid, 9, "payslip");
    ok((await dx([slip2.j.id])).j?.error?.code === "consent_required", "after the client withdraws, nothing more is sent");
    const fb = await call(`/fa/cases/${cid}/notes`, 9, "POST", { type: "banker", banker_id: b1.j.id, enquiry_id: enq.j.id, status: "indicatively_suitable", source: "email", body: "Banker says the profile looks acceptable" });
    ok(fb.status === 201 && db.prepare(`SELECT state FROM fa_enquiries WHERE id = ?`).get(enq.j.id).state === "feedback_received" && db.prepare(`SELECT application_status FROM fa_cases WHERE id = ?`).get(cid).application_status === "not_submitted", "banker feedback links to the enquiry and never becomes an approval");
    ok((await call(`/fa/cases/${cid}/agreement`, 1, "POST", {})).j?.error?.code === "legal_gate" && (await call(`/fa/cases/${cid}/fee`, 1, "POST", {})).j?.error?.code === "fee_after_disbursement", "the agreement stays off; the fee (on since 13-11-2026) bills nothing from a case");
    ok(n(`SELECT COUNT(*) AS n FROM users`) === 9 && n(`SELECT COUNT(*) AS n FROM customers`) === 2, "no banker became a User; no second customer was created");
    ok(finance() === before, "Finance, invoices, payments, commission and journals untouched", `${before} -> ${finance()}`);
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
const dir = mkdtempSync(join(tmpdir(), "fad-"));
bundle(root, "worker/src/index.ts", join(dir, "worker.mjs"));
report(await runtime(join(dir, "worker.mjs")));
const checks = n;
const F = "worker/src/fa.ts", M = "worker/src/fa-match.ts", E = "worker/src/fa-engine.ts";
const MUT = [
  [F, "a Quick Check stores", [["    if (b.final === true) await audit(env, user.id, \"fa.quick_check\", \"fa\", \"preview\", { lines: items.length, product, outcome: r.outcome });", "    await env.DB.prepare(`INSERT INTO fa_notes (case_id, note_type, body) VALUES (0, 'system', 'q')`).run(); if (b.final === true) await audit(env, user.id, \"fa.quick_check\", \"fa\", \"preview\", { lines: items.length, product, outcome: r.outcome });"]]],
  [F, "a Quick Check takes a name", [["for (const k of [\"name\", \"ic\", \"nric\", \"phone\", \"email\", \"customer\", \"client\"]) if (b[k] !== undefined)", "for (const k of [] as string[]) if (b[k] !== undefined)"]]],
  [F, "duplicates allowed", [["      if (seen.has(key) && !(l.dup && l.dup.length >= 10)) {", "      if (false) {"]]],
  [F, "a revised figure keeps its verification", [["        if (same(l, e)) { keep.add(l.id); continue; }", "        keep.add(l.id); continue;"]]],
  [F, "Sales skips review", [["      } else if (to === \"matching\" && (await reviewState(env, c.id)).decision !== \"proceed\") {", "      } else if (false) {"]]],
  [F, "Sales decides", [["    if (!can(user.role, \"fa_decide\")) return err(\"forbidden\", \"Only the CEO, COO or CCO decides a review\", 403);", ""]]],
  [F, "self decision", [["    if (st.submitted_by === user.id && !isExecutiveOwner(user)) {", "    if (false) {"]]],
  [F, "a decision without reason", [["    if (reason.length < min) return err(", "    if (false) return err("]]],
  [F, "an incomplete assessment reviewed", [["    if (a.outcome === \"incomplete\") return err(", "    if (false) return err("]]],
  [M, "matching before Proceed", [["  if (st.decision !== \"proceed\") return err(\"review_required\"", "  if (false) return err(\"review_required\""]]],
  [M, "a banker without referral permission", [["        if (!referral || referral.next_review_on < today) { out(\"Referral permission not confirmed\"); continue; }", ""]]],
  [M, "coverage ignored", [["        if (!hit) { out(`Does not cover ${state}`); continue; }", "        if (!hit) hit = { branch_id: null, branch: null, exact: false };"]]],
  [M, "self-approved allocation", [["      if (a.created_by === user.id && !isExecutiveOwner(user)) {", "      if (false) {"]]],
  [M, "enquiry without consent", [["    if (!(await disclosureConsents(env, c.id)).some((k) => k.key === bankKey(a.bank))) {", "    if (false) {"]]],
  [M, "a document outside the consent", [["  if (uncovered.length) return err(\"consent_scope\"", "  if (false) return err(\"consent_scope\""]]],
  [M, "the same document twice", [["  if (again.length) return err(\"already_sent\"", "  if (false) return err(\"already_sent\""]]],
  [E, "future rules applied", [["(!c.effective_from || c.effective_from <= today)", "true"]]],
  [F, "a future version retires today's", [["      if (!eff || eff <= mytToday()) await env.DB", "      await env.DB"]]],
  [E, "residual ignores living cost", [["  const residual = remaining == null || expenses === 0 ? null : remaining - expenses;", "  const residual = remaining;"]]],
  ["worker/src/permissions.ts", "Sales allocates", [['  fa_allocate: ["ceo", "coo"],', '  fa_allocate: ["ceo", "coo", "cco", "sales_marketing"],']]],
];
for (const [file, name, reps] of NOMUT ? [] : MUT) {
  n++;
  let src = readFileSync(join(root, file), "utf8");
  let applied = true;
  for (const [from, to] of reps) { if (!src.includes(from)) { applied = false; break; } src = src.replace(from, to); }
  if (!applied) { fail++; console.error(`FAIL mutation did not apply: ${name}`); continue; }
  const mdir = mkdtempSync(join(tmpdir(), "fad-m-"));
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
if (fail) { console.error(`fa-dsr: ${fail} of ${n} failed`); process.exit(1); }
console.log(`fa-dsr: ${checks} checks passed (${NOMUT ? "mutations skipped" : `${MUT.length} mutations caught`}) - one DSR engine, Quick Check stores nothing, one figure set without duplicates, Management decides (never their own, never 'approved'), banker matching only after Proceed, nothing sent without the client's consent`);
