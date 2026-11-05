/* SALES DISCIPLINE, PHASE 1 (v1.262.0) - runtime guard: the WHOLE worker
 * bundled against SQLite with every migration applied, by direct request as
 * each person. Fixed clock: Thursday 05-11-2026, 12:00 MYT.
 *
 * claude/SALES-RECOVERY-AUDIT.md revision 2 (the CEO's "Phase by Phase",
 * 05-11-2026), sec. 12 tests: allocation and reconciliation with no double
 * count and nothing pre-filled; Copy last week audited, no retroactive
 * target; the pace by working days and holidays; confidence "Not enough data"
 * below the thresholds; each advisory rule on real fixtures and silent when
 * not met; the configuration audited; Do it makes one record and a second
 * press reuses it; one follow-up per quotation, nothing marked lost; the
 * commission ledger and payroll untouched; nothing sent to anyone.
 *
 *   node tests/go-live-w.mjs                                  the current worker, then mutations
 *   WORKER_BUNDLE=/path/bundle.mjs node tests/go-live-w.mjs   a given bundle (the 1.261.0 bundle must FAIL)
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
  const entry = join(srcRoot, "golive-w-entry.ts");
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
  /* ONE CLOCK: SQLite's 'now' reads the same fixed clock as the worker (see go-live-k) */
  const realClock = new DatabaseSync(":memory:");
  const pinTs = () => new Date().toISOString().slice(0, 19).replace("T", " ");
  for (const fn of ["datetime", "date", "time", "julianday"]) db.function(fn, { varargs: true }, (...a) => realClock.prepare(`SELECT ${fn}(${(a.length ? a : ["now"]).map(() => "?").join(",")}) AS v`).get(...(a.length ? a : ["now"]).map((x) => (typeof x === "string" && x.toLowerCase() === "now" ? pinTs() : x))).v);
  db.function("strftime", { varargs: true }, (...a) => realClock.prepare(`SELECT strftime(${a.map(() => "?").join(",")}) AS v`).get(...a.map((x, i) => (i > 0 && typeof x === "string" && x.toLowerCase() === "now" ? pinTs() : x))).v);
  for (const f of MIGS) applyFile(db, f);
  const shim = (sql) => { const st = db.prepare(sql); let b = []; const o = {
    bind: (...a) => { b = a.map((x) => (x === undefined ? null : x)); return o; },
    first: async () => st.get(...b) ?? null, all: async () => ({ results: st.all(...b) }),
    run: async () => ({ meta: { changes: Number(st.run(...b).changes) } }), _run: () => st.run(...b) }; return o; };
  const env = {
    DB: { prepare: shim, batch: async (list) => { db.exec("BEGIN"); try { for (const s of list) s._run(); db.exec("COMMIT"); } catch (e) { db.exec("ROLLBACK"); throw e; } return []; } },
    SESSION_PEPPER: "pepper", COMPANY_DOMAIN: "a2z.test", ALLOWED_ORIGINS: "https://portal.a2z.test",
    MEDIA: { put: async () => {}, get: async () => null, head: async () => null, list: async () => ({ objects: [] }), delete: async () => {} },
  };
  if (!globalThis.FixedLengthStream) globalThis.FixedLengthStream = class extends TransformStream { constructor() { super(); } };
  const RealDate = globalThis.Date;
  let fixed = Date.parse("2026-11-05T04:00:00Z"); // Thursday 05-11-2026, 12:00 MYT
  globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [fixed])); } static now() { return fixed; } };
  const code = () => { fixed += 31000; return totpAt(fixed); };
  /* invented people in the production chart's shape (claude/SALES-RECOVERY-AUDIT.md sec. 3) */
  const U = { ceo: 1, sa: 2, coo: 3, cco: 4, aina: 5, hana: 6, lia: 7, tim: 8 };
  db.exec(`INSERT INTO users (id, name, full_name, email, role, is_active, password_hash, totp_enabled, totp_secret, employment_status, base_salary_cents, position, department, reports_to) VALUES
    (1,'Alif','Alif Farhan','alif@a2z.test','ceo',1,'x',1,'${SECRET}','permanent',900000,'Chief Executive Officer','Management',NULL),
    (2,'Root','System Root','root@a2z.test','super_admin',1,'x',1,'${SECRET}','permanent',0,NULL,NULL,NULL),
    (3,'Ops','Ops Lead','ops@a2z.test','coo',1,'x',1,'${SECRET}','permanent',800000,'Chief Operational Officer','Management',1),
    (4,'Cee','Cee Officer','cco@a2z.test','cco',1,'x',1,'${SECRET}','permanent',800000,'Chief Commercial Officer','Management',1),
    (5,'Aina','Aina Designer','aina@a2z.test','sales_marketing',1,'x',1,'${SECRET}','permanent',300000,'Designer','Sales and Marketing',4),
    (6,'Hana','Hana HR','hana@a2z.test','hr_admin',1,'x',1,'${SECRET}','permanent',400000,'Administrative Executive','HR and Admin',4),
    (7,'Lia','Lia Creative','lia@a2z.test','sales_marketing',1,'x',1,'${SECRET}','permanent',300000,'Creative','Sales and Marketing',3),
    (8,'Tim','Tim Seller','tim@a2z.test','sales_marketing',1,'x',1,'${SECRET}','permanent',300000,'Sales Executive','Sales and Marketing',3)`);
  const cust = ["Kedai Satu", "Firma Dua", "Firma Tiga", "Syarikat Empat", "Niaga Lima", "Pelanggan Enam", "Gerai Tujuh", "Kedai Lapan", "Butik Sembilan", "Studio Sepuluh", "Kilang Sebelas"];
  cust.forEach((c, i) => db.prepare(`INSERT INTO customers (id, company, phone, created_by, created_at) VALUES (?, ?, '0123', 4, '2026-07-01 00:00:00')`).run(i + 1, c));
  const doc = (id, type, num, cid, cents, by, created, extra = {}) => {
    const cols = ["id", "doc_type", "doc_number", "customer_id", "items", "total_cents", "salesperson_id", "created_by", "created_at", ...Object.keys(extra)];
    db.prepare(`INSERT INTO sales_documents (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`).run(id, type, num, cid, "[]", cents, by, by, created, ...Object.values(extra));
  };
  /* the five open quotations of the audit's shape, invented amounts kept */
  doc(1, "QT", "QT-1", 1, 100000, U.cco, "2026-08-11 02:00:00");                    // 86 days old
  doc(2, "QT", "QT-2", 2, 50000, U.cco, "2026-10-17 02:00:00");                     // 19 days
  doc(3, "QT", "QT-3", 3, 50000, U.cco, "2026-10-17 03:00:00");                     // 19 days
  doc(4, "QT", "QT-4", 4, 120000, U.coo, "2026-10-20 02:00:00");                    // 16 days
  doc(5, "QT", "QT-5", 5, 200000, U.coo, "2026-10-21 02:00:00", { issuer_code: "AZONE" }); // 15 days
  doc(6, "QT", "QT-6", 6, 80000, U.coo, "2026-11-03 02:00:00");                     // 2 days, a follow-up from before 0172 is open
  doc(7, "QT", "QT-7", 7, 146000, U.coo, "2026-10-20 03:00:00");                    // converted and paid
  doc(8, "QT", "QT-8", 8, 30000, U.cco, "2026-11-04 02:00:00");                     // its invoice was voided -> open again
  doc(9, "QT", "QT-9", 9, 99000, U.cco, "2026-10-01 02:00:00", { voided_at: "2026-10-02 00:00:00" }); // void: never open
  doc(10, "QT", "QT-10", 10, 60000, U.tim, "2026-10-01 02:00:00");                  // Tim's, 35 days
  doc(21, "INV", "INV-21", 7, 146000, U.coo, "2026-10-27 02:00:00", { converted_from: 7, payment_status: "paid", paid_at: "2026-10-28 02:00:00" });  // the best week, 26-10
  doc(22, "INV", "INV-22", 11, 58750, U.cco, "2026-10-19 02:00:00", { payment_status: "paid", paid_at: "2026-10-20 02:00:00" });
  doc(23, "INV", "INV-23", 8, 30000, U.cco, "2026-11-04 03:00:00", { converted_from: 8, payment_status: "void", voided_at: "2026-11-04 04:00:00" });
  doc(24, "INV", "INV-24", 9, 15000, U.cco, "2026-10-10 02:00:00", { payment_status: "unpaid" });                          // no due date, 26 days
  doc(25, "INV", "INV-25", 11, 40000, U.coo, "2026-11-03 02:00:00", { payment_status: "unpaid", due_date: "2026-11-30" }); // invoiced this week, not late
  db.exec(`INSERT INTO sales_week_targets (scope, user_id, week_from, target_cents, reason, set_by, metric) VALUES ('company', NULL, '2026-11-02', 700000, 'Weekly company target', 1, 'revenue')`);
  db.exec(`INSERT INTO customer_followups (id, customer_id, due_on, owner_id, note, created_by) VALUES (90, 6, '2026-11-06', 3, 'Call about the package', 3)`); // from before 0172
  db.exec(`INSERT INTO tasks (id, title, assigned_to, created_by, deadline, link_kind, link_id) VALUES (70, 'Deliver the QT-5 artwork', 7, 3, '2026-11-01', 'quotation', 5)`);
  const mod = (await import(pathToFileURL(workerBundle).href + `?v=${Math.random()}`));
  const app = mod.default;
  const tok = {};
  const session = (id) => { tok[id] = `t-${id}-${Math.random()}`; db.prepare(`INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, datetime('now', '+30 days'), datetime('now'))`).run(sha(tok[id]), id); };
  for (const id of Object.values(U)) session(id);
  const call = async (path, uid, method = "GET", body) => {
    const h = { origin: "https://portal.a2z.test", cookie: `azone_session=${tok[uid]}; csrf_token=c1`, "x-csrf-token": "c1", "content-type": "application/json" };
    const r = await app.fetch(new Request(`https://api.a2z.test/api/v1/staff${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }), env, { waitUntil() {} });
    const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch { /* not json */ }
    return { status: r.status, j, text };
  };
  const one = (sql, ...a) => db.prepare(sql).get(...a);
  const n = (sql, ...a) => Number(db.prepare(sql).get(...a)?.n ?? 0);
  const all = (sql, ...a) => db.prepare(sql).all(...a);
  const hashOf = (sql) => { try { return sha(JSON.stringify(db.prepare(sql).all())); } catch { return "none"; } };
  const docs0 = hashOf(`SELECT * FROM sales_documents ORDER BY id`);
  const money = () => sha(["commission_ledger", "commission_entries", "commission_attributions", "payroll_entries"].map((t) => hashOf(`SELECT * FROM ${t} ORDER BY rowid`)).join());
  const money0 = money();
  const told0 = n(`SELECT COUNT(*) AS n FROM notifications`) + n(`SELECT COUNT(*) AS n FROM mail_outbox`);
  const dash = (uid) => call(`/sales/week/dashboard`, uid);
  const advice = async (uid) => (await call(`/sales/week/advisory`, uid)).j;
  const keys = (a) => (a?.cards ?? []).map((c) => c.key).sort().join(" ");
  const act = (uid, key) => call(`/sales/week/advisory/act`, uid, "POST", { key });
  const done = (id, uid, body) => call(`/followups/${id}/done`, uid, "POST", body);
  try {
    /* ---------- 0172: additive, the old row still reads ---------- */
    ok(one(`SELECT doc_id, outcome, obstacle FROM customer_followups WHERE id = 90`)?.doc_id === null, "0172 adds doc_id, outcome, obstacle - a follow-up from before reads them as empty");
    /* ---------- sec. 4: target, pace, best week, confidence, risk - shown apart ---------- */
    let d = (await dash(U.ceo)).j;
    const o = d?.outlook;
    ok(d?.company?.target_cents === 700000 && o, "the CEO's dashboard carries the command strip beside the target", JSON.stringify(d?.company));
    ok(o?.open_quotations?.cents === 690000 && o?.open_quotations?.n === 8, "open quotations: the five, Tim's, the new one and the one whose invoice was voided - never the void quotation or the paid one", JSON.stringify(o?.open_quotations));
    ok(o?.invoiced?.cents === 40000 && o?.invoiced?.n === 1, "Invoiced this week is its own figure (the voided invoice is not counted) - never shown as Sales booked", JSON.stringify(o?.invoiced));
    ok(o?.days_left === 2 && o?.required_per_day_cents === 350000, "required pace on Thursday: RM7,000 over 2 working days left = RM3,500 per working day, not reduced", JSON.stringify([o?.days_left, o?.required_per_day_cents]));
    ok(o?.best_week?.cents === 146000 && o?.best_week?.from === "2026-10-26", "the best week on record is the best FINISHED week of Collected (RM1,460, week of 26-10)", JSON.stringify(o?.best_week));
    ok(o?.confidence?.level === "not_enough_data" && o.confidence.target_weeks === 0 && o.confidence.decided_quotations === 1, "forecast confidence reads Not enough data below 8 target weeks and 20 decided quotations", JSON.stringify(o?.confidence));
    ok(o?.risk?.level === "high" && o.risk.ratio === 0.99 && o.risk.reasons.join() === "pipeline_low,ageing_quotations,gap_above_best_week" && o.followups_scheduled === 1, "sales recovery risk is High, with its evidence: the pipeline covers 0.99x the gap, quotations going cold, the gap above the best week (one follow-up is scheduled - the one from before 0172 counts)", JSON.stringify([o?.risk, o?.followups_scheduled]));
    ok(d?.company?.target_cents === 700000 && n(`SELECT COUNT(*) AS n FROM sales_week_targets`) === 1, "the CEO's target is never changed by the system");
    const wk = (await call(`/sales/week?scope=all`, U.coo)).j;
    ok(wk?.outlook?.required_per_day_cents === 350000, "Sales -> the team's week shows the same pace (one engine)");
    /* ---------- privacy: the strip is management's, a seller sees their own ---------- */
    const da = (await dash(U.aina)).j, dh = (await dash(U.hana)).j, dt = (await dash(U.tim)).j;
    ok(da?.outlook === null && dh?.outlook === null && dt?.outlook === null, "a designer, HR and a seller do not get the command strip");
    ok(!/Kedai Satu|Firma Dua|Niaga Lima/.test(JSON.stringify(da) + JSON.stringify(dh) + JSON.stringify(dt)), "no other closer's customer reaches them - not in advice, not in opportunities");
    ok(dt?.opportunities?.map((x) => x.doc_number).join() === "QT-10" && dt?.advisory?.cards?.map((c) => c.key).join() === "qt:10", "Tim sees his own quotation and his own advice only", JSON.stringify([dt?.opportunities?.length, dt?.advisory?.cards?.map((c) => c.key)]));
    ok(dt?.me?.kind === "operational" && da?.me?.kind === "operational" && typeof dt?.me?.followups_today === "number", "My week: the kind of target held (none set yet: operational) and my follow-ups due");
    ok((await call(`/sales/week/allocation`, U.aina)).status === 403 && (await call(`/sales/week/allocation`, U.hana)).status === 403, "the allocation is management's to read");
    /* ---------- sec. 6: the advisory, on the records ---------- */
    let a = await advice(U.ceo);
    ok(keys(a) === "inv:24 late:7 pipe:company qt:1 qt:10 qt:2 qt:3 qt:4 qt:5", "the advice: QT-1 very old, four going cold and Tim's, the invoice with no due date past 14 days, the company pipeline, the late delivery task", keys(a));
    const c1 = a.cards.find((c) => c.key === "qt:1"), ci = a.cards.find((c) => c.key === "inv:24"), cp = a.cards.find((c) => c.key === "pipe:company");
    ok(c1?.rule === "qt_very_old" && c1.severity === "critical" && c1.evidence.age_days === 86 && c1.owner.id === U.cco && c1.due_on === "2026-11-06" && c1.action === "followup", "each card names its evidence, record, owner, action and a due day (QT-1: 86 days, the CCO, the next working day)", JSON.stringify(c1));
    ok(ci?.evidence?.fallback === true && ci.evidence.days_late === 12 && a.cards.every((c) => c.key !== "inv:25"), "an invoice with no due date is late 14 days after issue (12 days late); one due on 30-11 is not", JSON.stringify(ci?.evidence));
    ok(cp?.evidence?.ratio === 0.99 && cp.action === "allocate" && a.cards[0].severity === "critical", "the company's thin pipeline is management's, worst first", JSON.stringify(cp));
    ok(!keys(a).includes("qt:6") && !keys(a).includes("qt:8") && !keys(a).includes("qt:9"), "silent when not met: a 2-day quotation with a follow-up, yesterday's, a void one");
    ok(a.inactive?.map((x) => x.rule).join() === "low_conversion,margin_risk", "low conversion and margin are not active - no data");
    ok(d?.advisory?.cards?.length === 5 && d.advisory.total === 9, "the Dashboard shows the worst five of nine");
    /* ---------- Do it: one record, a second press reuses it ---------- */
    ok((await act(U.aina, "qt:2")).status === 403 && (await act(U.tim, "qt:1")).status === 403, "13: a designer, or another closer, cannot act on someone else's quotation");
    ok((await act(U.ceo, "pipe:company")).status === 400 && (await act(U.ceo, "nonsense")).status === 400, "advice with no record to make (the company line) only opens a screen");
    const t1 = await act(U.tim, "qt:10");
    const f10 = one(`SELECT * FROM customer_followups WHERE doc_id = 10`);
    ok(t1.status === 201 && t1.j?.kind === "followup" && f10?.owner_id === U.tim && f10.due_on === "2026-11-06" && f10.customer_id === 10, "Tim presses Do it: ONE follow-up, linked to QT-10, his, due the next working day", t1.text.slice(0, 200));
    const t2 = await act(U.tim, "qt:10");
    ok(t2.j?.existing === true && t2.j.id === f10.id && n(`SELECT COUNT(*) AS n FROM customer_followups WHERE doc_id = 10`) === 1, "a second press returns the same follow-up - no duplicate");
    ok(!keys(await advice(U.tim)).includes("qt:10"), "...and the card leaves: the quotation is in hand");
    const c1a = await act(U.ceo, "qt:1");
    ok(c1a.status === 201 && one(`SELECT owner_id FROM customer_followups WHERE doc_id = 1`)?.owner_id === U.cco, "the CEO presses it for QT-1: the follow-up goes to its closer, the CCO");
    ok((await act(U.ceo, "inv:24")).status === 201 && one(`SELECT note FROM customer_followups WHERE doc_id = 24`)?.note.startsWith("Collection"), "an unpaid invoice gets one collection follow-up");
    ok(n(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'sales.advisory_act'`) === 3, "every press that made a record is audited");
    let dup = false; try { db.exec(`INSERT INTO customer_followups (customer_id, due_on, owner_id, note, doc_id) VALUES (1, '2026-11-09', 4, 'again', 1)`); } catch { dup = true; }
    ok(dup, "the database itself refuses a second OPEN follow-up on one document (0172 partial unique index)");
    const again = await call(`/customers/1/followups`, U.cco, "POST", { due_on: "2026-11-10", note: "Another one", doc_id: 1 });
    ok(again.status === 200 && again.j?.existing === true, "Sales -> the client file: a follow-up on a document already followed up returns the open one", again.text.slice(0, 160));
    ok((await call(`/customers/1/followups`, U.cco, "POST", { due_on: "2026-11-10", note: "Wrong doc", doc_id: 2 })).status === 400, "a document of another customer is refused");
    /* ---------- the owner records what the customer said ---------- */
    const f1 = one(`SELECT id FROM customer_followups WHERE doc_id = 1`).id;
    ok((await done(f1, U.cco, {})).status === 400 && (await done(f1, U.cco, { outcome: "maybe" })).status === 400, "closing a follow-up on a quotation needs an outcome from the list");
    ok((await done(f1, U.cco, { outcome: "lost" })).status === 400, "lost needs the reason");
    const lost = await done(f1, U.cco, { outcome: "lost", obstacle: "Budget moved to next year", note: "Called the owner" });
    ok(lost.j?.ok && one(`SELECT outcome, obstacle, done_by FROM customer_followups WHERE id = ?`, f1)?.obstacle === "Budget moved to next year", "the CCO records lost, with the reason", lost.text.slice(0, 160));
    const opp = (await call(`/sales/week/opportunities`, U.ceo)).j;
    const q1 = opp?.rows?.find((r) => r.id === 1);
    ok(q1 && q1.last_contact?.outcome === "lost" && q1.last_contact.obstacle === "Budget moved to next year", "nothing is marked lost by itself: QT-1 is still an open quotation, with the owner's word beside it");
    ok(!keys(await advice(U.ceo)).includes("qt:1"), "...and the advice stops asking about it");
    const ft = one(`SELECT id FROM customer_followups WHERE doc_id = 10`).id;
    const acc = await done(ft, U.tim, { outcome: "accepted" });
    ok(acc.j?.next === "record_acceptance" && n(`SELECT COUNT(*) AS n FROM quotation_acceptances`) === 0, "accepted points to the existing acceptance record - none is invented");
    const fi = one(`SELECT id FROM customer_followups WHERE doc_id = 24`).id;
    ok((await done(fi, U.cco, { outcome: "interested" })).status === 400 && (await done(fi, U.cco, { outcome: "promised", note: "Pays Friday" })).j?.ok === true, "an invoice's outcomes are its own (promised, paid, disputed, no response)");
    ok((await done(90, U.coo, {})).j?.ok === true, "a follow-up from before 0172 still closes the old way");
    ok(opp?.rows?.length === 8 && opp.rows[0].last_contact?.outcome == null, "opportunities: every open quotation, those with no outcome yet first");
    /* ---------- D3: the settings, authorised and audited ---------- */
    ok((await call(`/sales/week/advisory/settings`, U.cco, "PUT", { quote_age_days: 20, reason: "Longer sales cycle" })).status === 403, "the CCO reads but does not change the advisory");
    ok((await call(`/sales/week/advisory/settings`, U.coo, "PUT", { quote_age_days: 20 })).status === 400, "...a change needs a reason");
    ok((await call(`/sales/week/advisory/settings`, U.coo, "PUT", { quote_age_days: 0, reason: "Testing the range" })).status === 400, "...and a value in range");
    ok((await call(`/sales/week/advisory/settings`, U.coo, "PUT", { package_days: { 999: 7 }, reason: "A package that is not there" })).status === 404, "...a package interval names a real package");
    const sv = await call(`/sales/week/advisory/settings`, U.ceo, "PUT", { quote_age_days: 20, reason: "Corporate buyers take three weeks" });
    ok(sv.j?.settings?.quote_age_days === 20 && n(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'sales.advisory_settings'`) === 1, "the CEO changes it; the audit keeps before and after");
    ok(JSON.parse(one(`SELECT detail FROM audit_log WHERE action = 'sales.advisory_settings'`)?.detail ?? "{}").before?.quote_age_days === 14, "...the previous value is in the audit");
    ok(!keys(await advice(U.ceo)).match(/qt:[2-5]\b/), "with 20 days, the 15-19 day quotations are no longer going cold", keys(await advice(U.ceo)));
    /* ---------- D1: the allocation and its reconciliation ---------- */
    let al = (await call(`/sales/week/allocation`, U.ceo)).j;
    ok(al?.company?.target_cents === 700000 && al.unallocated_cents === 700000 && al.people.every((p) => p.target_cents === null), "nothing is split or pre-filled: every person reads none, all RM7,000 is Unallocated (management)");
    const pc = (id) => al.people.find((p) => p.id === id);
    ok(pc(U.coo)?.suggested === "revenue" && pc(U.cco)?.suggested === "revenue" && pc(U.aina)?.suggested === "contribution" && pc(U.hana)?.suggested === "operational" && pc(U.ceo)?.holds_unallocated, "the records suggest: the COO and CCO close (revenue), the designer contributes, HR is operational, the CEO holds the unallocated line", JSON.stringify(al.people.map((p) => [p.name, p.suggested])));
    const setT = (uid, cents, week = "2026-11-02") => call(`/sales/week/targets`, U.ceo, "POST", { scope: "person", user_id: uid, week_from: week, target_cents: cents, reason: "Weekly allocation by the CEO" });
    await setT(U.coo, 300000); await setT(U.cco, 250000);
    al = (await call(`/sales/week/allocation`, U.ceo)).j;
    ok(al.revenue_sum_cents === 550000 && al.unallocated_cents === 150000 && !al.over_allocated && pc(U.coo)?.kind === "revenue", "company RM7,000 = COO RM3,000 + CCO RM2,500 + Unallocated RM1,500", JSON.stringify([al.revenue_sum_cents, al.unallocated_cents]));
    await setT(U.tim, 300000);
    al = (await call(`/sales/week/allocation`, U.ceo)).j;
    ok(al.over_allocated === true && al.unallocated_cents === -150000, "over-allocation is shown, never blocked");
    await call(`/sales/week/targets`, U.ceo, "POST", { scope: "person", user_id: U.aina, week_from: "2026-11-02", metric: "introductions", target_count: 2, reason: "Two verified introductions a week" });
    const a2 = await advice(U.ceo);
    ok(a2.cards.some((c) => c.key === "pipe:3") && a2.cards.some((c) => c.key === "idle:5") && !a2.cards.some((c) => c.key === "idle:4"), "with targets set: the COO's thin pipeline; mid-week the designer with a goal has no activity yet - the CCO, who recorded outcomes, is not flagged", keys(a2));
    ok((await dash(U.aina)).j?.me?.kind === "contribution", "...and her My week says she holds a contribution goal");
    const tk = await act(U.coo, "pipe:3");
    const tk2 = await act(U.coo, "pipe:3");
    ok(tk.status === 201 && tk2.j?.existing === true && tk2.j.id === tk.j.id && n(`SELECT COUNT(*) AS n FROM tasks WHERE link_kind = 'advisory'`) === 1, "low pipeline: ONE task for the week, a second press returns it");
    ok((await act(U.aina, "pipe:3")).status === 403, "...and only the person or a manager makes it");
    /* ---------- Copy last week ---------- */
    ok((await call(`/sales/week/targets/copy`, U.cco, "POST", { week_from: "2026-11-09", dry_run: true })).status === 403, "only the CEO, COO or super admin copies targets");
    ok((await call(`/sales/week/targets/copy`, U.ceo, "POST", { week_from: "2026-10-26", reason: "Back-dating the targets" })).status === 409, "no retroactive target: a finished week keeps its own");
    ok((await call(`/sales/week/targets/copy`, U.ceo, "POST", { week_from: "2026-11-04", dry_run: true })).status === 400, "a copy names the first day of a week");
    let cp1 = (await call(`/sales/week/targets/copy`, U.ceo, "POST", { week_from: "2026-11-09", dry_run: true })).j;
    ok(cp1?.changes?.length === 0, "targets carry forward, so next week already holds this week's - nothing to copy, nothing written");
    await setT(U.cco, 10000, "2026-11-09");
    cp1 = (await call(`/sales/week/targets/copy`, U.ceo, "POST", { week_from: "2026-11-09", dry_run: true })).j;
    const rows0 = n(`SELECT COUNT(*) AS n FROM sales_week_targets`);
    ok(cp1?.changes?.length === 1 && cp1.changes[0].user_id === U.cco && cp1.changes[0].to_value === 250000 && cp1.changes[0].from_value === 10000, "a dry run lists the one row that differs (the CCO's next week) and writes nothing", JSON.stringify(cp1?.changes));
    ok((await call(`/sales/week/targets/copy`, U.ceo, "POST", { week_from: "2026-11-09" })).status === 400, "the copy needs a reason");
    const cpw = await call(`/sales/week/targets/copy`, U.ceo, "POST", { week_from: "2026-11-09", reason: "Same allocation as this week" });
    ok(cpw.status === 201 && n(`SELECT COUNT(*) AS n FROM sales_week_targets`) === rows0 + 1 && n(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'sales.week_target_copy'`) === 1, "the copy writes one new row with the reason, audited; the old rows stay", cpw.text.slice(0, 160));
    ok(one(`SELECT reason FROM sales_week_targets ORDER BY id DESC LIMIT 1`)?.reason.startsWith("Copied from the week of 2026-11-02"), "...and says where it came from");
    /* ---------- the pace counts the company calendar ---------- */
    db.exec(`INSERT INTO holidays (holiday_date, name) VALUES ('2026-11-06', 'Public holiday')`);
    const o2 = (await dash(U.ceo)).j?.outlook;
    ok(o2?.days_left === 1 && o2.required_per_day_cents === 700000, "a public holiday on Friday: 1 working day left, the whole gap per day", JSON.stringify([o2?.days_left, o2?.required_per_day_cents]));
    ok((await act(U.cco, "qt:2")).status === 409, "with the 20-day setting, QT-2 is not going cold: Do it answers that the advice no longer applies");
    db.exec(`UPDATE business_settings SET value = '{"quote_age_days":14}' WHERE key = 'sales_advisory'`);
    const c2 = await act(U.cco, "qt:2");
    ok(c2.status === 201 && one(`SELECT due_on FROM customer_followups WHERE doc_id = 2`)?.due_on === "2026-11-10", "the next working day skips Friday's holiday, the weekend and the seeded Deepavali replacement holiday (Monday 09-11): Tuesday 10-11", c2.text.slice(0, 160) + JSON.stringify(all(`SELECT id, doc_id, due_on FROM customer_followups WHERE doc_id = 2`)));
    /* ---------- confidence, once there is history ---------- */
    db.exec(`INSERT INTO sales_week_targets (scope, user_id, week_from, target_cents, reason, set_by, metric, created_at) VALUES ('company', NULL, '2026-09-07', 50000, 'An earlier target', 1, 'revenue', '2026-09-01 00:00:00')`);
    for (let i = 0; i < 20; i++) { doc(100 + i, "QT", `QT-H${i}`, 11, 1000, U.coo, "2026-09-20 02:00:00"); doc(200 + i, "INV", `INV-H${i}`, 11, 3000, U.coo, "2026-09-21 02:00:00", { converted_from: 100 + i, payment_status: "paid", paid_at: "2026-09-08 02:00:00" }); }
    const cf = (await dash(U.ceo)).j?.outlook?.confidence;
    ok(cf?.target_weeks === 8 && cf.decided_quotations >= 20 && cf.level === "low" && cf.achieved_weeks === 3, "with 8 target weeks and 20 decided quotations it reports the record: target reached in 3 of 8 weeks (Low) - a count, not a prediction", JSON.stringify(cf));
    /* ---------- nothing else moved ---------- */
    db.exec(`DELETE FROM sales_documents WHERE id >= 100`);
    ok(hashOf(`SELECT * FROM sales_documents ORDER BY id`) === docs0, "no quotation or invoice was changed - no status, no expiry, no void");
    ok(money() === money0, "the commission ledger and payroll are untouched");
    ok(n(`SELECT COUNT(*) AS n FROM notifications`) + n(`SELECT COUNT(*) AS n FROM mail_outbox`) === told0, "no notification or message was sent to anyone - staff or customer");
  } catch (e) {
    out.push([false, `runtime: ${e?.stack ?? e}`]);
  } finally {
    globalThis.Date = RealDate;
  }
  return out;
}

