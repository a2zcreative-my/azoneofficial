/* v1.403.0 - SALES COMMAND CENTER, PHASE 6: REPORTS (the CEO, 21-11-2026, "As recommended" on the seven Phase 6
 * decisions). worker/src/sales-reports.ts - four pure reads. Runtime guard on the tasks-gate4 harness: the WHOLE
 * worker bundled against SQLite with every migration, by direct request, then broken copies.
 *
 *   - Team Performance (management only): ACTIVITY (contacts logged - not the follow-up's own row, follow-ups
 *     completed, quotations issued) apart from RESULTS (deals won and their value, invoices paid in full in the
 *     period and their total - the weekly engine's own basis)
 *   - Pipeline: open deals by stage now with quoted and estimated apart (counted once), the moves and the days in
 *     a stage within the period, won and lost in the period
 *   - Win / Loss: how deals were won, why they were lost, with the reasons written
 *   - Lead Sources: leads that came in during the period by source, how many became deals and were won
 *   - Malaysian periods (week, month, last month, 3 months, year); Everyone only with exec_view
 *   - reads only: nothing in the database changes
 *
 *   node tests/sales-reports.mjs
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
  const entry = join(srcRoot, "sales-reports-entry.ts");
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

async function runtime(workerBundle, migDir) {
  const out = [];
  const ok = (c, m, why = "") => out.push([!!c, why && !c ? `${m} - ${why}` : m]);
  const db = new DatabaseSync(":memory:");
  const realClock = new DatabaseSync(":memory:");
  const pinTs = () => new Date().toISOString().slice(0, 19).replace("T", " ");
  for (const fn of ["datetime", "date", "time", "julianday"]) db.function(fn, { varargs: true }, (...a) => realClock.prepare(`SELECT ${fn}(${(a.length ? a : ["now"]).map(() => "?").join(",")}) AS v`).get(...(a.length ? a : ["now"]).map((x) => (typeof x === "string" && x.toLowerCase() === "now" ? pinTs() : x))).v);
  db.function("strftime", { varargs: true }, (...a) => realClock.prepare(`SELECT strftime(${a.map(() => "?").join(",")}) AS v`).get(...a.map((x, i) => (i > 0 && typeof x === "string" && x.toLowerCase() === "now" ? pinTs() : x))).v);
  const RealDate = globalThis.Date;
  const fixed = Date.parse("2026-11-10T04:00:00Z"); // Tuesday 10-11-2026, 12:00 in Malaysia
  globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [fixed])); } static now() { return fixed; } };
  applyAll(db, migDir);
  const shim = (sql) => { const st = db.prepare(sql); let b = []; const o = {
    bind: (...a) => { b = a.map((x) => (x === undefined ? null : x)); return o; },
    first: async () => st.get(...b) ?? null, all: async () => ({ results: st.all(...b) }),
    run: async () => ({ meta: { changes: Number(st.run(...b).changes) } }), _run: () => st.run(...b) }; return o; };
  const env = {
    DB: { prepare: shim, batch: async (list) => { db.exec("BEGIN"); const res = []; try { for (const s of list) res.push({ meta: { changes: Number(s._run().changes) } }); db.exec("COMMIT"); } catch (e) { db.exec("ROLLBACK"); throw e; } return res; } },
    SESSION_PEPPER: "pepper", COMPANY_DOMAIN: "a2z.test", ALLOWED_ORIGINS: "https://portal.a2z.test",
    MEDIA: { put: async () => {}, get: async () => null, head: async () => null, list: async () => ({ objects: [] }), delete: async () => {} },
  };
  if (!globalThis.FixedLengthStream) globalThis.FixedLengthStream = class extends TransformStream { constructor() { super(); } };
  const U = { ceo: 1, sa: 2, coo: 3, admin: 4, aina: 5, hr: 6, host: 7, cco: 8, bakar: 9, mkt: 10, agent: 11 };
  db.exec(`INSERT INTO users (id, name, full_name, email, role, is_active, password_hash, totp_enabled, totp_secret, employment_status, base_salary_cents, joined_on) VALUES
    (1,'Alif','Alif Owner','owner@a2z.test','ceo',1,'x',1,'JBSWY3DPEHPK3PXP','permanent',900000,'2024-01-01'),
    (2,'Root','System Root','root@a2z.test','super_admin',1,'x',1,'JBSWY3DPEHPK3PXP','permanent',0,'2024-01-01'),
    (3,'Ops','Ops Lead','ops@a2z.test','coo',1,'x',1,'JBSWY3DPEHPK3PXP','permanent',800000,'2024-01-01'),
    (4,'Adm','Admin Clerk','admin@a2z.test','admin',1,'x',1,'JBSWY3DPEHPK3PXP','permanent',300000,'2024-01-01'),
    (5,'Aina','Aina Seller','aina@a2z.test','sales_marketing',1,'x',1,'JBSWY3DPEHPK3PXP','permanent',300000,'2024-01-01'),
    (6,'Hana','Hana HR','hana@a2z.test','hr_admin',1,'x',1,'JBSWY3DPEHPK3PXP','permanent',400000,'2024-01-01'),
    (7,'Farid','Farid Host','farid@a2z.test','live_host',1,'x',1,'JBSWY3DPEHPK3PXP','permanent',250000,'2024-01-01'),
    (8,'Chen','Chen CCO','chen@a2z.test','cco',1,'x',1,'JBSWY3DPEHPK3PXP','permanent',700000,'2024-01-01'),
    (9,'Bakar','Bakar Seller','bakar@a2z.test','sales_marketing',1,'x',1,'JBSWY3DPEHPK3PXP','permanent',300000,'2024-01-01'),
    (10,'Mira','Mira Marketing','mira@a2z.test','marketing',1,'x',1,'JBSWY3DPEHPK3PXP','permanent',300000,'2024-01-01'),
    (11,'Ros','Ros Agent','ros@agent.test','agent',1,'x',1,'JBSWY3DPEHPK3PXP','permanent',0,'2024-01-01')`);
  db.exec(`INSERT INTO system_meta (key, value) VALUES ('company_owner', '{"user_id":1}')`);
  const cust = db.prepare(`INSERT INTO customers (id, company, created_by, created_at, lead_source, owner_id) VALUES (?, ?, 5, ?, ?, ?)`);
  cust.run(1, "Nov Website Lead", "2026-11-02 02:00:00", "website", 5);
  cust.run(2, "Nov Referral Lead", "2026-11-03 02:00:00", "referral", 5);
  cust.run(3, "Nov Website Two", "2026-11-04 02:00:00", "website", 9);
  cust.run(4, "Oct Old Lead", "2026-10-04 02:00:00", "website", 5);
  cust.run(5, "Nov No Source", "2026-11-05 02:00:00", null, 5);
  db.exec(`INSERT INTO customers (id, company, created_by, created_at) VALUES (31, 'Walk-in Customer', 5, '2026-11-05 02:00:00')`);
  const doc = db.prepare(`INSERT INTO sales_documents (id, doc_type, doc_number, customer_id, items, discount_cents, tax_percent, total_cents, payment_status, paid_at, created_at, created_by, salesperson_id, kind, issuer_code) VALUES (?, ?, ?, ?, '[]', 0, 0, ?, ?, ?, ?, 5, ?, 'service', 'a2z')`);
  doc.run(601, "QT", "QT-R-601", 1, 150000, null, null, "2026-11-03 02:00:00", 5);
  doc.run(602, "INV", "INV-R-602", 1, 100000, "paid", "2026-11-06 02:00:00", "2026-11-04 02:00:00", 5);
  doc.run(603, "INV", "INV-R-603", 4, 999900, "paid", "2026-10-20 02:00:00", "2026-10-10 02:00:00", 5);   // paid in October
  doc.run(604, "QT", "QT-R-604", 2, 80000, null, null, "2026-11-04 02:00:00", 5);
  const opp = db.prepare(`INSERT INTO sales_opportunities (id, customer_id, title, owner_id, stage, est_value_cents, won_basis, override_reason, lost_reason, lost_note, stage_since, closed_at, client_key, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 5, ?)`);
  opp.run(1, 1, "Won on acceptance", 5, "won", 20000, "acceptance", null, null, null, "2026-11-07 02:00:00", "2026-11-07 02:00:00", "o1", "2026-11-02 02:00:00");
  opp.run(2, 2, "Open in proposal", 5, "proposal", null, null, null, null, null, "2026-11-05 02:00:00", null, "o2", "2026-11-03 02:00:00");
  opp.run(3, 3, "Bakar estimate", 9, "qualified", 50000, null, null, null, null, "2026-11-04 02:00:00", null, "o3", "2026-11-04 02:00:00");
  opp.run(4, 2, "Lost on price", 5, "lost", 30000, null, null, "price", "Too dear for them", "2026-11-08 02:00:00", "2026-11-08 02:00:00", "o4", "2026-11-02 02:00:00");
  opp.run(5, 4, "Won in October", 5, "won", 77700, "override", "Signed on paper", null, null, "2026-10-15 02:00:00", "2026-10-15 02:00:00", "o5", "2026-10-02 02:00:00");
  db.exec(`INSERT INTO opportunity_quotations (opportunity_id, doc_id, linked_by) VALUES (1, 601, 5), (2, 604, 5)`);
  const ev = db.prepare(`INSERT INTO opportunity_stage_events (opportunity_id, from_stage, to_stage, created_by, created_at) VALUES (?, ?, ?, 5, ?)`);
  ev.run(1, null, "new", "2026-11-02 02:00:00"); ev.run(1, "new", "proposal", "2026-11-02 02:00:00"); ev.run(1, "proposal", "negotiation", "2026-11-06 02:00:00"); ev.run(1, "negotiation", "won", "2026-11-07 02:00:00");
  ev.run(2, null, "new", "2026-11-03 02:00:00"); ev.run(2, "new", "proposal", "2026-11-05 02:00:00");
  ev.run(4, null, "new", "2026-10-01 02:00:00"); ev.run(4, "new", "qualified", "2026-10-20 02:00:00"); ev.run(4, "qualified", "lost", "2026-11-08 02:00:00");
  ev.run(5, null, "new", "2026-10-02 02:00:00"); ev.run(5, "new", "won", "2026-10-15 02:00:00");
  db.exec(`INSERT INTO sales_activities (customer_id, kind, note, occurred_at, source_key, created_by) VALUES
    (1, 'call', 'Called', '2026-11-03 02:00:00', 'a1', 5), (2, 'whatsapp', 'Sent deck', '2026-11-04 02:00:00', 'a2', 5),
    (1, 'followup', 'Closed follow-up', '2026-11-04 03:00:00', 'followup:9', 5), (2, 'call', 'October call', '2026-10-04 02:00:00', 'a3', 5)`);
  db.exec(`INSERT INTO customer_followups (id, customer_id, due_on, owner_id, note, created_by, done_at, done_by) VALUES (9, 1, '2026-11-04', 5, 'Ask', 5, '2026-11-04 03:00:00', 5)`);

  const app = (await import(pathToFileURL(workerBundle).href + `?v=${Math.random()}`)).default;
  const tok = {};
  for (const id of Object.values(U)) { tok[id] = `t-${id}-${Math.random()}`; db.prepare(`INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, datetime('now', '+12 hours'), datetime('now'))`).run(sha(tok[id]), id); }
  const hdr = (uid) => ({ origin: "https://portal.a2z.test", cookie: `azone_session=${tok[uid]}; csrf_token=c1`, "x-csrf-token": "c1", "content-type": "application/json" });
  const call = async (p, uid, method = "GET", body) => {
    const r = await app.fetch(new Request(`https://api.a2z.test/api/v1/staff${p}`, { method, headers: hdr(uid), body: body === undefined ? undefined : JSON.stringify(body) }), env, { waitUntil() {} });
    const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch { /* not json */ }
    return { status: r.status, j, text };
  };
  const snap = () => sha(db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT IN ('sessions', 'sqlite_sequence')`).all().map((t) => { try { return JSON.stringify(db.prepare(`SELECT * FROM "${t.name}"`).all()); } catch { return "-"; } }).join("|"));
  try {
    const before = snap();
    for (const k of ["team", "pipeline", "winloss", "sources"]) ok((await call(`/sales/reports/${k}`, U.agent)).status === 403 && (await call(`/sales/reports/${k}`, U.host)).status === 403, `${k}: agents and live hosts are refused`);
    ok((await call("/sales/reports/pipeline", U.coo, "POST", {})).status === 405, "reports only read");

    /* periods */
    const per = async (p) => (await call(`/sales/reports/sources?period=${p}`, U.aina)).j;
    const m = await per("month"), lm = await per("last_month"), q3 = await per("3m"), y = await per("year"), wk = await per("week"), bad = await per("forever");
    ok(m.from === "2026-11-01" && m.to === "2026-11-30" && lm.from === "2026-10-01" && lm.to === "2026-10-31" && q3.from === "2026-09-01" && q3.to === "2026-11-10" && y.from === "2026-01-01" && bad.period === "month",
      "Malaysian periods: this month, last month, 3 months, this year; anything else is this month", JSON.stringify([m.from, m.to, lm.from, lm.to, q3.from, y.from]));
    ok(wk.from <= "2026-11-10" && wk.to >= "2026-11-10" && (Date.parse(wk.to) - Date.parse(wk.from)) === 6 * 86400000, "this week is the seven days around today", JSON.stringify([wk.from, wk.to]));

    /* team */
    ok((await call("/sales/reports/team", U.aina)).status === 403, "Team Performance is for management");
    const t = await call("/sales/reports/team?period=month", U.coo);
    const aina = (t.j?.rows ?? []).find((r) => r.user_id === U.aina);
    ok(aina?.activity.contacts === 2 && aina.activity.followups_done === 1 && aina.activity.quotations === 2, "activity: contacts logged (not the follow-up's own row, not October's), follow-ups completed, quotations issued", JSON.stringify(aina?.activity));
    ok(aina?.results.deals_won === 1 && aina.results.deals_won_cents === 150000 && aina.results.paid_invoices === 1 && aina.results.collected_cents === 100000, "results: the deal won this month at its quotation's value (not the estimate), and only invoices paid in full this month", JSON.stringify(aina?.results));
    const oct = (await call("/sales/reports/team?period=last_month", U.coo)).j?.rows?.find((r) => r.user_id === U.aina);
    ok(oct?.results.collected_cents === 999900 && oct.results.deals_won === 1 && oct.activity.contacts === 1, "last month counts last month's work only", JSON.stringify(oct));

    /* pipeline */
    const pm = await call("/sales/reports/pipeline?period=month&scope=all", U.aina);
    ok(pm.j?.scope === "mine" && pm.j.can_all === false, "a consultant's Everyone is their own work");
    const pa = (await call("/sales/reports/pipeline?period=month&scope=all", U.coo)).j;
    const st = Object.fromEntries((pa?.now ?? []).map((x) => [x.stage, x]));
    ok(st.proposal?.deals === 1 && st.proposal.quoted_cents === 80000 && st.proposal.estimated_cents === 0 && st.qualified?.deals === 1 && st.qualified.estimated_cents === 50000 && st.qualified.quoted_cents === 0,
      "open deals now: a linked quotation is 'quoted', an estimate 'estimated', never both", JSON.stringify(pa?.now));
    const mv = Object.fromEntries((pa?.moves ?? []).map((x) => [`${x.from}>${x.to}`, x.n]));
    ok(mv["new>proposal"] === 2 && mv["proposal>negotiation"] === 1 && mv["qualified>lost"] === 1 && !mv["new>qualified"] && !mv["new>won"], "moves are the stage changes within the period only", JSON.stringify(mv));
    ok(pa?.avg_days.find((x) => x.stage === "proposal")?.days === 4, "days in a stage: entered Proposal sent on the 2nd, left on the 6th = 4 days", JSON.stringify(pa?.avg_days));
    ok(pa?.won.n === 1 && pa.won.cents === 150000 && pa.lost.n === 1 && pa.lost.cents === 30000, "won and lost in the period, valued once", JSON.stringify([pa?.won, pa?.lost]));

    /* win / loss */
    const wl = (await call("/sales/reports/winloss?period=3m&scope=all", U.coo)).j;
    const wb = Object.fromEntries((wl?.won ?? []).map((x) => [x.basis, x.n])), lr = Object.fromEntries((wl?.lost ?? []).map((x) => [x.reason, x.n]));
    ok(wb.acceptance === 1 && wb.override === 1 && wb.invoice === 0 && lr.price === 1 && (wl?.lost ?? []).length === 7, "won by basis and lost by each of the seven reasons", JSON.stringify([wb, lr]));
    ok((wl?.rows ?? []).some((r) => r.override_reason === "Signed on paper") && (wl?.rows ?? []).some((r) => r.lost_note === "Too dear for them"), "the written reasons come with the rows");

    /* sources */
    const so = (await call("/sales/reports/sources?period=month&scope=all", U.coo)).j;
    const sb = Object.fromEntries((so?.rows ?? []).map((x) => [x.source, x]));
    ok(sb.website?.leads === 2 && sb.website.with_deal === 2 && sb.website.won === 1 && sb.referral?.leads === 1 && sb.referral.with_deal === 1 && sb.unknown?.leads === 1 && so.total.leads === 4,
      "leads of the period by source (walk-in and October left out), how many became deals and were won", JSON.stringify(so?.rows));
    const sm = (await call("/sales/reports/sources?period=month", U.aina)).j;
    ok(sm?.total.leads === 3, "a consultant's sources are the leads they own", JSON.stringify(sm?.rows));

    ok(snap() === before, "reading the reports changes nothing in the database");
  } catch (e) { ok(false, "the run threw", String(e?.stack ?? e).slice(0, 500)); }
  globalThis.Date = RealDate;
  return out;
}

let n = 0, fail = 0;
const report = (res, tag = "") => { for (const [p, m] of res) { n++; if (!p) { fail++; console.error(`FAIL ${tag}${m}`); } } };
const s = (c, m) => report([[c, m]]);
const srv = read("worker/src/sales-reports.ts"), ui = read("components/portal/sales-reports.tsx");
s(!/\b(INSERT|UPDATE|DELETE)\b/.test(srv.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")), "sales-reports.ts writes nothing");
s(/team-activity-head/.test(ui) && /team-results-head/.test(ui), "Team Performance keeps activity and results in two column groups");
s(/not revenue|bukan hasil/.test(ui), "the reports say a deal's value is not revenue");

const dir = mkdtempSync(join(tmpdir(), "salesreports-"));
const main = join(dir, "worker.mjs");
bundle(root, main);
report(await runtime(main, join(root, "worker/migrations")));
const checks = n;

const MUTANTS = [
  ["a follow-up's own row counts as a contact", "worker/src/sales-reports.ts", "WHERE created_by = ?1 AND kind != 'followup' AND", "WHERE created_by = ?1 AND"],
  ["a consultant sees everyone", "worker/src/sales-reports.ts", `params.get("scope") === "all" && exec ? "all" : "mine"`, `params.get("scope") === "all" ? "all" : "mine"`],
  ["Team Performance for everyone", "worker/src/sales-reports.ts", `if (!exec) return err("forbidden", "Team Performance is for management", 403);`, ""],
  ["moves outside the period count", "worker/src/sales-reports.ts", "if (e.from_stage && inRange(e.created_at)) moves[", "if (e.from_stage) moves["],
  ["the walk-in counts as a lead", "worker/src/sales-reports.ts", "WHERE c.company != 'Walk-in Customer' AND ${MYT(\"c.created_at\")}", "WHERE 1 = 1 AND ${MYT(\"c.created_at\")}"],
  ["last month runs into this month", "worker/src/sales-reports.ts", `return { period: p, from, to: addDays(monthStart(today), -1) };`, `return { period: p, from, to: today };`],
  ["a won deal valued at its estimate", "worker/src/sales-reports.ts", "const wonCents = won.reduce((t, d) => t + (dealValue(d.est_value_cents, q.get(d.id) ?? []).cents ?? 0), 0);", "const wonCents = won.reduce((t, d) => t + (d.est_value_cents ?? 0), 0);"],
  ["closed outside the period counts", "worker/src/sales-reports.ts", "const closed = (s: string) => all.filter((d) => d.stage === s && d.closed_at && inRange(d.closed_at));", "const closed = (s: string) => all.filter((d) => d.stage === s);"],
];
let caught = 0;
for (const [name, file, from, to] of MUTANTS) {
  const m = mkdtempSync(join(tmpdir(), "salesreports-m-"));
  cpSync(join(root, "worker"), join(m, "worker"), { recursive: true });
  cpSync(join(root, "lib"), join(m, "lib"), { recursive: true });
  cpSync(join(root, "package.json"), join(m, "package.json"));
  const body = readFileSync(join(m, file), "utf8");
  if (!body.includes(from)) { report([[false, `mutation "${name}" no longer applies - update the guard`]]); continue; }
  writeFileSync(join(m, file), body.replace(from, to));
  const mb = join(m, "w.mjs");
  const entry = join(m, "e.ts");
  writeFileSync(entry, `export { default } from "./worker/src/index.ts";\n`);
  execSync(`npx esbuild "${entry}" --bundle --format=esm --platform=neutral --outfile="${mb}" --log-level=error`, { cwd: root, stdio: "inherit" });
  const res = await runtime(mb, join(m, "worker/migrations"));
  if (res.some(([p]) => !p)) caught++; else report([[false, `mutation "${name}" was NOT caught`]]);
  rmSync(m, { recursive: true, force: true });
}
rmSync(dir, { recursive: true, force: true });
if (fail) { console.error(`sales-reports: ${fail} of ${n} failed`); process.exit(1); }
console.log(`PASS - sales reports: Team Performance (management) with activity apart from results, Pipeline (now by stage, moves and days in the period, won and lost), Win / Loss with the reasons, Lead Sources; Malaysian periods; Everyone only with exec_view; reads only (${checks} checks, ${caught}/${MUTANTS.length} mutations caught)`);
