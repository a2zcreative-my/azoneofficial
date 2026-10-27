#!/usr/bin/env node
/* Guard - v1.212.0: ONE ORDER RECORD. ONE AUTHORITATIVE STOCK SOURCE.
 * CONSISTENT SALES DATA. ZERO DUPLICATION.
 *
 * The owner's Ecommerce brief, 26-10-2026, and his four answers to the audit:
 * build as proposed; one shared TikTok status mapping; a paged TikTok read;
 * fulfilment counts TikTok orders only. So this guard holds:
 *
 *   1. ONE MAPPING. The sync and the webhook read TikTok's status through one
 *      function (tiktokUiStatus), and it maps the words and codes it must
 *      (run here, not just read); a live update never overwrites returned.
 *   2. THE SIGNATURE STAYS. An unverified webhook is still refused with 401
 *      before anything is written to an order.
 *   3. THE PAGED READ is read-only, TikTok only, the same permission, a
 *      bounded page, and the search is a literal (instr), not a pattern.
 *   4. TIKTOK ONLY. Every read in /fulfilment/summary takes order_ref 'TT-%'.
 *   5. ONE RECORD ON THE PAGE. The orders views read /staff/postage (paged)
 *      and nothing else of an order; the stock view reads Inventory's two
 *      lists and writes nothing; the one write is the sync, run by one hook,
 *      guarded against a double press.
 *   6. NO SECRET, NO SETUP WORDING FOR EVERYONE. No secret name, wrangler
 *      step or app id in the Ecommerce files; the connection card's setup
 *      text is behind `technical` (the server's webhook-debug roles).
 *   7. HONEST LABELS: recorded vs paid, order total, returned/cancelled,
 *      on hand after orders.
 *   8. THE PHONE: cards and table are one list; the order view is the whole
 *      screen (SideDrawer full).
 *
 * Negative-tested by: an inline status mapping back in the webhook (1); the
 * returned guard dropped (1); "transit" removed from the mapping (1); the 401
 * removed (2); a LIKE search (3); an UPDATE in the paged branch (3); a
 * summary read without TT- (4); a POST from the orders file (5); a second
 * sync hook (5); the app id back in the card (6); "Order total" relabelled
 * (7); a second rows list for the cards (8).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");
let failed = 0, passed = 0;
const ok = (label, cond, why = "") => { if (cond) passed++; else { failed++; console.log(`  ✗ ${label}${why ? ` — ${why}` : ""}`); } };
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

const idx = read("worker/src/index.ts");
const staff = read("worker/src/staff.ts");
const orders = read("components/portal/tiktok-orders.tsx");
const ordersCode = strip(orders);
const panel = read("components/portal/ecommerce-panel.tsx");
const panelCode = strip(panel);
const stock = read("components/portal/ecommerce-stock.tsx");
const stockCode = strip(stock);
const connCard = read("components/portal/connection-status-card.tsx");

/* ---- 1. one mapping ---- */
{
  const at = idx.indexOf("function tiktokUiStatus(");
  ok("tiktokUiStatus is defined once", at > 0 && idx.split("function tiktokUiStatus(").length === 2);
  const body = at > 0 ? idx.slice(idx.indexOf("{", idx.indexOf(")", at) + 1), idx.indexOf("\n}\n", at) + 2) : "";
  let fn = null;
  try { fn = new Function("raw", body.replace(/^\{/, "").replace(/\}\s*$/, "")); } catch (e) { ok("the mapping compiles as plain JS", false, String(e)); }
  if (fn) {
    const cases = [
      ["AWAITING_SHIPMENT", "preparing"], ["AWAITING_COLLECTION", "preparing"], ["UNPAID", "preparing"], ["111", "preparing"], ["112", "preparing"],
      ["IN_TRANSIT", "shipped"], ["PARTIALLY_SHIPPING", "shipped"], ["121", "shipped"],
      ["DELIVERED", "delivered"], ["COMPLETED", "delivered"], ["122", "delivered"], ["130", "delivered"],
      ["CANCELLED", "returned"], ["CANCEL", "returned"], ["RETURNED", "returned"], ["REFUNDED", "returned"], ["140", "returned"],
      ["", null], [null, null],
    ];
    const bad = cases.filter(([i, o]) => fn(i) !== o).map(([i, o]) => `${i}→${fn(i)} (want ${o})`);
    ok("the mapping answers every TikTok status the way the sync always did (plus the numeric codes)", bad.length === 0, bad.join(", "));
  }
  ok("the sync asks it", /const uiNow = tiktokUiStatus\(stNow\);/.test(idx) && !/const uiNow =\s*\n\s*!stNow \? null/.test(idx));
  const wh = idx.slice(idx.indexOf('path === "/api/v1/integrations/tiktok/webhook" && method === "POST"'), idx.indexOf("/* ---- Threads account connection"));
  ok("the webhook's update asks it too, and never overwrites returned",
     /const uiStatus = tiktokUiStatus\(rawStatus\);/.test(wh) && /if \(uiStatus && uiStatus !== "returned"\)/.test(wh)
     && /UPDATE postage_records SET status = \?1, updated_at = datetime\('now'\) WHERE id = \?2 AND status != 'returned'/.test(wh)
     && !/rawStatus\.includes\("ship"\) \? "shipped"/.test(wh));
  ok("the sync's own update still keeps returned", /status = COALESCE\(\?1,\s*status\)[\s\S]{0,300}?WHERE id = \?5 AND status != 'returned'/.test(idx));
}

