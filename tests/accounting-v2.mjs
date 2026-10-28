/* ACCOUNTING 2.0 (v1.222.0) - runtime guard: the real worker (staff.ts,
 * bundled) against SQLite with EVERY migration applied.
 *
 * The owner's answers, 28-10-2026 (claude/ACCOUNTING-AUDIT.md): "Four tabs,
 * read-only"; posting fixes "Atomic + duplicate guard", "Date by money-moved
 * day", "Reverse manual journals", "Service invoices -> 4100"; month end
 * "Soft control"; paid authority "Flag it, don't restrict". This guard pins
 * the behaviour behind each:
 *
 *   - a journal and its lines are written together or not at all - a failed
 *     line leaves no half entry, and the cash movement it belonged to shows
 *     as "not in the books" instead of vanishing;
 *   - a new automatic entry is dated the day its money moved; a paid service
 *     invoice books to 4100, a product invoice to 4000;
 *   - a reference written from 29-10-2026 is unique (0148), history is not;
 *   - a manual entry gets its own MJ- reference, is refused if unbalanced,
 *     and asks for a reason - never refuses - when dated in a closed month;
 *     the reason is kept and the entry is listed as a post-close adjustment;
 *   - a manual entry is reversed by a mirror with a reason, once; an entry
 *     booked by a source, and a reversal itself, are not reversed here;
 *   - the reads (overview, month-end, journal, ledger, P&L, trial balance as
 *     at a date) read on the day the money moved, find every exception
 *     planted, write nothing, and are refused to every role but super admin,
 *     admin and CEO;
 *   - a month close snapshots the ledger too, and a close taken before that
 *     does not report the new figures as "changed".
 *
 * Negative-tested by: posting the entry and lines as separate statements;
 * dropping the effective date from bookCash's postJournal call; mapping
 * every invoice to 4000; letting a manual entry into a closed month without
 * a reason; letting a source entry be reversed; removing the `in snap` skip.
 *
 *   node tests/accounting-v2.mjs
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
const mig = read("worker/migrations/0148_journal_integrity.sql");
ok("0148 only adds indexes - nothing rewritten, nothing dropped", !/\b(UPDATE|DELETE|DROP|ALTER|INSERT)\b/i.test(mig.replace(/^--.*$/gm, "")) && /CREATE UNIQUE INDEX IF NOT EXISTS idx_journal_ref_once ON journal_entries \(ref\) WHERE ref != '' AND created_at >= '2026-10-29';/.test(mig));
ok("0148 is registered and probed", /"0148_journal_integrity",/.test(read("worker/src/index.ts")) && /\["0148 \(accounting 2\.0/.test(read("worker/src/index.ts")));
const ledger = read("worker/src/ledger.ts");
ok("the ledger module only reads", !/\b(INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM)\b/i.test(ledger));
{
  const tables = readdirSync(join(root, "worker/migrations")).flatMap((f) => [...read(`worker/migrations/${f}`).matchAll(/CREATE TABLE (?:IF NOT EXISTS )?([a-z_]+)/gi)].map((m) => m[1].toLowerCase()));
  const books = tables.filter((t) => /journal|general_ledger|^gl_|ledger_entries/.test(t));
  ok("one ledger: no second journal or ledger table in any migration", books.every((t) => ["journal_entries", "journal_lines", "gl_accounts"].includes(t)), books.join(", "));
}

/* ---- runtime ---- */
const dir = mkdtempSync(join(tmpdir(), "accounting-"));
const out = join(dir, "staff.mjs");
execSync(`npx esbuild "${join(root, "worker/src/staff.ts")}" --bundle --format=esm --platform=neutral --outfile="${out}" --log-level=error`, { cwd: root, stdio: "inherit" });
const db = new DatabaseSync(":memory:");
for (const f of readdirSync(join(root, "worker/migrations")).filter((x) => x.endsWith(".sql")).sort()) {
  for (const st of readFileSync(join(root, "worker/migrations", f), "utf8").split(/;\s*\n/)) { try { db.exec(st); } catch { /* a statement SQLite reads differently */ } }
}
let failLines = 0;
const shim = (sql) => {
  const st = db.prepare(sql); let b = [];
  const o = {
    bind: (...a) => { b = a.map((x) => (x === undefined ? null : x)); return o; },
    first: async () => st.get(...b) ?? null, all: async () => ({ results: st.all(...b) }),
    run: async () => ({ meta: { changes: Number(st.run(...b).changes) } }),
    _run: () => { if (failLines && /INSERT INTO journal_lines/.test(sql)) { failLines--; throw new Error("injected line failure"); } return st.run(...b); },
  };
  return o;
};
const env = { DB: { prepare: shim, batch: async (list) => { db.exec("BEGIN"); try { for (const s of list) s._run(); db.exec("COMMIT"); } catch (e) { db.exec("ROLLBACK"); throw e; } return []; } } };
db.exec(`INSERT INTO users (id, name, email, role, is_active, password_hash) VALUES (1,'Boss','b@x.t','ceo',1,'x'),(2,'Ops','o@x.t','coo',1,'x'),(3,'Com','c@x.t','cco',1,'x'),(4,'Ani','a@x.t','sales_marketing',1,'x'),(5,'Adm','d@x.t','admin',1,'x'),(6,'Hr','h@x.t','hr_admin',1,'x'),(7,'Sup','s@x.t','super_admin',1,'x')`);
db.exec(`INSERT INTO customers (id, company, created_by) VALUES (1,'Kedai Satu',1)`);
const ins = db.prepare(`INSERT INTO sales_documents (id, doc_type, doc_number, customer_id, items, total_cents, payment_status, created_at, created_by, kind) VALUES (?,?,?,1,'[]',?,?,?,1,?)`);
ins.run(10, "INV", "INV-10", 500000, "unpaid", "2026-09-01 02:00:00", "service");
ins.run(11, "INV", "INV-11", 200000, "unpaid", "2026-09-02 02:00:00", "product");
ins.run(12, "INV", "INV-12", 300000, "unpaid", "2026-09-03 02:00:00", "product");

