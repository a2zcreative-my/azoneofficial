/* CEO TOP-LEVEL HIERARCHY (v1.233.0) - runtime guard: the real worker
 * (staff.ts, bundled, with lib/org-tree.ts) against SQLite with EVERY
 * migration applied.
 *
 * The owner, 30-10-2026 (claude/REPORTING-LINE-AUDIT.md): "CEO = TOP OF
 * INTERNAL OPERATIONAL HIERARCHY. NO ASSIGNED SUPERVISOR. NO ASSIGNED HOD."
 * Answers: the HOD from the reporting lines; the Organisation decides; the
 * card for every staff account; build.
 *
 *   1 the CEO cannot be given a parent - not by the CEO, COO or CCO, by a
 *     direct request; clearing stays allowed; self and loops still refused
 *   2 a parent already stored on the CEO is ignored: Executive Leadership,
 *     no supervisor, no HOD, nobody else's chart changes
 *   3 the CEO is the organisation role, never the super admin account
 *   4 COO/CCO: their real supervisor, no HOD; an HOD; a staff member whose
 *     supervisor is the HOD (one person, flagged); a supervisor and a
 *     different HOD; someone not yet assigned; a loop - never "assigned"
 *   5 only display fields leave the endpoint (no IC, bank, email, salary)
 *   6 nothing is written by reading; no approval chain reads reports_to
 * Then mutated copies of the worker / lib must each fail a check.
 *
 *   node tests/reporting-line.mjs
 */
