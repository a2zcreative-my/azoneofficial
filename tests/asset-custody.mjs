/* v1.304.0 - ASSETS WORKSPACE 4.0, PHASE 2: CUSTODY (the CEO, 14-11-2026:
   "Phase 2 now"; claude/ASSETS-WORKSPACE-4.0-BLUEPRINT.md section 5, D-2,
   D-4, D-5; migration 0194). By DIRECT request against the whole worker on
   SQLite with every migration applied (and once without 0194). Invented
   people and assets only. Each rule is MUTATED.

   What must hold:
     - every staff member reads the assets they hold (and, a manager, the
       team's) - never the register; an agent reads nothing;
     - assign / transfer / return / cancel each write one append-only step
       AND the register's holder in the same request; a transfer needs a
       reason; a lost or disposed asset is handed to nobody;
     - ONLY the new holder acknowledges - not management, not the CEO;
     - after 0194 a plain edit of the holder is refused (D-5);
     - a manager requests a hand-over inside their own team only; the keepers
       decide - never their own request; a request gone stale is refused;
     - a hand-over unacknowledged for 3 days becomes ONE Task for the issuer;
     - holders from before 4.0 are the starting point - no step is invented;
     - nothing is written to Finance, payments, commission or journals.

     node tests/asset-custody.mjs        (NOMUT=1 skips the mutations) */
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

