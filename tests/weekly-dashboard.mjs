/* THE WEEKLY SALES TARGET ON THE DASHBOARD (v1.239.0) - runtime guard: the
 * WHOLE worker (index.ts, bundled) against SQLite with every migration
 * applied, by direct request.
 *
 * The owner's brief and answers, 31-10-2026 (claude/WEEKLY-TARGET-DASHBOARD-
 * AUDIT.md): "ONE WEEKLY SALES TARGET ENGINE. ONE SALES SOURCE OF TRUTH. NO
 * DUPLICATE MODULES. NO INCORRECT COMMISSION." Answers: invoices collected;
 * revenue + contribution goals (migration 0156, Introduce a lead); every
 * staff member sees the company target, RM and %; an HOD sees team progress.
 *
 * The brief's tests, as numbered there (15 is the browser run):
 *   1 the CEO sees the company target and team performance
 *   2 an HOD sees their department (the chart's people below them)
 *   3 staff see their own target          4 staff with no target
 *   5 a non-sales employee with a qualified-lead goal
 *   6 a new target by authorised management (and nobody else)
 *   7 a changed target keeps its effective-date history
 *   8 an unpaid invoice is not collected  9 a paid invoice moves the right week
 *   10 a repeated payment does not double 11 a missed target leaves commission alone
 *   12 tasks stay in the Tasks module (linked, once)
 *   13 a resigned employee drops out from their last day
 *   14 the Dashboard equals the Sales scorecard
 * plus: no other person's figures by direct API, other channels never added.
 * Then mutated copies must each fail a check.
 *
 *   node tests/weekly-dashboard.mjs
 */