import { readFileSync, readdirSync, mkdtempSync, writeFileSync, cpSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";

const root = fileURLToPath(new URL("..", import.meta.url));
const bundle = (srcRoot, out) => execSync(`npx esbuild "${join(srcRoot, "worker/src/staff.ts")}" --bundle --format=esm --platform=neutral --outfile="${out}" --log-level=error`, { cwd: root, stdio: "inherit" });

async function runtime(staffBundle) {
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
  const env = { DB: { prepare: shim, batch: async (list) => { db.exec("BEGIN"); try { for (const s of list) s._run(); db.exec("COMMIT"); } catch (e) { db.exec("ROLLBACK"); throw e; } return []; } } };
  /* the organisation (fixtures):
       1 Alif CEO (a COO line stored on him - the bad value the brief names)
       2 Haizal COO -> 1        3 Siti CCO -> 1
       4 Nurul (Sales) -> 2, leads 5 and 6
       5 Aina (Sales) -> 4      6 Hafiz (Sales) -> 5   (supervisor Aina, HOD Nurul)
       7 Rina (Ops) -> 3 alone   (straight to an executive, leads nobody)
       8 Zul (no line)          9/10 a loop
       11 Sup super admin       12 Adm system admin */
  db.exec(`INSERT INTO users (id, name, full_name, email, role, is_active, password_hash, department, position, reports_to, ic_number, bank_account, base_salary_cents) VALUES
    (1,'Alif','Alif Farhan','a@x.t','ceo',1,'x','Executive Leadership','Chief Executive Officer',2,'900101-01-0001','1234567890',900000),
    (2,'Haizal','Haizal Bin Osman','h@x.t','coo',1,'x','Operations','Chief Operating Officer',1,NULL,NULL,0),
    (3,'Siti','Siti Aisyah','s@x.t','cco',1,'x','Commercial','Chief Commercial Officer',1,NULL,NULL,0),
    (4,'Nurul','Nurul Fasehah','n@x.t','sales_marketing',1,'x','Sales & Marketing','Head of Sales & Marketing',2,NULL,NULL,0),
    (5,'Aina','Aina Rahman','ai@x.t','sales_marketing',1,'x','Sales & Marketing','Sales Lead',4,NULL,NULL,0),
    (6,'Hafiz','Hafiz Ali','hf@x.t','sales_marketing',1,'x','Sales & Marketing','Sales Executive',5,NULL,NULL,0),
    (7,'Rina','Rina Lee','r@x.t','live_host',1,'x','Operations','Live Host',3,NULL,NULL,0),
    (8,'Zul','Zul Hakim','z@x.t','editor',1,'x',NULL,'Editor',NULL,NULL,NULL,0),
    (9,'Loop1','Loop One','l1@x.t','editor',1,'x',NULL,NULL,10,NULL,NULL,0),
    (10,'Loop2','Loop Two','l2@x.t','editor',1,'x',NULL,NULL,9,NULL,NULL,0),
    (11,'Sup','Sup','su@x.t','super_admin',1,'x',NULL,NULL,NULL,NULL,NULL,0),
    (12,'Adm','Adm','ad@x.t','admin',1,'x',NULL,NULL,NULL,NULL,NULL,0)`);
  const ROLE = Object.fromEntries(db.prepare(`SELECT id, role FROM users`).all().map((r) => [r.id, r.role]));
  const { handleStaff } = await import(pathToFileURL(staffBundle).href + `?v=${Math.random()}`);
  const call = async (p, id = 1, method = "GET", body) => {
    const r = await handleStaff(new Request(`https://x/api/v1/staff${p}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }), env, p.split("?")[0], { id, role: ROLE[id], name: "x" });
    return { status: r?.status ?? 404, j: r ? await r.json().catch(() => null) : null };
  };
  const parentOf = (id) => db.prepare(`SELECT reports_to FROM users WHERE id = ?`).get(id).reports_to;
  const line = async (id) => (await call("/reporting-line", id)).j;

  try {
    /* 2/3 - the CEO */
    const before = JSON.stringify(db.prepare(`SELECT id, reports_to FROM users ORDER BY id`).all());
    const c = await line(1);
    ok(c?.kind === "ceo" && c.supervisor === null && c.hod === null, "the CEO reads Executive Leadership: no supervisor, no HOD - the stored COO line is ignored", JSON.stringify(c));
    ok(c?.direct_reports?.map((p) => p.id).sort().join() === "2,3", "the CEO's direct reports are the COO and CCO, by the chart", JSON.stringify(c?.direct_reports));
    ok(c?.below === 6, "everyone placed sits below the CEO (not the unassigned or the loop)", String(c?.below));
    const sales = c?.departments?.find((d) => d.name === "Sales & Marketing");
    ok(sales?.people === 3 && sales.heads.map((h) => h.id).join() === "4", "departments under the CEO by the records, Sales & Marketing headed by Nurul", JSON.stringify(c?.departments));
    ok(!c?.departments?.some((d) => d.heads.some((h) => ["ceo", "coo", "cco"].includes(h.role))), "an executive is never named a department's HOD");
    const h = await line(2);
    ok(h?.kind === "staff" && h.executive && h.supervisor?.id === 1 && h.hod === null && h.direct_reports.map((p) => p.id).join() === "4", "the COO: their real supervisor (the CEO), no HOD, their own people", JSON.stringify(h));
    ok(!h?.direct_reports?.some((p) => p.id === 1), "the CEO is nobody's report, whatever is stored on him");
    ok(JSON.stringify(db.prepare(`SELECT id, reports_to FROM users ORDER BY id`).all()) === before, "reading writes nothing - the stored value is left as it is");
    ok((await line(11))?.kind === "system" && (await line(12))?.kind === "system", "the super admin and the admin accounts are not on the chart - no card");

    /* 4 - everyone else */
    const n = await line(4);
    ok(n?.you_are_hod && n.hod === null && n.supervisor?.id === 2 && n.direct_reports.map((p) => p.id).join() === "5", "Nurul: the COO supervises her and she is the HOD", JSON.stringify(n));
    const a = await line(5);
    ok(a?.supervisor?.id === 4 && a.hod?.id === 4 && a.hod_is_supervisor && !a.you_are_hod, "Aina: Nurul is supervisor and HOD - one person, flagged", JSON.stringify(a));
    const f = await line(6);
    ok(f?.supervisor?.id === 5 && f.hod?.id === 4 && !f.hod_is_supervisor, "Hafiz: supervisor Aina, a different HOD (Nurul)", JSON.stringify(f));
    const r = await line(7);
    ok(r?.supervisor?.id === 3 && r.hod?.id === 3 && r.hod_is_supervisor, "Rina reports straight to the CCO and leads nobody: the CCO is both", JSON.stringify(r));
    const z = await line(8);
    ok(z?.kind === "staff" && !z.placed && z.supervisor === null && z.hod === null, "Zul has no line: not assigned yet, nothing invented", JSON.stringify(z));
    const l = await line(9);
    ok(!l?.placed && l.supervisor === null, "a loop is never shown as a line", JSON.stringify(l));

    /* 5 - display fields only */
    const keys = new Set();
    const walk = (o) => { if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) { keys.add(k); walk(v); } };
    walk(c); walk(a);
    ok(!["ic_number", "bank_account", "email", "base_salary_cents", "password_hash", "phone", "reports_to"].some((k) => keys.has(k)), "no IC, bank, email, salary or raw line leaves the endpoint", [...keys].join(","));

    /* 1 - the server refuses a parent for the CEO */
    for (const who of [1, 2, 3]) {
      const res = await call("/users/1/reports-to", who, "PATCH", { reports_to: who === 1 ? 2 : who });
      ok(res.status === 409 && res.j?.error?.code === "ceo_top", `the ${ROLE[who].toUpperCase()} cannot give the CEO a supervisor (direct request)`, `${res.status} ${JSON.stringify(res.j)}`);
    }
    ok(parentOf(1) === 2, "a refusal changes nothing");
    ok((await call("/users/1/reports-to", 5, "PATCH", { reports_to: 4 })).status === 403, "staff cannot set reporting lines at all");
    ok((await call("/users/1/reports-to", 2, "PATCH", { reports_to: null })).status === 200 && parentOf(1) === null, "clearing the CEO's stored line stays allowed (and audited)");
    ok(db.prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'staff.reports_to'`).get().n === 1, "the clear is audited");
    ok((await call("/users/4/reports-to", 2, "PATCH", { reports_to: 4 })).status === 400, "nobody reports to themselves");
    ok((await call("/users/4/reports-to", 2, "PATCH", { reports_to: 6 })).status === 400, "a line that closes a loop is refused");
    ok((await call("/users/8/reports-to", 2, "PATCH", { reports_to: 1 })).status === 200 && (await line(8))?.supervisor?.id === 1, "the COO places Zul under the CEO - the line shows at once");
    ok((await call("/reporting-line", 1)).j?.kind === "ceo", "after the clear, still Executive Leadership");
  } catch (e) {
    out.push([false, `runtime: ${e?.stack ?? e}`]);
  }
  return out;
}

function source() {
  const out = [];
  const ok = (c, m) => out.push([!!c, m]);
  const read = (p) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");
  const chains = ["worker/src/leave-chain.ts", "worker/src/claims-scope.ts"].map(read).join("\n");
  ok(!/reports_to|reportingLine/.test(chains), "the leave and claims approval chains do not read reporting lines");
  const card = read("components/portal/reporting-line-card.tsx");
  ok(/data\.kind === "system" \|\| data\.kind === "gone"\)\) return null/.test(card), "a system account sees no card");
  ok(!/api<[^>]*>\([^)]*method/.test(card) && !/method: "(POST|PATCH|PUT|DELETE)"/.test(card), "the card writes nothing");
  ok(/u\.role !== "ceo" && u\.reports_to/.test(read("components/staff/staff-directory.tsx")), "the CEO's profile never shows a manager");
  ok(/reportingLine\(rows, user\.id\)/.test(read("worker/src/staff.ts")), "the endpoint answers from the chart's own tree");
  return out;
}

