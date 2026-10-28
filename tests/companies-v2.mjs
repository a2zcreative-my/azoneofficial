/* COMPANIES 2.0 (v1.221.0) - runtime guard, against the real handler and the
 * real migration on node:sqlite.
 *
 * The owner's answers, 28-10-2026: "Build the 3 tabs", "Bulk with preview",
 * "Checklist now, enforce later", "Count them, read-only". This guard pins
 * the behaviour behind them:
 *
 *   - the figures (/summary) are counts read from the registers - reading
 *     them writes nothing, and they agree with what the review list says;
 *   - stamped documents are COUNTED by their own issuer_code, never reviewed
 *     or changed here, and a database without those registers still answers;
 *   - company access is reported "not_active" and the build-stage checklist
 *     steps stay not built - nothing on this page switches restrictions on;
 *   - a bulk review is the single review repeated: CEO / super admin only, a
 *     reason of at least 8 characters, at most 100 records of one register,
 *     a dry run that writes nothing, one event + decision + audit per record,
 *     ALL OR NOTHING (one changed record refuses the lot, a failure mid-batch
 *     leaves no partial decision), and a retry with the same request id does
 *     not double-write;
 *   - no proposal changes a source record, an invoice's Paid status or its
 *     issuer (the company-reconciliation constraints);
 *   - the history (/events) is read-only, filtered by type and Malaysia date.
 *   - v1.221.1: "settled" is not met while records are unreviewed; the staff
 *     list shows the employer on each person's latest RELEASED payslip as
 *     evidence and saves nothing; staff set up several at a time is the
 *     single setup repeated - preview writes nothing, all or nothing, a
 *     retry does not double-write, "keep" keeps each person's own plan.
 *
 * Negative-tested by: making /summary insert a decision; dropping the
 * dry_run early return; letting one stale item through the bulk check;
 * moving the batch inside the loop (partial saves); reporting enforcement
 * "active"; letting coo call /records/bulk.
 *
 *   node tests/companies-v2.mjs
 */
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { execSync } from "node:child_process";

