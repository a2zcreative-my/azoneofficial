/* v1.269.0 - SECURE AUTHENTICATION 2.0, PHASE 2A: PASSKEYS FOR THE COMPANY
   OWNER (claude/AUTH-2.0-AUDIT.md revision 3 sec. 4, 9, 10; the CEO,
   05-11-2026: "Build 2A now, enable later").

   BUILT SWITCHED OFF. business_settings.auth_passkeys {stage} is "off" until
   the company owner turns stage A on in Profile -> Security (a reason and a
   fresh authenticator code, audited) - and stage A can only be turned on
   while the executive recovery panel (Phase R) has two members who can act,
   so the one account with a passkey always has a tested way back in.

   Stage A = the company owner's account ONLY (role ceo, named owner, active,
   two-factor on - the same four conditions as is_owner).
   v1.270.0 (Phase 2B / 2C; the CEO, 06-11-2026: "Build staff passkeys now",
   staff AND agents): stage B = the owner + the pilot staff the owner names
   (up to 10); stage C = every active staff and agent account with two-factor
   on. Customers never (stage D is not built). Each person adds their own -
   nobody can add one for someone else. No second identity store: a passkey is
   one more row pointing at users.id, and every session it opens is an
   ordinary session.

     POST /api/v1/auth/passkey/register/options   signed in, inside the stage, fresh authenticator code
     POST /api/v1/auth/passkey/register/verify    the same session, within five minutes
     POST /api/v1/auth/passkey/login/options      public; the challenge is bound to this browser (HttpOnly cookie)
     POST /api/v1/auth/passkey/login/verify       public; the account is judged again before any session
     GET  /api/v1/auth/passkeys                   signed in: my passkeys (never a key)
     POST /api/v1/auth/passkeys/:id/rename        signed in, my own, active
     POST /api/v1/auth/passkeys/:id/remove        signed in, my own, fresh authenticator code;
                                                  kept as history; the sessions it opened end

   Never: a passkey added without a fresh code (a long-lived session alone
   cannot add one); a passkey that signs in a suspended, resigned or
   terminated account, a customer, an account without two-factor, or one the
   stage no longer covers; a passkey added to an existing account by itself. Verification is worker/src/webauthn.ts. */
import type { Env } from "./index";
import { requireFreshTotp, notify } from "./staff";
import { audit } from "./shared";
import { assertOne, clearAsserts } from "./accounts";
import { activePanelCount } from "./recovery";
import { mailReady, sendMail } from "./mail";
import { b64u, verifyRegistration, verifyAssertion, ALGS } from "./webauthn";

export type PasskeyStage = "off" | "A" | "B" | "C";
export type PasskeySettings = { stage: PasskeyStage; pilot_user_ids: number[]; updated_at: string | null; updated_by: string | null };
const STAGES: readonly PasskeyStage[] = ["off", "A", "B", "C"];
export const MAX_PILOTS = 10;
type Me = { id: number; email: string; name: string; role: string; is_owner?: boolean };
export interface PasskeyDeps {
  getSessionUser: (req: Request, env: Env) => Promise<Me | null>;
  createSession: (env: Env, userId: number, req?: Request) => Promise<string>;
  sessionHeaders: (token: string) => HeadersInit;
  getCookie: (req: Request, name: string) => string | null;
  sha256Hex: (s: string) => Promise<string>;
  clientIp: (req: Request) => string;
  isRateLimited: (env: Env, key: string, limit: number, windowSeconds: number) => Promise<boolean>;
  bumpRateLimit: (env: Env, key: string, windowSeconds: number) => Promise<void>;
  checkRateLimit: (env: Env, key: string, limit: number, windowSeconds: number) => Promise<boolean>;
  origins: string[];       // allowedOrigins(env)
  primaryOrigin: string;   // primaryOrigin(env)
  sessionCookie: string;
}

export const MAX_PASSKEYS = 5;
const PK_COOKIE = "azone_pk";
const PK_PATH = "/api/v1/auth/passkey";
const TTL_MIN = 5;
const STILL_OK = `is_active = 1 AND COALESCE(employment_status, '') NOT IN ('resigned', 'terminated')`;

