#!/usr/bin/env node
/* Guard #47 — v1.113.0: the Sales map, and the state read out of an address.
 *
 * The CEO, 05-09-2026: *"on Sales tabs should add Sales mapped like ecommerce
 * or hotel type for me to monitor on the sales state location and revenue by
 * states."* Neither an invoice nor a web order carries a state, so the map
 * is only as honest as the reader that finds one in free text. RUN here:
 *
 *   1. THE READER, on addresses as people actually write them: full form,
 *      postcode only, "KL", "Penang", "N. Sembilan", a street named after
 *      another state ("Jalan Kelantan, 50480 Kuala Lumpur"), the Genting
 *      outlier, and text with no state at all - which must be null, never a
 *      guess.
 *   2. THE POSTCODE TABLE: every first-two-digit block that Pos Malaysia
 *      allocates lands on its state; the gaps (03, 04, 19, 29, 37, 38, 61,
 *      65-67, 74, 92, 99) are null.
 *   3. THE AGGREGATE: sixteen states plus an "unplaced" bucket; money that
 *      cannot be placed is counted there, not dropped - the totals equal the
 *      sum of the inputs exactly.
 *   4. THE RANGE begins on the Malaysian calendar, not UTC.
 *   5. THE WIRING: the route behind revenue_view, orders counted only when
 *      the portal saw them PAID (the same fact as Finance), invoices placed
 *      by the customer's address, the panel first on the Sales tab and lazy,
 *      the same geometry as the other maps, the unplaced line shown.
 *
 * Negative-tested by: trusting a state name over a later postcode (1 - the
 * Jalan Kelantan case fails); dropping unplaced rows (3 - the totals no
 * longer equal the inputs); using UTC for the range (4).
 */
import { readFileSync, mkdtempSync } from "node:fs";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = new URL("..", import.meta.url).pathname;
const read = (p) => readFileSync(join(root, p), "utf8");
const src = read("worker/src/sales-map.ts");
const staff = read("worker/src/staff.ts");
const panel = read("components/portal/sales-map.tsx");
const page = read("app/portal/page.tsx");
const lazy = read("components/portal/lazy-panels.tsx");
const geometry = read("lib/malaysia-map.ts");

let failed = 0, passed = 0;
const ok = (label, cond, why = "") => {
  if (cond) passed++; else { failed++; console.log(`  ✗ ${label}${why ? ` — ${why}` : ""}`); }
};

const dir = mkdtempSync(join(tmpdir(), "smap-"));
const out = join(dir, "my-state.mjs");
execSync(`npx esbuild ${join(root, "worker/src/my-state.ts")} --bundle --format=esm --platform=neutral --outfile=${out} --log-level=error`, { cwd: root, stdio: "inherit" });
const S = await import(pathToFileURL(out).href);
/* the aggregator, with shared/permissions stubbed so only the pure parts load */
const { writeFileSync } = await import("node:fs");
writeFileSync(join(dir, "shared.js"), `export function json(d, s = 200) { return new Response(JSON.stringify(d), { status: s }); } export function err(c, m, s) { return json({ error: { code: c, message: m } }, s); }`);
writeFileSync(join(dir, "permissions.js"), `export function can(role) { return role === "ceo"; }`);
writeFileSync(join(dir, "sales-map.ts"), src.replace('from "./shared"', `from "${join(dir, "shared.js")}"`).replace('from "./permissions"', `from "${join(dir, "permissions.js")}"`).replace('from "./my-state"', `from "${join(root, "worker/src/my-state.ts")}"`));
const out2 = join(dir, "sales-map.mjs");
execSync(`npx esbuild ${join(dir, "sales-map.ts")} --bundle --format=esm --platform=neutral --external:*/shared.js --external:*/permissions.js --outfile=${out2} --log-level=error`, { cwd: root, stdio: "inherit" });
const M = await import(pathToFileURL(out2).href);

