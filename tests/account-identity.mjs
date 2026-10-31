/* ACCOUNT IDENTITY, LOGIN EMAIL AND RECOVERY (v1.238.0) - runtime guard: the
 * WHOLE worker (index.ts, bundled) against SQLite with every migration
 * applied, by direct request, the way the owner-access guard runs.
 *
 * The owner's brief, 31-10-2026 (claude/ACCOUNT-RECOVERY-AUDIT.md): "CEO CAN
 * SECURELY MANAGE STAFF LOGIN EMAILS. STAFF CAN RECOVER ACCOUNT ACCESS
 * SAFELY. GOOGLE AUTHENTICATION REMAINS CORRECTLY LINKED. HISTORICAL
 * BUSINESS RECORDS REMAIN INTACT. ONE AUTHORITATIVE USER ACCOUNT." Answers:
 * Cloudflare Email Sending; migration 0155; the owner and the super admin;
 * P0 + P1.
 *
 * What it proves, by request:
 *   who      only the verified owner and the super admin open or change a
 *            staff account's sign-in; CEO / super admin accounts stay the
 *            super admin's; never your own; a customer is not a staff account
 *   email    format, collision, reason and code are checked; nothing changes
 *            until the new address is proven (email link, Google sign-in as
 *            that address, or in person with the person's OWN code); the
 *            same users.id carries on, no account is created, every session
 *            is signed out, the old address is told, it is audited
 *   tier     an Admin / payroll account changed in person waits for the
 *            OTHER of owner and super admin
 *   google   identity is Google's sub: linked once, a different Google
 *            account on the same email is refused, a renamed Google email
 *            still reaches the same person
 *   tokens   only a SHA-256 is stored, never in the audit log, single use,
 *            expire after 24 hours
 *   recovery 2FA reset needs the identity check and is never silent; a
 *            set-password link replaces a typed password; no password, 2FA
 *            secret or backup code ever leaves the server
 *   support  a problem report is a Task, never carries a password
 *   handover offboarding hands open tasks to a colleague, finished ones stay
 * Then mutated copies must each fail a check.
 *
 *   node tests/account-identity.mjs
 */
