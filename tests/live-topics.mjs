/**
 * Live-topic guard (v1.65.0) — guard #16.
 *
 * Live cards work by watching a counter named after a route's first path
 * segment: a write to /api/v1/staff/tasks/12 bumps the topic "tasks", and a
 * card that calls useLiveRefresh(["tasks"], load) reloads.
 *
 * The failure mode is silent and total. Watch "commission-rules" when the
 * route is /commission, or "documents" when it is /docs, and the card simply
 * never updates. Nothing throws, nothing logs, no test fails — the feature
 * just quietly is not there, which is the worst kind of broken because
 * everyone assumes it is working.
 *
 * That mistake was made twice while writing the feature, in one sitting.
 * Hence this guard: every topic named on the client must exist as a real
 * route segment on the server, and the plumbing that makes bumps happen at
 * all must still be wired.
 *
 *   node tests/live-topics.mjs
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const root = new URL("..", import.meta.url).pathname;
const read = (p) => readFileSync(path.join(root, p), "utf8");

let pass = 0;
const fails = [];
const ok = (label, cond, extra = "") => {
  if (cond) pass++;
  else fails.push(`${label}${extra ? ` — ${extra}` : ""}`);
};

/* ---- 1. the server's real topics, straight from the route table ---- */
const staff = read("worker/src/staff.ts");
const TOPICS = new Set();
for (const m of staff.matchAll(/path (?:===|\.startsWith\()\s*"\/([a-z0-9_-]+)/g)) {
  TOPICS.add(m[1]);
}
ok("staff.ts route segments were found", TOPICS.size > 20, `found ${TOPICS.size}`);

/* ---- 2. every watched topic exists ---- */
const CLIENT_DIRS = ["app", "components", "hooks", "lib"];
const files = [];
const walk = (dir) => {
  let entries;
  try { entries = readdirSync(path.join(root, dir)); } catch { return; }
  for (const e of entries) {
    if (e === "node_modules" || e === ".next") continue;
    const rel = `${dir}/${e}`;
    const st = statSync(path.join(root, rel));
    if (st.isDirectory()) walk(rel);
    else if (/\.tsx?$/.test(e)) files.push(rel);
  }
};
for (const d of CLIENT_DIRS) walk(d);

let watched = 0;
for (const f of files) {
  const src = read(f);
  for (const m of src.matchAll(/useLiveRefresh\(\s*\[([^\]]*)\]/g)) {
    for (const t of m[1].matchAll(/"([^"]+)"/g)) {
      watched++;
      ok(`${f}: topic "${t[1]}" is a real staff route`, TOPICS.has(t[1]),
         `no /api/v1/staff/${t[1]} route exists — this card would never update`);
    }
  }
}
ok("at least one card is live", watched > 0,
   "no useLiveRefresh call found anywhere — the feature is not wired");

/* ---- 3. the plumbing that makes any of it work ---- */
const index = read("worker/src/index.ts");
ok("index.ts bumps the version after a successful staff write",
   /bumpVersion\(env,\s*topicOf\(sub\)\)/.test(index),
   "the one call site that makes every route live is gone");
ok("the bump is gated on a successful non-GET",
   /method !== "GET" && staffRes\.status >= 200 && staffRes\.status < 300/.test(index),
   "a rejected save must not tell every open tab to reload");

const shared = read("worker/src/shared.ts");
ok("bumpVersion never throws", /export async function bumpVersion[\s\S]{0,800}?catch \{/.test(shared),
   "a failed bump must not fail the save the user already completed");
ok("readVersions survives a missing table",
   /export async function readVersions[\s\S]{0,700}?catch \{/.test(shared),
   "a pre-0094 database must degrade to manual refresh, not 500");

ok("the SSE stream carries version frames", /event: versions/.test(staff),
   "the stream is where live updates actually travel");
ok("only CHANGED topics are streamed", /seenVersions\[t\] !== v/.test(staff),
   "sending the whole map every 5s to every open tab is the cost this avoids");
ok("GET /versions exists for the focus catch-up",
   /path === "\/versions" && method === "GET"/.test(staff),
   "without it a tab that slept can never catch up when SSE is blocked");

/* ---- 4. the client rules that stop a refetch storm ---- */
const hook = read("hooks/use-live-refresh.ts");
ok("the first observation is a baseline, not a reload",
   /for \(const t of list\) seen\[t\] = getVersion\(t\)/.test(hook),
   "every card would double-fetch on every page load");
ok("hidden tabs neither refetch nor consume the change",
   /visibilityState === "hidden"\) return;[\s\S]{0,200}?let changed = false/.test(hook),
   "a phone in a pocket would poll all day, or would swallow the update");

const live = read("lib/live.ts");
ok("versions only ever move forward", /\(versions\[topic\] \?\? -1\) < v/.test(live),
   "a late frame from a dying connection could otherwise drag a number back");
ok("bursts are coalesced", /flushTimer/.test(live),
   "one bulk action would fire a separate refetch per card");

/* ---- 5. the migration is registered ----
   NOT "0094 is the LATEST migration". That is what this guard asserted when
   it was written, and 0095 broke it the next day — a guard that fails on
   somebody else's unrelated work is a guard people learn to skip. What has
   to stay true is that 0094 is REGISTERED and PROBED, which is true forever. */
ok("0094 is in EXPECTED_MIGRATIONS", /"0094_data_versions",/.test(index));
ok("0094 has a health probe", /0094 \(live card versions\)/.test(index));

/* ---- 6. the TikTok name map's cache must survive its own schema ----
   The map is cached for six hours in system_meta, so a map written by an
   EARLIER build is read by a NEWER one. Every field added here has to be
   normalised on the way in, or the first request after a deploy reads
   `undefined.length` and returns 500. */
ok("a cached name map is normalised before use",
   /c\.map\.gone \?\?= \[\]/.test(index) && /c\.map\.notes \?\?= \[\]/.test(index),
   "the cache outlives the code that wrote it");
ok("a deleted product is not reported as an error",
   /precondition\|existing product\|not exist\|not found/.test(index),
   "quoting 'Precondition Required' reads as something broken; nothing is broken");
ok("archived products are swept only when something is unnamed",
   /wantProducts\.some\(\(id\) => !out\.products\[id\]\)[\s\S]{0,400}?SELLER_DEACTIVATED/.test(index),
   "a shop with an intact catalogue must not pay for four extra list calls");

console.log(fails.length === 0
  ? `PASS — live topics all resolve and the plumbing is intact (${pass} checks, ${watched} watched topics)`
  : `\n${fails.map((f) => `  ✗ ${f}`).join("\n")}\n\n${fails.length} check(s) failed.`);
process.exit(fails.length === 0 ? 0 : 1);
