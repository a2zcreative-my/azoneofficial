#!/usr/bin/env node
/* Guard - v1.219.0: FINANCE & CASH FLOW 2.0. ONE AUTHORITATIVE RECORD,
 * ACCURATE CASH FLOW, VERIFIED PAYMENTS, CONTROLLED ACCESS, ZERO DOUBLE
 * COUNTING, FULL AUDIT TRAIL.
 *
 * The owner's answers to the Finance audit (claude/FINANCE-AUDIT.md,
 * 28-10-2026): "Same as Sales", "Show true dates, flag issues", "Approve
 * 0147", "Own Expenses tab". This guard RUNS the worker against SQLite with
 * every migration and holds:
 *
 *   1. ONE BOOKING PER EVENT. A doubled "Mark paid", a race between two
 *      requests and a backfill re-run book one row; a payment that is undone
 *      is REVERSED (a row the other way, with the reason, and the journal
 *      mirrored) - never deleted - and paying again books afresh. A deleted
 *      invoice leaves no live row, so a later invoice reusing its id still
 *      books (F12). Cash rows cannot be deleted.
 *   2. MONEY IN BY THE SALES RULE. Each part payment counts on the day it
 *      landed, the rest of a paid invoice on its paid day; the INV- rows in
 *      the book are not counted again.
 *   3. TRUE DATES. A row is shown on the day its money moved (its own date,
 *      else its source's paid day), never rewritten.
 *   4. TRANSFERS AND BALANCES. A transfer is neither money in nor money out;
 *      a book balance exists only from an opening balance a person entered.
 *   5. RECONCILIATION from the records: unverified receipts, no account, no
 *      reference, out of step, possible duplicates, not booked - each one
 *      reviewable once, with a note.
 *   6. ACCESS. Reading is cashflow_manage, unchanged; corrections are the
 *      CEO, the COO and super admin; the CCO, HR and sales are refused.
 *   7. NO COMMISSION CASH ROW. Commission is paid inside the payroll run's
 *      net, so nothing books it separately.
 *   8. THE SCREEN. Five tabs on one read; Expenses unchanged inside it; the
 *      figures never say "balance" for a period's movement.
 *
 * Negative-tested by: the old check-then-insert booking (1); deleting the
 * row on "Undo paid" (1); counting INV- rows next to the invoices (2);
 * dating by entry_date only (3); counting a transfer as money in (4);
 * a balance without an opening (4); cashbook_correct given to the CCO (6);
 * a "Balance" tile (8).
 */
import { readFileSync, readdirSync, mkdtempSync } from "node:fs";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");
let failed = 0, passed = 0;
const ok = (label, cond, why = "") => { if (cond) passed++; else { failed++; console.log(`  ✗ ${label}${why ? ` — ${why}` : ""}`); } };
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

const cb = strip(read("worker/src/cashbook.ts"));
const staff = strip(read("worker/src/staff.ts"));
const erp = strip(read("worker/src/erp.ts"));
const perms = read("worker/src/permissions.ts");
const mig = read("worker/migrations/0147_cashbook.sql");

/* ---- static: the contract ---- */
ok("0147 only adds: columns, indexes, one table - no UPDATE, DELETE or DROP",
   !/\b(UPDATE|DELETE|DROP)\b/.test(mig.replace(/^--.*$/gm, "")) && /ALTER TABLE cashflow_entries ADD COLUMN source_key TEXT;/.test(mig)
   && /CREATE UNIQUE INDEX IF NOT EXISTS idx_cashflow_source_key\s+ON cashflow_entries \(source_key\) WHERE source_key IS NOT NULL;/.test(mig)
   && /CREATE UNIQUE INDEX IF NOT EXISTS idx_cashflow_one_reversal\s+ON cashflow_entries \(reversal_of\) WHERE reversal_of IS NOT NULL;/.test(mig));
