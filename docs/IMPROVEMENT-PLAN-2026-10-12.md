# Project review and improvement plan

Reviewed: 12 October 2026 (Asia/Kuala_Lumpur)
Status: User authorised proceeding after the review. The first implementation increment verifies public release status and prevents silently truncated backups. Remaining phases are pending; deployment and payroll changes are separate from this increment.
Baseline: local package version 1.181.8; Git HEAD 95ff6e5 (`portal deploy`); worktree clean before this documentation pass. A commit message is not deployment evidence.

## Recommendation

Stabilise release evidence and recovery first, then improve validation, then continue the existing architecture programme in small stages. Preserve the static export, shared permissions, API helper, offline queue and Portal Interface System V3. The repository already has substantial regression coverage and a staged routing plan; a replacement framework or wholesale redesign is not justified by this review.

## 1. Establish the actual release and payroll state

Priority: immediate operational verification, before another release.

The previous handoff simultaneously described 1.181.3 as health-confirmed, 1.181.5 as inferred from a screenshot, 1.181.8 as local, and several already superseded releases as undeployed. README still named 1.166.0. None establishes today's production version. The payroll follow-up scheduled before 5 October 2026 at 10:00 MYT is now past; its completion is unknown.

Next work: record separate frontend and API versions, deployment evidence and timestamp, migration status through 0138, and whether September payroll was recomputed and issued. Verify the upload repair and both added claim categories in an appropriate test environment. Do not blindly deploy 1.181.4 based on the old note, or rerun payroll against already issued records. Obtain the operational facts first; any correction of issued payroll needs its own agreed scope.

Acceptance: one current release table with evidence, named outstanding tasks and owners. Historical release notes must never override that table. This review does not assess legal compliance of payroll policy or the deferred statutory contributions.

Evidence: `package.json`, `lib/version.ts`, `CHANGELOG.md`, `docs/PROJECT-STATE.md`, `worker/migrations/0138_claim_categories.sql`, `tests/upload-stream.mjs`.

## 2. Make backup completeness and restoration provable

Priority: high; before relying on the JSON backup for a risky data migration.

`runBackup` in `worker/src/index.ts` selects each table with `LIMIT 50000`, with no overflow check, and subsequently returns success. A larger table therefore produces an incomplete backup that can look healthy. Actual production row counts were not inspected. It also holds all selected rows, their JSON and the compressed output in memory; measure this before changing the implementation.

Next work: detect and report incomplete exports immediately; design bounded, deterministic export batches and a documented consistency strategy; include schema/migration metadata and per-table counts in a manifest. Restore into an isolated database and compare counts, key relationships and representative business totals. Reconcile recovery of R2 attachments with database records: a database JSON export alone is not the attachment backup.

Acceptance: a dataset above 50,000 rows cannot silently report a complete backup; an isolated restore is demonstrated; backup age, completeness and failure are visible. Keep existing production backups and recovery options intact.

## 3. Make runtime and browser validation repeatable

Priority: high; do this before broad UI or routing changes.

The repository has source guards and meaningful executable checks, including a workerd upload test. Browser probes are separate and require WebKitGTK, Xvfb and Python Selenium; `package.json` CI does not run them. No `.github` directory exists in this checkout; this does not prove that externally configured Cloudflare CI is absent.

Next work: document or automate a reproducible Linux browser job plus the Windows guard baseline. Exercise CEO, sales and live-host roles, EN/BM, light/dark, phone/desktop, populated records, error states and offline retries. Record results as release evidence. Extend database-backed tests for migration 0138, claim creation, permissions and retried writes; keep useful structural guards instead of replacing every test.

Acceptance: failures block the relevant release; missing fixtures or unavailable runtimes cannot produce a green result; browser and runtime results identify the tested commit. Use synthetic data and an isolated database.

Evidence: `scripts/run-guards.mjs`, `tests/browser/README.md`, `tests/claim-categories.mjs`, `tests/upload-stream.mjs`.

## 4. Reduce large modules without changing business rules

Priority: medium, after the validation baseline.

`worker/src/staff.ts` is approximately 926 KB, `components/portal/role-panels.tsx` 418 KB, and `worker/src/index.ts` 293 KB in this checkout. Their size increases review and merge difficulty; it is not by itself proof of slow runtime performance. The shell has already been extracted, while navigation remains state-based.

Next work: select one bounded feature such as claims; establish handler-level behaviour tests, then extract its handlers and components with unchanged contracts. Continue the existing P1 plan only when authorised: P1.0b rollback bridge before P1.2 routing. Preserve static-export and offline-navigation constraints, legacy links, permission checks and browser history. Do not introduce a second route or permission registry.

Acceptance: existing responses, permissions and calculations remain equivalent; source guards still cover extracted code; route/offline/back-navigation tests pass. See `docs/P1-ARCHITECTURE.md` for the already agreed sequencing. This review does not authorise its remaining phases.

