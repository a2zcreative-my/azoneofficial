#!/usr/bin/env node
/* Guard #49 — v1.117.0: the Ecommerce tab reads in four zones; v1.119.0: the
 * Inventory tab reads in three, with a phone rendering of the stock rows.
 *
 * The CEO, 06-09-2026: *"Now review on Ecommerce"*, after the Dashboard was
 * reorganised the same way. Eight cards that had been stacked in the order
 * they were written are grouped: THIS MONTH (map with the leaderboard beside
 * it, then Sales revenue and Sales by hour side by side), THE WORK (the order
 * tracker with Fulfilment beside it), THE LONGER VIEW (targets / history /
 * lines, analytics), SETUP (the connection, last - v1.4.217's rule kept).
 *
 *   1. THE ORDER, in the page source.
 *   2. THE PHONE DIFFERS BY ONE CARD: the month's total before the map on a
 *      small screen, done with CSS order on the same tree - not a second
 *      copy of the cards.
 *   3. ONE CAPTION COMPONENT for both tabs (page-shared), so every tab
 *      teaches the same reading habit.
 *   4. NOTHING GATED DIFFERENTLY: the CEO-only analytics stays CEO-only, the
 *      tracker stays visible to every role on the tab, the connection stays
 *      last.
 *
 * Negative-tested by: moving the connection card above the tracker (1);
 * dropping the order classes (2).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const read = (p) => readFileSync(join(root, p), "utf8");
const page = read("app/portal/page.tsx");
const shared = read("components/portal/page-shared.tsx");
const dash = read("components/portal/dashboard.tsx");
const panels = read("components/portal/role-panels.tsx");
let failed = 0, passed = 0;
const ok = (label, cond, why = "") => { if (cond) passed++; else { failed++; console.log(`  ✗ ${label}${why ? ` — ${why}` : ""}`); } };

const a = page.indexOf('{activeTab === "Ecommerce" && (');
const b = page.indexOf('{activeTab === "Assets" &&', a);
const tab = page.slice(a, b);
ok("the Ecommerce block was found", a > 0 && b > a);

/* 1. the order */
const seq = ["<OpsMapCard", "<SalesRevenueCard", "<SalesByHourCard", "<TikTokOrdersCard", "<FulfilmentCard", "<MoneyCard", "<TikTokAnalyticsCard", "<ConnectionStatusCard"];
const pos = seq.map((s) => tab.indexOf(s));
ok("every card is still on the tab", pos.every((x) => x > 0), seq.filter((s, i) => pos[i] < 0).join(","));
ok("map, revenue, by-hour, tracker, fulfilment, long view, analytics, connection - in that order", pos.every((x, i) => i === 0 || x > pos[i - 1]), pos.join(" < "));
ok("the connection is last, as v1.4.217 ordered", pos[7] === Math.max(...pos));
ok("the leaderboard rides in the map's side column", /<OpsMapCard aside=\{<LeaderboardCard user=\{user\} compact \/>\} \/>/.test(tab));
const caps = ["This month", "The work", "The longer view", "Setup"];
ok("the four zones are captioned", caps.every((c) => tab.includes(`<ZoneLabel>{L("${c}"`)), caps.filter((c) => !tab.includes(`<ZoneLabel>{L("${c}"`)).join(","));
ok("revenue and by-hour share a row on the desk, the map spans it", /md:grid-cols-2/.test(tab) && /md:col-span-2/.test(tab));
ok("the tracker is wide and fulfilment beside it", /md:grid-cols-\[minmax\(0,2fr\)_minmax\(0,1fr\)\]/.test(tab));

/* 2. the phone differs by one card, on the same tree */
ok("on the phone the month's total comes before the map, by CSS order", /className="order-1 md:order-2"><SalesRevenueCard \/>/.test(tab) && /className="order-2 md:order-1 md:col-span-2">\s*<OpsMapCard/.test(tab),
   "a second copy of the cards for the phone would be two trees to keep in step");
ok("...and the cards appear once each", seq.every((s) => tab.split(s).length === 2));

