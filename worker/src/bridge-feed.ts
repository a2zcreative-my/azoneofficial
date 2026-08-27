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
  /** v1.49.0 — the collection's NAME, as the portal spells it. Was a
      two-value enum; the CEO names her own collections now and the shop
      groups by whatever arrives. Omitted when blank — absent means "the
      store keeps what it has", the feed's oldest rule. */
  category?: string;
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
  zoom?: number | null;
  cutout_key?: string | null;
  cutout_updated_at?: string | null;
  cutout_side?: string | null;
  cutout_scale?: number | null;
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
  /** v1.48.0 — per cent. 100 = the whole photo fits in the banner, nothing
      cut off; higher grows it and the banner crops. Always sent. */
  zoom: number;
  /* v1.50.0 — the cut-out that steps out of the banner. A PNG with a
     transparent background, drawn over the slide and above its top edge.
     All four are sent together or not at all: a URL without its marker
     would be re-downloaded on every pull, and a marker without a URL says
     nothing. Absent = the slide draws as it always has. */
  cutout_url?: string;
  cutout_updated_at?: string;
  cutout_side?: "left" | "right";
  cutout_scale?: number;
}

/* v1.48.0 — zoom per cent. Floor 100 ("the whole photo"), ceiling 300: past
   that a banner photo is a pixel soup and the number is almost certainly a
   mistake. Anything unusable becomes 100, which shows everything. */
const zoomPct = (v: unknown): number => {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return 100;
  return Math.min(300, Math.max(100, n));
};

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
      zoom: zoomPct(r.zoom),
    };
    /* v1.50.0 — the cut-out, only when there is a real file AND a marker to
       gate its download. */
    if (typeof r.cutout_key === "string" && r.cutout_key !== ""
        && typeof r.cutout_updated_at === "string" && r.cutout_updated_at !== "") {
      s.cutout_url = `${base}/api/v1/media/file/${r.cutout_key}`;
      s.cutout_updated_at = r.cutout_updated_at;
      s.cutout_side = r.cutout_side === "left" ? "left" : "right";
      const sc = Math.round(Number(r.cutout_scale));
      s.cutout_scale = Number.isFinite(sc) ? Math.min(160, Math.max(100, sc)) : 118;
    }
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
    if (typeof row.elfia_category === "string") {
      const cat = row.elfia_category.trim().replace(/\s+/g, " ").slice(0, 40);
      if (cat !== "") item.category = cat;
    }
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

/* ---------------------------------------------------------------------------
   v1.52.0 — what delivery costs on the ELFIA shop.

   The CEO, 26-08-2026: "I want to have the authority to update the shipping
   fees which is above RM45.00, I will provide a free delivery fees."

   Both numbers used to live in the STORE's wrangler.toml, so changing what
   delivery costs meant editing code and running a deploy. They are hers now:
   set in the portal's ELFIA tab, kept in system_meta, and carried on this
   feed like everything else the portal owns.

   The rule is the feed's oldest one and it decides the shape of this
   function: an ABSENT field means "the store keeps what it has". So a value
   that is missing, blank or not a sane number of sen is OMITTED rather than
   sent as 0 — sending 0 would not mean "not set", it would mean "delivery is
   free" and "free delivery from RM 0.00", which is a shop giving away
   postage because a text box was empty. If neither number is set, the whole
   `settings` key is left off the feed.
--------------------------------------------------------------------------- */

export interface BridgeSettings {
  /** Flat delivery charge in sen. */
  shipping_cents?: number;
  /** Order subtotal in sen at or above which delivery is free. */
  free_above_cents?: number;
}

/** Sen, as a whole number, or null if this is not a usable amount.
    The RM 1,000 ceiling is a typo catcher: nobody charges more than that to
    post a hijab, and a stray zero must not reach a customer's total. */
const sen = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 100_000) return null;
  return Math.round(n);
};

