/* v1.114.0 — the portal page was one 605 KB file until this release; guards
   read it as text and asserted what it said. It is now app/portal/page.tsx
   plus fourteen component files under components/portal/, moved verbatim.
   A guard that used to read "the page" reads this instead: the same text,
   in the original order of the file, so every assertion means what it did.
   Lives under tests/lib/ so the guard runner (tests/*.mjs) does not run it. */
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const PORTAL_SOURCE_FILES = [
  "app/portal/page.tsx",
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
  return PORTAL_SOURCE_FILES.map((f) => readFileSync(join(root, f), "utf8")).join("\n");
}
