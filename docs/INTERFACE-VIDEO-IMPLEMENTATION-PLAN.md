# Interface Video: Responsive ERP Implementation Plan

Reviewed: 16 September 2026
Source: `C:/Users/Alif/Desktop/Interface.mp4`
Baseline: package v1.163.0; commit 747ca15
Status: responsive shell and Dashboard/One Desk/Inventory slice implemented in v1.164.0; remaining phases below are not complete

## 1. What the reference shows

The supplied clip is four seconds long, at 768 by 576 pixels. Nine frames were
inspected at half-second intervals, including the ending at 3.95 seconds. It is
a desktop healthcare interface presentation. Its recording resolution is not
evidence of a responsive tablet layout. No mobile view or completed business
transaction is demonstrated; visible controls do not establish working behavior.

| Approximate time | Screen | Pattern suitable for this ERP |
|---|---|---|
| 0.0s | Dashboard | Compact metric strip, work list, activity chart and actionable queue |
| 0.5s | Patient Flow | Status columns with owner, age and a clear next action |
| 1.0s | Scheduling | Status tabs, relevant alert, main list and secondary summary |
| 1.5s | AI Chat | A separate workspace; AI functionality is not required for this redesign |
| 2.0s | Patients | Filtered work list with selected-record details on the right |
| 2.5s | Pharmacy & Labs | Review/release queue beside stock exceptions |
| 3.0s | Billing & Claims | Financial summary, aging, work list and priority actions |
| 3.5-3.95s | Reports | Period/context, measures and actionable drill-downs |

Adopt the labeled navigation, predictable hierarchy, compact data and contextual
details. Adapt them to staff, inventory, sales, claims and finance. Use neutral
white/light-gray surfaces, dark text, restrained existing brand accents and
semantic status colors. Keep secondary text readable rather than reproducing
the tiny labels, numerous shadows, decorative bubbles or AI glow in the clip.
No new AI feature, chart library or animation package is needed for this work.

## 2. Findings in the current project

1. `app/portal/page.tsx` actually mounts `SidebarNav`, the icon rail. The nearby
   comment describes a grouped sidebar, but `SideNav` is not mounted there.
   Reuse and adapt `components/layout/side-nav.tsx`; correct the stale comments.
2. `AppShell` displays the 56px rail, 264px context panel and 292px right panel
   at 768px on Dashboard. With 40px outer padding, only about 116px remains for
   the main column before its padding. Source confirms the sizing conflict;
   browser measurements must confirm the final remedy.
3. Shared surfaces and controls exist in `lib/ui-styles.ts`, but desktop/mobile
   variants still vary. `btnHdr` is 36px; interactive status chips have no 44px
   minimum touch target. Small display-only badges can remain compact.
4. The current shell clips horizontal overflow on phones. Clipping can hide
   inaccessible content; child widths and table scrolling must be tested directly.
5. Portal tab navigation primarily uses React state and session storage. Opening
   a selected record must gain deliberate URL/history handling for reload, sharing
   and browser/Android Back behavior without losing filters or drafts.
6. `public/manifest.json` already requests standalone mode and portrait orientation.
   `PwaRegister` registers `public/sw.js`. This supports a PWA foundation, but does
   not establish native WebView host capabilities or completed device verification.
7. The service worker bypasses API requests, while `lib/cached-api.ts` separately
   remembers data per user in local storage. Offline shell availability does not
   mean fresh records or successful offline approvals. Also review the service
   worker's generic portal-HTML fallback for missing non-HTML assets.
8. Existing issuers and signature versions support both legal entities. The ERP
   baseline identifies missing general company membership/ownership scope. A
   cosmetic company selector must not imply that data is already isolated.

## 3. Responsive layout contract

These are proposed breakpoints; validate them against actual available content
width and long EN/BM labels before fixing the final values.

