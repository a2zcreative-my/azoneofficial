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
 * YESTERDAY TOO. A live booked 23:00-01:00 ends after midnight, when "today"
 * has rolled over. The runner also evaluates yesterday's shifts with the
 * clock read as minutes past yesterday's midnight (now + 1440), so the end
 * reminders for an overnight shift still arrive.
 */
import type { Env } from "./index";
import { assignedResolver, notify, shiftsOn } from "./staff";
import { daySlots, pairSessions, type Session } from "./clock-day";
import { dueReminders } from "./shift-reminders";

const NOT_REMINDED = new Set(["super_admin", "admin"]);

export async function runShiftReminders(env: Env, now = new Date()): Promise<{ sent: number; checked: number }> {
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
  if (people.length === 0) return { sent: 0, checked: 0 };

  /* the day, read once */
  const [shiftsToday, shiftsYesterday, assigned] = await Promise.all([
    shiftsOn(env, today), shiftsOn(env, yesterday), assignedResolver(env, yesterday, today),
  ]);
  const onLeave = new Set<number>();
  try {
    const { results } = await env.DB.prepare(
      `SELECT user_id FROM leave_requests WHERE status = 'approved' AND start_date <= ?1 AND end_date >= ?1`,
    ).bind(today).all<{ user_id: number }>();
    for (const r of results ?? []) onLeave.add(r.user_id);
  } catch { /* pre-leave */ }
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
    const raw = new Map<string, { type: string; at: string }[]>();
    for (const r of results ?? []) {
      const k = `${r.user_id}|${r.d}`;
      const l = raw.get(k) ?? [];
      l.push({ type: r.type, at: r.created_at });
      raw.set(k, l);
    }
    for (const [k, l] of raw) punches.set(k, pairSessions(l));
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

  let sent = 0, checked = 0;
  for (const u of people) {
    if (onLeave.has(u.id)) continue;
    const days: [string, number, boolean][] = [[today, nowMin, holToday], [yesterday, nowMin + 24 * 60, holYesterday]];
    for (const [iso, clock, holiday] of days) {
      const sh = iso === today ? shiftsToday.get(u.id) : shiftsYesterday.get(u.id);
      const blocks = holiday ? [] : (sh?.windows ?? []);
      const slots = daySlots(blocks, assigned.list(u.id, iso).map((a) => ({ start: a.start, end: a.end, what: a.what })));
      if (slots.length === 0) continue;
      checked += 1;
      const due = dueReminders(clock, iso, slots, punches.get(`${u.id}|${iso}`) ?? []);
      for (const d of due) {
        if (sentRefs.has(`${u.id}|${d.ref}`)) continue;
        await notify(env, u.id, "attendance", d.message, d.ref);
        sentRefs.add(`${u.id}|${d.ref}`);
        sent += 1;
      }
    }
  }
  return { sent, checked };
}
