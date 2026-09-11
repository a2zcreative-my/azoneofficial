/**
 * THIRTY MINUTES BEFORE, THIRTY MINUTES BEFORE THE END, AND AT THE END —
 * guard #71, v1.151.0.
 *
 * The CEO, 11-09-2026: *"the notification should popup 30 minutes before
 * their start shift based on their shift assigned and also clock in / out
 * reminder before 30 minutes and during their end shift timing. this is the
 * supposed flow"*.
 *
 * THE PROPERTIES, not the implementation - and the pure half is RUN, not
 * grepped:
 *   1. THE SHIFT IS THE ONE THE CLOCK ACCEPTS. Reminders are computed from
 *      `daySlots` - pattern blocks + roster + live sessions, merged - the same
 *      list the clock-in route checks a punch against. Two lists would let a
 *      reminder name a shift the clock then refuses.
 *   2. THIRTY MINUTES, THREE MOMENTS. A start reminder is due from 30 minutes
 *      before the start until the start; an end reminder from 30 minutes
 *      before the end until the end; an "ended" reminder from the end for a
 *      grace period. Not at 18:30 for everyone.
 *   3. A CLOCK-IN REMINDER GOES TO SOMEBODY NOT YET CLOCKED IN; A CLOCK-OUT
 *      REMINDER GOES TO SOMEBODY STILL CLOCKED IN. The other way round is
 *      noise, and noise is how a bell gets muted.
 *   4. EACH IS SENT ONCE. The ref is unique per person, date, shift and kind;
 *      the cron half reads what was already sent before it sends.
 *   5. A MISSED TICK DELAYS, IT DOES NOT DROP. The windows are ranges, not
 *      exact minutes, so the five-minute cron skipping a beat costs five
 *      minutes, not the reminder.
 *   6. A SPLIT DAY IS TWO SHIFTS. 11-17 + 20:30-22:30 gets a start reminder
 *      at 20:00 and an end reminder at 22:00 - not one 18:30 nudge while the
 *      host is at home.
 *   7. NOBODY IS REMINDED ON LEAVE, ON A REST DAY, OR ON A PUBLIC HOLIDAY -
 *      unless a live or a task was explicitly booked on the holiday.
 *   8. IT RIDES THE FIVE-MINUTE TICK, LAST AND NEVER FATAL, and every
 *      reminder goes through `notify` (bell + push + relay).
 *   9. AN OVERNIGHT SHIFT STILL ENDS. Yesterday is evaluated with the clock
 *      read past midnight.
 *
 * Negative-tested by: computing from `sh.windows` alone (1); moving the
 * start window to 15 minutes (2); dropping the `claimed` check (3) and the
 * `open` check (3); dropping the sent-ref read (4); making the window an
 * exact minute (5); skipping the leave set (7); running before the orders
 * pull (8); dropping the yesterday pass (9).
 */
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execSync } from "node:child_process";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(root, p), "utf8");

let passed = 0, failed = 0;
const ok = (label, cond, why = "") => {
  if (cond) passed += 1;
  else { failed += 1; console.log(`  ✗ ${label}${why ? ` — ${why}` : ""}`); }
};

const pure = read("worker/src/shift-reminders.ts");
const cron = read("worker/src/shift-reminders-cron.ts");
const index = read("worker/src/index.ts");

