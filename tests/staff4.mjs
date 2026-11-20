/* v1.308.0 - STAFF WORKSPACE 4.0 (the CEO, 15-11-2026: "approve as
   recommended", S-0 ... S-14 in claude/STAFF-WORKSPACE-4.0-BLUEPRINT.md). By
   DIRECT request against the whole worker on SQLite, and on the screens'
   source. Invented people only. Each rule is MUTATED.

   What must hold:
     - the staff list carries no private block (NRIC, bank, statutory, address,
       emergency contact, blood type) - only WHICH are filled; the payroll
       processors keep the payslip's three; S-1
     - one person's private block reads for hr_manage only (CEO, HR tier),
       audited by field NAME, never value;
     - a save refuses a field somebody else changed since (409), writes only
       the fields sent, and a saved field stays locked for the HR tier;
     - the history is staff.* changes only, before / after for non-sensitive
       fields only, never the private views;
     - a reporting line records its reason and effective date; the CEO still
       reports to nobody; loops and self-reporting are refused;
     - the six views, the status vocabulary (employment, not attendance), the
       masked NRIC, the badge printed from the private block for its readers;
     - no permission, tab access or table changed.

     node tests/staff4.mjs        (NOMUT=1 skips the mutations) */
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
const PRIVATE = ["ic_number", "bank_name", "bank_account", "epf_no", "socso_no", "tax_no", "address", "emergency_name", "emergency_phone", "emergency_relation", "blood_type"];

