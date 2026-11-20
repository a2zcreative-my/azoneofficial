/* v1.395.0 - THE CARD BRIDGE SIGNATURE (Digital Cards Stage 6, the CEO 21-11-2026).
 *
 * How A2Z OS and AZ ONE prove a request came from the other side. AZ ONE copies this file byte for
 * byte in Stage 7 (no imports; Web Crypto, present in every Worker and browser).
 *
 *   signature = hex( HMAC-SHA256( CARD_BRIDGE_KEY, `${timestamp}\n${METHOD}\n${path+query}\n${sha256(body)}` ) )
 *   headers   X-Card-Timestamp: unix seconds   X-Card-Signature: the hex above
 *
 * A request older or newer than CARD_SIGNATURE_WINDOW seconds is refused, so a captured request
 * cannot be replayed later; the feed is read-only and the report back is idempotent, so a replay
 * inside the window changes nothing. The key is a Worker secret on both sides - never in code,
 * a log, a response or a browser.
 */
export const CARD_SIGNATURE_WINDOW = 300;
const enc = new TextEncoder();
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
export const sha256Hex = async (text: string) => hex(await crypto.subtle.digest("SHA-256", enc.encode(text)));

export async function cardSignature(key: string, timestamp: number, method: string, pathAndQuery: string, body = ""): Promise<string> {
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", k, enc.encode(`${timestamp}\n${method.toUpperCase()}\n${pathAndQuery}\n${await sha256Hex(body)}`)));
}

/** the two headers for a signed request */
export async function cardHeaders(key: string, method: string, pathAndQuery: string, body = "", now = Date.now()): Promise<Record<string, string>> {
  const ts = Math.floor(now / 1000);
  return { "X-Card-Timestamp": String(ts), "X-Card-Signature": await cardSignature(key, ts, method, pathAndQuery, body) };
}

/** true when the headers sign THIS request with the key, inside the window */
export async function cardVerify(key: string, headers: { timestamp: string | null; signature: string | null }, method: string, pathAndQuery: string, body = "", now = Date.now()): Promise<"ok" | "unsigned" | "stale" | "bad"> {
  if (!headers.timestamp || !headers.signature) return "unsigned";
  const ts = Number(headers.timestamp);
  if (!Number.isInteger(ts) || Math.abs(Math.floor(now / 1000) - ts) > CARD_SIGNATURE_WINDOW) return "stale";
  const want = await cardSignature(key, ts, method, pathAndQuery, body);
  const got = headers.signature.toLowerCase();
  if (got.length !== want.length) return "bad";
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ got.charCodeAt(i);
  return diff === 0 ? "ok" : "bad";
}
