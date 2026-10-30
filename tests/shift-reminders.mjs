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
 * v1.226.0 - THE OWNER'S SHIFT REMINDERS BRIEF, 30-10-2026, and his answers
 * ("15 minutes", "Keep 'ended' + 22:00 only", "add the switches"): the lead
 * is FIFTEEN minutes; titles and the brief's wording; the lock screen names
 * the time, never the client; the ref carries the shift's TIME (a moved
 * shift is a new reminder, a block added earlier does not renumber the
 * others); each push lives only until its moment (ttl); the person's
 * switches are honoured; the send is claimed in one statement (`once`);
 * the fixed 18:30 nudge is gone, 22:00 stays.
 *
 * Negative-tested by: computing from `sh.windows` alone (1); moving the
 * start window to 30 minutes (2); dropping the `claimed` check (3) and the
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
  ok("every reminder goes through notify (bell + push + relay), claimed once, titled, with its lifetime",
     /await notify\(env, u\.id, "attendance", d\.message, d\.ref, \{\s*once: true, title: d\.title, push: \{ ttl: d\.ttl, urgency: "high" \}, tally: push,\s*\}\)/.test(cron));
  ok("the person's switches are read and honoured (no row = on)", /FROM notification_prefs WHERE enabled = 0/.test(cron)
     && /if \(off\.has\(`\$\{u\.id\}\|\$\{PREF_OF\[d\.kind\]\}`\)\) \{ skippedOff \+= 1; continue; \}/.test(cron)
     && /start_soon: "shift_clock_in", end_soon: "shift_clock_out", ended: "shift_clock_out"/.test(cron));
  const tick = index.slice(index.indexOf('if (event.cron === "*/5 * * * *")'), index.indexOf('if (event.cron === "0 0 * * *")'));
  ok("it runs on the five-minute tick", /await runShiftReminders\(env\)/.test(tick));
  ok("failed pushes are logged as counts and status codes", /if \(rr\.push\.failed > 0\)[\s\S]{0,80}logError\(env, "shift_reminders_push"/.test(tick));
  const nudge = index.slice(index.indexOf("v1.9.1 CLOCK-OUT REMINDERS"), index.indexOf('console.error("clockout_cron"'));
  ok("the fixed 18:30 nudge is gone, the 22:00 check stays", /if \(minsR >= 22 \* 60\) \{\s*const refR = `clockout2:\$\{todayR\}`;/.test(nudge) && !/18 \* 60 \+ 30\)/.test(nudge) && !/clockout1|stage === 1 \?/.test(nudge));
  ok("after the orders pull, never before it", tick.indexOf("pollElfiaOrders(env)") >= 0 && tick.indexOf("runShiftReminders(env)") >= 0 && tick.indexOf("pollElfiaOrders(env)") < tick.indexOf("runShiftReminders(env)"));
  ok("and never fatal", /try \{\s*const rr = await runShiftReminders\(env\);[\s\S]{0,400}?\} catch \(e\) \{\s*if \(!String\(e\)\.includes\("no such"\)\) await logError\(env, "shift_reminders"/.test(tick));
  ok("the operators are not reminded", /NOT_REMINDED = new Set\(\["super_admin", "admin"\]\)/.test(cron));
}

/* ---- 4 + 7 + 9. the cron half: dedupe, leave, holiday, yesterday ---- */
{
  ok("what was already sent is read before anything is sent", /SELECT user_id, ref FROM notifications[\s\S]*?shift_%/.test(cron) && cron.indexOf("sentRefs.has(") >= 0 && cron.indexOf("sentRefs.has(") < cron.indexOf("await notify("));
  ok("a sent ref is remembered inside the pass too", /sentRefs\.add\(`\$\{u\.id\}\|\$\{d\.ref\}`\)/.test(cron));
  ok("approved leave hours are removed and unresolved coverage is skipped", /status = 'approved'/.test(cron) && /remainingWindows\(scheduled, onLeave\.filter\(l => l\.user_id === u\.id\), iso\)/.test(cron) && /if \(!slots\?\.length\) continue/.test(cron));
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
    ok("the lead is the owner's fifteen minutes (30-10-2026)", LEAD_MINUTES === 15);
    const office = [{ start: 600, end: 1080 }];                       // 10:00-18:00
    const split = [{ start: 660, end: 1020 }, { start: 1230, end: 1350 }]; // 11-17 + 20:30-22:30
    const D = "2026-09-11";
    // a punch at HH:MM MYT as the UTC stamp the DB stores
    const at = (hhmm) => { const [h, mm] = hhmm.split(":").map(Number); const u = new Date(Date.UTC(2026, 8, 11, h - 8, mm)); return u.toISOString().slice(0, 19).replace("T", " "); };
    const open = (hhmm) => [{ in: at(hhmm), out: null, minutes: 0 }];
    const closed = (a, b) => [{ in: at(a), out: at(b), minutes: 0 }];
    const kinds = (r) => r.map((d) => d.kind).join(",");

    /* 2. the three moments */
    ok("09:45, not clocked in: start reminder", kinds(dueReminders(585, D, office, [])) === "start_soon");
    ok("09:44: nothing yet", kinds(dueReminders(584, D, office, [])) === "");
    ok("09:30: nothing yet (the old thirty minutes)", kinds(dueReminders(570, D, office, [])) === "");
    ok("09:59: still due (a missed tick delays, it does not drop)", kinds(dueReminders(599, D, office, [])) === "start_soon");
    ok("10:00: the start window is over", kinds(dueReminders(600, D, office, [])) === "");
    ok("17:45, clocked in: end reminder", kinds(dueReminders(1065, D, office, open("10:02"))) === "end_soon");
    ok("17:44, clocked in: nothing yet", kinds(dueReminders(1064, D, office, open("10:02"))) === "");
    ok("18:00, clocked in: ended", kinds(dueReminders(1080, D, office, open("10:02"))) === "ended");
    ok("18:45, still clocked in: ended is still due", kinds(dueReminders(1125, D, office, open("10:02"))) === "ended");
    ok("after the grace period the cron's 22:00 check takes over", kinds(dueReminders(1080 + ENDED_GRACE_MINUTES, D, office, open("10:02"))) === "");
    ok("14:00, clocked in, mid-shift: silence", kinds(dueReminders(840, D, office, open("10:02"))) === "");

    /* 3. the right person */
    ok("09:50, already clocked in for it: NO start reminder", kinds(dueReminders(590, D, office, open("09:40"))) === "");
    ok("17:45, never clocked in: NO end reminder (absence is the late flag's business)", kinds(dueReminders(1065, D, office, [])) === "");
    ok("18:05, already clocked out: NO ended reminder", kinds(dueReminders(1085, D, office, closed("10:00", "18:01"))) === "");

    /* 6. a split day is two shifts */
    ok("20:15 on a split day, afternoon done: start reminder for the EVENING", (() => { const r = dueReminders(1215, D, split, closed("11:00", "17:00")); return r.length === 1 && r[0].kind === "start_soon" && r[0].index === 1; })());
    ok("18:30 on a split day, at home between blocks: silence", kinds(dueReminders(1110, D, split, closed("11:00", "17:00"))) === "");
    ok("22:15 on a split day, clocked in for the evening: end reminder for the evening", (() => { const r = dueReminders(1335, D, split, [...closed("11:00", "17:00"), ...open("20:28")]); return r.length === 1 && r[0].kind === "end_soon" && r[0].index === 1; })());
    ok("16:50 on a split day, clocked in: end reminder for the AFTERNOON only", (() => { const r = dueReminders(1010, D, split, open("11:00")); return r.length === 1 && r[0].kind === "end_soon" && r[0].index === 0; })());

    /* 4. refs are unique per date, shift TIME and kind (v1.226.0) */
    const r1 = dueReminders(650, D, split, []), r2 = dueReminders(1215, D, split, closed("11:00", "17:00"));
    ok("the ref names the date, the shift's start time and the kind", r1[0]?.ref === `shift_start:${D}:1100` && r2[0]?.ref === `shift_start:${D}:2030`);
    ok("the end refs name the end time", dueReminders(1065, D, office, open("10:02"))[0]?.ref === `shift_end_soon:${D}:1800` && dueReminders(1080, D, office, open("10:02"))[0]?.ref === `shift_ended:${D}:1800`);
    ok("a shift moved from 10:00 to 11:00 is a NEW start reminder", dueReminders(585, D, office, [])[0]?.ref !== dueReminders(645, D, [{ start: 660, end: 1080 }], [])[0]?.ref);
    ok("a block added earlier in the day does not renumber the evening's ref", dueReminders(1215, D, [{ start: 540, end: 600 }, ...split], closed("11:00", "17:00"))[0]?.ref === `shift_start:${D}:2030`);
    ok("an overnight end keeps its own number (past 24:00)", dueReminders(1440 + 45, D, [{ start: 1380, end: 1500 }], open("22:58"))[0]?.ref === `shift_end_soon:${D}:2500`);

    /* 9. overnight: a live 23:00-01:00, clock read past midnight */
    const night = [{ start: 1380, end: 1500, what: "Sara Beauty" }];
    ok("00:45 next day, still clocked in for a 23:00-01:00 live: end reminder", kinds(dueReminders(1440 + 45, D, night, open("22:58"))) === "end_soon");
    ok("01:00 next day: ended", kinds(dueReminders(1500, D, night, open("22:58"))) === "ended");

    /* the words - the owner's brief */
    const st = dueReminders(585, D, office, [])[0], en = dueReminders(1065, D, office, open("10:02"))[0], ed = dueReminders(1080, D, office, open("10:02"))[0];
    ok("start: 'Shift starting soon' / 'Your shift starts in 15 minutes at 10:00. Get ready to clock in.'", st?.title === "Shift starting soon" && st?.message === "Your shift starts in 15 minutes at 10:00. Get ready to clock in.");
    ok("end: 'Shift ending soon' / 'Your shift ends in 15 minutes at 18:00. Remember to clock out when your work is finished.'", en?.title === "Shift ending soon" && en?.message === "Your shift ends in 15 minutes at 18:00. Remember to clock out when your work is finished.");
    ok("ended: says still clocked in, never that work is finished", ed?.title === "Shift ended" && /still clocked in/.test(ed?.message ?? ""));
    ok("a late tick says the real minutes (09:50 -> 10 minutes; 09:59 -> 1 minute)", /starts in 10 minutes at 10:00/.test(dueReminders(590, D, office, [])[0]?.message ?? "") && /starts in 1 minute at 10:00/.test(dueReminders(599, D, office, [])[0]?.message ?? ""));
    ok("the lock screen never names the client or the task", !/Sara Beauty/.test(dueReminders(1500, D, night, open("22:58"))[0]?.message ?? "x") && !/Sara Beauty/.test(dueReminders(1440 + 45, D, night, open("22:58"))[0]?.message ?? "x"));
    ok("each push lives only until its moment (09:45 -> 15 min; never under a minute)", st?.ttl === 900 && dueReminders(599, D, office, [])[0]?.ttl === 60 && en?.ttl === 900 && ed?.ttl === 3600);
    ok("a rest day (no shifts) asks for nothing", dueReminders(570, D, [], []).length === 0);
  }
  rmSync(dir, { recursive: true, force: true });
}

console.log(failed === 0
  ? `shift-reminders: ${passed} checks passed.`
  : `\n${failed} shift-reminders check(s) failed.`);
process.exitCode = failed === 0 ? 0 : 1;
