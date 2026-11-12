/* v1.286.0 - Financial Advisory: the bank, branch and banker registry, by
   direct request against the whole worker (index.ts bundled) on SQLite with
   every migration applied (claude/BANKER-REGISTRY-BLUEPRINT-v1.1.md, stage 1,
   acceptance tests 1-7, 24-26 and 32). Each rule is also MUTATED.
   Invented banks and people only ("Bank A", "Banker Satu").

     node tests/fa-registry.mjs        (NOMUT=1 skips the mutations) */
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
  const users = () => n(`SELECT COUNT(*) AS n FROM users`);
  const usersBefore = users();
  try {
    /* ---------- 0183 ran in production with 1.285.0: it is never edited ---------- */
    const m183 = readFileSync(join(root, "worker/migrations/0183_financial_advisory.sql"), "utf8").replace(/\r\n/g, "\n");
    ok(sha(m183) === "919eba00d44a4ecd94e7078edcee38e9cda74c7d89d3a30b5eb4829c15d1f57a", "0183 is byte for byte the migration production ran - the registry lives in 0184");
    ok(!/fa_banks|fa_bankers/.test(m183) && /CREATE TABLE IF NOT EXISTS fa_bankers/.test(readFileSync(join(root, "worker/migrations/0184_fa_registry.sql"), "utf8")), "the registry tables are created by 0184, not 0183");
    /* ---------- who may see and change the registry ---------- */
    for (const [uid, who] of [[7, "HR"], [2, "super admin"], [22, "admin"], [21, "an agent"]]) {
      ok((await call("/fa/registry", uid)).status === 403, `${who} cannot open the registry (by direct request)`);
    }
    ok((await call("/fa/registry", 9)).status === 200 && (await call("/fa/registry", 6)).status === 200, "Sales and the CCO may read the directory");
    ok((await call("/fa/banks", 9, "POST", { name: "Bank A" })).status === 403 && (await call("/fa/banks", 6, "POST", { name: "Bank A" })).status === 403, "only the CEO or COO adds a bank");

    /* ---------- 1. ONE bank registry ---------- */
    const ba = await call("/fa/banks", 1, "POST", { name: "Bank A Berhad", kind: "commercial" });
    ok(ba.status === 201, "the CEO adds a bank (saved Pending)", ba.text);
    ok(db.prepare(`SELECT status FROM fa_banks WHERE id = ?`).get(ba.j.id).status === "pending", "...a new bank is never Verified on saving");
    for (const v of ["BANK A", "bank  a bhd", "Bank-A Berhad"]) {
      const d = await call("/fa/banks", 3, "POST", { name: v });
      ok(d.status === 409 && d.j?.error?.code === "duplicate_bank" && d.j?.existing?.id === ba.j.id, `"${v}" is the same bank, never a second record`, d.text);
    }
    const bb = await call("/fa/banks", 3, "POST", { name: "Bank B", kind: "islamic" });
    ok(bb.status === 201, "the COO adds a second bank");
    ok((await call(`/fa/banks/${ba.j.id}/verify`, 1, "POST", { source: "x", verified_on: today })).status === 400, "verifying a bank needs its source");
    ok((await call(`/fa/banks/${ba.j.id}/verify`, 1, "POST", { source: "Invented test bank, test data", verified_on: "2099-01-01" })).status === 400, "...and a day that is not in the future");
    ok((await call(`/fa/banks/${ba.j.id}/verify`, 1, "POST", { source: "Invented test bank, test data", verified_on: today })).status === 200, "the CEO verifies the bank with its source and date");
    ok((await call(`/fa/banks/${ba.j.id}/products`, 1, "POST", { product: "personal_financing", channel: "branch" })).status === 400, "a bank product needs its source");
    await call(`/fa/banks/${ba.j.id}/products`, 1, "POST", { product: "personal_financing", channel: "branch", source: "Invented test bank, test data" });
    await call(`/fa/banks/${ba.j.id}/products`, 1, "POST", { product: "debt_consolidation", channel: "central", source: "Invented test bank, test data" });
    await call(`/fa/banks/${bb.j.id}/products`, 3, "POST", { product: "personal_financing", channel: "branch", source: "Invented test bank, test data" });
    ok(n(`SELECT COUNT(*) AS n FROM fa_bank_products WHERE bank_id = ?`, ba.j.id) === 2, "a bank's products are one row each");

    /* ---------- 2. ONE branch registry, controlled places ---------- */
    ok((await call("/fa/localities", 9, "POST", { state: "JOHOR", district: "Johor Bahru", city: "Johor Bahru" })).status === 403, "Sales cannot add to the place list");
    ok((await call("/fa/localities", 1, "POST", { state: "Johore", district: "Johor Bahru", city: "Johor Bahru" })).status === 400, "a state must come from the controlled list");
    const jb = await call("/fa/localities", 1, "POST", { state: "JOHOR", district: "Johor Bahru", city: "Johor Bahru" });
    const sk = await call("/fa/localities", 1, "POST", { state: "JOHOR", district: "Johor Bahru", city: "Skudai" });
    const jb2 = await call("/fa/localities", 3, "POST", { state: "johor", district: "johor  bahru", city: "JOHOR BAHRU" });
    ok(jb.status === 201 && jb2.j?.existing === true && jb2.j?.id === jb.j.id, "the same place written differently is one place", jb2.text);
    ok((await call("/fa/branches", 1, "POST", { bank_id: 999, name: "X", postcode: "80000", locality_id: jb.j.id })).status === 400, "a branch's bank must exist in the registry (no bank is created from a branch)");
    ok((await call("/fa/branches", 1, "POST", { bank_id: ba.j.id, name: "JB City", postcode: "8000", locality_id: jb.j.id })).status === 400, "the postcode is five digits");
    const mis = await call("/fa/branches", 1, "POST", { bank_id: ba.j.id, name: "JB City", postcode: "50000", locality_id: jb.j.id });
    ok(mis.status === 409 && mis.j?.error?.code === "postcode_state_mismatch", "a postcode that reads as another state is stopped", mis.text);
    const br1 = await call("/fa/branches", 1, "POST", { bank_id: ba.j.id, name: "JB City Branch", postcode: "80000", locality_id: jb.j.id, phone: "07-000 0000" });
    ok(br1.status === 201, "the CEO adds a branch", br1.text);
    const dupBr = await call("/fa/branches", 3, "POST", { bank_id: ba.j.id, name: "jb city", postcode: "80000", locality_id: jb.j.id });
    ok(dupBr.status === 409 && dupBr.j?.error?.code === "duplicate_branch", "the same branch name and postcode is the same branch", dupBr.text);
    const br2 = await call("/fa/branches", 1, "POST", { bank_id: ba.j.id, name: "Skudai", postcode: "81300", locality_id: sk.j.id });
    const brB = await call("/fa/branches", 3, "POST", { bank_id: bb.j.id, name: "JB City", postcode: "80000", locality_id: jb.j.id });
    ok(br2.status === 201 && brB.status === 201, "another branch, and another bank's branch of the same name, are separate");
    const coords = await call("/fa/branches", 1, "POST", { bank_id: ba.j.id, name: "Taman Test", postcode: "81300", locality_id: sk.j.id, latitude: 1.5, longitude: 103.6 });
    ok(coords.status === 400, "coordinates are never accepted without their source (no invented locations)");
    ok(db.prepare(`SELECT verified FROM fa_branches WHERE id = ?`).get(br1.j.id).verified === 0, "a new branch is not verified on saving");
    ok((await call(`/fa/branches/${br1.j.id}/verify`, 1, "POST", { source: "Bank A branch locator, test", verified_on: today })).status === 200, "management verifies a branch with how and when");

    /* ---------- 3-6. ONE banker directory ---------- */
    const reg = (uid, extra = {}) => call("/fa/bankers", uid, "POST", { bank_id: ba.j.id, full_name: "Banker Satu", position: "Relationship manager", work_email: "satu@banka.test", work_phone: "07-111 2222",
      products: ["personal_financing"], assignments: [{ branch_id: br1.j.id, coverage: "districts", areas: ["Johor Bahru"], primary: true }], relationship_type: "direct", ...extra });
    ok((await reg(7)).status === 403 && (await reg(21)).status === 403, "HR and an agent cannot register a banker");
    ok((await reg(9, { work_email: "", work_phone: "" })).status === 400, "a banker needs a work email or work phone");
    ok((await reg(9, { products: ["home_loan"] })).status === 400, "only the products the system knows");
    ok((await reg(9, { bank_id: bb.j.id, products: ["debt_consolidation"], assignments: [{ branch_id: brB.j.id }] })).status === 400, "a banker's product must be one the bank offers in the registry");
    ok((await reg(9, { assignments: [{ branch_id: brB.j.id }] })).status === 400, "every branch must be the banker's own bank's");
    const s1 = await reg(9);
    ok(s1.status === 201 && s1.j?.status === "pending_verification", "Sales registers a banker - saved Pending, never Verified", s1.text);
    const row1 = db.prepare(`SELECT * FROM fa_bankers WHERE id = ?`).get(s1.j.id);
    ok(row1.owner_id === 9 && row1.registered_by === 9 && row1.email_key === "satu@banka.test" && row1.phone_key === "071112222", "...owned by who registered it, with normalised keys");
    ok(n(`SELECT COUNT(*) AS n FROM fa_banker_verifications WHERE banker_id = ?`, s1.j.id) === 0, "...and no verification exists yet");
    ok((await call("/fa/registry", 9)).j?.bankers?.find((x) => x.id === s1.j.id)?.status_now === "pending_verification", "6. the directory shows Pending verification - registering never verifies");
    const dupE = await reg(15, { full_name: "B. Satu", work_email: "SATU@BankA.test ", work_phone: "" });
    ok(dupE.status === 409 && dupE.j?.error?.code === "duplicate_banker" && dupE.j?.existing?.id === s1.j.id, "3. the same work email is the same banker - never a second record", dupE.text);
    const dupP = await reg(15, { full_name: "Banker Dua", work_email: "dua@banka.test", work_phone: "+60 7-111 2222" });
    ok(dupP.status === 409 && dupP.j?.error?.code === "possible_duplicate", "4. the same work phone is stopped as a possible duplicate", dupP.text);
    const dua = await reg(15, { full_name: "Banker Dua", work_email: "dua@banka.test", work_phone: "+60 7-111 2222", different_reason: "Shared branch line - different person, confirmed by the branch" });
    ok(dua.status === 201 && db.prepare(`SELECT duplicate_reason FROM fa_bankers WHERE id = ?`).get(dua.j.id).duplicate_reason?.startsWith("Shared"), "...a shared line is accepted only with the written reason, which is kept");
    const tiga = await reg(9, { full_name: "Banker Satu", work_email: "satu.other@bankb.test", work_phone: "", bank_id: bb.j.id, assignments: [{ branch_id: brB.j.id }] });
    ok(tiga.status === 201 && JSON.stringify(tiga.j?.same_name_as) === JSON.stringify([s1.j.id]) && n(`SELECT COUNT(*) AS n FROM fa_bankers WHERE full_name = 'Banker Satu'`) === 2, "5. a name alone never merges anyone - it is a warning, two records", tiga.text);
    ok((await reg(9, { full_name: "Banker Empat", work_email: "empat@banka.test", work_phone: "", products: ["debt_consolidation"], assignments: [{ branch_id: null, coverage: "national" }] })).status === 201, "a central-unit banker is registered with no branch, where the bank has a central channel");
    ok((await reg(9, { bank_id: bb.j.id, full_name: "Banker Lima", work_email: "lima@bankb.test", work_phone: "", assignments: [{ branch_id: null }] })).status === 400, "...but not where the bank has no central channel");
    ok(users() === usersBefore, "32. registering bankers created no login, no User and no Agent");

    /* ---------- 7. verification, never your own ---------- */
    const vf = (uid, id, extra = {}) => call(`/fa/bankers/${id}/verify`, uid, "POST", { fact: "identity", method: "call_branch_line", evidence: "Called the branch official line 07-000 0000, branch manager confirmed", verified_on: today, ...extra });
    ok((await vf(9, s1.j.id)).status === 403 && (await vf(6, s1.j.id)).status === 403, "Sales and the CCO cannot verify a banker");
    ok((await vf(3, s1.j.id, { evidence: "ok" })).status === 400, "a verification needs its evidence");
    ok((await vf(3, s1.j.id, { method: "whatsapp" })).status === 400, "...and an accepted method");
    ok((await vf(3, s1.j.id, { fact: "referral", restrictions: "Personal financing only" })).j?.error?.code === "invalid_state", "referral permission needs a verified identity first");
    const v1 = await vf(3, s1.j.id);
    ok(v1.status === 200 && v1.j?.next_review_on > today, "the COO verifies the contact identity; a next review date is set (12 months)", v1.text);
    ok((await call("/fa/registry", 9)).j?.bankers?.find((x) => x.id === s1.j.id)?.status_now === "verified", "the directory shows Verified, derived from the record");
    const coo = await reg(3, { full_name: "Banker Enam", work_email: "enam@banka.test", work_phone: "" });
    const self = await vf(3, coo.j.id);
    ok(self.status === 403 && self.j?.error?.code === "self_approval", "7. the COO cannot verify a banker they registered themselves", self.text);
    ok(n(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'auth.self_approval_refused' AND entity_id = ?`, String(coo.j.id)) === 1, "...the refusal is audited");
    const ceoOwn = await reg(1, { full_name: "Banker Tujuh", work_email: "tujuh@banka.test", work_phone: "" });
    ok((await vf(1, ceoOwn.j.id)).status === 200, "the verified company owner may verify his own registration (B3)");
    ok((await vf(1, coo.j.id)).status === 200, "the CEO verifies the COO's registration");
    const ref = await vf(1, s1.j.id, { fact: "referral", method: "written_letter", evidence: "Branch letter allows referrals for personal financing", restrictions: "Personal financing only" });
    ok(ref.status === 200, "referral permission is confirmed separately, with its restrictions");
    ok(n(`SELECT COUNT(*) AS n FROM fa_banker_verifications WHERE banker_id = ?`, s1.j.id) === 2, "identity and referral permission are two separate facts");
    let threw = false; try { db.exec(`UPDATE fa_banker_verifications SET evidence = 'x'`); } catch { threw = true; }
    let threw2 = false; try { db.exec(`DELETE FROM fa_bankers WHERE id = ${s1.j.id}`); } catch { threw2 = true; }
    ok(threw && threw2, "verifications are append only and a banker is never deleted");
    /* reverification: a lapsed review shows Requires reverification */
    db.prepare(`INSERT INTO fa_banker_verifications (banker_id, fact, method, evidence, verified_on, next_review_on, verified_by) VALUES (?, 'identity', 'other', 'An older test verification, invented', '2025-01-01', '2025-12-31', 1)`).run(dua.j.id);
    ok((await call("/fa/registry", 1)).j?.bankers?.find((x) => x.id === dua.j.id)?.status_now === "requires_reverification", "a review date passed shows Requires reverification");

    /* ---------- 26. availability ---------- */
    ok((await call(`/fa/bankers/${s1.j.id}/availability`, 15, "POST", { availability: "available" })).status === 403, "only the relationship owner or management updates availability");
    ok((await call(`/fa/bankers/${s1.j.id}/availability`, 9, "POST", { availability: "unavailable" })).status === 400, "unavailable needs an until date");
    ok((await call(`/fa/bankers/${s1.j.id}/availability`, 9, "POST", { availability: "available", case_limit: 3 })).status === 403, "only the CEO or COO sets a case limit");
    ok((await call(`/fa/bankers/${s1.j.id}/availability`, 9, "POST", { availability: "available" })).status === 200, "the owner updates availability");
    ok((await call("/fa/registry", 9)).j?.bankers?.find((x) => x.id === s1.j.id)?.availability_now === "available", "...shown as Available today");
    db.prepare(`UPDATE fa_bankers SET availability_on = date('now', '-31 days') WHERE id = ?`).run(s1.j.id);
    ok((await call("/fa/registry", 9)).j?.bankers?.find((x) => x.id === s1.j.id)?.availability_now === "unknown", "26. a statement older than 30 days shows Unknown");

    /* ---------- 24. a transfer keeps history ---------- */
    ok((await call(`/fa/bankers/${s1.j.id}/transfer`, 9, "POST", { branch_id: br2.j.id, reason: "Moved branch" })).status === 403, "Sales cannot move a banker");
    ok((await call(`/fa/bankers/${s1.j.id}/transfer`, 1, "POST", { branch_id: brB.j.id, reason: "Moved branch" })).status === 400, "a banker moves only within their own bank");
    const tr = await call(`/fa/bankers/${s1.j.id}/transfer`, 1, "POST", { branch_id: br2.j.id, reason: "Transferred to Skudai, per branch email" });
    const hist = db.prepare(`SELECT branch_id, ended_on, is_primary FROM fa_banker_branches WHERE banker_id = ? ORDER BY id`).all(s1.j.id);
    ok(tr.status === 200 && hist.length === 2 && hist[0].branch_id === br1.j.id && hist[0].ended_on === today && hist[1].branch_id === br2.j.id && hist[1].ended_on === null && hist[1].is_primary === 1, "24. a transfer ends the old assignment on the day and starts the new one - history kept", JSON.stringify(hist));

    /* ---------- 25. a closed branch ---------- */
    const dir = await call(`/fa/bankers/${dua.j.id}`, 1);
    ok(dir.status === 200 && dir.j?.assignments?.length === 1, "one banker's record carries its assignments");
    const cl = await call(`/fa/branches/${br1.j.id}/status`, 1, "POST", { status: "closed", note: "Branch closed, notice on bank website" });
    ok(cl.status === 200 && cl.j?.assignments_ended >= 1 && n(`SELECT COUNT(*) AS n FROM fa_banker_branches WHERE branch_id = ? AND ended_on IS NULL`, br1.j.id) === 0, "25. closing a branch ends its open assignments - the branch and history stay", cl.text);
    ok(n(`SELECT COUNT(*) AS n FROM fa_branches WHERE id = ?`, br1.j.id) === 1, "...a closed branch is never deleted");
    ok((await call("/fa/bankers", 9, "POST", { bank_id: ba.j.id, full_name: "Banker Lapan", work_email: "lapan@banka.test", products: ["personal_financing"], assignments: [{ branch_id: br1.j.id }] })).status === 409, "nobody is assigned to a closed branch");
    const rn = await call(`/fa/branches/${br2.j.id}/rename`, 1, "POST", { name: "Skudai Utama", note: "Renamed per bank notice" });
    ok(rn.status === 200 && db.prepare(`SELECT name FROM fa_branches WHERE id = ?`).get(br2.j.id).name === "Skudai Utama", "a renamed branch keeps its record (and its bankers)");

    /* ---------- status ---------- */
    const left = await call(`/fa/bankers/${dua.j.id}/status`, 1, "POST", { status: "left", reason: "Resigned from the bank" });
    ok(left.status === 200 && n(`SELECT COUNT(*) AS n FROM fa_banker_branches WHERE banker_id = ? AND ended_on IS NULL`, dua.j.id) === 0, "a banker who left keeps the record, assignments end");
    ok((await call("/fa/registry", 9)).j?.bankers?.find((x) => x.id === dua.j.id)?.status_now === "no_longer_available", "...shown as No longer available");
    ok((await vf(1, dua.j.id)).j?.error?.code === "invalid_state", "a banker who left is not verified");

    /* ---------- criteria and notes come from the registry ---------- */
    const crit = await call("/fa/criteria", 9, "POST", { bank_id: ba.j.id, product: "personal_financing", dsr_guideline_pct: 60, min_age: 21, max_age: 60, min_tenure_months: 12, max_tenure_months: 120, source: "Invented test bank, test data" });
    const terms = db.prepare(`SELECT bank_id, min_age, max_age, max_tenure_months FROM fa_criteria_terms WHERE criterion_id = ?`).get(crit.j?.id);
    ok(crit.status === 201 && db.prepare(`SELECT bank FROM fa_criteria WHERE id = ?`).get(crit.j.id).bank === "Bank A Berhad" && terms?.bank_id === ba.j.id && terms?.min_age === 21 && terms?.max_tenure_months === 120, "a criterion's bank is the registry's name; its bank and ranges are kept beside it", crit.text);
    const listed = (await call("/fa/criteria", 9)).j?.criteria?.find((c) => c.id === crit.j.id);
    ok(listed?.bank_id === ba.j.id && listed?.max_age === 60, "the criteria list carries the bank and the ranges to the engine", JSON.stringify(listed));
    /* a banker note names the directory banker (0184 fa_note_links) */
    const cs = await call("/fa/cases", 9, "POST", { product: "personal_financing", issuer_code: "a2z", new_customer: { name: "Encik Registry", phone: "013-222 3333" } });
    const bn = await call(`/fa/cases/${cs.j?.id}/notes`, 9, "POST", { type: "banker", banker_id: s1.j.id, source: "call", status: "under_review", body: "Banker is reviewing the profile" });
    ok(bn.status === 201 && db.prepare(`SELECT bank FROM fa_notes WHERE id = ?`).get(bn.j.id)?.bank === "Bank A Berhad" && db.prepare(`SELECT banker_id FROM fa_note_links WHERE note_id = ?`).get(bn.j.id)?.banker_id === s1.j.id, "a banker note takes the bank from the banker and links the banker", bn.text);
    ok((await call("/fa/criteria", 9, "POST", { bank: "Bank A Berhad", product: "personal_financing", source: "Typed bank name only" })).status === 400, "a criterion's bank cannot be typed in");
    ok((await call("/fa/criteria", 9, "POST", { bank_id: bb.j.id, product: "debt_consolidation", source: "Invented test bank" })).status === 400, "...and only for a product the bank offers");
    ok((await call("/fa/criteria", 9, "POST", { bank_id: ba.j.id, product: "personal_financing", min_age: 60, max_age: 21, source: "Invented test bank" })).status === 400, "a minimum above its maximum is refused");

    /* ---------- the registry's own history ---------- */
    const ev = await call("/fa/registry/events", 3);
    const kinds = new Set((ev.j?.events ?? []).map((e) => `${e.entity}:${e.event}`));
    ok(["bank:added", "bank:verified", "branch:added", "branch:status", "banker:registered", "banker:identity_verified", "banker:referral_verified", "banker:transferred", "banker:availability", "banker:status"].every((k) => kinds.has(k)), "every change writes the registry history", [...kinds].join(","));
    let threw3 = false; try { db.exec(`DELETE FROM fa_registry_events`); } catch { threw3 = true; }
    ok(threw3, "the registry history is append only");
    ok((await call("/fa/registry/events", 21)).status === 403, "an agent cannot read it");
    ok(n(`SELECT COUNT(*) AS n FROM fa_disclosures`) === 0 && n(`SELECT COUNT(*) AS n FROM fa_enquiries`) === 0, "32. nothing was sent to any banker - no enquiry, no disclosure");
    ok(users() === usersBefore, "no User was created anywhere in the registry");
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
const dir = mkdtempSync(join(tmpdir(), "far-"));
bundle(root, "worker/src/index.ts", join(dir, "worker.mjs"));
report(await runtime(join(dir, "worker.mjs")));
const checks = n;
const R = "worker/src/fa-registry.ts";
const MUT = [
  [R, "a duplicate bank", [["    if (same) return json({ error: { code: \"duplicate_bank\"", "    if (false) return json({ error: { code: \"duplicate_bank\""]]],
  [R, "a duplicate branch", [["    if (same) return json({ error: { code: \"duplicate_branch\"", "    if (false) return json({ error: { code: \"duplicate_branch\""]]],
  [R, "a duplicate banker email", [["      if (same) return json({ error: { code: \"duplicate_banker\"", "      if (false) return json({ error: { code: \"duplicate_banker\""]]],
  [R, "a shared phone without a reason", [["      if (same && differentReason.length < 10)", "      if (false)"]]],
  [R, "self verification", [["    if (bk.registered_by === user.id && !isExecutiveOwner(user)) {", "    if (false) {"]]],
  [R, "Sales verifies a banker", [["    if (!manage) return err(\"forbidden\", \"Only the CEO or COO verifies a banker\", 403);", ""]]],
  [R, "a verification without evidence", [["    if (evidence.length < 10) return err(", "    if (false) return err("]]],
  [R, "availability never goes stale", [["  if (!b.availability_on || daysBetween(b.availability_on, today) > AVAILABILITY_STALE_DAYS) return \"unknown\";", "  if (!b.availability_on) return \"unknown\";"]]],
  [R, "a postcode in another state", [["    if (fromCode && fromCode !== loc.state && postNote.length < 5) {", "    if (false) {"]]],
  [R, "coordinates without a source", [["coordSource.length < 5 || ", ""]]],
  [R, "a transfer rewrites history", [["UPDATE fa_banker_branches SET ended_on = ?1, end_reason = ?2 WHERE banker_id = ?3 AND is_primary = 1 AND ended_on IS NULL", "DELETE FROM fa_banker_branches WHERE banker_id = ?3 AND is_primary = 1 AND ?1 IS NOT NULL AND ?2 IS NOT NULL"]]],
  [R, "a closed branch keeps assignments", [["    if (status === \"closed\") {\n      /* a closed branch", "    if (false) {\n      /* a closed branch"]]],
  [R, "registering verifies", [["  if (!identity) return \"pending_verification\";", "  if (!identity) return \"verified\";"]]],
  [R, "a stale review still verified", [["  if (identity.next_review_on < today || (referral && referral.next_review_on < today)) return \"requires_reverification\";", ""]]],
  ["worker/src/permissions.ts", "Sales manages the registry", [['  fa_registry: ["ceo", "coo"],', '  fa_registry: ["ceo", "coo", "sales_marketing"],']]],
  ["worker/src/fa.ts", "a typed criteria bank", [["    if (!bk || !", "    if (false && !"]]],
];
for (const [file, name, reps] of NOMUT ? [] : MUT) {
  n++;
  let src = readFileSync(join(root, file), "utf8");
  let applied = true;
  for (const [from, to] of reps) { if (!src.includes(from)) { applied = false; break; } src = src.replace(from, to); }
  if (!applied) { fail++; console.error(`FAIL mutation did not apply: ${name}`); continue; }
  const mdir = mkdtempSync(join(tmpdir(), "far-m-"));
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
if (fail) { console.error(`fa-registry: ${fail} of ${n} failed`); process.exit(1); }
console.log(`fa-registry: ${checks} checks passed (${NOMUT ? "mutations skipped" : `${MUT.length} mutations caught`}) - one bank, one branch, one banker, nothing verified on saving, nobody verifies their own, history never rewritten, no login and nothing sent`);
