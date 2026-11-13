/* The gate that stands between a change and a2zcreative.my.
 *
 * v1.34.0 — the deploy is automatic now (GitHub → Cloudflare), so nobody is
 * watching a .bat window and reading the output any more. That makes this
 * script the last thing between a mistake and live invoices, and it has to
 * behave accordingly:
 *
 *   - it runs EVERY browser-free guard, not a subset;
 *   - a guard that cannot run is a FAILURE, never a silent skip. A skipped
 *     check reads exactly like a passing one in a build log, and "it went
 *     green" is what people remember;
 *   - it prints which guards ran, so the log proves what was actually
 *     checked rather than asserting it.
 *
 * HOW TO WRITE A CHECK — v1.82.0, after seven of these failed in one week
 * on changes that were CORRECT.
 *
 * A guard that goes red when the code is right is worse than no guard. It
 * costs a deploy, it trains everybody to read a failure as noise, and the
 * one time it means something it gets waved through with the rest.
 *
 * Every one of the seven had the same shape: the check named an
 * IMPLEMENTATION where it meant a BEHAVIOUR.
 *
 *   scheduledMinutes(shD)          when it meant "the day's own length"
 *   shortMins / WORK_DAY_MINUTES   when it meant "rounded to quarter days"
 *   "shift_start", "shift_end"     when it meant "the export is traceable"
 *   exportRows().length            when it meant "the button counts honestly"
 *   an eighty-character sentence   when it meant "the reason is on screen"
 *
 * So: assert the PROPERTY, and let the expression move.
 *
 *   - Match the shape, not the name: /\w+\(shD\) \|\| WORK_DAY_MINUTES/ over
 *     the exact function, when which function it is belongs to another check.
 *   - Strip what you are not testing. The "reason is on screen" check now
 *     removes every title={...} and asks whether the figures survive as
 *     text - indifferent to the wording, still fatal if it moves to a
 *     tooltip.
 *   - Pin prose ONLY when the prose IS the behaviour: a refusal that has to
 *     name the people, a notification that has to say "half a day". Never to
 *     identify a code path.
 *   - Pin a constant only where its VALUE is the rule (five hours is the
 *     Employment Act), never as a landmark for finding a line.
 *
 * `node /tmp/brittle.mjs`-style sweeps flag candidates; the judgement is
 * whether the thing named could be rewritten while staying correct. If it
 * could, the check is naming the wrong thing.
 *
 * The four Playwright guards (bm-coverage, leaderboard-sales-floor,
 * location-scenarios, no-false-attendance) are NOT here: they drive a real
 * browser against a served build, which Cloudflare's build container has no
 * Chromium for. They are listed at the bottom of this file as the set that
 * still has to be run before a release, so their absence is on the record
 * instead of being quietly forgotten.
 */
