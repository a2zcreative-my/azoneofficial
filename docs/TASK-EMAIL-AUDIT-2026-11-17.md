# Task email pipeline: audit (17-11-2026)

**Asked:** the CEO, 17-11-2026:
- *"Audit the actual email pipeline: task triggers, notification generation, Cloudflare/email provider configuration, sender verification, queue processing, retries and delivery logs"*
- *"Fix the broken email preview and verify that email notifications can actually be sent and received"*
- *"Do not claim emails are working until real end-to-end delivery is successfully tested."*

**Verdict:** the engine is complete and correct in code. **No task email has ever been sent from production**, because sending is not configured. Real end-to-end delivery has **not** been tested. It cannot be tested until the owner completes the four setup steps in §4.

## 1. The pipeline, as built

| Stage | Where | What happens |
|---|---|---|
| Event | staff.ts, tasks-progress.ts | A task event (assign, reassign, update, mention, review, decision, manual reminder) writes the bell and push through `notify()`, then calls `queueTaskMail` under a unique ref. |
| Sweeps | task-mail.ts `taskMailSweep` (hourly) | Due-soon (the lead time), overdue on day 1, 3 and 7 then stop, and escalation to the reporting line after N days. |
| Digest | task-mail.ts `taskDigest` (cron `30 0 * * *` = 08:30 MYT) | Off by default. One summary per person with open work; never empty, never on leave or a holiday. |
| Queue | `mail_outbox` (migration 0161) | One row per email. `ref` is UNIQUE (`ON CONFLICT DO NOTHING`), so a retried request, a second cron pass or a redeploy cannot queue twice. |
| Rules at queue time | `queueTaskMail` | The sender must be configured, otherwise nothing is queued. Task emails and the trigger must be on. The recipient must be a current, active staff member with an email who has not switched task emails off. Quiet hours hold non-urgent mail (21:00–08:00). A daily cap applies per person (8); new assignments, reassignments and manual reminders are never capped. |
| Drain | `drainMailOutbox` (every 5 minutes) | Claims each row (`queued → sending`) so two passes never send it twice. On success, `accepted` with the time. On failure, a retry after 5 minutes, then 20 minutes, then `dead` with the provider's answer. Rows older than 2 days expire. |
| Send | mail.ts `sendMailResult` | Cloudflare Email Sending through the `send_email` binding `EMAIL`, from `MAIL_FROM`. It returns Cloudflare's own answer, which goes into the log verbatim. |
| Log | `/staff/tasks/mail-log` | Every row with its status, attempts and last error. Retry is the CEO's. |

The pipeline is one engine: the email leg of the existing notification engine. No second engine exists or was added.

## 2. Findings

| # | Finding | Cause | Status |
|---|---|---|---|
| F-1 | **Email sending is not configured** (the screenshot) | `[[send_email]] name = "EMAIL"` and `MAIL_FROM` are commented out in `worker/wrangler.toml`; the domain is not onboarded in Cloudflare Email Sending | **Owner action, §4.** It is correct that nothing is queued until then. |
| F-2 | **The email preview was broken** | The API sends `X-Frame-Options: DENY` on every response (correct). The panel drew the preview with `<iframe src="/api/v1/staff/tasks/mail-preview">`, which the browser refuses. | **Fixed (1.337.0).** The HTML is fetched and drawn with `srcDoc` in a sandboxed frame (no scripts, no same-origin). DENY is unchanged. |
| F-3 | **An escalation linked the reporting line to a task they cannot open** | The escalation goes to `reports_to`; `taskAccess` lets only the assignee, helpers, the person who set it, task managers and the project's people view a task. An HOD in, say, sales is none of those. | **Fixed (1.337.0).** Every task email asks `taskAccess` whether the recipient may open the record. If they may not, the email still goes, but links to their Tasks list and says *"You cannot open this task record yourself - ask the person responsible or management."* Giving the reporting line read access is P-1 below. |
| F-4 | **"No longer yours" linked the previous assignee to a task they may no longer see** | Same cause as F-3 | **Fixed by the same rule** |
| F-5 | The configuration panel could not show *why* it was not ready | Only `ready: true/false` was returned | **Fixed.** `GET /staff/tasks/mail-settings` now also returns read-only diagnostics: binding present, `MAIL_FROM`, outbox table present, waiting count and oldest, last accepted, last test, not-sent in 7 days. "Proven" means an accepted message, never configuration alone. |
| F-6 | Email settings sat at the foot of Tasks > Reports & Archive | — | **Moved** to System > Automation & Rules (Task Email · Delivery Log), with the same roles (CEO, COO, CCO, super admin) and the same routes. |

