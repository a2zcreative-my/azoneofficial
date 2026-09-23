#!/usr/bin/env node
/**
 * THE DATA LAYER, RUN — P0.4.
 *
 * `lib/cached-api.ts` is what every remembered view in the portal reads
 * through: the dashboard's money, the roster, the hotel directory, Hankeis'
 * queues. Until this release it fetched from an effect and pushed each part
 * of the answer into component state with a synchronous setState, which is
 * the pattern React 19 warns about — and, more to the point, it could not
 * tell two answers apart. Two requests for the same view could settle in
 * either order and the LAST to arrive won, whether or not it was the newest;
 * a request begun as one person could land after another signed in on the
 * same phone.
 *
 * Those are not things a regex over the source can check. This guard RUNS the
 * module: a small strict hooks runtime (tests/lib/mini-react.mjs), a fake
 * localStorage with a real quota, and an `api` whose every response this file
 * resolves by hand, so a test can say "let the second answer arrive first".
 *
 * What is proven here
 *   1. remembered-first: a view with a cached entry paints it on the FIRST
 *      render, with no skeleton, and says `stale` until the refresh lands.
 *   2. RACE A — out of order: a superseded answer never wins, in the cache or
 *      on the screen.
 *   3. RACE B — account switch mid-flight: an answer begun as one account is
 *      never written under another's key.
 *   4. RACE C — unmount mid-refresh: nothing renders after unmount, every
 *      subscription is released.
 *   5. RACE D — a live-version bump mid-request supersedes it, and the older
 *      answer is discarded even though it arrives later.
 *   6. no request storms: two cards on one path share ONE request; a settled
 *      view makes none; renders stay bounded.
 *   7. getSnapshot is identity-stable and the store is subscribed once, not
 *      once per render — the two ways useSyncExternalStore goes wrong.
 *   8. Strict Mode: the development double-mount costs exactly one request.
 *   9. the loading / stale / failed contract, unchanged from v1.104.0.
 *
 * Negative-tested by: dropping the sequence check in fetchPath (2 and 5
 * fail); dropping the scope capture (3 fails); returning a parsed object from
 * getSnapshot instead of the raw string (7 fails, with the identity printed);
 * removing the in-flight map (6 and 8 fail).
 */