| Element | Phone: below 768px | Tablet: 768-1199px | Desktop: 1200px and above |
|---|---|---|---|
| Navigation | Existing permitted destinations in bottom bar plus More | Compact rail; labeled navigation in drawer | Labeled grouped sidebar, about 224px, collapsible |
| Header | Module title, search, notifications; preferences/profile via menu | Compact title and toolbar | Title/context, search, profile and one relevant primary action |
| Summary metrics | Two columns; stack if labels need more space | Two to four columns as space allows | Compact metric strip |
| Main content | One vertical flow | Work list with optional overlay details | Wide work list; contextual detail only when selected |
| Detail view | Full-screen record screen with Back | Drawer overlay | 320-360px panel if the main list retains usable width |
| Filters | Search and filter trigger; advanced filters in sheet | Wrapping toolbar | Inline toolbar above result count and list |
| Tables | Readable record rows for routine work; contained scrolling for financial grids | Show key columns; controlled table scrolling | Full table with aligned values and row actions |
| Actions | At least 44px touch targets; important actions clear of keyboard/navigation | At least 44px on touch controls | Compact controls with visible keyboard focus |

Remove permanently duplicated Dashboard side panels from the medium-width shell.
Move useful content into the main flow or a deliberate drawer. Preserve Clock in
as an immediately reachable action, with One Desk directly below it.

Use one page heading, one toolbar and one content region per module. Prefer
unframed sections and row separators; reserve cards for independent summary
widgets or repeated records. Proposed operational card radius is 8px; do not
blindly change the global `card` token because admin/account also consume it.
Inventory expandable details remain inside the inventory section under a divider.

## 4. Map the patterns to real modules

| Module | Proposed work surface | Selected-record detail |
|---|---|---|
| Dashboard / One Desk | Clock actions, waiting work, overdue items, compact role-specific totals | Open the permitted record at its next available action |
| Inventory | Stock summary, searchable SKU list, low/out-of-stock filters, bridge freshness | Quantity, movement history and permitted adjustment action |
| Sales | Quotes/invoices/status tabs and existing filters; optional pipeline later | Issuer, client, lines, totals, history and permitted next step |
| Claims / Leave | My requests or review queue, status, owner, amount/dates and age | Evidence, check outcome, approval/signature history and decision |
| Finance / Purchasing | Exceptions, aging and outstanding records where existing data supports them | Evidence, company, amount, reconciliation/payment/release state |
| Reports | Company/period context with meaningful totals | Drill-down to the source records behind a figure |

Do not create demonstration metrics as production totals. Reuse the existing
API contracts; record missing measures as separate backend work. Optional status
boards follow proven server transitions and have an accessible list equivalent.

## 5. Companies and signing

Show the actual record issuer using `lib/issuers.ts`: A2Z CREATIVE MARKETING or
AZ ONE OFFICIAL. Retain each document's issuer and historical signature version.
Use one visual language for both companies with explicit text identification.

A global company switcher is a later functional phase: establish membership,
record ownership, server authorization and report scope first. Then include company
scope in request/cache keys, filters and remembered views. Consolidated views must
be explicitly labeled and retain company identification in each record.

For workflows that require a signature, propose this visible sequence:

`Draft -> Submitted -> Checked -> Awaiting signature -> Signed -> Released`

Map this sequence to each workflow's existing states rather than silently renaming
backend statuses. The server must validate the checker, authorized signer, company,
current record revision and allowed transition. A changed checked document requires
rechecking. Record signing events with signer, time, revision and evidence; a stored
signature image alone is insufficient for the proposed workflow.

On desktop, review evidence and signing context in the detail panel. On phones,
use a dedicated review/confirmation screen with a reachable final action. Show a
signature as completed only after server confirmation; prevent duplicate submissions
and explain revision conflicts. No optimistic offline sign/approve/pay/release.

## 6. PWA and WebView behavior

Keep one responsive Next.js application, with shared business logic across browser,
installed PWA and an embedded WebView. Host integrations are a separate capability
layer; no native wrapper configuration was identified in this review.

- Retain safe-area spacing at both screen edges; test it in installed mode.
- Make the virtual keyboard leave focused inputs and final actions reachable.
- Coordinate Back so an open sheet/detail closes before navigating away from work;
  protect unsaved edits and preserve the list's filters, selection and scroll.
- Verify login/session expiry, external authentication, file upload, camera capture,
  geolocation for attendance, PDF viewing/download and external links per target host.
- Detect capabilities for push, sharing and file handling; provide explicit browser
  alternatives where an embedded host cannot perform an action.
- Show offline/stale/failed states honestly and refresh after foreground/resume.
  Offer an application update without discarding unsaved work.
- Scope any offline asset changes deliberately; do not cache authenticated API
  responses through the service worker or substitute HTML for unavailable scripts.
