/* SECURE AUTHENTICATION 2.0, PHASE 2A - PASSKEYS FOR THE COMPANY OWNER
 * (v1.269.0). Runtime guard: the WHOLE worker (index.ts, bundled) against
 * SQLite with every migration applied, by direct request, with a SOFTWARE
 * AUTHENTICATOR (node:crypto P-256 and RSA keys, a small CBOR encoder) that
 * builds real WebAuthn answers - and bad ones.
 *
 * claude/AUTH-2.0-AUDIT.md revision 3 sec. 4, 9, 10; the CEO, 05-11-2026:
 * "Build 2A now, enable later":
 *   off        built switched off: no passkey can be added or used until the
 *              company owner turns stage A on (reason + fresh code), and stage
 *              A needs the executive recovery panel ready (two members)
 *   who        stage A = the company owner only (not the Super Admin, not a
 *              second CEO-role account, not the COO); v1.270.0 stage B = the
 *              owner + named pilots (staff or agents, never a customer, at
 *              most 10); stage C = every staff and agent account with
 *              two-factor on; never a customer; a narrowed stage refuses the
 *              passkeys it no longer covers and keeps them
 *   admin      v1.270.0: the owner or the Super Admin removes a person's
 *              passkeys (identity check, reason, code) - kept as history,
 *              the passkey sessions end, the password session stays
 *   add        a fresh authenticator code first (a session alone cannot add
 *              one), bound to that session, five minutes, single use; origin,
 *              challenge, rpId, user presence AND verification all checked;
 *              ES256 and RS256; at most five; the same key never twice
 *   sign in    public, the challenge bound to the browser by an HttpOnly
 *              cookie, single use; signature, counter (a cloned key), user
 *              handle; the account judged again (suspended, resigned, no
 *              longer owner, 2FA off: no session); the session records the
 *              passkey; ten failures and the door closes for 15 minutes
 *   remove     a fresh code; kept as history; the sessions it opened end;
 *              a removed passkey never signs in again
 *   recovery   executive recovery and the break-glass script revoke them all
 * Then mutated copies must each fail a check. Invented people only.
 *
 *   node tests/go-live-z.mjs
 */
