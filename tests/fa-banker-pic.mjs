/* v1.290.0 - Financial Advisory BANKER PIC workspace (the CEO, 12-11-2026,
   image 04; claude/BANKER-PIC-BLUEPRINT.md: G3 the relationship owner, the
   CEO or the COO edits a banker, G4 the directory words, G2 the banker's
   cases scoped, G5 the contact date, G6 the tenure on the letter). By direct
   request against the whole worker on SQLite with every migration applied.
   Invented banks and people only. Each rule is also MUTATED.

     node tests/fa-banker-pic.mjs        (NOMUT=1 skips the mutations) */
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
  const users0 = n(`SELECT COUNT(*) AS n FROM users`);
  const one = async (id, uid = 1) => (await call(`/fa/bankers/${id}`, uid)).j?.banker;
  const inList = async (id, uid = 9) => (await call("/fa/registry", uid)).j?.bankers?.find((x) => x.id === id);
  try {
    /* ---------- an invented bank, branch and two bankers ---------- */
    const bank = (await call("/fa/banks", 1, "POST", { name: "Bank A", kind: "commercial" })).j;
    await call(`/fa/banks/${bank.id}/products`, 1, "POST", { product: "personal_financing", channel: "branch", source: "Invented test bank" });
    const loc = (await call("/fa/localities", 1, "POST", { state: "JOHOR", district: "Johor Bahru", city: "Johor Bahru" })).j;
    const br = (await call("/fa/branches", 1, "POST", { bank_id: bank.id, name: "JB City", postcode: "80000", locality_id: loc.id })).j;
    const reg = (uid, name, email, phone) => call("/fa/bankers", uid, "POST", { bank_id: bank.id, full_name: name, work_email: email, work_phone: phone, products: ["personal_financing"], assignments: [{ branch_id: br.id, coverage: "branch", primary: true }] });
    const b1 = (await reg(9, "Banker Satu", "satu@bank-a.test", "07-111 2222")).j.id;
    const b2 = (await reg(15, "Banker Dua", "dua@bank-a.test", "07-333 4444")).j.id;
    for (const fact of ["identity", "referral"]) for (const id of [b1, b2]) await call(`/fa/bankers/${id}/verify`, 3, "POST", { fact, method: "call_branch_line", evidence: "Called the branch official line, test", verified_on: today });
    await call(`/fa/bankers/${b1}/availability`, 9, "POST", { availability: "available" });
    ok((await inList(b1))?.status_now === "verified", "Banker Satu is verified (identity and referral) and available");
    const verifs0 = n(`SELECT COUNT(*) AS n FROM fa_banker_verifications`);

    /* ---------- G3: who edits ---------- */
    const e1 = await call(`/fa/bankers/${b1}`, 9, "PATCH", { position: "Relationship manager", notes: "Prefers a call before email" });
    ok(e1.status === 200 && (await one(b1)).position === "Relationship manager" && (await one(b1)).notes === "Prefers a call before email", "the relationship owner (Sales) edits position and notes", e1.text);
    ok((await call(`/fa/bankers/${b1}`, 15, "PATCH", { position: "x" })).status === 403, "another salesperson cannot edit someone else's banker (direct request)");
    ok((await call(`/fa/bankers/${b1}`, 6, "PATCH", { position: "x" })).status === 403, "the CCO is not the owner and not CEO/COO - cannot edit");
    ok((await call(`/fa/bankers/${b1}`, 7, "PATCH", { position: "x" })).status === 403, "HR cannot");
    ok((await call(`/fa/bankers/${b1}`, 9, "PATCH", { owner_id: 15 })).status === 403, "the owner cannot hand the relationship to someone else - the CEO or COO does");
    ok((await call(`/fa/bankers/${b1}`, 9, "PATCH", { case_limit: 3 })).status === 403, "...nor set a case limit");
    ok((await call(`/fa/bankers/${b1}`, 3, "PATCH", { case_limit: 4 })).status === 200 && (await one(b1)).case_limit === 4, "the COO sets a case limit");
    ok((await call(`/fa/bankers/${b1}`, 1, "PATCH", { work_email: "", work_phone: "" })).status === 400, "a banker keeps a work email or a work phone");
    ok(db.prepare(`SELECT COUNT(*) AS n FROM fa_registry_events WHERE entity = 'banker' AND entity_id = ? AND event = 'edited'`).get(b1).n === 2, "each edit is in the banker's activity history");
    ok(n(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'fa.banker_edit'`) === 2, "...and audited");

    /* ---------- duplicates on edit ---------- */
    const dupE = await call(`/fa/bankers/${b1}`, 1, "PATCH", { work_email: "DUA@bank-a.test" });
    ok(dupE.status === 409 && dupE.j?.error?.code === "duplicate_banker" && (await one(b1)).work_email === "satu@bank-a.test", "another banker's work email is refused - one person, one record", dupE.text);
    const dupP = await call(`/fa/bankers/${b1}`, 1, "PATCH", { work_phone: "+60 7-333 4444" });
    ok(dupP.status === 409 && dupP.j?.error?.code === "possible_duplicate", "a work phone another banker has needs a written reason", dupP.text);
    ok(n(`SELECT COUNT(*) AS n FROM fa_banker_contact_changes`) === 0, "a refused edit records nothing");

    /* ---------- a changed contact must be verified again ---------- */
    const ch = await call(`/fa/bankers/${b1}`, 1, "PATCH", { work_email: "banker.satu@bank-a.test" });
    ok(ch.status === 200 && ch.j?.identity_reverify === true, "the CEO changes the work email - told it must be verified again", ch.text);
    ok(n(`SELECT COUNT(*) AS n FROM fa_banker_contact_changes WHERE banker_id = ? AND field = 'work_email' AND from_value = 'satu@bank-a.test'`, b1) === 1, "the old and the new email are recorded (append only)");
    ok((await one(b1)).status_now === "pending_verification" && (await inList(b1))?.status_now === "pending_verification", "the earlier identity confirmation no longer counts - Needs verification, in the record and the directory");
    ok(n(`SELECT COUNT(*) AS n FROM fa_banker_verifications`) === verifs0, "the old verification row is not touched (append only)");
    const same = await call(`/fa/bankers/${b1}`, 1, "PATCH", { work_email: "Banker.Satu@Bank-A.test" });
    ok(same.status === 200 && !same.j?.identity_reverify && n(`SELECT COUNT(*) AS n FROM fa_banker_contact_changes`) === 1, "a change of capitals only is not a new contact");
    /* the change and the new confirmation can fall in the same second here; a real check-back is later */
    await new Promise((r) => setTimeout(r, 1100));
    ok((await call(`/fa/bankers/${b1}/verify`, 3, "POST", { fact: "identity", method: "bank_domain_email", evidence: "Email from the bank domain, test", verified_on: today })).status === 200, "the COO verifies the new contact");
    ok((await one(b1)).status_now === "verified", "verified again");
    ok((await call(`/fa/bankers/${b2}`, 15, "PATCH", { work_phone: "07-111 2222", different_reason: "Shared branch line, different person" })).status === 200, "a shared work phone with the reason written is accepted");
    let blocked = false; try { db.prepare(`UPDATE fa_banker_contact_changes SET to_value = 'x'`).run(); } catch { blocked = true; }
    ok(blocked, "contact changes cannot be rewritten");

    /* ---------- two cases allocated to Banker Satu: one Sales' own, one another salesperson's ---------- */
    const mk = async (uid, name, phone) => (await call("/fa/cases", uid, "POST", { product: "personal_financing", issuer_code: "a2z", new_customer: { name, phone } })).j.id;
    const cA = await mk(9, "Encik Satu", "012-000 1111"), cB = await mk(15, "Puan Dua", "012-000 2222");
    for (const c of [cA, cB]) db.prepare(`INSERT INTO fa_allocations (case_id, product, bank_id, banker_id, state, created_by, decided_by, decided_at) VALUES (?, 'personal_financing', ?, ?, 'ready', 9, 1, datetime('now'))`).run(c, bank.id, b1);
    for (const kind of ["privacy_notice", "assessment"]) await call(`/fa/cases/${cA}/consents`, 9, "POST", { kind, notice_version: "v1-draft", captured_how: "signed_form", given_at: today });
    ok((await call(`/fa/cases/${cA}/notes`, 9, "POST", { type: "banker", banker_id: b1, status: "documents_required", body: "Send the latest payslip", contact_on: tomorrow })).status === 400, "a contact date in the future is refused (G5)");
    ok((await call(`/fa/cases/${cA}/notes`, 9, "POST", { type: "banker", banker_id: b1, status: "documents_required", body: "Send the latest payslip", contact_on: "2020-01-01" })).status === 400, "...and one before the case was opened");
    const fb = await call(`/fa/cases/${cA}/notes`, 9, "POST", { type: "banker", banker_id: b1, status: "documents_required", body: "Send the latest payslip", contact_on: today, source: "call" });
    ok(fb.status === 201 && db.prepare(`SELECT contact_on FROM fa_note_facts WHERE note_id = ?`).get(fb.j.id)?.contact_on === today, "banker feedback keeps the day of the contact", fb.text);
    const doc = await upload(cA, 9, "bank_decision");
    ok((await call(`/fa/cases/${cA}/notes`, 1, "POST", { type: "decision", bank_id: bank.id, status: "officially_approved", body: "Letter received", evidence_id: doc.j?.id, tenure_months: 0 })).status === 400, "a tenure of 0 months is refused (G6)");
    const dc = await call(`/fa/cases/${cA}/notes`, 1, "POST", { type: "decision", bank_id: bank.id, status: "officially_approved", body: "Letter received", evidence_id: doc.j?.id, bank_reference: "REF-1", approved_cents: 5000000, tenure_months: 60 });
    ok(dc.status === 201 && db.prepare(`SELECT tenure_months FROM fa_note_facts WHERE note_id = ?`).get(dc.j.id)?.tenure_months === 60, "the official decision keeps the tenure the letter states", dc.text);
    blocked = false; try { db.prepare(`UPDATE fa_note_facts SET tenure_months = 12`).run(); } catch { blocked = true; }
    ok(blocked, "note facts cannot be rewritten");
    const pic = (await call(`/fa/cases/${cA}`, 9)).j;
    ok(pic?.notes?.some((x) => x.contact_on === today) && pic?.notes?.some((x) => x.tenure_months === 60), "the case's notes carry the contact date and the tenure");

    /* ---------- G2: the banker's cases, scoped ---------- */
    const s9 = (await call(`/fa/bankers/${b1}/cases`, 9)).j;
    ok(s9?.counts?.allocated === 2 && s9?.counts?.outcome === 1, "Sales sees both allocations counted, and one official outcome", JSON.stringify(s9?.counts));
    const mine = s9?.cases?.find((x) => x.mine), other = s9?.cases?.find((x) => !x.mine);
    ok(mine?.case_ref && mine?.client === "Encik Satu" && mine.feedback?.[0]?.contact_on === today && mine.decisions?.[0]?.tenure_months === 60, "...their own case in full: client, feedback with its contact date, the decision with its tenure", JSON.stringify(mine).slice(0, 300));
    ok(other && other.case_ref === undefined && other.client === undefined && other.feedback === undefined && !JSON.stringify(s9).includes("Puan Dua"), "...another salesperson's client is counted but not shown (no name, no case ref)", JSON.stringify(other));
    const sc = (await call(`/fa/bankers/${b1}/cases`, 1)).j;
    ok(sc?.cases?.filter((x) => x.mine).length === 2, "the CEO sees both cases");
    ok((await call(`/fa/bankers/${b1}/cases`, 7)).status === 403 && (await call(`/fa/bankers/${b1}/cases`, 21)).status === 403, "HR and an agent cannot read a banker's cases");
    ok((await one(b1))?.last_contact_at, "the banker shows the last contact (the feedback just linked)");
    ok((await inList(b1))?.last_contact_at, "...in the directory too");
    ok((await call(`/fa/bankers/${b1}`, 1)).j?.can?.edit === true && (await call(`/fa/bankers/${b1}`, 15)).j?.can?.edit === false && (await call(`/fa/bankers/${b1}`, 9)).j?.can?.edit === true, "the record says who may edit: the owner and CEO/COO, not another salesperson");

    /* ---------- a banker who left is kept as they were ---------- */
    await call(`/fa/bankers/${b2}/status`, 1, "POST", { status: "left", reason: "Left the bank, test" });
    ok((await call(`/fa/bankers/${b2}`, 1, "PATCH", { notes: "x" })).status === 409, "a banker who left cannot be edited");
    ok(n(`SELECT COUNT(*) AS n FROM users`) === users0, "no portal account is created for any banker");
    ok(finance() === before, "no finance, sales, payment, commission or journal row is written");
  } catch (e) { ok(false, "the run threw", String(e?.stack ?? e)); }
  finally { globalThis.fetch = realFetch; db.close(); }
  return out;
}

let fail = 0, n = 0;
const report = (list) => { for (const [p, m] of list) { n++; if (!p) { fail++; console.error(`FAIL ${m}`); } } };
const NOMUT = process.env.NOMUT === "1";
const dir = mkdtempSync(join(tmpdir(), "fbp-"));
bundle(root, "worker/src/index.ts", join(dir, "worker.mjs"));
report(await runtime(join(dir, "worker.mjs")));
const checks = n;
const R = "worker/src/fa-registry.ts", F = "worker/src/fa.ts";
const MUT = [
  [R, "anyone edits a banker", [["    if (!(manage || (register && bk.owner_id === user.id))) return err(\"forbidden\", \"The banker's relationship owner, the CEO or the COO edits these details\", 403);", ""]]],
  [R, "the owner hands the relationship on", [["      if (!manage) return err(\"forbidden\", \"Only the CEO or COO changes the relationship owner\", 403);", ""]]],
  [R, "a changed contact keeps its verification", [["  return identity.created_at && identity.created_at > contactChangedAt ? identity : null;", "  return identity;"]]],
  [R, "an edit takes another banker's email", [["        if (same) { return json({ error: { code: \"duplicate_banker\", message: `${same.full_name} (${same.bank}) already has this work email - open that record.` }, existing: same }, 409); }\n      }\n      put(\"work_email\"", "      }\n      put(\"work_email\""], ["      if (/UNIQUE/i.test(String(e))) return err(\"duplicate_banker\", \"Another banker has this work email.\", 409);", ""]]],
  [R, "the contact change is not recorded", [["    for (const x of contact) stmts.push(", "    for (const x of [] as typeof contact) stmts.push("]]],
  [F, "another salesperson's client shown", [["      if (!may) { cases.push({ allocation_id: r.allocation_id, state: r.state, mine: false }); continue; }", ""]]],
  [F, "a future contact date", [["(contactOn && (contactOn > mytToday() || contactOn < c.created_at.slice(0, 10)))", "(false)"]]],
  [F, "the tenure is lost", [["      await facts(Number(row?.id), null, tenure);", ""]]],
];
for (const [file, name, reps] of NOMUT ? [] : MUT) {
  n++;
  let src = readFileSync(join(root, file), "utf8");
  let applied = true;
  for (const [from, to] of reps) { if (!src.includes(from)) { applied = false; break; } src = src.replace(from, to); }
  if (!applied) { fail++; console.error(`FAIL mutation did not apply: ${name}`); continue; }
  const mdir = mkdtempSync(join(tmpdir(), "fbp-m-"));
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
if (fail) { console.error(`fa-banker-pic: ${fail} of ${n} failed`); process.exit(1); }
console.log(`fa-banker-pic: ${checks} checks passed (${NOMUT ? "mutations skipped" : `${MUT.length} mutations caught`}) - the owner, CEO or COO edits a banker; a changed contact is verified again; one record per email; the cases of a banker counted for all and shown only to those who may open them; the contact date and the tenure kept, written once`);
