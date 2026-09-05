#!/usr/bin/env node
/* Guard #39 — v1.104.0 (roadmap phase 02): views are remembered, then refreshed.
 *
 * lib/cached-api.ts existed since v1.25.0 and was wired into two files out of
 * ninety-two, so every other card showed a skeleton on every visit. This
 * phase rolled it across the views people open most, and this guard is what
 * keeps the next new card from quietly going back to skeleton-on-every-visit.
 *
 * Properties:
 *   1. THE CACHE ITSELF WORKS, run for real against a fake localStorage:
 *      an entry over the ceiling is refused rather than thrown; a write that
 *      trips the quota evicts the OLDEST entries and succeeds; a stale entry
 *      (past the 24h TTL) reads as nothing; one account can never read
 *      another's entries, and a genuine account switch wipes the store.
 *   2. THE HOOK IS LIVE. It takes topics and hands them to useLiveRefresh, so
 *      a remembered view is never stale longer than the SSE stream takes to
 *      say so; and it reports `failed`, so a card can tell "nothing to show"
 *      from "showing yesterday's".
 *   3. THE CONVERTED VIEWS STAY CONVERTED. Each named panel reads its list
 *      through useCachedApi and no longer carries the old fetch-then-
 *      setLoaded(true) pattern for it.
 *   4. MONEY SAYS SO. A reconciliation showing remembered figures wears the
 *      StaleHint until fresh ones land (the CEO's rule from v1.25.0).
 *
 * Negative-tested by: removing the eviction retry (1 fails); dropping the
 * useLiveRefresh call from the hook (2 fails); putting `const [loaded,
 * setLoaded] = useState(false)` back into hotels-panel (3 fails); removing
 * StaleHint from verification-card (4 fails).
 */
import { readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = new URL("..", import.meta.url).pathname;
const read = (p) => readFileSync(join(root, p), "utf8");
const cache = read("lib/cached-api.ts");

let failed = 0, passed = 0;
const ok = (label, cond, why = "") => {
  if (cond) passed++; else { failed++; console.log(`  ✗ ${label}${why ? ` — ${why}` : ""}`); }
};

/* ---- 1. run the real cache against a fake localStorage ---- */
{
  const dir = mkdtempSync(join(tmpdir(), "cache-"));
  /* React and the two internal imports are stubbed: only the storage half is
     exercised here, and the hook half is checked by reading, below. */
  writeFileSync(join(dir, "react.js"), "export const useState=()=>[null,()=>{}];export const useEffect=()=>{};export const useCallback=(f)=>f;export const useRef=(v)=>({current:v});");
  writeFileSync(join(dir, "api.js"), "export const api=async()=>({ok:false});");
  writeFileSync(join(dir, "live.js"), "export const useLiveRefresh=()=>{};");
  /* esbuild aliases are package names, not paths, so the three imports are
     rewritten on a COPY of the source - the module under test is otherwise
     byte-for-byte the real file. */
  const src = read("lib/cached-api.ts")
    .replace('from "react"', `from "${join(dir, "react.js")}"`)
    .replace('from "@/lib/api"', `from "${join(dir, "api.js")}"`)
    .replace('from "@/hooks/use-live-refresh"', `from "${join(dir, "live.js")}"`);
  writeFileSync(join(dir, "cached-api.ts"), src);
  const out = join(dir, "cache.mjs");
  execSync(`npx esbuild ${join(dir, "cached-api.ts")} --bundle --format=esm --platform=neutral --outfile=${out} --log-level=error`,
    { cwd: root, stdio: "inherit" });

  /* A localStorage with a quota, like a real one. */
  const makeStorage = (quota) => {
    const m = new Map();
    const used = () => [...m.values()].reduce((n, v) => n + v.length, 0);
    return {
      get length() { return m.size; },
      key: (i) => [...m.keys()][i] ?? null,
      getItem: (k) => m.get(k) ?? null,
      removeItem: (k) => { m.delete(k); },
      setItem: (k, v) => {
        const after = used() - (m.get(k)?.length ?? 0) + v.length;
        if (after > quota) { const e = new Error("quota"); e.name = "QuotaExceededError"; throw e; }
        m.set(k, v);
      },
      _map: m,
    };
  };
  const storage = makeStorage(1_000_000);
  globalThis.window = { localStorage: storage };
  let now = 1_700_000_000_000;
  const realNow = Date.now; Date.now = () => now;

  const { cacheRead, cacheWrite, setCacheScope, clearApiCache } = await import(pathToFileURL(out).href);
  setCacheScope(7);

  cacheWrite("/a", { n: 1 });
  ok("a write is read back", cacheRead("/a")?.n === 1);

  cacheWrite("/huge", "x".repeat(500_000));
  ok("an entry over the ceiling is refused, not thrown", cacheRead("/huge") === null,
     "a 442-hotel directory is ~230 KB and must fit; a 500 KB blob must not fill the device");

  /* fill to the quota with old entries, then write something new */
  for (let i = 0; i < 9; i++) { now += 1000; cacheWrite(`/old${i}`, "y".repeat(100_000)); }
  ok("the store is nearly full", storage._map.size >= 9);
  now += 1000;
  cacheWrite("/fresh", "z".repeat(150_000));
  ok("a write that trips the quota still lands", typeof cacheRead("/fresh") === "string",
     "the cache should degrade to remembering less, never to remembering nothing");
  ok("and it made room by forgetting the OLDEST first", cacheRead("/old0") === null && cacheRead("/old8") !== null,
     `old0 ${cacheRead("/old0") === null ? "gone" : "kept"}, old8 ${cacheRead("/old8") === null ? "gone" : "kept"}`);

  now += 25 * 3600 * 1000;
  ok("an entry past 24h reads as nothing", cacheRead("/fresh") === null, "a day-old order list is not a view, it is a trap");

  cacheWrite("/mine", { who: 7 });
  setCacheScope(8);
  ok("another account cannot read it", cacheRead("/mine") === null, "a shared phone must never flash one account's figures at another");
  ok("a genuine account switch wiped the store", storage._map.size <= 1, `${storage._map.size} entries survive`);
  setCacheScope(8); cacheWrite("/mine", { who: 8 }); setCacheScope(8);
  ok("the same account again does NOT wipe", cacheRead("/mine")?.who === 8, "every load starts anon then learns the id — that is not a switch");
  clearApiCache();
  ok("clearApiCache empties everything of ours", cacheRead("/mine") === null);

  Date.now = realNow;
}

/* ---- 2. the hook is live and honest ---- */
{
  ok("the hook accepts topics", /export function useCachedApi<T>\(path: string \| null, enabled = true, topics: string\[\] = \[\]\)/.test(cache));
  ok("and hands them to useLiveRefresh", /useLiveRefresh\(topics, run, enabled && Boolean\(path\)\)/.test(cache),
     "a remembered view with no way to learn it is stale is a view that lies politely");
  ok("the hook reports failure", /failed: boolean;/.test(cache) && /setFailed\(true\)/.test(cache) && /refresh: run \}/.test(cache) && /failed, refresh/.test(cache));
  ok("a failure keeps the remembered data on screen",
     /if \(r\.ok && r\.data != null\) \{[\s\S]{0,200}?\} else \{\s*setFailed\(true\);\s*\}/.test(cache),
     "showing yesterday's list with a mark beats a blank card");
  ok("the ceiling fits a real directory", /const MAX_BYTES = 400_000;/.test(cache));
  /* (the eviction itself is proven above, on a real quota; this only pins
     that it is oldest-first and a single retry) */
  ok("the quota path evicts oldest-first and retries once",
     /\.sort\(\(a, b\) => a\.t - b\.t\)/.test(cache) && /for \(const e of ourEntries\(\)\)[\s\S]{0,400}?removeItem\(e\.key\)[\s\S]{0,300}?setItem\(keyFor\(path\), raw\)/.test(cache));
}

