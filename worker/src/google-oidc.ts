/* v1.265.0 - SECURE AUTHENTICATION 2.0, PHASE 1b: GOOGLE OPENID CONNECT
   (claude/AUTH-2.0-AUDIT.md rev 3 sec. 3.2, approved by phase).

   Google sign-in used to trust the userinfo endpoint after a plain code
   exchange. Now:
     - the request carries PKCE (S256), a nonce and a state, all kept on the
       server (oauth_requests, migration 0174) and tied to this browser by an
       HttpOnly binding cookie;
     - the answer is Google's signed ID TOKEN, verified here: RS256 only,
       against Google's published keys (the JWKS the discovery document
       names), iss, aud, azp, exp / iat / nbf (60 s of clock tolerance) and the
       nonce. `sub` is the identity.
   PKCE is never dropped silently (F6): if Google's discovery document does
   not advertise S256, Google sign-in stops and says so in the error log.

   No new dependency. Rev 3 named the jose library; the worker has no npm
   runtime dependency at all, and every guard bundles it from a bare copy of
   worker/ - so the check is written on WebCrypto, which Workers provide,
   RS256 only, with a test for each way a token can be wrong
   (tests/go-live-x.mjs). */

export const GOOGLE_DISCOVERY = "https://accounts.google.com/.well-known/openid-configuration";
export const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];
const SKEW = 60; // seconds of clock tolerance

export interface GoogleDiscovery { issuer: string; authorization_endpoint: string; token_endpoint: string; jwks_uri: string }
export interface GoogleClaims { sub: string; email?: string; email_verified?: boolean; name?: string; iss: string; aud: string | string[]; azp?: string; exp: number; iat: number; nonce?: string }

const enc = new TextEncoder();
export function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function unb64url(s: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) throw new Error("not base64url");
  const p = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bin = atob(p);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const fromJson = (part: string): Record<string, unknown> => {
  const v = JSON.parse(new TextDecoder().decode(unb64url(part))) as unknown;
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("not an object");
  return v as Record<string, unknown>;
};

/** A PKCE pair: a 43-character verifier and its S256 challenge (RFC 7636). */
export async function pkcePair(): Promise<{ verifier: string; challenge: string }> {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = b64url(await crypto.subtle.digest("SHA-256", enc.encode(verifier)));
  return { verifier, challenge };
}

/* Google's documents, kept for an hour in this isolate. */
let discCache: { at: number; d: GoogleDiscovery } | null = null;
let jwksCache: { at: number; uri: string; keys: JsonWebKey[] } | null = null;
const HOUR = 3600_000;
const googleHost = (u: string) => { try { const x = new URL(u); return x.protocol === "https:" && /(^|\.)(google\.com|googleapis\.com)$/.test(x.hostname); } catch { return false; } };

/** Google's discovery document - or why Google sign-in must not start. */
export async function googleDiscovery(): Promise<{ ok: true; d: GoogleDiscovery } | { ok: false; reason: string }> {
  if (discCache && Date.now() - discCache.at < HOUR) return { ok: true, d: discCache.d };
  let j: Record<string, unknown> | null = null;
  try {
    const r = await fetch(GOOGLE_DISCOVERY, { headers: { accept: "application/json" } });
    j = r.ok ? (await r.json()) as Record<string, unknown> : null;
  } catch { j = null; }
  if (!j) return { ok: false, reason: "discovery_unreachable" };
  const methods = Array.isArray(j.code_challenge_methods_supported) ? j.code_challenge_methods_supported : [];
  /* F6 - never silently without PKCE */
  if (!methods.includes("S256")) return { ok: false, reason: "pkce_s256_not_advertised" };
  const algs = Array.isArray(j.id_token_signing_alg_values_supported) ? j.id_token_signing_alg_values_supported : [];
  if (!algs.includes("RS256")) return { ok: false, reason: "rs256_not_advertised" };
  const d = { issuer: String(j.issuer ?? ""), authorization_endpoint: String(j.authorization_endpoint ?? ""), token_endpoint: String(j.token_endpoint ?? ""), jwks_uri: String(j.jwks_uri ?? "") };
  if (!GOOGLE_ISSUERS.includes(d.issuer) || ![d.authorization_endpoint, d.token_endpoint, d.jwks_uri].every(googleHost)) return { ok: false, reason: "discovery_unexpected" };
  discCache = { at: Date.now(), d };
  return { ok: true, d };
}

