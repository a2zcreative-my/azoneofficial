#!/usr/bin/env node
/* Guard #41 — v1.106.0 (roadmap phase 04): One Desk.
 *
 * The desk lists what is waiting on the person looking. It is worth nothing
 * unless it lists EXACTLY what that person may act on - a COO shown a claim
 * only the CEO can decide learns to ignore the desk, and a CEO not shown a
 * claim whose chain is complete learns the same thing. So the two rules the
 * desk depends on are RUN here against the same cases the decide routes were
 * written for, and staff.ts is held to sharing them rather than keeping a
 * second copy.
 *
 *   1. THE CLAIM CHAIN, run: who sees a pending claim at each step, for every
 *      claimant tier - and nobody sees their own, and a pre-approver never
 *      sees one that pays them.
 *   2. THE LEAVE CHAIN, run: the rule now lives in leave-chain.ts, staff.ts
 *      imports it (one definition), and the desk uses that import.
 *   3. THE DESK IS WIRED: a door in staff.ts, a card mounted FIRST on the
 *      Dashboard, remembered on the device, refetching on every topic a bucket
 *      can move on; every tab it names is a real tab; nothing when empty.
 *
 * Negative-tested by: letting the CEO see a staff claim mid-chain (1 fails);
 * re-adding a private leaveCanActAt to staff.ts (2 fails); dropping "claims"
 * from the desk's topics (3 fails).
 */
import { readFileSync, mkdtempSync } from "node:fs";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readPortalSource } from "./lib/portal-source.mjs"; // v1.114.0 - the page is fourteen files now

/* v1.139.1 - fileURLToPath, NOT .pathname.
   On Windows `new URL("..", import.meta.url).pathname` is "/C:/Users/..." -
   a URL path with a leading slash, not a file path - so join() produced
   "\\C:\\Users\\..." and every read failed with "C:\\C:\\Users\\...". These
   guards had only ever run in Cloudflare's Linux build container, where the
   two happen to be the same string; the day PUSH.bat started running them on
   the CEO's own PC, 49 of them failed at once on a bug that was never about
   the code they check. */
const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(root, p), "utf8");
const staff = read("worker/src/staff.ts");
const deskSrc = read("worker/src/desk.ts");
const card = read("components/portal/one-desk.tsx");
const page = readPortalSource(root);
const tabsSrc = read("lib/portal-tabs.ts");

let failed = 0, passed = 0;
const ok = (label, cond, why = "") => {
  if (cond) passed++; else { failed++; console.log(`  ✗ ${label}${why ? ` — ${why}` : ""}`); }
};

const dir = mkdtempSync(join(tmpdir(), "desk-"));
const out = join(dir, "desk.mjs");
execSync(`npx esbuild "${join(root, "worker/src/desk.ts")}" --bundle --format=esm --platform=neutral --outfile="${out}" --log-level=error`, { cwd: root, stdio: "inherit" });
const { claimStepFor, claimChain } = await import(pathToFileURL(out).href);
const out2 = join(dir, "leave.mjs");
execSync(`npx esbuild "${join(root, "worker/src/leave-chain.ts")}" --bundle --format=esm --platform=neutral --outfile="${out2}" --log-level=error`, { cwd: root, stdio: "inherit" });
const { leaveCanActAt } = await import(pathToFileURL(out2).href);

