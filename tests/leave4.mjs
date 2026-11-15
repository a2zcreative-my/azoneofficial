/* v1.309.0 - LEAVE WORKSPACE 4.0 (the CEO, 15-11-2026: "approve as recommend
   and make sure it is correct flow", L-0 ... L-15 in
   claude/LEAVE-WORKSPACE-4.0-BLUEPRINT.md). The WHOLE worker bundled against
   SQLite with every migration applied, by direct request as each person -
   never by what a screen happens to show. Fixed clock: Wednesday 04-11-2026,
   12:00 MYT. Invented people only. Each rule is MUTATED and must be caught.

   What must hold:
     - the server counts the days: the roster's working days less the public
       holidays the person is entitled to; a half day is 0.5 on one working
       day; whatever number the client sends is ignored (L-3)
     - the preview (GET /leave/quote) is the submission's own checks, for the
       session's own leave only, and writes nothing
     - the reason is required; medical leave needs its certificate; an
       attachment is the applicant's own upload, used once, read only by the
       applicant, the people on its route, HR and the CEO - audited (L-4, L-5)
     - one balance: entitled + adjustments - approved - pending, the same on
       the balance screen, the preview and the submission; replacement leave
       is held to its credits (L-6, L-7)
     - the old legacy / organisation switch is gone (410) (L-1)
     - only the verified owner decides in an approver's place, always with a
       reason and his authenticator code, approve or reject (L-12)
     - a returned request resubmitted on its own dates keeps its days (an
       existing record is never recalculated)
     - availability is Attendance's own day verdict: a pending request is not
       leave; the replacement-credit ledger is read only; the policy is read
       from the rules
     - the screens: five views, the rest-day / overtime decision lives in
       Attendance, no switch, decisions in the queue and the drawer only.

     node tests/leave4.mjs          (NOMUT=1 skips the mutations) */
import { readFileSync, readdirSync, mkdtempSync, cpSync, writeFileSync, rmSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash, createHmac } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const root = fileURLToPath(new URL("..", import.meta.url));
const bundle = (srcRoot, out) => {
  const entry = join(srcRoot, "leave4-entry.ts");
  writeFileSync(entry, `export { default } from "./worker/src/index.ts";\n`);
  try { execSync(`npx esbuild "${entry}" --bundle --format=esm --platform=neutral --outfile="${out}" --log-level=error`, { cwd: root, stdio: "inherit" }); }
  finally { rmSync(entry, { force: true }); }
};
const sha = (s) => createHash("sha256").update(s).digest("hex");
const MIGS = readdirSync(join(root, "worker/migrations")).filter((x) => x.endsWith(".sql")).sort();
const applyFile = (db, f) => {
  const src = readFileSync(join(root, "worker/migrations", f), "utf8");
  let buf = "";
  for (const st of src.split(/;\s*\n/)) {
    buf = buf ? `${buf};\n${st}` : st;
    if (/CREATE TRIGGER/i.test(buf) && !/\bEND\s*$/i.test(buf.trim())) continue;
    try { db.exec(buf); } catch { /* an older statement the later ones replace */ }
    buf = "";
  }
};
const SECRET = "JBSWY3DPEHPK3PXP";
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const b32 = (s) => { let bits = 0, v = 0; const o = []; for (const ch of s) { v = (v << 5) | B32.indexOf(ch); bits += 5; if (bits >= 8) { o.push((v >>> (bits - 8)) & 255); bits -= 8; } } return Buffer.from(o); };
const totpAt = (ms) => { const c = Math.floor(ms / 30000); const b = Buffer.alloc(8); b.writeUInt32BE(Math.floor(c / 2 ** 32), 0); b.writeUInt32BE(c >>> 0, 4); const h = createHmac("sha1", b32(SECRET)).update(b).digest(); const o = h[h.length - 1] & 15; return String(((h.readUInt32BE(o) & 0x7fffffff) % 1000000)).padStart(6, "0"); };
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

