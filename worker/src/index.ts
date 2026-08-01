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
function groupLineItems(items: { seller_sku?: string; sku_id?: string }[]): { sku: string; qty: number }[] {
  const merged = new Map<string, number>();
  for (const li of items) {
    const sku = (li.seller_sku ?? li.sku_id ?? "").trim();
    if (sku) merged.set(sku, (merged.get(sku) ?? 0) + 1);
  }
  return [...merged.entries()].map(([sku, qty]) => ({ sku, qty }));
}

/** Order webhooks carry only an id + status, so the line items are fetched.
    Returns [] when no token is stored yet (order still gets recorded). */
async function tiktokOrderItems(env: Env, orderId: string): Promise<{ sku: string; qty: number }[]> {
  const data = (await tiktokSignedFetch(env, "/order/202309/orders", { ids: orderId })) as {
    data?: { orders?: { line_items?: { seller_sku?: string; sku_id?: string }[] }[] };
  } | null;
  return groupLineItems(data?.data?.orders?.[0]?.line_items ?? []);
}

async function createSession(env: Env, userId: number): Promise<string> {
  const token = randomHex(32);
  // Store only the hash: a leaked sessions table cannot be replayed.
  const tokenHash = await sha256Hex(token);
  await env.DB.prepare(
    `INSERT INTO sessions (id, user_id, expires_at)
     VALUES (?1, ?2, datetime('now', '+${SESSION_TTL_HOURS} hours'))`,
  )
    .bind(tokenHash, userId)
    .run();
  // Opportunistic housekeeping: purge expired sessions.
  await env.DB.prepare(`DELETE FROM sessions WHERE expires_at <= datetime('now')`).run();
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
    `SELECT u.id, u.email, u.name, u.role
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
  await env.DB.prepare(
    `INSERT INTO audit_log (user_id, action, entity, entity_id, detail)
     VALUES (?1, ?2, ?3, ?4, ?5)`,
  )
    .bind(userId, action, entity ?? null, entityId ?? null, detail ? JSON.stringify(detail) : null)
    .run();
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

export default {
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
      res = errorResponse("internal", "Something went wrong", 500);
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
    return json({
      configured: Boolean(env.TIKTOK_APP_KEY && env.TIKTOK_APP_SECRET),
      authorized: Boolean(tok),
      last_event_at: last?.created_at ?? null,
      last_event_verified: last ? Boolean(last.verified) : null,
    });
  }

  if (path === "/api/v1/integrations/tiktok/sync" && method === "POST") {
    const me = await getSessionUser(request, env);
    const SYNC_ROLES = ["super_admin", "admin", "ceo", "coo", "sales_marketing"];
    if (!me || !SYNC_ROLES.includes(me.role)) {
      return errorResponse("forbidden", "Sales or executive access required", 403);
    }
    if (!env.TIKTOK_APP_KEY || !env.TIKTOK_APP_SECRET) {
      return errorResponse("not_configured", "Set TIKTOK_APP_KEY and TIKTOK_APP_SECRET first", 503);
    }
    if (!(await tiktokToken(env))) {
      return errorResponse("not_authorized", "Authorize the app first: publish it in Partner Center and complete shop authorization via the redirect URL", 409);
    }
    // Last 30 days of orders, newest first, one page of 50.
    const listBody = JSON.stringify({ create_time_ge: Math.floor(Date.now() / 1000) - 30 * 86400 });
    const data = (await tiktokSignedFetch(
      env, "/order/202309/orders/search", { page_size: "50" }, listBody, "POST",
    )) as {
      code?: number; message?: string;
      data?: { orders?: { id?: string; status?: string; line_items?: { seller_sku?: string; sku_id?: string }[] }[] };
    } | null;
    if (!data || (typeof data.code === "number" && data.code !== 0)) {
      return errorResponse("tiktok_error", `TikTok API error: ${data?.message ?? "no response"} — check that the order scopes are active`, 502);
    }
    const orders = data.data?.orders ?? [];
    let imported = 0, skipped = 0;
    const problems: string[] = [];
    for (const o of orders) {
      const orderId = String(o.id ?? "").trim();
      if (!orderId) continue;
      const orderRef = `TT-${orderId.slice(0, 64)}`;
      const exists = await env.DB.prepare(
        `SELECT id FROM postage_records WHERE order_ref = ?1`,
      ).bind(orderRef).first<{ id: number }>();
      if (exists) { skipped += 1; continue; }
      const lines = groupLineItems(o.line_items ?? []);
      const resolved: { id: number; qty: number }[] = [];
      const unknown: string[] = [];
      const shortages: string[] = [];
      for (const l of lines) {
        const item = await env.DB.prepare(
          `SELECT id, stock, name FROM inventory_items WHERE sku = ?1`,
        ).bind(l.sku).first<{ id: number; stock: number; name: string }>();
        if (!item) { unknown.push(l.sku); continue; }
        if (item.stock < l.qty) shortages.push(`${item.name}: ${item.stock} < ${l.qty}`);
        resolved.push({ id: item.id, qty: l.qty });
      }
      const canDeduct = shortages.length === 0 && resolved.length > 0;
      const notes = ["TikTok order (synced)"];
      if (unknown.length) notes.push(`SKUs not in inventory: ${unknown.join(", ")}`);
      if (!canDeduct && shortages.length) notes.push(`NOT deducted — ${shortages.join("; ")}`);
      const st = String(o.status ?? "").toLowerCase();
      const uiStatus = st.includes("deliver") ? "delivered" : st.includes("ship") || st.includes("transit") ? "shipped" : "preparing";
      const rec = await env.DB.prepare(
        `INSERT INTO postage_records (order_ref, courier, status, note, updated_by)
         VALUES (?1, 'TikTok', ?2, ?3, NULL) RETURNING id`,
      ).bind(orderRef, uiStatus, notes.join(" · ")).first<{ id: number }>();
      if (canDeduct) {
        for (const l of resolved) {
          const upd = await env.DB.prepare(
            `UPDATE inventory_items SET stock = stock - ?1, updated_at = datetime('now') WHERE id = ?2 AND stock >= ?1`,
          ).bind(l.qty, l.id).run();
          if (upd.meta.changes) {
            await env.DB.prepare(
              `INSERT INTO postage_items (postage_id, inventory_item_id, qty) VALUES (?1, ?2, ?3)`,
            ).bind(rec!.id, l.id, l.qty).run();
            await env.DB.prepare(
              `UPDATE inventory_items SET status = CASE WHEN stock = 0 THEN 'out_of_stock' WHEN stock <= 5 THEN 'low' ELSE 'in_stock' END WHERE id = ?1`,
            ).bind(l.id).run();
            await audit(env, me.id, "inventory.out", "inventory_items", String(l.id), { qty: l.qty, order: orderRef, source: "tiktok_sync" });
          }
        }
      }
      if (unknown.length) problems.push(`${orderRef}: unmatched ${unknown.join(", ")}`);
      imported += 1;
    }
    await audit(env, me.id, "tiktok.sync", undefined, undefined, { imported, skipped });
    return json({ ok: true, imported, skipped, total_from_tiktok: orders.length, problems });
  }

  if (path === "/api/v1/integrations/tiktok/webhook" && method === "POST") {
    // TikTok signs its own requests (tiktok-signature); a relay such as
    // Make/Zapier can instead send x-webhook-secret. Either proves origin.
    const rawBody = await request.text();
    const sigHeader = request.headers.get("tiktok-signature") ?? request.headers.get("Tiktok-Signature") ?? "";
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
      JSON.stringify({ signature: sigHeader ? "present" : "absent", relay: relaySecret ? "present" : "absent" }),
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
      const lines = await tiktokOrderItems(env, orderId);
      const resolved: { id: number; qty: number }[] = [];
      const unknown: string[] = [];
      const shortages: string[] = [];
      for (const l of lines) {
        const item = await env.DB.prepare(
          `SELECT id, stock, name FROM inventory_items WHERE sku = ?1`,
        ).bind(l.sku).first<{ id: number; stock: number; name: string }>();
        if (!item) { unknown.push(l.sku); continue; }
        if (item.stock < l.qty) shortages.push(`${item.name}: ${item.stock} in stock, order needs ${l.qty}`);
        resolved.push({ id: item.id, qty: l.qty });
      }
      const canDeduct = shortages.length === 0 && resolved.length > 0;
      const notes = ["TikTok order (auto)"];
      if (lines.length === 0) notes.push("items not retrieved — authorize the app to enable stock movement");
      if (unknown.length) notes.push(`SKUs not in inventory: ${unknown.join(", ")}`);
      if (!canDeduct && shortages.length) notes.push(`NOT deducted — ${shortages.join("; ")}`);

      const rec = await env.DB.prepare(
        `INSERT INTO postage_records (order_ref, courier, status, note, updated_by)
         VALUES (?1, 'TikTok', 'preparing', ?2, NULL) RETURNING id`,
      ).bind(orderRef, notes.join(" · ")).first<{ id: number }>();
      if (canDeduct) {
        for (const l of resolved) {
          const upd = await env.DB.prepare(
            `UPDATE inventory_items SET stock = stock - ?1, updated_at = datetime('now') WHERE id = ?2 AND stock >= ?1`,
          ).bind(l.qty, l.id).run();
          if (upd.meta.changes) {
            await env.DB.prepare(
              `INSERT INTO postage_items (postage_id, inventory_item_id, qty) VALUES (?1, ?2, ?3)`,
            ).bind(rec!.id, l.id, l.qty).run();
            await env.DB.prepare(
              `UPDATE inventory_items SET status = CASE WHEN stock = 0 THEN 'out_of_stock' WHEN stock <= 5 THEN 'low' ELSE 'in_stock' END WHERE id = ?1`,
            ).bind(l.id).run();
            await audit(env, null, "inventory.out", "inventory_items", String(l.id), { qty: l.qty, order: orderRef, source: "tiktok" });
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
    await audit(env, null, "tiktok.authorized");
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
      const res = await env.DB.prepare(
        `INSERT INTO users (email, password_hash, name, role, is_active)
         VALUES (?1, 'oauth$google', ?2, 'customer', 1) RETURNING id, is_active`,
      )
        .bind(email, profile.name ?? email)
        .first<{ id: number; is_active: number }>();
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
    return json({ user });
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
    if (!isContentTeam(user)) {
      return errorResponse("forbidden", "Marketing role or above required", 403);
    }
    const { results } = await env.DB.prepare(
      `SELECT id, name, company, phone, email, message, status, assigned_to, created_at
       FROM enquiries ORDER BY created_at DESC LIMIT 100`,
    ).all();
    return json({ enquiries: results });
  }

  if (path.match(/^\/api\/v1\/enquiries\/\d+$/) && method === "PATCH") {
    if (!isContentTeam(user)) {
      return errorResponse("forbidden", "Marketing role or above required", 403);
    }
    const id = path.split("/").pop()!;
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const allowed = ["new", "contacted", "qualified", "closed"];
    if (!body || typeof body.status !== "string" || !allowed.includes(body.status)) {
      return errorResponse("invalid_input", `status must be one of: ${allowed.join(", ")}`, 400);
    }
    await env.DB.prepare(`UPDATE enquiries SET status = ?1 WHERE id = ?2`)
      .bind(body.status, id)
      .run();
    await audit(env, user.id, "enquiry.update_status", "enquiries", id, { status: body.status });
    return json({ ok: true });
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
    await env.DB.prepare(
      `INSERT INTO enquiries (name, company, phone, email, message)
       VALUES (?1, ?2, ?3, ?4, ?5)`,
    ).bind(
      user.name,
      isNonEmptyString(body.company, 200) ? body.company : null,
      isNonEmptyString(body.phone, 40) ? body.phone : null,
      user.email,
      (body.message as string).trim(),
    ).run();
    await audit(env, user.id, "account.enquiry");
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
    const { results } = await env.DB.prepare(
      verified
        ? `SELECT id, message, status, created_at FROM enquiries
           WHERE email = ?1 ORDER BY created_at DESC LIMIT 50`
        : `SELECT id, message, status, created_at FROM enquiries
           WHERE email = ?1 AND created_at >= ?2 ORDER BY created_at DESC LIMIT 50`,
    ).bind(...(verified ? [user.email] : [user.email, acct?.created_at ?? ""])).all();
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
      `SELECT id, email, name, role, is_active, created_at FROM users ORDER BY id`,
    ).all();
    return json({ users: results });
  }

  if (path === "/api/v1/users" && method === "POST") {
    if (!atLeast(user, "admin")) return errorResponse("forbidden", "Admin role required", 403);
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const roles = ["super_admin", "admin", "editor", "marketing", "live_host", "hr_admin", "sales_marketing", "ceo", "coo", "cco", "customer"];
    if (
      !body ||
      !isNonEmptyString(body.email, 200) ||
      !isNonEmptyString(body.name, 120) ||
      !isNonEmptyString(body.password, 200) ||
      (body.password as string).length < 10 ||
      typeof body.role !== "string" ||
      !roles.includes(body.role)
    ) {
      return errorResponse("invalid_input", "email, name, role, and a password of 10+ characters are required", 400);
    }
    if (body.role === "super_admin" && !atLeast(user, "super_admin")) {
      return errorResponse("forbidden", "Only a super admin can create a super admin", 403);
    }
    const email = (body.email as string).toLowerCase().trim();
    // Domain policy (v1.4.42): staff/admin roles require a company email.
    if (body.role !== "customer" && !email.endsWith(`@${env.COMPANY_DOMAIN.toLowerCase()}`)) {
      return errorResponse(
        "domain_policy",
        `Staff and admin roles require an @${env.COMPANY_DOMAIN} email — personal emails stay as customer`,
        400,
      );
    }
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
        `INSERT INTO users (email, password_hash, name, role) VALUES (?1, ?2, ?3, ?4) RETURNING id`,
      )
        .bind(email, hash, (body.name as string).trim(), body.role)
        .first<{ id: number }>();
      await audit(env, user.id, "user.create", "users", String(res?.id), { role: body.role });
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

    if (typeof body.role === "string" && roles.includes(body.role)) {
      // Domain policy (v1.4.42): staff and admin roles belong to company
      // emails only. Personal emails (gmail etc.) are customers — /account,
      // never /portal or /admin. Demoting anyone TO customer is always fine.
      if (body.role !== "customer") {
        const acct = await env.DB.prepare(`SELECT email FROM users WHERE id = ?1`)
          .bind(id).first<{ email: string }>();
        if (acct && !acct.email.toLowerCase().endsWith(`@${env.COMPANY_DOMAIN.toLowerCase()}`)) {
          return errorResponse(
            "domain_policy",
            `Staff and admin roles require an @${env.COMPANY_DOMAIN} email — personal emails stay as customer`,
            400,
          );
        }
      }
      await env.DB.prepare(`UPDATE users SET role = ?1 WHERE id = ?2`).bind(body.role, id).run();
      changed.push("role");
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
