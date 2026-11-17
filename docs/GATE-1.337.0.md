# GATE 1.337.0 — Tasks → Reports & Archive in four views; the Task Email workspace; the preview fixed; task email links only to records the reader may open

**Status:** BUILT AND TESTED. **NOT DEPLOYED.**
**Migration:** none.
**Sits on:** 1.336.0 (the other session's Attendance 1.333.0, Payments 1.334.0 and the shell's presence 1.335.0 / 1.336.0), all on the PC.

**Authority:** the CEO, 17-11-2026, with two references:
- *"Improve A2Z OS → Tasks → Reports & Archive and review the entire Task Email Notification system"*
- *"Do not claim emails are working until real end-to-end delivery is successfully tested ... Do not deploy without approval."*

## Email delivery: the honest state

**Task emails are NOT working in production, and real end-to-end delivery has NOT been tested.**

The engine is complete and its behaviour is proven against the whole worker (65 checks). But no sender is configured:
- the `send_email` binding and `MAIL_FROM` are commented out in `worker/wrangler.toml`;
- the domain is not onboarded in Cloudflare Email Sending.

The sandbox cannot reach Cloudflare. The owner's four steps, and how to prove delivery, are in `docs/TASK-EMAIL-AUDIT-2026-11-17.md` §4 and in the new Setup checklist drawer.

## What changed

### Tasks → Reports & Archive
- **Layout:** one strip of four figures and one view switch (Submitted Reports · Team Performance · Completed Tasks · Task History). One view is shown at a time; the others are hidden, never unmounted.
- **Submitted Reports:** the register beside the chosen report, read whole. **Submit Report is a drawer**:
  - daily, weekly and monthly kept, with the same route and the same review rule;
  - a failed submit keeps the draft and says why.
- **Task History:** each task's recorded story, from the existing activity read.
- **Team Performance:** the company card and the staff table (managing roles).
- **Completed Tasks:** the archive, as before.
- **Fit:** one screen at 1440 × 900; no sideways overflow at 390 px.

### System → Automation & Rules (the authorised settings workspace)
- **Views:** Task Email · Delivery Log · Watcher Rules · Attendance Policy. Task email views are for the CEO, COO, CCO and super admin.
- **Task Email:** the strip, the not-configured banner and checklist, the triggers and rules, the configuration as the Worker sees it, and the preview.
- **Delivery Log:** each email with Cloudflare's answer, a filter, a pager and Retry.
- **One engine:** the same routes and gates as before.

### Fixes
- **The preview:** the API's `X-Frame-Options: DENY` refused the old iframe `src`. The preview is now fetched and drawn with `srcDoc` in a sandboxed frame; DENY is kept.
- **Links:**
  - every task email links to the record only if the reader may open it (`taskAccess`);
  - otherwise it links to their Tasks list and says so (HOD escalation, the "no longer yours" note);
  - in that case the "update your progress" lines are left out.
- **Diagnostics:** read-only delivery diagnostics on `GET /staff/tasks/mail-settings`.

## Tests run (in the sandbox, against this build merged onto the PC's 1.336.0)

| Check | Result |
|---|---|
| All guards (`node scripts/run-guards.mjs`) | **213 / 213 pass** on the merged tree. One earlier run, made while a build and the browser suites were running at the same time, failed one timing-sensitive race mutation in go-live-l (leave, untouched here). It passed 3 of 3 alone and in the full rerun. |
| Lint | 0 errors, 115 warnings (limit 125) |
| `tests/go-live-m.mjs`, the whole worker on SQLite | 65 checks, 15 mutations; new M18–M20: the record link only for someone who may open it |
| `tests/task-email-workspace.mjs` (new) | 14 checks, 11 mutations |
| `tests/browser/task-reports-email.py` (new) | **36 / 36** |
| tasks5 | 82 / 82 |
| shell-3 | 27 / 27 |
| shell-e1 | 28 / 30. **The two failures are not this release's.** The rail now carries Roster & Scheduling (1.327.0), and the name card's label now ends in " · online" (the other session's 1.335.0). The test still expects the older rail and label; it needs updating by whoever owns those releases. |
| attendance4 (the other session's 1.333.0) | 39 / 39 |
| payments-verify, payments-3 (the other session's 1.334.0) | 63 / 63, 202 / 202 |
| tasks2 | 105 / 105 |
| task-progress | 84 / 84 (adapted: the settings are opened from Reports & Archive and checked in their new home) |
| desk5 | 168 / 168 |
| hr4 | 62 / 62 |
| news2 | 97 / 97 |
| ui-system | 348 / 348 |
| overflow sweep | 272 / 272 screens clean |

**What task-reports-email.py proves:**
- **Reports & Archive:**
  - the strip has four figures and the view switch four views, with only the active one shown;
  - one screen at 1440 × 900;
  - the register beside the full report;
  - the filters work;
  - Submit Report is a drawer with daily, weekly and monthly, and sends ONE POST to the same route;
  - the drawer closes after;
  - Team Performance, Completed Tasks (from its figure) and Task History (the recorded story) each show alone.
- **Task email settings:** the link opens Automation & Rules on Task Email.
- **Not configured** (production today):
  - the banner shows;
  - Setup required;
  - Not bound and Not set;
  - Send test is disabled;
  - the preview DRAWS (srcDoc) and no frame points at the API;
  - the checklist drawer opens;
  - the Delivery Log says nothing was sent.
- **Configured:** the log shows Cloudflare's answers.
- **Phones:** no sideways overflow at 390 px.
- **Roles:**
  - a salesperson sees only Completed Tasks and Task History, with no email link;
  - the Admin sees only Watcher Rules and Attendance Policy.

**Adapted, intent kept:**
- kept-lines: a report reads whole, its line breaks kept, now in its pane;
- skeleton-loading: the Delivery Log draws its own skeleton;
- design-tokens: unchanged.

**Real email output:** the real worker template was rendered for an assignee (the record link) and for an HOD who cannot open the task (the Tasks list link, the access line, no "update your progress" lines). See task-emails-real-template.png.

## Proposals waiting for approval

These are in the audit.
- **P-1:** reporting lines may read their team's tasks (a permission change).
- **P-2:** the digest time setting (stored, but the cron is fixed at 08:30).
- **P-3:** bounce handling (Cloudflare reports "accepted", not inbox delivery).

## Deployment

Nothing reached production. Run `PUSH.bat` when you choose. There is no migration.
