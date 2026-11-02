/* THE AGENT PORTAL WORKFLOW (v1.250.0) - runtime guard: the WHOLE worker
 * bundled against SQLite with every migration applied, by direct request as
 * each role, a fake send_email binding and a fake R2. Fixed clock: Sunday
 * 01-11-2026, 12:00 Malaysia time (the authenticator clock steps 31 s per code).
 *
 * The owner's brief "Complete Agent Portal, Client Submission, Quotation
 * Distribution & Collaboration Workflow", claude/AGENT-PORTAL-AUDIT.md and his
 * "Approved" (01-11-2026). Each check names the brief's acceptance test it
 * proves (T1-T24). Test 23 (desktop and phone show the same history) is the
 * browser test tests/browser/agents.py; here the API both read is one.
 *
 *   node tests/go-live-h.mjs                                  the current worker, then mutations
 *   WORKER_BUNDLE=/path/bundle.mjs node tests/go-live-h.mjs   a given bundle (the 1.249.2 bundle must FAIL)
 */
import { readFileSync, readdirSync, mkdtempSync, cpSync, writeFileSync, rmSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash, createHmac } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const root = fileURLToPath(new URL("..", import.meta.url));
const bundle = (srcRoot, out) => {
  const entry = join(srcRoot, "golive-h-entry.ts");
  writeFileSync(entry, `export { default } from "./worker/src/index.ts";\n`);
  try { execSync(`npx esbuild "${entry}" --bundle --format=esm --platform=neutral --outfile="${out}" --log-level=error`, { cwd: root, stdio: "inherit" }); }
  finally { rmSync(entry, { force: true }); }
};
const sha = (s) => createHash("sha256").update(s).digest("hex");
const MIGS = readdirSync(join(root, "worker/migrations")).filter((x) => x.endsWith(".sql")).sort();
const applyFile = (db, f, strict = false) => {
  const src = readFileSync(join(root, "worker/migrations", f), "utf8");
  let buf = "";
  for (const st of src.split(/;\s*\n/)) {
    buf = buf ? `${buf};\n${st}` : st;
    if (/CREATE TRIGGER/i.test(buf) && !/\bEND\s*$/i.test(buf.trim())) continue;
    try { db.exec(buf); } catch (e) { if (strict) throw e; }
    buf = "";
  }
};

/* v1.250.1 - THE LIVE PATH. The live database ran 0164 as release 1.249.0 wrote
   it; 1.250.0 changed 0164 afterwards, which the live database never re-runs.
   0164 must stay exactly what was applied, and 0165 must upgrade those tables
   with every row kept. */
