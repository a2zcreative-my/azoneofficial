import { handleStaff, type StaffUser } from "./staff";

/**
 * AZ ONE OFFICIAL — Admin/API Worker (Phase 3, v0)
 * Static public site stays untouched; this Worker serves /api/v1 on its own route.
 * See API.md, DATABASE.md, SECURITY.md.
 */

export interface Env {
  DB: D1Database;
  MEDIA: R2Bucket;
  ALLOWED_ORIGIN: string;
  SESSION_PEPPER: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  COMPANY_DOMAIN: string;
  SETUP_TOKEN: string;
  /** Shared secret for a relay-based TikTok webhook (Make/Zapier). Optional. */
  TIKTOK_WEBHOOK_SECRET?: string;
  /** TikTok Shop Partner Center app credentials (v1.4.44). */
  TIKTOK_APP_KEY?: string;
  TIKTOK_APP_SECRET?: string;
}

type Role =
  | "super_admin" | "admin"
  | "editor" | "marketing" | "live_host"
  | "hr_admin" | "sales_marketing"
  | "ceo" | "coo" | "cco"
  | "customer";

interface SessionUser {
  id: number;
  email: string;
  name: string;
  role: Role;
  photo_key?: string | null; // v1.4.141: portal header avatar (badge photo)
}

/* ---------------- crypto: PBKDF2-SHA256 (WebCrypto-native) ---------------- */
/* Note: SECURITY.md originally specified argon2id; Workers have no native
 * argon2, so we use PBKDF2-SHA256 @ 310k iterations + per-user salt + server
 * pepper. Documented deviation — revisit if a vetted argon2 wasm lib is added. */

const PBKDF2_ITERATIONS = 100_000;

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function hashPassword(
  password: string,
  saltHex: string,
  pepper: string,
  iterations: number,
): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(password + pepper),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const salt = new Uint8Array(
    saltHex.match(/.{2}/g)!.map((h) => parseInt(h, 16)),
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    key,
    256,
  );
  return toHex(bits);
}

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return toHex(buf);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function randomHex(bytes: number): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return toHex(arr.buffer);
}

/** Stored format: pbkdf2$<iterations>$<saltHex>$<hashHex> */
export async function createPasswordHash(
  password: string,
  pepper: string,
): Promise<string> {
  const salt = randomHex(16);
  const hash = await hashPassword(password, salt, pepper, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${salt}$${hash}`;
}

async function verifyPassword(
  password: string,
  stored: string,
  pepper: string,
): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  const iterations = parseInt(parts[1], 10);
  const salt = parts[2];
  const expected = parts[3];
  if (!salt || !expected || isNaN(iterations)) return false;
  const actual = await hashPassword(password, salt, pepper, iterations);
  // constant-time compare
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) {
    diff |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

/* ---------------- helpers ---------------- */

function json(data: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function errorResponse(code: string, message: string, status: number): Response {
  return json({ error: { code, message } }, status);
}

function corsHeaders(env: Env): HeadersInit {
  return {
    "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Credentials": "true",
  };
}

function getCookie(req: Request, name: string): string | null {
  const cookie = req.headers.get("Cookie") ?? "";
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match?.[1] ?? null;
}

const SESSION_COOKIE = "azone_session";
const SESSION_TTL_HOURS = 12;
const OAUTH_STATE_COOKIE = "azone_oauth_state";


/* ================= Two-factor authentication (TOTP, v1.4.37) =================
   Standard RFC 6238 TOTP: 6 digits, 30-second steps, HMAC-SHA1 — compatible
   with Google Authenticator, Authy, 1Password and Microsoft Authenticator.
   Secrets never leave the server except once, at enrolment. */

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Encode(bytes: Uint8Array): string {
  let bits = 0, value = 0, out = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(secret: string): Uint8Array {
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of secret.toUpperCase().replace(/=+$/, "")) {
    const idx = B32.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

/** The 6-digit code for a given 30s counter. */
async function totpAt(secret: string, counter: number): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", base32Decode(secret) as unknown as BufferSource,
    { name: "HMAC", hash: "SHA-1" }, false, ["sign"],
  );
  const msg = new ArrayBuffer(8);
  const view = new DataView(msg);
  view.setUint32(0, Math.floor(counter / 2 ** 32));
  view.setUint32(4, counter >>> 0);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, msg));
  const offset = sig[sig.length - 1] & 0x0f;
  const bin =
    ((sig[offset] & 0x7f) << 24) | (sig[offset + 1] << 16) |
    (sig[offset + 2] << 8) | sig[offset + 3];
  return String(bin % 1_000_000).padStart(6, "0");
}

/** Verify a code, allowing ±1 step (~30s) of clock drift. */
async function totpVerify(secret: string, code: string): Promise<boolean> {
  const clean = (code ?? "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(clean)) return false;
  const counter = Math.floor(Date.now() / 30000);
  for (const c of [counter - 1, counter, counter + 1]) {
    if (await totpAt(secret, c) === clean) return true;
  }
  return false;
}

function randomSecret(): string {
  return base32Encode(crypto.getRandomValues(new Uint8Array(20)));
}

/** Backup codes: 8 single-use codes, shown once, stored hashed. */
function makeBackupCodes(): string[] {
  const codes: string[] = [];
  for (let i = 0; i < 8; i++) {
    const n = crypto.getRandomValues(new Uint32Array(1))[0] % 100_000_000;
    const str = String(n).padStart(8, "0");
    codes.push(`${str.slice(0, 4)}-${str.slice(4)}`);
  }
  return codes;
}

/** Every staff role may (and should) protect their account with 2FA — staff
    accounts hold and populate company data, so integrity demands it for all.
    Only customer accounts are excluded. */
const TWOFA_ELIGIBLE = (role: string) => role !== "customer";

/* ================= TikTok Shop integration (v1.4.44) =================
   TikTok signs webhooks itself — there is no custom header to set — so the
   endpoint verifies TikTok's own signature. Two signing conventions are in
   use across TikTok's platforms, so both are checked:
     A. header "tiktok-signature": HMAC-SHA256(app_secret, app_key + rawBody)
     B. header "tiktok-signature": "t=<ts>,s=<sig>" with
        HMAC-SHA256(app_secret, ts + rawBody)
   Every receipt is logged to webhook_events with its verified flag, so if
   TikTok uses a different string, the real headers are on record to adjust. */

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function verifyTikTokSignature(env: Env, header: string, rawBody: string): Promise<boolean> {
  if (!env.TIKTOK_APP_SECRET || !env.TIKTOK_APP_KEY || !header) return false;
  const plain = header.trim();
  // Scheme A — plain hex signature.
  if (!plain.includes("=")) {
    const expected = await hmacHex(env.TIKTOK_APP_SECRET, env.TIKTOK_APP_KEY + rawBody);
    return timingSafeEqual(expected, plain);
  }
  // Scheme B — "t=<timestamp>,s=<signature>".
  const parts = Object.fromEntries(
    plain.split(",").map((kv) => kv.split("=").map((x) => x.trim()) as [string, string]),
  );
  if (!parts.t || !parts.s) return false;
  // Reject stale timestamps (5 minutes) to blunt replay attacks.
  const age = Math.abs(Date.now() / 1000 - Number(parts.t));
  if (!Number.isFinite(age) || age > 300) return false;
  const expected = await hmacHex(env.TIKTOK_APP_SECRET, `${parts.t}${rawBody}`);
  return timingSafeEqual(expected, parts.s);
}



/** Stored seller token, refreshed by the authorization callback. */
async function tiktokToken(env: Env): Promise<{ access_token: string; shop_cipher: string | null } | null> {
  const row = await env.DB.prepare(
    `SELECT access_token, shop_cipher FROM integration_tokens WHERE provider = 'tiktok'`,
  ).first<{ access_token: string; shop_cipher: string | null }>();
  return row ?? null;
}

/** TikTok Shop API request signing: every call carries app_key, timestamp and
    sign = HMAC-SHA256(app_secret, app_secret + path + sorted(k+v) + body + app_secret).
    access_token and sign itself are excluded from the signed parameter set. */
async function tiktokSignedFetch(
  env: Env, path: string, params: Record<string, string>, body?: string, method = "GET",
): Promise<unknown> {
  const tok = await tiktokToken(env);
  if (!tok || !env.TIKTOK_APP_KEY || !env.TIKTOK_APP_SECRET) return null;
  const all: Record<string, string> = {
    ...params,
    app_key: env.TIKTOK_APP_KEY,
    timestamp: String(Math.floor(Date.now() / 1000)),
  };
  if (tok.shop_cipher) all.shop_cipher = tok.shop_cipher;
  const sortedConcat = Object.keys(all).sort().map((k) => k + all[k]).join("");
  const base = env.TIKTOK_APP_SECRET + path + sortedConcat + (body ?? "") + env.TIKTOK_APP_SECRET;
  all.sign = await hmacHex(env.TIKTOK_APP_SECRET, base);
  const url = new URL(`https://open-api.tiktokglobalshop.com${path}`);
  for (const [k, v] of Object.entries(all)) url.searchParams.set(k, v);
  try {
    const res = await fetch(url.toString(), {
      method,
      headers: { "x-tts-access-token": tok.access_token, "Content-Type": "application/json" },
      body: method === "GET" ? undefined : body,
    });
    return await res.json().catch(() => null);
  } catch {
    return null;
  }
}

/** Group TikTok line items (one row per unit) into SKU + quantity. */
function groupLineItems(items: { seller_sku?: string; sku_id?: string; product_name?: string; sku_name?: string; sale_price?: string | number }[]): { sku: string; name: string; variant: string; qty: number; unit_sale_cents: number | null }[] {
  // v1.4.162: carry the TikTok names too — matching now falls back to the
  // item description when the SKU doesn't line up with inventory.
  // v1.4.166: also carry the ACTUAL per-unit sale price (what the buyer paid
  // after live rebates) — the rebate is computed from it, never typed in.
  const merged = new Map<string, { sku: string; name: string; variant: string; qty: number; saleSum: number; salePriced: number }>();
  for (const li of items) {
    const sku = (li.seller_sku ?? li.sku_id ?? "").trim();
    const variant = (li.sku_name ?? "").trim();
    const name = [li.product_name, li.sku_name].filter(Boolean).join(" ").trim();
    const key = (sku || name).toLowerCase();
    if (!key) continue;
    const saleC = Math.round(Number(li.sale_price ?? NaN) * 100);
    const cur = merged.get(key) ?? { sku, name, variant, qty: 0, saleSum: 0, salePriced: 0 };
    cur.qty += 1;
    if (Number.isFinite(saleC) && saleC >= 0) { cur.saleSum += saleC; cur.salePriced += 1; }
    merged.set(key, cur);
  }
  return [...merged.values()].map((v) => ({
    sku: v.sku, name: v.name, variant: v.variant, qty: v.qty,
    unit_sale_cents: v.salePriced > 0 ? Math.round(v.saleSum / v.salePriced) : null,
  }));
}

/** v1.4.162 (CEO: "sync with TikTok order based on item desc or SKU"):
    resolve a TikTok line to an inventory item —
      1) SKU, case-insensitive + trimmed (was exact-match only)
      2) exact item-name match against the variant (sku_name) or full name
      3) unique-contains: the inventory item's name appears inside the TikTok
         product/variant name AND only ONE inventory item qualifies — a
         multi-hit never deducts, so an ambiguous name can't move the wrong
         stock. Names shorter than 3 chars never contains-match. */
async function matchInventoryItem(env: Env, sku: string, name: string, variant: string):
    Promise<{ id: number; stock: number; name: string; unit_price_cents: number | null; via: "sku" | "name" } | null> {
  if (sku) {
    const bySku = await env.DB.prepare(
      `SELECT id, stock, name, unit_price_cents FROM inventory_items WHERE lower(trim(sku)) = lower(trim(?1)) LIMIT 1`,
    ).bind(sku).first<{ id: number; stock: number; name: string; unit_price_cents: number | null }>();
    if (bySku) return { ...bySku, via: "sku" };
  }
  for (const cand of [variant, name]) {
    if (!cand) continue;
    const exact = await env.DB.prepare(
      `SELECT id, stock, name, unit_price_cents FROM inventory_items WHERE lower(trim(name)) = lower(trim(?1)) LIMIT 1`,
    ).bind(cand).first<{ id: number; stock: number; name: string; unit_price_cents: number | null }>();
    if (exact) return { ...exact, via: "name" };
  }
  if (name) {
    const contains = await env.DB.prepare(
      `SELECT id, stock, name, unit_price_cents FROM inventory_items
       WHERE length(trim(name)) >= 3 AND instr(lower(?1), lower(trim(name))) > 0 LIMIT 2`,
    ).bind(name).all<{ id: number; stock: number; name: string; unit_price_cents: number | null }>();
    if (contains.results.length === 1) return { ...contains.results[0]!, via: "name" };
  }
  return null;
}

/** v1.4.166: write a TikTok stock movement with the actual sold price, then
    auto-sync the item's live rebate = list price − sold price (never
    negative; untouched when the order carried no price or no list price is
    set). Tolerant of migrations 0046/0047 not being applied yet. */
async function recordTiktokLine(env: Env, postageId: number, itemId: number, qty: number, unitSaleCents: number | null): Promise<void> {
  try {
    await env.DB.prepare(
      `INSERT INTO postage_items (postage_id, inventory_item_id, qty, unit_sale_cents) VALUES (?1, ?2, ?3, ?4)`,
    ).bind(postageId, itemId, qty, unitSaleCents).run();
  } catch (e) {
    if (!String(e).includes("no such column")) throw e;
    await env.DB.prepare(
      `INSERT INTO postage_items (postage_id, inventory_item_id, qty) VALUES (?1, ?2, ?3)`,
    ).bind(postageId, itemId, qty).run();
  }
  if (unitSaleCents !== null && unitSaleCents >= 0) {
    try {
      await env.DB.prepare(
        `UPDATE inventory_items SET live_rebate_cents = CASE
           WHEN unit_price_cents IS NOT NULL AND unit_price_cents > ?1 THEN unit_price_cents - ?1
           ELSE 0 END
         WHERE id = ?2 AND unit_price_cents IS NOT NULL AND unit_price_cents > 0`,
      ).bind(unitSaleCents, itemId).run();
    } catch { /* 0046 not applied — skip the auto rebate */ }
  }
}

/** The token response does NOT include the shop identifier. Order APIs
    require shop_cipher, which comes from Get Authorized Shops — fetched once
    after authorization and stored beside the token (v1.4.57). */
async function refreshTikTokShopCipher(env: Env): Promise<{ ok: boolean; detail: string }> {
  // The two shops endpoints sit under DIFFERENT scope families; try both so
  // whichever scope is active on the app can supply the cipher (v1.4.61).
  const attempts: string[] = [];
  for (const path of ["/authorization/202309/shops", "/seller/202309/shops"]) {
    const data = (await tiktokSignedFetch(env, path, {})) as {
      code?: number; message?: string;
      data?: {
        shops?: { id?: string; cipher?: string }[];
        shop_list?: { shop_id?: string; shop_cipher?: string; cipher?: string }[];
      };
    } | null;
    if (!data) { attempts.push(`${path}: no response`); continue; }
    const a = data.data?.shops?.[0];
    const b = data.data?.shop_list?.[0];
    const cipher = a?.cipher ?? b?.shop_cipher ?? b?.cipher ?? null;
    const shopId = a?.id ?? b?.shop_id ?? null;
    if (cipher) {
      await env.DB.prepare(
        `UPDATE integration_tokens SET shop_id = ?1, shop_cipher = ?2, updated_at = datetime('now')
         WHERE provider = 'tiktok'`,
      ).bind(shopId, cipher).run();
      return { ok: true, detail: `stored via ${path}` };
    }
    attempts.push(
      typeof data.code === "number" && data.code !== 0
        ? `${path} → TikTok code ${data.code}: ${data.message ?? "no message"}`
        : `${path} → empty shop list (seller authorization may not have completed)`,
    );
  }
  return { ok: false, detail: attempts.join(" · ") };
}

/** Order webhooks carry only an id + status, so the line items are fetched.
    Returns [] when no token is stored yet (order still gets recorded).
    v1.4.71: also surfaces the buyer's CITY (never the street address). */
async function tiktokOrderItems(env: Env, orderId: string): Promise<{ items: { sku: string; qty: number }[]; city: string | null }> {
  const data = (await tiktokSignedFetch(env, "/order/202309/orders", { ids: orderId })) as {
    data?: { orders?: {
      line_items?: { seller_sku?: string; sku_id?: string; product_name?: string; sku_name?: string; sale_price?: string | number }[];
      recipient_address?: {
        city?: string; state?: string; district?: string; town?: string;
        district_info?: { address_level_name?: string; address_name?: string }[];
      };
    }[] };
  } | null;
  const order = data?.data?.orders?.[0];
  const ra = order?.recipient_address;
  const city = (
    ra?.city ??
    ra?.district_info?.find((d) => /city|bandar/i.test(d.address_level_name ?? ""))?.address_name ??
    // v1.4.190: some region payloads carry only the FLAT district/town keys
    ra?.district ?? ra?.town ??
    ra?.state ??
    ra?.district_info?.find((d) => /state|negeri|province/i.test(d.address_level_name ?? ""))?.address_name ??
    // v1.4.179: district level, then ANY named area level — still an area,
    // never the street address (privacy rule unchanged).
    ra?.district_info?.find((d) => /district|daerah/i.test(d.address_level_name ?? ""))?.address_name ??
    ra?.district_info?.find((d) => (d.address_name ?? "").trim() !== "")?.address_name ??
    null
  )?.slice(0, 80) ?? null;
  // v1.4.190 diagnostic (privacy-safe: STRUCTURE only, never values): when a
  // location still can't be extracted, record which keys/levels TikTok sent
  // so the unseen regional shape can be added to the chain.
  if (!city) {
    await logError(env, "tiktok_location", `order ${orderId}: ra_keys=[${Object.keys(ra ?? {}).join(",") || "ABSENT"}] levels=[${(ra?.district_info ?? []).map((d) => d.address_level_name ?? "?").join(",")}]`);
  }
  return { items: groupLineItems(order?.line_items ?? []), city };
}

async function createSession(env: Env, userId: number): Promise<string> {
  const token = randomHex(32);
  // Store only the hash: a leaked sessions table cannot be replayed.
  const tokenHash = await sha256Hex(token);
  try {
    await env.DB.prepare(
      `INSERT INTO sessions (id, user_id, expires_at)
       VALUES (?1, ?2, datetime('now', '+${SESSION_TTL_HOURS} hours'))`,
    )
      .bind(tokenHash, userId)
      .run();
  } catch (e) {
    throw new Error(`session insert for user ${userId}: ${e instanceof Error ? e.message : String(e)}`);
  }
  // Opportunistic housekeeping: purge expired sessions. Never fatal.
  try {
    await env.DB.prepare(`DELETE FROM sessions WHERE expires_at <= datetime('now')`).run();
  } catch (e) {
    console.error("session housekeeping failed:", e);
  }
  return token;
}

function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_HOURS * 3600}`;
}

async function getSessionUser(req: Request, env: Env): Promise<SessionUser | null> {
  const raw = getCookie(req, SESSION_COOKIE);
  if (!raw) return null;
  const token = await sha256Hex(raw);
  const row = await env.DB.prepare(
    `SELECT u.id, u.email, u.name, u.role, u.photo_key
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.id = ?1 AND s.expires_at > datetime('now') AND u.is_active = 1`,
  )
    .bind(token)
    .first<SessionUser>();
  return row ?? null;
}

const ROLE_RANK: Record<Role, number> = {
  customer: 0,
  live_host: 0,
  editor: 1,
  marketing: 1,
  hr_admin: 1,
  sales_marketing: 1,
  cco: 1,
  coo: 1,
  ceo: 3,
  admin: 3,
  super_admin: 4,
};

/**
 * The content team works in /admin. Staff roles (cco, coo, hr_admin, …) have
 * their own modules in /portal with their own permission sets — rank alone
 * must not leak them into content management. This is the API-side twin of
 * the /admin page gate.
 */
const CONTENT_ROLES: readonly Role[] = ["super_admin", "admin"];
/* v1.4.181 (CEO: customers must reach staff for package/service enquiries):
   the business team sees and works customer enquiries — not just /admin. */
const ENQUIRY_ROLES: readonly Role[] = ["super_admin", "admin", "ceo", "coo", "cco", "sales_marketing", "marketing", "hr_admin"];

function isContentTeam(user: SessionUser | null): user is SessionUser {
  return !!user && CONTENT_ROLES.includes(user.role);
}

function atLeast(user: SessionUser | null, role: Role): user is SessionUser {
  return !!user && ROLE_RANK[user.role] >= ROLE_RANK[role];
}

async function audit(
  env: Env,
  userId: number | null,
  action: string,
  entity?: string,
  entityId?: string,
  detail?: unknown,
): Promise<void> {
  // The audit trail records actions; it must never take one down (v1.4.69).
  // A failed write (e.g. an FK constraint after a table rebuild) is logged
  // for the operator and swallowed.
  try {
    await env.DB.prepare(
      `INSERT INTO audit_log (user_id, action, entity, entity_id, detail)
       VALUES (?1, ?2, ?3, ?4, ?5)`,
    )
      .bind(userId, action, entity ?? null, entityId ?? null, detail ? JSON.stringify(detail) : null)
      .run();
  } catch (e) {
    console.error("audit write failed:", action, e);
    await logError(env, "audit", `${action}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** v1.4.72: system error log. Records failures the team would otherwise only
    hear about from staff ("Something went wrong"). NEVER fatal, and the table
    has no foreign keys, so it stays writable even when the database itself is
    the problem. Keeps the newest 500 rows. */
