/**
 * SHIFT REMINDERS - the cron half. v1.151.0.
 *
 * Runs on the five-minute tick (index.ts). Reads the day ONCE for everyone -
 * shifts, assignments, punches, leave, holiday - and asks the pure half
 * (shift-reminders.ts) what is due for each person. Every reminder goes
 * through `notify`, so it is a bell, a web push and, when the relay is
 * configured, WhatsApp/email - the same three doors as every other
 * notification. Never fatal: the tick that carries the ELFIA orders pull has
 * already finished before this runs.
 *
 * WHO IS SKIPPED, AND WHY:
 *   rest day / nothing assigned   - no shift, nothing to remind.
 *   approved leave                - the day is theirs; a "clock in" bell on
 *                                   leave is the system forgetting it said yes.
 *   public holiday                - the PATTERN does not apply; a live or a
 *                                   task explicitly booked on the holiday
 *                                   still does, because somebody booked it.
 *   admin / super_admin           - the system's operators, not its staff -
 *                                   the same exclusion as the clock-out nudge.
 *
 * v1.226.0 - the owner's answers to the Shift Reminders brief:
 *   switches         - Profile -> "Shift reminders": shift_clock_in turns
 *                      the start reminder off, shift_clock_out the end ones
 *                      (notification_prefs, 0151; no row = on).
 *   one send         - notify(..., { once: true }) writes the bell row only
 *                      if this person has no row with that ref, in one
 *                      statement, and pushes only when it wrote it.
 *   tally            - what the pushes did, so the cron can log failures
 *                      (counts and status codes only - no address, no name).
 *
 * YESTERDAY TOO. A live booked 23:00-01:00 ends after midnight, when "today"
 * has rolled over. The runner also evaluates yesterday's shifts with the
 * clock read as minutes past yesterday's midnight (now + 1440), so the end
 * reminders for an overnight shift still arrive.
 */
import type { Env } from "./index";
import { assignedResolver, notify, shiftsOn, type PushTally } from "./staff";
import { daySlots, pairSessions, type Session } from "./clock-day";
import { dueReminders, type ReminderKind } from "./shift-reminders";
import { remainingWindows, type LeaveCoverage } from "../../lib/leave-coverage";

const NOT_REMINDED = new Set(["super_admin", "admin"]);

/** v1.226.0 - which switch governs which reminder */
export const PREF_OF: Record<ReminderKind, "shift_clock_in" | "shift_clock_out"> = {
  start_soon: "shift_clock_in", end_soon: "shift_clock_out", ended: "shift_clock_out",
};

export interface ReminderRun { sent: number; checked: number; skipped_off: number; push: PushTally }

