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
import { pathToFileURL } from "node:url";

const root = new URL("..", import.meta.url).pathname;
const read = (p) => readFileSync(join(root, p), "utf8");
const staff = read("worker/src/staff.ts");
const deskSrc = read("worker/src/desk.ts");
const card = read("components/portal/one-desk.tsx");
const page = read("app/portal/page.tsx");
const tabsSrc = read("lib/portal-tabs.ts");

let failed = 0, passed = 0;
const ok = (label, cond, why = "") => {
  if (cond) passed++; else { failed++; console.log(`  ✗ ${label}${why ? ` — ${why}` : ""}`); }
};

const dir = mkdtempSync(join(tmpdir(), "desk-"));
const out = join(dir, "desk.mjs");
execSync(`npx esbuild ${join(root, "worker/src/desk.ts")} --bundle --format=esm --platform=neutral --outfile=${out} --log-level=error`, { cwd: root, stdio: "inherit" });
const { claimStepFor, claimChain } = await import(pathToFileURL(out).href);
const out2 = join(dir, "leave.mjs");
execSync(`npx esbuild ${join(root, "worker/src/leave-chain.ts")} --bundle --format=esm --platform=neutral --outfile=${out2} --log-level=error`, { cwd: root, stdio: "inherit" });
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
  const ret = dash.slice(dash.indexOf("  return ("));
  ok("the desk is the first card on the Dashboard", /<OneDesk go=/.test(ret) && ret.indexOf("<OneDesk") < ret.indexOf("personal KPI strip"),
     "the whole value is that when it has something it is the first thing you see");
  ok("nothing is one quiet line, not an empty box", /items\.length === 0[\s\S]{0,400}?Nothing is waiting on you/.test(card) && !/items\.length === 0[\s\S]{0,120}?className=\{card\}/.test(card));
  ok("overdue first, then oldest", /items\.sort\(\(a, b\) => Number\(b\.overdue\) - Number\(a\.overdue\) \|\| \(a\.since \?\? ""\)\.localeCompare/.test(deskSrc));
  ok("a missing table costs its bucket, not the desk", /if \(String\(e\)\.includes\("no such"\)\) missing\.push\(bucket\); else throw e;/.test(deskSrc));
  ok("the desk decides nothing", !/INSERT|UPDATE|DELETE/.test(deskSrc.replace(/\/\*[\s\S]*?\*\//g, "")), "a read over other modules' tables");
}

if (failed) { console.log(`\n${failed} check(s) failed.`); process.exit(1); }
console.log(`PASS — the desk shows each person exactly what they may act on, by the rules the routes enforce (${passed} checks)`);
