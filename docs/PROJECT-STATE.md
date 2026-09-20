# Project State and Handoff

**Last reviewed:** 20 September 2026  
**Workspace:** `a2zcreative-official`  
**Production:** `a2zcreative.my` confirmed at `v1.166.0`
**Local package metadata:** `1.167.0`
**Release status:** owner approved deployment via `PUSH.bat allow-dirty` on 20 September 2026

## Read First

This is the current coordination record for Claude, Codex, and any other contributor. Read it before implementation or release work. The worktree status and the latest diff are authoritative for file ownership; this document is the shared summary, not a replacement for inspecting the diff.

## Current Local Work

The local worktree contains the `v1.167.0` workforce-flow update. Threads is parked without deleting its data. Claims gain double-submit and replay protection plus a salary-advance type whose paid amount is recovered from an explicit payroll month. After-hours OT can be paid or converted to half-day/full-day replacement leave. Attendance continues to classify real punches against effective-dated shift and roster assignments; it never creates attendance from a schedule alone.

Current verification status:

- Portal `npm run typecheck` - passed.
- Worker `npm run typecheck` - passed after one nullable-date correction.
- Full guard and production build - pending.

The simulator is offline only. It does not send Telegram messages, call a bot, or create production orders.

## Release Decision

The Hankeis release was successfully deployed and production health confirmed `v1.166.0`. The present `v1.167.0` changes introduce migration `0136_claim_advances`. Portal TypeScript, worker TypeScript, all 87 guards, and the production Next.js build passed. The owner explicitly requested deployment, authorizing the dirty-worktree release path because `PUSH.bat` creates the release commit after its own gates pass.

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
