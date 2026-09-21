# Claude Implementation Contract

Read this file before making any implementation change in this repository.

## Required preflight

1. Read `docs/PROJECT-STATE.md`, `CHANGELOG.md`, and the relevant module documentation.
2. Run `git status --short` and inspect `git diff --stat` before editing.
3. Treat uncommitted changes as active work owned by another contributor unless the user explicitly says otherwise. Preserve them and do not overwrite, rename, delete, or reformat those files casually.
4. Check the latest `CHANGELOG.md` entry and the deployed version in `docs/PROJECT-STATE.md`. Do not describe local work as deployed.
5. Search for an existing implementation before adding a new component, route, migration, guard, or CSS token.

## Coordination rules

- `docs/PROJECT-STATE.md` is the current handoff record. Update it when implementation status, release blockers, migrations, or deployment state changes.
- `CHANGELOG.md` records user-visible or operational changes. Add an `Unreleased` entry before a release-related change.
- Do not work in the same files as another active contributor without first reading their diff and preserving their intent.
- Do not create duplicate migrations, tabs, guards, design tokens, or API routes. Check registries and parity tests first.
- Hankeis/Telegram is currently an API contract and offline simulator. The Telegram bot, webhook, file forwarding, and outbox consumer are not part of this repository yet.
- A receipt never verifies a payment. Only an authorised staff reviewer who checks the bank record can verify one.

## Release rules

- Use `PUSH.bat` as the only normal release entry point.
- `PUSH.bat` performs a strict clean-worktree preflight before installing, cleaning, migrating, committing, or deploying. Do not bypass it by calling Wrangler directly.
- If a dirty-tree release is genuinely approved, use `PUSH.bat allow-dirty` and record the approval in `docs/PROJECT-STATE.md` first.
- A failed guard, type check, migration check, or health check means the release is not verified. Never claim deployment from a partial run.
- Production includes the responsive portal release at `v1.168.0`; `PUSH.bat allow-dirty` completed every gate and the production health check on 20 September 2026.
- The `v1.168.0` portal reorganises `/portal` for responsive PWA/web use without changing the existing colour palette. Preserve the existing `canSeeTab`/`accessOf` permission source and the audited `/staff/tabs/access/person` API; do not create a second permission model. Treat the reference screenshots as information-hierarchy inspiration only, not as an instruction to copy their blue palette or replace the existing authenticated login with a PIN.
- Local `v1.169.0` is an unreleased interface-system pass: portal action buttons use the global `.erp-button` 44px pill contract on both breakpoints, icon-only actions use `.erp-icon-button`, and the Dashboard uses one shift hero plus one tabbed Tasks/Leave/News overview. Extend these shared classes instead of adding another hand-written button shape.
- `v1.174.0` — **roles and responsibilities** live on the staff record (`users.role_title`, `users.responsibilities`, migration 0137) and are written ONLY through `PUT /staff/users/:id/responsibilities` behind `PERMS.responsibilities_edit` (super_admin, admin, hr_admin, ceo) — never as a field on `PATCH /users/:id` (that form's fill-once lock is the wrong rule for a job description). The page passes the same four roles as `canEditResponsibilities`; `tests/staff-responsibilities.mjs` (#95) holds the two lists equal. Working staff only; a leaver's text stays readable. The person reads theirs on Profile and cannot write it.
- `v1.173.0` — **every tab follows the tab concept** (`docs/INTERFACE-SYSTEM-V3.md` §8; guard #94 `tests/tab-concept.mjs`). A tab body is `<TabPage>` of `<TabZone label=…>` sections (`components/portal/tab-concept.tsx`), in the order figures → work → records → setup; the figures are a `SummaryStrip` of `SummaryStat`s (or a `StatStrip` of `StatTile`s) derived from rows the panel already holds, each a button when it filters something, `busy` until known; several things on one topic go behind `SectionTabs` / `PillCard` with panes hidden, never unmounted; a chooser wears `tabPill` / `tabPillOn`, never a hand-rolled pill. A new tab, or a new card on a tab, goes into a captioned zone — the guard fails a bare stack at a tab's root. Layout only: the concept never adds a request or changes a rule.
- `v1.172.2` — **Tailwind is retired** (`docs/INTERFACE-SYSTEM-V3.md` §0 says how to build UI now). No `tailwindcss`, `@tailwindcss/postcss`, `tailwind-merge` or `prettier-plugin-tailwindcss` may return; no `@import "tailwindcss"`, `@theme`, `@apply` or `@custom-variant` in any stylesheet; `cn()` is `clsx`. Styling is: the vocabulary in `lib/ui-styles.ts` → `.erp-*` classes in `styles/erp-v3.css` (surfaces, controls, chips, table chrome, shell, and the layout / type primitives: `erp-flex*`, `erp-stack`, `erp-cols-*`, `erp-icon*`, `erp-text-*`, `erp-meta`, `erp-heading`, `erp-mt-*`), semantic tokens from `globals.css` (never a hex in a component), and a **CSS Module beside the component** for a screen's own layout. **Never write a utility class** (`flex items-center gap-2`, `mt-2`, `md:hidden`): nothing generates CSS for it, and `tests/tailwind-retired.mjs` (#93) fails the build on a utility that `styles/legacy-utilities.css` does not define. That sheet is the utilities the unmigrated screens still carry, FROZEN and shrink-only: never add to it; when a screen migrates, `node scripts/prune-legacy-utilities.mjs --write` then `node tests/tailwind-retired.mjs --write-budget` (the per-file budget in `tests/legacy-utility-budget.json` may only fall; the migrated surfaces stay at zero). `AppIcon` is 16px by rule (`erp-icon-sm/-md/-lg` to resize); stacks are block flow (`erp-stack`), not grids.
- `v1.172.1` — **Portal Interface System V3** (`docs/INTERFACE-SYSTEM-V3.md`). Surfaces, forms, chips, table chrome, the shell and the drawer are named classes in `styles/erp-v3.css`, and `lib/ui-styles.ts` resolves to them. New portal UI takes a name from `lib/ui-styles.ts` or a class from `erp-v3.css`; it does not spell a card, a control, a chip or a button out by hand, and it never states a colour outside `globals.css`. `tests/interface-v3.mjs` lists the migrated files and fails the build if one slides back. Reconciliation, Ads Fund and Purchasing are retired (v1.172.0) and the same guard keeps them out of every registry.

## Before handoff

Report the files changed, tests run, known failures, migration impact, and whether anything reached production. Leave the worktree in a state another contributor can inspect without guessing.
