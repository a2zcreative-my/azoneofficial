# Work-first card ordering

Date: 16 September 2026
Baseline: deployed v1.164.0
Status: six-tab pilot accepted by the user; remaining active tabs reviewed and work-first rollout implemented locally. Local automated verification passed. PUSH.bat is not authorized by this layout approval.

## Contract

Keep the sidebar registry, role permissions, company identity and signature behavior
unchanged. Reorder existing cards/sections rather than invent new summaries or duplicate
records. Use one DOM order for desktop, tablet and phone: brief status, actionable work,
records/actions, reporting/history, then setup. Refresh must not reshuffle cards.

Keep forms mounted when their local view is hidden so unsaved drafts survive view
switching. Reordering does not introduce persistence across different portal tabs.
Expanded stock items stay inside the stock-status card. Actual native WebView/PWA
device acceptance remains distinct from browser layout checks.

## Implemented pilot

| Tab | New order | Preserved behavior |
|---|---|---|
| Dashboard | Quick actions; One Desk/alerts; upcoming events/schedule; personal metrics; company overview; surrounding work/news/calendar | Existing role visibility, clock actions, personal/company calculations |
| Ecommerce | Compact monthly revenue; orders and fulfilment; map/leaderboard; targets/history/analytics; connection | Full revenue breakdown remains expandable; same revenue/analytics gates and totals |
| Inventory | Stock status; inventory list/actions; recording; movement history; bridge diagnostics | Bridge problems retain a visible top warning/link; stock expansion, filters and record details unchanged |
| Sales | Document workspace; customers; sales map; economics/packages | Documents is the default work view; Clients is the default customer view; creation/editing still accessible; both quotation shortcuts explicitly open Create |
| Attendance | Monitor/records; verification; OT decisions; roster; administration | Existing report, scheduling, edit and approval gates remain intact |
| Users | User accounts; access review; tab permissions; geofence | Access configuration remains limited to its original roles |

Sales editing now selects its form and scrolls that section into view rather than
scrolling the outer window to the old page top. Repeating the quotation command from
global search opens the form without remounting it. A pre-existing SVG inside a native
select option was removed because option labels must remain text.
The search loading placeholder also uses a div rather than an invalid paragraph
containing another div, removing a hydration warning seen in browser verification.

## Approved rollout

The user reviewed and approved the pilot, then approved extending it. Fifteen of the
remaining tabs needed changes. Eight already followed the intended section order:
Enquiries, Threads, ELFIA Store, Web Orders, ELFIA Traffic, Staff Details, Cards and
Profile. Their layout is retained, not rewritten just to create a diff.

| Tab | Implemented or retained sequence |
|---|---|
| Enquiries | Filters/status; unanswered work; remaining enquiries; selected details |
| Sales Performance | Filters/KPIs; reviewable evidence/activity; registers; scores/trends; configuration |
| Assets | Status; asset register; selected actions; registration/editing |
| Hotels | Filters; hotel/contact work list; follow-up activity; geographic reporting |
| Threads | Existing study topics/search; results/findings; authorized connection settings |
| ELFIA Store | Shop status; products; shopfront content; settings |
| Web Orders | Status filters; actionable orders; selected payment/delivery details |
| ELFIA Traffic | Period/totals; map/location detail; accuracy; consented marketing reach |
| HR | Task reports; calendar/holidays; payroll summary; birthdays |
| Tasks | Assigned/open work; details/actions; team progress; completed work |
| Announcements (News) | Unacknowledged announcements; authorized publishing; expandable acknowledged archive |
| Staff Details | Search/filter; directory; selected record; organization view |
| Leave | Balance/application action; pending decisions; history |
| Claims | Status/submission action; pending decisions; evidence/details; history |
| Payroll | Period/release status; processing/review; payment/release; salary setup |
| Finance | Cash Flow; payments due/expenses; P&L; completed-payment reporting |
| Reconciliation | Pull period; summary; records and row actions; manual entry with channel |
| Commission | Summary; entries/decisions; calculation form; rates |
| Ads Fund | Allocation/balance; spending; allocation/spend forms |
| Purchasing | Open-order summary; purchase orders; creation; suppliers |
| Accounting | Balance status; trial balance; adjustment journal form |
| Cards | Signed-in officer; other permitted officers; editing/share controls |
| Profile | Personal details; payslip; security; privacy |

Stokis and Content remain parked. Do not enable modules or change server permissions
as a side effect of this work. Where a card owns several sections, reorganize within
that component rather than breaking its form/list relationship or duplicating state.

### Interaction details

- Task records are split into active work and an expandable completed archive, with
  creation and authorized team progress between them. Existing task actions remain.
- The announcement archive uses the existing acknowledgment flag, not a new pinning
  or retention policy. Acknowledged posts remain readable.
- Leave decisions precede personal request history; hourly-host exclusions, approval
  stages, replacement-credit review and entitlement permissions are unchanged.
