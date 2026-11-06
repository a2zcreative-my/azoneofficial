/* v1.269.0 - SECURE AUTHENTICATION 2.0, PHASE 2A: WEBAUTHN VERIFICATION
   (claude/AUTH-2.0-AUDIT.md revision 3). The checks a relying party must make
   (W3C WebAuthn Level 2, sec. 7.1 and 7.2), on WebCrypto, with no dependency:
   the worker has no npm runtime dependency and every guard bundles a bare
   copy of worker/ (rev 3 named @simplewebauthn/server; the same reason as
   google-oidc.ts). Each failure is named for the audit; the person sees one
   neutral sentence.

   Supported: ES256 (-7, P-256 - Apple, Google, Android, most keys) and RS256
   (-257 - Windows Hello). Attestation is not used ("none" requested, any
   statement ignored): A2Z trusts the person's own device, not a vendor list.
   User verification (Face ID, fingerprint, PIN) is REQUIRED every time. */

const enc = new TextEncoder();
export const ALGS = [-7, -257] as const;

export function b64u(bytes: ArrayBuffer | Uint8Array): string {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function unb64u(s: string): Uint8Array {
  if (typeof s !== "string" || !/^[A-Za-z0-9_-]*$/.test(s)) throw new Error("not base64url");
  const p = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bin = atob(p);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const sha256 = async (b: Uint8Array) => new Uint8Array(await crypto.subtle.digest("SHA-256", b));
const eq = (a: Uint8Array, b: Uint8Array) => { if (a.length !== b.length) return false; let x = 0; for (let i = 0; i < a.length; i++) x |= a[i]! ^ b[i]!; return x === 0; };

/* ---- a minimal, strict CBOR reader (RFC 8949): what WebAuthn uses ---- */
type Cbor = number | bigint | string | Uint8Array | Cbor[] | Map<Cbor, Cbor> | boolean | null | undefined;
function cborRead(buf: Uint8Array, start = 0): { value: Cbor; end: number } {
  let p = start;
  const need = (n: number) => { if (p + n > buf.length) throw new Error("cbor: truncated"); };
  const readLen = (info: number): number => {
    if (info < 24) return info;
    if (info === 24) { need(1); return buf[p++]!; }
    if (info === 25) { need(2); const v = (buf[p]! << 8) | buf[p + 1]!; p += 2; return v; }
    if (info === 26) { need(4); const v = ((buf[p]! << 24) >>> 0) + (buf[p + 1]! << 16) + (buf[p + 2]! << 8) + buf[p + 3]!; p += 4; return v; }
    throw new Error("cbor: unsupported length");
  };
  const item = (depth: number): Cbor => {
    if (depth > 16) throw new Error("cbor: too deep");
    need(1);
    const b = buf[p++]!;
    const major = b >> 5, info = b & 31;
    switch (major) {
      case 0: return readLen(info);
      case 1: return -1 - readLen(info);
      case 2: { const n = readLen(info); need(n); const v = buf.slice(p, p + n); p += n; return v; }
      case 3: { const n = readLen(info); need(n); const v = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(buf.slice(p, p + n)); p += n; return v; }
      case 4: { const n = readLen(info); if (n > 64) throw new Error("cbor: array too long"); const a: Cbor[] = []; for (let i = 0; i < n; i++) a.push(item(depth + 1)); return a; }
      case 5: { const n = readLen(info); if (n > 64) throw new Error("cbor: map too long"); const m = new Map<Cbor, Cbor>(); for (let i = 0; i < n; i++) { const k = item(depth + 1); m.set(k, item(depth + 1)); } return m; }
      case 7: { if (info === 20) return false; if (info === 21) return true; if (info === 22) return null; throw new Error("cbor: unsupported simple"); }
      default: throw new Error("cbor: unsupported type");
    }
  };
  const value = item(0);
  return { value, end: p };
}

/* ---- authenticator data (WebAuthn sec. 6.1) ---- */
export interface AuthData { rpIdHash: Uint8Array; up: boolean; uv: boolean; be: boolean; bs: boolean; at: boolean; signCount: number; aaguid?: string; credentialId?: Uint8Array; coseKey?: Uint8Array }
export function parseAuthData(d: Uint8Array): AuthData {
  if (d.length < 37) throw new Error("authData: short");
  const flags = d[32]!;
  const out: AuthData = {
    rpIdHash: d.slice(0, 32), up: !!(flags & 0x01), uv: !!(flags & 0x04), be: !!(flags & 0x08), bs: !!(flags & 0x10), at: !!(flags & 0x40),
    signCount: ((d[33]! << 24) >>> 0) + (d[34]! << 16) + (d[35]! << 8) + d[36]!,
  };
  if (out.at) {
    if (d.length < 55) throw new Error("authData: no credential");
    const aaguid = d.slice(37, 53);
    const len = (d[53]! << 8) | d[54]!;
    if (len < 16 || len > 1023 || d.length < 55 + len) throw new Error("authData: bad credential id");
    out.aaguid = [...aaguid].map((x) => x.toString(16).padStart(2, "0")).join("");
    out.credentialId = d.slice(55, 55 + len);
    const { end } = cborRead(d, 55 + len);
    out.coseKey = d.slice(55 + len, end);
  }
  return out;
}

/* ---- COSE public keys (RFC 9053) -> WebCrypto ---- */
export async function importCose(cose: Uint8Array): Promise<{ key: CryptoKey; alg: number }> {
  const m = cborRead(cose).value;
  if (!(m instanceof Map)) throw new Error("cose: not a map");
  const kty = m.get(1), alg = m.get(3);
  if (alg === -7 && kty === 2) {
    const crv = m.get(-1), x = m.get(-2), y = m.get(-3);
    if (crv !== 1 || !(x instanceof Uint8Array) || !(y instanceof Uint8Array) || x.length !== 32 || y.length !== 32) throw new Error("cose: bad EC2 key");
    const key = await crypto.subtle.importKey("jwk", { kty: "EC", crv: "P-256", x: b64u(x), y: b64u(y), ext: true }, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    return { key, alg };
  }
  if (alg === -257 && kty === 3) {
    const n = m.get(-1), e = m.get(-2);
    if (!(n instanceof Uint8Array) || !(e instanceof Uint8Array) || n.length < 256) throw new Error("cose: bad RSA key");
    const key = await crypto.subtle.importKey("jwk", { kty: "RSA", n: b64u(n), e: b64u(e), alg: "RS256", ext: true }, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    return { key, alg };
  }
  throw new Error("cose: unsupported algorithm");
}
/** An ECDSA signature arrives DER-encoded; WebCrypto wants r || s. */
function derToRaw(der: Uint8Array): Uint8Array {
  let p = 0;
  const take = () => { if (p >= der.length) throw new Error("der: short"); return der[p++]!; };
  if (take() !== 0x30) throw new Error("der: not a sequence");
  let len = take(); if (len & 0x80) { const n = len & 0x7f; len = 0; for (let i = 0; i < n; i++) len = (len << 8) | take(); }
  const int = () => {
    if (take() !== 0x02) throw new Error("der: not an integer");
    const n = take(); if (n > 33 || p + n > der.length) throw new Error("der: bad integer");
    let v = der.slice(p, p + n); p += n;
    while (v.length > 32 && v[0] === 0) v = v.slice(1);
    if (v.length > 32) throw new Error("der: integer too long");
    const out = new Uint8Array(32); out.set(v, 32 - v.length); return out;
  };
  const r = int(), s = int();
  const raw = new Uint8Array(64); raw.set(r, 0); raw.set(s, 32); return raw;
}

type ClientData = { type?: string; challenge?: string; origin?: string; crossOrigin?: boolean };
function clientData(json: Uint8Array): ClientData {
  const v = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(json)) as unknown;
  if (!v || typeof v !== "object") throw new Error("clientData: not an object");
  return v as ClientData;
}
const checkClient = (c: ClientData, type: string, challenge: string, origins: string[]): string | null => {
  if (c.type !== type) return "client_type";
  if (typeof c.challenge !== "string" || !eq(enc.encode(c.challenge), enc.encode(challenge))) return "client_challenge";
  if (typeof c.origin !== "string" || !origins.includes(c.origin)) return "client_origin";
  if (c.crossOrigin === true) return "client_cross_origin";
  return null;
};

/** A new passkey (navigator.credentials.create): sec. 7.1. */
export async function verifyRegistration(
  resp: { id?: unknown; rawId?: unknown; type?: unknown; response?: { clientDataJSON?: unknown; attestationObject?: unknown; transports?: unknown } },
  opts: { challenge: string; origins: string[]; rpId: string },
): Promise<{ ok: true; credentialId: string; publicKey: string; alg: number; signCount: number; aaguid: string | null; backupEligible: boolean; transports: string[] } | { ok: false; reason: string }> {
  try {
    if (resp?.type !== "public-key" || typeof resp.id !== "string" || typeof resp.response?.clientDataJSON !== "string" || typeof resp.response.attestationObject !== "string") return { ok: false, reason: "malformed" };
    const cdj = unb64u(resp.response.clientDataJSON);
    const bad = checkClient(clientData(cdj), "webauthn.create", opts.challenge, opts.origins);
    if (bad) return { ok: false, reason: bad };
    const att = cborRead(unb64u(resp.response.attestationObject)).value;
    if (!(att instanceof Map) || !(att.get("authData") instanceof Uint8Array)) return { ok: false, reason: "attestation_malformed" };
    const ad = parseAuthData(att.get("authData") as Uint8Array);
    if (!eq(ad.rpIdHash, await sha256(enc.encode(opts.rpId)))) return { ok: false, reason: "rp_id" };
    if (!ad.up) return { ok: false, reason: "user_not_present" };
    if (!ad.uv) return { ok: false, reason: "user_not_verified" };
    if (!ad.at || !ad.credentialId || !ad.coseKey) return { ok: false, reason: "no_credential" };
    if (b64u(ad.credentialId) !== resp.id) return { ok: false, reason: "credential_id_mismatch" };
    const { alg } = await importCose(ad.coseKey); // refuses anything but ES256 / RS256
    const tr = Array.isArray(resp.response.transports) ? (resp.response.transports as unknown[]).filter((x): x is string => typeof x === "string" && /^[a-z-]{2,20}$/.test(x)).slice(0, 6) : [];
    return { ok: true, credentialId: resp.id, publicKey: b64u(ad.coseKey), alg, signCount: ad.signCount, aaguid: ad.aaguid ?? null, backupEligible: ad.be, transports: tr };
  } catch (e) {
    return { ok: false, reason: `malformed:${String(e instanceof Error ? e.message : e).slice(0, 40)}` };
  }
}

/** A sign-in (navigator.credentials.get): sec. 7.2. */
export async function verifyAssertion(
  resp: { id?: unknown; type?: unknown; response?: { clientDataJSON?: unknown; authenticatorData?: unknown; signature?: unknown; userHandle?: unknown } },
  cred: { credential_id: string; public_key: string; alg: number; sign_count: number; user_handle: string },
  opts: { challenge: string; origins: string[]; rpId: string },
): Promise<{ ok: true; signCount: number } | { ok: false; reason: string }> {
  try {
    if (resp?.type !== "public-key" || resp.id !== cred.credential_id) return { ok: false, reason: "malformed" };
    const r = resp.response;
    if (typeof r?.clientDataJSON !== "string" || typeof r.authenticatorData !== "string" || typeof r.signature !== "string") return { ok: false, reason: "malformed" };
    const cdj = unb64u(r.clientDataJSON);
    const bad = checkClient(clientData(cdj), "webauthn.get", opts.challenge, opts.origins);
    if (bad) return { ok: false, reason: bad };
    if (typeof r.userHandle === "string" && r.userHandle !== "" && r.userHandle !== cred.user_handle) return { ok: false, reason: "user_handle" };
    const adBytes = unb64u(r.authenticatorData);
    const ad = parseAuthData(adBytes);
    if (!eq(ad.rpIdHash, await sha256(enc.encode(opts.rpId)))) return { ok: false, reason: "rp_id" };
    if (!ad.up) return { ok: false, reason: "user_not_present" };
    if (!ad.uv) return { ok: false, reason: "user_not_verified" };
    const { key, alg } = await importCose(unb64u(cred.public_key));
    if (alg !== cred.alg) return { ok: false, reason: "alg" };
    const signed = new Uint8Array(adBytes.length + 32);
    signed.set(adBytes, 0); signed.set(await sha256(cdj), adBytes.length);
    const sig = unb64u(r.signature);
    const good = alg === -7
      ? await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, derToRaw(sig), signed)
      : await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, sig, signed);
    if (!good) return { ok: false, reason: "signature" };
    /* a counter that does not move forward on a key that counts = a cloned key */
    if ((ad.signCount !== 0 || cred.sign_count !== 0) && ad.signCount <= cred.sign_count) return { ok: false, reason: "sign_count" };
    return { ok: true, signCount: ad.signCount };
  } catch (e) {
    return { ok: false, reason: `malformed:${String(e instanceof Error ? e.message : e).slice(0, 40)}` };
  }
}
