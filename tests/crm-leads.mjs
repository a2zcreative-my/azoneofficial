/* v1.398.0 - SALES COMMAND CENTER, PHASE 2: LEADS & CRM (the CEO, 21-11-2026: decisions 1-7 and
 * "As recommended" on the six Phase 2 decisions). worker/src/crm.ts + migration 0226. Runtime
 * guard on the tasks-gate4 harness: the WHOLE worker bundled against SQLite with every migration,
 * by direct request as each role, then the same run against deliberately broken copies.
 *
 *   - the three CRM records are append-only (ownership, status, activities)
 *   - only crm_assign (CEO, COO, CCO, super admin) assigns; every change is kept with who and why;
 *     the new owner is told; an owner must be current sales staff; a stale edit is refused
 *   - a status that ends the work needs a reason; Customer is a status staff set, never an invoice
 *   - services come from the Packages library (names only); a source from the list
 *   - an activity happens once (client_key); closing a follow-up writes exactly ONE activity,
 *     cancelling writes none, and Done today never counts it twice
 *   - converting an enquiry or a Growth Check entry runs the duplicate check (name, phone, email),
 *     makes one customer however often it is pressed, or links to the one chosen
 *   - suggested owners: only the server's suggestion is ever set, and only on an unowned customer
 *   - the list is paged and searchable; the Phase 1 list shows an owned lead with nothing booked
 *     next once, never twice
 *   - nothing touches a document, a payment report, a cash row or a commission row
 *   - agents, customers and roles without Sales are refused
 *
 *   node tests/crm-leads.mjs
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
  const entry = join(srcRoot, "crm-leads-entry.ts");
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
  /* customers: 1-30 plain, 31 Walk-in, a few with phone / email to match */
  for (let c = 1; c <= 30; c++) db.exec(`INSERT INTO customers (id, company, contact_person, phone, email, created_by, created_at) VALUES (${c}, 'Client ${String(c).padStart(2, "0")} Sdn Bhd', 'Contact ${c}', '012${String(2000000 + c)}', 'c${c}@client.test', 5, '2026-10-0${(c % 9) + 1} 01:00:00')`);
  db.exec(`INSERT INTO customers (id, company, created_by) VALUES (31, 'Walk-in Customer', 5)`);
  const doc = db.prepare(`INSERT INTO sales_documents (id, doc_type, doc_number, customer_id, items, discount_cents, tax_percent, total_cents, payment_status, created_at, created_by, salesperson_id, kind, issuer_code) VALUES (?, ?, ?, ?, '[]', 0, 0, ?, ?, ?, 5, ?, 'service', 'a2z')`);
  doc.run(401, "QT", "QT-C-401", 1, 100000, null, "2026-10-01 01:00:00", 5);   // customer 1: suggested Aina
  doc.run(402, "INV", "INV-C-402", 1, 100000, "unpaid", "2026-10-05 01:00:00", 9); // ...the LATEST is Bakar's invoice: suggested Bakar
  doc.run(403, "QT", "QT-C-403", 2, 200000, null, "2026-10-02 01:00:00", 5);   // customer 2: Aina
  doc.run(404, "QT", "QT-C-404", 3, 300000, null, "2026-10-03 01:00:00", 7);   // customer 3: the live host - not sales staff, no suggestion
  doc.run(405, "INV", "INV-C-405", 4, 400000, "void", "2026-10-04 01:00:00", 5); // customer 4: void only - no suggestion
  /* v1.408.0 - an open task on a lead is its next action: on the customer (14), on its project (15),
     on its quotation (16); a completed task (17) and a cancelled one (18, completed + stage) are not */
  doc.run(406, "QT", "QT-C-406", 15, 150000, null, "2026-10-06 01:00:00", 5);
  doc.run(407, "QT", "QT-C-407", 16, 160000, null, "2026-10-07 01:00:00", 5);
  db.exec(`INSERT INTO projects (id, quotation_id, customer_id, title, status) VALUES (1, 406, 15, 'Client 15 shoot', 'in_progress')`);
  const tk = db.prepare(`INSERT INTO tasks (id, title, assigned_to, created_by, status, deadline, link_kind, link_id) VALUES (?, ?, 5, 1, ?, ?, ?, ?)`);
  tk.run(901, "Send the brief to Client 14", "open", "2027-01-15", "customer", 14);
  tk.run(902, "Shoot day for Client 15", "in_progress", null, "project", 1);
  tk.run(903, "Chase QT-C-407", "open", "2027-01-20", "quotation", 407);
  tk.run(904, "Old task for Client 17", "completed", "2026-10-01", "customer", 17);
  tk.run(905, "Cancelled task for Client 18", "completed", "2027-01-01", "customer", 18);
  /* v1.412.0 - 904 was closed (its history says when); 905 was cancelled (completed + stage cancelled) */
  db.exec(`UPDATE tasks SET stage = 'cancelled' WHERE id = 905`);
  db.exec(`INSERT INTO task_updates (task_id, author_id, kind, body, created_at) VALUES (904, 5, 'closed', 'Brief sent and confirmed by the client', '2026-11-19 03:00:00')`);
  db.exec(`INSERT INTO sales_packages (id, name, status) VALUES (1, 'Live Selling Starter', 'active'), (2, 'Brand Film', 'archived')`);
  const fu = db.prepare(`INSERT INTO customer_followups (id, customer_id, due_on, owner_id, note, created_by, created_at) VALUES (?, ?, ?, ?, ?, 5, '2026-11-01 01:00:00')`);
  fu.run(1, 5, "2026-11-12", 5, "Call about the starter package");
  fu.run(2, 6, "2026-11-09", 5, "Overdue call");
  fu.run(3, 7, "2026-11-20", 5, "To be cancelled");
  db.exec(`INSERT INTO customer_followups (id, customer_id, due_on, owner_id, note, created_by, created_at, doc_id) VALUES (4, 2, '2026-11-11', 5, 'Ask about QT-C-403', 5, '2026-11-01 01:00:00', 403)`);
  const enq = db.prepare(`INSERT INTO enquiries (id, name, company, phone, email, message, status, assigned_to, created_at) VALUES (?, ?, ?, ?, ?, 'hi', 'new', ?, '2026-11-09 01:00:00')`);
  enq.run(1, "Siti", "Kedai Siti Baru", "0199988877", "siti@new.test", 5);        // new: no duplicate, owner Aina
  enq.run(2, "Ali", "client 03 sdn bhd", "0100000000", "ali@x.test", null);       // same company name as customer 3 (case, spaces)
  enq.run(3, "Ah Kow", "Different Name", "+60 12-200 0004", null, null);         // same phone as customer 4
  enq.run(4, "Mei", "Mei Co", null, "C5@CLIENT.TEST", 7);                         // same email as customer 5; assigned to the live host
  db.exec(`INSERT INTO business_growth_enquiries (id, ref, client_key, full_name, whatsapp, email, business_name, industry, city, state, source, challenges, urgent_problem, goal_90d, platforms, interests, contact_time, consent_contact, consent_privacy, privacy_version, consent_at, status, owner_id, created_at)
    VALUES (1, 'A2Z-0911-1', 'g1', 'Hafiz', '60177770001', NULL, 'Kopi Hafiz', 'food', 'JB', 'Johor', 'tiktok', '[]', 'x', 'x', '[]', '[]', 'any', 1, 1, 'v1', '2026-11-01', 'assigned', 9, '2026-11-09 01:00:00')`);

  const app = (await import(pathToFileURL(workerBundle).href + `?v=${Math.random()}`)).default;
  const tok = {};
  for (const id of Object.values(U)) { tok[id] = `t-${id}-${Math.random()}`; db.prepare(`INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, datetime('now', '+12 hours'), datetime('now'))`).run(sha(tok[id]), id); }
  const hdr = (uid) => ({ origin: "https://portal.a2z.test", cookie: `azone_session=${tok[uid]}; csrf_token=c1`, "x-csrf-token": "c1", "content-type": "application/json" });
  const call = async (p, uid, method = "GET", body) => {
    const r = await app.fetch(new Request(`https://api.a2z.test/api/v1/staff${p}`, { method, headers: hdr(uid), body: body === undefined ? undefined : JSON.stringify(body) }), env, { waitUntil() {} });
    const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch { /* not json */ }
    return { status: r.status, j, text };
  };
  /* money and documents: hashed before and after every CRM write */
  const money = () => sha(["sales_documents", "invoice_payment_reports", "cash_book", "commission_ledger", "invoice_paid_confirmations", "journal_entries"].map((t) => { try { return JSON.stringify(db.prepare(`SELECT * FROM "${t}"`).all()); } catch { return "-"; } }).join("|"));
  const cnt = (sql) => db.prepare(sql).get().n;
  const ver = (id) => db.prepare(`SELECT crm_version AS v FROM customers WHERE id = ?`).get(id).v;
  try {
    const before = money();
    /* the migration */
    const cols = db.prepare(`PRAGMA table_info(customers)`).all().map((c) => c.name);
    ok(["owner_id", "lead_source", "lead_source_detail", "interested_services", "relationship_status", "crm_key", "crm_version"].every((c) => cols.includes(c)), "0226 adds the CRM columns to customers");
    for (const t of ["customer_owner_events", "customer_status_events", "sales_activities"]) {
      db.exec(`INSERT INTO ${t} ${t === "sales_activities" ? "(customer_id, kind, note, occurred_at, source_key, created_by) VALUES (30, 'note', 'x', '2026-11-01', 'seed:1', 1)" : t === "customer_status_events" ? "(customer_id, to_status, created_by) VALUES (30, 'contacted', 1)" : "(customer_id, kind, created_by) VALUES (30, 'assign', 1)"}`);
      let upd = false, del = false;
      try { db.exec(`UPDATE ${t} SET created_by = 2`); upd = true; } catch { /* refused */ }
      try { db.exec(`DELETE FROM ${t}`); del = true; } catch { /* refused */ }
      ok(!upd && !del, `${t} is append-only (never edited, never deleted)`);
    }

    /* who may read */
    for (const [who, uid] of [["live host", U.host], ["marketing", U.mkt], ["agent", U.agent]]) ok((await call("/crm/leads", uid)).status === 403, `a ${who} is refused`);
    const o = await call("/crm/options", U.aina);
    ok(o.status === 200 && o.j.can_assign === false && o.j.can_write === true, "a consultant reads and writes, but does not assign");
    ok((await call("/crm/options", U.coo)).j?.can_assign === true && (await call("/crm/options", U.cco)).j?.can_assign === true && (await call("/crm/options", U.ceo)).j?.can_assign === true, "the CEO, COO and CCO assign");
    const ownerIds = (o.j.owners ?? []).map((x) => x.id);
    ok(ownerIds.includes(U.aina) && ownerIds.includes(U.bakar) && !ownerIds.includes(U.host) && !ownerIds.includes(U.mkt) && !ownerIds.includes(U.agent), "an owner is current sales staff - never the live host, marketing or an agent", ownerIds.join(","));
    ok(JSON.stringify((o.j.packages ?? []).map((p) => p.name)) === JSON.stringify(["Live Selling Starter", "Brand Film"]) && !JSON.stringify(o.j.packages).includes("cents"), "services are the Packages library's names - never a price");

    /* the list */
    const p1 = await call("/crm/leads?view=all&sort=name", U.aina);
    ok(p1.status === 200 && p1.j.total === 30 && p1.j.rows.length === 25 && !p1.j.rows.some((r) => r.company === "Walk-in Customer"), "the list is paged (25) and never shows the walk-in record", `${p1.j?.total}/${p1.j?.rows?.length}`);
    const p2 = await call("/crm/leads?view=all&sort=name&page=2", U.aina);
    ok(p2.j?.rows?.length === 5 && p2.j.rows[0].company === "Client 26 Sdn Bhd", "page 2 holds the rest, in the same order");
    const byPhone = await call("/crm/leads?q=2000017", U.aina);
    ok(byPhone.j?.rows?.length === 1 && byPhone.j.rows[0].id === 17, "search finds a lead by phone digits");
    ok((await call("/crm/leads?q=c9%40client", U.aina)).j?.rows?.[0]?.id === 9, "search finds a lead by email");
    const r6 = (await call("/crm/leads?q=Client%2006", U.aina)).j?.rows?.[0];
    ok(r6?.next_late === true && r6?.next_due === "2026-11-09" && r6?.no_next === false, "a lead's next action is its earliest open follow-up; past the day it is late");
    ok((await call("/crm/leads?q=Client%2010", U.aina)).j?.rows?.[0]?.no_next === true, "an open lead with nothing booked is flagged No next action");
    /* v1.408.0 - the task is the next action */
    const lead = async (n) => (await call(`/crm/leads?q=Client%20${n}`, U.aina)).j?.rows?.[0];
    const r14 = await lead(14), r15 = await lead(15), r16 = await lead(16), r17 = await lead(17), r18 = await lead(18);
    ok(r14?.no_next === false && r14?.next_kind === "task" && r14?.next_due === "2027-01-15" && r14?.next_note === "Send the brief to Client 14" && r14?.task_id === 901, "an open task on the customer is its next action, with its day and title", JSON.stringify(r14));
    ok(r15?.no_next === false && r15?.task_id === 902 && r15?.next_due === null, "an open task on the lead's project is a next action, even with no due date", JSON.stringify(r15));
    ok(r16?.no_next === false && r16?.task_id === 903 && r16?.next_due === "2027-01-20", "an open task on the lead's quotation is a next action");
    ok(r17?.no_next === false && r17?.next_kind === "closed" && r17?.next_note === "Old task for Client 17" && String(r17?.closed_at ?? "").startsWith("2026-11-19 11:00"), "a lead whose task was completed reads Task closed, dated in Malaysia time - never No next action", JSON.stringify(r17));
    ok(r18?.no_next === true && r18?.next_kind === null, "a cancelled task is not a next action and is not Task closed", JSON.stringify(r18));
    ok(db.prepare(`SELECT relationship_status AS s FROM customers WHERE id = 17`).get().s === null, "Task closed never changes the lead's relationship status");
    const d17 = (await call("/crm/leads/17", U.aina)).j;
    ok(d17?.closed_task?.id === 904 && d17?.tasks?.length === 0, "the lead record names the closed task when nothing is open", JSON.stringify(d17?.closed_task));
    const flagged = (await call("/crm/leads?flag=no_next&sort=name", U.coo)).j?.rows?.map((r) => r.id) ?? [];
    ok(!flagged.includes(14) && !flagged.includes(15) && !flagged.includes(16) && !flagged.includes(17) && flagged.includes(18), "the No next action filter agrees with the list", flagged.join(","));
    const d14 = (await call("/crm/leads/14", U.aina)).j;
    ok(d14?.tasks?.length === 1 && d14.tasks[0].id === 901 && d14.tasks[0].due_on === "2027-01-15", "the lead record lists its open tasks", JSON.stringify(d14?.tasks));

    /* assign */
    const v8 = ver(8);
    ok((await call("/crm/leads/8/assign", U.aina, "POST", { owner_id: U.aina, version: v8 })).status === 403, "a consultant cannot assign");
    ok((await call("/crm/leads/8/assign", U.coo, "POST", { owner_id: U.host, version: v8 })).status === 400, "the owner must be current sales staff");
    ok((await call("/crm/leads/8/assign", U.coo, "POST", { owner_id: U.aina, version: v8 + 5 })).status === 409, "a stale version is refused");
    const a1 = await call("/crm/leads/8/assign", U.coo, "POST", { owner_id: U.aina, version: v8 });
    ok(a1.status === 200 && db.prepare(`SELECT owner_id FROM customers WHERE id = 8`).get().owner_id === U.aina, "the COO assigns a lead", a1.text.slice(0, 160));
    ok(cnt(`SELECT COUNT(*) AS n FROM customer_owner_events WHERE customer_id = 8 AND kind = 'assign' AND to_owner = ${U.aina} AND created_by = ${U.coo}`) === 1, "…kept with who did it");
    ok(cnt(`SELECT COUNT(*) AS n FROM notifications WHERE user_id = ${U.aina} AND ref = 'lead:8'`) === 1, "…and the new owner is told");
    ok((await call("/crm/leads/8/assign", U.coo, "POST", { owner_id: U.bakar, version: ver(8) })).status === 400, "a reassignment needs a reason");
    const a2 = await call("/crm/leads/8/assign", U.cco, "POST", { owner_id: U.bakar, reason: "Bakar covers Melaka", version: ver(8) });
    ok(a2.status === 200 && cnt(`SELECT COUNT(*) AS n FROM customer_owner_events WHERE customer_id = 8 AND kind = 'reassign' AND reason = 'Bakar covers Melaka'`) === 1
      && cnt(`SELECT COUNT(*) AS n FROM notifications WHERE user_id = ${U.aina} AND ref = 'lead:8'`) === 2, "a reassignment is kept with its reason, and the old owner is told too");

    /* status */
    const v9 = ver(9);
    ok((await call("/crm/leads/9/status", U.aina, "POST", { to: "disqualified", version: v9 })).status === 400, "Disqualified needs a reason");
    ok((await call("/crm/leads/9/status", U.aina, "POST", { to: "won", version: v9 })).status === 400, "a status outside the list is refused");
    const s1 = await call("/crm/leads/9/status", U.aina, "POST", { to: "contacted", version: v9 });
    ok(s1.status === 200 && db.prepare(`SELECT relationship_status AS s FROM customers WHERE id = 9`).get().s === "contacted" && ver(9) === v9 + 1, "a status is set and the version moves on");
    ok((await call("/crm/leads/9/status", U.aina, "POST", { to: "qualified", version: v9 })).status === 409, "the same old version cannot write twice");
    ok(cnt(`SELECT COUNT(*) AS n FROM customer_status_events WHERE customer_id = 9 AND from_status IS NULL AND to_status = 'contacted' AND created_by = ${U.aina}`) === 1, "every status change is recorded");
    const s2 = await call("/crm/leads/9/status", U.aina, "POST", { to: "disqualified", reason: "Closed their shop in October", version: ver(9) });
    ok(s2.status === 200 && cnt(`SELECT COUNT(*) AS n FROM customer_status_events WHERE customer_id = 9 AND to_status = 'disqualified' AND reason = 'Closed their shop in October'`) === 1, "…with the reason when it ends");

    /* profile */
    ok((await call("/crm/leads/10/profile", U.aina, "PUT", { lead_source: "billboard", version: ver(10) })).status === 400, "a source outside the list is refused");
    ok((await call("/crm/leads/10/profile", U.aina, "PUT", { lead_source: "referral", interested_services: ["pkg:99"], version: ver(10) })).status === 400, "a service must be in the Packages library");
    const pf = await call("/crm/leads/10/profile", U.aina, "PUT", { lead_source: "referral", lead_source_detail: "Kak Long", interested_services: ["pkg:1", "other:Photo booth"], version: ver(10) });
    const c10 = db.prepare(`SELECT lead_source, lead_source_detail, interested_services FROM customers WHERE id = 10`).get();
    ok((await call("/crm/leads/10/profile", U.aina, "PUT", { lead_source: "agent", version: ver(10) - 1 })).status === 409 && db.prepare(`SELECT lead_source FROM customers WHERE id = 10`).get().lead_source === "referral", "a stale profile edit is refused and changes nothing");
    ok(pf.status === 200 && c10.lead_source === "referral" && JSON.parse(c10.interested_services).join(",") === "pkg:1,other:Photo booth", "source, details and services are saved (names, never prices)", JSON.stringify(c10));

    /* activities */
    ok((await call("/crm/leads/11/activities", U.aina, "POST", { kind: "call", note: "Spoke to the owner" })).status === 400, "an activity needs its client key");
    const ac1 = await call("/crm/leads/11/activities", U.aina, "POST", { kind: "call", outcome: "interested", note: "Spoke to the owner", client_key: "abcdefgh1234" });
    const ac2 = await call("/crm/leads/11/activities", U.aina, "POST", { kind: "call", outcome: "interested", note: "Spoke to the owner", client_key: "abcdefgh1234" });
    ok(ac1.status === 201 && ac2.status === 201 && ac1.j.id === ac2.j.id && cnt(`SELECT COUNT(*) AS n FROM sales_activities WHERE customer_id = 11`) === 1, "a double press is one activity");
    ok((await call("/crm/leads/12/activities", U.bakar, "POST", { kind: "note", note: "Another lead", client_key: "abcdefgh1234" })).status === 409, "someone else's key is refused, never reused");
    ok((await call("/crm/leads/11/activities", U.aina, "POST", { kind: "followup", note: "x", client_key: "zzzzzzzz0001" })).status === 400, "a closed follow-up is never typed by hand");
    ok((await call("/crm/leads/11/activities", U.aina, "POST", { kind: "meeting", note: "Next month", occurred_at: "2026-12-10T10:00", client_key: "zzzzzzzz0002" })).status === 400, "an activity cannot be dated later than now");

    /* follow-ups: exactly one activity when closed, none when cancelled */
    const d1 = await call("/followups/1/done", U.aina, "POST", { note: "Wants the starter package" });
    const d2 = await call("/followups/1/done", U.aina, "POST", { note: "again" });
    ok(d1.status === 200 && d2.status === 400 && cnt(`SELECT COUNT(*) AS n FROM sales_activities WHERE followup_id = 1 AND kind = 'followup' AND source_key = 'followup:1'`) === 1, "closing a follow-up writes exactly ONE activity", d1.text.slice(0, 120));
    const d3 = await call("/followups/4/done", U.aina, "POST", { outcome: "interested", note: "Likes the quote" });
    ok(d3.status === 200 && cnt(`SELECT COUNT(*) AS n FROM sales_activities WHERE source_key = 'followup:4' AND outcome = 'interested' AND doc_id = 403`) === 1, "…also when it is closed with the customer's answer on a quotation", d3.text.slice(0, 120));
    await call("/followups/3/cancel", U.aina, "POST", {});
    ok(cnt(`SELECT COUNT(*) AS n FROM sales_activities WHERE followup_id = 3`) === 0, "a cancelled follow-up is not an activity");

    /* convert */
    const cBefore = cnt(`SELECT COUNT(*) AS n FROM customers`);
    ok((await call("/crm/convert", U.mkt, "POST", { source: "enquiry", id: 1 })).status === 403, "making a customer needs Sales (the POST /customers rule)");
    const cv1 = await call("/crm/convert", U.aina, "POST", { source: "enquiry", id: 1 });
    const cv1b = await call("/crm/convert", U.aina, "POST", { source: "enquiry", id: 1 });
    const made = db.prepare(`SELECT * FROM customers WHERE crm_key = 'enquiry:1'`).get();
    ok(cv1.status === 201 && cv1b.j?.existing === true && cv1b.j.customer_id === cv1.j.customer_id && cnt(`SELECT COUNT(*) AS n FROM customers`) === cBefore + 1, "a conversion makes ONE customer, however often it is pressed");
    ok(made?.lead_source === "website" && made.relationship_status === "new_lead" && made.owner_id === U.aina && db.prepare(`SELECT customer_id FROM enquiries WHERE id = 1`).get().customer_id === made.id, "…a new lead from the website, owned by whoever owned the enquiry, linked back to it");
    ok(cnt(`SELECT COUNT(*) AS n FROM customer_owner_events WHERE customer_id = ${made?.id} AND kind = 'convert'`) === 1 && cnt(`SELECT COUNT(*) AS n FROM customer_status_events WHERE customer_id = ${made?.id} AND to_status = 'new_lead'`) === 1, "…its owner and status recorded once");
    for (const [id, why] of [[2, "the same company name"], [3, "the same phone (+60 12-200 0004 = 0122000004)"], [4, "the same email (any case)"]]) {
      const r = await call("/crm/convert", U.aina, "POST", { source: "enquiry", id });
      ok(r.status === 409 && r.j?.error?.code === "possible_duplicate" && (r.j.candidates ?? []).length >= 1, `the duplicate check catches ${why}`, r.text.slice(0, 160));
    }
    const ln = await call("/crm/convert", U.aina, "POST", { source: "enquiry", id: 2, customer_id: 3 });
    ok(ln.j?.linked === true && db.prepare(`SELECT customer_id FROM enquiries WHERE id = 2`).get().customer_id === 3 && cnt(`SELECT COUNT(*) AS n FROM customers`) === cBefore + 1, "linking to the chosen customer makes no new one");
    const nw = await call("/crm/convert", U.aina, "POST", { source: "enquiry", id: 4, confirm_duplicate: true });
    ok(nw.status === 201 && db.prepare(`SELECT owner_id FROM customers WHERE crm_key = 'enquiry:4'`).get().owner_id === null, "a confirmed new customer is made; an owner who is not sales staff is not carried over");
    const gv = await call("/crm/convert", U.aina, "POST", { source: "growth", id: 1 });
    const gc = db.prepare(`SELECT * FROM customers WHERE crm_key = 'growth:1'`).get();
    ok(gv.status === 201 && gc?.lead_source === "growth_check" && gc.owner_id === U.bakar && (gc.lead_source_detail ?? "").includes("A2Z-0911-1"), "a Growth Check entry converts the same way, its reference kept as the source detail");

    /* suggested owners */
    ok((await call("/crm/suggestions", U.aina)).status === 403, "only a manager sees the suggestions");
    const sg = await call("/crm/suggestions", U.coo);
    const sMap = Object.fromEntries((sg.j?.rows ?? []).map((r) => [r.customer_id, r.owner_id]));
    ok(sMap[1] === U.bakar && sMap[2] === U.aina && !(3 in sMap) && !(4 in sMap) && !(8 in sMap), "a suggestion is the salesperson on the LATEST live document; never a non-sales person, a void-only customer or an owned one", JSON.stringify(sMap));
    ok(cnt(`SELECT COUNT(*) AS n FROM customers WHERE id IN (1, 2) AND owner_id IS NOT NULL`) === 0, "nothing is set until a manager confirms");
    ok((await call("/crm/suggestions/confirm", U.coo, "POST", { items: [{ customer_id: 1, owner_id: U.bakar }] })).status === 400, "confirming needs a reason");
    const cf = await call("/crm/suggestions/confirm", U.coo, "POST", { reason: "CRM start owners", items: [{ customer_id: 1, owner_id: U.bakar }, { customer_id: 2, owner_id: U.bakar }] });
    ok(cf.j?.applied === 1 && (cf.j.skipped ?? []).includes(2) && db.prepare(`SELECT owner_id FROM customers WHERE id = 2`).get().owner_id === null, "only the server's own suggestion is set - a different owner is skipped", cf.text.slice(0, 160));
    ok(db.prepare(`SELECT owner_id FROM customers WHERE id = 1`).get().owner_id === U.bakar && cnt(`SELECT COUNT(*) AS n FROM customer_owner_events WHERE customer_id = 1 AND kind = 'suggestion' AND reason = 'CRM start owners'`) === 1, "a confirmed suggestion is recorded with the reason");
    ok((await call("/crm/suggestions/confirm", U.coo, "POST", { reason: "again", items: [{ customer_id: 1, owner_id: U.bakar }] })).j?.applied === 0, "a customer that has an owner is never set again by a suggestion");

    /* the Phase 1 list */
    db.exec(`UPDATE customers SET owner_id = ${U.aina}, relationship_status = 'qualified' WHERE id IN (13, 6, 2, 14)`);
    const today = await call("/sales/today", U.aina);
    const items = today.j?.items ?? [];
    ok(!items.some((i) => i.key === "lead:14"), "a lead with an open task is not No next action on My Sales Action Center", JSON.stringify(items.map((i) => i.key)));
    ok(items.some((i) => i.key === "lead:13" && i.flag === "no_next" && i.kind === "lead"), "an owned qualified lead with nothing booked joins My Sales Action Center as No next action", JSON.stringify(items.map((i) => i.key)));
    ok(!items.some((i) => i.key === "lead:6") && items.filter((i) => i.customer_id === 6).length === 1, "a lead already listed (its overdue follow-up) is not listed twice");
    ok(items.some((i) => i.key === "quotation:403") && !items.some((i) => i.key === "lead:2"), "a lead whose quotation is already on the list is not listed again as a lead", JSON.stringify(items.map((i) => i.key)));
    const done = (today.j?.done ?? []).map((d) => d.key);
    ok(done.includes(`activity_logged:${ac1.j.id}`) && done.includes("followup_done:1") && !done.some((k) => k.startsWith("activity_logged:") && k !== `activity_logged:${ac1.j.id}`), "Done today shows the logged call once and the closed follow-up once - never twice", done.join(","));
    ok((today.j?.recent ?? []).some((a) => a.kind === "activity" && a.customer_id === 11), "Recent Activities shows the logged contact");

    /* summary */
    const sm = await call("/crm/summary?scope=all", U.coo);
    const una = cnt(`SELECT COUNT(*) AS n FROM customers c WHERE c.company != 'Walk-in Customer' AND c.owner_id IS NULL AND (c.relationship_status IS NULL OR c.relationship_status IN ('new_lead','contacted','qualified'))`);
    ok(sm.status === 200 && sm.j.unassigned === una && sm.j.followups_overdue >= 1, "the figures count the records", JSON.stringify(sm.j));
    const det = await call("/crm/leads/8", U.aina);
    ok(det.status === 200 && det.j.owner_events.length === 2 && det.j.lead.owner_name === "Bakar Seller", "the lead's history shows its owners", det.text.slice(0, 120));

    ok(money() === before, "no document, payment report, cash row, journal or commission row was touched");
  } catch (e) { ok(false, "the run threw", String(e?.stack ?? e).slice(0, 500)); }
  globalThis.Date = RealDate;
  return out;
}

