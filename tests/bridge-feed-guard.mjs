/* v1.35.0 — proves the ELFIA feed serialiser on the REAL worker code
   (worker/src/bridge-feed.ts imported directly, not a copy), so the test
   cannot drift from what ships.

   Why this guard exists: the store applies price_cents straight onto its
   price tag and refuses anything that is not a positive integer — so a
   wrong shape here is not a bug report, it is a wrong price shown to a
   customer, or a silently rejected sync line. Every rule below is a line
   from PORTAL-BRIDGE-SPEC.md.

   Run: node --experimental-strip-types tests/bridge-feed-guard.mjs */
import { serializeBridgeCatalog, serializeBridgeItems, serializeBridgeSettings, serializeBridgeSlides, effectivePriceCents } from "../worker/src/bridge-feed.ts";

let failed = 0;
const eq = (label, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) console.log(`ok   ${label}`);
  else { console.log(`FAIL ${label}\n     got  ${g}\n     want ${w}`); failed++; }
};

/* 1. The explicit web price wins over the list price. */
eq("elfia_price_cents wins over unit_price_cents",
  effectivePriceCents({ unit_price_cents: 4900, elfia_price_cents: 3600 }), 3600);

/* 2. No web price → list price stands in. */
eq("falls back to unit_price_cents",
  effectivePriceCents({ unit_price_cents: 4900, elfia_price_cents: null }), 4900);

/* 3. No usable price at all → null, and the KEY IS OMITTED (spec: an absent
      price_cents means "the store's own price stands"; a 0 would be refused). */
eq("zero list price → no price sent",
  effectivePriceCents({ unit_price_cents: 0, elfia_price_cents: null }), null);
eq("price_cents key omitted when there is no price",
  serializeBridgeItems([{ sku: "LUMI002", name: "Periwinkle", stock: 3, bridge_enabled: 1, unit_price_cents: 0 }]),
  [{ sku: "LUMI002", stock: 3, name: "Periwinkle" }]);

/* 4. A bad explicit price (0 / negative / fractional sen) falls through to
      the list price rather than shipping a refused number. */
eq("zero web price falls back to list",
  effectivePriceCents({ unit_price_cents: 4900, elfia_price_cents: 0 }), 4900);
eq("negative web price falls back to list",
  effectivePriceCents({ unit_price_cents: 4900, elfia_price_cents: -100 }), 4900);
eq("fractional sen falls back to list",
  effectivePriceCents({ unit_price_cents: 4900, elfia_price_cents: 3600.5 }), 4900);

/* 5. Stock is never negative and never fractional. */
eq("negative stock clamps to 0",
  serializeBridgeItems([{ sku: "LUMI001", stock: -2, bridge_enabled: 1 }]),
  [{ sku: "LUMI001", stock: 0 }]);
eq("fractional stock floors",
  serializeBridgeItems([{ sku: "LUMI001", stock: 4.9, bridge_enabled: 1 }]),
  [{ sku: "LUMI001", stock: 4 }]);

/* 6. Discontinued items and unpublished items never leave the building. */
eq("discontinued excluded",
  serializeBridgeItems([{ sku: "LUMI001", stock: 5, bridge_enabled: 1, status: "discontinued" }]), []);
eq("bridge_enabled = 0 excluded",
  serializeBridgeItems([{ sku: "AZ001", stock: 5, bridge_enabled: 0, unit_price_cents: 9900 }]), []);

/* 7. The migration-skew fallback rows (no bridge_enabled column at all)
      still pass through — the LIKE query already chose them. */
eq("pre-0075 fallback rows pass through without prices",
  serializeBridgeItems([{ sku: "LUMI003", name: "Sage", stock: 7 }]),
  [{ sku: "LUMI003", stock: 7, name: "Sage" }]);