export async function runShiftReminders(env: Env, now = new Date()): Promise<ReminderRun> {
  const myt = new Date(now.getTime() + 8 * 3600 * 1000);
  const today = myt.toISOString().slice(0, 10);
  const yesterday = new Date(myt.getTime() - 24 * 3600 * 1000).toISOString().slice(0, 10);
  const nowMin = myt.getUTCHours() * 60 + myt.getUTCMinutes();

  /* who works here today - one query, roles included so the operators can be
     left out without a second lookup */
  const { results: staff } = await env.DB.prepare(
    `SELECT id, role FROM users WHERE is_active = 1 AND role NOT IN ('customer')`,
  ).all<{ id: number; role: string }>();
  const people = (staff ?? []).filter((u) => !NOT_REMINDED.has(u.role));
  const push: PushTally = { sent: 0, failed: 0, pruned: 0, statuses: [] };
  if (people.length === 0) return { sent: 0, checked: 0, skipped_off: 0, push };

  /* the switches people turned OFF (no row = on; before 0151 = all on) */
  const off = new Set<string>();
  try {
    const { results } = await env.DB.prepare(
      `SELECT user_id, pref_key FROM notification_prefs WHERE enabled = 0 AND pref_key IN ('shift_clock_in', 'shift_clock_out')`,
    ).all<{ user_id: number; pref_key: string }>();
    for (const r of results ?? []) off.add(`${r.user_id}|${r.pref_key}`);
  } catch { /* pre-0151: everybody keeps the reminders */ }

  /* the day, read once */
  const [shiftsToday, shiftsYesterday, assigned] = await Promise.all([
    shiftsOn(env, today), shiftsOn(env, yesterday), assignedResolver(env, yesterday, today),
  ]);
  let onLeave: (LeaveCoverage & { user_id: number })[] = [];
  {
    const { results } = await env.DB.prepare(
      `SELECT user_id, start_date, end_date, days, day_part, coverage_json FROM leave_requests
       WHERE status = 'approved' AND start_date <= date(?1, '+1 day') AND end_date >= date(?2, '-1 day')`,
    ).bind(today, yesterday).all<LeaveCoverage & { user_id: number }>();
    onLeave = results ?? [];
  }
  const holidayOn = async (iso: string): Promise<boolean> => {
    try {
      const h = await env.DB.prepare(
        `SELECT 1 AS x FROM holidays WHERE holiday_date = ?1 AND COALESCE(kind, 'public') IN ('public', 'replacement') LIMIT 1`,
      ).bind(iso).first<{ x: number }>();
      return Boolean(h);
    } catch { return false; }
  };
  const [holToday, holYesterday] = await Promise.all([holidayOn(today), holidayOn(yesterday)]);

  /* every punch pressed today or yesterday, pending included - what was
     PRESSED decides whether somebody is clocked in, approval decides pay */
  const punches = new Map<string, Session[]>();
  {
    const { results } = await env.DB.prepare(
      `SELECT user_id, type, created_at, date(created_at, '+8 hours') AS d FROM attendance_records
        WHERE date(created_at, '+8 hours') IN (?1, ?2) ORDER BY created_at`,
    ).bind(today, yesterday).all<{ user_id: number; type: string; created_at: string; d: string }>();
    const raw = new Map<number, { type: string; at: string }[]>();
    for (const r of results ?? []) {
      const l = raw.get(r.user_id) ?? [];
      l.push({ type: r.type, at: r.created_at });
      raw.set(r.user_id, l);
    }
    // Pair before grouping by workday so today's out closes last night's in.
    for (const [uid, list] of raw) {
      for (const session of pairSessions(list)) {
        const day = new Date(Date.parse(`${session.in.replace(" ", "T")}Z`) + 8 * 3600000).toISOString().slice(0, 10);
        const key = `${uid}|${day}`;
        punches.set(key, [...(punches.get(key) ?? []), session]);
      }
    }
  }

  /* already sent - one query for every ref this pass could produce */
  const sentRefs = new Set<string>();
  {
    const { results } = await env.DB.prepare(
      `SELECT user_id, ref FROM notifications
        WHERE kind = 'attendance' AND (ref LIKE 'shift_%:' || ?1 || ':%' OR ref LIKE 'shift_%:' || ?2 || ':%')`,
    ).bind(today, yesterday).all<{ user_id: number; ref: string }>();
    for (const r of results ?? []) sentRefs.add(`${r.user_id}|${r.ref}`);
  }

  let sent = 0, checked = 0, skippedOff = 0;
  for (const u of people) {
    const days: [string, number, boolean][] = [[today, nowMin, holToday], [yesterday, nowMin + 24 * 60, holYesterday]];
    for (const [iso, clock, holiday] of days) {
      const sh = iso === today ? shiftsToday.get(u.id) : shiftsYesterday.get(u.id);
      const blocks = holiday ? [] : (sh?.windows ?? []);
      const scheduled = daySlots(blocks, assigned.list(u.id, iso).map((a) => ({ start: a.start, end: a.end, what: a.what })));
      const slots = remainingWindows(scheduled, onLeave.filter(l => l.user_id === u.id), iso);
      if (!slots?.length) continue;
      checked += 1;
      const due = dueReminders(clock, iso, slots, punches.get(`${u.id}|${iso}`) ?? []);
      for (const d of due) {
        if (sentRefs.has(`${u.id}|${d.ref}`)) continue;
        if (off.has(`${u.id}|${PREF_OF[d.kind]}`)) { skippedOff += 1; continue; }
        const wrote = await notify(env, u.id, "attendance", d.message, d.ref, {
          once: true, title: d.title, push: { ttl: d.ttl, urgency: "high" }, tally: push,
        });
        sentRefs.add(`${u.id}|${d.ref}`);
        if (wrote) sent += 1;
      }
    }
  }
  return { sent, checked, skipped_off: skippedOff, push };
}