import { readFileSync, readdirSync, mkdtempSync, writeFileSync, cpSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash, createHmac, generateKeyPairSync, sign as nodeSign, randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const root = fileURLToPath(new URL("..", import.meta.url));
const bundle = (srcRoot, entry, out) => execSync(`npx esbuild "${join(srcRoot, entry)}" --bundle --format=esm --platform=neutral --outfile="${out}" --log-level=error`, { cwd: root, stdio: "inherit" });
const SECRET = "JBSWY3DPEHPK3PXP";
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const b32 = (s) => { let bits = 0, v = 0; const o = []; for (const ch of s) { v = (v << 5) | B32.indexOf(ch); bits += 5; if (bits >= 8) { o.push((v >>> (bits - 8)) & 255); bits -= 8; } } return Buffer.from(o); };
const totpAt = (ms) => { const c = Math.floor(ms / 30000); const b = Buffer.alloc(8); b.writeUInt32BE(Math.floor(c / 2 ** 32), 0); b.writeUInt32BE(c >>> 0, 4); const h = createHmac("sha1", b32(SECRET)).update(b).digest(); const o = h[h.length - 1] & 15; return String((((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1e6).padStart(6, "0"); };
const sha = (s) => createHash("sha256").update(s).digest("hex");
const shaB = (b) => createHash("sha256").update(b).digest();
const b64u = (b) => Buffer.from(b).toString("base64url");

/* ---- a minimal CBOR encoder (what an authenticator writes) ---- */
const head = (major, n) => n < 24 ? Buffer.from([(major << 5) | n]) : n < 256 ? Buffer.from([(major << 5) | 24, n]) : Buffer.from([(major << 5) | 25, n >> 8, n & 255]);
function cbor(v) {
  if (typeof v === "number") return v >= 0 ? head(0, v) : head(1, -1 - v);
  if (typeof v === "string") { const b = Buffer.from(v, "utf8"); return Buffer.concat([head(3, b.length), b]); }
  if (Buffer.isBuffer(v)) return Buffer.concat([head(2, v.length), v]);
  if (v instanceof Map) return Buffer.concat([head(5, v.size), ...[...v].flatMap(([k, x]) => [cbor(k), cbor(x)])]);
  throw new Error("cbor: type");
}

/* ---- the software authenticator ---- */
function authenticator(kind = "ec", { counting = false } = {}) {
  const { privateKey, publicKey } = kind === "rsa" ? generateKeyPairSync("rsa", { modulusLength: 2048 }) : generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = publicKey.export({ format: "jwk" });
  const cose = kind === "rsa"
    ? cbor(new Map([[1, 3], [3, -257], [-1, Buffer.from(jwk.n, "base64url")], [-2, Buffer.from(jwk.e, "base64url")]]))
    : cbor(new Map([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x, "base64url")], [-3, Buffer.from(jwk.y, "base64url")]]));
  const credId = randomBytes(32);
  let count = 0;
  const flags = ({ up = true, uv = true, at = false, be = true }) => (up ? 1 : 0) | (uv ? 4 : 0) | (be ? 8 : 0) | (at ? 64 : 0);
  const cnt = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
  return {
    id: b64u(credId),
    create(o, x = {}) {
      const cdj = Buffer.from(JSON.stringify({ type: x.type ?? "webauthn.create", challenge: x.challenge ?? o.challenge, origin: x.origin ?? "https://portal.a2z.test", ...(x.cross ? { crossOrigin: true } : {}) }));
      const ad = Buffer.concat([shaB(x.rpId ?? o.rp.id), Buffer.from([flags({ ...x, at: true })]), cnt(0), Buffer.alloc(16, 7), Buffer.from([0, credId.length]), credId, cose]);
      const att = cbor(new Map([["fmt", "none"], ["attStmt", new Map()], ["authData", ad]]));
      return { id: x.id ?? b64u(credId), rawId: b64u(credId), type: "public-key", response: { clientDataJSON: b64u(cdj), attestationObject: b64u(att), transports: ["internal", "hybrid"] } };
    },
    get(o, x = {}) {
      if (counting && !x.sameCount) count++;
      const cdj = Buffer.from(JSON.stringify({ type: x.type ?? "webauthn.get", challenge: x.challenge ?? o.challenge, origin: x.origin ?? "https://portal.a2z.test" }));
      const ad = Buffer.concat([shaB(x.rpId ?? o.rpId), Buffer.from([flags(x)]), cnt(counting ? count : 0)]);
      let sig = nodeSign("sha256", Buffer.concat([ad, shaB(cdj)]), privateKey);
      if (x.badSig) { sig = Buffer.from(sig); sig[sig.length - 1] ^= 1; }
      return { id: b64u(credId), rawId: b64u(credId), type: "public-key", response: { clientDataJSON: b64u(cdj), authenticatorData: b64u(ad), signature: b64u(sig), userHandle: x.userHandle ?? null } };
    },
  };
}

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
    run: async () => ({ meta: { changes: Number(st.run(...b).changes) } }), _run: () => ({ meta: { changes: Number(st.run(...b).changes) } }) }; return o; };
  const env = {
    DB: { prepare: shim, batch: async (list) => { db.exec("BEGIN"); try { const r = list.map((s) => s._run()); db.exec("COMMIT"); return r; } catch (e) { db.exec("ROLLBACK"); throw e; } } },
    SESSION_PEPPER: "pepper", COMPANY_DOMAIN: "a2z.test", ALLOWED_ORIGINS: "https://portal.a2z.test,https://old.example.test",
    GOOGLE_CLIENT_ID: "cid", GOOGLE_CLIENT_SECRET: "csecret",
    MEDIA: { put: async () => {}, head: async () => null, get: async () => null, list: async () => ({ objects: [] }) },
  };
  /* invented people: 1 the CEO (company owner), 2 the Super Admin, 3 COO, 6 CCO, 12 a second CEO-role account;
     v1.270.0: 20 an agent, 21 a customer (with an authenticator, to prove the role alone keeps them out) */
  db.exec(`INSERT INTO users (id, name, full_name, email, role, is_active, password_hash, totp_enabled, totp_secret) VALUES
    (1,'Owner','Owner Person','owner@a2z.test','ceo',1,'x',1,'${SECRET}'),
    (2,'Super Admin','Root Person','root@a2z.test','super_admin',1,'x',1,'${SECRET}'),
    (3,'Coo','Coo Person','coo@a2z.test','coo',1,'x',1,'${SECRET}'),
    (6,'Cco','Cco Person','cco@a2z.test','cco',1,'x',1,'${SECRET}'),
    (12,'Second','Second Ceo','ceo2@a2z.test','ceo',1,'x',1,'${SECRET}'),
    (20,'Agent','Agent Person','agent@a2z.test','agent',1,'x',1,'${SECRET}'),
    (21,'Cust','Customer Person','cust@a2z.test','customer',1,'x',1,'${SECRET}')`);
  const OWNER = `'{"user_id":1,"set_by":2,"set_by_name":"Super Admin","set_at":"2026-11-02 06:00:54","reason":"test"}'`;
  db.exec(`INSERT INTO system_meta (key, value) VALUES ('company_owner', ${OWNER})`);
  const RealDate = globalThis.Date; let fixed = new RealDate("2026-11-05T02:00:00Z").getTime();
  globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [fixed])); } static now() { return fixed; } };
  const code = () => { fixed += 31000; return totpAt(fixed); };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("{}", { status: 200 });
  const worker = (await import(pathToFileURL(workerBundle).href + `?v=${Math.random()}`)).default;
  const tok = {};
  const signIn = (key, id) => {
    tok[key] = `t-${key}-${Math.random()}`;
    db.prepare(`INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, datetime('now', '+12 hours'), datetime('now'))`).run(sha(tok[key]), id);
  };
  for (const id of [1, 2, 3, 6, 12, 20, 21]) signIn(id, id);
  signIn("1b", 1); // the owner on a second device
  const call = async (path, who, method = "GET", body, cookie = "") => {
    const sess = who ? `azone_session=${tok[who]}; csrf_token=c1` : "";
    const ck = [sess, cookie].filter(Boolean).join("; ");
    const headers = { "content-type": "application/json", origin: "https://portal.a2z.test", ...(ck ? { cookie: ck } : {}), ...(who ? { "x-csrf-token": "c1" } : {}) };
    const r = await worker.fetch(new Request(`https://api.a2z.test/api/v1${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined }), env);
    const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch { /* */ }
    return { status: r.status, j, text, setCookie: r.headers.get("set-cookie") ?? "" };
  };
  const P = (p, who, body, cookie) => call(`/auth/passkey${p}`, who, "POST", body ?? {}, cookie);
  const stage = (who, s, extra = {}) => call("/staff/auth/settings/passkeys", who, "PUT", { stage: s, reason: "Phase 2A switch for the owner", totp: code(), ...extra });
  const lastAudit = (a) => { const r = db.prepare(`SELECT * FROM audit_log WHERE action = ? ORDER BY id DESC LIMIT 1`).get(a); return r ? { ...r, d: JSON.parse(r.detail ?? "{}") } : null; };
  const creds = (uid) => db.prepare(`SELECT * FROM webauthn_credentials WHERE user_id = ? ORDER BY id`).all(uid);
  const resetLimits = () => db.exec(`DELETE FROM rate_limits`);
  const pkCookie = (r) => (r.setCookie.match(/azone_pk=([^;]+)/) ?? [])[1];
  /* one full sign-in: options -> the authenticator -> verify */
  const login = async (a, x = {}, cookieOverride) => {
    const o = await P("/login/options", null);
    const c = cookieOverride ?? pkCookie(o);
    const v = await P("/login/verify", null, { credential: a.get(o.j?.publicKey ?? {}, x) }, c ? `azone_pk=${c}` : "");
    return { o, v };
  };
  const add = async (who, a, x = {}, name = "Test phone") => {
    const o = await P("/register/options", who, { totp: code() });
    if (o.status !== 200) return { o, v: o };
    const v = await P("/register/verify", x.otherSession ?? who, { credential: a.create(o.j.publicKey, x), name });
    return { o, v };
  };

  try {
    /* ---------- built switched off ---------- */
    const m0 = await call("/auth/methods", null);
    ok(m0.status === 200 && m0.j?.passkeys === false, "the login page is told passkeys are off", m0.text);
    ok((await P("/login/options", null)).j?.error?.code === "passkeys_off", "passkey sign-in is refused while off");
    ok((await P("/register/options", 1, { totp: code() })).j?.error?.code === "passkeys_off", "the owner cannot add a passkey while off");
    const g0 = await call("/auth/passkeys", 1);
    ok(g0.status === 200 && g0.j?.stage === "off" && g0.j.can_add === false && g0.j.eligible === true, "the owner sees passkeys as built but off", g0.text.slice(0, 200));
    ok(!db.prepare(`SELECT 1 FROM business_settings WHERE key = 'auth_passkeys'`).get(), "nothing is stored until the owner chooses");

    /* ---------- only the owner turns it on, and only with the panel ready ---------- */
    ok((await stage(2, "A")).status === 403 && (await stage(12, "A")).status === 403 && (await stage(3, "A")).status === 403, "the Super Admin, a second CEO account and the COO cannot switch passkeys on");
    ok((await stage(1, "A", { reason: "x" })).j?.error?.code === "invalid_input", "a reason is required");
    ok((await stage(1, "A", { totp: undefined })).status === 401, "...and the owner's fresh code");
    ok((await stage(1, "A")).j?.error?.code === "recovery_panel_not_ready", "stage A is refused while the executive recovery panel is not ready");
    db.exec(`INSERT INTO exec_recovery_panel (user_id, added_by, added_reason, added_at, effective_at, accepted_at) VALUES
      (3, 1, 'test panel', datetime('now', '-2 days'), datetime('now', '-1 day'), datetime('now', '-2 days')),
      (6, 1, 'test panel', datetime('now', '-2 days'), datetime('now', '-1 day'), datetime('now', '-2 days'))`);
    const s1 = await stage(1, "A");
    ok(s1.status === 200 && s1.j?.passkeys?.stage === "A" && lastAudit("auth.settings_passkeys")?.d?.after?.stage === "A", "with two panel members who can act, the owner switches stage A on, audited", s1.text);
    ok((await call("/auth/methods", null)).j?.passkeys === true, "the login page is told passkeys are on");
    const set = await call("/staff/auth/settings", 1);
    ok(set.j?.passkeys?.stage === "A", "the sign-in settings show the stage");

    /* ---------- who may add one ---------- */
    ok((await P("/register/options", 2, { totp: code() })).status === 403, "the Super Admin cannot add a passkey (stage A)");
    ok((await P("/register/options", 12, { totp: code() })).status === 403, "a second CEO-role account that is not the owner cannot");
    ok((await P("/register/options", 3, { totp: code() })).status === 403, "the COO cannot");
    ok((await P("/register/options", null, { totp: code() })).status === 401, "nobody signed out can");
    ok((await P("/register/options", 1, {})).status === 401, "a long-lived session alone cannot add a passkey: the owner's fresh code is required");
    const o1 = await P("/register/options", 1, { totp: code() });
    const pk1 = o1.j?.publicKey;
    ok(o1.status === 200 && pk1?.rp?.id === "portal.a2z.test" && pk1.attestation === "none" && pk1.authenticatorSelection?.userVerification === "required" && pk1.authenticatorSelection?.residentKey === "required", "options: the relying party is the portal host, user verification and a discoverable key required", o1.text.slice(0, 300));
    ok(pk1?.pubKeyCredParams?.map((p) => p.alg).join() === "-7,-257", "only ES256 and RS256 are offered");
    ok(pk1 && !pk1.user.id.includes("owner") && Buffer.from(pk1.user.id, "base64url").length === 32, "the user handle is opaque (no email, no id)");

    /* ---------- bad answers are refused ---------- */
    const A = authenticator("ec");
    const bad = async (x, label) => {
      resetLimits();
      const r = await add(1, A, x);
      ok(r.v.status >= 400 && creds(1).length === 0, label, `${r.v.status} ${r.v.text.slice(0, 160)}`);
    };
    await bad({ origin: "https://evil.example" }, "a passkey made on another site is refused (origin)");
    await bad({ origin: "https://old.example.test" }, "...even an allowed old domain: it is not the relying party");
    await bad({ rpId: "evil.example" }, "a passkey for another relying party is refused (rpId hash)");
    await bad({ challenge: "AAAA" }, "an answer to another challenge is refused");
    await bad({ type: "webauthn.get" }, "a sign-in answer cannot add a passkey (type)");
    await bad({ cross: true }, "a cross-origin frame is refused");
    await bad({ uv: false }, "without user verification (Face ID, fingerprint, PIN) it is refused");
    await bad({ up: false }, "without user presence it is refused");
    await bad({ id: b64u(randomBytes(32)) }, "a credential id that does not match the key is refused");
    await bad({ otherSession: "1b" }, "the owner's OTHER session cannot finish what this session started (bound to the session)");
    ok(lastAudit("auth.passkey_add_refused") !== null, "a refused passkey is audited");

    /* ---------- a good passkey ---------- */
    resetLimits();
    const o2 = await P("/register/options", 1, { totp: code() });
    const regAnswer = A.create(o2.j.publicKey);
    const v2 = await P("/register/verify", 1, { credential: regAnswer, name: "Owner iPhone" });
    const row = creds(1)[0];
    ok(v2.status === 200 && row?.name === "Owner iPhone" && row.alg === -7 && row.credential_id === A.id && !row.revoked_at, "the owner adds a passkey (ES256)", v2.text);
    ok(lastAudit("auth.passkey_added")?.entity_id === String(row?.id), "...audited");
    ok(db.prepare(`SELECT COUNT(*) AS n FROM notifications WHERE user_id = 1 AND kind = 'security'`).get().n >= 1, "...and the owner is told");
    ok((await P("/register/verify", 1, { credential: regAnswer, name: "Again" })).status === 401 && creds(1).length === 1, "the same answer cannot be used twice (single-use challenge)");
    const o3 = await P("/register/options", 1, { totp: code() });
    ok(o3.j?.publicKey?.excludeCredentials?.[0]?.id === A.id, "the device is told which passkey already exists");
    ok((await P("/register/verify", 1, { credential: A.create(o3.j.publicKey) })).j?.error?.code === "already_added" && creds(1).length === 1, "the same key is never added twice");
    const R = authenticator("rsa");
    const vr = await add(1, R, {}, "Office laptop");
    ok(vr.v.status === 200 && creds(1)[1]?.alg === -257, "an RS256 passkey (Windows Hello) is added", vr.v.text);
    const list = await call("/auth/passkeys", 1);
    ok(list.j?.passkeys?.length === 2 && !list.text.includes(row.public_key) && !list.text.includes(A.id), "the list shows names and dates - never a key or a credential id", list.text.slice(0, 200));
    ok((await call("/auth/passkeys", 2)).j?.passkeys?.length === 0, "the Super Admin sees none of the owner's passkeys");

    /* ---------- sign in ---------- */
    resetLimits();
    const o4 = await P("/login/options", null);
    const ck4 = pkCookie(o4);
    ok(o4.status === 200 && ck4 && /HttpOnly/i.test(o4.setCookie) && /SameSite=Strict/i.test(o4.setCookie) && /Path=\/api\/v1\/auth\/passkey/.test(o4.setCookie), "sign-in options bind the challenge to this browser with an HttpOnly cookie", o4.setCookie);
    ok(o4.j?.publicKey?.userVerification === "required" && o4.j.publicKey.allowCredentials.length === 0, "...user verification required, no account named");
    ok(!db.prepare(`SELECT 1 FROM webauthn_challenges WHERE binding_hash = ?`).get(ck4) && db.prepare(`SELECT 1 FROM webauthn_challenges WHERE binding_hash = ?`).get(sha(ck4)), "only the cookie's hash is stored");
    ok((await P("/login/verify", null, { credential: A.get(o4.j.publicKey) })).j?.error?.code === "challenge_expired", "without the browser's cookie the answer is refused");
    ok((await P("/login/verify", null, { credential: A.get(o4.j.publicKey) }, `azone_pk=${b64u(randomBytes(32))}`)).j?.error?.code === "challenge_expired", "...and with another browser's cookie");
    const good = A.get(o4.j.publicKey, { userHandle: pk1.user.id });
    const v4 = await P("/login/verify", null, { credential: good }, `azone_pk=${ck4}`);
    const sessTok = (v4.setCookie.match(/azone_session=([^;]+)/) ?? [])[1];
    const srow = sessTok ? db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(sha(sessTok)) : null;
    ok(v4.status === 200 && v4.j?.user?.id === 1 && srow?.user_id === 1, "the owner signs in with the passkey", v4.text);
    ok(srow?.auth_method === "passkey" && srow.auth_credential_id === row.id, "...the session records the passkey that opened it");
    ok(lastAudit("auth.login_passkey")?.entity_id === String(row.id), "...audited");
    ok(/azone_pk=;/.test(v4.setCookie), "...and the binding cookie is cleared");
    tok.pk = sessTok;
    const me = await call("/auth/me", "pk");
    ok(me.status === 200 && me.j?.user?.id === 1, "the passkey session is an ordinary session", me.text.slice(0, 160));
    ok((await P("/login/verify", null, { credential: good }, `azone_pk=${ck4}`)).status === 401, "a replayed sign-in is refused (the challenge is spent)");

    const refused = async (x, label, prep) => {
      resetLimits();
      if (prep) prep();
      const { v } = await login(A, x);
      ok(v.status === 401 && v.j?.error?.code === "passkey_not_verified", label, `${v.status} ${v.text.slice(0, 160)}`);
    };
    await refused({ uv: false }, "a sign-in without user verification is refused");
    await refused({ up: false }, "...without user presence");
    await refused({ badSig: true }, "...with a bad signature");
    await refused({ origin: "https://evil.example" }, "...from another site");
    await refused({ rpId: "evil.example" }, "...for another relying party");
    await refused({ type: "webauthn.create" }, "...of the wrong type");
    await refused({ userHandle: b64u(randomBytes(32)) }, "...naming another user");
    ok(lastAudit("auth.passkey_refused")?.d?.reason, "a refused sign-in is audited with its reason");
    resetLimits();
    { const o = await P("/login/options", null); const c = pkCookie(o);
      const ans = A.get(o.j.publicKey, { uv: false });
      await P("/login/verify", null, { credential: ans }, `azone_pk=${c}`);
      ok((await P("/login/verify", null, { credential: A.get(o.j.publicKey) }, `azone_pk=${c}`)).status === 401, "a refused answer spends the challenge: one try per ceremony"); }
    resetLimits();
    const stranger = authenticator("ec");
    ok((await login(stranger)).v.status === 401, "a passkey the portal never saw is refused");

    /* the account is judged again, every time */
    const es = db.prepare(`SELECT employment_status AS e FROM users WHERE id = 1`).get().e;
    const back = () => db.exec(`UPDATE users SET is_active = 1, employment_status = '${es}', totp_enabled = 1, role = 'ceo' WHERE id = 1; UPDATE system_meta SET value = ${OWNER} WHERE key = 'company_owner'`);
    await refused({}, "a suspended owner cannot sign in with a passkey", () => db.exec(`UPDATE users SET is_active = 0 WHERE id = 1`)); back();
    await refused({}, "...nor a resigned one", () => db.exec(`UPDATE users SET employment_status = 'resigned' WHERE id = 1`)); back();
    await refused({}, "...nor once the owner designation moves to another account", () => db.exec(`UPDATE system_meta SET value = '{"user_id":12}' WHERE key = 'company_owner'`)); back();
    await refused({}, "...nor with two-factor switched off", () => db.exec(`UPDATE users SET totp_enabled = 0 WHERE id = 1`)); back();
    resetLimits();
    ok((await login(A)).v.status === 200, "restored: the passkey works again");

    /* a cloned key: the counter must move forward */
    const C = authenticator("ec", { counting: true });
    resetLimits();
    ok((await add(1, C, {}, "Security key")).v.status === 200, "a counting security key is added");
    ok((await login(C)).v.status === 200 && (await login(C)).v.status === 200, "...and signs in, its counter moving forward");
    ok((await login(C, { sameCount: true })).v.status === 401, "a counter that does not move forward (a cloned key) is refused");

    /* ten failures close the door */
    resetLimits();
    for (let i = 0; i < 10; i++) await login(A, { badSig: true });
    const lim = await P("/login/options", null);
    ok(lim.status === 429, "ten failed passkey sign-ins close the door for 15 minutes", lim.text);
    resetLimits();

    /* ---------- five at most ---------- */
    for (let i = creds(1).filter((c) => !c.revoked_at).length; i < 5; i++) await add(1, authenticator("ec"), {}, `Key ${i}`);
    ok(creds(1).filter((c) => !c.revoked_at).length === 5 && (await P("/register/options", 1, { totp: code() })).j?.error?.code === "limit_reached", "five passkeys at most");
    ok((await call("/auth/passkeys", 1)).j?.can_add === false, "...the panel stops offering another");

    /* ---------- rename and remove ---------- */
    ok((await call(`/auth/passkeys/${row.id}/rename`, 2, "POST", { name: "Mine now" })).status === 404, "nobody renames another account's passkey");
    ok((await call(`/auth/passkeys/${row.id}/rename`, 1, "POST", { name: "Owner iPhone 15" })).status === 200 && creds(1)[0].name === "Owner iPhone 15", "the owner renames a passkey");
    ok((await call(`/auth/passkeys/${row.id}/remove`, 2, "POST", { totp: code() })).status === 404, "nobody removes another account's passkey");
    ok((await call(`/auth/passkeys/${row.id}/remove`, 1, "POST", {})).status === 401, "removing needs a fresh code");
    resetLimits();
    const { v: v5 } = await login(A);
    const t5 = (v5.setCookie.match(/azone_session=([^;]+)/) ?? [])[1];
    const opened = db.prepare(`SELECT COUNT(*) AS n FROM sessions WHERE auth_credential_id = ?`).get(row.id).n;
    const rm = await call(`/auth/passkeys/${row.id}/remove`, 1, "POST", { totp: code() });
    const after = creds(1)[0];
    ok(rm.status === 200 && after.revoked_at && after.revoked_by === 1, "the owner removes the passkey", rm.text);
    ok(!db.prepare(`SELECT 1 FROM sessions WHERE id = ?`).get(sha(sessTok)) && !db.prepare(`SELECT 1 FROM sessions WHERE id = ?`).get(sha(t5)), "...every session it opened ends");
    ok(opened >= 2 && rm.j?.sessions_ended === opened && db.prepare(`SELECT COUNT(*) AS n FROM sessions WHERE auth_credential_id = ?`).get(row.id).n === 0, "...and says how many", `${opened} ${rm.text}`);
    ok(db.prepare(`SELECT 1 FROM sessions WHERE id = ?`).get(sha(tok[1])) && db.prepare(`SELECT 1 FROM sessions WHERE id = ?`).get(sha(tok["1b"])), "...the owner's password sessions stay");
    ok(creds(1).length >= 5, "...and it stays as history");
    ok(lastAudit("auth.passkey_removed")?.d?.sessions_ended === opened, "...audited");
    resetLimits();
    ok((await login(A)).v.status === 401, "a removed passkey never signs in again");
    ok((await call("/auth/passkeys", 1)).j?.removed?.some((r) => r.id === row.id), "the removed passkey is listed in the history");

    /* ---------- the kill switch ---------- */
    ok((await stage(1, "off")).status === 200, "the owner switches passkeys off");
    resetLimits();
    ok((await P("/login/options", null)).j?.error?.code === "passkeys_off", "...no passkey sign-in starts");
    ok((await P("/login/verify", null, { credential: R.get({ challenge: "x", rpId: "portal.a2z.test" }) }, "azone_pk=x")).j?.error?.code === "passkeys_off", "...and none finishes");
    ok(creds(1).filter((c) => !c.revoked_at).length === 4, "...the passkeys themselves are kept for when it is back on");
    ok((await stage(1, "A")).status === 200, "switched back on");

    /* ---------- v1.270.0 - stage B (named pilots) and stage C (all staff and agents) ---------- */
    ok((await stage(1, "B")).j?.error?.code === "pilot_required", "stage B needs at least one named pilot");
    ok((await stage(1, "B", { pilot_user_ids: [21] })).j?.error?.code === "invalid_pilot", "a customer can never be a pilot");
    ok((await stage(1, "B", { pilot_user_ids: [3, 3, 6, 2, 12, 20, 7, 8, 9, 10, 11] })).j?.error?.code === "invalid_input", "eleven pilots is too many");
    ok((await stage(2, "B", { pilot_user_ids: [3] })).status === 403, "only the company owner names the pilots");
    const sB = await stage(1, "B", { pilot_user_ids: [3] });
    ok(sB.status === 200 && lastAudit("auth.settings_passkeys")?.d?.after?.pilot_user_ids?.join() === "3", "the owner switches stage B on with the COO as pilot, audited", sB.text);
    resetLimits();
    const COO = authenticator("ec");
    ok((await add(3, COO, {}, "Coo phone")).v.status === 200 && creds(3).length === 1, "stage B: the pilot (COO) adds a passkey");
    ok((await P("/register/options", 6, { totp: code() })).status === 403, "stage B: the CCO (not a pilot) cannot");
    ok((await P("/register/options", 20, { totp: code() })).status === 403, "stage B: an agent (not a pilot) cannot");
    const vC = (await login(COO)).v;
    ok(vC.status === 200 && vC.j?.user?.id === 3, "stage B: the pilot signs in with the passkey", vC.text);
    const sC = await stage(1, "C");
    ok(sC.status === 200 && sC.j?.passkeys?.stage === "C" && sC.j.passkeys.pilot_user_ids.join() === "3", "the owner switches stage C on (the pilot list is kept)", sC.text);
    resetLimits();
    const CCO = authenticator("ec"), AG = authenticator("ec");
    ok((await add(6, CCO, {}, "Cco phone")).v.status === 200, "stage C: the CCO adds a passkey");
    ok((await add(20, AG, {}, "Agent phone")).v.status === 200, "stage C: an agent adds a passkey");
    const vA = (await login(AG)).v;
    tok.ag = (vA.setCookie.match(/azone_session=([^;]+)/) ?? [])[1];
    ok(vA.status === 200 && vA.j?.user?.role === "agent" && (await call("/auth/me", "ag")).status === 200, "stage C: the agent signs in with it; an ordinary session", vA.text);
    ok((await P("/register/options", 21, { totp: code() })).status === 403 && creds(21).length === 0, "stage C: a customer still cannot add one");
    ok((await call("/auth/passkeys", 6)).j?.in_stage === true, "the CCO is told passkeys are on for them");
    db.exec(`UPDATE users SET totp_enabled = 0 WHERE id = 3`);
    resetLimits();
    ok((await login(COO)).v.status === 401, "stage C: with two-factor switched off the COO's passkey is refused");
    db.exec(`UPDATE users SET totp_enabled = 1 WHERE id = 3`);
    const people = (await call("/staff/auth/settings", 1)).j?.passkey_people ?? [];
    ok(people.find((x) => x.id === 3)?.passkeys === 1 && people.find((x) => x.id === 20)?.passkeys === 1 && !people.some((x) => x.id === 21) && !JSON.stringify(people).includes(COO.id), "the owner's settings list staff and agents with their passkey counts - no customer, no key", JSON.stringify(people).slice(0, 200));
    ok((await call("/staff/auth/settings", 3)).status === 403, "...which the COO does not see");
    ok((await stage(1, "A")).status === 200, "the owner narrows it back to stage A");
    resetLimits();
    ok((await login(AG)).v.status === 401 && creds(20).every((c) => !c.revoked_at), "stage A again: the agent's passkey is refused, and kept");
    ok((await stage(1, "C")).status === 200, "stage C again");

    /* ---------- an administrator removes a person's passkeys (lost or stolen device) ---------- */
    resetLimits();
    const t3 = ((await login(COO)).v.setCookie.match(/azone_session=([^;]+)/) ?? [])[1];
    ok(db.prepare(`SELECT COUNT(*) AS n FROM sessions WHERE user_id = 3 AND auth_method = 'passkey'`).get().n >= 1, "the COO has a passkey session");
    const sheet = await call("/staff/accounts/3", 2);
    ok(sheet.j?.account?.passkeys === 1 && sheet.j.sessions.some((x) => x.passkey === true) && !sheet.text.includes(COO.id), "the account sheet shows the passkey count and which devices a passkey signed in", sheet.text.slice(0, 200));
    const RV = (who, extra = {}) => call("/staff/accounts/3/passkeys/revoke", who, "POST", { reason: "COO reported the phone stolen", identity_checked: "Root Person by video call", totp: code(), ...extra });
    ok((await RV(2, { identity_checked: "" })).j?.error?.code === "invalid_input", "removing someone's passkeys needs who checked their identity");
    ok((await RV(2, { totp: undefined })).status === 401, "...and a fresh code");
    ok((await RV(6)).status === 403, "the CCO cannot remove the COO's passkeys");
    ok((await call("/staff/accounts/3/passkeys/revoke", 3, "POST", { reason: "COO reported the phone stolen", identity_checked: "self", totp: code() })).status >= 400, "nobody uses the admin door on their own account");
    const rv = await RV(2);
    ok(rv.status === 200 && rv.j?.passkeys_revoked === 1 && creds(3).every((c) => c.revoked_at && c.revoked_reason === "removed by an administrator"), "the Super Admin removes the COO's passkeys - kept as history", rv.text);
    ok(!db.prepare(`SELECT 1 FROM sessions WHERE id = ?`).get(sha(t3)) && db.prepare(`SELECT 1 FROM sessions WHERE id = ?`).get(sha(tok[3])), "...the passkey sessions end, the password session stays");
    ok(lastAudit("auth.passkeys_revoked_by_admin")?.entity_id === "3", "...audited");
    resetLimits();
    ok((await login(COO)).v.status === 401, "...and the removed passkey never signs in again");
    ok(creds(6).length === 1 && creds(6).every((c) => !c.revoked_at), "...nobody else's passkeys changed");

    /* ---------- executive recovery revokes every passkey ---------- */
    db.exec(`INSERT INTO exec_recovery_requests (target_id, requested_by, reason, identity_checked, identity_method, status, approve_by, approved_by, approved_at, execute_after)
      VALUES (1, 3, 'lost phone', 'seen in person', 'in_person', 'approved', datetime('now', '+1 day'), 6, datetime('now', '-13 hours'), datetime('now', '-1 hour'))`);
    await call("/staff/recovery", 3);
    const rq = db.prepare(`SELECT status FROM exec_recovery_requests ORDER BY id DESC LIMIT 1`).get();
    ok(rq?.status === "executed", "an approved executive recovery runs", JSON.stringify(rq));
    ok(creds(1).every((c) => c.revoked_at) && creds(1).some((c) => c.revoked_reason === "executive recovery"), "...and revokes every passkey of the account, kept as history");

    /* ---------- an administrator's two-factor reset revokes them too ---------- */
    db.exec(`UPDATE users SET totp_enabled = 1, totp_secret = '${SECRET}', recovery_rotation_required = NULL WHERE id = 1`);
    signIn(1, 1); resetLimits();
    const D = authenticator("ec");
    ok((await add(1, D, {}, "New phone")).v.status === 200, "after recovery and two-factor again, the owner adds a new passkey");
    const rs = await call("/staff/accounts/1/reset-2fa", 2, "POST", { reason: "Owner lost the authenticator again", identity_checked: "Root Person in person", totp: code() });
    ok(rs.status === 200 && creds(1).every((c) => c.revoked_at) && creds(1).some((c) => c.revoked_reason === "two-factor reset by an administrator"), "the Super Admin's two-factor reset of the owner revokes every passkey", rs.text);

    /* ---------- the wiring ---------- */
    ok(/revokePasskeyStatements\(env, idOb, statusOb\)/.test(readFileSync(join(root, "worker/src/index.ts"), "utf8")), "offboarding revokes the leaver's passkeys");
    const idx = readFileSync(join(root, "worker/src/index.ts"), "utf8");
    ok(/"\/api\/v1\/auth\/passkey\/login\/options",/.test(idx) && /"\/api\/v1\/auth\/passkey\/login\/verify",/.test(idx) && !/"\/api\/v1\/auth\/passkey\/register/.test(idx) && !/"\/api\/v1\/auth\/passkey",/.test(idx), "the 2FA gate exempts exactly the two sign-in routes, no prefix and no registration");
    /* v1.271.0 - 0179 and 0180 (Phase 0) came after it: 0178 stays on the list and LATEST_MIGRATION is never older */
    ok(/"0178_passkeys",/.test(idx) && (/const LATEST_MIGRATION = "(\d{4})_/.exec(idx)?.[1] ?? "0") >= "0178", "migration 0178 is on the expected list and LATEST_MIGRATION is not older");
    const bg = readFileSync(join(root, "scripts/breakglass/reset-account.sql"));
    ok(/UPDATE webauthn_credentials SET revoked_at/.test(bg.toString()) && readFileSync(join(root, "docs/BREAKGLASS.md"), "utf8").includes(createHash("sha256").update(bg).digest("hex")), "the break-glass script revokes passkeys and its recorded SHA-256 matches");
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
const dir = mkdtempSync(join(tmpdir(), "glz-"));
bundle(root, "worker/src/index.ts", join(dir, "worker.mjs"));
report(await runtime(join(dir, "worker.mjs")));
const checks = n;

/* each must be caught by a check above; a mutation may change several places */
const W = "worker/src/webauthn.ts", K = "worker/src/passkeys.ts";
const MUT = [
  [W, "no origin check", [['  if (typeof c.origin !== "string" || !origins.includes(c.origin)) return "client_origin";\n', ""]]],
  [W, "no challenge check", [['  if (typeof c.challenge !== "string" || !eq(enc.encode(c.challenge), enc.encode(challenge))) return "client_challenge";\n', ""]]],
  [W, "no user verification at sign-in", [['    if (!ad.uv) return { ok: false, reason: "user_not_verified" };\n    const { key, alg }', "    const { key, alg }"]]],
  [W, "no user verification when adding", [['    if (!ad.uv) return { ok: false, reason: "user_not_verified" };\n    if (!ad.at', "    if (!ad.at"]]],
  [W, "no rpId check at sign-in", [['    const ad = parseAuthData(adBytes);\n    if (!eq(ad.rpIdHash, await sha256(enc.encode(opts.rpId)))) return { ok: false, reason: "rp_id" };', "    const ad = parseAuthData(adBytes);"]]],
  [W, "no signature check", [['    if (!good) return { ok: false, reason: "signature" };', ""]]],
  [W, "no counter check", [["    if ((ad.signCount !== 0 || cred.sign_count !== 0) && ad.signCount <= cred.sign_count)", "    if (false)"]]],
  [W, "no user handle check", [['r.userHandle !== cred.user_handle) return', 'false) return']]],
  [K, "the account not judged at sign-in", [["    const acct = await passkeyAccount(env, row.user_id, st);", "    const acct = await env.DB.prepare(`SELECT id, email, name, role FROM users WHERE id = ?1`).bind(row.user_id).first();"]]],
  [K, "no fresh code to add", [['    const su = await freshCode("add a passkey");\n    if (su) return su;\n', ""]]],
  [K, "any account adds one", [["  const canAdd = !!inStage;", "  const canAdd = st.stage !== \"off\";"], ["    const acct = await passkeyAccount(env, me.id, st);\n    if (!acct) return", "    const acct = await env.DB.prepare(`SELECT id, email, name, role FROM users WHERE id = ?1`).bind(me.id).first();\n    if (!acct) return"]]],
  [K, "pilots ignored in stage B", [["  if (st.stage === \"B\" && st.pilot_user_ids.includes(row.id))", "  if (st.stage === \"B\")"]]],
  [K, "a customer at stage C", [["    `SELECT id, email, name, role FROM users WHERE id = ?1 AND role != 'customer' AND COALESCE(totp_enabled, 0) = 1 AND ${STILL_OK}`,", "    `SELECT id, email, name, role FROM users WHERE id = ?1 AND COALESCE(totp_enabled, 0) = 1 AND ${STILL_OK}`,"]]],
  [K, "a passkey without two-factor", [["    `SELECT id, email, name, role FROM users WHERE id = ?1 AND role != 'customer' AND COALESCE(totp_enabled, 0) = 1 AND ${STILL_OK}`,", "    `SELECT id, email, name, role FROM users WHERE id = ?1 AND role != 'customer' AND ${STILL_OK}`,"]]],
  [K, "a customer as pilot", [["SELECT 1 FROM users WHERE id = ?1 AND role != 'customer' AND ${STILL_OK}", "SELECT 1 FROM users WHERE id = ?1 AND ${STILL_OK}"]]],
  [K, "stage B without pilots", [['  if (stage === "B" && pilots.length === 0) return e("pilot_required"', '  if (false) return e("pilot_required"']]],
  ["worker/src/staff.ts", "an administrator's passkey removal keeps the passkey sessions", [["        env.DB.prepare(`DELETE FROM sessions WHERE user_id = ?1 AND auth_method = 'passkey'`).bind(t.id),\n", ""]]],
  ["worker/src/staff.ts", "an administrator removes passkeys without an identity check", [['    if (action === "/passkeys/revoke" && checked.length < 3) return err(', '    if (false) return err(']]],
  [K, "sign-in works while off", [['    if (st.stage === "off") return e("passkeys_off", "Passkey sign-in is not switched on.", 409);\n', ""], ['    if (st.stage === "off") return e("passkeys_off", "Passkey sign-in is not switched on.", 409, clearPk);\n', ""]]],
  [K, "adding not bound to the session", [["AND user_id = ?1 AND session_hash = ?2 AND used_at IS NULL", "AND user_id = ?1 AND ?2 IS NOT NULL AND used_at IS NULL"]]],
  [K, "sign-in not bound to the browser", [["WHERE purpose = 'login' AND binding_hash = ?1 AND used_at IS NULL", "WHERE purpose = 'login' AND ?1 IS NOT NULL AND used_at IS NULL"]]],
  [K, "sign-in challenge not spent", [["        env.DB.prepare(`UPDATE webauthn_challenges SET used_at = datetime('now') WHERE id = ?1 AND used_at IS NULL AND expires_at > datetime('now')`).bind(ch.id),\n        assertOne(env),\n        env.DB.prepare(`UPDATE webauthn_credentials", "        env.DB.prepare(`UPDATE webauthn_credentials"]]],
  [K, "a removed passkey still signs in", [["FROM webauthn_credentials WHERE credential_id = ?1 AND revoked_at IS NULL", "FROM webauthn_credentials WHERE credential_id = ?1"], ["WHERE id = ?1 AND revoked_at IS NULL AND sign_count = ?3", "WHERE id = ?1 AND sign_count = ?3"]]],
  [K, "removing keeps its sessions", [["        env.DB.prepare(`DELETE FROM sessions WHERE user_id = ?1 AND auth_credential_id = ?2`).bind(me.id, id),\n", ""]]],
  [K, "no fresh code to remove", [['    const su = await freshCode("remove this passkey");\n    if (su) return su;\n', ""]]],
  [K, "the session does not record the passkey", [["auth_method = 'passkey', auth_credential_id = ?2 WHERE id = ?1", "auth_method = 'passkey', auth_credential_id = NULL + 0 * ?2 WHERE id = ?1"]]],
  [K, "stage A without the recovery panel", [['    if (n < 2) return e("recovery_panel_not_ready"', '    if (false) return e("recovery_panel_not_ready"']]],
  [K, "anyone switches the stage", [['  if (user.role !== "ceo" || user.is_owner !== true) return e("forbidden", "Only the company owner changes how people sign in", 403);\n  const stage', "  const stage"]]],
  [K, "no failure budget", [['    if (await d.isRateLimited(env, `pklogin:${d.clientIp(request)}`, 10, 900)) return e("rate_limited"', '    if (false) return e("rate_limited"']]],
  ["worker/src/staff.ts", "an administrator's 2FA reset keeps the passkeys", [['        ...(await passkeysMigrated(env) ? revokePasskeyStatements(env, t.id, "two-factor reset by an administrator") : []),\n', ""]]],
  ["worker/src/recovery.ts", "executive recovery keeps the passkeys", [['        ...(await passkeysMigrated(env) ? revokePasskeyStatements(env, r.target_id, "executive recovery") : []),\n', ""]]],
];
for (const [file, name, reps] of NOMUT ? [] : MUT) {
  n++;
  let src = readFileSync(join(root, file), "utf8");
  let applied = true;
  for (const [from, to] of reps) { if (!src.includes(from)) { applied = false; break; } src = src.replace(from, to); }
  if (!applied) { fail++; console.error(`FAIL mutation did not apply: ${name}`); continue; }
  const mdir = mkdtempSync(join(tmpdir(), "glz-m-"));
  cpSync(join(root, "worker"), join(mdir, "worker"), { recursive: true, filter: (s) => !s.includes("node_modules") });
  cpSync(join(root, "package.json"), join(mdir, "package.json"));
  for (const d of ["lib", "constants", "types"]) { try { cpSync(join(root, d), join(mdir, d), { recursive: true }); } catch { /* not every folder exists */ } }
  writeFileSync(join(mdir, file), src);
  try { bundle(mdir, "worker/src/index.ts", join(mdir, "worker.mjs")); } catch { fail++; console.error(`FAIL mutation did not build: ${name}`); continue; }
  const res = await runtime(join(mdir, "worker.mjs"));
  if (!res.some(([p]) => !p)) { fail++; console.error(`FAIL mutation not caught: ${name}`); }
}
if (fail) { console.error(`go-live-z: ${fail} of ${n} failed`); process.exit(1); }
console.log(`go-live-z: ${checks} checks passed (${NOMUT ? "mutations skipped" : `${MUT.length} mutations caught`}) - switched off until the owner says, stage by stage (owner, pilots, all staff and agents, never customers), every answer verified, every session judged`);
