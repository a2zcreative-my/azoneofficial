#!/usr/bin/env node
/* Guard - v1.216.0: ONE SET OF SALES FIGURES, FROM EVERY RECORD. NEW
 * ENQUIRIES REACH SALES. THE WEEK INVENTS NO TARGET.
 *
 * The owner's answers to the Sales growth audit (claude/SALES-GROWTH-AUDIT.md,
 * 28-10-2026): "Whole table + show balance", "Show on Sales, notify", "Pace of
 * monthly target". So this guard holds:
 *
 *   1. THE WHOLE TABLE. GET /docs/summary reads every row with the rules the
 *      screen and /revenue already use (paid by COALESCE(paid_at, created_at)
 *      in Malaysia time; raised by created_at), and it is RUN here against
 *      SQLite with more than 200 documents: an old unpaid invoice is still
 *      outstanding, the balance subtracts part payments that are not voided,
 *      and "cash received" counts a part payment once (on its day) and only
 *      the rest of the invoice on the paid day. GET /docs adds every unpaid
 *      invoice and every invoice paid since last month beyond its 200.
 *   2. READ-ONLY, AND "MINE" IS THE SALESPERSON. The route writes nothing; the
 *      company target is read only by revenue_view roles; a role without
 *      sales/exec_view is refused.
 *   3. NO INVENTED TARGET. The week's pace is the approved monthly target
 *      spread over the month's days; no target set -> null, and the card says
 *      so. Nothing multiplies last month into a goal.
 *   4. THE SCREEN USES IT, AND STILL WORKS WITHOUT IT. The tiles read the
 *      summary first and keep their own sums only as the fallback; Unpaid
 *      shows what is still owed beside what was invoiced; Collected is
 *      unchanged; no commission figure appears.
 *   5. ENQUIRIES. A new one rings the sales consultants and the CEO once,
 *      landing on Sales; the Sales list uses only the enquiry routes that
 *      already existed (GET list, PATCH one); the Enquiries tab stays retired.
 *
 * Negative-tested by: counting voided part payments (1); dropping the GET
 * /docs top-up (1); an INSERT in the summary route (2); the company target
 * read without revenue_view (2); an auto target (3); the tiles reading only
 * the 200 (4); announceEnquiry back to a no-op (5); a POST from the
 * enquiries card (5).
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
const between = (s, a, b) => { const i = s.indexOf(a); return i < 0 ? "" : s.slice(i, s.indexOf(b, i + a.length)); };

const staff = read("worker/src/staff.ts");
const staffCode = strip(staff);
const route = between(staffCode, 'if (path === "/docs/summary" && method === "GET") {', 'if (path === "/docs" && method === "GET") {');
const sales = strip(read("components/portal/sales.tsx"));
const ws = strip(read("components/portal/sales-workspace.tsx"));
const enqCard = strip(read("components/portal/sales-enquiries.tsx"));
const enq = strip(read("worker/src/enquiries.ts"));

/* ---- 1 + 2 + 3: the route, statically ---- */
ok("self-test: the summary route was found", route.length > 3000);
ok("the paid rule is the /revenue rule (COALESCE(paid_at, created_at), Malaysia time)",
   /const PAID_DAY = `date\(COALESCE\(d\.paid_at, d\.created_at\), '\+8 hours'\)`;/.test(route) && /d\.doc_type = 'INV' AND d\.payment_status = 'paid' AND \$\{PAID_DAY\} BETWEEN \?1 AND \?2/.test(route));
