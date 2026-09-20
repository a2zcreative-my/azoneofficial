# Project State and Handoff

**Last reviewed:** 20 September 2026  
**Workspace:** `a2zcreative-official`  
**Production:** `a2zcreative.my` confirmed at `v1.167.0`
**Local package metadata:** `1.168.0`
**Release status:** `v1.168.0` deployed and health-checked via `PUSH.bat allow-dirty` on 20 September 2026; release commit `a00eb82`

## Read First

This is the current coordination record for Claude, Codex, and any other contributor. Read it before implementation or release work. The worktree status and the latest diff are authoritative for file ownership; this document is the shared summary, not a replacement for inspecting the diff.

## Current Local Work

The deployed `v1.167.0` workforce-flow release parks Threads without deleting its data, protects claims against duplicate submission and replay, adds salary advances with an explicit payroll recovery month, and lets approved after-hours OT become pay or replacement leave. Attendance classifies real punches against effective-dated shift and roster assignments; it never creates attendance from a schedule alone.

The deployed `v1.168.0` change reorganises `/portal` for a calmer responsive PWA and web workspace while preserving the existing colour tokens. Mobile navigation prioritises Dashboard, On Shift, Tasks and Profile and exposes every other authorised module through a grouped menu. Per-person tab access is managed in the User-account workflow using the existing audited access API. Staff Details is roster-first with search; the organisation chart and team map remain secondary views. Profile has a clearer employee identity summary. No auth, HR data, permission API or database schema changed.

Current verification status:

- `v1.167.0`: portal and worker type checks, all 87 guards, production Next.js build, deployment and production health check passed.
- `v1.168.0`: portal type check, all 88 guards, production Next.js build, Cloudflare deployment and Production health check passed. Authenticated responsive owner review is in progress on Production.

The simulator is offline only. It does not send Telegram messages, call a bot, or create production orders.

## Release Decision

The responsive portal release was successfully deployed and Production health confirmed `v1.168.0`. It has no database migration. Portal type check, all guards, production build and deployment gates passed; authenticated responsive review is being completed by the owner on live Production.

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
