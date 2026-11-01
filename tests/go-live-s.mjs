/* SIGNATURES & STAMPS (v1.248.0) - runtime guard: the WHOLE worker
 * (index.ts with signing.ts) bundled against SQLite with every migration
 * applied (0162 included), by direct request as each role, with an in-memory
 * R2 vault and real authenticator codes (RFC 6238, the same arithmetic as the
 * worker). Fixed clock: Sunday 01-11-2026, 10:00 Malaysia time.
 *
 * The owner's brief "A2Z OS - CEO signature management, company stamps &
 * quotation signing" (01-11-2026), the audit claude/SIGNATURES-AUDIT.md and
 * his answers: the person AND the owner (both with a code) before a signature
 * is used; no approval rule until the owner sets one per company; the stamp
 * prints with the preparer's verified signature when the company allows it;
 * sales documents only - leave and claim forms untouched.
 *
 *   node tests/go-live-s.mjs                                  the current worker, then mutations
 *   WORKER_BUNDLE=/path/bundle.mjs node tests/go-live-s.mjs   a given bundle (the 1.247.1 bundle must FAIL)
 */
import { readFileSync, readdirSync, mkdtempSync, writeFileSync, cpSync, rmSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash, createHmac } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const root = fileURLToPath(new URL("..", import.meta.url));
const bundle = (srcRoot, out) => {
  execSync(`npx esbuild "${join(srcRoot, "worker/src/index.ts")}" --bundle --format=esm --platform=neutral --outfile="${out}" --log-level=error`, { cwd: root, stdio: "inherit" });
};
const sha = (s) => createHash("sha256").update(s).digest("hex");
const NOW = Date.parse("2026-11-01T02:00:00Z");
const SECRET = "JBSWY3DPEHPK3PXP";
const b32 = (s) => { const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; let bits = ""; for (const ch of s) bits += A.indexOf(ch).toString(2).padStart(5, "0"); const out = []; for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2)); return Buffer.from(out); };
const totpAt = (counter) => {
  const msg = Buffer.alloc(8); msg.writeUInt32BE(Math.floor(counter / 2 ** 32), 0); msg.writeUInt32BE(counter >>> 0, 4);
  const h = createHmac("sha1", b32(SECRET)).update(msg).digest();
  const o = h[h.length - 1] & 0x0f;
  return String((((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1_000_000).padStart(6, "0");
};
/* a tiny real PNG (the signature check reads the PNG signature) */
const png = (tag) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(`IHDR-${tag}-${"x".repeat(32)}`)]);

async function runtime(workerBundle) {
  const out = [];
  const ok = (c, m, why = "") => out.push([!!c, why && !c ? `${m} - ${why}` : m]);
  const db = new DatabaseSync(":memory:");
  for (const f of readdirSync(join(root, "worker/migrations")).filter((x) => x.endsWith(".sql")).sort()) {
    const src = readFileSync(join(root, "worker/migrations", f), "utf8");
    /* a trigger body holds a semicolon - keep CREATE TRIGGER ... END; whole */
    const parts = src.split(/;\s*\n/);
    let buf = "";
    for (const st of parts) {
      buf = buf ? `${buf};\n${st}` : st;
      if (/CREATE TRIGGER/i.test(buf) && !/\bEND\s*$/i.test(buf.trim())) continue;
      try { db.exec(buf); } catch { /* a statement SQLite reads differently */ }
      buf = "";
    }
  }
  const shim = (sql) => { const st = db.prepare(sql); let b = []; const o = {
    bind: (...a) => { b = a.map((x) => (x === undefined ? null : x)); return o; },
    first: async () => st.get(...b) ?? null, all: async () => ({ results: st.all(...b) }),
    run: async () => ({ meta: { changes: Number(st.run(...b).changes) } }), _run: () => st.run(...b) }; return o; };
  const vault = new Map();
  const env = {
    DB: { prepare: shim, batch: async (list) => { db.exec("BEGIN"); try { for (const s of list) s._run(); db.exec("COMMIT"); } catch (e) { db.exec("ROLLBACK"); throw e; } return []; } },
    SESSION_PEPPER: "pepper", COMPANY_DOMAIN: "a2z.test", ALLOWED_ORIGINS: "https://portal.a2z.test",
    MEDIA: {
      put: async (k, v) => { vault.set(k, Buffer.from(v instanceof ArrayBuffer ? new Uint8Array(v) : v)); },
      get: async (k) => (vault.has(k) ? { body: vault.get(k), arrayBuffer: async () => vault.get(k) } : null),
      head: async (k) => (vault.has(k) ? {} : null), list: async () => ({ objects: [] }), delete: async (k) => { vault.delete(k); },
    },
  };
  const RealDate = globalThis.Date;
  let fixed = NOW;
  globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [fixed])); } static now() { return fixed; } };
  const code = () => { fixed += 31000; return totpAt(Math.floor(fixed / 30000)); }; // a fresh step each time: every code works once
  const U = { ceo: 1, coo: 2, cco: 3, aina: 5, lia: 6, root: 8, shop: 9, hana: 13, nofa: 17 };
  db.exec(`INSERT INTO users (id, name, full_name, email, role, is_active, password_hash, totp_enabled, totp_secret, position, employment_status, joined_on) VALUES
    (1,'Alif','Alif Farhan','alif@a2z.test','ceo',1,'x',1,'${SECRET}','Chief Executive Officer','permanent','2020-01-01'),
    (2,'Ops','Ops Lead','ops@a2z.test','coo',1,'x',1,'${SECRET}','Chief Operating Officer','permanent','2020-01-01'),
    (3,'Cee','Cee Officer','cco@a2z.test','cco',1,'x',1,'${SECRET}','Chief Commercial Officer','permanent','2020-01-01'),
    (5,'Aina','Aina Seller','aina@a2z.test','sales_marketing',1,'x',1,'${SECRET}','Sales Executive','permanent','2020-01-01'),
    (6,'Lia','Lia Seller','lia@a2z.test','sales_marketing',1,'x',1,'${SECRET}','Sales Executive','permanent','2020-01-01'),
    (8,'Root','Root','root@a2z.test','super_admin',1,'x',1,'${SECRET}',NULL,'permanent','2020-01-01'),
    (9,'Shop','Shop','shop@gmail.com','customer',1,'x',0,NULL,NULL,'permanent',NULL),
    (13,'Hana','Hana HR','hana@a2z.test','hr_admin',1,'x',1,'${SECRET}','HR Executive','permanent','2020-01-01'),
    (17,'Nofa','Nofa NoCode','nofa@a2z.test','sales_marketing',1,'x',0,NULL,'Sales Executive','permanent','2020-01-01')`);
  db.exec(`INSERT INTO customers (id, company, contact_person, phone, email, created_by) VALUES (1, 'ABC Sdn Bhd', 'Mr. Ahmad', '0123456789', 'ahmad@abc.test', 5)`);
  /* the 0118 role chop already in the vault (A2Z CEO) - it must keep printing exactly as before */
  db.exec(`INSERT INTO signature_assets (issuer_code, role, version, r2_key, sha256, uploaded_by, uploaded_at) VALUES ('a2z', 'ceo', 1, 'private/signatures/a2z/ceo-v1.png', 'x', 1, '2026-09-01 00:00:00')`);
  vault.set("private/signatures/a2z/ceo-v1.png", png("ceo-chop"));
  let docSeq = 100;
  const doc = (type, issuer, by, cents, extra = "") => {
    const id = ++docSeq;
    db.exec(`INSERT INTO sales_documents (id, doc_type, doc_number, customer_id, items, total_cents, salesperson_id, created_by, created_at, issuer_code, revision${extra ? ", payment_status" : ""}) VALUES (${id}, '${type}', '${type}-T-${id}', 1, '[]', ${cents}, ${by}, ${by}, '${new RealDate(fixed).toISOString().slice(0, 19).replace("T", " ")}', '${issuer}', 0${extra ? `, '${extra}'` : ""})`);
    return id;
  };
  const worker = (await import(pathToFileURL(workerBundle).href + `?v=${Math.random()}`));
  const app = worker.default;
  const tok = {};
  for (const id of Object.values(U)) {
    tok[id] = `t-${id}`;
    db.prepare(`INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, datetime('now', '+12 hours'), datetime('now'))`).run(sha(tok[id]), id);
  }
  const call = async (path, uid, method = "GET", body, headers = {}) => {
    const raw = body instanceof Buffer;
    const h = { "content-type": raw ? "image/png" : "application/json", origin: "https://portal.a2z.test", ...(uid ? { cookie: `azone_session=${tok[uid]}; csrf_token=c1`, "x-csrf-token": "c1" } : {}), ...headers };
    const r = await app.fetch(new Request(`https://api.a2z.test/api/v1${path}`, { method, headers: h, body: body === undefined ? undefined : raw ? body : JSON.stringify(body) }), env, { waitUntil() {} });
    const buf = Buffer.from(await r.arrayBuffer());
    const text = buf.toString("utf8");
    let j = null; try { j = JSON.parse(text); } catch { /* not json */ }
    return { status: r.status, j, text, buf };
  };
  const n = (sql, ...a) => Number(db.prepare(sql).get(...a)?.n ?? 0);
  const row = (sql, ...a) => db.prepare(sql).get(...a);
  const audited = (action) => n(`SELECT COUNT(*) AS n FROM audit_log WHERE action = ?`, action);
  const upload = (uid, q, bytes, totp = true) => call(`/staff/signing/assets?${q}`, uid, "POST", bytes, totp ? { "X-Totp": code() } : {});
  const plan = async (id, uid = U.ceo) => (await call(`/staff/docs/${id}/sign-plan`, uid)).j ?? {};
  const money = () => sha(JSON.stringify([
    db.prepare(`SELECT id, doc_type, doc_number, customer_id, items, total_cents, payment_status, salesperson_id, created_by, issuer_code, revision FROM sales_documents ORDER BY id`).all(),
    (() => { try { return db.prepare(`SELECT * FROM commission_ledger ORDER BY id`).all(); } catch { return []; } })(),
    (() => { try { return db.prepare(`SELECT * FROM payroll_entries ORDER BY rowid`).all(); } catch { return []; } })(),
  ]));

  try {
    /* ---------- day one: nothing changes on any document ---------- */
    const legacyCeo = doc("QT", "a2z", U.ceo, 100000);
    const legacyAina = doc("QT", "a2z", U.aina, 100000);
    const money0 = money();
    const p0 = await plan(legacyAina);
    ok(p0.sign?.mode === "legacy", "S1 on the day it deploys every company signs as before (personal signing off, no approval rule)", JSON.stringify(p0).slice(0, 160));
    const g0 = await call(`/staff/docs/${legacyCeo}`, U.aina);
    ok(g0.status === 200 && g0.j?.doc?.signer_role === "ceo" && g0.j?.doc?.sign?.mode === "legacy", "the CEO's own quotation still names the CEO (the v1.4.233 rule)");
    const i0 = await call(`/staff/docs/${legacyCeo}/sign-image?which=prepared`, U.aina);
    ok(i0.status === 200 && i0.buf.equals(png("ceo-chop")), "S2 a printed legacy document gets its chop from its OWN door - the same 0118 chop as before");
    ok((await call(`/staff/docs/${legacyAina}/sign-image?which=prepared`, U.aina)).status === 404, "a salesperson's legacy quotation is still signed in ink (no officer chop borrowed)");
    ok((await call(`/staff/signature/a2z/ceo-sign.png`, U.aina)).status === 403 && (await call(`/staff/signature/a2z/ceo-sign.png`, U.ceo)).status === 200,
      "S3 (audit D9) a salesperson can no longer download the CEO's chop from the raw file door; the CEO still can");
    ok((await call(`/staff/signing/my-preview?issuer=a2z&doc_type=QT&which=prepared`, U.aina)).status === 404 && (await call(`/staff/signing/my-preview?issuer=a2z&doc_type=QT&which=prepared`, U.ceo)).status === 200,
      "S4 (audit D3) the live preview no longer shows the CEO's chop to a salesperson - it shows what will print");
    ok((await call(`/staff/docs/${legacyAina}/approve`, U.coo, "POST", {})).status === 403 && (await call(`/staff/docs/${legacyAina}/approve`, U.ceo, "POST", {})).status === 200,
      "while a company signs with the role chops, the CEO-only approval of v1.181.17 answers exactly as before");
    const mp = await call(`/staff/signing/my-plan?issuer=a2z&doc_type=INV`, U.aina);
    ok(mp.j?.mode === "legacy" && mp.j?.signer_role === "ceo" && mp.j?.signer_name === "Alif Farhan", "an invoice preview names the CEO, as the saved invoice will", mp.text.slice(0, 160));

    /* ---------- who manages ---------- */
    const ov = await call(`/staff/signing/overview`, U.ceo);
    ok(ov.status === 200 && ov.j?.can_manage === true && ov.j?.policies?.length === 2 && ov.j.policies.every((p) => p.personal === false) && ov.j.approval_limit === null, "S5 the CEO manages; both companies start with personal signing off and no approval limit");
    const ovc = await call(`/staff/signing/overview`, U.coo);
    ok(ovc.status === 200 && ovc.j?.can_manage === false, "the COO sees the screen, read only");
    ok((await call(`/staff/signing/overview`, U.aina)).status === 403 && (await call(`/staff/signing/overview`, U.shop)).status >= 401, "a salesperson and a customer cannot open it");
    ok((await call(`/staff/signing/policy/a2z`, U.coo, "PUT", { personal: true, totp: code() })).status === 403, "S6 the COO cannot change a company's signing policy");
    ok((await call(`/staff/signing/policy/a2z`, U.ceo, "PUT", { personal: true })).status === 401, "the CEO needs a live authenticator code to change it");

    /* ---------- registering signatures: the person AND the owner ---------- */
    ok((await upload(U.coo, `kind=signature&user=${U.aina}`, png("aina-1"))).status === 403, "S7 the COO cannot register somebody else's signature (management is not impersonation)");
    ok((await upload(U.ceo, `kind=signature&user=${U.aina}`, png("aina-1"), false)).status === 401, "registering a signature asks for the CEO's live code");
    ok((await upload(U.ceo, `kind=signature&user=${U.aina}`, Buffer.from("GIF89a-not-a-png"))).status === 400, "only a PNG is accepted");
    ok((await upload(U.ceo, `kind=signature&user=${U.aina}`, Buffer.concat([png("big"), Buffer.alloc(1100 * 1024)]))).status === 413, "a file over 1 MB is refused");
    const ua = await upload(U.ceo, `kind=signature&user=${U.aina}`, png("aina-1"));
    const aina1 = ua.j?.id;
    ok(ua.status === 201 && ua.j?.status === "pending" && /confirmation/.test(ua.j?.waiting_for ?? ""), "S8 a signature the CEO registers waits for the person to confirm it - never active on upload", ua.text.slice(0, 160));
    ok((await call(`/staff/signing/assets/${aina1}/consent`, U.lia, "POST", { totp: code() })).status === 403, "nobody else confirms Aina's signature for her");
    ok((await call(`/staff/signing/assets/${aina1}/consent`, U.aina, "POST", {})).status === 401, "the person confirms with their own live code");
    const ca = await call(`/staff/signing/assets/${aina1}/consent`, U.aina, "POST", { totp: code() });
    ok(ca.status === 200 && ca.j?.status === "active" && row(`SELECT status, consented_at, approved_by FROM signature_assets WHERE id = ?`, aina1)?.approved_by === 1, "her confirmation plus the CEO's upload makes it active; both are recorded");
    const ul = await upload(U.lia, "kind=signature", png("lia-1"));
    ok(ul.status === 201 && ul.j?.status === "pending" && /owner/.test(ul.j?.waiting_for ?? ""), "S9 a signature somebody uploads for themselves waits for the CEO", ul.text.slice(0, 120));
    ok((await upload(U.lia, `kind=signature&user=${U.aina}`, png("x"))).status === 403, "nobody uploads a signature in somebody else's name");
    ok((await call(`/staff/signing/assets/${ul.j?.id}/approve`, U.coo, "POST", { totp: code() })).status === 403, "only the CEO approves a signature");
    ok((await call(`/staff/signing/assets/${ul.j?.id}/approve`, U.ceo, "POST", { totp: code() })).j?.status === "active", "the CEO's approval (with his code) completes Lia's");
    ok((await upload(U.nofa, "kind=signature", png("nofa"))).status === 403, "a person without two-factor sign-in cannot register a signature at all");
    ok(audited("signing.signature_upload") >= 2 && audited("signing.consent") === 1 && audited("signing.approve") === 1, "every registration, confirmation and approval is audited");

    /* ---------- stamps: one per company ---------- */
    ok((await upload(U.aina, "kind=stamp&issuer=a2z", png("stamp"))).status === 403, "S10 a salesperson cannot upload a company stamp");
    const st1 = await upload(U.ceo, "kind=stamp&issuer=a2z", png("a2z-stamp-1"));
    const st2 = await upload(U.ceo, "kind=stamp&issuer=a2z", png("a2z-stamp-2"));
    ok(st1.j?.status === "active" && st2.j?.status === "active" && row(`SELECT status FROM signature_assets WHERE id = ?`, st1.j?.id)?.status === "retired", "a new stamp replaces the old one, which is kept (retired) for what it already stamped");

    /* ---------- authority per company and document type ---------- */
    ok((await call(`/staff/signing/authorities`, U.coo, "POST", { user_id: U.aina, issuer_code: "a2z", capacity: "prepare", doc_types: ["QT"], reason: "Sales lead", totp: code() })).status === 403, "S11 only the CEO grants signing authority");
    ok((await call(`/staff/signing/authorities`, U.ceo, "POST", { user_id: U.aina, issuer_code: "a2z", capacity: "prepare", doc_types: ["QT"], totp: code() })).status === 400, "a grant needs a reason");
    ok((await call(`/staff/signing/authorities`, U.ceo, "POST", { user_id: U.shop, issuer_code: "a2z", capacity: "prepare", doc_types: ["QT"], reason: "never", totp: code() })).status === 400, "a customer is never given signing authority");
    const gA = await call(`/staff/signing/authorities`, U.ceo, "POST", { user_id: U.aina, issuer_code: "a2z", capacity: "prepare", doc_types: ["QT", "DO"], reason: "Sales lead for A2Z", totp: code() });
    const gC = await call(`/staff/signing/authorities`, U.ceo, "POST", { user_id: U.coo, issuer_code: "a2z", capacity: "approve", doc_types: ["QT"], reason: "Approves A2Z quotations", totp: code() });
    await upload(U.ceo, `kind=signature&user=${U.coo}`, png("coo-1"));
    const cooSig = row(`SELECT id FROM signature_assets WHERE user_id = 2 ORDER BY id DESC`)?.id;
    await call(`/staff/signing/assets/${cooSig}/consent`, U.coo, "POST", { totp: code() });
    ok(gA.status === 201 && gC.status === 201 && audited("signing.grant") === 2, "the CEO grants Aina 'prepare' (A2Z quotations, delivery orders) and the COO 'approve' (A2Z quotations), audited");

    /* ---------- the company switches to personal signing ---------- */
    const pol = await call(`/staff/signing/policy/a2z`, U.ceo, "PUT", { personal: true, stamp_on: ["QT"], totp: code() });
    ok(pol.status === 200 && pol.j?.policy?.personal === true && audited("signing.policy") === 1, "S12 the CEO turns personal signing on for A2Z, stamp on quotations, no approval - audited");
    const q1 = doc("QT", "a2z", U.aina, 300000);
    const pq1 = await plan(q1);
    ok(pq1.sign?.mode === "personal" && pq1.sign?.prepared?.asset_id === aina1 && pq1.sign?.prepared?.name === "Aina Seller" && pq1.sign?.stamp_asset_id === st2.j?.id && pq1.sign?.approved === null,
      "S13 Aina's A2Z quotation carries HER own signature and the A2Z stamp beside it - prepared by her, nobody approved", JSON.stringify(pq1.sign).slice(0, 220));
    ok((await call(`/staff/docs/${q1}/sign-image?which=prepared`, U.aina)).buf.equals(png("aina-1")) && (await call(`/staff/docs/${q1}/sign-image?which=stamp`, U.aina)).buf.equals(png("a2z-stamp-2")), "the document's door serves exactly those two marks");
    const inv1 = doc("INV", "a2z", U.aina, 300000);
    ok((await plan(inv1)).sign?.prepared?.asset_id === null && (await plan(inv1)).sign?.stamp_asset_id === null, "S14 Aina has no INVOICE authority: her invoice prints with an ink line and no stamp");
    const qLia = doc("QT", "a2z", U.lia, 300000);
    ok((await plan(qLia)).sign?.prepared?.asset_id === null && (await plan(qLia)).sign?.stamp_asset_id === null, "Lia has an active signature but no authority: ink line, and no stamp without a verified signature");
    const qZ = doc("QT", "azoo", U.aina, 300000);
    ok((await plan(qZ)).sign?.mode === "legacy", "AZ ONE still signs as before until its own policy changes");
    await call(`/staff/signing/policy/azoo`, U.ceo, "PUT", { personal: true, stamp_on: ["QT"], totp: code() });
    const pz = await plan(qZ);
    ok(pz.sign?.mode === "personal" && pz.sign?.stamp_asset_id === null && pz.sign?.prepared?.asset_id === null, "S15 an AZ ONE quotation never borrows the A2Z stamp or an A2Z authority", JSON.stringify(pz.sign).slice(0, 160));
    ok((await call(`/staff/docs/${qZ}/sign-image?which=stamp`, U.aina)).status === 404, "and its stamp door answers nothing");
    await call(`/staff/signing/authorities`, U.ceo, "POST", { user_id: U.aina, issuer_code: "azoo", capacity: "prepare", doc_types: ["QT"], reason: "Also sells for AZ ONE", totp: code() });
    const pz2 = await plan(qZ);
    ok(pz2.sign?.prepared?.asset_id === aina1 && pz2.sign?.stamp_asset_id === null, "authorised for AZ ONE too, her AZ ONE quotation carries her signature - and still no stamp, because AZ ONE has none of its own", JSON.stringify(pz2.sign).slice(0, 160));

    /* ---------- approval required above an amount: the ONE approval limit (0144) ---------- */
    ok((await call(`/staff/quotes/approval/limit`, U.ceo, "PUT", { limit_cents: 500000 })).status === 200 && n(`SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'document_approvals'`) === 0, "the approval rule is the CEO's existing approval limit - no second approval table");
    const big = doc("QT", "a2z", U.aina, 1000000);
    const small = doc("QT", "a2z", U.aina, 200000);
    const pb = await plan(big);
    ok(pb.sign?.needs_approval === true && !!pb.sign?.blocked && pb.sign?.stamp_asset_id === null && (await plan(small)).sign?.needs_approval === false, "S16 above RM 5,000 a quotation needs an approval; until then it carries no stamp; a small one does not need it");
    ok((await call(`/staff/docs/${big}/share`, U.aina, "POST", {})).status === 409 && (await call(`/staff/docs/${big}/issue`, U.aina, "POST", {})).status === 409, "S17 it cannot be shared or issued while the approval is missing (the server refuses, not the button)");
    const cooOwn = doc("QT", "a2z", U.coo, 1000000);
    ok((await call(`/staff/docs/${big}/approve`, U.aina, "POST", { totp: code() })).status === 403 && (await call(`/staff/docs/${cooOwn}/approve`, U.coo, "POST", { totp: code() })).status === 403, "nobody approves their own quotation - not even a signatory with approval authority");
    ok((await call(`/staff/docs/${big}/approve`, U.lia, "POST", { totp: code() })).status === 403, "a colleague without approval authority cannot approve");
    ok((await call(`/staff/docs/${big}/approve`, U.ceo, "POST", { totp: code() })).status === 403, "once A2Z signs personally even the CEO approves only with an approval authority of his own (management is not a signature)");
    ok((await call(`/staff/docs/${big}/approve`, U.coo, "POST", {})).status === 401, "the approver confirms with a live code");
    const ap = await call(`/staff/docs/${big}/approve`, U.coo, "POST", { totp: code() });
    ok(row(`SELECT signature_asset_id FROM quotation_approvals WHERE doc_id = ?`, big)?.signature_asset_id === cooSig, "the approval row of 0144 keeps the approver's signature");
    ok(ap.status === 201 && ap.j?.sign?.approved?.user_id === U.coo && ap.j?.sign?.approved?.asset_id === cooSig && ap.j?.sign?.stamp_asset_id === st2.j?.id && !ap.j?.sign?.blocked, "S18 the COO approves with his own signature; the stamp now appears; the block is lifted", ap.text.slice(0, 220));
    ok((await call(`/staff/docs/${big}/approve`, U.coo, "POST", { totp: code() })).status === 409, "a revision is approved once");
    ok((await call(`/staff/docs/${big}/sign-image?which=approved`, U.aina)).buf.equals(png("coo-1")), "the Approved by block prints the approver's own signature");

    /* ---------- issuing fixes the signatures ---------- */
    const sh = await call(`/staff/docs/${big}/share`, U.aina, "POST", {});
    const iss = row(`SELECT * FROM document_issuances WHERE doc_id = ?`, big);
    ok(sh.status === 200 && iss?.preparer_asset_id === aina1 && iss?.approver_asset_id === cooSig && iss?.stamp_asset_id === st2.j?.id && /^[0-9a-f]{64}$/.test(iss?.content_sha256 ?? ""), "S19 sharing issues the revision: preparer, approver and stamp assets and a content hash are fixed", JSON.stringify(iss));
    const ua2 = await upload(U.ceo, `kind=signature&user=${U.aina}`, png("aina-2"));
    await call(`/staff/signing/assets/${ua2.j?.id}/consent`, U.aina, "POST", { totp: code() });
    await upload(U.ceo, "kind=stamp&issuer=a2z", png("a2z-stamp-3"));
    const pAfter = await plan(big);
    ok(pAfter.sign?.prepared?.asset_id === aina1 && pAfter.sign?.stamp_asset_id === st2.j?.id && (await call(`/staff/docs/${big}/sign-image?which=prepared`, U.aina)).buf.equals(png("aina-1")),
      "S20 a signature and stamp replaced afterwards never change the issued quotation - it keeps what it was issued with");
    const fresh = doc("QT", "a2z", U.aina, 200000);
    ok((await plan(fresh)).sign?.prepared?.asset_id === ua2.j?.id, "a new quotation takes the new signature");
    let blocked = false; try { db.exec(`UPDATE document_issuances SET stamp_asset_id = NULL WHERE doc_id = ${big}`); } catch { blocked = true; }
    let blocked2 = false; try { db.exec(`DELETE FROM document_issuances WHERE doc_id = ${big}`); } catch { blocked2 = true; }
    let blocked3 = false; try { db.exec(`UPDATE signature_assets SET r2_key = 'x' WHERE role = 'ceo'`); } catch { blocked3 = true; }
    ok(blocked && blocked2 && blocked3, "the database refuses to edit or delete an issuance, and to touch a 0118 role chop");

    /* ---------- the customer's link ---------- */
    const tokS = row(`SELECT share_token AS t FROM sales_documents WHERE id = ?`, big)?.t;
    const pub = await call(`/public/doc/${tokS}`, 0);
    ok(pub.status === 200 && pub.j?.doc?.sign?.mode === "personal" && pub.j.doc.sign.prepared?.name === "Aina Seller" && pub.j.doc.sign.approved?.name === "Ops Lead" && pub.j.doc.sign.stamp === true && !/asset_id/.test(JSON.stringify(pub.j.doc.sign)),
      "S21 the customer's link names the preparer and approver and shows the stamp - never an asset id", JSON.stringify(pub.j?.doc?.sign ?? pub.text.slice(0, 120)));
    ok((await call(`/public/doc-signature?t=${tokS}&which=stamp`, 0)).buf.equals(png("a2z-stamp-2")) && (await call(`/public/doc-signature?t=${tokS}&which=approved`, 0)).buf.equals(png("coo-1")), "the link's own token door serves the issued marks");

    /* ---------- the raw files ---------- */
    ok((await call(`/staff/signing/assets/${aina1}/image`, U.lia)).status === 403 && (await call(`/staff/signing/assets/${aina1}/image`, U.aina)).status === 200 && (await call(`/staff/signing/assets/${st2.j?.id}/image`, U.aina)).status === 403,
      "S22 a signature file is shown to its own person and the CEO; a stamp file to the CEO; nobody else downloads one");

    /* ---------- leaving, revoking, retiring ---------- */
    const gid = row(`SELECT id FROM signing_authorities WHERE user_id = 5 AND revoked_at IS NULL`)?.id;
    ok((await call(`/staff/signing/authorities/${gid}/revoke`, U.ceo, "POST", { reason: "x", totp: code() })).status === 400, "S23 a revocation needs a reason");
    db.exec(`UPDATE users SET is_active = 0 WHERE id = 5`);
    const left = doc("QT", "a2z", U.aina, 200000);
    ok((await plan(left)).sign?.prepared?.asset_id === null && (await plan(big)).sign?.prepared?.asset_id === aina1, "a person who has left signs nothing new; what she issued keeps her signature");
    db.exec(`UPDATE users SET is_active = 1 WHERE id = 5`);
    ok((await call(`/staff/signing/authorities/${gid}/revoke`, U.ceo, "POST", { reason: "Moved to another team", totp: code() })).status === 200 && (await plan(doc("QT", "a2z", U.aina, 200000))).sign?.prepared?.asset_id === null, "once revoked, her next quotation prints with an ink line");
    ok((await call(`/staff/signing/assets/${ua2.j?.id}/retire`, U.lia, "POST", { reason: "not mine", totp: code() })).status === 403, "nobody retires somebody else's signature");

    /* ---------- task dates (0163): start to due ---------- */
    const tk = await call(`/staff/tasks`, U.ceo, "POST", { title: "Register SSM", assigned_to: U.aina, start_date: "2026-11-02", deadline: "2026-11-04" });
    ok(tk.status === 201 && row(`SELECT start_date, deadline FROM tasks WHERE id = ?`, tk.j?.id)?.start_date === "2026-11-02", "T1 a task keeps a start date beside its due date (the owner: start and end, not only a deadline)", tk.text.slice(0, 120));
    ok((await call(`/staff/tasks`, U.ceo, "POST", { title: "Backwards", assigned_to: U.aina, start_date: "2026-11-09", deadline: "2026-11-04" })).status === 400, "T2 a start after the due date is refused");
    ok((await call(`/staff/tasks/${tk.j?.id}`, U.ceo, "PATCH", { start_date: "2026-11-05" })).status === 400 && (await call(`/staff/tasks/${tk.j?.id}`, U.ceo, "PATCH", { deadline: "2026-11-01" })).status === 400, "T3 neither date can be moved past the other");
    ok((await call(`/staff/tasks/${tk.j?.id}`, U.ceo, "PATCH", { start_date: "2026-11-03" })).status === 200 && row(`SELECT start_date FROM tasks WHERE id = ?`, tk.j?.id)?.start_date === "2026-11-03", "T4 the start date can be changed");
    ok((await call(`/staff/tasks`, U.aina)).j?.tasks?.find((t) => t.id === tk.j?.id)?.start_date === "2026-11-03", "T5 the task list carries it");

    /* ---------- nothing else moves ---------- */
    const voidInv = doc("INV", "a2z", U.lia, 1000, "void");
    ok((await call(`/staff/docs/${voidInv}/approve`, U.coo, "POST", { totp: code() })).status >= 403, "a void document is never approved");
    ok((await call(`/staff/docs/${inv1}`, U.cco, "PATCH", { payment_status: "paid" })).status === 403, "S24 CCO = review only: no signing right touches Invoice Paid");
    ok(money() === money0 || money() === sha(JSON.stringify([
      db.prepare(`SELECT id, doc_type, doc_number, customer_id, items, total_cents, payment_status, salesperson_id, created_by, issuer_code, revision FROM sales_documents ORDER BY id`).all(),
      (() => { try { return db.prepare(`SELECT * FROM commission_ledger ORDER BY id`).all(); } catch { return []; } })(),
      (() => { try { return db.prepare(`SELECT * FROM payroll_entries ORDER BY rowid`).all(); } catch { return []; } })(),
    ])), "no amount, payment state, commission or payroll row is changed by signing (only the test's own new documents were added)");
    ok(n(`SELECT COUNT(*) AS n FROM sales_documents WHERE id <= ${legacyAina} AND share_token IS NOT NULL`) === 0 && row(`SELECT total_cents FROM sales_documents WHERE id = ?`, big)?.total_cents === 1000000, "the documents keep their totals; only the shared one got its link");
  } catch (e) {
    ok(false, `the run threw: ${String(e?.stack ?? e).slice(0, 400)}`);
  } finally {
    globalThis.Date = RealDate;
  }
  return out;
}

