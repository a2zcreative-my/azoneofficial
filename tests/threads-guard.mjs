/**
 * Threads-workspace guard (v1.89.0) — guard #33.
 *
 * CEO, 04-09-2026: *"for Threads I want new tabs all in 1 tabs for the
 * Threads with minimalist interface"*. Phase 1 connects a Threads account,
 * imports its history and snapshots its numbers. It is the first module in
 * this portal to hold a credential for a PUBLIC account that can post — so
 * the properties below are about the credential and the budget, not the UI.
 *
 * Each check asserts a PROPERTY, per the rule at the top of
 * scripts/run-guards.mjs; none pins a line of prose or a count that a
 * correct change would move. Every check was negative-tested before it
 * counted (the mutation that makes each one fail is named beside it).
 *
 *   node tests/threads-guard.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const root = new URL("..", import.meta.url).pathname;
const read = (p) => (existsSync(path.join(root, p)) ? readFileSync(path.join(root, p), "utf8") : "");

let pass = 0;
const fails = [];
const ok = (label, cond, extra = "") => {
  if (cond) pass++;
  else fails.push(`${label}${extra ? ` — ${extra}` : ""}`);
};

const threads = read("worker/src/threads.ts");
const index = read("worker/src/index.ts");
const staff = read("worker/src/staff.ts");
const perms = read("worker/src/permissions.ts");
const panel = read("components/portal/threads-panel.tsx");
const toml = read("worker/wrangler.toml");

ok("the module exists", threads.length > 2000, "worker/src/threads.ts is missing or empty — everything below passes vacuously");

/* ---- 1. the token never leaves the worker ----
   (negative-tested by adding `access_token` to the /accounts SELECT) */
{
  /* Every SELECT that reads integration_tokens must be in a function that
     hands the token to Threads, never to a Response. Cheap proxy that holds:
     the only SELECTs naming access_token are the tokenFor helper and the
     refresh JOIN, and no `json(` call in the file mentions a token field. */
  /* The routes are everything from handleThreads to the end of the file.
     Nothing in there may name the token column, and the only statement that
     may touch integration_tokens is the DELETE on disconnect. */
  const routes = threads.slice(threads.indexOf("export async function handleThreads"));
  ok("the routes were found", routes.length > 2000);
  ok("no route names the token column", !/access_token|refresh_token/.test(routes),
     "a SELECT that carries the token is one JSON.stringify away from the browser");
  ok("the only route statement on integration_tokens is the disconnect DELETE",
     [...routes.matchAll(/integration_tokens/g)].length === 1 && /DELETE FROM integration_tokens WHERE provider = \?1/.test(routes),
     "a read of the token table inside a route is a token on its way out");
  const responses = [...threads.matchAll(/json\(\{[\s\S]*?\}\)/g)].map((m) => m[0]);
  ok("no route response carries a token", responses.length > 3 && responses.every((r) => !/access_token|refresh_token|token:/.test(r)),
     "a route returned a field that looks like a token");
  ok("the accounts list is selected column by column, never SELECT *",
     /SELECT a\.id, a\.username[\s\S]*?FROM threads_accounts a/.test(threads) && !/SELECT \* FROM threads_accounts/.test(threads),
     "SELECT * would carry every future column, including one that should not travel");
}

/* ---- 2. the secret is read from env in exactly one file ----
   (negative-tested by referencing THREADS_APP_SECRET in staff.ts) */
{
  const filesWithSecret = ["worker/src/index.ts", "worker/src/staff.ts", "worker/src/erp.ts", "worker/src/bridge.ts", "worker/src/shared.ts"]
    .filter((f) => /THREADS_APP_SECRET\b(?!\?: string)/.test(read(f).replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "")));
  ok("only threads.ts reads THREADS_APP_SECRET", filesWithSecret.length === 0,
     `${filesWithSecret.join(", ")} also read the secret — one file, one place to audit`);
  ok("the secret is declared optional on Env, so an unset worker degrades instead of throwing",
     /THREADS_APP_SECRET\?: string;/.test(index));
  ok("no credential literal is committed", !/client_secret=[A-Za-z0-9]{10,}|THREADS_APP_SECRET\s*=\s*"/.test(threads + index + toml),
     "the secret belongs in `wrangler secret put`, never in a file");
}