/* 8. The payload never carries a key outside the contract — the customer's
      store must not learn portal internals from a widened SELECT. */
{
  const items = serializeBridgeItems([{
    sku: "LUMI001", name: "Dusty Rose", stock: 24, bridge_enabled: 1,
    unit_price_cents: 4900, elfia_price_cents: 3600, status: "in_stock",
    // simulate a future SELECT * leak:
    updated_by: 3, note: "internal note", live_rebate_cents: 500,
  }]);
  const allowed = new Set(["sku", "name", "stock", "price_cents",
    // v1.45.0 — the ELFIA tab's product dressing travels in the feed by design
    "category", "description", "image_url", "image_updated_at",
    // v1.46.0 — the pre-discount price, only when a discount bites
    "list_price_cents"]);
  const leaked = items.flatMap((it) => Object.keys(it).filter((k) => !allowed.has(k)));
  eq("no key outside {sku,name,stock,price_cents}", leaked, []);
  eq("and the price sent is the explicit web price", items[0].price_cents, 3600);
}

/* 9. The live rebate NEVER reaches the web price — even when present. */
eq("live_rebate_cents is ignored by the feed",
  serializeBridgeItems([{ sku: "LUMI001", stock: 2, bridge_enabled: 1, unit_price_cents: 4900, live_rebate_cents: 1000 }]),
  [{ sku: "LUMI001", stock: 2, price_cents: 4900 }]);

/* 10. Junk rows cannot crash the feed. */
eq("blank sku dropped",
  serializeBridgeItems([{ sku: "  ", stock: 5, bridge_enabled: 1 }, null]), []);

/* ---- v1.45.0 — the ELFIA tab's dressing (0086) ---- */

/* 11. Category: only the two collections the store has may travel; anything
       else is OMITTED, never forwarded to be refused over there. */
eq("category travels when valid",
  serializeBridgeItems([{ sku: "SHWL001", name: "Shawl — Beige", stock: 4, bridge_enabled: 1, unit_price_cents: 5500, elfia_category: "shawl" }]),
  [{ sku: "SHWL001", stock: 4, name: "Shawl — Beige", price_cents: 5500, category: "shawl" }]);
/* v1.49.0 — REVERSED on the CEO's instruction ("I should be able to add the
   category in the portal"). Any name she types is now hers to use; the shop
   groups by what arrives instead of splitting a range with a regex over the
   product name. Only blank still means "say nothing". */
eq("a collection she invented travels in her own spelling",
  serializeBridgeItems([{ sku: "SHWL001", stock: 4, bridge_enabled: 1, elfia_category: "Bawal Printed" }]),
  [{ sku: "SHWL001", stock: 4, category: "Bawal Printed" }]);
eq("spacing is tidied and the name is capped, never refused",
  serializeBridgeItems([{ sku: "SHWL001", stock: 4, bridge_enabled: 1, elfia_category: "  Raya   Exclusive  " }]),
  [{ sku: "SHWL001", stock: 4, category: "Raya Exclusive" }]);
eq("a blank collection is omitted — the store keeps what it has",
  serializeBridgeItems([{ sku: "SHWL001", stock: 4, bridge_enabled: 1, elfia_category: "   " }]),
  [{ sku: "SHWL001", stock: 4 }]);

/* 12. Description: trimmed, capped at the store's own 2000, and OMITTED when
       empty ("absent = the store keeps what it has"). */
eq("description travels trimmed",
  serializeBridgeItems([{ sku: "LUMI001", stock: 2, bridge_enabled: 1, elfia_description: "  Lightweight and opaque.  " }]),
  [{ sku: "LUMI001", stock: 2, description: "Lightweight and opaque." }]);
eq("a blank description is omitted",
  serializeBridgeItems([{ sku: "LUMI001", stock: 2, bridge_enabled: 1, elfia_description: "   " }]),
  [{ sku: "LUMI001", stock: 2 }]);
{
  const long = "x".repeat(3000);
  const items = serializeBridgeItems([{ sku: "LUMI001", stock: 2, bridge_enabled: 1, elfia_description: long }]);
  eq("an over-long description is capped at 2000", items[0].description.length, 2000);
}

