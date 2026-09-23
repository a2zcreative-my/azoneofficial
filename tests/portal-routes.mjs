#!/usr/bin/env node
/**
 * THE PORTAL'S ADDRESSES — P1.0, v1.180.0.
 *
 * P1 turns 33 `activeTab === "…"` branches into 29 real URLs. This guard is
 * what stops that becoming two lists: the registry's, and the router's.
 *
 * It RUNS `lib/portal-routes.ts` rather than reading it. Every rule below is
 * a precedence rule or a permission rule, and both kinds are invisible in a
 * diff — "does a remembered tab beat a push link" is not a question a regex
 * can be asked. So the module is bundled and called, against the real
 * registry, for eight real roles.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * NO STAGE IS EVER RED.  (the owner's Correction 3, 22-09-2026)
 *
 * The first draft put route-DIRECTORY parity here, in P1.0, where it could
 * not pass until P1.2 created the files — so P1.1 would have shipped into a
 * knowingly failing gate. That is how a team learns to ignore a red build.
 *
 * The fix is not to delay the assertion; it is to write a stronger one:
 *
 *     route directories under app/portal/        verdict
 *     ───────────────────────────────────        ──────────────────
 *     none                                       PASS   (P1.0, P1.1)
 *     all 29, and nothing else                   PASS   (P1.2 onward)
 *     some                                       FAIL   ← the real bug
 *
 * A partial set — a module with no route, or a route with no module — is the
 * only genuinely broken state, and it is exactly the one the old formulation
 * could not tell apart from "not yet".
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Negative-tested by: giving a parked tab a slug (1 fails); duplicating a
 * slug (3 fails); making Dashboard's slug "" again (4 fails); letting
 * resolveLegacyTab trust `raw` (8 fails); putting the remembered tab above
 * the legacy ?tab= (9 fails); creating one route directory (13 fails).
 */
