/**
 * HANKEI'S COMMERCE - the staff side. v1.163.0.
 *
 * Ordering and MANUAL payment verification for the seaweed-snack brand.
 * There is no bank API and no payment gateway: the customer pays a STATIC
 * Maybank QR, uploads a receipt, and an authorised person opens the
 * receiving account, finds the transaction, and allocates it here.
 *
 * THE RULE, enforced in code rather than in a comment:
 *   - `verifyPayment` below is the ONLY path to payment_state 'verified'.
 *   - It requires `hankeis_verify`, a bank reference, an amount, a bank
 *     time, the receiving account, and an explicit attestation that the
 *     reviewer read the BANK record and not merely the customer receipt.
 *   - It allocates that bank transaction in the same transaction, against a
 *     UNIQUE (receiving_account, bank_reference) index, so one transfer can
 *     never pay for two orders.
 *   - Nothing a customer or an integration credential can send reaches it.
 *     Receipts, OCR, declarations and Telegram messages move an order to
 *     'awaiting_review' and no further.
 *
 * ATOMICITY ON D1. D1 has no interactive transactions; `env.DB.batch()` is
 * one implicit transaction, which is the house pattern (see bridge.ts). The
 * critical section is therefore written as conditional SQL:
 * `INSERT ... SELECT ... WHERE EXISTS (<the state I require>)`, so the
 * condition is evaluated by SQLite at write time rather than by JavaScript
 * before it. `meta.changes` then tells the caller whether it won the race.
 */
import type { Env } from "./index";
import { json, err, audit, str, num, logError } from "./shared";
import { can } from "./permissions";
import { notify } from "./staff";
import {
  quote, canFulfil, canPaymentTransition, exceptionsFor, compareAmount,
  validateReceiptUpload, receiptKey, RECEIPT_KEY_RE, RECEIPT_MAX_BYTES,
  orderNumber, mytNow, sqlNow, sqlPlusMinutes, ocrAvailable, ocrAdapter,
  EVENT_PAYLOAD_VERSION, BM, rm,
  type Category, type QuoteRequestLine, type CatalogueProduct, type CataloguePackage, type EventType,
} from "./hankeis-core";

/* ────────────────────────────────────────────────────────────────────────
   settings
   ──────────────────────────────────────────────────────────────────────── */
/** Defaults are deliberately EMPTY where money is concerned: the portal must
    never show a customer a recipient name or a QR that nobody configured. */
export const SETTING_DEFAULTS = {
  qr_image_key: "",
  recipient_name: "",
  receiving_account: "",
  pay_instructions_bm: "Imbas kod QR Maybank di atas menggunakan aplikasi bank anda. Pastikan nama penerima adalah betul sebelum membayar. Selepas membayar, muat naik resit anda.",
  catalogue_key: "",
  shipping_mode: "flat",
  shipping_flat_cents: "800",
  shipping_free_over_cents: "",
  reservation_minutes: "1440",
  max_receipts_per_order: "6",
  uploads_per_hour: "10",
  /* No brand_name key. It was here and nothing read it - a setting an owner
     can change that changes nothing is worse than no setting at all. */
};
/** Changing any of these changes where a customer sends money. Owner only,
    and every change is audited with the old and new value. */
export const PAYMENT_DESTINATION_KEYS = ["qr_image_key", "recipient_name", "receiving_account"] as const;

export type HkSettings = { [K in keyof typeof SETTING_DEFAULTS]: string };
export async function settings(env: Env): Promise<HkSettings> {
  const out: HkSettings = { ...SETTING_DEFAULTS };
  try {
    const { results } = await env.DB.prepare(`SELECT key, value FROM hk_settings`).all<{ key: string; value: string }>();
    for (const r of results) if (r.key in SETTING_DEFAULTS) (out as Record<string, string>)[r.key] = r.value;
  } catch { /* pre-0133 */ }
  return out;
}
const int = (s: string, fallback = 0) => { const n = Number.parseInt(s, 10); return Number.isFinite(n) ? n : fallback; };

/* ────────────────────────────────────────────────────────────────────────
   small helpers
   ──────────────────────────────────────────────────────────────────────── */
type Actor = { id: number; role: string; name: string };
const pending = (e: unknown) => String(e).includes("no such table") ? err("pending_migration", "Hankei's Commerce needs database change 0133 - run PUSH.bat", 503) : null;
const changes = (r: unknown): number => (r as { meta?: { changes?: number } })?.meta?.changes ?? 0;

