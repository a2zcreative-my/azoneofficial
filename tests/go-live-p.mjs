/* PROJECT WORKSPACE (v1.245.0) - runtime guard: the WHOLE worker (index.ts,
 * bundled) against SQLite with every migration applied (0159 included), by
 * direct request as each role, on a fixed clock: Saturday 31-10-2026,
 * 15:00 Malaysia time.
 *
 * The owner's brief "A2Z OS - Quotation-linked Project Workspace & Task
 * Report", approved 31-10-2026 with decisions P-1 to P-6
 * (claude/PROJECT-WORKSPACE-AUDIT.md). The brief's 20 required tests are
 * numbered T1..T20 below.
 *
 *   node tests/go-live-p.mjs                                  the current worker, then mutations
 *   WORKER_BUNDLE=/path/worker.mjs node tests/go-live-p.mjs   a given bundle (the pre-fix bundle must FAIL)
 */
import { readFileSync, readdirSync, mkdtempSync, writeFileSync, cpSync, rmSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash, createHmac } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const root = fileURLToPath(new URL("..", import.meta.url));
const bundle = (srcRoot, entry, out) => execSync(`npx esbuild "${join(srcRoot, entry)}" --bundle --format=esm --platform=neutral --outfile="${out}" --log-level=error`, { cwd: root, stdio: "inherit" });
const SECRET = "JBSWY3DPEHPK3PXP";
const sha = (s) => createHash("sha256").update(s).digest("hex");
const NOW = Date.parse("2026-10-31T07:00:00Z"); // Sat 31-10-2026 15:00 MYT
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const b32 = (s) => { let bits = 0, v = 0; const o = []; for (const ch of s) { v = (v << 5) | B32.indexOf(ch); bits += 5; if (bits >= 8) { o.push((v >>> (bits - 8)) & 255); bits -= 8; } } return Buffer.from(o); };
const totpAt = (ms) => { const c = Math.floor(ms / 30000); const b = Buffer.alloc(8); b.writeUInt32BE(Math.floor(c / 2 ** 32), 0); b.writeUInt32BE(c >>> 0, 4); const h = createHmac("sha1", b32(SECRET)).update(b).digest(); const o = h[h.length - 1] & 15; return String((((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1e6).padStart(6, "0"); };

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
    run: async () => ({ meta: { changes: Number(st.run(...b).changes) } }), _run: () => st.run(...b) }; return o; };
  const store = new Map();
  const MEDIA = {
    put: async (k, v) => { store.set(k, Buffer.from(typeof v === "string" ? v : v instanceof ArrayBuffer ? new Uint8Array(v) : typeof v?.getReader === "function" ? new Uint8Array(await new Response(v).arrayBuffer()) : v)); },
    get: async (k) => store.has(k) ? { body: new Blob([store.get(k)]).stream(), httpMetadata: { contentType: "application/pdf" }, writeHttpMetadata: (h) => h.set("Content-Type", "application/pdf") } : null,
    head: async () => null, list: async () => ({ objects: [] }), delete: async (k) => { store.delete(k); },
  };
  const env = {
    DB: { prepare: shim, batch: async (list) => { db.exec("BEGIN"); try { for (const s of list) s._run(); db.exec("COMMIT"); } catch (e) { db.exec("ROLLBACK"); throw e; } return []; } },
    SESSION_PEPPER: "pepper", COMPANY_DOMAIN: "a2z.test", ALLOWED_ORIGINS: "https://portal.a2z.test", MEDIA,
  };
  const RealDate = globalThis.Date;
  let fixed = NOW;
  globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [fixed])); } static now() { return fixed; } };
  const U = { ceo: 1, coo: 2, cco: 3, aina: 5, lia: 6, mira: 10, ed: 11, root: 8, shop: 9, gone: 12 };
  db.exec(`INSERT INTO users (id, name, full_name, email, role, is_active, password_hash, totp_enabled, totp_secret, department, employment_status, joined_on, left_on) VALUES
    (1,'Alif','Alif Farhan','alif@a2z.test','ceo',1,'x',1,'${SECRET}','Management','permanent','2020-01-01',NULL),
    (2,'Ops','Ops Lead','ops@a2z.test','coo',1,'x',1,'${SECRET}','Management','permanent','2020-01-01',NULL),
    (3,'Cee','Cee Officer','cco@a2z.test','cco',1,'x',1,'${SECRET}','Management','permanent','2020-01-01',NULL),
    (5,'Aina','Aina Seller','aina@a2z.test','sales_marketing',1,'x',1,'${SECRET}','Sales','permanent','2020-01-01',NULL),
    (6,'Lia','Lia Seller','lia@a2z.test','sales_marketing',1,'x',1,'${SECRET}','Sales','permanent','2020-01-01',NULL),
    (8,'Root','Root','root@a2z.test','super_admin',1,'x',1,'${SECRET}',NULL,'permanent','2020-01-01',NULL),
    (9,'Shop','Shop','shop@gmail.com','customer',1,'x',0,NULL,NULL,'permanent',NULL,NULL),
    (10,'Sara','Sara Designer','sara@a2z.test','marketing',1,'x',1,'${SECRET}','Marketing','permanent','2020-01-01',NULL),
    (11,'Ed','Ed Editor','ed@a2z.test','editor',1,'x',1,'${SECRET}','Marketing','permanent','2020-01-01',NULL),
    (12,'Gone','Gone Seller','gone@a2z.test','sales_marketing',1,'x',1,'${SECRET}','Sales','resigned','2020-01-01','2026-10-01')`);
  db.exec(`INSERT INTO customers (id, company, contact_person, phone, email, created_by) VALUES (1, 'ABC Sdn Bhd', 'Mr. Ahmad', '0123456789', 'ahmad@abc.test', 5)`);
  const lines = JSON.stringify([{ name: "Social media management", qty: 3, uom: "MTH", unit_price_cents: 150000, sub: ["12 posts a month"] }, { name: "Content shoot", qty: 1, uom: "JOB", unit_price_cents: 80000 }]);
  try {
    db.exec(`INSERT INTO sales_packages (id, name, kind, status, current_version, created_by) VALUES (1, 'Social Media Management (3 Months)', 'service', 'active', 1, 1)`);
    db.prepare(`INSERT INTO sales_package_versions (package_id, version, items, total_cents, subtotal_cents, created_by) VALUES (1, 1, ?, 530000, 530000, 1)`).run(lines);
  } catch { /* pre-0153 */ }
  const qins = db.prepare(`INSERT INTO sales_documents (id, doc_type, doc_number, customer_id, items, total_cents, valid_until, salesperson_id, created_by, created_at, revision, package_id, package_version) VALUES (?, 'QT', ?, 1, ?, ?, ?, ?, ?, '2026-10-31 01:00:00', 0, ?, ?)`);
  qins.run(100, "QT-2026-0018", lines, 530000, "2026-11-30", 5, 5, 1, 1);
  qins.run(101, "QT-2026-0007", lines, 530000, "2026-10-15", 5, 5, null, null); // expired, never accepted
  qins.run(102, "QT-2026-0019", lines, 530000, "2026-11-30", 6, 6, null, null);
  db.exec(`INSERT INTO sales_documents (id, doc_type, doc_number, customer_id, items, total_cents, payment_status, salesperson_id, created_by, created_at) VALUES (200, 'INV', 'INV-OLD-1', 1, '[]', 1000, 'unpaid', 5, 5, '2026-10-01 01:00:00')`);
  const worker = (await import(pathToFileURL(workerBundle).href + `?v=${Math.random()}`)).default;
  const tok = {};
  for (const id of Object.values(U)) {
    tok[id] = `t-${id}`;
    db.prepare(`INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, datetime('now', '+12 hours'), datetime('now'))`).run(sha(tok[id]), id);
  }
  const call = async (path, uid, method = "GET", body, headers = {}) => {
    const h = { "content-type": "application/json", origin: "https://portal.a2z.test", cookie: `azone_session=${tok[uid]}; csrf_token=c1`, "x-csrf-token": "c1", ...headers };
    const isRaw = body instanceof Uint8Array;
    const r = await worker.fetch(new Request(`https://api.a2z.test/api/v1${path}`, { method, headers: h, body: body === undefined ? undefined : isRaw ? body : JSON.stringify(body) }), env, { waitUntil() {} });
    const text = await r.text();
    let j = null; try { j = JSON.parse(text); } catch { /* not json */ }
    return { status: r.status, j, text };
  };
  const n = (sql, ...a) => Number(db.prepare(sql).get(...a)?.n ?? 0);
  const money = () => sha(JSON.stringify([
    /* QT 100's lines are edited ON PURPOSE by T19 (a later quotation change) - everything else must not move */
    db.prepare(`SELECT id, doc_type, CASE WHEN id = 100 THEN NULL ELSE total_cents END AS t, CASE WHEN id = 100 THEN NULL ELSE items END AS i, salesperson_id, payment_status, CASE WHEN id = 100 THEN NULL ELSE revision END AS r FROM sales_documents ORDER BY id`).all(),
    (() => { try { return db.prepare(`SELECT * FROM commission_ledger ORDER BY id`).all(); } catch { return []; } })(),
    (() => { try { return db.prepare(`SELECT * FROM payroll_entries ORDER BY rowid`).all(); } catch { return []; } })(),
    (() => { try { return db.prepare(`SELECT * FROM cashflow_entries ORDER BY id`).all(); } catch { return []; } })(),
    db.prepare(`SELECT * FROM invoice_payments ORDER BY id`).all(),
  ]));
  const money0 = money();

  try {
    /* T1 / T2 - one brief per quotation, on a press (P-1) */
    const before = await call("/staff/projects/by-quotation/100", U.aina);
    /* v1.246.3 - the customer agrees first; until then the page offers Record acceptance, not Create */
    ok(before.status === 200 && before.j?.project === null && before.j?.can_create === false && before.j?.can_record_acceptance === true && before.j?.suggested_owner?.id === U.aina, "T1 a saved quotation has no project; before the customer agrees it cannot be created - the page offers Record acceptance (v1.246.3); the salesperson is the SUGGESTED owner", before.text.slice(0, 200));
    ok((await call("/staff/projects", U.aina, "POST", { quotation_id: 100 })).status === 409, "T1 the salesperson cannot start the project before the customer agreed (409 not_accepted)");
    db.exec(`INSERT INTO quotation_acceptances (doc_id, revision, accepted_name, accepted_position) VALUES (100, 0, 'Ahmad', 'Director')`);
    const after = await call("/staff/projects/by-quotation/100", U.aina);
    ok(after.j?.can_create === true && after.j?.can_record_acceptance === false, "T1 accepted on the link: Create is offered");
    ok((await call("/staff/projects", U.lia, "POST", { quotation_id: 100 })).status === 403, "T1 another salesperson cannot create the brief for somebody else's quotation");
    const c1 = await call("/staff/projects", U.aina, "POST", { quotation_id: 100 });
    ok(c1.status === 201 && c1.j?.existing === false, "T1 the quotation's salesperson creates ONE draft brief", c1.text.slice(0, 160));
    const pid = c1.j?.id ?? 999999;
    const c2 = await call("/staff/projects", U.aina, "POST", { quotation_id: 100 });
    ok(c2.j?.id === pid && c2.j?.existing === true && n(`SELECT COUNT(*) AS n FROM projects WHERE quotation_id = 100`) === 1, "T2 pressing again (or reopening) returns the same project - no duplicate", c2.text.slice(0, 160));
    let dupRefused = false; try { db.exec(`INSERT INTO projects (quotation_id, customer_id, title) VALUES (100, 1, 'x')`); } catch { dupRefused = true; }
    ok(dupRefused, "T2 the database itself refuses a second project for a quotation (UNIQUE)");
    let w = (await call(`/staff/projects/${pid}`, U.aina)).j;
    ok(w?.project?.status === "draft" && w?.project?.owner === null && w?.client?.company === "ABC Sdn Bhd" && w?.quotation?.doc_number === "QT-2026-0018" && w?.package?.name === "Social Media Management (3 Months)" && w?.package?.version === 1 && w?.scope?.lines?.length === 2, "T4 the brief reads customer, quotation and package from Sales - nothing re-typed", JSON.stringify({ c: w?.client, p: w?.package, s: w?.project?.status }));
    ok(n(`SELECT COUNT(*) AS n FROM customers`) === 1 && n(`SELECT COUNT(*) AS n FROM sales_packages`) <= 1, "T4 no customer or package copy is made");

    /* the Project Owner (P-2) */
    ok((await call(`/staff/projects/${pid}`, U.aina, "PATCH", { title: "x", version: 1 })).status === 403, "P-2 before the owner is assigned, the salesperson cannot edit the brief");
    ok((await call(`/staff/projects/${pid}/owner`, U.cco, "POST", { owner_id: U.aina })).status === 403, "P-2 the CCO does not assign the Project Owner");
    ok((await call(`/staff/projects/${pid}/owner`, U.aina, "POST", { owner_id: U.aina })).status === 403, "P-2 nobody makes themselves owner");
    ok((await call(`/staff/projects/${pid}/owner`, U.ceo, "POST", { owner_id: U.gone })).status === 400, "P-2 a leaver cannot be Project Owner");
    const own = await call(`/staff/projects/${pid}/owner`, U.ceo, "POST", { owner_id: U.aina });
    ok(own.status === 200, "P-2 the CEO assigns the Project Owner", own.text.slice(0, 160));
    ok(n(`SELECT COUNT(*) AS n FROM notifications WHERE user_id = 5 AND message LIKE '%Project Owner%'`) === 1, "the new owner is told");

    /* T5 - T9: who edits */
    w = (await call(`/staff/projects/${pid}`, U.aina)).j;
    const e1 = await call(`/staff/projects/${pid}`, U.aina, "PATCH", { title: "Social Media Management - ABC Sdn Bhd", start_date: "2026-11-01", due_date: "2026-11-20", deliverables: ["12 posts", "1 shoot"], version: w?.project?.version });
    ok(e1.status === 200, "T5 the Project Owner edits the brief", e1.text.slice(0, 160));
    ok((await call(`/staff/projects/${pid}`, U.aina, "PATCH", { title: "Stale", version: w?.project?.version })).status === 409, "T5 a save over somebody else's newer save is refused (version)");
    w = (await call(`/staff/projects/${pid}`, U.ceo)).j;
    ok((await call(`/staff/projects/${pid}`, U.ceo, "PATCH", { notes: "Kick-off on Monday", version: w?.project?.version })).status === 200, "T6 the CEO edits any project");
    w = (await call(`/staff/projects/${pid}`, U.coo)).j;
    ok((await call(`/staff/projects/${pid}`, U.coo, "PATCH", { description: "Three months of content", version: w?.project?.version })).status === 200, "T7 the COO edits any project");
    w = (await call(`/staff/projects/${pid}`, U.cco)).j;
    ok((await call(`/staff/projects/${pid}`, U.cco, "PATCH", { due_date: "2026-11-25", version: w?.project?.version })).status === 200, "T8 the CCO edits project details");
    ok((await call(`/staff/docs/200`, U.cco, "PATCH", { payment_status: "paid" })).status === 403 && (await call(`/staff/docs/200/confirm-paid`, U.cco, "POST", {})).status === 403, "T8 ...but cannot mark or confirm an invoice paid");
    ok((await call(`/staff/payroll/release`, U.cco, "POST", { month: "2026-10" })).status === 403 && [403, 404].includes((await call(`/staff/commission/policy`, U.cco, "POST", { name: "x" })).status), "T8 ...nor release payroll or draft commission policy");
    w = (await call(`/staff/projects/${pid}`, U.lia)).j;
    ok((await call(`/staff/projects/${pid}`, U.lia, "PATCH", { title: "Mine now", version: w?.project?.version })).status === 403, "T9 another salesperson editing the project gets 403");
    ok((await call(`/staff/projects/${pid}`, U.aina, "PATCH", { unit_price_cents: 1, version: w?.project?.version })).status === 403 && (await call(`/staff/projects/${pid}`, U.aina, "PATCH", { owner_id: U.aina, version: w?.project?.version })).status === 403, "the brief never carries price or owner changes");

    /* tasks through the ONE task engine */
    const t1 = await call("/staff/tasks", U.aina, "POST", { title: "Design & content creation", assigned_to: U.mira, deadline: "2026-11-10", link_kind: "project", link_id: pid });
    ok(t1.status === 201, "the Project Owner assigns a project task (POST /tasks, link_kind project)", t1.text.slice(0, 160));
    const t2 = await call("/staff/tasks", U.aina, "POST", { title: "Client review & feedback", assigned_to: U.mira, deadline: "2026-11-15", link_kind: "project", link_id: pid });
    ok(t2.status === 201 && t2.j?.id !== t1.j?.id, "one person may hold several tasks on one project");
    const t3 = await call("/staff/tasks", U.aina, "POST", { title: "Content strategy & plan", deadline: "2026-11-05", link_kind: "project", link_id: pid });
    ok(t3.status === 201, "the owner assigns a task to themselves");
    ok(n(`SELECT COUNT(*) AS n FROM notifications WHERE user_id = 10 AND kind = 'task'`) >= 2, "the assignee is notified by the existing task bell");
    ok((await call("/staff/tasks", U.lia, "POST", { title: "Sneak", assigned_to: U.lia, link_kind: "project", link_id: pid })).status === 403, "somebody else cannot add tasks to the project");
    ok((await call("/staff/tasks", U.aina, "POST", { title: "To a leaver", assigned_to: U.gone, link_kind: "project", link_id: pid })).status === 400, "a project task never goes to a leaver");
    ok(n(`SELECT COUNT(*) AS n FROM tasks WHERE link_kind = 'project' AND link_id = ${pid}`) === 3, "three project tasks, no duplicates");

    /* T3 - the lifecycle */
    let s1 = await call(`/staff/projects/${pid}/status`, U.aina, "POST", { to: "ready" });
    ok(s1.status === 200, "the owner marks the brief Ready", s1.text.slice(0, 160));
    s1 = await call(`/staff/projects/${pid}/status`, U.aina, "POST", { to: "in_progress" });
    const row = db.prepare(`SELECT status, scope_snapshot, scope_revision, activated_at FROM projects WHERE id = ?`).get(pid ?? -1) ?? {};
    ok(s1.status === 200 && row.status === "in_progress" && row.activated_at && JSON.parse(row.scope_snapshot ?? "{}").lines?.length === 2 && JSON.parse(row.scope_snapshot ?? "{}").package_version === 1, "T3 accepted on the link: the project starts and the agreed scope is frozen", s1.text.slice(0, 160));

    /* T19 - a later price change does not move the agreed scope */
    db.exec(`UPDATE sales_documents SET items = '[{"name":"Something else","qty":9,"unit_price_cents":1}]', total_cents = 9, revision = 1 WHERE id = 100`);
    try { db.exec(`UPDATE sales_package_versions SET total_cents = 1 WHERE package_id = 1`); } catch { /* none */ }
    w = (await call(`/staff/projects/${pid}`, U.aina)).j;
    ok(w?.scope?.frozen === true && w.scope.lines?.[0]?.name === "Social media management" && w.scope.lines?.[0]?.unit_price_cents === 150000 && w.scope.revised_after_activation === true && w.scope.totals?.total_cents === 530000, "T19 a later quotation or package change leaves the agreed scope as accepted (and says the quotation moved)", String(JSON.stringify(w?.scope)).slice(0, 200));

    /* T10 - T13 updates */
    const kA = "upd-mira-0001";
    const u1 = await call(`/staff/projects/${pid}/updates`, U.mira, "POST", { kind: "progress", task_id: t1.j?.id, body: "Design untuk minggu 1 & 2 sudah siap. Menunggu feedback client.", task_status: "in_progress", task_progress: 30, author_id: U.ceo }, { "Idempotency-Key": kA });
    ok(u1.status === 201, "T10 the assigned designer posts a progress update on her task", u1.text.slice(0, 160));
    const u1r = db.prepare(`SELECT author_id, created_at, body FROM task_updates WHERE id = ?`).get(u1.j?.id ?? -1);
    ok(u1r?.author_id === U.mira && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(u1r.created_at ?? ""), "T16 the update is hers, stamped by the database when posted - an author in the request is ignored", JSON.stringify(u1r));
    const u1b = await call(`/staff/projects/${pid}/updates`, U.mira, "POST", { kind: "progress", task_id: t1.j?.id, body: "Design untuk minggu 1 & 2 sudah siap. Menunggu feedback client." }, { "Idempotency-Key": kA });
    ok(n(`SELECT COUNT(*) AS n FROM task_updates WHERE author_id = 10`) === 1 && [200, 201].includes(u1b.status), "T17 the same press sent twice makes ONE update", `${u1b.status} ${n(`SELECT COUNT(*) AS n FROM task_updates WHERE author_id = 10`)}`);
    ok((await call(`/staff/projects/${pid}/updates`, U.mira, "POST", { kind: "progress", task_id: t3.j?.id, body: "Not my task" })).status === 403, "an assignee posts only on her own tasks");
    w = (await call(`/staff/projects/${pid}`, U.mira)).j;
    ok((await call(`/staff/projects/${pid}`, U.mira, "PATCH", { title: "Mine", version: w?.project?.version })).status === 403, "an assignee cannot edit the brief");
    ok((await call(`/staff/packages/1`, U.mira, "PATCH", { name: "Cheap", items: [] })).status === 403 && (await call(`/staff/projects/${pid}`, U.mira, "PATCH", { unit_price_cents: 1, version: w?.project?.version })).status === 403, "T11 an assignee editing the package or a price gets 403");
    ok((await call(`/staff/projects/${pid}/owner`, U.mira, "POST", { owner_id: U.mira, reason: "I am doing the work" })).status === 403, "T12 an assignee changing the Project Owner gets 403");
    ok((await call(`/staff/projects/${pid}/status`, U.mira, "POST", { to: "completed" })).status === 403, "an assignee cannot change the project status");
    ok((await call(`/staff/projects/${pid}/updates`, U.ed, "POST", { kind: "progress", body: "I did some of it" })).status === 403, "T13 unassigned staff cannot post official progress");
    const ask = await call(`/staff/projects/${pid}/updates`, U.ed, "POST", { kind: "assist_request", body: "I can help with captions" });
    ok(ask.status === 201 && n(`SELECT COUNT(*) AS n FROM notifications WHERE user_id = 5 AND message LIKE '%asks to help%'`) === 1, "T13 ...but may ask to help, and the owner is told", ask.text.slice(0, 120));
    let appendOnly = 0;
    try { db.exec(`UPDATE task_updates SET body = 'changed' WHERE id = ${u1.j?.id ?? -1}`); } catch { appendOnly++; }
    try { db.exec(`DELETE FROM task_updates WHERE id = ${u1.j?.id ?? -1}`); } catch { appendOnly++; }
    ok(appendOnly === 2, "T16 an update can be neither changed nor deleted - the database refuses");
    const cor = await call(`/staff/projects/${pid}/updates`, U.mira, "POST", { kind: "correction", corrects_id: u1.j?.id, body: "Correction: week 1 only, week 2 on Monday" });
    ok(cor.status === 201 && db.prepare(`SELECT body FROM task_updates WHERE id = ?`).get(u1.j?.id ?? -1)?.body?.startsWith("Design"), "a correction is a new update; the original stays");
    const ownU = await call(`/staff/projects/${pid}/updates`, U.aina, "POST", { kind: "comment", body: "Owner note for the team" });
    ok((await call(`/staff/projects/${pid}/updates`, U.mira, "POST", { kind: "correction", corrects_id: ownU.j?.id, body: "Not hers" })).status === 403, "nobody corrects another person's update except the owner and management");

    /* T14 / T15 - who sees what */
    const asEd = await call(`/staff/projects/${pid}`, U.ed);
    ok(asEd.status === 200 && asEd.j?.client?.company === "ABC Sdn Bhd" && asEd.j?.client?.contact_person === "Mr. Ahmad" && asEd.j?.tasks?.length === 3, "T14 every active staff member sees the shared project", asEd.text.slice(0, 120));
    ok(!("phone" in (asEd.j?.client ?? {})) && !("email" in (asEd.j?.client ?? {})) && !("unit_price_cents" in (asEd.j?.scope?.lines?.[0] ?? {})) && asEd.j?.scope?.totals === null && asEd.j?.project?.notes === null, "T14 ...without the contact's phone and email, prices or internal notes", JSON.stringify({ c: asEd.j?.client, l: asEd.j?.scope?.lines?.[0] ?? {}, n: asEd.j?.project?.notes }));
    const asMira = (await call(`/staff/projects/${pid}`, U.mira)).j;
    ok(asMira?.client?.phone === "0123456789" && !("unit_price_cents" in (asMira?.scope?.lines?.[0] ?? {})) && asMira?.can?.update === true && asMira?.can?.edit === false, "P-6 the assigned team sees the contact's phone, not the prices");
    const asAina = (await call(`/staff/projects/${pid}`, U.aina)).j;
    ok(asAina?.scope?.lines?.[0]?.unit_price_cents === 150000 && asAina?.can?.edit === true && asAina?.can?.complete === false, "the owner sees the prices and may edit, not confirm Completed");
    const asShop = await call(`/staff/projects/${pid}`, U.shop);
    ok(asShop.status === 403 && (await call(`/staff/projects`, U.shop)).status === 403, "T15 a customer account cannot open any project route");

    /* files: private, per project */
    const pdf = new Uint8Array(Buffer.from("%PDF-1.4\n% project brief\n"));
    const f1 = await call(`/staff/projects/${pid}/files`, U.mira, "POST", pdf, { "content-type": "application/pdf", "X-File-Name": "brief.pdf", "X-Task-Id": String(t1.j?.id) });
    ok(f1.status === 201 && f1.j?.media_id && f1.j?.id, "the assigned designer attaches a file to her task (private storage, task_files)", f1.text.slice(0, 160));
    ok((await call(`/staff/projects/${pid}/files`, U.mira, "POST", pdf, { "content-type": "application/pdf", "X-File-Name": "x.pdf", "X-File-Level": "restricted" })).status === 403, "only the owner or management add a restricted file");
    const f2 = await call(`/staff/projects/${pid}/files`, U.aina, "POST", pdf, { "content-type": "application/pdf", "X-File-Name": "contract.pdf", "X-File-Level": "restricted" });
    ok((await call(`/staff/projects/${pid}/files/${f1.j?.id}`, U.ed)).status === 200 && (await call(`/staff/projects/${pid}/files/${f2.j?.id}`, U.ed)).status === 403 && (await call(`/staff/projects/${pid}/files/${f2.j?.id}`, U.aina)).status === 200, "a team file opens for staff; a restricted one for the owner and management only");
    const key = [...store.keys()].find((k) => k.includes("contract.pdf"));
    const tkey = [...store.keys()].find((k) => k.includes("brief.pdf"));
    ok(key?.startsWith(`private/projects/${pid}/`) && (await call(`/media/file/${encodeURIComponent(key)}`, U.ed)).status === 403
      && tkey?.startsWith(`private/tasks/${t1.j?.id}/`) && (await call(`/media/file/${encodeURIComponent(tkey)}`, U.ed)).status === 403, "a project or task file is never reachable by its storage key");

    /* the owner manages the project's tasks */
    ok((await call(`/staff/tasks/${t2.j?.id}`, U.aina, "PATCH", { assigned_to: U.lia })).status === 400, "v1.246.0 - moving a project task to somebody else needs a reason");
    const ra = await call(`/staff/tasks/${t2.j?.id}`, U.aina, "PATCH", { assigned_to: U.lia, reason: "Sara is on leave next week" });
    ok(ra.status === 200 && db.prepare(`SELECT assigned_to FROM tasks WHERE id = ?`).get(t2.j?.id ?? -1)?.assigned_to === U.lia, "the Project Owner reassigns a task on her project", ra.text.slice(0, 160));
    ok((await call(`/staff/tasks/${t3.j?.id}`, U.mira, "PATCH", { assigned_to: U.mira })).status === 403, "an assignee cannot reassign another task");
    ok((await call(`/staff/tasks/${t1.j?.id}`, U.ceo, "DELETE")).status === 409 && n(`SELECT COUNT(*) AS n FROM tasks WHERE id = ${t1.j?.id}`) === 1, "a project task is never hard-deleted (its history stays)");
    /* v1.246.0 (T-2) - she submits it for review; the owner approves it */
    ok((await call(`/staff/tasks/${t1.j?.id}`, U.mira, "PATCH", { status: "completed", progress: 100 })).status === 409, "v1.246.0 - she cannot close a task the owner set: it goes for review");
    const rq = await call(`/staff/tasks/${t1.j?.id}/updates`, U.mira, "POST", { kind: "review_request", body: "All designs delivered" });
    const ap = await call(`/staff/tasks/${t1.j?.id}/review`, U.aina, "POST", { decision: "approve" });
    ok(rq.status === 201 && ap.status === 200 && db.prepare(`SELECT status FROM tasks WHERE id = ?`).get(t1.j?.id ?? -1)?.status === "completed" && db.prepare(`SELECT status FROM projects WHERE id = ?`).get(pid ?? -1)?.status === "in_progress", "her task completed (approved by the owner): the PROJECT does not move", `${rq.text.slice(0, 80)} ${ap.text.slice(0, 80)}`);

    /* The browser fixture (tests/browser/project-fixture.json) is these
       answers, captured from the real worker - never hand-written shapes.
       Written only when asked: PROJECT_FIXTURE_OUT=<file>. */
    if (process.env.PROJECT_FIXTURE_OUT && !fixtureDumped) {
      fixtureDumped = true; // the first run is the current worker; mutated runs never overwrite it
      const views = {};
      for (const [k, uid] of [["mgmt", U.ceo], ["owner", U.aina], ["assigned", U.mira], ["other", U.ed]]) {
        views[k] = {
          workspace: (await call(`/staff/projects/${pid}`, uid)).j,
          activity: (await call(`/staff/projects/${pid}/activity`, uid)).j,
          updates: (await call(`/staff/projects/${pid}/updates`, uid)).j,
          files: (await call(`/staff/projects/${pid}/files`, uid)).j,
          list: (await call(`/staff/projects?scope=all`, uid)).j,
          by_quotation: (await call(`/staff/projects/by-quotation/100`, uid)).j,
        };
      }
      views.none = { by_quotation: (await call(`/staff/projects/by-quotation/102`, U.ceo)).j };
      writeFileSync(process.env.PROJECT_FIXTURE_OUT, JSON.stringify({ captured_from: "tests/go-live-p.mjs", project_id: pid, views }, null, 1));
    }

    /* T18 - ownership transfer */
    ok((await call(`/staff/projects/${pid}/owner`, U.ceo, "POST", { owner_id: U.lia })).status === 400, "T18 a transfer needs a reason");
    const tr = await call(`/staff/projects/${pid}/owner`, U.coo, "POST", { owner_id: U.lia, reason: "Aina moves to the Penang account" });
    const au = db.prepare(`SELECT detail FROM audit_log WHERE action = 'project.owner_set' ORDER BY id`).all().map((r) => JSON.parse(r.detail));
    ok(tr.status === 200 && au.length === 2 && au[1].from === U.aina && au[1].to === U.lia && /Penang/.test(au[1].reason) && db.prepare(`SELECT salesperson_id FROM sales_documents WHERE id = 100`).get().salesperson_id === U.aina, "T18 the COO transfers ownership with a reason; both changes stay in the audit; the closer is unchanged", JSON.stringify(au));
    ok((await call(`/staff/projects/${pid}`, U.aina, "PATCH", { title: "Still mine?", version: 99 })).status === 403, "the former owner can no longer edit");

    /* completion (P-3) */
    const dr = await call(`/staff/projects/${pid}/updates`, U.mira, "POST", { kind: "done_request", body: "Semua deliverables sudah dihantar." });
    ok(dr.status === 201 && db.prepare(`SELECT status FROM projects WHERE id = ?`).get(pid ?? -1)?.status === "in_progress" && n(`SELECT COUNT(*) AS n FROM notifications WHERE user_id IN (1, 2) AND message LIKE '%is done%'`) >= 2, "a 'done' update tells the owner, CEO and COO - it does not complete the project", dr.text.slice(0, 120));
    ok((await call(`/staff/projects/${pid}/status`, U.lia, "POST", { to: "completed" })).status === 403 && (await call(`/staff/projects/${pid}/status`, U.cco, "POST", { to: "completed" })).status === 403, "P-3 the owner and the CCO cannot confirm Completed");
    const done = await call(`/staff/projects/${pid}/status`, U.ceo, "POST", { to: "completed" });
    ok(done.status === 200 && db.prepare(`SELECT status, completed_by FROM projects WHERE id = ?`).get(pid ?? -1)?.completed_by === U.ceo, "P-3 the CEO confirms Completed", done.text.slice(0, 120));
    ok((await call(`/staff/projects/${pid}/updates`, U.mira, "POST", { kind: "progress", body: "late" })).status === 409, "a completed project takes nothing more");

    /* the timeline */
    const act = (await call(`/staff/projects/${pid}/activity`, U.ed)).j?.activity ?? [];
    const kinds = act.map((e) => e.kind);
    ok(["project.create", "project.owner_set", "project.status", "task.create", "task.reassign", "update.progress", "file", "update.assist_request", "update.review_approved"].every((k) => kinds.includes(k)) && new Set(act.map((e) => e.key)).size === act.length && act.every((e) => e.at), "T11 the timeline shows creation, owner, status, tasks, reassignment, updates and files - once each, with author and time", JSON.stringify(kinds));

    /* an expired quotation never starts */
    const c3 = await call("/staff/projects", U.ceo, "POST", { quotation_id: 101 });
    ok(c3.status === 409 && (await call(`/staff/docs/101/acceptance`, U.ceo, "POST", { accepted_name: "Ahmad", channel: "phone" })).status === 409 && (await call("/staff/projects/by-quotation/101", U.ceo)).j?.can_record_acceptance === false, "T3 an expired quotation that was never accepted cannot become a project, nor be recorded as accepted - not even by the CEO (revise it first)", c3.text.slice(0, 160));
    /* v1.246.3 - the yes came on WhatsApp: the salesperson records it, then the project */
    ok((await call("/staff/projects", U.lia, "POST", { quotation_id: 102 })).status === 409, "a valid, unaccepted quotation has no project yet either");
    const rec = await call(`/staff/docs/102/acceptance`, U.lia, "POST", { accepted_name: "Puan Siti", accepted_position: "Owner", channel: "whatsapp", note: "Agreed 31-10" });
    const c4 = await call("/staff/projects", U.lia, "POST", { quotation_id: 102 });
    await call(`/staff/projects/${c4.j?.id}/owner`, U.ceo, "POST", { owner_id: U.lia });
    ok(rec.status === 201 && c4.status === 201 && (await call(`/staff/projects/${c4.j?.id}/status`, U.ceo, "POST", { to: "in_progress" })).status === 200, "the salesperson records the customer's acceptance (who, how, when), the project starts, no reason needed", `${rec.text.slice(0, 100)} ${c4.text.slice(0, 100)}`);
    const list = (await call(`/staff/projects?scope=mine`, U.lia)).j?.projects ?? [];
    ok(list.length >= 1 && list.some((p) => p.id === c4.j?.id) && list.every((p) => p.owner_id === U.lia), "the Tasks > Projects list: mine", JSON.stringify(list.map((p) => p.id)));

    /* T20 + the boundaries */
    ok(money() === money0, "T12 nothing in Sales, Commission, Payroll, the cash book or part payments was written by any project action (T19 test edit aside)");
  } catch (e) {
    out.push([false, `runtime: ${e?.stack ?? e}`]);
  } finally {
    globalThis.Date = RealDate;
  }
  return out;
}