import { spawn, spawnSync } from "node:child_process";
import { cpus } from "node:os";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/* Order matters only for readability — each of these is independent. */
const GUARDS = [
  ["browser-harness", "browser orchestration fails closed on skipped probes, unavailable tools, timeouts and missing fixtures"],
  ["backup-restore", "backup recovery metadata and checksums survive an isolated SQLite restore; corrupted exports fail verification"],
  ["backup-completeness", "a capped export fails before publishing or pruning backups; exact-limit exports preserve their rows"],
  ["brands-guard", "brand registry, client-permission gate, no hardcoded domains"],
  ["csrf-guard", "every state-changing endpoint is CSRF-protected"],
  ["doc-issuer-render", "quotations/DOs/invoices render under the right letterhead"],
  ["document-issuer-guard", "issuer is set at creation and never editable after"],
  ["origins-guard", "CORS origins match the deployed domains"],
  ["permissions-policy", "Android location permission policy is intact"],
  ["shift-sales-split", "sales are attributed to the right shift"],
  ["bridge-feed-guard", "the ELFIA feed sends the right price and nothing else"],
  ["bridge-idempotency", "a store movement applies exactly once, however often it retries"],
  ["traffic-contract", "a re-sent traffic day REPLACES the day we hold, never adds to it"],
  ["authz-guard", "the authorization rules the 27-08 security audit found broken stay fixed"],
  ["dashboard-authz", "the dashboard summary grants no authority of its own: every field carries its owning endpoint's permission, and a pre-fix cached copy does not survive the upgrade"],
  ["no-public-signatures", "no real signature image is publicly downloadable"],
  ["live-topics", "every live card watches a topic that actually exists, and the bump plumbing is intact"],
  ["roster-tasks", "a task block can never reach the sales attribution that pays commission"],
  ["tiktok-id-precision", "19-digit TikTok ids survive the JSON parse instead of being silently rounded"],
  ["business-cards", "the printed slugs still resolve, and every vCard matches constants/team.ts"],
  ["unpaid-leave", "the CEO-only powers stay CEO-only, and one unpaid day is deducted exactly once"],
  ["web-order-tracking", "the shop owns the courier map — this repo never builds a tracking URL"],
  ["csv-export", "an export Excel reads correctly, holding exactly the rows on screen"],
  ["payroll-days", "only a joiner or a leaver is prorated, and approved paid leave never costs a ringgit"],
  ["shift-schedule", "hours come from each person's schedule, and an unapproved punch counts for nothing"],
  ["action-feedback", "nothing destructive happens in silence — a delete says so, either way"],
  ["api-routes", "every path the portal calls is one the worker answers at (the Offboard 404)"],
  ["skeleton-loading", "nothing loads without a skeleton in its own shape — no words, no spinners, no blank cards"],
  ["staff-order", "one company order on every payroll surface, and a rest day cannot be credited twice"],
  ["shell-scroll", "on desktop the shell scrolls and the document does not - no second scrollbar, no white void under the canvas"],
  ["clickable-data", "a figure worth acting on can be opened where it stands - no trip to another tab to find the rows behind a count"],
  ["render-stability", "no component is declared inside another - React would rebuild the subtree every render and any input inside it would lose focus mid-keystroke"],
  ["threads-guard", "the Threads credential never leaves the worker, every action on it is audited, and a sync tick spends a budget it cannot exceed"],
  ["person-access", "one person can be granted or refused a tab above the role - deny beats allow, Dashboard and Profile cannot be refused, and only the CEO can do it"],
  ["threads-malaysia", "a study post is Malaysian because its own text says so - Malay not Indonesian, RM, a Malaysian place - with the reason stored beside it; asking is told from selling; and nothing about a person is ever looked up"],
  ["hotels-guard", "the hotel directory keeps ONE state vocabulary across the migration, the worker and the map; phone numbers are stored in Malaysian form; the tab is the six roles the CEO named; and a delete is soft and audited with what it removed"],
  /* v1.114.0 (housekeeping) - twelve guards written between v1.101 and v1.113
     were on disk but not in this list, so the deploy never ran them. Found
     while splitting the page; registry-parity now refuses a guard file that
     is not registered here (or documented as Playwright-only below). */
  ["migration-safety", "every migration is ASCII, uses -- comments with no quotes or semicolons inside them, and ends in a semicolon - the shapes that have stopped PUSH.bat at 'Database changes'"],
  ["org-chart", "who reports to whom is one field, assigned only by the CEO, COO and CCO, drawn as a tree with no cycles"],
  ["lazy-panels", "every tab's panel arrives when the tab is opened, none of them twice, and the first screen is untouched"],
  ["remembered-views", "a view paints from the device first and refetches behind, on the topics that move it"],
  ["cached-api", "the data layer keeps its contract when answers arrive out of order, an account changes mid-flight or a card closes first"],
  ["outbox", "only the named routes queue offline, every queued write carries an idempotency key, and the phone's time is recorded as pending"],
  ["one-desk", "the desk shows each person exactly what they may act on, by the rules the routes enforce"],
  ["search-everything", "one query over eight sources, each gated by its own tab's permission, phone numbers matched by digits"],
  ["watchers", "findings are pushed once, cleared when fixed, the brief is personal, and no watcher looks at hotels"],
  ["hourly-by-the-clock", "a part-time live host is paid what the clock says less one hour of break past five"],
  ["hotel-pipeline", "the hotel list is a review-outreach pipeline: stages move by what happened, due means a lapse, a call is kept without signal, no money and no watcher in it"],
  ["sales-map", "the sales map places every ringgit it can by state and says what it could not"],
  ["portal-split", "the portal page is a shell and fourteen domain files, and stays that way"],
  ["tab-zones", "Ecommerce, Inventory, Sales and ELFIA Store read in zones; the document form is the paper, previewed by the template that prints"],
  ["doc-theme", "the paper palette has one owner, and paper stays paper in every theme"],
  ["scroll-ownership", "the document scroll has two owners, and both name the other"],
  ["theme-color", "the browser's own chrome follows the theme"],
  ["status-tokens", "live UI says good / bad / needs-attention in tokens, not raw palettes"],
  ["card-vocabulary", "every bordered surface gets its look from a name in lib/ui-styles.ts"],
  ["app-icons", "rendered UI draws icons from one map, not emoji"],
  ["signature-entities", "a document is signed by the entity that issued it, at the version it was signed with"],
  ["cards-tab", "the Cards tab belongs to the three officers, and says what that restriction is"],
  ["roster-leave", "an approved leave day cannot be booked, on any of the five doors that choose one"],
  ["input-truth", "a box that shows a saved figure shows the SAVED one, and the ELFIA panel agrees with the shop"],
  ["clock-sessions", "a day is a list of shifts, the hours between them count as nothing, and overtime is what lies outside the schedule"],
  ["tiktok-line-match", "a TikTok line finds its inventory item by its distinctive words, in any order; a tie is refused, never guessed"],
  ["inventory-category", "the stock list reads one family at a time - the same strip on the desk and the phone, and the totals follow the choice"],
  ["users-ui", "the Users tab draws from the shared vocabulary, one filtered list feeds the desk and the phone, and a row action is a real tap target with a real name"],
  ["interface-system", "portal commands share one 44px pill system on phone and desktop, while the Dashboard keeps one shift hero and one tabbed work overview"],
  ["portal-experience", "the responsive portal keeps daily phone actions stable, groups authorised modules, and opens Staff as a searchable directory"],
  ["roster-pdf-events", "the shared roster PDF carries the calendar: an event assigned to somebody prints on their row and only theirs, a whole-floor event prints once in its own band, the times survive the column, the legend names the colour and it is not the Shopee colour - built here and read back out of the content stream, so a builder that takes the events and ignores them fails"],
  ["interface-v3", "Portal Interface System V3: the named-class design system exists once and in tokens, the vocabulary resolves to it, the migrated surfaces stay migrated, the PWA shell keeps its safe areas, and the three retired tabs stay retired"],
  ["tailwind-retired", "Tailwind is retired and stays retired: no engine, plugin or tailwind-merge in the pipeline, no Tailwind at-rule in a stylesheet, the frozen legacy sheet only shrinks (a per-file budget that can only fall, no utility it does not define), and the migrated surfaces reference none"],
  ["tab-concept", "every tab reads like the Dashboard: a stack of captioned zones on the shared classes, the figures before the records, several things on one topic behind the shared pill row with the panes hidden and never unmounted, one column on a phone and side by side from 1024px - and no tab root is a bare legacy stack"],
  ["tab-arrival", "no animation holds a transform on a container, so a confirm, prompt or toast opened from a tab is sized to the screen and not to the tab (Claims on the CEO's iPhone, 23-09-2026)"],
  ["dashboard-overview", "the Dashboard overview is a window, not a second system: one sales figure (the Sales floor's four channels, the bars captioned), one task rule shared with the Tasks page, no writes, each read only for the roles the worker answers, no sample or invented figures, every My Day zone kept, and quick actions that open the existing forms"],
  ["global-search", "one search and one bell: the search runs against the real schema and finds, for each role, only what that role's own lists show (leave and claims by the very rules their lists use; no leave reason, no claim amount), the page and the bell only read (Approvals is the Desk's own list), and every search hit and notification opens its own record in the module that owns it"],
  ["leave-module", "one leave request, one approval workflow, one authoritative balance: the four days-used sums keep one rule and meet the one accrual, the page's approvers are the worker's chain, the details drawer only points (links gated by the tab strip, no figures, no writes of its own), and the team views show who is away, never why"],
  ["payroll-module", "one payroll calculation, held where it is: the browser's net (what Save stores) and the server's Recompute add the same terms for salaried staff and part-timers, the totals are that net summed, OT is priced once, the bank files read the saved net first and the screen warns about rows without one, and the history and the salary drawer only read"],
  ["on-shift-module", "one work session, one record, two interfaces: the browser pairs punches exactly as the server does (run on the same punches), every save of a punch is conditional so two phones cannot both clock in, On Shift punches through the one punch(), a held punch is shown as not confirmed, the timer runs only from the server's clock-in, and the team section is drawn only for the roles the monitor answers"],
  ["today-shift-summary", "one function, one owner: On Shift is the only place a punch is pressed; the Dashboard's Today's Shift is a read-only summary of the same state (run for real: nothing before the server answers, a held punch not confirmed, review first, never invented) that opens On Shift, and the phone header says the date or the company"],
  ["staff-headcount", "one staff status: the Staff tab's Active, Roles written, Needs Attention, employment types and status chart, the Dashboard's Active staff and the search label all read the one rule (on staff today and started; run for real in the browser and in SQLite on the brief's scenarios), leave never changes headcount, pickers and payroll keep their own rules"],
  ["sales-packages", "one packages library, one quotation engine: packages are written by the CEO, COO, CCO and super admin only (direct requests), versions are never edited, a quotation copies its lines and names the package and version (active, offered under its issuer, service, quotations only), customized is flagged, a later price change leaves saved quotations as they were, convert keeps the link once, no commission row, and the browser's line arithmetic is the package's (run against SQLite, mutations caught)"],
  ["tasks-module", "one task record, many views: the Tasks page calls only the task routes that exist, Edit is the existing update (reassign for managers only), Create is the same create in a drawer, the Calendar draws the deadlines already loaded, the three statuses stay three, the Reports card lists what it counts, and the archive says how far back it reaches"],
  ["assets-module", "one asset record, many views: the Assets page calls only /staff/assets and the audit read, the value is the recorded price with lost and disposed out, no depreciation, five statuses on both sides, the drawer uses the page's own edit, status and removal behind the server's gate, the register sends full names and the warranty alert uses the page's rule"],
  ["ecommerce-module", "one order record, one stock source: the sync and the webhook share one TikTok status mapping and a live update never overwrites returned, the signature check still refuses first, the paged TikTok read is read-only and bounded, fulfilment counts TikTok orders only, the page writes nothing but the sync (one hook, one press), no secret or setup wording for non-management, honest labels, one list for phone and desk"],
  ["page-frame", "the page frame is the same on every tab: no period chip on a figure tile (the period is said once, in the sub-line), Attendance and Stokis on the shared KpiTile, Threads on the shared tab bar, the shared chip tokens"],
  ["design-tokens", "A2Z OS 3.0 foundation: raw colours, odd breakpoints, raw radii and hand-made dialogs may only fall (ratchet per file), the layout tokens, one KPI tile size, the shared StatusChip / WorkRow / TableCard / ErrorState / FormField / Switch on tokens only, a drawer with unsaved typing asks before it closes"],
  ["executive-workspace", "Minimal Executive Workspace E1: the photo's rail (its modules, the rest under More, Projects into Tasks > Projects for project_view only), navy ink on the gold pill, the name card's account menu sharing the More sheet's handlers, the header's search / bell / Help / dark mode, the 52px-well KPI tile with its change pill"],
  ["company-performance", "the Dashboard's Sales Performance route against the whole worker: the days add up to the week's company figure exactly, each week by its own channel rule, null after today, the same point last period, outstanding less verified payments, management only, read-only (8 mutations)"],
  ["cards-public", "one official profile, one public card source: the printed QR is never redrawn, the image script reads the bilingual records and draws a card image; the public card reads only the record, has no edit control, shares via the phone or clipboard, pads for the notch, no invented social links; the staff check reads four fields, management only, writes nothing"],
  ["cashflow", "Finance 2.0: one booking per event (doubled, raced and re-run requests book once), undone payments reversed with a reason and the journal mirrored - never deleted, money in by the Sales rule, every movement on the day it moved, transfers outside money in and out, a book balance only from an entered opening balance, reconciliation from the records, corrections for the CEO, COO and super admin only, no commission cash row"],
  ["profile-self", "Profile 2.0: my record only (profile, payslips, months take no id), phone the one self-edit (real number, before and after audited; name and protected fields refused), the release rule on the month list with no figures, an update request that rings HR and the CEO and changes nothing, re-authentication before two-factor is added, and My Payslips showing the slip's own figures (run against SQLite)"],
  ["news-acks", "one announcement record, accurate acknowledgement history: 0146 keeps every post and acknowledgement and lets a memo save; one acknowledgement per person per version, server-timed, for the session user, refused for a version not shown; an edit of the words is a new version with the old text kept; department posts and joiners respected; the publisher is the login; only management publishes, edits, attaches and reads who acknowledged (run against SQLite)"],
  ["sales-figures", "one set of sales figures from every record: the summary route reads the whole table with the existing rules (run against SQLite past 200 documents), balance after part payments not voided, cash received counted once, read-only, no invented target; the tiles use it with their own sums as the fallback; new enquiries ring sales and the CEO and are worked on Sales over the existing routes; the Enquiries tab stays retired"],
  ["payroll-commission", "payroll 2.0 phase A: one live CEO/COO/super-admin confirmation per invoice, only on an invoice paid in full at its total and never on your own sale, revoked with a reason or automatically when the invoice changes, never deleted; payroll reads confirmations and writes nothing; no OT column and no commission box, OT still in Net and on the payslip"],
  ["sales-workspace", "one verified sale, one verified closer: an invoice's salesperson is locked from its first recorded payment (the write itself guarded), every change audited from and to, corrections by the CEO tier only with a reason; the workspace writes nothing else, shows no invented commission, calls no retired module, counts collected by the Paid tile's rule, and keeps its bodies mounted"],
  ["staff-responsibilities", "roles and responsibilities on the Staff tab: one permission on both sides (the CEO and the HR tier write, everyone reads), its own route with no fill-once lock and working staff only, the change audited before and after, migration 0137 registered in all three places with a skew rung so the tab never goes blank, the block on the record card with the button hidden from those who may not write, and the read-only view on the Profile"],
  ["month-days", "the Dashboard's month is the payroll's month, run against a real SQLite database: on time, late and half day are judged against the block the punch was for, a rest day worked is never late, today is never absent before it is over, and a punch awaiting the CEO is neither present nor absent"],
  ["event-attendees", "an event can name who has to be there - only they are told, an empty list still means everyone, and the whole floor still sees the event"],
  ["map-extrusion", "a raised state is still Malaysia - every wall belongs to its own state, nothing raised leaves the frame, and a state with no figure draws no wall"],
  ["movement-cost", "money on a stock movement says per unit AND line total, a correction is valued at cost, and an item with no cost is named rather than treated as free"],
  ["movement-purpose", "the REASON a movement happened decides whether it is a sale - a marketing loan is neither revenue nor a loss, and a return is not a revert"],
  ["company-review", "company reconciliation never infers ownership and saves review plus audit atomically"],
  ["companies-v2", "Companies 2.0 - counted figures, read-only history, a previewed all-or-nothing bulk review, company access not active"],
  ["accounting-v2", "Accounting 2.0 - atomic, dated, once-only posting; soft month-end control; manual reversal; read-only ledger views"],
  ["weekly-dashboard", "the Weekly Sales Target on the Dashboard: one engine with Sales - the company's week (target, collected, %, remaining) for every staff member, my revenue target and contribution goals, my team for an HOD on the chart (name, target, collected, %, status only), everyone by department for management; a person's week is their collected invoices only and once, the company's week counts every channel from 10-11-2026 (v1.275.0; the TikTok amount for revenue readers only, earlier weeks invoices only); a goal counts records, an introduced lead only once someone else qualifies it; targets set by the sales_week_target capability with history; resigned staff out from their last day; commission untouched; Dashboard = Sales scorecard (whole worker against SQLite, mutations caught)"],
  ["weekly-sales", "Weekly Sales - approved targets only, the Collected rule, working days, fair statuses, final weeks, recovery plans to linked tasks once"],
  ["go-live-a", "Release A of the go-live plan (whole worker against SQLite): F1 a task checklist reads its own items, B9 two documents raised in the same second get two numbers, F4 a throw in the TikTok sync leaves the rest of the 30-minute chain running (mutations caught)"],
  ["go-live-b", "Release B of the go-live plan (whole worker against SQLite, 0157 applied): one live invoice per quotation (two converts at once: 201 + 409, stock once), void never delete (reason, who, when; refused when paid or with live parts; stock back via in rows; the quotation reopens and the replacement names the void), part payments never exceed the total (two at once), refunds within the money in, an edit never below money received, an over-sell refused (and a lost race taken back), a returned loan final, stock writes once per key, dates real, returns at cost, whitespace SKUs refused, published prices by elfia_publish, an expired quotation not accepted or invoiced, an accepted quotation revised not edited, three locked matrix cells (mutations caught)"],
  ["go-live-c", "Release C of the go-live plan (whole worker against SQLite, 0158 applied, a fixed clock): an overnight shift and a month-edge session pair and derive, an HR punch re-derives and is never doubled, approved leave closes the shift, leavers cannot punch or take tasks, a customer is nobody's manager, the monitor is the headcount, the CEO signs a COO's leave once, leave requests are real (overlap, entitlement, dates, rest days), HR reads a balance, real staff dates, the automatic payslip gate holds, force is the release holder's and audited, one payroll population for list / total / Paid / both bank files, Paid once, released, with nobody left behind (mutations caught)"],
  ["go-live-d", "Release D of the go-live plan (whole worker against SQLite with two in-memory R2 buckets, a fixed clock): a 60,000-row table is backed up in verified pages to the backups bucket and downloads as one file that verifies; a damaged page fails; a failed run leaves nothing and keeps the earlier backup; the newest 30 complete backups are kept; media is copied (40 a pass), a changed object keeps its old copy, a deleted one moves to deleted/ for 90 days, the weekly check re-hashes and reports damage; read notifications past 90 days pruned, audit_log never; offboarding and deactivation remove push subscriptions; no task to a leaver, no impossible due date, no overdue bell for a leaver; the brief and birthdays once, never for leavers; the restore drill, restore-rows and restore-media work on the worker's own backup; PUSH.bat checks the bucket and exports before migrating (mutations caught)"],
  ["go-live-p", "Project Workspace (whole worker against SQLite with 0159, each role by direct request): one brief per quotation on a press, owner assigned by CEO/COO only, only the owner and CEO/COO/CCO edit, assigned staff append updates on their own tasks (append-only, once per press), others ask to help, every staff member sees the shared fields while prices and contacts go by right, private files, an expired quotation never starts, the scope frozen at activation, completion by CEO/COO, project tasks through POST /tasks and never deleted, nothing in sales, commission or payroll written (mutations caught)"],
  ["go-live-t", "task progress (whole worker against SQLite with 0159, each role by direct request): every task has one responsible person and an audited reassignment with a reason, structured append-only progress updates with private evidence, a retry lands once, the checklist is the one source of its percentage, comments apart from progress and only for the people on the task, the latest update in All Tasks, completion reviewed by whoever set it (never by the assignee), returns need a reason, project tasks run by the Owner and CEO/COO/CCO only, the CCO out of money, every open task listed, nothing in sales, commission or payroll written (mutations caught)"],
  ["go-live-m", "task emails (whole worker + task-mail against SQLite with 0161, each role by direct request, a fake Cloudflare send_email binding): one sender, nothing queued while it is off, one email per event by ref, assignment/reassignment/updates once an hour/mentions/review, reminders before the deadline, overdue on day 1/3/7 then stop, the verified HOD or nobody, manual reminders with a reason once in 12 hours, quiet hours, a daily cap, an optional digest that skips leave, failures logged verbatim and retried three times, nothing in tasks, sales or payroll written (mutations caught)"],
  ["go-live-s", "signatures & stamps and task dates (whole worker against SQLite with 0162/0163, each role by direct request, real authenticator codes, an in-memory vault): nothing changes until a company turns personal signing on; a signature is used only after the person AND the CEO confirm it (codes); a stamp belongs to one company; authority per company and document type; the ONE approval limit, approving signs, never one's own; sharing issues and fixes the marks; replacements never change an issued document; the raw officer chop is the vault managers' only; a task has a start date never after its due date; no amount, payment, commission or payroll row touched (mutations caught)"],
  ["go-live-g", "agents and task-update emails (the users rebuild keeps every row and column with foreign keys on; whole worker against SQLite with 0164, each role by direct request): an agent reaches only their own tasks, the active packages and their own requests; Sales reads, management edits; agents never staff for payroll or pickers; the owner alone creates agents; the CEO's task update carries only each person's own tasks, once an hour, audited (mutations caught)"],
  ["go-live-h", "the agent portal workflow (whole worker against SQLite, each role by direct request; the brief's acceptance tests T1-T24): Agent access only to a verified email on the same account, by the owner with a code; retry-safe submissions; Sales prefill and the AGR reference link; only an issued, approved, unexpired quotation revision is published; internal notes and files never reach an agent; another agent finds nothing; a client's yes needs evidence and Won needs the acceptance recorded on the quotation; no invoice, Paid or commission moves (mutations caught)"],
  ["go-live-i", "the CEO's business administration (whole worker against SQLite, by direct request; the brief's section 13 tests): without the company-owner record the CEO is refused every owner door and told why; once the super admin names him, invite (a set-password link, never a typed password), verified login email change, role changes, module permissions live on the next request, Agent access, suspend and restore, session revocation and MFA recovery - each with a reason, his code and an audit line; the Super Admin and the last recovery path protected; the CCO never gains Paid or payroll release; no signature, stamp, invoice, commission or payroll record moves (mutations caught)"],
  ["go-live-l", "the leave approval timeline (whole worker against SQLite, by direct request): HR, then either the COO or the CCO, then the CEO, each step with who and when; one decision per stage under a true race (stage-checked writes); returned for information and resubmitted through the same checks as a new request; rejection with its reason and withdrawal with its time are terminal; a CEO override shows skipped, never signed; internal notes never reach the applicant; the next approver is told; released payroll months flagged; no payroll row written (mutations caught)"],
  ["go-live-k", "the claims approval and payment timeline (whole worker against SQLite, by direct request): each chain's first stage and current approver from the one claim chain; actions exactly what the endpoints accept; unauthorized decisions refused; one decision per stage under a true race; returned for information and answered back to the same stage; approved is Payment due, never paid; one cash row on the bank date, never twice; reversals shown; history kept; internal notes never reach the claimant (mutations caught)"],
  ["go-live-n", "agent partnership commission (whole worker against SQLite, by direct request; the owner's tests A-L): no agent = the closer 10%; a qualified agent referral = the agent 7% + the verified closer 3% of the eligible net sales value, reconciled to the total; uncertain attribution held for review, never direct; decisions once with the reason; reassignment and closer corrections never rewrite the agent's history; each reader sees only their own rate; the closer in payroll once, the agent never; payouts authorised then settled by a different person, one cash row under a true race (mutations caught)"],
  ["go-live-o", "task closure and reopening (whole worker against SQLite, by direct request; the owner's tests A-I): one transition for every status move; 100% never closes a task; closing needs a summary and every deliverable (a manager's exception, with the reason, recorded); a task set by somebody else goes through Ready for Review and its reviewer; reopening needs a reason and keeps the closing record, checklist and progress; a cancelled task reopened by management only; the old dropdown neither closes nor reopens; two presses or a retry make one closure; 0169 copies the progress record exactly (mutations caught)"],
  ["go-live-v", "leave approval follows the Organisation chart (whole worker against SQLite, by direct request; claude/LEAVE-ROUTING-AUDIT.md rev 2 sections 13 and 14): the reporting manager is final - no HR or CEO stage; the COO and CCO to the CEO; the CEO's Executive Leave Record with his code and no approval; Requires configuration until Route now; a pending route frozen through a line change and through the CEO's switch; reassignment only upward, with a reason; the override with a reason, the approver told; HR's check never an approval and never on her own; escalation by the start date, never auto-approved (mutations caught)"],
  ["go-live-w", "sales discipline, Phase 1 (whole worker against SQLite, by direct request; claude/SALES-RECOVERY-AUDIT.md rev 2 sec. 12): the target, the pace by working days left, the best week, confidence only with history, risk with its evidence; the allocation reconciles with Unallocated, nothing split or pre-filled; Copy last week only where a week differs, never into a finished week; the advice on the records, own only for a seller, configured with a reason and audited; Do it makes one follow-up or task, a second press returns it; one open follow-up per document; the outcome recorded, nothing marked lost; commission, payroll and documents untouched; nothing sent; v1.263.0 the Dashboard reads the open quotations once and gets the same answers, the bank-account count (mutations caught)"],
  ["go-live-x", "secure authentication 2.0, Phase 1a - Google identity (whole worker against SQLite, by direct request; claude/AUTH-2.0-AUDIT.md rev 3 sec. 3.1, 5, 10, 12): a Google account is its sub; internal accounts and password customers are never linked by email, only the pre-1.238.0 Google customers get the restricted legacy link; with 2FA nothing is linked or changed before the code, applied by /auth/2fa/verify in one guarded batch (a zero-row step undoes it all); switched off or resigned meanwhile means no session; the challenge is an HttpOnly cookie scoped to /api/v1/auth/2fa, a replay fails; the kill switch and customer sign-up, the owner only with a code and a reason, audited; notices once a day; exact 2FA exemptions; GET /auth/methods; v1.265.0 Phase 1b: PKCE S256 or no start, single-use requests bound to the browser, the signed ID token checked every way (forged, none, HS256, wrong iss / aud / azp / nonce / time), Connect Google only into the same live session with a fresh code; v1.266.0 Phase 1c: the legacy window (closed until the owner opens it, 90 days), the notice once and owner-only, customers connect / disconnect with the password + an emailed code bound to their browser (five tries, single use), disconnect only while another way in remains, invoices follow the proven address, customer recovery with the identity check, three a day (mutations caught)"],
  ["go-live-y", "secure authentication 2.0, Phase R - executive recovery (whole worker against SQLite, by direct request; claude/PHASE-R-GOVERNANCE.md rev 2): only the owner names the panel (COO, CCO), a member counts after accepting with their own code and 24 hours; only the owner and the Super Admin can be recovered; one member asks, a different one approves, never the target, each with a fresh code; 12 hours, then one guarded batch resets 2FA, backup codes and every session and nothing else; cancel by the panel, the owner or the target; lapse after 24 hours, lock after three; a changed panel does not run; owner authority pauses until 2FA is back (mutations caught)"],
  ["go-live-z", "secure authentication 2.0, Phases 2A-2C - passkeys: owner, then named pilots, then all staff and agents, never customers (whole worker against SQLite with a software authenticator, by direct request): built switched off until the owner turns stage A on with a reason and a code, and only while the recovery panel is ready; owner only; adding needs a fresh code and the same session; origin, challenge, rpId, presence, verification, signature, counter and user handle verified; sign-in bound to the browser, single use, the account judged again; removal ends its sessions and keeps history; an administrator can remove a person's passkeys with an identity check; executive recovery revokes them (mutations caught)"],
  ["self-approval", "Phase 0 - no ordinary self-decision (whole worker against SQLite, by direct request; claude/PHASE0-SAFETY-REVIEW.md): nobody who holds a decision permission uses it on their own record - claims (as applicant or payee), paid claims, forgotten punches, manual punches and punch edits or deletions, unpaid days, commission entries - refused with 403 self_approval and audited, including a role given the permission in Roles and Permissions, the Super Admin and a second CEO account; the verified owner alone goes through as an executive record, audited and told to the COO, and any code the route already asks for still applies (mutations caught)"],
  ["deposit-billing", "Deposit billing (whole worker against SQLite, by direct request; the CEO, 10-11-2026): a SERVICE quotation is invoiced in parts - a share or an amount, then the balance - never past its total even when two invoices are raised at once; a voided part frees its amount; each part keeps the quotation's line names and its lines add up to exactly what it bills; a product quotation stays one invoice; an edit cannot take the parts past the quotation and the server stamps each part's share; the quotation row and the Sales summary show what is left to invoice; commission per paid part - a fixed amount only its share, so the parts never earn more than the sale (mutations caught)"],
  ["payment-ui", "Sales Payment Verification 3.0 screen (claude/PAYMENT-VERIFICATION-3.0-BLUEPRINT.md): one main action per invoice (never a second report on a fully pending invoice), settlement and review as two words, the CEO's own report awaiting the independent evidence review with no Verify button, verified outstanding never less pending, no 'receipt only', the switch in the owner's Settings sheet, four tabs, three-step report sheet, one rule across Sales"],
  ["payment-verify", "Sales payment verification (whole worker against SQLite, by direct request; claude/PAYMENT-VERIFICATION-AUDIT.md): with the owner's switch on, sales report on their own invoices and the COO and CCO on all, with proof; a report is not money; only the CEO verifies, with a fresh code, never his own report until the COO checked its bank evidence, into an account of the invoice's company; two verified parts settle one invoice and the server marks it paid, books cash once, confirms once and writes commission once (direct 10%, agent 7% + closer 3%); duplicates need a reason, overpayment stops at the balance, reject, clarify and reverse keep every row; the timeline is append only; Mark Paid and direct part payments are refused while on, unchanged while off (mutations caught)"],
  ["fa-engine", "Financial Advisory DSR engine (claude/FINANCIAL-ADVISORY-BLUEPRINT.md): integer basis points, only verified income, no DSR limit written in code, only verified criteria of the same product match, near the guideline goes to manual review, transparent checks with no score or amount, the annuity rounded up, debt consolidation in three periods with a settlement removed only once and only with its letter"],
  ["fa-api", "Financial Advisory routes (whole worker against SQLite, by direct request): fa_view holders only and their own cases, consent before figures, credentials refused, the IC stored masked, declared income never qualifies, a banker's words never an approval, an official decision only with the bank's letter, management verifies criteria, the agreement and fee refused while counsel has not cleared them, a disclosure only after a management Proceed, append-only notes and events (mutations caught)"],
  ["task-title", "Edit Task Title (whole worker against SQLite, by direct request): the title changes in place and nothing else moves (dates, assignee, status, progress, checklist, updates, helpers, files), helpers and outsiders cannot rename, an empty title is refused, a closed task is reopened first, the other person is told the old and the new title, Activity keeps both (mutations caught)"],
  ["fa-dsr", "DSR Pre-Check (whole worker against SQLite, by direct request): one engine for the Quick Check and the case, a Quick Check takes no identity and stores nothing, one figure set per case with duplicate facilities refused unless explained, a submitted assessment decided by the CEO, COO or CCO (never their own, owner excepted, never worded as a loan approval), banker matching only after Proceed and only verified in-date bankers, the CEO or COO approves an allocation, an enquiry and documents only under the client's disclosure consent for that bank, append-only reviews and disclosures, the agreement and fee still shut, no user, customer or finance row (mutations caught)"],
  ["fa-banker-pic", "Banker PIC workspace (whole worker against SQLite, by direct request): the relationship owner, the CEO or the COO edits a banker (owner and case limit CEO/COO only), another banker's email refused, a shared phone needs a reason, a changed work contact must be verified again (the old verification untouched), the banker's cases counted for everyone and named only for cases the viewer may open, the contact date and the letter's tenure written once (mutations caught)"],
  ["ecc4", "Executive Command Center 4.0 (the Dashboard, in the source): four figures in the photo's order, Company sales never titled Collected or Cash, Verified outstanding only while the CEO verifies payments, amount and count from one read, Pending decisions = the Desk's decide list, Not available with Retry instead of RM 0, the server's pace word, quoted value not revenue, the alert band only while something is wrong, management's My Day theirs alone, four quick actions, and every card that left the Dashboard found in its module (mutations caught)"],
  ["sales4", "Sales Workspace 4.0: six views in the address, one strip and one worklist, owner-only review, four separate Closed Sales facts"],
  ["desk5", "Desk consolidation: two views in the address, no Quick Actions, Active Alerts for the rule readers only, rows open the record, the Desk writes nothing, Completed reads only my own decisions, rules under System -> Automation & Rules"],
  ["onshift2", "On Shift v2.0 Release 1: a punch's location reaches the page as the server's outcome (word, distance, accuracy) and never as coordinates; one punch, one location read, no map service; the photo's layout; Team On Shift counts, filters, paging and drawer; the week from the server's verdicts"],
  ["news2", "News v2.0 Release N1: four tabs in the address, management tabs for publishers only, acknowledging stays the reader's one button, text never HTML, no invented views or likes, feed filters and paging, each tab its own figures, three acknowledgement sections, the composer asks once and keeps unsaved words, report and recipient CSV"],
  ["ecom2", "Ecommerce v2.0 E-1: six views in the address, Stock and Analytics only for those who may, the directive's Overview order (figures, attention, fulfilment, recent orders, stock alerts) in DOM order, the sales figure called gross, alerts and stock alerts from records, the fulfilment lifecycle said, the page writes nothing"],
  ["fa2", "Financial Advisory 2.0 Phase 1: six views in the address and the Dashboard's view switch on a phone, the directive's four Overview figures and one list to act on, no DSR result called Proceed, no fixed DSR limit, a flat or reducing illustrative rate in whole sen, Unknown never a yes, the next follow-up from the case's own Task, the fee on by the CEO but billed from nothing, the agreement and commission off"],
  ["fa-case-ops", "Financial Advisory 2.0 Phase 2, by direct request: a case's priority worked out from its records (never the DSR) - follow-up, review, banker documents, blockers, staleness; a management override with a reason, never on your own case, the computed level kept; case updates append only with author and time; a follow-up is an ordinary Task; waiting-on, pausing only by management; closed as completed, not proceeding or withdrawn; Finance untouched"],
  ["fa-registry", "Financial Advisory registry (whole worker against SQLite, by direct request): one bank, one branch and one banker record each (names, emails and phones normalised), a shared phone only with a written reason, a name never merges, nothing Verified on saving, the CEO or COO verifies with evidence and a review date and never their own registration (owner excepted), availability Unknown after 30 days, transfers and closed branches end assignments without rewriting history, append-only registry events, no login and nothing sent (mutations caught)"],
  ["navigation", "Global navigation: the CEO's seven groups in his order, every shown module in exactly one group, no desktop More or second registry cut, collapsed rail of group icons with keyboard-operable labelled flyouts, URLs and the default role matrix unchanged, phone bar unchanged, Users shown as Users & Security"],
  ["elfia-columns", "Phase 0, P0-B - the ELFIA booking columns: a production-shaped database (no booked_cents, no refund_flagged_at) takes 0179 and 0180, one ALTER each with plain comments, and every worker statement naming them then compiles; the PUSH.bat pre-flight checks each column is absent before the apply; the health probe reads both; a fresh database already has them, so they are marked applied there (mutations caught)"],
  ["commission-ledger", "Sales commission - one entitlement per event, the approved policy by the paid day, payroll by the owner's switch and never twice, refunds to review, CEO/COO/admins mark paid"],
  ["elfia-store", "ELFIA Store 2.0: one product record (the feed serves exactly the published, non-discontinued Inventory items, stock from Inventory); the customer price is the web or list price minus a discount below it, never the TikTok rebate, and a discount not below the price is refused on both routes; price, discount, publish, bulk and Update now are the CEO, COO and super admin's by direct request; 'Connected' and 'Read by the store' rest on a recorded read made with the key; a failed Update now is never recorded as applied; photos are never deleted and Restore only points at this product's own keys (whole worker against SQLite, mutations caught)"],
  ["matrix-edit", "the editable matrix: only the verified owner and the super admin edit what roles may do - with a reason and their authenticator code; a saved cell IS the permission the server enforces from the next request, for every role; /auth/me hands each person their capabilities; only staff roles and real permissions can be named; rules that are not cells (never confirm your own sale) still hold; every cell audited before and after; one cell or all reset to the defaults; an unreadable record means the defaults (whole worker against SQLite, mutations caught)"],
  ["owner-access", "the company owner: one verified CEO account named by a super admin (reason, authenticator code, audited) holds the owner grants - executive and customer roles, executive and Admin accounts, technical Admin access - each with the owner's authenticator code and a reason; the CEO role and super admin accounts stay the super admin's; nobody changes their own role; CEO and COO confirm Paid, the CCO cannot confirm or release payroll; the owner cannot be locked out of a tab; a second CEO-role account gains nothing; the matrix equals direct requests; clearing the owner restores today's rights (whole worker against SQLite, mutations caught)"],
  ["account-identity", "account identity: only the verified owner and the super admin manage a staff account's sign-in (CEO and super admin accounts stay the super admin's, never your own); a login email changes only once the new address is proven - email link, Google sign-in as that address, or in person with the person's own code - on the same account, every session signed out, the old address told, audited; an Admin or payroll account changed in person needs the other approver; Google identity is its sub, a different Google account on the same email is refused; link tokens hashed, single use, 24 hours; 2FA reset needs an identity check and is never silent; set-password links replace typed passwords; a problem report is a Task without a password; offboarding hands open tasks over (whole worker against SQLite, mutations caught)"],
  ["owner-coverage", "every capability or named role list the super admin holds without the CEO is classified on purpose - an owner grant or technical only with its reason (or an approval-chain stage) - no rank check against the super admin survives, and every owner grant is a row in the published policy (mutations caught)"],
  ["access-policy", "one access policy: what each role may do is published from the very constants the routes check, and every money action (mark paid, Confirm Paid, release payslips, payroll bank run, commission switch, geofence) is allowed by direct request exactly when the policy says so; the Admin account no longer marks paid, releases or records the bank run; per-user exceptions need a reason, never draw a tab the server refuses, end on their date and are audited; old ones are reported, never deleted (run against SQLite, mutations caught)"],
  ["reporting-line", "the CEO tops the organisation: no supervisor and no HOD (the server refuses a parent for the CEO from the CEO, COO or CCO; a stored one is ignored); every reporting line, supervisor and HOD is read from the Organisation chart's own tree; only display fields leave the endpoint; nothing written, no approval chain touched (run against SQLite, mutations caught)"],
  ["commission-flow", "Commission 2.1: opening payroll attaches nothing, a Save takes only that person, no future or time-released month, the bank run pays only what the payslip carries, a confirmed payment day is locked, products earn only when listed, a rule may name a library package, a leaver is settled by the CEO and never voided, the CCO reviews only (run against SQLite, mutations caught)"],
  ["commission-config", "commission is configured as approved: only the CEO and COO confirm Paid, an invoice names a real closer, package rules per version pay as written, a corrected closer takes the commission by stage and nothing paid is taken back, the audit history is for management"],
  ["master-flow", "the business flow holds - paid invoices locked, refunds in the books, retired commission routes closed, one target authority, closers on staff, leavers off the pickers, refused money actions logged, customer duplicates warned"],
  ["tiktok-token", "the TikTok Shop token is renewed before it expires (TikTok's expiry read as a moment, not seconds), a refused sync renews once and retries, and the page names the shop's sign-in, not the person's"],
  ["shift-reminder-delivery", "shift reminders are sent once (one bell, one push per device) even when the run fires twice, live only until their moment, honour the person's own switches, follow a moved shift, never post to an address that is not a push service, and signing out unbinds the device"],
  ["pwa-calendar", "PWA clearance, calendar drafts, time zones and UTF-8 exports"],
  ["production-safety", "OTP vectors, payroll ZIP/XML and PDF sharing outcomes"],
  ["workforce-flow", "Threads stays retired; claims submit once; paid advances reach payroll; OT becomes pay or replacement leave"],
  ["shift-entry-coverage", "shift launch, overnight clocking, and saved half-day coverage"],
  ["release-offline", "release failures stay failures and offline assets never receive portal HTML"],
  ["audit-0909", "the findings of the 09-09 audit stay fixed - the payslip cannot call a day paid and deduct it, a released month is protected everywhere pay is set, and the commit gate is real"],
  ["claim-mileage", "a travel line with km is priced by the worker at the company rate - a setting the CEO changes, audited - and the line remembers the rate it was paid at"],
  ["shift-reminders", "thirty minutes before a shift, thirty before its end, and at the end - per person, from the same shift list the clock accepts, once each, never on leave"],
  ["desk-tabs", "the Dashboard's events and month chart are one card with a pill row, events first; approved leave reaches the calendar through the names-and-dates door and never with its type"],
  ["kept-lines", "what was typed on several lines is shown on several lines - every multi-line box, wherever its text is drawn"],
  ["dialogs-visible", "a toast, confirm or prompt dialog is never rendered inside a hidden tab body - a dialog nobody can see is an action that silently does nothing"],
  ["asset-remove", "an asset typed by mistake can be removed - soft, audited with the whole record, the tag freed, hidden from the register, the search and the watcher - and a real asset is still marked lost or disposed, never removed"],
  ["qt-once", "a quotation becomes an invoice once and then reads as a sale; a desk item lands on the card where it is decided; approving overtime asks first and says so after"],
  ["login-ux", "the one screen everybody meets: a branded half beside the form on a desk and a centred svh column on a phone, a real form with named 16px fields, a button that is never born dead, errors that announce themselves, EN/BM at the door, and a code screen that autofills and signs in on the sixth digit"],
  ["role-assign", "the role on the staff record: the CEO and COO hand out the five working roles, never their own, never an executive's; the executive, customer and admin tiers stay with the super admin; every change audited with a reason"],
  ["roster-week", "the week, whole: public holidays from the one company calendar are named and tinted on every view of the roster but never lock a day; sales duty is the third thing a week is made of - its own table and routes, for the roles the register measures, a plan never a claim (the day's evidence is counted from the register), with the task rules (management, whole runs, 62 days, approved leave, audit)"],
  ["paper-one-page", "every A4 print window is laid out on the paper (794px viewport, 210mm body, print min-height from the printable page), so a phone prints the same one page as a desk; on a phone the PDF button opens the real one-page file"],
  ["hankeis", "Hankei's ordering and MANUAL payment verification, run against a real SQLite database: a receipt or an OCR result never verifies a payment, only finance can approve, one bank transaction cannot pay for two orders, concurrent approvals produce one verification, retries produce one order, stock cannot be oversold, unverified orders cannot ship, a notification failure changes nothing"],
  ["registry-parity", "tabs, migrations, crons and version gates agree everywhere"],
  ["portal-routes", "one registry, one slug per module, and no URL outranks a permission - the entry resolver is not the Dashboard"],
  ["sql-schema-check", "migrations and the code agree about the schema"],
  ["worker-compile-gate", "the API code actually compiles (the 19-08 outage)"],
  ["upload-stream", "an upload actually reaches R2: putGuarded runs inside the real Workers runtime and a file is stored byte for byte, a lie about its type or size is refused, and nothing half-written is left behind (every upload failed from v1.177.2 to v1.181.3)"],
  ["profile-fields", "every field the Profile card reads is one GET /staff/profile actually selects - the card has asked for photo_key since v1.4.141 and the SELECT never named it"],
  ["viewport-settle", "after the phone keyboard closes the layout viewport is put back under the visual one, so the bottom bar and topbar return to the screen edges - never while a field is focused, never under a pinch zoom"],
  ["pay-records", "a salary advance names its request on the payslip and is recovered from the request month or later, an unpaid day is edited only by the CEO and only if the company recorded it, and the attendance donut's names follow the donut's own rules"],
  ["claim-categories", "the claim form, the API and the claims table allow the same categories - a category the table refuses is a claim silently never saved (stationery, 29-09-2026)"],
  ["quotation-revisions", "a quotation revised at the customer's request keeps its number, prints REV n dated the day it was revised, and keeps every version it replaced (20-10-2026)"],
  ["business-joins", "the ERP roadmap only adds: no phase writes to a table that carries today's money, pay or people, part payments never mark an invoice paid, and each join keeps its source screen's authority (20-10-2026)"],
];

