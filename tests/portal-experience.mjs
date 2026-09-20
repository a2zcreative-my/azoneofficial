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

for (const role of [...tabs.ASSIGNABLE_ROLES.map(([role]) => role), "super_admin"]) {
  const visible = tabs.ALL_TABS.filter((tab) => tabs.canSeeTab(role, tab));
  ok(`${role} keeps the four daily phone destinations`, JSON.stringify(tabs.mobilePrimaryTabs(visible)) === JSON.stringify(["Dashboard", "On Shift", "Tasks", "Profile"]));
}
ok("bottom bar and More use permission-filtered mobile sets", /mobilePrimary\.map\(\(t\)/.test(page) && /mobileMore\.includes\(activeTab\)/.test(page));
ok("More is grouped from the desktop information architecture", /const mobileGroups = SECTIONS\.map/.test(page) && /mobileGroups\.map\(\(section\)/.test(page));
ok("More locks background scroll and restores it", /document\.body\.style\.overflow = "hidden"/.test(page) && /event\.key === "Escape"/.test(page) && /document\.body\.style\.overflow = previous/.test(page));
ok("Staff opens as a searchable directory with both secondary views", /useState<"list" \| "circle" \| "org">\("list"\)/.test(staff) && /placeholder=\{L\("Find staff", "Cari kakitangan"\)\}/.test(staff) && /L\("Organisation", "Organisasi"\)/.test(staff) && /L\("Team map", "Peta pasukan"\)/.test(staff));
ok("accounts and individual access share one surface", /<UsersPanel role=\{user\.role\} embedded \/>/.test(page) && /<AccessReviewCard embedded \/>/.test(page) && /embedded = false/.test(users) && /embedded = false/.test(review));
ok("access preview uses the portal phone helper", /const phoneTabs = mobilePrimaryTabs/.test(review));

console.log(`${failed ? "x" : "ok"} portal-experience: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