const dir = mkdtempSync(join(tmpdir(), "companies-v2-"));
const db = new DatabaseSync(":memory:");
let checks = 0;
const ok = (cond, label) => { assert.ok(cond, label); checks++; };
const eq = (a, b, label) => { assert.deepEqual(a, b, label); checks++; };
try {
  const bundle = join(dir, "review.mjs");
  execSync(`npx --no-install esbuild worker/src/company-review.ts --bundle --platform=node --format=esm --outfile="${bundle}"`, { stdio: "pipe" });
  const { handleCompanyReview } = await import(pathToFileURL(bundle).href);
  db.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY,name TEXT,role TEXT,is_active INTEGER);
    INSERT INTO users VALUES(1,'Chief','ceo',1),(2,'Sales','sales_marketing',1),(3,'Ops','coo',1),(4,'Customer','customer',1),(5,'Left','live_host',0);
    CREATE TABLE audit_log(id INTEGER PRIMARY KEY,user_id INTEGER,action TEXT,entity TEXT,entity_id TEXT,detail TEXT);
    CREATE TABLE expenses(id INTEGER PRIMARY KEY,vendor TEXT,description TEXT,category TEXT,expense_date TEXT,amount_cents INTEGER);
    INSERT INTO expenses VALUES(1,'Adobe','Creative Cloud','software','2026-09-03',32900),(2,'Shopee Ads','Live boost','marketing','2026-09-02',150000),(3,'Pos Laju','Courier','postage','2026-08-28',1850),(4,'AZ Supplies','Packaging','stock','2026-07-01',9000);
    CREATE TABLE purchase_orders(id INTEGER PRIMARY KEY,po_no TEXT,items TEXT,total_cents INTEGER);
    CREATE TABLE bank_accounts(id INTEGER PRIMARY KEY,name TEXT,bank TEXT,number_masked TEXT);
    INSERT INTO bank_accounts VALUES(1,'Operating','Maybank','1234');
    CREATE TABLE cashflow_entries(id INTEGER PRIMARY KEY,bank_id INTEGER,amount_cents INTEGER,description TEXT,ref TEXT,category TEXT,effective_date TEXT);
    INSERT INTO cashflow_entries VALUES(1,1,3000,'Movement','EXP-1','software','2026-09-04');
    CREATE TABLE reconciliations(id INTEGER PRIMARY KEY,period TEXT,channel TEXT,order_no TEXT,customer TEXT);
    CREATE TABLE inventory_items(id INTEGER PRIMARY KEY,sku TEXT,name TEXT,stock INTEGER);
    CREATE TABLE manual_stockouts(id INTEGER PRIMARY KEY,item_id INTEGER,item_name TEXT,qty INTEGER);
    CREATE TABLE stock_ledger(id INTEGER PRIMARY KEY,item_id INTEGER,delta INTEGER,source TEXT);
    CREATE TABLE journal_entries(id INTEGER PRIMARY KEY,memo TEXT,ref TEXT);
    CREATE TABLE sales_documents(id INTEGER PRIMARY KEY,doc_type TEXT,issuer_code TEXT,payment_status TEXT,total_cents INTEGER);
    INSERT INTO sales_documents VALUES(1,'INV','azoo','paid',10000),(2,'INV','a2z','unpaid',20000),(3,'INV',NULL,'paid',5000),(4,'QT','a2z',NULL,7000);
    CREATE TABLE payroll_entries(id INTEGER PRIMARY KEY,user_id INTEGER,month TEXT);
    INSERT INTO payroll_entries(user_id,month) VALUES(2,'2026-07'),(2,'2026-09'),(2,'2026-10'),(3,'2026-07');
    CREATE TABLE payslip_releases(month TEXT PRIMARY KEY,released_by INTEGER,released_at TEXT,issuer_code TEXT);
    INSERT INTO payslip_releases VALUES('2026-07',1,'2026-08-05 02:00:00',NULL),('2026-09',1,'2026-10-05 02:00:00','a2z');`);
  db.exec(readFileSync("worker/migrations/0134_company_review.sql", "utf8"));
  let failAt = null, beforeBatch = null;
  const DB = {
    prepare(sql) {
      let values = [];
      const execute = (method) => {
        if (failAt && sql.includes("INSERT INTO audit_log") && failAt-- === 1) { failAt = null; throw new Error("injected audit failure"); }
        let args = values;
        const query = /\?\d/.test(sql) ? sql.replace(/\?(\d+)/g, () => "?") : sql;
        if (/\?\d/.test(sql)) args = [...sql.matchAll(/\?(\d+)/g)].map((m) => values[Number(m[1]) - 1]);
        return db.prepare(query)[method](...args);
      };
      return { bind(...args) { values = args; return this; }, async first() { return execute("get") ?? null; }, async all() { return { results: execute("all") }; }, async run() { const r = execute("run"); return { success: true, meta: { changes: Number(r.changes) } }; } };
    },
    async batch(statements) {
      if (beforeBatch) { const fn = beforeBatch; beforeBatch = null; fn(); }
      db.exec("BEGIN");
      try { const out = []; for (const s of statements) out.push(await s.run()); db.exec("COMMIT"); return out; }
      catch (e) { db.exec("ROLLBACK"); throw e; }
    },
  };
  const user = { id: 1, name: "Chief", email: "chief@example.test", role: "ceo" };
  const call = (path, method = "GET", body = null, role = "ceo", id = 1) => handleCompanyReview({ DB }, new URL(`https://fixture.test${path}`), path.split("?")[0], method, body, { ...user, role, id });
  const parsed = async (r) => { assert.equal(r.status, 200, await r.clone().text()); return r.json(); };
  const count = (t) => db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
  const sources = () => JSON.stringify(["expenses", "cashflow_entries", "bank_accounts", "sales_documents"].map((t) => db.prepare(`SELECT * FROM ${t}`).all()));
  const untouched = sources();

  /* ---- who may ---- */
  for (const role of ["coo", "admin", "hr_admin", "sales_marketing", "live_host", "customer"]) {
    eq((await call("/summary", "GET", null, role)).status, 403, `${role}: no figures`);
    eq((await call("/events", "GET", null, role)).status, 403, `${role}: no history`);
    eq((await call("/records/bulk", "PUT", {}, role)).status, 403, `${role}: no bulk review`);
  }
  eq((await call("/summary", "GET", null, "super_admin")).status, 200, "super admin reads the figures");

  /* ---- the figures: counted, read-only ---- */
  const before = [count("company_review_decisions"), count("company_review_events"), count("audit_log")];
  let s = await parsed(await call("/summary"));
  eq([count("company_review_decisions"), count("company_review_events"), count("audit_log")], before, "reading the figures writes nothing");
  const exp = s.registers.find((r) => r.kind === "expenses");
  eq([exp.total, exp.unassigned, exp.proposed], [4, 4, 0], "every expense starts unassigned - nothing inferred from the vendor or category");
  eq(s.registers.length, 9, "all nine registers counted");
  eq(s.totals.unassigned, 6, "4 expenses + 1 bank account + 1 movement");
  eq(s.enforcement, "not_active", "company access is reported not active");
  ok(["ownership_columns", "scoped_queries", "jobs_scope", "pilot", "rollback_switch"].every((k) => s.checklist.find((c) => c.key === k)?.done === false), "the build-stage steps stay not built");
  eq(s.checklist.length, 9, "nine readiness steps");
  const inv = (c) => s.stamped.find((x) => x.register === "invoices" && x.company === c)?.n;
  eq([inv("azoo"), inv("a2z"), inv("legacy")], [1, 1, 1], "invoices counted by their own issuer_code; an unstamped one is 'legacy'");
  eq(s.stamped.find((x) => x.register === "quotations")?.n, 1, "quotations counted apart from invoices");
  ok(!s.stamped.some((x) => x.register === "receipts"), "a register this database lacks is skipped, not an error");
  eq(s.checklist.find((c) => c.key === "settled").done, false, "v1.221.1: nothing deferred or changed is not 'settled' while every record is unreviewed");
  eq(s.checklist.filter((c) => c.done).length, 0, "...so no readiness step is done on an untouched database");
  eq(s.staff, { active: 3, with_employer: 0, with_access: 0, without_access: 3 }, "active non-customer staff, nobody set up yet");

  /* ---- the list: snapshot per row, state/search/date filters ---- */
  let list = await parsed(await call("/records?kind=expenses&state=unassigned"));
  eq(list.total, 4, "state filter: four unassigned");
  ok(list.records.every((r) => /^[a-f0-9]{64}$/.test(r.snapshot)), "each row carries its evidence snapshot");
  eq((await parsed(await call("/records?kind=expenses&state=all&q=adobe"))).records.map((r) => r.id), [1], "search reads the party");
  eq((await parsed(await call("/records?kind=expenses&state=all&q=postage"))).records.map((r) => r.id), [3], "search reads the category");
  eq((await parsed(await call("/records?kind=expenses&state=all&from=2026-09-01&to=2026-09-30"))).records.map((r) => r.id).sort(), [1, 2], "the date range");
  eq((await call("/records?kind=expenses&state=bogus")).status, 400, "an unknown state is refused");
  const plain = await parsed(await call("/records?kind=expenses"));
  ok(plain.records.every((r) => /^[a-f0-9]{64}$/.test(r.snapshot)), "the original list path carries snapshots too");
  const item = (r) => ({ id: r.id, snapshot: r.snapshot, version: r.decision?.version ?? 0 });
  const pick = (ids) => list.records.filter((r) => ids.includes(r.id)).map(item);
  const bulk = (body, role = "ceo", id = 1) => call("/records/bulk", "PUT", { kind: "expenses", proposed_company: "azoo", reason: "Matched to AZ ONE statements", request_id: crypto.randomUUID(), ...body }, role, id);

  /* ---- validation ---- */
  eq((await bulk({ items: pick([1, 2]), reason: "short" })).status, 400, "a reason under 8 characters is refused");
  eq((await bulk({ items: [] })).status, 400, "an empty selection is refused");
  eq((await bulk({ items: [item(list.records[0]), item(list.records[0])] })).status, 400, "a record twice is refused");
  eq((await bulk({ items: pick([1]), proposed_company: "elfia" })).status, 400, "only the two companies - a client is not a company");
  eq((await bulk({ items: Array.from({ length: 101 }, (_, i) => ({ id: i + 1, snapshot: "a".repeat(64), version: 0 })) })).status, 400, "at most 100 at a time");
  eq((await bulk({ items: pick([1]), kind: "users" })).status, 400, "only the review registers");

  /* ---- the dry run writes nothing ---- */
  const dry = await parsed(await bulk({ items: pick([1, 2]), dry_run: true }));
  eq([dry.dry_run, dry.count, dry.total_cents], [true, 2, 182900], "the preview counts the records and their value");
  eq([count("company_review_decisions"), count("company_review_events"), count("audit_log")], before, "the preview writes nothing");

  /* ---- all or nothing: one changed record refuses the lot ---- */
  db.exec(`UPDATE expenses SET amount_cents=33000 WHERE id=1`);
  const stale = await bulk({ items: pick([1, 2]) });
  eq(stale.status, 409, "a record changed after listing refuses the bulk save");
  eq(count("company_review_decisions"), 0, "...and nothing of it was saved");
  db.exec(`UPDATE expenses SET amount_cents=32900 WHERE id=1`);

  /* ---- all or nothing: a failure mid-batch leaves no partial decision ---- */
  failAt = 2;
  const broken = await bulk({ items: pick([1, 2]) });
  eq(broken.status, 500, "the second record's audit fails");
  eq([count("company_review_decisions"), count("company_review_events"), count("audit_log")], before, "no partial decision committed");

  /* ---- all or nothing: a race between the read and the batch ---- */
  beforeBatch = () => db.exec(`UPDATE expenses SET description='Creative Cloud (edited)' WHERE id=2`);
  const raced = await bulk({ items: pick([1, 2]) });
  eq(raced.status, 409, "a record edited between the check and the save refuses the lot");
  eq(count("company_review_decisions"), 0, "...and nothing of it was saved");
  db.exec(`UPDATE expenses SET description='Live boost' WHERE id=2`);

  /* ---- the save: one event + decision + audit per record ---- */
  const rid = crypto.randomUUID();
  const saved = await parsed(await bulk({ items: pick([1, 2]), request_id: rid }));
  eq(saved.count, 2, "two reviews saved");
  eq([count("company_review_decisions"), count("company_review_events"), count("audit_log")], [2, 2, 2], "one decision, one event and one audit line per record");
  ok(db.prepare(`SELECT proposed_company, reviewed_by, reason FROM company_review_decisions`).all().every((d) => d.proposed_company === "azoo" && d.reviewed_by === 1 && d.reason === "Matched to AZ ONE statements"), "each decision carries the company, the reviewer and the reason");
  const again = await parsed(await bulk({ items: pick([1, 2]), request_id: rid }));
  ok(again.replayed === true && count("company_review_events") === 2, "a retry with the same request id does not write twice");
  eq((await bulk({ items: pick([1, 2]), request_id: rid, proposed_company: "a2z" })).status, 409, "the same request id for a different decision is refused");
  eq((await bulk({ items: pick([1, 2]), request_id: rid }, "super_admin", 6)).status, 409, "...and by a different person");
  eq((await bulk({ items: pick([1, 2]) })).status, 409, "the listed versions are now old: a second bulk save on them is refused");
  eq(sources(), untouched, "no source record, invoice, Paid status or issuer changed");

  /* ---- defer, and the figures follow ---- */
  list = await parsed(await call("/records?kind=expenses&state=unassigned"));
  await parsed(await bulk({ items: pick([3]), proposed_company: null, reason: "Shared courier account - ask finance" }));
  s = await parsed(await call("/summary"));
  const e2 = s.registers.find((r) => r.kind === "expenses");
  eq([e2.unassigned, e2.proposed, e2.deferred, e2.by_company.azoo], [1, 2, 1, 2], "the figures follow the reviews");
  const listed = await parsed(await call("/records?kind=expenses&state=proposed"));
  eq(listed.total, e2.proposed, "the figure and the list agree");
  db.exec(`UPDATE expenses SET amount_cents=1900 WHERE id=3`);
  s = await parsed(await call("/summary"));
  eq(s.registers.find((r) => r.kind === "expenses").stale, 1, "a record changed after its review counts as changed, not settled");
  eq(s.checklist.find((c) => c.key === "settled").done, false, "the readiness step is not met");

  /* ---- the history: read-only, by type and Malaysia date ---- */
  const nEvents = count("company_review_events");
  const h = await parsed(await call("/events"));
  eq(h.total, nEvents, "every event listed");
  ok(h.events.every((e) => e.actor_name === "Chief"), "with who did it");
  ok(JSON.parse(h.events[0].after_json).bulk === true, "a bulk review is marked as one");
  eq((await parsed(await call("/events?type=staff"))).total, 0, "type filter: no staff plans yet");
  eq((await parsed(await call("/events?type=ownership"))).total, nEvents, "type filter: ownership");
  /* the history is immutable (0134's triggers), so the date filter is read
     against the real clock: every event was written today, Malaysia time */
  const mytDay = (ms) => new Date(ms + 8 * 3600 * 1000).toISOString().slice(0, 10);
  eq((await parsed(await call(`/events?from=${mytDay(Date.now())}&to=${mytDay(Date.now())}`))).total, nEvents, "today, Malaysia time: every event");
  eq((await parsed(await call(`/events?from=${mytDay(Date.now() + 2 * 86400000)}`))).total, 0, "from a later day: none");
  let immutable = false;
  try { db.exec(`UPDATE company_review_events SET after_json='{}'`); } catch { immutable = true; }
  ok(immutable, "a history entry cannot be edited");
  eq((await call("/events?type=everything")).status, 400, "an unknown type is refused");
  eq(count("company_review_events"), nEvents, "reading the history writes nothing");

  /* ---- v1.221.1 - the payslip evidence, and staff set up several at a time ---- */
  const untouched2 = sources() + JSON.stringify(db.prepare("SELECT * FROM payroll_entries").all()) + JSON.stringify(db.prepare("SELECT * FROM payslip_releases").all());
  const before2 = [count("company_review_events"), count("company_staff_setup"), count("company_memberships"), count("audit_log")];
  let people = (await parsed(await call("/staff"))).staff;
  const who = (id) => people.find((x) => x.id === id);
  eq(who(2).payslip, { month: "2026-09", company: "a2z" }, "evidence: the employer on the latest RELEASED payslip (October is not released)");
  eq(who(3).payslip, { month: "2026-07", company: "azoo" }, "an unstamped month prints AZ ONE, as the payslip renderer does");
  eq(who(1).payslip, null, "no payslip, no evidence");
  ok(people.every((x) => x.employer_code === null), "evidence is shown, never saved: every employer is still unassigned");
  eq(before2, [count("company_review_events"), count("company_staff_setup"), count("company_memberships"), count("audit_log")], "reading the staff list writes nothing");
  const sitem = (id) => ({ id, version: who(id).version });
  const sbulk = (body, role = "ceo", id = 1) => call("/staff/bulk", "PUT", { employer_code: "a2z", memberships: [{ company_code: "a2z", access_mode: "read" }], reason: "Employment contract with A2Z Creative", request_id: crypto.randomUUID(), items: [sitem(2), sitem(3)], ...body }, role, id);
  for (const role of ["coo", "hr_admin", "sales_marketing"]) eq((await sbulk({}, role)).status, 403, `${role}: no staff bulk setup`);
  eq((await sbulk({ reason: "short" })).status, 400, "staff bulk: a reason under 8 characters is refused");
  eq((await sbulk({ employer_code: "elfia" })).status, 400, "staff bulk: only the two companies");
  eq((await sbulk({ items: [sitem(2), sitem(2)] })).status, 400, "staff bulk: a person twice is refused");
  eq((await sbulk({ items: Array.from({ length: 51 }, (_, i) => ({ id: i + 1, version: 0 })) })).status, 400, "staff bulk: at most 50 at a time");
  eq((await sbulk({ items: [{ id: 4, version: 0 }] })).status, 404, "staff bulk: a customer is not staff");
  const sdry = await parsed(await sbulk({ dry_run: true }));
  eq(sdry.changes.map((c) => [c.name, c.from, c.to]), [["Sales", null, "a2z"], ["Ops", null, "a2z"]], "the staff preview lists each person's change");
  eq(before2, [count("company_review_events"), count("company_staff_setup"), count("company_memberships"), count("audit_log")], "the staff preview writes nothing");
  eq((await sbulk({ items: [sitem(2), { id: 3, version: 4 }] })).status, 409, "one person's setup changed since listing refuses the lot");
  failAt = 2;
  eq((await sbulk({})).status, 500, "the second person's audit fails");
  eq(before2, [count("company_review_events"), count("company_staff_setup"), count("company_memberships"), count("audit_log")], "no partial staff setup committed");
  const srid = crypto.randomUUID();
  eq((await parsed(await sbulk({ request_id: srid }))).count, 2, "two setups saved");
  eq([count("company_staff_setup"), count("company_memberships")], [2, 2], "one setup and one membership each");
  ok((await parsed(await sbulk({ request_id: srid }))).replayed === true && count("company_staff_setup") === 2, "a retry does not write twice");
  people = (await parsed(await call("/staff"))).staff;
  eq((await parsed(await sbulk({ employer_code: "azoo", memberships: null, items: [sitem(2)] }))).count, 1, "employer only, access plan kept");
  people = (await parsed(await call("/staff"))).staff;
  eq([who(2).employer_code, who(2).memberships], ["azoo", [{ company_code: "a2z", access_mode: "read" }]], "'keep' keeps that person's own plan");
  eq((await parsed(await call("/events?type=staff"))).total, 3, "every staff setup is in the history");
  ok(JSON.parse((await parsed(await call("/events?type=staff"))).events[0].after_json).bulk === true, "marked as a bulk setup");
  s = await parsed(await call("/summary"));
  eq([s.staff.with_employer, s.staff.with_access], [2, 2], "the figures follow");
  eq(s.enforcement, "not_active", "still a plan: access is not enforced");
  eq(sources() + JSON.stringify(db.prepare("SELECT * FROM payroll_entries").all()) + JSON.stringify(db.prepare("SELECT * FROM payslip_releases").all()), untouched2, "no source record, invoice, payroll entry or payslip changed");

  console.log(`Companies 2.0: ${checks} checks passed - counted figures, read-only history, previewed all-or-nothing bulk review, access not active.`);
} finally {
  db.close();
  rmSync(dir, { recursive: true, force: true });
}
