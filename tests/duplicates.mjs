/* THE DUPLICATE-FUNCTION AUDIT, FIXED (v1.317.0) - claude/DUPLICATION-AUDIT-1.316.0.md;
 * the CEO, 15-11-2026: "fix the issue as per recommended".
 *
 * Runtime half: the WHOLE worker bundled against SQLite with every migration
 * applied, by direct request through real sessions (the role is the server's).
 * Fixed clock: Tuesday 10-11-2026, 12:00 Malaysia time. Invented fixtures only.
 *
 *   D-1  the third profit sum is gone: GET /staff/finance/pnl answers nothing
 *   D-2  the Dashboard's company card draws no copy of another tab's screen
 *        (overtime decisions, the live schedule, the client list): each figure
 *        opens its home tab; live-cards.tsx is gone and PUSH.bat removes it
 *   D-3  ONE PACKAGE LIST: the public Packages page shows the active packages
 *        the CEO marks in the library - their own name and item names, a
 *        price label or the package total. The earlier hand-typed card is
 *        kept, never edited (its routes are gone), shown only until the first
 *        package is marked, and never comes back after that. The CEO and
 *        super admin only; an active package only; six at most
 *   D-4  the Inventory row says when the store charges something other than
 *        the list price, from the store's own rule (priceState)
 *   D-7  one trial balance and one journal list (the erp.ts twins are gone);
 *        tests/accounting-v2.mjs holds the figures
 *
 *   node tests/duplicates.mjs              the current worker, then mutations
 *   NOMUT=1 node tests/duplicates.mjs      the current worker only
 */