function migrationChecks() {
  const out = [];
  const ok = (c, m, why = "") => out.push([!!c, why && !c ? `${m} - ${why}` : m]);
  const m164 = readFileSync(join(root, "worker/migrations/0164_agent_role.sql"), "utf8").replace(/\r\n/g, "\n");
  ok(sha(m164) === "c164833f1b80f5ec95eed8f55a0529638e29aa73bbc9dbd77adb35efb991880b", "M0 0164 is byte-for-byte what the live database applied with 1.249.0", sha(m164));
  const mig = MIGS.find((f) => f.startsWith("0165"));
  ok(!!mig, "M1 migration 0165 (the agent workflow upgrade) exists");
  if (!mig) return out;
  const db = new DatabaseSync(":memory:");
  for (const f of MIGS.filter((f) => f < "0165")) applyFile(db, f);
  db.exec(`INSERT INTO agent_requests (id, agent_id, client_name, client_phone, company, package_id, package_version, note, status, assigned_to, quotation_id, manager_note, created_at, updated_at, updated_by) VALUES
    (1, 20, 'Puan Rina', '012', 'Rina Bakery', 1, 1, 'CNY', 'new', NULL, NULL, NULL, '2026-11-01 11:00:00', NULL, NULL),
    (2, 20, 'Encik Kamal', NULL, NULL, 1, 1, NULL, 'contacted', 5, NULL, 'call back', '2026-11-01 11:10:00', '2026-11-01 12:00:00', 1),
    (3, 21, 'Cik Lina', '011', 'Lina Spa', 1, 1, NULL, 'quoted', 5, 50, NULL, '2026-11-01 11:20:00', '2026-11-01 12:10:00', 2),
    (4, 21, 'Won Co', '010', NULL, 1, 1, NULL, 'won', 5, 51, NULL, '2026-11-01 11:30:00', '2026-11-01 12:20:00', 2),
    (5, 20, 'Lost Co', '019', NULL, 1, 1, NULL, 'lost', NULL, NULL, NULL, '2026-11-01 11:40:00', '2026-11-01 12:30:00', 1)`);
  db.exec(`INSERT INTO agent_request_events (id, request_id, actor_id, kind, detail, created_at) VALUES (1, 1, 20, 'submitted', NULL, '2026-11-01 11:00:00'), (2, 2, 1, 'updated', '{"status":["new","contacted"]}', '2026-11-01 12:00:00')`);
  const ev0 = JSON.stringify(db.prepare(`SELECT id, request_id, actor_id, kind, detail, created_at FROM agent_request_events ORDER BY id`).all());
  let threw = null;
  try { db.exec("BEGIN"); applyFile(db, mig, true); db.exec("COMMIT"); } catch (e) { threw = String(e); try { db.exec("ROLLBACK"); } catch { /* none */ } }
  ok(!threw, "M2 0165 applies cleanly on the 1.249.0 tables (strict - every statement)", threw ?? "");
  const st = Object.fromEntries(db.prepare(`SELECT id, status FROM agent_requests ORDER BY id`).all().map((r) => [r.id, r.status]));
  ok(JSON.stringify(st) === JSON.stringify({ 1: "submitted", 2: "under_review", 3: "preparing", 4: "won", 5: "not_proceeding" }), "M3 every request is kept and its status mapped (new, contacted, quoted, won, lost)", JSON.stringify(st));
  const r2 = db.prepare(`SELECT agent_id, client_name, assigned_to, quotation_id, manager_note, created_at, updated_at, published_doc_id FROM agent_requests WHERE id = 3`).get();
  ok(r2.agent_id === 21 && r2.client_name === "Cik Lina" && r2.assigned_to === 5 && r2.quotation_id === 50 && r2.published_doc_id === null && db.prepare(`SELECT manager_note FROM agent_requests WHERE id = 2`).get().manager_note === "call back", "M4 the agent, client, salesperson, quotation link and private note are kept; nothing counts as published", JSON.stringify(r2));
  ok(JSON.stringify(db.prepare(`SELECT id, request_id, actor_id, kind, detail, created_at FROM agent_request_events ORDER BY id`).all()) === ev0 && db.prepare(`SELECT COUNT(*) AS n FROM agent_request_events WHERE visibility = 'internal'`).get().n === 2, "M5 the history rows are kept as they were and read internal");
  let frozen = false; try { db.exec(`UPDATE agent_request_events SET kind = 'x'`); } catch { frozen = true; }
  ok(frozen, "M6 the history is still append-only after the upgrade");
  let ins = true; try { db.exec(`INSERT INTO agent_requests (agent_id, client_name, status, client_key) VALUES (20, 'New', 'acceptance_pending', 'k')`); db.exec(`INSERT INTO agent_request_files (request_id, media_id, uploader_id, file_name, visibility) VALUES (1, 1, 20, 'a.png', 'agent')`); } catch { ins = false; }
  let bad = false; try { db.exec(`INSERT INTO agent_requests (agent_id, client_name, status) VALUES (20, 'Bad', 'quoted')`); } catch { bad = true; }
  ok(ins && bad && db.prepare(`SELECT MAX(id) AS n FROM agent_requests`).get().n === 6, "M7 the new statuses and files are accepted, an old status is refused, and new ids continue after the kept ones");
  return out;
}
const SECRET = "JBSWY3DPEHPK3PXP";
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const b32 = (s) => { let bits = 0, v = 0; const o = []; for (const ch of s) { v = (v << 5) | B32.indexOf(ch); bits += 5; if (bits >= 8) { o.push((v >>> (bits - 8)) & 255); bits -= 8; } } return Buffer.from(o); };
const totpAt = (ms) => { const c = Math.floor(ms / 30000); const b = Buffer.alloc(8); b.writeUInt32BE(Math.floor(c / 2 ** 32), 0); b.writeUInt32BE(c >>> 0, 4); const h = createHmac("sha1", b32(SECRET)).update(b).digest(); const o = h[h.length - 1] & 15; return String((((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1e6).padStart(6, "0"); };

async function runtime(workerBundle) {
  const out = [];
  const ok = (c, m, why = "") => out.push([!!c, why && !c ? `${m} - ${why}` : m]);
  const db = new DatabaseSync(":memory:");
  for (const f of MIGS) applyFile(db, f);
  const shim = (sql) => { const st = db.prepare(sql); let b = []; const o = {
    bind: (...a) => { b = a.map((x) => (x === undefined ? null : x)); return o; },
    first: async () => st.get(...b) ?? null, all: async () => ({ results: st.all(...b) }),
    run: async () => ({ meta: { changes: Number(st.run(...b).changes) } }), _run: () => st.run(...b) }; return o; };
  const sent = []; const r2 = new Map();
  const env = {
    DB: { prepare: shim, batch: async (list) => { db.exec("BEGIN"); try { for (const s of list) s._run(); db.exec("COMMIT"); } catch (e) { db.exec("ROLLBACK"); throw e; } return []; } },
    SESSION_PEPPER: "pepper", COMPANY_DOMAIN: "a2z.test", ALLOWED_ORIGINS: "https://portal.a2z.test",
    MEDIA: {
      put: async (k, v) => { r2.set(k, typeof v === "string" ? v : new Uint8Array(await new Response(v).arrayBuffer())); },
      get: async (k) => (r2.has(k) ? { body: new Response(r2.get(k)).body, httpMetadata: { contentType: "image/png" } } : null),
      head: async () => null, list: async () => ({ objects: [] }), delete: async () => {},
    },
    EMAIL: { send: async (m) => { sent.push(m); } }, MAIL_FROM: "A2Z Creative Marketing <hello@a2zcreative.my>",
  };
  /* Cloudflare's FixedLengthStream (putGuarded) - a plain pass-through here */
  if (!globalThis.FixedLengthStream) globalThis.FixedLengthStream = class extends TransformStream { constructor() { super(); } };
  const RealDate = globalThis.Date;
  let fixed = Date.parse("2026-11-01T04:00:00Z");
  globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [fixed])); } static now() { return fixed; } };
  const code = () => { fixed += 31000; return totpAt(fixed); };
  const U = { ceo: 1, coo: 2, cco: 3, aina: 5, lia: 6, hr: 4, shop: 9, plain: 10, agent2: 21 };
  db.exec(`INSERT INTO users (id, name, full_name, email, role, is_active, password_hash, totp_enabled, totp_secret, employment_status, google_sub, email_verified_at, base_salary_cents) VALUES
    (1,'Alif','Alif Farhan','alif@a2z.test','ceo',1,'x',1,'${SECRET}','permanent','g-1',NULL,900000),
    (2,'Ops','Ops Lead','ops@a2z.test','coo',1,'x',1,'${SECRET}','permanent',NULL,NULL,800000),
    (3,'Cee','Cee Officer','cco@a2z.test','cco',1,'x',1,'${SECRET}','permanent',NULL,NULL,800000),
    (4,'Hana','Hana HR','hana@a2z.test','hr_admin',1,'x',1,'${SECRET}','permanent',NULL,NULL,400000),
    (5,'Aina','Aina Seller','aina@a2z.test','sales_marketing',1,'x',1,'${SECRET}','permanent',NULL,NULL,300000),
    (6,'Lia','Lia Seller','lia@a2z.test','sales_marketing',1,'x',1,'${SECRET}','permanent',NULL,NULL,300000),
    (9,'Mara','Mara Dananita','mara@gmail.com','customer',1,'oauth$x',1,'${SECRET}','permanent','g-9',NULL,0),
    (10,'Plain','Plain Person','plain@gmail.com','customer',1,'x',0,NULL,'permanent',NULL,NULL,0),
    (21,'Ros','Ros Agent','ros.agent@gmail.com','agent',1,'x',1,'${SECRET}','permanent','g-21',NULL,0)`);
  db.exec(`INSERT INTO system_meta (key, value) VALUES ('company_owner', '{"user_id":1}')`);
  db.exec(`INSERT INTO enquiries (id, name, email, message, created_at) VALUES (1, 'Mara', 'mara@gmail.com', 'I want a website', '2026-09-01 01:00:00')`);
  db.exec(`INSERT INTO customers (id, company, contact_person, phone, email, created_by) VALUES (1, 'Kasih Rabiah Enterprise', 'Puan Rabiah', '0123456789', 'rabiah@kasih.test', 5)`);
  db.exec(`INSERT INTO sales_packages (id, name, category, description, kind, issuers, status, current_version, updated_by) VALUES
    (1, '10 Video Content', 'Video', '10 short videos', 'service', 'azoo', 'active', 1, 1)`);
  db.exec(`INSERT INTO sales_package_versions (package_id, version, items, discount_cents, subtotal_cents, total_cents, created_by) VALUES
    (1, 1, '[{"name":"Video Content 30s","qty":10,"unit_price_cents":7000}]', 0, 70000, 70000, 1)`);
  /* quotations that must NOT publish: expired, over the approval limit unapproved, void */
  db.exec(`INSERT INTO sales_documents (id, doc_type, doc_number, customer_id, items, total_cents, salesperson_id, created_by, created_at, issuer_code, valid_until, voided_at) VALUES
    (71, 'QT', 'QT-OLD-71', 1, '[]', 70000, 5, 5, '2026-09-01 01:00:00', 'azoo', '2026-09-30', NULL),
    (72, 'QT', 'QT-BIG-72', 1, '[]', 900000, 5, 5, '2026-10-31 01:00:00', 'azoo', '2026-12-31', NULL),
    (73, 'QT', 'QT-VOID-73', 1, '[]', 70000, 5, 5, '2026-10-31 01:00:00', 'azoo', '2026-12-31', '2026-10-31 02:00:00')`);
  db.exec(`INSERT OR REPLACE INTO business_settings (key, value) VALUES ('quote_approval', '{"limit_cents":500000,"since":"2026-10-01 00:00:00"}')`);
  const worker = (await import(pathToFileURL(workerBundle).href + `?v=${Math.random()}`));
  const app = worker.default;
  const tok = {};
  const session = (id) => { tok[id] = `t-${id}-${Math.random()}`; db.prepare(`INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, datetime('now', '+12 hours'), datetime('now'))`).run(sha(tok[id]), id); };
  for (const id of Object.values(U)) session(id);
  const call = async (path, uid, method = "GET", body, raw) => {
    const h = { origin: "https://portal.a2z.test", cookie: `azone_session=${tok[uid]}; csrf_token=c1`, "x-csrf-token": "c1", ...(raw ? raw.headers : { "content-type": "application/json" }) };
    const r = await app.fetch(new Request(`https://api.a2z.test/api/v1${path}`, { method, headers: h, body: raw ? raw.body : body === undefined ? undefined : JSON.stringify(body) }), env, { waitUntil() {} });
    const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch { /* not json */ }
    return { status: r.status, j, text };
  };
  const n = (sql, ...a) => Number(db.prepare(sql).get(...a)?.n ?? 0);
  const R = "Mara promotes our packages to her network";
  const money = () => sha(JSON.stringify([
    (() => { try { return db.prepare(`SELECT * FROM commission_ledger ORDER BY id`).all(); } catch { return []; } })(),
    (() => { try { return db.prepare(`SELECT * FROM payroll_entries ORDER BY rowid`).all(); } catch { return []; } })(),
    db.prepare(`SELECT id, payment_status, paid_at FROM sales_documents ORDER BY id`).all(),
  ]));
  try {
    /* ---------- T1-T3 activation on the existing identity ---------- */
    const users0 = n(`SELECT COUNT(*) AS n FROM users`);
    const enq0 = JSON.stringify(db.prepare(`SELECT * FROM enquiries ORDER BY id`).all());
    ok((await call(`/staff/users/9/role`, U.aina, "POST", { role: "agent", reason: R, totp: code() })).status === 403, "T1 Sales cannot grant Agent access");
    ok((await call(`/staff/users/9/role`, U.coo, "POST", { role: "agent", reason: R, totp: code() })).status === 403, "T1 ...nor the COO - the owner's door (role_any)");
    const un = await call(`/staff/users/10/role`, U.ceo, "POST", { role: "agent", reason: R, totp: code() });
    ok(un.status === 409 && un.j?.error?.code === "email_unverified" && db.prepare(`SELECT role FROM users WHERE id = 10`).get().role === "customer", "T1 an unverified email is never made an agent", `${un.status} ${un.text.slice(0, 120)}`);
    const nc = await call(`/staff/users/9/role`, U.ceo, "POST", { role: "agent", reason: R });
    ok(nc.status === 401, "T1 granting asks the owner for his authenticator code", `${nc.status}`);
    const g = await call(`/staff/users/9/role`, U.ceo, "POST", { role: "agent", reason: R, totp: code() });
    const aud = db.prepare(`SELECT detail FROM audit_log WHERE action = 'staff.role_change' ORDER BY id DESC LIMIT 1`).get();
    ok(g.status === 200 && db.prepare(`SELECT role FROM users WHERE id = 9`).get().role === "agent" && JSON.parse(aud?.detail ?? "{}").by_owner === true && JSON.parse(aud.detail).reason === R, "T1 the CEO (owner) grants Agent access to the verified customer - audited with the reason", `${g.status} ${g.text.slice(0, 160)}`);
    ok(n(`SELECT COUNT(*) AS n FROM users`) === users0 && n(`SELECT COUNT(*) AS n FROM users WHERE email = 'mara@gmail.com'`) === 1 && JSON.stringify(db.prepare(`SELECT * FROM enquiries ORDER BY id`).all()) === enq0, "T2 the same account: no new user, the customer history (by email) untouched");
    const AG = U.shop;
    /* ---------- T3-T4 the agent's reach ---------- */
    ok((await call(`/auth/me`, AG)).j?.user?.role === "agent", "T3 the agent signs in with the same verified email and is an agent");
    for (const [p, what] of [["/staff/docs", "Sales documents"], ["/staff/customers", "customers"], ["/staff/payroll/entries?month=2026-10", "payroll"], ["/staff/users", "staff accounts"], ["/staff/attendance", "attendance"], ["/staff/commission/summary", "commission"]]) {
      ok((await call(p, AG)).status === 403, `T4 the agent is refused ${what} on the server (${p})`);
    }
    ok((await call(`/staff/agent/packages`, AG)).j?.packages?.[0]?.total_cents === 70000, "T4 the agent sees the packages to promote (the published price)");
    ok((await call(`/staff/tasks`, AG)).status === 403, "T4 the agent has no internal Tasks (v1.250.2)");
    const al0 = await call(`/staff/agent/agents`, U.ceo);
    const mara = al0.j?.agents?.find((a) => a.id === AG);
    ok(al0.j?.can_grant === true && mara && mara.email_verified === 1 && mara.is_active === 1 && /A2Z CREATIVE MARKETING and AZ ONE OFFICIAL/.test(mara.scope) && mara.requests === 0, "M-1 the owner's Agents list: the account, verified email, active, scope, requests - and Manage Agent Access offered", JSON.stringify(al0.j).slice(0, 300));
    ok((await call(`/staff/agent/agents`, U.coo)).j?.can_grant === false && (await call(`/staff/agent/agents`, AG)).status === 403, "M-1 ...the COO reads it without the grant; an agent cannot read it");

    /* ---------- T5-T6 submit, retry-safe ---------- */
    const body = { client_name: "Kasih Rabiah Enterprise", contact_person: "Puan Rabiah", client_phone: "0123456789", client_email: "rabiah@kasih.test", package_id: 1, requirement: "10 videos for a product campaign", timeline: "Nov 2026", budget_text: "RM700", client_key: "k-1" };
    ok((await call(`/staff/agent/requests`, AG, "POST", { ...body, client_phone: "", client_email: "", client_key: "k-0" })).status === 400, "T5 a phone or an email is required");
    const s1 = await call(`/staff/agent/requests`, AG, "POST", body);
    const rid = s1.j?.id;
    ok(s1.status === 201 && s1.j?.ref === "AGR-0001" && db.prepare(`SELECT agent_id, status, package_version, issuer_code FROM agent_requests WHERE id = ?`).get(rid)?.agent_id === AG && db.prepare(`SELECT status FROM agent_requests WHERE id = ?`).get(rid).status === "submitted" && db.prepare(`SELECT issuer_code FROM agent_requests WHERE id = ?`).get(rid).issuer_code === "azoo", "T5 the agent submits: their id, a reference, Submitted, the package version and its company recorded by the server", s1.text.slice(0, 160));
    const s2 = await call(`/staff/agent/requests`, AG, "POST", { ...body, client_name: "Kasih Rabiah Ent" }); // the same send, retried after a typo fix
    ok(s2.j?.id === rid && s2.j?.existing === true && n(`SELECT COUNT(*) AS n FROM agent_requests WHERE agent_id = ?`, AG) === 1, "T6 a retried submit returns the same request - no duplicate");
    ok((await call(`/staff/agent/requests`, AG, "POST", { client_name: "Custom Co", client_phone: "011", custom: true, requirement: "short", client_key: "k-2" })).status === 400, "T5 a custom requirement must be described");
    const cu = await call(`/staff/agent/requests`, AG, "POST", { client_name: "Custom Co", client_phone: "011", custom: true, requirement: "A booth design for the expo in December", issuer_code: "a2z", client_key: "k-3" });
    ok(cu.status === 201, "T5 a Custom requirement goes in without a package", cu.text.slice(0, 120));
    const dr = await call(`/staff/agent/requests`, AG, "POST", { client_name: "Draft Co", draft: true, client_key: "k-4" });
    ok(dr.status === 201 && (await call(`/staff/agent/requests/${dr.j.id}`, U.ceo)).status === 404 && !(await call(`/staff/agent/requests`, U.ceo)).j?.requests?.some((x) => x.id === dr.j.id), "T5 a draft stays the agent's own until sent");
    ok(n(`SELECT COUNT(*) AS n FROM customers`) === 1, "T5 no customer record is created from an agent's lead");

    /* ---------- T7-T8 Sales receives, management assigns ---------- */
    const sl = await call(`/staff/agent/requests`, U.aina);
    ok(sl.status === 200 && sl.j?.requests?.some((x) => x.id === rid && x.agent_name === "Mara Dananita"), "T7 Sales sees the submission with the agent's name");
    ok(n(`SELECT COUNT(*) AS n FROM notifications WHERE user_id = 1 AND kind = 'agent'`) >= 1, "T7 management is notified of a new agent request");
    ok((await call(`/staff/agent/requests/${rid}`, U.aina, "PATCH", { status: "under_review" })).status === 403, "T8 an unassigned salesperson does not change the request");
    ok((await call(`/staff/agent/requests/${rid}`, U.aina, "PATCH", { assigned_to: U.aina })).status === 403, "T8 ...and cannot assign herself");
    const as = await call(`/staff/agent/requests/${rid}`, U.ceo, "PATCH", { assigned_to: U.aina, status: "under_review" });
    ok(as.status === 200 && db.prepare(`SELECT assigned_to, status FROM agent_requests WHERE id = ?`).get(rid).assigned_to === U.aina && n(`SELECT COUNT(*) AS n FROM notifications WHERE user_id = 5 AND kind = 'agent'`) >= 1, "T8 management assigns the salesperson - who is notified", as.text.slice(0, 120));

    /* ---------- T16-T17 comments, internal vs agent ---------- */
    await call(`/staff/agent/requests/${rid}/events`, U.ceo, "POST", { kind: "comment", body: "Hold the price until the deposit term is agreed", visibility: "internal" });
    await call(`/staff/agent/requests/${rid}/events`, U.ceo, "POST", { kind: "comment", body: "Please confirm the client's preferred posting dates", visibility: "agent" });
    const mi = await call(`/staff/agent/requests/${rid}`, U.aina, "PATCH", { status: "more_info", reason: "Which dates should the videos go out?" });
    ok(mi.status === 200, "T16 the assigned salesperson asks the agent for more information", mi.text.slice(0, 120));
    const ah = await call(`/staff/agent/requests/${rid}?visibility=internal`, AG);
    const histTxt = JSON.stringify(ah.j);
    ok(ah.status === 200 && !histTxt.includes("deposit term") && histTxt.includes("preferred posting dates") && ah.j.history.every((e) => e.visibility === "agent") && !("manager_note" in ah.j.request) && !("assigned_to" in ah.j.request), "T17 the agent sees only what is meant for agents - not an internal note, even asking for it", histTxt.slice(0, 200));
    ok(!JSON.stringify((await call(`/staff/agent/requests`, AG)).j).includes("deposit term"), "T17 ...nor in their list's latest update");
    const an = await call(`/staff/agent/requests/${rid}`, AG, "PATCH", { submit: true, answer: "First week of December" });
    ok(an.status === 200 && db.prepare(`SELECT status FROM agent_requests WHERE id = ?`).get(rid).status === "submitted", "T16 the agent answers and the request goes back to Sales");
    ok((await call(`/staff/agent/requests/${rid}`, AG, "PATCH", { client_name: "Changed" })).status === 403, "T16 once sent, the agent no longer edits the request");
    await call(`/staff/agent/requests/${rid}`, U.aina, "PATCH", { status: "under_review" });
    const fu = await call(`/staff/agent/requests/${rid}/events`, AG, "POST", { kind: "update", body: "Client also asked about photos", next_action: "Wait for the quotation", client_key: "e-1" });
    const fu2 = await call(`/staff/agent/requests/${rid}/events`, AG, "POST", { kind: "update", body: "Client also asked about photos", client_key: "e-1" });
    ok(fu.status === 201 && fu2.j?.existing === true && n(`SELECT COUNT(*) AS n FROM agent_request_events WHERE client_key = 'e-1'`) === 1, "T16 an agent's progress update is kept once, even when the phone retries");
    /* v1.250.2 - the Add Status Update form: a typed progress update with next action and follow-up */
    const n5 = n(`SELECT COUNT(*) AS n FROM notifications WHERE user_id = 5 AND kind = 'agent'`);
    const su = await call(`/staff/agent/requests/${rid}/events`, AG, "POST", { kind: "update", body: "Client feedback: wants the videos in Malay", client_feedback: "wants the videos in Malay", next_action: "Wait for the quotation", follow_up_on: "2026-11-05", client_key: "u-1" });
    const hv = await call(`/staff/agent/requests/${rid}`, AG);
    const last = hv.j?.history?.find((e) => e.body === "Client feedback: wants the videos in Malay");
    ok(su.status === 201 && last && last.next_action === "Wait for the quotation" && last.follow_up_on === "2026-11-05" && last.visibility === "agent" && last.actor_id === AG, "T10-T11 the agent's status update (type, next action, follow-up) is on their timeline, by them", JSON.stringify(last));
    ok(n(`SELECT COUNT(*) AS n FROM notifications WHERE user_id = 5 AND kind = 'agent'`) === n5 + 1, "T12 the assigned salesperson is notified of the agent's update");
    ok(db.prepare(`SELECT next_follow_up_on FROM agent_requests WHERE id = ?`).get(rid).next_follow_up_on !== "2026-11-05", "T10 an agent's follow-up date is their own note - it does not set Sales' follow-up");
    let frozen = false; try { db.exec(`UPDATE agent_request_events SET body = 'x' WHERE request_id = ${rid}`); } catch { frozen = true; }
    ok(frozen, "T16 updates are append-only");

    /* ---------- T9-T11 the quotation in Sales ---------- */
    ok((await call(`/staff/agent/requests/${rid}/prefill`, AG)).status === 404, "T9 the agent has no Sales handoff");
    const pf = await call(`/staff/agent/requests/${rid}/prefill`, U.aina);
    ok(pf.j?.prefill?.reference === "AGR-0001" && pf.j.prefill.items?.[0]?.qty === 10 && pf.j.prefill.issuer === "azoo" && pf.j.prefill.salesperson_id === U.aina, "T9 Create Quotation is prefilled from the request (reference, package lines, company, salesperson)", pf.text.slice(0, 200));
    const qt = await call(`/staff/docs`, U.aina, "POST", { doc_type: "QT", issuer: "azoo", kind: "service", customer_id: 1, items: pf.j.prefill.items, reference: "AGR-0001", valid_until: "2026-11-30", salesperson_id: U.aina });
    const qid = qt.j?.id;
    ok(qt.status === 201 && db.prepare(`SELECT quotation_id, status FROM agent_requests WHERE id = ?`).get(rid)?.quotation_id === qid && db.prepare(`SELECT status FROM agent_requests WHERE id = ?`).get(rid).status === "preparing", "T10 the quotation made with the existing Sales API joins the request (Preparing)", qt.text.slice(0, 160));
    const al = await call(`/staff/agent/requests`, AG);
    const mineRow = al.j?.requests?.find((x) => x.id === rid);
    ok(mineRow && mineRow.published_number === null && !("quotation_number" in mineRow) && !JSON.stringify(al.j).includes(qt.j?.doc_number ?? "@@") && (await call(`/staff/agent/requests/${rid}/quotation`, AG)).j?.quotation === null, "T11 a quotation Sales has not published is not shown to the agent", JSON.stringify(mineRow).slice(0, 200));

    /* ---------- T12 publish ---------- */
    ok((await call(`/staff/agent/requests/${rid}/publish`, U.lia, "POST", { doc_id: qid })).status === 403, "T12 a salesperson not assigned cannot publish");
    ok((await call(`/staff/agent/requests/${rid}/publish`, AG, "POST", { doc_id: qid })).status === 403, "T12 ...nor the agent");
    ok((await call(`/staff/agent/requests/${rid}/publish`, U.aina, "POST", { doc_id: 71 })).j?.error?.code === "expired", "T12 an expired quotation is not published");
    ok((await call(`/staff/agent/requests/${rid}/publish`, U.aina, "POST", { doc_id: 72 })).j?.error?.code === "approval_required", "T12 a quotation over the approval limit is not published until approved");
    ok((await call(`/staff/agent/requests/${rid}/publish`, U.aina, "POST", { doc_id: 73 })).status === 409, "T12 a void quotation is not published");
    const pb = await call(`/staff/agent/requests/${rid}/publish`, U.aina, "POST", { doc_id: qid });
    const aq = await call(`/staff/agent/requests/${rid}/quotation`, AG);
    ok(pb.status === 200 && db.prepare(`SELECT status, published_doc_id FROM agent_requests WHERE id = ?`).get(rid).published_doc_id === qid && aq.j?.quotation?.link?.includes("/doc?t=") && aq.j.quotation.total_cents === db.prepare(`SELECT total_cents FROM sales_documents WHERE id = ?`).get(qid).total_cents && aq.j.quotation.issuer_name === "AZ ONE OFFICIAL", "T12 the assigned salesperson publishes the issued quotation - the agent gets its reference, company, total and the customer link", `${pb.status} ${pb.text.slice(0, 160)} ${aq.text.slice(0, 160)}`);
    ok(!/created_by|salesperson_id|notes|share_token|cost/.test(JSON.stringify(aq.j?.quotation ?? {}).replace(/"link":"[^"]*"/, "")), "T12 ...and nothing internal");

    /* ---------- T14 the agent changes nothing official ---------- */
    ok((await call(`/staff/docs/${qid}/edit`, AG, "POST", { total_cents: 1 })).status === 403 && (await call(`/staff/docs/${qid}`, AG, "PATCH", { items: [] })).status === 403, "T14 the agent cannot edit the quotation (price, issuer, items)");
    ok((await call(`/staff/agent/requests/${rid}`, AG, "PATCH", { status: "won" })).status === 403 && (await call(`/staff/agent/requests/${rid}/verify`, AG, "POST", {})).status === 403, "T14 ...nor move their request to Won");

    /* ---------- T13 share ---------- */
    ok((await call(`/staff/agent/requests/${rid}/shared`, AG, "POST", {})).status === 400, "T13 sharing says how it was shared");
    const sh = await call(`/staff/agent/requests/${rid}/shared`, AG, "POST", { channel: "whatsapp", note: "Sent to Puan Rabiah", next_action: "Call on Monday", follow_up_on: "2026-11-03" });
    ok(db.prepare(`SELECT next_action, follow_up_on FROM agent_request_events WHERE request_id = ? AND kind = 'shared'`).get(rid)?.next_action === "Call on Monday", "T13 a share carries the update's next action and follow-up");
    ok(sh.status === 200 && db.prepare(`SELECT status FROM agent_requests WHERE id = ?`).get(rid).status === "with_client" && n(`SELECT COUNT(*) AS n FROM agent_request_events WHERE request_id = ? AND kind = 'shared' AND body LIKE '%self-reported%'`, rid) === 1, "T13 the agent records a WhatsApp share - marked self-reported");
    const se = await call(`/staff/agent/requests/${rid}/send`, AG, "POST", { to: "rabiah@kasih.test" });
    ok(se.status === 200 && sent.some((m) => m.to === "rabiah@kasih.test" && String(m.text).includes("/doc?t=")) && n(`SELECT COUNT(*) AS n FROM agent_request_events WHERE request_id = ? AND kind = 'sent'`, rid) === 1, "T13 a portal send goes through the existing mail sender and is recorded as sent", se.text.slice(0, 120));

    /* ---------- T15, T19 feedback and the acceptance claim ---------- */
    const rv = await call(`/staff/agent/requests/${rid}/feedback`, AG, "POST", { kind: "revision", body: "Wants 12 videos instead of 10" });
    ok(rv.status === 200 && db.prepare(`SELECT status FROM agent_requests WHERE id = ?`).get(rid).status === "revision_requested", "T15 the agent reports the client wants changes");
    const noEv = await call(`/staff/agent/requests/${rid}/feedback`, AG, "POST", { kind: "accepted", body: "Client says go" });
    ok(noEv.status === 400, "T19 a claimed acceptance needs evidence");
    const up = await call(`/staff/agent/requests/${rid}/files`, AG, "POST", undefined, { headers: { "content-type": "image/png", "x-file-name": "whatsapp-yes.png", "content-length": "8" }, body: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]) });
    ok(up.status === 201 && db.prepare(`SELECT visibility FROM agent_request_files WHERE id = ?`).get(up.j?.id)?.visibility === "agent", "T15 the agent attaches evidence (private storage)", `${up.status} ${up.text.slice(0, 160)}`);
    const acc0 = n(`SELECT COUNT(*) AS n FROM quotation_acceptances`);
    const pay0 = JSON.stringify(db.prepare(`SELECT payment_status, paid_at FROM sales_documents WHERE id = ?`).get(qid));
    const cl = await call(`/staff/agent/requests/${rid}/feedback`, AG, "POST", { kind: "accepted", body: "Client says go", evidence_file_id: up.j?.id });
    ok(cl.status === 200 && db.prepare(`SELECT status FROM agent_requests WHERE id = ?`).get(rid).status === "acceptance_pending", "T19 the agent reports the client said yes - Acceptance to verify");
    ok(n(`SELECT COUNT(*) AS n FROM quotation_acceptances`) === acc0 && JSON.stringify(db.prepare(`SELECT payment_status, paid_at FROM sales_documents WHERE id = ?`).get(qid)) === pay0, "T19 ...which accepts nothing on the quotation and touches no payment");

    /* ---------- T20 verified acceptance ---------- */
    const v0 = await call(`/staff/agent/requests/${rid}/verify`, U.aina, "POST", {});
    ok(v0.status === 409 && v0.j?.error?.code === "acceptance_missing", "T20 Won needs the acceptance recorded on the quotation first");
    const ra = await call(`/staff/docs/${qid}/acceptance`, U.aina, "POST", { accepted_name: "Puan Rabiah", channel: "whatsapp", note: "Screenshot on AGR-0001" });
    ok(ra.status === 201, "T20 Sales records the acceptance on the quotation (the existing record)", ra.text.slice(0, 160));
    const vw = await call(`/staff/agent/requests/${rid}/verify`, U.aina, "POST", {});
    ok(vw.status === 200 && db.prepare(`SELECT status FROM agent_requests WHERE id = ?`).get(rid).status === "won", "T20 then verifying makes the request Won");

    /* ---------- T21-T22 money is untouched ---------- */
    const m0 = money();
    ok((await call(`/staff/docs/${qid}/confirm-paid`, AG, "POST", { amount_cents: 1, checked: true })).status === 403 && (await call(`/staff/docs/${qid}/confirm-paid`, U.cco, "POST", { amount_cents: 1, checked: true })).status === 403, "T21 Confirm Paid stays the CEO's and COO's (not the agent, not the CCO)");
    ok(money() === m0 && n(`SELECT COUNT(*) AS n FROM sales_documents WHERE doc_type = 'INV'`) === 0, "T22 no invoice, no Paid, no commission from the agent workflow");

    /* ---------- T18 other agents ---------- */
    ok((await call(`/staff/agent/requests/${rid}`, U.agent2)).status === 404 && (await call(`/staff/agent/requests/${rid}/files/${up.j?.id}`, U.agent2)).status === 404 && (await call(`/staff/agent/requests/${rid}/quotation`, U.agent2)).status === 404, "T18 another agent cannot open the request, its files or its quotation");
    ok(!(await call(`/staff/agent/requests`, U.agent2)).j?.requests?.length, "T18 ...nor see it listed");
    ok((await call(`/staff/agent/requests/${rid}/events`, U.agent2, "POST", { body: "hello" })).status === 404, "T18 ...nor write to it");
    const inFile = await call(`/staff/agent/requests/${rid}/files`, U.ceo, "POST", undefined, { headers: { "content-type": "image/png", "x-file-name": "internal.png" }, body: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]) });
    const inGet = await call(`/staff/agent/requests/${rid}/files/${inFile.j?.id}`, AG);
    ok(inFile.status === 201 && inGet.status === 404, "T17 an internal file is not served to the agent", `${inFile.status} ${inFile.text.slice(0, 120)} / ${inGet.status}`);

    /* ---------- T24 suspension ---------- */
    db.exec(`UPDATE users SET is_active = 0 WHERE id = ${AG}`);
    const ceoView = await call(`/staff/agent/requests/${rid}`, U.ceo);
    ok(ceoView.status === 200 && ceoView.j?.request?.agent_name === "Mara Dananita" && ceoView.j.history.length >= 10, "T24 a suspended agent's requests and history stay readable to management");
    ok((await call(`/staff/agent/requests`, AG)).status === 401 || (await call(`/staff/agent/requests`, AG)).status === 403, "T24 the suspended agent is out");
    db.exec(`UPDATE users SET is_active = 1 WHERE id = ${AG}`);
    const rk = await call(`/staff/users/9/role`, U.ceo, "POST", { role: "customer", reason: "Agent agreement ended", totp: code() });
    ok(rk.status === 200 && db.prepare(`SELECT agent_id FROM agent_requests WHERE id = ?`).get(rid).agent_id === AG, "T24 revoking Agent access keeps every request with its agent", rk.text.slice(0, 120));
  } catch (e) {
    out.push([false, `runtime: ${e?.stack ?? e}`]);
  } finally {
    globalThis.Date = RealDate;
  }
  return out;
}

