# Portal Interface System V3

**Introduced:** v1.172.1 (21 September 2026). **Owner files:** `styles/erp-v3.css`, `lib/ui-styles.ts`. **Guard:** `tests/interface-v3.mjs` (#92).

The portal has an in-house ERP design system: named CSS classes, in the semantic tokens, exposed to TypeScript through `lib/ui-styles.ts`. Tailwind stays installed as a **compatibility layer** for the surfaces that have not been migrated and for one-off adjustments (`sm:max-w-56`, `mt-4`). Nothing was installed: no MUI, Ant Design, Chakra, Mantine, Bootstrap, shadcn.

## 1. What changed in V3

| Layer | Before | V3 |
| --- | --- | --- |
| Cards | `card` = a utility string; ~30 hand-rolled `rounded-* border border-border bg-card p-*` variants | `.erp-card`, `-compact`, `-inset` (filled, no shadow), `-accent`, `.erp-stat`, `.erp-action-card`, `.erp-note`, `.erp-row`, `.erp-listbox`, `.erp-sheet`, `.erp-modal`, `.erp-menu`, `.erp-toast`. One 12px card radius, one shadow, one padding per breakpoint. |
| Forms | `inputClass` (44/36px by breakpoint), 82 hand-rolled `border-input …` controls in eleven heights | `.erp-input` (44px everywhere, 16px type on a phone, one radius, one focus ring), `.erp-input-sm` (36px), `.erp-select` (own chevron), `.erp-textarea`, `.erp-label`, `.erp-help`, `.erp-error`, `.erp-field`, `.erp-field-row`, `.erp-check`, `.erp-segmented`. A zero-specificity floor under every legacy control in the workspace (min height, radius, border, ring). |
| Buttons | the v1.169.0 44px pill (unchanged) | + `.erp-button-ghost`, `.erp-button-success`, `.erp-icon-button-ghost`, `aria-busy` spinner state, icon sizing, max-width so a label never widens a phone. |
| Chips | `chip*` utility strings; ~40 hand-rolled pills | `.erp-chip` + tones (neutral / success / warning / danger / info / gold), `.erp-chip-sm`, `.erp-chip-action`, `.erp-badge` (the unread count). |
| Tables | `th`/`td` utility strings; toolbar and action bar in utilities | `.erp-th` / `.erp-td` (+ `-num`), `.erp-toolbar`, `.erp-toolbar-group`, `.erp-action-bar` (re-tokened for navy), `.erp-filter-chip`, compact density. Frame and sticky header stay in `globals.css` (`.erp-table*`). |
| Shell | header, bottom nav, rail, drawer in utilities | `.erp-topbar`, `.erp-bottom-nav` + `-item` / `-icon` / `-label` (gold hairline + tinted well for the active stop), `.erp-rail*` (grouped, collapsible, tooltip), `.erp-drawer*` (head / body / foot, safe-area foot). |
| Zones | `ZoneLabel` in utilities | `.erp-zone` / `.erp-zone-label` (rule drawn by `::after`). |

Colours are **never restated** in `erp-v3.css`: every fill and ink is a token from `globals.css` (`--card`, `--border`, `--primary`, `--success` …), so light, dark and the Plum preset work unchanged and the locked palette (navy `#1a2946`, gold `#c8a96a` / `#c9a227`, white, neutral grey) is untouched. Status ink for navy surfaces (the shift hero, the table's action bar) is three named tokens in `globals.css`: `--ink-on-navy-success/warning/danger`.

## 2. Which screens were migrated

- **Portal shell** (`app/portal/page.tsx`): topbar, phone bottom navigation, More sheet, notification badge.
- **Sidebar** (`components/layout/side-nav.tsx`) and **command palette** (`components/layout/command-palette.tsx`).
- **Dashboard** (`components/portal/dashboard.tsx`, `trading-desk.tsx`, `page-shared.tsx`): zone labels, shift hero (state-of-day chip, one button height, compact On Shift link, notes), company pulse tiles, work-overview chips.
- **On Shift** tab (the same hero, `shiftOnly`): no more 56px buttons.
- **Attendance** (`components/portal/attendance.tsx`): month field, every status chip, the two notes.
- **Claims** (`components/portal/role-panels.tsx` `ClaimsPanel`): pill call-to-action, segmented claim-type switch, every field on the vocabulary, status/count chips, `#claims-list` anchor and return-to-list after submit and after update.
- **Web Orders, Cash Flow, Commission, Accounting** (`DataTable` consumers) and the **DataTable** itself (`components/ui/data-table.tsx`): toolbar, chips, action bar, density, columns menu.
- **Drawer** (`components/ui/side-drawer.tsx`).
- **Every `lib/ui-styles.ts` consumer** (≈330 `inputClass` sites, every `card`, `chip*`, `th`/`td`, `listRow`, `rowHead`, `sheetCard`, `modalCard`, `toastCard`, `menuCard`, `tileCard`) took the V3 look without an edit, because the names now resolve to the classes.
- Form controls rewritten from hand-rolled utilities to the vocabulary in: `role-panels.tsx` (42), `elfia-store-panel.tsx` (8), `payroll-panel.tsx` (5 + its local constant), `geofence-card.tsx` (4), `staff-directory.tsx` (3 + its local constant), `attendance.tsx`, `sales.tsx`, `web-orders-panel.tsx`, `live-cards.tsx`, `leave.tsx`, `tasks.tsx`, `content-panel.tsx`, `trading-desk.tsx`, `verification-card.tsx`.

## 3. What remains on Tailwind, on purpose

- **Layout utilities everywhere** (`flex`, `grid`, `gap-*`, `mt-*`, `hidden md:block`, widths). V3 owns *components*, not layout; a layout utility is not a design decision and does not drift.
- **Public site** (`app/(marketing)`, `components/home`, `components/layout/navbar.tsx`, `footer.tsx`, `components/ui/button.tsx`): a different product with its own type scale; untouched.
- **Legacy panels not yet on the vocabulary**: hand-rolled chips and small buttons still exist in `hankeis-panel.tsx`, `sales.tsx`, `payroll-panel.tsx`, `elfia-store-panel.tsx`, `roster-board.tsx`, `staff-directory.tsx`, `hotels-panel.tsx`, `threads-panel.tsx`, `admin/*`, `account/*`. They render correctly (the zero-specificity floor gives their controls the V3 height, radius and ring) and are **not** in guard #92's migrated list, so they may keep their utilities until their own pass.
- **`inputClassLg`** (the public-site 16px field) and `PORTAL_WIDTH`, `mobileBottomNav`, `mobileAppBottomClearance` stay as utility strings: the last two carry the safe-area formula that `tests/pwa-calendar.mjs` reads verbatim.
- **`@theme inline` tokens in `globals.css`** (`bg-success-soft`, `text-gold-deep`, `rounded-card` …) remain the bridge that lets a Tailwind utility read a semantic token.

## 4. What must NOT be removed yet

- `@import "tailwindcss"` and `@tailwindcss/postcss` — ~250 files still use utilities.
- The `.erp-button` / `.erp-icon-button` block in `globals.css` — `tests/interface-system.mjs` reads it there.
- The `.erp-table*` frame in `globals.css` — the sticky header contract, also read by guards.
- `mobileBottomNav` / `mobileAppBottomClearance` strings — `tests/pwa-calendar.mjs`.
- The `[--hdr-pt:…]` inline padding on the portal header — `tests/shell-scroll.mjs` proves the status-bar inset is *added* to the bar's own padding.
- The `@theme inline` block — every `bg-*-soft` / `text-*` utility depends on it.

## 5. The next safe phase for retiring Tailwind

1. Migrate the remaining panels' chips and small buttons onto `chip*` / `btnSm*` (mechanical; same script used in v1.172.1) and add each file to guard #92's `MIGRATED` list as it lands.
2. Move layout patterns that repeat (`flex flex-wrap items-center justify-between gap-2`, the 2-up phone grid) into `.erp-*` layout helpers; then a migrated file has **no** utility strings and can be linted for "no `className` containing a Tailwind utility".
3. Public site: decide whether it shares V3 or keeps its own sheet; either way its utilities move to named classes last.
4. Only then: drop `@import "tailwindcss"`, keep `@theme`-equivalent tokens as plain CSS custom properties, remove `@tailwindcss/postcss` and `prettier-plugin-tailwindcss`. Guard #92 should at that point assert that no `className` in `app/` or `components/` matches a Tailwind utility pattern.

## 6. Verification (v1.172.1, offline, Linux sandbox)

- `npm run typecheck` (portal) and worker `tsc --noEmit`: clean.
- `npm run lint`: 0 errors; the warnings are the pre-existing set (24) plus the five React-Compiler rules held at *warn* since v1.172.0.
- `npm run guard`: **92/92** (new: `interface-v3`, 213 checks; updated: `inventory-category` reads the shared chip).
- `npm run build` (Next.js 16.3.5, Turbopack, static export): 31 routes.
- Chromium against fixtures at 375 / 390 / 430 / 768 / 1280 / 1440 px, light and dark: public pages, the portal shell, Dashboard, On Shift, Claims (form → submit → back at the list), Web Orders (table, drawer, CSV), Finance, Attendance, Users — no horizontal overflow, no page errors, bottom nav clear of content, no retired tab reachable.

## 7. Release state

`PUSH.bat` was **not** run. Nothing was deployed. The worktree is dirty with the v1.172.1 files until the owner commits.
