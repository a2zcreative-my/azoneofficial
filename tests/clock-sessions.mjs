#!/usr/bin/env node
/* Guard #60 — v1.133.0: a day is a list of shifts, and overtime is what lies outside the schedule.
 *
 * CEO, 07-09-2026: *"I want my staff being clock in and out based on their
 * working schedule like example 11:00am to 05:00pm then next shift schedule
 * 08:00pm to 10:00pm or 8:30pm to 10:30pm it is either. then another shift
 * maybe will be started at 2:00pm to 10:00pm. OT is based on outside of their
 * working schedule."*
 *
 * The rule is RUN, on his examples, against the shipped code: worker/src/
 * clock-day.ts is bundled and imported, so this file cannot pass on a rule
 * that drifted from the one the worker runs. Then the wiring is read — the
 * five doors that used to read a day as one pair, the punch route's state
 * machine, the retired OT buttons, and what the phone says.
 *
 * Run: node --experimental-strip-types tests/clock-sessions.mjs
 *
 * Negative-tested by: letting a second clock-in open a second session (the
 * 11:00/11:30 case fails); paying the gap between shifts (the 17-20 case
 * fails); judging early-out against the end of the day (17:00 fails); writing
 * OT on a part-timer; leaving one site on MIN/MAX; keeping the OT buttons;
 * (v1.133.2) letting a claimed shift be clocked again; not merging an
 * assignment into the block it sits in.
 */
import { readFileSync, mkdtempSync } from "node:fs";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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

const dir = mkdtempSync(join(tmpdir(), "clock-"));
const bundle = async (src, name) => {
  const out = join(dir, name);
  execSync(`npx esbuild "${join(root, src)}" --bundle --format=esm --platform=neutral --outfile="${out}" --log-level=error`, { cwd: root, stdio: "inherit" });
  return import(pathToFileURL(out).href);
};
const cd = await bundle("worker/src/clock-day.ts", "clock-day.mjs");
const hr = await bundle("worker/src/hourly.ts", "hourly.mjs");

/* MYT helpers: a stored stamp is UTC, eight hours behind the clock on the wall. */
const at = (day, hhmm) => {
  const [h, m] = hhmm.split(":").map(Number);
  const t = new Date(Date.parse(`${day}T00:00:00Z`) + ((h - 8) * 60 + m) * 60000);
  return t.toISOString().slice(0, 19).replace("T", " ");
};
const H = (hh, mm = 0) => hh * 60 + mm;
const D = "2026-09-07";

/* ---- 1. the CEO's day, as sessions --------------------------------- */
{
  const sess = cd.pairSessions([
    { type: "clock_in", at: at(D, "11:00") }, { type: "clock_out", at: at(D, "17:00") },
    { type: "clock_in", at: at(D, "20:00") }, { type: "clock_out", at: at(D, "22:00") },
  ]);
  ok("11-17 then 20-22 is two sessions", sess.length === 2);
  ok("of six hours and two", sess[0].minutes === 360 && sess[1].minutes === 120);
  ok("the hours at home between them are inside no session", cd.sessionMinutes(sess) === 480,
     `${cd.sessionMinutes(sess)} min — first-in-to-last-out would say 660`);
  ok("first in and last out are the day's edges", cd.mytMinutes(cd.firstIn(sess)) === H(11) && cd.mytMinutes(cd.lastOut(sess)) === H(22));
  ok("nothing is open at the end of it", cd.isOpen(sess) === false);
}
{
  const sess = cd.pairSessions([
    { type: "clock_in", at: at(D, "11:00") }, { type: "clock_out", at: at(D, "17:00") },
    { type: "clock_in", at: at(D, "20:00") },
  ]);
  ok("a third punch with no fourth is an OPEN evening shift", sess.length === 2 && cd.isOpen(sess) && sess[1].out === null);
  ok("an open shift has no length yet and no last-out", cd.sessionMinutes(sess) === 360 && cd.lastOut(sess) === null,
     "the day is not over, so the register must not say when it ended");
}
{
  const sess = cd.pairSessions([
    { type: "clock_in", at: at(D, "11:00") }, { type: "clock_in", at: at(D, "11:30") },
    { type: "clock_out", at: at(D, "17:00") },
  ]);
  ok("a second clock-in while one is open changes nothing", sess.length === 1 && cd.mytMinutes(sess[0].in) === H(11) && sess[0].minutes === 360,
     "the open one is the truth about when work began");
  const sess2 = cd.pairSessions([{ type: "clock_out", at: at(D, "17:00") }]);
  ok("a clock-out with nothing open is not a session", sess2.length === 0,
     "that is the forgotten-punch flow's row, pending, and it counts for nothing");
  ok("order on the clock, not order in the array",
     cd.pairSessions([{ type: "clock_out", at: at(D, "17:00") }, { type: "clock_in", at: at(D, "11:00") }]).length === 1);
}

