/**
 * Route-reachability guard (v1.77.0) — guard #26.
 *
 * CEO, 31-08-2026, on clicking Offboard: *"staff offboard with this error"* —
 * the button answered **Staff route not found**.
 *
 * Nothing was broken in the offboarding code. The route existed, it worked,
 * it was audited. The button simply called the wrong address: staff-directory
 * builds its requests with `makeApi("/staff")`, so `/users/12/offboard`
 * became `/api/v1/staff/users/12/offboard`, while the route lives at
 * `/api/v1/users/12/offboard` in the worker's own dispatcher — offboarding
 * kills sessions and clears 2FA, so it sits with the account-lifecycle routes
 * rather than in the staff portal.
 *
 * That is a whole class of bug and it is invisible to everything else we run.
 * TypeScript cannot see it: both sides are strings. The build cannot see it.
 * A guard that reads source and greps for a handler cannot see it either,
 * because the handler is genuinely there. The only thing that catches it is
 * asking the question the browser asks: THE CLIENT SENDS THIS PATH — IS
 * ANYBODY LISTENING AT IT?
 *
 * So this guard resolves every API call in every client file to the full path
 * it will actually put on the wire, then checks that path against the routes
 * the worker really serves: the literals and regexes in index.ts, and — for
 * anything under /api/v1/staff/ — the ones in staff.ts. An id in a template
 * hole becomes a number, which is what those routes match on.
 *
 * A path nothing serves is a button that 404s. It will not be found in
 * review, because the code around it is correct; it is found by whoever
 * clicks it, which this time was the CEO.
 *
 *   node tests/api-routes.mjs
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

/* ------------------------------------------------------------------ *
 * 1. What the worker serves.
 * ------------------------------------------------------------------ */

/** Every `path === "..."`, `path.startsWith("...")` and `path.match(/^...$/)`
    in a worker file, as things a full path can be tested against. Regexes are
    lifted wherever they appear rather than only inside `path.match(...)`,
    because several routes keep the pattern in a `const` on its own line. */
const routesOf = (src, base) => {
  const exact = new Set();
  const patterns = [];
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const m of src.matchAll(/path === "([^"]+)"/g)) exact.add(base + m[1]);
  for (const m of src.matchAll(/path\.startsWith\("([^"]+)"\)/g)) {
    /* index.ts opens the staff portal with `path.startsWith("/api/v1/staff/")`
       and hands the rest to handleStaff. That line is a DOOR, not a route:
       treating it as one would mark every conceivable /api/v1/staff/... path
       as served and this guard would pass on anything. It is exactly what let
       the offboard 404 through in the first draft. Staff paths are checked
       against staff.ts and nowhere else. */
    if (m[1] === "/api/v1/staff/") continue;
    /* v1.89.0: the same door, one level down. staff.ts hands everything
       under /threads/ to threads.ts; the routes are read from THAT file with
       its own base, below, so a path the module never answers still fails. */
    if (m[1] === "/threads/") continue;
    patterns.push(new RegExp(`^${esc(base + m[1])}`));
  }
  /* /^\/inventory\/(\d+)\/adjust$/ and friends — anchored path regexes. */
  for (const m of src.matchAll(/\/\^((?:\\.|\[[^\]]*\]|[^/\\])*?)\$\//g)) {
    if (!m[1].startsWith("\\/")) continue; // a path pattern starts at a slash
    try { patterns.push(new RegExp(`^${esc(base)}${m[1]}$`)); } catch { /* not a route */ }
  }
  return { exact, patterns, serves: (p) => exact.has(p) || patterns.some((r) => r.test(p)) };
};

const index = read("worker/src/index.ts");
const staffSrc = read("worker/src/staff.ts");
const rootRoutes = routesOf(index, "");
const staffRoutes = routesOf(staffSrc, "/api/v1/staff");
const threadsRoutes = routesOf(read("worker/src/threads.ts"), "/api/v1/staff/threads");

ok("the worker's own routes were found", rootRoutes.exact.size > 30,
   `${rootRoutes.exact.size} exact routes in index.ts — if this collapses, every check below passes vacuously`);
ok("the staff portal's routes were found", staffRoutes.exact.size > 50,
   `${staffRoutes.exact.size} exact routes in staff.ts`);

