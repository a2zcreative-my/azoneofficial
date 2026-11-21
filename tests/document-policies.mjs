#!/usr/bin/env node
/* v1.402.0 - THE QUOTATION'S VALIDITY, ON THE REAL WORKER (the CEO, 21-11-2026: "valid for
   fourteen (14) calendar days from the date of issuance ... authorised override ... preserve
   history ... expired quotations clearly identifiable"; decisions: old documents keep their
   wording, only the CEO / COO / CCO change the 14 days, old undated quotations stay as they are).

   The bundled worker/src/index.ts on an in-memory SQLite built from every migration
   (tests/browser/portfolio-runtime.mjs). People and clients are INVENTED test records.
     V1  a new quotation stores its validity: its date + 14, and policy_version 2
     V2  a salesperson may not choose another date (403); the CEO, COO and CCO may,
         within the quotation's date .. +365 days; the choice is audited
     V3  POST /docs/:id/validity: CEO / COO / CCO only, a reason, bounds, audited;
         refused on an invoiced quotation
     V4  a revision gets a fresh 14 days from the revision and policy_version 2
     V5  converting stamps the invoice policy_version 2; an expired quotation is refused
     V6  an older quotation (policy_version NULL, no date) is left exactly as it was
     V7  correcting a quotation's date moves an automatic validity with it
     V8  the public link returns policy_version, and an expired quotation is not accepted
   node tests/document-policies.mjs */
import { createHash } from "node:crypto";
import { makeRuntime } from "./browser/portfolio-runtime.mjs";

const { db, call, tok } = await makeRuntime();
const sha = (s) => createHash("sha256").update(s).digest("hex");
db.exec(`INSERT INTO users (id, name, full_name, email, role, is_active, password_hash, totp_enabled, department, position, employment_status, joined_on)
  VALUES (5,'Izz','Izz CCO','cco@a2zcreative.my','cco',1,'x',1,'Management','Chief Commercial Officer','permanent','2020-01-01')`);
tok[5] = "t-5";
db.prepare(`INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, 5, datetime('now', '+12 hours'), datetime('now'))`).run(sha("t-5"));
const cust = db.prepare(`INSERT INTO customers (company, contact_person, created_by) VALUES ('Test Client Sdn Bhd', 'Test Contact', 1) RETURNING id`).get().id;

const day = (off) => new Date(Date.now() + 8 * 3600e3 + off * 864e5).toISOString().slice(0, 10);
const plus = (iso, n) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const row = (id) => db.prepare(`SELECT id, doc_number, doc_type, valid_until, policy_version, revision, created_at FROM sales_documents WHERE id = ?`).get(id);
const audits = (id) => db.prepare(`SELECT detail FROM audit_log WHERE action = 'doc.validity' AND entity_id = ? ORDER BY id`).all(String(id)).map((r) => JSON.parse(r.detail));
const qt = (uid, extra = {}) => call("/staff/docs", uid, "POST", { doc_type: "QT", issuer: "a2z", kind: "service", customer_id: cust, salesperson_id: 4,
  items: [{ name: "Brand video", qty: 1, unit_price_cents: 250000 }], ...extra });

const res = [];
const ok = (name, cond, detail = "") => res.push([name, Boolean(cond), detail]);

/* V1 */
const a = await qt(4);
const aId = a.j?.id ?? a.j?.doc?.id;
const aRow = aId ? row(aId) : null;
ok("V1 a new quotation stores today + 14 and policy_version 2", aRow && aRow.valid_until?.slice(0, 10) === plus(day(0), 14) && aRow.policy_version === 2, `${a.status} ${JSON.stringify(aRow ?? a.text)}`);
const b = await qt(4, { doc_date: day(-5) });
const bRow = b.j?.id ? row(b.j.id) : null;
ok("V1 ... counted from the quotation's own date", bRow && bRow.valid_until?.slice(0, 10) === plus(day(-5), 14), JSON.stringify(bRow ?? b.text));

