/* TASKS WORKSPACE 5.0, GATE 4 (v1.315.0) - runtime guard (the finance5.mjs harness): the WHOLE worker bundled
 * against SQLite with every migration applied (0197 and 0198 included), by
 * direct request as each role. Fixed clock: Tuesday 10-11-2026, 12:00
 * Malaysia time. Invented fixtures only - no production data.
 *
 * The CEO's "approve as per recommend", 15-11-2026 (CEO-1..CEO-14 in
 * claude/FINANCE-WORKSPACE-5.0-BLUEPRINT.md), Phase A + B:
 *   CEO-1   Money In counts verified receipts only; the rest "awaiting"
 *   CEO-2   one company at a time; accounts, movements and expenses name
 *           their company; no transfer, assignment or payment crosses
 *   F-2     reconciliation DIFFERENCE = SOURCE - CASH BOOK (the payroll
 *           example: 13,156.66 - 13,161.66 = -5.00, never -13,161.66)
 *   CEO-6   reviewed is not resolved; only the CEO accepts a difference
 *   CEO-4   the expense lifecycle: recorded, approved (the CEO; the COO for
 *           the CEO's own), authorised (the CEO), paid by Finance (the COO)
 *           with bank date, account and evidence - the only step that
 *           books cash; a paid expense is locked; never deleted
 *   F-10    a manual movement: CEO/COO only, its company and reason, the
 *           server's reference, once per idempotency key, never a module's
 *   F-12    a transfer is CEO/COO and stays inside one company
 *   CEO-10  the Super Admin reads Finance and never posts or corrects
 *   F-5     an agent payout (AGT-) is Commission, not a typed row
 *
 *   node tests/finance5.mjs              the current worker, then mutations
 *   NOMUT=1 node tests/finance5.mjs      the current worker only
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
  const entry = join(srcRoot, "tasks-gate4-entry.ts");
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
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(200).fill(0)]);

async function runtime(workerBundle, migDir) {
  const out = [];
  const ok = (c, m, why = "") => out.push([!!c, why && !c ? `${m} - ${why}` : m]);
  const db = new DatabaseSync(":memory:");
  const realClock = new DatabaseSync(":memory:");
  const pinTs = () => new Date().toISOString().slice(0, 19).replace("T", " ");
  for (const fn of ["datetime", "date", "time", "julianday"]) db.function(fn, { varargs: true }, (...a) => realClock.prepare(`SELECT ${fn}(${(a.length ? a : ["now"]).map(() => "?").join(",")}) AS v`).get(...(a.length ? a : ["now"]).map((x) => (typeof x === "string" && x.toLowerCase() === "now" ? pinTs() : x))).v);
  db.function("strftime", { varargs: true }, (...a) => realClock.prepare(`SELECT strftime(${a.map(() => "?").join(",")}) AS v`).get(...a.map((x, i) => (i > 0 && typeof x === "string" && x.toLowerCase() === "now" ? pinTs() : x))).v);
  const RealDate = globalThis.Date;
  const fixed = Date.parse("2026-11-10T04:00:00Z");
  globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [fixed])); } static now() { return fixed; } };
  applyAll(db, migDir);
  const shim = (sql) => { const st = db.prepare(sql); let b = []; const o = {
    bind: (...a) => { b = a.map((x) => (x === undefined ? null : x)); return o; },
    first: async () => st.get(...b) ?? null, all: async () => ({ results: st.all(...b) }),
    run: async () => ({ meta: { changes: Number(st.run(...b).changes) } }), _run: () => st.run(...b) }; return o; };
  const stored = new Map();
  const env = {
    DB: { prepare: shim, batch: async (list) => { db.exec("BEGIN"); try { for (const s of list) s._run(); db.exec("COMMIT"); } catch (e) { db.exec("ROLLBACK"); throw e; } return []; } },
    SESSION_PEPPER: "pepper", COMPANY_DOMAIN: "a2z.test", ALLOWED_ORIGINS: "https://portal.a2z.test",
    MEDIA: { put: async (k, body) => { if (body && typeof body === "object" && "getReader" in body) await new Response(body).arrayBuffer(); stored.set(k, true); }, get: async (k) => (stored.has(k) ? { body: "x", httpMetadata: { contentType: "image/png" } } : null), head: async () => null, list: async () => ({ objects: [] }), delete: async () => {} },
  };
  if (!globalThis.FixedLengthStream) globalThis.FixedLengthStream = class extends TransformStream { constructor() { super(); } };
  const U = { ceo: 1, sa: 2, coo: 3, admin: 4, aina: 5, hr: 6, host: 7, cco: 8 };
  db.exec(`INSERT INTO users (id, name, full_name, email, role, is_active, password_hash, totp_enabled, totp_secret, employment_status, base_salary_cents, joined_on) VALUES
    (1,'Alif','Alif Owner','owner@a2z.test','ceo',1,'x',1,'JBSWY3DPEHPK3PXP','permanent',900000,'2024-01-01'),
    (2,'Root','System Root','root@a2z.test','super_admin',1,'x',1,'JBSWY3DPEHPK3PXP','permanent',0,'2024-01-01'),
    (3,'Ops','Ops Lead','ops@a2z.test','coo',1,'x',1,'JBSWY3DPEHPK3PXP','permanent',800000,'2024-01-01'),
    (4,'Adm','Admin Clerk','admin@a2z.test','admin',1,'x',1,'JBSWY3DPEHPK3PXP','permanent',300000,'2024-01-01'),
    (5,'Aina','Aina Seller','aina@a2z.test','sales_marketing',1,'x',1,'JBSWY3DPEHPK3PXP','permanent',300000,'2024-01-01'),
    (6,'Hana','Hana HR','hana@a2z.test','hr_admin',1,'x',1,'JBSWY3DPEHPK3PXP','permanent',400000,'2024-01-01'),
    (7,'Farid','Farid Host','farid@a2z.test','live_host',1,'x',1,'JBSWY3DPEHPK3PXP','permanent',250000,'2024-01-01'),
    (8,'Chen','Chen CCO','chen@a2z.test','cco',1,'x',1,'JBSWY3DPEHPK3PXP','permanent',700000,'2024-01-01')`);
  db.exec(`INSERT INTO system_meta (key, value) VALUES ('company_owner', '{"user_id":1}')`);
  for (let c = 1; c <= 4; c++) db.exec(`INSERT INTO customers (id, company, contact_person, created_by) VALUES (${c}, 'Client ${c} Sdn Bhd', 'Contact ${c}', 5)`);
  const ITEMS = (cents) => JSON.stringify([{ name: "Website", qty: 1, unit_price_cents: cents }]);
  const doc = db.prepare(`INSERT INTO sales_documents (id, doc_type, doc_number, customer_id, items, discount_cents, tax_percent, total_cents, payment_status, paid_at, created_at, created_by, salesperson_id, kind, issuer_code, payment_ref)
                          VALUES (?, 'INV', ?, ?, ?, 0, 0, ?, ?, ?, '2026-11-02 01:00:00', 5, 5, 'service', ?, ?)`);
  doc.run(101, "INV-T-101", 1, ITEMS(100000), 100000, "paid", "2026-11-05 02:00:00", "a2z", "MBB-101");   // A2Z, paid, to be verified by the CEO
  doc.run(102, "INV-T-102", 2, ITEMS(50000), 50000, "paid", "2026-11-06 02:00:00", "azoo", "MBB-102");   // AZ ONE, paid, not verified
  doc.run(103, "INV-T-103", 3, ITEMS(90000), 90000, "unpaid", null, "a2z", null);                         // A2Z, a part payment of RM 300
  db.exec(`INSERT INTO invoice_payments (id, invoice_id, amount_cents, received_on, reference, created_by) VALUES (7, 103, 30000, '2026-11-07', 'MBB-P7', 3)`);
  /* the payroll example: the bank run booked RM 13,161.66; payroll now totals RM 13,156.66 */
  db.exec(`INSERT INTO payroll_entries (user_id, month, basic_cents, commission_cents, allowance_cents, deduction_cents, net_cents) VALUES (5, '2026-08', 1315666, 0, 0, 0, 1315666)`);
  db.exec(`INSERT INTO payroll_payments (month, paid_by, paid_at) VALUES ('2026-08', 3, '2026-09-04 02:24:00')`);
  db.exec(`INSERT INTO cashflow_entries (id, entry_date, type, category, amount_cents, description, ref, created_by, effective_date, source_key) VALUES (50, '2026-09-04', 'out', 'salaries', 1316166, 'Payroll bank run 2026-08', 'PAYROLL-2026-08', 3, '2026-09-04', 'PAYROLL-2026-08')`);
  /* an agent payout settled by Finance (Commission 5.0, K-5) */
  db.exec(`INSERT INTO cashflow_entries (id, entry_date, type, category, amount_cents, description, ref, created_by, effective_date, source_key) VALUES (51, '2026-11-09', 'out', 'agent_commission', 7000, 'Agent commission payout AGT-9 - Ros', 'AGT-9', 3, '2026-11-09', 'AGT-9')`);

  const app = (await import(pathToFileURL(workerBundle).href + `?v=${Math.random()}`)).default;
  const tok = {};
  for (const id of Object.values(U)) { tok[id] = `t-${id}-${Math.random()}`; db.prepare(`INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, datetime('now', '+12 hours'), datetime('now'))`).run(sha(tok[id]), id); }
  const hdr = (uid, extra = {}) => ({ origin: "https://portal.a2z.test", cookie: `azone_session=${tok[uid]}; csrf_token=c1`, "x-csrf-token": "c1", "content-type": "application/json", ...extra });
  const call = async (p, uid, method = "GET", body) => {
    const r = await app.fetch(new Request(`https://api.a2z.test/api/v1/staff${p}`, { method, headers: hdr(uid), body: body === undefined ? undefined : JSON.stringify(body) }), env, { waitUntil() {} });
    const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch { /* not json */ }
    return { status: r.status, j, text };
  };
  const attach = async (id, uid) => (await app.fetch(new Request(`https://api.a2z.test/api/v1/staff/expenses/${id}/evidence`, { method: "POST", headers: hdr(uid, { "content-type": "image/png", "content-length": String(PNG.length) }), body: PNG }), env, { waitUntil() {} })).status;
  const n = (sql, ...a) => Number(db.prepare(sql).get(...a)?.n ?? 0);
  const row = (sql, ...a) => db.prepare(sql).get(...a);
  const view = async (company = "all", uid = U.ceo, from = "2026-11-01", to = "2026-11-30") => (await call(`/erp/cashbook?from=${from}&to=${to}&company=${company}`, uid)).j;
  const fmt = (x) => JSON.stringify(x)?.slice(0, 300);
  const upload = async (rid, uid, type = "image/png", bytes = PNG) => (await app.fetch(new Request(`https://api.a2z.test/api/v1/staff/live-reports/${rid}/files`, { method: "POST", headers: hdr(uid, { "content-type": type, "content-length": String(bytes.length), "x-file-name": "gmv.png" }), body: bytes }), env, { waitUntil() {} })).status;
  const throws = (sql) => { try { db.exec(sql); return false; } catch { return true; } };
  const money = () => ["sales_documents", "invoice_payments", "cashflow_entries", "journal_entries", "payroll_entries", "commission_ledger", "agent_payouts"].map((t) => { try { return n(`SELECT COUNT(*) AS n FROM ${t}`); } catch { return -1; } }).join(",");
  try {
    /* ---------- TK-4: the title, its reason and its history ---------- */
    const T = (await call("/tasks", U.ceo, "POST", { title: "Tugasan Mingguan (2/11-6/11)", assigned_to: U.aina, deadline: "2026-11-20", priority: "normal" })).j?.id;
    ok(T, "a task is set (CEO to Aina)");
    const before = row(`SELECT assigned_to, deadline, priority, status, progress FROM tasks WHERE id = ?`, T);
    ok((await call(`/tasks/${T}`, U.hr, "PATCH", { title: "Renamed by HR", reason: "Tidy the title" })).status === 403, "TK-4 the HR admin no longer renames another person's task");
    ok((await call(`/tasks/${T}`, U.admin, "PATCH", { title: "Renamed by Admin", reason: "Tidy the title" })).status === 403, "TK-4 the Admin no longer renames another person's task");
    ok((await call(`/tasks/${T}`, U.coo, "PATCH", { title: "Tugasan Mingguan" })).status === 400, "TK-4 management renames another person's task only with a reason");
    ok((await call(`/tasks/${T}`, U.coo, "PATCH", { title: "Tugasan Mingguan", reason: "The period lives in the dates" })).status === 200, "TK-4 the COO renames it, with the reason");
    const h1 = row(`SELECT old_title, new_title, reason, changed_by FROM task_title_history WHERE task_id = ? ORDER BY id DESC`, T);
    ok(h1?.old_title === "Tugasan Mingguan (2/11-6/11)" && h1?.new_title === "Tugasan Mingguan" && h1?.reason === "The period lives in the dates" && h1?.changed_by === U.coo, "the history keeps old, new, who and why", fmt(h1));
    const after = row(`SELECT assigned_to, deadline, priority, status, progress FROM tasks WHERE id = ?`, T);
    ok(JSON.stringify(before) === JSON.stringify(after), "nothing else about the task moved (assignee, dates, priority, status, progress)", fmt([before, after]));
    ok((await call(`/tasks/${T}`, U.aina, "PATCH", { title: "Tugasan Mingguan - Aina" })).status === 200 && n(`SELECT COUNT(*) AS n FROM task_title_history WHERE task_id = ?`, T) === 2, "the assignee renames their own task (T2) and it is kept too");
    ok((await call(`/tasks/${T}`, U.cco, "PATCH", { title: "Tugasan Mingguan", reason: "Back to the plain name" })).status === 200, "TK-4 the CCO renames with the reason");
    ok(throws(`UPDATE task_title_history SET new_title = 'x' WHERE task_id = ${T}`) && throws(`DELETE FROM task_title_history WHERE task_id = ${T}`), "0199 the title history cannot be rewritten or deleted");
    ok(String(row(`SELECT detail FROM audit_log WHERE action = 'task.update' AND entity_id = ? ORDER BY id DESC`, String(T))?.detail ?? "").includes("Back to the plain name"), "the audit row carries the reason");

    /* ---------- 0200: an operational report is reviewed, never by its author ---------- */
    ok((await call("/task-reports", U.ceo, "POST", { period: "weekly", report_date: "2026-11-09", content: "Week 46: four lives, two over target.", kind: "project" })).status === 201, "a report is written with its type");
    const RP = n(`SELECT MAX(id) AS n FROM task_reports`);
    ok(row(`SELECT kind, status FROM task_reports WHERE id = ?`, RP)?.kind === "project" && row(`SELECT status FROM task_reports WHERE id = ?`, RP)?.status === "submitted", "…as submitted");
    ok((await call(`/task-reports/${RP}/review`, U.ceo, "POST", { note: "ok" })).status === 403, "its author never reviews it");
    ok((await call(`/task-reports/${RP}/review`, U.hr, "POST", { note: "ok" })).status === 403, "the HR admin does not review reports (CEO, COO, CCO)");
    ok((await call(`/task-reports/${RP}/review`, U.coo, "POST", { note: "Seen - keep the pace" })).status === 200, "the COO reviews it");
    ok((await call(`/task-reports/${RP}/review`, U.cco, "POST", {})).status === 409, "…once");
    { const l = (await call("/task-reports", U.ceo)).j; const r = (l?.reports ?? []).find((x) => x.id === RP); ok(r?.status === "reviewed" && r?.reviewer && r?.review_note === "Seen - keep the pace", "the list shows reviewed, who and the note", fmt(r)); }

    /* ---------- 0201: the Live Host Report ---------- */
    db.exec(`INSERT INTO live_sessions (id, session_date, start_time, end_time, platform, host_user_id, status, created_by) VALUES
      (1, '2026-11-09', '20:00', '22:15', 'tiktok', 7, 'completed', 1),
      (2, '2026-11-20', '20:00', '22:00', 'tiktok', 7, 'scheduled', 1),
      (3, '2026-11-08', '14:00', '16:00', 'shopee', 5, 'completed', 1),
      (4, '2026-11-07', '20:00', '22:00', 'tiktok', 7, 'cancelled', 1),
      (5, '2026-11-08', '10:00', '11:00', 'tiktok', 1, 'completed', 1)`);
    const m0 = money();
    ok((await call("/live-reports", U.host, "POST", { session_id: 3 })).status === 403, "L2 a host reports only their own session");
    ok((await call("/live-reports", U.host, "POST", { session_id: 2 })).status === 409, "…that has happened");
    ok((await call("/live-reports", U.host, "POST", { session_id: 4 })).status === 409, "…and was not cancelled");
    ok((await call("/live-reports", U.host, "POST", { session_id: 99 })).status === 404, "…and is on the roster");
    const L = (await call("/live-reports", U.host, "POST", { session_id: 1 })).j?.id;
    ok(L && (await call("/live-reports", U.host, "POST", { session_id: 1 })).j?.id === L, "one report per session", String(L));
    ok(row(`SELECT host_user_id FROM live_reports WHERE id = ?`, L)?.host_user_id === U.host, "the host is the session's host, not what the browser says");
    ok((await call(`/live-reports/${L}`, U.aina)).status === 403 && (await call(`/live-reports/${L}`, U.ceo)).status === 200, "another staff member cannot read it; a reviewer can");
    ok((await call(`/live-reports/${L}/submit`, U.host, "POST", {})).status === 400, "nothing is submitted without the GMV");
    ok((await call(`/live-reports/${L}/draft`, U.host, "PUT", { gmv: -5 })).status === 400, "GMV is zero or more");
    ok((await call(`/live-reports/${L}/draft`, U.aina, "PUT", { gmv: 10 })).status === 403, "only the host keeps the draft");
    ok((await call(`/live-reports/${L}/draft`, U.host, "PUT", { gmv: "2480.50", duration_min: 135, highlights: "12.4K viewers", blockers: "Stream lag at 8:50 PM", next_actions: "Recheck stock sync", company: "a2z" })).status === 200, "the host saves the draft");
    ok((await call(`/live-reports/${L}/submit`, U.host, "POST", {})).j?.error?.code === "evidence_required", "TK-14 no submission without a GMV screenshot");
    ok(await upload(L, U.host, "text/plain") === 400, "a screenshot is an image");
    ok(await upload(L, U.aina) === 403, "only the host attaches it");
    for (let i = 0; i < 4; i++) await upload(L, U.host);
    ok(await upload(L, U.host) === 409, "up to four screenshots a submission");
    ok((await call(`/live-reports/${L}/submit`, U.host, "POST", {})).j?.version === 1, "the host submits: version 1");
    ok(row(`SELECT state FROM live_reports WHERE id = ?`, L)?.state === "submitted" && n(`SELECT COUNT(*) AS n FROM live_report_files WHERE report_id = ? AND version = 1`, L) === 4, "…the screenshots are the version's");
    ok((await call(`/live-reports/${L}/draft`, U.host, "PUT", { gmv: 9999 })).status === 409 && await upload(L, U.host) === 409, "a submitted report is kept as submitted");
    ok((await call(`/live-reports/${L}/review`, U.host, "POST", { action: "accept" })).status === 403, "the host does not review");
    ok((await call(`/live-reports/${L}/review`, U.hr, "POST", { action: "accept" })).status === 403, "L3 the HR admin does not review");
    ok((await call(`/live-reports/${L}/review`, U.coo, "POST", { action: "return", note: "fix" })).status === 400, "a return says what to correct");
    ok((await call(`/live-reports/${L}/review`, U.coo, "POST", { action: "return", note: "The GMV screenshot is cut off - attach the full one" })).j?.state === "returned", "the COO returns it for correction");
    ok((await call(`/live-reports/${L}/submit`, U.host, "POST", {})).j?.error?.code === "evidence_required", "a correction carries its own screenshot");
    await upload(L, U.host);
    await call(`/live-reports/${L}/draft`, U.host, "PUT", { gmv: "2510.00", duration_min: 135, company: "a2z" });
    ok((await call(`/live-reports/${L}/submit`, U.host, "POST", {})).j?.version === 2, "the corrected report is version 2");
    ok(row(`SELECT gmv_cents FROM live_report_versions WHERE report_id = ? AND version = 1`, L)?.gmv_cents === 248050 && row(`SELECT gmv_cents FROM live_report_versions WHERE report_id = ? AND version = 2`, L)?.gmv_cents === 251000, "both versions are kept with their own figures");
    ok((await call(`/live-reports/${L}/review`, U.cco, "POST", { action: "review", note: "Looked at it" })).j?.state === "reviewed", "the CCO reviews it");
    ok((await call(`/live-reports/${L}/review`, U.ceo, "POST", { action: "accept" })).j?.state === "accepted", "the CEO accepts it");
    ok((await call(`/live-reports/${L}/review`, U.ceo, "POST", { action: "accept" })).status === 409, "…once");
    ok((await call(`/live-reports/${L}/review`, U.ceo, "POST", { action: "reopen", note: "x" })).status === 400 && (await call(`/live-reports/${L}/review`, U.ceo, "POST", { action: "reopen", note: "Client disputed the GMV figure" })).j?.state === "returned", "an accepted report reopens only with a reason");
    ok(n(`SELECT COUNT(*) AS n FROM live_report_reviews WHERE report_id = ?`, L) === 4, "every review is kept (return, review, accept, reopen)", String(n(`SELECT COUNT(*) AS n FROM live_report_reviews WHERE report_id = ?`, L)));
    ok(throws(`UPDATE live_report_versions SET gmv_cents = 1 WHERE report_id = ${L}`) && throws(`DELETE FROM live_report_versions WHERE report_id = ${L}`), "0201 a submitted version cannot be rewritten or deleted");
    ok(throws(`UPDATE live_report_files SET r2_key = 'x' WHERE report_id = ${L} AND version = 1`) && throws(`DELETE FROM live_report_files WHERE report_id = ${L}`), "0201 a submitted screenshot is kept");
    ok(throws(`DELETE FROM live_report_reviews WHERE report_id = ${L}`), "0201 the reviews are append-only");
    { const f = n(`SELECT MIN(id) AS n FROM live_report_files WHERE report_id = ?`, L);
      const get = async (uid) => (await app.fetch(new Request(`https://api.a2z.test/api/v1/staff/live-reports/${L}/files/${f}`, { headers: hdr(uid) }), env, { waitUntil() {} })).status;
      ok(await get(U.host) === 200 && await get(U.ceo) === 200 && await get(U.aina) === 403, "a screenshot is the host's and the reviewers' only"); }
    const C = (await call("/live-reports", U.ceo, "POST", { session_id: 5 })).j?.id;
    await call(`/live-reports/${C}/draft`, U.ceo, "PUT", { gmv: 100, company: "azoo" }); await upload(C, U.ceo); await call(`/live-reports/${C}/submit`, U.ceo, "POST", {});
    ok((await call(`/live-reports/${C}/review`, U.ceo, "POST", { action: "accept" })).status === 403, "L3 the CEO never reviews a live the CEO hosted");
    ok(money() === m0, "reported GMV touches no sales, payment, cash, journal, payroll or commission row", `${m0} -> ${money()}`);
    { const l = (await call("/live-reports", U.host)).j; ok((l?.reports ?? []).every((r) => r.host_user_id === U.host) && (l?.reports ?? []).length === 1, "the host lists only their own reports", fmt(l?.reports?.map((r) => r.id))); }

    /* ---------- 0202: deliverables to tick, the client's acceptance ---------- */
    db.exec(`INSERT INTO sales_documents (id, doc_type, doc_number, customer_id, items, discount_cents, tax_percent, total_cents, created_at, created_by, salesperson_id, kind, issuer_code) VALUES (301, 'QT', 'QT-T-301', 4, '[]', 0, 0, 100000, '2026-10-01 01:00:00', 5, 5, 'service', 'a2z')`);
    db.exec(`INSERT INTO projects (id, quotation_id, customer_id, owner_id, status, title, deliverables, version, created_by) VALUES (1, 301, 4, 5, 'in_progress', 'Video Live Package', '["Shoot", "Edit"]', 1, 1)`);
    ok((await call("/projects/1", U.ceo, "PATCH", { version: 1, deliverables: ["Shoot", "Edit", "Deliver"] })).status === 200, "the deliverables list is edited");
    ok(n(`SELECT COUNT(*) AS n FROM project_deliverables WHERE project_id = 1 AND removed_at IS NULL`) === 3, "TK-9 each deliverable is a row");
    const D = n(`SELECT id AS n FROM project_deliverables WHERE project_id = 1 AND title = 'Shoot'`);
    ok((await call(`/projects/1/deliverables/${D}`, U.hr, "POST", { done: true })).status === 403, "a deliverable is ticked by the Project Owner or management only");
    ok((await call(`/projects/1/deliverables/${D}`, U.aina, "POST", { done: true, due_on: "2026-11-10" })).status === 200 && row(`SELECT done_by, due_on FROM project_deliverables WHERE id = ?`, D)?.done_by === U.aina, "the Project Owner ticks it, with its due date");
    ok(n(`SELECT COUNT(*) AS n FROM tasks WHERE link_kind = 'project' AND link_id = 1 AND status = 'completed'`) === 0, "a ticked deliverable is not a closed task");
    ok((await call("/projects/1", U.ceo, "PATCH", { version: 2, deliverables: ["Shoot", "Deliver"] })).status === 200 && n(`SELECT COUNT(*) AS n FROM project_deliverables WHERE project_id = 1`) === 3 && n(`SELECT COUNT(*) AS n FROM project_deliverables WHERE project_id = 1 AND removed_at IS NOT NULL`) === 1, "a deliverable taken out is marked removed, never deleted");
    ok(throws(`DELETE FROM project_deliverables WHERE project_id = 1`), "0202 a deliverable row cannot be deleted");
    ok((await call("/projects/1/status", U.ceo, "POST", { to: "completed" })).j?.error?.code === "acceptance_required", "TK-15 a project completes only after the client's acceptance");
    ok((await call("/projects/1/acceptance", U.hr, "POST", { accepted_on: "2026-11-09", client_name: "Puan Aminah" })).status === 403, "only the Project Owner or management record it");
    ok((await call("/projects/1/acceptance", U.aina, "POST", { accepted_on: "2026-12-30", client_name: "Puan Aminah" })).status === 400, "not dated in the future");
    ok((await call("/projects/1/acceptance", U.aina, "POST", { accepted_on: "2026-11-09", client_name: "Puan Aminah", note: "Final cut approved on WhatsApp" })).status === 201, "the Project Owner records the client's acceptance");
    ok(throws(`UPDATE project_acceptances SET client_name = 'x'`) && throws(`DELETE FROM project_acceptances`), "0202 an acceptance is kept as recorded");
    ok((await call("/projects/1/status", U.ceo, "POST", { to: "completed" })).status === 200, "…then the CEO confirms it completed");
    { const w = (await call("/projects/1", U.ceo)).j?.project; ok((w?.deliverable_rows ?? []).length === 2 && (w?.acceptances ?? []).length === 1, "the project read carries its deliverable rows and acceptance", fmt(w?.deliverable_rows)); }
  } catch (e) { ok(false, "the run threw", String(e?.stack ?? e).slice(0, 400)); }
  globalThis.Date = RealDate;
  return out;
}