let fail = 0, n = 0;
const report = (list) => { for (const [p, m] of list) { n++; if (!p) { fail++; console.error(`FAIL ${m}`); } } };
const given = process.env.WORKER_BUNDLE;
const dir = mkdtempSync(join(tmpdir(), "golive-h-"));
const main = given ?? join(dir, "worker.mjs");
if (!given) bundle(root, main);
report(migrationChecks());
const base = await runtime(main);
report(base);
const checks = n;
if (given) {
  if (fail) { console.error(`go-live-h: ${fail} of ${n} failed`); process.exit(1); }
  console.log(`go-live-h: ${n} checks passed`); process.exit(0);
}

const MUT = [
  ["worker/src/agent.ts", "an agent reads every request", "      if (!staff) { where.push(`r.agent_id = ?${binds.length + 1}`); binds.push(user.id); }", "      if (false) { where.push(`r.agent_id = ?${binds.length + 1}`); binds.push(user.id); }"],
  ["worker/src/agent.ts", "internal notes reach the agent", "      const vis = staff ? \"\" : \"AND e.visibility = 'agent'\";\n      const { results: history }", "      const vis = \"\";\n      const { results: history }"],
  ["worker/src/agent.ts", "a draft quotation is shown to the agent", "          published_number: HOLDS_QT.includes(st) ? (r.published_number ?? null) : null,", "          published_number: r.quotation_number ?? null,"],
  ["worker/src/agent.ts", "publishing skips the approval limit", "      if (overLimit(d, await approvalLimit(env))) {", "      if (false) {"],
  ["worker/src/agent.ts", "publishing skips the expiry", "      if (!d.valid_until || d.valid_until.slice(0, 10) < mytToday()) return err(", "      if (false) return err("],
  ["worker/src/agent.ts", "Won without a recorded acceptance", "      if (!acc) return err(\"acceptance_missing\",", "      if (false) return err(\"acceptance_missing\","],
  ["worker/src/agent.ts", "an acceptance claim without evidence", "        if (!okF) return err(\"invalid_input\", \"Attach the client's confirmation", "        if (false) return err(\"invalid_input\", \"Attach the client's confirmation"],
  ["worker/src/agent.ts", "any salesperson handles any request", "    const handler = manager || (viewer && r.assigned_to === user.id);", "    const handler = manager || viewer;"],
  ["worker/src/agent.ts", "the retry key is ignored", "      const key = text(body?.client_key, 80) || null;", "      const key = null;"],
  ["worker/src/staff.ts", "an unverified email becomes an agent", "    if (newRole === \"agent\" && target.role !== \"agent\") {", "    if (false) {"],
  ["worker/src/agent.ts", "an agent's follow-up date moves Sales' follow-up", "      if (follow && handler) await env.DB.prepare(`UPDATE agent_requests SET next_follow_up_on", "      if (follow) await env.DB.prepare(`UPDATE agent_requests SET next_follow_up_on"],
  ["worker/src/agent.ts", "internal files reach the agent", "      if (!f || (!staff && f.visibility !== \"agent\")) return err(\"not_found\", \"File not found\", 404);", "      if (!f) return err(\"not_found\", \"File not found\", 404);"],
];
for (const [file, name, from, to] of MUT) {
  n++;
  const src = readFileSync(join(root, file), "utf8");
  if (!src.includes(from)) { fail++; console.error(`FAIL mutation did not apply: ${name}`); continue; }
  const mdir = mkdtempSync(join(tmpdir(), "golive-h-m-"));
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
if (fail) { console.error(`go-live-h: ${fail} of ${n} failed`); process.exit(1); }
console.log(`go-live-h: ${checks} checks passed (${MUT.length} mutations caught) - the agent portal: verified-email activation on the same account, retry-safe submissions, Sales prefill and auto-link, publish only an issued, approved, valid revision, internal notes never reach an agent, an agent's acceptance claim needs evidence and verifying needs the recorded acceptance, no money moves`);