const j = (data: unknown, status = 200, headers: HeadersInit = {}) => {
  const h = new Headers(headers);
  h.set("Content-Type", "application/json");
  h.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(data), { status, headers: h });
};
const e = (code: string, message: string, status: number, headers: HeadersInit = {}) => j({ error: { code, message } }, status, headers);
const clearPk = { "Set-Cookie": `${PK_COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=${PK_PATH}; Max-Age=0` };
const NOT_VERIFIED = "That passkey could not be used. Sign in with your password and authenticator code.";

/** The setting, default OFF (no row, an unreadable row, an unknown stage). */
export async function passkeySettings(env: Env): Promise<PasskeySettings> {
  try {
    const r = await env.DB.prepare(`SELECT s.value, s.updated_at, COALESCE(NULLIF(TRIM(u.full_name), ''), u.name) AS who FROM business_settings s LEFT JOIN users u ON u.id = s.updated_by WHERE s.key = 'auth_passkeys'`)
      .first<{ value: string | null; updated_at: string | null; who: string | null }>();
    const v = r?.value ? JSON.parse(r.value) as Record<string, unknown> : {};
    const stage = (STAGES as readonly unknown[]).includes(v.stage) ? v.stage as PasskeyStage : "off";
    const pilots = Array.isArray(v.pilot_user_ids) ? [...new Set((v.pilot_user_ids as unknown[]).filter((x): x is number => Number.isInteger(x) && (x as number) > 0))].slice(0, MAX_PILOTS) : [];
    return { stage, pilot_user_ids: pilots, updated_at: r?.updated_at ?? null, updated_by: r?.who ?? null };
  } catch { return { stage: "off", pilot_user_ids: [], updated_at: null, updated_by: null }; }
}

/** The relying party: the primary origin's host without www. (a2zcreative.my),
    and only the allowed origins on that host - an old domain can never assert it. */
export function relyingParty(primary: string, origins: string[]): { rpId: string; origins: string[] } {
  const rpId = new URL(primary).hostname.replace(/^www\./, "");
  return { rpId, origins: origins.filter((o) => { try { const h = new URL(o).hostname; return h === rpId || h.endsWith(`.${rpId}`); } catch { return false; } }) };
}

