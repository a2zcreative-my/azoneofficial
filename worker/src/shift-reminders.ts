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
 * This file imports only clock-day.ts so tests/shift-reminders.mjs can bundle
 * and run it without the rest of the worker.
 */
import { claimedSlots, isOpen, type Session, type Slot } from "./clock-day";

/** How far ahead the start and end reminders land. The CEO's number. */
export const LEAD_MINUTES = 30;
/** How long after the end minute the "ended" reminder can still be sent. */
export const ENDED_GRACE_MINUTES = 60;

export type ReminderKind = "start_soon" | "end_soon" | "ended";

export interface DueReminder {
  kind: ReminderKind;
  slot: Slot;
  /** Position of the slot in the day's list - part of the dedupe ref. */
  index: number;
  /** Dedupe ref, unique per person+date+shift+kind (the caller scopes by user). */
  ref: string;
  message: string;
}

const hh = (m: number) => {
  const mm = ((m % (24 * 60)) + 24 * 60) % (24 * 60);
  return `${String(Math.floor(mm / 60)).padStart(2, "0")}:${String(mm % 60).padStart(2, "0")}`;
};

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
    const name = slotName(slot);
    if (!claimed.has(index) && nowMin >= slot.start - LEAD_MINUTES && nowMin < slot.start) {
      const inMin = slot.start - nowMin;
      out.push({
        kind: "start_soon", slot, index, ref: `shift_start:${iso}:${index}`,
        message: `⏰ Your shift ${name} starts in ${inMin} min — tap Clock in when you arrive.`,
      });
    }
    if (open && nowMin >= slot.end - LEAD_MINUTES && nowMin < slot.end) {
      out.push({
        kind: "end_soon", slot, index, ref: `shift_end_soon:${iso}:${index}`,
        message: `⏰ Your shift ${name} ends at ${hh(slot.end)} — remember to tap Clock out before you leave.`,
      });
    }
    if (open && nowMin >= slot.end && nowMin < slot.end + ENDED_GRACE_MINUTES) {
      out.push({
        kind: "ended", slot, index, ref: `shift_ended:${iso}:${index}`,
        message: `🔔 Your shift ${name} has ended — tap Clock out now so today's hours are recorded.`,
      });
    }
  });
  return out;
}
