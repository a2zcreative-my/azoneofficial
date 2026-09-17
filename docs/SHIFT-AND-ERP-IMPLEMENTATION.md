# Attendance and ERP Follow-through

Updated: 17 September 2026
Baseline: deployed package v1.164.0, portal commit 6d6fafb3d38e0874b796f36832afef68486eafe2.
This change set is local and is not deployed. Do not infer production behavior from these notes.

## Confirmed decisions

- AZ ONE OFFICIAL uses `azoo`; A2Z CREATIVE MARKETING uses `a2z`.
- Existing operational records with uncertain ownership are mixed. They must remain
  unassigned in a management review queue, not be bulk-assigned to either company.
- A half-day means the first or second half of the employee's total scheduled workday.
  Split-shift gaps do not count. The system has a break duration, not a timed break;
  this implementation splits scheduled blocks without inventing a lunch interval.
- Clock-out records attendance immediately. It does not create or approve leave,
  deduct 0.5 day, or change payroll automatically.
- Production publication remains a separate, explicit operation through PUSH.bat.

## Local implementation

### On Shift and attendance

- Dedicated, always-visible On Shift tab beside Attendance, with existing GPS,
  forgotten-punch, overtime, offline-outbox and pending-approval behavior reused.
- On a fresh portal session, a successful attendance response selects On Shift
  for an unclaimed scheduled block from 30 minutes before its start until its end.
  Already clocked in, no shift due, approved full-day leave, and unresolved leave
  coverage do not trigger automatic entry. A request failure does not claim absence.
- Explicit notification links win. Refresh keeps the current tab. Returning from the
  background does not interrupt another tab's form. Warm native WebView/PWA resumes
  may preserve the session; actual devices still require acceptance testing.
- A confirmed clock-in from On Shift opens Dashboard. Queued, pending or failed
  submissions stay on On Shift and retain their actual status.
- The in-page clock-out reminder uses the scheduled end minus 30 minutes, including
  an overnight session. Clock-out remains available earlier. Dashboard shortcuts
  are retained for compatibility during rollout.
- Attendance load failures show Retry; a failed first read is never treated as a
  known empty attendance list. Cached records remain usable by the offline outbox.

### Half-day coverage

- Migration `0133_half_day_coverage.sql` adds nullable `day_part` and `coverage_json`.
  It does not backfill, approve, deduct or assign legacy rows.
- New 0.5-day requests require one date and an explicit first/second-half selection.
  New fractional multi-day requests must be split into separate requests.
- The API computes and saves the covered blocks, not the client. Overlapping work
  blocks are merged; split-shift gaps are excluded. Later schedule changes do not
  silently change this saved coverage. A material coverage amendment recalculates it.
- Leave history, management editing, printed forms and PDF sharing identify the half.
- Scheduling and time-only edits check overlap with saved coverage. Untimed work and
  legacy partial leave without coverage remain conservative: management review or an
  explicit, authorized, audited roster override is needed. Quick day-only assignment
  remains blocked on partial-leave days; timed scheduling can use the working half.
- Reminder generation subtracts approved coverage and skips unresolved coverage.
- Payroll absence review separates partial leave from full-day absence suggestions.
  It offers no deduction button for these partial cases. HR must compare remaining
  attendance and leave before payroll action. Existing payroll arithmetic is unchanged.
- Attendance verification counts a single-date 0.5 request as 0.5, retains recorded
  minutes, and flags the remaining day for review instead of claiming a full day of
  approved leave. The review dates also appear in its CSV export.
- Legacy partial requests cannot advance through approval until coverage is resolved.
  Existing approved partial rows stay approved but are flagged for coverage review.

### Offline and release reliability

- Missing scripts/styles/images no longer receive portal HTML from the service worker.
  Shell fallbacks are navigation-only; API data is not cached.
- PUSH.bat checks Git command failures, verifies the pushed revision, validates health
  responses, and does not print DONE when a guard, push or health verification fails.
  A failed post-deploy verification does not roll back deployments already completed.
- Only this repository's PUSH.bat is updated. The store copy must be synchronized
  separately before it can be described as identical. No deployment was run here.