- Revisit the portrait manifest preference for tablet workflows after landscape QA.

## 7. Implementation sequence and files

| Phase | Work | Main files | Exit evidence |
|---|---|---|---|
| 1. Shell and controls | Labeled desktop navigation, tablet collapse, modest surfaces, phone targets | `components/layout/app-shell.tsx`, `side-nav.tsx`, `app/portal/page.tsx`, `lib/ui-styles.ts`, `styles/globals.css` | Desktop/tablet/phone screenshots, all allowed destinations reachable |
| 2. Daily-work pilot | Dashboard, One Desk and Inventory; finish error/loading/stale and selected-detail states | `components/portal/dashboard.tsx`, `one-desk.tsx`, `company-monitor.tsx`, existing inventory panel | Realistic fixtures, long EN/BM content, functional detail and retry checks |
| 3. Work-list pattern | Sales and Claims list/detail, filter state and Back handling | Existing sales/claims modules; shared detail/filter components only where reuse is proven | Refresh/Back preserve context; permissions and permitted actions unchanged |
| 4. Entity/signing dependencies | Membership/ownership decisions, scoped endpoints/cache, verified signing events | Issuer/signature modules, worker routes, migrations, cached API | Both entities tested, revision conflicts and unauthorized transitions rejected |
| 5. Rollout and device QA | People/Finance/admin/account adoption and PWA/WebView behavior | Affected modules, manifest, service worker, registration/update UI | Browser matrix plus actual target device/host evidence |

Keep each phase independently reviewable. Phase 4 is backend workflow work and is
not a prerequisite for the first layout pilot; defer dependent company-switching
and signing claims until its server requirements are implemented.

Use the existing guard suite, typecheck and production build for affected changes.
Before release, inspect rendered screenshots at 360/390/430, 768/1024 and
1440/1920px, with keyboard and light/dark modes. Include long BM labels, no data,
failed requests, expired sessions, large amounts, expanded stock detail and a
selected claim. Verify no clipped content, header collisions or hidden final row.

Test installed PWA on Android and iOS and the actual intended WebView host. Browser
emulation is useful layout evidence but does not prove device permissions, downloads,
safe-area behavior or native Back integration. Store evidence and unresolved items
with the release. Publish implemented, validated slices through `PUSH.bat`.

## 8. Review status

The reference review is complete. The approved first implementation slice now includes:

- Labeled desktop sidebar, default collapsed tablet rail, unchanged permission-filtered destinations.
- Neutral full-width workspace, scoped 8px shared card/panel radius, one module heading.
- Tablet toolbar wrapping, mobile header simplification, keyboard-accessible More sheet.
- Compact Dashboard metrics and expandable calendar/team context; readable One Desk rows.
- Touch-sized shared phone controls and Inventory filters; full-row phone search.
- Reusable Inventory record detail: desktop side sheet, full-screen phone dialog,
  native focus containment, Escape, same-page Back handling and list-state retention.
- Skeleton aligned with the new shell. Existing service worker, caching, signatures,
  API mutation paths, issuer definitions and database schema are unchanged.

Browser evidence uses isolated mocked API fixtures, not production records:
English/light at 360, 390, 430, 768, 1024, 1440 and 1920px; Malay/dark at 390,
768 and 1440px. Checks cover overflow, readable tablet titles with expanded
navigation, Inventory search width, mobile targets, stock expansion, More Escape,
detail Back and page errors. Screenshots were inspected on phone, tablet and desktop.
Run `scratch/interface-responsive.cjs` against a local dev server with
`PLAYWRIGHT_MODULE` pointing to Playwright and `PREVIEW_URL` set to its URL.
`REVIEW_WIDTHS`, `REVIEW_LANG=ms`, `REVIEW_DARK=1`, and `REVIEW_OUTPUT` select the matrix
and evidence location. The fixture blocks service workers and intercepts API calls.

This completes the shell foundation and the visual/detail portion of the pilot,
not every phase-2 reliability gate. Error/expired-session walkthroughs, all-role
acceptance, Sales/Claims detail rollout, deep-link/refresh detail persistence,
company isolation and verified signing remain open. Installed Android/iOS PWA and
the actual native WebView host still require device testing, including native Back,
camera/files/downloads, keyboard, safe areas and update/offline transitions.
