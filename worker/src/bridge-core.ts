/* v1.36.0 — the ELFIA bridge's decision logic, as pure functions with zero
   imports so tests/bridge-idempotency.mjs can import the SHIPPED code
   directly (the shift-sales.ts pattern).

   Everything here answers one of three questions, and nothing here touches
   a database:
   1. Is this movement well-formed? (malformed = left out of ALL response
      lists, so the store resends it — never guess at broken input)
   2. Which portal item does this SKU mean? (case- and whitespace-insensitive
      both directions: the store's LUMI001 is the portal's LUMI 001)
   3. What does applying this delta do to the count? (clamped at zero — the
      pieces already physically left the shop; refusing would make the store
      retry forever. A clamp is a real-world divergence and must be LOUD.) */

export interface MovementInput {
  event_id: string;
  sku: string;
  delta: number;
  reason?: string | null;
  reference?: string | null;
  occurred_at?: string | null;
}

/** The store's match rule, verbatim from PORTAL-BRIDGE-SPEC.md:
    case- and whitespace-insensitive. 'LUMI 001' ≡ 'lumi001' ≡ 'LUMI001'. */
export function skuKey(sku: string): string {
  return sku.toUpperCase().replace(/\s+/g, "");
}

export const MAX_MOVEMENTS_PER_CALL = 50;

/** Validate one movement. Returns null when malformed — the caller must then
    leave its event_id out of every response list (silence means retry, and a
    malformed movement should be retried after the store fixes it, not
    half-guessed into the ledger). */
export function parseMovement(raw: unknown): MovementInput | null {
  if (typeof raw !== "object" || raw === null) return null;
  const m = raw as Record<string, unknown>;
  if (typeof m.event_id !== "string" || m.event_id.trim() === "" || m.event_id.length > 64) return null;
  if (typeof m.sku !== "string" || m.sku.trim() === "" || m.sku.length > 60) return null;
  if (typeof m.delta !== "number" || !Number.isInteger(m.delta) || m.delta === 0) return null;
  /* AUDIT M7 (v1.39.0): `reason` is INFORMATIONAL per the spec — "delta
     already carries the direction". The earlier order|cancel whitelist was a
     poison pill: one new reason string on the store side ("refund",
     "adjustment") would have been silently dropped from every response list,
     retried forever, and — because the store skips SKUs with undelivered
     movements — would have frozen that SKU's stock/price sync permanently.
     Any string is accepted and truncated; only the STRUCTURAL fields
     (event_id, sku, integer delta) can refuse a movement. */
  if (m.reference !== undefined && m.reference !== null && typeof m.reference !== "string") return null;
  if (m.occurred_at !== undefined && m.occurred_at !== null && typeof m.occurred_at !== "string") return null;
  return {
    event_id: m.event_id.trim(),
    sku: m.sku.trim(),
    delta: m.delta,
    reason: typeof m.reason === "string" && m.reason.trim() !== "" ? m.reason.trim().slice(0, 30) : null,
    reference: typeof m.reference === "string" && m.reference.length <= 60 ? m.reference : null,
    occurred_at: typeof m.occurred_at === "string" && m.occurred_at.length <= 30 ? m.occurred_at : null,
  };
}

/** Validate the whole batch envelope. Returns null for a refusable request
    (not an object, movements missing/not an array, or over the batch cap) —
    the caller answers 400 and the store retries the batch later. */
export function parseBatch(body: unknown): { parsed: (MovementInput | null)[] } | null {
  if (typeof body !== "object" || body === null) return null;
  const arr = (body as Record<string, unknown>).movements;
  if (!Array.isArray(arr) || arr.length === 0 || arr.length > MAX_MOVEMENTS_PER_CALL) return null;
  return { parsed: arr.map(parseMovement) };
}

export interface ApplyPlan {
  newStock: number;
  appliedDelta: number;
  clamped: boolean;
}

/** stock = stock + delta, floored at zero. When the clamp bites, the APPLIED
    delta (what the ledger records) differs from the requested one, and the
    caller must raise a human-visible alert — the shop sold pieces the portal
    did not think existed. */