## Remaining ERP phases

These are requirements and implementation steps, not completed capabilities.

### 1. Company boundaries and management review

The first local reconciliation slice is now implemented in the Companies tab:
[Company reconciliation workspace](COMPANY-REVIEW-IMPLEMENTATION.md).
It saves management proposals, independent employer/membership setup and atomic audit
history. These are preparation only: operational ownership and access enforcement are
not enabled, and dependent records are not reassigned. Migration 0134 is local.
The remaining promotion/enforcement sequence is:

1. Review the prepared employer and membership assignments with management. Enforce
   them together with action permissions; job role or email is not proof of company.
2. Add nullable ownership to expenses, purchase orders, receipts, bank accounts,
   reconciliations and stock transactions. Preserve issued-document issuer history.
3. Reconcile the management review queue against source evidence and complete missing
   dependency links. Resolve conflicting, changed and deferred proposals explicitly.
   Do not guess from contact names, SKU, current user or operating-company default.
4. Assign related records consistently as a transaction. Conflicts stay in review;
   shared contacts do not imply shared money, stock or bank accounts.
5. Add company scope to reads, writes, exports, files, caches and reports. Unassigned
   records appear only in authorized review/consolidated views and cannot be posted
   as company-specific transactions. Do not hide existing balances until reconciled.
6. Pilot with management, then enable enforcement after ownership reconciliation.

Acceptance: A2Z-only users cannot access AZ ONE records by guessed IDs, exports or
files; mixed legacy records stay unassigned; stock and bank totals reconcile before
and after assignment; switches clear incompatible drafts/selections and caches.

### 2. Verified e-signatures

1. Reuse the private company/version signature vault and current step-up verification.
2. Pilot claims with explicit document revision, canonical content hash, verification
   state, signer user ID, company, exact signature asset version and consent timestamp.
3. Verify membership, authority, prior checking, current revision and recent identity
   verification on the server. Save transition and signing event atomically and
   idempotently. Reject stale revisions, self-approval, wrong-company access and replay.
4. Material edits create a new unsigned revision and require checking again. Existing
   signed artifacts remain reproducible; legacy asset stamps are not retroactively
   represented as cryptographic signatures or new signing consent.
5. Extend to leave and selected commercial/payroll documents after the pilot passes.

Current limitation: the existing CEO leave-amend path still retains its historic
approval semantics. Revision-bound signature invalidation is not implemented by the
attendance patch. Do not claim this system already provides revision-bound signing.

### 3. Operational acceptance

- Validate installed Android/iOS PWA and actual native WebView location, offline queue,
  warm resume, midnight rollover, shared-device logout and notification deep links.
- HR checks ordinary, split and overnight schedules; both half-day choices; legacy
  partial records; pending punches; and an early departure with no automatic leave.
- Finance verifies reports and historical released payroll in an isolated copy before
  any company assignment or signature-policy migration affects live records.
- Complete workflow walkthroughs for purchase/receipt/stock and quote/payment/receipt
  before adding automation between them. Retry must not duplicate money or stock.

## Verification record

- 82 browser-free regression guards passed, including new half-day, shift-entry,
  release-failure and service-worker behavior checks.
- Frontend TypeScript and Worker compilation passed; the Worker gate retains its
  existing allowance for 38 legacy strict-mode warnings.
- Production build passed. Existing unrelated lint warnings remain.
- All 32 mocked-data browser scenarios passed at 360, 390, 768 and 1440px: scheduled
  entry and reload, already-clocked-in entry, failed reads, pending punches, offline
  queueing, no shift due, remembered tabs and notification deep links. Tests run in
  `scratch/shift-entry-review.cjs`.
  Screenshots are written to `%TEMP%/erp-shift-entry-review`.
- Isolated SQLite/API checks verify server-generated coverage, rejected overlaps,
  time-only edits, allowed cancellation, legacy approval refusal, partial-day payroll
  review, verification-report totals, snapshot stability after schedule changes and
  suppression of overnight reminders after a clock-out on the following date.
- No production employee, leave or accounting data was changed.