**Checked and correct, unchanged:**
- **Triggers and recipients:**
  - assigned: the assignee;
  - moved: the new assignee and the previous one;
  - update: the person who set the task, the Project Owner and the assignee, at most once a task an hour;
  - mention: the mentioned person only, who must be on the task;
  - review: the reviewers;
  - decision: the people who did the work;
  - due: the assignee, not on leave or a holiday;
  - overdue: day 1, 3 and 7, then stop;
  - escalation: the real reporting line or nobody, and the log says "no reporting line";
  - manual reminder: once per task per 12 hours, with a reason;
  - broadcast: once per person per hour, their own tasks only.
- **Duplicates:** impossible (a unique ref plus the claim).
- **Quiet hours and the daily cap:** as documented.
- **Excluded recipients:** customers, suspended accounts and leavers never receive mail.
- **What an email never carries:** money, customer contacts or a login token.
- **Every task link:** `/portal?tab=Tasks&task=<id>`, opened through the same record focus a bell uses, so the server still decides access.

## 3. Proposals for the owner's approval (not built)

| # | Proposal | Why it needs approval |
|---|---|---|
| P-1 | Let a reporting line (HOD) read the tasks of the people who report to them | This is a permission change. Today the HOD gets the escalation without a link to the record. |
| P-2 | Use the digest time setting (or remove it) | The setting is stored, but the cron fires only at 08:30 MYT. The screen says 8:30. |
| P-3 | Bounce and complaint handling | Cloudflare Email Sending returns "accepted"; it does not report a later bounce to the Worker. A mailbox that bounces shows "accepted" unless the send itself is refused. |

## 4. To make task emails actually send (owner steps)

1. **Onboard the domain.** In the Cloudflare dashboard: Compute > Email Service > Email Sending > Onboard Domain, then `a2zcreative.my`. Cloudflare adds SPF, DKIM and DMARC.
2. **Bind the sender.** In `worker/wrangler.toml`, uncomment `[[send_email]]` and `name = "EMAIL"`, and add `MAIL_FROM = "A2Z Creative Marketing <hello@a2zcreative.my>"` to `[vars]`.
3. **Release.** Run `PUSH.bat`.
4. **Prove it.** Go to Automation & Rules > Task Email > Send a test to me.
   - "Accepted by Cloudflare" means Cloudflare took it.
   - Open the inbox (and spam) to confirm it **arrived**.
   - Then assign a task to a colleague and confirm their email arrives and its button opens that task.

Only step 4 proves delivery. Nothing in this sandbox can: it has no access to Cloudflare (the proxy refuses `workers.cloudflare.com`), and production has no sender.

## 5. Tests

| Test | Covers |
|---|---|
| `tests/go-live-m.mjs` | Runs the whole worker on SQLite. Now 65 checks and 15 mutations. **New:** M18 (an HOD who may open the task gets the record link), M19 (an HOD who may not gets their Tasks list and the access line), M20 (the assignee's email links straight to the record). |
| `tests/task-email-workspace.mjs` (new) | The screens: four views, the drawer, history from the existing read, settings only in Automation & Rules, the preview via srcDoc with DENY kept, no delivery claim, one engine. |
| `tests/browser/task-reports-email.py` (new) | The same in a real browser, including the preview drawing and the not-configured state. |
