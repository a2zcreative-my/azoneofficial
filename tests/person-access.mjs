/**
 * Person-access guard (v1.90.0) — guard #34.
 *
 * CEO, 04-09-2026: *"for some of the access I want to also review what they
 * can see and what they cant see which is for me to authorize them to
 * access it in users tabs."*
 *
 * A person may now carry tabs granted to them and tabs refused, above the
 * role. The rule is small and easy to get subtly wrong, so this guard RUNS
 * it rather than reading it: lib/portal-tabs.ts is imported and canSeeTab /
 * accessOf are called with real inputs. The worker side is checked for the
 * properties that keep it a CEO tool — gated, audited, validated, and never
 * handing one person another person's entry.
 *
 * Node 22.18+ imports .ts directly (type stripping). On an older Node the
 * guard re-runs itself with the flag rather than failing on syntax.
 *
 *   node tests/person-access.mjs
 */
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const root = new URL("..", import.meta.url).pathname;
const read = (p) => readFileSync(path.join(root, p), "utf8");

let mod;
try {
  mod = await import(new URL("../lib/portal-tabs.ts", import.meta.url));
} catch (e) {
  if (!process.execArgv.includes("--experimental-strip-types")) {
    const r = spawnSync(process.execPath, ["--experimental-strip-types", ...process.argv.slice(1)], { stdio: "inherit" });
    process.exit(r.status ?? 1);
  }
  console.error(`could not import lib/portal-tabs.ts: ${e.message}`);
  process.exit(1);
}
const { canSeeTab, accessOf, ALL_TABS, ALWAYS_VISIBLE } = mod;

let pass = 0;
const fails = [];
const ok = (label, cond, extra = "") => {
  if (cond) pass++;
  else fails.push(`${label}${extra ? ` — ${extra}` : ""}`);
};

/* ---- A. the rule, executed ---- */
{
  /* Pick a tab the role cannot see by default and one it can. */
  const role = "marketing";
  const hiddenTab = ALL_TABS.find((t) => !ALWAYS_VISIBLE.includes(t) && !canSeeTab(role, t));
  const seenTab = ALL_TABS.find((t) => !ALWAYS_VISIBLE.includes(t) && canSeeTab(role, t));
  ok("the fixture found one hidden and one visible tab for the role", Boolean(hiddenTab && seenTab), `${hiddenTab} / ${seenTab}`);

  ok("a grant shows a tab the role hides", canSeeTab(role, hiddenTab, {}, { allow: [hiddenTab], deny: [] }));
  ok("a refusal hides a tab the role shows", !canSeeTab(role, seenTab, {}, { allow: [], deny: [seenTab] }));
  ok("deny beats allow", !canSeeTab(role, seenTab, {}, { allow: [seenTab], deny: [seenTab] }),
     "a tab in both lists must stay hidden — refusing is the stronger act");
  ok("a grant beats a role override that excludes the role",
     canSeeTab(role, seenTab, { [seenTab]: ["ceo"] }, { allow: [seenTab], deny: [] }));
  ok("no personal entry means the role decides", canSeeTab(role, seenTab, {}, null) && !canSeeTab(role, hiddenTab, {}, null));
  for (const t of ALWAYS_VISIBLE) {
    ok(`${t} cannot be refused`, canSeeTab(role, t, {}, { allow: [], deny: [t] }), "clocking in and reading a payslip are not permissions");
  }
  ok("super_admin is not governed", canSeeTab("super_admin", seenTab, {}, { allow: [], deny: [seenTab] }),
     "the escape hatch must survive a refusal aimed at it");

  const rows = accessOf(role, {}, { allow: [hiddenTab], deny: [seenTab] });
  const by = Object.fromEntries(rows.map((r) => [r.tab, r]));
  ok("accessOf covers every tab exactly once", rows.length === ALL_TABS.length && new Set(rows.map((r) => r.tab)).size === ALL_TABS.length);
  ok("accessOf explains a grant", by[hiddenTab].sees && by[hiddenTab].reason === "granted");
  ok("accessOf explains a refusal", !by[seenTab].sees && by[seenTab].reason === "refused");
  ok("accessOf explains an always-visible tab", ALWAYS_VISIBLE.every((t) => by[t].sees && by[t].reason === "always"));
  ok("a redundant grant reads as the role, not as a grant",
     accessOf(role, {}, { allow: [seenTab], deny: [] }).find((r) => r.tab === seenTab).reason === "role",
     "a chip marked + on a tab the role already shows would teach that + means nothing");
  ok("accessOf agrees with canSeeTab on every tab", rows.every((r) => r.sees === canSeeTab(role, r.tab, {}, { allow: [hiddenTab], deny: [seenTab] })));
}

