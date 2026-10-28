/* WEEKLY SALES (v1.223.0) - runtime guard: the real worker (staff.ts,
 * bundled) against SQLite with EVERY migration applied.
 *
 * The owner's answers, 28-10-2026 (claude/WEEKLY-SALES-AUDIT.md):
 * "Approved weekly targets", "Paid in full", "Tasks with a link", "CEO, COO,
 * super admin". This guard pins:
 *
 *   - no target, no figure: "no_target" until one is approved - nothing is
 *     prorated or invented; a target is set only by the CEO, COO or super
 *     admin, with a reason, on the first day of a week; a change is a new
 *     row (history kept); "not set" can be recorded from a week;
 *   - the basis is the Sales "Collected" rule exactly - paid in full, on the
 *     paid day, by closer - and equals /docs/summary's week for that person;
 *     a part payment, an unpaid invoice or another closer's sale never
 *     counts; the confirmed amount is beside it, never instead;
 *   - the expectation counts working days only: weekends, public holidays and
 *     approved leave (a half day as half) are left out;
 *   - the status waits for the early-warning day, then reads On track / At
 *     risk (enough open quotations and some activity) / Action required, and
 *     Achieved or Missed when the week ends;
 *   - a finished week is written down once and a later change shows beside
 *     it; its target can no longer be changed;
 *   - a consultant only ever reads their own week;
 *   - a recovery plan is drafted by its owner, reviewed by the CEO, COO or
 *     super admin (never their own), and on approval each chosen action
 *     becomes ONE Task linked to the plan - approving again adds none;
 *   - a sales task names an existing customer, enquiry or quotation, and one
 *     open task per person and record is enough.
 *
 *   - v1.223.1: the people come from the Staff record - no leaver, no
 *     "Resigned" without a last day, a mid-week leaver for that week only
 *     (and only their employed days), a re-joiner back, any role that
 *     closed a sale; a target cannot be set for a leaver.
 *
 * Negative-tested by: dropping the WEEK_TARGET_ROLES check; counting part-
 * paid invoices; ignoring approved leave; judging before the checkpoint;
 * INSERT instead of INSERT OR IGNORE for results; letting scope=all through
 * for a consultant; removing the task de-duplication; (1.223.1) dropping the left_on
 * test, the employment_status test or the closer clause from the staff
 * list, and the employed-days filter.
 *
 *   node tests/weekly-sales.mjs
 */
import { readFileSync, readdirSync, mkdtempSync } from "node:fs";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");
let passed = 0, failed = 0;
const ok = (label, cond, why = "") => { if (cond) passed++; else { failed++; console.log(`  ✗ ${label}${why ? ` — ${why}` : ""}`); } };