async function runtime(workerBundle) {
  const out = [];
  const ok = (c, m, why = "") => out.push([!!c, why && !c ? `${m} - ${why}` : m]);
  const db = new DatabaseSync(":memory:");
  const realClock = new DatabaseSync(":memory:");
  for (const fn of ["datetime", "date", "time", "julianday"]) db.function(fn, { varargs: true }, (...a) => realClock.prepare(`SELECT ${fn}(${(a.length ? a : ["now"]).map(() => "?").join(",")}) AS v`).get(...a.map((x, i) => (i === 0 && typeof x === "string" && x.toLowerCase() === "now" ? new Date().toISOString().slice(0, 19).replace("T", " ") : x))).v);
  for (const f of MIGS) applyFile(db, f);
  const shim = (sql) => { const st = db.prepare(sql); let b = []; const o = {
    bind: (...a) => { b = a.map((x) => (x === undefined ? null : x)); return o; },
    first: async () => st.get(...b) ?? null, all: async () => ({ results: st.all(...b) }),
    run: async () => ({ meta: { changes: Number(st.run(...b).changes) } }), _run: () => st.run(...b) }; return o; };
  /* private storage that keeps what is put, so the attachment can be read back */
  const store = new Map();
  const env = {
    DB: { prepare: shim, batch: async (list) => { db.exec("BEGIN"); try { for (const s of list) s._run(); db.exec("COMMIT"); } catch (e) { db.exec("ROLLBACK"); throw e; } return []; } },
    SESSION_PEPPER: "pepper", COMPANY_DOMAIN: "a2z.test", ALLOWED_ORIGINS: "https://portal.a2z.test",
    MEDIA: {
      put: async (key, body, opts) => { const bytes = new Uint8Array(await new Response(body).arrayBuffer()); store.set(key, { bytes, ct: opts?.httpMetadata?.contentType ?? "application/octet-stream" }); },
      get: async (key) => { const o = store.get(key); return o ? { body: o.bytes, httpMetadata: { contentType: o.ct } } : null; },
      head: async () => null, list: async () => ({ objects: [] }), delete: async () => {},
    },
  };
  if (!globalThis.FixedLengthStream) globalThis.FixedLengthStream = class extends TransformStream { constructor() { super(); } };
  const RealDate = globalThis.Date;
  let fixed = Date.parse("2026-11-04T04:00:00Z");
  globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [fixed])); } static now() { return fixed; } };
  const code = () => { fixed += 31000; return totpAt(fixed); };
  const U = { ceo: 1, sa: 2, coo: 3, cco: 4, aina: 5, hana: 6, lia: 7, nora: 9 };
  db.exec(`INSERT INTO users (id, name, full_name, email, role, is_active, password_hash, totp_enabled, totp_secret, employment_status, base_salary_cents, position, department, reports_to, joined_on) VALUES
    (1,'Alif','Alif Farhan','alif@a2z.test','ceo',1,'x',1,'${SECRET}','permanent',900000,'Chief Executive Officer','Management',NULL,'2024-01-01'),
    (2,'Root','System Root','root@a2z.test','super_admin',1,'x',1,'${SECRET}','permanent',0,NULL,NULL,NULL,NULL),
    (3,'Ops','Ops Lead','ops@a2z.test','coo',1,'x',1,'${SECRET}','permanent',800000,'Chief Operational Officer','Management',1,'2024-01-01'),
    (4,'Cee','Cee Officer','cco@a2z.test','cco',1,'x',1,'${SECRET}','permanent',800000,'Chief Commercial Officer','Management',1,'2024-01-01'),
    (5,'Aina','Aina Seller','aina@a2z.test','sales_marketing',1,'x',1,'${SECRET}','permanent',300000,'Designer','Sales and Marketing',4,'2025-01-01'),
    (6,'Hana','Hana HR','hana@a2z.test','hr_admin',1,'x',1,'${SECRET}','permanent',400000,'Administrative Executive','HR and Admin',4,'2025-01-01'),
    (7,'Lia','Lia Seller','lia@a2z.test','sales_marketing',1,'x',1,'${SECRET}','permanent',300000,'Creative','Sales and Marketing',3,'2025-01-01'),
    (9,'Nora','Nora New','nora@a2z.test','sales_marketing',1,'x',1,'${SECRET}','permanent',300000,'Sales Executive','Sales and Marketing',4,'2026-11-10')`);
  db.exec(`INSERT INTO system_meta (key, value) VALUES ('company_owner', '{"user_id":1,"set_by":2,"set_by_name":"Root","set_at":"2026-11-02 06:00:54","reason":"test"}')`);
  /* HR's calendar, as the migrations seed it: Deepavali on Sunday 08-11-2026, its replacement on Monday 09-11 */
  const mod = (await import(pathToFileURL(workerBundle).href + `?v=${Math.random()}`));
  const app = mod.default;
  const tok = {};
  for (const id of Object.values(U)) { tok[id] = `t-${id}-${Math.random()}`; db.prepare(`INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, datetime('now', '+30 days'), datetime('now'))`).run(sha(tok[id]), id); }
  const call = async (path, uid, method = "GET", body, raw) => {
    const h = { origin: "https://portal.a2z.test", cookie: `azone_session=${tok[uid]}; csrf_token=c1`, "x-csrf-token": "c1", "content-type": raw ? raw.type : "application/json", ...(raw ? { "content-length": String(raw.bytes.length), "x-file-name": raw.name } : {}) };
    const r = await app.fetch(new Request(`https://api.a2z.test/api/v1/staff${path}`, { method, headers: h, body: raw ? raw.bytes : body === undefined ? undefined : JSON.stringify(body) }), env, { waitUntil() {} });
    const ct = r.headers.get("content-type") ?? "";
    const text = ct.includes("json") ? await r.text() : `<${(await r.arrayBuffer()).byteLength} bytes ${ct}>`;
    let j = null; try { j = JSON.parse(text); } catch { /* not json */ }
    return { status: r.status, j, text };
  };
  const one = (sql, ...a) => db.prepare(sql).get(...a);
  const n = (sql, ...a) => Number(db.prepare(sql).get(...a)?.n ?? 0);
  const tables = () => sha(JSON.stringify(["leave_requests", "leave_balances", "leave_decisions", "audit_log", "media", "notifications"].map((t) => db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all())));
  const pdf = (name = "mc.pdf", size = 2048) => { const b = new Uint8Array(size); b.set(Buffer.from("%PDF-1.4\n")); return { type: "application/pdf", bytes: b, name }; };
  try {
    /* ---------- the preview: the server's count, own leave only, writes nothing ---------- */
    const before = tables();
    const q1 = await call(`/leave/quote?type=annual&start=2026-11-06&end=2026-11-10`, U.aina);
    ok(q1.status === 200 && q1.j?.days === 2 && q1.j.lines.map((l) => `${l.kind}:${l.count}`).join(" ") === "work:1 rest_day:0 rest_day:0 holiday:0 work:1", "L-3: Fri 06 to Tue 10 November is 2 working days - the weekend is the roster's rest, the Deepavali replacement day is HR's holiday", q1.text.slice(0, 300));
    ok(q1.j?.lines[3]?.holiday === "Hari Deepavali (Replacement)" && q1.j?.problem === null, "...the holiday is named");
    ok(q1.j?.route?.steps?.map((s) => `${s.approver.name}${s.final ? "*" : ""}`).join(">") === "Cee Officer>Alif Farhan*", "the preview shows the route the request would be frozen with: the CCO, then the CEO (final)", JSON.stringify(q1.j?.route));
    ok(q1.j?.balance?.before === 14 && q1.j?.balance?.after === 12, "...and the balance before (14) and after (12)", JSON.stringify(q1.j?.balance));
    ok(tables() === before, "the preview writes nothing - not a request, a balance, an audit line or a notification");
    ok((await call(`/leave/quote?type=annual&start=2026-11-06&end=2026-11-10&user_id=${U.hana}`, U.aina)).status === 403, "the preview is for your own leave only - another person's balance or route is refused");
    const qh = await call(`/leave/quote?type=annual&start=2026-11-11&end=2026-11-11&part=first_half`, U.aina);
    ok(qh.j?.days === 0.5 && qh.j?.problem === null, "a half day is 0.5 on one working day", qh.text.slice(0, 200));
    ok((await call(`/leave/quote?type=annual&start=2026-11-11&end=2026-11-12&part=first_half`, U.aina)).j?.problem?.message?.includes("Half-day"), "...never across two dates");
    ok(/public holiday/.test((await call(`/leave/quote?type=annual&start=2026-11-09&end=2026-11-09`, U.aina)).j?.problem?.message ?? ""), "a range that is only a holiday has no working day to take");
    ok((await call(`/leave/quote?type=annual&start=2026-11-09&end=2026-11-09`, U.nora)).j?.days === 1, "a holiday the person is not entitled to (they joined after it) is a working day for them - Attendance's own rule", (await call(`/leave/quote?type=annual&start=2026-11-09&end=2026-11-09`, U.nora)).text.slice(0, 200));
    /* ---------- the submission: the server's count, the reason, the certificate ---------- */
    const noR = await call(`/leave`, U.aina, "POST", { type: "annual", start_date: "2026-11-06", end_date: "2026-11-10", days: 5 });
    ok(noR.status === 400 && noR.j?.error?.code === "reason_required", "L-5: the reason is required");
    const A = await call(`/leave`, U.aina, "POST", { type: "annual", start_date: "2026-11-06", end_date: "2026-11-10", days: 5, reason: "Family matters in Melaka" });
    ok(A.status === 201 && A.j?.days === 2 && one(`SELECT days FROM leave_requests WHERE id = ?`, A.j.id)?.days === 2, "L-3: the client sent 5 days - the server stored the 2 it counted", A.text.slice(0, 200));
    ok(A.j?.stage === "routed" && one(`SELECT approver_id FROM leave_requests WHERE id = ?`, A.j.id)?.approver_id === U.cco, "...routed by the chart to the CCO - the request the preview described");
    ok((await call(`/leave/${A.j.id}`, U.aina, "PATCH", { action: "approve" })).status === 403, "no self-approval");
    const bal = (await call(`/leave/balance`, U.aina)).j?.balances?.annual;
    ok(bal?.pending === 2 && bal?.available === 12 && bal?.used === 0, "L-7: the balance screen shows 2 pending and 12 available - the same ledger the submission is checked against", JSON.stringify(bal));
    const q2 = await call(`/leave/quote?type=annual&start=2026-11-16&end=2026-11-27`, U.aina);
    ok(q2.j?.days === 10 && q2.j?.balance?.before === 12 && q2.j?.balance?.after === 2, "the next preview starts from 12 - the pending days are held", JSON.stringify(q2.j?.balance));
    ok((await call(`/leave`, U.aina, "POST", { type: "medical", start_date: "2026-11-11", end_date: "2026-11-11", reason: "Flu, doctor's rest" })).j?.error?.code === "attachment_required", "L-4: medical leave needs its certificate");
    /* ---------- the attachment ---------- */
    ok((await call(`/leave/attachment`, U.aina, "POST", undefined, { type: "text/plain", bytes: new Uint8Array(10), name: "x.txt" })).status === 400, "only PDF, JPG or PNG");
    ok((await call(`/leave/attachment`, U.aina, "POST", undefined, pdf("big.pdf", 11 * 1048576))).status === 413, "never above 10 MB");
    const up = await call(`/leave/attachment`, U.aina, "POST", undefined, pdf());
    ok(up.status === 201 && up.j?.media_id > 0 && one(`SELECT uploaded_by, r2_key FROM media WHERE id = ?`, up.j.media_id)?.uploaded_by === U.aina && /^private\/leave\//.test(one(`SELECT r2_key FROM media WHERE id = ?`, up.j.media_id)?.r2_key ?? ""), "the certificate is stored privately, recorded as Aina's", up.text.slice(0, 200));
    const hup = await call(`/leave/attachment`, U.hana, "POST", undefined, pdf("hana.pdf"));
    ok((await call(`/leave`, U.aina, "POST", { type: "medical", start_date: "2026-11-11", end_date: "2026-11-11", reason: "Flu, doctor's rest", mc_media_id: hup.j?.media_id })).status === 400, "someone else's upload cannot be attached");
    const M = await call(`/leave`, U.aina, "POST", { type: "medical", start_date: "2026-11-11", end_date: "2026-11-11", reason: "Flu, doctor's rest", mc_media_id: up.j?.media_id });
    ok(M.status === 201 && one(`SELECT mc_media_id FROM leave_requests WHERE id = ?`, M.j?.id)?.mc_media_id === up.j?.media_id, "...her own is", M.text.slice(0, 200));
    ok((await call(`/leave`, U.aina, "POST", { type: "medical", start_date: "2026-11-12", end_date: "2026-11-12", reason: "Flu, still resting", mc_media_id: up.j?.media_id })).status === 400, "one upload belongs to one request");
    const mine = (await call(`/leave`, U.aina)).j?.leave?.find((l) => l.id === M.j?.id);
    ok(mine?.has_attachment === true && typeof mine?.last_update === "string", "the list says a document is on file, and when the record last moved");
    const views0 = n(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'leave.attachment_view'`);
    ok((await call(`/leave/${M.j.id}/attachment`, U.lia)).status === 404, "a colleague not on the route reaches nothing");
    ok((await call(`/leave/${M.j.id}/attachment`, U.coo)).status === 404, "...nor does an executive who is not on it");
    ok((await call(`/leave/${M.j.id}/attachment`, U.aina)).status === 200, "the applicant reads it");
    ok((await call(`/leave/${M.j.id}/attachment`, U.cco)).status === 200 && (await call(`/leave/${M.j.id}/attachment`, U.ceo)).status === 200 && (await call(`/leave/${M.j.id}/attachment`, U.hana)).status === 200, "the route's approvers (the CCO, the CEO) and HR read it");
    ok(n(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'leave.attachment_view'`) === views0 + 3, "...every read by someone else is audited; the applicant's own is not");
    /* ---------- replacement leave is held to its credits ---------- */
    ok((await call(`/leave`, U.lia, "POST", { type: "replacement", start_date: "2026-11-13", end_date: "2026-11-13", reason: "Rest after the Raya live" })).j?.error?.code === "over_entitlement", "L-6: replacement leave with no credit is refused");
    db.exec(`INSERT INTO leave_balances (user_id, year, type, entitled, adjust) VALUES (7, 2026, 'replacement', 0, 1)`);
    ok((await call(`/leave`, U.lia, "POST", { type: "replacement", start_date: "2026-11-13", end_date: "2026-11-13", reason: "Rest after the Raya live" })).status === 201, "...one credited day is one day to take");
    ok((await call(`/leave`, U.lia, "POST", { type: "replacement", start_date: "2026-11-16", end_date: "2026-11-16", reason: "Another rest day" })).j?.error?.code === "over_entitlement", "...and not a second");
    /* ---------- the switch is gone ---------- */
    ok((await call(`/leave/routing`, U.ceo, "PUT", { mode: "legacy", totp: code() })).status === 410 && (await call(`/leave/routing`, U.ceo)).j?.mode === "organisation", "L-1: no legacy / organisation switch - the CEO's PUT is gone (410)");
    /* ---------- the override: the verified owner only, a reason and his code ---------- */
    ok((await call(`/leave/${A.j.id}`, U.sa, "PATCH", { action: "approve", override: true, comment: "Approved as discussed", totp: code() })).status === 403, "L-12: the Super Admin cannot decide in an approver's place");
    ok((await call(`/leave/${A.j.id}`, U.ceo, "PATCH", { action: "reject", override: true, totp: code() })).j?.error?.code === "reason_required", "...the owner gives a reason");
    ok((await call(`/leave/${A.j.id}`, U.ceo, "PATCH", { action: "reject", override: true, comment: "Year-end stock count" })).status === 401, "...and his authenticator code, for a rejection too");
    const ov = await call(`/leave/${A.j.id}`, U.ceo, "PATCH", { action: "reject", override: true, comment: "Year-end stock count", totp: code() });
    ok(ov.j?.stage === "rejected" && n(`SELECT COUNT(*) AS n FROM leave_decisions WHERE leave_id = ? AND kind = 'override'`, A.j.id) === 1 && n(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'leave.override_reject' AND entity_id = ?`, String(A.j.id)) === 1, "...recorded as an override - never as the CCO's decision", ov.text.slice(0, 200));
    /* ---------- a returned request keeps the days it was submitted with ---------- */
    db.exec(`INSERT INTO leave_requests (id, user_id, type, start_date, end_date, days, reason, status, stage, returned_from, route_json, route_version, step_no, approver_id, created_at)
      VALUES (700, 7, 'annual', '2026-11-06', '2026-11-10', 3, 'Typed before 1.309.0', 'pending', 'returned', 'routed', '${JSON.stringify({ v: 2, kind: "manager", applicant: { id: 7, name: "Lia Seller", position: null, role: "sales_marketing", department: null, manager_id: 3 }, steps: [{ n: 1, key: "line", approver: { id: 3, name: "Ops Lead", position: null, role: "coo", department: null }, basis: "reporting_line", final: false }, { n: 2, key: "line", approver: { id: 1, name: "Alif Farhan", position: null, role: "ceo", department: null }, basis: "reporting_line", final: true }] })}', 2, 1, 3, datetime('now'))`);
    ok((await call(`/leave/700`, U.lia, "PATCH", { action: "resubmit", comment: "Lia: clients covered" })).j?.stage === "routed" && one(`SELECT days FROM leave_requests WHERE id = 700`).days === 3, "a request from before, resubmitted on its own dates, keeps its 3 days - an existing record is never recalculated");
    db.exec(`UPDATE leave_requests SET stage = 'returned', returned_from = 'routed' WHERE id = 700`);
    ok((await call(`/leave/700`, U.lia, "PATCH", { action: "resubmit", comment: "Moved a week", start_date: "2026-11-23", end_date: "2026-11-24" })).j?.stage === "routed" && one(`SELECT days FROM leave_requests WHERE id = 700`).days === 2, "...new dates are counted by the server like a new request");
    /* ---------- availability, the credit ledger, the policy ---------- */
    db.exec(`INSERT INTO leave_requests (user_id, type, start_date, end_date, days, reason, status, stage, created_at) VALUES (3, 'annual', '2026-11-04', '2026-11-04', 1, 'Approved before', 'approved', 'approved', datetime('now')), (4, 'annual', '2026-11-04', '2026-11-04', 1, 'Still waiting', 'pending', 'routed', datetime('now'))`);
    const av = await call(`/leave/availability?day=2026-11-04`, U.lia);
    ok(av.status === 200 && av.j?.on_leave === 1 && av.j?.pending === 1 && av.j?.available === av.j?.total - 1 - av.j?.off, "availability is Attendance's day verdict: the approved leave is away, the pending request is still at work (and counted as pending)", av.text.slice(0, 200));
    ok(Object.keys(av.j ?? {}).every((k) => ["day", "total", "available", "on_leave", "off", "pending"].includes(k)), "...counts only - no names, types or reasons");
    db.exec(`INSERT INTO replacement_credits (user_id, work_date, days, minutes, credited_by) VALUES (7, '2026-11-01', 1, 480, 1)`);
    ok(((await call(`/leave/replacement-credits`, U.lia)).j?.credits ?? []).length === 1 && (await call(`/leave/replacement-credits?user_id=7`, U.aina)).status === 403 && ((await call(`/leave/replacement-credits?all=1`, U.hana)).j?.credits ?? []).length === 1, "L-8: the replacement-credit ledger is read only - your own; HR and the CEO anyone's");
    const pol = (await call(`/leave/policy`, U.aina)).j;
    ok(pol?.defaults?.annual === 14 && pol?.defaults?.medical === 14 && pol?.can_edit === false && (await call(`/leave/policy`, U.ceo)).j?.can_edit === true, "the policy card reads the rules in force (14 / 14), editable only by the entitlement holders");
  } catch (e) {
    out.push([false, `runtime: ${e?.stack ?? e}`]);
  } finally {
    globalThis.Date = RealDate;
  }
  return out;
}

/* ---- the screens, by their source ---- */
function screens() {
  const out = [];
  const ok = (c, m) => out.push([!!c, m]);
  const read = (f) => readFileSync(join(root, f), "utf8");
  const leave = strip(read("components/portal/leave.tsx"));
  const l4 = strip(read("components/portal/leave4.tsx"));
  const ov = strip(read("components/portal/leave-overview.tsx"));
  const exc = strip(read("components/portal/attendance-exceptions.tsx"));
  ok(/export const LEAVE_VIEWS: readonly LeaveView4\[\] = \["overview", "apply", "mine", "calendar", "manage"\]/.test(l4) && /useTabViewAddress\("Leave", shown, setView, isLeaveView\)/.test(leave), "L-0: exactly five views, each in the address");
  ok(!/RestDayCreditCard/.test(leave) && /<RestDayCreditCard role=\{user\.role\} \/>/.test(exc), "L-8: rest days worked (replacement or overtime) are decided in Attendance only");
  ok(!/\/staff\/leave\/routing`, \{ method: "PUT"/.test(ov + leave + l4) && !/ApprovalRoute|MiniCalendar|LeaveOverview\b/.test(ov), "L-1 / L-9: no switch, no second calendar, no old Overview");
  ok(!/<BalanceCard|MyBalances4/.test(strip(l4.slice(l4.indexOf("export function LeaveOverview4"), l4.indexOf("export function TeamAvailability")))), "D-1: the balance is not on the Overview - My Leave only");
  ok(/const canOverride = user\.role === "ceo" && user\.is_owner === true;/.test(leave) && !/overrideAct\(l, "approve"\)/.test(leave), "L-12: the override is offered to the owner only, from the details drawer - never on a list row");
  ok(/api<Quote & \{ error\?: \{ message\?: string \} \}>\(`\/staff\/leave\/quote\?\$\{qs\}`\)/.test(l4) && !/type="number"[^>]*draft\.days/.test(leave), "L-3: the form shows the server's count - there is no days box to type into");
  ok(/disabled=\{!ready\}/.test(l4) && /needFile = f\.type === "medical"/.test(l4), "the form cannot move on while the preview reports a problem, the reason is short, or a medical certificate is missing");
  return out;
}

let fail = 0, n = 0;
const report = (list) => { for (const [p, m] of list) { n++; if (!p) { fail++; console.error(`FAIL ${m}`); } } };
const dir = mkdtempSync(join(tmpdir(), "leave4-"));
const main = join(dir, "worker.mjs");
bundle(root, main);
report(await runtime(main));
report(screens());
const checks = n;
if (process.env.NOMUT) {
  if (fail) { console.error(`leave4: ${fail} of ${n} failed`); process.exit(1); }
  console.log(`leave4: ${n} checks passed`); process.exit(0);
}

const MUT = [
  ["worker/src/staff.ts", "the count ignores HR's holidays", "    else if (h && holidayEntitles(h, hols, who?.joined_on ?? null)) lines.push(", "    else if (false) lines.push("],
  ["worker/src/staff.ts", "the client's number of days is trusted", "        b = { ...bIn, days: cnt.days, day_part:", "        b = { ...bIn, days: typeof bIn.days === \"number\" ? bIn.days : cnt.days, day_part:"],
  ["worker/src/staff.ts", "the reason is optional", "    if (reasonA.length < 5 || reasonA.length > 500) return err(", "    if (false) return err("],
  ["worker/src/staff.ts", "medical leave without a certificate", "    if (body?.type === \"medical\" && !mediaA) return err(", "    if (false) return err("],
  ["worker/src/staff.ts", "anyone's upload may be attached", "WHERE id = ?1 AND uploaded_by = ?2 AND r2_key LIKE 'private/leave/%'", "WHERE id = ?1 AND (uploaded_by = ?2 OR 1) AND r2_key LIKE 'private/leave/%'"],
  ["worker/src/staff.ts", "the attachment is readable by anyone", "    if (rowF.user_id !== user.id && !onRoute && !can(user.role, \"hr_manage\")) return err(", "    if (false) return err("],
  ["worker/src/staff.ts", "the preview answers about another person", "    if (q.get(\"user_id\") && Number(q.get(\"user_id\")) !== user.id) return err(", "    if (false) return err("],
  ["worker/src/staff.ts", "pending days do not hold the balance", "COALESCE(SUM(CASE WHEN status NOT IN ('approved', 'rejected', 'cancelled') THEN days ELSE 0 END), 0) AS pending", "COALESCE(SUM(CASE WHEN status NOT IN ('approved', 'rejected', 'cancelled') THEN 0 ELSE 0 END), 0) AS pending"],
  ["worker/src/staff.ts", "replacement leave is not held to its credits", "export const LEAVE_CAPPED_TYPES: readonly string[] = [\"annual\", \"medical\", \"replacement\"];", "export const LEAVE_CAPPED_TYPES: readonly string[] = [\"annual\", \"medical\"];"],
  ["worker/src/staff.ts", "the Super Admin may override", "    if (body?.override === true && !(user.role === \"ceo\" && user.is_owner === true)) {", "    if (body?.override === true && ![\"ceo\", \"super_admin\"].includes(user.role)) {"],
  ["worker/src/staff.ts", "an override rejects without the code", "    if (override && action === \"reject\") {\n      const stepUpR = await requireFreshTotp(env, user, body?.totp, err, \"reject in place of the approver\");\n      if (stepUpR) return stepUpR;\n    }", ""],
  ["worker/src/staff.ts", "a resubmission recalculates an existing record", "      const sameDates = next.start_date", "      const sameDates = false && next.start_date"],
  ["worker/src/staff.ts", "the switch comes back", "    return err(\"gone\", \"Leave is always approved by the Organisation chart - the old switch was retired in 1.309.0\", 410);", "    return json({ ok: true, mode: \"legacy\" });"],
  ["worker/src/staff.ts", "pending leave counts as away", "    const onLeave = people.filter((p) => p.verdict.status === \"leave\");", "    const onLeave = people.filter((p) => p.verdict.status === \"leave\" || p.id === 4);"],
  ["components/portal/attendance-exceptions.tsx", "the rest-day decision leaves Attendance", "          <RestDayCreditCard role={user.role} />", "          {null}"],
];
for (const [file, name, from, to] of MUT) {
  n++;
  const src = readFileSync(join(root, file), "utf8");
  if (!src.includes(from)) { fail++; console.error(`FAIL mutation did not apply: ${name}`); continue; }
  if (file.startsWith("components/")) {
    writeFileSync(join(root, file), src.replace(from, to));
    let bad;
    try { bad = screens().filter(([p]) => !p).map(([, m]) => m); } finally { writeFileSync(join(root, file), src); }
    if (!bad.length) { fail++; console.error(`FAIL mutation not caught: ${name}`); } else console.log(`caught: ${name} -> ${bad[0]}`);
    continue;
  }
  const mdir = mkdtempSync(join(tmpdir(), "leave4-m-"));
  cpSync(join(root, "worker"), join(mdir, "worker"), { recursive: true, filter: (p) => !p.includes("node_modules") });
  cpSync(join(root, "package.json"), join(mdir, "package.json"));
  for (const d of ["lib", "constants", "types"]) { try { cpSync(join(root, d), join(mdir, d), { recursive: true }); } catch { /* not every folder exists */ } }
  writeFileSync(join(mdir, file), src.replace(from, to));
  try { bundle(mdir, join(mdir, "w.mjs")); } catch { fail++; console.error(`FAIL mutation did not build: ${name}`); continue; }
  const res = await runtime(join(mdir, "w.mjs"));
  const bad = res.filter(([p]) => !p).map(([, m]) => m);
  if (!bad.length) { fail++; console.error(`FAIL mutation not caught: ${name}`); }
  else console.log(`caught: ${name} -> ${bad.slice(0, 2).join("; ")}`);
  rmSync(mdir, { recursive: true, force: true });
}
rmSync(dir, { recursive: true, force: true });
if (fail) { console.error(`leave4: ${fail} of ${n} failed`); process.exit(1); }
console.log(`leave4: ${checks} checks passed (${MUT.length} mutations caught) - Leave 4.0 (v1.309.0): the server counts the days (roster less HR's holidays, half days), the preview is the submission's own checks and writes nothing, the reason and the medical certificate are required, an attachment is the applicant's own and read only by the route, HR and the CEO, one balance with pending held, replacement leave held to its credits, no switch, the owner alone overrides with a reason and his code, an existing record is never recalculated, availability is Attendance's verdict, the rest-day decision lives in Attendance`);