function sourceChecks() {
  const out = [];
  const ok = (c, m) => out.push([!!c, m]);
  const src = readFileSync(join(root, "worker/src/projects.ts"), "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  ok(!/(INSERT INTO|UPDATE|DELETE FROM)\s+(sales_documents|commission_ledger|payroll_entries|payroll_payments|cashflow_entries|invoice_payments|customers|sales_packages|sales_package_versions|tasks)\b/i.test(code), "T20/§12 the project module writes to no sales, commission, payroll, cash, customer, package or task table (tasks go through POST /tasks)");
  ok(!/request\.json\(\)|body\?*\.author_id|body\?*\.role\b/.test(code), "identity and role come from the session, never from the request");
  const mig = readFileSync(join(root, "worker/migrations/0159_project_workspace.sql"), "utf8");
  ok(/CREATE UNIQUE INDEX IF NOT EXISTS ux_projects_quotation ON projects \(quotation_id\)/.test(mig) && /BEFORE UPDATE ON task_updates/.test(mig) && /BEFORE DELETE ON task_updates/.test(mig) && !/ALTER TABLE (?!\w+ ADD COLUMN)|DROP |UPDATE \w+ SET/i.test(mig.replace(/--.*$/gm, "").replace(/BEGIN[\s\S]*?END;/g, "")), "0159 is additive: one project per quotation, append-only updates, no existing table touched");
  return out;
}

let fail = 0, n = 0;
const report = (list) => { for (const [p, m] of list) { n++; if (!p) { fail++; console.error(`FAIL ${m}`); } } };
let fixtureDumped = false;
const given = process.env.WORKER_BUNDLE;
const NOMUT = process.env.NOMUT === "1" || !!given;
const dir = mkdtempSync(join(tmpdir(), "golive-p-"));
if (!given) bundle(root, "worker/src/index.ts", join(dir, "worker.mjs"));
report(await runtime(given ?? join(dir, "worker.mjs")));
if (!given) report(sourceChecks());
const checks = n;

const MUT = [
  /* both layers at once: the read-first check AND the conflict clause (the
     unique index alone then answers a second press with an error, not the project) */
  ["worker/src/projects.ts", "P-1 a second press is not answered with the same project", [["  if (existing) return { id: existing.id, existing: true };\n", ""], ["     ON CONFLICT(quotation_id) DO NOTHING RETURNING id`,", "     RETURNING id`,"]]], // v1.246.2 - ensureProject
  ["worker/src/projects.ts", "anyone with project_view edits", "  const manage = view && (mgmt || owner);", "  const manage = view;"],
  ["worker/src/projects.ts", "the CCO assigns owners", "    if (!a.ownerAssign) return err(\"forbidden\", \"Only the CEO or COO assign the Project Owner\", 403);", "    if (!a.manage) return err(\"forbidden\", \"Only the CEO or COO assign the Project Owner\", 403);"],
  ["worker/src/projects.ts", "unassigned staff post progress", "    } else if (!a.manage && !a.assigned) {\n      return err(\"forbidden\", \"Only the Project Owner, the assigned team", "    } else if (false) {\n      return err(\"forbidden\", \"Only the Project Owner, the assigned team"],
  /* v1.246.0 - the project route asks the task's own rule (tasks-progress.ts) */
  ["worker/src/tasks-progress.ts", "an assignee posts on other tasks", "  } else if (!a.update) {\n    return err(\"forbidden\", a.view", "  } else if (false) {\n    return err(\"forbidden\", a.view"],
  ["worker/src/projects.ts", "everyone sees prices and phones", "      client: cust ? { id: cust.id, company: cust.company, contact_person: cust.contact_person, ...(a.contact ? { phone: cust.phone, email: cust.email } : {}) } : null,", "      client: cust ? { id: cust.id, company: cust.company, contact_person: cust.contact_person, phone: cust.phone, email: cust.email } : null,"],
  ["worker/src/projects.ts", "the owner confirms Completed", "  if ([\"in_progress\", \"waiting_client\", \"on_hold\"].includes(from) && a.complete) out.push({ to: \"completed\", label: \"Confirm completed\" });", "  if ([\"in_progress\", \"waiting_client\", \"on_hold\"].includes(from) && (a.complete || m)) out.push({ to: \"completed\", label: \"Confirm completed\" });"],
  /* v1.246.3 - an expired quotation cannot be recorded as accepted (so it never starts) */
  ["worker/src/business.ts", "an expired quotation is recorded as accepted", "      if (d.valid_until && /^\\d{4}-\\d{2}-\\d{2}/.test(d.valid_until) && d.valid_until.slice(0, 10) < mytToday()) {\n        return err(\"expired\", `This quotation was valid until", "      if (false) {\n        return err(\"expired\", `This quotation was valid until"],
  ["worker/src/projects.ts", "the scope follows the live quotation", "    const lines = snap ? snap.lines : parseLines(qt.items);", "    const lines = parseLines(qt.items);"],
  /* both layers: the project rule and (v1.246.0) the kept-history rule */
  ["worker/src/staff.ts", "a project task is deleted", [["    if (await taskProject(env, id)) return err(\"project_task\",", "    if (false) return err(\"project_task\","], ["    if (Number(kept?.n ?? 0) > 0) return err(", "    if (false) return err("]]],
  ["worker/src/weekly-sales.ts", "anyone adds project tasks", "    const gate = await projectTaskGate(env, user, id);\n    return gate ?? { kind, id };", "    return { kind, id };"],
  ["worker/src/index.ts", "a project file is reachable by its key", "      if (key.startsWith(\"private/projects/\") || key.startsWith(\"private/tasks/\")) {", "      if (false) {"],
];
for (const [file, name, from, to] of NOMUT ? [] : MUT) {
  n++;
  const srcT = readFileSync(join(root, file), "utf8");
  const pairs = Array.isArray(from) ? from : [[from, to]];
  if (!pairs.every(([f]) => srcT.includes(f))) { fail++; console.error(`FAIL mutation did not apply: ${name}`); continue; }
  const mdir = mkdtempSync(join(tmpdir(), "golive-p-m-"));
  cpSync(join(root, "worker"), join(mdir, "worker"), { recursive: true, filter: (p) => !p.includes("node_modules") });
  cpSync(join(root, "package.json"), join(mdir, "package.json"));
  for (const d of ["lib", "constants", "types"]) { try { cpSync(join(root, d), join(mdir, d), { recursive: true }); } catch { /* not every folder exists */ } }
  writeFileSync(join(mdir, file), pairs.reduce((acc, [f, t]) => acc.replace(f, t), srcT));
  try { bundle(mdir, "worker/src/index.ts", join(mdir, "worker.mjs")); } catch { fail++; console.error(`FAIL mutation did not build: ${name}`); continue; }
  const res = await runtime(join(mdir, "worker.mjs"));
  try { rmSync(mdir, { recursive: true, force: true }); } catch { /* a temp copy the system clears anyway */ } // v1.246.0 - each mutation copied the worker and left it behind
  if (!res.some(([p]) => !p)) { fail++; console.error(`FAIL mutation not caught: ${name}`); }
  else console.log(`caught: ${name} -> ${res.filter(([p]) => !p).slice(0, 2).map(([, m]) => m.split(" - ")[0]).join("; ")}`);
}
if (fail) { console.error(`go-live-p: ${fail} of ${n} failed${given ? ` (bundle: ${given})` : ""}`); process.exit(1); }
console.log(`go-live-p: ${checks} checks passed (${NOMUT ? "mutations skipped" : `${MUT.length} mutations caught`}) - one brief per quotation, owner assigned by CEO/COO, only owner and management edit, assigned staff append updates on their own tasks, everyone sees the shared fields, prices and contacts by right, append-only, files private, the expired never start, the scope frozen, completion by CEO/COO, nothing in sales, commission or payroll touched`);