/* ---- 1. the claim chain, run ---- */
{
  const V = (id, role) => ({ id, role });
  const claim = (claimant_role, { user_id = 50, payee_user_id = null, hr = null, pre = null } = {}) =>
    ({ user_id, payee_user_id, claimant_role, hr_reviewed_at: hr, pre_approved_at: pre });
  const HR = V(1, "hr_admin"), COO = V(2, "coo"), CCO = V(3, "cco"), CEO = V(4, "ceo"), MKT = V(5, "marketing"), ADMIN = V(6, "admin");

  ok("claimChain matches staff.ts", claimChain("live_host") === "staff" && claimChain("hr_admin") === "hr" && claimChain("cco") === "exec" && claimChain("ceo") === "top");

  const fresh = claim("marketing");
  ok("a fresh staff claim waits on HR", claimStepFor(HR, fresh) === "hr_review");
  ok("...not on the COO yet", claimStepFor(COO, fresh) === null, "HR review comes first - the decide route says so");
  ok("...and not on the CEO yet", claimStepFor(CEO, fresh) === null, "a claim mid-chain is not waiting on him");
  ok("...nor the CCO", claimStepFor(CCO, fresh) === null);
  ok("...nor another staff member", claimStepFor(MKT, fresh) === null);

  const reviewed = claim("marketing", { hr: "2026-09-01 01:00:00" });
  ok("after HR review a staff claim waits on the COO", claimStepFor(COO, reviewed) === "pre_approve");
  ok("...and is off HR's desk", claimStepFor(HR, reviewed) === null);
  ok("...and still not on the CEO", claimStepFor(CEO, reviewed) === null);

  const chained = claim("marketing", { hr: "2026-09-01 01:00:00", pre: "2026-09-02 01:00:00" });
  ok("a fully chained staff claim waits on the CEO", claimStepFor(CEO, chained) === "decide");
  ok("...and is off the COO's desk", claimStepFor(COO, chained) === null);

  const hrClaim = claim("hr_admin", { user_id: 1 });
  ok("an HR claim waits on the CCO, not HR", claimStepFor(CCO, hrClaim) === "pre_approve" && claimStepFor(HR, hrClaim) === null);
  ok("...and on the CEO only after pre-approval", claimStepFor(CEO, hrClaim) === null && claimStepFor(CEO, claim("hr_admin", { user_id: 1, pre: "x" })) === "decide");

  const cooClaim = claim("coo", { user_id: 2 });
  ok("an exec claim goes straight to the CEO", claimStepFor(CEO, cooClaim) === "decide");
  ok("...and is on nobody else's desk", [HR, CCO, MKT].every((v) => claimStepFor(v, cooClaim) === null) && claimStepFor(COO, cooClaim) === null);

  ok("nobody sees their own claim", claimStepFor(V(50, "hr_admin"), fresh) === null && claimStepFor(V(50, "ceo"), claim("ceo", { user_id: 50 })) === null);
  ok("a pre-approver never sees a claim that pays them", claimStepFor(COO, claim("marketing", { hr: "x", payee_user_id: 2 })) === null,
     "conflict of interest - the CEO decides it directly (v1.4.175)");
  ok("the admin tier stands in for HR and the COO", claimStepFor(ADMIN, fresh) === "hr_review" && claimStepFor(ADMIN, reviewed) === "pre_approve");
}