/* ---- 2. the signature stays ---- */
{
  const wh = idx.slice(idx.indexOf('path === "/api/v1/integrations/tiktok/webhook" && method === "POST"'), idx.indexOf("/* ---- Threads account connection"));
  const refuse = wh.indexOf('if (!verified) {\n      return errorResponse("unauthorized", "Signature verification failed", 401);');
  ok("an unverified webhook is refused with 401 before any order write", refuse > 0 && refuse < wh.indexOf("INSERT OR IGNORE INTO postage_records") && refuse < wh.indexOf("UPDATE postage_records"));
}

/* ---- 3. the paged read ---- */
{
  const r = staff.indexOf('if (path === "/postage" && method === "GET") {');
  const route = staff.slice(r, staff.indexOf('if (path === "/postage" && method === "POST")'));
  const b = route.indexOf('if (pq.get("source") === "tiktok") {');
  const branch = b > 0 ? route.slice(b, route.indexOf("return json({ records: results, total, page, per, counts });") + 10) : "";
  ok("the paged branch sits inside the route's own permission check", r > 0 && b > route.indexOf('if (!can(user.role, "inventory") && !can(user.role, "exec_view"))'));
  ok("it reads TikTok orders only, a bounded page", /p\.order_ref LIKE 'TT-%'/.test(branch) && /Math\.min\(50, Math\.max\(5,/.test(branch) && /LIMIT \$\{per\} OFFSET \$\{\(page - 1\) \* per\}/.test(branch));
  ok("it is read-only", branch.length > 500 && !/\b(INSERT|UPDATE|DELETE|REPLACE)\b/.test(branch));
  ok("the typed search is a literal (instr), never a LIKE pattern", /instr\(lower\(p\.order_ref\), \?1\) > 0/.test(branch) && !/LIKE \?/.test(branch));
  ok("the status filter is one of the five", /\(POSTAGE_STATUSES as readonly string\[\]\)\.includes\(statusQ\) \? statusQ : ""/.test(branch));
  ok("it answers the real count per status and the orders that moved no stock", /GROUP BY p\.status/.test(branch) && /counts\.no_stock = /.test(branch));
  ok("without ?source the old answer is unchanged", /ORDER BY p\.updated_at DESC LIMIT 200`,\s*\)\.all\(\);\s*return json\(\{ records: results \}\);/.test(route));
}

/* ---- 4. fulfilment: TikTok orders only ---- */
{
  const f = staff.slice(staff.indexOf('if (path === "/fulfilment/summary" && method === "GET")'), staff.indexOf("/* ================= v1.4.213: company asset register"));
  const reads = f.match(/FROM postage_records\s+WHERE [^`]*/g) ?? [];
  ok("every read in the fulfilment summary takes TikTok orders only", reads.length === 3 && reads.every((q) => /order_ref LIKE 'TT-%'/.test(q)), reads.map((q) => q.slice(0, 60)).join(" | "));
}

/* ---- 5. one record on the page ---- */
{
  const staffReads = [...ordersCode.matchAll(/useCachedApi<[^>]*>\(\s*`([^`]+)`/g)].map((m) => m[1]);
  ok("the orders views read the paged /staff/postage and nothing else of an order", staffReads.length === 1 && /^\/staff\/postage\?\$\{qs\.toString\(\)\}$/.test(staffReads[0]) && /source: "tiktok"/.test(ordersCode));
  const integ = [...ordersCode.matchAll(/tiktokApi<[^>]*>\("([^"]+)"/g)].map((m) => m[1]);
  ok("…and the integration's /status and /sync", JSON.stringify([...new Set(integ)].sort()) === JSON.stringify(["/status", "/sync"]), integ.join(","));
  ok("the only write is the sync's POST", (ordersCode.match(/method: "(POST|PUT|PATCH|DELETE)"/g) ?? []).join() === 'method: "POST"' && /tiktokApi<[^>]*>\("\/sync", \{ method: "POST", body: "\{\}" \}\)/.test(ordersCode));
  ok("pressed twice is one sync", /if \(!canSync \|\| busyRef\.current\) return;/.test(ordersCode) && /busyRef\.current = true;/.test(ordersCode));
  ok("one sync hook on the page, and the header and the Sync tab both press it",
     (panelCode.match(/useTikTokSync\(/g) ?? []).length === 1 && (panelCode.match(/onClick=\{\(\) => void tt\.sync\(\)\}/g) ?? []).length === 2 && !/azone:tiktok-sync"/.test(panelCode + ordersCode));
  ok("the map and the states still hear a finished sync", /window\.dispatchEvent\(new Event\("azone:tiktok-synced"\)\)/.test(ordersCode));
  const stockReads = [...stockCode.matchAll(/"(\/staff\/[^"]+)"/g)].map((m) => m[1]);
  ok("the stock view reads Inventory's own two lists and writes nothing",
     JSON.stringify([...new Set(stockReads)].sort()) === JSON.stringify(["/staff/inventory", "/staff/inventory/tiktok-out"]) && !/method:|csrfFetch|api\(/.test(stockCode));
  ok("nothing on the page writes an order, a stock movement or a sale", !/method:|csrfFetch/.test(panelCode));
  ok("the order view offers no command (a status is TikTok's)", (() => { const d = ordersCode.slice(ordersCode.indexOf("export function OrderDrawer("), ordersCode.indexOf("function OrderCard(")); return d.length > 300 && !/<button/.test(d) && !/footer=/.test(d); })());
}

/* ---- 6. no secret, and the setup wording for management only ---- */
{
  const files = orders + panel + stock;
  ok("no secret name, wrangler step or app id in the Ecommerce files", !/TIKTOK_APP_SECRET|TIKTOK_WEBHOOK_SECRET|wrangler|\b\d{17,19}\b/.test(files.replace(/TT-\d+/g, "")));
  ok("the connection card prints no app id", !/7668934538403645205/.test(connCard));
  ok("the card's setup wording is behind `technical`, which is the server's webhook-debug roles",
     /export function ConnectionStatusCard\(\{ technical = false \}/.test(connCard)
     && /if \(st\.last_event_verified === false && !technical\) return \(/.test(connCard)
     && /export const TECH_ROLES: readonly string\[\] = \["ceo", "coo", "admin", "super_admin"\];/.test(orders)
     && /if \(!me \|\| !\["ceo", "coo", "admin", "super_admin"\]\.includes\(me\.role\)\)/.test(idx)
     && /<ConnectionStatusCard technical=\{tt\.technical\} \/>/.test(panel));
  ok("a failed sync shows the server's words only to management", /: technical && res\.data\?\.error\?\.message\s*\? res\.data\.error\.message/.test(ordersCode));
}

/* ---- 7. honest labels ---- */
ok("recorded is not paid, and says so", /When the portal stored the order - not TikTok's payment time\./.test(orders));
ok("the order total is TikTok's payment total, and returned is out of revenue", /<dt>\{L\("Order total", "Jumlah pesanan"\)\}<\/dt>/.test(orders) && /Returned or cancelled - not counted in revenue\./.test(orders));
ok("returned is named with what it covers", /\["returned", "Returned \/ cancelled"/.test(orders));
ok("on hand is after orders, and nothing is reserved", /On hand is after orders/.test(stock) && /Nothing is reserved separately/.test(stock));
ok("the tiles say what they count", /Order totals · returned & cancelled excluded/.test(panel) && /TikTok, by date recorded/.test(panel));
ok("the fulfilment card says TikTok", /TikTok orders recorded in/.test(read("components/portal/fulfilment-card.tsx")));

/* ---- 8. the phone ---- */
ok("cards and table draw one list", (ordersCode.match(/\{rows\.map\(\(o\) =>/g) ?? []).length === 2 && /const rows = data\.records;/.test(ordersCode));
ok("the order view is the whole screen on a phone", /<SideDrawer open=\{!!o\} onClose=\{onClose\} full/.test(ordersCode) && /\.erp-drawer-full \{ height: 100vh; height: 100dvh;/.test(read("styles/erp-v3.css")));

ok("no sample figures from the mockup", !/RM\s?\d/.test(panelCode + ordersCode + stockCode));
ok("the guard is registered", /\["ecommerce-module", "/.test(read("scripts/run-guards.mjs")));

console.log(`  ${passed} check(s) passed.`);
if (failed) { console.log(`\n${failed} check(s) failed.`); process.exit(1); }
