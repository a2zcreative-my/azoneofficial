/* v1.302.0 - FINANCIAL ADVISORY 2.0, PHASE 5: THE AGREEMENT TEMPLATE
   LIBRARY, THE AUTO-FILLED DRAFT AND THE FEE AFTER A RECORDED DISBURSEMENT
   (the CEO, 13-11-2026: "Phase 5 now"; claude/FINANCIAL-ADVISORY-2.0-
   BLUEPRINT.md sections 10-11, D-5 A, D-6, D-7; migration 0192). By DIRECT
   request against the whole worker on SQLite with every migration applied.
   Invented people, banks and a Word file built here. Each rule is MUTATED.

   What must hold:
     - only management drafts (CEO, COO, CCO); only the CEO publishes, never
       a version they drafted (the verified owner apart); publishing without
       a legal review is the verified owner's alone and recorded so;
     - a DOCX is read in the Worker (a field split across Word runs is whole
       again); its hash is kept; past draft the text, fields and fee never
       change; nothing is deleted; every change is a new version;
     - a template using an unknown field, a broken one, no client name, a fee
       without a rate, or a CTOS / blacklisting / penalty clause cannot go for
       review;
     - the fields fill from the records only: the IC masked; a full IC typed
       for one document is checked against the profile and stored NOWHERE;
       a missing field is listed and blocks the draft; the PDF text hash is
       of the masked text; sending and signing still answer legal_gate;
     - the fee: only after a disbursement recorded with the bank's evidence
       and an amount, at the published version's rate (half-up), as a Sales
       quotation prefill - no invoice, payment, cash or commission row - and
       only when the fee line earns nothing under every commission policy in
       force; once per disbursement; append only.

     node tests/fa-agreements.mjs        (NOMUT=1 skips the mutations) */
import { readFileSync, readdirSync, mkdtempSync, writeFileSync, cpSync, rmSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { deflateRawSync, crc32 } from "node:zlib";
import { DatabaseSync } from "node:sqlite";

const root = fileURLToPath(new URL("..", import.meta.url));
const bundle = (srcRoot, entry, out) => execSync(`npx esbuild "${join(srcRoot, entry)}" --bundle --format=esm --platform=neutral --outfile="${out}" --log-level=error`, { cwd: root, stdio: "inherit" });
const sha = (s) => createHash("sha256").update(s).digest("hex");
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 1, 2, 3, 4, 5, 6, 7, 8]);
globalThis.FixedLengthStream ??= class { constructor() { const t = new TransformStream(); this.readable = t.readable; this.writable = t.writable; } };

/* a real (minimal) Word file: a zip with word/document.xml, deflated */
function zip(files) {
  const locals = [], centrals = []; let off = 0;
  for (const [name, text] of files) {
    const data = Buffer.from(text, "utf8"), comp = deflateRawSync(data), nm = Buffer.from(name);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(crc32(data), 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nm.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(8, 10); ch.writeUInt32LE(crc32(data), 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(nm.length, 28); ch.writeUInt32LE(off, 42);
    locals.push(lh, nm, comp); centrals.push(ch, nm); off += 30 + nm.length + comp.length;
  }
  const cd = Buffer.concat(centrals), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...locals, cd, end]);
}
const P = (inner, style) => `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ""}${inner}</w:p>`;
const R = (t, b) => `<w:r>${b ? "<w:rPr><w:b/></w:rPr>" : ""}<w:t xml:space="preserve">${t}</w:t></w:r>`;
const DOCX = zip([
  ["[Content_Types].xml", `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>`],
  ["word/document.xml", `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="w"><w:body>${[
    P(R("ADVISORY SERVICE AGREEMENT"), "Heading1"),
    P(R("This agreement is between ") + R("{{company_", true) + R("name}}") + R(" (") + R("{{company_registration}}") + R(") and ") + R("{{client") + R("_name}}") + R(", IC {{ic_number}}, on {{agreement_date}}.")),
    P(R("Case {{case_ref}}. The service fee is {{fee_rate}} of the amount the bank disburses. Terms &amp; conditions apply.")),
    P(R("Contact: {{client_email}}")),
  ].join("")}</w:body></w:document>`],
]);

