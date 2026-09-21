# Portal Interface System V3

**Introduced:** v1.172.1 (21 September 2026). **Tailwind retired:** v1.172.2 (21 September 2026). **Owner files:** `styles/erp-v3.css`, `styles/erp-reset.css`, `styles/legacy-utilities.css`, `lib/ui-styles.ts`. **Guards:** `tests/interface-v3.mjs` (#92), `tests/tailwind-retired.mjs` (#93).

The portal has an in-house ERP design system: named CSS classes, in the semantic tokens, exposed to TypeScript through `lib/ui-styles.ts`, with CSS Modules for a screen's own layout. **Tailwind is gone** — the package, its PostCSS plugin, the prettier plugin, `tailwind-merge`, `@import "tailwindcss"`, `@custom-variant` and `@theme`. Nothing was installed in its place: no MUI, Ant Design, Chakra, Mantine, Bootstrap, shadcn. The stylesheet is four plain CSS files and the CSS Modules beside the migrated components.

## 0. How to build UI now (read this first)

1. **A surface, a control, a chip, a table cell, a button:** use the vocabulary in `lib/ui-styles.ts` (`card`, `inputClass`, `selectClass`, `btnSm`, `chipSuccess`, `th`/`td`, `rowHead`, `listRow`, `sheetCard` …) or the `.erp-*` class it resolves to. Every name is documented in `styles/erp-v3.css`; the file's header lists what it owns.
2. **A row, a stack, a grid of cards, an icon, a muted line, a rhythm step:** the layout and type primitives in `erp-v3.css` (section *LAYOUT AND TYPE PRIMITIVES*):
   - stacks: `erp-stack` (1rem, 1.5rem from `md`), `erp-stack-tight` (0.75rem / 1rem) — block flow with collapsing margins, exactly what `space-y-*` was
   - rows: `erp-flex` (+ `-between`, `-wrap`, `-top`, `-bottom`, `-baseline`, `-end`, `-col`), `erp-gap-1..4`, `erp-grow`, `erp-fixed`, `erp-min0`, `erp-full`, `erp-center`, `erp-divide`, `erp-scroll-x`
   - grids: `erp-cols-2`, `erp-cols-3`, `erp-cols-4` (two columns on a phone, their count from `md`)
   - rhythm: `erp-mt-half` (2px), `erp-mt-1..4`, `erp-mt-6`, `erp-mb-3` — the only spacing helpers
   - icons: `erp-icon` (16px), `erp-icon-sm` (14), `erp-icon-md` (18), `erp-icon-lg` (20); `AppIcon` is always 16px unless given one of these
   - type: `erp-text-xs/sm/base/lg`, `erp-muted`, `erp-meta` (12px muted), `erp-heading` (14px semibold), `erp-panel-title` (heading with an icon slot), `erp-eyebrow`, `erp-strong`, `erp-medium`, `erp-num`, `erp-truncate`, `erp-nowrap`, `erp-left/right/centered`, `erp-danger/success/warning`
   - lists: `erp-list-row` (the hover row), `erp-none` (the quiet "nothing here" line), `erp-avatar` (a 32px round well), `erp-row-actions`, `erp-pill-row`, `erp-quiet-*`, `erp-reveal`
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