## 5. Finish company boundaries as a separate business programme

Priority: high if company-specific access is required; schedule after ownership decisions.

The Companies workspace records ownership proposals and planned memberships. Its documentation explicitly says operational access restrictions are not active. This is an unfinished capability, not evidence in this review of an exploitable authorization defect.

Next work: complete management ownership review, resolve unassigned and conflicting records, then stage enforcement across reads, mutations, reports, exports and attachments. Verify cross-company denials and authorised shared access. Keep document-signing approval evidence as its own scoped feature; preserve issued documents and balances.

Acceptance: approved ownership mapping, reconciliation totals, negative authorization tests and a management pilot before enforcement. Never infer company ownership from a SKU, staff role or default alone.

Evidence: `docs/COMPANY-REVIEW-IMPLEMENTATION.md`, `docs/SHIFT-AND-ERP-IMPLEMENTATION.md`, `worker/src/company-review.ts`.

## 6. Improve diagnostics and measured user experience

Priority: medium; combine with bounded feature work.

`worker/wrangler.toml` has no explicit observability or trace configuration, though application error logging exists. `Env` is manually declared in `worker/src/index.ts`. Next work: verify dashboard settings, define sampled logs/traces with redaction, correlate errors with releases, and evaluate generated binding types. Cloudflare documents traces as a separate opt-in: [Workers traces](https://developers.cloudflare.com/workers/observability/traces/). Do not assume live logging is disabled just because the repository omits its configuration.

For the interface, measure the existing pages before prioritising changes: successful task completion, failed saves, request counts, load time and keyboard/phone usability. Reuse shared tokens and named components, preserve one workflow destination, and improve one module at a time. Consolidate direct-fetch and copied-cache patterns only with tests for stale responses, account switching and permission loss. No visual or performance benchmark was run in this review.

## Verification performed

- `node tests/claim-categories.mjs`: passed, 17 checks.
- `node tests/payroll-days.mjs`: passed, 125 checks.
- `node tests/portal-routes.mjs`: passed, 569 checks.
- `node tests/release-offline.mjs`: passed.
- A Node DEP0190 warning appeared during the test sequence; the checks still completed successfully. Investigate its child-process invocation in a future tooling pass.

This was a targeted repository review, not an exhaustive security audit. Full guards, lint, typechecks, production build, upload workerd test and browser probes were not run. Production health, migrations and business records were not queried. No production result is claimed.

## Claude continuation and documentation sync

Read `CLAUDE.md`, the current summary in `docs/PROJECT-STATE.md`, this plan and the latest `CHANGELOG.md` before continuing. Inspect Git status and preserve these documentation changes. The user subsequently said "proceed". Continue in bounded stages and record which acceptance criteria are actually complete; do not describe the whole programme as delivered.

For each subsequently authorised change, update the same commit's relevant module documentation, the handoff (scope, actual files, tests and remaining work), and CHANGELOG for user-visible or operational changes. Record deployment separately only after its gates and health evidence succeed. Use `PUSH.bat` for releases; no dirty-tree approval is granted here.

Keep one current plan here and one current status in PROJECT-STATE. Older REVIEW and roadmap documents are historical inputs, not evidence that their suggestions remain unimplemented. Documentation sync is a contributor workflow, not an automatic background service.

## Implementation progress - 12 October 2026

- Public API health and login HTML both report 1.181.8. Migration health reports `pending: false`; this is the endpoint's latest-migration check, not a complete schema audit. Payroll follow-up remains unverified.
- Backup cap detection is implemented locally and covered by an executable guard. Oversized exports fail before R2 publication or retention. See `BACKUP-RECOVERY.md` for the remaining export/restore work and limitations.
- Next authorised increment: added a recovery manifest (counts/checksums, schema, migrations, sequences), a read-only verifier and a synthetic in-memory SQLite restore drill. The drill verifies recovered records, totals, constraints and ID continuity; a real D1/R2 recovery exercise remains outstanding.
- No deployment, production data mutation, large-table export redesign, browser automation, module extraction or company enforcement was performed.

Second-increment validation: 106/106 guards and Worker strict typecheck passed. See PROJECT-STATE for the authoritative current handoff.

Third increment: delivered a strict Linux WebKitGTK matrix runner and browser-free orchestration tests. See tests/browser/README.md. Windows prerequisite failure was recorded; actual browser execution and integration into Linux release CI remain pending. No deployment occurred.

Third-increment validation: all 107 guards passed, Python probe syntax passed, and the expected Windows prerequisite failure produced a failed report. The product has not passed the new browser matrix.

Fourth increment: added the Linux GitHub Actions workflow and system-Python selection. YAML, actionlint, lockfile-spec and orchestration checks passed locally. The workflow has not been pushed/run; first complete Linux execution and enforcing it through repository/deployment rules remain pending. No deployment occurred.
