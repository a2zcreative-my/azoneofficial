/**
 * v1.269.0 - Secure Authentication 2.0, Phase 2A: the browser half of a
 * passkey (worker/src/passkeys.ts holds every rule). The worker sends the
 * WebAuthn options as JSON with base64url bytes; the browser API wants
 * ArrayBuffers - and its answer goes back the same way. Nothing here decides
 * anything: the device asks for Face ID, a fingerprint or the PIN, and the
 * worker verifies the signature. No secret ever reaches this script.
 */

export const toB64u = (buf: ArrayBuffer | ArrayBufferView): string => {
  const b = buf instanceof ArrayBuffer ? new Uint8Array(buf) : new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
export const fromB64u = (s: string): ArrayBuffer => {
  const p = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bin = atob(p);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
};

/** Does this browser offer passkeys at all? (a platform check, not a promise the device has one) */
export function passkeysSupported(): boolean {
  return typeof window !== "undefined" && typeof window.PublicKeyCredential === "function" && !!navigator.credentials;
}

type Desc = { type: "public-key"; id: string; transports?: string[] };
export type CreateOptionsJSON = {
  challenge: string; rp: { id: string; name: string }; user: { id: string; name: string; displayName: string };
  pubKeyCredParams: { type: "public-key"; alg: number }[]; timeout: number; attestation: "none";
  authenticatorSelection: AuthenticatorSelectionCriteria; excludeCredentials: Desc[];
};
export type GetOptionsJSON = { challenge: string; rpId: string; timeout: number; userVerification: UserVerificationRequirement; allowCredentials: Desc[] };

const desc = (d: Desc): PublicKeyCredentialDescriptor => ({ type: "public-key", id: fromB64u(d.id), ...(d.transports ? { transports: d.transports as AuthenticatorTransport[] } : {}) });

/** navigator.credentials.create, and the answer as JSON for /auth/passkey/register/verify */
export async function createPasskey(o: CreateOptionsJSON): Promise<Record<string, unknown>> {
  const cred = (await navigator.credentials.create({ publicKey: {
    challenge: fromB64u(o.challenge), rp: o.rp,
    user: { id: fromB64u(o.user.id), name: o.user.name, displayName: o.user.displayName },
    pubKeyCredParams: o.pubKeyCredParams, timeout: o.timeout, attestation: o.attestation,
    authenticatorSelection: o.authenticatorSelection, excludeCredentials: o.excludeCredentials.map(desc),
  } })) as PublicKeyCredential | null;
  if (!cred) throw new Error("cancelled");
  const r = cred.response as AuthenticatorAttestationResponse;
  return {
    id: cred.id, rawId: toB64u(cred.rawId), type: cred.type,
    response: {
      clientDataJSON: toB64u(r.clientDataJSON), attestationObject: toB64u(r.attestationObject),
      transports: typeof r.getTransports === "function" ? r.getTransports() : [],
    },
  };
}

/** navigator.credentials.get, and the answer as JSON for /auth/passkey/login/verify */
export async function getPasskey(o: GetOptionsJSON): Promise<Record<string, unknown>> {
  const cred = (await navigator.credentials.get({ publicKey: {
    challenge: fromB64u(o.challenge), rpId: o.rpId, timeout: o.timeout,
    userVerification: o.userVerification, allowCredentials: o.allowCredentials.map(desc),
  } })) as PublicKeyCredential | null;
  if (!cred) throw new Error("cancelled");
  const r = cred.response as AuthenticatorAssertionResponse;
  return {
    id: cred.id, rawId: toB64u(cred.rawId), type: cred.type,
    response: {
      clientDataJSON: toB64u(r.clientDataJSON), authenticatorData: toB64u(r.authenticatorData),
      signature: toB64u(r.signature), userHandle: r.userHandle ? toB64u(r.userHandle) : null,
    },
  };
}

/** The browser's own "the person said no / it timed out" - not an error worth a red line. */
export const cancelled = (e: unknown) => e instanceof Error && (e.name === "NotAllowedError" || e.name === "AbortError" || e.message === "cancelled");
