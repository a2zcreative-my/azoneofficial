/* v1.401.0 - SALES COMMAND CENTER, PHASE 5: COLLECTIONS (the CEO, 21-11-2026, "As recommended" on the seven
 * Phase 5 decisions). worker/src/collections.ts - a pure read. Runtime guard on the tasks-gate4 harness: the
 * WHOLE worker bundled against SQLite with every migration, by direct request, then broken copies.
 *
 *   - every unpaid invoice (not paid, not void), with the balance by VERIFIED money only (invoice_payments,
 *     voided rows not counted); a reported payment waits beside it and is never deducted
 *   - its age bucket (0-30 / 31-60 / 61-90 / 90+), its collector (the salesperson) and its open collection
 *     follow-up (one per invoice, the existing customer follow-up with doc_id) with one flag
 *   - Mine for everyone; Everyone only on the GET /payments "all" rule; nobody else sees another's invoices
 *   - a deal's invoices: Invoiced / Part paid / Paid (CEO verified), amounts only for someone who may read them
 *   - reads only: nothing in the database changes; agents, live hosts and a write are refused
 *
 *   node tests/collections.mjs
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
  const entry = join(srcRoot, "collections-entry.ts");
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
  for (let c = 1; c <= 6; c++) db.exec(`INSERT INTO customers (id, company, phone, created_by, created_at) VALUES (${c}, 'Client ${c} Sdn Bhd', '01220000${c}', 5, '2026-10-01 01:00:00')`);
  const inv = db.prepare(`INSERT INTO sales_documents (id, doc_type, doc_number, customer_id, items, discount_cents, tax_percent, total_cents, payment_status, due_date, created_at, created_by, salesperson_id, kind, issuer_code, converted_from) VALUES (?, 'INV', ?, ?, '[]', 0, 0, ?, ?, ?, ?, 5, ?, 'service', 'a2z', ?)`);
  //      id   number       cust total   status     due           created                sp  from
  inv.run(901, "INV-C-901", 1, 100000, "unpaid", "2026-11-30", "2026-11-05 01:00:00", 5, null);   // 5 days old, Aina's
  inv.run(902, "INV-C-902", 2, 200000, "unpaid", "2026-10-01", "2026-09-01 01:00:00", 5, null);   // 70 days, past due, part paid
  inv.run(903, "INV-C-903", 3, 300000, "overdue", null, "2026-07-01 01:00:00", 9, null);          // 132 days, Bakar's
  inv.run(904, "INV-C-904", 4, 400000, "paid", null, "2026-10-01 01:00:00", 5, null);             // paid: not listed
  inv.run(905, "INV-C-905", 5, 500000, "void", null, "2026-10-01 01:00:00", 5, null);             // void: not listed
  inv.run(906, "INV-C-906", 6, 600000, "unpaid", null, "2026-10-11 01:00:00", 5, null);           // exactly 30 days
  inv.run(907, "INV-C-907", 6, 700000, "unpaid", null, "2026-10-10 01:00:00", 5, null);           // 31 days
  db.exec(`INSERT INTO invoice_payments (invoice_id, amount_cents, received_on) VALUES (902, 50000, '2026-10-05'), (902, 30000, '2026-10-06')`);
  db.exec(`INSERT INTO invoice_payments (invoice_id, amount_cents, received_on, voided_at) VALUES (902, 99999, '2026-10-07', '2026-10-08')`);
  db.exec(`INSERT INTO invoice_payment_reports (invoice_id, issuer_code, amount_cents, received_on, method, state, reported_by) VALUES (901, 'a2z', 40000, '2026-11-08', 'bank_transfer', 'reported', 5), (901, 'a2z', 1000, '2026-11-08', 'bank_transfer', 'rejected', 5)`);
  db.exec(`INSERT INTO customer_followups (id, customer_id, due_on, owner_id, note, created_by, doc_id) VALUES (1, 3, '2026-11-09', 9, 'Chase INV-C-903', 9, 903)`);
  /* a won deal whose quotation became 902 (part paid) and 904 (paid, CEO confirmed) */
  db.exec(`INSERT INTO sales_documents (id, doc_type, doc_number, customer_id, items, discount_cents, tax_percent, total_cents, created_at, created_by, salesperson_id, kind, issuer_code) VALUES (950, 'QT', 'QT-C-950', 2, '[]', 0, 0, 600000, '2026-08-01 01:00:00', 5, 5, 'service', 'a2z')`);
  db.exec(`UPDATE sales_documents SET converted_from = 950 WHERE id IN (902, 904)`);
  db.exec(`INSERT INTO invoice_paid_confirmations (invoice_id, amount_cents, confirmed_by) VALUES (904, 400000, 1)`);
  db.exec(`INSERT INTO sales_opportunities (id, customer_id, title, owner_id, stage, won_basis, client_key, created_by, closed_at) VALUES (1, 2, 'Won deal', 5, 'won', 'invoice', 'won1', 5, datetime('now'))`);
  db.exec(`INSERT INTO opportunity_quotations (opportunity_id, doc_id, linked_by) VALUES (1, 950, 5)`);

  const app = (await import(pathToFileURL(workerBundle).href + `?v=${Math.random()}`)).default;
  const tok = {};
  for (const id of Object.values(U)) { tok[id] = `t-${id}-${Math.random()}`; db.prepare(`INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, datetime('now', '+12 hours'), datetime('now'))`).run(sha(tok[id]), id); }
  const hdr = (uid) => ({ origin: "https://portal.a2z.test", cookie: `azone_session=${tok[uid]}; csrf_token=c1`, "x-csrf-token": "c1", "content-type": "application/json" });
  const call = async (p, uid, method = "GET", body) => {
    const r = await app.fetch(new Request(`https://api.a2z.test/api/v1/staff${p}`, { method, headers: hdr(uid), body: body === undefined ? undefined : JSON.stringify(body) }), env, { waitUntil() {} });
    const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch { /* not json */ }
    return { status: r.status, j, text };
  };
  const snap = () => sha(["sales_documents", "invoice_payments", "invoice_payment_reports", "invoice_paid_confirmations", "cash_book", "journal_entries", "commission_ledger", "customer_followups", "sales_opportunities", "audit_log"].map((t) => { try { return JSON.stringify(db.prepare(`SELECT * FROM "${t}"`).all()); } catch { return "-"; } }).join("|"));
  try {
    const before = snap();
    for (const [who, uid] of [["live host", U.host], ["agent", U.agent]]) ok((await call("/collections", uid)).status === 403, `a ${who} is refused`);
    ok((await call("/collections", U.coo, "POST", {})).status === 405, "collections only reads");

    const mine = await call("/collections?scope=all", U.aina);
    const ids = (mine.j?.items ?? []).map((i) => i.id).sort();
    ok(mine.status === 200 && mine.j.scope === "mine" && mine.j.can_all === false && JSON.stringify(ids) === JSON.stringify([901, 902, 906, 907]), "a consultant sees only the invoices they sold, even when asking for everyone", JSON.stringify(ids));
    const all = await call("/collections?scope=all", U.coo);
    const by = Object.fromEntries((all.j?.items ?? []).map((i) => [i.id, i]));
    ok(all.j?.scope === "all" && Object.keys(by).sort().join() === "901,902,903,906,907", "the COO sees every unpaid invoice; paid and void are never listed", Object.keys(by).join());
    ok((await call("/collections", U.coo)).j?.scope === "mine", "Mine is the default, for management too");

    ok(by[902]?.verified_cents === 80000 && by[902].balance_cents === 120000, "the balance counts verified money only - a voided payment is not counted", JSON.stringify(by[902] && [by[902].verified_cents, by[902].balance_cents]));
    ok(by[901]?.waiting_cents === 40000 && by[901].balance_cents === 100000, "a reported payment waits beside the balance and is never deducted; a rejected one is not waiting", JSON.stringify(by[901] && [by[901].waiting_cents, by[901].balance_cents]));
    ok(by[901]?.bucket === "0_30" && by[906]?.bucket === "0_30" && by[906].age_days === 30 && by[907]?.bucket === "31_60" && by[902]?.bucket === "61_90" && by[903]?.bucket === "90_plus", "age buckets: 30 days is 0-30, 31 is 31-60", JSON.stringify(Object.values(by).map((i) => [i.id, i.age_days, i.bucket])));
    ok(by[902]?.invoice_overdue === true && by[903]?.invoice_overdue === true && by[901]?.invoice_overdue === false, "an invoice past its due date or marked overdue says so");
    ok(by[903]?.flag === "overdue" && by[903].followup?.id === 1 && by[901]?.flag === "no_next", "an open collection follow-up gives the flag: overdue when its day has passed, No follow-up when none");
    ok(by[903]?.collector === "Bakar Seller" && by[903].collector_id === U.bakar, "the collector is the invoice's salesperson");
    ok(all.j.summary.balance_cents === 100000 + 120000 + 300000 + 600000 + 700000 && all.j.summary.buckets["90_plus"].n === 1, "the summary counts the rows", JSON.stringify(all.j.summary));

    const bk = await call("/customers/1/followups", U.aina, "POST", { due_on: "2026-11-10", note: "Collect INV-C-901", doc_id: 901 });
    const after = (await call("/collections", U.aina)).j?.items?.find((i) => i.id === 901);
    ok(bk.status === 201 && after?.flag === "today" && after.followup?.note === "Collect INV-C-901", "booking the existing follow-up on the invoice gives it its next action", bk.text.slice(0, 120));
    const before2 = snap();

    const dA = await call("/collections/deal/1", U.aina), dB = await call("/collections/deal/1", U.bakar);
    const sA = Object.fromEntries((dA.j?.invoices ?? []).map((i) => [i.id, i]));
    ok(sA[902]?.status === "part_paid" && sA[902].verified_cents === 80000 && sA[904]?.status === "paid_verified", "a deal's invoices: Part paid (verified) and Paid (CEO verified)", dA.text.slice(0, 200));
    ok((dB.j?.invoices ?? []).length === 2 && dB.j.invoices.every((i) => i.total_cents === undefined && i.verified_cents === undefined), "someone who may not read those invoices' payments gets the words, never the amounts", dB.text.slice(0, 200));

    ok(snap() === before2, "reading collections and a deal's payments changes nothing in the database");
    ok(before !== before2, "(the follow-up booking above is the only write)");
  } catch (e) { ok(false, "the run threw", String(e?.stack ?? e).slice(0, 500)); }
  globalThis.Date = RealDate;
  return out;
}