async function runtime(workerBundle, commissionBundle) {
  const out = [];
  const ok = (c, m, why = "") => out.push([!!c, why && !c ? `${m} - ${why}` : m]);
  const db = new DatabaseSync(":memory:");
  for (const f of readdirSync(join(root, "worker/migrations")).filter((x) => x.endsWith(".sql")).sort()) {
    for (const st of readFileSync(join(root, "worker/migrations", f), "utf8").split(/;\s*\n/)) { try { db.exec(st); } catch { /* a statement SQLite reads differently */ } }
  }
  /* the triggers hold ";" inside BEGIN ... END - apply 0192's whole */
  try { db.exec(readFileSync(join(root, "worker/migrations/0192_fa_templates.sql"), "utf8")); } catch { /* already there */ }
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
  /* invented people: 1 CEO (the verified owner), 30 a second CEO account (not the owner), 3 COO, 6 CCO, 7 HR, 9 and 15 sales, 21 an agent, 22 admin */
  db.exec(`INSERT INTO users (id, name, full_name, email, role, is_active, password_hash, totp_enabled, totp_secret) VALUES
    (1,'Owner','Owner Person','owner@a2z.test','ceo',1,'x',1,'JBSWY3DPEHPK3PXP'), (2,'Root','Root Person','root@a2z.test','super_admin',1,'x',1,'JBSWY3DPEHPK3PXP'),
    (3,'Coo','Coo Person','coo@a2z.test','coo',1,'x',1,'JBSWY3DPEHPK3PXP'), (6,'Cco','Cco Person','cco@a2z.test','cco',1,'x',1,'JBSWY3DPEHPK3PXP'),
    (7,'Hr','Hr Person','hr@a2z.test','hr_admin',1,'x',1,'JBSWY3DPEHPK3PXP'), (9,'Aina','Aina Seller','aina@a2z.test','sales_marketing',1,'x',1,'JBSWY3DPEHPK3PXP'),
    (15,'Lia','Lia Seller','lia@a2z.test','sales_marketing',1,'x',1,'JBSWY3DPEHPK3PXP'), (21,'Ros','Ros Agent','ros@a2z.test','agent',1,'x',1,'JBSWY3DPEHPK3PXP'),
    (22,'Adm','Adm Person','adm@a2z.test','admin',1,'x',1,'JBSWY3DPEHPK3PXP'), (30,'Second','Second Ceo','ceo2@a2z.test','ceo',1,'x',1,'JBSWY3DPEHPK3PXP')`);
  db.exec(`INSERT INTO customers (id, company, phone) VALUES (1, 'Existing Client One', '019-888 7777')`);
  db.exec(`INSERT INTO system_meta (key, value) VALUES ('company_owner', '{"user_id":1,"set_by":2,"set_by_name":"Root","set_at":"2026-11-02 06:00:54","reason":"test"}')`);
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("{}", { status: 200 });
  const worker = (await import(pathToFileURL(workerBundle).href + `?v=${Math.random()}`)).default;
  const comm = await import(pathToFileURL(commissionBundle).href + `?v=${Math.random()}`);
  const tok = {};
  for (const id of [1, 2, 3, 6, 7, 9, 15, 21, 22, 30]) {
    tok[id] = `t-${id}-${Math.random()}`;
    db.prepare(`INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, datetime('now', '+12 hours'), datetime('now'))`).run(sha(tok[id]), id);
  }
  const hdr = (uid, ct = "application/json") => ({ "content-type": ct, origin: "https://portal.a2z.test", cookie: `azone_session=${tok[uid]}; csrf_token=c1`, "x-csrf-token": "c1" });
  const call = async (path, uid, method = "GET", body) => {
    const r = await worker.fetch(new Request(`https://api.a2z.test/api/v1/staff${path}`, { method, headers: hdr(uid), body: body ? JSON.stringify(body) : undefined }), env, { waitUntil() {} });
    const buf = Buffer.from(await r.arrayBuffer()); const text = buf.toString("utf8"); let j = null; try { j = JSON.parse(text); } catch { /* a file */ }
    return { status: r.status, j, text, buf };
  };
  const upload = async (caseId, uid, kind) => {
    const r = await worker.fetch(new Request(`https://api.a2z.test/api/v1/staff/fa/cases/${caseId}/documents?kind=${kind}&date=2026-11-10`, { method: "POST", headers: { ...hdr(uid, "image/png"), "content-length": String(PNG.length) }, body: PNG }), env, { waitUntil() {} });
    const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { /* */ }
    return { status: r.status, j, text: t };
  };
  const n = (sql, ...a) => Number(db.prepare(sql).get(...a)?.n ?? 0);
  const finance = () => ["cashflow_entries", "sales_documents", "invoice_payments", "commission_ledger", "journal_entries"].map((t) => { try { return n(`SELECT COUNT(*) AS n FROM ${t}`); } catch { return -1; } }).join(",");
  const before = finance();
  const throws = (sql) => { try { db.exec(sql); return false; } catch { return true; } };
  const plain = (blocks) => blocks.map((b) => `${b.kind === "h" ? "# " : ""}${b.parts.map((p) => p.t).join("")}`).join("\n\n");
  const later = (d) => new Date(Date.now() + 8 * 3600e3 + d * 864e5).toISOString().slice(0, 10);
  const FEE_LINE = "Financial advisory service fee";

  try {
    /* ---- the cases ---- */
    const bank = (await call("/fa/banks", 1, "POST", { name: "Bank A", kind: "commercial" })).j;
    const c1 = (await call("/fa/cases", 9, "POST", { product: "personal_financing", issuer_code: "a2z", new_customer: { name: "Encik Contoh", phone: "012-345 6789" } })).j;
    const c2 = (await call("/fa/cases", 15, "POST", { product: "debt_consolidation", issuer_code: "azoo", customer_id: 1 })).j;
    for (const [cid, uid] of [[c1.id, 9], [c2.id, 15]]) for (const kind of ["privacy_notice", "assessment"]) await call(`/fa/cases/${cid}/consents`, uid, "POST", { kind, notice_version: "v1-draft", captured_how: "signed_form", given_at: "2026-11-09" });
    await call(`/fa/cases/${c1.id}/profile`, 9, "PUT", { ic: "880101-14-5678", employment_status: "employed", employment_category: "permanent", service_months: 30 });

    /* ---- who reaches the library ---- */
    for (const [uid, who] of [[7, "HR"], [21, "an agent"], [22, "an admin"]]) {
      ok((await call("/fa/templates", uid)).status === 403 && (await call("/fa/fees", uid)).status === 403 && (await call(`/fa/cases/${c1.id}/agreement/preview`, uid, "POST", { version_id: 1 })).status === 403, `${who} reaches no template, fee or draft (direct request)`);
    }
    ok((await call("/fa/templates", 9, "POST", { name: "Sales template", issuer_code: "a2z", service_type: "personal_financing" })).status === 403, "Sales cannot add a template");
    ok((await call("/fa/templates", 6, "POST", { name: "Bad", issuer_code: "xyz", service_type: "personal_financing" })).status === 400, "the issuing company is required");
    const t1 = await call("/fa/templates", 6, "POST", { name: "Personal financing advisory", issuer_code: "a2z", service_type: "personal_financing" });
    ok(t1.status === 201, "the CCO adds a template (drafting is management's)", t1.text);
    const t2 = (await call("/fa/templates", 3, "POST", { name: "Debt consolidation advisory", issuer_code: "azoo", service_type: "debt_consolidation" })).j;

    /* ---- the Word file ---- */
    ok((await call(`/fa/templates/${t1.j.id}/versions`, 6, "POST", { docx_base64: Buffer.from("%PDF-1.4 not a word file").toString("base64"), file_name: "x.pdf" })).status === 400, "a file that is not a Word document is refused");
    ok((await call(`/fa/templates/${t1.j.id}/versions`, 9, "POST", { body: "x".repeat(60) })).status === 403, "Sales cannot add a version");
    const up = await call(`/fa/templates/${t1.j.id}/versions`, 6, "POST", { docx_base64: DOCX.toString("base64"), file_name: "Advisory agreement.docx" });
    const v1 = db.prepare(`SELECT * FROM fa_template_versions WHERE id = ?`).get(up.j?.id ?? -1);
    ok(up.status === 201 && v1?.format === "docx" && v1.version === 1 && v1.state === "draft", "the Word file becomes version 1, a draft", up.text);
    ok(/^# ADVISORY SERVICE AGREEMENT/.test(v1?.body ?? "") && v1.body.includes("{{company_name}}") && v1.body.includes("{{client_name}}") && v1.body.includes("Terms & conditions"), "the text is read out of the zip: the heading kept, a field split across Word runs whole again, entities decoded", v1?.body);
    ok(v1?.source_sha256 === sha(DOCX) && store.get(v1.source_r2_key)?.buf.equals(DOCX), "the uploaded file is kept, with its SHA-256");
    ok(up.j?.check?.fee_needed === true && up.j.check.ok === false, "the text uses the fee and no rate is set: not ready", JSON.stringify(up.j?.check));
    ok((await call(`/fa/templates/versions/${v1.id}/submit`, 6, "POST", {})).j?.error?.code === "template_check", "it cannot go for review without the fee rate");
    ok((await call(`/fa/templates/versions/${v1.id}`, 9, "PUT", { fee_bp: 1500 })).status === 403, "Sales cannot edit a draft");
    ok((await call(`/fa/templates/versions/${v1.id}`, 6, "PUT", { fee_bp: 0 })).status === 400 && (await call(`/fa/templates/versions/${v1.id}`, 6, "PUT", { fee_bp: 15.5 })).status === 400, "the fee rate is whole basis points, above zero");
    const ed = await call(`/fa/templates/versions/${v1.id}`, 6, "PUT", { fee_bp: 1500 });
    ok(ed.status === 200 && ed.j?.check?.ok === true, "with the rate set (by the drafter, on the version) the template passes its check", ed.text);
    ok((await call(`/fa/templates/versions/${v1.id}/source`, 9)).status === 403 && (await call(`/fa/templates/versions/${v1.id}/source`, 6)).buf.equals(DOCX), "management (not Sales) downloads the source file, byte for byte");

    /* ---- the check on submit ---- */
    const bad = async (body, why) => {
      const v = (await call(`/fa/templates/${t1.j.id}/versions`, 6, "POST", { body, fee_bp: 1500 })).j;
      const r = await call(`/fa/templates/versions/${v.id}/submit`, 6, "POST", {});
      ok(r.status === 422 && r.j?.error?.code === "template_check", why, r.text);
      await call(`/fa/templates/versions/${v.id}/archive`, 6, "POST", { reason: "Test entry, not used" });
      return r.j?.error?.check;
    };
    const base = "This agreement is between the company and {{client_name}} for the advisory service on this case.";
    ok((await bad(`${base} Salary {{salary}}.`, "an unknown field stops it"))?.unknown?.includes("salary"), "...and names the field");
    await bad(`${base} Broken {{case_ref}.`, "a broken field stops it");
    await bad("This agreement is between the company and the client for the advisory service on this case.", "a text that never names the client stops it");
    ok((await bad(`${base} Late payment will be reported to CTOS.`, "a CTOS reporting clause stops it"))?.prohibited?.length === 1, "...and is named");
    await bad(`${base} The client will be blacklisted.`, "a blacklisting clause stops it");
    await bad(`${base} A penalty of RM 100 applies.`, "a penalty clause stops it");

    /* ---- review, publishing ---- */
    const n0 = n(`SELECT COALESCE(MAX(id), 0) AS n FROM notifications`);
    const sb = await call(`/fa/templates/versions/${v1.id}/submit`, 6, "POST", {});
    ok(sb.status === 200 && db.prepare(`SELECT state FROM fa_template_versions WHERE id = ?`).get(v1.id).state === "review", "the CCO submits it for review", sb.text);
    const notes = db.prepare(`SELECT * FROM notifications WHERE id > ?`).all(n0);
    ok(notes.length >= 1 && notes.every((x) => [1, 30].includes(x.user_id)) && !/Cco|15|1500|Encik/.test(JSON.stringify(notes.map((x) => x.message))), "the CEO accounts are told - no name, no figure", JSON.stringify(notes));
    ok((await call(`/fa/templates/versions/${v1.id}`, 6, "PUT", { fee_bp: 2000 })).status === 409, "past draft the version cannot be edited");
    ok(throws(`UPDATE fa_template_versions SET fee_bp = 2000 WHERE id = ${v1.id}`) && throws(`UPDATE fa_template_versions SET body = 'x' WHERE id = ${v1.id}`) && throws(`DELETE FROM fa_template_versions WHERE id = ${v1.id}`), "the database itself refuses a change to its text or fee, or a deletion");
    ok((await call(`/fa/templates/versions/${v1.id}/publish`, 3, "POST", { legal_basis: "ceo_without_review", acknowledge: true })).status === 403 && (await call(`/fa/templates/versions/${v1.id}/publish`, 6, "POST", { legal_basis: "ceo_without_review", acknowledge: true })).status === 403, "the COO and CCO cannot publish (direct request)");
    ok((await call(`/fa/templates/versions/${v1.id}/publish`, 30, "POST", { legal_basis: "ceo_without_review", acknowledge: true })).status === 403, "a CEO account that is not the verified owner cannot publish without a legal review");
    ok((await call(`/fa/templates/versions/${v1.id}/publish`, 1, "POST", { legal_basis: "counsel_reviewed", legal_firm: "Firm", legal_reference: "Ref 1", legal_reviewed_on: "2026-11-10" })).status === 400, "a legal review needs the lawyer's name");
    ok((await call(`/fa/templates/versions/${v1.id}/publish`, 1, "POST", { legal_basis: "counsel_reviewed", legal_reviewer: "Lawyer", legal_firm: "Firm", legal_reference: "Ref 1", legal_reviewed_on: later(2) })).status === 400, "...and a day of the review that has happened");
    ok((await call(`/fa/templates/versions/${v1.id}/publish`, 1, "POST", { legal_basis: "ceo_without_review" })).status === 400, "without a legal review, the owner must say so");
    ok((await call(`/fa/templates/versions/${v1.id}/publish`, 1, "POST", { legal_basis: "approved" })).status === 400, "there is no other basis");
    const pb = await call(`/fa/templates/versions/${v1.id}/publish`, 1, "POST", { legal_basis: "ceo_without_review", acknowledge: true });
    const pv1 = db.prepare(`SELECT * FROM fa_template_versions WHERE id = ?`).get(v1.id);
    ok(pb.status === 200 && pv1.state === "approved" && pv1.legal_basis === "ceo_without_review" && pv1.published_by === 1 && n(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'fa.template_published'`) === 1, "the owner publishes it without a legal review - recorded so, audited", pb.text);
    /* a second CEO account: never its own draft; with counsel's review it may publish someone else's */
    const own = (await call(`/fa/templates/${t2.id}/versions`, 30, "POST", { body: `${base} Fee {{fee_rate}}.`, fee_bp: 1200 })).j;
    await call(`/fa/templates/versions/${own.id}/submit`, 30, "POST", {});
    ok((await call(`/fa/templates/versions/${own.id}/publish`, 30, "POST", { legal_basis: "counsel_reviewed", legal_reviewer: "Lawyer", legal_firm: "Firm", legal_reference: "Ref 2", legal_reviewed_on: "2026-11-10" })).j?.error?.code === "self_approval", "nobody publishes a version they drafted (the owner apart)");
    const az = (await call(`/fa/templates/${t2.id}/versions`, 3, "POST", { body: `${base} Fee {{fee_rate}}.`, fee_bp: 1200 })).j;
    await call(`/fa/templates/versions/${az.id}/submit`, 3, "POST", {});
    ok((await call(`/fa/templates/versions/${az.id}/publish`, 30, "POST", { legal_basis: "counsel_reviewed", legal_reviewer: "Lawyer", legal_firm: "Firm", legal_reference: "Ref 2", legal_reviewed_on: "2026-11-10" })).status === 200
      && db.prepare(`SELECT legal_basis, legal_reviewer FROM fa_template_versions WHERE id = ?`).get(az.id).legal_reviewer === "Lawyer", "with counsel's review recorded, a CEO publishes the COO's version");
    /* every change is a new version; publishing supersedes */
    const cp = await call(`/fa/templates/${t1.j.id}/versions`, 6, "POST", { from_version_id: v1.id });
    const v2 = db.prepare(`SELECT * FROM fa_template_versions WHERE id = ?`).get(cp.j?.id ?? -1);
    ok(cp.status === 201 && v2?.version > v1.version && v2.state === "draft" && v2.body === v1.body && v2.fee_bp === 1500 && v2.source_sha256 === v1.source_sha256, "a new version copies the text, fee and source - as a draft", JSON.stringify(v2));
    await call(`/fa/templates/versions/${v2.id}/submit`, 6, "POST", {});
    await call(`/fa/templates/versions/${v2.id}/publish`, 1, "POST", { legal_basis: "counsel_reviewed", legal_reviewer: "Lawyer", legal_firm: "Firm", legal_reference: "Ref 3", legal_reviewed_on: "2026-11-12" });
    ok(db.prepare(`SELECT state, archived_reason FROM fa_template_versions WHERE id = ?`).get(v1.id).state === "archived" && db.prepare(`SELECT state FROM fa_template_versions WHERE id = ?`).get(v2.id).state === "approved", "publishing a new version archives the one it supersedes - kept, never deleted");
    const salesLib = (await call("/fa/templates", 9)).j;
    ok(salesLib?.versions?.length > 0 && salesLib.versions.every((v) => v.state === "approved") && salesLib.can.draft === false && salesLib.can.publish === false, "Sales see only published versions, and are told they draft nothing", JSON.stringify(salesLib?.versions?.map((v) => v.state)));
    ok((await call("/fa/templates", 6)).j?.versions?.some((v) => v.state === "archived"), "management sees the whole history");

    /* ---- the auto-filled draft ---- */
    const prev = (uid, body) => call(`/fa/cases/${c1.id}/agreement/preview`, uid, "POST", { version_id: v2.id, ...body });
    const p1 = await prev(9, {});
    const f = (r, k) => r.j?.fields?.find((x) => x.key === k);
    ok(p1.status === 200 && f(p1, "client_name")?.value === "Encik Contoh" && f(p1, "ic_number")?.value === "••••••-••-5678" && f(p1, "ic_number")?.masked === true && f(p1, "fee_rate")?.value === "15.00%" && f(p1, "company_name")?.value === "A2Z CREATIVE MARKETING", "the fields fill from the customer, the profile (IC MASKED), the company and the version's rate", p1.text.slice(0, 600));
    ok(p1.j?.missing?.includes("client_email") && p1.j.ready === false && f(p1, "client_email")?.missing === true && JSON.stringify(p1.j.blocks).includes("[Client email]"), "a field with no record is listed as missing - nothing is invented", JSON.stringify(p1.j?.missing));
    ok((await prev(9, { record: true })).j?.error?.code === "fields_missing", "and the draft cannot be prepared");
    ok((await prev(15, {})).status === 404, "a salesperson outside the case cannot draft it (direct request)");
    ok((await call(`/fa/cases/${c1.id}/agreement/preview`, 9, "POST", { version_id: az.id })).status === 400, "a template of the other company / service is refused");
    ok((await call(`/fa/cases/${c1.id}/agreement/preview`, 9, "POST", { version_id: v1.id })).status === 409, "an archived version is refused");
    db.prepare(`UPDATE customers SET email = 'contoh@client.test' WHERE id = ?`).run(c1.customer_id); // the client's email is added in the customer record
    ok((await prev(9, { full_ic: "880101-14-5679" })).j?.error?.code === "ic_mismatch", "a typed IC that is not the client's is refused");
    ok((await prev(9, { full_ic: "88010114567" })).status === 400, "a typed IC has 12 digits");
    await call(`/fa/cases/${c1.id}/members`, 9, "POST", { user_id: 15 });
    ok((await prev(15, { full_ic: "880101-14-5678" })).status === 403, "an assisting member cannot type the full IC");
    const masked = await prev(15, {});
    ok(masked.status === 200 && masked.j.ready === true, "an assisting member reads the masked draft");
    const full = await prev(9, { full_ic: "880101145678", record: true });
    ok(full.status === 200 && f(full, "ic_number")?.value === "880101-14-5678" && f(full, "ic_number")?.masked === false && JSON.stringify(full.j.blocks).includes("880101-14-5678"), "the owner types the full IC for this document: it appears in this draft", full.text.slice(0, 300));
    const dr = db.prepare(`SELECT * FROM fa_agreement_drafts WHERE id = ?`).get(full.j?.draft_id ?? -1);
    ok(dr?.full_ic === 1 && dr.text_sha256 === sha(plain(masked.j.blocks)) && full.j.sha256 === dr.text_sha256, "the draft is recorded with the hash of the MASKED text and only a flag that an IC was typed");
    const everywhere = JSON.stringify([db.prepare(`SELECT * FROM fa_agreement_drafts`).all(), db.prepare(`SELECT * FROM audit_log`).all(), db.prepare(`SELECT * FROM fa_events`).all(), db.prepare(`SELECT * FROM fa_profiles`).all(), db.prepare(`SELECT * FROM notifications`).all()]);
    ok(!everywhere.includes("880101145678") && !everywhere.includes("880101-14-5678") && !everywhere.includes("880101"), "the full IC is stored nowhere - drafts, audit, timeline, profile, notifications");
    ok(throws(`UPDATE fa_agreement_drafts SET full_ic = 0`) && throws(`DELETE FROM fa_agreement_drafts`), "the draft history is append only");
    ok(p1.j?.draft === true && /DRAFT/.test(readFileSync(join(root, "lib/fa-agreement.ts"), "utf8")), "every preview is a draft (the PDF carries the DRAFT watermark)");
    ok((await call(`/fa/cases/${c1.id}/agreement`, 9, "POST", {})).j?.error?.code === "legal_gate" && (await call(`/fa/cases/${c1.id}/agreement`, 1, "POST", {})).j?.error?.code === "legal_gate", "sending and signing still answer legal_gate - for the CEO too");
    const hist = await call(`/fa/cases/${c1.id}/agreement`, 9);
    ok(hist.status === 200 && hist.j?.drafts?.length === 1 && hist.j.drafts[0].full_ic === 1, "the case lists its prepared drafts");

    /* ---- the fee ---- */
    const fe0 = await call(`/fa/cases/${c1.id}/fee`, 9, "POST", { version_id: v2.id });
    ok(fe0.status === 409 && fe0.j?.error?.code === "fee_after_disbursement" && finance() === before, "before a disbursement is recorded: nothing is billed", fe0.text);
    const letter = await upload(c1.id, 9, "disbursement");
    const dis = await call(`/fa/cases/${c1.id}/notes`, 1, "POST", { type: "decision", bank_id: bank.id, status: "disbursed", body: "Disbursed to the client", bank_reference: "BA-DIS-1", approved_cents: 3333333, evidence_id: letter.j.id });
    ok(dis.status === 201, "management records the disbursement with the bank's evidence and amount", dis.text);
    const fees9 = (await call("/fa/fees", 9)).j?.fees ?? [];
    ok(fees9.length === 1 && fees9[0].billable === true && fees9[0].bill_id === null, "the owner sees one billable disbursement");
    ok(((await call("/fa/fees", 21)).status === 403), "an agent sees no fee");
    const lia = await call("/fa/fees", 15);
    ok(lia.status === 200 && lia.j.fees.length === 1, "an assisting member sees it too (case scope)");
    ok((await call(`/fa/cases/${c1.id}/fee`, 15, "POST", { version_id: v2.id })).status === 403, "an assisting member cannot prepare the fee");
    ok((await call(`/fa/cases/${c2.id}/fee`, 9, "POST", {})).status === 404, "nor can a salesperson outside the case");
    const noPol = await call(`/fa/cases/${c1.id}/fee`, 9, "POST", { version_id: v2.id });
    ok(noPol.status === 409 && noPol.j?.error?.code === "commission_rule_missing", "with no commission policy that pays nothing on the fee line: refused", noPol.text);
    db.exec(`INSERT INTO commission_policies (id, version, name, status, effective_from, rate_kind, rate_bp, reason, created_by) VALUES (51, 1, 'Direct sales', 'active', '2026-11-01', 'percent', 1000, 'test', 1)`);
    ok((await call(`/fa/cases/${c1.id}/fee`, 9, "POST", { version_id: v2.id })).j?.error?.missing?.includes(1), "a policy in force without a rule of none for the fee line: refused (the 10% would apply)");
    db.exec(`INSERT INTO commission_policy_packages (policy_id, package_name, match_key, rule) VALUES (51, '${FEE_LINE}', '${FEE_LINE.toLowerCase()}', 'none')`);
    db.exec(`INSERT INTO commission_policies (id, version, name, status, effective_from, rate_kind, rate_bp, reason, created_by) VALUES (52, 2, 'Next year', 'active', '${later(40)}', 'percent', 1000, 'test', 1)`);
    ok((await call(`/fa/cases/${c1.id}/fee`, 9, "POST", { version_id: v2.id })).j?.error?.missing?.includes(2), "a later policy version without the rule: refused too");
    db.exec(`INSERT INTO commission_policy_packages (policy_id, package_name, match_key, rule) VALUES (52, '${FEE_LINE}', '${FEE_LINE.toLowerCase()}', 'none')`);
    ok((await call(`/fa/cases/${c1.id}/fee`, 9, "POST", { version_id: az.id })).status === 400, "a version of the other company / service is refused");
    ok((await call(`/fa/cases/${c1.id}/fee`, 9, "POST", { version_id: v1.id })).status === 400, "an archived version is refused");
    ok((await call(`/fa/cases/${c1.id}/fee`, 9, "POST", {})).status === 400, "the rate comes from a published version - none chosen, nothing billed");
    const fe = await call(`/fa/cases/${c1.id}/fee`, 9, "POST", { version_id: v2.id });
    const bill = db.prepare(`SELECT * FROM fa_fee_bills WHERE case_id = ?`).get(c1.id);
    ok(fe.status === 201 && bill?.fee_bp === 1500 && bill.base_cents === 3333333 && bill.fee_cents === 500000, "the fee: the version's 15.00% of the recorded RM 33,333.33, rounded half up = RM 5,000.00", fe.text);
    const pf = fe.j?.prefill;
    ok(pf?.source === "fa_fee" && pf.doc_type === "QT" && pf.issuer === "a2z" && pf.items?.length === 1 && pf.items[0].name === FEE_LINE && pf.items[0].unit_price_cents === 500000 && pf.items[0].qty === 1 && pf.company === "Encik Contoh" && pf.reference === `FA-FEE ${c1.case_ref}` && pf.salesperson_id === 9, "Sales receives a quotation prefill - one fee line, the client, the company, the reference", JSON.stringify(pf));
    ok(finance() === before, "no quotation, invoice, payment, cash or commission row is written here - Sales does that, as always", `${before} -> ${finance()}`);
    ok(db.prepare(`SELECT stage FROM fa_cases WHERE id = ?`).get(c1.id).stage === "fee", "the case moves to the fee stage");
    const again = await call(`/fa/cases/${c1.id}/fee`, 9, "POST", { version_id: az.id });
    ok(again.status === 200 && again.j?.again === true && again.j.bill.id === bill.id && n(`SELECT COUNT(*) AS n FROM fa_fee_bills`) === 1, "one fee per disbursement: asking again reopens the same prefill");
    ok(throws(`UPDATE fa_fee_bills SET fee_cents = 1`) && throws(`DELETE FROM fa_fee_bills`) && throws(`INSERT INTO fa_fee_bills (case_id, decision_note_id, version_id, fee_bp, base_cents, fee_cents, reference, created_by) VALUES (1, ${bill.decision_note_id}, 1, 1, 1, 1, 'x', 1)`), "fee records are append only and unique per disbursement");
    /* the commission engine itself pays nothing on that line under the rule, and the default without it */
    const inv = { items: JSON.stringify(pf.items), subtotal_cents: 500000, total_cents: 500000, tax_cents: 0, delivery_cents: 0, discount_cents: 0, doc_kind: "service" };
    const pol = { basis: "invoice_total", rate_kind: "percent", rate_bp: 1000, fixed_cents: null, product_rule: "listed_only" };
    ok(comm.commissionOf(inv, pol, [{ policy_id: 51, package_name: FEE_LINE, match_key: comm.matchKey(FEE_LINE), rule: "none", rate_bp: null, fixed_cents: null }]).amount === 0 && comm.commissionOf(inv, pol, []).amount > 0, "the commission engine earns RM 0 on the fee line with the rule of none (and would earn without it)");
    /* a corrected record, or one without an amount, is not billable */
    const l2 = await upload(c2.id, 15, "disbursement");
    const d2 = await call(`/fa/cases/${c2.id}/notes`, 1, "POST", { type: "decision", bank_id: bank.id, status: "disbursed", body: "Disbursed, amount to follow", evidence_id: l2.j.id });
    ok(d2.status === 201 && (await call(`/fa/cases/${c2.id}/fee`, 15, "POST", { version_id: az.id })).j?.error?.code === "fee_after_disbursement", "a disbursement without the amount bills nothing");
    await call(`/fa/notes/${dis.j.id}/correct`, 1, "POST", { body: "Correction: the amount is under review" });
    ok(((await call("/fa/fees", 9)).j?.fees ?? []).find((x) => x.note_id === dis.j.id)?.billable === false, "a corrected disbursement record is no longer billable");
    ok(!/Encik|5,000|500000|33,333/.test(JSON.stringify(db.prepare(`SELECT message FROM notifications`).all())), "no notification carries a client's name or a figure");
    ok(!/=\s*(1500|0\.15)\b|15\s*%/.test(readFileSync(join(root, "worker/src/fa-templates.ts"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")), "no fee rate is written in the code");
    ok(!/ctos|blacklist/i.test(readFileSync(join(root, "worker/src/fa-templates.ts"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/const PROHIBITED = .*$/m, "").replace(/\(no CTOS reporting, blacklisting or penalty clauses\)/g, "")), "no CTOS or blacklisting route or text beyond the refusal");
    ok((await call(`/fa/templates/versions/${v2.id}/archive`, 6, "POST", { reason: "Replaced soon" })).status === 403 && (await call(`/fa/templates/versions/${v2.id}/archive`, 1, "POST", { reason: "Replaced by counsel's text" })).status === 200, "only the CEO archives a published version");
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
const dir = mkdtempSync(join(tmpdir(), "faa-"));
bundle(root, "worker/src/index.ts", join(dir, "worker.mjs"));
bundle(root, "worker/src/commission.ts", join(dir, "commission.mjs"));
report(await runtime(join(dir, "worker.mjs"), join(dir, "commission.mjs")));
const checks = n;
const T = "worker/src/fa-templates.ts", C = "worker/src/commission.ts";
const MUT = [
  [T, "a fee from a record without evidence or amount", [["const usable = (d: { approved_cents: number | null; evidence_id: number | null; corrected: number }) => !!d.evidence_id && Number(d.approved_cents ?? 0) > 0 && !Number(d.corrected);", "const usable = (d: { approved_cents: number | null; evidence_id: number | null; corrected: number }) => !!d.evidence_id || !Number(d.corrected);"]]],
  [T, "the commission rule not checked", [["      if (!comm.ok) {", "      if (false) {"]]],
  [C, "a later policy version not checked", [["  const relevant = list.filter((p) => p === now || p.effective_from > day);", "  const relevant = list.filter((p) => p === now);"]]],
  [T, "the template check skipped", [["      if (!chk.ok) return json({ error: { code: \"template_check\", message: \"The template is not ready", "      if (false) return json({ error: { code: \"template_check\", message: \"The template is not ready"]]],
  [T, "publishing your own draft", [["      if (v.created_by === user.id && !isExecutiveOwner(user)) {", "      if (false) {"]]],
  [T, "any CEO account publishes without review", [["        if (!isExecutiveOwner(user)) return err(\"forbidden\", \"Only the verified owner account publishes without a legal review.\", 403);", ""]]],
  [T, "the typed IC not checked", [["      if ((await ctx.icHash(env, digits)) !== p.ic_hash) return err(\"ic_mismatch\"", "      if (false) return err(\"ic_mismatch\""]]],
  [T, "the draft hash over the full IC", [["      hash = await sha256(plain(masked.blocks));", "      hash = await sha256(plain(shown.blocks));"]]],
  [T, "Sales see drafts", [["    const shown = drafter || publisher ? versions : versions.filter((v) => v.state === \"approved\");", "    const shown = versions;"]]],
  [T, "a CTOS clause allowed", [["const PROHIBITED = /\\bCTOS\\b|black.?list|senarai hitam|penalt(y|ies)|\\bdenda\\b/gi;", "const PROHIBITED = /\\bdenda\\b/gi;"]]],
  [T, "a fee at another company's rate", [["      if (v.issuer_code !== c.issuer_code || v.service_type !== c.product) return err(\"invalid_input\", \"That template is for another company", "      if (false) return err(\"invalid_input\", \"That template is for another company"]]],
  [T, "a published text edited", [["      if (v.state !== \"draft\") return err(\"invalid_state\", \"Only a draft is edited.", "      if (false) return err(\"invalid_state\", \"Only a draft is edited."]]],
  [T, "the fee rounded down", [["export const feeOf = (baseCents: number, bp: number) => Math.floor((baseCents * bp + 5000) / 10000);", "export const feeOf = (baseCents: number, bp: number) => Math.floor((baseCents * bp) / 10000);"]]],
  [T, "a draft outside the case scope", [["  if (!c || !(await ctx.mayOpen(env, user, c))) return err(\"not_found\", \"Case not found\", 404);", "  if (!c) return err(\"not_found\", \"Case not found\", 404);"]]],
  [T, "a missing field filled in", [["      if (v == null || v === \"\") { missing.add(key);", "      if (v == null || v === \"\") { parts.push({ t: \"-\" }); continue;"]]],
];
for (const [file, name, reps] of NOMUT ? [] : MUT) {
  n++;
  let src = readFileSync(join(root, file), "utf8");
  let applied = true;
  for (const [from, to] of reps) { if (!src.includes(from)) { applied = false; break; } src = src.replace(from, to); }
  if (!applied) { fail++; console.error(`FAIL mutation did not apply: ${name}`); continue; }
  const mdir = mkdtempSync(join(tmpdir(), "faa-m-"));
  cpSync(join(root, "worker"), join(mdir, "worker"), { recursive: true, filter: (s) => !s.includes("node_modules") });
  cpSync(join(root, "package.json"), join(mdir, "package.json"));
  for (const d of ["lib", "constants", "types"]) { try { cpSync(join(root, d), join(mdir, d), { recursive: true }); } catch { /* not every folder exists */ } }
  writeFileSync(join(mdir, file), src);
  try { bundle(mdir, "worker/src/index.ts", join(mdir, "worker.mjs")); bundle(mdir, "worker/src/commission.ts", join(mdir, "commission.mjs")); } catch { fail++; console.error(`FAIL mutation did not build: ${name}`); continue; }
  const res = await runtime(join(mdir, "worker.mjs"), join(mdir, "commission.mjs"));
  rmSync(mdir, { recursive: true, force: true });
  if (!res.some(([p]) => !p)) { fail++; console.error(`FAIL mutation not caught: ${name}`); }
}
rmSync(dir, { recursive: true, force: true });
if (fail) { console.error(`fa-agreements: ${fail} of ${n} failed`); process.exit(1); }
console.log(`fa-agreements: ${checks} checks passed (${NOMUT ? "mutations skipped" : `${MUT.length} mutations caught`}) - management drafts, the owner-CEO publishes with the legal basis recorded; a Word file is read in the Worker and its text locked past draft; fields fill from the records with the IC masked and a typed IC stored nowhere; sending and signing stay off; the fee follows a recorded disbursement at the published rate, as a Sales quotation, with no commission`);
