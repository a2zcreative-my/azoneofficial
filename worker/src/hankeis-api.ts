/**
 * HANKEI'S COMMERCE - the integration API. v1.163.0.
 *
 * The server-to-server surface Astra GPT's Telegram adapter calls. No
 * cookies, no CORS, no session: a scoped bearer token, checked against a
 * SHA-256 hash, and nothing else.
 *
 * WHAT THIS SURFACE CANNOT DO, structurally rather than by promise:
 *   - It cannot verify a payment. There is no route here that writes
 *     payment_state='verified', and the staff route that does lives behind
 *     the session-cookie auth an integration token cannot obtain.
 *   - It cannot change a customer category, a price, a package eligibility
 *     or any setting.
 *   - It cannot read another customer's order. Every customer-facing call
 *     carries the numeric Telegram user id, and ownership is re-checked
 *     against the database on every single request.
 *
 * IDENTITY. Customers are bound by `telegram_user_id`, the NUMERIC id from
 * an authenticated Telegram update - never `@username`, which the user can
 * change at will and an impostor can claim. The adapter is trusted to have
 * taken that number from the update it received from Telegram; it must
 * never take it from message text a customer typed.
 *
 * IDEMPOTENCY. Every mutating call accepts `Idempotency-Key`. The first
 * response is stored against (client, key) and replayed verbatim for any
 * retry, so a Telegram update delivered twice creates one order and one
 * receipt.
 *
 * DELIVERY. The outbox is AT-LEAST-ONCE. See TELEGRAM_HANDOFF.md.
 */
import type { Env } from "./index";
import { json, err, str, num } from "./shared";
import {
  catalogue, quoteFor, createOrder, storeReceipt, settings, sha256Hex, outboxStmt,
} from "./hankeis";
import {
  RECEIPT_MAX_BYTES, BM, rm, sqlNow, sqlPlusMinutes,
  type Category, type QuoteRequestLine,
} from "./hankeis-core";

const MAX_BODY = 256 * 1024;
export const SCOPES = ["catalogue", "customers", "orders", "receipts", "status", "events"] as const;

export interface ApiClient { id: number; name: string; scopes: string; is_active: number }

/** Constant-time compare so a token check cannot become a timing oracle. */
function ctEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export async function authenticate(env: Env, request: Request): Promise<ApiClient | null> {
  const h = request.headers.get("Authorization") ?? "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  const token = m[1]!.trim();
  if (token.length < 24 || token.length > 200) return null;
  const hash = await sha256Hex(new TextEncoder().encode(token));
  const row = await env.DB.prepare(`SELECT id, name, scopes, is_active, token_hash FROM hk_api_clients WHERE token_hash = ?1`)
    .bind(hash).first<ApiClient & { token_hash: string }>().catch(() => null);
  if (!row || row.is_active !== 1) return null;
  if (!ctEqual(row.token_hash, hash)) return null;
  return { id: row.id, name: row.name, scopes: row.scopes, is_active: row.is_active };
}
const hasScope = (c: ApiClient, s: string) => c.scopes.split(/\s+/).includes(s);

async function readLimitedBody(request: Request, maxBytes: number): Promise<Uint8Array | null> {
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) return null;
  if (!request.body) return new Uint8Array();

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel("request body exceeds limit").catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/* ────────────────────────────────────────────────────────────────────────
   idempotency
   ──────────────────────────────────────────────────────────────────────── */