- Claim submission remains reachable from a top link. Pending decisions precede the
  claim form; editing scrolls to that form and retains its existing signature flow.
- Asset editing, supplier/rate toggles and salary setup target their relocated
  sections. Hotel state selection is also available beside directory search.
- Payroll keeps calculation details expandable, review before save/payment/release,
  and base salaries and bank setup below. No payroll formula or release rule changed.
- Reconciliation's period still controls the existing pull/manual-entry context; it
  is not a new filter on the register. No extra backend filtering was introduced.
- HR administration and Finance reporting use optional layout slots so their parent
  permission checks and component ownership stay intact.
- Repeated quotation checks exposed a search-opening race: a passive effect could
  clear the first typed query. Reset/focus now runs before paint in a layout effect;
  search matching, permission gating and API requests are unchanged.

## Verification and acceptance

The existing guards now enforce the approved order instead of historical map-first,
metrics-first or two-cell stock/bridge arrangements. Permission, arithmetic, document
fields, lazy loading and mounted-form checks remain in place.

`scratch/interface-responsive.cjs` supports `REVIEW_PILOT=1` to exercise all six tabs.
It uses intercepted API fixtures, never live business records. Checks include DOM and
rendered ordering, overflow, Inventory Back/Escape, Sales draft retention, quotation
shortcuts, expanded tablet navigation and phone controls. `REVIEW_ROLE=ceo` checks the
management-only Users cards; `REVIEW_LANG=ms` and `REVIEW_DARK=1` select Malay/dark.
`REVIEW_WIDTHS` and `REVIEW_OUTPUT` select viewports and screenshot output.

Pilot acceptance is complete. A successful local build is not publication. Review
the expanded rollout separately before publishing; PUSH.bat remains a separate step.

## Pilot verification results

- `npm run ci`: passed type checking, all 80 guard suites and the production build.
  Existing hook-dependency, image and unused-disable lint warnings remain; this is
  not a claim of a warning-free build.
- English/light fixture checks passed at 360, 390, 430, 768, 1024, 1440 and 1920px.
- Malay/dark fixture checks passed at 390, 768 and 1440px after the hydration fixes.
- Final CEO-role checks passed at 390 and 1440px after the Sales scroll adjustment,
  including all six tabs, draft retention and repeated quotation commands. No
  captured page/runtime/hydration errors or horizontal document overflow.
- `git diff --check`: passed. No backend records were modified by these checks.

Screenshots and results are in the local temporary folders `erp-card-order-review`,
`erp-card-order-bm`, `erp-card-order-ceo` and `erp-card-order-final`.
The final set is at `C:/Users/Alif/AppData/Local/Temp/erp-card-order-final`.
Fixtures include empty record lists, so populated production data and actual installed
PWA/native WebView devices still require acceptance. The document preview retains its
existing script-blocking sandbox; its browser console notices are expected.

## Rollout verification

The layout guard now checks the expanded order (87 checks). The hourly-leave guard
still enforces exclusion of ineligible staff, with its obsolete two-column wrapper
expectation updated. Sales Performance now checks closing before reporting.
`REVIEW_ROLLOUT=1` extends the browser fixture to the 15 changed tabs, alongside the
six pilot tabs. Active/completed tasks and current/acknowledged announcements use
populated fixtures; asset editing also uses a populated record, while other record
lists include empty states. No live writes occur.

- Final `npm run ci`: passed TypeScript, all 80 guard suites and production build.
  Existing hook-dependency, image and unused-disable lint warnings remain.
- All 21 changed tabs passed CEO-role browser checks in English/light at 390 and
  1440px and Malay/dark at 390, 768 and 1440px. No captured runtime/hydration errors
  or horizontal document overflow. Dense tables retain horizontal scrolling.
- Verified active/archive ordering, task draft retention, relocated asset editing,
  supplier/rate/salary setup access, and repeated quotation shortcuts after the
  search-opening fix. Expected document sandbox notices remain unchanged.
- `git diff --check`: passed. No backend, sidebar registry, PUSH.bat or package
  version changes; nothing committed, pushed or deployed.

Screenshot index: `C:/Users/Alif/AppData/Local/Temp/erp-card-order-rollout/REVIEW.md`.
English and Malay results are in `erp-card-order-rollout/results.json` and
`erp-card-order-rollout-bm/results.json` beneath that temporary directory's parent.
The final frontend preview is `http://127.0.0.1:3211` (3210 was occupied).
Installed PWA/native WebView and populated production records still need acceptance.

Local preview limitation: `next dev` serves this frontend, but `next.config.ts`
defines no API proxy and the local `/api/v1/auth/me` route returns 404. The login
screen is not evidence of a working local backend. Use the fixture screenshots
for this visual review, or the team's separately configured backend environment.
This layout rollout does not deploy or reconfigure authentication/API services.
