/* v1.36.0 — proves the ONE rule that must not be got wrong: a movement's
   event_id applies exactly once, however many times the store retries it.

   The harness builds the REAL cumulative schema from worker/migrations into
   node:sqlite, extracts the REAL dedupe INSERT out of worker/src/bridge.ts
   (so the statement under test is the shipped one, not a copy), and drives
   the decision logic imported straight from worker/src/bridge-core.ts.
   Getting this wrong deducts the same physical scarves twice.

   Also proven here: unknown SKUs apply nothing, whitespace/case SKU
   matching, the clamp-at-zero rule, the feed-C upsert (one row per order
   however many status changes), and that web orders stay OUT of the
   salesperson attribution.

   Run: node --experimental-strip-types tests/bridge-idempotency.mjs */
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { skuKey, planApply, parseMovement, parseBatch, bridgeStockStatus, parseWebOrder, parseWebOrderLines, isPaidStatus } from "../worker/src/bridge-core.ts";

let failed = 0;
const eq = (label, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) console.log(`ok   ${label}`);
  else { console.log(`FAIL ${label}\n     got  ${g}\n     want ${w}`); failed++; }
};

/* ---- schema: the real migrations, in order ---- */
const db = new DatabaseSync(":memory:");
db.exec("PRAGMA foreign_keys=OFF;");
db.exec("CREATE TABLE IF NOT EXISTS d1_migrations (id INTEGER PRIMARY KEY, name TEXT, applied_at TEXT);");
for (const f of readdirSync("worker/migrations").filter((x) => x.endsWith(".sql")).sort()) {
  const sql = readFileSync(`worker/migrations/${f}`, "utf8");
  try { db.exec(sql); continue; } catch { /* statement-wise below */ }
  for (const stmt of sql.split(/;\s*(?:\r?\n|$)/)) {
    const t = stmt.trim();
    if (!t || t.startsWith("--")) continue;
    try { db.exec(t + ";"); } catch { /* already applied / seed */ }
  }
}

/* ---- the SHIPPED dedupe statement, extracted from bridge.ts ---- */
const bridgeSrc = readFileSync("worker/src/bridge.ts", "utf8");
const dedupeMatch = bridgeSrc.match(/INSERT INTO bridge_events[\s\S]*?ON CONFLICT \(source, event_id\) DO NOTHING/);
if (!dedupeMatch) { console.log("FAIL the dedupe INSERT is no longer in bridge.ts — this guard must be updated WITH the code"); process.exit(1); }
const dedupeSql = dedupeMatch[0].replace(/\?\d/g, "?");

/* ---- a tiny replica of the handler loop, decisions from bridge-core ---- */
function applyMovements(movements) {
  const applied = [], ignored = [], unknown_sku = [];
  const batch = parseBatch({ movements });
  if (!batch) return null;
  for (const m of batch.parsed) {
    if (!m) continue;
    const key = skuKey(m.sku);
    const ins = db.prepare(dedupeSql).run(m.event_id, m.sku, key, m.delta, m.reason, m.reference, m.occurred_at);
    if (ins.changes === 0) { ignored.push(m.event_id); continue; }
    const item = db.prepare("SELECT id, sku, stock FROM inventory_items WHERE sku_key = ? LIMIT 1").get(key);
    if (!item) {
      db.prepare("UPDATE bridge_events SET outcome = 'unknown_sku' WHERE source = 'elfia' AND event_id = ?").run(m.event_id);
      unknown_sku.push(m.event_id); continue;
    }
    const plan = planApply(item.stock, m.delta);
    db.prepare("UPDATE inventory_items SET stock = ?, status = ? WHERE id = ?")
      .run(plan.newStock, bridgeStockStatus(plan.newStock), item.id);
    db.prepare("INSERT INTO stock_ledger (item_id, sku, delta, balance_after, source, ref_type, ref_id) VALUES (?, ?, ?, ?, 'elfia', 'bridge_event', ?)")
      .run(item.id, item.sku, plan.appliedDelta, plan.newStock, m.event_id);
    db.prepare("UPDATE bridge_events SET outcome = 'applied', item_id = ? WHERE source = 'elfia' AND event_id = ?").run(item.id, m.event_id);
    applied.push(m.event_id);
  }
  return { applied, ignored, unknown_sku };
}
const stockOf = (sku) => db.prepare("SELECT stock FROM inventory_items WHERE sku = ?").get(sku)?.stock;

