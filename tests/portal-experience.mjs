#!/usr/bin/env node
/* Guard #88: the responsive staff portal stays task-first and permission-led. */
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (path) => readFileSync(join(root, path), "utf8");
const tabs = await import(pathToFileURL(join(root, "lib/portal-tabs.ts")).href);
const page = read("app/portal/page.tsx");
const staff = read("components/staff/staff-directory.tsx");
const users = read("components/portal/users-panel.tsx");
const review = read("components/portal/access-review-card.tsx");
let passed = 0, failed = 0;
const ok = (label, condition) => { if (condition) passed++; else { failed++; console.log(`  x ${label}`); } };

/* ---- v1.175.0 — THE PHONE BAR IS ROLE-APPROPRIATE, AND STILL STABLE ------
   Until v1.175.0 every role got the same four stops. The owner, 22-09-2026,
   asked for destinations that match the job: staff keep the clock, sales get
   Sales, and a manager gets their pending decisions — reusing One Desk, which
   is a ZONE of the Dashboard, so the stop is a tab plus an anchor and there is
   no second inbox. What has NOT changed, and is asserted here: Home is always
   first and always the Dashboard, More is always last (rendered
   unconditionally by the page), there are always four stops, every stop is a
   tab the person may open, and nothing about the bar depends on a COUNT — a
   stop must never move because four claims arrived overnight. */
const MANAGERS = ["ceo", "coo", "cco", "super_admin", "admin"];
for (const role of [...tabs.ASSIGNABLE_ROLES.map(([role]) => role), "super_admin"]) {
  const visible = tabs.ALL_TABS.filter((tab) => tabs.canSeeTab(role, tab));
  const stops = tabs.mobileNavStops(visible, { role });
  const keys = stops.map((s) => s.key);
  ok(`${role}: four stops, Home first, none forbidden`,
     stops.length === 4 && stops[0].key === "Dashboard" && stops[0].tab === "Dashboard"
     && stops.every((s) => visible.includes(s.tab))
     && new Set(keys).size === keys.length);
  ok(`${role}: the clock stays one tap away`, keys.includes("On Shift"));
  if (MANAGERS.includes(role)) {
    const desk = stops.find((s) => s.key === "Desk");
    ok(`${role}: pending decisions reuse One Desk on the Dashboard`,
       Boolean(desk) && desk.tab === "Dashboard" && desk.anchor === "one-desk");
  } else if (visible.includes("Sales")) {
    ok(`${role}: Sales is a stop`, keys.includes("Sales"));
  } else {
    ok(`${role}: the staff bar is unchanged`, JSON.stringify(keys) === JSON.stringify(["Dashboard", "On Shift", "Tasks", "Profile"]));
  }
}
/* A caller with no role must not be guessed at — it gets the staff bar. */
ok("no role means the staff bar, never a guess",
   JSON.stringify(tabs.mobilePrimaryTabs(tabs.ALL_TABS.filter((t) => tabs.canSeeTab("live_host", t)))) === JSON.stringify(["Dashboard", "On Shift", "Tasks", "Profile"]));

/* ---- pins: the person's own six, and they cannot outrank permission ---- */
{
  const visible = tabs.ALL_TABS.filter((tab) => tabs.canSeeTab("live_host", tab));
  const pinned = tabs.mobileNavStops(visible, { role: "live_host", favourites: ["Leave", "Claims"] }).map((s) => s.key);
  ok("pins fill the bar after Home, in the order chosen", pinned[0] === "Dashboard" && pinned[1] === "Leave" && pinned[2] === "Claims");
  const sneaky = tabs.mobileNavStops(visible, { role: "live_host", favourites: ["Payroll", "Finance"] }).map((s) => s.tab);
  ok("a pin the person may not open is dropped, not shown",
     !sneaky.includes("Payroll") && !sneaky.includes("Finance") && !visible.includes("Payroll"));
  const parked = tabs.mobileNavStops(visible, { role: "live_host", favourites: ["Stokis"] }).map((s) => s.tab);
  ok("a parked tab cannot be pinned onto the bar", !parked.includes("Stokis"));
}
ok("the pinned list is per account and clamped to permission", (() => {
  const fav = read("lib/favourites.ts");
  return /azone-pinned:\$\{userId\}/.test(fav)
    && /export function readFavourites\(userId[^)]*allowed: readonly string\[\]\)/.test(fav)
    && /permitted\.has\(t\)/.test(fav)
    && /FAVOURITES_MAX = 6/.test(fav);
})());
ok("pins are toggled from the More sheet and lead the palette - no second menu",
   /toggleFavourite\(user\?\.id, t\)/.test(page) && /pinned=\{favourites\}/.test(page)
   && /push\("Pinned"/.test(read("components/layout/command-palette.tsx")));
ok("the bar never reorders on a count", (() => {
  const src = read("lib/portal-tabs.ts");
  const fn = src.slice(src.indexOf("export function mobileNavStops"), src.indexOf("export function mobilePrimaryTabs"))
    /* the CODE, not the prose explaining it */
    .replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
  return !/count|pending|unread|badge|total/i.test(fn);
})());
ok("bottom bar and More use permission-filtered mobile sets", /mobileStops\.map\(\(stop\)/.test(page) && /mobileMore\.includes\(activeTab\)/.test(page));
ok("More is grouped from the desktop information architecture", /const mobileGroups = SECTIONS\.map/.test(page) && /mobileGroups\.map\(\(section\)/.test(page));
ok("More locks background scroll and restores it", /document\.body\.style\.overflow = "hidden"/.test(page) && /event\.key === "Escape"/.test(page) && /document\.body\.style\.overflow = previous/.test(page));
ok("Staff opens as a searchable directory with both secondary views", /useState<"list" \| "circle" \| "org">\("list"\)/.test(staff) && /placeholder=\{L\("Find staff", "Cari kakitangan"\)\}/.test(staff) && /L\("Organisation", "Organisasi"\)/.test(staff) && /L\("Team map", "Peta pasukan"\)/.test(staff));
ok("accounts and individual access share one surface", /<UsersPanel role=\{user\.role\} embedded \/>/.test(page) && /<AccessReviewCard embedded \/>/.test(page) && /embedded = false/.test(users) && /embedded = false/.test(review));
ok("access preview uses the portal phone helper", /const phoneTabs = mobilePrimaryTabs/.test(review));

console.log(`${failed ? "x" : "ok"} portal-experience: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