/* ---- 2. overtime is what lies outside the schedule ------------------ */
{
  const day = [{ start: H(11), end: H(17) }];
  ok("an 11-17 person working 20-22: the whole evening is overtime",
     JSON.stringify(cd.overtimeSegments(day, H(20), H(22))) === JSON.stringify([{ from: H(20), to: H(22), minutes: 120 }]));
  ok("the afternoon shift itself is none", cd.overtimeSegments(day, H(11), H(17)).length === 0);
  ok("one pair 11:00-22:00 with no clock-out at 17:00 is five hours outside — and that is what the CEO decides on",
     cd.overtimeSegments(day, H(11), H(22)).reduce((n, s) => n + s.minutes, 0) === 300,
     "not clocking out at 17:00 is a claim, and pending is where claims go");
  const split = [{ start: H(11), end: H(17) }, { start: H(20), end: H(22) }];
  ok("a person whose pattern already has the evening: 20-22 is SCHEDULED, not overtime",
     cd.overtimeSegments(split, H(20), H(22)).length === 0,
     "the CEO chose 'outside their scheduled blocks' over 'anything after 18:00'");
  ok("...and 20:00-23:00 on that pattern is one hour of overtime, 22:00-23:00",
     JSON.stringify(cd.overtimeSegments(split, H(20), H(23))) === JSON.stringify([{ from: H(22), to: H(23), minutes: 60 }]));
  /* v1.159.4 (CEO: "her OT is 7pm to 8pm. her working schedule is 11am to
     7pm") - arriving early is not overtime; the late finish is. */
  ok("an early start is not overtime; the late finish is the one stretch",
     JSON.stringify(cd.overtimeSegments(day, H(9), H(19))) === JSON.stringify([{ from: H(17), to: H(19), minutes: 120 }]));
  /* v1.159.6 (CEO: "still why 7:00pm to 8:00pm was not appear as OT for
     12th Sep???") - the rule was right; it only ran when a punch was saved.
     The Overtime card now reconciles the month against the schedule as it
     is NOW, every time it opens. */
  ok("the Overtime card reconciles the present and previous month on every open",
     /export async function reconcileDerivedOt\(env: Env, month: string\)/.test(read("worker/src/staff.ts"))
     && /await reconcileDerivedOt\(env, prevM\); await reconcileDerivedOt\(env, thisM\);/.test(read("worker/src/staff.ts")));
  ok("...reading the schedule with the roster, once for the month",
     /const shiftAt = await shiftResolver\(env, assigned\);[\s\S]{0,4000}?const sessions = await clockedSessions\(env, \{ month \}\);/.test(read("worker/src/staff.ts")));
  ok("...a released month is closed: nothing offered, its pending derived rows cleared, decided rows kept (v1.159.8)",
     /SELECT released_at FROM payslip_releases WHERE month = \?1`\)\s*\.bind\(month\)[\s\S]{0,400}?AND COALESCE\(status, 'pending'\) = 'pending' AND COALESCE\(user_agent, ''\) = 'clock:derived'`/.test(read("worker/src/staff.ts"))
     && /NOT EXISTS \(SELECT 1 FROM payslip_releases pr WHERE pr\.month = strftime\('%Y-%m', o\.created_at, '\+8 hours'\)\)/.test(read("worker/src/staff.ts")));
  ok("...never touching a decided row - only pending derived stretches are added or removed",
     /const decided = rows\.filter\(\(r\) => r\.status !== "pending"\);/.test(read("worker/src/staff.ts"))
     && /r\.status === "pending" && r\.ua === "clock:derived"/.test(read("worker/src/staff.ts"))
     && /if \(decidedIns\.has\(w\.inAt\) \|\| pendingIns\.has\(w\.inAt\)\) continue;/.test(read("worker/src/staff.ts")));
  ok("...and the derivation measures against the day's assigned schedule",
     /const sh = withAssigned\(await shiftOn\(env, userId, day\), \(await assignedResolver\(env, day, day\)\)\.list\(userId, day\), role === "live_host"\);/.test(read("worker/src/staff.ts")));
  ok("a rest day: every minute clocked is outside",
     JSON.stringify(cd.overtimeSegments([], H(11), H(15))) === JSON.stringify([{ from: H(11), to: H(15), minutes: 240 }]));
  ok("packing up is not a shift: 17:00-17:20 is nothing", cd.overtimeSegments(day, H(11), H(17, 20)).length === 0,
     `OT_MIN_MINUTES is ${cd.OT_MIN_MINUTES}`);
  ok("the threshold is thirty minutes", cd.OT_MIN_MINUTES === 30);
  ok("a 2pm-10pm pattern: 22:00-23:30 is ninety minutes outside",
     cd.overtimeSegments([{ start: H(14), end: H(22) }], H(14), H(23, 30))[0]?.minutes === 90);
}