/* seed one item the way the portal writes it — WITH a space in the SKU */
db.prepare("INSERT INTO inventory_items (sku, sku_key, name, stock, status, bridge_enabled) VALUES ('LUMI 001', 'LUMI001', 'Dusty Rose', 10, 'in_stock', 1)").run();

/* 1. THE rule: same event_id five times → stock moves once. */
const EV = "9f1c8b2e-6a34-4f7d-9c21-0a5b7e3d1f88";
let last = null;
for (let i = 0; i < 5; i++) {
  last = applyMovements([{ event_id: EV, sku: "LUMI001", delta: -2, reason: "order", reference: "ELF-1" }]);
}
eq("same event_id ×5 deducts once", stockOf("LUMI 001"), 8);
eq("…and the 5th answer says ignored", last, { applied: [], ignored: [EV], unknown_sku: [] });

/* 2. Whitespace/case both directions. */
applyMovements([{ event_id: "ev-2", sku: "lumi 001", delta: -1 }]);
eq("store's 'lumi 001' matches portal's 'LUMI 001'", stockOf("LUMI 001"), 7);

/* 3. Unknown SKU: nothing applied, reported for a human. */
const r3 = applyMovements([{ event_id: "ev-3", sku: "NOPE99", delta: -4 }]);
eq("unknown SKU applies nothing", r3.unknown_sku, ["ev-3"]);
eq("…and no item moved", stockOf("LUMI 001"), 7);

/* 4. Cancel comes back. */
applyMovements([{ event_id: "ev-4", sku: "LUMI001", delta: 2, reason: "cancel", reference: "ELF-1" }]);
eq("cancel restores the pieces", stockOf("LUMI 001"), 9);

/* 5. Clamp at zero — the applied delta is what the ledger records. */
applyMovements([{ event_id: "ev-5", sku: "LUMI001", delta: -50, reason: "order" }]);
eq("oversell clamps at zero", stockOf("LUMI 001"), 0);
const led = db.prepare("SELECT delta, balance_after FROM stock_ledger WHERE ref_id = 'ev-5'").get();
eq("ledger records the APPLIED delta, not the requested one", led, { delta: -9, balance_after: 0 });

/* 6. Ledger reconciles: SUM(delta) since seed == stock − seed stock. */
const sum = db.prepare("SELECT COALESCE(SUM(delta), 0) AS s FROM stock_ledger").get().s;
eq("SUM(ledger deltas) equals the net stock change", sum, 0 - 10);

/* 7. Malformed movements land in NO list (silence = the store resends). */
const r7 = applyMovements([{ event_id: "ev-7", sku: "LUMI001", delta: 0 }, { sku: "LUMI001", delta: -1 }]);
eq("zero-delta and missing-id movements answered with silence", r7, { applied: [], ignored: [], unknown_sku: [] });
eq("…51-movement batches are refused outright",
  applyMovements(Array.from({ length: 51 }, (_, i) => ({ event_id: `x${i}`, sku: "LUMI001", delta: -1 }))), null);

/* 8. parse helpers hold the line. */
eq("parseMovement trims and validates", parseMovement({ event_id: " e1 ", sku: " LUMI001 ", delta: -1 }),
  { event_id: "e1", sku: "LUMI001", delta: -1, reason: null, reference: null, occurred_at: null });
eq("fractional delta refused", parseMovement({ event_id: "e", sku: "S", delta: -1.5 }), null);
eq("bad reason refused", parseMovement({ event_id: "e", sku: "S", delta: -1, reason: "refund" }), null);

