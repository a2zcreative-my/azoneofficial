/* v1.40.1 — registry parity (AUDIT M19, and the guard that would have caught
   the whole M11/M16 class by itself).

   The system keeps several lists that must mirror each other, maintained by
   hand under "standing rules" written in comments. The audit found the rules
   silently broken in five places at once: a new tab missing from the
   tab-access whitelist, the icon map and the BM guard; four new migrations
   missing from the health-probe set; and an emergency deploy script pinned
   to an old version. A comment cannot fail a build. This guard can.

   Checks:
   A. lib/portal-tabs.ts ALL_TABS ↔ worker TAB_ACCESS_TABS (± the
      always-visible set) ↔ nav-icons TAB_ICON ↔ i18n DICT, and neither
      page.tsx nor tab-access-card.tsx keeps a private copy of the registry.
      (v1.79.0: the card's copy of the list AND of the role defaults is gone
      — it imports them. This check now guards that it stays gone, because a
      name-only parity check is what let the Users default drift for 39
      releases while every name matched.)
   B. worker/migrations/*.sql ↔ EXPECTED_MIGRATIONS ↔ LATEST_MIGRATION, and
      every migration from 0075 on is covered by a /system/health probe
      (data-only migrations — no CREATE/ALTER — are exempt: unprobeable).
   C. wrangler.toml [triggers] crons ↔ scheduled()'s explicit branches
      (the 30-minute chain is the documented default arm).
   D. Cross-literal couplings: 0082's remark LIKE ↔ the string erp.ts writes;
      DEPLOY.bat's version gate ↔ package.json.

   Run: node tests/registry-parity.mjs */
import { readFileSync, readdirSync } from "node:fs";

let failed = 0;
const fail = (msg) => { console.log(`FAIL ${msg}`); failed++; };
const ok = (msg) => console.log(`ok   ${msg}`);
const setDiff = (a, b) => [...a].filter((x) => !b.has(x));

const page = readFileSync("app/portal/page.tsx", "utf8");
const staff = readFileSync("worker/src/staff.ts", "utf8");
const index = readFileSync("worker/src/index.ts", "utf8");
const card = readFileSync("components/portal/tab-access-card.tsx", "utf8");
const registry = readFileSync("lib/portal-tabs.ts", "utf8");
const icons = readFileSync("components/layout/nav-icons.tsx", "utf8");
const dict = readFileSync("lib/i18n.ts", "utf8");

/* ---- A. the tab registries ---- */
const allTabsM = registry.match(/const ALL_TABS = \[([\s\S]*?)\] as const;/);
if (!allTabsM) { fail("ALL_TABS not found in lib/portal-tabs.ts"); process.exit(1); }
const ALL_TABS = [...allTabsM[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
/* Dashboard and Profile are every role's home and identity — always visible,
   deliberately not overridable. Everything else must be governable. */
const ALWAYS_VISIBLE = new Set(["Dashboard", "Profile"]);
/* v1.102.0 — a PARKED tab (CEO: "Stokis - inactive this for future usage")
   is built and shown to nobody. It is still a real tab with a panel, a role
   default and a hint, so it stays in ALL_TABS; but it must NOT be in the
   worker's grant whitelist, because the API refusing to grant what the portal
   will never draw is what stops a parked tab coming back through a saved
   override. */
const parkedM = registry.match(/const PARKED_TABS: readonly string\[\] = \[([^\]]*)\]/);
const PARKED = new Set([...(parkedM?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1]));
if (!parkedM) fail("PARKED_TABS not found in lib/portal-tabs.ts");
else ok(`PARKED_TABS: ${[...PARKED].join(", ") || "none"}`);
const governable = new Set(ALL_TABS.filter((t) => !ALWAYS_VISIBLE.has(t) && !PARKED.has(t)));
for (const t of PARKED) {
  if (!ALL_TABS.includes(t)) fail(`PARKED_TABS names "${t}", which is not a tab — parking is hiding a tab, not inventing one`);
}
if (!/if \(PARKED_TABS\.includes\(tab\)\) return false;/.test(registry)) {
  fail("canSeeTab does not refuse parked tabs — PARKED_TABS would be a list nothing reads");
} else if (registry.indexOf("if (PARKED_TABS.includes(tab)) return false;") > registry.indexOf('if (role === "super_admin") return true;')) {
  fail("the parked rail sits BELOW the super_admin bypass — a tab taken off the product must not still be there for one account");
} else ok("parked tabs are refused, above the super_admin bypass");

const accessM = staff.match(/const TAB_ACCESS_TABS = \[([^\]]*)\]/);
const accessTabs = new Set([...(accessM?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1]));
for (const t of setDiff(governable, accessTabs)) fail(`"${t}" is in ALL_TABS but missing from worker TAB_ACCESS_TABS — the CEO cannot grant or revoke it`);
for (const t of setDiff(accessTabs, governable)) fail(`"${t}" is in TAB_ACCESS_TABS but not a governable ALL_TABS entry`);
if (accessTabs.size && setDiff(governable, accessTabs).length === 0 && setDiff(accessTabs, governable).length === 0) ok("worker TAB_ACCESS_TABS mirrors ALL_TABS");