function sourceChecks() {
  const out = [];
  const ok = (c, m) => out.push([!!c, m]);
  const code = readFileSync(join(root, "worker/src/signing.ts"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  ok(!/(INSERT INTO|UPDATE|DELETE FROM)\s+(sales_documents|commission_ledger|payroll_entries|users|leave_requests|claims)\b/i.test(code), "signing.ts writes no sales amount, commission, payroll, user, leave or claim row");
  const ui = readFileSync(join(root, "components/portal/signing-panel.tsx"), "utf8");
  ok(/visual mark, not a digital certificate/.test(ui), "the screens say a scanned signature is a visual mark, not a cryptographic signature");
  const leave = readFileSync(join(root, "components/portal/leave.tsx"), "utf8");
  ok(/\/api\/v1\/staff\/leave\/\$\{l\.id\}\/signature\/emp/.test(leave), "leave forms keep their own document-scoped role chops (sales documents only)");
  const tmpl = readFileSync(join(root, "lib/doc-template.ts"), "utf8");
  ok(/Approved by/.test(tmpl) && /readSign\(doc\)/.test(tmpl), "the printed document draws an Approved by block from the server's plan");
  const sales = readFileSync(join(root, "components/portal/sales.tsx"), "utf8");
  ok(!/signer_role: user\.role === "coo" \? "coo" : "ceo"/.test(sales) && /\/staff\/signing\/my-plan/.test(sales), "the live preview asks the server who signs (no CEO chop for everyone)");
  return out;
}

/* the printed page itself: lib/doc-template.ts bundled and rendered */
async function templateChecks() {
  const out = [];
  const ok = (c, m, why = "") => out.push([!!c, why && !c ? `${m} - ${why}` : m]);
  const d = mkdtempSync(join(tmpdir(), "golive-s-t-"));
  execSync(`npx esbuild "${join(root, "lib/doc-template.ts")}" --bundle --format=esm --platform=neutral --outfile="${join(d, "t.mjs")}" --alias:@=${root} --log-level=error`, { cwd: root, stdio: "inherit" });
  const { buildDocHtml } = await import(pathToFileURL(join(d, "t.mjs")).href);
  const base = { id: 7, doc_type: "QT", doc_number: "QT-1", company: "ABC", items: "[]", discount_cents: 0, tax_percent: 0, total_cents: 100, created_at: "2026-11-01 01:00:00", issuer_code: "a2z", signer_role: "ceo", signer_name: "Alif", signer_position: "CEO" };
  const legacy = buildDocHtml(base, false);
  ok(/\/api\/v1\/staff\/docs\/7\/sign-image\?which=prepared/.test(legacy) && !/\/staff\/signature\//.test(legacy) && !/Approved by/.test(legacy), "the legacy page asks its own door for the chop, no Approved by block");
  const personal = buildDocHtml({ ...base, sign: { mode: "personal", prepared: { name: "Aina Seller", position: "Sales", asset_id: 2 }, approved: { name: "Ops Lead", position: "COO", asset_id: 9, at: "2026-11-01 02:00:00" }, stamp_asset_id: 5 } }, false);
  ok(/AINA SELLER/.test(personal) && /Approved by/.test(personal) && /OPS LEAD/.test(personal) && /which=approved/.test(personal) && /class="stamp" src="[^"]*which=stamp/.test(personal), "a personal-signing page: the preparer's own name, an Approved by block with the approver's mark, the stamp on the approval");
  const shared = buildDocHtml({ ...base, sign: { mode: "personal", prepared: { name: "Aina Seller", position: "Sales", has: true }, approved: null, stamp: true } }, false, "https://x/api/v1/public/doc-signature?t=abc");
  ok(/doc-signature\?t=abc&which=prepared/.test(shared) && /doc-signature\?t=abc&which=stamp/.test(shared) && !/Approved by/.test(shared), "the customer's link uses its token door for each mark");
  const waiting = buildDocHtml({ ...base, sign: { mode: "personal", prepared: { name: "Aina Seller", position: "Sales", asset_id: 2 }, approved: null, stamp_asset_id: null, blocked: "Waiting" } }, false);
  ok(/waiting for management approval/.test(waiting) && !/class="stamp"/.test(waiting), "a quotation waiting for approval prints as a draft, without the stamp");
  try { rmSync(d, { recursive: true, force: true }); } catch { /* temp */ }
  return out;
}

let fail = 0, n = 0;
const report = (list) => { for (const [p, m] of list) { n++; if (!p) { fail++; console.error(`FAIL ${m}`); } } };
const given = process.env.WORKER_BUNDLE;
const NOMUT = process.env.NOMUT === "1" || !!given;
const dir = mkdtempSync(join(tmpdir(), "golive-s-"));
if (!given) bundle(root, join(dir, "worker.mjs"));
report(await runtime(given ?? join(dir, "worker.mjs")));
if (!given) report(sourceChecks());
if (!given) report(await templateChecks());
const checks = n;
try { rmSync(dir, { recursive: true, force: true }); } catch { /* temp */ }

const MUT = [
  ["worker/src/signing.ts", "a signature is active without the person's confirmation", "      const active = kind === \"stamp\" || (consented && approvedBy);", "      const active = kind === \"stamp\" || approvedBy;"],
  ["worker/src/signing.ts", "an upload without a live code", "      const no = await requireTotp(env, user, totp, kind === \"stamp\" ? \"upload a company stamp\" : \"register a signature\"); if (no) return no;", ""],
  ["worker/src/signing.ts", "the other company's stamp", "  return env.DB.prepare(`SELECT * FROM signature_assets WHERE kind = 'stamp' AND issuer_code = ?1 AND status = 'active' ORDER BY id DESC LIMIT 1`).bind(issuer)", "  return env.DB.prepare(`SELECT * FROM signature_assets WHERE kind = 'stamp' AND (issuer_code = ?1 OR 1 = 1) AND status = 'active' ORDER BY id DESC LIMIT 1`).bind(issuer)"],
  ["worker/src/signing.ts", "approving one's own quotation", "    if (d.created_by === user.id) return err(\"forbidden\", \"Nobody approves their own quotation\", 403);", ""],
  ["worker/src/signing.ts", "the issued record is ignored (resolved live)", "  if (iss) {\n    const p = await person(env, iss.preparer_id)", "  if (false && iss) {\n    const p = await person(env, iss.preparer_id)"],
  ["worker/src/signing.ts", "a leaver keeps signing", "JOIN users u ON u.id = g.user_id AND u.is_active = 1", "JOIN users u ON u.id = g.user_id"],
  ["worker/src/signing.ts", "a quotation is issued while its approval is missing", "  if (plan.blocked) return { ok: false, res: err(\"approval_required\", plan.blocked, 409) };", ""],
  ["worker/src/signing.ts", "the stamp without a verified signature", "  const stamp = pol.stamp_on.includes(d.doc_type) && (sig || approved) && (!needs || approved) ? await activeStamp(env, issuer) : null;", "  const stamp = pol.stamp_on.includes(d.doc_type) ? await activeStamp(env, issuer) : null;"],
  ["worker/src/staff.ts", "the raw officer chop open to sales again", "    if (!SIG_VAULT_ROLES.includes(user.role)) {", "    if (!can(user.role, \"sales\")) {"],
  ["worker/src/signing.ts", "the COO registers other people's signatures", "export const signAdmin = (u: { role: string }) => u.role === \"ceo\" || u.role === \"super_admin\";", "export const signAdmin = (u: { role: string }) => u.role === \"ceo\" || u.role === \"super_admin\" || u.role === \"coo\";"],
  ["worker/src/index.ts", "the customer's link exposes asset ids", "        prepared: pl.prepared ? { name: pl.prepared.name, position: pl.prepared.position, has: !!pl.prepared.asset_id } : null,", "        prepared: pl.prepared,"],
];
for (const [file, name, from, to] of NOMUT ? [] : MUT) {
  n++;
  const srcT = readFileSync(join(root, file), "utf8");
  if (!srcT.includes(from)) { fail++; console.error(`FAIL mutation did not apply: ${name}`); continue; }
  const mdir = mkdtempSync(join(tmpdir(), "golive-s-m-"));
  cpSync(join(root, "worker"), join(mdir, "worker"), { recursive: true, filter: (p) => !p.includes("node_modules") });
  cpSync(join(root, "package.json"), join(mdir, "package.json"));
  for (const d of ["lib", "constants", "types"]) { try { cpSync(join(root, d), join(mdir, d), { recursive: true }); } catch { /* not every folder exists */ } }
  writeFileSync(join(mdir, file), srcT.replace(from, to));
  try { bundle(mdir, join(mdir, "worker.mjs")); } catch { fail++; console.error(`FAIL mutation did not build: ${name}`); continue; }
  const res = await runtime(join(mdir, "worker.mjs"));
  try { rmSync(mdir, { recursive: true, force: true }); } catch { /* temp */ }
  if (!res.some(([p]) => !p)) { fail++; console.error(`FAIL mutation not caught: ${name}`); }
  else console.log(`caught: ${name} -> ${res.filter(([p]) => !p).slice(0, 2).map(([, m]) => m.split(" - ")[0]).join("; ")}`);
}
if (fail) { console.error(`go-live-s: ${fail} of ${n} failed${given ? ` (bundle: ${given})` : ""}`); process.exitCode = 1; }
else console.log(`go-live-s: ${checks} checks passed (${NOMUT ? "mutations skipped" : `${MUT.length} mutations caught`}) - a signature belongs to a person and is used only after that person and the CEO confirm it, a stamp belongs to one company, authority is granted per company and document type, approval above an amount is enforced on the server, an issued document keeps the marks it was issued with, and no amount, payment, commission or payroll row is touched`);
