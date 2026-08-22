/* v1.35.0 — the ELFIA bridge feed serialiser, as pure functions with zero
   imports so tests/bridge-feed-guard.mjs can import the SHIPPED code directly
   (the shift-sales.ts pattern — the test cannot drift from what runs).

   The contract is the store's PORTAL-BRIDGE-SPEC.md, and two of its rules
   shape everything here:

   1. price_cents is an INTEGER in sen and must be > 0. The store refuses
      anything else — so a missing or zero price is OMITTED from the JSON
      entirely, which the spec defines as "the store's own price stands".
      Sending 0 would not mean "free"; it would mean a refused sync line.
   2. The number sent is what the customer actually pays. elfia_price_cents
      is the explicit web price; unit_price_cents is the fallback. The TikTok
      live rebate (live_rebate_cents) NEVER applies online — a live discount
      leaking onto the shop's price tag every time a host sets a rebate would
      silently reprice the website. */

export interface BridgeRow {
  sku: string;
  name?: string | null;
  stock: number;
  /** absent on a pre-0075 database (migration-skew fallback query) */
  bridge_enabled?: number | null;
  status?: string | null;
  unit_price_cents?: number | null;
  elfia_price_cents?: number | null;
}

export interface BridgeItem {
  sku: string;
  name?: string;
  stock: number;
  price_cents?: number;
}

/** The price the shop must charge, in sen — or null for "send no price". */
export function effectivePriceCents(row: {
  unit_price_cents?: number | null;
  elfia_price_cents?: number | null;
}): number | null {
  const explicit = row.elfia_price_cents;
  if (typeof explicit === "number" && Number.isInteger(explicit) && explicit > 0) return explicit;
  // An explicitly set but unusable web price (0, negative, fractional) falls
  // through to the list price rather than silently shipping a bad number.
  const list = row.unit_price_cents;
  if (typeof list === "number" && Number.isInteger(list) && list > 0) return list;
  return null;
}

/** Rows → the exact feed payload. Filters what must never leave, clamps what
    must never be negative, and omits price_cents when there is none. */
export function serializeBridgeItems(rows: BridgeRow[]): BridgeItem[] {
  const out: BridgeItem[] = [];
  for (const row of rows) {
    if (!row || typeof row.sku !== "string" || row.sku.trim() === "") continue;
    if (row.status === "discontinued") continue;
    // bridge_enabled present-and-falsy = deliberately unpublished. Absent
    // (pre-0075 fallback query) = the LIKE scoping already chose the rows.
    if (row.bridge_enabled !== undefined && row.bridge_enabled !== null && row.bridge_enabled !== 1) continue;
    const stock = Number.isFinite(row.stock) ? Math.max(0, Math.floor(row.stock)) : 0;
    const item: BridgeItem = { sku: row.sku, stock };
    if (typeof row.name === "string" && row.name !== "") item.name = row.name;
    const price = effectivePriceCents(row);
    if (price !== null) item.price_cents = price;
    out.push(item);
  }
  return out;
}
