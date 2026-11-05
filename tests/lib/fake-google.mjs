/* A FAKE GOOGLE for the runtime guards (v1.265.0, Secure Authentication 2.0
 * Phase 1b). It plays Google's OpenID Connect side exactly as the worker
 * sees it: the discovery document, the published keys (JWKS), the token
 * endpoint that checks the PKCE verifier against the challenge it was given,
 * and ID tokens signed with a locally generated RSA key. Each way a token can
 * be wrong is a hook, so the guard proves the worker refuses it.
 *
 *   const G = fakeGoogle({ clientId: "cid" });
 *   globalThis.fetch = (u, i) => G.fetch(u, i) ?? realFetch(u, i);
 *   const { code, state } = G.authorize(locationOfTheStart, { sub, email });
 */
import { generateKeyPairSync, createSign, createHash, randomBytes, createHmac } from "node:crypto";

export const DISCOVERY = "https://accounts.google.com/.well-known/openid-configuration";
export const JWKS = "https://www.googleapis.com/oauth2/v3/certs";
export const TOKEN = "https://oauth2.googleapis.com/token";
export const AUTHZ = "https://accounts.google.com/o/oauth2/v2/auth";

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");

export function fakeGoogle({ clientId = "cid" } = {}) {
  const key = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const other = generateKeyPairSync("rsa", { modulusLength: 2048 }); // a key Google never published
  const jwk = { ...key.publicKey.export({ format: "jwk" }), kid: "k1", alg: "RS256", use: "sig" };
  const G = {
    s256: true,             // does the discovery document advertise S256?
    discoveryDown: false,
    codes: new Map(),       // code -> { challenge, claims }
    tamper: null,           // (claims) => claims, before signing
    token: null,            // (claims, sign) => id_token string, replaces the normal one
    refuseVerifier: false,  // the token endpoint refuses whatever verifier comes
    tokenCalls: [],
    sign(claims, header = { alg: "RS256", kid: "k1", typ: "JWT" }, which = "good") {
      const h = b64(header), p = b64(claims);
      const s = createSign("RSA-SHA256").update(`${h}.${p}`).sign((which === "other" ? other : key).privateKey).toString("base64url");
      return `${h}.${p}.${s}`;
    },
    hs256(claims) { // an HS256 token "signed" with the public key - the classic confusion attack
      const h = b64({ alg: "HS256", kid: "k1", typ: "JWT" }), p = b64(claims);
      const s = createHmac("sha256", JSON.stringify(jwk)).update(`${h}.${p}`).digest("base64url");
      return `${h}.${p}.${s}`;
    },
    none(claims) { return `${b64({ alg: "none", typ: "JWT" })}.${b64(claims)}.`; },
    /** The person picks their Google account: Google sends them back with a code. */
    authorize(location, { sub, email, email_verified = true, name = "G" }) {
      const u = new URL(location);
      const now = Math.floor(Date.now() / 1000);
      const code = `c-${randomBytes(8).toString("hex")}`;
      G.codes.set(code, {
        challenge: u.searchParams.get("code_challenge"),
        method: u.searchParams.get("code_challenge_method"),
        claims: { iss: "https://accounts.google.com", aud: clientId, azp: clientId, sub, email, email_verified, name, nonce: u.searchParams.get("nonce"), iat: now, exp: now + 3600 },
      });
      return { code, state: u.searchParams.get("state"), url: u };
    },
    /** Answer the worker's fetch, or null when the URL is not Google's. */
    async fetch(input, init) {
      const url = String(input instanceof Request ? input.url : input);
      if (url === DISCOVERY) {
        if (G.discoveryDown) return new Response("down", { status: 503 });
        return new Response(JSON.stringify({
          issuer: "https://accounts.google.com", authorization_endpoint: AUTHZ, token_endpoint: TOKEN, jwks_uri: JWKS,
          response_types_supported: ["code", "id_token", "code id_token"], id_token_signing_alg_values_supported: ["RS256"],
          code_challenge_methods_supported: G.s256 ? ["plain", "S256"] : ["plain"],
        }), { status: 200 });
      }
      if (url === JWKS) return new Response(JSON.stringify({ keys: [jwk] }), { status: 200 });
      if (url === TOKEN) {
        const body = new URLSearchParams(String(init?.body ?? ""));
        G.tokenCalls.push(Object.fromEntries(body));
        const entry = G.codes.get(body.get("code"));
        if (!entry) return new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 });
        G.codes.delete(body.get("code")); // a code is spent once, as at Google
        const v = body.get("code_verifier") ?? "";
        const want = createHash("sha256").update(v).digest("base64url");
        if (G.refuseVerifier || entry.method !== "S256" || !v || want !== entry.challenge || body.get("client_id") !== clientId) {
          return new Response(JSON.stringify({ error: "invalid_grant", error_description: "code_verifier" }), { status: 400 });
        }
        const claims = G.tamper ? G.tamper({ ...entry.claims }) : entry.claims;
        const id_token = G.token ? G.token(claims, G) : G.sign(claims);
        return new Response(JSON.stringify({ access_token: "at", id_token, token_type: "Bearer", expires_in: 3599 }), { status: 200 });
      }
      if (url.startsWith("https://www.googleapis.com/oauth2/v3/userinfo")) return new Response(JSON.stringify({ error: "the worker must not use userinfo any more" }), { status: 410 });
      return null;
    },
  };
  return G;
}
