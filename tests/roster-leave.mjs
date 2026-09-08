#!/usr/bin/env node
/* Guard #58 — v1.131.0: an approved leave day cannot be booked.
 *
 * CEO, 06-09-2026, looking at a week with two "On leave" cells in it:
 * *"should if there is a leave that taken by the staff, then the date that I
 * want to select should not be available to her/him if the date is leave date
 * apply"*
 *
 * THE DEFECT THIS CLOSES. Since v1.8.0 the roster has COMPUTED a
 * `host_on_leave` conflict and painted the chip amber. That is a report, and
 * it arrives after the same request has already told the host "live session
 * assigned". Nothing refused the booking. The only thing standing between a
 * client and an empty studio was somebody noticing one amber chip on a grid
 * of fifty-six cells.
 *
 * WHAT THIS GUARD ASSERTS, and why it is shaped this way.
 *
 * A static test cannot run the worker, so it cannot observe "the booking was
 * refused". What it CAN hold is the property that makes the refusal
 * inevitable: on every path that writes a day for a person, the shared check
 * stands between the request and the write, and it is asked about THAT
 * path's own person and THAT path's own dates.
 *
 * That last clause is the whole test. The interesting bugs here are not a
 * missing check; they are a check asked the wrong question — the signed-in
 * manager's leave instead of the host's, today's date instead of the
 * session's, the block's old owner instead of the one it is moving to. Each
 * of those passes a "does the file mention refuseIfOnLeave" test and books
 * the wrong person anyway. So sections 1 and 2 read the ARGUMENTS.
 *
 * Section 4 is the mirror image and matters just as much: the presses that
 * must NOT be refused. A session that already clashes has to stay
 * cancellable, because cancelling it is the press that FIXES the clash — a
 * rule that locks the door on the way out is worse than no rule.
 *
 * Run: node --experimental-strip-types tests/roster-leave.mjs
 *
 * Negative-tested by: dropping the check from POST /live-sessions; asking it
 * about user.id instead of the host; passing todayS instead of the session
 * date; letting pending leave count; moving the /tasks check below the INSERT;
 * making the grid cell a drop target on a leave day; letting the planner keep
 * leave entries.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { fileURLToPath } from "node:url";

/* v1.139.1 - fileURLToPath, NOT .pathname.
   On Windows `new URL("..", import.meta.url).pathname` is "/C:/Users/..." -
   a URL path with a leading slash, not a file path - so join() produced
   "\\C:\\Users\\..." and every read failed with "C:\\C:\\Users\\...". These
   guards had only ever run in Cloudflare's Linux build container, where the
   two happen to be the same string; the day PUSH.bat started running them on
   the CEO's own PC, 49 of them failed at once on a bug that was never about
   the code they check. */
const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(root, p), "utf8");
let failed = 0, passed = 0;
const ok = (label, cond, why = "") => { if (cond) passed++; else { failed++; console.log(`  ✗ ${label}${why ? ` — ${why}` : ""}`); } };

const staff = read("worker/src/staff.ts");
const board = read("components/portal/roster-board.tsx");

/** The source between a marker and the next N characters — enough to hold one
    route handler without reaching into its neighbour. Used so "the check is
    present" means "present in THIS door", not somewhere in a 12k-line file. */
const region = (from, len = 2600) => {
  const i = staff.indexOf(from);
  return i < 0 ? "" : staff.slice(i, i + len);
};

