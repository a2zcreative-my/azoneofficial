/**
 * v1.6.0 — Web Push (RFC 8291 message encryption + RFC 8292 VAPID), implemented
 * on Web Crypto so it runs inside a Cloudflare Worker with no dependencies.
 *
 * Setup (one time):
 *   npx web-push generate-vapid-keys
 * then set the three secrets on the Worker:
 *   wrangler secret put VAPID_PUBLIC_KEY     # the base64url "Public Key"
 *   wrangler secret put VAPID_PRIVATE_KEY    # the base64url "Private Key"
 *   wrangler secret put VAPID_SUBJECT        # mailto:you@azoneofficial.com
 * The same VAPID_PUBLIC_KEY is handed to the browser (applicationServerKey).
 *
 * Everything here is best-effort: any failure returns a status and never throws
 * into the caller, so a dead subscription can never take down a notification.
 */

export interface PushKeys {
  publicKey: string;   // VAPID public (base64url, 65-byte P-256 point)
  privateKey: string;  // VAPID private (base64url, 32-byte scalar)
  subject: string;     // mailto: or https: contact
}

export interface PushSubscription {
  endpoint: string;
  p256dh: string;      // client public key (base64url)
  auth: string;        // client auth secret (base64url)
}

/* ---------- base64url <-> bytes ---------- */
function b64urlToBytes(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const b64 = (s + pad).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function bytesToB64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function concat(...arrs: Uint8Array[]): Uint8Array {
  const total = arrs.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
}
const utf8 = (s: string) => new TextEncoder().encode(s);

/* ---------- EC key helpers ---------- */
/** Build a JWK for a P-256 key from a raw 65-byte public point (+ optional
    32-byte private scalar). */
function jwkFromRaw(pub: Uint8Array, priv?: Uint8Array): JsonWebKey {
  const x = bytesToB64url(pub.slice(1, 33));
  const y = bytesToB64url(pub.slice(33, 65));
  const jwk: JsonWebKey = { kty: "EC", crv: "P-256", x, y, ext: true };
  if (priv) jwk.d = bytesToB64url(priv);
  return jwk;
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", ikm as unknown as BufferSource, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: salt as unknown as BufferSource, info: info as unknown as BufferSource },
    key,
    length * 8,
  );
  return new Uint8Array(bits);
}

/* ---------- VAPID JWT (RFC 8292, ES256) ---------- */
async function vapidAuthHeader(endpoint: string, keys: PushKeys): Promise<string> {
  const aud = new URL(endpoint).origin;
  const header = { typ: "JWT", alg: "ES256" };
  const payload = {
    aud,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: keys.subject,
  };
  const enc = (o: unknown) => bytesToB64url(utf8(JSON.stringify(o)));
  const signingInput = `${enc(header)}.${enc(payload)}`;

  const pubBytes = b64urlToBytes(keys.publicKey);
  const privBytes = b64urlToBytes(keys.privateKey);
  const signKey = await crypto.subtle.importKey(
    "jwk", jwkFromRaw(pubBytes, privBytes),
    { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"],
  );
  const sig = new Uint8Array(await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" }, signKey, utf8(signingInput),
  )); // Web Crypto already returns the 64-byte JOSE r||s form
  const jwt = `${signingInput}.${bytesToB64url(sig)}`;
  return `vapid t=${jwt}, k=${keys.publicKey}`;
}

/* ---------- aes128gcm payload (RFC 8291 + RFC 8188) ---------- */
async function encryptPayload(sub: PushSubscription, plaintext: Uint8Array): Promise<Uint8Array> {
  const uaPublic = b64urlToBytes(sub.p256dh);      // client public key
  const authSecret = b64urlToBytes(sub.auth);      // client auth secret
  const salt = crypto.getRandomValues(new Uint8Array(16));

  // Ephemeral application-server ECDH keypair (per message).
  const asKeyPair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"],
  ) as CryptoKeyPair;
  const asPublicRaw = new Uint8Array(await crypto.subtle.exportKey("raw", asKeyPair.publicKey));

  // ECDH shared secret with the client's public key.
  const uaPubKey = await crypto.subtle.importKey(
    "raw", uaPublic as unknown as BufferSource, { name: "ECDH", namedCurve: "P-256" }, false, [],
  );
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits(
    { name: "ECDH", public: uaPubKey }, asKeyPair.privateKey, 256,
  ));

  // RFC 8291: combine ECDH + auth secret.
  const keyInfo = concat(utf8("WebPush: info\0"), uaPublic, asPublicRaw);
  const ikm = await hkdf(authSecret, ecdhSecret, keyInfo, 32);

  // RFC 8188: derive CEK + nonce from the record salt.
  const cek = await hkdf(salt, ikm, utf8("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, utf8("Content-Encoding: nonce\0"), 12);

  // Single record: plaintext || 0x02 delimiter, then AES-128-GCM.
  const record = concat(plaintext, new Uint8Array([0x02]));
  const aesKey = await crypto.subtle.importKey("raw", cek as unknown as BufferSource, "AES-GCM", false, ["encrypt"]);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce as unknown as BufferSource }, aesKey, record as unknown as BufferSource,
  ));

  // RFC 8188 header: salt(16) | rs(4, uint32) | idlen(1) | keyid(asPublic 65).
  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, 4096);
  const header = concat(salt, rs, new Uint8Array([asPublicRaw.length]), asPublicRaw);
  return concat(header, ciphertext);
}

/** Send one push. Returns the HTTP status (or 0 on a local failure). A 404/410
    means the subscription is dead and the caller should delete it. */
export async function sendPush(
  keys: PushKeys,
  sub: PushSubscription,
  payload: Record<string, unknown>,
): Promise<number> {
  try {
    const body = await encryptPayload(sub, utf8(JSON.stringify(payload)));
    const res = await fetch(sub.endpoint, {
      method: "POST",
      headers: {
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        "TTL": "86400",
        "Authorization": await vapidAuthHeader(sub.endpoint, keys),
      },
      body: body as unknown as BodyInit,
    });
    return res.status;
  } catch {
    return 0;
  }
}
