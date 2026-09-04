/**
 * Staff Portal API (/api/v1/staff/*) — see 0003_staff_portal.sql
 * Mounted from index.ts after session resolution. All routes require auth.
 */

import type { Env } from "./index";
import { handleErp } from "./erp";
import { handleThreads } from "./threads";
import { logError as sharedLogError, postJournal, readVersions } from "./shared";
import { fillM2eTemplate, type M2eRow } from "./m2e";
import { createPasswordHash, primaryOrigin } from "./index";
import { sendPush, type PushKeys } from "./webpush";
import { shiftSalesSplit, type ShiftPunch, type ShiftOrder } from "./shift-sales";
import { pollElfiaOrders } from "./bridge"; // v1.37.0 — the "Pull now" button
import { skuKey } from "./bridge-core"; // v1.39.0 — ONE SKU normalisation, computed in JS and bound as a value (AUDIT M8)

import { Role, can } from "./permissions";

/** v1.6.0: VAPID keys, or null when push isn't configured (push simply off). */
function pushKeys(env: Env): PushKeys | null {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY || !env.VAPID_SUBJECT) return null;
  return { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT };
}

/** v1.6.0: fire a web-push to every device a user has registered. Best-effort;
    dead subscriptions (404/410) are pruned. Never throws. */
export async function pushToUser(env: Env, userId: number, title: string, body: string, ref?: string): Promise<void> {
  const keys = pushKeys(env);
  if (!keys) return;
  try {
    const { results } = await env.DB.prepare(
      `SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?1`,
    ).bind(userId).all<{ id: number; endpoint: string; p256dh: string; auth: string }>();
    for (const s of results) {
      const status = await sendPush(keys, s, { title, body, ref: ref ?? null, url: "/portal" });
      if (status === 404 || status === 410) {
        await env.DB.prepare(`DELETE FROM push_subscriptions WHERE id = ?1`).bind(s.id).run();
      }
    }
  } catch { /* push is best-effort; the in-app record is already saved */ }
}

export interface StaffUser {
  id: number;
  email: string;
  name: string;
  role: Role;
}

const POSTAGE_STATUSES = ["preparing", "shipped", "in_transit", "delivered", "returned"];
const BD_STATUSES = ["open", "pending", "kiv", "closed_won", "closed_lost"];

/** v1.8.0: "HH:MM" + n minutes → "HH:MM" (same day, clamped). */
function addMinutes(hhmm: string, mins: number): string {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) return hhmm;
  const total = Math.min(23 * 60 + 59, Number(m[1]) * 60 + Number(m[2]) + mins);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function stockStatus(stock: number): string {
  return stock === 0 ? "out_of_stock" : stock <= 5 ? "low" : "in_stock";
}

/** Company working shift (Malaysia time). Used to flag attendance events. */
/* v1.76.0 — the last resort, not the rule.
   Working hours are a SCHEDULE now (migration 0099): named patterns with a
   start and end per weekday, assigned to people with an effective date.
   These numbers survive only as the fallback for a database that has not
   applied 0099 yet, and as the shape the seeded Office pattern was built
   from. Nothing should read them directly - call shiftOn(). */
const SHIFT = {
  label: "10:00–18:00 MYT, Monday–Friday",
  startMinutes: 10 * 60,
  // Arriving after 12:00 counts the day as a half day (v1.4.38).
  halfDayMinutes: 12 * 60,
  endMinutes: 18 * 60,
} as const;

/** 8 hours, break included (CEO). The unit a partial unpaid day is measured
    against.

    MODULE SCOPE ON PURPOSE. This lived inside handleStaff, declared beside the
    payable-days helpers - about a hundred lines BELOW the /attendance/unpaid
    POST route that reads it. `const` does not hoist a value: the route entered
    its temporal dead zone and threw ReferenceError, so every click on a
    "no clock-in" chip came back as "Something went wrong". esbuild does not
    catch that; only running it does. Up here it is initialised before any
    request handler exists, and cannot be re-broken by moving a route. */
export const WORK_DAY_MINUTES = 8 * 60;

/** RM15.00/hour - the CEO's rule for part-time live hosts, one place to change.
    Module scope for the same reason as WORK_DAY_MINUTES: the public-holiday
    premium is computed in payslipExtras, which runs BEFORE the line inside
    handleStaff where this used to be declared. A const read before its
    declaration line has executed throws, and the guard that now catches that
    (worker-compile-gate, TS2448) would have refused the build. */
export const PART_TIME_LH_RATE_CENTS = 1500;

/** A part-time live host is paid by the clock, not by the month.
    MODULE SCOPE (v1.78.0) for the same reason as the constant above:
    /rest-day-work and /replacement-credit both ask this question, and both
    routes are dispatched hundreds of lines ABOVE where it used to be
    declared. A `const` read before its declaration line has run throws
    ReferenceError - the exact 500 the CEO hit twice on 31-08 - and
    worker-compile-gate now refuses the build for it (TS2448). */
export const isHourlyUser = (role: string | null | undefined, emp: string | null | undefined) =>
  role === "live_host" && emp === "part_time";

/** WHO COUNTS AS STAFF — v1.78.0.
 *
 * CEO, 31-08-2026: *"Take note, super_Admin is not a staff. Super_admin is
 * system controller which is handling everything about the system."*
 *
 * He was reading the payroll screen, where "Days with no clock-in" opened
 * with a SUPER ADMIN block listing nineteen absent days. The system account
 * had been quietly acquiring an attendance record, an absence history and a
 * place in every staff list, because those queries asked for
 * `role != 'customer'` - everyone who is not a shopper - rather than for
 * employees. The payroll and M2E queries already knew better and said
 * `NOT IN ('customer', 'super_admin')`; the attendance ones did not, so the
 * two halves of the same screen disagreed about who works here.
 *
 * One predicate now, for every list of PEOPLE THE COMPANY EMPLOYS. It does
 * not change who can DO anything - super_admin keeps every permission,
 * because controlling the system is the job. It changes who the system
 * counts, pays, rosters and chases for a missing punch. */
export const staffRolesSql = (alias = "") =>
  `${alias}role NOT IN ('customer', 'super_admin')`;

/** THE SAME STAFF ORDER AS THE SCREEN, in SQL — v1.78.0.
 *
 * CEO, 31-08-2026: *"payroll should ascending with position which is CEO,
 * COO, CCO, HR_admin, Sales Executive, Sales Marketing, Marketing Designer
 * and lastly Live host and Part time last host."*
 *
 * The browser sorts with `bySeniority` from lib/staff-order.ts. The worker
 * cannot import that module (separate bundle, separate tsconfig), so the
 * ranks are written out once here and tests/staff-order.mjs holds the two to
 * the same numbers. Getting this wrong is not cosmetic: the M2E salary file
 * pays people in the order its rows appear, so a file whose order disagrees
 * with the screen is a file nobody can check against the screen.
 *
 * Assumes the users table is aliased `u` - every payroll query joins it that
 * way, and the guard checks each call site.
 */
/** The subset of a month's working days a person was actually employed for.
    Equal to the whole list for anybody who did not join or leave inside the
    month - which is why nobody else is ever prorated.

    MODULE SCOPE (v1.84.0), for the same reason as WORK_DAY_MINUTES before it.
    It was a `const` a few thousand lines inside `handleStaff`, and the new
    verification report sits ABOVE that line: a temporal-dead-zone
    ReferenceError at runtime, on a route that had passed esbuild without a
    murmur. tsc caught it (TS2448), which is why the compile gate treats that
    code as fatal rather than as a strict-mode warning. */
export function employedDays(
  days: string[], joined?: string | null, left?: string | null, rejoined?: string | null,
): string[] {
  return days.filter((d) => {
    if (joined && d < joined.slice(0, 10)) return false;
    /* v1.77.0 - RE-JOINERS. This read only joined_on and left_on, so somebody
       who resigned and came back was still "gone" from the day they first
       left: every working day after it was prorated away as an incomplete
       month, silently, for as long as the old left_on sat in their record.
       `rejoined_on` has existed as a field since v1.4.101 and the staff list
       already honours it; the money did not. After the re-join date they are
       employed again. */
    if (left && d > left.slice(0, 10)) {
      return Boolean(rejoined && d >= rejoined.slice(0, 10));
    }
    return true;
  });
}

/** STILL ON STAFF TODAY — v1.87.0.
 *
 * CEO, 03-09-2026: *"If staff already resigned after that day, the day after
 * it no more listed the staff on task, payroll after their payroll released
 * and etc except staff tabs which is for recording purposes."*
 *
 * Offboarding sets `left_on` and kills every session, but DELIBERATELY leaves
 * `is_active = 1` — flipping it would drop the leaver from their own final
 * payroll run and they would not be paid for their last month. The cost of
 * that decision was never paid down: a leaver stayed in every staff list
 * forever, so months later they were still an option in the task assignee
 * dropdown, still counted in "staff total", still offered a shift.
 *
 * This is the missing half. `is_active` still says "the account exists";
 * THIS says "they work here today", which is what a people-picker means.
 *
 * THE LAST DAY IS A WORKING DAY. `left_on` is the last paid day - the
 * offboard dialog says so - so somebody leaving on the 30th is on staff on
 * the 30th and gone on the 1st. `>=`, not `>`.
 *
 * A RE-JOINER IS BACK. `rejoined_on` has meant that since v1.4.101 and the
 * payroll honours it; a list that did not would hide somebody who is sitting
 * in the office.
 *
 * NOT FOR PAYROLL, and not for the staff record. Payroll asks a different
 * question - "were they employed in THIS month" - which `employedDays` and
 * `payrollMonthStaffSql` answer. The Staff tab asks none of this: it is the
 * record, and a record you cannot look up is not a record. */
export const currentStaffSql = (alias = "") =>
  `(${alias}left_on IS NULL
     OR ${alias}left_on >= date('now', '+8 hours')
     OR (${alias}rejoined_on IS NOT NULL AND ${alias}rejoined_on <= date('now', '+8 hours')))`;

/** EMPLOYED IN A GIVEN PAYROLL MONTH — v1.87.0.
 *
 * The CEO's own exception: *"payroll after their payroll released"*. A leaver
 * must stay on the payroll of every month they actually worked, which is what
 * pays their final salary; once the run moves past that month they are gone
 * from it. Bound to ?1 = the month being processed, YYYY-MM.
 *
 * Deliberately NOT keyed on whether the payslip was released: a released
 * month still gets recomputed, reprinted and queried, and a person vanishing
 * from a month they were paid for is a payslip nobody can reproduce. */
export function payrollMonthStaffSql(month: string, alias = ""): string {
  /* THE MONTH IS SPLICED IN, NOT BOUND. Every caller sits in a query with its
     own ?1..?n numbering, and threading one more parameter through each would
     be renumbering by hand in a dozen places - which is how a bind ends up on
     the wrong placeholder and a payroll query silently answers about the
     wrong thing. Splicing is only safe because the value is checked HERE,
     against the same shape every route already validates, and throws rather
     than passing anything else through. */
  if (!/^\d{4}-\d{2}$/.test(month)) {
    throw new Error(`payrollMonthStaffSql: month must be YYYY-MM, got ${JSON.stringify(month)}`);
  }
  return `(${alias}left_on IS NULL
     OR substr(${alias}left_on, 1, 7) >= '${month}'
     OR (${alias}rejoined_on IS NOT NULL AND substr(${alias}rejoined_on, 1, 7) <= '${month}'))`;
}

export const STAFF_ORDER_SQL = `
  (CASE u.role
     WHEN 'ceo' THEN 10 WHEN 'coo' THEN 20 WHEN 'cco' THEN 30
     WHEN 'hr_admin' THEN 40 WHEN 'sales_marketing' THEN 50
     WHEN 'admin' THEN 55 WHEN 'marketing' THEN 60
     WHEN 'editor' THEN 70 WHEN 'live_host' THEN 80 ELSE 90 END
   + CASE WHEN u.employment_status = 'part_time' THEN 5 ELSE 0 END) * 10
  + CASE
      WHEN LOWER(COALESCE(u.position, '')) LIKE '%sales%'  THEN 1
      WHEN LOWER(COALESCE(u.position, '')) LIKE '%design%' THEN 3
      ELSE 2 END,
  COALESCE(NULLIF(TRIM(u.full_name), ''), u.name)`;

/** A block of scheduled time, minutes from midnight MYT. */
export interface ShiftWindow { start: number; end: number }

/** One person's hours on one date: NULL start = not a working day for them.
 *
 * v1.80.0 — A DAY IS NOW A LIST OF BLOCKS. The CEO: *"require 8 hours, 11:00am
 * to 5:00pm then continue work at 8:30pm to 10:30pm"*. `start` and `end` stay,
 * and stay meaning the FIRST block, so every caller written against 0099 keeps
 * giving the answer it always gave for the single-block days that are still
 * the overwhelming majority. Anything that must be right about a split day
 * reads `windows` instead — and the helpers below (`windowAt`, `lateAgainst`,
 * `endOfDay`, `scheduledMinutes`) exist so that it is easier to be right than
 * to reach for `start` and be subtly wrong at 20:30. */
export interface DayShift {
  start: number | null;
  end: number | null;
  halfDay: number;
  /** workday | rest_day — the person's OWN week, not an assumption about Sat/Sun. */
  kind: "workday" | "rest_day";
  pattern: string;
  /** Every scheduled block of the day, in order. Empty on a rest day. */
  windows: ShiftWindow[];
  /** v1.81.0 - unpaid break, in minutes, from the pattern (0103). */
  breakMinutes: number;
}

/** THE STATUTORY TRIGGER for an unpaid break - Employment Act 1955
    s.60A(1)(a): no employee shall work more than five consecutive hours
    without a period of leisure of not less than thirty minutes. */
const BREAK_AFTER_MINUTES = 5 * 60;

/** The break this day actually earns. ONCE, and only if a block runs past
    five hours: a six-hour afternoon earns it, and the two-hour evening block
    beside it does not earn a second one. A short day earns none - there is
    nothing to break. */
export function breakFor(sh: DayShift): number {
  if (sh.breakMinutes <= 0) return 0;
  return sh.windows.some((w) => w.end - w.start > BREAK_AFTER_MINUTES) ? sh.breakMinutes : 0;
}

/** WHAT THE DAY IS ACTUALLY OWED - v1.81.0.
 *
 * The CEO, on a short-day chip reading 4.98h/8h: *"this one should exclude of
 * lunch time of 1 hour."* An office day of 10:00-18:00 is eight hours on the
 * clock and seven hours of work. `scheduledMinutes` is the elapsed schedule
 * and stays that, because that is what the register prints; this is the
 * number anybody is measured against. */
export function workMinutes(sh: DayShift): number {
  return Math.max(0, scheduledMinutes(sh) - breakFor(sh));
}

/** The block a moment falls in, or null if it falls in none of them.
    A generous edge: a punch AT the closing minute is still inside. */
export function windowAt(sh: DayShift, minutes: number): ShiftWindow | null {
  return sh.windows.find((w) => minutes >= w.start && minutes <= w.end) ?? null;
}

/** The start a clock-in should be judged against.
 *
 * NOT `sh.start`. Somebody whose day is 11:00-17:00 and 20:30-22:30 arriving
 * for the evening block at 20:28 is EARLY, and measuring him against 11:00
 * called him five hundred minutes late and then, because that is past the
 * half-day threshold, docked him half a day. The rule: the block he is in, or
 * if he is between blocks, the next one he is turning up for. */
export function lateAgainst(sh: DayShift, minutes: number): number | null {
  const inside = windowAt(sh, minutes);
  if (inside) return inside.start;
  const next = sh.windows.find((w) => w.start > minutes);
  if (next) return next.start;
  // After every block: judged against the last one he was due at.
  return sh.windows.length ? sh.windows[sh.windows.length - 1]!.start : sh.start;
}

/** When the day is over — the END OF THE LAST BLOCK, which is what an
    early-out means. Against `sh.end` (17:00) a host who worked the evening
    and left at 22:30 was "on time" while one who left at 17:05 was too. */
export function endOfDay(sh: DayShift): number | null {
  return sh.windows.length ? sh.windows[sh.windows.length - 1]!.end : sh.end;
}

/** Total scheduled minutes across every block. 11:00-17:00 + 20:30-22:30 = 480,
    which is the eight hours the CEO is counting. */
export function scheduledMinutes(sh: DayShift): number {
  return sh.windows.reduce((n, w) => n + Math.max(0, w.end - w.start), 0);
}

/** How much of a span [from, to] falls INSIDE the scheduled blocks.
 *
 * The CEO chose one clock-in and one clock-out for a split day, so a host
 * punches in at 11:00 and out at 22:30 and the 17:00-20:30 he spends at home
 * is inside that span. Counting the span itself pays eleven and a half hours
 * for an eight-hour day; counting the overlap pays eight. */
export function minutesInWindows(sh: DayShift, from: number, to: number): number {
  if (to <= from) return 0;
  if (sh.windows.length === 0) return 0;
  return sh.windows.reduce(
    (n, w) => n + Math.max(0, Math.min(to, w.end) - Math.max(from, w.start)),
    0,
  );
}

/** A day printed the way it is worked: "11:00-17:00 + 20:30-22:30". */
export function shiftLabel(sh: DayShift): string {
  if (sh.windows.length === 0) return sh.pattern;
  return sh.windows.map((w) => `${hhmm(w.start)}-${hhmm(w.end)}`).join(" + ");
}

const DOW_COL = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

/** The last-resort hours for a weekday, when no pattern can be read at all
    (a database that has not applied 0099, or one with no patterns in it). */
function shiftFallback(dow: number): DayShift {
  const weekday = dow >= 1 && dow <= 5;
  return {
    start: weekday ? SHIFT.startMinutes : null,
    end: weekday ? SHIFT.endMinutes : null,
    halfDay: SHIFT.halfDayMinutes,
    kind: weekday ? "workday" : "rest_day",
    pattern: SHIFT.label,
    windows: weekday ? [{ start: SHIFT.startMinutes, end: SHIFT.endMinutes }] : [],
    /* The same hour the seeded office pattern carries, so a database that
       cannot be read at all still measures a day the way the company does. */
    breakMinutes: 60,
  };
}

/** What one pattern row MEANS for one weekday. Both the single lookup and the
    batch resolver go through here, so they cannot come to different answers
    about the same row - in particular about a blank start being a rest day. */
function dayShiftFrom(
  row: {
    name: string; half_day_minutes: number | null;
    s: number | null; e: number | null;
    /** v1.80.0 - the optional second block. Absent on a pre-0102 database,
        which reads as a day with one block, exactly as before. */
    s2?: number | null; e2?: number | null;
    /** v1.81.0 - absent on a pre-0103 database, where NO break was deducted
        from anybody: `?? 0` keeps that database behaving as it did rather
        than inventing an hour the schedule never said. */
    brk?: number | null;
  },
): DayShift {
  /* A block needs BOTH ends to exist. A start with no end is a half-typed
     row, and guessing an end for it would put scheduled hours on the payroll
     that nobody entered. */
  const windows: ShiftWindow[] = [];
  if (row.s !== null && row.s !== undefined && row.e !== null && row.e !== undefined) {
    windows.push({ start: row.s, end: row.e });
  }
  if (row.s2 !== null && row.s2 !== undefined && row.e2 !== null && row.e2 !== undefined) {
    windows.push({ start: row.s2, end: row.e2 });
  }
  windows.sort((a, b) => a.start - b.start);
  return {
    start: row.s ?? null,
    end: row.e ?? null,
    halfDay: row.half_day_minutes ?? SHIFT.halfDayMinutes,
    /* REST DAY IS STILL "NO FIRST BLOCK", not "no windows at all": a row with
       only a second block is malformed rather than a rest day, and the editor
       cannot produce one. Keeping the original test means 0099 behaviour is
       bit-for-bit unchanged on every existing pattern. */
    kind: row.s === null || row.s === undefined ? "rest_day" : "workday",
    pattern: row.name,
    windows,
    breakMinutes: row.brk ?? 0,
  };
}

/** The pattern in force for a person on a date, and what it says about that
    weekday. Falls back: their assignment -> the default pattern -> SHIFT.

    TWO QUERIES PER CALL. That is fine for a single lookup - classifying one
    punch - and ruinous in a loop. Anything iterating over people or dates
    must use `shiftResolver` instead; see the note there. */
export async function shiftOn(env: Env, userId: number, iso: string): Promise<DayShift> {
  const dow = new Date(`${iso}T00:00:00Z`).getUTCDay();
  const col = DOW_COL[dow]!;
  const fallback = (): DayShift => shiftFallback(dow);
  type Row = { name: string; half_day_minutes: number; s: number | null; e: number | null; s2?: number | null; e2?: number | null; brk?: number | null };
  /* v1.80.0 — THE DEPLOY WINDOW. The worker publishes BEFORE the migrations
     run, so for a few minutes this code asks a database that has no
     `mon_start2` for `mon_start2`. Naming the columns explicitly (which
     `shiftResolver` does not - it uses SELECT *) makes that a hard error, and
     the catch below would have swallowed it into the 10:00-18:00 constant:
     every punch in that window flagged against hours nobody works, on the one
     path that classifies a LIVE clock-in. So the second block is asked for
     separately, and a database that cannot answer simply gets the one-block
     reading it had before - the correct answer for it. */
  const withBlocks = async (two: boolean): Promise<Row | null> => {
    /* 0102 and 0103 land together, so one flag covers both: a database that
       cannot answer for the second block cannot answer for the break either,
       and both absences mean the same thing - read it the old way. */
    const cols2 = two ? `, p.${col}_start2 AS s2, p.${col}_end2 AS e2, p.break_minutes AS brk` : "";
    const dcols2 = two ? `, ${col}_start2 AS s2, ${col}_end2 AS e2, break_minutes AS brk` : "";
    /* The assignment that had started by this date, newest first. A change
       made in March cannot alter what January was flagged against. */
    const row = await env.DB.prepare(
      `SELECT p.name, p.half_day_minutes, p.${col}_start AS s, p.${col}_end AS e${cols2}
         FROM staff_shifts a JOIN shift_patterns p ON p.id = a.pattern_id
        WHERE a.user_id = ?1 AND a.effective_from <= ?2
        ORDER BY a.effective_from DESC, a.id DESC LIMIT 1`,
    ).bind(userId, iso).first<Row>();
    return row ?? await env.DB.prepare(
      `SELECT name, half_day_minutes, ${col}_start AS s, ${col}_end AS e${dcols2}
         FROM shift_patterns WHERE is_default = 1 LIMIT 1`,
    ).first<Row>();
  };
  try {
    let use: Row | null;
    try {
      use = await withBlocks(true);
    } catch (e2) {
      if (!String(e2).includes("no such column")) throw e2;
      use = await withBlocks(false); // pre-0102: one block, as it always was
    }
    if (!use) return fallback();
    return dayShiftFrom(use);
  } catch {
    return fallback(); // pre-0099
  }
}

/** One person's hours on one date, answered WITHOUT touching the database. */
export type ShiftLookup = (userId: number, iso: string) => DayShift;

/** v1.77.0 - THE WHOLE SCHEDULE, READ ONCE.
 *
 * The Payroll tab took the better part of a minute to show anything and then
 * said "0 staff". The absence scan was calling `shiftOn` inside two nested
 * loops - every person, every day of the month - and each call is two remote
 * D1 queries, awaited one after another. Nine people over August is roughly
 * five hundred sequential round trips before the page could render a row.
 * The attendance export was worse: two queries per PUNCH.
 *
 * Nothing about the data justified that. There are a handful of patterns and
 * one assignment row per person per change; the entire schedule of the
 * company fits in two queries and a few kilobytes. So it is read once, and
 * every lookup after that is a comparison in memory.
 *
 * The rule this encodes: **a shift lookup inside a loop must come from here.**
 * `shiftOn` stays for the single-punch classifier, where two queries is two
 * queries. Guard #24 fails the build if a loop reaches for it again.
 */
export async function shiftResolver(env: Env): Promise<ShiftLookup> {
  interface Pat {
    id: number; name: string; half_day_minutes: number | null; is_default: number;
    [col: string]: number | string | null;
  }
  let pats: Pat[] = [];
  let assigns: { user_id: number; pattern_id: number; effective_from: string }[] = [];
  try {
    pats = (await env.DB.prepare(`SELECT * FROM shift_patterns`).all<Pat>()).results ?? [];
    /* Newest first, so the first assignment at or before a date wins - the
       same "latest that had started" rule as the single-row query, kept as a
       sort rather than a second SQL ORDER BY that could drift from it. */
    assigns = ((await env.DB.prepare(
      `SELECT user_id, pattern_id, effective_from FROM staff_shifts`,
    ).all<{ user_id: number; pattern_id: number; effective_from: string }>()).results ?? [])
      .sort((a, b) => b.effective_from.localeCompare(a.effective_from));
  } catch {
    return (_u, iso) => shiftFallback(new Date(`${iso}T00:00:00Z`).getUTCDay()); // pre-0099
  }
  const byId = new Map(pats.map((p) => [p.id, p]));
  const def = pats.find((p) => p.is_default === 1) ?? null;
  const mine = new Map<number, typeof assigns>();
  for (const a of assigns) {
    const list = mine.get(a.user_id);
    if (list) list.push(a);
    else mine.set(a.user_id, [a]);
  }
  return (userId, iso) => {
    const dow = new Date(`${iso}T00:00:00Z`).getUTCDay();
    const col = DOW_COL[dow]!;
    const a = mine.get(userId)?.find((x) => x.effective_from <= iso);
    const p = (a ? byId.get(a.pattern_id) : null) ?? def;
    if (!p) return shiftFallback(dow);
    /* `SELECT *` already carries the 0102 columns, so this needs no second
       query - and on a database that has not applied 0102 the keys are simply
       absent, which `dayShiftFrom` reads as "one block", the old behaviour. */
    return dayShiftFrom({
      name: p.name,
      half_day_minutes: p.half_day_minutes,
      s: (p[`${col}_start`] as number | null) ?? null,
      e: (p[`${col}_end`] as number | null) ?? null,
      s2: (p[`${col}_start2`] as number | null) ?? null,
      e2: (p[`${col}_end2`] as number | null) ?? null,
      brk: (p.break_minutes as number | null) ?? null,
    });
  };
}

/** What somebody was ASSIGNED to be doing at a moment, when their schedule
    says nothing. */
export interface AssignedAt {
  /** "live" | "task" - what kind of commitment covered the punch. */
  kind: "live" | "task";
  /** Shown to the CEO on the register: the client, or the task title. */
  what: string;
  start: number;
  end: number;
}

/** One person, one date, one moment -> the commitment covering it, if any. */
export type AssignedLookup = (userId: number, iso: string, minutes: number) => AssignedAt | null;

/** v1.80.0 - WORK THE SCHEDULE DOES NOT KNOW ABOUT.
 *
 * The CEO, 02-09-2026: *"If user clock in after working hour need to check if
 * their task is assigned to work at 8pm above? if yes, then it is consider
 * their working time."*
 *
 * A pattern is a normal week. Evening work that is not part of anybody normal
 * week still happens - a client books a 21:00 broadcast, a shoot runs late -
 * and until now a punch at 21:00 was measured against a shift that ended at
 * 17:00 and came back "late" by four hours, or "outside working hours" on a
 * rest day. Both readings are wrong about somebody who was told to be there.
 *
 * TWO SOURCES, BECAUSE THE COMPANY SCHEDULES WORK IN TWO PLACES:
 *   live_sessions - a host, a client, a slot. The evening broadcast.
 *   task_blocks   - the roster board (0095). A task with a time on a day.
 * A cancelled live session covers nothing: it was called off, so turning up
 * for it is not assigned work.
 *
 * READ ONCE, LIKE THE SCHEDULE. Same reasoning as `shiftResolver` and the
 * same rule: this is called inside loops over a month of punches, and two
 * queries per punch is what made the Payroll tab unusable in v1.76.
 *
 * A block with no end time is treated as covering THREE HOURS from its start.
 * `task_blocks.end_time` is nullable and often blank, and the alternative -
 * treating it as covering nothing - would mean the roster silently stops
 * vouching for exactly the evening work this exists to vouch for. Three hours
 * is a shift-length guess, deliberately not open-ended: a 14:00 block must not
 * still be covering a punch at midnight.
 */
const OPEN_BLOCK_MINUTES = 180;

export async function assignedResolver(env: Env, fromIso: string, toIso: string): Promise<AssignedLookup> {
  const hm = (t: string | null | undefined): number | null => {
    const m = /^(\d{1,2}):(\d{2})/.exec(String(t ?? ""));
    if (!m) return null;
    return Number(m[1]) * 60 + Number(m[2]);
  };
  /** user -> date -> commitments on that date */
  const by = new Map<string, AssignedAt[]>();
  const add = (userId: number, iso: string, a: AssignedAt) => {
    const k = `${userId}|${iso}`;
    const list = by.get(k);
    if (list) list.push(a);
    else by.set(k, [a]);
  };
  try {
    const { results } = await env.DB.prepare(
      `SELECT host_user_id AS uid, session_date AS d, start_time AS st, end_time AS en,
              COALESCE(NULLIF(client_name, ''), 'Live session') AS what
         FROM live_sessions
        WHERE session_date BETWEEN ?1 AND ?2 AND status != 'cancelled'`,
    ).bind(fromIso, toIso).all<{ uid: number; d: string; st: string; en: string | null; what: string }>();
    for (const r of results ?? []) {
      const st = hm(r.st);
      if (st === null) continue;
      add(r.uid, r.d, { kind: "live", what: r.what, start: st, end: hm(r.en) ?? st + OPEN_BLOCK_MINUTES });
    }
  } catch { /* pre-live_sessions */ }
  try {
    const { results } = await env.DB.prepare(
      `SELECT b.user_id AS uid, b.block_date AS d, b.start_time AS st, b.end_time AS en,
              COALESCE(t.title, 'Assigned task') AS what
         FROM task_blocks b LEFT JOIN tasks t ON t.id = b.task_id
        WHERE b.block_date BETWEEN ?1 AND ?2`,
    ).bind(fromIso, toIso).all<{ uid: number; d: string; st: string; en: string | null; what: string }>();
    for (const r of results ?? []) {
      const st = hm(r.st);
      if (st === null) continue;
      add(r.uid, r.d, { kind: "task", what: r.what, start: st, end: hm(r.en) ?? st + OPEN_BLOCK_MINUTES });
    }
  } catch { /* pre-0095 */ }
  return (userId, iso, minutes) =>
    by.get(`${userId}|${iso}`)?.find((a) => minutes >= a.start && minutes <= a.end) ?? null;
}

/** Every person's shift for one date, in one pass - for the register, the
    monitor and any report that would otherwise ask per row. */
export async function shiftsOn(env: Env, iso: string): Promise<Map<number, DayShift>> {
  const out = new Map<number, DayShift>();
  try {
    const at = await shiftResolver(env);
    const { results } = await env.DB.prepare(
      `SELECT id FROM users WHERE ${staffRolesSql()} AND is_active = 1 AND ${currentStaffSql()}`,
    ).all<{ id: number }>();
    for (const u of results) out.set(u.id, at(u.id, iso));
  } catch { /* fallback handled per call */ }
  return out;
}

/** v1.76.0 — "AND this punch is not waiting for approval", or nothing at all
    on a database that has not applied 0100 yet.

    A pending punch is a CLAIM. It is stored so the day is not lost, and it is
    counted by nothing - not hours, not days worked, not the payroll scan -
    until the CEO approves it. Five queries need that condition, so it is
    resolved once per request rather than wrapped in five fallbacks. */
let pendingColKnown: boolean | null = null;
export async function notPendingSql(env: Env, alias = ""): Promise<string> {
  if (pendingColKnown === null) {
    try {
      await env.DB.prepare(`SELECT pending_approval FROM attendance_records LIMIT 1`).first();
      pendingColKnown = true;
    } catch { pendingColKnown = false; }
  }
  return pendingColKnown ? ` AND COALESCE(${alias}pending_approval, 0) != 1` : "";
}

/** hh:mm from minutes-since-midnight, for a message a human reads. */
export function hhmm(mins: number | null | undefined): string {
  if (mins === null || mins === undefined) return "-";
  return `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
}



/* ---------------- helpers ---------------- */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
function err(code: string, message: string, status: number): Response {
  return json({ error: { code, message } }, status);
}
function str(v: unknown, max = 2000): v is string {
  return typeof v === "string" && v.trim().length > 0 && v.length <= max;
}

/* v1.9.1 — office geofence for clock in/out (replaces the selfie step).
   One system_meta row holds the office point + radius; the punch route
   refuses punches taken outside it. Honest limitation, stated to the CEO:
   browser GPS comes from the client and can be spoofed by a determined
   user with dev tools — this stops casual "clock in from bed", it is not
   forensic proof of presence. The IP + user-agent already stored on every
   punch remain the cross-check. */
const GEOFENCE_KEY = "attendance_geofence";
const GEOFENCE_ADMIN_ROLES = ["super_admin", "ceo", "coo"];

interface Geofence { lat: number; lng: number; radius_m: number; label: string }

async function getGeofence(env: Env): Promise<Geofence | null> {
  try {
    const row = await env.DB.prepare(`SELECT value FROM system_meta WHERE key = ?1`)
      .bind(GEOFENCE_KEY).first<{ value: string }>();
    if (!row) return null;
    const g = JSON.parse(row.value) as Partial<Geofence>;
    if (typeof g.lat !== "number" || typeof g.lng !== "number" || typeof g.radius_m !== "number") return null;
    return { lat: g.lat, lng: g.lng, radius_m: g.radius_m, label: typeof g.label === "string" && g.label ? g.label : "the office" };
  } catch { return null; } // pre-0057 (no system_meta) — geofence simply off
}

/** Great-circle distance in metres (haversine — plenty for a 100 m fence). */
function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLng = (lng2 - lng1) * rad;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/* One gate used by BOTH the clock punch and the OT punch (review finding:
   gating only clock in/out left OT — the PAID punches — open to a sofa).
   When a fence is configured, body.gps must be present and valid — the
   location itself is REQUIRED (that is the anti-cheating rule), but being
   OUTSIDE the fence no longer refuses the punch.

   v1.21.0 (CEO chose "allow but flag"): a punch outside radius +
   min(acc, 150) m grace is RECORDED, and management views mark it red as
   "outside office". Nobody is ever locked out by fuzzy GPS; HR reviews the
   flags instead. CEO/COO/CCO are exempt from the flag (their location is
   still captured and shown). The flag itself is computed at READ time from
   the stored gps against the current fence — no schema change, and moving
   the office retro-corrects every historical flag. */
async function gateGeofence(
  env: Env, body: Record<string, unknown> | null, verb: string,
): Promise<{ resp: Response; gps?: undefined; noLocation?: undefined } | { resp?: undefined; gps: string | null; noLocation?: string }> {
  const gpsRaw = str(body?.gps, 100) ? (body!.gps as string).trim() : null;
  /* v1.21.4 (CEO: "still appear that the location is not capture which is
     it is incorrect flow data system requirement"): location is required on
     EVERY punch, fence configured or not. Before, a database that hadn't
     run migration 0072 yet silently accepted location-less punches — the
     exact "no location" rows he saw. The fence now only decides FLAGGING;
     the location requirement itself no longer depends on it. */
  const gm = gpsRaw ? /^(-?\d{1,2}(?:\.\d+)?),\s*(-?\d{1,3}(?:\.\d+)?)(?:,\s*(\d+(?:\.\d+)?))?$/.exec(gpsRaw) : null;
  const plat = gm ? Number(gm[1]) : NaN;
  const plng = gm ? Number(gm[2]) : NaN;
  if (!gm || plat < -90 || plat > 90 || plng < -180 || plng > 180) {
    /* v1.25.3 (CEO's decision after a staff member's Samsung Browser stuck
       its site permission on "blocked" and she could not clock in at all):
       an attendance record is worth more than a perfect one. The punch is
       ACCEPTED but marked NO LOCATION so it stands out in the register and
       HR is told — attendance is never lost, and the exception is loud.
       The client must say WHY it has no fix; a punch with no explanation at
       all is still refused, so this cannot become a silent bypass. */
    const why = str(body?.no_location_reason, 40) ? String(body!.no_location_reason) : null;
    if (!why || !["denied", "timeout", "unavailable", "unsupported"].includes(why)) {
      return { resp: err("location_required", `Location is required to ${verb} — allow location access in your browser and try again.`, 400) };
    }
    return { gps: null, noLocation: why };
  }
  return { gps: gpsRaw };
}

export async function notify(
  env: Env, userId: number, kind: string, message: string, ref?: string,
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO notifications (user_id, kind, message, ref) VALUES (?1, ?2, ?3, ?4)`,
  ).bind(userId, kind, message, ref ?? null).run();

  // v1.6.0: web-push to the person's devices (best-effort, off when no VAPID).
  // v1.27.0: this one string is the title on every staff lock screen, for all
  // ~20 notification kinds — the portal is A2Z CREATIVE MARKETING's.
  await pushToUser(env, userId, "A2Z CREATIVE MARKETING", message, ref);

  // Off-platform delivery (email / WhatsApp relay). Only fires when a webhook
  // is configured; otherwise this is a no-op and notifications stay in-app.
  // The relay decides the channel; we just hand it who + what.
  const hook = (env as unknown as { NOTIFY_WEBHOOK?: string }).NOTIFY_WEBHOOK;
  if (hook) {
    try {
      const target = await env.DB.prepare(
        `SELECT email, phone, name FROM users WHERE id = ?1`,
      ).bind(userId).first<{ email: string; phone: string | null; name: string }>();
      if (target) {
        // Fire-and-forget: a slow relay must never block the request.
        await fetch(hook, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind, message, ref, to: target }),
        }).catch(() => {});
      }
    } catch {
      /* delivery is best-effort; in-app record already saved */
    }
  }
}

async function audit(
  env: Env, userId: number, action: string, entity?: string, entityId?: string,
  detail?: Record<string, unknown>,
): Promise<void> {
  // detail lands in audit_log.detail as JSON — quantities, roles, reasons.
  // Never fatal (v1.4.69): the trail records actions, it must not break them.
  try {
    await env.DB.prepare(
      `INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?1, ?2, ?3, ?4, ?5)`,
    ).bind(userId, action, entity ?? null, entityId ?? null,
           detail ? JSON.stringify(detail) : null).run();
  } catch (e) {
    console.error("audit write failed:", action, e);
    // v1.4.72: surface it in the error log too (table has no FKs; guarded).
    try {
      await env.DB.prepare(
        `INSERT INTO error_log (source, message) VALUES ('audit', ?1)`,
      ).bind(`${action}: ${e instanceof Error ? e.message : String(e)}`.slice(0, 500)).run();
    } catch { /* pre-0024 or DB down — console above is the fallback */ }
  }
}

/** v1.4.114: non-fatal error-log writer for this module.
    v1.18.0 (CODE-AUDIT item 1): this copy was a bare INSERT while index.ts
    carried the v1.5.0 six-hour dedupe — and THIS is the copy the whole portal
    API calls, so recurring conditions still bell-spammed management and
    evicted real errors from the 500-row window. Now delegates to the shared
    deduped writer; the 10 call sites are unchanged. */
async function logError(env: Env, source: string, message: string): Promise<void> {
  return sharedLogError(env, source, message);
}

/* v1.19.0 (consolidation C2) — ONE ringgit, one bank row. When money
   actually moves (expense marked paid, payroll bank run recorded, claim paid
   out), the matching bank-movement row is created HERE, automatically and
   idempotently — the `ref` is unique per event, so re-toggling "paid" can
   never write a second row. Pre-0071 DBs (no cashflow_entries table) no-op
   silently: the legacy flows must never break on an unmigrated database. */
async function recordBankMovement(
  env: Env, userId: number, ref: string, amountCents: number, category: string, description: string,
  direction: "in" | "out" = "out",
): Promise<void> {
  if (amountCents <= 0) return;
  try {
    const dup = await env.DB.prepare(`SELECT id FROM cashflow_entries WHERE ref = ?1 LIMIT 1`)
      .bind(ref).first<{ id: number }>();
    if (dup) return;
    await env.DB.prepare(
      `INSERT INTO cashflow_entries (entry_date, type, category, amount_cents, description, ref, created_by)
       VALUES (date('now', '+8 hours'), ?6, ?1, ?2, ?3, ?4, ?5)`,
    ).bind(category, amountCents, description.slice(0, 200), ref, userId, direction).run();
    // v1.20.0 C5: the movement drafts its journal entry — same ref, same
    // idempotency, so the books can never double-post.
    // v1.21.0: money-in joined (paid invoices, channel settlements) — the
    // CEO's "cash flow must sync with Finance, semi-automation not manual".
    await postJournal(env, userId, ref, description, category, amountCents, direction);
  } catch { /* pre-0071 — Finance bank section simply not in use yet */ }
}

const LEAVE_TYPES = ["annual", "medical", "emergency", "unpaid", "replacement"] as const;
const DEFAULT_ENTITLEMENT: Record<string, number> = { annual: 14, medical: 14, emergency: 3, replacement: 0, unpaid: 0 };

/* v1.62.0 — ONE definition of "how many days is this person eligible for".
 *
 * It was written out twice: once in /leave/balance for the Leave tab and
 * once in payslipExtras for the payslip. Two copies of a rule that decides
 * pay is two chances to disagree, and adding the CEO's adjustment would have
 * meant remembering both. They now call this.
 *
 * The rules, unchanged except for the adjustment:
 *   - Annual and emergency accrue pro-rata across the months the company
 *     operates in the year (AZ ONE started July 2026, so 2026 divides across
 *     Jul–Dec). Half-day steps, rounded DOWN — never round in the staff
 *     member's favour by accident.
 *   - Medical and unpaid are never pro-rated. Medical is statutory and
 *     available in full from day one; unpaid costs the company nothing.
 *   - `adjust` (migration 0091) rides on top of the accrued figure, so
 *     carry-forward and one-off grants survive the monthly recalculation.
 *   - `used_adjust` (0092) corrects the summed usage without touching the
 *     leave applications themselves.
 */
export const LEAVE_WINDOW_START = (year: number): number => (year === 2026 ? 7 : 1);

export function leaveAccrual(
  type: string, entitled: number, year: number, month: number, adjust = 0,
): number {
  const windowStart = LEAVE_WINDOW_START(year);
  const monthsTotal = 12 - windowStart + 1;
  const monthsElapsed = Math.min(Math.max(month - windowStart + 1, 0), monthsTotal);
  const base = type === "medical" || type === "unpaid"
    ? entitled
    : Math.floor(((entitled * monthsElapsed) / monthsTotal) * 2) / 2;
  return base + adjust;
}

/** The row behind one person's balance for one type. Absent columns (a
    database that has not run 0091/0092 yet) read as zero, so a pending
    migration degrades to the old behaviour rather than a 500. */
export interface LeaveBalanceRow {
  entitled: number | null;
  adjust?: number | null;
  used_adjust?: number | null;
}

/**
 * Read one person's stored leave row, tolerating a database that has not run
 * 0091/0092 yet.
 *
 * The standing rule in this codebase (v1.4.218): schema skew DEGRADES, it
 * never 500s. A worker published ahead of its migrations must keep answering
 * with the behaviour it had before, so the wide query is tried first and the
 * narrow one catches. Absent columns read as zero, which is exactly the old
 * behaviour — no adjustment.
 */
export async function leaveBalanceRow(
  env: Env, userId: number, year: number, type: string,
): Promise<LeaveBalanceRow> {
  try {
    const r = await env.DB.prepare(
      `SELECT entitled, adjust, used_adjust FROM leave_balances
       WHERE user_id = ?1 AND year = ?2 AND type = ?3`,
    ).bind(userId, year, type).first<LeaveBalanceRow>();
    return r ?? { entitled: null, adjust: 0, used_adjust: 0 };
  } catch {
    const r = await env.DB.prepare(
      `SELECT entitled FROM leave_balances WHERE user_id = ?1 AND year = ?2 AND type = ?3`,
    ).bind(userId, year, type).first<{ entitled: number }>().catch(() => null);
    return { entitled: r?.entitled ?? null, adjust: 0, used_adjust: 0 };
  }
}

/**
 * Document numbers (v1.4.4): {TYPE}-AZOO{DDMMYY}-{X}, e.g. QT-AZOO300726-1.
 * X is the running number for that document type on that day (no padding, per
 * the format the business specified). Previous format {TYPE}{YYYYMMDD}-{NN}-AZOO
 * (v1.2.7) remains valid on documents already issued — numbers are never
 * reissued or rewritten.
 * Daily counter per type (Asia/Kuala_Lumpur); widens past 99/day automatically.
 * Legacy numbers (QT202600001) issued before v1.2.7 remain valid — never renumbered.
 * Spec: DOCUMENT-NUMBERING.md
 */
function todayKL(): string {
  const now = new Date(Date.now() + 8 * 60 * 60 * 1000); // UTC+8, no DST
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

/* v1.28.0 — per-document legal issuer (migration 0073). A2Z CREATIVE
   MARKETING (SSM 202603003468) and AZ ONE OFFICIAL (SSM 202603168673) are
   separate legal entities; from v1.28.0 A2Z issues every NEW document. A
   document must forever show the entity that issued it, so the issuer is
   STAMPED at creation and never derived at render time. NULL = legacy row
   = AZ ONE OFFICIAL (see lib/issuers.ts resolveIssuer). A separate UPDATE
   rather than a column in each INSERT so a pre-0073 database keeps working
   (0062 lesson: never let an optional column take down a critical write). */
const OPERATING_ISSUER_CODE = "a2z";
/* v1.30.1 (CEO: "letterhead should all under A2Z since A2Z is a main
   company... only will letterhead under AZ One if it is consultancy"):
   the 'azoo' code reserved in migration 0073 goes live. stampIssuer now
   takes the code to stamp; every existing call keeps the A2Z default, and
   only three flows ever pass something else — QT/DO/INV creation (the
   operator chose consultancy), QT→INV conversion (the invoice inherits the
   quotation's entity), and receipts/credit notes (they inherit their
   invoice's entity, because they acknowledge money paid into the bank
   account THAT letterhead printed). HR paperwork — claims, leave,
   payslips — is untouched: A2Z employs, so A2Z issues those, always. */
/** v1.85.0 - the employer of record, in words, for a stamp code.
    The worker cannot import lib/issuers.ts (separate bundle), so the two
    names live in both places; tests/document-issuer-guard.mjs holds them to
    each other. NULL is a legacy month, and legacy means AZ ONE - never
    retroactively rebranded. */
function issuerName(code?: string | null): string {
  return code === "a2z" ? "A2Z CREATIVE MARKETING" : "AZ ONE OFFICIAL";
}

async function stampIssuer(
  env: Env,
  table: "sales_documents" | "receipts" | "credit_notes" | "claims" | "leave_requests",
  id: number | null | undefined,
  code: "a2z" | "azoo" = OPERATING_ISSUER_CODE,
): Promise<void> {
  if (!id) return;
  try {
    await env.DB.prepare(`UPDATE ${table} SET issuer_code = ?1 WHERE id = ?2`)
      .bind(code, id).run();
  } catch { /* pre-0073 schema: the document stays legacy-labelled (AZ ONE) */ }
}

async function docNumber(env: Env, docType: "QT" | "DO" | "INV" | "RC" | "CN"): Promise<string> {
  // Malaysia time (UTC+8) decides which business day the number belongs to
  const now = new Date(Date.now() + 8 * 3600 * 1000);
  const day = now.toISOString().slice(0, 10).replace(/-/g, ""); // YYYYMMDD (counter key)
  const dd = day.slice(6, 8);
  const mm = day.slice(4, 6);
  const yy = day.slice(2, 4);
  await env.DB.prepare(
    `INSERT INTO doc_counters_daily (doc_type, day, counter) VALUES (?1, ?2, 1)
     ON CONFLICT(doc_type, day) DO UPDATE SET counter = counter + 1`,
  ).bind(docType, day).run();
  const row = await env.DB.prepare(
    `SELECT counter FROM doc_counters_daily WHERE doc_type = ?1 AND day = ?2`,
  ).bind(docType, day).first<{ counter: number }>();
  return `${docType}-AZOO${dd}${mm}${yy}-${row?.counter ?? 1}`;
}

/* ---------------- router ---------------- */

/* ---------------- leave approval chain ---------------- */
//
// Staff route:   applied -> hr_reviewed -> pre_approved -> approved
// COO/CCO route: applied -> hr_reviewed ->               -> approved
//                (they skip pre-approval — no one pre-approves their own tier)
// Reject at any active stage is terminal.

const HR_STAGE_ROLES: readonly Role[] = ["super_admin", "admin", "hr_admin"];
const PREAPP_ROLES: readonly Role[] = ["super_admin", "admin", "coo", "cco"];
const FINAL_ROLES: readonly Role[] = ["super_admin", "admin", "ceo"];

function leaveNextStage(stage: string, applicantRole: string): string {
  if (stage === "applied") return "hr_reviewed";
  if (stage === "hr_reviewed") {
    // COO/CCO applicants skip pre-approval and go straight to final.
    return applicantRole === "coo" || applicantRole === "cco" ? "pending_final" : "pre_approved";
  }
  return "approved"; // pre_approved or pending_final -> final approval
}

function leaveCanActAt(
  user: StaffUser,
  stage: string,
  applicantRole: string,
  applicantId: number,
): boolean {
  // No one reviews their own request at any stage.
  if (user.id === applicantId) return false;
  if (stage === "applied") return HR_STAGE_ROLES.includes(user.role);
  if (stage === "hr_reviewed") {
    // COO/CCO applicants go straight to CEO; staff need COO/CCO pre-approval.
    return applicantRole === "coo" || applicantRole === "cco"
      ? FINAL_ROLES.includes(user.role)
      : PREAPP_ROLES.includes(user.role);
  }
  if (stage === "pre_approved" || stage === "pending_final") return FINAL_ROLES.includes(user.role);
  return false; // approved / rejected / cancelled are terminal
}

function leaveStageLabel(stage: string): string {
  return ({
    applied: "applied",
    hr_reviewed: "HR review done",
    pre_approved: "pre-approved (COO/CCO)",
    pending_final: "awaiting CEO",
    approved: "approved",
    rejected: "rejected",
    cancelled: "cancelled",
  } as Record<string, string>)[stage] ?? stage;
}

/* v1.4.202/203 — payment-date rule (CEO: pay on the 5th, or EARLIER when the
   5th is a weekend; deliberately opposite to payslip RELEASE which shifts
   forward) and the M2E bank-code map from the template's own list. Hoisted to
   module scope so the CSV route and the filled-.xlsm route share them. */
export function paymentDateFor(payMonth: string): string {
  const [py, pm] = payMonth.split("-").map(Number);
  const ny = pm === 12 ? py + 1 : py;
  const nm = pm === 12 ? 1 : pm + 1;
  const d = new Date(Date.UTC(ny, nm - 1, 5));
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

const M2E_BANKS: [string, string][] = [
  ["maybank", "MBBEMYKL"], ["malayan banking", "MBBEMYKL"],
  ["cimb", "CIBBMYKL"], ["public bank", "PBBEMYKL"], ["rhb", "RHBBMYKL"],
  ["hong leong", "HLBBMYKL"], ["ambank", "ARBKMYKL"],
  ["bank islam", "BIMBMYKL"], ["muamalat", "BMMBMYKL"],
  ["bsn", "BSNAMYK1"], ["simpanan nasional", "BSNAMYK1"],
  ["bank rakyat", "BKRMMYKL"], ["kerjasama rakyat", "BKRMMYKL"],
  ["agrobank", "AGOBMYKL"], ["pertanian", "AGOBMYKL"],
  ["affin", "PHBMMYKL"], ["alliance", "MFBBMYKL"],
  ["al-rajhi", "RJHIMYKL"], ["al rajhi", "RJHIMYKL"],
  ["mbsb", "AFBQMYKL"], ["ocbc", "OCBCMYKL"], ["uob", "UOVBMYKL"],
  ["united overseas", "UOVBMYKL"], ["hsbc", "HBMBMYKL"],
  ["standard chartered", "SCBLMYKX"], ["citibank", "CITIMYKL"],
  ["kuwait finance", "KFHOMYKL"], ["bank of china", "BKCHMYKL"],
];
function bankCode(name: string): string | null {
  const n = name.toLowerCase();
  for (const [frag, code] of M2E_BANKS) if (n.includes(frag)) return code;
  return null;
}

const M2E_TEMPLATE_KEY = "private/m2e/template.xlsm";

/* v1.4.281 — THE ONE revenue arithmetic, now split by BUSINESS LINE
   (CEO: "my company do 2 business which is one for product sales and the
   other one is for service sales… make it expandable").
   revenueLines() buckets every ringgit into a named line:
     product = TikTok + Shopee/walk-in postage + manual sales + paid INV kind='product'
     service = paid INV kind='service'
     invoices = paid INV on a DB that predates migration 0061 (kind column
       missing) — honest bucket, never guessed into a line.
   revenueByMonth() = the SUM of all lines, so /revenue, /finance/pnl and
   the business-lines card can never disagree. Adding a future line =
   one more bucket here; every consumer inherits it. Each query armored. */
async function revenueLines(env: Env): Promise<Record<string, Record<string, number>>> {
  const lines: Record<string, Record<string, number>> = {};
  const add = (line: string, m: string | null, c: number) => {
    if (!m) return;
    const bucket = (lines[line] ??= {});
    bucket[m] = (bucket[m] ?? 0) + c;
  };
  try {
    const { results } = await env.DB.prepare(
      `SELECT strftime('%Y-%m', created_at, '+8 hours') AS m, COALESCE(SUM(order_amount_cents), 0) AS cents
       FROM postage_records WHERE order_ref LIKE 'TT-%' AND status != 'returned' GROUP BY m`,
    ).all<{ m: string; cents: number }>();
    for (const r of results) add("product", r.m, r.cents);
  } catch { /* pre-postage */ }
  try {
    const { results } = await env.DB.prepare(
      `SELECT strftime('%Y-%m', created_at, '+8 hours') AS m, COALESCE(SUM(order_amount_cents), 0) AS cents
       FROM postage_records WHERE order_ref NOT LIKE 'TT-%' AND status != 'returned' GROUP BY m`,
    ).all<{ m: string; cents: number }>();
    for (const r of results) add("product", r.m, r.cents);
  } catch { /* pre-0048 */ }
  try {
    const { results } = await env.DB.prepare(
      `SELECT (CASE WHEN out_date IS NOT NULL THEN substr(out_date, 1, 7)
                    ELSE strftime('%Y-%m', created_at, '+8 hours') END) AS m,
              COALESCE(SUM(total_cents), 0) AS cents
       FROM manual_sales GROUP BY m`,
    ).all<{ m: string; cents: number }>();
    for (const r of results) add("product", r.m, r.cents);
  } catch {
    try {
      const { results } = await env.DB.prepare(
        `SELECT strftime('%Y-%m', created_at, '+8 hours') AS m, COALESCE(SUM(total_cents), 0) AS cents
         FROM manual_sales GROUP BY m`,
      ).all<{ m: string; cents: number }>();
      for (const r of results) add("product", r.m, r.cents);
    } catch { /* pre-manual-sales */ }
  }
  try {
    const { results } = await env.DB.prepare(
      `SELECT strftime('%Y-%m', COALESCE(paid_at, created_at), '+8 hours') AS m,
              (CASE WHEN kind = 'service' THEN 'service' ELSE 'product' END) AS line,
              COALESCE(SUM(total_cents), 0) AS cents
       FROM sales_documents WHERE doc_type = 'INV' AND payment_status = 'paid' GROUP BY m, line`,
    ).all<{ m: string; line: string; cents: number }>();
    for (const r of results) add(r.line, r.m, r.cents);
  } catch { /* pre-0061: no kind column — honest unclassified bucket */
    try {
      const { results } = await env.DB.prepare(
        `SELECT strftime('%Y-%m', COALESCE(paid_at, created_at), '+8 hours') AS m, COALESCE(SUM(total_cents), 0) AS cents
         FROM sales_documents WHERE doc_type = 'INV' AND payment_status = 'paid' GROUP BY m`,
      ).all<{ m: string; cents: number }>();
      for (const r of results) add("invoices", r.m, r.cents);
    } catch { /* pre-0060 */ }
  }
  try {
    /* v1.19.0 (CEO decision, consolidation Q2): stokis purchases join the
       revenue lines. Before this they were visible ONLY on the Stokis tab —
       reseller money was invisible to /revenue, the P&L and commission base. */
    const { results } = await env.DB.prepare(
      `SELECT strftime('%Y-%m', created_at, '+8 hours') AS m, COALESCE(SUM(amount_cents), 0) AS cents
       FROM stokis_orders GROUP BY m`,
    ).all<{ m: string; cents: number }>();
    for (const r of results) add("stokis", r.m, r.cents);
  } catch { /* pre-0069 */ }
  try {
    /* v1.38.0: ELFIA web orders join the lines — payment-received basis like
       everything else (paid_seen_at = when THIS portal first saw it paid,
       stamped by the 5-min poller). Cancelled orders never get a
       paid_seen_at wiped — a paid-then-cancelled order is a refund decision,
       visible in Web Orders, not silently vanished revenue. Deliberately NOT
       part of attributedSalesByUser(): no live session, no shift, nobody's
       commission — asserted by tests/bridge-idempotency.mjs. */
    const { results } = await env.DB.prepare(
      `SELECT strftime('%Y-%m', paid_seen_at, '+8 hours') AS m, COALESCE(SUM(total_cents), 0) AS cents
       FROM web_orders WHERE paid_seen_at IS NOT NULL GROUP BY m`,
    ).all<{ m: string; cents: number }>();
    for (const r of results) add("elfia", r.m, r.cents);
  } catch { /* pre-0077 */ }
  return lines;
}

async function revenueByMonth(env: Env): Promise<Record<string, number>> {
  const lines = await revenueLines(env);
  const acc: Record<string, number> = {};
  for (const bucket of Object.values(lines)) {
    for (const [m, c] of Object.entries(bucket)) acc[m] = (acc[m] ?? 0) + c;
  }
  return acc;
}

/* ===================== v1.6.0 — sales attribution & commission ============ */

// Who may set targets and edit commission rules.
const TARGET_ADMIN_ROLES = ["super_admin", "admin", "ceo", "coo", "cco"];

interface CommissionRule {
  id: number; name: string; base_pct: number; bonus_pct: number; applies_to: string; active: number;
}

/** Attributed sales (sen) per user for a month (YYYY-MM, MYT): paid invoices
    where they are the salesperson + TikTok GMV landing inside their completed
    live-session windows (the same attribution the LIVE GMV card already uses)
    + manual/walk-in sales they recorded (v1.25.5 — an offline sale closed by
    a sales_marketing person is their sale and belongs on their line).
    Returns Map<user_id, cents>. Armoured against pre-migration schemas. */
async function attributedSalesByUser(env: Env, month: string): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  const add = (uid: number | null, cents: number) => {
    if (!uid) return;
    out.set(uid, (out.get(uid) ?? 0) + (cents ?? 0));
  };
  try {
    const { results } = await env.DB.prepare(
      `SELECT salesperson_id AS uid, COALESCE(SUM(total_cents), 0) AS cents
         FROM sales_documents
        WHERE doc_type = 'INV' AND salesperson_id IS NOT NULL
          AND paid_at IS NOT NULL AND strftime('%Y-%m', paid_at) = ?1
        GROUP BY salesperson_id`,
    ).bind(month).all<{ uid: number; cents: number }>();
    for (const r of results) add(r.uid, r.cents);
  } catch { /* pre-salesperson / pre-paid_at */ }
  try {
    const { results } = await env.DB.prepare(
      `SELECT s.host_user_id AS uid, COALESCE(SUM(p.order_amount_cents), 0) AS cents
         FROM postage_records p
         JOIN live_sessions s
           ON s.status != 'cancelled' AND s.end_time IS NOT NULL
          AND s.session_date = date(p.created_at, '+8 hours')
          AND strftime('%H:%M', p.created_at, '+8 hours') >= s.start_time
          AND strftime('%H:%M', p.created_at, '+8 hours') <= s.end_time
        WHERE p.order_ref LIKE 'TT-%' AND p.status != 'returned'
          AND p.order_amount_cents IS NOT NULL
          AND strftime('%Y-%m', p.created_at, '+8 hours') = ?1
        GROUP BY s.host_user_id`,
    ).bind(month).all<{ uid: number; cents: number }>();
    for (const r of results) add(r.uid, r.cents);
  } catch { /* pre-live_sessions */ }
  try {
    const { results } = await env.DB.prepare(
      `SELECT created_by AS uid, COALESCE(SUM(total_cents), 0) AS cents
         FROM manual_sales
        WHERE created_by IS NOT NULL
          AND strftime('%Y-%m', created_at, '+8 hours') = ?1
        GROUP BY created_by`,
    ).bind(month).all<{ uid: number; cents: number }>();
    for (const r of results) add(r.uid, r.cents);
  } catch { /* pre-0048 */ }
  /* v1.25.6 (CEO): "sales marketing when clock in then it is supposed to
     capture their sales." Every TikTok order landing while a sales_marketing
     person is clocked in is theirs — ALL orders during the shift (his call:
     the live host keeps their live-session credit too), split equally when
     several sales_marketing staff are on shift at once. Only sales_marketing:
     "Marketing doesnt make any sales on TikTok!" */
  try {
    const { results: sm } = await env.DB.prepare(
      `SELECT id FROM users WHERE is_active = 1 AND role = 'sales_marketing'`,
    ).all<{ id: number }>();
    if (sm.length > 0) {
      const ids = sm.map((u) => u.id);
      const ph = ids.map((_, i) => `?${i + 2}`).join(", ");
      // Punches from one day before the month to one day after: an overnight
      // shift straddling the month edge still attributes correctly.
      const { results: punches } = await env.DB.prepare(
        `SELECT user_id, type, created_at FROM attendance_records
          WHERE type IN ('clock_in', 'clock_out') AND user_id IN (${ph})
            AND date(created_at, '+8 hours') >= date(?1 || '-01', '-1 day')
            AND date(created_at, '+8 hours') <= date(?1 || '-01', '+1 month')
          ORDER BY user_id, created_at`,
      ).bind(month, ...ids).all<ShiftPunch>();
      const { results: orders } = await env.DB.prepare(
        `SELECT created_at, order_amount_cents AS cents FROM postage_records
          WHERE order_ref LIKE 'TT-%' AND status != 'returned'
            AND order_amount_cents IS NOT NULL
            AND strftime('%Y-%m', created_at, '+8 hours') = ?1`,
      ).bind(month).all<ShiftOrder>();
      const nowUtc = new Date().toISOString().slice(0, 19).replace("T", " ");
      for (const [uid, cents] of shiftSalesSplit(punches, orders, nowUtc)) add(uid, cents);
    }
  } catch { /* pre-attendance / pre-postage schemas */ }
  return out;
}

/** The sales floor: roles that are always listed on the leaderboard, even at
    RM 0.00, because selling is their job and a blank line is information too.
    Everyone else appears only once they have attributed sales or a target.
    v1.25.6: 'marketing' removed — CEO: "Marketing doesnt make any sales on
    TikTok!" — the board lists only people who sell. */
const LEADERBOARD_ALWAYS_ROLES = ["sales_marketing", "live_host", "cco"];

/** Commission (sen) for a person's attributed `sales` against their `target`,
    under whichever active rule that applies to `role` yields the most (staff-
    friendly): base_pct on all sales + bonus_pct on the amount above target. */
function commissionFor(sales: number, target: number, role: string, rules: CommissionRule[]): number {
  let best = 0;
  for (const r of rules) {
    if (!r.active) continue;
    if (r.applies_to !== "all" && r.applies_to !== role) continue;
    const base = sales * (r.base_pct / 100);
    const over = target > 0 ? Math.max(0, sales - target) * (r.bonus_pct / 100) : 0;
    best = Math.max(best, base + over);
  }
  return Math.round(best);
}

async function activeCommissionRules(env: Env): Promise<CommissionRule[]> {
  try {
    const { results } = await env.DB.prepare(
      `SELECT id, name, base_pct, bonus_pct, applies_to, active FROM commission_rules WHERE active = 1`,
    ).all<CommissionRule>();
    return results;
  } catch { return []; }
}

export async function handleStaff(
  request: Request,
  env: Env,
  path: string, // already stripped of /api/v1/staff prefix, starts with /
  user: StaffUser,
): Promise<Response | null> {
  const method = request.method;
  // The photo route carries a binary body — JSON-parsing it would consume the
  // stream, so it is excluded here and reads request.body directly.
  // v1.4.115: /receipt carries a binary body exactly like /photo — JSON-parsing
  // it consumed the stream, which is why every claim receipt upload failed
  // (the R2 put received a disturbed body). Both binary routes are excluded.
  // v1.7.0: the claims receipt upload is /claims/:id/receipt (binary); the new
  // /docs/:id/receipt is JSON, so exclude only the claims one, not any /receipt.
  const isClaimsReceipt = path.endsWith("/receipt") && path.startsWith("/claims/");
  // v1.38.0: signature uploads are a raw PNG body, same family as /photo.
  const isSignatureUpload = path.startsWith("/signatures/");
  /* v1.50.0: the carousel cut-out is a raw PNG body too. Reading the body as
     JSON first consumes it ("Body has already been used"), so every binary
     route has to be named here — that is the rule this list exists for. */
  const isCutoutUpload = path.endsWith("/cutout");
  /* v1.55.0: the ELFIA catalog PDF and its cover are raw binary bodies.
     The map (/elfia/catalog/map) stays JSON and is NOT excluded.
     v1.61.0: the /catalog hover backdrop image joins them. */
  const isCatalogUpload = path === "/elfia/catalog" || path === "/elfia/catalog/cover" || path === "/elfia/backdrop";
  const body =
    ["POST", "PUT", "PATCH"].includes(method) && !path.endsWith("/photo") && !isClaimsReceipt && !isSignatureUpload && !isCutoutUpload && !isCatalogUpload && !path.endsWith("/payment-proof") && !path.endsWith("/documents") && !path.endsWith("/m2e-template")
      ? ((await request.json().catch(() => null)) as Record<string, unknown> | null)
      : null;

  /* ---- ERP modules (v1.18.0): orders, cash flow, reconciliation,
     commission, ads fund, purchasing, accounting — see erp.ts ---- */
  if (path.startsWith("/erp/")) {
    return handleErp(env, path.slice("/erp".length), method, body, user);
  }

  /* ---- Threads workspace (v1.89.0) — see threads.ts. A door, not a
     route: tests/api-routes.mjs reads threads.ts for what lies behind it. ---- */
  if (path === "/threads" || path.startsWith("/threads/")) {
    return handleThreads(env, path.slice("/threads".length), method, body, user, new URL(request.url).searchParams);
  }

  /* ---- me / profile ---- */

  if (path === "/profile" && method === "GET") {
    const row = await env.DB.prepare(
      `SELECT id, email, name, role, employee_id, position, department, phone, employment_status
       FROM users WHERE id = ?1`,
    ).bind(user.id).first();
    return json({ profile: row });
  }
  if (path === "/profile" && method === "PATCH") {
    // staff may update their own phone + name only
    const sets: string[] = [];
    const vals: (string | number | null)[] = [];
    if (typeof body?.phone === "string" && body.phone.length <= 40) {
      sets.push(`phone = ?${sets.length + 1}`);
      vals.push(body.phone.trim() || null);
    }
    if (typeof body?.name === "string" && body.name.trim().length > 0 && body.name.length <= 120) {
      sets.push(`name = ?${sets.length + 1}`);
      vals.push(body.name.trim());
    }
    if (sets.length === 0) return err("invalid_input", "Nothing to update", 400);
    await env.DB.prepare(`UPDATE users SET ${sets.join(", ")} WHERE id = ?${sets.length + 1}`)
      .bind(...vals, user.id).run();
    await audit(env, user.id, "staff.profile_update");
    return json({ ok: true });
  }

  /* ---- staff directory (managers) ---- */

  if (path === "/users" && method === "POST") {
    // HR-scoped staff creation. Deliberately cannot mint admin/super_admin,
    // executive, or customer accounts; those stay in /admin/super-admin flows.
    if (!can(user.role, "hr_manage")) return err("forbidden", "HR access required", 403);
    const STAFF_ROLES = ["editor", "marketing", "live_host", "hr_admin", "sales_marketing"];
    if (
      !body || !str(body.email, 200) || !str(body.name, 120) ||
      !str(body.password, 200) || (body.password as string).length < 10 ||
      typeof body.role !== "string" || !STAFF_ROLES.includes(body.role)
    ) {
      return err("invalid_input", "email, name, a staff role, and a 10+ character password are required", 400);
    }
    const email = (body.email as string).toLowerCase().trim();
    // Domain policy (v1.4.42): staff roles require a company email —
    // personal emails (gmail etc.) belong to customer accounts.
    if (!email.endsWith(`@${env.COMPANY_DOMAIN.toLowerCase()}`)) {
      return err("domain_policy", `Staff roles require an @${env.COMPANY_DOMAIN} email — personal emails stay as customer accounts`, 400);
    }
    const existing = await env.DB.prepare(`SELECT id FROM users WHERE email = ?1`)
      .bind(email).first<{ id: number }>();
    if (existing) return err("email_exists", "A user with this email already exists", 409);
    const hash = await createPasswordHash(body.password as string, env.SESSION_PEPPER);
    try {
      const res = await env.DB.prepare(
        `INSERT INTO users (email, password_hash, name, role, employee_id, position, department, birthday, id_issued_on, blood_type, bank_name, bank_account, ic_number)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13) RETURNING id`,
      ).bind(
        email, hash, (body.name as string).trim(), body.role,
        str(body.employee_id, 60) ? body.employee_id : null,
        str(body.position, 120) ? body.position : null,
        str(body.department, 120) ? body.department : null,
        str(body.birthday, 10) ? body.birthday : null,
        str(body.id_issued_on, 10) ? body.id_issued_on : null,
        str(body.blood_type, 5) ? body.blood_type : null,
        str(body.bank_name, 60) ? body.bank_name : null,
        str(body.bank_account, 40) ? body.bank_account : null,
        str(body.ic_number, 20) ? body.ic_number : null,
      ).first<{ id: number }>();
      await audit(env, user.id, "staff.create", "users", String(res?.id), { role: body.role });
      return json({ id: res?.id }, 201);
    } catch {
      return err("db_constraint", "The database rejected this staff account — check the role and try again", 500);
    }
  }

  /* v1.4.156/157 — role & employment-status changes: Google sign-ups always
     land as `customer` (self-registration can never mint anything else), and
     ONLY the super_admin may change roles — per the CEO (v1.4.157): keeping
     promotion out of every business account means a compromised Google or
     staff sign-in can never escalate itself or anyone else. Rules:
       - super_admin ONLY (admin and ceo deliberately excluded)
       - admin-tier accounts (super_admin/admin) can never be touched here,
         and those roles can never be assigned here
       - you cannot change your own role
       - DOMAIN POLICY nuance: personal-email (Google) accounts may hold
         staff roles ONLY as part_time — permanent staff still require an
         @COMPANY_DOMAIN account created through staff onboarding
     Takes effect immediately: getSessionUser reads the role per request. */
  const roleMatch = path.match(/^\/users\/(\d+)\/role$/);
  if (roleMatch && method === "POST") {
    if (user.role !== "super_admin") {
      return err("forbidden", "Only the system super admin can change account roles — this keeps sign-ups from ever escalating themselves", 403);
    }
    const ASSIGNABLE = ["editor", "marketing", "live_host", "hr_admin", "sales_marketing", "ceo", "coo", "cco", "customer"];
    const EMP_STATUSES = ["permanent", "contract", "part_time", "probation"];
    const newRole = typeof body?.role === "string" ? body.role : "";
    const newStatus = typeof body?.employment_status === "string" && body.employment_status !== "" ? body.employment_status : null;
    if (!ASSIGNABLE.includes(newRole)) {
      return err("invalid_input", `role must be one of: ${ASSIGNABLE.join(", ")}`, 400);
    }
    if (newStatus && !EMP_STATUSES.includes(newStatus)) {
      return err("invalid_input", `employment_status must be one of: ${EMP_STATUSES.join(", ")}`, 400);
    }
    const id = Number(roleMatch[1]!);
    if (id === user.id) return err("self_change", "You can't change your own role — ask another authorised account.", 400);
    const target = await env.DB.prepare(`SELECT id, email, role, employment_status FROM users WHERE id = ?1`)
      .bind(id).first<{ id: number; email: string; role: string; employment_status: string | null }>();
    if (!target) return err("not_found", "User not found", 404);
    if (["super_admin", "admin"].includes(target.role)) {
      return err("forbidden", "Admin-tier accounts are managed in /admin only", 403);
    }
    const isCompanyEmail = target.email.toLowerCase().endsWith(`@${env.COMPANY_DOMAIN.toLowerCase()}`);
    let status = newStatus;
    if (newRole !== "customer" && !isCompanyEmail) {
      // Personal-email promotion → part-time only.
      if (status && status !== "part_time") {
        return err("domain_policy", `Personal-email accounts can only hold part-time roles — permanent staff need an @${env.COMPANY_DOMAIN} account`, 400);
      }
      status = "part_time";
    }
    await env.DB.prepare(
      `UPDATE users SET role = ?1, employment_status = COALESCE(?2, employment_status) WHERE id = ?3`,
    ).bind(newRole, status, id).run();
    await audit(env, user.id, "staff.role_change", "users", String(id), {
      from: target.role, to: newRole,
      employment_status: status ?? target.employment_status ?? "unchanged",
    });
    return json({ ok: true, role: newRole, employment_status: status ?? target.employment_status });
  }

  /* v1.9.1 — office geofence (replaces the v1.9.0 selfie step; selfies
     already on record stay viewable through the media route).
     GET: every staff member learns whether a fence is on (their punch flow
     needs to know to ask for location) + radius/label for the hint text.
     Coordinates themselves go only to the roles that can edit them.
     POST: super_admin/ceo/coo set, move or clear the fence. */
  if (path === "/attendance/geofence" && method === "GET") {
    const fence = await getGeofence(env);
    const isGeoAdmin = GEOFENCE_ADMIN_ROLES.includes(user.role);
    if (!fence) return json({ configured: false, can_edit: isGeoAdmin });
    return json({
      configured: true,
      can_edit: isGeoAdmin,
      radius_m: fence.radius_m,
      label: fence.label,
      ...(isGeoAdmin ? { lat: fence.lat, lng: fence.lng } : {}),
    });
  }
  /* v1.17.0 — "Check my location": the SAME rule the punch gate applies,
     run on demand so staff can see where they stand BEFORE tapping Clock in
     (CEO: "I still cant see the gps detection for the clock in"). Fence
     coordinates stay server-side — only the distance goes back. Deliberately
     no audit row and no punch record: this is a mirror, not an event. */
  if (path === "/attendance/geofence/check" && method === "POST") {
    const fence = await getGeofence(env);
    if (!fence) return json({ configured: false });
    const gpsRaw = str(body?.gps, 100) ? (body!.gps as string).trim() : null;
    const gm = gpsRaw ? /^(-?\d{1,2}(?:\.\d+)?),\s*(-?\d{1,3}(?:\.\d+)?)(?:,\s*(\d+(?:\.\d+)?))?$/.exec(gpsRaw) : null;
    const plat = gm ? Number(gm[1]) : NaN;
    const plng = gm ? Number(gm[2]) : NaN;
    if (!gm || plat < -90 || plat > 90 || plng < -180 || plng > 180) {
      return err("location_required", "Location is required — allow location access in your browser and try again.", 400);
    }
    const acc = gm[3] ? Math.min(Number(gm[3]), 150) : 0;
    const dist = haversineM(plat, plng, fence.lat, fence.lng);
    return json({
      configured: true,
      inside: dist <= fence.radius_m + acc,
      distance_m: Math.round(dist),
      accuracy_m: Math.round(acc),
      radius_m: fence.radius_m,
      label: fence.label,
    });
  }
  if (path === "/attendance/geofence" && method === "POST") {
    if (!GEOFENCE_ADMIN_ROLES.includes(user.role)) {
      return err("forbidden", "Only the CEO, COO or super admin can change the office geofence", 403);
    }
    if (body && body.clear === true) {
      await env.DB.prepare(`DELETE FROM system_meta WHERE key = ?1`).bind(GEOFENCE_KEY).run();
      await audit(env, user.id, "attendance.geofence_clear", "system_meta", GEOFENCE_KEY);
      return json({ ok: true, configured: false });
    }
    /* Review fix: NUMBERS ONLY. A NaN on the client serialises to JSON null,
       and Number(null) === 0 — which would silently save a fence at 0°,0°
       (the Gulf of Guinea) and lock the whole company out of clocking in.
       typeof checks close that hole. */
    const latG = typeof body?.lat === "number" && Number.isFinite(body.lat) ? body.lat : NaN;
    const lngG = typeof body?.lng === "number" && Number.isFinite(body.lng) ? body.lng : NaN;
    const radiusG = typeof body?.radius_m === "number" && Number.isFinite(body.radius_m) ? Math.round(body.radius_m) : NaN;
    if (!Number.isFinite(latG) || latG < -90 || latG > 90 || !Number.isFinite(lngG) || lngG < -180 || lngG > 180) {
      return err("invalid_input", "lat/lng must be valid coordinates (use the 'Use my current location' button at the office)", 400);
    }
    if (!Number.isFinite(radiusG) || radiusG < 20 || radiusG > 2000) {
      return err("invalid_input", "radius_m must be 20–2000 metres (100–200 m is typical: GPS in a building is rarely sharper)", 400);
    }
    const labelG = str(body?.label, 60) ? (body!.label as string).trim() : "the office";
    const fenceG: Geofence = { lat: Math.round(latG * 1e6) / 1e6, lng: Math.round(lngG * 1e6) / 1e6, radius_m: radiusG, label: labelG };
    await env.DB.prepare(
      `INSERT INTO system_meta (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = ?2`,
    ).bind(GEOFENCE_KEY, JSON.stringify(fenceG)).run();
    await audit(env, user.id, "attendance.geofence_set", "system_meta", GEOFENCE_KEY, { ...fenceG });
    return json({ ok: true, configured: true, ...fenceG });
  }

  const photoMatch = path.match(/^\/users\/(\d+)\/photo$/);
  if (photoMatch && method === "POST") {
    if (!can(user.role, "hr_manage")) return err("forbidden", "HR access required", 403);
    const id = photoMatch[1]!;
    const target = await env.DB.prepare(`SELECT photo_key FROM users WHERE id = ?1`)
      .bind(id).first<{ photo_key: string | null }>();
    if (!target) return err("not_found", "Staff not found", 404);
    // Same amendment policy as the record fields: HR sets the first photo,
    // replacing an existing one is admin/CEO-only.
    const adminTier = user.role === "super_admin" || user.role === "admin" || user.role === "ceo";
    if (target.photo_key && !adminTier) {
      return err("locked", "A photo is already set — replacements need an admin (/admin → Staff).", 403);
    }
    if (!request.body) return err("invalid_input", "Image body required", 400);
    const ct = request.headers.get("Content-Type") ?? "";
    if (!["image/jpeg", "image/png", "image/webp"].includes(ct)) return err("invalid_input", "Only JPEG/PNG/WEBP images are allowed", 400);
    const ext = ct.includes("png") ? "png" : ct.includes("webp") ? "webp" : "jpg";
    // private/ prefix: serving requires staff auth (badge preview/print run signed in)
    const key = `private/staff-photos/${id}-${Date.now()}.${ext}`;
    await env.MEDIA.put(key, request.body, { httpMetadata: { contentType: ct } });
    await env.DB.prepare(`UPDATE users SET photo_key = ?1 WHERE id = ?2`).bind(key, id).run();
    await audit(env, user.id, "staff.photo", "users", id);
    return json({ photo_key: key, url: `/api/v1/media/file/${encodeURIComponent(key)}` }, 201);
  }

  if (path === "/birthdays-lite" && method === "GET") {
    // v1.4.101: name + birthday only, for the calendar and dashboard —
    // available to every staff role, nothing sensitive.
    const { results } = await env.DB.prepare(
      `SELECT COALESCE(NULLIF(TRIM(full_name), ''), name) AS name, birthday FROM users
       WHERE is_active = 1 AND ${currentStaffSql()} AND role NOT IN ('customer', 'super_admin', 'admin') AND birthday IS NOT NULL`,
    ).all();
    return json({ birthdays: results });
  }
  /* v1.5.0: prospects CRUD routes removed with the Social tab (data retained in DB). */

  /* v1.4.270: ONE fetch for the Dashboard's status-breakdown card — cheap
     COUNTs, each armored per table so a pending migration can never blank
     the band (the v1.4.218 lesson applied to a new surface). Counts are
     universal facts; the CARD decides per role what to show. */
  if (path === "/dashboard/summary" && method === "GET") {
    const n = async (sql: string): Promise<number | null> => {
      try { return (await env.DB.prepare(sql).first<{ c: number }>())?.c ?? 0; }
      catch { return null; }
    };
    const todayS = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
    return json({
      today: todayS,
      // real schema: table `claims`, and both flows keep status='pending'
      // through the review chain (0010/0038 track the chain in columns).
      pending_leave: await n(`SELECT COUNT(*) AS c FROM leave_requests WHERE status = 'pending'`),
      pending_claims: await n(`SELECT COUNT(*) AS c FROM claims WHERE status = 'pending'`),
      pending_ot: await n(`SELECT COUNT(*) AS c FROM ot_records WHERE status = 'pending'`),
      low_stock: await n(`SELECT COUNT(*) AS c FROM inventory_items WHERE stock <= 5`),
      // v1.4.280: open quotations = QT docs not yet converted to an invoice
      open_quotations: await n(`SELECT COUNT(*) AS c FROM sales_documents WHERE doc_type = 'QT' AND converted_from IS NULL`),
      // v1.7.0 company-pulse tiles for the dashboard
      clients: await n(`SELECT COUNT(*) AS c FROM customers WHERE COALESCE(company, '') != 'Walk-in Customer'`),
      active_stokis: await n(`SELECT COUNT(*) AS c FROM stokis WHERE status = 'active'`),
      lives_today: await n(`SELECT COUNT(*) AS c FROM live_sessions WHERE session_date = date('now', '+8 hours') AND status != 'cancelled'`),
      attendance_today: await n(`SELECT COUNT(DISTINCT user_id) AS c FROM attendance_records WHERE type = 'clock_in' AND date(created_at, '+8 hours') = date('now', '+8 hours')`),
      /* v1.8.0 — the attendance donut: on-time (first clock-in <= 10:00 MYT,
         same rule the punch flag uses), late (after 10:00), and the active
         staff headcount so "not clocked in" is derivable. */
      attendance_on_time: await n(`SELECT COUNT(*) AS c FROM (
        SELECT a.user_id, MIN(strftime('%H:%M', a.created_at, '+8 hours')) AS t FROM attendance_records a
        JOIN users u ON u.id = a.user_id AND u.is_active = 1 AND u.role NOT IN ('customer', 'super_admin', 'admin')
        WHERE a.type = 'clock_in' AND date(a.created_at, '+8 hours') = date('now', '+8 hours') GROUP BY a.user_id
      ) WHERE t <= '10:00'`),
      attendance_late: await n(`SELECT COUNT(*) AS c FROM (
        SELECT a.user_id, MIN(strftime('%H:%M', a.created_at, '+8 hours')) AS t FROM attendance_records a
        JOIN users u ON u.id = a.user_id AND u.is_active = 1 AND u.role NOT IN ('customer', 'super_admin', 'admin')
        WHERE a.type = 'clock_in' AND date(a.created_at, '+8 hours') = date('now', '+8 hours') GROUP BY a.user_id
      ) WHERE t > '10:00'`),
      staff_total: await n(`SELECT COUNT(*) AS c FROM users WHERE is_active = 1 AND ${currentStaffSql()} AND role NOT IN ('customer', 'super_admin', 'admin')`),
      outstanding_invoices: await n(`SELECT COUNT(*) AS c FROM sales_documents WHERE doc_type = 'INV' AND COALESCE(payment_status, 'unpaid') != 'paid'`),
      // Cash flow proxy for the month: cash IN (paid invoices) - cash OUT (expenses).
      cash_in_cents: await n(`SELECT COALESCE(SUM(total_cents), 0) AS c FROM sales_documents WHERE doc_type = 'INV' AND payment_status = 'paid' AND strftime('%Y-%m', COALESCE(paid_at, created_at), '+8 hours') = strftime('%Y-%m', 'now', '+8 hours')`),
      cash_out_cents: await n(`SELECT COALESCE(SUM(amount_cents), 0) AS c FROM expenses WHERE strftime('%Y-%m', expense_date) = strftime('%Y-%m', 'now', '+8 hours')`),
    });
  }

  /* v1.5.0: /trends/my removed with the Social tab. */

  if (path === "/staff-list" && method === "GET") {
    // v1.4.93: minimal staff list (id, name, role) for pickers like the
    // Sales-person dropdown — available to every staff role, exposes nothing
    // sensitive (no phone/IC/bank/salary).
    const { results } = await env.DB.prepare(
      `SELECT id, COALESCE(NULLIF(TRIM(full_name), ''), name) AS name, role, position, employment_status FROM users
       WHERE is_active = 1 AND ${currentStaffSql()} AND role NOT IN ('customer', 'super_admin', 'admin')
       ORDER BY 2`,
    ).all();
    return json({ staff: results });
  }
  if (path === "/users/activity" && method === "GET") {
    // v1.4.153: user log for the Users tab — recent sign-ins and account
    // events from the audit trail. Same readers as the Users tab (exec_view /
    // hr_manage); shows auth + account actions only, not the full audit.
    if (!can(user.role, "hr_manage") && !can(user.role, "exec_view")) {
      return err("forbidden", "HR access required", 403);
    }
    const { results } = await env.DB.prepare(
      `SELECT a.action, a.created_at, COALESCE(NULLIF(TRIM(u.full_name), ''), u.name) AS name, u.email
       FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
       WHERE a.action IN ('auth.login', 'auth.login_2fa', 'auth.login_google', 'auth.2fa_challenge', 'auth.2fa_backup_used', 'auth.2fa_enabled', 'auth.2fa_disabled')
       ORDER BY a.created_at DESC LIMIT 60`,
    ).all();
    return json({ events: results });
  }
  if (path === "/users" && method === "GET") {
    // hr_manage writes; exec_view (CEO) reads — the Birthdays tab and the
    // Overview need the staff list even for read-only executives.
    if (!can(user.role, "hr_manage") && !can(user.role, "exec_view")) {
      return err("forbidden", "HR access required", 403);
    }
    /* v1.4.218 MIGRATION-SKEW ARMOR (the Staff tab went BLANK when the
       v1.4.213 code deployed before migrations 0058/0059 ran — "no such
       column: address" killed the whole SELECT and with it the entire
       directory). The staff list is too important to die over optional
       columns: if the profile columns don't exist yet, fall back to the
       pre-0059 column list so the directory always renders; the seven
       profile fields simply arrive after `wrangler d1 migrations apply`. */
    let results: unknown[];
    try {
      ({ results } = await env.DB.prepare(
        `SELECT id, name, full_name, email, role, employee_id, position, department, phone, employment_status, is_active, id_issued_on, birthday, blood_type, photo_key, bank_name, bank_account, joined_on, ic_number, left_on, rejoined_on,
                address, emergency_name, emergency_phone, emergency_relation, epf_no, socso_no, tax_no,
                CASE WHEN totp_secret IS NOT NULL THEN 1 ELSE 0 END AS totp_enabled
         FROM users ORDER BY name`,
      ).all());
    } catch (e) {
      if (!(e instanceof Error && e.message.includes("no such column"))) throw e;
      await logError(env, "migration_skew", "GET /users: 0059 profile columns missing — run wrangler d1 migrations apply");
      ({ results } = await env.DB.prepare(
        `SELECT id, name, full_name, email, role, employee_id, position, department, phone, employment_status, is_active, id_issued_on, birthday, blood_type, photo_key, bank_name, bank_account, joined_on, ic_number, left_on, rejoined_on,
                CASE WHEN totp_secret IS NOT NULL THEN 1 ELSE 0 END AS totp_enabled
         FROM users ORDER BY name`,
      ).all());
    }
    return json({ users: results, staff: results });
  }
  const staffUser = path.match(/^\/users\/(\d+)$/);
  if (staffUser && method === "PATCH") {
    // hr_admin/coo/cco/admin tier manage staff fields. CEO is read-only
    // everywhere EXCEPT staff birthdays, which policy lets the CEO maintain.
    const onlyBirthday = body && Object.keys(body).length > 0 &&
      Object.keys(body).every((k) => k === "birthday");
    const allowed = can(user.role, "hr_manage") || (onlyBirthday && user.role === "ceo");
    if (!allowed) return err("forbidden", "HR access required", 403);
    const id = staffUser[1]!;
    // Amendment policy (v1.4.22): HR may FILL a field that is still empty;
    // once a value is saved it locks, and changing it needs an admin. This
    // keeps records stable — corrections go through /admin deliberately.
    const adminTier = user.role === "super_admin" || user.role === "admin" || user.role === "ceo";
    // Validate up front so a bad value is a clear 400, never a DB 500.
    const STATUSES = ["permanent", "contract", "part_time", "probation", "resigned", "terminated"];
    if (typeof body?.employment_status === "string" && body.employment_status !== "" &&
        !STATUSES.includes(body.employment_status)) {
      return err("invalid_input", `employment_status must be one of: ${STATUSES.join(", ")}`, 400);
    }
    /* v1.4.183 (CEO: "live host I should have either part time or
       contract/permanent. this need to be justify!"): an ACTIVE live host is
       exactly one of those three — probation is not a live-host status.
       Resigned/terminated stay allowed (lifecycle). */
    if (typeof body?.employment_status === "string" && body.employment_status === "probation") {
      const roleRow = await env.DB.prepare(`SELECT role FROM users WHERE id = ?1`).bind(id).first<{ role: string }>();
      if (roleRow?.role === "live_host") {
        return err("invalid_input", "A live host is part-time, contract or permanent — probation is not a live-host status (CEO rule)", 400);
      }
    }
    // v1.4.213 profile fields: emergency contact + address (duty of care)
    // and EPF/SOCSO/tax numbers (ready for the pending statutory registration).
    const fields = ["employee_id", "position", "department", "employment_status", "birthday", "id_issued_on", "full_name", "phone", "blood_type", "bank_name", "bank_account", "joined_on", "ic_number", "left_on", "rejoined_on", "address", "emergency_name", "emergency_phone", "emergency_relation", "epf_no", "socso_no", "tax_no"] as const;
    let current: Record<string, string | null> | null;
    try {
      current = await env.DB.prepare(
        `SELECT employee_id, position, department, employment_status, birthday, id_issued_on, full_name, phone, blood_type,
                address, emergency_name, emergency_phone, emergency_relation, epf_no, socso_no, tax_no
         FROM users WHERE id = ?1`,
      ).bind(id).first<Record<string, string | null>>();
    } catch (e) {
      // v1.4.218 migration-skew armor — see GET /users above.
      if (!(e instanceof Error && e.message.includes("no such column"))) throw e;
      current = await env.DB.prepare(
        `SELECT employee_id, position, department, employment_status, birthday, id_issued_on, full_name, phone, blood_type
         FROM users WHERE id = ?1`,
      ).bind(id).first<Record<string, string | null>>();
    }
    if (!current) return err("not_found", "Staff not found", 404);
    const sets: string[] = [];
    const vals: string[] = [];
    const locked: string[] = [];
    for (const f of fields) {
      if (!str(body?.[f], 200)) continue;
      const incoming = (body![f] as string).trim();
      const existing = (current[f] ?? "").trim();
      if (existing && existing !== incoming && !adminTier) {
        locked.push(f);
        continue;
      }
      sets.push(`${f} = ?${sets.length + 1}`);
      vals.push(incoming);
    }
    if (locked.length > 0) {
      return err(
        "locked",
        `Already set and locked: ${locked.join(", ")}. Amendments need an admin (/admin → Staff).`,
        403,
      );
    }
    if (sets.length === 0) return err("invalid_input", "Nothing to update", 400);
    await env.DB.prepare(`UPDATE users SET ${sets.join(", ")} WHERE id = ?${sets.length + 1}`)
      .bind(...vals, id).run();
    await audit(env, user.id, "staff.hr_update", "users", id);
    return json({ ok: true });
  }

  /* ---- attendance ---- */

  if (path === "/attendance" && method === "POST") {
    // Lunch is not monitored — only clock_in and clock_out exist now.
    const types = ["clock_in", "clock_out"];
    if (!body || typeof body.type !== "string" || !types.includes(body.type)) {
      return err("invalid_input", `type must be one of: ${types.join(", ")}`, 400);
    }
    // One clock-in and one clock-out per day (v1.4.29). Enforced here, not
    // just in the UI — a double-click or stale tab can't duplicate a punch.
    const todayMYT = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
    const dup = await env.DB.prepare(
      `SELECT id, created_at FROM attendance_records
       WHERE user_id = ?1 AND type = ?2 AND date(created_at, '+8 hours') = ?3 LIMIT 1`,
    ).bind(user.id, body.type, todayMYT).first<{ id: number; created_at: string }>();
    // v1.4.113 (CEO's rule): the flow is clock IN first, then clock OUT.
    // A clock-out without today's clock-in is refused with a clear message —
    // enforced here, not just in the UI.
    if (body.type === "clock_out") {
      const inRow = await env.DB.prepare(
        `SELECT id FROM attendance_records
         WHERE user_id = ?1 AND type = 'clock_in' AND date(created_at, '+8 hours') = ?2 LIMIT 1`,
      ).bind(user.id, todayMYT).first<{ id: number }>();
      if (!inRow) {
        /* v1.76.0 (CEO: "if they forget to clock in or clock out, they will
           be able to clock in and out but system will require them to get the
           approval"). Refusing was worse than it looked: the person had
           worked the day, could not record it, and the day then vanished
           from payroll entirely. So the clock-out IS taken - and marked
           pending, because a shift with no start time is exactly the claim
           nobody can verify. It counts for nothing until the CEO approves it
           and sets the real times. */
        if (body.forgot !== true) {
          return json(
            { error: { code: "no_clock_in", message: "You haven't clocked in today. If you forgot, press Clock out again and confirm — it will be sent to the CEO to approve." },
              can_flag_forgot: true },
            400,
          );
        }
      }
    }
    if (dup) {
      // Tell them WHEN they punched, so the confirmation is useful rather
      // than just a refusal. Time returned in Malaysia time.
      const at = new Date(new Date(dup.created_at.replace(" ", "T") + "Z").getTime() + 8 * 3600 * 1000)
        .toISOString().slice(11, 16);
      return json(
        {
          error: {
            code: "already_punched",
            message: body.type === "clock_in"
              ? `You already clocked in today at ${at} MYT.`
              : `You already clocked out today at ${at} MYT.`,
          },
          already: true,
          at,
        },
        409,
      );
    }
    /* v1.76.0 — classified against THIS PERSON'S hours on THIS date, not
       against one constant. Somebody on 11:00-19:00 is not late at 10:30,
       and a Friday finish is 17:30 for the office pattern. A day their
       pattern gives no hours to is a rest day: worked, but outside the
       working week, and flagged as such rather than as an early-out against
       hours that do not apply. */
    const myt = new Date(Date.now() + 8 * 3600 * 1000);
    const mins = myt.getUTCHours() * 60 + myt.getUTCMinutes();
    const sh = await shiftOn(env, user.id, todayMYT);
    /* v1.80.0 — ASSIGNED WORK OUTRANKS THE PATTERN. The CEO: *"If user clock
       in after working hour need to check if their task is assigned to work
       at 8pm above? if yes, then it is consider their working time."* Checked
       only when the punch falls outside every scheduled block, because inside
       one the schedule is already the answer and a lookup would cost two
       queries to confirm what we know. */
    const inWindow = windowAt(sh, mins);
    const assigned = inWindow ? null
      : (await assignedResolver(env, todayMYT, todayMYT))(user.id, todayMYT, mins);
    let flag: string;
    if (assigned) {
      /* Scheduled by name, on the roster or the live board. Not late, not a
         rest-day anomaly - working time, and the register says which job. */
      flag = "assigned";
    } else if (sh.kind === "rest_day") {
      flag = "rest_day";
    } else if (body.type === "clock_in") {
      /* Against the block he is turning up FOR, not against the first block
         of the day: 20:28 for a 20:30 evening block is early, and measuring
         it against 11:00 called it five hundred minutes late and then docked
         half a day for it. */
      const due = lateAgainst(sh, mins) ?? SHIFT.startMinutes;
      flag = mins <= due ? "ok" : mins <= sh.halfDay ? "late" : "half_day";
    } else {
      flag = mins < (endOfDay(sh) ?? SHIFT.endMinutes) ? "early_out" : "completed";
    }
    /* v1.9.1 — OFFICE GEOFENCE (replaces the selfie step). Placed AFTER the
       dup/no_clock_in checks (an "already punched" answer never needs
       location, and a refusal creates no record) and BEFORE the INSERT.
       Server-side check — the UI hint is courtesy, this line is the rule.
       No fence configured → punches behave exactly as before. */
    const gate = await gateGeofence(env, body, body.type === "clock_in" ? "clock in" : "clock out");
    if (gate.resp) return gate.resp;
    /* v1.25.3: a punch with no fix is stored with the REASON in the gps
       column ("no_location:denied"), so the register, the monitor and any
       later report can all see it without a schema change. */
    const gpsVal = gate.gps ?? `no_location:${gate.noLocation}`;
    /* A punch is pending when the person says they forgot - either flagged
       explicitly, or a clock-out with no clock-in behind it. It is stored
       either way; it simply counts for nothing until the CEO approves it. */
    const pending = body.forgot === true ? 1 : null;
    let storedPending = false;
    try {
      await env.DB.prepare(
        `INSERT INTO attendance_records (user_id, type, ip, user_agent, gps, pending_approval)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
      ).bind(
        user.id, body.type,
        request.headers.get("CF-Connecting-IP"),
        (request.headers.get("User-Agent") ?? "").slice(0, 300),
        gpsVal, pending,
      ).run();
      storedPending = pending === 1;
    } catch (ePend) {
      if (!String(ePend).includes("no such column")) throw ePend;
      /* pre-0100: the column is not there yet, so the punch is recorded as an
         ordinary one. Better a counted punch than a lost day. */
      await env.DB.prepare(
        `INSERT INTO attendance_records (user_id, type, ip, user_agent, gps)
         VALUES (?1, ?2, ?3, ?4, ?5)`,
      ).bind(
        user.id, body.type,
        request.headers.get("CF-Connecting-IP"),
        (request.headers.get("User-Agent") ?? "").slice(0, 300),
        gpsVal,
      ).run();
    }
    if (storedPending) {
      /* The CEO approves these and sets the real time, so the CEO is who
         hears about it. Same shape as the no-location alert below. */
      const whoP = await env.DB.prepare(
        `SELECT COALESCE(NULLIF(TRIM(full_name), ''), name) AS n FROM users WHERE id = ?1`,
      ).bind(user.id).first<{ n: string }>();
      try {
        const { results } = await env.DB.prepare(
          `SELECT id FROM users WHERE is_active = 1 AND role IN ('ceo','super_admin')`,
        ).all<{ id: number }>();
        for (const r of results) {
          await notify(env, r.id, "attendance",
            `Forgotten ${body.type === "clock_in" ? "clock-in" : "clock-out"} to approve - ${whoP?.n ?? "staff"}, ${todayMYT}. Set the real time when you approve it.`,
            `punch:${user.id}:${todayMYT}:${body.type}`);
        }
      } catch { /* alerting never breaks a punch */ }
      await audit(env, user.id, "attendance.forgot", "attendance_records", todayMYT, { type: body.type });
    }
    if (gate.noLocation) {
      // Tell the people who own attendance, once per punch, with the person's
      // name and the reason — this is the "flag it loudly" half of the rule.
      const who = await env.DB.prepare(`SELECT COALESCE(NULLIF(TRIM(full_name), ''), name) AS n FROM users WHERE id = ?1`)
        .bind(user.id).first<{ n: string }>();
      const verb = body.type === "clock_in" ? "clocked in" : "clocked out";
      const reasonWord = gate.noLocation === "denied" ? "location blocked on their phone" : `no GPS signal (${gate.noLocation})`;
      try {
        const { results } = await env.DB.prepare(
          `SELECT id FROM users WHERE is_active = 1 AND role IN ('hr_admin','coo','ceo')`,
        ).all<{ id: number }>();
        for (const m of results) {
          await notify(env, m.id, "attendance",
            `⚠ ${who?.n ?? "A staff member"} ${verb} WITHOUT location — ${reasonWord}. Check the attendance register.`,
            `att:no_location:${user.id}`);
        }
      } catch { /* notification must never fail the punch */ }
      await audit(env, user.id, "attendance.no_location", "users", String(user.id), { type: body.type, reason: gate.noLocation });
    }
    return json({
      ok: true, flag, no_location: gate.noLocation ?? null,
      /* v1.76.0 — the client says so plainly: recorded, but not counted yet. */
      pending: storedPending,
      shift: { start: hhmm(sh.start), end: hhmm(sh.end), kind: sh.kind, pattern: sh.pattern },
    }, 201);
  }

  /* ---- overtime punches (v1.4.155) ----
     OT in / OT out open at 18:00 MYT. Overtime must already be approved by the
     staff member's Section HOD — the buttons record the hours, they are not the
     approval. Part-time staff (the live hosts) are not eligible, enforced here
     and hidden in the UI. Requires today's clock-in (you can't OT a day you
     never worked), and OT out requires today's OT in. One of each per day. */

  /* v1.4.191 OT APPROVAL CHAIN (CEO's gap list): OT day-pairs are decided
     by management — approvers = ceo/coo + admin tier. Only APPROVED OT will
     ever feed payroll. Decisions bell-notify the staff member. */
  /* v1.4.191 LOW-STOCK ALERTS: when an item's stock crosses to ≤5 (or drops
     further while low), bell-notify sales_marketing + the CEO once — the
     low_alerted column remembers the level already alerted at and resets
     when stock recovers above 5. Called from manual adjusts here and from
     the sync/cron sweep in index.ts. */
  const checkLowStock = async (itemId: number) => {
    try {
      const it = await env.DB.prepare(`SELECT sku, name, stock, low_alerted FROM inventory_items WHERE id = ?1`)
        .bind(itemId).first<{ sku: string; name: string; stock: number; low_alerted: number | null }>();
      if (!it) return;
      if (it.stock > 5) {
        if (it.low_alerted != null) await env.DB.prepare(`UPDATE inventory_items SET low_alerted = NULL WHERE id = ?1`).bind(itemId).run();
        return;
      }
      if (it.low_alerted != null && it.stock >= it.low_alerted) return; // already alerted at this level or lower
      const { results: staffRows } = await env.DB.prepare(
        `SELECT id FROM users WHERE is_active = 1 AND role IN ('sales_marketing', 'ceo')`,
      ).all<{ id: number }>();
      const msg = it.stock <= 0
        ? `🛑 OUT OF STOCK: ${it.sku} ${it.name}`
        : `⚠ Low stock: ${it.sku} ${it.name} — ${it.stock} left`;
      for (const st of staffRows) await notify(env, st.id, "stock", msg, `stock:${itemId}`);
      await env.DB.prepare(`UPDATE inventory_items SET low_alerted = ?1 WHERE id = ?2`).bind(it.stock, itemId).run();
    } catch { /* pre-0056 or best-effort */ }
  };

  /* v1.4.193 (CEO: "insert live GMV into my /portal at dashboard tabs for my
     staff view their live GMV daily results"): TikTok Live GMV for EVERY
     staff role — today, this month, and the last 7 days, from order amounts
     on TT- postage records (returned excluded). When the viewer has live
     sessions scheduled with an end time, orders landing INSIDE their session
     windows today are attributed as "during your live" (motivation, not
     payroll — window-based attribution, EXISTS to avoid double counting). */
  if (path === "/gmv" && method === "GET") {
    const base = `FROM postage_records WHERE order_ref LIKE 'TT-%' AND status != 'returned' AND order_amount_cents IS NOT NULL`;
    const today = await env.DB.prepare(
      `SELECT COALESCE(SUM(order_amount_cents), 0) AS c, COUNT(*) AS n ${base}
       AND date(created_at, '+8 hours') = date('now', '+8 hours')`,
    ).first<{ c: number; n: number }>();
    const monthG = await env.DB.prepare(
      `SELECT COALESCE(SUM(order_amount_cents), 0) AS c, COUNT(*) AS n ${base}
       AND strftime('%Y-%m', created_at, '+8 hours') = strftime('%Y-%m', 'now', '+8 hours')`,
    ).first<{ c: number; n: number }>();
    const { results: week } = await env.DB.prepare(
      `SELECT date(created_at, '+8 hours') AS d, COALESCE(SUM(order_amount_cents), 0) AS c, COUNT(*) AS n ${base}
       AND date(created_at, '+8 hours') >= date('now', '+8 hours', '-6 days')
       GROUP BY d ORDER BY d DESC`,
    ).all<{ d: string; c: number; n: number }>();
    let mine: { c: number; n: number } | null = null;
    try {
      const m = await env.DB.prepare(
        `SELECT COALESCE(SUM(order_amount_cents), 0) AS c, COUNT(*) AS n ${base}
         AND date(created_at, '+8 hours') = date('now', '+8 hours')
         AND EXISTS (
           SELECT 1 FROM live_sessions s
           WHERE s.host_user_id = ?1 AND s.status != 'cancelled' AND s.end_time IS NOT NULL
             AND s.session_date = date(postage_records.created_at, '+8 hours')
             AND strftime('%H:%M', postage_records.created_at, '+8 hours') >= s.start_time
             AND strftime('%H:%M', postage_records.created_at, '+8 hours') <= s.end_time
         )`,
      ).bind(user.id).first<{ c: number; n: number }>();
      const hasToday = await env.DB.prepare(
        `SELECT COUNT(*) AS n FROM live_sessions WHERE host_user_id = ?1 AND status != 'cancelled'
         AND session_date = date('now', '+8 hours')`,
      ).bind(user.id).first<{ n: number }>();
      if ((hasToday?.n ?? 0) > 0) mine = { c: m?.c ?? 0, n: m?.n ?? 0 };
    } catch { /* pre-0056 — company figures still return */ }
    return json({
      today: { cents: today?.c ?? 0, orders: today?.n ?? 0 },
      month: { cents: monthG?.c ?? 0, orders: monthG?.n ?? 0 },
      week,
      my_sessions_today: mine,
    });
  }

  if (path === "/attendance/ot/pending" && method === "GET") {
    if (!["ceo", "coo", "super_admin", "admin"].includes(user.role)) {
      return err("forbidden", "OT approvals are for the CEO/COO", 403);
    }
    try {
      const { results } = await env.DB.prepare(
        `SELECT o.user_id, u.name, date(o.created_at, '+8 hours') AS d, o.status,
                MIN(CASE WHEN o.type = 'ot_in'  THEN strftime('%H:%M', o.created_at, '+8 hours') END) AS ot_in,
                MAX(CASE WHEN o.type = 'ot_out' THEN strftime('%H:%M', o.created_at, '+8 hours') END) AS ot_out
         FROM ot_records o JOIN users u ON u.id = o.user_id
         GROUP BY o.user_id, d
         HAVING o.status = 'pending' AND ot_out IS NOT NULL
         ORDER BY d DESC LIMIT 100`,
      ).all();
      return json({ pending: results });
    } catch (e) {
      if (String(e).includes("no such column")) return err("migration_missing", "Run: npx wrangler d1 migrations apply azoneofficial --remote (0054_ot_approval)", 500);
      throw e;
    }
  }
  if (path === "/attendance/ot/decide" && method === "POST") {
    if (!["ceo", "coo", "super_admin", "admin"].includes(user.role)) {
      return err("forbidden", "OT approvals are for the CEO/COO", 403);
    }
    const uid = Number(body?.user_id); const day = typeof body?.date === "string" ? body.date : "";
    const decision = body?.decision === "approved" ? "approved" : body?.decision === "rejected" ? "rejected" : null;
    if (!uid || !/^\d{4}-\d{2}-\d{2}$/.test(day) || !decision) {
      return err("invalid_input", "user_id, date (YYYY-MM-DD) and decision (approved/rejected) required", 400);
    }
    if (uid === user.id) return err("forbidden", "You cannot decide your own OT", 403);
    const note = typeof body?.note === "string" ? body.note.slice(0, 300) : null;
    const r = await env.DB.prepare(
      `UPDATE ot_records SET status = ?1, decided_by = ?2, decided_at = datetime('now'), decision_note = ?3
       WHERE user_id = ?4 AND date(created_at, '+8 hours') = ?5 AND status = 'pending'`,
    ).bind(decision, user.id, note, uid, day).run();
    if ((r.meta?.changes ?? 0) === 0) return err("not_found", "No pending OT punches for that day", 404);
    await notify(env, uid, "ot", `Your overtime on ${day.split("-").reverse().join("-")} was ${decision}${note ? ` — ${note}` : ""}`, `ot:${day}`);
    await audit(env, user.id, "ot.decide", "users", String(uid), { date: day, decision });
    return json({ ok: true });
  }

  /* v1.23.8 — UI overflow reporter (CEO: "clipped on the mobile apps view"):
     the phone that SEES a too-wide element is the only place that knows
     which element it is — every sandbox engine here renders clean. The
     portal measures itself after each tab render and reports offenders to
     the error_log (admin → Audit → System health), tagged ui_overflow.
     Auth-gated, capped, once per tab per session per build. */
  if (path === "/debug/overflow" && method === "POST") {
    const tab = typeof body?.tab === "string" ? body.tab.slice(0, 40) : "?";
    const v = typeof body?.v === "string" ? body.v.slice(0, 20) : "?";
    const vw = Number(body?.vw) || 0;
    const dw = Number(body?.dw) || 0;
    const els = Array.isArray(body?.els) ? (body.els as unknown[]).slice(0, 5).map((x) => String(x).slice(0, 180)) : [];
    /* v1.88.1 - the desktop report measures HEIGHT; say which axis so the two
       kinds of overflow are not read as one. */
    const axis = body?.axis === "y" ? "y" : "x";
    try {
      await env.DB.prepare(
        `INSERT INTO error_log (source, message, path) VALUES ('ui_overflow', ?1, ?2)`,
      ).bind(`v${v} ${user.email} tab=${tab} axis=${axis} viewport=${vw} document=${dw} :: ${els.join(" | ") || (axis === "y" ? "(document taller than viewport, no element outside the shell found)" : "(document wider than viewport, no single element found)")}`, "/portal").run();
    } catch { /* pre-error_log schema — diagnostics never fail the request */ }
    return json({ ok: true });
  }

  /* v1.4.191 LIVE SESSION ROSTER: which host, which client, which platform,
     what slot — the schedule a live commerce agency runs on. Managers =
     ceo/coo/cco/hr_admin + admin tier; hosts see their own. */
  if (path === "/live-sessions" && method === "GET") {
    const mgr = ["ceo", "coo", "cco", "hr_admin", "super_admin", "admin"].includes(user.role);
    try {
      const { results } = await env.DB.prepare(
        mgr
          ? `SELECT s.*, u.name AS host_name, c.company AS client_company
             FROM live_sessions s JOIN users u ON u.id = s.host_user_id
             LEFT JOIN customers c ON c.id = s.client_id
             WHERE s.session_date >= date('now', '+8 hours', '-14 days')
             ORDER BY s.session_date, s.start_time LIMIT 200`
          : `SELECT s.*, u.name AS host_name, c.company AS client_company
             FROM live_sessions s JOIN users u ON u.id = s.host_user_id
             LEFT JOIN customers c ON c.id = s.client_id
             WHERE s.host_user_id = ?1 AND s.session_date >= date('now', '+8 hours', '-14 days')
             ORDER BY s.session_date, s.start_time LIMIT 100`,
      ).bind(...(mgr ? [] : [user.id])).all();
      return json({ sessions: results, manager: mgr });
    } catch (e) {
      if (String(e).includes("no such table")) return err("migration_missing", "Run: npx wrangler d1 migrations apply azoneofficial --remote (0056_live_sessions)", 500);
      throw e;
    }
  }
  if (path === "/live-sessions" && method === "POST") {
    if (!["ceo", "coo", "cco", "hr_admin", "super_admin", "admin"].includes(user.role)) {
      return err("forbidden", "Session scheduling is for management", 403);
    }
    const d = typeof body?.session_date === "string" ? body.session_date : "";
    const st = typeof body?.start_time === "string" ? body.start_time : "";
    const host = Number(body?.host_user_id);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !/^\d{2}:\d{2}$/.test(st) || !host) {
      return err("invalid_input", "session_date, start_time and host_user_id are required", 400);
    }
    const hostRow = await env.DB.prepare(`SELECT name, role, is_active FROM users WHERE id = ?1`)
      .bind(host).first<{ name: string; role: string; is_active: number }>();
    if (!hostRow || !hostRow.is_active || ["customer", "super_admin", "admin"].includes(hostRow.role)) {
      return err("invalid_input", "Host must be an active staff member", 400);
    }
    const platform = ["tiktok", "shopee", "other"].includes(String(body?.platform)) ? String(body?.platform) : "tiktok";
    const clientId = Number(body?.client_id) || null;
    const res = await env.DB.prepare(
      `INSERT INTO live_sessions (session_date, start_time, end_time, platform, client_id, client_name, host_user_id, notes, created_by)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9) RETURNING id`,
    ).bind(
      d, st,
      typeof body?.end_time === "string" && /^\d{2}:\d{2}$/.test(body.end_time) ? body.end_time : null,
      platform, clientId,
      typeof body?.client_name === "string" && body.client_name.trim() ? body.client_name.trim().slice(0, 120) : null,
      host,
      typeof body?.notes === "string" ? body.notes.slice(0, 500) : null,
      user.id,
    ).first<{ id: number }>();
    // v1.4.273 idea 5: a new booking re-arms the gone-quiet alert
    if (clientId) { try { await env.DB.prepare(`UPDATE customers SET quiet_alerted_on = NULL WHERE id = ?1`).bind(clientId).run(); } catch { /* pre-0067 */ } }
    await notify(env, host, "live", `📺 Live session assigned: ${d.split("-").reverse().join("-")} ${st} (${platform})`, `live:${res?.id}`);
    await audit(env, user.id, "live.schedule", "users", String(host), { date: d, start: st, platform });
    return json({ ok: true, id: res?.id }, 201);
  }
  {
    const mLS = path.match(/^\/live-sessions\/(\d+)$/);
    if (mLS && method === "PATCH") {
      if (!["ceo", "coo", "cco", "hr_admin", "super_admin", "admin"].includes(user.role)) {
        return err("forbidden", "Session scheduling is for management", 403);
      }
      /* v1.9.0: PATCH also reschedules (date/time/host) — the roster's
         drag-and-drop backend. Status keeps its old contract. */
      const setsLS: string[] = [];
      const argsLS: unknown[] = [];
      const putLS = (col: string, v: unknown) => { setsLS.push(`${col} = ?${argsLS.length + 1}`); argsLS.push(v); };
      const st = ["scheduled", "completed", "cancelled"].includes(String(body?.status)) ? String(body?.status) : null;
      if (st) putLS("status", st);
      if (typeof body?.session_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.session_date)) putLS("session_date", body.session_date);
      if (typeof body?.start_time === "string" && /^\d{2}:\d{2}$/.test(body.start_time)) putLS("start_time", body.start_time);
      if (typeof body?.end_time === "string" && /^\d{2}:\d{2}$/.test(body.end_time)) putLS("end_time", body.end_time);
      else if (body?.end_time === "" || body?.end_time === null) putLS("end_time", null); // v1.22.6: an edit may clear the end time
      if (Number(body?.host_user_id)) {
        const nh = await env.DB.prepare(`SELECT id, is_active, role FROM users WHERE id = ?1`).bind(Number(body!.host_user_id)).first<{ id: number; is_active: number; role: string }>();
        if (!nh || !nh.is_active || ["customer", "super_admin", "admin"].includes(nh.role)) return err("invalid_input", "Host must be an active staff member", 400);
        putLS("host_user_id", nh.id);
      }
      /* v1.22.6 (CEO: "I want to have an option for CEO, COO and CCO to
         amend or to update the roster / schedule if necessary or any typo"):
         the DETAILS — client, platform, notes — are amendable too, but only
         by the roles he named (+ the admin tier safety net). hr_admin keeps
         its scheduling powers (status/date/time/host) untouched. */
      const wantsDetails = body?.client_name !== undefined || body?.platform !== undefined || body?.notes !== undefined;
      if (wantsDetails) {
        if (!["ceo", "coo", "cco", "super_admin", "admin"].includes(user.role)) {
          return err("forbidden", "Only the CEO, COO or CCO can amend session details", 403);
        }
        if (typeof body?.client_name === "string") putLS("client_name", body.client_name.trim() ? body.client_name.trim().slice(0, 120) : null);
        if (["tiktok", "shopee", "other"].includes(String(body?.platform))) putLS("platform", String(body!.platform));
        if (typeof body?.notes === "string") putLS("notes", body.notes.trim() ? body.notes.slice(0, 500) : null);
      }
      if (setsLS.length === 0) return err("invalid_input", "Nothing to update (status, session_date, start_time, end_time, host_user_id, client_name, platform, notes)", 400);
      const before = await env.DB.prepare(`SELECT session_date, start_time, host_user_id FROM live_sessions WHERE id = ?1`).bind(mLS[1]).first<{ session_date: string; start_time: string; host_user_id: number }>();
      await env.DB.prepare(`UPDATE live_sessions SET ${setsLS.join(", ")} WHERE id = ?${argsLS.length + 1}`).bind(...argsLS, mLS[1]).run();
      const after = await env.DB.prepare(`SELECT session_date, start_time, end_time, host_user_id FROM live_sessions WHERE id = ?1`).bind(mLS[1]).first<{ session_date: string; start_time: string; end_time: string | null; host_user_id: number }>();
      // Tell the host when their session moved (or when it became theirs).
      if (after && before && (before.session_date !== after.session_date || before.start_time !== after.start_time || before.host_user_id !== after.host_user_id)) {
        await notify(env, after.host_user_id, "live",
          `📺 Live session ${before.host_user_id !== after.host_user_id ? "assigned to you" : "rescheduled"}: ${after.session_date.split("-").reverse().join("-")} ${after.start_time}${after.end_time ? `–${after.end_time}` : ""}`,
          `live:${mLS[1]}`);
        if (before.host_user_id !== after.host_user_id) {
          await notify(env, before.host_user_id, "live",
            `📺 Your live session on ${before.session_date.split("-").reverse().join("-")} ${before.start_time} was reassigned to another host.`,
            `live:${mLS[1]}`);
        }
      }
      await audit(env, user.id, "live.update", "live_sessions", mLS[1]!, (body ?? {}) as Record<string, unknown>);
      /* v1.22.7: echo WHICH columns were applied — the client uses this to
         detect an older deployed worker that silently ignored detail fields. */
      return json({ ok: true, applied: setsLS.map((s) => s.split(" =")[0]) });
    }
  }

  /* v1.9.0 — orders by buyer city (the ops-map card). revenue_view. */
  if (path === "/orders/geo" && method === "GET") {
    if (!can(user.role, "revenue_view")) return err("forbidden", "Revenue access required", 403);
    try {
      const { results } = await env.DB.prepare(
        `SELECT lower(TRIM(buyer_city)) AS city, COUNT(*) AS orders, COALESCE(SUM(order_amount_cents), 0) AS cents
         FROM postage_records
         WHERE buyer_city IS NOT NULL AND TRIM(buyer_city) != '' AND status != 'returned'
         GROUP BY lower(TRIM(buyer_city)) ORDER BY orders DESC LIMIT 100`,
      ).all<{ city: string; orders: number; cents: number }>();
      return json({ cities: results });
    } catch (e) {
      if (String(e).includes("no such column")) return json({ cities: [] });
      throw e;
    }
  }

  /* ================= v1.8.0 — Schedule & Roster board ======================
     One aggregate for the week grid: sessions, approved leave, conflicts
     (overlapping sessions per host, or a session whose host is on leave),
     unassigned requests (new client enquiries), and who is free today.
     Managers see everyone; other staff see their own sessions only. */
  if (path === "/roster" && method === "GET") {
    const mgrR = ["ceo", "coo", "cco", "hr_admin", "super_admin", "admin"].includes(user.role);
    const wk = new URL(request.url).searchParams.get("week");
    // Week starts Monday. Default: the Monday of the current MYT week.
    const todayMY = new Date(Date.now() + 8 * 3600 * 1000);
    const dow = (todayMY.getUTCDay() + 6) % 7; // 0 = Monday
    const defStart = new Date(todayMY.getTime() - dow * 86400_000).toISOString().slice(0, 10);
    const start = wk && /^\d{4}-\d{2}-\d{2}$/.test(wk) ? wk : defStart;
    const startMs = Date.parse(start + "T00:00:00Z");
    if (!Number.isFinite(startMs)) return err("invalid_input", "week must be YYYY-MM-DD", 400);
    const days: string[] = [];
    for (let i = 0; i < 7; i++) days.push(new Date(startMs + i * 86400_000).toISOString().slice(0, 10));
    const end = days[6]!;
    try {
      const { results: sessions } = await env.DB.prepare(
        mgrR
          ? `SELECT s.id, s.session_date, s.start_time, s.end_time, s.platform, s.status,
                    s.client_id, COALESCE(c.company, s.client_name) AS client, s.notes,
                    s.host_user_id, COALESCE(NULLIF(TRIM(u.full_name), ''), u.name) AS host_name, u.photo_key
             FROM live_sessions s JOIN users u ON u.id = s.host_user_id
             LEFT JOIN customers c ON c.id = s.client_id
             WHERE s.session_date BETWEEN ?1 AND ?2
             ORDER BY s.session_date, s.start_time LIMIT 400`
          : `SELECT s.id, s.session_date, s.start_time, s.end_time, s.platform, s.status,
                    s.client_id, COALESCE(c.company, s.client_name) AS client, s.notes,
                    s.host_user_id, COALESCE(NULLIF(TRIM(u.full_name), ''), u.name) AS host_name, u.photo_key
             FROM live_sessions s JOIN users u ON u.id = s.host_user_id
             LEFT JOIN customers c ON c.id = s.client_id
             WHERE s.host_user_id = ?3 AND s.session_date BETWEEN ?1 AND ?2
             ORDER BY s.session_date, s.start_time LIMIT 100`,
      ).bind(...(mgrR ? [start, end] : [start, end, user.id]))
        .all<{ id: number; session_date: string; start_time: string; end_time: string | null; host_user_id: number; status: string }>();

      /* PDPA: leave (especially its TYPE) is HR data. Managers get the whole
         floor WITHOUT the type; non-managers get only their own rows. The
         conflict engine below still sees the manager-scope rows it needs. */
      let onLeave: unknown[] = [];
      try {
        onLeave = (await env.DB.prepare(
          mgrR
            ? `SELECT l.user_id, COALESCE(NULLIF(TRIM(u.full_name), ''), u.name) AS name, l.start_date, l.end_date
               FROM leave_requests l JOIN users u ON u.id = l.user_id
               WHERE l.status = 'approved' AND l.start_date <= ?2 AND l.end_date >= ?1`
            : `SELECT l.user_id, COALESCE(NULLIF(TRIM(u.full_name), ''), u.name) AS name, l.start_date, l.end_date
               FROM leave_requests l JOIN users u ON u.id = l.user_id
               WHERE l.user_id = ?3 AND l.status = 'approved' AND l.start_date <= ?2 AND l.end_date >= ?1`,
        ).bind(...(mgrR ? [start, end] : [start, end, user.id])).all()).results;
      } catch { /* pre-migration */ }

      // Conflicts: overlapping sessions for the same host, and sessions whose
      // host has approved leave covering the session day.
      const conflicts: { kind: string; session_ids: number[]; task_block_ids?: number[];
                         host_user_id: number; date: string; soft?: boolean }[] = [];
      const live = sessions.filter((x) => x.status !== "cancelled");
      const endOf = (x: { start_time: string; end_time: string | null }) => x.end_time ?? addMinutes(x.start_time, 60);
      for (let i = 0; i < live.length; i++) {
        for (let j = i + 1; j < live.length; j++) {
          const a = live[i]!, b = live[j]!;
          if (a.host_user_id !== b.host_user_id || a.session_date !== b.session_date) continue;
          if (a.start_time < endOf(b) && b.start_time < endOf(a)) {
            conflicts.push({ kind: "overlap", session_ids: [a.id, b.id], host_user_id: a.host_user_id, date: a.session_date });
          }
        }
      }
      const leaveRows = onLeave as { user_id: number; start_date: string; end_date: string }[];
      for (const sess of live) {
        if (leaveRows.some((l) => l.user_id === sess.host_user_id && l.start_date <= sess.session_date && l.end_date >= sess.session_date)) {
          conflicts.push({ kind: "host_on_leave", session_ids: [sess.id], host_user_id: sess.host_user_id, date: sess.session_date });
        }
      }

      /* ===== v1.66.0 Track R — the other half of the week =====
         Task blocks are fetched, scoped and conflict-checked exactly as
         sessions are, and returned BESIDE them rather than merged into them.
         The board draws two kinds of block; nothing downstream of here can
         mistake one for the other, which is the point: the sales leaderboard
         reads live_sessions, and a task must never be able to reach it. */
      let taskBlocks: unknown[] = [];
      let unscheduled: unknown[] = [];
      let blockRows: { id: number; task_id: number; user_id: number; block_date: string;
                       start_time: string; end_time: string | null; deadline: string | null;
                       status: string; done_at: string | null }[] = [];
      try {
        const q = await env.DB.prepare(
          mgrR
            ? `SELECT b.id, b.task_id, b.user_id, b.block_date, b.start_time, b.end_time, b.done_at,
                      t.title, t.priority, t.status, t.deadline,
                      COALESCE(NULLIF(TRIM(u.full_name), ''), u.name) AS user_name
               FROM task_blocks b JOIN tasks t ON t.id = b.task_id JOIN users u ON u.id = b.user_id
               WHERE b.block_date BETWEEN ?1 AND ?2
               ORDER BY b.block_date, b.start_time LIMIT 400`
            : `SELECT b.id, b.task_id, b.user_id, b.block_date, b.start_time, b.end_time, b.done_at,
                      t.title, t.priority, t.status, t.deadline,
                      COALESCE(NULLIF(TRIM(u.full_name), ''), u.name) AS user_name
               FROM task_blocks b JOIN tasks t ON t.id = b.task_id JOIN users u ON u.id = b.user_id
               WHERE b.user_id = ?3 AND b.block_date BETWEEN ?1 AND ?2
               ORDER BY b.block_date, b.start_time LIMIT 100`,
        ).bind(...(mgrR ? [start, end] : [start, end, user.id]))
          .all<{ id: number; task_id: number; user_id: number; block_date: string;
                 start_time: string; end_time: string | null; deadline: string | null;
                 status: string; done_at: string | null }>();
        taskBlocks = q.results;
        blockRows = q.results;

        /* The rail: open tasks with no block anywhere in this week. Due this
           week or already overdue, because a task due in three weeks is not
           what this week's board is for. */
        const un = await env.DB.prepare(
          mgrR
            ? `SELECT t.id, t.title, t.priority, t.deadline, t.assigned_to,
                      COALESCE(NULLIF(TRIM(u.full_name), ''), u.name) AS assignee
               FROM tasks t JOIN users u ON u.id = t.assigned_to
               WHERE t.status != 'completed'
                 AND (t.deadline IS NULL OR t.deadline <= ?2)
                 AND NOT EXISTS (SELECT 1 FROM task_blocks b2 WHERE b2.task_id = t.id
                                   AND b2.block_date BETWEEN ?1 AND ?2)
               ORDER BY (t.deadline IS NULL), t.deadline LIMIT 12`
            : `SELECT t.id, t.title, t.priority, t.deadline, t.assigned_to,
                      COALESCE(NULLIF(TRIM(u.full_name), ''), u.name) AS assignee
               FROM tasks t JOIN users u ON u.id = t.assigned_to
               WHERE t.assigned_to = ?3 AND t.status != 'completed'
                 AND (t.deadline IS NULL OR t.deadline <= ?2)
                 AND NOT EXISTS (SELECT 1 FROM task_blocks b2 WHERE b2.task_id = t.id
                                   AND b2.block_date BETWEEN ?1 AND ?2)
               ORDER BY (t.deadline IS NULL), t.deadline LIMIT 12`,
        ).bind(...(mgrR ? [start, end] : [start, end, user.id])).all();
        unscheduled = un.results;
      } catch { /* pre-0095 — the board is exactly what it was yesterday */ }

      /* Three more conflict kinds, all of which only become checkable now
         that both kinds of block share one calendar. */
      /* v1.67.0: a day already done cannot clash with anything — it has
         happened. Flagging Monday against Monday's live session on Friday is
         noise, and noise is how a conflict list gets ignored. */
      const openBlocks = blockRows.filter((b) => b.status !== "completed" && !b.done_at);
      for (const b of openBlocks) {
        const bEnd = b.end_time ?? addMinutes(b.start_time, 60);

        /* 1. A task sitting on top of a live session. AMBER, not red
              (OD-26): a live session commits the storefront at a fixed hour
              and cannot move; the task is the thing that gives way. Naming
              it "soft" lets the board colour it differently instead of
              crying wolf in the same red as two clashing lives. */
        for (const sess of live) {
          if (sess.host_user_id !== b.user_id || sess.session_date !== b.block_date) continue;
          if (b.start_time < endOf(sess) && sess.start_time < bEnd) {
            conflicts.push({ kind: "task_over_live", session_ids: [sess.id], task_block_ids: [b.id],
                             host_user_id: b.user_id, date: b.block_date, soft: true });
          }
        }

        /* 2. Work booked on an approved leave day. Red: the person is not
              there. Same rule the live sessions already obey. */
        if (leaveRows.some((l) => l.user_id === b.user_id && l.start_date <= b.block_date && l.end_date >= b.block_date)) {
          conflicts.push({ kind: "task_on_leave", session_ids: [], task_block_ids: [b.id],
                           host_user_id: b.user_id, date: b.block_date });
        }

        /* 3. Work scheduled AFTER its own deadline. This is the check the
              whole exercise makes possible: it is invisible on a task list,
              invisible on a calendar of one, and obvious the moment the due
              date and the working day sit on the same screen. */
        if (b.deadline && b.block_date > b.deadline) {
          conflicts.push({ kind: "task_after_deadline", session_ids: [], task_block_ids: [b.id],
                           host_user_id: b.user_id, date: b.block_date });
        }
      }

      /* Two task blocks overlapping each other on one person's day. */
      for (let i = 0; i < openBlocks.length; i++) {
        for (let j = i + 1; j < openBlocks.length; j++) {
          const a = openBlocks[i]!, b2 = openBlocks[j]!;
          if (a.user_id !== b2.user_id || a.block_date !== b2.block_date) continue;
          const aE = a.end_time ?? addMinutes(a.start_time, 60);
          const bE = b2.end_time ?? addMinutes(b2.start_time, 60);
          if (a.start_time < bE && b2.start_time < aE) {
            conflicts.push({ kind: "task_overlap", session_ids: [], task_block_ids: [a.id, b2.id],
                             host_user_id: a.user_id, date: a.block_date });
          }
        }
      }

      // Unassigned requests: new customer enquiries (live/package) — the rail's
      // "clients still requiring a host". Managers only.
      let requests: unknown[] = [];
      if (mgrR) {
        try {
          requests = (await env.DB.prepare(
            `SELECT id, name, company, category, created_at FROM enquiries
             WHERE status = 'new' ORDER BY created_at DESC LIMIT 8`,
          ).all()).results;
        } catch { /* enquiries always exists, but stay armoured */ }
      }

      // Available today: active staff (host-capable roles) with no live
      // session today and no approved leave covering today.
      const todayS = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
      let available: unknown[] = [];
      if (mgrR) {
        const { results } = await env.DB.prepare(
          `SELECT u.id, COALESCE(NULLIF(TRIM(u.full_name), ''), u.name) AS name, u.role, u.photo_key
           FROM users u
           WHERE u.is_active = 1 AND u.role NOT IN ('customer', 'super_admin', 'admin')
             AND NOT EXISTS (SELECT 1 FROM live_sessions s2 WHERE s2.host_user_id = u.id
                               AND s2.session_date = ?1 AND s2.status != 'cancelled')
             AND NOT EXISTS (SELECT 1 FROM leave_requests l2 WHERE l2.user_id = u.id
                               AND l2.status = 'approved' AND l2.start_date <= ?1 AND l2.end_date >= ?1)
           ORDER BY 2 LIMIT 12`,
        ).bind(todayS).all();
        available = results;
      }

      return json({
        week_start: start, days, manager: mgrR,
        sessions, on_leave: onLeave, conflicts, requests, available_today: available,
        /* Beside the sessions, never merged into them. */
        task_blocks: taskBlocks, unscheduled,
      });
    } catch (e) {
      if (String(e).includes("no such table")) return err("migration_missing", "Run migration 0056 (live sessions) first", 409);
      throw e;
    }
  }

  /* v1.4.191 STAFF DOCUMENT VAULT + onboarding checklist. Vault: contracts /
     offer letters / resignation letters into R2 (private/staff-docs/), index
     in staff_documents. Upload/delete = hr_manage; each staff member can
     list + download their OWN documents. */
  {
    const mDoc = path.match(/^\/users\/(\d+)\/documents$/);
    if (mDoc && method === "GET") {
      const uidD = Number(mDoc[1]);
      if (!can(user.role, "hr_manage") && user.id !== uidD) return err("forbidden", "Not your documents", 403);
      try {
        const { results } = await env.DB.prepare(
          `SELECT d.id, d.kind, d.label, d.filename, d.size, d.created_at, u.name AS uploaded_by_name
           FROM staff_documents d LEFT JOIN users u ON u.id = d.uploaded_by
           WHERE d.user_id = ?1 ORDER BY d.created_at DESC`,
        ).bind(uidD).all();
        let onboarding: Record<string, boolean> = {};
        try {
          const ob = await env.DB.prepare(`SELECT onboarding_json FROM users WHERE id = ?1`)
            .bind(uidD).first<{ onboarding_json: string | null }>();
          onboarding = ob?.onboarding_json ? (JSON.parse(ob.onboarding_json) as Record<string, boolean>) : {};
        } catch { /* pre-0057 */ }
        return json({ documents: results, onboarding });
      } catch (e) {
        if (String(e).includes("no such table")) return err("migration_missing", "Run: npx wrangler d1 migrations apply azoneofficial --remote (0057_staff_docs_vault)", 500);
        throw e;
      }
    }
    if (mDoc && method === "POST") {
      if (!can(user.role, "hr_manage")) return err("forbidden", "HR access required", 403);
      if (!request.body) return err("invalid_input", "File body required", 400);
      const ctD = request.headers.get("Content-Type") ?? "application/octet-stream";
      if (!["application/pdf", "image/jpeg", "image/png"].includes(ctD)) return err("invalid_input", "Only PDF/JPEG/PNG documents allowed", 400);
      const kindD = ["contract", "offer_letter", "resignation", "other"].includes(request.headers.get("X-Doc-Kind") ?? "") ? request.headers.get("X-Doc-Kind")! : "other";
      const fnameD = (request.headers.get("X-Doc-Filename") ?? "document").slice(0, 160);
      const labelD = (request.headers.get("X-Doc-Label") ?? "").slice(0, 160) || null;
      const keyD = `private/staff-docs/${mDoc[1]}-${Date.now()}-${fnameD.replace(/[^A-Za-z0-9._-]/g, "_")}`;
      await env.MEDIA.put(keyD, request.body, { httpMetadata: { contentType: ctD } });
      const head = await env.MEDIA.head(keyD);
      await env.DB.prepare(
        `INSERT INTO staff_documents (user_id, kind, label, r2_key, filename, size, uploaded_by)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
      ).bind(mDoc[1], kindD, labelD, keyD, fnameD, head?.size ?? null, user.id).run();
      await audit(env, user.id, "staff.document_upload", "users", mDoc[1]!, { kind: kindD, filename: fnameD });
      return json({ ok: true }, 201);
    }
  }
  {
    const mDocOne = path.match(/^\/staff-documents\/(\d+)$/);
    if (mDocOne && method === "GET") {
      const row = await env.DB.prepare(`SELECT user_id, r2_key, filename FROM staff_documents WHERE id = ?1`)
        .bind(mDocOne[1]).first<{ user_id: number; r2_key: string; filename: string | null }>();
      if (!row) return err("not_found", "Document not found", 404);
      if (!can(user.role, "hr_manage") && user.id !== row.user_id) return err("forbidden", "Not your document", 403);
      const obj = await env.MEDIA.get(row.r2_key);
      if (!obj) return err("not_found", "File missing from storage", 404);
      return new Response(obj.body, {
        headers: {
          "Content-Type": obj.httpMetadata?.contentType ?? "application/octet-stream",
          "Content-Disposition": `attachment; filename="${(row.filename ?? "document").replace(/[^A-Za-z0-9._ -]/g, "_")}"`,
        },
      });
    }
    if (mDocOne && method === "DELETE") {
      if (!can(user.role, "hr_manage")) return err("forbidden", "HR access required", 403);
      const row = await env.DB.prepare(`SELECT r2_key FROM staff_documents WHERE id = ?1`)
        .bind(mDocOne[1]).first<{ r2_key: string }>();
      if (!row) return err("not_found", "Document not found", 404);
      try { await env.MEDIA.delete(row.r2_key); } catch { /* best effort */ }
      await env.DB.prepare(`DELETE FROM staff_documents WHERE id = ?1`).bind(mDocOne[1]).run();
      await audit(env, user.id, "staff.document_delete", "staff_documents", mDocOne[1]!);
      return json({ ok: true });
    }
  }
  {
    const mChk = path.match(/^\/users\/(\d+)\/onboarding$/);
    if (mChk && method === "POST") {
      if (!can(user.role, "hr_manage")) return err("forbidden", "HR access required", 403);
      const items = body?.items;
      if (typeof items !== "object" || items === null) return err("invalid_input", "items object required", 400);
      try {
        await env.DB.prepare(`UPDATE users SET onboarding_json = ?1 WHERE id = ?2`)
          .bind(JSON.stringify(items).slice(0, 4000), mChk[1]).run();
      } catch (e) {
        if (String(e).includes("no such column")) return err("migration_missing", "Run: npx wrangler d1 migrations apply azoneofficial --remote (0057_staff_docs_vault)", 500);
        throw e;
      }
      await audit(env, user.id, "staff.onboarding", "users", mChk[1]!);
      return json({ ok: true });
    }
  }

  if (path === "/attendance/ot" && method === "POST") {
    const otTypes = ["ot_in", "ot_out"];
    if (!body || typeof body.type !== "string" || !otTypes.includes(body.type)) {
      return err("invalid_input", `type must be one of: ${otTypes.join(", ")}`, 400);
    }
    // v1.4.156 — two changes here:
    // (1) BUG FIX: v1.4.155 queried a non-existent `status` column; the real
    //     column is `employment_status` — the route would have thrown.
    // (2) CEO's clarified rule: OT eligibility follows EMPLOYMENT STATUS, not
    //     role. Permanent live hosts DO work overtime; part-time staff
    //     (part-time live hosts, part-time designers) are not eligible.
    // v1.4.158 (CEO): OT does not appear for ceo/coo/cco — executives are not
    // OT-paid staff (admin tier likewise; they're system accounts). Combined
    // with the part-time rule, OT eligibility is: a non-executive staff role
    // whose employment_status isn't part_time.
    if (["ceo", "coo", "cco", "super_admin", "admin"].includes(user.role)) {
      return err("not_eligible", "Executive roles (CEO/COO/CCO) are not eligible for OT punches.", 403);
    }
    const me = await env.DB.prepare(`SELECT employment_status FROM users WHERE id = ?1`)
      .bind(user.id).first<{ employment_status: string | null }>();
    if (me?.employment_status === "part_time") {
      return err("not_eligible", "Part-time staff are not eligible for OT punches.", 403);
    }
    /* v1.4.179 (CEO: "for OT there should be appear on Weekend … except of
       executive"): WEEKENDS (Sat/Sun MYT) are rest days — any work IS
       overtime, so OT punches are open ALL DAY and need no prior clock-in
       (there is no normal shift to extend). WEEKDAYS keep the original
       rule: window from 18:00 MYT, after a clocked-in working day. The
       executive/part-time exclusions above apply on every day. */
    const mytNow = new Date(Date.now() + 8 * 3600 * 1000);
    const isWeekendOT = [0, 6].includes(mytNow.getUTCDay());
    const nowMins = mytNow.getUTCHours() * 60 + mytNow.getUTCMinutes();
    if (!isWeekendOT && nowMins < 18 * 60) {
      return err("too_early", "Overtime punches open at 18:00 MYT, after the normal shift ends. (Weekends: OT is open all day.)", 400);
    }
    const todayMYT = mytNow.toISOString().slice(0, 10);
    if (!isWeekendOT) {
      // Weekday OT extends a worked day — must have clocked in today.
      const dayIn = await env.DB.prepare(
        `SELECT id FROM attendance_records
         WHERE user_id = ?1 AND type = 'clock_in' AND date(created_at, '+8 hours') = ?2 LIMIT 1`,
      ).bind(user.id, todayMYT).first<{ id: number }>();
      if (!dayIn) {
        return json(
          { error: { code: "no_clock_in", message: "No clock-in recorded today — weekday overtime can only follow a worked day." } },
          400,
        );
      }
    }
    try {
      if (body.type === "ot_out") {
        const otIn = await env.DB.prepare(
          `SELECT id FROM ot_records
           WHERE user_id = ?1 AND type = 'ot_in' AND date(created_at, '+8 hours') = ?2 LIMIT 1`,
        ).bind(user.id, todayMYT).first<{ id: number }>();
        if (!otIn) {
          return json(
            { error: { code: "no_ot_in", message: "You haven't recorded OT in — tap OT in when overtime starts, then OT out when you finish." } },
            400,
          );
        }
      }
      // One OT in and one OT out per day, enforced server-side like clock punches.
      const dup = await env.DB.prepare(
        `SELECT id, created_at FROM ot_records
         WHERE user_id = ?1 AND type = ?2 AND date(created_at, '+8 hours') = ?3 LIMIT 1`,
      ).bind(user.id, body.type, todayMYT).first<{ id: number; created_at: string }>();
      if (dup) {
        const at = new Date(new Date(dup.created_at.replace(" ", "T") + "Z").getTime() + 8 * 3600 * 1000)
          .toISOString().slice(11, 16);
        return json(
          {
            error: {
              code: "already_punched",
              message: body.type === "ot_in"
                ? `You already recorded OT in today at ${at} MYT.`
                : `You already recorded OT out today at ${at} MYT.`,
            },
            already: true,
            at,
          },
          409,
        );
      }
      /* v1.9.1 review fix: OT punches are gated by the SAME office fence as
         clock punches — OT hours are the paid ones, leaving them open would
         let the fence be bypassed for exactly the records that feed payroll.
         (ot_records has no gps column — the check gates, it doesn't store;
         the IP below remains the stored cross-check.) */
      const otGate = await gateGeofence(env, body, body.type === "ot_in" ? "record OT in" : "record OT out");
      if (otGate.resp) return otGate.resp;
      await env.DB.prepare(
        `INSERT INTO ot_records (user_id, type, ip, user_agent)
         VALUES (?1, ?2, ?3, ?4)`,
      ).bind(
        user.id,
        body.type,
        request.headers.get("CF-Connecting-IP"),
        (request.headers.get("User-Agent") ?? "").slice(0, 300),
      ).run();
    } catch (e) {
      if (String(e).includes("no such table")) {
        return err("migration_missing", "Run: npx wrangler d1 migrations apply azoneofficial --remote (0044_overtime)", 500);
      }
      throw e;
    }
    const hhmm = mytNow.toISOString().slice(11, 16);
    return json({ ok: true, at: hhmm }, 201);
  }

  if (path === "/attendance" && method === "GET") {
    const url = new URL(request.url);
    const month = url.searchParams.get("month") ?? new Date().toISOString().slice(0, 7);
    const targetUser = url.searchParams.get("user_id");
    /* v1.91.0 — whoever may correct a register may read it: COO and CCO
       were handed the corrections card and then shown their own punches. */
    const forUser = targetUser && (can(user.role, "hr_manage") || can(user.role, "attendance_correct")) ? Number(targetUser) : user.id;
    // v1.9.1: the selfie step was replaced by the office geofence, so
    // selfie_key no longer rides along (nothing in the UI rendered it).
    // Selfies already in R2 stay behind the owner/HR media gate.
    const results = (await env.DB.prepare(
      `SELECT type, ip, created_at FROM attendance_records
       WHERE user_id = ?1 AND created_at LIKE ?2 || '%'
       ORDER BY created_at DESC LIMIT 400`,
    ).bind(forUser, month).all()).results;
    // v1.4.155: overtime punches ride along (own dashboard + HR views). Guarded
    // so the endpoint keeps working before migration 0044 lands.
    let ot: unknown[] = [];
    try {
      const o = await env.DB.prepare(
        `SELECT type, created_at FROM ot_records
         WHERE user_id = ?1 AND created_at LIKE ?2 || '%'
         ORDER BY created_at DESC LIMIT 100`,
      ).bind(forUser, month).all();
      ot = o.results;
    } catch { /* table not migrated yet — return empty */ }
    // Eligibility flag drives whether the dashboard shows the OT buttons at
    // all. v1.4.156: by employment_status (v1.4.155 queried a non-existent
    // `status` column), and by STATUS ONLY — permanent live hosts are
    // eligible; part-time anything is not.
    const meRow = await env.DB.prepare(`SELECT employment_status FROM users WHERE id = ?1`)
      .bind(user.id).first<{ employment_status: string | null }>();
    // v1.4.158: executives (ceo/coo/cco) and admin-tier accounts never get
    // the OT buttons, alongside the part-time exclusion.
    const ot_eligible = !["ceo", "coo", "cco", "super_admin", "admin"].includes(user.role)
      && meRow?.employment_status !== "part_time";
    return json({ month, records: results, ot, ot_eligible });
  }

  if (path === "/attendance/monitor" && method === "GET") {
    /* v1.4.173 (CEO: "monitoring of the Staff who is not clock in or clock
       out for me to aware"): today's snapshot per active staff member —
       first clock-in and last clock-out (MYT). The UI sorts the missing
       ones to the top. Same readers as the Team report. */
    if (!can(user.role, "hr_manage") && !can(user.role, "exec_view")) {
      return err("forbidden", "HR access required", 403);
    }
    const todayM = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
    const { results } = await env.DB.prepare(
      `SELECT u.id, COALESCE(NULLIF(TRIM(u.full_name), ''), u.name) AS name, u.role, u.employment_status,
              /* v1.4.177 HOTFIX: punches are stored as clock_in/clock_out —
                 v1.4.173 filtered on 'in'/'out', matched nothing, and showed
                 EVERYONE as not clocked in despite real data. */
              (SELECT MIN(a.created_at) FROM attendance_records a
                WHERE a.user_id = u.id AND a.type = 'clock_in'  AND date(a.created_at, '+8 hours') = ?1) AS in_at,
              (SELECT MAX(a.created_at) FROM attendance_records a
                WHERE a.user_id = u.id AND a.type = 'clock_out' AND date(a.created_at, '+8 hours') = ?1) AS out_at,
              /* v1.18.1 (CEO: "get user clock in accurately without cheating"):
                 the position stored on the FIRST clock-in of the day, so
                 management sees where each punch happened. */
              (SELECT a.gps FROM attendance_records a
                WHERE a.user_id = u.id AND a.type = 'clock_in' AND date(a.created_at, '+8 hours') = ?1
                ORDER BY a.created_at LIMIT 1) AS in_gps
       FROM users u
       WHERE u.is_active = 1
         AND u.role IN ('ceo','coo','cco','hr_admin','sales_marketing','marketing','editor','live_host')
         AND COALESCE(u.employment_status, 'permanent') NOT IN ('resigned','terminated')
       ORDER BY u.name`,
    ).bind(todayM).all();
    // v1.21.0: ship the fence with the list so management screens flag
    // "outside office" against the REAL configured fence (not a client
    // constant that could drift from it).
    return json({ date: todayM, staff: results, geofence: await getGeofence(env) });
  }

  /* ============ v1.84.0 — the month, reconciled ============
   *
   * CEO, 03-09-2026: *"attendance verification should move to Attendance and
   * make it minimalist interface, then it is should include for the staff
   * which is on leave, or medical leave. full report is require and a must!"*
   *
   * The verification card was a flat list of every punch in the month, on the
   * HR tab, with a Shift check badge beside each. Hundreds of rows, one per
   * ketukan, and nothing that added up. Worse: a person on medical leave for
   * a week simply had no rows, which is indistinguishable from a person who
   * never came in - the two things a verification report exists to tell
   * apart.
   *
   * THE PROPERTY THAT MAKES THIS A REPORT: every scheduled working day of the
   * month lands in exactly one bucket, and the buckets sum to the scheduled
   * days. Worked + leave + absent = scheduled. A row that does not add up is
   * a row with a question in it, and the report says so on the row rather
   * than leaving it to be discovered against a payslip.
   *
   * Public holidays and rest days are NOT scheduled working days and are
   * counted separately - a person is not absent from a day they were never
   * due to work, and the split-shift schedule (0102) is what decides which
   * days those are, per person, rather than an assumption about Saturdays.
   */
  if (path === "/attendance/verification" && method === "GET") {
    if (!can(user.role, "hr_manage") && !can(user.role, "exec_view")) {
      return err("forbidden", "HR access required", 403);
    }
    const urlV = new URL(request.url);
    const monthV = urlV.searchParams.get("month") ?? new Date().toISOString().slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(monthV)) return err("invalid_input", "month must be YYYY-MM", 400);

    const [yV, mV] = monthV.split("-").map(Number) as [number, number];
    const lastV = new Date(Date.UTC(yV, mV, 0)).getUTCDate();
    const daysV: string[] = [];
    for (let d = 1; d <= lastV; d++) daysV.push(`${monthV}-${String(d).padStart(2, "0")}`);
    const todayV = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);

    const { results: staffV } = await env.DB.prepare(
      `SELECT u.id, COALESCE(NULLIF(TRIM(u.full_name), ''), u.name) AS name, u.email,
              u.employee_id, u.position, u.role, u.employment_status,
              u.joined_on, u.left_on, u.rejoined_on
         FROM users u
        WHERE ${staffRolesSql("u.")} AND (u.is_active = 1 OR u.left_on IS NOT NULL)
          AND ${payrollMonthStaffSql(monthV, "u.")}
        ORDER BY ${STAFF_ORDER_SQL}`,
    ).all<{
      id: number; name: string; email: string | null; employee_id: string | null;
      position: string | null; role: string; employment_status: string | null;
      joined_on: string | null; left_on: string | null; rejoined_on: string | null;
    }>();

    const shiftAtV = await shiftResolver(env);
    const assignedAtV = await assignedResolver(env, `${monthV}-01`, `${monthV}-${lastV}`);
    const notPendingV = await notPendingSql(env);

    /* One clocked pair per person per day, in one query. */
    const { results: clockV } = await env.DB.prepare(
      `SELECT user_id, date(created_at, '+8 hours') AS d,
              MIN(CASE WHEN type = 'clock_in'  THEN created_at END) AS i,
              MAX(CASE WHEN type = 'clock_out' THEN created_at END) AS o
         FROM attendance_records
        WHERE strftime('%Y-%m', created_at, '+8 hours') = ?1${notPendingV}
        GROUP BY user_id, d`,
    ).bind(monthV).all<{ user_id: number; d: string; i: string | null; o: string | null }>();
    const clockMap = new Map((clockV ?? []).map((c) => [`${c.user_id}|${c.d}`, c]));

    /* Approved leave overlapping the month, by OVERLAP for the same reason
       the register uses it: a leave from 29 August covers 1 September too. */
    let leaveRows: { user_id: number; type: string; start_date: string; end_date: string; days: number | null }[] = [];
    try {
      leaveRows = ((await env.DB.prepare(
        `SELECT user_id, type, start_date, end_date, days FROM leave_requests
          WHERE status = 'approved' AND start_date <= ?1 AND end_date >= ?2`,
      ).bind(`${monthV}-${lastV}`, `${monthV}-01`).all<{ user_id: number; type: string; start_date: string; end_date: string; days: number | null }>()).results) ?? [];
    } catch { /* pre-leave_requests */ }

    let holsV: string[] = [];
    try {
      holsV = ((await env.DB.prepare(
        `SELECT holiday_date FROM holidays WHERE holiday_date LIKE ?1 || '%'`,
      ).bind(monthV).all<{ holiday_date: string }>()).results ?? []).map((h) => h.holiday_date);
    } catch { /* pre-holidays */ }
    const holSet = new Set(holsV);

    const out: Record<string, unknown>[] = [];
    for (const u of staffV ?? []) {
      /* Only days this person was actually employed - a joiner is not absent
         from the fortnight before they started. */
      const mine = employedDays(daysV, u.joined_on, u.left_on, u.rejoined_on);
      const byType: Record<string, number> = {};
      let scheduled = 0, worked = 0, restDays = 0, publicHols = 0, absent = 0;
      let late = 0, earlyOut = 0, shortDays = 0, assignedDays = 0, noClockOut = 0;
      let schedMins = 0, workedMins = 0;
      const absentDates: string[] = [];
      const leaveDates: { d: string; type: string }[] = [];
      /* v1.84.1 - a day clocked IN and never OUT counts as a day worked and
         contributes NO hours, which is how a row reads "19 worked" beside
         "46h34 of 131h" and looks like a mystery. It is not a mystery and it
         is not an absence: it is a missing punch, and the report names it. */
      const openDates: string[] = [];

      for (const d of mine) {
        const sh = shiftAtV(u.id, d);
        const lv = leaveRows.find((l) => l.user_id === u.id && l.start_date <= d && l.end_date >= d);
        if (sh.kind === "rest_day") { restDays++; continue; }
        if (holSet.has(d)) { publicHols++; continue; }
        scheduled++;
        schedMins += workMinutes(sh);
        if (lv) {
          byType[lv.type] = (byType[lv.type] ?? 0) + 1;
          leaveDates.push({ d, type: lv.type });
          continue;
        }
        const c = clockMap.get(`${u.id}|${d}`);
        if (!c?.i) {
          /* A day still in the future, or today before anybody has clocked,
             is not an absence yet. */
          if (d <= todayV) { absent++; absentDates.push(d); }
          continue;
        }
        worked++;
        const mytMin = (iso: string) => {
          const t = new Date(new Date(iso + "Z").getTime() + 8 * 3600 * 1000);
          return t.getUTCHours() * 60 + t.getUTCMinutes();
        };
        const inMin = mytMin(c.i);
        if (assignedAtV(u.id, d, inMin) && !windowAt(sh, inMin)) assignedDays++;
        else if (inMin > (lateAgainst(sh, inMin) ?? 0)) late++;
        if (!c.o) { noClockOut++; openDates.push(d); }
        if (c.o) {
          const outMin = mytMin(c.o);
          const span = Math.max(0, Math.round((new Date(c.o + "Z").getTime() - new Date(c.i + "Z").getTime()) / 60000));
          const inside = minutesInWindows(sh, inMin, inMin + span);
          const mins = inside > 0 ? inside : span;
          workedMins += mins;
          const owed = workMinutes(sh) || WORK_DAY_MINUTES;
          if (outMin < (endOfDay(sh) ?? 0)) earlyOut++;
          if (owed - mins >= owed / 4) shortDays++;
        }
      }
      const leaveTotal = Object.values(byType).reduce((n, x) => n + x, 0);
      out.push({
        user_id: u.id, name: u.name, email: u.email, employee_id: u.employee_id,
        position: u.position, role: u.role, employment_status: u.employment_status,
        scheduled, worked, leave_total: leaveTotal, leave_by_type: byType,
        absent, rest_days: restDays, public_holidays: publicHols,
        late, early_out: earlyOut, short_days: shortDays, assigned_days: assignedDays,
        no_clock_out: noClockOut, open_dates: openDates,
        scheduled_minutes: schedMins, worked_minutes: workedMins,
        absent_dates: absentDates, leave_dates: leaveDates,
        /* THE RECONCILIATION. If this is false the row has a question in it,
           and the report says so rather than leaving it to be found against a
           payslip three weeks later. */
        balances: worked + leaveTotal + absent === scheduled,
      });
    }
    return json({ month: monthV, days: daysV.length, staff: out });
  }

  if (path === "/attendance/report" && method === "GET") {
    // HR + CEO manage; COO/CCO (exec_view) read.
    if (!can(user.role, "hr_manage") && !can(user.role, "exec_view")) {
      return err("forbidden", "HR access required", 403);
    }
    const url = new URL(request.url);
    const month = url.searchParams.get("month") ?? new Date().toISOString().slice(0, 7);
    /* The pending flag only exists after 0100; ask for it only then. */
    const pendingCol = (await notPendingSql(env)) ? ", a.pending_approval" : "";
    const { results } = await env.DB.prepare(
      `SELECT a.id, COALESCE(NULLIF(TRIM(u.full_name), ''), u.name) AS name, u.email, u.role, a.user_id, a.type, a.created_at, a.manual_by, a.amended_by, a.gps${pendingCol}
       FROM attendance_records a JOIN users u ON u.id = a.user_id
       WHERE a.created_at LIKE ?1 || '%' ORDER BY a.created_at`,
    ).bind(month).all();
    /* v1.76.0 — annotated against EACH PERSON'S schedule on that date, not
       one company shift. `day_kind` is what makes weekend answerable per
       staff member: a pattern with no hours on Saturday makes Saturday a rest
       day for them, and somebody whose pattern works Saturday is not "on the
       weekend" at all. `pending` marks a punch that is a claim, not a record.
       v1.77.0 — the whole schedule is read ONCE before the loop. This used to
       cache per (person, date), which still meant a pair of database queries
       for every new day in the month. */
    const shiftAtR = await shiftResolver(env);
    /* v1.80.0 — the month's rosters and live sessions, read ONCE for the same
       reason the schedule is: this loop runs over every punch in the month. */
    const assignedAtR = await assignedResolver(env, `${month}-01`, `${month}-31`);
    const annotated: Record<string, unknown>[] = [];
    for (const r of results as { user_id: number; created_at: string; type: string; pending_approval?: number | null }[]) {
      const myt = new Date(new Date(r.created_at + "Z").getTime() + 8 * 3600 * 1000);
      const minutes = myt.getUTCHours() * 60 + myt.getUTCMinutes();
      const dateIso = myt.toISOString().slice(0, 10);
      const shR = shiftAtR(r.user_id, dateIso);
      const inWin = windowAt(shR, minutes);
      const asg = inWin ? null : assignedAtR(r.user_id, dateIso, minutes);
      annotated.push({
        ...r,
        myt_time: myt.toISOString().slice(0, 16).replace("T", " "),
        workday: shR.kind === "workday",
        day_kind: shR.kind,
        /* Both blocks, so a split day reads "11:00-17:00 + 20:30-22:30" and
           the CEO can see the eight hours rather than infer them. */
        shift_label: shiftLabel(shR),
        scheduled_minutes: scheduledMinutes(shR),
        break_minutes: breakFor(shR),
        work_minutes: workMinutes(shR),
        pending: r.pending_approval === 1,
        /* What vouched for a punch outside the pattern, by name — the client
           whose broadcast it was, or the task on the roster. */
        assigned_kind: asg?.kind ?? null,
        assigned_what: asg?.what ?? null,
        flag:
          asg ? "assigned"
          : shR.kind === "rest_day" ? "rest_day"
          : r.type === "clock_in"
            ? (minutes <= (lateAgainst(shR, minutes) ?? SHIFT.startMinutes) ? "ok" : minutes <= shR.halfDay ? "late" : "half_day")
            : (minutes < (endOfDay(shR) ?? SHIFT.endMinutes) ? "early_out" : "ok"),
      });
    }
    /* v1.82.0 (CEO: "find and filter should include UPL and also Leave on
       that month which is for me easier to pull the data") — a month of
       attendance without the leave beside it is a month with holes in it,
       and answering "why was nobody in on the 12th" meant opening the Leave
       tab and reading two screens against each other. The register carries
       the leave too now, so one filter and one CSV answer the question.
     *
     * OVERLAP, NOT start_date. Payroll attributes a leave to the month it
     * STARTS in - deliberately, and payslipExtras depends on it. This is a
     * different question: a leave from 29 August to 2 September means the
     * person was away on the 1st and 2nd, and a September register that
     * omitted those two days would be lying about September.
     *
     * APPROVED ONLY. A pending application is a request, not an absence -
     * the same rule the pending punch follows. */
    let leave: Record<string, unknown>[] = [];
    try {
      const { results: lv } = await env.DB.prepare(
        `SELECT l.id, l.user_id, COALESCE(NULLIF(TRIM(u.full_name), ''), u.name) AS name,
                u.email, u.role, l.type, l.start_date, l.end_date, l.days, l.reason
           FROM leave_requests l JOIN users u ON u.id = l.user_id
          WHERE l.status = 'approved'
            AND l.start_date <= ?1 || '-31' AND l.end_date >= ?1 || '-01'
          ORDER BY l.start_date, name`,
      ).bind(month).all<{
        id: number; user_id: number; name: string; email: string | null; role: string;
        type: string; start_date: string; end_date: string; days: number | null; reason: string | null;
      }>();
      /* ONE ROW PER DAY IN THE MONTH, not one per request. A CSV is only
         useful if a row is a person-day - the same shape as a punch - so a
         three-day leave can be counted, filtered and totalled beside the
         attendance rather than needing its date range unpacked by hand.
         A single-day request keeps its exact `days` (0.5 for the CEO's half
         day); a range spreads whole days and cannot claim a fraction. */
      for (const l of lv ?? []) {
        for (let d = new Date(`${l.start_date}T00:00:00Z`); ; d.setUTCDate(d.getUTCDate() + 1)) {
          const iso = d.toISOString().slice(0, 10);
          if (iso > l.end_date) break;
          if (!iso.startsWith(month)) continue;
          const sh = shiftAtR(l.user_id, iso);
          /* A rest day inside a leave range is not a day of leave - it is a
             weekend. Counting it would inflate every leave that spans one. */
          if (sh.kind === "rest_day") continue;
          leave.push({
            id: l.id, user_id: l.user_id, name: l.name, email: l.email, role: l.role,
            leave_type: l.type, date: iso, reason: l.reason,
            days: l.start_date === l.end_date ? (l.days ?? 1) : 1,
            day_kind: sh.kind, shift_label: shiftLabel(sh),
          });
        }
      }
    } catch { /* pre-leave_requests, or a column this database has not got */ }
    return json({ month, shift: "per staff schedule (v1.80.0, split shifts)", records: annotated, leave });
  }

  /* ---- leave ---- */

  if (path === "/leave" && method === "POST") {
    if (
      !body || typeof body.type !== "string" || !LEAVE_TYPES.includes(body.type as never) ||
      !str(body.start_date, 10) || !str(body.end_date, 10) ||
      typeof body.days !== "number" || body.days <= 0 || body.days > 60
    ) {
      return err("invalid_input", "type, start_date, end_date, and days are required", 400);
    }
    const res = await env.DB.prepare(
      `INSERT INTO leave_requests (user_id, type, start_date, end_date, days, reason, mc_media_id)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) RETURNING id`,
    ).bind(
      user.id, body.type, body.start_date, body.end_date, body.days,
      str(body.reason, 1000) ? body.reason : null,
      typeof body.mc_media_id === "number" ? body.mc_media_id : null,
    ).first<{ id: number }>();
    await stampIssuer(env, "leave_requests", res?.id);
    await audit(env, user.id, "leave.apply", "leave_requests", String(res?.id));
    return json({ id: res?.id }, 201);
  }

  if (path === "/leave" && method === "GET") {
    const url = new URL(request.url);
    /* v1.21.0 (CEO: "I can see who is the person that apply leave and
       waiting for their Head approval"): the whole approval chain reads the
       full list — HR tier (hr_manage) AND the COO/CCO pre-approvers, who
       previously fell through to "own requests only" and saw an empty
       board even with applications pending. */
    const all = url.searchParams.get("all") === "1" &&
      (can(user.role, "hr_manage") || PREAPP_ROLES.includes(user.role) || FINAL_ROLES.includes(user.role));
    // v1.4.134: identities + per-day sequence for the printable Leave
    // Application Form (mirrors the claim form's data needs).
    const LSEL = `SELECT l.*,
        (SELECT COUNT(*) FROM leave_requests l2 WHERE date(l2.created_at) = date(l.created_at) AND l2.id <= l.id) AS day_seq,
        u.name AS user_name, u.full_name AS user_full, u.position AS user_position, u.department AS user_department, u.role AS applicant_role,
        hu.name AS hr_by_name, pu.name AS preapp_by_name, pu.full_name AS preapp_by_full, pu.role AS preapp_by_role,
        fu.name AS final_by_name, fu.full_name AS final_by_full
      FROM leave_requests l JOIN users u ON u.id = l.user_id
      LEFT JOIN users hu ON hu.id = l.hr_by
      LEFT JOIN users pu ON pu.id = l.preapp_by
      LEFT JOIN users fu ON fu.id = l.final_by`;
    const { results } = await env.DB.prepare(
      all
        ? `${LSEL} ORDER BY l.created_at DESC LIMIT 200`
        : `${LSEL} WHERE l.user_id = ?1 ORDER BY l.created_at DESC LIMIT 100`,
    ).bind(...(all ? [] : [user.id])).all();
    return json({ leave: results });
  }

  if (path === "/leave/balance" && method === "GET") {
    const year = new Date().getFullYear();
    /* Monthly release (v1.4.30): entitlement accrues pro-rata over the months
       the company actually operates in the year — see leaveAccrual() at the
       top of this file, which is now the only place that rule is written.
       v1.62.0 adds the CEO's `adjust` and `used_adjust` on top. */
    const monthMYT = new Date(Date.now() + 8 * 3600 * 1000).getUTCMonth() + 1;
    const balances: Record<string, { entitled: number; used: number; accrued: number; adjust: number }> = {};
    for (const t of LEAVE_TYPES) {
      const row = await leaveBalanceRow(env, user.id, year, t);
      const used = await env.DB.prepare(
        `SELECT COALESCE(SUM(days), 0) AS used FROM leave_requests
         WHERE user_id = ?1 AND type = ?2 AND status = 'approved'
         AND start_date LIKE ?3 || '%'`,
      ).bind(user.id, t, String(year)).first<{ used: number }>();
      const entitled = row.entitled ?? DEFAULT_ENTITLEMENT[t] ?? 0;
      const adjust = row.adjust ?? 0;
      balances[t] = {
        entitled,
        used: (used?.used ?? 0) + (row.used_adjust ?? 0),
        accrued: leaveAccrual(t, entitled, year, monthMYT, adjust),
        adjust,
      };
    }
    return json({ year, month: monthMYT, balances });
  }

  /* ============ v1.83.0 — a leave you can correct or take back ============
   *
   * CEO, 03-09-2026: *"leave application and history I want to view and to
   * edit if necessary or to remove if require. filter by month"*
   *
   * A leave could be applied for, decided, and after that only READ. A wrong
   * date, a leave taken as annual that should have been medical, a request
   * approved twice - none of it could be corrected, and the only way out was
   * a second record that contradicted the first.
   *
   * BOTH ROUTES ARE THE CEO ALONE, and for the same reason `unpaid_leave` is:
   * a leave is a balance and, when it is unpaid, it is pay. An amendment is
   * not a smaller act than an approval - it can move a day between months,
   * turn a paid day unpaid, or delete a deduction somebody has already been
   * charged for. The chain that decided it stays visible; this sits beside
   * it, not inside it.
   *
   * EVERY CHANGE RECORDS WHAT IT REPLACED. Not a flag saying "edited" - the
   * whole previous row, in the audit log, the same standard the entitlement
   * editor holds itself to. A leave register where a figure can change and
   * the old one is gone is a register nobody can reconcile a payslip against.
   *
   * AND THE PERSON IS TOLD. A deduction somebody first hears about on pay
   * day is how trust in a payroll system ends, and that is as true of a
   * change to one as of the original.
   */
  const CEO_ONLY: readonly Role[] = ["super_admin", "ceo"];

  const leaveEdit = path.match(/^\/leave\/(\d+)\/amend$/);
  if (leaveEdit && method === "PUT") {
    if (!CEO_ONLY.includes(user.role)) {
      return err("forbidden", "Only the CEO can amend a leave record", 403);
    }
    const idE = Number(leaveEdit[1]);
    const before = await env.DB.prepare(
      `SELECT id, user_id, type, start_date, end_date, days, reason, status, stage
         FROM leave_requests WHERE id = ?1`,
    ).bind(idE).first<Record<string, unknown>>();
    if (!before) return err("not_found", "Leave request not found", 404);

    const typeE = str(body?.type, 30) ? String(body!.type) : String(before.type);
    if (!LEAVE_TYPES.includes(typeE as never)) {
      return err("invalid_input", `type must be one of: ${LEAVE_TYPES.join(", ")}`, 400);
    }
    const startE = str(body?.start_date, 10) ? String(body!.start_date) : String(before.start_date);
    const endE = str(body?.end_date, 10) ? String(body!.end_date) : String(before.end_date);
    for (const [label, d] of [["start_date", startE], ["end_date", endE]] as const) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return err("invalid_input", `${label} must be YYYY-MM-DD`, 400);
    }
    if (endE < startE) return err("invalid_input", "The end date is before the start date", 400);
    /* A year out is a typo in the year, and it would move the day into a
       payroll month nobody is looking at. Same rail as recording one. */
    const msE = Date.parse(`${startE}T00:00:00Z`);
    if (!Number.isFinite(msE) || Math.abs(msE - Date.now()) > 400 * 86400 * 1000) {
      return err("invalid_input", "That date is more than a year away - check the year", 400);
    }
    let daysE = typeof body?.days === "number" && Number.isFinite(body.days)
      ? Math.round(body.days * 4) / 4 : Number(before.days ?? 1);
    /* A range cannot be half a day, and a single day cannot be five: the
       figure has to be sayable about the dates it sits on. */
    const spanE = Math.round((Date.parse(`${endE}T00:00:00Z`) - msE) / 86400000) + 1;
    if (daysE <= 0) return err("invalid_input", "Days must be more than zero", 400);
    if (daysE > spanE) {
      return err("invalid_input", `Those dates are ${spanE} day(s) - the leave cannot be ${daysE}`, 400);
    }
    if (spanE > 1 && daysE % 1 !== 0) daysE = Math.round(daysE);
    const reasonE = body && "reason" in body
      ? (str(body.reason, 500) ? String(body.reason) : null)
      : (before.reason as string | null);

    await env.DB.prepare(
      `UPDATE leave_requests SET type = ?1, start_date = ?2, end_date = ?3, days = ?4, reason = ?5
        WHERE id = ?6`,
    ).bind(typeE, startE, endE, daysE, reasonE, idE).run();
    await notify(env, before.user_id as number, "leave",
      `Your ${typeE} leave has been amended to ${startE}${endE !== startE ? ` to ${endE}` : ""} (${daysE === 1 ? "1 day" : `${daysE} days`}). Check the Leave tab.`,
      `leave:amend:${idE}`);
    await audit(env, user.id, "leave.amend", "leave_requests", String(idE), {
      before, after: { type: typeE, start_date: startE, end_date: endE, days: daysE, reason: reasonE },
    });
    return json({ ok: true, id: idE, days: daysE });
  }

  const leaveDel = path.match(/^\/leave\/(\d+)$/);
  if (leaveDel && method === "DELETE") {
    if (!CEO_ONLY.includes(user.role)) {
      return err("forbidden", "Only the CEO can remove a leave record", 403);
    }
    const idX = Number(leaveDel[1]);
    const rowX = await env.DB.prepare(
      `SELECT id, user_id, type, start_date, end_date, days, reason, status, stage, recorded_direct
         FROM leave_requests WHERE id = ?1`,
    ).bind(idX).first<Record<string, unknown>>().catch(async () =>
      await env.DB.prepare(
        `SELECT id, user_id, type, start_date, end_date, days, reason, status, stage
           FROM leave_requests WHERE id = ?1`,
      ).bind(idX).first<Record<string, unknown>>());
    if (!rowX) return err("not_found", "Leave request not found", 404);
    await env.DB.prepare(`DELETE FROM leave_requests WHERE id = ?1`).bind(idX).run();
    await notify(env, rowX.user_id as number, "leave",
      `Your ${String(rowX.type)} leave on ${String(rowX.start_date)} has been removed from the record.`,
      `leave:remove:${idX}`);
    /* The whole row, because after this there is nothing left to compare a
       payslip against. */
    await audit(env, user.id, "leave.remove", "leave_requests", String(idX), { removed: rowX });
    return json({ ok: true });
  }

  const leaveMatch = path.match(/^\/leave\/(\d+)$/);
  if (leaveMatch && method === "PATCH") {
    const id = leaveMatch[1]!;
    const row = await env.DB.prepare(
      `SELECT l.user_id, l.stage, u.role AS applicant_role
       FROM leave_requests l JOIN users u ON u.id = l.user_id WHERE l.id = ?1`,
    ).bind(id).first<{ user_id: number; stage: string; applicant_role: string }>();
    if (!row) return err("not_found", "Leave request not found", 404);

    const action = body?.action;
    const comment = str(body?.comment, 500) ? (body!.comment as string) : null;

    /* v1.72.0 (CEO: "I want to have a function for me to approved the leave
       form of all the staff which is can by pass their HOD").

       The chain exists for a reason and stays exactly as it is: HR checks
       the balance, the COO or CCO pre-approves, the CEO signs. What it
       cannot survive is a person being away. A request stuck at HR while
       the applicant is already on the plane is not governance, it is a
       queue - and the CEO is the last signature on that form anyway, so
       nothing is being approved by someone who could not have approved it.

       The bypass is NOT a silent shortcut. hr_by and preapp_by stay NULL
       while final_by carries the CEO, and that shape is exactly what the
       printed form and the Leave tab read to say the stages were skipped -
       no extra column needed to tell the two paths apart. audit_log records
       the stage it jumped from. */
    const OVERRIDE_ROLES: readonly Role[] = ["super_admin", "ceo"];
    if (body?.override === true && !OVERRIDE_ROLES.includes(user.role)) {
      return err("forbidden", "Only the CEO can decide outside the approval chain", 403);
    }
    const override = body?.override === true;
    /* One rule the override does NOT relax: nobody signs their own leave.
       That is the whole integrity of the form. */
    if (override && row.user_id === user.id) {
      return err("forbidden", "You cannot approve your own leave", 403);
    }
    if (override && ["approved", "rejected", "cancelled"].includes(row.stage)) {
      return err("invalid_input", "This request is already closed", 400);
    }

    // Owner may cancel while the request is still moving.
    if (action === "cancel") {
      if (row.user_id !== user.id) return err("forbidden", "Not your request", 403);
      if (["approved", "rejected", "cancelled"].includes(row.stage)) {
        return err("invalid_input", "This request is already closed", 400);
      }
      await env.DB.prepare(`UPDATE leave_requests SET stage = 'cancelled', status = 'cancelled' WHERE id = ?1`).bind(id).run();
      return json({ ok: true });
    }

    // Reject at any active stage ends the request.
    if (action === "reject") {
      if (!override && !leaveCanActAt(user, row.stage, row.applicant_role, row.user_id)) {
        return err("forbidden", "You cannot act on this request at its current stage", 403);
      }
      await env.DB.prepare(
        `UPDATE leave_requests SET stage = 'rejected', status = 'rejected',
           review_comment = ?2, final_by = ?3, final_at = datetime('now') WHERE id = ?1`,
      ).bind(id, comment, user.id).run();
      await notify(env, row.user_id, "leave", `Your leave request #${id} was rejected`, `leave:${id}`);
      await audit(env, user.id, override ? "leave.override_reject" : "leave.reject", "leave_requests", id,
        override ? { from_stage: row.stage } : undefined);
      return json({ ok: true });
    }

    // Approve advances one stage along the applicant's chain.
    if (action === "approve") {
      /* The bypass: straight to fully approved from whatever stage it was
         sitting at, with the CEO as the final signature. */
      if (override) {
        await env.DB.prepare(
          `UPDATE leave_requests SET stage = 'approved', status = 'approved',
             review_comment = COALESCE(?2, review_comment),
             final_by = ?3, final_at = datetime('now') WHERE id = ?1`,
        ).bind(id, comment, user.id).run();
        await notify(
          env, row.user_id, "leave",
          `Your leave request #${id} was approved directly by the CEO`,
          `leave:${id}`,
        );
        await audit(env, user.id, "leave.override_approve", "leave_requests", id, {
          from_stage: row.stage, applicant: row.user_id,
        });
        return json({ ok: true, stage: "approved", bypassed_from: row.stage });
      }
      if (!leaveCanActAt(user, row.stage, row.applicant_role, row.user_id)) {
        return err("forbidden", "You cannot approve this request at its current stage", 403);
      }
      const next = leaveNextStage(row.stage, row.applicant_role);
      const done = next === "approved";
      const col =
        row.stage === "applied" ? "hr_by = ?3, hr_at = datetime('now')"
        : row.stage === "hr_reviewed" ? "preapp_by = ?3, preapp_at = datetime('now')"
        : "final_by = ?3, final_at = datetime('now')";
      await env.DB.prepare(
        `UPDATE leave_requests SET stage = ?2, status = ?4, review_comment = COALESCE(?5, review_comment), ${col} WHERE id = ?1`,
      ).bind(id, next, user.id, done ? "approved" : "pending", comment).run();
      await notify(
        env, row.user_id, "leave",
        done ? `Your leave request #${id} is fully approved`
             : `Your leave request #${id} advanced to ${leaveStageLabel(next)}`,
        `leave:${id}`,
      );
      await audit(env, user.id, `leave.advance.${next}`, "leave_requests", id);
      return json({ ok: true, stage: next });
    }
    return err("invalid_input", "action must be cancel, approve, or reject", 400);
  }

  /* ---- announcements ---- */

  if (path === "/announcements" && method === "GET") {
    const { results } = await env.DB.prepare(
      `SELECT a.*, (SELECT COUNT(*) FROM announcement_acks k
                    WHERE k.announcement_id = a.id AND k.user_id = ?1) AS acked
       FROM announcements a ORDER BY a.created_at DESC LIMIT 50`,
    ).bind(user.id).all();
    return json({ announcements: results });
  }
  if (path === "/announcements" && method === "POST") {
    if (!can(user.role, "team_manage")) return err("forbidden", "Management access required", 403);
    if (!body || !str(body.title, 200) || !str(body.body, 5000)) {
      return err("invalid_input", "title and body are required", 400);
    }
    const cats = ["news", "meeting", "holiday", "kpi", "training", "memo"]; // v1.4.215: internal memo
    const category = typeof body.category === "string" && cats.includes(body.category) ? body.category : "news";
    const res = await env.DB.prepare(
      `INSERT INTO announcements (title, body, category, created_by) VALUES (?1, ?2, ?3, ?4) RETURNING id`,
    ).bind(body.title, body.body, category, user.id).first<{ id: number }>();
    // Ring the bell: every active staff member gets a notification (and the
    // off-platform relay, when configured). The poster already knows.
    const { results: recipients } = await env.DB.prepare(
      `SELECT id FROM users WHERE ${staffRolesSql()} AND is_active = 1 AND ${currentStaffSql()} AND id != ?1`,
    ).bind(user.id).all();
    for (const r of recipients as { id: number }[]) {
      await notify(env, r.id, "announcement", `New announcement: ${body.title as string}`, `announcement:${res?.id}`);
    }
    await audit(env, user.id, "announcement.create", "announcements", String(res?.id));
    return json({ id: res?.id }, 201);
  }
  const ackMatch = path.match(/^\/announcements\/(\d+)\/ack$/);
  if (ackMatch && method === "POST") {
    await env.DB.prepare(
      `INSERT INTO announcement_acks (announcement_id, user_id) VALUES (?1, ?2)
       ON CONFLICT(announcement_id, user_id) DO NOTHING`,
    ).bind(ackMatch[1], user.id).run();
    return json({ ok: true });
  }

  /* ---- company events (v1.4.73) ---- */

  /* v1.4.274 — the .ics served over HTTPS, because the SHARE SHEET was the
     wrong door: iOS's share sheet does not offer Calendar as a target for
     .ics files, and Android's rarely does — so v1.4.264's "pick Calendar in
     the share sheet" ended nowhere and nothing saved. Navigating to a URL
     whose response is text/calendar IS the door both phones understand:
     iOS Safari shows its built-in event preview with "Add All", Android
     opens the file straight into Google Calendar's import dialog. Any staff
     role — same audience as the events list. */
  {
    const mIcs = path.match(/^\/events\/(\d+)\/ics$/);
    if (mIcs && method === "GET") {
      const ev = await env.DB.prepare(`SELECT id, title, category, event_date, start_time, end_time, location, details FROM events WHERE id = ?1`)
        .bind(Number(mIcs[1])).first<{ id: number; title: string; category: string; event_date: string; start_time: string | null; end_time: string | null; location: string | null; details: string | null }>();
      if (!ev) return err("not_found", "Event not found", 404);
      const esc = (t: string) => t.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
      const pad2 = (n: number) => String(n).padStart(2, "0");
      const fold = (line: string) => {
        const out: string[] = []; let t = line;
        while (t.length > 74) { out.push(t.slice(0, 74)); t = " " + t.slice(74); }
        out.push(t); return out.join("\r\n");
      };
      const [y, mo, d] = ev.event_date.split("-").map(Number);
      const lines: string[] = [
        "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//AZ ONE OFFICIAL//Staff Portal//EN", "METHOD:PUBLISH",
        "BEGIN:VEVENT",
        `UID:event-${ev.id}@azoneofficial.com`, // stable: re-adding UPDATES, never duplicates
        `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`,
        `SUMMARY:${esc(ev.title)}`,
      ];
      if (ev.start_time && /^\d{2}:\d{2}/.test(ev.start_time)) {
        const [sh, sm] = ev.start_time.split(":").map(Number);
        const startUtc = new Date(Date.UTC(y!, mo! - 1, d!, sh! - 8, sm!)); // MYT → UTC instant
        let endUtc: Date;
        if (ev.end_time && /^\d{2}:\d{2}/.test(ev.end_time)) {
          const [eh, em] = ev.end_time.split(":").map(Number);
          endUtc = new Date(Date.UTC(y!, mo! - 1, d!, eh! - 8, em!));
          if (endUtc <= startUtc) endUtc = new Date(startUtc.getTime() + 3600_000);
        } else endUtc = new Date(startUtc.getTime() + 3600_000);
        const z = (dt: Date) => `${dt.getUTCFullYear()}${pad2(dt.getUTCMonth() + 1)}${pad2(dt.getUTCDate())}T${pad2(dt.getUTCHours())}${pad2(dt.getUTCMinutes())}00Z`;
        lines.push(`DTSTART:${z(startUtc)}`, `DTEND:${z(endUtc)}`);
      } else {
        const next = new Date(Date.UTC(y!, mo! - 1, d! + 1)); // RFC 5545 DTEND is EXCLUSIVE
        lines.push(`DTSTART;VALUE=DATE:${y}${pad2(mo!)}${pad2(d!)}`,
                   `DTEND;VALUE=DATE:${next.getUTCFullYear()}${pad2(next.getUTCMonth() + 1)}${pad2(next.getUTCDate())}`);
      }
      if (ev.location) lines.push(`LOCATION:${esc(ev.location)}`);
      const desc = [ev.category ? `Category: ${ev.category}` : "", ev.details ?? ""].filter(Boolean).join("\n");
      if (desc) lines.push(`DESCRIPTION:${esc(desc)}`);
      lines.push(
        "BEGIN:VALARM", "TRIGGER:-PT15H", "ACTION:DISPLAY", `DESCRIPTION:${esc(ev.title)} — tomorrow`, "END:VALARM",
        "BEGIN:VALARM", "TRIGGER:-PT0M", "ACTION:DISPLAY", `DESCRIPTION:${esc(ev.title)}`, "END:VALARM",
        "END:VEVENT", "END:VCALENDAR",
      );
      const body = lines.map(fold).join("\r\n") + "\r\n";
      const slug = ev.title.replace(/[^\w-]+/g, "-").slice(0, 40) || "event";
      return new Response(body, {
        headers: {
          // inline (not attachment): iOS Safari only shows its calendar
          // preview for an inline text/calendar navigation.
          "Content-Type": "text/calendar; charset=utf-8",
          "Content-Disposition": `inline; filename="${ev.event_date}-${slug}.ics"`,
          "Cache-Control": "no-store",
        },
      });
    }
  }

  if (path === "/events" && method === "GET") {
    // Every staff member sees events. v1.4.76: includes the previous month
    // onwards so the calendar view can show recent history; the list view
    // filters to upcoming client-side.
    const { results } = await env.DB.prepare(
      `SELECT e.*, u.name AS created_by_name FROM events e
       LEFT JOIN users u ON u.id = e.created_by
       WHERE e.event_date >= date('now', '+8 hours', 'start of month', '-1 month')
       ORDER BY e.event_date ASC, e.start_time ASC LIMIT 200`,
    ).all();
    return json({ events: results });
  }
  if (path === "/events" && method === "POST") {
    if (!can(user.role, "events_manage")) return err("forbidden", "Management access required", 403);
    if (!body || !str(body.title, 200) || !/^\d{4}-\d{2}-\d{2}$/.test(String(body.event_date ?? ""))) {
      return err("invalid_input", "title and event_date (YYYY-MM-DD) are required", 400);
    }
    const cats = ["training", "class", "meeting", "event"];
    const category = typeof body.category === "string" && cats.includes(body.category) ? body.category : "event";
    const hhmm = (v: unknown) => (typeof v === "string" && /^\d{2}:\d{2}$/.test(v) ? v : null);
    const res = await env.DB.prepare(
      `INSERT INTO events (title, category, event_date, start_time, end_time, location, details, created_by)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8) RETURNING id`,
    ).bind(
      body.title, category, body.event_date,
      hhmm(body.start_time), hhmm(body.end_time),
      typeof body.location === "string" ? body.location.slice(0, 200) : null,
      typeof body.details === "string" ? body.details.slice(0, 2000) : null,
      user.id,
    ).first<{ id: number }>();
    // Ring the bell for every active staff member (same pattern as
    // announcements) — awareness is the whole point of this feature.
    const d = String(body.event_date);
    const dmy = `${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(0, 4)}`;
    const { results: recipients } = await env.DB.prepare(
      `SELECT id FROM users WHERE ${staffRolesSql()} AND is_active = 1 AND ${currentStaffSql()} AND id != ?1`,
    ).bind(user.id).all();
    for (const r of recipients as { id: number }[]) {
      await notify(env, r.id, "event", `Upcoming ${category}: ${body.title as string} on ${dmy}`, `event:${res?.id}`);
    }
    await audit(env, user.id, "event.create", "events", String(res?.id), { category, event_date: d });
    return json({ id: res?.id }, 201);
  }
  const evMatch = path.match(/^\/events\/(\d+)$/);
  if (evMatch && method === "PATCH") {
    if (!can(user.role, "events_manage")) return err("forbidden", "Management access required", 403);
    if (!body) return err("invalid_input", "No fields", 400);
    const sets: string[] = [];
    const vals: unknown[] = [];
    if (str(body.title, 200)) { sets.push(`title = ?${vals.length + 1}`); vals.push(body.title); }
    if (typeof body.event_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.event_date)) { sets.push(`event_date = ?${vals.length + 1}`); vals.push(body.event_date); }
    if (typeof body.category === "string" && ["training", "class", "meeting", "event"].includes(body.category)) { sets.push(`category = ?${vals.length + 1}`); vals.push(body.category); }
    for (const f of ["start_time", "end_time", "location", "details"] as const) {
      if (typeof body[f] === "string") { sets.push(`${f} = ?${vals.length + 1}`); vals.push((body[f] as string).slice(0, 2000) || null); }
    }
    if (sets.length === 0) return err("invalid_input", "No valid fields", 400);
    await env.DB.prepare(`UPDATE events SET ${sets.join(", ")} WHERE id = ?${vals.length + 1}`)
      .bind(...vals, evMatch[1]).run();
    await audit(env, user.id, "event.update", "events", evMatch[1]);
    return json({ ok: true });
  }
  if (evMatch && method === "DELETE") {
    if (!can(user.role, "events_manage")) return err("forbidden", "Management access required", 403);
    await env.DB.prepare(`DELETE FROM events WHERE id = ?1`).bind(evMatch[1]).run();
    await audit(env, user.id, "event.delete", "events", evMatch[1]);
    return json({ ok: true });
  }

  /* ---- expense claims (v1.4.75): CEO/COO/CCO/HR submit, CEO decides ---- */

  /* v1.4.106: role-based claim approval chains (mirrors the leave chain).
     staff  (marketing/sales_marketing/editor/live_host): HR review -> COO pre-approval -> CEO
     hr     (hr_admin):                                   CCO pre-approval -> CEO
     exec   (coo/cco):                                    CEO only
     top    (ceo/admin tier):                             CEO only */
  const claimChain = (role: string): "staff" | "hr" | "exec" | "top" =>
    ["marketing", "sales_marketing", "editor", "live_host"].includes(role) ? "staff"
      : role === "hr_admin" ? "hr"
        : ["coo", "cco"].includes(role) ? "exec" : "top";
  const notifyRoles = async (roles: string[], excludeId: number, message: string, ref: string) => {
    const { results } = await env.DB.prepare(
      `SELECT id FROM users WHERE role IN (${roles.map(() => "?").join(",")}) AND is_active = 1 AND ${currentStaffSql()}`,
    ).bind(...roles).all<{ id: number }>();
    for (const r of results) if (r.id !== excludeId) await notify(env, r.id, "claim", message, ref);
  };
  /* v1.4.175 (CEO: "how to counter this?"): a chain stage whose approver IS
     the payee is WAIVED BY DESIGN — the notification routes straight to the
     CEO instead of pinging someone who is forbidden from acting, and the CEO
     is told why. payeeRole is the payee's role (null = no payee). */
  const notifyClaimFirstStage = async (claimantRole: string, claimantName: string, claimId: string | number, cents: number, prefix: string, payeeRole?: string | null) => {
    const chain = claimChain(claimantRole);
    const msg = `${prefix}: ${claimantName} — RM ${(cents / 100).toFixed(2)}`;
    if (chain === "staff" && payeeRole !== "hr_admin") await notifyRoles(["hr_admin"], 0, `${msg} (HR review needed)`, `claim:${claimId}`);
    else if (chain === "hr" && payeeRole !== "cco") await notifyRoles(["cco"], 0, `${msg} (pre-approval needed)`, `claim:${claimId}`);
    else if (chain === "staff" || chain === "hr") await notifyRoles(["ceo"], 0, `${msg} (pre-approver is the payee — for your direct decision)`, `claim:${claimId}`);
    else await notifyRoles(["ceo"], 0, msg, `claim:${claimId}`);
  };
  if (path === "/claims" && method === "GET") {
    if (!can(user.role, "claims_submit")) return err("forbidden", "Claims access required", 403);
    // Deciders see everyone's claims (the approval queue); submitters their own.
    const all = can(user.role, "claims_decide");
    // v1.4.106: reviewers see the claims their stage covers, plus their own.
    // v1.4.173: py = the payee (who to actually PAY) — internal remark for
    // the CEO/admin tier + hr_admin only; stripped for everyone else below
    // and never printed on the claim form.
    const PAYEE_JOIN = ` LEFT JOIN users py ON py.id = c.payee_user_id`;
    const mkSel = (withPayee: boolean) => `SELECT c.*,
                  (SELECT COUNT(*) FROM claims c2 WHERE date(c2.created_at) = date(c.created_at) AND c2.id <= c.id) AS day_seq,
                  u.name AS claimant, u.full_name AS claimant_full, u.position AS claimant_position,
                  u.department AS claimant_department, u.role AS claimant_role,
                  d.name AS decided_by_name, d.full_name AS decided_by_full, hb.name AS hr_reviewed_by_name,
                  pb.name AS pre_approved_by_name, pb.full_name AS pre_approved_by_full, pb.role AS pre_approved_by_role${withPayee ? `,
                  py.name AS payee_name, py.full_name AS payee_full, py.role AS payee_role` : ""} FROM claims c
           LEFT JOIN users u ON u.id = c.user_id LEFT JOIN users d ON d.id = c.decided_by
           LEFT JOIN users hb ON hb.id = c.hr_reviewed_by LEFT JOIN users pb ON pb.id = c.pre_approved_by${withPayee ? PAYEE_JOIN : ""}`;
    const SEL = mkSel(true);
    const STAFF_CHAIN = "('marketing','sales_marketing','editor','live_host')";
    /* v1.4.174 (CEO: "if the payee is COO or CCO how? or on behalf of the
       staff how? they need to view what the claim status is"): the PAYEE
       always sees the claim raised in their name — every non-decider scope
       gains OR c.payee_user_id = me, so the person being paid can track the
       status (pending → approved → PAID) even though someone else submitted
       it. mkScope(false) keeps a pre-0051 fallback without the column. */
    const mkScope = (withPayee: boolean) => {
      const P = withPayee ? " OR c.payee_user_id = ?1" : "";
      return all ? ""
        // v1.4.121: HR keeps the full APPROVED history too (read-only, for
        // printing claim forms + payout proofs for compilation).
        : user.role === "hr_admin" ? ` WHERE (c.user_id = ?1 OR u.role IN ${STAFF_CHAIN} OR c.status = 'approved'${P})`
        : ["coo", "admin"].includes(user.role) ? ` WHERE (c.user_id = ?1 OR u.role IN ${STAFF_CHAIN}${P})`
          : user.role === "cco" ? ` WHERE (c.user_id = ?1 OR u.role = 'hr_admin'${P})`
            : ` WHERE (c.user_id = ?1${P})`;
    };
    let results: unknown[];
    try {
      results = (await env.DB.prepare(
        `${SEL}${mkScope(true)} ORDER BY CASE c.status WHEN 'pending' THEN 0 ELSE 1 END, c.created_at DESC LIMIT 200`,
      ).bind(...(all ? [] : [user.id])).all()).results;
    } catch {
      // pre-0051: same query without the payee join/columns/clause
      results = (await env.DB.prepare(
        `${mkSel(false)}${mkScope(false)} ORDER BY CASE c.status WHEN 'pending' THEN 0 ELSE 1 END, c.created_at DESC LIMIT 200`,
      ).bind(...(all ? [] : [user.id])).all()).results;
    }
    // v1.4.173/174: the payee remark stays a CEO/HR matter — EXCEPT on the
    // payee's OWN rows: whoever the money goes to (a staff member, the COO,
    // the CCO…) keeps the field on those rows so the banner and status make
    // sense to them. Everyone else still never receives it.
    if (!["super_admin", "admin", "ceo", "hr_admin"].includes(user.role)) {
      for (const r of results as Record<string, unknown>[]) {
        if (r.payee_user_id !== user.id) { delete r.payee_user_id; delete r.payee_name; delete r.payee_full; delete r.payee_role; }
      }
    }
    return json({ claims: results, can_decide: all });
  }
  const claimPayee = path.match(/^\/claims\/(\d+)\/payee$/);
  if (claimPayee && method === "POST") {
    /* v1.4.176 (CEO: "I want to know who is the payees and to insert the
       payees"): set or change the payee on an EXISTING claim — including
       ones approved before the payee feature existed. The payee is a
       payment-routing remark, not claim content, so this never restarts
       the chain; every change is audited with before → after. */
    if (!["super_admin", "admin", "ceo", "hr_admin"].includes(user.role)) {
      return err("forbidden", "Only the CEO, HR or the admin tier set the payee", 403);
    }
    const pid = typeof body?.payee_user_id === "number" ? Math.floor(body.payee_user_id) : NaN;
    if (!Number.isFinite(pid) || pid < 0) return err("invalid_input", "payee_user_id required (0 = pay the submitter)", 400);
    let cur: { id: number; payee_user_id?: number | null; status: string } | null = null;
    try {
      cur = await env.DB.prepare(`SELECT id, payee_user_id, status FROM claims WHERE id = ?1`).bind(claimPayee[1]).first();
    } catch {
      return err("migration_missing", "Run: npx wrangler d1 migrations apply azoneofficial --remote (0051_claim_payee)", 500);
    }
    if (!cur) return err("not_found", "Claim not found", 404);
    let newPayee: number | null = null;
    if (pid > 0) {
      const pu = await env.DB.prepare(
        `SELECT id FROM users WHERE id = ?1 AND is_active = 1 AND ${currentStaffSql()} AND role NOT IN ('customer')`,
      ).bind(pid).first<{ id: number }>();
      if (!pu) return err("invalid_input", "Payee must be an active staff account", 400);
      newPayee = pu.id;
    }
    if ((cur.payee_user_id ?? null) === newPayee) return json({ ok: true, unchanged: true });
    await env.DB.prepare(`UPDATE claims SET payee_user_id = ?1 WHERE id = ?2`).bind(newPayee, claimPayee[1]).run();
    await audit(env, user.id, "claim.payee_set", "claims", claimPayee[1],
      { from: cur.payee_user_id ?? null, to: newPayee, claim_status: cur.status });
    return json({ ok: true });
  }
  const claimReview = path.match(/^\/claims\/(\d+)\/review$/);
  if (claimReview && method === "POST") {
    // v1.4.106 stage 1 (staff chain only): HR reviews, then the COO pre-approves.
    if (!["hr_admin", "admin", "super_admin"].includes(user.role)) {
      return err("forbidden", "HR review is done by HR", 403);
    }
    const cr = await env.DB.prepare(
      `SELECT c.user_id, c.status, c.amount_cents, c.hr_reviewed_at, u.role AS claimant_role, u.name AS claimant_name
       FROM claims c LEFT JOIN users u ON u.id = c.user_id WHERE c.id = ?1`,
    ).bind(claimReview[1]).first<{ user_id: number; status: string; amount_cents: number; hr_reviewed_at: string | null; claimant_role: string; claimant_name: string }>();
    if (!cr) return err("not_found", "Claim not found", 404);
    if (cr.status !== "pending") return err("invalid_state", "Already decided", 400);
    if (claimChain(cr.claimant_role) !== "staff") return err("invalid_state", "This claim does not need an HR review", 400);
    if (cr.hr_reviewed_at) return err("invalid_state", "Already reviewed by HR", 400);
    if (cr.user_id === user.id) return err("forbidden", "No self-review", 403);
    // v1.4.174: the no-self-review principle covers the PAYEE too — whoever
    // the money goes to doesn't review that claim; the next stage / CEO does.
    try {
      const pv = await env.DB.prepare(`SELECT payee_user_id FROM claims WHERE id = ?1`)
        .bind(claimReview[1]).first<{ payee_user_id: number | null }>();
      if (pv?.payee_user_id === user.id) return err("forbidden", "This claim pays to you — the next stage or the CEO handles it (no self-review)", 403);
    } catch { /* pre-0051 — no payee column yet */ }
    await env.DB.prepare(
      `UPDATE claims SET hr_reviewed_by = ?1, hr_reviewed_at = datetime('now') WHERE id = ?2`,
    ).bind(user.id, claimReview[1]).run();
    await notifyRoles(["coo"], user.id, `Claim HR-reviewed, your pre-approval needed: ${cr.claimant_name} — RM ${(cr.amount_cents / 100).toFixed(2)}`, `claim:${claimReview[1]}`);
    await audit(env, user.id, "claim.hr_review", "claims", claimReview[1]!);
    return json({ ok: true });
  }
  const claimPre = path.match(/^\/claims\/(\d+)\/preapprove$/);
  if (claimPre && method === "POST") {
    // v1.4.106 stage 2: COO pre-approves staff-chain claims (after HR),
    // CCO pre-approves hr_admin claims. Admin tier as backstop.
    const cp = await env.DB.prepare(
      `SELECT c.user_id, c.status, c.amount_cents, c.hr_reviewed_at, c.pre_approved_at, u.role AS claimant_role, u.name AS claimant_name
       FROM claims c LEFT JOIN users u ON u.id = c.user_id WHERE c.id = ?1`,
    ).bind(claimPre[1]).first<{ user_id: number; status: string; amount_cents: number; hr_reviewed_at: string | null; pre_approved_at: string | null; claimant_role: string; claimant_name: string }>();
    if (!cp) return err("not_found", "Claim not found", 404);
    if (cp.status !== "pending") return err("invalid_state", "Already decided", 400);
    // v1.4.174: a COO/CCO who is the PAYEE of this claim doesn't pre-approve
    // it — conflict of interest; the CEO decides directly (override exists).
    try {
      const pvP = await env.DB.prepare(`SELECT payee_user_id FROM claims WHERE id = ?1`)
        .bind(claimPre[1]).first<{ payee_user_id: number | null }>();
      if (pvP?.payee_user_id === user.id) return err("forbidden", "This claim pays to you — the CEO decides it directly (no self-approval)", 403);
    } catch { /* pre-0051 */ }
    const chainP = claimChain(cp.claimant_role);
    const adminTier = ["admin", "super_admin"].includes(user.role);
    if (chainP === "staff") {
      if (user.role !== "coo" && !adminTier) return err("forbidden", "COO pre-approves staff claims", 403);
      if (!cp.hr_reviewed_at) return err("invalid_state", "HR review comes first", 400);
    } else if (chainP === "hr") {
      if (user.role !== "cco" && !adminTier) return err("forbidden", "CCO pre-approves HR claims", 403);
    } else {
      return err("invalid_state", "This claim goes straight to the CEO", 400);
    }
    if (cp.pre_approved_at) return err("invalid_state", "Already pre-approved", 400);
    if (cp.user_id === user.id) return err("forbidden", "No self-approval", 403);
    await env.DB.prepare(
      `UPDATE claims SET pre_approved_by = ?1, pre_approved_at = datetime('now') WHERE id = ?2`,
    ).bind(user.id, claimPre[1]).run();
    await notifyRoles(["ceo"], user.id, `Claim pre-approved, your FINAL approval needed: ${cp.claimant_name} — RM ${(cp.amount_cents / 100).toFixed(2)}`, `claim:${claimPre[1]}`);
    await audit(env, user.id, "claim.preapprove", "claims", claimPre[1]!);
    return json({ ok: true });
  }
  const claimEdit = path.match(/^\/claims\/(\d+)\/edit$/);
  if (claimEdit && method === "POST") {
    // v1.4.104: the claimant edits their own claim while it is PENDING, or
    // after a REJECTION — an edited rejected claim goes back to pending and
    // the CEO is notified of the resubmission. APPROVED claims are locked.
    if (!can(user.role, "claims_submit")) return err("forbidden", "Claims access required", 403);
    const cur = await env.DB.prepare(
      `SELECT user_id, status, paid_at FROM claims WHERE id = ?1`,
    ).bind(claimEdit[1]).first<{ user_id: number; status: string; paid_at: string | null }>();
    if (!cur) return err("not_found", "Claim not found", 404);
    if (cur.user_id !== user.id) return err("forbidden", "Only the claimant edits their claim", 403);
    if (cur.status === "approved" || cur.paid_at) return err("invalid_state", "Approved claims are locked — submit a new claim instead", 400);
    const catsE = ["travel", "meal", "accommodation", "equipment", "medical", "other"];
    if (!Array.isArray(body?.items) || body!.items.length === 0 || body!.items.length > 10) {
      return err("invalid_input", "1–10 items are required", 400);
    }
    const parsedE = (body!.items as { claim_date?: unknown; category?: unknown; description?: unknown; amount?: unknown }[])
      .map((i) => ({
        claim_date: typeof i.claim_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(i.claim_date) ? i.claim_date : null,
        category: typeof i.category === "string" && catsE.includes(i.category) ? i.category : "other",
        description: typeof i.description === "string" ? i.description.slice(0, 300) : "",
        amount_cents: Math.round(Number(i.amount) * 100),
      }));
    if (parsedE.some((i) => !i.claim_date || !Number.isFinite(i.amount_cents) || i.amount_cents <= 0 || i.amount_cents > 100000000)) {
      return err("invalid_input", "Every item needs a date and a positive amount", 400);
    }
    const centsE = parsedE.reduce((a, i) => a + i.amount_cents, 0);
    const purposeE = typeof body?.purpose === "string" ? body.purpose.slice(0, 1000) : null;
    const wasRejected = cur.status === "rejected";
    await env.DB.prepare(
      `UPDATE claims SET claim_date = ?1, category = ?2, amount_cents = ?3, description = ?4, items = ?5,
       status = 'pending', decided_by = NULL, decided_at = NULL, decision_note = NULL,
       hr_reviewed_by = NULL, hr_reviewed_at = NULL, pre_approved_by = NULL, pre_approved_at = NULL WHERE id = ?6`,
    ).bind(parsedE[0]!.claim_date, parsedE[0]!.category, centsE, purposeE, JSON.stringify(parsedE), claimEdit[1]).run();
    // v1.4.173: payee remark travels with the edit (undefined = unchanged; 0 clears).
    if (typeof body?.payee_user_id === "number") {
      try {
        await env.DB.prepare(`UPDATE claims SET payee_user_id = ?1 WHERE id = ?2`)
          .bind(body.payee_user_id > 0 ? body.payee_user_id : null, claimEdit[1]).run();
      } catch { /* pre-0051 — ignore */ }
    }
    // v1.4.106: an edit restarts the chain from stage one.
    // v1.4.175: with the payee's role, so a conflicted stage reroutes to the CEO.
    let payeeRoleE: string | null = null;
    try {
      const prE = await env.DB.prepare(
        `SELECT py.role AS r FROM claims c LEFT JOIN users py ON py.id = c.payee_user_id WHERE c.id = ?1`,
      ).bind(claimEdit[1]).first<{ r: string | null }>();
      payeeRoleE = prE?.r ?? null;
    } catch { /* pre-0051 */ }
    await notifyClaimFirstStage(user.role, user.name, claimEdit[1]!, centsE,
      wasRejected ? "Resubmitted after rejection" : "Updated claim", payeeRoleE);
    await audit(env, user.id, wasRejected ? "claim.resubmit" : "claim.edit", "claims", claimEdit[1]!, { amount_cents: centsE });
    return json({ ok: true, resubmitted: wasRejected });
  }
  const claimDel = path.match(/^\/claims\/(\d+)\/delete$/);
  if (claimDel && method === "POST") {
    // v1.4.133: the claimant can DELETE their own claim while it is still
    // pending or rejected (not valid / submitted by mistake). Approved and
    // paid claims are records — never deletable.
    const rowD = await env.DB.prepare(`SELECT user_id, status, paid_at, receipt_key FROM claims WHERE id = ?1`)
      .bind(claimDel[1]).first<{ user_id: number; status: string; paid_at: string | null; receipt_key: string | null }>();
    if (!rowD) return err("not_found", "Claim not found", 404);
    if (rowD.user_id !== user.id) return err("forbidden", "Not your claim", 403);
    if (rowD.status === "approved" || rowD.paid_at) return err("invalid_state", "An approved or paid claim is a permanent record and cannot be deleted", 400);
    if (rowD.receipt_key) { try { await env.MEDIA.delete(rowD.receipt_key); } catch { /* best effort */ } }
    await env.DB.prepare(`DELETE FROM claims WHERE id = ?1`).bind(claimDel[1]).run();
    await audit(env, user.id, "claim.delete", "claims", claimDel[1]!, { status: rowD.status });
    return json({ ok: true });
  }
  const claimProof = path.match(/^\/claims\/(\d+)\/payment-proof$/);
  if (claimProof && method === "POST") {
    // v1.4.118: the payout proof (bank slip) — CEO only, after Mark paid.
    if (!can(user.role, "claims_decide")) return err("forbidden", "Only the CEO attaches payment proof", 403);
    const rowP = await env.DB.prepare(`SELECT status, paid_at, user_id FROM claims WHERE id = ?1`)
      .bind(claimProof[1]).first<{ status: string; paid_at: string | null; user_id: number }>();
    if (!rowP) return err("not_found", "Claim not found", 404);
    if (!rowP.paid_at) return err("invalid_state", "Mark the claim paid first, then attach the payment proof", 400);
    const ctP = request.headers.get("content-type") ?? "image/jpeg";
    if (!["application/pdf", "image/jpeg", "image/png"].includes(ctP)) return err("invalid_input", "Only PDF/JPEG/PNG proofs allowed", 400);
    const lenP = Number(request.headers.get("content-length") ?? 0);
    if (lenP > 8 * 1024 * 1024) return err("too_large", "Payment proof too large — maximum 8 MB.", 413);
    if (!request.body) return err("invalid_input", "Payment proof body required", 400);
    const keyP = `claims/${claimProof[1]}-proof-${Date.now()}`;
    await env.MEDIA.put(keyP, request.body, { httpMetadata: { contentType: ctP } });
    await env.DB.prepare(`UPDATE claims SET payment_proof_key = ?1 WHERE id = ?2`).bind(keyP, claimProof[1]).run();
    await notify(env, rowP.user_id, "claim", "Payment proof for your claim has been attached — view it on your claim", `claim:${claimProof[1]}`);
    await audit(env, user.id, "claim.payment_proof", "claims", claimProof[1]!);
    return json({ ok: true });
  }
  if (claimProof && method === "GET") {
    const rowG = await env.DB.prepare(`SELECT user_id, payment_proof_key FROM claims WHERE id = ?1`)
      .bind(claimProof[1]).first<{ user_id: number; payment_proof_key: string | null }>();
    if (!rowG?.payment_proof_key) return err("not_found", "No payment proof attached", 404);
    // v1.4.121: HR reads payout proofs for compilation (proof exists ⇒ paid).
    if (rowG.user_id !== user.id && !can(user.role, "claims_decide") && user.role !== "hr_admin") return err("forbidden", "Not your claim", 403);
    const objP = await env.MEDIA.get(rowG.payment_proof_key);
    if (!objP) return err("not_found", "Payment proof file missing", 404);
    return new Response(objP.body, { headers: { "Content-Type": objP.httpMetadata?.contentType ?? "application/octet-stream", "Cache-Control": "private, max-age=300" } });
  }
  const claimPaid = path.match(/^\/claims\/(\d+)\/paid$/);
  if (claimPaid && method === "POST") {
    // v1.4.101: after approval the CEO records the actual payment — the
    // claimant sees PAID and the date on their submission.
    if (!can(user.role, "claims_decide")) return err("forbidden", "Only the CEO marks claims paid", 403);
    const cRow = await env.DB.prepare(`SELECT user_id, status, amount_cents FROM claims WHERE id = ?1`)
      .bind(claimPaid[1]).first<{ user_id: number; status: string; amount_cents: number }>();
    if (!cRow) return err("not_found", "Claim not found", 404);
    if (cRow.status !== "approved") return err("invalid_input", "Only approved claims can be marked paid", 400);
    await env.DB.prepare(`UPDATE claims SET paid_at = COALESCE(paid_at, datetime('now')) WHERE id = ?1`)
      .bind(claimPaid[1]).run();
    // v1.19.0 C2: the reimbursement becomes a bank movement, once.
    await recordBankMovement(env, user.id, `CLM-${claimPaid[1]}`, cRow.amount_cents, "claims", "Staff claim reimbursement");
    await notify(env, cRow.user_id, "claim", `Your claim (RM ${(cRow.amount_cents / 100).toFixed(2)}) has been PAID`, `claim:${claimPaid[1]}`);
    await audit(env, user.id, "claim.paid", "claims", claimPaid[1]!);
    return json({ ok: true });
  }
  if (path === "/claims" && method === "POST") {
    if (!can(user.role, "claims_submit")) return err("forbidden", "Claims access required", 403);
    const cats = ["travel", "meal", "accommodation", "equipment", "medical", "other"];
    // v1.4.95: multi-item claims — one form, several expense lines, exactly
    // like the paper AZOO-HR-CLM-001. Legacy single-line submissions still work.
    let itemsJson: string | null = null;
    let cents = 0;
    let claimDate = "";
    let category = "other";
    if (Array.isArray(body?.items) && body!.items.length > 0) {
      if (body!.items.length > 10) return err("invalid_input", "At most 10 items per claim", 400);
      const parsed = (body!.items as { claim_date?: unknown; category?: unknown; description?: unknown; amount?: unknown }[])
        .map((i) => ({
          claim_date: typeof i.claim_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(i.claim_date) ? i.claim_date : null,
          category: typeof i.category === "string" && cats.includes(i.category) ? i.category : "other",
          description: typeof i.description === "string" ? i.description.slice(0, 300) : "",
          amount_cents: Math.round(Number(i.amount) * 100),
        }));
      if (parsed.some((i) => !i.claim_date || !Number.isFinite(i.amount_cents) || i.amount_cents <= 0 || i.amount_cents > 100000000)) {
        return err("invalid_input", "Every item needs a date and a positive amount", 400);
      }
      cents = parsed.reduce((a, i) => a + i.amount_cents, 0);
      claimDate = parsed[0]!.claim_date as string;
      category = parsed[0]!.category;
      itemsJson = JSON.stringify(parsed);
    } else {
      cents = Math.round(Number(body?.amount) * 100);
      if (!body || !/^\d{4}-\d{2}-\d{2}$/.test(String(body.claim_date ?? "")) || !Number.isFinite(cents) || cents <= 0 || cents > 100000000) {
        return err("invalid_input", "claim_date (YYYY-MM-DD) and a positive amount are required", 400);
      }
      claimDate = body.claim_date as string;
      category = typeof body.category === "string" && cats.includes(body.category) ? body.category : "other";
    }
    const purpose = typeof body?.purpose === "string" ? body.purpose.slice(0, 1000)
      : typeof body?.description === "string" ? body.description.slice(0, 1000) : null;
    /* v1.4.173 (CEO): the PAYEE — who the claim money actually goes to when
       HR raises a claim on behalf of someone. Internal remark only: never
       printed on the form; surfaced to the CEO/admin tier + hr_admin. */
    let payeeId: number | null = null;
    let payeeRole: string | null = null; // v1.4.175: drives conflict rerouting
    if (typeof body?.payee_user_id === "number" && body.payee_user_id > 0) {
      const pu = await env.DB.prepare(
        `SELECT id, role FROM users WHERE id = ?1 AND is_active = 1 AND ${currentStaffSql()} AND role NOT IN ('customer')`,
      ).bind(body.payee_user_id).first<{ id: number; role: string }>();
      if (!pu) return err("invalid_input", "Payee must be an active staff account", 400);
      payeeId = pu.id;
      payeeRole = pu.role;
    }
    let res: { id: number } | null = null;
    try {
      res = await env.DB.prepare(
        `INSERT INTO claims (user_id, claim_date, category, amount_cents, description, items, payee_user_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) RETURNING id`,
      ).bind(user.id, claimDate, category, cents, purpose, itemsJson, payeeId).first<{ id: number }>();
    } catch (e) {
      if (!String(e).includes("no such column")) throw e;
      if (payeeId !== null) return err("migration_missing", "Run: npx wrangler d1 migrations apply azoneofficial --remote (0051_claim_payee)", 500);
      res = await env.DB.prepare(
        `INSERT INTO claims (user_id, claim_date, category, amount_cents, description, items)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6) RETURNING id`,
      ).bind(user.id, claimDate, category, cents, purpose, itemsJson).first<{ id: number }>();
    }
    // v1.4.106: tell the FIRST stage of this claimant's chain.
    await stampIssuer(env, "claims", res?.id);
    await notifyClaimFirstStage(user.role, user.name, res?.id ?? 0, cents, "New claim", payeeRole);
    await audit(env, user.id, "claim.create", "claims", String(res?.id), { category, amount_cents: cents, ...(payeeId ? { payee_user_id: payeeId } : {}) });
    return json({ id: res?.id }, 201);
  }
  const clMatch = path.match(/^\/claims\/(\d+)(\/receipt|\/decide)?$/);
  if (clMatch && clMatch[2] === "/receipt" && method === "POST") {
    if (!can(user.role, "claims_submit")) return err("forbidden", "Claims access required", 403);
    const row = await env.DB.prepare(`SELECT user_id, status FROM claims WHERE id = ?1`).bind(clMatch[1]).first<{ user_id: number; status: string }>();
    if (!row) return err("not_found", "Claim not found", 404);
    if (row.user_id !== user.id) return err("forbidden", "Only the claimant attaches receipts", 403);
    if (!["pending", "rejected"].includes(row.status)) return err("invalid_state", "Approved claims are locked", 400);
    const ct = request.headers.get("content-type") ?? "image/jpeg";
    if (!["application/pdf", "image/jpeg", "image/png"].includes(ct)) return err("invalid_input", "Only PDF/JPEG/PNG receipts allowed", 400);
    // v1.4.110: hard size cap so staff get a clear message instead of a
    // silent failure. 8 MB is generous — receipts compress to ~200 KB.
    const lenR = Number(request.headers.get("content-length") ?? 0);
    if (lenR > 8 * 1024 * 1024) {
      return err("too_large", "Receipt too large — maximum 8 MB. Tip: send the photo to yourself on WhatsApp, save it back from the chat (WhatsApp compresses it), then upload that copy.", 413);
    }
    if (!request.body) return err("invalid_input", "Receipt body required", 400);
    const key = `claims/${clMatch[1]}-${Date.now()}`;
    await env.MEDIA.put(key, request.body, { httpMetadata: { contentType: ct } });
    await env.DB.prepare(`UPDATE claims SET receipt_key = ?1 WHERE id = ?2`).bind(key, clMatch[1]).run();
    // v1.4.117: attaching a receipt to a REJECTED claim resubmits it — the
    // missing receipt was the fix, so the claim goes straight back through
    // the chain (decision + chain stamps cleared, first stage notified).
    let resubmittedR = false;
    if (row.status === "rejected") {
      const cRow = await env.DB.prepare(`SELECT amount_cents FROM claims WHERE id = ?1`).bind(clMatch[1]).first<{ amount_cents: number }>();
      await env.DB.prepare(
        `UPDATE claims SET status = 'pending', decided_by = NULL, decided_at = NULL, decision_note = NULL,
         hr_reviewed_by = NULL, hr_reviewed_at = NULL, pre_approved_by = NULL, pre_approved_at = NULL WHERE id = ?1`,
      ).bind(clMatch[1]).run();
      let payeeRoleR: string | null = null;
      try {
        const prR = await env.DB.prepare(
          `SELECT py.role AS r FROM claims c LEFT JOIN users py ON py.id = c.payee_user_id WHERE c.id = ?1`,
        ).bind(clMatch[1]).first<{ r: string | null }>();
        payeeRoleR = prR?.r ?? null;
      } catch { /* pre-0051 */ }
      await notifyClaimFirstStage(user.role, user.name, clMatch[1]!, cRow?.amount_cents ?? 0, "Resubmitted with receipt", payeeRoleR);
      await audit(env, user.id, "claim.resubmit", "claims", clMatch[1]!, { via: "receipt_attach" });
      resubmittedR = true;
    }
    return json({ ok: true, resubmitted: resubmittedR });
  }
  if (clMatch && clMatch[2] === "/receipt" && method === "GET") {
    if (!can(user.role, "claims_submit")) return err("forbidden", "Claims access required", 403);
    const row = await env.DB.prepare(
      `SELECT c.user_id, c.status, c.receipt_key, u.role AS claimant_role
       FROM claims c LEFT JOIN users u ON u.id = c.user_id WHERE c.id = ?1`,
    ).bind(clMatch[1]).first<{ user_id: number; status: string; receipt_key: string | null; claimant_role: string | null }>();
    if (!row?.receipt_key) return err("not_found", "No receipt attached", 404);
    // v1.4.133: receipt visibility mirrors claim-list visibility — anyone who
    // can see the claim (chain reviewers included) can open its receipt.
    // Fixes the CCO's raw "Not your claim" 403 when opening a receipt link.
    const STAFF_CHAIN_ROLES = ["marketing", "sales_marketing", "editor", "live_host"];
    const canView =
      row.user_id === user.id ||
      can(user.role, "claims_decide") ||
      (user.role === "hr_admin" && (row.status === "approved" || STAFF_CHAIN_ROLES.includes(row.claimant_role ?? ""))) ||
      (["coo", "admin"].includes(user.role) && STAFF_CHAIN_ROLES.includes(row.claimant_role ?? "")) ||
      (user.role === "cco" && row.claimant_role === "hr_admin");
    if (!canView) return err("forbidden", "Not your claim", 403);
    const obj = await env.MEDIA.get(row.receipt_key);
    if (!obj) return err("not_found", "Receipt file missing", 404);
    return new Response(obj.body, { headers: { "Content-Type": obj.httpMetadata?.contentType ?? "application/octet-stream", "Cache-Control": "private, max-age=300" } });
  }
  if (clMatch && clMatch[2] === "/decide" && method === "POST") {
    // Per the CEO's instruction: EVERY claim decision is the CEO's.
    if (!can(user.role, "claims_decide")) return err("forbidden", "Only the CEO decides claims", 403);
    const action = body?.action;
    if (action !== "approve" && action !== "reject") return err("invalid_input", "action must be approve or reject", 400);
    const row = await env.DB.prepare(
      `SELECT c.user_id, c.status, c.amount_cents, c.hr_reviewed_at, c.pre_approved_at, u.role AS claimant_role
       FROM claims c LEFT JOIN users u ON u.id = c.user_id WHERE c.id = ?1`,
    ).bind(clMatch[1]).first<{ user_id: number; status: string; amount_cents: number; hr_reviewed_at: string | null; pre_approved_at: string | null; claimant_role: string }>();
    if (!row) return err("not_found", "Claim not found", 404);
    if (row.status !== "pending") return err("invalid_state", "Already decided", 400);
    // v1.4.106: approval normally waits for the chain; a REJECT can happen at
    // any point. v1.4.107: the CEO is the company's final authority — he CAN
    // approve before the chain completes, and the bypass is RECORDED (audit
    // meta + a line on the claim's decision note) so the record shows it was
    // a deliberate override, not a skipped process.
    let chainOverride: string | null = null;
    let conflictWaived: string | null = null;
    if (action === "approve") {
      const chainD = claimChain(row.claimant_role);
      /* v1.4.175: a stage whose approver IS the payee is WAIVED — the guard
         (v1.4.174) forbids them from acting, so their missing signature is
         the DESIGNED route to the CEO, not a bypass. Only genuinely skipped
         stages count as an override. Pre-0051 tolerant. */
      let payeeRoleD: string | null = null;
      try {
        const pr = await env.DB.prepare(
          `SELECT py.role AS r FROM claims c LEFT JOIN users py ON py.id = c.payee_user_id WHERE c.id = ?1`,
        ).bind(clMatch[1]).first<{ r: string | null }>();
        payeeRoleD = pr?.r ?? null;
      } catch { /* pre-0051 */ }
      const skipped: string[] = [];
      const waived: string[] = [];
      if (chainD === "staff") {
        if (!row.hr_reviewed_at) (payeeRoleD === "hr_admin" ? waived : skipped).push("HR review");
        if (!row.pre_approved_at) (payeeRoleD === "coo" ? waived : skipped).push("COO pre-approval");
      } else if (chainD === "hr" && !row.pre_approved_at) {
        (payeeRoleD === "cco" ? waived : skipped).push("CCO pre-approval");
      }
      if (skipped.length > 0) chainOverride = skipped.join(" + ");
      if (waived.length > 0) conflictWaived = waived.join(" + ");
    }
    const status = action === "approve" ? "approved" : "rejected";
    const noteBase = typeof body?.note === "string" && body.note ? body.note.slice(0, 400) : "";
    const parts = [noteBase];
    if (chainOverride) parts.push(`CEO direct approval (${chainOverride} bypassed)`);
    if (conflictWaived) parts.push(`${conflictWaived} waived — approver is the payee (conflict of interest)`);
    const noteFinal = parts.filter(Boolean).join(" · ") || null;
    await env.DB.prepare(
      `UPDATE claims SET status = ?1, decided_by = ?2, decided_at = datetime('now'), decision_note = ?3 WHERE id = ?4`,
    ).bind(status, user.id, noteFinal, clMatch[1]).run();
    await notify(env, row.user_id, "claim",
      `Your claim of RM ${(row.amount_cents / 100).toFixed(2)} was ${status}${typeof body?.note === "string" && body.note ? ` — ${body.note.slice(0, 200)}` : ""}`,
      `claim:${clMatch[1]}`);
    await audit(env, user.id, `claim.${action}`, "claims", clMatch[1],
      chainOverride || conflictWaived ? { ...(chainOverride ? { chain_override: chainOverride } : {}), ...(conflictWaived ? { conflict_waived: conflictWaived } : {}) } : undefined);
    return json({ ok: true });
  }

  /* ---- company expenses (v1.4.87): CEO + COO ---- */

  /* v1.4.278 — 💹 P&L by month ("powerful system for my sales track and
     also expenses"). Revenue comes from revenueByMonth() — the ONE revenue
     arithmetic; payroll uses the SAME net expression the M2E file uses
     (net_cents with the additive fallback — never a second formula);
     expenses by expense_date; claims = APPROVED, by claim_date. Every
     source armored; a month appears if ANY source has it. */
  /* v1.4.281 — 🧩 business lines: the two businesses (product / service)
     reported separately, from the SAME revenueLines() buckets that feed
     every total. Expandable: response is lines[] — a future line appears
     here automatically the day the helper buckets it. */
  if (path === "/revenue/lines" && method === "GET") {
    if (!can(user.role, "revenue_view")) return err("forbidden", "Revenue access required", 403);
    const buckets = await revenueLines(env);
    const LABELS: Record<string, string> = {
      product: "Product sales",
      service: "Service sales",
      invoices: "Invoices (run migration 0061 to split product/service)",
    };
    const lines = Object.entries(buckets)
      .map(([key, months]) => {
        const ms = Object.entries(months).sort(([a], [b]) => (a < b ? -1 : 1))
          .map(([month, cents]) => ({ month, cents }));
        return { key, label: LABELS[key] ?? key, total_cents: ms.reduce((a, x) => a + x.cents, 0), months: ms };
      })
      .filter((l) => l.total_cents > 0)
      .sort((a, b) => b.total_cents - a.total_cents);
    return json({ lines });
  }

  if (path === "/finance/pnl" && method === "GET") {
    if (!can(user.role, "expenses")) return err("forbidden", "Expenses access required", 403);
    const rev = await revenueByMonth(env);
    const exp: Record<string, number> = {}; const pay: Record<string, number> = {}; const clm: Record<string, number> = {};
    try {
      const { results } = await env.DB.prepare(
        `SELECT substr(expense_date, 1, 7) AS m, COALESCE(SUM(amount_cents), 0) AS cents FROM expenses GROUP BY m`,
      ).all<{ m: string; cents: number }>();
      for (const r of results) exp[r.m] = r.cents;
    } catch { /* pre-0032 */ }
    try {
      const { results } = await env.DB.prepare(
        `SELECT month AS m, COALESCE(SUM(COALESCE(net_cents,
                MAX(0, basic_cents + commission_cents + allowance_cents + COALESCE(ot_cents, 0) - deduction_cents))), 0) AS cents
         FROM payroll_entries GROUP BY month`,
      ).all<{ m: string; cents: number }>();
      for (const r of results) pay[r.m] = r.cents;
    } catch { /* pre-0017/0041 skew — try the plain additive form */
      try {
        const { results } = await env.DB.prepare(
          `SELECT month AS m, COALESCE(SUM(MAX(0, basic_cents + commission_cents + allowance_cents - deduction_cents)), 0) AS cents
           FROM payroll_entries GROUP BY month`,
        ).all<{ m: string; cents: number }>();
        for (const r of results) pay[r.m] = r.cents;
      } catch { /* pre-payroll */ }
    }
    try {
      const { results } = await env.DB.prepare(
        `SELECT substr(claim_date, 1, 7) AS m, COALESCE(SUM(amount_cents), 0) AS cents
         FROM claims WHERE status = 'approved' GROUP BY m`,
      ).all<{ m: string; cents: number }>();
      for (const r of results) clm[r.m] = r.cents;
    } catch { /* pre-claims */ }
    const monthsSet = new Set([...Object.keys(rev), ...Object.keys(exp), ...Object.keys(pay), ...Object.keys(clm)]);
    const months = [...monthsSet].sort().map((m) => {
      const revenue = rev[m] ?? 0, expenses = exp[m] ?? 0, payroll = pay[m] ?? 0, claims = clm[m] ?? 0;
      return { month: m, revenue_cents: revenue, expenses_cents: expenses, payroll_cents: payroll, claims_cents: claims,
               net_cents: revenue - expenses - payroll - claims };
    });
    return json({ months });
  }

  /* v1.5.0: /prospects/insights removed with the Social tab. */

  if (path === "/expenses" && method === "GET") {
    if (!can(user.role, "expenses")) return err("forbidden", "Expenses access required", 403);
    const urlE = new URL(request.url);
    const mE = urlE.searchParams.get("month"); // optional YYYY-MM filter
    const { results } = await env.DB.prepare(
      mE
        ? `SELECT e.*, u.name AS created_by_name FROM expenses e
           LEFT JOIN users u ON u.id = e.created_by
           WHERE e.expense_date LIKE ?1 || '%' ORDER BY e.expense_date DESC, e.id DESC LIMIT 300`
        : `SELECT e.*, u.name AS created_by_name FROM expenses e
           LEFT JOIN users u ON u.id = e.created_by
           ORDER BY e.expense_date DESC, e.id DESC LIMIT 300`,
    ).bind(...(mE ? [mE] : [])).all();
    // v1.4.88: carry recurring expenses forward — the latest recurring row of
    // each (category · vendor · description) group from EARLIER months that
    // has no row yet in the viewed month appears as "due to record".
    let upcoming: unknown[] = [];
    if (mE) {
      const { results: rec } = await env.DB.prepare(
        `SELECT * FROM expenses WHERE recurring = 1 AND expense_date < ?1 || '-01'
         ORDER BY expense_date DESC, id DESC LIMIT 200`,
      ).bind(mE).all<Record<string, unknown>>();
      const keyOf = (r: Record<string, unknown>) =>
        `${r.category}|${(r.vendor as string) ?? ""}|${(r.description as string) ?? ""}`;
      const existing = new Set((results as Record<string, unknown>[]).map(keyOf));
      const seen = new Set<string>();
      for (const r of rec) {
        const k = keyOf(r);
        if (existing.has(k) || seen.has(k)) continue;
        seen.add(k);
        upcoming.push(r);
      }
    }
    // v1.4.91: staff payroll paid during this month = the PREVIOUS month's
    // payroll (cycle closes on the 5th). Net per entry uses the same formula
    // as the payslip: basic + commission + allowance + OT − manual deduction
    // − unpaid leave (base ÷ 26 × days) − incomplete month.
    let staffPayroll: { month: string; cents: number } | null = null;
    if (mE) {
      const yP = Number(mE.slice(0, 4));
      const moP = Number(mE.slice(5, 7));
      const prevM = new Date(Date.UTC(yP, moP - 2, 1)).toISOString().slice(0, 7);
      // v1.4.124: SAME scope as the Payroll tab — active staff, no customer /
      // super_admin, lifecycle window applied. Entries outside this scope
      // (test users, resigned staff, disabled accounts) were inflating the
      // Expenses figure vs the panel total.
      const mStart = `${prevM}-01`, mEnd = `${prevM}-31`;
      const { results: pes } = await env.DB.prepare(
        `SELECT p.user_id, p.basic_cents, p.commission_cents, p.allowance_cents,
                COALESCE(p.ot_cents, 0) AS ot_cents, p.deduction_cents, p.net_cents,
                p.worked_days, p.month_working_days, u.base_salary_cents, u.name AS uname
         FROM payroll_entries p JOIN users u ON u.id = p.user_id
         WHERE p.month = ?1 AND u.is_active = 1
           AND u.role NOT IN ('customer', 'super_admin')
           AND NOT (u.left_on IS NOT NULL AND u.left_on < ?2
                    AND (u.rejoined_on IS NULL OR u.rejoined_on > ?3))`,
      ).bind(prevM, mStart, mEnd).all<{ user_id: number; basic_cents: number; commission_cents: number; allowance_cents: number; ot_cents: number; deduction_cents: number; net_cents: number | null; worked_days: number | null; month_working_days: number | null; base_salary_cents: number }>();
      const { results: uls } = await env.DB.prepare(
        `SELECT user_id, COALESCE(SUM(days), 0) AS days FROM leave_requests
         WHERE type = 'unpaid' AND status = 'approved' AND start_date LIKE ?1 || '%' GROUP BY user_id`,
      ).bind(prevM).all<{ user_id: number; days: number }>();
      const ulMap = new Map(uls.map((r) => [r.user_id, r.days]));
      let sum = 0;
      // v1.4.126: per-person breakdown in the response — a mismatch with the
      // Payroll tab now NAMES the row causing it (stale save or ghost entry).
      const rowsOut: { name: string; cents: number; saved_net: boolean }[] = [];
      for (const e of pes) {
        // v1.4.124: the net the panel SAVED is authoritative; the formula
        // below only covers rows saved before net_cents existed.
        if (e.net_cents !== null && e.net_cents !== undefined) {
          sum += e.net_cents;
          rowsOut.push({ name: (e as unknown as { uname: string }).uname, cents: e.net_cents, saved_net: true });
          continue;
        }
        const ul = ulMap.get(e.user_id) ?? 0;
        const ulDed = ul > 0 ? Math.round(((e.base_salary_cents || e.basic_cents) / 26) * ul) : 0;
        let adj = 0;
        if (e.worked_days !== null && e.worked_days !== undefined && e.month_working_days && e.month_working_days > 0) {
          const adjustable = Math.max(0, Math.max(0, e.month_working_days - e.worked_days) - ul);
          adj = Math.round((e.basic_cents * adjustable) / e.month_working_days);
        }
        const rowNet = Math.max(0, e.basic_cents + e.commission_cents + e.allowance_cents + e.ot_cents - e.deduction_cents - ulDed - adj);
        sum += rowNet;
        rowsOut.push({ name: (e as unknown as { uname: string }).uname, cents: rowNet, saved_net: false });
      }
      let paidAtP: string | null = null;
      try {
        const paidRow = await env.DB.prepare(
          `SELECT paid_at FROM payroll_payments WHERE month = ?1`,
        ).bind(prevM).first<{ paid_at: string }>();
        paidAtP = paidRow?.paid_at ?? null;
      } catch (e) {
        // payroll_payments arrives with migration 0037 — degrade, don't die.
        await logError(env, "expenses_payroll_paid", e instanceof Error ? e.message : String(e));
      }
      staffPayroll = { month: prevM, cents: sum, paid_at: paidAtP, entries: rowsOut } as { month: string; cents: number; paid_at?: string | null };
    }
    // v1.4.112 (CEO's rule): a claim belongs to the month its CLAIM DATES
    // fall in (1st → month end) once APPROVED — that month's expense, whether
    // the money moved yet or not. Payments-completed still lists actual
    // payments by paid_at (cash movements), and approved-unpaid claims sit
    // on Payments due.
    let claimsInMonth: unknown[] = [], claimsPaid: unknown[] = [], claimsDue: unknown[] = [];
    try {
      ({ results: claimsInMonth } = await env.DB.prepare(
      `SELECT c.id, c.amount_cents, c.paid_at, c.claim_date, u.name AS claimant FROM claims c
       LEFT JOIN users u ON u.id = c.user_id
       WHERE c.status = 'approved' AND strftime('%Y-%m', c.claim_date) = ?1
       ORDER BY c.claim_date ASC`,
    ).bind(mE).all()); // v1.5.0 fix: was `month` (undefined here) — every Expenses load 500'd
    ({ results: claimsPaid } = await env.DB.prepare(
      `SELECT c.id, c.amount_cents, c.paid_at, u.name AS claimant FROM claims c
       LEFT JOIN users u ON u.id = c.user_id
       WHERE c.paid_at IS NOT NULL AND strftime('%Y-%m', c.paid_at) = ?1
       ORDER BY c.paid_at DESC`,
    ).bind(mE).all()); // v1.5.0 fix: was `month` (undefined here)
    ({ results: claimsDue } = await env.DB.prepare(
      `SELECT c.id, c.amount_cents, c.decided_at, u.name AS claimant FROM claims c
       LEFT JOIN users u ON u.id = c.user_id
       WHERE c.status = 'approved' AND c.paid_at IS NULL ORDER BY c.decided_at ASC`,
    ).all());
    } catch (e) {
      // claims.paid_at arrives with migration 0037 — degrade, don't die.
      await logError(env, "expenses_claims", e instanceof Error ? e.message : String(e));
    }
    return json({ expenses: results, upcoming, staff_payroll: staffPayroll, staff_claims: { in_month: claimsInMonth, paid: claimsPaid, due: claimsDue } });
  }
  const exEdit = path.match(/^\/expenses\/(\d+)$/);
  if (exEdit && method === "PATCH") {
    // v1.4.91: fix typos on a recorded expense. (Staff payroll is computed
    // from the Payroll tab and is not editable here — by design.)
    if (!can(user.role, "expenses")) return err("forbidden", "Expenses access required", 403);
    const catsP = ["rent", "utilities", "software", "marketing", "equipment", "logistics", "supplies", "other"];
    const sets: string[] = [];
    const vals: unknown[] = [];
    const setV = (col: string, v: unknown) => { vals.push(v); sets.push(`${col} = ?${vals.length}`); };
    if (typeof body?.expense_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.expense_date)) setV("expense_date", body.expense_date);
    if (typeof body?.category === "string" && catsP.includes(body.category)) setV("category", body.category);
    if (typeof body?.amount === "number" && body.amount > 0) setV("amount_cents", Math.round(body.amount * 100));
    if (typeof body?.vendor === "string") setV("vendor", body.vendor.slice(0, 200) || null);
    if (typeof body?.description === "string") setV("description", body.description.slice(0, 1000) || null);
    if (typeof body?.due_day === "number" && body.due_day >= 1 && body.due_day <= 31) setV("due_day", Math.round(body.due_day));
    else if (body?.due_day === null) sets.push("due_day = NULL");
    if (body?.recurring === true || body?.recurring === false) setV("recurring", body.recurring ? 1 : 0);
    if (sets.length === 0) return err("invalid_input", "Nothing to update", 400);
    await env.DB.prepare(`UPDATE expenses SET ${sets.join(", ")} WHERE id = ?${vals.length + 1}`)
      .bind(...vals, exEdit[1]).run();
    await audit(env, user.id, "expense.update", "expenses", exEdit[1]);
    return json({ ok: true });
  }
  const exPaid = path.match(/^\/expenses\/(\d+)\/paid$/);
  if (exPaid && method === "POST") {
    // v1.4.88: mark an expense paid — the due chip turns into PAID.
    // v1.4.208 (CEO wants paid/outstanding tracking): now a TOGGLE — body
    // { paid: false } clears the mark so a misclick is one click to undo.
    if (!can(user.role, "expenses")) return err("forbidden", "Expenses access required", 403);
    const unpay = body?.paid === false;
    await env.DB.prepare(
      unpay
        ? `UPDATE expenses SET paid_at = NULL WHERE id = ?1`
        : `UPDATE expenses SET paid_at = datetime('now') WHERE id = ?1`,
    ).bind(exPaid[1]).run();
    if (!unpay) {
      // v1.19.0 C2: the paid expense becomes a bank movement, once.
      const exRow = await env.DB.prepare(`SELECT amount_cents, category, vendor, description FROM expenses WHERE id = ?1`)
        .bind(exPaid[1]).first<{ amount_cents: number; category: string; vendor: string | null; description: string | null }>();
      if (exRow) {
        await recordBankMovement(env, user.id, `EXP-${exPaid[1]}`, exRow.amount_cents,
          exRow.category, [exRow.vendor, exRow.description].filter(Boolean).join(" — ") || "Expense payment");
      }
    }
    await audit(env, user.id, "expense.paid", "expenses", exPaid[1], { paid: !unpay });
    return json({ ok: true });
  }
  if (path === "/expenses" && method === "POST") {
    if (!can(user.role, "expenses")) return err("forbidden", "Expenses access required", 403);
    const catsE = ["rent", "utilities", "software", "marketing", "equipment", "logistics", "supplies", "other"];
    const centsE = Math.round(Number(body?.amount) * 100);
    if (!body || !/^\d{4}-\d{2}-\d{2}$/.test(String(body.expense_date ?? "")) || !Number.isFinite(centsE) || centsE <= 0 || centsE > 1000000000) {
      return err("invalid_input", "expense_date (YYYY-MM-DD) and a positive amount are required", 400);
    }
    const categoryE = typeof body.category === "string" && catsE.includes(body.category) ? body.category : "other";
    const dueDay = typeof body.due_day === "number" && body.due_day >= 1 && body.due_day <= 31
      ? Math.round(body.due_day) : null;
    const res = await env.DB.prepare(
      `INSERT INTO expenses (expense_date, category, amount_cents, vendor, description, recurring, due_day, paid_at, created_by)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9) RETURNING id`,
    ).bind(
      body.expense_date, categoryE, centsE,
      typeof body.vendor === "string" ? body.vendor.slice(0, 200) : null,
      typeof body.description === "string" ? body.description.slice(0, 1000) : null,
      body.recurring === true || body.recurring === 1 ? 1 : 0,
      dueDay,
      body.paid === true ? new Date().toISOString().replace("T", " ").slice(0, 19) : null,
      user.id,
    ).first<{ id: number }>();
    await audit(env, user.id, "expense.create", "expenses", String(res?.id), { category: categoryE, amount_cents: centsE });
    return json({ id: res?.id }, 201);
  }
  const exMatch = path.match(/^\/expenses\/(\d+)$/);
  if (exMatch && method === "DELETE") {
    if (!can(user.role, "expenses")) return err("forbidden", "Expenses access required", 403);
    await env.DB.prepare(`DELETE FROM expenses WHERE id = ?1`).bind(exMatch[1]).run();
    await audit(env, user.id, "expense.delete", "expenses", exMatch[1]);
    return json({ ok: true });
  }

  /* ---- sales revenue (v1.4.75): dashboard figures, TikTok included ---- */

  /* v1.19.0 (consolidation C1): the duplicate GET /pnl endpoint is gone.
     It served only the Overview tab's private PnlCard copy — /finance/pnl is
     the single P&L and the only one any surviving UI calls. */
  if (path === "/revenue" && method === "GET") {
    if (!can(user.role, "revenue_view")) return err("forbidden", "Revenue access required", 403);
    const month = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 7);
    const lastMonth = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 2, 1)).toISOString().slice(0, 7);
    const tiktok = (m: string) => env.DB.prepare(
      `SELECT COALESCE(SUM(order_amount_cents), 0) AS cents, COUNT(*) AS orders
       FROM postage_records
       WHERE order_ref LIKE 'TT-%' AND status != 'returned'
         AND strftime('%Y-%m', created_at, '+8 hours') = ?1`,
    ).bind(m).first<{ cents: number; orders: number }>();
    // v1.4.90: invoiced revenue counts on a PAYMENT-RECEIVED basis — paid
    // invoices, in the month the payment landed (bank transfer etc.). Billed
    // but unpaid invoices are shown separately as outstanding.
    const invoiced = (m: string) => env.DB.prepare(
      `SELECT COALESCE(SUM(total_cents), 0) AS cents, COUNT(*) AS docs
       FROM sales_documents WHERE doc_type = 'INV' AND payment_status = 'paid'
         AND strftime('%Y-%m', COALESCE(paid_at, created_at), '+8 hours') = ?1`,
    ).bind(m).first<{ cents: number; docs: number }>();
    const outstanding = env.DB.prepare(
      `SELECT COALESCE(SUM(total_cents), 0) AS cents, COUNT(*) AS docs
       FROM sales_documents WHERE doc_type = 'INV' AND payment_status != 'paid'`,
    ).first<{ cents: number; docs: number }>();
    // v1.4.169 (CEO: "invoice also need to count it beside of TikTok or any
    // Postage tracking — non-TikTok orders… everything count correctly"):
    // two more channels join the totals — non-TikTok shipments (their order
    // amount, from the new form field) and manual sales (an Out − with a
    // sold price). Tolerant of migration 0048 not being applied yet.
    const otherPostage = (m: string) => env.DB.prepare(
      `SELECT COALESCE(SUM(order_amount_cents), 0) AS cents,
              SUM(CASE WHEN order_amount_cents IS NOT NULL THEN 1 ELSE 0 END) AS orders
       FROM postage_records
       WHERE order_ref NOT LIKE 'TT-%' AND status != 'returned'
         AND strftime('%Y-%m', created_at, '+8 hours') = ?1`,
    ).bind(m).first<{ cents: number; orders: number }>();
    const manualSales = async (m: string) => {
      // v1.4.172: attribute by the backdatable out_date when present.
      try {
        return await env.DB.prepare(
          `SELECT COALESCE(SUM(total_cents), 0) AS cents, COALESCE(SUM(qty), 0) AS units
           FROM manual_sales
           WHERE (CASE WHEN out_date IS NOT NULL THEN substr(out_date, 1, 7)
                       ELSE strftime('%Y-%m', created_at, '+8 hours') END) = ?1`,
        ).bind(m).first<{ cents: number; units: number }>();
      } catch {
        try {
          return await env.DB.prepare(
            `SELECT COALESCE(SUM(total_cents), 0) AS cents, COALESCE(SUM(qty), 0) AS units
             FROM manual_sales WHERE strftime('%Y-%m', created_at, '+8 hours') = ?1`,
          ).bind(m).first<{ cents: number; units: number }>();
        } catch { return { cents: 0, units: 0 }; }
      }
    };
    const targetOf = (m: string) => env.DB.prepare(
      `SELECT target_cents FROM sales_targets WHERE month = ?1`,
    ).bind(m).first<{ target_cents: number }>();
    // v1.4.95: targets are per-month rows, so each new month RESETS by
    // construction; last month's KPI result stays on the card for the team,
    // and next month's target can be set before month-end.
    const nextMonth = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 1)).toISOString().slice(0, 7);
    // v1.4.156 (CEO: "show today sales to motivate my Sales team") — same
    // bases as the monthly figures, scoped to today in Malaysia time.
    const todayMYT = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
    // v1.4.206 (CEO: trend arrow vs yesterday): same four channel bases,
    // scoped to yesterday MYT, summed into one comparable number.
    const yesterdayMYT = new Date(Date.now() + 8 * 3600 * 1000 - 24 * 3600 * 1000).toISOString().slice(0, 10);
    const tiktokDay = (d: string) => env.DB.prepare(
      `SELECT COALESCE(SUM(order_amount_cents), 0) AS cents, COUNT(*) AS orders
       FROM postage_records
       WHERE order_ref LIKE 'TT-%' AND status != 'returned'
         AND date(created_at, '+8 hours') = ?1`,
    ).bind(d).first<{ cents: number; orders: number }>();
    const invoicedDay = (d: string) => env.DB.prepare(
      `SELECT COALESCE(SUM(total_cents), 0) AS cents, COUNT(*) AS docs
       FROM sales_documents WHERE doc_type = 'INV' AND payment_status = 'paid'
         AND date(COALESCE(paid_at, created_at), '+8 hours') = ?1`,
    ).bind(d).first<{ cents: number; docs: number }>();
    const otherDay = (d: string) => env.DB.prepare(
      `SELECT COALESCE(SUM(order_amount_cents), 0) AS cents
       FROM postage_records
       WHERE order_ref NOT LIKE 'TT-%' AND status != 'returned'
         AND date(created_at, '+8 hours') = ?1`,
    ).bind(d).first<{ cents: number }>();
    const manualDay = async (d: string) => {
      try {
        return await env.DB.prepare(
          `SELECT COALESCE(SUM(total_cents), 0) AS cents FROM manual_sales
           WHERE (CASE WHEN out_date IS NOT NULL THEN out_date
                       ELSE date(created_at, '+8 hours') END) = ?1`,
        ).bind(d).first<{ cents: number }>();
      } catch {
        try {
          return await env.DB.prepare(
            `SELECT COALESCE(SUM(total_cents), 0) AS cents FROM manual_sales
             WHERE date(created_at, '+8 hours') = ?1`,
          ).bind(d).first<{ cents: number }>();
        } catch { return { cents: 0 }; }
      }
    };
    const overallByMonth = () => revenueByMonth(env); // v1.4.278: shared module helper (was local in 276)
    const [tThis, tLast, iThis, iLast, out, tgt, tgtLast, tgtNext, tToday, iToday, oThis, oLast, mThis, mLast, oToday, mToday, tYest, iYest, oYest, mYest] = await Promise.all([
      tiktok(month), tiktok(lastMonth), invoiced(month), invoiced(lastMonth), outstanding,
      targetOf(month), targetOf(lastMonth), targetOf(nextMonth), tiktokDay(todayMYT), invoicedDay(todayMYT),
      otherPostage(month), otherPostage(lastMonth), manualSales(month), manualSales(lastMonth), otherDay(todayMYT), manualDay(todayMYT),
      tiktokDay(yesterdayMYT), invoicedDay(yesterdayMYT), otherDay(yesterdayMYT), manualDay(yesterdayMYT),
    ]);
    const byMonth = await overallByMonth(); // v1.4.276
    const overallMonths = Object.entries(byMonth).sort((a, b) => (a[0] < b[0] ? -1 : 1));
    const overallTotal = overallMonths.reduce((a, [, c]) => a + c, 0);
    const best = overallMonths.reduce<{ month: string; cents: number } | null>(
      (b, [m, c]) => (b && b.cents >= c ? b : { month: m, cents: c }), null);
    return json({
      month, last_month: lastMonth, next_month: nextMonth,
      today: {
        date: todayMYT,
        tiktok_cents: tToday?.cents ?? 0, tiktok_orders: tToday?.orders ?? 0,
        invoiced_cents: iToday?.cents ?? 0, invoiced_docs: iToday?.docs ?? 0,
        other_cents: oToday?.cents ?? 0, manual_cents: mToday?.cents ?? 0, // v1.4.169
      },
      yesterday: { // v1.4.206: one comparable all-channel number for the trend arrow
        date: yesterdayMYT,
        total_cents: (tYest?.cents ?? 0) + (iYest?.cents ?? 0) + (oYest?.cents ?? 0) + (mYest?.cents ?? 0),
      },
      tiktok: { this_cents: tThis?.cents ?? 0, this_orders: tThis?.orders ?? 0, last_cents: tLast?.cents ?? 0, last_orders: tLast?.orders ?? 0 },
      invoiced: { this_cents: iThis?.cents ?? 0, this_docs: iThis?.docs ?? 0, last_cents: iLast?.cents ?? 0, last_docs: iLast?.docs ?? 0 },
      outstanding: { cents: out?.cents ?? 0, docs: out?.docs ?? 0 },
      other: { this_cents: oThis?.cents ?? 0, this_orders: oThis?.orders ?? 0, last_cents: oLast?.cents ?? 0, last_orders: oLast?.orders ?? 0 }, // v1.4.169
      manual: { this_cents: mThis?.cents ?? 0, this_units: mThis?.units ?? 0, last_cents: mLast?.cents ?? 0, last_units: mLast?.units ?? 0 }, // v1.4.169
      overall: { // v1.4.276: all-time, all four channels, by MYT month
        total_cents: overallTotal,
        months: overallMonths.map(([m, c]) => ({ month: m, cents: c })),
        best: best ?? undefined,
      },
      target_cents: tgt?.target_cents ?? null,
      last_target_cents: tgtLast?.target_cents ?? null,
      next_target_cents: tgtNext?.target_cents ?? null,
    });
  }

  /* ================= v1.4.212 EXTENSIONS (approved architecture review) =================
     Two additive routes for the new Sales-tab cards. Nothing above or
     below altered; same guards as /revenue (revenue_view). */

  if (path === "/sales/by-hour" && method === "GET") {
    // Hourly MYT sales histogram over the last 7 days — for choosing LIVE
    // hours. Bases mirror /revenue: postage_records with an order amount
    // (TikTok TT- + other shipments, returned excluded) + manual sales.
    if (!can(user.role, "revenue_view")) return err("forbidden", "Revenue access required", 403);
    const sinceBH = new Date(Date.now() + 8 * 3600 * 1000 - 7 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const post = await env.DB.prepare(
      `SELECT CAST(strftime('%H', created_at, '+8 hours') AS INTEGER) AS h,
              COALESCE(SUM(order_amount_cents), 0) AS cents, COUNT(*) AS orders
       FROM postage_records
       WHERE order_amount_cents IS NOT NULL AND status != 'returned'
         AND date(created_at, '+8 hours') >= ?1
       GROUP BY h`,
    ).bind(sinceBH).all<{ h: number; cents: number; orders: number }>();
    const man = await env.DB.prepare(
      `SELECT CAST(strftime('%H', created_at, '+8 hours') AS INTEGER) AS h,
              COALESCE(SUM(total_cents), 0) AS cents, COUNT(*) AS orders
       FROM manual_sales
       WHERE date(created_at, '+8 hours') >= ?1
       GROUP BY h`,
    ).bind(sinceBH).all<{ h: number; cents: number; orders: number }>();
    const buckets = Array.from({ length: 24 }, (_, h) => ({ hour: h, cents: 0, orders: 0 }));
    for (const r of [...(post.results ?? []), ...(man.results ?? [])]) {
      const b = buckets[r.h]; if (b) { b.cents += r.cents; b.orders += r.orders; }
    }
    return json({ since: sinceBH, days: 7, buckets });
  }

  if (path === "/fulfilment/summary" && method === "GET") {
    // Orders by fulfilment status this month (MYT) + the oldest order still
    // preparing — postage_records.status: preparing | shipped | in_transit
    // | delivered | returned (schema since 0007).
    if (!can(user.role, "revenue_view")) return err("forbidden", "Revenue access required", 403);
    const monthFS = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 7);
    const { results: byStatus } = await env.DB.prepare(
      `SELECT status, COUNT(*) AS n FROM postage_records
       WHERE strftime('%Y-%m', created_at, '+8 hours') = ?1
       GROUP BY status`,
    ).bind(monthFS).all<{ status: string; n: number }>();
    const oldest = await env.DB.prepare(
      `SELECT order_ref, created_at FROM postage_records
       WHERE status = 'preparing'
       ORDER BY created_at ASC LIMIT 1`,
    ).first<{ order_ref: string; created_at: string }>();
    const oldestDays = oldest
      ? Math.floor((Date.now() - Date.parse(oldest.created_at + "Z")) / (24 * 3600 * 1000))
      : null;
    /* v1.4.222 (CEO: "clickable card which will appear the data of the
       fulfillment"): additive ?status= drills into one status — the
       month's orders behind that chip, newest first. */
    const drill = new URL(request.url).searchParams.get("status"); // v1.5.0 fix: `url` was undefined here — drill-down clicks 500'd
    let orders: unknown[] | undefined;
    if (drill && ["preparing", "shipped", "in_transit", "delivered", "returned"].includes(drill)) {
      const { results } = await env.DB.prepare(
        `SELECT order_ref, status, courier, tracking_no, buyer_city, order_amount_cents, created_at
         FROM postage_records
         WHERE status = ?1 AND strftime('%Y-%m', created_at, '+8 hours') = ?2
         ORDER BY created_at DESC LIMIT 200`,
      ).bind(drill, monthFS).all();
      orders = results ?? [];
    }
    return json({
      month: monthFS,
      by_status: Object.fromEntries((byStatus ?? []).map((r) => [r.status, r.n])),
      oldest_preparing: oldest ? { order_ref: oldest.order_ref, days: oldestDays } : null,
      ...(orders !== undefined ? { status: drill, orders } : {}),
    });
  }

  /* ================= v1.4.213: company asset register =================
     Team feedback via the CEO. View = the Staff-Details tier; edits =
     the same tier (HR keeps the register). Assets are never deleted —
     status moves to lost/disposed so history and audit survive. */

  if (path === "/assets" && method === "GET") {
    if (!can(user.role, "hr_manage") && !can(user.role, "exec_view")) return err("forbidden", "HR access required", 403);
    const { results } = await env.DB.prepare(
      `SELECT a.*, u.name AS assigned_name FROM assets a
       LEFT JOIN users u ON u.id = a.assigned_to
       ORDER BY a.status = 'disposed', a.status = 'lost', a.asset_tag`,
    ).all();
    return json({ assets: results ?? [] });
  }

  if (path === "/assets" && method === "POST") {
    if (!can(user.role, "hr_manage")) return err("forbidden", "HR access required", 403);
    const nameA = str(body?.name, 120) ? (body!.name as string).trim() : null;
    if (!nameA) return err("invalid_input", "Asset name is required", 400);
    const CATS = ["electronics", "furniture", "vehicle", "studio", "other"];
    const cat = CATS.includes(String(body?.category)) ? String(body!.category) : "other";
    let tag = str(body?.asset_tag, 30) ? (body!.asset_tag as string).trim().toUpperCase() : "";
    if (!tag) {
      // auto tag AZOA-001, 002 … from the highest existing number
      const maxRow = await env.DB.prepare(
        `SELECT asset_tag FROM assets WHERE asset_tag LIKE 'AZOA-%' ORDER BY LENGTH(asset_tag) DESC, asset_tag DESC LIMIT 1`,
      ).first<{ asset_tag: string }>();
      const n = maxRow ? parseInt(maxRow.asset_tag.slice(5), 10) + 1 : 1;
      tag = `AZOA-${String(Number.isFinite(n) ? n : 1).padStart(3, "0")}`;
    }
    const priceC = body?.purchase_price != null && String(body.purchase_price).trim() !== ""
      ? Math.round(Number(body.purchase_price) * 100) : null;
    if (priceC !== null && (!Number.isFinite(priceC) || priceC < 0)) return err("invalid_input", "purchase_price must be a number", 400);
    const asgn = body?.assigned_to != null && String(body.assigned_to) !== "" ? Number(body.assigned_to) : null;
    try {
      const r = await env.DB.prepare(
        `INSERT INTO assets (asset_tag, name, category, brand_model, serial_no, purchase_date, purchase_price_cents, vendor, warranty_until, location, assigned_to, status, condition_note, created_by)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)`,
      ).bind(
        tag, nameA, cat,
        str(body?.brand_model, 120) ? (body!.brand_model as string).trim() : null,
        str(body?.serial_no, 120) ? (body!.serial_no as string).trim() : null,
        str(body?.purchase_date, 10) ? (body!.purchase_date as string) : null,
        priceC,
        str(body?.vendor, 120) ? (body!.vendor as string).trim() : null,
        str(body?.warranty_until, 10) ? (body!.warranty_until as string) : null,
        str(body?.location, 120) ? (body!.location as string).trim() : null,
        asgn,
        ["in_use", "spare", "repair", "lost", "disposed"].includes(String(body?.status)) ? String(body!.status) : "in_use",
        str(body?.condition_note, 300) ? (body!.condition_note as string).trim() : null,
        user.id,
      ).run();
      await audit(env, user.id, "asset.create", "assets", String(r.meta.last_row_id), { tag });
      return json({ ok: true, id: r.meta.last_row_id, asset_tag: tag });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("UNIQUE")) return err("invalid_input", `Asset tag ${tag} already exists`, 400);
      throw e;
    }
  }

  /* v1.4.226 (CEO: "add commission which is 1.5% for me to pay"): the
     month's all-channel sales as a commission base — SAME four bases as
     /revenue (TikTok TT- order amounts excl. returned; payments received
     in-month; other shipments; manual sales), self-contained here because
     /revenue's helpers are scoped inside that route. */
  if (path === "/payroll/commission-base" && method === "GET") {
    // v1.5.0 fix: PAYROLL_PROC was referenced before its declaration and
    // `url` was undefined — the commission card 500'd on every open.
    const PAYROLL_PROC_CB = ["super_admin", "admin", "ceo", "coo"];
    if (!PAYROLL_PROC_CB.includes(user.role)) return err("forbidden", "Payroll access required", 403);
    const mCB = new URL(request.url).searchParams.get("month") ?? new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(mCB)) return err("invalid_input", "month must be YYYY-MM", 400);
    // Queries mirror /revenue verbatim (v1.4.169/172 bases).
    const tt = await env.DB.prepare(
      `SELECT COALESCE(SUM(order_amount_cents), 0) AS cents FROM postage_records
       WHERE order_ref LIKE 'TT-%' AND status != 'returned'
         AND strftime('%Y-%m', created_at, '+8 hours') = ?1`,
    ).bind(mCB).first<{ cents: number }>();
    const inv = await env.DB.prepare(
      `SELECT COALESCE(SUM(total_cents), 0) AS cents
       FROM sales_documents WHERE doc_type = 'INV' AND payment_status = 'paid'
         AND strftime('%Y-%m', COALESCE(paid_at, created_at), '+8 hours') = ?1`,
    ).bind(mCB).first<{ cents: number }>();
    const oth = await env.DB.prepare(
      `SELECT COALESCE(SUM(order_amount_cents), 0) AS cents FROM postage_records
       WHERE order_ref NOT LIKE 'TT-%' AND status != 'returned'
         AND strftime('%Y-%m', created_at, '+8 hours') = ?1`,
    ).bind(mCB).first<{ cents: number }>();
    let man: { cents: number } | null = null;
    try {
      man = await env.DB.prepare(
        `SELECT COALESCE(SUM(total_cents), 0) AS cents FROM manual_sales
         WHERE (CASE WHEN out_date IS NOT NULL THEN substr(out_date, 1, 7)
                     ELSE strftime('%Y-%m', created_at, '+8 hours') END) = ?1`,
      ).bind(mCB).first<{ cents: number }>();
    } catch {
      try {
        man = await env.DB.prepare(
          `SELECT COALESCE(SUM(total_cents), 0) AS cents FROM manual_sales
           WHERE strftime('%Y-%m', created_at, '+8 hours') = ?1`,
        ).bind(mCB).first<{ cents: number }>();
      } catch { man = { cents: 0 }; }
    }
    const total = (tt?.cents ?? 0) + (inv?.cents ?? 0) + (oth?.cents ?? 0) + (man?.cents ?? 0);
    return json({
      month: mCB,
      total_cents: total,
      breakdown: { tiktok_cents: tt?.cents ?? 0, invoiced_cents: inv?.cents ?? 0, other_cents: oth?.cents ?? 0, manual_cents: man?.cents ?? 0 },
    });
  }

  /* ================= v1.4.219: CEO tab access control =================
     One system_meta row (key tab_access) holds { [tab]: role[] } overrides.
     Absent tab = built-in default. Safety rails: Dashboard + Profile are
     not configurable (clock-in and payslips must never disappear), and
     super_admin ignores overrides entirely — the escape hatch if an
     assignment locks everyone (even the CEO) out of a tab. */
  /* v1.79.0 — the registry this mirrors is lib/portal-tabs.ts now, not
     page.tsx: the client's copy of the list, its defaults and its role chips
     were consolidated there after the 🔐 card drifted out of sync a second
     time. The worker keeps its OWN list on purpose — it is a separate
     deployable and must validate input without trusting the client — and
     tests/registry-parity.mjs fails the build if the two ever disagree.
     Order below follows ALL_TABS so a diff between the two reads straight.
     v1.21.4 — resynced with ALL_TABS. The old list still allowed
     Overview/Pipeline/Expenses/Birthdays (retired or folded) and REFUSED
     Finance and the five ERP tabs, so the CEO could not override the tabs
     the portal actually shows. Stale override keys in system_meta are
     harmless — the client only reads keys for tabs it knows. */
  const TAB_ACCESS_TABS = ["Attendance", "Ecommerce", "Inventory", "ELFIA Store", "Web Orders", "ELFIA Traffic", "Sales", "Announcements", "HR", "Staff Details", "Leave", "Claims", "Payroll", "Finance", "Tasks", "Content", "Threads", "Reconciliation", "Commission", "Ads Fund", "Purchasing", "Accounting", "Stokis", "Assets", "Users"]; // v1.40.0 (AUDIT M11): Web Orders joined; v1.43.0: ELFIA Traffic; v1.79.0: reordered to match ALL_TABS — tests/registry-parity.mjs fails the build when this list and the registry drift
  const TAB_ACCESS_ROLES = ["admin", "ceo", "coo", "cco", "hr_admin", "sales_marketing", "marketing", "editor", "live_host"];

  /* v1.90.0 — per-person grants and refusals (lib/portal-tabs.ts accessOf).
     One JSON map in system_meta: { "<user id>": { allow: [...], deny: [...] } }.
     Every staff member receives ONLY their own entry with the role map;
     the whole map is a CEO read. */
  type PersonAccess = { allow: string[]; deny: string[] };
  const readPeople = async (): Promise<Record<string, PersonAccess>> => {
    const row = await env.DB.prepare(`SELECT value FROM system_meta WHERE key = 'tab_access_people'`).first<{ value: string }>();
    try {
      const raw = row?.value ? (JSON.parse(row.value) as Record<string, Partial<PersonAccess>>) : {};
      const out: Record<string, PersonAccess> = {};
      for (const [k, v] of Object.entries(raw)) {
        out[k] = { allow: Array.isArray(v?.allow) ? v.allow.map(String) : [], deny: Array.isArray(v?.deny) ? v.deny.map(String) : [] };
      }
      return out;
    } catch { return {}; }
  };

  if (path === "/tabs/access" && method === "GET") {
    // Every staff member needs this to compute their own tab strip.
    const row = await env.DB.prepare(`SELECT value FROM system_meta WHERE key = 'tab_access'`).first<{ value: string }>();
    let overrides: Record<string, string[]> = {};
    try { overrides = row?.value ? (JSON.parse(row.value) as Record<string, string[]>) : {}; } catch { overrides = {}; }
    const people = await readPeople();
    return json({ overrides, mine: people[String(user.id)] ?? null });
  }

  if (path === "/tabs/access/people" && method === "GET") {
    if (user.role !== "ceo" && user.role !== "super_admin") return err("forbidden", "Only the CEO reviews tab access", 403);
    return json({ people: await readPeople() });
  }

  if (path === "/tabs/access/person" && method === "POST") {
    if (user.role !== "ceo" && user.role !== "super_admin") return err("forbidden", "Only the CEO manages tab access", 403);
    const targetId = Number(body?.user_id);
    if (!Number.isInteger(targetId) || targetId <= 0) return err("invalid_input", "user_id is required", 400);
    const mode = typeof body?.mode === "string" ? body.mode : "";
    if (!["allow", "deny", "clear", "reset"].includes(mode)) return err("invalid_input", "mode must be allow, deny, clear or reset", 400);
    const tabName = typeof body?.tab === "string" ? body.tab : "";
    if (mode !== "reset" && !TAB_ACCESS_TABS.includes(tabName)) return err("invalid_input", `tab must be one of: ${TAB_ACCESS_TABS.join(", ")}`, 400);
    const target = await env.DB.prepare(`SELECT id, role, COALESCE(NULLIF(TRIM(full_name), ''), name) AS name FROM users WHERE id = ?1`).bind(targetId).first<{ id: number; role: string; name: string }>();
    if (!target || target.role === "customer") return err("not_found", "No such staff member", 404);
    if (target.role === "super_admin") return err("invalid_input", "super_admin bypasses tab access and cannot be governed", 400);
    const people = await readPeople();
    const cur = people[String(targetId)] ?? { allow: [], deny: [] };
    const without = (xs: string[]) => xs.filter((t) => t !== tabName);
    let next: PersonAccess;
    if (mode === "reset") next = { allow: [], deny: [] };
    else if (mode === "allow") next = { allow: [...without(cur.allow), tabName], deny: without(cur.deny) };
    else if (mode === "deny") next = { allow: without(cur.allow), deny: [...without(cur.deny), tabName] };
    else next = { allow: without(cur.allow), deny: without(cur.deny) };
    if (next.allow.length === 0 && next.deny.length === 0) delete people[String(targetId)];
    else people[String(targetId)] = next;
    await env.DB.prepare(
      `INSERT INTO system_meta (key, value) VALUES ('tab_access_people', ?1) ON CONFLICT(key) DO UPDATE SET value = ?1`,
    ).bind(JSON.stringify(people)).run();
    await audit(env, user.id, "tabs.person_access", "users", String(targetId), { name: target.name, role: target.role, tab: tabName || null, mode, allow: next.allow, deny: next.deny });
    return json({ ok: true, person: people[String(targetId)] ?? null });
  }

  if (path === "/tabs/access" && method === "POST") {
    if (user.role !== "ceo" && user.role !== "super_admin") return err("forbidden", "Only the CEO manages tab access", 403);
    const tabName = typeof body?.tab === "string" ? body.tab : "";
    if (!TAB_ACCESS_TABS.includes(tabName)) return err("invalid_input", `tab must be one of: ${TAB_ACCESS_TABS.join(", ")}`, 400);
    const row = await env.DB.prepare(`SELECT value FROM system_meta WHERE key = 'tab_access'`).first<{ value: string }>();
    let overrides: Record<string, string[]> = {};
    try { overrides = row?.value ? (JSON.parse(row.value) as Record<string, string[]>) : {}; } catch { overrides = {}; }
    if (body?.reset === true || body?.roles == null) {
      delete overrides[tabName]; // back to the built-in default
    } else {
      if (!Array.isArray(body.roles)) return err("invalid_input", "roles must be an array", 400);
      const roles = (body.roles as unknown[]).map(String).filter((r) => TAB_ACCESS_ROLES.includes(r));
      overrides[tabName] = roles; // empty array = admin tier only (super_admin bypass)
    }
    await env.DB.prepare(
      `INSERT INTO system_meta (key, value) VALUES ('tab_access', ?1) ON CONFLICT(key) DO UPDATE SET value = ?1`,
    ).bind(JSON.stringify(overrides)).run();
    await audit(env, user.id, "tabs.access_change", "system_meta", "tab_access", { tab: tabName, roles: overrides[tabName] ?? "default" });
    return json({ ok: true, overrides });
  }

  const assetPatch = path.match(/^\/assets\/(\d+)$/);
  if (assetPatch && method === "PATCH") {
    if (!can(user.role, "hr_manage")) return err("forbidden", "HR access required", 403);
    const idA = assetPatch[1]!;
    const sets: string[] = []; const vals: (string | number | null)[] = [];
    const put = (col: string, v: string | number | null) => { sets.push(`${col} = ?${sets.length + 1}`); vals.push(v); };
    for (const f of ["name", "brand_model", "serial_no", "purchase_date", "vendor", "warranty_until", "location", "condition_note"] as const) {
      if (typeof body?.[f] === "string") put(f, (body[f] as string).trim() || null);
    }
    if (typeof body?.category === "string" && ["electronics", "furniture", "vehicle", "studio", "other"].includes(body.category)) put("category", body.category);
    if (typeof body?.status === "string" && ["in_use", "spare", "repair", "lost", "disposed"].includes(body.status)) put("status", body.status);
    if (body && "assigned_to" in body) put("assigned_to", body.assigned_to != null && String(body.assigned_to) !== "" ? Number(body.assigned_to) : null);
    if (body && "purchase_price" in body) {
      const pc = String(body.purchase_price ?? "").trim() === "" ? null : Math.round(Number(body.purchase_price) * 100);
      if (pc !== null && !Number.isFinite(pc)) return err("invalid_input", "purchase_price must be a number", 400);
      put("purchase_price_cents", pc);
    }
    if (sets.length === 0) return err("invalid_input", "Nothing to update", 400);
    put("updated_at", new Date().toISOString().slice(0, 19).replace("T", " "));
    vals.push(idA);
    await env.DB.prepare(`UPDATE assets SET ${sets.join(", ")} WHERE id = ?${vals.length}`).bind(...vals).run();
    await audit(env, user.id, "asset.update", "assets", idA, body as Record<string, unknown>);
    return json({ ok: true });
  }
  if (path === "/revenue/target" && method === "POST") {
    // v1.4.90 / v1.6.1: monthly sales KPI target — set on the Dashboard by
    // the super admin, CEO or COO only (the CEO's explicit list).
    if (!["super_admin", "ceo", "coo"].includes(user.role)) {
      return err("forbidden", "Only the super admin, CEO or COO set the sales KPI target", 403);
    }
    const mT = typeof body?.month === "string" && /^\d{4}-\d{2}$/.test(body.month) ? body.month : null;
    const cT = Math.round(Number(body?.target_cents));
    if (!mT || !Number.isFinite(cT) || cT < 0) return err("invalid_input", "month (YYYY-MM) and target_cents required", 400);
    await env.DB.prepare(
      `INSERT INTO sales_targets (month, target_cents, set_by) VALUES (?1, ?2, ?3)
       ON CONFLICT(month) DO UPDATE SET target_cents = ?2, set_by = ?3`,
    ).bind(mT, cT, user.id).run();
    await audit(env, user.id, "revenue.target_set", "sales_targets", mT, { target_cents: cT });
    return json({ ok: true });
  }

  /* ---- tasks ---- */

  if (path === "/tasks" && method === "GET") {
    const url = new URL(request.url);
    const all = url.searchParams.get("all") === "1" && can(user.role, "team_manage");
    const { results } = await env.DB.prepare(
      all
        ? `SELECT t.*, u.name AS assignee FROM tasks t JOIN users u ON u.id = t.assigned_to ORDER BY t.created_at DESC LIMIT 200`
        : `SELECT * FROM tasks WHERE assigned_to = ?1 ORDER BY created_at DESC LIMIT 100`,
    ).bind(...(all ? [] : [user.id])).all();
    /* v1.42.0: each task carries its scope tally (done/total items) and
       whether the assignee has ACKNOWLEDGED it — the two facts the list
       needs to be a monitoring surface instead of a list of titles.
       Armored: pre-0083 the tasks render exactly as before. */
    try {
      const { results: agg } = await env.DB.prepare(
        `SELECT task_id, COUNT(*) AS n, COALESCE(SUM(done), 0) AS d FROM task_items GROUP BY task_id`,
      ).all<{ task_id: number; n: number; d: number }>();
      const { results: acks } = await env.DB.prepare(
        `SELECT DISTINCT task_id FROM task_events WHERE kind = 'ack'`,
      ).all<{ task_id: number }>();
      const byId = new Map(agg.map((a) => [a.task_id, a]));
      const acked = new Set(acks.map((a) => a.task_id));
      for (const t of results as Record<string, unknown>[]) {
        const a = byId.get(t.id as number);
        t.item_count = a?.n ?? 0;
        t.item_done = a?.d ?? 0;
        t.acknowledged = acked.has(t.id as number) ? 1 : 0;
      }
    } catch { /* pre-0083 */ }
    return json({ tasks: results });
  }
  if (path === "/tasks" && method === "POST") {
    // Staff create their own tasks (they know their work). Managers may also
    // assign to others; a plain staff member can only assign to themselves.
    if (!body || !str(body.title, 200)) {
      return err("invalid_input", "title is required", 400);
    }
    const assignedTo = typeof body.assigned_to === "number" ? body.assigned_to : user.id;
    if (assignedTo !== user.id && !can(user.role, "team_manage")) {
      return err("forbidden", "You can only create tasks for yourself", 403);
    }
    const prio = ["low", "normal", "high", "urgent"];
    const res = await env.DB.prepare(
      `INSERT INTO tasks (title, description, assigned_to, created_by, priority, deadline)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6) RETURNING id`,
    ).bind(
      body.title, str(body.description, 5000) ? body.description : null,
      assignedTo, user.id,
      typeof body.priority === "string" && prio.includes(body.priority) ? body.priority : "normal",
      str(body.deadline, 10) ? body.deadline : null,
    ).first<{ id: number }>();
    /* v1.42.0: the SCOPE — one deliverable per line from the form, stored as
       tickable items. Progress is then derived, not typed. */
    let itemCount = 0;
    if (res?.id && Array.isArray(body.items)) {
      const lines = (body.items as unknown[])
        .filter((x) => str(x, 200)).map((x) => String(x).trim()).filter(Boolean).slice(0, 20);
      try {
        for (let si = 0; si < lines.length; si++) {
          await env.DB.prepare(
            `INSERT INTO task_items (task_id, title, sort) VALUES (?1, ?2, ?3)`,
          ).bind(res.id, lines[si], si).run();
        }
        itemCount = lines.length;
      } catch { /* pre-0083 — the task still exists, scope stays in description */ }
    }
    /* v1.66.0 Track R — assigned FROM the roster, with a slot.
       The board creates the task and its first block in one action, because
       two actions is how a task ends up assigned and never scheduled. The
       block is optional: the Tasks tab still creates plain tasks and this
       whole branch is skipped. */
    let firstBlock: number | undefined;
    let blockDays = 0;
    const blk = body.block as { block_date?: unknown; dates?: unknown;
                                start_time?: unknown; end_time?: unknown } | undefined;
    /* v1.67.0 — a run of days, from the form's repeat rule. One day still
       works exactly as before: `block_date` on its own is a run of one. */
    const rawB: unknown[] = Array.isArray(blk?.dates)
      ? (blk.dates as unknown[])
      : [typeof blk?.block_date === "string" ? blk.block_date : ""];
    const bDates = [...new Set(rawB.filter((x): x is string =>
      typeof x === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x)))].sort().slice(0, 62);
    const bDate = bDates[0] ?? "";
    const bStart = typeof blk?.start_time === "string" ? blk.start_time : "";
    if (res?.id && bDates.length > 0 && /^\d{2}:\d{2}$/.test(bStart)) {
      const bEnd = typeof blk?.end_time === "string" && /^\d{2}:\d{2}$/.test(blk.end_time) ? blk.end_time : null;
      try {
        for (const day of bDates) {
          const b = await env.DB.prepare(
            `INSERT INTO task_blocks (task_id, user_id, block_date, start_time, end_time, created_by)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6) RETURNING id`,
          ).bind(res.id, assignedTo, day, bStart, bEnd, user.id).first<{ id: number }>();
          if (firstBlock === undefined) firstBlock = b?.id;
          blockDays++;
        }
      } catch { /* pre-0095 — the task exists, it is simply unscheduled */ }
    }
    /* v1.68.1: notify when it is somebody else's task, OR when it has been
       SCHEDULED — see the note in POST /task-blocks. A plain task you made
       for yourself is the only case that stays silent. */
    if (assignedTo !== user.id || firstBlock !== undefined) {
      /* A time is a different instruction from a date. "Wednesday
         10:00-12:00" tells somebody when to start; "due Wednesday" tells
         them when to panic. When the board gave us a slot, say the slot. */
      const when = firstBlock
        ? ` — ${bDate.split("-").reverse().join("-")} ${bStart}${typeof blk?.end_time === "string" && blk.end_time ? `-${blk.end_time}` : ""}`
          + (blockDays > 1 ? ` (${blockDays} days, to ${bDates[bDates.length - 1]!.split("-").reverse().join("-")})` : "")
        : str(body.deadline, 10) ? ` (due ${body.deadline as string})` : "";
      const scope = itemCount > 0 ? ` — ${itemCount} scope item${itemCount === 1 ? "" : "s"}` : "";
      const own = assignedTo === user.id;
      await notify(env, assignedTo, "task",
        `${firstBlock ? `🗓️ Scheduled${own ? " — yours" : ""}` : "📋 New task assigned"}: ${body.title as string}${when}${scope}.`
        + (own ? "" : " Open the Tasks tab and press Acknowledge."),
        `task:${res?.id}`);
    }
    await audit(env, user.id, "task.create", "tasks", String(res?.id));
    return json({ id: res?.id, block_id: firstBlock, days: blockDays }, 201);
  }

  /* ===================== v1.66.0 — Track R: task blocks =====================
     A block is WHEN THE WORK HAPPENS. The task itself still owns what the
     work is, who it belongs to, its scope and its deadline; a block only
     claims a slot on somebody's day. One task may have several.

     PERMISSION (OD-27, decided 28-08): these follow the TASK rule, not the
     live-session rule. Live scheduling is management-only because a live
     session commits the shop's storefront; planning your own week is not
     that. A staff member may schedule their OWN task on their OWN row;
     `team_manage` may schedule anyone. Applying the live rule here would
     have taken self-planning away from the marketing team, which would be a
     step backwards dressed up as consistency. */
  if (path === "/task-blocks" && method === "POST") {
    const taskId = Number(body?.task_id);
    const st = typeof body?.start_time === "string" ? body.start_time : "";
    /* v1.67.0 — a RUN, not a day.
       A standing duty ("watch the shop floor, every weekday, until Friday")
       was five separate saves, which is five chances to get one of them
       wrong and no record that they belong together. The client expands its
       repeat rule and posts the dates; the server validates every one of
       them and writes them in a single request, so a run either lands or is
       rejected as a whole rather than half-appearing.
       `block_date` still works on its own — the rail's tap-a-day gesture
       posts exactly one date and knows nothing about runs. */
    const rawDates: unknown[] = Array.isArray(body?.dates)
      ? (body.dates as unknown[])
      : [typeof body?.block_date === "string" ? body.block_date : ""];
    const dates = [...new Set(rawDates.filter((x): x is string =>
      typeof x === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x)))].sort();
    const d = dates[0] ?? "";
    if (!taskId || dates.length === 0 || !/^\d{2}:\d{2}$/.test(st)) {
      return err("invalid_input", "task_id, a date and start_time are required", 400);
    }
    /* The same cap the live-session planner uses. A rule that expands to a
       year of blocks is a mistake being made quickly, not a feature. */
    if (dates.length > 62) return err("invalid_input", "That repeat rule covers more than 62 days", 400);
    const et = typeof body?.end_time === "string" && /^\d{2}:\d{2}$/.test(body.end_time) ? body.end_time : null;
    if (et && et <= st) return err("invalid_input", "The end time must be after the start time", 400);
    const t = await env.DB.prepare(`SELECT id, title, assigned_to, deadline FROM tasks WHERE id = ?1`)
      .bind(taskId).first<{ id: number; title: string; assigned_to: number; deadline: string | null }>();
    if (!t) return err("not_found", "Task not found", 404);
    /* Who works it: the assignee by default. Naming someone else is a
       management act, because it puts work on another person's day. */
    const who = Number(body?.user_id) || t.assigned_to;
    const mgr = can(user.role, "team_manage");
    if (!mgr && (t.assigned_to !== user.id || who !== user.id)) {
      return err("forbidden", "You can only schedule your own tasks, on your own row", 403);
    }
    if (who !== t.assigned_to) {
      const u = await env.DB.prepare(`SELECT is_active, role FROM users WHERE id = ?1`)
        .bind(who).first<{ is_active: number; role: string }>();
      if (!u || !u.is_active || ["customer", "super_admin", "admin"].includes(u.role)) {
        return err("invalid_input", "That must be an active staff member", 400);
      }
    }
    let id: number | undefined;
    try {
      for (const day of dates) {
        const res = await env.DB.prepare(
          `INSERT INTO task_blocks (task_id, user_id, block_date, start_time, end_time, created_by)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6) RETURNING id`,
        ).bind(taskId, who, day, st, et, user.id).first<{ id: number }>();
        if (id === undefined) id = res?.id;
      }
    } catch (e) {
      if (String(e).includes("no such table")) return err("migration_missing", "Run migration 0095 first", 409);
      throw e;
    }
    /* v1.68.1 (CEO: "there is no alert notification appear after task
       assigned") — he had scheduled a six-day run FOR HIMSELF, and the rule
       here was "tell them unless it is you", which is the right rule for a
       plain task and the wrong one for a booking. Nobody needs a bell saying
       what they did a second ago; everybody needs a record that the diary
       now contains six days of work, and the bell is where this portal keeps
       records you can scroll back to.
       So a SCHEDULE always notifies, including your own. An unscheduled task
       you made for yourself still does not, because you are looking at it. */
    {
      const when = `${d.split("-").reverse().join("-")} ${st}${et ? `-${et}` : ""}`;
      const run = dates.length > 1
        ? ` (${dates.length} days, to ${dates[dates.length - 1]!.split("-").reverse().join("-")})` : "";
      const mine = who === user.id ? " — yours" : "";
      await notify(env, who, "task", `🗓️ Scheduled${mine}: ${t.title} — ${when}${run}`, `task:${taskId}:block:${id}`);
    }
    await audit(env, user.id, "task.schedule", "tasks", String(taskId),
                { date: d, days: dates.length, start: st, user: who });
    return json({ ok: true, id, created: dates.length }, 201);
  }

  {
    const mTB = path.match(/^\/task-blocks\/(\d+)$/);
    if (mTB && (method === "PATCH" || method === "DELETE")) {
      const bid = mTB[1]!;
      let blk: { task_id: number; user_id: number; assigned_to: number; title: string } | null = null;
      try {
        blk = await env.DB.prepare(
          `SELECT b.task_id, b.user_id, t.assigned_to, t.title
           FROM task_blocks b JOIN tasks t ON t.id = b.task_id WHERE b.id = ?1`,
        ).bind(bid).first();
      } catch (e) {
        if (String(e).includes("no such table")) return err("migration_missing", "Run migration 0095 first", 409);
        throw e;
      }
      if (!blk) return err("not_found", "Block not found", 404);
      const mgrB = can(user.role, "team_manage");
      if (!mgrB && blk.user_id !== user.id && blk.assigned_to !== user.id) {
        return err("forbidden", "Not your block", 403);
      }

      if (method === "DELETE") {
        await env.DB.prepare(`DELETE FROM task_blocks WHERE id = ?1`).bind(bid).run();
        await audit(env, user.id, "task.unschedule", "tasks", String(blk.task_id));
        return json({ ok: true });
      }

      /* v1.67.0 — "done" is a fact about a DAY, and it is what makes a
         standing duty legible. A task carries one status and one set of
         tick-boxes; ticking "monitor the shop floor" once says nothing about
         whether it happened on Wednesday. The scope describes what a good
         day looks like; the block records that the day happened.
         Deliberately does NOT touch the status of the task itself: a task is
         finished when its days are done AND its scope is ticked, and that is
         a judgement a person makes, not something a checkbox on a calendar
         should decide for them. The count comes back so the board can say
         "4 of 5 days" instead of leaving them to count chips. */
      if (typeof body?.done === "boolean") {
        await env.DB.prepare(`UPDATE task_blocks SET done_at = ?1 WHERE id = ?2`)
          .bind(body.done ? new Date().toISOString() : null, bid).run();
        let done = 0, total = 0;
        try {
          const c = await env.DB.prepare(
            `SELECT COUNT(*) AS n, COALESCE(SUM(done_at IS NOT NULL), 0) AS d
             FROM task_blocks WHERE task_id = ?1`,
          ).bind(blk.task_id).first<{ n: number; d: number }>();
          total = c?.n ?? 0; done = c?.d ?? 0;
        } catch { /* pre-0096 */ }
        await audit(env, user.id, body.done ? "task.day_done" : "task.day_reopened",
                    "tasks", String(blk.task_id));
        return json({ ok: true, done, total });
      }

      /* The drag-and-drop backend: a new day, a new time, or a new person. */
      const setsB: string[] = [];
      const argsB: unknown[] = [];
      const putB = (col: string, v: unknown) => { setsB.push(`${col} = ?${argsB.length + 1}`); argsB.push(v); };
      const bd = typeof body?.block_date === "string" ? body.block_date : "";
      const bs = typeof body?.start_time === "string" ? body.start_time : "";
      const be = typeof body?.end_time === "string" ? body.end_time : "";
      const bu = Number(body?.user_id) || 0;
      if (/^\d{4}-\d{2}-\d{2}$/.test(bd)) putB("block_date", bd);
      if (/^\d{2}:\d{2}$/.test(bs)) putB("start_time", bs);
      if (/^\d{2}:\d{2}$/.test(be)) putB("end_time", be);
      else if (body?.end_time === "" || body?.end_time === null) putB("end_time", null);
      if (bu && bu !== blk.user_id) {
        /* Moving work onto another person is a management act, the same as
           it is when creating a block. */
        if (!mgrB) return err("forbidden", "Only management can move work onto another person", 403);
        const nu = await env.DB.prepare(`SELECT is_active, role FROM users WHERE id = ?1`)
          .bind(bu).first<{ is_active: number; role: string }>();
        if (!nu || !nu.is_active || ["customer", "super_admin", "admin"].includes(nu.role)) {
          return err("invalid_input", "That must be an active staff member", 400);
        }
        putB("user_id", bu);
      }
      if (setsB.length === 0) return err("invalid_input", "Nothing to update", 400);

      /* v1.69.0 — the whole run, not one day of it.
         Getting the hours wrong on a six-day duty used to mean six separate
         corrections, and the sixth is the one that gets forgotten. Times
         only: a DATE applies to one day by definition, so pushing the same
         date across a run would collapse six days into one. */
      const wholeRun = body?.apply_to_run === true;
      const timeOnly = setsB.filter((x) => /^(start_time|end_time) =/.test(x));
      if (wholeRun && timeOnly.length > 0) {
        /* Rebuild the placeholders for the narrower statement rather than
           reusing argsB, whose numbering belongs to the full SET list. */
        const runSets: string[] = [];
        const runArgs: unknown[] = [];
        const startI = setsB.findIndex((x) => x.startsWith("start_time ="));
        if (startI >= 0) { runSets.push(`start_time = ?${runArgs.length + 1}`); runArgs.push(argsB[startI]); }
        const endI = setsB.findIndex((x) => x.startsWith("end_time ="));
        if (endI >= 0) { runSets.push(`end_time = ?${runArgs.length + 1}`); runArgs.push(argsB[endI]); }
        runArgs.push(blk.task_id);
        await env.DB.prepare(
          `UPDATE task_blocks SET ${runSets.join(", ")} WHERE task_id = ?${runArgs.length}`,
        ).bind(...runArgs).run();
      }

      argsB.push(bid);
      await env.DB.prepare(`UPDATE task_blocks SET ${setsB.join(", ")} WHERE id = ?${argsB.length}`)
        .bind(...argsB).run();
      await audit(env, user.id, "task.reschedule", "tasks", String(blk.task_id),
                  wholeRun ? { whole_run: true } : undefined);
      return json({ ok: true });
    }
  }
  const taskMatch = path.match(/^\/tasks\/(\d+)$/);
  if (taskMatch && method === "PATCH") {
    const id = taskMatch[1]!;
    const row = await env.DB.prepare(`SELECT title, assigned_to, created_by FROM tasks WHERE id = ?1`)
      .bind(id).first<{ title: string; assigned_to: number; created_by: number | null }>();
    if (!row) return err("not_found", "Task not found", 404);
    if (row.assigned_to !== user.id && !can(user.role, "team_manage")) {
      return err("forbidden", "Not your task", 403);
    }
    const sets: string[] = [];
    const vals: (string | number | null)[] = [];
    if (typeof body?.progress === "number" && body.progress >= 0 && body.progress <= 100) {
      sets.push(`progress = ?${sets.length + 1}`); vals.push(body.progress);
    }
    if (typeof body?.status === "string" && ["open", "in_progress", "completed"].includes(body.status)) {
      sets.push(`status = ?${sets.length + 1}`); vals.push(body.status);
    }
    /* v1.69.0 (CEO: "I want to have an option for me to update the Task") —
       until now this route could move a task's status and nothing else, so
       fixing a wrong deadline or a typo in a title meant deleting the task
       and building it again, losing its scope, its comments and its history.
       That is not editing, that is retyping. */
    if (str(body?.title, 200)) {
      sets.push(`title = ?${sets.length + 1}`); vals.push(String(body!.title).trim());
    }
    if (typeof body?.description === "string") {
      sets.push(`description = ?${sets.length + 1}`);
      vals.push(body.description.trim() === "" ? null : body.description.slice(0, 5000));
    }
    if (typeof body?.priority === "string" && ["low", "normal", "high", "urgent"].includes(body.priority)) {
      sets.push(`priority = ?${sets.length + 1}`); vals.push(body.priority);
    }
    /* An empty string clears the deadline. A task with no due date is a
       normal thing; a task stuck with the WRONG due date is what generates
       false overdue alerts every morning until somebody mutes the bell. */
    if (typeof body?.deadline === "string") {
      if (body.deadline === "") { sets.push(`deadline = ?${sets.length + 1}`); vals.push(null); }
      else if (/^\d{4}-\d{2}-\d{2}$/.test(body.deadline)) {
        sets.push(`deadline = ?${sets.length + 1}`); vals.push(body.deadline);
      } else return err("invalid_input", "The due date must be a real date", 400);
    }
    /* Reassignment is a management act — it puts work on another person's
       plate, the same rule the roster applies to moving a block. */
    let reassignedTo: number | null = null;
    if (Number(body?.assigned_to) && Number(body!.assigned_to) !== row.assigned_to) {
      if (!can(user.role, "team_manage")) {
        return err("forbidden", "Only management can reassign a task", 403);
      }
      const nu = await env.DB.prepare(`SELECT is_active, role FROM users WHERE id = ?1`)
        .bind(Number(body!.assigned_to)).first<{ is_active: number; role: string }>();
      if (!nu || !nu.is_active || ["customer", "super_admin", "admin"].includes(nu.role)) {
        return err("invalid_input", "That must be an active staff member", 400);
      }
      reassignedTo = Number(body!.assigned_to);
      sets.push(`assigned_to = ?${sets.length + 1}`); vals.push(reassignedTo);
    }
    if (sets.length === 0) return err("invalid_input", "Nothing to update", 400);
    await env.DB.prepare(`UPDATE tasks SET ${sets.join(", ")} WHERE id = ?${sets.length + 1}`)
      .bind(...vals, id).run();
    /* v1.42.0: every status move leaves a trail row, and the OTHER party is
       told — the assigner monitors without asking, the assignee is never
       surprised by a manager's change. Armored (pre-0083 keeps old shape). */
    if (typeof body?.status === "string") {
      const todayS = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
      try {
        await env.DB.prepare(
          `INSERT INTO task_events (task_id, kind, user_id, on_date) VALUES (?1, ?2, ?3, ?4)`,
        ).bind(id, `status:${body.status}`, user.id, todayS).run();
      } catch { /* pre-0083 */ }
      const statusLbl = body.status === "completed" ? "Closed" : body.status === "in_progress" ? "Pending" : "Open";
      if (user.id === row.assigned_to && row.created_by && row.created_by !== user.id) {
        await notify(env, row.created_by, "task", `📋 ${row.title} → ${statusLbl} (by the assignee)`, `task:${id}:st:${body.status}`);
      } else if (user.id !== row.assigned_to) {
        await notify(env, row.assigned_to, "task", `📋 Your task was set to ${statusLbl}: ${row.title}`, `task:${id}:st:${body.status}`);
      }
    }
    /* Whoever now owns it hears that it moved, and the blocks that were
       already on the roster move with it — leaving them on the old person's
       row would show two people booked for one piece of work. */
    if (reassignedTo !== null) {
      try {
        await env.DB.prepare(`UPDATE task_blocks SET user_id = ?1 WHERE task_id = ?2`)
          .bind(reassignedTo, id).run();
      } catch { /* pre-0095 */ }
      await notify(env, reassignedTo, "task",
        `📋 Task moved to you: ${str(body?.title, 200) ? String(body!.title).trim() : row.title}. Open the Tasks tab and press Acknowledge.`,
        `task:${id}:reassign:${reassignedTo}`);
      if (row.assigned_to !== user.id) {
        await notify(env, row.assigned_to, "task",
          `📋 No longer yours: ${row.title} — it has been reassigned.`, `task:${id}:unassign`);
      }
    }
    await audit(env, user.id, "task.update", "tasks", String(id));
    return json({ ok: true });
  }

  /* v1.72.0 (CEO: "on Tasks tabs, I want to have an option for me to delete
     which is roles CEO only to have this fuction access").

     Everything else a task can suffer is reversible - a wrong status flips
     back, a wrong deadline is edited, a wrong assignee is reassigned. This
     is not, so it is the CEO alone (see task_delete in permissions.ts).

     The children go first and by hand. These tables were created without ON
     DELETE CASCADE, so deleting only the parent would leave scope items,
     events, comments and roster blocks pointing at a task id that no longer
     exists - and the roster reads task_blocks by date, not through tasks, so
     a deleted task would keep occupying somebody working week forever.

     What is deliberately NOT deleted: the audit row, which records the title
     so the log still says what was destroyed rather than just an id, and any
     media attached to a comment, which may be referenced from elsewhere. */
  if (taskMatch && method === "DELETE") {
    if (!can(user.role, "task_delete")) {
      return err("forbidden", "Only the CEO can delete a task", 403);
    }
    const id = taskMatch[1]!;
    const row = await env.DB.prepare(
      `SELECT title, assigned_to, created_by FROM tasks WHERE id = ?1`,
    ).bind(id).first<{ title: string; assigned_to: number; created_by: number | null }>();
    if (!row) return err("not_found", "Task not found", 404);
    for (const childSql of [
      `DELETE FROM task_items WHERE task_id = ?1`,
      `DELETE FROM task_events WHERE task_id = ?1`,
      `DELETE FROM task_comments WHERE task_id = ?1`,
      `DELETE FROM task_blocks WHERE task_id = ?1`,
    ]) {
      /* Each child table arrived with a different migration (0083, 0095).
         A database that has not reached one of them must still be able to
         delete a task, so a missing table is skipped rather than fatal. */
      try { await env.DB.prepare(childSql).bind(id).run(); } catch { /* pre-0083 / pre-0095 */ }
    }
    await env.DB.prepare(`DELETE FROM tasks WHERE id = ?1`).bind(id).run();
    /* The people who were carrying it are told, once. Silence here means a
       staff member keeps a deleted task on their list until they refresh
       and wonder where their work went. */
    if (row.assigned_to && row.assigned_to !== user.id) {
      await notify(env, row.assigned_to, "task",
        `Removed: ${row.title} - this task was deleted by the CEO.`, `task:${id}:deleted`);
    }
    if (row.created_by && row.created_by !== user.id && row.created_by !== row.assigned_to) {
      await notify(env, row.created_by, "task",
        `Removed: ${row.title} - the task you set was deleted by the CEO.`, `task:${id}:deleted`);
    }
    await audit(env, user.id, "task.delete", "tasks", String(id), {
      title: row.title, assigned_to: row.assigned_to,
    });
    return json({ ok: true });
  }
  /* v1.42.0 — the scope checklist. Reading it: assignee, creator, or a
     manager. Ticking it: assignee or a manager — ticking IS the progress
     report, tasks.progress becomes derived (done/total). */
  const taskItems = path.match(/^\/tasks\/(\d+)\/items$/);
  if (taskItems && method === "GET") {
    const t = await env.DB.prepare(`SELECT assigned_to, created_by FROM tasks WHERE id = ?1`)
      .bind(taskItems[1]).first<{ assigned_to: number; created_by: number | null }>();
    if (!t) return err("not_found", "Task not found", 404);
    if (t.assigned_to !== user.id && t.created_by !== user.id && !can(user.role, "team_manage")) {
      return err("forbidden", "Not your task", 403);
    }
    try {
      const { results } = await env.DB.prepare(
        `SELECT i.id, i.title, i.done, i.done_at, u.name AS done_by_name
         FROM task_items i LEFT JOIN users u ON u.id = i.done_by
         WHERE i.task_id = ?1 ORDER BY i.sort, i.id`,
      ).all();
      return json({ items: results });
    } catch { return json({ items: [], pending_migration: true }); }
  }
  const taskItemToggle = path.match(/^\/tasks\/(\d+)\/items\/(\d+)\/toggle$/);
  if (taskItemToggle && method === "POST") {
    const t = await env.DB.prepare(`SELECT title, assigned_to, created_by, status FROM tasks WHERE id = ?1`)
      .bind(taskItemToggle[1]).first<{ title: string; assigned_to: number; created_by: number | null; status: string }>();
    if (!t) return err("not_found", "Task not found", 404);
    if (t.assigned_to !== user.id && !can(user.role, "team_manage")) {
      return err("forbidden", "Only the assignee (or a manager) ticks the scope", 403);
    }
    try {
      const it = await env.DB.prepare(`SELECT id, done FROM task_items WHERE id = ?1 AND task_id = ?2`)
        .bind(taskItemToggle[2], taskItemToggle[1]).first<{ id: number; done: number }>();
      if (!it) return err("not_found", "Scope item not found", 404);
      const nowDone = it.done ? 0 : 1;
      await env.DB.prepare(
        `UPDATE task_items SET done = ?1, done_by = ?2, done_at = CASE WHEN ?1 = 1 THEN datetime('now') ELSE NULL END WHERE id = ?3`,
      ).bind(nowDone, nowDone ? user.id : null, it.id).run();
      const agg = await env.DB.prepare(
        `SELECT COUNT(*) AS n, COALESCE(SUM(done), 0) AS d FROM task_items WHERE task_id = ?1`,
      ).bind(taskItemToggle[1]).first<{ n: number; d: number }>();
      const progress = agg && agg.n > 0 ? Math.round((agg.d / agg.n) * 100) : 0;
      await env.DB.prepare(`UPDATE tasks SET progress = ?1 WHERE id = ?2`).bind(progress, taskItemToggle[1]).run();
      /* The moment the whole scope is ticked, the assigner hears it — once
         per day, so re-ticking cannot spam. */
      if (progress === 100 && t.created_by && t.created_by !== user.id) {
        const todayD = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
        const dup = await env.DB.prepare(
          `SELECT id FROM task_events WHERE task_id = ?1 AND kind = 'scope_done' AND on_date = ?2 LIMIT 1`,
        ).bind(taskItemToggle[1], todayD).first<{ id: number }>();
        if (!dup) {
          await env.DB.prepare(`INSERT INTO task_events (task_id, kind, user_id, on_date) VALUES (?1, 'scope_done', ?2, ?3)`)
            .bind(taskItemToggle[1], user.id, todayD).run();
          await notify(env, t.created_by, "task", `✅ All scope items done: ${t.title} — review and close it`, `task:${taskItemToggle[1]}:done`);
        }
      }
      return json({ done: nowDone, progress });
    } catch {
      return err("migration_missing", "Run: npx wrangler d1 migrations apply azoneofficial --remote (0083_task_tracking)", 500);
    }
  }
  /* v1.42.0 — the acknowledgement: the assignee's explicit "seen and
     understood". Until it exists the assigner sees an amber badge and the
     cron nudges daily; after it, both sides have a timestamped fact. */
  const taskAck = path.match(/^\/tasks\/(\d+)\/ack$/);
  if (taskAck && method === "POST") {
    const t = await env.DB.prepare(`SELECT title, assigned_to, created_by FROM tasks WHERE id = ?1`)
      .bind(taskAck[1]).first<{ title: string; assigned_to: number; created_by: number | null }>();
    if (!t) return err("not_found", "Task not found", 404);
    if (t.assigned_to !== user.id) return err("forbidden", "Only the assignee acknowledges a task", 403);
    try {
      const dup = await env.DB.prepare(
        `SELECT id FROM task_events WHERE task_id = ?1 AND kind = 'ack' LIMIT 1`,
      ).bind(taskAck[1]).first<{ id: number }>();
      if (!dup) {
        const todayA = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
        await env.DB.prepare(`INSERT INTO task_events (task_id, kind, user_id, on_date) VALUES (?1, 'ack', ?2, ?3)`)
          .bind(taskAck[1], user.id, todayA).run();
        if (t.created_by && t.created_by !== user.id) {
          await notify(env, t.created_by, "task", `👍 ${user.name} acknowledged: ${t.title}`, `task:${taskAck[1]}:ack`);
        }
        await audit(env, user.id, "task.ack", "tasks", taskAck[1]);
      }
      return json({ ok: true });
    } catch {
      return err("migration_missing", "Run: npx wrangler d1 migrations apply azoneofficial --remote (0083_task_tracking)", 500);
    }
  }
  const commentMatch = path.match(/^\/tasks\/(\d+)\/comments$/);
  /* v1.45.0 (security audit S2) — a task's conversation belongs to the people
     on that task.
     Both handlers below used to check nothing beyond "is signed-in staff", so
     anyone could walk the task ids and read — or write into — a thread they
     had no part in. Discussions name customers, prices and problems; that is
     not an all-staff noticeboard. The rule is the one its sibling
     /tasks/:id/items already used: the assignee, the person who set the task,
     or someone who manages the team. */
  const taskScopeOk = async (taskId: string): Promise<boolean> => {
    if (can(user.role, "team_manage")) return true;
    const t = await env.DB.prepare(`SELECT assigned_to, created_by FROM tasks WHERE id = ?1`)
      .bind(taskId).first<{ assigned_to: number | null; created_by: number | null }>();
    if (!t) return false;
    return t.assigned_to === user.id || t.created_by === user.id;
  };
  if (commentMatch && method === "POST") {
    if (!body || !str(body.comment, 2000)) return err("invalid_input", "comment is required", 400);
    if (!(await taskScopeOk(commentMatch[1]!))) return err("forbidden", "That task is not yours", 403);
    /* An attachment must be the caller's own upload — otherwise a comment
       could quietly staple somebody else's file (a payslip, a signed
       document) onto a task for others to open. */
    let attachment: number | null = null;
    if (typeof body.attachment_media_id === "number") {
      const own = await env.DB.prepare(`SELECT id FROM media WHERE id = ?1 AND uploaded_by = ?2`)
        .bind(body.attachment_media_id, user.id).first<{ id: number }>().catch(() => null);
      if (!own) return err("forbidden", "That attachment is not yours to post", 403);
      attachment = body.attachment_media_id;
    }
    await env.DB.prepare(
      `INSERT INTO task_comments (task_id, user_id, comment, attachment_media_id) VALUES (?1, ?2, ?3, ?4)`,
    ).bind(commentMatch[1], user.id, body.comment, attachment).run();
    return json({ ok: true }, 201);
  }
  if (commentMatch && method === "GET") {
    if (!(await taskScopeOk(commentMatch[1]!))) return err("forbidden", "That task is not yours", 403);
    const { results } = await env.DB.prepare(
      `SELECT c.comment, c.created_at, u.name FROM task_comments c
       JOIN users u ON u.id = c.user_id WHERE c.task_id = ?1 ORDER BY c.created_at`,
    ).bind(commentMatch[1]).all();
    return json({ comments: results });
  }

  /* ---- CRM customers ---- */

  /* v1.4.191 CLIENT LAYER (CEO gap list): per-client view for an agency —
     the customers registry IS the client list; this summary joins invoiced /
     paid totals from sales docs and scheduled live sessions per client. */
  if (path === "/clients/summary" && method === "GET") {
    if (!can(user.role, "revenue_view")) return err("forbidden", "Sales access required", 403);
    /* v1.23.7 (error_log 17-08 15:16: "no such column: c.name"): customers
       has contact_person, not name — this query 500'd on EVERY call since it
       was written (the clients directory card showed its error state, and
       the command palette silently skipped client results). Aliased. */
    const { results } = await env.DB.prepare(
      `SELECT c.id, c.company, c.contact_person AS name, c.phone, c.email,
              (SELECT COUNT(*) FROM sales_documents d WHERE d.customer_id = c.id AND d.doc_type = 'INV') AS invoices,
              (SELECT COALESCE(SUM(d.total_cents), 0) FROM sales_documents d WHERE d.customer_id = c.id AND d.doc_type = 'INV') AS invoiced_cents,
              (SELECT COALESCE(SUM(d.total_cents), 0) FROM sales_documents d WHERE d.customer_id = c.id AND d.doc_type = 'INV' AND d.payment_status = 'paid') AS paid_cents,
              (SELECT COUNT(*) FROM sales_documents d WHERE d.customer_id = c.id AND d.doc_type = 'QT') AS quotations
       FROM customers c
       WHERE c.company != 'Walk-in Customer'
       ORDER BY invoiced_cents DESC, c.company LIMIT 200`,
    ).all();
    // live-session counts ride along when 0056 is applied
    let sessions: Record<string, number> = {};
    try {
      const { results: sess } = await env.DB.prepare(
        `SELECT client_id, COUNT(*) AS n FROM live_sessions WHERE client_id IS NOT NULL AND status != 'cancelled' GROUP BY client_id`,
      ).all<{ client_id: number; n: number }>();
      sessions = Object.fromEntries(sess.map((r) => [String(r.client_id), r.n]));
    } catch { /* pre-0056 */ }
    return json({ clients: results, sessions });
  }

  /* ============ v1.4.273 — THE GROWTH PACK (CEO: "all!") ============ */

  // Idea 1: the client report link. One tokened, public, read-only monthly
  // page per client — same share-link idea as sales documents. POST is
  // idempotent: returns the existing token if one exists.
  {
    const mRL = path.match(/^\/clients\/(\d+)\/report-link$/);
    if (mRL && method === "POST") {
      if (!can(user.role, "revenue_view")) return err("forbidden", "Sales access required", 403);
      const cid = Number(mRL[1]);
      const c = await env.DB.prepare(`SELECT company FROM customers WHERE id = ?1`).bind(cid).first<{ company: string }>();
      if (!c) return err("not_found", "Client not found", 404);
      try {
        const ex = await env.DB.prepare(`SELECT token FROM client_report_links WHERE customer_id = ?1`)
          .bind(cid).first<{ token: string }>();
        if (ex) return json({ ok: true, token: ex.token });
        const token = crypto.randomUUID().replace(/-/g, "");
        await env.DB.prepare(`INSERT INTO client_report_links (customer_id, token) VALUES (?1, ?2)`)
          .bind(cid, token).run();
        await audit(env, user.id, "client.report_link", "customers", String(cid), { company: c.company });
        return json({ ok: true, token }, 201);
      } catch (e) {
        if (String(e).includes("no such table")) return err("migration_missing", "Run migration 0067 (growth pack) first", 409);
        throw e;
      }
    }
  }

  // Idea 6: live-hour economics — RM per live hour, per client and per host,
  // current MYT month. The one number a live agency runs on. Each half is
  // armored separately so a pending migration can't blank the card.
  if (path === "/clients/live-economics" && method === "GET") {
    if (!can(user.role, "revenue_view")) return err("forbidden", "Sales access required", 403);
    const monthMY = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 7);
    let clients: unknown[] = []; let hosts: unknown[] = [];
    try {
      // Per client: completed session hours this month + PAID invoice RM this
      // month (mirrors /revenue's payment-received basis).
      const { results } = await env.DB.prepare(
        `SELECT c.id, c.company,
                (SELECT COALESCE(SUM(CASE WHEN s.end_time IS NOT NULL
                        THEN (CAST(substr(s.end_time,1,2) AS INTEGER)*60 + CAST(substr(s.end_time,4,2) AS INTEGER))
                           - (CAST(substr(s.start_time,1,2) AS INTEGER)*60 + CAST(substr(s.start_time,4,2) AS INTEGER))
                        ELSE 0 END), 0)
                 FROM live_sessions s WHERE s.client_id = c.id AND s.status != 'cancelled'
                   AND substr(s.session_date, 1, 7) = ?1) AS minutes,
                (SELECT COALESCE(SUM(d.total_cents), 0) FROM sales_documents d
                 WHERE d.customer_id = c.id AND d.doc_type = 'INV' AND d.payment_status = 'paid'
                   AND substr(COALESCE(d.paid_at, d.created_at), 1, 7) = ?1) AS paid_cents
         FROM customers c WHERE c.company != 'Walk-in Customer'
         ORDER BY paid_cents DESC LIMIT 50`,
      ).bind(monthMY).all();
      clients = results.filter((r) => Number((r as { minutes: number }).minutes) > 0 || Number((r as { paid_cents: number }).paid_cents) > 0);
    } catch { /* pre-0056/0060 — card shows what it can */ }
    try {
      // Per host: session hours this month + TikTok GMV landing inside their
      // session windows (the /gmv attribution pattern; motivation, not payroll).
      const { results } = await env.DB.prepare(
        `SELECT u.id, COALESCE(NULLIF(TRIM(u.full_name), ''), u.name) AS name,
                COALESCE(SUM(CASE WHEN s.end_time IS NOT NULL
                    THEN (CAST(substr(s.end_time,1,2) AS INTEGER)*60 + CAST(substr(s.end_time,4,2) AS INTEGER))
                       - (CAST(substr(s.start_time,1,2) AS INTEGER)*60 + CAST(substr(s.start_time,4,2) AS INTEGER))
                    ELSE 0 END), 0) AS minutes,
                (SELECT COALESCE(SUM(p.order_amount_cents), 0) FROM postage_records p
                 /* v1.25.2 (caught by tests/sql-schema-check.mjs before it
                    ever reached live): the column is order_ref — postage_records
                    has no tracking_ref. TikTok orders are identified by the
                    'TT-' order_ref prefix everywhere else in the worker, so
                    this per-host GMV figure was silently failing its whole
                    try-block and reporting zero for every host. */
                 WHERE p.order_ref LIKE 'TT-%' AND COALESCE(p.status, '') != 'returned'
                   AND EXISTS (SELECT 1 FROM live_sessions s2
                        WHERE s2.host_user_id = u.id AND s2.status != 'cancelled' AND s2.end_time IS NOT NULL
                          AND substr(s2.session_date, 1, 7) = ?1
                          AND substr(datetime(p.created_at, '+8 hours'), 1, 10) = s2.session_date
                          AND substr(datetime(p.created_at, '+8 hours'), 12, 5) BETWEEN s2.start_time AND s2.end_time)) AS gmv_cents
         FROM live_sessions s JOIN users u ON u.id = s.host_user_id
         WHERE s.status != 'cancelled' AND substr(s.session_date, 1, 7) = ?1
         GROUP BY u.id ORDER BY minutes DESC LIMIT 20`,
      ).bind(monthMY).all();
      hosts = results;
    } catch { /* pre-0056 */ }
    return json({ month: monthMY, clients, hosts });
  }

  // Idea 3: the public package rate card — ONE system_meta row, edited from
  // the portal, served unauthenticated by index.ts. The public page renders
  // only when real tiers exist (house rule: never display zero stats).
  if (path === "/sales/packages" && method === "GET") {
    if (!can(user.role, "revenue_view")) return err("forbidden", "Sales access required", 403);
    const row = await env.DB.prepare(`SELECT value FROM system_meta WHERE key = 'packages_json'`).first<{ value: string }>();
    return json({ packages: row ? JSON.parse(row.value) : null });
  }
  if (path === "/sales/packages" && method === "POST") {
    if (!["ceo", "super_admin"].includes(user.role)) return err("forbidden", "CEO only", 403);
    const raw = Array.isArray(body?.packages) ? body.packages : [];
    const tiers = raw.slice(0, 6).map((t: { name?: unknown; price_label?: unknown; points?: unknown }) => ({
      name: String(t?.name ?? "").trim().slice(0, 60),
      price_label: String(t?.price_label ?? "").trim().slice(0, 60),
      points: (Array.isArray(t?.points) ? t.points : []).map((p: unknown) => String(p).trim().slice(0, 120)).filter(Boolean).slice(0, 8),
    })).filter((t: { name: string }) => t.name);
    await env.DB.prepare(
      `INSERT INTO system_meta (key, value) VALUES ('packages_json', ?1)
       ON CONFLICT(key) DO UPDATE SET value = ?1`,
    ).bind(JSON.stringify(tiers)).run();
    await audit(env, user.id, "sales.packages_update", "system_meta", "packages_json", { tiers: tiers.length });
    return json({ ok: true, packages: tiers });
  }

  if (path === "/customers" && (method === "GET" || method === "POST")) {
    if (method === "GET" ? !can(user.role, "sales") && !can(user.role, "exec_view") : !can(user.role, "sales")) {
      return err("forbidden", "Sales access required", 403);
    }
    if (method === "GET") {
      const { results } = await env.DB.prepare(
        `SELECT * FROM customers WHERE company != 'Walk-in Customer' ORDER BY company LIMIT 300`,
      ).all();
      return json({ customers: results });
    }
    if (!body || !str(body.company, 200)) return err("invalid_input", "company is required", 400);
    /* v1.30.0 — website travels with the customer from the first save; the
       logo is uploaded afterwards (POST /customers/:id/logo) because it
       needs the row's id for its object key. Pre-0074 databases have no
       website column, so fall back to the old shape rather than 500. */
    const website = str(body.website, 300) ? (body.website as string).trim() : null;
    let res: { id: number } | null = null;
    try {
      res = await env.DB.prepare(
        `INSERT INTO customers (company, contact_person, phone, email, address, notes, website, created_by)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8) RETURNING id`,
      ).bind(
        body.company,
        str(body.contact_person, 120) ? body.contact_person : null,
        str(body.phone, 40) ? body.phone : null,
        str(body.email, 200) ? body.email : null,
        str(body.address, 500) ? body.address : null,
        str(body.notes, 2000) ? body.notes : null,
        website,
        user.id,
      ).first<{ id: number }>();
    } catch {
      res = await env.DB.prepare(
        `INSERT INTO customers (company, contact_person, phone, email, address, notes, created_by)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) RETURNING id`,
      ).bind(
        body.company,
        str(body.contact_person, 120) ? body.contact_person : null,
        str(body.phone, 40) ? body.phone : null,
        str(body.email, 200) ? body.email : null,
        str(body.address, 500) ? body.address : null,
        str(body.notes, 2000) ? body.notes : null,
        user.id,
      ).first<{ id: number }>();
    }
    await audit(env, user.id, "customer.create", "customers", String(res?.id));
    return json({ id: res?.id }, 201);
  }
  const custMatch = path.match(/^\/customers\/(\d+)$/);
  if (custMatch && method === "PUT") {
    if (!can(user.role, "sales")) return err("forbidden", "Sales access required", 403);
    /* v1.4.235: sending "" clears a field (→ NULL) — before, a field could
       never be emptied once set. company itself can't be cleared. */
    /* v1.30.0: website joins the editable set. logo_key is deliberately NOT
       here — a logo is set by uploading bytes, not by typing a key, so
       nobody can point a customer row at someone else's object. */
    const fields = ["company", "contact_person", "phone", "email", "address", "notes", "website"] as const;
    const sets: string[] = [];
    const vals: (string | null)[] = [];
    for (const f of fields) {
      const v = body?.[f];
      if (v === undefined) continue;
      if (v === "" || v === null) {
        if (f === "company") return err("invalid_input", "Company name cannot be empty", 400);
        sets.push(`${f} = ?${sets.length + 1}`); vals.push(null);
      } else if (str(v, 2000)) {
        sets.push(`${f} = ?${sets.length + 1}`); vals.push(v as string);
      }
    }
    if (sets.length === 0) return err("invalid_input", "Nothing to update", 400);
    await env.DB.prepare(`UPDATE customers SET ${sets.join(", ")} WHERE id = ?${sets.length + 1}`)
      .bind(...vals, custMatch[1]!).run();
    await audit(env, user.id, "customer.update", "customers", custMatch[1]!);
    return json({ ok: true });
  }
  /* v1.30.0 — the client's own mark. Same shape as the staff-photo upload
     (raw image body, type-checked, straight into R2, key on the row), with
     one difference: this object must be readable WITHOUT a staff session.
     The client sees it in their own area (role "customer", which the media
     guard refuses for every non-public prefix) and it may ride along on a
     report they forward to their boss. So it goes under uploads/ — the one
     prefix the media guard already treats as public (v1.5.0 policy) —
     rather than inventing a new public prefix and editing that guard.
     Nothing sensitive lives in a company logo. */
  const custLogo = path.match(/^\/customers\/(\d+)\/logo$/);
  if (custLogo && method === "POST") {
    if (!can(user.role, "sales")) return err("forbidden", "Sales access required", 403);
    const id = custLogo[1]!;
    const target = await env.DB.prepare(`SELECT id FROM customers WHERE id = ?1`).bind(id).first<{ id: number }>();
    if (!target) return err("not_found", "Customer not found", 404);
    if (!request.body) return err("invalid_input", "Image body required", 400);
    const ct = request.headers.get("Content-Type") ?? "";
    if (!["image/jpeg", "image/png", "image/webp", "image/svg+xml"].includes(ct)) {
      return err("invalid_input", "Only JPEG/PNG/WEBP/SVG images are allowed", 400);
    }
    const ext = ct.includes("png") ? "png" : ct.includes("webp") ? "webp" : ct.includes("svg") ? "svg" : "jpg";
    const key = `uploads/client-logos/${id}-${Date.now()}.${ext}`;
    await env.MEDIA.put(key, request.body, { httpMetadata: { contentType: ct } });
    try {
      await env.DB.prepare(`UPDATE customers SET logo_key = ?1 WHERE id = ?2`).bind(key, id).run();
    } catch {
      return err("not_ready", "Run DEPLOY.bat in full — migration 0074 adds the client logo column", 409);
    }
    await audit(env, user.id, "customer.logo", "customers", id);
    return json({ logo_key: key, url: `/api/v1/media/file/${encodeURIComponent(key)}` }, 201);
  }

  if (custMatch && method === "DELETE") {
    /* v1.4.235 (CEO: "delete if require"): a customer with documents is
       NEVER deleted — quotations/invoices must keep their party for
       records; the message tells him what blocks it. */
    if (!can(user.role, "sales")) return err("forbidden", "Sales access required", 403);
    const refs = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM sales_documents WHERE customer_id = ?1`,
    ).bind(custMatch[1]!).first<{ n: number }>();
    if ((refs?.n ?? 0) > 0) {
      return err("invalid_input", `This customer has ${refs!.n} document${refs!.n === 1 ? "" : "s"} (quotation/invoice/DO) — records must keep their customer. Edit the details instead.`, 409);
    }
    const gone = await env.DB.prepare(`SELECT company FROM customers WHERE id = ?1`).bind(custMatch[1]!).first<{ company: string }>();
    if (!gone) return err("not_found", "Customer not found", 404);
    await env.DB.prepare(`DELETE FROM customers WHERE id = ?1`).bind(custMatch[1]!).run();
    await audit(env, user.id, "customer.delete", "customers", custMatch[1]!, { company: gone.company });
    return json({ ok: true });
  }

  /* ---- sales documents (QT / DO / INV) ---- */

  if (path === "/docs" && method === "GET") {
    if (!can(user.role, "sales") && !can(user.role, "exec_view")) return err("forbidden", "Sales access required", 403);
    const url = new URL(request.url);
    const t = url.searchParams.get("type");
    // v1.5.0: bound parameter instead of string interpolation (defence in depth)
    const typed = t && ["QT", "DO", "INV"].includes(t) ? t : null;
    const stmt = env.DB.prepare(
      `SELECT d.*, c.company, c.phone AS customer_phone, sp.name AS salesperson_name FROM sales_documents d
       LEFT JOIN users sp ON sp.id = d.salesperson_id
       JOIN customers c ON c.id = d.customer_id ${typed ? "WHERE d.doc_type = ?1" : ""}
       ORDER BY d.created_at DESC LIMIT 200`,
    );
    const { results } = await (typed ? stmt.bind(typed) : stmt).all();
    return json({ docs: results });
  }
  /* v1.41.0 (CEO: "a list of the product with the prices auto filled and if
     there is any discount staff will insert the discount amount. SKU need to
     be filled for the products. This is only for Product"): a PRODUCT line's
     price is decided by the CATALOGUE, not by what the browser sent. The
     form picks from Inventory; the Worker re-resolves the SKU and overwrites
     name + unit price from the item record, so a tampered or stale payload
     cannot invoice below list — any reduction is an explicit, visible
     discount (per line or per document). Services stay free-text: agency
     work has no catalogue. Matching is the bridge's rule — case- and
     whitespace-insensitive, with an expression fallback for stale keys. */
  const resolveCatalogueLine = async (skuRaw: string): Promise<{ sku: string; name: string; unit_price_cents: number } | null> => {
    const key = skuKey(skuRaw);
    try {
      const hit = await env.DB.prepare(
        `SELECT sku, name, unit_price_cents FROM inventory_items
         WHERE sku_key = ?1 OR UPPER(REPLACE(sku, ' ', '')) = ?1 ORDER BY id LIMIT 1`,
      ).bind(key).first<{ sku: string; name: string; unit_price_cents: number }>();
      if (hit) return hit;
    } catch { /* pre-0079 — no sku_key column; the expression query below still works */ }
    try {
      return await env.DB.prepare(
        `SELECT sku, name, unit_price_cents FROM inventory_items
         WHERE UPPER(REPLACE(sku, ' ', '')) = ?1 ORDER BY id LIMIT 1`,
      ).bind(key).first<{ sku: string; name: string; unit_price_cents: number }>();
    } catch { return null; }
  };

  if (path === "/docs" && method === "POST") {
    if (!body || typeof body.doc_type !== "string" || !["QT", "DO", "INV"].includes(body.doc_type)) {
      return err("invalid_input", "doc_type must be QT, DO, or INV", 400);
    }
    const docType = body.doc_type as "QT" | "DO" | "INV";
    if (docType === "INV" ? !can(user.role, "finance") : !can(user.role, "sales")) {
      return err("forbidden", "Insufficient rights for this document type", 403);
    }
    /* v1.4.234 (CEO: two business lines — "details just filled by one
       details"): every document is for ONE line, product or service.
       Delivery Orders are product-only — a service delivers nothing
       physical, so a service DO is refused outright. */
    const kindD = typeof body.kind === "string" && ["product", "service"].includes(body.kind) ? body.kind : "product";
    if (docType === "DO" && kindD === "service") {
      return err("invalid_input", "A Delivery Order is for goods — services have nothing to physically deliver. Use a Quotation or Invoice for the service.", 400);
    }
    if (typeof body.customer_id !== "number" || !Array.isArray(body.items) || body.items.length === 0) {
      return err("invalid_input", "customer_id and items are required", 400);
    }
    // v1.4.91: walk-in buyer — customer_id 0 bills the shared "Walk-in
    // Customer" record (created once), so a payment can be invoiced even
    // when the buyer's identity isn't known.
    let customerId = body.customer_id as number;
    if (customerId === 0) {
      const existing = await env.DB.prepare(
        `SELECT id FROM customers WHERE company = 'Walk-in Customer'`,
      ).first<{ id: number }>();
      if (existing) customerId = existing.id;
      else {
        const created = await env.DB.prepare(
          `INSERT INTO customers (company, notes, created_by) VALUES ('Walk-in Customer', 'Shared record for unidentified buyers', ?1) RETURNING id`,
        ).bind(user.id).first<{ id: number }>();
        customerId = created?.id ?? 0;
      }
      if (!customerId) return err("server_error", "Could not prepare the walk-in customer record", 500);
    }
    /* v1.4.243 (CEO's Malaysian-standard document): a line may now carry a
       SKU, a unit of measure, its own discount and up to 10 detail lines —
       the inclusions that used to be typed as separate RM 0.00 rows. All
       optional; a line without them is exactly the old shape, so every
       existing document still parses. */
    const lineExtras = (i: Record<string, unknown>, qty: number, unit: number) => {
      const o: { sku?: string; uom?: string; disc_cents?: number; sub?: string[] } = {};
      if (str(i.sku, 60)) o.sku = String(i.sku).slice(0, 60);
      if (str(i.uom, 12)) o.uom = String(i.uom).slice(0, 12).toUpperCase();
      if (typeof i.disc_cents === "number" && i.disc_cents > 0) {
        o.disc_cents = Math.min(Math.round(i.disc_cents), qty * unit); // never below zero
      }
      if (Array.isArray(i.sub)) {
        const s = (i.sub as unknown[]).filter((x) => str(x, 160)).slice(0, 10).map((x) => String(x).slice(0, 160));
        if (s.length) o.sub = s;
      }
      return o;
    };
    const items = (body.items as Record<string, unknown>[])
      .filter((i) => str(i.name, 200) && typeof i.qty === "number" && i.qty > 0 && typeof i.unit_price_cents === "number" && i.unit_price_cents >= 0)
      .map((i) => ({
        name: i.name as string, qty: i.qty as number, unit_price_cents: i.unit_price_cents as number,
        ...lineExtras(i, i.qty as number, i.unit_price_cents as number),
      }));
    if (items.length === 0) return err("invalid_input", "Each item needs name, qty, unit_price_cents", 400);

    /* v1.41.0: product lines are catalogue lines. SKU required, item must
       exist, price must be set — and then the CATALOGUE price and name
       replace whatever the client sent. Every stop names its line. */
    if (kindD === "product") {
      for (let li = 0; li < items.length; li++) {
        const line = items[li]!;
        if (!line.sku) {
          return err("invalid_input", `Line ${li + 1} ("${line.name.slice(0, 40)}") has no SKU — pick the product from the list`, 400);
        }
        const cat = await resolveCatalogueLine(line.sku);
        if (!cat) {
          return err("invalid_input", `Line ${li + 1}: no inventory item matches SKU "${line.sku}" — pick from the list, or add the item on the Inventory tab first`, 400);
        }
        if (!(cat.unit_price_cents > 0)) {
          return err("invalid_input", `${cat.sku} has no price set — set its price/unit on the Inventory tab first`, 400);
        }
        line.sku = cat.sku;
        line.name = cat.name;
        line.unit_price_cents = cat.unit_price_cents;
        // the discount cap was computed against the client's price — re-cap
        // against the authoritative one
        if (line.disc_cents) line.disc_cents = Math.min(line.disc_cents, line.qty * line.unit_price_cents);
      }
    }

    // Line discounts come off before the document-level discount.
    const subtotal = items.reduce((s, i) => s + i.qty * i.unit_price_cents - (i.disc_cents ?? 0), 0);
    const discount = typeof body.discount_cents === "number" && body.discount_cents >= 0 ? body.discount_cents : 0;
    const taxPct = typeof body.tax_percent === "number" && body.tax_percent >= 0 ? body.tax_percent : 0;
    // v1.4.160: delivery / postage fee — quoted on the QT, billed on the INV,
    // never on a DO (Malaysian standard: the DO carries goods only, no
    // charges). Added AFTER discount + tax: delivery is a pass-through
    // charge, not part of the taxable goods value.
    /* v1.4.238 (CEO conflict check: "for Service, there is no Delivery /
       postage right?"): correct — a service ships nothing, so delivery is
       forced 0 on service documents BEFORE the total computes. */
    const deliveryFee = docType !== "DO" && kindD !== "service" && typeof body.delivery_cents === "number" && body.delivery_cents >= 0
      ? Math.round(body.delivery_cents) : 0;
    const total = Math.max(0, Math.round((subtotal - discount) * (1 + taxPct / 100))) + deliveryFee;

    const number = await docNumber(env, docType);
    // v1.4.93: salesperson — any staff member; defaults to whoever created it.
    const salespersonId = typeof body.salesperson_id === "number" && body.salesperson_id > 0
      ? Math.round(body.salesperson_id) : user.id;
    // v1.4.94: backdating — payments received before this system existed can
    // be invoiced on their true date. Past dates only, never the future.
    const todayMyt = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
    const docDate = typeof body.doc_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.doc_date) && body.doc_date <= todayMyt
      ? body.doc_date : null;
    // v1.4.243: buyer's own PO reference + ship-to address (migration 0062).
    const referenceD = str(body.reference, 60) ? String(body.reference).slice(0, 60) : null;
    const shipToD = docType !== "DO" && kindD === "service" ? null
      : (str(body.delivery_address, 300) ? String(body.delivery_address).slice(0, 300) : null);
    let res: { id: number } | null = null;
    const insertCols = (extra: boolean) => `INSERT INTO sales_documents
         (doc_type, doc_number, customer_id, items, discount_cents, tax_percent, delivery_cents, total_cents,
          notes, valid_until, delivery_status, payment_status, due_date, salesperson_id, created_by, created_at, kind${extra ? ", reference, delivery_address" : ""})
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, COALESCE(?16, datetime('now')), ?17${extra ? ", ?18, ?19" : ""}) RETURNING id`;
    const insertArgs = [
        docType, number, customerId, JSON.stringify(items), discount, taxPct, deliveryFee, total,
        str(body.notes, 2000) ? body.notes : null,
        docType === "QT" && str(body.valid_until, 10) ? body.valid_until : null,
        docType === "DO" ? "pending" : null,
        docType === "INV" ? "unpaid" : null,
        docType === "INV" && str(body.due_date, 10) ? body.due_date : null,
        salespersonId,
        user.id,
        docDate ? `${docDate} 00:00:00` : null,
        kindD, // v1.4.234
    ];
    try {
      res = await env.DB.prepare(insertCols(true))
        .bind(...insertArgs, referenceD, shipToD).first<{ id: number }>();
    } catch (e) {
      /* v1.4.218 lesson — never let an OPTIONAL column take down a critical
         write: on a database that has not had 0062 applied yet the document
         is still created, just without its reference / ship-to. */
      if (String(e).includes("no such column")) {
        try {
          res = await env.DB.prepare(insertCols(false)).bind(...insertArgs).first<{ id: number }>();
          await logError(env, "migration_skew", "sales_documents missing 0062 columns (reference/delivery_address)");
        } catch (e2) {
          if (String(e2).includes("no such column")) {
            return err("migration_missing", "Run: npx wrangler d1 migrations apply azoneofficial --remote", 500);
          }
          throw e2;
        }
      } else throw e;
    }
    /* v1.30.1 — the operator's entity choice, decided AT CREATION and never
       editable after (a document forever shows the entity that issued it).
       Anything that is not exactly "azoo" falls to the A2Z default, so a
       stale client or a typo can never mint a third entity. */
    const issuerD: "a2z" | "azoo" = body.issuer === "azoo" ? "azoo" : "a2z";
    await stampIssuer(env, "sales_documents", res?.id, issuerD);
    // v1.4.91: payment already in hand — the invoice is born paid (bank
    // transfer) and counts in revenue immediately.
    if (docType === "INV" && body.paid_received === true && res?.id) {
      const payDate = typeof body.paid_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.paid_date) && body.paid_date <= todayMyt
        ? `${body.paid_date} 00:00:00` : (docDate ? `${docDate} 00:00:00` : null);
      await env.DB.prepare(
        `UPDATE sales_documents SET payment_status = 'paid', payment_method = 'bank_transfer',
         payment_ref = ?1, paid_at = COALESCE(?2, datetime('now')) WHERE id = ?3`,
      ).bind(typeof body.payment_ref === "string" ? body.payment_ref.slice(0, 120) : null, payDate, res.id).run();
      // v1.21.0: a born-paid invoice books its money-in the same way the
      // mark-paid route does — one ref (INV-<id>), one row, one journal entry.
      await recordBankMovement(env, user.id, `INV-${res.id}`, total, "sales", `Invoice ${number} paid`, "in");
    }
    // v1.4.263: a product invoice moves stock the moment it exists.
    let stockMove: Awaited<ReturnType<typeof deductForInvoice>> | null = null;
    if (docType === "INV" && kindD !== "service" && res?.id) {
      stockMove = await deductForInvoice(env, res.id, number, JSON.stringify(items), docDate, user.id);
    }
    await audit(env, user.id, `doc.create_${docType.toLowerCase()}`, "sales_documents", String(res?.id));
    return json({ id: res?.id, doc_number: number, total_cents: total, stock: stockMove }, 201);
  }
  const docGet = path.match(/^\/docs\/(\d+)$/);
  if (docGet && method === "GET") {
    if (!can(user.role, "sales")) return err("forbidden", "Sales access required", 403);
    /* v1.4.243: the customer's default ship-to rides along so the printed
       document can fall back to it when the document itself carries none.
       Wrapped for 0062 skew (v1.4.218 lesson) — a pre-0062 database must
       still be able to print. */
    const docSelect = (extra: boolean) =>
      `SELECT d.*, c.company, c.contact_person, c.email AS customer_email, c.phone AS customer_phone, c.address,
              ${extra ? "c.delivery_address AS customer_delivery_address," : ""}
              sp.name AS salesperson_name, cb.role AS created_by_role
       FROM sales_documents d JOIN customers c ON c.id = d.customer_id
       LEFT JOIN users sp ON sp.id = d.salesperson_id
       LEFT JOIN users cb ON cb.id = d.created_by WHERE d.id = ?1`;
    let d: Record<string, unknown> | null;
    try {
      d = await env.DB.prepare(docSelect(true)).bind(docGet[1]).first<Record<string, unknown>>();
    } catch (e) {
      if (!String(e).includes("no such column")) throw e;
      d = await env.DB.prepare(docSelect(false)).bind(docGet[1]).first<Record<string, unknown>>();
    }
    if (!d) return err("not_found", "Document not found", 404);
    /* v1.4.233 signer rule (CEO): a document prepared by the CEO, COO or
       CCO carries THAT officer's uploaded signature. Prepared by anyone
       else (hr_admin, sales_marketing, …) → the "Prepared by" block shows
       the PREPARER's own name and position with a BLANK line — they sign
       in ink themselves; no officer's signature is borrowed.
       Exception: an INVOICE's block is "Authorised signature" — an
       authorisation act, so a non-officer preparer's invoice still carries
       the CEO's signature (raising invoices already needs finance rights). */
    const MGMT_SIGNERS = ["ceo", "coo", "cco"];
    const roleOfCreator = String(d.created_by_role ?? "");
    let signRole: string | null;
    if (MGMT_SIGNERS.includes(roleOfCreator)) signRole = roleOfCreator;
    else signRole = d.doc_type === "INV" ? "ceo" : null; // null = manual ink signature
    let signer: { signer_name: string; position: string | null } | null;
    if (signRole) {
      signer = await env.DB.prepare(
        `SELECT COALESCE(full_name, name) AS signer_name, position FROM users
         WHERE role = ?1 AND is_active = 1 ORDER BY id LIMIT 1`,
      ).bind(signRole).first<{ signer_name: string; position: string | null }>();
    } else {
      signer = await env.DB.prepare(
        `SELECT COALESCE(full_name, name) AS signer_name, position FROM users WHERE id = ?1`,
      ).bind(d.created_by as number).first<{ signer_name: string; position: string | null }>();
    }
    /* v1.28.0: when no signer row exists the "prepared by" line falls back to
       the document's ISSUING company — resolved from the row's issuer_code
       exactly like the frontend's resolveIssuer (lib/issuers.ts is the naming
       source; the Worker cannot import the frontend lib, so the two legal
       names are inlined): NULL/legacy = AZ ONE OFFICIAL, 'a2z' = A2Z. */
    const fallbackSigner = (d as { issuer_code?: string | null }).issuer_code === "a2z"
      ? "A2Z CREATIVE MARKETING" : "AZ ONE OFFICIAL";
    return json({ doc: {
      ...d,
      signer_role: signRole,
      signer_name: signer?.signer_name ?? fallbackSigner,
      signer_position: signer?.position ?? (signRole === "coo" ? "Chief Operating Officer" : signRole === "cco" ? "Chief Commercial Officer" : signRole === "ceo" ? "Chief Executive Officer" : ""),
    } });
  }

  const docMatch = path.match(/^\/docs\/(\d+)$/);
  if (docMatch && method === "PATCH") {
    const id = docMatch[1]!;
    const doc = await env.DB.prepare(`SELECT doc_type, doc_number, total_cents FROM sales_documents WHERE id = ?1`)
      .bind(id).first<{ doc_type: string; doc_number: string; total_cents: number }>();
    if (!doc) return err("not_found", "Document not found", 404);
    if (doc.doc_type === "INV") {
      if (!can(user.role, "finance")) return err("forbidden", "Finance access required", 403);
      const ok = typeof body?.payment_status === "string" && ["unpaid", "paid", "overdue"].includes(body.payment_status);
      if (!ok) return err("invalid_input", "payment_status must be unpaid|paid|overdue", 400);
      // v1.4.90: paid = payment received — record method (bank transfer),
      // optional reference, and the moment. Revenue counts from paid_at.
      if (body!.payment_status === "paid") {
        const methods = ["bank_transfer", "cash", "cheque", "other"];
        const methodP = typeof body!.payment_method === "string" && methods.includes(body!.payment_method)
          ? (body!.payment_method as string) : "bank_transfer";
        const refP = typeof body!.payment_ref === "string" ? body!.payment_ref.slice(0, 120) : null;
        /* v1.4.250 (CEO: "a calendar for me to pick which date they make the
           payment for accurate tracking"): the day the money actually landed,
           not the moment the box was ticked. Revenue buckets invoices by
           paid_at (+8 hours), so it is stored at 04:00 UTC = midday MYT —
           that way the shift can never move it onto the neighbouring day.
           An explicit date OVERRIDES an earlier one; without it the old
           COALESCE-to-now behaviour stands, so nothing existing changes.
           Future dates are refused: you cannot receive tomorrow's money. */
        const rawOn = typeof body!.paid_on === "string" ? body!.paid_on : "";
        const todayMyt = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
        const paidOn = /^\d{4}-\d{2}-\d{2}$/.test(rawOn) && rawOn <= todayMyt ? rawOn : null;
        if (rawOn && !paidOn) return err("invalid_input", "Payment date must be a real date, today or earlier", 400);
        if (paidOn) {
          await env.DB.prepare(
            `UPDATE sales_documents SET payment_status = 'paid', payment_method = ?1, payment_ref = ?2,
             paid_at = ?3 WHERE id = ?4`,
          ).bind(methodP, refP, `${paidOn} 04:00:00`, id).run();
        } else {
          await env.DB.prepare(
            `UPDATE sales_documents SET payment_status = 'paid', payment_method = ?1, payment_ref = ?2,
             paid_at = COALESCE(paid_at, datetime('now')) WHERE id = ?3`,
          ).bind(methodP, refP, id).run();
        }
        /* v1.21.0 (CEO: "cash flow should sync with Finance — semi
           automation instead of manually logged"): a PAID invoice IS money
           in the bank, so it writes its own money-in row + journal entry.
           Ref INV-<id> — unmark/remark can never double-book. */
        await recordBankMovement(env, user.id, `INV-${id}`, doc.total_cents ?? 0,
          "sales", `Invoice ${doc.doc_number} paid`, "in");
      } else {
        await env.DB.prepare(
          `UPDATE sales_documents SET payment_status = ?1, payment_method = NULL, payment_ref = NULL, paid_at = NULL WHERE id = ?2`,
        ).bind(body!.payment_status, id).run();
      }
    } else if (doc.doc_type === "DO") {
      if (!can(user.role, "sales")) return err("forbidden", "Sales access required", 403);
      const ok = typeof body?.delivery_status === "string" && ["pending", "delivered"].includes(body.delivery_status);
      if (!ok) return err("invalid_input", "delivery_status must be pending|delivered", 400);
      await env.DB.prepare(`UPDATE sales_documents SET delivery_status = ?1 WHERE id = ?2`)
        .bind(body!.delivery_status, id).run();
    } else {
      return err("invalid_input", "Quotations have no status updates yet", 400);
    }
    await audit(env, user.id, "doc.update_status", "sales_documents", id);
    return json({ ok: true });
  }
  const docConv = path.match(/^\/docs\/(\d+)\/convert$/);
  if (docConv && method === "POST") {
    // v1.4.101: one-click Quotation → Invoice — accepted quotes are never
    // retyped. Same items/customer/salesperson, fresh INV number, audited.
    if (!can(user.role, "finance")) return err("forbidden", "Finance access required to raise invoices", 403);
    const qt = await env.DB.prepare(
      `SELECT * FROM sales_documents WHERE id = ?1 AND doc_type = 'QT'`,
    ).bind(docConv[1]).first<Record<string, unknown>>();
    if (!qt) return err("not_found", "Quotation not found", 404);
    const numberC = await docNumber(env, "INV");
    const resC = await env.DB.prepare(
      `INSERT INTO sales_documents
       (doc_type, doc_number, customer_id, items, discount_cents, tax_percent, delivery_cents, total_cents,
        notes, payment_status, salesperson_id, created_by, converted_from, kind)
       VALUES ('INV', ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'unpaid', ?9, ?10, ?11, ?12) RETURNING id`,
    ).bind(
      numberC, qt.customer_id, qt.items, qt.discount_cents ?? 0, qt.tax_percent ?? 0,
      (qt as { delivery_cents?: number }).delivery_cents ?? 0, qt.total_cents ?? 0,
      qt.notes ?? null, qt.salesperson_id ?? user.id, user.id, qt.id,
      (qt as { kind?: string | null }).kind ?? "product", // v1.4.234: the invoice inherits the quotation's line
    ).first<{ id: number }>();
    // v1.4.263: the invoice born from a quotation deducts stock too — the QT
    // itself never moved any, so this is the sale's single deduction.
    let stockMoveC: Awaited<ReturnType<typeof deductForInvoice>> | null = null;
    if (((qt as { kind?: string | null }).kind ?? "product") !== "service" && resC?.id) {
      stockMoveC = await deductForInvoice(env, resC.id, numberC, String(qt.items ?? "[]"), null, user.id);
    }
    /* v1.30.1 — the invoice INHERITS the quotation's entity. A client who
       accepted an AZ ONE consultancy quotation must not receive an A2Z
       invoice pointing at a different company's bank account. Legacy
       quotations (NULL, pre-v1.28) keep converting to A2Z invoices — the
       v1.28.0 "A2Z invoices" decision, unchanged. */
    const qtIssuer = (qt as { issuer_code?: string | null }).issuer_code;
    await stampIssuer(env, "sales_documents", resC?.id, qtIssuer === "azoo" ? "azoo" : "a2z");
    await audit(env, user.id, "doc.convert_qt_inv", "sales_documents", String(resC?.id), { from: qt.doc_number });
    return json({ id: resC?.id, doc_number: numberC, stock: stockMoveC }, 201);
  }

  /* v1.4.233 (CEO: "reversal button for the Quotation if accidentally click
     invoice"): undo a conversion — allowed ONLY while the invoice is still
     an untouched result of the click: doc_type INV, carries converted_from,
     and payment_status is 'unpaid'. The invoice row is deleted (audited
     with its number); the quotation was never modified by the conversion,
     so it simply stands as before. A paid invoice can never be reversed. */
  const docUnconv = path.match(/^\/docs\/(\d+)\/unconvert$/);
  if (docUnconv && method === "POST") {
    if (!can(user.role, "finance")) return err("forbidden", "Finance access required", 403);
    const inv = await env.DB.prepare(
      `SELECT id, doc_type, doc_number, payment_status, converted_from FROM sales_documents WHERE id = ?1`,
    ).bind(docUnconv[1]).first<{ id: number; doc_type: string; doc_number: string; payment_status: string | null; converted_from: number | null }>();
    if (!inv || inv.doc_type !== "INV") return err("not_found", "Invoice not found", 404);
    if (!inv.converted_from) return err("invalid_input", "This invoice was not created from a quotation", 400);
    if (inv.payment_status === "paid") return err("invalid_input", "A PAID invoice cannot be reversed — unmark the payment first if this is truly a mistake", 400);
    const restoredU = await restoreForInvoice(env, inv.id, inv.doc_number); // v1.4.263
    await env.DB.prepare(`DELETE FROM sales_documents WHERE id = ?1`).bind(inv.id).run();
    await audit(env, user.id, "doc.unconvert", "sales_documents", String(inv.id), { doc_number: inv.doc_number, back_to_qt: inv.converted_from, stock_restored_rows: restoredU });
    return json({ ok: true });
  }

  /* v1.4.237 (CEO: delete a document so the aging card follows, with a
     confirm first): general document delete. ONE guard — a PAID invoice is
     an accounting record and cannot be deleted; unmark the payment first
     if it is truly a mistake. Unpaid INV / QT / DO delete freely; the
     aging card recomputes from the list, so a deleted unpaid invoice
     disappears from it immediately. Audited with the document number. */
  const docDel = path.match(/^\/docs\/(\d+)$/);
  if (docDel && method === "DELETE") {
    if (!can(user.role, "finance")) return err("forbidden", "Finance access required", 403);
    const dd = await env.DB.prepare(
      `SELECT id, doc_type, doc_number, payment_status FROM sales_documents WHERE id = ?1`,
    ).bind(docDel[1]).first<{ id: number; doc_type: string; doc_number: string; payment_status: string | null }>();
    if (!dd) return err("not_found", "Document not found", 404);
    if (dd.doc_type === "INV" && dd.payment_status === "paid") {
      return err("invalid_input", "A PAID invoice is an accounting record and cannot be deleted — unmark the payment first if this is truly a mistake", 400);
    }
    const restoredD = dd.doc_type === "INV" ? await restoreForInvoice(env, dd.id, dd.doc_number) : 0; // v1.4.263
    await env.DB.prepare(`DELETE FROM sales_documents WHERE id = ?1`).bind(dd.id).run();
    await audit(env, user.id, "doc.delete", "sales_documents", String(dd.id), { doc_number: dd.doc_number, doc_type: dd.doc_type, stock_restored_rows: restoredD });
    return json({ ok: true });
  }
  /* v1.4.244 (CEO: "if I click on PDF button I want the format can be deliver
     to my customer using mobile instead of I need to download"): minting a
     share token turns the document into a link the customer can open on any
     phone — no sign-in, no download, no app. Sending the link is one tap in
     the phone's own share sheet, which is where WhatsApp lives.
     Body {revoke:true} clears the token and the link dies immediately. */
  const docShare = path.match(/^\/docs\/(\d+)\/share$/);
  if (docShare && method === "POST") {
    const idS = docShare[1]!;
    const dS = await env.DB.prepare(`SELECT doc_type FROM sales_documents WHERE id = ?1`)
      .bind(idS).first<{ doc_type: string }>();
    if (!dS) return err("not_found", "Document not found", 404);
    if (dS.doc_type === "INV" ? !can(user.role, "finance") : !can(user.role, "sales")) {
      return err("forbidden", "Insufficient rights for this document type", 403);
    }
    /* v1.29.0: new share links are minted on the primary (new) domain; links
       already sent keep working because the old domain stays routed. */
    const origin = primaryOrigin(env);
    try {
      if (body && body.revoke === true) {
        await env.DB.prepare(`UPDATE sales_documents SET share_token = NULL WHERE id = ?1`).bind(idS).run();
        await audit(env, user.id, "doc.share_revoke", "sales_documents", idS);
        return json({ ok: true, token: null, url: null });
      }
      const existing = await env.DB.prepare(`SELECT share_token FROM sales_documents WHERE id = ?1`)
        .bind(idS).first<{ share_token: string | null }>();
      let token = existing?.share_token ?? null;
      if (!token) {
        // 32 hex characters — unguessable, and short enough to sit in a URL.
        token = Array.from(crypto.getRandomValues(new Uint8Array(16)))
          .map((b) => b.toString(16).padStart(2, "0")).join("");
        await env.DB.prepare(`UPDATE sales_documents SET share_token = ?1 WHERE id = ?2`).bind(token, idS).run();
        await audit(env, user.id, "doc.share", "sales_documents", idS);
      }
      return json({ ok: true, token, url: `${origin}/doc?t=${token}` });
    } catch (e) {
      if (String(e).includes("no such column")) {
        return err("migration_missing", "Run: npx wrangler d1 migrations apply azoneofficial --remote (0063_doc_share_token)", 500);
      }
      throw e;
    }
  }

  const docEdit = path.match(/^\/docs\/(\d+)\/edit$/);
  if (docEdit && method === "POST") {
    // v1.4.94: fix typos on an existing document — items, amounts, customer,
    // salesperson, date. The document NUMBER never changes; totals recompute;
    // audited. Invoice edits need finance rights, like invoice creation.
    const idE = docEdit[1]!;
    let docE: { doc_type: string; kind?: string | null } | null;
    try {
      docE = await env.DB.prepare(`SELECT doc_type, kind FROM sales_documents WHERE id = ?1`)
        .bind(idE).first<{ doc_type: string; kind?: string | null }>();
    } catch {
      // v1.4.238 migration-skew armor (v1.4.218 lesson): pre-0061 DB has no
      // kind column — editing must keep working; kind treated as absent.
      docE = await env.DB.prepare(`SELECT doc_type FROM sales_documents WHERE id = ?1`)
        .bind(idE).first<{ doc_type: string }>();
    }
    if (!docE) return err("not_found", "Document not found", 404);
    if (docE.doc_type === "INV" ? !can(user.role, "finance") : !can(user.role, "sales")) {
      return err("forbidden", "Insufficient rights to edit this document type", 403);
    }
    if (!body || !Array.isArray(body.items) || body.items.length === 0) {
      return err("invalid_input", "items are required", 400);
    }
    const extrasE = (i: Record<string, unknown>, qty: number, unit: number) => {
      const o: { sku?: string; uom?: string; disc_cents?: number; sub?: string[] } = {};
      if (str(i.sku, 60)) o.sku = String(i.sku).slice(0, 60);
      if (str(i.uom, 12)) o.uom = String(i.uom).slice(0, 12).toUpperCase();
      if (typeof i.disc_cents === "number" && i.disc_cents > 0) o.disc_cents = Math.min(Math.round(i.disc_cents), qty * unit);
      if (Array.isArray(i.sub)) {
        const s = (i.sub as unknown[]).filter((x) => str(x, 160)).slice(0, 10).map((x) => String(x).slice(0, 160));
        if (s.length) o.sub = s;
      }
      return o;
    };
    const itemsE = (body.items as Record<string, unknown>[])
      .filter((i) => str(i.name, 200) && typeof i.qty === "number" && i.qty > 0 && typeof i.unit_price_cents === "number" && i.unit_price_cents >= 0)
      .map((i) => ({
        name: i.name as string, qty: i.qty as number, unit_price_cents: i.unit_price_cents as number,
        ...extrasE(i, i.qty as number, i.unit_price_cents as number),
      }));
    if (itemsE.length === 0) return err("invalid_input", "Each item needs name, qty, unit_price_cents", 400);
    /* v1.41.0: an EDIT cannot become the bypass around catalogue pricing —
       any product line carrying a SKU is re-resolved and re-priced from
       Inventory, so tampering with the price in an edit quietly reverts.
       Lines WITHOUT a SKU are legacy (pre-v1.41 documents) and pass
       unchanged; every new product document is born all-SKU, so its prices
       stay catalogue-locked through every later edit. */
    if (docE.kind === "product") {
      for (let li = 0; li < itemsE.length; li++) {
        const line = itemsE[li]!;
        if (!line.sku) continue;
        const cat = await resolveCatalogueLine(line.sku);
        if (!cat) {
          return err("invalid_input", `Line ${li + 1}: no inventory item matches SKU "${line.sku}" — pick from the list, or fix the SKU on the Inventory tab`, 400);
        }
        line.sku = cat.sku;
        line.name = cat.name;
        if (cat.unit_price_cents > 0) line.unit_price_cents = cat.unit_price_cents;
        if (line.disc_cents) line.disc_cents = Math.min(line.disc_cents, line.qty * line.unit_price_cents);
      }
    }
    const subE = itemsE.reduce((a, i) => a + i.qty * i.unit_price_cents - (i.disc_cents ?? 0), 0);
    const discE = typeof body.discount_cents === "number" && body.discount_cents >= 0 ? body.discount_cents : 0;
    const taxE = typeof body.tax_percent === "number" && body.tax_percent >= 0 ? body.tax_percent : 0;
    // v1.4.160: delivery fee editable like the rest; never on a DO.
    // v1.4.238: a service document can't gain delivery through an edit either.
    const delE = docE.doc_type !== "DO" && docE.kind !== "service" && typeof body.delivery_cents === "number" && body.delivery_cents >= 0
      ? Math.round(body.delivery_cents) : 0;
    const totalE = Math.max(0, Math.round((subE - discE) * (1 + taxE / 100))) + delE;
    let custE: number | null = typeof body.customer_id === "number" && body.customer_id > 0 ? body.customer_id : null;
    if (body.customer_id === 0) {
      const wi = await env.DB.prepare(`SELECT id FROM customers WHERE company = 'Walk-in Customer'`).first<{ id: number }>();
      custE = wi?.id ?? null;
    }
    const spE = typeof body.salesperson_id === "number" && body.salesperson_id > 0 ? Math.round(body.salesperson_id) : null;
    const todayE = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
    const dateE = typeof body.doc_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.doc_date) && body.doc_date <= todayE
      ? `${body.doc_date} 00:00:00` : null;
    const refE = str(body.reference, 60) ? String(body.reference).slice(0, 60) : null;
    const shipE = docE.kind === "service" ? null
      : (str(body.delivery_address, 300) ? String(body.delivery_address).slice(0, 300) : null);
    const baseSet = `items = ?1, discount_cents = ?2, tax_percent = ?3, delivery_cents = ?4, total_cents = ?5,
         customer_id = COALESCE(?6, customer_id), salesperson_id = COALESCE(?7, salesperson_id),
         created_at = COALESCE(?8, created_at)`;
    const baseArgs = [JSON.stringify(itemsE), discE, taxE, delE, totalE, custE, spE, dateE];
    try {
      await env.DB.prepare(`UPDATE sales_documents SET ${baseSet}, reference = ?10, delivery_address = ?11 WHERE id = ?9`)
        .bind(...baseArgs, idE, refE, shipE).run();
    } catch (e) {
      // 0062 skew: the edit still saves, minus the two optional fields.
      if (String(e).includes("no such column")) {
        try {
          await env.DB.prepare(`UPDATE sales_documents SET ${baseSet} WHERE id = ?9`).bind(...baseArgs, idE).run();
        } catch (e2) {
          if (String(e2).includes("no such column")) {
            return err("migration_missing", "Run: npx wrangler d1 migrations apply azoneofficial --remote", 500);
          }
          throw e2;
        }
      } else throw e;
    }
    /* v1.4.265 (the gap flagged in v1.4.263): editing a product invoice's
       items now RE-BALANCES stock — the old deduction is restored in full,
       then the new items deduct, so the shelf always reflects the invoice as
       it reads NOW. Two steps rather than a diff because a line can change
       SKU, not just quantity, and restore-then-deduct is right in every case. */
    let stockE: Awaited<ReturnType<typeof deductForInvoice>> | null = null;
    let edited: { doc_type: string; doc_number: string; kind?: string | null } | null = null;
    try {
      edited = await env.DB.prepare(
        `SELECT doc_type, doc_number, kind FROM sales_documents WHERE id = ?1`,
      ).bind(idE).first<{ doc_type: string; doc_number: string; kind: string | null }>();
    } catch (e) {
      if (String(e).includes("no such column")) {
        edited = await env.DB.prepare(
          `SELECT doc_type, doc_number FROM sales_documents WHERE id = ?1`,
        ).bind(idE).first<{ doc_type: string; doc_number: string; kind?: string | null }>();
      } else throw e;
    }
    if (edited && edited.doc_type === "INV" && (edited.kind ?? "product") !== "service") {
      await restoreForInvoice(env, Number(idE), edited.doc_number);
      stockE = await deductForInvoice(env, Number(idE), edited.doc_number, JSON.stringify(itemsE), null, user.id);
    }
    await audit(env, user.id, "doc.edit", "sales_documents", idE, { total_cents: totalE });
    return json({ ok: true, total_cents: totalE, stock: stockE });
  }

  /* ---- notifications ---- */

  /* ---- Holidays / company calendar ---- */

  if (path === "/holidays" && method === "GET") {
    // Any signed-in staff can see the calendar.
    const url = new URL(request.url);
    const year = url.searchParams.get("year") ?? String(new Date().getFullYear());
    const { results } = await env.DB.prepare(
      `SELECT id, holiday_date, name, kind FROM holidays
       WHERE holiday_date LIKE ?1 || '%' ORDER BY holiday_date`,
    ).bind(year).all();
    return json({ holidays: results });
  }
  if (path === "/holidays" && method === "POST") {
    if (!can(user.role, "hr_manage")) return err("forbidden", "HR access required", 403);
    if (!body || !str(body.holiday_date, 10) || !str(body.name, 120)) {
      return err("invalid_input", "holiday_date (YYYY-MM-DD) and name are required", 400);
    }
    const kinds = ["public", "company", "replacement"];
    const kind = kinds.includes(body.kind as string) ? (body.kind as string) : "public";
    try {
      await env.DB.prepare(
        `INSERT INTO holidays (holiday_date, name, kind, created_by) VALUES (?1, ?2, ?3, ?4)`,
      ).bind(body.holiday_date, body.name, kind, user.id).run();
    } catch {
      return err("conflict", "A holiday already exists on that date", 409);
    }
    await audit(env, user.id, "holiday.create");
    // v1.4.81 company policy: a PUBLIC holiday landing on Saturday or Sunday
    // is auto-replaced on Monday — or the next free working day when Monday
    // is itself a holiday. (Manual replacements remain possible via
    // kind = replacement; delete the auto row to follow the state gazette,
    // which replaces Sundays only.)
    let replacement: string | null = null;
    const dow = new Date(body.holiday_date + "T00:00:00Z").getUTCDay();
    if (kind === "public" && (dow === 0 || dow === 6)) {
      const d = new Date(body.holiday_date + "T00:00:00Z");
      d.setUTCDate(d.getUTCDate() + (dow === 6 ? 2 : 1)); // → Monday
      for (let i = 0; i < 14; i++) {
        const iso = d.toISOString().slice(0, 10);
        const wd = d.getUTCDay();
        const taken = wd === 0 || wd === 6
          ? { x: 1 }
          : await env.DB.prepare(`SELECT 1 AS x FROM holidays WHERE holiday_date = ?1`).bind(iso).first();
        if (!taken) { replacement = iso; break; }
        d.setUTCDate(d.getUTCDate() + 1);
      }
      if (replacement) {
        await env.DB.prepare(
          `INSERT OR IGNORE INTO holidays (holiday_date, name, kind, created_by) VALUES (?1, ?2, 'replacement', ?3)`,
        ).bind(replacement, `${body.name as string} (Replacement)`, user.id).run();
        await audit(env, user.id, "holiday.create", "holidays", replacement, { auto_replacement_for: body.holiday_date });
      }
    }
    return json({ ok: true, replacement }, 201);
  }
  const holMatch = path.match(/^\/holidays\/(\d+)$/);
  if (holMatch && method === "DELETE") {
    if (!can(user.role, "hr_manage")) return err("forbidden", "HR access required", 403);
    await env.DB.prepare(`DELETE FROM holidays WHERE id = ?1`).bind(holMatch[1]).run();
    await audit(env, user.id, "holiday.delete", "holidays", holMatch[1]);
    return json({ ok: true });
  }

  /* ---- Leave entitlement editor ----------------------------------------
   *
   * v1.62.0 (CEO: "I as CEO can change or update their leave entitle to all
   * the staff so that I can control their Annual Leave entitlement which is
   * no abuse!").
   *
   * The routes existed since v1.4.x but nothing in the portal ever called
   * them — there was no screen, so in practice every person silently ran on
   * DEFAULT_ENTITLEMENT and nobody could change anyone's days at all.
   *
   * Three rules decided with the CEO, 27-08-2026:
   *
   *  1. WHO. `leave_entitlement` = ceo + super_admin, not `hr_manage`. HR
   *     still processes leave and reads balances; it can no longer change
   *     what anyone is owed — including its own. Deciding how many days a
   *     person gets is the thing being protected here.
   *  2. WHAT. Annual and emergency only (EDITABLE_TYPES). Medical is a
   *     STATUTORY entitlement under the Employment Act 1955 and setting it
   *     below the legal minimum would be unlawful, not merely a bad policy,
   *     so this door does not open on it. Unpaid and replacement are not
   *     entitlements at all — they are counted as taken.
   *  3. TRACE. Every write records the figure it REPLACED as well as the new
   *     one, so "who gave themselves more days, and when" is answerable from
   *     audit_log alone.
   *
   * Note on effect: raising an entitlement mid-year does not hand over the
   * days at once. /leave/balance accrues annual leave pro-rata across the
   * months elapsed, so a rise shows up as a higher monthly accrual, which is
   * exactly the "no abuse" behaviour the CEO asked for.
   */

  /** The only types this door may write. See rule 2 above. */
  const EDITABLE_TYPES = ["annual", "emergency"] as const;

  /** Every active staff member, in the order the table shows them. */
  const entitlementStaff = async (): Promise<{ id: number; name: string; role: string }[]> => {
    const { results } = await env.DB.prepare(
      `SELECT id, COALESCE(NULLIF(TRIM(full_name), ''), name) AS name, role FROM users
       WHERE is_active = 1 AND ${currentStaffSql()} AND ${staffRolesSql()}
       ORDER BY 2`,
    ).all<{ id: number; name: string; role: string }>();
    return results;
  };

  /* The whole table in one call: every staff member, and what each is owed
     this year. A person with no row is shown at the default rather than at
     zero — that is what they are actually running on. */
  if (path === "/leave/entitlements" && method === "GET") {
    if (!can(user.role, "leave_entitlement")) {
      return err("forbidden", "Only the CEO can view or change leave entitlements", 403);
    }
    const url = new URL(request.url);
    const yearRaw = Number(url.searchParams.get("year") ?? new Date().getFullYear());
    const year = Number.isFinite(yearRaw) && yearRaw >= 2000 && yearRaw <= 2100
      ? Math.trunc(yearRaw) : new Date().getFullYear();
    const staff = await entitlementStaff();
    /* One read for the stored figures, one for the usage, then the same
       leaveAccrual() the Leave tab and the payslip use — so the number the
       CEO sees here is the number the staff member sees there. */
    let stored: { user_id: number; type: string; entitled: number; adjust?: number; used_adjust?: number }[];
    try {
      stored = (await env.DB.prepare(
        `SELECT user_id, type, entitled, adjust, used_adjust FROM leave_balances WHERE year = ?1`,
      ).bind(year).all<{ user_id: number; type: string; entitled: number; adjust: number; used_adjust: number }>()).results;
    } catch {
      /* 0091/0092 pending — the table still works, adjustments read as zero. */
      stored = (await env.DB.prepare(
        `SELECT user_id, type, entitled FROM leave_balances WHERE year = ?1`,
      ).bind(year).all<{ user_id: number; type: string; entitled: number }>()).results;
    }
    const rows = new Map<string, { entitled: number; adjust: number; used_adjust: number }>();
    for (const r of stored) {
      rows.set(`${r.user_id}:${r.type}`, {
        entitled: r.entitled, adjust: r.adjust ?? 0, used_adjust: r.used_adjust ?? 0,
      });
    }
    const { results: usedRows } = await env.DB.prepare(
      `SELECT user_id, type, COALESCE(SUM(days), 0) AS used FROM leave_requests
       WHERE status = 'approved' AND start_date LIKE ?1 || '%'
       GROUP BY user_id, type`,
    ).bind(String(year)).all<{ user_id: number; type: string; used: number }>();
    const usedMap = new Map<string, number>();
    for (const r of usedRows) usedMap.set(`${r.user_id}:${r.type}`, r.used);

    const month = new Date(Date.now() + 8 * 3600 * 1000).getUTCMonth() + 1;
    return json({
      year,
      month,
      editable: EDITABLE_TYPES,
      defaults: Object.fromEntries(EDITABLE_TYPES.map((t) => [t, DEFAULT_ENTITLEMENT[t] ?? 0])),
      staff: staff.map((p) => ({
        ...p,
        entitlement: Object.fromEntries(EDITABLE_TYPES.map((t) => {
          const row = rows.get(`${p.id}:${t}`);
          const entitled = row?.entitled ?? DEFAULT_ENTITLEMENT[t] ?? 0;
          const adjust = row?.adjust ?? 0;
          const used = (usedMap.get(`${p.id}:${t}`) ?? 0) + (row?.used_adjust ?? 0);
          const accrued = leaveAccrual(t, entitled, year, month, adjust);
          return [t, {
            days: entitled,
            /* whether this is the CEO's own figure or the built-in fallback,
               so the table can say "default" rather than implying a choice */
            set: row !== undefined,
            adjust,
            used,
            used_adjust: row?.used_adjust ?? 0,
            /* what the staff member can actually take today — the figure the
               Leave tab calls "eligible now" */
            eligible: Math.max(0, accrued - used),
          }];
        })),
      })),
    });
  }

  if (path === "/leave/entitlement" && method === "GET") {
    if (!can(user.role, "leave_entitlement")) {
      return err("forbidden", "Only the CEO can view or change leave entitlements", 403);
    }
    const url = new URL(request.url);
    const year = Number(url.searchParams.get("year") ?? new Date().getFullYear());
    const uid = Number(url.searchParams.get("user_id"));
    if (!uid) return err("invalid_input", "user_id required", 400);
    const { results } = await env.DB.prepare(
      `SELECT type, entitled FROM leave_balances WHERE user_id = ?1 AND year = ?2`,
    ).bind(uid, year).all();
    const map: Record<string, number> = {};
    for (const r of results as { type: string; entitled: number }[]) map[r.type] = r.entitled;
    return json({ year, user_id: uid, entitlement: map });
  }

  /** Shared by the single and bulk writers, so the two cannot drift apart. */
  const writeEntitlement = async (
    uid: number, year: number, type: string, entitled: number,
  ): Promise<{ before: number | null }> => {
    const prev = await env.DB.prepare(
      `SELECT entitled FROM leave_balances WHERE user_id = ?1 AND year = ?2 AND type = ?3`,
    ).bind(uid, year, type).first<{ entitled: number }>().catch(() => null);
    await env.DB.prepare(
      `INSERT INTO leave_balances (user_id, year, type, entitled) VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT(user_id, year, type) DO UPDATE SET entitled = ?4`,
    ).bind(uid, year, type, entitled).run();
    return { before: prev?.entitled ?? null };
  };

  /** Shared validation. Returns the clean numbers or the refusal to send. */
  const readEntitlementInput = (
    rawYear: unknown, rawType: unknown, rawDays: unknown,
  ): { year: number; type: string; days: number } | Response => {
    const year = Number(rawYear ?? new Date().getFullYear());
    if (!Number.isFinite(year) || year < 2000 || year > 2100) {
      return err("invalid_input", "year must be a real calendar year", 400);
    }
    /* `str` here is a TYPE GUARD (v is string), not an extractor — the
       same shape the original route used. */
    const type = str(rawType, 40) ? rawType : "";
    if (!(EDITABLE_TYPES as readonly string[]).includes(type)) {
      /* Medical is the one people will try. Say why, so it reads as a rule
         rather than a bug. */
      return err("invalid_input",
        type === "medical"
          ? "Medical leave is a statutory entitlement and cannot be changed here."
          : `Only ${EDITABLE_TYPES.join(" and ")} leave can be set. Unpaid and replacement leave are counted as taken, not granted.`,
        400);
    }
    const days = Number(rawDays);
    if (!Number.isFinite(days) || days < 0 || days > 365) {
      return err("invalid_input", "Days must be a number between 0 and 365", 400);
    }
    /* Half-days are real (the balance maths already works in halves); a
       third of a day is not. */
    if (Math.round(days * 2) !== days * 2) {
      return err("invalid_input", "Days must be a whole number or a half day", 400);
    }
    return { year: Math.trunc(year), type, days };
  };

  if (path === "/leave/entitlement" && method === "PUT") {
    if (!can(user.role, "leave_entitlement")) {
      return err("forbidden", "Only the CEO can view or change leave entitlements", 403);
    }
    const uid = Number(body?.user_id);
    if (!uid) return err("invalid_input", "user_id is required", 400);
    const parsed = readEntitlementInput(body?.year, body?.type, body?.entitled);
    if (parsed instanceof Response) return parsed;
    const { before } = await writeEntitlement(uid, parsed.year, parsed.type, parsed.days);
    await audit(env, user.id, "leave.entitlement", "users", String(uid),
      { year: parsed.year, type: parsed.type, from: before, to: parsed.days });
    return json({ ok: true, before, after: parsed.days });
  }

  /* v1.62.0 — the eligible figure itself (CEO: "in Leave I want to update on
   * the eligible also!").
   *
   * Three ways in, all landing in the same two columns:
   *
   *   adjust        +/- days that ride on top of the monthly accrual. This is
   *                 carry-forward and one-off grants. It PERSISTS, because it
   *                 is applied every time the figure is worked out.
   *   used_adjust   corrects the summed usage without editing anyone's leave
   *                 applications — those rows are the record of who asked and
   *                 who approved, and they stay untouched.
   *   set_eligible  the CEO types the eligible number he wants TODAY and the
   *                 server works out the adjustment that produces it. He
   *                 asked for this directly; storing the typed number itself
   *                 would not have worked, because eligible is recalculated
   *                 from entitlement every time it is read, so the figure
   *                 would evaporate at the turn of the month. Deriving the
   *                 adjustment gives him the number he wants now AND a figure
   *                 that survives. Accrual continues from there, which is
   *                 what "eligible" is supposed to do.
   */
  if (path === "/leave/eligible" && method === "PUT") {
    if (!can(user.role, "leave_entitlement")) {
      return err("forbidden", "Only the CEO can view or change leave entitlements", 403);
    }
    const uid = Number(body?.user_id);
    if (!uid) return err("invalid_input", "user_id is required", 400);
    const year = Number(body?.year ?? new Date().getFullYear());
    if (!Number.isFinite(year) || year < 2000 || year > 2100) {
      return err("invalid_input", "year must be a real calendar year", 400);
    }
    const type = str(body?.type, 40) ? (body!.type as string) : "";
    if (!(EDITABLE_TYPES as readonly string[]).includes(type)) {
      return err("invalid_input",
        type === "medical"
          ? "Medical leave is a statutory entitlement and cannot be changed here."
          : `Only ${EDITABLE_TYPES.join(" and ")} leave can be adjusted.`, 400);
    }
    /** Days may be negative here — a claw-back — but must still be a half. */
    const halfStep = (v: number) => Math.round(v * 2) === v * 2;

    const row = await leaveBalanceRow(env, uid, year, type);
    const entitled = row.entitled ?? DEFAULT_ENTITLEMENT[type] ?? 0;
    const month = new Date(Date.now() + 8 * 3600 * 1000).getUTCMonth() + 1;
    const usedSum = (await env.DB.prepare(
      `SELECT COALESCE(SUM(days), 0) AS used FROM leave_requests
       WHERE user_id = ?1 AND type = ?2 AND status = 'approved'
       AND start_date LIKE ?3 || '%'`,
    ).bind(uid, type, String(year)).first<{ used: number }>())?.used ?? 0;

    let adjust = row.adjust ?? 0;
    let usedAdjust = row.used_adjust ?? 0;

    if (body?.used_adjust !== undefined) {
      const v = Number(body.used_adjust);
      if (!Number.isFinite(v) || !halfStep(v) || Math.abs(v) > 365) {
        return err("invalid_input", "The used correction must be a whole or half number of days", 400);
      }
      /* A correction that drives recorded usage below zero is a typo, not a
         policy: refuse it rather than storing a total nobody can explain. */
      if (usedSum + v < 0) {
        return err("invalid_input",
          `That would put days taken below zero (${usedSum} recorded). Use ${-usedSum} at most.`, 400);
      }
      usedAdjust = v;
    }

    if (body?.set_eligible !== undefined) {
      const target = Number(body.set_eligible);
      if (!Number.isFinite(target) || target < 0 || !halfStep(target) || target > 365) {
        return err("invalid_input", "Eligible days must be 0 or more, in whole or half days", 400);
      }
      /* The adjustment that makes today's eligible figure equal `target`.
         base = what accrues from entitlement alone this month. */
      const base = leaveAccrual(type, entitled, year, month, 0);
      adjust = target + (usedSum + usedAdjust) - base;
      if (!halfStep(adjust)) adjust = Math.round(adjust * 2) / 2;
    } else if (body?.adjust !== undefined) {
      const v = Number(body.adjust);
      if (!Number.isFinite(v) || !halfStep(v) || Math.abs(v) > 365) {
        return err("invalid_input", "The adjustment must be a whole or half number of days", 400);
      }
      adjust = v;
    }

    try {
      await env.DB.prepare(
        `INSERT INTO leave_balances (user_id, year, type, entitled, adjust, used_adjust)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(user_id, year, type)
         DO UPDATE SET adjust = ?5, used_adjust = ?6`,
      ).bind(uid, year, type, entitled, adjust, usedAdjust).run();
    } catch {
      return err("migration_missing",
        "Run: npx wrangler d1 migrations apply azoneofficial --remote (0091, 0092)", 500);
    }
    const eligible = Math.max(0, leaveAccrual(type, entitled, year, month, adjust) - (usedSum + usedAdjust));
    await audit(env, user.id, "leave.eligible", "users", String(uid), {
      year, type,
      adjust_from: row.adjust ?? 0, adjust_to: adjust,
      used_adjust_from: row.used_adjust ?? 0, used_adjust_to: usedAdjust,
      eligible,
    });
    return json({ ok: true, adjust, used_adjust: usedAdjust, used: usedSum + usedAdjust, eligible });
  }

  /* v1.62.0 — one number for everybody, the CEO's "to all the staff".
     `user_ids` narrows it to a chosen few; omitted means every active staff
     member. Each row is audited individually, so a set-all is as traceable
     as thirty separate edits. */
  if (path === "/leave/entitlements/bulk" && method === "PUT") {
    if (!can(user.role, "leave_entitlement")) {
      return err("forbidden", "Only the CEO can view or change leave entitlements", 403);
    }
    const parsed = readEntitlementInput(body?.year, body?.type, body?.entitled);
    if (parsed instanceof Response) return parsed;
    const staff = await entitlementStaff();
    const wanted = Array.isArray(body?.user_ids)
      ? new Set((body!.user_ids as unknown[]).map(Number).filter((n) => Number.isFinite(n)))
      : null;
    const targets = wanted ? staff.filter((p) => wanted.has(p.id)) : staff;
    if (targets.length === 0) return err("invalid_input", "No staff to update", 400);
    let changed = 0;
    for (const p of targets) {
      const { before } = await writeEntitlement(p.id, parsed.year, parsed.type, parsed.days);
      if (before !== parsed.days) changed++;
      await audit(env, user.id, "leave.entitlement", "users", String(p.id),
        { year: parsed.year, type: parsed.type, from: before, to: parsed.days, bulk: true });
    }
    return json({ ok: true, updated: targets.length, changed });
  }

  /* ---- Payslip (basic payroll output) ---- */

  if (path === "/payslip" && method === "GET") {
    if (!can(user.role, "payroll_export")) return err("forbidden", "Payroll access required", 403);
    const url = new URL(request.url);
    const month = url.searchParams.get("month") ?? new Date().toISOString().slice(0, 7);
    const uid = Number(url.searchParams.get("user_id"));
    if (!uid) return err("invalid_input", "user_id required", 400);
    const staff = await env.DB.prepare(
      `SELECT name, email, employee_id, position, department FROM users WHERE id = ?1`,
    ).bind(uid).first<Record<string, string>>();
    if (!staff) return err("not_found", "Staff not found", 404);
    // Attendance summary for the month (MYT), by clock event flag.
    const { results: att } = await env.DB.prepare(
      `SELECT type, created_at FROM attendance_records WHERE user_id = ?1 AND created_at LIKE ?2 || '%'`,
    ).bind(uid, month).all();
    let present = 0, late = 0, halfDay = 0, earlyOut = 0;
    const days = new Set<string>();
    for (const r of att as { type: string; created_at: string }[]) {
      const myt = new Date(new Date(r.created_at + "Z").getTime() + 8 * 3600 * 1000);
      const mins = myt.getUTCHours() * 60 + myt.getUTCMinutes();
      const day = myt.toISOString().slice(0, 10);
      if (r.type === "clock_in") {
        days.add(day);
        if (mins > 10 * 60 + 5 && mins < 13 * 60) late++;
        else if (mins >= 13 * 60) halfDay++;
        else present++;
      } else if (r.type === "clock_out" && mins < 18 * 60 && mins > 13 * 60) earlyOut++;
    }
    // Approved leave days in the month.
    const leave = await env.DB.prepare(
      `SELECT COALESCE(SUM(days), 0) AS d FROM leave_requests
       WHERE user_id = ?1 AND status = 'approved' AND start_date LIKE ?2 || '%'`,
    ).bind(uid, month).first<{ d: number }>();
    return json({
      month,
      staff,
      attendance: {
        days_present: days.size,
        on_time: present,
        late,
        half_days: halfDay,
        early_outs: earlyOut,
      },
      approved_leave_days: leave?.d ?? 0,
    });
  }

  /* ---- HR / payroll: attendance CSV export ---- */

  /* ---- attendance corrections (CEO + admin tier, v1.4.28) ----
     Manual entries cover days worked before the system existed; amendments
     fix wrong punches. Every action names its actor and is audit-logged. */

  /* v1.91.0 — the tier is a permission now (attendance_correct: CEO, COO,
     CCO, HR admin, admin tier), not three roles typed here. */
  const ATT_ADMIN = can(user.role, "attendance_correct");

  if (path === "/attendance/manual" && method === "POST") {
    if (!ATT_ADMIN) return err("forbidden", "Attendance corrections need CEO, COO, CCO or HR admin", 403);
    const types = ["clock_in", "clock_out"];
    const myt = str(body?.myt, 16) ? (body!.myt as string) : ""; // "YYYY-MM-DD HH:MM" Malaysia time
    if (!body || typeof body.user_id !== "number" || typeof body.type !== "string" ||
        !types.includes(body.type) || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(myt)) {
      return err("invalid_input", "user_id, type (clock_in|clock_out) and myt (YYYY-MM-DD HH:MM) are required", 400);
    }
    // Store UTC like every real punch: MYT − 8h.
    const utc = new Date(new Date(myt.replace(" ", "T") + ":00Z").getTime() - 8 * 3600 * 1000);
    const createdAt = utc.toISOString().slice(0, 19).replace("T", " ");
    await env.DB.prepare(
      `INSERT INTO attendance_records (user_id, type, created_at, manual_by)
       VALUES (?1, ?2, ?3, ?4)`,
    ).bind(body.user_id, body.type, createdAt, user.id).run();
    await audit(env, user.id, "attendance.manual", "users", String(body.user_id));
    return json({ ok: true }, 201);
  }

  /* ---- v1.76.0: forgotten punches, and the hours they are judged against ----

     CEO: "The approval will be require CEO for approval then CEO will update
     the clock in/out time during the approval."

     Approving is the moment the claimed time becomes a real one, so the
     approver can rewrite it in the same action. Rejecting DELETES the punch:
     a rejected claim is not a record of anything, and leaving it in the table
     as a zombie row is how a day gets counted twice later. */
  if (path === "/attendance/pending" && method === "GET") {
    if (!ATT_ADMIN) return err("forbidden", "Attendance corrections need CEO, COO, CCO or HR admin", 403);
    try {
      const { results } = await env.DB.prepare(
        `SELECT a.id, a.user_id, a.type, a.created_at,
                COALESCE(NULLIF(TRIM(u.full_name), ''), u.name) AS name
           FROM attendance_records a JOIN users u ON u.id = a.user_id
          WHERE a.pending_approval = 1
          ORDER BY a.created_at DESC LIMIT 100`,
      ).all();
      return json({ pending: results });
    } catch {
      return json({ pending: [], pending_migration: true }); // pre-0100
    }
  }

  if (path === "/attendance/pending/decide" && method === "POST") {
    /* Narrower than the rest of this panel, and narrower than OT approvals:
       the CEO asked for this one by name. Approving a punch creates paid
       time out of a claim nobody can check. */
    if (!can(user.role, "unpaid_leave")) {
      return err("forbidden", "Only the CEO can approve a forgotten punch", 403);
    }
    const idP = Number(body?.id);
    const action = String(body?.action ?? "");
    if (!Number.isFinite(idP) || !["approve", "reject"].includes(action)) {
      return err("invalid_input", "id and action (approve|reject) are required", 400);
    }
    const rowP = await env.DB.prepare(
      `SELECT user_id, type, created_at FROM attendance_records
        WHERE id = ?1 AND pending_approval = 1`,
    ).bind(idP).first<{ user_id: number; type: string; created_at: string }>().catch(() => null);
    if (!rowP) return err("not_found", "No punch waiting for approval with that id", 404);

    if (action === "reject") {
      await env.DB.prepare(`DELETE FROM attendance_records WHERE id = ?1 AND pending_approval = 1`)
        .bind(idP).run();
      await notify(env, rowP.user_id, "attendance",
        `Your forgotten ${rowP.type === "clock_in" ? "clock-in" : "clock-out"} was not approved. Speak to the CEO if that is wrong.`,
        `punch:decide:${idP}`);
      await audit(env, user.id, "attendance.forgot_reject", "attendance_records", String(idP), rowP);
      return json({ ok: true, removed: true });
    }

    /* The whole point of the approval step: the time. `myt` is optional -
       omitting it accepts the claimed time as it stands. */
    const mytP = str(body?.myt, 16) ? (body!.myt as string) : "";
    let setTime = "";
    if (mytP) {
      if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(mytP)) {
        return err("invalid_input", "myt must be YYYY-MM-DD HH:MM (Malaysia time)", 400);
      }
      setTime = new Date(new Date(mytP.replace(" ", "T") + ":00Z").getTime() - 8 * 3600 * 1000)
        .toISOString().slice(0, 19).replace("T", " ");
    }
    await env.DB.prepare(
      setTime
        ? `UPDATE attendance_records SET pending_approval = 0, created_at = ?2,
             amended_by = ?3, amended_at = datetime('now') WHERE id = ?1`
        : `UPDATE attendance_records SET pending_approval = 0,
             amended_by = ?2, amended_at = datetime('now') WHERE id = ?1`,
    ).bind(...(setTime ? [idP, setTime, user.id] : [idP, user.id])).run();
    await notify(env, rowP.user_id, "attendance",
      `Your forgotten ${rowP.type === "clock_in" ? "clock-in" : "clock-out"} was approved${mytP ? ` at ${mytP.slice(11)}` : ""}. It now counts.`,
      `punch:decide:${idP}`);
    await audit(env, user.id, "attendance.forgot_approve", "attendance_records", String(idP), {
      user_id: rowP.user_id, claimed: rowP.created_at, set_to: setTime || null,
    });
    return json({ ok: true });
  }

  /* ---- the schedules themselves ---- */
  if (path === "/shift-patterns" && method === "GET") {
    if (!can(user.role, "team_manage")) return err("forbidden", "Management access required", 403);
    try {
      const { results } = await env.DB.prepare(
        `SELECT * FROM shift_patterns ORDER BY is_default DESC, name`,
      ).all();
      const { results: asg } = await env.DB.prepare(
        `SELECT s.id, s.user_id, s.pattern_id, s.effective_from, p.name AS pattern_name,
                COALESCE(NULLIF(TRIM(u.full_name), ''), u.name) AS name
           FROM staff_shifts s
           JOIN shift_patterns p ON p.id = s.pattern_id
           JOIN users u ON u.id = s.user_id
          ORDER BY name, s.effective_from DESC`,
      ).all();
      return json({ patterns: results, assignments: asg });
    } catch {
      return json({ patterns: [], assignments: [], pending_migration: true }); // pre-0099
    }
  }

  if (path === "/shift-patterns" && (method === "POST" || method === "PATCH")) {
    if (!can(user.role, "hr_manage")) return err("forbidden", "HR access required", 403);
    const nameS = str(body?.name, 60);
    if (!nameS) return err("invalid_input", "A name is required", 400);
    /* Minutes since midnight, or null for a day this pattern does not work.
       Validated rather than trusted: a start after its own end would silently
       make every punch that day an early-out. */
    const cols = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
    const vals: (number | null)[] = [];
    /* v1.80.0 - the second block is validated by the SAME rules as the first
       and then two more, because a second block is where the mistakes live:
       it must come AFTER the first (a pattern is read in order downstream)
       and it must not overlap it (overlapping blocks would count the same
       minute twice in the payroll intersection). */
    const vals2: (number | null)[] = [];
    for (const c of cols) {
      const dayV = (body?.[c] ?? null) as { start?: unknown; end?: unknown; start2?: unknown; end2?: unknown } | null;
      const st = typeof dayV?.start === "number" ? Math.round(dayV.start) : null;
      const en = typeof dayV?.end === "number" ? Math.round(dayV.end) : null;
      const st2 = typeof dayV?.start2 === "number" ? Math.round(dayV.start2) : null;
      const en2 = typeof dayV?.end2 === "number" ? Math.round(dayV.end2) : null;
      for (const [label, a, b] of [["", st, en], [" (second block)", st2, en2]] as const) {
        if (a !== null && (a < 0 || a > 1439)) return err("invalid_input", `${c}${label}: start is not a time of day`, 400);
        if (b !== null && (b < 1 || b > 1440)) return err("invalid_input", `${c}${label}: end is not a time of day`, 400);
        if (a !== null && b !== null && b <= a) {
          return err("invalid_input", `${c}${label}: the finish time is not after the start time`, 400);
        }
        /* One without the other is a half-defined day - it would flag every
           punch against a boundary that does not exist. */
        if ((a === null) !== (b === null)) {
          return err("invalid_input", `${c}${label}: give both a start and a finish, or neither`, 400);
        }
      }
      if (st2 !== null && st === null) {
        return err("invalid_input", `${c}: a second block needs a first one - a rest day has neither`, 400);
      }
      if (st2 !== null && en !== null && st2 < en) {
        return err("invalid_input", `${c}: the second block starts before the first one finishes`, 400);
      }
      vals.push(st, en);
      vals2.push(st2, en2);
    }
    const halfV = typeof body?.half_day_minutes === "number" ? Math.round(body.half_day_minutes) : 720;
    /* v1.81.0 - the unpaid break, in minutes. Clamped rather than rejected:
       a negative break would ADD hours to the day, and a break longer than
       the day would make every attendance a short day. */
    const brkV = typeof body?.break_minutes === "number"
      ? Math.max(0, Math.min(240, Math.round(body.break_minutes))) : 60;
    try {
      if (method === "PATCH") {
        const idS = Number(body?.id);
        if (!Number.isFinite(idS)) return err("invalid_input", "id is required", 400);
        await env.DB.prepare(
          `UPDATE shift_patterns SET name = ?1,
             mon_start = ?2, mon_end = ?3, tue_start = ?4, tue_end = ?5,
             wed_start = ?6, wed_end = ?7, thu_start = ?8, thu_end = ?9,
             fri_start = ?10, fri_end = ?11, sat_start = ?12, sat_end = ?13,
             sun_start = ?14, sun_end = ?15, half_day_minutes = ?16,
             mon_start2 = ?18, mon_end2 = ?19, tue_start2 = ?20, tue_end2 = ?21,
             wed_start2 = ?22, wed_end2 = ?23, thu_start2 = ?24, thu_end2 = ?25,
             fri_start2 = ?26, fri_end2 = ?27, sat_start2 = ?28, sat_end2 = ?29,
             sun_start2 = ?30, sun_end2 = ?31, break_minutes = ?32
           WHERE id = ?17`,
        ).bind(nameS, ...vals, halfV, idS, ...vals2, brkV).run();
        await audit(env, user.id, "shift_pattern.update", "shift_patterns", String(idS), { name: nameS });
        return json({ ok: true, id: idS });
      }
      const res = await env.DB.prepare(
        `INSERT INTO shift_patterns
           (name, mon_start, mon_end, tue_start, tue_end, wed_start, wed_end,
            thu_start, thu_end, fri_start, fri_end, sat_start, sat_end,
            sun_start, sun_end, half_day_minutes, created_by,
            mon_start2, mon_end2, tue_start2, tue_end2, wed_start2, wed_end2,
            thu_start2, thu_end2, fri_start2, fri_end2, sat_start2, sat_end2,
            sun_start2, sun_end2, break_minutes)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17,
                 ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25, ?26, ?27, ?28, ?29, ?30, ?31, ?32)
         RETURNING id`,
      ).bind(nameS, ...vals, halfV, user.id, ...vals2, brkV).first<{ id: number }>();
      await audit(env, user.id, "shift_pattern.create", "shift_patterns", String(res?.id), { name: nameS });
      return json({ ok: true, id: res?.id }, 201);
    } catch (eS) {
      const msgS = String(eS);
      if (!msgS.includes("no such table") && !msgS.includes("no such column")) throw eS;
      return err("migration_missing", `Migration ${msgS.includes("no such column") ? "0102/0103" : "0099"} is not applied - run: npx wrangler d1 migrations apply azoneofficial --remote, then try again.`, 500);
    }
  }

  /* v1.80.1 (CEO: "option to remove this pattern since there is a issue to
     update pattern name!") - a pattern created by mistake had no way out. It
     sat in the chip row forever, and the only thing to do with it was open it
     and try to rename it into something useful.
   *
   * TWO REFUSALS, BOTH ABOUT HISTORY RATHER THAN TIDINESS:
   *
   *   THE DEFAULT PATTERN STAYS. It is what everybody with no assignment is
   *   measured against, and what a new joiner starts on. Deleting it drops
   *   the whole company onto the hard-coded 10:00-18:00 fallback - the exact
   *   constant 0099 existed to get rid of.
   *
   *   AN ASSIGNED PATTERN STAYS. Assignments are effective-dated: they are
   *   the record of which hours a month was flagged against. Delete the
   *   pattern and `shiftOn` finds no row on the JOIN and falls through to the
   *   default, silently re-flagging months that have already been paid. So
   *   this refuses and NAMES the people, because "reassign them first" is
   *   only useful advice if you know who they are.
   */
  const patDel = path.match(/^\/shift-patterns\/(\d+)$/);
  if (patDel && method === "DELETE") {
    if (!can(user.role, "hr_manage")) return err("forbidden", "HR access required", 403);
    const idD = Number(patDel[1]);
    try {
      const row = await env.DB.prepare(
        `SELECT name, is_default FROM shift_patterns WHERE id = ?1`,
      ).bind(idD).first<{ name: string; is_default: number }>();
      if (!row) return err("not_found", "That pattern no longer exists", 404);
      if (row.is_default === 1) {
        return err("invalid_input", "This is the default pattern - everybody without their own schedule is measured against it. Make another pattern the default before removing this one.", 400);
      }
      const { results: users } = await env.DB.prepare(
        `SELECT DISTINCT COALESCE(NULLIF(TRIM(u.full_name), ''), u.name) AS name
           FROM staff_shifts s JOIN users u ON u.id = s.user_id
          WHERE s.pattern_id = ?1 ORDER BY name`,
      ).bind(idD).all<{ name: string }>();
      if ((users ?? []).length > 0) {
        const who = (users ?? []).map((u) => u.name).slice(0, 6).join(", ");
        const more = (users ?? []).length > 6 ? ` and ${(users ?? []).length - 6} more` : "";
        return err(
          "invalid_input",
          `${who}${more} ${(users ?? []).length === 1 ? "is" : "are"} still on this pattern. Assign them to another one first - removing it now would re-flag the months they have already been paid for.`,
          400,
        );
      }
      await env.DB.prepare(`DELETE FROM shift_patterns WHERE id = ?1`).bind(idD).run();
      await audit(env, user.id, "shift_pattern.delete", "shift_patterns", String(idD), { name: row.name });
      return json({ ok: true });
    } catch (eD) {
      if (!String(eD).includes("no such table")) throw eD;
      return err("migration_missing", "Migration 0099 is not applied - run: npx wrangler d1 migrations apply azoneofficial --remote, then try again.", 500);
    }
  }

  if (path === "/staff-shifts" && method === "POST") {
    if (!can(user.role, "hr_manage")) return err("forbidden", "HR access required", 403);
    const uidS = Number(body?.user_id);
    const pidS = Number(body?.pattern_id);
    const fromS = str(body?.effective_from, 10) ? (body!.effective_from as string) : "";
    if (!Number.isFinite(uidS) || !Number.isFinite(pidS) || !/^\d{4}-\d{2}-\d{2}$/.test(fromS)) {
      return err("invalid_input", "user_id, pattern_id and effective_from (YYYY-MM-DD) are required", 400);
    }
    try {
      await env.DB.prepare(
        `INSERT INTO staff_shifts (user_id, pattern_id, effective_from, created_by)
         VALUES (?1, ?2, ?3, ?4)`,
      ).bind(uidS, pidS, fromS, user.id).run();
    } catch (eA) {
      if (!String(eA).includes("no such table")) throw eA;
      return err("migration_missing", "Migration 0099 is not applied - run: npx wrangler d1 migrations apply azoneofficial --remote, then try again.", 500);
    }
    /* The person is told their hours changed, and from when. Hours are the
       thing every late flag on their record is measured against. */
    const pat = await env.DB.prepare(`SELECT name FROM shift_patterns WHERE id = ?1`)
      .bind(pidS).first<{ name: string }>().catch(() => null);
    await notify(env, uidS, "attendance",
      `Your working hours change from ${fromS}: ${pat?.name ?? "a new schedule"}.`, `shift:${uidS}:${fromS}`);
    await audit(env, user.id, "staff_shift.assign", "users", String(uidS), { pattern_id: pidS, from: fromS });
    return json({ ok: true }, 201);
  }

  const attMatch = path.match(/^\/attendance\/(\d+)$/);
  if (attMatch && method === "PATCH") {
    if (!ATT_ADMIN) return err("forbidden", "Attendance corrections need CEO, COO, CCO or HR admin", 403);
    const myt = str(body?.myt, 16) ? (body!.myt as string) : "";
    if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(myt)) {
      return err("invalid_input", "myt (YYYY-MM-DD HH:MM, Malaysia time) is required", 400);
    }
    const utc = new Date(new Date(myt.replace(" ", "T") + ":00Z").getTime() - 8 * 3600 * 1000);
    const createdAt = utc.toISOString().slice(0, 19).replace("T", " ");
    const res = await env.DB.prepare(
      `UPDATE attendance_records SET created_at = ?1, amended_by = ?2, amended_at = datetime('now') WHERE id = ?3`,
    ).bind(createdAt, user.id, attMatch[1]).run();
    if (!res.meta.changes) return err("not_found", "Record not found", 404);
    await audit(env, user.id, "attendance.amend", "attendance_records", attMatch[1]);
    return json({ ok: true });
  }
  if (attMatch && method === "DELETE") {
    if (!ATT_ADMIN) return err("forbidden", "Attendance corrections need CEO, COO, CCO or HR admin", 403);
    const res = await env.DB.prepare(`DELETE FROM attendance_records WHERE id = ?1`).bind(attMatch[1]).run();
    if (!res.meta.changes) return err("not_found", "Record not found", 404);
    await audit(env, user.id, "attendance.delete", "attendance_records", attMatch[1]);
    return json({ ok: true });
  }

  /* ---- v1.72.0: a day marked UNPAID LEAVE, straight from Attendance ----

     CEO: "I also want to have a option for me to update their attendance to
     Unpaid Leave which is for payroll. on Payroll also to capture this
     unpaid leave."

     Payroll already deducts unpaid leave and has since v1.4.79 - an explicit
     payslip line at the Employment Act 1955 s.60I rate of one twenty-sixth
     of monthly wages per day, with those days excluded from the
     incomplete-month proration so nothing is taken twice. The gap was never
     the arithmetic. It was that the ONLY way a day could become unpaid was a
     leave request the staff member had submitted and three people had
     signed, so a day nobody applied for could not be recorded at all.

     A day recorded here therefore becomes exactly what it is: an approved
     unpaid leave request, created by management (recorded_direct = 1). One
     source of truth - the payslip, the payroll table, the Leave tab and the
     balance card all keep reading the same rows, and there is no second
     table to drift out of step with the first. Nothing in payroll had to
     change to make this count, which is the point. */
  if (path === "/attendance/unpaid" && method === "GET") {
    if (!ATT_ADMIN) return err("forbidden", "Attendance corrections need CEO, COO, CCO or HR admin", 403);
    const urlU = new URL(request.url);
    const mU = urlU.searchParams.get("month") ??
      new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(mU)) return err("invalid_input", "month must be YYYY-MM", 400);
    /* recorded_direct arrives with 0097. On a database that has not applied
       it the days still exist and still deduct - only the "recorded by
       management" flag is unknown, so the list degrades to read-only rather
       than 500.

       The month filter is start_date, NOT an overlap of the date range, and
       that is deliberate: payroll attributes a leave to the month it STARTS
       in (payslipExtras and /payroll/recompute both read start_date LIKE
       month). Listing by overlap here would show a July leave under August
       while August pay was untouched - a screen about money disagreeing with
       the money. */
    const SELU = (col: string) =>
      `SELECT l.id, l.user_id, l.start_date AS d, l.end_date, l.days, l.reason, ${col} AS recorded_direct,
              u.name, u.full_name
       FROM leave_requests l JOIN users u ON u.id = l.user_id
       WHERE l.type = 'unpaid' AND l.status = 'approved'
         AND l.start_date LIKE ?1 || '%'
       ORDER BY l.start_date DESC, u.name`;
    let rowsU;
    try {
      rowsU = (await env.DB.prepare(SELU("l.recorded_direct")).bind(mU).all()).results;
    } catch {
      rowsU = (await env.DB.prepare(SELU("0")).bind(mU).all()).results;
    }
    return json({ month: mU, unpaid: rowsU });
  }

  if (path === "/attendance/unpaid" && method === "POST") {
    /* Deliberately NARROWER than the rest of this panel. Every other control
       here corrects a record of what happened; this one takes a day of pay
       off a person, so it sits with claims_decide and leave_entitlement. */
    if (!can(user.role, "unpaid_leave")) {
      return err("forbidden", "Only the CEO can record unpaid leave", 403);
    }
    const dateU = str(body?.date, 10) ? (body!.date as string) : "";
    if (typeof body?.user_id !== "number" || !/^\d{4}-\d{2}-\d{2}$/.test(dateU)) {
      return err("invalid_input", "user_id and date (YYYY-MM-DD) are required", 400);
    }
    /* A typo in the year is the one mistake here that would not look wrong
       on screen and would quietly sit in a payroll month nobody is reading. */
    const dayMs = Date.parse(`${dateU}T00:00:00Z`);
    if (!Number.isFinite(dayMs) || Math.abs(dayMs - Date.now()) > 400 * 86400 * 1000) {
      return err("invalid_input", "That date is more than a year away - check the year", 400);
    }
    const targetU = await env.DB.prepare(
      `SELECT id, name, role, is_active FROM users WHERE id = ?1`,
    ).bind(body.user_id).first<{ id: number; name: string; role: string; is_active: number }>();
    if (!targetU || !targetU.is_active || targetU.role === "customer") {
      return err("invalid_input", "That must be an active staff member", 400);
    }
    /* Already unpaid - whether the staff member applied for it or it was
       recorded here. Two rows covering one day is two deductions. */
    const clashU = await env.DB.prepare(
      `SELECT id FROM leave_requests
       WHERE user_id = ?1 AND type = 'unpaid' AND status = 'approved'
         AND start_date <= ?2 AND end_date >= ?2 LIMIT 1`,
    ).bind(body.user_id, dateU).first<{ id: number }>();
    if (clashU) return err("invalid_input", "That day is already unpaid leave", 400);
    /* v1.75.0 (CEO: "on unpaid I should able to deduct for half day or based
       on their time in like example work for 2 hours the remaining hours will
       be deducted. the working hours is 8 hours include their break time").

       Three ways to say how much of the day is unpaid, in order of
       precedence, all landing on the same REAL `days` value that payroll
       already knew how to multiply:

         hours_worked: 2   ->  6 hours short of 8  ->  0.75 day
         days: 0.5         ->  half a day
         neither           ->  1 day

       Rounded to a quarter day: a payslip line reading "0.708333 DAYS" is a
       line nobody can check, and an argument about seven minutes is not
       worth the trust it costs. */
    let daysU = 1;
    if (typeof body?.hours_worked === "number" && Number.isFinite(body.hours_worked)) {
      /* v1.81.0 — AGAINST THE HOURS THAT DAY OWED, not a flat eight.
         This charged every short day as a fraction of 8h, so somebody on a
         seven-hour day who worked six was billed 2/8 of a day instead of
         1/7 — over-charged by more than double. The requirement is resolved
         here from the person's own pattern rather than taken from the
         request: the browser sends what it displayed, and what a payslip
         deducts is not something a request body gets to decide. */
      const shU = await shiftOn(env, body.user_id as number, dateU);
      const owed = workMinutes(shU) || WORK_DAY_MINUTES;
      const worked = Math.max(0, Math.min(owed / 60, body.hours_worked));
      const shortMins = owed - Math.round(worked * 60);
      daysU = Math.round((shortMins / owed) * 4) / 4;
    } else if (typeof body?.days === "number" && Number.isFinite(body.days)) {
      daysU = Math.round(body.days * 4) / 4;
    }
    if (!(daysU > 0) || daysU > 1) {
      return err("invalid_input", "A day can be unpaid for a quarter of it up to all of it - use one row per day", 400);
    }
    const reasonU = str(body?.reason, 500) ? (body!.reason as string) : null;
    let idU: number | undefined;
    try {
      idU = (await env.DB.prepare(
        `INSERT INTO leave_requests
           (user_id, type, start_date, end_date, days, reason, stage, status,
            final_by, final_at, recorded_direct)
         VALUES (?1, 'unpaid', ?2, ?2, ?5, ?3, 'approved', 'approved', ?4, datetime('now'), 1)
         RETURNING id`,
      ).bind(body.user_id, dateU, reasonU, user.id, daysU).first<{ id: number }>())?.id;
    } catch (eU) {
      if (!String(eU).includes("no such column")) throw eU;
      return err("migration_missing", "Migration 0097 is not applied - run: npx wrangler d1 migrations apply azoneofficial --remote, then try again.", 500);
    }
    await stampIssuer(env, "leave_requests", idU);
    /* Told, not discovered on the payslip. A deduction a person first hears
       about on pay day is how trust in a payroll system ends. */
    /* v1.81.1 - "0.5 of a day" is not how anybody says it, and this message
       is the first a person hears that their pay is being cut. Named
       fractions for the ones the form can produce, and the decimal only for
       an odd value that came from the hours-short path. */
    const amountU = daysU === 1 ? "a full day"
      : daysU === 0.5 ? "half a day"
      : daysU === 0.25 ? "a quarter of a day"
      : daysU === 0.75 ? "three quarters of a day"
      : `${daysU} of a day`;
    await notify(env, body.user_id, "leave",
      `${dateU} has been recorded as UNPAID LEAVE (${amountU}). It will be deducted from that month pay.`,
      `unpaid:${dateU}`);
    await audit(env, user.id, "leave.unpaid_record", "leave_requests", String(idU), {
      user_id: body.user_id, date: dateU, days: daysU, reason: reasonU,
    });
    return json({ ok: true, id: idU, days: daysU }, 201);
  }

  if (path === "/attendance/unpaid" && method === "DELETE") {
    if (!can(user.role, "unpaid_leave")) {
      return err("forbidden", "Only the CEO can record unpaid leave", 403);
    }
    const urlD2 = new URL(request.url);
    const idD2 = Number(urlD2.searchParams.get("id"));
    if (!Number.isFinite(idD2) || idD2 <= 0) return err("invalid_input", "id is required", 400);
    /* recorded_direct = 1 in the WHERE clause is the whole safety of this
       route: undo may only remove a day the COMPANY recorded. A leave the
       staff member applied for and the chain approved is their record and
       is not deleted from an attendance screen. */
    const rowD2 = await env.DB.prepare(
      `SELECT user_id, start_date FROM leave_requests
       WHERE id = ?1 AND type = 'unpaid' AND recorded_direct = 1`,
    ).bind(idD2).first<{ user_id: number; start_date: string }>().catch(() => null);
    if (!rowD2) return err("not_found", "No management-recorded unpaid day with that id", 404);
    await env.DB.prepare(`DELETE FROM leave_requests WHERE id = ?1 AND recorded_direct = 1`)
      .bind(idD2).run();
    await notify(env, rowD2.user_id, "leave",
      `${rowD2.start_date} is no longer recorded as unpaid leave.`, `unpaid:undo:${rowD2.start_date}`);
    await audit(env, user.id, "leave.unpaid_undo", "leave_requests", String(idD2), {
      user_id: rowD2.user_id, date: rowD2.start_date,
    });
    return json({ ok: true });
  }

  /* ============ v1.78.0 — a rest day worked, credited back as leave ============
   *
   * CEO, 31-08-2026: *"in Staff table should appear a list of replacement
   * leave for the staff that working on weekend which is for me to credit
   * the replacement leave either half day or full day depend on their in and
   * out time."*
   *
   * Replacement leave already existed as a leave TYPE and could only ever be
   * TAKEN - the entitlement editor refuses it in as many words. So a person
   * who worked a Saturday was owed a day that the system had no way to grant,
   * and the balance lived in somebody's memory.
   *
   * WHAT COUNTS AS A REST DAY is the person's OWN schedule (migration 0099),
   * not Saturday and Sunday: somebody whose pattern works Saturday is not on
   * a rest day, and somebody whose pattern rests on Wednesday is.
   *
   * HOURLY PART-TIMERS ARE SKIPPED. They are paid for every minute clocked,
   * including that Saturday - they have already been compensated for it, and
   * crediting leave on top would pay for the same hours twice.
   *
   * The credit itself lands in leave_balances.adjust, the CEO-only lever that
   * already exists and is already audited, so the day shows in their balance
   * and can be applied for through the normal chain. replacement_credits
   * (0101) is the receipt, and its UNIQUE index is what stops a double tap
   * costing the company a day.
   */
  if (path === "/rest-day-work" && method === "GET") {
    if (!can(user.role, "leave_entitlement")) {
      return err("forbidden", "Only the CEO can credit replacement leave", 403);
    }
    const urlR = new URL(request.url);
    const mR = urlR.searchParams.get("month") ?? new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(mR)) return err("invalid_input", "month must be YYYY-MM", 400);

    /* A punch waiting for approval is a claim, not evidence that anybody was
       anywhere - the same rule the payroll counting queries use. */
    const notPendingR = await notPendingSql(env, "a.");
    const { results: punches } = await env.DB.prepare(
      `SELECT a.user_id, date(a.created_at, '+8 hours') AS d,
              MIN(CASE WHEN a.type = 'clock_in'  THEN a.created_at END) AS i,
              MAX(CASE WHEN a.type = 'clock_out' THEN a.created_at END) AS o
       FROM attendance_records a
       WHERE strftime('%Y-%m', a.created_at, '+8 hours') = ?1${notPendingR}
       GROUP BY a.user_id, d`,
    ).bind(mR).all<{ user_id: number; d: string; i: string | null; o: string | null }>();
    if (punches.length === 0) return json({ month: mR, staff: [] });

    const { results: peopleR } = await env.DB.prepare(
      `SELECT id, name, full_name, role, employment_status, position FROM users
       WHERE ${staffRolesSql()} AND is_active = 1 AND ${currentStaffSql()}`,
    ).all<{ id: number; name: string; full_name: string | null; role: string; employment_status: string | null; position: string | null }>();
    const byId = new Map(peopleR.map((u) => [u.id, u]));

    /* Already credited - so a day disappears from this list the moment it is
       dealt with, rather than sitting there inviting a second credit. */
    let done = new Set<string>();
    try {
      const { results: cr } = await env.DB.prepare(
        `SELECT user_id, work_date FROM replacement_credits WHERE work_date LIKE ?1 || '%'`,
      ).bind(mR).all<{ user_id: number; work_date: string }>();
      done = new Set(cr.map((c) => `${c.user_id}|${c.work_date}`));
    } catch { /* pre-0101 - nothing has been credited yet */ }

    const shiftAtW = await shiftResolver(env);
    const out: {
      user_id: number; name: string; position: string | null; date: string;
      in_myt: string | null; out_myt: string | null; minutes: number | null;
      pattern: string; suggest: number;
    }[] = [];
    for (const p of punches) {
      const who = byId.get(p.user_id);
      if (!who) continue;
      if (isHourlyUser(who.role, who.employment_status)) continue; // paid by the clock already
      if (done.has(`${p.user_id}|${p.d}`)) continue;
      const sh = shiftAtW(p.user_id, p.d);
      if (sh.kind !== "rest_day") continue;
      const mins = p.i && p.o
        ? Math.max(0, Math.round((new Date(p.o + "Z").getTime() - new Date(p.i + "Z").getTime()) / 60000))
        : null;
      const myt = (iso: string | null) =>
        iso ? new Date(new Date(iso + "Z").getTime() + 8 * 3600 * 1000).toISOString().slice(11, 16) : null;
      out.push({
        user_id: p.user_id,
        name: who.full_name || who.name,
        position: who.position,
        date: p.d,
        in_myt: myt(p.i),
        out_myt: myt(p.o),
        minutes: mins,
        pattern: sh.pattern,
        /* A suggestion, never a decision. A full scheduled day worked reads
           as a full day back; anything less starts at a half. The CEO sees
           the in and out time and both buttons regardless - which is what he
           asked for. */
        suggest: mins !== null && mins >= WORK_DAY_MINUTES ? 1 : 0.5,
      });
    }
    out.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
    return json({ month: mR, work_day_hours: WORK_DAY_MINUTES / 60, staff: out });
  }

  if (path === "/replacement-credit" && method === "POST") {
    if (!can(user.role, "leave_entitlement")) {
      return err("forbidden", "Only the CEO can credit replacement leave", 403);
    }
    const uidC = Number(body?.user_id);
    const dateC = typeof body?.date === "string" ? body.date.slice(0, 10) : "";
    const daysC = Number(body?.days);
    if (!Number.isFinite(uidC) || uidC <= 0) return err("invalid_input", "user_id is required", 400);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateC)) return err("invalid_input", "date must be YYYY-MM-DD", 400);
    /* Half a day or a whole one - the CEO's two options. Anything else is a
       typo, and a typo here silently grants leave nobody earned. */
    if (daysC !== 0.5 && daysC !== 1) {
      return err("invalid_input", "days must be 0.5 (half day) or 1 (full day)", 400);
    }
    const whoC = await env.DB.prepare(
      `SELECT name, full_name, role, employment_status FROM users WHERE id = ?1`,
    ).bind(uidC).first<{ name: string; full_name: string | null; role: string; employment_status: string | null }>();
    if (!whoC) return err("not_found", "No such staff member", 404);
    if (isHourlyUser(whoC.role, whoC.employment_status)) {
      return err("invalid_input", "An hourly part-timer is paid for the hours they clocked that day, so there is nothing to replace", 400);
    }
    /* It has to actually BE a rest day for them. Without this the route is a
       way to grant leave for any date at all, which is not what it is. */
    const shC = (await shiftResolver(env))(uidC, dateC);
    if (shC.kind !== "rest_day") {
      return err("invalid_input", `${dateC} is a working day on ${shC.pattern}, not a rest day`, 400);
    }
    const notPendingC = await notPendingSql(env, "a.");
    const dayC = await env.DB.prepare(
      `SELECT MIN(CASE WHEN a.type = 'clock_in'  THEN a.created_at END) AS i,
              MAX(CASE WHEN a.type = 'clock_out' THEN a.created_at END) AS o
       FROM attendance_records a
       WHERE a.user_id = ?1 AND date(a.created_at, '+8 hours') = ?2${notPendingC}`,
    ).bind(uidC, dateC).first<{ i: string | null; o: string | null }>();
    if (!dayC?.i) return err("invalid_input", "There is no approved clock-in for that day", 400);
    const minsC = dayC.o
      ? Math.max(0, Math.round((new Date(dayC.o + "Z").getTime() - new Date(dayC.i + "Z").getTime()) / 60000))
      : null;

    const yearC = Number(dateC.slice(0, 4));
    try {
      await env.DB.prepare(
        `INSERT INTO replacement_credits (user_id, work_date, days, minutes, credited_by)
         VALUES (?1, ?2, ?3, ?4, ?5)`,
      ).bind(uidC, dateC, daysC, minsC, user.id).run();
    } catch (eC) {
      /* The UNIQUE index doing its job. Not an error worth a 500: the day is
         already credited, which is the state the caller wanted. */
      const msgC = eC instanceof Error ? eC.message : String(eC);
      if (/UNIQUE|constraint/i.test(msgC)) {
        return err("already_credited", `${dateC} has already been credited for this staff member`, 409);
      }
      await logError(env, "replacement_credit", msgC);
      return err("migration_missing", "Run: npx wrangler d1 migrations apply azoneofficial --remote (0101_replacement_credits)", 500);
    }

    /* The balance itself. `adjust` is the CEO-only lever the entitlement
       editor already uses, so a credited day shows up wherever replacement
       leave is counted without a second mechanism to keep in step. Read and
       add rather than set, so two credits in the same year accumulate. */
    const balC = await leaveBalanceRow(env, uidC, yearC, "replacement");
    const nextAdj = Math.round(((balC.adjust ?? 0) + daysC) * 100) / 100;
    await env.DB.prepare(
      `INSERT INTO leave_balances (user_id, year, type, entitled, adjust)
       VALUES (?1, ?2, 'replacement', ?3, ?4)
       ON CONFLICT(user_id, year, type) DO UPDATE SET adjust = ?4`,
    ).bind(uidC, yearC, balC.entitled ?? 0, nextAdj).run();

    const labelC = daysC === 1 ? "a full day" : "half a day";
    await notify(env, uidC, "leave",
      `You have been credited ${labelC} of replacement leave for working ${dateC}.`,
      `replacement:${dateC}`);
    await audit(env, user.id, "leave.replacement_credit", "leave_balances", String(uidC), {
      date: dateC, days: daysC, minutes: minsC, year: yearC, adjust_to: nextAdj,
    });
    return json({ ok: true, days: daysC, adjust: nextAdj });
  }

  if (path === "/replacement-credit" && method === "DELETE") {
    if (!can(user.role, "leave_entitlement")) {
      return err("forbidden", "Only the CEO can credit replacement leave", 403);
    }
    const urlU = new URL(request.url);
    const idU = Number(urlU.searchParams.get("id"));
    if (!Number.isFinite(idU) || idU <= 0) return err("invalid_input", "id is required", 400);
    const rowU = await env.DB.prepare(
      `SELECT user_id, work_date, days FROM replacement_credits WHERE id = ?1`,
    ).bind(idU).first<{ user_id: number; work_date: string; days: number }>().catch(() => null);
    if (!rowU) return err("not_found", "No such credit", 404);
    await env.DB.prepare(`DELETE FROM replacement_credits WHERE id = ?1`).bind(idU).run();
    /* Take the same amount back off the balance. Floored at zero: if the
       entitlement was edited by hand in between, a credit undo must not push
       somebody's balance negative. */
    const yearU = Number(rowU.work_date.slice(0, 4));
    const balU = await leaveBalanceRow(env, rowU.user_id, yearU, "replacement");
    const backU = Math.max(0, Math.round(((balU.adjust ?? 0) - rowU.days) * 100) / 100);
    await env.DB.prepare(
      `INSERT INTO leave_balances (user_id, year, type, entitled, adjust)
       VALUES (?1, ?2, 'replacement', ?3, ?4)
       ON CONFLICT(user_id, year, type) DO UPDATE SET adjust = ?4`,
    ).bind(rowU.user_id, yearU, balU.entitled ?? 0, backU).run();
    await notify(env, rowU.user_id, "leave",
      `The replacement leave credited for ${rowU.work_date} has been withdrawn.`,
      `replacement:undo:${rowU.work_date}`);
    await audit(env, user.id, "leave.replacement_undo", "leave_balances", String(rowU.user_id), {
      date: rowU.work_date, days: rowU.days, adjust_to: backU,
    });
    return json({ ok: true });
  }

  /* ---- Payroll processing (v1.4.36) ----
     hr_manage (CEO now, hr_admin from next month, admin tier) writes;
     exec_view reads. Amounts stored in sen. */

  const PAYROLL_PROC = ["super_admin", "admin", "ceo", "coo"];

  /* ================= v1.75.0 — the payable-days model =================

     CEO, 30-08-2026: "I want to count for the Public Holiday that set to the
     staff, then incomplete month only for the new staff which is new joiner
     in that month. Unpaid will be count based on their no data in, then on
     unpaid I should able to deduct for half day or based on their time in...
     the working hours is 8 hours include their break time."

     WHAT WAS WRONG. Pay was reduced by two different things that both read
     the attendance clock: an "incomplete month" proration on any day not
     clocked, and the unpaid-leave deduction. Approved PAID leave was in
     neither exclusion, so a person on approved MEDICAL leave - paid by law -
     was docked for it. Nur Nasuha August 2026: 19 working days, 15 clocked,
     1 unpaid, 1 approved medical. The medical day was deducted. RM 105.26,
     silently, on a payslip that looked arithmetically tidy.

     THE MODEL NOW. Two deductions, from two sources that cannot overlap:

       incomplete month  <- EMPLOYMENT DATES only (joined_on / left_on)
       unpaid leave      <- explicitly recorded unpaid days only

     A day is payable if the person was employed on it. Attendance no longer
     reduces pay by itself: a missing punch is a question for a human, not a
     deduction (see /payroll/absences, which proposes them for one click).
     That is deliberate - the previous behaviour took money off somebody for
     a phone that died.

     Because proration keys on employment dates, an existing staff member can
     never be prorated: their employed days ARE the month's working days and
     the difference is zero. No special case, no flag - the formula is the
     rule. */

  /* WORK_DAY_MINUTES is at module scope - see the note beside it. It is read
     by /attendance/unpaid, which is routed above this point. */

  /** Every working day in a month: Mon-Fri minus the company calendar. */
  const workingDayList = async (month: string): Promise<string[]> => {
    const y = Number(month.slice(0, 4));
    const mo = Number(month.slice(5, 7));
    const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    let hol = new Set<string>();
    try {
      const { results } = await env.DB.prepare(
        `SELECT holiday_date FROM holidays WHERE holiday_date LIKE ?1 || '%'`,
      ).bind(month).all<{ holiday_date: string }>();
      hol = new Set(results.map((h) => h.holiday_date));
    } catch { /* holidays has existed since 0011 */ }
    const out: string[] = [];
    for (let d = 1; d <= last; d++) {
      const dt = new Date(Date.UTC(y, mo - 1, d));
      const dow = dt.getUTCDay();
      const iso = dt.toISOString().slice(0, 10);
      if (dow >= 1 && dow <= 5 && !hol.has(iso)) out.push(iso);
    }
    return out;
  };

  /* employedDays is at MODULE SCOPE (v1.84.0) - see the note beside it. */

  /** The incomplete-month deduction, in sen. Zero unless they joined or left
      inside this month. */
  const incompleteCents = (basicCents: number, monthDays: number, payableDays: number): number =>
    monthDays > 0 && payableDays < monthDays
      ? Math.round((basicCents * (monthDays - payableDays)) / monthDays)
      : 0;

  /** Public holidays inside a person's employment - "the Public Holiday that
      set to the staff". A joiner is credited the ones that fall after they
      started, not the whole month's. */
  const holidaysInSpan = async (month: string, joined?: string | null, left?: string | null): Promise<number> => {
    try {
      const { results } = await env.DB.prepare(
        `SELECT holiday_date FROM holidays WHERE holiday_date LIKE ?1 || '%'`,
      ).bind(month).all<{ holiday_date: string }>();
      return results.filter((h) =>
        (!joined || h.holiday_date >= joined.slice(0, 10)) &&
        (!left || h.holiday_date <= left.slice(0, 10)),
      ).length;
    } catch { return 0; }
  };

  /* ================= THE UNPAID-LEAVE DEDUCTION ==================
   *
   * CEO, 31-08-2026, on Zul Hisyam: *"should entitle 2 PH but seem like the
   * payroll make it around 5++ which is not correct!"*
   *
   * He was right, and the cause is a DIVISOR MISMATCH. Unpaid leave deducts
   * at the Employment Act's ordinary rate of pay, monthly wage / 26 - and 26
   * assumes a SIX-day week, one rest day in seven. This company works five.
   * So August has 19 working days, and somebody absent for every single one
   * of them loses only 19/26 of their salary and keeps 7/26: RM 538.46 for a
   * month in which they did nothing. Those seven days are the five Saturdays
   * and the two public holidays. His "2 PH" was exactly right and his "5++"
   * was exactly the five Saturdays.
   *
   * THE RULE HE CHOSE (of three put to him): a week in which EVERY one of
   * that person's working days is unpaid also loses that week's rest days.
   * Rest days are earned by working the week; a week nobody worked earns
   * none. It is chosen over a flat "absent all month = nothing" because it
   * has no cliff - a month that is heavily but not wholly unpaid tapers
   * instead of jumping - and over leaving it alone because leaving it alone
   * pays five Saturdays to somebody who was not there.
   *
   * PUBLIC HOLIDAYS ARE NEVER TOUCHED. Not by this rule and not by the cap
   * below. Section 60D(2) removes holiday pay only for absence WITHOUT the
   * employer's consent, and recorded unpaid leave is consented absence - so
   * the holiday stays paid. That is the whole of the CEO's "2 PH".
   *
   * AND A CAP, which is a bug fix of its own: the deduction can never take
   * the basic below the value of the public holidays inside the person's
   * employment, and incomplete-month + unpaid can no longer add up to more
   * than the basic. Before this they could, and the payslip would have
   * printed a negative net.
   *
   * ONE IMPLEMENTATION, TWO CALLERS. The payslip and /payroll/recompute both
   * come through here. Two of these written separately is two answers to
   * "what was I paid", which is the failure this codebase keeps paying for.
   * Three queries for the whole month, not three per person.
   */

  /** Monday of the week a date falls in - ISO weeks, so a week is never split
      between two months for the purpose of "was this week worked". */
  const mondayOf = (iso: string): string => {
    const d = new Date(`${iso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    return d.toISOString().slice(0, 10);
  };

  interface UnpaidBreakdown {
    /** Days of approved unpaid leave, as recorded. Fractions are real. */
    days: number;
    /** Rest days lost because their whole week was unpaid. */
    rest_days: number;
    cents: number;
    /** True when the cap bit - the deduction was reduced to protect the
        public holidays or to stop the basic going negative. */
    capped: boolean;
  }

  const unpaidResolver = async (month: string) => {
    const monthDayList = await workingDayList(month);
    const workingSet = new Set(monthDayList);
    let hols = new Set<string>();
    try {
      const { results } = await env.DB.prepare(
        `SELECT holiday_date FROM holidays WHERE holiday_date LIKE ?1 || '%'`,
      ).bind(month).all<{ holiday_date: string }>();
      hols = new Set(results.map((h) => h.holiday_date));
    } catch { /* holidays has existed since 0011 */ }
    /* Every approved unpaid day in the month, per person. The ROWS, not just
       the sum - which week a day sits in is the whole question now. */
    let rows: { user_id: number; start_date: string; end_date: string; days: number }[] = [];
    try {
      rows = (await env.DB.prepare(
        `SELECT user_id, start_date, end_date, COALESCE(days, 1) AS days FROM leave_requests
         WHERE type = 'unpaid' AND status = 'approved' AND start_date LIKE ?1 || '%'`,
      ).bind(month).all<{ user_id: number; start_date: string; end_date: string; days: number }>()).results ?? [];
    } catch { /* leave_requests has existed since 0003 */ }

    const totals = new Map<number, number>();
    /** Dates a person was unpaid for the WHOLE day. A half day means they
        worked half of it, so that week was not a week nobody worked. */
    const whole = new Map<number, Set<string>>();
    for (const r of rows) {
      totals.set(r.user_id, (totals.get(r.user_id) ?? 0) + r.days);
      const span: string[] = [];
      const d = new Date(`${r.start_date.slice(0, 10)}T00:00:00Z`);
      const end = new Date(`${(r.end_date || r.start_date).slice(0, 10)}T00:00:00Z`);
      for (let i = 0; i < 62 && d <= end; i++) {
        span.push(d.toISOString().slice(0, 10));
        d.setUTCDate(d.getUTCDate() + 1);
      }
      /* Only mark whole days when the row accounts for one full day each.
         A 2.5-day row over 3 dates marks none, which favours the employee -
         the right way to be wrong about somebody's salary. */
      if (span.length > 0 && r.days >= span.length) {
        const set = whole.get(r.user_id) ?? new Set<string>();
        for (const s of span) set.add(s);
        whole.set(r.user_id, set);
      }
    }

    return (
      userId: number,
      opts: { joined?: string | null; left?: string | null; rejoined?: string | null; orpBase: number; incompleteCents: number; phCount: number },
    ): UnpaidBreakdown => {
      const days = totals.get(userId) ?? 0;
      const orp = opts.orpBase / 26;
      if (days <= 0) return { days: 0, rest_days: 0, cents: 0, capped: false };

      /* The person's own working days, and the rest days beside them. */
      const mineDays = employedDays(monthDayList, opts.joined, opts.left, opts.rejoined);
      const fully = whole.get(userId) ?? new Set<string>();
      const workByWeek = new Map<string, string[]>();
      for (const d of mineDays) {
        const k = mondayOf(d);
        const list = workByWeek.get(k);
        if (list) list.push(d); else workByWeek.set(k, [d]);
      }
      /* A rest day is a day of the month that is neither a working day nor a
         public holiday - a Saturday or a Sunday here. Holidays are excluded
         on purpose: they are the one thing this rule must not take. */
      const restByWeek = new Map<string, number>();
      {
        const y = Number(month.slice(0, 4)), mo = Number(month.slice(5, 7));
        const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
        for (let n = 1; n <= last; n++) {
          const iso = new Date(Date.UTC(y, mo - 1, n)).toISOString().slice(0, 10);
          if (workingSet.has(iso) || hols.has(iso)) continue;
          if (opts.joined && iso < opts.joined.slice(0, 10)) continue;
          if (opts.left && iso > opts.left.slice(0, 10)) continue;
          const k = mondayOf(iso);
          restByWeek.set(k, (restByWeek.get(k) ?? 0) + 1);
        }
      }
      let restDays = 0;
      for (const [k, work] of workByWeek) {
        /* A week with no working days of theirs cannot be "a week they did
           not work" - there was nothing to work. Requiring at least one stops
           a stray weekend at the edge of the month being charged for. */
        if (work.length === 0) continue;
        if (work.every((d) => fully.has(d))) restDays += restByWeek.get(k) ?? 0;
      }

      const raw = Math.round(orp * (days + restDays));
      /* The floor under every deduction: the public holidays inside their
         employment stay paid, and incomplete-month + unpaid together can
         never exceed the basic. */
      const room = Math.max(0, opts.orpBase - opts.incompleteCents - Math.round(orp * opts.phCount));
      const cents = Math.min(raw, room);
      return { days, rest_days: restDays, cents, capped: cents < raw };
    };
  };

  /* ================= WORKING ON A PUBLIC HOLIDAY ==================
   *
   * CEO, 31-08-2026: *"if they are working on Public Holiday, then only will
   * be paid as double. if they are not working on public holiday consider
   * that they will receive 1 day of paid instead of double paid of working
   * day which is we need to follow on the regulation"*.
   *
   * Until now the payroll paid NOTHING extra for a public holiday worked. The
   * holiday itself was already inside the monthly salary - that is the "1 day
   * of paid" for not working - but a person who clocked in on Merdeka Day was
   * paid exactly the same as one who stayed home.
   *
   * THE RATE, confirmed with the CEO against the Act rather than the word
   * "double": Employment Act 1955 s.60D(3)(a)(i) - an employee who works on a
   * paid holiday is paid TWO days' wages at the ordinary rate of pay IN
   * ADDITION to the holiday pay. So one public holiday worked adds
   * 2 x (basic / 26) to that month. For a part-time hourly host the rule is
   * the Employment (Part-Time Employees) Regulations 2010: not less than two
   * times the hourly rate, so the hours on that day earn one extra RM15/h on
   * top of the RM15/h already paid for them.
   *
   * WHAT COUNTS AS WORKED: an approved clock-in (not a pending claim) on a
   * date the holiday calendar marks `public` or `replacement`. A `company` day
   * off is the company's gift, not a gazetted holiday, and carries no
   * statutory premium. Any approved clock-in counts for the whole premium -
   * s.60D(3)(a)(i) says two days' wages for working the day, not per hour.
   *
   * ONE PASS FOR THE MONTH, the same shape as unpaidResolver: every payroll
   * surface asks this, and it must never be a query per person.
   */
  interface PhWork {
    /** Public holidays inside the person's employment that they clocked in on. */
    days: number;
    /** The dates, so the payslip can name them. */
    dates: string[];
    /** Paired minutes actually clocked on those dates (for the hourly rule). */
    minutes: number;
    cents: number;
  }

  const phWorkResolver = async (month: string) => {
    const notPendingP = await notPendingSql(env);
    let phDates = new Set<string>();
    try {
      const { results } = await env.DB.prepare(
        `SELECT holiday_date FROM holidays
         WHERE holiday_date LIKE ?1 || '%' AND kind IN ('public', 'replacement')`,
      ).bind(month).all<{ holiday_date: string }>();
      phDates = new Set(results.map((h) => h.holiday_date));
    } catch { /* holidays has existed since 0011 */ }
    /* One row per person per holiday date they punched on, with the paired
       minutes. Empty when the month has no holidays or nobody worked one. */
    const byUser = new Map<number, { d: string; mins: number }[]>();
    if (phDates.size > 0) {
      try {
        const { results } = await env.DB.prepare(
          `SELECT user_id, date(created_at, '+8 hours') AS d,
                  MIN(CASE WHEN type = 'clock_in'  THEN created_at END) AS i,
                  MAX(CASE WHEN type = 'clock_out' THEN created_at END) AS o
           FROM attendance_records
           WHERE strftime('%Y-%m', created_at, '+8 hours') = ?1${notPendingP}
           GROUP BY user_id, d`,
        ).bind(month).all<{ user_id: number; d: string; i: string | null; o: string | null }>();
        for (const r of results) {
          if (!phDates.has(r.d) || !r.i) continue; // not a holiday, or no clock-in
          const mins = r.o ? Math.max(0, Math.round((new Date(r.o + "Z").getTime() - new Date(r.i + "Z").getTime()) / 60000)) : 0;
          const list = byUser.get(r.user_id) ?? [];
          list.push({ d: r.d, mins });
          byUser.set(r.user_id, list);
        }
      } catch { /* attendance_records has existed since 0002 */ }
    }
    return (
      userId: number,
      opts: { joined?: string | null; left?: string | null; rejoined?: string | null; orpBase: number; hourly: boolean },
    ): PhWork => {
      const mine = (byUser.get(userId) ?? []).filter((x) => {
        if (opts.joined && x.d < opts.joined.slice(0, 10)) return false;
        if (opts.left && x.d > opts.left.slice(0, 10)) {
          return Boolean(opts.rejoined && x.d >= opts.rejoined.slice(0, 10));
        }
        return true;
      });
      if (mine.length === 0) return { days: 0, dates: [], minutes: 0, cents: 0 };
      const minutes = mine.reduce((n, x) => n + x.mins, 0);
      const cents = opts.hourly
        /* Part-time: the hours already earned 1x; the premium is the second 1x. */
        ? Math.round((minutes * PART_TIME_LH_RATE_CENTS) / 60)
        /* Monthly: two days' ORP per holiday worked, s.60D(3)(a)(i). */
        : Math.round((opts.orpBase / 26) * 2 * mine.length);
      return { days: mine.length, dates: mine.map((x) => x.d).sort(), minutes, cents };
    };
  };

  /** Payslip side-data (v1.4.41): the month's working days, public holidays,
      approved leave, and remaining annual/medical balances — the OTHERS and
      BALANCE sections of the Malaysian payslip layout. */
  /** v1.4.80: when a payroll month's slips become visible to staff —
      the 5th of the FOLLOWING month, 10:00 MYT, shifted forward past
      weekends and public holidays (never earlier). Returns "YYYY-MM-DD 10:00"
      in MYT wall time. */
  const payslipAvailableFrom = async (month: string): Promise<string> => {
    const y = Number(month.slice(0, 4));
    const m = Number(month.slice(5, 7)); // 1-based payroll month
    const d = new Date(Date.UTC(y, m, 5)); // 5th of the NEXT month
    for (let i = 0; i < 14; i++) {
      const iso = d.toISOString().slice(0, 10);
      const dow = d.getUTCDay();
      const hol = dow !== 0 && dow !== 6
        ? await env.DB.prepare(`SELECT 1 AS x FROM holidays WHERE holiday_date = ?1`).bind(iso).first()
        : null;
      if (dow !== 0 && dow !== 6 && !hol) break;
      d.setUTCDate(d.getUTCDate() + 1);
    }
    return `${d.toISOString().slice(0, 10)} 10:00`;
  };

  const payslipExtras = async (uid: number, month: string) => {
    const notPendingX = await notPendingSql(env);
    const wd = await env.DB.prepare(
      `SELECT COUNT(DISTINCT date(created_at, '+8 hours')) AS n FROM attendance_records
       WHERE user_id = ?1 AND type = 'clock_in' AND strftime('%Y-%m', created_at, '+8 hours') = ?2${notPendingX}`,
    ).bind(uid, month).first<{ n: number }>();
    /* v1.75.0 — the person's employment dates decide their payable days and
       which public holidays are theirs. */
    const who = await env.DB.prepare(
      `SELECT joined_on, left_on, rejoined_on, base_salary_cents, role, employment_status FROM users WHERE id = ?1`,
    ).bind(uid).first<{ joined_on: string | null; left_on: string | null; rejoined_on: string | null; base_salary_cents: number; role: string; employment_status: string | null }>();
    const monthDays = await workingDayList(month);
    const mine = employedDays(monthDays, who?.joined_on, who?.left_on, who?.rejoined_on);
    const phCount = await holidaysInSpan(month, who?.joined_on, who?.left_on);
    const leaveDays = async (t: string) =>
      (await env.DB.prepare(
        `SELECT COALESCE(SUM(days), 0) AS n FROM leave_requests
         WHERE user_id = ?1 AND type = ?2 AND status = 'approved' AND start_date LIKE ?3 || '%'`,
      ).bind(uid, t, month).first<{ n: number }>())?.n ?? 0;
    // Balances: same accrual rules as /leave/balance (annual accrues monthly
    // from the company-start window; medical is statutory-full).
    const year = Number(month.slice(0, 4));
    const monthNum = Number(month.slice(5, 7));
    /* v1.62.0 — the SAME rule the Leave tab uses (leaveAccrual, top of file),
       including the CEO's adjustment. Before this the two were written out
       separately and an adjustment made on the Leave tab would not have
       reached the payslip — a number about pay disagreeing with itself. */
    const bal = async (t: string) => {
      const row = await leaveBalanceRow(env, uid, year, t);
      // Usage counted only up to the END of the payroll month — the slip
      // reflects that month's eligibility, not the day it was printed.
      const used = await env.DB.prepare(
        `SELECT COALESCE(SUM(days), 0) AS used FROM leave_requests
         WHERE user_id = ?1 AND type = ?2 AND status = 'approved'
         AND start_date LIKE ?3 || '%' AND start_date <= ?4`,
      ).bind(uid, t, String(year), `${month}-31`).first<{ used: number }>();
      const entitled = row.entitled ?? DEFAULT_ENTITLEMENT[t] ?? 0;
      const accrued = leaveAccrual(t, entitled, year, monthNum, row.adjust ?? 0);
      return Math.max(0, accrued - ((used?.used ?? 0) + (row.used_adjust ?? 0)));
    };
    // v1.4.79: unpaid leave now appears as an EXPLICIT payslip deduction —
    // basic stays full and the slip shows why the pay is lower (fairness).
    // Rate follows the Employment Act 1955 s.60I ordinary rate of pay:
    // monthly wages ÷ 26 per day. Emergency leave is PAID (own 3-day
    // entitlement, common Malaysian practice) — shown in OTHERS, never
    // deducted.
    const unpaidDays = await leaveDays("unpaid");
    const emergencyDays = await leaveDays("emergency");
    let orpBase = (await env.DB.prepare(
      `SELECT base_salary_cents FROM users WHERE id = ?1`,
    ).bind(uid).first<{ base_salary_cents: number }>())?.base_salary_cents ?? 0;
    if (!orpBase) {
      orpBase = (await env.DB.prepare(
        `SELECT basic_cents FROM payroll_entries WHERE user_id = ?1 AND month = ?2`,
      ).bind(uid, month).first<{ basic_cents: number }>())?.basic_cents ?? 0;
    }
    /* The incomplete-month figure is computed HERE, once, and the payslip
       and the payroll panel both print this number rather than each deriving
       their own. Three copies of one sum is how they drift. */
    let incBase = who?.base_salary_cents ?? 0;
    if (!incBase) {
      incBase = (await env.DB.prepare(
        `SELECT basic_cents FROM payroll_entries WHERE user_id = ?1 AND month = ?2`,
      ).bind(uid, month).first<{ basic_cents: number }>())?.basic_cents ?? 0;
    }
    const incompleteDed = incompleteCents(incBase, monthDays.length, mine.length);
    /* v1.77.0 — the week rule, the public-holiday floor and the cap, all in
       the one place /payroll/recompute also calls. */
    const unpaidAt = await unpaidResolver(month);
    const ub = unpaidAt(uid, {
      joined: who?.joined_on, left: who?.left_on, rejoined: who?.rejoined_on,
      orpBase, incompleteCents: incompleteDed, phCount,
    });
    const unpaidDeduction = ub.cents;
    /* v1.77.0 — two days' ORP for each public holiday actually worked
       (s.60D(3)(a)(i)); for a part-time hourly host, a second RM15/h on the
       hours of that day. Read the note above phWorkResolver. */
    const phAt = await phWorkResolver(month);
    const pw = phAt(uid, {
      joined: who?.joined_on, left: who?.left_on, rejoined: who?.rejoined_on,
      orpBase,
      hourly: who?.role === "live_host" && who?.employment_status === "part_time",
    });
    return {
      working_day: wd?.n ?? 0,
      /* v1.75.0: what the month owed them, and what it owes a mid-month
         joiner or leaver. Equal for everybody else. */
      month_working_days: monthDays.length,
      payable_days: mine.length,
      joined_on: who?.joined_on ?? null,
      left_on: who?.left_on ?? null,
      incomplete_deduction_cents: incompleteDed,
      public_holiday: phCount,
      /* v1.77.0 — what the deduction is MADE OF, so the payslip can say it
         rather than print one number and hope. */
      /* v1.77.0 — the premium for working a public holiday, and which ones. */
      ph_worked: pw.days,
      ph_worked_dates: pw.dates,
      ph_worked_minutes: pw.minutes,
      ph_worked_cents: pw.cents,
      unpaid_rest_days: ub.rest_days,
      unpaid_capped: ub.capped,
      /* The contradiction the CEO found on Nurfarah: employed for 9 working
         days, clocked in on 12. Both cannot be true; the payroll surfaces it
         rather than quietly charging for the difference. */
      clocked_beyond_employment: (wd?.n ?? 0) > mine.length,
      annual_leave: await leaveDays("annual"),
      medical_leave: await leaveDays("medical"),
      emergency_leave: emergencyDays,
      unpaid_leave: unpaidDays,
      unpaid_deduction_cents: unpaidDeduction,
      annual_bal: await bal("annual"),
      sick_bal: await bal("medical"),
    };
  };

  // Every staff member can view (and print) their OWN payslip — never edit.
  if (path === "/payroll/self" && method === "GET") {
    const url0 = new URL(request.url);
    const m0 = url0.searchParams.get("month") ?? new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 7);
    // v1.4.80: a month's slip is visible only from the release moment (5th of
    // the next month, 10:00 MYT, next working day if that's a holiday or
    // weekend) — or once the month is manually released.
    // v1.4.83: NO exceptions — the CEO's instruction is that "My payslip" is
    // locked for EVERYONE before release, payroll processors included. (The
    // Payroll processing tab necessarily still shows figures to processors —
    // they type them there; this lock governs the payslip view itself.)
    /* v1.28.0: the slip's employer of record is the issuer stamped on the
       month's release row (payslip_releases.issuer_code, migration 0073) —
       returned so "My payslip" prints the same letterhead the processors'
       panel does. NULL / no row = legacy month = AZ ONE OFFICIAL at the
       renderer (resolveIssuer, lib/issuers.ts). Wrapped for 0073 skew like
       the release route — a pre-0073 database reports no stamp instead of
       500ing the staff payslip view. */
    let releaseIssuerCode: string | null = null;
    {
      const availableFrom = await payslipAvailableFrom(m0);
      let released: { released_at: string; issuer_code?: string | null } | null = null;
      try {
        released = await env.DB.prepare(
          `SELECT released_at, issuer_code FROM payslip_releases WHERE month = ?1`,
        ).bind(m0).first<{ released_at: string; issuer_code: string | null }>();
      } catch {
        released = await env.DB.prepare(
          `SELECT released_at FROM payslip_releases WHERE month = ?1`,
        ).bind(m0).first<{ released_at: string }>();
      }
      releaseIssuerCode = released?.issuer_code ?? null;
      const nowMyt = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 16).replace("T", " ");
      if (!released && nowMyt < availableFrom) {
        return json({ month: m0, entry: null, extras: null, locked: true, available_from: availableFrom });
      }
    }
    const entry = await env.DB.prepare(
      `SELECT p.*, u.name, u.full_name, u.employee_id, u.position, u.department,
              u.employment_status, u.bank_name, u.bank_account, u.joined_on, u.ic_number
       FROM payroll_entries p JOIN users u ON u.id = p.user_id
       WHERE p.user_id = ?1 AND p.month = ?2`,
    ).bind(user.id, m0).first();
    const joined = await env.DB.prepare(`SELECT joined_on FROM users WHERE id = ?1`)
      .bind(user.id).first<{ joined_on: string | null }>();
    return json({
      month: m0,
      entry: entry ?? null,
      extras: entry ? await payslipExtras(user.id, m0) : null,
      joined_on: joined?.joined_on ?? null,
      release_issuer_code: releaseIssuerCode, // v1.28.0 — employer of record
    });
  }

  /* v1.4.183 (CEO): PART-TIME LIVE HOSTS are paid RM15.00/hour on their
     clocked time — first clock-in to last clock-out per MYT day, summed for
     the month. Contract/permanent live hosts stay on the salary model (and
     keep OT eligibility; part-time never had it). One helper feeds the GET
     view, the save route and the recompute button — single source of truth. */
  /* PART_TIME_LH_RATE_CENTS and isHourlyUser are at module scope (v1.77.0,
     v1.78.0) - see the notes beside them. */
  /* v1.80.0 — THE GAP IN A SPLIT DAY IS NOT PAID.
   *
   * The CEO chose one clock-in and one clock-out for a split day, so a host
   * on 11:00-17:00 plus 20:30-22:30 punches in at 11:00 and out at 22:30.
   * Last-out minus first-in reads 11.5 hours; he worked 8. The three and a
   * half hours in between he spent at home, and at RM15/h that gap was
   * RM 52.50 a day of pay for being away.
   *
   * So the span is INTERSECTED with what the person was actually due to be
   * doing: their scheduled blocks, plus any live session or roster block that
   * covers time outside them (the CEO's *"if yes, then it is consider their
   * working time"*).
   *
   * THE FALLBACK MATTERS AS MUCH AS THE RULE. When there is nothing to
   * intersect with — a rest day worked, an unassigned evening, a database
   * that has not applied 0099 — the whole span counts, exactly as it did
   * before. A schedule the system cannot read must never silently zero
   * somebody's wage.
   *
   * Both figures are returned. A change that quietly reduces a payslip is
   * the kind this system has been burned by, so the panel shows "clocked
   * 11h30 -> counted 8h00" and says why, rather than a smaller number with
   * no explanation.
   */
  let shiftAtP: ShiftLookup | null = null;
  let assignedAtP: AssignedLookup | null = null;
  const clockedMinutes = async (
    userId: number,
    month: string,
  ): Promise<{ counted: number; clocked: number; trimmed: number }> => {
    /* An unapproved punch pays nobody - this is an hourly host's wage. */
    const notPending = await notPendingSql(env);
    const { results } = await env.DB.prepare(
      `SELECT date(created_at, '+8 hours') AS d,
              MIN(CASE WHEN type = 'clock_in'  THEN created_at END) AS i,
              MAX(CASE WHEN type = 'clock_out' THEN created_at END) AS o
       FROM attendance_records
       WHERE user_id = ?1 AND strftime('%Y-%m', created_at, '+8 hours') = ?2${notPending}
       GROUP BY d`,
    ).bind(userId, month).all<{ d: string; i: string | null; o: string | null }>();
    /* Read once and reused across every hourly person in the run — this
       helper is itself called inside a loop over staff (v1.77.0 rule). */
    shiftAtP ??= await shiftResolver(env);
    assignedAtP ??= await assignedResolver(env, `${month}-01`, `${month}-31`);
    let counted = 0;
    let clocked = 0;
    for (const r of results) {
      if (!r.i || !r.o) continue; // an unpaired day earns nothing until fixed
      const inM = new Date(r.i + "Z").getTime();
      const outM = new Date(r.o + "Z").getTime();
      const span = Math.round((outM - inM) / 60000);
      if (span <= 0) continue;
      clocked += span;
      const mytMin = (ms: number) => {
        const d = new Date(ms + 8 * 3600 * 1000);
        return d.getUTCHours() * 60 + d.getUTCMinutes();
      };
      const from = mytMin(inM);
      const to = from + span; // may run past midnight; the windows simply stop
      const sh = shiftAtP(userId, r.d);
      let day = minutesInWindows(sh, from, to);
      /* Assigned work outside the pattern counts too, and only the part of it
         that is both inside the punch span AND outside the scheduled blocks —
         so an evening session that overlaps a scheduled block is never paid
         twice. */
      for (let m = from; m < to; m++) {
        if (windowAt(sh, m)) continue;
        if (assignedAtP(userId, r.d, m)) day++;
      }
      counted += day > 0 ? day : span;
    }
    return { counted, clocked, trimmed: Math.max(0, clocked - counted) };
  };
  const hourlyPayCents = (mins: number) => Math.round((mins * PART_TIME_LH_RATE_CENTS) / 60);

  if (path === "/payroll" && method === "GET") {
    // Full payroll is for the processors only (v1.4.40): CEO and COO run it,
    // admin tier as backstop. hr_admin and CCO no longer see other people's pay.
    if (!PAYROLL_PROC.includes(user.role)) {
      return err("forbidden", "Payroll access required", 403);
    }
    const url = new URL(request.url);
    const month = url.searchParams.get("month") ?? new Date().toISOString().slice(0, 7);
    const { results } = await env.DB.prepare(
      `SELECT p.*, u.name, u.full_name, u.employee_id, u.position, u.department,
              u.employment_status, u.role AS user_role, u.bank_name, u.bank_account, u.ic_number
       FROM payroll_entries p JOIN users u ON u.id = p.user_id
       WHERE p.month = ?1 ORDER BY ${STAFF_ORDER_SQL}`,
    ).bind(month).all();
    // v1.4.183: hourly users get live clocked minutes so the panel shows the
    // CURRENT month figure even before the entry is saved/recomputed.
    for (const r of results as Record<string, unknown>[]) {
      if (isHourlyUser(r.user_role as string, r.employment_status as string)) {
        const cm = await clockedMinutes(r.user_id as number, month);
        r.hourly_minutes_live = cm.counted;
        /* v1.80.0 — what the clock said, and how much of it was off-schedule.
           Shown beside the figure so a smaller number than last month is
           explainable without opening the register. */
        r.hourly_clocked_live = cm.clocked;
        r.hourly_trimmed_live = cm.trimmed;
        r.hourly_rate_live = PART_TIME_LH_RATE_CENTS;
        r.hourly_pay_live = hourlyPayCents(cm.counted);
      }
    }
    const releasedRow = await env.DB.prepare(
      `SELECT released_at, released_by, issuer_code FROM payslip_releases WHERE month = ?1`,
    ).bind(month).first<{ released_at: string; released_by: number; issuer_code: string | null }>()
      .catch(async () => await env.DB.prepare(
        `SELECT released_at, released_by FROM payslip_releases WHERE month = ?1`,
      ).bind(month).first<{ released_at: string; released_by: number }>() as never);
    return json({
      month, entries: results,
      release: {
        available_from: await payslipAvailableFrom(month),
        released: releasedRow ?? null,
        /* v1.85.0 — the letterhead these payslips WILL carry, named on the
           panel before they go out. It was only discoverable by opening a
           rendered PDF, which is how a month of slips went out under the
           wrong entity without anybody noticing. Shown for an unreleased
           month too, as the employer it would be released under. */
        employer: issuerName(releasedRow?.issuer_code ?? (releasedRow ? null : OPERATING_ISSUER_CODE)),
        employer_is_legacy: Boolean(releasedRow) && !releasedRow.issuer_code,
      },
    });
  }
  if (path === "/payroll/paid" && method === "POST") {
    // v1.4.101: the Expenses "Payments due" card records that the payroll
    // bank run for a month has been DONE.
    if (!can(user.role, "expenses")) return err("forbidden", "Expenses access required", 403);
    const mP = typeof body?.month === "string" && /^\d{4}-\d{2}$/.test(body.month) ? body.month : null;
    if (!mP) return err("invalid_input", "month (YYYY-MM) is required", 400);
    await env.DB.prepare(
      `INSERT INTO payroll_payments (month, paid_by) VALUES (?1, ?2) ON CONFLICT(month) DO NOTHING`,
    ).bind(mP, user.id).run();
    // v1.19.0 C2: the salary run becomes ONE bank movement for the month.
    try {
      const net = await env.DB.prepare(
        `SELECT COALESCE(SUM(net_cents), 0) AS n FROM payroll_entries WHERE month = ?1`,
      ).bind(mP).first<{ n: number }>();
      await recordBankMovement(env, user.id, `PAYROLL-${mP}`, net?.n ?? 0, "salaries", `Payroll bank run ${mP}`);
    } catch { /* pre-0041 net_cents */ }
    await audit(env, user.id, "payroll.paid", "payroll_payments", mP);
    return json({ ok: true });
  }
  if (path === "/payroll/pull-commission" && method === "POST") {
    /* v1.19.0 (consolidation C3) — closes the DOUBLE-PAYMENT path. Approved
       commission entries for the month flow into payroll_entries.commission_cents
       and are marked paid in the same pass; a second click finds nothing
       approved and applies nothing. Entries without a payroll row are
       reported back, not silently dropped. */
    /* v1.45.0 (security audit S1) — this route MOVES MONEY: it adds approved
       commission into payroll_entries and marks the commission settled. It
       was the only payroll write gated by `payroll_export`, which also
       admits hr_admin and cco — the two roles deliberately removed from
       payroll at v1.4.x ("hr_admin and CCO no longer see other people's
       pay", see the /payroll guard above). A read permission was standing in
       for a write permission. It now uses the same PAYROLL_PROC set as every
       other payroll mutation. */
    if (!PAYROLL_PROC.includes(user.role)) return err("forbidden", "Payroll access required", 403);
    const mC = typeof body?.month === "string" && /^\d{4}-\d{2}$/.test(body.month) ? body.month : null;
    if (!mC) return err("invalid_input", "month (YYYY-MM) is required", 400);
    const entries = await env.DB.prepare(
      `SELECT e.id, e.host_id, e.amount_cents, COALESCE(NULLIF(TRIM(u.full_name), ''), u.name) AS name
         FROM commission_entries e JOIN users u ON u.id = e.host_id
        WHERE e.period = ?1 AND e.status = 'approved'`,
    ).bind(mC).all<{ id: number; host_id: number; amount_cents: number; name: string }>().catch(() => ({ results: [] as { id: number; host_id: number; amount_cents: number; name: string }[] }));
    const applied: { name: string; amount_cents: number }[] = [];
    const skipped: string[] = [];
    for (const e of entries.results ?? []) {
      const upd = await env.DB.prepare(
        `UPDATE payroll_entries SET commission_cents = commission_cents + ?1 WHERE user_id = ?2 AND month = ?3`,
      ).bind(e.amount_cents, e.host_id, mC).run();
      if (upd.meta.changes) {
        await env.DB.prepare(`UPDATE commission_entries SET status = 'paid' WHERE id = ?1`).bind(e.id).run();
        applied.push({ name: e.name, amount_cents: e.amount_cents });
      } else {
        skipped.push(e.name); // no payroll row for that person+month yet
      }
    }
    if (applied.length) await audit(env, user.id, "payroll.pull_commission", "payroll_entries", mC,
      { applied: applied.length, total: applied.reduce((a, x) => a + x.amount_cents, 0) });
    return json({ applied, skipped });
  }
  if (path === "/payroll/release" && method === "POST") {
    // Early manual release for a month (e.g. the 5th falls badly and the
    // CEO decides to release before the automatic moment). Audited.
    // v1.4.210 (CEO caught the flow bug — he released 08-2026 while the
    // run being PAID in early August is July's): body { undo: true }
    // deletes an early release so the automatic 5th-of-next-month gate
    // resumes. After the automatic moment, undo is a no-op for staff
    // visibility — the gate is open regardless of the override row.
    if (!PAYROLL_PROC.includes(user.role)) return err("forbidden", "Payroll access required", 403);
    const mR = typeof body?.month === "string" && /^\d{4}-\d{2}$/.test(body.month) ? body.month : null;
    if (!mR) return err("invalid_input", "month (YYYY-MM) is required", 400);
    if (body?.undo === true) {
      await env.DB.prepare(`DELETE FROM payslip_releases WHERE month = ?1`).bind(mR).run();
      await audit(env, user.id, "payroll.release_undo", "payslip_releases", mR);
      return json({ ok: true });
    }
    /* v1.28.0: the payslip's employer of record is decided at RELEASE time —
       months released after the A2Z switch are A2Z payslips; already-released
       months keep NULL and render as AZ ONE OFFICIAL forever. */
    /* v1.85.0 — THE FALLBACK IS WHY HIS AUGUST PAYSLIP SAID AZ ONE.
       The catch below exists for a database that has not applied 0073, and it
       inserts the row with NO issuer_code. A month released in that window
       records NULL — not because it was an AZ ONE month, but because the
       column was not there to write to — and NULL renders as AZ ONE OFFICIAL
       forever, with nothing on any screen to say why.
       It still cannot 500 the release, because a payslip nobody can see is
       worse than one with the wrong letterhead. But it no longer passes in
       silence: the response says which employer was recorded, the panel
       prints it, and the audit log carries the failure. */
    let stamped: string | null = OPERATING_ISSUER_CODE;
    try {
      await env.DB.prepare(
        `INSERT INTO payslip_releases (month, released_by, issuer_code) VALUES (?1, ?2, ?3)
         ON CONFLICT(month) DO NOTHING`,
      ).bind(mR, user.id, OPERATING_ISSUER_CODE).run();
    } catch (eRel) {
      stamped = null;
      await env.DB.prepare(
        `INSERT INTO payslip_releases (month, released_by) VALUES (?1, ?2)
         ON CONFLICT(month) DO NOTHING`,
      ).bind(mR, user.id).run();
      await audit(env, user.id, "payroll.release_unstamped", "payslip_releases", mR, {
        why: String(eRel).slice(0, 200),
        consequence: "no employer of record recorded - these payslips will render as AZ ONE OFFICIAL until 0073 is applied and the row corrected",
      });
    }
    await audit(env, user.id, "payroll.release", "payslip_releases", mR, { issuer_code: stamped });
    /* The month may already have been released - ON CONFLICT DO NOTHING - so
       the truthful answer is what the ROW says, not what we tried to write. */
    let onRow: string | null = null;
    try {
      onRow = (await env.DB.prepare(`SELECT issuer_code FROM payslip_releases WHERE month = ?1`)
        .bind(mR).first<{ issuer_code: string | null }>())?.issuer_code ?? null;
    } catch { /* pre-0073 */ }
    return json({ ok: true, issuer_code: onRow, employer: issuerName(onRow) });
  }
  if (path === "/payroll/base" && method === "GET") {
    // v1.4.78: fixed basic salaries — the source Payroll auto-fills from.
    if (!PAYROLL_PROC.includes(user.role)) return err("forbidden", "Payroll access required", 403);
    const { results } = await env.DB.prepare(
      `SELECT id AS user_id, base_salary_cents FROM users
       WHERE role NOT IN ('customer', 'super_admin') AND is_active = 1 AND ${currentStaffSql()}`,
    ).all();
    return json({ base: results });
  }
  if (path === "/payroll/base" && method === "POST") {
    // Set / adjust one person's fixed basic (increments happen here).
    if (!PAYROLL_PROC.includes(user.role)) return err("forbidden", "Payroll access required", 403);
    const uid = Number(body?.user_id);
    const cents = Math.round(Number(body?.base_salary_cents));
    if (!uid || !Number.isFinite(cents) || cents < 0 || cents > 100000000) {
      return err("invalid_input", "user_id and a non-negative base_salary_cents are required", 400);
    }
    await env.DB.prepare(`UPDATE users SET base_salary_cents = ?1 WHERE id = ?2`).bind(cents, uid).run();
    await audit(env, user.id, "payroll.base_update", "users", String(uid), { base_salary_cents: cents });
    return json({ ok: true });
  }
  if (path === "/payroll/attendance-days" && method === "GET") {
    // v1.4.77: auto-calculation source — how many distinct days each staff
    // member clocked in during the month (MYT dates). Payroll fills the
    // "days worked" inputs from this; the inputs STAY editable so a wrong or
    // dishonest punch can be overridden (and permanently corrected in
    // Attendance → corrections & back-entry).
    if (!PAYROLL_PROC.includes(user.role)) return err("forbidden", "Payroll access required", 403);
    const urlA = new URL(request.url);
    const mA = urlA.searchParams.get("month") ?? new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 7);
    /* v1.87.0 — this month reached three queries straight from the query
       string, unchecked. It decides which month's salary is computed. */
    if (!/^\d{4}-\d{2}$/.test(mA)) return err("invalid_input", "month must be YYYY-MM", 400);
    const notPendingA = await notPendingSql(env);
    const { results } = await env.DB.prepare(
      `SELECT user_id, COUNT(DISTINCT date(created_at, '+8 hours')) AS days
       FROM attendance_records
       WHERE type = 'clock_in' AND strftime('%Y-%m', created_at, '+8 hours') = ?1${notPendingA}
       GROUP BY user_id`,
    ).bind(mA).all<{ user_id: number; days: number }>();
    // v1.4.79: approved unpaid-leave days too — the panel flags them so the
    // processor knows the payslip will auto-deduct (and doesn't double-deduct).
    const { results: unpaid } = await env.DB.prepare(
      `SELECT user_id, COALESCE(SUM(days), 0) AS days FROM leave_requests
       WHERE type = 'unpaid' AND status = 'approved' AND start_date LIKE ?1 || '%'
       GROUP BY user_id`,
    ).bind(mA).all<{ user_id: number; days: number }>();
    // v1.4.84: the month's TRUE working-day count, computed — Mon–Fri minus
    // every holiday on the calendar (public, replacement and company days).
    // This is what "working days" means on the payslip; July 2026 = 22
    // (23 weekdays − Hari Hol 21-07), NOT a blanket 26. The statutory ÷26
    // used for unpaid leave is a separate, fixed Employment Act rate.
    const yA = Number(mA.slice(0, 4));
    const moA = Number(mA.slice(5, 7));
    const lastDay = new Date(Date.UTC(yA, moA, 0)).getUTCDate();
    const { results: hols } = await env.DB.prepare(
      `SELECT holiday_date FROM holidays WHERE holiday_date LIKE ?1 || '%'`,
    ).bind(mA).all<{ holiday_date: string }>();
    const holSet = new Set(hols.map((h) => h.holiday_date));
    let workingDays = 0;
    for (let d = 1; d <= lastDay; d++) {
      const dt = new Date(Date.UTC(yA, moA - 1, d));
      const dow = dt.getUTCDay();
      if (dow >= 1 && dow <= 5 && !holSet.has(dt.toISOString().slice(0, 10))) workingDays++;
    }
    /* v1.75.0 — how many of the month's working days each person was
       EMPLOYED for. Equal to working_days for everybody except a mid-month
       joiner or leaver, and it is what the panel prorates on: the browser no
       longer derives proration from the attendance clock, because that is
       what was deducting approved paid leave. */
    const dayListA = await workingDayList(mA);
    const { results: peopleA } = await env.DB.prepare(
      /* v1.87.0 — a leaver stays on the payroll of every month they worked
         (their final salary depends on it) and drops off the moment the run
         moves past it. The CEO: "payroll after their payroll released". */
      `SELECT id, joined_on, left_on, rejoined_on FROM users
        WHERE ${staffRolesSql()} AND is_active = 1 AND ${payrollMonthStaffSql(mA)}`,
    ).all<{ id: number; joined_on: string | null; left_on: string | null; rejoined_on: string | null }>();
    const employed = peopleA.map((u) => ({
      user_id: u.id,
      payable_days: employedDays(dayListA, u.joined_on, u.left_on, u.rejoined_on).length,
      partial: Boolean(
        (u.joined_on && u.joined_on.slice(0, 7) === mA) || (u.left_on && u.left_on.slice(0, 7) === mA),
      ),
    }));

    /* v1.77.0 — THE DEDUCTION ITSELF, computed here rather than in the
       browser. The panel used to re-derive `base / 26 * days` at three
       separate call sites; the week rule and the public-holiday floor would
       have had to be written into all three, and the first one anybody
       forgot would be a row whose total disagreed with its own payslip.
       The panel now prints this number, exactly as it already does for the
       incomplete-month figure. */
    const unpaidAtA = await unpaidResolver(mA);
    const phAtA = await phWorkResolver(mA);
    const { results: basesA } = await env.DB.prepare(
      `SELECT id, base_salary_cents, role, employment_status FROM users
        WHERE ${staffRolesSql()} AND is_active = 1 AND ${payrollMonthStaffSql(mA)}`,
    ).all<{ id: number; base_salary_cents: number | null; role: string; employment_status: string | null }>();
    const baseMapA = new Map(basesA.map((b) => [b.id, b.base_salary_cents ?? 0]));
    const hourlyA = new Set(basesA.filter((b) => b.role === "live_host" && b.employment_status === "part_time").map((b) => b.id));
    const clockedA = new Map(results.map((r) => [r.user_id, r.days]));
    const unpaidDetail = peopleA.map((u) => {
      const payable = employedDays(dayListA, u.joined_on, u.left_on, u.rejoined_on).length;
      const basic = baseMapA.get(u.id) ?? 0;
      const ph = holSet.size === 0 ? 0 : [...holSet].filter((h) =>
        (!u.joined_on || h >= u.joined_on.slice(0, 10)) &&
        (!u.left_on || h <= u.left_on.slice(0, 10))).length;
      const b = unpaidAtA(u.id, {
        joined: u.joined_on, left: u.left_on, rejoined: u.rejoined_on, orpBase: basic,
        incompleteCents: incompleteCents(basic, dayListA.length, payable),
        phCount: ph,
      });
      /* v1.77.0 — the premium for working a public holiday, from the same
         resolver the payslip and recompute use. */
      const pw = phAtA(u.id, {
        joined: u.joined_on, left: u.left_on, rejoined: u.rejoined_on,
        orpBase: basic, hourly: hourlyA.has(u.id),
      });
      return {
        user_id: u.id, days: b.days, rest_days: b.rest_days,
        cents: b.cents, capped: b.capped,
        ph_worked: pw.days, ph_worked_dates: pw.dates, ph_worked_cents: pw.cents,
        /* The contradiction the CEO found: more days clocked than the
           person was employed for. Nothing can make both true. */
        clocked_beyond_employment: (clockedA.get(u.id) ?? 0) > payable,
        clocked_days: clockedA.get(u.id) ?? 0,
        payable_days: payable,
      };
    }).filter((r) => r.days > 0 || r.clocked_beyond_employment || r.ph_worked > 0);

    return json({ month: mA, days: results, unpaid, unpaid_detail: unpaidDetail, working_days: workingDays, employed });
  }

  /* v1.75.0 (CEO: "Unpaid will be count based on their no data in") — the
     days that LOOK unpaid, offered for one click.

     Deliberately a proposal and not a deduction. A working day with no
     clock-in is a question: a client visit, a shoot, a phone that died, a
     leave form still in somebody bag. Turning that silence into money off a
     payslip automatically is the one thing this system must not do - so the
     scan finds them, and a person decides. */
  if (path === "/payroll/absences" && method === "GET") {
    if (!PAYROLL_PROC.includes(user.role)) return err("forbidden", "Payroll access required", 403);
    const urlA2 = new URL(request.url);
    const mA2 = urlA2.searchParams.get("month") ??
      new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(mA2)) return err("invalid_input", "month must be YYYY-MM", 400);
    const dayList = await workingDayList(mA2);
    const todayMyt = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);

    const { results: staffA } = await env.DB.prepare(
      `SELECT id, name, full_name, joined_on, left_on, rejoined_on, role, employment_status
       FROM users WHERE ${staffRolesSql()} AND is_active = 1 AND ${payrollMonthStaffSql(mA2)}`,
    ).all<{ id: number; name: string; full_name: string | null; joined_on: string | null; left_on: string | null; rejoined_on: string | null; role: string; employment_status: string | null }>();

    /* One row per person per day, with the minutes actually clocked. */
    /* A punch waiting for approval is not evidence that somebody was here -
       if it were, a forgotten-punch claim would quietly cancel the very
       absence it is claiming about. */
    const notPendingS = await notPendingSql(env);
    const { results: att } = await env.DB.prepare(
      `SELECT user_id, date(created_at, '+8 hours') AS d,
              MIN(CASE WHEN type = 'clock_in'  THEN created_at END) AS i,
              MAX(CASE WHEN type = 'clock_out' THEN created_at END) AS o
       FROM attendance_records
       WHERE strftime('%Y-%m', created_at, '+8 hours') = ?1${notPendingS}
       GROUP BY user_id, d`,
    ).bind(mA2).all<{ user_id: number; d: string; i: string | null; o: string | null }>();
    const clocked = new Map<string, { i: string | null; o: string | null }>();
    for (const a of att) clocked.set(`${a.user_id}|${a.d}`, { i: a.i, o: a.o });

    /* Any approved leave covers the day - paid or unpaid. A day already
       covered is not a question. */
    const { results: lv } = await env.DB.prepare(
      `SELECT user_id, type, start_date, end_date FROM leave_requests
       WHERE status = 'approved' AND start_date <= ?1 || '-31' AND end_date >= ?1 || '-01'`,
    ).bind(mA2).all<{ user_id: number; type: string; start_date: string; end_date: string }>();

    /* v1.77.0 — read the whole schedule once, BEFORE the two nested loops
       below. Resolving it per (person, day) inside them was two database
       round trips per iteration, which is what made the Payroll tab sit at
       "0 staff" for the better part of a minute. */
    const shiftAtA = await shiftResolver(env);
    const out: { user_id: number; name: string; missing: string[]; short: { d: string; hours: number }[] }[] = [];
    for (const u of staffA) {
      /* Hourly part-timers are paid by the clock already - a day they did not
         work is simply a day they are not paid for, not a deduction. */
      if (isHourlyUser(u.role, u.employment_status)) continue;
      const mineDays = employedDays(dayList, u.joined_on, u.left_on, u.rejoined_on).filter((d) => d <= todayMyt);
      const missing: string[] = [];
      const short: { d: string; hours: number; of: number; break_minutes: number }[] = [];
      for (const d of mineDays) {
        if (lv.some((l) => l.user_id === u.id && l.start_date <= d && l.end_date >= d)) continue;
        /* v1.76.0 — THEIR hours, not one company constant. A person on a
           pattern that does not work this day is not absent from it, and
           somebody on 11:00-19:00 is measured against eight of their own
           hours, not against a day that ended at 18:00. */
        const shD = shiftAtA(u.id, d);
        if (shD.kind === "rest_day") continue;
        /* v1.80.0 — BOTH blocks. On a split day this read the first block
           only: 11:00-17:00 of an 11:00-17:00 plus 20:30-22:30 day, so the
           scan measured a six-hour day against somebody who owed eight and
           found nobody short, ever. */
        /* v1.81.0 (CEO: "this one should exclude of lunch time of 1 hour") -
           the hours OWED, which is the schedule minus the unpaid break. An
           office day of 10:00-18:00 is eight hours on the clock and seven of
           work, and everybody owed seven was being judged against eight. */
        const scheduled = workMinutes(shD) || WORK_DAY_MINUTES;
        const c = clocked.get(`${u.id}|${d}`);
        if (!c || !c.i) { missing.push(d); continue; }
        if (!c.o) continue; // still open or never clocked out - not a pay question
        const span = Math.round((new Date(c.o + "Z").getTime() - new Date(c.i + "Z").getTime()) / 60000);
        /* And the time actually inside those blocks, for the same reason the
           hourly wage counts the overlap: 11:00 to 22:30 is 11.5 hours of
           elapsed time and 8 hours of work, and comparing 11.5 against a
           scheduled 8 would report a short day as a long one. Falls back to
           the span when there is nothing to intersect with. */
        const mytOf = (iso: string) => {
          const t = new Date(new Date(iso + "Z").getTime() + 8 * 3600 * 1000);
          return t.getUTCHours() * 60 + t.getUTCMinutes();
        };
        const fromD = mytOf(c.i);
        const inside = minutesInWindows(shD, fromD, fromD + span);
        const mins = inside > 0 ? inside : span;
        /* A quarter of the scheduled day is the smallest thing worth raising -
           below that this becomes a list of people who left ten minutes
           early, which is a conversation, not a payroll line. */
        if (mins > 0 && scheduled - mins >= scheduled / 4) {
          short.push({
            d,
            hours: Math.round((mins / 60) * 100) / 100,
            of: Math.round((scheduled / 60) * 100) / 100,
            /* Sent so the chip can say WHY the target is seven and not eight
               without the browser re-deriving a rule the server owns. */
            break_minutes: breakFor(shD),
          });
        }
      }
      if (missing.length || short.length) {
        out.push({ user_id: u.id, name: u.full_name || u.name, missing, short });
      }
    }
    return json({ month: mA2, work_day_hours: WORK_DAY_MINUTES / 60, staff: out });
  }

  if (path === "/payroll/detail" && method === "GET") {
    if (!PAYROLL_PROC.includes(user.role)) return err("forbidden", "Payroll access required", 403);
    const urlD = new URL(request.url);
    const uid = Number(urlD.searchParams.get("user_id"));
    const mD = urlD.searchParams.get("month") ?? new Date().toISOString().slice(0, 7);
    if (!uid) return err("invalid_input", "user_id is required", 400);
    return json({ extras: await payslipExtras(uid, mD) });
  }

  if (path === "/payroll/m2e-settings" && method === "GET") {
    // v1.4.203: one-time M2E setup — Corporate ID + payer account (CEO asked
    // to store them so the button emits a fully-filled workbook). The M2E
    // USER ID and password are login credentials and are NEVER stored.
    if (!PAYROLL_PROC.includes(user.role)) return err("forbidden", "Payroll access required", 403);
    const cid = await env.DB.prepare(`SELECT value FROM system_meta WHERE key = 'm2e_corporate_id'`).first<{ value: string }>();
    const acc = await env.DB.prepare(`SELECT value FROM system_meta WHERE key = 'm2e_payer_account'`).first<{ value: string }>();
    const cbid = await env.DB.prepare(`SELECT value FROM system_meta WHERE key = 'm2e_client_batch_id'`).first<{ value: string }>();
    const tpl = await env.MEDIA.head(M2E_TEMPLATE_KEY);
    return json({ corporate_id: cid?.value ?? "", payer_account: acc?.value ?? "", client_batch_id: cbid?.value ?? "", has_template: tpl !== null });
  }
  if (path === "/payroll/m2e-settings" && method === "POST") {
    if (!PAYROLL_PROC.includes(user.role)) return err("forbidden", "Payroll access required", 403);
    const cid = String(body?.corporate_id ?? "").trim().toUpperCase().slice(0, 20);
    const acc = String(body?.payer_account ?? "").replace(/[^0-9]/g, "").slice(0, 20);
    const cbid = String(body?.client_batch_id ?? "").trim().toUpperCase().slice(0, 20);
    if (!cid || !acc || !cbid) return err("invalid_input", "corporate_id, client_batch_id and payer_account required", 400);
    await env.DB.prepare(`INSERT INTO system_meta (key, value) VALUES ('m2e_corporate_id', ?1) ON CONFLICT(key) DO UPDATE SET value = ?1`).bind(cid).run();
    await env.DB.prepare(`INSERT INTO system_meta (key, value) VALUES ('m2e_payer_account', ?1) ON CONFLICT(key) DO UPDATE SET value = ?1`).bind(acc).run();
    await env.DB.prepare(`INSERT INTO system_meta (key, value) VALUES ('m2e_client_batch_id', ?1) ON CONFLICT(key) DO UPDATE SET value = ?1`).bind(cbid).run();
    await audit(env, user.id, "payroll.m2e_settings", "payroll", "m2e", {});
    return json({ ok: true });
  }
  if (path === "/payroll/m2e-template" && method === "POST") {
    // Binary body (on the exclusion list): the BLANK official template,
    // stored once in R2 and reused every month.
    if (!PAYROLL_PROC.includes(user.role)) return err("forbidden", "Payroll access required", 403);
    const lenT = parseInt(request.headers.get("Content-Length") ?? "0", 10);
    if (!lenT || lenT > 12 * 1024 * 1024) return err("invalid_input", "Template file required (max 12MB)", 400);
    const bytesT = new Uint8Array(await request.arrayBuffer());
    if (!(bytesT[0] === 0x50 && bytesT[1] === 0x4b)) return err("invalid_input", "Not an .xlsm file", 400);
    try {
      // must contain both sheets before we accept it
      await fillM2eTemplate(bytesT, { corporateId: "X", clientBatchId: "X", payerAccount: "0", valueDate: "01011970" }, []);
    } catch {
      return err("invalid_input", "This doesn't look like the M2E RCGEN2 template (Home / Salary Bulk Payment (MY) sheets not found)", 400);
    }
    await env.MEDIA.put(M2E_TEMPLATE_KEY, bytesT, { httpMetadata: { contentType: "application/vnd.ms-excel.sheet.macroEnabled.12" } });
    await audit(env, user.id, "payroll.m2e_template", "payroll", "m2e", { bytes: bytesT.length });
    return json({ ok: true });
  }
  if (path === "/payroll/m2e-file" && method === "GET") {
    /* v1.4.203 (CEO: "I WANT the button can generate like this files!"):
       the filled .xlsm itself — Home sheet (Corporate ID, Client Batch ID
       AZOO{MM}{YYYY}, payer account, Value Date per the v1.4.202 rule) plus
       the salary rows from row 5 — macros untouched, ready to upload. */
    if (!PAYROLL_PROC.includes(user.role)) return err("forbidden", "Payroll access required", 403);
    const urlM = new URL(request.url);
    const monthM = urlM.searchParams.get("month");
    if (!monthM || !/^\d{4}-\d{2}$/.test(monthM)) return err("invalid_input", "month (YYYY-MM) required", 400);
    const tplObj = await env.MEDIA.get(M2E_TEMPLATE_KEY);
    if (!tplObj) return err("template_missing", "Upload the blank M2E template once via M2E setup", 409);
    const cidM = await env.DB.prepare(`SELECT value FROM system_meta WHERE key = 'm2e_corporate_id'`).first<{ value: string }>();
    const accM = await env.DB.prepare(`SELECT value FROM system_meta WHERE key = 'm2e_payer_account'`).first<{ value: string }>();
    const cbidM = await env.DB.prepare(`SELECT value FROM system_meta WHERE key = 'm2e_client_batch_id'`).first<{ value: string }>();
    if (!cidM?.value || !accM?.value || !cbidM?.value) return err("settings_missing", "Save Corporate ID, Client Batch ID + payer account once via M2E setup", 409);
    const vdP = urlM.searchParams.get("value_date");
    const vdM = vdP && /^\d{4}-\d{2}-\d{2}$/.test(vdP) ? vdP : paymentDateFor(monthM);
    const [my, mm, md] = vdM.split("-");
    const valueDateM = `${md}${mm}${my}`;
    const { results: rowsM } = await env.DB.prepare(
      `SELECT u.full_name, u.name, u.employee_id, u.bank_name, u.bank_account, u.ic_number, p.net_cents,
              p.basic_cents, p.commission_cents, p.allowance_cents,
              COALESCE(p.ot_cents, 0) AS ot_cents, p.deduction_cents
       FROM payroll_entries p JOIN users u ON u.id = p.user_id
       WHERE p.month = ?1 AND u.is_active = 1
         AND u.role NOT IN ('customer', 'super_admin')
       ORDER BY ${STAFF_ORDER_SQL}`,
    ).bind(monthM).all<{ full_name: string | null; name: string; employee_id: string | null; bank_name: string | null; bank_account: string | null; ic_number: string | null; net_cents: number | null; basic_cents: number; commission_cents: number; allowance_cents: number; ot_cents: number; deduction_cents: number }>();
    const [yM, moM] = monthM.split("-");
    /* v1.4.205 (his real working batch, screenshots): Own Ref is UNIQUE per
       row — PAYROLL + value date as MMDDYY + 2-digit row number
       (PAYROLL08052601..05 for value date 05082026). Favourite Recipient
       Code = the staff employee_id (AZOOM002, AZOOA001, …) — he registered
       his M2E favourites under the portal's employee IDs. */
    const refBase = `PAYROLL${vdM.slice(5, 7)}${vdM.slice(8, 10)}${vdM.slice(2, 4)}`;
    const descM = `SALARY ${moM}-${yM}`;
    const skipped: string[] = [];
    const m2eRows: M2eRow[] = [];
    let totalM = 0;
    for (const r of rowsM) {
      const net = r.net_cents ?? Math.max(0, r.basic_cents + r.commission_cents + r.allowance_cents + r.ot_cents - r.deduction_cents);
      if (net <= 0) continue;
      const code = r.bank_name ? bankCode(r.bank_name) : null;
      if (!r.bank_name || !r.bank_account || !code) { skipped.push(r.full_name || r.name); continue; }
      m2eRows.push({
        mode: code === "MBBEMYKL" ? "IT" : "IG",
        valueDate: valueDateM,
        name: (r.full_name || r.name).toUpperCase().replace(/[^A-Z0-9 @\/\-.]/g, " ").slice(0, 40).trim(),
        faveCode: (r.employee_id ?? "").toUpperCase(),
        amount: net / 100,
        account: r.bank_account.replace(/[^0-9]/g, ""),
        bankCode: code,
        newIc: (r.ic_number ?? "").replace(/[^0-9]/g, ""),
        ownRef: `${refBase}${String(m2eRows.length + 1).padStart(2, "0")}`,
        recipientDesc: descM,
        payerDesc: descM,
      });
      totalM += net;
    }
    if (m2eRows.length === 0) return err("no_payees", `No payable rows for ${monthM}${skipped.length ? ` (missing bank details/code: ${skipped.join("; ")})` : ""}`, 409);
    const filled = await fillM2eTemplate(new Uint8Array(await tplObj.arrayBuffer()), {
      corporateId: cidM.value,
      clientBatchId: cbidM.value,
      payerAccount: accM.value,
      valueDate: valueDateM,
    }, m2eRows);
    await audit(env, user.id, "payroll.m2e_file", "payroll", monthM, { payees: m2eRows.length, total_cents: totalM, skipped: skipped.length, value_date: valueDateM });
    const headersM: Record<string, string> = {
      "Content-Type": "application/vnd.ms-excel.sheet.macroEnabled.12",
      "Content-Disposition": `attachment; filename="azoo-m2e-salary-${monthM}.xlsm"`,
    };
    if (skipped.length > 0) headersM["X-M2E-Skipped"] = encodeURIComponent(skipped.join("; "));
    return new Response(filled, { headers: headersM });
  }
  if (path === "/payroll/payment-file" && method === "GET") {
    /* v1.4.201 (CEO uploaded the official Maybank2E "RCGEN2 - Funds Transfer"
       template, sheet "Salary Bulk Payment (MY)"): the export now matches that
       sheet's columns EXACTLY (headers row 4, data from row 5, cols A..Q used)
       so rows can be pasted straight into the template at cell A5.
       - Payment Mode: IT (intrabank) when the recipient bank is Maybank —
         payer account is Maybank — else IG (GIRO/ACH).
       - Recipient Bank Code: mapped from the staff member's free-text
         bank_name to M2E's official code list (template "Recipient Bank Code"
         sheet). Unmatched banks are listed at the bottom so the CEO fixes the
         bank name in Staff Details or fills the code by hand.
       - Value date: optional ?value_date=YYYY-MM-DD (defaults to today MYT),
         emitted DDMMYYYY as the template requires.
       PAYROLL_PROC only; audited. */
    if (!PAYROLL_PROC.includes(user.role)) return err("forbidden", "Payroll access required", 403);
    const urlPF = new URL(request.url);
    const monthPF = urlPF.searchParams.get("month");
    if (!monthPF || !/^\d{4}-\d{2}$/.test(monthPF)) return err("invalid_input", "month (YYYY-MM) required", 400);
    const vdParam = urlPF.searchParams.get("value_date");
    const vd = vdParam && /^\d{4}-\d{2}-\d{2}$/.test(vdParam) ? vdParam : paymentDateFor(monthPF);
    const [vy, vm, vdd] = vd.split("-");
    const valueDate = `${vdd}${vm}${vy}`; // DDMMYYYY per the template
    const { results: rows } = await env.DB.prepare(
      `SELECT u.full_name, u.name, u.employee_id, u.bank_name, u.bank_account, u.ic_number, p.net_cents,
              p.basic_cents, p.commission_cents, p.allowance_cents,
              COALESCE(p.ot_cents, 0) AS ot_cents, p.deduction_cents
       FROM payroll_entries p JOIN users u ON u.id = p.user_id
       WHERE p.month = ?1 AND u.is_active = 1
         AND u.role NOT IN ('customer', 'super_admin')
       ORDER BY ${STAFF_ORDER_SQL}`,
    ).bind(monthPF).all<{ full_name: string | null; name: string; employee_id: string | null; bank_name: string | null; bank_account: string | null; ic_number: string | null; net_cents: number | null; basic_cents: number; commission_cents: number; allowance_cents: number; ot_cents: number; deduction_cents: number }>();
    const missing: string[] = [];
    const noCode: string[] = [];
    const [yPF, mPF] = monthPF.split("-");
    // v1.4.205: Own Ref unique per row — PAYROLL + value date MMDDYY + seq
    const refBasePF = `PAYROLL${vd.slice(5, 7)}${vd.slice(8, 10)}${vd.slice(2, 4)}`;
    const desc = `SALARY ${mPF}-${yPF}`;
    const cell = (v: string) => `"${v.replace(/"/g, '""')}"`;
    // Header mirrors the template's row 4 (cols A..Q) so column alignment can
    // be verified — PASTE FROM THE DATA ROWS ONLY, into the template's A5.
    const lines = [
      [
        "Payment Mode", "Value Date", "Recipient Name 1", "Favourite Recipient Code",
        "Transaction Amount (RM)", "Recipient Account No.", "Recipient Bank Code",
        "Recipient Name 2", "Recipient Name 3", "New IC No", "Old IC No",
        "Business Registration No", "Police/ Army ID/ Passport No", "Own Ref.",
        "Recipient Description", "Email", "Payer Description",
      ].join(","),
    ];
    let totalC = 0;
    let payees = 0;
    for (const r of rows) {
      const net = r.net_cents ?? Math.max(0, r.basic_cents + r.commission_cents + r.allowance_cents + r.ot_cents - r.deduction_cents);
      if (net <= 0) continue; // e.g. the CEO's own RM 0 row
      if (!r.bank_name || !r.bank_account) { missing.push(r.full_name || r.name); continue; }
      const code = bankCode(r.bank_name);
      if (!code) noCode.push(`${r.full_name || r.name} (${r.bank_name})`);
      const nm = (r.full_name || r.name).toUpperCase().replace(/[^A-Z0-9 @\/\-.]/g, " ").slice(0, 40).trim();
      const acct = r.bank_account.replace(/[^0-9]/g, "");
      const mode = code === "MBBEMYKL" ? "IT" : "IG"; // payer account is Maybank
      const ic = (r.ic_number ?? "").replace(/[^0-9]/g, "");
      lines.push([
        mode, valueDate, cell(nm), (r.employee_id ?? "").toUpperCase(), (net / 100).toFixed(2), acct, code ?? "FILL-IN",
        "", "", ic, "", "", "", `${refBasePF}${String(payees + 1).padStart(2, "0")}`, cell(desc), "", cell(desc),
      ].join(","));
      totalC += net;
      payees += 1;
    }
    lines.push("");
    lines.push(`# TOTAL RM ${(totalC / 100).toFixed(2)} across ${payees} payees — paste ONLY the data rows into the M2E template sheet "Salary Bulk Payment (MY)" starting at cell A5 (do NOT paste this header or these # lines).`);
    lines.push(`# Value Date ${valueDate} = the 5th of the following month, moved earlier when it falls on a weekend (company payment rule). Override with &value_date=YYYY-MM-DD or edit in the template.`);
    lines.push(`# In Excel, account numbers and IC numbers that start with 0 need a leading apostrophe — paste-as-text or format the columns as Text first.`);
    if (missing.length > 0) lines.push(`# MISSING BANK DETAILS (add in Staff Details, then re-download): ${missing.join("; ")}`);
    if (noCode.length > 0) lines.push(`# BANK NOT RECOGNISED — fix the bank name in Staff Details or type the M2E Recipient Bank Code by hand: ${noCode.join("; ")}`);
    await audit(env, user.id, "payroll.payment_file", "payroll", monthPF, { payees, total_cents: totalC, format: "m2e_salary" });
    return new Response(lines.join("\r\n"), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="azoo-m2e-salary-${monthPF}.csv"`,
      },
    });
  }
  if (path === "/payroll/recompute" && method === "POST") {
    // v1.4.131: one-click reconciliation. Recomputes the month's working days
    // from the holiday calendar and re-derives + STORES every entry's
    // month_working_days and net_cents server-side — fixing stale rows
    // regardless of what the browser has loaded or saved.
    if (!PAYROLL_PROC.includes(user.role)) return err("forbidden", "Payroll access required", 403);
    const monthR = typeof body?.month === "string" && /^\d{4}-\d{2}$/.test(body.month) ? body.month : null;
    if (!monthR) return err("invalid_input", "month (YYYY-MM) required", 400);
    // Mon–Fri count minus weekday holidays on the calendar.
    const yR = Number(monthR.slice(0, 4)), moR = Number(monthR.slice(5, 7));
    const lastD = new Date(Date.UTC(yR, moR, 0)).getUTCDate();
    let workD = 0;
    const weekdaySet = new Set<string>();
    for (let d = 1; d <= lastD; d++) {
      const dt = new Date(Date.UTC(yR, moR - 1, d));
      const dow = dt.getUTCDay();
      if (dow >= 1 && dow <= 5) { workD++; weekdaySet.add(dt.toISOString().slice(0, 10)); }
    }
    let holCount = 0;
    try {
      const { results: hols } = await env.DB.prepare(
        `SELECT holiday_date FROM holidays WHERE holiday_date LIKE ?1 || '%'`,
      ).bind(monthR).all<{ holiday_date: string }>();
      for (const h of hols) if (weekdaySet.has(h.holiday_date)) holCount++;
    } catch { /* holidays table always present since 0029 */ }
    workD -= holCount;
    const { results: ents } = await env.DB.prepare(
      `SELECT p.user_id, p.basic_cents, p.commission_cents, p.allowance_cents,
              COALESCE(p.ot_cents, 0) AS ot_cents, p.deduction_cents,
              p.worked_days, u.base_salary_cents, u.role AS user_role, u.employment_status,
              u.joined_on, u.left_on, u.rejoined_on
       FROM payroll_entries p JOIN users u ON u.id = p.user_id WHERE p.month = ?1`,
    ).bind(monthR).all<{ user_id: number; basic_cents: number; commission_cents: number; allowance_cents: number; ot_cents: number; deduction_cents: number; worked_days: number | null; base_salary_cents: number; user_role: string; employment_status: string | null; joined_on: string | null; left_on: string | null; rejoined_on: string | null }>();
    /* v1.75.0 — the same day list every other payroll surface uses. */
    const monthDayList = await workingDayList(monthR);
    /* v1.77.0 — the SAME resolver the payslip uses: the week rule, the
       public-holiday floor and the cap. This route is the one that WRITES
       net_cents, so a formula here that disagreed with the payslip would be
       a number in the bank that no slip can explain. */
    const unpaidAtR = await unpaidResolver(monthR);
    const phAtR = await phWorkResolver(monthR);
    /* The month's holidays, read ONCE. Counting them per person inside the
       loop below would be a query per staff member - the same shape of bug
       that made the Payroll tab take a minute this morning. */
    let holDatesR: string[] = [];
    try {
      holDatesR = ((await env.DB.prepare(
        `SELECT holiday_date FROM holidays WHERE holiday_date LIKE ?1 || '%'`,
      ).bind(monthR).all<{ holiday_date: string }>()).results ?? []).map((h) => h.holiday_date);
    } catch { /* holidays has existed since 0011 */ }
    const phInSpan = (joined?: string | null, left?: string | null) =>
      holDatesR.filter((h) =>
        (!joined || h >= joined.slice(0, 10)) && (!left || h <= left.slice(0, 10))).length;
    let fixed = 0;
    for (const e of ents) {
      /* v1.4.183: hourly (part-time live host) rows re-derive from the
         attendance clock — same formula as the save route. */
      if (isHourlyUser(e.user_role, e.employment_status)) {
        const minsR = (await clockedMinutes(e.user_id, monthR)).counted;
        const basicR = hourlyPayCents(minsR);
        /* v1.77.0 — a part-timer's hours on a public holiday earn a second
           RM15/h (Part-Time Employees Regulations 2010). */
        const phH = phAtR(e.user_id, { joined: e.joined_on, left: e.left_on, rejoined: e.rejoined_on, orpBase: 0, hourly: true }).cents;
        const netHR = Math.max(0, basicR + phH + e.commission_cents + e.allowance_cents - e.deduction_cents);
        try {
          await env.DB.prepare(
            `UPDATE payroll_entries SET basic_cents = ?1, ot_hours = NULL, ot_cents = 0,
               worked_days = NULL, month_working_days = NULL, net_cents = ?2,
               hourly_minutes = ?3, hourly_rate_cents = ?4, updated_at = datetime('now')
             WHERE user_id = ?5 AND month = ?6`,
          ).bind(basicR, netHR, minsR, PART_TIME_LH_RATE_CENTS, e.user_id, monthR).run();
          fixed++;
        } catch (errH) {
          await logError(env, "payroll_recompute", errH instanceof Error ? errH.message : String(errH));
          return err("migration_missing", "Migration 0053 is not applied — run: npx wrangler d1 migrations apply azoneofficial --remote, then press this button again.", 500);
        }
        continue;
      }
      /* v1.75.0 — proration comes from EMPLOYMENT DATES, not from the clock.
         An existing staff member has payable === workD, so this is zero for
         everyone except a mid-month joiner or leaver. `worked_days` stays on
         the row as information; it no longer moves money, which is what
         stopped approved paid leave being deducted as if it were absence. */
      const payable = employedDays(monthDayList, e.joined_on, e.left_on, e.rejoined_on).length;
      const adj = incompleteCents(e.basic_cents, monthDayList.length, payable);
      const ulDed = unpaidAtR(e.user_id, {
        joined: e.joined_on, left: e.left_on, rejoined: e.rejoined_on,
        orpBase: e.base_salary_cents || e.basic_cents,
        incompleteCents: adj,
        phCount: phInSpan(e.joined_on, e.left_on),
      }).cents;
      /* v1.77.0 — two days' ORP for each public holiday worked, s.60D(3)(a)(i). */
      const phW = phAtR(e.user_id, {
        joined: e.joined_on, left: e.left_on, rejoined: e.rejoined_on,
        orpBase: e.base_salary_cents || e.basic_cents, hourly: false,
      }).cents;
      const net = Math.max(0, e.basic_cents + phW + e.commission_cents + e.allowance_cents + e.ot_cents - e.deduction_cents - ulDed - adj);
      try {
        await env.DB.prepare(
          `UPDATE payroll_entries SET month_working_days = ?1, net_cents = ?2, updated_at = datetime('now') WHERE user_id = ?3 AND month = ?4`,
        ).bind(workD, net, e.user_id, monthR).run();
        fixed++;
      } catch (err2) {
        // net_cents arrives with migration 0041 — surface it instead of half-fixing
        await logError(env, "payroll_recompute", err2 instanceof Error ? err2.message : String(err2));
        return err("migration_missing", "Migration 0041 is not applied — run: npx wrangler d1 migrations apply azoneofficial --remote, then press this button again.", 500);
      }
    }
    await audit(env, user.id, "payroll.recompute", "payroll", monthR, { working_days: workD, rows: fixed });
    return json({ ok: true, month: monthR, working_days: workD, rows: fixed });
  }
  if (path === "/payroll" && method === "POST") {
    if (!PAYROLL_PROC.includes(user.role)) return err("forbidden", "Payroll access required", 403);
    const month = str(body?.month, 7) && /^\d{4}-\d{2}$/.test(body!.month as string) ? (body!.month as string) : null;
    if (!body || typeof body.user_id !== "number" || !month) {
      return err("invalid_input", "user_id and month (YYYY-MM) are required", 400);
    }
    const cents = (v: unknown) => (typeof v === "number" && v >= 0 ? Math.round(v) : 0);
    // v1.4.82: worked_days + month_working_days persist the incomplete-month
    // basis (null = full month, no adjustment). Basic itself stays FULL.
    const intOrNull = (v: unknown) =>
      typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 31 ? Math.round(v) : null;
    // v1.4.85: overtime — hours (0–300, halves allowed) + the computed sen.
    const otHours = typeof body.ot_hours === "number" && Number.isFinite(body.ot_hours) && body.ot_hours > 0 && body.ot_hours <= 300
      ? Math.round(body.ot_hours * 2) / 2 : null;
    // v1.4.124: the panel sends the net it computed with THE shared formula —
    // stored so /expenses can sum identical figures (no re-derivation drift).
    const netCents = typeof body.net_cents === "number" && body.net_cents >= 0 ? Math.round(body.net_cents) : null;
    /* v1.4.183: hourly (part-time live host) entries are computed by the
       SERVER from attendance, whatever the client sent — basic = minutes ×
       RM15/60, OT forced 0, no worked-days proration, net = hourly +
       commission + allowance − deduction. Tamper-proof and always in step
       with the clock records. */
    const tRow = await env.DB.prepare(`SELECT role, employment_status FROM users WHERE id = ?1`)
      .bind(body.user_id).first<{ role: string; employment_status: string | null }>();
    if (tRow && isHourlyUser(tRow.role, tRow.employment_status)) {
      const minsH = (await clockedMinutes(body.user_id, month)).counted;
      const basicH = hourlyPayCents(minsH);
      /* v1.77.0 — a second RM15/h for hours on a public holiday. */
      const whoH = await env.DB.prepare(`SELECT joined_on, left_on, rejoined_on FROM users WHERE id = ?1`).bind(body.user_id)
        .first<{ joined_on: string | null; left_on: string | null; rejoined_on: string | null }>();
      const phH = (await phWorkResolver(month))(body.user_id as number, {
        joined: whoH?.joined_on, left: whoH?.left_on, rejoined: whoH?.rejoined_on, orpBase: 0, hourly: true,
      }).cents;
      const netH = Math.max(0, basicH + phH + cents(body.commission_cents) + cents(body.allowance_cents) - cents(body.deduction_cents));
      try {
        await env.DB.prepare(
          `INSERT INTO payroll_entries (user_id, month, basic_cents, commission_cents, allowance_cents, ot_hours, ot_cents, deduction_cents, worked_days, month_working_days, net_cents, hourly_minutes, hourly_rate_cents, note, created_by)
           VALUES (?1, ?2, ?3, ?4, ?5, NULL, 0, ?6, NULL, NULL, ?7, ?8, ?9, ?10, ?11)
           ON CONFLICT (user_id, month) DO UPDATE SET
             basic_cents = ?3, commission_cents = ?4, allowance_cents = ?5,
             ot_hours = NULL, ot_cents = 0, net_cents = ?7,
             deduction_cents = ?6, worked_days = NULL, month_working_days = NULL,
             hourly_minutes = ?8, hourly_rate_cents = ?9,
             note = ?10, updated_at = datetime('now')`,
        ).bind(
          body.user_id, month, basicH, cents(body.commission_cents), cents(body.allowance_cents),
          cents(body.deduction_cents), netH, minsH, PART_TIME_LH_RATE_CENTS,
          str(body.note, 300) ? body.note : null, user.id,
        ).run();
      } catch (eH) {
        if (!String(eH).includes("no such column")) throw eH;
        return err("migration_missing", "Run: npx wrangler d1 migrations apply azoneofficial --remote (0053_hourly_payroll)", 500);
      }
      await audit(env, user.id, "payroll.save", "users", String(body.user_id), { month, hourly: true, minutes: minsH, rate_cents: PART_TIME_LH_RATE_CENTS });
      return json({ ok: true, hourly: true, minutes: minsH, basic_cents: basicH, net_cents: netH });
    }
    await env.DB.prepare(
      `INSERT INTO payroll_entries (user_id, month, basic_cents, commission_cents, allowance_cents, ot_hours, ot_cents, deduction_cents, worked_days, month_working_days, net_cents, note, created_by)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?13, ?11, ?12)
       ON CONFLICT (user_id, month) DO UPDATE SET
         basic_cents = ?3, commission_cents = ?4, allowance_cents = ?5,
         ot_hours = ?6, ot_cents = ?7, net_cents = ?13,
         deduction_cents = ?8, worked_days = ?9, month_working_days = ?10,
         note = ?11, updated_at = datetime('now')`,
    ).bind(
      body.user_id, month,
      cents(body.basic_cents), cents(body.commission_cents),
      cents(body.allowance_cents), otHours, cents(body.ot_cents),
      cents(body.deduction_cents),
      intOrNull(body.worked_days), intOrNull(body.month_working_days),
      str(body.note, 300) ? body.note : null, user.id, netCents,
    ).run();
    await audit(env, user.id, "payroll.save", "users", String(body.user_id), { month });
    return json({ ok: true });
  }

  if (path === "/attendance/export" && method === "GET") {
    if (!can(user.role, "payroll_export")) return err("forbidden", "Payroll export access required", 403);
    const url = new URL(request.url);
    const month = url.searchParams.get("month") ?? new Date().toISOString().slice(0, 7);
    const notPendingE = await notPendingSql(env, "a.");
    const { results } = await env.DB.prepare(
      `SELECT a.user_id, COALESCE(NULLIF(TRIM(u.full_name), ''), u.name) AS name, u.email, u.employee_id, a.type, a.created_at
       FROM attendance_records a JOIN users u ON u.id = a.user_id
       WHERE a.created_at LIKE ?1 || '%'${notPendingE} ORDER BY u.name, a.created_at`,
    ).bind(month).all();
    // Convert each event to Malaysia time and flag against the shift, so the
    // CSV that goes to payroll already reflects local working hours.
    /* v1.76.0 — flagged against the person's OWN schedule on that date, and
       the export says which schedule, so a payroll query about a late flag
       can be answered without guessing which hours were in force. */
    /* v1.77.0 — once, before the loop. This was two database queries per
       PUNCH: a month of attendance for nine people is several hundred rows,
       so the export spent its entire time asking the same handful of
       patterns over and over. */
    const shiftAtE = await shiftResolver(env);
    const assignedAtE = await assignedResolver(env, `${month}-01`, `${month}-31`);
    const rows: (string | number)[][] = [];
    for (const r of results as { user_id: number; name: string; email: string; employee_id: string | null; type: string; created_at: string }[]) {
      const myt = new Date(new Date(r.created_at + "Z").getTime() + 8 * 3600 * 1000);
      const minutes = myt.getUTCHours() * 60 + myt.getUTCMinutes();
      const date = myt.toISOString().slice(0, 10);
      const shE = shiftAtE(r.user_id, date);
      const winE = windowAt(shE, minutes);
      const asgE = winE ? null : assignedAtE(r.user_id, date, minutes);
      /* v1.80.0 — measured against the block the punch belongs to, and the
         last block's end for a clock-out. The old test used the FIRST block
         for both, so on a split day every evening arrival exported as "late"
         and every evening departure as on time. */
      const flag = asgE ? "assigned"
        : shE.kind === "rest_day" ? "rest_day"
        : r.type === "clock_in" && shE.windows.length > 0 && minutes > (lateAgainst(shE, minutes) ?? 0) ? "late"
        : r.type === "clock_out" && endOfDay(shE) !== null && minutes < endOfDay(shE)! ? "early_out"
        : "ok";
      rows.push([r.employee_id ?? "", r.name, r.email, date, myt.toISOString().slice(11, 16),
                 r.type, flag, shE.kind, shE.pattern, shiftLabel(shE), scheduledMinutes(shE),
                 breakFor(shE), workMinutes(shE),
                 asgE ? `${asgE.kind}: ${asgE.what}` : ""]);
    }
    const header = ["employee_id", "name", "email", "date_myt", "time_myt", "event", "shift_flag", "day_kind", "pattern", "shift_hours", "scheduled_minutes", "break_minutes", "work_minutes", "assigned_work"];
    const esc = (v: string) => /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
    const csv = [header, ...rows].map((row) => row.map((c) => esc(String(c))).join(",")).join("\r\n");
    await audit(env, user.id, "attendance.export", "attendance_records", month);
    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="attendance-${month}.csv"`,
      },
    });
  }

  /* ---- HR: task reports (daily / weekly / monthly) ---- */

  if (path === "/task-reports" && method === "GET") {
    if (!can(user.role, "task_reports") && !can(user.role, "exec_view")) {
      return err("forbidden", "HR or executive access required", 403);
    }
    const { results } = await env.DB.prepare(
      `SELECT t.id, t.period, t.report_date, t.content, t.created_at, u.name AS author
       FROM task_reports t LEFT JOIN users u ON u.id = t.created_by
       ORDER BY t.report_date DESC, t.id DESC LIMIT 100`,
    ).all();
    return json({ reports: results });
  }
  if (path === "/task-reports" && method === "POST") {
    if (!can(user.role, "task_reports")) return err("forbidden", "HR access required", 403);
    const periods = ["daily", "weekly", "monthly"];
    if (
      !body || typeof body.period !== "string" || !periods.includes(body.period) ||
      !str(body.report_date, 10) || !str(body.content, 8000)
    ) {
      return err("invalid_input", "period (daily/weekly/monthly), report_date and content are required", 400);
    }
    await env.DB.prepare(
      `INSERT INTO task_reports (period, report_date, content, created_by) VALUES (?1, ?2, ?3, ?4)`,
    ).bind(body.period, body.report_date, body.content, user.id).run();
    await audit(env, user.id, "hr.task_report", "task_reports");
    return json({ ok: true }, 201);
  }

  /* ---- HR: upcoming staff birthdays ---- */

  if (path === "/birthdays" && method === "GET") {
    // Any staff member can see upcoming birthdays; HR maintains them via
    // PATCH /users/:id (birthday field).
    const { results } = await env.DB.prepare(
      `SELECT COALESCE(NULLIF(TRIM(full_name), ''), name) AS name, birthday FROM users
       WHERE birthday IS NOT NULL AND is_active = 1 AND ${currentStaffSql()} AND ${staffRolesSql()}
       ORDER BY substr(birthday, 6)`,
    ).all();
    return json({ birthdays: results });
  }

  /* v1.4.263 (CEO: "if sales invoice created, inventory should be deducted to
   tally the inventory"): a product INVOICE moves stock the moment it exists.

   Only the INV deducts — a quotation is a promise, and a DO for the same sale
   would double-deduct. Lines match inventory by SKU first, then exact name
   (the product form's datalist inserts inventory names, so most lines match);
   unmatched lines are reported back, never guessed. Each deduction is logged
   in manual_stockouts with NO sale price — the revenue is counted by the PAID
   invoice (v1.4.90), so pricing the movement would count the sale twice. */
async function deductForInvoice(
  env: Env, docId: number, docNumber: string, itemsJson: string, docDate: string | null, byUser: number,
): Promise<{ deducted: { sku: string; name: string; qty: number; stock: number }[]; unmatched: string[]; short: string[] }> {
  const out = { deducted: [] as { sku: string; name: string; qty: number; stock: number }[], unmatched: [] as string[], short: [] as string[] };
  let items: { name?: string; sku?: string; qty?: number }[] = [];
  try { items = JSON.parse(itemsJson); } catch { return out; }
  for (const it of items) {
    const qty = Math.round(Number(it.qty ?? 0));
    if (!qty || qty <= 0) continue;
    const sku = (it.sku ?? "").trim();
    const name = (it.name ?? "").trim();
    const inv = await env.DB.prepare(
      sku
        ? `SELECT id, sku, name, stock FROM inventory_items WHERE UPPER(sku) = UPPER(?1) LIMIT 1`
        : `SELECT id, sku, name, stock FROM inventory_items WHERE UPPER(name) = UPPER(?1) LIMIT 1`,
    ).bind(sku || name).first<{ id: number; sku: string; name: string; stock: number }>();
    if (!inv) { if (name || sku) out.unmatched.push(name || sku); continue; }
    const newStock = Math.max(0, inv.stock - qty);
    if (inv.stock < qty) out.short.push(`${inv.sku} (had ${inv.stock}, invoice needs ${qty})`);
    // v1.4.271 audit fix: this was the ONE movement site that skipped the
    // status column and the low-stock bell — an invoice could drain a SKU to
    // zero with the row still saying in_stock and nobody notified.
    await env.DB.prepare(
      `UPDATE inventory_items SET stock = ?1,
              status = CASE WHEN ?1 = 0 THEN 'out_of_stock' WHEN ?1 <= 5 THEN 'low' ELSE 'in_stock' END
       WHERE id = ?2`,
    ).bind(newStock, inv.id).run();
    await checkLowStock(inv.id);
    const remark = `Invoice ${docNumber} — stock deducted on invoice${inv.stock < qty ? ` (SHORT: had ${inv.stock}, needed ${qty})` : ""}`;
    const args = [inv.id, inv.sku, inv.name, qty, remark, docDate, byUser];
    try {
      await env.DB.prepare(
        `INSERT INTO manual_stockouts (item_id, sku, item_name, qty, unit_sale_cents, remark, out_date, created_by, direction, doc_id)
         VALUES (?1, ?2, ?3, ?4, NULL, ?5, ?6, ?7, 'out', ?8)`,
      ).bind(...args, docId).run();
    } catch (e) {
      if (!String(e).includes("no such column")) throw e;
      /* pre-0065 (or pre-0064) skew: the stock still moves; the trail row is
         written with whatever columns exist, and restoration falls back to
         the remark prefix, which this route alone writes. */
      try {
        await env.DB.prepare(
          `INSERT INTO manual_stockouts (item_id, sku, item_name, qty, unit_sale_cents, remark, out_date, created_by, direction)
           VALUES (?1, ?2, ?3, ?4, NULL, ?5, ?6, ?7, 'out')`,
        ).bind(...args).run();
      } catch (e2) {
        if (!String(e2).includes("no such column")) throw e2;
        await env.DB.prepare(
          `INSERT INTO manual_stockouts (item_id, sku, item_name, qty, unit_sale_cents, remark, out_date, created_by)
           VALUES (?1, ?2, ?3, ?4, NULL, ?5, ?6, ?7)`,
        ).bind(...args).run();
        await logError(env, "migration_skew", "manual_stockouts missing 0064/0065 — invoice deduction logged without direction/doc_id");
      }
    }
  }
  return out;
}

/** The reverse: a deleted / reversed / re-edited invoice puts its stock back
    and removes its own trail rows (the document they belonged to is gone). */
async function restoreForInvoice(env: Env, docId: number, docNumber: string): Promise<number> {
  let rows: { id: number; item_id: number; qty: number }[] = [];
  try {
    rows = (await env.DB.prepare(
      `SELECT id, item_id, qty FROM manual_stockouts WHERE doc_id = ?1 AND direction = 'out'`,
    ).bind(docId).all<{ id: number; item_id: number; qty: number }>()).results;
  } catch (e) {
    if (!String(e).includes("no such column")) throw e;
    rows = (await env.DB.prepare(
      `SELECT id, item_id, qty FROM manual_stockouts WHERE remark LIKE ?1`,
    ).bind(`Invoice ${docNumber} — stock deducted on invoice%`).all<{ id: number; item_id: number; qty: number }>()).results;
  }
  for (const r of rows) {
    // v1.4.271 audit fix: restoring stock also refreshes status and lets the
    // low-stock alert RESET (checkLowStock re-arms above 5).
    await env.DB.prepare(
      `UPDATE inventory_items SET stock = stock + ?1,
              status = CASE WHEN stock + ?1 = 0 THEN 'out_of_stock' WHEN stock + ?1 <= 5 THEN 'low' ELSE 'in_stock' END
       WHERE id = ?2`,
    ).bind(r.qty, r.item_id).run();
    await checkLowStock(Number(r.item_id));
    await env.DB.prepare(`DELETE FROM manual_stockouts WHERE id = ?1`).bind(r.id).run();
  }
  return rows.length;
}

/* v1.5.0: trendsMY (Google Trends) removed with the Social tab. */

/* ---- Sales & marketing: inventory ---- */

  if (path === "/inventory" && method === "GET") {
    if (!can(user.role, "inventory") && !can(user.role, "exec_view")) {
      return err("forbidden", "Inventory access required", 403);
    }
    const { results } = await env.DB.prepare(
      `SELECT i.*, u.name AS updated_by_name FROM inventory_items i
       LEFT JOIN users u ON u.id = i.updated_by ORDER BY i.name`,
    ).all();
    return json({ items: results });
  }
  /* v1.4.172 (CEO): manual stock-out lifecycle. A shared sale-row locator —
     prefers the sale_id link; legacy rows (pre-0050) fall back to an exact
     field match. Revenue totals stay in step with every action. */
  const findManualSaleId = async (row: { sale_id?: number | null; item_id: number; qty: number; unit_sale_cents?: number | null; created_at: string }): Promise<number | null> => {
    if (row.sale_id) return row.sale_id;
    if (row.unit_sale_cents == null) return null;
    try {
      const m = await env.DB.prepare(
        `SELECT id FROM manual_sales WHERE item_id = ?1 AND qty = ?2 AND unit_sale_cents = ?3 AND created_at = ?4 LIMIT 1`,
      ).bind(row.item_id, row.qty, row.unit_sale_cents, row.created_at).first<{ id: number }>();
      return m?.id ?? null;
    } catch { return null; }
  };
  const moMatch = path.match(/^\/inventory\/manual-outs\/(\d+)\/(edit|revert|delete)$/);
  if (moMatch && method === "POST") {
    if (!can(user.role, "inventory")) return err("forbidden", "Inventory access required", 403);
    let row: { id: number; item_id: number; qty: number; unit_sale_cents: number | null; remark: string; created_at: string; sale_id?: number | null; reverted?: number | null; out_date?: string | null } | null = null;
    try {
      row = await env.DB.prepare(`SELECT * FROM manual_stockouts WHERE id = ?1`).bind(moMatch[1]).first();
    } catch { /* pre-0049 */ }
    if (!row) return err("not_found", "Stock-out record not found", 404);
    const action = moMatch[2];
    const isReverted = (row.reverted ?? 0) === 1;
    if (action === "revert") {
      if (isReverted) return err("invalid_state", "Already reverted — the stock is back on the shelf", 400);
      const item = await env.DB.prepare(`SELECT stock FROM inventory_items WHERE id = ?1`).bind(row.item_id).first<{ stock: number }>();
      if (!item) return err("not_found", "The inventory item behind this record no longer exists", 409);
      /* v1.39.0 (AUDIT minor): revert must respect the row's DIRECTION.
         Reverting an OUT puts pieces back; reverting an IN (a goods receipt,
         a bridge cancel) takes them off again — the old unconditional "+qty"
         double-added stock for every 'in' row. */
      const rowDir = (row as { direction?: string | null }).direction === "in" ? "in" : "out";
      if (rowDir === "in" && item.stock < row.qty) {
        return err("insufficient_stock", `Reverting this stock-IN removes ${row.qty}, but only ${item.stock} remain`, 409);
      }
      const back = rowDir === "in" ? item.stock - row.qty : item.stock + row.qty;
      await env.DB.prepare(
        `UPDATE inventory_items SET stock = ?1, status = ?2, updated_by = ?3, updated_at = datetime('now') WHERE id = ?4`,
      ).bind(back, stockStatus(back), user.id, row.item_id).run();
      const sid = await findManualSaleId(row);
      if (sid) await env.DB.prepare(`DELETE FROM manual_sales WHERE id = ?1`).bind(sid).run();
      try {
        await env.DB.prepare(`UPDATE manual_stockouts SET reverted = 1 WHERE id = ?1`).bind(row.id).run();
      } catch {
        return err("migration_missing", "Run: npx wrangler d1 migrations apply azoneofficial --remote (0050_manual_out_lifecycle)", 500);
      }
      await checkLowStock(row.item_id); // v1.4.191 (recovery resets the alert)
      await audit(env, user.id, "inventory.manual_out_revert", "manual_stockouts", String(row.id),
        { qty: row.qty, unit_sale_cents: row.unit_sale_cents, sale_removed: !!sid });
      return json({ ok: true, stock: back });
    }
    if (action === "delete") {
      /* v1.21.7 (CEO: "I want to have access to delete it from my inventory
         and database. only roles CEO & COO can do this while the rest no
         access") — supersedes the v1.21.4 blanket retirement. Two rules,
         both from his words:
         1. WHO: ceo / coo (+ super_admin safety net) only. Everyone else
            gets 403 and no button in the UI.
         2. WHAT: the record (and its linked manual sale, so the sales
            totals follow) is removed from the database — but the shelf
            quantity is NEVER touched. The v1.21.4 finding stands: a delete
            that silently pushed stock back made inventory inaccurate.
            Revert remains the one way stock moves back.
         The audit row keeps a full snapshot of what was removed. */
      if (!["super_admin", "ceo", "coo"].includes(user.role)) {
        return err("forbidden", "Only the CEO or COO can delete stock movement records", 403);
      }
      const sid = await findManualSaleId(row);
      if (sid) await env.DB.prepare(`DELETE FROM manual_sales WHERE id = ?1`).bind(sid).run();
      await env.DB.prepare(`DELETE FROM manual_stockouts WHERE id = ?1`).bind(row.id).run();
      await audit(env, user.id, "inventory.manual_out_delete", "manual_stockouts", String(row.id), {
        snapshot: { item_id: row.item_id, qty: row.qty, unit_sale_cents: row.unit_sale_cents, remark: row.remark, out_date: row.out_date ?? null, created_at: row.created_at, was_reverted: isReverted },
        sale_removed: !!sid,
        stock_untouched: true,
      });
      return json({ ok: true });
    }
    // action === "edit"
    if (isReverted) return err("invalid_state", "Reverted records can't be edited — record a fresh stock out instead", 400);
    const newQty = typeof body?.qty === "number" && Math.floor(body.qty) > 0 ? Math.floor(body.qty) : null;
    const priceGiven = body?.sale_price !== undefined; // "" clears the sale
    const newSaleC = priceGiven && `${body!.sale_price}` !== "" && Number.isFinite(Number(body!.sale_price)) && Number(body!.sale_price) >= 0
      ? Math.round(Number(body!.sale_price) * 100) : null;
    const newRemark = str(body?.remark, 300) ? (body!.remark as string).trim() : null;
    const newDate = str(body?.out_date, 10) && /^\d{4}-\d{2}-\d{2}$/.test(body!.out_date as string) ? (body!.out_date as string) : null;
    if (newQty === null && !priceGiven && !newRemark && !newDate) return err("invalid_input", "Nothing to update", 400);
    if (newQty !== null && newQty !== row.qty) {
      const item = await env.DB.prepare(`SELECT stock FROM inventory_items WHERE id = ?1`).bind(row.item_id).first<{ stock: number }>();
      if (!item) return err("not_found", "The inventory item behind this record no longer exists", 409);
      const diff = newQty - row.qty; // positive = take MORE out
      if (diff > 0 && item.stock < diff) {
        return err("insufficient_stock", `Only ${item.stock} in stock — cannot raise the out by ${diff}`, 409);
      }
      const adj = item.stock - diff;
      await env.DB.prepare(
        `UPDATE inventory_items SET stock = ?1, status = ?2, updated_by = ?3, updated_at = datetime('now') WHERE id = ?4`,
      ).bind(adj, stockStatus(adj), user.id, row.item_id).run();
    }
    const qtyF = newQty ?? row.qty;
    const saleF = priceGiven ? newSaleC : (row.unit_sale_cents ?? null);
    const dateF = newDate ?? row.out_date ?? null;
    // Sync the manual_sales row: update / create / remove to match saleF.
    const sid = await findManualSaleId(row);
    let sidF: number | null = sid;
    if (saleF !== null) {
      if (sid) {
        await env.DB.prepare(
          `UPDATE manual_sales SET qty = ?1, unit_sale_cents = ?2, total_cents = ?3 WHERE id = ?4`,
        ).bind(qtyF, saleF, qtyF * saleF, sid).run();
        if (dateF) { try { await env.DB.prepare(`UPDATE manual_sales SET out_date = ?1 WHERE id = ?2`).bind(dateF, sid).run(); } catch { /* pre-0050 */ } }
      } else {
        const snap = await env.DB.prepare(`SELECT sku, name FROM inventory_items WHERE id = ?1`).bind(row.item_id).first<{ sku: string; name: string }>();
        try {
          const sr = await env.DB.prepare(
            `INSERT INTO manual_sales (item_id, sku, item_name, qty, unit_sale_cents, total_cents, out_date, created_by)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8) RETURNING id`,
          ).bind(row.item_id, snap?.sku ?? null, snap?.name ?? null, qtyF, saleF, qtyF * saleF, dateF, user.id).first<{ id: number }>();
          sidF = sr?.id ?? null;
        } catch {
          const sr = await env.DB.prepare(
            `INSERT INTO manual_sales (item_id, sku, item_name, qty, unit_sale_cents, total_cents, created_by)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) RETURNING id`,
          ).bind(row.item_id, snap?.sku ?? null, snap?.name ?? null, qtyF, saleF, qtyF * saleF, user.id).first<{ id: number }>();
          sidF = sr?.id ?? null;
        }
      }
    } else if (sid) {
      await env.DB.prepare(`DELETE FROM manual_sales WHERE id = ?1`).bind(sid).run();
      sidF = null;
    }
    try {
      await env.DB.prepare(
        `UPDATE manual_stockouts SET qty = ?1, unit_sale_cents = ?2, remark = COALESCE(?3, remark),
           out_date = COALESCE(?4, out_date), sale_id = ?5 WHERE id = ?6`,
      ).bind(qtyF, saleF, newRemark, newDate, sidF, row.id).run();
    } catch {
      return err("migration_missing", "Run: npx wrangler d1 migrations apply azoneofficial --remote (0050_manual_out_lifecycle)", 500);
    }
    await checkLowStock(row.item_id); // v1.4.191
    await audit(env, user.id, "inventory.manual_out_edit", "manual_stockouts", String(row.id), {
      from: { qty: row.qty, unit_sale_cents: row.unit_sale_cents, out_date: row.out_date ?? null },
      to: { qty: qtyF, unit_sale_cents: saleF, out_date: dateF },
    });
    return json({ ok: true });
  }
  if (path === "/inventory/manual-outs" && method === "GET") {
    // v1.4.170: the traceability list — last 100 manual stock-outs with the
    // remark and who recorded them. Empty (not an error) before 0049.
    if (!can(user.role, "inventory") && !can(user.role, "exec_view")) {
      return err("forbidden", "Inventory access required", 403);
    }
    try {
      const { results } = await env.DB.prepare(
        `SELECT m.*, u.name AS created_by_name FROM manual_stockouts m
         LEFT JOIN users u ON u.id = m.created_by
         ORDER BY m.created_at DESC LIMIT 100`,
      ).all();
      return json({ outs: results });
    } catch {
      return json({ outs: [] });
    }
  }
  if (path === "/inventory/tiktok-out" && method === "GET") {
    /* v1.4.165 (CEO: "how I will know which item are out during live sales in
       TikTok?") — per-item stock OUT that came from TikTok orders. Source of
       truth = postage_items joined to TT- postage records (exactly the rows
       the sync/webhook wrote when it deducted stock); returned orders
       excluded. Today + this month are Malaysia time. */
    if (!can(user.role, "inventory") && !can(user.role, "exec_view")) {
      return err("forbidden", "Inventory access required", 403);
    }
    const nowMYT = new Date(Date.now() + 8 * 3600 * 1000);
    const todayD = nowMYT.toISOString().slice(0, 10);
    const monthD = todayD.slice(0, 7);
    // v1.4.166: also the ACTUAL average sold price per unit (from TikTok's
    // sale_price on each movement) and this month's sold value — so rebate
    // vs list price is visible per item without any manual entry. Falls back
    // to the plain query before migration 0047 lands.
    let results: unknown[];
    try {
      const r = await env.DB.prepare(
        `SELECT pi.inventory_item_id AS id, i.sku, i.name, i.stock, i.unit_price_cents,
                SUM(CASE WHEN date(p.created_at, '+8 hours') = ?1 THEN pi.qty ELSE 0 END) AS today_qty,
                SUM(CASE WHEN strftime('%Y-%m', p.created_at, '+8 hours') = ?2 THEN pi.qty ELSE 0 END) AS month_qty,
                SUM(pi.qty) AS total_qty,
                CAST(ROUND(AVG(pi.unit_sale_cents)) AS INTEGER) AS avg_sale_cents,
                SUM(CASE WHEN strftime('%Y-%m', p.created_at, '+8 hours') = ?2 THEN pi.qty * COALESCE(pi.unit_sale_cents, 0) ELSE 0 END) AS month_value_cents,
                MAX(p.created_at) AS last_at
         FROM postage_items pi
         JOIN postage_records p ON p.id = pi.postage_id
         JOIN inventory_items i ON i.id = pi.inventory_item_id
         WHERE p.order_ref LIKE 'TT-%' AND p.status != 'returned'
         GROUP BY pi.inventory_item_id, i.sku, i.name, i.stock, i.unit_price_cents
         ORDER BY today_qty DESC, month_qty DESC, i.name`,
      ).bind(todayD, monthD).all();
      results = r.results;
    } catch {
      const r = await env.DB.prepare(
        `SELECT pi.inventory_item_id AS id, i.sku, i.name, i.stock,
                SUM(CASE WHEN date(p.created_at, '+8 hours') = ?1 THEN pi.qty ELSE 0 END) AS today_qty,
                SUM(CASE WHEN strftime('%Y-%m', p.created_at, '+8 hours') = ?2 THEN pi.qty ELSE 0 END) AS month_qty,
                SUM(pi.qty) AS total_qty,
                MAX(p.created_at) AS last_at
         FROM postage_items pi
         JOIN postage_records p ON p.id = pi.postage_id
         JOIN inventory_items i ON i.id = pi.inventory_item_id
         WHERE p.order_ref LIKE 'TT-%' AND p.status != 'returned'
         GROUP BY pi.inventory_item_id, i.sku, i.name, i.stock
         ORDER BY today_qty DESC, month_qty DESC, i.name`,
      ).bind(todayD, monthD).all();
      results = r.results;
    }
    return json({ today: todayD, month: monthD, items: results });
  }
  if (path === "/inventory" && method === "POST") {
    if (!can(user.role, "inventory")) return err("forbidden", "Inventory access required", 403);
    if (!body || !str(body.sku, 60) || !str(body.name, 200)) {
      return err("invalid_input", "sku and name are required", 400);
    }
    const stock = typeof body.stock === "number" && body.stock >= 0 ? Math.floor(body.stock) : 0;
    const priceC = typeof body.unit_price === "number" && body.unit_price >= 0 ? Math.round(body.unit_price * 100) : 0; // v1.4.101
    try {
      await env.DB.prepare(
        `INSERT INTO inventory_items (sku, name, stock, status, note, unit_price_cents, updated_by)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
      ).bind(body.sku, body.name, stock, stockStatus(stock), str(body.note, 500) ? body.note : null, priceC, user.id).run();
    } catch {
      return err("conflict", "An item with this SKU already exists", 409);
    }
    /* v1.36.0/v1.39.0 (AUDIT M8): maintain the bridge match key in the same
       breath as every sku write — computed by the SAME JS function the
       movements handler matches with (Unicode uppercase, ALL whitespace
       stripped), bound as a value. The old SQL expression disagreed with the
       JS on tabs/NBSP/non-ASCII, and a stale key looks exactly like an
       unknown_sku from the store. */
    try {
      await env.DB.prepare(
        `UPDATE inventory_items SET sku_key = ?1 WHERE sku = ?2`,
      ).bind(skuKey(body.sku as string), body.sku).run();
    } catch { /* pre-0079 — the migration backfills every key on apply */ }
    await audit(env, user.id, "inventory.create");
    return json({ ok: true }, 201);
  }
  const invMatch = path.match(/^\/inventory\/(\d+)$/);
  if (invMatch && method === "PATCH") {
    if (!can(user.role, "inventory")) return err("forbidden", "Inventory access required", 403);
    if (!body || typeof body.stock !== "number" || body.stock < 0) {
      return err("invalid_input", "stock (>= 0) is required", 400);
    }
    const stock = Math.floor(body.stock);
    const priceU = typeof body.unit_price === "number" && body.unit_price >= 0 ? Math.round(body.unit_price * 100) : null; // v1.4.101
    // v1.4.164: rebate given during TikTok Live — net live price = price − rebate.
    const rebateU = typeof body.live_rebate === "number" && body.live_rebate >= 0 ? Math.round(body.live_rebate * 100) : null;
    try {
      if (rebateU !== null) {
        await env.DB.prepare(
          `UPDATE inventory_items SET stock = ?1, status = ?2,
             note = COALESCE(?3, note), unit_price_cents = COALESCE(?4, unit_price_cents),
             live_rebate_cents = ?5,
             updated_by = ?6, updated_at = datetime('now')
           WHERE id = ?7`,
        ).bind(stock, stockStatus(stock), str(body.note, 500) ? body.note : null, priceU, rebateU, user.id, invMatch[1]).run();
      } else {
        await env.DB.prepare(
          `UPDATE inventory_items SET stock = ?1, status = ?2,
             note = COALESCE(?3, note), unit_price_cents = COALESCE(?4, unit_price_cents),
             updated_by = ?5, updated_at = datetime('now')
           WHERE id = ?6`,
        ).bind(stock, stockStatus(stock), str(body.note, 500) ? body.note : null, priceU, user.id, invMatch[1]).run();
      }
    } catch (e) {
      if (String(e).includes("no such column")) {
        return err("migration_missing", "Run: npx wrangler d1 migrations apply azoneofficial --remote (0046_live_rebate)", 500);
      }
      throw e;
    }
    await audit(env, user.id, "inventory.update", "inventory_items", invMatch[1]);
      await checkLowStock(Number(invMatch[1]));
    return json({ ok: true });
  }
  /* v1.35.0 (CEO: "sync the prices and inventory to ELFIA"): per-item bridge
     controls — whether the ELFIA store may see this item, and the web price
     it must charge. Two rules worth reading before touching this:
     1. elfia_price is the NET price the web customer pays, in RM (stored in
        sen). Empty/null clears it and the feed falls back to unit_price_cents.
        The TikTok live rebate never applies online — a web discount is set
        HERE, explicitly, never inherited from a live session's rebate.
     2. bridge_enabled is the ONLY thing that scopes the feed — the old
        ELFIA%/LUMI% SKU LIKE is gone from the live path, so unticking this
        is how an item is withdrawn from the shop. */
  const invBridge = path.match(/^\/inventory\/(\d+)\/bridge$/);
  if (invBridge && method === "PATCH") {
    if (!can(user.role, "inventory")) return err("forbidden", "Inventory access required", 403);
    const hasEnabled = typeof body?.bridge_enabled === "boolean";
    const priceGiven = body?.elfia_price !== undefined; // "" or null clears the web price
    if (!hasEnabled && !priceGiven) {
      return err("invalid_input", "Provide bridge_enabled and/or elfia_price", 400);
    }
    let priceC: number | null = null;
    if (priceGiven && body!.elfia_price !== null && `${body!.elfia_price}` !== "") {
      const v = Number(body!.elfia_price);
      if (!Number.isFinite(v) || v <= 0) {
        return err("invalid_input", "elfia_price must be a positive amount in RM — or empty to clear it", 400);
      }
      priceC = Math.round(v * 100);
    }
    try {
      if (hasEnabled && priceGiven) {
        await env.DB.prepare(
          `UPDATE inventory_items SET bridge_enabled = ?1, elfia_price_cents = ?2,
             updated_by = ?3, updated_at = datetime('now') WHERE id = ?4`,
        ).bind(body!.bridge_enabled ? 1 : 0, priceC, user.id, invBridge[1]).run();
      } else if (hasEnabled) {
        await env.DB.prepare(
          `UPDATE inventory_items SET bridge_enabled = ?1,
             updated_by = ?2, updated_at = datetime('now') WHERE id = ?3`,
        ).bind(body!.bridge_enabled ? 1 : 0, user.id, invBridge[1]).run();
      } else {
        await env.DB.prepare(
          `UPDATE inventory_items SET elfia_price_cents = ?1,
             updated_by = ?2, updated_at = datetime('now') WHERE id = ?3`,
        ).bind(priceC, user.id, invBridge[1]).run();
      }
    } catch (e) {
      if (String(e).includes("no such column")) {
        return err("migration_missing", "Run: npx wrangler d1 migrations apply azoneofficial --remote (0075-0077, bridge pricing)", 500);
      }
      throw e;
    }
    await audit(env, user.id, "inventory.bridge", "inventory_items", invBridge[1], {
      ...(hasEnabled ? { bridge_enabled: body!.bridge_enabled ? 1 : 0 } : {}),
      ...(priceGiven ? { elfia_price_cents: priceC } : {}),
    });
    return json({ ok: true });
  }
  /* v1.45.0 (CEO: "a new tab for ELFIA on the inventory … photo upload and
     description and product"): the rest of an item's ELFIA dressing —
     collection and description. Whether the item is published at all, and at
     what price, stays on the /bridge route above; this one is everything the
     ELFIA product PAGE shows. Both land in feed A and, for a product the
     store created from this feed, the store keeps them in step. */
  const invElfia = path.match(/^\/inventory\/(\d+)\/elfia$/);
  if (invElfia && method === "PATCH") {
    if (!can(user.role, "inventory")) return err("forbidden", "Inventory access required", 403);
    const hasCategory = body?.category !== undefined;
    const hasDescription = body?.description !== undefined;
    const hasDiscount = body?.discount !== undefined; // v1.46.0 — RM, "" clears
    const removePhoto = body?.remove_photo === true;
    if (!hasCategory && !hasDescription && !hasDiscount && !removePhoto) {
      return err("invalid_input", "Provide category, description, discount and/or remove_photo", 400);
    }
    /* v1.49.0 — the CEO names her own collections.
       "why it is Bawal plain? I think I should be able to add the category
       in the portal so that easier for me to categorized it."
       This used to accept exactly two words, and the shop then split the
       bawal range further by running a regex over the product NAME — which
       is how a shelf called "Bawal Plain" appeared that nobody had chosen.
       Any name is accepted now, in her spelling; the shop groups by what
       arrives and a collection with nothing in it cannot exist. "" clears
       the choice back to the store's default (Bawal). 40 characters is what
       fits a shelf label without wrapping. */
    let category: string | null = null;
    if (hasCategory) {
      const c = String(body!.category ?? "").trim().replace(/\s+/g, " ");
      if (c.length > 40) {
        return err("invalid_input", "A collection name is at most 40 characters", 400);
      }
      category = c === "" ? null : c;
    }
    /* The description is prose for customers, capped where the store caps
       its own (2000). "" clears it; the feed then omits the field and the
       store keeps whatever it has. */
    let description: string | null = null;
    if (hasDescription) {
      const d = String(body!.description ?? "").trim();
      if (d.length > 2000) return err("invalid_input", "Description is longer than 2000 characters", 400);
      description = d === "" ? null : d;
    }
    /* v1.46.0 — the web discount, in RM (stored in sen). The feed subtracts
       it from the web price and sends the pre-discount number alongside, so
       the shop shows "RM 39.00 → RM 36.00". Empty clears it. A discount is
       validated against the CURRENT web price here, at save time, so a typo
       (discount ≥ price) is caught by the person who made it instead of
       silently ignored by the serializer later. */
    let discountC: number | null = null;
    if (hasDiscount && body!.discount !== null && `${body!.discount}` !== "") {
      const v = Number(body!.discount);
      if (!Number.isFinite(v) || v <= 0) {
        return err("invalid_input", "Discount must be a positive RM amount — or empty to clear it", 400);
      }
      discountC = Math.round(v * 100);
      const rowP = await env.DB.prepare(
        `SELECT unit_price_cents, elfia_price_cents FROM inventory_items WHERE id = ?1`,
      ).bind(invElfia[1]).first<{ unit_price_cents: number | null; elfia_price_cents: number | null }>();
      const base = rowP?.elfia_price_cents ?? rowP?.unit_price_cents ?? 0;
      if (base > 0 && discountC >= base) {
        return err("invalid_input", `Discount must be smaller than the web price (RM ${(base / 100).toFixed(2)})`, 400);
      }
    }
    try {
      const sets: string[] = [];
      const vals: (string | number | null)[] = [];
      const push = (col: string, val: string | null) => { sets.push(`${col} = ?${sets.length + 1}`); vals.push(val); };
      if (hasCategory) push("elfia_category", category);
      if (hasDescription) push("elfia_description", description);
      if (hasDiscount) push("elfia_discount_cents", discountC === null ? null : String(discountC));
      if (removePhoto) { push("elfia_image_key", null); push("elfia_image_updated_at", null); }
      await env.DB.prepare(
        `UPDATE inventory_items SET ${sets.join(", ")}, updated_by = ?${sets.length + 1}, updated_at = datetime('now')
         WHERE id = ?${sets.length + 2}`,
      ).bind(...vals, user.id, invElfia[1]).run();
    } catch (e) {
      if (String(e).includes("no such column")) {
        return err("migration_missing", "Run: npx wrangler d1 migrations apply azoneofficial --remote (0086, ELFIA product fields)", 500);
      }
      throw e;
    }
    await audit(env, user.id, "inventory.elfia", "inventory_items", invElfia[1], {
      ...(hasCategory ? { category } : {}),
      ...(hasDescription ? { description_len: description?.length ?? 0 } : {}),
      ...(hasDiscount ? { discount_cents: discountC } : {}),
      ...(removePhoto ? { remove_photo: 1 } : {}),
    });
    return json({ ok: true });
  }

  /* v1.45.0: the product photo the ELFIA store shows — uploaded HERE, once,
     instead of a second time in the store's /admin. A binary body (the route
     ends in /photo, so the JSON gate at the top left the stream alone).

     The key lives under uploads/elfia/ deliberately: uploads/ is the ONE
     public prefix of the media route (v1.5.0 security rewrite), and a
     product photo is public by definition — the store's Worker must be able
     to copy it with no session, and the shop then shows it to the world
     anyway. Nothing else moves prefixes.

     The feed sends the URL + elfia_image_updated_at; the store re-downloads
     only when the marker changes, so replacing a photo here reaches the shop
     within one 5-minute pull and an unchanged one costs nothing. */
  const invElfiaPhoto = path.match(/^\/inventory\/(\d+)\/elfia\/photo$/);
  if (invElfiaPhoto && method === "POST") {
    if (!can(user.role, "inventory")) return err("forbidden", "Inventory access required", 403);
    const ct = (request.headers.get("Content-Type") ?? "").split(";")[0]!.trim().toLowerCase();
    const ext = ct === "image/jpeg" ? "jpg" : ct === "image/png" ? "png" : ct === "image/webp" ? "webp" : null;
    if (!ext) return err("invalid_input", "Only JPEG, PNG or WEBP — the ELFIA store refuses anything else", 400);
    if (!request.body) return err("invalid_input", "Image body required", 400);
    /* The same 5 MB cap the store enforces when it copies the file — a photo
       accepted here that the store then refuses would look synced and never
       arrive. Buffered to measure honestly: Content-Length is advisory. */
    const bytes = await request.arrayBuffer();
    if (bytes.byteLength === 0) return err("invalid_input", "The image was empty", 400);
    if (bytes.byteLength > 5 * 1024 * 1024) {
      return err("too_large", `The image is ${(bytes.byteLength / 1048576).toFixed(1)} MB — the ELFIA store's limit is 5 MB. Compress it and try again.`, 400);
    }
    const item = await env.DB.prepare(`SELECT id, sku FROM inventory_items WHERE id = ?1`)
      .bind(invElfiaPhoto[1]).first<{ id: number; sku: string }>();
    if (!item) return err("not_found", "Inventory item not found", 404);
    const key = `uploads/elfia/${item.id}-${Date.now()}.${ext}`;
    await env.MEDIA.put(key, bytes, { httpMetadata: { contentType: ct } });
    try {
      await env.DB.prepare(
        `UPDATE inventory_items SET elfia_image_key = ?1, elfia_image_updated_at = ?2,
           updated_by = ?3, updated_at = datetime('now') WHERE id = ?4`,
      ).bind(key, new Date().toISOString(), user.id, item.id).run();
    } catch (e) {
      if (String(e).includes("no such column")) {
        return err("migration_missing", "Run: npx wrangler d1 migrations apply azoneofficial --remote (0086, ELFIA product fields)", 500);
      }
      throw e;
    }
    await audit(env, user.id, "inventory.elfia_photo", "inventory_items", String(item.id), { key });
    return json({ image_key: key, url: `/api/v1/media/file/${key}` }, 201);
  }

  /* ==== v1.46.0 — the ELFIA storefront carousel, authored here ====
     The portal is the slides' ONLY owner: the store replaces its set to
     match feed A on every pull, so Remove here really removes on the shop.
     A slide is born from its photo (the photo IS the slide); captions and
     order come after. Photos live under uploads/elfia/slides/ — the public
     media prefix, same reasoning as product photos. */
  /* v1.48.0 — "still the discount is not live update!!!!"
     The store refreshes on its own schedule, so a price changed here lands
     there on the next tick. Correct, and it still felt broken because there
     was no way to say NOW from this tab. This asks the store to sync
     immediately, with the shared bridge key — the same key the feed already
     uses, no admin key, no new secret. */
  if (path === "/elfia/sync-now" && method === "POST") {
    if (!can(user.role, "inventory")) return err("forbidden", "Inventory access required", 403);
    const base = (env.ELFIA_STORE_URL ?? env.ELFIA_ORDERS_URL?.replace(/\/api\/v1\/bridge\/orders.*$/, "") ?? "").replace(/\/+$/, "");
    if (!base || !env.ELFIA_BRIDGE_KEY) {
      return err("not_configured", "The store's address or bridge key is not set on this worker yet — the shop still updates by itself every minute.", 501);
    }
    try {
      const r = await fetch(`${base}/api/v1/bridge/sync-now`, {
        method: "POST",
        headers: { "X-Bridge-Key": env.ELFIA_BRIDGE_KEY },
        signal: AbortSignal.timeout(20_000),
      });
      const body = (await r.json().catch(() => null)) as Record<string, unknown> | null;
      if (!r.ok) {
        return err("store_refused", `The shop answered ${r.status} — it may still be publishing. It updates by itself every minute anyway.`, 502);
      }
      await audit(env, user.id, "elfia.sync_now", "inventory_items", null, body ?? {});
      return json({ ok: true, ...(body ?? {}) });
    } catch {
      return err("store_unreachable", "Could not reach the shop just now. It updates by itself every minute.", 502);
    }
  }

  /* ---- discount many products at once (v1.54.0) ----
     The CEO, 26-08-2026: "for the discount, I want to perform bulk discount
     instead of one by one. but I need to have 1 by 1 update also."

     So this ADDS to the per-item box rather than replacing it: a sale across
     a whole collection is one action here, and a single odd shade is still
     one box on its own row.

     Two ways to say it, because both are things people actually mean:
       amount  — RM 3.00 off each
       percent — 20% off each, worked out from that item's OWN web price
       clear   — remove the discount

     Per-item validation is the SAME rule as the single-item route: a
     discount must be smaller than the price it comes off. A bulk apply must
     not fail wholesale because one cheap shawl cannot take RM 5 off — it
     applies to the ones it can and REPORTS the ones it skipped, by SKU. A
     bulk action that silently does nothing to some rows is worse than one
     that refuses, because nobody checks thirty rows afterwards. */
  if (path === "/elfia/bulk-discount" && method === "POST") {
    if (!can(user.role, "inventory")) return err("forbidden", "Inventory access required", 403);
    const ids = Array.isArray(body?.ids) ? body!.ids as unknown[] : [];
    const clean = [...new Set(ids.map((n) => Number(n)).filter((n) => Number.isInteger(n) && n > 0))];
    if (clean.length === 0) return err("invalid_input", "Select at least one product", 400);
    if (clean.length > 500) return err("invalid_input", "Too many products in one go (max 500)", 400);

    const mode = String(body?.mode ?? "");
    if (!["amount", "percent", "clear"].includes(mode)) {
      return err("invalid_input", "mode must be amount, percent or clear", 400);
    }
    const value = Number(body?.value);
    if (mode === "amount" && (!Number.isFinite(value) || value <= 0 || value > 10000)) {
      return err("invalid_input", "Discount must be a positive RM amount", 400);
    }
    if (mode === "percent" && (!Number.isFinite(value) || value <= 0 || value >= 100)) {
      return err("invalid_input", "Percentage must be above 0 and below 100", 400);
    }

    let rows: { id: number; sku: string; unit_price_cents: number | null; elfia_price_cents: number | null }[];
    try {
      const q = await env.DB.prepare(
        `SELECT id, sku, unit_price_cents, elfia_price_cents FROM inventory_items
         WHERE id IN (${clean.map((_, i) => `?${i + 1}`).join(",")})`,
      ).bind(...clean).all<{ id: number; sku: string; unit_price_cents: number | null; elfia_price_cents: number | null }>();
      rows = q.results;
    } catch {
      return err("migration_missing", "Run: npx wrangler d1 migrations apply azoneofficial --remote (0086, ELFIA product fields)", 500);
    }

    const applied: string[] = [];
    const skipped: { sku: string; why: string }[] = [];
    for (const r of rows) {
      let cents: number | null = null;
      if (mode !== "clear") {
        /* The item's OWN price — the web price when it has one, else the
           list price. This is the same number the feed prices against, so a
           percentage here means what it says on the shop. */
        const base = r.elfia_price_cents ?? r.unit_price_cents ?? 0;
        if (base <= 0) { skipped.push({ sku: r.sku, why: "no price set" }); continue; }
        cents = mode === "percent" ? Math.round(base * value / 100) : Math.round(value * 100);
        if (cents <= 0) { skipped.push({ sku: r.sku, why: "works out to nothing" }); continue; }
        if (cents >= base) {
          skipped.push({ sku: r.sku, why: `RM ${(cents / 100).toFixed(2)} is not less than its RM ${(base / 100).toFixed(2)}` });
          continue;
        }
      }
      await env.DB.prepare(
        `UPDATE inventory_items SET elfia_discount_cents = ?1, updated_by = ?2, updated_at = datetime('now') WHERE id = ?3`,
      ).bind(cents === null ? null : String(cents), user.id, r.id).run();
      applied.push(r.sku);
    }

    await audit(env, user.id, "elfia.bulk_discount", "inventory_items", null,
                { mode, value, applied: applied.length, skipped: skipped.length });
    return json({ ok: true, mode, applied, skipped });
  }

  /* ---- bulk WEB PRICE (v1.63.0) ----
     The CEO, 28-08-2026: "I want to add price update in a bulk."

     The sibling above changes what comes OFF a price; this changes the price
     itself. Three ways, because all three are things a shop actually does:

       set     — every selected item becomes RM X. One price across a
                 collection, the commonest case by far.
       percent — ±X% of each item's OWN current web price, so a range keeps
                 its ladder instead of collapsing to one number.
       amount  — ±RM X on each item's own price, same reasoning.

     `direction` (+1 / −1) carries the sign for percent and amount, so the
     input box never has to accept a minus and a typo cannot silently invert
     a price rise into a cut.

     The same discipline as the bulk discount: per-item validation, and a row
     that cannot take the change is REPORTED by SKU rather than skipped
     quietly. Nobody re-checks thirty rows afterwards.

     One rule that is not obvious and matters: a price change can strand an
     existing discount (RM 5 off a product just repriced to RM 4). Rather
     than ship a negative price or refuse the whole run, a discount that no
     longer fits is CLEARED on that item and named in the reply — the sale
     ends, the price is right, and the shop is told which items lost their
     discount. A price the customer cannot be charged is not an option. */
  if (path === "/elfia/bulk-price" && method === "POST") {
    if (!can(user.role, "inventory")) return err("forbidden", "Inventory access required", 403);
    const ids = Array.isArray(body?.ids) ? body!.ids as unknown[] : [];
    const clean = [...new Set(ids.map((n) => Number(n)).filter((n) => Number.isInteger(n) && n > 0))];
    if (clean.length === 0) return err("invalid_input", "Select at least one product", 400);
    if (clean.length > 500) return err("invalid_input", "Too many products in one go (max 500)", 400);

    const mode = String(body?.mode ?? "");
    if (!["set", "percent", "amount"].includes(mode)) {
      return err("invalid_input", "mode must be set, percent or amount", 400);
    }
    const value = Number(body?.value);
    const direction = Number(body?.direction) === -1 ? -1 : 1;
    if (mode === "set" && (!Number.isFinite(value) || value <= 0 || value > 100000)) {
      return err("invalid_input", "Price must be a positive RM amount", 400);
    }
    if (mode === "percent" && (!Number.isFinite(value) || value <= 0 || value >= 100)) {
      return err("invalid_input", "Percentage must be above 0 and below 100", 400);
    }
    if (mode === "amount" && (!Number.isFinite(value) || value <= 0 || value > 100000)) {
      return err("invalid_input", "Amount must be a positive RM value", 400);
    }

    let rows: { id: number; sku: string; unit_price_cents: number | null; elfia_price_cents: number | null; elfia_discount_cents: number | null }[];
    try {
      const q = await env.DB.prepare(
        `SELECT id, sku, unit_price_cents, elfia_price_cents, elfia_discount_cents
         FROM inventory_items WHERE id IN (${clean.map((_, i) => `?${i + 1}`).join(",")})`,
      ).bind(...clean).all<{ id: number; sku: string; unit_price_cents: number | null; elfia_price_cents: number | null; elfia_discount_cents: number | null }>();
      rows = q.results;
    } catch {
      return err("migration_missing", "Run: npx wrangler d1 migrations apply azoneofficial --remote (0087, ELFIA discount)", 500);
    }

    const applied: { sku: string; from: number | null; to: number }[] = [];
    const skipped: { sku: string; why: string }[] = [];
    const discountCleared: string[] = [];
    for (const r of rows) {
      /* The item's own current web price, falling back to the list price —
         the same base the feed prices against, so "10% off" here means what
         the shop will show. */
      const base = r.elfia_price_cents ?? r.unit_price_cents ?? 0;
      let next: number;
      if (mode === "set") {
        next = Math.round(value * 100);
      } else {
        if (base <= 0) { skipped.push({ sku: r.sku, why: "no price to work from" }); continue; }
        const delta = mode === "percent"
          ? Math.round(base * value / 100)
          : Math.round(value * 100);
        next = base + direction * delta;
      }
      if (!Number.isFinite(next) || next <= 0) {
        skipped.push({ sku: r.sku, why: "would leave the price at zero or below" });
        continue;
      }
      /* A discount that no longer fits under the new price is cleared rather
         than left to make the feed refuse the item silently. */
      const disc = r.elfia_discount_cents;
      const stranded = typeof disc === "number" && disc > 0 && disc >= next;
      await env.DB.prepare(
        stranded
          ? `UPDATE inventory_items SET elfia_price_cents = ?1, elfia_discount_cents = NULL,
               updated_by = ?2, updated_at = datetime('now') WHERE id = ?3`
          : `UPDATE inventory_items SET elfia_price_cents = ?1,
               updated_by = ?2, updated_at = datetime('now') WHERE id = ?3`,
      ).bind(next, user.id, r.id).run();
      if (stranded) discountCleared.push(r.sku);
      applied.push({ sku: r.sku, from: base > 0 ? base : null, to: next });
    }

    await audit(env, user.id, "elfia.bulk_price", "inventory_items", undefined,
                { mode, value, direction, applied: applied.length, skipped: skipped.length,
                  discount_cleared: discountCleared.length });
    return json({ ok: true, mode, applied, skipped, discount_cleared: discountCleared });
  }

  /* ---- FLASH SALE window (v1.63.0) ----
     The CEO, 28-08-2026: "add category for the flash sales and ELFIA should
     have a pill of Flash Sales to make the customer attracted."

     A flash sale is deliberately NOT a category. A product is a bawal or a
     shawl — it does not stop being one because it is on offer this weekend,
     and putting "flash sale" in the category column would cost the shop its
     real grouping for the length of the sale and lose it afterwards.

     It is a DEADLINE on the discount an item already carries. The feed
     (bridge-feed.ts) reads that deadline and stops applying the discount the
     moment it passes, so the price reverts by itself on the next pull with
     nobody having to remember. The store is told the deadline only while it
     is still ahead, which is what it counts down to on the pill.

     `until` is an ISO timestamp; null ENDS the sale now (the discount stays,
     it simply stops being a flash sale and becomes an ordinary one). An item
     with no discount is refused rather than silently marked — a flash sale
     with nothing off it is a lie on the shopfront. */
  if (path === "/elfia/flash-sale" && method === "POST") {
    if (!can(user.role, "inventory")) return err("forbidden", "Inventory access required", 403);
    const ids = Array.isArray(body?.ids) ? body!.ids as unknown[] : [];
    const clean = [...new Set(ids.map((n) => Number(n)).filter((n) => Number.isInteger(n) && n > 0))];
    if (clean.length === 0) return err("invalid_input", "Select at least one product", 400);
    if (clean.length > 500) return err("invalid_input", "Too many products in one go (max 500)", 400);

    const rawUntil = body?.until;
    let until: string | null = null;
    if (rawUntil !== null && rawUntil !== undefined && String(rawUntil).trim() !== "") {
      const t = Date.parse(String(rawUntil));
      if (!Number.isFinite(t)) return err("invalid_input", "That end time is not a valid date and time", 400);
      if (t <= Date.now()) return err("invalid_input", "The end time is already in the past — pick a time ahead of now", 400);
      if (t > Date.now() + 365 * 86400_000) return err("invalid_input", "A flash sale cannot run longer than a year", 400);
      until = new Date(t).toISOString();
    }

    /* v1.68.0 — THE PRICE AND THE DEADLINE, IN ONE ACTION.
       The CEO, 28-08-2026: "how to update the flash sales price? seem it is
       wrong flow." He was right. A flash sale needs a price and an end time,
       and the panel asked for them in two separate rows of the same bar,
       with the flash row refusing anything that had not already been
       discounted somewhere else. That is a workflow that explains itself
       instead of doing the job.
       `discount` is optional, so the old two-step still works and a sale can
       still be started on items already marked down. When it is present it
       is applied FIRST, using exactly the arithmetic /elfia/bulk-discount
       uses, so the two paths can never drift into pricing the same product
       differently. */
    const dMode = String((body?.discount as { mode?: unknown } | undefined)?.mode ?? "");
    const dValue = Number((body?.discount as { value?: unknown } | undefined)?.value);
    const setsDiscount = until !== null && ["amount", "percent"].includes(dMode);
    if (setsDiscount && dMode === "amount" && (!Number.isFinite(dValue) || dValue <= 0 || dValue > 10000)) {
      return err("invalid_input", "The flash price must be a positive RM amount", 400);
    }
    if (setsDiscount && dMode === "percent" && (!Number.isFinite(dValue) || dValue <= 0 || dValue >= 100)) {
      return err("invalid_input", "The flash percentage must be above 0 and below 100", 400);
    }

    let rows: { id: number; sku: string; elfia_discount_cents: number | null;
                unit_price_cents: number | null; elfia_price_cents: number | null }[];
    try {
      const q = await env.DB.prepare(
        `SELECT id, sku, elfia_discount_cents, unit_price_cents, elfia_price_cents FROM inventory_items
         WHERE id IN (${clean.map((_, i) => `?${i + 1}`).join(",")})`,
      ).bind(...clean).all<{ id: number; sku: string; elfia_discount_cents: number | null;
                            unit_price_cents: number | null; elfia_price_cents: number | null }>();
      rows = q.results;
    } catch {
      return err("migration_missing", "Run: npx wrangler d1 migrations apply azoneofficial --remote (0093_elfia_flash_sale)", 500);
    }

    const applied: string[] = [];
    const skipped: { sku: string; why: string }[] = [];
    for (const r of rows) {
      let disc = r.elfia_discount_cents;

      if (setsDiscount) {
        /* The item's OWN price — the web price when it has one, else the
           list price. Same base as /elfia/bulk-discount, deliberately. */
        const base = r.elfia_price_cents ?? r.unit_price_cents ?? 0;
        if (base <= 0) { skipped.push({ sku: r.sku, why: "no price set" }); continue; }
        const cents = dMode === "percent" ? Math.round(base * dValue / 100) : Math.round(dValue * 100);
        if (cents <= 0) { skipped.push({ sku: r.sku, why: "works out to nothing" }); continue; }
        if (cents >= base) { skipped.push({ sku: r.sku, why: "that is the whole price or more" }); continue; }
        try {
          await env.DB.prepare(
            `UPDATE inventory_items SET elfia_discount_cents = ?1, updated_by = ?2,
               updated_at = datetime('now') WHERE id = ?3`,
          ).bind(cents, user.id, r.id).run();
        } catch {
          return err("migration_missing", "Run: npx wrangler d1 migrations apply azoneofficial --remote (0086, ELFIA product fields)", 500);
        }
        disc = cents;
      }

      if (until !== null && !(typeof disc === "number" && disc > 0)) {
        skipped.push({ sku: r.sku, why: "no discount set — set the flash price here, or give it a discount first" });
        continue;
      }
      try {
        await env.DB.prepare(
          `UPDATE inventory_items SET elfia_flash_until = ?1, updated_by = ?2,
             updated_at = datetime('now') WHERE id = ?3`,
        ).bind(until, user.id, r.id).run();
      } catch {
        return err("migration_missing", "Run: npx wrangler d1 migrations apply azoneofficial --remote (0093_elfia_flash_sale)", 500);
      }
      applied.push(r.sku);
    }

    await audit(env, user.id, "elfia.flash_sale", "inventory_items", undefined,
                { until, applied: applied.length, skipped: skipped.length,
                  ...(setsDiscount ? { discount_mode: dMode, discount_value: dValue } : {}) });
    return json({ ok: true, until, applied, skipped });
  }

  /* ---- is online payment actually working? (v1.53.0) ----
     The CEO, 26-08-2026, on the live shop: "This appear on the gateway
     payment!" — customers were being told "Payment gateway unavailable" and
     there was nowhere at all to find out why. The store knows (it now writes
     Billplz's own reply down); this is the window onto it.

     Relayed SERVER-SIDE with the bridge key the portal already holds, so
     nobody has to carry a credential around to see the answer. Read-only on
     both sides: the store's check reads one collection, creates nothing and
     moves no money. */
  if (path === "/elfia/payment-status" && method === "GET") {
    if (!can(user.role, "inventory")) return err("forbidden", "Inventory access required", 403);
    const baseP = (env.ELFIA_STORE_URL ?? env.ELFIA_ORDERS_URL?.replace(/\/api\/v1\/bridge\/orders.*$/, "") ?? "").replace(/\/+$/, "");
    if (!baseP || !env.ELFIA_BRIDGE_KEY) {
      return err("not_configured", "The store's address or bridge key is not set on this worker yet.", 501);
    }
    try {
      const r = await fetch(`${baseP}/api/v1/bridge/payment-check`, {
        headers: { "X-Bridge-Key": env.ELFIA_BRIDGE_KEY },
        signal: AbortSignal.timeout(20_000),
      });
      const b = (await r.json().catch(() => null)) as Record<string, unknown> | null;
      /* A 404 means the shop has not been deployed with this route yet —
         say so, rather than reporting it as a payment failure. */
      if (r.status === 404) {
        return json({ unavailable: true, message: "The shop is running an older version — deploy it to see payment status here." });
      }
      if (!b) return err("store_unreachable", `The shop answered ${r.status} with nothing readable.`, 502);
      return json(b);
    } catch {
      return err("store_unreachable", "Could not reach the shop just now.", 502);
    }
  }

  /* ---- what delivery costs on the shop (v1.52.0) ----
     The CEO, 26-08-2026: "I want to have the authority to update the shipping
     fees which is above RM45.00, I will provide a free delivery fees."

     Two numbers that used to live in the STORE's wrangler.toml, so changing
     them was a code edit and a deploy. They live in system_meta now and ride
     the bridge feed to the shop, which applies them on its next pull (every
     minute, or immediately via "Update the shop now").

     No migration: system_meta is the portal's long-standing key/value table.
     Kept in SEN, like every other money value in both systems — the panel
     does the ringgit conversion, because a mix of units in the database is
     how a shop ends up charging RM 800 for postage. */
  if (path === "/elfia/delivery" && method === "GET") {
    if (!can(user.role, "inventory")) return err("forbidden", "Inventory access required", 403);
    const { results } = await env.DB.prepare(
      `SELECT key, value FROM system_meta WHERE key IN ('elfia_shipping_cents', 'elfia_free_above_cents')`,
    ).all<{ key: string; value: string }>().catch(() => ({ results: [] as { key: string; value: string }[] }));
    const m = Object.fromEntries(results.map((r) => [r.key, r.value]));
    /* null, not 0, when unset — the panel must be able to show "the shop's
       own setting" rather than claim delivery is free. */
    const num = (v: unknown) => {
      const n = Number(v);
      return v === undefined || v === null || v === "" || !Number.isFinite(n) ? null : Math.round(n);
    };
    return json({
      shipping_cents: num(m.elfia_shipping_cents),
      free_above_cents: num(m.elfia_free_above_cents),
    });
  }

  if (path === "/elfia/delivery" && method === "POST") {
    if (!can(user.role, "inventory")) return err("forbidden", "Inventory access required", 403);
    /* Both required together. Saving one of a pair of numbers that only make
       sense side by side is how you end up with free delivery above RM 0. */
    const asSen = (v: unknown): number | null => {
      if (v === undefined || v === null || v === "") return null;
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0 || n > 100_000) return null;
      return Math.round(n);
    };
    const ship = asSen(body?.shipping_cents);
    const free = asSen(body?.free_above_cents);
    if (ship === null || free === null) {
      return err("invalid_input", "Both amounts are required, in sen, between RM 0.00 and RM 1,000.00", 400);
    }
    await env.DB.prepare(
      `INSERT INTO system_meta (key, value) VALUES ('elfia_shipping_cents', ?1)
       ON CONFLICT(key) DO UPDATE SET value = ?1`).bind(String(ship)).run();
    await env.DB.prepare(
      `INSERT INTO system_meta (key, value) VALUES ('elfia_free_above_cents', ?1)
       ON CONFLICT(key) DO UPDATE SET value = ?1`).bind(String(free)).run();
    await audit(env, user.id, "elfia.delivery", "inventory_items", null,
                { shipping_cents: ship, free_above_cents: free });
    return json({ ok: true, shipping_cents: ship, free_above_cents: free });
  }

  /* ==== v1.55.0 — the shop catalog, uploaded HERE, priced by the shop ====
     The CEO: "the portal can upload the PDF for this catalog without the
     prices tag and it will automatically live price embedded to the PDF
     uploaded."

     Three pieces travel to the store: the PDF (binary, this route), the
     label map her browser extracted at upload (JSON, /elfia/catalog/map),
     and the cover image (/elfia/catalog/cover). The MAP is what flips the
     switch: only its route stamps elfia_catalog_updated_at, and the feed
     emits the catalog key only when PDF + map + marker all exist. So a
     half-done upload (PDF in, map not yet) is invisible to the store, and
     the store can never price a new file with an old file's map.

     Keys are timestamped (the media route serves uploads/ as immutable) and
     live under uploads/elfia/ — public by definition: the store's Worker
     fetches them with no session, then the shop hands the priced PDF to the
     world. No migration: system_meta holds the pointers. */
  const catalogMeta = async (): Promise<Record<string, string>> => {
    const { results } = await env.DB.prepare(
      `SELECT key, value FROM system_meta WHERE key IN ('elfia_catalog_pdf_key', 'elfia_catalog_map_key', 'elfia_catalog_cover_key', 'elfia_catalog_updated_at')`,
    ).all<{ key: string; value: string }>().catch(() => ({ results: [] as { key: string; value: string }[] }));
    return Object.fromEntries(results.map((r) => [r.key, r.value]));
  };
  const catalogMetaSet = (key: string, value: string) => env.DB.prepare(
    `INSERT INTO system_meta (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = ?2`,
  ).bind(key, value).run();

  if (path === "/elfia/catalog" && method === "GET") {
    if (!can(user.role, "inventory")) return err("forbidden", "Inventory access required", 403);
    const m = await catalogMeta();
    const live = Boolean(m.elfia_catalog_pdf_key && m.elfia_catalog_map_key && m.elfia_catalog_updated_at);
    return json({
      live,
      pdf_key: m.elfia_catalog_pdf_key ?? null,
      map_key: m.elfia_catalog_map_key ?? null,
      cover_key: m.elfia_catalog_cover_key ?? null,
      updated_at: m.elfia_catalog_updated_at ?? null,
      /* Half-uploaded (PDF stored, map pending) — the panel resumes or
         replaces; the store has seen nothing. */
      pending: Boolean(m.elfia_catalog_pdf_key) && !live,
    });
  }

  if (path === "/elfia/catalog" && method === "POST") {
    if (!can(user.role, "inventory")) return err("forbidden", "Inventory access required", 403);
    const ct = (request.headers.get("Content-Type") ?? "").split(";")[0]!.trim().toLowerCase();
    if (ct !== "application/pdf") return err("invalid_input", "The catalog must be a PDF", 400);
    if (!request.body) return err("invalid_input", "PDF body required", 400);
    const bytes = await request.arrayBuffer();
    /* 10 MB here, under the store's own 15 MB refusal — a file accepted here
       that the store then refuses would look synced and never arrive. */
    if (bytes.byteLength === 0) return err("invalid_input", "The file was empty", 400);
    if (bytes.byteLength > 10 * 1024 * 1024) {
      return err("too_large", `The PDF is ${(bytes.byteLength / 1048576).toFixed(1)} MB — the limit is 10 MB. Export it smaller and try again.`, 400);
    }
    const head = new Uint8Array(bytes.slice(0, 5));
    if (String.fromCharCode(...head) !== "%PDF-") {
      return err("invalid_input", "That file is not a PDF inside, whatever its name says", 400);
    }
    const m = await catalogMeta();
    const key = `uploads/elfia/catalog-${Date.now()}.pdf`;
    await env.MEDIA.put(key, bytes, { httpMetadata: { contentType: "application/pdf" } });
    await catalogMetaSet("elfia_catalog_pdf_key", key);
    /* A NEW PDF invalidates the old map — the marker is cleared so the feed
       goes quiet until the new map arrives. The store keeps serving what it
       already downloaded; nothing half-new ever reaches it. */
    await env.DB.prepare(`DELETE FROM system_meta WHERE key IN ('elfia_catalog_map_key', 'elfia_catalog_updated_at')`).run();
    if (m.elfia_catalog_pdf_key) await env.MEDIA.delete(m.elfia_catalog_pdf_key).catch(() => null);
    if (m.elfia_catalog_map_key) await env.MEDIA.delete(m.elfia_catalog_map_key).catch(() => null);
    await audit(env, user.id, "elfia.catalog_pdf", "inventory_items", null, { key, bytes: bytes.byteLength });
    return json({ pdf_key: key, url: `/api/v1/media/file/${key}` }, 201);
  }

  if (path === "/elfia/catalog/cover" && method === "POST") {
    if (!can(user.role, "inventory")) return err("forbidden", "Inventory access required", 403);
    const ct = (request.headers.get("Content-Type") ?? "").split(";")[0]!.trim().toLowerCase();
    if (ct !== "image/jpeg") return err("invalid_input", "The cover must be a JPEG — the panel renders it from page 1", 400);
    if (!request.body) return err("invalid_input", "Image body required", 400);
    const bytes = await request.arrayBuffer();
    if (bytes.byteLength === 0) return err("invalid_input", "The image was empty", 400);
    if (bytes.byteLength > 5 * 1024 * 1024) return err("too_large", "The cover is over 5 MB", 400);
    const m = await catalogMeta();
    const key = `uploads/elfia/catalog-cover-${Date.now()}.jpg`;
    await env.MEDIA.put(key, bytes, { httpMetadata: { contentType: "image/jpeg" } });
    await catalogMetaSet("elfia_catalog_cover_key", key);
    if (m.elfia_catalog_cover_key) await env.MEDIA.delete(m.elfia_catalog_cover_key).catch(() => null);
    await audit(env, user.id, "elfia.catalog_cover", "inventory_items", null, { key });
    return json({ cover_key: key, url: `/api/v1/media/file/${key}` }, 201);
  }

  if (path === "/elfia/catalog/map" && method === "POST") {
    if (!can(user.role, "inventory")) return err("forbidden", "Inventory access required", 403);
    /* The same shape the store's parseUploadedMap enforces — refused HERE so
       the CEO hears about a bad extraction at upload, not as a silent
       photo_error on the store's next pull. */
    const map = body?.map as { version?: unknown; pages?: unknown; sites?: unknown; price_sites?: unknown } | undefined;
    const badRect = (o: Record<string, unknown>): boolean =>
      !o || typeof o !== "object"
      || !Number.isInteger(o.page) || (o.page as number) < 0
      || ![o.x0, o.y0, o.x1, o.y1].every((n) => typeof n === "number" && Number.isFinite(n));
    const badSite = (s: unknown): boolean => {
      const o = s as Record<string, unknown>;
      return badRect(o)
        || typeof o?.label !== "string" || o.label === "" || (o.label as string).length > 120;
    };
    /* v1.57.0 — printed prices travel too: place + sampled background, so
       the store can cover each one invisibly and write the live price. */
    const badRGB = (c: unknown): boolean => c !== undefined
      && (!Array.isArray(c) || c.length !== 3
          || !(c as unknown[]).every((v) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 255));
    const badPrice = (s: unknown): boolean => {
      const o = s as Record<string, unknown>;
      return badRect(o) || badRGB(o.bg) || badRGB(o.ink);
    };
    if (!map || map.version !== 1
        || !Array.isArray(map.pages) || map.pages.length === 0 || map.pages.length > 100
        || !map.pages.every((p) => p && typeof (p as Record<string, unknown>).w === "number" && typeof (p as Record<string, unknown>).h === "number")
        || !Array.isArray(map.sites) || map.sites.length === 0 || map.sites.length > 300
        || map.sites.some(badSite)
        || (map.price_sites !== undefined
            && (!Array.isArray(map.price_sites) || map.price_sites.length > 300 || map.price_sites.some(badPrice)))) {
      return err("invalid_input", "The label map is not usable — re-open the PDF in the panel so it can be read again", 400);
    }
    const m = await catalogMeta();
    if (!m.elfia_catalog_pdf_key) {
      return err("invalid_input", "Upload the PDF first — a map with no file to describe prices nothing", 409);
    }
    const mapText = JSON.stringify({
      version: 1, pages: map.pages, sites: map.sites,
      ...(map.price_sites !== undefined ? { price_sites: map.price_sites } : {}),
    });
    if (mapText.length > 1024 * 1024) return err("too_large", "The label map is over 1 MB", 400);
    const key = `uploads/elfia/catalog-map-${Date.now()}.json`;
    await env.MEDIA.put(key, mapText, { httpMetadata: { contentType: "application/json" } });
    await catalogMetaSet("elfia_catalog_map_key", key);
    /* THE switch: with PDF + map + marker all set, the next feed carries the
       catalog and the store downloads the three together. */
    const marker = new Date().toISOString();
    await catalogMetaSet("elfia_catalog_updated_at", marker);
    if (m.elfia_catalog_map_key) await env.MEDIA.delete(m.elfia_catalog_map_key).catch(() => null);
    await audit(env, user.id, "elfia.catalog_map", "inventory_items", null, { key, sites: (map.sites as unknown[]).length });
    return json({ map_key: key, updated_at: marker, live: true }, 201);
  }

  if (path === "/elfia/catalog" && method === "DELETE") {
    if (!can(user.role, "inventory")) return err("forbidden", "Inventory access required", 403);
    const m = await catalogMeta();
    for (const k of [m.elfia_catalog_pdf_key, m.elfia_catalog_map_key, m.elfia_catalog_cover_key]) {
      if (k) await env.MEDIA.delete(k).catch(() => null);
    }
    await env.DB.prepare(
      `DELETE FROM system_meta WHERE key IN ('elfia_catalog_pdf_key', 'elfia_catalog_map_key', 'elfia_catalog_cover_key', 'elfia_catalog_updated_at')`,
    ).run();
    /* Dropping the feed key alone would NOT undo anything — absent means
       "keep what you have", the feed's oldest rule. The store has its own
       reset door for exactly this, so ask it directly; best-effort, because
       the shop also serves fine with the copy it holds until it hears. */
    let store_reset = false;
    const base = (env.ELFIA_STORE_URL ?? env.ELFIA_ORDERS_URL?.replace(/\/api\/v1\/bridge\/orders.*$/, "") ?? "").replace(/\/+$/, "");
    if (base && env.ELFIA_BRIDGE_KEY) {
      try {
        const r = await fetch(`${base}/api/v1/bridge/catalog`, {
          method: "DELETE",
          headers: { "X-Bridge-Key": env.ELFIA_BRIDGE_KEY },
          signal: AbortSignal.timeout(20_000),
        });
        store_reset = r.ok;
      } catch { /* the shop keeps its copy until it hears; report honestly */ }
    }
    await audit(env, user.id, "elfia.catalog_remove", "inventory_items", null, { store_reset });
    return json({ ok: true, store_reset });
  }

  /* ==== v1.61.0 — the /catalog hover backdrop ====
     The CEO: "for the cut out background I want to have an option for me to
     add this background if require and this I can upload by myself in
     portal!" One optional image the shop draws behind every catalog tile's
     cut-out photo on hover. Uploading here stamps the marker and the feed
     carries it; nothing uploaded = the shop's shipped ELFIA backdrop.
     Removing it asks the store's reset door directly, like the catalog. */
  const backdropMeta = async (): Promise<Record<string, string>> => {
    const { results } = await env.DB.prepare(
      `SELECT key, value FROM system_meta WHERE key IN ('elfia_backdrop_key', 'elfia_backdrop_updated_at')`,
    ).all<{ key: string; value: string }>().catch(() => ({ results: [] as { key: string; value: string }[] }));
    return Object.fromEntries(results.map((r) => [r.key, r.value]));
  };
  const backdropMetaSet = (key: string, value: string) => env.DB.prepare(
    `INSERT INTO system_meta (key, value) VALUES (?1, ?2)
     ON CONFLICT(key) DO UPDATE SET value = ?2`,
  ).bind(key, value).run();

  if (path === "/elfia/backdrop" && method === "GET") {
    if (!can(user.role, "inventory")) return err("forbidden", "Inventory access required", 403);
    const m = await backdropMeta();
    return json({
      key: m.elfia_backdrop_key ?? null,
      updated_at: m.elfia_backdrop_updated_at ?? null,
      url: m.elfia_backdrop_key ? `/api/v1/media/file/${m.elfia_backdrop_key}` : null,
    });
  }

  if (path === "/elfia/backdrop" && method === "POST") {
    if (!can(user.role, "inventory")) return err("forbidden", "Inventory access required", 403);
    const ct = (request.headers.get("Content-Type") ?? "").split(";")[0]!.trim().toLowerCase();
    const ext = ct === "image/jpeg" ? "jpg" : ct === "image/png" ? "png" : ct === "image/webp" ? "webp" : null;
    if (!ext) return err("invalid_input", "The backdrop must be a JPEG, PNG or WebP image", 400);
    const bytes = await request.arrayBuffer();
    if (bytes.byteLength === 0) return err("invalid_input", "Empty file", 400);
    if (bytes.byteLength > 5 * 1024 * 1024) return err("too_large", "The backdrop is over 5 MB", 400);
    const m = await backdropMeta();
    const key = `uploads/elfia/backdrop-${Date.now()}.${ext}`;
    await env.MEDIA.put(key, bytes, { httpMetadata: { contentType: ct } });
    await backdropMetaSet("elfia_backdrop_key", key);
    /* The marker IS the switch: the store re-downloads exactly once per
       stamp, so it moves on every upload, replacements included. */
    await backdropMetaSet("elfia_backdrop_updated_at", new Date().toISOString());
    if (m.elfia_backdrop_key) await env.MEDIA.delete(m.elfia_backdrop_key).catch(() => null);
    await audit(env, user.id, "elfia.backdrop", "inventory_items", null, { key, bytes: bytes.byteLength });
    return json({ key, url: `/api/v1/media/file/${key}` }, 201);
  }

  if (path === "/elfia/backdrop" && method === "DELETE") {
    if (!can(user.role, "inventory")) return err("forbidden", "Inventory access required", 403);
    const m = await backdropMeta();
    if (m.elfia_backdrop_key) await env.MEDIA.delete(m.elfia_backdrop_key).catch(() => null);
    await env.DB.prepare(
      `DELETE FROM system_meta WHERE key IN ('elfia_backdrop_key', 'elfia_backdrop_updated_at')`,
    ).run();
    /* Same reasoning as the catalog's DELETE above: absent on the feed means
       "keep what you have", so the store is asked directly to fall back to
       its shipped backdrop; best-effort, reported honestly. */
    let store_reset = false;
    const bdBase = (env.ELFIA_STORE_URL ?? env.ELFIA_ORDERS_URL?.replace(/\/api\/v1\/bridge\/orders.*$/, "") ?? "").replace(/\/+$/, "");
    if (bdBase && env.ELFIA_BRIDGE_KEY) {
      try {
        const r = await fetch(`${bdBase}/api/v1/bridge/backdrop`, {
          method: "DELETE",
          headers: { "X-Bridge-Key": env.ELFIA_BRIDGE_KEY },
          signal: AbortSignal.timeout(20_000),
        });
        store_reset = r.ok;
      } catch { /* the shop keeps its copy until it hears; report honestly */ }
    }
    await audit(env, user.id, "elfia.backdrop_remove", "inventory_items", null, { store_reset });
    return json({ ok: true, store_reset });
  }

  if (path === "/elfia/slides" && method === "GET") {
    if (!can(user.role, "inventory")) return err("forbidden", "Inventory access required", 403);
    try {
      /* v1.47.0 framing columns, with the pre-0088 fallback — the tab must
         keep working if this worker is published before the migration. */
      let results: Record<string, unknown>[];
      try {
        results = (await env.DB.prepare(
          `SELECT id, image_key, image_updated_at, title, subtitle, sort, active, focus_x, focus_y, fit, zoom,
                  cutout_key, cutout_updated_at, cutout_side, cutout_scale
           FROM elfia_slides ORDER BY sort, id`,
        ).all()).results;
      } catch {
        results = (await env.DB.prepare(
          `SELECT id, image_key, image_updated_at, title, subtitle, sort, active
           FROM elfia_slides ORDER BY sort, id`,
        ).all()).results;
      }
      return json({ slides: results });
    } catch {
      return err("migration_missing", "Run: npx wrangler d1 migrations apply azoneofficial --remote (0087, ELFIA discount + carousel)", 500);
    }
  }
  /* One binary route covers create AND replace: /elfia/slides/photo makes a
     new slide from the body; /elfia/slides/:id/photo re-shoots an existing
     one (and moves its marker, so the store re-downloads exactly once). */
  const slidePhoto = path.match(/^\/elfia\/slides(?:\/(\d+))?\/photo$/);
  if (slidePhoto && method === "POST") {
    if (!can(user.role, "inventory")) return err("forbidden", "Inventory access required", 403);
    const ct = (request.headers.get("Content-Type") ?? "").split(";")[0]!.trim().toLowerCase();
    const ext = ct === "image/jpeg" ? "jpg" : ct === "image/png" ? "png" : ct === "image/webp" ? "webp" : null;
    if (!ext) return err("invalid_input", "Only JPEG, PNG or WEBP — the ELFIA store refuses anything else", 400);
    if (!request.body) return err("invalid_input", "Image body required", 400);
    const bytes = await request.arrayBuffer();
    if (bytes.byteLength === 0) return err("invalid_input", "The image was empty", 400);
    if (bytes.byteLength > 5 * 1024 * 1024) {
      return err("too_large", `The image is ${(bytes.byteLength / 1048576).toFixed(1)} MB — the ELFIA store's limit is 5 MB. Compress it and try again.`, 400);
    }
    const marker = new Date().toISOString();
    try {
      if (slidePhoto[1]) {
        const row = await env.DB.prepare(`SELECT id FROM elfia_slides WHERE id = ?1`).bind(slidePhoto[1]).first();
        if (!row) return err("not_found", "Slide not found", 404);
        const key = `uploads/elfia/slides/${slidePhoto[1]}-${Date.now()}.${ext}`;
        await env.MEDIA.put(key, bytes, { httpMetadata: { contentType: ct } });
        await env.DB.prepare(
          `UPDATE elfia_slides SET image_key = ?1, image_updated_at = ?2, updated_at = datetime('now') WHERE id = ?3`,
        ).bind(key, marker, slidePhoto[1]).run();
        await audit(env, user.id, "elfia.slide_photo", "elfia_slides", slidePhoto[1], { key });
        return json({ id: Number(slidePhoto[1]), image_key: key, url: `/api/v1/media/file/${key}` });
      }
      /* create: two steps because the key carries the id. The placeholder
         row is never visible anywhere — the very next statement fills it. */
      const created = await env.DB.prepare(
        `INSERT INTO elfia_slides (image_key, image_updated_at, sort, active, created_by)
         VALUES ('', ?1, COALESCE((SELECT MAX(sort) + 10 FROM elfia_slides), 100), 1, ?2) RETURNING id`,
      ).bind(marker, user.id).first<{ id: number }>();
      if (!created) return err("server_error", "Could not create the slide", 500);
      const key = `uploads/elfia/slides/${created.id}-${Date.now()}.${ext}`;
      await env.MEDIA.put(key, bytes, { httpMetadata: { contentType: ct } });
      await env.DB.prepare(`UPDATE elfia_slides SET image_key = ?1 WHERE id = ?2`).bind(key, created.id).run();
      await audit(env, user.id, "elfia.slide_create", "elfia_slides", String(created.id), { key });
      return json({ id: created.id, image_key: key, url: `/api/v1/media/file/${key}` }, 201);
    } catch (e) {
      if (String(e).includes("no such table")) {
        return err("migration_missing", "Run: npx wrangler d1 migrations apply azoneofficial --remote (0087, ELFIA discount + carousel)", 500);
      }
      throw e;
    }
  }
  /* v1.50.0 — the cut-out PNG for one slide. Same shape as the slide photo
     route above, with one difference that matters: PNG and WEBP only. A
     JPEG cannot hold transparency, so a JPEG here would paint a white box
     over the banner — refusing it with a sentence is kinder than shipping
     that to the shop. */
  const cutoutPhoto = path.match(/^\/elfia\/slides\/(\d+)\/cutout$/);
  if (cutoutPhoto && method === "POST") {
    if (!can(user.role, "inventory")) return err("forbidden", "Inventory access required", 403);
    const ct = (request.headers.get("Content-Type") ?? "").split(";")[0]!.trim().toLowerCase();
    const ext = ct === "image/png" ? "png" : ct === "image/webp" ? "webp" : null;
    if (!ext) {
      return err("invalid_input", "A cut-out must be a PNG or WEBP with a see-through background — a JPEG cannot be see-through and would show as a white box.", 400);
    }
    if (!request.body) return err("invalid_input", "Image body required", 400);
    const bytes = await request.arrayBuffer();
    if (bytes.byteLength === 0) return err("invalid_input", "The image was empty", 400);
    if (bytes.byteLength > 5 * 1024 * 1024) {
      return err("too_large", `The image is ${(bytes.byteLength / 1048576).toFixed(1)} MB — the ELFIA store's limit is 5 MB. Compress it and try again.`, 400);
    }
    const marker = new Date().toISOString();
    try {
      const row = await env.DB.prepare(`SELECT id FROM elfia_slides WHERE id = ?1`).bind(cutoutPhoto[1]).first();
      if (!row) return err("not_found", "Slide not found", 404);
      const key = `uploads/elfia/slides/cut-${cutoutPhoto[1]}-${Date.now()}.${ext}`;
      await env.MEDIA.put(key, bytes, { httpMetadata: { contentType: ct } });
      await env.DB.prepare(
        `UPDATE elfia_slides SET cutout_key = ?1, cutout_updated_at = ?2, updated_at = datetime('now') WHERE id = ?3`,
      ).bind(key, marker, cutoutPhoto[1]).run();
      await audit(env, user.id, "elfia.slide_cutout", "elfia_slides", cutoutPhoto[1], { key });
      return json({ id: Number(cutoutPhoto[1]), cutout_key: key, url: `/api/v1/media/file/${key}` }, 201);
    } catch (e) {
      if (String(e).includes("no such column") || String(e).includes("no such table")) {
        return err("migration_missing", "Run: npx wrangler d1 migrations apply azoneofficial --remote (0090, the carousel cut-out)", 500);
      }
      throw e;
    }
  }

  const slideEdit = path.match(/^\/elfia\/slides\/(\d+)$/);
  if (slideEdit && method === "PATCH") {
    if (!can(user.role, "inventory")) return err("forbidden", "Inventory access required", 403);
    try {
      if (body?.remove === true) {
        await env.DB.prepare(`DELETE FROM elfia_slides WHERE id = ?1`).bind(slideEdit[1]).run();
        await audit(env, user.id, "elfia.slide_remove", "elfia_slides", slideEdit[1]);
        return json({ ok: true });
      }
      const sets: string[] = [];
      const vals: (string | number | null)[] = [];
      const push = (col: string, val: string | number | null) => { sets.push(`${col} = ?${sets.length + 1}`); vals.push(val); };
      if (body?.title !== undefined) push("title", String(body.title ?? "").trim().slice(0, 120) || null);
      if (body?.subtitle !== undefined) push("subtitle", String(body.subtitle ?? "").trim().slice(0, 200) || null);
      if (body?.sort !== undefined && Number.isFinite(Number(body.sort))) push("sort", Math.round(Number(body.sort)));
      if (body?.active !== undefined) push("active", body.active ? 1 : 0);
      /* v1.47.0 — framing. The CEO clicks the spot on the photo that must
         survive the shop's crop; that arrives here as two percentages.
         Clamped rather than rejected: a click a pixel outside the image is
         a slip of the finger, not an error worth a red message. */
      if (body?.focus_x !== undefined && Number.isFinite(Number(body.focus_x))) {
        push("focus_x", Math.min(100, Math.max(0, Math.round(Number(body.focus_x)))));
      }
      if (body?.focus_y !== undefined && Number.isFinite(Number(body.focus_y))) {
        push("focus_y", Math.min(100, Math.max(0, Math.round(Number(body.focus_y)))));
      }
      if (body?.fit !== undefined) push("fit", body.fit === "contain" ? "contain" : "cover");
      /* v1.48.0 — zoom, the CEO's actual ask ("I want to zoom out at least I
         can see the full"). 100 = the whole photo inside the banner; higher
         grows it and the banner crops. `fit` is kept in step so an older
         store that only understands the switch still behaves sensibly. */
      /* v1.50.0 — the cut-out's placement. The file itself arrives on the
         binary route below; these two only say where she stands and how
         tall she is, so they are cheap text edits like a caption. */
      if (body?.cutout_side !== undefined) push("cutout_side", body.cutout_side === "left" ? "left" : "right");
      if (body?.cutout_scale !== undefined && Number.isFinite(Number(body.cutout_scale))) {
        push("cutout_scale", Math.min(160, Math.max(100, Math.round(Number(body.cutout_scale)))));
      }
      if (body?.remove_cutout === true) { push("cutout_key", null); push("cutout_updated_at", null); }
      if (body?.zoom !== undefined && Number.isFinite(Number(body.zoom))) {
        const z = Math.min(300, Math.max(100, Math.round(Number(body.zoom))));
        push("zoom", z);
        if (body?.fit === undefined) push("fit", z <= 100 ? "contain" : "cover");
      }
      if (sets.length === 0) return err("invalid_input", "Nothing to update", 400);
      await env.DB.prepare(
        `UPDATE elfia_slides SET ${sets.join(", ")}, updated_at = datetime('now') WHERE id = ?${sets.length + 1}`,
      ).bind(...vals, slideEdit[1]).run();
      await audit(env, user.id, "elfia.slide_update", "elfia_slides", slideEdit[1]);
      return json({ ok: true });
    } catch (e) {
      if (String(e).includes("no such table")) {
        return err("migration_missing", "Run: npx wrangler d1 migrations apply azoneofficial --remote (0087, ELFIA discount + carousel)", 500);
      }
      throw e;
    }
  }

  /* v1.36.0: the bridge's pulse for the Inventory tab — last movement in,
     24-hour applied/ignored counts (ignored > 0 = the dedupe working, not a
     fault), and the unknown_sku list that MUST be actioned by a human. */
  if (path === "/inventory/bridge-health" && method === "GET") {
    if (!can(user.role, "inventory") && !can(user.role, "exec_view")) {
      return err("forbidden", "Inventory access required", 403);
    }
    /* Dedupe hits ("ignored") leave no second row BY DESIGN, so this card
       reports what the table can honestly answer: applied and unknown. */
    const out: Record<string, unknown> = { key_configured: false, last_event_at: null, applied_24h: 0, unknown_24h: 0, unknown: [] };
    out.key_configured = !!(env as unknown as { ELFIA_BRIDGE_KEY?: string }).ELFIA_BRIDGE_KEY;
    try {
      out.last_event_at = (await env.DB.prepare(`SELECT MAX(received_at) AS t FROM bridge_events`)
        .first<{ t: string | null }>())?.t ?? null;
      const counts = await env.DB.prepare(
        `SELECT outcome, COUNT(*) AS n FROM bridge_events
         WHERE received_at > datetime('now', '-1 day') GROUP BY outcome`,
      ).all<{ outcome: string; n: number }>();
      for (const c of counts.results) {
        if (c.outcome === "applied") out.applied_24h = c.n;
        if (c.outcome === "unknown_sku") out.unknown_24h = c.n;
      }
      const unk = await env.DB.prepare(
        `SELECT sku, COUNT(*) AS n, MAX(received_at) AS last_at FROM bridge_events
         WHERE outcome = 'unknown_sku' GROUP BY sku_key ORDER BY last_at DESC LIMIT 20`,
      ).all<{ sku: string; n: number; last_at: string }>();
      out.unknown = unk.results;
    } catch { /* pre-0076 — the card shows "not migrated yet" */ out.pending_migration = true; }
    try {
      out.last_poll_at = (await env.DB.prepare(`SELECT value FROM system_meta WHERE key = 'elfia_last_poll'`)
        .first<{ value: string }>())?.value ?? null;
    } catch { out.last_poll_at = null; }
    /* v1.39.0 (AUDIT M5/M8): the counters that make silent paths visible —
       orders the poller had to reject, paid-then-cancelled orders awaiting a
       refund decision, items whose match key is missing, and normalised-key
       collisions (two SKUs that would answer to the same store code). */
    try {
      out.rejected_orders = Number((await env.DB.prepare(
        `SELECT value FROM system_meta WHERE key = 'elfia_orders_rejected'`,
      ).first<{ value: string }>())?.value) || 0;
    } catch { out.rejected_orders = 0; }
    try {
      out.refunds_pending = (await env.DB.prepare(
        `SELECT COUNT(*) AS n FROM web_orders WHERE refund_flagged_at IS NOT NULL AND status = 'cancelled'`,
      ).first<{ n: number }>())?.n ?? 0;
    } catch { out.refunds_pending = 0; }
    try {
      out.sku_key_missing = (await env.DB.prepare(
        `SELECT COUNT(*) AS n FROM inventory_items WHERE sku_key IS NULL`,
      ).first<{ n: number }>())?.n ?? 0;
      const { results: coll } = await env.DB.prepare(
        `SELECT sku_key, COUNT(*) AS n FROM inventory_items
         WHERE sku_key IS NOT NULL GROUP BY sku_key HAVING n > 1 LIMIT 10`,
      ).all<{ sku_key: string; n: number }>();
      out.sku_key_collisions = coll;
    } catch { out.sku_key_missing = 0; out.sku_key_collisions = []; }
    return json(out);
  }
  /* v1.37.0: web orders pulled from the store — read-only surface. The store
     owns the order; the portal monitors it. */
  /* v1.51.0 — move an ELFIA order forward FROM HERE.
     The CEO: "elfia web order should be able to update the tracking number
     so that customer can track the order based on the order number that
     filled by staff in the portal". This tab could only watch; confirming a
     payment and entering a tracking number still needed the store's /admin,
     which is unreachable because its ADMIN_KEY was never set.
     The store owns the transition rules (forward-only, cancel puts stock
     back and reports the movement) and exposes them on its bridge; this
     route is a thin, authenticated relay, so the two screens can never
     disagree about what an action means. */
  const orderAct = path.match(/^\/web-orders\/([A-Za-z0-9-]{1,40})\/action$/);
  if (orderAct && method === "POST") {
    /* Same gate as reading the tab, minus exec_view: looking at an order is
       not the same as moving somebody's money and stock. */
    if (!can(user.role, "sales") && !can(user.role, "inventory")) {
      return err("forbidden", "Sales or Inventory access required", 403);
    }
    const base = (env.ELFIA_STORE_URL ?? env.ELFIA_ORDERS_URL?.replace(/\/api\/v1\/bridge\/orders.*$/, "") ?? "").replace(/\/+$/, "");
    if (!base || !env.ELFIA_BRIDGE_KEY) {
      return err("not_configured", "The store's address or bridge key is not set on this worker yet.", 501);
    }
    const action = String(body?.action ?? "");
    /* v1.73.0 adds update_tracking: correcting the number on a parcel that
       has already gone. The store owns the rule that it is only legal from
       `shipped` and answers with a sentence for a human if it is not - this
       list is only about which action names are forwarded at all. */
    if (!["confirm_paid", "ship", "complete", "cancel", "update_tracking"].includes(action)) {
      return err("invalid_input", "action must be confirm_paid, ship, complete, cancel or update_tracking", 400);
    }
    try {
      const r = await fetch(`${base}/api/v1/bridge/orders/${encodeURIComponent(orderAct[1]!)}`, {
        method: "POST",
        headers: { "X-Bridge-Key": env.ELFIA_BRIDGE_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          ...(body?.tracking_no !== undefined ? { tracking_no: String(body.tracking_no).trim().slice(0, 60) } : {}),
          ...(body?.tracking_courier !== undefined ? { tracking_courier: String(body.tracking_courier).slice(0, 20) } : {}),
        }),
        signal: AbortSignal.timeout(20_000),
      });
      const payload = (await r.json().catch(() => null)) as Record<string, unknown> | null;
      if (!r.ok) {
        /* The store's refusals are already written for a human ("Cannot ship
           an order that is completed"), so they are passed through rather
           than replaced with something vaguer. */
        const msg = (payload?.error as { message?: string } | undefined)?.message
          ?? `The shop answered ${r.status}.`;
        return err("store_refused", msg, 409);
      }
      await audit(env, user.id, `elfia.order_${action}`, "web_orders", orderAct[1]!, payload ?? {});
      return json({ ok: true, ...(payload ?? {}) });
    } catch {
      return err("store_unreachable", "Could not reach the shop just now. Nothing was changed — try again in a moment.", 502);
    }
  }

  if (path === "/web-orders" && method === "GET") {
    if (!can(user.role, "sales") && !can(user.role, "inventory") && !can(user.role, "exec_view")) {
      return err("forbidden", "Sales access required", 403);
    }
    const url = new URL(request.url);
    const status = url.searchParams.get("status");
    const q = url.searchParams.get("q");
    try {
      let sql = `SELECT * FROM web_orders`;
      const conds: string[] = [];
      const binds: unknown[] = [];
      if (status && /^[a-z_]+$/.test(status)) { conds.push(`status = ?${binds.length + 1}`); binds.push(status); }
      if (q && q.trim() !== "") {
        conds.push(`(order_number LIKE ?${binds.length + 1} OR phone LIKE ?${binds.length + 1} OR customer_name LIKE ?${binds.length + 1})`);
        binds.push(`%${q.trim().slice(0, 60)}%`);
      }
      if (conds.length) sql += ` WHERE ` + conds.join(" AND ");
      sql += ` ORDER BY COALESCE(placed_at, first_seen_at) DESC LIMIT 200`;
      const { results } = await env.DB.prepare(sql).bind(...binds).all();
      return json({ orders: results });
    } catch {
      return json({ orders: [], pending_migration: true });
    }
  }
  const webOrderMatch = path.match(/^\/web-orders\/(\d+)$/);
  if (webOrderMatch && method === "GET") {
    if (!can(user.role, "sales") && !can(user.role, "inventory") && !can(user.role, "exec_view")) {
      return err("forbidden", "Sales access required", 403);
    }
    try {
      const order = await env.DB.prepare(`SELECT * FROM web_orders WHERE id = ?1`)
        .bind(webOrderMatch[1]).first();
      if (!order) return err("not_found", "Web order not found", 404);
      const { results: lines } = await env.DB.prepare(
        `SELECT * FROM web_order_lines WHERE order_id = ?1`,
      ).bind(webOrderMatch[1]).all();
      /* The portal-side movements for this order, joined via the store's
         order number — "what did this order do to my count" in one click. */
      let movements: unknown[] = [];
      try {
        const ref = (order as { order_number?: string }).order_number ?? "";
        const { results: mv } = await env.DB.prepare(
          `SELECT sku, delta, outcome, received_at FROM bridge_events WHERE reference = ?1 ORDER BY id`,
        ).bind(ref).all();
        movements = mv;
      } catch { /* pre-0076 */ }
      return json({ order, lines, movements });
    } catch {
      return err("migration_missing", "Run: npx wrangler d1 migrations apply azoneofficial --remote (0081_web_orders)", 500);
    }
  }
  if (path === "/web-orders/sync" && method === "POST") {
    if (!can(user.role, "sales") && !can(user.role, "inventory")) {
      return err("forbidden", "Sales access required", 403);
    }
    /* Manual "pull now" — rate-limited to once a minute so a stuck spinner
       cannot hammer the store. */
    try {
      const last = (await env.DB.prepare(`SELECT value FROM system_meta WHERE key = 'elfia_manual_sync'`)
        .first<{ value: string }>())?.value;
      if (last && Date.now() - Date.parse(last + "Z") < 60_000) {
        return err("rate_limited", "A sync just ran — the store is polled every 5 minutes anyway", 429);
      }
      await env.DB.prepare(
        `INSERT INTO system_meta (key, value) VALUES ('elfia_manual_sync', datetime('now'))
         ON CONFLICT (key) DO UPDATE SET value = datetime('now')`,
      ).run();
    } catch { /* pre-0057 — allow */ }
    await pollElfiaOrders(env);
    await audit(env, user.id, "bridge.manual_sync");
    return json({ ok: true });
  }
  /* ================= v1.43.0 — ELFIA Traffic (bridge feed D) =================
     Anonymous store-visitor aggregates for the ELFIA Traffic tab's Malaysia
     map. Everything here is ALREADY aggregated by the store (OD-20a: no IPs,
     no per-person rows ever existed upstream) — these routes only slice
     web_traffic_daily. revenue_view, like /orders/geo (the ops-map twin). */
  if (path === "/web-traffic" && method === "GET") {
    if (!can(user.role, "revenue_view")) return err("forbidden", "Revenue access required", 403);
    const url = new URL(request.url);
    const daysQ = Number(url.searchParams.get("days"));
    const span = daysQ === 1 || daysQ === 30 ? daysQ : 7;
    const from = new Date(Date.now() + 8 * 3600 * 1000 - (span - 1) * 86400_000).toISOString().slice(0, 10);
    try {
      /* Whole-day total rows (state = ''): visits + the day's TRUE unique
         count. Summing these `visitors` across days counts daily uniques —
         the hash rotates daily, so no cross-day figure exists BY DESIGN. */
      const { results: days } = await env.DB.prepare(
        `SELECT day, visits, visitors FROM web_traffic_daily
         WHERE state = '' AND day >= ?1 ORDER BY day`,
      ).bind(from).all<{ day: string; visits: number; visitors: number }>();
      /* Per-state totals for the map (state != '' excludes day-total rows). */
      const { results: states } = await env.DB.prepare(
        `SELECT state, SUM(visits) AS visits, SUM(visitors) AS visitors
         FROM web_traffic_daily WHERE state != '' AND day >= ?1
         GROUP BY state ORDER BY visits DESC`,
      ).bind(from).all<{ state: string; visits: number; visitors: number }>();
      let lastPoll: string | null = null;
      try {
        lastPoll = (await env.DB.prepare(`SELECT value FROM system_meta WHERE key = 'elfia_traffic_last_poll'`)
          .first<{ value: string }>())?.value ?? null;
      } catch { /* pre-0057 */ }
      return json({ days, states, span, from, last_poll_at: lastPoll });
    } catch {
      return json({ days: [], states: [], span, from, last_poll_at: null, pending_migration: true });
    }
  }
  if (path === "/web-traffic/detail" && method === "GET") {
    if (!can(user.role, "revenue_view")) return err("forbidden", "Revenue access required", 403);
    const url = new URL(request.url);
    const state = (url.searchParams.get("state") ?? "").slice(0, 40);
    if (!state) return err("invalid_input", "state is required", 400);
    const daysQ = Number(url.searchParams.get("days"));
    const span = daysQ === 1 || daysQ === 30 ? daysQ : 7;
    const from = new Date(Date.now() + 8 * 3600 * 1000 - (span - 1) * 86400_000).toISOString().slice(0, 10);
    try {
      const { results: cities } = await env.DB.prepare(
        `SELECT city, SUM(visits) AS visits FROM web_traffic_daily
         WHERE state = ?1 AND day >= ?2 AND city != ''
         GROUP BY city ORDER BY visits DESC LIMIT 12`,
      ).bind(state, from).all<{ city: string; visits: number }>();
      const { results: paths } = await env.DB.prepare(
        `SELECT path, SUM(visits) AS visits FROM web_traffic_daily
         WHERE state = ?1 AND day >= ?2 AND path != ''
         GROUP BY path ORDER BY visits DESC LIMIT 12`,
      ).bind(state, from).all<{ path: string; visits: number }>();
      return json({ state, span, cities, paths });
    } catch {
      return json({ state, span, cities: [], paths: [], pending_migration: true });
    }
  }
  /* ================= v1.44.0 — marketing reach (PDPA consent) =================
     The people ELFIA may lawfully market to: web-order customers whose
     CURRENT consent flag is 1 (store 0012 → feed C → 0085 here). Deduped by
     phone — one person, one row, whatever they ordered. The store re-sends
     an order whenever consent changes, so withdrawal empties out of this
     list within one poll; nobody has to remember to remove anyone. */
  if (path === "/web-marketing" && method === "GET") {
    if (!can(user.role, "revenue_view")) return err("forbidden", "Revenue access required", 403);
    try {
      const { results: customers } = await env.DB.prepare(
        `SELECT MAX(customer_name) AS name, phone, MAX(address) AS address,
                COUNT(*) AS orders, SUM(total_cents) AS total_cents,
                MAX(COALESCE(placed_at, first_seen_at)) AS last_order_at
         FROM web_orders
         WHERE marketing_consent = 1 AND phone IS NOT NULL AND phone != ''
         GROUP BY phone ORDER BY last_order_at DESC LIMIT 500`,
      ).all<{ name: string | null; phone: string; address: string | null; orders: number; total_cents: number; last_order_at: string }>();
      /* Context, not a mailing list: how many order-customers exist in total,
         so the card can say "31 of 220 customers have consented". */
      const totalRow = await env.DB.prepare(
        `SELECT COUNT(DISTINCT phone) AS n FROM web_orders WHERE phone IS NOT NULL AND phone != ''`,
      ).first<{ n: number }>();
      await audit(env, user.id, "marketing.list_view"); // reading personal data leaves a trail
      return json({ customers, total_customers: totalRow?.n ?? 0 });
    } catch {
      return json({ customers: [], total_customers: 0, pending_migration: true });
    }
  }
  /* v1.38.0: the daily reconciliation report — for each published SKU, the
     day's movements by source from the append-only ledger, against the
     current count. Any disagreement is listed first. Until Track E routes
     the other mutation sites through stock_ledger, the ledger carries ELFIA
     movements only — the response says so rather than implying full
     coverage (the run-guards "no silent caps" rule, applied to data). */
  if (path === "/bridge/reconcile" && method === "GET") {
    if (!can(user.role, "inventory") && !can(user.role, "exec_view")) {
      return err("forbidden", "Inventory access required", 403);
    }
    const url = new URL(request.url);
    const date = url.searchParams.get("date") ?? new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return err("invalid_input", "date must be YYYY-MM-DD", 400);
    try {
      const { results: items } = await env.DB.prepare(
        `SELECT id, sku, name, stock FROM inventory_items WHERE bridge_enabled = 1 ORDER BY sku`,
      ).all<{ id: number; sku: string; name: string; stock: number }>();
      const { results: moves } = await env.DB.prepare(
        `SELECT item_id, source, SUM(delta) AS delta, COUNT(*) AS n FROM stock_ledger
         WHERE date(created_at, '+8 hours') = ?1 GROUP BY item_id, source`,
      ).bind(date).all<{ item_id: number; source: string; delta: number; n: number }>();
      const byItem = new Map<number, { source: string; delta: number; n: number }[]>();
      for (const m of moves) {
        const arr = byItem.get(m.item_id) ?? [];
        arr.push({ source: m.source, delta: m.delta, n: m.n });
        byItem.set(m.item_id, arr);
      }
      return json({
        date,
        coverage: "ledger carries ELFIA bridge movements only until Track E unifies all sources",
        items: items.map((it) => ({ ...it, movements: byItem.get(it.id) ?? [] })),
      });
    } catch {
      return json({ date, items: [], pending_migration: true });
    }
  }
  /* v1.38.0/v1.39.1 (AUDIT B3, OD-15a): signatures come from the vault, and
     access is EARNED, not ambient. Three doors, narrowest first:

     1. Document-scoped (below): /claims/:id/signature/:which and
        /leave/:id/signature/:which — the requester must OWN that document or
        sit in its approval chain. This is how an editor or live host prints
        their OWN approved claim, which legitimately carries the approvers'
        chops, without being able to fetch any signature at will.
     2. Role-file (here): only roles that can already open every signed
        sales document (`sales`) or run HR paperwork (`hr_manage`). The
        v1.38.0 version had NO check — any staff login, including editor/
        marketing/live_host, could pull the CEO's chop unaudited.
     3. Token-scoped public route in index.ts, for shared documents.

     Every serve is audited — an exfiltration must leave a trace. */
  const SIG_ROLE_FILE: Record<string, string> = {
    ceo: "ceo-sign.png", coo: "coo-sign.png", cco: "cco-sign.png",
    hr_admin: "hr-admin-sign.png", sales_marketing: "sales-marketing-sign.png",
  };
  const serveSignature = async (file: string, context: string): Promise<Response> => {
    const obj = await env.MEDIA.get(`private/signatures/${file}`);
    if (!obj) return err("not_found", "This signature has not been uploaded to the vault yet — /admin → Staff → Signatures", 404);
    await audit(env, user.id, "signature.serve", "r2", file, { context });
    return new Response(obj.body, {
      headers: { "Content-Type": "image/png", "Cache-Control": "no-store, private" },
    });
  };
  const sigServe = path.match(/^\/signature\/((?:ceo|coo|cco|hr-admin|sales-marketing)-sign\.png)$/);
  if (sigServe && method === "GET") {
    if (!can(user.role, "sales") && !can(user.role, "hr_manage")) {
      return err("forbidden", "Signature access is limited to document and HR roles", 403);
    }
    return serveSignature(sigServe[1]!, "role-file");
  }
  /* Claim-scoped: emp = the claimant's own chop (only officers have one),
     pre = the pre-approver's, ceo = only once the claim is APPROVED. */
  const sigClaim = path.match(/^\/claims\/(\d+)\/signature\/(emp|pre|ceo)$/);
  if (sigClaim && method === "GET") {
    const cl = await env.DB.prepare(
      `SELECT c.user_id, c.status, c.pre_approved_by, u.role AS claimant_role, p.role AS pre_role
       FROM claims c JOIN users u ON u.id = c.user_id
       LEFT JOIN users p ON p.id = c.pre_approved_by
       WHERE c.id = ?1`,
    ).bind(sigClaim[1]).first<{ user_id: number; status: string; pre_approved_by: number | null; claimant_role: string; pre_role: string | null }>();
    if (!cl) return err("not_found", "Claim not found", 404);
    const inChain = can(user.role, "hr_manage") || can(user.role, "claims_decide") || ["coo", "cco"].includes(user.role);
    if (cl.user_id !== user.id && !inChain) {
      return err("forbidden", "Only the claimant or the approval chain may fetch this claim's signatures", 403);
    }
    const which = sigClaim[2]!;
    let file: string | null = null;
    if (which === "emp") file = SIG_ROLE_FILE[cl.claimant_role] ?? null;
    if (which === "pre") file = cl.pre_approved_by ? (SIG_ROLE_FILE[cl.pre_role ?? ""] ?? null) : null;
    if (which === "ceo") file = cl.status === "approved" ? SIG_ROLE_FILE.ceo! : null;
    if (!file) return err("not_found", "No signature applies at this stage", 404);
    return serveSignature(file, `claim:${sigClaim[1]}`);
  }
  /* Leave-scoped: same shape — owner or chain, and the CEO chop only on an
     APPROVED application. */
  const sigLeave = path.match(/^\/leave\/(\d+)\/signature\/(emp|pre|ceo)$/);
  if (sigLeave && method === "GET") {
    const lv = await env.DB.prepare(
      `SELECT l.user_id, l.status, l.preapp_by, u.role AS owner_role, p.role AS pre_role
       FROM leave_requests l JOIN users u ON u.id = l.user_id
       LEFT JOIN users p ON p.id = l.preapp_by
       WHERE l.id = ?1`,
    ).bind(sigLeave[1]).first<{ user_id: number; status: string; preapp_by: number | null; owner_role: string; pre_role: string | null }>();
    if (!lv) return err("not_found", "Leave request not found", 404);
    const inChain = can(user.role, "hr_manage") || ["coo", "cco", "ceo"].includes(user.role);
    if (lv.user_id !== user.id && !inChain) {
      return err("forbidden", "Only the applicant or the approval chain may fetch this form's signatures", 403);
    }
    const which = sigLeave[2]!;
    let file: string | null = null;
    if (which === "emp") file = SIG_ROLE_FILE[lv.owner_role] ?? null;
    if (which === "pre") file = lv.preapp_by ? (SIG_ROLE_FILE[lv.pre_role ?? ""] ?? null) : null;
    if (which === "ceo") file = lv.status === "approved" ? SIG_ROLE_FILE.ceo! : null;
    if (!file) return err("not_found", "No signature applies at this stage", 404);
    return serveSignature(file, `leave:${sigLeave[1]}`);
  }
  const sigUpload = path.match(/^\/signatures\/((?:ceo|coo|cco|hr-admin|sales-marketing)-sign\.png)$/);
  if (sigUpload && method === "POST") {
    if (!["super_admin", "admin", "ceo"].includes(user.role)) {
      return err("forbidden", "Only an admin or the CEO can upload signatures", 403);
    }
    if (!request.body) return err("invalid_input", "Image body required", 400);
    const ct = request.headers.get("Content-Type") ?? "";
    if (ct !== "image/png") return err("invalid_input", "Signatures must be PNG (transparent background)", 400);
    const key = `private/signatures/${sigUpload[1]}`;
    await env.MEDIA.put(key, request.body, { httpMetadata: { contentType: ct } });
    await audit(env, user.id, "staff.signature_upload", "r2", key);
    return json({ ok: true, key }, 201);
  }
  /* v1.4.162 (CEO): fix a wrongly inserted item — edit SKU/name, or delete
     the row entirely. Deletion is blocked once shipment history exists
     (postage_items) or a supplier return references it: those records join
     the item by id, so removing it would orphan real movements — the CEO
     edits instead. */
  const invEdit = path.match(/^\/inventory\/(\d+)\/edit$/);
  if (invEdit && method === "POST") {
    if (!can(user.role, "inventory")) return err("forbidden", "Inventory access required", 403);
    const newSku = str(body?.sku, 60) ? (body!.sku as string).trim() : null;
    const newName = str(body?.name, 200) ? (body!.name as string).trim() : null;
    if (!newSku && !newName) return err("invalid_input", "Provide a sku and/or name to update", 400);
    const target = await env.DB.prepare(`SELECT id, sku, name FROM inventory_items WHERE id = ?1`)
      .bind(invEdit[1]).first<{ id: number; sku: string; name: string }>();
    if (!target) return err("not_found", "Item not found", 404);
    if (newSku) {
      const clash = await env.DB.prepare(
        `SELECT id FROM inventory_items WHERE lower(trim(sku)) = lower(?1) AND id != ?2 LIMIT 1`,
      ).bind(newSku.toLowerCase(), target.id).first<{ id: number }>();
      if (clash) return err("conflict", "Another item already uses this SKU", 409);
    }
    await env.DB.prepare(
      `UPDATE inventory_items SET sku = COALESCE(?1, sku), name = COALESCE(?2, name),
         updated_by = ?3, updated_at = datetime('now') WHERE id = ?4`,
    ).bind(newSku, newName, user.id, target.id).run();
    /* v1.36.0/v1.39.0 (AUDIT M8): a SKU rename must move the bridge match
       key with it, computed by the same JS normalisation the movements
       handler uses. */
    try {
      const finalSku = newSku ?? target.sku;
      await env.DB.prepare(
        `UPDATE inventory_items SET sku_key = ?1 WHERE id = ?2`,
      ).bind(skuKey(finalSku), target.id).run();
    } catch { /* pre-0079 */ }
    await audit(env, user.id, "inventory.edit", "inventory_items", String(target.id),
      { from: { sku: target.sku, name: target.name }, to: { sku: newSku ?? target.sku, name: newName ?? target.name } });
    return json({ ok: true });
  }
  const invDelete = path.match(/^\/inventory\/(\d+)\/delete$/);
  if (invDelete && method === "POST") {
    if (!can(user.role, "inventory")) return err("forbidden", "Inventory access required", 403);
    const target = await env.DB.prepare(`SELECT id, sku, name, stock FROM inventory_items WHERE id = ?1`)
      .bind(invDelete[1]).first<{ id: number; sku: string; name: string; stock: number }>();
    if (!target) return err("not_found", "Item not found", 404);
    const shipped = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM postage_items WHERE inventory_item_id = ?1`,
    ).bind(target.id).first<{ n: number }>();
    if ((shipped?.n ?? 0) > 0) {
      return err("has_history", "This item has shipment history — its records reference it, so edit the SKU/name instead of deleting.", 409);
    }
    let returned = 0;
    try {
      const ret = await env.DB.prepare(
        `SELECT COUNT(*) AS n FROM supplier_returns WHERE item_id = ?1`,
      ).bind(target.id).first<{ n: number }>();
      returned = ret?.n ?? 0;
    } catch { /* 0042 not applied — nothing referencing */ }
    if (returned > 0) {
      return err("has_history", "This item has supplier-return records — edit the SKU/name instead of deleting.", 409);
    }
    await env.DB.prepare(`DELETE FROM inventory_items WHERE id = ?1`).bind(target.id).run();
    await audit(env, user.id, "inventory.delete", "inventory_items", String(target.id),
      { sku: target.sku, name: target.name, stock: target.stock });
    return json({ ok: true });
  }

  /* ---- Sales & marketing: postage tracking ---- */

  if (path === "/postage" && method === "GET") {
    if (!can(user.role, "inventory") && !can(user.role, "exec_view")) {
      return err("forbidden", "Access required", 403);
    }
    const { results } = await env.DB.prepare(
      `SELECT p.*, i.name AS item_name,
         (SELECT group_concat(pi.qty || '× ' || ii.name, ', ')
          FROM postage_items pi JOIN inventory_items ii ON ii.id = pi.inventory_item_id
          WHERE pi.postage_id = p.id) AS items_label
       FROM postage_records p LEFT JOIN inventory_items i ON i.id = p.inventory_item_id
       ORDER BY p.updated_at DESC LIMIT 200`,
    ).all();
    return json({ records: results });
  }
  if (path === "/postage" && method === "POST") {
    if (!can(user.role, "inventory")) return err("forbidden", "Access required", 403);
    if (!body || !str(body.order_ref, 100)) return err("invalid_input", "order_ref is required", 400);
    // Multi-item stock movement (v1.4.32). An order may ship several items in
    // different quantities. Accuracy guarantees, in order:
    //   1. Lines for the same item are MERGED before checking — 2× A + 3× A = 5× A.
    //   2. Every line is validated against current stock FIRST — if ANY line
    //      is short, the WHOLE order is refused; nothing deducts partially.
    //   3. Each deduction uses a guarded UPDATE — "AND stock >= qty" — so even
    //      two people shipping the same item at the same instant cannot push
    //      stock negative; the slower one is refused.
    //   4. Every deduction is audit-logged with item + qty — visible in /admin → Audit.
    type Line = { inventory_item_id: number; qty: number };
    const rawLines: Line[] = Array.isArray(body.items)
      ? (body.items as Line[])
      : typeof body.inventory_item_id === "number"
        ? [{ inventory_item_id: body.inventory_item_id, qty: Number(body.qty) }]
        : [];
    const merged = new Map<number, number>();
    for (const l of rawLines) {
      if (typeof l?.inventory_item_id !== "number" || !(Number(l.qty) >= 1)) {
        return err("invalid_input", "Each line needs inventory_item_id and qty >= 1", 400);
      }
      merged.set(l.inventory_item_id, (merged.get(l.inventory_item_id) ?? 0) + Math.floor(Number(l.qty)));
    }
    if (merged.size > 20) return err("invalid_input", "Maximum 20 item lines per order", 400);
    const lines = [...merged.entries()].map(([id, qty]) => ({ id, qty }));

    // Validate every line before touching anything.
    const shortages: string[] = [];
    for (const l of lines) {
      const item = await env.DB.prepare(
        `SELECT stock, name FROM inventory_items WHERE id = ?1`,
      ).bind(l.id).first<{ stock: number; name: string }>();
      if (!item) return err("not_found", `Inventory item #${l.id} not found`, 404);
      if (item.stock < l.qty) shortages.push(`${item.name}: only ${item.stock} in stock, order needs ${l.qty}`);
    }
    if (shortages.length > 0) {
      return err("insufficient_stock", `Order refused — ${shortages.join("; ")}`, 409);
    }

    // Create the order, then apply guarded deductions + line rows.
    // v1.4.169 (CEO): non-TikTok orders carry their sales value too, so the
    // revenue totals can count EVERY channel, not just TikTok + invoices.
    const amtRaw = Number(body.order_amount);
    const amtC = Number.isFinite(amtRaw) && amtRaw >= 0 && body.order_amount !== undefined && body.order_amount !== null && `${body.order_amount}` !== ""
      ? Math.round(amtRaw * 100) : null;
    const rec = await env.DB.prepare(
      `INSERT INTO postage_records (order_ref, courier, tracking_no, status, note, order_amount_cents, updated_by)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) RETURNING id`,
    ).bind(
      body.order_ref,
      str(body.courier, 80) ? body.courier : null,
      str(body.tracking_no, 120) ? body.tracking_no : null,
      POSTAGE_STATUSES.includes(body.status as string) ? (body.status as string) : "preparing",
      str(body.note, 500) ? body.note : null,
      amtC,
      user.id,
    ).first<{ id: number }>();
    for (const l of lines) {
      const upd = await env.DB.prepare(
        `UPDATE inventory_items SET stock = stock - ?1, updated_by = ?2, updated_at = datetime('now')
         WHERE id = ?3 AND stock >= ?1`,
      ).bind(l.qty, user.id, l.id).run();
      if (!upd.meta.changes) {
        // Race lost between validation and deduction — undo lines already
        // taken for this order and refuse it honestly.
        const { results: taken } = await env.DB.prepare(
          `SELECT inventory_item_id, qty FROM postage_items WHERE postage_id = ?1`,
        ).bind(rec!.id).all();
        for (const t of taken as { inventory_item_id: number; qty: number }[]) {
          await env.DB.prepare(`UPDATE inventory_items SET stock = stock + ?1 WHERE id = ?2`)
            .bind(t.qty, t.inventory_item_id).run();
        }
        await env.DB.prepare(`DELETE FROM postage_items WHERE postage_id = ?1`).bind(rec!.id).run();
        await env.DB.prepare(`DELETE FROM postage_records WHERE id = ?1`).bind(rec!.id).run();
        return err("insufficient_stock", "Order refused — stock changed while saving; nothing was deducted", 409);
      }
      await env.DB.prepare(
        `INSERT INTO postage_items (postage_id, inventory_item_id, qty) VALUES (?1, ?2, ?3)`,
      ).bind(rec!.id, l.id, l.qty).run();
      await env.DB.prepare(
        `UPDATE inventory_items SET status = CASE WHEN stock = 0 THEN 'out_of_stock' WHEN stock <= 5 THEN 'low' ELSE 'in_stock' END WHERE id = ?1`,
      ).bind(l.id).run();
      await audit(env, user.id, "inventory.out", "inventory_items", String(l.id), { qty: l.qty, order: body.order_ref as string });
      await checkLowStock(l.id); // v1.4.191
    }
    await audit(env, user.id, "postage.create", "postage_records", String(rec?.id), { lines: lines.length });
    return json({ ok: true, id: rec?.id }, 201);
  }
  const postMatch = path.match(/^\/postage\/(\d+)$/);
  if (postMatch && method === "PATCH") {
    if (!can(user.role, "inventory")) return err("forbidden", "Access required", 403);
    if (!body || !POSTAGE_STATUSES.includes(body.status as string)) {
      return err("invalid_input", `status must be one of: ${POSTAGE_STATUSES.join(", ")}`, 400);
    }
    // A shipment marked 'returned' puts its quantity back into stock — once
    // (the restocked flag prevents double-counting on repeated saves).
    if (body.status === "returned") {
      const rec = await env.DB.prepare(
        `SELECT inventory_item_id, qty, restocked FROM postage_records WHERE id = ?1`,
      ).bind(postMatch[1]).first<{ inventory_item_id: number | null; qty: number | null; restocked: number }>();
      if (rec && !rec.restocked) {
        // Restock every line of the order. Multi-item lines live in
        // postage_items; older single-item records used the legacy columns.
        const { results } = await env.DB.prepare(
          `SELECT inventory_item_id, qty FROM postage_items WHERE postage_id = ?1`,
        ).bind(postMatch[1]).all();
        const lines = (results as { inventory_item_id: number; qty: number }[]).length > 0
          ? (results as { inventory_item_id: number; qty: number }[])
          : rec.inventory_item_id && rec.qty
            ? [{ inventory_item_id: rec.inventory_item_id, qty: rec.qty }]
            : [];
        for (const l of lines) {
          await env.DB.prepare(
            `UPDATE inventory_items SET stock = stock + ?1,
               status = CASE WHEN stock + ?1 = 0 THEN 'out_of_stock' WHEN stock + ?1 <= 5 THEN 'low' ELSE 'in_stock' END,
               updated_by = ?2, updated_at = datetime('now') WHERE id = ?3`,
          ).bind(l.qty, user.id, l.inventory_item_id).run();
          await audit(env, user.id, "inventory.in", "inventory_items", String(l.inventory_item_id), { qty: l.qty, reason: "returned" });
      await checkLowStock(Number(l.inventory_item_id));
        }
        if (lines.length > 0) {
          await env.DB.prepare(`UPDATE postage_records SET restocked = 1 WHERE id = ?1`).bind(postMatch[1]).run();
        }
      }
    }
    await env.DB.prepare(
      `UPDATE postage_records SET status = ?1, tracking_no = COALESCE(?2, tracking_no),
         note = COALESCE(?3, note), updated_by = ?4, updated_at = datetime('now') WHERE id = ?5`,
    ).bind(body.status, str(body.tracking_no, 120) ? body.tracking_no : null,
           str(body.note, 500) ? body.note : null, user.id, postMatch[1]).run();
    await audit(env, user.id, "postage.update", "postage_records", postMatch[1]);
    return json({ ok: true });
  }

  /* ---- Manual stock in/out (v1.4.31) ---- */
  const invAdjust = path.match(/^\/inventory\/(\d+)\/adjust$/);
  if (invAdjust && method === "POST") {
    if (!can(user.role, "inventory")) return err("forbidden", "Inventory access required", 403);
    const delta = typeof body?.delta === "number" ? Math.trunc(body.delta) : 0;
    if (!delta) return err("invalid_input", "delta (non-zero integer) is required", 400);
    /* v1.4.169 (CEO: "if there is any manual out without any rebate how do I
       know the total sales?"): an optional sold price on a manual OUT makes
       it a SALE — recorded in manual_sales and counted in the revenue
       totals. Without a price it stays a plain correction (damage/samples)
       and is deliberately excluded so corrections never inflate sales. */
    const saleRaw = Number(body?.sale_price);
    const saleC = delta < 0 && Number.isFinite(saleRaw) && saleRaw >= 0 && body?.sale_price !== undefined && body?.sale_price !== null && `${body?.sale_price}` !== ""
      ? Math.round(saleRaw * 100) : null;
    /* v1.4.170 (CEO: "Remark of the reason why stock out to traceability
       purposes"): every manual OUT must say why — remark is MANDATORY and
       logged to manual_stockouts, so no stock leaves the shelf unexplained. */
    const remark = str(body?.remark, 300) ? (body!.remark as string).trim() : null;
    /* v1.4.251 (CEO: "if I want to adjust the variance … what should remark I
       need to indicate?"): a stock movement is only traceable if BOTH
       directions say why. An IN with no reason is how a stock count quietly
       becomes a guess, so the remark is now mandatory either way. */
    if (!remark) {
      return err("invalid_input", `A remark (reason for the stock ${delta < 0 ? "out" : "in"}) is required — for traceability`, 400);
    }
    if (saleC !== null) {
      const tbl = await env.DB.prepare(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'manual_sales'`,
      ).first<{ name: string }>();
      if (!tbl) return err("migration_missing", "Run: npx wrangler d1 migrations apply azoneofficial --remote (0048_manual_sales)", 500);
    }
    {
      const tbl2 = await env.DB.prepare(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'manual_stockouts'`,
      ).first<{ name: string }>();
      if (!tbl2) return err("migration_missing", "Run: npx wrangler d1 migrations apply azoneofficial --remote (0049_manual_stockouts)", 500);
    }
    const item = await env.DB.prepare(
      `SELECT stock, name, sku FROM inventory_items WHERE id = ?1`,
    ).bind(invAdjust[1]).first<{ stock: number; name: string; sku: string }>();
    if (!item) return err("not_found", "Item not found", 404);
    const newStock = item.stock + delta;
    if (newStock < 0) {
      return err("insufficient_stock", `Only ${item.stock} in stock for ${item.name} — cannot remove ${-delta}`, 409);
    }
    await env.DB.prepare(
      `UPDATE inventory_items SET stock = ?1, status = ?2, updated_by = ?3, updated_at = datetime('now') WHERE id = ?4`,
    ).bind(newStock, stockStatus(newStock), user.id, invAdjust[1]).run();
    // v1.4.172: the date the stock actually went out — backdatable from the
    // modal; defaults to today MYT. Sales totals attribute by this date.
    const outDate = str(body?.out_date, 10) && /^\d{4}-\d{2}-\d{2}$/.test(body!.out_date as string)
      ? (body!.out_date as string)
      : new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
    let saleRowId: number | null = null;
    if (saleC !== null) {
      const qty = Math.abs(delta);
      try {
        const sr = await env.DB.prepare(
          `INSERT INTO manual_sales (item_id, sku, item_name, qty, unit_sale_cents, total_cents, out_date, created_by)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8) RETURNING id`,
        ).bind(Number(invAdjust[1]), item.sku, item.name, qty, saleC, qty * saleC, outDate, user.id).first<{ id: number }>();
        saleRowId = sr?.id ?? null;
      } catch (e) {
        if (!String(e).includes("no such column")) throw e;
        const sr = await env.DB.prepare(
          `INSERT INTO manual_sales (item_id, sku, item_name, qty, unit_sale_cents, total_cents, created_by)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) RETURNING id`,
        ).bind(Number(invAdjust[1]), item.sku, item.name, qty, saleC, qty * saleC, user.id).first<{ id: number }>();
        saleRowId = sr?.id ?? null;
      }
    }
    /* v1.4.170: the traceability trail — one row per manual movement, with
       WHY. v1.4.251: ins are logged here too, marked by `direction`. */
    {
      const args = [Number(invAdjust[1]), item.sku, item.name, Math.abs(delta), saleC, remark, outDate, saleRowId, user.id];
      try {
        await env.DB.prepare(
          `INSERT INTO manual_stockouts (item_id, sku, item_name, qty, unit_sale_cents, remark, out_date, sale_id, created_by, direction)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
        ).bind(...args, delta > 0 ? "in" : "out").run();
      } catch (e) {
        if (!String(e).includes("no such column")) throw e;
        /* 0064 skew: an OUT still logs the old way, but an IN must NOT — an
           unmarked row would read as a stock OUT and corrupt the totals. The
           stock still moves; only its trail row waits for the migration. */
        if (delta < 0) {
          try {
            await env.DB.prepare(
              `INSERT INTO manual_stockouts (item_id, sku, item_name, qty, unit_sale_cents, remark, out_date, sale_id, created_by)
               VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
            ).bind(...args).run();
          } catch (e2) {
            if (!String(e2).includes("no such column")) throw e2;
            await env.DB.prepare(
              `INSERT INTO manual_stockouts (item_id, sku, item_name, qty, unit_sale_cents, remark, created_by)
               VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
            ).bind(Number(invAdjust[1]), item.sku, item.name, Math.abs(delta), saleC, remark, user.id).run();
          }
        } else {
          await logError(env, "migration_skew", "manual_stockouts missing 0064 direction — stock in not logged");
        }
      }
    }
    await audit(env, user.id, delta > 0 ? "inventory.in" : "inventory.out", "inventory_items", invAdjust[1],
      saleC !== null ? { qty: Math.abs(delta), unit_sale_cents: saleC, total_cents: Math.abs(delta) * saleC, manual_sale: true, remark } : { qty: Math.abs(delta), remark });
    await checkLowStock(Number(invAdjust[1])); // v1.4.191
    return json({ ok: true, stock: newStock, status: stockStatus(newStock), sale_recorded: saleC !== null });
  }

  /* ---- Supplier returns (v1.4.148): rejected stock back to the supplier,
          costing tracked for the claim-back ---- */

  if (path === "/inventory/returns" && method === "GET") {
    if (!can(user.role, "inventory") && !can(user.role, "exec_view")) {
      return err("forbidden", "Inventory access required", 403);
    }
    try {
      const { results } = await env.DB.prepare(
        `SELECT r.*, u.name AS created_by_name FROM supplier_returns r
         LEFT JOIN users u ON u.id = r.created_by
         ORDER BY r.return_date DESC, r.id DESC LIMIT 200`,
      ).all<{ total_cents: number; status: string; credited_cents: number | null; qty: number; unit_cost_cents: number; replaced_qty?: number | null }>();
      let total = 0, credited = 0, replacedV = 0;
      for (const r of results) {
        total += r.total_cents;
        if (r.status === "credited") credited += r.credited_cents ?? r.total_cents;
        // v1.4.149: replacement resolves value in goods rather than money
        replacedV += (r.replaced_qty ?? 0) * r.unit_cost_cents;
      }
      const outstanding = Math.max(0, total - credited - replacedV);
      return json({ returns: results, totals: { total_cents: total, credited_cents: credited, replaced_cents: replacedV, outstanding_cents: outstanding } });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("no such table")) {
        return err("migration_missing", "Run: npx wrangler d1 migrations apply azoneofficial --remote (0042_supplier_returns)", 500);
      }
      throw e;
    }
  }
  if (path === "/inventory/returns" && method === "POST") {
    if (!can(user.role, "inventory")) return err("forbidden", "Inventory access required", 403);
    const qty = typeof body?.qty === "number" ? Math.floor(body.qty) : 0;
    const itemId = typeof body?.item_id === "number" ? body.item_id : 0;
    if (!itemId || qty <= 0 || !str(body?.supplier, 120) || !str(body?.return_date, 10)) {
      return err("invalid_input", "item_id, qty (>0), supplier and return_date are required", 400);
    }
    const item = await env.DB.prepare(
      `SELECT sku, name, stock, unit_price_cents FROM inventory_items WHERE id = ?1`,
    ).bind(itemId).first<{ sku: string; name: string; stock: number; unit_price_cents: number | null }>();
    if (!item) return err("not_found", "Item not found", 404);
    if (qty > item.stock) {
      return err("insufficient_stock", `Only ${item.stock} in stock for ${item.name} — cannot return ${qty}`, 409);
    }
    const unitC = typeof body.unit_cost === "number" && body.unit_cost >= 0
      ? Math.round(body.unit_cost * 100)
      : (item.unit_price_cents ?? 0);
    const totalC = unitC * qty;
    // Stock leaves the shelf the moment it's boxed for the supplier.
    const newStock = item.stock - qty;
    await env.DB.prepare(
      `UPDATE inventory_items SET stock = ?1, status = ?2, updated_by = ?3, updated_at = datetime('now') WHERE id = ?4`,
    ).bind(newStock, stockStatus(newStock), user.id, itemId).run();
    const res = await env.DB.prepare(
      `INSERT INTO supplier_returns (item_id, sku, item_name, qty, unit_cost_cents, total_cents, supplier, reason, return_date, created_by)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10) RETURNING id`,
    ).bind(itemId, item.sku, item.name, qty, unitC, totalC, body.supplier, str(body.reason, 300) ? body.reason : null, body.return_date, user.id).first<{ id: number }>();
    await audit(env, user.id, "inventory.supplier_return", "supplier_returns", res?.id != null ? String(res.id) : undefined, { qty, total_cents: totalC });
    return json({ ok: true, id: res?.id, stock: newStock }, 201);
  }
  /* v1.4.164 (CEO): edit an OUTSTANDING supplier return — qty, unit cost,
     supplier, date, reason. Settled or partially replaced rows are locked
     (money/goods already moved). A qty change moves stock by the difference:
     lowering the qty puts pieces back on the shelf; raising it boxes more
     (refused if the shelf doesn't have them). Total recomputes. */
  const retEdit = path.match(/^\/inventory\/returns\/(\d+)\/edit$/);
  if (retEdit && method === "POST") {
    if (!can(user.role, "inventory")) return err("forbidden", "Inventory access required", 403);
    const row = await env.DB.prepare(`SELECT * FROM supplier_returns WHERE id = ?1`)
      .bind(retEdit[1]).first<{ id: number; item_id: number; qty: number; unit_cost_cents: number; total_cents: number; supplier: string; reason: string | null; return_date: string; status: string; replaced_qty?: number | null }>();
    if (!row) return err("not_found", "Return not found", 404);
    if (row.status !== "outstanding" || (row.replaced_qty ?? 0) > 0) {
      return err("invalid_state", "Credited or replaced returns are locked — the money/goods already moved. Record a fresh return instead.", 400);
    }
    const newQty = typeof body?.qty === "number" && Math.floor(body.qty) > 0 ? Math.floor(body.qty) : null;
    const newUnit = typeof body?.unit_cost === "number" && body.unit_cost >= 0 ? Math.round(body.unit_cost * 100) : null;
    const newSupplier = str(body?.supplier, 120) ? (body!.supplier as string) : null;
    const newReason = str(body?.reason, 300) ? (body!.reason as string) : null;
    const newDate = str(body?.return_date, 10) ? (body!.return_date as string) : null;
    if (newQty === null && newUnit === null && !newSupplier && !newReason && !newDate) {
      return err("invalid_input", "Nothing to update", 400);
    }
    if (newQty !== null && newQty !== row.qty) {
      const item = await env.DB.prepare(`SELECT stock FROM inventory_items WHERE id = ?1`)
        .bind(row.item_id).first<{ stock: number }>();
      if (!item) return err("not_found", "The inventory item behind this return no longer exists", 409);
      const delta = newQty - row.qty; // positive = box MORE (deduct), negative = put back
      if (delta > 0 && item.stock < delta) {
        return err("insufficient_stock", `Only ${item.stock} in stock — cannot raise the return by ${delta}`, 409);
      }
      const adjStock = item.stock - delta;
      await env.DB.prepare(
        `UPDATE inventory_items SET stock = ?1, status = ?2, updated_by = ?3, updated_at = datetime('now') WHERE id = ?4`,
      ).bind(adjStock, stockStatus(adjStock), user.id, row.item_id).run();
    }
    const qtyF = newQty ?? row.qty;
    const unitF = newUnit ?? row.unit_cost_cents;
    const totalF = qtyF * unitF;
    await env.DB.prepare(
      `UPDATE supplier_returns SET qty = ?1, unit_cost_cents = ?2, total_cents = ?3,
         supplier = COALESCE(?4, supplier), reason = COALESCE(?5, reason), return_date = COALESCE(?6, return_date)
       WHERE id = ?7`,
    ).bind(qtyF, unitF, totalF, newSupplier, newReason, newDate, row.id).run();
    await audit(env, user.id, "inventory.supplier_return_edit", "supplier_returns", String(row.id), {
      from: { qty: row.qty, unit_cost_cents: row.unit_cost_cents, total_cents: row.total_cents },
      to: { qty: qtyF, unit_cost_cents: unitF, total_cents: totalF },
    });
    return json({ ok: true, total_cents: totalF });
  }
  const retCredit = path.match(/^\/inventory\/returns\/(\d+)\/credit$/);
  if (retCredit && method === "POST") {
    if (!can(user.role, "inventory")) return err("forbidden", "Inventory access required", 403);
    const row = await env.DB.prepare(`SELECT status, total_cents FROM supplier_returns WHERE id = ?1`)
      .bind(retCredit[1]).first<{ status: string; total_cents: number }>();
    if (!row) return err("not_found", "Return not found", 404);
    if (row.status === "credited") return err("invalid_state", "Already marked credited", 400);
    const credC = typeof body?.credited === "number" && body.credited >= 0
      ? Math.round(body.credited * 100)
      : row.total_cents;
    await env.DB.prepare(
      `UPDATE supplier_returns SET status = 'credited', credited_at = datetime('now'), credited_cents = ?1 WHERE id = ?2`,
    ).bind(credC, retCredit[1]).run();
    await audit(env, user.id, "inventory.supplier_return_credited", "supplier_returns", retCredit[1], { credited_cents: credC });
    return json({ ok: true });
  }
  const retReplace = path.match(/^\/inventory\/returns\/(\d+)\/replace$/);
  if (retReplace && method === "POST") {
    // v1.4.149: the supplier sent replacement goods — stock walks back onto
    // the shelf and the claim shrinks by the replaced value. Partial
    // deliveries accumulate; the row closes as 'replaced' when complete.
    if (!can(user.role, "inventory")) return err("forbidden", "Inventory access required", 403);
    const row = await env.DB.prepare(
      `SELECT status, item_id, qty, unit_cost_cents, COALESCE(replaced_qty, 0) AS replaced_qty FROM supplier_returns WHERE id = ?1`,
    ).bind(retReplace[1]).first<{ status: string; item_id: number; qty: number; unit_cost_cents: number; replaced_qty: number }>();
    if (!row) return err("not_found", "Return not found", 404);
    if (row.status === "credited") return err("invalid_state", "Already resolved by credit", 400);
    const remaining = row.qty - row.replaced_qty;
    if (remaining <= 0) return err("invalid_state", "Already fully replaced", 400);
    const q = typeof body?.qty === "number" && body.qty > 0 ? Math.floor(body.qty) : remaining;
    if (q > remaining) {
      return err("invalid_input", `Only ${remaining} of ${row.qty} still awaiting replacement`, 400);
    }
    const item = await env.DB.prepare(`SELECT stock FROM inventory_items WHERE id = ?1`)
      .bind(row.item_id).first<{ stock: number }>();
    if (item) {
      const back = item.stock + q;
      await env.DB.prepare(
        `UPDATE inventory_items SET stock = ?1, status = ?2, updated_by = ?3, updated_at = datetime('now') WHERE id = ?4`,
      ).bind(back, stockStatus(back), user.id, row.item_id).run();
    }
    const newReplaced = row.replaced_qty + q;
    const done = newReplaced >= row.qty;
    await env.DB.prepare(
      `UPDATE supplier_returns SET replaced_qty = ?1, replaced_at = datetime('now'),
         status = CASE WHEN ?2 THEN 'replaced' ELSE status END
       WHERE id = ?3`,
    ).bind(newReplaced, done ? 1 : 0, retReplace[1]).run();
    await audit(env, user.id, "inventory.supplier_return_replaced", "supplier_returns", retReplace[1], { qty: q, complete: done });
    return json({ ok: true, replaced_qty: newReplaced, complete: done });
  }
  const retDelete = path.match(/^\/inventory\/returns\/(\d+)\/delete$/);
  if (retDelete && method === "POST") {
    if (!can(user.role, "inventory")) return err("forbidden", "Inventory access required", 403);
    const row = await env.DB.prepare(
      `SELECT status, item_id, qty FROM supplier_returns WHERE id = ?1`,
    ).bind(retDelete[1]).first<{ status: string; item_id: number; qty: number }>();
    if (!row) return err("not_found", "Return not found", 404);
    if (row.status === "credited") return err("invalid_state", "A credited return is a permanent record", 400);
    const repl = await env.DB.prepare(`SELECT COALESCE(replaced_qty, 0) AS rq FROM supplier_returns WHERE id = ?1`)
      .bind(retDelete[1]).first<{ rq: number }>();
    if ((repl?.rq ?? 0) > 0) return err("invalid_state", "Replacement already received — this row is a permanent record", 400);
    // Undo: the stock walks back onto the shelf.
    const item = await env.DB.prepare(`SELECT stock FROM inventory_items WHERE id = ?1`)
      .bind(row.item_id).first<{ stock: number }>();
    if (item) {
      const back = item.stock + row.qty;
      await env.DB.prepare(
        `UPDATE inventory_items SET stock = ?1, status = ?2, updated_by = ?3, updated_at = datetime('now') WHERE id = ?4`,
      ).bind(back, stockStatus(back), user.id, row.item_id).run();
    }
    await env.DB.prepare(`DELETE FROM supplier_returns WHERE id = ?1`).bind(retDelete[1]).run();
    await audit(env, user.id, "inventory.supplier_return_deleted", "supplier_returns", retDelete[1], { qty_restored: row.qty });
    return json({ ok: true });
  }

  /* ---- Marketing materials ---- */

  if (path === "/materials" && method === "GET") {
    if (!can(user.role, "inventory") && !can(user.role, "exec_view")) {
      return err("forbidden", "Access required", 403);
    }
    const { results } = await env.DB.prepare(
      `SELECT m.*, u.name AS requested_by_name FROM material_requests m
       LEFT JOIN users u ON u.id = m.requested_by ORDER BY m.created_at DESC LIMIT 100`,
    ).all();
    return json({ materials: results });
  }
  if (path === "/materials" && method === "POST") {
    if (!can(user.role, "inventory")) return err("forbidden", "Access required", 403);
    if (!body || !str(body.title, 200)) return err("invalid_input", "title is required", 400);
    await env.DB.prepare(
      `INSERT INTO material_requests (title, description, requested_by) VALUES (?1, ?2, ?3)`,
    ).bind(body.title, str(body.description, 2000) ? body.description : null, user.id).run();
    await audit(env, user.id, "materials.create");
    return json({ ok: true }, 201);
  }
  const matMatch = path.match(/^\/materials\/(\d+)$/);
  if (matMatch && method === "PATCH") {
    if (!can(user.role, "inventory")) return err("forbidden", "Access required", 403);
    const statuses = ["requested", "in_progress", "done", "rejected"];
    if (!body || !statuses.includes(body.status as string)) {
      return err("invalid_input", `status must be one of: ${statuses.join(", ")}`, 400);
    }
    await env.DB.prepare(
      `UPDATE material_requests SET status = ?1, updated_at = datetime('now') WHERE id = ?2`,
    ).bind(body.status, matMatch[1]).run();
    return json({ ok: true });
  }

  /* ---- CCO: business development pipeline ---- */

  /* v1.19.0 (consolidation C1): /bd and /ops-reports routes deleted. Their
     panels (CommercialPanel, OperationsPanel) were exported but rendered by
     no tab — dead UI over live routes. bd_pipeline and ops_reports TABLES
     remain untouched; only the API surface is gone. */
  if (path === "/overview" && method === "GET") {
    if (!can(user.role, "exec_view")) return err("forbidden", "Executive access required", 403);
    const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
    const [attendance, pendingLeave, docs, lowStock, bd, upcomingEvents, eventCount, latestOps, taskAgg, taskByStaff, inventory] = await Promise.all([
      env.DB.prepare(
        `SELECT COUNT(DISTINCT user_id) AS n FROM attendance_records
         WHERE type = 'clock_in' AND date(created_at, '+8 hours') = ?1`,
      ).bind(today).first(),
      env.DB.prepare(`SELECT COUNT(*) AS n FROM leave_requests WHERE status = 'pending'`).first(),
      env.DB.prepare(
        `SELECT doc_type, COUNT(*) AS n FROM sales_documents GROUP BY doc_type`,
      ).all(),
      env.DB.prepare(
        `SELECT COUNT(*) AS n FROM inventory_items WHERE status IN ('low', 'out_of_stock')`,
      ).first(),
      env.DB.prepare(`SELECT status, COUNT(*) AS n FROM bd_pipeline GROUP BY status`).all(),
      // Upcoming company events (v1.4.73) — next 60 days for the list, and a
      // 30-day count for the headline stat.
      env.DB.prepare(
        `SELECT id, title, category, event_date, start_time, location FROM events
         WHERE event_date >= date('now', '+8 hours')
           AND event_date <= date('now', '+8 hours', '+60 days')
         ORDER BY event_date ASC, start_time ASC LIMIT 6`,
      ).all(),
      env.DB.prepare(
        `SELECT COUNT(*) AS n FROM events
         WHERE event_date >= date('now', '+8 hours')
           AND event_date <= date('now', '+8 hours', '+30 days')`,
      ).first(),
      env.DB.prepare(
        `SELECT report_date, operational_summary, sales_summary FROM ops_reports
         ORDER BY report_date DESC LIMIT 1`,
      ).first(),
      // Task progress across the whole company (open/in_progress/completed).
      env.DB.prepare(`SELECT status, COUNT(*) AS n FROM tasks GROUP BY status`).all(),
      // Per-staff task load — who has open work, for monitoring.
      env.DB.prepare(
        `SELECT COALESCE(NULLIF(TRIM(u.full_name), ''), u.name) AS name, u.role,
                SUM(CASE WHEN t.status != 'completed' THEN 1 ELSE 0 END) AS open_tasks,
                SUM(CASE WHEN t.status = 'completed' THEN 1 ELSE 0 END) AS done_tasks
         FROM users u LEFT JOIN tasks t ON t.assigned_to = u.id
         WHERE ${staffRolesSql('u.')}
         GROUP BY u.id HAVING open_tasks > 0 OR done_tasks > 0
         ORDER BY open_tasks DESC LIMIT 30`,
      ).all(),
      // Inventory status breakdown for monitoring.
      env.DB.prepare(`SELECT status, COUNT(*) AS n FROM inventory_items GROUP BY status`).all(),
    ]);
    return json({
      date: today,
      clocked_in_today: (attendance as { n: number } | null)?.n ?? 0,
      pending_leave: (pendingLeave as { n: number } | null)?.n ?? 0,
      documents: docs.results,
      low_stock_items: (lowStock as { n: number } | null)?.n ?? 0,
      bd_pipeline: bd.results,
      upcoming_events: upcomingEvents.results,
      upcoming_events_30d: (eventCount as { n: number } | null)?.n ?? 0,
      latest_ops_report: latestOps,
      task_summary: taskAgg.results,
      /* v1.42.0: the two counts a monitoring card actually needs. Armored —
         pre-0083 they are simply absent and the card shows three tiles. */
      task_overdue: await (async () => {
        try {
          const todayO = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
          return (await env.DB.prepare(
            `SELECT COUNT(*) AS n FROM tasks WHERE status != 'completed' AND deadline IS NOT NULL AND deadline < ?1`,
          ).bind(todayO).first<{ n: number }>())?.n ?? 0;
        } catch { return null; }
      })(),
      task_unacked: await (async () => {
        try {
          return (await env.DB.prepare(
            `SELECT COUNT(*) AS n FROM tasks t
             WHERE t.status != 'completed' AND t.created_by IS NOT NULL AND t.created_by != t.assigned_to
               AND NOT EXISTS (SELECT 1 FROM task_events e WHERE e.task_id = t.id AND e.kind = 'ack')`,
          ).first<{ n: number }>())?.n ?? 0;
        } catch { return null; }
      })(),
      task_by_staff: taskByStaff.results,
      inventory_status: inventory.results,
    });
  }

  if (path === "/notifications" && method === "GET") {
    // Backfill (v1.4.34): any announcement from the last 7 days that has no
    // notification row for this user gets one now. This makes announcement
    // alerts independent of publish/deploy ordering — the bell always knows.
    const { results: missing } = await env.DB.prepare(
      `SELECT a.id, a.title, a.created_at FROM announcements a
       WHERE a.created_at >= datetime('now', '-7 days')
         AND a.created_by != ?1
         AND NOT EXISTS (
           SELECT 1 FROM notifications n
           WHERE n.user_id = ?1 AND n.ref = 'announcement:' || a.id
         )`,
    ).bind(user.id).all();
    for (const a of missing as { id: number; title: string; created_at: string }[]) {
      await env.DB.prepare(
        `INSERT INTO notifications (user_id, kind, message, ref, created_at)
         VALUES (?1, 'announcement', ?2, ?3, ?4)`,
      ).bind(user.id, `New announcement: ${a.title}`, `announcement:${a.id}`, a.created_at).run();
    }
    const { results } = await env.DB.prepare(
      `SELECT id, kind, message, ref, is_read, created_at FROM notifications
       WHERE user_id = ?1 AND created_at >= datetime('now', '-7 days')
       ORDER BY created_at DESC LIMIT 50`,
    ).bind(user.id).all();
    return json({ notifications: results });
  }
  if (path === "/notifications/read" && method === "POST") {
    await env.DB.prepare(`UPDATE notifications SET is_read = 1 WHERE user_id = ?1`)
      .bind(user.id).run();
    return json({ ok: true });
  }

  /* ===================== v1.6.0 — real-time notifications ================== */

  /* SSE live stream: replaces the 60-second poll with ~5-second latency
     without Durable Objects. The connection self-closes after ~20s and the
     browser's EventSource reconnects automatically, so no connection is held
     open indefinitely. `since` is the newest id the client already has. */
  if (path === "/notifications/stream" && method === "GET") {
    let lastId = Number(new URL(request.url).searchParams.get("since") ?? "0") || 0;
    const encoder = new TextEncoder();
    let cancelled = false;
    /* v1.65.0 — LIVE CARDS ride this stream rather than opening a second one.
       The connection, the 5-second tick, the 20-second self-close and the
       browser's own reconnect are all already here and already proven. A
       parallel EventSource would have doubled every one of those costs to
       deliver a payload measured in tens of bytes.
       Only CHANGED topics are sent. The last snapshot is held in this
       closure, so a quiet shop sends nothing at all: the common case costs
       one query and zero bytes on the wire. */
    let seenVersions: Record<string, number> = {};
    let firstVersionFrame = true;
    const stream = new ReadableStream({
      cancel() { cancelled = true; }, // client disconnected — stop polling at once
      async start(controller) {
        const send = (s: string) => { try { controller.enqueue(encoder.encode(s)); } catch { /* closed */ } };
        send("retry: 5000\n\n");
        const started = Date.now();
        try {
          while (!cancelled && Date.now() - started < 20000) {
            const { results } = await env.DB.prepare(
              `SELECT id, kind, message, ref, is_read, created_at FROM notifications
               WHERE user_id = ?1 AND id > ?2 ORDER BY id ASC LIMIT 30`,
            ).bind(user.id, lastId).all<{ id: number }>();
            if (results.length) {
              for (const n of results) lastId = Math.max(lastId, n.id);
              send(`event: notifications\ndata: ${JSON.stringify(results)}\n\n`);
            } else {
              send(`event: ping\ndata: ${lastId}\n\n`);
            }
            /* The version sweep. The FIRST frame of a connection is always
               sent in full, because the client has just reconnected and may
               have missed changes while it was away — the client treats its
               first frame as a baseline, not as a reason to reload, so this
               costs one small message and closes the gap that every
               reconnect would otherwise leave. */
            const now = await readVersions(env);
            const changed: Record<string, number> = {};
            for (const [t, v] of Object.entries(now)) {
              if (firstVersionFrame || seenVersions[t] !== v) changed[t] = v;
            }
            seenVersions = now;
            if (firstVersionFrame || Object.keys(changed).length > 0) {
              send(`event: versions\ndata: ${JSON.stringify(changed)}\n\n`);
              firstVersionFrame = false;
            }
            await new Promise((r) => setTimeout(r, 5000));
          }
        } catch { /* client disconnected */ }
        send(`event: bye\ndata: ${lastId}\n\n`);
        try { controller.close(); } catch { /* already closed */ }
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Accel-Buffering": "no",
      },
    });
  }

  /* v1.65.0 — the version map on demand. The SSE stream is the fast path;
     this is the one a tab calls when it comes back to the foreground, where
     the stream may have died while the phone was in a pocket. One tiny table
     scan, no auth beyond being staff: it says what changed, never what it
     changed to. */
  if (path === "/versions" && method === "GET") {
    return json({ versions: await readVersions(env) });
  }

  /* Web-push: the browser fetches the public key, subscribes, and posts the
     subscription here. Unsubscribe removes it. */
  if (path === "/push/public-key" && method === "GET") {
    return json({ key: env.VAPID_PUBLIC_KEY ?? null });
  }
  if (path === "/push/subscribe" && method === "POST") {
    const sub = body?.subscription as { endpoint?: string; keys?: { p256dh?: string; auth?: string } } | undefined;
    const endpoint = sub?.endpoint;
    const p256dh = sub?.keys?.p256dh;
    const auth = sub?.keys?.auth;
    if (!endpoint || !p256dh || !auth) return err("invalid_input", "A full push subscription is required", 400);
    try {
      await env.DB.prepare(
        `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(endpoint) DO UPDATE SET user_id = ?1, p256dh = ?3, auth = ?4`,
      ).bind(user.id, endpoint, p256dh, auth).run();
    } catch (e) {
      if (String(e).includes("no such table")) return err("migration_missing", "Run migration 0068 first", 409);
      throw e;
    }
    return json({ ok: true });
  }
  if (path === "/push/unsubscribe" && method === "POST") {
    const endpoint = typeof body?.endpoint === "string" ? body.endpoint : null;
    if (endpoint) await env.DB.prepare(`DELETE FROM push_subscriptions WHERE endpoint = ?1 AND user_id = ?2`).bind(endpoint, user.id).run();
    return json({ ok: true });
  }

  /* ===================== v1.6.0 — targets · commission · leaderboard ======= */

  /* The leaderboard: attributed sales per person this month, their target,
     progress, and the commission the active rules would pay. Visible to any
     role that can see revenue — it is the motivational heart of the sales
     floor, so everyone who works the numbers sees the ranking. */
  if (path === "/leaderboard" && method === "GET") {
    if (!can(user.role, "revenue_view")) return err("forbidden", "Revenue access required", 403);
    const month = new URL(request.url).searchParams.get("month")
      ?? new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(month)) return err("invalid_input", "month must be YYYY-MM", 400);

    const sales = await attributedSalesByUser(env, month);
    const rules = await activeCommissionRules(env);
    const targets = new Map<number, number>();
    try {
      const { results } = await env.DB.prepare(
        `SELECT user_id, target_cents FROM user_sales_targets WHERE month = ?1`,
      ).bind(month).all<{ user_id: number; target_cents: number }>();
      for (const t of results) targets.set(t.user_id, t.target_cents);
    } catch { /* pre-0068 */ }

    const { results: staff } = await env.DB.prepare(
      `SELECT id, COALESCE(NULLIF(TRIM(full_name), ''), name) AS name, role, photo_key FROM users
       WHERE is_active = 1 AND ${currentStaffSql()} AND role NOT IN ('customer', 'super_admin', 'admin')`,
    ).all<{ id: number; name: string; role: string; photo_key: string | null }>();

    let earners = 0;
    const rows = staff
      .map((s) => {
        const sold = sales.get(s.id) ?? 0;
        const target = targets.get(s.id) ?? 0;
        return {
          user_id: s.id, name: s.name, role: s.role, photo_key: s.photo_key,
          sales_cents: sold,
          target_cents: target || null,
          pct: target > 0 ? Math.round((sold / target) * 100) : null,
          commission_cents: commissionFor(sold, target, s.role, rules),
        };
      })
      // v1.25.5: the sales floor is always on the board. A sales_marketing or
      // live_host person with nothing attributed yet still belongs on it at
      // RM 0.00 — dropping them made the board look like they do not sell.
      .filter((r) => r.sales_cents > 0 || r.target_cents || LEADERBOARD_ALWAYS_ROLES.includes(r.role))
      .sort((a, b) => b.sales_cents - a.sales_cents || a.name.localeCompare(b.name))
      // Ranks go to earners only; a zero line carries rank null so the podium
      // still means something.
      .map((r) => ({ ...r, rank: r.sales_cents > 0 ? ++earners : null }));

    // The requesting user always sees their own line even at zero.
    const meIncluded = rows.some((r) => r.user_id === user.id);
    return json({ month, rows, has_rules: rules.length > 0, me_included: meIncluded, me: user.id });
  }

  /* Targets — per-person and per-team (the company target stays on
     /revenue/target). Management only. */
  if (path === "/targets" && method === "GET") {
    if (!TARGET_ADMIN_ROLES.includes(user.role)) return err("forbidden", "Management access required", 403);
    const month = new URL(request.url).searchParams.get("month")
      ?? new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(month)) return err("invalid_input", "month must be YYYY-MM", 400);
    let users: unknown[] = [], teams: unknown[] = [], company: number | null = null;
    try {
      users = (await env.DB.prepare(
        `SELECT t.user_id, t.target_cents, COALESCE(NULLIF(TRIM(u.full_name), ''), u.name) AS name, u.role
         FROM user_sales_targets t JOIN users u ON u.id = t.user_id WHERE t.month = ?1`,
      ).bind(month).all()).results;
      teams = (await env.DB.prepare(`SELECT team, target_cents FROM team_sales_targets WHERE month = ?1`).bind(month).all()).results;
      const c = await env.DB.prepare(`SELECT target_cents FROM sales_targets WHERE month = ?1`).bind(month).first<{ target_cents: number }>();
      company = c?.target_cents ?? null;
    } catch { /* pre-0068 */ }
    const { results: staff } = await env.DB.prepare(
      `SELECT id, COALESCE(NULLIF(TRIM(full_name), ''), name) AS name, role FROM users
       WHERE is_active = 1 AND role NOT IN ('customer', 'super_admin', 'admin') ORDER BY 2`,
    ).all();
    return json({ month, company_target_cents: company, user_targets: users, team_targets: teams, staff });
  }
  if (path === "/targets" && method === "POST") {
    if (!TARGET_ADMIN_ROLES.includes(user.role)) return err("forbidden", "Management access required", 403);
    const scope = String(body?.scope ?? "");
    const month = String(body?.month ?? "");
    const cents = Math.round(Number(body?.target_cents));
    if (!/^\d{4}-\d{2}$/.test(month) || !Number.isFinite(cents) || cents < 0) {
      return err("invalid_input", "scope, month (YYYY-MM) and target_cents are required", 400);
    }
    try {
      if (scope === "user") {
        const uid = Math.round(Number(body?.id));
        if (!uid) return err("invalid_input", "id (user) required", 400);
        await env.DB.prepare(
          `INSERT INTO user_sales_targets (user_id, month, target_cents, set_by) VALUES (?1, ?2, ?3, ?4)
           ON CONFLICT(user_id, month) DO UPDATE SET target_cents = ?3, set_by = ?4`,
        ).bind(uid, month, cents, user.id).run();
        await audit(env, user.id, "target.set_user", "user_sales_targets", String(uid), { month, cents });
      } else if (scope === "team") {
        const team = String(body?.id ?? "").trim().slice(0, 40);
        if (!team) return err("invalid_input", "id (team) required", 400);
        await env.DB.prepare(
          `INSERT INTO team_sales_targets (team, month, target_cents, set_by) VALUES (?1, ?2, ?3, ?4)
           ON CONFLICT(team, month) DO UPDATE SET target_cents = ?3, set_by = ?4`,
        ).bind(team, month, cents, user.id).run();
        await audit(env, user.id, "target.set_team", "team_sales_targets", team, { month, cents });
      } else {
        return err("invalid_input", "scope must be 'user' or 'team'", 400);
      }
      return json({ ok: true });
    } catch (e) {
      if (String(e).includes("no such table")) return err("migration_missing", "Run migration 0068 first", 409);
      throw e;
    }
  }

  /* Commission rules — management CRUD. */
  if (path === "/commission/rules" && method === "GET") {
    if (!TARGET_ADMIN_ROLES.includes(user.role)) return err("forbidden", "Management access required", 403);
    try {
      const { results } = await env.DB.prepare(
        `SELECT id, name, base_pct, bonus_pct, applies_to, active, created_at FROM commission_rules ORDER BY id DESC`,
      ).all();
      return json({ rules: results });
    } catch (e) {
      if (String(e).includes("no such table")) return err("migration_missing", "Run migration 0068 first", 409);
      throw e;
    }
  }
  if (path === "/commission/rules" && method === "POST") {
    if (!TARGET_ADMIN_ROLES.includes(user.role)) return err("forbidden", "Management access required", 403);
    const name = String(body?.name ?? "").trim().slice(0, 80);
    const basePct = Number(body?.base_pct);
    const bonusPct = Number(body?.bonus_pct ?? 0);
    const appliesTo = String(body?.applies_to ?? "all").trim() || "all";
    if (!name || !Number.isFinite(basePct) || basePct < 0 || basePct > 100 || !Number.isFinite(bonusPct) || bonusPct < 0 || bonusPct > 100) {
      return err("invalid_input", "name and base_pct (0–100) are required; bonus_pct 0–100", 400);
    }
    try {
      const res = await env.DB.prepare(
        `INSERT INTO commission_rules (name, base_pct, bonus_pct, applies_to, created_by) VALUES (?1, ?2, ?3, ?4, ?5) RETURNING id`,
      ).bind(name, basePct, bonusPct, appliesTo, user.id).first<{ id: number }>();
      await audit(env, user.id, "commission.rule_create", "commission_rules", String(res?.id), { name, basePct, bonusPct, appliesTo });
      return json({ id: res?.id }, 201);
    } catch (e) {
      if (String(e).includes("no such table")) return err("migration_missing", "Run migration 0068 first", 409);
      throw e;
    }
  }
  {
    const mR = path.match(/^\/commission\/rules\/(\d+)$/);
    if (mR && (method === "PATCH" || method === "DELETE")) {
      if (!TARGET_ADMIN_ROLES.includes(user.role)) return err("forbidden", "Management access required", 403);
      const id = Number(mR[1]);
      if (method === "DELETE") {
        await env.DB.prepare(`DELETE FROM commission_rules WHERE id = ?1`).bind(id).run();
        await audit(env, user.id, "commission.rule_delete", "commission_rules", String(id));
        return json({ ok: true });
      }
      const sets: string[] = [];
      const args: unknown[] = [];
      if (typeof body?.active === "number" || typeof body?.active === "boolean") { sets.push(`active = ?${args.length + 1}`); args.push(body.active ? 1 : 0); }
      if (Number.isFinite(Number(body?.base_pct))) { sets.push(`base_pct = ?${args.length + 1}`); args.push(Number(body!.base_pct)); }
      if (Number.isFinite(Number(body?.bonus_pct))) { sets.push(`bonus_pct = ?${args.length + 1}`); args.push(Number(body!.bonus_pct)); }
      if (typeof body?.name === "string" && body.name.trim()) { sets.push(`name = ?${args.length + 1}`); args.push(body.name.trim().slice(0, 80)); }
      if (typeof body?.applies_to === "string" && body.applies_to.trim()) { sets.push(`applies_to = ?${args.length + 1}`); args.push(body.applies_to.trim()); }
      if (sets.length === 0) return err("invalid_input", "Nothing to update", 400);
      await env.DB.prepare(`UPDATE commission_rules SET ${sets.join(", ")} WHERE id = ?${args.length + 1}`).bind(...args, id).run();
      await audit(env, user.id, "commission.rule_update", "commission_rules", String(id), body ?? {});
      return json({ ok: true });
    }
  }

  /* ===================== v1.7.0 — Sales Pipeline — RETIRED ================= */
  /* v1.21.0 (CEO: "Sales pipeline is really needed?? I dont think so"):
     the LEAD→WON tracker is retired. The `prospects` table and its
     migrations (0066/0067) are KEPT — history is never dropped by a UI
     decision — but the /pipeline routes are gone and the tab with them.
     Customer enquiries (the real inbound funnel) now live on the Sales tab;
     an enquiry that turns into business becomes a quotation directly. */

  /* ===================== v1.7.0 — Content management ======================= */
  {
    const CONTENT_MANAGE = ["super_admin", "admin", "ceo", "coo", "cco", "hr_admin", "sales_marketing", "marketing", "editor", "live_host"];
    if (path === "/content" && method === "GET") {
      // v1.45.0 (security audit S3): the same gate its PATCH and DELETE
      // siblings carry. Harmless today because CONTENT_MANAGE happens to list
      // every staff role — but a gate that is only correct by coincidence
      // stops being correct the day the list is narrowed.
      if (!CONTENT_MANAGE.includes(user.role)) return err("forbidden", "Content access required", 403);
      try {
        const { results } = await env.DB.prepare(
          `SELECT c.*, COALESCE(NULLIF(TRIM(u.full_name), ''), u.name) AS assigned_name
           FROM content_items c LEFT JOIN users u ON u.id = c.assigned_to
           ORDER BY CASE WHEN c.stage = 'posted' THEN 1 ELSE 0 END,
                    c.scheduled_date IS NULL, c.scheduled_date, c.id DESC LIMIT 300`,
        ).all();
        return json({ content: results });
      } catch (e) {
        if (String(e).includes("no such table")) return err("migration_missing", "Run migration 0069 (content) first", 409);
        throw e;
      }
    }
    if (path === "/content" && method === "POST") {
      // v1.45.0 (security audit S3) — and this one also fires a notification
      // at any user id the caller names, so it should never have been the
      // one route in the group without a gate.
      if (!CONTENT_MANAGE.includes(user.role)) return err("forbidden", "Content access required", 403);
      const title = String(body?.title ?? "").trim();
      if (!title) return err("invalid_input", "A title is required", 400);
      const KINDS = ["video", "reel", "live", "campaign", "other"];
      const PLATFORMS = ["tiktok", "shopee", "instagram", "facebook", "other"];
      const kind = KINDS.includes(String(body?.kind)) ? String(body?.kind) : "video";
      const platform = PLATFORMS.includes(String(body?.platform)) ? String(body?.platform) : "tiktok";
      const sched = /^\d{4}-\d{2}-\d{2}$/.test(String(body?.scheduled_date ?? "")) ? String(body?.scheduled_date) : null;
      const assigned = Number(body?.assigned_to) || null;
      try {
        const res = await env.DB.prepare(
          `INSERT INTO content_items (title, kind, platform, scheduled_date, script, caption, campaign, assigned_to, notes, created_by)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10) RETURNING id`,
        ).bind(title, kind, platform, sched, String(body?.script ?? "").trim() || null, String(body?.caption ?? "").trim() || null,
               String(body?.campaign ?? "").trim() || null, assigned, String(body?.notes ?? "").trim() || null, user.id).first<{ id: number }>();
        await audit(env, user.id, "content.create", "content_items", String(res?.id), { title });
        if (assigned && assigned !== user.id) await notify(env, assigned, "content", `🎬 Content assigned to you: ${title}`, `content:${res?.id}`);
        return json({ id: res?.id }, 201);
      } catch (e) {
        if (String(e).includes("no such table")) return err("migration_missing", "Run migration 0069 (content) first", 409);
        throw e;
      }
    }
    const mC = path.match(/^\/content\/(\d+)$/);
    if (mC && method === "PATCH") {
      if (!CONTENT_MANAGE.includes(user.role)) return err("forbidden", "Content access required", 403);
      const sets: string[] = [];
      const args: unknown[] = [];
      const put = (col: string, v: unknown) => { sets.push(`${col} = ?${args.length + 1}`); args.push(v); };
      const STAGES = ["idea", "script", "shoot", "edit", "approval", "posted"];
      if (typeof body?.stage === "string" && STAGES.includes(body.stage)) {
        put("stage", body.stage);
        if (body.stage === "posted") put("posted_at", new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10));
      }
      for (const col of ["title", "kind", "platform", "script", "caption", "campaign", "performance", "notes"] as const) {
        if (typeof body?.[col] === "string") put(col, String(body[col]).trim() || null);
      }
      if (typeof body?.scheduled_date === "string") put("scheduled_date", /^\d{4}-\d{2}-\d{2}$/.test(body.scheduled_date) ? body.scheduled_date : null);
      if (body && "assigned_to" in body) put("assigned_to", Number(body.assigned_to) || null);
      if (sets.length === 0) return err("invalid_input", "Nothing to update", 400);
      await env.DB.prepare(`UPDATE content_items SET ${sets.join(", ")} WHERE id = ?${args.length + 1}`).bind(...args, Number(mC[1])).run();
      await audit(env, user.id, "content.update", "content_items", mC[1], body ?? {});
      return json({ ok: true });
    }
    if (mC && method === "DELETE") {
      if (!CONTENT_MANAGE.includes(user.role)) return err("forbidden", "Content access required", 403);
      await env.DB.prepare(`DELETE FROM content_items WHERE id = ?1`).bind(Number(mC[1])).run();
      await audit(env, user.id, "content.delete", "content_items", mC[1]);
      return json({ ok: true });
    }
  }

  /* ===================== v1.7.0 — Stokis management ======================== */
  {
    const STOKIS_MANAGE = ["super_admin", "admin", "ceo", "coo", "cco", "hr_admin", "sales_marketing", "marketing"];
    if (path === "/stokis" && method === "GET") {
      // v1.7.0: stokis rows carry contact PII + finance, so reading is gated to
      // the same tier that manages them (not every staff role).
      if (!STOKIS_MANAGE.includes(user.role)) return err("forbidden", "Sales/management access required", 403);
      const month = new URL(request.url).searchParams.get("month")
        ?? new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 7);
      try {
        const { results } = await env.DB.prepare(
          `SELECT s.*,
             (SELECT COALESCE(SUM(o.amount_cents), 0) FROM stokis_orders o WHERE o.stokis_id = s.id) AS total_cents,
             (SELECT COALESCE(SUM(o.amount_cents), 0) FROM stokis_orders o WHERE o.stokis_id = s.id AND o.payment_status = 'unpaid') AS balance_cents,
             (SELECT COALESCE(SUM(o.amount_cents), 0) FROM stokis_orders o WHERE o.stokis_id = s.id AND strftime('%Y-%m', o.ordered_at) = ?1) AS month_cents,
             (SELECT target_cents FROM stokis_targets t WHERE t.stokis_id = s.id AND t.month = ?1) AS target_cents
           FROM stokis s ORDER BY s.status = 'inactive', s.name`,
        ).bind(month).all<{ id: number; commission_pct: number; month_cents: number }>();
        const rows = results.map((r) => ({ ...r, commission_cents: Math.round((r.month_cents ?? 0) * (r.commission_pct ?? 0) / 100) }));
        return json({ stokis: rows, month });
      } catch (e) {
        if (String(e).includes("no such table")) return err("migration_missing", "Run migration 0069 (stokis) first", 409);
        throw e;
      }
    }
    if (path === "/stokis" && method === "POST") {
      if (!STOKIS_MANAGE.includes(user.role)) return err("forbidden", "Sales tier required", 403);
      const name = String(body?.name ?? "").trim();
      if (!name) return err("invalid_input", "Stokis name is required", 400);
      const pct = Number(body?.commission_pct);
      try {
        const res = await env.DB.prepare(
          `INSERT INTO stokis (name, company, phone, email, location, commission_pct, notes, joined_at, created_by)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9) RETURNING id`,
        ).bind(name, String(body?.company ?? "").trim() || null, String(body?.phone ?? "").trim() || null,
               String(body?.email ?? "").trim() || null, String(body?.location ?? "").trim() || null,
               Number.isFinite(pct) && pct >= 0 ? pct : 0, String(body?.notes ?? "").trim() || null,
               /^\d{4}-\d{2}-\d{2}$/.test(String(body?.joined_at ?? "")) ? String(body?.joined_at) : new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10),
               user.id).first<{ id: number }>();
        await audit(env, user.id, "stokis.create", "stokis", String(res?.id), { name });
        return json({ id: res?.id }, 201);
      } catch (e) {
        if (String(e).includes("no such table")) return err("migration_missing", "Run migration 0069 (stokis) first", 409);
        throw e;
      }
    }
    const mS = path.match(/^\/stokis\/(\d+)$/);
    if (mS && method === "PATCH") {
      if (!STOKIS_MANAGE.includes(user.role)) return err("forbidden", "Sales tier required", 403);
      const sets: string[] = [];
      const args: unknown[] = [];
      const put = (col: string, v: unknown) => { sets.push(`${col} = ?${args.length + 1}`); args.push(v); };
      for (const col of ["name", "company", "phone", "email", "location", "notes"] as const) {
        if (typeof body?.[col] === "string") put(col, String(body[col]).trim() || null);
      }
      if (typeof body?.status === "string" && ["active", "inactive"].includes(body.status)) put("status", body.status);
      if (Number.isFinite(Number(body?.commission_pct))) put("commission_pct", Number(body!.commission_pct));
      if (sets.length === 0) return err("invalid_input", "Nothing to update", 400);
      await env.DB.prepare(`UPDATE stokis SET ${sets.join(", ")} WHERE id = ?${args.length + 1}`).bind(...args, Number(mS[1])).run();
      await audit(env, user.id, "stokis.update", "stokis", mS[1], body ?? {});
      return json({ ok: true });
    }
    if (mS && method === "DELETE") {
      if (!STOKIS_MANAGE.includes(user.role)) return err("forbidden", "Sales tier required", 403);
      await env.DB.prepare(`DELETE FROM stokis WHERE id = ?1`).bind(Number(mS[1])).run();
      await env.DB.prepare(`DELETE FROM stokis_orders WHERE stokis_id = ?1`).bind(Number(mS[1])).run();
      await audit(env, user.id, "stokis.delete", "stokis", mS[1]);
      return json({ ok: true });
    }
    // Orders / purchases under a stokis.
    const mSO = path.match(/^\/stokis\/(\d+)\/orders$/);
    if (mSO && method === "GET") {
      if (!STOKIS_MANAGE.includes(user.role)) return err("forbidden", "Sales/management access required", 403);
      const { results } = await env.DB.prepare(
        `SELECT id, amount_cents, qty, note, payment_status, ordered_at FROM stokis_orders WHERE stokis_id = ?1 ORDER BY ordered_at DESC, id DESC LIMIT 200`,
      ).bind(Number(mSO[1])).all();
      return json({ orders: results });
    }
    if (mSO && method === "POST") {
      if (!STOKIS_MANAGE.includes(user.role)) return err("forbidden", "Sales tier required", 403);
      const cents = Math.round(Number(body?.amount_cents));
      if (!Number.isFinite(cents) || cents < 0) return err("invalid_input", "amount_cents required", 400);
      const paid = body?.payment_status === "paid" ? "paid" : "unpaid";
      const orderedAt = /^\d{4}-\d{2}-\d{2}$/.test(String(body?.ordered_at ?? "")) ? String(body?.ordered_at) : new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
      const res = await env.DB.prepare(
        `INSERT INTO stokis_orders (stokis_id, amount_cents, qty, note, payment_status, ordered_at, created_by)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) RETURNING id`,
      ).bind(Number(mSO[1]), cents, Number(body?.qty) || null, String(body?.note ?? "").trim() || null, paid, orderedAt, user.id).first<{ id: number }>();
      await audit(env, user.id, "stokis.order", "stokis_orders", String(res?.id), { stokis: mSO[1], cents });
      return json({ id: res?.id }, 201);
    }
    const mOrd = path.match(/^\/stokis\/orders\/(\d+)$/);
    if (mOrd && method === "PATCH") {
      if (!STOKIS_MANAGE.includes(user.role)) return err("forbidden", "Sales tier required", 403);
      if (typeof body?.payment_status === "string" && ["paid", "unpaid"].includes(body.payment_status)) {
        await env.DB.prepare(`UPDATE stokis_orders SET payment_status = ?1 WHERE id = ?2`).bind(body.payment_status, Number(mOrd[1])).run();
        await audit(env, user.id, "stokis.order_pay", "stokis_orders", mOrd[1], { payment_status: body.payment_status });
        return json({ ok: true });
      }
      return err("invalid_input", "payment_status required", 400);
    }
    if (mOrd && method === "DELETE") {
      if (!STOKIS_MANAGE.includes(user.role)) return err("forbidden", "Sales tier required", 403);
      await env.DB.prepare(`DELETE FROM stokis_orders WHERE id = ?1`).bind(Number(mOrd[1])).run();
      return json({ ok: true });
    }
    // Monthly target for a stokis.
    const mST = path.match(/^\/stokis\/(\d+)\/target$/);
    if (mST && method === "POST") {
      if (!STOKIS_MANAGE.includes(user.role)) return err("forbidden", "Sales tier required", 403);
      const month = String(body?.month ?? "");
      const cents = Math.round(Number(body?.target_cents));
      if (!/^\d{4}-\d{2}$/.test(month) || !Number.isFinite(cents) || cents < 0) return err("invalid_input", "month + target_cents required", 400);
      await env.DB.prepare(
        `INSERT INTO stokis_targets (stokis_id, month, target_cents, set_by) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(stokis_id, month) DO UPDATE SET target_cents = ?3, set_by = ?4`,
      ).bind(Number(mST[1]), month, cents, user.id).run();
      return json({ ok: true });
    }
  }

  /* ===================== v1.7.0 — Receipts, Credit Notes, Outstanding ====== */
  {
    const DOC_MANAGE = can(user.role, "sales") || can(user.role, "finance") || can(user.role, "exec_view");
    // Issue a payment receipt for a PAID invoice (idempotent — returns the
    // existing receipt if one was already issued).
    const mRcp = path.match(/^\/docs\/(\d+)\/receipt$/);
    if (mRcp && method === "POST") {
      if (!DOC_MANAGE) return err("forbidden", "Sales/finance access required", 403);
      const invId = Number(mRcp[1]);
      const inv = await env.DB.prepare(
        `SELECT id, doc_number, customer_id, total_cents, payment_status, payment_method, payment_ref, paid_at FROM sales_documents WHERE id = ?1 AND doc_type = 'INV'`,
      ).bind(invId).first<{ id: number; doc_number: string; customer_id: number; total_cents: number; payment_status: string; payment_method: string | null; payment_ref: string | null; paid_at: string | null }>();
      if (!inv) return err("not_found", "Invoice not found", 404);
      if (inv.payment_status !== "paid") return err("invalid_input", "Only a PAID invoice can have a receipt", 400);
      try {
        const existing = await env.DB.prepare(`SELECT id, receipt_number FROM receipts WHERE invoice_id = ?1`).bind(invId).first<{ id: number; receipt_number: string }>();
        if (existing) return json({ id: existing.id, receipt_number: existing.receipt_number, existed: true });
        const number = await docNumber(env, "RC");
        const token = crypto.randomUUID().replace(/-/g, "");
        const res = await env.DB.prepare(
          `INSERT INTO receipts (receipt_number, invoice_id, invoice_number, customer_id, amount_cents, payment_method, payment_ref, paid_at, share_token, created_by)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10) RETURNING id`,
        ).bind(number, invId, inv.doc_number, inv.customer_id, inv.total_cents, inv.payment_method, inv.payment_ref, inv.paid_at, token, user.id).first<{ id: number }>();
        /* v1.30.1 — a receipt INHERITS its invoice's entity. It acknowledges
           money paid into the bank account printed on THAT invoice: an
           AZ ONE consultancy invoice points at AZ ONE's Maybank, so an
           A2Z-lettered receipt for it would acknowledge money A2Z never
           received. A legacy (NULL) invoice's receipt stays unstamped and
           renders AZ ONE — same letterhead the client already holds.
           Best-effort separate query: pre-0073 it simply yields null. */
        let invIssuerR: "a2z" | "azoo" | null = null;
        try {
          const ir = await env.DB.prepare(`SELECT issuer_code FROM sales_documents WHERE id = ?1`)
            .bind(invId).first<{ issuer_code: string | null }>();
          invIssuerR = ir?.issuer_code === "azoo" ? "azoo" : ir?.issuer_code === "a2z" ? "a2z" : null;
        } catch { /* pre-0073 */ }
        if (invIssuerR) await stampIssuer(env, "receipts", res?.id, invIssuerR);
        await audit(env, user.id, "receipt.issue", "receipts", String(res?.id), { invoice: inv.doc_number, amount: inv.total_cents });
        return json({ id: res?.id, receipt_number: number }, 201);
      } catch (e) {
        if (String(e).includes("no such table")) return err("migration_missing", "Run migration 0069 (receipts) first", 409);
        throw e;
      }
    }
    // Issue a credit note against an invoice.
    const mCn = path.match(/^\/docs\/(\d+)\/credit-note$/);
    if (mCn && method === "POST") {
      if (!DOC_MANAGE) return err("forbidden", "Sales/finance access required", 403);
      const invId = Number(mCn[1]);
      const cents = Math.round(Number(body?.amount_cents));
      const reason = String(body?.reason ?? "").trim();
      if (!Number.isFinite(cents) || cents <= 0) return err("invalid_input", "A positive amount_cents is required", 400);
      const inv = await env.DB.prepare(`SELECT id, doc_number, customer_id, total_cents FROM sales_documents WHERE id = ?1 AND doc_type = 'INV'`).bind(invId).first<{ id: number; doc_number: string; customer_id: number; total_cents: number }>();
      if (!inv) return err("not_found", "Invoice not found", 404);
      if (cents > inv.total_cents) return err("invalid_input", "Credit note cannot exceed the invoice total", 400);
      try {
        const number = await docNumber(env, "CN");
        const token = crypto.randomUUID().replace(/-/g, "");
        const res = await env.DB.prepare(
          `INSERT INTO credit_notes (cn_number, invoice_id, invoice_number, customer_id, amount_cents, reason, share_token, created_by)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8) RETURNING id`,
        ).bind(number, invId, inv.doc_number, inv.customer_id, cents, reason || null, token, user.id).first<{ id: number }>();
        /* v1.30.1 — same inheritance as receipts: a credit note reverses
           money on the entity that invoiced it. */
        let invIssuerC: "a2z" | "azoo" | null = null;
        try {
          const ic = await env.DB.prepare(`SELECT issuer_code FROM sales_documents WHERE id = ?1`)
            .bind(invId).first<{ issuer_code: string | null }>();
          invIssuerC = ic?.issuer_code === "azoo" ? "azoo" : ic?.issuer_code === "a2z" ? "a2z" : null;
        } catch { /* pre-0073 */ }
        if (invIssuerC) await stampIssuer(env, "credit_notes", res?.id, invIssuerC);
        await audit(env, user.id, "credit_note.issue", "credit_notes", String(res?.id), { invoice: inv.doc_number, amount: cents });
        return json({ id: res?.id, cn_number: number }, 201);
      } catch (e) {
        if (String(e).includes("no such table")) return err("migration_missing", "Run migration 0069 (credit notes) first", 409);
        throw e;
      }
    }
    if (path === "/receipts" && method === "GET") {
      if (!DOC_MANAGE) return err("forbidden", "Sales/finance access required", 403);
      try {
        const { results } = await env.DB.prepare(
          `SELECT r.id, r.receipt_number, r.invoice_number, r.amount_cents, r.payment_method, r.payment_ref, r.paid_at, r.share_token, r.created_at, r.issuer_code, c.company
           FROM receipts r LEFT JOIN customers c ON c.id = r.customer_id ORDER BY r.id DESC LIMIT 200`,
        ).all();
        return json({ receipts: results });
      } catch (e) {
        if (String(e).includes("no such table")) return err("migration_missing", "Run migration 0069 first", 409);
        throw e;
      }
    }
    if (path === "/credit-notes" && method === "GET") {
      if (!DOC_MANAGE) return err("forbidden", "Sales/finance access required", 403);
      try {
        const { results } = await env.DB.prepare(
          `SELECT n.id, n.cn_number, n.invoice_number, n.amount_cents, n.reason, n.share_token, n.created_at, c.company, n.issuer_code
           FROM credit_notes n LEFT JOIN customers c ON c.id = n.customer_id ORDER BY n.id DESC LIMIT 200`,
        ).all();
        return json({ credit_notes: results });
      } catch (e) {
        if (String(e).includes("no such table")) return err("migration_missing", "Run migration 0069 first", 409);
        throw e;
      }
    }
    // Consolidated outstanding-payments report (unpaid invoices, oldest first).
    if (path === "/reports/outstanding" && method === "GET") {
      if (!DOC_MANAGE) return err("forbidden", "Sales/finance access required", 403);
      const { results } = await env.DB.prepare(
        `SELECT d.id, d.doc_number, d.total_cents, d.due_date, d.created_at, c.company, c.phone
         FROM sales_documents d LEFT JOIN customers c ON c.id = d.customer_id
         WHERE d.doc_type = 'INV' AND COALESCE(d.payment_status, 'unpaid') != 'paid'
         ORDER BY d.due_date IS NULL, d.due_date ASC, d.created_at ASC LIMIT 300`,
      ).all<{ total_cents: number }>();
      const total = results.reduce((a, r) => a + (r.total_cents ?? 0), 0);
      return json({ invoices: results, total_cents: total, count: results.length });
    }
  }

  return null; // not a staff route
}