/** `meta` is the system_meta rows as {key: value}. */
export function serializeBridgeSettings(meta: Record<string, unknown>): BridgeSettings | undefined {
  const out: BridgeSettings = {};
  const ship = sen(meta.elfia_shipping_cents);
  const free = sen(meta.elfia_free_above_cents);
  if (ship !== null) out.shipping_cents = ship;
  if (free !== null) out.free_above_cents = free;
  return Object.keys(out).length > 0 ? out : undefined;
}

/* ---------------------------------------------------------------------------
   v1.55.0 — the catalog the CEO uploads, priced by the shop.

   The CEO, 26-08-2026: "the portal can upload the PDF for this catalog
   without the prices tag and it will automatically live price embedded to
   the PDF uploaded."

   The portal holds three files in R2 — the PDF, the label map her browser
   extracted at upload, and the cover image — and this key tells the store
   where they are and WHEN they last changed. The store re-downloads only on
   a new marker, and takes the three together or not at all: a new PDF
   priced with an old map would put prices on the wrong labels, which is the
   one failure mode this shape exists to make impossible.

   The key is emitted ONLY when the PDF, the map, and the marker all exist —
   a half-finished upload (PDF stored, map not yet posted) stays off the
   feed, and an absent key means what it always means: the store keeps what
   it has (the shipped designer catalog included).
--------------------------------------------------------------------------- */

export interface BridgeCatalog {
  url: string;
  map_url: string;
  cover_url?: string;
  updated_at: string;
}

/** `meta` is the system_meta rows as {key: value}. No mediaBase = no key —
    the store cannot fetch a relative path, same rule as photos. */
export function serializeBridgeCatalog(meta: Record<string, unknown>, mediaBase?: string): BridgeCatalog | undefined {
  const base = typeof mediaBase === "string" ? mediaBase.replace(/\/+$/, "") : "";
  if (!base) return undefined;
  const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
  const pdfKey = str(meta.elfia_catalog_pdf_key);
  const mapKey = str(meta.elfia_catalog_map_key);
  const marker = str(meta.elfia_catalog_updated_at);
  if (!pdfKey || !mapKey || !marker) return undefined;
  const out: BridgeCatalog = {
    url: `${base}/api/v1/media/file/${pdfKey}`,
    map_url: `${base}/api/v1/media/file/${mapKey}`,
    updated_at: marker,
  };
  const coverKey = str(meta.elfia_catalog_cover_key);
  if (coverKey) out.cover_url = `${base}/api/v1/media/file/${coverKey}`;
  return out;
}

/* ---------------------------------------------------------------------------
   v1.61.0 — the /catalog hover backdrop.

   The CEO, 27-08-2026: "for the cut out background I want to have an option
   for me to add this background if require and this I can upload by myself
   in portal!"

   One image, uploaded in the ELFIA tab, that the shop draws behind every
   catalog tile's cut-out photo on hover. Same travel rules as everything
   else on this feed: a URL plus the marker that gates the store's download,
   emitted only when both exist, and an absent key means the store keeps
   what it has — the shipped ELFIA backdrop included. Removing it in the
   portal is a direct call to the store's own reset door (/bridge/backdrop),
   exactly like removing the catalog.
--------------------------------------------------------------------------- */

export interface BridgeBackdrop {
  url: string;
  updated_at: string;
}

/** `meta` is the system_meta rows as {key: value}. No mediaBase = no key —
    the store cannot fetch a relative path, same rule as photos. */
export function serializeBridgeBackdrop(meta: Record<string, unknown>, mediaBase?: string): BridgeBackdrop | undefined {
  const base = typeof mediaBase === "string" ? mediaBase.replace(/\/+$/, "") : "";
  if (!base) return undefined;
  const key = typeof meta.elfia_backdrop_key === "string" ? meta.elfia_backdrop_key.trim() : "";
  const marker = typeof meta.elfia_backdrop_updated_at === "string" ? meta.elfia_backdrop_updated_at.trim() : "";
  if (!key || !marker) return undefined;
  return { url: `${base}/api/v1/media/file/${key}`, updated_at: marker };
}