import { readFileSync, readdirSync, mkdtempSync, cpSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");
const bundle = (srcRoot, out) => {
  const entry = join(srcRoot, "duplicates-entry.ts");
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

async function runtime(workerBundle, migDir, srcRoot = root) {
  const read = (f) => readFileSync(join(srcRoot, f), "utf8").replace(/\r\n/g, "\n");
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
  const pub = async () => { const r = await app.fetch(new Request("https://api.a2z.test/api/v1/packages", { headers: { origin: "https://portal.a2z.test" } }), env, { waitUntil() {} }); return (await r.json().catch(() => null))?.packages ?? null; };
  const LEGACY = JSON.stringify([{ name: "Starter (typed by hand)", price_label: "From RM 900", points: ["Old point"] }]);
  const mk = async (name, cents, status = "active") => (await call("/packages", U.ceo, "POST", { name, issuers: ["a2z"], status, items: [{ name: `${name} setup`, qty: 1, unit_price_cents: cents }, { name: `${name} support`, qty: 1, unit_price_cents: 10000 }] })).j?.id;
  const mark = (id, uid, on = true, label) => call(`/packages/${id}/public`, uid, "POST", { on, ...(label === undefined ? {} : { price_label: label }) });
  try {
    /* ---------- D-1, D-3: the retired routes answer nothing ---------- */
    ok((await call("/finance/pnl", U.ceo)).status === 404, "D-1 the third profit sum is gone (GET /staff/finance/pnl)");
    ok((await call("/sales/packages", U.ceo)).status === 404 && (await call("/sales/packages", U.ceo, "POST", { packages: [{ name: "X", price_label: "RM 1", points: [] }] })).status === 404, "D-3 the hand-typed rate card can no longer be read or edited from the portal");

    /* ---------- D-3: nothing changes on the day it is deployed ---------- */
    db.prepare(`INSERT INTO system_meta (key, value) VALUES ('packages_json', ?)`).run(LEGACY);
    let p = await pub();
    ok(Array.isArray(p) && p.length === 1 && p[0].name === "Starter (typed by hand)", "D-3 until a package is marked, the public page shows the earlier card as it was", fmt(p));
    const A = await mk("Live Commerce", 150000), B = await mk("Branding", 80000), D = await mk("Draft Pack", 5000, "draft");
    ok(A && B && D, "three packages in the library", fmt([A, B, D]));
    p = await pub();
    ok(p?.[0]?.name === "Starter (typed by hand)", "D-3 a package in the library is not public by itself");
    let lib = (await call("/packages", U.ceo)).j;
    ok(lib?.can_publish === true && lib.public_showing === 0 && lib.legacy_public_tiers === 1 && lib.packages.every((x) => x.public === false), "D-3 the CEO is told the page still shows the earlier card (1 tier)", fmt({ c: lib?.can_publish, s: lib?.public_showing, l: lib?.legacy_public_tiers }));
    lib = (await call("/packages", U.coo)).j;
    ok(lib?.can_publish === false && !("legacy_public_tiers" in lib), "D-3 the COO manages packages and does not choose the public page");

    /* ---------- D-3: who marks, and what ---------- */
    for (const [k, id] of [["coo", U.coo], ["cco", U.cco], ["admin", U.admin], ["salesperson", U.aina]]) ok((await mark(A, id)).status === 403, `D-3 the ${k} cannot put a package on the public page`);
    ok((await pub())?.[0]?.name === "Starter (typed by hand)", "…and the refusals changed nothing");
    ok((await mark(D, U.ceo)).status === 409, "D-3 a draft is not shown publicly");
    ok((await call(`/packages/${A}/public`, U.ceo, "POST", { on: "yes" })).status === 400, "D-3 on is true or false");
    const m1 = await mark(A, U.ceo);
    ok(m1.status === 200 && m1.j?.showing === 1, "D-3 the CEO marks an active package", fmt(m1.j));
    p = await pub();
    ok(Array.isArray(p) && p.length === 1 && p[0].name === "Live Commerce" && p[0].price_label === "RM 1,600.00" && JSON.stringify(p[0].points) === JSON.stringify(["Live Commerce setup", "Live Commerce support"]),
      "D-3 the public page now reads the library: the package name, its total as the price, its item names", fmt(p));
    ok(!JSON.stringify(p).includes("typed by hand"), "D-3 the earlier card is no longer shown");
    ok((await mark(B, U.sa, true, "From RM 800 / month")).status === 200, "D-3 the super admin marks one too, with a price label");
    p = await pub();
    ok(p.length === 2 && p[1].name === "Branding" && p[1].price_label === "From RM 800 / month", "D-3 …shown in the order marked, with its label", fmt(p));
    ok((await mark(A, U.ceo, true, "From RM 1,500")).status === 200 && (p = await pub())[0].name === "Live Commerce" && p[0].price_label === "From RM 1,500" && p.length === 2, "D-3 marking again changes the label, not the order", fmt(p));
    lib = (await call("/packages", U.ceo)).j;
    ok(lib.public_showing === 2 && lib.legacy_public_tiers === 0 && lib.packages.find((x) => x.id === A)?.public === true && lib.packages.find((x) => x.id === A)?.public_label === "From RM 1,500" && lib.packages.find((x) => x.id === D)?.public === false, "D-3 the library says which packages are public");

    /* ---------- D-3: the name and the price follow the package ---------- */
    const put = await call(`/packages/${B}`, U.ceo, "PUT", { name: "Branding Plus", issuers: ["a2z"], status: "active", items: [{ name: "Logo suite", qty: 1, unit_price_cents: 120000 }] });
    p = await pub();
    ok(put.status === 200 && p[1].name === "Branding Plus" && JSON.stringify(p[1].points) === JSON.stringify(["Logo suite"]), "D-3 renaming or re-pricing the package changes the public page - one list", fmt([put.status, p[1]]));

    /* ---------- D-3: six at most; archived leaves; the earlier card never returns ---------- */
    const more = []; for (let i = 0; i < 5; i++) more.push(await mk(`Extra ${i}`, 1000 * (i + 1)));
    for (let i = 0; i < 4; i++) await mark(more[i], U.ceo);
    ok((await pub()).length === 6 && (await mark(more[4], U.ceo)).status === 409, "D-3 the public page shows six packages at most");
    ok((await call(`/packages/${A}/status`, U.ceo, "POST", { status: "archived" })).status === 200 && (p = await pub()).length === 5 && !p.some((x) => x.name === "Live Commerce"), "D-3 an archived package leaves the public page", fmt(p?.map((x) => x.name)));
    ok((await mark(more[4], U.ceo)).status === 200 && (await pub()).length === 6, "D-3 …and its place can be given to another");
    for (const id of [B, ...more]) await mark(id, U.ceo, false);
    p = await pub();
    ok(p === null, "D-3 with every package taken off, the page shows no prices - the earlier card does not come back", fmt(p));
    ok(row(`SELECT value FROM system_meta WHERE key = 'packages_json'`)?.value === LEGACY, "D-3 the earlier card is kept exactly as it was saved (nothing deleted, nothing edited)");
    ok(n(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'package.public'`) >= 9, "D-3 every change to the public page is in the audit", String(n(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'package.public'`)));

    /* ---------- source: the screens ---------- */
    const src = (f) => read(f);
    const td = src("components/portal/trading-desk.tsx");
    ok(!/OtApprovalsCard|LiveScheduleCard|<ClientsCard|<PnlCard|ActiveStokisSummary|live-cards/.test(td) && /const LINKED = new Set\(\["Clients", "Lives today", "Cash flow \(mo\)", "OT pending"\]\);/.test(td)
      && /const home = linked && t\.tab && go && canOpen\?\.\(t\.tab\) \? t\.tab : null;/.test(td) && /* v1.338.0 - a segment of the one KPI strip, the same press */ /\(\) => \(home \? go\?\.\(home\) : setDetailModal\(t\.label\)\)/.test(td),
      "D-2 the company card draws no copy of another tab: those four figures open their home tab, for who may open it");
    ok(!existsSync(join(srcRoot, "components/portal/live-cards.tsx")) && /"components\\portal\\live-cards\.tsx"/.test(src("PUSH.bat")), "D-2 the second overtime and live-schedule cards are gone, and PUSH.bat removes the stale file");
    ok(!/export function PnlCard|finance\/pnl`/.test(src("components/portal/sales.tsx")) && !/path === "\/finance\/pnl"/.test(src("worker/src/staff.ts")), "D-1 no screen and no route for the third profit sum");
    ok(!/export function PackagesEditorCard|<PackagesEditorCard|packagesExtra|sales\/packages`/.test(src("components/portal/sales.tsx") + src("app/portal/page.tsx")) && !/path === "\/sales\/packages"/.test(src("worker/src/staff.ts")), "D-3 no second package editor");
    ok(/const pk = await publicRateCard\(env\);/.test(src("worker/src/index.ts")) && !/packages_json/.test(src("worker/src/index.ts") + src("worker/src/commission.ts") + src("worker/src/staff.ts")), "D-3 the public page and the commission names read the one list (packages.ts)");
    const rp = src("components/portal/role-panels.tsx");
    ok(/const pays = priceState\(\{ \.\.\.it, status: "" \}\)\.pays;\s*if \(pays <= 0 \|\| pays === \(it\.unit_price_cents \?\? 0\)\) return null;/.test(rp) && /data-testid="elfia-charges"/.test(rp) && (rp.match(/<StoreCharges it=\{it\} openElfia=\{openElfia\} \/>/g) ?? []).length === 2 && /openElfia=\{canOpen\("ELFIA Store"\) \? \(\) => setTab\("ELFIA Store"\) : undefined/.test(src("app/portal/page.tsx")),
      "D-4 the Inventory row (desk table and phone card) says what the store charges when it is not the list price, by the store's own rule, and opens ELFIA Store");
    const erp = src("worker/src/erp.ts");
    ok(!/path === "\/gl\/trial-balance"/.test(erp) && !/path === "\/gl\/journal" && method === "GET"/.test(erp) && /\["\/gl\/overview", "\/gl\/month-end", "\/gl\/ledger", "\/gl\/pnl", "\/gl\/journal", "\/gl\/trial-balance"\]\.includes\(path\)/.test(src("worker/src/ledger.ts")),
      "D-7 the trial balance and the journal list have one answer each (the ledger's)");
  } catch (e) { ok(false, "the run threw", String(e?.stack ?? e).slice(0, 400)); }
  globalThis.Date = RealDate;
  return out;
}

let n = 0, fail = 0;
const report = (res) => { for (const [p, m] of res) { n++; if (!p) { fail++; console.error(`FAIL ${m}`); } } };
const dir = mkdtempSync(join(tmpdir(), "duplicates-"));
const main = join(dir, "worker.mjs");
bundle(root, main);
report(await runtime(main, join(root, "worker/migrations")));
const checks = n;
if (process.env.NOMUT) {
  rmSync(dir, { recursive: true, force: true });
  if (fail) { console.error(`duplicates: ${fail} of ${n} failed`); process.exit(1); }
  console.log(`duplicates: ${n} checks passed`); process.exit(0);
}
if (fail) { console.error(`duplicates: ${fail} of ${n} failed (mutations not run)`); process.exit(1); }

const MUT = [
  ["worker/src/packages.ts", "D-3 the COO chooses the public page", `export const PACKAGE_PUBLIC_ROLES = ["ceo", "super_admin"];`, `export const PACKAGE_PUBLIC_ROLES = ["ceo", "coo", "super_admin"];`],
  ["worker/src/packages.ts", "D-3 a draft goes public", `if (cur.status !== "active") return err("invalid_state"`, `if (false) return err("invalid_state"`],
  ["worker/src/packages.ts", "D-3 a seventh package goes public", `if (kept.length >= PUBLIC_MAX) return err("public_full"`, `if (false) return err("public_full"`],
  ["worker/src/packages.ts", "D-3 an archived package stays on the public page", `WHERE p.status = 'active' AND p.id IN (`, `WHERE p.id IN (`],
  ["worker/src/packages.ts", "D-3 the earlier card comes back when nothing is marked", `  if ((await publicPointers(env)) === null) return legacyRateCard(env);\n  return libraryPublicTiers(env);`, `  const l = await libraryPublicTiers(env);\n  return l.length ? l : legacyRateCard(env);`],
  ["worker/src/packages.ts", "D-3 the public page keeps showing the earlier card", `  if ((await publicPointers(env)) === null) return legacyRateCard(env);\n  return libraryPublicTiers(env);`, `  return legacyRateCard(env);`],
  ["worker/src/packages.ts", "D-3 the price label is dropped", `price_label: x.price_label || rmLabel(Number(r.total_cents ?? 0))`, `price_label: rmLabel(Number(r.total_cents ?? 0))`],
  ["worker/src/packages.ts", "D-3 the public page is not audited", `await audit(env, user.id, "package.public", "sales_packages"`, `void (env, user.id, "package.public", "sales_packages"`],
  ["components/portal/trading-desk.tsx", "D-2 a figure opens a tab its reader may not open", `const home = linked && t.tab && go && canOpen?.(t.tab) ? t.tab : null;`, `const home = linked && t.tab && go ? t.tab : null;`],
  ["components/portal/role-panels.tsx", "D-4 the Inventory row sums the store price itself", `const pays = priceState({ ...it, status: "" }).pays;`, `const pays = (it.elfia_price_cents ?? it.unit_price_cents ?? 0) - (it.elfia_discount_cents ?? 0);`],
  ["worker/src/ledger.ts", "D-7 the bare trial balance is nobody's again", `["/gl/overview", "/gl/month-end", "/gl/ledger", "/gl/pnl", "/gl/journal", "/gl/trial-balance"].includes(path)`, `["/gl/overview", "/gl/month-end", "/gl/ledger", "/gl/pnl"].includes(path)`],
];
for (const [file, name, from, to] of MUT) {
  n++;
  const src = readFileSync(join(root, file), "utf8").replace(/\r\n/g, "\n");
  if (!src.includes(from)) { fail++; console.error(`FAIL mutation did not apply: ${name}`); continue; }
  const mdir = mkdtempSync(join(tmpdir(), "duplicates-m-"));
  for (const d of ["worker", "components", "app", "lib", "constants", "types"]) { try { cpSync(join(root, d), join(mdir, d), { recursive: true, filter: (p) => !p.includes("node_modules") }); } catch { /* not every folder exists */ } }
  for (const f of ["package.json", "PUSH.bat"]) cpSync(join(root, f), join(mdir, f));
  writeFileSync(join(mdir, file), src.replace(from, to));
  try { bundle(mdir, join(mdir, "w.mjs")); } catch { fail++; console.error(`FAIL mutation did not build: ${name}`); continue; }
  const res = await runtime(join(mdir, "w.mjs"), join(mdir, "worker/migrations"), mdir);
  const bad = res.filter(([p]) => !p).map(([, m]) => m);
  if (!bad.length) { fail++; console.error(`FAIL mutation not caught: ${name}`); }
  else console.log(`caught: ${name} -> ${bad.slice(0, 2).join("; ")}`);
  rmSync(mdir, { recursive: true, force: true });
}
rmSync(dir, { recursive: true, force: true });
if (fail) { console.error(`duplicates: ${fail} of ${n} failed`); process.exit(1); }
console.log(`duplicates: ${checks} checks passed (${MUT.length} mutations caught) - the duplicate-function audit, fixed: one profit sum per book, no copy of another tab on the Dashboard card, one package list behind the public page (the CEO marks it; the earlier card kept and never edited), the store's price on the Inventory row, one trial balance`);
