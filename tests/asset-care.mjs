/* v1.305.0 - ASSETS WORKSPACE 4.0, PHASE 3: MAINTENANCE AND DISPOSAL (the
   CEO, 14-11-2026: "Phase 3"; claude/ASSETS-WORKSPACE-4.0-BLUEPRINT.md
   section 6, D-6, D-8; migration 0195). By DIRECT request against the whole
   worker on SQLite with every migration applied (and once without 0195).
   Invented people, assets and one invented expense only. Each rule is MUTATED.

   What must hold:
     - the board is for the register's readers; one asset's records also for
       its holder and the holder's manager - who never see a cost;
     - an issue is a report (the holder, their manager, the readers), not a
       status; a repair sent for it that comes back fixed closes it;
     - repairs, finds and disposal requests are the keepers'; each record and
       the asset's status are written together;
     - a repair cost and proceeds are notes; an expense is only LINKED and
       must exist - nothing is written to Finance;
     - a lost or disposed asset is never deleted; a loss keeps the holder;
     - a disposal is approved only by the CEO or COO, never by who asked
       (the verified owner apart), and not once someone holds it again;
     - after 0195 a plain edit moves only In use <-> Spare; an asset with
       records is never removed as a typo; the four tables are append-only;
     - a repair past its expected date becomes ONE Task;
     - statuses from before 4.0 are the starting point - nothing invented.

     node tests/asset-care.mjs        (NOMUT=1 skips the mutations) */
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

