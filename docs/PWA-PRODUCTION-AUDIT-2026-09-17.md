# PWA Production Audit

Date: 2026-09-17. Release: 1.165.0.

## Confirmed Findings And Fixes

| Priority | Finding | Resolution |
| --- | --- | --- |
| P1 | Calendar navigation depended on a phone importing a session-protected ICS URL. The code returned success without observing an import. | An in-app chooser retains the portal and offers explicit Google/Outlook drafts or file export. No automatic-save claim. |
| P1 | Claim forms and raw receipts opened outside the app with no dependable return control in standalone mode. | Shared top-layer document viewer with visible Back, browser Back, Escape, focus restoration and retained page state. Images/PDFs render inside it. |
| P1 | The same popup pattern existed in invoices, SOA, receipts, credit notes, leave forms, payslips and ID badges. | All handwritten print-window entry points use the shared viewer. Public document links have a Back control. |
| P1 | Finance payment/removal actions announced success without checking the response. | Success follows a successful response; failure retains the record and displays an error. |
| P2 | Calendar line folding counted characters, breaking the 75-octet rule for multilingual text. Two export implementations could drift. | UTF-8 byte folding; client and Worker share `lib/event-ics.ts`. Stable UID, all-day exclusive end and overnight times retained. |
| P2 | Repeated event-save taps could submit more than once; failed loads looked empty. | In-flight lock, disabled Save and visible retry state. This is not server-side idempotency across devices or reloads. |
| P2 | A dismissed or rejected share sheet returned `shared`. | Cancellation returns `cancelled`; unsupported/rejected sharing uses file download. Roster feedback follows the result. |
| P2 | Permission Matrix guessed grants from strings and included an obsolete role. | Displays actual permission keys through `can()` from the same pure policy module used by the API. Record-specific approval/ownership checks still apply. |
| P2 | API compilation tolerated strict errors and could report success after a compiler failure. | Strict errors resolved; the release gate fails on every TypeScript error or failed compiler process. OTP truncation uses DataView; ZIP integer reads reject out-of-range access. |
| P2 | Portal recovery could reload the same failing `?tab=`; other page routes lacked app recovery. | Dashboard recovery uses an explicit safe destination; root page error boundary provides retry/home controls. |

## Audit Scope

Repository-wide searches covered navigation, popups, raw attachments, object URLs,
printing, calendar exports, service-worker caching and API feedback across app,
components, libraries, hooks and Worker sources (221 source paths at audit start).
The full guard suite also checks CSRF, permissions, SQL/migrations, signatures,
attendance, payroll, business rules and shared styles.

`tests/pwa-production.cjs` derives the portal tabs from the registry, visits each
with isolated API fixtures, checks runtime errors and page overflow, and exercises
calendar export, failed/repeated saves, claim print/download, image/PDF receipts,
Back, Escape and failed-file retry. It also visits static page routes for customer,
admin and public surfaces. Stokis and Content are intentionally parked and should
return to Dashboard. Browser fixtures do not write to production.

This is a source audit and browser regression pass, not proof that every business
workflow and live integration is fault-free. Arbitrary data permutations, every
role/approval combination, installed-device OS dialogs and third-party calendar
accounts require separate acceptance checks.

## Validation

- Passed: frontend and Worker strict type checks; all 85 release guards,
  including `pwa-calendar` (21 checks), `paper-one-page` (24 checks) and
  `production-safety` (RFC 6238 OTP vectors, payroll ZIP/XML, share outcomes).
- Passed: production Next.js build. Non-blocking lint warnings remain for
  existing hook dependencies, unused suppression comments and image elements.
- Passed against the production export over local HTTPS with production headers:
  all 33 registry entries (31 active plus two parked redirects) and 19 static
  routes in Edge at 390/1440px and WebKit at 390px. Additional calendar/document
  flow checks passed in WebKit at 360/768px. PDF canvas pixels were nonblank.
- Screenshots and reports: `%TEMP%/a2z-pwa-production-audit`. The test preview
  server supports `PREVIEW_CERT` and `PREVIEW_KEY` for a temporary local TLS
  certificate; only loopback test contexts accept a self-signed certificate.
- Deployment and live health results are reported separately after `PUSH.bat`.

## Device Acceptance

WebKit emulation cannot verify an installed iPhone PWA's native Calendar, Files,
print or share sheet. The portal cannot directly write to Apple Calendar through
a browser API. A user must save a provider draft, sync that account with the phone,
or import the ICS through a compatible application. Provider links are one-off
copies, not synchronized subscriptions; re-adding can duplicate an event depending
on the calendar. No calendar tokens or private document URLs were made public.

After release, confirm on an installed iPhone and Android device that opening and
closing claim/receipt/PDF views retains the same claim and that an event saved in
the selected calendar has the correct MYT date and start/end. Native WebView hosts
must support external links and file downloads; host code is not in this repository.

## Implementation Map

- `components/ui/app-dialog.tsx`: top-layer viewer, browser history and close lifecycle.
- `components/ui/document-preview.tsx`: HTML, image and PDF previews, export and retry.
- `components/ui/calendar-dialog.tsx`, `lib/event-ics.ts`: explicit calendar destinations.
- Existing print call sites in staff/admin/portal components and `lib/receipt-print.ts`.
- `worker/src/staff.ts`, `index.ts`, `m2e.ts`, `webpush.ts`: shared export and strict typing.
- `app/error.tsx`, `app/portal/error.tsx`, `app/doc/page.tsx`: recovery/return controls.
- `tests/pwa-production.cjs`, `tests/production-safety.mjs`: runtime regression coverage.

Breaking changes: no data/API schema changes. Print actions now open a preview;
users choose Print from its toolbar. `sharePdfFile()` adds a `cancelled` result.
Migration: none. Deployment: use the existing `PUSH.bat` workflow.