/* V2 */
const sOwn = await qt(4, { valid_until: plus(day(0), 30) });
ok("V2 a salesperson cannot choose another date", sOwn.status === 403, `${sOwn.status} ${sOwn.text}`);
const sSame = await qt(4, { valid_until: plus(day(0), 14) });
ok("V2 ... but sending the automatic date is fine", sSame.status === 200 || sSame.status === 201, `${sSame.status} ${sSame.text}`);
const c = await qt(1, { valid_until: plus(day(0), 30) });
const cRow = c.j?.id ? row(c.j.id) : null;
ok("V2 the CEO may choose 30 days, and it is audited", cRow?.valid_until?.slice(0, 10) === plus(day(0), 30) && audits(c.j.id).some((x) => x.at === "create" && x.to === plus(day(0), 30)), JSON.stringify(cRow ?? c.text));
const early = await qt(3, { valid_until: day(-1) });
const far = await qt(5, { valid_until: plus(day(0), 400) });
ok("V2 the COO / CCO: never before the quotation's date, never over a year", early.status === 400 && far.status === 400, `${early.status} ${far.status}`);
const cco = await qt(5, { valid_until: plus(day(0), 7) });
ok("V2 the CCO may shorten it", cco.j?.id && row(cco.j.id).valid_until.slice(0, 10) === plus(day(0), 7), cco.text);

/* V3 */
const v = (uid, id, body) => call(`/staff/docs/${id}/validity`, uid, "POST", body);
const v403 = await v(4, aId, { valid_until: plus(day(0), 20), reason: "client asked" });
const vHr = await v(2, aId, { valid_until: plus(day(0), 20), reason: "client asked" });
ok("V3 a salesperson and HR may not change the validity", v403.status === 403 && vHr.status === 403, `${v403.status} ${vHr.status}`);
const vNoWhy = await v(3, aId, { valid_until: plus(day(0), 20), reason: "no" });
const vEarly = await v(3, aId, { valid_until: day(-1), reason: "client asked" });
ok("V3 a reason is required, and the date cannot go before the quotation's", vNoWhy.status === 400 && vEarly.status === 400, `${vNoWhy.status} ${vEarly.status}`);
const vOk = await v(3, aId, { valid_until: plus(day(0), 20), reason: "client asked for more time" });
ok("V3 the COO extends it: saved and audited with from / to / reason", vOk.status === 200 && row(aId).valid_until.slice(0, 10) === plus(day(0), 20)
  && audits(aId).some((x) => x.from?.slice(0, 10) === plus(day(0), 14) && x.to === plus(day(0), 20) && x.reason === "client asked for more time"), `${vOk.status} ${vOk.text}`);

/* V4 */
db.prepare(`UPDATE sales_documents SET created_at = ?, valid_until = ?, policy_version = NULL WHERE id = ?`).run(`${day(-40)} 02:00:00`, plus(day(-40), 14), bRow.id);
const rev = await call(`/staff/docs/${bRow.id}/edit`, 4, "POST", { revise: true, items: [{ name: "Brand video", qty: 1, unit_price_cents: 260000 }], customer_id: cust, issuer: "a2z", kind: "service" });
const rRow = row(bRow.id);
ok("V4 a revision gets today + 14 and the new policy", rev.status === 200 && rRow.revision === 1 && rRow.valid_until.slice(0, 10) === plus(day(0), 14) && rRow.policy_version === 2, `${rev.status} ${rev.text} ${JSON.stringify(rRow)}`);