/* ---- feed C: upsert by order number ---- */
const upsert = (o) => {
  const p = parseWebOrder(o);
  db.prepare(`INSERT INTO web_orders (store, order_number, status, total_cents, store_updated_at)
    VALUES ('elfia', ?, ?, ?, ?)
    ON CONFLICT (store, order_number) DO UPDATE SET status = excluded.status,
      total_cents = excluded.total_cents, store_updated_at = excluded.store_updated_at`)
    .run(p.order_number, p.status, p.total_cents, p.updated_at);
  const row = db.prepare("SELECT id, paid_seen_at FROM web_orders WHERE order_number = ?").get(p.order_number);
  db.prepare("DELETE FROM web_order_lines WHERE order_id = ?").run(row.id);
  for (const l of parseWebOrderLines(p.items)) {
    db.prepare("INSERT INTO web_order_lines (order_id, sku, sku_key, qty, price_cents) VALUES (?, ?, ?, ?, ?)")
      .run(row.id, l.sku, l.sku_key, l.qty, l.price_cents);
  }
  if (isPaidStatus(p.status) && !row.paid_seen_at) {
    db.prepare("UPDATE web_orders SET paid_seen_at = datetime('now') WHERE id = ?").run(row.id);
  }
};
const ORDER = { order_number: "ELF-200826-6", customer_name: "Nurul", items: [{ product_id: 5, name: "Dusty Rose", sku: "LUMI001", qty: 2, price_cents: 4900 }], total_cents: 10800, updated_at: "2026-08-20 12:10:44" };
upsert({ ...ORDER, status: "paid" });
upsert({ ...ORDER, status: "shipped", updated_at: "2026-08-21 09:00:00" });
upsert({ ...ORDER, status: "completed", updated_at: "2026-08-22 09:00:00" });
eq("three status changes → ONE row", db.prepare("SELECT COUNT(*) AS n FROM web_orders").get().n, 1);
eq("…at the latest status", db.prepare("SELECT status FROM web_orders WHERE order_number = 'ELF-200826-6'").get().status, "completed");
eq("…lines replaced, not duplicated", db.prepare("SELECT COUNT(*) AS n FROM web_order_lines").get().n, 1);
eq("…paid_seen_at stamped once and kept", !!db.prepare("SELECT paid_seen_at FROM web_orders").get().paid_seen_at, true);
eq("cancelled is not a paid status", isPaidStatus("cancelled"), false);

/* 9. Web orders NEVER enter salesperson attribution (no live session, no
      shift, nobody's commission). Static check on the shipped source: the
      attribution function must not read web_orders. */
{
  const staffSrc = readFileSync("worker/src/staff.ts", "utf8");
  const start = staffSrc.indexOf("async function attributedSalesByUser");
  const end = staffSrc.indexOf("\nasync function", start + 10);
  const fn = staffSrc.slice(start, end === -1 ? start + 8000 : end);
  eq("attributedSalesByUser never touches web_orders", fn.includes("web_orders"), false);
  /* And the poller never touches stock: bridge.ts's order path must not
     write inventory_items or stock_ledger. */
  const pollStart = bridgeSrc.indexOf("export async function pollElfiaOrders");
  const pollSlice = bridgeSrc.slice(pollStart);
  eq("orders poller never writes inventory_items", /UPDATE inventory_items|INSERT INTO inventory_items/.test(pollSlice), false);
  eq("orders poller never writes stock_ledger", pollSlice.includes("INSERT INTO stock_ledger"), false);
}

/* 10. The pure status thresholds agree with staff.ts's stockStatus. */
{
  const staffSrc = readFileSync("worker/src/staff.ts", "utf8");
  const m = staffSrc.match(/function stockStatus[\s\S]{0,300}/)?.[0] ?? "";
  const lowAt = m.includes("stock <= 5");
  const outAt = m.includes('stock === 0 ? "out_of_stock"');
  eq("staff stockStatus thresholds unchanged (low ≤5, out ≤0)", lowAt && outAt, true);
  eq("bridge thresholds agree", [bridgeStockStatus(0), bridgeStockStatus(3), bridgeStockStatus(9)], ["out_of_stock", "low", "in_stock"]);
}

if (failed) { console.error(`\n${failed} bridge-idempotency check(s) failed.`); process.exit(1); }
console.log("\nbridge-idempotency: all checks passed.");