async function googleKeys(uri: string, fresh = false): Promise<JsonWebKey[]> {
  if (!fresh && jwksCache && jwksCache.uri === uri && Date.now() - jwksCache.at < HOUR) return jwksCache.keys;
  const r = await fetch(uri, { headers: { accept: "application/json" } });
  const j = r.ok ? (await r.json().catch(() => null)) as { keys?: JsonWebKey[] } | null : null;
  const keys = Array.isArray(j?.keys) ? j!.keys! : [];
  jwksCache = { at: Date.now(), uri, keys };
  return keys;
}

const eqConst = (a: string, b: string) => {
  if (a.length !== b.length) return false;
  let x = 0;
  for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return x === 0;
};

/** Verify a Google ID token. Every reason it can fail is named, for the
    audit row; the person only ever sees the one neutral sentence. */
export async function verifyGoogleIdToken(
  idToken: string, opts: { clientId: string; nonce: string; jwksUri: string },
): Promise<{ ok: true; claims: GoogleClaims } | { ok: false; reason: string }> {
  const parts = typeof idToken === "string" ? idToken.split(".") : [];
  if (parts.length !== 3 || idToken.length > 8192) return { ok: false, reason: "token_malformed" };
  let header: Record<string, unknown>, payload: Record<string, unknown>;
  try { header = fromJson(parts[0]!); payload = fromJson(parts[1]!); } catch { return { ok: false, reason: "token_malformed" }; }
  /* RS256 and nothing else: no "none", no HS256 with the public key */
  if (header.alg !== "RS256") return { ok: false, reason: "token_alg" };
  if (typeof header.kid !== "string" || !header.kid) return { ok: false, reason: "token_kid" };
  const pick = (keys: JsonWebKey[]) => keys.find((k) => (k as { kid?: string }).kid === header.kid && k.kty === "RSA" && (!k.alg || k.alg === "RS256") && (!(k as { use?: string }).use || (k as { use?: string }).use === "sig"));
  let jwk: JsonWebKey | undefined;
  try {
    jwk = pick(await googleKeys(opts.jwksUri));
    if (!jwk) jwk = pick(await googleKeys(opts.jwksUri, true)); // Google rotated its keys
  } catch { return { ok: false, reason: "jwks_unreachable" }; }
  if (!jwk?.n || !jwk.e) return { ok: false, reason: "token_kid" };
  let good = false;
  try {
    const key = await crypto.subtle.importKey("jwk", { kty: "RSA", n: jwk.n, e: jwk.e, alg: "RS256", ext: true }, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    good = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, unb64url(parts[2]!), enc.encode(`${parts[0]}.${parts[1]}`));
  } catch { good = false; }
  if (!good) return { ok: false, reason: "token_signature" };

  const c = payload as unknown as GoogleClaims & { nbf?: number };
  if (typeof c.iss !== "string" || !GOOGLE_ISSUERS.includes(c.iss)) return { ok: false, reason: "token_iss" };
  const auds = Array.isArray(c.aud) ? c.aud : [c.aud];
  if (!auds.includes(opts.clientId)) return { ok: false, reason: "token_aud" };
  /* a token for several audiences must name us as the party it was issued to */
  if ((auds.length > 1 || c.azp !== undefined) && c.azp !== opts.clientId) return { ok: false, reason: "token_azp" };
  const now = Math.floor(Date.now() / 1000);
  if (typeof c.exp !== "number" || c.exp + SKEW < now) return { ok: false, reason: "token_expired" };
  if (typeof c.iat !== "number" || c.iat - SKEW > now) return { ok: false, reason: "token_iat" };
  if (c.nbf !== undefined && (typeof c.nbf !== "number" || c.nbf - SKEW > now)) return { ok: false, reason: "token_nbf" };
  if (typeof c.nonce !== "string" || !eqConst(c.nonce, opts.nonce)) return { ok: false, reason: "token_nonce" };
  if (typeof c.sub !== "string" || !c.sub || c.sub.length > 255) return { ok: false, reason: "token_sub" };
  return { ok: true, claims: c };
}
