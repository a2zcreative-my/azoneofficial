# Project State and Handoff

**Last reviewed:** 20 September 2026  
**Workspace:** `a2zcreative-official`  
**Production:** `a2zcreative.my` — the owner's phone showed `v1.169.0` in the More sheet on 20 September 2026 (commit `8580913`, "portal deploy", pushed 20:31 MYT). Not re-verified with a health check by the v1.170.0 author.
**Local package metadata:** `1.170.0`
**Release status:** local `v1.170.0` passed every offline gate (below) and is **not deployed**. `PUSH.bat` has not been run for it.

## Read First

This is the current coordination record for Claude, Codex, and any other contributor. Read it before implementation or release work. The worktree status and the latest diff are authoritative for file ownership; this document is the shared summary, not a replacement for inspecting the diff.

**A stash exists** (`refs/stash`, 19:27 MYT on 20 September, "reset: moving to HEAD" in the reflog beside it). It is another contributor's parked work. v1.170.0 did not touch, apply or drop it.

## Current Local Work — v1.170.0

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

## Release Decision

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

- Stack: Next.js 15.5.21 App Router (static export) · React 19 · TypeScript 5.7 · Tailwind v4 via `@tailwindcss/postcss` with CSS-first `@theme inline` tokens and a `.dark` class variant · `lucide-react` 0.469 · `framer-motion` 12 · `cva` / `clsx` / `tailwind-merge` · hand-built `components/ui` (no shadcn) · pnpm 9.15 · Cloudflare Workers + D1 + R2.
- Already present and not to be duplicated: semantic tokens (`--background … --ring`, `--success/--warning/--danger/--info` and `-soft`, validated tile and chart tokens), the `.erp-button` / `.erp-icon-button` contract, `.skel` shimmer, `screen-enter`, global `:focus-visible`, reduced-motion handling, the command palette (Ctrl/Cmd-K, `components/layout/command-palette.tsx`), the collapsible grouped sidebar, `DataTable`, `SaveToast`, confirm/prompt dialogs, `PermissionPlaceholder`, `app/portal/error.tsx`.
- Decision: **nothing installed or upgraded**. The existing stack supports every item in the modernisation brief; the work is hierarchy, states and consistency, delivered as slices behind guards.

## Collaboration Protocol

1. Read `CLAUDE.md`, this file, `CHANGELOG.md`, and the relevant module docs.
2. Inspect `git status --short` and `git diff --stat`.
3. Preserve existing contributor changes and work in focused files only.
4. Update this handoff record when the status changes.
5. Run the relevant tests before asking another contributor to continue.
6. Use `PUSH.bat` only after the worktree is intentionally prepared and the release gates are green.
