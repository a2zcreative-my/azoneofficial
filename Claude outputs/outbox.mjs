#!/usr/bin/env node
/* Guard #40 — v1.105.0 (roadmap phase 03): the outbox.
 *
 * A write the phone could not deliver is kept and sent later. That is only
 * safe if both ends agree on WHICH writes, the server answers a replayed key
 * the same way it answered the first time, and a punch sent late is recorded
 * at the time it was pressed AND marked pending. Each of those is a property
 * below, and the server half is RUN, not read.
 *
 *   1. ONE LIST, BOTH ENDS. lib/outbox.ts and worker/src/outbox.ts name the
 *      same routes, method for method, pattern for pattern. A route queueable
 *      on one side only is a write that never lands or lands twice.
 *   2. THE SAME ANSWER TWICE, run against a fake D1: a key runs the handler
 *      once and stores the answer; the second call returns it with the replay
 *      header and does NOT run the handler; a 5xx is not stored; no key, or a
 *      key on a route that is not queueable, runs every time.
 *   3. WHEN THE PHONE SAID, run for real: now is null (live request); five
 *      minutes ago is a Date; three days ago is null; garbage is null; a
 *      timestamp without a key is null.
 *   4. THE CLIENT MINTS ONCE AND ALWAYS SENDS IT: every queueable write
 *      carries Idempotency-Key and X-Client-At on the live attempt; a thrown
 *      fetch or navigator.onLine === false parks it; a non-queueable write is
 *      never parked. A minted key satisfies the server's key pattern.
 *   5. THE PUNCH IS RECORDED AT THE PRESSED TIME, PENDING, WITH BOTH TIMES;
 *      the dispatcher wraps every staff request and skips the version bump on
 *      a replay; the register shows pressed vs arrived.
 *   6. EVERY QUEUED CALL SITE SAYS SO (house rule #25): punch, leave, task
 *      status, task tick, claim - each has a `queued` branch whose toast does
 *      not claim the thing happened.
 *   7. A PUSH LANDS ON ITS TAB: notify() deep-links by kind, the portal reads
 *      ?tab= once, the service worker navigates an open window by pathname
 *      and its shell version was bumped.
 *   8. Migration 0114 is registered, probed, and purged nightly.
 *
 * Negative-tested by: adding a route to one QUEUEABLE only (1); storing a
 * 500 in replayOrRun (2); dropping the MIN_LATE check (3); removing the
 * Idempotency-Key header from api() (4); using Date.now() for todayMYT in the
 * punch (5); deleting the leave `queued` toast (6); reverting the SW shell
 * version (7).
 */
import { readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = new URL("..", import.meta.url).pathname;
const read = (p) => readFileSync(join(root, p), "utf8");
const clientSrc = read("lib/outbox.ts");
const serverSrc = read("worker/src/outbox.ts");
const apiSrc = read("lib/api.ts");
const staff = read("worker/src/staff.ts");
const index = read("worker/src/index.ts");
const page = read("app/portal/page.tsx");
const rolePanels = read("components/portal/role-panels.tsx");
const sw = read("public/sw.js");
const banner = read("components/ui/offline-banner.tsx");

let failed = 0, passed = 0;
const ok = (label, cond, why = "") => {
  if (cond) passed++; else { failed++; console.log(`  ✗ ${label}${why ? ` — ${why}` : ""}`); }
};

/* ---- bundle both modules ---- */
const dir = mkdtempSync(join(tmpdir(), "outbox-"));
const bundle = (src, name) => {
  const out = join(dir, `${name}.mjs`);
  execSync(`npx esbuild ${src} --bundle --format=esm --platform=neutral --outfile=${out} --log-level=error`, { cwd: root, stdio: "inherit" });
  return import(pathToFileURL(out).href);
};
const server = await bundle(join(root, "worker/src/outbox.ts"), "server");
/* the client module is "use client" and touches indexedDB only inside
   functions; its pure exports load fine in node */
const client = await bundle(join(root, "lib/outbox.ts"), "client");

/* ---- 1. one list, both ends ---- */
{
  const c = client.QUEUEABLE.map((r) => `${r.method} ${r.path.source.replace(/^\^\\\/staff/, "^")}`).sort();
  const s = server.QUEUEABLE.map((r) => `${r.method} ${r.path.source}`).sort();
  ok("the client and the worker queue the same routes", JSON.stringify(c) === JSON.stringify(s),
     `client: ${c.join(" | ")}\n      worker: ${s.join(" | ")}`);
  ok("the list is short and boring", server.QUEUEABLE.length <= 10, `${server.QUEUEABLE.length} routes`);
  for (const bad of [["POST", "/auth/login"], ["POST", "/2fa/verify"], ["POST", "/web-orders/sync"], ["DELETE", "/tasks/1"], ["POST", "/leave/1/decide"], ["POST", "/attendance/pending/decide"]]) {
    ok(`${bad[0]} ${bad[1]} is NOT queueable`, !server.isQueueable(bad[0], bad[1]), "replaying a sign-in, a decision or a sync later is wrong");
  }
  ok("the CEO's four are queueable", ["/attendance", "/tasks/12", "/leave", "/claims", "/hotels/3/calls"].every((p) => server.isQueueable(p === "/tasks/12" ? "PATCH" : "POST", p)));
}

/* ---- 2. the same answer twice ---- */
{
  const rows = new Map();
  const fakeDb = {
    prepare: (sql) => ({
      bind: (...args) => ({
        first: async () => {
          if (/SELECT status, body FROM idempotency_keys/.test(sql)) { const r = rows.get(`${args[0]}|${args[1]}`); return r ?? null; }
          return null;
        },
        run: async () => {
          if (/INSERT OR IGNORE INTO idempotency_keys/.test(sql)) { const k = `${args[0]}|${args[1]}`; if (!rows.has(k)) rows.set(k, { status: args[3], body: args[4] }); }
          if (/DELETE FROM idempotency_keys/.test(sql)) rows.clear();
          return {};
        },
      }),
    }),
  };
  const env = { DB: fakeDb };
  const req = (headers, method = "POST") => new Request("https://x/api/v1/staff/attendance", { method, headers });
  let runs = 0;
  const handler = async () => { runs++; return new Response(JSON.stringify({ ok: true, n: runs }), { status: 200, headers: { "Content-Type": "application/json" } }); };

  const r1 = await server.replayOrRun(env, req({ "Idempotency-Key": "abcdefgh-1234" }), 7, "/attendance", handler);
  const r2 = await server.replayOrRun(env, req({ "Idempotency-Key": "abcdefgh-1234" }), 7, "/attendance", handler);
  ok("the handler ran once for one key", runs === 1, `ran ${runs} times`);
  ok("the second call returned the FIRST answer", (await r2.text()) === JSON.stringify({ ok: true, n: 1 }));
  ok("and said it was a replay", r2.headers.get(server.REPLAY_HEADER) === "1" && !r1.headers.get(server.REPLAY_HEADER));
  const r3 = await server.replayOrRun(env, req({ "Idempotency-Key": "abcdefgh-1234" }), 8, "/attendance", handler);
  ok("a different account with the same key is a different request", runs === 2 && !r3.headers.get(server.REPLAY_HEADER),
     "keys are per person - one phone's uuid must not answer for another's");

  runs = 0;
  let fail = true;
  const flaky = async () => { runs++; return fail ? new Response("{}", { status: 503 }) : new Response(JSON.stringify({ ok: true }), { status: 200 }); };
  await server.replayOrRun(env, req({ "Idempotency-Key": "zzzzzzzz-0001" }), 7, "/attendance", flaky);
  fail = false;
  const r5 = await server.replayOrRun(env, req({ "Idempotency-Key": "zzzzzzzz-0001" }), 7, "/attendance", flaky);
  ok("a 5xx is not stored, so the retry really retries", runs === 2 && r5.status === 200, `ran ${runs}, status ${r5.status}`);

  runs = 0;
  const refused = async () => { runs++; return new Response(JSON.stringify({ error: { code: "already_punched" } }), { status: 409 }); };
  await server.replayOrRun(env, req({ "Idempotency-Key": "rrrrrrrr-0001" }), 7, "/attendance", refused);
  const r6 = await server.replayOrRun(env, req({ "Idempotency-Key": "rrrrrrrr-0001" }), 7, "/attendance", refused);
  ok("a refusal IS stored and replays as the same refusal", runs === 1 && r6.status === 409,
     "a 409 replayed a third time must still say already punched, not run the handler on a different day");

  runs = 0;
  await server.replayOrRun(env, req({}), 7, "/attendance", handler);
  await server.replayOrRun(env, req({}), 7, "/attendance", handler);
  ok("no key: runs every time", runs === 2);
  runs = 0;
  await server.replayOrRun(env, req({ "Idempotency-Key": "abcdefgh-9999" }), 7, "/web-orders/sync", handler);
  await server.replayOrRun(env, req({ "Idempotency-Key": "abcdefgh-9999" }), 7, "/web-orders/sync", handler);
  ok("a key on a route that is not queueable is ignored", runs === 2, "storing answers for every route would be a cache of side effects");
  runs = 0;
  await server.replayOrRun(env, req({ "Idempotency-Key": "bad key with spaces" }), 7, "/attendance", handler);
  await server.replayOrRun(env, req({ "Idempotency-Key": "bad key with spaces" }), 7, "/attendance", handler);
  ok("a malformed key is ignored", runs === 2);

  const noTable = { DB: { prepare: () => ({ bind: () => ({ first: async () => { throw new Error("no such table: idempotency_keys"); }, run: async () => ({}) }) }) } };
  runs = 0;
  const r7 = await server.replayOrRun(noTable, req({ "Idempotency-Key": "abcdefgh-1234" }), 7, "/attendance", handler);
  ok("a database without 0114 runs the handler rather than failing", runs === 1 && r7.status === 200);
}

/* ---- 3. when the phone said ---- */
{
  const at = (iso, key = "abcdefgh-1234") => server.clientAt(new Request("https://x/", { method: "POST", headers: { "Idempotency-Key": key, "X-Client-At": iso } }), "/attendance");
  const ago = (ms) => new Date(Date.now() - ms).toISOString();
  ok("a live request (now) is null - now is the truth", at(ago(0)) === null);
  ok("twenty seconds ago is still live", at(ago(20_000)) === null);
  ok("five minutes ago is a Date", at(ago(5 * 60_000)) instanceof Date);
  ok("forty hours ago is a Date", at(ago(40 * 3600_000)) instanceof Date);
  ok("three days ago is null - a phone clock a week out is not a punch", at(ago(3 * 86400_000)) === null);
  ok("the future is null", at(new Date(Date.now() + 3600_000).toISOString()) === null);
  ok("garbage is null", at("yesterday-ish") === null);
  ok("a timestamp without a key is null", server.clientAt(new Request("https://x/", { method: "POST", headers: { "X-Client-At": ago(5 * 60_000) } }), "/attendance") === null,
     "the time is only trusted as part of a queued write");
  ok("a timestamp on a non-queueable route is null", server.clientAt(new Request("https://x/", { method: "POST", headers: { "Idempotency-Key": "abcdefgh-1234", "X-Client-At": ago(5 * 60_000) } }), "/web-orders/sync") === null);
}

/* ---- 4. the client mints once and always sends it ---- */
{
  ok("queueableKind names the CEO's kinds", client.queueableKind("POST", "/staff/attendance") === "punch"
     && client.queueableKind("PATCH", "/staff/tasks/4") === "task" && client.queueableKind("POST", "/staff/leave") === "leave"
     && client.queueableKind("POST", "/staff/claims") === "claim" && client.queueableKind("POST", "/staff/hotels/9/calls") === "hotel_call");
  ok("a GET is never queueable", client.queueableKind("GET", "/staff/attendance") === null);
  const keyRe = /^[A-Za-z0-9_-]{8,80}$/;
  ok("a minted key satisfies the server's pattern", Array.from({ length: 20 }, () => client.newIdempotencyKey()).every((k) => keyRe.test(k)));
  ok("keys are unique", new Set(Array.from({ length: 200 }, () => client.newIdempotencyKey())).size === 200);

  ok("api() mints the key once per call, before any attempt", /const idem = kind \? newIdempotencyKey\(\) : null;/.test(apiSrc) && /const clientAt = kind \? new Date\(\)\.toISOString\(\) : null;/.test(apiSrc),
     "minted per retry would defeat the whole point");
  ok("the live attempt carries both headers", /headers\.set\("Idempotency-Key", idem\); headers\.set\("X-Client-At", clientAt!\);/.test(apiSrc));
  ok("offline for certain parks without trying", /if \(kind && typeof navigator !== "undefined" && navigator\.onLine === false\) return park\(\);/.test(apiSrc));
  ok("a thrown fetch parks a queueable write and fails the rest as before", /catch \{[\s\S]{0,300}?if \(kind\) return park\(\);\s*return \{ ok: false, status: 0, data: null \};/.test(apiSrc));
  ok("a parked write says so", /return \{ ok: true, status: 202, data: null, queued: true \};/.test(apiSrc));
  ok("the replay sends the SAME key and pressed-at", /"Idempotency-Key": e\.id, "X-Client-At": e\.clientAt/.test(apiSrc));
  ok("a network failure stops the drain and keeps the entry", /if \(r === null\) \{ await bumpAttempts\(e\); break; \}/.test(clientSrc));
  ok("a refusal removes the entry AND tells the person", /else if \(r\.status >= 400 && r\.status < 500\) \{[\s\S]{0,300}?onRefused\?\.\(/.test(clientSrc),
     "dropping it silently would be the old failure in a new coat");
  ok("the queue is per account", /e\.scope === scope/.test(clientSrc) && /setOutboxScope\(r\.data\.user\.id\)/.test(page));
  ok("the drain starts once the account is known", /startOutbox\(sendOutboxEntry\)/.test(page));
}

/* ---- 5. the punch, the dispatcher, the register ---- */
{
  const punch = staff.slice(staff.indexOf('if (path === "/attendance" && method === "POST")'), staff.indexOf('if (path === "/attendance/ot/pending"'));
  ok("the punch reads the pressed time", /const sentLateFrom = clientAt\(request, path\);\s*const punchAt = sentLateFrom \?\? new Date\(\);/.test(punch));
  ok("the DAY is judged from the pressed time", /const todayMYT = new Date\(punchAt\.getTime\(\) \+ 8 \* 3600 \* 1000\)/.test(punch),
     "a lift ride over midnight must not move the punch to tomorrow");
  ok("late / half-day is judged from the pressed time", /const myt = new Date\(punchAt\.getTime\(\) \+ 8 \* 3600 \* 1000\);/.test(punch));
  ok("the punch handler no longer reads the clock for the day", !/const todayMYT = new Date\(Date\.now\(\)/.test(punch));
  ok("a late punch is PENDING - the CEO's decision", /const pending = body\.forgot === true \|\| sentLateFrom \? 1 : null;/.test(punch));
  ok("it records BOTH times", /created_at, offline_sent_at\)\s*VALUES \(\?1, \?2, \?3, \?4, \?5, 1, \?6, datetime\('now'\)\)/.test(punch));
  ok("the CEO is told it was sent late, with both times", /sent late from offline to approve[\s\S]{0,120}?pressed \$\{hhmm\(sentLateFrom\)\}, reached us/.test(punch));
  ok("it is audited as its own kind", /"attendance\.offline_punch"/.test(punch) && /late_by_s/.test(punch));
  ok("the dispatcher wraps every staff request", /replayOrRun\(env, request, user\.id, sub, \(\) => handleStaff\(request, env, sub, user as StaffUser\)\)/.test(index));
  ok("a replay does not bump the version", /&& !staffRes\.headers\.get\(REPLAY_HEADER\)\) \{\s*await bumpVersion/.test(index),
     "telling every open tab to reload for a no-op is a stampede");
  ok("the approver sees pressed vs arrived", /offline_sent_at/.test(rolePanels) && /sent late from offline/.test(rolePanels));
}

/* ---- 6. every queued call site says so ---- */
{
  const sites = [
    ["the punch", page, /if \(res\.queued\) \{[\s\S]{0,400}?Kept — no signal/],
    ["the no-location punch", page, /if \(res0\.queued\) \{[\s\S]{0,400}?Kept — no signal/],
    ["leave", page, /res\.queued \? L\("Kept — no signal"/],
    ["task status", page, /if \(r\.queued\) \{[\s\S]{0,200}?showTaskToast\(L\("Kept — no signal"/],
    ["task tick", page, /if \(r\.queued\) \{[\s\S]{0,300}?The tick is saved on this phone/],
    ["claim", rolePanels, /if \(res\.queued\) \{[\s\S]{0,200}?Kept — no signal/],
  ];
  for (const [name, src, re] of sites) ok(`${name} reports a kept write as kept, not done`, re.test(src), "house rule #25 - and 'saved' would be a lie for a few minutes");
  const bannerCode = banner.replace(/\/\*[\s\S]*?\*\//g, "");
  ok("the banner now says changes are kept, not lost", /kept on this phone/.test(bannerCode) && !/Changes cannot be saved/.test(bannerCode));
  ok("the banner surfaces refusals with the server's words", /setRefusalHandler\(\(r\) =>/.test(banner) && /was not accepted/.test(banner));
}

/* ---- 7. a push lands on its tab ---- */
{
  ok("notify() deep-links by kind", /const PUSH_TAB: Record<string, string> = \{/.test(staff) && /\/portal\?tab=\$\{encodeURIComponent\(tab\)\}/.test(staff));
  const tabsSrc = read("lib/portal-tabs.ts");
  const allTabs = [...(tabsSrc.match(/const ALL_TABS = \[([\s\S]*?)\] as const;/)?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  const pushTabs = [...(staff.match(/const PUSH_TAB: Record<string, string> = \{([\s\S]*?)\};/)?.[1] ?? "").matchAll(/: "([^"]+)"/g)].map((m) => m[1]);
  ok("every tab a push names is a real tab", pushTabs.length > 0 && pushTabs.every((t) => allTabs.includes(t)), pushTabs.filter((t) => !allTabs.includes(t)).join(", "));
  ok("the portal reads ?tab= once and removes it", /searchParams\.get\("tab"\)/.test(page) && /clean\.searchParams\.delete\("tab"\)/.test(page) && /history\.replaceState/.test(page));
  ok("the service worker navigates an open window by pathname", /have\.pathname === want\.pathname/.test(sw) && /w\.navigate\(want\.href\)/.test(sw));
  const shell = Number(sw.match(/const SHELL = "azone-shell-v(\d+)";/)?.[1] ?? 0);
  ok("the shell version was bumped so installed phones pick up the handler", shell >= 32, `v${shell}`);
}

/* ---- 8. the migration ---- */
{
  const mig = read("worker/migrations/0114_outbox.sql");
  ok("0114 creates the keys table with a per-person key", /PRIMARY KEY \(key, user_id\)/.test(mig));
  ok("0114 adds offline_sent_at", /ALTER TABLE attendance_records ADD COLUMN offline_sent_at TEXT;/.test(mig));
  ok("0114 is registered", index.includes('"0114_outbox",') && /const LATEST_MIGRATION = "0114_outbox"/.test(index));
  ok("0114 is probed", /\["0114 \(the outbox\)", `SELECT key FROM idempotency_keys LIMIT 1`\]/.test(index));
  ok("keys are purged nightly", /await purgeIdempotencyKeys\(env\);/.test(index) && /-7 days/.test(serverSrc));
}

if (failed) { console.log(`\n${failed} check(s) failed.`); process.exit(1); }
console.log(`PASS — one list on both ends, the same answer twice, the pressed time kept and pending, and every kept write says so (${passed} checks)`);
