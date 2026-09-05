/**
 * PAID BY THE CLOCK — v1.109.0.
 *
 * The CEO, 05-09-2026, with a Saturday on the register (a part-time live host
 * in at 11:05, out at 22:30, both punches marked "rest day"): *"if live host
 * part time should count as part time working which is based on their
 * working hour and minus 1 hour of break"*.
 *
 * A part-time live host has no shift pattern and no rest days. Her paid
 * minutes on a day are clock-out minus clock-in, minus one hour of unpaid
 * break - and the break only when the day ran past five hours, which is the
 * statutory trigger the salaried pattern already uses (Employment Act 1955
 * s.60A(1)(a): no more than five consecutive hours without a break). A
 * three-hour evening session took no break and is not docked one.
 *
 * Its own file so the rule can be RUN by tests/hourly-by-the-clock.mjs
 * without bundling staff.ts. staff.ts imports it; nothing else defines it.
 */

/** THE STATUTORY TRIGGER for an unpaid break - Employment Act 1955
    s.60A(1)(a): no employee shall work more than five consecutive hours
    without a period of leisure of not less than thirty minutes. */
export const BREAK_AFTER_MINUTES = 5 * 60;

/** The part-timer's break: one hour. The CEO's number. */
export const HOURLY_BREAK_MINUTES = 60;

/** Minutes of unpaid break on a day of `spanMinutes` clocked. */
export function hourlyBreakFor(spanMinutes: number): number {
  return spanMinutes > BREAK_AFTER_MINUTES ? HOURLY_BREAK_MINUTES : 0;
}

/** Paid minutes for one clocked day. */
export function hourlyPaidMinutes(spanMinutes: number): number {
  if (spanMinutes <= 0) return 0;
  return spanMinutes - hourlyBreakFor(spanMinutes);
}
