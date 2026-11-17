/* CLAIMS WORKSPACE 4.0 (v1.310.0) - runtime guard: the WHOLE worker bundled
 * against SQLite with every migration applied, by direct request as each
 * role, on a fixed clock (Monday 02-11-2026, 12:00 Malaysia time).
 *
 * The CEO, 15-11-2026: "approve as recommended" - C-0 ... C-13 in
 * claude/CLAIMS-WORKSPACE-4.0-BLUEPRINT.md. "ONE CLAIMS ENGINE. ONE
 * AUTHORITATIVE APPROVAL FLOW. NO SELF-APPROVAL. NO DUPLICATE PAYMENT
 * POSTINGS. CORRECT FINANCIAL REPORTS."
 *   C-1  the CEO's own claim (raised by him or paid to him) is decided and
 *        paid by the COO, in one step; the CEO never does - the company owner
 *        included (a claim is never an executive record)
 *   C-2  the Super Admin no longer approves or pays a claim (reads, only)
 *   C-3  a rejection asks for the authenticator code too; approving past a
 *        stage states the reason
 *   C-4  an employee's list is their own claims and those paid to them
 *   C-5  approved is never paid; nobody attaches the payment proof of their
 *        own claim; the proof only after Mark paid
 *   C-7  the cash back-fill never books again a payment Finance reversed
 *   C-8  a reimbursement is approved with its receipt (mileage-only and an
 *        advance excepted)
 *   C-10 the report by claim date or by the bank date, scope-aware
 *   C-11 a salary advance moves the payslip through Payroll's own rule, never
 *        into a month whose salaries are paid
 *   history  the claim, cash row and audit line production already holds are
 *        untouched
 * Then mutated copies of the worker must each fail a check. Invented people.
 *
 *   node tests/claims4.mjs            NOMUT=1 skips the mutations
 */