import { readFileSync, mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { mount, tick } from "./lib/mini-react.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const importPath = (p) => p.replace(/\\/g, "/");

/* v1.139.2 / v1.181.1 - AN EXTERNAL IMPORT IS RESOLVED BY NODE, NOT BY
   ESBUILD, SO IT IS A file:// URL. The runtime below is marked --external,
   which means esbuild copies its specifier into the bundle untouched and
   Node resolves it when the bundle is imported. Node accepts a bare absolute
   path only where a path cannot be mistaken for a URL: "C:/Users/..." reads
   as the protocol "c:" and Node refuses it with
   ERR_UNSUPPORTED_ESM_URL_SCHEME.

   This guard shipped with `--external:"<absolute path>"` and an importPath()
   specifier. It passed on Linux, where an absolute path is a legal specifier,
   and stopped the CEO's release on Windows on 22-09-2026 - the same fault, in
   the same shape, as the 08-09-2026 one this comment was written for. The
   guard that was supposed to catch it reads --external flags only in the
   wildcard spelling (a star, a slash, then the basename), so an --external
   given as a quoted path was invisible to it and it concluded the stub was
   bundled. tests/registry-parity.mjs now refuses any --external it cannot
   read, which is what makes that a one-time mistake. */
const stubUrl = (p) => pathToFileURL(p).href;
const read = (p) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");

let failed = 0, passed = 0;
const ok = (label, cond, why = "") => {
  if (cond) passed++; else { failed++; console.log(`  ✗ ${label}${why ? ` — ${why}` : ""}`); }
};

/* =====================================================================
   BUILD: the real module, with three imports repointed at stubs.

   `react` becomes the strict runtime; `@/lib/api` becomes a controllable
   request; `@/lib/live` becomes a version store this file can bump. The
   live-refresh hook is the REAL one, so its useEffectEvent latest-callback
   is exercised rather than assumed.
   ===================================================================== */
const dir = mkdtempSync(join(tmpdir(), "cachedapi-"));
mkdirSync(join(dir, "src"), { recursive: true });

writeFileSync(join(dir, "api.js"), `
export const calls = [];
let pending = [];
export function api(path) {
  calls.push(path);
  return new Promise((resolve) => { pending.push({ path, resolve }); });
}
/** Settle the Nth outstanding request (0 = oldest). Order is the point. */
export function answer(index, body, opts = {}) {
  const p = pending[index];
  if (!p) throw new Error("no outstanding request at " + index + " (have " + pending.length + ")");
  pending.splice(index, 1);
  p.resolve(opts.fail ? { ok: false, status: 500, data: null } : { ok: true, status: 200, data: body });
}
export const outstanding = () => pending.length;
export function reset() { calls.length = 0; pending = []; }
`);

writeFileSync(join(dir, "live.js"), `
const versions = new Map();
const listeners = new Set();
export const getVersion = (t) => versions.get(t) ?? 0;
export function subscribeVersions(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function bump(topic) {
  versions.set(topic, (versions.get(topic) ?? 0) + 1);
  for (const fn of [...listeners]) fn();
}
`);

/* the two modules under test, byte-for-byte apart from their import lines */
writeFileSync(join(dir, "src/use-live-refresh.ts"),
  read("hooks/use-live-refresh.ts")
    .replace('from "react"', `from "${stubUrl(join(root, "tests/lib/mini-react.mjs"))}"`)
    .replace('from "@/lib/live"', `from "${importPath(join(dir, "live.js"))}"`));

writeFileSync(join(dir, "src/cached-api.ts"),
  read("lib/cached-api.ts")
    .replace('from "react"', `from "${stubUrl(join(root, "tests/lib/mini-react.mjs"))}"`)
    .replace('from "@/lib/api"', `from "${importPath(join(dir, "api.js"))}"`)
    .replace('from "@/hooks/use-live-refresh"', `from "${importPath(join(dir, "src/use-live-refresh.ts"))}"`));

const bundle = join(dir, "bundle.mjs");
writeFileSync(join(dir, "entry.ts"), `
export * from "${importPath(join(dir, "src/cached-api.ts"))}";
export { calls, answer, outstanding, reset } from "${importPath(join(dir, "api.js"))}";
export { bump } from "${importPath(join(dir, "live.js"))}";
`);

/* =====================================================================
   A localStorage with a real quota, and a clock this file controls.
   ===================================================================== */
const store = new Map();
const QUOTA = 2_000_000;
const used = () => [...store.values()].reduce((n, v) => n + v.length, 0);
globalThis.window = {
  localStorage: {
    get length() { return store.size; },
    key: (i) => [...store.keys()][i] ?? null,
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    removeItem: (k) => { store.delete(k); },
    setItem: (k, v) => {
      const after = used() - (store.get(k)?.length ?? 0) + String(v).length;
      if (after > QUOTA) { const e = new Error("quota"); e.name = "QuotaExceededError"; throw e; }
      store.set(k, String(v));
    },
  },
  addEventListener() {},
  removeEventListener() {},
};
globalThis.document = { visibilityState: "visible" };

/* THE RUNTIME STAYS EXTERNAL, and it is imported by the same file:// URL
   this file uses, so both sides share ONE module instance and therefore one
   dispatcher. Bundling a second copy would give the module under test a
   different dispatcher than the test holds, and every hook call would throw.
   Everything else IS bundled, so `answer()` below settles the very promise
   the module is waiting on. */
execSync(
  `npx esbuild "${join(dir, "entry.ts")}" --bundle --format=esm --platform=neutral ` +
  `--external:*/mini-react.mjs --outfile="${bundle}" --log-level=error`,
  { cwd: root, stdio: "inherit" },
);
const M = await import(pathToFileURL(bundle).href);

const keyOf = (account, path) => `azone-cache:${account}:${path}`;
const seed = (account, path, data, ageMs = 0) =>
  store.set(keyOf(account, path), JSON.stringify({ t: Date.now() - ageMs, d: data }));

/** Mount one consumer of the hook. `box` lets a test change its props. */
function card(box, opts) {
  const h = mount(() => M.useCachedApi(box.path, box.enabled ?? true, box.topics ?? []), opts);
  return h;
}

const fresh = () => { store.clear(); M.reset(); M.setCacheScope(7); };

console.log("cached-api — running the data layer\n");

/* ---- 1. remembered-first, on the FIRST render ---- */
{
  fresh();
  seed(7, "/staff/roster", { sessions: ["remembered"] });
  const c = card({ path: "/staff/roster" });

  ok("a remembered view paints on the first render, not after an effect",
     c.value.data?.sessions?.[0] === "remembered" && c.renders === 1,
     `renders=${c.renders} data=${JSON.stringify(c.value.data)}`);
  ok("...and never shows a skeleton", c.value.loading === false);
  ok("...and says so while the refresh is owed", c.value.stale === true,
     "the money cards render <StaleHint/> for exactly this window — it must be true on the first painted frame");

  await c.settle();
  ok("the refresh was issued", M.calls.length === 1, `calls=${JSON.stringify(M.calls)}`);
  M.answer(0, { sessions: ["fresh"] });
  await c.settle();
  ok("fresh figures replace the remembered ones", c.value.data?.sessions?.[0] === "fresh");
  ok("...and stale drops", c.value.stale === false && c.value.loading === false && c.value.failed === false);
  ok("...and the cache was updated", JSON.parse(store.get(keyOf(7, "/staff/roster"))).d.sessions[0] === "fresh");
  c.unmount();
}

/* ---- 1b. first-ever load has nothing to show ---- */
{
  fresh();
  const c = card({ path: "/staff/desk" });
  ok("a first-ever load is loading, not stale", c.value.loading === true && c.value.stale === false && c.value.data === null);
  await c.settle();
  M.answer(0, { items: [1] });
  await c.settle();
  ok("...and settles into data", c.value.loading === false && c.value.data?.items?.length === 1);
  c.unmount();
}

/* ---- 2. RACE A: out of order ---- */
{
  fresh();
  seed(7, "/staff/tasks", { tasks: ["old"] });
  const c = card({ path: "/staff/tasks" });
  await c.settle();                            // request #1 (the mount)
  c.value.refresh();                           // request #2 (a save just happened)
  await c.settle();
  ok("an explicit refresh does NOT join a request that predates it",
     M.calls.length === 2 && M.outstanding() === 2,
     `an answer already in flight when the save happened is older than the save (calls=${M.calls.length})`);

  M.answer(1, { tasks: ["NEWER"] });           // the second answer lands first
  await c.settle();
  M.answer(0, { tasks: ["older"] });           // the first answer lands second
  await c.settle();

  ok("RACE A: the superseded answer never reaches the screen",
     c.value.data?.tasks?.[0] === "NEWER", `saw ${JSON.stringify(c.value.data)}`);
  ok("RACE A: ...nor the cache",
     JSON.parse(store.get(keyOf(7, "/staff/tasks"))).d.tasks[0] === "NEWER",
     "a stale write here is a wrong number that survives a reload");
  ok("RACE A: the view is not left pretending to refresh",
     c.value.stale === false && c.value.loading === false);
  c.unmount();
}

/* ---- 3. RACE B: the account changes mid-flight ---- */
{
  fresh();
  const c = card({ path: "/staff/payroll" });
  await c.settle();
  M.setCacheScope(8);                          // a different person signs in on this phone
  await c.settle();
  M.answer(0, { entries: ["belongs to account 7"] });
  await c.settle();

  ok("RACE B: an answer begun as one account is not written under another's key",
     store.get(keyOf(8, "/staff/payroll")) === undefined,
     `account 8 must not inherit account 7's figures — saw ${store.get(keyOf(8, "/staff/payroll"))}`);
  ok("RACE B: ...and is not shown either", c.value.data === null,
     `saw ${JSON.stringify(c.value.data)}`);
  ok("RACE B: the switch wiped what account 7 had remembered",
     ![...store.keys()].some((k) => k.startsWith("azone-cache:7:")));
  c.unmount();
  M.setCacheScope(7);
}

/* ---- 4. RACE C: unmount mid-refresh ---- */
{
  fresh();
  const c = card({ path: "/staff/leave" });
  await c.settle();
  const subs = c.subscribes;
  c.unmount();
  ok("every store subscription is released on unmount",
     c.unsubscribes === subs && subs > 0, `${c.unsubscribes}/${subs} released`);
  M.answer(0, { leave: [] });
  await new Promise((r) => setTimeout(r, 10));
  ok("RACE C: nothing renders after unmount", c.afterUnmount === 0,
     `${c.afterUnmount} render(s) were attempted on a gone component`);
  ok("RACE C: ...but the answer still reached the cache for the next visit",
     store.get(keyOf(7, "/staff/leave")) !== undefined,
     "the fetch belongs to the view, not to the component instance");
}

/* ---- 5. RACE D: a version bump mid-request ---- */
{
  fresh();
  seed(7, "/staff/tasks", { tasks: ["remembered"] });
  const c = card({ path: "/staff/tasks", topics: ["tasks"] });
  await c.settle();
  ok("the hook subscribed to its live topic", M.calls.length === 1);

  M.bump("tasks");                             // something changed server-side
  await c.settle();
  ok("RACE D: a version bump issues a new request rather than waiting",
     M.calls.length === 2 && M.outstanding() === 2);

  M.answer(1, { tasks: ["after the change"] });
  await c.settle();
  M.answer(0, { tasks: ["before the change"] });
  await c.settle();
  ok("RACE D: the pre-change answer is discarded even though it arrives later",
     c.value.data?.tasks?.[0] === "after the change", `saw ${JSON.stringify(c.value.data)}`);
  c.unmount();
}

/* ---- 6. no request storms ---- */
{
  fresh();
  const a = card({ path: "/staff/desk" });
  const b = card({ path: "/staff/desk" });
  await a.settle();
  ok("two cards on one path share ONE request",
     M.calls.length === 1,
     `/staff/desk is read by the Desk tab and the Dashboard at the same time (calls=${M.calls.length})`);

  M.answer(0, { items: ["shared"] });
  await a.settle();
  await b.settle();
  ok("...and BOTH see the answer", a.value.data?.items?.[0] === "shared" && b.value.data?.items?.[0] === "shared",
     "the second card never fetched; it reads the store the first one filled");
  ok("...with no further requests", M.calls.length === 1);

  const beforeA = a.renders, beforeB = b.renders;
  a.rerender(); a.rerender(); a.rerender();
  await a.settle();
  ok("a re-render issues no request", M.calls.length === 1);
  ok("a re-render does not resubscribe",
     a.subscribes === a.unsubscribes + 3 || a.subscribes - a.unsubscribes === 3,
     `${a.subscribes} subscribes / ${a.unsubscribes} unsubscribes for three stores`);
  ok("settling a view costs a bounded number of renders",
     beforeA <= 4 && beforeB <= 4, `a=${beforeA} b=${beforeB}`);
  a.unmount(); b.unmount();
}

/* ---- 7. the two ways useSyncExternalStore goes wrong ---- */
{
  fresh();
  seed(7, "/staff/hotels", { hotels: [1, 2, 3] });
  const c = card({ path: "/staff/hotels" });
  await c.settle();
  M.answer(0, { hotels: [1, 2, 3, 4] });
  await c.settle();
  ok("getSnapshot is identity-stable on every render",
     c.snapshotFaults.length === 0,
     c.snapshotFaults[0] ?? "");
  ok("the module subscribes once per store, not once per render",
     c.subscribes === 3, `${c.subscribes} subscribes over ${c.renders} renders`);
  c.unmount();
  ok("...and releases all three", c.unsubscribes === 3);
}

/* ---- 8. Strict Mode ---- */
{
  fresh();
  const c = card({ path: "/staff/announcements" }, { strict: true });
  await c.settle();
  ok("Strict Mode's double mount costs exactly one request",
     M.calls.length === 1, `calls=${M.calls.length} — a second request here is a doubled load on every card in the portal`);
  ok("Strict Mode leaves no leaked subscription",
     c.subscribes - c.unsubscribes === 3, `${c.subscribes} subscribes, ${c.unsubscribes} unsubscribes`);
  ok("Strict Mode's double render finds no unstable snapshot", c.snapshotFaults.length === 0, c.snapshotFaults[0] ?? "");
  M.answer(0, { announcements: [] });
  await c.settle();
  ok("...and the answer still lands", c.value.loading === false && c.value.data !== null);
  c.unmount();
}

/* ---- 9. the loading / stale / failed contract ---- */
{
  fresh();
  seed(7, "/staff/assets", { assets: ["remembered"] });
  const c = card({ path: "/staff/assets" });
  await c.settle();
  M.answer(0, null, { fail: true });
  await c.settle();
  ok("a failed refresh KEEPS the remembered figures on screen",
     c.value.data?.assets?.[0] === "remembered",
     "showing yesterday's list with a mark beats a blank card");
  ok("...and says it failed", c.value.failed === true && c.value.loading === false && c.value.stale === false);
  c.unmount();

  fresh();
  const d = card({ path: "/staff/assets" });
  await d.settle();
  M.answer(0, null, { fail: true });
  await d.settle();
  ok("a failure with nothing remembered is not a skeleton for ever",
     d.value.loading === false && d.value.data === null && d.value.failed === true,
     "the card must be able to say WHY it is empty");
  d.unmount();

  fresh();
  const e = card({ path: null, enabled: false });
  await e.settle();
  ok("a disabled card fetches nothing and shows nothing",
     M.calls.length === 0 && e.value.loading === false && e.value.stale === false && e.value.data === null);
  e.unmount();

  fresh();
  seed(7, "/staff/inventory", { items: ["yesterday"] }, 25 * 3600 * 1000);
  const f = card({ path: "/staff/inventory" });
  ok("an entry past the 24h ceiling is not painted",
     f.value.data === null && f.value.loading === true,
     "a day-old order list is not a view, it is a trap");
  await f.settle();
  f.unmount();
}

/* ---- 10. sign-out empties the screen ---- */
{
  fresh();
  seed(7, "/staff/dashboard/summary", { cash_in_cents: 4_800_000 });
  const c = card({ path: "/staff/dashboard/summary" });
  await c.settle();
  M.answer(0, { cash_in_cents: 4_900_000 });
  await c.settle();
  ok("the figure is on screen", c.value.data?.cash_in_cents === 4_900_000);

  M.clearApiCache();
  await c.settle();
  ok("clearApiCache empties the card immediately, without waiting for a re-render elsewhere",
     c.value.data === null,
     "a sign-out that leaves the previous person's money painted is the whole reason the epoch exists");
  c.unmount();
}

/* ---- 11. an answer too large to cache is still shown ---- */
{
  fresh();
  const c = card({ path: "/staff/hotels" });
  await c.settle();
  const huge = { hotels: "x".repeat(500_000) };     // over MAX_BYTES
  M.answer(0, huge);
  await c.settle();
  ok("a response the cache refuses is still delivered to the card",
     c.value.data?.hotels?.length === 500_000,
     "the 442-hotel directory must render even on the day it outgrows the ceiling");
  ok("...and nothing was stored", store.get(keyOf(7, "/staff/hotels")) === undefined);
  ok("...and it is not left looking like a failure",
     c.value.loading === false && c.value.failed === false && c.value.stale === false);
  c.unmount();
}

if (failed) { console.log(`\n${failed} check(s) failed.`); process.exit(1); }
console.log(`\nPASS — the data layer keeps its contract, and no answer wins by arriving last (${passed} checks)`);