/* ---- 3. early-out is judged against the shift being left ----------- */
{
  const split = [{ start: H(11), end: H(17) }, { start: H(20), end: H(22) }];
  ok("leaving at 17:00 from the afternoon shift is ON TIME", cd.earlyAgainst(split, H(17)) === H(17),
     "against 22:00 it read as five hours early — the misreading that made one-pair-per-day the only workable rule");
  ok("leaving at 16:30 is early against 17:00", cd.earlyAgainst(split, H(16, 30)) === H(17) && H(16, 30) < cd.earlyAgainst(split, H(16, 30)));
  ok("leaving at 17:30, between shifts, is judged against the shift just finished", cd.earlyAgainst(split, H(17, 30)) === H(17));
  ok("leaving at 21:00 is early against 22:00", cd.earlyAgainst(split, H(21)) === H(22));
  ok("leaving at 22:30 is not early", cd.earlyAgainst(split, H(22, 30)) === H(22) && !(H(22, 30) < H(22)));
  ok("before the first shift there is nothing to be early against", cd.earlyAgainst(split, H(10)) === null);
  ok("a rest day has nothing to be early against", cd.earlyAgainst([], H(15)) === null);
}

/* ---- 3b. a clock-in must have a shift to clock in FOR (v1.133.2) ----
   The CEO clocked in and out FOUR times at 23:32 on a 10:00-18:00 pattern:
   "user can clock in more than 2 time which is not correct! it is supposed
   to based on the working hours that scheduled for them and based on the
   Roster and Scheduled assigned to them also!" */
{
  const office = [{ start: H(10), end: H(18) }];
  const sess = (...pairs) => cd.pairSessions(pairs.flatMap(([i, o]) => [
    { type: "clock_in", at: at(D, i) }, ...(o ? [{ type: "clock_out", at: at(D, o) }] : []),
  ]));
  ok("the CEO's test: 09:00-19:17 on a 10-18 pattern claims the one shift",
     cd.claimedSlots(cd.daySlots(office, []), sess(["09:00", "19:17"])).size === 1);
  ok("...so a clock-in at 23:32 is refused: every shift is clocked",
     JSON.stringify(cd.canClockIn(cd.daySlots(office, []), sess(["09:00", "19:17"]), H(23, 32))) === JSON.stringify({ ok: false, reason: "all_claimed" }),
     "four sessions on a one-shift day is the bug");
  ok("a fresh day: 09:45 is allowed, for the 10:00 shift",
     cd.canClockIn(cd.daySlots(office, []), [], H(9, 45)).ok === true);
  const split = [{ start: H(11), end: H(17) }, { start: H(20), end: H(22) }];
  ok("11-17 + 20-22: after the afternoon, 19:50 is allowed for the evening shift",
     cd.canClockIn(cd.daySlots(split, []), sess(["11:00", "17:00"]), H(19, 50)).ok === true);
  ok("...and after both, 22:40 is refused",
     cd.canClockIn(cd.daySlots(split, []), sess(["11:00", "17:00"], ["20:00", "22:00"]), H(22, 40)).ok === false);
  /* v1.139.0 - a CLOSED session claims every shift it covered. */
  ok("clocking out at 15:00 and back in at 15:20 claims the SAME shift, and leaves the evening",
     cd.claimedSlots(cd.daySlots(split, []), sess(["11:00", "15:00"], ["15:20", "17:00"])).size === 1,
     "a lunch break used to spend the evening shift the person had not worked yet");
  ok("...so the evening can still be clocked in for",
     cd.canClockIn(cd.daySlots(split, []), sess(["11:00", "15:00"], ["15:20", "17:00"]), H(20)).ok === true);
  ok("a session that ran straight through BOTH shifts claims both",
     cd.claimedSlots(cd.daySlots(split, []), sess(["11:00", "22:00"])).size === 2,
     "claiming only the afternoon let the same evening be clocked in for again at 22:05 and paid twice");
  ok("...and there is nothing left to clock in for after it",
     cd.canClockIn(cd.daySlots(split, []), sess(["11:00", "22:00"]), H(22, 5)).ok === false);
  ok("four clock-ins at 23:32 on a 10-18 pattern are still refused after the first",
     cd.canClockIn(cd.daySlots([{ start: H(10), end: H(18) }], []), sess(["23:32", "23:33"]), H(23, 34)).ok === false,
     "the CEO's original report - the bound is the schedule");
  /* v1.134.2 - the CEO: a rest day worked is "for me to decide either OT or
     replacement leave". Nothing to decide about a day the clock refused. */
  ok("a rest day with nothing on the roster: ONE clock-in, so the day is recorded for the CEO to decide",
     JSON.stringify(cd.canClockIn(cd.daySlots([], []), [], H(11))) === JSON.stringify({ ok: true, slot: null }),
     "a refused rest day is a day the CEO cannot pay as OT or credit as replacement leave");
  ok("...and not a second one",
     JSON.stringify(cd.canClockIn(cd.daySlots([], []), sess(["11:00", "15:00"]), H(16))) === JSON.stringify({ ok: false, reason: "all_claimed" }),
     "one stretch a day on a rest day");
  ok("a rest day WITH a live session on the board: that is the shift",
     cd.canClockIn(cd.daySlots([], [{ start: H(20), end: H(22), what: "Sara Beauty" }]), [], H(19, 45)).ok === true);
  ok("an 11-17 person with a 20:00 live assigned: the evening is a second shift",
     cd.daySlots([{ start: H(11), end: H(17) }], [{ start: H(20), end: H(22), what: "Sara Beauty" }]).length === 2);
  ok("a 20:00 live inside a 20:30-22:30 block is ONE evening shift, merged",
     cd.daySlots(split, [{ start: H(20, 30), end: H(22, 30), what: "Sara Beauty" }]).length === 2,
     "unmerged, the same evening could be clocked in for twice");
  ok("the merged shift keeps the assignment's name",
     cd.daySlots(split, [{ start: H(20, 30), end: H(22, 30), what: "Sara Beauty" }])[1].what === "Sara Beauty");
  ok("the label reads as a person does",
     cd.slotsLabel(cd.daySlots(split, [{ start: H(20), end: H(22), what: "Sara Beauty" }])) === "11:00-17:00 · 20:00-22:00 (Sara Beauty)");
}