import { readFileSync, readdirSync, mkdtempSync, writeFileSync, cpSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash, createHmac } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

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
    SESSION_PEPPER: "pepper", COMPANY_DOMAIN: "a2z.test", ALLOWED_ORIGINS: "https://portal.a2z.test",
    GOOGLE_CLIENT_ID: "cid", GOOGLE_CLIENT_SECRET: "csecret",
    MEDIA: { put: async () => {}, head: async () => null, get: async () => null, list: async () => ({ objects: [] }) },
  };
  const U = { ceo: 1, coo: 2, cco: 3, hr_admin: 4, sales_marketing: 5, marketing: 6, admin: 7, super_admin: 8, customer: 9, editor: 10, live_host: 11, ceo2: 12, nora: 13, root2: 14 };
  db.exec(`INSERT INTO users (id, name, email, role, is_active, password_hash, totp_enabled, totp_secret, base_salary_cents) VALUES
    (1,'Alif','alif@a2z.test','ceo',1,'x',1,'${SECRET}',0),(2,'Ops','ops@a2z.test','coo',1,'x',1,'${SECRET}',0),
    (3,'Com','com@a2z.test','cco',1,'x',1,'${SECRET}',0),(4,'Hana','hana@a2z.test','hr_admin',1,'x',1,'${SECRET}',200000),
    (5,'Aina','aina@gmail.com','sales_marketing',1,'x',1,'${SECRET}',210000),(6,'Mia','mia@gmail.com','marketing',1,'x',1,'${SECRET}',200000),
    (7,'Tech','tech@a2z.test','admin',1,'x',1,'${SECRET}',0),(8,'Root','root@a2z.test','super_admin',1,'x',1,'${SECRET}',0),
    (9,'Shop','shop@gmail.com','customer',1,'x',0,NULL,0),(10,'Ed','ed@a2z.test','editor',1,'x',1,'${SECRET}',200000),
    (11,'Lia','lia@gmail.com','live_host',1,'x',1,'${SECRET}',150000),(12,'Second','ceo2@a2z.test','ceo',1,'x',1,'${SECRET}',0),
    (13,'Nora','nora@a2z.test','editor',1,'x',1,'${SECRET}',200000),(14,'Root2','root2@a2z.test','super_admin',1,'x',1,'${SECRET}',0)`);
  db.exec(`INSERT INTO customers (id, company, created_by) VALUES (1,'Kedai',5)`);
  db.exec(`INSERT INTO sales_documents (id, doc_type, doc_number, customer_id, items, discount_cents, tax_percent, total_cents, payment_status, created_at, created_by, salesperson_id, kind) VALUES (100,'INV','INV-1',1,'[]',0,0,10000,'unpaid','2026-10-20 02:00:00',6,6,'service')`);
  const RealDate = globalThis.Date; let fixed = new RealDate("2026-10-31T02:00:00Z").getTime();
  globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [fixed])); } static now() { return fixed; } };
  const code = () => { fixed += 31000; return totpAt(fixed); };
  /* Google, as the callback sees it */
  let gProfile = null;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (u) => {
    const url = String(u instanceof Request ? u.url : u);
    if (url.startsWith("https://oauth2.googleapis.com/token")) return new Response(JSON.stringify({ access_token: "at" }), { status: 200 });
    if (url.startsWith("https://www.googleapis.com/oauth2/v3/userinfo")) return new Response(JSON.stringify(gProfile), { status: 200 });
    return new Response("{}", { status: 200 });
  };
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
  const google = async (sub, email) => {
    gProfile = { sub, email, email_verified: true, name: "G" };
    const r = await worker.fetch(new Request(`https://api.a2z.test/api/v1/auth/google/callback?code=c&state=S1`, { headers: { cookie: "azone_oauth_state=S1" } }), env);
    return { status: r.status, loc: r.headers.get("location") ?? "", cookies: r.headers.get("set-cookie") ?? "" };
  };
  const user = (id) => db.prepare(`SELECT * FROM users WHERE id = ?`).get(id);
  const users = () => db.prepare(`SELECT COUNT(*) AS n FROM users`).get().n;
  const sessions = (id) => db.prepare(`SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?`).get(id).n;
  const lastAudit = (a) => { const r = db.prepare(`SELECT * FROM audit_log WHERE action = ? ORDER BY id DESC LIMIT 1`).get(a); return r ? { ...r, d: JSON.parse(r.detail ?? "{}") } : null; };
  const R = "Staff member lost access to the old mailbox";

  try {
    /* ---- who ---- */
    ok((await call("/staff/accounts/4", U.ceo)).status === 403, "before an owner is named, the CEO cannot open a staff account's sign-in");
    for (const r of ["coo", "cco", "hr_admin", "admin", "marketing", "customer"]) {
      ok((await call("/staff/accounts/6", U[r])).status === 403, `the ${r} cannot open a staff account's sign-in`);
      ok((await call("/staff/accounts/6/email", U[r], "POST", { new_email: "x@a2z.test", route: "google", reason: R, totp: code() })).status === 403, `...nor change its login email (${r}, direct request)`);
      ok((await call("/staff/accounts/6/reset-2fa", U[r], "POST", { reason: R, identity_checked: "Video call", totp: code() })).status === 403, `...nor reset its 2FA (${r})`);
    }
    ok((await call("/staff/owner", U.super_admin, "POST", { user_id: 1, reason: "Alif is the founder and owner of A2Z", totp: code() })).status === 200, "the super admin names the owner");
    const sheet = await call("/staff/accounts/4", U.ceo);
    ok(sheet.status === 200 && sheet.j?.account?.id === 4 && sheet.j.can?.email && sheet.j.can?.recovery, "the owner opens a staff account's sign-in", `${sheet.status} ${sheet.text.slice(0, 200)}`);
    ok(!sheet.text.includes(SECRET) && !/password_hash|totp_secret|"code"/.test(sheet.text), "the sheet never carries a password hash, a 2FA secret or a backup code");
    ok((await call("/staff/accounts/4", U.super_admin)).status === 200, "the super admin opens it too");
    ok((await call("/staff/accounts/8", U.ceo)).status === 403 && (await call("/staff/accounts/12", U.ceo)).status === 403, "a super admin or CEO account stays the super admin's");
    ok((await call("/staff/accounts/9", U.ceo)).status === 404, "a customer is not a staff account");
    ok((await call("/staff/accounts/8/email", U.super_admin, "POST", { new_email: "me@a2z.test", route: "google", reason: R, totp: code() })).j?.error?.code === "self_change", "never your own account");
    ok((await call("/staff/accounts/12", U.ceo2)).status === 403, "a second CEO-role account gains nothing");

    /* ---- email: validation ---- */
    const E = (body) => call("/staff/accounts/6/email", U.ceo, "POST", { route: "google", reason: R, ...body });
    ok((await E({ new_email: "not-an-email", totp: code() })).status === 400, "a malformed address is refused");
    ok((await E({ new_email: "ED@a2z.test", totp: code() })).j?.error?.code === "email_taken", "an address that belongs to another account is refused (any case)");
    ok((await E({ new_email: "mia.new@gmail.com", reason: "short", totp: code() })).j?.error?.code === "reason_required", "a reason is required");
    const noCode = await E({ new_email: "mia.new@gmail.com" });
    ok(noCode.status === 401 && noCode.j?.error?.code === "totp_required", "the owner's fresh authenticator code is required", `${noCode.status} ${noCode.text}`);
    ok((await E({ new_email: "mia.new@gmail.com", route: "email", totp: code() })).j?.error?.code === "mail_unavailable", "the email-link route says so when email sending is not set up - nothing pretends a mail went");
    ok(db.prepare(`SELECT COUNT(*) AS n FROM email_changes`).get().n === 0, "...and no refused request left a waiting change");

    /* ---- email: the Google route ---- */
    const n0 = users();
    const g1 = await E({ new_email: "Mia.New@gmail.com", totp: code() });
    ok(g1.status === 200 && g1.j?.applied === false, "a Google-route change waits", g1.text);
    ok(user(6).email === "mia@gmail.com" && sessions(6) >= 1, "the old login stays exactly as it was until the new address is proven");
    ok((await call("/staff/accounts/4/email", U.ceo, "POST", { new_email: "mia.new@gmail.com", route: "google", reason: R, totp: code() })).j?.error?.code === "email_taken", "a waiting change holds its address against another account");
    const gNew = await google("g-mia", "mia.new@gmail.com");
    const m = user(6);
    ok(m.email === "mia.new@gmail.com" && m.google_sub === "g-mia" && m.email_verified_at, "a Google sign-in as the new address completes it on the SAME account and links Google's id", JSON.stringify({ e: m.email, s: m.google_sub, loc: gNew.loc }));
    ok(users() === n0, "no account was created");
    ok(lastAudit("user.email_change")?.d?.from === "mia@gmail.com" && lastAudit("user.email_change").d.to === "mia.new@gmail.com" && lastAudit("user.email_change").d.via === "google_sign_in", "the change is audited with from, to and how it was proven");
    ok(db.prepare(`SELECT salesperson_id, created_by FROM sales_documents WHERE id = 100`).get().salesperson_id === 6, "the business records still point at the same person");
    ok(gNew.loc.includes("2fa=1"), "the person still passes two-factor sign-in", gNew.loc);

    /* ---- google: identity is the sub ---- */
    const l1 = await google("g-ed", "ed@a2z.test");
    ok(user(10).google_sub === "g-ed" && lastAudit("auth.google_linked")?.entity_id === "10" && l1.loc.includes("2fa=1"), "a first Google sign-in links Google's id once, audited");
    const evil = await google("g-evil", "ed@a2z.test");
    ok(evil.loc === "/login?error=oauth" && !evil.cookies.includes("azone_session=") && user(10).google_sub === "g-ed", "a DIFFERENT Google account with the same email is refused, never merged", evil.loc);
    ok(lastAudit("auth.google_refused")?.d?.reason === "linked_to_a_different_google_account", "...and the refusal is audited for the owner");
    const n1 = users();
    const renamed = await google("g-ed", "ed.personal@gmail.com");
    ok(renamed.loc.includes("2fa=1") && user(10).email === "ed@a2z.test" && users() === n1, "a renamed Google email still reaches the same person, and creates nothing", renamed.loc);
    await google("g-new", "walkin@gmail.com");
    const walk = db.prepare(`SELECT role, google_sub FROM users WHERE email = 'walkin@gmail.com'`).get();
    ok(walk?.role === "customer" && walk.google_sub === "g-new", "an unknown Google account still becomes a customer, as before - with its id");

    /* ---- email: in person ---- */
    const ip0 = await call("/staff/accounts/11/email", U.ceo, "POST", { new_email: "lia@a2z.test", route: "in_person", reason: R, totp: code() });
    ok(ip0.status === 400, "in person needs who checked the identity", ip0.text);
    const ip1 = await call("/staff/accounts/11/email", U.ceo, "POST", { new_email: "lia@a2z.test", route: "in_person", reason: R, identity_checked: "Alif, face to face", totp: code() });
    ok(ip1.status === 401 && ip1.j?.error?.code === "target_totp_required" && user(11).email === "lia@gmail.com", "...and the person's OWN authenticator code - an administrator's word alone changes nothing", ip1.text);
    const c11 = code();
    const ip2 = await call("/staff/accounts/11/email", U.ceo, "POST", { new_email: "lia@a2z.test", route: "in_person", reason: R, identity_checked: "Alif, face to face", totp: c11, target_totp: c11 });
    ok(ip2.status === 200 && ip2.j?.applied === true && user(11).email === "lia@a2z.test" && sessions(11) === 0, "with both codes it applies on the same account and signs them out everywhere", ip2.text);
    ok(db.prepare(`SELECT COUNT(*) AS n FROM notifications WHERE user_id = 11 AND kind = 'security'`).get().n >= 1, "the person is told");

    /* ---- tier: Admin / payroll accounts need the other approver ---- */
    const c7 = code();
    const adm = await call("/staff/accounts/7/email", U.ceo, "POST", { new_email: "tech2@a2z.test", route: "in_person", reason: R, identity_checked: "Video call with Alif", totp: c7, target_totp: c7 });
    ok(adm.status === 200 && adm.j?.applied === false && adm.j.needs_second === true && user(7).email === "tech@a2z.test", "an Admin account changed in person waits for a second approval", adm.text);
    const cid = adm.j?.change_id;
    ok((await call(`/staff/accounts/email-changes/${cid}/approve`, U.ceo, "POST", { totp: code() })).status === 403, "the requester cannot approve their own change");
    ok((await call(`/staff/accounts/email-changes/${cid}/approve`, U.coo, "POST", { totp: code() })).status === 403, "the COO cannot approve it");
    const ap = await call(`/staff/accounts/email-changes/${cid}/approve`, U.super_admin, "POST", { totp: code() });
    ok(ap.status === 200 && ap.j?.applied === true && user(7).email === "tech2@a2z.test" && lastAudit("user.email_change")?.d?.approved_by === 8, "the super admin's approval applies it - audited with both", ap.text);

    /* ---- email: the link route, with Cloudflare Email Sending ---- */
    env.EMAIL = MAIL; env.MAIL_FROM = "portal@a2z.test";
    const el = await call("/staff/accounts/13/email", U.ceo, "POST", { new_email: "nora2@a2z.test", route: "email", reason: R, totp: code() });
    const linkMail = mails.find((x) => x.to === "nora2@a2z.test");
    const token = /#token=([0-9a-f]{64})/.exec(linkMail?.text ?? "")?.[1];
    ok(el.status === 200 && el.j?.sent === true && token, "the link goes to the NEW address", el.text);
    ok(mails.some((x) => x.to === "nora@a2z.test" && /requested/.test(x.subject)), "the original address is told a change was asked for");
    ok(!/[?&]token=/.test(linkMail?.text ?? ""), "the token rides in the fragment, never in a request line");
    ok(user(13).email === "nora@a2z.test", "the old verified login is not replaced before the link is used");
    const row = db.prepare(`SELECT token_hash FROM email_changes WHERE new_email = 'nora2@a2z.test'`).get();
    ok(row?.token_hash === sha(token) && !db.prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE detail LIKE ?`).get(`%${token}%`).n, "only the token's SHA-256 is stored, and the audit log never holds it");
    ok(!el.text.includes(token), "the requester never sees the token");
    const v1 = await call("/auth/email-verify", null, "POST", { token });
    ok(v1.status === 200 && user(13).email === "nora2@a2z.test" && sessions(13) === 0, "the link confirms it - same account, signed out everywhere", v1.text);
    ok(mails.some((x) => x.to === "nora@a2z.test" && /was changed/.test(x.subject)), "the old address is told it changed");
    ok((await call("/auth/email-verify", null, "POST", { token })).j?.error?.code === "link_invalid", "the link works once");
    const el2 = await call("/staff/accounts/13/email", U.ceo, "POST", { new_email: "nora3@a2z.test", route: "email", reason: R, totp: code() });
    const tok2 = /#token=([0-9a-f]{64})/.exec(mails.find((x) => x.to === "nora3@a2z.test")?.text ?? "")?.[1];
    /* SQLite keeps its own clock: the change is aged past its 24 hours there */
    db.prepare(`UPDATE email_changes SET created_at = datetime('now', '-25 hours'), expires_at = datetime('now', '-1 hours') WHERE id = ?`).run(el2.j?.change_id ?? 0);
    ok(el2.status === 200 && (await call("/auth/email-verify", null, "POST", { token: tok2 })).j?.error?.code === "link_invalid" && user(13).email === "nora2@a2z.test", "a link older than 24 hours does nothing", `${el2.status} ${el2.text.slice(0, 200)} ${!!tok2}`);
    mailFails = true;
    const mf = await call("/staff/accounts/13/email", U.ceo, "POST", { new_email: "nora4@a2z.test", route: "email", reason: R, totp: code() });
    ok(mf.status === 502 && db.prepare(`SELECT status FROM email_changes WHERE new_email = 'nora4@a2z.test'`).get()?.status === "cancelled", "a mail that could not be sent says so and leaves nothing waiting", mf.text);
    mailFails = false;

    /* ---- recovery ---- */
    db.exec(`INSERT INTO twofa_backup_codes (user_id, code_hash) VALUES (5, 'h1'), (5, 'h2')`);
    signIn(5);
    ok((await call("/staff/accounts/5/reset-2fa", U.ceo, "POST", { reason: R, totp: code() })).status === 400, "a 2FA reset needs who checked the identity");
    const rz = await call("/staff/accounts/5/reset-2fa", U.ceo, "POST", { reason: "Phone with the authenticator was stolen", identity_checked: "Alif, video call", totp: code() });
    ok(rz.status === 200 && user(5).totp_enabled === 0 && !user(5).totp_secret && sessions(5) === 0 && db.prepare(`SELECT COUNT(*) AS n FROM twofa_backup_codes WHERE user_id = 5`).get().n === 0, "the reset clears the factor, the backup codes and every session", rz.text);
    ok(lastAudit("auth.2fa_reset_by_admin")?.d?.identity_checked_by && db.prepare(`SELECT COUNT(*) AS n FROM notifications WHERE user_id = 5 AND message LIKE '%reset your two-factor%'`).get().n === 1 && mails.some((x) => x.to === "aina@gmail.com" && /two-factor/.test(x.subject)), "...and is never silent: audited, notified and emailed");
    delete env.EMAIL; delete env.MAIL_FROM;
    signIn(4);
    const pl = await call("/staff/accounts/4/password-link", U.ceo, "POST", { reason: "First sign-in after the mailbox move", totp: code() });
    const ptok = /#token=([0-9a-f]{64})/.exec(pl.j?.link ?? "")?.[1];
    ok(pl.status === 200 && pl.j.emailed === false && ptok, "without email sending the set-password link is shown once to hand over", pl.text);
    ok(db.prepare(`SELECT token_hash FROM account_tokens WHERE user_id = 4`).get()?.token_hash === sha(ptok) && !db.prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE detail LIKE ?`).get(`%${ptok}%`).n, "the link is stored as a hash only");
    ok((await call("/auth/set-password", null, "POST", { token: ptok, password: "short" })).status === 400, "a short password is refused");
    const before = user(4).password_hash;
    const sp = await call("/auth/set-password", null, "POST", { token: ptok, password: "a-long-new-passphrase" });
    ok(sp.status === 200 && user(4).password_hash !== before && sessions(4) === 0 && user(4).totp_enabled === 1, "the person chooses their own password; sessions end; 2FA is untouched", sp.text);
    ok((await call("/auth/set-password", null, "POST", { token: ptok, password: "another-long-passphrase" })).j?.error?.code === "link_invalid", "the link works once");
    const lg = await call("/auth/login", null, "POST", { email: "hana@a2z.test", password: "a-long-new-passphrase" });
    ok(lg.status === 200 && lg.j?.requires_2fa !== false, "the new password signs in (and two-factor still follows)", `${lg.status} ${lg.text.slice(0, 160)}`);
    signIn(6); signIn(6);
    const sh = await call("/staff/accounts/6", U.ceo);
    const ref = sh.j?.sessions?.[0]?.ref;
    ok(sh.j?.sessions?.length >= 2 && /^[0-9a-f]{12}$/.test(ref ?? "") && !sh.text.includes(sha(tok[6])), "the device list shows a short reference, never the session id");
    const one = await call("/staff/accounts/6/sessions/revoke", U.ceo, "POST", { ref, totp: code() });
    ok(one.status === 200 && one.j.sessions_revoked === 1, "one device can be signed out on its own", one.text);
    const ul = await call("/staff/accounts/10/google/unlink", U.ceo, "POST", { reason: "Ed replaced his Google account", totp: code() });
    ok(ul.status === 200 && user(10).google_sub === null && user(10).email === "ed@a2z.test", "unlinking Google keeps the account and its email");
    ok((await call("/staff/accounts/8/suspend", U.ceo, "POST", { suspend: true, reason: R, totp: code() })).status === 403, "the owner cannot suspend a super admin account");

    /* ---- support: a report is a task ---- */
    ok((await call("/staff/support/report", U.marketing, "POST", { kind: "login", description: "Cannot sign in, password: hunter22 does not work" })).j?.error?.code === "secret_in_report", "a report carrying a password is refused");
    const rp = await call("/staff/support/report", U.marketing, "POST", { kind: "login", description: "The sign-in page keeps saying my details are wrong", context: { tab: "Desk", version: "1.238.0", last_error: "401 invalid_credentials /auth/login" } });
    const task = db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(rp.j?.task_id);
    ok(rp.status === 200 && task?.assigned_to === 1 && task.created_by === 6 && task.priority === "high", "it becomes a Task for the owner, created by the reporter", rp.text);
    ok((await call("/staff/support/settings", U.coo, "POST", { user_id: 4 })).status === 403, "the COO cannot choose who receives reports");
    ok((await call("/staff/support/settings", U.ceo, "POST", { user_id: 4 })).status === 200, "the owner chooses who receives them");
    const rp2 = await call("/staff/support/report", U.marketing, "POST", { kind: "access", description: "The Sales tab is missing from my screen" });
    ok(db.prepare(`SELECT assigned_to FROM tasks WHERE id = ?`).get(rp2.j?.task_id)?.assigned_to === 4, "...and the next report goes to that person");

    /* ---- handover ---- */
    signIn(4);
    db.exec(`INSERT INTO tasks (id, title, assigned_to, created_by, status) VALUES (900, 'Open job', 10, 1, 'open'), (901, 'Done job', 10, 1, 'completed')`);
    ok((await call("/staff/users/10/handover", U.marketing)).status === 403, "what a leaver holds is not for everyone");
    const ho = await call("/staff/users/10/handover", U.hr_admin);
    ok(ho.status === 200 && ho.j.tasks.some((t) => t.id === 900) && !ho.j.tasks.some((t) => t.id === 901), "HR sees the leaver's open tasks", `${ho.status} ${ho.text.slice(0, 300)}`);
    const off = await call("/users/10/offboard", U.ceo, "POST", { left_on: "2026-11-30", handover_to: 13 });
    ok(off.status === 200 && off.j.moved?.tasks === 1 && db.prepare(`SELECT assigned_to FROM tasks WHERE id = 900`).get().assigned_to === 13 && db.prepare(`SELECT assigned_to FROM tasks WHERE id = 901`).get().assigned_to === 10, "offboarding hands the open task over; the finished one keeps the leaver's name", off.text);
    ok(user(10) && user(10).employment_status === "resigned", "the former employee is kept, not deleted");
    const offExec = await call("/users/3/offboard", U.ceo, "POST", { left_on: "2026-11-30" });
    ok(offExec.status === 401 && offExec.j?.error?.code === "totp_required" && user(3).employment_status !== "resigned", "an executive offboard asks the owner for the code (the sheet signs it)", offExec.text);
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
const dir = mkdtempSync(join(tmpdir(), "acct-"));
bundle(root, "worker/src/index.ts", join(dir, "worker.mjs"));
report(await runtime(join(dir, "worker.mjs")));
const checks = n;