/* worker-compile-gate needs the API's type definitions. Installing them here
   keeps the Cloudflare build command down to one line, and doing it out loud
   means the log shows why the build paused for ten seconds. */
if (!existsSync(join(root, "worker", "node_modules"))) {
  console.log("· installing the API's type definitions so its compile gate can run");
  const install = spawnSync(
    process.platform === "win32" ? "npm.cmd" : "npm",
    ["install", "--no-audit", "--no-fund"],
    { cwd: join(root, "worker"), stdio: "inherit" },
  );
  if (install.status !== 0) {
    console.error("\n[X] Could not install the API's dependencies, so its compile gate");
    console.error("    cannot run. Refusing to continue: shipping the API without that");
    console.error("    check is exactly what caused the 19-08 login outage.");
    process.exit(1);
  }
}

console.log(`\nRunning ${GUARDS.length} guards before anything is published.\n`);
/* v1.290.1 (the owner, 12-11-2026: "yes") - PUSH.bat sets NOMUT=1: every
   guard still runs every one of its rule checks, but the MUTATION pass (about
   550 deliberate breakages, each a full copy and rebuild of the engine) is
   skipped on the owner's PC. That pass is run before every delivery in the
   build sandbox and recorded in the release's GATE note. FULLGUARDS=1 before
   PUSH.bat runs it here too. */