/* ---- 3. the converted views stay converted ---- */
{
  const files = {
    "components/portal/hotels-panel.tsx": "/staff/hotels",
    "components/staff/staff-directory.tsx": "/staff/users",
    "components/portal/assets-panel.tsx": "/staff/assets",
    "components/portal/web-orders-panel.tsx": "/staff/web-orders",
    "components/portal/elfia-traffic-panel.tsx": "/staff/web-traffic",
    "components/portal/verification-card.tsx": "/staff/attendance/verification",
  };
  for (const [file, path] of Object.entries(files)) {
    const whole = read(file);
    /* the component under test, not every component in the file - the staff
       directory also houses the document vault, which keeps its own loader */
    const fnName = { "components/staff/staff-directory.tsx": "StaffDirectory" }[file];
    const src = fnName ? whole.slice(whole.indexOf(`export function ${fnName}(`), whole.indexOf("\n}\n", whole.indexOf(`export function ${fnName}(`))) : whole;
    ok(`${file} reads ${path} through useCachedApi`,
       /from "@\/lib\/cached-api"/.test(whole) && /useCachedApi</.test(src) && src.includes(path),
       "a card that fetches on mount shows a skeleton on every visit");
    /* the old pattern: an explicit loaded flag flipped after a bare fetch */
    ok(`${file} has no fetch-then-setLoaded left`, !/setLoaded\(true\)/.test(src));
    ok(`${file} shows the remembered/refreshing state`, /StaleHint/.test(src) || file.includes("staff-directory"),
       "the person should be able to tell yesterday's from today's");
  }
  /* the three in-page tabs everyone opens daily */
  const page = read("app/portal/page.tsx");
  for (const [fn, path, topic] of [["Announcements", "/staff/announcements", "announcements"], ["Tasks", "/staff/tasks", "tasks"], ["Leave", "/staff/leave", "leave"]]) {
    const start = page.indexOf(`function ${fn}(`);
    const body = page.slice(start, page.indexOf("\n}\n", start));
    ok(`${fn} tab is remembered`, start > 0 && /useCachedApi</.test(body) && body.includes(path));
    ok(`${fn} tab refetches on its topic`, new RegExp(`\\["${topic}"\\]`).test(body), "the topic wiring moved INTO the hook and must have come with it");
    ok(`${fn} tab has no fetch-then-setLoaded left`, !/setLoaded\(true\)/.test(body));
  }
}

/* ---- 4. money says so ---- */
{
  const v = read("components/portal/verification-card.tsx");
  ok("the reconciliation wears the StaleHint while remembered figures refresh",
     /<StaleHint show=\{report\.stale\}/.test(v),
     "instant everywhere, but MONEY says so - the CEO's rule since v1.25.0");
}

if (failed) { console.log(`\n${failed} check(s) failed.`); process.exit(1); }
console.log(`PASS — views are remembered, refreshed live, and the cache degrades gracefully (${passed} checks)`);
