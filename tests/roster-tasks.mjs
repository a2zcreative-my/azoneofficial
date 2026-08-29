/**
 * Roster / task-block guard (v1.66.0) — guard #17.
 *
 * Track R put task blocks on the same board as live sessions. The whole
 * design rests on one thing staying true:
 *
 *   THE SALES LEADERBOARD MUST NEVER SEE A TASK BLOCK.
 *
 * `attributedSalesByUser` credits TikTok GMV to whoever was in a live
 * session at that moment. The day a task block reaches that function, a
 * person doing paperwork starts earning commission on the shop's sales. The
 * money goes wrong quietly and the first symptom is an argument about a
 * payslip — which is exactly the kind of bug that survives for months,
 * because nothing crashes and no page looks broken.
 *
 * That is why tasks got their own table instead of a `kind` column on
 * `live_sessions`. This guard is the tripwire on that decision, for the next
 * person who looks at two similar tables and thinks about merging them.
 *
 * It also holds the rules that make the board safe to use:
 * permissions, the conflict kinds, and the pre-migration armour.
 *
 *   node tests/roster-tasks.mjs
 */
import { readFileSync } from "node:fs";
import path from "node:path";

const root = new URL("..", import.meta.url).pathname;
const read = (p) => readFileSync(path.join(root, p), "utf8");
const staff = read("worker/src/staff.ts");

let pass = 0;
const fails = [];
const ok = (label, cond, extra = "") => {
  if (cond) pass++;
  else fails.push(`${label}${extra ? ` — ${extra}` : ""}`);
};

/* ---- 1. THE ONE THAT MATTERS: attribution never sees a task ---- */
const attrStart = staff.indexOf("async function attributedSalesByUser");
ok("attributedSalesByUser exists", attrStart > 0);
if (attrStart > 0) {
  /* Read to the end of the function by brace balance rather than by a line
     count, so the check cannot be defeated by the function simply growing. */
  let depth = 0, i = staff.indexOf("{", attrStart), end = i;
  for (; i < staff.length; i++) {
    if (staff[i] === "{") depth++;
    else if (staff[i] === "}") { depth--; if (depth === 0) { end = i; break; } }
  }
  const body = staff.slice(attrStart, end);
  ok("sales attribution never reads task_blocks", !/task_blocks/.test(body),
     "a task block reaching this function pays commission for doing paperwork");
  ok("sales attribution never reads tasks at all", !/\bFROM tasks\b/.test(body),
     "attribution is about sales, and a task is not a sale");
}

/* Also: the live-session query that feeds shift attribution must stay
   task-free wherever it lives. */
const shiftSales = read("worker/src/shift-sales.ts");
ok("shift-sales split never mentions task blocks", !/task_blocks/.test(shiftSales),
   "the live-session shift split must see live sessions and nothing else");

/* ---- 2. the roster returns them BESIDE, never merged ---- */
ok("GET /roster returns task_blocks separately", /task_blocks: taskBlocks/.test(staff),
   "merging them into sessions[] is the mistake this whole design avoids");
ok("GET /roster returns the unscheduled rail", /unscheduled,/.test(staff));
ok("task blocks are read from their own table",
   /FROM task_blocks b JOIN tasks t/.test(staff));

/* ---- 3. permissions (OD-25) ---- */
ok("a non-manager may only schedule their own task, on their own row",
   /You can only schedule your own tasks, on your own row/.test(staff),
   "without this, anyone could put work on anyone's day");
ok("moving work onto another person is management-only",
   /Only management can move work onto another person/.test(staff));
ok("the block routes verify the target is active staff",
   (staff.match(/That must be an active staff member/g) ?? []).length >= 2,
   "both create and reassign must check, or one path lets work land on a leaver");

/* ---- 4. the conflict kinds Track R made possible ---- */
for (const kind of ["task_over_live", "task_on_leave", "task_after_deadline", "task_overlap"]) {
  ok(`conflict kind "${kind}" is raised`, staff.includes(`kind: "${kind}"`));
}
ok("a task over a live session is SOFT (OD-26)",
   /kind: "task_over_live"[\s\S]{0,200}?soft: true/.test(staff),
   "amber, not red — the live is fixed and the task is what moves");
ok("work on approved leave is NOT soft",
   !/kind: "task_on_leave"[\s\S]{0,160}?soft: true/.test(staff),
   "the person is not there; that is not a warning, it is a clash");

