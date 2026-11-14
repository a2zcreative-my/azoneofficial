/* v1.303.0 - ASSETS WORKSPACE 4.0, PHASE 1 (the CEO, 14-11-2026: "approve as
   recommendation" on claude/ASSETS-WORKSPACE-4.0-BLUEPRINT.md; migration 0193).
   By DIRECT request against the whole worker on SQLite with every migration
   applied (and once with 0193 missing). Invented people and assets only. Each
   rule is MUTATED.

   What must hold:
     - the register is read by the same people as before (hr_manage +
       exec_view); the COO now edits (A3); the CCO, Sales, an agent do not;
     - every asset may carry its company (A2Z / AZ ONE) - set by a person the
       first time, moved afterwards only by the CEO or COO with a reason;
     - a shared-use asset names a team or place and nobody; never both;
     - an edit is audited with what it was before and after;
     - the asset history is the asset events only (never the whole log), for
       everyone who may open the register;
     - the figures: an asset with no price is never RM 0; lost and disposed are
       out of the active cost; the companies are never added together;
     - before 0193 the register still answers; the company answers not_ready;
     - nothing is written to Finance, payments, commission or journals.

     node tests/assets4.mjs        (NOMUT=1 skips the mutations) */
import { readFileSync, readdirSync, mkdtempSync, writeFileSync, cpSync, rmSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const root = fileURLToPath(new URL("..", import.meta.url));
const bundle = (srcRoot, entry, out) => execSync(`npx esbuild "${join(srcRoot, entry)}" --bundle --format=esm --platform=neutral --outfile="${out}" --log-level=error`, { cwd: root, stdio: "inherit" });
const sha = (s) => createHash("sha256").update(s).digest("hex");
globalThis.FixedLengthStream ??= class { constructor() { const t = new TransformStream(); this.readable = t.readable; this.writable = t.writable; } };

async function runtime(workerBundle, figBundle, withProfile = true) {
  const out = [];
  const ok = (c, m, why = "") => out.push([!!c, why && !c ? `${m} - ${why}` : m]);
  const db = new DatabaseSync(":memory:");
  for (const f of readdirSync(join(root, "worker/migrations")).filter((x) => x.endsWith(".sql")).sort()) {
    if (!withProfile && f.startsWith("0193")) continue;
    for (const st of readFileSync(join(root, "worker/migrations", f), "utf8").split(/;\s*\n/)) { try { db.exec(st); } catch { /* a statement SQLite reads differently */ } }
  }
  const shim = (sql) => { const st = db.prepare(sql); let b = []; const o = {
    bind: (...a) => { b = a.map((x) => (x === undefined ? null : x)); return o; },
    first: async () => st.get(...b) ?? null, all: async () => ({ results: st.all(...b) }),
    run: async () => ({ meta: { changes: Number(st.run(...b).changes), last_row_id: Number(db.prepare("SELECT last_insert_rowid() AS id").get().id) } }) }; return o; };
  const env = {
    DB: { prepare: shim, batch: async (list) => Promise.all(list.map((s) => s.run())) },
    SESSION_PEPPER: "pepper", COMPANY_DOMAIN: "a2z.test", ALLOWED_ORIGINS: "https://portal.a2z.test",
    MEDIA: { put: async () => {}, head: async () => null, get: async () => null, list: async () => ({ objects: [] }), delete: async () => {} },
  };
  /* invented people: 1 CEO (owner), 2 super admin, 3 COO, 6 CCO, 7 HR, 9 sales, 21 agent, 22 admin */
  db.exec(`INSERT INTO users (id, name, full_name, email, role, is_active, password_hash, totp_enabled, totp_secret) VALUES
    (1,'Owner','Owner Person','owner@a2z.test','ceo',1,'x',1,'JBSWY3DPEHPK3PXP'), (2,'Root','Root Person','root@a2z.test','super_admin',1,'x',1,'JBSWY3DPEHPK3PXP'),
    (3,'Coo','Coo Person','coo@a2z.test','coo',1,'x',1,'JBSWY3DPEHPK3PXP'), (6,'Cco','Cco Person','cco@a2z.test','cco',1,'x',1,'JBSWY3DPEHPK3PXP'),
    (7,'Hr','Hr Person','hr@a2z.test','hr_admin',1,'x',1,'JBSWY3DPEHPK3PXP'), (9,'Aina','Aina Seller','aina@a2z.test','sales_marketing',1,'x',1,'JBSWY3DPEHPK3PXP'),
    (21,'Ros','Ros Agent','ros@a2z.test','agent',1,'x',1,'JBSWY3DPEHPK3PXP'), (22,'Adm','Adm Person','adm@a2z.test','admin',1,'x',1,'JBSWY3DPEHPK3PXP')`);
  db.exec(`INSERT INTO system_meta (key, value) VALUES ('company_owner', '{"user_id":1,"set_by":2,"set_by_name":"Root","set_at":"2026-11-02 06:00:54","reason":"test"}')`);
  /* an existing asset from before 4.0, with a hand-typed tag */
  db.exec(`INSERT INTO assets (id, asset_tag, name, category, purchase_price_cents, status, assigned_to, created_by) VALUES (1, 'ET-0001/2026', 'Old Laptop', 'electronics', 514700, 'in_use', 9, 1)`);
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("{}", { status: 200 });
  const worker = (await import(pathToFileURL(workerBundle).href + `?v=${Math.random()}`)).default;
  const F = await import(pathToFileURL(figBundle).href + `?v=${Math.random()}`);
  const tok = {};
  for (const id of [1, 2, 3, 6, 7, 9, 21, 22]) {
    tok[id] = `t-${id}-${Math.random()}`;
    db.prepare(`INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, datetime('now', '+12 hours'), datetime('now'))`).run(sha(tok[id]), id);
  }
  const hdr = (uid) => ({ "content-type": "application/json", origin: "https://portal.a2z.test", cookie: `azone_session=${tok[uid]}; csrf_token=c1`, "x-csrf-token": "c1" });
  const call = async (path, uid, method = "GET", body) => {
    const r = await worker.fetch(new Request(`https://api.a2z.test/api/v1/staff${path}`, { method, headers: hdr(uid), body: body ? JSON.stringify(body) : undefined }), env, { waitUntil() {} });
    const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch { /* */ }
    return { status: r.status, j, text };
  };
  const n = (sql, ...a) => Number(db.prepare(sql).get(...a)?.n ?? 0);
  const finance = () => ["cashflow_entries", "sales_documents", "invoice_payments", "commission_ledger", "journal_entries", "expenses"].map((t) => { try { return n(`SELECT COUNT(*) AS n FROM ${t}`); } catch { return -1; } }).join(",");
  const before = finance();
  const lastAudit = (action) => db.prepare(`SELECT * FROM audit_log WHERE action = ? ORDER BY id DESC LIMIT 1`).get(action);
  const one = async (id, uid = 1) => (await call("/assets", uid)).j?.assets?.find((a) => a.id === id);

  try {
    if (!withProfile) {
      /* ---- before 0193 is applied ---- */
      const g = await call("/assets", 7);
      ok(g.status === 200 && g.j.assets.length === 1 && !g.j.assets[0].issuer_code, "before 0193: the register still answers, every asset reads Company not set", g.text.slice(0, 200));
      const p = await call("/assets/1", 7, "PATCH", { issuer_code: "a2z" });
      ok(p.status === 503 && p.j?.error?.code === "not_ready", "before 0193: setting a company answers not_ready", p.text);
      ok((await call("/assets/1", 7, "PATCH", { location: "Main Office" })).status === 200, "before 0193: an ordinary edit still works");
      const c = await call("/assets", 7, "POST", { name: "New Chair", issuer_code: "a2z" });
      ok(c.status === 201 && c.j?.profile_error?.error?.code === "not_ready", "before 0193: a new asset is saved and told its company waits for the update", c.text);
      return out;
    }
    /* ---- who reads, who writes ---- */
    for (const [uid, who] of [[9, "Sales"], [21, "an agent"]]) {
      ok((await call("/assets", uid)).status === 403 && (await call("/assets/history", uid)).status === 403 && (await call("/assets", uid, "POST", { name: "X" })).status === 403, `${who} reach neither the register, its history nor its writes (direct request)`);
    }
    const g = await call("/assets", 6);
    ok(g.status === 200 && g.j.can?.edit === false && g.j.can_remove === false, "the CCO reads the register but does not edit (D-1)");
    ok((await call("/assets", 6, "POST", { name: "Cco Chair" })).status === 403 && (await call("/assets/1", 6, "PATCH", { location: "X" })).status === 403 && (await call("/assets/1", 6, "DELETE", {})).status === 403, "the CCO cannot add, edit or remove (direct request)");
    const coo = await call("/assets", 3);
    ok(coo.j?.can?.edit === true && coo.j.can.company_change === true, "the COO edits and may move a company (A3)");
    const hr = await call("/assets", 7);
    ok(hr.j?.can?.edit === true && hr.j.can.company_change === false, "HR keeps the register but does not move a company once set");

    /* ---- the company: set by a person, moved only by the CEO or COO with a reason ---- */
    ok((await call("/assets", 3, "POST", { name: "Bad Co", issuer_code: "xyz" })).status === 400, "only A2Z, AZ ONE or not set");
    const c1 = await call("/assets", 3, "POST", { name: "Studio Light", category: "studio", purchase_price: "450.00", issuer_code: "azoo", shared_label: "Studio team" });
    const a2 = await one(c1.j?.id);
    ok(c1.status === 200 && a2?.issuer_code === "azoo" && a2.shared_label === "Studio team" && a2.assigned_to == null, "the COO adds an asset with its company and as shared use", c1.text);
    ok((await call("/assets", 3, "POST", { name: "Both", assigned_to: 9, shared_label: "Studio team" })).status === 400 && n(`SELECT COUNT(*) AS n FROM assets WHERE name = 'Both'`) === 0, "a shared-use asset never also names a holder - refused before anything is saved");
    ok((await one(1))?.issuer_code == null, "an asset from before 4.0 reads Company not set - never guessed (A5)");
    const set = await call("/assets/1", 7, "PATCH", { issuer_code: "a2z" });
    ok(set.status === 200 && (await one(1))?.issuer_code === "a2z", "HR sets the company the first time", set.text);
    ok((await call("/assets/1", 7, "PATCH", { issuer_code: "azoo", company_reason: "Moved to the consultancy" })).status === 403, "HR cannot move it to the other company once set (direct request)");
    ok((await call("/assets/1", 7, "PATCH", { issuer_code: null, company_reason: "Clearing the company now" })).status === 403, "...nor clear it");
    ok((await call("/assets/1", 3, "PATCH", { issuer_code: "azoo" })).status === 400 && (await call("/assets/1", 3, "PATCH", { issuer_code: "azoo", company_reason: "short" })).status === 400, "the COO must give a reason (10 characters)");
    const mv = await call("/assets/1", 3, "PATCH", { issuer_code: "azoo", company_reason: "Laptop now used by AZ ONE consultancy" });
    const ma = lastAudit("asset.company_change");
    ok(mv.status === 200 && (await one(1))?.issuer_code === "azoo" && JSON.parse(ma?.detail ?? "{}").from === "a2z" && JSON.parse(ma.detail).to === "azoo" && /consultancy/.test(ma.detail), "the COO moves it with a reason - audited from, to and why", mv.text);

    /* ---- shared use and holders ---- */
    /* v1.304.0 - phase 2: the holder changes only through custody (D-5); a person named ends the shared use */
    ok((await call(`/assets/${c1.j.id}`, 7, "PATCH", { shared_label: "Reception", assigned_to: 9 })).status === 409, "a holder in an edit is refused - holders change through custody (D-5)");
    const hold = await call(`/assets/${c1.j.id}/custody`, 7, "POST", { action: "assign", to_holder: 9 });
    ok(hold.status === 200 && (await one(c1.j.id))?.assigned_to === 9 && (await one(c1.j.id))?.shared_label == null, "handing a shared asset to a person ends the shared use (one or the other)", hold.text);
    ok((await call(`/assets/${c1.j.id}`, 7, "PATCH", { shared_label: "Reception" })).status === 400, "a held asset cannot also be shared");
    ok((await call(`/assets/${c1.j.id}`, 7, "PATCH", { shared_label: "x" })).status === 400, "a shared label is 2 to 60 characters");

    /* ---- before and after ---- */
    /* v1.305.0 - In repair, Lost and Disposed come from their records (0195); a plain edit moves In use <-> Spare */
    ok((await call("/assets/1", 7, "PATCH", { status: "repair" })).status === 409, "a plain edit no longer sends an asset to repair (phase 3, use_care)");
    await call("/assets/1", 7, "PATCH", { status: "spare", location: "Store room" });
    const up = JSON.parse(lastAudit("asset.update")?.detail ?? "{}");
    ok(JSON.stringify(up.changes?.status) === JSON.stringify(["in_use", "spare"]) && up.changes?.location?.[1] === "Store room" && up.tag === "ET-0001/2026" && !("name" in (up.changes ?? {})), "an edit is audited with what changed, before and after - and only what changed", JSON.stringify(up));
    ok((await call("/assets/999", 7, "PATCH", { location: "X" })).status === 404, "an unknown asset is 404");
    ok(n(`SELECT COUNT(*) AS n FROM assets WHERE asset_tag = 'ET-0001/2026' AND purchase_price_cents = 514700`) === 1, "the existing tag and price are untouched");

    /* ---- the history: asset events only, for the readers of the register ---- */
    db.exec(`INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (1, 'payroll.run', 'payroll', '1', '{"secret":"pay"}'), (1, 'asset.fake', 'users', '1', '{}')`);
    const h = await call("/assets/history", 6);
    ok(h.status === 200 && h.j.entries.length >= 5 && h.j.entries.every((e) => e.action.startsWith("asset.")) && !/payroll|secret/.test(h.text) && !h.j.entries.some((e) => e.action === "asset.fake"), "the CCO reads the asset history - asset events of assets only, never the rest of the log (D-7)", h.text.slice(0, 300));
    const h1 = await call("/assets/history?asset=1", 7);
    ok(h1.j.entries.length >= 3 && h1.j.entries.every((e) => e.entity_id === "1"), "one asset's history");

    /* ---- removal: the keepers incl. the COO ---- */
    const typo = await call("/assets", 7, "POST", { name: "Typo Chair" });
    ok((await call(`/assets/${typo.j.id}`, 3, "DELETE", { reason: "typo" })).status === 200, "the COO removes an entry typed by mistake (soft, audited)");

    /* ---- the figures (lib/asset-figures.ts, the one source) ---- */
    const L1 = F.lineOf("x", [{ status: "in_use", purchase_price_cents: 1000 }, { status: "in_use", purchase_price_cents: null }, { status: "lost", purchase_price_cents: 500 }, { status: "disposed", purchase_price_cents: null }]);
    ok(L1.count === 4 && L1.unpriced === 2 && L1.priced === 2 && L1.cost_cents === 1500 && L1.active === 2 && L1.active_cost_cents === 1000, "no price is never RM 0 (counted apart); lost and disposed are out of the active cost", JSON.stringify(L1));
    const co = F.companyLines([{ status: "in_use", purchase_price_cents: 100, issuer_code: "a2z" }, { status: "in_use", purchase_price_cents: 200, issuer_code: "azoo" }, { status: "in_use", purchase_price_cents: 300 }]);
    ok(co.length === 3 && co.map((l) => l.key).join() === "a2z,azoo,not_set" && co.map((l) => l.cost_cents).join() === "100,200,300", "the companies are three lines, never one mixed total", JSON.stringify(co));
    ok(F.missingOf({ status: "in_use", purchase_price_cents: null, serial_no: null, purchase_date: null, warranty_until: "2026-01-01" }, "2026-11-14").join() === "price,serial,company,purchase_date,warranty_ended", "the missing-information report names every gap");
    ok(F.statusLines([]).map((l) => l.key).join() === "in_use,spare,repair,lost,disposed", "the five statuses, always in order");

    ok(finance() === before, "nothing written to Finance, expenses, payments, commission or journals", `${before} -> ${finance()}`);
  } catch (e) {
    out.push([false, `runtime: ${e?.stack ?? e}`]);
  } finally {
    globalThis.fetch = realFetch;
  }
  return out;
}

let fail = 0, n = 0;
const report = (list) => { for (const [p, m] of list) { n++; if (!p) { fail++; console.error(`FAIL ${m}`); } } };
const NOMUT = process.env.NOMUT === "1";
const dir = mkdtempSync(join(tmpdir(), "as4-"));
bundle(root, "worker/src/index.ts", join(dir, "worker.mjs"));
bundle(root, "lib/asset-figures.ts", join(dir, "fig.mjs"));
report(await runtime(join(dir, "worker.mjs"), join(dir, "fig.mjs"), true));
report(await runtime(join(dir, "worker.mjs"), join(dir, "fig.mjs"), false));
const checks = n;
const A = "worker/src/assets.ts", S = "worker/src/staff.ts", P = "worker/src/permissions.ts", G = "lib/asset-figures.ts";
const MUT = [
  [A, "a company moved without the right", [["    if (!can(user.role, \"asset_company_change\")) return err(", "    if (false) return err("]]],
  [A, "a company moved without a reason", [["    if ((want.company_reason ?? \"\").length < 10) return err(", "    if (false) return err("]]],
  [A, "a holder and a shared label together", [["  if (shared && holder != null) return err(", "  if (false) return err("]]],
  [S, "a shared new asset with a holder", [["    if (profA.want.shared_label && asgn != null) return err(", "    if (false) return err("]]],
  [A, "the history opens the whole audit log", [["      WHERE l.entity = 'assets' AND l.action LIKE 'asset.%'", "      WHERE 1 = 1"]]],
  [S, "an edit audited as the request, not before and after", [["await audit(env, user.id, \"asset.update\", \"assets\", idA, { tag: beforeA.asset_tag, changes });", "await audit(env, user.id, \"asset.update\", \"assets\", idA, body as Record<string, unknown>);"]]],
  [P, "the COO cannot edit", [["  asset_manage: [\"super_admin\", \"admin\", \"hr_admin\", \"ceo\", \"coo\"],", "  asset_manage: [\"super_admin\", \"admin\", \"hr_admin\", \"ceo\"],"]]],
  [P, "the CCO edits", [["  asset_manage: [\"super_admin\", \"admin\", \"hr_admin\", \"ceo\", \"coo\"],", "  asset_manage: [\"super_admin\", \"admin\", \"hr_admin\", \"ceo\", \"coo\", \"cco\"],"]]],
  [P, "Sales read the register", [["  asset_view: [\"super_admin\", \"admin\", \"hr_admin\", \"ceo\", \"coo\", \"cco\"],", "  asset_view: [\"super_admin\", \"admin\", \"hr_admin\", \"ceo\", \"coo\", \"cco\", \"sales_marketing\"],"]]],
  [G, "no price counted as RM 0", [["    if (a.purchase_price_cents == null) continue;\n    priced++; cost += a.purchase_price_cents;\n    if (isActive(a)) activeCost += a.purchase_price_cents;", "    priced++; cost += a.purchase_price_cents ?? 0;\n    if (isActive(a)) activeCost += a.purchase_price_cents ?? 0;"]]],
  [G, "lost counted as active", [["export const isActive = (a: Pick<FigAsset, \"status\">) => a.status !== \"disposed\" && a.status !== \"lost\";", "export const isActive = (a: Pick<FigAsset, \"status\">) => a.status !== \"disposed\";"]]],
  [G, "the companies added together", [["  return [\"a2z\", \"azoo\", COMPANY_NOT_SET].map((k) => lineOf(k, list.filter((a) => companyKey(a) === k)))", "  return [\"all\"].map((k) => lineOf(k, list))"]]],
];
for (const [file, name, reps] of NOMUT ? [] : MUT) {
  n++;
  let src = readFileSync(join(root, file), "utf8");
  let applied = true;
  for (const [from, to] of reps) { if (!src.includes(from)) { applied = false; break; } src = src.replace(from, to); }
  if (!applied) { fail++; console.error(`FAIL mutation did not apply: ${name}`); continue; }
  const mdir = mkdtempSync(join(tmpdir(), "as4-m-"));
  cpSync(join(root, "worker"), join(mdir, "worker"), { recursive: true, filter: (s) => !s.includes("node_modules") });
  cpSync(join(root, "package.json"), join(mdir, "package.json"));
  for (const d of ["lib", "constants", "types"]) { try { cpSync(join(root, d), join(mdir, d), { recursive: true }); } catch { /* not every folder exists */ } }
  writeFileSync(join(mdir, file), src);
  try { bundle(mdir, "worker/src/index.ts", join(mdir, "worker.mjs")); bundle(mdir, "lib/asset-figures.ts", join(mdir, "fig.mjs")); } catch { fail++; console.error(`FAIL mutation did not build: ${name}`); continue; }
  const res = [...(await runtime(join(mdir, "worker.mjs"), join(mdir, "fig.mjs"), true)), ...(await runtime(join(mdir, "worker.mjs"), join(mdir, "fig.mjs"), false))];
  rmSync(mdir, { recursive: true, force: true });
  if (!res.some(([p]) => !p)) { fail++; console.error(`FAIL mutation not caught: ${name}`); }
}
rmSync(dir, { recursive: true, force: true });
if (fail) { console.error(`assets4: ${fail} of ${n} failed`); process.exit(1); }
console.log(`assets4: ${checks} checks passed (${NOMUT ? "mutations skipped" : `${MUT.length} mutations caught`}) - the same readers, the COO edits, a company set by a person and moved only by the CEO or COO with a reason, shared use names nobody, edits audited before and after, the history is asset events only, no price is never RM 0 and the companies are never added together`);