export async function sha256Hex(data: ArrayBuffer | Uint8Array): Promise<string> {
  const buf = data instanceof Uint8Array ? data.slice().buffer as ArrayBuffer : data;
  const d = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * One outbox row, as a statement to put in the caller's batch. The event and
 * the business change it describes commit together or not at all.
 *
 * `guard.sql` is a FUNCTION of the first free placeholder number, not a
 * string. It has to be: the row itself occupies ?1-?7, so a guard written
 * with a hard-coded ?1 would silently read the event id where it meant the
 * order id - and a guard that is quietly always true is worse than none.
 * The concurrency test caught exactly that.
 */
export function outboxStmt(
  env: Env, type: EventType, o: { order_id: number | null; customer_id: number | null; telegram_user_id: number | null }, payload: Record<string, unknown>,
  guard?: { sql: (firstPlaceholder: number) => string; binds: unknown[] },
) {
  const eventId = crypto.randomUUID();
  const body = JSON.stringify({ ...payload, event_type: type, event_id: eventId, occurred_at: sqlNow() });
  if (guard) {
    return env.DB.prepare(
      `INSERT INTO hk_outbox (event_id, event_type, payload_version, order_id, customer_id, telegram_user_id, payload)
       SELECT ?1,?2,?3,?4,?5,?6,?7 WHERE EXISTS (${guard.sql(8)})`,
    ).bind(eventId, type, EVENT_PAYLOAD_VERSION, o.order_id, o.customer_id, o.telegram_user_id, body, ...guard.binds);
  }
  return env.DB.prepare(
    `INSERT INTO hk_outbox (event_id, event_type, payload_version, order_id, customer_id, telegram_user_id, payload) VALUES (?1,?2,?3,?4,?5,?6,?7)`,
  ).bind(eventId, type, EVENT_PAYLOAD_VERSION, o.order_id, o.customer_id, o.telegram_user_id, body);
}

/* ────────────────────────────────────────────────────────────────────────
   catalogue and quoting - shared with the integration API
   ──────────────────────────────────────────────────────────────────────── */
export async function catalogue(env: Env): Promise<{ products: CatalogueProduct[]; packages: CataloguePackage[] }> {
  const { results: products } = await env.DB.prepare(
    `SELECT id, sku, name, unit_price_cents, is_active, inventory_item_id FROM hk_products WHERE is_active = 1 ORDER BY sort, id`,
  ).all<CatalogueProduct>();
  const { results: packages } = await env.DB.prepare(
    `SELECT id, code, name, eligibility, min_qty, price_cents, is_active FROM hk_packages WHERE is_active = 1 ORDER BY sort, id`,
  ).all<CataloguePackage>();
  return { products, packages };
}

export async function quoteFor(env: Env, customerCategory: Category, lines: QuoteRequestLine[]) {
  const s = await settings(env);
  const cat = await catalogue(env);
  return quote(
    { lines, customerCategory, shipping: { mode: (s.shipping_mode as "flat" | "quote" | "pickup") ?? "flat", flat_cents: int(s.shipping_flat_cents, 0), free_over_cents: s.shipping_free_over_cents ? int(s.shipping_free_over_cents) : null } },
    cat,
  );
}

/* ────────────────────────────────────────────────────────────────────────
   order creation - shared by the portal and the integration API
   ──────────────────────────────────────────────────────────────────────── */
export interface CreateOrderInput {
  customer_id: number; address_id?: number | null; lines: QuoteRequestLine[];
  channel: "portal" | "telegram"; note?: string | null;
  created_by?: number | null; client_id?: number | null;
}
export type CreateOrderResult =
  | { ok: true; order_id: number; order_no: string; total_cents: number; needs_quote: boolean; reserved_until: string | null; short: string[] }
  | { ok: false; code: string; message: string; status: number };

/**
 * Prices on the server, reserves stock atomically, snapshots the payment
 * instructions, and writes the order.created event in the same batch.
 *
 * Stock: availability is `inventory_items.stock` minus live reservations,
 * and the reservation INSERT carries that arithmetic in its own WHERE, so
 * two concurrent orders for the last packet cannot both succeed - SQLite
 * serialises the writes and the loser inserts zero rows. If any line fails,
 * every reservation for the order is released and the order is refused, so
 * a partial hold can never linger.
 */
export async function createOrder(env: Env, input: CreateOrderInput): Promise<CreateOrderResult> {
  const cust = await env.DB.prepare(`SELECT id, name, category, telegram_user_id FROM hk_customers WHERE id = ?1`).bind(input.customer_id).first<{ id: number; name: string; category: Category; telegram_user_id: number | null }>();
  if (!cust) return { ok: false, code: "unknown_customer", message: "No such customer", status: 404 };
  if (input.address_id != null) {
    const own = await env.DB.prepare(`SELECT 1 AS x FROM hk_addresses WHERE id = ?1 AND customer_id = ?2`).bind(input.address_id, cust.id).first();
    if (!own) return { ok: false, code: "bad_address", message: "That address does not belong to this customer", status: 400 };
  }
  const q = await quoteFor(env, cust.category, input.lines);
  if (!q.ok) return { ok: false, code: q.code, message: q.message, status: 400 };

  const s = await settings(env);
  const resMinutes = Math.max(0, int(s.reservation_minutes, 1440));
  const now = Date.now();
  const expiresAt = resMinutes > 0 ? sqlPlusMinutes(resMinutes, now) : null;

  /* the order number: one counter row, bumped atomically */
  const day = orderNumber(0, mytNow(now)).slice(0, 12); // HK-YYMMDD
  await env.DB.prepare(`INSERT INTO hk_counters (name, value) VALUES (?1, 0) ON CONFLICT(name) DO NOTHING`).bind(day).run();
  const seqRow = await env.DB.prepare(`UPDATE hk_counters SET value = value + 1 WHERE name = ?1 RETURNING value`).bind(day).first<{ value: number }>();
  const orderNo = orderNumber(seqRow?.value ?? 1, mytNow(now));

  const paySnapshot = JSON.stringify({
    recipient_name: s.recipient_name, receiving_account_label: s.receiving_account ? "configured" : "",
    qr_image_key: s.qr_image_key, instructions_bm: s.pay_instructions_bm,
    disclaimer_bm: BM.receipt_not_confirmation, captured_at: sqlNow(now),
  });
  const orderState = q.needs_quote ? "quote_required" : "open";
  const ins = await env.DB.prepare(
    `INSERT INTO hk_orders (order_no, customer_id, address_id, channel, order_state, payment_state, fulfilment_state,
       subtotal_cents, shipping_cents, total_cents, shipping_mode, pay_snapshot, reserved_until, expires_at, note, created_by, client_id)
     VALUES (?1,?2,?3,?4,?5,'awaiting_payment','not_ready',?6,?7,?8,?9,?10,?11,?11,?12,?13,?14) RETURNING id`,
  ).bind(orderNo, cust.id, input.address_id ?? null, input.channel, orderState,
    q.subtotal_cents, q.shipping_cents, q.total_cents, q.shipping_mode, paySnapshot, expiresAt,
    str(input.note, 500) ? input.note : null, input.created_by ?? null, input.client_id ?? null).first<{ id: number }>();
  const orderId = ins?.id;
  if (!orderId) return { ok: false, code: "failed", message: "Could not create the order", status: 500 };

  const lineStmts = q.lines.map((l) => env.DB.prepare(
    `INSERT INTO hk_order_lines (order_id, product_id, package_id, name_snapshot, sku_snapshot, qty, unit_price_cents, line_total_cents, inventory_item_id)
     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)`,
  ).bind(orderId, l.product_id, l.package_id, l.name_snapshot, l.sku_snapshot, l.qty, l.unit_price_cents, l.line_total_cents, l.inventory_item_id));
  await env.DB.batch(lineStmts);

  /* stock: one conditional insert per tracked line */
  const short: string[] = [];
  if (expiresAt) {
    const tracked = q.lines.filter((l) => l.inventory_item_id != null);
    if (tracked.length > 0) {
      const resStmts = tracked.map((l) => env.DB.prepare(
        `INSERT INTO hk_reservations (order_id, inventory_item_id, qty, expires_at)
         SELECT ?1,?2,?3,?4
          WHERE COALESCE((SELECT stock FROM inventory_items WHERE id = ?2), 0)
              - COALESCE((SELECT SUM(qty) FROM hk_reservations WHERE inventory_item_id = ?2 AND released_at IS NULL AND expires_at > datetime('now')), 0) >= ?3`,
      ).bind(orderId, l.inventory_item_id, l.qty, expiresAt));
      const res = await env.DB.batch(resStmts);
      res.forEach((r, i) => { if (changes(r) === 0) short.push(tracked[i]!.name_snapshot); });
      if (short.length > 0) {
        /* a partial hold is worse than none: release everything and refuse */
        await env.DB.batch([
          env.DB.prepare(`UPDATE hk_reservations SET released_at = datetime('now'), release_reason = 'order_refused' WHERE order_id = ?1 AND released_at IS NULL`).bind(orderId),
          env.DB.prepare(`DELETE FROM hk_order_lines WHERE order_id = ?1`).bind(orderId),
          env.DB.prepare(`DELETE FROM hk_orders WHERE id = ?1`).bind(orderId),
        ]);
        return { ok: false, code: "out_of_stock", message: `Not enough stock: ${short.join(", ")}`, status: 409 };
      }
    }
  }

  await env.DB.batch([
    env.DB.prepare(`INSERT INTO hk_payment_events (order_id, action, to_state, actor_id, actor_kind, meta) VALUES (?1,'order_created','awaiting_payment',?2,?3,?4)`)
      .bind(orderId, input.created_by ?? null, input.channel === "telegram" ? "integration" : "staff", JSON.stringify({ total_cents: q.total_cents, needs_quote: q.needs_quote })),
    outboxStmt(env, q.needs_quote ? "order.quoted" : "order.created", { order_id: orderId, customer_id: cust.id, telegram_user_id: cust.telegram_user_id }, {
      order_no: orderNo, total_cents: q.total_cents, subtotal_cents: q.subtotal_cents, shipping_cents: q.shipping_cents,
      order_state: orderState, payment_state: "awaiting_payment", needs_quote: q.needs_quote,
      message_bm: q.needs_quote ? BM.quote_required : BM.awaiting_payment(rm(q.total_cents), s.recipient_name || "-"),
    }),
  ]);
  return { ok: true, order_id: orderId, order_no: orderNo, total_cents: q.total_cents, needs_quote: q.needs_quote, reserved_until: expiresAt, short };
}

/* ────────────────────────────────────────────────────────────────────────
   receipts - shared by the portal and the integration API
   ──────────────────────────────────────────────────────────────────────── */
export interface StoreReceiptInput {
  order_id: number; customer_id: number; bytes: Uint8Array; declaredType: string;
  via: "portal" | "telegram"; uploaded_by?: number | null; client_id?: number | null;
  declared_amount_cents?: number | null; declared_reference?: string | null;
}
export type StoreReceiptResult =
  | { ok: true; receipt_id: number; key: string; duplicate_of: number | null; payment_state: string }
  | { ok: false; code: string; message: string; status: number };

/**
 * Validates the FILE (not the header), stores it under an unguessable key,
 * hashes it for exact-duplicate detection, and moves the order into review.
 *
 * It does not, and cannot, verify anything. The most convincing receipt in
 * the world lands here as `awaiting_review` and waits for a human.
 */
export async function storeReceipt(env: Env, input: StoreReceiptInput): Promise<StoreReceiptResult> {
  const o = await env.DB.prepare(`SELECT id, customer_id, order_state, payment_state, total_cents FROM hk_orders WHERE id = ?1`).bind(input.order_id).first<{ id: number; customer_id: number; order_state: string; payment_state: string; total_cents: number }>();
  if (!o) return { ok: false, code: "not_found", message: "No such order", status: 404 };
  if (o.customer_id !== input.customer_id) return { ok: false, code: "forbidden", message: "That order belongs to another customer", status: 403 };
  if (o.payment_state === "verified") return { ok: false, code: "already_verified", message: "This payment is already verified - nothing more is needed", status: 409 };
  if (o.payment_state === "refunded") return { ok: false, code: "refunded", message: "This order was refunded", status: 409 };

  const s = await settings(env);
  const cap = Math.max(1, int(s.max_receipts_per_order, 6));
  const count = await env.DB.prepare(`SELECT COUNT(*) AS c FROM hk_receipts WHERE order_id = ?1`).bind(input.order_id).first<{ c: number }>();
  if ((count?.c ?? 0) >= cap) return { ok: false, code: "too_many", message: `That is ${cap} receipts on this order - please contact us instead`, status: 429 };

  const v = validateReceiptUpload(input.declaredType, input.bytes.byteLength, input.bytes.subarray(0, 16));
  if (!v.ok) return { ok: false, code: v.code, message: v.message, status: v.code === "too_large" ? 413 : 400 };

  const hash = await sha256Hex(input.bytes);
  const dupe = await env.DB.prepare(`SELECT id FROM hk_receipts WHERE sha256 = ?1 ORDER BY id ASC LIMIT 1`).bind(hash).first<{ id: number }>();

  const key = receiptKey(crypto.randomUUID());
  await env.MEDIA.put(key, input.bytes, { httpMetadata: { contentType: v.contentType } });

  const ins = await env.DB.prepare(
    `INSERT INTO hk_receipts (order_id, customer_id, r2_key, content_type, bytes, sha256, uploaded_via, uploaded_by, client_id, declared_amount_cents, declared_reference, ocr_state)
     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12) RETURNING id`,
  ).bind(input.order_id, input.customer_id, key, v.contentType, input.bytes.byteLength, hash, input.via,
    input.uploaded_by ?? null, input.client_id ?? null,
    num(input.declared_amount_cents) !== null ? input.declared_amount_cents : null,
    str(input.declared_reference, 120) ? input.declared_reference : null,
    ocrAvailable() ? "pending" : "unavailable").first<{ id: number }>();
  const receiptId = ins?.id ?? 0;

  /* OCR, if and only if an engine is registered. With none, nothing is
     written and the reviewer is told no extraction was attempted. */
  if (ocrAvailable() && receiptId) {
    try {
      const ex = await ocrAdapter()!.extract({ key, contentType: v.contentType, bytes: input.bytes.byteLength });
      await env.DB.prepare(
        `UPDATE hk_receipts SET ocr_state='done', ocr_engine=?1, ocr_amount_cents=?2, ocr_datetime=?3, ocr_recipient=?4, ocr_reference=?5, ocr_confidence=?6, ocr_raw=?7 WHERE id=?8`,
      ).bind(ex.engine, ex.amount_cents, ex.datetime, ex.recipient, ex.reference, ex.confidence, ex.raw ?? null, receiptId).run();
    } catch (e) {
      await env.DB.prepare(`UPDATE hk_receipts SET ocr_state='failed' WHERE id=?1`).bind(receiptId).run();
      await logError(env, "hankeis_ocr", String(e).slice(0, 200));
    }
  }

  /* the order moves to review - and no further, ever, from here */
  const gate = canPaymentTransition(o.payment_state as never, "awaiting_review", "customer");
  const stmts = [
    env.DB.prepare(`INSERT INTO hk_payment_events (order_id, receipt_id, action, from_state, to_state, actor_id, actor_kind, meta) VALUES (?1,?2,'receipt_uploaded',?3,'awaiting_review',?4,?5,?6)`)
      .bind(input.order_id, receiptId, o.payment_state, input.uploaded_by ?? null, input.via === "telegram" ? "integration" : "staff",
        JSON.stringify({ sha256: hash, bytes: input.bytes.byteLength, duplicate_of: dupe?.id ?? null, ocr: ocrAvailable() ? "attempted" : "unavailable" })),
  ];
  if (gate.ok) {
    stmts.push(env.DB.prepare(`UPDATE hk_orders SET payment_state='awaiting_review', updated_at=datetime('now') WHERE id=?1 AND payment_state IN ('awaiting_payment','clarification_required')`).bind(input.order_id));
  }
  stmts.push(outboxStmt(env, "receipt.received", { order_id: input.order_id, customer_id: input.customer_id, telegram_user_id: null }, {
    receipt_id: receiptId, message_bm: BM.awaiting_review, reminder_bm: BM.receipt_not_confirmation,
  }));
  await env.DB.batch(stmts);

  const after = gate.ok && (o.payment_state === "awaiting_payment" || o.payment_state === "clarification_required") ? "awaiting_review" : o.payment_state;
  return { ok: true, receipt_id: receiptId, key, duplicate_of: dupe?.id ?? null, payment_state: after };
}

/* ────────────────────────────────────────────────────────────────────────
   THE MANUAL VERIFICATION
   ──────────────────────────────────────────────────────────────────────── */
export interface VerifyInput {
  order_id: number; receipt_id?: number | null;
  receiving_account: string; bank_reference: string; amount_cents: number; bank_time: string;
  attested_bank_checked: boolean; note?: string | null;
}
export type VerifyResult =
  | { ok: true; order_no: string; exceptions: { kind: string; detail: string }[]; fulfilment_state: string }
  | { ok: false; code: string; message: string; status: number };

/** References a reviewer must not be able to type just to get past the form. */
const PLACEHOLDER_REFS = new Set(["n/a", "na", "none", "nil", "-", "--", "test", "unknown", "tiada", "x", "xx", "xxx", "0", "00", "000", "1234"]);

/**
 * The only door to `verified`.
 *
 * Refuses unless the reviewer holds hankeis_verify, names the receiving
 * account, gives a bank reference that is not a placeholder, gives the
 * banked amount and time, and ATTESTS that they read the bank record. If
 * the bank detail cannot distinguish this transfer from another, the
 * reviewer is expected to use `clarification` instead - this function will
 * not invent an identifier to let an approval through.
 *
 * The whole critical section is one batch: allocate, verify, log, notify.
 * Concurrency is settled by SQL, not by a read-then-write in JavaScript.
 */
export async function verifyPayment(env: Env, actor: Actor, v: VerifyInput): Promise<VerifyResult> {
  if (!can(actor.role, "hankeis_verify")) return { ok: false, code: "forbidden", message: "Only an authorised finance reviewer may verify a payment", status: 403 };
  if (v.attested_bank_checked !== true) {
    return { ok: false, code: "attestation_required", message: "Tick the attestation: the bank record itself must be checked, not only the customer receipt", status: 400 };
  }
  const ref = String(v.bank_reference ?? "").trim();
  const account = String(v.receiving_account ?? "").trim();
  if (!account) return { ok: false, code: "no_account", message: "Name the receiving account the money arrived in", status: 400 };
  if (ref.length < 4 || PLACEHOLDER_REFS.has(ref.toLowerCase())) {
    return { ok: false, code: "no_reference", message: "Enter the bank transaction reference exactly as Maybank shows it. If the bank record cannot identify this transfer, use Request clarification instead - do not invent a reference.", status: 400 };
  }
  const amount = num(v.amount_cents);
  if (amount === null || !Number.isInteger(amount) || amount <= 0) return { ok: false, code: "bad_amount", message: "Enter the amount exactly as it appears in the bank record, in sen", status: 400 };
  if (!str(v.bank_time, 40)) return { ok: false, code: "bad_time", message: "Enter the transaction time from the bank record", status: 400 };

  const o = await env.DB.prepare(`SELECT id, order_no, customer_id, payment_state, order_state, total_cents, expires_at FROM hk_orders WHERE id = ?1`)
    .bind(v.order_id).first<{ id: number; order_no: string; customer_id: number; payment_state: string; order_state: string; total_cents: number; expires_at: string | null }>();
  if (!o) return { ok: false, code: "not_found", message: "No such order", status: 404 };
  const gate = canPaymentTransition(o.payment_state as never, "verified", "finance");
  if (!gate.ok) return { ok: false, code: "bad_state", message: gate.reason, status: 409 };

  /* is this transfer already spent on another order? A friendly answer
     before the constraint fires, and the constraint behind it regardless. */
  const taken = await env.DB.prepare(
    `SELECT a.id, a.order_id, o.order_no FROM hk_bank_allocations a JOIN hk_orders o ON o.id = a.order_id
      WHERE a.receiving_account = ?1 AND a.bank_reference = ?2 AND a.reversed_at IS NULL`,
  ).bind(account, ref).first<{ id: number; order_id: number; order_no: string }>();
  if (taken) {
    return { ok: false, code: "already_allocated", message: `That bank transaction is already allocated to order ${taken.order_no}. One transfer cannot pay for two orders.`, status: 409 };
  }

  const exceptions = exceptionsFor({ total_cents: o.total_cents, order_state: o.order_state, expires_at: o.expires_at }, { amount_cents: amount, bank_time: v.bank_time }, sqlNow());
  const clean = exceptions.length === 0;
  /* An exception does NOT block the allocation - the money did arrive, and
     recording where it went is the honest thing. It blocks FULFILMENT: the
     order lands on hold for a human decision instead of the packing queue. */
  const nextFulfilment = clean ? "ready_to_pack" : "on_hold";

  let res;
  try {
    res = await env.DB.batch([
      /* 1. allocate - only if the order is still verifiable */
      env.DB.prepare(
        `INSERT INTO hk_bank_allocations (receiving_account, bank_reference, amount_cents, bank_time, order_id, receipt_id, attested_bank_checked, note, verified_by)
         SELECT ?1,?2,?3,?4,?5,?6,1,?7,?8
          WHERE EXISTS (SELECT 1 FROM hk_orders WHERE id = ?5 AND payment_state IN ('awaiting_payment','awaiting_review','clarification_required'))`,
      ).bind(account, ref, amount, v.bank_time, v.order_id, v.receipt_id ?? null, str(v.note, 500) ? v.note : null, actor.id),
      /* 2. the order - moves only WITH the allocation that just landed */
      env.DB.prepare(
        `UPDATE hk_orders SET payment_state='verified', fulfilment_state=?2, updated_at=datetime('now')
          WHERE id=?1 AND payment_state IN ('awaiting_payment','awaiting_review','clarification_required')
            AND EXISTS (SELECT 1 FROM hk_bank_allocations WHERE order_id=?1 AND receiving_account=?3 AND bank_reference=?4)`,
      ).bind(v.order_id, nextFulfilment, account, ref),
      /* 3. the receipt that was used, if any. Guarded on MY allocation, not
         on the order being verified: in a race the loser would see the
         winner's 'verified' and happily write a second trail. */
      env.DB.prepare(
        `UPDATE hk_receipts SET state='accepted', reviewed_by=?2, reviewed_at=datetime('now')
          WHERE id=?3 AND order_id=?1
            AND EXISTS (SELECT 1 FROM hk_bank_allocations WHERE order_id=?1 AND receiving_account=?4 AND bank_reference=?5)`,
      ).bind(v.order_id, actor.id, v.receipt_id ?? -1, account, ref),
      /* 4. the trail */
      env.DB.prepare(
        `INSERT INTO hk_payment_events (order_id, receipt_id, action, from_state, to_state, actor_id, actor_kind, reason, meta)
         SELECT ?1,?2,'payment_verified',?3,'verified',?4,'staff',?5,?6
          WHERE EXISTS (SELECT 1 FROM hk_bank_allocations WHERE order_id=?1 AND receiving_account=?7 AND bank_reference=?8)`,
      ).bind(v.order_id, v.receipt_id ?? null, o.payment_state, actor.id, str(v.note, 500) ? v.note : null,
        JSON.stringify({ receiving_account: account, bank_reference: ref, amount_cents: amount, bank_time: v.bank_time, attested: true, exceptions: exceptions.map((e) => e.kind) }),
        account, ref),
      /* 5. EXACTLY ONE payment-verified event, in the same transaction */
      outboxStmt(env, "payment.verified", { order_id: v.order_id, customer_id: o.customer_id, telegram_user_id: null }, {
        order_no: o.order_no, amount_cents: amount, total_cents: o.total_cents,
        exceptions: exceptions.map((e) => e.kind), message_bm: BM.verified(o.order_no),
      }, {
        sql: (n) => `SELECT 1 FROM hk_bank_allocations WHERE order_id=?${n} AND receiving_account=?${n + 1} AND bank_reference=?${n + 2}`,
        binds: [v.order_id, account, ref],
      }),
    ]);
  } catch (e) {
    if (String(e).includes("UNIQUE")) {
      return { ok: false, code: "already_allocated", message: "That bank transaction has just been allocated to another order. Nothing was changed.", status: 409 };
    }
    throw e;
  }
  if (changes(res[1]) !== 1) {
    /* somebody else won the race, or the state moved under us */
    const now = await env.DB.prepare(`SELECT payment_state FROM hk_orders WHERE id = ?1`).bind(v.order_id).first<{ payment_state: string }>();
    return { ok: false, code: "race_lost", message: `This order is now ${now?.payment_state ?? "unknown"} - another reviewer got there first. Nothing was changed.`, status: 409 };
  }

  /* exceptions and the stock re-check, outside the critical section */
  for (const ex of exceptions) {
    await env.DB.prepare(`INSERT INTO hk_exceptions (order_id, kind, detail, amount_cents, opened_by) VALUES (?1,?2,?3,?4,?5)`)
      .bind(v.order_id, ex.kind, ex.detail, ex.amount_cents, actor.id).run();
  }
  await audit(env, actor.id, "hankeis.payment_verified", "hk_orders", String(v.order_id), {
    order_no: o.order_no, from: o.payment_state, to: "verified",
    receiving_account: account, bank_reference: ref, amount_cents: amount, bank_time: v.bank_time,
    attested_bank_checked: true, exceptions: exceptions.map((e) => e.kind),
  });
  return { ok: true, order_no: o.order_no, exceptions: exceptions.map((e) => ({ kind: e.kind, detail: e.detail })), fulfilment_state: nextFulfilment };
}

/* ────────────────────────────────────────────────────────────────────────
   expiry sweep - reservations only. The QR does not expire.
   ──────────────────────────────────────────────────────────────────────── */
export async function expireOrders(env: Env): Promise<{ expired: number; released: number }> {
  try {
    const { results: due } = await env.DB.prepare(
      `SELECT id, order_no, customer_id FROM hk_orders
        WHERE order_state = 'open' AND payment_state = 'awaiting_payment' AND expires_at IS NOT NULL AND expires_at < datetime('now') LIMIT 100`,
    ).all<{ id: number; order_no: string; customer_id: number }>();
    if (due.length === 0) return { expired: 0, released: 0 };
    const stmts = [];
    for (const o of due) {
      stmts.push(env.DB.prepare(`UPDATE hk_orders SET order_state='expired', updated_at=datetime('now') WHERE id=?1 AND order_state='open' AND payment_state='awaiting_payment'`).bind(o.id));
      stmts.push(env.DB.prepare(`UPDATE hk_reservations SET released_at=datetime('now'), release_reason='expired' WHERE order_id=?1 AND released_at IS NULL`).bind(o.id));
      stmts.push(env.DB.prepare(`INSERT INTO hk_payment_events (order_id, action, from_state, to_state, actor_kind, reason) VALUES (?1,'order_expired','awaiting_payment','awaiting_payment','system','reservation lapsed')`).bind(o.id));
      stmts.push(outboxStmt(env, "order.expired", { order_id: o.id, customer_id: o.customer_id, telegram_user_id: null }, { order_no: o.order_no, message_bm: BM.order_expired }));
    }
    await env.DB.batch(stmts);
    return { expired: due.length, released: due.length };
  } catch { return { expired: 0, released: 0 }; }
}

/* ────────────────────────────────────────────────────────────────────────
   the staff routes
   ──────────────────────────────────────────────────────────────────────── */
export async function handleHankeis(
  env: Env, request: Request, path: string, method: string, body: Record<string, unknown> | null, user: Actor, params: URLSearchParams,
): Promise<Response> {
  if (!can(user.role, "hankeis_view")) return err("forbidden", "Hankei's Commerce access required", 403);
  const mayOrder = can(user.role, "hankeis_orders");
  const mayVerify = can(user.role, "hankeis_verify");
  const mayPack = can(user.role, "hankeis_fulfil");
  const mayAdmin = can(user.role, "hankeis_settings");

  try {
    /* ---- dashboard ---- */
    if ((path === "" || path === "/") && method === "GET") {
      const s = await settings(env);
      const counts = await env.DB.prepare(
        `SELECT
           SUM(CASE WHEN order_state='open' AND payment_state='awaiting_payment' THEN 1 ELSE 0 END) AS awaiting_payment,
           SUM(CASE WHEN payment_state='awaiting_review' THEN 1 ELSE 0 END) AS awaiting_review,
           SUM(CASE WHEN payment_state='clarification_required' THEN 1 ELSE 0 END) AS clarification,
           SUM(CASE WHEN payment_state='verified' AND fulfilment_state='ready_to_pack' THEN 1 ELSE 0 END) AS to_pack,
           SUM(CASE WHEN fulfilment_state='shipped' THEN 1 ELSE 0 END) AS shipped,
           SUM(CASE WHEN fulfilment_state='on_hold' THEN 1 ELSE 0 END) AS on_hold,
           SUM(CASE WHEN order_state='quote_required' THEN 1 ELSE 0 END) AS quote_required,
           SUM(CASE WHEN date(created_at,'+8 hours')=date('now','+8 hours') THEN 1 ELSE 0 END) AS new_today
         FROM hk_orders`,
      ).first<Record<string, number>>();
      /* sales are counted from VERIFIED payments only, and cancelled or
         refunded orders are shown apart rather than folded in silently */
      const money = await env.DB.prepare(
        `SELECT
           COALESCE(SUM(CASE WHEN payment_state='verified' AND order_state NOT IN ('cancelled') THEN total_cents ELSE 0 END),0) AS verified_cents,
           COALESCE(SUM(CASE WHEN payment_state='verified' AND strftime('%Y-%m',created_at,'+8 hours')=strftime('%Y-%m','now','+8 hours') AND order_state NOT IN ('cancelled') THEN total_cents ELSE 0 END),0) AS verified_month_cents,
           COALESCE(SUM(CASE WHEN order_state='cancelled' THEN total_cents ELSE 0 END),0) AS cancelled_cents,
           COALESCE(SUM(CASE WHEN payment_state='refunded' THEN total_cents ELSE 0 END),0) AS refunded_cents
         FROM hk_orders`,
      ).first<Record<string, number>>();
      const exceptions = await env.DB.prepare(`SELECT COUNT(*) AS c FROM hk_exceptions WHERE state='open'`).first<{ c: number }>();
      const outbox = await env.DB.prepare(`SELECT COUNT(*) AS c FROM hk_outbox WHERE state IN ('pending','claimed')`).first<{ c: number }>();
      const { results: recent } = await env.DB.prepare(
        `SELECT o.id, o.order_no, o.total_cents, o.order_state, o.payment_state, o.fulfilment_state, o.created_at, c.name AS customer_name
           FROM hk_orders o JOIN hk_customers c ON c.id=o.customer_id ORDER BY o.id DESC LIMIT 12`,
      ).all();
      return json({
        can: { order: mayOrder, verify: mayVerify, pack: mayPack, admin: mayAdmin },
        counts: counts ?? {}, money: money ?? {},
        open_exceptions: exceptions?.c ?? 0, outbox_pending: outbox?.c ?? 0,
        recent,
        setup: {
          qr_configured: Boolean(s.qr_image_key), recipient_configured: Boolean(s.recipient_name),
          account_configured: Boolean(s.receiving_account), ocr_available: ocrAvailable(),
        },
      });
    }

    /* ---- settings ---- */
    if (path === "/settings" && method === "GET") {
      const s = await settings(env);
      const visibleSettings = mayAdmin ? s : { ...s, receiving_account: "" };
      const clients = mayAdmin
        ? (await env.DB.prepare(`SELECT id, name, scopes, is_active, created_at, last_seen_at, revoked_at FROM hk_api_clients ORDER BY id DESC`).all()).results
        : [];
      return json({ settings: visibleSettings, ocr_available: ocrAvailable(), clients });
    }
    if (path === "/settings" && method === "PUT") {
      if (!mayAdmin) return err("forbidden", "Only the owner may change these settings", 403);
      if (!body) return err("invalid_input", "Nothing to change", 400);
      const before = await settings(env);
      const changed: Record<string, { from: string; to: string }> = {};
      const stmts = [];
      for (const [k, v] of Object.entries(body)) {
        if (!(k in SETTING_DEFAULTS)) continue;
        const value = typeof v === "string" ? v.slice(0, 4000) : String(v ?? "").slice(0, 4000);
        const prev = (before as Record<string, string>)[k] ?? "";
        if (value === prev) continue;
        changed[k] = { from: prev, to: value };
        stmts.push(env.DB.prepare(
          `INSERT INTO hk_settings (key, value, updated_by, updated_at) VALUES (?1,?2,?3,datetime('now'))
           ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_by=excluded.updated_by, updated_at=excluded.updated_at`,
        ).bind(k, value, user.id));
      }
      if (stmts.length === 0) return err("invalid_input", "Nothing recognised to change", 400);
      await env.DB.batch(stmts);
      const touchedDestination = Object.keys(changed).some((k) => (PAYMENT_DESTINATION_KEYS as readonly string[]).includes(k));
      await audit(env, user.id, touchedDestination ? "hankeis.payment_destination_changed" : "hankeis.settings", "hk_settings", undefined, changed);
      if (touchedDestination) {
        const { results: execs } = await env.DB.prepare(`SELECT id FROM users WHERE is_active=1 AND role IN ('ceo','coo')`).all<{ id: number }>();
        for (const e of execs) if (e.id !== user.id) await notify(env, e.id, "hankeis", `Hankei's payment destination changed by ${user.name}`, `hankeis:settings`);
      }
      return json({ ok: true, changed: Object.keys(changed) });
    }

    /* ---- catalogue ---- */
    if (path === "/catalogue" && method === "GET") {
      const { results: products } = await env.DB.prepare(
        `SELECT p.*, i.stock AS stock,
                COALESCE((SELECT SUM(qty) FROM hk_reservations r WHERE r.inventory_item_id=p.inventory_item_id AND r.released_at IS NULL AND r.expires_at > datetime('now')),0) AS reserved
           FROM hk_products p LEFT JOIN inventory_items i ON i.id=p.inventory_item_id ORDER BY p.sort, p.id`,
      ).all();
      const { results: packages } = await env.DB.prepare(`SELECT * FROM hk_packages ORDER BY sort, id`).all();
      const { results: packageLines } = await env.DB.prepare(`SELECT * FROM hk_package_lines`).all();
      const { results: items } = await env.DB.prepare(`SELECT id, sku, name, stock FROM inventory_items WHERE status != 'discontinued' ORDER BY name LIMIT 500`).all().catch(() => ({ results: [] }));
      return json({ products, packages, package_lines: packageLines, inventory_items: items });
    }
    if (path === "/products" && method === "POST") {
      if (!mayAdmin) return err("forbidden", "Only the owner may change the catalogue", 403);
      if (!str(body?.sku, 60) || !str(body?.name, 200)) return err("invalid_input", "SKU and name are required", 400);
      const price = num(body?.unit_price_cents);
      if (price === null || !Number.isInteger(price) || price < 0) return err("invalid_input", "Price must be a whole number of sen", 400);
      const r = await env.DB.prepare(
        `INSERT INTO hk_products (sku,name,flavour,description,image_key,unit_price_cents,inventory_item_id,is_active,sort,created_by)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10) RETURNING id`,
      ).bind((body!.sku as string).trim(), (body!.name as string).trim(), str(body?.flavour, 80) ? body!.flavour : null,
        str(body?.description, 2000) ? body!.description : null, str(body?.image_key, 200) ? body!.image_key : null,
        price, num(body?.inventory_item_id), body?.is_active === false ? 0 : 1, num(body?.sort) ?? 0, user.id).first<{ id: number }>().catch(() => null);
      if (!r) return err("duplicate", "That SKU already exists", 409);
      await audit(env, user.id, "hankeis.product_create", "hk_products", String(r.id), { sku: body!.sku, price_cents: price });
      return json({ ok: true, id: r.id }, 201);
    }
    const prodM = path.match(/^\/products\/(\d+)$/);
    if (prodM && method === "PATCH") {
      if (!mayAdmin) return err("forbidden", "Only the owner may change the catalogue", 403);
      const id = Number(prodM[1]);
      const before = await env.DB.prepare(`SELECT * FROM hk_products WHERE id=?1`).bind(id).first<Record<string, unknown>>();
      if (!before) return err("not_found", "No such product", 404);
      const sets: string[] = []; const binds: unknown[] = [];
      const put = (col: string, v: unknown) => { binds.push(v); sets.push(`${col} = ?${binds.length}`); };
      if (str(body?.name, 200)) put("name", (body!.name as string).trim());
      if (body?.flavour !== undefined) put("flavour", str(body?.flavour, 80) ? body!.flavour : null);
      if (body?.description !== undefined) put("description", str(body?.description, 2000) ? body!.description : null);
      if (body?.image_key !== undefined) put("image_key", str(body?.image_key, 200) ? body!.image_key : null);
      if (num(body?.unit_price_cents) !== null) put("unit_price_cents", Math.max(0, Math.round(num(body!.unit_price_cents)!)));
      if (body?.inventory_item_id !== undefined) put("inventory_item_id", num(body?.inventory_item_id));
      if (typeof body?.is_active === "boolean") put("is_active", body.is_active ? 1 : 0);
      if (num(body?.sort) !== null) put("sort", Math.round(num(body!.sort)!));
      if (sets.length === 0) return err("invalid_input", "Nothing to change", 400);
      binds.push(id);
      await env.DB.prepare(`UPDATE hk_products SET ${sets.join(", ")} WHERE id = ?${binds.length}`).bind(...binds).run();
      await audit(env, user.id, "hankeis.product_update", "hk_products", String(id), { before: { price: before.unit_price_cents, active: before.is_active }, after: body });
      return json({ ok: true });
    }
    if (path === "/packages" && method === "POST") {
      if (!mayAdmin) return err("forbidden", "Only the owner may change packages", 403);
      if (!str(body?.code, 40) || !str(body?.name, 200)) return err("invalid_input", "Code and name are required", 400);
      const price = num(body?.price_cents);
      const elig = str(body?.eligibility, 20) && ["retail", "agent", "stockist"].includes(body!.eligibility as string) ? body!.eligibility as string : "retail";
      if (price === null || price < 0) return err("invalid_input", "Price must be a whole number of sen", 400);
      const r = await env.DB.prepare(
        `INSERT INTO hk_packages (code,name,description,eligibility,min_qty,price_cents,is_active,sort,created_by) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9) RETURNING id`,
      ).bind((body!.code as string).trim(), (body!.name as string).trim(), str(body?.description, 2000) ? body!.description : null,
        elig, Math.max(1, num(body?.min_qty) ?? 1), Math.round(price), body?.is_active === false ? 0 : 1, num(body?.sort) ?? 0, user.id).first<{ id: number }>().catch(() => null);
      if (!r) return err("duplicate", "That package code already exists", 409);
      await audit(env, user.id, "hankeis.package_create", "hk_packages", String(r.id), { code: body!.code, eligibility: elig, price_cents: price });
      return json({ ok: true, id: r.id }, 201);
    }

    /* ---- customers ---- */
    if (path === "/customers" && method === "GET") {
      const q = (params.get("q") ?? "").trim();
      const like = `%${q}%`;
      const { results } = await env.DB.prepare(
        `SELECT c.*, (SELECT COUNT(*) FROM hk_orders o WHERE o.customer_id=c.id) AS orders,
                (SELECT COALESCE(SUM(total_cents),0) FROM hk_orders o WHERE o.customer_id=c.id AND o.payment_state='verified') AS spent_cents
           FROM hk_customers c
          WHERE ?1 = '' OR c.name LIKE ?2 OR c.phone LIKE ?2 OR CAST(c.telegram_user_id AS TEXT) LIKE ?2
          ORDER BY c.id DESC LIMIT 200`,
      ).bind(q, like).all();
      return json({ customers: results });
    }
    if (path === "/customers" && method === "POST") {
      if (!mayOrder) return err("forbidden", "Sales access required", 403);
      if (!str(body?.name, 200)) return err("invalid_input", "A name is required", 400);
      const r = await env.DB.prepare(
        `INSERT INTO hk_customers (name, phone, email, notes, created_by, created_via) VALUES (?1,?2,?3,?4,?5,'portal') RETURNING id`,
      ).bind((body!.name as string).trim(), str(body?.phone, 40) ? body!.phone : null, str(body?.email, 200) ? body!.email : null,
        str(body?.notes, 2000) ? body!.notes : null, user.id).first<{ id: number }>();
      await audit(env, user.id, "hankeis.customer_create", "hk_customers", String(r?.id ?? ""), { name: body!.name });
      return json({ ok: true, id: r?.id }, 201);
    }
    const custM = path.match(/^\/customers\/(\d+)$/);
    if (custM && method === "GET") {
      const id = Number(custM[1]);
      const customer = await env.DB.prepare(`SELECT * FROM hk_customers WHERE id=?1`).bind(id).first();
      if (!customer) return err("not_found", "No such customer", 404);
      const { results: addresses } = await env.DB.prepare(`SELECT * FROM hk_addresses WHERE customer_id=?1 ORDER BY is_default DESC, id`).bind(id).all();
      const { results: orders } = await env.DB.prepare(`SELECT id, order_no, total_cents, order_state, payment_state, fulfilment_state, created_at FROM hk_orders WHERE customer_id=?1 ORDER BY id DESC LIMIT 100`).bind(id).all();
      return json({ customer, addresses, orders });
    }
    const catM = path.match(/^\/customers\/(\d+)\/category$/);
    if (catM && method === "POST") {
      /* the privilege gate: a customer can never put themselves on agent or
         stockist pricing, and neither can the integration credential */
      if (!mayAdmin && !can(user.role, "hankeis_verify")) return err("forbidden", "Only authorised staff may change a customer category", 403);
      const id = Number(catM[1]);
      const next = str(body?.category, 20) ? String(body!.category) : "";
      if (!["retail", "agent", "stockist"].includes(next)) return err("invalid_input", "Category must be retail, agent or stockist", 400);
      const before = await env.DB.prepare(`SELECT category, name FROM hk_customers WHERE id=?1`).bind(id).first<{ category: string; name: string }>();
      if (!before) return err("not_found", "No such customer", 404);
      await env.DB.prepare(`UPDATE hk_customers SET category=?1, category_changed_by=?2, category_changed_at=datetime('now') WHERE id=?3`).bind(next, user.id, id).run();
      await audit(env, user.id, "hankeis.customer_category", "hk_customers", String(id), { name: before.name, from: before.category, to: next, reason: str(body?.reason, 300) ? body!.reason : null });
      return json({ ok: true, from: before.category, to: next });
    }
    const addrM = path.match(/^\/customers\/(\d+)\/addresses$/);
    if (addrM && method === "POST") {
      if (!mayOrder) return err("forbidden", "Sales access required", 403);
      const id = Number(addrM[1]);
      if (!str(body?.line1, 300)) return err("invalid_input", "An address line is required", 400);
      const r = await env.DB.prepare(
        `INSERT INTO hk_addresses (customer_id,label,recipient,phone,line1,line2,postcode,city,state,is_default) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10) RETURNING id`,
      ).bind(id, str(body?.label, 60) ? body!.label : null, str(body?.recipient, 200) ? body!.recipient : null, str(body?.phone, 40) ? body!.phone : null,
        (body!.line1 as string).trim(), str(body?.line2, 300) ? body!.line2 : null, str(body?.postcode, 12) ? body!.postcode : null,
        str(body?.city, 80) ? body!.city : null, str(body?.state, 80) ? body!.state : null, body?.is_default ? 1 : 0).first<{ id: number }>();
      return json({ ok: true, id: r?.id }, 201);
    }

    /* ---- orders ---- */
    if (path === "/orders" && method === "GET") {
      const state = params.get("payment_state") ?? "";
      const ful = params.get("fulfilment_state") ?? "";
      const q = (params.get("q") ?? "").trim();
      const { results } = await env.DB.prepare(
        `SELECT o.id, o.order_no, o.total_cents, o.order_state, o.payment_state, o.fulfilment_state, o.channel, o.created_at, o.expires_at,
                c.name AS customer_name, c.category AS customer_category,
                (SELECT COUNT(*) FROM hk_receipts r WHERE r.order_id=o.id) AS receipts,
                (SELECT COUNT(*) FROM hk_exceptions e WHERE e.order_id=o.id AND e.state='open') AS exceptions
           FROM hk_orders o JOIN hk_customers c ON c.id=o.customer_id
          WHERE (?1='' OR o.payment_state=?1) AND (?2='' OR o.fulfilment_state=?2)
            AND (?3='' OR o.order_no LIKE ?4 OR c.name LIKE ?4 OR c.phone LIKE ?4)
          ORDER BY o.id DESC LIMIT 200`,
      ).bind(state, ful, q, `%${q}%`).all();
      return json({ orders: results });
    }
    if (path === "/orders" && method === "POST") {
      if (!mayOrder) return err("forbidden", "Sales access required", 403);
      const customerId = num(body?.customer_id);
      if (customerId === null) return err("invalid_input", "customer_id is required", 400);
      const lines = Array.isArray(body?.lines) ? (body!.lines as QuoteRequestLine[]) : [];
      const r = await createOrder(env, { customer_id: customerId, address_id: num(body?.address_id), lines, channel: "portal", note: str(body?.note, 500) ? String(body!.note) : null, created_by: user.id });
      if (!r.ok) return err(r.code, r.message, r.status);
      await audit(env, user.id, "hankeis.order_create", "hk_orders", String(r.order_id), { order_no: r.order_no, total_cents: r.total_cents });
      return json({ ...r }, 201);
    }
    const ordM = path.match(/^\/orders\/(\d+)$/);
    if (ordM && method === "GET") {
      const id = Number(ordM[1]);
      const order = await env.DB.prepare(
        `SELECT o.*, c.name AS customer_name, c.phone AS customer_phone, c.category AS customer_category, c.telegram_user_id
           FROM hk_orders o JOIN hk_customers c ON c.id=o.customer_id WHERE o.id=?1`,
      ).bind(id).first<Record<string, unknown>>();
      if (!order) return err("not_found", "No such order", 404);
      const { results: lines } = await env.DB.prepare(`SELECT * FROM hk_order_lines WHERE order_id=?1 ORDER BY id`).bind(id).all();
      const { results: receipts } = await env.DB.prepare(
        `SELECT r.*, (SELECT COUNT(*) FROM hk_receipts d WHERE d.sha256=r.sha256 AND d.id<>r.id) AS same_file_count
           FROM hk_receipts r WHERE r.order_id=?1 ORDER BY r.id DESC`,
      ).bind(id).all();
      const { results: events } = await env.DB.prepare(
        `SELECT e.*, COALESCE(NULLIF(TRIM(u.full_name),''),u.name) AS actor_name FROM hk_payment_events e LEFT JOIN users u ON u.id=e.actor_id WHERE e.order_id=?1 ORDER BY e.id DESC`,
      ).bind(id).all();
      const { results: allocations } = await env.DB.prepare(
        `SELECT a.*, COALESCE(NULLIF(TRIM(u.full_name),''),u.name) AS verified_by_name FROM hk_bank_allocations a LEFT JOIN users u ON u.id=a.verified_by WHERE a.order_id=?1`,
      ).bind(id).all();
      const { results: exceptions } = await env.DB.prepare(`SELECT * FROM hk_exceptions WHERE order_id=?1 ORDER BY id DESC`).bind(id).all();
      const { results: shipments } = await env.DB.prepare(`SELECT * FROM hk_shipments WHERE order_id=?1 ORDER BY id DESC`).bind(id).all();
      const { results: addresses } = await env.DB.prepare(`SELECT * FROM hk_addresses WHERE customer_id=?1`).bind(order.customer_id as number).all();
      /* The configured receiving account, for the reviewer's form only. The
         order's own pay_snapshot carries the label "configured" and never the
         account itself, because that snapshot is served to the CUSTOMER over
         the integration API. This copy goes only to a signed-in staff member
         who may verify - it says which of OUR accounts the money should be
         in - and the field stays editable, because money that landed in a
         different account is an exception the reviewer must be able to
         record, not a field to fight. */
      const recv = mayVerify ? (await settings(env)).receiving_account : "";
      return json({ order, lines, receipts, events, allocations, exceptions, shipments, addresses, ocr_available: ocrAvailable(), receiving_account: recv || null });
    }
    const quoteM = path.match(/^\/orders\/(\d+)\/shipping$/);
    if (quoteM && method === "POST") {
      if (!mayOrder) return err("forbidden", "Sales access required", 403);
      const id = Number(quoteM[1]);
      const cents = num(body?.shipping_cents);
      if (cents === null || !Number.isInteger(cents) || cents < 0) return err("invalid_input", "Shipping must be a whole number of sen", 400);
      const o = await env.DB.prepare(`SELECT id, order_no, customer_id, subtotal_cents, payment_state, order_state FROM hk_orders WHERE id=?1`).bind(id).first<{ id: number; order_no: string; customer_id: number; subtotal_cents: number; payment_state: string; order_state: string }>();
      if (!o) return err("not_found", "No such order", 404);
      if (o.payment_state === "verified") return err("bad_state", "This payment is already verified - re-quoting would change a settled total", 409);
      const total = o.subtotal_cents + cents;
      await env.DB.batch([
        env.DB.prepare(`UPDATE hk_orders SET shipping_cents=?1, total_cents=?2, order_state=CASE WHEN order_state='quote_required' THEN 'open' ELSE order_state END, updated_at=datetime('now') WHERE id=?3`).bind(cents, total, id),
        env.DB.prepare(`INSERT INTO hk_payment_events (order_id, action, actor_id, actor_kind, reason, meta) VALUES (?1,'shipping_quoted',?2,'staff',?3,?4)`)
          .bind(id, user.id, str(body?.reason, 300) ? body!.reason : null, JSON.stringify({ shipping_cents: cents, total_cents: total })),
        outboxStmt(env, "order.quoted", { order_id: id, customer_id: o.customer_id, telegram_user_id: null }, {
          order_no: o.order_no, shipping_cents: cents, total_cents: total,
          message_bm: BM.awaiting_payment(rm(total), (await settings(env)).recipient_name || "-"),
        }),
      ]);
      await audit(env, user.id, "hankeis.shipping_quote", "hk_orders", String(id), { shipping_cents: cents, total_cents: total });
      return json({ ok: true, shipping_cents: cents, total_cents: total });
    }
    const cancelM = path.match(/^\/orders\/(\d+)\/cancel$/);
    if (cancelM && method === "POST") {
      if (!mayOrder) return err("forbidden", "Sales access required", 403);
      const id = Number(cancelM[1]);
      const reason = str(body?.reason, 300) ? String(body!.reason) : "";
      if (!reason) return err("invalid_input", "Give a reason", 400);
      const o = await env.DB.prepare(`SELECT id, order_no, customer_id, payment_state FROM hk_orders WHERE id=?1`).bind(id).first<{ id: number; order_no: string; customer_id: number; payment_state: string }>();
      if (!o) return err("not_found", "No such order", 404);
      if (o.payment_state === "verified" && !mayVerify) return err("forbidden", "A verified order can only be cancelled by finance, and the money must be refunded separately", 403);
      await env.DB.batch([
        env.DB.prepare(`UPDATE hk_orders SET order_state='cancelled', cancelled_at=datetime('now'), cancel_reason=?1, updated_at=datetime('now') WHERE id=?2 AND order_state NOT IN ('cancelled')`).bind(reason, id),
        env.DB.prepare(`UPDATE hk_reservations SET released_at=datetime('now'), release_reason='cancelled' WHERE order_id=?1 AND released_at IS NULL`).bind(id),
        env.DB.prepare(`INSERT INTO hk_payment_events (order_id, action, actor_id, actor_kind, reason) VALUES (?1,'order_cancelled',?2,'staff',?3)`).bind(id, user.id, reason),
        outboxStmt(env, "order.cancelled", { order_id: id, customer_id: o.customer_id, telegram_user_id: null }, { order_no: o.order_no, reason, message_bm: BM.order_cancelled(reason) }),
      ]);
      await audit(env, user.id, "hankeis.order_cancel", "hk_orders", String(id), { order_no: o.order_no, reason, payment_state: o.payment_state });
      return json({ ok: true });
    }

    /* ---- receipts ---- */
    if (path === "/receipts" && method === "POST") {
      if (!mayOrder) return err("forbidden", "Sales access required", 403);
      const orderId = Number(params.get("order_id") ?? 0);
      if (!orderId) return err("invalid_input", "order_id is required", 400);
      const ct = request.headers.get("content-type") ?? "";
      const len = Number(request.headers.get("content-length") ?? 0);
      if (len > RECEIPT_MAX_BYTES) return err("too_large", "Receipt too large - maximum 8 MB", 413);
      if (!request.body) return err("invalid_input", "No file", 400);
      const buf = new Uint8Array(await request.arrayBuffer());
      const o = await env.DB.prepare(`SELECT customer_id FROM hk_orders WHERE id=?1`).bind(orderId).first<{ customer_id: number }>();
      if (!o) return err("not_found", "No such order", 404);
      const r = await storeReceipt(env, { order_id: orderId, customer_id: o.customer_id, bytes: buf, declaredType: ct.split(";")[0]!.trim(), via: "portal", uploaded_by: user.id });
      if (!r.ok) return err(r.code, r.message, r.status);
      await audit(env, user.id, "hankeis.receipt_upload", "hk_receipts", String(r.receipt_id), { order_id: orderId, duplicate_of: r.duplicate_of });
      return json({ ...r, note: "Uploading a receipt does not verify a payment." }, 201);
    }
    if (path === "/receipt-file" && method === "GET") {
      const key = params.get("key") ?? "";
      if (!RECEIPT_KEY_RE.test(key)) return err("invalid_input", "Bad receipt key", 400);
      /* object-level access: the key must belong to a receipt this portal
         knows about, and the caller must be staff who may see orders */
      const owns = await env.DB.prepare(`SELECT id FROM hk_receipts WHERE r2_key=?1`).bind(key).first<{ id: number }>();
      if (!owns) return err("not_found", "No such receipt", 404);
      const obj = await env.MEDIA.get(key);
      if (!obj) return err("not_found", "Receipt file missing", 404);
      return new Response(obj.body, {
        headers: {
          "Content-Type": obj.httpMetadata?.contentType ?? "application/octet-stream",
          "Cache-Control": "private, no-store",
          /* untrusted file: never let it run in our origin */
          "Content-Disposition": "inline",
          "Content-Security-Policy": "default-src 'none'; img-src 'self'; object-src 'none'; sandbox",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }

    /* ---- payment review ---- */
    if (path === "/review" && method === "GET") {
      const { results } = await env.DB.prepare(
        `SELECT o.id, o.order_no, o.total_cents, o.payment_state, o.order_state, o.expires_at, o.created_at,
                c.name AS customer_name, c.phone AS customer_phone, c.category AS customer_category,
                (SELECT COUNT(*) FROM hk_receipts r WHERE r.order_id=o.id) AS receipts,
                (SELECT MAX(r.id) FROM hk_receipts r WHERE r.order_id=o.id) AS latest_receipt_id
           FROM hk_orders o JOIN hk_customers c ON c.id=o.customer_id
          WHERE o.payment_state IN ('awaiting_review','clarification_required')
          ORDER BY CASE o.payment_state WHEN 'awaiting_review' THEN 0 ELSE 1 END, o.id ASC LIMIT 100`,
      ).all();
      return json({ queue: results, can_verify: mayVerify, ocr_available: ocrAvailable() });
    }
    const verM = path.match(/^\/orders\/(\d+)\/verify$/);
    if (verM && method === "POST") {
      const r = await verifyPayment(env, user, {
        order_id: Number(verM[1]), receipt_id: num(body?.receipt_id),
        receiving_account: String(body?.receiving_account ?? ""), bank_reference: String(body?.bank_reference ?? ""),
        amount_cents: num(body?.amount_cents) ?? -1, bank_time: String(body?.bank_time ?? ""),
        attested_bank_checked: body?.attested_bank_checked === true, note: str(body?.note, 500) ? String(body!.note) : null,
      });
      if (!r.ok) return err(r.code, r.message, r.status);
      return json({ ...r });
    }
    const clarM = path.match(/^\/orders\/(\d+)\/clarify$/);
    if (clarM && method === "POST") {
      if (!mayOrder) return err("forbidden", "Sales access required", 403);
      const id = Number(clarM[1]);
      const reason = str(body?.reason, 500) ? String(body!.reason) : "";
      if (!reason) return err("invalid_input", "Say what is unclear - the customer reads this", 400);
      const o = await env.DB.prepare(`SELECT id, order_no, customer_id, payment_state FROM hk_orders WHERE id=?1`).bind(id).first<{ id: number; order_no: string; customer_id: number; payment_state: string }>();
      if (!o) return err("not_found", "No such order", 404);
      const gate = canPaymentTransition(o.payment_state as never, "clarification_required", "staff");
      if (!gate.ok) return err("bad_state", gate.reason, 409);
      await env.DB.batch([
        env.DB.prepare(`UPDATE hk_orders SET payment_state='clarification_required', updated_at=datetime('now') WHERE id=?1 AND payment_state IN ('awaiting_payment','awaiting_review')`).bind(id),
        env.DB.prepare(`INSERT INTO hk_payment_events (order_id, action, from_state, to_state, actor_id, actor_kind, reason) VALUES (?1,'clarification_requested',?2,'clarification_required',?3,'staff',?4)`).bind(id, o.payment_state, user.id, reason),
        outboxStmt(env, "payment.clarification_requested", { order_id: id, customer_id: o.customer_id, telegram_user_id: null }, { order_no: o.order_no, reason, message_bm: BM.clarification_required(reason) }),
      ]);
      await audit(env, user.id, "hankeis.clarification", "hk_orders", String(id), { from: o.payment_state, reason });
      return json({ ok: true });
    }
    const rejM = path.match(/^\/receipts\/(\d+)\/reject$/);
    if (rejM && method === "POST") {
      if (!mayOrder) return err("forbidden", "Sales access required", 403);
      const id = Number(rejM[1]);
      const reason = str(body?.reason, 500) ? String(body!.reason) : "";
      if (!reason) return err("invalid_input", "Say why the evidence cannot be used", 400);
      const r = await env.DB.prepare(`SELECT r.id, r.order_id, r.state, o.order_no, o.customer_id, o.payment_state FROM hk_receipts r JOIN hk_orders o ON o.id=r.order_id WHERE r.id=?1`)
        .bind(id).first<{ id: number; order_id: number; state: string; order_no: string; customer_id: number; payment_state: string }>();
      if (!r) return err("not_found", "No such receipt", 404);
      if (r.state !== "submitted") return err("bad_state", `That receipt is already ${r.state}`, 409);
      /* Rejecting EVIDENCE is not a claim about the bank. The order goes back
         to clarification so the customer can send a better copy; the history
         of every earlier receipt is kept. */
      await env.DB.batch([
        env.DB.prepare(`UPDATE hk_receipts SET state='rejected', reject_reason=?1, reviewed_by=?2, reviewed_at=datetime('now') WHERE id=?3 AND state='submitted'`).bind(reason, user.id, id),
        env.DB.prepare(`UPDATE hk_orders SET payment_state='clarification_required', updated_at=datetime('now') WHERE id=?1 AND payment_state IN ('awaiting_review','awaiting_payment')`).bind(r.order_id),
        env.DB.prepare(`INSERT INTO hk_payment_events (order_id, receipt_id, action, from_state, to_state, actor_id, actor_kind, reason) VALUES (?1,?2,'receipt_rejected',?3,'clarification_required',?4,'staff',?5)`)
          .bind(r.order_id, id, r.payment_state, user.id, reason),
        outboxStmt(env, "receipt.rejected", { order_id: r.order_id, customer_id: r.customer_id, telegram_user_id: null }, {
          order_no: r.order_no, reason, receipt_id: id,
          message_bm: BM.receipt_rejected(reason),
          note: "Rejecting a receipt says the EVIDENCE is unusable. It makes no claim about whether the bank transfer happened.",
        }),
      ]);
      await audit(env, user.id, "hankeis.receipt_reject", "hk_receipts", String(id), { order_id: r.order_id, reason });
      return json({ ok: true });
    }
    const corrM = path.match(/^\/receipts\/(\d+)\/correct$/);
    if (corrM && method === "POST") {
      if (!mayVerify) return err("forbidden", "Finance access required", 403);
      const id = Number(corrM[1]);
      const amount = num(body?.corrected_amount_cents);
      await env.DB.prepare(`UPDATE hk_receipts SET corrected_amount_cents=?1, corrected_reference=?2, corrected_by=?3 WHERE id=?4`)
        .bind(amount !== null ? Math.round(amount) : null, str(body?.corrected_reference, 120) ? body!.corrected_reference : null, user.id, id).run();
      await audit(env, user.id, "hankeis.receipt_correct", "hk_receipts", String(id), { corrected_amount_cents: amount, corrected_reference: body?.corrected_reference });
      return json({ ok: true, note: "A correction records what the reviewer read. It is not a verification." });
    }

    /* ---- exceptions and refunds ---- */
    if (path === "/exceptions" && method === "GET") {
      const { results } = await env.DB.prepare(
        `SELECT e.*, o.order_no, o.total_cents, c.name AS customer_name FROM hk_exceptions e JOIN hk_orders o ON o.id=e.order_id JOIN hk_customers c ON c.id=o.customer_id
          WHERE e.state='open' ORDER BY e.id DESC LIMIT 100`,
      ).all();
      return json({ exceptions: results });
    }
    const exM = path.match(/^\/exceptions\/(\d+)\/resolve$/);
    if (exM && method === "POST") {
      if (!mayVerify) return err("forbidden", "Finance access required", 403);
      const id = Number(exM[1]);
      const resolution = str(body?.resolution, 500) ? String(body!.resolution) : "";
      if (!resolution) return err("invalid_input", "Say how it was resolved", 400);
      await env.DB.prepare(`UPDATE hk_exceptions SET state='resolved', resolved_by=?1, resolved_at=datetime('now'), resolution=?2 WHERE id=?3 AND state='open'`).bind(user.id, resolution, id).run();
      if (body?.release_for_packing === true) {
        const ex = await env.DB.prepare(`SELECT order_id FROM hk_exceptions WHERE id=?1`).bind(id).first<{ order_id: number }>();
        if (ex) await env.DB.prepare(`UPDATE hk_orders SET fulfilment_state='ready_to_pack' WHERE id=?1 AND payment_state='verified' AND fulfilment_state='on_hold' AND NOT EXISTS (SELECT 1 FROM hk_exceptions x WHERE x.order_id=?1 AND x.state='open')`).bind(ex.order_id).run();
      }
      await audit(env, user.id, "hankeis.exception_resolve", "hk_exceptions", String(id), { resolution, released: body?.release_for_packing === true });
      return json({ ok: true });
    }
    const refM = path.match(/^\/orders\/(\d+)\/refund$/);
    if (refM && method === "POST") {
      if (!mayVerify) return err("forbidden", "Finance access required", 403);
      const id = Number(refM[1]);
      const amount = num(body?.amount_cents);
      if (amount === null || amount <= 0) return err("invalid_input", "Refund amount in sen is required", 400);
      if (body?.confirm_external === true) {
        /* the money actually moved, outside this portal, and somebody says so */
        if (!str(body?.external_reference, 120)) return err("invalid_input", "Record the bank reference of the refund you actually made", 400);
        const refund = await env.DB.prepare(`SELECT id FROM hk_refunds WHERE order_id=?1 AND state='requested' ORDER BY id DESC LIMIT 1`).bind(id).first<{ id: number }>();
        if (!refund) return err("bad_state", "Raise the refund request first", 409);
        const o = await env.DB.prepare(`SELECT order_no, customer_id FROM hk_orders WHERE id=?1`).bind(id).first<{ order_no: string; customer_id: number }>();
        await env.DB.batch([
          env.DB.prepare(`UPDATE hk_refunds SET state='confirmed', confirmed_by=?1, confirmed_at=datetime('now'), external_reference=?2 WHERE id=?3 AND state='requested'`).bind(user.id, body!.external_reference, refund.id),
          env.DB.prepare(`UPDATE hk_orders SET payment_state='refunded', fulfilment_state='on_hold', updated_at=datetime('now') WHERE id=?1 AND payment_state='verified'`).bind(id),
          env.DB.prepare(`INSERT INTO hk_payment_events (order_id, action, from_state, to_state, actor_id, actor_kind, reason) VALUES (?1,'refund_confirmed','verified','refunded',?2,'staff',?3)`).bind(id, user.id, String(body!.external_reference)),
          outboxStmt(env, "refund.confirmed", { order_id: id, customer_id: o?.customer_id ?? null, telegram_user_id: null }, { order_no: o?.order_no, amount_cents: amount }),
        ]);
        await audit(env, user.id, "hankeis.refund_confirmed", "hk_orders", String(id), { amount_cents: amount, external_reference: body!.external_reference });
        return json({ ok: true, note: "Recorded. This portal did not move any money - it records that you did." });
      }
      const r = await env.DB.prepare(`INSERT INTO hk_refunds (order_id, amount_cents, reason, requested_by) VALUES (?1,?2,?3,?4) RETURNING id`)
        .bind(id, Math.round(amount), str(body?.reason, 500) ? body!.reason : null, user.id).first<{ id: number }>();
      await audit(env, user.id, "hankeis.refund_request", "hk_refunds", String(r?.id ?? ""), { order_id: id, amount_cents: amount });
      return json({ ok: true, id: r?.id, note: "A refund request is not a refund. Make the transfer in Maybank, then confirm it here with its reference." }, 201);
    }

    /* ---- fulfilment ---- */
    if (path === "/packing" && method === "GET") {
      const { results } = await env.DB.prepare(
        `SELECT o.id, o.order_no, o.total_cents, o.fulfilment_state, o.created_at, c.name AS customer_name, c.phone AS customer_phone,
                a.recipient, a.line1, a.line2, a.postcode, a.city, a.state,
                (SELECT COUNT(*) FROM hk_exceptions e WHERE e.order_id=o.id AND e.state='open') AS open_exceptions
           FROM hk_orders o JOIN hk_customers c ON c.id=o.customer_id LEFT JOIN hk_addresses a ON a.id=o.address_id
          WHERE o.payment_state='verified' AND o.fulfilment_state IN ('ready_to_pack','packing','on_hold') AND o.order_state <> 'cancelled'
          ORDER BY o.id ASC LIMIT 100`,
      ).all();
      return json({ queue: results, can_pack: mayPack });
    }
    const shipM = path.match(/^\/orders\/(\d+)\/ship$/);
    if (shipM && method === "POST") {
      if (!mayPack) return err("forbidden", "Packing access required", 403);
      const id = Number(shipM[1]);
      const o = await env.DB.prepare(`SELECT id, order_no, customer_id, order_state, payment_state, fulfilment_state FROM hk_orders WHERE id=?1`)
        .bind(id).first<{ id: number; order_no: string; customer_id: number; order_state: string; payment_state: string; fulfilment_state: string }>();
      if (!o) return err("not_found", "No such order", 404);
      /* THE GATE: money first, always */
      const gate = canFulfil(o);
      if (!gate.ok) return err("not_eligible", gate.reason, 409);
      const open = await env.DB.prepare(`SELECT COUNT(*) AS c FROM hk_exceptions WHERE order_id=?1 AND state='open'`).bind(id).first<{ c: number }>();
      if ((open?.c ?? 0) > 0) return err("not_eligible", "This order has an open payment exception - resolve it before shipping", 409);
      const courier = str(body?.courier, 80) ? String(body!.courier) : "";
      const tracking = str(body?.tracking_no, 80) ? String(body!.tracking_no) : "";
      if (!courier || !tracking) return err("invalid_input", "Courier and tracking number are required", 400);
      /* Stock, shipment, reservation release and notification are one unit.
         A failed stock write must not leave an order marked as shipped. */
      const { results: lines } = await env.DB.prepare(
        `SELECT l.inventory_item_id, l.qty, l.name_snapshot, i.stock
           FROM hk_order_lines l JOIN inventory_items i ON i.id=l.inventory_item_id
          WHERE l.order_id=?1 AND l.inventory_item_id IS NOT NULL`,
      ).bind(id).all<{ inventory_item_id: number; qty: number; name_snapshot: string; stock: number }>();
      const shortage = lines.find((line) => line.stock < line.qty);
      if (shortage) return err("not_eligible", `${shortage.name_snapshot} has insufficient stock to ship`, 409);
      const shipmentStatements = [
        env.DB.prepare(`INSERT INTO hk_shipments (order_id, courier, tracking_no, note, shipped_by) VALUES (?1,?2,?3,?4,?5)`).bind(id, courier, tracking, str(body?.note, 300) ? body!.note : null, user.id),
        env.DB.prepare(`UPDATE hk_orders SET fulfilment_state='shipped', order_state=CASE WHEN order_state='open' THEN 'completed' ELSE order_state END, completed_at=datetime('now'), updated_at=datetime('now') WHERE id=?1 AND payment_state='verified' AND fulfilment_state<>'shipped'`).bind(id),
        env.DB.prepare(`UPDATE hk_reservations SET released_at=datetime('now'), release_reason='shipped' WHERE order_id=?1 AND released_at IS NULL`).bind(id),
        outboxStmt(env, "shipment.created", { order_id: id, customer_id: o.customer_id, telegram_user_id: null }, { order_no: o.order_no, courier, tracking_no: tracking, message_bm: BM.shipped(courier, tracking) }),
      ];
      for (const l of lines) {
        shipmentStatements.push(
          env.DB.prepare(`INSERT INTO stock_ledger (item_id, sku, delta, balance_after, source, ref_type, ref_id, reason)
                          SELECT id, sku, -?1, stock - ?1, 'hankeis', 'hk_order', ?2, ?3 FROM inventory_items WHERE id=?4`)
            .bind(l.qty, String(id), `Hankei's ${o.order_no}`, l.inventory_item_id),
          env.DB.prepare(`UPDATE inventory_items SET stock = stock - ?1 WHERE id = ?2 AND stock >= ?1`).bind(l.qty, l.inventory_item_id),
        );
      }
      await env.DB.batch(shipmentStatements);
      await audit(env, user.id, "hankeis.shipped", "hk_orders", String(id), { order_no: o.order_no, courier, tracking_no: tracking });
      return json({ ok: true });
    }

    /* ---- integration clients (owner only) ---- */
    if (path === "/clients" && method === "POST") {
      if (!mayAdmin) return err("forbidden", "Only the owner may create an integration credential", 403);
      const name = str(body?.name, 80) ? String(body!.name) : "";
      if (!name) return err("invalid_input", "Name the integration", 400);
      const scopes = Array.isArray(body?.scopes) ? (body!.scopes as string[]).filter((x) => typeof x === "string").join(" ") : "catalogue orders receipts status";
      const token = `hk_${crypto.randomUUID().replace(/-/g, "")}${crypto.randomUUID().replace(/-/g, "")}`;
      const hash = await sha256Hex(new TextEncoder().encode(token));
      const r = await env.DB.prepare(`INSERT INTO hk_api_clients (name, token_hash, scopes, created_by) VALUES (?1,?2,?3,?4) RETURNING id`).bind(name, hash, scopes, user.id).first<{ id: number }>();
      await audit(env, user.id, "hankeis.client_create", "hk_api_clients", String(r?.id ?? ""), { name, scopes });
      /* the plaintext is returned ONCE and never stored */
      return json({ ok: true, id: r?.id, name, scopes, token, note: "Copy this token now. Only its hash is stored - it cannot be shown again." }, 201);
    }
    const revM = path.match(/^\/clients\/(\d+)\/revoke$/);
    if (revM && method === "POST") {
      if (!mayAdmin) return err("forbidden", "Only the owner may revoke a credential", 403);
      const id = Number(revM[1]);
      await env.DB.prepare(`UPDATE hk_api_clients SET is_active=0, revoked_at=datetime('now'), revoked_by=?1 WHERE id=?2`).bind(user.id, id).run();
      await audit(env, user.id, "hankeis.client_revoke", "hk_api_clients", String(id), {});
      return json({ ok: true });
    }
    if (path === "/outbox" && method === "GET") {
      const { results } = await env.DB.prepare(
        `SELECT o.id, o.event_id, o.event_type, o.state, o.attempts, o.created_at, o.delivered_at, o.last_error, r.order_no
           FROM hk_outbox o LEFT JOIN hk_orders r ON r.id=o.order_id ORDER BY o.id DESC LIMIT 100`,
      ).all();
      return json({ events: results });
    }

    return err("not_found", "No such Hankei's route", 404);
  } catch (e) {
    const p = pending(e);
    if (p) return p;
    throw e;
  }
}
