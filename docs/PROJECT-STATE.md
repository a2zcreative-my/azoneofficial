# Project State and Handoff

**Last reviewed:** 21 September 2026  
**Workspace:** `a2zcreative-official`  
**Production:** `a2zcreative.my` — the owner's phone showed `v1.169.0` in the More sheet on 20 September 2026 (commit `8580913`, "portal deploy", pushed 20:31 MYT). Not re-verified with a health check by the v1.170.0 author.
**Local package metadata:** `1.172.2`
**Release status:** `v1.172.0` was committed by the owner on 21 September 2026 (commit `2c00419`, "portal deploy", 10:53 MYT). Local `v1.172.1` (Portal Interface System V3) and `v1.172.2` (Tailwind retired) passed every offline gate (below) and are **not deployed**. `PUSH.bat` has not been run for either. v1.172.2 changes `package.json` and `pnpm-lock.yaml` (removals only): the release commit must include the lockfile, and a `pnpm install --frozen-lockfile` on the CEO's PC is the first thing to run after pulling it.

## Read First

This is the current coordination record for Claude, Codex, and any other contributor. Read it before implementation or release work. The worktree status and the latest diff are authoritative for file ownership; this document is the shared summary, not a replacement for inspecting the diff.

**A stash exists** (`refs/stash`, 19:27 MYT on 20 September, "reset: moving to HEAD" in the reflog beside it). It is another contributor's parked work. v1.170.0 did not touch, apply or drop it.

## Current Local Work — v1.172.2 — Tailwind retired

The owner, 21 September: *"Retire Tailwind properly and update the project / interface documentation so future work uses the new ERP interface system."* Done as one controlled pass, in the order the brief set. **Audit first**: Tailwind's own scanner and engine, run offline, listed every utility the tree used (1,299 across ~150 files) and where. **Engine removed second, losslessly**: `@import "tailwindcss"`, `@custom-variant`, the `@theme inline` bridge, `@tailwindcss/postcss`, `tailwindcss`, `tailwind-merge`, `prettier-plugin-tailwindcss` all gone (`package.json`, `pnpm-lock.yaml` via `pnpm install`, `postcss.config.mjs` with `plugins: {}`, `.prettierrc`, `lib/utils.ts` `cn()` = `clsx`); in their place `styles/erp-reset.css` (the document reset, hand-written) and `styles/legacy-utilities.css` (every utility the unmigrated screens still referenced, compiled once into plain token-based CSS, FROZEN, shrink-only, with `scripts/prune-legacy-utilities.mjs` to shrink it). That swap was proven pixel-identical to the v1.172.1 build before any markup changed. **Priority surfaces migrated third**: the app shell, the portal page, sidebar, drawer, DataTable, skeleton kit, empty state, AppIcon/PanelTitle, row buttons, page-shared, the Dashboard, Attendance, Web Orders, the Claims flow, and the last utility strings in `lib/ui-styles.ts` - now `.erp-*` classes (a LAYOUT AND TYPE PRIMITIVES section in `erp-v3.css`) plus nine CSS Modules for screen-specific layout; zero legacy utilities in each. **Guards fourth**: new #93 `tailwind-retired` (pipeline, stylesheets, order, no undefined utility, a per-file budget that can only fall, migrated surfaces at zero); ten guards updated to read the class or module rule that replaced the string they used to read, none weakened. Registry: 93. Full record and the rules for future UI: `docs/INTERFACE-SYSTEM-V3.md` §0-§5.

Verification for `v1.172.2` (offline, Linux sandbox): `pnpm install` (lockfile removals only); portal `tsc` clean; ESLint 0 errors / 147 warnings (the same set as v1.172.1); **93/93 guards**; `next build` on 16.3.5 exports 31 routes; Chromium against fixtures at 375 / 390 / 430 / 768 / 1280 / 1440 px, light and dark - public pages, the portal shell, Dashboard, On Shift, Claims (form → submit → list), Web Orders (table, drawer), Finance, Attendance and 15 more tabs - no horizontal overflow, no page errors, bottom nav clear of content, 44px controls, no retired tab reachable; 272 screenshots pixel-compared with the v1.172.1 build: identical. Line endings preserved per file. **`PUSH.bat` was not run. Nothing was deployed.** The worktree is dirty (v1.172.1 + v1.172.2) until the owner commits; **dirty-tree approval for v1.172.2: not yet given.**

