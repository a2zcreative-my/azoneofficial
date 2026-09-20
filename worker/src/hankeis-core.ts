/**
 * HANKEI'S COMMERCE - the pure half. v1.163.0.
 *
 * Pricing, the three state machines, file sniffing and the event contract.
 * No D1, no R2, no Request: everything here is a function of its arguments,
 * which is what lets tests/hankeis.mjs run the real rules rather than a
 * description of them.
 *
 * THE RULE THIS MODULE EXISTS TO ENFORCE, stated once:
 *
 *   A receipt, an OCR result, a customer declaration or a Telegram message
 *   is EVIDENCE. None of them, in any combination, moves a payment to
 *   `verified`. Only `verifyPayment` in hankeis.ts does that, only for a
 *   reviewer holding `hankeis_verify`, and only when that reviewer has
 *   allocated a bank transaction they attest to having found in the
 *   receiving account itself.
 *
 * Money is INTEGER SEN everywhere. There is no float in this file and no
 * price arrives from a client: `quote()` is given ids and quantities and
 * reads every figure from the catalogue rows the caller loaded.
 */

/* ────────────────────────────────────────────────────────────────────────
   states
   ──────────────────────────────────────────────────────────────────────── */
export const ORDER_STATES = ["quote_required", "open", "expired", "cancelled", "completed"] as const;
export const PAYMENT_STATES = ["awaiting_payment", "awaiting_review", "clarification_required", "verified", "refunded"] as const;
export const FULFILMENT_STATES = ["not_ready", "ready_to_pack", "packing", "shipped", "delivered", "on_hold"] as const;
export const RECEIPT_STATES = ["submitted", "accepted", "rejected", "superseded"] as const;
export const CATEGORIES = ["retail", "agent", "stockist"] as const;

export type OrderState = (typeof ORDER_STATES)[number];
export type PaymentState = (typeof PAYMENT_STATES)[number];
export type FulfilmentState = (typeof FULFILMENT_STATES)[number];
export type Category = (typeof CATEGORIES)[number];

/** Which payment states a manual verification may be applied to. A verified
    payment is NOT here: re-approving is refused, so a replayed notification
    or a second reviewer cannot re-run the allocation. */
export const VERIFIABLE_FROM: readonly PaymentState[] = ["awaiting_payment", "awaiting_review", "clarification_required"];

/**
 * The payment state machine. `actor` matters as much as the transition:
 *   customer     - the Telegram integration acting for a customer
 *   staff        - sales/support (may ask for clarification, never verify)
 *   finance      - holds hankeis_verify
 *   system       - expiry sweeps
 * Note what no actor can do: reach `verified` through this function. The
 * transition exists, but only `finance` may request it AND the caller must
 * still pass the bank allocation - see hankeis.ts. Customers and integration
 * credentials are refused here as well, belt and braces.
 */
export function canPaymentTransition(
  from: PaymentState, to: PaymentState, actor: "customer" | "staff" | "finance" | "system",
): { ok: true } | { ok: false; reason: string } {
  if (from === to) return { ok: false, reason: `payment is already ${from}` };
  if (to === "verified") {
    if (actor !== "finance") return { ok: false, reason: "only an authorised finance reviewer may verify a payment" };
    if (!VERIFIABLE_FROM.includes(from)) return { ok: false, reason: `a payment in ${from} cannot be verified` };
    return { ok: true };
  }
  /* v1.163.0 - a verified payment is a floor, not a waypoint. An old
     notification, a retried webhook or a fresh receipt upload must never
     drag it back down. Only a refund, by finance, moves it at all. */
  if (from === "verified") {
    if (to === "refunded" && actor === "finance") return { ok: true };
    return { ok: false, reason: "a verified payment cannot be downgraded" };
  }
  if (from === "refunded") return { ok: false, reason: "a refunded payment is final" };
  if (to === "awaiting_review") {
    if (actor === "customer" || actor === "staff") return { ok: true };
    return { ok: false, reason: "only a receipt submission moves an order into review" };
  }
  if (to === "clarification_required") {
    if (actor === "staff" || actor === "finance") return { ok: true };
    return { ok: false, reason: "only staff may ask a customer for clarification" };
  }
  if (to === "awaiting_payment") {
    if (actor === "staff" || actor === "finance" || actor === "system") return { ok: true };
    return { ok: false, reason: "a customer cannot reset the payment state" };
  }
  if (to === "refunded") return { ok: false, reason: "only a verified payment can be refunded" };
  return { ok: false, reason: `unsupported transition ${from} to ${to}` };
}