ok("part payments count only when not voided", /WHERE p\.invoice_id = \$\{alias\}\.id AND p\.voided_at IS NULL/.test(route) && /WHERE p\.voided_at IS NULL AND p\.received_on BETWEEN \?1 AND \?2/.test(route));
ok("the route only reads", !/\b(INSERT|UPDATE|DELETE)\b/.test(route) && !/audit\(|notify\(/.test(route));
ok("sales or exec_view, as GET /docs", /if \(!can\(user\.role, "sales"\) && !can\(user\.role, "exec_view"\)\) return err\("forbidden"/.test(route));
ok("\"mine\" is the salesperson", /const who = mine \? ` AND d\.salesperson_id = \$\{Number\(user\.id\)\}` : "";/.test(route));
ok("the company target only for revenue_view; yours on \"mine\"",
   /if \(mine\) return \(await one<[^>]+>\(`SELECT target_cents AS t FROM user_sales_targets WHERE user_id = \?1 AND month = \?2`, user\.id, ym\)\)/.test(route)
   && /if \(!can\(user\.role, "revenue_view"\)\) return null;/.test(route));
ok("no target set -> no pace; nothing turns last month into a goal",
   /if \(t == null \|\| t <= 0\) \{ pace = null; break; \}/.test(route) && !/\*\s*1\.1\b|autoTarget/.test(route));
ok("GET /docs tops up the 200 with every unpaid invoice and every invoice paid since last month",
   /WHERE d\.doc_type = 'INV' AND \(COALESCE\(d\.payment_status, ''\) != 'paid'\s*OR date\(COALESCE\(d\.paid_at, d\.created_at\), '\+8 hours'\) >= date\('now', '\+8 hours', 'start of month', '-1 month'\)\)/.test(staffCode)
   && /for \(const r of more\) if \(!have\.has\(r\.id\)\) \(results as unknown\[\]\)\.push\(r\);/.test(staffCode));

/* ---- 1: the route, RUN against SQLite with more than 200 documents ---- */
try {
  const dir = mkdtempSync(join(tmpdir(), "salesfig-"));
  const out = join(dir, "staff.mjs");
  execSync(`npx esbuild "${join(root, "worker/src/staff.ts")}" --bundle --format=esm --platform=neutral --outfile="${out}" --log-level=error`, { cwd: root, stdio: "inherit" });
  const db = new DatabaseSync(":memory:");
  for (const f of readdirSync(join(root, "worker/migrations")).filter((x) => x.endsWith(".sql")).sort()) {
    for (const st of readFileSync(join(root, "worker/migrations", f), "utf8").split(/;\s*\n/)) { try { db.exec(st); } catch { /* a statement SQLite reads differently */ } }
  }
  const shim = (sql) => { const st = db.prepare(sql); let b = []; const o = {
    bind: (...a) => { b = a.map((x) => (x === undefined ? null : x)); return o; },
    first: async () => st.get(...b) ?? null, all: async () => ({ results: st.all(...b) }),
    run: async () => ({ meta: { changes: Number(st.run(...b).changes) } }) }; return o; };
  const env = { DB: { prepare: shim } };
  const D = "2026-09-";
  db.exec(`INSERT INTO users (id, name, email, role, is_active, password_hash) VALUES (1,'Boss','b@x.t','ceo',1,'x'),(2,'Ani','a@x.t','sales_marketing',1,'x')`);
  db.exec(`INSERT INTO customers (id, company, created_by, created_at) VALUES (1,'One',2,'${D}15 02:00:00'),(2,'Two',1,'2026-08-01 02:00:00')`);
  const ins = db.prepare(`INSERT INTO sales_documents (id, doc_type, doc_number, customer_id, items, total_cents, payment_status, created_at, paid_at, salesperson_id, created_by) VALUES (?,?,?,?,'[]',?,?,?,?,?,1)`);
  ins.run(2, "INV", "INV-2", 2, 280000, "paid", `${D}10 02:00:00`, `${D}12 04:00:00`, 2);
  ins.run(3, "INV", "INV-3", 1, 990000, "unpaid", `${D}05 02:00:00`, null, 1);
  ins.run(4, "INV", "INV-4", 2, 120000, "unpaid", "2026-06-20 02:00:00", null, 2);
  for (let i = 0; i < 250; i++) ins.run(100 + i, "QT", `QT-${i}`, 1, 1000, null, `${D}17 03:00:00`, null, 2);
  db.exec(`INSERT INTO invoice_payments (invoice_id, amount_cents, received_on, created_by) VALUES (3,250000,'${D}08',2),(3,150000,'${D}16',2),(3,99900,'${D}17',2)`);
  db.exec(`UPDATE invoice_payments SET voided_at = datetime('now') WHERE amount_cents = 99900`);
  const { handleStaff } = await import(pathToFileURL(out).href);
  const RealDate = Date; const fixed = new RealDate("2026-09-18T02:00:00Z").getTime();
  globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [fixed])); } static now() { return fixed; } };
  const call = async (p, role, id) => { const r = await handleStaff(new Request(`https://x/api/v1/staff${p}`), env, p.split("?")[0], { id, role, name: "x" }); return { status: r.status, j: await r.json() }; };
  const all = (await call("/docs/summary", "ceo", 1)).j;
  ok("past 200 documents an old unpaid invoice is still outstanding, at its balance",
     all.outstanding?.n === 2 && all.outstanding.total_cents === 1110000 && all.outstanding.balance_cents === 710000, JSON.stringify(all.outstanding));
  ok("collected is the paid invoice only; cash received adds the part payments once (voided one left out)",
     all.collected?.cents === 280000 && all.cash_cents === 680000, `${all.collected?.cents} / ${all.cash_cents}`);
  ok("every quotation is counted", all.quotations?.n === 250);
  ok("no target set -> the week has no pace", all.week?.target_pace_cents === null);
  db.exec(`INSERT INTO sales_targets (month, target_cents, set_by) VALUES ('2026-09', 3000000, 1)`);
  ok("...a set target spread over the month's days", (await call("/docs/summary", "ceo", 1)).j.week?.target_pace_cents === 700000);
  const mine = (await call("/docs/summary?scope=mine", "sales_marketing", 2)).j;
  ok("\"mine\" = the salesperson's documents", mine.collected?.cents === 280000 && mine.outstanding?.n === 1 && mine.outstanding.balance_cents === 120000, JSON.stringify(mine.outstanding));
  ok("a role without sales access is refused", (await call("/docs/summary", "live_host", 9)).status === 403);
  const list = (await call("/docs", "ceo", 1)).j.docs ?? [];
  /* v1.244.0 - the list keeps a PAID invoice only while it was paid this
     month or last, by the DATABASE clock (SQLite's date('now'), which the
     Date mock above does not reach). This check expected INV-2 (paid
     12-09-2026) unconditionally, so it went red at midnight on 01-11-2026
     MYT with no code change. It now expects exactly what the rule says on
     the day it runs - INV-2 listed while September is inside the window,
     absent after - and the old unpaid INV-4 always. */
  const windowStart = db.prepare(`SELECT date('now', '+8 hours', 'start of month', '-1 month') AS d`).get().d;
  const inv2Due = "2026-09-12" >= windowStart;
  ok("GET /docs past 200 still carries the old unpaid invoice (and a paid one only inside its window)",
     list.some((d) => d.doc_number === "INV-4") && list.some((d) => d.doc_number === "INV-2") === inv2Due, `window from ${windowStart}`);
  globalThis.Date = RealDate;
} catch (e) {
  ok("the summary route runs against SQLite", false, String(e).slice(0, 300));
}