/** A stable, opaque WebAuthn user handle - no email, no id in clear. */
async function userHandle(env: Env, userId: number): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${env.SESSION_PEPPER}:webauthn-user:${userId}`)));
  return b64u(d);
}

async function companyOwnerId(env: Env): Promise<number | null> {
  try {
    const m = await env.DB.prepare(`SELECT value FROM system_meta WHERE key = 'company_owner'`).first<{ value: string }>();
    const v = m?.value ? JSON.parse(m.value) as { user_id?: unknown } : null;
    const n = Number(v?.user_id);
    return Number.isInteger(n) && n > 0 ? n : null;
  } catch { return null; }
}
/** Who may add and use a passkey at this stage - read from the database
    (never from the request), every time: an active staff or agent account
    (never a customer), not resigned or terminated, two-factor ON, and inside
    the stage (A: the company owner; B: the owner or a named pilot; C: all). */
export async function passkeyAccount(env: Env, userId: number, st: PasskeySettings): Promise<{ id: number; email: string; name: string; role: string; is_owner: boolean } | null> {
  if (st.stage === "off") return null;
  const row = await env.DB.prepare(
    `SELECT id, email, name, role FROM users WHERE id = ?1 AND role != 'customer' AND COALESCE(totp_enabled, 0) = 1 AND ${STILL_OK}`,
  ).bind(userId).first<{ id: number; email: string; name: string; role: string }>();
  if (!row) return null;
  const isOwner = row.role === "ceo" && (await companyOwnerId(env)) === row.id;
  if (st.stage === "C") return { ...row, is_owner: isOwner };
  if (isOwner) return { ...row, is_owner: true };
  if (st.stage === "B" && st.pilot_user_ids.includes(row.id)) return { ...row, is_owner: false };
  return null;
}

async function tableReady(env: Env): Promise<boolean> {
  try { await env.DB.prepare(`SELECT id FROM webauthn_credentials LIMIT 0`).all(); return true; } catch { return false; }
}

/** The statements that revoke every passkey of one account (executive recovery). */
export function revokePasskeyStatements(env: Env, userId: number, reason: string): D1PreparedStatement[] {
  return [
    env.DB.prepare(`UPDATE webauthn_credentials SET revoked_at = datetime('now'), revoked_reason = ?2 WHERE user_id = ?1 AND revoked_at IS NULL`).bind(userId, reason),
    env.DB.prepare(`UPDATE webauthn_challenges SET used_at = datetime('now') WHERE user_id = ?1 AND used_at IS NULL`).bind(userId),
  ];
}
export { tableReady as passkeysMigrated };

export async function handlePasskeys(request: Request, env: Env, path: string, method: string, d: PasskeyDeps): Promise<Response> {
  if (!(await tableReady(env))) return e("migration_missing", "Run migration 0178 first (PUSH.bat).", 503);
  const st = await passkeySettings(env);
  const rp = relyingParty(d.primaryOrigin, d.origins);
  const body = method === "POST" ? (await request.json().catch(() => null)) as Record<string, unknown> | null : null;

  /* ================= sign in (public) ================= */
  if (path === `${PK_PATH}/login/options` && method === "POST") {
    if (st.stage === "off") return e("passkeys_off", "Passkey sign-in is not switched on.", 409);
    if (await d.isRateLimited(env, `pklogin:${d.clientIp(request)}`, 10, 900)) return e("rate_limited", "Too many attempts - try again in 15 minutes", 429);
    if (!(await d.checkRateLimit(env, `pkopt:${d.clientIp(request)}`, 30, 900))) return e("rate_limited", "Too many attempts - try again in 15 minutes", 429);
    const binding = b64u(crypto.getRandomValues(new Uint8Array(32)));
    const challenge = b64u(crypto.getRandomValues(new Uint8Array(32)));
    await env.DB.prepare(
      `INSERT INTO webauthn_challenges (id, purpose, binding_hash, challenge, expires_at) VALUES (?1, 'login', ?2, ?3, datetime('now', '+${TTL_MIN} minutes'))`,
    ).bind(crypto.randomUUID(), await d.sha256Hex(binding), challenge).run();
    try { await env.DB.prepare(`DELETE FROM webauthn_challenges WHERE expires_at <= datetime('now', '-1 day')`).run(); } catch { /* housekeeping */ }
    return j({ publicKey: { challenge, rpId: rp.rpId, timeout: TTL_MIN * 60_000, userVerification: "required", allowCredentials: [] } }, 200,
      { "Set-Cookie": `${PK_COOKIE}=${binding}; HttpOnly; Secure; SameSite=Strict; Path=${PK_PATH}; Max-Age=${TTL_MIN * 60}` });
  }

  if (path === `${PK_PATH}/login/verify` && method === "POST") {
    if (st.stage === "off") return e("passkeys_off", "Passkey sign-in is not switched on.", 409, clearPk);
    const ipKey = `pklogin:${d.clientIp(request)}`;
    if (await d.isRateLimited(env, ipKey, 10, 900)) return e("rate_limited", "Too many attempts - try again in 15 minutes", 429, clearPk);
    let chId: string | null = null;
    const fail = async (reason: string, userId: number | null) => {
      await d.bumpRateLimit(env, ipKey, 900);
      /* a refused answer spends the challenge too: one try per ceremony */
      if (chId) await env.DB.prepare(`UPDATE webauthn_challenges SET used_at = datetime('now') WHERE id = ?1 AND used_at IS NULL`).bind(chId).run();
      if (userId) await audit(env, userId, "auth.passkey_refused", "users", String(userId), { reason });
      return e("passkey_not_verified", NOT_VERIFIED, 401, clearPk);
    };
    const binding = d.getCookie(request, PK_COOKIE);
    const cred = (body?.credential ?? null) as { id?: unknown } | null;
    if (!binding || !cred || typeof cred.id !== "string" || cred.id.length > 1400) return e("challenge_expired", "This sign-in attempt expired - start again.", 401, clearPk);
    const ch = await env.DB.prepare(
      `SELECT id, challenge FROM webauthn_challenges WHERE purpose = 'login' AND binding_hash = ?1 AND used_at IS NULL AND expires_at > datetime('now')`,
    ).bind(await d.sha256Hex(binding)).first<{ id: string; challenge: string }>();
    if (!ch) return e("challenge_expired", "This sign-in attempt expired - start again.", 401, clearPk);
    chId = ch.id;
    type Cred = { id: number; user_id: number; credential_id: string; public_key: string; alg: number; sign_count: number };
    const row = await env.DB.prepare(
      `SELECT id, user_id, credential_id, public_key, alg, sign_count FROM webauthn_credentials WHERE credential_id = ?1 AND revoked_at IS NULL`,
    ).bind(cred.id).first<Cred>();
    if (!row) return fail("unknown_credential", null);
    /* the account is judged here, by the database, every time */
    const acct = await passkeyAccount(env, row.user_id, st);
    if (!acct) return fail("not_eligible", row.user_id);
    const v = await verifyAssertion(cred as Parameters<typeof verifyAssertion>[0],
      { ...row, user_handle: await userHandle(env, row.user_id) }, { challenge: ch.challenge, origins: rp.origins, rpId: rp.rpId });
    if (!v.ok) return fail(v.reason, row.user_id);
    /* ONE guarded batch: the challenge is spent exactly once, and the counter
       moves only from the value that was verified - a second tab or a replay
       finds either changed and nothing happens */
    try {
      await env.DB.batch([
        env.DB.prepare(`UPDATE webauthn_challenges SET used_at = datetime('now') WHERE id = ?1 AND used_at IS NULL AND expires_at > datetime('now')`).bind(ch.id),
        assertOne(env),
        env.DB.prepare(`UPDATE webauthn_credentials SET sign_count = ?2, last_used_at = datetime('now') WHERE id = ?1 AND revoked_at IS NULL AND sign_count = ?3`).bind(row.id, v.signCount, row.sign_count),
        assertOne(env),
        clearAsserts(env),
      ]);
    } catch { return e("challenge_expired", "This sign-in attempt expired - start again.", 401, clearPk); }
    const token = await d.createSession(env, acct.id, request);
    const tokenHash = await d.sha256Hex(token);
    const marked = await env.DB.prepare(`UPDATE sessions SET auth_method = 'passkey', auth_credential_id = ?2 WHERE id = ?1`).bind(tokenHash, row.id).run();
    if ((marked.meta?.changes ?? 0) !== 1) {
      await env.DB.prepare(`DELETE FROM sessions WHERE id = ?1`).bind(tokenHash).run();
      return e("session_failed", "The sign-in could not be completed - try again.", 500, clearPk);
    }
    await audit(env, acct.id, "auth.login_passkey", "webauthn_credentials", String(row.id));
    const hs = new Headers(d.sessionHeaders(token));
    hs.append("Set-Cookie", clearPk["Set-Cookie"]);
    return j({ user: { id: acct.id, email: acct.email, name: acct.name, role: acct.role } }, 200, hs);
  }

  /* ================= everything else needs a session ================= */
  const me = await d.getSessionUser(request, env);
  if (!me) return e("unauthorized", "Sign in required", 401);
  const sessHash = await d.sha256Hex(d.getCookie(request, d.sessionCookie) ?? "");
  const inStage = await passkeyAccount(env, me.id, st);
  const canAdd = !!inStage;
  const activeCount = async () => (await env.DB.prepare(`SELECT COUNT(*) AS n FROM webauthn_credentials WHERE user_id = ?1 AND revoked_at IS NULL`).bind(me.id).first<{ n: number }>())?.n ?? 0;
  const freshCode = async (what: string) => {
    const t = await env.DB.prepare(`SELECT COALESCE(totp_enabled, 0) AS t FROM users WHERE id = ?1`).bind(me.id).first<{ t: number }>();
    if (!t?.t) return e("twofa_required", "Two-factor must be on for this.", 403);
    return await requireFreshTotp(env, me, body?.totp, e, what);
  };

  if (path === "/api/v1/auth/passkeys" && method === "GET") {
    const active = (await env.DB.prepare(
      `SELECT id, name, created_at, last_used_at, backup_eligible, transports FROM webauthn_credentials WHERE user_id = ?1 AND revoked_at IS NULL ORDER BY id`,
    ).bind(me.id).all<{ id: number; name: string; created_at: string; last_used_at: string | null; backup_eligible: number | null; transports: string | null }>()).results;
    const removed = (await env.DB.prepare(
      `SELECT id, name, created_at, revoked_at, revoked_reason FROM webauthn_credentials WHERE user_id = ?1 AND revoked_at IS NOT NULL ORDER BY revoked_at DESC LIMIT 10`,
    ).bind(me.id).all()).results;
    let current: number | null = null;
    try { current = (await env.DB.prepare(`SELECT auth_credential_id AS c FROM sessions WHERE id = ?1`).bind(sessHash).first<{ c: number | null }>())?.c ?? null; } catch { current = null; }
    return j({
      stage: st.stage, can_add: canAdd && active.length < MAX_PASSKEYS, in_stage: canAdd, eligible: canAdd || me.is_owner === true, limit: MAX_PASSKEYS, this_session: current,
      passkeys: active.map((p) => ({ id: p.id, name: p.name, created_at: p.created_at, last_used_at: p.last_used_at, synced: p.backup_eligible === 1, transports: p.transports ? p.transports.split(",") : [] })),
      removed,
    });
  }

  if (path === `${PK_PATH}/register/options` && method === "POST") {
    if (st.stage === "off") return e("passkeys_off", "Passkeys are not switched on.", 409);
    if (!canAdd) return e("forbidden", "Passkeys are not available for your account at this stage.", 403);
    if (!(await d.checkRateLimit(env, `pkreg:${me.id}`, 10, 3600))) return e("rate_limited", "Too many attempts - try again in an hour", 429);
    if (await activeCount() >= MAX_PASSKEYS) return e("limit_reached", `You already have ${MAX_PASSKEYS} passkeys - remove one first.`, 409);
    const su = await freshCode("add a passkey");
    if (su) return su;
    const acct = await passkeyAccount(env, me.id, st);
    if (!acct) return e("forbidden", "Passkeys are not available for your account at this stage.", 403);
    const challenge = b64u(crypto.getRandomValues(new Uint8Array(32)));
    await env.DB.batch([
      env.DB.prepare(`UPDATE webauthn_challenges SET used_at = datetime('now') WHERE purpose = 'register' AND user_id = ?1 AND used_at IS NULL`).bind(me.id),
      env.DB.prepare(`INSERT INTO webauthn_challenges (id, purpose, user_id, session_hash, challenge, expires_at) VALUES (?1, 'register', ?2, ?3, ?4, datetime('now', '+${TTL_MIN} minutes'))`)
        .bind(crypto.randomUUID(), me.id, sessHash, challenge),
    ]);
    const existing = (await env.DB.prepare(`SELECT credential_id, transports FROM webauthn_credentials WHERE user_id = ?1 AND revoked_at IS NULL`).bind(me.id).all<{ credential_id: string; transports: string | null }>()).results;
    return j({ publicKey: {
      challenge, rp: { id: rp.rpId, name: "A2Z OS" },
      user: { id: await userHandle(env, me.id), name: acct.email, displayName: acct.name },
      pubKeyCredParams: ALGS.map((alg) => ({ type: "public-key", alg })),
      timeout: TTL_MIN * 60_000, attestation: "none",
      authenticatorSelection: { residentKey: "required", requireResidentKey: true, userVerification: "required" },
      excludeCredentials: existing.map((x) => ({ type: "public-key", id: x.credential_id, ...(x.transports ? { transports: x.transports.split(",") } : {}) })),
    } });
  }

  if (path === `${PK_PATH}/register/verify` && method === "POST") {
    if (st.stage === "off") return e("passkeys_off", "Passkeys are not switched on.", 409);
    if (!canAdd) return e("forbidden", "Passkeys are not available for your account at this stage.", 403);
    const ch = await env.DB.prepare(
      `SELECT id, challenge FROM webauthn_challenges WHERE purpose = 'register' AND user_id = ?1 AND session_hash = ?2 AND used_at IS NULL AND expires_at > datetime('now') ORDER BY created_at DESC LIMIT 1`,
    ).bind(me.id, sessHash).first<{ id: string; challenge: string }>();
    if (!ch) return e("challenge_expired", "This took too long - start again (a new authenticator code is needed).", 401);
    const v = await verifyRegistration((body?.credential ?? {}) as Parameters<typeof verifyRegistration>[0], { challenge: ch.challenge, origins: rp.origins, rpId: rp.rpId });
    if (!v.ok) {
      await env.DB.prepare(`UPDATE webauthn_challenges SET used_at = datetime('now') WHERE id = ?1`).bind(ch.id).run();
      await audit(env, me.id, "auth.passkey_add_refused", "users", String(me.id), { reason: v.reason });
      return e("passkey_not_verified", "That passkey could not be added - start again.", 400);
    }
    const name = (typeof body?.name === "string" ? body.name.replace(/[\u0000-\u001f]/g, "").trim().slice(0, 60) : "") || "Passkey";
    try {
      await env.DB.batch([
        env.DB.prepare(`UPDATE webauthn_challenges SET used_at = datetime('now') WHERE id = ?1 AND used_at IS NULL AND expires_at > datetime('now')`).bind(ch.id),
        assertOne(env),
        env.DB.prepare(
          `INSERT INTO webauthn_credentials (user_id, credential_id, public_key, alg, sign_count, aaguid, transports, backup_eligible, name)
           SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9 WHERE (SELECT COUNT(*) FROM webauthn_credentials WHERE user_id = ?1 AND revoked_at IS NULL) < ${MAX_PASSKEYS}`,
        ).bind(me.id, v.credentialId, v.publicKey, v.alg, v.signCount, v.aaguid, v.transports.join(",") || null, v.backupEligible ? 1 : 0, name),
        assertOne(env),
        clearAsserts(env),
      ]);
    } catch (x) {
      const dup = /UNIQUE/i.test(String(x));
      return e(dup ? "already_added" : "changed_meanwhile", dup ? "That passkey is already on an account." : "Something changed meanwhile - start again.", 409);
    }
    const id = (await env.DB.prepare(`SELECT id FROM webauthn_credentials WHERE credential_id = ?1`).bind(v.credentialId).first<{ id: number }>())?.id;
    await audit(env, me.id, "auth.passkey_added", "webauthn_credentials", String(id), { name, synced: v.backupEligible, alg: v.alg });
    const tellWho = inStage?.is_owner ? "the COO" : "the CEO";
    const notice = `A passkey "${name}" was added to your A2Z OS account. If this was not you, remove it in Profile -> Security and tell ${tellWho} at once.`;
    try { await notify(env, me.id, "security", notice, `passkey_added:${id}`); } catch { /* a notice never decides */ }
    if (mailReady(env)) { try { await sendMail(env, { to: me.email, subject: "A2Z OS: a passkey was added to your account", text: notice }); } catch { /* a notice never decides */ } }
    return j({ ok: true, id, name });
  }

  const m = path.match(/^\/api\/v1\/auth\/passkeys\/(\d{1,9})\/(rename|remove)$/);
  if (m && method === "POST") {
    const id = Number(m[1]);
    const row = await env.DB.prepare(`SELECT id, name FROM webauthn_credentials WHERE id = ?1 AND user_id = ?2 AND revoked_at IS NULL`).bind(id, me.id).first<{ id: number; name: string }>();
    if (!row) return e("not_found", "No such passkey on your account.", 404);
    if (m[2] === "rename") {
      const name = typeof body?.name === "string" ? body.name.replace(/[\u0000-\u001f]/g, "").trim().slice(0, 60) : "";
      if (!name) return e("invalid_input", "Give the passkey a name (up to 60 characters).", 400);
      const r = await env.DB.prepare(`UPDATE webauthn_credentials SET name = ?3 WHERE id = ?1 AND user_id = ?2 AND revoked_at IS NULL`).bind(id, me.id, name).run();
      if ((r.meta?.changes ?? 0) !== 1) return e("not_found", "No such passkey on your account.", 404);
      await audit(env, me.id, "auth.passkey_renamed", "webauthn_credentials", String(id), { before: row.name, after: name });
      return j({ ok: true });
    }
    const su = await freshCode("remove this passkey");
    if (su) return su;
    const reason = typeof body?.reason === "string" ? body.reason.trim().slice(0, 200) : "";
    let ended = 0;
    try {
      const res = await env.DB.batch([
        env.DB.prepare(`UPDATE webauthn_credentials SET revoked_at = datetime('now'), revoked_by = ?2, revoked_reason = ?3 WHERE id = ?1 AND user_id = ?2 AND revoked_at IS NULL`).bind(id, me.id, reason || "removed by the account holder"),
        assertOne(env),
        env.DB.prepare(`DELETE FROM sessions WHERE user_id = ?1 AND auth_credential_id = ?2`).bind(me.id, id),
        clearAsserts(env),
      ]);
      ended = res[2]?.meta?.changes ?? 0;
    } catch { return e("changed_meanwhile", "That passkey was already removed.", 409); }
    await audit(env, me.id, "auth.passkey_removed", "webauthn_credentials", String(id), { name: row.name, sessions_ended: ended, ...(reason ? { reason } : {}) });
    try { await notify(env, me.id, "security", `The passkey "${row.name}" was removed from your account${ended ? ` and ${ended} device(s) it signed in were signed out` : ""}.`, `passkey_removed:${id}`); } catch { /* a notice never decides */ }
    return j({ ok: true, sessions_ended: ended });
  }

  return e("not_found", "Not found", 404);
}

/** PUT /staff/auth/settings/passkeys - the company owner alone, a reason and a fresh code.
    body: { stage: off | A | B | C, pilot_user_ids?: number[] (stage B: 1 to 10 staff or agents), reason, totp } */
export async function setPasskeyStage(env: Env, user: Me, body: Record<string, unknown> | null): Promise<Response> {
  if (user.role !== "ceo" || user.is_owner !== true) return e("forbidden", "Only the company owner changes how people sign in", 403);
  const stage = body?.stage;
  if (!(STAGES as readonly unknown[]).includes(stage)) return e("invalid_input", "stage is \"off\", \"A\", \"B\" or \"C\"", 400);
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  if (reason.length < 5 || reason.length > 300) return e("invalid_input", "Give a reason (5 to 300 characters)", 400);
  if (!(await tableReady(env))) return e("migration_missing", "Run migration 0178 first (PUSH.bat).", 503);
  const before = await passkeySettings(env);
  /* the pilot list: named for stage B, kept as it was otherwise */
  let pilots = before.pilot_user_ids;
  if (body && "pilot_user_ids" in body) {
    const raw = body.pilot_user_ids;
    if (!Array.isArray(raw) || raw.length > MAX_PILOTS || !raw.every((x) => Number.isInteger(x) && x > 0)) return e("invalid_input", `pilot_user_ids is a list of up to ${MAX_PILOTS} account ids`, 400);
    pilots = [...new Set(raw as number[])];
    for (const id of pilots) {
      const ok = await env.DB.prepare(`SELECT 1 FROM users WHERE id = ?1 AND role != 'customer' AND ${STILL_OK}`).bind(id).first();
      if (!ok) return e("invalid_pilot", `Account ${id} cannot be a passkey pilot: only active staff and agents.`, 400);
    }
  }
  if (stage === "B" && pilots.length === 0) return e("pilot_required", "Name at least one pilot for stage B.", 400);
  const t = await env.DB.prepare(`SELECT COALESCE(totp_enabled, 0) AS t FROM users WHERE id = ?1`).bind(user.id).first<{ t: number }>();
  if (!t?.t) return e("twofa_required", "Two-factor must be on for this.", 403);
  const stepUp = await requireFreshTotp(env, user, body?.totp, e, "change how people sign in");
  if (stepUp) return stepUp;
  /* Phase R first: passkeys only while the executive recovery panel can act */
  if (stage !== "off" && before.stage === "off") {
    const n = await activePanelCount(env);
    if (n < 2) return e("recovery_panel_not_ready", `Passkeys need the executive recovery panel ready first: two members who can act (now ${n}).`, 409);
  }
  const after = { stage, pilot_user_ids: pilots };
  await env.DB.prepare(`INSERT INTO business_settings (key, value, updated_by, updated_at) VALUES ('auth_passkeys', ?1, ?2, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at`)
    .bind(JSON.stringify(after), user.id).run();
  await audit(env, user.id, "auth.settings_passkeys", "business_settings", "auth_passkeys", { before: { stage: before.stage, pilot_user_ids: before.pilot_user_ids }, after, reason });
  return j({ ok: true, passkeys: await passkeySettings(env) });
}

/** Sign-in settings (CEO, Super Admin): who could use passkeys, and who has one -
    names, roles and counts only, never a key. */
export async function passkeyRoster(env: Env): Promise<{ id: number; name: string; role: string; two_factor: boolean; passkeys: number }[]> {
  if (!(await tableReady(env))) return [];
  return (await env.DB.prepare(
    `SELECT u.id, COALESCE(NULLIF(TRIM(u.full_name), ''), u.name) AS name, u.role, COALESCE(u.totp_enabled, 0) AS two_factor,
            (SELECT COUNT(*) FROM webauthn_credentials w WHERE w.user_id = u.id AND w.revoked_at IS NULL) AS passkeys
     FROM users u WHERE u.role != 'customer' AND u.is_active = 1 AND COALESCE(u.employment_status, '') NOT IN ('resigned', 'terminated') ORDER BY u.id`,
  ).all<{ id: number; name: string; role: string; two_factor: number; passkeys: number }>()).results
    .map((r) => ({ id: r.id, name: r.name, role: r.role, two_factor: r.two_factor === 1, passkeys: Number(r.passkeys) }));
}
