/* SALES PACKAGES (v1.231.0) - guard.
 *
 * The owner's brief, 30-10-2026: "ONE PACKAGES LIBRARY. ONE EXISTING
 * QUOTATION ENGINE. SELECT PACKAGE → AUTO-FILL QUOTATION → CUSTOMIZE IF
 * NEEDED → SAVE → PRINT. CUSTOM QUOTATION MUST ALWAYS REMAIN AVAILABLE.
 * HISTORICAL QUOTATIONS MUST NOT CHANGE WHEN MASTER PACKAGES CHANGE."
 * Answers: managers CEO, COO, CCO and super admin; service lines only;
 * prices editable on the quotation, flagged customized; "Build it".
 *
 * Run for real: the worker (staff.ts with packages.ts) bundled, every
 * migration applied to SQLite, requests made as each role.
 *   A the library - create (several lines, issuers), versions never edited,
 *     a stale save refused, readers see active packages only;
 *   B a quotation from a package - active, offered under its issuer, service,
 *     QT only; the link and the "customized" flag; a custom quotation needs
 *     nothing; a later price change leaves it exactly as saved; archived
 *     packages cannot start a quotation but old ones stay readable/editable;
 *   C convert keeps the lines and the link, unpaid, once; no commission row;
 *   D only the CEO, COO, CCO and super admin write - by direct request;
 *   E one line arithmetic: the browser's (lib/doc-totals.ts), the
 *     package's and the document's agree;
 *   F the Create form: the picker on quotations only, the payload, the one
 *     preview.
 * Then mutated copies of packages.ts must each fail a check.
 *
 *   node tests/sales-packages.mjs
 */