/* V5 */
const exp = await qt(4);
db.prepare(`UPDATE sales_documents SET created_at = ?, valid_until = ? WHERE id = ?`).run(`${day(-20)} 02:00:00`, plus(day(-20), 14), exp.j.id);
const convExp = await call(`/staff/docs/${exp.j.id}/convert`, 1, "POST", {});
ok("V5 an expired quotation is not invoiced", convExp.status === 409 && convExp.j?.error?.code === "expired", `${convExp.status} ${convExp.text}`);
const conv = await call(`/staff/docs/${aId}/convert`, 1, "POST", {});
const invId = conv.j?.id ?? conv.j?.doc?.id ?? conv.j?.invoice?.id;
const inv = invId ? row(invId) : db.prepare(`SELECT * FROM sales_documents WHERE doc_type = 'INV' ORDER BY id DESC LIMIT 1`).get();
ok("V5 the invoice from a quotation carries policy_version 2", [200, 201].includes(conv.status) && inv?.doc_type === "INV" && inv.policy_version === 2, `${conv.status} ${conv.text} ${JSON.stringify(inv)}`);
const vInv = await v(1, aId, { valid_until: plus(day(0), 60), reason: "client asked again" });
ok("V3 an invoiced quotation's validity cannot change", vInv.status === 409, `${vInv.status} ${vInv.text}`);

/* V6 */
db.exec(`INSERT INTO sales_documents (doc_number, doc_type, customer_id, items, total_cents, created_by, created_at, valid_until, issuer_code, kind)
  VALUES ('QT-0900', 'QT', ${cust}, '[]', 1000, 1, '2026-01-05 02:00:00', NULL, 'a2z', 'service')`);
const oldId = db.prepare(`SELECT id FROM sales_documents WHERE doc_number = 'QT-0900'`).get().id;
await qt(4); await call("/staff/docs", 1, "GET");
const oRow = row(oldId);
ok("V6 an older undated quotation is left as it was (no date, no new policy)", oRow.valid_until === null && oRow.policy_version === null, JSON.stringify(oRow));

/* V7 */
const d = await qt(4, { doc_date: day(-2) });
const fix = await call(`/staff/docs/${d.j.id}/edit`, 4, "POST", { doc_date: day(-1), items: [{ name: "Brand video", qty: 1, unit_price_cents: 250000 }], customer_id: cust, issuer: "a2z", kind: "service" });
ok("V7 correcting the date moves the automatic validity", fix.status === 200 && row(d.j.id).valid_until.slice(0, 10) === plus(day(-1), 14), `${fix.status} ${fix.text} ${JSON.stringify(row(d.j.id))}`);
const fixC = await call(`/staff/docs/${c.j.id}/edit`, 1, "POST", { doc_date: day(-1), items: [{ name: "Brand video", qty: 1, unit_price_cents: 250000 }], customer_id: cust, issuer: "a2z", kind: "service" });
ok("V7 ... but a date the CEO chose stays", fixC.status === 200 && row(c.j.id).valid_until.slice(0, 10) === plus(day(0), 30), `${fixC.status} ${JSON.stringify(row(c.j.id))}`);

/* V8 */
const tokFor = async (id) => {
  const s = await call(`/staff/docs/${id}/share`, 1, "POST", {});
  return s.j?.token ?? s.j?.share_token ?? db.prepare(`SELECT share_token FROM sales_documents WHERE id = ?`).get(id)?.share_token;
};
const pubTok = await tokFor(cco.j.id);
const pub = pubTok ? await call(`/public/doc/${pubTok}`, null) : null;
const pubDoc = pub?.j?.doc ?? pub?.j;
ok("V8 the shared link says which policy the quotation carries", pubDoc?.policy_version === 2, `${pub?.status} ${pub?.text}`);
const expTok = await tokFor(exp.j.id);
const acc = expTok ? await call(`/public/doc/${expTok}/accept`, null, "POST", { name: "Test Contact", position: "Director", agree: true }) : null;
ok("V8 an expired quotation is not accepted online", acc && acc.status === 410 && acc.j?.error?.code === "expired", `${acc?.status} ${acc?.text}`);

const failed = res.filter(([, cnd]) => !cnd);
for (const [nm, cnd, det] of res) if (!cnd) console.log(`  ✗ ${nm}${det ? `  [${det}]` : ""}`);
if (failed.length) { console.log(`\ndocument-policies: ${failed.length} of ${res.length} failed`); process.exit(1); }
console.log(`document-policies: ${res.length} checks passed`);
