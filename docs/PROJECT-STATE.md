# Project State and Handoff

**Last reviewed:** 20 September 2026  
**Workspace:** `a2zcreative-official`  
**Production:** `a2zcreative.my` release target `v1.166.0` (previous confirmed `v1.165.0`)  
**Local package metadata:** `1.166.0`  
**Release status:** approved and ready for `PUSH.bat allow-dirty`

## Read First

This is the current coordination record for Claude, Codex, and any other contributor. Read it before implementation or release work. The worktree status and the latest diff are authoritative for file ownership; this document is the shared summary, not a replacement for inspecting the diff.

## Current Local Work

The local worktree contains the reviewed Hankeis commerce and Telegram integration release, together with the portal navigation, permissions, guard, migration, and documentation changes needed to integrate it without rolling back existing ERP behavior.

The Hankeis-specific verification currently passes:

- `node tests/hankeis.mjs` - 185 checks passed.
- `node scripts/hankeis-simulator.mjs` - offline customer journey completed.
- `npm run typecheck` - passed.
- `node scripts/run-guards.mjs` - all 86 guards passed.

The simulator is offline only. It does not send Telegram messages, call a bot, or create production orders.

## Release Decision

The earlier failed release attempt left production on `v1.165.0`. Its blockers are resolved: TypeScript is clean, the migration registry is ordered through `0135`, all guards are registered, and the On Shift and Companies contracts are preserved.

The owner explicitly instructed Codex to fix and release this reviewed combined work on 20 September 2026. That instruction authorizes the one-time `PUSH.bat allow-dirty` path required because the release script itself creates the release commit after successful deployment. The sibling ELFIA store worktree was verified clean before this decision was recorded.

## Telegram Readiness

The worker API contract and staff review surface exist. The following are still external adapter work and are not implemented in this repository:

- Telegram bot conversation and menus.
- Telegram webhook endpoint and secret validation.
- Telegram `getFile` download and receipt-byte forwarding.
- Outbox claim/send/ack/nack consumer with `event_id` deduplication.

The previously identified server risks are resolved: non-admin settings redact the receiving account, JSON and receipt bodies are bounded while streaming, idempotency keys are reserved atomically, and shipping plus stock changes run in one database batch.

## Collaboration Protocol

1. Read `CLAUDE.md`, this file, `CHANGELOG.md`, and the relevant module docs.
2. Inspect `git status --short` and `git diff --stat`.
3. Preserve existing contributor changes and work in focused files only.
4. Update this handoff record when the status changes.
5. Run the relevant tests before asking another contributor to continue.
6. Use `PUSH.bat` only after the worktree is intentionally prepared and the release gates are green.