let fail = 0, n = 0;
const report = (list) => { for (const [p, m] of list) { n++; if (!p) { fail++; console.error(`FAIL ${m}`); } } };
const given = process.env.WORKER_BUNDLE;
const dir = mkdtempSync(join(tmpdir(), "golive-w-"));
const main = given ?? join(dir, "worker.mjs");
if (!given) bundle(root, main);
report(await runtime(main));
const checks = n;
if (given || process.env.NOMUT) {
  if (fail) { console.error(`go-live-w: ${fail} of ${n} failed`); process.exit(1); }
  console.log(`go-live-w: ${n} checks passed`); process.exit(0);
}

const MUT = [
  ["worker/src/weekly-sales.ts", "the pace counts the whole week, not the days left", "  return (await workingDays(env, 0, today > from ? today : from, to)).total;", "  return (await workingDays(env, 0, from, to)).total;"],
  ["worker/src/weekly-sales.ts", "a seller sees everyone's advice", "  const mine = scopeAll ? null : uid;", "  const mine = null;"],
  ["worker/src/weekly-sales.ts", "Do it on someone else's quotation", "    if (!mineDoc && !VIEW_ALL(user)) return err(", "    if (false) return err("],
  ["worker/src/weekly-sales.ts", "a finished week's targets are rewritten by a copy", "    if (week < weekStartOf(today, startDow)) return err(\"week_final\", \"A week that has ended keeps its targets.", "    if (false) return err(\"week_final\", \"A week that has ended keeps its targets."],
  ["worker/src/weekly-sales.ts", "the advisory changes without a reason", "    if (reason.length < 8) return err(\"validation\", \"Give a reason of at least 8 characters\", 400);\n    const before = await advisorySettings(env);", "    const before = await advisorySettings(env);"],
  ["worker/src/weekly-sales.ts", "a voided invoice keeps its quotation closed", "i.doc_type = 'INV' AND COALESCE(i.payment_status, '') != 'void')\n        AND (${a}.valid_until", "i.doc_type = 'INV')\n        AND (${a}.valid_until"],
  ["worker/src/weekly-sales.ts", "an invoice with no due date is never late", "      const limit = dueDay ?? addDays(issued, s.invoice_fallback_days);", "      const limit = dueDay ?? \"9999-12-31\";"],
  ["worker/src/weekly-sales.ts", "the allocation pre-fills an equal split", "      target_cents: rev.target_cents, target_from: rev.from,", "      target_cents: rev.target_cents ?? (company.target_cents === null ? null : Math.round(company.target_cents / people.length)), target_from: rev.from,"],
  ["worker/src/weekly-sales.ts", "the command strip reaches every staff member", "  const outlook = allowAll ? await companyOutlook(", "  const outlook = true ? await companyOutlook("],
  ["worker/src/weekly-sales.ts", "confidence is given without enough history", "  const enough = targetWeeks >= 8 && decided >= 20;", "  const enough = true;"],
  ["worker/src/weekly-sales.ts", "the follow-up goes to whoever pressed, not the closer", "    let owner = d.salesperson_id ?? user.id;", "    let owner = user.id;"],
  ["worker/src/weekly-sales.ts", "a very old quotation reads as merely going cold", "    const veryOld = q.age_days > s.very_old_days;", "    const veryOld = false;"],
  ["worker/src/business.ts", "lost without a reason", "      if ((outcome === \"lost\" || outcome === \"disputed\") && (!obstacle || obstacle.length < 3))", "      if (false)"],
  ["worker/src/business.ts", "an outcome changes the quotation", "      await audit(env, user.id, \"customer.followup_done\", \"customer_followups\", String(id), { doc_id: fu.doc_id, outcome, obstacle });", "      if (outcome === \"lost\") await env.DB.prepare(`UPDATE sales_documents SET valid_until = '2026-01-01' WHERE id = ?1`).bind(fu.doc_id).run();\n      await audit(env, user.id, \"customer.followup_done\", \"customer_followups\", String(id), { doc_id: fu.doc_id, outcome, obstacle });"],
];
for (const [file, name, from, to] of MUT) {
  n++;
  const src = readFileSync(join(root, file), "utf8");
  if (!src.includes(from)) { fail++; console.error(`FAIL mutation did not apply: ${name}`); continue; }
  const mdir = mkdtempSync(join(tmpdir(), "golive-w-m-"));
  cpSync(join(root, "worker"), join(mdir, "worker"), { recursive: true, filter: (p) => !p.includes("node_modules") });
  cpSync(join(root, "package.json"), join(mdir, "package.json"));
  for (const d of ["lib", "constants", "types"]) { try { cpSync(join(root, d), join(mdir, d), { recursive: true }); } catch { /* not every folder exists */ } }
  writeFileSync(join(mdir, file), src.replace(from, to));
  try { bundle(mdir, join(mdir, "w.mjs")); } catch { fail++; console.error(`FAIL mutation did not build: ${name}`); continue; }
  const res = await runtime(join(mdir, "w.mjs"));
  const bad = res.filter(([p]) => !p).map(([, m]) => m);
  if (!bad.length) { fail++; console.error(`FAIL mutation not caught: ${name}`); }
  else console.log(`caught: ${name} -> ${bad.slice(0, 2).join("; ")}`);
  rmSync(mdir, { recursive: true, force: true });
}
rmSync(dir, { recursive: true, force: true });
if (fail) { console.error(`go-live-w: ${fail} of ${n} failed`); process.exit(1); }
console.log(`go-live-w: ${checks} checks passed (${MUT.length} mutations caught) - sales discipline (v1.262.0): the target, the pace by working days left, the best week, confidence only with history and risk with its evidence, each apart; the allocation reconciles to the company target with Unallocated, nothing split or pre-filled; Copy last week only where a week differs, never into a finished week; the advice on the records, own only for a seller, configurable with a reason; Do it makes one follow-up or task and a second press returns it; one open follow-up per document; the customer's answer recorded, nothing marked lost; commission, payroll and documents untouched; nothing sent`);
