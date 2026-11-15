# GATE 1.317.0 — The duplicate-function audit, fixed

**Status:** BUILT AND TESTED. **NOT DEPLOYED.**
**Migration:** none. No data is deleted or rewritten.

**Authority:** the CEO, 15-11-2026: "fix the issue as per recommended". The findings are D-1 to D-9 of `claude/DUPLICATION-AUDIT-1.316.0.md`.

## Outcome by finding

| # | Finding | Outcome |
|---|---|---|
| D-1 | A third profit calculation with old rules | **Removed** — the route and its card |
| D-2 | The Dashboard's old company card opened copies of other tabs | **Fixed** — each figure opens its home tab; the copies are deleted |
| D-3 | Two package lists in two stores | **Fixed** — one list; the public page reads the packages the CEO marks |
| D-4 | One product, two prices | **Fixed** — the Inventory row says what the store charges |
| D-5 | Two ways to make an invoice paid | **Needs you** — a check in production, no code |
| D-6 | A role can be changed from three screens | **Kept** — the screens are not the same (see below) |
| D-7 | Two trial-balance calculations at one address | **Fixed** — one calculation |
| D-8 | Four calendars | **Kept**, as recommended |
| D-9 | Retired screens and modules still in the code | **Partly removed** — the rest is kept for a stated reason |

## What changed

### D-1 — one profit sum per book
- `GET /staff/finance/pnl` and `PnlCard` are removed.
- Profit is read in Finance → Reports (the cash book) and Accounting → Financial Reports (the ledger).

### D-2 — the company card draws no copy of another tab
- **Who sees this card:** Sales & Marketing, Marketing and HR Admin, on My Day. Its row of counters is drawn for HR Admin only. (The audit said all three saw the pop-ups; in fact only HR Admin did.)
- **Four figures now open their home tab** instead of a pop-up copy:

| Figure | Opens |
|---|---|
| Clients | Sales |
| Lives today | Tasks (the roster board) |
| Cash in − out | Finance |
| OT pending | Attendance → Exceptions & Approvals |

- A figure is a plain number for anyone who may not open that tab.
- The Active stokis figure is gone: Stokis is parked.
- `live-cards.tsx` is deleted. It held the second overtime decision screen and the second live-schedule editor. PUSH.bat removes the stale file from the PC.
- The tests that used to read the second overtime card now read the one screen that decides overtime.

### D-3 — one package list
- **The library (Sales → Packages) is the master.** The public Packages page shows the active packages the CEO or super admin marks "Public page".
  - It shows the package's own name and item names.
  - The price is a label the CEO types (for example "From RM 1,500 / month"), or the package total if the label is left empty.
  - Six packages at most. An archived package leaves the page by itself.
- **Before a package goes public, a dialog says what anyone will be able to read.**
- **The hand-typed rate card editor is removed**, with its two routes (`/staff/sales/packages`).
- **Nothing changes on the day this is deployed.** The saved card is kept, untouched, and the public page goes on showing it until the first package is marked. The Packages screen tells the CEO this.
- Once one package is marked, the earlier card never comes back, even if every package is later taken off.
- **No schema change.** Only a pointer list is saved (which package ids, in which order, and each label). No name or price is copied.
- Every change to the public page is in the audit history.

### D-4 — the store's price on the Inventory row
- The audit was partly wrong here: the Inventory row already showed the web price and let the CEO, COO and super admin edit it (your 1.235.0 decision). That editor is kept.
- **What was missing:** a discount set in ELFIA Store never showed in Inventory, so the row could show RM 14.00 while the store charged RM 10.50.
- **Now:** when the store charges something other than the list price, the row says "The store charges RM x, not this list price", worked out by the store's own rule, with a link to ELFIA Store.

### D-7 — one trial balance, one journal list
- The older handlers in `erp.ts` are removed. The ledger answers both addresses, with or without a filter.
- An account that is switched off still shows the entries it holds.

### D-9 — retired screen code
- **Removed:** `BusinessLinesCard`, `SalesHistoryCard`, `CashWatchPlaceholder`, `DeskBucketChips`, `ReportingLineCard`, `ActiveStokisSummary`, the analog clock.
- **Kept, with the reason:**
  - `access-review-card.tsx` — kept in 1.234.0 as the rollback path for "Who sees what".
  - The shared design-system pieces — the design-token guards hold them.
  - `NeedsActionCard` — the interface document still describes it.
  - The server modules of retired tabs (Hankei's, Sales Performance, Ads Fund, Purchasing, Threads) — kept dormant by your 1.183.0 decision.

## Not changed, and why

### D-6 — the role editors (kept)
- The two editors inside Users are not the same.
  - The row editor also sets the employment status and promotes a customer account to staff.
  - The account sheet changes the role only, and always asks for a reason.
- Removing either would remove a function, and this is an access screen. All three screens still use the one server route, so the rules and the audit are identical.

### D-5 — payment verification (needs you)
- No code. Please check in production that payment verification is switched on (Sales → Payments → settings).
- While it is off, Mark Paid still works beside the CEO verification route.

## Evidence (executed in the sandbox)
- **`tests/duplicates.mjs` (new, registered): 35 checks; all 11 deliberately broken versions were caught.** It runs the whole worker with every migration, by direct request through real sessions.
- **Tests re-pointed to the one overtime screen:** `qt-once` (20), `action-feedback` (30), `workforce-flow`, `tab-concept` (242).
- **Tests updated for the approved changes:** `accounting-v2` (60, adds the all-time trial balance and the switched-off account), `sales4` (26 checks, 21 mutations), `tab-zones` (109), `reporting-line`, `one-desk`, `dashboard-overview`.
- **Browser:** `duplicates.py` 30/30 (new), `sales4.py` 356/356, `accounting5.py` 37/37, `finance5.py` 64/64.
- **Full run (after the last change, together with 1.318.0): 204 of 204 guards passed.** TypeScript clean; lint 0 errors.

## Deploy notes
- No new migration. PUSH.bat still applies 0199–0203 from 1.315.0 and 1.316.0.
- **After deploying:**
  - The public Packages page is unchanged until you mark a package.
  - HR Admin's Dashboard figures open tabs instead of pop-ups.
  - Inventory rows with an ELFIA discount show the store's price.

## Rollback
- Re-run PUSH.bat from the 1.316.0 files.
- The earlier rate card was never touched, so the public page returns to it.
- The pointer list (`packages_public`) stays in the database, unused.