const { handleStaff } = await import(pathToFileURL(out).href);
const RealDate = Date; const fixed = new RealDate("2026-09-18T02:00:00Z").getTime();
globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [fixed])); } static now() { return fixed; } };
const ROLE = { 1: "ceo", 2: "coo", 3: "cco", 4: "sales_marketing", 5: "admin", 6: "hr_admin", 7: "super_admin" };
const call = async (p, id = 1, method = "GET", body) => {
  const r = await handleStaff(new Request(`https://x/api/v1/staff${p}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }), env, p.split("?")[0], { id, role: ROLE[id], name: "x" });
  return { status: r.status, j: await r.json().catch(() => null) };
};
const count = (t) => db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
const entry = (ref) => db.prepare(`SELECT * FROM journal_entries WHERE ref = ?`).get(ref);
const linesOf = (id) => db.prepare(`SELECT l.*, a.code FROM journal_lines l JOIN gl_accounts a ON a.id = l.account_id WHERE entry_id = ? ORDER BY l.id`).all(id);

try {
  /* 1. posting: dated the day the money moved, service to 4100, product to 4000 */
  await call("/docs/10", 1, "PATCH", { payment_status: "paid", paid_on: "2026-08-20", payment_ref: "TT-10" });
  await call("/docs/11", 1, "PATCH", { payment_status: "paid", paid_on: "2026-09-05", payment_ref: "TT-11" });
  const e10 = entry("INV-10"), e11 = entry("INV-11");
  ok("a paid invoice's journal is dated the day its money landed", e10?.entry_date === "2026-08-20" && e11?.entry_date === "2026-09-05", `${e10?.entry_date}/${e11?.entry_date}`);
  ok("a service invoice books to 4100, a product invoice to 4000", linesOf(e10.id).some((l) => l.code === "4100" && l.credit_cents === 500000) && linesOf(e11.id).some((l) => l.code === "4000" && l.credit_cents === 200000) && linesOf(e10.id).some((l) => l.code === "1100" && l.debit_cents === 500000));
  ok("the cash book keeps its category", db.prepare(`SELECT category FROM cashflow_entries WHERE ref = 'INV-10'`).get()?.category === "sales");
  await call("/docs/10", 1, "PATCH", { payment_status: "paid", paid_on: "2026-08-20", payment_ref: "TT-10" });
  ok("a repeated Mark paid books one entry", db.prepare(`SELECT COUNT(*) AS n FROM journal_entries WHERE ref LIKE 'INV-10%'`).get().n === 1);

  /* 2. all or nothing: a line that fails leaves no half entry */
  const before = count("journal_entries");
  failLines = 1;
  await call("/docs/12", 1, "PATCH", { payment_status: "paid", paid_on: "2026-09-06" });
  ok("a failed line leaves no entry behind", count("journal_entries") === before && !entry("INV-12"), String(count("journal_entries") - before));
  ok("...the payment and its cash row still stand", db.prepare(`SELECT COUNT(*) AS n FROM cashflow_entries WHERE ref = 'INV-12'`).get().n === 1 && db.prepare(`SELECT payment_status FROM sales_documents WHERE id = 12`).get().payment_status === "paid");

  /* 3. the unique reference (0148) covers new entries only */
  db.exec(`INSERT INTO journal_entries (entry_date, memo, ref, created_by, created_at) VALUES ('2026-01-01','old','OLD-1',1,'2026-01-01 00:00:00'),('2026-01-01','old twin','OLD-1',1,'2026-01-01 00:00:00')`);
  let dupBlocked = false;
  try { db.exec(`INSERT INTO journal_entries (entry_date, memo, ref, created_by, created_at) VALUES ('2026-11-01','a','NEW-1',1,'2026-11-01 00:00:00'),('2026-11-01','b','NEW-1',1,'2026-11-01 00:00:00')`); } catch { dupBlocked = true; }
  ok("from 29-10-2026 a reference is posted once; older history is left as it is", dupBlocked && db.prepare(`SELECT COUNT(*) AS n FROM journal_entries WHERE ref = 'OLD-1'`).get().n === 2 && !entry("NEW-1"));

  /* 4. manual entries: own reference, balanced only */
  const acct = (code) => db.prepare(`SELECT id FROM gl_accounts WHERE code = ?`).get(code).id;
  const manual = (body, id = 1) => call("/erp/gl/journal", id, "POST", body);
  ok("an unbalanced manual entry is refused", (await manual({ entry_date: "2026-09-10", memo: "x", lines: [{ account_id: acct("1100"), debit: 100 }, { account_id: acct("6000"), credit: 90 }] })).status === 400);
  const m1 = await manual({ entry_date: "2026-09-10", memo: "Ads refund banked", lines: [{ account_id: acct("1100"), debit: 250 }, { account_id: acct("6000"), credit: 250 }] });
  const m1e = db.prepare(`SELECT * FROM journal_entries WHERE id = ?`).get(m1.j?.id);
  ok("a manual entry posts with its own MJ- reference and both lines", m1.status === 201 && /^MJ-[0-9a-f]{8}$/.test(m1e?.ref ?? "") && linesOf(m1e.id).length === 2, JSON.stringify(m1.j));
  failLines = 1;
  const nBefore = count("journal_entries");
  const m2 = await manual({ entry_date: "2026-09-11", memo: "half", lines: [{ account_id: acct("1100"), debit: 10 }, { account_id: acct("6900"), credit: 10 }] });
  ok("a manual entry whose line fails is not written at all", m2.status >= 500 && count("journal_entries") === nBefore, String(m2.status));
  failLines = 0;

  /* 5. soft control: a closed month asks why, never refuses for being late */
  const close = await call("/books/close", 1, "POST", { month: "2026-08" });
  ok("August closes", close.status === 201, JSON.stringify(close.j));
  const snap = JSON.parse(db.prepare(`SELECT figures FROM period_closes WHERE month = '2026-08'`).get().figures);
  ok("the close snapshots the ledger: income, expense, entries", snap.gl_income_cents === 500000 && "gl_expense_cents" in snap && snap.gl_entries >= 1, JSON.stringify(snap));
  const late = await manual({ entry_date: "2026-08-25", memo: "Canva August", lines: [{ account_id: acct("6900"), debit: 549 }, { account_id: acct("1100"), credit: 549 }] });
  ok("an entry dated in a closed month asks for a reason", late.status === 409 && late.j?.error?.code === "closed_period", JSON.stringify(late.j));
  const late2 = await manual({ entry_date: "2026-08-25", memo: "Canva August", post_close_reason: "Card statement line 7 belongs to August", lines: [{ account_id: acct("6900"), debit: 549 }, { account_id: acct("1100"), credit: 549 }] });
  ok("...and posts with one", late2.status === 201);
  const auditRow = db.prepare(`SELECT detail FROM audit_log WHERE action = 'erp.journal_create' AND entity_id = ?`).get(String(late2.j?.id));
  ok("the reason is kept in the audit", /Card statement line 7/.test(auditRow?.detail ?? ""));
  const me = (await call("/erp/gl/month-end?month=2026-08")).j;
  ok("month-end lists it as a post-close adjustment, with its reason", me?.close && me.adjustments.some((a) => a.id === late2.j.id && a.reason === "Card statement line 7 belongs to August"), JSON.stringify(me?.adjustments));
  const months = (await call("/books/months")).j;
  const aug = months?.months?.find((m) => m.month === "2026-08");
  ok("the month shows the ledger change since close", aug?.changed_since_close && aug.changed_since_close.gl_expense_cents === 54900, JSON.stringify(aug?.changed_since_close));
  /* a close taken before the ledger joined the snapshot is not "changed" by the new keys */
  db.exec(`INSERT INTO period_closes (month, figures, closed_by) VALUES ('2026-07', '{"invoiced_cents":0,"received_cents":0,"part_payments_cents":0,"expenses_cents":0,"stock_received_cents":0,"payroll_net_cents":0,"documents":0}', 1)`);
  const jul = (await call("/books/months")).j?.months?.find((m) => m.month === "2026-07");
  ok("an older close does not report the new ledger figures as changes", jul?.closed && Object.keys(jul.changed_since_close ?? {}).every((k) => !k.startsWith("gl_")), JSON.stringify(jul?.changed_since_close));

  /* 6. reversal: manual only, once, with a reason */
  ok("a reversal needs a reason", (await call(`/erp/gl/journal/${m1.j.id}/reverse`, 1, "POST", { reason: "no" })).status === 400);
  const rv = await call(`/erp/gl/journal/${m1.j.id}/reverse`, 1, "POST", { reason: "Refund was for the other company" });
  const rve = entry(`REVJ-${m1.j.id}`);
  ok("a manual entry is reversed by a mirror", rv.status === 201 && rve && linesOf(rve.id).every((l, i) => l.debit_cents === linesOf(m1.j.id)[i].credit_cents && l.credit_cents === linesOf(m1.j.id)[i].debit_cents));
  ok("...the original is untouched", linesOf(m1.j.id).length === 2 && db.prepare(`SELECT memo FROM journal_entries WHERE id = ?`).get(m1.j.id).memo === "Ads refund banked");
  ok("...once", (await call(`/erp/gl/journal/${m1.j.id}/reverse`, 1, "POST", { reason: "Refund was for the other company" })).status === 409);
  ok("an entry booked by its source is reversed at the source, not here", (await call(`/erp/gl/journal/${e10.id}/reverse`, 1, "POST", { reason: "Trying from accounting" })).j?.error?.code === "source_entry");
  ok("a reversal is not reversed again", (await call(`/erp/gl/journal/${rve.id}/reverse`, 1, "POST", { reason: "Undo the undo please" })).j?.error?.code === "is_reversal");

  /* 7. who may */
  for (const id of [2, 3, 4, 6]) {
    const g = await call("/erp/gl/overview", id);
    const r = await call(`/erp/gl/journal/${m1.j.id}/reverse`, id, "POST", { reason: "Not my place to do this" });
    ok(`${ROLE[id]}: no ledger reads, no reversal`, g.status === 403 && r.status === 403 && (await call("/erp/gl/month-end?month=2026-08", id)).status === 403);
  }
  ok("admin and super admin read the ledger", (await call("/erp/gl/overview", 5)).status === 200 && (await call("/erp/gl/overview", 7)).status === 200);

  /* 8. the reads: by the day the money moved, every planted exception found */
  /* a back-filled history: booked 18 Sep, money moved 10 July */
  db.exec(`INSERT INTO cashflow_entries (entry_date, type, category, amount_cents, description, ref, created_by, effective_date, source_key) VALUES ('2026-09-18','out','marketing',7000,'Meta ads July','EXP-77',1,'2026-07-10','EXP-77')`);
  db.exec(`INSERT INTO journal_entries (entry_date, memo, ref, created_by) VALUES ('2026-09-18','Meta ads July','EXP-77',1)`);
  const j77 = entry("EXP-77").id;
  db.exec(`INSERT INTO journal_lines (entry_id, account_id, debit_cents, credit_cents) VALUES (${j77}, ${acct("6000")}, 7000, 0), (${j77}, ${acct("1100")}, 0, 7000)`);
  /* a half-written entry from before (one line) */
  db.exec(`INSERT INTO journal_entries (entry_date, memo, ref, created_by) VALUES ('2026-09-12','half','CF-900',1)`);
  db.exec(`INSERT INTO journal_lines (entry_id, account_id, debit_cents, credit_cents) VALUES (${entry("CF-900").id}, ${acct("1100")}, 1200, 0)`);
  /* payroll paid, then changed */
  db.exec(`INSERT INTO payroll_entries (user_id, month, basic_cents, net_cents) VALUES (4, '2026-08', 300000, 300000)`);
  await call("/payroll/paid", 1, "POST", { month: "2026-08" });
  db.exec(`UPDATE payroll_entries SET net_cents = 310000 WHERE user_id = 4 AND month = '2026-08'`);
  /* a part payment on an unpaid invoice */
  ins.run(14, "INV", "INV-14", 400000, "unpaid", "2026-09-04 02:00:00", "product");
  db.exec(`INSERT INTO invoice_payments (invoice_id, amount_cents, received_on, reference, created_by) VALUES (14,150000,'2026-09-09','TT-14',1)`);

  const counts = () => [count("journal_entries"), count("journal_lines"), count("cashflow_entries"), count("audit_log")].join("/");
  const c0 = counts();
  const ov = (await call("/erp/gl/overview?from=2026-09-01&to=2026-09-30")).j;
  ok("overview: cash basis, and the trial balance reads out of balance because of the half entry", ov?.basis === "cash" && ov.trial.balanced === false && ov.trial.difference_cents === 1200, JSON.stringify(ov?.trial));
  ok("overview: the half-written entry is found", ov.exceptions.unbalanced.some((u) => u.ref === "CF-900" && u.lines === 1));
  ok("overview: the twin history reference is found", ov.exceptions.duplicates.some((d) => d.ref === "OLD-1"));
  ok("overview: the movement whose journal failed is 'not in the books'", ov.exceptions.unjournaled.some((u) => u.ref === "INV-12" && u.amount_cents === 300000), JSON.stringify(ov.exceptions.unjournaled));
  ok("overview: payroll changed after its bank run is found", ov.exceptions.payroll_drift.some((p) => p.month === "2026-08" && p.booked_cents === 300000 && p.payroll_cents === 310000), JSON.stringify(ov.exceptions.payroll_drift));
  ok("overview: part payments outside the books are counted, not posted", ov.exceptions.part_payments.count === 1 && ov.exceptions.part_payments.cents === 150000 && !entry("INV-14"));
  ok("overview: September money in is the product invoice only (the service one moved in August)", ov.money.in_cents === 200000, JSON.stringify(ov.money));
  ok("overview: six months of trend, the history on its own month (July)", ov.trend.length === 6 && ov.trend.find((t) => t.month === "2026-07")?.out_cents === 7000, JSON.stringify(ov.trend));
  ok("reading writes nothing", counts() === c0, `${c0} -> ${counts()}`);

  const tbJul = (await call("/erp/gl/trial-balance?as_of=2026-07-31")).j;
  ok("trial balance as at a date reads the day money moved", tbJul?.accounts.find((a) => a.code === "6000")?.debit_cents === 7000 && tbJul.balanced === true, JSON.stringify(tbJul?.accounts?.filter((a) => a.debit_cents || a.credit_cents)));
  const tbAll = (await call("/erp/gl/trial-balance")).j;
  ok("the plain trial balance is unchanged (all time, active accounts)", Array.isArray(tbAll?.accounts) && !("as_of" in tbAll));

  const pnl = (await call("/erp/gl/pnl?from=2026-08-01&to=2026-08-31")).j;
  ok("P&L: August income is the service invoice on 4100, net = income - expense", pnl?.income.some((r) => r.code === "4100" && r.cents === 500000) && pnl.totals.net_cents === pnl.totals.income_cents - pnl.totals.expense_cents, JSON.stringify(pnl?.totals));
  ok("P&L: compared with the whole month before", pnl.previous.from === "2026-07-01" && pnl.previous.to === "2026-07-31" && pnl.expense.find((r) => r.code === "6000")?.prev_cents === 7000, JSON.stringify(pnl.previous));
  const led = (await call(`/erp/gl/ledger?account_id=${acct("1100")}&from=2026-09-01&to=2026-09-30`)).j;
  /* before September on 1100: INV-10 +5,000.00 (20 Aug), EXP-77 -70.00 (10 Jul), the late manual entry -549.00 (25 Aug); the payroll run is dated the day it was marked paid */
  ok("ledger: opening carries what came before, the running balance ends at the closing", led?.opening_cents === 500000 - 7000 - 54900 && led.lines.at(-1)?.balance_cents === led.closing_cents, `${led?.opening_cents} / ${led?.closing_cents}`);
  const jl = (await call("/erp/gl/journal?source=manual&page=0")).j;
  ok("journal list filters by source", jl?.entries.length >= 2 && jl.entries.every((e) => e.source === "manual") && jl.entries.some((e) => e.id === m1.j.id && e.reversed_by === rve.id));
  const one = (await call(`/erp/gl/journal/${e10.id}`)).j;
  ok("an entry shows its source: the invoice, not yet confirmed", one?.detail?.document === "INV-10" && one.detail.confirmed_on === null && one.tab === "Sales" && one.manual === false && one.entry.eff === "2026-08-20");
  const me9 = (await call("/erp/gl/month-end?month=2026-09")).j;
  const chk = (k) => me9?.checks.find((c) => c.key === k);
  ok("month-end: six checks; not ready while an entry is half-written", me9?.checks.length === 6 && me9.ready === false && chk("posting").ok === false && chk("posting").detail.unjournaled === 1, JSON.stringify(me9?.checks));
  ok("month-end: Finance's own reconciliation list is read, not copied", chk("reconciliation").detail.readable === true && chk("reconciliation").detail.by_kind.unverified >= 1, JSON.stringify(chk("reconciliation")));
  ok("month-end: part payments and company ownership are reported", chk("part_payments").detail.count === 1 && typeof chk("ownership").detail.unassigned === "number");
  ok("reading month-end writes nothing", counts() === c0);
  /* July now has ledger lines (EXP-77); its pre-ledger close still reports no ledger "change" */
  const jul2 = (await call("/books/months")).j?.months?.find((m) => m.month === "2026-07");
  ok("...even once that month has ledger lines", jul2?.closed && Object.keys(jul2.changed_since_close ?? {}).every((k) => !k.startsWith("gl_")), JSON.stringify(jul2?.changed_since_close));
} catch (e) {
  failed++;
  console.log(`  ✗ runtime: ${e?.stack ?? e}`);
}

console.log(failed ? `\naccounting-v2: ${failed} failed, ${passed} passed.` : `Accounting 2.0: ${passed} checks passed - atomic, dated, once-only posting; soft month-end control; manual reversal; read-only ledger views.`);
process.exit(failed ? 1 : 0);