async function runtime(workerBundle, sweepBundle, withCustody = true) {
  const out = [];
  const ok = (c, m, why = "") => out.push([!!c, why && !c ? `${m} - ${why}` : m]);
  const db = new DatabaseSync(":memory:");
  for (const f of readdirSync(join(root, "worker/migrations")).filter((x) => x.endsWith(".sql")).sort()) {
    if (!withCustody && f.startsWith("0194")) continue;
    for (const st of readFileSync(join(root, "worker/migrations", f), "utf8").split(/;\s*\n/)) { try { db.exec(st); } catch { /* a statement SQLite reads differently */ } }
  }
  /* the triggers hold ";" inside BEGIN ... END - apply 0194 whole */
  if (withCustody) { try { db.exec(readFileSync(join(root, "worker/migrations/0194_asset_custody.sql"), "utf8")); } catch { /* already there */ } }
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
  /* invented people: 1 CEO (owner), 2 super admin, 3 COO, 7 HR, 9 a sales manager (15 and 16 report to 9), 17 reports to HR, 20 outside, 21 agent, 25 left */
  db.exec(`INSERT INTO users (id, name, full_name, email, role, is_active, password_hash, totp_enabled, totp_secret) VALUES
    (1,'Owner','Owner Person','owner@a2z.test','ceo',1,'x',1,'J'), (2,'Root','Root Person','root@a2z.test','super_admin',1,'x',1,'J'),
    (3,'Coo','Coo Person','coo@a2z.test','coo',1,'x',1,'J'), (7,'Hr','Hr Person','hr@a2z.test','hr_admin',1,'x',1,'J'),
    (9,'Mgr','Aina Manager','aina@a2z.test','sales_marketing',1,'x',1,'J'), (15,'Lia','Lia Seller','lia@a2z.test','sales_marketing',1,'x',1,'J'),
    (16,'Ben','Ben Seller','ben@a2z.test','sales_marketing',1,'x',1,'J'), (17,'Eve','Eve Editor','eve@a2z.test','editor',1,'x',1,'J'),
    (20,'Out','Out Host','out@a2z.test','live_host',1,'x',1,'J'), (21,'Ros','Ros Agent','ros@a2z.test','agent',1,'x',1,'J'),
    (25,'Gone','Gone Person','gone@a2z.test','editor',0,'x',1,'J')`);
  db.exec(`UPDATE users SET reports_to = 9 WHERE id IN (15, 16); UPDATE users SET reports_to = 7 WHERE id = 17`);
  db.exec(`INSERT INTO system_meta (key, value) VALUES ('company_owner', '{"user_id":1,"set_by":2,"set_by_name":"Root","set_at":"2026-11-02 06:00:54","reason":"test"}')`);
  /* assets from before 4.0: 1 held by Lia (a hand-typed tag), 2 spare, 3 held by Out, 4 lost, 5 spare */
  db.exec(`INSERT INTO assets (id, asset_tag, name, category, purchase_price_cents, status, assigned_to, created_by) VALUES
    (1, 'ET-0001/2026', 'Laptop One', 'electronics', 514700, 'in_use', 15, 1), (2, 'AZOA-002', 'Monitor Two', 'electronics', 20867, 'spare', NULL, 1),
    (3, 'AZOA-003', 'Camera Three', 'studio', NULL, 'in_use', 20, 1), (4, 'AZOA-004', 'Mic Four', 'studio', 1000, 'lost', NULL, 1), (5, 'AZOA-005', 'Chair Five', 'furniture', 1000, 'spare', NULL, 1)`);
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("{}", { status: 200 });
  const worker = (await import(pathToFileURL(workerBundle).href + `?v=${Math.random()}`)).default;
  const S = await import(pathToFileURL(sweepBundle).href + `?v=${Math.random()}`);
  const tok = {};
  for (const id of [1, 2, 3, 7, 9, 15, 16, 17, 20, 21]) {
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
  const holder = (id) => db.prepare(`SELECT assigned_to FROM assets WHERE id = ?`).get(id)?.assigned_to ?? null;
  const statusOf = (id) => db.prepare(`SELECT status FROM assets WHERE id = ?`).get(id)?.status;
  const steps = (id) => db.prepare(`SELECT * FROM asset_custody WHERE asset_id = ? ORDER BY id`).all(id);
  const act = (id, uid, body) => call(`/assets/${id}/custody`, uid, "POST", body);
  const finance = () => ["cashflow_entries", "sales_documents", "invoice_payments", "commission_ledger", "journal_entries", "expenses"].map((t) => { try { return n(`SELECT COUNT(*) AS n FROM ${t}`); } catch { return -1; } }).join(",");
  const before = finance();

  try {
    if (!withCustody) {
      ok((await call("/assets/mine", 15)).status === 503, "before 0194: My assets answers not_ready");
      ok((await call("/assets/2", 7, "PATCH", { assigned_to: 16 })).status === 200 && holder(2) === 16, "before 0194: the holder is still edited as before");
      return out;
    }
    /* ---- who reads what ---- */
    ok((await call("/assets", 15)).status === 403 && (await call("/assets/custody", 15)).status === 403, "a salesperson never reads the register or the queue (direct request)");
    const m15 = await call("/assets/mine", 15);
    ok(m15.status === 200 && m15.j.mine.length === 1 && m15.j.mine[0].asset_tag === "ET-0001/2026" && m15.j.mine[0].pending_id == null && m15.j.can.team === false && !("purchase_price_cents" in m15.j.mine[0]), "My assets: only what they hold, no cost; a holder from before 4.0 is the starting point (nothing to acknowledge)", m15.text.slice(0, 300));
    ok(steps(1).length === 0, "no custody step is invented for a holder from before 4.0");
    ok((await call("/assets/mine", 21)).status === 403, "an agent reads nothing");
    const m9 = await call("/assets/mine", 9);
    ok(m9.j?.can?.team === true && m9.j.team.length === 1 && m9.j.team[0].holder === "Lia Seller" && m9.j.people.length === 2 && !m9.text.includes("Camera Three"), "a manager sees the team's assets (reports_to) - nobody else's", m9.text.slice(0, 300));

    /* ---- assign and acknowledge ---- */
    ok((await act(2, 15, { action: "assign", to_holder: 16 })).status === 403, "Sales cannot hand an asset over (direct request)");
    ok((await act(2, 7, { action: "assign", to_holder: 21 })).status === 400 && (await act(2, 7, { action: "assign", to_holder: 25 })).status === 400, "only an active member of staff can hold an asset (never an agent or a leaver)");
    const as = await act(2, 7, { action: "assign", to_holder: 16, location: "Sales floor" });
    ok(as.status === 200 && holder(2) === 16 && statusOf(2) === "in_use" && steps(2).length === 1 && steps(2)[0].kind === "assign" && steps(2)[0].to_holder === 16, "HR assigns a spare asset: one step, the holder and In use written together", as.text);
    const g = await call("/assets", 7);
    ok(g.j?.custody_live === true && g.j.assets.find((a) => a.id === 2)?.pending_custody_id === steps(2)[0].id, "the register shows it waiting for acknowledgement");
    ok((await call("/assets/mine", 16)).j.mine.find((a) => a.id === 2)?.pending_id != null, "the holder sees it waiting for them");
    ok((await act(2, 7, { action: "acknowledge" })).status === 403 && (await act(2, 1, { action: "acknowledge" })).status === 403 && (await act(2, 15, { action: "acknowledge" })).status === 403, "nobody acknowledges for the holder - not HR, not the CEO, not a colleague");
    const ack = await act(2, 16, { action: "acknowledge", condition: "good" });
    ok(ack.status === 200 && steps(2).at(-1).kind === "acknowledge" && (await call("/assets", 7)).j.assets.find((a) => a.id === 2)?.pending_custody_id == null, "the holder acknowledges it", ack.text);
    ok((await act(2, 16, { action: "acknowledge" })).status === 409, "nothing left to acknowledge");
    ok((await act(2, 7, { action: "assign", to_holder: 15 })).status === 409 && (await act(5, 7, { action: "transfer", to_holder: 15, reason: "Moving it to Lia now" })).status === 409, "assign only a free asset, transfer only a held one");
    ok((await act(4, 7, { action: "assign", to_holder: 15 })).status === 409, "a lost asset is handed to nobody");

    /* ---- D-5: no plain edit of the holder ---- */
    const pe = await call("/assets/2", 7, "PATCH", { assigned_to: 15 });
    ok(pe.status === 409 && pe.j?.error?.code === "use_custody" && holder(2) === 16, "a plain edit of the holder is refused (D-5)", pe.text);
    ok((await call("/assets/2", 7, "PATCH", { assigned_to: 16, location: "Sales floor B" })).status === 200, "an edit that keeps the holder still saves");

    /* ---- transfer, cancel, return ---- */
    ok((await act(2, 3, { action: "transfer", to_holder: 15, reason: "short" })).status === 400, "a transfer needs its reason");
    const n0 = n(`SELECT COALESCE(MAX(id), 0) AS n FROM notifications`);
    const tr = await act(2, 3, { action: "transfer", to_holder: 15, reason: "Ben moves to the studio team" });
    const last = steps(2).at(-1);
    ok(tr.status === 200 && holder(2) === 15 && last.kind === "transfer" && last.from_holder === 16 && last.to_holder === 15, "the COO transfers it - the previous holder kept in the step", tr.text);
    const notes = db.prepare(`SELECT user_id, message FROM notifications WHERE id > ?`).all(n0);
    ok(notes.some((x) => x.user_id === 15) && notes.some((x) => x.user_id === 16) && !/RM|5147|208/.test(JSON.stringify(notes)), "the new and the previous holder are told - the tag only, no cost", JSON.stringify(notes));
    ok((await act(2, 7, { action: "cancel", reason: "x" })).status === 400, "a cancel needs its reason");
    const cx = await act(2, 7, { action: "cancel", reason: "Wrong person chosen" });
    ok(cx.status === 200 && holder(2) === 16 && steps(2).at(-1).kind === "cancel" && (await call("/assets", 7)).j.assets.find((a) => a.id === 2)?.pending_custody_id == null, "HR cancels the unacknowledged transfer - back to Ben, who had acknowledged it", cx.text);
    ok((await act(2, 7, { action: "cancel", reason: "Nothing to cancel now" })).status === 409, "nothing left to cancel");
    ok((await act(2, 15, { action: "return", condition: "good" })).status === 403, "a colleague cannot return someone else's asset");
    ok((await act(2, 16, { action: "return", condition: "damaged" })).status === 400, "damaged needs to say what");
    const rt = await act(2, 16, { action: "return", condition: "damaged", reason: "Cracked screen corner" });
    ok(rt.status === 200 && holder(2) == null && statusOf(2) === "repair" && steps(2).at(-1).condition === "damaged", "the holder returns their own - damaged goes to In repair", rt.text);
    let blocked = 0;
    for (const sql of ["UPDATE asset_custody SET reason = 'x'", "DELETE FROM asset_custody"]) { try { db.exec(sql); } catch { blocked++; } }
    ok(blocked === 2, "custody steps are append only");
    ok((await call("/assets/2/custody", 15)).status === 403 && (await call("/assets/1/custody", 9)).status === 200 && (await call("/assets/1/custody", 15)).status === 200, "an asset's steps: the keepers, its holder and the holder's manager - nobody else");

    /* ---- requests (D-2) ---- */
    ok((await call("/assets/custody/requests", 9, "POST", { asset_id: 1, to_holder: 20, reason: "Out needs a laptop now" })).status === 403, "a manager requests only for their own team");
    ok((await call("/assets/custody/requests", 9, "POST", { asset_id: 3, to_holder: 16, reason: "Ben needs the camera" })).status === 403, "...and only an asset held inside the team, or a spare");
    ok((await call("/assets/custody/requests", 9, "POST", { asset_id: 1, to_holder: 16, reason: "short" })).status === 400, "a request says why");
    const rq = await call("/assets/custody/requests", 9, "POST", { asset_id: 1, to_holder: 16, reason: "Ben covers Lia's accounts this month" });
    ok(rq.status === 201 && holder(1) === 15, "the manager requests a transfer inside the team - nothing moves yet", rq.text);
    ok((await call("/assets/custody/requests", 9, "POST", { asset_id: 1, to_holder: 16, reason: "Again for the same asset" })).status === 409, "one waiting request per asset");
    const q = await call("/assets/custody", 3);
    const reqId = q.j?.requests?.[0]?.id;
    ok(q.status === 200 && q.j.requests.length === 1 && q.j.requests[0].requested_by === "Aina Manager", "the keepers see the request waiting", q.text.slice(0, 300));
    ok((await call(`/assets/custody/requests/${reqId}/decide`, 9, "POST", { decision: "approve" })).status === 403, "the requester cannot decide (Sales has no keeper rights)");
    const ap = await call(`/assets/custody/requests/${reqId}/decide`, 3, "POST", { decision: "approve" });
    const s1 = steps(1);
    ok(ap.status === 200 && holder(1) === 16 && s1.some((x) => x.kind === "approve" && x.request_id === reqId) && s1.some((x) => x.kind === "transfer" && x.request_id === reqId && x.from_holder === 15), "the COO approves: the transfer is made and tied to the request", ap.text);
    ok((await call(`/assets/custody/requests/${reqId}/decide`, 3, "POST", { decision: "approve" })).status === 409, "a request is decided once");
    /* HR's own request (Eve reports to HR) is decided by someone else */
    const own = await call("/assets/custody/requests", 7, "POST", { asset_id: 5, to_holder: 17, reason: "Eve needs a chair at the desk" });
    const ownId = (await call("/assets/custody", 3)).j.requests.find((x) => x.asset_tag === "AZOA-005")?.id;
    ok(own.status === 201 && (await call(`/assets/custody/requests/${ownId}/decide`, 7, "POST", { decision: "approve" })).j?.error?.code === "self_approval", "nobody decides their own request (the owner apart)");
    /* a stale request */
    const st = await call("/assets/custody/requests", 9, "POST", { asset_id: 1, to_holder: 15, reason: "Give it back to Lia after the cover" });
    const stId = (await call("/assets/custody", 3)).j.requests.find((x) => x.asset_tag === "ET-0001/2026")?.id;
    await act(1, 16, { action: "return", condition: "good" });
    ok(st.status === 201 && (await call(`/assets/custody/requests/${stId}/decide`, 3, "POST", { decision: "approve" })).j?.error?.code === "stale", "a request whose asset changed hands since is refused as stale");
    ok((await call(`/assets/custody/requests/${stId}/decide`, 3, "POST", { decision: "decline" })).status === 400 && (await call(`/assets/custody/requests/${stId}/decide`, 3, "POST", { decision: "decline", reason: "Already returned" })).status === 200, "a decline says why");
    ok((await call("/assets/mine", 9)).j.requests.some((r) => r.decision === "decline" && r.decline_reason === "Already returned"), "the manager sees the decision on their request");

    /* ---- a new asset with a holder is a hand-over ---- */
    const nw = await call("/assets", 7, "POST", { name: "Phone Six", assigned_to: 15 });
    ok(nw.status === 200 && steps(nw.j.id).length === 1 && steps(nw.j.id)[0].kind === "assign", "a new asset handed to someone starts with an assign step, waiting for acknowledgement");

    /* ---- 3 days unacknowledged: one Task for the issuer ---- */
    db.prepare(`INSERT INTO asset_custody (asset_id, kind, from_holder, to_holder, actor_id, actor_role, created_at) VALUES (5, 'assign', NULL, 16, 7, 'hr_admin', datetime('now', '-4 days'))`).run();
    db.exec(`UPDATE assets SET assigned_to = 16 WHERE id = 5`);
    const t1 = await S.assetAckSweep(env), t2 = await S.assetAckSweep(env);
    ok(t1 >= 1 && t2 === 0 && n(`SELECT COUNT(*) AS n FROM tasks WHERE link_kind = 'asset_custody' AND assigned_to = 7`) === 1, "an unacknowledged hand-over after 3 days is ONE Task for the issuer", `${t1} ${t2}`);

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
const dir = mkdtempSync(join(tmpdir(), "acu-"));
bundle(root, "worker/src/index.ts", join(dir, "worker.mjs"));
bundle(root, "worker/src/assets.ts", join(dir, "assets.mjs"));
report(await runtime(join(dir, "worker.mjs"), join(dir, "assets.mjs"), true));
report(await runtime(join(dir, "worker.mjs"), join(dir, "assets.mjs"), false));
const checks = n;
const A = "worker/src/assets.ts", S = "worker/src/staff.ts";
const MUT = [
  [A, "anyone acknowledges", [["    if (!holder) return err(\"forbidden\", \"Only the person it was handed to acknowledges it.\", 403);", ""]]],
  [A, "a transfer without a reason", [["  if (transfer && (reason ?? \"\").length < 10) return err(", "  if (false) return err("]]],
  [S, "a plain edit of the holder", [["if (want !== (beforeA.assigned_to ?? null) && (await custodyLive(env))) return err(\"use_custody\"", "if (false) return err(\"use_custody\""]]],
  [A, "deciding your own request", [["    if (r.actor_id === user.id && !isExecutiveOwner(user)) {", "    if (false) {"]]],
  [A, "a request outside the team", [["    if (!to || !team.includes(to)) return err(", "    if (!to) return err("]]],
  [A, "a stale request approved", [["    if (a.assigned_to !== r.from_holder) return err(\"stale\"", "    if (false) return err(\"stale\""]]],
  [A, "the step without the holder", [["  if (holderAfter !== undefined) {", "  if (false) {"]]],
  [A, "the sweep repeats its Task", [["          AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.link_kind = 'asset_custody' AND t.link_id = c.id)", ""]]],
  [A, "anyone returns an asset", [["    if (!manage && !holder) return err(", "    if (false) return err("]]],
  [A, "My assets shows other people's", [["WHERE a.assigned_to = ?1 AND a.deleted_at IS NULL ORDER BY a.asset_tag`).bind(user.id)", "WHERE (a.assigned_to = ?1 OR a.assigned_to IS NOT NULL) AND a.deleted_at IS NULL ORDER BY a.asset_tag`).bind(user.id)"]]],
  [A, "a lost asset handed over", [["  if ([\"lost\", \"disposed\"].includes(a.status)) return err(\"invalid_state\", `${a.asset_tag} is ${a.status} - it is not handed to anyone.`, 409);", ""]]],
];
for (const [file, name, reps] of NOMUT ? [] : MUT) {
  n++;
  let src = readFileSync(join(root, file), "utf8");
  let applied = true;
  for (const [from, to] of reps) { if (!src.includes(from)) { applied = false; break; } src = src.replace(from, to); }
  if (!applied) { fail++; console.error(`FAIL mutation did not apply: ${name}`); continue; }
  const mdir = mkdtempSync(join(tmpdir(), "acu-m-"));
  cpSync(join(root, "worker"), join(mdir, "worker"), { recursive: true, filter: (s) => !s.includes("node_modules") });
  cpSync(join(root, "package.json"), join(mdir, "package.json"));
  for (const d of ["lib", "constants", "types"]) { try { cpSync(join(root, d), join(mdir, d), { recursive: true }); } catch { /* not every folder exists */ } }
  writeFileSync(join(mdir, file), src);
  try { bundle(mdir, "worker/src/index.ts", join(mdir, "worker.mjs")); bundle(mdir, "worker/src/assets.ts", join(mdir, "assets.mjs")); } catch { fail++; console.error(`FAIL mutation did not build: ${name}`); continue; }
  const res = await runtime(join(mdir, "worker.mjs"), join(mdir, "assets.mjs"), true);
  rmSync(mdir, { recursive: true, force: true });
  if (!res.some(([p]) => !p)) { fail++; console.error(`FAIL mutation not caught: ${name}`); }
}
rmSync(dir, { recursive: true, force: true });
if (fail) { console.error(`asset-custody: ${fail} of ${n} failed`); process.exit(1); }
console.log(`asset-custody: ${checks} checks passed (${NOMUT ? "mutations skipped" : `${MUT.length} mutations caught`}) - every staff member reads their own, only the holder acknowledges, each step and the holder written together, no plain edit of the holder, a manager requests inside the team and never decides their own, stale requests refused, one Task after 3 days`);