if (process.env.NOMUT === "1") console.log("(mutation pass skipped - NOMUT=1; it ran before delivery and is in the GATE note. FULLGUARDS=1 runs it here.)\n");

/* One number per guard, used by the call and by the message that reports
   it - a hard-coded "120s" in the text is how a message starts lying about
   the thing it describes. The budget catches a guard that HANGS; it is not a
   speed target.
   v1.245.1 - the go-live runtime guards rebuild the WHOLE worker with esbuild
   once per mutation (9 to 12 rebuilds each) and run it against SQLite. On the
   owner's Windows PC each rebuild takes ~13s and on 31-10-2026 go-live-b was
   killed at 120s during its 9th mutation, after 8 caught - a timeout, not a
   failure. And the guards now run SIDE BY SIDE (below), so each one shares
   the machine and takes longer than it would alone. Budgets: 5 minutes, and
   15 for the go-live guards. Nothing any guard checks changed; a guard that
   hangs is still killed and still stops the release. */
const GUARD_TIMEOUT_MS = 300_000;
const SLOW_GUARD_TIMEOUT_MS = 900_000;
const SLOW_GUARDS = new Set(["go-live-a", "go-live-b", "go-live-c", "go-live-d", "go-live-p", "go-live-t", "go-live-m", "go-live-s", "go-live-g", "go-live-h", "go-live-i", "go-live-l", "go-live-k", "go-live-n", "go-live-o", "go-live-v", "go-live-w", "go-live-x", "go-live-y", "go-live-z", "self-approval", "payment-verify", "deposit-billing", "fa-api", "fa-registry", "fa-dsr", "task-title", "fa-banker-pic"]);