import { readFileSync, existsSync, readdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");
/* v1.139.2 - a path that goes into generated source is written with forward
   slashes: on Windows a backslash inside a double-quoted import specifier is
   an escape sequence, not a separator. */
const importPath = (p) => p.replace(/\\/g, "/");

let failed = 0, passed = 0;
const ok = (label, cond, why = "") => {
  if (cond) passed++; else { failed++; console.log(`  ✗ ${label}${why ? ` — ${why}` : ""}`); }
};

/* ---- build the two modules under test, with the @/ alias resolved ---- */
const dir = mkdtempSync(join(tmpdir(), "routes-"));
writeFileSync(join(dir, "entry.ts"), [
  `export * from "${importPath(join(root, "lib/portal-routes.ts"))}";`,
  `export { ALL_TABS, PARKED_TABS, ALWAYS_VISIBLE, TAB_ROUTE, canSeeTab } from "${importPath(join(root, "lib/portal-tabs.ts"))}";`,
].join("\n"));
const out = join(dir, "routes.mjs");
execSync(
  `npx esbuild "${join(dir, "entry.ts")}" --bundle --format=esm --platform=neutral --outfile="${out}" ` +
  `--alias:@=. --log-level=error`,
  { cwd: root, stdio: "inherit" },
);
const M = await import(pathToFileURL(out).href);

const {
  ALL_TABS, PARKED_TABS, TAB_ROUTE, canSeeTab,
  PORTAL_ENTRY, PORTAL_HOME,
  slugOf, pathOf, tabOfSlug, tabOfPath, isPortalPath,
  resolveLegacyTab, resolveEntry, rememberedIsStale, permittedTabs, isKnownTab,
} = M;

const ACTIVE = ALL_TABS.filter((t) => !PARKED_TABS.includes(t));
const all = (role) => permittedTabs(role);

console.log("portal-routes — running the resolver\n");

/* ---- 1-4. the registry's URL half ------------------------------------ */
{
  ok("every ACTIVE tab has a route", ACTIVE.every((t) => slugOf(t) !== null),
     ACTIVE.filter((t) => slugOf(t) === null).join(", "));
  ok("every PARKED tab has NONE", PARKED_TABS.every((t) => slugOf(t) === null),
     "a slug for a parked tab is an address that resolves for nobody, which invites a route file and a bug report");
  ok("the two lists are the same size", Object.keys(TAB_ROUTE).length === ACTIVE.length,
     `${Object.keys(TAB_ROUTE).length} routes for ${ACTIVE.length} active tabs`);

  for (const [tab, route] of Object.entries(TAB_ROUTE)) {
    ok(`${tab}: schema`, typeof route.slug === "string"
      && (route.record === undefined || (typeof route.record === "string" && /^[a-z][a-z0-9_]*$/.test(route.record)))
      && (route.context === undefined || ["none", "detail", "rail"].includes(route.context)));
    ok(`${tab}: slug "${route.slug}" is kebab and url-safe`, /^[a-z][a-z0-9-]*$/.test(route.slug));
    ok(`${tab}: slug is not a segment Next owns`, !["_next", "api", "static"].includes(route.slug));
  }
  const slugs = Object.values(TAB_ROUTE).map((r) => r.slug);
  ok("slugs are unique", new Set(slugs).size === slugs.length,
     slugs.filter((s, i) => slugs.indexOf(s) !== i).join(", "));
  ok("no slug is empty", slugs.every((s) => s.length > 0),
     "an empty slug would make /portal a destination again, which is the bug Correction 1 removed");

  /* ENTRY IS NOT HOME */
  ok("the Dashboard's slug is `home`", slugOf("Dashboard") === "home");
  ok("pathOf(Dashboard) is /portal/home, by the ordinary rule", pathOf("Dashboard") === PORTAL_HOME);
  ok("PORTAL_ENTRY is not PORTAL_HOME", PORTAL_ENTRY !== PORTAL_HOME,
     "a person standing on /portal/sales who presses Home must not be sent back to Sales by the resolver");
  ok("no tab claims /portal itself", ALL_TABS.every((t) => pathOf(t) !== PORTAL_ENTRY));
}

/* ---- 5-6. paths round-trip, and nothing else resolves ---------------- */
{
  for (const t of ACTIVE) {
    ok(`${t}: pathOf -> tabOfPath round-trips`, tabOfPath(pathOf(t)) === t);
  }
  for (const t of PARKED_TABS) {
    ok(`${t}: parked, so no path and no slug resolves back to it`,
       pathOf(t) === null && tabOfSlug(t.toLowerCase()) !== t);
  }
  const nulls = [
    ["/portal", "the resolver is not a module"],
    ["/portal/", "trailing slash on the resolver"],
    ["/portal/nonsense", "unknown slug"],
    ["/portal/threads", "a parked module has no slug"],
    ["/portal/sales/QT-10342", "records are query strings, never a second segment"],
    ["/portal/sales/", "a trailing slash is tolerated, a second segment is not"],
    ["/admin/users", "a different surface"],
    ["", "empty"],
    ["/", "root"],
  ];
  for (const [path, why] of nulls) {
    const expect = path === "/portal/sales/" ? "Sales" : null;
    ok(`tabOfPath("${path}") is ${expect ?? "null"}`, tabOfPath(path) === expect, why);
  }
  ok("a query string and a fragment are ignored",
     tabOfPath("/portal/hotels?hotel=88") === "Hotels" && tabOfPath("/portal/attendance#ot-approvals") === "Attendance");
  ok("isPortalPath knows the surface",
     isPortalPath("/portal") && isPortalPath("/portal/sales") && !isPortalPath("/admin") && !isPortalPath("/account"));
}

/* ---- 7-8. the legacy ?tab= resolver, RUN ----------------------------- */
{
  const ROLES = ["ceo", "coo", "cco", "admin", "hr_admin", "sales_marketing", "marketing", "live_host", "editor"];
  for (const role of ROLES) {
    const permitted = all(role);

    /* valid + authorized */
    for (const t of permitted) {
      const r = resolveLegacyTab(t, permitted);
      ok(`${role}: ?tab=${t} -> its own path`, r.kind === "route" && r.href === pathOf(t));
    }
    /* valid + NOT authorized */
    for (const t of ACTIVE.filter((x) => !permitted.includes(x))) {
      const r = resolveLegacyTab(t, permitted);
      ok(`${role}: ?tab=${t} is refused`, r.kind === "home" && r.href === PORTAL_HOME,
         "identical to today's clamp; the worker 403s the data regardless");
    }
    /* parked, retired, junk */
    for (const bad of [...PARKED_TABS, "Purchasing", "Reconciliation", "Ads Fund",
                       "", "   ", "../../etc/passwd", "<script>alert(1)</script>",
                       "sales", "SALES", "Dashboard ", null, undefined]) {
      const r = resolveLegacyTab(bad, permitted);
      ok(`${role}: ?tab=${JSON.stringify(bad)} goes home`, r.kind === "home" && r.href === PORTAL_HOME);
    }
    ok(`${role}: ?tab=Dashboard -> /portal/home`,
       (() => { const r = resolveLegacyTab("Dashboard", permitted); return r.kind === "route" && r.href === PORTAL_HOME; })(),
       "Dashboard is an ordinary module with an ordinary slug now");
  }

  /* THE PROPERTY: it can never name a tab the caller did not permit. */
  let leaked = 0;
  const inputs = [...ALL_TABS, "Purchasing", "", "x", "../x", null];
  for (let i = 0; i < 500; i++) {
    const permitted = ALL_TABS.filter(() => Math.random() < 0.5);
    for (const raw of inputs) {
      const r = resolveLegacyTab(raw, permitted);
      if (r.kind === "route" && !permitted.includes(r.tab)) leaked++;
      if (r.kind === "route" && r.href !== pathOf(r.tab)) leaked++;
    }
  }
  ok("resolveLegacyTab can NEVER return a tab outside the permitted list", leaked === 0,
     `${leaked} leak(s) over 500 random permitted subsets`);
  ok("the href is built from the registry, never from the input",
     !/\$\{raw\}|\$\{slug\}`\s*;/.test(read("lib/portal-routes.ts").split("export function resolveLegacyTab")[1] ?? ""),
     "no user input may reach the address bar");
}

/* ---- 9-10. THE ENTRY PRECEDENCE — v1.179.0's order ------------------- */
{
  const permitted = all("ceo");

  ok("1st: a legacy ?tab= beats everything",
     resolveEntry({ legacyTab: "Leave", remembered: "Sales", launchShift: true, permitted }).reason === "legacy");
  ok("   ...and lands on the tab it named",
     resolveEntry({ legacyTab: "Leave", remembered: "Sales", launchShift: true, permitted }).href === pathOf("Leave"));
  ok("2nd: the remembered tab beats the shift flag",
     resolveEntry({ remembered: "Sales", launchShift: true, permitted }).reason === "remembered");
  ok("3rd: the shift flag, when nothing above decided",
     resolveEntry({ launchShift: true, permitted }).reason === "launch_shift"
     && resolveEntry({ launchShift: true, permitted }).href === pathOf("On Shift"));
  ok("4th: home",
     resolveEntry({ permitted }).reason === "home" && resolveEntry({ permitted }).href === PORTAL_HOME);

  /* THE TWO KINDS OF ?tab=, and v1.179.0 treats them differently.
     A real tab name is an INSTRUCTION: it is answered, and the remembered
     tab is never consulted - even when the person may not open it, in which
     case the answer is home (page.tsx enters the branch on
     ALL_TABS.includes(wanted) and RETURNS; the clamp then sends an
     unauthorised tab to the Dashboard). Junk is not an instruction, and
     falls through. The first draft consumed both, and the WebKit probe
     caught it. */
  ok("a ?tab= naming a real but forbidden tab is answered with home, NOT the remembered tab",
     resolveEntry({ legacyTab: "Payroll", remembered: "Sales", permitted: all("live_host") }).reason === "home");
  ok("a ?tab= naming a PARKED tab is answered the same way",
     resolveEntry({ legacyTab: "Threads", remembered: "Sales", permitted }).reason === "home");
  ok("a ?tab= naming NOTHING falls through to the remembered tab, as v1.179.0 does",
     resolveEntry({ legacyTab: "Purchasing", remembered: "Sales", permitted }).reason === "remembered"
     && resolveEntry({ legacyTab: "<script>", remembered: "Sales", permitted }).reason === "remembered"
     && resolveEntry({ legacyTab: "sales", remembered: "Sales", permitted }).reason === "remembered",
     "a stale bookmark must not cost the person the place they were");
  ok("...and to the shift flag, then home, when there is nothing remembered",
     resolveEntry({ legacyTab: "Purchasing", launchShift: true, permitted }).reason === "launch_shift"
     && resolveEntry({ legacyTab: "Purchasing", permitted }).reason === "home");
  ok("isKnownTab separates the two kinds",
     isKnownTab("Payroll") && isKnownTab("Threads") && !isKnownTab("Purchasing")
     && !isKnownTab("sales") && !isKnownTab("") && !isKnownTab(null));

  ok("a remembered tab that is no longer permitted falls through to the shift flag",
     resolveEntry({ remembered: "Payroll", launchShift: true, permitted: all("live_host") }).reason === "launch_shift");
  ok("...and to home when there is no shift either",
     resolveEntry({ remembered: "Payroll", permitted: all("live_host") }).reason === "home");
  ok("a remembered PARKED tab falls through",
     resolveEntry({ remembered: "Threads", permitted }).reason === "home");
  ok("a remembered RETIRED tab falls through",
     resolveEntry({ remembered: "Purchasing", permitted }).reason === "home");

  ok("rememberedIsStale says WHICH ones the caller must delete",
     rememberedIsStale("Payroll", all("live_host")) === true
     && rememberedIsStale("Threads", permitted) === true
     && rememberedIsStale("Purchasing", permitted) === true
     && rememberedIsStale("Sales", permitted) === false
     && rememberedIsStale(null, permitted) === false,
     "it is deleted, never rewritten to Dashboard and stored - that would overwrite a good memory because of one revoked permission");

  /* the entry resolver is permission-safe for every role */
  let bad = 0;
  for (const role of ["ceo", "live_host", "editor", "marketing", "hr_admin"]) {
    const p = all(role);
    for (const legacyTab of [...ALL_TABS, "Purchasing", null]) {
      for (const remembered of [...ALL_TABS, null]) {
        const r = resolveEntry({ legacyTab, remembered, launchShift: true, permitted: p });
        if (r.tab !== null && !p.includes(r.tab)) bad++;
        if (r.href !== PORTAL_HOME && r.tab === null) bad++;
      }
    }
  }
  ok("resolveEntry can never land on a module this person may not open", bad === 0, `${bad} case(s)`);

  ok("nobody can be locked out: Dashboard is ALWAYS_VISIBLE, so home always resolves",
     ["ceo", "live_host", "editor"].every((r) => all(r).includes("Dashboard")));
}

/* ---- 11. the worker's own push map names real tabs ------------------- */
{
  const staff = read("worker/src/staff.ts");
  const block = staff.slice(staff.indexOf("const PUSH_TAB"), staff.indexOf("export async function notify"));
  const named = [...block.matchAll(/:\s*"([^"]+)"/g)].map((m) => m[1]);
  ok("PUSH_TAB names only tabs that exist", named.length > 0 && named.every((t) => ALL_TABS.includes(t)),
     named.filter((t) => !ALL_TABS.includes(t)).join(", "));
  /* KNOWN, AND NAMED. `content: "Content"` deep-links to a PARKED module: the
     push arrives, the person taps it, and v1.179.0 clamps them to the
     Dashboard with no word why. It is a dead deep link, it predates P1, and
     fixing it is a worker deploy - so it is pinned here rather than quietly
     tolerated. Any NEW parked target fails this, and when Content is
     un-parked or push phase 2 lands, this set shrinks to nothing. */
  const parkedTargets = named.filter((t) => PARKED_TABS.includes(t)).sort();
  ok("the only push target that is parked is the known `Content` one",
     parkedTargets.join(",") === "Content",
     `parked push targets: ${parkedTargets.join(", ") || "none"} - a push that deep-links to a parked module is a notification nobody can open`);
}

/* ---- 12. the shell still reads ONE registry -------------------------- */
{
  const page = read("components/portal/portal-provider.tsx");
  ok("the page still filters its tabs through canSeeTab", /canSeeTab\(user\?\.role, t, tabOverrides, myTabAccess\)/.test(page));
  /* A URL LITERAL, not an import path: `@/components/portal/sales` is a
     module specifier and must not be mistaken for an address. */
  const urlLiteral = (src) => /["'`]\/portal\/[a-z][a-z0-9-]*/.test(src.replace(/@\/components\/portal\//g, ""));
  const navFiles = ["components/layout/side-nav.tsx", "components/layout/command-palette.tsx",
                    "components/portal/lazy-panels.tsx", "components/layout/sidebar-nav.tsx"];
  const hardcoded = navFiles.filter((f) => urlLiteral(read(f)));
  ok("no navigation surface hard-codes an address", hardcoded.length === 0,
     `${hardcoded.join(", ")} - every address must come from TAB_ROUTE`);
}

/* ---- 13. CONDITIONAL ROUTE PARITY — green at zero, green at all ------ */
{
  const portalDir = join(root, "app/portal");
  /* `[section]` is the P1.0b rollback bridge, not a canonical route. */
  const dirs = readdirSync(portalDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name !== "[section]")
    .map((e) => e.name);
  const withPage = dirs.filter((d) => existsSync(join(portalDir, d, "page.tsx")));
  const expected = ACTIVE.map((t) => slugOf(t)).sort();

  if (withPage.length === 0) {
    ok("route parity: no canonical routes yet (P1.0/P1.1) — nothing to check",
       dirs.length === 0, `stray directories: ${dirs.join(", ")}`);
  } else {
    const found = [...withPage].sort();
    ok("route parity: every active module has a route file",
       expected.every((s) => found.includes(s)),
       expected.filter((s) => !found.includes(s)).join(", "));
    ok("route parity: no orphan route directory",
       found.every((s) => expected.includes(s)),
       found.filter((s) => !expected.includes(s)).join(", "));
  }
  ok("a PARTIAL set of route files is the only failing state, and it is caught",
     withPage.length === 0 || withPage.length === expected.length,
     `${withPage.length} route file(s) for ${expected.length} modules`);
}

if (failed) { console.log(`\n${failed} check(s) failed.`); process.exit(1); }
console.log(`\nPASS — one registry, one slug each, and no URL outranks a permission (${passed} checks)`);