/* ---- source ---- */
const mig = read("worker/migrations/0149_weekly_sales.sql");
ok("0149 only adds - new tables, two nullable task columns, indexes", !/\b(UPDATE|DELETE|DROP|INSERT)\b/i.test(mig.replace(/^--.*$/gm, "")) && (mig.match(/ALTER TABLE tasks ADD COLUMN/g) ?? []).length === 2 && !/ALTER TABLE (?!tasks)/.test(mig));
ok("0149 is registered and probed", /"0149_weekly_sales",/.test(read("worker/src/index.ts")) && /\["0149 \(weekly sales/.test(read("worker/src/index.ts")));
const ws = read("worker/src/weekly-sales.ts");
ok("no commission figure is calculated for the week", !/commission_cents|rate_pct|commissionFor/.test(ws));
ok("one task engine: the plan writes to the existing tasks table, nothing else holds tasks", !/CREATE TABLE[^;]*task/i.test(mig) && /INSERT INTO tasks \(title, description, assigned_to, created_by, priority, deadline, link_kind, link_id\)/.test(ws));

/* ---- runtime ---- */
const dir = mkdtempSync(join(tmpdir(), "weekly-"));
const out = join(dir, "staff.mjs");
execSync(`npx esbuild "${join(root, "worker/src/staff.ts")}" --bundle --format=esm --platform=neutral --outfile="${out}" --log-level=error`, { cwd: root, stdio: "inherit" });
const db = new DatabaseSync(":memory:");
for (const f of readdirSync(join(root, "worker/migrations")).filter((x) => x.endsWith(".sql")).sort()) {
  for (const st of readFileSync(join(root, "worker/migrations", f), "utf8").split(/;\s*\n/)) { try { db.exec(st); } catch { /* a statement SQLite reads differently */ } }
}
const shim = (sql) => { const st = db.prepare(sql); let b = []; const o = {
  bind: (...a) => { b = a.map((x) => (x === undefined ? null : x)); return o; },
  first: async () => st.get(...b) ?? null, all: async () => ({ results: st.all(...b) }),
  run: async () => ({ meta: { changes: Number(st.run(...b).changes) } }), _run: () => st.run(...b) }; return o; };
const env = { DB: { prepare: shim, batch: async (list) => { db.exec("BEGIN"); try { for (const s of list) s._run(); db.exec("COMMIT"); } catch (e) { db.exec("ROLLBACK"); throw e; } return []; } } };
db.exec(`INSERT INTO users (id, name, email, role, is_active, password_hash) VALUES (1,'Boss','b@x.t','ceo',1,'x'),(2,'Ops','o@x.t','coo',1,'x'),(3,'Com','c@x.t','cco',1,'x'),(4,'Aina','a@x.t','sales_marketing',1,'x'),(5,'Hafiz','h@x.t','sales_marketing',1,'x'),(6,'Adm','d@x.t','admin',1,'x'),(7,'Sup','s@x.t','super_admin',1,'x')`);
db.exec(`INSERT INTO customers (id, company, created_by, created_at) VALUES (1,'Kedai Satu',4,'2026-09-15 02:00:00'),(2,'Kedai Dua',4,'2026-08-01 02:00:00'),(3,'Kedai Tiga',5,'2026-09-15 02:00:00')`);
const doc = db.prepare(`INSERT INTO sales_documents (id, doc_type, doc_number, customer_id, items, total_cents, payment_status, created_at, created_by, salesperson_id, paid_at, converted_from, valid_until) VALUES (?,?,?,?,'[]',?,?,?,1,?,?,?,?)`);
/* the week of Monday 14 September 2026; "today" is Friday 18th */
doc.run(10, "QT", "QT-10", 1, 300000, null, "2026-09-14 02:00:00", 4, null, null, "2026-10-31");   // open, Aina
doc.run(11, "QT", "QT-11", 2, 200000, null, "2026-09-15 02:00:00", 4, null, null, "2026-10-31");   // converted below
doc.run(12, "INV", "INV-12", 2, 200000, "paid", "2026-09-15 03:00:00", 4, "2026-09-16 02:00:00", 11, null); // Aina, paid in full this week
doc.run(13, "INV", "INV-13", 1, 150000, "unpaid", "2026-09-15 03:00:00", 4, null, null, null);       // part-paid only
doc.run(14, "INV", "INV-14", 3, 500000, "paid", "2026-09-15 03:00:00", 5, "2026-09-17 02:00:00", null, null); // Hafiz
doc.run(15, "INV", "INV-15", 2, 90000, "paid", "2026-09-08 03:00:00", 4, "2026-09-09 02:00:00", null, null);  // Aina, last week
db.exec(`INSERT INTO invoice_payments (invoice_id, amount_cents, received_on, reference, created_by) VALUES (13, 50000, '2026-09-16', 'TT', 1)`);
db.exec(`INSERT OR IGNORE INTO holidays (holiday_date, name, kind) VALUES ('2026-09-16', 'Malaysia Day', 'public')`);
db.exec(`INSERT INTO customer_followups (customer_id, due_on, owner_id, note, created_by, done_at, done_by) VALUES (1, '2026-09-15', 4, 'Call back', 4, '2026-09-15 04:00:00', 4), (2, '2026-09-10', 4, 'Chase', 4, NULL, NULL)`);

const { handleStaff } = await import(pathToFileURL(out).href);
const RealDate = Date; let fixed = new RealDate("2026-09-18T02:00:00Z").getTime();
globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [fixed])); } static now() { return fixed; } };
const ROLE = { 1: "ceo", 2: "coo", 3: "cco", 4: "sales_marketing", 5: "sales_marketing", 6: "admin", 7: "super_admin" };
const call = async (p, id = 1, method = "GET", body) => {
  const r = await handleStaff(new Request(`https://x/api/v1/staff${p}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }), env, p.split("?")[0], { id, role: ROLE[id], name: "x" });
  return { status: r.status, j: await r.json().catch(() => null) };
};

try {
  /* 1. no target, no figure */
  let me = (await call("/sales/week", 4)).j;
  ok("the week runs Monday to Sunday, Malaysia time", me?.week?.from === "2026-09-14" && me.week.to === "2026-09-20" && me.week.checkpoint === "review", JSON.stringify(me?.week));
  ok("with no approved target: no target, no %, no gap, no status judgement", me?.me?.status === "no_target" && me.me.target_cents === null && me.me.pct === null && me.me.gap_cents === null);

  /* 2. who sets a target, and how */
  const setT = (id, b) => call("/sales/week/targets", id, "POST", b);
  for (const id of [3, 4, 6]) ok(`${ROLE[id]} cannot set a weekly target`, (await setT(id, { scope: "person", user_id: 4, week_from: "2026-09-14", target_cents: 500000, reason: "Q3 push for Aina" })).status === 403);
  ok("a target needs a reason", (await setT(1, { scope: "person", user_id: 4, week_from: "2026-09-14", target_cents: 500000, reason: "go" })).status === 400);
  ok("a target starts on the first day of a week", (await setT(1, { scope: "person", user_id: 4, week_from: "2026-09-15", target_cents: 500000, reason: "Q3 push for Aina" })).status === 400);
  ok("the CEO sets one", (await setT(1, { scope: "person", user_id: 4, week_from: "2026-09-07", target_cents: 400000, reason: "First weekly target" })).status === 201);
  ok("the COO changes it from this week - a new row, the history kept", (await setT(2, { scope: "person", user_id: 4, week_from: "2026-09-14", target_cents: 500000, reason: "Raised after the expo" })).status === 201 && db.prepare(`SELECT COUNT(*) AS n FROM sales_week_targets WHERE user_id = 4`).get().n === 2);
  ok("super admin sets the company target", (await setT(7, { scope: "company", week_from: "2026-09-14", target_cents: 1000000, reason: "Company weekly goal" })).status === 201);
  ok("a change is audited", db.prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'sales.week_target'`).get().n === 3);

  /* 3. the basis, the confirmed amount, the activity */
  me = (await call("/sales/week", 4)).j.me;
  ok("the target in force is the latest from this week or before", me.target_cents === 500000 && me.target_from === "2026-09-14");
  ok("basis = invoices paid in full this week by this closer (not part payments, not unpaid, not another closer, not last week)", me.basis_cents === 200000 && me.paid_invoices === 1, String(me.basis_cents));
  ok("confirmed is shown beside it - nothing confirmed yet", me.confirmed_cents === 0);
  db.exec(`INSERT INTO invoice_paid_confirmations (invoice_id, amount_cents, confirmed_by) VALUES (12, 200000, 1)`);
  me = (await call("/sales/week", 4)).j.me;
  ok("...and counts a CEO/COO confirmation", me.confirmed_cents === 200000 && me.basis_cents === 200000);
  ok("activity: quotations sent, deals won, follow-ups done and overdue, new customers", me.quotations.n === 2 && me.won.n === 1 && me.followups_done === 1 && me.followups_overdue === 1 && me.new_customers === 1, JSON.stringify(me));
  ok("open quotations: not invoiced, not expired", me.open_quotations.n === 1 && me.open_quotations.cents === 300000);
  const sum = (await call("/docs/summary?scope=mine&week=2026-09-14", 4)).j;
  ok("the weekly basis is the Sales 'Collected' rule: it equals /docs/summary's week", sum?.week?.collected?.cents === me.basis_cents, `${sum?.week?.collected?.cents} vs ${me.basis_cents}`);

  /* 4. working days and the status */
  ok("working days leave out the weekend and the public holiday", me.working_days === 4 && me.elapsed_days === 3, `${me.working_days}/${me.elapsed_days}`);
  ok("expected by now = target x days over / days in the week", me.expected_cents === Math.round(500000 * 3 / 4) && me.gap_cents === 300000);
  ok("below the expectation, with open quotations covering the gap and some activity: At risk", me.status === "at_risk", me.status);
  db.exec(`INSERT INTO leave_requests (user_id, type, start_date, end_date, days, status, day_part) VALUES (4, 'annual', '2026-09-14', '2026-09-14', 1, 'approved', 'full'), (4, 'annual', '2026-09-17', '2026-09-17', 0.5, 'approved', 'first_half')`);
  me = (await call("/sales/week", 4)).j.me;
  ok("approved leave is not a working day; a half day counts half", me.working_days === 2.5 && me.elapsed_days === 1.5, `${me.working_days}/${me.elapsed_days}`);
  db.exec(`UPDATE sales_documents SET valid_until = '2026-09-01' WHERE id = 10`);
  me = (await call("/sales/week", 4)).j.me;
  ok("without open quotations to cover the gap: Action required", me.status === "action", me.status);
  db.exec(`UPDATE sales_documents SET valid_until = '2026-10-31' WHERE id = 10`);
  fixed = new RealDate("2026-09-15T02:00:00Z").getTime();
  me = (await call("/sales/week", 4)).j.me;
  ok("before the early-warning day nobody is judged: Planning", me.status === "planning" && (await call("/sales/week", 4)).j.week.checkpoint === "planning", me.status);
  fixed = new RealDate("2026-09-18T02:00:00Z").getTime();
  ok("Hafiz (no target) is not judged", (await call("/sales/week", 5)).j.me.status === "no_target");

  /* 5. scope: a consultant only ever reads their own week */
  const forced = (await call("/sales/week?scope=all", 4)).j;
  ok("a consultant asking for everyone gets their own week", forced.scope === "mine" && !forced.rows);
  const all = (await call("/sales/week?scope=all", 3)).j;
  ok("the CCO reads everyone", all.scope === "all" && all.rows.length >= 2 && all.company.target_cents === 1000000 && all.company.basis_cents === 700000, JSON.stringify(all.company));
  ok("the CCO may not set targets (the screen is told so)", all.can_set === false && (await call("/sales/week?scope=all", 1)).j.can_set === true);

  /* 6. a finished week is written once */
  const lastWeek = (await call("/sales/week?scope=all&week=2026-09-07", 1)).j;
  const aina = lastWeek.rows.find((r) => r.user_id === 4);
  ok("last week ended: Missed, against last week's target", aina.status === "missed" && aina.target_cents === 400000 && aina.basis_cents === 90000, JSON.stringify(aina));
  ok("...and it is written down, with the company line", db.prepare(`SELECT COUNT(*) AS n FROM sales_week_results WHERE week_from = '2026-09-07'`).get().n === lastWeek.rows.length + 1);
  db.exec(`UPDATE sales_documents SET total_cents = 95000 WHERE id = 15`);
  await call("/sales/week?scope=all&week=2026-09-07", 1);
  const again = (await call("/sales/week?scope=all&week=2026-09-07", 1)).j.rows.find((r) => r.user_id === 4);
  ok("a later change is not written over the result: it shows beside it", db.prepare(`SELECT basis_cents FROM sales_week_results WHERE week_from = '2026-09-07' AND user_id = 4`).get().basis_cents === 90000 && again.final.changed_cents === 5000);
  ok("a finished week's target cannot be changed", (await setT(1, { scope: "person", user_id: 4, week_from: "2026-09-07", target_cents: 1, reason: "Make it look better" })).j?.error?.code === "week_final");

  /* 7. the recovery plan */
  const putPlan = (id, b) => call("/sales/week/plan", id, "PUT", b);
  ok("an action needs a kind and words", (await putPlan(4, { actions: [{ key: "spam", text: "Blast everyone" }] })).status === 400);
  ok("submitting an empty plan is refused", (await putPlan(4, { actions: [], submit: true })).status === 400);
  await putPlan(4, { actions: [{ key: "quotations", text: "Call Kedai Satu about QT-10" }, { key: "renewals", text: "Ask Kedai Dua about renewal" }], note: "Two quotes close Monday" });
  let plan = (await call("/sales/week/plan", 4)).j;
  ok("the plan starts from facts: the open quotation, the overdue follow-up", plan.plan.status === "draft" && plan.facts.quotations.some((q) => q.doc_number === "QT-10") && plan.facts.overdue_followups.length === 1 && plan.can_edit === true);
  ok("another consultant cannot read it", (await call("/sales/week/plan?user_id=4", 5)).status === 403);
  ok("the CCO reads it", (await call("/sales/week/plan?user_id=4", 3)).status === 200);
  await putPlan(4, { actions: [{ key: "quotations", text: "Call Kedai Satu about QT-10" }, { key: "renewals", text: "Ask Kedai Dua about renewal" }], submit: true });
  const pid = db.prepare(`SELECT id FROM sales_recovery_plans WHERE user_id = 4`).get().id;
  ok("the CCO cannot approve", (await call(`/sales/week/plan/${pid}/review`, 3, "POST", { decision: "approve" })).status === 403);
  const ap = await call(`/sales/week/plan/${pid}/review`, 2, "POST", { decision: "approve", note: "Go", tasks: [{ index: 0, deadline: "2026-09-21", priority: "high" }, { index: 1 }] });
  const linked = db.prepare(`SELECT * FROM tasks WHERE link_kind = 'recovery' AND link_id = ?`).all(pid);
  ok("approval turns each chosen action into one Task for the consultant, linked to the plan", ap.status === 200 && linked.length === 2 && linked.every((t) => t.assigned_to === 4 && t.created_by === 2) && linked[0].priority === "high");
  ok("an approved plan cannot be edited by its owner", (await putPlan(4, { actions: [{ key: "own", text: "Change it all" }] })).status === 409);
  await call(`/sales/week/plan/${pid}/review`, 1, "POST", { decision: "return", note: "Add a new channel please" });
  await putPlan(4, { actions: [...JSON.parse(db.prepare(`SELECT actions FROM sales_recovery_plans WHERE id = ?`).get(pid).actions), { key: "new_channel", text: "Try the TikTok shop leads" }], submit: true });
  await call(`/sales/week/plan/${pid}/review`, 1, "POST", { decision: "approve", tasks: [{ index: 0 }, { index: 1 }, { index: 2 }] });
  ok("approving again adds only the new action - no duplicate tasks", db.prepare(`SELECT COUNT(*) AS n FROM tasks WHERE link_kind = 'recovery' AND link_id = ?`).get(pid).n === 3);
  db.exec(`INSERT INTO sales_recovery_plans (user_id, week_from, status, actions) VALUES (1, '2026-09-14', 'submitted', '[{"key":"own","text":"Mine"}]')`);
  const own = db.prepare(`SELECT id FROM sales_recovery_plans WHERE user_id = 1`).get().id;
  ok("nobody approves their own plan", (await call(`/sales/week/plan/${own}/review`, 1, "POST", { decision: "approve" })).status === 403);

  /* 8. a sales task in the existing Tasks */
  const task = (id, b) => call("/tasks", id, "POST", b);
  const t1 = await task(1, { title: "Follow up QT-10", assigned_to: 4, link_kind: "quotation", link_id: 10, priority: "high", deadline: "2026-09-19" });
  ok("a manager assigns a task linked to a quotation", t1.status < 300 && db.prepare(`SELECT link_kind, link_id FROM tasks WHERE id = ?`).get(t1.j.id)?.link_id === 10);
  const t2 = await task(2, { title: "Follow up QT-10 again", assigned_to: 4, link_kind: "quotation", link_id: 10 });
  ok("one open task per person and record: the second returns the first", t2.j?.existing === true && t2.j.id === t1.j.id && db.prepare(`SELECT COUNT(*) AS n FROM tasks WHERE link_kind = 'quotation' AND link_id = 10`).get().n === 1);
  ok("a link to a record that does not exist is refused", (await task(1, { title: "x", assigned_to: 4, link_kind: "quotation", link_id: 999 })).status === 404);
  ok("an unknown link kind is refused", (await task(1, { title: "x", assigned_to: 4, link_kind: "invoice", link_id: 12 })).status === 400);
  ok("a consultant still assigns only to themselves", (await task(4, { title: "x", assigned_to: 5, link_kind: "customer", link_id: 1 })).status === 403);
  ok("a plain task is made as before", (await task(4, { title: "Tidy the shelf" })).status < 300);
  db.exec(`UPDATE tasks SET status = 'completed' WHERE id = ${t1.j.id}`);
  ok("once done, a new task for the same record may be assigned", (await task(1, { title: "Second round QT-10", assigned_to: 4, link_kind: "quotation", link_id: 10 })).j?.existing !== true);
  ok("sales tasks count in the week", (await call("/sales/week", 4)).j.me.tasks.done === 1);
  ok("...and show in the consultant's own Tasks list, with their link", ((await call("/tasks", 4)).j?.tasks ?? []).some((t) => t.link_kind === "quotation" && t.link_id === 10));

  /* 9. v1.223.1 (the owner, 28-10-2026: "the list only appear this lady name
     which is already resigned"). The people come from the Staff record:
     a leaver is gone, a "Resigned" status with no last day is gone, someone
     who leaves mid-week counts for that week only, a re-joiner is back, and
     whoever closed a sale that week is listed whatever their role. */
  db.exec(`INSERT INTO users (id, name, email, role, is_active, password_hash, employment_status, left_on, rejoined_on) VALUES
    (8,'Nasuha','n@x.t','sales_marketing',1,'x','resigned','2026-09-01',NULL),
    (9,'Zul','z@x.t','sales_marketing',1,'x','resigned',NULL,NULL),
    (10,'Mira','m@x.t','sales_marketing',1,'x','resigned','2026-09-16',NULL),
    (11,'Lina','l@x.t','live_host',1,'x','permanent',NULL,NULL),
    (12,'Rafi','r@x.t','sales_marketing',1,'x','permanent','2026-06-30','2026-09-01')`);
  ROLE[8] = "sales_marketing"; ROLE[11] = "live_host";
  doc.run(16, "INV", "INV-16", 1, 120000, "paid", "2026-09-15 03:00:00", 11, "2026-09-15 05:00:00", null, null); // Lina closed one
  const rows = (await call("/sales/week?scope=all", 1)).j.rows;
  const ids = rows.map((r) => r.user_id);
  ok("a leaver whose last day is before the week is not listed", !ids.includes(8), JSON.stringify(ids));
  ok("a 'Resigned' status on the Staff tab with no last day is not listed either", !ids.includes(9), JSON.stringify(ids));
  ok("someone leaving mid-week counts for that week", ids.includes(10));
  ok("...on the days they were still employed only", rows.find((r) => r.user_id === 10)?.working_days === 2, String(rows.find((r) => r.user_id === 10)?.working_days));
  ok("a re-joiner is back", ids.includes(12));
  ok("whoever closed a sale that week is listed, whatever their role", ids.includes(11) && rows.find((r) => r.user_id === 11).basis_cents === 120000);
  ok("system accounts are never listed", !ids.includes(6) && !ids.includes(7));
  const earlier = (await call("/sales/week?scope=all&week=2026-08-31", 1)).j.rows.map((r) => r.user_id);
  ok("the leaver still shows for a week they worked", earlier.includes(8) && !earlier.includes(9), JSON.stringify(earlier));
  const tg = (await call("/sales/week/targets", 1)).j;
  const cand = (tg.candidates ?? []).map((c) => c.id);
  ok("a target can be set for anyone on staff - the CEO and a live host included - but not a leaver", cand.includes(1) && cand.includes(11) && !cand.includes(8) && !cand.includes(9) && !cand.includes(7), JSON.stringify(cand));
  ok("the targets list itself carries no leaver", !tg.people.some((p) => p.id === 8 || p.id === 9));
  ok("only a setter is offered the candidates", ((await call("/sales/week/targets", 3)).j.candidates ?? []).length === 0);
  ok("a target for a leaver is refused", (await setT(1, { scope: "person", user_id: 8, week_from: "2026-09-14", target_cents: 100000, reason: "Should not be possible" })).status === 404);
  ok("...and for a 'Resigned' status with no last day", (await setT(1, { scope: "person", user_id: 9, week_from: "2026-09-14", target_cents: 100000, reason: "Should not be possible" })).status === 404);
  ok("a target for a live host who sells is accepted", (await setT(1, { scope: "person", user_id: 11, week_from: "2026-09-14", target_cents: 100000, reason: "Lina sells on live too" })).status === 201);
} catch (e) {
  failed++;
  console.log(`  ✗ runtime: ${e?.stack ?? e}`);
}

console.log(failed ? `\nweekly-sales: ${failed} failed, ${passed} passed.` : `Weekly Sales: ${passed} checks passed - approved targets only, the Collected rule, working days, fair statuses, final weeks, plans to linked tasks once.`);
process.exit(failed ? 1 : 0);