/** Fulfilment is gated on money, always. This is the only door to packing. */
export function canFulfil(
  order: { order_state: string; payment_state: string; fulfilment_state: string },
): { ok: true } | { ok: false; reason: string } {
  if (order.payment_state !== "verified") {
    return { ok: false, reason: "payment is not verified - only a finance reviewer who has matched the bank transaction can release this order" };
  }
  if (order.order_state === "cancelled") return { ok: false, reason: "the order is cancelled" };
  if (order.order_state === "quote_required") return { ok: false, reason: "shipping has not been quoted yet" };
  return { ok: true };
}

/* ────────────────────────────────────────────────────────────────────────
   money and pricing - server side, integer sen, no client input
   ──────────────────────────────────────────────────────────────────────── */
export interface CatalogueProduct { id: number; sku: string; name: string; unit_price_cents: number; is_active: number; inventory_item_id: number | null }
export interface CataloguePackage { id: number; code: string; name: string; eligibility: Category; min_qty: number; price_cents: number; is_active: number }
export interface QuoteRequestLine { product_id?: number; package_id?: number; qty: number }
export interface QuoteLine {
  product_id: number | null; package_id: number | null;
  name_snapshot: string; sku_snapshot: string | null;
  qty: number; unit_price_cents: number; line_total_cents: number;
  inventory_item_id: number | null;
}
export interface QuoteResult {
  ok: true; lines: QuoteLine[];
  subtotal_cents: number; shipping_cents: number; total_cents: number;
  shipping_mode: "flat" | "quote" | "pickup"; needs_quote: boolean;
}
export interface QuoteError { ok: false; code: string; message: string }

export const MAX_LINE_QTY = 999;
export const MAX_LINES = 30;

/**
 * THE price. Every figure comes from the catalogue rows the caller read out
 * of the database; anything the client sent about money is ignored, and the
 * request shape has nowhere to put a price in the first place.
 *
 * `customerCategory` decides package eligibility: a retail customer asking
 * for a stockist package is refused here, on the server, whatever the client
 * claims about itself.
 */
export function quote(
  req: { lines: QuoteRequestLine[]; customerCategory: Category; shipping: { mode: "flat" | "quote" | "pickup"; flat_cents?: number; free_over_cents?: number | null } },
  cat: { products: CatalogueProduct[]; packages: CataloguePackage[] },
): QuoteResult | QuoteError {
  if (!Array.isArray(req.lines) || req.lines.length === 0) return { ok: false, code: "empty_order", message: "An order needs at least one line" };
  if (req.lines.length > MAX_LINES) return { ok: false, code: "too_many_lines", message: `At most ${MAX_LINES} lines` };
  const byProduct = new Map(cat.products.map((p) => [p.id, p]));
  const byPackage = new Map(cat.packages.map((p) => [p.id, p]));
  const rank: Record<Category, number> = { retail: 0, agent: 1, stockist: 2 };
  const lines: QuoteLine[] = [];
  let subtotal = 0;
  for (const raw of req.lines) {
    const qty = Number.isInteger(raw.qty) ? raw.qty : NaN;
    if (!Number.isFinite(qty) || qty < 1 || qty > MAX_LINE_QTY) return { ok: false, code: "bad_qty", message: "Quantity must be a whole number between 1 and 999" };
    if (raw.package_id != null) {
      const pk = byPackage.get(raw.package_id);
      if (!pk || pk.is_active !== 1) return { ok: false, code: "unknown_package", message: "That package is not available" };
      if (rank[req.customerCategory] < rank[pk.eligibility]) {
        return { ok: false, code: "not_eligible", message: `This package is for ${pk.eligibility} customers. A category change is made by authorised staff, never by the customer.` };
      }
      if (qty < pk.min_qty) return { ok: false, code: "below_min", message: `${pk.name} has a minimum of ${pk.min_qty}` };
      const total = pk.price_cents * qty;
      lines.push({ product_id: null, package_id: pk.id, name_snapshot: pk.name, sku_snapshot: pk.code, qty, unit_price_cents: pk.price_cents, line_total_cents: total, inventory_item_id: null });
      subtotal += total;
      continue;
    }
    if (raw.product_id == null) return { ok: false, code: "bad_line", message: "Each line needs a product or a package" };
    const pr = byProduct.get(raw.product_id);
    if (!pr || pr.is_active !== 1) return { ok: false, code: "unknown_product", message: "That product is not available" };
    const total = pr.unit_price_cents * qty;
    lines.push({ product_id: pr.id, package_id: null, name_snapshot: pr.name, sku_snapshot: pr.sku, qty, unit_price_cents: pr.unit_price_cents, line_total_cents: total, inventory_item_id: pr.inventory_item_id, });
    subtotal += total;
  }
  const mode = req.shipping.mode;
  let shipping = 0;
  let needsQuote = false;
  if (mode === "flat") {
    const flat = Number.isInteger(req.shipping.flat_cents) ? (req.shipping.flat_cents as number) : 0;
    const freeOver = req.shipping.free_over_cents;
    shipping = freeOver != null && freeOver > 0 && subtotal >= freeOver ? 0 : flat;
  } else if (mode === "quote") {
    /* Shipping is not known, so the total is not known, so the customer is
       NOT asked to pay. The order waits for a human to quote it. */
    needsQuote = true;
    shipping = 0;
  }
  return { ok: true, lines, subtotal_cents: subtotal, shipping_cents: shipping, total_cents: subtotal + shipping, shipping_mode: mode, needs_quote: needsQuote };
}

