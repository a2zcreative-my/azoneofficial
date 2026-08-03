# Changelog

All notable changes to the AZ ONE OFFICIAL platform.

## [1.4.143] — 2026-08-03 — Tab order revised · attendance headers aligned over the chips

### Changed
- **Tab order** revised to the CEO's new sequence — **Overview moves up to second place**, right after Dashboard: Dashboard → Overview → News → HR → Staff → Attendance → Leave → Tasks → Claims → Payroll → Expenses → Sales → Inventory → Birthdays → Profile → Users. Desktop pills, mobile bottom nav, and the More sheet all follow (they share one list)
- **Attendance column headers aligned:** the IN and OUT headers sat a chip-padding to the left of the actual times (the time chips carry their own internal padding). Both headers are now indented to sit exactly over the chip text, so DATE/IN/OUT/HOURS all read flush with their column content

### Deploy
- `pnpm build` → hard refresh only


## [1.4.142] — 2026-08-03 — Branded confirmation dialog replaces the browser popup

### Changed (per the CEO: "make this form standardize with my other card popup box. I dont like this type")
- The grey native browser `confirm()` box is gone from the portal. In its place: a **branded confirmation card** in the same visual family as the clock-in/save popups — card surface, rounded corners, gold accent bar, pop-in animation, dimmed backdrop, proper Cancel (ghost) and Confirm (navy) buttons. Tapping the backdrop cancels; the confirm button takes focus for Enter-key flow
- Applied to both portal confirmations:
  - **CEO chain-override approve** — "Approve past the incomplete chain?" with the audit-log note and an explicit "Approve as CEO" button
  - **Delete claim** — danger styling (red confirm button), stating the amount and that the receipt is removed too
- New shared component `components/ui/confirm-dialog.tsx` (`useConfirm()` hook, promise-based like the toasts) — any future confirmation uses the same card. The one remaining native confirm (admin Suspend, inside /admin) rides with the already-deferred /admin toast sweep

### Deploy
- `pnpm build` → hard refresh only


## [1.4.141] — 2026-08-03 — App-style profile avatar in the portal header

### Added (per the CEO's request: badge photo beside the welcome, nice on web and mobile)
- The staff member's **badge-card photo** now renders as a circular, gold-ringed **avatar in the portal header** — sized like a native app profile chip (40px, 44px on desktop):
  - **Desktop:** avatar sits beside "STAFF PORTAL / Welcome, {name}"
  - **Mobile:** avatar sits beside the screen title in the sticky app-style header — the same placement messaging apps use, so it reads instantly as "my profile"
  - **No photo yet?** A branded fallback: the person's initial in a navy circle with the same gold ring, so the header never looks broken while HR hasn't uploaded a photo
- Plumbing: the session lookup now carries `photo_key`, so `/auth/me` gives the header what it needs; the image itself serves through the existing authenticated media route (staff-only for private/ keys) — no new endpoints, no extra requests beyond one cached image

### Deploy
- `npx wrangler deploy` → `pnpm build` → hard refresh. No migration


## [1.4.140] — 2026-08-03 — Attendance: "still in" styled as a chip

### Fixed
- "still in" no longer sits as plain outline text next to the styled time chips — it's now a **blue pill badge**, matching the visual language of the IN (green) and OUT (grey) time chips; "missing" likewise becomes an **amber pill**. The whole attendance row now reads as one consistent set of badges

### Deploy
- `pnpm build` → hard refresh only


## [1.4.139] — 2026-08-03 — Subheads completed across the remaining tabs · rows aligned

### Changed
- The v1.4.135 subhead pattern now covers the tabs it had missed:
  - **Leave — Apply for leave:** Leave type, Start date, End date, Days (0.5 = half day), Reason
  - **Tasks — Create a task:** Title, Description, Assign to (managers), Priority, Deadline
  - **Sales — Add customer:** Company *, Contact person, Phone, Email
  - **Inventory — add item:** SKU (placeholder now reminds "must match TikTok"), Item name, Opening stock, Price/unit (RM)
  - **Postage tracking:** Order reference, Courier, Tracking no.
  - **Marketing materials:** Material needed
- **Alignment fixed:** mixed-height rows (e.g. the Inventory add row where the Add-item button sat beside label-less boxes) use bottom alignment, so buttons and inputs line up under their subheads instead of floating mid-row. Placeholders across these forms now show examples/formats (e.g. J&T, Pos Laju · MY123456789 · +60 12-345 6789) rather than repeating the label

### Deploy
- `pnpm build` → hard refresh only


## [1.4.138] — 2026-08-03 — High-resolution signature scans installed

### Changed (assets)
- The CCO, HR Admin, and Sales & Marketing signatures are replaced with the **high-resolution scans** the CEO provided (591×389 / 737×399 / 737×460 after background removal and ink-trimming — versus the ~150px first versions), matching the CEO/COO source quality. Same processing pipeline: near-white → transparent, trimmed to ink
- No code changes — the standardized 46px signature box from v1.4.137 now simply renders from crisp sources, so all five signatures print sharp and equally weighted on the claim form and the Leave Application Form

### Deploy
- `pnpm build` → hard refresh


## [1.4.137] — 2026-08-03 — Signatures standardized · staff signatures on the Employee cell

### Fixed (per the CEO's printout)
- **All printed signatures now occupy the same standardized box** (46px tall, up to 150px wide, ink fitted left) — the CCO's signature no longer prints tiny next to the CEO's. Every signature source is also **trimmed to its ink** (transparent borders removed), so the five files render at comparable visual weight regardless of how each was scanned. Applied to the claim form and the Leave Application Form alike

### Changed — Employee cell uses the staff member's real signature
- When the claimant's/applicant's **role has an uploaded signature** (CEO, COO, CCO, HR Admin, Sales & Marketing), the Employee cell prints **that signature** with the "(submitted in system)" note — Nursyazwani's forms will carry the HR Admin stamp-signature rather than the script-font e-signature. Roles without an uploaded signature (editor, marketing, live host) keep the script e-signature fallback

### Deploy
- `pnpm build` → hard refresh only


## [1.4.136] — 2026-08-03 — Official signatures installed: CCO, HR Admin, Sales & Marketing

### Added (assets)
- The three uploaded company-stamped signatures are processed (near-white background made transparent, matching the CEO/COO treatment) and installed:
  - `public/signatures/cco-sign.png` — **live immediately**: the CCO's pre-approval signature now prints on claim forms and Leave Application Forms wherever the CCO pre-approved (the code has referenced this path since v1.4.133/134 with a graceful fallback — the file's arrival completes it)
  - `public/signatures/hr-admin-sign.png` and `public/signatures/sales-marketing-sign.png` — stored ready under the same naming scheme, not yet wired to any printed document (the claim/leave forms have no HR signature cell, and sales documents currently carry CEO/COO authority only)

### Deploy
- `pnpm build` → hard refresh (static assets ship with the build)


## [1.4.135] — 2026-08-03 — Subheads above every placeholder field

### Changed
- **Placeholder-only inputs now carry a small subhead label above the box**, so the field's purpose stays visible after typing (a placeholder disappears the moment text is entered — that's why forms felt confusing once half-filled). Placeholders now show the FORMAT or an example instead of repeating the label. Applied to:
  - **Add a staff member** (Staff tab): all 14 fields labeled — Company email, Full name (as per NRIC), Role, Employee ID, Position, Department, Birth date, ID issued on, Blood type, NRIC, Bank, Bank account no., Temp password, Staff photo — with example placeholders (e.g. AZOOM001, 970209-01-5183, DD-MM-YYYY)
  - **Record expense** (Expenses tab): Expense date, Category, Amount (RM), Vendor, Description
  - **Submit a claim**: Purpose gains its subhead (item fields already carry labels — the column header row on desktop, per-field labels on mobile since v1.4.132)
- One shared visual: 11px muted label, half-line gap, above the control — consistent across the portal

### Deploy
- `pnpm build` → hard refresh only


## [1.4.134] — 2026-08-03 — Attendance "still in" vs "missing" · printable Leave Application Form

### Fixed (My attendance)
- The Out column no longer lumps everything into "still in / missing": with a clock-in and no clock-out it reads **"still in"** (normal mid-day state); **"missing"** (amber) shows only when there is genuinely **no clock-in data** for the day

### Added — Leave Application Form (AZOO-HR-LVE-001)
- Every leave request now has a **"Print form"** link producing a branded A4 form in the same layout language as the claim form, driven by the same chain flow leave already follows (HR review → COO/CCO pre-approve → CEO final):
  - Header: Document No **AZOO-HR-LVE-001**, Leave No **LVE-AZOO{DDMMYY}-{running no.}**, submission date/time in **MYT**, employee, department, position, leave type, period, days, reason
  - **System status** line (approved green / rejected red / pending with the current stage) plus the chain notes ("HR reviewed by … · Pre-approved by …", MYT-stamped)
  - **Three signature cells, same rules as claims:** Employee auto-filled (name, e-signature "(submitted in system)", submission date), pre-approver's full name + signature (COO's PNG; CCO's once `cco-sign.png` is uploaded) + pre-approval date, CEO full name + signature + date on final approval — all aligned on the shared baselines, footer pinned to the A4 bottom, one page
- Server: the leave list now carries the chain actors' identities and a per-day sequence for the numbering

### Deploy
- `npx wrangler deploy` → `pnpm build` → hard refresh. No migration


## [1.4.133] — 2026-08-03 — Claim delete · new categories · all three signature cells filled · CCO receipt access fixed