/* 13. The photo: URL built on the caller's origin + the change marker, BOTH
       or NEITHER — an image_url without its marker would make the store
       re-download on every 5-minute pull. */
eq("photo travels as an absolute URL + marker",
  serializeBridgeItems([{ sku: "LUMI001", stock: 2, bridge_enabled: 1,
    elfia_image_key: "uploads/elfia/7-1756100000000.jpg", elfia_image_updated_at: "2026-08-25T12:00:00.000Z" }],
    "https://a2zcreative.my"),
  [{ sku: "LUMI001", stock: 2,
     image_url: "https://a2zcreative.my/api/v1/media/file/uploads/elfia/7-1756100000000.jpg",
     image_updated_at: "2026-08-25T12:00:00.000Z" }]);
eq("a key without its marker sends no image_url",
  serializeBridgeItems([{ sku: "LUMI001", stock: 2, bridge_enabled: 1,
    elfia_image_key: "uploads/elfia/7-1.jpg" }], "https://a2zcreative.my"),
  [{ sku: "LUMI001", stock: 2 }]);
eq("no mediaBase (caller cannot know its origin) sends no image_url",
  serializeBridgeItems([{ sku: "LUMI001", stock: 2, bridge_enabled: 1,
    elfia_image_key: "uploads/elfia/7-1.jpg", elfia_image_updated_at: "m1" }]),
  [{ sku: "LUMI001", stock: 2 }]);

/* 14. Pre-0086 rows (all four columns absent) serialize exactly as before —
       the migration-skew case must stay byte-identical. */
eq("a pre-0086 row is unchanged",
  serializeBridgeItems([{ sku: "LUMI003", name: "Lavender", stock: 8, bridge_enabled: 1, unit_price_cents: 4900 }], "https://a2zcreative.my"),
  [{ sku: "LUMI003", stock: 8, name: "Lavender", price_cents: 4900 }]);

/* ---- v1.46.0 — discount + carousel (0087) ---- */

/* 15. The discount: price_cents stays what the customer PAYS, and the
       pre-discount number rides alongside ONLY when the discount bites. */
eq("a discount nets the price and sends the list price",
  serializeBridgeItems([{ sku: "LUMI001", stock: 2, bridge_enabled: 1, unit_price_cents: 3900, elfia_discount_cents: 300 }]),
  [{ sku: "LUMI001", stock: 2, price_cents: 3600, list_price_cents: 3900 }]);
eq("no discount → no list_price_cents key",
  serializeBridgeItems([{ sku: "LUMI001", stock: 2, bridge_enabled: 1, unit_price_cents: 3900, elfia_discount_cents: 0 }]),
  [{ sku: "LUMI001", stock: 2, price_cents: 3900 }]);
eq("a discount that swallows the whole price is ignored",
  serializeBridgeItems([{ sku: "LUMI001", stock: 2, bridge_enabled: 1, unit_price_cents: 3900, elfia_discount_cents: 3900 }]),
  [{ sku: "LUMI001", stock: 2, price_cents: 3900 }]);
eq("the discount applies to the EXPLICIT web price when one is set",
  serializeBridgeItems([{ sku: "LUMI001", stock: 2, bridge_enabled: 1, unit_price_cents: 4900, elfia_price_cents: 3900, elfia_discount_cents: 300 }]),
  [{ sku: "LUMI001", stock: 2, price_cents: 3600, list_price_cents: 3900 }]);

/* 16. Slides: photo-first, sorted, inactive and photo-less rows dropped,
       and no slides at all without an origin to build URLs on. */
