/* v1.114.0 — the portal page was one 605 KB file until this release; guards
   read it as text and asserted what it said. It is now app/portal/page.tsx
   plus fourteen component files under components/portal/, moved verbatim.
   A guard that used to read "the page" reads this instead: the same text,
   in the original order of the file, so every assertion means what it did.
   Lives under tests/lib/ so the guard runner (tests/*.mjs) does not run it. */
import { readFileSync } from "node:fs";
import { join } from "node:path";

/* v1.181.0 (P1.1) - the shell left page.tsx too. The provider holds the state
   and the gates; portal-shell.tsx holds the rail, topbar, bottom bar, More
   sheet and palette. Both are listed HERE, directly after the page, so a
   guard that reads "the portal" still reads the same text it always did -
   otherwise twenty guards would have silently stopped checking the topbar on
   the day it moved, and reported PASS. */
export const PORTAL_SOURCE_FILES = [
  "app/portal/page.tsx",
  "components/portal/portal-provider.tsx",
  "components/portal/portal-shell.tsx",
  "components/portal/page-shared.tsx",
  "components/portal/dashboard.tsx",
  "components/portal/trading-desk.tsx",
  "components/portal/events.tsx",
  "components/portal/attendance.tsx",
  "components/portal/leave.tsx",
  "components/portal/tiktok-cards.tsx",
  "components/portal/tasks.tsx",
  "components/portal/announcements.tsx",
  "components/portal/sales.tsx",
  "components/portal/live-cards.tsx",
  "components/portal/profile.tsx",
  "components/portal/users-panel.tsx",
  "components/portal/commission.tsx",
];

/** Everything the portal page is made of, as one string. */
export function readPortalSource(root) {
  return PORTAL_SOURCE_FILES.map((f) => readFileSync(join(root, f), "utf8").replace(/\r\n/g, "\n")).join("\n");
}

/* v1.181.0 (P1.1) — WHAT `app/portal/page.tsx` USED TO BE.
 *
 * The shell left the page: the state and the gates are in portal-provider,
 * the rail, topbar, bottom bar, More sheet and palette are in portal-shell,
 * and page.tsx is the module switch. A guard that read the PAGE — not the
 * whole portal — reads these three, so its assertions keep the scope they
 * were written with. Using readPortalSource() for that would widen them to
 * every domain file, which quietly turns a negative assertion ("the page
 * does NOT do X") into a much weaker claim about fourteen other files. */
export const PORTAL_PAGE_FILES = [
  "app/portal/page.tsx",
  "components/portal/portal-provider.tsx",
  "components/portal/portal-shell.tsx",
];

/** The three files that were one file until v1.181.0, as one string. */
export function readPortalPage(root) {
  return PORTAL_PAGE_FILES.map((f) => readFileSync(join(root, f), "utf8").replace(/\r\n/g, "\n")).join("\n");
}
