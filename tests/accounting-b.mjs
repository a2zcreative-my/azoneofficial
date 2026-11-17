/* ACCOUNTING WORKSPACE 5.0, PHASE B (v1.316.0) - runtime guard: the WHOLE
 * worker bundled against SQLite with every migration applied (0203
 * included), by direct request as each role through a real session - the
 * role is the server's, never the screen's. Fixed clock: Tuesday 10-11-2026,
 * 12:00 Malaysia time. Invented fixtures only - no production data.
 *
 * The CEO's "Approved as per recommendations both", 15-11-2026, then
 * "continue the rest" (claude/ACCOUNTING-WORKSPACE-5.0-BLUEPRINT.md):
 *   AC-1   the COO and CCO read the books; posting a journal, adding an
 *          account and reversing are the CEO and COO only (accounting_post);
 *          the admin, super admin and CCO read and never post; the COO does
 *          not reverse his own entry (the CEO does); only the CEO closes or
 *          reopens a month (books_close)
 *   B-1    a posted journal entry and its lines are kept as posted: the
 *          database refuses an UPDATE or DELETE (0203), a reversal still posts
 *   B-2    the ownership check counts the money records with no company
 *          (0197) and no review decision - a record that names its company
 *          is not "unassigned"
 *
 *   node tests/accounting-b.mjs              the current worker, then mutations
 *   NOMUT=1 node tests/accounting-b.mjs      the current worker only
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
  const entry = join(srcRoot, "accounting-b-entry.ts");
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
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(200).fill(0)]);

async function runtime(workerBundle, migDir) {
  const out = [];
  const ok = (c, m, why = "") => out.push([!!c, why && !c ? `${m} - ${why}` : m]);
  const db = new DatabaseSync(":memory:");
  const realClock = new DatabaseSync(":memory:");
  const pinTs = () => new Date().toISOString().slice(0, 19).replace("T", " ");
  for (const fn of ["datetime", "date", "time", "julianday"]) db.function(fn, { varargs: true }, (...a) => realClock.prepare(`SELECT ${fn}(${(a.length ? a : ["now"]).map(() => "?").join(",")}) AS v`).get(...(a.length ? a : ["now"]).map((x) => (typeof x === "string" && x.toLowerCase() === "now" ? pinTs() : x))).v);
  db.function("strftime", { varargs: true }, (...a) => realClock.prepare(`SELECT strftime(${a.map(() => "?").join(",")}) AS v`).get(...a.map((x, i) => (i > 0 && typeof x === "string" && x.toLowerCase() === "now" ? pinTs() : x))).v);
  const RealDate = globalThis.Date;
  const fixed = Date.parse("2026-11-10T04:00:00Z");
  globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [fixed])); } static now() { return fixed; } };
  applyAll(db, migDir);
  const shim = (sql) => { const st = db.prepare(sql); let b = []; const o = {
    bind: (...a) => { b = a.map((x) => (x === undefined ? null : x)); return o; },
    first: async () => st.get(...b) ?? null, all: async () => ({ results: st.all(...b) }),
    run: async () => ({ meta: { changes: Number(st.run(...b).changes) } }), _run: () => st.run(...b) }; return o; };
  const stored = new Map();
  const env = {
    DB: { prepare: shim, batch: async (list) => { db.exec("BEGIN"); try { for (const s of list) s._run(); db.exec("COMMIT"); } catch (e) { db.exec("ROLLBACK"); throw e; } return []; } },
    SESSION_PEPPER: "pepper", COMPANY_DOMAIN: "a2z.test", ALLOWED_ORIGINS: "https://portal.a2z.test",
    MEDIA: { put: async (k, body) => { if (body && typeof body === "object" && "getReader" in body) await new Response(body).arrayBuffer(); stored.set(k, true); }, get: async (k) => (stored.has(k) ? { body: "x", httpMetadata: { contentType: "image/png" } } : null), head: async () => null, list: async () => ({ objects: [] }), delete: async () => {} },
  };
  if (!globalThis.FixedLengthStream) globalThis.FixedLengthStream = class extends TransformStream { constructor() { super(); } };
  const U = { ceo: 1, sa: 2, coo: 3, admin: 4, cco: 5, aina: 6 };
  db.exec(`INSERT INTO users (id, name, full_name, email, role, is_active, password_hash, totp_enabled, totp_secret, employment_status, base_salary_cents, joined_on) VALUES
    (1,'Alif','Alif Owner','owner@a2z.test','ceo',1,'x',1,'JBSWY3DPEHPK3PXP','permanent',900000,'2024-01-01'),
    (2,'Root','System Root','root@a2z.test','super_admin',1,'x',1,'JBSWY3DPEHPK3PXP','permanent',0,'2024-01-01'),
    (3,'Ops','Ops Lead','ops@a2z.test','coo',1,'x',1,'JBSWY3DPEHPK3PXP','permanent',800000,'2024-01-01'),
    (4,'Adm','Admin Clerk','admin@a2z.test','admin',1,'x',1,'JBSWY3DPEHPK3PXP','permanent',300000,'2024-01-01'),
    (5,'Chief','Chief Commercial','cco@a2z.test','cco',1,'x',1,'JBSWY3DPEHPK3PXP','permanent',700000,'2024-01-01'),
    (6,'Aina','Aina Seller','aina@a2z.test','sales_marketing',1,'x',1,'JBSWY3DPEHPK3PXP','permanent',300000,'2024-01-01')`);
  db.exec(`INSERT INTO system_meta (key, value) VALUES ('company_owner', '{"user_id":1}')`);
  const app = (await import(pathToFileURL(workerBundle).href + `?v=${Math.random()}`)).default;
  const tok = {};
  for (const id of Object.values(U)) { tok[id] = `t-${id}-${Math.random()}`; db.prepare(`INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, datetime('now', '+12 hours'), datetime('now'))`).run(sha(tok[id]), id); }
  const hdr = (uid, extra = {}) => ({ origin: "https://portal.a2z.test", cookie: `azone_session=${tok[uid]}; csrf_token=c1`, "x-csrf-token": "c1", "content-type": "application/json", ...extra });
  const call = async (p, uid, method = "GET", body) => {
    const r = await app.fetch(new Request(`https://api.a2z.test/api/v1/staff${p}`, { method, headers: hdr(uid), body: body === undefined ? undefined : JSON.stringify(body) }), env, { waitUntil() {} });
    const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch { /* not json */ }
    return { status: r.status, j, text };
  };
  const n = (sql, ...a) => Number(db.prepare(sql).get(...a)?.n ?? 0);
  const row = (sql, ...a) => db.prepare(sql).get(...a);
  const fmt = (x) => JSON.stringify(x)?.slice(0, 300);
  const R = "Correcting the October bank charge";
  const acct = (code) => row(`SELECT id FROM gl_accounts WHERE code = ?`, code)?.id;
  const entry = (lines, date = "2026-10-20") => ({ entry_date: date, memo: "Bank charge reclass", lines });
  const pair = (cents) => [{ account_id: acct("6000"), debit: cents / 100 }, { account_id: acct("1100"), credit: cents / 100 }];
  const refused = (fn) => { try { fn(); return false; } catch (e) { return /kept as posted/.test(String(e)); } };
  try {
    ok(acct("1100") && acct("6000"), "the seeded chart has the bank and expense accounts", fmt([acct("1100"), acct("6000")]));

    /* ---------- AC-1: who reads ---------- */
    for (const [k, id] of [["ceo", U.ceo], ["coo", U.coo], ["cco", U.cco], ["admin", U.admin], ["super admin", U.sa]]) {
      ok((await call("/erp/gl/overview", id)).status === 200 && (await call("/erp/gl/journal", id)).status === 200, `AC-1 the ${k} reads the books`);
    }
    ok((await call("/erp/gl/overview", U.aina)).status === 403 && (await call("/erp/gl/journal", U.aina)).status === 403, "a salesperson has no books");

    /* ---------- AC-1: who posts ---------- */
    for (const [k, id] of [["admin", U.admin], ["super admin", U.sa], ["cco", U.cco], ["salesperson", U.aina]]) {
      const before = n(`SELECT COUNT(*) AS n FROM journal_entries`);
      const j = await call("/erp/gl/journal", id, "POST", entry(pair(1500)));
      const a = await call("/erp/gl/accounts", id, "POST", { code: `69${id}0`, name: "Not theirs", type: "expense" });
      ok(j.status === 403 && a.status === 403 && n(`SELECT COUNT(*) AS n FROM journal_entries`) === before && !row(`SELECT id FROM gl_accounts WHERE code = ?`, `69${id}0`), `AC-1 the ${k} posts no journal and adds no account`, fmt([j.status, a.status]));
    }
    const byCoo = await call("/erp/gl/journal", U.coo, "POST", entry(pair(2500)));
    const byCeo = await call("/erp/gl/journal", U.ceo, "POST", entry(pair(4000)));
    ok(byCoo.status === 201 && byCeo.status === 201, "AC-1 the CEO and COO post a balanced entry", fmt([byCoo.j, byCeo.j]));
    ok((await call("/erp/gl/accounts", U.coo, "POST", { code: "6950", name: "Courier", type: "expense" })).status === 201, "AC-1 the COO adds an account");

    /* ---------- AC-1: who reverses ---------- */
    for (const [k, id] of [["admin", U.admin], ["super admin", U.sa], ["cco", U.cco]]) {
      ok((await call(`/erp/gl/journal/${byCeo.j?.id}/reverse`, id, "POST", { reason: R })).status === 403, `AC-1 the ${k} never reverses`);
    }
    const own = await call(`/erp/gl/journal/${byCoo.j?.id}/reverse`, U.coo, "POST", { reason: R });
    ok(own.status === 403 && own.j?.error?.code === "self_approval", "AC-1 the COO does not reverse his own entry", fmt(own.j));
    ok((await call(`/erp/gl/journal/${byCeo.j?.id}/reverse`, U.coo, "POST", { reason: R })).status === 201, "AC-1 the COO reverses an entry somebody else posted");
    ok((await call(`/erp/gl/journal/${byCoo.j?.id}/reverse`, U.ceo, "POST", { reason: R })).status === 201, "AC-1 the CEO reverses the COO's entry");
    const revs = n(`SELECT COUNT(*) AS n FROM journal_entries WHERE ref LIKE 'REVJ-%'`);
    ok(revs === 2, "…two mirror entries, nothing else", String(revs));

    /* ---------- B-1: kept as posted ---------- */
    const id0 = byCeo.j?.id;
    ok(refused(() => db.exec(`UPDATE journal_entries SET memo = 'edited' WHERE id = ${id0}`)), "B-1 the database refuses to edit a posted entry");
    ok(refused(() => db.exec(`DELETE FROM journal_entries WHERE id = ${id0}`)), "B-1 …or to delete it");
    ok(refused(() => db.exec(`UPDATE journal_lines SET debit_cents = 1 WHERE entry_id = ${id0}`)), "B-1 …or to change a line");
    ok(refused(() => db.exec(`DELETE FROM journal_lines WHERE entry_id = ${id0}`)), "B-1 …or to delete a line");
    ok(row(`SELECT memo FROM journal_entries WHERE id = ?`, id0)?.memo === "Bank charge reclass" && n(`SELECT COUNT(*) AS n FROM journal_lines WHERE entry_id = ?`, id0) === 2, "B-1 the entry and its two lines are as posted");
    const tl = row(`SELECT SUM(debit_cents) AS d, SUM(credit_cents) AS c FROM journal_lines`);
    ok(tl && tl.d === tl.c && tl.d > 0, "B-1 every line posted still balances, the reversals included", fmt(tl));
    const mig = read("worker/migrations/0203_journal_append_only.sql").replace(/^--.*$/gm, "");
    ok(!/\b(ALTER|DROP|INSERT|DELETE FROM|UPDATE \w+ SET)\b/.test(mig) && (mig.match(/CREATE TRIGGER IF NOT EXISTS/g) ?? []).length === 4, "B-1 0203 adds four triggers and changes no table, column or row");

    /* ---------- AC-1: who closes ---------- */
    for (const [k, id] of [["coo", U.coo], ["cco", U.cco], ["admin", U.admin], ["super admin", U.sa]]) {
      ok((await call("/books/close", id, "POST", { month: "2026-10" })).status === 403, `AC-1 the ${k} does not close a month`);
    }
    ok(n(`SELECT COUNT(*) AS n FROM period_closes`) === 0, "…and nothing was closed");
    const cl = await call("/books/close", U.ceo, "POST", { month: "2026-10" });
    ok(cl.status === 201, "AC-1 the CEO closes an ended month", fmt(cl.j));
    ok((await call("/books/reopen", U.coo, "POST", { month: "2026-10", reason: "Late bank charge" })).status === 403, "AC-1 the COO does not reopen it");
    const ro = await call("/books/reopen", U.ceo, "POST", { month: "2026-10", reason: "Late bank charge" });
    ok(ro.status === 200, "AC-1 the CEO reopens it, with a reason", fmt([ro.status, ro.j]));
    ok(n(`SELECT COUNT(*) AS n FROM period_closes WHERE reopened_at IS NOT NULL`) === 1, "…the close stays on record, marked reopened");

    /* ---------- B-2: the ownership check reads the company columns ---------- */
    const own0 = async () => (await call("/erp/gl/month-end?month=2026-10", U.ceo)).j?.checks?.find((c) => c.key === "ownership")?.detail;
    const base0 = (await own0())?.unassigned;
    db.exec(`INSERT INTO bank_accounts (id, name, bank, number_masked, company, active) VALUES (31, 'A2Z - Maybank', 'Maybank', '•••• 5300', 'a2z', 1), (32, 'AZ ONE - Maybank', 'Maybank', '•••• 8811', 'azoo', 1)`);
    let d = await own0();
    ok(d?.readable === true && d.unassigned === base0, "B-2 accounts that name their company are not unassigned", fmt([base0, d]));
    db.exec(`INSERT INTO bank_accounts (id, name, bank, number_masked, company, active) VALUES (33, 'Old account', 'RHB', '•••• 0001', NULL, 1)`);
    d = await own0();
    ok(d?.unassigned === base0 + 1, "B-2 an account with no company and no decision is counted", fmt([base0, d]));
    db.exec(`INSERT INTO company_review_decisions (record_kind, record_id, proposed_company, source_json, reason, version, reviewed_by) VALUES ('bank_accounts', 33, 'a2z', '{}', 'Owner confirmed', 1, 1)`);
    d = await own0();
    ok(d?.unassigned === base0, "B-2 …and not once it has its decision", fmt([base0, d]));
    ok(n(`SELECT COUNT(*) AS n FROM bank_accounts WHERE company IS NULL`) === 1, "B-2 the check reads and assigns nothing");
  } catch (e) { ok(false, "the run threw", String(e?.stack ?? e).slice(0, 400)); }
  globalThis.Date = RealDate;
  return out;
}

