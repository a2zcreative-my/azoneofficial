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
- Production includes the reviewed workforce-flow release at `v1.167.0`; `PUSH.bat allow-dirty` completed every gate and the production health check on 20 September 2026.
- The current local `v1.168.0` work reorganises `/portal` for responsive PWA/web use without changing the existing colour palette. Preserve the existing `canSeeTab`/`accessOf` permission source and the audited `/staff/tabs/access/person` API; do not create a second permission model. Treat the reference screenshots as information-hierarchy inspiration only, not as an instruction to copy their blue palette or replace the existing authenticated login with a PIN.

## Before handoff

Report the files changed, tests run, known failures, migration impact, and whether anything reached production. Leave the worktree in a state another contributor can inspect without guessing.