/* ---- 3. every management mutation is audited and gated ----
   (negative-tested by removing the audit from /disconnect) */
{
  /* The window after each route matcher, as it is written in the source. */
  const after = (matcher, n) => {
    const i = threads.indexOf(matcher);
    return i < 0 ? "" : threads.slice(i, i + n);
  };
  const SYNC = "/^\\/accounts\\/(\\d+)\\/sync$/";
  const DISC = "/^\\/accounts\\/(\\d+)\\/disconnect$/";
  const LABEL = "/^\\/accounts\\/(\\d+)$/";
  ok("the three route matchers were found", [SYNC, DISC, LABEL].every((m) => threads.includes(m)),
     "the matchers moved — the checks below would pass on nothing");
  for (const [name, m, action] of [["sync", SYNC, "threads.sync"], ["disconnect", DISC, "threads.disconnected"], ["relabel", LABEL, "threads.relabel"]]) {
    ok(`${name} is audited`, after(m, 1400).includes(`audit(env, user.id, "${action}"`), "an unaudited action on a credential is one nobody can trace");
  }
  for (const [name, m] of [["sync", SYNC], ["disconnect", DISC], ["relabel", LABEL]]) {
    ok(`${name} needs threads_manage`, /if \(!manage\) return err\("forbidden"/.test(after(m, 400)), "a viewer could act on the credential");
  }
  ok("connecting is audited too", /audit\(env, actorId, "threads\.connected"/.test(threads));
  ok("the whole module is behind threads_view", /if \(!can\(user\.role, "threads_view"\)\) return err\("forbidden"/.test(threads));
  ok("both permissions exist in the matrix", /threads_view:/.test(perms) && /threads_manage:/.test(perms));
  ok("threads_manage is a subset of threads_view", (() => {
    const v = perms.match(/threads_view: \[([^\]]*)\]/)?.[1] ?? "";
    const m = perms.match(/threads_manage: \[([^\]]*)\]/)?.[1] ?? "";
    const set = new Set([...v.matchAll(/"(\w+)"/g)].map((x) => x[1]));
    const mm = [...m.matchAll(/"(\w+)"/g)].map((x) => x[1]);
    return mm.length > 0 && mm.every((r) => set.has(r));
  })(), "a role that can connect an account must at least be able to see the tab");
}

/* ---- 3b. v1.94.0: the authorise host, and clean credentials ----
   (negative-tested by pointing AUTH_URL back at threads.net and by dropping
   the trims) */
{
  ok("the browser is sent straight to the host that serves the page",
     /const AUTH_URL = "https:\/\/www\.threads\.com\/oauth\/authorize";/.test(threads),
     "threads.net forwards to threads.com, and a forward is where a query string goes to die - the authorise page then sees no client_id and answers with an error that names nothing");
  ok("every credential is trimmed at the point it is read",
     /export const threadsAppId = \(env: Env\)[^=]*=> \(env\.THREADS_APP_ID \?\? ""\)\.trim\(\);/.test(threads)
     && /export const threadsAppSecret = \(env: Env\)[^=]*=> \(env\.THREADS_APP_SECRET \?\? ""\)\.trim\(\);/.test(threads),
     "a pasted secret very often carries a trailing newline, and client_id=1234%0A is not an app id");
  ok("nothing reads the raw env value except the trims and the setup report",
     [...threads.matchAll(/env\.THREADS_APP_(?:ID|SECRET)/g)].length === 4,
     "one place to trim is one place to get it wrong");
  /* Scoped to the REPORT, because the token exchange legitimately sends the
     secret to Meta a few lines away — a file-wide ban would have failed on
     the one place that is supposed to use it. */
  {
    const i = threads.indexOf("export function threadsSetupReport(");
    /* The whole function, header AND body: `\n}` first closes the RETURN
       TYPE object, which is 190 characters in and would have made this
       check pass on nothing. */
    const report = i < 0 ? "" : threads.slice(i, i + 1200);
    ok("the setup report says whether the secret is set, never what it is",
       report.length > 200 && /secret_set: Boolean\(rawSecret\.trim\(\)\)/.test(report)
       && !/secret: rawSecret|client_secret/.test(report),
       "a diagnostic that prints the value it is diagnosing is a leak with a helpful label");
  }
  ok("the report lives with the secret, not at the route",
     /export function threadsSetupReport\(env: Env\)/.test(threads) && /\.\.\.threadsSetupReport\(env\)/.test(index));
}

/* ---- 3c. v1.96.0: study cases spend a rationed, shared allowance ----
   (negative-tested by removing the quota check, by opening a search to
   threads_view, and by letting the topic route claim a view count) */
{
  ok("the keyword-search scope is asked for", /const SCOPES = "[^"]*threads_keyword_search/.test(threads),
     "asserted on the SCOPES constant, not on the file: the first draft matched the word in a comment and stayed green with the scope removed");
  ok("a search is refused before Meta refuses it",
     /if \(quota\.left <= 0\)[\s\S]{0,300}?return err\("rate_limited"/.test(threads),
     "a quota you discover by being cut off is a quota nobody can plan around");
  ok("the cap leaves headroom under Meta's own", /const SEARCH_WEEK_CAP = (\d+);/.test(threads)
     && Number(threads.match(/const SEARCH_WEEK_CAP = (\d+);/)?.[1] ?? 0) < 500);
  ok("every search is recorded, successful or not",
     [...threads.matchAll(/INSERT INTO threads_searches/g)].length === 2,
     "a failed call still spends the allowance, so a count that only records successes drifts under the truth");
  /* Windows taken with indexOf on the matcher AS WRITTEN — a regex of a
     regex is two levels of escaping and the first draft of this check
     matched nothing at all, which is a check that passes on air. */
  const win = (marker, n) => { const i = threads.indexOf(marker); return i < 0 ? "" : threads.slice(i, i + n); };
  const SEARCH_ROUTE = "/^\\/topics\\/(\\d+)\\/search$/";
  const TOPIC_ROUTE = "/^\\/topics\\/(\\d+)$/";
  ok("the topic route matchers were found", threads.includes(SEARCH_ROUTE) && threads.includes(TOPIC_ROUTE),
     "the matchers moved - the two checks below would pass on nothing");
  ok("spending a search needs threads_manage",
     /if \(!manage\) return err\("forbidden"/.test(win(SEARCH_ROUTE, 400)),
     "the allowance is one shared weekly ration for the whole app");
  ok("adding and removing a topic needs it too",
     /path === "\/topics" && method === "POST"[\s\S]{0,200}?if \(!manage\)/.test(threads)
     && /if \(!manage\) return err\("forbidden"/.test(win(TOPIC_ROUTE, 400)));
  ok("reading a harvest does not", /path === "\/study" && method === "GET"[\s\S]{0,200}?const topicId/.test(threads),
     "the marketing floor should be able to read what was collected");
  ok("every topic action is audited",
     ["threads.topic_add", "threads.topic_remove", "threads.topic_search"].every((a) => threads.includes(`"${a}"`)));
  /* v1.96.1 — the two parameters Meta actually reads. The first release put
     KEYWORD/TAG in search_type and Meta refused every search. (negative-
     tested by putting "KEYWORD" back in search_type, and by gating the
     import fallback on code 100 again) */
  ok("search_type carries the ORDER (TOP/RECENT), never the match mode",
     /const SEARCH_ORDERS = \["TOP", "RECENT"\] as const;/.test(threads)
     && /search_type: order,/.test(threads)
     && !/search_type: [^,\n]*(KEYWORD|TAG)/.test(threads),
     "Meta: Param search_type must be one of {RECENT, TOP}");
  ok("the match mode goes in search_mode", /search_mode: withMode \? mode : undefined,/.test(threads)
     && /const mode = topic\.search_type === "tag" \? "TAG" : "KEYWORD";/.test(threads));
  ok("history import falls back on ANY failed attempt, not only code 100",
     /for \(let i = 1; !r\.ok && i < attempts\.length/.test(threads) && !/!r\.ok && r\.code === 100/.test(threads),
     "the A2Z account came back HTTP 500, which is not code 100, and sat at zero posts");
  /* v1.96.2 — the scope is written down at connect, and a token without it
     is refused BEFORE a search is spent. (negative-tested by dropping
     granted_scopes from the connect upsert, and by picking the search
     account without the CAN_SEARCH_SQL condition) */
  ok("connecting records the scopes asked for", /granted_scopes = \?5`,\s*\)\.bind\([^`;]*?, SCOPES\),/.test(threads),
     "an account whose scopes nobody wrote down cannot be told from one that can search");
  ok("a search only asks with a token that holds the scope",
     /WHERE a\.is_active = 1 AND \$\{CAN_SEARCH_SQL\}/.test(threads) && /const acc = await searchAccount\(env\);/.test(win(SEARCH_ROUTE, 1600)),
     "Meta answers a token without the scope with An unknown error occurred, which nobody can read as reconnect");
  ok("the Study section says reconnect before the button, not after Meta",
     /search_blocker/.test(threads) && /searchBlocker/.test(panel) && /setSection\("connection"\)/.test(panel));
  ok("a missing scope is reported as such, not as an empty niche",
     /needs_reconnect: res\.needs_reconnect/.test(threads) && /needs_reconnect/.test(panel),
     "a search that silently returns nothing reads as a quiet subject, which is the opposite of the truth");
  /* The one thing this data cannot carry. */
  /* Scoped to the STUDY read, not to everything between two markers: the
     own-posts route sits in that span and its view counts are real. */
  ok("no study query pretends to a view count",
     !/views/i.test(win('path === "/study" && method === "GET"', 1400)),
     "insights belong to the account that owns a post - a views column here would always be null");
  /* On screen AND on the export, because the CSV outlives the screen it
     was taken from. Counted, not merely found: the phrase appears in the
     card's own comment too, and one occurrence would have kept this green
     with the visible line deleted. */
  ok("the caveat is on the screen and on the export",
     [...panel.matchAll(/no view counts/g)].length >= 2,
     "a share of posts read as a share of eyeballs is the one wrong conclusion this card can produce");
}

/* ---- 4. the OAuth pair agrees with itself and names no domain ----
   (negative-tested by hardcoding the callback URL) */
{
  const connect = index.slice(index.indexOf('"/api/v1/integrations/threads/connect"'), index.indexOf('"/api/v1/integrations/threads/callback"'));
  const callback = index.slice(index.indexOf('"/api/v1/integrations/threads/callback"'), index.indexOf("TikTok seller authorization callback"));
  ok("both routes exist", connect.length > 100 && callback.length > 100);
  ok("the redirect URI is derived, never written", !/https?:\/\/[a-z0-9.-]+\.(my|com)/i.test(connect + callback),
     "a literal domain in the OAuth pair breaks the day the domain changes, and brands-guard bans it anyway");
  ok("connect and callback derive the same URI", /allowedOrigins\(env\)\.includes\(origin\) \? origin : primaryOrigin\(env\)/.test(connect)
     && /allowedOrigins\(env\)\.includes\(origin\) \? origin : primaryOrigin\(env\)/.test(callback));
  ok("the state cookie is checked on the way back", /state !== cookieState/.test(callback));
  ok("both routes need a management session", /can\(me\.role, "threads_manage"\)/.test(connect) && /can\(me\.role, "threads_manage"\)/.test(callback));
}

/* ---- 5. work is budgeted ----
   (negative-tested by removing the `rep.spent >= rep.budget` break in the snapshot loop) */
{
  /* Per helper: every Graph call inside a tick helper is paid for with a
     rep.spent++ in the same function. threadsCompleteAuth is a person
     pressing Connect, not a tick, and is not held to it. */
  const helpers = ["refreshDueTokens", "importPage", "snapshotPost", "snapshotAccount"];
  const bodyOf = (name) => {
    const i = threads.indexOf(`async function ${name}(`);
    if (i < 0) return "";
    const rest = threads.slice(i + 10);
    const j = rest.search(/\n(?:export )?(?:async )?function |\n\/\*\* |\nexport /);
    return rest.slice(0, j < 0 ? undefined : j);
  };
  for (const h of helpers) {
    const b = bodyOf(h);
    const calls = [...b.matchAll(/graph</g)].length;
    const spends = [...b.matchAll(/rep\.spent\+\+/g)].length;
    ok(`${h} pays for every Graph call`, b.length > 100 && calls >= 1 && spends >= calls,
       `${calls} call(s), ${spends} spend(s) — a call that does not spend the budget is one the free plan's ceiling will eventually kill mid-tick`);
  }
  ok("the snapshot loop stops at the budget", /for \(const p of due\) \{\s*\n?\s*if \(rep\.spent >= rep\.budget\) break;/.test(threads));
  ok("the page loop stops at the budget", /while \(a\.sync_state === "importing" && pages < PAGES_PER_TICK && rep\.spent < rep\.budget\)/.test(threads));
  ok("the cron tick is caught", /try \{\s*\n?\s*const t = await threadsTick\(env\);[\s\S]{0,300}?\} catch/.test(index),
     "a Threads failure must never take the low-stock sweep down with it");
  ok("the tick runs on a cron that exists", /event\.cron === "\*\/30 \* \* \* \*"/.test(index) || /crons = \[[^\]]*"\*\/30 \* \* \* \*"/.test(toml));
}

/* ---- 6. snapshots are append-only ----
   (negative-tested by turning the metrics INSERT into a plain UPDATE) */
{
  ok("a snapshot is keyed by the day", /INSERT INTO threads_post_metrics \(post_id, captured_on/.test(threads));
  ok("nothing deletes a snapshot", !/DELETE FROM threads_post_metrics|DELETE FROM threads_account_metrics/.test(threads));
  ok("disconnecting keeps the posts", !/DELETE FROM threads_posts/.test(threads) && /UPDATE threads_accounts SET is_active = 0/.test(threads),
     "the history is the asset; the token is what goes");
}

/* ---- 7. the tab is wired everywhere a tab must be ----
   (negative-tested by removing the staff.ts door) */
{
  ok("the staff dispatch has the door", /path === "\/threads" \|\| path\.startsWith\("\/threads\/"\)/.test(staff));
  ok("the door hands over the query string", /handleThreads\(env, path\.slice\("\/threads"\.length\), method, body, user, new URL\(request\.url\)\.searchParams\)/.test(staff));
  ok("the panel calls the module's base", /makeApi\("\/staff\/threads"\)/.test(panel));
  ok("the panel connects through the worker redirect, not by holding a token",
     /window\.location\.href = "\/api\/v1\/integrations\/threads\/connect"/.test(panel) && !/access_token/.test(panel));
}

/* ---- 8. the panel keeps the house rules ----
   (negative-tested by re-filtering rows inside exportCsv) */
{
  ok("the CSV reads the same rows as the table", /\.\.\.posts\.map\(\(p\) => \[/.test(panel) && !/exportCsv[\s\S]{0,600}?posts\.filter\(/.test(panel),
     "two definitions of the rows on screen disagree the first time a filter is added");
  ok("every figure tile that has rows behind it opens them", (() => {
    const tiles = [...panel.matchAll(/<StatTile [\s\S]*?\/>/g)].map((m) => m[0]);
    const withRows = tiles.filter((t) => /Views|Posts|Tontonan|Hantaran/.test(t));
    return tiles.length >= 4 && withRows.length >= 3 && withRows.every((t) => /onClick=/.test(t));
  })(), "a count you can read and cannot follow is the dead end guard #31 exists for");
  ok("the followers tile makes no promise it cannot keep", (() => {
    const t = [...panel.matchAll(/<StatTile [\s\S]*?\/>/g)].map((m) => m[0]).find((x) => /Followers/.test(x)) ?? "";
    return t.length > 0 && !/onClick=/.test(t);
  })(), "followers is a number, not a list — a button there opens nothing");
  ok("every mutation reports", ["syncNow", "disconnect", "saveLabel"].every((fn) => {
    const i = panel.indexOf(`const ${fn} = async`);
    if (i < 0) return false;
    const rest = panel.slice(i + 10);
    const j = rest.search(/\n  const \w+ = /); // the next top-level const in the component
    return /toast\(/.test(rest.slice(0, j < 0 ? undefined : j));
  }), "a mutation that says nothing either way is guard #25's whole subject");
  ok("no loading state is spelled out", !/Loading|Memuatkan/.test(panel), "skeletons, not words (guard #28)");
}

console.log(
  fails.length === 0
    ? `PASS — the Threads credential stays in the worker, every action on it is audited, and the work is budgeted (${pass} checks)`
    : `\n${fails.map((f) => `  ✗ ${f}`).join("\n")}\n\n${fails.length} check(s) failed.`,
);
process.exit(fails.length === 0 ? 0 : 1);