export function planApply(currentStock: number, delta: number): ApplyPlan {
  const raw = currentStock + delta;
  const newStock = Math.max(0, raw);
  return { newStock, appliedDelta: newStock - currentStock, clamped: raw < 0 };
}

/** Same status thresholds as staff.ts stockStatus — duplicated as a pure
    function on purpose (staff.ts's copy is module-local and this file must
    stay import-free); tests/bridge-idempotency.mjs asserts the two agree
    by value so they cannot drift silently. */
export function bridgeStockStatus(stock: number): string {
  if (stock <= 0) return "out_of_stock";
  if (stock <= 5) return "low";
  return "in_stock";
}

/* ---- feed C (orders) helpers ---- */

export interface WebOrderInput {
  order_number: string;
  status: string;
  customer_name?: string | null;
  phone?: string | null;
  address?: string | null;
  items?: unknown;
  subtotal_cents?: number;
  shipping_cents?: number;
  total_cents?: number;
  payment_method?: string | null;
  tracking_no?: string | null;
  tracking_courier?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export const WEB_ORDER_STATUSES = [
  "pending_payment", "payment_review", "paid", "shipped", "completed", "cancelled",
] as const;

/** A paid-or-later status — the moment revenue exists. */
export function isPaidStatus(status: string): boolean {
  return status === "paid" || status === "shipped" || status === "completed";
}

/** Validate one order from feed C. Unknown statuses are kept verbatim (the
    store may add one; dropping the order would silently hide real sales) but
    anything without the stable key or a plausible shape is skipped. */
export function parseWebOrder(raw: unknown): WebOrderInput | null {
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.order_number !== "string" || o.order_number.trim() === "" || o.order_number.length > 40) return null;
  if (typeof o.status !== "string" || o.status.trim() === "" || o.status.length > 30) return null;
  const cents = (v: unknown): number =>
    typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : 0;
  const s = (v: unknown, max: number): string | null =>
    typeof v === "string" && v.length > 0 ? v.slice(0, max) : null;
  return {
    order_number: o.order_number.trim(),
    status: o.status.trim(),
    customer_name: s(o.customer_name, 120),
    phone: s(o.phone, 30),
    address: s(o.address, 500),
    items: Array.isArray(o.items) ? o.items : [],
    subtotal_cents: cents(o.subtotal_cents),
    shipping_cents: cents(o.shipping_cents),
    total_cents: cents(o.total_cents),
    payment_method: s(o.payment_method, 30),
    tracking_no: s(o.tracking_no, 60),
    tracking_courier: s(o.tracking_courier, 60),
    created_at: s(o.created_at, 30),
    updated_at: s(o.updated_at, 30),
  };
}

export interface WebOrderLineInput {
  store_product_id: number | null;
  name: string | null;
  sku: string | null;
  sku_key: string | null;
  qty: number;
  price_cents: number;
}

/** Lines are a snapshot, replaced whole on every upsert. price_cents is the
    price ACTUALLY CHARGED at purchase — reports must use it even after the
    portal changes a price later. */
export function parseWebOrderLines(items: unknown): WebOrderLineInput[] {
  if (!Array.isArray(items)) return [];
  const out: WebOrderLineInput[] = [];
  for (const raw of items.slice(0, 100)) {
    if (typeof raw !== "object" || raw === null) continue;
    const l = raw as Record<string, unknown>;
    const qty = typeof l.qty === "number" && Number.isInteger(l.qty) && l.qty > 0 ? l.qty : 0;
    if (qty === 0) continue;
    const sku = typeof l.sku === "string" && l.sku.trim() !== "" ? l.sku.trim().slice(0, 60) : null;
    out.push({
      store_product_id: typeof l.product_id === "number" ? l.product_id : null,
      name: typeof l.name === "string" ? l.name.slice(0, 200) : null,
      sku,
      sku_key: sku ? skuKey(sku) : null,
      qty,
      price_cents: typeof l.price_cents === "number" && Number.isInteger(l.price_cents) && l.price_cents >= 0 ? l.price_cents : 0,
    });
  }
  return out;
}
