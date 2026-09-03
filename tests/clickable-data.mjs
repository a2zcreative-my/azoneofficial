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
