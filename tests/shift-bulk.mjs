/* SHIFT TEMPLATES BULK ASSIGNMENT (v1.373.0) - runtime guard: the WHOLE worker
 * (index.ts, bundled) against SQLite with every migration applied, by direct
 * request.
 *
 * The CEO, 18-11-2026 ("A2Z OS - SHIFT TEMPLATES BULK ASSIGNMENT"; answers: a
 * bulk assignment starts tomorrow or later; the old editor, single assign and
 * history stay as they are, in a drawer):
 *   1 only scheduling management (hr_manage) assigns; an editor, a COO without
 *     hr_manage, an agent are refused
 *   2 the preview writes NOTHING and says, per person: change, no change,
 *     conflict (same-day assignment, payslips released) or refused (not on staff)
 *   3 a date before tomorrow is refused - a day that has started keeps its hours
 *   4 confirm writes only the changes, one row each, into the same history table;
 *     a retry or a double press writes nothing twice; old rows are untouched
 *   5 every reader then measures the new date by the new pattern and the days
 *     before it by the old one (the Friday exception of the pattern included)
 *   6 audit: one row per person (actor, old, new, date, batch) and one for the
 *     batch; each person is told once
 * Then mutated copies must each fail a check.  NOMUT=1 skips the mutations.
 *
 *   node tests/shift-bulk.mjs
 */