### Added
- **Delete on invalid claims:** the claimant can delete their own claim while it's **pending or rejected** ("Delete" with a confirm dialog; the receipt file is removed too, audited `claim.delete`). Approved/paid claims are permanent records — the server refuses their deletion outright
- **Claim categories:** += **client meeting** and **stationery**
- **Employee cell now fills itself:** Name, an e-signature (the claimant's name in script with *"(submitted in system)"*), and Date = the submission date/time in MYT — the printed form no longer has an empty employee block for a claim the system itself recorded
- **COO/CCO pre-approval cell fills on pre-approval:** the pre-approver's **full name** (uppercase), their **signature** (COO's PNG; CCO's loads from /signatures/cco-sign.png once you upload it — hidden gracefully until then), and the **pre-approval date/time in MYT**. Pending-chain claims keep the blank manual cell

### Fixed
- **The raw `{"error":"forbidden","message":"Not your claim"}` page** (Izzudin/CCO opening a receipt link): receipt visibility now mirrors claim-list visibility — anyone who can see the claim in their list (chain reviewers included: HR for staff-chain, COO for staff-chain, CCO for HR's claims) can open its receipt, instead of only claimant + CEO + HR

### Deploy
- `npx wrangler deploy` → `pnpm build` → hard refresh. No migration. Optional: upload CCO signature PNG to `public/signatures/cco-sign.png` (transparent, like the CEO/COO ones) for the CCO's pre-approval signature to print


## [1.4.132] — 2026-08-03 — Claims tab: proper mobile "app" layout

### Fixed
- On phones the claim form used the same fixed five-column grid as desktop — the Description box crushed to a sliver and nothing fit, unlike the other tabs' app-style layouts. Each claim item now **stacks on mobile** inside a light card: **Date and Category side by side, Description full width, Amount below**, each with its own small label (the desktop column-header row hides on mobile since the fields label themselves), and "✕ Remove" as a proper labeled control. From tablet width up, the original five-column grid returns unchanged
- The **Attach receipt** and **Submit claim** buttons go full-width on mobile, matching the app feel of the rest of the portal

### Deploy
- `pnpm build` → hard refresh only


## [1.4.131] — 2026-08-03 — One-click server-side repair: 🔧 Fix discrepancy now

### What the identical screenshot proved
- The Breakdown was **byte-for-byte the same** as before the last fixes — same RM 5,458.98, every row still "recomputed ⚠", same three stale amounts. The server data hadn't changed at all, which means the fix chain (migration 0041 → worker deploy → build → Save all) **hasn't completed on production**. The code fixes are correct but were never given a chance to run

### The solution — stop depending on the sequence
- **New: `POST /payroll/recompute`** — a server-side repair that recomputes the month's working days **directly from the holiday calendar** (Mon–Fri minus weekday holidays) and re-derives + **stores** every entry's `month_working_days` and `net_cents` using the shared formula. No browser state, no Save all, no fingerprints — the database fixes itself in one call. Audited (`payroll.recompute`)
- **Two buttons trigger it:** "🔧 Fix discrepancy now (recompute on server)" right inside the Expenses Breakdown (where the problem shows), and "🔧 Recompute nets" in Payroll processing next to Re-fill days
- If migration 0041 isn't applied, the button says so explicitly ("Migration 0041 is not applied — run: npx wrangler d1 migrations apply azoneofficial --remote, then press this button again") instead of failing quietly

### The single remaining sequence
1. `npx wrangler d1 migrations apply azoneofficial --remote` (0040 + 0041)
2. `npx wrangler deploy` → `pnpm build` → hard refresh
3. Open Expenses → Breakdown → press **🔧 Fix discrepancy now** → the toast reports "Recomputed 6 entries at 23 working days" → figure becomes RM 5,345.54, all ⚠ markers gone, matching the Payroll tab exactly

### Deploy
- Migrations **0040 + 0041** → `npx wrangler deploy` → `pnpm build` → hard refresh → press the 🔧 button


## [1.4.130] — 2026-08-03 — Claim form repaired: the broken signature table

### Fixed (my v1.4.127 regression, reversed properly)
- v1.4.127 put `display: flex` **directly on the signature table's `<td>` cells** — which strips their table-cell behaviour, so the three columns collapsed into the stacked narrow mess in the CEO's printout, and the extra height pushed the receipt and footer onto page 2
- The `<td>`s are table cells again; the alignment flex now lives on an **inner wrapper div** inside each cell (`.cw`), which is where it always belonged. The intended v1.4.127 result now actually renders: three equal columns side by side, Name/Signature/Date on shared baselines, CEO signature + MYT date in place, everything — receipt and footer included — back on **one A4 page**
- Rule added to the standing lessons: never set flex/grid display on `<td>`/`<tr>` — wrap the content instead

### Deploy
- `pnpm build` → hard refresh only


## [1.4.129] — 2026-08-02 — P&L payroll column = NET payroll

### Changed
- The P&L's Payroll column previously used the **entry totals** (basic + commission + allowance + OT − manual deduction, WITHOUT the unpaid-leave and incomplete-month deductions) — which is why August showed RM 13,997.72 while the real net was RM 5,345.54. Per the CEO: confusing, gone
- The column is now **"Net payroll"** and pulls the **same figure as the Expenses card**: stored per-entry nets (net_cents from migration 0041; formula fallback for older rows), same staff scope, same cash-basis month attribution (month m−1's cycle paid in m). **P&L, Expenses, and the Payroll tab total now quote one number**
- Caption updated accordingly; failures degrade and log (`pnl_payroll`) rather than blanking the card

### Deploy
- `npx wrangler deploy` → `pnpm build` → hard refresh. No migration (0041 assumed applied)


## [1.4.128] — 2026-08-02 — THE tally bug, found by the Breakdown: Save all skipped calendar-affected rows

### Root cause (proven by the CEO's Breakdown screenshot)
- The Breakdown showed all six staff names — **no ghost entry** — but three rows (Izzudin RM 895.45, Nursyazwani RM 954.55, Zulsyam RM 859.09) differed from the Payroll tab by **exactly the 22-vs-23 working-days delta**: their saved rows still carried 22 days from before the Hari Hol correction
- Why Save all didn't fix them: the **no-change fingerprint didn't include the month's working days**. Rows the CEO hadn't otherwise edited (unlike Zolkefli's allowance and Nasuha's OT, which re-saved at 23) fingerprinted as "unchanged", so **Save all skipped them** — permanently preserving the stale 22, which only Expenses (reading saved data) revealed

### Fixed
- The fingerprint now includes the month's working days, and the pristine snapshot anchors on each row's **saved** month_working_days — so any holiday-calendar change marks every affected row dirty and **Save all re-saves all of them** (storing the corrected net_cents too). Full-month rows (no days entered) are mirrored correctly and don't false-flag

### After deploying
- Payroll 07-2026 → **Save all** → expect "6 entries saved" → Expenses payroll line reads **RM 5,345.54**, Breakdown shows all rows without ⚠, matching the tab line by line

### Deploy
- `pnpm build` → hard refresh → Payroll: **Save all** (migrations 0040+0041 + worker deploy assumed from v1.4.124/126)


## [1.4.127] — 2026-08-02 — Claim form: aligned signature grid · every printed time in Malaysia time

### Fixed
- **Malaysia time everywhere on the form.** Timestamps are stored in UTC in the database, and the form printed them raw — so an approval at 22:45 Malaysia time printed as "14:45". Every printed timestamp now converts to **MYT (+8)** and says so: the header Date, the "APPROVED IN SYSTEM … on DD-MM-YYYY HH:MM MYT" status line, and the CEO's Date under the signature. The system already detected Malaysia time internally (attendance, payroll cutoffs, audit views all shift +8) — the claim form printout was the gap, now closed
- **Signature columns aligned.** Each of the three cells now uses the same fixed internal grid: a name zone (sized for two-line names like MOHD ALIF FARHAN BIN NAZARUDIN), an identical signature zone (the CEO's PNG sits inside it without pushing anything), and **Date pinned to the same baseline in all three cells** — flex with margin-top:auto, per the house rule. Name, Signature and Date now line up straight across the row regardless of name length or signature presence

### Deploy
- `pnpm build` → hard refresh only


## [1.4.126] — 2026-08-02 — Payroll figure breakdown: mismatches now name themselves

### Added
- The Expenses "Staff payroll" line gains an expandable **Breakdown** — every saved entry the figure is built from, with the person's name and their saved net. Comparing it against the Payroll tab makes any mismatch self-diagnosing:
  - a **name in the breakdown that isn't in the Payroll tab** = a ghost entry (test account / out-of-scope user) inflating the figure
  - a **different amount** than the tab shows = that row hasn't been re-saved since editing
  - a **"recomputed ⚠" marker** = the row was saved before the net-storing update (v1.4.124) — the server recomputed it; press Save all to store the exact net

### Reminder — the tally sequence (v1.4.124 must be live first)
The two figures only converge after ALL of: migration **0041** applied remotely → `wrangler deploy` → `pnpm build` + hard refresh → **Payroll 07-2026: Save all**. The Payroll tab shows live on-screen values (e.g. the new RM 75 allowance and 1.5h OT); Expenses reads what was last SAVED — until Save all runs on the new build, they cannot match by design

### Deploy
- Migration **0041** (with 0040) → `npx wrangler deploy` → `pnpm build` → hard refresh → Payroll: **Save all** → check the Breakdown


## [1.4.125] — 2026-08-02 — Claim form: CEO full name + signature on approval · no CUT HERE · footer at page bottom

### Changed (printed claim form)
- **CEO cell uses the FULL name** (uppercase, matching the Employee cell) — from the deciding CEO's user record, no longer the short display name
- **CEO signature auto-inserts once approved:** on approved claims the CEO's official signature PNG prints in the Signature space, and **Date fills with the decision date** — matching the QT/DO/INV signing convention. Pending/rejected forms keep the blank signing space
- **✂ CUT HERE removed** — the receipt box now sits directly below the signatures
- **Footer pinned to the bottom of the A4 page** via the flex margin-top:auto pattern (the house rule — never absolute positioning), so the company/SSM line always sits at the true page bottom regardless of how many claim rows the form has

### Deploy
- `npx wrangler deploy` → `pnpm build` → hard refresh. No migration


## [1.4.124] — 2026-08-02 — Expenses payroll figure now tallies with the Payroll tab (migration **0041**)

### Root cause of the discrepancy (full-file check done)
The Expenses card and the Payroll tab used the **same formula but different scope and different data freshness**:
1. **Scope:** `/expenses` summed EVERY saved payroll entry for the month — including entries belonging to users the Payroll tab doesn't list (disabled accounts, customer/super_admin roles, staff outside their employment window). Any such row silently inflated the Expenses figure
2. **Freshness:** the Payroll tab computes live from what's on screen; `/expenses` reads what was last SAVED — edits (e.g. the 22 → 23 working-days correction) diverge the two until Save all

### Fixed — single source of truth
- **Migration 0041:** `payroll_entries.net_cents` — the panel now computes each net once (the one shared formula) and **saves it with the entry**; `/expenses` **sums the stored nets** instead of re-deriving them. After Save all, the two figures are identical by construction
- `/expenses` now applies the **same staff scope as the Payroll tab**: active users only, no customer/super_admin, employment lifecycle window applied — out-of-scope entries can no longer leak into the total (rows saved before 0041 still fall back to the formula, same scope)
- The Payments-due line now says where its number comes from: *"sum of SAVED payslip nets — after any change in the Payroll tab, press Save all there so this figure matches"*

### Deploy
- `npx wrangler d1 migrations apply azoneofficial --remote` (**0041**, with 0040 if not yet) → `npx wrangler deploy` → `pnpm build` → hard refresh → **Payroll 07-2026: Re-fill days → Save all** (stores the nets; the Expenses figure then equals the tab total exactly)


## [1.4.123] — 2026-08-02 — HR compilation card: Receipt link removed

### Changed
- The **"Receipt" link is removed** from HR's "Approved claims history — compilation" card — the claimant submits the **original physical receipt** to HR, so a digital printout isn't part of the compilation. Each row keeps exactly what HR files: **Print claim form** (which still includes the receipt image in its box, for cross-checking against the original) and **Payment proof** (the CEO's bank slip)
- Server-side read access is unchanged — the printed claim form embeds the receipt image, so the form keeps printing complete

### Deploy
- `pnpm build` → hard refresh only


## [1.4.122] — 2026-08-02 — Hari Hol not observed in July (migration **0040**) · payroll description corrected

### Fixed (avoids over-paying July's prorated slips)
- **Migration 0040 removes Hari Hol Almarhum Sultan Iskandar (21-07-2026) from the holiday calendar** — per the CEO, the team did NOT take it (most staff's first reporting day was 20-07); it will be replaced in August instead. July 2026 therefore counts **23 working days**, which makes every incomplete-month deduction slightly larger and correct (e.g. worked 5 of 23 instead of 5 of 22 — leaving it at 22 would over-pay all six prorated slips)
- **After applying, in Payroll processing: confirm the auto box shows 23 → press "Re-fill days" → "Save all"** — saved entries carry their own month_working_days, so they must be re-saved to pick up 23 before the 05-08-2026 payment run. Payslips then read "WORKED X OF 23 PAYABLE DAYS"
- **The August replacement:** when the replacement date is decided, add it in the HR holiday calendar (e.g. "Hari Hol — replacement day") — August's working-day count drops by one automatically, and if August payroll was already filled, Re-fill days + Save all there too

### Changed
- The Payroll processing description no longer hardcodes "July 2026 = 22". It now explains the rule generally — including exactly this case: an unobserved holiday must be deleted from its month (making that day count as working) and added on the actual replacement date, followed by Re-fill days + Save all so no slip keeps stale figures

### Deploy
- `npx wrangler d1 migrations apply azoneofficial --remote` (**0040**) → `npx wrangler deploy` → `pnpm build` → hard refresh → Payroll: Re-fill days + Save all for 07-2026


## [1.4.121] — 2026-08-02 — HR's read-only approved-claims history for compilation

### Added
- **hr_admin now sees every CEO-approved claim** (including paid ones) in a dedicated card: **"Approved claims history — compilation"**. Strictly read-only — no edit, no approve/reject, no mark-paid, no attach — with exactly what HR needs for records: the claim number (CLM-AZOO…), claimant, amount, a **PAID {date}** or **payment due** chip, and three links per row: **Print claim form**, **Receipt**, and **Payment proof** (the CEO's bank slip)
- Server-side, the access is scoped precisely: HR's claim list gains approved claims only (pending/rejected claims of the exec chain remain invisible to HR as before); the receipt file is readable by HR **only for approved claims**; the payout proof is readable by HR (its existence already implies paid). All writes remain locked to the existing roles — claimant for receipts, CEO for decisions/payment/proof
- HR's own "My claims" list stays personal (their claims + their review queue) — the history lives in its own card so the compilation view never mixes with day-to-day work

### Deploy
- `npx wrangler deploy` → `pnpm build` → hard refresh. No migration


## [1.4.120] — 2026-08-02 — Payslip: zero rows hidden · working days = clocked-in only

### Changed
- **"Working days" on the slip means one thing now: the clocked-in total.** The old "WORKING DAYS IN MONTH (MON–FRI LESS HOLIDAYS)" row was already removed in v1.4.118 — the screenshot showing it was a pre-rebuild print. What remained was the deduction note reusing the phrase; it now reads "INCOMPLETE MONTH (WORKED 5 OF 22 **PAYABLE DAYS**)" so the words "working days" belong solely to the clocked-in figure. (The 22 stays in the note because the incomplete-month formula you approved in v1.4.84 divides by the month's payable days — the note exists precisely so the math on the slip is self-explanatory)
- **Zero rows no longer print.** PUBLIC HOLIDAY, ANNUAL LEAVE, MEDICAL LEAVE, EMERGENCY LEAVE (PAID) and UNPAID LEAVE appear **only when they have data (> 0)** — a clean month shows just "WORKING DAYS (TOTAL CLOCKED IN)" plus the balances. The Public Holiday row itself stays (v1.4.119) — it simply hides when the count is zero

### Deploy
- `pnpm build` → hard refresh only


## [1.4.119] — 2026-08-02 — Public Holiday row restored

### Fixed (my misreading, reversed)
- v1.4.118 removed the payslip's **PUBLIC HOLIDAY** row after misreading the CEO's comment — "there is no public holiday" referred to the July FIGURE looking wrong, not the row itself. The row is **restored**. The v1.4.118 improvements stay: single "WORKING DAYS (TOTAL CLOCKED IN)" line, no duplicate Days-Present row
- Note on the July figure: the 1.00 shown comes from the seeded Johor calendar — **Hari Hol Almarhum Sultan Iskandar (31-07-2026)** from the official gazette. If the company does not observe it, delete that entry in the holidays calendar and the slip (and the working-days computation) will show 0 / 23 accordingly

### Deploy
- `pnpm build` → hard refresh only


## [1.4.118] — 2026-08-02 — Payslip Others simplified · CLM-AZOODDMMYY numbering · payout proof (migration **0039**)

### Payslip (Others column)
- Per the CEO: one line — **"WORKING DAYS (TOTAL CLOCKED IN)"** — showing the person's attended days from the clock-in data. The separate "DAYS PRESENT" row is removed (it duplicated the same figure), and the **"PUBLIC HOLIDAY" row is removed** entirely. The leave rows (annual/medical/emergency/unpaid) and balances stay; the deductions column still self-explains "WORKED X OF Y WORKING DAYS" where a shortfall applies

### Claim numbering
- Claim numbers now follow the company scheme: **CLM-AZOO{DDMMYY}-{running number that day}** (e.g. CLM-AZOO020826-1), matching the QT/DO/INV pattern — on the printed form's Claim No., the editing header, and everywhere the number shows. Computed from the creation date + that day's sequence; existing claims renumber consistently under the same rule

### Payout proof — the answer to "should I insert the receipt paid?"
- **Yes — and now you can.** After 💸 Mark paid, the CEO sees **"📎 Attach payment receipt (bank slip)"** on the claim (migration 0039: `payment_proof_key`): the transfer slip uploads (image/PDF, 8 MB cap), the claimant is bell-notified, and both the claimant and deciders get a **"View payment receipt (payout proof)"** link. The claim record then tells the whole story end to end: staff receipt in → approval chain → PAID + date → payout proof. Audited `claim.payment_proof`. (Binary route added to the JSON-parse exclusion list — the v1.4.115 lesson, applied)

### Deploy
- `npx wrangler d1 migrations apply azoneofficial --remote` (**0039**) → `npx wrangler deploy` → `pnpm build` → hard refresh


## [1.4.117] — 2026-08-02 — Receipt attach resubmits a rejected claim · claim form fits ONE A4

### Changed (Claims)
- **Attaching a receipt to a REJECTED claim now resubmits it automatically.** The missing receipt was the reason for rejection — once it's attached the claim goes straight back to pending, the previous decision and any chain stamps are cleared, the first stage of the approval chain is notified ("Resubmitted with receipt"), and the staff member sees "Receipt attached — claim RESUBMITTED for approval". Audited `claim.resubmit` (via receipt_attach). "Edit & resubmit" remains for when the claim's content itself needs fixing
- The 📎 attach on a *pending* claim behaves as before — attaches quietly without restarting anything

### Changed (printed claim form — one A4 page)
- The whole form **including the receipt** now fits a single A4 sheet: page margins 14mm → 9mm, tightened header/table/signature spacing (signature boxes 78 → 64px), receipt box capped at 72×58mm, and break-inside guards on the receipt box and footer so nothing spills onto a second page. All content — meta grid, up to 10 item rows, declaration, status line, three signatures, ✂ CUT HERE, receipt, footer — on page 1

### Deploy
- `npx wrangler deploy` → `pnpm build` → hard refresh. No migration


## [1.4.116] — 2026-08-02 — "Hide" is a proper button

### Changed
- The Add-a-staff-member card's tiny underlined "hide" text link is now a real button — "**Hide form ▲**", bordered, h-8, hover state, sitting flush right of the card header — matching the "+ New staff record — show details" button that opens it

### Deploy
- `pnpm build` → hard refresh only


## [1.4.115] — 2026-08-02 — THE receipt bug, found and fixed

### Fixed (root cause of every failed receipt upload)
- `handleStaff` JSON-parses every POST body **except** the binary `/photo` route. The receipt route ends `/receipt`, so `request.json()` ran on the **binary image** first — the parse error was swallowed, but the read **consumed the request stream**, so the R2 upload received a disturbed/empty body and failed **every single time**, for every file, at any size. The `/receipt` route is now excluded from JSON pre-parsing exactly like `/photo`, and the handler explicitly refuses an empty body
- This was never a size problem and never a migration problem — my earlier diagnoses were wrong on this point, and the size popup/limits from v1.4.110 remain as genuine safeguards, but the upload itself was broken at the stream level since the claims module shipped. It works now: choose the file (via the form, Edit, or 📎 Attach receipt) and it lands in R2, ticks the ☑ checkbox, and prints on the form

### Deploy
- `npx wrangler deploy` → hard refresh (worker-only fix; run migrations 0037+0038 first if not yet applied — they're still required for the expenses/claims features)


## [1.4.114] — 2026-08-02 — Why the tab looked empty: unapplied migrations. Hardened + one-tap receipt attach

### Root cause (both complaints, one cause)
- v1.4.109–112 read columns/tables created by **migrations 0037 and 0038** (claims.paid_at, chain columns, payroll_payments). If those migrations are **not applied** on the remote D1, `/expenses` throws → the whole endpoint 500s → the tab renders EMPTY with no message (looks exactly like data loss), and claim **edit/resubmit** 500s too (blocking the attach-via-edit path). The data itself is untouched
- **Run this first:** `npx wrangler d1 migrations apply azoneofficial --remote` — then `npx wrangler deploy` → `pnpm build` → hard refresh

### Hardened (so this class of failure can never blank the tab again)
- `/expenses` and `/pnl` now **degrade instead of dying**: the new payroll-payment and claims lookups are individually guarded — if their tables/columns are missing, the core expense list still returns and the failure is written to the error log (`expenses_claims`, `expenses_payroll_paid`; visible in /admin → System health)
- A failed `/expenses` load now shows a **loud amber line** ("⚠ Server error — expenses could not be loaded…") instead of a silent empty list

### Added — 📎 one-tap "Attach receipt"
- Staff no longer need to edit the claim to add a missing receipt: their own pending/rejected claims without one show **📎 Attach receipt** directly on the row — pick the photo/PDF, it compresses, size-checks (8 MB popup with the WhatsApp tip on failure, including server refusals), uploads, and confirms "Receipt attached to your claim"

### Deploy
- **Migrations 0037 + 0038** → `npx wrangler deploy` → `pnpm build` → hard refresh


## [1.4.113] — 2026-08-02 — Clock-in-first flow with a popup

### Added
- **The punch flow is now enforced: clock IN first, then clock OUT.** Tapping "Clock out" without today's clock-in shows an instant popup — *"Clock in first — You haven't clocked in today — clock in first, then clock out at the end of your shift."* — in the same animated toast style as the punch confirmations
- **Server-enforced too**, not just hidden in the UI: the worker refuses a clock-out with no clock-in on record for the day (HTTP 400 `no_clock_in`), so a stale tab or a direct API call can't create an out-without-in. If the server refusal fires (e.g. an old tab open since yesterday), the same popup shows rather than a quiet error line
- The one-in/one-out-per-day rule and all lateness/early-out classifications are unchanged

### Deploy
- `npx wrangler deploy` → `pnpm build` → hard refresh. No migration


## [1.4.112] — 2026-08-02 — Month attribution rules set by the CEO

### The three rules, as stated
1. **July payroll counts in AUGUST** — this was already the design (the "Staff payroll — 07-2026" line lives inside the 08-2026 card and joins the August Total). What the screenshot exposed: the amount showed nothing because **July payroll hasn't been processed yet** — the figure comes from the Payroll tab's entries. The line now says so explicitly: *"(figure appears once 07-2026 payroll is processed in the Payroll tab — it counts in THIS month's total)"*
2. **Utilities and other expenses belong to the month they're recorded in** — already the behaviour: recording in August books to August; recurring items carry forward to each month's Payments due until recorded for that month. Unchanged
3. **Claims belong to the month their claim dates fall in (1st → month end)** — CHANGED from v1.4.109's paid-date basis: an **approved** claim now counts in the month of its claim date, whether the money has moved yet or not. The Expenses Total and the P&L Claims column both follow claim-date attribution ("+ staff claims RM X (N, by claim date)"). Payments due (approved-unpaid) and ✅ Payments completed (actual payment dates) keep tracking the cash movements separately

### Deploy
- `npx wrangler deploy` → `pnpm build` → hard refresh. No migration


## [1.4.111] — 2026-08-02 — "Missing" expenses explained · News label on desktop

### Clarified (not a data loss)
- The Expenses tab shows **one month at a time** and defaults to the current month. On 02-08-2026 it opens on August — a fresh, empty month — while July's records sit safely under the **month picker** (top right). The empty state now says exactly that: *"No expenses recorded for this month. This tab shows ONE month at a time — earlier records (e.g. July) are under the month picker at the top right."* Nothing was deleted; the DB and nightly backups are untouched

### Fixed
- The **desktop** nav pills and the More sheet rendered the raw tab key "Announcements" — only the mobile renderer had the "News" label. One shared `tabLabel()` now feeds every nav renderer, so **News** shows on desktop too (spotted on the CEO's screenshot)

### Deploy
- `pnpm build` → hard refresh only


## [1.4.110] — 2026-08-02 — Receipt-too-large popup with the WhatsApp fix

### Fixed
- Oversized receipt uploads previously **failed silently** — the claim went through and the staff member never knew the receipt didn't. Every failure path now speaks up

### Added
- **Clear size limit: 8 MB** (generous — receipts compress to ~200 KB), enforced in three layers with the same friendly message everywhere: *"Receipt too large — the maximum is 8 MB. Easy fix: send the photo to yourself on WhatsApp, save it from the chat back to your gallery (WhatsApp shrinks it a lot), then upload that copy."*
  1. **On file selection** — an oversized PDF (no client compression possible) or an extreme photo (>40 MB) is refused immediately with the popup, before any waiting
  2. **On submit** — photos are auto-compressed first (longest side 1600px, as since v1.4.76, typically 5–15× smaller); if one still exceeds 8 MB (e.g. iPhone HEIC that couldn't be decoded), the claim submits WITHOUT it and the popup says so, adding "then use Edit on your claim to attach it"
  3. **On the server** — a hard 8 MB cap (HTTP 413) with the same tip, so nothing oversized slips through by any route; a failed upload after a successful claim is now also reported instead of swallowed

### Deploy
- `npx wrangler deploy` → `pnpm build` → hard refresh. No migration


## [1.4.109] — 2026-08-02 — Staff claims are expenses too

### Added (Expenses tab)
- **Paid staff claims now count in the month's expenses** — cash basis, consistent with the rest of the tab: a claim becomes an expense in the month the CEO presses 💸 Mark paid. The month **Total** includes them, with the breakdown reading "incl. staff payroll … + expenses … + staff claims RM X (N)"
- **Approved-but-unpaid claims appear under 💳 Payments due** — amount, "staff claim" chip, claimant name, approval date, and a DUE pill, with the instruction to pay the claimant then press Mark paid on the Claims tab
- **Paid claims join ✅ Payments completed** — 🧾 lines with claimant and payment date, included in the completed total

### Changed (Overview P&L)
- The 6-month P&L gains a **Claims column**: claims paid in each month now sit on the cost side alongside Expenses and Payroll, so Profit reflects them

### Repaired
- Restored two TypeScript type additions (`staff_payroll.paid_at`) that a v1.4.101 edit batch had asserted but never written to disk — without this the build would have failed on the Payments-completed code

### Deploy
- `npx wrangler deploy` → `pnpm build` → hard refresh. No migration


## [1.4.108] — 2026-08-02 — Full registered address on the badge (and every printed footer)

### Changed
- The staff ID badge footer now carries the **full registered address** on two lines — "34-02, Jalan Setia Tropika 1/1, Taman Setia Tropika," / "81200 Johor Bahru, Johor, Malaysia" — replacing the short "Setia Tropika, Johor Bahru, Malaysia"
- The same full address replaces the compact form on the **payslip footer** and the **claim form footer**, so every printed document now states the identical registered address as the QT/DO/INV and SOA. No compact variant remains anywhere

### Deploy
- `pnpm build` → hard refresh only (re-print badges to see it)


## [1.4.107] — 2026-08-02 — CEO override on the claim chain

### Changed
- **The CEO can approve directly, chain finished or not** — as the company's final authority, an incomplete chain no longer blocks the Approve button. But a bypass is never silent: the button asks for confirmation ("Approve anyway as CEO? The bypass will be recorded"), the claim's decision note gains "**CEO direct approval (HR review + COO pre-approval bypassed)**", and the audit log stores the skipped stages (`chain_override`). The normal flow is unchanged — stages still get notified, chips still show progress, and an approval after a completed chain records nothing extra
- Reject remains available at any point, as before

### Deploy
- `npx wrangler deploy` → `pnpm build` → hard refresh. No migration


## [1.4.106] — 2026-08-02 — Role-based claim approval chains (migration **0038**)

### The chains (mirroring the leave approval chain)
- **marketing / sales_marketing / editor / live_host** → **HR review** → **COO pre-approval** → **CEO final approval**
- **hr_admin** → **CCO pre-approval** → **CEO final approval**
- **COO / CCO** → **CEO final approval** directly
- This also means **every staff role can now submit claims** (previously only hr_admin and above) — the Claims tab opens to editor/marketing/live_host/sales_marketing

### How it works
- On submission the **first stage is notified** (HR for staff claims, CCO for HR's claims, CEO otherwise) — no more everything landing straight on the CEO
- **HR** sees staff-chain claims in a Pending-approvals queue with **"✔ HR review OK — pass to COO"**; the COO is then notified and sees **"✔ Pre-approve — pass to CEO"**; the CCO gets the same button on hr_admin claims. No self-review — the server refuses reviewing your own claim
- Every pending claim shows a **chain progress chip**: "awaiting HR review" → "HR ✓ — awaiting COO" → "HR ✓ · COO ✓ — CEO next"
- The **CEO's Approve is gated server-side**: approving before the chain completes returns "HR review is still pending" / "COO (or CCO) pre-approval is still pending" — surfaced as a toast. **Reject stays available at any point** (no need to run a chain for a claim you can already see is wrong)
- **Editing/resubmitting restarts the chain**: v1.4.104's edit now clears the review + pre-approval stamps and notifies stage one again
- The printed claim form's System-status line adds **"HR reviewed by … · Pre-approved by …"** — matching its three signature boxes
- Audited: `claim.hr_review`, `claim.preapprove`; admin tier can backstop any stage

### Deploy
- `npx wrangler d1 migrations apply azoneofficial --remote` (**0038**) → `npx wrangler deploy` → `pnpm build` → hard refresh


## [1.4.105] — 2026-08-02 — Format hints in every box · short labels

### Changed (Staff Details + phone fields everywhere)
- **Format examples now live inside the boxes** — an empty field shows exactly the shape HR/CEO/COO should type: NRIC "**YYMMDD-PB-#### · e.g. 970209-01-5183**", phone "**+60 12-345 6789**", Employee ID "e.g. AZOOM001", dates "DD-MM-YYYY · e.g. 09-02-1997", bank account "**numbers only** · e.g. 551100338444", blood type "e.g. O / A+ / B−", position/department examples
- **Labels shortened, as asked** — the long explanations no longer stretch the layout: "Effective end date (DD-MM-YYYY — resigned/terminated)" became "**End date (resign/terminate)**", "Re-joined on (DD-MM-YYYY — payroll resumes)" became "**Re-joined on**", and the date labels dropped their repeated (DD-MM-YYYY). The detail moved into the box placeholder and a **hover tooltip** (e.g. NRIC explains the YYMMDD-PB-#### parts; End date says payroll runs up to and including it)
- Phone hints standardized across tabs: Staff Details record + create form, **Profile** phone, and the Sales **customer** phone (which also feeds the WhatsApp reminder links — the +60 format there makes wa.me work first time)

### Deploy
- `pnpm build` → hard refresh only


## [1.4.104] — 2026-08-02 — Claim editing lifecycle: edit before approval · locked once approved · edit & resubmit after rejection

### Added
- **Before the CEO decides**: the claimant sees an **Edit** link on their own pending claim — it loads the claim back into the form ("Editing AZOO-CLM-0001 · cancel"), purpose and every item line prefilled; **Update claim** saves the changes (audited `claim.edit`) and the CEO is notified of the updated figures. A new receipt can be attached during the edit
- **Once approved (or paid): locked.** The worker refuses edits on approved claims outright — "Approved claims are locked — submit a new claim instead"
- **After a rejection**: the claim is no longer a dead end — the claimant sees **Edit & resubmit**, fixes the form, and **Resubmit for approval** sends it back to **pending**: the previous decision (decided-by, note) is cleared, the CEO is bell-notified *"Resubmitted after rejection awaiting your approval"*, and the cycle runs again (audited `claim.resubmit`). Receipt uploads are now also allowed on rejected claims so the missing proof can be added before resubmitting
- Only the **claimant themselves** can edit — checked server-side against the session, not just hidden in the UI

### Deploy
- `npx wrangler deploy` → `pnpm build` → hard refresh. No migration


## [1.4.103] — 2026-08-02 — Receipt below the CUT HERE line

### Changed
- The printed receipt box now sits **below the ✂ CUT HERE line**, bottom right — the top section (the formal claim form with the Receipt ☑/☐ checkbox, details, signatures) can be cut and filed on its own, with the receipt on the detachable lower portion. The **Receipt checkbox stays in the meta grid** exactly as before, auto-ticking ☑ Yes / ☑ No from whether a receipt is attached — the form always states whether proof exists even after the halves are separated

### Deploy
- `pnpm build` → hard refresh only


## [1.4.102] — 2026-08-02 — Receipt prints on the claim form

### Added
- The staff-uploaded receipt now prints **on the Employee Claim Form itself** — a bordered "RECEIPT (UPLOADED BY STAFF)" box at the **bottom right**, above the ✂ CUT HERE line. The image is fetched fully (as a blob, with your session) **before** the print dialog opens and rendered at up to 80×78mm — clearly visible, never a half-loaded blank. Because compressed receipt photos can't be inlined when they're PDFs, a PDF receipt prints a note instead ("Receipt attached as PDF in the system — printed separately"); use View receipt to print that PDF on its own page. The receipt checkbox in the meta grid keeps auto-ticking as before
- The print window now opens immediately on the click (popup-blocker safe) with a brief "Preparing claim form…" while the receipt loads

### Deploy
- `pnpm build` → hard refresh only (frontend change; no worker deploy, no migration)


## [1.4.101] — 2026-08-02 — The big one: full address · News · sales clarity · client money management · staff lifecycle · claim payments · payments completed · inventory pricing · birthdays everywhere · tab re-sort · Users tab · P&L (migration **0037**)

### Company address (portal / admin / account / documents)
- The full registered address — **34-02, Jalan Setia Tropika 1/1, Taman Setia Tropika, 81200 Johor Bahru, Johor** — now prints on the QT/DO/INV header and the new Statement of Account. (The public site's structured data already carried it; the payslip/claim-form footers keep the compact one-line form)

### Tabs
- **Re-sorted to the CEO's order**: Dashboard → News → HR → Staff Details → Attendance → Leave → *(Tasks — kept after Leave; task-only roles depend on it)* → Claims → Payroll → Expenses → Sales → Inventory → Birthdays → Overview → Profile → **Users**
- **Announcements is now "News"** everywhere it displays (dashboard card, publish form, nav) 
- **New Users tab** (super_admin / CEO / COO): read-only list of every staff account — proper-case name, email, role chip, employment status (with end/re-join dates), active/disabled — account management itself stays in /admin

### Sales
- **Walk-in mystery solved**: "🚶 Walk-in / general buyer" (dropdown) and "Walk-in Customer" (customer list) were the *same shared record* — the list row is now hidden server-side, leaving only the dropdown option. One concept, one place
- **Sales person captures your login**: the default now reads "**Alif — me (auto from login)**" — it always recorded the logged-in creator; the label finally says so. All salesperson displays (dropdown, list, printed doc) use **first names**
- **Item description suggests from Inventory**: typing opens live suggestions (name · SKU · price); picking one **auto-fills the unit price** from inventory; free typing still works for items not stocked yet
- **Client money management**: **SOA button** per customer prints a branded Statement of Account (invoice list, paid/outstanding status, balance band, bank details); **⏳ aging card** buckets unpaid invoices 1–30/31–60/61–90/90+ days with a **WhatsApp reminder** link pre-written with the invoice number, amount and account number; **→ Invoice** button on quotations converts one-click (same items/customer/salesperson, fresh INV number, audited `doc.convert_qt_inv`)

### HR / Staff Details / Payroll
- **Names display in Proper Case across the tabs** (payroll, corrections, team report, birthdays, staff lists, claims, dropdowns) via a shared helper that keeps *bin/binti/a/l/a/p* lowercase — formal printed documents (payslip, claim form, badge, signer block) deliberately stay uppercase
- **Staff Details creation form hidden** behind "+ New staff record — show details" (HR/CEO/COO click to reveal; minimalist by request)
- **Employment status** gains **Resigned** and **Terminated** (the DB already accepted them), plus two new dated fields (migration 0037): **Effective end date** and **Re-joined on**. Payroll follows the lifecycle: the person is processed **through the month of the effective date** (final salary via days worked, as the formula already does), disappears for the gap, and **returns from the re-join month**. Status chips on the staff list show "resigned · 15-09-2026" / "re-joined 01-11-2026"

### Claims
- After approval, the CEO can press **💸 Mark paid (money released)** — the claim shows a green **PAID + date** chip to the claimant (who is bell-notified), on top of the approved status. Audited `claim.paid`

### Expenses
- **Staff payroll gets its own Mark paid** button on the 💳 Payments-due line — pressing it clears the DUE pill (audited `payroll.paid`) and the payment moves to a new **✅ Payments completed** section listing everything released this month (payroll with its month + date, each paid expense with category/vendor/date) and the completed total

### Inventory
- **Price per unit (RM)** column (migration 0037: `unit_price_cents`): set it on creation or edit it inline in the table — it feeds the Sales item suggestions

### Birthdays
- Staff birthdays now appear on the **dashboard events calendar** (🎂 pink markers, legend entry, tap-day chip) with a **"🎂 Coming up"** strip for the next 30 days — and a new **09:00 MYT daily cron** bell-notifies every staff member on the day itself, so the team can prepare the celebration

### Overview
- **📊 P&L card** — last 6 months, month by month: TikTok + paid invoices (cash basis) against expenses + the payroll cycle paid in the month, with a green/red profit column. (Note: the P&L payroll column uses entry totals; the Expenses tab remains the exact net figure)

### Standardization
- Save popups: the portal already uses the animated SaveToast family everywhere; **/account now joins it** (enquiry confirmation). /admin keeps its inline confirmations for now — a full admin toast sweep is queued as its own pass. Mobile app-view (bottom nav + sticky app bar) was verified present on /portal, /admin and /account since v1.4.55

### Deploy
- `npx wrangler d1 migrations apply azoneofficial --remote` (**0037**) → `npx wrangler deploy` → `pnpm build` → hard refresh


## [1.4.100] — 2026-08-02 — Documents list rows standardized

### Changed
- The Documents rows are re-laid: document info (number · customer · amount · date · sales person) on the left, growing to fill the row, and a single right-aligned **controls group** — PAID chip · status dropdown · Edit · PDF — every element the **same 28px height**, same rounding, consistent spacing, vertically centred. The chip no longer floats at a different height than the dropdown or the buttons, and on narrow screens the whole controls group wraps together as one unit instead of scattering
- The list date also drops the stray "00:00" (dates only), matching the printed documents

### Deploy
- `pnpm build` → hard refresh only (frontend change; no worker deploy, no migration)


## [1.4.99] — 2026-08-02 — Official signature PNGs · signer name + position under the Authorised signature

### Changed
- **Your clean transparent PNGs replace the extracted ones**: `public/signatures/ceo-sign.png` and `coo-sign.png` are now the files you supplied (signature + AZ ONE OFFICIAL chop, properly cut), and the image prints larger (112px tall) so the chop is legible — the previous render was too small
- **Signer identity under the line, standardized on all three documents**: each signature block now reads — signature image → line → small caps label (*Authorised signature* / *Delivered by* / *Prepared by*) → **FULL NAME** in bold → **Position** → AZ ONE OFFICIAL. The worker returns the signer automatically: the **COO's full name and position on the COO's own documents, the CEO's on everything else** (pulled live from Staff Details `full_name` + `position`, so a title change updates every future print; sensible fallbacks if the position field is empty)

### Deploy
- `npx wrangler deploy` → `pnpm build` → hard refresh. No migration. Make sure your and the COO's **Position** fields are filled in Staff Details — that's what prints under the name


## [1.4.98] — 2026-08-02 — Maybank account on invoices · payment details + signature pinned to the page bottom (full A4, standardized)

### Added / Changed
- **Bank account on the invoice payment box**: A/C No **5516 2328 7032** (grouped for readability) joins Method · Bank (MAYBANK) · Name (AZ ONE OFFICIAL) — customers finally have the full transfer details on the document itself
- **Full-A4 layout, standardized across INV / QT / DO**: the printed page is now a flex column at full A4 height, and the bottom block — payment details + Authorised signature on invoices, the signature pairs on Delivery Orders and Quotations — is **pinned to the bottom of the page** with `margin-top:auto` (per the house rule: flex pinning, never absolute). Short documents no longer end mid-page; every document type shares the same structure: header → bill-to → items → totals → notes → bottom block at the page foot → footer line
- **Dates on printed documents show the date only** — "24-07-2026", not "24-07-2026 00:00" — in the meta box (Date / Valid until / Payment due), the ✔ PAID line, and the quotation validity sentence

### Deploy
- `pnpm build` → hard refresh only (frontend change; no worker deploy, no migration)


## [1.4.97] — 2026-08-02 — Documents list fixed · authorised signatures on QT/DO/INV · sales_marketing invoicing

### Fixed — why the Documents list stayed empty
- A stray fragment from a v1.4.93 automated edit had corrupted `printDoc`'s closing line and left the document-list type incomplete — depending on build settings this either broke the frontend build or the list rendering. The fragment is **removed and both types repaired**; additionally the list now refreshes **awaited** right after creation (the new document appears instantly), the Documents card gains a **Refresh** button, and any loading error is shown in amber instead of a silent "No documents yet." — so a problem can never masquerade as an empty list again. View + reprint: every row keeps its **Edit** and **PDF** buttons; PDF reprints any document at any time

### Added
- **Authorised signatures, auto-assigned** (from the two photos provided): both signatures were extracted to **transparent-background PNGs** (paper lighting normalised, black ink + blue AZ ONE OFFICIAL company chop preserved, cropped) at `public/signatures/ceo-sign.png` and `coo-sign.png`. The printed documents place the image above the signature line per your rule — **COO-created documents carry the COO's signature; documents created by CEO, CCO, HR admin or sales & marketing carry the CEO's** — on the Invoice's *Authorised signature*, the DO's *Delivered by*, and the Quotation's *Prepared by* blocks. The worker returns the creator's role for the selection
- **sales_marketing can now create invoices**: added to the worker's finance permission and the Invoice option restored in their form, per instruction — with the signature rule above ensuring their documents still print under the CEO's authority

### Deploy
- `npx wrangler deploy` → `pnpm build` → hard refresh. No migration. (If your previous `pnpm build` reported errors, the v1.4.93 fragment was the cause — this build is clean)


## [1.4.96] — 2026-08-02 — Delete item lines · the "Insufficient" invoice error fixed (CEO now in finance)

### Fixed — the "Insufficient rights" error, root cause
- The worker's **finance permission (invoice creation + mark-paid) omitted the CEO** while the form offered him the Invoice option — so the CEO himself was the one being refused. `finance` now includes **ceo** (super_admin, admin, hr_admin, coo, cco, ceo). The same mismatch showed Invoice to sales_marketing who would also be refused — the option is now hidden for them so the UI and the worker agree
- **Creating sales on their behalf — the intended flow**: sales & marketing staff create Quotations and Delivery Orders themselves; **Invoices are created by finance roles (you, COO, CCO, HR) with the "Sales person" dropdown attributing the sale** to whoever actually sold — exactly the on-their-behalf mechanism, and the documents list + printed doc credit them

### Added
- **✕ delete on sales item lines**: accidentally added lines can be removed (the ✕ appears whenever there's more than one line; the last line can't be deleted — a document needs at least one item)
- **Claims already had it** (as asked to check): each claim item row has carried a ✕ since the multi-item form shipped in v1.4.95, visible whenever there's more than one row

### Deploy
- `npx wrangler deploy` → `pnpm build` → hard refresh. No migration — then retry the same Tudung invoice as CEO; it will create, auto-open the PDF, and credit Zolkefli as sales person


## [1.4.95] — 2026-08-02 — Monthly KPI cycle (last month's result stays visible) · multi-item claims, minimalist

### Changed — KPI as a monthly cycle
- Targets were already **per-month**, so each new month starts fresh (an automatic reset) — what was missing was the cycle around it, now added: **last month's KPI result stays on the Sales Revenue card all month** as a motivation banner — 🏆 green *"Last month (07-2026): RM 18,540.00 of RM 15,000.00 — 124% TARGET HIT — keep the streak going!"* or 📈 amber *"… — 62% — this month is the comeback."* And **from the 25th onward**, if next month's target isn't set yet, leadership sees an ⏰ *"Month-end soon — set 09-2026's target before the 30th/31st"* nudge with a one-click **Set next month's target** editor (same inline editor, posts to the next month). Once set, the card confirms "Next month's target already set"

### Changed — Claims, matching the paper form
- **Multi-item claims** (migration **0036**: `items` JSON on claims): one form now takes several expense lines — Date · Category · Description · Amount (RM) per row, **+ Add item** (up to 10), live **Total**, a **Purpose** field (prints on the form) — mirroring the AZOO-HR-CLM-001 details table. The stored total is the sum; the CEO's notification carries the total; old single-line claims keep working
- **Minimalist list, as asked**: claim rows collapse to one line — claimant · total · "3 items" (or category) chip · status · date · **Details ▾**. Expanding shows the purpose, each item line, the receipt link, Print claim form and the decision trail. Approve/Reject stay visible on pending rows without expanding
- The printed **AZOO-HR-CLM-001** now lists every item as its own row (blank rows pad to the form's minimum), with the grand total

### Deploy
- `npx wrangler d1 migrations apply azoneofficial --remote` (**0036**) → `npx wrangler deploy` → `pnpm build` → hard refresh


## [1.4.94] — 2026-08-02 — "Nothing saved" fixed loudly · backdated invoices · document editing · PDF straight after create

### Fixed — why "Create with auto number" seemed to do nothing
- The form had **silent stops**: with "Choose customer…" still selected (or an empty item line) the button returned without a word, and a server error (e.g. **migration 0035 not yet applied** — the new salesperson column makes the insert fail until it runs) vanished equally silently. Now every stop speaks: amber toasts for "Choose a customer first (Walk-in counts)", "Every line needs an item description", "Enter a unit price (RM)", and any server error message; success shows a green toast with the new document number. **Run migration 0035 before testing** — that is very likely the actual reason yours didn't save

### Added
- **Backdated documents**: a "Document date (backdate allowed)" field (past dates only, capped at today) — an invoice for a payment received before this system existed carries its true date; with "Payment already received" ticked, a "Payment received date" field backdates `paid_at` too, so the revenue card books it in the correct month
- **Edit documents**: an **Edit** button on every row loads the document back into the form ("Editing INV-AZOO… · cancel"), lets you fix items, prices, discount, tax, customer, sales person or date, and **Update** recomputes totals — the document number NEVER changes, edits are audited (`doc.edit`), and invoice edits require finance rights just like invoice creation
- **PDF immediately**: after creating or updating, the print view opens by itself with the fresh figures — create → PDF in one motion, exactly the flow asked for

### Deploy
- `npx wrangler d1 migrations apply azoneofficial --remote` (applies **0035** if not yet run) → `npx wrangler deploy` → `pnpm build` → hard refresh


## [1.4.93] — 2026-08-02 — Professional KPI editor · sales form clarity + Sales person · walk-in repair

### Fixed (honesty note)
- The v1.4.91 walk-in patch was **partially lost before it was written to disk** (a scripting slip on my side): the "Payment received" checkbox and the create/reset logic shipped, but the customer dropdown never gained the walk-in option and the form state was missing its field — which is exactly why the Create document form felt confusing and un-submittable. Both are now properly in place and verified

### Changed
- **KPI target input**: the browser `prompt()` box is gone. "Set target" now opens a clean inline editor inside the KPI block — RM field, **Save target** button, Cancel, Esc to close — with the save-toast confirmation and an honest "No changes" when the figure is identical
- **Create document, readable**: every field is labelled — Document type · Customer (with **🚶 Walk-in / general buyer** for unidentified buyers) · **Sales person (who made this sale)** · Item / service description · Qty · **Unit price (RM)** · Discount (RM, optional) · Tax % (optional). Prices are typed in **RM now, not sen** (stored in sen underneath, so nothing else changes)
- **Sales person on every document** (migration **0035**: `salesperson_id`): a dropdown lists every staff member (CEO, COO, CCO, sales & marketing, marketing, HR — any staff role) with **"Me (default)"** preselected; the worker defaults to the creator when untouched. The documents list shows "· sales: <name>" and the printed QT/DO/INV carries a **Sales person** row in the meta box — you always know who sold. Backed by a new minimal `/staff-list` endpoint (id + name + role only; no phone/IC/bank/salary exposed)

### Deploy
- `npx wrangler d1 migrations apply azoneofficial --remote` (**0035**) → `npx wrangler deploy` → `pnpm build` → hard refresh


## [1.4.92] — 2026-08-02 — Printable Employee Claim Form (AZOO-HR-CLM-001)

### Added
- Every claim in the Claims tab now has a **"Print claim form"** link producing the CEO's paper form as a print-ready PDF, matching the AZOO-HR-CLM-001 / Version 002 layout: branded header with gold bar and tagline, the meta grid (Document No · Version · Claim No `AZOO-CLM-0001` · Date · Employee · Department · Position · Purpose · Receipt ☑/☐, auto-ticked from whether a receipt is attached in-system), the Claim Details table with the claim's line plus blank rows for hand additions, **Total Claimed**, the declaration, and the three signature boxes — Employee / COO·CCO / CEO — with the employee's and deciding CEO's names pre-filled and space for wet-ink signatures. A **✂ CUT HERE** line and footer close it, A4 print CSS + mobile-friendly viewport like the sales documents
- **The system stays authoritative, as specified**: the form carries a coloured *System status* line — green "APPROVED IN SYSTEM by <name> on <date>", red "REJECTED IN SYSTEM", or amber "PENDING SYSTEM APPROVAL" — so the paper copy always states that approval happens in the system and ink is for the record. `/claims` now returns the claimant's full name, position and department to fill the form

### Deploy
- `npx wrangler deploy` → `pnpm build` → hard refresh. No migration


## [1.4.91] — 2026-08-02 — Walk-in invoices · payroll amount inside the expenses total · expense editing

### Added
- **Invoice for an unidentified buyer**: the customer dropdown gains **"🚶 Walk-in / unidentified buyer"** — pick it and the invoice bills a shared "Walk-in Customer" record (created automatically the first time), so a received payment can always be invoiced even when you don't know who the buyer is. Paired with a new **"Payment already received (bank transfer)"** checkbox on invoice creation: tick it and the invoice is born **PAID** — stamped bank transfer, counted in revenue immediately, green chip and PAID stamp from the start. (If the buyer later identifies themselves, add them as a proper customer for the next document)
- **Staff payroll inside the expenses total**: the 💳 Payments-due payroll line now shows the actual amount (previous month's payroll, computed with the exact payslip formula — basic + commission + allowance + OT − deductions − unpaid leave − incomplete month), and the month's **Total** includes it with a breakdown: "incl. staff payroll RM 4,653.84 (07-2026) + expenses RM 2,140.00". Money out is finally one number
- **Edit expenses** (typo fixes): every recorded expense gains an **Edit** link — date, category, amount, vendor and description editable inline with Save/Cancel, honest "No changes" toast, audited `expense.update`. **Staff payroll is deliberately not editable here** — its figures live in the Payroll tab, exactly as specified

### Deploy
- `npx wrangler deploy` → `pnpm build` → hard refresh. No migration (0034 already covers everything)


## [1.4.90] — 2026-08-02 — Invoice payments (bank transfer) · true sales figure + KPI target · branded QT/DO/INV templates

### Added (migration **0034**: `payment_method`, `payment_ref`, `paid_at` on sales_documents + `sales_targets`)
- **Payment received, recorded properly**: marking an invoice **paid** now asks for the bank-transfer reference (optional), stamps method = bank transfer + the payment moment, and shows a green **PAID · bank transfer** chip on the document (hover for date + reference). Reverting to unpaid clears all of it
- **The correct sales figure**: the revenue card's Invoiced box now counts **payments received** — paid invoices, in the month the transfer landed — labelled "Invoiced (paid)", with **outstanding** (billed, unpaid) shown alongside. TikTok + paid invoices = a Total that is genuinely comparable with the Expenses tab, cash against cash
- **KPI sales target**: CEO/COO set a monthly target on the revenue card ("Set target" → RM figure, audited); everyone with revenue access sees a gold progress bar — % achieved, RM to go, green + 🎉 at 100%
- **Branded documents**: QT / DO / INV all print on a redesigned AZOO template — gold accent bar, navy header with tagline + SSM + Setia Tropika address + contact, doc meta box, gold-edged BILL TO / DELIVER TO card, striped item table with navy TOTAL band, and per-type blocks: **QT** validity + terms + Prepared/Accepted-by signature lines; **DO** Delivered-by / Received-in-good-order signatures; **INV** payment-details box (Bank transfer · MAYBANK · AZ ONE OFFICIAL, receipt-via-WhatsApp note) and a diagonal green **PAID** stamp once paid. Mobile-friendly: responsive on the phone screen, strict A4 when printed or saved to PDF — the PDF button works from the phone's share/print sheet
- Note for the CEO: the invoice payment box prints the bank + account name but **no account number yet** — send it over and it goes on the template

### Deploy
- `npx wrangler d1 migrations apply azoneofficial --remote` (**0034**) → `npx wrangler deploy` → `pnpm build` → hard refresh


## [1.4.89] — 2026-08-02 — Payroll & payslip calendars follow the payroll cycle

### Changed
- **Both month pickers now open on the payroll-cycle month, exactly as specified**: a month's payroll runs until the 5th of the following month, so **until the 5th, Payroll processing and My payslip open on the PREVIOUS month** (today, 02-08: July — the cycle still in progress / the slip releasing on the 5th). **From the 5th, the present month takes over.** My payslip's month cap follows the same rule, so before the 5th staff can no longer even select the current month and meet a pointless "available next month" lock (the 08-2026 → 07-09-2026 screen goes away until August's cycle actually opens). Payroll processors can still navigate to any month manually

### Deploy
- `pnpm build` → publish → hard refresh. Frontend-only; no worker deploy, no migration


## [1.4.88] — 2026-08-02 — Recurring expenses, due dates & a Payments-due board

### Category guidance (as asked)
- **Internet (monthly bill)** → `utilities` — it's a utility service like water/electricity/phone
- **Printer on monthly rental/lease** → `equipment`; printer **ink, toner and paper** → `supplies`

### Added (migration **0033**: `recurring`, `due_day`, `paid_at` on expenses)
- **Monthly recurring** checkbox + **Due day** (1–31) on the expense form. A recurring expense recorded last month **automatically reappears this month** in a new **💳 Payments due** card — with its amount, due date and "↻ recurring" chip — until you press **Record for this month** (one click copies it into the month on its due date, keeping the recurrence)
- **Due tracking**: recorded expenses with a due day show an amber **DUE dd-mm** chip that turns red **OVERDUE** past the date; **Mark paid** stamps it (audited `expense.paid`) and flips the chip to green **PAID**
- **Payroll on the same board**: the Payments-due card leads with **Staff payroll** for the previous month — "Pay by 05-08-2026, 10:00 MYT" (the exact payslip-release moment, holidays respected) with a DUE/RELEASED status chip — so the biggest monthly commitment sits beside rent and internet where the CEO/COO plan payments

### Deploy
- `npx wrangler d1 migrations apply azoneofficial --remote` (**0033**) → `npx wrangler deploy` → `pnpm build` → hard refresh. Then re-add your Mr Wing rent with "Monthly recurring" ticked and due day 18 — September will surface it by itself


## [1.4.87] — 2026-08-02 — Save toasts everywhere (with honest "No changes") · Expenses tab for CEO/COO

### Added
- **Save confirmation toast** — the same animated notification family as clock-in (centred card, ring draw, tick) now confirms saves, and when nothing actually changed it shows an amber **"No changes"** with an "i" instead of pretending to work. Shared component (`components/ui/save-toast.tsx`); wired with REAL change-detection into:
  - **Payroll**: row Save (per-person, compares against the loaded snapshot), **Save all** (skips unchanged rows, reports "Saved — N entries" or "No changes"), **Base salaries** ("updated for N staff" / "already match")
  - **Staff Details**: record Save ("Saved — <name>" / "No changes — nothing to save")
  - **Attendance corrections**: row Save ("record updated" / "time unchanged") and Add/Remove
  - **Profile**: phone Save ("updated" / "unchanged")
  - Claims submit, event add and expense add show success toasts (forms are always changes by nature)
- **Expenses tab** (migration **0032**, `expenses`) for **CEO and COO** (+admin tier): record company operating costs — date, category (rent / utilities / software / marketing / equipment / logistics / supplies / other), amount, vendor, description — with a month filter and month TOTAL; audited (`expense.create/delete`). Clarified in-app: **Expenses ≠ Claims** — Claims are staff reimbursements routed to the CEO for approval (that tab already existed); Expenses are what the company itself pays

### Deploy
- `npx wrangler d1 migrations apply azoneofficial --remote` (**0032**) → `npx wrangler deploy` → `pnpm build` → hard refresh


## [1.4.86] — 2026-08-02 — My payslip: future months no longer selectable

### Fixed
- The month picker on **My payslip** allowed choosing months in advance (September while it's August) and then showed a lock card for a payslip that cannot exist yet — an incorrect flow, as the CEO flagged. The picker is now capped at the **current month** (`max`), floored at the person's **joining month** (`min`), and the value is clamped in code as well, since some browsers render `max` but still allow typing past it. Past months behave exactly as before: visible once released, 🔒 otherwise

### Deploy
- `pnpm build` → publish → hard refresh. Frontend-only; no worker deploy, no migration


## [1.4.85] — 2026-08-02 — Overtime in Payroll

### Added
- **OT (hrs) column** in Payroll (migration **0031**: `ot_hours` + `ot_cents` on the entry): enter the month's overtime hours (halves allowed) and the amount computes itself at the **Employment Act normal-working-day rate — 1.5 × hourly ORP**, where hourly ORP = monthly wage ÷ 26 ÷ 8. The computed RM shows live under the hours box, NET and the TOTAL row include it, and both the hours and the computed sen are stored so the slip reproduces the figure forever
- **Payslip**: EARNINGS gains `OVERTIME (H HRS × 1.5 × HOURLY ORP)`; gross, TOTAL and NETT include it; the staff self-view summary shows OT too
- Scope note: 1.5× covers OT on **normal working days**. Rest-day (2.0×) and public-holiday (3.0×) OT rates exist in the Act — if live sessions start landing on those days, say the word and the column grows the rate split

### Deploy
- `npx wrangler d1 migrations apply azoneofficial --remote` (**0031**) → `npx wrangler deploy` → `pnpm build` → hard refresh


## [1.4.84] — 2026-08-02 — Working days computed truthfully · one-pass payroll flow (proper HRM behaviour)

### The "26 days" problem, resolved
- The CEO is right that Mon–Fri staff will dispute "5 OF 26 DAYS": **26 is NOT the month's working days** — it's the Employment Act's fixed statutory divisor (1/26 of monthly wages per day) that applies ONLY to the unpaid-leave rate. The month's real working days for a Mon–Fri company are computed: **weekdays minus every calendar holiday** — July 2026 = 23 weekdays − Hari Hol (21-07) = **22**. The two numbers now never masquerade as each other:
  - Payslip deduction line reads `UNPAID LEAVE (N DAYS × 1/26 MONTHLY WAGE)` — the statutory rate named explicitly
  - Incomplete-month line reads `INCOMPLETE MONTH (WORKED 5 OF 22 WORKING DAYS)` — the true count
  - OTHERS box now opens with `WORKING DAYS IN MONTH (MON–FRI LESS HOLIDAYS): 22` and `DAYS PRESENT (CLOCKED IN): 5` — the slip explains its own arithmetic, which is the dispute prevention
- Consequence: July nets computed on the honest 22-day basis change slightly (Izzudin 5/22 → net RM 895.45, not RM 773.08) — the previous figures silently under-paid against a Mon–Fri interpretation, exactly the dispute risk being closed

### One-pass payroll (no more one-by-one)
- **Everything auto-fills on opening the month**: Basic from base salaries (v1.4.78) · **Working days (auto)** computed by the server from the calendar · **days worked auto-filled from attendance** (saved values always win; staff with zero punches stay blank = full month, so a non-punching account is never silently zeroed). Flow is now: open month → glance → **Save all** → payslips correct → auto-release on the 5th
- "Auto days from clock-ins" relabelled **Re-fill days** (it now only re-overwrites manual edits); **Save all was already there** and remains the single-click save
- Still deliberately absent, as specified: **no KWSP/SOCSO/EIS** lines — registration pending; the payslip structure gains them the day it lands

### Deploy
- `npx wrangler deploy` → `pnpm build` → hard refresh. No migration. Then open July: working days shows 22, days are pre-filled, press **Save all** once and reprint


## [1.4.83] — 2026-08-02 — Payslip lock now applies to EVERYONE, no processor bypass

### Fixed
- **Why the CEO still saw "My payslip" before the 5th**: v1.4.80 deliberately let payroll processors (CEO/COO/admin tier) bypass the lock on the reasoning that they type the figures anyway. Per the CEO's correction, that exception is **removed** — "My payslip" is now locked for every account, processors included, until the 5th-of-next-month 10:00 MYT moment (or a manual "Release now"). One uniform rule, no early view for anyone
- Unavoidable and stated plainly: the **Payroll processing tab** still shows figures to processors before release — they are the ones entering them. The lock governs the payslip view; the processing tab is already restricted to ceo/coo/admin tier only

### Deploy
- `npx wrangler deploy` → hard refresh. No frontend rebuild strictly required (worker-only change), no migration


## [1.4.82] — 2026-08-02 — Payroll logic correction: full basic + explicit incomplete-month deduction

### The logic review (done before touching code, as requested)
1. The old **Prorate button OVERWROTE Basic** with the reduced figure — the slip then presented RM 673.08 as if it were Izzudin's salary. Money was right, presentation was wrong/unfair
2. The reduced basic wasn't reproducible later (days weren't stored), so a payslip printed next month couldn't show WHY the figure was small
3. **Double-deduction risk found and closed**: unpaid leave already deducts at basic ÷ 26 (v1.4.79); if the incomplete-month adjustment also counted those same missing days, one day would be deducted twice. The formula now excludes unpaid-leave days from the adjustment
4. The panel's NET column ignored the unpaid-leave auto-deduction (slip and table disagreed since v1.4.79) — now every surface uses ONE shared formula
5. Blank days box previously risked being read as 0 days → full deduction; blank now explicitly means "full month, no adjustment"

### Changed
- **One formula everywhere** (`incompleteMonthAdj`, migration **0030** persists `worked_days` + `month_working_days` on the entry): missing = workingDays − workedDays; adjustable = missing − unpaidLeaveDays (never negative); **adjustment = FULL basic × adjustable ÷ workingDays**. Net = basic + commission + allowance − manual deduction − unpaid leave − adjustment. Same net as before (RM 3,500 × 5⁄26 = RM 673.08 either way) — but the payslip now shows **BASIC PAY 3,500.00** and **INCOMPLETE MONTH (5 OF 26 DAYS WORKED) 2,826.92** instead of a shrunken basic
- **Prorate / Prorate all buttons removed** (they were the bug). Flow now: set working days → Auto days from clock-ins → review → Save all; NET updates live and shows "−RM … auto" in red under it when auto-deductions apply
- **Fixing July's already-prorated rows**: a **"Base"** button appears on any row whose Basic differs from the fixed base salary — one click restores the full figure, then set days and Save
- Table NET, footer TOTAL, staff "My payslip" summary and the printed slip all agree by construction now

### Deploy
- `npx wrangler d1 migrations apply azoneofficial --remote` (**0030**) → `npx wrangler deploy` → `pnpm build` → hard refresh. Then in July: click **Base** on each shrunken row, confirm the days boxes, Save all, reprint payslips


## [1.4.81] — 2026-08-02 — Johor public holidays on the events calendar · auto-replacement rule

### Added
- **Johor 2026 public holidays seeded** (migration **0029**) from the official state gazette (johor.gov.my, circular 10 Dec 2025): all 18 gazetted days — Thaipusam through Hari Krismas — plus replacement days per **company policy: a holiday on Saturday or Sunday is replaced on Monday, or the next free working day when Monday is itself a holiday** (2026 replacements: 02-02 Thaipusam, 24-03 + 25-03 Hari Raya Puasa I & II, 02-06 Wesak, 09-11 Deepavali). Honest note: the official state rule replaces **Sundays only** (Saturdays are not replaced by the gazette) — the company rule as specified is more generous; delete a Saturday replacement row in HR → holidays to follow the gazette instead
- **Calendar shows holidays**: red date number, red name chip on desktop / red dot on phones, "Public holiday" in the legend, and the tap-day agenda shows 🏖 with the holiday's name. Everyone sees them — awareness solved
- **Auto-replacement on create**: adding a public holiday that lands on Sat/Sun now auto-creates "<name> (Replacement)" on the computed day, audit-logged. **Manual creation already existed** (as asked to check): HR → "Public holidays & company calendar" has had an Add form with kind = replacement since v1.4.16 — it now sits alongside the automatic rule, and Remove deletes any row

### Deploy
- `npx wrangler d1 migrations apply azoneofficial --remote` (**0029**) → `npx wrangler deploy` → `pnpm build` → hard refresh


## [1.4.80] — 2026-08-02 — Click-to-sort table headers · payslip release control (5th, 10:00 MYT)

### Changed
- **Sorting moved into the table headers** on the attendance corrections table (Staff · Type · Time (MYT) · Mark) and the Team report (Staff · Type · Time): click a header to sort ▲, click again to reverse ▼; combines with the Find-staff filter; the separate Sort dropdowns are gone. Default remains chronological until a header is clicked

### Added
- **Payslip release control** (migration **0028**, `payslip_releases`): staff can view a month's payslip only from the **5th of the following month at 10:00 MYT** (July payroll → visible 05-08-2026 10:00). If the 5th lands on a **weekend or public holiday, the release shifts FORWARD to the next working day** — never earlier, per the requirement that staff must not learn salaries early. For those cases (or any early release the CEO chooses), Payroll shows the month's release status and a **"Release now"** action (payroll processors only, one-way, audited `payroll.release`). Before release, "My payslip" shows a 🔒 lock card with the exact availability date-time; payroll processors bypass the lock (they set the figures). Months already past their release moment stay visible as normal

### Deploy
- `npx wrangler d1 migrations apply azoneofficial --remote` (**0028**) → `npx wrangler deploy` → `pnpm build` → hard refresh


## [1.4.79] — 2026-08-02 — Unpaid leave shows as an explicit payslip deduction · emergency leave confirmed paid

### Changed
- **Unpaid leave now appears ON the payslip as its own deduction line** — `UNPAID LEAVE (N DAYS)` in the DEDUCTIONS box, computed automatically from approved unpaid-leave requests at **basic ÷ 26 per day** (the Employment Act 1955 s.60I ordinary-rate divisor; uses the fixed base salary, falling back to the month's saved basic). Basic stays FULL and the slip shows exactly why nett pay is lower — the fairness the old silent proration lacked. The manual Deduction field's line is relabelled **LATE / OTHER DEDUCTION**; the deductions TOTAL and NETT PAY include both. Applies to processor prints and every staff member's own "My payslip" identically
- **Emergency leave stays PAID and is never deducted** — shown in OTHERS as `EMERGENCY LEAVE (PAID)` with the month's count, alongside a new UNPAID LEAVE day-count row. Legal position: the Employment Act 1955 has **no "emergency leave" category** — it's company practice, most commonly paid against its own small entitlement (ours: 3 days/year) or taken from annual leave; there is no statutory obligation either way, so the 3-day paid policy is a company decision (worth confirming in the employee handbook the lawyer reviews)
- **Payroll panel**: rows with approved unpaid leave show a red **UL:N** flag warning that the payslip deducts it automatically — keep Basic full, don't deduct again (double-punishment guard); header caption updated. `/payroll/attendance-days` now also returns unpaid-leave day counts

### Deploy
- `npx wrangler deploy` → `pnpm build` → hard refresh. No new migration (uses 0027's base salary)


## [1.4.78] — 2026-08-02 — Fixed base salaries (no more monthly retyping) · staff finder on attendance

### Added
- **Base salaries** (migration **0027**: `users.base_salary_cents`): each staff member now has a fixed monthly basic. Every new payroll month **auto-fills Basic from it** — nothing to retype. A **"Base salaries"** button in Payroll opens the editor (one RM figure per person, Save writes only what changed, audited `payroll.base_update`). **Increments happen there**: change the figure once and it applies from the next unsaved month onward — months already saved keep exactly what was saved (history never rewrites itself). Any single month can still be overridden by editing Basic in the table as before (prorating, unpaid days, etc.)
- **"Find staff" filter** on both attendance views: the corrections & back-entry table gains a staff dropdown (from the same list as Add record) showing one person's punches only, with a clear "no records this month" line; the Team report gains the same filter built from the month's names. Both combine with the existing A–Z sort — pick a person, see their whole month in seconds

### Deploy
- `npx wrangler d1 migrations apply azoneofficial --remote` (**0027**) → `npx wrangler deploy` → `pnpm build` → hard refresh. Then open Payroll → Base salaries and enter each person's fixed basic once


## [1.4.77] — 2026-08-02 — Payroll days auto-calculated from clock-ins · Attendance redesigned · Details toggle right-aligned

### Added
- **Payroll ⇄ Attendance auto-calculation**: new `GET /payroll/attendance-days` counts each person's distinct clock-in days for the month (MYT). In Payroll: **"Auto days from clock-ins"** fills every days box in one press, a small **⏱N** beside each box always shows the recorded count, and **"Prorate all"** applies Basic × days ÷ working days to every row at once. The days boxes stay fully editable — that is the manual-correction path for wrong or dishonest punches — and the permanent fix is Attendance → corrections & back-entry, where every amendment is marked and audit-logged. Flow: set working days → Auto days → review/adjust → Prorate all → Save all

### Changed
- **Attendance tab redesigned**: personal view is now a real report — one row per DAY (Date | In | Out | Hours), green In chips, first-in→last-out hour counting, "still in / missing" flag for open days, and a footer totalling days + hours for the month (payroll cross-check at a glance). Team report is now a proper table (Staff | In/Out chip | Time) with the sort control, and the month picker + controls live in the card header instead of floating above it
- **Staff Details**: the Details ▾ / Hide details ▴ toggle moved to the RIGHT end of the button row, as requested
- Corrections card: "Add record" controls now labelled

### Deploy
- `npx wrangler deploy` (new payroll endpoint) → `pnpm build` → hard refresh. No new migration


## [1.4.76] — 2026-08-02 — R2 slimming (image compression + gzipped backups) · events calendar · density polish

### Added
- **Client-side image compression before every R2 upload** (`lib/compress-image.ts`): longest side capped at 1600px, JPEG quality 0.82 — sharp enough for staff photos, claim receipts and site media, typically 5–15× smaller than phone-camera originals. Wired into staff photos (add form + record row), claim receipts, and admin site media. Safety rails: PDFs, videos, documents, GIFs and SVGs pass through untouched; any failure or a larger result falls back to the original. PDFs are NOT recompressed (no reliable in-browser way without quality loss) — they're usually small; if a huge scanned PDF becomes a problem, photograph the receipt as an image instead
- **Nightly backups now gzipped**: `backups/db-YYYY-MM-DD.json.gz` via CompressionStream — JSON dumps shrink ~85–90%, so 30 retained backups cost a fraction of the free-tier 10 GB. Audit records both stored and raw byte counts
- **Events month calendar** — the Dashboard events card now defaults to a professional calendar with a Calendar | List toggle: 7-column month grid (‹ › navigation), today ringed in navy, category-coloured markers (title snippets on desktop, colour dots on phones), colour legend, tap/click a day for its agenda below (with Remove for managers). Events API now returns from the previous month onward so recent history is visible; the list view still shows upcoming only

### Changed
- **Density pass across /portal, /admin and /account** (~40 spots): card padding p-5 → p-4 md:p-5 (p-4 → p-3.5 md:p-4), section stacks space-y-6 → space-y-4 md:space-y-6, grid gaps gap-6 → gap-4 md:gap-6, stat grids gap-4 → gap-3 md:gap-4, page shells px-5 py-6 → px-4 py-4 md:px-5 md:py-6. Phones lose the oversized white space; desktop keeps its comfortable rhythm

### Deploy
- `npx wrangler deploy` (gzip backups) → `pnpm build` → hard refresh. No new migration


## [1.4.75] — 2026-08-02 — Payroll totals · Claims (CEO approves) · Sales revenue on the Dashboard

### Added
- **Payroll month totals**: a bold TOTAL row under the table — Basic / Commission / Allowance / Deduction and the final **NET** payout for the whole month, updating live as figures are typed
- **Claims tab** (migration **0026**, `claims`): CEO, COO, CCO and HR (+admin tier) submit expense claims — date, category (travel/meal/accommodation/equipment/medical/other), amount, description, optional receipt (image/PDF → R2). **Every decision is the CEO's alone** (super_admin retained solely as system-recovery fallback; admin deliberately excluded from deciding). CEO gets a bell notification on each submission and sees a Pending approvals queue with Approve / Reject + optional note; the claimant is notified of the outcome. All actions audited (`claim.create/approve/reject`)
- **Sales revenue card on the Dashboard** for CEO, COO, CCO, sales_marketing, marketing and hr_admin (+admin tier): TikTok Shop revenue (synced order amounts, returned orders excluded), Invoiced revenue (INV documents), and combined Total — this month vs last with a ▲/▼ % change
- **TikTok order amounts now captured** (migration 0026: `postage_records.order_amount_cents`): the sync reads `payment.total_amount` on insert and backfills existing TT- records via COALESCE on the next pass

### Deploy
- `npx wrangler d1 migrations apply azoneofficial --remote` (0023–**0026**) → `npx wrangler deploy` → `pnpm build` → hard refresh. TikTok amounts for the existing 7 orders appear after the next 30-minute sync (or press Sync)


## [1.4.74] — 2026-08-01 — Minimalist Staff Details (collapsed records) · A–Z sorting

### Changed
- **Staff Details is now minimalist: every record collapsed to one line by default** — checkbox, name · role, and a small Employee ID · Position summary. A **"Details ▾"** button expands the full field grid with the Save / Preview badge / Print badge / photo actions; **"Hide details ▴"** collapses it again. Multi-badge printing via the checkboxes still works entirely from the collapsed view
- **Sorting added where names are listed:**
  - **Staff Details**: Sort: Rank (default) · Name A–Z · Name Z–A
  - **Attendance → corrections & back-entry table**: Sort: Time (default) · Name A–Z · Name Z–A (name sort keeps each person's punches in time order)
  - **Attendance → Team report**: same three options (appears only in report mode — your own punch list stays chronological)
- Reviewed the other tabs: Birthdays is already date-ordered (its purpose), leave queues are already stage-ordered, HR staff lists stay rank-sorted per v1.4.36 — adding name sort there would fight orderings that exist for a reason; say the word if any specific list should get it too

### Deploy
- Frontend rebuild only: `pnpm build` → publish → hard refresh


## [1.4.73] — 2026-08-01 — Company events: trainings, classes and important dates every staff member sees

### Added
- **Events module** (migration **0025**, `events` — no foreign keys by policy): title, category (training / class / meeting / event), date, optional start–end time, location, details
- **Upcoming events card on every staff Dashboard** — the first screen after login, so nothing gets missed: date shown DD-MM-YYYY with a **TODAY / Tomorrow / in N days** countdown (TODAY in amber), time, location, who added it. Past events drop off automatically
- **Everyone is bell-notified when an event is created** ("Upcoming training: … on DD-MM-YYYY") — same notification machinery as announcements, including the off-platform relay once NOTIFY_WEBHOOK is configured
- **Inline management** for super_admin / admin / hr_admin / **ceo** / coo / cco: "+ Add event" form and Remove on the Dashboard card; API `GET/POST /api/v1/staff/events`, `PATCH/DELETE /api/v1/staff/events/:id`; all changes audited (`event.create/update/delete`)

### Changed
- **Overview (CEO monitor): the BD-pipeline block is replaced by Upcoming events** (next 60 days) and the "Open BD deals" stat becomes **"Events next 30 days"**. The BD deal pipeline itself is untouched — the CCO's Commercial tab still manages it in full; only the Overview summary changed

### What "BD pipeline" was
- Business-Development deal tracker: prospective client deals by status — open, pending, **kiv** ("keep in view" — parked for later), closed won/lost. The numbers in the screenshot were deal counts entered by the CCO in the Commercial tab

### Deploy
- `npx wrangler d1 migrations apply azoneofficial --remote` (0023–**0025**) → `npx wrangler deploy` → `pnpm build` → hard refresh


## [1.4.72] — 2026-08-01 — Nightly backups · error log + System health card · security recovery checklist

### Added
- **Automated nightly database backups** (03:20 MYT cron): every application table dumped as JSON to R2 under `backups/db-YYYY-MM-DD.json`, newest 30 kept, older pruned. On-demand **"Back up now"** button in /admin. Every backup audited (`system.backup`). D1 Time Travel remains a second, independent recovery path
- **Error log** (migration **0024**, `error_log` — deliberately NO foreign keys so it stays writable even when referential integrity is the problem): auto-records unexpected API 500s (with path), failed audit writes in both worker modules, TikTok cron failures (pre-setup "not configured/authorized" stays silent), and backup failures. Newest 500 kept
- **System health card** in /admin → Audit: last 20 errors + last-backup status with an amber warning when the newest backup is older than 2 days. Endpoints `GET /api/v1/system/health` + `POST /api/v1/system/backup` (admin tier + CEO)
- **Security recovery checklist** written up in SECURITY.md §v1.4.72 — the master-password recovery steps and the `PRAGMA foreign_key_check` orphan cleanup (preserve-history UPDATEs where nullable, targeted DELETEs where not), start to finish

### Changed
- `scheduled()` now branches on the cron expression: `*/30 * * * *` → TikTok sync (failures now recorded), `20 19 * * *` → backup

### Deploy
- `npx wrangler d1 migrations apply azoneofficial --remote` (0023 + **0024**) → `npx wrangler deploy` (registers the new cron) → `pnpm build` → hard refresh → then run the SECURITY.md §v1.4.72 checklist once


## [1.4.71] — 2026-08-01 — Buyer city on TikTok orders · scrollable non-TikTok postage list

### Added
- **Buyer city on TikTok order rows** (📍 beside the date). Migration **0023** adds `buyer_city`; the sync and the webhook path both capture it from TikTok's `recipient_address` — **city only, never the street address** (staff need the rough destination, not the buyer's home; falls back to state if TikTok returns no city level). Existing TT- records backfill automatically on the next sync pass
- Empty-state line for the non-TikTok list ("No non-TikTok postage records yet")

### Changed
- **"Postage tracking — non-TikTok orders" list is now scrollable** (same max-height scroll area as the TikTok card) and shows the full history instead of only the latest 8
- That list now **excludes TT- records** — TikTok orders already live in their own card directly above, so showing them twice was noise

### Deploy
- `npx wrangler d1 migrations apply azoneofficial --remote` (0023) → `npx wrangler deploy` → `pnpm build` → hard refresh


## [1.4.70] — 2026-08-01 — TikTok Orders: tracking numbers shown + status filter (New / Shipped / Delivered)

### Added
- **Tracking number on every TikTok order row.** The sync has captured TikTok tracking numbers since v1.4.67 — the card now displays them: `Tracking: <number> · TikTok`. Orders TikTok hasn't assigned tracking to yet show "No tracking number yet" (it backfills automatically on the next 30-minute sync once the parcel is handed to the courier)
- **Status filter chips** above the order list: **All · New · Shipped · Delivered**, each with a live count. "New" = orders still preparing/awaiting shipment. Returned orders remain visible under All
- Order list capacity raised 20 → 100 (scroll area unchanged) so filters have the full recent history to work with

### About the "(signature FAILED — check app secret)" note on the status line
- That warning means TikTok's **webhook** signature didn't verify against the stored `TIKTOK_APP_SECRET` — unverified pushes are logged then rejected (by design, v1.4.44). The 30-minute pull sync is unaffected, which is why orders still appear
- Fix: Partner Center → your app → copy the **App Secret** exactly → `npx wrangler secret put TIKTOK_APP_SECRET` → paste → `npx wrangler deploy`. The next webhook shows verified. (If the secret was ever regenerated in Partner Center, the stored copy is stale — this is the usual cause)

### Buyer notifications (no code needed)
- TikTok notifies buyers **automatically**: when the order ships (tracking uploaded) and when it's delivered, TikTok Shop pushes in-app/push notifications to the buyer. The statuses this system reads are the same events TikTok has already announced to the buyer — nothing to send from our side
- Manual buyer chat happens in **TikTok Seller Center → Chat** (or the TikTok Shop Seller app). Sending messages via API would require the Customer Service (IM) scope — a sensitive-data scope this system deliberately does not request

### Deploy
- Frontend rebuild only: `pnpm build` → publish → hard refresh. (Plus the one-time `wrangler secret put` above if the signature warning is showing)


## [1.4.69] — 2026-08-01 — Google login: FK failure isolated; audit writes can never break actions

### Fixed
- **The Google-login 500 identified itself as a FOREIGN KEY constraint failure.** Three inserts happen in that flow (audit trail, session, or first-time signup). The most likely culprit after the recent users-table rebuild is the **audit-log insert** — and an audit write should never take down the action it records. Audit writes are now non-fatal everywhere (both worker modules): a failed write logs for the operator and the action proceeds
- If the failure is elsewhere, it now **names its step**: "session insert for user N: …" or "customer signup insert: …" — no more anonymous 500s in this flow
- Session housekeeping (expired-session purge) also made non-fatal

### Diagnose the data side (run once)
- `npx wrangler d1 execute azoneofficial --remote --command "PRAGMA foreign_key_check;"` lists any orphaned rows left by table rebuilds or manual deletions — likely the underlying cause
- `npx wrangler d1 migrations list azoneofficial --remote` confirms 0020–0022 are applied

### Deploy
- `npx wrangler deploy` → retry Google sign-in. Expected: login succeeds; if not, the error names the exact step


## [1.4.68] — 2026-08-01 — Diagnosable 500s (Google sign-in "Something went wrong")

### Changed
- **Unexpected server errors now name the actual failure** in the response (e.g. a database "no such column …" message) instead of only "Something went wrong". Message text only — no stack traces or internals beyond what the engine reports. The Google sign-in failure will identify itself on the next attempt
- The worker already logs the full exception; `npx wrangler tail azoneofficial-api` while reproducing shows it live even before redeploying

### Deploy
- `npx wrangler deploy` → retry Google sign-in → the error message now states the cause


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