async function runtime(workerBundle) {
  const out = [];
  const ok = (c, m, why = "") => out.push([!!c, why && !c ? `${m} - ${why}` : m]);
  const db = new DatabaseSync(":memory:");
  for (const f of readdirSync(join(root, "worker/migrations")).filter((x) => x.endsWith(".sql")).sort()) {
    for (const st of readFileSync(join(root, "worker/migrations", f), "utf8").split(/;\s*\n/)) { try { db.exec(st); } catch { /* a statement SQLite reads differently */ } }
  }
  for (const f of ["0194_asset_custody.sql", "0195_asset_care.sql"]) { try { db.exec(readFileSync(join(root, "worker/migrations", f), "utf8")); } catch { /* already there */ } }
  const shim = (sql) => { const st = db.prepare(sql); let b = []; const o = {
    bind: (...a) => { b = a.map((x) => (x === undefined ? null : x)); return o; },
    first: async () => st.get(...b) ?? null, all: async () => ({ results: st.all(...b) }),
    run: async () => ({ meta: { changes: Number(st.run(...b).changes), last_row_id: Number(db.prepare("SELECT last_insert_rowid() AS id").get().id) } }),
    _run: () => ({ meta: { changes: Number(st.run(...b).changes) } }) }; return o; };
  const env = {
    DB: { prepare: shim, batch: async (list) => { db.exec("BEGIN"); try { const r = list.map((s) => s._run()); db.exec("COMMIT"); return r; } catch (e) { db.exec("ROLLBACK"); throw e; } } },
    SESSION_PEPPER: "pepper", COMPANY_DOMAIN: "a2z.test", ALLOWED_ORIGINS: "https://portal.a2z.test",
    MEDIA: { put: async () => {}, head: async () => null, get: async () => null, list: async () => ({ objects: [] }), delete: async () => {} },
  };
  /* invented people: 1 CEO, 2 super admin, 3 COO, 6 CCO, 7 HR, 15 sales, 16 editor */
  db.exec(`INSERT INTO users (id, name, full_name, email, role, is_active, password_hash, totp_enabled, totp_secret, joined_on, position, department) VALUES
    (1,'Owner','Owner Person','owner@a2z.test','ceo',1,'x',1,'J','2020-01-01','Chief Executive Officer','Management'),
    (2,'Root','Root Person','root@a2z.test','super_admin',1,'x',1,'J',NULL,NULL,NULL),
    (3,'Coo','Coo Person','coo@a2z.test','coo',1,'x',1,'J','2021-01-01','Chief Operating Officer','Management'),
    (6,'Cco','Cco Person','cco@a2z.test','cco',1,'x',1,'J','2021-01-01','Chief Commercial Officer','Management'),
    (7,'Hr','Hr Person','hr@a2z.test','hr_admin',1,'x',1,'J','2022-01-01','Administrative Executive','HR and Admin'),
    (15,'Lia','Lia Seller','lia@a2z.test','sales_marketing',1,'x',1,'J','2024-01-01','Sales Executive','Sales'),
    (16,'Eve','Eve Editor','eve@a2z.test','editor',1,'x',1,'J','2024-02-01',NULL,NULL)`);
  db.exec(`UPDATE users SET ic_number = '990101-01-1234', bank_name = 'Maybank', bank_account = '551100338444', epf_no = 'E-15', socso_no = 'S-15', tax_no = 'T-15',
    address = '12 Jalan Contoh', emergency_name = 'Contoh Ibu', emergency_phone = '+60 12-000 0000', emergency_relation = 'mother', blood_type = 'O' WHERE id = 15`);
  db.exec(`INSERT INTO system_meta (key, value) VALUES ('company_owner', '{"user_id":1,"set_by":2,"set_by_name":"Root","set_at":"2026-11-02 06:00:54","reason":"test"}')`);
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("{}", { status: 200 });
  const worker = (await import(pathToFileURL(workerBundle).href + `?v=${Math.random()}`)).default;
  const tok = {};
  for (const id of [1, 2, 3, 6, 7, 15, 16]) {
    tok[id] = `t-${id}-${Math.random()}`;
    db.prepare(`INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, datetime('now', '+12 hours'), datetime('now'))`).run(sha(tok[id]), id);
  }
  const hdr = (uid) => ({ "content-type": "application/json", origin: "https://portal.a2z.test", cookie: `azone_session=${tok[uid]}; csrf_token=c1`, "x-csrf-token": "c1" });
  const call = async (path, uid, method = "GET", body) => {
    const r = await worker.fetch(new Request(`https://api.a2z.test/api/v1/staff${path}`, { method, headers: hdr(uid), body: body ? JSON.stringify(body) : undefined }), env, { waitUntil() {} });
    const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch { /* */ }
    return { status: r.status, j, text };
  };
  const row = (id) => db.prepare(`SELECT * FROM users WHERE id = ?`).get(id);
  const tables = () => db.prepare(`SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table'`).get().n;
  const t0 = tables();

  try {
    /* ---- S-1: the list ---- */
    for (const [uid, who] of [[7, "HR"], [6, "the CCO"], [1, "the CEO"]]) {
      const l = await call("/users", uid);
      const lia = l.j?.users?.find((u) => u.id === 15);
      const leaked = PRIVATE.filter((k) => k in (lia ?? {}) && !(uid === 1 && ["ic_number", "bank_name", "bank_account"].includes(k)));
      ok(l.status === 200 && lia && leaked.length === 0, `the list sends ${who} no private field${uid === 1 ? " beyond the payslip's three (a payroll processor)" : ""}`, JSON.stringify(leaked));
      ok(Array.isArray(lia?.private_set) && PRIVATE.every((k) => lia.private_set.includes(k)), `...and says which private fields are filled (${who})`, JSON.stringify(lia?.private_set));
    }
    const coo = (await call("/users", 3)).j?.users?.find((u) => u.id === 15);
    ok(coo && coo.ic_number === "990101-01-1234" && coo.bank_account === "551100338444" && !("epf_no" in coo) && !("address" in coo) && !("emergency_name" in coo) && !("blood_type" in coo),
      "the COO (a payroll processor) keeps the payslip's NRIC, bank and account - nothing else private", JSON.stringify(coo));
    const sales = await call("/users", 15);
    ok(sales.status === 403, "sales still cannot read the staff list (hr_manage | exec_view, unchanged)");

    /* ---- the private block ---- */
    const before = db.prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'staff.private_view'`).get().n;
    const pv = await call("/users/15/private", 7);
    ok(pv.status === 200 && pv.j?.private?.ic_number === "990101-01-1234" && pv.j?.private?.emergency_name === "Contoh Ibu", "HR reads one person's private block", pv.text.slice(0, 200));
    ok((await call("/users/15/private", 1)).status === 200 && (await call("/users/15/private", 2)).status === 200, "the CEO and the super admin read it");
    ok((await call("/users/15/private", 3)).status === 403 && (await call("/users/15/private", 6)).status === 403 && (await call("/users/15/private", 15)).status === 403 && (await call("/users/16/private", 15)).status === 403,
      "the COO, the CCO and staff - even for themselves - are refused");
    const pvAudit = db.prepare(`SELECT detail FROM audit_log WHERE action = 'staff.private_view' ORDER BY id DESC LIMIT 1`).get();
    ok(db.prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'staff.private_view'`).get().n === before + 3 && /"fields":\["ic_number"/.test(pvAudit?.detail ?? "") && !/990101|551100|Contoh/.test(pvAudit?.detail ?? ""),
      "every read is audited by field name, never value", pvAudit?.detail);

    /* ---- a save: concurrency, the lock, before / after ---- */
    const stale = await call("/users/15", 1, "PATCH", { position: "Senior Sales Executive", expect: { position: "Something Else" } });
    ok(stale.status === 409 && stale.j?.error?.code === "changed_since" && row(15).position === "Sales Executive", "a field changed since it was opened is refused (409), not overwritten", stale.text.slice(0, 200));
    const good = await call("/users/15", 1, "PATCH", { position: "Senior Sales Executive", bank_account: "999988887777", expect: { position: "Sales Executive", bank_account: "551100338444" } });
    ok(good.status === 200 && row(15).position === "Senior Sales Executive" && row(15).bank_account === "999988887777" && row(15).ic_number === "990101-01-1234" && row(15).emergency_name === "Contoh Ibu",
      "a save from the values it started with writes those fields and leaves every other field alone", good.text.slice(0, 200));
    const hrLock = await call("/users/15", 7, "PATCH", { bank_account: "111122223333" });
    ok(hrLock.status === 403 && hrLock.j?.error?.code === "locked" && row(15).bank_account === "999988887777", "a saved bank account stays locked for the HR tier (the CEO or an admin amends)", hrLock.text.slice(0, 200));
    ok((await call("/users/16", 7, "PATCH", { department: "Creative", expect: { department: "" } })).status === 200 && row(16).department === "Creative", "HR fills an empty department (Add staff to department)");
    const upd = db.prepare(`SELECT detail FROM audit_log WHERE action = 'staff.hr_update' AND entity_id = '15' ORDER BY id DESC LIMIT 1`).get()?.detail ?? "";
    ok(/"changes":\{"position":\["Sales Executive","Senior Sales Executive"\]\}/.test(upd) && /"bank_account"/.test(upd) && !/999988887777|551100338444/.test(upd),
      "the record update keeps before / after for the position, and only the NAME of the bank account", upd);

    /* ---- the history ---- */
    const h = await call("/users/15/history", 3);
    const acts = (h.j?.entries ?? []).map((e) => e.action);
    ok(h.status === 200 && acts.includes("staff.hr_update") && !acts.includes("staff.private_view") && acts.every((a) => a.startsWith("staff.")), "the history is the person's staff changes - never who opened their private block", JSON.stringify(acts));
    ok(!/999988887777|551100338444|990101/.test(h.text), "...and carries no private value");
    ok((await call("/users/15/history", 15)).status === 403 && (await call("/users/15/history", 16)).status === 403, "staff cannot read a colleague's history");

    /* ---- the reporting line ---- */
    const rt = await call("/users/15/reports-to", 3, "PUT", { reports_to: 6, reason: "Joined the CCO's team", effective_on: "2026-11-16" });
    const rtA = db.prepare(`SELECT detail FROM audit_log WHERE action = 'staff.reports_to' ORDER BY id DESC LIMIT 1`).get()?.detail ?? "";
    ok(rt.status === 200 && row(15).reports_to === 6 && /"reason":"Joined the CCO's team"/.test(rtA) && /"effective_on":"2026-11-16"/.test(rtA) && /"to_name":"Cco Person"/.test(rtA), "a reporting line records who, why and from when", rtA);
    ok((await call("/users/15/reports-to", 3, "PUT", { reports_to: 6, effective_on: "16-11-2026" })).status === 400, "an effective date that is not a real date is refused");
    ok((await call("/users/1/reports-to", 3, "PUT", { reports_to: 3 })).status === 409 && row(1).reports_to === null, "the CEO reports to nobody (still refused)");
    ok((await call("/users/6/reports-to", 1, "PUT", { reports_to: 6 })).status === 400, "nobody reports to themselves");
    ok((await call("/users/6/reports-to", 1, "PUT", { reports_to: 15 })).status === 400, "a loop is refused (Lia already reports up through the CCO)");
    ok((await call("/users/15/reports-to", 7, "PUT", { reports_to: 3 })).status === 403, "HR does not set reporting lines (org_assign, unchanged)");

    ok(tables() === t0, "no table added");
  } catch (e) {
    out.push([false, `runtime: ${e?.stack ?? e}`]);
  } finally {
    globalThis.fetch = realFetch;
  }
  return out;
}