/* ---- 4. the part-timer's break, per session ------------------------ */
{
  ok("11:05-17:00 + 20:00-22:30 is 8h25 clocked, one break, 7h25 paid",
     JSON.stringify(hr.hourlyPaidForSessions([355, 150])) === JSON.stringify({ clocked: 505, breaks: 60, counted: 445 }));
  ok("two four-hour shifts earn no break — nobody worked five hours straight",
     hr.hourlyPaidForSessions([240, 240]).breaks === 0,
     "Employment Act 1955 s.60A(1)(a): five CONSECUTIVE hours");
  ok("a single session pays exactly what v1.109.0 paid",
     hr.hourlyPaidForSessions([H(11, 25)]).counted === hr.hourlyPaidMinutes(H(11, 25)));
  ok("the two-hour evening beside a six-hour afternoon earns no second break",
     hr.hourlyPaidForSessions([360, 120]).breaks === 60);
}

/* ---- 5. the wiring ------------------------------------------------- */
const staff = read("worker/src/staff.ts");
const dash = read("components/portal/dashboard.tsx");
ok("the punch route pairs today's punches and reads whether one is open",
   /const sessionsToday = pairSessions\(/.test(staff) && /const openNow = isOpen\(sessionsToday\);/.test(staff));
ok("a clock-in is refused while one is OPEN",
   /if \(body\.type === "clock_in" && openNow\) \{/.test(staff));
/* v1.133.2 */
ok("...and refused when there is no shift left to clock in for",
   /const verdict = canClockIn\(slotsToday, sessionsToday,/.test(staff) && /code: "no_shift"/.test(staff),
   "the CEO clocked in four times at 23:32 on a 10-18 pattern");
ok("the shifts are the pattern PLUS the roster and the live board",
   /const slotsToday = daySlots\(shEarly\.windows, assignedToday\.map/.test(staff)
   && /\.list\(user\.id, todayMYT\)/.test(staff));
ok("the refusal names the shifts", /every shift today \(\$\{slotsLabel\(slotsToday\)\}\)/.test(staff));
ok("the phone is told whether a clock-in is possible, and why not",
   /can_clock_in: verdictT\.ok/.test(staff) && /why_not: verdictT\.ok \? null : verdictT\.reason/.test(staff));
/* v1.176.0 - THE SAME RULE, STATED ONCE. Clock in used to be a permanently
   rendered PRIMARY button that spent most of the day disabled and wearing the
   answer as its label ("Clocked in ✓ 08:06", "All shifts clocked ✓") - the
   third printing of a fact the status chip above it already gave. The rule is
   unchanged; it is now expressed by what is OFFERED: on shift → Clock out;
   off shift with a shift left → Clock in; nothing left → neither, and the
   server's own `why_not` sentence says why. */
ok("...and does not OFFER Clock in on that answer",
   /\) : canClockIn \? \(/.test(dash)
   && /const canClockIn = todayShift\?\.can_clock_in \?\? true;/.test(dash)
   && /const whyNoClockIn = todayShift\?\.why_not \?\? null;/.test(dash)
   && /\{whyNoClockIn \?\? L\("All shifts clocked/.test(dash)
   && /No shift to clock in for/.test(dash));
{
  /* the CODE, not the prose explaining why the code is the way it is */
  const dashCode = dash.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
  /* v1.176.1 - the chip no longer repeats the WORD the title beside it already
     says ("On shift"); it carries the TIME, and the chip's tone carries the
     state. The owner counted "On shift" three times in that one row. */
  ok("the clock shows ONE status and ONE action - the fact is never printed twice",
     /L\(`Clocked in at \$\{openSince\}`/.test(dashCode)
     && !/On shift · clocked in at/.test(dashCode)
     && !/Clocked in ✓/.test(dashCode)
     && !/tr\("Clocked out ✓", lang\)/.test(dashCode),
     "the chip carries the time and the tone carries the state; the title says 'On shift' once");
  ok("a finished shift's two times are on the chip, so nothing below repeats them",
     /Clocked out · \$\{firstIn\}\$\{lastOut \? ` → \$\{lastOut\}` : ""\}/.test(dashCode));
  ok("the day's punch record is drawn only when it says something the chip does not",
     /shiftOnly \|\| today\.length \+ todayOt\.length === 0 \|\| today\.length > 2 \|\| todayOt\.length > 0/.test(dashCode),
     "one clean pair is already on the chip; more than one shift, or any OT, is not - and On Shift owns the record, so it always shows it");
  /* v1.176.1 - and no shortcut in the OTHER direction either. A pill reading
     "On Shift", beside a title reading "On shift", one thumb above the bottom
     bar's own On Shift stop, is the same word three times, not a convenience.
     The shell navigates; a card does not need to. */
  ok("neither card carries a shortcut to the other - the bottom bar and the rail navigate",
     !/go\("On Shift"\)/.test(dashCode) && !/go\("Dashboard"\)\}>/.test(dashCode),
     "the Dashboard lost its On Shift pill in v1.176.1; On Shift lost its Dashboard twin in v1.176.0");
  /* v1.176.1 - the rule paragraph and the office-location strip are drawn on
     the page that OWNS the punch, not on both. The Dashboard keeps a summary
     line (the hours, and how many are left) and the punch buttons. */
  ok("the shift RULE is stated once, where the clock lives",
     /\{shiftOnly && fence\?\.configured && \(/.test(dashCode)
     && /One clock in and out per shift/.test(dashCode)
     && (dashCode.match(/One clock in and out per shift/g) ?? []).length === 1,
     "both cards printed a paragraph about the shift, and the Dashboard's was the longer one");
  ok("the location check is ONE control, and the guidance paragraph is guidance only",
     (dashCode.match(/checkLocation\(\)/g) ?? []).length === 1
     && !/fenceCheck/.test(dashCode) && !/fenceVerdict/.test(dashCode),
     "the guidance paragraph used to carry a SECOND Check my location button and a SECOND distance, under a note that already had both");
  ok("the required-location guidance itself is kept",
     /Office check-in is on/.test(dashCode) && /flagged for HR/.test(dashCode) && /css\.fenceLine/.test(dashCode));
}
ok("a clock-out is refused only with nothing open, and says what to do next",
   /if \(body\.type === "clock_out" && !openNow\) \{/.test(staff) && /Clock in again when your next shift starts/.test(staff));
ok("the forgotten-punch flow survives: a clock-out on a day with NO session is still taken as pending",
   /if \(sessionsToday\.length > 0\) \{[\s\S]{0,1600}?if \(body\.forgot !== true\) \{/.test(staff));
/* v1.139.0 - the rule moved into `deriveOtForDay`, called from the clock-out
   AND from the three other ways a day gets settled (an approved pending
   punch, an HR correction, a shift that ran past midnight). The checks below
   ask what the rule DOES, wherever it lives. */
ok("overtime is written on the clock-out that closes a shift",
   /const closingSession = body\.type === "clock_out" && openNow/.test(staff)
   && /await deriveOtForDay\(/.test(staff)
   && /for \(const seg of overtimeSegments\(sh\.windows, from, from \+ se\.minutes\)\)/.test(staff));
ok("...and from every other door a day can be settled by",
   /await deriveOtForDay\(\s*\n?\s*env, user\.id, closesYesterday \?\? todayMYT/.test(staff)
   && /attendance\.forgot_approve[\s\S]{0,1500}?await deriveOtForDay\(env, rowP\.user_id, dayP/.test(staff)
   && /await reDeriveDays\(env, beforeA\?\.user_id \?\? 0, \[beforeA\?\.d, myt\.slice\(0, 10\)\]\)/.test(staff)
   && /await reDeriveDays\(env, beforeD\?\.user_id \?\? 0, \[beforeD\?\.d\]\)/.test(staff),
   "a clock-out, an approved pending punch, an amended punch, a deleted punch");
ok("a shift that ran past midnight can be clocked out, and is paid on the day it began",
   /let closesYesterday: string \| null = null;/.test(staff)
   && /if \(body\.type === "clock_out" && !openNow && !closesYesterday\) \{/.test(staff)
   && /else if \(r\.type === "clock_out" && held\) \{ day = held; openDay\.delete\(r\.user_id\); \}/.test(staff),
   "a live host who finished at 00:20 met 'You haven\'t clocked in today' and lost the night");
ok("...into ot_records, as pending, so every approval screen keeps working",
   /INSERT INTO ot_records \(user_id, type, ip, user_agent, created_at\)[\s\S]{0,80}?'ot_in'[\s\S]{0,80}?'ot_out'/.test(staff)
   && /'clock:derived'/.test(staff));
ok("never for a part-timer — they are paid every clocked minute already",
   /if \(me\?\.employment_status === "part_time"\) return 0;/.test(staff)
   && /if \(await isHourlyUserId\(env, userId\)\) return 0;/.test(staff),
   "overtime on top of by-the-clock pay would pay the evening twice");
ok("never for an executive",
   /if \(\["ceo", "coo", "cco", "super_admin", "admin"\]\.includes\(role\)\) return 0;/.test(staff));
ok("never on a public holiday — that day is paid under its own rule",
   /SELECT 1 AS x FROM holidays WHERE holiday_date = \?1 AND COALESCE\(kind, 'public'\) IN \('public','replacement'\)/.test(staff)
   && /if \(holiday\) return 0;/.test(staff));
/* v1.139.0 - ...but a COMPANY day off is not one of those: it pays no
   premium of its own, so a day worked on it derived nothing and earned
   nothing. */
ok("...only a holiday that pays its own premium, which is what phWorkResolver pays for",
   /kind IN \('public', 'replacement'\)|IN \('public','replacement'\)/.test(staff));
ok("never from a pending punch", /!storedPending/.test(staff));
ok("once — a retried clock-out does not write the evening twice",
   /SELECT id FROM ot_records WHERE user_id = \?1 AND type = 'ot_in' AND created_at = \?2/.test(staff));
ok("the approvers hear about it", /Overtime to decide - \$\{who\?\.n/.test(staff));
ok("a failure to derive never un-records the punch", /await logError\(env, "ot_derive"/.test(staff));
/* ---- v1.134.0 — OT in / OT out are back, AFTER the schedule ------------
   CEO: "after their working schedule, does they be able to OT clock in and
   out? but OT should straight away deliver to me for an approval which is
   once approved, it will directly recorded into the payroll and at the same
   time will be recorded at attendance for me to perform a manual update or
   amendment if needed (ceo only)". */
ok("the OT punch route exists again", /if \(path === "\/attendance\/ot" && method === "POST"\) \{\s*\n\s*const otTypes/.test(staff));
ok("OT in is refused while a shift is still to be clocked in for",
   /const verdictO = canClockIn\(slotsO, sessO, minsO\);[\s\S]{0,2000}?if \(verdictO\.ok && body\.type === "ot_in"\)/.test(staff) && /err\("shift_left"/.test(staff),
   "overtime is what comes AFTER the working schedule");
/* v1.139.0 - and AFTER means after the schedule, not merely after the last
   shift was claimed: clocking out early closed the shift and let OT in be
   accepted inside the person's own paid hours. */
ok("...and refused before the schedule has finished, however the shifts were claimed",
   /const endOfSchedule = slotsO\.length > 0 \? Math\.max\(\.\.\.slotsO\.map\(\(x\) => x\.end\)\) : 0;/.test(staff)
   && /if \(body\.type === "ot_in" && slotsO\.length > 0 && minsO < endOfSchedule\)/.test(staff));
ok("...and refused outright on a rest day, whatever the shifts say",
   /if \(slotsO\.length === 0 && body\.type === "ot_in"\) \{/.test(staff),
   "the phone hides the buttons on a rest day; the route has to hold the same line");
ok("the one-stretch rule counts PUNCHED pairs, not the ones the clock derived",
   /AND COALESCE\(user_agent, ''\) NOT IN \('clock:derived', 'ceo:rest-day'\)/.test(staff),
   "a 30-minute late clock-out used to block the OT in button for the rest of the day");
ok("...and while a shift is open", /err\("shift_open"/.test(staff));
ok("the same eligibility as before: not executives, not part-timers",
   /Executive roles \(CEO\/COO\/CCO\) are not eligible for OT punches/.test(staff) && /meO\?\.employment_status === "part_time"/.test(staff));
ok("OT out delivers straight to the approvers", /after the working schedule\)\.`,\s*\n\s*`ot:\$\{user\.id\}:\$\{todayO\}`/.test(staff));
ok("the phone offers OT only after the schedule",
   /can_ot: !verdictT\.ok && !isOpen\(sessT\)/.test(staff) && /const showOt = otEligible && !openNow && \(\(todayShift\?\.can_ot \?\? false\)/.test(dash));
/* ---- v1.134.2 — a rest day worked is ONE decision, the CEO's ---------------
   CEO: "OT cant be editable? and cant be remove if it is not valid??? this
   one she work after working day which is supposed for me to decide either
   OT or replacement leave". */
const rdc = read("components/portal/rest-day-credits.tsx");
const rp = read("components/portal/role-panels.tsx");
ok("a rest day is clocked with Clock in / Clock out, and the clock does not decide it is overtime",
   /if \(sh\.kind === "rest_day"\) return 0;/.test(staff),
   "derived OT on a rest day would pre-empt the CEO's choice between OT and replacement leave");
/* v1.139.0 - the two other ways a derived claim could stand on nothing. */
ok("never from a session whose clock-in is still waiting on the CEO",
   /!\(closingSession && pendingIns\.has\(closingSession\.in\)\)/.test(staff)
   && /const pendingIns = new Set\(/.test(staff),
   "a clock-in replayed from the outbox and later rejected would leave its overtime approvable");
ok("a still-pending derived claim is cleared before the day is derived again",
   /DELETE FROM ot_records WHERE user_id = \?1 AND date\(created_at, '\+8 hours'\) = \?2[\s\S]{0,120}?user_agent = 'clock:derived' AND COALESCE\(status, 'pending'\) = 'pending'/.test(staff),
   "correcting a clock-out from 22:00 to 18:00 used to leave the four hours standing");
ok("...and offers no OT buttons on a rest day either", /can_ot: !verdictT\.ok && !isOpen\(sessT\) && slotsT\.length > 0/.test(staff));
ok("the refusal of a second rest-day clock-in says who decides",
   /one stretch a day\. The CEO decides whether it counts as overtime or replacement leave/.test(staff)
   && /clock in and out once — the CEO decides whether it counts as overtime or replacement leave/.test(dash));
ok("the CEO can pay a rest day as overtime, from the same card as replacement leave",
   /path === "\/rest-day-ot" && method === "POST"[\s\S]{0,200}?if \(!\["ceo", "super_admin"\]\.includes\(user\.role\)\)/.test(staff)
   && /`\/rest-day-ot`/.test(rdc) && /Pay as OT/.test(rdc));
ok("...only for a rest day with a closed stretch on it, once",
   /if \(shRO\.kind !== "rest_day"\) return err/.test(staff) && /closedRO\.length === 0\) return err/.test(staff) && /err\("already_decided"/.test(staff));
ok("...written as APPROVED, so it reaches the payroll like any approved overtime",
   /'ot_in', 'ceo:rest-day', \?2, 'approved', \?3/.test(staff) && /'ot_out', 'ceo:rest-day', \?4, 'approved', \?3/.test(staff)
   && /"ot\.rest_day_paid"/.test(staff));
ok("a day decided either way leaves the Rest days worked card",
   /FROM ot_records[\s\S]{0,400}?done\.add|done\.add[\s\S]{0,400}?FROM ot_records/.test(
     staff.slice(staff.indexOf('path === "/rest-day-work"'), staff.indexOf('path === "/rest-day-work"') + 4000)));
ok("the CEO can remove an overtime record - the whole day, whatever its status, with the trail saying what went",
   /path === "\/attendance\/ot\/remove" && method === "POST"[\s\S]{0,200}?if \(!\["ceo", "super_admin"\]\.includes\(user\.role\)\)/.test(staff)
   && /DELETE FROM ot_records WHERE user_id = \?1 AND date\(created_at, '\+8 hours'\) = \?2/.test(staff)
   && /"ot\.remove", "users", String\(uidR\), \{ date: dateR, rows: goneR \}/.test(staff));
ok("...from the Overtime rows, behind the house confirm, not window.confirm",
   /askPat\(\{[\s\S]{0,300}?Remove this overtime record\?[\s\S]{0,1200}?act\(`\/attendance\/ot\/remove`/.test(rp) && !/window\.confirm/.test(rp));
ok("an OT row with no minutes yet still shows its hours from the two punches, or says 'open'",
   /o\.open \? L\("open", "terbuka"\)/.test(rp));
ok("approved overtime reaches the payroll by itself",
   /WHERE status = 'approved' AND strftime\('%Y-%m', created_at, '\+8 hours'\) = \?1/.test(staff) && /ot_approved: otApproved/.test(staff)
   && /if \(cur && cur\.ot_hours === h\) continue;/.test(read("components/portal/payroll-panel.tsx")),
   "pending and rejected count for nothing - that is the point of the decision; the approved total is what the box shows (v1.159.2)");
ok("overtime is on the attendance register", /overtime: otRows/.test(staff) && /section === "ot"/.test(read("components/portal/role-panels.tsx")));
ok("only the CEO can amend it",
   /path === "\/attendance\/ot\/amend"[\s\S]{0,200}?if \(!\["ceo", "super_admin"\]\.includes\(user\.role\)\)/.test(staff)
   && /const canAmendOt = \["ceo", "super_admin"\]\.includes\(role\);/.test(read("components/portal/role-panels.tsx")));
ok("an amendment is written on the row and in the trail",
   /amended_by = \?2, amended_at = datetime\('now'\)/.test(staff) && /"ot\.amend"/.test(staff));
ok("a pattern has a category, and the three the CEO named are seeded",
   /const CATS = \["normal", "afternoon", "evening", "custom"\] as const;/.test(staff)
   && /category = 'afternoon'/.test(read("worker/migrations/0119_shift_categories_ot_amend.sql"))
   && /660, 1020, 660, 1020/.test(read("worker/migrations/0119_shift_categories_ot_amend.sql"))
   && /840, 1320, 840, 1320/.test(read("worker/migrations/0119_shift_categories_ot_amend.sql")));
ok("the pending list sums a day's stretches instead of last-out minus first-in",
   /minutes: sessionMinutes\(closed\), stretches: closed\.length/.test(staff));
ok("...and names the live session or task that vouches for it", /assigned: asg \? asg\.what : null/.test(staff));
ok("the desk sums the same way",
   /g\.mins \+= Math\.max\(0, Math\.round/.test(read("worker/src/desk.ts")));
ok("the punches endpoint ships today's shifts, every block",
   /today_shift = \{[\s\S]{0,200}?windows: shT\.windows\.map/.test(staff));

/* The phone. */
ok("the dashboard uses server session state, with the latest punch as legacy fallback",
   /const latestPunch = today\[0\]\?\.type \?\? null;/.test(dash) && /const openNow = todayShift\?\.entry\?\.clocked_in \?\? \(latestPunch === "clock_in"\);/.test(dash),
   "'a clock-in happened today' was true from 11:00 to midnight and made the evening shift unrecordable");
ok("Clock in is offered whenever nothing is open AND a shift is left, and never otherwise",
   /\{openNow \? \(/.test(dash) && /\) : canClockIn \? \(/.test(dash) && /Clock in · next shift/.test(dash)
   && /\{openNow \? \([\s\S]{0,400}?tr\("Clock out", lang\)/.test(dash),
   "on shift the one action is Clock out; the disabled twin is gone");
ok("the OT buttons are back, and disabled once the day's pair is done",
   /punchOt\("ot_in"\)/.test(dash) && /disabled=\{!!busy \|\| !hasOtIn \|\| hasOtOut\}/.test(dash));
ok("the card names today's shifts - pattern, roster and live board - and says the rule",
   /Today's shifts: \$\{todayShift\.slots_label \?\? todayShift\.label\}/.test(dash) && /Syif hari ini/.test(dash) && /sent to the CEO as overtime/.test(dash));
ok("a clock-out that produced overtime says so, in hours",
   /overtime sent for approval/.test(dash) && /OT dihantar untuk kelulusan/.test(dash));
ok("month hours are the sum of shifts, paired in order",
   /if \(x\.type === "clock_in"\) \{ if \(openAt === null\) openAt = x\.t; \}/.test(dash),
   "first-in-to-last-out would count the hours at home between shifts");
ok("the monitor reads 'in now' off the latest punch too",
   /last_type/.test(read("components/portal/attendance.tsx")) && /AS last_type/.test(staff));

console.log(`${failed ? "✗" : "✓"} clock-sessions: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