async function replay(env: Env, client: ApiClient, key: string, endpoint: string, requestHash: string): Promise<Response | null> {
  const row = await env.DB.prepare(`SELECT endpoint, request_hash, status, response_body FROM hk_idempotency WHERE client_id=?1 AND idem_key=?2`)
    .bind(client.id, key).first<{ endpoint: string; request_hash: string; status: number; response_body: string }>();
  if (!row) return null;
  if (row.endpoint !== endpoint || row.request_hash !== requestHash) {
    return err("idempotency_conflict", "That Idempotency-Key was already used for a different request", 409);
  }
  if (row.status === 0) {
    return err("idempotency_in_progress", "That request is already being processed", 409);
  }
  return new Response(row.response_body, { status: row.status, headers: { "content-type": "application/json", "X-Idempotent-Replay": "1" } });
}
async function reserve(env: Env, client: ApiClient, key: string, endpoint: string, requestHash: string): Promise<Response | null> {
  const prior = await replay(env, client, key, endpoint, requestHash);
  if (prior) return prior;
  const inserted = await env.DB.prepare(
    `INSERT INTO hk_idempotency (client_id, idem_key, endpoint, request_hash, status, response_body)
     VALUES (?1,?2,?3,?4,0,'{}') ON CONFLICT(client_id, idem_key) DO NOTHING`,
  ).bind(client.id, key, endpoint, requestHash).run();
  if ((inserted.meta?.changes ?? 0) === 1) return null;
  return (await replay(env, client, key, endpoint, requestHash))
    ?? err("idempotency_unavailable", "Unable to reserve that Idempotency-Key", 503);
}
async function remember(env: Env, client: ApiClient, key: string, endpoint: string, requestHash: string, status: number, body: unknown): Promise<void> {
  await env.DB.prepare(
    `UPDATE hk_idempotency SET status=?1, response_body=?2
      WHERE client_id=?3 AND idem_key=?4 AND endpoint=?5 AND request_hash=?6 AND status=0`,
  ).bind(status, JSON.stringify(body), client.id, key, endpoint, requestHash).run();
}
async function releaseReservation(env: Env, client: ApiClient, key: string, endpoint: string, requestHash: string): Promise<void> {
  if (!key) return;
  await env.DB.prepare(
    `DELETE FROM hk_idempotency WHERE client_id=?1 AND idem_key=?2 AND endpoint=?3 AND request_hash=?4 AND status=0`,
  ).bind(client.id, key, endpoint, requestHash).run();
}

/* ────────────────────────────────────────────────────────────────────────
   customer resolution - the ownership rule, in one place
   ──────────────────────────────────────────────────────────────────────── */
interface HkCustomer { id: number; name: string; category: Category; telegram_user_id: number | null }
async function customerByTelegram(env: Env, tgId: number): Promise<HkCustomer | null> {
  return env.DB.prepare(`SELECT id, name, category, telegram_user_id FROM hk_customers WHERE telegram_user_id = ?1`).bind(tgId).first<HkCustomer>();
}
/** The numeric Telegram id, validated. Telegram ids are positive integers;
    a negative number is a CHAT id (a group), never a user. */
function telegramId(v: unknown): number | null {
  const n = num(v);
  if (n === null || !Number.isInteger(n) || n <= 0 || n > 1e15) return null;
  return n;
}

/* ────────────────────────────────────────────────────────────────────────
   the router
   ──────────────────────────────────────────────────────────────────────── */