/* v1.245.1 - SIDE BY SIDE. The guards are independent processes: each reads
   the source, bundles into its own mkdtemp() folder and runs against its own
   in-memory SQLite - none writes into the checkout or shares a temp file. Run
   one after another they took ~4 minutes in the sandbox and over 10 on the
   owner's PC; run JOBS at a time (default: the PC's cores less one, at most
   6) the same guards give the same verdicts in a fraction of that. The
   longest start first. The report is still printed in the list's order, one
   line per guard, exactly as before. GUARD_JOBS=1 runs them one at a time. */
const JOBS = Math.max(1, Math.floor(Number(process.env.GUARD_JOBS)) || Math.min(6, Math.max(1, cpus().length - 1)));
console.log(`(${JOBS} at a time)\n`);

const runGuard = (name, file, limit) => new Promise((done) => {
  const started = Date.now();
  const child = spawn(process.execPath, [file], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "", stderr = "", killed = false;
  child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
  child.stdout.on("data", (d) => { stdout += d; });
  child.stderr.on("data", (d) => { stderr += d; });
  /* v1.148.1 - a guard could in principle keep the event loop alive and
     never return, hanging the deploy with no output at all. The budget turns
     that into a named failure instead of a frozen window. */
  const timer = setTimeout(() => { killed = true; child.kill(); }, limit);
  const finish = (status, signal) => { clearTimeout(timer); done({ status: killed ? null : status, signal: killed ? (signal ?? "SIGTERM") : signal, stdout, stderr, secs: Math.round((Date.now() - started) / 1000) }); };
  child.on("error", (e) => { stderr += String(e?.stack ?? e); finish(1, null); });
  child.on("close", finish);
});

const failed = [];
const results = new Map();
let printed = 0;
const flush = () => {
  while (printed < GUARDS.length && results.has(GUARDS[printed][0])) {
    const [name, what] = GUARDS[printed++];
    const r = results.get(name);
    process.stdout.write(`  ${name.padEnd(24)} `);
    if (r.missing) {
      /* A guard file that has gone missing is the worst case: the suite still
         reports a tidy row of passes, one of them for a check that no longer
         exists. Treat it as a failure, loudly. */
      console.log("MISSING");
      failed.push(`${name} — the guard file is not in this checkout`);
      continue;
    }
    if (r.status === 0) {
      /* the slow ones say how long they took, so a budget running thin shows before it runs out */
      console.log(SLOW_GUARDS.has(name) ? `ok (${r.secs}s of ${r.limit / 1000}s)` : "ok");
      continue;
    }
    console.log("FAILED");
    /* no status and a signal is a kill on the budget; say so, because
       "FAILED" with no output reads like a broken guard. */
    const timedOut = r.status === null && r.signal !== null;
    failed.push(timedOut
      ? `${name} — did not finish within ${r.limit / 1000}s (it was killed, not failed)`
      : `${name} — ${what}`);
    const out = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim();
    if (out) console.log(out.split("\n").map((l) => `      ${l}`).join("\n"));
    if (timedOut) console.log("      (no verdict - the guard never returned)");
  }
};
const queue = [...GUARDS].sort((a, b) => Number(SLOW_GUARDS.has(b[0])) - Number(SLOW_GUARDS.has(a[0])));
await Promise.all(Array.from({ length: JOBS }, async () => {
  for (let g = queue.shift(); g; g = queue.shift()) {
    const name = g[0];
    const file = join(root, "tests", `${name}.mjs`);
    const limit = SLOW_GUARDS.has(name) ? SLOW_GUARD_TIMEOUT_MS : GUARD_TIMEOUT_MS;
    results.set(name, existsSync(file) ? { ...(await runGuard(name, file, limit)), limit } : { missing: true });
    flush();
  }
}));
flush();

if (failed.length) {
  console.error("\n============================================");
  console.error(` [X] ${failed.length} guard(s) failed — NOTHING will be published.`);
  console.error("============================================");
  for (const f of failed) console.error(`  · ${f}`);
  console.error("\nThe live system is untouched. Fix the above and push again.\n");
  process.exit(1);
}

console.log(`\n[OK] all ${GUARDS.length} guards passed.`);
console.log("Not covered here (they need a real browser — run before a release):");
console.log("  bm-coverage · leaderboard-sales-floor · location-scenarios · no-false-attendance");
console.log("  plus scratch/: footer-e2e · nav-fit-e2e · a2z-bm-e2e · portfolio-click-e2e · sales-desc-typing-e2e");
/* v1.175.0 - the two probes that caught what source-reading cannot: a grid
   track that grew to its widest item, and a column narrower than its own
   longest word (nothing overflows, so every width sweep is honestly clean).
   They live in the repository now - tests/browser/ - with the fixtures they
   need. See tests/browser/README.md. */
console.log("  plus tests/browser/ (a rendered page, not source):");
console.log("    pnpm build && node tests/browser/serve.mjs out 4177 &");
console.log("    WIDTH=402 xvfb-run -a python3 tests/browser/webkit-overflow.py   # past the page box");
console.log("    xvfb-run -a python3 tests/browser/table-shred.py                 # a shredded column");
  console.log("    xvfb-run -a python3 tests/browser/ui-audit.py                    # repeated headings, shredded labels, scroll traps, clipped labels, caged dialogs");
  console.log("    xvfb-run -a python3 tests/browser/a11y-audit.py                  # a control with no name, a keyboard with nowhere to stand");
console.log("    ROLE=ceo|sales_marketing|live_host on the server walks each dashboard order\n");
