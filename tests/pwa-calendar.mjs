#!/usr/bin/env node
/* Guard #84 — PWA shell clearance and calendar import.
 *
 * The CEO, 17-09-2026: the installed PWA felt slightly offset, and events
 * added to the phone calendar did not save correctly. The two properties here
 * are deliberately small:
 *
 *   1. mobile app views use one bottom-nav clearance token, not scattered
 *      `pb-28` guesses or inline safe-area styles;
 *   2. "Add to my calendar" opens the Worker-served .ics URL directly during
 *      the tap, and an event that ends after midnight stays after midnight
 *      instead of collapsing to a one-hour block.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildEventIcs, calendarLinks } from "../lib/event-ics.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(root, p), "utf8");
let passed = 0;
let failed = 0;
const ok = (label, cond, why = "") => {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.log(`  ✗ ${label}${why ? ` — ${why}` : ""}`);
  }
};

const styles = read("lib/ui-styles.ts");
const pages = [
  "components/portal/portal-shell.tsx",
  "components/portal/portal-skeleton.tsx",
  "app/account/page.tsx",
  "app/admin/page.tsx",
].map((p) => [p, read(p)]);
const eventIcs = read("lib/event-ics.ts");
const staff = read("worker/src/staff.ts");
const eventsPanel = read("components/portal/events.tsx");

/* v1.172.2 (Tailwind retired): the two names resolve to classes in
   styles/erp-v3.css, and the FORMULA is checked there - 4rem nav + the
   safe-area floor + one breathing unit for the page, the floor for the bar. */
const v3 = read("styles/erp-v3.css");
ok("the PWA shell exposes one named bottom clearance",
  /export const mobileAppBottomClearance = "erp-page-clearance";/.test(styles)
  && /\.erp-page-clearance \{ padding-bottom: calc\(5rem \+ max\(env\(safe-area-inset-bottom, 0px\), 6px\)\); \}/.test(v3));
ok("the PWA bottom nav exposes one named safe-area style",
  /export const mobileBottomNav = "erp-bottom-nav";/.test(styles)
  /* P0.2 - the bar's LAYER is now semantic (--z-nav), not the literal 40.
     What matters has never been the number: it is that the bar is pinned to
     the bottom edge, clears the home indicator, and sits below anything that
     covers the page. Asserting the token also catches a future edit that
     moves the bar above a drawer or a modal. */
  && /\.erp-bottom-nav \{[^}]*position: fixed;[^}]*inset-inline: 0;[^}]*bottom: 0;[^}]*z-index: var\(--z-nav\);[^}]*display: flex;[^}]*border-top: 1px solid var\(--border\);[^}]*background: var\(--card\);[^}]*padding-bottom: max\(env\(safe-area-inset-bottom, 0px\), 6px\);/.test(v3)
  && /@media \(min-width: 768px\) \{ \.erp-bottom-nav \{ display: none; \} \}/.test(v3));
for (const [file, src] of pages) {
  ok(`${file} uses the shared mobile bottom clearance`, src.includes("mobileAppBottomClearance"));
}
ok("app views do not keep old pb-28 spacing", !pages.some(([, src]) => /className="[^"]*pb-28/.test(src)));
ok("app views do not keep inline bottom-nav safe-area styles", !pages.some(([, src]) => /paddingBottom: "max\(env\(safe-area-inset-bottom/.test(src)));

ok("calendar actions remain inside the app until a provider is chosen", !/window\.open|location\.assign/.test(eventIcs) && eventsPanel.includes("openCalendarDialog(ev)"));
ok("calendar UI does not falsely confirm the external save", !/Calendar opened|tap Add All/.test(eventsPanel));
ok("the UI no longer tells staff to deploy the worker from a phone", !/deploy the worker|Server needs the update/.test(eventsPanel));
ok("client ICS keeps overnight events overnight", /if \(endUtc <= startUtc\) endUtc = new Date\(endUtc\.getTime\(\) \+ 86_400_000\)/.test(eventIcs),
  "23:00-01:00 must not become 23:00-00:00");
ok("server and client share the same calendar export", staff.includes('import { buildEventIcs } from "../../lib/event-ics"') && staff.includes("new Response(buildEventIcs(ev)"));
ok("calendar UID namespace is still stable", /UID:event-\$\{ev\.id\}@azoneofficial\.com/.test(eventIcs));

const ev = { id: 7, title: "Team meeting", event_date: "2026-12-31", start_time: "23:00", end_time: "01:00", details: "A,B;C\\nD", location: "HQ" };
const overnight = await buildEventIcs(ev).text();
ok("overnight export crosses the year boundary correctly", overnight.includes("DTSTART:20261231T150000Z") && overnight.includes("DTEND:20261231T170000Z"));
const allDay = await buildEventIcs({ ...ev, start_time: null }).text();
ok("all-day export has an exclusive next-day end", allDay.includes("DTSTART;VALUE=DATE:20261231") && allDay.includes("DTEND;VALUE=DATE:20270101"));
const unicodeTitle = "\u4f1a\u8bae\ud83d\udcc5".repeat(35);
const unicode = await buildEventIcs({ ...ev, title: unicodeTitle }).text();
ok("UTF-8 lines never exceed 75 bytes", unicode.split("\r\n").every(line => Buffer.byteLength(line) <= 75));
ok("folding preserves multilingual text and code points", unicode.replace(/\r\n /g, "").includes(`SUMMARY:${unicodeTitle}\r\n`));
const links = calendarLinks(ev);
ok("Google draft preserves UTC instants", new URL(links.google).searchParams.get("dates") === "20261231T150000Z/20261231T170000Z");
ok("Outlook draft preserves UTC instants", new URL(links.outlook).searchParams.get("enddt") === "2026-12-31T17:00:00.000Z");
ok("all-day provider draft stays date-only", new URL(calendarLinks({ ...ev, start_time: null }).google).searchParams.get("dates") === "20261231/20270101");

console.log(failed === 0
  ? `pwa-calendar: ${passed} checks passed.`
  : `\n${failed} pwa-calendar check(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
