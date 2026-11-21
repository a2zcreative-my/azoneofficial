/* PAYROLL ALLOWANCES (v1.412.0) - runtime guard: the WHOLE worker against SQLite, plus the screen's rules.
 * The CEO, 21-11-2026: named allowance types he sets up himself (parking, transport, ...) and a fixed monthly
 * amount of each per staff member, beside the basic, carried into the month's Allowance. His answers to
 * docs/PAYROLL-ALLOWANCES-STAGE-0-AUDIT.md D1-D8: "As recommended".
 *   D1 types = payroll_allowance_types (CEO, super admin)    D2 amounts = payroll_process
 *   D3 the payslip itemises from the breakdown saved on the row, only when it adds up
 *   D4/D5 the net formula does not change: one allowance term, never prorated, never in ORP / OT / unpaid leave
 *   D7 the setup pre-fills ONLY a person with no saved row; a saved, released or paid month is never moved by it
 *   node tests/payroll-allowances.mjs   (NOMUT=1 skips the mutations) */
import { readFileSync, readdirSync, mkdtempSync, writeFileSync, cpSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (f) => readFileSync(join(root, f), "utf8").replace(/\r\n/g, "\n");
const bundle = (srcRoot, entry, out) => execSync(`npx esbuild "${join(srcRoot, entry)}" --bundle --format=esm --platform=neutral --outfile="${out}" --log-level=error`, { cwd: root, stdio: "inherit" });
const sha = (s) => createHash("sha256").update(s).digest("hex");

async function runtime(workerBundle, base = root) {
  const out = [];
  const ok = (c, m, why = "") => out.push([!!c, why && !c ? `${m} - ${why}` : m]);
  const db = new DatabaseSync(":memory:");
  for (const f of readdirSync(join(base, "worker/migrations")).filter((x) => x.endsWith(".sql")).sort()) {
    for (const st of readFileSync(join(base, "worker/migrations", f), "utf8").split(/;\s*\n/)) { try { db.exec(st); } catch { /* a statement SQLite reads differently */ } }
  }
  const shim = (sql) => { const st = db.prepare(sql); let b = []; const o = {
    bind: (...a) => { b = a.map((x) => (x === undefined ? null : x)); return o; },
    first: async () => st.get(...b) ?? null, all: async () => ({ results: st.all(...b) }),
    run: async () => ({ meta: { changes: Number(st.run(...b).changes) } }), _run: () => st.run(...b) }; return o; };
  const env = {
    DB: { prepare: shim, batch: async (list) => { db.exec("BEGIN"); try { for (const s of list) s._run(); db.exec("COMMIT"); } catch (e) { db.exec("ROLLBACK"); throw e; } return []; } },
    SESSION_PEPPER: "pepper", COMPANY_DOMAIN: "azoneofficial.com", ALLOWED_ORIGINS: "https://portal.a2z.test",
    MEDIA: { put: async () => {}, head: async () => null, get: async () => null, list: async () => ({ objects: [] }) },
  };
  const U = { ceo: 1, coo: 2, admin: 7, super_admin: 8, customer: 9, hr: 4, aina: 5 };
  db.exec(`INSERT INTO users (id, name, email, role, is_active, password_hash, totp_enabled, totp_secret, base_salary_cents) VALUES
    (1,'Alif','alif@azoneofficial.com','ceo',1,'x',1,'JBSWY3DPEHPK3PXP',0),(2,'Ops','ops@azoneofficial.com','coo',1,'x',1,'JBSWY3DPEHPK3PXP',0),
    (4,'Hana','hana@azoneofficial.com','hr_admin',1,'x',1,'JBSWY3DPEHPK3PXP',200000),
    (5,'Aina Sofea binti Kamal','aina@azoneofficial.com','sales_marketing',1,'x',1,'JBSWY3DPEHPK3PXP',210000),
    (7,'Tech','tech@azoneofficial.com','admin',1,'x',1,'JBSWY3DPEHPK3PXP',0),(8,'Root','root@azoneofficial.com','super_admin',1,'x',1,'JBSWY3DPEHPK3PXP',0),
    (9,'Shop','shop@azoneofficial.com','customer',1,'x',0,NULL,0)`);
  const RealDate = globalThis.Date; const fixed = new RealDate("2026-11-21T02:00:00Z").getTime();
  globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [fixed])); } static now() { return fixed; } };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("{}", { status: 200 });
  const worker = (await import(pathToFileURL(workerBundle).href + `?v=${Math.random()}`)).default;
  const tok = {};
  for (const id of Object.values(U)) {
    tok[id] = `t-${id}-${Math.random()}`;
    db.prepare(`INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, datetime('now', '+12 hours'), datetime('now'))`).run(sha(tok[id]), id);
  }
  const call = async (path, uid, method = "GET", body) => {
    const headers = { "content-type": "application/json", origin: "https://portal.a2z.test", cookie: `azone_session=${tok[uid]}; csrf_token=c1`, "x-csrf-token": "c1" };
    const r = await worker.fetch(new Request(`https://api.a2z.test/api/v1${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined }), env);
    const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch { /* */ }
    return { status: r.status, j, text };
  };
  const entries = () => db.prepare(`SELECT user_id, month, basic_cents, allowance_cents, net_cents, allowance_items FROM payroll_entries ORDER BY user_id, month`).all();
  try {
    /* ---- reading the setup ---- */
    const g0 = await call("/staff/payroll/allowances", U.ceo);
    ok(g0.status === 200 && Array.isArray(g0.j?.types) && g0.j.types.length === 0 && g0.j.can_types === true, "the CEO reads the (empty) setup and may define types", g0.text.slice(0, 160));
    ok((await call("/staff/payroll/allowances", U.coo)).j?.can_types === false, "the COO reads it but may not define types (D1)");
    ok((await call("/staff/payroll/allowances", U.hr)).status === 403, "someone without payroll access cannot read it");

    /* ---- D1: only the CEO (and the super admin) define types ---- */
    for (const [who, uid] of [["COO", U.coo], ["admin", U.admin], ["HR", U.hr]]) {
      ok((await call("/staff/payroll/allowance-types", uid, "POST", { name_en: "Parking", name_ms: "Parkir" })).status === 403, `the ${who} cannot create an allowance type (D1)`);
    }
    const t1 = await call("/staff/payroll/allowance-types", U.ceo, "POST", { name_en: "Parking", name_ms: "Parkir" });
    ok(t1.status === 200 && t1.j?.id > 0, "the CEO creates Parking", t1.text.slice(0, 160));
    const t2 = await call("/staff/payroll/allowance-types", U.super_admin, "POST", { name_en: "Transport", name_ms: "Pengangkutan" });
    ok(t2.status === 200, "the super admin creates Transport (the technical account)");
    ok((await call("/staff/payroll/allowance-types", U.ceo, "POST", { name_en: "parking" })).status === 409, "a second type with the same name is refused");
    ok((await call("/staff/payroll/allowance-types", U.ceo, "POST", { name_en: "x" })).status === 400, "a one-letter name is refused");
    const P = t1.j.id, T = t2.j.id;
    ok((await call(`/staff/payroll/allowance-types/${P}`, U.ceo, "PATCH", { name_en: "Car park", version: 99 })).status === 409, "a rename from a stale version is refused");
    const ren = await call(`/staff/payroll/allowance-types/${P}`, U.ceo, "PATCH", { name_en: "Car park", name_ms: "Parkir kereta", version: 1 });
    ok(ren.status === 200 && db.prepare(`SELECT name_en FROM payroll_allowance_types WHERE id = ?`).get(P).name_en === "Car park", "the CEO renames from the current version");
    ok((await call(`/staff/payroll/allowance-types/${P}`, U.coo, "PATCH", { name_en: "Parking", version: 2 })).status === 403, "the COO cannot rename a type");

    /* ---- D2: each person's amounts, by whoever sets the basic; the setup never touches a payroll row ---- */
    const before = JSON.stringify(entries());
    const a1 = await call(`/staff/payroll/allowances/${U.aina}`, U.coo, "PUT", { amounts: { [P]: 15000, [T]: 10000 }, expected: {} });
    ok(a1.status === 200 && a1.j?.changed === 2, "the COO (payroll_process) sets Aina's Car park RM 150 and Transport RM 100 (D2)", a1.text.slice(0, 160));
    ok(JSON.stringify(entries()) === before, "setting an amount writes no payroll row (the month pre-fills on the screen; Save makes it a figure)");
    const ev = db.prepare(`SELECT kind, type_id, user_id, old_value, new_value, by_user FROM payroll_allowance_events WHERE kind = 'amount_set' ORDER BY id`).all();
    ok(ev.length === 2 && ev.every((e) => e.user_id === U.aina && e.old_value === "0" && e.by_user === U.coo), "each amount change is one history row with the old and new figure");
    ok(db.prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'payroll.allowance_update'`).get().n === 1, "and audited");
    ok((await call(`/staff/payroll/allowances/${U.aina}`, U.ceo, "PUT", { amounts: { [P]: 20000 }, expected: { [P]: 0 } })).status === 409, "an amount someone changed since the editor opened is refused, never overwritten");
    ok((await call(`/staff/payroll/allowances/${U.aina}`, U.ceo, "PUT", { amounts: { [P]: 20000 }, expected: { [P]: 15000 } })).status === 200, "from the current figure it saves");
    ok((await call(`/staff/payroll/allowances/${U.customer}`, U.ceo, "PUT", { amounts: { [P]: 100 }, expected: {} })).status === 400, "a customer is never given an allowance");
    ok((await call(`/staff/payroll/allowances/${U.aina}`, U.hr, "PUT", { amounts: { [P]: 100 }, expected: { [P]: 20000 } })).status === 403, "someone without payroll access cannot set one");
    ok((await call(`/staff/payroll/allowances/${U.aina}`, U.ceo, "PUT", { amounts: { [P]: -5 }, expected: { [P]: 20000 } })).status === 400, "a negative amount is refused");
    const g1 = await call("/staff/payroll/allowances", U.coo);
    ok(g1.j?.amounts?.filter((a) => a.user_id === U.aina).reduce((s, a) => s + a.amount_cents, 0) === 30000, "the read returns Aina's two amounts (RM 300 a month)");

    /* ---- retire, never delete ---- */
    const ver = db.prepare(`SELECT version FROM payroll_allowance_types WHERE id = ?`).get(T).version;
    ok((await call(`/staff/payroll/allowance-types/${T}`, U.ceo, "PATCH", { active: false, version: ver })).status === 200, "the CEO retires Transport");
    ok((await call(`/staff/payroll/allowances/${U.hr}`, U.ceo, "PUT", { amounts: { [T]: 5000 }, expected: {} })).status === 400, "nobody is given an amount of a retired type");
    /* a type nobody holds, so only the trigger (not a foreign key) can stop the delete */
    const M = (await call("/staff/payroll/allowance-types", U.ceo, "POST", { name_en: "Meal", name_ms: "Makan" })).j?.id;
    let threw = false; try { db.exec(`DELETE FROM payroll_allowance_types WHERE id = ${M}`); } catch { threw = true; }
    ok(threw, "an allowance type is never deleted (trigger)");
    threw = false; try { db.exec(`UPDATE payroll_allowance_events SET new_value = '1'`); } catch { threw = true; }
    ok(threw, "the allowance history is never edited (trigger)");
    threw = false; try { db.exec(`DELETE FROM payroll_allowance_events`); } catch { threw = true; }
    ok(threw, "nor deleted");

    /* ---- D3: the breakdown frozen on a SAVED row, only when it adds up ---- */
    const row = (extra) => ({ user_id: U.aina, month: "2026-11", basic_cents: 210000, commission_cents: 0, allowance_cents: 25000, deduction_cents: 0, net_cents: 235000, ...extra });
    const items = [{ type_id: P, name: "Car park", cents: 20000 }, { type_id: 0, name: "Other allowance", cents: 5000 }];
    const s1 = await call("/staff/payroll", U.ceo, "POST", row({ allowance_items: items }));
    const e1 = db.prepare(`SELECT allowance_cents, allowance_items FROM payroll_entries WHERE user_id = ? AND month = '2026-11'`).get(U.aina);
    ok(s1.status === 200 && e1?.allowance_cents === 25000 && JSON.parse(e1.allowance_items ?? "[]").length === 2, "Save keeps allowance_cents as THE figure and freezes the breakdown beside it", s1.text.slice(0, 160));
    await call("/staff/payroll", U.ceo, "POST", row({ allowance_cents: 30000, net_cents: 240000, allowance_items: items }));
    ok(db.prepare(`SELECT allowance_items FROM payroll_entries WHERE user_id = ? AND month = '2026-11'`).get(U.aina).allowance_items === null, "a breakdown that does not add up to the allowance is not stored (the slip prints one line)");
    await call("/staff/payroll", U.ceo, "POST", row({ allowance_items: items }));
    await call("/staff/payroll", U.ceo, "POST", row({}));
    ok(db.prepare(`SELECT allowance_items FROM payroll_entries WHERE user_id = ? AND month = '2026-11'`).get(U.aina).allowance_items === null, "a later Save without a breakdown clears the old one - it never outlives the figure");

    /* ---- the release locks still hold ---- */
    const old = await call("/staff/payroll", U.ceo, "POST", row({ month: "2026-09", allowance_items: items }));
    ok(old.status === 409 && !db.prepare(`SELECT 1 FROM payroll_entries WHERE month = '2026-09'`).get(), "a released month refuses the Save, breakdown and all", old.text.slice(0, 160));
    /* Recompute never reads the setup: it keeps the row's own allowance */
    db.exec(`UPDATE payroll_entries SET allowance_cents = 12345 WHERE user_id = ${U.aina} AND month = '2026-11'`);
    await call("/staff/payroll/recompute", U.ceo, "POST", { month: "2026-11" });
    ok(db.prepare(`SELECT allowance_cents FROM payroll_entries WHERE user_id = ? AND month = '2026-11'`).get(U.aina).allowance_cents === 12345, "Recompute keeps the saved allowance - a setup change never reaches a saved month by itself");
  } catch (e) {
    out.push([false, `runtime: ${e?.stack ?? e}`]);
  } finally {
    globalThis.Date = RealDate;
    globalThis.fetch = realFetch;
  }
  return out;
}

