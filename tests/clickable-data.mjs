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

const root = new URL("..", import.meta.url).pathname;
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
    ["asset counts filter the asset table", "components/portal/assets-panel.tsx",
     /aria-pressed=\{statusF === k\}/, "the identical chip row in content-panel has filtered its table for releases"],
    ["and the asset filter keys on the CODE, not the label", "components/portal/assets-panel.tsx",
     /a\.status === statusF/, "keying on a translated label breaks the filter the moment somebody switches to BM"],
    ["the state chips scope the customer list", "components/portal/elfia-traffic-panel.tsx",
     /aria-pressed=\{stateF === st\}/, "every state on the MAP above has been a button since v1.43.0"],
    ["Open POs narrows the table", "components/portal/purchasing-panels.tsx",
     /rows=\{openOnly \? open : pos\}/, ""],
    ["the Suppliers tile does what the Suppliers button does", "components/portal/purchasing-panels.tsx",
     /active=\{showSuppliers\} onClick=\{\(\) => setShowSuppliers/, "the tile was the inert twin of a control right beside it"],
    ["the claims summary scopes the claim list", "components/portal/role-panels.tsx",
     /aria-pressed=\{claimF === k\}/, "four figures above a list of every claim, none of which opened it"],
    ["the rail badge opens the tab it counts for", "components/portal/side-columns.tsx",
     /onCount\s*\n?\s*\? <button/, "the badge is the rail's whole point - how many things are waiting on you"],
    ["a rail badge with nowhere to go stays a span", "components/portal/side-columns.tsx",
     /: <span className=\{badge\}>\{count\}<\/span>/, "same rule as the tile: never promise an action that is not there"],
    /* v1.91.0 — CEO: "Leave — whole company I want to have a clickable to
       see the details of the leave application!" The name is the door, on
       the in-progress rows AND the decided ones, and both open the same
       detail with the approval trail. */
    ["a company-board leave in progress opens on its name", "app/portal/page.tsx",
     /aria-expanded=\{openAll === l\.id\}[\s\S]{0,400}?\{who\(l\)\}[\s\S]{0,3000}?\{openAll === l\.id && <LeaveDetail l=\{l\} meName=\{user\.name\} \/>\}/, "the reason and the approval trail were in the row and nowhere on the screen"],
    ["a decided leave opens the same way", "app/portal/page.tsx",
     /\{openAll === l\.id && editLeave\?\.id !== l\.id && <LeaveDetail l=\{l\} meName=\{user\.name\} \/>\}/, "one detail for both halves of the board, not two"],
    /* v1.92.0 — the Staff tab is a row of faces; a face opens its record. */
    /* v1.93.0 — the circle and the phone row both press through one
       handler, and that handler opens the record. */
    ["a staff face opens the record", "components/staff/staff-directory.tsx",
     /const press = \(u: Staff\) => \{[\s\S]{0,300}?setOpen\(\(o\) => \(o\.has\(u\.id\) \? new Set\(\) : new Set\(\[u\.id\]\)\)\)/, "a circle that is only a picture is the old list with the words removed"],
    ["every face on the circle and on the phone row presses that handler", "components/staff/staff-directory.tsx",
     /<StaffBubble u=\{u\}[\s\S]{0,300}?onPress=\{\(\) => press\(u\)\}[\s\S]{0,2500}?<StaffBubble key=\{u\.id\}[\s\S]{0,300}?onPress=\{\(\) => press\(u\)\}/, "two layouts, one door"],
    /* v1.94.1 — the field is a square, so a ring is a circle. Percentages
       of a 1600x460 strip drew a flat ellipse and ran the outer ring into
       the labels below it. */
    /* v1.99.1 — asserted as PROPERTIES now, not as the 34rem cap and the
       exact radius list the first draft pinned (which a correct redraw had
       to move). A circle is: a square field, and one radius that feeds both
       the x and the y of every face and both the width and the height of
       every ring. */
    ["the circle is laid out on a square field", "components/staff/staff-directory.tsx",
     /className="sd-orbit relative mx-auto aspect-square w-full max-w-\[\d+rem\]"/, "percentages of a wide strip are an ellipse, not a circle"],
    ["one radius per ring, not one per axis", "components/staff/staff-directory.tsx",
     /left: 50 \+ r \* Math\.cos\(angle\), top: 50 \+ r \* Math\.sin\(angle\)/, "two radii is how a circle becomes an ellipse the day the container changes shape"],
    ["a ring is drawn with one number for width and height", "components/staff/staff-directory.tsx",
     /width: `\$\{r \* 2\}%`, height: `\$\{r \* 2\}%`/, "a ring drawn from two numbers is an ellipse waiting for a resize"],
    ["a face within a fortnight of a birthday carries the cake", "components/staff/staff-directory.tsx",
     /return b && b\.days <= 14 && !\["resigned", "terminated"\]\.includes\(u\.employment_status \?\? ""\) \? b : null;/, "the separate Birthdays card was retired for this"],
    ["a closed record draws nothing but its face", "components/staff/staff-directory.tsx",
     /if \(!open\.has\(u\.id\)\) return null;/, "the cards were the clutter the faces replace"],
    ["the face says which mode it is in", "components/staff/staff-directory.tsx",
     /aria-pressed=\{selectMode \? selected : open\}/, "a face that ticks when you expected it to open teaches distrust"],
    ["the detail carries the approval trail", "app/portal/page.tsx",
     /function LeaveDetail\([\s\S]{0,2500}?L\("HR reviewed"[\s\S]{0,600}?L\("Pre-approved"[\s\S]{0,600}?L\("Final"/, "who decided it, and when, is what a manager opens a leave to see"],
  ];
  for (const [label, file, re, why] of cases) {
    ok(label, re.test(read(file)), why);
  }
}

console.log(
  fails.length === 0
    ? `PASS — a figure worth acting on can be opened where it stands (${pass} checks)`
    : `\n${fails.map((f) => `  ✗ ${f}`).join("\n")}\n\n${fails.length} check(s) failed.`,
);
process.exit(fails.length === 0 ? 0 : 1);
