/* v1.280.0 - THE DASHBOARD'S SALES PERFORMANCE ROUTE (Minimal Executive
 * Workspace decision 2, approved by the CEO 11-11-2026): GET
 * /staff/sales/week/performance - runtime guard, the WHOLE worker bundled
 * against SQLite with every migration applied, by direct request.
 *
 * It must be the company figure by day and nothing else:
 *   - the days of this week add up to the Dashboard's company figure EXACTLY
 *     (/sales/week/dashboard company.basis_cents) - one engine, not two;
 *   - a paid invoice counts on the day its payment landed, an unpaid or void
 *     one never; a returned order never;
 *   - TikTok, other shipments and manual sales count only in a week that
 *     counts every channel (from 10-11-2026); an earlier week stays invoices;
 *   - a day after today with nothing recorded is null, never a zero;
 *   - the change compares with the SAME point of the previous period;
 *   - the target is the week's approved company target, only for the week;
 *   - outstanding is each unpaid invoice's total less its verified payments;
 *   - management only (exec_view): a salesperson, a live host and a customer
 *     are refused by direct request; nothing is written.
 * The clock is fixed at Wednesday 11-11-2026, noon in Malaysia.
 *
 *   node tests/company-performance.mjs        (NOMUT=1 skips the mutations)
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
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const b32 = (s) => { let bits = 0, v = 0; const o = []; for (const ch of s) { v = (v << 5) | B32.indexOf(ch); bits += 5; if (bits >= 8) { o.push((v >>> (bits - 8)) & 255); bits -= 8; } } return Buffer.from(o); };
const totpAt = (ms) => { const c = Math.floor(ms / 30000); const b = Buffer.alloc(8); b.writeUInt32BE(Math.floor(c / 2 ** 32), 0); b.writeUInt32BE(c >>> 0, 4); const h = createHmac("sha1", b32(SECRET)).update(b).digest(); const o = h[h.length - 1] & 15; return String((((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1e6).padStart(6, "0"); };
const sha = (s) => createHash("sha256").update(s).digest("hex");
const day = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);


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
  const env = {
    DB: { prepare: shim, batch: async (list) => { db.exec("BEGIN"); try { for (const s of list) s._run(); db.exec("COMMIT"); } catch (e) { db.exec("ROLLBACK"); throw e; } return []; } },
    SESSION_PEPPER: "pepper", COMPANY_DOMAIN: "a2z.test", ALLOWED_ORIGINS: "https://portal.a2z.test",
    MEDIA: { put: async () => {}, head: async () => null, get: async () => null, list: async () => ({ objects: [] }) },
  };
  /* the clocks agree: the worker's Date and SQLite's datetime('now') are the
     real now, so the current Malaysia week is the same for both */
  const RealDate = globalThis.Date;
  let fixed = RealDate.parse("2026-11-11T04:00:00Z"); // Wednesday noon in Malaysia: a fixed week, so the 10-11-2026 rule is exercised every run
  globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [fixed])); } static now() { return fixed; } };
  const code = () => { fixed += 31000; return totpAt(fixed); };
  const today = "2026-11-11";
  const from = day(today, -((new RealDate(`${today}T00:00:00Z`).getUTCDay() + 6) % 7)); // Monday
  const lastWeek = day(from, -7);
  const U = { ceo: 1, coo: 2, aina: 5, lia: 7, adm: 11, shop: 9 };
  db.exec(`INSERT INTO users (id, name, full_name, email, role, is_active, password_hash, totp_enabled, totp_secret, department, reports_to, employment_status, left_on, joined_on) VALUES
    (1,'Alif','Alif Farhan','alif@a2z.test','ceo',1,'x',1,'${SECRET}','Management',NULL,'permanent',NULL,'2020-01-01'),
    (2,'Ops','Ops Lead','ops@a2z.test','coo',1,'x',1,'${SECRET}','Management',1,'permanent',NULL,'2020-01-01'),
    (5,'Aina','Aina Seller','aina@a2z.test','sales_marketing',1,'x',1,'${SECRET}','Sales',2,'permanent',NULL,'2020-01-01'),
    (7,'Lia','Lia Host','lia@a2z.test','live_host',1,'x',1,'${SECRET}','Live',2,'permanent',NULL,'2020-01-01'),
    (9,'Shop','Shop','shop@gmail.com','customer',1,'x',0,NULL,NULL,NULL,'permanent',NULL,NULL),
    (11,'Tech','Tech','tech@a2z.test','admin',1,'x',1,'${SECRET}',NULL,NULL,'permanent',NULL,'2020-01-01')`);
  db.exec(`INSERT INTO customers (id, company, created_by) VALUES (1,'Kedai Satu',5)`);
  const doc = db.prepare(`INSERT INTO sales_documents (id, doc_type, doc_number, customer_id, items, discount_cents, tax_percent, total_cents, payment_status, paid_at, created_at, created_by, salesperson_id, kind, valid_until) VALUES (?,?,?,1,'[]',0,0,?,?,?,?,5,5,'service',NULL)`);
  doc.run(1, "INV", "INV-1", 300000, "paid", "2026-11-09 02:00:00", "2026-11-01 01:00:00");   // Monday (paid this week, raised last month)
  doc.run(2, "INV", "INV-2", 50000, "paid", "2026-11-11 01:00:00", "2026-11-11 00:30:00");    // Wednesday, today
  doc.run(3, "INV", "INV-3", 900000, "unpaid", null, "2026-11-09 01:00:00");                  // 200,000 verified, 100,000 voided
  doc.run(4, "INV", "INV-4", 150000, "unpaid", null, "2026-11-10 01:00:00");
  doc.run(5, "INV", "INV-5", 500000, "void", null, "2026-11-10 01:00:00");                    // void: never sold, never owed
  doc.run(6, "INV", "INV-6", 70000, "paid", "2026-11-02 03:00:00", "2026-11-02 01:00:00");    // last Monday
  doc.run(7, "INV", "INV-7", 100000, "paid", "2026-10-27 03:00:00", "2026-10-27 01:00:00");   // October
  doc.run(8, "INV", "INV-8", 80000, "paid", "2026-11-12 03:00:00", "2026-11-12 01:00:00");    // dated tomorrow: in the week, as the engine counts it
  db.exec(`INSERT INTO invoice_payments (invoice_id, amount_cents, received_on) VALUES (3, 200000, '2026-11-10')`);
  db.exec(`INSERT INTO invoice_payments (invoice_id, amount_cents, received_on, voided_at) VALUES (3, 100000, '2026-11-10', '2026-11-10 05:00:00')`);
  db.exec(`INSERT INTO postage_records (order_ref, order_amount_cents, status, created_at) VALUES
    ('TT-1', 40000, 'shipped', '2026-11-09 02:00:00'), ('TT-R', 99900, 'returned', '2026-11-09 04:00:00'),
    ('OTH-1', 25000, 'shipped', '2026-11-10 02:00:00'),
    ('TT-L', 60000, 'shipped', '2026-11-03 02:00:00'), ('TT-O', 50000, 'shipped', '2026-10-28 02:00:00')`);
  db.exec(`INSERT INTO manual_sales (item_id, qty, unit_sale_cents, total_cents, created_at, out_date) VALUES (1, 1, 10000, 10000, '2026-11-10 01:00:00', '2026-11-10')`);

  const worker = (await import(pathToFileURL(workerBundle).href + `?v=${Math.random()}`)).default;
  const tok = {};
  for (const id of Object.values(U)) {
    tok[id] = `t-${id}`;
    db.prepare(`INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, datetime('now', '+12 hours'), datetime('now'))`).run(sha(tok[id]), id);
  }
  const call = async (path, uid, method = "GET", body) => {
    const headers = { "content-type": "application/json", origin: "https://portal.a2z.test", cookie: `azone_session=${tok[uid]}; csrf_token=c1`, "x-csrf-token": "c1" };
    const r = await worker.fetch(new Request(`https://api.a2z.test/api/v1${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined }), env);
    const text = await r.text();
    let j = null; try { j = JSON.parse(text); } catch { /* not json */ }
    return { status: r.status, j, text };
  };
  const perf = (uid, period = "week") => call(`/staff/sales/week/performance?period=${period}`, uid);
  const writes = () => db.prepare(`SELECT (SELECT COUNT(*) FROM audit_log) + (SELECT COUNT(*) FROM sales_documents) + (SELECT COUNT(*) FROM invoice_payments) AS n`).get().n;

  try {
    ok((await call("/staff/sales/week/targets", U.ceo, "POST", { scope: "company", target_cents: 1000000, week_from: "2026-11-09", reason: "Weekly push approved by the CEO" })).status === 201, "the CEO sets this week's company target");
    const before = writes();
    const w = await perf(U.ceo);
    ok(w.status === 200, "the CEO reads the week", w.text.slice(0, 200));
    const b = w.j?.buckets ?? [];
    ok(w.j?.from === "2026-11-09" && w.j.to === "2026-11-15" && b.length === 7 && b.map((x) => x.label).join() === "Mon,Tue,Wed,Thu,Fri,Sat,Sun", "the week is Monday to Sunday, one bar a day", JSON.stringify(b.map((x) => x.label)));
    ok(b[0]?.cents === 340000, "Monday: the paid invoice on the day its payment landed + the TikTok order; the returned order never", JSON.stringify(b[0]));
    ok(b[1]?.cents === 35000, "Tuesday: another shipment + a manual sale on its out date; the unpaid and the void invoices never", JSON.stringify(b[1]));
    ok(b[2]?.cents === 50000, "Wednesday (today): the payment that landed today", JSON.stringify(b[2]));
    ok(b[3]?.cents === 80000, "Thursday: a payment dated tomorrow is shown on its day, as the week's figure counts it", JSON.stringify(b[3]));
    ok(b.slice(4).every((x) => x.cents === null), "a day after today with nothing recorded is null, never a zero", JSON.stringify(b.slice(4)));
    ok(w.j?.total_cents === 505000 && w.j.basis_kind === "all_channels", "this week: RM 5,050.00, every channel", JSON.stringify({ t: w.j?.total_cents, k: w.j?.basis_kind }));
    const dash = (await call("/staff/sales/week/dashboard", U.ceo)).j;
    ok(dash?.company?.basis_cents === w.j?.total_cents && b.reduce((a, x) => a + (x.cents ?? 0), 0) === dash.company.basis_cents, "ONE ENGINE: the days add up to the Dashboard's company figure exactly", JSON.stringify({ dash: dash?.company?.basis_cents, perf: w.j?.total_cents }));
    ok(w.j?.previous?.from === "2026-11-02" && w.j.previous.to === "2026-11-04" && w.j.previous.cents === 70000, "the change compares with last week to the same day; last week counted invoices only (its TikTok order is not added)", JSON.stringify(w.j?.previous));
    ok(w.j?.change_pct === 621, "change: (505,000 - 70,000) / 70,000 = +621%", String(w.j?.change_pct));
    ok(w.j?.target_cents === 1000000, "the week carries its approved company target", String(w.j?.target_cents));
    ok(w.j?.outstanding?.cents === 850000 && w.j.outstanding.invoices === 2, "outstanding: 900,000 less the 200,000 verified (the voided payment does not count) + 150,000; the void invoice is not owed", JSON.stringify(w.j?.outstanding));

    const m = (await perf(U.coo, "month")).j;
    ok(m?.from === "2026-11-01" && m.to === "2026-11-30" && m.buckets.map((x) => x.label).join() === "1-1,2-8,9-15,16-22,23-29,30-30", "the month, by business week, clipped to the month", JSON.stringify(m?.buckets?.map((x) => x.label)));
    ok(m?.buckets[1]?.cents === 70000 && m.buckets[2]?.cents === 505000 && m.buckets[3]?.cents === null, "each week counted by its own rule; a week still to come is null", JSON.stringify(m?.buckets));
    ok(m?.total_cents === 575000 && m.target_cents === null && m.change_pct === null && m.previous.from === "2026-10-01" && m.previous.to === "2026-10-11", "the month so far, no weekly target on it, and nothing in October to the 11th to compare", JSON.stringify({ t: m?.total_cents, p: m?.previous }));

    const y = (await perf(U.ceo, "ytd")).j;
    const mon = (l) => y?.buckets?.find((x) => x.label === l);
    ok(y?.buckets?.length === 12 && mon("Jan")?.cents === 0 && mon("Oct")?.cents === 100000, "the year by month: an earlier week stays invoices only (October's TikTok order is not added)", JSON.stringify(mon("Oct")));
    ok(mon("Nov")?.cents === 575000 && mon("Dec")?.cents === null && y.total_cents === 675000, "November; December is null; the year is RM 6,750.00", JSON.stringify({ n: mon("Nov"), t: y?.total_cents }));

    ok((await perf(U.adm)).status === 200, "the admin (exec_view) reads it");
    for (const who of ["aina", "lia", "shop"]) ok((await perf(U[who])).status === 403, `the ${who === "aina" ? "salesperson" : who === "lia" ? "live host" : "customer"} is refused by direct request`);
    ok((await perf(U.ceo, "decade")).status === 400, "an unknown period is refused, not guessed");
    ok(writes() === before, "reading it writes nothing (no audit row, no document, no payment)");
  } catch (e) {
    ok(false, "the run did not throw", String(e?.stack ?? e).slice(0, 400));
  } finally {
    globalThis.Date = RealDate;
  }
  return out;
}

let n = 0, fail = 0;
const report = (list) => { for (const [p, m] of list) { n++; if (!p) { fail++; console.error(`FAIL ${m}`); } } };
const NOMUT = process.env.NOMUT === "1";
const dir = mkdtempSync(join(tmpdir(), "cperf-"));
bundle(root, "worker/src/index.ts", join(dir, "worker.mjs"));
report(await runtime(join(dir, "worker.mjs")));
const checks = n;

const MUT = [
  ["worker/src/weekly-sales.ts", "anyone may read the company figure", '  if (!VIEW_ALL(user)) return err("forbidden", "Company sales are for management", 403);\n  const period', "  const period"],
  ["worker/src/weekly-sales.ts", "an unpaid invoice counts", "WHERE d.doc_type = 'INV' AND d.payment_status = 'paid' AND ${PAID_DAY} BETWEEN ?1 AND ?2 GROUP BY day", "WHERE d.doc_type = 'INV' AND COALESCE(d.payment_status, '') != 'void' AND ${PAID_DAY} BETWEEN ?1 AND ?2 GROUP BY day"],
  ["worker/src/weekly-sales.ts", "every week counts every channel", "  const allCh = (d: string) => countsAllChannels(addDays(weekStartOf(d, startDow), 6));", "  const allCh = (d: string) => d.length > 0;"],
  ["worker/src/weekly-sales.ts", "a returned order counts", "FROM postage_records WHERE status != 'returned' AND date(created_at, '+8 hours') BETWEEN ?1 AND ?2 GROUP BY day", "FROM postage_records WHERE date(created_at, '+8 hours') BETWEEN ?1 AND ?2 GROUP BY day"],
  ["worker/src/weekly-sales.ts", "a day to come is a zero", "cents: b.from > today && c === 0 ? null : c", "cents: c"],
  ["worker/src/weekly-sales.ts", "outstanding ignores verified payments", "SUM(MAX(0, d.total_cents - COALESCE((SELECT SUM(p.amount_cents) FROM invoice_payments p WHERE p.invoice_id = d.id AND p.voided_at IS NULL), 0)))", "SUM(d.total_cents)"],
  ["worker/src/weekly-sales.ts", "the change compares with the whole of last week", "prevFrom = addDays(from, -7); prevTo = addDays(today, -7);", "prevFrom = addDays(from, -7); prevTo = addDays(from, -1);"],
  ["worker/src/weekly-sales.ts", "the total stops at today (a second answer to the week)", "const total = sum(from, to);", "const total = sum(from, today);"],
];
for (const [file, name, from, to] of NOMUT ? [] : MUT) {
  n++;
  const src = readFileSync(join(root, file), "utf8");
  if (!src.includes(from)) { fail++; console.error(`FAIL mutation did not apply: ${name}`); continue; }
  const mdir = mkdtempSync(join(tmpdir(), "cperf-m-"));
  cpSync(join(root, "worker"), join(mdir, "worker"), { recursive: true, filter: (p) => !p.includes("node_modules") });
  cpSync(join(root, "package.json"), join(mdir, "package.json"));
  for (const d of ["lib", "constants", "types"]) { try { cpSync(join(root, d), join(mdir, d), { recursive: true }); } catch { /* not every folder exists */ } }
  writeFileSync(join(mdir, file), src.replace(from, to));
  try { bundle(mdir, "worker/src/index.ts", join(mdir, "worker.mjs")); } catch { fail++; console.error(`FAIL mutation did not build: ${name}`); continue; }
  const res = await runtime(join(mdir, "worker.mjs"));
  rmSync(mdir, { recursive: true, force: true });
  if (!res.some(([p]) => !p)) { fail++; console.error(`FAIL mutation not caught: ${name}`); }
}
rmSync(dir, { recursive: true, force: true });
if (fail) { console.error(`company-performance: ${fail} of ${n} failed`); process.exit(1); }
console.log(`company-performance: ${checks} checks passed (${NOMUT ? "mutations skipped" : `${MUT.length} mutations caught`}) - the Dashboard's Sales Performance is the company figure by day: the days add up to the week exactly, each week by its own channel rule, null after today, the same point last period, outstanding less verified payments, management only, read-only`);