/* ---- 5. pre-migration armour ---- */
ok("a pre-0095 database still renders the board",
   /catch \{ \/\* pre-0095/.test(staff),
   "the roster must degrade to live-sessions-only, never 500");
ok("the write routes name the missing migration",
   (staff.match(/Run migration 0095 first/g) ?? []).length >= 2);

/* ---- 6. registry ----
   REGISTERED and PROBED, never "is the latest". Guard #16 asserted the
   latest migration and the next one broke it the following day; this guard
   was written the same afternoon and repeated the mistake within the hour.
   A guard that fails on somebody else's unrelated work is a guard people
   learn to skip, and a skipped guard protects nothing. */
const index = read("worker/src/index.ts");
ok("0095 is in EXPECTED_MIGRATIONS", /"0095_task_blocks",/.test(index));
ok("0095 has a health probe", /0095 \(task blocks on the roster\)/.test(index));
ok("0096 is in EXPECTED_MIGRATIONS", /"0096_task_block_done",/.test(index));
ok("0096 has a health probe", /0096 \(a block records its day\)/.test(index));

/* ---- 7. the board draws two kinds of block, and counts both ---- */
const board = read("components/portal/roster-board.tsx");
ok("the board renders task blocks", /cellTasks\(u\.id, d\)/.test(board));
/* Checking that `durOfB` merely EXISTS is not a check: the first draft of
   this guard passed while the totals ignored it entirely. What matters is
   that block hours are actually added into a total, in three places. */
const sums = (board.match(/blocks\.reduce\(\(a, b\) => a \+ durOfB\(b\), 0\)/g) ?? []).length;
ok("task hours are summed into the week total", sums >= 1,
   "committed hours that ignore tasks cannot answer 'is this person overloaded'");
ok("task hours are summed into the day and per-person totals",
   /dayB\.reduce\(\(a, b\) => a \+ durOfB\(b\), 0\)/.test(board)
   && /mineB\.reduce\(\(a, b\) => a \+ durOfB\(b\), 0\)/.test(board),
   "a column or a row that counts only live sessions understates the week");
ok("the mobile agenda shows tasks too", /dayB\.map/.test(board),
   "a phone showing half the day's work is worse than showing none of it");
/* ---- 8. v1.67.0: runs of days, and the daily tick ---- */
ok("a run of dates can be posted in one request", /body\?\.dates/.test(staff),
   "five saves for a five-day duty is five chances to get one wrong");
ok("a repeat rule is capped", /more than 62 days/.test(staff),
   "a rule expanding to a year is a mistake made quickly, not a feature");
ok("a block can be marked done for its day",
   /UPDATE task_blocks SET done_at = \?1/.test(staff));
ok("marking a day done does NOT touch the status of the task",
   !/done_at = \?1[\s\S]{0,400}?UPDATE tasks SET/.test(staff),
   "a task is finished when its days are done AND its scope is ticked — a person decides that");
ok("a day already done is not counted as a conflict",
   /status !== "completed" && !b\.done_at/.test(staff),
   "flagging a finished Monday on Friday is noise, and noise gets conflict lists ignored");
ok("the board offers the daily tick", /setBlockDone\(b, !b\.done_at\)/.test(board));
ok("a done block reads as done", /b\.done_at \? "border-success bg-success-soft opacity-70"/.test(board));
ok("the repeat preview shows the DATES, not the search window",
   /ds\.slice\(0, 4\)\.map\(\(x\) => dmy\(x\)\)/.test(board),
   "printing the until-date for a rule that stops earlier is the v1.22.6 bug");

/* ---- 9. v1.68.1: the bell actually rings ---- */
ok("scheduling notifies even when you scheduled it for yourself",
   /assignedTo !== user\.id \|\| firstBlock !== undefined/.test(staff),
   "a six-day booking you made for yourself must leave a record you can scroll back to");
const idx = read("worker/src/index.ts");
ok("today's blocks are announced in the morning",
   /kind = 'block_today'/.test(idx),
   "a roster nobody is reminded of is a diary only its author reads");
/* Assert the BEHAVIOUR, not that an identifier exists. Checking for the
   word "byUser" passed while the notify sat outside the grouping loop —
   the third time today a name-only check let a real regression through. */
ok("the morning reminder is one message per person, not per block",
   /for \(const \[uid, list\] of byUser\)[\s\S]{0,500}?notify\(env, uid/.test(idx),
   "three chips on a Wednesday is one working day; three bells is how a bell gets muted");
ok("the morning reminder runs at 09:00 MYT, not on the 30-minute pass",
   idx.indexOf("kind = 'block_today'") > idx.indexOf('event.cron === "0 1 * * *"')
   && idx.indexOf("kind = 'block_today'") < idx.indexOf("CLOCK-OUT REMINDERS"),
   "the 30-minute cron would deliver the day's work at ten past midnight");
ok("a block already done is not announced", /b\.done_at IS NULL AND t\.status/.test(idx));

/* ---- 10. v1.69.0: editing, not retyping ---- */
ok("PATCH /tasks can change the title, priority and deadline",
   /sets\.push\(`title = /.test(staff) && /sets\.push\(`priority = /.test(staff)
   && /sets\.push\(`deadline = /.test(staff),
   "status-only meant fixing a typo cost the task its scope, comments and history");
ok("an empty deadline clears it rather than erroring",
   /body\.deadline === ""[\s\S]{0,120}?vals\.push\(null\)/.test(staff),
   "a task stuck with the WRONG due date alerts every morning until the bell is muted");
ok("reassigning a task is management-only",
   /Only management can reassign a task/.test(staff));
ok("reassigning moves the scheduled days with it",
   /UPDATE task_blocks SET user_id = \?1 WHERE task_id = \?2/.test(staff),
   "blocks left behind would show two people booked for one piece of work");
ok("a time change can apply to the whole run",
   /apply_to_run === true/.test(staff),
   "six corrections for a six-day duty means the sixth gets forgotten");
ok("apply_to_run changes TIMES only, never the date",
   /\/\^\(start_time\|end_time\) =\//.test(staff),
   "pushing one date across a run would collapse every day onto it");
ok("the edit dialog sends only what changed",
   /const taskPatch: Record<string, unknown> = \{\};/.test(board)
   && /const blockPatch: Record<string, unknown> = \{\};/.test(board),
   "posting the whole form back lets a stale dialog overwrite somebody else's fix");

/* ---- 11. v1.69.1: the printed week is the whole week ---- */
const pdf = read("lib/roster-pdf.ts");
ok("the PDF builder accepts task blocks",
   /blocks: RosterPdfBlock\[\] = \[\]/.test(pdf),
   "a shared plan showing only live sessions tells the marketing team they are free");
ok("the PDF draws task chips",
   /for \(const b of mineB\.filter\(\(v\) => v\.block_date === d\)\)/.test(pdf));
ok("the PDF counts task hours in its totals",
   /work\.reduce\(\(a, b\) => a \+ durOfB\(b\), 0\)/.test(pdf)
   && /mineB\.reduce\(\(a, b\) => a \+ durOfB\(b\), 0\)/.test(pdf),
   "a printed total that counts only live understates the week exactly as the screen did");
ok("the PDF legend names the task colour", /\["Task", TK_FILL, TK_EDGE\]/.test(pdf));
ok("a block's overnight end is handled in print too",
   /const durOfB = \(b: RosterPdfBlock\)[\s\S]{0,200}?d \+= 24 \* 60/.test(pdf),
   "20:00-00:30 printed as minus nineteen hours before the same fix landed for sessions");
ok("the block arguments are OPTIONAL and last",
   /generatedBy: string,[\s\S]{0,400}?blocks: RosterPdfBlock\[\] = \[\], blockConflictIds: number\[\] = \[\],/.test(pdf),
   "an older caller must still print yesterday's sheet rather than failing");
ok("the board hands its blocks to the PDF",
   /shareRosterPdf\([\s\S]{0,400}?blocks, \[\.\.\.hardBlockIds, \.\.\.softBlockIds\]\)/.test(board),
   "the builder can accept them and still be sent nothing");

ok("the board is live on the right topics",
   /useLiveRefresh\(\["live-sessions", "task-blocks", "tasks", "leave"\]/.test(board));

console.log(fails.length === 0
  ? `PASS — task blocks stay out of the money, and the board holds both kinds of work (${pass} checks)`
  : `\n${fails.map((f) => `  ✗ ${f}`).join("\n")}\n\n${fails.length} check(s) failed.`);
process.exit(fails.length === 0 ? 0 : 1);