/* ---- the screen and the source ---- */
function statics() {
  const out = [];
  const ok = (c, m) => out.push([!!c, m]);
  const mod = read("worker/src/payroll-allowances.ts");
  const mig = read("worker/migrations/0231_payroll_allowances.sql");
  const panel = read("components/portal/payroll-panel.tsx");
  const perms = read("worker/src/permissions.ts");
  ok(!/(INSERT INTO|UPDATE|DELETE FROM)\s+payroll_entries/.test(mod), "the allowance module never writes a payroll row");
  ok(!/\bDROP\b|ALTER TABLE (?!payroll_entries ADD COLUMN allowance_items)/i.test(mig.replace(/--.*$/gm, "")), "0231 is additive: new tables, triggers and one nullable column");
  ok(/payroll_allowance_types: \["super_admin", "ceo"\]/.test(perms) && /key: "payroll_allowance_types"[^}]*cap: "payroll_allowance_types"/.test(perms), "D1: the type capability is the CEO's (and the super admin's) and is on the Roles & Permissions catalogue");
  /* the net formula is the one it was: allowance is ONE term */
  ok(/return Math\.max\(0, e\.basic_cents \+ phW \+ e\.commission_cents \+ e\.allowance_cents \+ ot - e\.deduction_cents - ulDed - adj - advance\);/.test(panel), "netFor keeps one allowance term (D4/D5)");
  ok(/const adj = incFor\(id, e\.basic_cents\);/.test(panel) && /const ot = otPay\(e\.basic_cents, e\.ot_hours\);/.test(panel), "the incomplete month and overtime stay on the basic only - an allowance is never prorated or in ORP");
  /* D7: the pre-fill reaches only a person with no saved row, and the snapshot agrees so nothing reads as changed */
  ok(/entries\[id\] \?\? \{ user_id: id, basic_cents: base\[id\] \?\? 0, commission_cents: 0, allowance_cents: allowTot\[id\] \?\? 0, deduction_cents: 0 \}/.test(panel), "an unsaved month pre-fills Allowance from the setup, as Basic does from the base");
  ok(/const e = loadedEntries\[u\.id\] \?\? \{ user_id: u\.id, basic_cents: bmap\[u\.id\] \?\? 0, commission_cents: 0, allowance_cents: atot\[u\.id\] \?\? 0, deduction_cents: 0 \}/.test(panel), "the pristine snapshot uses the same pre-fill, so an untouched row is never dirty");
  ok(/export function allowTotals[\s\S]{0,200}filter\(\(t\) => t\.active\)/.test(panel), "only ACTIVE types fill a month");
  /* D7: the editor's carry - present month, never past or released; a hand-typed allowance is kept */
  ok(/if \(pastMonth \|\| release\?\.released\) \{ held\.push\(u\.name\); continue; \}/.test(panel), "a past or released month is left as saved when the setup changes");
  ok(/const allowNext = allowChanged && allowFollows \? newTotOf\(u\.id\) : cur\.allowance_cents;/.test(panel) && /const allowFollows = cur\.allowance_cents === oldTotOf\(u\.id\);/.test(panel), "a saved row takes the new allowance only while it still equals the old setup total");
  ok(/net_cents: netFor\(u\.id, next\)/.test(panel), "the carried row is priced by netFor, the one formula");
  /* D3: the slip itemises only when the items add up, else the single line */
  ok(/items\.reduce\(\(a, b\) => a \+ b\.cents, 0\) === e\.allowance_cents;\s*if \(!ok\) return \[\["ALLOWANCE", e\.allowance_cents\]\];/.test(panel), "the payslip itemises only a breakdown that adds up, otherwise the one ALLOWANCE line");
  ok(/earnings\.push\(\.\.\.allowanceLines\(e\)\);/.test(panel) && !/earnings\.push\(\["ALLOWANCE", e\.allowance_cents\]\)/.test(panel), "payslipData draws the allowance through allowanceLines (Print and the PDF share it)");
  return out;
}