/* v1.79.0 — the card and the portal must READ the registry, not restate it.
   Any re-declaration here is the drift starting over. */
for (const [file, src, name] of [["app/portal/page.tsx", page, "page"], ["components/portal/tab-access-card.tsx", card, "card"]]) {
  if (!/from "@\/lib\/portal-tabs"/.test(src)) fail(`${file} does not import the tab registry from @/lib/portal-tabs`);
  else ok(`${name} imports the tab registry`);
  for (const decl of ["ALL_TABS", "TAB_ROLES", "TABS", "DEFAULTS"]) {
    if (new RegExp(`^const ${decl}[:\\s=]`, "m").test(src)) {
      fail(`${file} declares its own ${decl} — the tab registry is lib/portal-tabs.ts, and a second copy is what drifted (the Users default said "ceo, coo" while the portal allowed admin too)`);
    }
  }
}

/* Every governable tab needs a hint entry or it renders bare; and no hint may
   name a tab that no longer exists. */
const hintBlock = registry.match(/const TAB_HINTS[\s\S]*?^\};/m)?.[0] ?? "";
for (const h of [...hintBlock.matchAll(/^\s*(?:"([^"]+)"|([A-Za-z][A-Za-z ]*?)):\s*\{/gm)].map((m) => m[1] ?? m[2])) {
  /* A parked tab keeps its hint: un-parking should be deleting one name from
     PARKED_TABS, not a scavenger hunt for the pieces that were removed with
     it. */
  if (!governable.has(h) && !PARKED.has(h)) fail(`TAB_HINTS has an entry for "${h}", which is not a governable tab`);
}
ok("TAB_HINTS names only real tabs");

/* v1.102.0 — the sidebar is a CUT of the registry, not a second ordering.
   CEO, 05-09-2026, re-sorting the whole list himself: five tabs added since
   v1.13.0 had never been placed in a section and were falling through to
   "Other" at the bottom of the rail, which is what he was looking at. */
{
  const nav = readFileSync("components/layout/side-nav.tsx", "utf8");
  const secM = nav.match(/export const SECTIONS: \{ title: string; tabs: string\[\] \}\[\] = \[([\s\S]*?)^\];/m);
  const sectioned = [...(secM?.[1] ?? "").matchAll(/tabs: \[([^\]]*)\]/g)]
    .flatMap((m) => [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]));
  const shown = ALL_TABS.filter((t) => !PARKED.has(t));
  if (!secM) fail("SECTIONS not found in components/layout/side-nav.tsx");
  else if (JSON.stringify(sectioned) !== JSON.stringify(shown)) {
    const missing = shown.filter((t) => !sectioned.includes(t));
    const extra = sectioned.filter((t) => !shown.includes(t));
    fail(`the sidebar's sections do not read as the registry's order — ${missing.length ? `unplaced (falls under "Other"): ${missing.join(", ")}` : ""}${extra.length ? ` not a shown tab: ${extra.join(", ")}` : ""}${!missing.length && !extra.length ? "same tabs, different sequence" : ""}`);
  } else ok("the sidebar's sections read as ALL_TABS, in order, with nothing orphaned");
}

/* Defaults must only name roles the card can actually toggle — a default
   listing a role with no chip is a permission nobody can revoke from the UI. */