import { readFileSync, readdirSync, mkdtempSync, cpSync, writeFileSync, rmSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash, createHmac } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const root = fileURLToPath(new URL("..", import.meta.url));
const bundle = (srcRoot, out) => {
  const entry = join(srcRoot, "claims4-entry.ts");
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
const SECRET = "JBSWY3DPEHPK3PXP";
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const b32 = (s) => { let bits = 0, v = 0; const o = []; for (const ch of s) { v = (v << 5) | B32.indexOf(ch); bits += 5; if (bits >= 8) { o.push((v >>> (bits - 8)) & 255); bits -= 8; } } return Buffer.from(o); };
const totpAt = (ms) => { const c = Math.floor(ms / 30000); const b = Buffer.alloc(8); b.writeUInt32BE(Math.floor(c / 2 ** 32), 0); b.writeUInt32BE(c >>> 0, 4); const h = createHmac("sha1", b32(SECRET)).update(b).digest(); const o = h[h.length - 1] & 15; return String((((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1e6).padStart(6, "0"); };

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
  /* A TRUE RACE: while `barrier` is set, the route's read of the claim
     (the SQL holding `barrier.sql`) waits until both requests have read it -
     so both act on the same state, as two people pressing at once. */
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
    MEDIA: { put: async (_k, body) => { if (body && typeof body === "object" && "getReader" in body) await new Response(body).arrayBuffer(); }, get: async () => null, /* v1.310.0 - a stored receipt's stream is read to its end, as R2 does */ head: async () => null, list: async () => ({ objects: [] }), delete: async () => {} },
  };
  if (!globalThis.FixedLengthStream) globalThis.FixedLengthStream = class extends TransformStream { constructor() { super(); } };
  const RealDate = globalThis.Date;
  let fixed = Date.parse("2026-11-02T04:00:00Z");
  globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [fixed])); } static now() { return fixed; } };
  const code = () => { fixed += 31000; return totpAt(fixed); };
  const U = { ceo: 1, sa: 2, coo: 3, cco: 4, aina: 5, hana: 6, lia: 7 };
  db.exec(`INSERT INTO users (id, name, full_name, email, role, is_active, password_hash, totp_enabled, totp_secret, employment_status, base_salary_cents) VALUES
    (1,'Alif','Alif Farhan','alif@a2z.test','ceo',1,'x',1,'${SECRET}','permanent',900000),
    (2,'Root','System Root','root@a2z.test','super_admin',1,'x',1,'${SECRET}','permanent',0),
    (3,'Ops','Ops Lead','ops@a2z.test','coo',1,'x',1,'${SECRET}','permanent',800000),
    (4,'Cee','Cee Officer','cco@a2z.test','cco',1,'x',1,'${SECRET}','permanent',800000),
    (5,'Aina','Aina Seller','aina@a2z.test','sales_marketing',1,'x',1,'${SECRET}','permanent',300000),
    (6,'Hana','Hana HR','hana@a2z.test','hr_admin',1,'x',1,'${SECRET}','permanent',400000),
    (7,'Lia','Lia Seller','lia@a2z.test','sales_marketing',1,'x',1,'${SECRET}','permanent',300000)`);
  /* a paid claim as production holds one: paid 02-08, its cash row back-dated
     to 15-08 by the Finance 2.0 back-fill, the CEO's audit line */
  db.exec(`INSERT INTO claims (id, user_id, claim_date, category, amount_cents, status, decided_by, decided_at, created_at, paid_at, claim_type)
             VALUES (90, 4, '2026-08-01', 'travel', 1870, 'approved', 1, '2026-08-02 06:45:00', '2026-08-02 04:45:00', '2026-08-02 06:52:18', 'reimbursement')`);
  db.exec(`INSERT INTO cashflow_entries (entry_date, type, category, amount_cents, description, ref, created_by, effective_date, source_key)
             VALUES ('2026-08-15', 'out', 'claims', 1870, 'Staff claim reimbursement', 'CLM-90', 1, '2026-08-15', 'CLM-90')`);
  db.exec(`INSERT INTO audit_log (user_id, action, entity, entity_id, created_at) VALUES (1, 'claim.paid', 'claims', '90', '2026-08-02 06:52:18')`);
  db.exec(`INSERT INTO system_meta (key, value) VALUES ('company_owner', '{"user_id":1,"set_by":2,"set_by_name":"Root","set_at":"2026-11-01 06:00:00","reason":"test"}')`);
  db.exec(`INSERT INTO payroll_entries (user_id, month, basic_cents, net_cents) VALUES (5, '2026-11', 300000, 300000)`);
  const worker = (await import(pathToFileURL(workerBundle).href + `?v=${Math.random()}`));
  const app = worker.default;
  const tok = {};
  const session = (id) => { tok[id] = `t-${id}-${Math.random()}`; db.prepare(`INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, datetime('now', '+30 days'), datetime('now'))`).run(sha(tok[id]), id); }; // v1.259.0 - on the one clock, a session must outlive the test's two-day step
  for (const id of Object.values(U)) session(id);
  const call = async (path, uid, method = "GET", body) => {
    const h = { origin: "https://portal.a2z.test", cookie: `azone_session=${tok[uid]}; csrf_token=c1`, "x-csrf-token": "c1", "content-type": "application/json" };
    const r = await app.fetch(new Request(`https://api.a2z.test/api/v1/staff${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }), env, { waitUntil() {} });
    const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch { /* not json */ }
    return { status: r.status, j, text };
  };
  const one = (sql, ...a) => db.prepare(sql).get(...a);
  const n = (sql, ...a) => Number(db.prepare(sql).get(...a)?.n ?? 0);
  const noticed = (uid, like) => n(`SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND ref LIKE ?`, uid, like);
  const rowOf = async (uid, id) => ((await call(`/claims`, uid)).j?.claims ?? []).find((c) => c.id === id);
  const states = (c) => (c?.timeline ?? []).map((s) => `${s.key}:${s.state}`).join(" ");
  let seq = 0;
  /* v1.310.0 (Claims 4.0, C-8) - a reimbursement is approved with its receipt: the claimant attaches it, through its own route, as the form does */
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(200).fill(0)]);
  const attach = async (id, uid) => { const r = await app.fetch(new Request(`https://api.a2z.test/api/v1/staff/claims/${id}/receipt`, { method: "POST", headers: { origin: "https://portal.a2z.test", cookie: `azone_session=${tok[uid]}; csrf_token=c1`, "x-csrf-token": "c1", "content-type": "image/png", "content-length": String(PNG.length) }, body: PNG }), env, { waitUntil() {} }); return r.status; };
  const submit = async (uid, amount = 11.3) => { const id = (await call(`/claims`, uid, "POST", { items: [{ claim_date: "2026-11-01", category: "stationery", description: "Printer paper", amount }], submission_key: `k-${uid}-${++seq}-0123456789abcdef` })).j?.id; if (id) await attach(id, uid); return id; };
  const cash = (id) => db.prepare(`SELECT * FROM cashflow_entries WHERE ref = ? ORDER BY id`).all(`CLM-${id}`);
  const payroll = () => sha(JSON.stringify((() => { try { return db.prepare(`SELECT * FROM payroll_entries ORDER BY rowid`).all(); } catch { return []; } })()));
  const payroll0 = payroll();
  const race = (sqlPart) => { let go; const p = new Promise((r) => { go = r; }); barrier = { n: 0, p, go, sql: sqlPart }; };
  const hist = () => sha(JSON.stringify([one(`SELECT * FROM claims WHERE id = 90`), db.prepare(`SELECT * FROM cashflow_entries WHERE ref = 'CLM-90' ORDER BY id`).all(), db.prepare(`SELECT * FROM audit_log WHERE entity_id = '90' ORDER BY id`).all()]));
  const hist0 = hist();
  const row = (id) => one(`SELECT status, decided_by, paid_at, decision_note, payment_proof_key FROM claims WHERE id = ?`, id);
  const NOTE = "Urgent supplier run, receipt checked";
  const proof = async (id, uid) => (await app.fetch(new Request(`https://api.a2z.test/api/v1/staff/claims/${id}/payment-proof`, { method: "POST", headers: { origin: "https://portal.a2z.test", cookie: `azone_session=${tok[uid]}; csrf_token=c1`, "x-csrf-token": "c1", "content-type": "image/png", "content-length": String(PNG.length) }, body: PNG }), env, { waitUntil() {} })).status;
  const raw = async (uid, body) => (await call(`/claims`, uid, "POST", { ...body, submission_key: `k-${uid}-${++seq}-0123456789abcdef` })).j?.id;
  try {
    /* ---------- C-1: the CEO's own claim is the COO's ---------- */
    const C = await submit(U.ceo, 48);
    ok(C && noticed(U.coo, `claim:${C}`) >= 1 && noticed(U.ceo, `claim:${C}`) === 0, "C-1: the CEO's new claim tells the COO, who decides it");
    const cAsCeo = await rowOf(U.ceo, C), cAsCoo = await rowOf(U.coo, C);
    ok(cAsCeo && !(cAsCeo.actions ?? []).some((a) => ["approve", "reject", "pay", "return"].includes(a)), "C-1: the CEO is offered no decision on his own claim", JSON.stringify(cAsCeo?.actions));
    ok(cAsCoo && cAsCoo.actions.includes("approve") && cAsCoo.actions.includes("reject") && cAsCoo.my_turn === true && cAsCoo.waiting_on === "coo", "C-1: the COO is offered the decision, it is his turn, the claim waits on the COO", JSON.stringify([cAsCoo?.actions, cAsCoo?.my_turn, cAsCoo?.waiting_on]));
    ok(cAsCoo && cAsCoo.timeline.find((s) => s.key === "final")?.flags?.role === "coo" && !cAsCoo.timeline.some((s) => s.key === "hr" || s.key === "pre"), "C-1: one step, the COO's - no HR review, no pre-approval", JSON.stringify(cAsCoo?.timeline));
    const r1 = await call(`/claims/${C}/decide`, U.ceo, "POST", { action: "approve", totp: code() });
    ok(r1.status === 403 && row(C).status === "pending", "C-1: the CEO (the company owner) cannot approve his own claim", r1.text);
    ok((await call(`/claims/${C}/decide`, U.sa, "POST", { action: "approve", totp: code() })).status === 403 && (await call(`/claims/${C}/decide`, U.cco, "POST", { action: "approve", totp: code() })).status === 403, "C-1: nor the Super Admin, nor the CCO");
    ok((await call(`/claims/${C}/decide`, U.coo, "POST", { action: "approve" })).status === 401, "the COO's decision asks for his authenticator code");
    const r2 = await call(`/claims/${C}/decide`, U.coo, "POST", { action: "approve", totp: code() });
    ok(r2.status === 200 && row(C).status === "approved" && row(C).decided_by === U.coo && !row(C).paid_at && cash(C).length === 0, "C-1: the COO approves it; approved, not paid, nothing booked (C-5)", r2.text);
    ok((await call(`/claims/${C}/paid`, U.ceo, "POST", { paid_on: "2026-11-02" })).status === 403 && (await call(`/claims/${C}/paid`, U.sa, "POST", { paid_on: "2026-11-02" })).status === 403 && cash(C).length === 0, "C-1: the CEO cannot mark his own claim paid, nor the Super Admin");
    ok((await rowOf(U.coo, C))?.actions.includes("pay") && !(await rowOf(U.ceo, C))?.actions.includes("pay"), "C-1: Mark paid is offered to the COO, not to the CEO");
    ok((await proof(C, U.coo)) === 400, "C-5: no payment proof before Mark paid");
    const r3 = await call(`/claims/${C}/paid`, U.coo, "POST", { paid_on: "2026-11-02" });
    ok(r3.status === 200 && row(C).paid_at && cash(C).length === 1 && cash(C)[0].effective_date === "2026-11-02", "C-1: the COO marks it paid - one cash row on the bank date", r3.text);
    ok((await rowOf(U.coo, C))?.actions.includes("proof") && !(await rowOf(U.ceo, C))?.actions.includes("proof"), "C-5: the payer is offered the bank slip; the claimant is not");
    ok((await proof(C, U.ceo)) === 403 && !row(C).payment_proof_key, "C-5: the CEO cannot attach the payment proof of his own claim");
    ok((await proof(C, U.coo)) === 200 && row(C).payment_proof_key && !(await rowOf(U.coo, C))?.actions.includes("proof"), "C-5: the COO attaches it, once");
    /* paid to the CEO: raised by Aina, the payee the CEO */
    const P = await submit(U.aina, 25);
    db.prepare(`UPDATE claims SET payee_user_id = 1 WHERE id = ?`).run(P);
    ok((await call(`/claims/${P}/decide`, U.ceo, "POST", { action: "approve", totp: code(), note: NOTE })).status === 403, "C-1: the CEO cannot approve a claim paid to him");
    const rP = await call(`/claims/${P}/decide`, U.coo, "POST", { action: "approve", totp: code() });
    ok(rP.status === 200 && row(P).decided_by === U.coo, "C-1: the COO decides it, in one step", rP.text);

    /* a grant in Roles & Permissions never reaches the CEO's own claim, nor one's own payment proof */
    db.exec(`INSERT INTO system_meta (key, value) VALUES ('role_permissions', '{"perms":{"claims_decide":["ceo","hr_admin"]}}')`);
    const C2 = await submit(U.ceo, 21);
    ok((await call(`/claims/${C2}/decide`, U.hana, "POST", { action: "approve", totp: code(), note: NOTE })).status === 403 && row(C2).status === "pending", "C-1: HR given claims_decide still cannot decide the CEO's own claim - the COO's");
    const H = await submit(U.hana, 17);
    ok((await call(`/claims/${H}/decide`, U.hana, "POST", { action: "approve", totp: code(), note: NOTE })).status === 403, "...nor their own claim");
    await call(`/claims/${H}/decide`, U.ceo, "POST", { action: "approve", totp: code(), note: NOTE });
    await call(`/claims/${H}/paid`, U.ceo, "POST", { paid_on: "2026-11-02" });
    const hp = await proof(H, U.hana);
    ok(hp === 403 && !row(H).payment_proof_key && n(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'auth.self_approval_refused' AND entity_id = ?`, String(H)) >= 1, "C-5: ...nor attach the payment proof of their own claim (refused and audited)", String(hp));
    db.exec(`DELETE FROM system_meta WHERE key = 'role_permissions'`);
    /* a claim nobody could decide is never made */
    const nd = await call(`/claims`, U.ceo, "POST", { items: [{ claim_date: "2026-11-01", category: "meals", description: "Lunch", amount: 20 }], payee_user_id: U.coo, submission_key: `k-nd-${++seq}-0123456789abcdef` });
    ok(nd.status === 400 && nd.j?.error?.code === "no_decider", "C-1: the CEO's claim paid to the COO is refused - nobody could decide it", nd.text);
    ok((await call(`/claims/${C2}/payee`, U.hana, "POST", { payee_user_id: U.coo })).j?.error?.code === "no_decider" && (await call(`/claims/${C2}/edit`, U.ceo, "POST", { items: [{ claim_date: "2026-11-01", category: "stationery", description: "Printer paper", amount: 21 }], payee_user_id: U.coo })).j?.error?.code === "no_decider", "C-1: ...by a payee change or an edit either");
    ok((await call(`/claims/${C2}/payee`, U.hana, "POST", { payee_user_id: U.lia })).j?.ok === true, "...while any other payee is still set as before");

    /* ---------- C-2: the Super Admin reads, never decides or pays ---------- */
    const S = await submit(U.lia, 30);
    const asSa = await call(`/claims`, U.sa);
    const sRow = (asSa.j?.claims ?? []).find((x) => x.id === S);
    ok(asSa.j?.reads_all === true && asSa.j?.can_decide === false && sRow && !sRow.actions.some((a) => ["approve", "reject", "pay"].includes(a)), "C-2: the Super Admin reads every claim, with no decision offered", JSON.stringify([asSa.j?.reads_all, asSa.j?.can_decide, sRow?.actions]));
    ok((await call(`/claims/${S}/decide`, U.sa, "POST", { action: "approve", totp: code(), note: NOTE })).status === 403 && (await call(`/claims/${S}/decide`, U.sa, "POST", { action: "reject", totp: code(), note: "No" })).status === 403 && row(S).status === "pending", "C-2: the Super Admin's approval and rejection are refused");

    /* ---------- C-3: the code for a rejection, the reason for an override ---------- */
    const r4 = await call(`/claims/${S}/decide`, U.ceo, "POST", { action: "reject", note: "Personal parking" });
    ok(r4.status === 401 && row(S).status === "pending", "C-3: a rejection without the authenticator code is refused", r4.text);
    const r5 = await call(`/claims/${S}/decide`, U.ceo, "POST", { action: "approve", totp: code() });
    ok(r5.status === 400 && r5.j?.error?.code === "reason_required" && row(S).status === "pending", "C-3: approving past HR and the COO without a reason is refused", r5.text);
    ok((await call(`/claims/${S}/decide`, U.ceo, "POST", { action: "approve", totp: code(), note: "ok" })).j?.error?.code === "reason_required", "C-3: ...a reason of five characters or more");
    const r6 = await call(`/claims/${S}/decide`, U.ceo, "POST", { action: "approve", totp: code(), note: NOTE });
    ok(r6.status === 200 && row(S).decision_note.includes(NOTE) && row(S).decision_note.includes("bypassed"), "C-3: with the reason it is approved, the reason and the bypass on the record", JSON.stringify(row(S)));
    const R = await submit(U.lia, 12);
    ok((await call(`/claims/${R}/decide`, U.ceo, "POST", { action: "reject", totp: code(), note: "Personal purchase" })).status === 200 && row(R).status === "rejected", "C-3: with the code the rejection goes through");

    /* ---------- C-8: the receipt ---------- */
    const N = await raw(U.aina, { items: [{ claim_date: "2026-11-01", category: "stationery", description: "Pens", amount: 9 }] });
    const r7 = await call(`/claims/${N}/decide`, U.ceo, "POST", { action: "approve", totp: code(), note: NOTE });
    ok(r7.status === 400 && r7.j?.error?.code === "receipt_required" && row(N).status === "pending", "C-8: a reimbursement without its receipt is not approved", r7.text);
    ok((await attach(N, U.aina)) === 200 && (await call(`/claims/${N}/decide`, U.ceo, "POST", { action: "approve", totp: code(), note: NOTE })).status === 200, "C-8: ...with the receipt attached it is");
    const M = await raw(U.aina, { items: [{ claim_date: "2026-11-01", category: "travel", description: "Client visit", km: 40 }] });
    ok((await call(`/claims/${M}/decide`, U.ceo, "POST", { action: "approve", totp: code(), note: NOTE })).status === 200, "C-8: a mileage-only claim needs no receipt");
    const MX = await raw(U.aina, { items: [{ claim_date: "2026-11-01", category: "travel", description: "Client visit", km: 40 }, { claim_date: "2026-11-01", category: "travel", description: "Toll", amount: 6.5 }] });
    ok((await call(`/claims/${MX}/decide`, U.ceo, "POST", { action: "approve", totp: code(), note: NOTE })).j?.error?.code === "receipt_required", "C-8: ...but a toll beside the mileage does");

    /* ---------- C-11: the salary advance and Payroll ---------- */
    const A1 = await raw(U.aina, { claim_type: "salary_advance", payroll_month: "2026-11", purpose: "Car repair before payday", items: [{ claim_date: "2026-11-02", category: "other", description: "Car repair before payday", amount: 300 }] });
    ok(A1 && (await call(`/claims/${A1}/decide`, U.ceo, "POST", { action: "approve", totp: code(), note: NOTE })).status === 200, "C-8: a salary advance needs no receipt");
    const net0 = one(`SELECT net_cents FROM payroll_entries WHERE user_id = 5 AND month = '2026-11'`).net_cents;
    ok((await call(`/claims/${A1}/paid`, U.ceo, "POST", { paid_on: "2026-11-02" })).status === 200 && one(`SELECT net_cents FROM payroll_entries WHERE user_id = 5 AND month = '2026-11'`).net_cents === net0 - 30000, "C-11: paying the advance lowers that payslip's net by the advance, through Payroll's rule", String(net0));
    const A2 = await raw(U.aina, { claim_type: "salary_advance", payroll_month: "2026-12", purpose: "School fees in December", items: [{ claim_date: "2026-11-02", category: "other", description: "School fees in December", amount: 200 }] });
    await call(`/claims/${A2}/decide`, U.ceo, "POST", { action: "approve", totp: code(), note: NOTE });
    db.exec(`INSERT INTO payroll_payments (month, paid_at, paid_by) VALUES ('2026-12', '2026-11-02 03:00:00', 1)`);
    const r8 = await call(`/claims/${A2}/paid`, U.ceo, "POST", { paid_on: "2026-11-02" });
    ok(r8.status === 409 && r8.j?.error?.code === "month_paid" && !row(A2).paid_at && cash(A2).length === 0, "C-11: never into a payroll month whose salaries are paid", r8.text);

    /* ---------- C-10: the report ---------- */
    const O = await raw(U.aina, { items: [{ claim_date: "2026-10-28", category: "meals", description: "Client lunch", amount: 64 }] });
    await attach(O, U.aina);
    await call(`/claims/${O}/decide`, U.ceo, "POST", { action: "approve", totp: code(), note: NOTE });
    fixed = Date.parse("2026-12-01T04:00:00Z"); // recorded on 01-12, the money having left on 30-11
    ok((await call(`/claims/${O}/paid`, U.ceo, "POST", { paid_on: "2026-11-30" })).status === 200, "a claim dated October, recorded paid on 01-12 with the bank date 30-11");
    const oct = (await call(`/claims/report?month=2026-10`, U.ceo)).j, nov = (await call(`/claims/report?month=2026-11`, U.ceo)).j;
    const octRow = oct?.by_claim_date?.claims?.find((x) => x.id === O);
    ok(octRow && octRow.status === "approved" && octRow.pay_day === "2026-11-30" && oct.by_claim_date.paid.cents >= 6400 && !oct.by_payment_date.payments.some((x) => x.id === O), "C-10: by claim date it is October's (paid); by bank date it is not October's", JSON.stringify(octRow));
    const novPay = nov?.by_payment_date?.payments?.find((x) => x.id === O);
    ok(novPay && novPay.pay_day === "2026-11-30" && novPay.finance === "booked" && (nov.by_payment_date.payments.length > 0) && !((await call(`/claims/report?month=2026-12`, U.ceo)).j?.by_payment_date?.payments ?? []).some((x) => x.id === O) && !nov.by_claim_date.claims.some((x) => x.id === O), "C-10: by bank date it is November's (not December's, when it was recorded), booked in Finance", JSON.stringify(novPay));
    ok(nov.by_payment_date.payments.some((x) => x.id === C) && nov.advances.some((x) => x.id === A1) && nov.by_claim_date.claims.every((x) => x.claim_date.startsWith("2026-11")), "C-10: the month's payments and the advances it recovers");
    ok(/^CLM-AZOO\d{6}-\d+$/.test(novPay?.claim_no ?? ""), "C-10: the claim number as the form prints it", novPay?.claim_no);
    const paidBefore = nov.by_payment_date.paid.cents;
    /* Finance reverses O's cash row */
    const oRow = cash(O)[0];
    /* as cashbook.ts reverseCash writes it: its own key REV-<row>, pointing at the row it cancels */
    db.prepare(`INSERT INTO cashflow_entries (entry_date, type, category, amount_cents, description, ref, created_by, effective_date, source_key, reversal_of, reverse_reason) VALUES ('2026-12-01', 'in', 'claims', 6400, 'Reversal - Staff claim reimbursement', ?, 1, '2026-12-01', ?, ?, 'Paid to the wrong account')`).run(`REV-${oRow.id}`, `REV-${oRow.id}`, oRow.id);
    const nov2 = (await call(`/claims/report?month=2026-11`, U.ceo)).j;
    const novPay2 = nov2.by_payment_date.payments.find((x) => x.id === O);
    ok(novPay2?.finance === "reversed" && nov2.by_payment_date.paid.cents === paidBefore - 6400, "C-10: a reversed payment is shown as reversed and no longer summed as paid", JSON.stringify([novPay2, paidBefore, nov2.by_payment_date.paid.cents]));
    const ainaRep = (await call(`/claims/report?month=2026-11`, U.aina)).j;
    ok(ainaRep && ainaRep.reads_others === false && [...ainaRep.by_claim_date.claims, ...ainaRep.by_payment_date.payments, ...ainaRep.advances].every((x) => x.user_id === U.aina || x.id === P), "C-10: an employee's report is their own claims (and those paid to them)", JSON.stringify(ainaRep?.by_claim_date?.claims?.map((x) => x.user_id)));
    ok((await call(`/claims/report?month=2026-11`, U.sa)).j?.by_claim_date?.claims?.some((x) => x.user_id === U.lia), "C-10: the Super Admin's report reads every claim");

    /* ---------- C-7: the back-fill never re-books a reversed payment ---------- */
    const before7 = n(`SELECT COUNT(*) AS n FROM cashflow_entries WHERE ref LIKE ?`, `CLM-${O}%`);
    const bf = await call(`/erp/cashflow/backfill`, U.ceo, "POST", {});
    ok(bf.status === 200 && n(`SELECT COUNT(*) AS n FROM cashflow_entries WHERE ref LIKE ?`, `CLM-${O}%`) === before7, "C-7: the cash back-fill does not book the reversed payment again", JSON.stringify([bf.status, bf.text.slice(0, 120), before7]));
    ok(cash(C).length === 1 && cash(A1).length === 1, "...nor a second row for a payment already booked");

    /* ---------- C-4: whose claims a list holds ---------- */
    const ainaList = (await call(`/claims`, U.aina)).j;
    ok(ainaList?.reads_all === false && (ainaList.claims ?? []).length > 0 && ainaList.claims.every((x) => x.user_id === U.aina), "C-4: an employee lists their own claims only", JSON.stringify((ainaList?.claims ?? []).map((x) => x.user_id)));
    db.prepare(`UPDATE claims SET payee_user_id = 7 WHERE id = ?`).run(N);
    const liaList = (await call(`/claims`, U.lia)).j?.claims ?? [];
    ok(liaList.some((x) => x.id === N) && liaList.every((x) => x.user_id === U.lia || x.payee_user_id === U.lia), "C-4: ...and the claims paid to them");
    ok((await call(`/claims/${S}/receipt`, U.aina)).status === 403 && (await call(`/claims/${C}/payment-proof`, U.aina)).status === 403, "C-4: another person's receipt and payment proof are refused");

    ok(hist() === hist0, "history: the paid claim, its cash row and audit line production holds are untouched");
  } catch (e) {
    out.push([false, `runtime: ${e?.stack ?? e}`]);
  } finally {
    globalThis.Date = RealDate;
  }
  return out;
}

let fail = 0, n = 0;
const report = (list) => { for (const [p, m] of list) { n++; if (!p) { fail++; console.error(`FAIL ${m}`); } } };
const dir = mkdtempSync(join(tmpdir(), "claims4-"));
const main = join(dir, "worker.mjs");
bundle(root, main);
report(await runtime(main));

/* ---------- the screens, on the source: the pages draw what the server allows ---------- */
const src = (f) => readFileSync(join(root, f), "utf8");
const rp = src("components/portal/role-panels.tsx"), c4s = src("components/portal/claims4.tsx"), ov = src("components/portal/claims-overview.tsx");
const sok = (c, m) => { n++; if (!c) { fail++; console.error(`FAIL ${m}`); } };
sok(rp.includes("const isMine = (c: Claim) => c.user_id === userId || c.payee_user_id === userId;") && rp.includes("const mineOnly = claims.filter(isMine);") && rp.includes("<MyClaims4 list={mineOnly.filter("), "C-4: My Claims is this person's own claims and those paid to them - nobody else's");
sok(!/\bmainList\b/.test(rp.replace(/\/\*[\s\S]*?\*\//g, "")), "F-2: the list that showed reviewers other people's claims as theirs is gone");
sok(rp.includes("const others = claims.filter((c) => !isMine(c));") && rp.includes("const allPending = pending.filter((c) => !isMine(c));"), "C-1: Approvals never lists one's own claim");
sok(rp.includes('{(c.actions ?? []).includes("proof") && ('), "C-5: the bank slip upload follows the server's own answer");
sok(rp.includes('note: (action === "reject" || reason ? reason : note[id])') && /missingSkipped\.length > 0\) \{[\s\S]{0,400}await prompt\(/.test(rp), "C-3: approving past a stage asks for the reason and sends it");
sok(rp.includes("receiptMissing()") && c4s.includes("export const needsReceipt"), "C-8: Next from Attachments asks for the receipt, with the server's rule");
sok(rp.includes('useTabViewAddress("Claims", shown, setView, isClaimsView);') && rp.includes("<ViewSwitch value={shown}"), "C-0/C-12: the view is in the address; a phone has the view switch");
sok(ov.includes("api<ClaimsReport>(`/claims/report?month=${month}`)") && !/scope\.filter\(\(c\) => c\.paid_at && c\.paid_at\.slice/.test(ov), "C-10: Reports read the server's report, never a sum of the page's own list");
sok(/Total = Pending \+ Approved, awaiting payment \+ Paid \+ Rejected/.test(ov) && ov.includes('c.status === "approved" && !c.paid_at') , "C-5: the Overview counts Approved (awaiting payment) and Paid apart");
const checks = n;
if (process.env.NOMUT) {
  rmSync(dir, { recursive: true, force: true });
  if (fail) { console.error(`claims4: ${fail} of ${n} failed`); process.exit(1); }
  console.log(`claims4: ${n} checks passed (mutations skipped)`); process.exit(0);
}

const MUT = [
  ["C-1: the CEO's own claim open to any decider", [["worker/src/staff.ts", 'claimIsCeoOwn(r) ? user.role === "coo" : canUser(user, "claims_decide")', 'canUser(user, "claims_decide") || (claimIsCeoOwn(r) && user.role === "coo")']]],
  ["C-1: the CEO decides his own claim again (the decider rule and the executive record both opened)", [
    ["worker/src/staff.ts", 'claimIsCeoOwn(r) ? user.role === "coo" : canUser(user, "claims_decide")', 'canUser(user, "claims_decide") || (claimIsCeoOwn(r) && user.role === "coo")'],
    ["worker/src/decision-policy.ts", "if (isExecutiveOwner(actor) && !NEVER_EXECUTIVE.includes(action)) {", "if (isExecutiveOwner(actor)) {"]]],
  ["C-1: the CEO's own claim back on the CEO's chain", [["worker/src/claim-chain.ts", '  claimIsCeoOwn(r) ? "ceo" : claimChain(r.claimant_role ?? "");', '  claimChain(r.claimant_role ?? "");']]],
  ["C-1: not the COO's turn", [["worker/src/claim-chain.ts", '  if (w === "coo" || w === "cco") return acts.includes("preapprove") || (claimChainOf(r) === "ceo" && acts.includes("approve"));', '  if (w === "coo" || w === "cco") return acts.includes("preapprove");']]],
  ["C-1: a claim nobody could decide is made", [["worker/src/staff.ts", '      if (claimHasNoDecider(user.role, pu.role)) return err("no_decider", NO_DECIDER_MSG, 400); // v1.310.0 (C-1)\n', ""]]],
  ["C-2: the Super Admin decides claims again", [["worker/src/permissions.ts", 'claims_decide: ["ceo"]', 'claims_decide: ["super_admin", "ceo"]']]],
  ["C-3: a rejection without the code", [["worker/src/staff.ts", "    {\n      const stepUp = await requireFreshTotp(env, user, body?.totp, err);\n      if (stepUp) return stepUp;\n    }\n    if (row.status !== \"pending\") return err(\"invalid_state\", \"Already decided\", 400);", "    if (action === \"approve\") {\n      const stepUp = await requireFreshTotp(env, user, body?.totp, err);\n      if (stepUp) return stepUp;\n    }\n    if (row.status !== \"pending\") return err(\"invalid_state\", \"Already decided\", 400);"]]],
  ["C-3: an override without a reason", [["worker/src/staff.ts", "      if (chainOverride && !(typeof body?.note === \"string\" && body.note.trim().length >= 5)) {", "      if (false) {"]]],
  ["C-5: one's own payment proof", [["worker/src/staff.ts", '    const selfProof = await refuseSelf(env, user, "claim.proof", [stP.user_id, stP.payee_user_id], "claims", claimProof[1]!);\n    if (selfProof) return selfProof;\n', ""]]],
  ["C-5: the proof offered to anyone who pays", [["worker/src/claim-chain.ts", '!r.payment_proof_key && decider) out.push("proof")', '!r.payment_proof_key) out.push("proof")']]],
  ["C-7: the back-fill books a reversed payment again", [["worker/src/erp.ts", "\n             AND NOT EXISTS (SELECT 1 FROM cashflow_entries e WHERE e.ref = 'CLM-' || claims.id AND EXISTS (SELECT 1 FROM cashflow_entries r WHERE r.reversal_of = e.id))`", "`"]]],
  ["C-8: approved without the receipt", [["worker/src/staff.ts", '    if (action === "approve" && claimNeedsReceipt(row)) return err(', '    if (false) return err(']]],
  ["C-10: the bank date ignored", [["worker/src/staff.ts", "const payDay = (r: RepRow) => (r.paid_at ? (r.bank_date ?? mytDay(r.paid_at)) : null);", "const payDay = (r: RepRow) => (r.paid_at ? mytDay(r.paid_at) : null);"]]],
  ["C-10: a reversed payment summed as paid", [["worker/src/staff.ts", 'paid: sum(payments.filter((r) => finance(r) !== "reversed"))', "paid: sum(payments)"]]],
  ["C-10: the report not scoped", [["worker/src/staff.ts", "    const all = claimReadsAll(user.role, canUser(user, \"claims_decide\"));\n    const scope = claimScope(user.role, all, true, \"?1\");", "    const all = true;\n    const scope = claimScope(user.role, all, true, \"?1\");"]]],
  ["C-11: an advance paid into a paid payroll month", [["worker/src/staff.ts", '      if (salPaid) return err("month_paid",', '      if (false) return err("month_paid",']]],
  ["C-11: the payslip not moved", [["worker/src/staff.ts", "      await payrollApplyAdvance(env, cRow.recipient_id, cRow.payroll_month, cRow.amount_cents);\n", ""]]],
  ["C-4: an employee reads everyone's claims", [["worker/src/claims-scope.ts", "        : ` WHERE (c.user_id = ${me}${P})`;", "        : ``;"]]],
];
for (const [name, reps] of MUT) {
  n++;
  const files = new Map();
  let applied = true;
  for (const [file, from, to] of reps) {
    const s0 = files.get(file) ?? readFileSync(join(root, file), "utf8");
    if (!s0.includes(from)) { applied = false; break; }
    files.set(file, s0.replace(from, to));
  }
  if (!applied) { fail++; console.error(`FAIL mutation did not apply: ${name}`); continue; }
  const mdir = mkdtempSync(join(tmpdir(), "claims4-m-"));
  cpSync(join(root, "worker"), join(mdir, "worker"), { recursive: true, filter: (p) => !p.includes("node_modules") });
  cpSync(join(root, "package.json"), join(mdir, "package.json"));
  for (const d of ["lib", "constants", "types"]) { try { cpSync(join(root, d), join(mdir, d), { recursive: true }); } catch { /* not every folder exists */ } }
  for (const [file, text] of files) writeFileSync(join(mdir, file), text);
  try { bundle(mdir, join(mdir, "w.mjs")); } catch { fail++; console.error(`FAIL mutation did not build: ${name}`); rmSync(mdir, { recursive: true, force: true }); continue; }
  const res = await runtime(join(mdir, "w.mjs"));
  rmSync(mdir, { recursive: true, force: true });
  const bad = res.filter(([p]) => !p).map(([, m]) => m);
  if (!bad.length) { fail++; console.error(`FAIL mutation not caught: ${name}`); }
  else console.log(`caught: ${name} -> ${bad.slice(0, 2).join("; ").slice(0, 200)}`);
}
rmSync(dir, { recursive: true, force: true });
if (fail) { console.error(`claims4: ${fail} of ${n} failed`); process.exit(1); }
console.log(`claims4: ${checks} checks passed (${MUT.length} mutations caught) - Claims Workspace 4.0: the CEO's own claim decided and paid by the COO, never the CEO; the Super Admin reads and never decides; a rejection asks for the code and an override for the reason; an employee lists their own claims; approved is never paid and nobody proves their own payment; a reversed payment is never booked again; a reimbursement is approved with its receipt; the report by claim date or bank date, scoped; a salary advance through Payroll, never into a paid month; history untouched`);