export async function handleHankeisApi(env: Env, request: Request, path: string): Promise<Response> {
  const method = request.method;
  const url = new URL(request.url);

  /* the one unauthenticated route: is this surface alive and configured? */
  if (path === "/health" && method === "GET") {
    const s = await settings(env).catch(() => ({}) as Record<string, string>);
    return json({
      ok: true, api_version: 1,
      configured: { qr: Boolean(s.qr_image_key), recipient: Boolean(s.recipient_name), receiving_account: Boolean(s.receiving_account) },
      note: "Payment verification is manual and staff-only. No endpoint on this surface can verify a payment.",
    });
  }

  const client = await authenticate(env, request);
  if (!client) return err("unauthorized", "A valid integration bearer token is required", 401);
  await env.DB.prepare(`UPDATE hk_api_clients SET last_seen_at=datetime('now') WHERE id=?1`).bind(client.id).run().catch(() => null);

  let body: Record<string, unknown> | null = null;
  const isUpload = path.endsWith("/receipt");
  if (["POST", "PUT", "PATCH"].includes(method) && !isUpload) {
    const bytes = await readLimitedBody(request, MAX_BODY);
    if (!bytes) return err("too_large", "Body too large", 413);
    try {
      const parsed = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("object required");
      body = parsed as Record<string, unknown>;
    } catch { return err("invalid_input", "A JSON object body is required", 400); }
  }
  const idemKey = request.headers.get("Idempotency-Key") ?? "";
  const requestHash = await sha256Hex(new TextEncoder().encode(`${method} ${path} ${JSON.stringify(body ?? {})}`));
  const guardIdem = async (hash = requestHash): Promise<Response | null> => {
    if (!idemKey) return null;
    if (idemKey.length > 120) return err("invalid_input", "Idempotency-Key too long", 400);
    return reserve(env, client, idemKey, `${method} ${path}`, hash);
  };
  const done = async (status: number, payload: Record<string, unknown>): Promise<Response> => {
    if (idemKey) await remember(env, client, idemKey, `${method} ${path}`, requestHash, status, payload);
    return json(payload, status);
  };

  /* ---- catalogue ---- */
  if (path === "/catalogue" && method === "GET") {
    if (!hasScope(client, "catalogue")) return err("forbidden", "Scope 'catalogue' required", 403);
    const cat = await catalogue(env);
    const s = await settings(env);
    /* packages are filtered to what THIS customer may buy, if one is named.
       The filter is a courtesy for the menu - the server re-checks it on
       every quote and every order, so a client that ignores it gains nothing. */
    const tg = telegramId(url.searchParams.get("telegram_user_id") ? Number(url.searchParams.get("telegram_user_id")) : null);
    let category: Category = "retail";
    if (tg) { const c = await customerByTelegram(env, tg); if (c) category = c.category; }
    const rank: Record<Category, number> = { retail: 0, agent: 1, stockist: 2 };
    return json({
      api_version: 1, customer_category: category,
      products: cat.products.map((p) => ({ id: p.id, sku: p.sku, name: p.name, unit_price_cents: p.unit_price_cents })),
      packages: cat.packages.filter((p) => rank[category] >= rank[p.eligibility])
        .map((p) => ({ id: p.id, code: p.code, name: p.name, min_qty: p.min_qty, price_cents: p.price_cents, eligibility: p.eligibility })),
      currency: "MYR",
      payment: { recipient_name: s.recipient_name, instructions_bm: s.pay_instructions_bm, disclaimer_bm: BM.receipt_not_confirmation },
    });
  }

  /* ---- the static QR image itself ----
     Every other response hands out `qr_image_key`, which is a key in OUR R2
     bucket and resolves to nothing outside the worker. The bot has to be
     able to send the customer a picture, so this route streams it. It is
     the one piece of payment data that is public by design: the QR is
     printed for strangers to scan. The RECEIVING ACCOUNT is not here and is
     not anywhere on this surface. */
  if (path === "/qr" && method === "GET") {
    if (!hasScope(client, "catalogue")) return err("forbidden", "Scope 'catalogue' required", 403);
    const key = (await settings(env)).qr_image_key;
    if (!key) return err("not_configured", "No QR image is configured yet - the owner sets it in the portal", 503);
    const obj = await env.MEDIA.get(key).catch(() => null);
    if (!obj) return err("not_found", "The configured QR image is missing from storage", 404);
    return new Response(obj.body, {
      status: 200,
      headers: {
        "content-type": obj.httpMetadata?.contentType ?? "image/png",
        "cache-control": "public, max-age=300",
        "x-content-type-options": "nosniff",
      },
    });
  }

  /* ---- customers: create or update the mapping ---- */
  if (path === "/customers" && method === "POST") {
    if (!hasScope(client, "customers")) return err("forbidden", "Scope 'customers' required", 403);
    const tg = telegramId(body?.telegram_user_id);
    if (tg === null) return err("invalid_input", "telegram_user_id must be the numeric Telegram user id from an authenticated update", 400);
    const name = str(body?.name, 200) ? String(body!.name).trim() : `Telegram ${tg}`;
    const phone = str(body?.phone, 40) ? String(body!.phone).trim() : null;
    const existing = await customerByTelegram(env, tg);
    const hit = await guardIdem(); if (hit) return hit;
    if (existing) {
      /* name and phone may be refreshed; CATEGORY may not - privileged
         pricing is assigned by staff, never claimed by a caller */
      await env.DB.prepare(`UPDATE hk_customers SET name=?1, phone=COALESCE(?2, phone) WHERE id=?3`).bind(name, phone, existing.id).run();
      return done(200, { api_version: 1, customer_id: existing.id, telegram_user_id: tg, category: existing.category, created: false });
    }
    const r = await env.DB.prepare(`INSERT INTO hk_customers (name, phone, telegram_user_id, created_via) VALUES (?1,?2,?3,'telegram') RETURNING id, category`)
      .bind(name, phone, tg).first<{ id: number; category: Category }>().catch(() => null);
    if (!r) return err("conflict", "That Telegram id is already mapped", 409);
    return done(201, { api_version: 1, customer_id: r.id, telegram_user_id: tg, category: r.category, created: true });
  }

  /* ---- addresses ---- */
  if (path === "/addresses" && method === "POST") {
    if (!hasScope(client, "customers")) return err("forbidden", "Scope 'customers' required", 403);
    const tg = telegramId(body?.telegram_user_id);
    if (tg === null) return err("invalid_input", "telegram_user_id is required", 400);
    const c = await customerByTelegram(env, tg);
    if (!c) return err("not_found", "Map the customer first", 404);
    if (!str(body?.line1, 300)) return err("invalid_input", "line1 is required", 400);
    const hit = await guardIdem(); if (hit) return hit;
    const r = await env.DB.prepare(`INSERT INTO hk_addresses (customer_id, recipient, phone, line1, line2, postcode, city, state, is_default) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,1) RETURNING id`)
      .bind(c.id, str(body?.recipient, 200) ? body!.recipient : c.name, str(body?.phone, 40) ? body!.phone : null,
        String(body!.line1).trim(), str(body?.line2, 300) ? body!.line2 : null, str(body?.postcode, 12) ? body!.postcode : null,
        str(body?.city, 80) ? body!.city : null, str(body?.state, 80) ? body!.state : null).first<{ id: number }>();
    return done(201, { api_version: 1, address_id: r?.id });
  }

  /* ---- quote: the authoritative total, computed here ---- */
  if (path === "/quote" && method === "POST") {
    if (!hasScope(client, "orders")) return err("forbidden", "Scope 'orders' required", 403);
    const tg = telegramId(body?.telegram_user_id);
    if (tg === null) return err("invalid_input", "telegram_user_id is required", 400);
    const c = await customerByTelegram(env, tg);
    if (!c) return err("not_found", "Map the customer first", 404);
    const q = await quoteFor(env, c.category, (Array.isArray(body?.lines) ? body!.lines : []) as QuoteRequestLine[]);
    if (!q.ok) return err(q.code, q.message, 400);
    const s = await settings(env);
    return json({
      api_version: 1, customer_category: c.category,
      lines: q.lines.map((l) => ({ name: l.name_snapshot, sku: l.sku_snapshot, qty: l.qty, unit_price_cents: l.unit_price_cents, line_total_cents: l.line_total_cents })),
      subtotal_cents: q.subtotal_cents, shipping_cents: q.shipping_cents, total_cents: q.total_cents,
      needs_quote: q.needs_quote, currency: "MYR",
      display: { subtotal: rm(q.subtotal_cents), shipping: rm(q.shipping_cents), total: rm(q.total_cents) },
      message_bm: q.needs_quote ? BM.quote_required : BM.awaiting_payment(rm(q.total_cents), s.recipient_name || "-"),
      note: "This quote is authoritative. Prices sent by a client are ignored - the order is priced again on creation.",
    });
  }

  /* ---- create an order ---- */
  if (path === "/orders" && method === "POST") {
    if (!hasScope(client, "orders")) return err("forbidden", "Scope 'orders' required", 403);
    const tg = telegramId(body?.telegram_user_id);
    if (tg === null) return err("invalid_input", "telegram_user_id is required", 400);
    const c = await customerByTelegram(env, tg);
    if (!c) return err("not_found", "Map the customer first", 404);
    const hit = await guardIdem(); if (hit) return hit;
    const r = await createOrder(env, {
      customer_id: c.id, address_id: num(body?.address_id), channel: "telegram",
      lines: (Array.isArray(body?.lines) ? body!.lines : []) as QuoteRequestLine[],
      note: str(body?.note, 500) ? String(body!.note) : null, client_id: client.id,
    });
    if (!r.ok) {
      await releaseReservation(env, client, idemKey, `${method} ${path}`, requestHash);
      return err(r.code, r.message, r.status);
    }
    const s = await settings(env);
    return done(201, {
      api_version: 1, order_no: r.order_no, total_cents: r.total_cents, needs_quote: r.needs_quote,
      reserved_until: r.reserved_until,
      payment: r.needs_quote ? null : {
        recipient_name: s.recipient_name, qr_image_key: s.qr_image_key,
        amount_cents: r.total_cents, amount_display: rm(r.total_cents),
        instructions_bm: s.pay_instructions_bm, disclaimer_bm: BM.receipt_not_confirmation,
      },
      message_bm: r.needs_quote ? BM.quote_required : BM.awaiting_payment(rm(r.total_cents), s.recipient_name || "-"),
    });
  }

  /* ---- one order, for its owner only ---- */
  const ordM = path.match(/^\/orders\/([A-Z0-9-]{6,24})$/);
  if (ordM && method === "GET") {
    if (!hasScope(client, "status")) return err("forbidden", "Scope 'status' required", 403);
    const tg = telegramId(url.searchParams.get("telegram_user_id") ? Number(url.searchParams.get("telegram_user_id")) : null);
    if (tg === null) return err("invalid_input", "telegram_user_id is required", 400);
    const c = await customerByTelegram(env, tg);
    if (!c) return err("not_found", "Map the customer first", 404);
    const o = await env.DB.prepare(
      `SELECT id, order_no, customer_id, order_state, payment_state, fulfilment_state, subtotal_cents, shipping_cents, total_cents, pay_snapshot, expires_at, created_at
         FROM hk_orders WHERE order_no=?1`,
    ).bind(ordM[1]).first<Record<string, unknown>>();
    /* OWNERSHIP: a wrong owner gets the same answer as a wrong number, so
       the API cannot be used to discover which order numbers exist. */
    if (!o || o.customer_id !== c.id) return err("not_found", "No such order", 404);
    const { results: lines } = await env.DB.prepare(`SELECT name_snapshot AS name, qty, unit_price_cents, line_total_cents FROM hk_order_lines WHERE order_id=?1`).bind(o.id as number).all();
    const { results: receipts } = await env.DB.prepare(`SELECT id, state, created_at FROM hk_receipts WHERE order_id=?1 ORDER BY id DESC`).bind(o.id as number).all();
    const { results: ship } = await env.DB.prepare(`SELECT courier, tracking_no, shipped_at FROM hk_shipments WHERE order_id=?1 ORDER BY id DESC LIMIT 1`).bind(o.id as number).all<{ courier: string; tracking_no: string; shipped_at: string }>();
    const snap = (() => { try { return JSON.parse(String(o.pay_snapshot ?? "{}")) as Record<string, string>; } catch { return {}; } })();
    const ps = String(o.payment_state);
    const message =
      ps === "verified" ? BM.verified(String(o.order_no))
      : ps === "awaiting_review" ? BM.awaiting_review
      : ps === "clarification_required" ? BM.clarification_required("sila hubungi kami")
      : o.order_state === "quote_required" ? BM.quote_required
      : BM.awaiting_payment(rm(Number(o.total_cents)), snap.recipient_name || "-");
    return json({
      api_version: 1, order_no: o.order_no,
      order_state: o.order_state, payment_state: o.payment_state, fulfilment_state: o.fulfilment_state,
      subtotal_cents: o.subtotal_cents, shipping_cents: o.shipping_cents, total_cents: o.total_cents,
      total_display: rm(Number(o.total_cents)), expires_at: o.expires_at, lines, receipts,
      shipment: ship[0] ?? null,
      payment_instructions: {
        recipient_name: snap.recipient_name ?? "", qr_image_key: snap.qr_image_key ?? "",
        instructions_bm: snap.instructions_bm ?? "", disclaimer_bm: BM.receipt_not_confirmation,
      },
      message_bm: message,
    });
  }

  /* ---- upload a receipt ---- */
  const recM = path.match(/^\/orders\/([A-Z0-9-]{6,24})\/receipt$/);
  if (recM && method === "POST") {
    if (!hasScope(client, "receipts")) return err("forbidden", "Scope 'receipts' required", 403);
    const tg = telegramId(url.searchParams.get("telegram_user_id") ? Number(url.searchParams.get("telegram_user_id")) : null);
    if (tg === null) return err("invalid_input", "telegram_user_id query parameter is required", 400);
    const c = await customerByTelegram(env, tg);
    if (!c) return err("not_found", "Map the customer first", 404);
    const o = await env.DB.prepare(`SELECT id, customer_id FROM hk_orders WHERE order_no=?1`).bind(recM[1]).first<{ id: number; customer_id: number }>();
    if (!o || o.customer_id !== c.id) return err("not_found", "No such order", 404);
    const bytes = await readLimitedBody(request, RECEIPT_MAX_BYTES);
    if (!bytes) return err("too_large", "Receipt too large - maximum 8 MB", 413);
    const binaryHash = await sha256Hex(bytes);
    const receiptRequestHash = await sha256Hex(new TextEncoder().encode(
      `${method} ${path} ${url.searchParams.toString()} ${binaryHash}`,
    ));
    const hit = await guardIdem(receiptRequestHash); if (hit) return hit;
    /* rate limit per customer, on the portal's own limiter table */
    const s = await settings(env);
    const perHour = Math.max(1, Number.parseInt(s.uploads_per_hour ?? "10", 10) || 10);
    const rlKey = `hk_upload:${c.id}`;
    const rl = await env.DB.prepare(`SELECT count, window_start FROM rate_limits WHERE key=?1`).bind(rlKey).first<{ count: number; window_start: string }>().catch(() => null);
    if (rl && rl.window_start > sqlPlusMinutes(-60) && rl.count >= perHour) {
      await releaseReservation(env, client, idemKey, `${method} ${path}`, receiptRequestHash);
      return err("rate_limited", "Too many uploads in the last hour - please contact us instead", 429);
    }
    await env.DB.prepare(
      `INSERT INTO rate_limits (key, count, window_start) VALUES (?1,1,datetime('now'))
       ON CONFLICT(key) DO UPDATE SET count = CASE WHEN window_start > datetime('now','-60 minutes') THEN count+1 ELSE 1 END,
                                      window_start = CASE WHEN window_start > datetime('now','-60 minutes') THEN window_start ELSE datetime('now') END`,
    ).bind(rlKey).run().catch(() => null);

    const declared = (request.headers.get("content-type") ?? "").split(";")[0]!.trim();
    const r = await storeReceipt(env, {
      order_id: o.id, customer_id: c.id, bytes, declaredType: declared, via: "telegram", client_id: client.id,
      declared_amount_cents: num(url.searchParams.get("declared_amount_cents") ? Number(url.searchParams.get("declared_amount_cents")) : null),
      declared_reference: url.searchParams.get("declared_reference"),
    });
    if (!r.ok) {
      await releaseReservation(env, client, idemKey, `${method} ${path}`, receiptRequestHash);
      return err(r.code, r.message, r.status);
    }
    const payload = {
      api_version: 1, receipt_id: r.receipt_id, payment_state: r.payment_state,
      message_bm: BM.awaiting_review, disclaimer_bm: BM.receipt_not_confirmation,
      note: "Stored as evidence. A human must still find this transaction in the bank before the payment is verified.",
    };
    if (idemKey) await remember(env, client, idemKey, `${method} ${path}`, receiptRequestHash, 201, payload);
    return json(payload, 201);
  }

  /* ---- cancel, only when allowed ---- */
  const canM = path.match(/^\/orders\/([A-Z0-9-]{6,24})\/cancel$/);
  if (canM && method === "POST") {
    if (!hasScope(client, "orders")) return err("forbidden", "Scope 'orders' required", 403);
    const tg = telegramId(body?.telegram_user_id);
    if (tg === null) return err("invalid_input", "telegram_user_id is required", 400);
    const c = await customerByTelegram(env, tg);
    if (!c) return err("not_found", "Map the customer first", 404);
    const o = await env.DB.prepare(`SELECT id, order_no, customer_id, order_state, payment_state FROM hk_orders WHERE order_no=?1`)
      .bind(canM[1]).first<{ id: number; order_no: string; customer_id: number; order_state: string; payment_state: string }>();
    if (!o || o.customer_id !== c.id) return err("not_found", "No such order", 404);
    /* a customer may withdraw an order nobody has paid for. Once money is
       involved - under review, verified - it is a staff decision. */
    if (o.payment_state !== "awaiting_payment") {
      return err("not_allowed", "This order can no longer be cancelled from the bot - our team will help you", 409);
    }
    const hit = await guardIdem(); if (hit) return hit;
    if (o.order_state === "cancelled") return done(200, { api_version: 1, order_no: o.order_no, order_state: "cancelled", already: true });
    const reason = str(body?.reason, 300) ? String(body!.reason) : "customer cancelled";
    await env.DB.batch([
      env.DB.prepare(`UPDATE hk_orders SET order_state='cancelled', cancelled_at=datetime('now'), cancel_reason=?1, updated_at=datetime('now') WHERE id=?2 AND order_state<>'cancelled' AND payment_state='awaiting_payment'`).bind(reason, o.id),
      env.DB.prepare(`UPDATE hk_reservations SET released_at=datetime('now'), release_reason='cancelled' WHERE order_id=?1 AND released_at IS NULL`).bind(o.id),
      env.DB.prepare(`INSERT INTO hk_payment_events (order_id, action, actor_kind, reason) VALUES (?1,'order_cancelled','integration',?2)`).bind(o.id, reason),
      outboxStmt(env, "order.cancelled", { order_id: o.id, customer_id: c.id, telegram_user_id: tg }, { order_no: o.order_no, reason, message_bm: BM.order_cancelled(reason) }),
    ]);
    return done(200, { api_version: 1, order_no: o.order_no, order_state: "cancelled" });
  }

  /* ────────────────────────────────────────────────────────────────────
     the notification outbox: claim, acknowledge, return
     ──────────────────────────────────────────────────────────────────── */
  if (path === "/events/claim" && method === "POST") {
    if (!hasScope(client, "events")) return err("forbidden", "Scope 'events' required", 403);
    const limit = Math.min(50, Math.max(1, num(body?.limit) ?? 20));
    const visibility = Math.min(600, Math.max(10, num(body?.visibility_seconds) ?? 60));
    const until = sqlPlusMinutes(visibility / 60);
    /* claim atomically: only rows that are pending, or whose previous claim
       has lapsed, and only this many. A lapsed claim returning to the queue
       is exactly why delivery is at-least-once. */
    const { results: ids } = await env.DB.prepare(
      `SELECT id FROM hk_outbox WHERE state='pending' OR (state='claimed' AND claim_expires_at < datetime('now')) ORDER BY id ASC LIMIT ?1`,
    ).bind(limit).all<{ id: number }>();
    if (ids.length === 0) return json({ api_version: 1, events: [] });
    const claimed: Record<string, unknown>[] = [];
    for (const { id } of ids) {
      const r = await env.DB.prepare(
        `UPDATE hk_outbox SET state='claimed', claimed_by=?1, claimed_at=datetime('now'), claim_expires_at=?2, attempts=attempts+1
          WHERE id=?3 AND (state='pending' OR (state='claimed' AND claim_expires_at < datetime('now')))`,
      ).bind(client.id, until, id).run();
      if ((r.meta?.changes ?? 0) !== 1) continue; // another consumer won it
      const row = await env.DB.prepare(
        `SELECT o.event_id, o.event_type, o.payload_version, o.payload, o.attempts, o.created_at, r.order_no, c.telegram_user_id
           FROM hk_outbox o LEFT JOIN hk_orders r ON r.id=o.order_id LEFT JOIN hk_customers c ON c.id=o.customer_id WHERE o.id=?1`,
      ).bind(id).first<Record<string, unknown>>();
      if (!row) continue;
      let payload: unknown = {};
      try { payload = JSON.parse(String(row.payload)); } catch { payload = {}; }
      claimed.push({
        event_id: row.event_id, event_type: row.event_type, payload_version: row.payload_version,
        order_no: row.order_no ?? null, telegram_user_id: row.telegram_user_id ?? null,
        attempts: row.attempts, created_at: row.created_at, payload,
      });
    }
    return json({ api_version: 1, events: claimed, claim_expires_at: until, delivery: "at-least-once" });
  }
  if (path === "/events/ack" && method === "POST") {
    if (!hasScope(client, "events")) return err("forbidden", "Scope 'events' required", 403);
    const ids = Array.isArray(body?.event_ids) ? (body!.event_ids as unknown[]).filter((x) => typeof x === "string").slice(0, 100) as string[] : [];
    if (ids.length === 0) return err("invalid_input", "event_ids is required", 400);
    let acked = 0;
    for (const eid of ids) {
      const r = await env.DB.prepare(`UPDATE hk_outbox SET state='delivered', delivered_at=datetime('now') WHERE event_id=?1 AND claimed_by=?2 AND state='claimed'`).bind(eid, client.id).run();
      acked += r.meta?.changes ?? 0;
    }
    return json({ api_version: 1, acknowledged: acked });
  }
  if (path === "/events/nack" && method === "POST") {
    if (!hasScope(client, "events")) return err("forbidden", "Scope 'events' required", 403);
    const eid = str(body?.event_id, 64) ? String(body!.event_id) : "";
    if (!eid) return err("invalid_input", "event_id is required", 400);
    const reason = str(body?.error, 300) ? String(body!.error) : "delivery failed";
    /* back to the queue at once, and dead-lettered after ten tries rather
       than retried for ever. A dead event NEVER changes a payment state. */
    await env.DB.prepare(
      `UPDATE hk_outbox SET state = CASE WHEN attempts >= 10 THEN 'dead' ELSE 'pending' END, claimed_by=NULL, claimed_at=NULL, claim_expires_at=NULL, last_error=?1
        WHERE event_id=?2 AND claimed_by=?3`,
    ).bind(reason, eid, client.id).run();
    return json({ api_version: 1, ok: true });
  }

  return err("not_found", "No such Hankei's API route", 404);
}