/* ---- 1. the reader ---- */
{
  const f = S.stateFromAddress;
  const cases = [
    ["No 12, Jalan Setia 3/4, Setia Alam, 40170 Shah Alam, Selangor", "SELANGOR"],
    ["Lot 5, Jalan Kelantan, 50480 Kuala Lumpur", "KUALA LUMPUR"],
    ["Jalan Kelantan, 50480", "KUALA LUMPUR"],
    ["23 Lorong Bunga, Taman Sri, 11900 Bayan Lepas, Penang", "PULAU PINANG"],
    ["Blok B-3-2, Presint 9, 62250 Putrajaya", "PUTRAJAYA"],
    ["45 Jalan Dato Onn, 80000 Johor Bahru", "JOHOR"],
    ["Kg Baru, 70100 Seremban, N. Sembilan", "NEGERI SEMBILAN"],
    ["Genting Highlands Resort, 69000", "PAHANG"],
    ["12 Jalan Wangsa Delima, Wangsa Maju, KL", "KUALA LUMPUR"],
    ["Lorong 3, 93350 Kuching", "SARAWAK"],
    ["Jalan Tuaran, Kota Kinabalu 88300", "SABAH"],
    ["Lot 88, Bandar Labuan, 87000 W.P. Labuan", "LABUAN"],
    ["Trengganu 20000 Kuala Terengganu", "TERENGGANU"],
    ["Jalan Melaka 2, 84000 Muar, Johor", "JOHOR"],
    ["Taman Universiti", null],
    ["Phone 0123456789", null],
    ["", null], [null, null], [undefined, null],
  ];
  for (const [a, want] of cases) ok(`reads ${JSON.stringify(a)} as ${want}`, f(a) === want, `got ${f(a)}`);
  ok("every name the reader returns is in the geometry", S.MY_STATE_NAMES.every((n) => geometry.includes(`name: "${n.split(" ").map((w) => w[0] + w.slice(1).toLowerCase()).join(" ")}"`)), S.MY_STATE_NAMES.join(","));
}

/* ---- 2. the postcode table ---- */
{
  const p = S.stateFromPostcode;
  const table = [
    ["01000", "PERLIS"], ["02600", "PERLIS"], ["05000", "KEDAH"], ["09000", "KEDAH"], ["10000", "PULAU PINANG"], ["14000", "PULAU PINANG"],
    ["15000", "KELANTAN"], ["18000", "KELANTAN"], ["20000", "TERENGGANU"], ["24000", "TERENGGANU"], ["25000", "PAHANG"], ["28000", "PAHANG"],
    ["30000", "PERAK"], ["36000", "PERAK"], ["40000", "SELANGOR"], ["48000", "SELANGOR"], ["63000", "SELANGOR"], ["64000", "SELANGOR"], ["68100", "SELANGOR"],
    ["50000", "KUALA LUMPUR"], ["60000", "KUALA LUMPUR"], ["62000", "PUTRAJAYA"], ["70000", "NEGERI SEMBILAN"], ["73000", "NEGERI SEMBILAN"],
    ["75000", "MELAKA"], ["78000", "MELAKA"], ["79000", "JOHOR"], ["86000", "JOHOR"], ["87000", "LABUAN"], ["88000", "SABAH"], ["91000", "SABAH"],
    ["93000", "SARAWAK"], ["98000", "SARAWAK"], ["39000", "PAHANG"], ["49000", "PAHANG"], ["69000", "PAHANG"],
  ];
  for (const [c, want] of table) ok(`postcode ${c} is ${want}`, p(c) === want, `got ${p(c)}`);
  for (const gap of ["03000", "04000", "19000", "29000", "37000", "38000", "61000", "65000", "67000", "74000", "92000", "99000"]) ok(`postcode ${gap} is unallocated`, p(gap) === null);
  ok("not five digits is not a postcode", p("1234") === null && p("123456") === null && p("abcde") === null);
}