/* 3. one caption component */
ok("ZoneLabel lives in page-shared and both tabs use it", /export function ZoneLabel\(/.test(shared) && /ZoneLabel/.test(dash) && !/^function ZoneLabel\(/m.test(dash) && tab.includes("<ZoneLabel>"));

/* 4. gates */
ok("analytics stays CEO-only", /\["ceo", "super_admin"\]\.includes\(user\.role\) && <TikTokAnalyticsCard \/>/.test(tab));
ok("the tracker is not behind the revenue gate", !/REVENUE_ROLES\.includes\(user\.role\) && \(?\s*<TikTokOrdersCard/.test(tab) && /<TikTokOrdersCard/.test(tab));
ok("fulfilment, the map, revenue and the long view stay behind it", /REVENUE_ROLES\.includes\(user\.role\) && <FulfilmentCard \/>/.test(tab) && /REVENUE_ROLES\.includes\(user\.role\) && \(\s*<section[\s\S]{0,120}?This month/.test(tab) && /REVENUE_ROLES\.includes\(user\.role\) && \(\s*<section[\s\S]{0,160}?The longer view/.test(tab));

/* ---- v1.119.0: Inventory - three zones, and one data source for two renderings ---- */
{
  const s = panels.indexOf("export function InventoryPanel(");
  const inv = panels.slice(s, panels.indexOf("\n}\n", s));
  ok("the Inventory panel was found", s > 0);
  const caps = ["Stock now", "Record", "What moved"];
  const cpos = caps.map((c) => inv.indexOf(`<ZoneLabel>{L("${c}"`));
  ok("Inventory has its three zones, in order", cpos.every((x) => x > 0) && cpos[0] < cpos[1] && cpos[1] < cpos[2], cpos.join(" < "));
  ok("the status strip rides beside the bridge pulse, passed in by the page", /\{statusCard\}/.test(inv) && /statusCard=\{MANAGE_ROLES\.includes\(user\.role\) \? <InventoryStatusCard \/> : undefined\}/.test(page));
  const order = ["Inventory — live status & stock", "Supplier returns", "Postage tracking", "TikTok Live — stock out", "Manual stock movements"].map((t) => inv.indexOf(t));
  ok("table, then the two forms, then the two histories", order.every((x) => x > 0) && order.every((x, i) => i === 0 || x > order[i - 1]), order.join(" < "));
  ok("the table and the phone list draw from ONE filtered list", inv.split("{visibleItems.map((it) => (").length === 3 && !/\{sortedItems\.map\(\(it\) => \(/.test(inv),
     "two lists from two sources can disagree about what is in stock");
  ok("the phone list is phone-only and the table desk-only", /<ul className="[^"]*md:hidden">\s*\{visibleItems\.map/.test(inv) && /<div className="mt-3 hidden max-h-96 overflow-x-auto overflow-y-auto pr-1 md:block">/.test(inv));
  const inCalls = inv.split('setOutModal({ dir: "in", edit_id: null, item_id: it.id').length - 1;
  const outCalls = inv.split('setOutModal({ dir: "out", edit_id: null, item_id: it.id').length - 1;
  ok("In / Out on the phone are the table's own handlers", inCalls === 2 && outCalls === 2, `${inCalls} in, ${outCalls} out`);
  ok("the find box and the Low / Out chips filter the same list", /invQ/.test(inv) && /invFilter === "all" \|\|/.test(inv) && /\["low", L\("Low"/.test(inv) && /\["out", L\("Out"/.test(inv));
  ok("the add-item form is behind a button", /\{addOpen && \(/.test(inv) && /L\("\+ Add item", "\+ Tambah barang"\)/.test(inv));
  ok("a filter that leaves nothing says so", /Nothing is low\./.test(inv) && /Nothing is out of stock\./.test(inv));
}

if (failed) { console.log(`\n${failed} check(s) failed.`); process.exit(1); }
console.log(`PASS — Ecommerce reads in four zones and Inventory in three, with one stock list behind both the table and the phone cards (${passed} checks)`);
