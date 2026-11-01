/* TASK PROGRESS (v1.246.0) - runtime guard: the WHOLE worker (index.ts,
 * bundled) against SQLite with every migration applied (0159 included), by
 * direct request as each role, on a fixed clock: Saturday 31-10-2026,
 * 15:00 Malaysia time.
 *
 * The owner's brief "A2Z OS - Task Assignment, Progress Reporting, Comments
 * & Quotation Project Integration", approved 01-11-2026 with decisions T-1 to
 * T-9 (claude/TASK-PROGRESS-AUDIT.md). The brief's 22 acceptance tests are
 * numbered S1..S22 below; the audit's defects A1..A13 are named where they
 * are proven fixed.
 *
 *   node tests/go-live-t.mjs                                  the current worker, then mutations
 *   WORKER_BUNDLE=/path/worker.mjs node tests/go-live-t.mjs   a given bundle (the pre-fix bundle must FAIL)
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
  const U = { ceo: 1, coo: 2, cco: 3, aina: 5, lia: 6, mira: 10, ed: 11, root: 8, shop: 9, gone: 12, hana: 13, farid: 14 };
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
    (12,'Gone','Gone Seller','gone@a2z.test','sales_marketing',1,'x',1,'${SECRET}','Sales','resigned','2020-01-01','2026-10-01'),
    (13,'Hana','Hana HR','hana@a2z.test','hr_admin',1,'x',1,'${SECRET}','HR','permanent','2020-01-01',NULL),
    (14,'Farid','Farid Zulkifli','farid@a2z.test','live_host',1,'x',1,'${SECRET}','Live','permanent','2020-01-01',NULL)`);
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
    const tid = (r) => r?.j?.id ?? r?.j?.task?.id ?? 999999;
    /* The browser fixture (tests/browser/task-fixture.json) is these answers,
       captured from the real worker - never hand-written shapes. Written only
       when asked: TASK_FIXTURE_OUT=<file>, on the first (unmutated) run. */
    const capture = async (key, uid, id, all) => {
      if (!process.env.TASK_FIXTURE_OUT || captured.done) return;
      const v = { detail: (await call(`/staff/tasks/${id}`, uid)).j, updates: (await call(`/staff/tasks/${id}/updates`, uid)).j, files: (await call(`/staff/tasks/${id}/files`, uid)).j, activity: (await call(`/staff/tasks/${id}/activity`, uid)).j };
      const cm = await call(`/staff/tasks/${id}/comments`, uid);
      v.comments = cm.status === 200 ? cm.j : null;
      v.list = ((await call(`/staff/tasks${all ? "?all=1" : ""}`, uid)).j?.tasks ?? []).filter((t) => t.id === id);
      captured.views[key] = v; captured.ids[key] = id;
    };

    const lastAudit = (action) => { const r = db.prepare(`SELECT detail FROM audit_log WHERE action = ? ORDER BY id DESC LIMIT 1`).get(action); try { return JSON.parse(r?.detail ?? "{}"); } catch { return {}; } };
    const note = (uid, like) => n(`SELECT COUNT(*) AS n FROM notifications WHERE user_id = ${uid} AND message LIKE '${like}'`);

    /* ---------- S1 / S2 / S6 a standalone task, assigned, in My Tasks ---------- */
    const c1 = await call("/staff/tasks", U.ceo, "POST", { title: "Financing application - Maybank SME", assigned_to: U.farid, deadline: "2026-11-20", priority: "high", items: ["Collect statements", "Fill the form", "Get signatures", "Submit to bank", "Follow up"] });
    const T1 = c1.j?.id ?? 999999;
    ok([200, 201].includes(c1.status) && T1 !== 999999, "S1 an ordinary standalone task is created (no quotation, no project)", c1.text.slice(0, 160));
    const farList = (await call("/staff/tasks", U.farid)).j?.tasks ?? [];
    ok(farList.some((t) => t.id === T1 && t.assigned_to === U.farid), "S2/S6 it is assigned to one person and appears in that person's My Tasks", JSON.stringify(farList.map((t) => t.id)));
    const d1 = await call(`/staff/tasks/${T1}`, U.farid);
    ok(d1.status === 200 && d1.j?.task?.assignee === "Farid Zulkifli" && d1.j?.task?.creator === "Alif Farhan" && d1.j?.task?.items?.length === 5 && d1.j?.task?.link === null, "S1 the task detail names who does it and who set it, with its checklist", d1.text.slice(0, 200));

    /* ---------- S3 reassign, authorised and audited ---------- */
    ok((await call(`/staff/tasks/${T1}`, U.lia, "PATCH", { assigned_to: U.mira })).status === 403, "S3 a salesperson without team rights cannot reassign");
    ok((await call(`/staff/tasks/${T1}`, U.farid, "PATCH", { assigned_to: U.mira })).status === 403, "S3 the assignee cannot hand it on");
    const ra = await call(`/staff/tasks/${T1}`, U.ceo, "PATCH", { assigned_to: U.mira, reason: "Farid is on the TikTok live all week" });
    const ra1 = lastAudit("task.update");
    ok(ra.status === 200 && ra1.reassigned_to === U.mira && ra1.from === U.farid && /TikTok/.test(ra1.reason ?? "") && note(U.farid, "%No longer yours%") === 1 && note(U.mira, "%Task moved to you%") === 1, "S3 the CEO reassigns with a reason: audited from and to with the reason, both people told", JSON.stringify(ra1));
    await call(`/staff/tasks/${T1}`, U.ceo, "PATCH", { assigned_to: U.farid, reason: "Back to Farid, the live was moved" });

    /* ---------- A3 / T-3 the assignee edits, recorded old -> new, the assigner told ---------- */
    const ed1 = await call(`/staff/tasks/${T1}`, U.farid, "PATCH", { deadline: "2026-11-27" });
    const ch = lastAudit("task.update").changed ?? {};
    ok(ed1.status === 200 && ch.deadline?.[0] === "2026-11-20" && ch.deadline?.[1] === "2026-11-27" && note(U.ceo, "%changed Financing application%2026-11-20 → 2026-11-27%") === 1, "T-3 the assignee still moves the due date - recorded old and new, and the person who set it is told", JSON.stringify(ch));

    /* ---------- S19 / A1 / A7 the checklist drives progress ---------- */
    const items = (await call(`/staff/tasks/${T1}/items`, U.farid)).j?.items ?? [];
    await call(`/staff/tasks/${T1}/items/${items[0]?.id}/toggle`, U.farid, "POST", {});
    await call(`/staff/tasks/${T1}/items/${items[1]?.id}/toggle`, U.farid, "POST", {});
    await call(`/staff/tasks/${T1}/items/${items[2]?.id}/toggle`, U.farid, "POST", {});
    await call(`/staff/tasks/${T1}/items/${items[2]?.id}/toggle`, U.farid, "POST", {}); // untick
    const t1r = db.prepare(`SELECT progress, progress_source FROM tasks WHERE id = ?`).get(T1);
    ok(t1r?.progress === 40 && t1r?.progress_source === "checklist", "S19 2 of 5 deliverables ticked = 40%, and the task says the number is the checklist's", JSON.stringify(t1r));
    ok((await call(`/staff/tasks/${T1}`, U.farid, "PATCH", { progress: 90 })).status === 409 && db.prepare(`SELECT progress FROM tasks WHERE id = ?`).get(T1)?.progress === 40, "A1 a typed percentage cannot overwrite the checklist's");
    ok((await call(`/staff/tasks/${T1}/updates`, U.farid, "POST", { kind: "progress", body: "Almost there", progress: 90 })).status === 409, "A1 ...not inside an update either");
    const evs = db.prepare(`SELECT kind FROM task_events WHERE task_id = ? AND kind LIKE 'item_%' ORDER BY id`).all(T1).map((r) => r.kind);
    ok(evs.length === 4 && evs[3].startsWith("item_undone:"), "A7 every tick and untick is kept - unticking no longer erases who ticked it", JSON.stringify(evs));

    /* ---------- S7 - S10 / S18 structured progress, evidence, latest update, history ---------- */
    const k1 = "upd-farid-0001";
    const u1 = await call(`/staff/tasks/${T1}/updates`, U.farid, "POST", { kind: "progress", body: "Statements collected, form half filled.", completed_work: "3 months of statements", blockers: "", next_action: "Get the director's signature", author_id: U.ceo }, { "Idempotency-Key": k1 });
    const u1b = await call(`/staff/tasks/${T1}/updates`, U.farid, "POST", { kind: "progress", body: "Statements collected, form half filled." }, { "Idempotency-Key": k1 });
    const u1r = db.prepare(`SELECT * FROM task_updates WHERE id = ?`).get(u1.j?.id ?? -1);
    ok(u1.status === 201 && u1r?.author_id === U.farid && u1r?.task_id === T1 && u1r?.project_id === null && u1r?.progress_snapshot === 40 && u1r?.status_to === "in_progress" && u1r?.next_action === "Get the director's signature", "S7 the assignee submits a structured update - author from the session (the request's author ignored), the task, the status and progress of that moment", JSON.stringify(u1r));
    ok(n(`SELECT COUNT(*) AS n FROM task_updates WHERE client_key = '${k1}'`) === 1 && u1b.j?.id === u1.j?.id, "S18 the same press retried makes ONE update (the same answer comes back)", u1b.text.slice(0, 120));
    const pdf = new Uint8Array(Buffer.from("%PDF-1.4\n% statements\n"));
    const f1 = await call(`/staff/tasks/${T1}/files`, U.farid, "POST", pdf, { "content-type": "application/pdf", "X-File-Name": "statements.pdf", "X-Update-Id": String(u1.j?.id), "Idempotency-Key": "file-farid-1" });
    const fkey = [...store.keys()].find((k) => k.includes("statements.pdf"));
    ok(f1.status === 201 && fkey?.startsWith(`private/tasks/${T1}/`) && (await call(`/media/file/${encodeURIComponent(fkey)}`, U.farid)).status === 403 && (await call(`/staff/tasks/${T1}/files/${f1.j?.id}`, U.farid)).status === 200, "S7/A4 evidence is uploaded by the assignee into private storage, opened only through the task", f1.text.slice(0, 120));
    ok((await call(`/staff/tasks/${T1}/files/${f1.j?.id}`, U.ed)).status === 403, "A4 ...never by somebody who is not on it");
    let list = (await call("/staff/tasks?all=1", U.ceo)).j?.tasks ?? [];
    let row = list.find((t) => t.id === T1);
    ok(row?.latest_update?.body === "Statements collected, form half filled." && row?.latest_update?.by === "Farid Zulkifli" && /^\d{4}-\d{2}-\d{2} /.test(row?.latest_update?.at ?? ""), "S8 All Tasks shows the latest update, by whom and when", JSON.stringify(row?.latest_update));
    await call(`/staff/tasks/${T1}/comments`, U.farid, "POST", { comment: "A question for Alif, not a report" });
    list = (await call("/staff/tasks?all=1", U.ceo)).j?.tasks ?? [];
    ok(list.find((t) => t.id === T1)?.latest_update?.id === u1.j?.id, "S8 a comment is never shown as the latest progress report");
    /* the server's own once-only, without the gateway's replay in front of it: the key in the body */
    const r1 = await call(`/staff/tasks/${T1}/updates`, U.farid, "POST", { kind: "progress", body: "Bank form downloaded", client_key: "body-key-0001" });
    const r2 = await call(`/staff/tasks/${T1}/updates`, U.farid, "POST", { kind: "progress", body: "Bank form downloaded", client_key: "body-key-0001" });
    ok(r1.status === 201 && r2.j?.existing === true && r2.j?.id === r1.j?.id && n(`SELECT COUNT(*) AS n FROM task_updates WHERE client_key = 'body-key-0001'`) === 1, "S18 ...and the server itself lands a replayed update once", r2.text.slice(0, 120));
    const u2 = await call(`/staff/tasks/${T1}/updates`, U.farid, "POST", { kind: "blocker", body: "Director travelling until Tuesday", blockers: "No signature until Tuesday" });
    const ups = (await call(`/staff/tasks/${T1}/updates`, U.ceo)).j?.updates ?? [];
    row = ((await call("/staff/tasks?all=1", U.ceo)).j?.tasks ?? []).find((t) => t.id === T1);
    ok(u2.status === 201 && ups.length === 3 && ups[0].id === u2.j?.id && ups[2].id === u1.j?.id && row?.latest_update?.id === u2.j?.id && row?.stage === "blocked", "S9/S10 the new update is the latest; the earlier one stays, newest first; the blocker puts the task in Blocked", JSON.stringify(ups.map((u) => u.id)));
    ok(note(U.ceo, "%Blocked: Financing application%") === 1, "a blocker tells the person who set the task");
    let appendOnly = 0;
    try { db.exec(`UPDATE task_updates SET body = 'changed' WHERE id = ${u1.j?.id ?? -1}`); } catch { appendOnly++; }
    try { db.exec(`DELETE FROM task_updates WHERE id = ${u1.j?.id ?? -1}`); } catch { appendOnly++; }
    ok(appendOnly === 2, "S9 an update can be neither changed nor deleted - the database refuses");
    const cor = await call(`/staff/tasks/${T1}/updates`, U.farid, "POST", { kind: "correction", corrects_id: u1.j?.id, body: "Correction: 2 months of statements, not 3" });
    ok(cor.status === 201 && db.prepare(`SELECT body FROM task_updates WHERE id = ?`).get(u1.j?.id ?? -1)?.body?.startsWith("Statements"), "a correction is a new entry naming the one it corrects; the original stays");
    ok((await call(`/staff/tasks/${T1}/updates`, U.ceo, "POST", { kind: "progress", body: "Edited by me", customer_id: 1 })).status === 403, "an update carrying master data (a customer) is refused");

    /* ---------- S20 desktop and phone read the same latest update ---------- */
    const dd = (await call(`/staff/tasks/${T1}`, U.farid)).j?.task;
    row = ((await call("/staff/tasks?all=1", U.ceo)).j?.tasks ?? []).find((t) => t.id === T1);
    ok(dd?.latest_update?.id === row?.latest_update?.id && dd?.counts?.updates === 4, "S20 the task detail (phone and desktop) and the list give the same latest update", JSON.stringify([dd?.latest_update?.id, row?.latest_update?.id]));

    /* ---------- S11 comments: separate from progress, the thread's people only ---------- */
    const k2 = "cmt-ceo-1";
    const cm = await call(`/staff/tasks/${T1}/comments`, U.ceo, "POST", { comment: "Please get the signature before Wednesday.", mentions: [U.farid, U.ed] }, { "Idempotency-Key": k2 });
    const cm2 = await call(`/staff/tasks/${T1}/comments`, U.ceo, "POST", { comment: "Please get the signature before Wednesday.", mentions: [U.farid] }, { "Idempotency-Key": k2 });
    const cms = (await call(`/staff/tasks/${T1}/comments`, U.farid)).j?.comments ?? [];
    ok(cm.status === 201 && cm2.j?.id === cm.j?.id && cms.length === 2 && cms[1].id === cm.j?.id && cms[1].author === "Alif Farhan" && cms[1].mentions?.length === 1 && cms[1].mentions[0].id === U.farid, "S11/A5/A6 a comment has its id and author, lands once, and mentions only people on the task", JSON.stringify(cms[1]));
    ok(note(U.farid, "%mentioned you on Financing%") === 1 && note(U.ed, "%mentioned you%") === 0, "S11 the person mentioned is told; somebody not on the task is not");
    ok((await call(`/staff/tasks/${T1}/comments`, U.farid, "POST", { comment: "see file", attachment_media_id: 1 })).status === 400, "A4 a comment no longer staples a public media file");
    ok((await call(`/staff/tasks/${T1}/comments`, U.ed)).status === 403 && (await call(`/staff/tasks/${T1}`, U.ed)).status === 403, "a standalone task and its thread stay with the people on it");

    /* ---------- S16 completion is reviewed (T-2) ---------- */
    ok((await call(`/staff/tasks/${T1}`, U.farid, "PATCH", { status: "completed", progress: 100 })).status === 409, "S16 the assignee cannot close a task somebody else set");
    ok((await call(`/staff/tasks/${T1}/review`, U.farid, "POST", { decision: "approve" })).status === 403, "S16 ...nor approve his own work");
    const rq = await call(`/staff/tasks/${T1}/updates`, U.farid, "POST", { kind: "review_request", body: "Submitted to the bank, reference MBB-SME-2207" });
    ok(rq.status === 201 && db.prepare(`SELECT stage FROM tasks WHERE id = ?`).get(T1)?.stage === "review" && note(U.ceo, "%Ready for review: Financing%") === 1, "S16 he submits it for review; the person who set it is told", rq.text.slice(0, 120));
    await capture("reviewer", U.ceo, T1, true);
    await capture("assignee", U.farid, T1, false);
    const ap = await call(`/staff/tasks/${T1}/review`, U.ceo, "POST", { decision: "approve", reason: "Checked with the bank" });
    const t1c = db.prepare(`SELECT status, stage FROM tasks WHERE id = ?`).get(T1);
    const apr = db.prepare(`SELECT author_id, kind FROM task_updates WHERE task_id = ? ORDER BY id DESC LIMIT 1`).get(T1);
    ok(ap.status === 200 && t1c?.status === "completed" && t1c?.stage === null && apr?.kind === "review_approved" && apr?.author_id === U.ceo && note(U.farid, "%Approved: Financing%") === 1, "S16 the CEO approves: completed, with who and when on the record, and Farid is told", JSON.stringify(t1c));
    ok((await call(`/staff/tasks/${T1}/updates`, U.farid, "POST", { kind: "progress", body: "late" })).status === 409, "a closed task takes nothing more");

    /* ---------- the project: S4 / S5 ---------- */
    const p1 = await call("/staff/projects", U.aina, "POST", { quotation_id: 100 });
    const pid = p1.j?.id ?? 999999;
    await call(`/staff/projects/${pid}/owner`, U.ceo, "POST", { owner_id: U.aina });
    db.exec(`INSERT INTO quotation_acceptances (doc_id, revision, accepted_name, accepted_at) VALUES (100, 0, 'Mr. Ahmad', '2026-10-31 02:00:00')`);
    await call(`/staff/projects/${pid}/status`, U.aina, "POST", { to: "in_progress" });
    const pt = await call("/staff/tasks", U.aina, "POST", { title: "Design & content creation", assigned_to: U.mira, deadline: "2026-11-10", link_kind: "project", link_id: pid, items: ["Design concept", "Week 1", "Week 2", "Week 3", "Final graphics"] });
    const PT = pt.j?.id ?? 999999;
    const pd = (await call(`/staff/tasks/${PT}`, U.mira)).j?.task;
    ok([200, 201].includes(pt.status) && pd?.link?.kind === "project" && pd?.link?.project_id === pid && pd?.link?.quotation === "QT-2026-0018" && pd?.link?.customer === "ABC Sdn Bhd", "S4 a task linked to the quotation's project names the project, quotation and customer (read, not copied)", JSON.stringify(pd?.link));
    const again = await call("/staff/projects", U.aina, "POST", { quotation_id: 100 });
    await call(`/staff/projects/by-quotation/100`, U.aina); await call(`/staff/projects/by-quotation/100`, U.aina);
    ok(again.j?.id === pid && n(`SELECT COUNT(*) AS n FROM projects WHERE quotation_id = 100`) === 1 && n(`SELECT COUNT(*) AS n FROM tasks WHERE link_kind = 'project' AND link_id = ${pid}`) === 1, "S5 reopening the quotation makes no second project and no extra task");

    /* ---------- S12 / S13 / T-6 unassigned staff, and an assistant ---------- */
    ok((await call(`/staff/tasks/${PT}`, U.ed)).status === 200, "T-6 other staff read a project task");
    ok((await call(`/staff/tasks/${PT}`, U.ed, "PATCH", { title: "Mine now" })).status === 403 && (await call(`/staff/tasks/${PT}/updates`, U.ed, "POST", { kind: "progress", body: "I did it" })).status === 403 && (await call(`/staff/tasks/${PT}/comments`, U.ed, "POST", { comment: "hello" })).status === 403, "S12 unassigned staff cannot edit the task, post progress or comment");
    const offer = await call(`/staff/tasks/${PT}/updates`, U.ed, "POST", { kind: "assist_request", body: "I can do the captions" });
    ok(offer.status === 201 && note(U.aina, "%offers to help on Design%") === 1, "T-6 ...but may offer to help, and the Project Owner is told", offer.text.slice(0, 120));
    ok(((await call("/staff/tasks?all=1", U.ceo)).j?.tasks ?? []).find((t) => t.id === PT)?.latest_update === null, "S8 an offer to help is not the task's progress report - its latest update stays empty");
    ok((await call(`/staff/tasks/${PT}/assistants`, U.mira, "POST", { user_id: U.ed })).status === 403, "the assignee cannot add helpers");
    const as1 = await call(`/staff/tasks/${PT}/assistants`, U.aina, "POST", { user_id: U.ed });
    ok(as1.status === 201 && ((await call("/staff/tasks", U.ed)).j?.tasks ?? []).some((t) => t.id === PT) && note(U.ed, "%You are helping on: Design%") === 1, "the Project Owner adds Ed as a helper - it appears in his Tasks, and he is told");
    const eu = await call(`/staff/tasks/${PT}/updates`, U.ed, "POST", { kind: "progress", body: "Captions for week 1 drafted" });
    ok(eu.status === 201, "S13 the assistant submits a progress update", eu.text.slice(0, 120));
    await capture("assistant", U.ed, PT, false);
    await capture("other", U.lia, PT, false);
    if (process.env.TASK_FIXTURE_OUT && !captured.done) { captured.done = true; writeFileSync(process.env.TASK_FIXTURE_OUT, JSON.stringify({ captured_from: "tests/go-live-t.mjs", ids: captured.ids, views: captured.views }, null, 1)); }
    ok((await call(`/staff/tasks/${PT}`, U.ed, "PATCH", { assigned_to: U.ed, reason: "taking over" })).status === 403 && (await call(`/staff/tasks/${PT}`, U.ed, "PATCH", { title: "x" })).status === 403, "S13 ...but cannot reassign or edit the task");
    let w = (await call(`/staff/projects/${pid}`, U.ed)).j;
    ok((await call(`/staff/projects/${pid}`, U.ed, "PATCH", { title: "x", version: w?.project?.version })).status === 403 && db.prepare(`SELECT company, phone FROM customers WHERE id = 1`).get()?.company === "ABC Sdn Bhd", "S13 ...nor change the project or the client");
    ok((await call(`/staff/tasks/${PT}/assistants`, U.ed, "POST", { user_id: U.lia })).status === 403, "an assistant cannot add others");

    /* ---------- S14 / S15 CEO, COO, CCO operate projects - and the CCO stays out of money ---------- */
    for (const [who, uid] of [["CEO", U.ceo], ["COO", U.coo], ["CCO", U.cco]]) {
      w = (await call(`/staff/projects/${pid}`, uid)).j;
      const pe = await call(`/staff/projects/${pid}`, uid, "PATCH", { notes: `Checked by the ${who}`, version: w?.project?.version });
      const te = await call(`/staff/tasks/${PT}`, uid, "PATCH", { priority: "high" });
      ok(pe.status === 200 && te.status === 200, `S14 the ${who} edits the project and its task`, `${pe.text.slice(0, 80)} ${te.text.slice(0, 80)}`);
    }
    ok((await call(`/staff/docs/200`, U.cco, "PATCH", { payment_status: "paid" })).status === 403 && (await call(`/staff/docs/200/confirm-paid`, U.cco, "POST", {})).status === 403, "S15 the CCO cannot mark or confirm an invoice paid");

    /* ---------- T-4 project tasks are not HR admin's or the Admin account's ---------- */
    ok((await call(`/staff/tasks/${PT}`, U.hana, "PATCH", { assigned_to: U.lia, reason: "HR moving it" })).status === 403 && (await call(`/staff/tasks/${PT}/review`, U.hana, "POST", { decision: "approve" })).status === 403, "T-4 HR admin (team_manage) does not manage a project task");
    const sT = await call("/staff/tasks", U.hana, "POST", { title: "Send the November roster", assigned_to: U.mira });
    ok((await call(`/staff/tasks/${sT.j?.id}`, U.hana, "PATCH", { assigned_to: U.lia })).status === 200, "T-4 ...and still manages standalone tasks as before");

    /* ---------- S17 a returned review goes back to work ---------- */
    const mrq = await call(`/staff/tasks/${PT}/updates`, U.mira, "POST", { kind: "review_request", body: "All five designs ready" });
    ok((await call(`/staff/tasks/${PT}/review`, U.aina, "POST", { decision: "return" })).status === 400, "S17 returning needs a reason");
    const rt = await call(`/staff/tasks/${PT}/review`, U.aina, "POST", { decision: "return", reason: "Week 3 colours do not match the brand guide" });
    const ptr = db.prepare(`SELECT status, stage FROM tasks WHERE id = ?`).get(PT);
    ok(mrq.status === 201 && rt.status === 200 && ptr?.status === "in_progress" && ptr?.stage === null && note(U.mira, "%Returned for more work: Design%") === 1, "S17 the owner returns it with a reason: back in progress, and Mira is told", JSON.stringify(ptr));
    ok(db.prepare(`SELECT status FROM projects WHERE id = ?`).get(pid)?.status === "in_progress", "one task's review never moves the project");

    /* ---------- files: restricted ---------- */
    const rf = await call(`/staff/tasks/${PT}/files`, U.aina, "POST", pdf, { "content-type": "application/pdf", "X-File-Name": "brand-guide.pdf", "X-File-Level": "restricted" });
    ok(rf.status === 201 && (await call(`/staff/tasks/${PT}/files/${rf.j?.id}`, U.ed)).status === 403 && (await call(`/staff/tasks/${PT}/files/${rf.j?.id}`, U.coo)).status === 200, "a restricted file opens for the owner side and management, not for a helper");
    ok((await call(`/staff/tasks/${PT}/files`, U.mira, "POST", pdf, { "content-type": "application/pdf", "X-File-Name": "x.pdf", "X-File-Level": "restricted" })).status === 403, "the assignee does not add restricted files");

    /* ---------- the timeline ---------- */
    const act = (await call(`/staff/tasks/${T1}/activity`, U.ceo)).j?.activity ?? [];
    const kinds = act.map((e) => e.kind);
    ok(["task.create", "task.reassign", "task.edit", "event.item_done", "event.item_undone", "update.progress", "update.blocker", "update.correction", "update.review_request", "update.review_approved", "comment", "file", "event.status"].every((k) => kinds.includes(k))
      && new Set(act.map((e) => e.key)).size === act.length && act.every((e, i) => i === 0 || act[i - 1].at <= e.at) && act.every((e) => e.at), "the task's timeline: created, reassigned (with reason), edited, ticked and unticked, updates, blocker, correction, review, approval, comment, file and status - once each, oldest first", JSON.stringify(kinds));
    const actEd = (await call(`/staff/tasks/${PT}/activity`, U.lia)).j?.activity ?? [];
    ok(actEd.length > 0 && !actEd.some((e) => e.kind === "comment"), "T-6 staff who only see the project read its progress, never its conversation");

    /* ---------- S21 unrelated tasks behave as before ---------- */
    const self = await call("/staff/tasks", U.lia, "POST", { title: "Call back Zainab Kitchen" });
    ok([200, 201].includes(self.status) && (await call(`/staff/tasks/${self.j?.id}`, U.lia, "PATCH", { status: "completed", progress: 100 })).status === 200, "S21 a self-set task still closes directly, as before");
    const plain = await call("/staff/tasks", U.ceo, "POST", { title: "Renew insurance", assigned_to: U.mira });
    ok((await call(`/staff/tasks/${plain.j?.id}/ack`, U.mira, "POST", {})).status === 200 && (await call(`/staff/tasks/${plain.j?.id}`, U.ceo, "DELETE")).status === 200, "S21 acknowledge and the CEO's delete still work on a task without history");
    ok((await call(`/staff/tasks/${T1}`, U.ceo, "DELETE")).status === 409 && n(`SELECT COUNT(*) AS n FROM tasks WHERE id = ${T1}`) === 1, "a task with progress reports keeps them - it is not deleted");
    const cx = await call("/staff/tasks", U.ceo, "POST", { title: "Old campaign brief", assigned_to: U.mira });
    ok((await call(`/staff/tasks/${cx.j?.id}/review`, U.mira, "POST", { decision: "cancel", reason: "The client dropped the campaign" })).status === 403, "T-7 the assignee cannot cancel");
    const cc = await call(`/staff/tasks/${cx.j?.id}/review`, U.ceo, "POST", { decision: "cancel", reason: "The client dropped the campaign" });
    ok(cc.status === 200 && db.prepare(`SELECT status, stage FROM tasks WHERE id = ?`).get(cx.j?.id ?? -1)?.stage === "cancelled", "T-7 cancelled = closed with stage cancelled and the reason on record");

    /* ---------- A9 every open task is listed ---------- */
    const ins = db.prepare(`INSERT INTO tasks (title, assigned_to, created_by, status, created_at) VALUES (?, 10, 1, 'open', datetime('now', ?))`);
    for (let i = 0; i < 260; i++) ins.run(`Bulk ${i}`, `-${i + 30} days`);
    const big = (await call("/staff/tasks?all=1", U.ceo)).j?.tasks ?? [];
    const open = n(`SELECT COUNT(*) AS n FROM tasks WHERE status != 'completed'`);
    ok(big.filter((t) => t.status !== "completed").length === open && open > 260, "A9 All Tasks lists every open task - no longer cut at 200", `${big.length} of ${open}`);
    const arch = (await call("/staff/tasks?all=1&archive=1", U.ceo)).j;
    ok(Array.isArray(arch?.tasks) && arch.tasks.every((t) => t.status === "completed"), "A9 the archive pages the closed ones");

    /* ---------- v1.246.2 a task set UNDER A QUOTATION (the owner, 01-11-2026) ---------- */
    const lq = (await call("/staff/projects/quotations", U.lia)).j;
    ok(lq?.can_manage === false && lq?.quotations?.some((q) => q.id === 102 && q.project_id === null) && !lq?.quotations?.some((q) => q.id === 100), "Q1 a salesperson sees their own live quotations to set a task under, not a colleague's", JSON.stringify(lq?.quotations?.map((q) => q.id)));
    const cq = (await call("/staff/projects/quotations", U.ceo)).j;
    ok(cq?.can_manage === true && [100, 102].every((id) => cq?.quotations?.some((q) => q.id === id)) && !cq?.quotations?.some((q) => q.id === 101), "Q1 the CEO sees every live quotation; an expired one with no project is left out (revise it first)", JSON.stringify(cq?.quotations?.map((q) => q.id)));
    ok((await call("/staff/tasks", U.ed, "POST", { title: "Sneak in", quotation_id: 102 })).status === 403 && n(`SELECT COUNT(*) AS n FROM projects WHERE quotation_id = 102`) === 0 && (await call("/staff/tasks", U.lia, "POST", { title: "Not mine", quotation_id: 100 })).status === 403, "Q2 a task under somebody else's quotation is refused, and no project appears for it (editor; a salesperson on a colleague's)");
    const lt = await call("/staff/tasks", U.lia, "POST", { title: "Shoot day", quotation_id: 102, items: ["Book the studio", "Shoot"] });
    const LT = lt.j?.id ?? 999999;
    const lp = db.prepare(`SELECT id, owner_id, status FROM projects WHERE quotation_id = 102`).get();
    const ltd = (await call(`/staff/tasks/${LT}`, U.lia)).j?.task;
    ok(lt.status === 201 && lp && lp.owner_id === null && lp.status === "draft" && ltd?.link?.kind === "project" && ltd?.link?.project_id === lp.id && ltd?.link?.quotation === "QT-2026-0019", "Q3 a salesperson's task under their own quotation creates its project (draft, Owner still to be chosen - P-2) and joins it", `${lt.text.slice(0, 120)} ${JSON.stringify(lp)}`);
    ok(lastAudit("project.create").quotation_id === 102 && ((await call("/staff/projects?scope=assigned", U.lia)).j?.projects ?? []).some((p) => p.id === lp?.id) && (await call(`/staff/projects/by-quotation/102`, U.ceo)).j?.project?.id === lp?.id, "Q3 the project is audited, under the salesperson's Projects (I'm on), and on the quotation page");
    ok((await call("/staff/tasks", U.aina, "POST", { title: "Not my project", quotation_id: 102 })).status === 403, "Q3 a colleague who is not the quotation's salesperson cannot set tasks under it");
    const ct = await call("/staff/tasks", U.ceo, "POST", { title: "Approve the storyboard", assigned_to: U.lia, quotation_id: 102 });
    ok(ct.status === 201 && n(`SELECT COUNT(*) AS n FROM projects WHERE quotation_id = 102`) === 1 && n(`SELECT COUNT(*) AS n FROM tasks WHERE link_kind = 'project' AND link_id = ${lp?.id}`) === 2, "Q4 the CEO's task under the same quotation joins the one project - no second project", ct.text.slice(0, 120));
    ok(!((await call("/staff/projects/quotations", U.ceo)).j?.quotations ?? []).some((q) => q.id === 102 && q.project_id === null), "Q4 the quotation no longer counts as 'without a project'");


    /* ---------- v1.246.2 the checklist is edited, not only ticked ---------- */
    ok((await call(`/staff/tasks/${LT}/items`, U.ed, "POST", { title: "Hijack" })).status === 403 && (await call(`/staff/tasks/${LT}/items`, U.mira, "POST", { title: "Hijack" })).status === 403, "C1 staff not on the task cannot add a deliverable");
    const add = await call(`/staff/tasks/${LT}/items`, U.lia, "POST", { title: "Edit the reel" });
    const items1 = (await call(`/staff/tasks/${LT}/items`, U.lia)).j?.items ?? [];
    ok(add.status === 201 && add.j?.count === 3 && items1.length === 3 && items1[2]?.title === "Edit the reel", "C2 the assignee adds a deliverable (after the others)", add.text.slice(0, 120));
    ok((await call(`/staff/tasks/${LT}/items`, U.lia, "POST", { title: "x" })).status === 400, "C2 a one-letter deliverable is refused");
    await call(`/staff/tasks/${LT}/items/${items1[0].id}/toggle`, U.lia, "POST", {});
    const ren = await call(`/staff/tasks/${LT}/items/${items1[1].id}`, U.ceo, "PATCH", { title: "Shoot (two days)" });
    const items2 = (await call(`/staff/tasks/${LT}/items`, U.lia)).j?.items ?? [];
    ok(ren.status === 200 && items2[1]?.title === "Shoot (two days)" && lastAudit("task.item_rename").from === "Shoot", "C3 a manager renames a deliverable; the old and new wording are audited");
    const del = await call(`/staff/tasks/${LT}/items/${items1[2].id}`, U.lia, "DELETE");
    const ltAfter = db.prepare(`SELECT progress, progress_source FROM tasks WHERE id = ?`).get(LT);
    ok(del.status === 200 && del.j?.count === 2 && del.j?.progress === 50 && ltAfter?.progress === 50 && ltAfter?.progress_source === "checklist", "C4 removing a deliverable recounts the progress from the list (1 of 2 ticked = 50%)", `${del.text.slice(0, 100)} ${JSON.stringify(ltAfter)}`);
    const actC = (await call(`/staff/tasks/${LT}/activity`, U.lia)).j;
    ok((actC?.activity ?? []).some((e) => e.text === "Added a deliverable to the checklist (since removed)") && (actC?.activity ?? []).some((e) => e.text === "Removed \"Edit the reel\" from the checklist"), "C5 the add and the removal are on the task's activity", JSON.stringify((actC?.activity ?? []).map((e) => e.text)));
    ok((await call(`/staff/tasks/${T1}/items`, U.ceo, "POST", { title: "Too late" })).status === 409, "C6 a closed task's checklist no longer changes");
    const own = await call(`/staff/projects/${lp?.id}/owner`, U.ceo, "POST", { owner_id: U.hana });
    const q5a = await call("/staff/tasks", U.lia, "POST", { title: "After the owner", quotation_id: 102 });
    const q5b = await call("/staff/tasks", U.hana, "POST", { title: "Owner's task", quotation_id: 102 });
    ok(own.status === 200 && q5a.status === 403 && q5b.status === 201, "Q5 once an Owner is named, the Owner (not the salesperson) sets the project's tasks - the 1.245.0 rule", `${own.status} ${q5a.status} ${q5b.status} ${q5b.text.slice(0, 100)}`);

    /* ---------- S22 boundaries ---------- */
    ok((await call(`/staff/tasks/${PT}`, U.shop)).status === 403 && (await call(`/staff/tasks/${PT}/updates`, U.shop)).status === 403, "S22 a customer account opens no task route");
    ok(money() === money0, "S22 nothing in Sales, Commission, Payroll, the cash book or part payments was written by any task action");
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
  const code = readFileSync(join(root, "worker/src/tasks-progress.ts"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  ok(!/(INSERT INTO|UPDATE|DELETE FROM)\s+(sales_documents|commission_ledger|payroll_entries|payroll_payments|cashflow_entries|invoice_payments|customers|sales_packages|sales_package_versions|projects)\b/i.test(code), "the task module writes to no sales, commission, payroll, cash, customer, package or project table");
  ok(!/request\.json\(\)|body\?*\.role\b/.test(code) && !/author_id:\s*body/.test(code), "identity and role come from the session, never from the request");
  ok(!/DELETE FROM task_updates|UPDATE task_updates/i.test(code), "nothing in the code rewrites or removes a progress update");
  return out;
}

const captured = { done: false, views: {}, ids: {} };
let fail = 0, n = 0;
const report = (list) => { for (const [p, m] of list) { n++; if (!p) { fail++; console.error(`FAIL ${m}`); } } };
const given = process.env.WORKER_BUNDLE;
const NOMUT = process.env.NOMUT === "1" || !!given;
const dir = mkdtempSync(join(tmpdir(), "golive-t-"));
if (!given) bundle(root, "worker/src/index.ts", join(dir, "worker.mjs"));
report(await runtime(given ?? join(dir, "worker.mjs")));
if (!given) report(sourceChecks());
const checks = n;

const MUT = [
  ["worker/src/tasks-progress.ts", "the assignee approves his own work", "  const review = selfSet ? (assignee || manage) : ((creator || manage) && !assignee);", "  const review = selfSet ? (assignee || manage) : (creator || manage || assignee);"],
  ["worker/src/staff.ts", "the assignee closes a task somebody else set", "      if (body.status === \"completed\" && !selfSet) {", "      if (false) {"],
  ["worker/src/staff.ts", "team_manage manages project tasks", "    const manages = projOfTask ? !projGate : can(user.role, \"team_manage\");", "    const manages = can(user.role, \"team_manage\") || (projOfTask ? !projGate : false);"],
  ["worker/src/tasks-progress.ts", "a retried update lands twice", [["    const again = await env.DB.prepare(`SELECT id FROM task_updates WHERE author_id = ?1 AND client_key = ?2`).bind(user.id, key).first<{ id: number }>();\n    if (again) return json({ id: again.id, existing: true });\n  }\n  let corrects", "  }\n  let corrects"], ["     ON CONFLICT(author_id, client_key) WHERE client_key IS NOT NULL DO NOTHING RETURNING id`,\n  ).bind(t.id,", "     RETURNING id`,\n  ).bind(t.id,"]]],
  ["worker/src/tasks-progress.ts", "an update overrides the checklist", "      if (Math.round(body.progress) !== derived) return err(", "      if (false) return err("],
  ["worker/src/staff.ts", "a PATCH overrides the checklist", "      return err(\"progress_via_update\",", "      if (false) return err(\"progress_via_update\","],
  ["worker/src/tasks-progress.ts", "anybody who sees the task posts progress", "  } else if (!a.update) {\n    return err(\"forbidden\", a.view", "  } else if (false) {\n    return err(\"forbidden\", a.view"],
  ["worker/src/staff.ts", "anybody who sees the task reads and writes its thread", "    return (await taskAccess(env, user, t)).team;", "    return (await taskAccess(env, user, t)).view;"],
  ["worker/src/staff.ts", "unticking erases the tick again", "          .bind(taskItemToggle[1], `${nowDone ? \"item_done\" : \"item_undone\"}:${it.id}`,", "          .bind(taskItemToggle[1], `x_${nowDone}:${it.id}`,"],
  ["worker/src/tasks-progress.ts", "a return needs no reason", "      if (reason.length < 5) return err(\"invalid_input\", \"Say what still needs doing", "      if (false) return err(\"invalid_input\", \"Say what still needs doing"],
  ["worker/src/tasks-progress.ts", "a helper opens a restricted file", "    if (f.level === \"restricted\" && !(a.manage || a.review || a.creator)) return err(", "    if (false) return err("],
  ["worker/src/staff.ts", "the open tasks are cut at 200 again", "AND t.status != 'completed' ORDER BY t.created_at DESC`)", "AND t.status != 'completed' ORDER BY t.created_at DESC LIMIT 200`)"],
  ["worker/src/tasks-progress.ts", "an offer to help counts as the latest update", "export const LATEST_KINDS = [\"progress\",", "export const LATEST_KINDS = [\"assist_request\", \"progress\","],
  /* v1.246.2 */
  ["worker/src/projects.ts", "anybody sets a task under any quotation", "  if (!mayCreate) return err(\"forbidden\", \"The quotation's salesperson or the CEO, COO or CCO create its project brief\", 403);", "  if (false) return err(\"forbidden\", \"The quotation's salesperson or the CEO, COO or CCO create its project brief\", 403);"],
  ["worker/src/staff.ts", "anybody edits any task's checklist", "    if (!ta.assignee && !ta.creator && !ta.manage) return err(\"forbidden\", \"Only the assignee, the person who set the task, or a manager edits its checklist\", 403);", "    if (false) return err(\"forbidden\", \"Only the assignee, the person who set the task, or a manager edits its checklist\", 403);"],
  ["worker/src/staff.ts", "removing a deliverable leaves the old percentage", "      await env.DB.prepare(`UPDATE tasks SET progress = ?1, progress_source = CASE WHEN ?3 > 0 THEN 'checklist' ELSE progress_source END WHERE id = ?2`).bind(progress, t.id, Number(agg?.n ?? 0)).run();", "      if (method !== \"DELETE\") await env.DB.prepare(`UPDATE tasks SET progress = ?1, progress_source = CASE WHEN ?3 > 0 THEN 'checklist' ELSE progress_source END WHERE id = ?2`).bind(progress, t.id, Number(agg?.n ?? 0)).run();"],
];
for (const [file, name, from, to] of NOMUT ? [] : MUT) {
  n++;
  const srcT = readFileSync(join(root, file), "utf8");
  const pairs = Array.isArray(from) ? from : [[from, to]];
  if (!pairs.every(([f]) => srcT.includes(f))) { fail++; console.error(`FAIL mutation did not apply: ${name}`); continue; }
  const mdir = mkdtempSync(join(tmpdir(), "golive-t-m-"));
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
if (fail) { console.error(`go-live-t: ${fail} of ${n} failed${given ? ` (bundle: ${given})` : ""}`); process.exitCode = 1; }
else console.log(`go-live-t: ${checks} checks passed (${NOMUT ? "mutations skipped" : `${MUT.length} mutations caught`}) - every task has one owner, structured append-only progress with evidence, comments apart from progress, its latest update in the list, a timeline, completion reviewed by whoever set it, project tasks run by the Owner and the CEO/COO/CCO, the checklist the one source of its percentage, nothing in sales, commission or payroll touched`);