/* ---- B. the worker keeps it a CEO tool ---- */
{
  const staff = read("worker/src/staff.ts");
  const i = staff.indexOf('path === "/tabs/access/person"');
  const route = i < 0 ? "" : staff.slice(i, i + 3500);
  ok("the person route exists", route.length > 1000);
  ok("only the CEO (or super_admin) may change a person's tabs",
     /if \(user\.role !== "ceo" && user\.role !== "super_admin"\) return err\("forbidden"/.test(route.slice(0, 400)));
  ok("the tab is validated against the governable list", /TAB_ACCESS_TABS\.includes\(tabName\)/.test(route));
  ok("the mode is validated", /\["allow", "deny", "clear", "reset"\]\.includes\(mode\)/.test(route));
  ok("a customer account cannot be targeted", /target\.role === "customer"\) return err\("not_found"/.test(route));
  ok("super_admin cannot be targeted", /target\.role === "super_admin"\) return err\("invalid_input"/.test(route),
     "governing the account that bypasses governance is a setting that lies");
  ok("every change is audited with the person and the tab", /audit\(env, user\.id, "tabs\.person_access", "users", String\(targetId\)/.test(route));
  ok("an emptied entry is removed, not stored as two empty lists",
     /if \(next\.allow\.length === 0 && next\.deny\.length === 0\) delete people\[String\(targetId\)\]/.test(route));

  const j = staff.indexOf('path === "/tabs/access" && method === "GET"');
  const getRoute = j < 0 ? "" : staff.slice(j, j + 900);
  ok("a staff member receives only their own entry", /mine: people\[String\(user\.id\)\] \?\? null/.test(getRoute) && !/people\s*\}\)/.test(getRoute),
     "the whole map is a CEO read; handing it to everyone tells each person what the others were refused");
  const k = staff.indexOf('path === "/tabs/access/people"');
  ok("the whole map is gated", /if \(user\.role !== "ceo" && user\.role !== "super_admin"\) return err\("forbidden"/.test(staff.slice(k, k + 400)));
}

/* ---- C. the portal draws from the same rule ---- */
{
  const page = read("app/portal/page.tsx");
  ok("the tab strip passes the personal entry to canSeeTab", /canSeeTab\(user\?\.role, t, tabOverrides, myTabAccess\)/.test(page),
     "a grant the strip ignores is a grant nobody receives");
  const cardSrc = read("components/portal/access-review-card.tsx");
  ok("the review card asks accessOf, not its own copy of the rule", /accessOf\(person\.role, overrides, mine\)/.test(cardSrc) && !/defaultRolesFor\(/.test(cardSrc),
     "two copies of the rule disagree the first time one is edited");
  ok("every press reports", /const change = async[\s\S]{0,1500}?toast\(/.test(cardSrc));
  ok("the always-visible chips cannot be pressed", /r\.reason === "always" \|\| busy \? undefined/.test(cardSrc));
}

console.log(
  fails.length === 0
    ? `PASS — one person can be granted or refused a tab above the role, and only the CEO can do it (${pass} checks)`
    : `\n${fails.map((f) => `  ✗ ${f}`).join("\n")}\n\n${fails.length} check(s) failed.`,
);
process.exit(fails.length === 0 ? 0 : 1);