let n = 0, fail = 0;
const report = (res, tag = "") => { for (const [p, m] of res) { n++; if (!p) { fail++; console.error(`FAIL ${tag}${m}`); } } };
const s = (c, m) => report([[c, m]]);
const co = read("worker/src/collections.ts"), ui = read("components/portal/collections.tsx"), pay = read("components/portal/payments-panel.tsx");
s(!/\b(INSERT|UPDATE|DELETE)\b/.test(co.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")), "collections.ts writes nothing");
s(!/\/staff\/payments|payment-reports|\/paid|confirm/.test(ui.replace(/\/\*[\s\S]*?\*\//g, "")), "the Collections screen never reports, verifies or marks paid");
s(/records nothing/.test(ui) && /never as paid|not counted as paid/.test(ui), "the screen says WhatsApp and Call record nothing, and a report is not paid");
s(/tab === "collections" && <CollectionsPanel/.test(pay), "Collections is a tab of Payments");

const dir = mkdtempSync(join(tmpdir(), "collections-"));
const main = join(dir, "worker.mjs");
bundle(root, main);
report(await runtime(main, join(root, "worker/migrations")));
const checks = n;

const MUTANTS = [
  ["a reported payment counts as paid", "worker/src/collections.ts", "const balance = Math.max(0, Number(r.total_cents) - verified);", "const balance = Math.max(0, Number(r.total_cents) - verified - (pend.get(r.id) ?? 0));"],
  ["a voided payment counts", "worker/src/collections.ts", "FROM invoice_payments p WHERE p.invoice_id = d.id AND p.voided_at IS NULL), 0) AS verified_cents,\n              f.id", "FROM invoice_payments p WHERE p.invoice_id = d.id), 0) AS verified_cents,\n              f.id"],
  ["a consultant sees everyone", "worker/src/collections.ts", `const scope = params.get("scope") === "all" && all ? "all" : "mine";`, `const scope = params.get("scope") === "all" ? "all" : "mine";`],
  ["paid invoices are listed", "worker/src/collections.ts", "NOT IN ('paid', 'void') AND (?1 = 1", "NOT IN ('void') AND (?1 = 1"],
  ["30 days falls in 31-60", "worker/src/collections.ts", `(age <= 30 ? "0_30"`, `(age < 30 ? "0_30"`],
  ["amounts shown to anyone", "worker/src/collections.ts", "const mayRead = (sp: number | null) => all || sp === user.id;", "const mayRead = (_sp: number | null) => true;"],
  ["a rejected report waits", "worker/src/payment-verify.ts", `export const PENDING = ["reported", "evidence_checked", "clarify"];`, `export const PENDING = ["reported", "evidence_checked", "clarify", "rejected"];`],
  ["the follow-up is ignored", "worker/src/collections.ts", `const flag = r.fu_due ?`, `const flag = false ?`],
];
let caught = 0;
for (const [name, file, from, to] of MUTANTS) {
  const m = mkdtempSync(join(tmpdir(), "collections-m-"));
  cpSync(join(root, "worker"), join(m, "worker"), { recursive: true });
  cpSync(join(root, "lib"), join(m, "lib"), { recursive: true });
  cpSync(join(root, "package.json"), join(m, "package.json"));
  const body = readFileSync(join(m, file), "utf8").replace(/\r\n/g, "\n"); // a Windows checkout has CRLF; the mutations are written with \n
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
if (fail) { console.error(`collections: ${fail} of ${n} failed`); process.exit(1); }
console.log(`PASS - collections: every unpaid invoice with its verified balance (a reported payment waits, never deducted), its age bucket, collector and next collection follow-up; Mine by default, Everyone only on the Payments rule; a deal's payment status without amounts for those who may not read them; reads only (${checks} checks, ${caught}/${MUTANTS.length} mutations caught)`);