/** RM from sen, for display only. Never used to compute anything. */
export function rm(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const n = Math.abs(Math.round(cents));
  return `${sign}RM ${Math.floor(n / 100)}.${String(n % 100).padStart(2, "0")}`;
}

/* ────────────────────────────────────────────────────────────────────────
   payment comparison - an AID for the reviewer, never a decision
   ──────────────────────────────────────────────────────────────────────── */
export interface AmountVerdict { kind: "exact" | "under" | "over"; difference_cents: number; note: string }
/** Compares what was banked with what is owed. Note that NO branch returns
    anything resembling permission: an exact match is still only an exact
    match, and the reviewer still has to open Maybank. */
export function compareAmount(bankedCents: number, owedCents: number): AmountVerdict {
  const diff = bankedCents - owedCents;
  if (diff === 0) return { kind: "exact", difference_cents: 0, note: "Amount matches the order total. This is not, by itself, proof of payment." };
  if (diff < 0) return { kind: "under", difference_cents: diff, note: `Underpaid by ${rm(-diff)} - open an exception, do not fulfil.` };
  return { kind: "over", difference_cents: diff, note: `Overpaid by ${rm(diff)} - open an exception and decide on a refund.` };
}

/** Why an order needs the exception workflow rather than plain approval. */
export function exceptionsFor(
  o: { total_cents: number; order_state: string; expires_at: string | null },
  bank: { amount_cents: number; bank_time: string },
  now: string,
): { kind: string; detail: string; amount_cents: number | null }[] {
  const out: { kind: string; detail: string; amount_cents: number | null }[] = [];
  const v = compareAmount(bank.amount_cents, o.total_cents);
  if (v.kind === "under") out.push({ kind: "underpaid", detail: v.note, amount_cents: v.difference_cents });
  if (v.kind === "over") out.push({ kind: "overpaid", detail: v.note, amount_cents: v.difference_cents });
  if (o.order_state === "expired" || (o.expires_at && o.expires_at < now)) {
    out.push({ kind: "late_payment", detail: "Paid after the order expired. The static QR does not expire, so this is normal - re-check stock before packing.", amount_cents: null });
  }
  if (o.order_state === "cancelled") {
    out.push({ kind: "late_payment", detail: "Payment arrived for a cancelled order - refund or re-raise, do not fulfil.", amount_cents: null });
  }
  return out;
}

/* ────────────────────────────────────────────────────────────────────────
   receipts - what a file must be before it is stored
   ──────────────────────────────────────────────────────────────────────── */
export const RECEIPT_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"] as const;
export const RECEIPT_MAX_BYTES = 8 * 1024 * 1024;
export const RECEIPT_MIN_BYTES = 64;

/**
 * Sniff the real type from the first bytes. The Content-Type header is a
 * claim by the uploader; this is the file. A .pdf renamed to .jpg, an HTML
 * page with an image extension or a zip pretending to be a PDF all fail
 * here and are never written to R2.
 */
export function sniffType(head: Uint8Array): string | null {
  const b = head;
  if (b.length < 4) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return "application/pdf";
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  return null;
}

/** The whole upload gate, as one decision a test can call directly. */
export function validateReceiptUpload(
  declaredType: string, bytes: number, head: Uint8Array,
): { ok: true; contentType: string } | { ok: false; code: string; message: string } {
  if (!(RECEIPT_TYPES as readonly string[]).includes(declaredType)) {
    return { ok: false, code: "bad_type", message: "A receipt must be a JPEG, PNG, WebP or PDF" };
  }
  if (bytes > RECEIPT_MAX_BYTES) return { ok: false, code: "too_large", message: "Receipt too large - maximum 8 MB" };
  if (bytes < RECEIPT_MIN_BYTES) return { ok: false, code: "too_small", message: "That file is empty or truncated" };
  const actual = sniffType(head);
  if (!actual) return { ok: false, code: "unreadable", message: "That file is not a readable image or PDF" };
  if (actual !== declaredType) {
    return { ok: false, code: "type_mismatch", message: `The file is a ${actual}, not a ${declaredType}` };
  }
  return { ok: true, contentType: actual };
}

/** Unpredictable object key. Never the order number, never a counter: a key
    that can be guessed is a receipt that can be read by a stranger. */
