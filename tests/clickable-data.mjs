/**
 * Dead-end data guard (v1.88.0) — guard #31.
 *
 * CEO, 03-09-2026: *"Audit all the tabs and ensure that all the tabs have a
 * function of clickable data without me need to open another new tabs."*
 *
 * He had asked the narrow version of this at v1.21.5, about the stock chips:
 * *"for low should like animation to make staff alert and data will appear
 * when click without go to the tabs/table"*. That was built, and then every
 * card added since printed its figures as text again.
 *
 * A DEAD END is a number the interface asks you to act on and gives you no
 * way to open: "3 overdue", "12 unpaid invoices", "7 not acknowledged". You
 * read it, and then you go and find the rows yourself on another tab — which
 * is the trip he is asking to stop making.
 *
 * An audit of the portal found FORTY, in thirteen files, with two structural
 * causes behind them:
 *
 *   1. `StatTile` had no `onClick` AT ALL, so all twenty-two of its call
 *      sites were dead by construction. Its sibling `StatCard` has accepted
 *      one since v1.13.0 — the two halves of the same idea disagreed about
 *      whether a number is a door.
 *   2. Several cards render a row of count chips where SOME are buttons and
 *      the rest are spans, in the same `.map()`. A chip that opens beside one
 *      that does not is worse than neither opening: it teaches you the row is
 *      inert.
 *
 * WHAT THIS GUARD CHECKS is deliberately narrow, because "should this number
 * be clickable" is a judgement and a linter that guesses at it would cry
 * wolf until it was ignored. It checks the two things that are NOT
 * judgement:
 *
 *   A. The components that carry figures can take an action at all.
 *   B. The specific dead ends fixed in v1.88.0 have not silently reverted —
 *      each named with what it opens, so a regression says what was lost.
 *
 *   node tests/clickable-data.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { readPortalSource } from "./lib/portal-source.mjs"; // v1.114.0 - the page is fourteen files now

import { fileURLToPath } from "node:url";

/* v1.139.1 - fileURLToPath, NOT .pathname.
   On Windows `new URL("..", import.meta.url).pathname` is "/C:/Users/..." -
   a URL path with a leading slash, not a file path - so join() produced
   "\\C:\\Users\\..." and every read failed with "C:\\C:\\Users\\...". These
   guards had only ever run in Cloudflare's Linux build container, where the
   two happen to be the same string; the day PUSH.bat started running them on
   the CEO's own PC, 49 of them failed at once on a bug that was never about
   the code they check. */
const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => (existsSync(path.join(root, p)) ? readFileSync(path.join(root, p), "utf8") : "");

let pass = 0;
const fails = [];
const ok = (label, cond, extra = "") => {
  if (cond) pass++;
  else fails.push(`${label}${extra ? ` — ${extra}` : ""}`);
};

/* ---- A. the figure components can be opened ---- */
{
  const tile = read("components/ui/stat-tile.tsx");
  const cardC = read("components/ui/stat-card.tsx");
  ok("there are figure components to check", tile.length > 200 && cardC.length > 200);
  ok("StatTile can carry an action", /onClick\?: \(\) => void;/.test(tile),
     "twenty-two call sites were dead by construction because this prop did not exist");
  ok("StatCard still can", /onClick/.test(cardC),
     "the two halves of the same idea must not disagree about whether a number is a door");
  /* A tile with nothing behind it must NOT look pressable. */
  ok("a tile with no action stays a plain div",
     /if \(!onClick\) return <div className=\{shell\}>\{body\}<\/div>;/.test(tile),
     "a tile that looks clickable and does nothing is worse than one that never offered");
  ok("an opened tile says which one is open",
     /aria-pressed=\{active\}/.test(tile),
     "a filter you cannot see is applied is a filter you cannot clear");
}

