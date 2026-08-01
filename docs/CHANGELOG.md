# Changelog

All notable changes to the AZ ONE OFFICIAL platform.

## [1.4.67] — 2026-08-01 — Postage from TikTok is automatic; manual form is for other channels

### Clarified + improved
- **Correct: TikTok postage should not be typed in — and it isn't.** TikTok orders arrive automatically (webhook + the 30-minute sync) as TT- records with their items and stock movement. The manual "Postage tracking" form now says what it's actually for: **non-TikTok channels** — Shopee, WhatsApp/direct sales, replacements
- **TikTok tracking numbers are now captured automatically** wherever TikTok includes them in the order data — no more typing those either
- **Every sync pass refreshes existing TikTok orders**: shipping status progresses (preparing → shipped → delivered) and a missing tracking number backfills, with stock untouched (it moved on first import; returns stay final)

### Deploy
- `npx wrangler deploy` → rebuild site


## [1.4.66] — 2026-08-01 — Automatic TikTok inventory sync + per-order quantities

### Added — automatic sync
- **The worker now syncs TikTok orders automatically every 30 minutes** (Cloudflare cron): new orders become TT- postage records and deduct stock by SKU without anyone pressing anything. The manual Sync button remains for on-demand pulls; both run the identical logic, and cron runs audit as source: tiktok_cron. Until the TikTok setup completes, the schedule is a harmless no-op

### Added — see exactly what shipped
- **Each TikTok order in the Inventory tab now lists its items and quantities** (e.g. "2× ELFIA Satin Square, 1× ELFIA Bawal") — the shipped goods behind every stock deduction, so the available inventory is verifiable per order
- Orders with **no stock movement** say so explicitly; unmatched SKUs in notes now include the ordered quantity ("2× TT-SKU-123"), so even unmapped items show how many units the order wanted

### Deploy
- `npx wrangler deploy` (registers the cron trigger too) → rebuild site


## [1.4.65] — 2026-08-01 — Inventory opened to six roles; TikTok orders move into Inventory

### Changed
- **The Inventory tab is now visible and editable by CEO, COO, CCO, sales_marketing, marketing, and hr_admin** (admin tier as backstop) — items, stock adjustments, postage records and materials. The API enforces the same list, so it's real access, not just a visible tab
- **TikTok Orders moved from Sales into Inventory** — TikTok orders move stock, so the tracker now sits beside the stock it moves: status line, Sync from TikTok, and the TT- order list all live at the top of the Inventory tab. A successful Sync refreshes the stock list beneath it immediately
- Sync permission aligned with the same six roles

### Deploy
- `npx wrangler deploy` (permission gates) → rebuild site


## [1.4.64] — 2026-08-01 — More sheet: reliable close + friendlier touch (and an /admin build fix)

### Fixed
- **"Close not function" — real iOS bug, now fixed.** iPhone Safari doesn't fire taps on plain backdrop layers, so tapping the dimmed area never closed the sheet. The backdrop is now a genuine button (iOS honours it), and the sheet also gains an explicit **✕ Close button** and a tappable drag-handle — three reliable ways out, plus selecting any section still closes it
- **/admin build error introduced in v1.4.55**: the mobile menu referenced state that was never declared (my scripting slip — the declaration step never wrote to disk). If your `pnpm build` failed recently, this was why. Declared and verified
- **Background no longer scrolls** while the sheet is open — it behaves like a native menu, not a floating layer

### Changed — touch ergonomics
- Bottom-bar buttons: taller (56 px minimum), larger labels, centred — comfortably thumb-sized on all three surfaces (/portal, /admin, /account)
- Sheet grid buttons: taller with more spacing between them

### Deploy
- Rebuild the site (`pnpm build`) — this build should succeed even if the previous one errored on /admin


## [1.4.63] — 2026-08-01 — Badge: DEPARTMENT row added

### Changed
- **DEPARTMENT : row added directly below POSITION** on the badge, in the same aligned three-column style. Rows now: NAME / EMP. NO / NRIC / DATE JOIN / DATE ISSUED / POSITION / DEPARTMENT

### Deploy
- Rebuild the site only


## [1.4.62] — 2026-08-01 — Badge final polish: aligned columns + small tagline

### Changed
- **Every row now aligns on three true columns** — label, colon, value — so all colons sit in one vertical line and a wrapped value's second line starts exactly under its first, never under the colon
- **Small gold LIVE · CONNECT · GROW** returns beneath the logo, subtle and letter-spaced as requested
- Vertical rhythm evened out (row padding, photo spacing) for the organized, professional finish

### Deploy
- Rebuild the site only


## [1.4.61] — 2026-08-01 — TikTok shop lookup tries both endpoint families

### Changed
- **The shop-cipher lookup now tries both of TikTok's shops endpoints** (`/authorization/202309/shops`, then `/seller/202309/shops`) — they live under different scope families, so whichever scope the app has active can supply the identifier. Each attempt's result is reported, so a failure names both causes precisely
- Note on Partner Center's Manage API search: filtering by package name for "authorization" shows 0 because no scope is *named* that — clear the search to see all 25 scopes and look for the shop/seller-info one by browsing (or search "shop" / "seller")

### Deploy
- `npx wrangler deploy` → press **Sync from TikTok** again


## [1.4.60] — 2026-08-01 — Badge in the classic ID layout (label rows); footer split per spec

### Changed
- **Badge follows the classic Malaysian staff-ID layout** (per the provided sample): logo header, centred photo, then bold left-aligned label rows — **NAME : / EMP. NO : / NRIC : / DATE JOIN : / DATE ISSUED : / POSITION :**
- **Footer split exactly as specified**: office location (Setia Tropika, Johor Bahru, Malaysia) bottom-left, **company registration (SSM 202603168673 / JM1046169-H) bottom-right**
- Overlap-proof structure retained from v1.4.58 (flex column, footer in flow) — long names wrap within their row and push the footer down, never under it
- Preview remains the sandboxed iframe of the exact print document

### Deploy
- Rebuild the site only


## [1.4.59] — 2026-08-01 — TikTok shop resolution: real diagnostics + both response shapes

### Fixed
- **"Could not resolve the authorized shop" was hiding TikTok's actual answer.** The shop-cipher lookup now reports exactly what TikTok said — an API code + message (e.g. a scope/permission refusal), or "authorized shop list came back empty" (meaning the Seller authorization never completed for the shop). No more guessing
- **Both authorized-shops response shapes are accepted** (`shops[].cipher` and `shop_list[].shop_cipher`) — TikTok's API versions differ on this, and if the shape was the issue, this release fixes it outright
- The authorization audit entry now records the cipher-resolution outcome for later inspection

### Deploy
- `npx wrangler deploy` → press **Sync from TikTok** again. Either it works, or the message now names the exact TikTok-side cause


## [1.4.58] — 2026-08-01 — Badge layout made overlap-proof; gold line + tagline removed

### Fixed
- **The footer could still collide with the details grid** (visible over the NRIC/Joined row): the footer was absolutely positioned, so growing content ran underneath it. The card is now a **flex column and the footer is part of the flow, pinned to the bottom by spacing** — content can only push it down within the card, never overlap it. This holds for any name/position length, structurally
- **Gold divider line and LIVE · CONNECT · GROW removed** per instruction — the card reads logo → photo → name → role → details → footer, clean and professional
- Space freed by the removals goes to breathing room: slightly larger photo (22×26 mm), name, and grid spacing

### Deploy
- Rebuild the site only


## [1.4.57] — 2026-08-01 — Fix: TikTok "Missing identifier / shop_cipher" on Sync

### Fixed
- **The authorization callback stored the access token but never the shop identifier.** TikTok's token response doesn't include shop_cipher — it must be fetched separately via **Get Authorized Shops** — so every order API call failed with "Missing identifier. The 'shop_cipher' query parameter is required". (Your "Connected" status was genuine: authorization succeeded; only the shop identifier was missing)
- The callback now resolves and stores **shop_id + shop_cipher** immediately after the token, and **Sync self-heals**: if the stored token lacks a cipher (your current state), it fetches and stores one before calling the orders API — **no re-authorization needed**
- If the cipher can't be resolved, Sync now says exactly that ("ensure the Seller authorization completed and the order/shop scopes are active") instead of a downstream API error

### Deploy
- `npx wrangler deploy` → press **Sync from TikTok** once more. No migration, no rebuild required


## [1.4.56] — 2026-08-01 — Badge restored to the clean brand design (v1.4.53 layout reverted)

### Fixed
- **v1.4.53's decorative redesign is reverted** — in practice the corner sweep collided with long values (a two-line position pushed Department/Phone into the artwork and under the footer), and the preview's stylesheet leaked into the page. Apologies for that regression; two structural fixes make sure neither can recur:
- **Back to the clean brand-profile design**: white card, navy border and details, gold divider line + gold LIVE · CONNECT · GROW tagline under the logo — the look that worked — while keeping **NRIC and Joined on** in the details grid (with Employee ID, Position, Department, Phone) and the issue date in the footer
- **The preview is now a sandboxed iframe** rendering the exact print document: badge CSS can no longer leak into the admin page, page styles can no longer distort the badge, and preview vs print are one document by construction
- Field text sizes tuned so even long positions/names wrap within their cell without invading the footer

### Deploy
- Rebuild the site only


## [1.4.55] — 2026-08-01 — App view on all three surfaces; mobile fit sweep

### Added — /admin and /account now match /portal's app view (phones only)
- **/admin**: sticky app bar showing the current section title, bottom tab bar with the first four sections + **More** sheet holding the rest (respecting role visibility of Users/Staff/Audit), screen transitions, safe-area padding, bottom clearance. Desktop unchanged
- **/account** (customers): sticky app bar, two-tab bottom bar (Account · My Enquiries), screen transitions, bottom clearance
- /portal already had all of this (v1.4.49–50) — the three surfaces now feel consistent

### Fixed — mobile fit
- **The public packages comparison table couldn't scroll on phones** (overflow was hidden, cutting columns off) — now scrolls horizontally
- **WhatsApp button on /account lifts above the new bottom bar** on phones instead of overlapping it (desktop position unchanged; still absent from /portal and /admin per v1.4.52)
- **The corner back-to-top button is hidden on all three app-view surfaces** — the bottom bar owns that corner, and tab taps already return to top
- Audited every data table across portal/admin: all already scroll horizontally in place, so wide tables (payroll, attendance, audit) pan within their card instead of breaking the screen

### Deploy
- Rebuild the site only. No worker change, no migration


## [1.4.54] — 2026-08-01 — Date audit: DD-MM-YYYY + Malaysia time everywhere

### Fixed — every display date now DD-MM-YYYY, every timestamp Malaysia time
Audit of every file found and fixed these violations:
- **HR Staff birthdays** rendered raw ISO (1997-02-09) → now 09-02-1997
- **Overview's latest ops report date** rendered raw ISO → DMY
- **/admin enquiries and audit lists** rendered raw UTC database timestamps → DD-MM-YYYY HH:mm in MYT
- **/admin audit panel** used slashes (01/08/2026) → dashes
- **Attendance PDF footer** ("Generated …") used the browser's locale and timezone → MYT DMY
- **/admin staff panel leave ranges** rendered raw ISO → DMY
- **Blog dates** long-form → DD-MM-YYYY
- **Portal notification timestamps** showed day + short month without year → DD-MM-YYYY HH:mm MYT

### Fixed — "today" and "this month" now computed in Malaysia time
Defaults previously used UTC, so between **midnight and 8 AM MYT** the portal thought it was still *yesterday* — on the 1st of a month, payroll/attendance/report defaults pointed at the **previous month**. All defaults (payroll months ×3, attendance month, HR pay month, task report dates ×2) now compute in MYT. Server-side attendance/payslip queries already used MYT (+8) — verified unchanged

