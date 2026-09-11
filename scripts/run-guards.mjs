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
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/* Order matters only for readability — each of these is independent. */
const GUARDS = [
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
  ["outbox", "only the named routes queue offline, every queued write carries an idempotency key, and the phone's time is recorded as pending"],
  ["one-desk", "the desk shows each person exactly what they may act on, by the rules the routes enforce"],
  ["search-everything", "one query over eight sources, each gated by its own tab's permission, phone numbers matched by digits"],
  ["watchers", "findings are pushed once, cleared when fixed, the brief is personal, and no watcher looks at hotels"],
  ["hourly-by-the-clock", "a part-time live host is paid what the clock says less one hour of break past five"],
  ["hotel-pipeline", "the hotel list is a review-outreach pipeline: stages move by what happened, due means a lapse, a call is kept without signal, no money and no watcher in it"],
  ["enquiries", "an enquiry is work: overdue after a day, one person's, announced once to those who can answer"],
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
  ["event-attendees", "an event can name who has to be there - only they are told, an empty list still means everyone, and the whole floor still sees the event"],
  ["map-extrusion", "a raised state is still Malaysia - every wall belongs to its own state, nothing raised leaves the frame, and a state with no figure draws no wall"],
  ["movement-cost", "money on a stock movement says per unit AND line total, a correction is valued at cost, and an item with no cost is named rather than treated as free"],
  ["movement-purpose", "the REASON a movement happened decides whether it is a sale - a marketing loan is neither revenue nor a loss, and a return is not a revert"],
  ["audit-0909", "the findings of the 09-09 audit stay fixed - the payslip cannot call a day paid and deduct it, a released month is protected everywhere pay is set, and the commit gate is real"],
  ["criscikee", "the crispy chicken skin - one vocabulary in three places, the age band derived by the worker and never accepted, sentiment with its reasons, nothing added up in the browser, and no verdict below the sample floor"],
  ["claim-mileage", "a travel line with km is priced by the worker at the company rate - a setting the CEO changes, audited - and the line remembers the rate it was paid at"],
  ["shift-reminders", "thirty minutes before a shift, thirty before its end, and at the end - per person, from the same shift list the clock accepts, once each, never on leave"],
  ["desk-tabs", "the Dashboard's events and month chart are one card with a pill row, events first; approved leave reaches the calendar through the names-and-dates door and never with its type"],
  ["kept-lines", "what was typed on several lines is shown on several lines - every multi-line box, wherever its text is drawn"],
  ["dialogs-visible", "a toast, confirm or prompt dialog is never rendered inside a hidden tab body - a dialog nobody can see is an action that silently does nothing"],
  ["asset-remove", "an asset typed by mistake can be removed - soft, audited with the whole record, the tag freed, hidden from the register, the search and the watcher - and a real asset is still marked lost or disposed, never removed"],
  ["qt-once", "a quotation becomes an invoice once and then reads as a sale; a desk item lands on the card where it is decided; approving overtime asks first and says so after"],
  ["registry-parity", "tabs, migrations, crons and version gates agree everywhere"],
  ["sql-schema-check", "migrations and the code agree about the schema"],
  ["worker-compile-gate", "the API code actually compiles (the 19-08 outage)"],
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

/* One number, used by the call and by the message that reports it - a
   hard-coded "120s" in the text is how a message starts lying about the
   thing it describes. worker-compile-gate is the slow one (it type-checks
   the whole API); everything else finishes in well under a second. */
const GUARD_TIMEOUT_MS = 120_000;

const failed = [];
for (const [name, what] of GUARDS) {
  const file = join(root, "tests", `${name}.mjs`);
  process.stdout.write(`  ${name.padEnd(24)} `);

  if (!existsSync(file)) {
    /* A guard file that has gone missing is the worst case: the suite still
       reports a tidy row of passes, one of them for a check that no longer
       exists. Treat it as a failure, loudly. */
    console.log("MISSING");
    failed.push(`${name} — the guard file is not in this checkout`);
    continue;
  }

  /* v1.148.1 - a guard gets 120 seconds. Eighteen of them `await import()` a
     .ts module, which used to end in process.exit() and abort Node on
     Windows during loader teardown; they set exitCode now and let Node drain
     on its own. That is the right fix, and it introduces one new way to fail
     that did not exist before: a guard could in principle keep the event loop
     alive and never return, hanging the deploy with no output at all. A
     timeout turns that into a named failure instead of a frozen window. Every
     guard runs in well under a second today. */
  const run = spawnSync(process.execPath, [file], { cwd: root, encoding: "utf8", timeout: GUARD_TIMEOUT_MS });
  if (run.status === 0) {
    console.log("ok");
  } else {
    console.log("FAILED");
    /* signal SIGTERM with no status is what spawnSync reports on a timeout;
       say so, because "FAILED" with no output reads like a broken guard. */
    const timedOut = run.status === null && run.signal !== null;
    failed.push(timedOut
      ? `${name} — did not finish within ${GUARD_TIMEOUT_MS / 1000}s (it was killed, not failed)`
      : `${name} — ${what}`);
    const out = `${run.stdout ?? ""}${run.stderr ?? ""}`.trim();
    if (out) console.log(out.split("\n").map((l) => `      ${l}`).join("\n"));
    if (timedOut) console.log("      (no verdict - the guard never returned)");
  }
}

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
console.log("  plus scratch/: footer-e2e · nav-fit-e2e · a2z-bm-e2e · portfolio-click-e2e · sales-desc-typing-e2e\n");
