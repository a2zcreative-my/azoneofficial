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
  /* v1.45.0 (0086) — the ELFIA tab's product dressing. All absent on a
     pre-0086 database; the serializer then omits the fields, which the spec
     defines as "the store keeps what it has". */
  elfia_category?: string | null;
  elfia_description?: string | null;
  elfia_image_key?: string | null;
  elfia_image_updated_at?: string | null;
  /* v1.46.0 (0087) — per-item web discount in sen. */
  elfia_discount_cents?: number | null;
}

export interface BridgeItem {
  sku: string;
  name?: string;
  stock: number;
  price_cents?: number;
  /* v1.45.0 — per PORTAL-PHOTO-SYNC-HANDOFF.md on the store side. */
  category?: "bawal" | "shawl";
  description?: string;
  image_url?: string;
  image_updated_at?: string;
  /* v1.46.0 — the pre-discount price, sent ONLY when a discount actually
     bites, so the shop can draw "RM 39.00 → RM 36.00". price_cents stays
     what the customer PAYS — the feed's oldest rule is untouched. */
  list_price_cents?: number;
}

/* v1.46.0 — one hero slide of the ELFIA storefront carousel, authored in the
   portal. The store REPLACES its slide set to match this list on every pull
   (the one feed section where absence means delete — slides have no
   store-side author to protect), so the portal's Remove really removes. */
export interface SlideRow {
  id: number;
  image_key?: string | null;
  image_updated_at?: string | null;
  title?: string | null;
  subtitle?: string | null;
  sort?: number | null;
  active?: number | null;
  focus_x?: number | null;
  focus_y?: number | null;
  fit?: string | null;
}

export interface BridgeSlide {
  id: number;
  image_url: string;
  image_updated_at: string;
  title?: string;
  subtitle?: string;
  sort: number;
  /** v1.47.0 — framing. Per cent (0-100) of the photo that must stay
      visible when the shop crops it, and whether it crops at all. Always
      sent: a slide without framing would silently fall back to the store's
      old fixed crop, which is the bug these two fields exist to end. */
  focus_x: number;
  focus_y: number;
  fit: "cover" | "contain";
}

/** 0-100, integer, anything unusable becomes the middle. */
const pct = (v: unknown): number => {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return 50;
  return Math.min(100, Math.max(0, n));
};

export function serializeBridgeSlides(rows: SlideRow[], mediaBase?: string): BridgeSlide[] {
  const base = typeof mediaBase === "string" ? mediaBase.replace(/\/+$/, "") : "";
  const out: BridgeSlide[] = [];
  if (!base) return out; // a slide IS its photo — no origin, no slide
  for (const r of rows) {
    if (!r || !Number.isInteger(r.id)) continue;
    if (r.active !== undefined && r.active !== null && r.active !== 1) continue;
    if (typeof r.image_key !== "string" || r.image_key === "") continue;
    if (typeof r.image_updated_at !== "string" || r.image_updated_at === "") continue;
    const s: BridgeSlide = {
      id: r.id,
      image_url: `${base}/api/v1/media/file/${r.image_key}`,
      image_updated_at: r.image_updated_at,
      sort: Number.isFinite(Number(r.sort)) ? Number(r.sort) : 100,
      focus_x: pct(r.focus_x),
      focus_y: pct(r.focus_y),
      fit: r.fit === "contain" ? "contain" : "cover",
    };
    if (typeof r.title === "string" && r.title.trim() !== "") s.title = r.title.trim().slice(0, 120);
    if (typeof r.subtitle === "string" && r.subtitle.trim() !== "") s.subtitle = r.subtitle.trim().slice(0, 200);
    out.push(s);
  }
  return out.sort((a, b) => a.sort - b.sort || a.id - b.id);
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
    must never be negative, and omits every optional field that has no real
    value — "absent" is a meaningful word in this contract ("the store keeps
    what it has"), so nothing is ever sent as null, "" or 0-as-false.

    v1.45.0: `mediaBase` is the absolute origin the photo URL is built on
    (e.g. "https://a2zcreative.my"), taken from the REQUEST that is being
    answered — never hardcoded, so the local rig and production both serve
    URLs that point at themselves. No mediaBase (a caller that cannot know
    its origin) = no image_url, never a relative path the store cannot
    fetch. */
export function serializeBridgeItems(rows: BridgeRow[], mediaBase?: string): BridgeItem[] {
  const out: BridgeItem[] = [];
  const base = typeof mediaBase === "string" ? mediaBase.replace(/\/+$/, "") : "";
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
    if (price !== null) {
      /* v1.46.0 — the discount. price_cents remains what the customer PAYS
         (the store applies it to the price tag verbatim), so the discount is
         subtracted HERE and the pre-discount number rides alongside as
         list_price_cents — only when the discount actually bites. A discount
         that would take the price to zero or below is ignored rather than
         shipping a free or refused product. */
      const disc = row.elfia_discount_cents;
      if (typeof disc === "number" && Number.isInteger(disc) && disc > 0 && disc < price) {
        item.price_cents = price - disc;
        item.list_price_cents = price;
      } else {
        item.price_cents = price;
      }
    }
    /* Only the two collections the store has. Anything else stored here (a
       typo, a future value an old worker does not know) is OMITTED rather
       than forwarded — the store refuses unknown categories, and a refused
       line is worse than a defaulted one. */
    if (row.elfia_category === "bawal" || row.elfia_category === "shawl") item.category = row.elfia_category;
    if (typeof row.elfia_description === "string" && row.elfia_description.trim() !== "") {
      item.description = row.elfia_description.trim().slice(0, 2000);
    }
    /* The photo travels as a URL + change marker, never as bytes. Both or
       neither: an image_url without its marker would make the store
       re-download on every 5-minute pull. The upload route always stamps
       the marker, so a keyed row without one is a hand-edited anomaly —
       omitted, by the same rule as the category. */
    if (base &&
        typeof row.elfia_image_key === "string" && row.elfia_image_key !== "" &&
        typeof row.elfia_image_updated_at === "string" && row.elfia_image_updated_at !== "") {
      item.image_url = `${base}/api/v1/media/file/${row.elfia_image_key}`;
      item.image_updated_at = row.elfia_image_updated_at;
    }
    out.push(item);
  }
  return out;
}