eq("slides serialize sorted with absolute URLs",
  serializeBridgeSlides([
    { id: 2, image_key: "uploads/elfia/slides/2-1.jpg", image_updated_at: "m2", title: " Raya drop ", sort: 200 },
    { id: 1, image_key: "uploads/elfia/slides/1-1.jpg", image_updated_at: "m1", subtitle: "First Sight, Forever Yours", sort: 100 },
    { id: 3, image_key: "", image_updated_at: "m3", sort: 50 },
    { id: 4, image_key: "uploads/elfia/slides/4-1.jpg", image_updated_at: "m4", sort: 10, active: 0 },
  ], "https://a2zcreative.my"),
  [
    /* v1.47.0 — framing is ALWAYS sent, defaulted here because these rows
       predate 0088. A slide with no framing would fall back to the store's
       old fixed crop, which is the bug the two fields exist to end. */
    { id: 1, image_url: "https://a2zcreative.my/api/v1/media/file/uploads/elfia/slides/1-1.jpg", image_updated_at: "m1", sort: 100, focus_x: 50, focus_y: 50, fit: "cover", zoom: 100, subtitle: "First Sight, Forever Yours" },
    { id: 2, image_url: "https://a2zcreative.my/api/v1/media/file/uploads/elfia/slides/2-1.jpg", image_updated_at: "m2", sort: 200, focus_x: 50, focus_y: 50, fit: "cover", zoom: 100, title: "Raya drop" },
  ]);

/* 17. Framing: what the CEO clicks is what the store is told, clamped, and
       "show the whole photo" survives; nonsense falls back to the middle. */
eq("framing crosses the bridge, clamped, with contain preserved",
  serializeBridgeSlides([
    { id: 1, image_key: "a.jpg", image_updated_at: "m1", sort: 1, focus_x: 20, focus_y: 80, fit: "contain", zoom: 100 },
    { id: 2, image_key: "b.jpg", image_updated_at: "m2", sort: 2, focus_x: -30, focus_y: 900, fit: "nonsense" },
    { id: 3, image_key: "c.jpg", image_updated_at: "m3", sort: 3 },
  ], "https://a2zcreative.my"),
  [
    { id: 1, image_url: "https://a2zcreative.my/api/v1/media/file/a.jpg", image_updated_at: "m1", sort: 1, focus_x: 20, focus_y: 80, fit: "contain", zoom: 100 },
    { id: 2, image_url: "https://a2zcreative.my/api/v1/media/file/b.jpg", image_updated_at: "m2", sort: 2, focus_x: 0, focus_y: 100, fit: "cover", zoom: 100 },
    { id: 3, image_url: "https://a2zcreative.my/api/v1/media/file/c.jpg", image_updated_at: "m3", sort: 3, focus_x: 50, focus_y: 50, fit: "cover", zoom: 100 },
  ]);
/* 18. Zoom: the CEO's dial. 100 = the whole photo; clamped both ways so a
       slip of a finger cannot ship a banner nobody can read. */
eq("zoom crosses the bridge, clamped both ways",
  serializeBridgeSlides([
    { id: 1, image_key: "a.jpg", image_updated_at: "m1", sort: 1, zoom: 100 },
    { id: 2, image_key: "b.jpg", image_updated_at: "m2", sort: 2, zoom: 175 },
    { id: 3, image_key: "c.jpg", image_updated_at: "m3", sort: 3, zoom: 9000 },
    { id: 4, image_key: "d.jpg", image_updated_at: "m4", sort: 4, zoom: 12 },
  ], "https://a2zcreative.my").map((s) => s.zoom),
  [100, 175, 300, 100]);

eq("no origin → no slides (a slide IS its photo URL)",
  serializeBridgeSlides([{ id: 1, image_key: "uploads/elfia/slides/1-1.jpg", image_updated_at: "m1", sort: 1 }]),
  []);

/* ---- what delivery costs (v1.52.0) ----
   These two numbers are charged to a customer at checkout, so the rules that
   matter are about what must NOT cross the bridge. Sending 0 for "not set"
   would read at the shop as "delivery is free" and "free delivery from
   RM 0.00" — a shop giving away postage because a text box was empty. So an
   unusable value is OMITTED, and the store's own rule ("absent = keep what
   you have") does the rest. */

eq("both amounts cross the bridge",
  serializeBridgeSettings({ elfia_shipping_cents: 450, elfia_free_above_cents: 4500 }),
  { shipping_cents: 450, free_above_cents: 4500 });