const MUT = [
  ["worker/src/accounts.ts", "an applied change keeps the old sessions", "    env.DB.prepare(`DELETE FROM sessions WHERE user_id = ?1`).bind(c.user_id),\n  ]);", "  ]);"],
  ["worker/src/index.ts", "a different Google account on the same email is merged", 'if (subReady && byEmail.google_sub && byEmail.google_sub !== sub) return await refuseG(byEmail.id, "linked_to_a_different_google_account");', ""],
  ["worker/src/staff.ts", "in person without the person's own code", 'if (!/^\\d{6}$/.test(tc)) return err("target_totp_required"', 'if (false) return err("target_totp_required"'],
  ["worker/src/staff.ts", "privileged accounts skip the second approval", 'const needsSecond = route === "in_person" && privilegedTarget(t.role) ? 1 : 0;', "const needsSecond = 0;"],
  ["worker/src/staff.ts", "the requester approves their own change", "if (c.requested_by === user.id) return err(", "if (false) return err("],
  ["worker/src/staff.ts", "the token is stored raw", "tok ? await sha256Acct(tok) : null", "tok"],
  ["worker/src/staff.ts", "the account tier is not checked", 'if (!canManageAccount(user, t.role)) return { r: err("forbidden", "CEO and super admin accounts are managed by the super admin only", 403) };', ""],
  ["worker/src/staff.ts", "a 2FA reset without the identity check", 'if (action === "/reset-2fa" && checked.length < 3) return err(', 'if (false) return err('],
  ["worker/src/index.ts", "a set-password link is not spent when used", "      env.DB.prepare(`UPDATE account_tokens SET used_at = datetime('now'), token_hash = 'used:' || id WHERE user_id = ?1 AND kind = 'set_password' AND used_at IS NULL`).bind(t.user_id),\n", ""],
  ["worker/src/staff.ts", "a report may carry a password", 'if (/\\b(password|kata laluan|passcode|pin)\\s*[:=]/i.test(text)) return err(', "if (false) return err("],
];
for (const [file, name, from, to] of NOMUT ? [] : MUT) {
  n++;
  const src = readFileSync(join(root, file), "utf8");
  if (!src.includes(from)) { fail++; console.error(`FAIL mutation did not apply: ${name}`); continue; }
  const mdir = mkdtempSync(join(tmpdir(), "acct-m-"));
  cpSync(join(root, "worker"), join(mdir, "worker"), { recursive: true, filter: (p) => !p.includes("node_modules") });
  cpSync(join(root, "package.json"), join(mdir, "package.json"));
  for (const d of ["lib", "constants", "types"]) { try { cpSync(join(root, d), join(mdir, d), { recursive: true }); } catch { /* not every folder exists */ } }
  writeFileSync(join(mdir, file), src.replace(from, to));
  try { bundle(mdir, "worker/src/index.ts", join(mdir, "worker.mjs")); } catch { fail++; console.error(`FAIL mutation did not build: ${name}`); continue; }
  const res = await runtime(join(mdir, "worker.mjs"));
  if (!res.some(([p]) => !p)) { fail++; console.error(`FAIL mutation not caught: ${name}`); }
}
if (fail) { console.error(`account-identity: ${fail} of ${n} failed`); process.exit(1); }
console.log(`account-identity: ${checks} checks passed (${NOMUT ? "mutations skipped" : `${MUT.length} mutations caught`}) - one account per person, proven email changes, Google by its id, recovery never silent`);
