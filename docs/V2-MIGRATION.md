# V2 Migration — Audit and Architecture

**Audited:** 22 September 2026, against local `v1.177.0` (production is `v1.176.2`).
**Scope:** whole repository — `app/`, `components/`, `lib/`, `styles/`, `worker/src/`, `tests/`.
**Status:** audit and plan only. **No V2 code has been written.**

---

## 0. Five corrections to the brief, before anything else

The brief makes five assumptions about this repository that are no longer true. They matter because three of them would send the migration in the wrong direction.

| The brief says | The repository says |
| --- | --- |
| "Tailwind CSS" is part of the stack | **Tailwind was retired in v1.172.2.** There is no `tailwindcss` dependency. Styling is semantic tokens → `.erp-*` classes in `styles/erp-v3.css` → CSS Modules, and `tests/tailwind-retired.mjs` (guard #93) **fails the build** on any utility that `styles/legacy-utilities.css` does not already define. That frozen sheet is shrink-only and budgeted per file in `tests/legacy-utility-budget.json`. A V2 written in utilities cannot compile here. |
| "Redesign Dashboard completely" | Done twice already — v1.175.0 made it role-ordered (`DASHBOARD_ZONES`), v1.176.0 reduced it to a summary. The remaining Dashboard problem is *density above 1024px*, not content. |
| "Transform Waiting on me into an Action Center" | It already is one: **the Desk** (`components/portal/desk-page.tsx`, v1.176.0), a real tab with *Needs your decision* / *Needs attention* / *Your tasks* / *Setup*. What it lacks is inline approve/reject, which is deliberate — see the evidence rule in `components/portal/one-desk.tsx`. |
| "Upgrade the current search into a system-wide search experience" | `components/layout/command-palette.tsx` already does Ctrl/Cmd-K across 8 tables via `/staff/search`, with per-device recents. It needs **grouped results and permission-scoped previews**, not replacing. |
| "Current icon-grid navigation should NOT become an endless grid" | The More sheet is already sectioned, sharing `SECTIONS` with the desktop rail so the two can never disagree (`app/portal/page.tsx:832-835`). |

**The genuinely missing things** are elsewhere, and the audit found them: no router, no layout above 1024px, no type scale, no form field, no error state, no mobile story for wide tables, and a service worker that cannot tell the user an update exists.

---

## 1. STOP — one production data-integrity bug, unrelated to UI

Found while auditing the offline queue. This is live in `v1.176.2` on staff phones **today**.

`lib/outbox.ts:149-154`

```ts
const ok = await tx("readwrite", (s) => { s.put(full); });
notifyChange();
return ok !== undefined || true;
```

`X || true` is **always `true`.** `enqueue()` cannot report failure. When IndexedDB is unavailable — Safari private browsing, storage pressure, a locked database — `tx()` resolves `null`, the punch is **dropped**, and `lib/api.ts:109` returns `{ ok: true, status: 202, queued: true }`, so `components/portal/dashboard.tsx:745` tells the person:

> "Kept — no signal. Sent the moment you are back online."

Nothing was kept. The clock-in does not exist, and it will never arrive. It surfaces later as a missing attendance record, and from there as a wrong payslip.

This violates the brief's own rule — *"Never fake a successful business transaction"* — and the standing house rule that a receipt, OCR result or message must never assert something the system has not verified.

A second, smaller instance sits at `lib/outbox.ts:196-203`: a queued write that returns **5xx is removed from the queue silently**, and `attempts` is written but never read, so there is no retry cap and no backoff.

**Recommendation: fix this as `v1.177.1`, on its own, before the V2 programme starts.** It is a four-line change plus a truthful failure toast. It should not wait behind a design migration.

---

## 2. CURRENT ARCHITECTURE

**Stack.** Next.js 16.3.5 App Router, **static export** (`output: export`, Turbopack) · React 19.3 · TypeScript 5.7+ · ESLint 9 flat config · pnpm 9.15 · Cloudflare Workers + D1 + R2 · `lucide-react` 0.469 · `framer-motion` 12 · `zod` 3.24 (**frontend only** — the worker has none) · Poppins. No chart library, by design.

**Routing.** 16 public marketing routes + `/login`, `/account`, `/admin`, `/admin/permissions`, and `/portal`.

**The portal is one route.** `app/portal/page.tsx` is 1,917 lines, a single `"use client"` component; `app/portal/layout.tsx` is metadata only. All ~33 modules are conditional renders off one `useState` (`:164`), clamped by permission at render time (`:820`). Tab state persists in `sessionStorage` under `azone-tab:{id}`. There is no `useRouter`, no `pushState`, no `popstate` listener. The single deep-link vector — `?tab=` from a push notification — is **read once and erased from the URL** (`:209-214`).

**Backend.** ~228 path literals across 12 worker modules, `staff.ts` alone holding 133. Three-tier dispatch: `route()` → `handleStaff` → per-domain module. One `/api/v1` prefix, no versioning beyond it.

**Data layer.** `lib/api.ts` (one helper, CSRF on every mutation, one-shot CSRF self-heal) → `lib/cached-api.ts` (localStorage stale-while-revalidate, per-account keys, 24h TTL, 400 KB/entry) → a version-counter invalidation protocol (`shared.ts:174-203`) where `bumpVersion()` fires centrally on every successful mutation and clients poll `GET /versions`.

**What is genuinely good here, and must survive the migration:**

1. **`lib/portal-tabs.ts` is a real single source of truth** — order, roles, always-visible, parked, mobile stops — consumed by the rail, bottom bar, More sheet, palette, access-review card *and* the worker, with `tests/registry-parity.mjs` holding them equal. V2 maps routes **onto** this; it does not replace it.
2. **Server-side authorization is real** across the newer modules. ERP, Hankei's, Threads, Hotels and Sales Performance scanned clean — every route gated, `sales-performance.ts` even scoping queries through `scopeIds()`/`owns()`.
3. **The R2 media route is default-deny** after an explicit rewrite (`index.ts:5060`), with per-prefix rules and a fail-closed branch for unparseable keys.
4. **95 build-failing guards**, including `authz-guard`, `csrf-guard`, `api-routes`, `brands-guard`, `origins-guard`, plus three in-repo WebKit browser probes (`tests/browser/`).
5. **Session handling**: opaque token, only its SHA-256 stored, 12h absolute TTL, mandatory 2FA for all 10 staff roles enforced **at the router**, not in the UI.

---

## 3. CURRENT UI PROBLEMS

**A heading hierarchy of one.** `.erp-heading`, `.erp-panel-title` and `.erp-card-title` all resolve to **14px / 600**. There is no size above `.erp-text-lg`. The design system literally cannot express a page title, so every screen's most important words are the same size as its least important.

**No error state anywhere.** There is no `ErrorState` primitive. `DataTable` has no `error` prop. **0 of 12** audited modules show an inline, in-place error — every failure degrades to a toast that appears far from the field that caused it and then vanishes on a timer. `role-panels.tsx:225` still uses `window.alert`.

**Empty states exist but never offer the next step.** 11 of 12 modules have some empty state, but only **1** uses the shared `EmptyState` component, and `emptyAction` — the prop that puts a "Create quotation" button in an empty list — has **zero callers in the entire codebase**.

**`DataTable` is excellent and ignored.** It supports search, filter, sort, pagination, column visibility, density, selection, row actions, sticky header, skeleton, empty state and CSV export. **3 modules use it. 18 hand-roll `<table>`.** The migration stalled at 14%, and because filtering lives inside the table nobody adopted, `.erp-filter-chip` and `.erp-toolbar` have exactly one caller each.

**Forms are assembled by hand in every module.** 43 files use the shared `erp-input` class; only 15 use `erp-label`. `.erp-field` has **1** caller, `.erp-help` **1**, `.erp-label-required` **0**. `aria-invalid` appears in exactly one file — the login page.

**Four hand-rolled copies of the same modal**, two of which are missing `role="dialog"` and `aria-modal` (`roster-board.tsx:2940`, `role-panels.tsx:904`) — so two of four are invisible to a screen reader.

**Six overlapping overlay primitives** in `components/ui/` with three different API styles: imperative (`openAppDialog`, `calendar-dialog`), hook (`useConfirm` — 19 importers, `usePrompt` — 6), and component (`record-detail`, `side-drawer` — 1 each).

---

## 4. TECHNICAL DEBT

**Type safety and logging are effectively perfect** and this is worth saying plainly: **0 typed `any`**, 0 `@ts-ignore`, 0 `@ts-expect-error`, **0 `console.*`** in shipped code. The 13 `as unknown as` are all legitimate browser-API escape hatches, except the three in the hand-rolled drag layer.

The debt is almost entirely **file size**, and it is concentrated:

| Lines | File | What is crammed in |
| --- | --- | --- |
| **5,720** | `components/portal/role-panels.tsx` | Six unrelated domains: HR, TikTok orders, Inventory, Attendance admin, Claims, Expenses |
| **3,488** | `components/portal/sales.tsx` | CRM + packages editor + P&L statement + a document renderer |
| **3,249** | `components/portal/roster-board.tsx` | Week grid + hand-rolled drag-and-drop + leave overlay + PDF export + 4 inline modals |
| **2,266** | `components/portal/dashboard.tsx` | Shell + attendance punch UI + 6 self-fetching summary widgets |
| **2,228** | `components/portal/elfia-store-panel.tsx` | **1 export, 3 top-level functions** — catalogue, editing, image cutout and price sync as one undifferentiated body |
| 1,917 | `app/portal/page.tsx` | Shell + 33 branches + bottom nav + More sheet + notification panel |

13 files exceed 800 lines; the top five are **~30% of all component code**. `lazy-panels.tsx` splits six exports out of `role-panels.tsx` — but they all resolve to **one chunk**, so opening Claims downloads Inventory and TikTok too.

**Legacy-utility debt and size debt are the same debt:** 8 of the 10 least-migrated files are also in the top 12 largest. Total budget 6,936 across 128 files; top 10 = 1,819 (26%).

**Dead code:** `components/staff/leave-review-card.tsx` (277) and `components/portal/next-event-card.tsx` (139) are referenced nowhere — verified including through `lazy-panels.tsx`, the only string-import indirection in the repo. `components/ui/avatar.tsx` (59) is unimported while the same circular avatar is hand-rolled in four places. Plus 101 unused exports, of which the runtime ones worth removing are `SISTER_COMPANIES`, `SkelDonut`, `SkelChart`, `EventsCalendar` and ten in `leave.tsx`.

**Lint: 147 warnings, 0 errors** — and **78 of them trace to one line.** `lib/cached-api.ts:208` is `useEffect(() => { run(); }, [run])`, the shared fetching hook, so every consumer inherits the warning. Five `react-hooks/refs` warnings (`record-detail.tsx:14`, `use-live-refresh.ts:31`) are the "latest callback" idiom written the unsafe way — under React 19 concurrent rendering those can tear, and `use-live-refresh` is on the same hot path.

---

## 5. RESPONSIVE PROBLEMS

**A 1440px window and a 2560px window render identically.** No layout rule in the codebase responds to width above 1024px. The only ≥1280px rules are the rail's default collapse state and one skeleton rule.

**`.erp-page` has `max-width: none`** (`styles/erp-v3.css:90`) while `app/portal/page.tsx:941-949` documents *"One standard width, centred… 1600px is wide enough for the seven-column roster."* **The cap was removed and the justification left behind.** On a wide monitor every module runs edge to edge and prose gets 200-character measures.

**The shell already has desktop side columns the portal refuses to use.** `AppShell` supports `contextPanel` (264px) and `rightRail` (292px); `/admin` and `/account` use them. The portal passes only `navigation`, and puts `ContextPanel`/`RightRail` **inside a collapsed `<details>` at the bottom of the Dashboard** (`app/portal/page.tsx:1589-1596`) — a phone affordance shipped to desktop with 500+px of unused space beside it.

**No master-detail.** `.erp-drawer` is a bottom sheet on phone and a 32rem right drawer from 768px. Even at 2560px, opening a record **covers the list**.

**No sticky desktop action surface.** The only sticky element is `.erp-topbar`. The phone gets a fixed bottom bar; desktop gets nothing — module actions and filters scroll away.

**No breakpoint scale.** 15 distinct width queries in **two syntaxes** for the same values (`min-width: 768px` hand-written vs `width >= 48rem` compiled into the frozen sheet), orphans at 900px and 400px, and `matchMedia` literals duplicated in TypeScript (`app/portal/page.tsx:144`, `:335`) with nothing keeping them in sync. 768px is the only real architectural breakpoint — the shell is binary.

**Mobile has no story for wide tables.** `data-table.module.css` contains **no `@media` rule at all** — identical at 360px and 1440px. `.erp-table-scroll` is used in 4 files. `record-row.tsx:22-24` explicitly excludes Inventory, Payroll and Attendance from the one card-ish primitive that exists — which is exactly the three widest tables.

---

## 6. PWA PROBLEMS

**Present and good:** `viewport-fit=cover`, `appleWebApp` meta, top-inset padding on portal/admin/account/doc headers, bottom-nav and page clearance, `-webkit-tap-highlight-color: transparent`, `overscroll-behavior-y: none`, an iOS install-coaching card, and a proper push + `notificationclick` implementation.

**Ranked defects:**

1. **No update detection at all.** Registration is a bare `register("/sw.js")` (`components/pwa-register.tsx:10`) — no `updatefound`, no `controllerchange`, no periodic `registration.update()`. The user is never told a new version exists. Worse: `skipWaiting()` + `clients.claim()` mean a new worker seizes a **live page** while `activate` deletes the cache that page's not-yet-loaded chunks live in.
2. **No offline fallback page.** `sw.js:56` returns `Response.error()` — a cold offline load of anything outside the 6 precached URLs is Safari's own error page. And `c.addAll(SHELL_URLS).catch(() => {})` swallows precache failure, so install "succeeds" with an empty cache.
3. **The outbox lie** — §1 above.
4. **Cache grows forever.** Every deploy's `/_next/static/*` piles into one cache until the `SHELL = "azone-shell-v34"` constant is hand-bumped.
5. **No `apple-touch-icon`, no splash screens.** The installed iPhone app has no dedicated icon and launches on a blank screen.
6. **Bottom safe-area missing on 11 sheets and modals** — action buttons sit under the home indicator. Only 2 of 13 pad for it.
7. **5xx queued writes dropped silently**, `attempts` never read.
8. **Manifest is thin**: no `id`, `shortcuts`, `screenshots`; a single icon set marked `"any maskable"` with no safe padding, so Android crops the logo.

Also: `visualViewport` is used **nowhere**, so nothing moves when the iOS keyboard covers a sheet's input; scroll locking is `document.body.style.overflow = "hidden"` in 7 places, which does not work on iOS Safari and has no position save/restore; `min-height: 100vh` still on `body`; modal heights use `vh` not `dvh`.

---

## 7. SECURITY CONCERNS

Posture is **better than typical for this size**. The weaknesses cluster in the oldest, largest file.

1. **`GET /api/v1/staff/dashboard/summary` is ungated** — `worker/src/staff.ts:2548`. The only check upstream is "authenticated and not a customer". The handler has **no `can()` call** and returns `cash_in_cents`, `cash_out_cents`, `outstanding_invoices`, `clients` and company-wide attendance punctuality. A `live_host` or `editor` — roles holding neither `revenue_view` nor `finance` — gets all of it with one curl using their own valid cookie. The intent is stated inline (*"the CARD decides per role what to show"*) and the card has no role check either. **This is the exact bug `tests/authz-guard.mjs` was written for, unfixed on this route.** Known since v1.175.0; still open.
2. **Unbounded streaming uploads to R2** — `index.ts:5158`, `staff.ts:2527`, `staff.ts:4165`. Buffered siblings cap at 5–10 MB; the streaming routes pipe `request.body` into R2 with **no length check**, and Content-Type is taken from the client header and never sniffed.
3. ~~**No sibling-session revocation.**~~ **CORRECTED 22 September 2026 — this finding was wrong.** I flagged it "partly unverified" and it is now refuted. Both places that write a `password_hash` revoke every other session immediately: self-service `POST /auth/change-password` (`index.ts:3996-3999` — `UPDATE users … ` then `DELETE FROM sessions WHERE user_id = ?1`, then a fresh session so the legitimate browser stays signed in) and the admin reset in `PATCH /users/:id` (`index.ts:5424-5425`). There is no forgot-password flow at all. A stolen cookie **is** killed by a password change. The claim was also backwards about 2FA: the 2FA-disable path does *not* touch sessions. **The real residual gap is small and different:** `POST /auth/2fa/disable` (`index.ts:3673`) and `2fa/enable` (`:3645`) change the account's authentication factors and leave sibling sessions alive. Smallest safe fix, not yet implemented: mirror `index.ts:3999-4001` in the 2FA handlers.
4. **No schema validation on any request body.** `worker/package.json` has no zod; the TODO at `index.ts:1703` still stands. Validation is per-field opt-in via `str()`/`num()`/`cents()`, so a forgotten field is silently accepted rather than rejected. **Latent, not live** — SQL is uniformly parameterised and no handler iterates over body keys today.
5. **`POST /debug/overflow` is ungated and unrated** — `staff.ts:3500`. Confirmed: no `can()` call. It writes attacker-controlled strings plus `user.email` straight into `error_log` using a raw INSERT, bypassing the deduping `logError()`, so genuine errors can be flooded out of the admin panel.

Also worth noting: sensitive API JSON (salary, revenue, the full staff directory) is cached in **localStorage**, and `app/admin/page.tsx:1185` logs out **without** calling `clearApiCache()`.

---

## 8. COMPONENTS TO KEEP / REFACTOR / RETIRE

**KEEP — untouched, these are the assets**

`lib/portal-tabs.ts` (the registry) · `worker/src/permissions.ts` · `lib/api.ts` + `lib/cached-api.ts` + the version protocol · `components/ui/data-table.tsx` · `components/ui/skeleton.tsx` (69 importers — the one primitive that won) · `components/layout/command-palette.tsx` · `components/layout/side-nav.tsx` · `components/ui/confirm-dialog.tsx` + `prompt-dialog.tsx` · `components/ui/save-toast.tsx` · `components/ui/empty-state.tsx` · `components/portal/desk-page.tsx` + `one-desk.tsx` · `tests/` in full, including `tests/browser/`.

**REFACTOR**

| File | Why | Move |
| --- | --- | --- |
| `role-panels.tsx` (5,720) | #1 in size, lint warnings, unlabelled fields, legacy budget | Split along its six existing export boundaries — `lazy-panels.tsx` already imports them as six names, so this converts one chunk into six |
| `app/portal/page.tsx` (1,917) | Shell markup is unversioned; 33 branches | Extract `TopBar`, `BottomNav`, `MoreSheet`, `NotificationCenter` into `components/layout/`; branches become routes |
| `sales.tsx` (3,488) | Four unrelated products | Split CRM / packages editor / P&L / `DocPreview` |
| `elfia-store-panel.tsx` (2,228) | **1 export, no seams** — and it is the file the ELFIA bridge must hook into | Decompose *before* bridge work, not after |
| `roster-board.tsx` (3,249) | Worst a11y failure in the repo — **unusable without a mouse** | Keyboard-operable cells; adopt the shared modal |
| `lib/cached-api.ts` + `hooks/use-live-refresh.ts` | 78 lint warnings and a React 19 tearing risk trace here | `useSyncExternalStore` + correct latest-ref |
| `stat-card.tsx` vs `stat-tile.tsx` | 2 uses vs 39; the documented split has decayed | Collapse to one |

**RETIRE**

`components/staff/leave-review-card.tsx` (277, unreferenced) · `components/portal/next-event-card.tsx` (139, unreferenced) · `components/layout/sidebar-nav.tsx` (legacy 56px rail, still raw Tailwind, `/admin` + `/account` only — retire with the shell unification) · four of the six overlay primitives (`app-dialog`, `record-detail`, `side-drawer`, `calendar-dialog` — one importer each) · the 101 unused exports.

**Decide, do not guess:** `components/ui/avatar.tsx` is unimported, but `staff-directory.tsx:451` asks for exactly it and four places hand-roll it. Adopt or delete — do not leave it.

---

## 9. PROPOSED V2 ARCHITECTURE

**Principle: this is a re-platforming of the shell and the primitives, not a redesign of the modules.** Every module keeps its data, its API calls and its business rules. What changes is the frame around them and the vocabulary inside them.

### 9.1 The token layer — the foundation everything else needs

Add to `styles/globals.css` the five groups that have **no scale today**:

- **Spacing** — `--space-0…8`, replacing literal rems and the `erp-gap-*` / `erp-mt-*` helpers.
- **Typography** — a real scale with size + weight + line-height + tracking: `display / page-title / section / card-title / body / body-sm / caption / label`. This is what finally lets a page have a title.
- **Z-index** — `--z-base/sticky/topbar/drawer/modal/toast`, replacing the raw 1/10/11/12/30 integers.
- **Motion** — `--dur-fast/base/slow` + two easings, replacing hard-coded `150ms ease`.
- **Breakpoints** — one 4-value scale as custom properties **and** a matching TypeScript constant, so `matchMedia` stops re-typing CSS values.

Extend the two stubs: **radius** to a 5-step scale, **shadow** to a real elevation ladder (the deck's `--erp-hairline` pattern from v1.177.0 generalised).

Guard it: extend `tests/interface-v3.mjs` so a raw `px` font-size, a bare `z-index` integer or a literal breakpoint in `erp-v3.css` fails the build — the same mechanism that made Tailwind's retirement stick.

### 9.2 The router — the single largest change

Replace the 33-branch `useState` with real routes:

```
app/portal/layout.tsx          the shell (rail, topbar, bottom nav, More, notifications)
app/portal/page.tsx            → redirect to the role's home
app/portal/[module]/page.tsx   one module, resolved through lib/portal-tabs.ts
app/portal/[module]/[id]/…     a record — addressable at last
```

The registry stays authoritative: routes are generated **from** `ALL_TABS`, and `canSeeTab` still decides, now in the layout instead of the render branch. What this unlocks, in order of value: Back works · every module and record is bookmarkable and shareable · a push notification can deep-link to the record instead of the tab · **per-module code splitting becomes real** (today `role-panels.tsx` alone is 5,720 lines in the first bundle) · the `<title>` can name the page · breadcrumbs become possible.

Static export supports this; the routes are static shells that fetch client-side exactly as today.

### 9.3 The desktop tier — the ≥1280px layout that does not exist

- Restore a content measure on `.erp-page` (the 1600px the comment already promises).
- Promote `ContextPanel` / `RightRail` **out of the collapsed `<details>`** and into the shell's real side columns, which `AppShell` already implements.
- **Master-detail**: at ≥1280px a record opens in the right column beside the list, not over it. Below that it stays the drawer it is today.
- A **sticky module action bar** — the desktop equivalent of the phone's fixed bottom bar.

### 9.4 The six primitives to build

1. **`FormField`** — label + control + help + error + required + `aria-invalid`. Fixes the 263 unlabelled fields at the source and moves validation from a toast to the field.
2. **`ErrorState`** + an `error` prop on `DataTable` and every fetch surface. 0 of 12 modules have one today.
3. **`RecordCardList`** — the phone rendering of a wide table, explicitly including Inventory, Payroll and Attendance.
4. **`Modal`** — promote the correct copy from `hankeis-panel.tsx:249`; point the four hand-rolled copies at it, which closes two missing-`aria-modal` defects by construction.
5. **`PageHeader`** — title, breadcrumb, actions. The thing that answers *where am I*.
6. **`Chip`** — one component replacing 13 exported class constants.

Then **finish the `DataTable` migration** (18 hand-rollers) and give `EmptyState` its first `emptyAction` callers.

### 9.5 What stays exactly as it is

The permission model. The API surface. Every calculation. The guard suite. The Desk's evidence rule (no inline approvals on rows that do not show the evidence). The registry. The bottom bar never reading a count.

---

## 10. MIGRATION PLAN

**P0 — Foundation (nothing visible ships; everything later depends on it)**

| | Work | Notes |
| --- | --- | --- |
| P0.1 | **Fix the outbox honesty bug** | Ship alone as `v1.177.1`, ahead of everything |
| P0.2 | Token layer: spacing, typography, z-index, motion, breakpoints; radius + shadow scales | + guard extensions |
| P0.3 | Gate `/staff/dashboard/summary`; cap the three streaming uploads; gate `/debug/overflow` | Security, independent of UI |
| P0.4 | `lib/cached-api.ts` + `use-live-refresh.ts` correctness | Clears ~78 warnings, removes a React 19 tearing risk |
| P0.5 | Delete the 2 dead files, decide on `avatar.tsx`, sweep runtime dead exports | Pure subtraction |
| P0.6 | a11y in shared primitives: `data-table` ×4, `password-input`, `prompt-dialog`, `command-palette:233`, `stat-card:71` | ~10 lines, propagates everywhere |

**P1 — Shell and navigation**

P1.1 Extract `TopBar` / `BottomNav` / `MoreSheet` / `NotificationCenter` out of `page.tsx` · P1.2 **Routes** (§9.2) · P1.3 `PageHeader` + breadcrumbs + real `<title>` · P1.4 Desktop ≥1280px tier (§9.3) · P1.5 Retire `sidebar-nav.tsx`, unify on one authenticated shell · P1.6 Grouped, permission-scoped command-palette results.

**P2 — Primitives and module migration**

P2.1 `FormField`, `ErrorState`, `Modal`, `Chip`, `PageHeader`, `RecordCardList` · P2.2 Split `role-panels.tsx` into six (biggest single debt reduction available) · P2.3 Decompose `elfia-store-panel.tsx` — **do this before the ELFIA bridge work, not after** · P2.4 Migrate the 18 hand-rolled tables · P2.5 Split `sales.tsx` · P2.6 `roster-board.tsx` keyboard operability.

**P3 — PWA, polish, performance**

P3.1 SW update detection + offline fallback + cache pruning · P3.2 `apple-touch-icon`, splash screens, manifest `id`/`shortcuts`/`screenshots`, separate maskable icon · P3.3 Bottom safe-area on the 11 sheets; `dvh`; `visualViewport` keyboard handling; a real scroll lock · P3.4 Empty states with CTAs · P3.5 Bundle work now that routes allow splitting · P3.6 Remaining legacy-utility budget.

**Sequencing rule:** the repo's guards fail the build, so each step lands green or does not land. After every P-item: `node scripts/run-guards.mjs`, `tsc --noEmit`, `pnpm lint`, `pnpm build`, then the three browser probes in dark and light, EN and BM.

---

## 11. Decisions needed before P1

Everything in P0 I can begin without asking. These four I will not decide alone:

1. **Routes change URLs.** Today everything is `/portal`. V2 gives `/portal/sales`, `/portal/sales/QT-10342`. Nothing breaks — there are no per-module URLs to preserve — but bookmarks, any saved links and the push-notification payload shape are affected. **Confirm before P1.2.**
2. **`GET /staff/dashboard/summary` currently feeds the Dashboard for every role.** Gating it correctly means some roles stop seeing some figures. That is the correct behaviour and it is a **visible change for real staff**. Confirm which roles should keep cash in/out.
3. **Retiring `sidebar-nav.tsx`** changes the look of `/admin` and `/account`. Confirm those two surfaces are in scope.
4. **CRM pipeline states** (Enquiry → Lead → Qualified → Quotation → Negotiation → Won/Lost → Order): the brief asks not to invent backend states. The existing enquiry/quotation model must be read first; if new states are needed that is a **migration**, documented separately and approved on its own.

Everything else — spacing, sizing, component composition, loading and empty states, minor typography — I will decide and report.

---

## 12. P0 COMPLETION RECORD — what shipped, what did not, and what I got wrong

All six items are done and green. Four releases, none deployed: `v1.177.1`,
`v1.177.2`, `v1.178.0`, `v1.179.0`.

| | Release | Outcome |
| --- | --- | --- |
| P0.1 | `v1.177.1` | The outbox no longer reports a save it did not make. A write is read back before it is called kept; a 5xx retries with backoff and gives up **out loud** after six attempts. `tests/outbox.mjs` 76 → 86 checks; 3 fail on revert. |
| P0.3 | `v1.177.2` | Every dashboard field carries its owning permission. An absent field is **omitted, never zeroed**. The cache gained an **epoch** so yesterday's answer does not outlive the fix. `tests/dashboard-authz.mjs` (new, 157 checks) RUNS the handler as eight roles; 77 fail on revert. |
| P0.2 | `v1.178.0` | Five missing token scales and two stubs, with guards. Two shell classes adopted; every module untouched until P2. `docs/DESIGN-TOKENS-V2.md`, specimen at `/__tokens`. |
| P0.4 | `v1.179.0` | The data layer can tell two answers apart. `tests/cached-api.mjs` (new, 45 checks) RUNS the races; 17 fail on revert. |
| P0.5 | `v1.179.0` | 416 lines of dead components and four dead exports removed. `avatar.tsx` deliberately **not** adopted — see below. |
| P0.6 | `v1.179.0` | Focus restored where WebKit and a bare `outline-none` had removed it; two fields named. Found by walking the real Tab order, not by reading source. |

### Three things this phase found that the audit had wrong

1. **The session-revocation finding was wrong.** The audit flagged it "partly
   unverified"; investigation REFUTED it — both password-write paths already
   `DELETE FROM sessions`. The real residual gap was smaller (2FA
   enable/disable) and was fixed in P0.3. §7 was corrected.
2. **The 78 `set-state-in-effect` warnings were NOT the hook's.** The audit
   read them as attributed to `useCachedApi`'s call sites. Exactly **one** was
   inside `lib/cached-api.ts`. The other 77 are consumer components — 26
   copying the hook's output into their own state, 51 fetching directly and
   never using the hook. P0.4 was still worth doing, for the races; but it was
   never going to clear 78 warnings and this document should not have implied
   it would.
3. **The a11y line numbers were stale.** `data-table.tsx` ×4,
   `password-input.tsx` and `prompt-dialog.tsx` all already had accessible
   names. The real findings — four date pickers WebKit gives no ring at all,
   two genuinely unlabelled fields — only appeared once a probe walked the
   rendered page. A line number in an audit is a hypothesis, not a defect.

### Two P0 items deliberately left undone, needing a decision

- **`components/ui/avatar.tsx`.** It was to replace five hand-rolled avatars.
  It cannot without changing how four screens look: every hand-rolled version
  shows ONE initial and `Avatar` shows two; none is one of its three sizes;
  the topbar's is on a CSS Module, and adopting a utility-class component
  there would push retired utilities back into a file that has left them and
  raise a budget that may only fall. **One shared avatar is a P1 design
  decision.** Until then the file stays, unused and documented.
- **`StatCard` is dead, but `tests/clickable-data.mjs` pins it**, and
  `UNPAID_LEAVE_FROM = "01-09-2026"` is a policy constant nothing enforces.
  Neither is a refactor question.

### The debt P0 did not touch, sized

- **74 `set-state-in-effect` warnings** across ~50 business screens (26 mirror
  a cached hook into state, 48 fetch directly). Real work, real risk, and it
  belongs with the module migration in P2 — not bundled into a data-layer
  refactor where a mistake would be invisible.
- **36 `purity` warnings**, 9 `exhaustive-deps`, 3 `immutability`, 3 `refs`.
- `app/portal/page.tsx` is still 1,917 lines and one route. That is P1.

---

## 13. PROPOSED P1 ARCHITECTURE — for approval, not yet begun

P1 is the shell. It is the phase that changes URLs, so it is the one that
needs a yes before a line is written.

### 13.1 The shape

```
app/portal/layout.tsx          AppShell: TopBar + Nav + NotificationCenter + OfflineBanner
app/portal/page.tsx            Dashboard only (from 1,917 lines to ~120)
app/portal/[section]/page.tsx  one file per destination, reading lib/portal-tabs.ts
components/shell/top-bar.tsx        extracted, not rewritten
components/shell/bottom-nav.tsx     extracted, not rewritten
components/shell/side-rail.tsx      extracted, not rewritten
components/shell/more-sheet.tsx     extracted, not rewritten
components/shell/notification-center.tsx
components/shell/page-header.tsx    the ONE thing that names the destination
components/shell/context-panel.tsx  the >=1280 right rail (new)
```

**`lib/portal-tabs.ts` stays the single registry.** `canSeeTab` and `accessOf`
are not touched, the permission clamp moves into the layout unchanged, and
`/staff/tabs/access/person` is not altered. A route that a person may not see
redirects to their first permitted destination — the same clamp, one level up.

### 13.2 URLs, and what happens to the old ones

`/portal` stays the Dashboard. Each tab becomes `/portal/<slug>` with the slug
derived from the registry, so the route table cannot drift from the tab list —
`tests/registry-parity.mjs` gains that assertion.

**Nothing breaks, and this is the part to confirm:**

- `?tab=<id>` keeps working. `app/portal/page.tsx` reads it and redirects to
  the route, so every existing bookmark, every push-notification payload and
  every deep link in an email still lands where it did.
- `sessionStorage` `azone-tab:{id}` stays as the "where was I" memory for a
  cold open with no path.
- The static export produces one HTML file per section. Cloudflare Pages
  serves them directly; no worker change, no redirect rules.

### 13.3 The desktop tier that does not exist

Nothing in the codebase responds to width above 1024px, so a 1440px window and
a 2560px monitor render identically. P1 adds `xl` (>=1280): a context panel on
the right, master-detail instead of a covering drawer, and a content measure
so a settings form stops spanning a monitor. The tokens and
`lib/breakpoints.ts` for this shipped in P0.2 and are unused until now — which
was the point of doing the foundation first.

### 13.4 What P1 does NOT do

No business logic, no API, no database, no calculation, no permission change,
no module redesign. The panels render inside the new shell exactly as they
render today. If a module looks different after P1, that is a bug.

### 13.5 Sequence, each landing green

P1.1 extract the four shell pieces out of `page.tsx` with no behaviour change
· P1.2 the route table + `?tab=` compatibility + registry parity guard · P1.3
`PageHeader` (the header matches the destination — Desk says Desk) with a real
`<title>` per route · P1.4 the `xl` tier and the context panel · P1.5 retire
`sidebar-nav.tsx` so `/admin` and `/account` use one authenticated shell ·
P1.6 grouped, permission-scoped command-palette results.

### 13.6 The four decisions §11 asked for, restated

Two are now answered: the dashboard RBAC was decided and shipped in P0.3, and
`/admin` + `/account` were confirmed in scope. Two remain, and P1.2 cannot
start without the first:

1. **Routes change URLs** — `/portal/sales`, `/portal/sales/QT-10342`, with
   `?tab=` compatibility as described in 13.2. **Confirm.**
2. **CRM pipeline states** stay a P2 question with its own migration document.
   Nothing in P1 touches them.