/* ---- 3. the aggregate ---- */
{
  const inv = [
    { total_cents: 100_00, payment_status: "paid", address: "40170 Shah Alam, Selangor" },
    { total_cents: 250_00, payment_status: "unpaid", address: "50480 Kuala Lumpur" },
    { total_cents: 75_00, payment_status: "paid", address: "Taman Universiti" },
    { total_cents: 30_00, payment_status: null, address: null },
  ];
  const ord = [{ cents: 59_90, address: "Bayan Lepas, Penang" }, { cents: 89_90, address: "somewhere" }];
  const a = M.aggregate(inv, ord);
  ok("sixteen states are always present", Object.keys(a.states).length === 16);
  ok("Selangor: one invoice, RM 100 invoiced and paid", a.states.SELANGOR.invoices === 1 && a.states.SELANGOR.invoiced_cents === 100_00 && a.states.SELANGOR.paid_cents === 100_00);
  ok("Kuala Lumpur: RM 250 invoiced, nothing paid", a.states["KUALA LUMPUR"].invoiced_cents === 250_00 && a.states["KUALA LUMPUR"].paid_cents === 0);
  ok("the two unplaceable invoices are counted as unplaced, not dropped", a.unplaced.invoices === 2 && a.unplaced.invoiced_cents === 105_00 && a.unplaced.paid_cents === 75_00);
  ok("orders place by the shipping address", a.states["PULAU PINANG"].orders === 1 && a.states["PULAU PINANG"].order_cents === 59_90 && a.unplaced.orders === 1);
  const sumStates = (k) => Object.values(a.states).reduce((x, c) => x + c[k], 0);
  for (const k of ["invoices", "invoiced_cents", "paid_cents", "orders", "order_cents"]) {
    ok(`totals.${k} = states + unplaced exactly`, a.totals[k] === sumStates(k) + a.unplaced[k], `${a.totals[k]} vs ${sumStates(k)} + ${a.unplaced[k]}`);
  }
  ok("the totals equal the inputs", a.totals.invoiced_cents === 455_00 && a.totals.order_cents === 149_80 && a.totals.invoices === 4 && a.totals.orders === 2);
  const none = M.aggregate([], []);
  ok("no data is sixteen zeros, not an error", Object.values(none.states).every((c) => c.invoices === 0 && c.orders === 0) && none.totals.invoiced_cents === 0);
}

/* ---- 4. the range ---- */
{
  /* 01-09-2026 01:30 MYT is still 31-08-2026 17:30 UTC: the Malaysian month
     is September while UTC says August - the case that tells the two apart */
  const now = new Date("2026-08-31T17:30:00Z");
  ok("this month begins on the 1st, Malaysian time", M.rangeStart("month", now) === "2026-08-31 16:00:00", M.rangeStart("month", now));
  const newYear = new Date("2025-12-31T17:30:00Z"); // 01-01-2026 01:30 MYT
  ok("this year begins on 1 January, Malaysian time", M.rangeStart("year", newYear) === "2025-12-31 16:00:00", M.rangeStart("year", newYear));
  ok("all time has no start", M.rangeStart("all", now) === null);
  ok("the ranges the panel offers are the server's", JSON.stringify([...M.RANGES]) === JSON.stringify(["month", "year", "all"])
     && ["month", "year", "all"].every((k) => panel.includes(`key: "${k}"`)));
}

/* ---- 5. the wiring ---- */
{
  ok("the route is behind revenue_view", /can\(user\.role, "revenue_view"\)/.test(src));
  ok("...and has a door in staff.ts", /path === "\/sales\/map" && method === "GET"/.test(staff) && /handleSalesMap\(env, user/.test(staff));
  ok("orders count only when the portal saw them paid, at the booked amount", /FROM web_orders WHERE paid_seen_at IS NOT NULL/.test(src) && /COALESCE\(booked_cents, total_cents\)/.test(src),
     "revenue on the map must be the revenue Finance shows");
  ok("invoices are placed by the customer's address", /FROM sales_documents d JOIN customers c ON c\.id = d\.customer_id/.test(src) && /d\.doc_type = 'INV'/.test(src));
  ok("the panel is lazy and leads the Sales tab", /SalesMap = lazy\(/.test(lazy) && /<SalesMap \/>\s*<Sales user=\{user\} \/>/.test(page));
  ok("the panel draws the shared geometry in the house language", /from "@\/lib\/malaysia-map"/.test(panel) && /var\(--gold-solid\)/.test(panel) && /var\(--brand-primary\)/.test(panel) && /strokeDasharray="3 5"/.test(panel));
  ok("the panel has both layers and shows the unplaced line", /\["invoices", "orders"\] as const/.test(panel) && /could not be placed/.test(panel));
  ok("the panel is remembered and live on what moves a sale", /useCachedApi<Data>\(`\/staff\/sales\/map\?range=\$\{range\}`, true, \["docs", "clients", "orders", "web-orders"\]\)/.test(panel));
  ok("invoiced and paid are told apart on the panel", /paid_cents\)\} \$\{L\("paid"/.test(panel) && /L\("unpaid", "belum dibayar"\)/.test(panel));
}

if (failed) { console.log(`\n${failed} check(s) failed.`); process.exit(1); }
console.log(`PASS — the map places every ringgit it can and says what it could not (${passed} checks)`);