import { readFileSync, readdirSync, mkdtempSync, writeFileSync, cpSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");
const bundle = (srcRoot, entry, out) => execSync(`npx esbuild "${join(srcRoot, entry)}" --bundle --format=esm --platform=neutral --outfile="${out}" --log-level=error`, { cwd: root, stdio: "inherit" });

async function runtime(staffBundle) {
  const out = [];
  const ok = (c, m) => out.push([!!c, m]);
  const db = new DatabaseSync(":memory:");
  for (const f of readdirSync(join(root, "worker/migrations")).filter((x) => x.endsWith(".sql")).sort()) {
    for (const st of readFileSync(join(root, "worker/migrations", f), "utf8").split(/;\s*\n/)) { try { db.exec(st); } catch { /* a statement SQLite reads differently */ } }
  }
  const shim = (sql) => { const st = db.prepare(sql); let b = []; const o = {
    bind: (...a) => { b = a.map((x) => (x === undefined ? null : x)); return o; },
    first: async () => st.get(...b) ?? null, all: async () => ({ results: st.all(...b) }),
    run: async () => ({ meta: { changes: Number(st.run(...b).changes) } }), _run: () => st.run(...b) }; return o; };
  const env = { DB: { prepare: shim, batch: async (list) => { db.exec("BEGIN"); try { for (const s of list) s._run(); db.exec("COMMIT"); } catch (e) { db.exec("ROLLBACK"); throw e; } return []; } } };
  db.exec(`INSERT INTO users (id, name, email, role, is_active, password_hash) VALUES
    (1,'Boss','b@x.t','ceo',1,'x'),(2,'Ops','o@x.t','coo',1,'x'),(3,'Com','c@x.t','cco',1,'x'),(4,'Aina','a@x.t','sales_marketing',1,'x'),
    (5,'Hana','h@x.t','hr_admin',1,'x'),(6,'Adm','d@x.t','admin',1,'x'),(7,'Sup','s@x.t','super_admin',1,'x'),(9,'Farid','f@x.t','live_host',1,'x')`);
  db.exec(`INSERT INTO customers (id, company, created_by) VALUES (1,'ABC Sdn Bhd',4)`);
  const ROLE = { 1: "ceo", 2: "coo", 3: "cco", 4: "sales_marketing", 5: "hr_admin", 6: "admin", 7: "super_admin", 9: "live_host" };
  const { handleStaff } = await import(pathToFileURL(staffBundle).href + `?v=${Math.random()}`);
  const call = async (p, id = 1, method = "GET", body) => {
    const r = await handleStaff(new Request(`https://x/api/v1/staff${p}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }), env, p.split("?")[0], { id, role: ROLE[id], name: "x" });
    return { status: r?.status ?? 404, j: r ? await r.json().catch(() => null) : null };
  };
  const doc = (id) => db.prepare(`SELECT * FROM sales_documents WHERE id = ?`).get(id);
  const LINES = [
    { name: "TikTok Live Strategy Session", qty: 1, unit_price_cents: 60000, uom: "session", sub: ["Audience review", "Content calendar"] },
    { name: "Live Setup & Optimization", qty: 1, unit_price_cents: 50000 },
    { name: "Content Creation (4 Videos)", qty: 4, unit_price_cents: 20000, disc_cents: 5000 },
  ];
  const qt = (extra) => ({ doc_type: "QT", customer_id: 1, kind: "service", issuer: "azoo", items: LINES, discount_cents: 10000, tax_percent: 0, ...extra });

  try {
    /* A - the library */
    const c1 = await call("/packages", 1, "POST", { name: "TikTok Live Package", category: "Marketing", description: "Full support", issuers: ["azoo"], status: "active", items: LINES, discount_cents: 10000 });
    ok(c1.status === 201 && c1.j?.version === 1, "A1 the CEO creates a package with several service lines (version 1)");
    const pid = c1.j?.id;
    const v1 = db.prepare(`SELECT * FROM sales_package_versions WHERE package_id = ? AND version = 1`).get(pid);
    ok(v1 && JSON.parse(v1.items).length === 3 && v1.subtotal_cents === 60000 + 50000 + 75000 && v1.total_cents === 175000, "A2 version 1 holds the lines, subtotal and total (qty x unit - line discount, less the package discount)");
    ok(db.prepare(`SELECT issuers FROM sales_packages WHERE id = ?`).get(pid)?.issuers === "azoo", "A3 the package names its issuer");
    const draft = await call("/packages", 2, "POST", { name: "Branding Basics", issuers: ["a2z", "azoo"], status: "draft", items: [{ name: "Logo", qty: 1, unit_price_cents: 80000 }] });
    ok(draft.status === 201, "A4 the COO creates a draft");
    const cco = await call("/packages", 3, "POST", { name: "CCO Review Pack", issuers: ["a2z"], status: "draft", items: [{ name: "Review", qty: 1, unit_price_cents: 1000 }] });
    ok(cco.status === 201, "A5 the CCO manages packages (the owner's answer)");
    ok((await call("/packages", 1, "POST", { name: "Bad", issuers: ["elfia"], items: LINES })).status === 400, "A6 an issuer that is not a2z/azoo is refused");
    ok((await call("/packages", 1, "POST", { name: "Bad", issuers: ["a2z"], items: [{ name: "", qty: 1, unit_price_cents: 1 }] })).status === 400, "A7 a line without a description is refused");
    ok((await call("/packages", 1, "POST", { name: "Bad", issuers: ["a2z"], items: LINES, discount_cents: 99999999 })).status === 400, "A8 a discount above the subtotal is refused");
    const asSales = await call("/packages", 4);
    ok(asSales.status === 200 && asSales.j.packages.length === 1 && asSales.j.packages[0].id === pid && asSales.j.can_manage === false, "A9 a salesperson sees the active packages only, and may not manage");
    const asCeo = await call("/packages", 1);
    ok(asCeo.j.packages.length === 3 && asCeo.j.can_manage === true, "A10 a manager sees every status");
    ok((await call(`/packages?issuer=a2z`, 4)).j.packages.length === 0, "A11 the issuer filter hides a package not offered under it");

    /* B - quotations */
    const q1 = await call("/docs", 4, "POST", qt({ package_id: pid, package_version: 1 }));
    const d1 = doc(q1.j?.id);
    ok(q1.status === 201 && d1.package_id === pid && d1.package_version === 1 && d1.package_customized === 0, "B1 a quotation made from the package names it, version 1, as packaged");
    ok(JSON.parse(d1.items).length === 3 && d1.total_cents === 175000 && d1.kind === "service", "B2 its lines and total are its own (185,000 less the 10,000 document discount)");
    const custom = [...LINES.slice(0, 2), { ...LINES[2], unit_price_cents: 18000 }, { name: "Additional Support", qty: 1, unit_price_cents: 25000 }];
    const q2 = await call("/docs", 4, "POST", qt({ items: custom, package_id: pid, package_version: 1 }));
    ok(q2.status === 201 && doc(q2.j.id).package_customized === 1, "B3 a quotation whose lines differ is flagged customized");
    const q2b = await call("/docs", 4, "POST", qt({ items: [LINES[0], LINES[1], { ...LINES[2], qty: 5 }], package_id: pid, package_version: 1 }));
    ok(q2b.status === 201 && doc(q2b.j.id).package_customized === 1, "B3b the same number of lines with one quantity changed is customized too");
    const q2c = await call("/docs", 4, "POST", qt({ discount_cents: 0, package_id: pid, package_version: 1 }));
    ok(q2c.status === 201 && doc(q2c.j.id).package_customized === 1, "B3c dropping the package discount is a customization");
    ok(JSON.parse(db.prepare(`SELECT items FROM sales_package_versions WHERE package_id = ? AND version = 1`).get(pid).items)[2].unit_price_cents === 20000
      && db.prepare(`SELECT COUNT(*) AS c FROM sales_package_versions WHERE package_id = ?`).get(pid).c === 1, "B4 the master package is unchanged by the customized quotation");
    const q3 = await call("/docs", 4, "POST", qt({ items: [{ name: "Custom consultation service", qty: 1, unit_price_cents: 50000 }], discount_cents: 0 }));
    ok(q3.status === 201 && doc(q3.j.id).package_id === null && doc(q3.j.id).total_cents === 50000, "B5 a custom quotation needs no package");
    ok((await call("/docs", 4, "POST", qt({ issuer: "a2z", package_id: pid }))).status === 400, "B6 a package not offered under the issuer is refused");
    ok((await call("/docs", 4, "POST", qt({ kind: "product", issuer: "a2z", items: [{ name: "x", qty: 1, unit_price_cents: 1, sku: "X" }], package_id: draft.j.id }))).status === 400, "B7 a package on a product document is refused");
    ok((await call("/docs", 4, "POST", qt({ doc_type: "INV", salesperson_id: 4, package_id: pid }))).status === 400, "B8 a package is for quotations only");
    ok((await call("/docs", 4, "POST", qt({ issuer: "a2z", package_id: draft.j.id }))).status === 400, "B9 a draft package cannot start a quotation");
    /* the price changes later */
    const up = await call(`/packages/${pid}`, 1, "PUT", { items: [{ ...LINES[0], unit_price_cents: 90000 }, ...LINES.slice(1)], base_version: 1 });
    ok(up.status === 200 && up.j.version === 2 && up.j.new_version === true, "B10 a price change saves version 2");
    ok(db.prepare(`SELECT total_cents FROM sales_package_versions WHERE package_id = ? AND version = 1`).get(pid).total_cents === 175000, "B11 version 1 is never edited");
    ok(doc(q1.j.id).total_cents === 175000 && doc(q1.j.id).package_version === 1 && JSON.parse(doc(q1.j.id).items)[0].unit_price_cents === 60000, "B12 the earlier quotation is exactly as saved");
    ok((await call(`/packages/${pid}`, 2, "PUT", { items: LINES, base_version: 1 })).status === 409, "B13 a save from an older version is refused (stale)");
    const same = await call(`/packages/${pid}`, 1, "PUT", { description: "Updated words", base_version: 2 });
    ok(same.status === 200 && same.j.new_version === false, "B14 changing the words is not a new version");
    /* archive */
    ok((await call(`/packages/${pid}/status`, 1, "POST", { status: "archived" })).status === 200, "B15 the package is archived");
    ok((await call("/docs", 4, "POST", qt({ package_id: pid }))).status === 400, "B16 an archived package cannot start a quotation");
    ok((await call(`/docs/${q1.j.id}`, 4)).status === 200, "B17 a quotation made from it still opens");
    const ed = await call(`/docs/${q1.j.id}/edit`, 4, "POST", { ...qt(), items: LINES, discount_cents: 10000 });
    ok(ed.status === 200 && doc(q1.j.id).package_id === pid && doc(q1.j.id).package_version === 1 && doc(q1.j.id).package_customized === 0, "B18 editing it keeps the link (an older client sends none)");
    const rev = await call(`/docs/${q1.j.id}/edit`, 4, "POST", { ...qt(), items: [...LINES, { name: "Extra hour", qty: 1, unit_price_cents: 10000 }], discount_cents: 10000, revise: true, package_id: pid, package_version: 1 });
    ok(rev.status === 200 && doc(q1.j.id).revision === 1 && doc(q1.j.id).package_id === pid && doc(q1.j.id).package_customized === 1, "B19 a revision keeps the link and is flagged customized when it differs");
    ok((await call(`/packages/${pid}?version=1`, 4)).status === 200, "B20 a salesperson can read the version a quotation was made from, archived or not");
    const clr = await call(`/docs/${q2.j.id}/edit`, 4, "POST", { ...qt(), items: custom, package_id: null });
    ok(clr.status === 200 && doc(q2.j.id).package_id === null, "B21 clearing the package keeps the lines and drops the link");

    /* C - invoice and commission */
    const before = db.prepare(`SELECT COUNT(*) AS c FROM commission_ledger`).get().c;
    const cv = await call(`/docs/${q1.j.id}/convert`, 4, "POST", {});
    const inv = doc(cv.j?.id);
    ok(cv.status === 201 && inv.doc_type === "INV" && inv.items === doc(q1.j.id).items && inv.total_cents === doc(q1.j.id).total_cents && inv.payment_status === "unpaid", "C1 the invoice carries the agreed lines and total, unpaid");
    ok(inv.package_id === pid && inv.package_version === 1 && inv.issuer_code === "azoo" && inv.salesperson_id === 4 && inv.converted_from === q1.j.id, "C2 ...and the package link, issuer, closer and source quotation");
    ok((await call(`/docs/${q1.j.id}/convert`, 4, "POST", {})).status === 409, "C3 a quotation is invoiced once");
    await call("/commission/summary", 1);
    ok(db.prepare(`SELECT COUNT(*) AS c FROM commission_ledger`).get().c === before && before === 0, "C4 no commission row from choosing a package or invoicing it");

    /* D - who writes */
    for (const id of [4, 5, 6]) {
      ok((await call("/packages", id, "POST", { name: "Nope", issuers: ["a2z"], items: LINES })).status === 403, `D1 ${ROLE[id]} cannot create a package`);
      ok((await call(`/packages/${draft.j.id}`, id, "PUT", { items: [{ name: "Logo", qty: 1, unit_price_cents: 1 }] })).status === 403, `D2 ${ROLE[id]} cannot re-price a package`);
      ok((await call(`/packages/${draft.j.id}/status`, id, "POST", { status: "active" })).status === 403, `D3 ${ROLE[id]} cannot activate or archive`);
      ok((await call(`/packages/${draft.j.id}`, id, "DELETE")).status === 403, `D4 ${ROLE[id]} cannot delete`);
    }
    ok((await call("/packages", 9)).status === 403, "D5 without Sales access the library is closed");
    ok((await call(`/packages/${pid}`, 1, "DELETE")).status === 409, "D6 a package a document names cannot be deleted - it is archived");
    ok((await call(`/packages/${cco.j.id}`, 7, "DELETE")).status === 200 && !db.prepare(`SELECT id FROM sales_package_versions WHERE package_id = ?`).get(cco.j.id), "D7 an unused draft can be deleted, with its versions");
    ok(db.prepare(`SELECT COUNT(*) AS c FROM audit_log WHERE action LIKE 'package.%'`).get().c >= 6, "D8 every package change is in the audit trail");
  } catch (e) { ok(false, `runtime threw: ${e?.stack ?? e}`); }
  return out;
}

/* ---- source and arithmetic ---- */
async function source() {
  const out = [];
  const ok = (c, m) => out.push([!!c, m]);
  const perms = read("worker/src/permissions.ts");
  const roles = (perms.match(/packages_manage: \[([^\]]*)\]/) ?? [])[1];
  const client = (read("lib/packages.ts").match(/PACKAGE_MANAGE_ROLES: readonly string\[\] = \[([^\]]*)\]/) ?? [])[1];
  const norm = (s) => (s ?? "").split(",").map((x) => x.trim().replace(/"/g, "")).filter(Boolean).sort().join();
  ok(norm(roles) === "cco,ceo,coo,super_admin" && norm(roles) === norm(client), "E1 managers are CEO, COO, CCO and super admin, the same in the worker and the browser");
  const pk = read("worker/src/packages.ts");
  ok(!/commission|ledger|rate_bp/.test(pk.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")), "E2 a package carries no commission and writes no ledger");
  ok(!/UPDATE sales_package_versions/.test(pk), "E3 a version is never edited");
  /* one line arithmetic, run */
  const dir = mkdtempSync(join(tmpdir(), "pkgmath-"));
  /* bundled, so esbuild resolves them: a path with forward slashes (registry-parity) */
  const importPath = (p) => p.replace(/\\/g, "/");
  writeFileSync(join(dir, "m.ts"), `export { docSubtotal } from "${importPath(join(root, "lib/doc-totals.ts"))}";\nexport { linesSubtotal, normalizeLines } from "${importPath(join(root, "worker/src/packages.ts"))}";`);
  try {
    execSync(`npx esbuild "${join(dir, "m.ts")}" --bundle --format=esm --platform=neutral --outfile="${join(dir, "m.mjs")}" --log-level=error`, { cwd: root, stdio: "inherit" });
    const m = await import(pathToFileURL(join(dir, "m.mjs")).href);
    let same = true;
    for (let k = 0; k < 200; k++) {
      const ls = Array.from({ length: 1 + (k % 6) }, (_, i) => ({ name: `L${i}`, qty: 1 + ((k * 7 + i) % 5), unit_price_cents: (k * 991 + i * 37) % 50000, disc_cents: (k + i) % 3 ? ((k * 13 + i) % 40000) : undefined }));
      if (m.docSubtotal(ls) !== m.linesSubtotal(m.normalizeLines(ls))) { same = false; break; }
    }
    ok(same, "E4 the browser's line arithmetic equals the package's (200 runs, discounts capped at the line)");
  } catch (e) { ok(false, `E4 could not run: ${e}`); }
  const staff = read("worker/src/staff.ts");
  ok(/const subtotal = items\.reduce\(\(s, i\) => s \+ i\.qty \* i\.unit_price_cents - \(i\.disc_cents \?\? 0\), 0\);/.test(staff), "E5 the document's own subtotal is the same terms (the server stays the authority)");
  ok(/const pkgD = await packageForDoc\([\s\S]{0,300}?const number = await docNumber\(env, docType\);/.test(staff), "E6 the package is checked before a document number is taken");
  ok(/if \(qtPkg\.package_id\) await stampPackage\(env, resC\?\.id/.test(staff), "E7 convert copies the link");
  /* the Create form */
  const s = read("components/portal/sales.tsx");
  ok(/\{doc\.doc_type === "QT" && \(\s*<div className="mb-3">\s*<PackagePicker issuer=\{doc\.issuer\}/.test(s), "F1 the picker is on quotations only, by the form's issuer");
  ok(/\.\.\.\(doc\.doc_type === "QT" \? \{ package_id: pkgRef\?\.id \?\? null, package_version: pkgRef\?\.version \?\? null \} : \{\}\)/.test(s), "F2 a quotation sends its package link with the existing save");
  ok((s.match(/<DocPreview\b/g) ?? []).length === 1 && /const subtotal = docSubtotal\(doc\.items\);[\s\S]*const subtotal = docSubtotal\(doc\.items\);/.test(s), "F3 one preview, one line arithmetic for form and paper");
  ok(/const applyPackage = \(p: PackageRow, mode: "replace" \| "add"\) => \{[\s\S]{0,700}?setDoc\(/.test(s) && !/api<[^>]*>\(`\/staff\/packages\/\$\{[^}]*\}`, \{ method: "PUT"/.test(s), "F4 applying fills the form's own lines and never writes the package");
  ok(/role="tab" aria-selected=\{workTab === "packages"\}/.test(s) && /\["outstanding", L\("Outstanding", "Tertunggak"\)\]/.test(s), "F5 the Packages pill sits beside the existing seven");
  return out;
}

let fail = 0, n = 0;
const report = (list, tag = "") => { for (const [p, m] of list) { n++; if (!p) { fail++; console.error(`FAIL ${tag}${m}`); } } };
const dir = mkdtempSync(join(tmpdir(), "salespkg-"));
bundle(root, "worker/src/staff.ts", join(dir, "staff.mjs"));
report(await runtime(join(dir, "staff.mjs")));
report(await source());

/* mutations of packages.ts - each must fail a runtime check */
const MUT = [
  ["a draft or archived package may start a quotation", 'if (pkg.status !== "active") return err(', 'if (false) return err('],
  ["any issuer may use any package", 'if (!pkg.issuers.split(",").includes(ctx.issuer)) return err(', 'if (false) return err('],
  ["everybody with Sales may write packages", 'if (method !== "GET" && !manage) return err(', 'if (false) return err('],
  ["nothing is ever customized", "return d.some((l, i) => lineKey(l) !== lineKey(v[i]!));", "return false;"],
  ["a version is edited in place", "if (!same) next = cur.current_version + 1;", "if (!same) { await env.DB.prepare(`UPDATE sales_package_versions SET items = ?1 WHERE package_id = ?2`).bind(JSON.stringify(l.items), cur.id).run(); }"],
  ["readers see drafts", '${manage ? "" : "WHERE p.status = \'active\'"}', ""],
];
const src = readFileSync(join(root, "worker/src/packages.ts"), "utf8");
for (const [name, from, to] of MUT) {
  n++;
  if (!src.includes(from)) { fail++; console.error(`FAIL mutation did not apply: ${name}`); continue; }
  const mdir = mkdtempSync(join(tmpdir(), "salespkg-m-"));
  cpSync(join(root, "worker"), join(mdir, "worker"), { recursive: true, filter: (p) => !p.includes("node_modules") });
  cpSync(join(root, "package.json"), join(mdir, "package.json"));
  for (const d of ["lib", "constants", "types"]) { try { cpSync(join(root, d), join(mdir, d), { recursive: true }); } catch { /* not every folder exists */ } }
  writeFileSync(join(mdir, "worker/src/packages.ts"), src.replace(from, to));
  try { bundle(mdir, "worker/src/staff.ts", join(mdir, "staff.mjs")); } catch { fail++; console.error(`FAIL mutation did not build: ${name}`); continue; }
  const res = await runtime(join(mdir, "staff.mjs"));
  if (!res.some(([p]) => !p)) { fail++; console.error(`FAIL mutation not caught: ${name}`); }
}
if (fail) { console.error(`sales-packages: ${fail} of ${n} failed`); process.exit(1); }
console.log(`sales-packages: ${n} checks passed (${MUT.length} mutations caught)`);