ok("the Threads module's routes were found", threadsRoutes.exact.size >= 3,
   `${threadsRoutes.exact.size} exact routes in threads.ts — the door in staff.ts is excluded on purpose, so these must be seen here`);

const served = (full) => rootRoutes.serves(full) || staffRoutes.serves(full) || threadsRoutes.serves(full);

/* ------------------------------------------------------------------ *
 * 2. What the client sends.
 * ------------------------------------------------------------------ */

/** The first argument of a call, read as source text: handles nested template
    literals like `/roster${w ? `?week=${w}` : ""}`, which a regex cannot. */
const firstArg = (src, from) => {
  let i = from;
  while (i < src.length && /\s/.test(src[i])) i++;
  const q = src[i];
  if (q !== "`" && q !== '"' && q !== "'") return null;
  let out = "";
  let depth = 0;
  for (i++; i < src.length; i++) {
    const c = src[i];
    if (c === "\\") { out += c + src[++i]; continue; }
    if (q === "`" && c === "$" && src[i + 1] === "{") { depth++; i++; out += "${"; continue; }
    if (depth > 0) {
      if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === "`") { // a template inside the hole: skip it whole
        for (i++; i < src.length && src[i] !== "`"; i++) if (src[i] === "\\") i++;
      }
      out += depth === 0 ? "}" : "";
      continue;
    }
    if (c === q) return out;
    if (c === "\n") return null;
    out += c;
  }
  return null;
};

/** The paths one call can actually put on the wire.

    A hole is nearly always an id — `/users/${u.id}/offboard` — and ids are
    numbers, which is what those route patterns match. But a hole is sometimes
    a query string built a line earlier (`/audit${q}` where q is `?action=x`),
    so the empty reading counts too. If either is served, the call is fine. */
const readings = (raw) => {
  const trim = (s) => s.split("?")[0].split("#")[0];
  return [trim(raw.replace(/\$\{[^}]*\}/g, "42")), trim(raw.replace(/\$\{[^}]*\}/g, ""))];
};

/** A path whose FIRST segment is itself a hole — `/${resource}/${id}` in the
    admin CRUD component — names a route chosen at runtime. Nothing static can
    resolve it, so it is counted and reported rather than guessed at. */
const unresolvable = (raw) => /^\/\$\{/.test(raw);

const files = [];
const walk = (dir) => {
  for (const e of readdirSync(path.join(root, dir))) {
    if (e === "node_modules" || e === ".next") continue;
    const rel = `${dir}/${e}`;
    if (statSync(path.join(root, rel)).isDirectory()) walk(rel);
    else if (/\.tsx?$/.test(e)) files.push(rel);
  }
};
for (const d of ["app", "components"]) walk(d);

const unserved = [];
let calls = 0;
let runtimeChosen = 0;

for (const rel of files) {
  const src = read(rel);
  if (!/from "@\/lib\/api"/.test(src) && !/from "@\/lib\/cached-api"/.test(src)) continue;

  /* Which helper name carries which base. `api` imported bare is the root. */
  const bases = new Map();
  if (/import \{[^}]*\bapi\b[^}]*\} from "@\/lib\/api"/.test(src)) bases.set("api", "/api/v1");
  /* v1.104.0 - a remembered view (lib/cached-api) names its FULL path, so
     the hook is a caller too. Without this line every card converted in
     roadmap phase 02 silently left this guard's sight. */
  if (/import \{[^}]*\buseCachedApi\b[^}]*\} from "@\/lib\/cached-api"/.test(src)) bases.set("useCachedApi", "/api/v1");
  for (const m of src.matchAll(/const (\w+)\s*=\s*makeApi\("([^"]*)"\)/g)) {
    bases.set(m[1], `/api/v1${m[2]}`);
  }

  for (const [name, base] of bases) {
    const call = new RegExp(`\\b${name}\\s*(?:<[\\s\\S]*?>)?\\s*\\(`, "g");
    for (const m of src.matchAll(call)) {
      const raw = firstArg(src, m.index + m[0].length);
      if (raw === null || !raw.startsWith("/")) continue;
      calls++;
      if (unresolvable(raw)) { runtimeChosen++; continue; }
      if (readings(raw).some((p) => served(base + p))) continue;
      const line = src.slice(0, m.index).split("\n").length;
      unserved.push(`${rel}:${line}  ${name}(\`${raw}\`)  ->  ${base}${readings(raw)[0]}`);
    }
  }
}