let n = 0, fail = 0;
const report = (res, tag = "") => { for (const [p, m] of res) { n++; if (!p) { fail++; console.error(`FAIL ${tag}${m}`); } } };

/* ---- source rules ---- */
const crm = read("worker/src/crm.ts"), mig = read("worker/migrations/0226_crm_leads.sql"), ui = read("components/portal/crm-leads.tsx");
const s = (c, m) => report([[c, m]]);
s(!/\b(UPDATE|DELETE)\b[^;`]*\b(sales_documents|invoice_payment_reports|cash_book|commission_ledger|journal_entries)\b/i.test(crm), "crm.ts never updates or deletes a document, a payment report, the cash book, the journal or the commission ledger");
s(!/^\s*(UPDATE|DELETE|DROP|ALTER TABLE \w+ (RENAME|DROP))/im.test(mig.replace(/--.*$/gm, "").replace(/BEGIN SELECT RAISE[^;]*;\s*END;/g, "")), "0226 is additive: no UPDATE, DELETE, DROP or rename");
s(!/total_cents|price/i.test(ui.replace(/\/\*[\s\S]*?\*\//g, "").replace(/never a price|tiada harga|fmtRM\(x\.total_cents\)|total_cents: number/g, "")), "the lead screen never shows a package price");
s(/Opening it is not a record|never a sale/i.test(ui), "the screen says a logged contact is never a sale");

const dir = mkdtempSync(join(tmpdir(), "crmleads-"));
const main = join(dir, "worker.mjs");
bundle(root, main);
report(await runtime(main, join(root, "worker/migrations")));
const checks = n;

/* ---- deliberate breakages: each must be caught ---- */
const MUTANTS = [
  ["a consultant may assign", "worker/src/crm.ts", `if (act === "assign" ? !canUser(user, "crm_assign") : !writes)`, `if (!writes)`],
  ["a stale profile edit is accepted", "worker/src/crm.ts", "WHERE id = ?1 AND crm_version = ?5", "WHERE id = ?1 AND (crm_version = ?5 OR 1 = 1)"],
  ["a closed follow-up writes no activity", "worker/src/business.ts", '    if (mFuAct[2] === "done") await recordFollowupActivity(env, id);', "    "],
  ["a follow-up closed with an answer writes no activity", "worker/src/business.ts", "      await recordFollowupActivity(env, id); // v1.398.0", "      // v1.398.0"],
  ["the duplicate check is skipped", "worker/src/crm.ts", "if (body?.confirm_duplicate !== true) {", "if (false) {"],
  ["any owner may be confirmed", "worker/src/crm.ts", "now.get(cid) !== oid", "false"],
  ["Disqualified without a reason", "worker/src/crm.ts", `if ((to === "disqualified" || to === "inactive") && reason.length < 10)`, "if (false)"],
  ["a listed lead is listed twice", "worker/src/sales-today.ts", "      if (listed.has(l.id)) continue;\n", ""],
  ["a closed follow-up counts twice in Done today", "worker/src/sales-today.ts", "WHERE a.created_by = ?1 AND a.kind != 'followup' AND", "WHERE a.created_by = ?1 AND"],
  ["an owner outside the sales team", "worker/src/crm.ts", "if (to !== null && !(await owners(env)).some((o) => o.id === to))", "if (false)"],
  ["an open task is not a next action in the list", "worker/src/crm.ts", "no_next: open && r.next_due === null && r.task_id === null && r.closed_title === null,", "no_next: open && r.next_due === null && r.closed_title === null,"],
  ["an open task is not a next action in the filter", "worker/src/crm.ts", "\n   OR EXISTS (SELECT 1 FROM tasks t WHERE ${TASK_LINK_SQL(`${a}id`)})\n", "\n"],
  ["a cancelled task is a next action", "worker/src/crm.ts", "`t.status != 'completed' AND ${LINKED_SQL(id)}`", "`1 = 1 AND ${LINKED_SQL(id)}`"],
  ["a cancelled task reads Task closed", "worker/src/crm.ts", "t.status = 'completed' AND COALESCE(t.stage, '') != 'cancelled' AND", "t.status = 'completed' AND"],
  ["a closed task leaves No next action", "worker/src/crm.ts", "no_next: open && r.next_due === null && r.task_id === null && r.closed_title === null,", "no_next: open && r.next_due === null && r.task_id === null,"],
  ["a project task is not on the lead", "worker/src/crm.ts", "OR (t.link_kind = 'project' AND", "OR (0 AND"],
  ["the Action Center ignores the task", "worker/src/sales-today.ts", "          AND NOT EXISTS (SELECT 1 FROM tasks t WHERE ${TASK_LINK_SQL()})\n", ""],
  ["a double press is two activities", "worker/src/crm.ts", "`client:${ck}`, user.id).run();", "`client:${ck}:${Math.random()}`, user.id).run();"],
];
let caught = 0;
for (const [name, file, from, to] of MUTANTS) {
  const m = mkdtempSync(join(tmpdir(), "crmleads-m-"));
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
if (fail) { console.error(`crm-leads: ${fail} of ${n} failed`); process.exit(1); }
console.log(`PASS - leads & crm: owner, source, services, status and contact log on the customer record; only managers assign, every change kept; one activity per press and per closed follow-up; the duplicate check before a convert; nothing touches money (${checks} checks, ${caught}/${MUTANTS.length} mutations caught)`);