### Known boundary
- Native date-picker *inputs* render per the phone/browser locale (a browser behaviour that can't be styled); the values stored and every date the system itself displays are consistent DMY/MYT

### Deploy
- Rebuild the site only. No worker change, no migration


## [1.4.53] — 2026-08-01 — Badge redesigned to the brand card, with NRIC + join date

### Changed
- **Badge now follows the brand-card design**: cream ivory base, the navy sweep with gold edging across the bottom corner, a thin gold arc top-right, and the gold **LIVE · CONNECT · GROW** tagline under the logo — matching the provided artwork
- **Text is never interrupted**: the decorative sweep occupies only the bottom 13 mm as a background layer; all details sit in a content layer above it, and the footer line stops at 14 mm — so the curves stay purely decorative at any content length
- **NRIC and Joined on are now on the badge**, joining Employee ID, Position, Department and Phone in the details grid; the issue date moved to the footer line
- **Preview = print, guaranteed**: the on-screen badge preview now renders the exact same markup and CSS as the print version, so what you approve is what prints — individually or 9-per-A4

### Deploy
- Rebuild the site only. Fill Joined on + IC in Staff Details for each person so the badge shows them


## [1.4.52] — 2026-08-01 — WhatsApp button off the internal surfaces

### Changed
- **The floating WhatsApp button no longer appears on /portal or /admin** — those are internal staff surfaces where a customer-contact button has no business. It remains on the public site and on **/account** (customers), exactly as specified. Implemented path-aware inside the button itself, so any page added later inherits the right behaviour automatically

### Deploy
- Rebuild the site only. No worker change, no migration


## [1.4.51] — 2026-08-01 — IC number (NRIC) across staff record, payslip, and badge

### Added (migration 0022)
- **Staff record**: IC number (NRIC) field, right beside the full name, in both the record grid and the add-staff form. Amendment-lock applies like every identity field
- **Payslip**: an **I/C #** row in the header block (below the employee name), matching the standard Malaysian payslip layout
- **Badge**: IC No. joins the badge grid (with the issue date moving up beside it), on both individual and multi-badge A4 printing

### Deploy
- `npx wrangler d1 migrations apply azoneofficial --remote` (**0022**) → `npx wrangler deploy` → rebuild. Then fill each staff member's IC in Staff Details


## [1.4.50] — 2026-08-01 — Mobile view now reads as an app, nothing to install

### Changed (phones only; desktop untouched)
- **App-style top bar**: on phones the header is a compact sticky bar showing the current screen's title (Dashboard, Attendance, …) with the bell and sign-out beside it — like a native app's title bar, with background blur as content scrolls under it. The desktop "Welcome" header is unchanged
- **Screen transitions**: switching tabs plays a quick slide-up fade (0.18s), the way app screens change — honours reduced-motion settings
- **Native touch feel**: no grey tap-highlight flash, no rubber-band overscroll, no long-press callout — small things that make a web page feel like a web page, now gone
- Together with v1.4.49's **bottom tab bar + More sheet**, the mobile portal now looks and behaves like an app view in the browser itself — no installation involved

### Deploy
- Rebuild the site only. No worker change, no migration


## [1.4.49] — 2026-08-01 — Mobile-app experience: installable PWA + bottom navigation

### Added — install it like an app
- **The site is now an installable PWA**: manifest (AZ ONE, navy theme, portrait, opens straight into /portal), 192/512 app icons generated from the logo on the navy brand background, Apple web-app meta (black-translucent status bar), and a minimal network-first service worker. On a phone: **Chrome/Android → menu → Add to Home Screen**; **iPhone Safari → Share → Add to Home Screen**. It then launches fullscreen from its own icon — no browser bar — which is the native-app feel
- The service worker is deliberately network-first: live data (attendance, payroll, stock) is never served stale; it exists to enable installation and keep the shell reachable

### Added — app-style bottom navigation (phones only)
- **A fixed bottom tab bar** replaces the pill row on small screens: this person's first four tabs one thumb-tap away, a gold indicator on the active tab, safe-area padding for gesture-bar phones
- **"More" opens a bottom sheet** with the rest of their tabs in a grid — so every role still reaches everything, just organised the way mobile apps do it
- Desktop (md and up) keeps the pill tabs exactly as before; content gets bottom clearance on mobile so nothing hides behind the bar

### Deploy
- Rebuild the site only (`pnpm build` → push → hard refresh). No worker change, no migration. After deploying, staff must visit the site once and use Add to Home Screen to get the app icon


## [1.4.48] — 2026-08-01 — Customer demotion restored; TikTok sync + status; API signing fixed

### Fixed (security-relevant)
- **The /admin Users role dropdown had no "customer" option** — so a personal-email account holding a staff role could not be demoted through the UI at all, exactly the gap that alarmed you. "customer" is now in the dropdown; combined with the v1.4.42 domain policy this closes the loop: personal emails can be pushed down to customer, and can never be pushed back up. (Reassurance on the other half: self-registration has only ever created customer accounts — nobody registers into a staff role)
- **TikTok API calls are now signed.** TikTok requires every API request to carry a timestamp and an HMAC-SHA256 `sign` parameter; v1.4.44's order-detail call omitted this and would have been rejected. All calls now go through a signing helper

### Added — why "No TikTok orders yet" and the fix for it
- Webhooks only push orders **created after** the subscription is live — and the app is still Draft with 0 active scopes, so nothing has ever been able to flow. Two additions close the gap:
- **Integration status line** on the Sales → TikTok Orders card: shows not-configured / not-authorized (with what to do) / connected + last webhook (and flags a failed signature explicitly)
- **"Sync from TikTok" button** (super_admin/admin/ceo/coo/sales_marketing): pulls the **last 30 days of orders** via Get Order List once the app is live — creates TT- records, deducts stock by SKU (all-or-nothing, race-guarded, audited as tiktok_sync), skips orders already imported, and reports "Imported N (M already in)" plus any unmatched SKUs

### Deploy
- `npx wrangler deploy` → rebuild site. Migrations 0020+0021 from earlier releases still required if pending


## [1.4.47] — 2026-08-01 — Payslip header proper fields + confidentiality marking

### Changed
- **Payslip header restructured into distinct labelled rows**: EMP'EE # · EMP'EE NAME · DEPT. · SECTION · STATUS · PERIOD · **BANK NAME** · **BANK ACCOUNT** — each its own field instead of the combined "#/NAME" and "DEPT./SECTION" pairs. Department maps to DEPT., position to SECTION
- **Confidentiality per Malaysian practice**: a red **SULIT / PRIVATE & CONFIDENTIAL** mark at the top of the slip, and a footer statement citing issuance under the Employment Act 1955 and personal-data protection under the PDPA 2010, prohibiting disclosure without written consent

### Notes on the sample printed
- STATUS showed ACTIVE because migration **0021** wasn't applied yet — after it, the value reads PERMANENT (or contract/part time as set)
- BANK showed "—" because the record's bank fields were empty — fill Bank + account in Staff Details and they print

### Deploy
- Rebuild the site only (print template change). Migrations 0020/0021 still required from the previous releases if pending


## [1.4.46] — 2026-08-01 — Fix: staff record saves failed on employment status; bank fields on creation

### Fixed (the "Something went wrong" on Save)
- **Root cause**: v1.4.43 introduced permanent / contract / part_time in the UI, but the users table still enforced the original database CHECK ('active','probation','resigned','terminated'). Every save carrying a new status value was rejected by the database itself, surfacing as a generic 500. Migration **0021** rebuilds the constraint to accept both sets, defaults new staff to 'permanent', and maps existing legacy 'active' rows to 'permanent' (probation/resigned/terminated untouched)
- The staff PATCH now **validates employment_status up front** and returns a clear 400 naming the allowed values — a bad value can never again surface as "Something went wrong"

### Added
- **Add-staff form gains Bank (Malaysian bank dropdown, Maybank first) and Bank account no.** — captured at creation instead of requiring a second edit; the create endpoint stores both

### Deploy
- `npx wrangler d1 migrations apply azoneofficial --remote` (**0021** — required, this is the fix) → `npx wrangler deploy` → rebuild site


## [1.4.45] — 2026-08-01 — TikTok app key committed to config

### Changed
- **worker/wrangler.toml now carries `TIKTOK_APP_KEY = "6kraboau1veif"`** (Partner Center service ID 7668934538403645205). The app key is a public identifier — it travels in the query string of every TikTok API call — so it belongs in versioned config alongside GOOGLE_CLIENT_ID. Only `TIKTOK_APP_SECRET` is a secret and it is never committed
- Deploy notes corrected accordingly: one secret to set, not two

### Still required in Partner Center before orders flow
- **API scopes: 25 inactive, 0 active.** The app cannot call any endpoint until the order and product scopes are applied for and approved — order read (Get Order List / Get Order Detail) drives the SKU lookup, product/inventory read supports reconciliation. Customer Service scope is flagged as sensitive personal data and is **not** needed for stock movement — leave it off
- Publish the app, then authorize the shop through the redirect URL

### Deploy
- `npx wrangler deploy` (picks up the new var). No migration


## [1.4.44] — 2026-08-01 — TikTok integration made compatible with TikTok's actual protocol

### Fixed — the v1.4.40 webhook could not have worked with TikTok directly
- **TikTok signs its own webhooks; there is no custom header to configure.** The previous endpoint required `x-webhook-secret`, which TikTok never sends — every real TikTok call would have been rejected. The endpoint now verifies TikTok's **tiktok-signature** header (HMAC-SHA256 with the app secret), checking both signing conventions in use across TikTok's platforms, with a 5-minute timestamp window against replay. The relay path (`x-webhook-secret`, for Make/Zapier) still works
- **Order webhooks carry only order_id + status — not the line items.** Stock could never have been deducted from the webhook alone. The worker now calls **Get Order Detail** with the stored seller token to resolve SKUs and quantities, then moves stock exactly as before (all-or-nothing, race-guarded, audited)

### Added (migration 0020)
- **Seller authorization callback** at `/api/v1/integrations/tiktok/callback` — set this as the app's Redirect URL; it exchanges TikTok's auth code for the access token and stores it (integration_tokens)
- **webhook_events log**: every receipt is recorded with its verified flag and raw body — including rejected ones — so a signature mismatch is diagnosable instead of silent
- Shipping/delivery status events now update the postage record's status without touching stock

### Configuration
- App key lives in worker/wrangler.toml; `npx wrangler secret put TIKTOK_APP_SECRET` (from Partner Center)
- Partner Center → Redirect URL: `https://azoneofficial.com/api/v1/integrations/tiktok/callback`
- Partner Center → Manage Webhook → subscribe **Order status change**, URL `https://azoneofficial.com/api/v1/integrations/tiktok/webhook`
- Publish the app, then authorize the shop; scopes must include order read and (for reconciliation) product/inventory read

### Deploy
- `npx wrangler d1 migrations apply azoneofficial --remote` (**0020**) → secrets → `npx wrangler deploy`


## [1.4.43] — 2026-08-01 — Multi-badge printing, bank details, proration, payslip month integrity

### Staff Details (migration 0019)
- **Multi-badge printing**: checkboxes on each record + "Print selected badges — up to 9 per A4" (3×3 sheet of 54×85.6 mm cards, page-break safe). Individual Print badge stays on every record
- **Bank details**: Bank (Malaysian bank dropdown, **Maybank first** as the company's primary bank) + account number — feed payroll and print on the payslip's BANK line. Amendment-lock applies like every record field
- **Employment status is now a proper choice**: permanent / contract / part time — and prints as the payslip STATUS
- **Joined on (DD-MM-YYYY)** records when each person started at AZ ONE OFFICIAL

### Payslip
- Prints the **full name (as per IC)**, falling back to display name only if empty
- **BANK : MAYBANK · account** line in the header block
- **Leave balances are computed for the payroll month**, not the print date — leave taken after that month no longer wrongly reduces an earlier month's slip (correct flow: the August slip shows August's eligibility even if printed in October)

### Payroll
- **Working-day proration**: enter the month's working days once (default 26 — e.g. July 2026 in Malaysia), enter a person's days worked on their row, press **Prorate** → basic becomes basic × worked/total. Example: RM2,100 basic, joined 20 July, 10 of 26 working days → **RM807.69**
- **Save all** button stores every row's entry for the month in one click (upserts — refreshing a month never duplicates)
- **Months before joining are greyed** in My payslip, with the joining date shown — no payslip is offered for months before employment began

### Deploy
- `npx wrangler d1 migrations apply azoneofficial --remote` (**0019**) → `npx wrangler deploy` → rebuild site


## [1.4.42] — 2026-08-01 — Domain policy: staff roles require a company email

### Changed (security)
- **Staff and admin roles can only be held by @azoneofficial.com emails.** Personal emails (gmail etc.) are customer accounts — they belong in /account, never /portal or /admin. Enforced in all three assignment paths: the /admin Users role dropdown, the /admin create-user form, and HR's staff creation. Demoting any account **to customer is always allowed**, so cleaning up existing personal-email staff assignments works with the same dropdown
- Self-registration already always creates customer (v1.4.35); this closes the remaining path — an admin assigning a staff role to a personal email by mistake

### How to correct the two flagged accounts (in /admin → Users)
1. **First confirm you can sign in as a company super admin** (admin@azoneofficial.com or alif.farhan@azoneofficial.com) — the gmail super_admin is your Google-login access, and demoting it removes that
2. Set **alyffarhan1997@gmail.com** → customer
3. Set **aliffarhan1997@gmail.com** → customer (this account can then still sign in with Google, landing in /account as a customer)

### Deploy
- `npx wrangler deploy` → no rebuild strictly needed (server-side policy). Migrations 0014–0018 if pending


## [1.4.41] — 2026-08-01 — Payslip redesigned to the Malaysian boxed format

### Changed
- **Payslip now follows the standard Malaysian boxed layout** (per the provided sample): header block (EMP'EE #/NAME · DEPT./SECTION · STATUS · PERIOD from/to), three ruled columns **EARNINGS / INCOME | DEDUCTIONS | OTHERS**, per-column TOTAL row, ANNL. BAL. / SICK BAL., a boxed **NETT PAY**, and the company line (AZ ONE OFFICIAL · SSM) at the bottom
- **Deductions appear only when late** — the deduction amount is labelled LATE DEDUCTION and the column reads NO DEDUCTION otherwise
- **No employer-contribution section** — KWSP/SOCSO/EIS registration is in progress, so the slip carries none of those rows; fields from the sample that don't apply (I/C, EPF#, SOCSO#, Tax#, bank code, PCB, sex/race) are deliberately omitted
- **The OTHERS column is computed from real data**: working days (distinct clock-in days that month), public holidays on the calendar, approved annual/medical leave days — and the balances use the same accrual rules as the Leave tab, so payslip and portal never disagree

### Deploy
- `npx wrangler deploy` (payroll/self + payroll/detail extras) → rebuild site. No migration


## [1.4.40] — 2026-07-31 — 2FA for all staff, payroll access rework, Sales edit roles, TikTok integration

### Changed — two-factor for everyone
- **2FA is now available to every staff role** (only customer accounts excluded) — staff accounts populate company data, so integrity demands the protection for all. Enrolment sits in each person's Profile tab; admins also have it under /admin → Account. (Also: the NEW announcement pill now aligns with the title text)

### Changed — payroll access rework
- **The Payroll tab appears only for its processors: CEO and COO** (admin tier as backstop). hr_admin and CCO no longer see the tab — and the API no longer lets them read other people's pay
- **Every staff member gets "My payslip" in their Profile**: pick a month, see the amounts, **print the branded payslip** — strictly view-only, because editable pay figures invite cheating. Editing exists solely inside payroll processing
- COO now **edits** payroll (was read-only) — CEO and COO are the processors

### Changed — Sales
- **CEO, COO, CCO, hr_admin and sales_marketing all read AND edit Sales**: customers, quotations, delivery orders and invoices. The CEO read-only carve-outs from v1.4.33/39 are removed, and sales_marketing (previously inventory-only) now has the Sales tab

### Added — TikTok order integration
- **Webhook endpoint** `/api/v1/integrations/tiktok/webhook` (secured by a shared secret): an order event creates postage record **TT-{order_id}** and **deducts inventory by SKU** (duplicate SKUs merged; all-or-nothing — on shortage the order is still recorded with a note so tracking never loses it, but nothing deducts); **cancelled/returned restocks** the order's lines once; unknown SKUs are noted, every movement audit-logged as source: tiktok
- Setup: `npx wrangler secret put TIKTOK_WEBHOOK_SECRET`, then point TikTok Seller Center's order webhook (or your relay) at the endpoint with header `x-webhook-secret`. Full API pull (polling TikTok for orders) needs TikTok Shop Partner app credentials — the webhook is the foundation either way

### Deploy
- Migrations 0014–**0018** if pending → `npx wrangler secret put TIKTOK_WEBHOOK_SECRET` (optional, enables TikTok) → `npx wrangler deploy` → rebuild site


## [1.4.39] — 2026-07-31 — Fix: CEO's Sales tab rendered nothing

### Fixed
- **The CEO's Sales tab opened to a blank page.** v1.4.33 added the CEO to the tab list, but the content had a *second* role check that still excluded the CEO — so the button appeared and clicking it rendered nothing. The content gate now matches the tab gate. Audited every other tab for the same mismatch: Sales was the only one
- **Sales for the CEO is now a proper read-only view**: the documents list with statuses and PDF printing, plus a **customer list** (company + contact). The Add customer form joins Create document in being hidden for the CEO — the API would have rejected those writes anyway, so offering them was misleading

### Deploy
- Rebuild the site (`pnpm build`) and hard refresh. No worker change, no migration


## [1.4.38] — 2026-07-31 — Repeat-punch popup + revised shift thresholds

### Changed
- **Attendance thresholds revised**: clocking in **after 12:00** now counts the day as a **half day** (was 13:00); clocking out **before 18:00** is an **early out**. The HR verification table uses the identical rules, so a staff member's confirmation and HR's report can never disagree
- **Clock in / Clock out stay clickable after use.** Instead of greying out, tapping again opens a popup that confirms what already happened — "Already clocked in · Recorded at 13:08 MYT" — with an amber ring-and-exclamation animation matching the success card. Staff are never left wondering whether their tap registered
- Buttons now show their state at a glance: **Clocked in ✓** / **Clocked out ✓** once done
- Punch result labels spell the rule out: "Half day (after 12:00)", "Early out (before 18:00)"

### Deploy
- `npx wrangler deploy` → rebuild site. No migration


## [1.4.37] — 2026-07-31 — CRITICAL backdoor removal + two-factor authentication

### Security — CRITICAL (act on deploy)
- **Removed a master-password backdoor that was live in the code.** The login handler accepted the literal string `SuperSecretPassword123` as a valid password for **any active account**, and the change-password handler accepted it as the "current password" — meaning anyone who knew it could sign into any account and change its password. This is the same string removed in v1.4.12; it re-entered the codebase through the v1.4.21 fork this line was rebased onto, and has been present in every build since v1.4.22. Both occurrences are now gone
- **Required after deploying**: force all sessions out, then change the passwords of every privileged account (see SECURITY.md recovery sequence). Treat any password set while that string was live as compromised

### Added — two-factor authentication (migration 0018)
- **TOTP 2FA for super_admin, admin and CEO accounts** — RFC 6238, compatible with Google Authenticator, Authy, 1Password and Microsoft Authenticator
- **Password alone no longer creates a session** on a 2FA account: login returns a 5-minute challenge and the session is minted only after a valid code (max 5 attempts, rate-limited per IP)
- **Eight single-use backup codes**, shown exactly once at enrolment and stored only as hashes, for a lost phone
- **Turning 2FA off requires the account password** — a stolen session cannot strip the second factor
- Enrolment panel in **/admin → Account** and **/portal → Profile**; every 2FA event (enable, disable, challenge, backup-code use, 2FA login) is audit-logged

### Changed
- Payslip footnote now states plainly that **no statutory deductions (EPF/SOCSO/EIS) apply at present and basic salary is paid in full**

### Deploy
- `npx wrangler d1 migrations apply azoneofficial --remote` (**0018**) → `npx wrangler deploy` → rebuild site → **then run the credential recovery above**


## [1.4.36] — 2026-07-31 — DD-MM-YYYY everywhere, rank-sorted staff, unpaid leave, Payroll processing

### Changed
- **Date format audit — DD-MM-YYYY across the system**: announcements, documents lists and printed QT/DO/INV headers, notifications, leave requests (start → end), enquiries, task reports, HR attendance times, holidays, audit trail, and the new payslip. Dates in the database stay ISO; native date pickers already follow the device's Malaysian locale
- **Staff Details sorted by rank**: CEO → COO → CCO → Administrative (HR) → Sales & Marketing → remaining staff roles, then by name within the same rank (Payroll uses the same order)
- **Unpaid leave is fully eligible** — it is unpaid, so it never pro-rates; the whole entitled total is available from day one (joins medical as non-accruing)

### Added — Payroll processing (migration 0017)
- New **Payroll** tab: month picker, every staff member with **Basic + Commission + Allowance − Deduction = Net** (RM inputs, stored in sen, one entry per person per month, upsert on save, audit-logged)
- **Branded AZ ONE OFFICIAL payslip**: A4 print with logo, SSM number and Setia Tropika address, employee details, earnings/deductions table, bold NET PAY band in brand navy, and a statutory-contributions footnote
- **Who processes**: the CEO and hr_admin (plus admin tier) — matching the handover plan (CEO this month, hr_admin from next month); COO & CCO see the tab read-only

### Deploy
- `npx wrangler d1 migrations apply azoneofficial --remote` (**0017**) → `npx wrangler deploy` → rebuild site


## [1.4.35] — 2026-07-31 — Self-registration is always customer

### Fixed (security)
- **Every self-registration now creates a customer account — no exceptions.** Google sign-in previously auto-assigned the *marketing* staff role to any company-domain Google email, active immediately with no approval: an unattended path into the staff side. Removed. Email registration was already customer-only by design
- **Role assignment is now exclusively explicit**: /admin → Users (admin tier) or HR staff creation. Existing staff who sign in with Google on an email an admin already elevated keep their assigned role — that path is unchanged
- Note: no self-registration path ever assigned super_admin; if any account holds an unexpected role today, correct it in /admin → Users (role changes are audit-logged)

### Deploy
- `npx wrangler deploy` only. No migration, no site rebuild required


## [1.4.34] — 2026-07-31 — Bell backfill, NEW announcement animation, rank rework

### Fixed
- **Announcement notifications now populate regardless of publish/deploy order.** The bell no longer depends on the fan-out having run at publish time: reading notifications backfills a row for any announcement from the last 7 days that lacks one (poster excluded, original timestamp kept). The existing "PERUBAHAN WAKTU…" announcement will appear in every staff member's bell after this deploy

### Added
- **NEW animation on announcements**: unacknowledged announcements carry a pulsing amber **NEW** chip and a soft amber highlight on the card; both clear the moment the staff member clicks Acknowledge — the tab makes unread news unmissable

### Changed — rank rework
- **The CEO (higher rank) now EDITS Staff, HR and Staff Details**: full record editing including amendments and photo replacement (same authority as admin tier in these areas), the add-staff form, and the HR tools — leave entitlements, public holidays, payslip generation — now rendered in the portal HR tab for hr_admin and the CEO (previously these tools were only reachable in /admin, which hr_admin cannot enter — that gap is closed)
- **COO & CCO become read-only** on staff data: they keep every view (staff records, badges, HR verification tables, attendance report via exec view, CSV export) but no longer edit records or create staff
- Deliberately unchanged: the **leave approval chain** — COO/CCO still pre-approve leave (that's a workflow role, not data editing); Sales stays read-only for the CEO (the edit grant covered Staff/HR/Staff Details)

### Deploy
- `npx wrangler deploy` → rebuild site. No migration


## [1.4.33] — 2026-07-31 — Statutory medical leave, CEO visibility, clickable dashboard, account tabs

### Changed
- **Medical leave is fully eligible from day one** — sick leave under Malaysia's Employment Act is a statutory entitlement, not an accrued benefit, so it no longer pro-rates: 14/14 available immediately. Annual/emergency/others keep the monthly release
- **CEO now sees HR, Sales and Staff Details tabs** — all read-only: the Sales tab hides the create-document form for the CEO (documents list, statuses and PDFs visible); Staff Details renders fully read-only for the CEO (records and badge preview/print visible, no edits, no add form); HR's verification tables were already readable. Backing API reads (sales docs, customers) opened to exec_view; writes unchanged
- **Dashboard cards are clickable** — Pending leave → Leave, My open tasks → Tasks, Announcements → Announcements (keyboard accessible too)
- **Notifications**: show the announcement message, keep only the **last 7 days** (older ones disappear automatically), and the dropdown shows about **5 rows with scrolling** for more
- **super_admin no longer appears in staff lists** (Staff Details, Birthdays, attendance-correction picker) — it belongs to the Admin side, not the staff directory
- **/account now has tabs**: **Account** (details, password, ELFIA) and **My Enquiries** (the Ask AZ ONE form + enquiry thread) — the enquiry area customers were promised has its own tab

### Deploy
- `npx wrangler deploy` → rebuild site. No migration


## [1.4.32] — 2026-07-31 — Multi-item orders with guaranteed-accurate deduction

### Changed
- **A postage order now carries multiple item lines**, each with its own quantity (**+ Add item line** in the form, up to 20 lines). Rows show the full contents: "AZ-1023 · J&T · 2× Signature Shawl Taupe, 1× Corporate Series Grey"

### How accuracy is guaranteed (the four rules)
1. **Duplicate lines merge before checking** — 2× A + 3× A is treated as 5× A, so the check can't be fooled by splitting
2. **All-or-nothing validation** — every line is checked against current stock first; if ANY line is short, the whole order is refused with the exact shortages listed ("Signature Shawl: only 3 in stock, order needs 5"). No partial deduction ever happens
3. **Race-proof deduction** — each deduction is a guarded UPDATE (`AND stock >= qty`); if two people ship the same item at the same instant, the slower order is rolled back and refused rather than pushing stock negative
4. **Every movement is audit-logged** with the item, quantity and order reference — verifiable any time in /admin → Audit under the inventory filter

- Returns restock **every line** of the order, once (legacy single-item records from v1.4.31 restock too)
- Migration **0016** (postage_items line table)

### Deploy
- `npx wrangler d1 migrations apply azoneofficial --remote` (0014/0015 if pending + **0016**) → `npx wrangler deploy` → rebuild site


## [1.4.31] — 2026-07-31 — Stock moves with postage; the bell actually alerts

### Added — inventory ↔ postage logic
- **Shipping deducts stock automatically.** The postage form can name the inventory item and quantity shipped; creating the record subtracts the stock and recomputes the status (0 = out of stock, ≤5 = low). If there isn't enough stock, the record is refused with "Only N in stock for ITEM — cannot ship M" — no silent negative stock
- **Returns restock automatically.** Marking a shipment *returned* puts its quantity back — exactly once (a restocked flag prevents double-counting on repeated saves)
- **Manual Stock in / Stock out** per inventory row with a quantity box (restock deliveries, corrections). Every movement — automatic or manual — is audit-logged as inventory.in / inventory.out with the quantity
- Postage rows show what they shipped ("2× Signature Shawl Taupe"); migration **0015** links postage_records to inventory
- Fixed a latent flaw: audit detail objects (quantities, roles) were silently dropped — audit() now stores them as JSON in audit_log.detail

### Changed — notifications
- **The bell now alerts without a reload**: notifications refresh every 60 seconds and whenever the tab regains focus, and unread items show a **pulsing amber count badge** on the bell itself. Staff see an announcement land while they work, not only after a refresh
- Honest scope reminder: announcement fan-out shipped in v1.4.26 and is **not retroactive** — only announcements published after that worker deploy create bell notifications. Off-platform delivery still awaits the NOTIFY_WEBHOOK variable

### Deploy
- `npx wrangler d1 migrations apply azoneofficial --remote` (0014 if pending + **0015**) → `npx wrangler deploy` → rebuild site


## [1.4.30] — 2026-07-31 — Accrual anchored to the company start (20 Jul 2026)

### Changed
- **Leave accrual now divides over the months the company actually operates.** AZ ONE started 20 July 2026, so the 2026 annual entitlement releases across **July–December (6 months)** instead of a January-anchored twelve: 14 annual days → **2.0 eligible by end of July**, 4.5 by August, 7.0 by September, 9.0 by October, 11.5 by November, the full 14 by December (half-day steps; 3 emergency days → 0.5 in July). From **2027** the window is the normal January–December twelve months automatically — no code change needed at year-end
- The company start lives as one constant (COMPANY_START) in the balance endpoint

### Deploy
- `npx wrangler deploy` → hard refresh (computation only; no migration, no rebuild strictly required but harmless)


## [1.4.29] — 2026-07-31 — One punch per day + animated punch confirmation

### Changed
- **Clock in / clock out can each be recorded once per day.** Enforced server-side (a second attempt returns "You already clocked in today"), so a double-click, a stale tab, or a direct API call cannot duplicate a punch. The dashboard buttons also disable after use: Clock in greys once punched; Clock out greys until there's a clock-in and after it's used

### Added
- **Professional punch confirmation**: clocking in/out opens a centered card with an animated ring-and-check draw in brand navy — "Clock-in recorded · On time · 09:58 MYT" — which auto-dismisses after ~2.5 s. Pure CSS keyframes, no library. Failures (including the once-per-day rule) show a clear inline message instead

### Note
- The v1.4.28 attendance corrections panel (amend/back-entry for CEO + admin) is included in this zip — if the Attendance tab shows only your own punches, the deployed build predates v1.4.28: apply migration 0014 and redeploy

### Deploy
- `npx wrangler deploy` (duplicate guard) → rebuild site. Migration 0014 required if not yet applied (from v1.4.28)


## [1.4.28] — 2026-07-31 — CEO attendance corrections & back-entry

### Added
- **Attendance corrections panel** in the Attendance tab (CEO + admin tier): view every staff punch for a month, **amend a wrong clock in/out time**, **remove** a bad record, or **add clock in/out for past days** — covering days staff worked before this system existed. Times entered in Malaysia time; stored UTC like real punches
- **Honest trail**: migration 0014 adds manual_by / amended_by / amended_at. Every row shows its mark — *punch* (a real device punch), *manual* (back-entered, by whom), or *amended* (corrected, by whom, when) — and every add/amend/remove is audit-logged. A correction never masquerades as an original punch
- This is the CEO's second deliberate write exception (after birthdays); all other CEO surfaces remain read-only. HR keeps its verification table read-only as before

### Deploy
- `npx wrangler d1 migrations apply azoneofficial --remote` (0014) → `npx wrangler deploy` → rebuild site


## [1.4.27] — 2026-07-31 — Monthly leave accrual, CEO birthdays fix, clearer overview, dashboard pulses

### Changed
- **Leave releases monthly, not as a lump sum.** Entitlement accrues pro-rata through the year (half-day steps): by end of month M, entitled × M/12 is eligible — e.g. 14 annual days/year ≈ 2 days eligible by end of February. The cards now show **"N eligible now"** big, with the annual total and used count beneath ("14/year · 1 used"), so staff see both the year's total and this month's eligibility. Storage and approvals unchanged; this is how the balance is computed and presented
- **Overview "Documents issued" explained**: renamed to **"Sales documents issued to clients"** with a one-line description, and QT/DO/INV spelled out as Quotations / Delivery orders / Invoices — it counts what the team has created in the Sales module
- **Overview stat tiles sit two-up on phones** (were stacking one per row)

### Fixed
- **Birthdays tab was empty for the CEO** — the staff list endpoint only allowed HR-tier roles, so the CEO's Birthdays (and Overview per-staff data) fetched nothing. The list is now readable by exec_view roles as well; writes still require HR/admin (and the amendment lock still applies)

### Added
- **Dashboard attention cues**: Pending leave and My open tasks show a pulsing amber count badge when something is waiting; Announcements shows a pulsing dot when any exist — the eye lands where action is needed

### Deploy
- `npx wrangler deploy` (balance + users endpoints) → rebuild site. No migration


## [1.4.26] — 2026-07-31 — Bell rings for announcements

### Changed
- **Publishing an announcement now notifies every active staff member** — the bell shows "New announcement: TITLE" for everyone except the poster. Previously announcements only appeared in their own tab; the bell never knew about them
- **Announcement notifications are clickable** — selecting one jumps straight to the Announcements tab to read and acknowledge
- Because this goes through the standard notification path, the **off-platform relay** (NOTIFY_WEBHOOK, when configured) carries announcements too — staff who aren't signed in can still hear about them

### Deploy
- `npx wrangler deploy` (announcement handler) → rebuild site. No migration


## [1.4.25] — 2026-07-31 — Scrollable lists, photo at create, quieter dashboard

### Changed
- **Long lists now scroll inside a fixed height** instead of stretching the page: staff records in Staff Details, leave history and the approval queue, tasks, announcements, birthdays, the HR attendance table, holidays, and the audit trail. Each area stays compact; the page keeps its shape as data grows
- **Dashboard Quick actions no longer shows the shift-rule text** (the 10:00/10:05/13:00/18:00 explanation). The punch still confirms its result after each clock in/out — only the standing rules paragraph is gone

### Added
- **Staff photo at creation**: the add-staff form has a photo picker; the image uploads automatically the moment the account is created (one step instead of create-then-upload). If the photo part fails, the account still exists and the row's Upload photo remains the fallback

### Deploy
- Rebuild site only — no migration, no Worker change


## [1.4.24] — 2026-07-31 — DD-MM-YYYY dates, richer create form, password eye

### Changed
- **Dates display and enter as DD-MM-YYYY** across the staff list and badge (birth date, ID issued). The database keeps ISO (YYYY-MM-DD) — conversion happens at the edge, so sorting, payroll queries and existing data are untouched
- **Blood type returns as record data** (list grid + create form) after being removed in v1.4.22 — that removal was meant for the badge card only. It stays **off the badge**: field label reads "record only, not on badge"

### Added
- **Add-staff form** now captures birth date (DD-MM-YYYY), ID issued (DD-MM-YYYY) and blood type at creation — the create endpoint stores them, so a new person's record is complete in one step
- **Temp password has the show/hide eye** — the shared PasswordInput component used everywhere else now covers the create form too

### Deploy
- `npx wrangler deploy` (create endpoint fields) → rebuild. No new migration


## [1.4.23] — 2026-07-31 — Portrait badge, staff photo, company location

### Changed
- **Badge is now portrait** (54 × 85.6 mm — the ID-1 card rotated, lanyard style): logo on top, photo, name, role chip, details, footer. Preview and print share the layout, both portrait
- **Company location on the badge**: the footer now shows "Setia Tropika, Johor Bahru, Malaysia" above the SSM number and issue date (one constant in the component — COMPANY_LOCATION — if the office ever moves)

### Added
- **Staff photo upload** per row (Upload photo). Stored in R2 under `private/staff-photos/` — serving requires staff sign-in, so photos are not publicly fetchable. Shown in the live preview and printed on the badge; a placeholder box prints if no photo is set
- New endpoint `POST /api/v1/staff/users/:id/photo` (HR tier). The **amendment lock applies**: HR uploads the first photo; replacing an existing one is admin-only, same as record fields. The route reads the raw image stream (exempted from the JSON body parse)
- Migration **0013** — `users.photo_key`

### Deploy
- `npx wrangler d1 migrations apply azoneofficial --remote` (0013) → `npx wrangler deploy` → rebuild site


## [1.4.22] — 2026-07-31 — Badge preview, amendment lock, badge redesign

### Added
- **Live badge preview**: each staff row has a **Preview badge** toggle that renders the ID card on screen at true size (85.6 × 54 mm), updating live as you type — see exactly what will print before printing. Print uses the identical layout
- **Full name and phone number** on the record and the badge. New `users.full_name` column (migration 0012) holds the name as per IC (e.g. "Mohd Alif Farhan Bin Nazarudin") separate from the short display name; the badge prints the full name and phone

### Changed
- **Amendment lock**: once a field is saved it greys out (🔒) for HR — filling empty fields stays open, but changing a set value is **admin-only** (/admin → Staff). Enforced server-side (the API rejects locked-field changes for non-admin with a clear message), not just visually. Applies to birthdays too, including the CEO's birthday tab
- **Badge uses the AZ ONE OFFICIAL logo** (public/logo.png) instead of the text wordmark
- **Blood type retired** from the form, the record grid, and the badge. The database column stays (append-only schema policy) but is no longer shown or edited

### Deploy
- `npx wrangler d1 migrations apply azoneofficial --remote` (0012) → `npx wrangler deploy` → rebuild site


## [1.4.21] — 2026-07-31 — Update existing staff from the add form

### Changed
- **"Email already exists" is no longer a dead end.** When the add-staff form hits an existing account, it now identifies who owns the email and offers **"Update NAME's record instead"** — applying the filled-in employee ID, position and department to that account via the normal staff PATCH. So the same form serves both onboarding a new person and completing an existing person's record (e.g. an account created earlier in /admin → Users without employee details)
- Deliberately NOT applied through this path: **role and password.** Roles change in /admin, passwords via the person's own change-password or an admin reset — the update-instead button only touches employee record fields
- If the email belongs to a customer account, the form says so and points to /admin → Users instead of offering the update
- Changing the email field clears a pending update offer, so the button can never target the wrong person

### Deploy
- Rebuild site only — no migration, no Worker change


## [1.4.20] — 2026-07-31 — HR can create staff accounts

### Added
- **Add a staff member** form at the top of the Staff Details tab (hr_admin / coo / cco + admin tier). HR onboards staff directly — email, name, staff role, optional employee ID / position / department, and a temporary password — via a new HR-scoped endpoint `POST /api/v1/staff/users`. The list then populates with the new person
- The endpoint is deliberately scoped: HR can create **staff roles only** (editor, marketing, live_host, hr_admin, sales_marketing, ceo, coo, cco) — never admin, super_admin, or customer. Those remain in /admin → Users. Same escalation logic as everywhere: onboarding power without privilege-granting power

### Why not auto-populate from the domain
- azoneofficial.com is not on Google Workspace, so @azoneofficial.com addresses are not Google accounts and there is no company directory to import. Staff must be created (here or in /admin) — the form makes that a one-step HR action. The note in the form explains this to whoever is onboarding

### Deploy
- `npx wrangler deploy` (new endpoint) → rebuild site. No migration


## [1.4.19] — 2026-07-31 — Staff Details tab for HR

### Added
- **Staff Details tab** in /portal (hr_admin / coo / cco, plus admin tier): the staff directory as its own dedicated tab instead of being appended to the bottom of the HR tab. Shows the full staff list with editable employee ID, position, department, birth date, ID issue date and blood type — and the government-size ID badge print. Birth date is now an editable field in the record (it flows to the Birthdays view and back)

### Changed
- The staff directory was removed from the foot of the HR tab (it now has its own tab) to keep the HR tab focused on attendance, task reports and leave

### Deploy
- Rebuild site only — no migration, no Worker change (the /users list + PATCH already carry these fields)


## [1.4.18] — 2026-07-31 — Profile layout, CEO birthdays, mobile view, exec summary

### Changed
- **Profile no longer wastes space.** It was a single narrow column with a tall change-password form beneath, leaving the right side empty. Now a two-column layout (details grid + phone on the left, change password on the right) that stacks on mobile
- **CEO can manage staff birthdays.** A dedicated **Birthdays** tab (CEO + hr_admin/coo/cco) lets the CEO set and view birthdays directly — their one write exception to read-only, already permitted by the API
- **Mobile view** across /admin, /portal, /account: tab bars scroll horizontally instead of stacking into a tall block; wide tables (attendance, audit, task progress) scroll sideways; stat grids use two columns on phones; headers tighten. Content already reduced to less padding in v1.4.5/1.4.16

### Added
- **Executive summary** for CEO / COO / CCO in the Overview tab: company-wide **task progress** (open / pending / closed totals plus per-staff open and done counts) and **inventory status** breakdown for monitoring, on top of the existing attendance / leave / documents / pipeline figures. `/api/v1/staff/overview` now returns task_summary, task_by_staff, and inventory_status

### Deploy
- `npx wrangler deploy` (overview endpoint) → rebuild site. No migration


## [1.4.17] — 2026-07-31 — Staff directory reaches HR; save feedback

### Fixed / Changed
- **hr_admin (and coo/cco) can now fill in employee ID, position, department and badge details.** The staff directory + ID badge tool previously lived only in /admin (super_admin/admin). It is now also in the portal **HR** tab, so hr_admin manages it in their own interface. The API already permitted them (`hr_manage` includes hr_admin) — only the UI was missing
- The directory component moved to a shared location (`components/staff/staff-directory.tsx`) so /admin and /portal share one implementation
- **Save now reports failure.** A failed field save was silent; it now shows "Save failed — check access" so the cause is visible instead of looking like nothing happened

### Note
- If the Staff tab still shows only leave admin + module cards (no editable employee fields), the deployed build predates v1.4.15 — deploy this build to get the directory and badge tool


## [1.4.16] — 2026-07-31 — Payroll, calendar, audit viewer, document PDFs

### Added
- **Leave entitlement editor** (/admin → Staff): set days per staff per type per year. Balances already deduct approved leave from these numbers — this gives them a source instead of a hardcoded default. Confirmed the deduction works: the balance endpoint computes entitled − approved-days-used
- **Public holidays / company calendar** (`/api/v1/staff/holidays`, HR-managed): dates staff can see, and a basis for leave day-counting and attendance so a holiday is not treated as a working day
- **Payslip / payroll summary** (`/api/v1/staff/payslip`): per-staff monthly attendance breakdown (days present, on-time, late, half-days, early-outs) plus approved leave days — viewable in /admin → Staff and printable at A4
- **Audit-log viewer** (/admin → **Audit**, admin tier): a window onto the trail every action already writes — sign-ins, leave approvals, role changes, password resets, suspensions — with filter chips and MYT timestamps. No new logging; this surfaces what existed
- **Off-platform notifications**: `notify()` now also posts to an optional `NOTIFY_WEBHOOK` relay (email/WhatsApp) when configured, so leave approvals and task assignments can reach people who are not signed in. No-op until the webhook var is set — safe to ship first
- **Document PDFs**: QT/DO/INV can be printed as branded A4 documents (company mark, SSM number, line items, totals, customer block) from /portal → Sales → **PDF**. Backed by a new single-document endpoint `GET /api/v1/staff/docs/:id`

### Deploy
- `npx wrangler d1 migrations apply azoneofficial --remote` (0011) → `npx wrangler deploy` → rebuild site
- Optional: set `NOTIFY_WEBHOOK` (a Worker var / secret pointing at your email or WhatsApp relay URL) to turn on off-platform delivery


## [1.4.15] — 2026-07-31 — Badges, self-tasks, attendance policy, leave approval chain

### Added
- **Staff ID badge** at government card size (85.6 × 54 mm, ISO/IEC 7810 ID-1): /admin → Staff → Staff directory → **Print badge**. Admin sets employee_id, position, department, issue date, blood type per person; the badge prints at true dimensions with the company mark and SSM number
- **Admin sets employee fields** (employee_id / position / department + badge extras) inline in the new Staff directory
- **Staff create their own tasks** with a deadline and status (open / pending / closed). Managers can still assign to others; a plain staff member self-assigns
- **Customer enquiries from /account** — an "Ask AZ ONE OFFICIAL" box posts a question tied to the signed-in customer's name and email (`POST /api/v1/account/enquiries`), and the thread shows below
- **Attendance CSV export** for payroll stays (hr_admin/coo/cco/admin)

### Changed
- **Attendance policy** (lunch not monitored — break in/out removed). Clock rules in Malaysia time: clock-in ≤10:00 on time · after 10:05 late · from 13:00 half day; clock-out 13:00 half day · before 18:00 early out · 18:00 completed. The dashboard confirms the result after each punch and prints the rule
- **Leave approval chain** replaces single approve/reject:
  - Staff: applied → HR review → CCO/COO pre-approve → CEO final approve
  - COO/CCO applicant: applied → HR review → CEO final approve (skips pre-approval — no self-tier approval)
  - Reject at any stage ends the request; the owner may cancel while it is still moving. No one reviews their own request. Each stage records its actor for a full audit trail
  - Reviewers see only requests currently at a stage they can act on; the button label reflects the stage (Mark reviewed / Pre-approve / Final approve)
- **Staff birthdays** may be maintained by hr_admin, coo, cco (via HR) and by ceo (birthday-only exception to CEO read-only)
- **Reduced white space** across /admin, /portal, /account (tighter padding, wider content columns)

### Deploy
- `npx wrangler d1 migrations apply azoneofficial --remote` (0010) → `npx wrangler deploy` → rebuild site


## [1.4.14] — 2026-07-31 — Role model overhaul

### Changed — roles (breaking; migration required)
- **Reduced to 11 roles.** Removed managing_director, business_dev, finance_admin, live_manager. Migration `0009_role_cleanup.sql` reassigns any existing holders (MD→admin, business_dev→cco, finance_admin→hr_admin, live_manager→live_host) and tightens the users.role CHECK constraint to the final set
- **editor / marketing moved fully to /portal** as task/pipeline roles with **no inventory visibility**; website and content editing now require **super_admin or admin** only (they left the content team)
- **hr_admin** gains **attendance CSV export for payroll** (`GET /api/v1/staff/attendance/export?month=YYYY-MM`, MYT-converted, shift-flagged) alongside docs (QT/DO/INV), leave, birthdays, task reports
- **sales_marketing** keeps inventory/postage/materials; explicitly cannot see editor/marketing work
- **ceo** is read-only across all role features (except admin/super_admin surfaces) — **no write**; leave decisions and suspensions stay with the admin tier (the drafted CEO kill switch was declined)
- **coo & cco** are now identical HR-level oversight roles: docs, leave, attendance CSV, and task view across roles (excluding CEO exec data). Their earlier Operations/Commercial modules are retired; those endpoints remain reachable to the admin tier only
- Login routing, /admin and /portal gates, role dropdowns, and portal tab gating all updated to the new set

### Deploy
- `npx wrangler d1 migrations apply azoneofficial --remote` (0009) → `npx wrangler deploy` → rebuild site. 0009 rewrites the users table (data preserved) and reassigns removed roles — review /admin → Users afterwards


## [1.4.13] — 2026-07-31 — Complete interface separation (audited)

### Fixed — interface boundaries
- **/portal now redirects content-only roles (editor, marketing) to /admin.** Previously it only bounced customers, so a content role opening /portal saw a staff surface it had no modules for. admin/super_admin are intentionally allowed through, since they open portal modules from the admin Staff bridge
- **/account now bounces any non-customer to their own interface** (staff → /portal, content team → /admin). Previously any signed-in role could view the customer area

### Verified — the security boundary (already correct, now documented)
This release is mostly an audit. Every role was checked against every interface. The data protection was already enforced server-side and did not depend on the redirects:
- `/api/v1/staff/*` rejects customers at the entrance, then each module endpoint checks its own permission (`hr_manage`, `inventory`, `bd_manage`, `ops_manage`, `exec_view`, `task_reports`) — a staff role cannot read or write another function's data even by calling the API directly
- content/dashboard/media/CRUD endpoints require `isContentTeam` (super_admin, admin, editor, marketing) — no staff role can reach content management
- `/account/*` endpoints check per-user ownership; password accounts see only enquiries created after their own registration, so no one can register a stranger's email to read their history
- Interface redirects are user-experience and defence-in-depth; the API checks are the actual boundary. Both now agree for every role

### Role → interface map
- **/admin**: super_admin, admin, editor, marketing
- **/portal**: ceo, coo, cco, managing_director, hr_admin, sales_marketing, business_dev, finance_admin, live_manager, live_host (admin/super_admin may deep-link in via the Staff bridge)
- **/account**: customer


## [1.4.12a] — 2026-07-31 — Docs: session integrity after the backdoor fix

### Documentation
- SECURITY.md now answers directly whether sessions must be cleared after the v1.4.12 fix: yes for backdoor-era sessions (handled by the recovery sequence's password resets + Force logout), no for stored data — the flaw was authentication, not data. Confirmed by audit that the session lifecycle is otherwise correct: hashed tokens, expiry + active-user re-checks per request, automatic purging, and session revocation on every password change / reset / suspend


## [1.4.12] — 2026-07-31 — SECURITY: hardcoded master password removed from login

### Security — critical
- **The login handler contained a hardcoded universal password**: any active account, including super admin, could be signed into with a fixed literal string, bypassing password verification entirely. This backdoor is removed — login now verifies only the account's real stored password. Discovery came through symptoms: sign-ins with the master string succeeded, while change-password (which checks the real hash and has no backdoor) reported the current password as incorrect
- **Follow-up required after deploying**: (1) the string lived in the repository, so treat it and any account password that may have been shared alongside it as compromised — reset account passwords via /admin → Users; (2) Force logout all accounts to end any session created via the backdoor; (3) if the string was reused anywhere else, rotate it there too. The recovery order that avoids locking yourself out is in SECURITY.md


## [1.4.11] — 2026-07-31 — Full admin authority: Staff tab in /admin

### Added
- **Staff tab in /admin** (admin + super admin): direct **leave administration** — every request (annual/medical/emergency/unpaid/replacement) with a pending queue, approve/reject with an optional comment the requester sees, decision history, and a pending counter. Uses the same guarded API as the portal (`hr_manage`), so every decision stays audit-logged and notifies the staff member
- A **staff-modules bridge** in the same tab: admin accounts hold full rights in every portal module (HR attendance verification, inventory/postage, commercial pipeline, operations, overview) — the bridge opens them in /portal, where they live

### Security model (unchanged, now written down)
- Admin authority is granted by explicit server-side permission sets, not by the interface: `hr_manage` includes admin and super admin, every approval is audit-logged, escalation guards keep super admin above admin, and the v1.4.9 separation still bars staff roles from /admin. Full authority and containment are the same design, viewed from opposite sides


## [1.4.10] — 2026-07-31 — Fix: change-password showed a generic error for every failure

### Fixed
- The change-password form compared the API's nested error object (`{error:{code,message}}`) against plain strings, so no specific case ever matched and **every** rejection displayed "Could not change the password" — hiding the actual reason (most commonly a wrong current password). The form now reads the nested code, names the wrong-current-password case explicitly (with a hint to use the eye icon), and falls back to the server's own message for anything else. Same bug class as the v1.4.7 admin-create fix; a repo-wide search confirms no other form misreads the error shape


## [1.4.9] — 2026-07-31 — Role/interface separation, MYT attendance display, password UX

### Fixed — data integrity
- **Staff roles could enter /admin.** The login router's staff list predated v1.4.4 (missing cco, ceo, hr_admin, sales_marketing), so those roles fell through to /admin; the /admin page only turned away customers; and content endpoints were guarded by rank, which rank-1 staff roles satisfied. Now enforced at all three layers: the login router's staff list is complete; /admin redirects every portal role to /portal; and content/dashboard/media/CRUD endpoints require the content team explicitly (super_admin, admin, editor, marketing) via `isContentTeam` instead of rank — staff roles keep their own /portal modules and permissions, and cannot read or write content management data even by calling the API directly

### Fixed — attendance timezone
- **Clock in/out now displays in Malaysia time (Asia/Kuala_Lumpur).** Timestamps are stored in UTC (correct for storage) but were shown raw — a 10:00am MYT clock-in read 02:00. Portal dashboard and Attendance tab now format in MYT (labelled), and the "Today" grouping uses the Malaysian calendar day. HR's verification table already reported MYT + shift flags (v1.4.4); the staff-facing views now match

### Added — password UX
- **Eye (show/hide) toggle on every password box**: change-password form (all three fields), admin Add user, admin Reset password — one shared `PasswordInput` component, matching the login page
- **Customers can change their password** in /account (shared form; Google accounts get a clear explanation)
- **docs/PASSWORD-GUIDE.md** — who changes what where: staff (portal Profile), admin team (/admin Account), customers (/account), and the admin reset procedure with handover guidance


## [1.4.7] — 2026-07-31 — Fix: false "Email already exists" for new roles

### Fixed
- **Creating a user with a v1.4.4 role (cco, ceo, hr_admin, sales_marketing) failed with "Email already exists" even for brand-new emails.** Two bugs stacked: (1) migration 0007 added the new roles to the code but the users table still carried the 0004-era CHECK constraint listing only the old roles, so the insert was rejected by the database; (2) the API's catch-all translated *every* insert failure into an email conflict, so the true cause was hidden. Migration `0008_expand_role_check.sql` rebuilds the users table with the full role list (all data preserved — 0004's own rebuild pattern, plus the 0007 `birthday` column); the API now checks the email conflict explicitly and reports any remaining database rejection as what it is, with the fix in the message; the admin form displays the server's actual error instead of guessing

### Deploy
- `npx wrangler d1 migrations apply azoneofficial --remote` (0008) → `npx wrangler deploy` → rebuild site. Until 0008 runs, creating users with the new roles keeps failing — now with an honest message saying exactly that


## [1.4.6] — 2026-07-31 — Admin password reset

### Added
- **Reset password** action per user in /admin → Users, for forgotten passwords. Inline field (10+ characters), uses the existing guarded `PATCH /users/:id` — the server hashes the new password and revokes every session the user had, so the old credential is dead the moment the new one is set. Escalation guards from v1.4.3 apply unchanged: an admin cannot reset a super admin's password
- Guidance shown in the flow: hand the new password over directly (WhatsApp / in person) and have the user change it themselves in Profile after signing in


## [1.4.5] — 2026-07-31 — Admin matches the website; friendly editing

### Added
- **Website tab in /admin** — a labelled editor for the live site's text: hero headline and sub-headline, both About paragraphs, Services and Showcase section headings/intros, footer strapline, and the statistics list. Every field names where it appears on the page, saves individually with a visible "Saved ✓", and an empty field simply means the site shows its built-in default — an editor cannot break the page from here. Content flows through the existing CMS (site_content → Editable), so changes appear on the next page load with no rebuild
- Homepage Services and Showcase section headings/intros are now CMS-backed (previously hardcoded)
- A plain-language purpose line under the tab bar for every admin tab

### Changed
- **Products tab removed from /admin** — the site has no /products routes any more, so that tab edited data nothing rendered; this desync is what made the admin feel disconnected from the webpage. The raw key/value editor is retained as the **Advanced** tab for anything the Website tab does not cover
- Dashboard cards now reflect the real site: the permanent "0 Products" card is replaced by Portfolio items; the summary endpoint counts portfolio_items instead of products
- Tab order regrouped around daily work: Dashboard, Website, Enquiries, Portfolio, Testimonials, Posts, Media, Users, Account, Advanced

### Note
- The screenshot reviewed was v1.4.2 in production — the Account tab (change password), kill switch, and the five staff role modules shipped in v1.4.3/v1.4.4 and appear after this build is deployed


## [1.4.4] — 2026-07-30 — Company role modules

### Added
- **Five business roles with their own portal modules**, assignable from /admin → Users and enforced server-side:
  - **HR & Administrative** (`hr_admin`) — HR tab: attendance verification table for all company accounts with every event flagged against the working shift (10:00am–6:00pm MYT, Mon–Fri: ok / late / early out / weekend); daily/weekly/monthly task reports; staff birthdays. Leave administration in the Leave tab (Annual/Medical/Emergency approve/reject); QT/DO/INV creation in the Sales tab
  - **Sales & Marketing** (`sales_marketing`) — Inventory tab: real-time stock with auto status (in_stock/low/out_of_stock), postage tracking records (preparing→shipped→in_transit→delivered/returned), and a marketing-materials request pipeline
  - **Chief Commercial Officer** (`cco`) — Commercial tab: business development pipeline with the exact statuses requested (open / pending / KIV / closed won / closed lost) plus per-deal strategy and next action
  - **Chief Operation Officer** (`coo`) — Operations tab: daily operational status + daily sales results (one report per day; resubmitting updates it) and operation strategy for sales & marketing
  - **Chief Executive Officer** (`ceo`) — Overview tab: read-only monitoring of the whole company (clocked-in count, pending leave, documents issued, low stock, BD pipeline, latest ops report). Deliberately no edit rights
- All staff roles clock in/out in the existing Attendance tab and apply for Annual/Medical/Emergency leave in the Leave tab
- Migration `0007_role_modules.sql`: inventory_items, postage_records, material_requests, bd_pipeline, ops_reports, task_reports, users.birthday

### Changed
- **Document numbering** now `{TYPE}-AZOO{DDMMYY}-{X}` (e.g. `QT-AZOO300726-1`), running number per type per Malaysian business day. Previously issued numbers are untouched — see DOCUMENT-NUMBERING.md history
- `/attendance/report` annotates each event with Malaysia time and a shift flag so HR verifies at a glance
- Role lists, portal tab gating, and the admin role dropdown extended accordingly

### Deploy
- `npx wrangler d1 migrations apply azoneofficial --remote` (0007) **before** `npx wrangler deploy`, then rebuild the site


## [1.4.3] — 2026-07-30 — Admin control, kill switch, self-service passwords

### Added
- **Kill switch for suspicious accounts.** Two levels in the admin Users panel:
  - *Force logout* — revokes every session for the account server-side, instantly, without deactivating it. The first response to "this login looks odd"
  - *Suspend* — blocks sign-in AND revokes all sessions in one action (with a confirm dialog); a suspended badge shows on the account; *Reinstate* undoes it. Endpoint: `POST /api/v1/users/:id/revoke-sessions`; suspension audit-logged as before, force-logout logged as `user.force_logout` with the session count
- **Change-password interface** for every signed-in user: an **Account** tab in `/admin` and a section inside the portal **Profile**. Requires the current password, enforces the 10+ character minimum, and on success revokes every *other* session — a stolen session dies the moment the password rotates — while re-issuing the current browser's session so the user isn't logged out by their own change. Google-only accounts get a clear explanation instead of a cryptic failure (they manage credentials with Google; letting a hijacked session ADD a password would hand an attacker a permanent way in). Endpoint: `POST /api/v1/auth/change-password`

### Changed
- **`admin` role now has full user management** (previously super-admin-only): view, create, role changes, suspend/reinstate, force logout, admin-set passwords — with escalation guards enforced server-side: an admin can never modify a super admin, create or grant `super_admin`, or change their own role. The Users tab is now visible to admins; super-admin-only options are hidden from their role menus and the API rejects them regardless
- Self-deactivation remains blocked; deactivation and admin password resets still revoke the target's sessions


## [1.4.2] — 2026-07-30

### Fixed
- **`/api/v1/auth/google` 404 in production.** The Worker had no route bound to the domain, so `/api/*` fell through to the static Pages site, which has no such path. `worker/wrangler.toml` now declares `azoneofficial.com/api/*` (and `www.`) routes, so `wrangler deploy` attaches them automatically — the manual dashboard step that was missed can no longer be missed

### Added
- `docs/AUTH-SETUP.md` — the complete path from 404 to working Google login: deploy checklist (migrations → secrets → vars → deploy), exact Google Console origin/redirect values, what happens on first login for `@azoneofficial.com` staff vs customers, verification commands, and the www cookie caution

### Notes
- No application code changed. Staff auto-provisioning already worked as designed: company-domain Google logins create active staff accounts (role `marketing`, admin-elevatable); other emails create customer accounts


## [1.4.1] — 2026-07-29 — Shopee Live added to the live showcase

### Added
- **Shopee channel panel** in the homepage live showcase, alongside the TikTok embed. Shows the shop handle (`shopee.com.my/azoneoff`), what a Shopee session includes, and a "Watch on Shopee Live" CTA. `LIVE_SHOWCASE.shopeeLiveUrl` set; leaving it `""` hides the panel and the TikTok embed spans the section
- Section restructured into two equal-height channel panels (`items-stretch` + `h-full`), each carrying its own full-width CTA at the base so the two columns align

### Notes — why Shopee is a card and not an embed
- Shopee sends `X-Frame-Options` / `frame-ancestors` headers that block its shop and live pages from being framed by another site, and publishes no embed or oEmbed API. An `<iframe>` would render blank or refuse to load, so the panel is a branded card that links straight to the shop, where the live badge appears during a session
- TikTok's official creator embed is used on its side because TikTok does publish one — the asymmetry is a platform limitation, not a design choice
- Neither platform exposes a public "live now?" API, so both CTAs are written to read correctly whether or not a session is running. The constraint is documented in `LIVE_SHOWCASE` so it isn't re-litigated later
- Not built in this environment: run `pnpm install && pnpm build` before deploying

## [1.4.0] — 2026-07-29 — Live embed, problems section, ELFIA into Portfolio

### Added
- **TikTok embedded on the homepage.** The live showcase now embeds the official TikTok **creator widget** for @azoneofficialhq — the account with its latest videos, always current, no manual updates. Platform constraint stated in-code: a LIVE stream itself cannot play inside another website (TikTok blocks the /live page in iframes) and no public live-status API exists; the gold "Watch us live on TikTok" CTA carries that job via the self-routing /live URL. `LIVE_SHOWCASE.videoUrl` still overrides the widget with one specific video if ever wanted
- **"The problems we solve, live"** (`components/home/problems.tsx`) — four equal-weight pain→solution cards between About and Services: nobody bought / no team or time / views without conversion / content dies after the stream. Copy in `PROBLEMS` (`constants/content.ts`)
- **Client logo strip in the hero** — "Brands we run live for" with a generated temporary ELFIA serif wordmark (`public/clients/elfia-wordmark.svg`, gold underline accent) linking to elfiaofficialstore.com. Swap the SVG for the official logo when supplied; no code change needed

### Changed
- **Navbar CTA:** "Book a consultation" → **"Get a free live audit"** (`CTA_LABEL`); the matching FAQ answer updated
- **Hero subheadline** no longer names ELFIA in text — the clause "featured client ELFIA, a premium hijab label" is replaced by the logo strip
- **ELFIA folded into Portfolio.** The standalone `/portfolio/elfia` page is removed (301 → `/portfolio`); the ELFIA portfolio card is now clickable and opens **elfiaofficialstore.com**. The "ELFIA" navbar item is removed (nav: About, Services, Packages, Portfolio, Blog, Contact). `/products` legacy redirects retargeted to `/portfolio`. The challenge/approach/result write-up remains available on `/case-studies`
- `PortfolioItem` gained an optional `href`; cards render as external links when set

### Notes
- Not built in this environment: run `pnpm install && pnpm build` before deploying

## [1.3.3] — 2026-07-29 — Live showcase section on the homepage

### Added
- **`components/home/live-showcase.tsx`** — new dark section between the session showcase and the process steps: "See a live session, live". Gold CTA "Watch us live on TikTok" points at `tiktok.com/@azoneofficialhq/live`, which TikTok itself routes to the live room during a session and to the profile otherwise — correct in both states with no status detection. Optional Shopee Live button appears when `LIVE_SHOWCASE.shopeeLiveUrl` is set
- **Process video slot** using TikTok's official video embed (blockquote + embed.js). Configured by `LIVE_SHOWCASE.videoUrl` in `constants/content.ts`; while it is unset (current state) or while the embed is still loading, a styled preview card renders instead — the section never shows a broken player
- `LIVE_SHOWCASE` constant block documenting the platform constraint: TikTok/Shopee LIVE streams cannot be embedded on external sites and there is no public live-status API a static export could poll — the /live URL carries that job

### Action needed
- Set `LIVE_SHOWCASE.videoUrl` to the TikTok video that best shows the AZ ONE process (session highlight / behind-the-scenes); optionally set `shopeeLiveUrl`

### Notes
- Not built in this environment: run `pnpm install && pnpm build` before deploying

## [1.3.2] — 2026-07-29 — ELFIA removed from the landing page

### Changed
- **Homepage no longer carries the ELFIA showcase section** (dark section with slogan and product gallery). A full brand section with product imagery on the agency's own landing page still read as a house line; a prospective client should meet ELFIA as *proof*, not as a product. The homepage now runs Hero → About → Services → Packages → Showcase → Process → FAQ → CTA
- ELFIA remains presented as the existing successful client everywhere it counts: the hero subheadline mention, the "Operators, not observers" trust signal, the FAQ answer, the nav item, /portfolio, /case-studies, and the full case study at `/portfolio/elfia` (which keeps the work gallery — showing client work in a case study is the point)
- **ELFIA's own landing page is elfiaofficialstore.com** — the case-study outbound link and the customer-area "ELFIA drops" card now point there (previously elfia.com.my)
- `components/home/elfia.tsx` deleted (no longer referenced)

### Notes
- `/products` 301s and the `ELFIA` nav → `/portfolio/elfia` routing from v1.3.0 are unchanged
- Not built in this environment: run `pnpm install && pnpm build` before deploying

## [1.3.1] — 2026-07-29 — ESLint build errors fixed

### Fixed
Cloudflare Pages runs ESLint as part of `next build`; 14 rule violations caused the build to fail with exit code 1. All fixes are semantically equivalent — no copy, layout, or logic changed.

- `react/no-unescaped-entities`: apostrophes and quotation marks in JSX text replaced with HTML entities (`&apos;`, `&ldquo;`, `&rdquo;`) in `app/careers/page.tsx`, `app/portal/page.tsx`, `app/portfolio/page.tsx`, `app/privacy/page.tsx`, `app/services/page.tsx`, `app/terms/page.tsx`, `components/home/showcase.tsx`
- `@next/next/no-html-link-for-pages`: `<a href="/">` in `app/login/page.tsx` replaced with `<Link href="/">` (Next.js `next/link`); import added
- `@typescript-eslint/no-unused-vars`: `goTo` function in `components/ui/packages-carousel.tsx` prefixed `_goTo` (dots navigation was dropped in v1.2.22; the function was left in but never called)

## [1.3.0] — 2026-07-29 — ELFIA repositioned as client; catalogue removed

Applied directly on the stable v1.2.29 build. **No layout, section sizing,
spacing, animation, or component structure was touched** — this release is
copy, links, data, and one additive page. (The abandoned v1.4/v1.5 workspace
branch attempted the same repositioning with a repo restructure that broke the
deployed layout; this release supersedes that branch from the v1.2.29 base.)

### Changed — business positioning
- **ELFIA is a client of AZ ONE OFFICIAL, not a product.** The agency needs to pitch brands that compete with its clients (including other hijab labels), so nothing on this site may read as AZ ONE selling hijabs itself
- Site description: "Home of ELFIA, our premium hijab brand" → "Featured client: ELFIA"
- Hero subheadline: "home of ELFIA, our premium hijab brand" → "featured client ELFIA, a premium hijab label" (same length band, no layout shift)
- About copy: "We are also a brand owner ourselves" → operator framing (we built and run the client's channel end to end)
- Trust signal "Brand owners, not just an agency" → "Operators, not observers"
- Homepage ELFIA section: eyebrow "Our house brand" → "Featured client"; body rewritten as a channel we built and run; gold CTA now "View the ELFIA case study" → `/portfolio/elfia`. **Markup, grid, gallery, animation, and sizing are byte-identical**
- FAQ "What is ELFIA?" reframed as a client engagement and featured case study
- `SITE_CONFIG.brand.hijab` → `SITE_CONFIG.featuredClient` (the agency owns no product line)

### Added
- **`/portfolio/elfia`** — featured case study (the brand, challenge, approach, result, the work, CTA), built entirely from existing design-system pieces: `PageShell`, `Button`, `ButtonGroup`, `ElfiaGallery`
- **`PORTFOLIO_ITEMS` and `CASE_STUDIES` populated** with the ELFIA engagement — `/portfolio` and `/case-studies` move from "in preparation" empty states to real client work with **zero changes to their page code**

### Removed
- **`/products` and `/products/[slug]`** — an agency site cannot credibly host a product catalogue in a client's category. All catalogue URLs (including the pre-v1.2.11 slugs, via chained redirects) 301 to `/portfolio/elfia` in `public/_redirects`
- Catalogue routes removed from the sitemap; `/portfolio/elfia` added
- Nav item "ELFIA" now points at `/portfolio/elfia` (label and position unchanged)
- ELFIA gallery centre card links to the case study instead of product pages (same markup); customer-area "ELFIA drops" card now links out to elfia.com.my
- `ELFIA_DROP_STEPS` kept in constants but unused — reserved for hand-off to the standalone ELFIA site

### Notes
- Case study copy is deliberately qualitative; publish figures only with the client's approval
- Not built in this environment: run `pnpm install && pnpm build` before deploying

## [1.2.29] — 2026-07-27

### Changed
- **Footer strapline now centres under the logo.** The logo and "LIVE . CONNECT . GROW." were separate block elements in a left-aligned column, so the strapline aligned to the column's left edge rather than to the mark above it. They're now wrapped in an `inline-block` lockup that shrinks to the logo's width, with the strapline centred inside it — so it sits centred beneath the logo regardless of either element's width. The rest of the footer column (slogan, address, CTA) stays left-aligned as before

## [1.2.28] — 2026-07-27

### Fixed
- **`/about` "Why brands choose us" left a third of the frame empty.** `PageShell` carried a blanket `[&_section>ul]:max-w-3xl` rule, added in v1.2.13 to keep bullet lists readable — but it also caught *card grids*, capping them at 768px inside the 1152px frame. The rule now excludes lists that are themselves layouts (`:not([class*=grid]):not([class*=flex])`), so prose lists stay readable while grids use the full width. Cards go from ~243px to ~355px each. Same fix applies anywhere a grid list sits directly inside a section

### Changed
- **Footer strapline is now clearly subordinate to the logo.** "LIVE . CONNECT . GROW." rendered at `text-xs` with `0.35em` tracking — roughly 256px wide against a logo drawing only ~107px, so the strapline dominated the mark. The logo is now `h-12` (~161px wide) and the strapline `9px` at `0.08em` tracking (~150px), so it sits narrower than the logo above it, matching the lockup used in the OG banner

## [1.2.27] — 2026-07-26

### Fixed
- **Refresh a product page, then press Back → landed on the wrong homepage section.** v1.2.23's scroll memory only restored on in-app `popstate` events. But once a product page has been *reloaded*, the client router cache is gone, so Back becomes a **full document load** (`navigation.type === "back_forward"`), not an in-app navigation — the restore never ran, and the browser's own restoration clamped to a shorter, still-loading document, dropping the visitor at About instead of ELFIA.
  Both halves now handle that case: the inline script takes over restoration on `back_forward` loads *only when a stored offset exists for that path*, and `ScrollMemory` treats a `back_forward` document load the same as a popstate, applying the offset once the page is genuinely tall enough. Control is handed back to the browser (`scrollRestoration = "auto"`) as soon as the restore completes, so ordinary navigation is unaffected
- Layout-settle window widened from ~1s to ~1.5s for slower connections

### Changed
- **Product breadcrumb given a proper position.** It sat inside the main content block below ~96px of top padding, floating in empty space. It now has its own compact strip directly under the navbar, separated by a hairline rule, using a semantic `<ol>` with a chevron separator, `aria-current="page"`, and truncation so long product names don't wrap on mobile. Content padding reduced accordingly (`py-16/24` → `py-12/16`)

## [1.2.26] — 2026-07-26

### Changed
- **ELFIA English strapline** is now *At First Sight. Forever in Your Heart.* (was "Premium hijabs, born live"). It reads as the meaning of the Malay slogan rather than a competing line, so the two are presented as a pair: *Dekat Di Mata, Menarik Di Hati* leads in gold, with the English beneath it. Restyled from uppercase label to italic sentence case, since it's now a sentence, not a tag
- `/products` meta description carries both lines

### Added — ELFIA buying experience
- **"How an ELFIA drop works"** on `/products`: a four-step sequence — drop announced, fabric styled live on camera with comments answered, price revealed in-session, checkout through the pinned link. Buying live is unfamiliar to many shoppers, and not knowing what happens if they show up is what stops them joining a session at all
- **Drop alerts via WhatsApp** — "Get drop alerts on WhatsApp" replaces the generic "Ask about ELFIA" CTA, capturing interest between drops with no email service required
- **Product CTAs now prefill context**: `whatsappUrl()` accepts an optional message, so "Ask about this piece" arrives naming the exact product and asking when the next drop is — the enquiry lands qualified instead of as a bare "hi"

## [1.2.25] — 2026-07-26

### Changed
- **Package carousel progress bar now spans the full width of the section** (was capped at 220px and sharing a row with a counter, so it sat oddly to the left)
- **Counter removed** — the bar alone communicates position
- The bar now reflects the carousel's **actual scroll position and visible fraction** rather than the snapped card index: the thumb's width equals the proportion of the track on screen (75% of the bar when 3 of 4 cards are visible, 25% on mobile where one shows), and it moves continuously while dragging instead of jumping between steps. Recalculated on resize so it stays correct across breakpoints

## [1.2.24] — 2026-07-26

### Fixed
- **Product gallery frame no longer mismatches the photo.** `aspect-[4/5]` set the frame ratio, but the `max-h-[62vh]` added alongside it clamped the frame's *height* while its *width* stayed at the column width. The frame stopped being 4:5 and became landscape, so the portrait photo could not fill it — leaving a band of empty navy beside the image.
  The frame now has a single source of truth: one fixed `aspect-[4/5]` box sized by `max-width` alone (360px mobile / 400px tablet / 420px desktop), with no height cap. Frame ratio and image ratio can no longer diverge, and the gallery is a predictable fixed size at every breakpoint — roughly 48–58% of viewport height across phone, tablet, laptop, and wide desktop
- Main images given explicit `block` + `object-center` alongside `object-cover` so they always fill the frame regardless of intrinsic dimensions
- Audited every other `aspect-[…]` box in the codebase for the same width/height conflict — none found

## [1.2.23] — 2026-07-26

### Fixed
- **Back from an ELFIA product no longer lands at the top of `/products`.** Root cause: the App Router restores scroll from its own cache, but it does so before the returning page has finished laying out — the saved offset is taller than the document at that instant, so the scroll silently clamps to 0. New `components/ui/scroll-memory.tsx` records the offset per path and, on popstate navigations only, retries across animation frames until the document is genuinely tall enough to honour it. Forward navigation still starts at the top, and reload still starts at the top (unchanged inline script)
- **Product gallery was oversized.** The 3:4 main image filled a half-page column, running taller than the viewport on laptops and pushing the price/CTA block below the fold. Now 4:5, capped at `62vh`, with the gallery constrained to 380px (440px at desktop) — roughly half the viewport height on a phone and ~60% on a laptop

### Changed
- **Package carousel affordance replaced.** The "Swipe or drag to see all 4" sentence was instructional and read awkwardly on desktop, where nobody swipes. Replaced with self-evident cues: a right-edge fade that shows only while more cards remain, a progress bar, and a plain "2 of 4" counter. Card width at desktop widened the peek so a sliver of the next tier is always visible
- Carousel track is now keyboard-focusable (`tabIndex={0}` with a descriptive label), since removing the arrows left keyboard users without a way to move it

## [1.2.22] — 2026-07-26

### Added
- **ELFIA brand slogan** — *Dekat Di Mata, Menarik Di Hati* — added as `ELFIA.slogan` and displayed on the homepage ELFIA section and `/products`, leading above the English tagline. Also carried into the "What is ELFIA?" FAQ answer and the `/products` meta description
- **Professional product gallery** (`components/ui/product-gallery.tsx`) on ELFIA product pages: one large main image with a thumbnail strip, swipe on mobile, image counter, neighbour preloading. Replaces the 2-column grid, which showed every angle at once and left none of them large enough to judge fabric drape

### Changed
- **ELFIA aligned as a hijab brand everywhere.** Audited every file: "our premium fashion brand" → "our premium hijab brand" (hero + site description), "premium fashion label" → "premium hijab label" (About copy), `SITE_CONFIG.brand.fashion` → `brand.hijab`, keyword "ELFIA fashion" → "ELFIA hijab", `/about` meta description, and README
- **Package carousel is now scroll-only** — the `< >` arrows are gone. Swipe on touch, and pointer drag-to-scroll on desktop (mice can't swipe, and with no arrows they need a way to move the track), with clickable dots and a "Swipe or drag" hint
- **Button widths fully standardised.** `Button` now renders a real `<button>` when `href` is omitted, so the contact form submit — the last hand-rolled CTA, at `h-11` with no minimum width — uses the shared metrics. Both ELFIA pages' CTA pairs moved to `ButtonGroup` for equal widths. Audit confirms no hand-rolled button-like elements remain on public pages
- **`/about` rebuilt to remove dead space.** It was a single narrow column inside the 6xl frame, leaving the right half empty. Now the story runs left with a "short version" facts panel alongside, "Why brands choose us" is a 3-column grid at desktop, and the closing text link became a proper CTA pair

## [1.2.21] — 2026-07-26

### Changed
- **Package tiers are now a carousel** (`components/ui/packages-carousel.tsx`) on both the homepage and `/packages` — one card at a time on mobile, two on tablet, three on desktop, with arrows and dots. Replaces the four-across grid, which was a long stack on phones and a dense wall on desktop. Built on native scroll-snap rather than the ELFIA coverflow transform: these cards are text, and scaled/partial neighbours would hurt readability. Deliberately not autoplaying — package details need reading time
- The `/packages` comparison matrix is unchanged and still desktop-only

### Fixed
- **Refreshing no longer restores the old scroll position.** Browsers restore scroll on reload, so a refresh mid-page left visitors where they were instead of at the top. A pre-paint script in `app/layout.tsx` now sets `history.scrollRestoration = "manual"` for reloads only, jumps to the top on load, then immediately hands control back to the browser
- **Back navigation still returns you to where you were** — critically, that means tapping an ELFIA product and pressing back lands on the ELFIA section, not the top of the page. `scrollRestoration` is a property of the history *entry*, so leaving it on `"manual"` would have disabled that; it's reset to `"auto"` straight after the reload jump
- URLs with a `#anchor` are left alone, so in-page links (e.g. `#packages`) still work
- Reload jump is instant rather than animated: `html { scroll-behavior: smooth }` was making the correction visibly scroll. A `data-scroll-reset` attribute disables smooth scrolling for that one moment

## [1.2.20] — 2026-07-26

### Changed — information architecture
- **Packages moved to a dedicated `/packages` page.** They were appended to `/services`, which mixed two different questions: "what can you do for me?" (capability) and "what do I get and what does it cost?" (commercial). Separating them means each page answers one question, and a prospect can be sent a direct link to `/packages` from WhatsApp — the primary sales channel
- **`/services` now ends with a short "How we package this" strip** linking to `/packages`, instead of duplicating the tier cards
- **Homepage packages section** now leads to `/packages` ("Compare packages") rather than repeating the detail
- **Navigation**: `Packages` added; `FAQ` moved out of the primary nav to keep it at seven items. FAQ remains reachable from the homepage FAQ section link and is now an explicit footer link
- FAQ content split by intent: homepage shows the five general questions, `/packages` shows the six cost/logistics questions, `/faq` still shows all twelve

### Added
- `PACKAGE_MATRIX` + comparison table on `/packages`: sessions, hours, host, reporting, creative, consultation, on-site, WhatsApp support across all four tiers. Desktop only — the tier cards already carry the same information on mobile, where a five-column table is unusable
- `FaqList` gained an `offset` prop so a page can render a specific slice of the FAQ set
- `/packages` added to the sitemap

## [1.2.19] — 2026-07-26

### Changed
- **Carousel photos are now tappable.** Side cards were `pointer-events: none`, so only the centre image responded. Tapping a side photo now brings it to centre; tapping the centre photo opens its product page (with an `aria-label` and pointer cursor so it reads as interactive). Position dots became real buttons that jump straight to a product, instead of decoration
- **Paired CTAs render at equal width** (`components/ui/button-group.tsx`). `min-w-[180px]` was only a floor, so "Get a free live audit" and "See packages" came out different sizes. `ButtonGroup` lays them out in equal-fraction columns — every button matches the widest in the group. Applied to hero, closing CTA, and the packages section
- **Floating buttons aligned.** The back-to-top button was 44px and the WhatsApp button 48px at the same right offset, so their centres didn't line up; back-to-top is now 48px and both share the same right offset at every breakpoint, with the WhatsApp button exactly one button + 12px gap above
- **Homepage FAQ shortened to 5 questions** with a "See all questions" link to `/faq`. With the six new cost FAQs the list had grown to 12 accordions — a long scroll on a phone for a section near the bottom of the page. `/faq` still shows all 12; `FaqList` takes an optional `limit`
- FAQ accordions now start fully collapsed (the first item was open by default), so the section occupies less of a mobile screen on arrival
- **Homepage testimonials trimmed to 3** of 7, for the same reason

## [1.2.18] — 2026-07-26

### Fixed — credibility (highest priority)
- **Homepage no longer renders "0+ / 0 / 0x".** The About counters animated up from 0 toward placeholder targets (500+ sessions, 12 hosts, 3x GMV) that were never real; on the live site they displayed as zeroes, reading as "an agency with zero experience". `STATISTICS` is now an empty array and `About` falls back to `TRUST_SIGNALS` — SSM registration (202603168673 / JM1046169-H), brand owners via ELFIA, Johor Bahru based team, BM/English hosts. All true on day one, no numbers invented. When real figures exist, repopulate `STATISTICS` and the counters return automatically

### Added
- **Packages published** (`PACKAGES` in `constants/content.ts`, `components/home/packages.tsx`): Starter / Growth / Scale / Enterprise, each with cadence plus hours, live host, reporting, creative, and consultation lines. Shown on the homepage and `/services`. No prices — quotes stay per brand, but visitors can now see scope. ⚠️ Session counts and inclusions are a first draft and need confirming against the real package sheet before launch
- **Floating WhatsApp button** (`components/ui/whatsapp-fab.tsx`), mounted site-wide. Stacks above the back-to-top button and hides over the footer where contact links already exist
- **Six cost/logistics FAQs**: how much, session length and time to results, using your own host, studio, on-site sessions, and whether sales are guaranteed (answered honestly — no guarantee, with what is committed instead)

### Changed
- **Stronger CTAs.** Hero: "Book free consultation" → "Get a free live audit", secondary now "See packages" (anchors to the new section). Closing CTA: single button → "Get a free live audit" + "Book a strategy call", plus an inline "WhatsApp us now" link. `CTA_LABEL` still drives the navbar button

## [1.2.17] — 2026-07-25
### Fixed
- **Carousel autoplay never ran on phones.** The v1.2.16 pause logic was written for desktop input and left the carousel permanently paused on touch devices. Four separate causes:
  1. `touchcancel` was not handled — when the browser converts a touch that starts on the carousel into a page scroll (very common, since the carousel is full-width on mobile) it fires `touchcancel`, not `touchend`, so the pause set in `touchstart` was never cleared
  2. `onMouseEnter` fired from the emulated mouse events touch devices send on tap, while `onMouseLeave` frequently never fired — one tap paused playback for good. Hover pause now applies only to `pointerType === "mouse"`
  3. `onFocusCapture` paused on any focus; Android Chrome focuses the arrow buttons on tap and keeps that focus, so tapping an arrow stopped autoplay permanently. Focus pause now requires `:focus-visible` (keyboard focus), wrapped in a try/catch for browsers without support
  4. Touch pause used the same `paused` flag as hover, so a stuck value from any of the above could not be recovered — swiping now has its own `swiping` state
- Added a 6s watchdog: if paused/swiping somehow persists with no further interaction, playback resumes anyway, so no future event bug can freeze the carousel indefinitely

## [1.2.16] — 2026-07-25
### Added
- **ELFIA carousel autoplay** — advances every 3.5s by default (`autoPlay` / `interval` props on `ElfiaGallery`). Manual arrows, dots, swipe, and keyboard all still work exactly as before and reset the timer on use. Autoplay pauses on hover, on keyboard focus, while swiping, when the browser tab is hidden, and when the carousel is scrolled off screen; it is disabled entirely for `prefers-reduced-motion`. The screen-reader live region switches to `off` during autoplay so it doesn't announce a new product every 3.5s
### Changed
- **Service icons redesigned** for a consistent professional set: 24px grid, 1.5px stroke, round caps, optically centred, geometric — nothing glyph- or emoji-like
  - **TikTok strategy** icon replaced: the target-plus-diagonal-arrow read as a ♂ symbol; it is now concentric rings with a solid centre dot (positioning/targeting, fully symmetric)
  - **Business consultation** changed from a briefcase-with-trend-line to a conversation bubble — the trend line duplicated the bars in the Live commerce management icon
  - Microphone, dashboard, pen nib, and clapperboard redrawn on the same grid with matched proportions
- Icon chips refined to `rounded-xl` at 48px with 22px icons on both the home services section and `/services`, tuned for the lighter 1.5px stroke

## [1.2.15] — 2026-07-25
### Fixed (mobile)
- **iOS input zoom**: contact form fields were `text-sm` (14px); Safari auto-zooms the whole page on focus below 16px. Now `text-base` on mobile, `sm:text-sm` on desktop
- **Footer email overflow**: `admin@azoneofficial.com` (~150px) did not fit the 2-column footer grid on 320–390px screens. Column gap reduced to `gap-6` on mobile, `min-w-0` added, and the address now wraps via `[overflow-wrap:anywhere]`
- **Mobile menu could exceed the viewport** with no way to reach the last items — now `max-h-[calc(100svh-4rem)] overflow-y-auto`
- **ELFIA gallery caption clipped** between ~430px and the `sm` breakpoint (card grew to 400px inside a 420px stage). Stage is now `h-[440px] sm:h-[500px]` and the mobile card caps at `max-w-[260px]`; verified to fit at 320/390/430/600/640/768px
- **Vertical scrolling while swiping the gallery** — added `touch-pan-y` so a vertical drag scrolls the page instead of being captured by the carousel
- **Buttons sat ~16px from overflowing at 320px** — mobile padding reduced to `px-6` (`sm:px-8` unchanged)
- **Back-to-top button** now respects the iOS home indicator via `bottom-[max(1.25rem,env(safe-area-inset-bottom))]`
### Added
- Explicit `viewport` export in `app/layout.tsx`: `viewport-fit=cover` (notched phones) and `theme-color: #1a2946`, so the browser chrome matches the brand on Android/iOS
- `overflow-x: hidden` on `body` as a safety net against stray horizontal scroll (no sticky positioning in use, so no side effects)

## [1.2.14] — 2026-07-25
### Added
- **Back-to-top button** (`components/ui/scroll-to-top.tsx`, mounted site-wide in `app/layout.tsx`) — fades in after ~500px of scroll, hides while the footer is on screen so it never covers footer links, and reappears once the footer scrolls out of view. Footer detection via IntersectionObserver on `#site-footer`; smooth scroll respects `prefers-reduced-motion`; removed from the tab order while hidden
### Changed
- **FAQ**: the accordion was capped at `max-w-3xl` inside the 6xl frame, leaving a large dead area on the right. It now spans the full container width on both the home section and `/faq`; answer text stays capped at `max-w-3xl` for readability
- **Footer spacing tightened**: `py-16` → `py-12`, column gap `12` → `8/10`, CTA `mt-6` → `mt-5`, bottom bar `mt-12` → `mt-10`
- **Footer layout rebalanced**: the brand block and link columns used `md:justify-between`, which pushed them to opposite edges and left a dead centre gap. Now an even 4-column grid (brand spans 2, Explore + Follow us span 2)
- Footer legal links wrap gracefully (`flex-wrap`) instead of overflowing on narrow screens

## [1.2.13] — 2026-07-25
### Changed
- **Page width standardised across the site.** `PageShell` rebuilt on the `/products` frame — `main pt-16` → `mx-auto max-w-6xl px-6 py-16 sm:py-24` → header → content. Every inner page now shares one width and vertical rhythm: /about, /services, /portfolio, /products, /blog (+ posts), /faq, /contact, /careers, /case-studies, /privacy, /terms (was `max-w-3xl` with different top padding)
- Running text is capped at `max-w-3xl` inside the wide frame, so line length stays readable — wide frame, readable measure
- `PageShell` gained `intro` (lead paragraph under the h1) and `dark` (navy background) props; header markup is now identical on every page
- **/faq** rebuilt on `PageShell` — it previously had no page header at all and reused the home section, which double-padded the layout. Accordion extracted to `components/ui/faq-list.tsx` and shared by the home section and the page, so both render identical markup
- **/services**: lead line promoted to `intro`; service cards now a 2-column grid in the wider frame
- **/blog**: post cards now a 2-column grid with equal-height cards; `intro` added
- **/portfolio**: `intro` added
- **/contact**: message form and location map now sit side by side on large screens instead of stacking
- Icon chips standardised to navy + gold (`bg-brand text-gold`) on /services and /about, matching the home services section (were `bg-gold-soft` + black icons)
### Note
- `/products` keeps its bespoke ELFIA header typography; its frame values already match `PageShell` exactly, so the two stay visually in sync

## [1.2.12] — 2026-07-25
### Changed
- `public/og.png` rebuilt from the master OG artwork at exactly 1200×630, alpha flattened onto the cream background (transparency can render as black in some scrapers), no horizontal stretching — 37px of empty cream trimmed from the top so the gold/navy curves stay fully intact
### Diagnosis note
- The small-thumbnail WhatsApp preview was NOT a broken og.png: the live site still runs pre-1.2.9 metadata, which declares both `og.png` and `og-square.png`, and WhatsApp was picking the square — rendering it as a cropped small-thumbnail card. The landscape-only fix from [1.2.9] resolves it and takes effect on deploy.

## [1.2.11] — 2026-07-25
### Changed
- ELFIA product names updated in `constants/content.ts`:
  - "The Signature Shawl — Taupe" → **"The Signature Shawl — Mocha"** (slug `signature-shawl-taupe` → `signature-shawl-mocha`)
  - "The Signature Shawl — Grey" → **"The Signature Shawl — Soft Grey"** (slug `signature-shawl-grey` → `signature-shawl-soft-grey`)
  - "Corporate Series — Blush" → **"Corporate Series — Khaki"** (slug `corporate-blush` → `corporate-khaki`)
  - "The Signature Shawl — Beige" unchanged; Active Hijab and Neutral Collection unchanged
- Alt text and product descriptions reworded to match the new colour names; The Neutral Collection copy now reads "black, mocha, beige, and soft grey"
### Added
- `public/_redirects` — 301s from the three old product URLs to the new slugs, so any link already shared keeps working
### Note
- Image filenames in `/public/elfia/` unchanged (`shawl-taupe.jpg`, `corporate.jpg`, …) — internal references only, not visible to visitors. Swap the photos if the new colours are different fabric, not a rename.

## [1.2.10] — 2026-07-25
### Changed
- Hero: "We sell live" pill badge replaced with the transparent company logo (`/logo.png`, no pill background, h-16/h-20 responsive) — hero now opens logo → "LIVE . CONNECT . GROW." eyebrow → headline, mirroring the OG banner layout. Logo has no tagline baked in, so the eyebrow is kept (no duplication)

## [1.2.9] — 2026-07-25
### Fixed
- WhatsApp link preview inconsistency: openGraph now declares only the landscape `og.png` (1200×630). With both landscape and square variants listed, WhatsApp sometimes picked `og-square.png` and rendered the compact small-thumbnail layout instead of the large banner card. `og-square.png` stays in `/public` (unreferenced) in case it's wanted later.
### Note
- WhatsApp caches previews per exact URL (with/without trailing slash are separate entries) for up to ~30 days — after deploy, re-scrape via Facebook Sharing Debugger and/or share the link once with `?v=2` to force a fresh fetch

## [1.2.8] — 2026-07-25
### Deployed
- azoneofficial.com live — v0.1 under-construction page retired
### Changed
- `/products`: grid replaced by the coverflow gallery; "Explore the range" link list added beneath it (all six detail pages remain one tap away); "Where to buy" CTAs migrated to shared Button

## [1.2.7] — 2026-07-25
### Changed
- Sales document numbering: new format `{TYPE}{YYYYMMDD}-{NN}-AZOO` (e.g. `DO20260725-01-AZOO`) — date-readable, daily sequence (KL time), issuer code. Legacy numbers (`QT202600001`) remain valid, never renumbered. Spec: `DOCUMENT-NUMBERING.md`
### Added
- Migration `0005_doc_numbering_daily.sql` — `doc_counters_daily` table; old `doc_counters` kept untouched
- `DOCUMENT-NUMBERING.md` — format spec, rationale, migration rules, future doc types (OR/CN/PO)
- `FEATURE-SUGGESTIONS.md` — 15 candidate features with sequencing (Live Session module, host commission, ELFIA live-stock, MyInvois e-Invoice readiness, SST, payments/OR, CN, WhatsApp enquiry alerts, D1 backup, 2FA, more)
### Policy
- Docs are append-only for history: version entries are never removed

## [1.2.6] — 2026-07-25
### Changed
- ELFIA gallery: grid replaced by coverflow carousel (`components/ui/elfia-gallery.tsx`) on the home ELFIA section — centre card full size and linked to its detail page, neighbours peek behind, infinite wrap, touch-swipe + keyboard + aria-live, motion-reduce respected, zero dependencies
- Service icons: all six cards now use one professional icon family (`components/ui/service-icons.tsx`, 1.6px stroke, 24px grid) on navy chips with gold strokes (was mixed lucide icons on gold-soft chips)
- Buttons standardised via `components/ui/button.tsx` (h-12, rounded-lg, min-w-[180px] on ≥sm, full-width stacked on mobile) — migrated hero, home CTA, ELFIA, /products, product detail, and contact page (which was drifting with rounded-full)
### Added
- `REVIEW.md` — improvement suggestions for client site, staff portal, customer area, with priority order

## [1.2.5] — 2026-07-24
### Added
- Official brand tagline "Live . Connect . Grow." — in constants/site.ts as SITE_CONFIG.brandTagline, displayed as gold uppercase eyebrow above the hero headline and beneath the footer logo; used in OG image alt text
- OG share images replaced with the official corporate design (cream + navy + gold curves) — landscape 1200×630 (public/og.png) and square 1080×1080 for WhatsApp (public/og-square.png)
### Note
- The descriptive tagline "Malaysia's Premium Live Commerce Agency" remains as the primary SEO/meta description; the brand tagline is used for identity moments (hero eyebrow, footer, share preview)

## [1.2.4] — 2026-07-24
### Changed
- /login: mode switcher moved to a persistent top-of-form Sign in / Create account tab pair (was a text link buried under the submit button). Both modes visible from arrival — clearer wayfinding, no more "New here?" line

## [1.2.3] — 2026-07-24
### Added
- `public/og.png` (1200×630) redesigned — logo enlarged, cleaner corporate layout, navy tagline, gold accent band
- `public/og-square.png` (1080×1080) new — square variant for WhatsApp centre-crop on mobile chat lists
- `MILESTONES.md` — comprehensive milestone log recording every version, asset, and decision from inception
- After deploy: use Facebook Sharing Debugger or WhatsApp's link cache reset (add ?v=2 once) to force social platforms to re-fetch

## [1.2.2] — 2026-07-24
### Changed
- Configuration discipline: no credentials or IDs in source. `wrangler.toml` now lists only variable names with instructions; all values (including GOOGLE_CLIENT_ID as a plaintext variable) live in the Cloudflare dashboard or as secrets. Added `.dev.vars.example` for local dev; `.dev.vars` is git-ignored.

## [1.2.1] — 2026-07-24
### Fixed
- Login/register error handling: 400s now show the API's real reason (was hidden as a misleading "password needs 10+ characters" for every failure); network/route-missing errors now say so plainly, so users can tell "not deployed yet" apart from "check your input"
- Password minimum harmonised to 10 characters everywhere (setup was inconsistently 12)
### Added
- Show/hide password eye toggle on login/register + live character counter with progress feedback (X of 10 — Y more needed) when registering
- Live length feedback on the admin Create User form

## [1.2.0] — 2026-07-24 — Security audit & hardening
### Added
- One-time super admin bootstrap: POST /auth/setup guarded by SETUP_TOKEN secret + timing-safe compare; self-disables once a super admin exists (no hardcoded credentials anywhere)
- Static security headers (public/_headers): nosniff, X-Frame-Options DENY, strict referrer, permissions policy
### Security
- Sessions stored as SHA-256 hashes (leak-resistant) with opportunistic expiry purge
- /account/enquiries: unverified accounts limited to post-registration enquiries (email-squatting history leak closed)
- R2 `private/` prefix requires staff auth
Full audit report in SECURITY.md.

## [1.1.1] — 2026-07-24
### Changed
- Official social handles confirmed and applied site-wide: TikTok/Instagram/Facebook → @azoneofficialhq (footer, contact page, ELFIA "Watch the next drop live" buttons)

## [1.1.0] — 2026-07-24 — General login & role-routed access
### Added
- General /login (one door for everyone) with role-based routing after sign-in: customer → /account, staff-only roles → /portal, CMS roles → /admin; Google callback routes the same way
- Customer role (migration 0004) + /account page: own details and enquiry history (matched by email); GET /api/v1/account/enquiries
- Public registration now creates an ACTIVE customer account and signs the person in immediately (safe: customers see only their own data; staff/admin roles are assigned only by super admins)
### Changed
- Navbar/footer point to /login; /admin and /portal redirect unauthenticated visitors to /login and customers to /account; customers blocked from all /staff API routes
### Removed
- Pending-approval registration flow (replaced by customer accounts); embedded login screen inside /admin

## [1.0.0] — 2026-07-24 — Staff Portal (BMS) v1
### Added
- Migration 0003: full BMS schema — expanded 10-role users (+staff profile fields), attendance, leave (+balances), announcements (+acks), tasks (+comments), customers, sales_documents with per-year auto numbering (QT/DO/INV 202600001), notifications
- Staff API (`/api/v1/staff/*`, worker/src/staff.ts) with module-level RBAC: profile, staff directory (HR), attendance clock in/out/break (IP+device captured) + monthly history + team report, leave apply/cancel/approve/reject with notifications and balance tracking, announcements + acknowledgements, tasks assign/progress/comments, CRM customers, QT/DO/INV creation with auto numbering + delivery/payment status, in-app notifications
- Staff Portal UI at /portal (noindexed, robots-blocked): personalized dashboard (quick actions clock in/out, pending leave, tasks, announcements), Attendance, Leave (balances, apply, approvals), Tasks, Announcements, Sales (customers + document builder with live RM total), Profile; notification bell; light/dark mode
### Security
- New roles ranked into existing CMS RBAC (live_host lowest — no CMS/finance/admin access); all staff routes require auth; every mutating action audited

## [0.9.0] — 2026-07-24
### Added
- No-code content editing is live end-to-end: public `/content-public` endpoint (60s cache) + `<Editable>` component; hero headline/subheadline, About paragraphs, CTA heading, footer slogan, and Contact intro now read D1 overrides with static fallback
- Visitor analytics: Cloudflare Web Analytics beacon, token-gated in `constants/site.ts` (inert until token set)

## [0.8.0] — 2026-07-24
### Changed — UI/UX redesign pass (premium corporate principles)
- WCAG 2.1 AA contrast: new deep-gold token (#7D6027, 5.0:1) for accent text on light backgrounds; footer text raised from 40% to 60% white; navy focus-visible outlines site-wide
- Consistent radius system: pill buttons replaced with 8px-radius buttons; cards on the same scale; only true dots remain circular
- 8px spacing grid: all section/page paddings normalized to multiples of 8
- Subtle shadows only (shadow-sm on hover)
- Every page ends with a clear next step: About and FAQ pages gained consultation CTAs

## [0.7.0] — 2026-07-24
### Added
- Google OAuth sign-in for /admin (state-cookie CSRF protection, verified-email requirement); company-domain Google accounts auto-activate
- Self-registration on /admin (rate-limited): any valid email, created pending until super-admin approval
- Login screen: Continue with Google, register mode, pending/oauth notices
### Changed
- Contact email: hello@ → admin@azoneofficial.com

## [0.6.0] — 2026-07-24
### Added
- User management: API (super_admin only — create, role change, activate/deactivate with session revocation, password reset) + admin Users tab
- Admin Media tab: upload to R2, image previews, copy-URL, delete
- Admin Content tab: key-value site content editor (dot-notation keys, JSON or text values)
- Dashboard: posts/testimonials counts + recent-activity feed from audit log
- ELFIA individual product pages (/products/[slug]) with descriptions, galleries (grey shawl: 4 angles), "price announced live" panel, cross-links; added to sitemap
- Public D1 reads: /portfolio and homepage testimonials render published D1 items at runtime with graceful static fallback
### Changed
- Product cards on homepage and /products now link to detail pages

## [0.5.0] — 2026-07-24
### Added
- Rate limiting (D1 fixed-window): login 10/15min, enquiries 5/hour per IP (migration 0002)
- Full CRUD API: products, posts, portfolio, testimonials (editor+ write, admin+ delete, public reads filtered to published/visible)
- Site content API: GET public, PUT editor+ (upsert with audit)
- Media API: R2 upload (editor+), public cached serving, delete
- Contact form on /contact posting to /api/v1/enquiries with WhatsApp fallback on failure
- Admin UI at /admin (noindexed): login, dashboard, enquiry management with status workflow, CRUD panels for products/posts/portfolio/testimonials
### Security
- /admin disallowed in robots.txt and noindexed; all admin API writes audited

## [0.4.0] — 2026-07-24
### Added
- ELFIA product photos (9, web-optimized) wired into homepage + /products; brand copy corrected to premium chiffon hijabs/shawls
- Phase 3 architecture DECIDED: static site + separate admin/API Worker (`/worker`)
- Worker scaffold: wrangler.toml with real D1/R2 bindings, migration 0001 (full schema), API v0 — auth (PBKDF2 sessions), public enquiries endpoint, enquiry management, dashboard summary, audit logging
### Security
- PBKDF2-SHA256 310k iterations + pepper (argon2 deviation documented in SECURITY.md); origin checks on mutations; HttpOnly/Secure/SameSite cookies

## [0.3.0] — 2026-07-24
### Added
- Full public website (Phase 2): `/about`, `/services`, `/portfolio`, `/case-studies`, `/products` (ELFIA), `/blog` (+2 starter posts), `/careers`, `/faq`, `/contact`, `/privacy`, `/terms`
- SEO: sitemap.xml, robots.txt, JSON-LD Organization schema, Open Graph + Twitter card images
- Brand assets: OG share image (`public/og.png`), favicon/app icon
- Mandatory documentation set (this file and 11 siblings)
### Changed
- Navigation switched from homepage anchors to dedicated pages
- Footer: legal links, Case Studies, Careers added

## [0.2.0] — 2026-07-24
### Added
- Full landing page: Hero, About + stats, Services, Showcase, ELFIA, Process, FAQ, CTA, Navbar, Footer
- Real contact data from Master Project Prompt: WhatsApp +60 12-383 4821, official slogan, Setia Tropika address
- Services aligned to master list (6 services)
### Changed
- Hero copy per master prompt ("Grow your sales through live commerce")

## [0.1.0] — baseline
- Next.js 15 scaffold with design tokens, coming-soon page, Cloudflare static deploy