/* ---- 2. the leave chain, one definition ---- */
{
  const U = (id, role) => ({ id, role });
  ok("HR acts at applied", leaveCanActAt(U(1, "hr_admin"), "applied", "marketing", 50) === true);
  ok("the COO does not act at applied", leaveCanActAt(U(2, "coo"), "applied", "marketing", 50) === false);
  ok("the COO acts at hr_reviewed for staff", leaveCanActAt(U(2, "coo"), "hr_reviewed", "marketing", 50) === true);
  ok("the CEO acts at hr_reviewed for a COO applicant (skips pre-approval)", leaveCanActAt(U(4, "ceo"), "hr_reviewed", "coo", 2) === true && leaveCanActAt(U(3, "cco"), "hr_reviewed", "coo", 2) === false);
  ok("the CEO acts at pre_approved", leaveCanActAt(U(4, "ceo"), "pre_approved", "marketing", 50) === true);
  ok("nobody acts on their own", leaveCanActAt(U(50, "ceo"), "pre_approved", "ceo", 50) === false);
  ok("terminal stages are nobody's", leaveCanActAt(U(4, "ceo"), "approved", "marketing", 50) === false);

  ok("staff.ts imports the chain from leave-chain.ts", /from "\.\/leave-chain"/.test(staff));
  ok("staff.ts no longer defines leaveCanActAt itself", !/^function leaveCanActAt\(/m.test(staff),
     "two copies of an approval rule is how the desk shows a request its owner cannot act on");
  ok("the desk uses the shared rule", /import \{ leaveCanActAt \} from "\.\/leave-chain"/.test(deskSrc) && /leaveCanActAt\(user, r\.stage, r\.applicant_role, r\.user_id\)/.test(deskSrc));
  ok("the decide route still uses it too", (staff.match(/leaveCanActAt\(/g) ?? []).length >= 1);
}

/* ---- 3. the desk is wired ---- */
{
  ok("a door in staff.ts", /if \(path === "\/desk" && method === "GET"\) \{\s*return handleDesk\(env, user\);/.test(staff));
  ok("the card is remembered on the device", /useCachedApi<DeskData>\("\/staff\/desk"/.test(card));
  const topics = [...(card.match(/useCachedApi<DeskData>\("\/staff\/desk", true,\s*\[([^\]]*)\]/)?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  for (const t of ["leave", "claims", "attendance", "tasks", "announcements", "erp"]) {
    ok(`the desk refetches when ${t} moves`, topics.includes(t), "a bucket that never refreshes shows work already done");
  }
  const allTabs = [...(tabsSrc.match(/const ALL_TABS = \[([\s\S]*?)\] as const;/)?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  const deskTabs = [...deskSrc.matchAll(/tab: "([^"]+)"/g)].map((m) => m[1]);
  ok("every tab the desk names is a real tab", deskTabs.length > 0 && deskTabs.every((t) => allTabs.includes(t)), deskTabs.filter((t) => !allTabs.includes(t)).join(", "));
  const dash = page.slice(page.indexOf("function Dashboard("), page.indexOf("\n}\n", page.indexOf("function Dashboard(")));
  /* v1.115.0 - the CEO put Quick actions (clock in) first. v1.116.0 - four
     zones. v1.171.0 - five cards, the desk and the watchers in ONE frame for
     the executive tier.

     v1.175.0 - THE ZONES ARE THE SAME FIVE; THE ORDER IS CHOSEN. The owner,
     22-09-2026, on his own dashboard: business results and the decisions
     waiting on him have to come before the large personal attendance card,
     and a salesperson's follow-ups before both. So the five zones are named
     elements and DASHBOARD_ZONES says which order each job reads them in.
     This guard now asserts the MAP - which is the real rule - instead of the
     position of a string in a file, and asserts that re-ordering grants
     nothing: every zone still carries its own gate.

     THE RULES THE MAP MUST KEEP:
       - all three jobs render all five zones (a layout never hides a zone)
       - "business" puts the company and the desk above the person's own day
       - "shift" is unchanged: the clock first, as every staff member has had
       - the desk is never below the person's month in any job */
  const zonesM = page.match(/export const DASHBOARD_ZONES: Record<DashboardLead, readonly DashboardZone\[\]> = \{([\s\S]*?)\n\};/);
  const orderOf = (lead) => [...(zonesM?.[1] ?? "").matchAll(new RegExp(`${lead}: \\[([^\\]]*)\\]`, "g"))]
    .flatMap((m) => [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]));
  const FIVE = ["day", "desk", "month", "company", "around"];
  ok("the dashboard's reading order is a map, not a hard-coded sequence", Boolean(zonesM));
  for (const lead of ["business", "sales", "shift"]) {
    const o = orderOf(lead);
    ok(`${lead}: every zone is rendered, none twice`,
       o.length === 5 && FIVE.every((z) => o.includes(z)), o.join(" < "));
    ok(`${lead}: the desk is never below the person's own month`, o.indexOf("desk") < o.indexOf("month"));
  }
  {
    const b = orderOf("business");
    ok("business: the company and the decisions come before the person's own day",
       b.indexOf("company") < b.indexOf("day") && b.indexOf("desk") < b.indexOf("day"),
       b.join(" < "));
    ok("shift: the clock is still first for everybody else",
       JSON.stringify(orderOf("shift")) === JSON.stringify(["day", "desk", "month", "company", "around"]));
    const sl = orderOf("sales");
    ok("sales: the follow-ups lead, and the clock stays above the month",
       sl[0] === "desk" && sl.indexOf("day") < sl.indexOf("month"), sl.join(" < "));
  }
  ok("the order is applied by rendering the named zones, so no zone can be dropped",
     /\{shiftOnly \? zoneDay : DASHBOARD_ZONES\[lead\]\.map\(\(k\) => <Fragment key=\{k\}>\{ZONES\[k\]\}<\/Fragment>\)\}/.test(dash)
     && /const ZONES: Record<DashboardZone, ReactNode> = \{\s*day: zoneDay, desk: zoneDesk, month: zoneMonth, company: zoneCompany, around: zoneAround,/.test(dash));
  ok("which job a person is reading is decided by role AND by what they may open - never by the layout",
     /WATCHER_ROLES\.includes\(user\.role\) \? "business"/.test(dash)
     && /canOpen \? canOpen\("Sales"\) \|\| canOpen\("Ecommerce"\) : SALES_ROLES\.includes\(user\.role\)/.test(dash));
  ok("the zones are captioned, and the company caption lives inside the desk it captions",
     ["My day", "Waiting on me", "My month", "Around me"].every((z) => dash.includes(`<ZoneLabel>{L("${z}"`)) && /L\("The company", "Syarikat"\)/.test(read("components/portal/trading-desk.tsx")) && !dash.includes('L("The company"'),
     "a caption for a zone a role cannot see would be a heading over nothing");
  ok("the executive tier sees the desk and the watchers in one frame; everyone else the desk alone",
     /WATCHER_ROLES\.includes\(user\.role\) \? \(\s*<div className=\{card\}>\s*<OneDesk go=\{\(t\) => go\(t as TabName\)\} userId=\{user\.id\} bare \/>\s*<WatchersCard role=\{user\.role\} go=\{\(t\) => go\(t as TabName\)\} bare \/>\s*<\/div>\s*\) : \(\s*<OneDesk go=\{\(t\) => go\(t as TabName\)\} userId=\{user\.id\} \/>/.test(dash)
     && /export const WATCHER_ROLES = \["ceo", "coo", "cco", "super_admin", "admin"\];/.test(read("components/portal/watchers-card.tsx")),
     "one list of who sees the watchers, used by the card and by the frame around it");
  ok("bare drops only the frame - the desk's quiet line, list and order are untouched",
     /bare \? "" : `\$\{card\} border-l-4`/.test(card) && /if \(items\.length === 0\) \{\s*return \(\s*<p className="text-muted-foreground flex items-center gap-2 px-1 text-xs" role="status">/.test(card));
  ok("the Dashboard shows the month ONCE (no four-tile strip, no bar chart behind a pill)",
     !/erp-dashboard-stats/.test(dash) && !/deskTab/.test(dash) && /<MonthAttendanceCard days=\{monthDays\} month=\{mytToday\(\)\.slice\(0, 7\)\} lang=\{lang\} daysPresent=\{daysPresent\} hours=\{monthHours\} \/>/.test(dash));
  ok("the company is one card on the Dashboard (pulse); the Sales floor lives on Ecommerce",
     /<TradingDesk user=\{user\} go=\{go\} lang=\{lang\} mode="pulse" \/>/.test(dash) && !/<NextEventCard/.test(dash)
     && /<TradingDesk user=\{user\} go=\{go\} lang=\{lang\} mode="floor" \/>/.test(read("components/portal/trading-desk.tsx"))
     && /<RevenueAndHoursCard user=\{user\} go=\{setTab\} lang=\{lang\} \/>/.test(read("app/portal/page.tsx")));
  /* ---- v1.175.0 — two lists, a next action, and exactly one inline act ----
     The desk was one merged pile: a CEO with nine of his own tasks could not
     see the two approvals holding other people up. The worker now says which
     half each item is in, what the next action IS, and which single row may
     be acted on in place.

     THE EVIDENCE RULE, which is the whole reason there is only one: a row
     shows a title, a status and how long it has waited. That is enough to
     TAKE an unassigned enquiry (nobody owns it; taking is not an approval and
     is undone by reassigning). It is NOT enough to approve leave (the dates
     and who covers the shift), a claim (the receipt), overtime (the pair) or
     a punch (its context). Those rows link to the record where the evidence
     is. If a future change adds an approve button here, this guard fails. */
  ok("the worker says which half of the desk each item is in",
     /kind: "decide" \| "do";/.test(deskSrc)
     && /next: string;/.test(deskSrc)
     && (deskSrc.match(/kind: "decide"/g) ?? []).length >= 6
     && (deskSrc.match(/kind: "do"/g) ?? []).length >= 3);
  ok("an approval queue is a decision, and your own work is not",
     /bucket: "leave"[\s\S]{0,420}?kind: "decide"/.test(deskSrc)
     && /bucket: "claims"[\s\S]{0,420}?kind: "decide"/.test(deskSrc)
     && /bucket: "ot"[\s\S]{0,420}?kind: "decide"/.test(deskSrc)
     && /bucket: "punches"[\s\S]{0,420}?kind: "decide"/.test(deskSrc)
     && /bucket: "commission"[\s\S]{0,420}?kind: "decide"/.test(deskSrc)
     && /bucket: "news"[\s\S]{0,420}?kind: "do"/.test(deskSrc));
  ok("only an UNCLAIMED, NEW enquiry may be acted on from the desk",
     /takeable\?: true;/.test(deskSrc)
     && /e\.status === "new" && !e\.assigned_to \? \{ takeable: true as const \} : \{\}/.test(deskSrc)
     && (deskSrc.match(/takeable: true/g) ?? []).length === 1,
     "a second takeable bucket would mean an action whose evidence is not on screen");
  ok("the card draws two lists, and falls back by bucket when the payload is old",
     /L\("Your decision", "Keputusan anda"\)/.test(card) && /L\("Your work", "Kerja anda"\)/.test(card)
     && /const kindOf = \(i: DeskItem\): "decide" \| "do" =>/.test(card)
     && /DECIDE_BUCKETS\.includes\(i\.bucket\) \|\| i\.id\.startsWith\("task-close:"\)/.test(card));
  ok("the desk offers no approve or reject button of its own",
     !/(Approve|Luluskan|Reject|Tolak)</.test(card)
     && (card.match(/method: "(?:POST|PATCH|PUT|DELETE)"/g) ?? []).length === 1,
     "one call only: PATCH /enquiries/:id { assigned_to }");
  ok("taking an enquiry is the enquiries panel's own call, not a second workflow",
     /`\/enquiries\/\$\{enquiryId\}`, \{ method: "PATCH", body: JSON\.stringify\(\{ assigned_to: userId \}\) \}/.test(card)
     && /assigned_to: userId/.test(read("components/portal/enquiries-panel.tsx")),
     "the panel and the desk must take an enquiry the same way, or one of them is wrong");
  ok("a successful take refreshes the counts and the records without a reload",
     /applyVersions\(\{ enquiries: getVersion\("enquiries"\) \+ 1 \}\); desk\.refresh\(\);/.test(card));
  ok("a refused take keeps the row and offers a retry, and cannot be double-submitted",
     /if \(!userId \|\| busyId\) return;/.test(card)
     && /disabled=\{busyId === i\.id\}/.test(card)
     && /failedId === i\.id \? L\("Try again", "Cuba lagi"\)/.test(card)
     && /setFailWhy\(r\.data\?\.error\?\.message/.test(card));
  ok("nothing is one quiet line, not an empty box", /items\.length === 0[\s\S]{0,400}?Nothing is waiting on you/.test(card) && !/items\.length === 0[\s\S]{0,120}?className=\{card\}/.test(card));
  ok("overdue first, then oldest", /items\.sort\(\(a, b\) => Number\(b\.overdue\) - Number\(a\.overdue\) \|\| \(a\.since \?\? ""\)\.localeCompare/.test(deskSrc));
  ok("a missing table costs its bucket, not the desk", /if \(String\(e\)\.includes\("no such"\)\) missing\.push\(bucket\); else throw e;/.test(deskSrc));
  ok("the desk decides nothing", !/INSERT|UPDATE|DELETE/.test(deskSrc.replace(/\/\*[\s\S]*?\*\//g, "")), "a read over other modules' tables");
}

/* v1.148.1 - exitCode, NOT process.exit(). This guard `await import()`s a
   .ts module under --experimental-strip-types, and calling process.exit()
   while that loader is still tearing down aborts Node on Windows:
     Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), src\\win\\async.c:76
   cards-tab lost that race on the 09-09 deploy and failed the whole run one
   line after printing "35 passed, 0 failed", so nothing was published.
   Setting exitCode lets Node drain and exit on its own with the same status,
   and flushes stdout, which process.exit() on Windows does not reliably do.
   Early process.exit() calls in catch blocks above are left alone: those run
   only when an import already failed and MUST stop the script. */
if (failed) { console.log(`\n${failed} check(s) failed.`); process.exitCode = 1; }
else console.log(`PASS — the desk shows each person exactly what they may act on, by the rules the routes enforce (${passed} checks)`);