ok("0147 is registered and probed", /const LATEST_MIGRATION = "0147_cashbook";/.test(read("worker/src/index.ts")) && /"0147_cashbook",/.test(read("worker/src/index.ts")) && /\["0147 \(finance 2\.0/.test(read("worker/src/index.ts")));
ok("corrections are the CEO, the COO and super admin - narrower than cashflow_manage",
   /cashbook_correct: \["super_admin", "ceo", "coo"\],/.test(perms) && /cashflow_manage: \["super_admin", "admin", "ceo", "coo"\],/.test(perms));
ok("one booking path: every module books through bookCash, in one statement",
   /await bookCash\(env, userId, ref, amountCents, category, description, direction, effectiveDate\);/.test(staff)
   && /if \(await bookCash\(env, user\.id, ref, amountCents, category, description, direction, day\)\) created\+\+;/.test(erp)
   && /SELECT date\('now', '\+8 hours'\), \?6, \?1, \?2, \?3, \?4, \?5, COALESCE\(\?7, date\('now', '\+8 hours'\)\), \?8\s+WHERE NOT EXISTS/.test(cb)
   && !/SELECT id FROM cashflow_entries WHERE ref = \?1 LIMIT 1/.test(staff + erp));
ok("cash rows are never deleted - reversed instead", !/DELETE FROM cashflow_entries/.test(staff + erp + cb) && /return err\("reverse_instead"/.test(erp));
ok("undo paths reverse: expense unpaid and deleted, invoice unpaid, deleted and un-converted",
   /reverseLive\(env, user\.id, `EXP-\$\{exPaid\[1\]\}`, "Expense marked unpaid"\)/.test(staff) && /reverseLive\(env, user\.id, `EXP-\$\{exMatch\[1\]\}`, "Expense deleted"\)/.test(staff)
   && /reverseLive\(env, user\.id, `INV-\$\{id\}`, `Invoice marked/.test(staff) && /reverseLive\(env, user\.id, `INV-\$\{dd\.id\}`, "Invoice deleted"\)/.test(staff)
   && /reverseLive\(env, user\.id, `INV-\$\{inv\.id\}`, "Invoice reversed back to its quotation"\)/.test(staff));
ok("nothing books commission as its own cash movement", !/["`]COMM-/.test(staff + erp + cb + strip(read("worker/src/business.ts"))));
ok("the view only reads", !/\b(INSERT|UPDATE|DELETE)\b/.test(cb.slice(cb.indexOf("async function loadAll"), cb.indexOf("export async function handleCashbook"))));

/* ---- runtime ---- */
try {
  const dir = mkdtempSync(join(tmpdir(), "cashflow-"));
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
  db.exec(`INSERT INTO users (id, name, email, role, is_active, password_hash) VALUES (1,'Boss','b@x.t','ceo',1,'x'),(2,'Ops','o@x.t','coo',1,'x'),(3,'Com','c@x.t','cco',1,'x'),(4,'Ani','a@x.t','sales_marketing',1,'x'),(5,'Adm','d@x.t','admin',1,'x'),(6,'Hr','h@x.t','hr_admin',1,'x')`);
  db.exec(`INSERT INTO customers (id, company, created_by) VALUES (1,'Kedai Satu',1)`);
  const ins = db.prepare(`INSERT INTO sales_documents (id, doc_type, doc_number, customer_id, items, total_cents, payment_status, created_at, created_by) VALUES (?,?,?,1,'[]',?,?,?,1)`);
  ins.run(10, "INV", "INV-10", 1000000, "unpaid", "2026-09-01 02:00:00");
  ins.run(11, "INV", "INV-11", 500000, "unpaid", "2026-08-10 02:00:00");
  ins.run(12, "INV", "INV-12", 400000, "unpaid", "2026-09-02 02:00:00");
  db.exec(`INSERT INTO invoice_payments (invoice_id, amount_cents, received_on, reference, created_by) VALUES (11,200000,'2026-08-20','TT-1',1),(12,100000,'2026-09-12','',1)`);
  db.exec(`INSERT INTO bank_accounts (id, name, bank, number_masked) VALUES (1,'Operating','Maybank','1234'),(2,'Savings','CIMB','9876')`);

  const { handleStaff } = await import(pathToFileURL(out).href);
  const RealDate = Date; const fixed = new RealDate("2026-09-18T02:00:00Z").getTime();
  globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [fixed])); } static now() { return fixed; } };
  const ROLE = { 1: "ceo", 2: "coo", 3: "cco", 4: "sales_marketing", 5: "admin", 6: "hr_admin" };
  const call = async (p, id = 1, method = "GET", body) => {
    const r = await handleStaff(new Request(`https://x/api/v1/staff${p}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }), env, p.split("?")[0], { id, role: ROLE[id], name: "x" });
    return { status: r.status, j: await r.json().catch(() => null) };
  };
  const rows = (ref) => db.prepare(`SELECT * FROM cashflow_entries WHERE ref = ? OR ref LIKE ? ORDER BY id`).all(ref, `${ref}#%`);
  /* SQLite's own 'now' (a booking's date) is the real clock, not the test's:
     the period runs from 1 September to whichever is later */
  const END = [db.prepare(`SELECT date('now', '+8 hours') AS d`).get().d, "2026-09-30"].sort()[1];
  const view = async (q = `?from=2026-09-01&to=${END}`, id = 1) => (await call(`/erp/cashbook${q}`, id)).j;

  /* 1. one booking per event */
  await call("/docs/10", 1, "PATCH", { payment_status: "paid", paid_on: "2026-09-05", payment_ref: "TT-10" });
  await call("/docs/10", 1, "PATCH", { payment_status: "paid", paid_on: "2026-09-05", payment_ref: "TT-10" });
  ok("a doubled Mark paid books one row, dated the day the money landed", rows("INV-10").length === 1 && rows("INV-10")[0].effective_date === "2026-09-05", JSON.stringify(rows("INV-10")));
  await call("/docs/11", 1, "PATCH", { payment_status: "paid", paid_on: "2026-09-10", payment_ref: "" });
  db.exec(`INSERT INTO expenses (id, expense_date, category, amount_cents, vendor, created_by) VALUES (1,'2026-09-03','software',30000,'Canva',1)`);
  await Promise.all([call("/expenses/1/paid", 1, "POST", {}), call("/expenses/1/paid", 2, "POST", {})]);
  ok("two requests at once book one row", rows("EXP-1").length === 1, String(rows("EXP-1").length));
  await call("/expenses/1/paid", 1, "POST", { paid: false });
  const afterUndo = db.prepare(`SELECT * FROM cashflow_entries WHERE reversal_of = ?`).all(rows("EXP-1")[0].id);
  ok("Undo paid reverses the row with the reason, the original stays", afterUndo.length === 1 && afterUndo[0].type === "in" && afterUndo[0].reverse_reason === "Expense marked unpaid" && rows("EXP-1").length === 1);
  await call("/expenses/1/paid", 1, "POST", {});
  ok("...and paying again books afresh under a new key", rows("EXP-1").length === 2 && rows("EXP-1")[1].source_key === "EXP-1#2", JSON.stringify(rows("EXP-1").map((r) => r.source_key)));
  const bf1 = (await call("/erp/cashflow/backfill", 1, "POST", {})).j;
  const bf2 = (await call("/erp/cashflow/backfill", 1, "POST", {})).j;
  ok("a backfill re-run books nothing twice", bf2?.created === 0 && rows("EXP-1").length === 2 && rows("INV-10").length === 1, `${bf1?.created}/${bf2?.created}`);
  ok("cash rows cannot be deleted", (await call(`/erp/cashflow/${rows("EXP-1")[0].id}`, 1, "DELETE")).status === 409);
  const jr = db.prepare(`SELECT e.ref, l.debit_cents, l.credit_cents FROM journal_entries e JOIN journal_lines l ON l.entry_id = e.id`).all();
  const jSum = jr.reduce((a, l) => a + l.debit_cents - l.credit_cents, 0);
  ok("the journal mirrors the reversal and stays balanced", jSum === 0 && jr.some((l) => l.ref.startsWith("REV-")) && jr.some((l) => l.ref === "EXP-1#2"), JSON.stringify(jr.map((l) => l.ref)));
  /* the invoice id reuse (F12): paid, unpaid, deleted, the next invoice reuses id 13 */
  ins.run(13, "INV", "INV-13", 70000, "unpaid", "2026-09-15 02:00:00");
  await call("/docs/13", 1, "PATCH", { payment_status: "paid", paid_on: "2026-09-15" });
  await call("/docs/13", 1, "PATCH", { payment_status: "unpaid" });
  ok("an invoice set back to unpaid has its money-in reversed", db.prepare(`SELECT COUNT(*) AS n FROM cashflow_entries WHERE reversal_of = ?`).get(rows("INV-13")[0].id).n === 1);
  await call("/docs/13", 1, "DELETE");
  ins.run(13, "INV", "INV-13B", 90000, "unpaid", "2026-09-16 02:00:00");
  await call("/docs/13", 1, "PATCH", { payment_status: "paid", paid_on: "2026-09-16" });
  ok("a new invoice that reuses a deleted one's id still books", rows("INV-13").some((r) => r.amount_cents === 90000), JSON.stringify(rows("INV-13").map((r) => r.amount_cents)));

  /* 3. true dates: a back-filled claim row booked on the 15th for money paid on 3 August */
  db.exec(`INSERT INTO claims (id, user_id, claim_date, category, amount_cents, status, claim_type, paid_at) VALUES (7, 4, '2026-07-30', 'travel', 4500, 'approved', 'reimbursement', '2026-08-03 03:00:00')`);
  db.exec(`INSERT INTO cashflow_entries (entry_date, type, category, amount_cents, description, ref, created_by) VALUES ('2026-09-15','out','claims',4500,'Staff claim reimbursement','CLM-7',1)`);
  /* a stale money-in row for an invoice that never existed */
  db.exec(`INSERT INTO cashflow_entries (entry_date, type, category, amount_cents, description, ref, created_by) VALUES ('2026-09-14','in','sales',12345,'Invoice INV-99 paid','INV-99',1)`);
  /* a typed movement that repeats the invoice 11 balance */
  await call("/erp/cashflow", 1, "POST", { entry_date: "2026-09-10", type: "in", category: "Client payment", amount: 3000, description: "Kedai Satu transfer" });

  let v = await view();
  const it = (k) => v.items.find((i) => i.key === k);
  ok("money in = parts on their days + the rest of paid invoices on their paid days; INV- rows not counted",
     v.totals.in_cents === 1000000 + 300000 + 100000 + 300000 + 90000, String(v.totals.in_cents));
  ok("the part payment from August is in August, not in September", !v.items.some((i) => i.key.startsWith("PART:") && i.date === "2026-08-20"));
  ok("the invoice 11 balance is its total less its part", it("INV:11")?.amount_cents === 300000 && it("INV:11")?.date === "2026-09-10");
  ok("no INV- book row appears in the view", !v.items.some((i) => i.ref.startsWith("INV-") && i.row_id));
  const aug = await view("?from=2026-08-01&to=2026-08-31");
  ok("a back-filled row sits on the day its money moved", aug.items.some((i) => i.ref === "CLM-7" && i.date === "2026-08-03" && i.booked_on === "2026-09-15"), JSON.stringify(aug.items.map((i) => [i.ref, i.date])));
  ok("...and August has the part payment", aug.totals.in_cents === 200000 && aug.totals.out_cents === 4500, `${aug.totals.in_cents}/${aug.totals.out_cents}`);
  ok("money out nets the expense once (paid, reversed, paid again)", v.totals.out_cents === 30000, String(v.totals.out_cents));
  ok("verified only by a live CEO/COO confirmation", it("INV:10")?.status === "unverified");
  db.exec(`INSERT INTO invoice_paid_confirmations (invoice_id, amount_cents, confirmed_by) VALUES (10, 1000000, 1)`);
  v = await view();
  ok("...a confirmation makes it verified", v.items.find((i) => i.key === "INV:10")?.status === "verified");
  ok("six months of trend ending with the period", v.trend.length === 6 && v.trend[5].month === END.slice(0, 7) && (v.trend.find((t) => t.month === "2026-08")?.in_cents ?? 200000) === 200000, JSON.stringify(v.trend));

  /* 4. transfers and balances */
  ok("no balance without an opening balance", v.banks.every((b) => b.book_balance_cents === null));
  ok("an opening balance: refused for admin and the CCO", (await call("/erp/cashbook/banks/1", 5, "PATCH", { opening_balance: 10000, opening_on: "2026-09-01" })).status === 403
     && (await call("/erp/cashbook/banks/1", 3, "PATCH", { opening_balance: 10000, opening_on: "2026-09-01" })).status === 403);
  ok("...and set by the COO", (await call("/erp/cashbook/banks/1", 2, "PATCH", { opening_balance: 10000, opening_on: "2026-09-01" })).status === 200);
  ok("a transfer needs two different active accounts", (await call("/erp/cashbook/transfer", 1, "POST", { date: "2026-09-11", from_bank_id: 1, to_bank_id: 1, amount: 500 })).status === 400);
  ok("a transfer is recorded", (await call("/erp/cashbook/transfer", 1, "POST", { date: "2026-09-11", from_bank_id: 1, to_bank_id: 2, amount: 500, description: "to savings" })).status === 201);
  ok("assigning an account to a receipt", (await call("/erp/cashbook/assign-bank", 1, "POST", { item_key: "INV:10", bank_id: 1, note: "statement 05-09" })).status === 200);
  ok("...the CCO cannot", (await call("/erp/cashbook/assign-bank", 3, "POST", { item_key: "INV:11", bank_id: 1 })).status === 403);
  v = await view();
  ok("a transfer is neither money in nor money out", v.totals.in_cents === 1790000 && v.totals.out_cents === 30000, `${v.totals.in_cents}/${v.totals.out_cents}`);
  ok("book balance = opening + assigned in - out since the opening day", v.banks.find((b) => b.id === 1)?.book_balance_cents === 1000000 + 1000000 - 50000 && v.banks.find((b) => b.id === 2)?.book_balance_cents === null, JSON.stringify(v.banks));

  /* 5. reconciliation */
  const ex = (k) => v.exceptions.filter((e) => e.kind === k);
  ok("unverified receipts listed (not the confirmed one)", ex("unverified").some((e) => e.key === "INV:11") && !ex("unverified").some((e) => e.key === "INV:10"));
  ok("receipts with no account listed", ex("no_bank").some((e) => e.key === "INV:11") && !ex("no_bank").some((e) => e.key === "INV:10"));
  ok("no payment reference listed", ex("no_reference").some((e) => e.key === "PART:2") && ex("no_reference").some((e) => e.key === "INV:11"));
  ok("an INV- row whose invoice does not exist is out of step", ex("out_of_step").some((e) => /deleted/.test(e.detail) && e.amount_cents === 12345));
  ok("a typed movement matching a booked one is a possible duplicate", ex("duplicate").length === 1 && ex("duplicate")[0].amount_cents === 300000, JSON.stringify(ex("duplicate")));
  const dupKey = ex("duplicate")[0]?.key;
  ok("review needs a note", (await call("/erp/cashbook/review", 1, "POST", { key: `duplicate|${dupKey}`, note: "" })).status === 400);
  ok("reviewed once, it leaves the list", (await call("/erp/cashbook/review", 1, "POST", { key: `duplicate|${dupKey}`, note: "Different payment, checked" })).status === 200 && (await view()).exceptions.every((e) => e.kind !== "duplicate"));
  const manualId = Number(dupKey?.slice(3));
  ok("reverse needs a reason; the CCO cannot", (await call(`/erp/cashbook/rows/${manualId}/reverse`, 1, "POST", { reason: "" })).status === 400 && (await call(`/erp/cashbook/rows/${manualId}/reverse`, 3, "POST", { reason: "dup" })).status === 403);
  ok("reversed once", (await call(`/erp/cashbook/rows/${manualId}/reverse`, 1, "POST", { reason: "Typed twice" })).status === 200 && (await call(`/erp/cashbook/rows/${manualId}/reverse`, 1, "POST", { reason: "again" })).status === 409);
  v = await view();
  ok("...and money in drops by exactly that amount", v.totals.in_cents === 1490000, String(v.totals.in_cents));
  const revRow = v.items.find((i) => i.reversal_of === manualId);
  ok("a reversal cannot itself be reversed", revRow && (await call(`/erp/cashbook/rows/${revRow.row_id}/reverse`, 1, "POST", { reason: "undo the undo" })).status === 409);

  /* 6. access */
  for (const [id, who] of [[3, "the CCO"], [4, "sales"], [6, "HR"]]) ok(`${who} cannot read Finance`, (await call("/erp/cashbook", id)).status === 403);
  const adm = await view(undefined, 5);
  ok("admin reads (cashflow_manage, unchanged) but cannot correct", adm?.can_correct === false && Array.isArray(adm.items));
  globalThis.Date = RealDate;
} catch (e) {
  ok("the cash book runs against SQLite", false, String(e?.stack ?? e).slice(0, 600));
}

/* ---- 8: the screen ---- */
const page = read("app/portal/page.tsx");
const fin = read("components/portal/finance-panels.tsx");
const finCode = strip(fin);
ok("the Finance tab is one page: Overview, Transactions, Expenses, Reconciliation, Reports",
   ['L("Overview", "Gambaran")', 'L("Transactions", "Transaksi")', 'L("Expenses", "Perbelanjaan")', 'L("Reconciliation", "Penyelarasan")', 'L("Reports", "Laporan")'].every((t) => fin.includes(t))
   && /<FinancePage expenses=\{<ExpensesPanel reporting=\{<PnlCard \/>\} \/>\} \/>/.test(page));
ok("one read for every tab, by period", /api<CashbookView>\(`\/cashbook\?from=\$\{period\.from\}&to=\$\{period\.to\}&months=12`\)/.test(finCode));
ok("a period's movement is never called a balance", /L\("Net cash movement", "Pergerakan tunai bersih"\)/.test(fin) && !/L\("Balance", "Baki"\)/.test(fin));
ok("the screen adds up nothing itself: the figures are the server's", !/\.reduce\(\(a, e\) => a \+ e\.amount_cents/.test(finCode) && /view\.totals\.in_cents/.test(finCode));
ok("corrections shown only to those the server allows", /view\.can_correct &&/.test(finCode));
ok("the old Cash Flow panel is gone", !/CashFlowPanel/.test(page) && !/CashFlowPanel/.test(read("components/portal/lazy-panels.tsx")));
ok("the guard is registered", /\["cashflow", "/.test(read("scripts/run-guards.mjs")));

console.log(`  ${passed} check(s) passed.`);
if (failed) { console.log(`\n${failed} check(s) failed.`); process.exit(1); }
