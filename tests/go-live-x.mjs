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
import { fakeGoogle } from "./lib/fake-google.mjs"; // v1.265.0 - Phase 1b: Google is OpenID Connect

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
    (26,'Late','late@gmail.com','customer',1,'oauth$google',0,NULL,'2026-11-02 03:00:00'),
    (27,'Leg G','leg.g@gmail.com','customer',1,'oauth$google',0,NULL,'2026-08-05 03:00:00'),
    (28,'Leg H','leg.h@gmail.com','customer',1,'oauth$google',0,NULL,'2026-08-06 03:00:00')`);
  /* v1.266.0 - the legacy window is the owner's; open here for the 1a checks, closed and reopened below */
  db.exec(`INSERT INTO business_settings (key, value) VALUES ('auth_google', '{"enabled":true,"customer_signup":true,"legacy_link_until":"2026-12-31"}')`);
  db.exec(`INSERT INTO customers (id, company, email, created_by) VALUES (501, 'Kedai Shop', 'shop@gmail.com', 1), (502, 'Leg C Trading', 'leg.c@gmail.com', 1)`);
  db.exec(`INSERT INTO sales_documents (id, doc_type, doc_number, customer_id, items, discount_cents, tax_percent, total_cents, payment_status, created_at, created_by) VALUES (901,'INV','INV-901',501,'[]',0,0,10000,'unpaid','2026-10-20 02:00:00',1), (902,'INV','INV-902',502,'[]',0,0,20000,'unpaid','2026-10-21 02:00:00',1)`);
  const mails = [];
  db.exec(`UPDATE users SET google_sub = 'g-lia' WHERE id = 11`);
  const RealDate = globalThis.Date; let fixed = new RealDate("2026-11-05T02:00:00Z").getTime();
  globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [fixed])); } static now() { return fixed; } };
  const code = () => { fixed += 31000; return totpAt(fixed); };
  /* Google as the worker sees it (v1.265.0): the discovery document, the
     published keys, a token endpoint that checks PKCE, signed ID tokens */
  const G = fakeGoogle({ clientId: "cid" });
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (u, init) => (await G.fetch(u, init)) ?? new Response("{}", { status: 200 });
  const mod = await import(pathToFileURL(workerBundle).href + `?v=${Math.random()}`);
  const worker = mod.default;
  /* v1.266.0 - real passwords for the customers who have one */
  db.prepare(`UPDATE users SET password_hash = ? WHERE id = 9`).run(await mod.createPasswordHash("Shop-pass-2026", "pepper"));
  db.prepare(`UPDATE users SET password_hash = ? WHERE id = 10`).run(await mod.createPasswordHash("Ed-pass-2026", "pepper"));
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
  const bindOf = (cookies) => /azone_g_bind=([0-9a-f]{64})/.exec(cookies)?.[1] ?? "";
  /* the round trip in two halves: the start (PKCE, nonce, state, the
     binding cookie) and Google's answer to the callback */
  const gStart = async () => { const r = await raw("/auth/google"); return { ...r, bind: bindOf(r.cookies) }; };
  const gFinish = async (st, sub, email, { uid, cookie, email_verified = true } = {}) => {
    const { code, state } = G.authorize(st.loc.startsWith("http") ? st.loc : "https://x.invalid/", { sub, email, email_verified });
    const c = [cookie ?? (st.bind ? `azone_g_bind=${st.bind}` : "")].filter(Boolean).join("; ");
    const r = await raw(`/auth/google/callback?code=${code}&state=${state}`, { uid, cookie: c });
    return { ...r, code, state };
  };
  const google = async (sub, email) => gFinish(await gStart(), sub, email);
  const chOf = (cookies) => /twofa_ch=([^;]+)/.exec(cookies)?.[1] ?? "";
  const verifyG = (cookies, c, extra = {}) => raw("/auth/2fa/verify", { method: "POST", cookie: chOf(cookies) ? `twofa_ch=${chOf(cookies)}` : "", body: { code: c, ...extra } });
  const user = (id) => db.prepare(`SELECT * FROM users WHERE id = ?`).get(id);
  const users = () => db.prepare(`SELECT COUNT(*) AS n FROM users`).get().n;
  const lastAudit = (a) => { const r = db.prepare(`SELECT * FROM audit_log WHERE action = ? ORDER BY id DESC LIMIT 1`).get(a); return r ? { ...r, d: JSON.parse(r.detail ?? "{}") } : null; };
  const notices = (id) => db.prepare(`SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND kind = 'security'`).get(id).n;
  const session = (r) => /azone_session=[^;]+/.test(r.cookies) && !/azone_session=;/.test(r.cookies);
  const FAIL = "/login?error=oauth";

  try {
    /* ---------- 1b, N11: no PKCE S256, no Google sign-in (never silently without) ---------- */
    G.s256 = false;
    const noPkce = await raw("/auth/google");
    ok(noPkce.status === 302 && noPkce.loc === FAIL && !bindOf(noPkce.cookies) && db.prepare(`SELECT COUNT(*) AS n FROM oauth_requests`).get().n === 0, "N11: Google's discovery without S256 - the sign-in does not start, nothing stored", noPkce.loc);
    ok(lastAudit("auth.google_unavailable")?.d?.reason === "pkce_s256_not_advertised", "...and the reason is recorded for the owner");
    G.s256 = true; G.discoveryDown = true;
    ok((await raw("/auth/google")).loc === FAIL && lastAudit("auth.google_unavailable")?.d?.reason === "discovery_unreachable", "Google's discovery unreachable: the same, fail closed");
    G.discoveryDown = false;

    /* ---------- 1b: the request ---------- */
    const s1 = await gStart();
    const au = s1.loc.startsWith("http") ? new URL(s1.loc) : null;
    ok(au && au.origin + au.pathname === "https://accounts.google.com/o/oauth2/v2/auth" && au.searchParams.get("code_challenge_method") === "S256" && /^[A-Za-z0-9_-]{43}$/.test(au.searchParams.get("code_challenge") ?? "") && /^[0-9a-f]{64}$/.test(au.searchParams.get("nonce") ?? "") && /^[0-9a-f]{64}$/.test(au.searchParams.get("state") ?? "") && au.searchParams.get("client_id") === "cid", "the request carries PKCE S256, a nonce and a state, to Google's own endpoint", s1.loc);
    ok(!/code_verifier/.test(s1.loc), "...the PKCE verifier never leaves the server");
    const bc = (s1.cookies.split(/,(?=\s*\w+=)/).find((x) => /azone_g_bind=/.test(x)) ?? "").trim();
    ok(/HttpOnly/i.test(bc) && /Secure/i.test(bc) && /SameSite=Lax/i.test(bc) && /Path=\/api\/v1\/auth\/google(;|$)/.test(bc) && /Max-Age=600/.test(bc), "the binding cookie: HttpOnly, Secure, scoped to /api/v1/auth/google, ten minutes", bc);
    const orow = db.prepare(`SELECT * FROM oauth_requests ORDER BY created_at DESC, rowid DESC LIMIT 1`).get();
    ok(orow && orow.id === sha(au?.searchParams.get("state") ?? "") && orow.binding_hash === sha(s1.bind) && orow.purpose === "signin" && orow.used_at === null && !JSON.stringify(orow).includes(s1.bind), "the server keeps the request: state and binding as SHA-256 only", JSON.stringify(orow));

    /* ---------- 1b: the answer ---------- */
    const g0 = await gFinish(s1, "g-leg-a", "leg.a@gmail.com");
    ok(session(g0) && g0.loc === "/account", "a correct round trip signs in (the ID token verified, the PKCE verifier accepted)", g0.loc);
    ok(G.tokenCalls.at(-1)?.code_verifier && createHash("sha256").update(G.tokenCalls.at(-1).code_verifier).digest("base64url") === au?.searchParams.get("code_challenge"), "...the token request carried the verifier for that challenge");
    const replayCb = await raw(`/auth/google/callback?code=${g0.code}&state=${g0.state}`, { cookie: `azone_g_bind=${s1.bind}` });
    ok(replayCb.loc === FAIL && !session(replayCb) && lastAudit("auth.google_callback_rejected")?.d?.reason === "state_unknown_used_or_expired", "N12: a replayed callback (same state) is refused - single use", replayCb.loc);
    db.exec(`UPDATE users SET google_sub = NULL WHERE id = 20`); // back to unlinked for the 1a checks below
    const s2 = await gStart();
    const wrongBind = await gFinish(s2, "g-x1", "x1@gmail.com", { cookie: `azone_g_bind=${"0".repeat(64)}` });
    ok(wrongBind.loc === FAIL && !session(wrongBind) && lastAudit("auth.google_callback_rejected")?.d?.reason === "binding_mismatch", "N12: a callback in another browser (wrong binding cookie) is refused - login CSRF", wrongBind.loc);
    const s3 = await gStart();
    const noBind = await gFinish(s3, "g-x1", "x1@gmail.com", { cookie: "" });
    ok(noBind.loc === FAIL && !session(noBind), "...and with no binding cookie at all");
    const s4 = await gStart();
    db.exec(`UPDATE oauth_requests SET expires_at = datetime('now', '-1 minute') WHERE id = '${sha(new URL(s4.loc).searchParams.get("state"))}'`);
    ok((await gFinish(s4, "g-x1", "x1@gmail.com")).loc === FAIL, "N12: a stale callback (past ten minutes) is refused");
    G.refuseVerifier = true;
    const pk = await gFinish(await gStart(), "g-x1", "x1@gmail.com");
    ok(pk.loc === FAIL && !session(pk) && lastAudit("auth.google_token_refused")?.d?.status === 400, "N11: Google refusing the PKCE verifier stops the sign-in and is reported", pk.loc);
    G.refuseVerifier = false;
    /* every way an ID token can be wrong */
    const now = () => Math.floor(Date.now() / 1000);
    const bad = [
      ["token_iss", (c) => ({ ...c, iss: "https://evil.example" })],
      ["token_aud", (c) => ({ ...c, aud: "someone-else" })],
      ["token_azp", (c) => ({ ...c, aud: ["cid", "other"], azp: "other" })],
      ["token_expired", (c) => ({ ...c, exp: now() - 120 })],
      ["token_iat", (c) => ({ ...c, iat: now() + 600 })],
      ["token_nbf", (c) => ({ ...c, nbf: now() + 600 })],
      ["token_nonce", (c) => ({ ...c, nonce: "f".repeat(64) })],
      ["token_sub", (c) => ({ ...c, sub: "" })],
    ];
    for (const [reason, t] of bad) {
      G.tamper = t;
      const r = await gFinish(await gStart(), "g-bad", "bad@gmail.com");
      ok(r.loc === FAIL && !session(r) && lastAudit("auth.google_token_rejected")?.d?.reason === reason, `an ID token with a wrong ${reason.replace("token_", "")} is refused`, `${r.loc} ${JSON.stringify(lastAudit("auth.google_token_rejected")?.d)}`);
    }
    G.tamper = null;
    const forged = [
      ["token_signature", (c, g) => g.sign(c, { alg: "RS256", kid: "k1", typ: "JWT" }, "other"), "a key Google never published"],
      ["token_alg", (c, g) => g.none(c), "alg none"],
      ["token_alg", (c, g) => g.hs256(c), "HS256 with the public key"],
      ["token_kid", (c, g) => g.sign(c, { alg: "RS256", kid: "k-unknown", typ: "JWT" }), "an unknown key id"],
      ["token_signature", (c, g) => { const t = g.sign(c).split("."); const p = JSON.parse(Buffer.from(t[1], "base64url")); p.sub = "g-ceo-takeover"; t[1] = Buffer.from(JSON.stringify(p)).toString("base64url"); return t.join("."); }, "a payload changed after signing"],
      ["token_malformed", () => "not-a-jwt", "garbage"],
    ];
    for (const [reason, t, what] of forged) {
      G.token = t;
      const r = await gFinish(await gStart(), "g-bad", "bad@gmail.com");
      ok(r.loc === FAIL && !session(r) && lastAudit("auth.google_token_rejected")?.d?.reason === reason, `a forged ID token (${what}) is refused`, `${r.loc} ${JSON.stringify(lastAudit("auth.google_token_rejected")?.d)}`);
    }
    G.token = null;
    const unv = await gFinish(await gStart(), "g-unv", "unverified@gmail.com", { email_verified: false });
    ok(unv.loc === FAIL && !session(unv) && db.prepare(`SELECT COUNT(*) AS n FROM users WHERE email = 'unverified@gmail.com'`).get().n === 0, "an address Google has not verified signs nobody in and creates nothing");
    ok(db.prepare(`SELECT COUNT(*) AS n FROM users WHERE email = 'bad@gmail.com'`).get().n === 0, "no refused token created an account");

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

    /* ---------- 1b: Connect Google from Profile -> Security ---------- */
    const conn = (uid, body = {}) => raw("/auth/google/connect", { method: "POST", uid, body });
    const st0 = await call("/auth/2fa/status", 10);
    ok(st0.j?.google?.linked === false && st0.j.google.can_connect === true && !st0.text.includes("g-"), "Profile -> Security says Google is not connected and may be (never the Google id)", st0.text);
    ok((await conn(10)).status === 401, "Connect needs a fresh authenticator code");
    const noCsrf = await worker.fetch(new Request("https://api.a2z.test/api/v1/auth/google/connect", { method: "POST", headers: { "content-type": "application/json", origin: "https://portal.a2z.test", cookie: `azone_session=${tok[10]}; csrf_token=c1` }, body: JSON.stringify({ totp: code() }) }), env);
    ok(noCsrf.status === 403, "...and the CSRF token (a POST behind the usual gate)");
    ok((await raw("/auth/google/connect", { method: "POST", body: { totp: code() } })).status === 401, "...and a session");
    const notEnrolled = await conn(15, { totp: code() });
    ok(notEnrolled.status === 403 && notEnrolled.j?.error?.code === "twofa_required", "N15 / F7: Connect is not exempt from the mandatory-2FA gate", notEnrolled.text);
    signIn(9);
    ok((await conn(9, { totp: code() })).j?.error?.code === "code_required", "a customer cannot connect with an authenticator code - only with the password and the emailed code (1c)");
    const cs = await conn(10, { totp: code() });
    ok(cs.status === 200 && cs.j?.url?.startsWith("https://accounts.google.com/") && bindOf(cs.cookies), "with the code, Connect hands back Google's address and a binding cookie", cs.text);
    const crow = db.prepare(`SELECT * FROM oauth_requests WHERE id = ?`).get(sha(new URL(cs.j.url).searchParams.get("state")));
    ok(crow?.purpose === "connect" && crow.user_id === 10 && crow.session_hash === sha(tok[10]) && crow.return_to === "portal", "...the request is bound to this account and this session");
    ok(user(10).google_sub === null, "...nothing is linked yet");
    /* the answer in another person's session */
    const csEvil = await gFinish({ loc: cs.j.url, bind: bindOf(cs.cookies) }, "g-ed-real", "ed.personal@gmail.com", { uid: 12 });
    ok(csEvil.loc.includes("google=failed") && user(10).google_sub === null && user(12).google_sub === null, "N12: the answer in a different session links nobody", csEvil.loc);
    const cs2 = await conn(10, { totp: code() });
    const csNo = await gFinish({ loc: cs2.j.url, bind: bindOf(cs2.cookies) }, "g-ed-real", "ed.personal@gmail.com");
    ok(csNo.loc.includes("google=failed") && user(10).google_sub === null, "...or with no session at all");
    const cs3 = await conn(10, { totp: code() });
    const csTaken = await gFinish({ loc: cs3.j.url, bind: bindOf(cs3.cookies) }, "g-lia", "lia@gmail.com", { uid: 10 });
    ok(csTaken.loc.includes("google=refused") && user(10).google_sub === null && user(11).google_sub === "g-lia", "a Google account already connected to someone else is refused", csTaken.loc);
    const cs4 = await conn(10, { totp: code() });
    const csOk = await gFinish({ loc: cs4.j.url, bind: bindOf(cs4.cookies) }, "g-ed-real", "ed.personal@gmail.com", { uid: 10 });
    ok(csOk.loc === "/portal?tab=Profile&google=connected" && user(10).google_sub === "g-ed-real" && !session(csOk), "the right answer in the same session connects it - back to Profile, no new session minted", csOk.loc);
    ok(lastAudit("auth.google_linked")?.entity_id === "10" && lastAudit("auth.google_linked").d.via === "profile_connect", "...audited");
    ok(db.prepare(`SELECT COUNT(*) AS n FROM notifications WHERE user_id = 10 AND kind = 'security' AND message LIKE '%Google account was connected%'`).get().n === 1, "...and the person is told");
    ok((await call("/auth/2fa/status", 10)).j?.google?.linked === true, "Profile -> Security now says connected");
    ok((await conn(10, { totp: code() })).j?.error?.code === "already_linked", "a second Connect is refused while one is connected");
    const edG = await google("g-ed-real", "ed.personal@gmail.com");
    ok(edG.loc === "/login?2fa=1" && !session(edG), "Google sign-in now finds them by their Google id, and still asks for the code", edG.loc);
    const rootC = await conn(8, { totp: code(), return_to: "admin" });
    const rootOk = await gFinish({ loc: rootC.j.url, bind: bindOf(rootC.cookies) }, "g-root", "root.personal@gmail.com", { uid: 8 });
    ok(rootOk.loc === "/admin?google=connected" && user(8).google_sub === "g-root", "from the admin console it returns there", rootOk.loc);
    for (let i = 0; i < 5; i++) await conn(1, { totp: code() });
    ok((await conn(1, { totp: code() })).status === 429, "Connect is rate-limited (5 an hour)");

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
    const begunBefore = await gStart(); // a sign-in begun while Google is still on
    const turnOff = await call("/staff/auth/settings", 1, "PUT", body({ enabled: false, customer_signup: true }, { totp: code() }));
    ok(turnOff.status === 200 && turnOff.j?.google?.enabled === false, "the owner turns Google off", turnOff.text);
    const sa = lastAudit("auth.settings_google");
    ok(sa?.user_id === 1 && sa.d.before?.enabled === true && sa.d.after?.enabled === false && sa.d.reason, "...audited with the before, the after and the reason");
    ok((await raw("/auth/methods")).j?.google === false, "the login page is told Google is off");
    const st = await raw("/auth/google");
    ok(st.status === 302 && st.loc === "/login?error=google_off", "starting a Google sign-in lands on the sign-in page with the reason", st.loc);
    const n1 = users();
    const cb = await gFinish(begunBefore, "g-walk", "walk.in@gmail.com");
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

    {
    /* ================= 1c (v1.266.0): customers and Google ================= */
    const put = (g, extra = {}) => call("/staff/auth/settings", 1, "PUT", { google: { enabled: true, customer_signup: true, ...g }, reason: "Legacy window for the old Google customers", totp: code(), ...extra });
    /* the legacy window (R11) */
    ok((await put({ legacy_link_until: "2026-11-01" })).status === 400, "R11: the legacy window cannot end in the past");
    ok((await put({ legacy_link_until: "2027-03-01" })).status === 400, "...nor more than 90 days ahead");
    ok((await put({ legacy_link_until: null })).status === 200, "the owner closes it");
    const ls0 = await call("/staff/auth/settings", 8);
    ok(ls0.j?.legacy?.window_open === false && ls0.j.legacy.remaining === 4 && ls0.j.google.legacy_link_until === null, "the super admin sees it closed and how many legacy customers remain", ls0.text);
    const lgC = await google("g-27", "leg.g@gmail.com");
    ok(lgC.loc === FAIL && !session(lgC) && user(27).google_sub === null && lastAudit("auth.google_refused")?.d?.reason === "legacy_window_closed", "with the window closed, a legacy customer is refused with the neutral message, nothing linked", lgC.loc);
    const lg22 = await google("g-leg-c2", "leg.c@gmail.com"); // a legacy customer with 2FA: the window is read again at the code
    ok(lg22.loc === FAIL && user(22).google_sub === null, "...the same for one who would be asked for a code");
    ok((await put({ legacy_link_until: "2026-12-04" })).status === 200 && lastAudit("auth.settings_google")?.d?.after?.legacy_link_until === "2026-12-04", "the owner opens it to a date, audited");
    const lgO = await google("g-27", "leg.g@gmail.com");
    ok(session(lgO) && user(27).google_sub === "g-27" && user(27).email_verified_at, "with the window open, the legacy link works", lgO.loc);
    /* the notice (Q7): words on screen, sent only by the owner, each customer once */
    const pv = await call("/staff/auth/legacy-notice", 8, "POST", {});
    ok(pv.status === 200 && pv.j?.remaining === 3 && pv.j.window_open === true && /04-12-2026/.test(pv.j.subject) && /\{name\}/.test(pv.j.text) && pv.j.can_send === false, "the super admin reads the notice: how many, the exact words, the last day", pv.text);
    ok((await call("/staff/auth/legacy-notice", 8, "POST", { send: true, reason: "Tell the legacy customers", totp: code() })).status === 403, "...and cannot send it");
    ok((await call("/staff/auth/legacy-notice", 10, "POST", {})).status === 403, "an editor cannot read it");
    ok((await call("/staff/auth/legacy-notice", 1, "POST", { send: true, reason: "Tell the legacy customers", totp: code() })).j?.error?.code === "mail_unavailable", "without email sending set up it says so");
    env.EMAIL = { send: async (m) => { mails.push(m); } }; env.MAIL_FROM = "portal@a2z.test";
    ok((await call("/staff/auth/legacy-notice", 1, "POST", { send: true, reason: "Tell the legacy customers" })).status === 401, "the owner needs a fresh code to send");
    const sent1 = await call("/staff/auth/legacy-notice", 1, "POST", { send: true, reason: "Tell the legacy customers", totp: code() });
    const nm = mails.filter((m) => /sign in with Google once/.test(m.subject));
    ok(sent1.j?.sent === 3 && nm.length === 3 && nm.every((m) => m.text.includes(m.to) && !/leg\.[a-z]@gmail\.com/.test(m.text.replace(m.to, ""))), "the owner sends it: one email to each remaining legacy customer, naming only their own address", JSON.stringify([sent1.j, nm.map((m) => m.to)]));
    const sent2 = await call("/staff/auth/legacy-notice", 1, "POST", { send: true, reason: "Tell the legacy customers", totp: code() });
    ok(sent2.j?.sent === 0 && mails.filter((m) => /sign in with Google once/.test(m.subject)).length === 3, "...a second press sends nobody anything again");

    /* F5: invoices follow the proven address */
    signIn(20);
    ok((await call("/account/orders", 9)).j?.locked === true, "F5: a password customer who has not proven their address does not see invoices yet");
    ok((await call("/account/orders", 20)).j?.locked === false, "...a Google customer (proven by Google) does");

    /* customer Connect Google: password + the emailed code (N2) */
    const cst = await call("/auth/2fa/status", 9);
    ok(cst.j?.google?.proof === "password_email" && cst.j.google.can_connect === true && cst.j.google.linked === false, "the account page offers Connect Google with the password and an emailed code", cst.text);
    const askCode = (uid, purpose, password) => call("/auth/google/code", uid, "POST", { purpose, password });
    ok((await askCode(9, "connect", "wrong-password")).status === 401, "a wrong password sends no code");
    ok((await askCode(10, "connect", "Ed-pass-2026")).status === 403, "staff do not use emailed codes (their authenticator code)");
    ok((await askCode(20, "disconnect", "x")).j?.error?.code === "google_only", "a Google-only customer has no password to prove it with");
    const mc0 = mails.length;
    const ac = await askCode(9, "connect", "Shop-pass-2026");
    const codeMail = mails.slice(mc0).find((m) => m.to === "shop@gmail.com");
    const ecode = /(\d{6})/.exec(codeMail?.subject ?? "")?.[1];
    ok(ac.status === 200 && ac.j?.to === "sh***@gmail.com" && ecode && !ac.text.includes(ecode), "the right password emails a six-digit code to the address on file (never in the answer)", ac.text);
    ok(db.prepare(`SELECT code_hash FROM email_codes ORDER BY id DESC LIMIT 1`).get().code_hash !== ecode && !JSON.stringify(db.prepare(`SELECT * FROM email_codes`).all()).includes(`"${ecode}"`), "only a keyed hash of the code is stored");
    ok((await call("/auth/google/connect", 9, "POST", { code: ecode === "000000" ? "111111" : "000000" })).j?.error?.code === "invalid_code", "a wrong code is refused");
    const tokOld = tok[9]; signIn(9); // a second browser of the same customer
    ok((await call("/auth/google/connect", 9, "POST", { code: ecode })).j?.error?.code === "code_expired", "the code works only in the browser that asked for it");
    tok[9] = tokOld;
    const cc = await call("/auth/google/connect", 9, "POST", { code: ecode });
    ok(cc.status === 200 && cc.j?.url?.startsWith("https://accounts.google.com/") && user(9).email_verified_at, "the right code (once) opens Google, and proves the address", cc.text);
    ok((await call("/auth/google/connect", 9, "POST", { code: ecode })).j?.error?.code === "code_expired", "...the code is spent");
    ok((await call("/account/orders", 9)).j?.locked === false, "F5: with the address proven, their invoices show");
    const cb9 = await gFinish({ loc: cc.j.url, bind: bindOf(cc.cookies) }, "g-shop", "shop.personal@gmail.com", { uid: 9 });
    ok(cb9.loc === "/account?google=connected" && user(9).google_sub === "g-shop" && lastAudit("auth.google_linked")?.entity_id === "9", "Google's answer in the same session connects it, back to the account page", cb9.loc);
    const sg9 = await google("g-shop", "shop.personal@gmail.com");
    ok(session(sg9) && sg9.loc === "/account", "the customer can now sign in with that Google account");
    /* five wrong codes end a code */
    const mc1 = mails.length;
    await askCode(9, "disconnect", "Shop-pass-2026");
    const dcode = /(\d{6})/.exec(mails.slice(mc1).find((m) => m.to === "shop@gmail.com")?.subject ?? "")?.[1];
    for (let i = 0; i < 5; i++) await call("/auth/google/disconnect", 9, "POST", { code: dcode === "000000" ? "111111" : "000000" });
    ok((await call("/auth/google/disconnect", 9, "POST", { code: dcode })).j?.error?.code === "too_many_attempts" && user(9).google_sub === "g-shop", "five wrong codes and even the right one no longer works");
    /* R8: disconnect yourself */
    const mc2 = mails.length;
    await askCode(9, "disconnect", "Shop-pass-2026");
    const dcode2 = /(\d{6})/.exec(mails.slice(mc2).find((m) => m.to === "shop@gmail.com")?.subject ?? "")?.[1];
    const dc = await call("/auth/google/disconnect", 9, "POST", { code: dcode2 });
    ok(dc.status === 200 && user(9).google_sub === null && lastAudit("auth.google_unlinked")?.d?.via === "self", "R8: a customer with a password disconnects Google with the password + code", dc.text);
    ok((await call("/auth/google/disconnect", 20, "POST", { code: "123456" })).j?.error?.code === "no_alternative" && user(20).google_sub, "...a Google-only customer cannot (it is their only way in)");
    ok((await call("/auth/google/disconnect", 10, "POST", {})).status === 401 && user(10).google_sub, "staff confirm with their authenticator code");
    const dSt = await call("/auth/google/disconnect", 10, "POST", { totp: code() });
    ok(dSt.status === 200 && user(10).google_sub === null, "R8: staff with a password and two-factor disconnect Google themselves", dSt.text);
    ok((await call("/auth/2fa/status", 10)).j?.google?.linked === false, "...and Profile says so");

    /* R9: customer recovery by the owner or the super admin */
    const rec = (uid, id, action, b = {}) => call(`/staff/customer-accounts/${id}/${action}`, uid, "POST", { reason: "Customer lost access to their Google account", identity_checked: "Owner, video call", identity_method: "whatsapp_video", totp: code(), ...b });
    ok((await call("/staff/customer-accounts/22", 10)).status === 403, "R9: an editor cannot open customer recovery");
    ok((await call("/staff/customer-accounts/10", 8)).status === 404, "...it is for customer accounts only");
    const sheet = await call("/staff/customer-accounts/22", 8);
    ok(sheet.status === 200 && sheet.j?.account?.legacy === true && sheet.j.account.has_password === false && !/password_hash|google_sub|"g-/.test(sheet.text), "the super admin sees the customer's sign-in state - never a hash or a Google id", sheet.text);
    ok((await rec(8, 22, "password-link", { identity_checked: "" })).j?.error?.code === "identity_required", "R9: who checked the identity, and how, is required");
    ok((await rec(8, 22, "password-link", { identity_method: "email" })).j?.error?.code === "identity_required", "...by an accepted method");
    ok((await rec(8, 22, "password-link", { reason: "short" })).j?.error?.code === "reason_required", "...and a reason");
    ok((await rec(8, 22, "password-link", { totp: undefined })).status === 401, "...and a fresh code");
    ok((await rec(8, 27, "google-unlink")).j?.error?.code === "no_alternative" && user(27).google_sub === "g-27", "Google cannot be taken from a Google-only customer (send a password link first)");
    const mc3 = mails.length;
    const pl = await rec(8, 22, "password-link");
    const plMail = mails.slice(mc3).find((m) => m.to === "leg.c@gmail.com");
    const ptok = /#token=([0-9a-f]{64})/.exec(plMail?.text ?? "")?.[1];
    ok(pl.status === 200 && pl.j?.emailed === true && ptok && !/A2Z OS|two-factor/.test(plMail.text) && user(22).email_verified_at, "a set-password link goes to the address on file (customer wording), the address marked proven first", pl.text);
    ok(lastAudit("auth.customer_recovery")?.d?.identity_checked_by === "Owner, video call" && lastAudit("auth.customer_recovery").d.identity_method === "whatsapp_video", "...audited with who checked and how");
    ok(user(22).email === "leg.c@gmail.com", "...the email never changes in the same step");
    const spw = await raw("/auth/set-password", { method: "POST", body: { token: ptok, password: "Legacy-C-new-pass" } });
    ok(spw.status === 200 && !user(22).password_hash.startsWith("oauth$"), "the customer sets a password with the link", spw.text);
    signIn(22);
    ok((await call("/account/orders", 22)).j?.locked === false, "N14 / F5: after recovery their invoices still show");
    const sus = await rec(1, 22, "suspend");
    ok(sus.status === 200 && user(22).is_active === 0 && db.prepare(`SELECT COUNT(*) AS n FROM sessions WHERE user_id = 22`).get().n === 0, "the owner suspends: switched off, every session ended");
    ok((await rec(1, 22, "suspend")).j?.error?.code === "invalid_state", "recovery never lifts or repeats a suspension");
    for (let i = 0; i < 3; i++) await rec(8, 28, "password-link");
    ok((await rec(8, 28, "password-link")).status === 429, "three recovery actions a day for one customer");

    }
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
  ["worker/src/index.ts", "the kill switch ignored at the callback", "    if (!gset.enabled) return isConnect ? connectBack(\"off\") : failed(GOOGLE_OFF);", ""],
  ["worker/src/index.ts", "customer sign-up ignored", '      if (!gset.customer_signup) return await refuseG(null, "customer_signup_off");', ""],
  ["worker/src/staff.ts", "anyone with the CEO role turns the switches", 'if (user.role !== "ceo" || user.is_owner !== true) return err("forbidden", "Only the company owner', 'if (user.role !== "ceo" && user.role !== "super_admin") return err("forbidden", "Only the company owner'],
  ["worker/src/staff.ts", "the switches without a code", '    const stepUp = await requireFreshTotp(env, user, body?.totp, err, "change how people sign in");\n    if (stepUp) return stepUp;', ""],
  ["worker/src/index.ts", "prefix exemptions back", "  if (TWOFA_EXEMPT_PATHS.has(path)) return null;", "  if ([...TWOFA_EXEMPT_PATHS].some((p) => path.startsWith(p))) return null;"],
  /* v1.265.0 - Phase 1b */
  ["worker/src/index.ts", "1b: PKCE not sent", '    authUrl.searchParams.set("code_challenge_method", "S256");\n', ""],
  ["worker/src/google-oidc.ts", "1b N11: started without S256 advertised", '  if (!methods.includes("S256")) return { ok: false, reason: "pkce_s256_not_advertised" };\n', ""],
  ["worker/src/google-oidc.ts", "1b: the signature not checked", '  if (!good) return { ok: false, reason: "token_signature" };\n', ""],
  ["worker/src/google-oidc.ts", "1b: any alg accepted", '  if (header.alg !== "RS256") return { ok: false, reason: "token_alg" };\n', ""],
  ["worker/src/google-oidc.ts", "1b: the issuer not checked", '  if (typeof c.iss !== "string" || !GOOGLE_ISSUERS.includes(c.iss)) return { ok: false, reason: "token_iss" };\n', ""],
  ["worker/src/google-oidc.ts", "1b: the audience not checked", '  if (!auds.includes(opts.clientId)) return { ok: false, reason: "token_aud" };\n', ""],
  ["worker/src/google-oidc.ts", "1b: azp not checked", '  if ((auds.length > 1 || c.azp !== undefined) && c.azp !== opts.clientId) return { ok: false, reason: "token_azp" };\n', ""],
  ["worker/src/google-oidc.ts", "1b: expiry not checked", '  if (typeof c.exp !== "number" || c.exp + SKEW < now) return { ok: false, reason: "token_expired" };\n', ""],
  ["worker/src/google-oidc.ts", "1b: the nonce not checked", '  if (typeof c.nonce !== "string" || !eqConst(c.nonce, opts.nonce)) return { ok: false, reason: "token_nonce" };\n', ""],
  ["worker/src/index.ts", "1b: the request not spent (replay)", "    const spent = await env.DB.prepare(`UPDATE oauth_requests SET used_at = datetime('now') WHERE id = ?1 AND used_at IS NULL AND expires_at > datetime('now')`).bind(stateHash).run();", "    const spent = { meta: { changes: 1 } };"],
  ["worker/src/index.ts", "1b: the binding cookie not checked (login CSRF)", "    if (!oreq || !timingSafeEqual(oreq.binding_hash, await sha256Hex(bindCookie))) {", "    if (!oreq) {"],
  ["worker/src/index.ts", "1b: Connect answered in any session", '      if (!me || me.id !== oreq.user_id || !oreq.session_hash || !timingSafeEqual(oreq.session_hash, await sha256Hex(tok)) || (me.role === "customer") !== (oreq.return_to === null)) {', "      if (!me) {"],
  ["worker/src/index.ts", "1b: Connect without the code", '      const stepUp = await requireFreshTotp(env, me, body?.totp, errorResponse, "connect Google");\n      if (stepUp) return stepUp;\n', ""],
  ["worker/src/index.ts", "1b: an unverified Google email signs in", "    if (!claims.email || claims.email_verified !== true) return failed();", "    if (!claims.email) return failed();"],
  /* v1.266.0 - Phase 1c */
  ["worker/src/index.ts", "1c R11: the legacy window ignored", '        if (!legacyWindowOpen(gset)) return await refuseG(byEmail.id, "legacy_window_closed");\n', ""],
  ["worker/src/staff.ts", "1c R11: a window longer than 90 days", "if (!d || d < today || d > last) return err(", "if (!d || d < today) return err("],
  ["worker/src/staff.ts", "1c Q7: the notice sent to everyone again", "    for (const c of due.filter((d) => !notified.has(d.id))) {", "    for (const c of due) {"],
  ["worker/src/staff.ts", "1c Q7: anyone may send the notice", '    if (user.role !== "ceo" || user.is_owner !== true) return err("forbidden", "Only the company owner sends the legacy notice", 403);', ""],
  ["worker/src/index.ts", "1c N2: a customer connects without the emailed code", '      const proof = await spendEmailCode(env, request, me.id, "google_connect", body?.code);\n      if (!proof.ok) return errorResponse(proof.code, proof.message, proof.status);\n', ""],
  ["worker/src/index.ts", "1c: the code not bound to its browser", "AND purpose = ?2 AND session_hash = ?3 AND used_at IS NULL", "AND purpose = ?2 AND ?3 IS NOT NULL AND used_at IS NULL"],
  ["worker/src/index.ts", "1c: unlimited tries at a code", "  if (row.attempts >= 5) return {", "  if (false) return {"],
  ["worker/src/index.ts", "1c: a code used twice", "    env.DB.prepare(`UPDATE email_codes SET used_at = datetime('now') WHERE id = ?1 AND used_at IS NULL AND expires_at > datetime('now')`).bind(row.id),\n    assertOne(env),\n", ""],
  ["worker/src/index.ts", "1c R8: Google disconnected with no other way in", '    if (!hasPw || (me.role !== "customer" && !row.totp_enabled)) {', "    if (false) {"],
  ["worker/src/index.ts", "1c R8: staff disconnect without the code", '      const stepUp = await requireFreshTotp(env, me, body?.totp, errorResponse, "disconnect Google");\n      if (stepUp) return stepUp;\n', ""],
  ["worker/src/index.ts", "1c F5 reverted: invoices by sign-in method", "    const verified = !!acct?.email_verified_at || (acct?.password_hash.startsWith(\"oauth$\") ?? false);", "    const verified = (acct?.password_hash.startsWith(\"oauth$\") ?? false);"],
  ["worker/src/staff.ts", "1c R9: recovery without the identity check", "    if (checkedBy.length < 3 || !how) return err(", "    if (false) return err("],
  ["worker/src/staff.ts", "1c R9: recovery not limited", "checkRateLimit(env, `custrec:${c.id}`, 3, 86400)", "checkRateLimit(env, `custrec:${c.id}`, 99, 86400)"],
  ["worker/src/staff.ts", "1c R9: Google taken from a Google-only customer", '    if (action === "google-unlink" && !hasPw) return err(', '    if (false) return err('],
  ["worker/src/staff.ts", "1c R9: anyone with a staff role recovers customers", '    if (!allows(user, "account_recovery")) return err("forbidden", "Only the company owner or the super admin recovers a customer account."', '    if (false) return err("forbidden", "Only the company owner or the super admin recovers a customer account."'],
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