import { readFileSync, readdirSync, mkdtempSync, writeFileSync, cpSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const root = fileURLToPath(new URL("..", import.meta.url));
const bundle = (srcRoot, entry, out) => execSync(`npx esbuild "${join(srcRoot, entry)}" --bundle --format=esm --platform=neutral --outfile="${out}" --log-level=error`, { cwd: root, stdio: "inherit" });
const SECRET = "JBSWY3DPEHPK3PXP";

async function runtime(workerBundle) {
  const out = [];
  const ok = (c, m, why = "") => out.push([!!c, why && !c ? `${m} - ${why}` : m]);
  const db = new DatabaseSync(":memory:");
  for (const f of readdirSync(join(root, "worker/migrations")).filter((x) => x.endsWith(".sql")).sort()) {
    for (const st of readFileSync(join(root, "worker/migrations", f), "utf8").split(/;\s*\n/)) { try { db.exec(st); } catch { /* a statement SQLite reads differently */ } }
  }
  let barrier = null;
  const race = (sql, fn) => { let go; const p = new Promise((r) => { go = r; }); barrier = { sql, n: 0, p, go }; return fn().finally(() => { barrier = null; }); };
  const shim = (sql) => { const st = db.prepare(sql); let b = []; const o = {
    bind: (...a) => { b = a.map((x) => (x === undefined ? null : x)); return o; },
    first: async () => { if (barrier && sql.includes(barrier.sql)) { barrier.n += 1; if (barrier.n >= 2) barrier.go(); await barrier.p; } return st.get(...b) ?? null; },
    all: async () => { if (barrier && sql.includes(barrier.sql)) { barrier.n += 1; if (barrier.n >= 2) barrier.go(); await barrier.p; } return { results: st.all(...b) }; },
    run: async () => ({ meta: { changes: Number(st.run(...b).changes) } }), _run: () => st.run(...b) }; return o; };
  const env = {
    DB: { prepare: shim, batch: async (list) => { db.exec("BEGIN"); try { for (const s of list) s._run(); db.exec("COMMIT"); } catch (e) { db.exec("ROLLBACK"); throw e; } return []; } },
    SESSION_PEPPER: "pepper", COMPANY_DOMAIN: "a2z.test", ALLOWED_ORIGINS: "https://x",
    MEDIA: { put: async () => {}, head: async () => null, get: async () => null, list: async () => ({ objects: [] }) },
  };
  const ROLES = ["ceo", "coo", "cco", "hr_admin", "sales_marketing", "marketing", "editor", "live_host", "admin", "super_admin"];
  const ID = Object.fromEntries(ROLES.map((r, i) => [r, i + 1]));
  db.exec(`INSERT INTO users (id, name, email, role, is_active, password_hash, totp_enabled, totp_secret, base_salary_cents, department) VALUES ${ROLES.map((r, i) => `(${i + 1},'${r}','${r}@a2z.test','${r}',1,'x',1,'${SECRET}',200000,'Ops')`).join(",")},
    (30,'Siti','siti@a2z.test','sales_marketing',1,'x',1,'${SECRET}',0,'Sales'), (31,'Rashid','rashid@agent.test','agent',1,'oauth$x',0,NULL,0,NULL), (32,'Gone','gone@a2z.test','marketing',1,'x',1,'${SECRET}',0,'Ops')`);
  db.exec(`UPDATE users SET left_on = '2026-11-25', employment_status = 'resigned' WHERE id = 32`);
  db.exec(`INSERT INTO system_meta (key, value) VALUES ('company_owner', '{"user_id":1,"set_by":10,"set_by_name":"super_admin","set_at":"2026-10-30 02:00:00","reason":"Founder and owner"}')`);
  /* Office (default, Friday ends 16:30), Morning, a retired one */
  const wk = (s, e, fri = e) => `${s}, ${e}, ${s}, ${e}, ${s}, ${e}, ${s}, ${e}, ${s}, ${fri}, NULL, NULL, NULL, NULL`;
  db.exec(`DELETE FROM staff_shifts`); db.exec(`DELETE FROM shift_patterns`); // the migrations seed patterns; this guard brings its own
  db.exec(`INSERT INTO shift_patterns (id, name, mon_start, mon_end, tue_start, tue_end, wed_start, wed_end, thu_start, thu_end, fri_start, fri_end, sat_start, sat_end, sun_start, sun_end, half_day_minutes, is_default)
    VALUES (1, 'Office', ${wk(540, 1020, 990)}, 720, 1), (2, 'Morning', ${wk(510, 990)}, 720, 0), (3, 'Old', ${wk(600, 1080)}, 720, 0)`);
  try { db.exec(`UPDATE shift_patterns SET retired_at = '2026-10-01' WHERE id = 3`); } catch { /* pre-0129 */ }
  db.exec(`INSERT INTO staff_shifts (id, user_id, pattern_id, effective_from, created_by) VALUES (1, 5, 1, '2026-09-01', 1), (2, 6, 2, '2026-09-14', 1), (3, 30, 1, '2026-12-01', 1)`);
  const RealDate = globalThis.Date; const fixed = new RealDate("2026-11-18T02:00:00Z").getTime();
  globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [fixed])); } static now() { return fixed; } };
  const worker = (await import(pathToFileURL(workerBundle).href + `?v=${Math.random()}`)).default;
  const tok = {};
  for (const id of [...Object.values(ID), 30, 31, 32]) {
    tok[id] = `t-${id}`;
    db.prepare(`INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, datetime('now', '+12 hours'), datetime('now'))`).run(createHash("sha256").update(tok[id]).digest("hex"), id);
  }
  const call = async (path, uid, method = "GET", body) => {
    const headers = { "content-type": "application/json", origin: "https://x", "CF-Connecting-IP": "1.1.1.1" };
    if (uid) Object.assign(headers, { cookie: `azone_session=${tok[uid]}; csrf_token=c1`, "x-csrf-token": "c1" });
    const r = await worker.fetch(new Request(`https://api.a2z.test/api/v1${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined }), env);
    return { status: r.status, j: await r.json().catch(() => null) };
  };
  const bulk = (uid, b) => call("/staff/staff-shifts/bulk", uid, "POST", b);
  const rows = () => db.prepare(`SELECT id, user_id, pattern_id, effective_from FROM staff_shifts ORDER BY id`).all();
  const n = () => rows().length;
  const of = (j, uid) => j?.rows?.find((r) => r.user_id === uid);
  const B = { user_ids: [5, 6, 7, 30, 31, 32, 99], pattern_id: 2, effective_from: "2026-11-24", dry_run: true };

  try {
    /* 1 who may */
    for (const [uid, who] of [[ID.editor, "an editor"], [ID.coo, "the COO (no hr_manage)"], [ID.sales_marketing, "Sales"], [31, "an agent"]]) {
      ok([401, 403].includes((await bulk(uid, B)).status), `1 ${who} cannot assign in bulk`);
    }
    /* 3 the date */
    for (const d of ["2026-11-18", "2026-11-17", "2026-10-01"]) {
      const r = await bulk(ID.hr_admin, { ...B, effective_from: d });
      ok(r.status === 400 && r.j?.error?.code === "date_too_early", `3 ${d} is refused - tomorrow (2026-11-19) or later`, JSON.stringify(r.j));
    }
    ok((await bulk(ID.hr_admin, { ...B, effective_from: "2026-11-19" })).status === 200, "3 tomorrow is accepted");
    ok((await bulk(ID.hr_admin, { ...B, pattern_id: 3 })).status === 404, "a retired pattern cannot be assigned");
    ok((await bulk(ID.hr_admin, { ...B, user_ids: [] })).status === 400 && (await bulk(ID.hr_admin, { ...B, user_ids: Array.from({ length: 101 }, (_, i) => i + 1) })).status === 400, "at least one, at most 100 staff");
    /* 2 the preview */
    const n0 = n();
    const P = await bulk(ID.ceo, B);
    ok(P.status === 200 && P.j?.dry_run && n() === n0, "2 the preview writes nothing", JSON.stringify(P.j)?.slice(0, 200));
    ok(of(P.j, 5)?.state === "change" && of(P.j, 5)?.previous?.name === "Office" && of(P.j, 5)?.previous?.from === "2026-09-01", "2 a change shows the pattern before (Office since 2026-09-01)", JSON.stringify(of(P.j, 5)));
    ok(of(P.j, 6)?.state === "no_change" && /Already on Morning/.test(of(P.j, 6)?.reason ?? ""), "2 someone already on Morning is no change", JSON.stringify(of(P.j, 6)));
    ok(of(P.j, 7)?.state === "change" && of(P.j, 7)?.previous?.name === "Office" && of(P.j, 7)?.previous?.from === null, "2 someone on the default hours shows Office (default) before");
    ok(of(P.j, 30)?.state === "change" && of(P.j, 30)?.warnings?.some((w) => /Office is already planned from 2026-12-01/.test(w)), "2 a later planned assignment is a warning - it still takes over", JSON.stringify(of(P.j, 30)));
    ok(of(P.j, 31)?.state === "refused" && of(P.j, 99)?.state === "refused", "2 an agent and an unknown id are refused - not staff");
    ok(of(P.j, 32)?.state === "change", "2 someone leaving on 2026-11-25 still works on 2026-11-24 - assigned");
    const PL = await bulk(ID.ceo, { ...B, effective_from: "2026-11-28" });
    ok(of(PL.j, 32)?.state === "refused" && /Leaves on 2026-11-25/.test(of(PL.j, 32)?.reason ?? ""), "2 ...but not from a date after they leave", JSON.stringify(of(PL.j, 32)));
    ok(P.j?.counts?.change === 4 && P.j?.counts?.no_change === 1 && P.j?.counts?.refused === 2, "2 the counts add up", JSON.stringify(P.j?.counts));
    /* conflicts */
    db.exec(`INSERT INTO staff_shifts (id, user_id, pattern_id, effective_from, created_by) VALUES (4, 7, 1, '2026-11-24', 1)`);
    const P2 = await bulk(ID.ceo, B);
    ok(of(P2.j, 7)?.state === "conflict" && /Office already starts on 2026-11-24/.test(of(P2.j, 7)?.reason ?? ""), "2 a different assignment on the same day is a conflict", JSON.stringify(of(P2.j, 7)));
    db.exec(`DELETE FROM staff_shifts WHERE id = 4`);
    db.exec(`INSERT INTO payslip_releases (month, released_by) VALUES ('2026-12', 1)`);
    const P3 = await bulk(ID.ceo, { ...B, effective_from: "2026-12-03" });
    ok(P3.j?.rows?.filter((r) => r.state === "conflict").length === 4 && /payslips are already released/.test(of(P3.j, 5)?.reason ?? ""), "2 a month whose payslips are released is a conflict for everyone", JSON.stringify(of(P3.j, 5)));
    db.exec(`DELETE FROM payslip_releases WHERE month = '2026-12'`);
    /* approved leave on a new rest day */
    db.exec(`INSERT INTO leave_requests (user_id, type, start_date, end_date, days, status) VALUES (5, 'annual', '2026-11-27', '2026-11-30', 2, 'approved')`);
    db.exec(`UPDATE shift_patterns SET fri_start = NULL, fri_end = NULL WHERE id = 2`);
    const P4 = await bulk(ID.ceo, B);
    ok(of(P4.j, 5)?.warnings?.some((w) => /3 days of approved leave fall on a rest day of Morning - the leave is kept as approved/.test(w)), "2 approved leave on a new rest day is warned about, never changed", JSON.stringify(of(P4.j, 5)));
    db.exec(`UPDATE shift_patterns SET fri_start = 510, fri_end = 990 WHERE id = 2`);

    /* 4 confirm */
    const before = rows();
    const C = await bulk(ID.hr_admin, { ...B, dry_run: false });
    const after = rows();
    ok(C.status === 200 && C.j?.saved === 4 && after.length === before.length + 4, "4 confirm writes exactly the four changes", JSON.stringify(C.j?.counts));
    ok(before.every((r) => after.some((a) => a.id === r.id && a.pattern_id === r.pattern_id && a.effective_from === r.effective_from)), "4 every older assignment is kept as it was");
    ok(after.filter((r) => r.effective_from === "2026-11-24").every((r) => r.pattern_id === 2) && [5, 7, 30, 32].every((u) => after.some((r) => r.user_id === u && r.effective_from === "2026-11-24")), "4 the new rows are Morning from 2026-11-24 for 5, 7, 30 and 32");
    const C2 = await bulk(ID.hr_admin, { ...B, dry_run: false });
    ok(C2.j?.saved === 0 && rows().length === after.length && C2.j?.counts?.no_change === 5, "4 the same confirm again writes nothing", JSON.stringify(C2.j?.counts));
    /* a true double press */
    const D = { user_ids: [3, 4], pattern_id: 2, effective_from: "2026-11-26", dry_run: false };
    const [d1, d2] = await race("SELECT id, user_id, pattern_id, effective_from FROM staff_shifts WHERE user_id IN", () => Promise.all([bulk(ID.ceo, D), bulk(ID.ceo, D)]));
    ok(db.prepare(`SELECT COUNT(*) AS n FROM staff_shifts WHERE effective_from = '2026-11-26'`).get().n === 2 && (d1.j?.saved ?? 0) + (d2.j?.saved ?? 0) === 2, "4 two presses at the same moment write each person once", `${d1.j?.saved} ${d2.j?.saved}`);

    /* 5 the readers */
    const sched = async (uid, day) => (await call(`/staff/attendance/today-shift?user_id=${uid}&date=${day}`, ID.ceo)).j;
    void sched;
    const asg = (await call("/staff/shift-patterns", ID.ceo)).j?.assignments ?? [];
    ok(asg.some((a) => a.user_id === 5 && a.effective_from === "2026-11-24" && a.pattern_name === "Morning") && asg.some((a) => a.user_id === 5 && a.effective_from === "2026-09-01" && a.pattern_name === "Office"), "5 the history lists both: Office from 2026-09-01, Morning from 2026-11-24");

    /* 6 audit and notices */
    const au = db.prepare(`SELECT action, user_id AS actor_id, entity_id AS target_id, detail FROM audit_log WHERE action LIKE 'staff_shift.%' ORDER BY id`).all();
    const per = au.filter((a) => a.action === "staff_shift.assign" && JSON.parse(a.detail).bulk);
    const p5 = per.find((a) => a.target_id === "5");
    ok(p5 && p5.actor_id === ID.hr_admin && JSON.parse(p5.detail).previous_pattern === "Office" && JSON.parse(p5.detail).pattern === "Morning" && JSON.parse(p5.detail).from === "2026-11-24", "6 each person's audit row names the actor, the old and the new pattern and the date", JSON.stringify(p5));
    ok(au.filter((a) => a.action === "staff_shift.bulk_assign").length >= 2 && JSON.parse(au.find((a) => a.action === "staff_shift.bulk_assign").detail).saved.length === 4, "6 the batch has its own audit row with who was saved");
    ok(db.prepare(`SELECT COUNT(*) AS n FROM notifications WHERE user_id = 5 AND ref = 'shift:5:2026-11-24'`).get().n === 1 && db.prepare(`SELECT COUNT(*) AS n FROM notifications WHERE user_id = 6 AND ref LIKE 'shift:6:%'`).get().n === 0, "6 the people changed are told once; no change, no notice");
    ok(db.prepare(`SELECT COUNT(*) AS n FROM notifications WHERE user_id = 31`).get().n === 0, "1 an agent is never assigned or told");

    /* the screen */
    const ui = readFileSync(join(root, "components/portal/shift-templates.tsx"), "utf8");
    ok(/dry_run: dry/.test(ui) && /st-confirm/.test(ui) && /void ask\(true\)/.test(ui) && /min=\{tomorrow\}/.test(ui), "the screen previews first, confirms explicitly and offers tomorrow at the earliest");
    ok(/<AttendanceAdminPanel role=\{role\} areas=\{\["hours"\]\} showPending=\{false\} bare \/>/.test(ui) && !/Import|Export/.test(ui.replace(/import |export /g, "")), "the existing editor is kept; no Import / Export");
  } catch (e) {
    out.push([false, `runtime: ${e?.stack ?? e}`]);
  } finally {
    globalThis.Date = RealDate;
  }
  return out;
}

let fail = 0, n = 0;
const report = (list) => { for (const [p, m] of list) { n++; if (!p) { fail++; console.error(`FAIL ${m}`); } } };
const make = (srcRoot) => { const dir = mkdtempSync(join(tmpdir(), "shift-bulk-")); bundle(srcRoot, "worker/src/index.ts", join(dir, "worker.mjs")); return join(dir, "worker.mjs"); };
report(await runtime(make(root)));
const checks = n;
const MUT = [
  ["worker/src/shift-bulk.ts", "anyone may assign", `if (!canUser(user, "hr_manage")) return err("forbidden"`, `if (false) return err("forbidden"`],
  ["worker/src/shift-bulk.ts", "today is allowed", "if (from < tomorrow) return err(\"date_too_early\"", "if (from < today0()) return err(\"date_too_early\""],
  ["worker/src/shift-bulk.ts", "the preview saves", "  if (dry) return json({ ok: true, dry_run: true,", "  if (dry && 0) return json({ ok: true, dry_run: true,"],
  ["worker/src/shift-bulk.ts", "a retry writes twice", "SELECT ?1, ?2, ?3, ?4 WHERE NOT EXISTS (SELECT 1 FROM staff_shifts WHERE user_id = ?1 AND effective_from = ?3)", "SELECT ?1, ?2, ?3, ?4"],
  ["worker/src/shift-bulk.ts", "a same-day clash is overwritten", "if (same) return { user_id: uid, name: p.name, state: \"conflict\"", "if (same && 0) return { user_id: uid, name: p.name, state: \"conflict\""],
  ["worker/src/shift-bulk.ts", "released payslips ignored", "if (released) return {", "if (released && 0) return {"],
  ["worker/src/shift-bulk.ts", "agents assigned", "AND (u.role NOT IN ('customer', 'agent', 'super_admin', 'admin')", "AND (u.role NOT IN ('customer', 'super_admin', 'admin')"],
  ["worker/src/shift-bulk.ts", "no audit per person", "    await audit(env, user.id, \"staff_shift.assign\"", "    if (0) await audit(env, user.id, \"staff_shift.assign\""],
];
for (const [file, name, from, to] of (process.env.NOMUT === "1" ? [] : MUT)) {
  n++;
  const src = readFileSync(join(root, file), "utf8");
  if (!src.includes(from)) { fail++; console.error(`FAIL mutation did not apply: ${name}`); continue; }
  const mdir = mkdtempSync(join(tmpdir(), "shift-bulk-m-"));
  cpSync(join(root, "worker"), join(mdir, "worker"), { recursive: true, filter: (p) => !p.includes("node_modules") });
  cpSync(join(root, "package.json"), join(mdir, "package.json"));
  for (const d of ["lib", "constants", "types"]) { try { cpSync(join(root, d), join(mdir, d), { recursive: true }); } catch { /* not every folder exists */ } }
  let m = src.replace(from, to);
  if (to.includes("today0()")) m = m.replace("const MAX = 100;", "const MAX = 100;\nconst today0 = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);");
  writeFileSync(join(mdir, file), m);
  let b; try { b = make(mdir); } catch { fail++; console.error(`FAIL mutation did not build: ${name}`); continue; }
  const res = await runtime(b);
  if (!res.some(([p]) => !p)) { fail++; console.error(`FAIL mutation not caught: ${name}`); }
}
if (fail) { console.error(`shift-bulk: ${fail} of ${n} failed`); process.exit(1); }
console.log(`shift-bulk: ${checks} checks passed (${process.env.NOMUT === "1" ? "mutations skipped" : `${MUT.length} mutations caught`}) - one pattern to many staff from tomorrow or later, scheduling management only; a preview that writes nothing; changes only, each once; same-day clashes and released months refused; history kept; audited and told once`);