/* ---- B. the dead ends that were fixed ---- */
{
  const cases = [
    ["the company task counts open their tasks", "components/portal/company-monitor.tsx",
     /<CountTile key=\{k\}/, "the card's own comment calls two of them the numbers that demand a manager's action"],
    ["and the list agrees with the figure above it", "components/portal/company-monitor.tsx",
     /const matches = \(t: MonTask\): boolean =>/, "a tile of 3 that opens 4 rows is worse than a tile that opens nothing"],
    ["the quiet stock chips open like their siblings", "components/portal/company-monitor.tsx",
     /if \(!alert\) \{[\s\S]{0,400}?aria-expanded=\{isOpenQ\}/, "one chip in the row opened and the rest did not"],
    /* v1.173.0 (tab concept): the counts are the AT A GLANCE figures (SummaryStat, a
       button with aria-pressed) - the same filter, one row up. */
    /* v1.199.0 - the counts are Overview tiles (KpiTile, a button); pressing
       one opens the Asset Register filtered to that status */
    ["asset counts filter the asset table", "components/portal/assets-panel.tsx",
     /<KpiTile key=\{k\}[\s\S]{0,300}?onClick=\{\(\) => openStatus\(k\)\}/, "the identical chip row in content-panel has filtered its table for releases"],
    ["and the tile opens the register on that status", "components/portal/assets-panel.tsx",
     /const openStatus = \(k: string\) => \{ setStatusF\(statusF === k && view === "register" \? "" : k\);[^\n]*go\("register"\)/, "a tile that filters a table on another tab must also show that tab"],
    ["and the asset filter keys on the CODE, not the label", "components/portal/assets-panel.tsx",
     /a\.status === statusF/, "keying on a translated label breaks the filter the moment somebody switches to BM"],
    ["the state chips scope the customer list", "components/portal/elfia-traffic-panel.tsx",
     /aria-pressed=\{stateF === st\}/, "every state on the MAP above has been a button since v1.43.0"],
    /* v1.310.0 (Claims 4.0) - the month strip above the list left with the
       old records card; the Overview's five figures are the summary now, and
       each one opens the claims it counts, filtered */
    ["the claims summary scopes the claim list", "components/portal/role-panels.tsx",
     /const onTile = \(k: [^)]*\) => \{\s*setClaimF\(k\);/, "four figures above a list of every claim, none of which opened it"],
    ["...from each of the Overview's figures", "components/portal/claims-overview.tsx",
     /onClick=\{\(\) => onTile\("pending"\)\}[\s\S]*onClick=\{\(\) => onTile\("approved"\)\}[\s\S]*onClick=\{\(\) => onTile\("paid"\)\}[\s\S]*onClick=\{\(\) => onTile\("rejected"\)\}/, "four figures above a list of every claim, none of which opened it"],
    /* v1.182.1 - the rail badge checks left with components/portal/side-columns.tsx
       (the Dashboard's "Calendar and team overview" fold is gone). */
    /* v1.91.0 — CEO: "Leave — whole company I want to have a clickable to
       see the details of the leave application!" The name is the door, on
       the in-progress rows AND the decided ones, and both open the same
       detail with the approval trail. */
    /* v1.206.0 - one register table: the person (and View) opens the
       details drawer, for a leave in progress and a decided one alike, and
       the drawer draws the one LeaveDetail */
    ["a company-board leave opens on its name", "components/portal/leave.tsx",
     /<button type="button" className=\{lv\.person\} onClick=\{\(\) => setDrawerId\(l\.id\)\}[\s\S]{0,300}?\{who\(l\)\}/, "the reason and the approval trail were in the row and nowhere on the screen"],
    ["every leave opens the same drawer, with the one detail", "components/portal/leave.tsx",
     /* v1.252.0 - the drawer body holds the one LeaveDetail under its Progress and Details tabs */
     /all\.find\(\(x\) => x\.id === drawerId\) \?\? mine\.find\(\(x\) => x\.id === drawerId\)[\s\S]{0,14000}?<LeaveDrawerBody key=\{d\.id\} l=\{d\} own=\{own\} meName=\{user\.name\}/, "one detail for both halves of the board, not two"],
    /* v1.92.0 — the Staff tab is a row of faces; a face opens its record. */
    /* v1.93.0 — the circle and the phone row both press through one
       handler, and that handler opens the record. */
    /* v1.201.0 - the five-tab Staff page: a face opens the person's profile
       drawer, and the drawer's "Open full record" opens the record on Staff
       Records. Still one handler, still a door, one step further. */
    ["a staff face opens the profile, and the profile opens the record", "components/staff/staff-directory.tsx",
     (src) => /const press = \(u: Staff\) => \{[\s\S]{0,200}?setPeek\(u\.id\)/.test(src)
       && /const openRecord = \(id: number\) => \{[\s\S]{0,120}?setOpen\(new Set\(\[id\]\)\);\s*setTab\("records"\)/.test(src)
       && /onClick=\{\(\) => openRecord\((?:peekU|u)\.id\)\}/.test(src),
     "a circle that is only a picture is the old list with the words removed"],
    /* v1.308.0 - STAFF WORKSPACE 4.0: the orbit became the Team Map of
       reference 04 (components/staff/team-map.tsx). The same properties, on
       the new map: every face presses ONE handler (the page's press), the
       field is a square and capped, one radius feeds both axes, a birthday is
       working staff only and never the year. */
    ["every face on the map and on the phone grid presses that handler", "components/staff/team-map.tsx",
     (src) => {
       /* every <button> that draws a <Face> presses onOpen - the circle, the
          CEO, the phone grid, the birthday and leave lists */
       const btns = [...src.matchAll(/<button[^>]*>(?:(?!<\/button>)[\s\S])*?<Face u=\{[^}]+\}(?:(?!<\/button>)[\s\S])*?<\/button>/g)].map((m) => m[0]);
       return btns.length >= 4 && btns.every((t) => /onClick=\{\(\) => onOpen\((?:u|ceo)\)\}/.test(t))
         && /onOpen=\{\(u\) => press\(u as Staff\)\}/.test(readFileSync(path.join(root, "components/staff/staff-directory.tsx"), "utf8"));
     }, "two layouts, one door"],
    ["the map is laid out on a square, capped field", "components/staff/team-map.module.css",
     /\.field \{[^}]*max-width: 35rem;[^}]*aspect-ratio: 1 \/ 1;/, "percentages of a wide strip are an ellipse, not a circle"],
    ["one radius per ring, not one per axis", "components/staff/team-map.tsx",
     /left: 50 \+ r \* 100 \* Math\.cos\(a\), top: 50 \+ r \* 100 \* Math\.sin\(a\)/, "two radii is how a circle becomes an ellipse the day the container changes shape"],
    ["a sector holds no more faces than its arc fits, and says +n for the rest", "components/staff/team-map.tsx",
     /const cap = Math\.max\(1, Math\.floor\(\(span \* r \* fieldPx\) \/ CELL\)\);[\s\S]{0,900}?more\.push\(\{ dept, n: rest\.length/, "overlapping faces are the thing the reference does not do"],
    ["next birthdays are working staff within a week, day and month only", "components/staff/team-map.tsx",
     /const birthdays = people\.filter\(\(u\) => !gone\(u\)\)[\s\S]{0,200}?x\.b!\.days <= 7\)[\s\S]*?const dayMonth = \(next: string\) =>/, "a birthday shows the day, never the year or the age"],
    ["a closed record draws nothing but its face", "components/staff/staff-directory.tsx",
     /if \(!open\.has\(u\.id\)\) return null;/, "the cards were the clutter the faces replace"],
    ["a face on the map names the person it opens", "components/staff/team-map.tsx",
     /aria-label=\{L\(`\$\{displayName\(u\)\} - open the profile`/, "a face that says nothing is a picture, not a control"],
    ["the detail carries the approval trail", "components/portal/leave.tsx",
     /* v1.252.0 - the trail is the server's timeline (leave-chain.ts), drawn by the shared StageTimeline */
     /function leaveStages\([\s\S]{0,1500}?L\("HR review"[\s\S]{0,300}?L\("Pre-approval - COO or CCO"[\s\S]{0,300}?L\("CEO decision"[\s\S]*?function LeaveDetail\([\s\S]{0,3500}?<StageTimeline stages=\{leaveStages\(l\)\}/, "who decided it, and when, is what a manager opens a leave to see"],
  ];
  for (const [label, file, re, why] of cases) {
    /* v1.99.2 — a case may be a regex OR a predicate over the file, so a
       check can assert a property across every occurrence instead of one
       hand-measured window. */
    ok(label, typeof re === "function" ? re(read(file)) : re.test(read(file)), why);
  }
}

console.log(
  fails.length === 0
    ? `PASS — a figure worth acting on can be opened where it stands (${pass} checks)`
    : `\n${fails.map((f) => `  ✗ ${f}`).join("\n")}\n\n${fails.length} check(s) failed.`,
);
process.exit(fails.length === 0 ? 0 : 1);