import { readFileSync, readdirSync, mkdtempSync, writeFileSync, cpSync } from "node:fs";
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
  let fixed = RealDate.now();
  globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [fixed])); } static now() { return fixed; } };
  const code = () => { fixed += 31000; return totpAt(fixed); };
  const today = new RealDate(RealDate.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
  const from = day(today, -((new RealDate(`${today}T00:00:00Z`).getUTCDay() + 6) % 7)); // Monday
  const lastWeek = day(from, -7);
  const U = { ceo: 1, coo: 2, cco: 3, hod: 4, aina: 5, mia: 6, lia: 7, root: 8, shop: 9, gone: 10, adm: 11, leaver: 12 };
  db.exec(`INSERT INTO users (id, name, full_name, email, role, is_active, password_hash, totp_enabled, totp_secret, department, reports_to, employment_status, left_on, joined_on) VALUES
    (1,'Alif','Alif Farhan','alif@a2z.test','ceo',1,'x',1,'${SECRET}','Management',NULL,'permanent',NULL,'2020-01-01'),
    (2,'Ops','Ops Lead','ops@a2z.test','coo',1,'x',1,'${SECRET}','Management',1,'permanent',NULL,'2020-01-01'),
    (3,'Com','Com Lead','com@a2z.test','cco',1,'x',1,'${SECRET}','Management',1,'permanent',NULL,'2020-01-01'),
    (4,'Hakim','Hakim Head','hakim@a2z.test','sales_marketing',1,'x',1,'${SECRET}','Sales',2,'permanent',NULL,'2020-01-01'),
    (5,'Aina','Aina Seller','aina@a2z.test','sales_marketing',1,'x',1,'${SECRET}','Sales',4,'permanent',NULL,'2020-01-01'),
    (6,'Mia','Mia Editor','mia@a2z.test','editor',1,'x',1,'${SECRET}','Sales',4,'permanent',NULL,'2020-01-01'),
    (7,'Lia','Lia Host','lia@a2z.test','live_host',1,'x',1,'${SECRET}','Live',2,'permanent',NULL,'2020-01-01'),
    (8,'Root','Root','root@a2z.test','super_admin',1,'x',1,'${SECRET}',NULL,NULL,'permanent',NULL,'2020-01-01'),
    (9,'Shop','Shop','shop@gmail.com','customer',1,'x',0,NULL,NULL,NULL,'permanent',NULL,NULL),
    (10,'Gone','Gone Seller','gone@a2z.test','sales_marketing',1,'x',1,'${SECRET}','Sales',4,'resigned','${day(from, -20)}','2020-01-01'),
    (11,'Tech','Tech','tech@a2z.test','admin',1,'x',1,'${SECRET}',NULL,NULL,'permanent',NULL,'2020-01-01'),
    (12,'Leaver','Mid Week Leaver','leaver@a2z.test','sales_marketing',1,'x',1,'${SECRET}','Sales',4,'resigned','${day(from, 6)}','2020-01-01')`);
  db.exec(`INSERT INTO customers (id, company, created_by) VALUES (1,'Kedai Satu',5),(2,'Kedai Dua',5)`);
  const doc = db.prepare(`INSERT INTO sales_documents (id, doc_type, doc_number, customer_id, items, discount_cents, tax_percent, total_cents, payment_status, paid_at, created_at, created_by, salesperson_id, kind, valid_until) VALUES (?,?,?,?,'[]',0,0,?,?,?,?,5,?,'service',?)`);
  doc.run(100, "INV", "INV-100", 1, 300000, "paid", `${from} 02:00:00`, `${from} 01:00:00`, 5, null);           // Aina, paid this week
  doc.run(101, "INV", "INV-101", 1, 900000, "unpaid", null, `${from} 01:00:00`, 5, null);                         // 8: unpaid
  doc.run(102, "INV", "INV-102", 2, 70000, "paid", `${lastWeek} 03:00:00`, `${lastWeek} 01:00:00`, 5, null);      // last week
  doc.run(103, "INV", "INV-103", 2, 150000, "unpaid", null, `${from} 01:00:00`, 5, null);                         // 9: paid during the test
  doc.run(104, "QT", "QT-104", 2, 500000, null, null, `${from} 01:00:00`, 5, "2099-12-31");                       // an open quotation
  doc.run(105, "INV", "INV-105", 1, 120000, "paid", `${from} 03:00:00`, `${from} 01:00:00`, 4, null);           // Hakim
  doc.run(106, "INV", "INV-106", 1, 50000, "paid", `${from} 03:00:00`, `${from} 01:00:00`, 10, null);           // the resigned seller's old account
  db.exec(`INSERT INTO postage_records (order_ref, order_amount_cents, status, created_at) VALUES ('TT-1', 40000, 'shipped', '${from} 02:00:00')`);
  db.exec(`INSERT INTO commission_ledger (source_key, kind, invoice_id, user_id, basis_cents, amount_cents, status, paid_day) VALUES ('earn:102', 'earn', 102, 5, 70000, 3500, 'eligible', '${lastWeek}')`);

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
  const dash = (uid) => call("/staff/sales/week/dashboard", uid);
  const setT = (uid, b) => call("/staff/sales/week/targets", uid, "POST", { week_from: from, reason: "Weekly push approved by the CEO", ...b });

  try {
    /* 4 before anything is set: "Target not set", never a 0% */
    let d = (await dash(U.lia)).j;
    ok(d?.week?.from === from && d.week.to === day(from, 6), "the business week is Monday to Sunday, Malaysia time", JSON.stringify(d?.week));
    ok(d?.company?.target_cents === null && d.company.pct === null && d.company.gap_cents === null, "with no company target: no %, no remaining - 'Target not set'");
    ok(d?.me?.has_target === false && d.me.status === "no_target" && d.me.pct === null, "4 a staff member with no target: no target assigned, no 0%");

    /* 6 who sets */
    for (const who of ["cco", "hod", "aina", "mia", "adm"]) ok((await setT(U[who], { scope: "company", target_cents: 1000000 })).status === 403, `6 the ${who} cannot set a weekly target`);
    ok((await setT(U.ceo, { scope: "company", target_cents: 1000000 })).status === 201, "6 the CEO sets the company target");
    ok((await setT(U.coo, { scope: "person", user_id: U.aina, target_cents: 400000, week_from: lastWeek, reason: "First weekly target for Aina" })).status === 201, "6 the COO sets Aina's target from last week");
    ok((await setT(U.ceo, { scope: "person", user_id: U.aina, target_cents: 600000 })).status === 201, "7 the CEO raises it from this week - a new row");
    ok((await setT(U.ceo, { scope: "person", user_id: U.hakim ?? U.hod, target_cents: 200000 })).status === 201, "the HOD gets a target");
    ok((await setT(U.ceo, { scope: "person", user_id: U.mia, metric: "introductions", target_count: 2 })).status === 201, "5 a non-sales employee gets a goal of 2 verified introductions");
    ok((await setT(U.ceo, { scope: "company", metric: "introductions", target_count: 5 })).status === 400, "a contribution goal is for a person; the company target is revenue");
    ok((await setT(U.ceo, { scope: "person", user_id: U.mia, metric: "appointments", target_count: 2 })).status === 400, "only goals the records can count");
    ok((await setT(U.ceo, { scope: "person", user_id: U.gone, target_cents: 100000 })).status === 404, "13 a resigned employee cannot be given a target");
    const rows = db.prepare(`SELECT user_id, week_from, target_cents, metric, target_count, set_by FROM sales_week_targets WHERE user_id = 5 ORDER BY id`).all();
    ok(rows.length === 2 && rows[0].week_from === lastWeek && rows[0].target_cents === 400000 && rows[1].week_from === from && rows[1].target_cents === 600000 && rows.every((r) => r.metric === "revenue"), "7 both rows kept, each from its own week", JSON.stringify(rows));
    ok(db.prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'sales.week_target'`).get().n === 5, "every target change is audited (who, when, why, from which week)");
    const lw = (await call(`/staff/sales/week?week=${lastWeek}`, U.aina)).j?.me;
    ok(lw?.target_cents === 400000 && lw.basis_cents === 70000, "7 last week keeps its own target and its own sales", JSON.stringify({ t: lw?.target_cents, b: lw?.basis_cents }));

    /* 3 + 8 + 14 */
    d = (await dash(U.aina)).j;
    ok(d?.me?.target_cents === 600000 && d.me.basis_cents === 300000 && d.me.pct === 50 && d.me.gap_cents === 300000, "3 Aina sees her target, her collected sales and what is left", JSON.stringify({ t: d?.me?.target_cents, b: d?.me?.basis_cents }));
    ok(d.me.basis_cents === 300000, "8 the unpaid invoice is not collected");
    const sales = (await call("/staff/sales/week", U.aina)).j?.me;
    ok(sales && ["target_cents", "basis_cents", "pct", "gap_cents", "status", "expected_cents"].every((k) => sales[k] === d.me[k]), "14 the Dashboard equals the Sales scorecard for her", JSON.stringify([sales?.status, d.me.status]));
    ok(d.company.target_cents === 1000000 && d.company.basis_cents === 300000 + 120000 + 50000, "the company figure: every closer's collected invoices, nothing else", String(d.company.basis_cents));
    ok(d.other_channels_cents === 40000, "other channels are shown beside it to revenue readers, never added", String(d.other_channels_cents));
    ok(d.team === null && d.all === null, "3 a salesperson gets no team and no everyone");
    ok(d.me.open_quotations?.n === 1 && d.can_sales === true, "her actions: one open quotation to revisit");
    ok(!/commission_cents|rate_bp|amount_cents/.test(JSON.stringify(d)) && d.commission?.policy === false, "no commission figure on the card");

    /* 2 the HOD */
    d = (await dash(U.hod)).j;
    const team = d?.team;
    const names = (team?.rows ?? []).map((r) => r.name).sort();
    ok(team && names.join() === ["Aina Seller", "Hakim Head", "Mia Editor", "Mid Week Leaver"].join(), "2 the HOD sees the people below them on the chart, and themself (someone serving notice this week still counts)", names.join());
    ok(!names.includes("Gone Seller") && !names.includes("Lia Host"), "13 ...not a leaver from before the week, not another department");
    ok(team.target_cents === 600000 + 200000 && team.basis_cents === 300000 + 120000, "2 the team target is the sum of its members' targets; team collected is theirs", JSON.stringify({ t: team?.target_cents, b: team?.basis_cents }));
    const keys = new Set(team.rows.flatMap((r) => Object.keys(r)));
    ok(["confirmed_cents", "plan", "goals", "paid_invoices", "open_quotations", "commission"].every((k) => !keys.has(k)), "2 a team row is name, target, collected, % and status - nothing private", [...keys].join());
    ok(d.all === null, "2 the HOD does not get everyone");

    /* 1 the CEO */
    d = (await dash(U.ceo)).j;
    ok(d?.all && d.can_set && d.can_view_all, "1 the CEO gets everyone, and the Manage targets door");
    const allNames = d.all.rows.map((r) => r.name);
    ok(allNames.includes("Aina Seller") && allNames.includes("Mia Editor") && !allNames.includes("Gone Seller") && !allNames.includes("Root"), "1 + 13 everyone on staff that week with a target or sales - no leaver, no system account", allNames.join());
    ok(d.all.departments.some((x) => x.name === "Sales" && x.basis_cents === 420000), "1 performance by department", JSON.stringify(d.all.departments));
    ok(d.team === null, "the CEO reads everyone, not a team");
    const sAll = (await call("/staff/sales/week?scope=all", U.ceo)).j;
    ok(sAll.company.basis_cents === d.company.basis_cents && sAll.company.target_cents === d.company.target_cents
      && d.all.rows.every((r) => { const s = sAll.rows.find((x) => x.user_id === r.user_id); return s && s.basis_cents === r.basis_cents && s.status === r.status && s.target_cents === r.target_cents; }),
      "14 every Dashboard row equals the Sales scorecard's");
    ok((await dash(U.cco)).j?.all && (await dash(U.coo)).j?.all, "the COO and CCO monitor everyone too");

    /* 5 a non-sales employee: introduce a lead, Sales qualifies it */
    ok((await call("/staff/sales/week", U.mia)).status === 403, "the editor still has no Sales scorecard");
    d = (await dash(U.mia)).j;
    ok(d?.me?.has_target && d.me.goals?.[0]?.metric === "introductions" && d.me.goals[0].target === 2 && d.me.goals[0].actual === 0, "5 Mia sees her goal: 0 of 2 introductions", JSON.stringify(d?.me?.goals));
    ok(d.company.target_cents === 1000000 && d.other_channels_cents === null, "every staff member sees the company target; other channels only for revenue readers");
    ok(!/Aina|Hakim/.test(JSON.stringify(d).replace(/"name":"Mia Editor"/, "")), "no other person's figures reach a staff member", "");
    const lead = { name: "Puan Rosnah", company: "Butik Rosnah", phone: "+60 12-555 0101", note: "Wants live selling for her boutique opening" };
    const intro = await call("/enquiries/introduce", U.mia, "POST", lead);
    ok(intro.status === 201 && db.prepare(`SELECT referred_by, status, qualified_at FROM enquiries WHERE id = ?`).get(intro.j?.id)?.referred_by === 6, "5 Mia introduces a lead - an ordinary enquiry naming her", intro.text);
    ok((await call("/enquiries/introduce", U.mia, "POST", lead)).status === 409, "the same contact twice is one enquiry");
    ok((await call("/enquiries/introduce", U.shop, "POST", { ...lead, phone: "+60 12-555 0199" })).status === 403, "a customer cannot introduce a lead");
    ok((await call(`/enquiries/${intro.j?.id}`, U.mia, "PATCH", { status: "qualified" })).status === 403, "Mia cannot qualify her own introduction");
    ok((await dash(U.mia)).j?.me?.introductions?.pending === 1 && (await dash(U.mia)).j?.me?.goals?.[0]?.actual === 0, "an unverified introduction is pending, not counted");
    ok((await call(`/enquiries/${intro.j?.id}`, U.aina, "PATCH", { status: "qualified" })).status === 200, "Sales marks it qualified");
    const q = db.prepare(`SELECT qualified_at, qualified_by FROM enquiries WHERE id = ?`).get(intro.j?.id);
    ok(q?.qualified_at && q.qualified_by === 5, "the day and the person who qualified it are stamped once");
    ok((await dash(U.mia)).j?.me?.goals?.[0]?.actual === 1, "5 the verified introduction counts: 1 of 2");
    const self = await call("/enquiries/introduce", U.aina, "POST", { ...lead, phone: "+60 13-777 0202", name: "Encik Lee" });
    await call(`/enquiries/${self.j?.id}`, U.aina, "PATCH", { status: "qualified" });
    await setT(U.ceo, { scope: "person", user_id: U.aina, metric: "introductions", target_count: 3 });
    ok((await dash(U.aina)).j?.me?.goals?.find((g) => g.metric === "introductions")?.actual === 0, "an introduction its introducer qualified does not count");
    await setT(U.ceo, { scope: "person", user_id: U.aina, metric: "qualified_enquiries", target_count: 4 });
    ok((await dash(U.aina)).j?.me?.goals?.find((g) => g.metric === "qualified_enquiries")?.actual === 2, "qualified enquiries count for the person who qualified them");
    ok((await dash(U.aina)).j?.me?.target_cents === 600000, "a goal does not replace the revenue target");

    /* 9 + 10 a payment this week, and a repeated one */
    const before = (await dash(U.aina)).j.me.basis_cents;
    const p1 = await call("/staff/docs/103", U.ceo, "PATCH", { payment_status: "paid", paid_on: today });
    ok(p1.status === 200 && (await dash(U.aina)).j.me.basis_cents === before + 150000, "9 a paid invoice moves this week's progress", p1.text.slice(0, 200));
    await call("/staff/docs/103", U.ceo, "PATCH", { payment_status: "paid", paid_on: today });
    db.exec(`INSERT INTO invoice_payments (invoice_id, amount_cents, received_on, created_by) VALUES (100, 300000, '${from}', 1), (100, 300000, '${from}', 1)`);
    ok((await dash(U.aina)).j.me.basis_cents === before + 150000, "10 a repeated paid event or payment row does not count the invoice twice");
    ok((await call(`/staff/sales/week?week=${lastWeek}`, U.aina)).j?.me?.basis_cents === 70000, "9 last week is not touched by this week's payment");

    /* 11 commission */
    const led = JSON.stringify(db.prepare(`SELECT * FROM commission_ledger ORDER BY id`).all());
    await setT(U.ceo, { scope: "person", user_id: U.aina, target_cents: 99000000, reason: "Stretch target for the test" });
    await dash(U.aina); await dash(U.ceo);
    ok((await dash(U.aina)).j.me.status !== "achieved" && JSON.stringify(db.prepare(`SELECT * FROM commission_ledger ORDER BY id`).all()) === led, "11 far below target, her earned commission row is untouched");

    /* 12 tasks */
    const t1 = await call("/staff/tasks", U.coo, "POST", { title: "Revisit QT-104 with Kedai Dua", assigned_to: U.aina, link_kind: "quotation", link_id: 104, priority: "high" });
    const t2 = await call("/staff/tasks", U.coo, "POST", { title: "Revisit QT-104 again", assigned_to: U.aina, link_kind: "quotation", link_id: 104 });
    ok((t1.status === 200 || t1.status === 201) && t2.j?.existing === true && t2.j.id === t1.j?.id, "12 a linked sales task is made once in Tasks", `${t1.status} ${t1.text.slice(0, 120)} ${t2.text.slice(0, 120)}`);
    ok((await dash(U.aina)).j.me.top_tasks.some((t) => t.id === t1.j?.id), "12 the task shows on her card, from the Tasks table");
    const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND (name LIKE '%dashboard%' OR name LIKE '%kpi%' OR name LIKE '%lead%')`).all();
    ok(tables.length === 0, "no second target, KPI, lead or dashboard table", JSON.stringify(tables));

    /* the system accounts and customers */
    ok((await dash(U.shop)).status === 403, "a customer gets nothing");
    d = (await dash(U.root)).j;
    ok(d?.me === null && d.all, "a super admin monitors, with no personal target");
  } catch (e) {
    out.push([false, `runtime: ${e?.stack ?? e}`]);
  } finally {
    globalThis.Date = RealDate;
  }
  return out;
}