export function receiptKey(uuid: string): string {
  return `hk/receipts/${uuid}`;
}
export const RECEIPT_KEY_RE = /^hk\/receipts\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/* ────────────────────────────────────────────────────────────────────────
   the OCR seam
   ──────────────────────────────────────────────────────────────────────── */
export interface OcrExtraction {
  amount_cents: number | null; datetime: string | null; recipient: string | null;
  reference: string | null; confidence: number | null; engine: string; raw?: string;
}
export interface OcrAdapter { name: string; extract(file: { key: string; contentType: string; bytes: number }): Promise<OcrExtraction> }

/**
 * NO OCR ENGINE IS CONFIGURED IN THIS PROJECT, and this function does not
 * pretend otherwise: it returns null, the receipt keeps ocr_state
 * 'unavailable', and the reviewer sees "no extraction was attempted"
 * instead of an invented figure. Registering a real adapter later is the
 * only thing that changes, and nothing downstream has to move, because an
 * extraction has never been allowed to decide anything.
 */
let adapter: OcrAdapter | null = null;
export function registerOcrAdapter(a: OcrAdapter | null): void { adapter = a; }
export function ocrAdapter(): OcrAdapter | null { return adapter; }
export function ocrAvailable(): boolean { return adapter !== null; }

/* ────────────────────────────────────────────────────────────────────────
   order numbers and identifiers
   ──────────────────────────────────────────────────────────────────────── */
/** HK-260920-0007: brand, date in Malaysia, then the day counter. */
export function orderNumber(seq: number, nowMyt: Date): string {
  const y = String(nowMyt.getUTCFullYear()).slice(2);
  const m = String(nowMyt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(nowMyt.getUTCDate()).padStart(2, "0");
  return `HK-${y}${m}${d}-${String(seq).padStart(4, "0")}`;
}
export function mytNow(at: number = Date.now()): Date { return new Date(at + 8 * 3_600_000); }
/** SQLite-shaped UTC timestamp, the format every other table in this portal uses. */
export function sqlNow(at: number = Date.now()): string { return new Date(at).toISOString().replace("T", " ").slice(0, 19); }
export function sqlPlusMinutes(minutes: number, at: number = Date.now()): string { return sqlNow(at + minutes * 60_000); }

/* ────────────────────────────────────────────────────────────────────────
   the event contract Astra consumes
   ──────────────────────────────────────────────────────────────────────── */
export const EVENT_TYPES = [
  "order.created", "order.quoted", "receipt.received", "payment.clarification_requested",
  "receipt.rejected", "payment.verified", "order.expired", "order.cancelled",
  "shipment.created", "refund.confirmed",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];
export const EVENT_PAYLOAD_VERSION = 1;

/* ────────────────────────────────────────────────────────────────────────
   customer-facing copy, Bahasa Melayu
   ──────────────────────────────────────────────────────────────────────── */
/** The sentence that must never be softened: uploading is not paying. */
export const BM = {
  receipt_not_confirmation:
    "Muat naik resit BUKAN pengesahan pembayaran. Pasukan kami akan menyemak transaksi masuk di akaun bank sebelum pesanan anda disahkan.",
  awaiting_payment: (total: string, recipient: string) =>
    `Jumlah perlu dibayar: ${total}. Sila imbas kod QR Maybank dan pastikan nama penerima ialah ${recipient}. Selepas membayar, muat naik resit anda di sini.`,
  awaiting_review:
    "Resit anda telah diterima dan sedang menunggu semakan. Kami akan sahkan selepas transaksi ditemui dalam rekod bank. Terima kasih atas kesabaran anda.",
  clarification_required: (reason: string) =>
    `Kami memerlukan penjelasan sebelum pesanan anda boleh diteruskan: ${reason}. Sila balas atau muat naik resit yang lebih jelas.`,
  receipt_rejected: (reason: string) =>
    `Resit yang dimuat naik tidak dapat digunakan untuk semakan: ${reason}. Ini BUKAN bermakna pembayaran anda gagal - sila muat naik resit yang lebih jelas atau hubungi kami.`,
  verified: (orderNo: string) =>
    `Pembayaran untuk pesanan ${orderNo} telah disahkan oleh pasukan kami. Pesanan anda akan dibungkus tidak lama lagi.`,
  order_expired:
    "Tempahan stok untuk pesanan ini telah tamat tempoh. Kod QR tidak tamat tempoh - jika anda telah membayar, sila muat naik resit dan kami akan semak secara manual.",
  order_cancelled: (reason: string) => `Pesanan anda telah dibatalkan: ${reason}.`,
  shipped: (courier: string, tracking: string) =>
    `Pesanan anda telah dihantar melalui ${courier}. Nombor penjejakan: ${tracking}.`,
  quote_required:
    "Kos penghantaran untuk alamat anda perlu disemak dahulu. Kami akan maklumkan jumlah penuh sebelum anda membuat pembayaran.",
} as const;