eq("string values from system_meta are numbers on the wire",
  serializeBridgeSettings({ elfia_shipping_cents: "450", elfia_free_above_cents: "4500" }),
  { shipping_cents: 450, free_above_cents: 4500 });

eq("nothing set at all → the whole key is omitted",
  serializeBridgeSettings({}), undefined);

eq("an empty box is NOT free delivery — the key is omitted",
  serializeBridgeSettings({ elfia_shipping_cents: "", elfia_free_above_cents: "" }), undefined);

eq("free delivery from RM 0.00 cannot be sent by accident (blank threshold)",
  serializeBridgeSettings({ elfia_shipping_cents: 450, elfia_free_above_cents: "" }),
  { shipping_cents: 450 });

eq("zero IS a legal delivery charge — free postage is a real choice",
  serializeBridgeSettings({ elfia_shipping_cents: 0, elfia_free_above_cents: 4500 }),
  { shipping_cents: 0, free_above_cents: 4500 });

eq("a stray zero (RM 45,000 postage) is refused, not clamped",
  serializeBridgeSettings({ elfia_shipping_cents: 4500000, elfia_free_above_cents: 4500 }),
  { free_above_cents: 4500 });

eq("a negative amount is refused",
  serializeBridgeSettings({ elfia_shipping_cents: -450, elfia_free_above_cents: 4500 }),
  { free_above_cents: 4500 });

eq("text in the box is refused rather than becoming NaN",
  serializeBridgeSettings({ elfia_shipping_cents: "free", elfia_free_above_cents: 4500 }),
  { free_above_cents: 4500 });

eq("a fraction of a sen is rounded, never stored as a fraction",
  serializeBridgeSettings({ elfia_shipping_cents: 450.4, elfia_free_above_cents: 4500.6 }),
  { shipping_cents: 450, free_above_cents: 4501 });

/* ---- v1.55.0: the uploaded catalog ----
   Emitted ONLY when PDF + map + marker all exist — a half-finished upload
   must stay invisible, and a new PDF must never be priced with an old map
   (the upload route clears the marker until the new map lands). */
const CAT = {
  elfia_catalog_pdf_key: "uploads/elfia/catalog-1.pdf",
  elfia_catalog_map_key: "uploads/elfia/catalog-map-1.json",
  elfia_catalog_cover_key: "uploads/elfia/catalog-cover-1.jpg",
  elfia_catalog_updated_at: "2026-08-26T00:00:00Z",
};

eq("the complete catalog rides the feed, URLs on the request origin",
  serializeBridgeCatalog(CAT, "https://a2zcreative.my/"),
  { url: "https://a2zcreative.my/api/v1/media/file/uploads/elfia/catalog-1.pdf",
    map_url: "https://a2zcreative.my/api/v1/media/file/uploads/elfia/catalog-map-1.json",
    updated_at: "2026-08-26T00:00:00Z",
    cover_url: "https://a2zcreative.my/api/v1/media/file/uploads/elfia/catalog-cover-1.jpg" });

eq("no cover is fine — the key is simply left off",
  serializeBridgeCatalog({ ...CAT, elfia_catalog_cover_key: "" }, "https://a2zcreative.my")?.cover_url,
  undefined);

eq("PDF without its map stays OFF the feed (half-finished upload)",
  serializeBridgeCatalog({ ...CAT, elfia_catalog_map_key: "" }, "https://a2zcreative.my"), undefined);

eq("map without its marker stays OFF the feed (upload route cleared it for a new PDF)",
  serializeBridgeCatalog({ ...CAT, elfia_catalog_updated_at: "" }, "https://a2zcreative.my"), undefined);

eq("nothing uploaded → no key at all",
  serializeBridgeCatalog({}, "https://a2zcreative.my"), undefined);

eq("no origin to build URLs on → no key (a relative path the store cannot fetch)",
  serializeBridgeCatalog(CAT, undefined), undefined);

if (failed) { console.error(`\n${failed} bridge-feed check(s) failed.`); process.exit(1); }
console.log("\nbridge-feed-guard: all checks passed.");
