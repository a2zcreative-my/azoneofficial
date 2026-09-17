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
  "app/portal/page.tsx",
  "components/portal/portal-skeleton.tsx",
  "app/account/page.tsx",
  "app/admin/page.tsx",
].map((p) => [p, read(p)]);
const eventIcs = read("lib/event-ics.ts");
const staff = read("worker/src/staff.ts");
const eventsPanel = read("components/portal/events.tsx");

ok("the PWA shell exposes one named bottom clearance",
  /export const mobileAppBottomClearance\s*=\s*\n\s*"pb-\[calc\(5rem\+max\(env\(safe-area-inset-bottom,0px\),6px\)\)\]"/.test(styles));
ok("the PWA bottom nav exposes one named safe-area style",
  /export const mobileBottomNav\s*=\s*\n\s*"border-border bg-card fixed inset-x-0 bottom-0 z-40 flex border-t pb-\[max\(env\(safe-area-inset-bottom,0px\),6px\)\] md:hidden"/.test(styles));
for (const [file, src] of pages) {
  ok(`${file} uses the shared mobile bottom clearance`, src.includes("mobileAppBottomClearance"));
}
ok("app views do not keep old pb-28 spacing", !pages.some(([, src]) => /className="[^"]*pb-28/.test(src)));
ok("app views do not keep inline bottom-nav safe-area styles", !pages.some(([, src]) => /paddingBottom: "max\(env\(safe-area-inset-bottom/.test(src)));

const helper = eventIcs.slice(eventIcs.indexOf("export async function addEventToCalendar"));
ok("calendar import opens the real .ics URL, not a blank tab", /window\.open\(url, "_blank"\)/.test(helper) && !/window\.open\("", "_blank"\)/.test(helper));
ok("calendar import no longer async-probes the .ics before opening it", !/fetch\(url/.test(helper));
ok("the UI no longer tells staff to deploy the worker from a phone", !/deploy the worker|Server needs the update/.test(eventsPanel));
ok("client ICS keeps overnight events overnight", /if \(endUtc <= startUtc\) endUtc = new Date\(endUtc\.getTime\(\) \+ 86_400_000\)/.test(eventIcs),
  "23:00-01:00 must not become 23:00-00:00");
ok("server ICS keeps overnight events overnight", /if \(endUtc <= startUtc\) endUtc = new Date\(endUtc\.getTime\(\) \+ 86_400_000\)/.test(staff),
  "the Worker-served file is the one PWA users actually open");
ok("calendar UID namespace is still stable", /UID:event-\$\{ev\.id\}@azoneofficial\.com/.test(eventIcs) && /UID:event-\$\{ev\.id\}@azoneofficial\.com/.test(staff));

console.log(failed === 0
  ? `pwa-calendar: ${passed} checks passed.`
  : `\n${failed} pwa-calendar check(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