const rolesM = registry.match(/const ASSIGNABLE_ROLES[\s\S]*?^\];/m)?.[0] ?? "";
const chips = new Set([...rolesM.matchAll(/\["([a-z_]+)",/g)].map((m) => m[1]));
const tabRolesM = registry.match(/const TAB_ROLES[\s\S]*?^\};/m)?.[0] ?? "";
const namedRoles = new Set([...tabRolesM.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]));
for (const r of namedRoles) {
  if (r === "super_admin") continue; // the bypass, deliberately chip-less
  if (!chips.has(r)) fail(`TAB_ROLES grants "${r}", but the 🔐 card has no chip for it — the CEO could never take it away`);
}
ok("every role named in TAB_ROLES has a chip in the 🔐 card");

const iconsBlockM = icons.match(/const TAB_ICON[\s\S]*?^\};/m);
const iconKeys = new Set([...(iconsBlockM?.[0] ?? "").matchAll(/^\s*(?:"([^"]+)"|([A-Za-z][A-Za-z ]*?)):/gm)].map((m) => m[1] ?? m[2]));
for (const t of ALL_TABS.filter((t) => !iconKeys.has(t))) fail(`"${t}" has no icon in nav-icons TAB_ICON — the desktop rail is icon-only, so it renders as an anonymous square`);
if (ALL_TABS.every((t) => iconKeys.has(t))) ok("every tab has a nav icon");

for (const t of ALL_TABS) {
  const re = new RegExp(`"${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}":\\s*\\{\\s*en:`);
  if (!re.test(dict)) fail(`"${t}" has no i18n DICT entry — the BM toggle breaks on it`);
}
ok("every tab has an i18n DICT entry (or failures listed above)");

/* bm-coverage must derive its list, never hardcode it again */
const bm = readFileSync("tests/bm-coverage.mjs", "utf8");
if (!bm.includes("derivedTabs") || !bm.includes("lib/portal-tabs.ts")) fail("tests/bm-coverage.mjs no longer derives its tab list from the ALL_TABS registry");
else ok("bm-coverage derives its tab list");

/* ---- B. the migration registries ---- */
const stems = readdirSync("worker/migrations").filter((f) => f.endsWith(".sql")).map((f) => f.replace(/\.sql$/, "")).sort();
const expM = index.match(/const EXPECTED_MIGRATIONS = \[([\s\S]*?)\];/);
const expected = [...(expM?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1]);
if (JSON.stringify(stems) !== JSON.stringify(expected)) {
  fail(`EXPECTED_MIGRATIONS does not match worker/migrations/: files=[${stems.length}] array=[${expected.length}]; first diff: ${stems.find((s, i) => expected[i] !== s) ?? expected.find((e, i) => stems[i] !== e)}`);
} else ok(`EXPECTED_MIGRATIONS matches the ${stems.length} migration files, in order`);

const latestM = index.match(/const LATEST_MIGRATION = "([^"]+)"/);
if (latestM?.[1] !== stems[stems.length - 1]) fail(`LATEST_MIGRATION is "${latestM?.[1]}" but the newest file is "${stems[stems.length - 1]}"`);
else ok("LATEST_MIGRATION names the newest file");

/* probes: every migration from 0075 on must be covered by a probe label
   (single number or NNNN-NNNN range), unless the file is data-only. */
const probesM = index.match(/const probes: \[string, string\]\[\] = \[([\s\S]*?)\];/);
const probeText = probesM?.[1] ?? "";
const covered = new Set();
for (const m of probeText.matchAll(/"(\d{4})(?:-(\d{4}))?\s/g)) {
  const from = Number(m[1]), to = Number(m[2] ?? m[1]);
  for (let n = from; n <= to; n++) covered.add(n);
}
for (const stem of stems) {
  const n = Number(stem.slice(0, 4));
  if (n < 75) continue; // the pre-audit probe set is grandfathered as-is
  const sql = readFileSync(`worker/migrations/${stem}.sql`, "utf8");
  const dataOnly = !/CREATE |ALTER /i.test(sql.replace(/--[^\n]*/g, ""));
  if (dataOnly) continue; // nothing probeable — a data fix leaves no schema trace
  if (!covered.has(n)) fail(`migration ${stem} is not covered by any /system/health probe — the pending banner cannot name it (AUDIT M16)`);
}
ok("every probeable migration from 0075 on has a health probe (or failures above)");

/* ---- C. crons ↔ scheduled() branches ---- */
const toml = readFileSync("worker/wrangler.toml", "utf8");
const cronsM = toml.match(/crons\s*=\s*\[([^\]]*)\]/);
const crons = [...(cronsM?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1]);
const branchCrons = new Set([...index.matchAll(/event\.cron === "([^"]+)"/g)].map((m) => m[1]));
const DEFAULT_ARM = "*/30 * * * *"; // the documented fall-through chain
for (const c of crons) {
  if (c === DEFAULT_ARM) continue;
  if (!branchCrons.has(c)) fail(`cron "${c}" is in wrangler.toml but has NO explicit branch in scheduled() — it would fall through into the 30-minute chain at its own frequency`);
}
if (!crons.includes(DEFAULT_ARM)) fail(`the default 30-minute cron "${DEFAULT_ARM}" is missing from wrangler.toml`);
for (const c of branchCrons) {
  if (!crons.includes(c)) fail(`scheduled() branches on "${c}" but wrangler.toml never fires it — dead code or a typo in one of the two`);
}
ok("every cron has a branch; every branch has a cron");

/* ---- D. cross-literal couplings ---- */
const erp = readFileSync("worker/src/erp.ts", "utf8");
const fix = stems.find((s) => s.includes("fix_po_direction"));
if (fix) {
  const fixSql = readFileSync(`worker/migrations/${fix}.sql`, "utf8");
  if (!erp.includes("`Goods receipt ${prev.po_no}`") || !fixSql.includes("'Goods receipt PO-%'")) {
    fail(`${fix} targets remark LIKE 'Goods receipt PO-%' but erp.ts no longer writes that literal — the data fix would silently correct 0 rows`);
  } else ok("PO-direction data fix and erp.ts agree on the remark literal");
}
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const bat = readFileSync("DEPLOY.bat", "utf8");
/* Batch escapes quotes as \" — the first draft of this regex missed that,
   matched nothing, and `every()` over an empty array passed vacuously:
   the exact reads-like-it-ran failure this guard exists to kill. Hence the
   \\? allowances AND the emptiness check. */
const pinM = [...bat.matchAll(/\\?"version\\?":\s*\\?"(\d+\.\d+\.\d+)\\?"/g)].map((m) => m[1]);
if (pinM.length === 0) {
  /* v1.40.1: the gate is name-based now (a name never rots between
     releases) and the version is read dynamically for display. Zero
     hardcoded pins is therefore the CORRECT state — provided the name-gate
     is actually there. */
  if (bat.includes('\\"name\\": \\"azone-official\\"')) {
    ok("DEPLOY.bat gates on the package name (no rotting version pin)");
  } else {
    fail("DEPLOY.bat has neither a version pin nor the azone-official name-gate — the wrong-folder protection is gone");
  }
} else {
  let batOk = true;
  for (const v of pinM) {
    if (v !== pkg.version) { batOk = false; fail(`DEPLOY.bat pins version ${v} but package.json is ${pkg.version} — the emergency deploy path would refuse to run (AUDIT B5)`); }
  }
  if (batOk) ok(`DEPLOY.bat version gate matches package.json (${pinM.length} pin(s) at ${pkg.version})`);
}

/* ---- E. totals parity (v1.41.2) — the preview and the Worker must
   compute the same document total. The line-discount term was in the server
   for 40+ releases while the preview omitted it: staff read RM 23.40, the
   customer's document said RM 20.00. String-level tripwires on both files —
   crude, but each fails if its side loses a term of the formula. */
{
  const previewStart = page.indexOf("const subtotal = doc.items.reduce");
  const preview = previewStart >= 0 ? page.slice(previewStart, previewStart + 900) : "";
  if (!preview.includes("i.disc_cents ?? 0")) {
    fail("the doc-form preview subtotal no longer subtracts per-line discounts (page.tsx) — it will disagree with the Worker again");
  } else ok("preview subtotal subtracts line discounts");
  if (!preview.includes('doc.kind === "service"')) {
    fail("the doc-form preview delivery term lost the service-document exclusion — the server zeroes delivery on service docs");
  } else ok("preview delivery term matches the server's DO+service rule");
  if (!staff.includes("i.qty * i.unit_price_cents - (i.disc_cents ?? 0)")) {
    fail("the Worker's document subtotal no longer subtracts per-line discounts (staff.ts)");
  } else ok("worker subtotal subtracts line discounts");
}

if (failed) { console.error(`\n${failed} registry-parity check(s) failed.`); process.exit(1); }
console.log("\nregistry-parity: all registries agree.");
