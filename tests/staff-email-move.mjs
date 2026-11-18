/* STAFF LOGIN EMAIL MOVE TO @a2zcreative.my (v1.376.0) - runtime guard: the
 * WHOLE worker (index.ts, bundled) against SQLite with every migration applied.
 * The CEO, 18-11-2026: "my staff they using old domain email for login the
 * portal ... but some of the staff are using gmail which is I dont want to
 * touch on it except the staff which is using old domain: azoneofficial.com".
 * Answers: other mailbox (email link only), some new addresses differ, 72 hours.
 *
 *   node tests/staff-email-move.mjs
 */
import { readFileSync, readdirSync, mkdtempSync, writeFileSync, cpSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash, createHmac } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { fakeGoogle } from "./lib/fake-google.mjs"; // v1.265.0 - Google is OpenID Connect now

const root = fileURLToPath(new URL("..", import.meta.url));
const bundle = (srcRoot, entry, out) => execSync(`npx esbuild "${join(srcRoot, entry)}" --bundle --format=esm --platform=neutral --outfile="${out}" --log-level=error`, { cwd: root, stdio: "inherit" });
const SECRET = "JBSWY3DPEHPK3PXP";
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const b32 = (s) => { let bits = 0, v = 0; const o = []; for (const ch of s) { v = (v << 5) | B32.indexOf(ch); bits += 5; if (bits >= 8) { o.push((v >>> (bits - 8)) & 255); bits -= 8; } } return Buffer.from(o); };
const totpAt = (ms) => { const c = Math.floor(ms / 30000); const b = Buffer.alloc(8); b.writeUInt32BE(Math.floor(c / 2 ** 32), 0); b.writeUInt32BE(c >>> 0, 4); const h = createHmac("sha1", b32(SECRET)).update(b).digest(); const o = h[h.length - 1] & 15; return String((((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1e6).padStart(6, "0"); };
const sha = (s) => createHash("sha256").update(s).digest("hex");

async function runtime(workerBundle) {
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
  const mails = [];
  let mailFails = false;
  const MAIL = { send: async (m) => { if (mailFails) throw new Error("smtp down"); mails.push(m); } };
  const env = {
    DB: { prepare: shim, batch: async (list) => { db.exec("BEGIN"); try { for (const s of list) s._run(); db.exec("COMMIT"); } catch (e) { db.exec("ROLLBACK"); throw e; } return []; } },
    SESSION_PEPPER: "pepper", COMPANY_DOMAIN: "azoneofficial.com", COMPANY_DOMAINS: "azoneofficial.com,a2zcreative.my", ALLOWED_ORIGINS: "https://portal.a2z.test",
    GOOGLE_CLIENT_ID: "cid", GOOGLE_CLIENT_SECRET: "csecret",
    MEDIA: { put: async () => {}, head: async () => null, get: async () => null, list: async () => ({ objects: [] }) },
  };
  const U = { ceo: 1, coo: 2, hr_admin: 4, super_admin: 8, customer: 9, ceo2: 12, aina: 5, mia: 6, nora: 13, ed: 10, lia: 11, zul: 15, agent: 16, tech: 7 };
  db.exec(`INSERT INTO users (id, name, email, role, is_active, password_hash, totp_enabled, totp_secret, base_salary_cents) VALUES
    (1,'Alif','alif@azoneofficial.com','ceo',1,'x',1,'${SECRET}',0),(2,'Ops','ops@azoneofficial.com','coo',1,'x',1,'${SECRET}',0),
    (4,'Hana','hana@azoneofficial.com','hr_admin',1,'x',1,'${SECRET}',200000),
    (5,'Aina Sofea binti Kamal','aina@gmail.com','sales_marketing',1,'x',1,'${SECRET}',210000),(6,'Mia','mia@azoneofficial.com','marketing',1,'x',1,'${SECRET}',200000),
    (7,'Tech','tech@azoneofficial.com','admin',1,'x',1,'${SECRET}',0),(8,'Root','root@azoneofficial.com','super_admin',1,'x',1,'${SECRET}',0),
    (9,'Shop','shop@azoneofficial.com','customer',1,'x',0,NULL,0),(10,'Ed','ed@azoneofficial.com','editor',1,'x',1,'${SECRET}',200000),
    (11,'Lia','lia@yahoo.com','live_host',1,'x',1,'${SECRET}',150000),(12,'Second','ceo2@azoneofficial.com','ceo',1,'x',1,'${SECRET}',0),
    (13,'Nora','nora@azoneofficial.com','editor',1,'x',1,'${SECRET}',200000),(15,'Zul','zul@azoneofficial.com','editor',1,'oauth$google',0,NULL,0),
    (16,'Agent','agent@azoneofficial.com','agent',1,'x',0,NULL,0)`);
  db.exec(`INSERT INTO customers (id, company, created_by) VALUES (1,'Kedai',13)`);
  db.exec(`INSERT INTO sales_documents (id, doc_type, doc_number, customer_id, items, discount_cents, tax_percent, total_cents, payment_status, created_at, created_by, salesperson_id, kind) VALUES (100,'INV','INV-1',1,'[]',0,0,10000,'unpaid','2026-10-20 02:00:00',13,13,'service')`);
  const RealDate = globalThis.Date; let fixed = new RealDate("2026-10-31T02:00:00Z").getTime();
  globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [fixed])); } static now() { return fixed; } };
  const code = () => { fixed += 31000; return totpAt(fixed); };
  /* Google, as the worker sees it (v1.265.0: discovery, PKCE, a signed ID token) */
  const G = fakeGoogle({ clientId: "cid" });
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (u, init) => (await G.fetch(u, init)) ?? new Response("{}", { status: 200 });
  const worker = (await import(pathToFileURL(workerBundle).href + `?v=${Math.random()}`)).default;
  const tok = {};
  const signIn = (id) => {
    tok[id] = `t-${id}-${Math.random()}`;
    db.prepare(`INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, datetime('now', '+12 hours'), datetime('now'))`).run(sha(tok[id]), id);
  };
  for (const id of Object.values(U)) signIn(id);
  const call = async (path, uid, method = "GET", body) => {
    const headers = { "content-type": "application/json", origin: "https://portal.a2z.test", ...(uid ? { cookie: `azone_session=${tok[uid]}; csrf_token=c1`, "x-csrf-token": "c1" } : {}) };
    const r = await worker.fetch(new Request(`https://api.a2z.test/api/v1${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined }), env);
    const text = await r.text();
    let j = null; try { j = JSON.parse(text); } catch { /* a redirect */ }
    return { status: r.status, j, text, loc: r.headers.get("location"), cookies: r.headers.get("set-cookie") ?? "" };
  };
  /* the whole round trip: start (PKCE, nonce, state, binding cookie), the
     person picks their Google account, the callback */
  const google = async (sub, email) => {
    const st = await worker.fetch(new Request(`https://api.a2z.test/api/v1/auth/google`), env);
    const bind = /azone_g_bind=([0-9a-f]{64})/.exec(st.headers.get("set-cookie") ?? "")?.[1] ?? "";
    const { code, state } = G.authorize(st.headers.get("location") ?? "https://x.invalid/", { sub, email });
    const r = await worker.fetch(new Request(`https://api.a2z.test/api/v1/auth/google/callback?code=${code}&state=${state}`, { headers: { cookie: `azone_g_bind=${bind}` } }), env);
    /* v1.266.1 - a failure carries a reference (&ref=A-1B2C3D); compare the page */
    return { status: r.status, loc: (r.headers.get("location") ?? "").replace(/&ref=[SGTA]-[0-9A-F]{6}$/, ""), ref: /&ref=([SGTA]-[0-9A-F]{6})$/.exec(r.headers.get("location") ?? "")?.[1] ?? null, cookies: r.headers.get("set-cookie") ?? "" };
  };
  /* v1.264.0 - the code step after a Google sign-in: the challenge is the
     HttpOnly twofa_ch cookie the callback set, sent back the way a browser
     would (the page's script never sees it) */
  const verifyG = async (cookies, c) => {
    const ch = /twofa_ch=([^;]+)/.exec(cookies)?.[1];
    const r = await worker.fetch(new Request(`https://api.a2z.test/api/v1/auth/2fa/verify`, { method: "POST", headers: { "content-type": "application/json", origin: "https://portal.a2z.test", ...(ch ? { cookie: `twofa_ch=${ch}` } : {}) }, body: JSON.stringify({ code: c }) }), env);
    const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch { /* */ }
    return { status: r.status, j, text, cookies: r.headers.get("set-cookie") ?? "" };
  };
  const user = (id) => db.prepare(`SELECT * FROM users WHERE id = ?`).get(id);
  const users = () => db.prepare(`SELECT COUNT(*) AS n FROM users`).get().n;
  const sessions = (id) => db.prepare(`SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?`).get(id).n;
  const changes = (id) => db.prepare(`SELECT * FROM email_changes WHERE user_id = ? ORDER BY id`).all(id);
  const audits = (a) => db.prepare(`SELECT * FROM audit_log WHERE action = ? ORDER BY id`).all(a).map((r) => ({ ...r, d: JSON.parse(r.detail ?? "{}") }));
  const R = "Company email moving to a2zcreative.my";
  const M = (uid, items, extra = {}) => call("/staff/accounts/email-move", uid, "POST", { items, reason: R, ...extra });
  const tokenFor = (to) => /#token=([0-9a-f]{64})/.exec([...mails].reverse().find((x) => x.to === to)?.text ?? "")?.[1];

  try {
    /* ---- who ---- */
    for (const r of ["ceo", "coo", "hr_admin", "aina", "customer"]) ok((await call("/staff/accounts/email-move", U[r])).status === 403, `the ${r} cannot open the move before being the owner / super admin`);
    ok((await M(U.coo, [{ user_id: 13, new_email: "nora@a2zcreative.my" }], { dry_run: true })).status === 403, "nor preview it by direct request (COO)");
    ok((await call("/staff/owner", U.super_admin, "POST", { user_id: 1, reason: "Alif is the founder and owner of A2Z", totp: code() })).status === 200, "the super admin names the owner");
    const L0 = await call("/staff/accounts/email-move", U.ceo);
    const ids = (L0.j?.rows ?? []).map((r) => r.id);
    ok(L0.status === 200, "the owner opens the list", L0.text.slice(0, 200));
    const rowOf = (id) => L0.j?.rows?.find((r) => r.id === id);
    /* v1.378.0 - the CEO: personal-email staff are an option - listed apart, with a name-based suggestion */
    ok(rowOf(5)?.source === "personal" && rowOf(11)?.source === "personal" && rowOf(13)?.source === "old_domain", "personal-email staff are listed apart (source personal); old-domain staff are old_domain");
    ok(rowOf(5)?.proposed === "aina.sofea@a2zcreative.my", "a personal address gets a suggestion from the name, stopping at bin / binti", rowOf(5)?.proposed);
    ok(!ids.includes(9) && !ids.includes(16), "customers and agents are never listed, whatever their address");
    ok([1, 2, 4, 6, 7, 8, 10, 12, 13, 15].every((i) => ids.includes(i)), "every @azoneofficial.com staff account is listed");
    const nora = L0.j?.rows?.find((r) => r.id === 13);
    ok(nora?.proposed === "nora@a2zcreative.my" && nora?.state === "not_started" && nora?.can === true, "the proposal keeps the name on the new domain");
    ok(L0.j?.rows?.find((r) => r.id === 1)?.can === false && L0.j?.rows?.find((r) => r.id === 8)?.can === false && L0.j?.rows?.find((r) => r.id === 12)?.can === false, "the owner's own, the CEO and the super admin accounts are not his to move");
    ok(L0.j?.rows?.find((r) => r.id === 15)?.google_only === true, "a Google-only account is flagged");
    ok(L0.j?.ttl_hours === 72, "the link lasts 72 hours");
    ok(!/password_hash|totp_secret|oauth\$/.test(L0.text), "the list never carries a password hash or a 2FA secret");

    /* ---- the preview writes nothing ---- */
    const before = db.prepare(`SELECT COUNT(*) AS n FROM email_changes`).get().n;
    const pv = await M(U.ceo, [
      { user_id: 13, new_email: "nora@a2zcreative.my" }, { user_id: 10, new_email: "edwin@a2zcreative.my" },
      { user_id: 5, new_email: "aina@a2zcreative.my" }, { user_id: 11, new_email: "lia@a2zcreative.my" },
      { user_id: 6, new_email: "mia@gmail.com" }, { user_id: 4, new_email: "edwin@a2zcreative.my" },
      { user_id: 1, new_email: "alif@a2zcreative.my" }, { user_id: 12, new_email: "ceo2@a2zcreative.my" },
      { user_id: 9, new_email: "shop@a2zcreative.my" }, { user_id: 16, new_email: "agent@a2zcreative.my" },
    ], { dry_run: true });
    const st = (id) => pv.j?.rows?.find((r) => r.user_id === id)?.state;
    ok(pv.status === 200 && pv.j?.dry_run === true && db.prepare(`SELECT COUNT(*) AS n FROM email_changes`).get().n === before && mails.length === 0, "the preview writes nothing and sends nothing", pv.text.slice(0, 300));
    ok(st(13) === "send" && st(10) === "send", "old-domain staff go through, a different new name too (some addresses differ)");
    ok(st(5) === "refused" && st(11) === "refused" && /personal/.test(pv.j?.rows?.find((r) => r.user_id === 5)?.reason ?? ""), "Gmail and other addresses are refused unless personal-email staff are included");
    ok(st(6) === "refused", "a new address outside @a2zcreative.my is refused");
    ok(st(4) === "refused", "the same new address for two people is refused");
    ok(st(1) === "refused" && st(12) === "refused", "never your own, never a CEO account (the super admin's)");
    ok(st(9) === "refused" && st(16) === "refused", "a customer or agent is not a staff account");
    ok(pv.j?.counts?.send === 2, "the counts say what will happen");

    /* ---- the send: reason, code, mail ---- */
    const it = [{ user_id: 13, new_email: "nora@a2zcreative.my" }, { user_id: 10, new_email: "edwin@a2zcreative.my" }, { user_id: 5, new_email: "aina@a2zcreative.my" }];
    ok((await M(U.ceo, it, { reason: "short" })).j?.error?.code === "reason_required", "a reason is required");
    ok((await M(U.ceo, it)).j?.error?.code === "mail_unavailable", "no mail set up: nothing is sent and it says so");
    env.EMAIL = MAIL; env.MAIL_FROM = "hello@a2zcreative.my";
    const nc = await M(U.ceo, it);
    ok(nc.status === 401 && changes(13).length === 0, "the authenticator code is required before anything is written", nc.text.slice(0, 200));
    const s1 = await M(U.ceo, it, { totp: code() });
    ok(s1.status === 200 && s1.j?.sent === 2, "two links sent", s1.text.slice(0, 300));
    const c13 = changes(13);
    ok(c13.length === 1 && c13[0].status === "pending" && c13[0].route === "email" && c13[0].old_email === "nora@azoneofficial.com" && c13[0].new_email === "nora@a2zcreative.my", "one waiting change per person, by email link");
    const hrs = db.prepare(`SELECT (julianday(expires_at) - julianday(created_at)) * 24 AS h FROM email_changes WHERE id = ?`).get(c13[0].id).h;
    ok(Math.round(hrs) === 72, "each link expires after 72 hours", String(hrs));
    ok(changes(5).length === 0 && user(5).email === "aina@gmail.com", "the Gmail account is untouched when not included");
    /* ---- v1.378.0 - the option: personal-email staff included on purpose ---- */
    const pp = await M(U.ceo, [{ user_id: 5, new_email: "aina.sofea@a2zcreative.my" }], { dry_run: true, include_personal: true });
    ok(pp.j?.rows?.[0]?.state === "send" && pp.j?.rows?.[0]?.personal === true && changes(5).length === 0, "with include_personal the Gmail staff member previews as Send link (marked personal), still writing nothing", pp.text.slice(0, 200));
    const ps = await M(U.ceo, [{ user_id: 5, new_email: "aina.sofea@a2zcreative.my" }], { include_personal: true, totp: code() });
    ok(ps.j?.sent === 1 && changes(5)[0]?.old_email === "aina@gmail.com" && user(5).email === "aina@gmail.com", "...the link is sent; the Gmail login stays until it is opened", ps.text.slice(0, 200));
    ok(audits("user.email_change_requested").some((a) => a.entity_id === "5" && a.d.personal === true) && audits("user.email_move_batch").some((a) => a.d.include_personal === true), "a personal move is audited as personal, and the batch says it included them");
    ok((await call("/auth/email-verify", null, "POST", { token: tokenFor("aina.sofea@a2zcreative.my") })).status === 200 && user(5).email === "aina.sofea@a2zcreative.my" && sessions(5) === 0, "opening it moves the login - same account, signed out everywhere");
    ok((await M(U.ceo, [{ user_id: 9, new_email: "shop2@a2zcreative.my" }, { user_id: 16, new_email: "agent2@a2zcreative.my" }], { dry_run: true, include_personal: true })).j?.rows?.every((r) => r.state === "refused"), "include_personal never reaches a customer or an agent");
    ok(user(13).email === "nora@azoneofficial.com" && sessions(13) === 1, "nothing changes until the person proves the new mailbox");
    const tN = tokenFor("nora@a2zcreative.my");
    ok(tN && mails.some((x) => x.to === "nora@azoneofficial.com"), "the link goes to the new address, the old address is told");
    ok(c13[0].token_hash === sha(tN) && !db.prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE detail LIKE ?`).get(`%${tN}%`).n && !s1.text.includes(tN), "only the hash is stored; the token is never in the audit or the answer");
    const a1 = audits("user.email_change_requested").filter((a) => a.d.bulk && ["13", "10"].includes(String(a.entity_id)));
    ok(a1.length === 2 && a1.every((a) => a.d.route === "email" && a.d.reason === R) && new Set(a1.map((a) => a.d.bulk)).size === 1 && audits("user.email_move_batch").some((b) => b.d.batch === a1[0]?.d.bulk), "audited per person and once for the batch");

    /* ---- a retry adds nothing ---- */
    const s2 = await M(U.ceo, [{ user_id: 13, new_email: "nora@a2zcreative.my" }], { totp: code() });
    ok(s2.j?.rows?.[0]?.state === "already_sent" && changes(13).length === 1, "pressing send again adds nothing", s2.text.slice(0, 300));
    const L1 = await call("/staff/accounts/email-move", U.ceo);
    ok(L1.j?.rows?.find((r) => r.id === 13)?.state === "sent", "the list shows Link sent");

    /* ---- the person confirms ---- */
    const n0 = users();
    const v = await call("/auth/email-verify", null, "POST", { token: tN });
    ok(v.status === 200 && user(13).email === "nora@a2zcreative.my" && sessions(13) === 0 && users() === n0, "the link moves the login - same account, no new account, signed out everywhere", v.text);
    ok(db.prepare(`SELECT salesperson_id FROM sales_documents WHERE id = 100`).get().salesperson_id === 13, "the person's records stay with the same account");
    const L2 = await call("/staff/accounts/email-move", U.ceo);
    ok(L2.j?.rows?.find((r) => r.id === 13)?.state === "moved", "the list shows Moved");
    ok((await M(U.ceo, [{ user_id: 13, new_email: "nora2@a2zcreative.my" }], { dry_run: true, include_personal: true })).j?.rows?.[0]?.state === "refused", "a moved account is not moved again, even with personal staff included");
    const signIn2 = await call("/auth/login", null, "POST", { email: "nora@a2zcreative.my", password: "nope" });
    ok(signIn2.status !== 500, "the new address is a normal login address");

    /* ---- expiry and resend ---- */
    db.prepare(`UPDATE email_changes SET expires_at = datetime('now', '-1 hours') WHERE user_id = 10`).run();
    const tE = tokenFor("edwin@a2zcreative.my");
    ok((await call("/auth/email-verify", null, "POST", { token: tE })).j?.error?.code === "link_invalid" && user(10).email === "ed@azoneofficial.com", "a link past 72 hours does nothing");
    ok((await call("/staff/accounts/email-move", U.ceo)).j?.rows?.find((r) => r.id === 10)?.state === "expired", "the list shows the link expired");
    const rs = await M(U.ceo, [{ user_id: 10, new_email: "edwin@a2zcreative.my", resend: true }], { totp: code() });
    ok(rs.j?.sent === 1 && changes(10).filter((c) => c.status === "pending").length === 1, "Resend sends one fresh link", rs.text.slice(0, 200));
    const rs2 = await M(U.ceo, [{ user_id: 10, new_email: "edwin@a2zcreative.my", resend: true }], { totp: code() });
    ok(rs2.j?.sent === 1 && changes(10).filter((c) => c.status === "pending").length === 1, "a resend cancels the older link - only one waits");
    ok((await call("/auth/email-verify", null, "POST", { token: tokenFor("edwin@a2zcreative.my") })).status === 200 && user(10).email === "edwin@a2zcreative.my", "the fresh link moves it");

    /* ---- a mail that fails leaves nothing waiting ---- */
    mailFails = true;
    const mf = await M(U.ceo, [{ user_id: 6, new_email: "mia@a2zcreative.my" }], { totp: code() });
    ok(mf.j?.rows?.[0]?.result === "mail_failed" && changes(6).every((c) => c.status === "cancelled") && user(6).email === "mia@azoneofficial.com", "a mail that could not be sent says so and leaves nothing waiting", mf.text.slice(0, 200));
    mailFails = false;

    /* ---- the super admin moves the CEO ---- */
    const sa = await M(U.super_admin, [{ user_id: 1, new_email: "farhan@a2zcreative.my" }], { totp: code() });
    ok(sa.j?.sent === 1, "the super admin may move the CEO's login", sa.text.slice(0, 200));
    ok((await M(U.super_admin, [{ user_id: 8, new_email: "root@a2zcreative.my" }], { dry_run: true })).j?.rows?.[0]?.state === "refused", "never your own, the super admin either");

    /* ---- both domains are company domains during the move ---- */
    const cr = await call("/staff/users", U.hr_admin, "POST", { email: "new.hire@a2zcreative.my", name: "New Hire", role: "editor", password: "Temp-Pass-12345!", reason: R, totp: code() });
    ok(cr.status < 300 && !!db.prepare(`SELECT 1 FROM users WHERE email = ?`).get("new.hire@a2zcreative.my"), "a new @a2zcreative.my staff account passes the domain rule", cr.text.slice(0, 200));
    const cr2 = await call("/staff/users", U.hr_admin, "POST", { email: "x.hire@gmail.com", name: "X Hire", role: "editor", password: "Temp-Pass-12345!", reason: R, totp: code() });
    ok(cr2.j?.error?.code === "domain_policy", "a personal email still cannot be a staff account", cr2.text.slice(0, 200));
  } catch (e) {
    out.push([false, `runtime: ${e?.stack ?? e}`]);
  } finally {
    globalThis.Date = RealDate;
    globalThis.fetch = realFetch;
  }
  return out;
}

let fail = 0, n = 0;
const report = (list) => { for (const [p, m] of list) { n++; if (!p) { fail++; console.error(`FAIL ${m}`); } } };
const NOMUT = process.env.NOMUT === "1";
const dir = mkdtempSync(join(tmpdir(), "emove-"));
bundle(root, "worker/src/index.ts", join(dir, "worker.mjs"));
report(await runtime(join(dir, "worker.mjs")));
const checks = n;

const MUT = [
  ["worker/src/staff.ts", "a Gmail account moves without the opt-in", "if (row.personal && body?.include_personal !== true) { row.reason", "if (false) { row.reason"],
  ["worker/src/staff.ts", "a moved account moves again", "if (tEmail.endsWith(`@${NEW_STAFF_DOMAIN}`)) { row.reason", "if (false) { row.reason"],
  ["worker/src/staff.ts", "any new domain is accepted", " || !to.endsWith(`@${NEW_STAFF_DOMAIN}`)) { row.reason", ") { row.reason"],
  ["worker/src/staff.ts", "a retry sends a second link", 'if (ch?.status === "pending" && ch.new_email === to && !resend) { row.state = "already_sent";', 'if (false) { row.state = "already_sent";'],
  ["worker/src/staff.ts", "the link lasts 24 hours", "const MOVE_TTL_HOURS = 72;", "const MOVE_TTL_HOURS = 24;"],
  ["worker/src/staff.ts", "no authenticator code", 'const su = await requireFreshTotp(env, user, body?.totp, err, "move staff login emails");', "const su = null;"],
  ["worker/src/staff.ts", "the preview writes", "if (dry) return json({ ok: true, dry_run: true, rows, counts, ttl_hours: MOVE_TTL_HOURS });", ""],
  ["worker/src/staff.ts", "the account tier is not checked in the move", 'if (!canManageAccount(user, t.role)) { row.reason = "CEO and super admin accounts are moved by the super admin."; continue; }', ""],
  ["worker/src/staff.ts", "the move opens to anyone", 'if (!allows(user, "account_email")) return err("forbidden", "Only the company owner or the super admin manages staff sign-in." + ownerOffHint(user), 403);\n    const MOVE_TTL_HOURS', "    const MOVE_TTL_HOURS"],
  ["worker/src/staff.ts", "a failed mail leaves a link waiting", "await env.DB.prepare(`UPDATE email_changes SET status = 'cancelled' WHERE id = ?1`).bind(ins!.id).run();\n        r.result = \"mail_failed\"", "r.result = \"mail_failed\""],
  ["worker/src/accounts.ts", "only the old single domain counts", "String(env.COMPANY_DOMAINS ?? env.COMPANY_DOMAIN ?? \"\")", "String(env.COMPANY_DOMAIN ?? \"\")"],
];
for (const [file, name, from, to] of NOMUT ? [] : MUT) {
  n++;
  const src = readFileSync(join(root, file), "utf8");
  if (!src.includes(from)) { fail++; console.error(`FAIL mutation did not apply: ${name}`); continue; }
  const mdir = mkdtempSync(join(tmpdir(), "emove-m-"));
  cpSync(join(root, "worker"), join(mdir, "worker"), { recursive: true, filter: (p) => !p.includes("node_modules") });
  cpSync(join(root, "package.json"), join(mdir, "package.json"));
  for (const d of ["lib", "constants", "types"]) { try { cpSync(join(root, d), join(mdir, d), { recursive: true }); } catch { /* not every folder exists */ } }
  writeFileSync(join(mdir, file), src.replace(from, to));
  try { bundle(mdir, "worker/src/index.ts", join(mdir, "worker.mjs")); } catch { fail++; console.error(`FAIL mutation did not build: ${name}`); continue; }
  const res = await runtime(join(mdir, "worker.mjs"));
  if (!res.some(([p]) => !p)) { fail++; console.error(`FAIL mutation not caught: ${name}`); }
}

/* the documents and the site print A2Z's new contact email; AZ ONE OFFICIAL keeps its own */
n++; const iss = readFileSync(join(root, "lib/issuers.ts"), "utf8");
const a2zBlock = iss.slice(iss.indexOf("export const A2Z_CREATIVE"));
if (!/email: "hello@a2zcreative\.my"/.test(a2zBlock.slice(0, 2500))) { fail++; console.error("FAIL A2Z documents print hello@a2zcreative.my"); }
n++; if (!/email: "admin@azoneofficial\.com"/.test(iss.slice(0, iss.indexOf("export const A2Z_CREATIVE")))) { fail++; console.error("FAIL AZ ONE OFFICIAL keeps its own email"); }
n++; if (!/email: "hello@a2zcreative\.my"/.test(readFileSync(join(root, "constants/content.ts"), "utf8"))) { fail++; console.error("FAIL the website shows hello@a2zcreative.my"); }
n++; if (!/COMPANY_DOMAINS\s*=\s*"azoneofficial\.com,a2zcreative\.my"/.test(readFileSync(join(root, "worker/wrangler.toml"), "utf8"))) { fail++; console.error("FAIL both staff domains are configured"); }
/* v1.379.0 - the CEO: "for Admin, I didnt see any option for me to change CEO email". /admin -> Users opens the
   same Sign-in & recovery sheet for a staff account, and carries the move card */
const adm = readFileSync(join(root, "components/admin/admin-users.tsx"), "utf8");
n++; if (!/data-testid="user-email"/.test(adm) || !/onClick=\{\(\) => setSheetId\(sel\.id\)\}/.test(adm) || !/<AccountSheet userId=\{sheetId\}/.test(adm)) { fail++; console.error("FAIL /admin Users: Change login email opens the Sign-in & recovery sheet"); }
n++; if (!/!\["customer", "agent"\]\.includes\(sel\.role\) && <button[\s\S]{0,200}data-testid="user-email"/.test(adm)) { fail++; console.error("FAIL /admin Users: only for staff accounts"); }
n++; if (!/<EmailMoveCard \/>/.test(adm)) { fail++; console.error("FAIL /admin Users: the move card is there for the super admin"); }
if (fail) { console.error(`staff-email-move: ${fail} of ${n} failed`); process.exit(1); }
console.log(`staff-email-move: ${checks} checks passed (${NOMUT ? "mutations skipped" : `${MUT.length} mutations caught`}) - @azoneofficial.com staff move by a 72-hour link to the new mailbox; personal-email staff only when included`);