ok("client API calls were found to check", calls > 100,
   `${calls} calls — a low number means the extractor stopped seeing them, not that the portal got smaller`);
ok("every path the portal calls is served by the worker", unserved.length === 0,
   `\n      ${unserved.join("\n      ")}\n      — the handler may be perfect; the button still 404s`);
ok("the handful of runtime-chosen paths stays a handful", runtimeChosen <= 6,
   `${runtimeChosen} calls name their route at runtime (\`/\${resource}\`) and cannot be checked — ` +
   "the admin CRUD component is the reason there are any; a growing number means this guard is quietly covering less");

/* ------------------------------------------------------------------ *
 * 3. The Offboard button — the 404 that started this, and the date.
 * ------------------------------------------------------------------ */
{
  const dir = read("components/staff/staff-directory.tsx");

  /* CEO, 31-08-2026: *"offboard should I can insert the date of their
     resignation which is to ensure that I can insert correctly instead of
     capture to today date"*. `left_on` is what payroll prorates a final month
     on, so the date is money, not decoration. */
  ok("offboarding asks for the last day",
     /date: \{\s*\n?\s*label: L\("Last day of employment"/.test(dir),
     "it used to take today, which is only right if somebody walks out the moment you press it");
  ok("the date cannot be left empty",
     /label: L\("Last day of employment"[\s\S]{0,200}?required: true/.test(dir) &&
     /if \(!r\?\.date\) return;/.test(dir),
     "an OK button that submits no date puts the server back on today");
  ok("the chosen date is what gets sent",
     /body: JSON\.stringify\(\{ left_on: r\.date \}\)/.test(dir));
  ok("the suggested date is today in MALAYSIA",
     /const todayIso = \(\) => new Date\(Date\.now\(\) \+ 8 \* 3600 \* 1000\)/.test(dir),
     "a laptop on UTC would otherwise propose yesterday as somebody's last day");
  ok("the server refuses a date it cannot read instead of substituting today",
     /if \(bodyOb\.left_on !== undefined &&[\s\S]{0,200}?return errorResponse\("invalid_input", "Last day must be a date/.test(index),
     "a silent substitution is a final salary computed against a day nobody chose");
  ok("omitting the date still means today, so an older client keeps working",
     /const leftOn = typeof bodyOb\.left_on === "string"\s*\n?\s*\? bodyOb\.left_on/.test(index));
  ok("the confirmation says which day it recorded",
     /last day \$\{dmy\(res\.data\?\.left_on \?\? r\.date\)\}/.test(dir),
     "the one field worth getting wrong is the one worth reading back");
  ok("offboarding is called at the API root, not through the staff prefix",
     /const apiRoot = makeApi\(""\)/.test(dir) &&
     /apiRoot<[^>]*>\(`\/users\/\$\{u\.id\}\/offboard`/.test(dir),
     "makeApi(\"/staff\") sent it to /api/v1/staff/users/42/offboard, which nothing serves");
  ok("the route it now calls is the audited one that clears 2FA and sessions",
     /path\.startsWith\("\/api\/v1\/users\/"\) && path\.endsWith\("\/offboard"\)/.test(index));
  /* v1.104.0 - the staff LIST now arrives through useCachedApi, which takes
     the full path ("/staff/users"); every other call in the file still goes
     through the staff-prefixed helper. Either spelling reaches the same
     route, and that route is the property. */
  ok("the staff directory still uses the staff prefix for everything else",
     /const api = makeApi\("\/staff"\)/.test(dir) &&
     (/api<[^>]*>\(`\/users`\)/.test(dir) || /useCachedApi<[^(]*\("\/staff\/users"/.test(dir)),
     "the fix was one call site, not a base change for the whole file");
}

console.log(
  fails.length === 0
    ? `PASS — every button in the portal calls an address something answers at (${pass} checks, ${calls} calls, ${files.length} files)`
    : `\n${fails.map((f) => `  ✗ ${f}`).join("\n")}\n\n${fails.length} check(s) failed.`,
);
process.exit(fails.length === 0 ? 0 : 1);
