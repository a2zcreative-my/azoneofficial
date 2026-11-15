# GATE 1.311.0 — Commission Workspace 5.0: six views, one engine, the CEO owner verifies

**Status:** BUILT AND TESTED. NOT DEPLOYED.
- **One additive migration: `0196_commission_guards`, triggers only.** No table, column or row is changed by it.
- **The 10% Direct Sales and 7% Agent + 3% salesperson rules are unchanged.** No historical entitlement, payment or audit row is rewritten.

**Authority:** the CEO, 15-11-2026: "approve as per recommend, and help to make the dashboard card much better width and aligned" (K-0 to K-13 in `claude/COMMISSION-WORKSPACE-5.0-BLUEPRINT.md`).
**Sits on:** 1.310.0 (Claims 4.0), which `/api/v1/health` reports live.

## The six views (your references)
Each view has its own address (`/portal?tab=Commission&view=…`), and Back/Forward work. The month, company and New Deal sit on their own row under the tabs, so no tab is cut off. On a phone, the view switch and **New Deal** replace the tab row.

1. **Overview**
   - Four figures: **Confirmed Sales** (verified paid), **Commission Payable**, **Pending** (estimated, never payable), **To Payroll** (employees only).
   - **Commission by Role:** agent 7%, salesperson 3%, direct 10%.
   - **Sales & Commission Performance:** the target is read from Sales (K-11).
   - **Recent Commission** and **Needs Attention** (payments to verify, deals held, payouts to authorise or settle, payroll waiting).
2. **Transactions:** one line per paid invoice, plus this month's pending ones. Filters: status, deal type, salesperson, company, search. Pages of 25 and a CSV.
3. **Agent Deals**
   - The rate in force; each agent with their salesperson, deals, sales and commission.
   - The held-for-review queue.
   - **"Hold new agent sales"** (K-1, the old switch reworded; the policy is the only authority).
   - **Add Agent** and **New Deal** open Agents and Sales (K-10). Commission creates neither.
4. **Policy Settings:** the structure in force, its rules, drafts and versions.
5. **Payroll Sync**
   - Select period → Review → **Sync to Payroll**, which runs Payroll's own recompute (K-6; the CEO or COO).
   - Employees only. Agent settlements are apart, in Finance.
6. **Audit History:** filters by action group, person and dates; each event shows who did it and their role.

A salesperson has one view, **My commission**: their own figures and invoices only. They never see the agent, another salesperson or the attention list.

## What changed in the rules (as approved)
- **K-3:** only the CEO who is the company owner confirms an invoice paid or takes a confirmation back.
  - The COO and the Super Admin no longer can.
  - A second CEO-role account that is not the owner cannot either.
- **K-4:** the Super Admin no longer approves a policy, decides an attribution or authorises a payout.
- **K-5:** agent payouts follow three rules, and dual control is kept:
  - the CEO authorises a payout;
  - **Finance (the COO) settles it**, with one cash-book row under `AGT-<id>`;
  - only the CEO cancels one.
- **K-7:** the CEO's own sale never earns: RM 0, void, with the note. An agent's 7% on such a sale is untouched.
- **F-2:** "Eligible" now counts the salespeople's money only. The agents' money is shown apart.
- **K-2 (migration 0196):** the database refuses the following:
  - changing an approved or rejected policy version;
  - changing a draft's terms;
  - deleting a version or a package rule;
  - changing an entitlement's amount, rate, recipient or key;
  - reopening a paid or void entitlement;
  - deleting any entitlement.
  - Every engine route already writes within these rules.

## Dashboard (your screenshot)
- The four figures now fill their row at 1024, 1280 and 1440 px, at equal widths.
- **Sales Performance** sits under figures 1–2 and **Needs My Decision** under 3–4, at equal height.
- The cause was the overview grid's 5 columns from 1280 px.

## Evidence (executed in the sandbox)
- **New `tests/commission5.mjs`:** the whole worker against SQLite with every migration, by direct request as each role. **85 checks; all 14 deliberately broken versions were caught**, including:
  - any CEO account confirms paid, or takes a confirmation back;
  - the Super Admin approves a policy;
  - the CEO settles a payout;
  - the CEO's own sale earns;
  - "eligible" counts the agents' money;
  - payroll counts the agents;
  - a salesperson sees the agent's row;
  - the company filter is ignored;
  - Agent Deals is open to a salesperson;
  - each of the three 0196 guards is dropped.
- **Browser `commission5.py`: 55/55**, covering:
  - the CEO, the COO and a salesperson;
  - all six views and their addresses, with Back/Forward;
  - no tab cut off at 1440 px;
  - the phone view switch and cards;
  - no sideways page at 320–1440 px;
  - the Dashboard's four figures and the 2 + 2 alignment at 1024/1280/1440.
- **Updated to the approved rules**, with every original intent kept:
  - `commission-ledger`, `commission-flow`, `commission-config`, `go-live-n`, `payroll-commission`, `self-approval`;
  - `tab-concept` (the views' zones now live in the view components);
  - `attendance4`, `hr4`, `staff4` (their "no migration" checks now allow 0196, which is Commission's);
  - `access-policy`, `owner-access`, `matrix-edit` (Confirm Paid is the CEO's alone; the COO is refused);
  - `business-joins` (the ERP roadmap and AGENTS name 0196);
  - browser `agent-commission.py`: 55/55. The payouts now live in Payroll Sync, and the COO settles them; the Super Admin and the CEO cannot.
- **Checks:** typecheck is clean (app and worker); lint shows 122 warnings and 0 errors; the build succeeded.
- **Also re-run in the browser, all passing:**
  - `ecc4`: 208/208
  - `desk5`: 168/168
  - `nav-1`: 138/138
  - `shell-e1`: 30/30
  - `compact-dashboard`: 43/43
  - `dashboard-e2`: 49/49
  - `overflow-sweep`: 270/270 screens
  - `sales4`: 356/356
  - `paid-status`: 24/24
  - `payments-verify`: 63/63
  - `payroll-figures`
  - `ui-audit`, `table-shred` and `webkit-overflow` need Selenium, which this sandbox does not have, so they were not run.
- **Full guard run with the mutation pass: 197 / 197 passed** ("[OK] all 197 guards passed"; `commission5` newly registered).
- **Re-checked after the full run:**
  - The only later change is UI-only, in `agent-deals.tsx`. The CEO's payout card now says Finance (the COO) settles it.
  - The source guards re-run clean: design-tokens, skeleton-loading, interface-v3, tab-concept, clickable-data, tab-zones, commission-config, commission-flow.
  - Lint shows 122 warnings, and typecheck is clean.

## Deploy notes
- PUSH.bat applies 0196 (triggers only). `/api/v1/health/detail` probes it: a missing trigger shows as pending.
- **Recommended before deploying:** run the blueprint's six read-only P0 queries (§12) on production and send me the results. Pay most attention to:
  - Query 3 (the ledger by role and status): an existing row stays exactly as it was, because 0196 forbids rewriting it, and K-7 applies only to new confirmations.
  - Query 5 (payouts by status): an `authorized` payout waits for the COO to settle it.
  - Query 6: the last applied migration should be 0195, before PUSH.bat applies 0196.
- The Attendance P3 migration planned as 0196 becomes 0197.

## Rollback
- Re-run PUSH.bat from the 1.310.0 files.
- The 0196 triggers can stay, because they only refuse rewrites the code never makes.
- No row was changed by this release.
