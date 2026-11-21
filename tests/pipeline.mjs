/* v1.399.0 - SALES COMMAND CENTER, PHASE 3: THE SALES PIPELINE (the CEO, 21-11-2026: decisions 1, 4
 * and 6, and "As recommended" on the seven Phase 3 decisions). worker/src/deals.ts + migration 0227.
 * Runtime guard on the tasks-gate4 harness: the WHOLE worker bundled against SQLite with every migration,
 * by direct request as each role, then the same run against deliberately broken copies.
 *
 *   - deals, their quotation links and stage history are kept: never deleted, history never edited
 *   - a deal is changed by its owner or a manager; a move, an edit or a close is confirmed by version,
 *     and a refused move writes no history
 *   - the value is counted ONCE: the newest linked quotation's total, else the estimate
 *   - a quotation belongs to one deal at a time, and only to a deal of its own customer
 *   - Won needs the acceptance of the quotation's CURRENT revision, or a live invoice made from it;
 *     without either only pipeline_override (CEO, COO, CCO - not the super admin) with a reason
 *   - Lost needs a reason from the list (Other needs words); a closed deal does not move; only
 *     pipeline_override reopens
 *   - suggested deals: open quotations with no deal, none made until a manager confirms, once each
 *   - My Sales Action Center: a deal's next action, never listed twice with its quotation or its lead
 *   - Stuck after 14 days in one stage with nothing recorded
 *   - nothing touches a document, a payment report, a cash row, the journal or commission
 *
 *   node tests/pipeline.mjs
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
  const entry = join(srcRoot, "pipeline-entry.ts");
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

async function runtime(workerBundle, migDir) {
  const out = [];
  const ok = (c, m, why = "") => out.push([!!c, why && !c ? `${m} - ${why}` : m]);
  const db = new DatabaseSync(":memory:");
  const realClock = new DatabaseSync(":memory:");
  const pinTs = () => new Date().toISOString().slice(0, 19).replace("T", " ");
  for (const fn of ["datetime", "date", "time", "julianday"]) db.function(fn, { varargs: true }, (...a) => realClock.prepare(`SELECT ${fn}(${(a.length ? a : ["now"]).map(() => "?").join(",")}) AS v`).get(...(a.length ? a : ["now"]).map((x) => (typeof x === "string" && x.toLowerCase() === "now" ? pinTs() : x))).v);
  db.function("strftime", { varargs: true }, (...a) => realClock.prepare(`SELECT strftime(${a.map(() => "?").join(",")}) AS v`).get(...a.map((x, i) => (i > 0 && typeof x === "string" && x.toLowerCase() === "now" ? pinTs() : x))).v);
  const RealDate = globalThis.Date;
  const fixed = Date.parse("2026-11-10T04:00:00Z"); // Tuesday 10-11-2026, 12:00 in Malaysia
  globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [fixed])); } static now() { return fixed; } };
  applyAll(db, migDir);
  const shim = (sql) => { const st = db.prepare(sql); let b = []; const o = {
    bind: (...a) => { b = a.map((x) => (x === undefined ? null : x)); return o; },
    first: async () => st.get(...b) ?? null, all: async () => ({ results: st.all(...b) }),
    run: async () => ({ meta: { changes: Number(st.run(...b).changes) } }), _run: () => st.run(...b) }; return o; };
  const env = {
    DB: { prepare: shim, batch: async (list) => { db.exec("BEGIN"); const res = []; try { for (const s of list) res.push({ meta: { changes: Number(s._run().changes) } }); db.exec("COMMIT"); } catch (e) { db.exec("ROLLBACK"); throw e; } return res; } },
    SESSION_PEPPER: "pepper", COMPANY_DOMAIN: "a2z.test", ALLOWED_ORIGINS: "https://portal.a2z.test",
    MEDIA: { put: async () => {}, get: async () => null, head: async () => null, list: async () => ({ objects: [] }), delete: async () => {} },
  };
  if (!globalThis.FixedLengthStream) globalThis.FixedLengthStream = class extends TransformStream { constructor() { super(); } };
  const U = { ceo: 1, sa: 2, coo: 3, admin: 4, aina: 5, hr: 6, host: 7, cco: 8, bakar: 9, mkt: 10, agent: 11 };
  db.exec(`INSERT INTO users (id, name, full_name, email, role, is_active, password_hash, totp_enabled, totp_secret, employment_status, base_salary_cents, joined_on) VALUES
    (1,'Alif','Alif Owner','owner@a2z.test','ceo',1,'x',1,'JBSWY3DPEHPK3PXP','permanent',900000,'2024-01-01'),
    (2,'Root','System Root','root@a2z.test','super_admin',1,'x',1,'JBSWY3DPEHPK3PXP','permanent',0,'2024-01-01'),
    (3,'Ops','Ops Lead','ops@a2z.test','coo',1,'x',1,'JBSWY3DPEHPK3PXP','permanent',800000,'2024-01-01'),
    (4,'Adm','Admin Clerk','admin@a2z.test','admin',1,'x',1,'JBSWY3DPEHPK3PXP','permanent',300000,'2024-01-01'),
    (5,'Aina','Aina Seller','aina@a2z.test','sales_marketing',1,'x',1,'JBSWY3DPEHPK3PXP','permanent',300000,'2024-01-01'),
    (6,'Hana','Hana HR','hana@a2z.test','hr_admin',1,'x',1,'JBSWY3DPEHPK3PXP','permanent',400000,'2024-01-01'),
    (7,'Farid','Farid Host','farid@a2z.test','live_host',1,'x',1,'JBSWY3DPEHPK3PXP','permanent',250000,'2024-01-01'),
    (8,'Chen','Chen CCO','chen@a2z.test','cco',1,'x',1,'JBSWY3DPEHPK3PXP','permanent',700000,'2024-01-01'),
    (9,'Bakar','Bakar Seller','bakar@a2z.test','sales_marketing',1,'x',1,'JBSWY3DPEHPK3PXP','permanent',300000,'2024-01-01'),
    (10,'Mira','Mira Marketing','mira@a2z.test','marketing',1,'x',1,'JBSWY3DPEHPK3PXP','permanent',300000,'2024-01-01'),
    (11,'Ros','Ros Agent','ros@agent.test','agent',1,'x',1,'JBSWY3DPEHPK3PXP','permanent',0,'2024-01-01')`);
  db.exec(`INSERT INTO system_meta (key, value) VALUES ('company_owner', '{"user_id":1}')`);
  const doc = db.prepare(`INSERT INTO sales_documents (id, doc_type, doc_number, customer_id, items, discount_cents, tax_percent, total_cents, payment_status, created_at, created_by, salesperson_id, kind, issuer_code, revision, valid_until, converted_from, voided_at) VALUES (?, ?, ?, ?, '[]', 0, 0, ?, ?, ?, 5, ?, 'service', 'a2z', ?, ?, ?, ?)`);
  for (let c = 1; c <= 9; c++) db.exec(`INSERT INTO customers (id, company, phone, created_by, created_at) VALUES (${c}, 'Client ${c} Sdn Bhd', '01220000${c}', 5, '2026-10-01 01:00:00')`);
  db.exec(`INSERT INTO customers (id, company, created_by) VALUES (31, 'Walk-in Customer', 5)`);
  db.exec(`INSERT INTO sales_packages (id, name, status) VALUES (1, 'Live Selling Starter', 'active')`);
  //        id   type   number      cust total    pay     created               sp  rev valid        from void
  doc.run(501, "QT", "QT-P-501", 1, 100000, null, "2026-10-01 01:00:00", 5, 0, "2026-12-31", null, null); // customer 1: link target
  doc.run(502, "QT", "QT-P-502", 1, 150000, null, "2026-10-20 01:00:00", 5, 1, "2026-12-31", null, null); // customer 1: newer, revision 1
  doc.run(503, "QT", "QT-P-503", 2, 200000, null, "2026-10-05 01:00:00", 5, 0, "2026-12-31", null, null); // customer 2: another customer
  doc.run(504, "QT", "QT-P-504", 3, 300000, null, "2026-10-06 01:00:00", 5, 0, "2026-12-31", null, null); // customer 3: will be invoiced
  doc.run(505, "INV", "INV-P-505", 3, 300000, "unpaid", "2026-10-07 01:00:00", 5, 0, null, 504, null);   // live invoice from 504
  doc.run(506, "QT", "QT-P-506", 4, 400000, null, "2026-10-08 01:00:00", 5, 0, "2026-12-31", null, null); // customer 4: only a VOID invoice
  doc.run(507, "INV", "INV-P-507", 4, 400000, "void", "2026-10-09 01:00:00", 5, 0, null, 506, "2026-10-10 01:00:00");
  doc.run(508, "QT", "QT-P-508", 5, 500000, null, "2026-10-10 01:00:00", 7, 0, "2026-12-31", null, null); // the live host's quotation: no suggestion
  doc.run(509, "QT", "QT-P-509", 6, 600000, null, "2026-10-11 01:00:00", 9, 0, "2026-11-01", null, null); // expired: no suggestion
  doc.run(510, "QT", "QT-P-510", 7, 700000, null, "2026-10-12 01:00:00", 9, 0, "2026-12-31", null, null); // Bakar's: suggested, negotiating
  doc.run(511, "QT", "QT-P-511", 8, 800000, null, "2026-11-02 01:00:00", 5, 0, "2026-12-31", null, null); // customer 8: listed as a quotation with no next step
  /* v1.406.0 - a lead's own invoiced quotation, linked as a Won deal on its invoice; a void quotation is never offered */
  doc.run(512, "QT", "QT-P-512", 9, 120000, null, "2026-09-01 01:00:00", 9, 0, "2026-09-15", null, null);              // customer 9: invoiced (and long expired)
  doc.run(513, "INV", "INV-P-513", 9, 120000, "paid", "2026-09-10 01:00:00", 9, 0, null, 512, null);                     // its live invoice
  doc.run(514, "QT", "QT-P-514", 9, 90000, null, "2026-09-02 01:00:00", 9, 0, "2026-12-31", null, "2026-09-03 01:00:00"); // void: never offered
  db.exec(`INSERT INTO quotation_acceptances (doc_id, revision, accepted_name) VALUES (502, 0, 'Old revision only')`);
  db.exec(`INSERT INTO customer_followups (id, customer_id, due_on, owner_id, note, created_by, created_at, doc_id, done_at, done_by, outcome) VALUES (1, 7, '2026-11-01', 9, 'Talked price', 9, '2026-10-20 01:00:00', 510, '2026-11-01 02:00:00', 9, 'negotiating')`);

  const app = (await import(pathToFileURL(workerBundle).href + `?v=${Math.random()}`)).default;
  const tok = {};
  for (const id of Object.values(U)) { tok[id] = `t-${id}-${Math.random()}`; db.prepare(`INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, datetime('now', '+12 hours'), datetime('now'))`).run(sha(tok[id]), id); }
  const hdr = (uid) => ({ origin: "https://portal.a2z.test", cookie: `azone_session=${tok[uid]}; csrf_token=c1`, "x-csrf-token": "c1", "content-type": "application/json" });
  const call = async (p, uid, method = "GET", body) => {
    const r = await app.fetch(new Request(`https://api.a2z.test/api/v1/staff${p}`, { method, headers: hdr(uid), body: body === undefined ? undefined : JSON.stringify(body) }), env, { waitUntil() {} });
    const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch { /* not json */ }
    return { status: r.status, j, text };
  };
  const money = () => sha(["sales_documents", "invoice_payment_reports", "cash_book", "commission_ledger", "invoice_paid_confirmations", "journal_entries", "quotation_acceptances"].map((t) => { try { return JSON.stringify(db.prepare(`SELECT * FROM "${t}"`).all()); } catch { return "-"; } }).join("|"));
  const cnt = (sql) => db.prepare(sql).get().n;
  const row = (id) => db.prepare(`SELECT * FROM sales_opportunities WHERE id = ?`).get(id);
  const hist = (id) => cnt(`SELECT COUNT(*) AS n FROM opportunity_stage_events WHERE opportunity_id = ${id}`);
  const mk = async (uid, b) => call("/deals", uid, "POST", { client_key: `key${Math.random().toString(36).slice(2, 12)}`, ...b });
  try {
    let before = money();
    /* the migration */
    for (const t of ["sales_opportunities", "opportunity_quotations", "opportunity_stage_events"]) ok(cnt(`SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = '${t}'`) === 1, `0227 makes ${t}`);

    /* who may read */
    for (const [who, uid] of [["live host", U.host], ["marketing", U.mkt], ["agent", U.agent]]) ok((await call("/deals", uid)).status === 403, `a ${who} is refused`);
    const oA = await call("/deals/options", U.aina), oC = await call("/deals/options", U.coo), oS = await call("/deals/options", U.sa), oCe = await call("/deals/options", U.ceo);
    ok(oA.status === 200 && oA.j.can_write && !oA.j.can_assign && !oA.j.can_override, "a consultant writes, but neither assigns nor overrides");
    ok(oC.j?.can_override && oCe.j?.can_override && oS.j?.can_override === false, "pipeline_override is the CEO, COO and CCO - not the super admin", JSON.stringify([oC.j?.can_override, oS.j?.can_override]));
    ok(!(oA.j.owners ?? []).some((u) => u.id === U.host) && (oA.j.owners ?? []).some((u) => u.id === U.bakar), "the owner list is current sales staff only");

    /* create */
    ok((await call("/deals", U.aina, "POST", { customer_id: 1, title: "No key" })).status === 400, "a new deal needs its client_key");
    const k1 = { client_key: "deal0000001", customer_id: 1, title: "Raya campaign", est_value_cents: 90000, next_action: "Call", next_action_on: "2026-11-09" };
    const c1 = await call("/deals", U.aina, "POST", k1), c1b = await call("/deals", U.aina, "POST", k1);
    ok(c1.status === 201 && c1b.j?.id === c1.j?.id && cnt(`SELECT COUNT(*) AS n FROM sales_opportunities`) === 1 && hist(c1.j.id) === 1, "a double press is ONE deal and one history row", c1.text.slice(0, 160));
    const D1 = c1.j.id;
    ok(row(D1).owner_id === U.aina && row(D1).stage === "new", "a consultant's new deal is theirs, in New");
    ok((await mk(U.aina, { customer_id: 2, title: "For Bakar", owner_id: U.bakar })).status === 403, "a consultant cannot give a deal to someone else");
    ok((await mk(U.coo, { customer_id: 2, title: "For the host", owner_id: U.host })).status === 400, "a deal's owner must be sales staff");
    ok((await mk(U.aina, { customer_id: 31, title: "Walk in" })).status === 400, "no deal with the walk-in customer");
    const c2 = await mk(U.coo, { customer_id: 2, title: "Bakar deal", owner_id: U.bakar, est_value_cents: 50000 });
    ok(c2.status === 201 && row(c2.j.id).owner_id === U.bakar && cnt(`SELECT COUNT(*) AS n FROM notifications WHERE user_id = ${U.bakar} AND ref = 'deal:${c2.j.id}'`) === 1, "a manager gives a deal to someone, and they are told", c2.text.slice(0, 120));
    const D2 = c2.j.id;

    /* edit and move */
    ok((await call(`/deals/${D2}/move`, U.aina, "POST", { to: "qualified", version: 1 })).status === 403, "a consultant cannot move someone else's deal");
    const mv = await call(`/deals/${D1}/move`, U.aina, "POST", { to: "qualified", version: 1 });
    ok(mv.status === 200 && row(D1).stage === "qualified" && row(D1).version === 2 && hist(D1) === 2, "a move is one version and one history row");
    const stale = await call(`/deals/${D1}/move`, U.aina, "POST", { to: "proposal", version: 1 });
    ok(stale.status === 409 && row(D1).stage === "qualified" && hist(D1) === 2, "a stale move is refused and writes no history", stale.text.slice(0, 120));
    ok((await call(`/deals/${D1}/move`, U.aina, "POST", { to: "won", version: 2 })).status === 400, "Won is not a move");
    const ed = await call(`/deals/${D1}`, U.aina, "PUT", { title: "Raya campaign", est_value_cents: 90000, priority: "high", next_action: "Send deck", next_action_on: "2026-11-09", version: 2, owner_id: U.bakar });
    ok(ed.status === 403 && row(D1).owner_id === U.aina, "a consultant cannot change the owner on an edit");
    ok((await call(`/deals/${D1}`, U.aina, "PUT", { title: "Raya campaign", est_value_cents: 90000, priority: "high", next_action: "Send deck", next_action_on: "2026-11-09", version: 2 })).status === 200 && row(D1).priority === "high", "the owner edits their deal");

    /* link and value */
    ok((await call(`/deals/${D1}/link`, U.aina, "POST", { doc_id: 503, version: 3 })).status === 400, "a quotation of another customer is refused");
    let v = row(D1).version;
    ok((await call(`/deals/${D1}/link`, U.aina, "POST", { doc_id: 501, version: v })).status === 200, "a quotation of the same customer links");
    let g = (await call(`/deals/${D1}`, U.aina)).j?.deal;
    ok(g?.value_cents === 100000 && g.value_basis === "quotation", "with a quotation, the value is the quotation's total and the estimate is not added", JSON.stringify([g?.value_cents, g?.value_basis]));
    v = row(D1).version;
    await call(`/deals/${D1}/link`, U.aina, "POST", { doc_id: 502, version: v });
    g = (await call(`/deals/${D1}`, U.aina)).j?.deal;
    ok(g?.value_cents === 150000 && g.quotes.length === 2, "the NEWEST linked quotation sets the value - never the two added", JSON.stringify([g?.value_cents]));
    const c3 = await mk(U.aina, { customer_id: 1, title: "Second deal, same customer" });
    const D3 = c3.j.id;
    const dup = await call(`/deals/${D3}/link`, U.aina, "POST", { doc_id: 501, version: 1 });
    ok(dup.status === 409 && cnt(`SELECT COUNT(*) AS n FROM opportunity_quotations WHERE doc_id = 501 AND unlinked_at IS NULL`) === 1, "a quotation belongs to ONE deal at a time", dup.text.slice(0, 120));
    const g2 = (await call(`/deals/${D2}`, U.coo)).j?.deal;
    ok(g2?.value_cents === 50000 && g2.value_basis === "estimate", "without a quotation the estimate is the value");

    /* won */
    v = row(D1).version;
    const w1 = await call(`/deals/${D1}/won`, U.aina, "POST", { version: v });
    ok(w1.status === 409 && w1.j?.error?.code === "no_evidence" && row(D1).stage !== "won", "an acceptance of an OLDER revision is not evidence: Won is refused", w1.text.slice(0, 160));
    const ws = await call(`/deals/${D1}/won`, U.sa, "POST", { version: v, override_reason: "Super admin says so here" });
    ok(ws.status === 409 && row(D1).stage !== "won", "the super admin cannot override");
    ok(money() === before, "creating, moving, linking and a refused Won touched no document or money row");
    db.exec(`INSERT INTO quotation_acceptances (doc_id, revision, accepted_name) VALUES (502, 1, 'Current revision')`);
    before = money(); // the test itself recorded that acceptance; the pipeline must not
    const w2 = await call(`/deals/${D1}/won`, U.aina, "POST", { version: v });
    ok(w2.status === 200 && row(D1).stage === "won" && row(D1).won_basis === "acceptance" && row(D1).won_doc_id === 502, "the acceptance of the CURRENT revision wins it", w2.text.slice(0, 160));
    ok((await call(`/deals/${D1}/move`, U.aina, "POST", { to: "negotiation", version: row(D1).version })).status === 409, "a closed deal does not move");
    ok((await call(`/deals/${D1}/reopen`, U.aina, "POST", { reason: "The customer changed their mind", version: row(D1).version })).status === 403, "only a manager reopens");
    const ro = await call(`/deals/${D1}/reopen`, U.coo, "POST", { reason: "The customer changed their mind", version: row(D1).version });
    ok(ro.status === 200 && row(D1).stage === "negotiation" && row(D1).won_basis === null, "a manager reopens with a reason, back to Negotiation");

    const c4 = await mk(U.aina, { customer_id: 3, title: "Invoiced deal" });
    const D4 = c4.j.id;
    await call(`/deals/${D4}/link`, U.aina, "POST", { doc_id: 504, version: 1 });
    const w4 = await call(`/deals/${D4}/won`, U.aina, "POST", { version: row(D4).version });
    ok(w4.status === 200 && row(D4).won_basis === "invoice", "a live invoice made from a linked quotation wins it", w4.text.slice(0, 120));
    const c5 = await mk(U.aina, { customer_id: 4, title: "Void invoice deal" });
    const D5 = c5.j.id;
    await call(`/deals/${D5}/link`, U.aina, "POST", { doc_id: 506, version: 1 });
    ok((await call(`/deals/${D5}/won`, U.aina, "POST", { version: row(D5).version })).status === 409, "a VOID invoice is not evidence");
    ok((await call(`/deals/${D5}/won`, U.coo, "POST", { version: row(D5).version, override_reason: "short" })).status === 400, "an override needs a reason of 10 characters");
    const ov = await call(`/deals/${D5}/won`, U.coo, "POST", { version: row(D5).version, override_reason: "Signed on paper at the meeting" });
    ok(ov.status === 200 && row(D5).won_basis === "override" && cnt(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'pipeline.won_override' AND entity_id = '${D5}'`) === 1, "the COO may decide Won with a reason, and it is audited", ov.text.slice(0, 120));

    /* lost */
    ok((await call(`/deals/${D3}/lost`, U.aina, "POST", { version: 1 })).status === 400, "Lost needs a reason");
    ok((await call(`/deals/${D3}/lost`, U.aina, "POST", { version: 1, reason: "other" })).status === 400, "Other needs words");
    ok((await call(`/deals/${D3}/lost`, U.aina, "POST", { version: 1, reason: "cheaper elsewhere" })).status === 400, "a reason off the list is refused");
    const ls = await call(`/deals/${D3}/lost`, U.aina, "POST", { version: 1, reason: "price", note: "Too dear" });
    ok(ls.status === 200 && row(D3).stage === "lost" && row(D3).lost_reason === "price", "Lost with a reason from the list");

    /* unlink */
    v = row(D1).version;
    ok((await call(`/deals/${D1}/unlink`, U.aina, "POST", { doc_id: 502, version: v })).status === 400, "unlinking needs a reason");
    const ul = await call(`/deals/${D1}/unlink`, U.aina, "POST", { doc_id: 502, version: v, reason: "Wrong quotation" });
    ok(ul.status === 200 && cnt(`SELECT COUNT(*) AS n FROM opportunity_quotations WHERE doc_id = 502 AND unlinked_at IS NOT NULL`) === 1, "an unlink is kept as history, never deleted");

    /* append-only */
    let upd = false, del = false, delO = false;
    try { db.exec(`UPDATE opportunity_stage_events SET reason = 'x'`); upd = true; } catch { /* refused */ }
    try { db.exec(`DELETE FROM opportunity_stage_events`); del = true; } catch { /* refused */ }
    try { db.exec(`DELETE FROM sales_opportunities`); delO = true; } catch { /* refused */ }
    let delL = false; try { db.exec(`DELETE FROM opportunity_quotations`); delL = true; } catch { /* refused */ }
    ok(!upd && !del && !delO && !delL, "stage history is never edited; deals, history and links are never deleted");

    /* suggestions */
    ok((await call("/deals/suggestions", U.aina)).status === 403, "only a manager sees suggested deals");
    const before2 = cnt(`SELECT COUNT(*) AS n FROM sales_opportunities`);
    const sg = await call("/deals/suggestions", U.coo);
    const sMap = Object.fromEntries((sg.j?.rows ?? []).map((r) => [r.doc_id, r]));
    /* v1.406.0 (the CEO: "all this have their own Quotation and Invoice, link it!") - every quotation on no deal is offered: open
       ones as before, an expired one to Proposal sent (never pre-ticked), an invoiced one as a Won deal on its invoice; never a void one */
    ok(sMap[510]?.stage === "negotiation" && sMap[510].kind === "open" && sMap[510].owner_id === U.bakar && sMap[511]?.stage === "proposal" && sMap[511].kind === "open" && !sMap[501], "an open quotation with no deal is offered as before; negotiating ones in Negotiation; one already on a deal is not", JSON.stringify(Object.keys(sMap)));
    ok(sMap[509]?.kind === "expired" && sMap[509].stage === "proposal", "an expired quotation is offered to Proposal sent, so somebody follows it up", JSON.stringify(sMap[509]));
    ok(sMap[512]?.kind === "invoiced" && sMap[512].stage === "won" && sMap[512].inv_number === "INV-P-513", "an invoiced quotation is offered as a Won deal on its invoice", JSON.stringify(sMap[512]));
    ok(!sMap[514], "a void quotation is never offered");
    ok(sMap[508] && sMap[508].owner_id === null, "the owner is the salesperson only when they may still sell, else the lead's owner, else nobody - never the live host", JSON.stringify(sMap[508]));
    const one = await call("/deals/suggestions?customer=9", U.coo);
    ok(JSON.stringify((one.j?.rows ?? []).map((x) => x.doc_id)) === "[512]", "a lead's own quotations, from its record", one.text.slice(0, 160));
    ok(cnt(`SELECT COUNT(*) AS n FROM sales_opportunities`) === before2, "nothing is made until a manager confirms");
    ok((await call("/deals/suggestions/confirm", U.coo, "POST", { items: [510] })).status === 400, "confirming needs a reason");
    const cf = await call("/deals/suggestions/confirm", U.coo, "POST", { items: [510, 501], reason: "Pipeline start" });
    const cf2 = await call("/deals/suggestions/confirm", U.coo, "POST", { items: [510], reason: "Pipeline start" });
    const made = db.prepare(`SELECT o.* FROM sales_opportunities o JOIN opportunity_quotations l ON l.opportunity_id = o.id WHERE l.doc_id = 510`).all();
    ok(cf.j?.made === 1 && (cf.j.skipped ?? []).includes(501) && cf2.j?.made === 0 && made.length === 1 && made[0].origin === "suggestion" && made[0].owner_id === U.bakar, "a confirmed suggestion is made once; a quotation already on a deal is skipped", cf.text.slice(0, 160));
    const cw = await call("/deals/suggestions/confirm", U.coo, "POST", { items: [512], reason: "Link the lead's history", customer: 9 });
    const wd = db.prepare(`SELECT o.* FROM sales_opportunities o JOIN opportunity_quotations l ON l.opportunity_id = o.id WHERE l.doc_id = 512`).get();
    const we = wd ? db.prepare(`SELECT * FROM opportunity_stage_events WHERE opportunity_id = ?`).all(wd.id) : [];
    ok(cw.j?.made === 1 && wd?.stage === "won" && wd.won_basis === "invoice" && wd.won_doc_id === 512 && wd.closed_at === "2026-09-10 01:00:00" && wd.owner_id === U.bakar,
       "linking an invoiced quotation makes a Won deal on that invoice, closed on the invoice's date", JSON.stringify(wd));
    ok(we.length === 1 && we[0].to_stage === "won" && we[0].basis === "invoice" && /INV-P-513/.test(we[0].reason), "its history says it was linked from the quotation, invoiced as the invoice", JSON.stringify(we));

    /* the Action Center */
    const c6 = await mk(U.aina, { customer_id: 8, title: "Customer 8 deal", next_action: "Chase", next_action_on: "2026-11-05" });
    await call(`/deals/${c6.j.id}/link`, U.aina, "POST", { doc_id: 511, version: 1 });
    db.exec(`UPDATE customers SET owner_id = ${U.aina}, relationship_status = 'qualified' WHERE id IN (8, 9)`);
    const td = await call("/sales/today", U.aina);
    const items = td.j?.items ?? [];
    ok(items.some((i) => i.key === `deal:${c6.j.id}` && i.kind === "opportunity" && i.flag === "overdue"), "an open deal whose next action has passed is on My Sales Action Center, red", JSON.stringify(items.map((i) => `${i.key}/${i.flag}`)));
    ok(!items.some((i) => i.key === "quotation:511") && !items.some((i) => i.key === "lead:8"), "its quotation and its lead are not listed again beside it", JSON.stringify(items.map((i) => i.key)));
    ok(items.some((i) => i.key === "lead:9"), "a lead with no deal still shows");
    ok((td.j?.done ?? []).some((d) => d.kind === "deal_moved" && d.record_id === D1), "Done today shows a deal moved by me");

    /* stuck */
    const c7 = await mk(U.aina, { customer_id: 9, title: "Quiet deal", next_action: "Wait", next_action_on: "2026-11-30" });
    db.exec(`UPDATE sales_opportunities SET stage_since = '2026-10-20 01:00:00', last_activity_at = '2026-10-20 01:00:00' WHERE id = ${c7.j.id}`);
    let q7 = (await call(`/deals/${c7.j.id}`, U.aina)).j?.deal;
    ok(q7?.stuck === true && q7.next_late === false, "14 days in one stage with nothing recorded is Stuck (amber, not red)", JSON.stringify([q7?.stuck, q7?.days_in_stage]));
    db.exec(`INSERT INTO sales_activities (customer_id, kind, note, occurred_at, source_key, created_by) VALUES (9, 'call', 'Spoke', '2026-11-08 01:00:00', 'seed:9', 5)`);
    q7 = (await call(`/deals/${c7.j.id}`, U.aina)).j?.deal;
    ok(q7?.stuck === false, "a recorded contact with the customer ends Stuck");

    /* summary */
    const sm = (await call("/deals?scope=all", U.coo)).j?.summary;
    const open = db.prepare(`SELECT id FROM sales_opportunities WHERE stage IN ('new','qualified','proposal','negotiation')`).all().length;
    ok(sm?.open === open && sm.won_month >= 2 && sm.lost_month === 1, "the figures count the deals", JSON.stringify(sm));

    ok(money() === before, "no document, acceptance, payment report, cash row, journal or commission row was touched");
  } catch (e) { ok(false, "the run threw", String(e?.stack ?? e).slice(0, 500)); }
  globalThis.Date = RealDate;
  return out;
}

let n = 0, fail = 0;
const report = (res, tag = "") => { for (const [p, m] of res) { n++; if (!p) { fail++; console.error(`FAIL ${tag}${m}`); } } };

/* ---- source rules ---- */
const pl = read("worker/src/deals.ts"), mig = read("worker/migrations/0227_sales_pipeline.sql"), ui = read("components/portal/sales-pipeline.tsx"), perm = read("worker/src/permissions.ts");
const s = (c, m) => report([[c, m]]);
s(!/\b(UPDATE|DELETE|INSERT INTO)\b[^;`]*\b(sales_documents|quotation_acceptances|invoice_payment_reports|cash_book|commission_ledger|journal_entries|invoice_paid_confirmations)\b/i.test(pl), "deals.ts never writes a document, an acceptance, a payment report, the cash book, the journal or commission");
s(!/^\s*(UPDATE|DELETE|DROP|ALTER TABLE \w+ (RENAME|DROP))/im.test(mig.replace(/--.*$/gm, "").replace(/BEGIN SELECT RAISE[^;]*;\s*END;/g, "")), "0227 is additive: no UPDATE, DELETE, DROP or rename");
s(/pipeline_override: \["ceo", "coo", "cco"\],/.test(perm) && /key: "pipeline_override"/.test(perm), "pipeline_override is the CEO, COO and CCO, and it is in the action catalogue");
s(/not revenue/i.test(ui) && /Won records the decision only/.test(ui), "the screen says Won and the pipeline value are not revenue");
s(!/fmtRM\([^)]*price/i.test(ui), "the pipeline never shows a package price");

const dir = mkdtempSync(join(tmpdir(), "pipeline-"));
const main = join(dir, "worker.mjs");
bundle(root, main);
report(await runtime(main, join(root, "worker/migrations")));
const checks = n;

/* ---- deliberate breakages: each must be caught ---- */
const MUTANTS = [
  ["Won without evidence for anyone", "worker/src/deals.ts", "if (!override) return err(\"no_evidence\"", "if (false) return err(\"no_evidence\""],
  ["an acceptance of any revision counts", "worker/src/deals.ts", "a.revision = COALESCE(d.revision, 0)) AS accepted,\n            EXISTS", "1 = 1) AS accepted,\n            EXISTS"],
  ["a void invoice counts", "worker/src/deals.ts", "COALESCE(i.payment_status, '') != 'void' AND i.voided_at IS NULL) AS invoiced", "1 = 1) AS invoiced"],
  ["a stale write is accepted", "worker/src/deals.ts", "WHERE id = ? AND version = ?`).bind(...binds, id, v)", "WHERE id = ? AND (version = ? OR 1 = 1)`).bind(...binds, id, v)"],
  ["a refused move still writes history", "worker/src/deals.ts", "SELECT ?1, ?2, ?3, ?4, ?5, ?6 WHERE EXISTS (SELECT 1 FROM sales_opportunities WHERE id = ?1 AND version = ?7)`)", "SELECT ?1, ?2, ?3, ?4, ?5, ?6 WHERE ?7 IS NOT NULL`)"],
  ["anyone with Sales changes any deal", "worker/src/deals.ts", "const mayEdit = manager || cur.owner_id === user.id", "const mayEdit = true || cur.owner_id === user.id"],
  ["the value adds the estimate", "lib/pipeline-words.ts", "return { cents: latest.total_cents, basis", "return { cents: latest.total_cents + (est ?? 0), basis"],
  ["a quotation on two deals", "worker/migrations/0227_sales_pipeline.sql", "CREATE UNIQUE INDEX IF NOT EXISTS ux_opportunity_quotations_live", "CREATE INDEX IF NOT EXISTS ux_opportunity_quotations_live"],
  ["Lost with any reason", "worker/src/deals.ts", "if (!(LOST_REASONS as readonly string[]).includes(reason))", "if (false)"],
  ["a linked quotation is suggested again", "worker/src/deals.ts", "        AND NOT EXISTS (SELECT 1 FROM opportunity_quotations l WHERE l.doc_id = d.id AND l.unlinked_at IS NULL)\n      ORDER BY d.created_at DESC LIMIT 500", "      ORDER BY d.created_at DESC LIMIT 500"],
  ["an invoiced quotation made an open deal", "worker/src/deals.ts", `const stage = kind === "invoiced" ? "won" :`, `const stage = kind === "invoiced" ? "proposal" :`],
  ["a void quotation offered", "worker/src/deals.ts", "WHERE d.doc_type = 'QT' AND d.voided_at IS NULL AND", "WHERE d.doc_type = 'QT' AND"],
  ["the live host owns a linked deal", "worker/src/deals.ts", "const owner_id = r.salesperson_id && people.has(r.salesperson_id) ?", "const owner_id = r.salesperson_id ?"],
  ["anyone reopens", "worker/src/deals.ts", "act === \"reopen\" ? !override", "act === \"reopen\" ? false"],
  ["a deal is listed twice with its quotation", "worker/src/sales-today.ts", "      for (let k = items.length - 1; k >= 0; k--) if (items[k]!.kind === \"quotation\" && items[k]!.flag === \"no_next\" && docs.includes(items[k]!.doc_id ?? -1)) items.splice(k, 1);\n", ""],
  ["the super admin overrides", "worker/src/permissions.ts", "pipeline_override: [\"ceo\", \"coo\", \"cco\"],", "pipeline_override: [\"super_admin\", \"ceo\", \"coo\", \"cco\"],"],
  ["a consultant gives a deal away", "worker/src/deals.ts", "if (owner !== user.id && !manager) return err(\"forbidden\"", "if (false) return err(\"forbidden\""],
];
let caught = 0;
for (const [name, file, from, to] of MUTANTS) {
  const m = mkdtempSync(join(tmpdir(), "pipeline-m-"));
  cpSync(join(root, "worker"), join(m, "worker"), { recursive: true });
  cpSync(join(root, "lib"), join(m, "lib"), { recursive: true });
  cpSync(join(root, "package.json"), join(m, "package.json"));
  const body = readFileSync(join(m, file), "utf8");
  if (!body.includes(from)) { report([[false, `mutation "${name}" no longer applies - update the guard`]]); continue; }
  writeFileSync(join(m, file), body.replace(from, to));
  const mb = join(m, "w.mjs");
  const entry = join(m, "e.ts");
  writeFileSync(entry, `export { default } from "./worker/src/index.ts";\n`);
  execSync(`npx esbuild "${entry}" --bundle --format=esm --platform=neutral --outfile="${mb}" --log-level=error`, { cwd: root, stdio: "inherit" });
  const res = await runtime(mb, join(m, "worker/migrations"));
  const failedChecks = res.filter(([p]) => !p).length;
  if (failedChecks > 0) caught++; else report([[false, `mutation "${name}" was NOT caught`]]);
  rmSync(m, { recursive: true, force: true });
}
rmSync(dir, { recursive: true, force: true });
if (fail) { console.error(`pipeline: ${fail} of ${n} failed`); process.exit(1); }
console.log(`PASS - sales pipeline: deals apart from the money, value counted once, Won only on an acceptance of the current revision, a live invoice or a reasoned override (CEO, COO, CCO), Lost with a reason, suggested deals confirmed once, never listed twice in the Action Center (${checks} checks, ${caught}/${MUTANTS.length} mutations caught)`);