let n = 0, fail = 0;
const report = (res) => { for (const [p, m] of res) { n++; if (!p) { fail++; console.error(`FAIL ${m}`); } } };
const dir = mkdtempSync(join(tmpdir(), "accounting-b-"));
const main = join(dir, "worker.mjs");
bundle(root, main);
report(await runtime(main, join(root, "worker/migrations")));
const checks = n;
if (process.env.NOMUT) {
  rmSync(dir, { recursive: true, force: true });
  if (fail) { console.error(`accounting-b: ${fail} of ${n} failed`); process.exit(1); }
  console.log(`accounting-b: ${n} checks passed`); process.exit(0);
}
if (fail) { console.error(`accounting-b: ${fail} of ${n} failed (mutations not run)`); process.exit(1); }

const MUT = [
  ["worker/src/permissions.ts", "AC-1 the admin posts again", `accounting_post: ["ceo", "coo"],`, `accounting_post: ["super_admin", "admin", "ceo", "coo"],`],
  ["worker/src/permissions.ts", "AC-1 the CCO posts", `accounting_post: ["ceo", "coo"],`, `accounting_post: ["ceo", "coo", "cco"],`],
  ["worker/src/permissions.ts", "AC-1 the COO closes a month", `books_close: ["ceo"],`, `books_close: ["ceo", "coo"],`],
  ["worker/src/permissions.ts", "AC-1 the CCO loses the books", `accounting_manage: ["super_admin", "admin", "ceo", "coo", "cco"],`, `accounting_manage: ["super_admin", "admin", "ceo"],`],
  ["worker/src/erp.ts", "AC-1 posting gated by the read permission", `if (path === "/gl/journal" && method === "POST") {\n      if (!canUser(user, "accounting_post"))`, `if (path === "/gl/journal" && method === "POST") {\n      if (!canUser(user, "accounting_manage"))`],
  ["worker/src/erp.ts", "AC-1 the COO reverses his own entry", `if (user.role !== "ceo" && entry.created_by === user.id) return err("self_approval"`, `if (false) return err("self_approval"`],
  ["worker/src/business.ts", "AC-1 a close gated by the read permission only", `    if (!canUser(user, "books_close")) return err("forbidden", "Only the CEO closes or reopens a month (AC-1)", 403);\n    const m = body?.month;\n    if (!validMonth(m))`, `    const m = body?.month;\n    if (!validMonth(m))`],
  ["worker/migrations/0203_journal_append_only.sql", "B-1 a line may be deleted", `CREATE TRIGGER IF NOT EXISTS journal_lines_no_delete BEFORE DELETE ON journal_lines\nBEGIN SELECT RAISE(ABORT, 'A posted journal line is kept as posted - reverse the entry instead'); END;`, ``],
  ["worker/migrations/0203_journal_append_only.sql", "B-1 an entry may be edited", `CREATE TRIGGER IF NOT EXISTS journal_entries_no_update BEFORE UPDATE ON journal_entries\nBEGIN SELECT RAISE(ABORT, 'A posted journal entry is kept as posted - reverse it instead'); END;`, ``],
  ["worker/src/ledger.ts", "B-2 a record that names its company still counted", `FROM bank_accounts s WHERE s.company IS NULL AND s.active = 1`, `FROM bank_accounts s WHERE s.active = 1`],
];
for (const [file, name, from, to] of MUT) {
  n++;
  const src = readFileSync(join(root, file), "utf8").replace(/\r\n/g, "\n");
  if (!src.includes(from)) { fail++; console.error(`FAIL mutation did not apply: ${name}`); continue; }
  const mdir = mkdtempSync(join(tmpdir(), "accounting-b-m-"));
  cpSync(join(root, "worker"), join(mdir, "worker"), { recursive: true, filter: (p) => !p.includes("node_modules") });
  cpSync(join(root, "package.json"), join(mdir, "package.json"));
  for (const d of ["lib", "constants", "types"]) { try { cpSync(join(root, d), join(mdir, d), { recursive: true }); } catch { /* not every folder exists */ } }
  writeFileSync(join(mdir, file), src.replace(from, to));
  try { bundle(mdir, join(mdir, "w.mjs")); } catch { fail++; console.error(`FAIL mutation did not build: ${name}`); continue; }
  const res = await runtime(join(mdir, "w.mjs"), join(mdir, "worker/migrations"));
  const bad = res.filter(([p]) => !p).map(([, m]) => m);
  if (!bad.length) { fail++; console.error(`FAIL mutation not caught: ${name}`); }
  else console.log(`caught: ${name} -> ${bad.slice(0, 2).join("; ")}`);
  rmSync(mdir, { recursive: true, force: true });
}
rmSync(dir, { recursive: true, force: true });
if (fail) { console.error(`accounting-b: ${fail} of ${n} failed`); process.exit(1); }
console.log(`accounting-b: ${checks} checks passed (${MUT.length} mutations caught) - Accounting 5.0 Phase B: the COO and CCO read the books, only the CEO and COO post or reverse (never their own), only the CEO closes; a posted entry is kept as posted; the ownership check reads the company columns`);
