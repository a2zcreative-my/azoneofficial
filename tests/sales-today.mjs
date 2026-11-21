/* v1.397.0 - SALES COMMAND CENTER, PHASE 1 (the CEO, 21-11-2026: "Build Phase 1 - approved
 * for local development and testing"). The Daily Action Center's one list behind Sales >
 * Overview, the Desk's one Sales line and the Dashboard's line. Runtime guard on the
 * tasks-gate4 harness: the WHOLE worker bundled against SQLite with every migration, by
 * direct request as each role, then the same run against deliberately broken copies.
 *
 *   - GET /sales/today writes nothing (every row of every table hashed before and after)
 *   - an old quotation is never "overdue": overdue means a follow-up date has passed
 *   - a quotation or invoice with nothing booked next is "No next action"; one with a
 *     follow-up booked for later is planned and not listed
 *   - mine / everyone as today: a consultant's "everyone" never shows another person's
 *     quotations (GET /sales/week/opportunities' rule); a manager's does
 *   - the order: overdue first (longest late first), then the rest; no-next by value
 *   - done today = only the viewer's own records of today: never someone else's, never
 *     yesterday's, never because a record was opened
 *   - the Desk shows ONE Sales line whose count is the Action Center's count; no follow-up
 *     or growth rows for Sales staff; Marketing keeps its growth pick-up rows
 *   - the team table is managers only and uses the weekly engine's own figures
 *   - agents, customers and roles without Sales are refused
 *
 *   node tests/sales-today.mjs
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
  const entry = join(srcRoot, "sales-today-entry.ts");
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
    DB: { prepare: shim, batch: async (list) => { db.exec("BEGIN"); try { for (const s of list) s._run(); db.exec("COMMIT"); } catch (e) { db.exec("ROLLBACK"); throw e; } return []; } },
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
  for (let c = 1; c <= 9; c++) db.exec(`INSERT INTO customers (id, company, contact_person, phone, created_by) VALUES (${c}, 'Client ${c} Sdn Bhd', 'Contact ${c}', '01234567${c}0', 5)`);
  const doc = db.prepare(`INSERT INTO sales_documents (id, doc_type, doc_number, customer_id, items, discount_cents, tax_percent, total_cents, payment_status, created_at, created_by, salesperson_id, kind, issuer_code, valid_until, converted_from)
                          VALUES (?, ?, ?, ?, '[]', 0, 0, ?, ?, ?, ?, ?, 'service', 'a2z', ?, ?)`);
  //        id   type  number      cust total   status    created                 by sp  valid_until   from
  doc.run(201, "QT", "QT-T-201", 1, 500000, null, "2026-10-01 01:00:00", 5, 5, null, null);   // followed up, overdue (F1)
  doc.run(202, "QT", "QT-T-202", 3, 700000, null, "2026-09-01 01:00:00", 5, 5, null, null);   // OLD, follow-up booked for later (F3): planned
  doc.run(203, "QT", "QT-T-203", 2, 100000, null, "2026-11-02 01:00:00", 5, 5, null, null);   // customer-level follow-up today (F2)
  doc.run(204, "QT", "QT-T-204", 5, 300000, null, "2026-11-01 01:00:00", 5, 5, null, null);   // nothing booked
  doc.run(205, "QT", "QT-T-205", 6, 900000, null, "2026-11-09 01:00:00", 5, 5, null, null);   // nothing booked, larger
  doc.run(206, "QT", "QT-T-206", 7, 400000, null, "2026-10-20 01:00:00", 5, 5, null, null);   // accepted: ready to invoice
  doc.run(207, "QT", "QT-T-207", 9, 200000, null, "2026-11-03 01:00:00", 9, 9, null, null);   // Bakar's, nothing booked
  doc.run(208, "QT", "QT-T-208", 8, 250000, null, "2026-10-05 01:00:00", 5, 5, null, null);   // invoiced (INV 301)
  doc.run(209, "QT", "QT-T-209", 8, 260000, null, "2026-10-01 01:00:00", 5, 5, "2026-11-01", null); // expired
  doc.run(301, "INV", "INV-T-301", 8, 250000, "unpaid", "2026-10-25 01:00:00", 5, 5, null, 208);    // nothing booked
  doc.run(302, "INV", "INV-T-302", 9, 150000, "overdue", "2026-09-20 01:00:00", 5, 5, null, null);  // overdue invoice
  doc.run(303, "INV", "INV-T-303", 9, 120000, "unpaid", "2026-11-01 01:00:00", 5, 5, null, null);   // payment reported: waits on the CEO
  doc.run(304, "INV", "INV-T-304", 9, 110000, "paid", "2026-11-01 01:00:00", 5, 5, null, null);     // paid
  db.exec(`INSERT INTO sales_documents (id, doc_type, doc_number, customer_id, items, discount_cents, tax_percent, total_cents, payment_status, paid_at, created_at, created_by, salesperson_id, kind, issuer_code) VALUES (305, 'INV', 'INV-T-305', 9, '[]', 0, 0, 175000, 'paid', '2026-11-09 03:00:00', '2026-11-02 01:00:00', 5, 5, 'service', 'a2z')`); // paid in full this week: the engine's basis
  doc.run(210, "QT", "QT-T-210", 2, 80000, null, "2026-11-08 01:00:00", 5, 5, null, null);    // next follow-up booked TODAY by Aina (F7)
  db.exec(`INSERT INTO quotation_acceptances (doc_id, revision, accepted_name, accepted_at) VALUES (206, 0, 'Buyer', '2026-11-05 02:00:00')`);
  const fu = db.prepare(`INSERT INTO customer_followups (id, customer_id, due_on, owner_id, note, created_by, created_at, done_at, done_by, outcome, doc_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  fu.run(1, 1, "2026-11-05", 5, "Chase QT-T-201", 5, "2026-11-01 01:00:00", null, null, null, 201);
  fu.run(2, 2, "2026-11-10", 5, "Call back", 5, "2026-11-03 01:00:00", null, null, null, null);
  fu.run(3, 3, "2026-11-20", 5, "After their board meets", 5, "2026-11-03 01:00:00", null, null, null, 202);
  fu.run(4, 1, "2026-11-01", 9, "Bakar's call", 9, "2026-10-25 01:00:00", null, null, null, null);
  fu.run(5, 4, "2026-11-08", null, "Nobody's yet", 3, "2026-11-01 01:00:00", null, null, null, null);
  fu.run(6, 2, "2026-11-09", 5, "Done today by Aina", 5, "2026-11-01 01:00:00", "2026-11-10 02:00:00", 5, "interested", null);
  fu.run(7, 2, "2026-11-15", 5, "Next step booked today", 5, "2026-11-10 01:30:00", null, null, null, 210);
  fu.run(8, 3, "2026-11-09", 9, "Done today by Bakar", 9, "2026-11-01 01:00:00", "2026-11-10 02:10:00", 9, "waiting", null);
  fu.run(9, 4, "2026-11-08", 5, "Done yesterday", 5, "2026-11-01 01:00:00", "2026-11-09 02:00:00", 5, "interested", null);
  const enq = db.prepare(`INSERT INTO enquiries (id, name, company, phone, email, message, status, assigned_to, created_at, replied_at, replied_by) VALUES (?, ?, ?, '0123', 'e@x.test', ?, ?, ?, ?, ?, ?)`);
  enq.run(1, "Siti", "Kedai Siti", "Need a live host", "new", null, "2026-11-08 01:00:00", null, null);       // waited > 24 h
  enq.run(2, "Lim", null, "Package price?", "new", null, "2026-11-10 03:00:00", null, null);                  // new
  enq.run(3, "Raju", "Raju Trading", "Taken by Bakar", "new", 9, "2026-11-10 02:00:00", null, null);
  enq.run(4, "Zack", null, "Contacted", "contacted", 5, "2026-11-05 02:00:00", null, null);
  enq.run(5, "Wong", null, "Answered today", "contacted", 5, "2026-11-09 02:00:00", "2026-11-10 01:00:00", 5);
  const gr = db.prepare(`INSERT INTO business_growth_enquiries (id, ref, client_key, full_name, whatsapp, business_name, industry, city, state, source, challenges, urgent_problem, goal_90d, platforms, interests, contact_time, consent_contact, consent_privacy, privacy_version, consent_at, status, owner_id, picked_at, first_response_at, next_follow_up_on, created_at)
    VALUES (?, ?, ?, 'Owner', '60123', ?, 'food', 'JB', 'Johor', 'tiktok', '[]', 'x', 'x', '[]', '[]', 'any', 1, 1, 'v1', '2026-11-01', ?, ?, ?, ?, ?, ?)`);
  gr.run(1, "A2Z-1011-1", "k1", "Kopi Satu", "new", null, null, null, null, "2026-11-10 03:30:00");                         // unpicked, under 4 h
  gr.run(2, "A2Z-0811-1", "k2", "Roti Dua", "assigned", 5, "2026-11-08 01:00:00", null, null, "2026-11-07 01:00:00");     // mine, no contact for 2 days
  gr.run(3, "A2Z-0511-1", "k3", "Mee Tiga", "follow_up", 5, "2026-11-05 01:00:00", "2026-11-05 02:00:00", "2026-11-10", "2026-11-05 00:00:00"); // follow-up today
  db.exec(`INSERT INTO business_growth_events (enquiry_id, actor_id, kind, body, created_at) VALUES (3, 5, 'contact', 'called', '2026-11-10 01:15:00'), (3, 5, 'picked_up', 'x', '2026-11-10 01:00:00'), (2, 9, 'contact', 'other', '2026-11-10 01:00:00')`);
  db.exec(`INSERT INTO invoice_payment_reports (id, invoice_id, issuer_code, amount_cents, received_on, method, state, reported_by, reported_at) VALUES (1, 303, 'a2z', 120000, '2026-11-10', 'transfer', 'reported', 5, '2026-11-10 02:30:00')`);

  const app = (await import(pathToFileURL(workerBundle).href + `?v=${Math.random()}`)).default;
  const tok = {};
  for (const id of Object.values(U)) { tok[id] = `t-${id}-${Math.random()}`; db.prepare(`INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, datetime('now', '+12 hours'), datetime('now'))`).run(sha(tok[id]), id); }
  const hdr = (uid) => ({ origin: "https://portal.a2z.test", cookie: `azone_session=${tok[uid]}; csrf_token=c1`, "x-csrf-token": "c1", "content-type": "application/json" });
  const call = async (p, uid, method = "GET", body) => {
    const r = await app.fetch(new Request(`https://api.a2z.test/api/v1/staff${p}`, { method, headers: hdr(uid), body: body === undefined ? undefined : JSON.stringify(body) }), env, { waitUntil() {} });
    const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch { /* not json */ }
    return { status: r.status, j, text };
  };
  /* every row of every table, hashed: a read must leave this unchanged */
  const fingerprint = () => {
    const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('sessions', 'rate_limits', 'error_log', 'data_versions') ORDER BY name`).all().map((t) => t.name);
    return sha(tables.map((t) => { try { return `${t}:${JSON.stringify(db.prepare(`SELECT * FROM "${t}"`).all())}`; } catch { return `${t}:-`; } }).join("\n"));
  };
  const keys = (j) => (j?.items ?? []).map((i) => i.key);
  try {
    const before = fingerprint();
    const mine = await call("/sales/today", U.aina);
    ok(mine.status === 200, "a consultant reads the Action Center", mine.text.slice(0, 200));
    const k = keys(mine.j);
    /* what is there, and what is not */
    ok(k.includes("followup:1") && mine.j.items.find((i) => i.key === "followup:1")?.flag === "overdue", "a follow-up whose date has passed is Overdue (red)");
    ok(mine.j.items.find((i) => i.key === "followup:2")?.flag === "today", "a follow-up due today is Due today, not overdue");
    ok(!k.includes("followup:3") && !k.includes("quotation:202"), "an OLD quotation with a follow-up booked for later is planned: not listed, never overdue", k.join(","));
    ok(!mine.j.items.some((i) => i.kind === "quotation" && !["no_next", "ready"].includes(i.flag)), "a quotation is never 'overdue' by age: its words are No next action or Ready");
    ok(mine.j.items.find((i) => i.key === "quotation:204")?.flag === "no_next" && mine.j.items.find((i) => i.key === "quotation:204")?.age_days === 9, "nothing booked next = No next action (amber), its age a separate grey fact (9 days)");
    ok(!k.includes("quotation:203"), "a customer-level follow-up counts as the quotation's next step (said once, on the follow-up)");
    ok(mine.j.items.find((i) => i.key === "quotation:206")?.flag === "ready", "an accepted quotation not yet invoiced is Ready to invoice");
    ok(!k.includes("quotation:208") && !k.includes("quotation:209"), "an invoiced or expired quotation is not an action");
    ok(mine.j.items.find((i) => i.key === "invoice:302")?.flag === "payment_overdue" && mine.j.items.find((i) => i.key === "invoice:301")?.flag === "no_next", "an invoice marked overdue is red; an unpaid one with nothing booked is No next action");
    ok(!k.includes("invoice:303") && !k.includes("invoice:304"), "an invoice with a payment waiting on the CEO, or paid, is not the seller's action");
    ok(k.includes("followup:5") && !k.includes("followup:4") && !k.includes("quotation:207") && !k.includes("enquiry:3"), "mine = mine or nobody's (the Desk's rule); Bakar's records stay his");
    ok(mine.j.items.find((i) => i.key === "enquiry:1")?.flag === "waiting" && mine.j.items.find((i) => i.key === "enquiry:2")?.flag === "new" && !k.includes("enquiry:4") && !k.includes("enquiry:5"), "a website enquiry waiting over 24 h is an overdue reply; a new one is new; an answered one is gone");
    ok(mine.j.items.find((i) => i.key === "growth:1")?.flag === "new" && mine.j.items.find((i) => i.key === "growth:2")?.flag === "waiting" && mine.j.items.find((i) => i.key === "growth:3")?.flag === "today", "the Growth Check's three Desk conditions: unpicked, no contact yet, follow-up due");
    /* the order */
    const firstLate = k.indexOf("followup:1"), nobody = k.indexOf("followup:5");
    ok(firstLate === 0 && nobody > firstLate && nobody < k.indexOf("enquiry:1"), "overdue first, the longest late first", k.slice(0, 5).join(","));
    ok(k.indexOf("quotation:205") < k.indexOf("quotation:204"), "No next action: the larger quotation first");
    ok(k.indexOf("followup:2") > k.indexOf("enquiry:1") && k.indexOf("quotation:205") > k.indexOf("followup:2"), "late before today, today before no-next");
    const late = mine.j.items.filter((i) => ["overdue", "waiting", "payment_overdue"].includes(i.flag)).length;
    ok(mine.j.counts?.overdue === late && mine.j.counts?.total === k.length, "the counts are the list's own", JSON.stringify(mine.j.counts));
    /* done today */
    const done = (mine.j.done ?? []).map((d) => d.key).sort();
    ok(JSON.stringify(done) === JSON.stringify(["enquiry_replied:5", "followup_done:6", "growth_recorded:1", "next_booked:7", "payment_reported:1"].sort()), "done today = only my own records of today", done.join(","));
    ok(!done.some((d) => d === "followup_done:8" || d === "followup_done:9"), "never a colleague's, never yesterday's");
    ok((mine.j.done ?? []).find((d) => d.key === "growth_recorded:1")?.detail === "contact", "picking a Growth Check up is not 'done' - recording the contact is");
    ok(mine.j.progress?.done === 5 && mine.j.progress?.open === k.length, "the progress is done today and still to do", JSON.stringify(mine.j.progress));
    await call("/customers/2/file", U.aina); await call("/customers/1/timeline", U.aina);
    const again = await call("/sales/today", U.aina);
    ok((again.j?.done ?? []).length === 5 && JSON.stringify(keys(again.j)) === JSON.stringify(k), "opening a record completes nothing");
    /* scope */
    const allA = await call("/sales/today?scope=all", U.aina);
    ok(keys(allA.j).includes("followup:4") && !keys(allA.j).includes("quotation:207"), "a consultant's Everyone shows every follow-up but only their own quotations (the opportunities route's rule)");
    ok(allA.j?.team === null, "the team table is not a consultant's");
    const allC = await call("/sales/today?scope=all", U.coo);
    ok(keys(allC.j).includes("quotation:207") && keys(allC.j).includes("followup:4"), "a manager's Everyone shows everyone's", keys(allC.j).join(","));
    const opp = await call("/sales/week/opportunities", U.coo);
    const fromEngine = (opp.j?.rows ?? []).filter((o) => o.acceptance?.current || !o.next).map((o) => o.id).filter((id) => !(allC.j.items ?? []).some((i) => i.kind === "followup" && i.doc_id === id)).sort();
    const fromToday = (allC.j.items ?? []).filter((i) => i.kind === "quotation").map((i) => i.doc_id).sort();
    ok(JSON.stringify(fromEngine) === JSON.stringify(fromToday), "the one-query quotation list equals the weekly engine's open quotations", `${fromEngine} vs ${fromToday}`);
    /* the team */
    ok(Array.isArray(allC.j?.team?.rows) && allC.j.team.rows.some((r) => r.user_id === 5), "a manager gets the team table", JSON.stringify(allC.j?.team)?.slice(0, 200));
    const mineC = await call("/sales/today", U.coo);
    ok(Array.isArray(mineC.j?.team?.rows) && JSON.stringify(mineC.j.team) === JSON.stringify(allC.j.team), "a manager's team table is the same on Mine (it follows the permission, not the list)");
    ok(!keys(mineC.j).includes("quotation:207"), "a manager's Mine shows only their own");
    const wk = await call("/sales/week?scope=all", U.coo);
    const engineAina = (wk.j?.people ?? wk.j?.rows ?? []).find((r) => (r.user_id ?? r.id) === 5);
    const teamAina = allC.j?.team?.rows?.find((r) => r.user_id === 5);
    ok(teamAina && engineAina && Number(engineAina.basis_cents) === teamAina.collected_cents && teamAina.collected_cents === 175000, "the team's collected figure is the weekly engine's basis (RM 1,750.00 paid in full this week)", `${JSON.stringify(engineAina)?.slice(0, 120)} / ${JSON.stringify(teamAina)}`);
    ok(allC.j?.team?.total?.collected_cents === allC.j.team.rows.reduce((t, r) => t + r.collected_cents, 0), "the team total is the sum of its rows");
    ok(teamAina?.quotations >= 1 && teamAina?.followups_done >= 1 && "paid_invoices" in teamAina, "activity and results are separate columns");
    /* the verifier */
    ok((await call("/sales/today?summary=1", U.ceo)).j?.verify === 1 && (await call("/sales/today?summary=1", U.coo)).j?.verify === null, "payments waiting on the CEO: a count for the verifier only (the queue stays in Payments)");
    const sum = await call("/sales/today?summary=1", U.aina);
    ok(JSON.stringify(sum.j?.counts) === JSON.stringify(mine.j.counts) && !("items" in (sum.j ?? {})), "the summary is the same counts, without the list");
    /* the Desk */
    const desk = await call("/desk", U.aina);
    const salesLine = (desk.j?.items ?? []).filter((i) => i.bucket === "sales");
    ok(salesLine.length === 1 && salesLine[0].count === mine.j.counts.total && desk.j.counts?.sales === mine.j.counts.total && desk.j.total === (desk.j.items ?? []).reduce((t, i) => t + (i.count ?? 1), 0), "the Desk shows ONE Sales line, counting exactly the Action Center's actions", JSON.stringify(salesLine));
    ok(salesLine[0]?.overdue === true && salesLine[0]?.title.includes(String(mine.j.counts.total)) && salesLine[0]?.title.includes(`${mine.j.counts.overdue} overdue`), "…saying pending and overdue in words");
    ok(salesLine[0]?.view === "overview" && salesLine[0]?.anchor === "sales-action-center", "…and opening Sales > Overview > My Sales Action Center");
    ok(!(desk.j?.items ?? []).some((i) => i.bucket === "followups" || i.bucket === "growth"), "no follow-up or Growth Check rows for Sales staff - they are in the Action Center");
    const mkt = await call("/desk", U.mkt);
    ok((mkt.j?.items ?? []).some((i) => i.bucket === "growth") && !(mkt.j?.items ?? []).some((i) => i.bucket === "sales"), "Marketing (no Sales access) keeps its Growth Check pick-up rows", JSON.stringify(mkt.j?.items)?.slice(0, 200));
    /* who may read it */
    for (const [who, uid] of [["live host", U.host], ["marketing", U.mkt], ["agent", U.agent]]) {
      ok((await call("/sales/today", uid)).status === 403, `a ${who} is refused`);
    }
    ok((await call("/sales/today", U.aina, "POST", {})).status === 405, "it is read only: anything but GET is refused");
    ok(fingerprint() === before, "the whole run wrote nothing - every table's rows unchanged");
  } catch (e) { ok(false, "the run threw", String(e?.stack ?? e).slice(0, 400)); }
  globalThis.Date = RealDate;
  return out;
}

let n = 0, fail = 0;
const report = (res, tag = "") => { for (const [p, m] of res) { n++; if (!p) { fail++; console.error(`FAIL ${tag}${m}`); } } };

/* ---- source rules ---- */
const src = read("worker/src/sales-today.ts"), desk = read("worker/src/desk.ts"), pri = read("lib/sales-priority.ts");
const s = (c, m) => report([[c, m]]);
s(!/\b(INSERT|UPDATE|DELETE)\b/i.test(src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")), "sales-today.ts holds no INSERT, UPDATE or DELETE");
s(/followupFlag\(f\.due_on, today\)/.test(src) && /dueOn < today \? "overdue"/.test(pri), "overdue is decided in one place, from a follow-up's date");
s(/salesTodayCounts\(env, user\)/.test(desk) && /count: c\.total/.test(desk), "the Desk line counts the Action Center's own list");
s(/growthViewer\(user\) && !canUser\(user, "sales"\)/.test(desk), "growth rows stay on the Desk only for people without Sales");
s(/FLAG_WORD/.test(pri) && /no_next: \["No next action"/.test(pri) && /overdue: \["Overdue follow-up"/.test(pri), "every indicator has words, never colour alone");

const dir = mkdtempSync(join(tmpdir(), "salestoday-"));
const main = join(dir, "worker.mjs");
bundle(root, main);
report(await runtime(main, join(root, "worker/migrations")));
const checks = n;

/* ---- deliberate breakages: each must be caught ---- */
const MUTANTS = [
  ["done counts a colleague's follow-ups", "worker/src/sales-today.ts", "WHERE f.done_by = ?1 AND", "WHERE (f.done_by = ?1 OR 1 = 1) AND"],
  ["a follow-up due today reads overdue", "lib/sales-priority.ts", 'dueOn < today ? "overdue"', 'dueOn <= today ? "overdue"'],
  ["a consultant's Everyone shows others' quotations", "worker/src/sales-today.ts", "AND (?2 = 1 OR q.salesperson_id = ?3)", "AND (1 = 1 OR q.salesperson_id = ?3)"],
  ["the Desk line forgets what it stands for", "worker/src/desk.ts", "count: c.total,", ""],
  ["the Desk lists follow-up rows again", "worker/src/desk.ts", "growthViewer(user) && !canUser(user, \"sales\")", "growthViewer(user)"],
  ["the route lets anyone in", "worker/src/sales-today.ts", `if (["agent", "customer"].includes(user.role) || !readsSales(user)) return err`, "if (false) return err"],
  ["the route writes", "worker/src/sales-today.ts", "  const counts = actionCounts(items);\n", "  const counts = actionCounts(items);\n  await env.DB.prepare(`UPDATE customer_followups SET note = note || '.' WHERE id = 1`).run();\n"],
  ["a planned quotation is listed as no-next", "worker/src/sales-today.ts", "if (!accepted && q.next_id !== null) continue;", ""],
  ["the team table hides behind Everyone again", "worker/src/sales-today.ts", 'const team = canUser(user, "exec_view")', 'const team = scope === "all" && canUser(user, "exec_view")'],
  ["the team table reaches a consultant", "worker/src/sales-today.ts", 'const team = canUser(user, "exec_view")', 'const team = true'],
];
let caught = 0;
for (const [name, file, from, to] of MUTANTS) {
  const m = mkdtempSync(join(tmpdir(), "salestoday-m-"));
  cpSync(join(root, "worker"), join(m, "worker"), { recursive: true });
  cpSync(join(root, "lib"), join(m, "lib"), { recursive: true });
  cpSync(join(root, "package.json"), join(m, "package.json"));
  const body = readFileSync(join(m, file), "utf8").replace(/\r\n/g, "\n"); // a Windows checkout has CRLF; the mutations are written with \n
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
if (fail) { console.error(`sales-today: ${fail} of ${n} failed`); process.exit(1); }
console.log(`PASS - sales today: one list behind the Action Center, the Desk line and the Dashboard; overdue only by a date; done only by a record; read only (${checks} checks, ${caught}/${MUTANTS.length} mutations caught)`);