/* ---- 1 + 8. wiring: the same list as the clock, on the 5-minute tick ---- */
{
  ok("the cron half builds shifts with daySlots (the clock's list)", /daySlots\(blocks, assigned\.list\(u\.id, iso\)/.test(cron));
  ok("it reads the pattern through shiftsOn and assignments through assignedResolver", /shiftsOn\(env, today\)/.test(cron) && /assignedResolver\(env, yesterday, today\)/.test(cron));
  ok("every reminder goes through notify (bell + push + relay)", /await notify\(env, u\.id, "attendance", d\.message, d\.ref\)/.test(cron));
  const tick = index.slice(index.indexOf('if (event.cron === "*/5 * * * *")'), index.indexOf('if (event.cron === "0 0 * * *")'));
  ok("it runs on the five-minute tick", /await runShiftReminders\(env\)/.test(tick));
  ok("after the orders pull, never before it", tick.indexOf("pollElfiaOrders(env)") >= 0 && tick.indexOf("runShiftReminders(env)") >= 0 && tick.indexOf("pollElfiaOrders(env)") < tick.indexOf("runShiftReminders(env)"));
  ok("and never fatal", /try \{\s*await runShiftReminders\(env\);\s*\} catch/.test(tick));
  ok("the operators are not reminded", /NOT_REMINDED = new Set\(\["super_admin", "admin"\]\)/.test(cron));
}

/* ---- 4 + 7 + 9. the cron half: dedupe, leave, holiday, yesterday ---- */
{
  ok("what was already sent is read before anything is sent", /SELECT user_id, ref FROM notifications[\s\S]*?shift_%/.test(cron) && cron.indexOf("sentRefs.has(") >= 0 && cron.indexOf("sentRefs.has(") < cron.indexOf("await notify("));
  ok("a sent ref is remembered inside the pass too", /sentRefs\.add\(`\$\{u\.id\}\|\$\{d\.ref\}`\)/.test(cron));
  ok("approved leave is skipped", /status = 'approved' AND start_date <= \?1 AND end_date >= \?1/.test(cron) && /if \(onLeave\.has\(u\.id\)\) continue;/.test(cron));
  ok("a public holiday drops the PATTERN, keeps assignments", /const blocks = holiday \? \[\] : \(sh\?\.windows \?\? \[\]\);/.test(cron));
  ok("yesterday is evaluated with the clock past midnight", /\[yesterday, nowMin \+ 24 \* 60, holYesterday\]/.test(cron));
  ok("pending punches count as pressed (no pending filter)", !/pending_approval/.test(cron));
}

/* ---- 2, 3, 5, 6. RUN the pure half ---- */
{
  const dir = mkdtempSync(join(tmpdir(), "sr-"));
  let m = null;
  try {
    const src = join(root, "worker/src/shift-reminders.ts").replace(/\\/g, "/");
    const out = join(dir, "sr.mjs").replace(/\\/g, "/");
    execSync(`npx esbuild "${src}" --bundle --format=esm --platform=neutral --outfile="${out}"`, { stdio: "pipe" });
    m = await import(pathToFileURL(join(dir, "sr.mjs")).href);
  } catch (e) {
    ok("the pure half bundles and loads", false, String(e).slice(0, 200));
  }
  if (m) {
    const { dueReminders, LEAD_MINUTES, ENDED_GRACE_MINUTES } = m;
    ok("the lead is the CEO's thirty minutes", LEAD_MINUTES === 30);
    const office = [{ start: 600, end: 1080 }];                       // 10:00-18:00
    const split = [{ start: 660, end: 1020 }, { start: 1230, end: 1350 }]; // 11-17 + 20:30-22:30
    const D = "2026-09-11";
    // a punch at HH:MM MYT as the UTC stamp the DB stores
    const at = (hhmm) => { const [h, mm] = hhmm.split(":").map(Number); const u = new Date(Date.UTC(2026, 8, 11, h - 8, mm)); return u.toISOString().slice(0, 19).replace("T", " "); };
    const open = (hhmm) => [{ in: at(hhmm), out: null, minutes: 0 }];
    const closed = (a, b) => [{ in: at(a), out: at(b), minutes: 0 }];
    const kinds = (r) => r.map((d) => d.kind).join(",");

    /* 2. the three moments */
    ok("09:30, not clocked in: start reminder", kinds(dueReminders(570, D, office, [])) === "start_soon");
    ok("09:29: nothing yet", kinds(dueReminders(569, D, office, [])) === "");
    ok("09:59: still due (a missed tick delays, it does not drop)", kinds(dueReminders(599, D, office, [])) === "start_soon");
    ok("10:00: the start window is over", kinds(dueReminders(600, D, office, [])) === "");
    ok("17:30, clocked in: end reminder", kinds(dueReminders(1050, D, office, open("10:02"))) === "end_soon");
    ok("17:29, clocked in: nothing yet", kinds(dueReminders(1049, D, office, open("10:02"))) === "");
    ok("18:00, clocked in: ended", kinds(dueReminders(1080, D, office, open("10:02"))) === "ended");
    ok("18:45, still clocked in: ended is still due", kinds(dueReminders(1125, D, office, open("10:02"))) === "ended");
    ok("after the grace period the cron's own 18:30/22:00 nudges take over", kinds(dueReminders(1080 + ENDED_GRACE_MINUTES, D, office, open("10:02"))) === "");
    ok("14:00, clocked in, mid-shift: silence", kinds(dueReminders(840, D, office, open("10:02"))) === "");

    /* 3. the right person */
    ok("09:45, already clocked in for it: NO start reminder", kinds(dueReminders(585, D, office, open("09:40"))) === "");
    ok("17:30, never clocked in: NO end reminder (absence is the late flag's business)", kinds(dueReminders(1050, D, office, [])) === "");
    ok("18:05, already clocked out: NO ended reminder", kinds(dueReminders(1085, D, office, closed("10:00", "18:01"))) === "");

    /* 6. a split day is two shifts */
    ok("20:00 on a split day, afternoon done: start reminder for the EVENING", (() => { const r = dueReminders(1200, D, split, closed("11:00", "17:00")); return r.length === 1 && r[0].kind === "start_soon" && r[0].index === 1; })());
    ok("18:30 on a split day, at home between blocks: silence", kinds(dueReminders(1110, D, split, closed("11:00", "17:00"))) === "");
    ok("22:00 on a split day, clocked in for the evening: end reminder for the evening", (() => { const r = dueReminders(1320, D, split, [...closed("11:00", "17:00"), ...open("20:28")]); return r.length === 1 && r[0].kind === "end_soon" && r[0].index === 1; })());
    ok("16:35 on a split day, clocked in: end reminder for the AFTERNOON only", (() => { const r = dueReminders(995, D, split, open("11:00")); return r.length === 1 && r[0].kind === "end_soon" && r[0].index === 0; })());

    /* 4. refs are unique per date, shift and kind */
    const r1 = dueReminders(640, D, split, []), r2 = dueReminders(1200, D, split, closed("11:00", "17:00"));
    ok("the ref names the date, the shift and the kind", r1[0]?.ref === `shift_start:${D}:0` && r2[0]?.ref === `shift_start:${D}:1`);
    ok("the end refs differ from the start refs", dueReminders(1050, D, office, open("10:02"))[0]?.ref === `shift_end_soon:${D}:0` && dueReminders(1080, D, office, open("10:02"))[0]?.ref === `shift_ended:${D}:0`);

    /* 9. overnight: a live 23:00-01:00, clock read past midnight */
    const night = [{ start: 1380, end: 1500, what: "Sara Beauty" }];
    ok("00:30 next day, still clocked in for a 23:00-01:00 live: end reminder", kinds(dueReminders(1440 + 30, D, night, open("22:58"))) === "end_soon");
    ok("01:00 next day: ended", kinds(dueReminders(1500, D, night, open("22:58"))) === "ended");

    /* the words */
    ok("the start message names the shift and says Clock in", /Your shift 10:00-18:00 starts in 30 min — tap Clock in/.test(dueReminders(570, D, office, [])[0]?.message ?? ""));
    ok("the end message says Clock out", /ends at 18:00 — remember to tap Clock out/.test(dueReminders(1050, D, office, open("10:02"))[0]?.message ?? ""));
    ok("an assignment is named in the message", /\(Sara Beauty\)/.test(dueReminders(1500, D, night, open("22:58"))[0]?.message ?? ""));
    ok("a rest day (no shifts) asks for nothing", dueReminders(570, D, [], []).length === 0);
  }
  rmSync(dir, { recursive: true, force: true });
}

console.log(failed === 0
  ? `shift-reminders: ${passed} checks passed.`
  : `\n${failed} shift-reminders check(s) failed.`);
process.exitCode = failed === 0 ? 0 : 1;