/* ---- 1. the rule itself ---------------------------------------------- */
ok("there is one shared check, not one per door",
   /async function refuseIfOnLeave\(/.test(staff) && /async function leaveClashDates\(/.test(staff),
   "five copies of a date rule is five chances for one of them to drift");
ok("only APPROVED leave closes a day",
   /WHERE user_id = \?1 AND status = 'approved'/.test(staff),
   "blocking on a pending application would let anybody freeze their own roster by filing a form");
ok("a day inside the span counts, both ends included",
   /start_date <= d && d <= l\.end_date/.test(staff),
   "a leave row is a range; the grid already paints every day of it");
ok("the refusal names the person and the days",
   /is on approved leave on \$\{when\}/.test(staff) && /clash\.slice\(0, 4\)\.map\(dmyMsg\)/.test(staff),
   "\"they are on leave\" sends somebody back to the calendar to work out which day");
ok("a query that cannot run does not become a rule that cannot be passed",
   /\} catch \{[\s\S]{0,140}return \[\];/.test(staff));

/* ---- 2. every door that CHOOSES A DAY, asked the right question ------- */
/* Door 1 — creating a live session. */
{
  const door = region(`if (path === "/live-sessions" && method === "POST")`);
  ok("POST /live-sessions checks before it inserts",
     door.includes("refuseIfOnLeave")
     && door.indexOf("refuseIfOnLeave") < door.indexOf("INSERT INTO live_sessions"));
  ok("...about the HOST, on the SESSION's date",
     /refuseIfOnLeave\(env, user, host, \[d\]/.test(door),
     "asking about user.id books the host onto their leave and refuses the manager instead");
}
/* Door 2 — moving one, or handing it to somebody else. */
{
  const door = region(`if (mLS && method === "PATCH")`, 4200);
  ok("PATCH /live-sessions/:id checks before it updates",
     door.includes("refuseIfOnLeave")
     && door.indexOf("refuseIfOnLeave") < door.indexOf("UPDATE live_sessions SET"));
  ok("...against the row AS IT WILL BE, not as it is",
     /nextDate = typeof body\?\.session_date/.test(door)
     && /nextHost = Number\(body\?\.host_user_id\) \|\| before\?\.host_user_id/.test(door),
     "either half can move alone: a new day for this host, or this day for a new host");
}
/* Door 3 — a task block, or a run of them. */
{
  const door = region(`if (path === "/task-blocks" && method === "POST")`, 3600);
  ok("POST /task-blocks checks before it inserts",
     door.includes("refuseIfOnLeave")
     && door.indexOf("refuseIfOnLeave") < door.indexOf("INSERT INTO task_blocks"));
  ok("...about the person the work lands on, over the WHOLE run",
     /refuseIfOnLeave\(env, user, who, dates,/.test(door),
     "checking only the first day lets a five-day duty run straight through a holiday");
}
/* Door 4 — dragging a block to another day or another row. */
{
  const door = region(`const mTB = path.match(/^\\/task-blocks\\/(\\d+)$/)`, 7000);
  /* Anchored on the RESCHEDULE update specifically — the done-tick update
     sits earlier in the same handler and is deliberately not gated. */
  ok("PATCH /task-blocks/:id checks before it updates",
     door.includes("refuseIfOnLeave")
     && door.indexOf("refuseIfOnLeave") < door.indexOf("SET ${setsB.join"));
  ok("...about where it is GOING, both the day and the person",
     /nextDay = \/\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$\/\.test\(bd\) \? bd : blk\.block_date/.test(door)
     && /refuseIfOnLeave\(env, user, bu \|\| blk\.user_id, \[nextDay\]/.test(door),
     "moving Thursday's block onto somebody whose Thursday is spoken for is the same defect");
}
/* Door 5 — the roster's "assign a task with a slot", which is POST /tasks. */
{
  const door = region(`if (path === "/tasks" && method === "POST")`, 3000);
  ok("POST /tasks checks the block it carries",
     /refuseIfOnLeave\(env, user, assignedTo, bDates,/.test(door));
  ok("...BEFORE the task row is written",
     door.indexOf("refuseIfOnLeave") > 0
     && door.indexOf("refuseIfOnLeave") < door.indexOf("INSERT INTO tasks"),
     "refusing after the insert leaves a task with no days on it, which reads as success");
}

/* ---- 3. the override — the way out, and its receipts ----------------- */
/* An approved leave row is TERMINAL: `cancel` refuses once the stage is
   approved and so does `reject`. Without a way past the rule, a day would be
   unbookable for ever when somebody does come in. */
ok("the override exists and is role-gated",
   /LEAVE_OVERRIDE_ROLES = \["ceo", "coo", "cco", "super_admin", "admin"\]/.test(staff)
   && /if \(!LEAVE_OVERRIDE_ROLES\.includes\(user\.role\)\)/.test(staff));
ok("it is off unless the caller asks for it, explicitly",
   (staff.match(/body\?\.leave_override === true/g) ?? []).length >= 5,
   "a default-on override is not an override, it is the rule removed");
ok("every override is written to the audit trail",
   /audit\(env, user\.id, "roster\.leave_override"/.test(staff),
   "\"who booked somebody onto their own leave day\" gets asked after the fact");
ok("the portal only sends it when the box is ticked",
   /\.\.\.\(leaveOverride \? \{ leave_override: true \} : \{\}\)/.test(board));
ok("the box is cleared every time the dialog opens",
   /setLeaveOverride\(false\)/.test(board),
   "an override that stayed on would turn the rule off for the rest of the afternoon");
ok("only the roles that may already amend a session are offered it",
   /\{canEdit && \([\s\S]{0,400}checked=\{leaveOverride\}/.test(board));

/* ---- 4. the presses that must NOT be refused ------------------------- */
/* The mirror image, and the half that keeps the rule usable. */
{
  const door = region(`if (mLS && method === "PATCH")`, 4200);
  ok("a status-only change is never checked",
     /if \(body\?\.session_date !== undefined \|\| body\?\.host_user_id !== undefined\) \{/.test(door),
     "a session that already clashes must stay cancellable — that press IS the fix");
}
{
  const door = region(`const mTB = path.match(/^\\/task-blocks\\/(\\d+)$/)`, 7000);
  ok("a time-only edit and the done tick are never checked",
     /if \(setsB\.some\(\(x\) => \/\^\(block_date\|user_id\) =\/\.test\(x\)\)\) \{/.test(door),
     "refusing those would make a badly-timed block on a leave day uncorrectable");
}
ok("approving leave over existing work is still allowed, and still reported",
   /kind: "host_on_leave"/.test(staff) && !/refuseIfOnLeave[\s\S]{0,200}leave\/\d/.test(staff),
   "that is an HR decision; the answer is to move the session, not to refuse the leave");

/* ---- 5. the board says so BEFORE the press --------------------------- */
/* The server is the rule. This is the part that stops somebody filling in a
   form the save is going to refuse. */
ok("one definition of \"away\", shared by the grid, the dialogs and the drag",
   /const onLeaveAt = useCallback\(/.test(board)
   && !/const onLeave = \(uid: number, d: string\)/.test(board),
   "the grid used to carry its own copy that could only see the visible week");
ok("the dialogs fetch the span they are about to write into",
   /\/leave\/calendar\?from=\$\{spanFrom\}&to=\$\{spanTo\}/.test(board),
   "/roster carries the visible week; a repeat run reaches 62 days past it");
ok("a leave cell stops being a drop target for an armed task",
   /const canDrop = armed != null && !placing && !leave/.test(board));
ok("dragging a session onto a leave day is refused at the drop",
   /if \(onLeaveAt\(sess\.host_user_id, d\)\)/.test(board),
   "a confirm bar that appears only to say no is a bar that wasted the gesture");
ok("the planner drops leave entries PER HOST",
   /everything\.filter\(\(e\) => !onLeaveAt\(e\.host_user_id, e\.session_date\)\)/.test(board),
   "dropping the whole date would cancel a colleague's session over somebody else's holiday");
ok("a run with nothing left refuses instead of creating nothing",
   /if \(all\.length === 0\) \{/.test(board) && /Not available/.test(board));
ok("the button promises what the press will actually create",
   /const usableCount = \(\): number =>/.test(board)
   && /Schedule \$\{usableCount\(\)\} sessions/.test(board),
   "a button that says 10 and creates 8 is a button that lied");
ok("the run preview says how many days it gave back",
   /skipped for approved leave/.test(board));
ok("the clash is named — who, and which day — not just flagged",
   /On approved leave — not available/.test(board) && /Bercuti diluluskan — tidak tersedia/.test(board));
ok("the task dialog applies the same rule to its own run",
   /tDates\(\)\.filter\(\(d\) => !onLeaveAt\(tDraft\.assigned_to, d\)\)/.test(board));

/* ---- 6. PDPA: the picker learns THAT a day is closed, never why ------ */
/* The same stance /roster already takes. Half of "why" is medical data. */
{
  const door = region(`if (path === "/leave/calendar" && method === "GET")`, 2200);
  ok("/leave/calendar exists and is date-bounded", door.length > 0 && /from and to must be YYYY-MM-DD/.test(door));
  ok("it returns names and dates only — no type, no reason",
     !/\bl\.type\b/.test(door) && !/\bl\.reason\b/.test(door),
     "the roster needs to know a day is closed, not why somebody is away");
  ok("a non-manager sees only their own days",
     /WHERE l\.user_id = \?3 AND l\.status = 'approved'/.test(door));
  ok("approved only, here too", (door.match(/status = 'approved'/g) ?? []).length >= 2);
}

/* v1.139.0 - the override is a decision, and a decision does not carry from
   one dialog into the next. Ticking "Book anyway", cancelling, then opening
   an existing session via Edit sent leave_override: true without anybody
   choosing it again. */
ok("the leave override is reset by BOTH dialogs, not only the assign one",
   (board.match(/setLeaveOverride\(false\);/g) ?? []).length >= 2,
   "a cancelled override survived into Edit and moved a session onto a leave day silently");

console.log(`${failed ? "✗" : "✓"} roster-leave: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