let fail = 0, n = 0;
const report = (list) => { for (const [p, m] of list) { n++; if (!p) { fail++; console.error(`FAIL ${m}`); } } };
const NOMUT = process.env.NOMUT === "1";
const dir = mkdtempSync(join(tmpdir(), "wdash-"));
bundle(root, "worker/src/index.ts", join(dir, "worker.mjs"));
report(await runtime(join(dir, "worker.mjs")));
const checks = n;

const MUT = [
  ["worker/src/weekly-sales.ts", "everyone gets every row", "  if (allowAll) {\n    const people = await staffList(env, from, to);", "  if (true) {\n    const people = await staffList(env, from, to);"],
  ["worker/src/weekly-sales.ts", "a goal row read as the revenue target", "AND COALESCE(t.metric, 'revenue') = ?4 AND", "AND ?4 = ?4 AND"],
  ["worker/src/weekly-sales.ts", "an introduction counts before it is qualified", "WHERE referred_by = ?1 AND qualified_at IS NOT NULL AND COALESCE(qualified_by, 0) != ?1 AND date(qualified_at, '+8 hours') BETWEEN ?2 AND ?3`,\n  };", "WHERE referred_by = ?1 AND date(created_at, '+8 hours') BETWEEN ?2 AND ?3`,\n  };"],
  ["worker/src/weekly-sales.ts", "a self-qualified introduction counts", "AND qualified_at IS NOT NULL AND COALESCE(qualified_by, 0) != ?1 AND date(qualified_at, '+8 hours') BETWEEN ?2 AND ?3`,\n  };", "AND qualified_at IS NOT NULL AND date(qualified_at, '+8 hours') BETWEEN ?2 AND ?3`,\n  };"],
  ["worker/src/weekly-sales.ts", "the company counts unpaid invoices", "FROM sales_documents d WHERE d.doc_type = 'INV' AND d.payment_status = 'paid' AND ${PAID_DAY} BETWEEN ?1 AND ?2`,\n  ).bind(from, to).first<{ c: number; n: number; k: number }>()", "FROM sales_documents d WHERE d.doc_type = 'INV' AND ${PAID_DAY} BETWEEN ?1 AND ?2`,\n  ).bind(from, to).first<{ c: number; n: number; k: number }>()"],
  ["worker/src/weekly-sales.ts", "the CCO sets targets", 'const isSetter = can(user.role, "sales_week_target");', 'const isSetter = can(user.role, "exec_view");'],
  ["worker/src/weekly-sales.ts", "a team row carries everything", "user_id: r.user_id, name: r.name, department, target_cents: r.target_cents, basis_cents: r.basis_cents, pct: r.pct, gap_cents: r.gap_cents, status: r.status,", "...r, department,"],
  ["worker/src/enquiries.ts", "qualifying stamps nothing", "try { await env.DB.prepare(`UPDATE enquiries SET qualified_at = COALESCE(qualified_at, datetime('now')), qualified_by = COALESCE(qualified_by, ?2) WHERE id = ?1`).bind(id, user.id).run(); } catch { /* pre-0156 */ }", "/* nothing */"],
  ["worker/src/enquiries.ts", "the same contact twice", 'if (dup) return err("duplicate"', 'if (false) return err("duplicate"'],
  ["worker/src/weekly-sales.ts", "other channels for everyone", 'const other = can(user.role, "revenue_view") ? await otherChannelsWeek(env, from, to) : null;', "const other = await otherChannelsWeek(env, from, to);"],
];
for (const [file, name, from, to] of NOMUT ? [] : MUT) {
  n++;
  const src = readFileSync(join(root, file), "utf8");
  if (!src.includes(from)) { fail++; console.error(`FAIL mutation did not apply: ${name}`); continue; }
  const mdir = mkdtempSync(join(tmpdir(), "wdash-m-"));
  cpSync(join(root, "worker"), join(mdir, "worker"), { recursive: true, filter: (p) => !p.includes("node_modules") });
  cpSync(join(root, "package.json"), join(mdir, "package.json"));
  for (const d of ["lib", "constants", "types"]) { try { cpSync(join(root, d), join(mdir, d), { recursive: true }); } catch { /* not every folder exists */ } }
  writeFileSync(join(mdir, file), src.replace(from, to));
  try { bundle(mdir, "worker/src/index.ts", join(mdir, "worker.mjs")); } catch { fail++; console.error(`FAIL mutation did not build: ${name}`); continue; }
  const res = await runtime(join(mdir, "worker.mjs"));
  if (!res.some(([p]) => !p)) { fail++; console.error(`FAIL mutation not caught: ${name}`); }
}
if (fail) { console.error(`weekly-dashboard: ${fail} of ${n} failed`); process.exit(1); }
console.log(`weekly-dashboard: ${checks} checks passed (${NOMUT ? "mutations skipped" : `${MUT.length} mutations caught`}) - one weekly engine on the Dashboard: the company's week for everyone, my target and goals, my team for an HOD, everyone for management; collected invoices only, once; commission untouched`);