const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
function sourceChecks(read) {
  const out = [];
  const ok = (c, m, why = "") => out.push([!!c, why && !c ? `${m} - ${why}` : m]);
  const dir = strip(read("components/staff/staff-directory.tsx"));
  ok(/const STAFF_TABS: readonly StaffTab\[\] = \["overview", "directory", "org", "team", "roles", "records"(?:, "portfolios")?\];/.test(dir) && /useTabViewAddress\("Staff Details", tab, setTab, isStaffTab\);/.test(dir) && /<ViewSwitch value=\{tab\}/.test(dir), "six views, in the address, with the phone's view switch (S-0)");
  ok(/const statusKeyOf = \(u: Staff\): StatusKey => \{/.test(dir) && !/attendance|monitor|clock/.test(dir.slice(dir.indexOf("const statusKeyOf"), dir.indexOf("const STATUS_LABEL"))) && !/Contract ended|Suspended/.test(dir),
    "the status is employment, read from the record - no attendance, no invented 'Contract ended' or 'Suspended' (S-4)");
  ok(/const masked = key === "ic_number" && !editing && Boolean\(base\.ic_number\);/.test(dir) && /masked \? maskIc\(base\.ic_number \?\? ""\)/.test(dir), "the NRIC shows masked until Edit (S-1)");
  ok(/const restricted = isPriv\(key\) && !canPrivate;/.test(dir) && /recSection === "bank" && !canPrivate \?/.test(read("components/staff/staff-directory.tsx")), "the private fields and the Bank & Statutory section are restricted for anyone else");
  ok(/const canPrivate = holds\("hr_manage", \["super_admin", "admin", "hr_admin", "ceo"\]\.includes\(role\)\);/.test(dir) && /\{canPrivate && <button type="button" className=\{btnSm\} onClick=\{\(\) => void printWithPrivate\(\[u\]\)\}/.test(dir) && /\{canPrivate && <button type="button" className=\{btnSm\} onClick=\{\(\) => void printWithPrivate\(\[u\]\)\}><AppIcon name="print" \/>\{L\("Print badge"/.test(dir) && /\{canPrivate && <div className=\{sp\.selectBar\}>/.test(dir) && !/printBadge\(\{ \.\.\.u, \.\.\.draft/.test(dir),
    "the badge (it prints the NRIC) prints from the private block, for its readers only");
  ok(/const expect: Record<string, string> = \{\};/.test(dir) && /JSON\.stringify\(\{ \.\.\.payload, expect \}\)/.test(dir), "a save sends the values it started from");
  ok(!/Religion|Nationality|Marital|Gender/.test(dir), "no religion, nationality, marital status or gender field (S-11)");
  const tm = strip(read("components/staff/team-map.tsx"));
  ok(!/api\(|useCachedApi|fetch\(/.test(tm) && /const dayMonth = /.test(tm) && !/turns|getFullYear/.test(tm), "the Team Map reads nothing of its own and never shows a birth year or an age");
  const perms = read("worker/src/permissions.ts");
  ok(['hr_manage: ["super_admin", "admin", "hr_admin", "ceo"]', 'exec_view: ["super_admin", "admin", "ceo", "coo", "cco"]', 'org_assign: ["ceo", "coo", "cco"]', 'responsibilities_edit: ["super_admin", "admin", "hr_admin", "ceo"]', 'role_assign: ["ceo", "coo"]', 'payroll_process: ["super_admin", "admin", "ceo", "coo"]'].every((x) => perms.includes(x))
    && read("lib/portal-tabs.ts").includes('"Staff Details": ["hr_admin", "coo", "cco", "ceo", "super_admin", "admin"],'), "no permission and no tab access changed");
  /* v1.311.0 - 0196 is Commission 5.0's (K-2), not this module's */ ok(/const LATEST_MIGRATION = "(0195_asset_care|0196_commission_guards|0198_expense_lifecycle|0202_project_deliverables|0203_journal_append_only|0204_staff_positions|0205_custom_roles|0206_partner_applications|0207_partner_preapproval|0208_roles|0209_roles_assignable|0210_live_participants|0211_business_growth|0212_public_refs|0213_project_completion_verify|0214_finance_cash_verify|0215_responsibility_items|0216_staff_portfolios|0217_portfolio_display_name|0218_portfolio_name_case|0219_portfolio_review|0220_portfolio_bm)";/.test(read("worker/src/index.ts")), "no migration (S-13 is later)");
  ok(/import \{ reportingLine, type OrgPerson \} from "\.\.\/\.\.\/lib\/org-tree";/.test(read("worker/src/leave-chain.ts")), "leave keeps routing on the reporting line (S-7, unchanged)");
  return out;
}

let fail = 0, n = 0;
const report = (list) => { for (const [p, m] of list) { n++; if (!p) { fail++; console.error(`FAIL ${m}`); } } };
const NOMUT = process.env.NOMUT === "1";
const dir = mkdtempSync(join(tmpdir(), "staff4-"));
bundle(root, "worker/src/index.ts", join(dir, "worker.mjs"));
report(await runtime(join(dir, "worker.mjs")));
report(sourceChecks((f) => readFileSync(join(root, f), "utf8")));
const checks = n;
const S = "worker/src/staff.ts", D = "components/staff/staff-directory.tsx";
const MUT = [
  [S, "the list carries the private block again", [["      for (const k of STAFF_PRIVATE_FIELDS) if (!(keepPay && PAYSLIP_PRIVATE_FIELDS.includes(k))) delete o[k];\n", ""]]],
  [S, "the private block without its gate", [["    if (!canUser(user, \"hr_manage\")) return err(\"forbidden\", \"Private staff details are open to HR and the CEO only\", 403);\n", ""]]],
  [S, "a private read not audited", [["    await audit(env, user.id, \"staff.private_view\", \"users\", privMatch[1]!, { fields: STAFF_PRIVATE_FIELDS.filter((k) => String(row![k] ?? \"\").trim() !== \"\") });\n", ""]]],
  [S, "no concurrency guard", [["      if (moved.length > 0) return err(\"changed_since\",", "      if (moved.length < 0) return err(\"changed_since\","]]],
  [S, "the bank account's value kept in the history", [["export const STAFF_HISTORY_VALUE_FIELDS = [\"employee_id\",", "export const STAFF_HISTORY_VALUE_FIELDS = [\"bank_account\", \"employee_id\","]]],
  [S, "the history shows who opened the private block", [["AND l.action <> 'staff.private_view'", "AND l.action <> 'staff.none'"]]],
  [S, "the reporting line forgets the reason", [["      ...(reasonRT ? { reason: reasonRT } : {}), ", "      "]]],
  [S, "the CEO given a supervisor", [["    if (managerId !== null && person.role === \"ceo\") {", "    if (managerId !== null && person.role === \"nobody\") {"]]],
  [D, "the NRIC shown in full", [["const masked = key === \"ic_number\" && !editing && Boolean(base.ic_number);", "const masked = false && Boolean(base.ic_number);"]]],
  [D, "the badge printed for anyone", [["      {canPrivate && <button type=\"button\" className={btnSm} onClick={() => void printWithPrivate([u])}><AppIcon name=\"print\" />{L(\"Print badge\"", "      {true && <button type=\"button\" className={btnSm} onClick={() => void printWithPrivate([u])}><AppIcon name=\"print\" />{L(\"Print badge\""]]],
];
for (const [file, name, reps] of NOMUT ? [] : MUT) {
  n++;
  let src = readFileSync(join(root, file), "utf8");
  let applied = true;
  for (const [from, to] of reps) { if (!src.includes(from)) { applied = false; break; } src = src.replace(from, to); }
  if (!applied) { fail++; console.error(`FAIL mutation did not apply: ${name}`); continue; }
  let res;
  if (file.startsWith("worker/")) {
    const mdir = mkdtempSync(join(tmpdir(), "staff4-m-"));
    cpSync(join(root, "worker"), join(mdir, "worker"), { recursive: true, filter: (s) => !s.includes("node_modules") });
    cpSync(join(root, "package.json"), join(mdir, "package.json"));
    for (const d of ["lib", "constants", "types"]) { try { cpSync(join(root, d), join(mdir, d), { recursive: true }); } catch { /* not every folder exists */ } }
    writeFileSync(join(mdir, file), src);
    try { bundle(mdir, "worker/src/index.ts", join(mdir, "worker.mjs")); } catch { fail++; console.error(`FAIL mutation did not build: ${name}`); continue; }
    res = [...await runtime(join(mdir, "worker.mjs")), ...sourceChecks((f) => readFileSync(join(f === file ? mdir : root, f), "utf8"))];
    rmSync(mdir, { recursive: true, force: true });
  } else {
    res = sourceChecks((f) => (f === file ? src : readFileSync(join(root, f), "utf8")));
  }
  if (!res.some(([p]) => !p)) { fail++; console.error(`FAIL mutation not caught: ${name}`); }
}
rmSync(dir, { recursive: true, force: true });
if (fail) { console.error(`staff4: ${fail} of ${n} failed`); process.exit(1); }
console.log(`staff4: ${checks} checks passed (${NOMUT ? "mutations skipped" : `${MUT.length} mutations caught`}) - the staff list carries no private block (the payroll processors keep the payslip's three); one person's private block for the HR tier and the CEO, audited by name; a save refuses a field changed meanwhile and keeps a saved field locked for HR; the history is staff changes with no private value; a reporting line records why and from when and the CEO reports to nobody; six views, employment status, a masked NRIC; no permission, tab or table changed`);
