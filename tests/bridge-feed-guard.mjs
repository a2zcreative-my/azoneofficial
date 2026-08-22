/* v1.35.0 — proves the ELFIA feed serialiser on the REAL worker code
   (worker/src/bridge-feed.ts imported directly, not a copy), so the test
   cannot drift from what ships.

   Why this guard exists: the store applies price_cents straight onto its
   price tag and refuses anything that is not a positive integer — so a
   wrong shape here is not a bug report, it is a wrong price shown to a
   customer, or a silently rejected sync line. Every rule below is a line
   from PORTAL-BRIDGE-SPEC.md.

   Run: node --experimental-strip-types tests/bridge-feed-guard.mjs */
import { serializeBridgeItems, effectivePriceCents } from "../worker/src/bridge-feed.ts";

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
  const allowed = new Set(["sku", "name", "stock", "price_cents"]);
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

if (failed) { console.error(`\n${failed} bridge-feed check(s) failed.`); process.exit(1); }
console.log("\nbridge-feed-guard: all checks passed.");
