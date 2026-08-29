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

/* ---- 6. registry (the triple bump) ---- */
const index = read("worker/src/index.ts");
ok("0095 is the latest migration", /LATEST_MIGRATION = "0095_task_blocks"/.test(index));
ok("0095 is in EXPECTED_MIGRATIONS", /"0095_task_blocks",/.test(index));
ok("0095 has a health probe", /0095 \(task blocks on the roster\)/.test(index));

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
ok("the board is live on the right topics",
   /useLiveRefresh\(\["live-sessions", "task-blocks", "tasks", "leave"\]/.test(board));

console.log(fails.length === 0
  ? `PASS — task blocks stay out of the money, and the board holds both kinds of work (${pass} checks)`
  : `\n${fails.map((f) => `  ✗ ${f}`).join("\n")}\n\n${fails.length} check(s) failed.`);
process.exit(fails.length === 0 ? 0 : 1);