let fail = 0, n = 0;
const report = (list) => { for (const [p, m] of list) { n++; if (!p) { fail++; console.error(`FAIL ${m}`); } } };
const NOMUT = process.env.NOMUT === "1";
const dir = mkdtempSync(join(tmpdir(), "pallow-"));
bundle(root, "worker/src/index.ts", join(dir, "worker.mjs"));
report(await runtime(join(dir, "worker.mjs")));
report(statics());
const checks = n;
const MUT = [
  ["worker/src/payroll-allowances.ts", "anyone with payroll access defines types", `    if (!canUser(user, "payroll_allowance_types")) return err("forbidden", "Only the CEO sets up allowance types", 403);\n    const en = nameOf(body?.name_en);`, `    const en = nameOf(body?.name_en);`],
  ["worker/src/payroll-allowances.ts", "a stale amount overwrites", `      if (exp !== from) return err("changed", "Someone changed these allowances - reload and try again", 409);\n`, ""],
  ["worker/src/payroll-allowances.ts", "a breakdown that does not add up is stored", "return items.reduce((a, b) => a + b.cents, 0) === allowanceCents ? JSON.stringify(items) : null;", "return JSON.stringify(items);"],
  ["worker/src/payroll-allowances.ts", "a retired type still takes amounts", "      if (!t.active && to > 0) return err(", "      if (false && to > 0) return err("],
  ["worker/migrations/0231_payroll_allowances.sql", "a type can be deleted", "CREATE TRIGGER IF NOT EXISTS payroll_allowance_types_no_delete BEFORE DELETE ON payroll_allowance_types\nBEGIN SELECT RAISE(ABORT, 'an allowance type is never deleted - retire it'); END;", ""],
];
for (const [file, name, from, to] of NOMUT ? [] : MUT) {
  n++;
  const src = read(file);
  if (!src.includes(from)) { fail++; console.error(`FAIL mutation did not apply: ${name}`); continue; }
  const mdir = mkdtempSync(join(tmpdir(), "pallow-m-"));
  cpSync(join(root, "worker"), join(mdir, "worker"), { recursive: true, filter: (p) => !p.includes("node_modules") });
  cpSync(join(root, "package.json"), join(mdir, "package.json"));
  for (const d of ["lib", "constants", "types"]) { try { cpSync(join(root, d), join(mdir, d), { recursive: true }); } catch { /* not every folder exists */ } }
  writeFileSync(join(mdir, file), src.replace(from, to));
  try { bundle(mdir, "worker/src/index.ts", join(mdir, "worker.mjs")); } catch { fail++; console.error(`FAIL mutation did not build: ${name}`); continue; }
  const res = await runtime(join(mdir, "worker.mjs"), mdir); // a migration mutation runs on the copy's migrations
  if (!res.some(([p]) => !p)) { fail++; console.error(`FAIL mutation not caught: ${name}`); }
}
if (fail) { console.error(`payroll-allowances: ${fail} of ${n} failed`); process.exit(1); }
console.log(`payroll-allowances: ${checks} checks passed (${NOMUT ? "mutations skipped" : `${MUT.length} mutations caught`}) - allowance types are the CEO's, amounts sit beside the basic, and no saved month moves`);