/* ---- 4: the screen ---- */
ok("the tiles read the summary first, their own sums only as the fallback",
   /const sm = summary && summary\.month === monthKey && summary\.scope === scope \? summary : null;/.test(sales)
   && /value=\{fmtRM\(sm \? sm\.collected\.cents : cents\(paidThisMonth\)\)\}/.test(sales) && /value=\{fmtRM\(sm\.outstanding\.balance_cents\)\}/.test(sales)
   && /\$\{fmtRM\(sm\.outstanding\.total_cents\)\} invoiced/.test(sales));
ok("cash received is its own tile; Collected keeps its rule", /label=\{L\("Cash received", "Wang diterima"\)\} value=\{fmtRM\(sm\.cash_cents\)\}/.test(sales)
   && /const paidThisMonth = sDocs\.filter\(\(d\) => d\.doc_type === "INV" && d\.payment_status === "paid"/.test(sales));
ok("the summary is read for the scope on screen", /api<SalesSummary>\(`\/staff\/docs\/summary\?scope=\$\{want\}`\)/.test(sales));
ok("the week card says when no target is set, and shows no commission",
   /pace === null \? \(/.test(ws) && /No target set for this month/.test(read("components/portal/sales-workspace.tsx")) && !/commission_cents|rate_bp/.test(ws));

/* ---- 5: enquiries ---- */
const ann = between(enq, "export async function announceEnquiry(", "interface EnquiryRow");
ok("a new enquiry rings the sales consultants and the CEO, once, landing on Sales",
   /role IN \('sales_marketing', 'ceo'\)/.test(ann) && /await notify\(env, u\.id, "enquiry",/.test(ann) && /enquiry: "Sales",/.test(staffCode));
const calls = [...enqCard.matchAll(/api(?:<[^>]*>)?\(\s*`([^`]+)`(?:,\s*\{\s*method:\s*"(\w+)")?/g)].map((m) => `${m[2] ?? "GET"} ${m[1]}`);
ok("the Sales enquiries card uses only the routes that already existed", JSON.stringify(calls) === JSON.stringify(["GET /enquiries", "PATCH /enquiries/${e.id}"]), calls.join(" | "));
ok("...and draws nothing for a role the server refuses", /if \(r\.status === 403\) \{ setDenied\(true\); return; \}/.test(enqCard) && /if \(denied\) return null;/.test(enqCard));
ok("the Enquiries tab stays retired", !/"Enquiries"/.test(read("lib/portal-tabs.ts").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")));

ok("the guard is registered", /\["sales-figures", "/.test(read("scripts/run-guards.mjs")));
console.log(`  ${passed} check(s) passed.`);
if (failed) { console.log(`\n${failed} check(s) failed.`); process.exit(1); }
