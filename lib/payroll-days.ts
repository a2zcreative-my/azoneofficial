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