let n = 0, fail = 0;
const report = (res) => { for (const [p, m] of res) { n++; if (!p) { fail++; console.error(`FAIL ${m}`); } } };
const dir = mkdtempSync(join(tmpdir(), "tasksg4-"));
const main = join(dir, "worker.mjs");
bundle(root, main);
report(await runtime(main, join(root, "worker/migrations")));
const checks = n;
if (process.env.NOMUT) {
  rmSync(dir, { recursive: true, force: true });
  if (fail) { console.error(`tasks-gate4: ${fail} of ${n} failed`); process.exit(1); }
  console.log(`tasks-gate4: ${n} checks passed`); process.exit(0);
}
if (fail) { console.error(`tasks-gate4: ${fail} of ${n} failed (mutations not run)`); process.exit(1); }

const MUT = [
  ["worker/src/staff.ts", "TK-4 any manager renames", 'if (!projOfTask && !canUser(user, "task_rename")) return err(', 'if (false) return err('],
  ["worker/src/staff.ts", "TK-4 no reason needed", 'if (titleReason.length < 5) return err("invalid_input", "Say why the title changes', 'if (false) return err("invalid_input", "Say why the title changes'],
  ["worker/src/staff.ts", "a report reviewed by its author", 'if (rep.created_by === user.id) return err("self_approval"', 'if (false) return err("self_approval"'],
  ["worker/src/live-reports.ts", "L2 another host's session reported", 'if (s.host_user_id !== user.id) return err("forbidden", "Only the host of this live reports it", 403);', ''],
  ["worker/src/live-reports.ts", "TK-14 submitted without a screenshot", 'if (!Number(n?.n ?? 0)) return err("evidence_required"', 'if (false) return err("evidence_required"'],
  ["worker/src/live-reports.ts", "L3 a host reviews their own report", 'if (r.host_user_id === user.id) return err("self_approval"', 'if (false) return err("self_approval"'],
  ["worker/src/live-reports.ts", "a returned report needs no correction note", 'return: { from: ["submitted", "reviewed"], to: "returned", need: 10 },', 'return: { from: ["submitted", "reviewed"], to: "returned", need: 0 },'],
  ["worker/src/live-reports.ts", "a screenshot open to every staff member", 'if (r.host_user_id !== user.id && !reviewer) return err("forbidden", "Not your report", 403);\n      const f = ', 'const f = '],
  ["worker/src/projects.ts", "TK-15 completed without acceptance", 'if (acc !== null && acc.length === 0) return err("acceptance_required"', 'if (false) return err("acceptance_required"'],
  ["worker/src/projects.ts", "a removed deliverable deleted", "stmts.push(env.DB.prepare(`UPDATE project_deliverables SET removed_at = datetime('now'), removed_by = ?1 WHERE id = ?2`).bind(by, r.id));", "stmts.push(env.DB.prepare(`UPDATE project_deliverables SET title = title WHERE id = ?1`).bind(r.id));"],
];
for (const [file, name, from, to] of MUT) {
  n++;
  const src = readFileSync(join(root, file), "utf8");
  if (!src.includes(from)) { fail++; console.error(`FAIL mutation did not apply: ${name}`); continue; }
  const mdir = mkdtempSync(join(tmpdir(), "tasksg4-m-"));
  cpSync(join(root, "worker"), join(mdir, "worker"), { recursive: true, filter: (p) => !p.includes("node_modules") });
  cpSync(join(root, "package.json"), join(mdir, "package.json"));
  for (const d of ["lib", "constants", "types"]) { try { cpSync(join(root, d), join(mdir, d), { recursive: true }); } catch { /* not every folder exists */ } }
  writeFileSync(join(mdir, file), src.replace(from, to));
  try { bundle(mdir, join(mdir, "w.mjs")); } catch { fail++; console.error(`FAIL mutation did not build: ${name}`); continue; }
  const res = await runtime(join(mdir, "w.mjs"), join(mdir, "worker/migrations"));
  const bad = res.filter(([p]) => !p).map(([, m]) => m);
  if (!bad.length) { fail++; console.error(`FAIL mutation not caught: ${name}`); }
  else console.log(`caught: ${name} -> ${bad.slice(0, 2).join("; ")}`);
  rmSync(mdir, { recursive: true, force: true });
}
rmSync(dir, { recursive: true, force: true });
if (fail) { console.error(`tasks-gate4: ${fail} of ${n} failed`); process.exit(1); }
console.log(`tasks-gate4: ${checks} checks passed (${MUT.length} mutations caught) - Tasks 5.0 Gate 4: titles renamed by management with the reason and kept, reports reviewed never by their author, the Live Host Report on its own session with screenshot evidence, versions and reviews kept, GMV touching no money, deliverables ticked, completion after the client's acceptance`);