let fail = 0, n = 0;
const report = (list) => { for (const [p, m] of list) { n++; if (!p) { fail++; console.error(`FAIL ${m}`); } } };
const dir = mkdtempSync(join(tmpdir(), "repline-"));
bundle(root, join(dir, "staff.mjs"));
report(await runtime(join(dir, "staff.mjs")));
report(source());

const MUT = [
  ["worker/src/staff.ts", "the CEO may be given a parent", 'if (managerId !== null && person.role === "ceo") {', "if (false) {"],
  ["lib/org-tree.ts", "the CEO reads a stored parent", "const supervisor = parent.get(meId) ?? null;", "const supervisor = parent.get(meId) ?? (list.find((u) => u.id === meRec.reports_to) ?? null);\n  if (meRec.role === \"ceo\" && supervisor) return { kind: \"staff\", me: meRec, placed: true, executive: true, supervisor, hod: null, hodIsSupervisor: false, youAreHod: false, directReports, below, departments: [] };"],
  ["lib/org-tree.ts", "the HOD is read from the top of the chart, not the first executive", "const k = path.findIndex(isExec);", "const k = path.length - 1;"],
  ["lib/org-tree.ts", "a lone report of an executive is their own HOD", "if (head.id === id && (nodeOf.get(id)?.children.length ?? 0) === 0) return path[k]!;", ""],
  ["lib/org-tree.ts", "the super admin gets a card", 'const SYSTEM_ROLES = ["admin", "super_admin", "customer"];', 'const SYSTEM_ROLES = ["customer"];'],
  ["worker/src/staff.ts", "the endpoint leaks the record", "const pub = (u: OrgPerson | null) => u ? {", "const pub = (u: OrgPerson | null) => u ? { ...u,"],
];
for (const [file, name, from, to] of MUT) {
  n++;
  const src = readFileSync(join(root, file), "utf8");
  if (!src.includes(from)) { fail++; console.error(`FAIL mutation did not apply: ${name}`); continue; }
  const mdir = mkdtempSync(join(tmpdir(), "repline-m-"));
  cpSync(join(root, "worker"), join(mdir, "worker"), { recursive: true, filter: (p) => !p.includes("node_modules") });
  cpSync(join(root, "package.json"), join(mdir, "package.json"));
  for (const d of ["lib", "constants", "types"]) { try { cpSync(join(root, d), join(mdir, d), { recursive: true }); } catch { /* not every folder exists */ } }
  writeFileSync(join(mdir, file), src.replace(from, to));
  try { bundle(mdir, join(mdir, "staff.mjs")); } catch { fail++; console.error(`FAIL mutation did not build: ${name}`); continue; }
  const res = await runtime(join(mdir, "staff.mjs"));
  if (!res.some(([p]) => !p)) { fail++; console.error(`FAIL mutation not caught: ${name}`); }
}
if (fail) { console.error(`reporting-line: ${fail} of ${n} failed`); process.exit(1); }
console.log(`reporting-line: ${n} checks passed (${MUT.length} mutations caught) - the CEO tops the chart with no supervisor and no HOD; every line read from the Organisation`);
