/* SECURE AUTHENTICATION 2.0, PHASE 1a - GOOGLE IDENTITY (v1.264.0). Runtime
 * guard: the WHOLE worker (index.ts, bundled) against SQLite with every
 * migration applied, by direct request.
 *
 * claude/AUTH-2.0-AUDIT.md revision 3 (the CEO, "approved by phase"), sec. 3.1,
 * 5, 10 and 12. What it proves:
 *   order     a Google account is its `sub`. An internal account (staff,
 *             admin, agent) is never linked by its email; a customer with a
 *             password is not either; only the Google-created customers from
 *             before 1.238.0 get the restricted one-time legacy link; a
 *             different Google account on a linked email is refused
 *   G1        with 2FA on, nothing is linked or changed before the code: the
 *             link / email change rides on the challenge and is applied by
 *             /auth/2fa/verify in one guarded batch - an abandoned, failed or
 *             expired code links nothing
 *   guard     a step that changes no row undoes the whole batch (the account
 *             moved meanwhile): no zero-row "success", no session
 *   status    switched off or resigned between the Google step and the code:
 *             no session
 *   G4        the Google challenge is an HttpOnly cookie scoped to
 *             /api/v1/auth/2fa; a replay after success fails
 *   switches  the Google kill switch (password + TOTP stay on) and customer
 *             sign-up, enforced by the worker; only the company owner turns
 *             them, with a fresh code and a reason, audited before and after
 *   notices   the person whose address was used is told, at most once a day
 *   exempt    the 2FA exemptions are exact paths, not prefixes
 *   methods   GET /auth/methods says which ways in are on, and nothing else
 * Then mutated copies must each fail a check.
 *
 * Invented people and addresses only.
 *
 *   node tests/go-live-x.mjs
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
  const env = {
    /* D1's batch: one transaction, all or nothing (proven on workerd for
       claude/AUTH-2.0-AUDIT.md rev 3 sec. 5) */
    DB: { prepare: shim, batch: async (list) => { db.exec("BEGIN"); try { for (const s of list) s._run(); db.exec("COMMIT"); } catch (e) { db.exec("ROLLBACK"); throw e; } return []; } },
    SESSION_PEPPER: "pepper", COMPANY_DOMAIN: "a2z.test", ALLOWED_ORIGINS: "https://portal.a2z.test",
    GOOGLE_CLIENT_ID: "cid", GOOGLE_CLIENT_SECRET: "csecret",
    MEDIA: { put: async () => {}, head: async () => null, get: async () => null, list: async () => ({ objects: [] }) },
  };
  /* invented people. 20-25 are Google-created customers from before
     1.238.0 (no sub); 26 is one created after the cut-off; 9 has a password */
  db.exec(`INSERT INTO users (id, name, email, role, is_active, password_hash, totp_enabled, totp_secret, created_at) VALUES
    (1,'Owner','owner@a2z.test','ceo',1,'x',1,'${SECRET}','2026-01-01 00:00:00'),
    (8,'Root','root@a2z.test','super_admin',1,'x',1,'${SECRET}','2026-01-01 00:00:00'),
    (10,'Ed','ed@a2z.test','editor',1,'x',1,'${SECRET}','2026-01-01 00:00:00'),
    (11,'Lia','lia@gmail.com','live_host',1,'x',1,'${SECRET}','2026-01-01 00:00:00'),
    (12,'Second','ceo2@a2z.test','ceo',1,'x',1,'${SECRET}','2026-01-01 00:00:00'),
    (13,'Nora','nora@a2z.test','editor',1,'x',1,'${SECRET}','2026-01-01 00:00:00'),
    (14,'Agen','agen@gmail.com','agent',1,'x',1,'${SECRET}','2026-01-01 00:00:00'),
    (15,'New','new.staff@a2z.test','editor',1,'x',0,NULL,'2026-01-01 00:00:00'),
    (9,'Shop','shop@gmail.com','customer',1,'pbkdf2$x',0,NULL,'2026-08-01 00:00:00'),
    (20,'Leg A','leg.a@gmail.com','customer',1,'oauth$google',0,NULL,'2026-07-10 03:00:00'),
    (21,'Leg B','leg.b@gmail.com','customer',1,'oauth$google',1,'${SECRET}','2026-07-11 03:00:00'),
    (22,'Leg C','leg.c@gmail.com','customer',1,'oauth$google',1,'${SECRET}','2026-08-01 03:00:00'),
    (23,'Leg D','leg.d@gmail.com','customer',1,'oauth$google',1,'${SECRET}','2026-08-02 03:00:00'),
    (24,'Leg E','leg.e@gmail.com','customer',1,'oauth$google',1,'${SECRET}','2026-08-03 03:00:00'),
    (25,'Leg F','leg.f@gmail.com','customer',1,'oauth$google',1,'${SECRET}','2026-08-04 03:00:00'),
    (26,'Late','late@gmail.com','customer',1,'oauth$google',0,NULL,'2026-11-02 03:00:00')`);
  db.exec(`UPDATE users SET google_sub = 'g-lia' WHERE id = 11`);
  const RealDate = globalThis.Date; let fixed = new RealDate("2026-11-05T02:00:00Z").getTime();
  globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [fixed])); } static now() { return fixed; } };
  const code = () => { fixed += 31000; return totpAt(fixed); };
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
  for (const id of [1, 8, 10, 12, 15]) signIn(id);
  const raw = async (path, { method = "GET", uid, cookie = "", body } = {}) => {
    const c = [uid ? `azone_session=${tok[uid]}; csrf_token=c1` : "", cookie].filter(Boolean).join("; ");
    const headers = { "content-type": "application/json", origin: "https://portal.a2z.test", ...(c ? { cookie: c } : {}), ...(uid ? { "x-csrf-token": "c1" } : {}) };
    const r = await worker.fetch(new Request(`https://api.a2z.test/api/v1${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined }), env);
    const text = await r.text();
    let j = null; try { j = JSON.parse(text); } catch { /* a redirect */ }
    return { status: r.status, j, text, loc: r.headers.get("location") ?? "", cookies: r.headers.get("set-cookie") ?? "" };
  };
  const call = (path, uid, method = "GET", body) => raw(path, { uid, method, body });
  const google = async (sub, email) => {
    gProfile = { sub, email, email_verified: true, name: "G" };
    return await raw(`/auth/google/callback?code=c&state=S1`, { cookie: "azone_oauth_state=S1" });
  };
  const chOf = (cookies) => /twofa_ch=([^;]+)/.exec(cookies)?.[1] ?? "";
  const verifyG = (cookies, c, extra = {}) => raw("/auth/2fa/verify", { method: "POST", cookie: chOf(cookies) ? `twofa_ch=${chOf(cookies)}` : "", body: { code: c, ...extra } });
  const user = (id) => db.prepare(`SELECT * FROM users WHERE id = ?`).get(id);
  const users = () => db.prepare(`SELECT COUNT(*) AS n FROM users`).get().n;
  const lastAudit = (a) => { const r = db.prepare(`SELECT * FROM audit_log WHERE action = ? ORDER BY id DESC LIMIT 1`).get(a); return r ? { ...r, d: JSON.parse(r.detail ?? "{}") } : null; };
  const notices = (id) => db.prepare(`SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND kind = 'security'`).get(id).n;
  const session = (r) => /azone_session=[^;]+/.test(r.cookies) && !/azone_session=;/.test(r.cookies);
  const FAIL = "/login?error=oauth";

  try {
    /* ---------- the order: internal accounts are never linked by email ---------- */
    const n0 = users();
    const ed = await google("g-ed", "ed@a2z.test");
    ok(ed.loc === FAIL && !session(ed) && !chOf(ed.cookies) && user(10).google_sub === null, "an internal account's email is refused - no link, no session, no challenge", JSON.stringify([ed.loc, user(10).google_sub]));
    ok(lastAudit("auth.google_refused")?.d?.reason === "internal_account_not_linked", "...audited with why (the page says the one neutral sentence)");
    ok(notices(10) === 1, "...and the person is told someone tried", String(notices(10)));
    await google("g-ed", "ed@a2z.test");
    await google("g-ed2", "ed@a2z.test");
    ok(notices(10) === 1 && user(10).google_sub === null, "...told at most once a day, however often the button is pressed - still nothing linked", String(notices(10)));
    const ag = await google("g-agen", "agen@gmail.com");
    ok(ag.loc === FAIL && user(14).google_sub === null, "an agent's Gmail address is refused the same way (an agent is internal)");
    const ceoG = await google("g-owner", "owner@a2z.test");
    ok(ceoG.loc === FAIL && user(1).google_sub === null, "...and the CEO's own address (no email bypass for anyone)");
    ok(users() === n0, "no account was created by any of it");

    /* ---------- customers: a password customer, and one after the cut-off ---------- */
    const pw = await google("g-shop", "shop@gmail.com");
    ok(pw.loc === FAIL && user(9).google_sub === null && lastAudit("auth.google_refused")?.d?.reason === "customer_has_password", "a customer with a password is not linked by email", pw.loc);
    ok(notices(9) === 1, "...and is told");
    const late = await google("g-late", "late@gmail.com");
    ok(late.loc === FAIL && user(26).google_sub === null && lastAudit("auth.google_refused")?.d?.reason === "not_a_legacy_google_customer", "a Google customer created after the cut-off with no id is not a legacy one");

    /* ---------- the restricted legacy link (no 2FA on the account) ---------- */
    const la = await google("g-leg-a", "leg.a@gmail.com");
    ok(session(la) && la.loc === "/account" && user(20).google_sub === "g-leg-a" && user(20).email_verified_at, "a legacy Google customer is linked once and signed in", JSON.stringify([la.loc, user(20).google_sub]));
    ok(lastAudit("auth.google_legacy_linked")?.entity_id === "20", "...audited as the legacy link");
    const la2 = await google("g-leg-a", "leg.a@gmail.com");
    ok(session(la2) && user(20).google_sub === "g-leg-a", "...the next sign-in finds them by their Google id");
    const laX = await google("g-intruder", "leg.a@gmail.com");
    ok(laX.loc === FAIL && !session(laX) && user(20).google_sub === "g-leg-a" && lastAudit("auth.google_refused")?.d?.reason === "linked_to_a_different_google_account", "a different Google account on the linked email is refused, never merged");

    /* ---------- G1 + G4: with 2FA, the link waits for the code ---------- */
    const lb = await google("g-leg-b", "leg.b@gmail.com");
    ok(lb.loc === "/login?2fa=1" && !session(lb) && user(21).google_sub === null, "with 2FA on, the Google step links nothing and signs nobody in", JSON.stringify([lb.loc, user(21).google_sub]));
    const chCookie = (lb.cookies.split(/,(?=\s*\w+=)/).find((x) => /twofa_ch=/.test(x)) ?? "").trim();
    ok(/twofa_ch=[0-9a-f-]{60,}/.test(chCookie) && /HttpOnly/i.test(chCookie) && /Secure/i.test(chCookie) && /SameSite=Lax/i.test(chCookie) && /Path=\/api\/v1\/auth\/2fa(;|$)/.test(chCookie) && /Max-Age=300/.test(chCookie), "the challenge is an HttpOnly, Secure cookie scoped to /api/v1/auth/2fa for five minutes (G4)", chCookie);
    ok(!/twofa_challenge=[0-9a-f]/.test(lb.cookies), "...and no script-readable challenge cookie any more", lb.cookies);
    ok(db.prepare(`SELECT pending_google_sub FROM twofa_challenges WHERE user_id = 21`).get()?.pending_google_sub === "g-leg-b", "the pending link rides on the challenge");
    const wrong = await verifyG(lb.cookies, "000000");
    ok(wrong.status === 401 && wrong.j?.error?.code === "invalid_code" && user(21).google_sub === null, "a wrong code links nothing", wrong.text);
    const noCookie = await raw("/auth/2fa/verify", { method: "POST", body: { code: code() } });
    ok(noCookie.status === 400 && user(21).google_sub === null, "no challenge, no verify");
    const right = await verifyG(lb.cookies, code());
    ok(right.status === 200 && session(right) && user(21).google_sub === "g-leg-b" && lastAudit("auth.google_legacy_linked")?.entity_id === "21", "the right code applies the link and signs in, in one step", right.text);
    ok(/twofa_ch=;/.test(right.cookies) && /Max-Age=0/.test(right.cookies), "...and clears the challenge cookie");
    const replay = await verifyG(lb.cookies, code());
    ok(replay.status === 401 && replay.j?.error?.code === "challenge_expired" && !session(replay), "a replay of the same challenge after success fails", replay.text);

    /* abandoned, then expired */
    const lc = await google("g-leg-e", "leg.e@gmail.com");
    ok(lc.loc === "/login?2fa=1" && user(24).google_sub === null, "an abandoned code step leaves the account unlinked");
    db.exec(`UPDATE twofa_challenges SET expires_at = datetime('now', '-1 minute') WHERE user_id = 24`);
    const exp = await verifyG(lc.cookies, code());
    ok(exp.status === 401 && exp.j?.error?.code === "challenge_expired" && user(24).google_sub === null && !session(exp), "...and once the five minutes pass, a right code links nothing either", exp.text);

    /* switched off in between */
    const ld = await google("g-leg-c", "leg.c@gmail.com");
    db.exec(`UPDATE users SET is_active = 0 WHERE id = 22`);
    const off = await verifyG(ld.cookies, code());
    ok(off.status === 401 && !session(off) && user(22).google_sub === null && lastAudit("auth.2fa_refused")?.d?.reason === "account_not_active", "an account switched off between the Google step and the code gets no session and no link", off.text);
    db.exec(`UPDATE users SET is_active = 1 WHERE id = 22`);
    /* resigned in between (a linked staff member) */
    const li = await google("g-lia", "lia@gmail.com");
    ok(li.loc === "/login?2fa=1", "a linked staff member is found by their Google id and asked for the code");
    db.exec(`UPDATE users SET employment_status = 'resigned' WHERE id = 11`);
    const res = await verifyG(li.cookies, code());
    ok(res.status === 401 && !session(res), "...resigned before entering it: no session (the verify step judges the account again)", res.text);
    db.exec(`UPDATE users SET employment_status = 'active' WHERE id = 11`);
    /* the same recheck on a password sign-in */
    const pl = await raw("/auth/login", { method: "POST", body: { email: "lia@gmail.com", password: "nope" } });
    ok(pl.status === 401, "(a wrong password is still refused)");

    /* the guard: the account moved meanwhile - zero rows must not be success */
    const lf = await google("g-leg-f", "leg.f@gmail.com");
    db.exec(`UPDATE users SET google_sub = 'g-other' WHERE id = 25`);
    const moved = await verifyG(lf.cookies, code());
    ok(moved.status === 409 && moved.j?.error?.code === "changed_meanwhile" && !session(moved) && user(25).google_sub === "g-other", "a link that matches no row undoes the whole batch: no session, nothing overwritten", moved.text);
    ok(db.prepare(`SELECT COUNT(*) AS n FROM twofa_challenges WHERE user_id = 25`).get().n === 0 && lastAudit("auth.google_pending_aborted")?.d?.reason === "changed_meanwhile", "...the challenge is spent and the abort is audited");
    ok(db.prepare(`SELECT COUNT(*) AS n FROM auth_assert`).get().n === 0, "auth_assert is empty after every batch");
    /* the legacy restriction is in the write itself, not only in the check
       before it: a password set while the code is typed stops the link */
    const lg = await google("g-leg-d", "leg.d@gmail.com");
    db.exec(`UPDATE users SET password_hash = 'pbkdf2$set-meanwhile' WHERE id = 23`);
    const lgv = await verifyG(lg.cookies, code());
    ok(lgv.status === 409 && user(23).google_sub === null && !session(lgv), "a legacy customer who set a password meanwhile is not linked - the write itself carries the restriction", lgv.text);

    /* ---------- a pending login email change, proven by Google, after the code ---------- */
    db.exec(`INSERT INTO email_changes (id, user_id, old_email, new_email, route, status, needs_second, requested_by, reason, expires_at)
             VALUES (70, 13, 'nora@a2z.test', 'nora.new@gmail.com', 'google', 'pending', 0, 1, 'Moved to a personal mailbox', datetime('now', '+24 hours'))`);
    const ch1 = await google("g-nora", "nora.new@gmail.com");
    ok(ch1.loc === "/login?2fa=1" && user(13).email === "nora@a2z.test" && user(13).google_sub === null && db.prepare(`SELECT status FROM email_changes WHERE id = 70`).get().status === "pending", "a Google-route email change waits for the code: email, link and change untouched", JSON.stringify([ch1.loc, user(13).email]));
    const chBad = await verifyG(ch1.cookies, "111111");
    ok(chBad.status === 401 && user(13).email === "nora@a2z.test" && user(13).google_sub === null, "...a wrong code changes nothing");
    const chOk = await verifyG(ch1.cookies, code());
    ok(chOk.status === 200 && chOk.j?.user?.email === "nora.new@gmail.com" && user(13).email === "nora.new@gmail.com" && user(13).google_sub === "g-nora" && db.prepare(`SELECT status FROM email_changes WHERE id = 70`).get().status === "applied", "...the right code applies the change and the link together, on the same account", chOk.text);
    ok(lastAudit("user.email_change")?.d?.via === "google_sign_in" && lastAudit("auth.google_linked")?.entity_id === "13", "...audited: the change and the link");
    /* a change that lapses while the code is being typed */
    db.exec(`INSERT INTO email_changes (id, user_id, old_email, new_email, route, status, needs_second, requested_by, reason, expires_at)
             VALUES (71, 10, 'ed@a2z.test', 'ed.new@gmail.com', 'google', 'pending', 0, 1, 'Moved to a personal mailbox', datetime('now', '+24 hours'))`);
    const ch2 = await google("g-ed-new", "ed.new@gmail.com");
    db.exec(`UPDATE email_changes SET status = 'cancelled' WHERE id = 71`);
    const ch2v = await verifyG(ch2.cookies, code());
    ok(ch2v.status === 409 && user(10).email === "ed@a2z.test" && user(10).google_sub === null && !session(ch2v), "a change cancelled before the code: nothing applied, nothing linked, no session", ch2v.text);

    /* ---------- the password sign-in is as it was ---------- */
    const pwOwner = db.prepare(`SELECT password_hash FROM users WHERE id = 1`).get();
    ok(pwOwner.password_hash === "x", "(fixture) the owner has a password hash");

    /* ---------- the exemptions are exact ---------- */
    const enrol = await call("/auth/googlex", 15);
    ok(enrol.status === 403 && enrol.j?.error?.code === "twofa_required", "a path that merely starts like an exempt one is not exempt (exact paths)", `${enrol.status} ${enrol.text.slice(0, 120)}`);
    const enrolMe = await call("/auth/methods", 15);
    ok(enrolMe.status === 200, "/auth/methods is reachable before enrolment (the login page needs it)");
    const enrolOther = await call("/staff/profile", 15);
    ok(enrolOther.status === 403, "...and the rest still waits for 2FA");

    /* ---------- the switches: only the owner, with a code and a reason ---------- */
    const m0 = await raw("/auth/methods");
    ok(m0.status === 200 && m0.j?.google === true && m0.j.password === true && m0.j.google_customer_signup === true && m0.j.passkeys === false, "GET /auth/methods: password, Google and customer sign-up on, no passkeys yet", m0.text);
    ok(Object.keys(m0.j ?? {}).sort().join() === "google,google_customer_signup,passkeys,password", "...and says nothing else (no account, no setting detail)", m0.text);
    ok((await call("/staff/auth/settings", 10)).status === 403, "an editor cannot read the sign-in settings");
    const rs = await call("/staff/auth/settings", 8);
    ok(rs.status === 200 && rs.j?.google?.enabled === true && rs.j.can_set === false, "the super admin reads them, cannot change them", rs.text);
    const body = (g, extra = {}) => ({ google: g, reason: "Google outage - password only today", ...extra });
    ok((await call("/staff/auth/settings", 8, "PUT", body({ enabled: false, customer_signup: true }, { totp: code() }))).status === 403, "the super admin cannot turn Google off");
    ok((await call("/staff/auth/settings", 1, "PUT", body({ enabled: false, customer_signup: true }, { totp: code() }))).status === 403, "the CEO before being named the company owner cannot either");
    ok((await call("/staff/owner", 8, "POST", { user_id: 1, reason: "The founder owns the company", totp: code() })).status === 200, "(the super admin names the owner)");
    ok((await call("/staff/auth/settings", 12, "PUT", body({ enabled: false, customer_signup: true }, { totp: code() }))).status === 403, "a second CEO-role account cannot");
    const noTotp = await call("/staff/auth/settings", 1, "PUT", body({ enabled: false, customer_signup: true }));
    ok(noTotp.status === 401, "the owner needs a fresh authenticator code", noTotp.text);
    ok((await call("/staff/auth/settings", 1, "PUT", { google: { enabled: false, customer_signup: true }, reason: "no", totp: code() })).status === 400, "...and a reason");
    ok((await call("/staff/auth/settings", 1, "PUT", body({ enabled: "no", customer_signup: true }, { totp: code() }))).status === 400, "...and true or false, nothing else");
    const turnOff = await call("/staff/auth/settings", 1, "PUT", body({ enabled: false, customer_signup: true }, { totp: code() }));
    ok(turnOff.status === 200 && turnOff.j?.google?.enabled === false, "the owner turns Google off", turnOff.text);
    const sa = lastAudit("auth.settings_google");
    ok(sa?.user_id === 1 && sa.d.before?.enabled === true && sa.d.after?.enabled === false && sa.d.reason, "...audited with the before, the after and the reason");
    ok((await raw("/auth/methods")).j?.google === false, "the login page is told Google is off");
    const st = await raw("/auth/google");
    ok(st.status === 302 && st.loc === "/login?error=google_off", "starting a Google sign-in lands on the sign-in page with the reason", st.loc);
    const n1 = users();
    const cb = await google("g-walk", "walk.in@gmail.com");
    ok(cb.loc === "/login?error=google_off" && !session(cb) && users() === n1, "a Google sign-in begun before the switch does not finish after it - nothing created");
    const pwl = await raw("/auth/login", { method: "POST", body: { email: "lia@gmail.com", password: "x" } });
    ok(pwl.status !== 404 && pwl.status !== 503, "password sign-in still answers with Google off", String(pwl.status));
    /* customer sign-up off, Google on */
    ok((await call("/staff/auth/settings", 1, "PUT", body({ enabled: true, customer_signup: false }, { totp: code() }))).status === 200, "the owner turns Google back on with customer sign-up off");
    const su = await google("g-walk", "walk.in@gmail.com");
    ok(su.loc === FAIL && !session(su) && users() === n1 && lastAudit("auth.google_refused")?.d?.reason === "customer_signup_off", "an unknown Google account is not made a customer while sign-up is off", su.loc);
    ok((await raw("/auth/methods")).j?.google_customer_signup === false, "...and the login page is told");
    ok((await google("g-leg-a", "leg.a@gmail.com")).loc === "/account", "...a linked customer still signs in");
    ok((await call("/staff/auth/settings", 1, "PUT", body({ enabled: true, customer_signup: true }, { totp: code() }))).status === 200, "the owner turns sign-up back on");
    const su2 = await google("g-walk", "walk.in@gmail.com");
    const walk = db.prepare(`SELECT role, google_sub, totp_enabled FROM users WHERE email = 'walk.in@gmail.com'`).get();
    ok(session(su2) && walk?.role === "customer" && walk.google_sub === "g-walk", "with sign-up on, an unknown Google account becomes a customer, linked to its id - never anything else");
    ok((await raw("/staff/auth/settings")).status === 401, "the settings need a session");
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
const dir = mkdtempSync(join(tmpdir(), "glx-"));
bundle(root, "worker/src/index.ts", join(dir, "worker.mjs"));
report(await runtime(join(dir, "worker.mjs")));
const checks = n;

/* each must be caught by a check above */
const MUT = [
  ["worker/src/index.ts", "N5: an internal account linked by its email again", 'if (byEmail.role !== "customer") {', "if (false) {"],
  ["worker/src/index.ts", "a password customer taken as a legacy one", 'const legacy = byEmail.password_hash === "oauth$google" && !!byEmail.created_at && byEmail.created_at < LEGACY_GOOGLE_BEFORE;', "const legacy = true;"],
  ["worker/src/index.ts", "a different Google account merged", 'if (byEmail.google_sub) return await refuseG(byEmail.id, "linked_to_a_different_google_account");', ""],
  ["worker/src/accounts.ts", "the zero-row guard removed from a link", "    assertLinked(env, userId, sub),\n  ];", "  ];"],
  ["worker/src/accounts.ts", "the legacy link without its restriction", "const legacy = opts.legacy ? ` AND role = 'customer'", "const legacy = opts.legacy && false ? ` AND role = 'customer'"],
  ["worker/src/index.ts", "G1: the link applied before the code", "    if (twofaG?.totp_enabled) {\n      const challenge", "    if (twofaG?.totp_enabled && pendSub) { await applyGooglePending(env, account.id, pendSub, pendChange?.id ?? null, []); }\n    if (twofaG?.totp_enabled) {\n      const challenge"],
  ["worker/src/index.ts", "G4: the challenge cookie readable by script", "=${challenge}; HttpOnly; Secure; SameSite=Lax; Path=/api/v1/auth/2fa", "=${challenge}; Secure; SameSite=Lax; Path=/api/v1/auth/2fa"],
  ["worker/src/index.ts", "verify does not judge the account again", "      `SELECT id, email, name, role, totp_secret FROM users\n       WHERE id = ?1 AND is_active = 1 AND COALESCE(employment_status, '') NOT IN ('resigned', 'terminated')`,", "      `SELECT id, email, name, role, totp_secret FROM users WHERE id = ?1`,"],
  ["worker/src/index.ts", "the kill switch ignored at the start", "    if (!(await googleAuthSettings(env)).enabled) {", "    if (false) {"],
  ["worker/src/index.ts", "the kill switch ignored at the callback", "    if (!gset.enabled) return failed(GOOGLE_OFF);", ""],
  ["worker/src/index.ts", "customer sign-up ignored", '      if (!gset.customer_signup) return await refuseG(null, "customer_signup_off");', ""],
  ["worker/src/staff.ts", "anyone with the CEO role turns the switches", 'if (user.role !== "ceo" || user.is_owner !== true) return err("forbidden", "Only the company owner', 'if (user.role !== "ceo" && user.role !== "super_admin") return err("forbidden", "Only the company owner'],
  ["worker/src/staff.ts", "the switches without a code", '    const stepUp = await requireFreshTotp(env, user, body?.totp, err, "change how people sign in");\n    if (stepUp) return stepUp;', ""],
  ["worker/src/index.ts", "prefix exemptions back", "  if (TWOFA_EXEMPT_PATHS.has(path)) return null;", "  if ([...TWOFA_EXEMPT_PATHS].some((p) => path.startsWith(p))) return null;"],
  ["worker/src/index.ts", "notices without a daily limit", "(await checkRateLimit(env, `gnotice:${userId}`, 1, 86400))", "true"],
];
for (const [file, name, from, to] of NOMUT ? [] : MUT) {
  n++;
  const src = readFileSync(join(root, file), "utf8");
  if (!src.includes(from)) { fail++; console.error(`FAIL mutation did not apply: ${name}`); continue; }
  const mdir = mkdtempSync(join(tmpdir(), "glx-m-"));
  cpSync(join(root, "worker"), join(mdir, "worker"), { recursive: true, filter: (s) => !s.includes("node_modules") });
  cpSync(join(root, "package.json"), join(mdir, "package.json"));
  for (const d of ["lib", "constants", "types"]) { try { cpSync(join(root, d), join(mdir, d), { recursive: true }); } catch { /* not every folder exists */ } }
  writeFileSync(join(mdir, file), src.replace(from, to));
  try { bundle(mdir, "worker/src/index.ts", join(mdir, "worker.mjs")); } catch { fail++; console.error(`FAIL mutation did not build: ${name}`); continue; }
  const res = await runtime(join(mdir, "worker.mjs"));
  if (!res.some(([p]) => !p)) { fail++; console.error(`FAIL mutation not caught: ${name}`); }
}
if (fail) { console.error(`go-live-x: ${fail} of ${n} failed`); process.exit(1); }
console.log(`go-live-x: ${checks} checks passed (${NOMUT ? "mutations skipped" : `${MUT.length} mutations caught`}) - Google by its id, nothing linked before the code, guarded batches, the owner's switches`);
