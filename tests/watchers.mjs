#!/usr/bin/env node
/* Guard #43 — v1.108.0 (roadmap phase 04c): Watchers.
 *
 * Rules over the company's data, checked hourly, pushed once. The runner is
 * RUN here against a fake database and a recording notify(), because the two
 * ways this goes wrong are both about repetition: a finding pushed every hour
 * until fixed is a bell people mute, and a finding never cleared is a bell
 * that lies once it is fixed.
 *
 *   1. PUSHED ONCE. The same findings on two consecutive runs push on the
 *      first run only. A finding that disappears is cleared; if it returns
 *      it is pushed again. A watcher switched off is not checked. A watcher
 *      that throws is named and the others still run.
 *   2. THE DATES ARE READ. The hotel workbook wrote validity as dd.mm.yyyy
 *      by hand; isoDate reads that, ISO, and refuses everything else.
 *   3. THE BRIEF IS PERSONAL. Each executive is told how many things wait
 *      on THEM, from the desk, not a company total.
 *   4. THE WIRING: hourly on the :00 tick, the 08:00 MYT cron in
 *      wrangler.toml with a branch, every watcher's tab real, every audience
 *      role real, the card after the desk, CEO-only rule changes, audited.
 *
 * Negative-tested by: dropping the `known.has` check (1 - pushed twice);
 * removing the stale sweep (1 - never cleared); accepting only ISO in isoDate
 * (2); using a company count in the brief (3).
 */
import { readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = new URL("..", import.meta.url).pathname;
const read = (p) => readFileSync(join(root, p), "utf8");
const src = read("worker/src/watchers.ts");
const index = read("worker/src/index.ts");
const staff = read("worker/src/staff.ts");
const toml = read("worker/wrangler.toml");
const card = read("components/portal/watchers-card.tsx");
const page = read("app/portal/page.tsx");
const perms = read("worker/src/permissions.ts");
const tabsSrc = read("lib/portal-tabs.ts");

let failed = 0, passed = 0;
const ok = (label, cond, why = "") => {
  if (cond) passed++; else { failed++; console.log(`  ✗ ${label}${why ? ` — ${why}` : ""}`); }
};

/* ---- bundle with the three heavy imports stubbed ---- */
const dir = mkdtempSync(join(tmpdir(), "watch-"));
writeFileSync(join(dir, "staff.js"), "export const notified = []; export async function notify(env, userId, kind, message, ref) { notified.push({ userId, kind, message, ref }); }");
writeFileSync(join(dir, "desk.js"), "export let deskByUser = {}; export function setDesk(m) { deskByUser = m; } export async function deskItems(env, user) { const items = deskByUser[user.id] ?? []; return { items, counts: {}, missing: [] }; }");
writeFileSync(join(dir, "shared.js"), "export const bumps = []; export async function bumpVersion(env, topic) { bumps.push(topic); }");
const rewritten = src
  .replace('from "./staff"', `from "${join(dir, "staff.js")}"`)
  .replace('from "./desk"', `from "${join(dir, "desk.js")}"`)
  .replace('from "./shared"', `from "${join(dir, "shared.js")}"`);
writeFileSync(join(dir, "watchers.ts"), rewritten);
const out = join(dir, "watchers.mjs");
/* the stubs stay EXTERNAL so the bundle imports the same module instances
   this file reads `notified` and `setDesk` from - inlined, they would be
   private copies and the recorder would see nothing */
execSync(`npx esbuild ${join(dir, "watchers.ts")} --bundle --format=esm --platform=neutral --outfile=${out} --log-level=error --external:*/staff.js --external:*/desk.js --external:*/shared.js`, { cwd: root, stdio: "inherit" });
const W = await import(pathToFileURL(out).href);
const { notified } = await import(pathToFileURL(join(dir, "staff.js")).href);
const deskStub = await import(pathToFileURL(join(dir, "desk.js")).href);

/* A fake D1: tables as arrays, SQL recognised by shape. */
function fakeEnv(fixture) {
  const open = new Map(); // ref -> row
  const settings = fixture.settings ?? [];
  const exec = (sql, binds) => {
    if (/FROM watcher_settings/.test(sql)) return { all: settings, first: null };
    if (/SELECT ref FROM watcher_open/.test(sql)) return { all: [...open.values()].map((r) => ({ ref: r.ref })) };
    if (/SELECT ref, watcher, title, first_seen FROM watcher_open/.test(sql)) return { all: [...open.values()] };
    if (/INSERT OR IGNORE INTO watcher_open/.test(sql)) { if (!open.has(binds[0])) open.set(binds[0], { ref: binds[0], watcher: binds[1], title: binds[2], first_seen: "2026-09-05 00:00:00" }); return {}; }
    if (/UPDATE watcher_open SET last_seen/.test(sql)) return {};
    if (/DELETE FROM watcher_open WHERE ref/.test(sql)) { open.delete(binds[0]); return {}; }
    if (/FROM inventory_items/.test(sql)) return { all: (fixture.stock ?? []).filter((r) => r.stock <= binds[0]) };
    if (/FROM web_orders WHERE status = 'paid'/.test(sql)) return { all: fixture.orders ?? [] };
    if (/FROM claims c JOIN users u/.test(sql)) return { all: fixture.claims ?? [] };
    if (/FROM hotels/.test(sql)) return { all: fixture.hotels ?? [] };
    if (/FROM assets/.test(sql)) return { all: fixture.assets ?? [] };
    if (/FROM leave_requests l JOIN users u/.test(sql)) return { all: fixture.leave ?? [] };
    if (/SELECT id FROM users WHERE is_active = 1 AND role IN/.test(sql)) return { all: (fixture.users ?? []).filter((u) => binds.includes(u.role)).map((u) => ({ id: u.id })) };
    if (/FROM users WHERE is_active = 1 AND role IN \('ceo', 'coo', 'cco'\)/.test(sql)) return { all: (fixture.users ?? []).filter((u) => ["ceo", "coo", "cco"].includes(u.role)) };
    if (/COUNT\(DISTINCT user_id\)/.test(sql)) return { first: { c: fixture.clockedIn ?? 0 } };
    if (/COUNT\(\*\) AS c FROM users/.test(sql)) return { first: { c: fixture.headcount ?? 0 } };
    if (/SUM\(COALESCE\(booked_cents/.test(sql)) return { first: { c: fixture.yesterdayCents ?? 0 } };
    if (/COUNT\(\*\) AS c FROM web_orders/.test(sql)) return { first: { c: fixture.yesterdayOrders ?? 0 } };
    if (/COUNT\(\*\) AS c FROM watcher_open/.test(sql)) return { first: { c: open.size } };
    throw new Error(`fake db: unrecognised sql: ${sql.slice(0, 80)}`);
  };
  const env = {
    DB: {
      prepare: (sql) => {
        const mk = (binds) => ({
          all: async () => ({ results: exec(sql, binds).all ?? [] }),
          first: async () => exec(sql, binds).first ?? null,
          run: async () => { exec(sql, binds); return {}; },
        });
        return { ...mk([]), bind: (...binds) => mk(binds) };
      },
    },
    _open: open,
  };
  return env;
}

/* ---- 1. pushed once ---- */
{
  const fixture = {
    users: [{ id: 1, role: "ceo" }, { id: 2, role: "coo" }, { id: 3, role: "hr_admin" }, { id: 9, role: "live_host" }],
    stock: [{ id: 17, sku: "EL-01", name: "Serum", stock: 2 }, { id: 18, sku: "EL-02", name: "Toner", stock: 40 }],
    orders: [{ id: 1042, order_number: "1042", customer_name: "Aina", since: "2026-09-01 00:00:00" }],
  };
  const env = fakeEnv(fixture);
  notified.length = 0;
  const r1 = await W.runWatchers(env);
  ok("the first run pushes each finding once", r1.pushed === 2, `pushed ${r1.pushed}`);
  ok("only stock under the line is a finding", env._open.has("stock:17") && !env._open.has("stock:18"));
  ok("the audience is the watcher's roles, not everyone",
     notified.filter((n) => n.ref === "watch:stock:17").map((n) => n.userId).sort().join(",") === "1,2"
     && !notified.some((n) => n.userId === 9),
     `told: ${notified.map((n) => `${n.userId}:${n.ref}`).join(" ")}`);
  ok("a finding is a sentence a person can act on", notified.some((n) => /Low stock: Serum \(EL-01\) — 2 left/.test(n.message)));

  notified.length = 0;
  const r2 = await W.runWatchers(env);
  ok("the second run pushes nothing new", r2.pushed === 0 && notified.length === 0, `pushed ${r2.pushed}, notified ${notified.length}`);
  ok("...but still counts the open findings", r2.open === 2);

  fixture.stock[0].stock = 50; // restocked
  const r3 = await W.runWatchers(env);
  ok("a finding that is fixed is cleared", !env._open.has("stock:17") && r3.open === 1);
  fixture.stock[0].stock = 1;
  notified.length = 0;
  await W.runWatchers(env);
  ok("...and pushed again if it comes back", env._open.has("stock:17") && notified.some((n) => n.ref === "watch:stock:17"),
     "new again is new again");

  const off = fakeEnv({ ...fixture, settings: [{ key: "low_stock", enabled: 0, threshold: null }] });
  notified.length = 0;
  const r4 = await W.runWatchers(off);
  ok("a watcher switched off is not checked", !off._open.has("stock:17") && r4.pushed === 1);

  const higher = fakeEnv({ ...fixture, stock: [{ id: 18, sku: "EL-02", name: "Toner", stock: 40 }], settings: [{ key: "low_stock", enabled: 1, threshold: 45 }] });
  await W.runWatchers(higher);
  ok("the threshold is the CEO's, not the default", higher._open.has("stock:18"));

  ok("every watcher was checked", r1.checked === W.WATCHERS.length && r1.failed.length === 0, `checked ${r1.checked}, failed ${r1.failed.join("; ")}`);
}

/* ---- 2. the dates are read ---- */
{
  ok("dd.mm.yyyy (the workbook)", W.isoDate("25.06.2027") === "2027-06-25");
  ok("d.m.yyyy", W.isoDate("5.6.2027") === "2027-06-05");
  ok("dd/mm/yyyy", W.isoDate("31/05/2026") === "2026-05-31");
  ok("ISO passes through", W.isoDate("2026-12-31") === "2026-12-31");
  ok("free text is null, not a guess", W.isoDate("until renewed") === null && W.isoDate("") === null && W.isoDate(null) === null);
  const soon = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
  const far = new Date(Date.now() + 200 * 86_400_000).toISOString().slice(0, 10);
  const env = fakeEnv({ users: [{ id: 1, role: "ceo" }], hotels: [
    { id: 1, hotel_name: "Amari", state: "JOHOR", mof_validity: `${soon.slice(8, 10)}.${soon.slice(5, 7)}.${soon.slice(0, 4)}`, halal_validity: far },
    { id: 2, hotel_name: "Berjaya", state: "PAHANG", mof_validity: "n/a", halal_validity: null },
  ] });
  await W.runWatchers(env);
  ok("a certificate expiring inside the window is a finding, one far out is not", env._open.has("hotel:1:mof") && !env._open.has("hotel:1:halal"));
  ok("an unreadable date is skipped, not alarmed", !env._open.has("hotel:2:mof"));
}

/* ---- 3. the brief is personal ---- */
{
  const env = fakeEnv({ users: [{ id: 1, role: "ceo", name: "Alif" }, { id: 2, role: "coo", name: "Zol" }], clockedIn: 6, headcount: 9, yesterdayCents: 123400, yesterdayOrders: 3 });
  deskStub.setDesk({ 1: [{ overdue: true }, { overdue: false }, { overdue: false }], 2: [] });
  notified.length = 0;
  const sent = await W.morningBrief(env);
  ok("one brief per executive", sent === 2 && notified.length === 2);
  const ceo = notified.find((n) => n.userId === 1), coo = notified.find((n) => n.userId === 2);
  ok("the CEO is told HIS count", /3 waiting on you \(1 overdue\)/.test(ceo?.message ?? ""), ceo?.message);
  ok("the COO is told HERS", /Nothing is waiting on you/.test(coo?.message ?? ""), coo?.message);
  ok("attendance so far and yesterday's sales ride along", /6 of 9 clocked in/.test(ceo.message) && /3 web orders, RM 1234\.00/.test(ceo.message));
  ok("the ref is the day, so a second send the same morning is the same notice", /^brief:\d{4}-\d{2}-\d{2}$/.test(ceo.ref));
}

/* ---- 4. the wiring ---- */
{
  ok("the watchers run hourly on the five-minute tick", /if \(new Date\(\)\.getUTCMinutes\(\) < 5\) \{[\s\S]{0,200}?await runWatchers\(env\)/.test(index));
  ok("a watcher failure is logged, never fatal", /if \(r\.failed\.length\) await logError\(env, "watchers"/.test(index));
  ok("08:00 MYT is a cron in wrangler.toml", /"0 0 \* \* \*"/.test(toml.match(/crons\s*=\s*\[([^\]]*)\]/)?.[1] ?? ""));
  ok("...with a branch", /if \(event\.cron === "0 0 \* \* \*"\) \{[\s\S]{0,200}?await morningBrief\(env\)/.test(index));
  const allTabs = [...(tabsSrc.match(/const ALL_TABS = \[([\s\S]*?)\] as const;/)?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  for (const w of W.WATCHERS) ok(`${w.key} points at a real tab`, allTabs.includes(w.tab), w.tab);
  const roles = [...(perms.match(/export type Role =([\s\S]*?);/)?.[1] ?? "").matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
  for (const w of W.WATCHERS) ok(`${w.key} tells real roles`, w.audience.every((r) => roles.includes(r)), w.audience.join(","));
  ok("refs are stable per thing, not per run", W.WATCHERS.every((w) => /ref: `[a-z]+:\$\{/.test(src.slice(src.indexOf(`key: "${w.key}"`), src.indexOf(`key: "${w.key}"`) + 1500))));
  ok("the card follows the desk on the Dashboard", page.indexOf("<OneDesk") > 0 && page.indexOf("<WatchersCard") > page.indexOf("<OneDesk"));
  ok("the card is remembered and live", /useCachedApi<Data>\("\/staff\/watchers", exec, \["watchers"\]\)/.test(card) && /bumpVersion\(env, "watchers"\)/.test(src));
  ok("only the CEO changes a rule", /if \(user\.role !== "ceo" && user\.role !== "super_admin"\) return json\(\{ error: \{ code: "forbidden", message: "Only the CEO changes a watcher"/.test(src));
  ok("a rule change is audited", /audit\(env, user\.id, "watcher\.update", "watcher_settings"/.test(staff));
  ok("the two new push kinds land on the Dashboard", /watch: "Dashboard", brief: "Dashboard"/.test(staff));
  ok("0115 is registered and probed", index.includes('"0115_watchers",') && /\["0115 \(watchers\)"/.test(index));
}

if (failed) { console.log(`\n${failed} check(s) failed.`); process.exit(1); }
console.log(`PASS — findings pushed once, cleared when fixed, dates read as written, and a brief that is about you (${passed} checks)`);