Known and left alone: the sandbox regression harness's fixture makes one card on the Ecommerce tab throw inside its boundary (identical on the v1.172.1 build - a fixture shape, not a product error); 75 `AppIcon` call sites still carry a dead `h-3.5` / `h-3` token (never applied, see the doc §1); the remaining panels, admin, account and the public site stay on the frozen sheet until their own pass (doc §5).

## Previous Local Work — v1.172.1 — Portal Interface System V3

The owner, 21 September, on the v1.172.0 interface: still messy, inconsistent, crowded, "too much like a generic Tailwind dashboard". The answer is an in-house ERP design system as named CSS classes (`styles/erp-v3.css`) that `lib/ui-styles.ts` now resolves to, so the existing vocabulary carried ~330 field sites and every card, chip, table cell and sheet onto the system without an edit; plus the priority screens rebuilt on the names: portal shell (topbar, bottom nav with gold active hairline and safe-area padding, badge, More sheet), sidebar, Dashboard / On Shift hero (state-of-day chip, one 44px button height), Attendance chips and notes, the Claims flow (pill CTA, segmented type switch, V3 fields at one height, chips, return-to-list after submit), DataTable toolbar / chips / action bar / density, the drawer. 82 hand-rolled controls and ~40 hand-rolled chips across fourteen panels rewritten onto the vocabulary. Nothing installed. Tailwind stays as a compatibility layer - what remains on it, what must not be removed yet, and the next retirement phase are in `docs/INTERFACE-SYSTEM-V3.md`. Guard `interface-v3` (#92, 213 checks) holds the migration boundary and keeps the three retired tabs retired; `inventory-category` updated to read the shared chip. Registry: 92.

Verification for `v1.172.1` (all offline, in a Linux sandbox): portal + worker `tsc` clean; ESLint 0 errors (warnings unchanged from v1.172.0); **92/92 guards**; `next build` on 16.3.5 exports 31 routes; Chromium against fixtures at 375 / 390 / 430 / 768 / 1280 / 1440 px, light and dark - portal shell, Dashboard, On Shift, Claims (form → submit → list), Web Orders (table, drawer, CSV), Finance, Attendance, Users - no horizontal overflow, no page errors, bottom nav clear of content, no retired tab reachable. Line endings preserved per file. **`PUSH.bat` was not run. Nothing was deployed.** The worktree is dirty until the owner commits; **dirty-tree approval for v1.172.1: not yet given.**

## Previous Local Work — v1.172.0

One brief from the owner on 21 September, three objectives, executed as controlled migrations in order and recorded in full in `CHANGELOG.md` under 1.172.0. Baseline first: v1.171.0 at `ad066a5` was proven green on every offline gate (portal + worker `tsc`, 91 guards, ESLint, `next build` + export) before a line changed.

**1. Reconciliation, Ads Fund and Purchasing retired** (not parked). Frontend code removed; `components/portal/purchasing-panels.tsx` deleted and its Accounting half moved to `components/portal/accounting-panel.tsx`; `PUSH.bat [3c/7]` deletes the old file on release. **Worker routes, permissions, tables and migrations for the three are untouched and dormant** - nothing in the portal calls them; removing them is a separate decision for the owner. The Companies review still lists purchase orders and reconciliations as reviewable history, with no register link. The REMOVE / KEEP-DORMANT / SHARED table is in the changelog.

**2. Next.js 15.5.21 → 16.3.5** (registry `latest`, verified). Coupled dependencies only: `react`/`react-dom`/`@types/*` 19.3.0, `eslint-config-next` 16.3.5; `eslint` stays on 9 (the codemod's jump to 10 was reverted - not required); `@eslint/eslintrc` and the deprecated, unused `@cloudflare/next-on-pages` removed. Lockfile regenerated with pnpm 9.15.0; frozen install passes. Migration edits: `favicon.ico` re-encoded RGBA for Turbopack's decoder (same pixels); `lint` script → ESLint CLI over `app components lib hooks constants types`; **`npm run ci` and `PUSH.bat [8/8]` now run `lint` explicitly** because `next build` no longer does; flat config imports the `eslint-config-next@16` presets directly; the five new React-Compiler rules from `eslint-plugin-react-hooks@7` report as **warnings** (documented in `eslint.config.mjs` - not disabled, and every pre-upgrade rule keeps its severity); `tsconfig.json` `jsx: react-jsx` + `.next/dev/types`; `next.config.ts` `agentRules: false` so `next dev` can never write into `CLAUDE.md`; `<html data-scroll-behavior="smooth">` to keep instant scroll-to-top on navigation. Static export, Cloudflare Workers assets, the API worker, D1, R2, wrangler and secrets: unchanged. `wrangler deploy --dry-run` reads the new export (312 files).

**3. Portal UI V2**, evolved on the existing system - nothing installed. Sidebar cut into Overview / Sales / Operations / ELFIA / People / Finance / Account / System (one registry move: Inventory behind Hankei's; `sales-performance` guard updated to fifth), remembered collapse, floating labels on the icon rail, Up/Down/Home/End; the phone More sheet shares the same groups and BM labels. Command palette: Recent (device-local, permission-filtered), icons, real listbox semantics, key hints, reduced-motion-aware entrance. `DataTable` v2: quick filters + active chips + Clear all, selection + contextual action bar (only caller-supplied actions), CSV of selected/visible rows, keyboard rows, density and column visibility remembered per `id`, row actions. New `SideDrawer`. Web Orders adopts the table and the drawer (actions verbatim); Cash Flow and Commission gain filters and CSV. New vocabulary word `menuCard`.

Verification for `v1.172.0` (all offline, in a Linux sandbox):

- portal `tsc --noEmit`: clean; worker `tsc --noEmit`: clean.
- `node scripts/run-guards.mjs`: **all 91 guards passed** (updated: `tab-zones`, `clickable-data`, `app-icons`, `sales-performance`).
- ESLint (`pnpm lint`): 0 errors, 147 warnings - 24 pre-existing + 123 from the five new compiler rules, listed by file in the session; none introduced by the V2 code (the palette's recents use `useSyncExternalStore`, not an effect).
- `next build` on 16.3.5 (Turbopack): compiled, type-checked, exported 31 routes; `tsconfig.json` untouched by the build; `pnpm install --frozen-lockfile` clean.
- Chromium against fixtures at 375 / 390 / 430 / 768 / 1024 / 1280 / 1440 px, light and dark: public pages, 404, portal shell, eight tabs, the new sidebar, tooltip and keyboard, palette Recent, Web Orders table + drawer + CSV download, density/columns persistence, Finance quick filters. No overflow, no page errors, no retired tab reachable.
- Line endings: every edited file keeps the exact original ending on every untouched line (`package.json`, `CHANGELOG.md`, this file, `app/portal/page.tsx` CRLF; the rest LF; `PUSH.bat` as found).
- Not verified here: a real `next dev` session on Windows (the sandbox only builds), Cloudflare Workers Builds on Node 22 with the new lockfile (expected clean: same `npm run ci`, plus `lint`), the four browser-only guards (still unverified since v1.168.0 - see v1.170.0).

**For the owner before `PUSH.bat`:** (a) `pnpm install` will change `node_modules` substantially - run it once and open `pnpm dev` to see the portal on 16 locally; (b) glance at the sidebar groups and the Web Orders drawer on the phone; (c) the worktree will be dirty until committed - commit first or `PUSH.bat allow-dirty` after reviewing the diff. **Dirty-tree approval for v1.172.0: not yet given.**

## Previous Local Work — v1.171.0

Two sittings on 20 September, both from the owner's own screens.

**1. "my dashboard on PWA seem sooooooooo much messy!!! ... clean off my dashboard and resort it based on it own function and properly put in on their own tabs!"** He was asked how to split it and chose *"Me first, company as one card"* and *"Not sure — stress-test everything"*.

The Dashboard is five cards: My day (shift hero) · Waiting on me (One Desk + Watchers in one frame for the executive tier) · My month (one card) · The company (one card) · Around me (Tasks | Leave | News | Events). The month had been shown three ways and the company six; the Sales floor went to Ecommerce as the third pill under "This month", the attendance donut and today's assignments to the Attendance tab under the monitor, the month-by-month bars with the Sales floor, and the phone-only `NextEventCard` was dropped. `.erp-dashboard-stats` / `.erp-dashboard-stat` are gone from `globals.css` with the strip they styled.

**2. "check the flow of this attendance roster! ... I am fucking tired with this flow of you!"** Three defects, all real:

- **The roster could not see the calendar.** `GET /staff/roster` now returns the week's `events` with each one's `attendees`; the board draws an assigned event on that person's row and a whole-floor event (empty attendee list = everyone, migration 0122's rule) once against the day. Phone agenda, counter chip and legend included. Read-only on the board - Events still owns creating and editing. No migration.
- **A task could not be deleted from the board.** Only Unschedule existed (block off the day, task back to the Unscheduled rail). `Delete task` now sits on the grid note, the detail bar and the unscheduled editor, CEO-only (`canDeleteTask` mirrors `task_delete`), behind a confirmation naming the blocks it will take with it. The server route is unchanged and was always CEO-only.
- **Sales Performance credited the wrong person.** Two TikTok orders (17-09, 18:53 and 19:30) went to a `sales_marketing` person whose sales duty ended at 18:00 and who was still clocked in, because the v1.25.6 rule credited everyone clocked in, capped only at 23:59. **The owner chose the replacement on 20-09-2026: "live host wins, shift capped".** An order inside a live belongs to that host alone; outside a live a person earns only inside their planned selling hours (the `sales_shifts` duty) intersected with their punches; a day with neither credits nobody. One definition in `worker/src/shift-sales.ts` (`clipToDuty`, `inAnyLive`, `shiftSalesSplit(..., { duties, lives })`), used by Sales Performance, the leaderboard and commission. **Known consequence, stated to the owner:** a TikTok order outside a live on a day with no sales duty on the roster is now credited to nobody. If sales duty stops being planned, TikTok credit stops. `duties: undefined` (no `sales_shifts` table at all) keeps the old rule; an empty list credits nobody.

- **The roster PDF did not carry the events.** The board learned them; the sheet that goes out to the floor did not, so the printed plan was still made over them. `RosterPdfExtras.events` (optional, last - an older caller still prints): an assigned event as a gold chip on its person's row, whole-floor events once in an `EVERYONE` band under the day headers, a legend entry in a deeper gold than Shopee's, and the week's count in the summary cell (which had to be sized to its column - the fourth count pushed it under the border). New guard `roster-pdf-events` (#91) BUILDS the sheet and reads the events back out of the PDF content stream, so a builder that takes them and ignores them fails. The registry is **91 guards** now.
- **The events calendar could not be edited.** Only create and remove existed on the card, though `PATCH /staff/events/{id}` has taken every field including the attendee list since v1.144.0. The same form now serves both jobs (`editingId` null = new, an id = editing that event), prefilled from the event, reachable from the day agenda and the list, with emptied fields cleared rather than left behind. Guard `event-attendees` gained 9 checks. While there: the attendee picker was wrapped in `Sub`, which is a `<label>` — nested labels meant pressing the caption ticked the first person in the list.

Also fixed: "Claims · 10 of 9 roles" in Tab access control (the count included `super_admin`, which is not an assignable chip); a `DataTable` empty state cut off inside its scrolling frame on a phone; date/number inputs and two range-pill rows overflowing a 375px phone; "Monthly recurring" overlapping "Due day"; watcher findings truncating mid-name.

Verification for `v1.171.0` (all offline, in a Linux sandbox):

- portal `tsc --noEmit`: clean; worker `tsc --noEmit`: clean.
- `node scripts/run-guards.mjs`: **all 91 guards passed**. Updated: `one-desk`, `interface-system`, `desk-tabs`, `tab-zones`, `roster-week` (+11), `sales-performance` (+5), `shift-sales-split` (+11 scenarios, including the owner's exact two orders).
- `next build` static export: compiled and exported; `next lint` on the changed files: clean.
- **The stress test he asked for:** every tab rendered in Chromium at 375px, and again at 375px with text at 115%, against fixtures with long Malaysian names, long titles and large amounts; plus Dashboard, Ecommerce, Attendance and Users at 390/430/768/1280/1440px in both themes. No page overflow, no clipped or escaped controls, no overlaps, no page errors. The only measured flags are by design and predate this release: table headers inside their own scroll frame, and the password eye button over its input.
- The roster board was rendered against a week shaped like his screenshot (sessions, task blocks, sales duty, leave, rest days + three events): the assigned events land on their rows, the whole-floor event on the day, and a task block offers Unschedule and Delete task.
- Line endings: every edited file keeps the exact original ending on every untouched line.
- The four browser-only guards are still unverified against any recent version - see below.

## Previous Local Work — v1.170.0

The owner asked for the "Kehadiran Bulan Ini" idea from a reference attendance app to be brought into the Dashboard, and chose the month breakdown only (no identity strip, no live clock, no PIN, no blue palette — the last two are excluded by `CLAUDE.md`).

What changed:

- **Dashboard**: a new "Attendance this month" card under *My summary* — on time / late / half day / on-time streak, plus the month as a Monday-first calendar of verdicts. `components/portal/dashboard.tsx` (`summariseMonth`, `MonthAttendanceCard`), `components/portal/page-shared.tsx` (`MonthDay` type on `DashCache`). The four-tile `erp-dashboard-stats` strip is unchanged (guard `interface-system` pins it at four).
- **Worker**: `GET /staff/attendance` now also returns `days[]` for the signed-in person (or the `user_id` an attendance-correct role asks for), computed by `myMonthDays()` in `worker/src/staff.ts` with the same functions the verification report and payroll use (`shiftResolver`, `assignedResolver`, `lateAgainst`, `clockedSessions`, leave overlap, `holidaysAround`). Statuses: `ok · late · half_day · assigned · rest_day · holiday · leave · absent · awaiting_approval · pending`. Additive and optional; wrapped so a failure leaves the punches intact. **No migration. No permission change.**
- **Two defects from the owner's phone screenshots fixed**: the shift hero's location inset was white-on-white and the rest-day note grey-on-navy (`styles/globals.css` — the hero now redefines its own tokens; the v1.169.0 class overrides were defeated by Tailwind v4's utilities layer and never applied); the More sheet's "Toggle dark mode" / "Sign out" spilled out of icon circles (`app/portal/page.tsx` — labelled pills now, Sign out in the destructive outline).
- **Interface foundation**: `.erp-table-wrap` / `.erp-table` (sticky header, framed scroll, row hover) and `.erp-empty` in `styles/globals.css`; `components/ui/empty-state.tsx` (new); `components/ui/data-table.tsx` wears the table contract and gains `loading`, `emptyHint`, `emptyAction`. Existing `DataTable` callers (commission, finance, purchasing) are unchanged in behaviour. Hankei's review and packing empties adopt `EmptyState`.
- **Guard `month-days` (#90)**: `tests/month-days.mjs` bundles `worker/src/staff.ts` and runs the classifier against a real `node:sqlite` database built from the real migration files. 22 checks. Registered in `scripts/run-guards.mjs`.

Verification for `v1.170.0` (all offline, in a Linux sandbox):

- portal `tsc --noEmit`: clean; worker `tsc --noEmit`: clean (0 errors).
- `node scripts/run-guards.mjs`: **all 90 guards passed**.
- `next build` static export: compiled and exported (Google Fonts stubbed locally because the sandbox cannot reach fonts.googleapis.com; nothing about that stub is in the repository).
- `next lint` on the changed files: no errors; only pre-existing warnings in `app/portal/page.tsx` far from the edited lines.
- Chromium render of the real build against fixtures shaped like the worker's responses: Dashboard at 390 / 430 / 768 / 1280 / 1440 px, light and dark; More sheet and Inventory at 390 px. No horizontal overflow, no page errors; the location inset measured white text on `rgba(255,255,255,0.09)`; both More-sheet footer buttons are pills whose labels fit.
- Line endings: the repository has mixed CRLF/LF files; every edited file keeps the exact original ending on every untouched line.
- **The four browser-only guards were attempted and do not currently pass** (`bm-coverage`, `leaderboard-sales-floor`, `location-scenarios`, `no-false-attendance`). They are not part of `run-guards.mjs` or the `PUSH.bat` gate, and this handoff record shows no sign of them being run for v1.168.0 or v1.169.0 either. The failures read as staleness against the v1.168.0 portal reorganisation, not as v1.170.0 regressions: `no-false-attendance` reports **violations=0** (its actual safety property - the card never claims "Not clocked in yet" or "No attendance recorded today" while the answer is unknown) and fails only its positive end-state assertion, because its mock delays every request 1800 ms and it reads the page while the skeleton is still up; `leaderboard-sales-floor` cannot find its card on the Ecommerce tab; `bm-coverage` reports a click that does not land. **Nobody has confirmed these against pristine v1.169.0.** Someone should re-point them at the current shell or retire them - a guard that is red for reasons nobody has checked is worse than no guard.

**Not done in v1.170.0, deliberately** (candidates for the next slice, each behind its own guard review):

- Inventory's stock-status summary chips wrap on a 390 px phone; the status card and the All/Low/Out filter row are two filter systems stacked. The panel is 400 KB and `inventory-category`, `tab-zones`, `card-vocabulary` pin its structure — not touched.
- The 768 px header wraps the search field under seven circular controls (pre-existing from v1.168.0).
- Adopting `EmptyState` and the table contract across the other panels — one by one, as the button contract was.
- The streak counts within the current month only; a cross-month streak would need a second month of verdicts.

## Release Decision — v1.172.2

No database migration, no permission change, no worker change. It is the stylesheet pipeline (two packages and two plugins removed, two stylesheets added, one frozen), CSS Modules, component markup, one new guard and ten updated ones. **The lockfile is part of the change**: commit `pnpm-lock.yaml` with it and run `pnpm install` before building on the PC (`PUSH.bat` does). What to watch after `PUSH.bat`: every page looks exactly as v1.172.1 did (it was pixel-compared); the phone bottom nav still clears the content; the Claims form and the Web Orders table read as before; the public site is unchanged. Rollback is a plain `git revert` plus `pnpm install`. Commit first or `PUSH.bat allow-dirty` after reviewing the diff. **Dirty-tree approval for v1.172.2: not yet given.**

## Release Decision — v1.172.1

No database migration, no permission change, no worker change. It is CSS, the style vocabulary, component markup and one new guard. What to watch after `PUSH.bat`: the phone bottom nav sits above the home indicator with a gold hairline under the active stop; the Claims form's fields are all the same height on a 375px phone and a submitted claim lands you on the list; the Web Orders table toolbar and drawer read as before. Rollback is a plain `git revert`. Commit first or `PUSH.bat allow-dirty` after reviewing the diff. **Dirty-tree approval for v1.172.1: not yet given.**

## Release Decision — v1.172.0 (committed by the owner, `2c00419`)

No database migration. No permission-matrix change (three tab names left the worker whitelist; the `*_manage` permissions behind their dormant routes are untouched). What to watch in production after `PUSH.bat`: the More sheet shows `v1.172.0`; every tab still opens; Web Orders opens an order in the drawer and "Mark shipped" still reaches the store; Cash Flow's "auto" rows are intact. Rollback is `git revert` of the release commit plus `pnpm install` - the lockfile is part of the change. The v1.172.0 files are in the worktree without a commit, so a plain `PUSH.bat` will refuse; either commit them first or run `PUSH.bat allow-dirty` after reviewing the diff. **Dirty-tree approval for v1.172.0: not yet given.**

## Release Decision — v1.171.0 (committed by the owner, `ad066a5`)

No database migration. No permission change. The attribution change is the one to watch in production: open Sales Performance for a past week and confirm the credit now sits with the person who was rostered or hosting.

## Release Decision — v1.170.0 (released)

`v1.170.0` has no database migration. Before `PUSH.bat`: the owner should open the Dashboard on the phone and confirm the month card reads correctly against his own punches (it draws from live verdicts; the sandbox only saw fixtures), and glance at the More sheet footer and the hero inset. `PUSH.bat` will run typecheck, the 90 guards and the build again on the office PC. The v1.170.0 files were written to the worktree by the author without a commit, so the strict preflight will refuse a plain `PUSH.bat`; either commit them first (`git add -A && git commit -m "v1.170.0"`) or run `PUSH.bat allow-dirty` after reviewing the diff. **Dirty-tree approval for v1.170.0: given by the owner on 20 September 2026** (asked to release in the session that produced the files); release via `PUSH.bat allow-dirty`.

## Telegram Readiness

The worker API contract and staff review surface exist. The following are still external adapter work and are not implemented in this repository:

- Telegram bot conversation and menus.
- Telegram webhook endpoint and secret validation.
- Telegram `getFile` download and receipt-byte forwarding.
- Outbox claim/send/ack/nack consumer with `event_id` deduplication.

The previously identified server risks are resolved: non-admin settings redact the receiving account, JSON and receipt bodies are bounded while streaming, idempotency keys are reserved atomically, and shipping plus stock changes run in one database batch. The simulator is offline only. It does not send Telegram messages, call a bot, or create production orders.

## Interface Programme — audit (20 September 2026)

Recorded so the next contributor does not repeat it:

- Stack (updated 21 September 2026, v1.172.2): Next.js 16.3.5 App Router (static export, Turbopack) · React 19.3 · TypeScript 5.9 (`^5.7`) · ESLint 9 flat config · **plain CSS**: `styles/erp-reset.css` + `styles/erp-v3.css` (the design system, `components` layer) + `styles/legacy-utilities.css` (frozen, shrink-only) + CSS Modules, semantic tokens in `globals.css` with a `.dark` class theme - **no Tailwind, no PostCSS plugin** · `lucide-react` 0.469 · `framer-motion` 12 · `cva` / `clsx` · hand-built `components/ui` (no shadcn) · pnpm 9.15 · Cloudflare Workers + D1 + R2.
- Already present and not to be duplicated: semantic tokens (`--background … --ring`, `--success/--warning/--danger/--info` and `-soft`, validated tile and chart tokens), the `.erp-button` / `.erp-icon-button` contract, `.skel` shimmer, `screen-enter`, global `:focus-visible`, reduced-motion handling, the command palette (Ctrl/Cmd-K, `components/layout/command-palette.tsx`), the collapsible grouped sidebar, `DataTable`, `SaveToast`, confirm/prompt dialogs, `PermissionPlaceholder`, `app/portal/error.tsx`.
- Decision (20 September): **nothing installed or upgraded**. The existing stack supports every item in the modernisation brief; the work is hierarchy, states and consistency, delivered as slices behind guards.
- 21 September, v1.172.2: **Tailwind retired.** Engine, plugin, `tailwind-merge`, `@theme`, `@custom-variant` gone; `erp-reset.css` and the frozen `legacy-utilities.css` replace them; the shell and priority screens are on `.erp-*` classes and CSS Modules; guard #93 `tailwind-retired` holds it (no package, no at-rule, no undefined utility, a per-file budget that only falls). How to build UI now: `docs/INTERFACE-SYSTEM-V3.md` §0.
- 21 September, v1.172.1: **Portal Interface System V3** - `styles/erp-v3.css` is the design system as named classes; `lib/ui-styles.ts` resolves to it; `tests/interface-v3.mjs` (#92) holds the migration boundary. New UI reaches for a name from `lib/ui-styles.ts` or a class from `erp-v3.css`, never a fresh utility string. See `docs/INTERFACE-SYSTEM-V3.md`.
- 21 September, v1.172.0: the framework moved to Next.js 16 on the owner's instruction (coupled dependencies only, see the changelog); the interface work (Portal UI V2) still installed nothing. `components/ui` gained `side-drawer.tsx`; `data-table.tsx` grew the opt-in filter / selection / density / columns / row-click surface; `lib/ui-styles.ts` gained `menuCard`; `components/layout/side-nav.tsx` exports `SECTIONS`, `SECTION_LABEL_MS`, `sectionTitle`, `NAV_COLLAPSED_KEY`. Device-local preference keys: `azone-nav-collapsed`, `azone-palette-recents`, `azone-table:<id>:density`, `azone-table:<id>:hidden`.

## Collaboration Protocol

1. Read `CLAUDE.md`, this file, `CHANGELOG.md`, and the relevant module docs.
2. Inspect `git status --short` and `git diff --stat`.
3. Preserve existing contributor changes and work in focused files only.
4. Update this handoff record when the status changes.
5. Run the relevant tests before asking another contributor to continue.
6. Use `PUSH.bat` only after the worktree is intentionally prepared and the release gates are green.
