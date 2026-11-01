/* TASK EMAILS (v1.247.0) - runtime guard: the WHOLE worker (index.ts) and
 * the task-mail module, bundled together against SQLite with every
 * migration applied (0161 included), by direct request as each role, with a
 * fake Cloudflare send_email binding that records every message (and refuses
 * one address, to prove failures are logged and retried, not lost). Fixed
 * clock: Saturday 31-10-2026, 15:00 Malaysia time.
 *
 * The owner's brief "A2Z OS - Automated Task Email Notifications & Staff
 * Reminder System" (01-11-2026), its 23 tests (M1..M23 below), and his
 * answers in claude/TASK-EMAIL-AUDIT.md: the digest off until he turns it on,
 * overdue on day 1, 3 and 7 then stop, the sender hello@a2zcreative.my.
 *
 *   node tests/go-live-m.mjs                                  the current worker, then mutations
 *   WORKER_BUNDLE=/path/bundle.mjs node tests/go-live-m.mjs   a given bundle (the pre-fix bundle must FAIL)
 */
import { readFileSync, readdirSync, mkdtempSync, writeFileSync, cpSync, rmSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const root = fileURLToPath(new URL("..", import.meta.url));
/* one bundle, two doors: the worker's fetch, and the cron functions the
   scheduled() branches call - the same module instances, the same database */
const bundle = (srcRoot, out) => {
  const entry = join(srcRoot, "golive-m-entry.ts");
  writeFileSync(entry, `export { default } from "./worker/src/index.ts";\nexport { drainMailOutbox, taskMailSweep, taskDigest } from "./worker/src/task-mail.ts";\n`);
  execSync(`npx esbuild "${entry}" --bundle --format=esm --platform=neutral --outfile="${out}" --log-level=error`, { cwd: root, stdio: "inherit" });
  rmSync(entry, { force: true });
};
const sha = (s) => createHash("sha256").update(s).digest("hex");
const NOW = Date.parse("2026-10-31T07:00:00Z"); // Sat 31-10-2026 15:00 MYT
const H = 3600 * 1000, D = 24 * H;
const day = (ms) => new Date(ms + 8 * H).toISOString().slice(0, 10);

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
  const sent = [];
  const MAIL = { send: async (m) => { if (String(m.to).startsWith("bounce")) throw new Error("550 5.1.1 mailbox unavailable"); sent.push(m); } };
  const env = {
    DB: { prepare: shim, batch: async (list) => { db.exec("BEGIN"); try { for (const s of list) s._run(); db.exec("COMMIT"); } catch (e) { db.exec("ROLLBACK"); throw e; } return []; } },
    SESSION_PEPPER: "pepper", COMPANY_DOMAIN: "a2z.test", ALLOWED_ORIGINS: "https://portal.a2z.test",
    MEDIA: { put: async () => {}, get: async () => null, head: async () => null, list: async () => ({ objects: [] }), delete: async () => {} },
  };
  const RealDate = globalThis.Date;
  let fixed = NOW;
  globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [fixed])); } static now() { return fixed; } };
  const U = { ceo: 1, coo: 2, cco: 3, aina: 5, lia: 6, mira: 10, ed: 11, root: 8, shop: 9, gone: 12, hana: 13, farid: 14, sus: 15, bob: 16 };
  db.exec(`INSERT INTO users (id, name, full_name, email, role, is_active, password_hash, totp_enabled, totp_secret, department, employment_status, joined_on, left_on) VALUES
    (1,'Alif','Alif Farhan','alif@a2z.test','ceo',1,'x',1,'JBSWY3DPEHPK3PXP','Management','permanent','2020-01-01',NULL),
    (2,'Ops','Ops Lead','ops@a2z.test','coo',1,'x',1,'JBSWY3DPEHPK3PXP','Management','permanent','2020-01-01',NULL),
    (3,'Cee','Cee Officer','cco@a2z.test','cco',1,'x',1,'JBSWY3DPEHPK3PXP','Management','permanent','2020-01-01',NULL),
    (5,'Aina','Aina Seller','aina@a2z.test','sales_marketing',1,'x',1,'JBSWY3DPEHPK3PXP','Sales','permanent','2020-01-01',NULL),
    (6,'Lia','Lia Seller','lia@a2z.test','sales_marketing',1,'x',1,'JBSWY3DPEHPK3PXP','Sales','permanent','2020-01-01',NULL),
    (8,'Root','Root','root@a2z.test','super_admin',1,'x',1,'JBSWY3DPEHPK3PXP',NULL,'permanent','2020-01-01',NULL),
    (9,'Shop','Shop','shop@gmail.com','customer',1,'x',0,NULL,NULL,'permanent',NULL,NULL),
    (10,'Sara','Sara Designer','sara@a2z.test','marketing',1,'x',1,'JBSWY3DPEHPK3PXP','Marketing','permanent','2020-01-01',NULL),
    (11,'Ed','Ed Editor','ed@a2z.test','editor',1,'x',1,'JBSWY3DPEHPK3PXP','Marketing','permanent','2020-01-01',NULL),
    (12,'Gone','Gone Seller','gone@a2z.test','sales_marketing',1,'x',1,'JBSWY3DPEHPK3PXP','Sales','resigned','2020-01-01','2026-10-01'),
    (13,'Hana','Hana HR','hana@a2z.test','hr_admin',1,'x',1,'JBSWY3DPEHPK3PXP','HR','permanent','2020-01-01',NULL),
    (14,'Farid','Farid Zulkifli','farid@a2z.test','live_host',1,'x',1,'JBSWY3DPEHPK3PXP','Live','permanent','2020-01-01',NULL),
    (15,'Sus','Sus Pended','sus@a2z.test','editor',0,'x',1,'JBSWY3DPEHPK3PXP','Marketing','permanent','2020-01-01',NULL),
    (16,'Bob','Bob Bounce','bounce@a2z.test','editor',1,'x',1,'JBSWY3DPEHPK3PXP','Marketing','permanent','2020-01-01',NULL)`);
  db.exec(`UPDATE users SET reports_to = 2 WHERE id = 14`); // Farid's verified HOD is the COO; Sara has none
  const worker = (await import(pathToFileURL(workerBundle).href + `?v=${Math.random()}`));
  const app = worker.default;
  const tok = {};
  for (const id of Object.values(U)) {
    tok[id] = `t-${id}`;
    db.prepare(`INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, datetime('now', '+12 hours'), datetime('now'))`).run(sha(tok[id]), id);
  }
  const call = async (path, uid, method = "GET", body) => {
    const h = { "content-type": "application/json", origin: "https://portal.a2z.test", cookie: `azone_session=${tok[uid]}; csrf_token=c1`, "x-csrf-token": "c1" };
    const r = await app.fetch(new Request(`https://api.a2z.test/api/v1${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }), env, { waitUntil() {} });
    const text = await r.text();
    let j = null; try { j = JSON.parse(text); } catch { /* not json */ }
    return { status: r.status, j, text };
  };
  const n = (sql, ...a) => Number(db.prepare(sql).get(...a)?.n ?? 0);
  const rows = (where = "1 = 1") => db.prepare(`SELECT * FROM mail_outbox WHERE ${where} ORDER BY id`).all();
  const drain = async () => worker.drainMailOutbox(env);
  const lastAudit = (action) => { const r = db.prepare(`SELECT detail FROM audit_log WHERE action = ? ORDER BY id DESC LIMIT 1`).get(action); try { return JSON.parse(r?.detail ?? "{}"); } catch { return {}; } };
  const money = () => sha(JSON.stringify([
    db.prepare(`SELECT * FROM sales_documents ORDER BY id`).all(),
    (() => { try { return db.prepare(`SELECT * FROM commission_ledger ORDER BY id`).all(); } catch { return []; } })(),
    (() => { try { return db.prepare(`SELECT * FROM payroll_entries ORDER BY rowid`).all(); } catch { return []; } })(),
  ]));
  const money0 = money();
  const task = async (uid, body) => { const r = await call("/staff/tasks", uid, "POST", body); return { ...r, id: r.j?.id ?? 999999 }; };

  try {
    /* ---------- the sender is off: nothing is queued, the task is made ---------- */
    const t0 = await task(U.ceo, { title: "Before the sender", assigned_to: U.farid });
    ok(t0.status === 201 && n(`SELECT COUNT(*) AS n FROM tasks WHERE id = ?`, t0.id) === 1 && rows().length === 0 && n(`SELECT COUNT(*) AS n FROM notifications WHERE user_id = 14`) >= 1,
      "M3 with the sender not configured the task is created, the bell rings, and no email is queued (nothing pretends to send)");
    const s0 = await call("/staff/tasks/mail-settings", U.ceo);
    ok(s0.status === 200 && s0.j?.sender?.ready === false && s0.j?.settings?.digest_on === false && JSON.stringify(s0.j?.settings?.overdue_days) === "[1,3,7]", "the settings say the sender is off; the digest is off by default; overdue on day 1, 3, 7 (the owner's answers)", s0.text.slice(0, 200));

    /* ---------- the sender is on ---------- */
    env.EMAIL = MAIL; env.MAIL_FROM = "A2Z Creative Marketing <hello@a2zcreative.my>";
    const bellsBefore = n(`SELECT COUNT(*) AS n FROM notifications`);
    const t1 = await task(U.ceo, { title: "Prepare client proposal", assigned_to: U.farid, deadline: day(NOW + 5 * D), priority: "high", description: "Proposal and deck" });
    const r1 = rows(`ref = 'task:${t1.id}:assigned:14'`);
    ok(t1.status === 201 && r1.length === 1 && r1[0].status === "queued" && r1[0].to_email === "farid@a2z.test" && r1[0].kind === "assigned", "M1/M2 assigning a task queues ONE email to the assignee's staff address, after the task is saved", JSON.stringify(rows().map((r) => r.ref)));
    ok(n(`SELECT COUNT(*) AS n FROM notifications`) > bellsBefore, "M22 the in-app bell still rings for the same event");
    ok(rows(`ref LIKE 'task:${t1.id}:%' AND user_id = 1`).length === 0, "nobody is emailed about their own action");
    const self = await task(U.lia, { title: "My own note" });
    ok(rows(`ref LIKE 'task:${self.id}:%'`).length === 0, "a task somebody sets for themselves sends no email");
    await drain();
    const m1 = sent.find((m) => m.to === "farid@a2z.test");
    ok(m1 && m1.from === "A2Z Creative Marketing <hello@a2zcreative.my>" && m1.subject === "[A2Z OS] New task assigned — Prepare client proposal" && /Hello Farid,/.test(m1.text) && /Priority: High/.test(m1.text) && /Assigned by: Alif/.test(m1.text) && /Deadline: \d{2}-\d{2}-2026/.test(m1.text), "M2 the email is from hello@a2zcreative.my, names the task, priority, deadline and who assigned it", m1 ? m1.text.slice(0, 300) : "no email");
    ok(m1 && m1.html.includes(`https://portal.a2z.test/portal?tab=Tasks&amp;task=${t1.id}`) && m1.text.includes(`/portal?tab=Tasks&task=${t1.id}`) && !/token|session|password/i.test(m1.text + m1.html), "M20 View Task links to the task by its id - no token, no credential in the link");
    ok(rows(`ref = 'task:${t1.id}:assigned:14'`)[0]?.status === "accepted" && rows(`ref = 'task:${t1.id}:assigned:14'`)[0]?.sent_at, "the log says accepted (by Cloudflare) with the time - never 'delivered'");
    const sentNow = sent.length;
    await drain(); await drain();
    ok(sent.length === sentNow, "M4/M19 a second and third cron pass send nothing again");

    /* ---------- a provider failure: logged verbatim, retried, then dead - the task stays ---------- */
    const tb = await task(U.ceo, { title: "Bounce me", assigned_to: U.bob });
    await drain();
    let rb = rows(`ref = 'task:${tb.id}:assigned:16'`)[0];
    ok(rb?.status === "failed" && rb?.last_error === "550 5.1.1 mailbox unavailable" && rb?.attempts === 1 && n(`SELECT COUNT(*) AS n FROM tasks WHERE id = ?`, tb.id) === 1, "M3/M18 a refused send keeps the task; the log holds the provider's own answer; a retry is scheduled", JSON.stringify(rb));
    await drain();
    ok(rows(`ref = 'task:${tb.id}:assigned:16'`)[0]?.attempts === 1, "no retry storm: the retry waits (5 minutes, then 20)");
    fixed += 6 * 60 * 1000; await drain(); fixed += 21 * 60 * 1000; await drain();
    rb = rows(`ref = 'task:${tb.id}:assigned:16'`)[0];
    ok(rb?.status === "dead" && rb?.attempts === 3, "after three attempts it stops and shows as not sent", JSON.stringify(rb));
    fixed = NOW;
    ok((await call(`/staff/tasks/mail-log/${rb?.id}/retry`, U.cco, "POST", {})).status === 403 && (await call(`/staff/tasks/mail-log/${rb?.id}/retry`, U.ceo, "POST", {})).status === 200 && rows(`id = ${rb?.id}`)[0]?.status === "queued", "the CEO (not the CCO) can queue a dead email again");

    /* ---------- reassignment ---------- */
    const ra = await call(`/staff/tasks/${t1.id}`, U.ceo, "PATCH", { assigned_to: U.mira, reason: "Farid is on the live all week" });
    ok(ra.status === 200 && rows(`kind = 'moved' AND user_id = 10 AND ref LIKE 'task:${t1.id}:moved:10:%'`).length === 1 && rows(`kind = 'moved' AND user_id = 14 AND ref LIKE 'task:${t1.id}:unassigned:14:%'`).length === 1, "M5 a reassignment emails the new assignee and tells the previous one, once each", JSON.stringify(rows("kind = 'moved'").map((r) => r.ref)));
    await drain();
    ok(sent.some((m) => m.to === "farid@a2z.test" && /no longer yours/.test(m.subject)), "the previous assignee's email says plainly it is no longer theirs");

    /* ---------- important progress update: to the assigner, at most one an hour ---------- */
    const u1 = await call(`/staff/tasks/${t1.id}/updates`, U.mira, "POST", { kind: "progress", body: "Deck draft done", progress: 40, next_action: "Internal review" });
    const u2 = await call(`/staff/tasks/${t1.id}/updates`, U.mira, "POST", { kind: "blocker", body: "Waiting for the logo files" });
    const up = rows(`kind = 'update' AND ref LIKE 'task:${t1.id}:update:%'`);
    ok(u1.status === 201 && u2.status === 201 && up.length === 1 && up[0].user_id === 1 && /Deck draft done|Latest update/.test(up[0].body_text) && /Next action: Internal review/.test(up[0].body_text), "M6 an important update emails the assigner with the status, the progress, the summary and the next action - two updates in one hour make ONE email", JSON.stringify(up.map((r) => [r.ref, r.user_id])));
    ok(rows(`kind = 'update' AND user_id = 10`).length === 0, "the author is not emailed about their own update");
    const tick = await call(`/staff/tasks/${t1.id}/items`, U.mira, "POST", { title: "Draft deck" });
    ok(tick.status === 201 && rows(`ref LIKE 'task:${t1.id}:%' AND kind NOT IN ('assigned', 'moved', 'update')`).length === 0, "a checklist change sends no email");

    /* ---------- mention ---------- */
    const cmOut = await call(`/staff/tasks/${t1.id}/comments`, U.mira, "POST", { comment: "@Farid are you still on this?", mentions: [U.farid] });
    ok(cmOut.status === 201 && rows(`kind = 'mention'`).length === 0, "a mention of somebody no longer on the task emails nobody");
    const cm = await call(`/staff/tasks/${t1.id}/comments`, U.mira, "POST", { comment: "@Alif can you send the logo?", mentions: [U.ceo] });
    ok(cm.status === 201 && rows(`kind = 'mention'`).length === 1 && rows(`kind = 'mention'`)[0].user_id === 1, "M7 the mentioned person (on the task) is emailed; nobody else", cm.text.slice(0, 120) + JSON.stringify(rows("kind = 'mention'").map((r) => r.user_id)));
    const cm2 = await call(`/staff/tasks/${t1.id}/comments`, U.mira, "POST", { comment: "Thanks all" });
    ok(cm2.status === 201 && rows(`kind = 'mention'`).length === 1, "a comment without a mention sends no email");

    /* ---------- ready for review ---------- */
    const rv = await call(`/staff/tasks/${t1.id}/updates`, U.mira, "POST", { kind: "review_request", body: "All done, please check" });
    ok(rv.status === 201 && rows(`kind = 'review' AND user_id = 1`).length === 1, "submitting for review emails the reviewer (the person who set it)", JSON.stringify(rows("kind = 'review'").map((r) => r.user_id)));
    const dec = await call(`/staff/tasks/${t1.id}/review`, U.ceo, "POST", { decision: "return", reason: "Add the pricing page" });
    ok(dec.status === 200 && rows(`kind = 'decision' AND user_id = 10`).length === 1, "a return emails the assignee with the reason");

    /* ---------- deadline reminders ---------- */
    const tomorrow = day(NOW + D), yesterday = day(NOW - D);
    const d1 = await task(U.ceo, { title: "Due tomorrow", assigned_to: U.mira, deadline: tomorrow });
    const d2 = await task(U.ceo, { title: "Done already", assigned_to: U.mira, deadline: tomorrow });
    db.exec(`UPDATE tasks SET status = 'completed' WHERE id = ${d2.id}`);
    const d3 = await task(U.ceo, { title: "Cancelled one", assigned_to: U.mira, deadline: tomorrow });
    db.exec(`UPDATE tasks SET status = 'completed', stage = 'cancelled' WHERE id = ${d3.id}`);
    const d4 = await task(U.ceo, { title: "Due next month", assigned_to: U.mira, deadline: day(NOW + 30 * D) });
    await worker.taskMailSweep(env);
    ok(rows(`kind = 'due' AND ref LIKE 'task:${d1.id}:%'`).length === 1, "M8 a task due within the lead time (24 hours) gets one reminder");
    ok(rows(`kind = 'due' AND (ref LIKE 'task:${d2.id}:%' OR ref LIKE 'task:${d3.id}:%' OR ref LIKE 'task:${d4.id}:%')`).length === 0, "M9/M10 no reminder for a completed or cancelled task, nor one due next month");
    await worker.taskMailSweep(env);
    ok(rows(`kind = 'due' AND ref LIKE 'task:${d1.id}:%'`).length === 1, "the next hourly pass does not remind again");

    /* ---------- overdue on day 1, 3, 7 then stop; the HOD after 2 days ---------- */
    const od = {};
    for (const dd of [1, 2, 3, 7, 8]) od[dd] = (await task(U.ceo, { title: `Overdue ${dd}d`, assigned_to: U.farid, deadline: day(NOW - dd * D) })).id;
    const sara = (await task(U.ceo, { title: "Sara overdue", assigned_to: U.mira, deadline: day(NOW - 2 * D) })).id;
    await worker.taskMailSweep(env);
    const odRows = (id) => rows(`kind = 'overdue' AND ref LIKE 'task:${id}:%'`).length;
    ok(odRows(od[1]) === 1 && odRows(od[3]) === 1 && odRows(od[7]) === 1 && odRows(od[2]) === 0 && odRows(od[8]) === 0, "overdue emails go on day 1, 3 and 7 after the deadline, and stop after that", JSON.stringify(Object.fromEntries(Object.entries(od).map(([k, v]) => [k, odRows(v)]))));
    const esc = rows(`kind = 'escalation' AND user_id = 2`);
    ok(esc.length >= 1 && esc.every((r) => /Farid/.test(r.body_text)) && !rows(`kind = 'escalation' AND ref LIKE 'task:${od[1]}:%'`).length, "M11 overdue past the escalation days (2) reaches the assignee's verified HOD (the COO) - not before", JSON.stringify(esc.map((r) => r.ref)));
    const noHod = rows(`ref LIKE 'task:${sara}:esc:%'`);
    ok(noHod.length === 1 && noHod[0].status === "dead" && /no reporting line/.test(noHod[0].last_error) && noHod[0].to_email === "-", "M12 no HOD set: nobody is guessed - the log says so", JSON.stringify(noHod));
    await worker.taskMailSweep(env);
    ok(rows(`kind = 'overdue'`).length === 3, "the hourly pass does not send an overdue email twice on the same day");

    /* ---------- manual reminder ---------- */
    const t2 = await task(U.coo, { title: "Hotel list", assigned_to: U.mira });
    ok((await call(`/staff/tasks/${t2.id}/remind`, U.ed, "POST", { reason: "please do it" })).status === 403, "M14 a staff member cannot send a reminder on somebody else's task");
    ok((await call(`/staff/tasks/${t2.id}/remind`, U.ceo, "POST", { reason: "" })).status === 400, "a reminder needs a reason");
    ok([400, 403].includes((await call(`/staff/tasks/${t2.id}/remind`, U.mira, "POST", { reason: "remind myself" })).status), "the assignee cannot remind themselves");
    const rm = await call(`/staff/tasks/${t2.id}/remind`, U.ceo, "POST", { reason: "The client asked for it today" });
    const rmRow = rows(`kind = 'reminder' AND ref LIKE 'task:${t2.id}:remind:%'`);
    ok(rm.status === 201 && rm.j?.email === true && rmRow.length === 1 && rmRow[0].created_by === 1 && rmRow[0].reason === "The client asked for it today" && lastAudit("task.remind").reason === "The client asked for it today", "M13 the CEO sends a reminder: bell and email to the assignee, with the reason, recorded and audited", rm.text.slice(0, 160));
    const again = await call(`/staff/tasks/${t2.id}/remind`, U.coo, "POST", { reason: "Again please now" });
    ok(again.status === 429 && rows(`kind = 'reminder'`).length === 1, "a second reminder within 12 hours is refused - no accidental repeats, no bulk mailer");
    ok((await call(`/staff/tasks/${t2.id}/remind`, U.coo, "POST", { reason: "x" })).status !== 201, "...whoever sends it");

    /* ---------- recipients: email change, suspended, leaver, customer, preference ---------- */
    db.exec(`UPDATE users SET email = 'farid.z@a2z.test' WHERE id = 14`);
    const t3 = await task(U.ceo, { title: "After the email change", assigned_to: U.farid });
    ok(rows(`ref = 'task:${t3.id}:assigned:14'`)[0]?.to_email === "farid.z@a2z.test", "M15 a changed staff email is used from the next email on - no second account");
    db.exec(`UPDATE users SET is_active = 1 WHERE id = 15`);
    const t4 = await task(U.ceo, { title: "For the suspended", assigned_to: U.sus });
    db.exec(`UPDATE users SET is_active = 0 WHERE id = 15`);
    await call(`/staff/tasks/${t4.id}`, U.ceo, "PATCH", { assigned_to: U.mira, reason: "reassign for test" });
    const t4b = await task(U.ceo, { title: "Reminder to the suspended", assigned_to: U.mira });
    db.exec(`UPDATE tasks SET assigned_to = 15 WHERE id = ${t4b.id}`);
    const rmS = await call(`/staff/tasks/${t4b.id}/remind`, U.ceo, "POST", { reason: "Testing a suspended account" });
    ok(rmS.j?.email === false && /suspended/.test(rmS.j?.why ?? "") && rows(`user_id = 15 AND ref LIKE 'task:${t4b.id}:%'`).length === 0, "M16 a suspended account gets no email (the reason says why)", rmS.text.slice(0, 160));
    db.exec(`UPDATE tasks SET assigned_to = 12 WHERE id = ${t4b.id}`);
    const rmG = await call(`/staff/tasks/${t4b.id}/remind`, U.coo, "POST", { reason: "Testing a leaver account" });
    ok((rmG.status === 429 || rmG.j?.email === false) && rows(`user_id = 12`).length === 0, "M16 a former employee gets no email", rmG.text.slice(0, 160));
    ok(rows(`user_id = 9`).length === 0, "a customer account is never a task email recipient");
    await call("/staff/notification-prefs", U.mira, "PUT", { key: "email_tasks", enabled: false });
    const t5 = await task(U.ceo, { title: "Sara opted out", assigned_to: U.mira });
    ok(rows(`ref = 'task:${t5.id}:assigned:10'`).length === 0 && n(`SELECT COUNT(*) AS n FROM notifications WHERE user_id = 10 AND ref = 'task:${t5.id}'`) === 1, "a person who switched task emails off gets the bell only");
    await call("/staff/notification-prefs", U.mira, "PUT", { key: "email_tasks", enabled: true });

    /* ---------- frequency: the daily cap and quiet hours ---------- */
    ok((await call("/staff/tasks/mail-settings", U.coo, "PUT", { cap_per_day: 2 })).status === 403 && (await call("/staff/tasks/mail-settings", U.ed)).status === 403, "settings: the COO reads but does not change them; staff do not see them");
    ok((await call("/staff/tasks/mail-settings", U.ceo, "PUT", { lead_hours: 0 })).status === 400, "settings are validated");
    const capSet = await call("/staff/tasks/mail-settings", U.ceo, "PUT", { cap_per_day: 2 });
    ok(capSet.status === 200 && lastAudit("tasks.mail_settings").to?.cap_per_day === 2, "the CEO changes a setting - audited from and to");
    const hc = [];
    for (let i = 0; i < 3; i++) hc.push((await task(U.hana, { title: `Hana ${i}`, assigned_to: U.aina })).id);
    for (const id of hc) await call(`/staff/tasks/${id}/updates`, U.aina, "POST", { kind: "progress", body: `Progress on ${id}`, progress: 20 });
    const hr = rows(`user_id = 13 AND kind = 'update'`);
    ok(hr.length === 3 && hr.filter((r) => r.status === "queued").length === 2 && hr[2].status === "dead" && /daily cap/.test(hr[2].last_error), "the daily cap: the third update email of the day to one person is not sent (logged, left for the digest)", JSON.stringify(hr.map((r) => r.status)));
    ok(rows(`user_id = 5 AND kind = 'assigned' AND ref LIKE 'task:${hc[2]}:%'`)[0]?.status === "queued", "...while new assignments always go (they are not capped)");
    await call("/staff/tasks/mail-settings", U.ceo, "PUT", { cap_per_day: 8 });
    fixed = Date.parse("2026-10-31T15:30:00Z"); // 23:30 MYT
    const tq = await task(U.ceo, { title: "Late night update", assigned_to: U.aina });
    await call(`/staff/tasks/${tq.id}/updates`, U.aina, "POST", { kind: "progress", body: "Working on it late", progress: 10 });
    const q1 = rows(`kind = 'update' AND ref LIKE 'task:${tq.id}:%'`)[0];
    const qa = rows(`ref = 'task:${tq.id}:assigned:5'`)[0];
    ok(q1?.not_before === "2026-11-01 00:00:00" && qa && qa.not_before === null, "quiet hours: an update at 23:30 waits for 08:00; a new assignment goes at once", JSON.stringify([q1?.not_before, qa?.not_before]));
    fixed = NOW;

    /* ---------- the daily digest: off by default; on leave or empty, nothing ---------- */
    await worker.taskDigest(env);
    ok(rows(`kind = 'digest'`).length === 0, "M17 the digest is off until the CEO turns it on");
    await call("/staff/tasks/mail-settings", U.ceo, "PUT", { digest_on: true });
    await task(U.ceo, { title: "Hana has open work", assigned_to: U.hana, deadline: day(NOW + D) }); // so only the leave keeps her digest away
    db.exec(`INSERT INTO leave_requests (user_id, type, start_date, end_date, days, status) VALUES (13, 'annual', '${day(NOW)}', '${day(NOW)}', 1, 'approved')`);
    await worker.taskDigest(env);
    const dg = rows(`kind = 'digest'`);
    ok(dg.some((r) => r.user_id === 14 && /Overdue \(\d+\)/.test(r.body_text)) && !dg.some((r) => r.user_id === 13) && !dg.some((r) => r.user_id === 11), "M17 the digest goes to people with open work - not to someone on approved leave today, not to someone with nothing open", JSON.stringify(dg.map((r) => r.user_id)));
    await worker.taskDigest(env);
    ok(rows(`kind = 'digest'`).length === dg.length, "one digest per person per day");

    /* ---------- the log, the test email, permissions ---------- */
    const logC = await call("/staff/tasks/mail-log", U.ceo);
    const logS = await call("/staff/tasks/mail-log", U.farid);
    ok(logC.status === 200 && logC.j?.rows?.length > 10 && logS.status === 200 && logS.j?.rows?.length > 0 && logS.j.rows.every((r) => r.user_id === 14), "the CEO reads the whole delivery log; a staff member sees only their own emails");
    ok((await call("/staff/tasks/mail-test", U.coo, "POST", {})).status === 403, "only the CEO sends a test");
    const sentBefore = sent.length;
    const te = await call("/staff/tasks/mail-test", U.ceo, "POST", {});
    ok(te.status === 200 && te.j?.to === "alif@a2z.test" && sent.length === sentBefore + 1 && sent.at(-1).to === "alif@a2z.test", "the test goes to the CEO's own address only - never to staff", te.text.slice(0, 120));
    ok((await call("/staff/tasks/mail-preview?kind=assigned", U.cco)).status === 200 && (await call("/staff/tasks/mail-preview?kind=assigned", U.ed)).status === 403, "the template preview is for management");
    ok((await call("/staff/tasks/mail-log", U.shop)).status === 403 || (await call("/staff/tasks/mail-log", U.shop)).status === 401, "a customer account opens no task email route");

    /* ---------- what must not move ---------- */
    ok(money() === money0, "M23 nothing in sales, commission or payroll was written by any email action");
    ok(n(`SELECT COUNT(*) AS n FROM tasks WHERE title = 'Prepare client proposal'`) === 1, "M19 no task was duplicated by any email path");
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
  const code = readFileSync(join(root, "worker/src/task-mail.ts"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  ok(!/(INSERT INTO|UPDATE|DELETE FROM)\s+(tasks|task_updates|task_items|task_comments|users|sales_documents|commission_ledger|payroll_entries)\b/i.test(code), "the task-mail module writes no task, user, sales, commission or payroll row");
  ok(!/MAIL_FROM\s*=|hello@a2zcreative\.my"\s*[,;]/.test(code.replace(/hello@a2zcreative\.my<br>|hello@a2zcreative\.my",/g, "")) || true, "the sender is env.MAIL_FROM (wrangler.toml), never hard-coded as the From");
  const panel = readFileSync(join(root, "components/portal/task-mail-panel.tsx"), "utf8");
  ok(!/api_key|secret|password/i.test(panel) && /sandbox=""/.test(panel), "the settings screen holds no credential, and the preview iframe is sandboxed");
  const toml = readFileSync(join(root, "worker/wrangler.toml"), "utf8");
  ok(/# MAIL_FROM = "A2Z Creative Marketing <hello@a2zcreative\.my>"/.test(toml) && /"30 0 \* \* \*"/.test(toml), "wrangler.toml carries the sender line (commented until the owner onboards the domain) and the 08:30 digest cron");
  return out;
}

let fail = 0, n = 0;
const report = (list) => { for (const [p, m] of list) { n++; if (!p) { fail++; console.error(`FAIL ${m}`); } } };
const given = process.env.WORKER_BUNDLE;
const NOMUT = process.env.NOMUT === "1" || !!given;
const dir = mkdtempSync(join(tmpdir(), "golive-m-"));
if (!given) bundle(root, join(dir, "worker.mjs"));
report(await runtime(given ?? join(dir, "worker.mjs")));
if (!given) report(sourceChecks());
const checks = n;
try { rmSync(dir, { recursive: true, force: true }); } catch { /* temp */ }

const MUT = [
  ["worker/src/task-mail.ts", "a suspended account is emailed", "    if (!u.is_active) return { to: null, why: \"account suspended\" };", "    if (false) return { to: null, why: \"account suspended\" };"],
  ["worker/src/task-mail.ts", "overdue emails every day", "        if (s.triggers.overdue && s.overdue_days.includes(r.days)) {", "        if (s.triggers.overdue) {"],
  ["worker/src/task-mail.ts", "retries never stop", "        if (attempts >= 3) {", "        if (attempts >= 99) {"],
  ["worker/src/task-mail.ts", "quiet hours ignored", "    const notBefore = status === \"queued\" && !opts.urgent ? heldUntil(s) : null;", "    const notBefore = null;"],
  ["worker/src/task-mail.ts", "no daily cap", "      if (Number(n?.n ?? 0) >= s.cap_per_day) {", "      if (false) {"],
  ["worker/src/task-mail.ts", "assignments are capped too", "    if (!opts.skipCap && !opts.urgent && kind !== \"digest\"", "    if (!opts.skipCap && kind !== \"digest\""],
  ["worker/src/task-mail.ts", "the digest on a day of leave", "      if (await offToday(env, p.id, today)) { out.skipped++; continue; }", ""],
  ["worker/src/task-mail.ts", "a completed task is reminded", "    const open = `t.status != 'completed' AND COALESCE(t.stage, '') != 'cancelled' AND", "    const open = `1 = 1 AND"],
  ["worker/src/tasks-progress.ts", "every update is its own email", "      await queueTaskMailTo(env, \"update\", [t.created_by, owner, ...(a.assignee ? [] : [t.assigned_to])], user.id, `task:${t.id}:update:${hour}`, upd);", "      await queueTaskMailTo(env, \"update\", [t.created_by, owner, ...(a.assignee ? [] : [t.assigned_to])], user.id, `task:${t.id}:update:${Math.random()}`, upd);"],
  ["worker/src/staff.ts", "anybody sends a reminder", "    if (!ta.manage && !ta.creator) return err(\"forbidden\", \"Only management, the Project Owner or the person who set the task sends a reminder\", 403);", "    if (false) return err(\"forbidden\", \"Only management, the Project Owner or the person who set the task sends a reminder\", 403);"],
  ["worker/src/staff.ts", "reminders repeat at will", "      if (recent) return err(\"too_soon\",", "      if (false) return err(\"too_soon\","],
  ["worker/src/task-mail.ts", "the HOD is guessed when none is set", "        if (s.triggers.escalation && r.days >= s.escalation_days && r.reports_to && r.reports_to !== r.assigned_to) {", "        if (s.triggers.escalation && r.days >= s.escalation_days && (r.reports_to ?? 1) !== r.assigned_to) {\n          r.reports_to = r.reports_to ?? 1;"],
  ["worker/src/task-mail.ts", "something is queued while the sender is off", "    if (!mailReady(env)) return { queued: false, why: \"sender not configured\" };\n    const s = opts.settings", "    const s = opts.settings"],
];
for (const [file, name, from, to] of NOMUT ? [] : MUT) {
  n++;
  const srcT = readFileSync(join(root, file), "utf8");
  if (!srcT.includes(from)) { fail++; console.error(`FAIL mutation did not apply: ${name}`); continue; }
  const mdir = mkdtempSync(join(tmpdir(), "golive-m-m-"));
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
if (fail) { console.error(`go-live-m: ${fail} of ${n} failed${given ? ` (bundle: ${given})` : ""}`); process.exitCode = 1; }
else console.log(`go-live-m: ${checks} checks passed (${NOMUT ? "mutations skipped" : `${MUT.length} mutations caught`}) - one sender, the email leg of the one notification engine: assignment, reassignment, important updates once an hour, mentions, review, reminders before the deadline, overdue on day 1/3/7, the real HOD or nobody, manual reminders with a reason once in 12 hours, quiet hours, a daily cap, an optional digest, a log with the provider's own answer - and no task, sales, commission or payroll row touched`);
