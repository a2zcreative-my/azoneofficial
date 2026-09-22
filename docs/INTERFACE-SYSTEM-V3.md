# Portal Interface System V3

**Introduced:** v1.172.1 (21 September 2026). **Tailwind retired:** v1.172.2 (21 September 2026). **Owner files:** `styles/erp-v3.css`, `styles/erp-reset.css`, `styles/legacy-utilities.css`, `lib/ui-styles.ts`. **Tab concept:** v1.173.0 (21 September 2026). **Guards:** `tests/interface-v3.mjs` (#92), `tests/tailwind-retired.mjs` (#93), `tests/tab-concept.mjs` (#94).

The portal has an in-house ERP design system: named CSS classes, in the semantic tokens, exposed to TypeScript through `lib/ui-styles.ts`, with CSS Modules for a screen's own layout. **Tailwind is gone** — the package, its PostCSS plugin, the prettier plugin, `tailwind-merge`, `@import "tailwindcss"`, `@custom-variant` and `@theme`. Nothing was installed in its place: no MUI, Ant Design, Chakra, Mantine, Bootstrap, shadcn. The stylesheet is four plain CSS files and the CSS Modules beside the migrated components.

## 0. How to build UI now (read this first)

1. **A surface, a control, a chip, a table cell, a button:** use the vocabulary in `lib/ui-styles.ts` (`card`, `inputClass`, `selectClass`, `btnSm`, `chipSuccess`, `th`/`td`, `rowHead`, `listRow`, `sheetCard` …) or the `.erp-*` class it resolves to. Every name is documented in `styles/erp-v3.css`; the file's header lists what it owns.
   - **An overlay** (a sheet, a modal, a menu, a toast) is `sheetCard` / `modalCard` / `menuCard` / `toastCard` — never a `var(--card)` box of its own. Those four classes re-anchor to the PAGE's tokens (`--erp-page-*`, captured on `:root`), so an overlay reads the same whatever surface it is rendered inside. Two surfaces carry their own tokens for the controls on them — the navy shift hero (`.erp-shift-hero`, globals.css) and `.erp-action-bar` — and custom properties inherit through the DOM, not the stacking order: a `position: fixed` toast rendered from inside the hero inherited `--card: 6% white` and `--card-foreground: #fff` and came out as a see-through band on the CEO's phone (v1.174.2). The toast is a card in the middle of the screen (`max-width: min(24rem, calc(100% - 3rem))`), never a band.
2. **A row, a stack, a grid of cards, an icon, a muted line, a rhythm step:** the layout and type primitives in `erp-v3.css` (section *LAYOUT AND TYPE PRIMITIVES*):
   - stacks: `erp-stack` (1rem, 1.5rem from `md`), `erp-stack-tight` (0.75rem / 1rem) — block flow with collapsing margins, exactly what `space-y-*` was
   - rows: `erp-flex` (+ `-between`, `-wrap`, `-top`, `-bottom`, `-baseline`, `-end`, `-col`), `erp-gap-1..4`, `erp-grow`, `erp-row-lead` (grows, keeps 14rem before the actions beside it wrap under), `erp-fixed`, `erp-min0`, `erp-full`, `erp-center`, `erp-divide`, `erp-scroll-x`
   - grids: `erp-cols-2`, `erp-cols-3`, `erp-cols-4` (two columns on a phone, their count from `md`); `erp-zone-grid-2/-3` (ONE column on a phone, side by side from 1024px — a zone's cards); `erp-tiles` (+ `-2/-3/-5/-6`: the summary tier, 2 across on a phone, 3 from 640px, 4 or the named count from 1024px)
   - rhythm: `erp-mt-half` (2px), `erp-mt-1..4`, `erp-mt-6`, `erp-mb-3` — the only spacing helpers
   - icons: `erp-icon` (16px), `erp-icon-sm` (14), `erp-icon-md` (18), `erp-icon-lg` (20); `AppIcon` is always 16px unless given one of these
   - type: `erp-text-xs/sm/base/lg`, `erp-muted`, `erp-meta` (12px muted), `erp-heading` (14px semibold), `erp-panel-title` (heading with an icon slot), `erp-eyebrow`, `erp-strong`, `erp-medium`, `erp-num`, `erp-truncate`, `erp-nowrap`, `erp-left/right/centered`, `erp-danger/success/warning`
   - lists: `erp-list-row` (the hover row), `erp-none` (the quiet "nothing here" line), `erp-avatar` (a 32px round well), `erp-row-actions`, `erp-pill-row`, `erp-quiet-*`, `erp-reveal`
   - **a row** is `erp-row-lead` (the words; grows, keeps 14rem before the actions wrap under) + `erp-row-actions` (the controls; wraps, shrinks, left on a phone and right from 640px). Never `shrink-0` on a wrapping group — a flex item that may not shrink is sized by its one-line max-content, so its `flex-wrap` never acts (v1.174.3: the Sales rows cut at "Report link", the Attendance overtime buttons off the edge). A small field among the actions shrinks automatically; a date/month/time control is excluded and keeps its width floor, because an empty one collapses on iOS and shows its `placeholder` instead.
   - **tables**: a table wider than a phone scrolls inside its card; if the reader needs the first column to make sense of the rest (a name beside money), add `tbl-sticky-lead` beside `tbl-sticky` so it pins to the left edge while the rest scrolls (v1.174.3, Payroll).
   - shell: `erp-page`, `erp-page-clearance` (clears the phone bottom nav), `erp-bottom-nav`, `erp-topbar`, `erp-desktop-only` / `erp-phone-only` (display:none on the other side of 768px — the ONLY responsive helpers)
3. **A layout that belongs to one screen** (a hero, a two-column form, a calendar, a table's own chrome): a **CSS Module** beside the component — `dashboard.module.css`, `claims.module.css`, `attendance.module.css`, `data-table.module.css`, `portal.module.css`, `app-shell.module.css` are the models. Rules: tokens only (`var(--card)`, `var(--border)`, `var(--success)` …); breakpoints at 640 / 768 / 1024 / 1280px; a module never restyles an `.erp-*` class, it adds the geometry around it; class names say what the box is (`.heroHead`, `.fenceLine`, `.pager`), not how it looks.
4. **A colour:** a token from `styles/globals.css` `:root` / `.dark` (`--background`, `--foreground`, `--card`, `--border`, `--primary`, `--secondary`, `--muted-foreground`, `--success/-soft`, `--warning/-soft`, `--danger/-soft`, `--info/-soft`, `--plan`, `--celebrate`, `--brand-primary`, `--brand-accent`, `--gold-solid`, `--tint-gold`, `--tint-navy`, the `--ring-*` and `--tile-*` chart steps, `--ink-on-navy-*`). Never a hex value in a component or a module.
5. **Never:** a new utility class (`flex items-center gap-2`, `mt-2`, `text-xs`) in any file — nothing generates CSS for it, and guard #93 fails the build on one the frozen sheet does not define; a `dark:` / `md:` / `hover:` prefix (a token already knows the theme; a module has the media query); an inline `style` for something a class can say; a Tailwind package, `@tailwindcss/postcss`, `tailwind-merge`, `prettier-plugin-tailwindcss`, `tailwindcss-animate`.

## 1. What replaced Tailwind (v1.172.2)

| Was | Now |
| --- | --- |
| `@import "tailwindcss"` (engine + preflight + utilities) | `styles/erp-reset.css` — the document reset, hand-written, `@layer base`; `styles/legacy-utilities.css` — see §3 |
| `@tailwindcss/postcss` in `postcss.config.mjs` | `plugins: {}` — the file stays so Next.js applies no defaults; the bundler processes plain CSS |
| `@custom-variant dark` | the `.dark` class on `<html>`, as before; the frozen `dark:` utilities compiled to `:where(.dark, .dark *)` |
| `@theme inline { --color-primary: var(--primary) … }` | gone — colour utilities were compiled with the token inlined (`.bg-card { background-color: var(--card) }`); `--font-sans`, `--radius-shell`, `--radius-card`, `--radius-panel`, `--shadow-soft`, `--shadow-shell` are plain `:root` properties |
| `tailwind-merge` in `cn()` | `clsx` only — `cn()` joins; the one caller that relied on a later utility overriding an earlier one (`components/home/cta.tsx`) passes `<Section neutral>` instead |
| `prettier-plugin-tailwindcss` | removed from `.prettierrc` |
| utility strings in the vocabulary (`mobileBottomNav`, `mobileAppBottomClearance`, `PORTAL_WIDTH`, `inputClassLg`, `btnHdrDesktop`, `btnQuick*`/`btnHero*`, `selectClass`, `iconBtn`, `tabPill`) | `.erp-bottom-nav`, `.erp-page-clearance`, `.erp-page`, `.erp-input-public`, `.erp-desktop-only`, `.erp-button-quick`, the select's own `sm` width, `.erp-icon-button-muted`, `.erp-tab-pill` |
| `rowBtn*` disabled utilities, `rowActions` | `.erp-button-off`, `.erp-row-actions` |
| `AppIcon` `inline-block h-4 w-4 shrink-0`; `PanelTitle` utilities | `.erp-icon .erp-icon-inline`; `.erp-panel-title` |

The cascade order is declared once at the top of `erp-reset.css` and repeated in `globals.css`: `properties < theme < base < components < utilities < unlayered`. `erp-v3.css` is the `components` layer, the frozen sheet the `utilities` layer, CSS Modules and the rules in `globals.css` are unlayered. So: a frozen utility still beats a V3 class on a screen that has not migrated (as it did under Tailwind), and a CSS Module beats both — which is what lets a module set the geometry around an `.erp-*` class.

One deliberate exception sits **outside** the layers at the end of `erp-v3.css`: `AppIcon`'s 16px size. Seventy-five call sites still carry a legacy `h-3.5 w-3.5` / `h-3 w-3` on an `AppIcon`; those never applied under Tailwind either (its sheet ordered `h-4` after them), so the unlayered rule keeps every icon at the size the interface was reviewed at. Resize one with `erp-icon-sm/-md/-lg` or a module class.

## 2. Which screens are off utilities (guard #93 holds them there)

`app/layout.tsx`, `app/portal/page.tsx` (the whole page: gate, step-up, topbar, More sheet, tab bodies), `components/layout/app-shell.tsx`, `side-nav.tsx`, `components/ui/side-drawer.tsx`, `data-table.tsx`, `skeleton.tsx`, `empty-state.tsx`, `app-icon.tsx`, `row-button.tsx`, `components/portal/page-shared.tsx`, `portal-skeleton.tsx`, `dashboard.tsx` (hero, month card, work overview, punch toast, every summary), `attendance.tsx`, `web-orders-panel.tsx`, the Claims flow in `role-panels.tsx`, `lib/ui-styles.ts`, `lib/utils.ts`. Each references **zero** legacy utilities; the guard lists them in `MIGRATED`.

The look did not move: every screen above was pixel-compared against the v1.172.1 build at 375 / 768 / 1440 px, light and dark (272 screenshots), and matched to the antialiasing.

## 3. The frozen legacy sheet — `styles/legacy-utilities.css`

Every utility class the unmigrated screens still referenced on retirement day (≈1,100 selectors across the public site, admin, account and the remaining panels) was compiled **once** into plain CSS: rem spacing, the semantic tokens, `.dark` ancestors, media queries. No engine reads it; it is a static stylesheet this repository owns. Rules, also in its header:

1. It only shrinks. Never add a class to it.
2. When a screen migrates, run `node scripts/prune-legacy-utilities.mjs` (report) and `--write` (remove the rules nothing references any more), then `node tests/tailwind-retired.mjs --write-budget` to lower that file's floor.
3. Do not "fix" a legacy rule to change a look — change the component.
4. `--lu-*` custom properties are its private plumbing (transforms, shadows, rings, gradients); nothing else reads them.
5. Its `:root` block carries Tailwind's default scale (`--text-sm`, `--font-weight-semibold`, `--radius-2xl` …) and the seven palette colours unmigrated screens still use (amber, red, emerald, sky, violet, slate) — frozen, do not extend; migrate the screen to `--warning` / `--danger` / `--success` / `--info` / `--plan` instead.

`tests/legacy-utility-budget.json` records, per file, how many legacy classes it references (128 files, ≈7,000 references at v1.172.2). A file may only go down; a new file may reference none. That is the ratchet: Tailwind's utilities cannot grow back, screen by screen they disappear.

## 4. What must not be removed or reintroduced

- The `.erp-button` / `.erp-icon-button` block in `globals.css` — `tests/interface-system.mjs` reads it there.
- The `.erp-table*` frame in `globals.css` — the sticky-header contract.
- The inline `paddingTop: calc(var(--hdr-pt) + env(safe-area-inset-top, 0px))` on the portal `<header className="erp-topbar">` — `tests/shell-scroll.mjs` proves the status-bar inset is *added* to the bar's own padding (`--hdr-pt` is owned by `.erp-topbar` now).
- The unlayered `AppIcon` size rule at the end of `erp-v3.css` (§1).
- The cascade-layer declaration and the import order in `globals.css` / `erp-reset.css`.
- Any Tailwind package, at-rule or plugin (guard #93 enumerates them). `cn()` must stay `clsx` only.

## 5. Next phases (each one is: migrate, prune, write-budget, guard)

1. The remaining portal panels (`sales.tsx`, `roster-board.tsx`, `payroll-panel.tsx`, `hankeis-panel.tsx`, `staff-directory.tsx`, `events.tsx`, `hotels-panel.tsx`, `threads-panel.tsx` …): a CSS Module each for their own layout, the primitives for the rest. Add each file to guard #93's `MIGRATED` list as it lands.
2. `app/admin/*` and `app/account/*`: they share the vocabulary already; their page frames want the portal's module pattern (`portal.module.css` is the model).
3. The public site (`components/home/*`, `navbar.tsx`, `footer.tsx`, `components/ui/button.tsx`, the marketing pages): its own module set and type scale; last, because nothing there drifts.
4. When the budget file is empty, delete `styles/legacy-utilities.css`, its import and the `utilities` layer; guard #93 then asserts the file is gone.

## 6. Verification (v1.172.2, offline, Linux sandbox)

- `pnpm install` regenerated `pnpm-lock.yaml` (Tailwind, `@tailwindcss/*`, `tailwind-merge`, `prettier-plugin-tailwindcss` and their dependents removed; nothing added).
- `npm run typecheck`: clean. `npm run lint`: 0 errors, 147 warnings (the same pre-existing set as v1.172.1).
- `npm run guard`: **93/93** (new: `tailwind-retired`, 58 checks; updated legitimately, never weakened: `interface-v3`, `status-tokens`, `pwa-calendar`, `shell-scroll`, `login-ux`, `action-feedback`, `app-icons`, `skeleton-loading`, `tab-zones`, `desk-tabs` — each now reads the named class or the module rule that replaced the utility string it used to read).
- `npm run build` (Next.js 16.3.5, Turbopack, static export): 31 routes; the CSS is three chunks (reset + V3 + frozen sheet, globals, CSS Modules).
- Chromium against fixtures, 375 / 390 / 430 / 768 / 1280 / 1440 px, light and dark: public pages, the portal shell, Dashboard, On Shift, Claims (form → submit → back at the list), Web Orders (table, drawer), Finance, Attendance and 15 more tabs — no horizontal overflow, no page errors, bottom nav clear of content (page clearance ≥ nav height), 44px controls, no retired tab reachable. 272 screenshots pixel-compared with the v1.172.1 build: identical.

## 7. Release state

`PUSH.bat` was **not** run. Nothing was deployed. The worktree is dirty with the v1.172.1 + v1.172.2 files until the owner commits.

## 8. The tab concept (v1.173.0) — every tab reads like the Dashboard

The CEO, 21-09-2026: *"All the tabs should responsive with PWA and also Web view and the tabs should work like Dashboard concept style designed"*, and chose all three of the Dashboard's habits. Guard #94 (`tests/tab-concept.mjs`) holds every tab in `lib/portal-tabs.ts` to them; `components/portal/tab-concept.tsx` is what a tab is built from.

**The shape.** A tab body is `<TabPage>` — the shared stack (`erp-stack erp-tab-page`) — holding `<TabZone label=…>` sections (`erp-stack-tight erp-tab-zone`, opened by the shared small-caps `ZoneLabel`). Zone order, top to bottom: **the figures** (AT A GLANCE / THIS MONTH / TODAY — a `SummaryStrip` of `SummaryStat`s or a `StatStrip` of `StatTile`s), **the work** (what this person does here: WAITING ON ME, THE WORK, APPLY, SUBMIT), **the records** (THE RECORDS, THE ARCHIVE, THE DIRECTORY, THE MAP), **setup** (SETUP, THE RATES, ADMINISTRATION). A zone with several cards takes `cols={2}` (or 3): one column on a phone, side by side from 1024px, cards aligned at the top. Every card is `card` (`.erp-card`) with a heading; one thing per card.

**The figures.** `SummaryStat` is one figure, one label, an optional hint; its tone (`success / warning / danger / brand`) colours the value only, from tokens. It is a plain `div` until something is behind it — then a `button` (`erp-stat-button`) with `aria-pressed` and a `title`, and `active` rings it: *"clickable data without me need to open another new tabs"* (v1.88.0). Enquiries' figures set the filter they count; Claims' scope the list by status; Assets' by asset status; Content's by stage; Web Orders' by shipment state; Hotels' recolour the map. `busy` shows `···` until the number is KNOWN — never a false zero (v1.25.1). Every figure is derived from the rows the panel already holds; the concept adds no request. Tabs whose figures are the old solid tiles (Finance, Accounting, Commission, Hankei's, Sales Performance) keep `StatTile`; `StatStrip` is now the same `erp-tiles` grid, so both kinds line up.

**The pill row.** Several things on one topic in one card, one at a time: `PillCard` (title, `SectionTabs`, one `erp-pane` per pill, `hidden` — never unmounted, a half-typed form survives a look at the list, v1.123.0), or the existing `SectionTabs` cards (Dashboard's Work overview, Sales' The work and Customers, Inventory's Record and What moved, Users). Every chooser that used to hand-roll a pill (Leave's board/entitlement, Threads' Study/Connection and its topics, Companies' review/setup, Hankei's screens) now wears `tabPill` / `tabPillOn` in an `erp-pill-row`. Leave's chooser still toggles off (v1.92.0).

**Responsive — one source order for the phone, the installed app and the web view.** *(v1.174.1: a tab body is never a grid — a grid track grows to its widest item, scroller or not, and the deployed v1.173.0 Ecommerce grid took every card off the iPhone; every module grid names `minmax(0, …)` tracks, zones and stacks are `min-width: 0`, cards `overflow-wrap: anywhere`, and the phone workspace fills the screen. Verified in WebKit as well as Chromium.)* No `order-*`, no viewport-dependent reordering (tests/tab-zones.mjs): the DOM order is the reading order at every width. On a phone (375–430px) every zone is one column, the tiles two across, the pill rows wrap, a table scrolls inside its card (`erp-table-scroll` / the module's own scroller), and `erp-page-clearance` keeps the last card above the bottom bar (v3check: clearance ≥ nav height). From 640px the tiles go three across; from 768px the rail replaces the bottom bar and the stack rhythm opens (1.5rem between zones); from 1024px zone grids and `erp-cols-*` split, tiles four (or six) across; 1280–1440px is the same page with wider gutters. Nothing in the concept reads the viewport in JavaScript.

**Where each tab now stands (all 31 in `ALL_TABS`; Dashboard and On Shift are the reference).**

| Tab | Zones (top → bottom) | Figures | Pill row |
|---|---|---|---|
| Ecommerce | This month · The work · The longer view · Setup (v1.171.0, unchanged) | RevenueAndHoursCard | revenue card |
| Sales | At a glance · The work · Customers (panel) · This month (map) · The longer view (2 up) | quotations / invoiced / paid / unpaid — each opens the work | The work, Customers |
| Enquiries | At a glance · The inbox | waiting / overdue / answered / became business → filter | status filters |
| Sales Performance | header · KPI summary · The evidence · The score · The longer view | six StatTiles | range pills |
| Hankei's | header (screen pills) · Today · The money · The work / one zone per screen | StatTiles | screens |
| Inventory | Stock now · Record · What moved · Setup (v1.119.0, on the shared classes) | status card | Record, What moved |
| Assets | At a glance · The register · The editor | per status → filter, value | — |
| Hotels | At a glance · The directory · The map | hotels / states / contacted / agreed / published → map mode | — |
| Threads | Threads (Study \| Connection) · The study / The connection | — | section, topics |
| ELFIA Store | The shop · Products · The shopfront · Settings (v1.122.0, on the shared classes) | shop figures | — |
| Web Orders | At a glance · The orders | orders / value / to ship / shipped → filter | status pills |
| ELFIA Traffic | The map · Accuracy and reach (2 up) | totals row | — |
| HR | Reports · Administration · People | — | — |
| Attendance | Today · Waiting on me (2 up) · The roster · Setup | company today (donut) | roster |
| Tasks | At a glance · The work · New task · The longer view · The archive | open / overdue / pending / closed | — |
| Announcements | At a glance · Waiting on me · Publish · The archive | to acknowledge / acknowledged / all | — |
| Staff Details | At a glance · The directory | records / active / departments | directory \| organisation \| team map |
| Leave | My balances · Apply · The company · My history | balance tiles | board \| entitlement (toggles off) |
| Claims | This month · Waiting on me · Submit · The records | pending / approved / paid / rejected → scope | claim type |
| Payroll | The run · Setup | — | — |
| Finance | This month (cash) · Record an expense · Waiting on me · Reporting · The records | CashFlow StatTiles | — |
| Commission | This month · The decisions · The calculation · The rates | StatTiles | — |
| Accounting | At a glance · The books · Adjustments | StatTiles | — |
| Companies | Administration · The review / Staff setup | — | review \| setup |
| Cards | The officers | — | — |
| Profile | My details · My pay · Security and privacy | — | — |
| Users | Accounts · Access and locations (2 up) | — | UsersPanel |
| Stokis | This month · The network | active / sales / balance | — |
| Content | The pipeline · The work | one per stage → filter | — |

**Verification (v1.173.0, offline, fixtures).** typecheck clean; lint 0 errors / 147 warnings (unchanged set); guard 94/94; `next build` 31 routes; Chromium at 375 / 390 / 430 / 768 / 1280 / 1440, light and dark, every live tab with populated fixtures: no horizontal overflow, no page errors beyond the harness's pre-existing Ecommerce fixture gap, bottom nav cleared, v3check and the regression probe green. `PUSH.bat` not run.

**What did not change.** No business rule, request, permission or record: the concept is layout. Every pinned order (tests/tab-zones.mjs, desk-tabs, inventory-category, card-vocabulary, users-ui, sales-performance, unpaid-leave …) still holds; where a guard read the old spelling of the same fact, it now reads the new one. Retired tabs stay retired.
