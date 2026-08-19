# Contributing

## Branch strategy

- `main` — production; deploys automatically
- `develop` — integration branch
- `feature/<name>` — new features, branched from `develop`
- `fix/<name>` — bug fixes

## Commits

Conventional Commits where practical: `feat:`, `fix:`, `docs:`, `refactor:`, `chore:`.

## Pull requests

1. Branch from `develop`; keep PRs focused
2. Before opening: `pnpm typecheck && pnpm lint && pnpm build` all pass
3. Update the relevant docs (see Documentation rules below) — **a PR with out-of-sync docs is not complete**
4. One approving review before merge

## Coding standards

- Strict TypeScript, no `any`
- Content lives in `constants/`, never hard-coded in components
- Components small, reusable, typed props
- Tailwind for styling; design tokens from `styles/globals.css`
- Prettier + ESLint enforced (`pnpm format`, `pnpm lint`)

## Documentation rules (mandatory)

Whenever code changes (feature, UI, database, API, dependency, config, fix, security), update the matching file(s): README, CHANGELOG, FEATURES, ROADMAP, API, DATABASE, DEPLOYMENT, ADMIN_GUIDE, USER_GUIDE, SECURITY, CONTRIBUTING, ARCHITECTURE. Each update records date, version, summary, files changed, breaking changes, migration steps.

## House rules — learned in production (v1.22–v1.26, 2026-08)

These are not style preferences; each one exists because its absence shipped a bug to staff.

1. **Every mutating request goes through `api()` (JSON) or `csrfFetch()` (binary/custom headers) from `lib/api.ts`. A bare `fetch()` with POST/PUT/PATCH/DELETE is banned** — the worker 403s any session-bearing mutation without `X-CSRF-Token`, and hand-rolled calls shipped that bug three separate times (v1.23.1: change-password/assets/payroll; v1.26.1: twelve more — staff photos, claim receipts, enquiry replies, tab access, admin media, account enquiries). `node tests/csrf-guard.mjs` fails the build on any bare mutating fetch.
2. **Every user-facing string is bilingual at the display point**: `L("English", "BM")` (module-scope helper reading `getLang()`), or `tr()` for chrome strings in the `lib/i18n.ts` DICT. Strings used in logic — comparisons, object keys, API payloads, state that is later compared — stay English; map to BM only where displayed. `node tests/bm-coverage.mjs` (against a served `out/`) fails if English leaks into BM mode on any portal tab. Every tab added to `ALL_TABS` needs a DICT entry.
3. **Printed/official documents stay English** (payslip, claim form AZOO-HR-CLM-001, leave form, SOA, staff ID badge) — a company document must not change with the operator's screen language.
4. **Layout grids need `grid-cols-1` as the mobile base** — old iOS Safari sizes implicit grid columns to max-content and overflows the viewport; `body { overflow-x: hidden }` is IGNORED by iOS (use `clip`), which masked this for five releases.
5. **New SQL must pass `node tests/sql-schema-check.mjs`** — it builds the full migration chain in-memory and verifies every static query in the worker (620+ at last count).
6. **One version number** — bump `package.json` only; the UI stamp and `/api/v1/health` both read it. Every release gets a CHANGELOG entry written for the CEO, not for engineers.

## Test inventory (run before every zip)

- `npx tsc --noEmit -p tsconfig.json` — types
- `node tests/sql-schema-check.mjs` — every worker query vs migrated schema
- `node tests/csrf-guard.mjs` — no bare mutating fetch()
- `node tests/permissions-policy.mjs` — _headers allows geolocation=(self); policy self-diagnosis intact
- `node --experimental-strip-types tests/shift-sales-split.mjs` — shift sales attribution rules
- Playwright (need `out/` served on :8931): `tests/bm-coverage.mjs` (BM on all tabs), `tests/leaderboard-sales-floor.mjs`, `tests/no-false-attendance.mjs`, `tests/location-scenarios.mjs`
- `cd worker && npx wrangler deploy --dry-run` — worker compiles