async function logError(env: Env, source: string, message: string, path?: string): Promise<void> {
  try {
    await env.DB.prepare(
      `INSERT INTO error_log (source, message, path) VALUES (?1, ?2, ?3)`,
    ).bind(source.slice(0, 40), message.slice(0, 500), path?.slice(0, 200) ?? null).run();
    await env.DB.prepare(
      `DELETE FROM error_log WHERE id NOT IN (SELECT id FROM error_log ORDER BY id DESC LIMIT 500)`,
    ).run();
  } catch (e) {
    // Before migration 0024 the table doesn't exist — console is the fallback.
    console.error("error_log write failed:", source, message, e);
  }
}

/** v1.4.72: nightly database backup to R2. Dumps every application table as
    JSON to backups/db-YYYY-MM-DD.json (MYT date) and keeps the newest 30 —
    a bad migration or accidental delete is recoverable from any of them.
    Row cap per table guards against a runaway payload; audit_log is the only
    table anywhere near it. */
async function runBackup(env: Env, actorId: number | null): Promise<
  | { ok: true; key: string; tables: number; rows: number; bytes: number }
  | { ok: false; message: string }
> {
  try {
    const { results: tables } = await env.DB.prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table'
         AND name NOT LIKE 'sqlite\_%' ESCAPE '\'
         AND name NOT LIKE '\_cf\_%' ESCAPE '\'
         AND name != 'd1_migrations'
       ORDER BY name`,
    ).all<{ name: string }>();
    const dump: Record<string, unknown[]> = {};
    let rowCount = 0;
    for (const t of tables) {
      if (!/^[A-Za-z0-9_]+$/.test(t.name)) continue; // defence in depth
      const { results } = await env.DB.prepare(`SELECT * FROM "${t.name}" LIMIT 50000`).all();
      dump[t.name] = results;
      rowCount += results.length;
    }
    const mytDate = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
    // v1.4.76: gzip the dump (R2 free tier) — JSON compresses ~85–90%.
    const key = `backups/db-${mytDate}.json.gz`;
    const raw = JSON.stringify({ generated_at: new Date().toISOString(), database: "azoneofficial", tables: dump });
    const gzipped = new Response(
      new Blob([raw]).stream().pipeThrough(new CompressionStream("gzip")),
    );
    const body = await gzipped.arrayBuffer();
    await env.MEDIA.put(key, body, { httpMetadata: { contentType: "application/gzip" } });
    // Retention: keep the newest 30 backup objects.
    const listed = await env.MEDIA.list({ prefix: "backups/" });
    const sorted = listed.objects.sort((a, b) => b.key.localeCompare(a.key));
    for (const stale of sorted.slice(30)) await env.MEDIA.delete(stale.key);
    await audit(env, actorId, "system.backup", "r2", key, { tables: tables.length, rows: rowCount, bytes: body.byteLength, raw_bytes: raw.length, source: actorId ? "manual" : "cron" });
    return { ok: true, key, tables: tables.length, rows: rowCount, bytes: body.byteLength };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await logError(env, "backup", msg);
    return { ok: false, message: msg };
  }
}

/* ---------------- rate limiting (fixed window, D1-backed) ----------------- */

async function checkRateLimit(
  env: Env,
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<boolean> {
  // returns true if the request is allowed
  const row = await env.DB.prepare(
    `SELECT count, window_start FROM rate_limits WHERE key = ?1`,
  )
    .bind(key)
    .first<{ count: number; window_start: string }>();

  const now = Date.now();
  const windowStart = row ? Date.parse(row.window_start + "Z") : 0;
  const inWindow = row && now - windowStart < windowSeconds * 1000;

  if (inWindow && row.count >= limit) return false;

  if (inWindow) {
    await env.DB.prepare(`UPDATE rate_limits SET count = count + 1 WHERE key = ?1`)
      .bind(key)
      .run();
  } else {
    await env.DB.prepare(
      `INSERT INTO rate_limits (key, count, window_start) VALUES (?1, 1, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET count = 1, window_start = datetime('now')`,
    )
      .bind(key)
      .run();
  }
  return true;
}

function clientIp(request: Request): string {
  return request.headers.get("CF-Connecting-IP") ?? "unknown";
}

/* ---------------- generic CRUD config (whitelisted columns per table) ----- */

interface CrudConfig {
  table: string;
  columns: readonly string[];   // writable columns
  required: readonly string[];
  orderBy: string;
}

const CRUD: Record<string, CrudConfig> = {
  products: {
    table: "products",
    columns: ["slug", "name", "category", "description", "price_cents", "inventory", "is_featured", "is_visible", "seo_title", "seo_description"],
    required: ["slug", "name"],
    orderBy: "created_at DESC",
  },
  posts: {
    table: "posts",
    columns: ["slug", "title", "excerpt", "body", "status", "publish_at", "category", "tags", "featured_media_id", "seo_title", "seo_description", "author_id"],
    required: ["slug", "title", "body"],
    orderBy: "created_at DESC",
  },
  portfolio: {
    table: "portfolio_items",
    columns: ["client", "summary", "result", "is_published"],
    required: ["client"],
    orderBy: "created_at DESC",
  },
  testimonials: {
    table: "testimonials",
    columns: ["author", "company", "position", "review", "rating", "photo_media_id", "is_published"],
    required: ["author", "review"],
    orderBy: "id DESC",
  },
};

/* ---------------- validation (minimal, replace with zod when bundling) ---- */

function isNonEmptyString(v: unknown, max = 500): v is string {
  return typeof v === "string" && v.trim().length > 0 && v.length <= max;
}

/* ---------------- router ---------------- */

/** One sync pass: pull the last 30 days of TikTok orders and reconcile them
    into postage + inventory. Shared by the manual Sync button and the cron
    schedule (v1.4.66) — actorId is null for scheduled runs. */
async function runTikTokSync(env: Env, actorId: number | null): Promise<
  | { ok: true; imported: number; skipped: number; total_from_tiktok: number; problems: string[] }
  | { ok: false; code: string; message: string; status: number }
> {
  if (!env.TIKTOK_APP_KEY || !env.TIKTOK_APP_SECRET) {
    return { ok: false, code: "not_configured", message: "Set TIKTOK_APP_KEY and TIKTOK_APP_SECRET first", status: 503 };
  }
  const tokNow = await tiktokToken(env);
  if (!tokNow) {
    return { ok: false, code: "not_authorized", message: "Authorize the app first: publish it in Partner Center and complete shop authorization via the redirect URL", status: 409 };
  }
  if (!tokNow.shop_cipher) {
    const cipherRes = await refreshTikTokShopCipher(env);
    if (!cipherRes.ok) {
      return { ok: false, code: "no_shop_cipher", message: `Could not resolve the authorized shop — ${cipherRes.detail}`, status: 502 };
    }
  }
  const listBody = JSON.stringify({ create_time_ge: Math.floor(Date.now() / 1000) - 30 * 86400 });
  const data = (await tiktokSignedFetch(
    env, "/order/202309/orders/search", { page_size: "50" }, listBody, "POST",
  )) as {
    code?: number; message?: string;
    data?: { orders?: {
      id?: string; status?: string; tracking_number?: string;
      packages?: { tracking_number?: string }[];
      line_items?: { seller_sku?: string; sku_id?: string; product_name?: string; sku_name?: string; sale_price?: string | number; tracking_number?: string }[];
      recipient_address?: {
        city?: string; state?: string; district?: string; town?: string;
        district_info?: { address_level_name?: string; address_name?: string }[];
      };
      payment?: { total_amount?: string | number; currency?: string };
    }[] };
  } | null;
  if (!data || (typeof data.code === "number" && data.code !== 0)) {
    return { ok: false, code: "tiktok_error", message: `TikTok API error: ${data?.message ?? "no response"} — check that the order scopes are active`, status: 502 };
  }
  const orders = data.data?.orders ?? [];
  let imported = 0, skipped = 0, retried = 0; // retried: v1.4.168 backfilled deductions
  const problems: string[] = [];
  for (const o of orders) {
    const orderId = String(o.id ?? "").trim();
    if (!orderId) continue;
    const orderRef = `TT-${orderId.slice(0, 64)}`;
    const exists = await env.DB.prepare(
      `SELECT id, tracking_no, status, restocked FROM postage_records WHERE order_ref = ?1`,
    ).bind(orderRef).first<{ id: number; tracking_no: string | null; status: string; restocked: number | null }>();
    const stNow = String(o.status ?? "").toLowerCase();
    const uiNow = stNow.includes("deliver") ? "delivered" : stNow.includes("ship") || stNow.includes("transit") ? "shipped" : "preparing";
    const trackNow =
      o.tracking_number ??
      o.packages?.find((pk) => pk.tracking_number)?.tracking_number ??
      o.line_items?.find((li) => li.tracking_number)?.tracking_number ??
      null;
    // City only — deliberately never the street address (privacy: staff need
    // rough destination, not the buyer's home). Response shapes vary, so try
    // the flat field first, then the district_info levels.
    const ra = o.recipient_address;
    const cityNow = (
      ra?.city ??
      ra?.district_info?.find((d) => /city|bandar/i.test(d.address_level_name ?? ""))?.address_name ??
      // v1.4.190: some region payloads carry only the FLAT district/town keys
      ra?.district ?? ra?.town ??
      ra?.state ??
      ra?.district_info?.find((d) => /state|negeri|province/i.test(d.address_level_name ?? ""))?.address_name ??
      // v1.4.179 (CEO: "why there is a missing location?"): some orders carry
      // neither a flat city nor a state — fall through to the district level,
      // then to ANY named area level TikTok sent. Still an area, never the
      // street address (privacy rule unchanged).
      ra?.district_info?.find((d) => /district|daerah/i.test(d.address_level_name ?? ""))?.address_name ??
      ra?.district_info?.find((d) => (d.address_name ?? "").trim() !== "")?.address_name ??
      null
    )?.slice(0, 80) ?? null;
    // v1.4.190 diagnostic (privacy-safe: STRUCTURE only, never values).
    if (!cityNow) {
      await logError(env, "tiktok_location", `order ${orderId}: ra_keys=[${Object.keys(ra ?? {}).join(",") || "ABSENT"}] levels=[${(ra?.district_info ?? []).map((d) => d.address_level_name ?? "?").join(",")}]`);
    }
    // v1.4.75: order amount in cents for the revenue dashboard. TikTok sends
    // the total as a decimal string; parse defensively, reject nonsense.
    const paidRaw = Number(o.payment?.total_amount);
    const amountNow = Number.isFinite(paidRaw) && paidRaw >= 0 ? Math.round(paidRaw * 100) : null;
    if (exists) {
      // Already imported: keep its shipping status and tracking current.
      await env.DB.prepare(
        `UPDATE postage_records SET status = ?1, tracking_no = COALESCE(tracking_no, ?2),
           buyer_city = COALESCE(buyer_city, ?3),
           order_amount_cents = COALESCE(order_amount_cents, ?4),
           updated_at = datetime('now') WHERE id = ?5 AND status != 'returned'`,
      ).bind(uiNow, trackNow, cityNow, amountNow, exists.id).run();
      /* v1.4.168 (CEO: 11 orders stuck on "No stock movement recorded"):
         deduction used to run ONLY on first import — an order that arrived
         before its inventory item existed (or whose SKU/name matched
         nothing) never moved stock, even after the item was fixed. Every
         sync now RETRIES the deduction for movement-less orders against
         CURRENT inventory — so fixing a SKU/name or adding the item heals
         past orders on the next sync (manual button or 30-min cron), with
         the sold price captured and the rebate auto-synced as usual.
         Returned/restocked orders are excluded; same all-or-nothing
         shortage rule as first import. */
      if (exists.status !== "returned" && !exists.restocked && uiNow !== "returned") {
        const moved = await env.DB.prepare(
          `SELECT COUNT(*) AS n FROM postage_items WHERE postage_id = ?1`,
        ).bind(exists.id).first<{ n: number }>();
        if ((moved?.n ?? 0) === 0) {
          const rLines = groupLineItems(o.line_items ?? []);
          const rResolved: { id: number; qty: number; unit_sale_cents: number | null }[] = [];
          const rUnknown: string[] = [];
          const rShortages: string[] = [];
          const rNameMatched: string[] = [];
          for (const l of rLines) {
            const item = await matchInventoryItem(env, l.sku, l.name, l.variant);
            if (!item) { rUnknown.push(`${l.qty}× ${l.sku || l.name}`); continue; }
            if (item.via === "name") rNameMatched.push(item.name);
            if (item.stock < l.qty) rShortages.push(`${item.name}: ${item.stock} < ${l.qty}`);
            rResolved.push({ id: item.id, qty: l.qty, unit_sale_cents: l.unit_sale_cents });
          }
          if (rShortages.length === 0 && rResolved.length > 0) {
            for (const l of rResolved) {
              const upd = await env.DB.prepare(
                `UPDATE inventory_items SET stock = stock - ?1, updated_at = datetime('now') WHERE id = ?2 AND stock >= ?1`,
              ).bind(l.qty, l.id).run();
              if (upd.meta.changes) {
                await recordTiktokLine(env, exists.id, l.id, l.qty, l.unit_sale_cents);
                await env.DB.prepare(
                  `UPDATE inventory_items SET status = CASE WHEN stock = 0 THEN 'out_of_stock' WHEN stock <= 5 THEN 'low' ELSE 'in_stock' END WHERE id = ?1`,
                ).bind(l.id).run();
                await audit(env, actorId, "inventory.out", "inventory_items", String(l.id), { qty: l.qty, unit_sale_cents: l.unit_sale_cents, order: orderRef, source: "tiktok_retry" });
              }
            }
            const mytNow = new Date(Date.now() + 8 * 3600 * 1000);
            const stamp = `${String(mytNow.getUTCDate()).padStart(2, "0")}-${String(mytNow.getUTCMonth() + 1).padStart(2, "0")} ${String(mytNow.getUTCHours()).padStart(2, "0")}:${String(mytNow.getUTCMinutes()).padStart(2, "0")} MYT`;
            const rNotes = ["TikTok order (synced)", `✔ stock deducted on retry ${stamp}`];
            if (rNameMatched.length) rNotes.push(`matched by item name: ${rNameMatched.join(", ")}`);
            if (rUnknown.length) rNotes.push(`not in inventory (SKU or name): ${rUnknown.join(", ")}`);
            await env.DB.prepare(
              `UPDATE postage_records SET note = ?1, updated_at = datetime('now') WHERE id = ?2`,
            ).bind(rNotes.join(" · "), exists.id).run();
            retried += 1;
          } else if (rLines.length > 0) {
            // Still can't deduct — refresh the reason so the CEO sees the
            // CURRENT blocker (fixing one SKU updates the list next sync).
            const rNotes = ["TikTok order (synced)"];
            if (rUnknown.length) rNotes.push(`not in inventory (SKU or name): ${rUnknown.join(", ")}`);
            if (rShortages.length) rNotes.push(`NOT deducted — ${rShortages.join("; ")}`);
            await env.DB.prepare(
              `UPDATE postage_records SET note = ?1, updated_at = datetime('now') WHERE id = ?2`,
            ).bind(rNotes.join(" · "), exists.id).run();
          }
        }
      }
      skipped += 1;
      continue;
    }
    const lines = groupLineItems(o.line_items ?? []);
    const resolved: { id: number; qty: number; unit_sale_cents: number | null }[] = [];
    const unknown: string[] = [];
    const shortages: string[] = [];
    const nameMatched: string[] = [];
    for (const l of lines) {
      // v1.4.162: SKU first, item-name fallback (see matchInventoryItem)
      const item = await matchInventoryItem(env, l.sku, l.name, l.variant);
      if (!item) { unknown.push(`${l.qty}× ${l.sku || l.name}`); continue; }
      if (item.via === "name") nameMatched.push(item.name);
      if (item.stock < l.qty) shortages.push(`${item.name}: ${item.stock} < ${l.qty}`);
      resolved.push({ id: item.id, qty: l.qty, unit_sale_cents: l.unit_sale_cents });
    }
    const canDeduct = shortages.length === 0 && resolved.length > 0;
    const notes = ["TikTok order (synced)"];
    if (nameMatched.length) notes.push(`matched by item name: ${nameMatched.join(", ")}`);
    if (unknown.length) notes.push(`not in inventory (SKU or name): ${unknown.join(", ")}`);
    if (!canDeduct && shortages.length) notes.push(`NOT deducted — ${shortages.join("; ")}`);
    const rec = await env.DB.prepare(
      `INSERT INTO postage_records (order_ref, courier, tracking_no, buyer_city, order_amount_cents, status, note, updated_by)
       VALUES (?1, 'TikTok', ?2, ?3, ?4, ?5, ?6, NULL) RETURNING id`,
    ).bind(orderRef, trackNow, cityNow, amountNow, uiNow, notes.join(" · ")).first<{ id: number }>();
    if (canDeduct) {
      for (const l of resolved) {
        const upd = await env.DB.prepare(
          `UPDATE inventory_items SET stock = stock - ?1, updated_at = datetime('now') WHERE id = ?2 AND stock >= ?1`,
        ).bind(l.qty, l.id).run();
        if (upd.meta.changes) {
          // v1.4.166: movement carries the actual sold price; rebate auto-syncs
          await recordTiktokLine(env, rec!.id, l.id, l.qty, l.unit_sale_cents);
          await env.DB.prepare(
            `UPDATE inventory_items SET status = CASE WHEN stock = 0 THEN 'out_of_stock' WHEN stock <= 5 THEN 'low' ELSE 'in_stock' END WHERE id = ?1`,
          ).bind(l.id).run();
          await audit(env, actorId, "inventory.out", "inventory_items", String(l.id), { qty: l.qty, unit_sale_cents: l.unit_sale_cents, order: orderRef, source: actorId ? "tiktok_sync" : "tiktok_cron" });
        }
      }
    }
    if (unknown.length) problems.push(`${orderRef}: unmatched ${unknown.join(", ")}`);
    imported += 1;
  }
  if (imported > 0 || retried > 0 || actorId) {
    await audit(env, actorId, "tiktok.sync", undefined, undefined, { imported, skipped, retried, source: actorId ? "manual" : "cron" });
  }
  return { ok: true, imported, skipped, retried, total_from_tiktok: orders.length, problems };
}

export default {
  /** Crons: every 30 min = TikTok sync (v1.4.66); daily 19:20 UTC
      (03:20 MYT) = database backup to R2 (v1.4.72). Real sync failures land
      in the error log — "not configured / not authorized" are expected until
      the TikTok setup completes and stay silent. */
  async scheduled(event: ScheduledEvent, env: Env): Promise<void> {
    if (event.cron === "20 19 * * *") {
      await runBackup(env, null);
      return;
    }
    if (event.cron === "0 1 * * *") {
      // v1.4.101: 09:00 MYT — birthday announcements so the team can prepare
      // the celebration. Notifies every active staff member.
      try {
        const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(5, 10); // MM-DD MYT
        const { results: bdays } = await env.DB.prepare(
          `SELECT id, name FROM users WHERE is_active = 1 AND birthday IS NOT NULL
           AND substr(birthday, 6, 5) = ?1 AND role NOT IN ('customer')`,
        ).bind(today).all<{ id: number; name: string }>();
        if (bdays.length > 0) {
          const { results: staff } = await env.DB.prepare(
            `SELECT id FROM users WHERE is_active = 1 AND role NOT IN ('customer')`,
          ).all<{ id: number }>();
          for (const b of bdays) {
            for (const st of staff) {
              await env.DB.prepare(
                `INSERT INTO notifications (user_id, kind, message, ref) VALUES (?1, 'birthday', ?2, ?3)`,
              ).bind(st.id, `🎂 Today is ${b.name}'s birthday — wish them well!`, `birthday:${b.id}`).run();
            }
          }
        }
      } catch (e) {
        await logError(env, "birthday_cron", e instanceof Error ? e.message : String(e));
      }
      return;
    }
    const res = await runTikTokSync(env, null);
    if (!res.ok && res.code !== "not_configured" && res.code !== "not_authorized") {
      await logError(env, "tiktok_cron", res.message);
    }
    /* v1.4.191 LOW-STOCK SWEEP (CEO gap list): after every sync, alert on
       items at ≤5 units — protects lives from selling out mid-stream. The
       low_alerted column stops repeats; recovery above 5 resets it. Covers
       TikTok deductions; manual movements alert instantly in staff.ts. */
    try {
      const { results: lowItems } = await env.DB.prepare(
        `SELECT id, sku, name, stock, low_alerted FROM inventory_items
         WHERE stock <= 5 AND (low_alerted IS NULL OR stock < low_alerted)`,
      ).all<{ id: number; sku: string; name: string; stock: number; low_alerted: number | null }>();
      if (lowItems.length > 0) {
        const { results: alertStaff } = await env.DB.prepare(
          `SELECT id FROM users WHERE is_active = 1 AND role IN ('sales_marketing', 'ceo')`,
        ).all<{ id: number }>();
        for (const it of lowItems) {
          const msg = it.stock <= 0 ? `🛑 OUT OF STOCK: ${it.sku} ${it.name}` : `⚠ Low stock: ${it.sku} ${it.name} — ${it.stock} left`;
          for (const st of alertStaff) {
            await env.DB.prepare(
              `INSERT INTO notifications (user_id, kind, message, ref) VALUES (?1, 'stock', ?2, ?3)`,
            ).bind(st.id, msg, `stock:${it.id}`).run();
          }
          await env.DB.prepare(`UPDATE inventory_items SET low_alerted = ?1 WHERE id = ?2`).bind(it.stock, it.id).run();
        }
      }
      await env.DB.prepare(`UPDATE inventory_items SET low_alerted = NULL WHERE stock > 5 AND low_alerted IS NOT NULL`).run();
    } catch (e) {
      if (!String(e).includes("no such column")) await logError(env, "lowstock_cron", e instanceof Error ? e.message : String(e));
    }
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const cors = corsHeaders(env);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    // Origin check on mutating requests (CSRF mitigation alongside SameSite)
    if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) {
      const origin = request.headers.get("Origin");
      if (origin && origin !== env.ALLOWED_ORIGIN) {
        return errorResponse("forbidden_origin", "Origin not allowed", 403);
      }
    }

    let res: Response;
    try {
      res = await route(request, env, path);
    } catch (err) {
      console.error(err);
      // Name the actual failure (v1.4.68): a D1/SQL message like "no such
      // column" turns a blind 500 into a one-look diagnosis. Message only —
      // no stack, no query text beyond what the engine includes.
      const detail = err instanceof Error ? err.message.slice(0, 300) : String(err).slice(0, 300);
      // v1.4.72: unexpected 500s land in the error log so /admin sees them
      // before staff report them.
      await logError(env, "api", detail, path);
      res = errorResponse("internal", `Something went wrong: ${detail}`, 500);
    }
    // attach CORS to every response
    const headers = new Headers(res.headers);
    for (const [k, v] of Object.entries(cors)) headers.set(k, v as string);
    return new Response(res.body, { status: res.status, headers });
  },
} satisfies ExportedHandler<Env>;

