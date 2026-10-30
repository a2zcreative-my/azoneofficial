/**
 * SHIFT REMINDERS - the pure half. v1.151.0.
 *
 * The CEO, 11-09-2026: *"the notification should popup 30 minutes before
 * their start shift based on their shift assigned and also clock in / out
 * reminder before 30 minutes and during their end shift timing. this is the
 * supposed flow"*.
 *
 * Until now the only shift-shaped reminders were two fixed clock-out nudges
 * at 18:30 and 22:00 MYT, the same for everyone. A live host on 11:00-17:00
 * + 20:30-22:30 was nagged at 18:30 while at home between blocks, and heard
 * nothing at 22:30 when his shift actually ended. Nobody was ever told a
 * shift was about to start.
 *
 * THREE REMINDERS PER SHIFT, FROM THE SAME LIST THE CLOCK USES. The shifts
 * are `daySlots` - pattern blocks, roster assignments and live sessions,
 * merged where they touch - which is exactly what the clock-in button
 * accepts a punch for. A reminder for a shift the clock would refuse would
 * be a lie, so both read one list.
 *
 *   start_soon  LEAD minutes before the shift starts, unless the person has
 *               already clocked in for it (turning up early is not a reason
 *               to be reminded to turn up).
 *   end_soon    LEAD minutes before the shift ends, only while a session is
 *               OPEN - a clock-out reminder to somebody who never clocked in
 *               is noise, and their absence is the late flag's business.
 *   ended       from the end minute for GRACE minutes, only while still open.
 *
 * CATCH-UP WINDOWS, NOT EXACT MINUTES. The cron ticks every five minutes and
 * a tick can be skipped. A reminder is DUE for the whole window (start-LEAD
 * up to start), and the caller dedupes by ref, so a missed tick delays a
 * reminder by five minutes instead of dropping it, and a second tick inside
 * the window cannot send it twice.
 *
 * v1.226.0 - THE OWNER'S SHIFT REMINDERS BRIEF, 30-10-2026
 * (claude/SHIFT-REMINDERS-AUDIT.md), and his answers: "15 minutes",
 * "Keep 'ended' + 22:00 only", "add the switches".
 *   - LEAD is 15 minutes.
 *   - Each reminder has a title and the brief's wording; the body names the
 *     time, never the client or task (the lock screen is not the bell).
 *   - THE REF CARRIES THE TIME, not the block's position: a start reminder
 *     is `shift_start:<date>:<HHMM start>`, an end reminder
 *     `shift_end_soon:<date>:<HHMM end>`. A shift moved from 09:00 to 10:00
 *     after its first reminder is a new reminder; a block added earlier in
 *     the day no longer renumbers the others and silences the wrong one.
 *   - `ttl`: how long the push may wait for an offline phone - only until
 *     the moment the reminder is about.
 *
 * This file imports only clock-day.ts so tests/shift-reminders.mjs can bundle
 * and run it without the rest of the worker.
 */
import { claimedSlots, isOpen, type Session, type Slot } from "./clock-day";

/** How far ahead the start and end reminders land. The owner's number
    (30 from 11-09-2026, 15 from the 30-10-2026 brief). */
export const LEAD_MINUTES = 15;
/** How long after the end minute the "ended" reminder can still be sent. */
export const ENDED_GRACE_MINUTES = 60;

export type ReminderKind = "start_soon" | "end_soon" | "ended";

export interface DueReminder {
  kind: ReminderKind;
  slot: Slot;
  /** Position of the slot in the day's list - part of the dedupe ref. */
  index: number;
  /** Dedupe ref, unique per person+date+shift time+kind (the caller scopes by user). */
  ref: string;
  /** the lock-screen title */
  title: string;
  /** the body - also the bell's text */
  message: string;
  /** seconds the push may wait for an offline phone (>= 60) */
  ttl: number;
}

const hh = (m: number) => {
  const mm = ((m % (24 * 60)) + 24 * 60) % (24 * 60);
  return `${String(Math.floor(mm / 60)).padStart(2, "0")}:${String(mm % 60).padStart(2, "0")}`;
};

/** "0900" - a time as it appears in a ref (minutes past the day's midnight;
    an overnight end past 24:00 keeps its own number, "2530", so it never
    collides with the same clock time earlier that day). */
const refTime = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}${String(m % 60).padStart(2, "0")}`;
const mins = (n: number) => `${n} minute${n === 1 ? "" : "s"}`;
const ttlTo = (target: number, nowMin: number) => Math.max(60, (target - nowMin) * 60);

/** "10:00-18:00" or "20:00-22:00 (Sara Beauty)" - the shift as the person reads it. */
export function slotName(s: Slot): string {
  return `${hh(s.start)}-${hh(s.end)}${s.what ? ` (${s.what})` : ""}`;
}

/**
 * Which reminders are due for ONE person on ONE date at `nowMin` (minutes
 * since midnight MYT of `iso`; may exceed 1440 when the caller is checking
 * yesterday's overnight shift from after midnight).
 *
 * `sessions` are that date's punches, paired. Pending punches count: this is
 * about what was PRESSED, not what is paid.
 */
export function dueReminders(nowMin: number, iso: string, slots: Slot[], sessions: Session[]): DueReminder[] {
  const out: DueReminder[] = [];
  if (slots.length === 0) return out;
  const claimed = claimedSlots(slots, sessions);
  const open = isOpen(sessions);
  slots.forEach((slot, index) => {
    if (!claimed.has(index) && nowMin >= slot.start - LEAD_MINUTES && nowMin < slot.start) {
      const inMin = slot.start - nowMin;
      out.push({
        kind: "start_soon", slot, index, ref: `shift_start:${iso}:${refTime(slot.start)}`,
        title: "Shift starting soon",
        message: `Your shift starts in ${mins(inMin)} at ${hh(slot.start)}. Get ready to clock in.`,
        ttl: ttlTo(slot.start, nowMin),
      });
    }
    if (open && nowMin >= slot.end - LEAD_MINUTES && nowMin < slot.end) {
      const inMin = slot.end - nowMin;
      out.push({
        kind: "end_soon", slot, index, ref: `shift_end_soon:${iso}:${refTime(slot.end)}`,
        title: "Shift ending soon",
        message: `Your shift ends in ${mins(inMin)} at ${hh(slot.end)}. Remember to clock out when your work is finished.`,
        ttl: ttlTo(slot.end, nowMin),
      });
    }
    if (open && nowMin >= slot.end && nowMin < slot.end + ENDED_GRACE_MINUTES) {
      out.push({
        kind: "ended", slot, index, ref: `shift_ended:${iso}:${refTime(slot.end)}`,
        title: "Shift ended",
        message: `Your shift ended at ${hh(slot.end)} and you are still clocked in. Clock out when your work is finished so today's hours are recorded.`,
        ttl: ttlTo(slot.end + ENDED_GRACE_MINUTES, nowMin),
      });
    }
  });
  return out;
}
