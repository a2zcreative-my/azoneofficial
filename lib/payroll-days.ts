/**
 * The payable-days arithmetic — v1.75.0.
 *
 * Two deductions can reduce a monthly salary, and they must come from two
 * sources that cannot overlap:
 *
 *   incomplete month  <- EMPLOYMENT DATES (joined_on / left_on)
 *   unpaid leave      <- days somebody explicitly recorded as unpaid
 *
 * Until v1.75.0 the first of those was prorated on DAYS CLOCKED, so a person
 * on approved medical leave — paid by law — had not clocked in, looked
 * absent, and was charged for it. Nur Nasuha, August 2026: 19 working days,
 * 15 clocked, 1 recorded unpaid, 1 approved medical. The medical day cost her
 * RM 105.26 on a payslip whose arithmetic looked tidy.
 *
 * Attendance no longer moves money on its own. A working day with no
 * clock-in is a QUESTION — it is proposed to a human, who records it as
 * unpaid leave if that is what it was.
 *
 * This module is the client half. The worker has the same two lines in
 * `staff.ts`; tests/payroll-days.mjs runs these and holds the worker's to the
 * same text, because two payroll formulas that disagree is two answers to
 * "what was I paid".
 */

/** One working day, in minutes. Eight hours, break included (CEO, 30-08-2026). */
export const WORK_DAY_MINUTES = 8 * 60;

/**
 * The incomplete-month deduction, in sen.
 *
 * `payableDays` is how many of the month's working days the person was
 * EMPLOYED for. For anyone who did not join or leave inside the month that
 * equals `monthDays` and this returns 0 — no flag and no special case: the
 * formula IS the rule that only a joiner or a leaver is prorated.
 */
export function incompleteCents(
  basicCents: number,
  monthDays: number | null | undefined,
  payableDays: number | null | undefined,
): number {
  if (!monthDays || monthDays <= 0) return 0;
  if (payableDays === null || payableDays === undefined) return 0;
  return payableDays < monthDays
    ? Math.round((basicCents * (monthDays - payableDays)) / monthDays)
    : 0;
}

/**
 * How much of a day is unpaid when somebody worked only part of it.
 *
 * Clocked 2h of 8 → 6h short → 0.75 day. Rounded to a quarter day on
 * purpose: a payslip line reading "0.708333 DAYS" is a line nobody can
 * check, and an argument about seven minutes costs more trust than it saves
 * in ringgit. Clamped to a whole day at most — a full day is a full day, and
 * more than one day is more than one row.
 */
export function unpaidDaysFromHours(hoursWorked: number): number {
  const worked = Math.max(0, Math.min(8, hoursWorked));
  const shortMins = WORK_DAY_MINUTES - Math.round(worked * 60);
  return Math.round((shortMins / WORK_DAY_MINUTES) * 4) / 4;
}

/** The unpaid-leave deduction, in sen. Employment Act 1955 s.60I: monthly
    wages ÷ 26 per day, a FIXED divisor and deliberately not the month's
    working days. Days may be fractional. */
export function unpaidCents(monthlyWageCents: number, days: number): number {
  return days > 0 ? Math.round((monthlyWageCents / 26) * days) : 0;
}

/** Monday of the week a date falls in. */
export function mondayOf(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

export interface UnpaidInput {
  basicCents: number;
  /** The person's working days in the month, after employment dates. */
  workingDays: string[];
  /** Days of the month that are neither working days nor public holidays. */
  restDays: string[];
  /** Public holidays inside the person's employment. */
  publicHolidays: number;
  /** Dates unpaid for the WHOLE day. A part day is not a day nobody worked. */
  fullyUnpaid: string[];
  /** Total recorded unpaid days, fractions included. */
  unpaidDays: number;
  /** The incomplete-month deduction already being taken, in sen. */
  incompleteCents: number;
}

export interface UnpaidResult { days: number; restDays: number; cents: number; capped: boolean }

/**
 * THE UNPAID-LEAVE DEDUCTION (v1.77.0).
 *
 * CEO, 31-08-2026: *"Zul Hisyam should entitle 2 PH but seem like the payroll
 * make it around 5++ which is not correct!"* He was right. Unpaid leave
 * deducts at the Employment Act's 1/26 ordinary rate, and 26 assumes a SIX-day
 * week. This company works five. So a person absent every one of August's 19
 * working days lost only 19/26 and kept 7/26 — RM 538.46 for a month in which
 * they did nothing, being the five Saturdays plus the two public holidays.
 *
 * THE RULE: a week in which every one of that person's working days is unpaid
 * also loses that week's rest days. Rest days are earned by working the week.
 * Chosen over "absent all month = nothing" because it has no cliff, and over
 * leaving it alone because leaving it alone pays Saturdays to somebody who
 * was not there.
 *
 * PUBLIC HOLIDAYS SURVIVE, always. s.60D(2) removes holiday pay only for
 * absence WITHOUT consent; recorded unpaid leave is consented absence. The cap
 * also stops incomplete-month and unpaid together exceeding the basic, which
 * they could before — and would have printed a negative payslip.
 */
export function unpaidDeduction(inp: UnpaidInput): UnpaidResult {
  const orp = inp.basicCents / 26;
  if (!(inp.unpaidDays > 0)) return { days: 0, restDays: 0, cents: 0, capped: false };
  const fully = new Set(inp.fullyUnpaid);
  const byWeek = new Map<string, string[]>();
  for (const d of inp.workingDays) {
    const k = mondayOf(d);
    const list = byWeek.get(k);
    if (list) list.push(d); else byWeek.set(k, [d]);
  }
  const restByWeek = new Map<string, number>();
  for (const d of inp.restDays) {
    const k = mondayOf(d);
    restByWeek.set(k, (restByWeek.get(k) ?? 0) + 1);
  }
  let restDays = 0;
  for (const [k, work] of byWeek) {
    /* A week with none of their working days in it cannot be a week they
       failed to work — there was nothing to work. */
    if (work.length === 0) continue;
    if (work.every((d) => fully.has(d))) restDays += restByWeek.get(k) ?? 0;
  }
  const raw = Math.round(orp * (inp.unpaidDays + restDays));
  const room = Math.max(0, inp.basicCents - inp.incompleteCents - Math.round(orp * inp.publicHolidays));
  const cents = Math.min(raw, room);
  return { days: inp.unpaidDays, restDays, cents, capped: cents < raw };
}

/**
 * WORKING ON A PUBLIC HOLIDAY (v1.77.0).
 *
 * CEO, 31-08-2026: *"if they are working on Public Holiday, then only will be
 * paid as double... which is we need to follow on the regulation"*. The
 * regulation, confirmed with him against the word "double": Employment Act
 * 1955 s.60D(3)(a)(i) — an employee who works on a paid holiday is paid TWO
 * days' wages at the ordinary rate IN ADDITION to the holiday pay already in
 * the monthly salary. Not working the holiday is the "1 day of paid" — it is
 * already inside the month.
 */
export function publicHolidayWorkedCents(monthlyWageCents: number, holidaysWorked: number): number {
  return holidaysWorked > 0 ? Math.round((monthlyWageCents / 26) * 2 * holidaysWorked) : 0;
}

/** A part-time hourly host's premium for hours on a public holiday:
    Employment (Part-Time Employees) Regulations 2010 — not less than twice
    the hourly rate. The hours already earned 1×; this is the second 1×. */
export function partTimeHolidayPremiumCents(minutesOnHoliday: number, hourlyRateCents: number): number {
  return minutesOnHoliday > 0 ? Math.round((minutesOnHoliday * hourlyRateCents) / 60) : 0;
}