async function runtime(workerBundle, sweepBundle, withCare = true) {
  const out = [];
  const ok = (c, m, why = "") => out.push([!!c, why && !c ? `${m} - ${why}` : m]);
  const db = new DatabaseSync(":memory:");
  for (const f of readdirSync(join(root, "worker/migrations")).filter((x) => x.endsWith(".sql")).sort()) {
    if (!withCare && f.startsWith("0195")) continue;
    for (const st of readFileSync(join(root, "worker/migrations", f), "utf8").split(/;\s*\n/)) { try { db.exec(st); } catch { /* a statement SQLite reads differently */ } }
  }
  /* the triggers hold ";" inside BEGIN ... END - apply 0194 and 0195 whole */
  for (const f of ["0194_asset_custody.sql", ...(withCare ? ["0195_asset_care.sql"] : [])]) { try { db.exec(readFileSync(join(root, "worker/migrations", f), "utf8")); } catch { /* already there */ } }
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
  /* invented people: 1 CEO (owner), 2 super admin, 3 COO, 6 CCO, 7 HR, 9 a sales manager (15 and 16 report to 9), 17 reports to HR, 20 outside, 21 agent, 25 left */
  db.exec(`INSERT INTO users (id, name, full_name, email, role, is_active, password_hash, totp_enabled, totp_secret) VALUES
    (1,'Owner','Owner Person','owner@a2z.test','ceo',1,'x',1,'J'), (2,'Root','Root Person','root@a2z.test','super_admin',1,'x',1,'J'),
    (3,'Coo','Coo Person','coo@a2z.test','coo',1,'x',1,'J'), (6,'Cco','Cco Person','cco@a2z.test','cco',1,'x',1,'J'), (7,'Hr','Hr Person','hr@a2z.test','hr_admin',1,'x',1,'J'),
    (9,'Mgr','Aina Manager','aina@a2z.test','sales_marketing',1,'x',1,'J'), (15,'Lia','Lia Seller','lia@a2z.test','sales_marketing',1,'x',1,'J'),
    (16,'Ben','Ben Seller','ben@a2z.test','sales_marketing',1,'x',1,'J'), (17,'Eve','Eve Editor','eve@a2z.test','editor',1,'x',1,'J'),
    (20,'Out','Out Host','out@a2z.test','live_host',1,'x',1,'J'), (21,'Ros','Ros Agent','ros@a2z.test','agent',1,'x',1,'J'),
    (25,'Gone','Gone Person','gone@a2z.test','editor',0,'x',1,'J')`);
  db.exec(`UPDATE users SET reports_to = 9 WHERE id IN (15, 16); UPDATE users SET reports_to = 7 WHERE id = 17`);
  db.exec(`INSERT INTO system_meta (key, value) VALUES ('company_owner', '{"user_id":1,"set_by":2,"set_by_name":"Root","set_at":"2026-11-02 06:00:54","reason":"test"}')`);
  /* assets from before 4.0: 1 held by Lia, 2 spare, 3 held by Out, 4 lost (no incident), 5 spare, 6 in repair (no record), 7 spare */
  db.exec(`INSERT INTO assets (id, asset_tag, name, category, purchase_price_cents, status, assigned_to, created_by) VALUES
    (1, 'ET-0001/2026', 'Laptop One', 'electronics', 514700, 'in_use', 15, 1), (2, 'AZOA-002', 'Monitor Two', 'electronics', 20867, 'spare', NULL, 1),
    (3, 'AZOA-003', 'Camera Three', 'studio', NULL, 'in_use', 20, 1), (4, 'AZOA-004', 'Mic Four', 'studio', 1000, 'lost', NULL, 1), (5, 'AZOA-005', 'Chair Five', 'furniture', 1000, 'spare', NULL, 1),
    (6, 'AZOA-006', 'Printer Six', 'electronics', 90000, 'repair', NULL, 1), (7, 'AZOA-007', 'Tripod Seven', 'studio', 3000, 'spare', NULL, 1)`);
  /* an expense Finance recorded (invented) - the only thing a repair may LINK to */
  db.exec(`INSERT INTO expenses (id, expense_date, category, amount_cents, vendor, description) VALUES (41, '2026-11-10', 'equipment', 15050, 'Fix Shop', 'Laptop keyboard')`);
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("{}", { status: 200 });
  const worker = (await import(pathToFileURL(workerBundle).href + `?v=${Math.random()}`)).default;
  const S = await import(pathToFileURL(sweepBundle).href + `?v=${Math.random()}`);
  const tok = {};
  for (const id of [1, 2, 3, 6, 7, 9, 15, 16, 17, 20, 21]) {
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
  const act = (id, uid, body) => call(`/assets/${id}/care`, uid, "POST", body);
  const rows = (t, id) => db.prepare(`SELECT * FROM ${t} WHERE asset_id = ? ORDER BY id`).all(id);
  const finance = () => ["cashflow_entries", "sales_documents", "invoice_payments", "commission_ledger", "journal_entries", "expenses"].map((t) => { try { return n(`SELECT COUNT(*) AS n FROM ${t}`); } catch { return -1; } }).join(",");
  const before = finance();

  try {
    if (!withCare) {
      ok((await call("/assets/care", 7)).status === 503 && (await call("/assets/1/care", 7)).status === 503, "before 0195: the maintenance routes answer not_ready, never a broken page");
      const g0 = await call("/assets", 7);
      ok(g0.status === 200 && g0.j.care_live === false, "before 0195: the register says maintenance is not open yet");
      ok((await call("/assets/2", 7, "PATCH", { status: "repair" })).status === 200 && statusOf(2) === "repair", "before 0195: the status is still changed as before");
      ok((await call("/assets/1/custody", 7, "POST", { action: "return", condition: "damaged", reason: "Hinge broke off" })).status === 200 && statusOf(1) === "repair", "before 0195: a damaged return still works (no issue table to write)");
      return out;
    }
    /* ---- who reads what ---- */
    ok((await call("/assets/care", 6)).status === 200 && (await call("/assets/care", 7)).status === 200, "the CCO and HR read the board");
    ok((await call("/assets/care", 15)).status === 403 && (await call("/assets/care", 9)).status === 403 && (await call("/assets/care", 21)).status === 403, "a salesperson, a manager and an agent never read the board (direct request)");
    ok((await call("/assets/1/care", 15)).status === 200 && (await call("/assets/1/care", 9)).status === 200, "the holder and the holder's manager read the asset's records");
    ok((await call("/assets/1/care", 20)).status === 403 && (await call("/assets/1/care", 21)).status === 403 && (await call("/assets/3/care", 9)).status === 403, "nobody else does - not another holder, not an agent, not a manager outside the team");
    ok(rows("asset_incidents", 4).length === 0 && rows("asset_repairs", 6).length === 0, "nothing is invented for a status set before 4.0");

    /* ---- issues ---- */
    const n0 = n(`SELECT COALESCE(MAX(id), 0) AS n FROM notifications`);
    ok((await act(1, 15, { action: "issue", description: "short" })).status === 400, "an issue says what is wrong (10 characters)");
    const is1 = await act(1, 15, { action: "issue", description: "Keyboard keys stick badly", noticed_on: "2026-11-12" });
    ok(is1.status === 201 && statusOf(1) === "in_use" && rows("asset_issues", 1).length === 1 && rows("asset_issues", 1)[0].actor_id === 15, "the holder reports an issue - a report, not a status change", is1.text);
    ok((await act(1, 20, { action: "issue", description: "Not mine but reporting it" })).status === 403, "someone who neither holds it nor keeps the register cannot report on it");
    ok((await act(1, 9, { action: "issue", description: "Battery drains within an hour" })).status === 201, "the holder's manager reports an issue");
    ok((await act(5, 6, { action: "issue", description: "Wheel came off the base" })).status === 201, "the CCO (a reader of the register) reports an issue");
    const notes = db.prepare(`SELECT user_id, message FROM notifications WHERE id > ?`).all(n0);
    ok(notes.some((x) => x.user_id === 7 && x.message.includes("ET-0001/2026")) && notes.every((x) => !/RM|5147|514700/.test(x.message)), "the keepers are told by tag - never a cost", JSON.stringify(notes));

    /* ---- repairs ---- */
    const issueId = rows("asset_issues", 1)[0].id, issue2 = rows("asset_issues", 1)[1].id;
    ok((await act(1, 15, { action: "repair_sent", repairer: "Fix Shop" })).status === 403 && (await act(1, 6, { action: "repair_sent", repairer: "Fix Shop" })).status === 403, "the holder and the CCO cannot record a repair (direct request)");
    ok((await act(1, 7, { action: "repair_sent", repairer: "" })).status === 400, "a repair names the repairer");
    const se = await act(1, 7, { action: "repair_sent", repairer: "Fix Shop", reference: "JOB-77", expected_on: "2026-11-20", issue_id: issueId });
    ok(se.status === 201 && statusOf(1) === "repair" && holder(1) === 15 && rows("asset_repairs", 1)[0].issue_id === issueId && rows("asset_repairs", 1)[0].status_before === "in_use", "HR sends it for repair: one row and In repair written together; the holder stays", se.text);
    ok((await act(1, 7, { action: "repair_sent", repairer: "Other Shop" })).status === 409, "it cannot be sent twice");
    ok((await call("/assets/1", 7, "PATCH", { status: "in_use" })).status === 409 && statusOf(1) === "repair", "a plain edit cannot take it out of repair (use_care)");
    ok((await call("/assets/7", 7, "PATCH", { status: "lost" })).status === 409 && (await call("/assets/7", 7, "PATCH", { status: "disposed" })).status === 409 && statusOf(7) === "spare", "...nor mark an asset lost or disposed");
    ok((await call("/assets/7", 7, "PATCH", { status: "in_use" })).status === 200 && (await call("/assets/7", 7, "PATCH", { status: "spare" })).status === 200, "In use and Spare still change by an edit");
    ok((await call("/assets", 7, "POST", { name: "Ghost Laptop", status: "disposed" })).status === 409, "a new asset cannot start disposed, lost or in repair");
    ok((await act(1, 7, { action: "repair_back", outcome: "fixed", expense_id: 999 })).status === 400, "an expense link must be a real expense - it is never created");
    ok((await act(1, 7, { action: "repair_back", outcome: "fixed", cost: "abc" })).status === 400, "the cost note is an amount");
    const bk = await act(1, 7, { action: "repair_back", outcome: "fixed", cost: "150.50", expense_id: 41, note: "Keyboard replaced" });
    const back = rows("asset_repairs", 1).at(-1);
    ok(bk.status === 200 && statusOf(1) === "in_use" && back.kind === "back" && back.ref_id === rows("asset_repairs", 1)[0].id && back.cost_cents === 15050 && back.expense_id === 41, "back fixed: to its holder (In use), the cost a note, the expense linked", bk.text);
    const board = await call("/assets/care", 7);
    ok(!board.j.issues.some((x) => x.id === issueId) && board.j.issues.some((x) => x.id === issue2), "the issue the repair answered is closed; the other stays open", JSON.stringify(board.j.issues));
    ok((await act(1, 7, { action: "resolve", issue_id: issue2, note: "ok" })).status === 400, "resolving says how");
    ok((await act(1, 7, { action: "resolve", issue_id: issue2, note: "Battery recalibrated in-house" })).status === 200 && !(await call("/assets/care", 7)).j.issues.some((x) => x.id === issue2), "HR resolves an issue with no repair");
    const mine = await call("/assets/1/care", 15);
    ok(mine.status === 200 && mine.j.events.length >= 4 && mine.j.events.every((e) => !("cost_cents" in e) && !("expense_id" in e) && !("proceeds_cents" in e)) && !mine.text.includes("15050"), "the holder sees what happened, never a cost", mine.text.slice(0, 300));
    ok((await call("/assets/1/care", 7)).j.events.some((e) => e.cost_cents === 15050), "the keepers see the cost note");
    const audits = db.prepare(`SELECT detail FROM audit_log WHERE action LIKE 'asset.care_%'`).all();
    ok(audits.length >= 6 && audits.every((r) => !/cost_cents|proceeds_cents|15050/.test(r.detail ?? "")), "every step is audited by tag - no money in the audit");

    /* ---- not repairable, and the expected-back Task ---- */
    db.prepare(`INSERT INTO asset_repairs (asset_id, kind, repairer, expected_on, status_before, actor_id, actor_role) VALUES (2, 'sent', 'Screen Lab', date('now', '-2 days'), 'spare', 7, 'hr_admin')`).run();
    db.exec(`UPDATE assets SET status = 'repair' WHERE id = 2`);
    const t1 = await S.assetRepairSweep(env), t2 = await S.assetRepairSweep(env);
    ok(t1 === 1 && t2 === 0 && n(`SELECT COUNT(*) AS n FROM tasks WHERE link_kind = 'asset_repair' AND assigned_to = 7`) === 1, "a repair past its expected date becomes ONE Task for whoever sent it", `${t1} ${t2}`);
    ok((await act(2, 7, { action: "repair_back", outcome: "not_repairable" })).status === 400, "not repairable says why");
    ok((await act(2, 7, { action: "repair_back", outcome: "not_repairable", note: "Panel cracked beyond repair" })).status === 200 && statusOf(2) === "repair", "not repairable stays In repair (until a disposal)");

    /* ---- lost and found ---- */
    ok((await act(1, 15, { action: "lost", circumstances: "gone" })).status === 400, "a loss says what happened");
    const lo = await act(1, 15, { action: "lost", circumstances: "Left on the train after a client visit", last_seen_place: "LRT KL Sentral", last_seen_on: "2026-11-13", police_ref: "PDRM-123" });
    ok(lo.status === 201 && statusOf(1) === "lost" && holder(1) === 15 && rows("asset_incidents", 1)[0].holder_id === 15 && n(`SELECT COUNT(*) AS n FROM assets WHERE id = 1`) === 1, "the holder reports it lost: Lost, the last holder kept, the row never deleted", lo.text);
    ok((await act(1, 15, { action: "lost", circumstances: "Reporting it lost again" })).status === 409, "it cannot be lost twice");
    ok((await call("/assets/1/custody", 7, "POST", { action: "transfer", to_holder: 16, reason: "Give it to Ben instead" })).status === 409, "a lost asset is handed to nobody");
    ok((await act(1, 15, { action: "found" })).status === 403, "only the keepers record it found");
    const fd = await act(1, 7, { action: "found", where: "Lost and found counter" });
    ok(fd.status === 200 && statusOf(1) === "in_use" && rows("asset_incidents", 1).at(-1).ref_id === rows("asset_incidents", 1)[0].id, "found again: back with its holder (In use), answering the loss", fd.text);
    ok((await act(4, 7, { action: "found", where: "Studio drawer" })).status === 200 && statusOf(4) === "spare" && rows("asset_incidents", 4)[0].ref_id === null, "an asset lost before 4.0 is found with no invented incident");

    /* ---- disposal (D-6) ---- */
    ok((await act(1, 7, { action: "disposal_request", method: "sold", reason: "Old and slow laptop" })).status === 409, "a held asset is returned before its disposal is requested");
    ok((await act(2, 6, { action: "disposal_request", method: "sold", reason: "Panel cracked beyond repair" })).status === 403, "the CCO cannot request a disposal");
    ok((await act(2, 7, { action: "disposal_request", method: "burned", reason: "Panel cracked beyond repair" })).status === 400 && (await act(2, 7, { action: "disposal_request", method: "sold", reason: "short" })).status === 400, "a disposal names how, and why (10 characters)");
    const dq = await act(2, 7, { action: "disposal_request", method: "sold", reason: "Panel cracked beyond repair", proceeds: "30" });
    ok(dq.status === 201 && statusOf(2) === "repair" && rows("asset_disposals", 2)[0].proceeds_cents === 3000, "HR requests it: a request only - the status does not move", dq.text);
    ok((await act(2, 7, { action: "disposal_request", method: "scrapped", reason: "Panel cracked beyond repair" })).status === 409, "one disposal request at a time");
    ok((await act(2, 7, { action: "disposal_decide", decision: "approve" })).status === 403 && (await act(2, 6, { action: "disposal_decide", decision: "approve" })).status === 403 && (await act(2, 2, { action: "disposal_decide", decision: "approve" })).status === 403 && statusOf(2) === "repair", "HR, the CCO and the super admin cannot approve a disposal (direct request)");
    ok((await act(2, 1, { action: "disposal_decide", decision: "reject" })).status === 400, "a rejection says why");
    ok((await act(2, 1, { action: "disposal_decide", decision: "reject", reason: "Try the warranty first" })).status === 200 && statusOf(2) === "repair", "the CEO rejects it - the asset stays as it was");
    const dq2 = await act(2, 7, { action: "disposal_request", method: "scrapped", reason: "Warranty refused, panel cracked" });
    const ap = await act(2, 3, { action: "disposal_decide", decision: "approve" });
    ok(dq2.status === 201 && ap.status === 200 && statusOf(2) === "disposed" && rows("asset_disposals", 2).at(-1).status_before === "repair" && n(`SELECT COUNT(*) AS n FROM assets WHERE id = 2`) === 1, "the COO approves: Disposed, the row kept", ap.text);
    /* the COO's own request: the other approver decides */
    ok((await act(5, 3, { action: "disposal_request", method: "donated", reason: "Old chair for the community hall" })).status === 201, "the COO may request a disposal");
    const self = await act(5, 3, { action: "disposal_decide", decision: "approve" });
    ok(self.status === 403 && self.j?.error?.code === "self_approval" && statusOf(5) === "spare" && n(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'auth.self_approval_refused'`) >= 1, "...but never approves it (self-approval refused and audited)", self.text);
    ok((await act(5, 1, { action: "disposal_decide", decision: "approve" })).status === 200 && statusOf(5) === "disposed", "the CEO approves the COO's request");
    /* the verified owner may decide their own */
    ok((await act(6, 1, { action: "disposal_request", method: "written_off", reason: "Printer parts no longer made" })).status === 201 && (await act(6, 1, { action: "disposal_decide", decision: "approve" })).status === 200 && statusOf(6) === "disposed", "the verified owner may decide their own request");
    /* stale: someone holds it again since the request */
    ok((await act(7, 7, { action: "disposal_request", method: "sold", reason: "Spare tripod, not needed" })).status === 201, "a request on a spare tripod");
    await call("/assets/7/custody", 7, "POST", { action: "assign", to_holder: 16 });
    ok((await act(7, 1, { action: "disposal_decide", decision: "approve" })).status === 409 && statusOf(7) === "in_use", "a disposal is refused as stale once someone holds it again");

    /* ---- a disposed asset stays, as it is ---- */
    ok((await act(2, 7, { action: "issue", description: "Trying to report on it" })).status === 409 && (await call("/assets/2", 7, "PATCH", { status: "spare" })).status === 409 && (await call("/assets/2/custody", 7, "POST", { action: "assign", to_holder: 16 })).status === 409, "a disposed asset takes no new record, no status edit and no holder");
    const del = await call("/assets/2", 7, "DELETE", { reason: "typo" });
    ok(del.status === 409 && n(`SELECT COUNT(*) AS n FROM assets WHERE id = 2 AND deleted_at IS NULL`) === 1, "an asset with records is never removed as a typo", del.text);
    const g = await call("/assets", 7);
    ok(g.j.care_live === true && g.j.assets.some((a) => a.id === 2 && a.status === "disposed"), "the register still lists it as Disposed");
    const fb = (await call("/assets/care", 7)).j;
    ok(fb.disposed.some((x) => x.id === 2 && x.method === "scrapped" && x.approved_by === "Coo Person" && x.requested_by === "Hr Person") && fb.history.length >= 15, "the board shows who asked, who approved and how - and the service history", JSON.stringify(fb.disposed));
    ok(fb.disposed.some((x) => x.id === 6) && fb.lost.length === 0 && fb.pending.some((x) => x.asset_id === 7), "every disposal and pending request is on the board");

    /* ---- a damaged return is an issue ---- */
    await call("/assets/7/custody", 16, "POST", { action: "acknowledge" });
    ok((await call("/assets/7/custody", 16, "POST", { action: "return", condition: "damaged", reason: "Leg snapped" })).status === 200 && statusOf(7) === "repair" && rows("asset_issues", 7).some((x) => x.kind === "report" && /Leg snapped/.test(x.description)), "a damaged return is recorded as an issue on the asset");

    /* ---- append-only ---- */
    let blocked = 0;
    for (const t of ["asset_issues", "asset_repairs", "asset_incidents", "asset_disposals"]) for (const sql of [`UPDATE ${t} SET actor_id = 99`, `DELETE FROM ${t}`]) { try { db.exec(sql); } catch { blocked++; } }
    ok(blocked === 8, "the four tables refuse every update and delete", String(blocked));
    ok(finance() === before, "nothing is written to expenses, journals, cash, payments or commission", `${before} -> ${finance()}`);
    ok(n(`SELECT COUNT(*) AS n FROM assets WHERE asset_tag = 'ET-0001/2026' AND purchase_price_cents = 514700`) === 1, "the existing tag and price are untouched");
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
const dir = mkdtempSync(join(tmpdir(), "acare-"));
bundle(root, "worker/src/index.ts", join(dir, "worker.mjs"));
bundle(root, "worker/src/assets.ts", join(dir, "assets.mjs"));
report(await runtime(join(dir, "worker.mjs"), join(dir, "assets.mjs"), true));
report(await runtime(join(dir, "worker.mjs"), join(dir, "assets.mjs"), false));
const checks = n;
const A = "worker/src/assets.ts", S = "worker/src/staff.ts";
const MUT = [
  [A, "deciding your own disposal", [["    if (open.disposal.actor_id === user.id && !isExecutiveOwner(user)) {", "    if (false) {"]]],
  [A, "a keeper approves a disposal", [["    if (!approve) return err(\"forbidden\", \"Only the CEO or COO decides a disposal.\", 403);", "    if (!manage) return err(\"forbidden\", \"Only the CEO or COO decides a disposal.\", 403);"]]],
  [A, "the record without the status", [["  if (status && status !== a.status) stmts.push(", "  if (false) stmts.push("]]],
  [S, "a plain edit into or out of repair", [["&& (await careLive(env))) {\n      return err(\"use_care\"", "&& false) {\n      return err(\"use_care\""]]],
  [A, "the holder sees the cost", [["const events = view ? rows : rows.map(", "const events = view || true ? rows : rows.map("]]],
  [A, "anyone reports", [["const reporter = view || holder || teamLead;", "const reporter = true;"]]],
  [A, "a held asset disposed", [["    if (a.assigned_to != null) return err(\"invalid_state\", \"Someone holds it - return it first, then request the disposal.\", 409);", ""]]],
  [A, "any expense number linked", [["      if (!ok) return err(\"invalid_input\", \"No expense with that number", "      if (false) return err(\"invalid_input\", \"No expense with that number"]]],
  [A, "the repair Task repeats", [["          AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.link_kind = 'asset_repair' AND t.link_id = s.id)", ""]]],
  [A, "a stale disposal approved", [["    if (a.assigned_to != null) return err(\"stale\"", "    if (false) return err(\"stale\""]]],
  [S, "an asset with records removed", [["      if (realD) return err(\"has_records\"", "      if (false) return err(\"has_records\""]]],
  [S, "a new asset born disposed", [["if ((CARE_STATUSES as readonly string[]).includes(String(body?.status)) && (await careLive(env))) return err(\"use_care\"", "if (false) return err(\"use_care\""]]],
  [A, "fixed goes to Spare even when held", [["outcome === \"fixed\" ? (a.assigned_to != null ? \"in_use\" : \"spare\") : undefined", "outcome === \"fixed\" ? \"spare\" : undefined"]]],
  [A, "a repair never closes its issue", [["  AND NOT EXISTS (SELECT 1 FROM asset_repairs b JOIN asset_repairs s ON s.id = b.ref_id WHERE b.kind = 'back' AND b.outcome = 'fixed' AND s.issue_id = i.id)\n", ""]]],
];
for (const [file, name, reps] of NOMUT ? [] : MUT) {
  n++;
  let src = readFileSync(join(root, file), "utf8");
  let applied = true;
  for (const [from, to] of reps) { if (!src.includes(from)) { applied = false; break; } src = src.replace(from, to); }
  if (!applied) { fail++; console.error(`FAIL mutation did not apply: ${name}`); continue; }
  const mdir = mkdtempSync(join(tmpdir(), "acare-m-"));
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
if (fail) { console.error(`asset-care: ${fail} of ${n} failed`); process.exit(1); }
console.log(`asset-care: ${checks} checks passed (${NOMUT ? "mutations skipped" : `${MUT.length} mutations caught`}) - issues by the holder, their manager or the readers; repairs and finds by the keepers; a disposal approved only by the CEO or COO and never by who asked; each record and its status written together; no plain status edit; costs are notes the holder never sees; nothing deleted, nothing posted to Finance`);