async function route(request: Request, env: Env, path: string): Promise<Response> {
  const method = request.method;

  /* ---- public ---- */

  if (path === "/api/v1/health" && method === "GET") {
    return json({ ok: true, service: "azoneofficial-api" });
  }

  if (path === "/api/v1/content-public" && method === "GET") {
    const { results } = await env.DB.prepare(
      `SELECT key, value FROM site_content`,
    ).all();
    return json(
      { content: results },
      200,
      { "Cache-Control": "public, max-age=60" },
    );
  }

  if (path === "/api/v1/enquiries" && method === "POST") {
    const allowed = await checkRateLimit(env, `enquiry:${clientIp(request)}`, 5, 3600);
    if (!allowed) {
      return errorResponse("rate_limited", "Too many submissions — please try again later or WhatsApp us", 429);
    }
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || !isNonEmptyString(body.name, 120) || !isNonEmptyString(body.message, 4000)) {
      return errorResponse("invalid_input", "name and message are required", 400);
    }
    await env.DB.prepare(
      `INSERT INTO enquiries (name, company, phone, email, message)
       VALUES (?1, ?2, ?3, ?4, ?5)`,
    )
      .bind(
        (body.name as string).trim(),
        isNonEmptyString(body.company, 200) ? body.company : null,
        isNonEmptyString(body.phone, 40) ? body.phone : null,
        isNonEmptyString(body.email, 200) ? body.email : null,
        (body.message as string).trim(),
      )
      .run();
    return json({ ok: true }, 201);
  }

  /* ---- auth ---- */

  /* ---- TikTok Shop order webhook (v1.4.40) ----
     Receives order events and moves inventory + creates postage records
     automatically. Configure the same secret in TikTok Seller Center (or the
     relay you use) and as a Worker secret:
       npx wrangler secret put TIKTOK_WEBHOOK_SECRET
     Expected JSON body:
       { "order_id": "5790…", "status": "awaiting_shipment" | "cancelled" | "returned",
         "items": [ { "sku": "AZ-001", "qty": 2 }, … ] }
     - awaiting_shipment (or "paid"/"new"): creates postage record TT-{order_id}
       and deducts stock per SKU (all-or-nothing; on shortage the record is
       still created with a note so the order is tracked, but nothing deducts)
     - cancelled/returned: restocks that order's lines, once. */
  /* ---- TikTok status + manual sync (v1.4.48) ----
     Webhooks only push orders created AFTER the subscription goes live, so
     "Sync from TikTok" backfills the last 30 days via Get Order List. */
  if (path === "/api/v1/integrations/tiktok/status" && method === "GET") {
    const me = await getSessionUser(request, env);
    if (!me || me.role === "customer") return errorResponse("unauthorized", "Sign in required", 401);
    const tok = await tiktokToken(env);
    const last = await env.DB.prepare(
      `SELECT created_at, verified FROM webhook_events WHERE provider = 'tiktok' ORDER BY id DESC LIMIT 1`,
    ).first<{ created_at: string; verified: number }>();
    /* v1.4.212 (approved architecture review): two ADDITIVE keys for the
       new Connection-status card — existing keys and consumers untouched.
       last_order_at = newest synced TikTok order (webhook or sync);
       failed_events_7d = signature-verification failures this week (>0
       usually means the stored app secret is stale — the known fix is
       re-copy → wrangler secret put TIKTOK_APP_SECRET → deploy). */
    const lastOrder = await env.DB.prepare(
      `SELECT MAX(created_at) AS at FROM postage_records WHERE order_ref LIKE 'TT-%'`,
    ).first<{ at: string | null }>();
    const failed7 = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM webhook_events
       WHERE provider = 'tiktok' AND verified = 0 AND created_at >= datetime('now', '-7 days')`,
    ).first<{ n: number }>();
    /* v1.4.217: the CEO fixed the secret but the card still showed the
       warning — the 7-day counter and "last event" verdict are HISTORY and
       stay red until the NEXT webhook arrives. These two additive keys let
       the card tell "fixed, waiting for the next event" apart from "still
       broken": if the newest VERIFIED event is more recent than the newest
       failure, the secret is provably working again. */
    const lastOk = await env.DB.prepare(
      `SELECT MAX(created_at) AS at FROM webhook_events WHERE provider = 'tiktok' AND verified = 1`,
    ).first<{ at: string | null }>();
    const lastFail = await env.DB.prepare(
      `SELECT MAX(created_at) AS at FROM webhook_events WHERE provider = 'tiktok' AND verified = 0`,
    ).first<{ at: string | null }>();
    return json({
      configured: Boolean(env.TIKTOK_APP_KEY && env.TIKTOK_APP_SECRET),
      authorized: Boolean(tok),
      last_event_at: last?.created_at ?? null,
      last_event_verified: last ? Boolean(last.verified) : null,
      last_order_at: lastOrder?.at ?? null,
      failed_events_7d: failed7?.n ?? 0,
      last_verified_at: lastOk?.at ?? null,
      last_failed_at: lastFail?.at ?? null,
    });
  }

  /* v1.4.220 (CEO: failures continue AFTER the secret update — waiting is
     no longer the answer): replay the newest failed webhook against the
     secret the worker is running RIGHT NOW and return a verdict. Note the
     ~30-min failure cadence is TikTok RETRYING the same undelivered event
     (it re-sends until it receives a 200), so the counter climbs until
     verification passes once. Scheme-B replays skip the 5-minute
     freshness check — the point is the HMAC, not the age. */
  if (path === "/api/v1/integrations/tiktok/webhook-debug" && method === "GET") {
    const me = await getSessionUser(request, env);
    if (!me || !["ceo", "coo", "admin", "super_admin"].includes(me.role)) {
      return errorResponse("forbidden", "Management access required", 401);
    }
    const ev = await env.DB.prepare(
      `SELECT created_at, headers, body FROM webhook_events
       WHERE provider = 'tiktok' AND verified = 0 ORDER BY id DESC LIMIT 1`,
    ).first<{ created_at: string; headers: string; body: string }>();
    if (!ev) return json({ state: "no_failures" });
    let hdrs: { signature?: string; relay?: string } = {};
    try { hdrs = JSON.parse(ev.headers) as typeof hdrs; } catch { hdrs = {}; }
    const sig = hdrs.signature ?? "absent";
    const relayPresent = hdrs.relay === "present";
    if (sig === "present") {
      // Legacy row from before this release — the value wasn't stored yet.
      return json({ state: "insufficient_data", event_at: ev.created_at, relay_header: relayPresent });
    }
    if (sig === "absent" || !sig) {
      return json({ state: "no_signature_header", event_at: ev.created_at, relay_header: relayPresent });
    }
    let scheme: "A" | "B" = "A";
    let hmacOk = false;
    if (env.TIKTOK_APP_SECRET && env.TIKTOK_APP_KEY) {
      if (!sig.includes("=")) {
        const expected = await hmacHex(env.TIKTOK_APP_SECRET, env.TIKTOK_APP_KEY + ev.body);
        hmacOk = timingSafeEqual(expected, sig.trim());
      } else {
        scheme = "B";
        const parts = Object.fromEntries(
          sig.trim().split(",").map((kv) => kv.split("=").map((x) => x.trim()) as [string, string]),
        );
        if (parts.t && parts.s) {
          const expected = await hmacHex(env.TIKTOK_APP_SECRET, `${parts.t}${ev.body}`);
          hmacOk = timingSafeEqual(expected, parts.s);
        }
      }
    }
    return json({
      state: "replayed",
      event_at: ev.created_at,
      scheme,
      relay_header: relayPresent,
      current_secret_verifies: hmacOk,
    });
  }

  if (path === "/api/v1/integrations/tiktok/sync" && method === "POST") {
    const me = await getSessionUser(request, env);
    const SYNC_ROLES = ["super_admin", "admin", "ceo", "coo", "cco", "sales_marketing", "marketing", "hr_admin"];
    if (!me || !SYNC_ROLES.includes(me.role)) {
      return errorResponse("forbidden", "Inventory access required", 403);
    }
    const r = await runTikTokSync(env, me.id);
    if (!r.ok) return errorResponse(r.code, r.message, r.status);
    return json(r);
  }

  if (path === "/api/v1/integrations/tiktok/webhook" && method === "POST") {
    // TikTok signs its own requests (tiktok-signature); a relay such as
    // Make/Zapier can instead send x-webhook-secret. Either proves origin.
    const rawBody = await request.text();
    const sigHeader = request.headers.get("tiktok-signature") ?? request.headers.get("Tiktok-Signature") ?? request.headers.get("authorization") ?? request.headers.get("Authorization") ?? request.headers.get("x-ttc-signature") ?? "";
    const relaySecret = request.headers.get("x-webhook-secret") ?? "";
    const viaTikTok = sigHeader ? await verifyTikTokSignature(env, sigHeader, rawBody) : false;
    const viaRelay = Boolean(env.TIKTOK_WEBHOOK_SECRET) && relaySecret === env.TIKTOK_WEBHOOK_SECRET;
    const verified = viaTikTok || viaRelay;

    const body = (() => {
      try { return JSON.parse(rawBody) as Record<string, unknown>; } catch { return null; }
    })();
    // TikTok wraps the payload: { type, shop_id, timestamp, data: {...} }.
    const data = (body?.data ?? body ?? {}) as Record<string, unknown>;
    const orderId = String(data.order_id ?? data.orderId ?? "").trim();
    const rawStatus = String(data.order_status ?? data.status ?? "").toLowerCase();

    // Always record the receipt — including unverified ones — so a signature
    // mismatch is visible and diagnosable instead of silently dropped.
    await env.DB.prepare(
      `INSERT INTO webhook_events (provider, event_type, order_ref, verified, headers, body)
       VALUES ('tiktok', ?1, ?2, ?3, ?4, ?5)`,
    ).bind(
      String(body?.type ?? "unknown"),
      orderId ? `TT-${orderId}` : null,
      verified ? 1 : 0,
      /* v1.4.220: store the actual signature value — it is derived and
         public in transit, and without it a failed event can never be
         replayed against a corrected secret to prove the fix. */
      JSON.stringify({ signature: sigHeader || "absent", relay: relaySecret ? "present" : "absent" }),
      rawBody.slice(0, 4000),
    ).run();

    if (!verified) {
      return errorResponse("unauthorized", "Signature verification failed", 401);
    }
    if (!orderId) return json({ ok: true, ignored: "no order_id" });

    const orderRef = `TT-${orderId.slice(0, 64)}`;
    const existing = await env.DB.prepare(
      `SELECT id, restocked FROM postage_records WHERE order_ref = ?1`,
    ).bind(orderRef).first<{ id: number; restocked: number }>();

    // TikTok status codes: 100/AWAITING_SHIPMENT etc. Treat "new order" states
    // as stock-out, cancellation/return states as stock-in.
    const outbound = ["awaiting_shipment", "awaiting_collection", "paid", "unpaid", "new", "100", "111"];
    const reversal = ["cancelled", "canceled", "returned", "refunded", "140", "capture_failed"];

    if (outbound.some((k) => rawStatus.includes(k))) {
      if (existing) return json({ ok: true, duplicate: true });
      // Line items are not in the webhook — fetch them from the Order API.
      const detail = await tiktokOrderItems(env, orderId);
      const lines = detail.items;
      const resolved: { id: number; qty: number; unit_sale_cents: number | null }[] = [];
      const unknown: string[] = [];
      const shortages: string[] = [];
      const nameMatched: string[] = [];
      for (const l of lines) {
        // v1.4.162: SKU first, item-name fallback (see matchInventoryItem)
        const item = await matchInventoryItem(env, l.sku, l.name, l.variant);
        if (!item) { unknown.push(`${l.qty}× ${l.sku || l.name}`); continue; }
        if (item.via === "name") nameMatched.push(item.name);
        if (item.stock < l.qty) shortages.push(`${item.name}: ${item.stock} in stock, order needs ${l.qty}`);
        resolved.push({ id: item.id, qty: l.qty, unit_sale_cents: l.unit_sale_cents });
      }
      const canDeduct = shortages.length === 0 && resolved.length > 0;
      const notes = ["TikTok order (auto)"];
      if (lines.length === 0) notes.push("items not retrieved — authorize the app to enable stock movement");
      if (nameMatched.length) notes.push(`matched by item name: ${nameMatched.join(", ")}`);
      if (unknown.length) notes.push(`not in inventory (SKU or name): ${unknown.join(", ")}`);
      if (!canDeduct && shortages.length) notes.push(`NOT deducted — ${shortages.join("; ")}`);

      const rec = await env.DB.prepare(
        `INSERT INTO postage_records (order_ref, courier, buyer_city, status, note, updated_by)
         VALUES (?1, 'TikTok', ?2, 'preparing', ?3, NULL) RETURNING id`,
      ).bind(orderRef, detail.city, notes.join(" · ")).first<{ id: number }>();
      if (canDeduct) {
        for (const l of resolved) {
          const upd = await env.DB.prepare(
            `UPDATE inventory_items SET stock = stock - ?1, updated_at = datetime('now') WHERE id = ?2 AND stock >= ?1`,
          ).bind(l.qty, l.id).run();
          if (upd.meta.changes) {
            // v1.4.166: movement carries the actual sold price; rebate auto-syncs
            await recordTiktokLine(env, rec!.id, l.id, l.qty, l.unit_sale_cents);
            await env.DB.prepare(
              `UPDATE inventory_items SET status = CASE WHEN stock = 0 THEN 'out_of_stock' WHEN stock <= 5 THEN 'low' ELSE 'in_stock' END WHERE id = ?1`,
            ).bind(l.id).run();
            await audit(env, null, "inventory.out", "inventory_items", String(l.id), { qty: l.qty, unit_sale_cents: l.unit_sale_cents, order: orderRef, source: "tiktok" });
          }
        }
      }
      await audit(env, null, "tiktok.order", "postage_records", String(rec?.id), { status: rawStatus, deducted: canDeduct });
      return json({ ok: true, order_ref: orderRef, deducted: canDeduct, unknown_skus: unknown, shortages }, 201);
    }

    if (reversal.some((k) => rawStatus.includes(k))) {
      if (!existing) return json({ ok: true, ignored: "unknown order" });
      if (!existing.restocked) {
        const { results } = await env.DB.prepare(
          `SELECT inventory_item_id, qty FROM postage_items WHERE postage_id = ?1`,
        ).bind(existing.id).all();
        for (const l of results as { inventory_item_id: number; qty: number }[]) {
          await env.DB.prepare(
            `UPDATE inventory_items SET stock = stock + ?1,
               status = CASE WHEN stock + ?1 <= 5 THEN 'low' ELSE 'in_stock' END,
               updated_at = datetime('now') WHERE id = ?2`,
          ).bind(l.qty, l.inventory_item_id).run();
          await audit(env, null, "inventory.in", "inventory_items", String(l.inventory_item_id), { qty: l.qty, reason: rawStatus, source: "tiktok" });
        }
        await env.DB.prepare(
          `UPDATE postage_records SET status = 'returned', restocked = 1, updated_at = datetime('now') WHERE id = ?1`,
        ).bind(existing.id).run();
      }
      await audit(env, null, "tiktok.order_reversal", "postage_records", String(existing.id), { status: rawStatus });
      return json({ ok: true, restocked: true });
    }
    // Shipping/other status updates: keep the tracker current without moving stock.
    if (existing && rawStatus) {
      await env.DB.prepare(
        `UPDATE postage_records SET status = ?1, updated_at = datetime('now') WHERE id = ?2`,
      ).bind(rawStatus.includes("delivered") ? "delivered" : rawStatus.includes("ship") ? "shipped" : "preparing", existing.id).run();
    }
    return json({ ok: true, status: rawStatus });
  }

  /* ---- TikTok seller authorization callback (v1.4.44) ----
     Point the app's Redirect URL here. TikTok returns ?code=…; this exchanges
     it for the access token that lets order webhooks resolve line items. */
  if (path === "/api/v1/integrations/tiktok/callback" && method === "GET") {
    if (!env.TIKTOK_APP_KEY || !env.TIKTOK_APP_SECRET) {
      return errorResponse("not_configured", "TikTok app credentials are not set", 503);
    }
    const code = new URL(request.url).searchParams.get("code");
    if (!code) return errorResponse("invalid_input", "Missing authorization code", 400);
    const tokenUrl = new URL("https://auth.tiktok-shops.com/api/v2/token/get");
    tokenUrl.searchParams.set("app_key", env.TIKTOK_APP_KEY);
    tokenUrl.searchParams.set("app_secret", env.TIKTOK_APP_SECRET);
    tokenUrl.searchParams.set("auth_code", code);
    tokenUrl.searchParams.set("grant_type", "authorized_code");
    const res = await fetch(tokenUrl.toString());
    const data = (await res.json().catch(() => null)) as {
      data?: { access_token?: string; refresh_token?: string; access_token_expire_in?: number };
    } | null;
    const tok = data?.data;
    if (!tok?.access_token) return errorResponse("auth_failed", "TikTok did not return an access token", 400);
    await env.DB.prepare(
      `INSERT INTO integration_tokens (provider, access_token, refresh_token, expires_at, updated_at)
       VALUES ('tiktok', ?1, ?2, datetime('now', '+' || ?3 || ' seconds'), datetime('now'))
       ON CONFLICT (provider) DO UPDATE SET
         access_token = ?1, refresh_token = ?2,
         expires_at = datetime('now', '+' || ?3 || ' seconds'), updated_at = datetime('now')`,
    ).bind(tok.access_token, tok.refresh_token ?? null, String(tok.access_token_expire_in ?? 604800)).run();
    // Order APIs need the shop_cipher — resolve and store it immediately.
    const cipherRes = await refreshTikTokShopCipher(env);
    await audit(env, null, "tiktok.authorized", undefined, undefined, { shop_cipher: cipherRes.detail });
    return new Response(
      `<!doctype html><meta charset="utf-8"><body style="font-family:Arial;padding:40px">
       <h2>TikTok Shop connected</h2>
       <p>AZ ONE OFFICIAL can now read order details and move inventory automatically.</p>
       <p><a href="/portal">Back to the staff portal</a></p></body>`,
      { headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
  }

  if (path === "/api/v1/auth/login" && method === "POST") {
    const allowed = await checkRateLimit(env, `login:${clientIp(request)}`, 10, 900);
    if (!allowed) {
      return errorResponse("rate_limited", "Too many attempts — try again in 15 minutes", 429);
    }
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || !isNonEmptyString(body.email, 200) || !isNonEmptyString(body.password, 200)) {
      return errorResponse("invalid_input", "email and password are required", 400);
    }
    const user = await env.DB.prepare(
      `SELECT id, email, name, role, password_hash FROM users
       WHERE email = ?1 AND is_active = 1`,
    )
      .bind((body.email as string).toLowerCase().trim())
      .first<SessionUser & { password_hash: string }>();

    if (!user || !(await verifyPassword(body.password as string, user.password_hash, env.SESSION_PEPPER))) {
      return errorResponse("invalid_credentials", "Email or password is incorrect", 401);
    }

    // Two-factor (v1.4.37): the password alone does not create a session for
    // an account with 2FA on. Issue a short-lived challenge; the session is
    // minted only by POST /auth/2fa/verify with a valid code.
    const twofa = await env.DB.prepare(`SELECT totp_enabled FROM users WHERE id = ?1`)
      .bind(user.id).first<{ totp_enabled: number }>();
    if (twofa?.totp_enabled) {
      const challenge = crypto.randomUUID() + crypto.randomUUID();
      await env.DB.prepare(
        `INSERT INTO twofa_challenges (id, user_id, expires_at)
         VALUES (?1, ?2, datetime('now', '+5 minutes'))`,
      ).bind(await sha256Hex(challenge), user.id).run();
      await audit(env, user.id, "auth.2fa_challenge");
      return json({ twofa_required: true, challenge }, 200);
    }

    const token = await createSession(env, user.id);
    await audit(env, user.id, "auth.login");

    return json(
      { user: { id: user.id, email: user.email, name: user.name, role: user.role } },
      200,
      { "Set-Cookie": sessionCookie(token) },
    );
  }

  /* ---- two-factor authentication (v1.4.37) ---- */

  if (path === "/api/v1/auth/2fa/verify" && method === "POST") {
    const allowed2fa = await checkRateLimit(env, `2fa:${clientIp(request)}`, 10, 900);
    if (!allowed2fa) return errorResponse("rate_limited", "Too many attempts — try again in 15 minutes", 429);
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || !isNonEmptyString(body.challenge, 200) || !isNonEmptyString(body.code, 20)) {
      return errorResponse("invalid_input", "challenge and code are required", 400);
    }
    const id = await sha256Hex(body.challenge as string);
    const ch = await env.DB.prepare(
      `SELECT user_id, attempts FROM twofa_challenges
       WHERE id = ?1 AND expires_at > datetime('now')`,
    ).bind(id).first<{ user_id: number; attempts: number }>();
    if (!ch) return errorResponse("challenge_expired", "This sign-in attempt expired — start again", 401);
    if (ch.attempts >= 5) {
      await env.DB.prepare(`DELETE FROM twofa_challenges WHERE id = ?1`).bind(id).run();
      return errorResponse("too_many_attempts", "Too many incorrect codes — sign in again", 401);
    }
    const row = await env.DB.prepare(
      `SELECT id, email, name, role, totp_secret FROM users WHERE id = ?1 AND is_active = 1`,
    ).bind(ch.user_id).first<SessionUser & { totp_secret: string }>();
    if (!row?.totp_secret) return errorResponse("invalid_state", "Two-factor is not configured", 400);

    const code = (body.code as string).trim();
    let ok = await totpVerify(row.totp_secret, code);
    if (!ok) {
      // Backup code path: single use, matched against stored hashes.
      const hash = await sha256Hex(code.toUpperCase());
      const backup = await env.DB.prepare(
        `SELECT id FROM twofa_backup_codes WHERE user_id = ?1 AND code_hash = ?2 AND used_at IS NULL`,
      ).bind(ch.user_id, hash).first<{ id: number }>();
      if (backup) {
        await env.DB.prepare(`UPDATE twofa_backup_codes SET used_at = datetime('now') WHERE id = ?1`)
          .bind(backup.id).run();
        await audit(env, ch.user_id, "auth.2fa_backup_used");
        ok = true;
      }
    }
    if (!ok) {
      await env.DB.prepare(`UPDATE twofa_challenges SET attempts = attempts + 1 WHERE id = ?1`).bind(id).run();
      return errorResponse("invalid_code", "That code is not correct", 401);
    }
    await env.DB.prepare(`DELETE FROM twofa_challenges WHERE id = ?1`).bind(id).run();
    const token = await createSession(env, row.id);
    await audit(env, row.id, "auth.login_2fa");
    return json(
      { user: { id: row.id, email: row.email, name: row.name, role: row.role } },
      200,
      { "Set-Cookie": sessionCookie(token) },
    );
  }

  if (path === "/api/v1/auth/2fa/status" && method === "GET") {
    const me = await getSessionUser(request, env);
    if (!me) return errorResponse("unauthorized", "Sign in required", 401);
    const row = await env.DB.prepare(`SELECT totp_enabled FROM users WHERE id = ?1`)
      .bind(me.id).first<{ totp_enabled: number }>();
    const codes = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM twofa_backup_codes WHERE user_id = ?1 AND used_at IS NULL`,
    ).bind(me.id).first<{ n: number }>();
    return json({
      enabled: Boolean(row?.totp_enabled),
      eligible: TWOFA_ELIGIBLE(me.role),
      backup_codes_left: codes?.n ?? 0,
    });
  }

  if (path === "/api/v1/auth/2fa/setup" && method === "POST") {
    const me = await getSessionUser(request, env);
    if (!me) return errorResponse("unauthorized", "Sign in required", 401);
    if (!TWOFA_ELIGIBLE(me.role)) {
      return errorResponse("forbidden", "Two-factor is available for staff accounts", 403);
    }
    // A fresh secret each time setup is opened; it only becomes active once a
    // code from it is verified in /enable.
    const secret = randomSecret();
    await env.DB.prepare(`UPDATE users SET totp_secret = ?1 WHERE id = ?2`).bind(secret, me.id).run();
    const label = encodeURIComponent(`AZ ONE OFFICIAL:${me.email}`);
    return json({
      secret,
      otpauth: `otpauth://totp/${label}?secret=${secret}&issuer=AZ%20ONE%20OFFICIAL&digits=6&period=30`,
    });
  }

  if (path === "/api/v1/auth/2fa/enable" && method === "POST") {
    const me = await getSessionUser(request, env);
    if (!me) return errorResponse("unauthorized", "Sign in required", 401);
    if (!TWOFA_ELIGIBLE(me.role)) {
      return errorResponse("forbidden", "Two-factor is available for staff accounts", 403);
    }
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const row = await env.DB.prepare(`SELECT totp_secret FROM users WHERE id = ?1`)
      .bind(me.id).first<{ totp_secret: string | null }>();
    if (!row?.totp_secret) return errorResponse("invalid_state", "Start setup first", 400);
    if (!body || !isNonEmptyString(body.code, 20) || !(await totpVerify(row.totp_secret, body.code as string))) {
      return errorResponse("invalid_code", "That code is not correct — check the time on your phone and try again", 400);
    }
    await env.DB.prepare(`UPDATE users SET totp_enabled = 1 WHERE id = ?1`).bind(me.id).run();
    // Fresh backup codes; the plain values are returned exactly once.
    await env.DB.prepare(`DELETE FROM twofa_backup_codes WHERE user_id = ?1`).bind(me.id).run();
    const codes = makeBackupCodes();
    for (const c of codes) {
      await env.DB.prepare(
        `INSERT INTO twofa_backup_codes (user_id, code_hash) VALUES (?1, ?2)`,
      ).bind(me.id, await sha256Hex(c.toUpperCase())).run();
    }
    await audit(env, me.id, "auth.2fa_enabled");
    return json({ ok: true, backup_codes: codes });
  }

  if (path === "/api/v1/auth/2fa/disable" && method === "POST") {
    const me = await getSessionUser(request, env);
    if (!me) return errorResponse("unauthorized", "Sign in required", 401);
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    // Disabling requires the current password — a stolen session alone
    // cannot strip the second factor off the account.
    const row = await env.DB.prepare(`SELECT password_hash FROM users WHERE id = ?1`)
      .bind(me.id).first<{ password_hash: string }>();
    if (!body || !isNonEmptyString(body.password, 200) || !row ||
        !(await verifyPassword(body.password as string, row.password_hash, env.SESSION_PEPPER))) {
      return errorResponse("invalid_credentials", "Your current password is required", 401);
    }
    await env.DB.prepare(`UPDATE users SET totp_enabled = 0, totp_secret = NULL WHERE id = ?1`).bind(me.id).run();
    await env.DB.prepare(`DELETE FROM twofa_backup_codes WHERE user_id = ?1`).bind(me.id).run();
    await audit(env, me.id, "auth.2fa_disabled");
    return json({ ok: true });
  }

  if (path === "/api/v1/auth/logout" && method === "POST") {
    const raw = getCookie(request, SESSION_COOKIE);
    if (raw) {
      await env.DB.prepare(`DELETE FROM sessions WHERE id = ?1`)
        .bind(await sha256Hex(raw)).run();
    }
    return json({ ok: true }, 200, {
      "Set-Cookie": `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`,
    });
  }

  /* ---- one-time super admin bootstrap ---- */
  // Works ONLY while no super_admin exists AND with the SETUP_TOKEN secret.
  // No emails or passwords are hardcoded anywhere. Self-disables permanently.

  if (path === "/api/v1/auth/setup" && method === "POST") {
    const allowedSetup = await checkRateLimit(env, `setup:${clientIp(request)}`, 5, 3600);
    if (!allowedSetup) return errorResponse("rate_limited", "Too many attempts", 429);

    const existing = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM users WHERE role = 'super_admin'`,
    ).first<{ n: number }>();
    if ((existing?.n ?? 0) > 0) {
      return errorResponse("gone", "Setup already completed", 410);
    }

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (
      !body || typeof body.token !== "string" || !env.SETUP_TOKEN ||
      !timingSafeEqual(body.token, env.SETUP_TOKEN)
    ) {
      return errorResponse("forbidden", "Invalid setup token", 403);
    }
    const emailOk =
      typeof body.email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(body.email);
    if (
      !emailOk || !isNonEmptyString(body.name, 120) ||
      !isNonEmptyString(body.password, 200) || (body.password as string).length < 10
    ) {
      return errorResponse("invalid_input", "email, name, and a password of 10+ characters are required", 400);
    }
    const hash = await createPasswordHash(body.password as string, env.SESSION_PEPPER);
    const res = await env.DB.prepare(
      `INSERT INTO users (email, password_hash, name, role, is_active)
       VALUES (?1, ?2, ?3, 'super_admin', 1) RETURNING id`,
    )
      .bind((body.email as string).toLowerCase().trim(), hash, (body.name as string).trim())
      .first<{ id: number }>();
    await audit(env, res?.id ?? null, "auth.bootstrap_super_admin", "users", String(res?.id));
    const token = await createSession(env, res!.id);
    return json({ ok: true }, 201, { "Set-Cookie": sessionCookie(token) });
  }

  /* ---- self-registration (pending approval) ---- */

  if (path === "/api/v1/auth/register" && method === "POST") {
    const allowedReg = await checkRateLimit(env, `register:${clientIp(request)}`, 5, 3600);
    if (!allowedReg) return errorResponse("rate_limited", "Too many registrations — try again later", 429);

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const emailOk =
      body && typeof body.email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(body.email);
    if (
      !body || !emailOk || !isNonEmptyString(body.name, 120) ||
      !isNonEmptyString(body.password, 200) || (body.password as string).length < 10
    ) {
      return errorResponse("invalid_input", "Valid email, name, and a password of 10+ characters are required", 400);
    }
    const email = (body.email as string).toLowerCase().trim();
    const hash = await createPasswordHash(body.password as string, env.SESSION_PEPPER);
    try {
      // Public registration = customer account, active immediately.
      // Customers can only ever see their own data; staff/admin roles are
      // assigned exclusively by a super admin, so this is safe by design.
      const res = await env.DB.prepare(
        `INSERT INTO users (email, password_hash, name, role, is_active)
         VALUES (?1, ?2, ?3, 'customer', 1) RETURNING id`,
      )
        .bind(email, hash, (body.name as string).trim())
        .first<{ id: number }>();
      await audit(env, res?.id ?? null, "auth.register_customer", "users", String(res?.id));
      const token = await createSession(env, res!.id);
      return json(
        { ok: true, user: { id: res!.id, email, name: (body.name as string).trim(), role: "customer" } },
        201,
        { "Set-Cookie": sessionCookie(token) },
      );
    } catch {
      return errorResponse("conflict", "An account with this email already exists", 409);
    }
  }

  /* ---- Google OAuth ---- */

  const redirectUri = `${env.ALLOWED_ORIGIN}/api/v1/auth/google/callback`;

  if (path === "/api/v1/auth/google" && method === "GET") {
    const state = randomHex(16);
    const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authUrl.searchParams.set("client_id", env.GOOGLE_CLIENT_ID);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("scope", "openid email profile");
    authUrl.searchParams.set("state", state);
    authUrl.searchParams.set("prompt", "select_account");
    return new Response(null, {
      status: 302,
      headers: {
        Location: authUrl.toString(),
        "Set-Cookie": `${OAUTH_STATE_COOKIE}=${state}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600`,
      },
    });
  }

  if (path === "/api/v1/auth/google/callback" && method === "GET") {
    const url2 = new URL(request.url);
    const code = url2.searchParams.get("code");
    const state = url2.searchParams.get("state");
    const cookieState = getCookie(request, OAUTH_STATE_COOKIE);
    const clearState = `${OAUTH_STATE_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;

    if (!code || !state || !cookieState || state !== cookieState) {
      return new Response(null, {
        status: 302,
        headers: { Location: "/admin?error=oauth", "Set-Cookie": clearState },
      });
    }

    // Exchange code for tokens
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });
    const tokens = (await tokenRes.json().catch(() => null)) as { access_token?: string } | null;
    if (!tokenRes.ok || !tokens?.access_token) {
      return new Response(null, {
        status: 302,
        headers: { Location: "/admin?error=oauth", "Set-Cookie": clearState },
      });
    }

    // Fetch verified profile
    const profileRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const profile = (await profileRes.json().catch(() => null)) as
      | { email?: string; email_verified?: boolean; name?: string }
      | null;
    if (!profileRes.ok || !profile?.email || profile.email_verified !== true) {
      return new Response(null, {
        status: 302,
        headers: { Location: "/admin?error=oauth", "Set-Cookie": clearState },
      });
    }

    const email = profile.email.toLowerCase().trim();
    let account = await env.DB.prepare(
      `SELECT id, is_active FROM users WHERE email = ?1`,
    )
      .bind(email)
      .first<{ id: number; is_active: number }>();

    if (!account) {
      // Every self-registration is a CUSTOMER — no exceptions (v1.4.35).
      // Google sign-up previously auto-assigned the "marketing" staff role to
      // company-domain emails; that was an unattended path into the staff
      // side. Staff and admin roles are now granted ONLY by explicit
      // assignment: /admin Users (admin tier) or HR staff creation. A staff
      // member who signs in with Google on an email an admin already
      // elevated keeps their assigned role — that path is unchanged.
      let res: { id: number; is_active: number } | null = null;
      try {
        res = await env.DB.prepare(
          `INSERT INTO users (email, password_hash, name, role, is_active)
           VALUES (?1, 'oauth$google', ?2, 'customer', 1) RETURNING id, is_active`,
        )
          .bind(email, profile.name ?? email)
          .first<{ id: number; is_active: number }>();
      } catch (e) {
        throw new Error(`customer signup insert: ${e instanceof Error ? e.message : String(e)}`);
      }
      account = res!;
      await audit(env, null, "auth.google_signup_customer", "users", String(account.id));
    }

    if (!account.is_active) {
      return new Response(null, {
        status: 302,
        headers: { Location: "/admin?pending=1", "Set-Cookie": clearState },
      });
    }

    const roleRow = await env.DB.prepare(`SELECT role FROM users WHERE id = ?1`)
      .bind(account.id).first<{ role: Role }>();
    const dest =
      roleRow?.role === "customer" ? "/account"
      : ["super_admin", "admin"].includes(roleRow?.role ?? "")
        ? "/admin"
        : "/portal";
    const token = await createSession(env, account.id);
    await audit(env, account.id, "auth.login_google");
    const headers = new Headers({ Location: dest });
    headers.append("Set-Cookie", sessionCookie(token));
    headers.append("Set-Cookie", clearState);
    return new Response(null, { status: 302, headers });
  }

  /* ---- authenticated ---- */

  const user = await getSessionUser(request, env);

  if (path === "/api/v1/auth/change-password" && method === "POST") {
    if (!user) return errorResponse("unauthenticated", "Sign in required", 401);
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (
      !body ||
      !isNonEmptyString(body.current_password, 200) ||
      !isNonEmptyString(body.new_password, 200) ||
      (body.new_password as string).length < 10
    ) {
      return errorResponse("invalid_input", "Current password and a new password of 10+ characters are required", 400);
    }
    const row = await env.DB.prepare(`SELECT password_hash FROM users WHERE id = ?1`)
      .bind(user.id)
      .first<{ password_hash: string }>();
    // Google-only accounts have no password to verify — and letting a hijacked
    // session ADD one would hand the attacker a permanent way in. They manage
    // credentials with Google.
    if (!row || row.password_hash.startsWith("oauth$")) {
      return errorResponse("google_account", "This account signs in with Google and has no password to change", 400);
    }
    const valid = await verifyPassword(body.current_password as string, row.password_hash, env.SESSION_PEPPER);
    if (!valid) return errorResponse("invalid_credentials", "Current password is incorrect", 401);
    const hash = await createPasswordHash(body.new_password as string, env.SESSION_PEPPER);
    await env.DB.prepare(`UPDATE users SET password_hash = ?1 WHERE id = ?2`).bind(hash, user.id).run();
    // Revoke every session (including any attacker's), then re-issue one for
    // this browser so the legitimate user is not logged out by their own change.
    await env.DB.prepare(`DELETE FROM sessions WHERE user_id = ?1`).bind(user.id).run();
    const fresh = await createSession(env, user.id);
    await audit(env, user.id, "auth.change_password");
    return json({ ok: true }, 200, { "Set-Cookie": sessionCookie(fresh) });
  }

  if (path === "/api/v1/auth/me" && method === "GET") {
    if (!user) return errorResponse("unauthenticated", "Sign in required", 401);
    // v1.4.181: oauth = signs in with Google, has no password here. The
    // change-password route already refuses such accounts; this flag lets
    // the UI hide the pointless form instead of showing it with a footnote.
    const ph = await env.DB.prepare(`SELECT password_hash FROM users WHERE id = ?1`)
      .bind(user.id).first<{ password_hash: string }>();
    return json({ user: { ...user, oauth: ph?.password_hash.startsWith("oauth$") ?? false } });
  }

  /* ---- staff portal (all routes require auth) ---- */

  if (path.startsWith("/api/v1/staff/")) {
    if (!user) return errorResponse("unauthenticated", "Sign in required", 401);
    if (user.role === "customer") return errorResponse("forbidden", "Staff access only", 403);
    const staffRes = await handleStaff(
      request, env, path.slice("/api/v1/staff".length), user as StaffUser,
    );
    if (staffRes) return staffRes;
    return errorResponse("not_found", "Staff route not found", 404);
  }

  if (path === "/api/v1/enquiries" && method === "GET") {
    if (!user || !ENQUIRY_ROLES.includes(user.role)) {
      return errorResponse("forbidden", "Business team access required", 403);
    }
    let results: unknown[];
    try {
      results = (await env.DB.prepare(
        `SELECT id, name, company, phone, email, message, category, status, reply, replied_at, assigned_to, created_at
         FROM enquiries ORDER BY created_at DESC LIMIT 100`,
      ).all()).results;
    } catch {
      results = (await env.DB.prepare(
        `SELECT id, name, company, phone, email, message, status, assigned_to, created_at
         FROM enquiries ORDER BY created_at DESC LIMIT 100`,
      ).all()).results;
    }
    return json({ enquiries: results });
  }

  if (path.match(/^\/api\/v1\/enquiries\/\d+$/) && method === "PATCH") {
    if (!user || !ENQUIRY_ROLES.includes(user.role)) {
      return errorResponse("forbidden", "Business team access required", 403);
    }
    const id = path.split("/").pop()!;
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const allowed = ["new", "contacted", "qualified", "closed"];
    const hasStatus = typeof body?.status === "string" && allowed.includes(body.status);
    /* v1.4.191 (CEO gap list): IN-APP REPLY — staff answer inside the portal
       and the customer reads it on /account. Sending a reply auto-marks the
       enquiry contacted (unless a further status is set in the same call). */
    const hasReply = typeof body?.reply === "string" && body.reply.trim() !== "";
    if (!body || (!hasStatus && !hasReply)) {
      return errorResponse("invalid_input", `Provide reply text and/or status (${allowed.join(", ")})`, 400);
    }
    if (hasReply) {
      try {
        await env.DB.prepare(
          `UPDATE enquiries SET reply = ?1, replied_by = ?2, replied_at = datetime('now'),
             status = COALESCE(?3, CASE WHEN status = 'new' THEN 'contacted' ELSE status END)
           WHERE id = ?4`,
        ).bind((body.reply as string).trim().slice(0, 2000), user.id, hasStatus ? body.status : null, id).run();
      } catch (e) {
        if (String(e).includes("no such column")) return errorResponse("migration_missing", "Run: npx wrangler d1 migrations apply azoneofficial --remote (0055_enquiry_reply)", 500);
        throw e;
      }
    } else {
      await env.DB.prepare(`UPDATE enquiries SET status = ?1 WHERE id = ?2`).bind(body.status, id).run();
    }
    await audit(env, user.id, "enquiry.update_status", "enquiries", id, { ...(hasStatus ? { status: body.status } : {}), ...(hasReply ? { replied: true } : {}) });
    return json({ ok: true });
  }

  /* v1.4.197 (CEO, from his LIVE Center screenshots: "I want to bring this
     data into my dashboard too, possible?"): TikTok Shop ANALYTICS — shop
     LIVE performance (GMV, viewers, likes, comments, shares, followers…)
     via GET /analytics/202508/shop_lives/overview_performance. Same signed
     API; needs the Data & Insights (Analytics) SCOPE granted + re-authorize
     — until then TikTok's own error message is surfaced honestly. LIVE
     Rewards (diamonds) is creator-side monetisation and is NOT in the Shop
     API — deliberately absent. Cached in system_meta for 30 min so staff
     views never hammer TikTok. Any signed-in staff role may read (same
     motivation principle as /staff/gmv). */
  if (path === "/api/v1/live-analytics" && method === "GET") {
    if (!user || user.role === "customer") return errorResponse("forbidden", "Staff access required", 403);
    // 30-min cache
    try {
      const cached = await env.DB.prepare(`SELECT value FROM system_meta WHERE key = 'live_analytics_cache'`)
        .first<{ value: string }>();
      if (cached?.value) {
        const c = JSON.parse(cached.value) as { fetched_at: number; payload: unknown };
        if (Date.now() - c.fetched_at < 30 * 60 * 1000) return json({ cached: true, ...(c.payload as Record<string, unknown>) });
      }
    } catch { /* no cache / pre-0057 */ }
    const mytNow = new Date(Date.now() + 8 * 3600 * 1000);
    const end = new Date(mytNow.getTime() + 24 * 3600 * 1000).toISOString().slice(0, 10); // end_date_lt is exclusive
    const start = new Date(mytNow.getTime() - 6 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const data = (await tiktokSignedFetch(env, "/analytics/202508/shop_lives/overview_performance", {
      // v1.4.200: this endpoint only accepts USD or LOCAL — LOCAL = the
      // shop's own currency (MYR for us). "MYR" itself is rejected.
      start_date_ge: start, end_date_lt: end, granularity: "1D", account_type: "ALL", currency: "LOCAL",
    })) as { code?: number; message?: string; data?: Record<string, unknown> } | null;
    if (!data) return json({ error: "TikTok connection not configured — connect the shop first." });
    if (typeof data.code === "number" && data.code !== 0) {
      // Show TikTok's words; add the scope hint only when it reads like a
      // permission problem (v1.4.200 — a param error got the wrong hint).
      const msg = data.message ?? "analytics request refused";
      const scopeHint = /scope|permission|auth|access/i.test(msg)
        ? " — grant the Data & Insights (Analytics) scope in Partner Center, then re-authorize."
        : "";
      return json({ error: `TikTok: ${msg}${scopeHint}` });
    }
    // Tolerant metric extraction: walk the payload for the known metric names
    // wherever TikTok nests them; log the STRUCTURE (keys only) if none found.
    const metrics: Record<string, number> = {};
    const wanted = new Set(["gmv", "views", "likes", "comments", "shares", "new_followers", "followers", "units_sold", "sku_orders", "unique_buyers", "live_count", "duration", "avg_view_duration", "impressions", "unique_viewers", "customers", "orders"]);
    const walk = (node: unknown, depth: number) => {
      if (depth > 6 || node === null || typeof node !== "object") return;
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        const key = k.toLowerCase();
        if (wanted.has(key) && metrics[key] === undefined) {
          if (typeof v === "number") metrics[key] = v;
          else if (typeof v === "string" && v !== "" && !Number.isNaN(Number(v))) metrics[key] = Number(v);
          else if (v && typeof v === "object" && "amount" in (v as Record<string, unknown>)) {
            const amt = (v as { amount?: string | number }).amount;
            if (amt !== undefined && !Number.isNaN(Number(amt))) metrics[key] = Number(amt);
          }
        }
        if (v && typeof v === "object") walk(v, depth + 1);
      }
    };
    walk(data.data ?? {}, 0);
    if (Object.keys(metrics).length === 0) {
      await logError(env, "tiktok_live_analytics", `no known metrics; top keys=[${Object.keys(data.data ?? {}).join(",")}]`);
    }
    const payload = { metrics, range: { start, end }, fetched_at_myt: new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 16).replace("T", " ") };
    try {
      await env.DB.prepare(
        `INSERT INTO system_meta (key, value) VALUES ('live_analytics_cache', ?1)
         ON CONFLICT (key) DO UPDATE SET value = ?1`,
      ).bind(JSON.stringify({ fetched_at: Date.now(), payload })).run();
    } catch { /* pre-0057 — uncached is fine */ }
    return json(payload);
  }

  /* v1.4.191 (CEO gap list): OFF-CLOUDFLARE EXPORT — stream the newest R2
     backup for download so a copy lives OUTSIDE this Cloudflare account
     (ransomware / account-loss insurance). Records the export moment in
     system_meta so /admin can nag when a quarter passes. */
  if (path === "/api/v1/system/backup/download" && method === "GET") {
    if (!atLeast(user, "super_admin")) return errorResponse("forbidden", "Super admin required", 403);
    const listed = await env.MEDIA.list({ prefix: "backups/" });
    const newest = listed.objects.sort((a, b) => b.key.localeCompare(a.key))[0];
    if (!newest) return errorResponse("not_found", "No backup exists yet — press Back up now first", 404);
    const obj = await env.MEDIA.get(newest.key);
    if (!obj) return errorResponse("not_found", "Backup object missing", 404);
    try {
      await env.DB.prepare(
        `INSERT INTO system_meta (key, value) VALUES ('last_offsite_export', datetime('now'))
         ON CONFLICT (key) DO UPDATE SET value = datetime('now')`,
      ).run();
    } catch { /* pre-0057 — download still works */ }
    await audit(env, user.id, "system.backup_export", "system", newest.key);
    return new Response(obj.body, {
      headers: {
        "Content-Type": "application/gzip",
        "Content-Disposition": `attachment; filename="${newest.key.split("/").pop()}"`,
      },
    });
  }

  /* ---- system health (v1.4.72): error log + backup status ---- */

  if (path === "/api/v1/system/health" && method === "GET") {
    if (!atLeast(user, "ceo")) return errorResponse("forbidden", "Admin or CEO required", 403);
    let errors: unknown[] = [];
    try {
      const { results } = await env.DB.prepare(
        `SELECT id, created_at, source, message, path FROM error_log ORDER BY id DESC LIMIT 20`,
      ).all();
      errors = results;
    } catch { /* migration 0024 not applied yet — show empty rather than fail */ }
    let last_backup: { key: string; size: number; uploaded: string } | null = null;
    try {
      const listed = await env.MEDIA.list({ prefix: "backups/" });
      const newest = listed.objects.sort((a, b) => b.key.localeCompare(a.key))[0];
      if (newest) last_backup = { key: newest.key, size: newest.size, uploaded: newest.uploaded.toISOString() };
    } catch { /* keep null */ }
    let last_offsite: string | null = null;
    try {
      const meta = await env.DB.prepare(`SELECT value FROM system_meta WHERE key = 'last_offsite_export'`)
        .first<{ value: string }>();
      last_offsite = meta?.value ?? null;
    } catch { /* pre-0057 */ }
    return json({ errors, last_backup, last_offsite });
  }

  if (path === "/api/v1/system/backup" && method === "POST") {
    if (!atLeast(user, "ceo")) return errorResponse("forbidden", "Admin or CEO required", 403);
    const res = await runBackup(env, user.id);
    if (!res.ok) return errorResponse("backup_failed", res.message, 502);
    return json(res);
  }

  if (path === "/api/v1/audit" && method === "GET") {
    // Audit trail viewer — admin tier only. Reads the log every consequential
    // action already writes to (logins, approvals, role changes, resets).
    if (!atLeast(user, "admin")) return errorResponse("forbidden", "Admin required", 403);
    const url = new URL(request.url);
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 100), 300);
    const action = url.searchParams.get("action");
    const rows = action
      ? await env.DB.prepare(
          `SELECT a.id, a.action, a.entity, a.entity_id, a.detail, a.created_at, u.name AS user_name
           FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
           WHERE a.action LIKE ?1 || '%' ORDER BY a.id DESC LIMIT ?2`,
        ).bind(action, limit).all()
      : await env.DB.prepare(
          `SELECT a.id, a.action, a.entity, a.entity_id, a.detail, a.created_at, u.name AS user_name
           FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
           ORDER BY a.id DESC LIMIT ?1`,
        ).bind(limit).all();
    return json({ entries: rows.results });
  }

  if (path === "/api/v1/dashboard/summary" && method === "GET") {
    if (!isContentTeam(user)) {
      return errorResponse("forbidden", "Sign in required", 403);
    }
    const enquiries = await env.DB.prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN status = 'new' THEN 1 ELSE 0 END) AS new_count
       FROM enquiries`,
    ).first();
    const posts = await env.DB.prepare(`SELECT COUNT(*) AS total FROM posts`).first();
    const portfolio = await env.DB.prepare(`SELECT COUNT(*) AS total FROM portfolio_items`).first();
    const testimonials = await env.DB.prepare(`SELECT COUNT(*) AS total FROM testimonials`).first();
    const { results: activity } = await env.DB.prepare(
      `SELECT a.action, a.entity, a.entity_id, a.created_at, u.name AS user_name
       FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
       ORDER BY a.created_at DESC LIMIT 15`,
    ).all();
    return json({ enquiries, posts, portfolio, testimonials, activity });
  }

  /* ---- customer account ---- */

  if (path === "/api/v1/account/enquiries" && method === "POST") {
    if (!user) return errorResponse("unauthenticated", "Sign in required", 401);
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || !isNonEmptyString(body.message, 4000)) {
      return errorResponse("invalid_input", "A message is required", 400);
    }
    // Tie the enquiry to the signed-in customer automatically — staff see who
    // asked without the customer re-typing their details.
    /* v1.4.181 (CEO): category so the team triages package/service questions
       at a glance, and the business team is bell-notified THE MOMENT the
       enquiry lands — a customer contacting AZ ONE gets a fast human. */
    const cats = ["general", "package_pricing", "live_commerce", "order_delivery", "collaboration"];
    const category = typeof body.category === "string" && cats.includes(body.category) ? body.category : "general";
    let enqId: number | null = null;
    try {
      const r1 = await env.DB.prepare(
        `INSERT INTO enquiries (name, company, phone, email, message, category)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6) RETURNING id`,
      ).bind(
        user.name,
        isNonEmptyString(body.company, 200) ? body.company : null,
        isNonEmptyString(body.phone, 40) ? body.phone : null,
        user.email,
        (body.message as string).trim(),
        category,
      ).first<{ id: number }>();
      enqId = r1?.id ?? null;
    } catch (e) {
      if (!String(e).includes("no such column")) throw e;
      const r1 = await env.DB.prepare(
        `INSERT INTO enquiries (name, company, phone, email, message)
         VALUES (?1, ?2, ?3, ?4, ?5) RETURNING id`,
      ).bind(
        user.name,
        isNonEmptyString(body.company, 200) ? body.company : null,
        isNonEmptyString(body.phone, 40) ? body.phone : null,
        user.email,
        (body.message as string).trim(),
      ).first<{ id: number }>();
      enqId = r1?.id ?? null;
    }
    try {
      const catLabel: Record<string, string> = {
        general: "general", package_pricing: "package & pricing", live_commerce: "live commerce services",
        order_delivery: "order & delivery", collaboration: "collaboration",
      };
      const { results: staffRows } = await env.DB.prepare(
        `SELECT id FROM users WHERE is_active = 1 AND role IN ('sales_marketing', 'marketing', 'ceo')`,
      ).all<{ id: number }>();
      for (const st of staffRows) {
        await env.DB.prepare(
          `INSERT INTO notifications (user_id, kind, message, ref) VALUES (?1, 'enquiry', ?2, ?3)`,
        ).bind(st.id, `New customer enquiry (${catLabel[category]}): ${user.name}`, `enquiry:${enqId ?? ""}`).run();
      }
    } catch { /* notifications are best-effort — the enquiry itself is saved */ }
    await audit(env, user.id, "account.enquiry", "enquiries", enqId ? String(enqId) : undefined, { category });
    return json({ ok: true }, 201);
  }

  if (path === "/api/v1/account/enquiries" && method === "GET") {
    if (!user) return errorResponse("unauthenticated", "Sign in required", 401);
    // Email ownership is only proven for Google sign-ins. Password accounts
    // see just the enquiries submitted after their registration, so nobody
    // can register a stranger's email and read that person's history.
    const acct = await env.DB.prepare(
      `SELECT password_hash, created_at FROM users WHERE id = ?1`,
    ).bind(user.id).first<{ password_hash: string; created_at: string }>();
    const verified = acct?.password_hash.startsWith("oauth$") ?? false;
    let results: unknown[];
    try {
      results = (await env.DB.prepare(
        verified
          ? `SELECT id, message, category, status, reply, replied_at, created_at FROM enquiries
             WHERE email = ?1 ORDER BY created_at DESC LIMIT 50`
          : `SELECT id, message, category, status, reply, replied_at, created_at FROM enquiries
             WHERE email = ?1 AND created_at >= ?2 ORDER BY created_at DESC LIMIT 50`,
      ).bind(...(verified ? [user.email] : [user.email, acct?.created_at ?? ""])).all()).results;
    } catch {
      results = (await env.DB.prepare(
        verified
          ? `SELECT id, message, status, created_at FROM enquiries
             WHERE email = ?1 ORDER BY created_at DESC LIMIT 50`
          : `SELECT id, message, status, created_at FROM enquiries
             WHERE email = ?1 AND created_at >= ?2 ORDER BY created_at DESC LIMIT 50`,
      ).bind(...(verified ? [user.email] : [user.email, acct?.created_at ?? ""])).all()).results;
    }
    return json({ enquiries: results });
  }

  /* ---- site content ---- */



  const contentMatch = path.match(/^\/api\/v1\/content\/([\w.\-]+)$/);
  if (contentMatch) {
    const key = contentMatch[1]!;
    if (method === "GET") {
      const row = await env.DB.prepare(`SELECT key, value, updated_at FROM site_content WHERE key = ?1`)
        .bind(key)
        .first();
      if (!row) return errorResponse("not_found", "No content for this key", 404);
      return json(row);
    }
    if (method === "PUT") {
      if (!isContentTeam(user)) return errorResponse("forbidden", "Editor role or above required", 403);
      const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
      if (!body || typeof body.value === "undefined") {
        return errorResponse("invalid_input", "value is required", 400);
      }
      await env.DB.prepare(
        `INSERT INTO site_content (key, value, updated_by, updated_at)
         VALUES (?1, ?2, ?3, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value = ?2, updated_by = ?3, updated_at = datetime('now')`,
      )
        .bind(key, JSON.stringify(body.value), user.id)
        .run();
      await audit(env, user.id, "content.update", "site_content", key);
      return json({ ok: true });
    }
  }

  /* ---- media (R2) ---- */

  const mediaServe = path.match(/^\/api\/v1\/media\/file\/(.+)$/);
  if (mediaServe && method === "GET") {
    const key = decodeURIComponent(mediaServe[1]!);
    // Keys under private/ (e.g. medical certificates) require staff auth.
    if (key.startsWith("private/") && (!user || user.role === "customer")) {
      return errorResponse("forbidden", "Staff access required", 403);
    }
    const obj = await env.MEDIA.get(key);
    if (!obj) return errorResponse("not_found", "File not found", 404);
    const headers = new Headers();
    obj.writeHttpMetadata(headers);
    headers.set("Cache-Control", "public, max-age=31536000, immutable");
    return new Response(obj.body, { headers });
  }

  if (path === "/api/v1/media" && method === "GET") {
    if (!isContentTeam(user)) return errorResponse("forbidden", "Editor role or above required", 403);
    const { results } = await env.DB.prepare(
      `SELECT id, r2_key, kind, alt, created_at FROM media ORDER BY created_at DESC LIMIT 200`,
    ).all();
    return json({ media: results });
  }

  if (path === "/api/v1/media" && method === "POST") {
    if (!isContentTeam(user)) return errorResponse("forbidden", "Editor role or above required", 403);
    const url2 = new URL(request.url);
    const filename = (url2.searchParams.get("filename") ?? "upload.bin").replace(/[^\w.\-]/g, "_");
    const kind = url2.searchParams.get("kind") ?? "image";
    if (!["image", "video", "document", "logo"].includes(kind)) {
      return errorResponse("invalid_input", "kind must be image|video|document|logo", 400);
    }
    if (!request.body) return errorResponse("invalid_input", "Request body required", 400);
    const key = `uploads/${Date.now()}-${filename}`;
    await env.MEDIA.put(key, request.body, {
      httpMetadata: { contentType: request.headers.get("Content-Type") ?? "application/octet-stream" },
    });
    const res = await env.DB.prepare(
      `INSERT INTO media (r2_key, kind, alt, uploaded_by) VALUES (?1, ?2, ?3, ?4) RETURNING id`,
    )
      .bind(key, kind, url2.searchParams.get("alt"), user.id)
      .first<{ id: number }>();
    await audit(env, user.id, "media.upload", "media", String(res?.id ?? key));
    return json({ id: res?.id, r2_key: key, url: `/api/v1/media/file/${encodeURIComponent(key)}` }, 201);
  }

  const mediaDelete = path.match(/^\/api\/v1\/media\/(\d+)$/);
  if (mediaDelete && method === "DELETE") {
    if (!isContentTeam(user)) return errorResponse("forbidden", "Editor role or above required", 403);
    const id = mediaDelete[1]!;
    const row = await env.DB.prepare(`SELECT r2_key FROM media WHERE id = ?1`).bind(id).first<{ r2_key: string }>();
    if (!row) return errorResponse("not_found", "Media not found", 404);
    await env.MEDIA.delete(row.r2_key);
    await env.DB.prepare(`DELETE FROM media WHERE id = ?1`).bind(id).run();
    await audit(env, user.id, "media.delete", "media", id);
    return json({ ok: true });
  }

  /* ---- generic CRUD: products, posts, portfolio, testimonials ---- */

  const crudMatch = path.match(/^\/api\/v1\/(products|posts|portfolio|testimonials)(?:\/(\d+))?$/);
  if (crudMatch) {
    const cfg = CRUD[crudMatch[1]!]!;
    const id = crudMatch[2];

    if (method === "GET" && !id) {
      // Public sees only published/visible rows; editors see everything
      const isEditor = isContentTeam(user);
      const publicFilter =
        cfg.table === "products" ? "WHERE is_visible = 1"
        : cfg.table === "posts" ? "WHERE status = 'published'"
        : "WHERE is_published = 1";
      const { results } = await env.DB.prepare(
        `SELECT * FROM ${cfg.table} ${isEditor ? "" : publicFilter} ORDER BY ${cfg.orderBy} LIMIT 200`,
      ).all();
      return json({ items: results });
    }

    if (method === "GET" && id) {
      const row = await env.DB.prepare(`SELECT * FROM ${cfg.table} WHERE id = ?1`).bind(id).first();
      if (!row) return errorResponse("not_found", "Not found", 404);
      return json(row);
    }

    if (!isContentTeam(user)) return errorResponse("forbidden", "Editor role or above required", 403);
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;

    if (method === "POST" && !id) {
      if (!body || !cfg.required.every((c) => isNonEmptyString(body[c], 10000))) {
        return errorResponse("invalid_input", `Required: ${cfg.required.join(", ")}`, 400);
      }
      const cols = cfg.columns.filter((c) => typeof body[c] !== "undefined");
      const placeholders = cols.map((_, i) => `?${i + 1}`).join(", ");
      const stmt = env.DB.prepare(
        `INSERT INTO ${cfg.table} (${cols.join(", ")}) VALUES (${placeholders}) RETURNING id`,
      ).bind(...cols.map((c) => body[c] as string | number | null));
      const res = await stmt.first<{ id: number }>();
      await audit(env, user.id, `${cfg.table}.create`, cfg.table, String(res?.id));
      return json({ id: res?.id }, 201);
    }

    if (method === "PUT" && id) {
      if (!body) return errorResponse("invalid_input", "Body required", 400);
      const cols = cfg.columns.filter((c) => typeof body[c] !== "undefined");
      if (cols.length === 0) return errorResponse("invalid_input", "No writable fields provided", 400);
      const sets = cols.map((c, i) => `${c} = ?${i + 1}`).join(", ");
      await env.DB.prepare(`UPDATE ${cfg.table} SET ${sets} WHERE id = ?${cols.length + 1}`)
        .bind(...cols.map((c) => body[c] as string | number | null), id)
        .run();
      await audit(env, user.id, `${cfg.table}.update`, cfg.table, id, { fields: cols });
      return json({ ok: true });
    }

    if (method === "DELETE" && id) {
      if (!atLeast(user, "admin")) return errorResponse("forbidden", "Admin role or above required", 403);
      await env.DB.prepare(`DELETE FROM ${cfg.table} WHERE id = ?1`).bind(id).run();
      await audit(env, user.id, `${cfg.table}.delete`, cfg.table, id);
      return json({ ok: true });
    }
  }

  /* ---- content listing (editor+) ---- */

  if (path === "/api/v1/content" && method === "GET") {
    if (!isContentTeam(user)) return errorResponse("forbidden", "Editor role or above required", 403);
    const { results } = await env.DB.prepare(
      `SELECT key, value, updated_at FROM site_content ORDER BY key`,
    ).all();
    return json({ content: results });
  }

  /* ---- user management (super_admin only) ---- */

  if (path === "/api/v1/users" && method === "GET") {
    if (!atLeast(user, "admin")) return errorResponse("forbidden", "Admin role required", 403);
    const { results } = await env.DB.prepare(
      `SELECT id, email, name, role, employment_status, is_active, created_at FROM users ORDER BY id`,
    ).all();
    return json({ users: results });
  }

  if (path === "/api/v1/users" && method === "POST") {
    if (!atLeast(user, "admin")) return errorResponse("forbidden", "Admin role required", 403);
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const roles = ["super_admin", "admin", "editor", "marketing", "live_host", "hr_admin", "sales_marketing", "ceo", "coo", "cco", "customer"];
    const isPartTimeAliasC = body?.role === "live_host_part_time"; // v1.4.180
    const roleWantedC = isPartTimeAliasC ? "live_host" : (typeof body?.role === "string" ? body.role : "");
    if (
      !body ||
      !isNonEmptyString(body.email, 200) ||
      !isNonEmptyString(body.name, 120) ||
      !isNonEmptyString(body.password, 200) ||
      (body.password as string).length < 10 ||
      !roles.includes(roleWantedC)
    ) {
      return errorResponse("invalid_input", "email, name, role, and a password of 10+ characters are required", 400);
    }
    if (roleWantedC === "super_admin" && !atLeast(user, "super_admin")) {
      return errorResponse("forbidden", "Only a super admin can create a super admin", 403);
    }
    const email = (body.email as string).toLowerCase().trim();
    // v1.4.180: domain policy aligned with the portal (v1.4.156–157) —
    // personal emails CAN hold staff roles but only as part_time; permanent
    // staff and admin-tier roles require a company email.
    const companyMailC = email.endsWith(`@${env.COMPANY_DOMAIN.toLowerCase()}`);
    if (["super_admin", "admin"].includes(roleWantedC) && !companyMailC) {
      return errorResponse("domain_policy", `Admin-tier roles require an @${env.COMPANY_DOMAIN} email`, 400);
    }
    const forcePartTimeC = isPartTimeAliasC || (roleWantedC !== "customer" && !companyMailC);
    // Check the email conflict explicitly, so a constraint failure elsewhere
    // (e.g. a role the database does not yet allow) is never mislabelled as
    // "email already exists".
    const existing = await env.DB.prepare(`SELECT id FROM users WHERE email = ?1`)
      .bind(email)
      .first<{ id: number }>();
    if (existing) {
      return errorResponse("email_exists", "A user with this email already exists", 409);
    }
    const hash = await createPasswordHash(body.password as string, env.SESSION_PEPPER);
    try {
      const res = await env.DB.prepare(
        forcePartTimeC
          ? `INSERT INTO users (email, password_hash, name, role, employment_status) VALUES (?1, ?2, ?3, ?4, 'part_time') RETURNING id`
          : `INSERT INTO users (email, password_hash, name, role) VALUES (?1, ?2, ?3, ?4) RETURNING id`,
      )
        .bind(email, hash, (body.name as string).trim(), roleWantedC)
        .first<{ id: number }>();
      await audit(env, user.id, "user.create", "users", String(res?.id), { role: roleWantedC, ...(forcePartTimeC ? { employment_status: "part_time" } : {}) });
      return json({ id: res?.id }, 201);
    } catch (e) {
      // Most likely a CHECK constraint (role not yet allowed by the DB) —
      // report it as what it is, with the fix in the message.
      return errorResponse(
        "db_constraint",
        "The database rejected this user. If you picked a newer role (cco, ceo, hr_admin, sales_marketing), run migration 0008 (`wrangler d1 migrations apply azoneofficial --remote`) and try again.",
        500,
      );
    }
  }

  const userMatch = path.match(/^\/api\/v1\/users\/(\d+)$/);
  if (userMatch && method === "PATCH") {
    if (!atLeast(user, "admin")) return errorResponse("forbidden", "Admin role required", 403);
    const id = userMatch[1]!;
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return errorResponse("invalid_input", "Body required", 400);

    // Escalation guards: an admin manages everyone below super admin, but can
    // never modify a super admin, mint one, or change their own role.
    const target = await env.DB.prepare(`SELECT role FROM users WHERE id = ?1`)
      .bind(id)
      .first<{ role: string }>();
    if (!target) return errorResponse("not_found", "User not found", 404);
    if (target.role === "super_admin" && !atLeast(user, "super_admin")) {
      return errorResponse("forbidden", "Only a super admin can modify a super admin", 403);
    }
    if (body.role === "super_admin" && !atLeast(user, "super_admin")) {
      return errorResponse("forbidden", "Only a super admin can grant super admin", 403);
    }
    if (String(user.id) === id && typeof body.role === "string" && body.role !== user.role) {
      return errorResponse("invalid_input", "You cannot change your own role", 400);
    }
    const roles = ["super_admin", "admin", "editor", "marketing", "live_host", "hr_admin", "sales_marketing", "ceo", "coo", "cco", "customer"];
    const changed: string[] = [];

    /* v1.4.180 (CEO: "I cant manually assigned staff roles based on Google
       account … there is no roles live_host_part_time in the list"): /admin
       now follows the SAME policy as the portal route (v1.4.156–157):
       — role changes are SUPER ADMIN only (CEO's security directive);
       — "live_host_part_time" is an accepted alias = live_host + part_time;
       — STAFF roles on personal emails are ALLOWED but employment_status is
         FORCED to part_time (permanent needs @company email);
       — admin-tier roles still hard-require a company email. */
    if (typeof body.role === "string") {
      const isPartTimeAlias = body.role === "live_host_part_time";
      const roleWanted = isPartTimeAlias ? "live_host" : body.role;
      if (roles.includes(roleWanted)) {
        if (!atLeast(user, "super_admin")) {
          return errorResponse("forbidden", "Role changes are reserved for the super admin (CEO security directive)", 403);
        }
        let forcePartTime = isPartTimeAlias;
        if (roleWanted !== "customer") {
          const acct = await env.DB.prepare(`SELECT email FROM users WHERE id = ?1`)
            .bind(id).first<{ email: string }>();
          const companyMail = !!acct && acct.email.toLowerCase().endsWith(`@${env.COMPANY_DOMAIN.toLowerCase()}`);
          if (["super_admin", "admin"].includes(roleWanted) && !companyMail) {
            return errorResponse("domain_policy", `Admin-tier roles require an @${env.COMPANY_DOMAIN} email`, 400);
          }
          if (!companyMail) forcePartTime = true; // personal email → part-time staff
        }
        if (forcePartTime) {
          await env.DB.prepare(`UPDATE users SET role = ?1, employment_status = 'part_time' WHERE id = ?2`).bind(roleWanted, id).run();
          changed.push("role", "employment_status=part_time");
        } else {
          await env.DB.prepare(`UPDATE users SET role = ?1 WHERE id = ?2`).bind(roleWanted, id).run();
          changed.push("role");
        }
      }
    }
    if (typeof body.is_active === "number") {
      if (String(user.id) === id && body.is_active === 0) {
        return errorResponse("invalid_input", "You cannot deactivate your own account", 400);
      }
      await env.DB.prepare(`UPDATE users SET is_active = ?1 WHERE id = ?2`).bind(body.is_active ? 1 : 0, id).run();
      if (!body.is_active) {
        await env.DB.prepare(`DELETE FROM sessions WHERE user_id = ?1`).bind(id).run();
      }
      changed.push("is_active");
    }
    if (isNonEmptyString(body.password, 200) && (body.password as string).length >= 10) {
      const hash = await createPasswordHash(body.password as string, env.SESSION_PEPPER);
      await env.DB.prepare(`UPDATE users SET password_hash = ?1 WHERE id = ?2`).bind(hash, id).run();
      await env.DB.prepare(`DELETE FROM sessions WHERE user_id = ?1`).bind(id).run();
      changed.push("password");
    }
    if (changed.length === 0) return errorResponse("invalid_input", "Nothing to update", 400);
    await audit(env, user.id, "user.update", "users", id, { changed });
    return json({ ok: true });
  }

  const revokeMatch = path.match(/^\/api\/v1\/users\/(\d+)\/revoke-sessions$/);
  if (revokeMatch && method === "POST") {
    if (!atLeast(user, "admin")) return errorResponse("forbidden", "Admin role required", 403);
    const id = revokeMatch[1]!;
    const target = await env.DB.prepare(`SELECT role FROM users WHERE id = ?1`)
      .bind(id)
      .first<{ role: string }>();
    if (!target) return errorResponse("not_found", "User not found", 404);
    if (target.role === "super_admin" && !atLeast(user, "super_admin")) {
      return errorResponse("forbidden", "Only a super admin can force out a super admin", 403);
    }
    const res = await env.DB.prepare(`DELETE FROM sessions WHERE user_id = ?1`).bind(id).run();
    await audit(env, user.id, "user.force_logout", "users", id, {
      sessions_revoked: res.meta.changes ?? 0,
    });
    return json({ ok: true, sessions_revoked: res.meta.changes ?? 0 });
  }

  return errorResponse("not_found", "Route not found", 404);
}
