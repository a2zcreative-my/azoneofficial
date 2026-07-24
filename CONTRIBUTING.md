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
