/**
 * A DAY ON THE CLOCK, IN SESSIONS — v1.133.0.
 *
 * The CEO, 07-09-2026: *"I want my staff being clock in and out based on
 * their working schedule like example 11:00am to 05:00pm then next shift
 * schedule 08:00pm to 10:00pm or 8:30pm to 10:30pm it is either. then
 * another shift maybe will be started at 2:00pm to 10:00pm. OT is based on
 * outside of their working schedule."*
 *
 * Until now a day was ONE clock-in and ONE clock-out (v1.4.29), and a split
 * day was handled by the schedule alone: punch at 11:00, punch at 22:30, and
 * the pattern's two blocks decide which of those eleven and a half hours were
 * work (v1.80.0). That is fine when the evening is IN the pattern. It fails
 * the moment the evening is not — a client booking a 20:00 live for somebody
 * whose pattern ends at 17:00 — because the only honest thing to do at 17:00
 * is clock out, and then there was no way to clock in again at 20:00.
 *
 * So a day is a LIST OF SESSIONS now: each clock-in opens one, each clock-out
 * closes it, and there can be as many as the day has shifts. The three hours
 * at home between 17:00 and 20:00 are inside no session, so they are counted
 * as nothing — no payroll query has to know they happened.
 *
 * And OVERTIME falls out of the same list: whatever part of a session lies
 * OUTSIDE the person's scheduled blocks is overtime, waiting for the CEO's
 * decision. The two OT buttons that existed since v1.4.155 recorded a second
 * pair of punches for the same evening; the clock already had them.
 *
 * Zero imports, pure functions: tests/clock-sessions.mjs bundles this file and
 * RUNS the rule on the CEO's own examples. Nothing in here touches a database,
 * a timezone library or a request.
 */

/** One punch, as stored: SQLite UTC "YYYY-MM-DD HH:MM:SS". */
export interface Punch { type: string; at: string }

/** One stretch of work. `out` is null while it is still open. */
export interface Session {
  in: string;
  out: string | null;
  /** Whole minutes between the two punches; 0 while open. */
  minutes: number;
}

/** A scheduled block, in minutes since midnight MYT. */
export interface Block { start: number; end: number }

/** A stretch of a session that lies outside every scheduled block. */
export interface Segment { from: number; to: number; minutes: number }

/** Below this, a stretch outside the schedule is a person packing up, not a
    shift. Somebody clocking out at 17:12 against a 17:00 end has not worked
    twelve minutes of overtime, and a queue of twelve-minute approvals is how
    the real ones stop being read. */
export const OT_MIN_MINUTES = 30;

const ms = (at: string): number => Date.parse(`${at.replace(" ", "T")}Z`);

/** Minutes since midnight, Malaysia time, for a stored UTC stamp. */
export function mytMinutes(at: string): number {
  const t = new Date(ms(at) + 8 * 3600 * 1000);
  return t.getUTCHours() * 60 + t.getUTCMinutes();
}

/**
 * Pair a day's punches into sessions, in the order they happened.
 *
 * A clock-in while a session is already open is ignored — the open one is
 * the truth, and a second in changes nothing about when work began. A
 * clock-out with nothing open is ignored too: it belongs to a day with no
 * start, which the forgotten-punch flow (v1.76.0) records as PENDING and
 * this function is only ever given approved punches. Both cases are data
 * the server refuses at the door now; tolerating them here is so a row that
 * predates that rule cannot crash a payroll query.
 */
export function pairSessions(punches: Punch[]): Session[] {
  const sorted = [...punches].sort((a, b) => a.at.localeCompare(b.at));
  const out: Session[] = [];
  let open: Session | null = null;
  for (const p of sorted) {
    if (p.type === "clock_in") {
      if (open) continue;
      open = { in: p.at, out: null, minutes: 0 };
      out.push(open);
    } else if (p.type === "clock_out") {
      if (!open) continue;
      open.out = p.at;
      open.minutes = Math.max(0, Math.round((ms(p.at) - ms(open.in)) / 60000));
      open = null;
    }
  }
  return out;
}

/** Minutes across every CLOSED session. An open one has no length yet. */
export function sessionMinutes(sessions: Session[]): number {
  return sessions.reduce((n, s) => n + (s.out ? s.minutes : 0), 0);
}

/** The first clock-in of the day, or null. What "in" means on a register row. */
export function firstIn(sessions: Session[]): string | null {
  return sessions[0]?.in ?? null;
}

/** The last clock-OUT of the day, or null — null also when the last session
    is still open, because "out" on a register row means the day is over. */
export function lastOut(sessions: Session[]): string | null {
  const last = sessions[sessions.length - 1];
  return last && last.out ? last.out : null;
}

/** True while a session is open: the person is clocked in right now. */
export function isOpen(sessions: Session[]): boolean {
  const last = sessions[sessions.length - 1];
  return Boolean(last && !last.out);
}

/** How much of [from, to] falls inside the blocks. The same overlap the
    schedule module computes; restated here so this file stays import-free. */
export function minutesInside(blocks: Block[], from: number, to: number): number {
  if (to <= from) return 0;
  return blocks.reduce((n, b) => n + Math.max(0, Math.min(to, b.end) - Math.max(from, b.start)), 0);
}

/**
 * The parts of ONE closed session that lie outside every block, as segments.
 *
 * On a rest day (no blocks) the whole session is one segment: there is no
 * schedule to be inside. A session that crosses midnight is clamped at
 * 24:00 — the next day's punches make their own sessions.
 */
export function outsideBlocks(blocks: Block[], from: number, to: number): Segment[] {
  const end = Math.min(to, 24 * 60);
  if (end <= from) return [];
  const sorted = [...blocks].sort((a, b) => a.start - b.start);
  const segs: Segment[] = [];
  let cursor = from;
  for (const b of sorted) {
    if (b.end <= cursor) continue;
    if (b.start >= end) break;
    if (b.start > cursor) segs.push({ from: cursor, to: b.start, minutes: b.start - cursor });
    cursor = Math.max(cursor, b.end);
  }
  if (cursor < end) segs.push({ from: cursor, to: end, minutes: end - cursor });
  return segs;
}

/**
 * THE OVERTIME RULE. The CEO's words: "OT is based on outside of their
 * working schedule." For one closed session, the segments outside the
 * person's blocks that are long enough to be a shift rather than a
 * lingering. On a rest day every minute is outside.
 */
export function overtimeSegments(blocks: Block[], from: number, to: number): Segment[] {
  return outsideBlocks(blocks, from, to).filter((s) => s.minutes >= OT_MIN_MINUTES);
}

/**
 * Which block a clock-OUT should be judged against.
 *
 * The mirror of `lateAgainst` for the way in. A clock-out at 17:00 on an
 * 11:00-17:00 + 20:00-22:00 day is the END OF A SHIFT, not five hours early
 * against 22:00 — that is exactly the misreading that per-shift clocking
 * exists to remove. Inside a block: that block's end. Between blocks: the
 * block just finished (so leaving at 17:30 is not early). Before the first
 * block or with no blocks: null — nothing to be early against.
 */
export function earlyAgainst(blocks: Block[], minutes: number): number | null {
  const sorted = [...blocks].sort((a, b) => a.start - b.start);
  const inside = sorted.find((b) => minutes >= b.start && minutes <= b.end);
  if (inside) return inside.end;
  const before = [...sorted].reverse().find((b) => b.end < minutes);
  return before ? before.end : null;
}

/* ── v1.133.2 — A CLOCK-IN MUST HAVE A SHIFT TO CLOCK IN FOR ─────────────
 *
 * The CEO, 07-09-2026, having clocked in and out four times at 23:32 on a
 * 10:00-18:00 pattern: *"user can clock in more than 2 time which is not
 * correct! it is supposed to based on the working hours that scheduled for
 * them and based on the Roster and Scheduled assigned to them also!"*
 *
 * v1.133.0 bounded the day by nothing: any clock-out could be followed by a
 * clock-in. The bound is the SCHEDULE — the pattern's blocks, plus whatever
 * the roster and the live board have assigned that day. Each of those is one
 * shift, and one shift can be clocked in for once.
 */

/** A shift somebody can clock in for. `what` names an assignment (a client,
    a task); a pattern block has none. */
export interface Slot { start: number; end: number; what?: string }

/**
 * The day's shifts: pattern blocks and assignments, merged where they touch.
 * A 20:00 live inside a 20:30-22:30 block is ONE evening shift, not two — an
 * unmerged pair would let the same evening be clocked in for twice, which is
 * the bug this exists to close. Sorted by start.
 */
export function daySlots(blocks: Block[], assigned: Slot[]): Slot[] {
  const all: Slot[] = [
    ...blocks.map((b) => ({ start: b.start, end: b.end })),
    ...assigned.map((a) => ({ start: a.start, end: a.end, what: a.what })),
  ].filter((s) => s.end > s.start).sort((a, b) => a.start - b.start || a.end - b.end);
  const out: Slot[] = [];
  for (const s of all) {
    const last = out[out.length - 1];
    if (last && s.start <= last.end) {
      last.end = Math.max(last.end, s.end);
      if (!last.what && s.what) last.what = s.what;
    } else out.push({ ...s });
  }
  return out;
}

/**
 * Which shift a clock-in at `minute` is FOR. The one it falls inside; else
 * the next one ahead (turning up early); else the last one behind (turning
 * up late — the half-day rule deals with how late). -1 with no shifts.
 */
export function slotFor(slots: Slot[], minute: number): number {
  const inside = slots.findIndex((s) => minute >= s.start && minute <= s.end);
  if (inside >= 0) return inside;
  const next = slots.findIndex((s) => s.start > minute);
  if (next >= 0) return next;
  return slots.length ? slots.length - 1 : -1;
}

/** The shifts already clocked in for, each session claiming the shift its
    clock-in was for. Two sessions cannot claim one shift: the second falls
    through to the next unclaimed one, so a clock-out-and-back-in inside the
    same block still counts against the day's shifts. */
export function claimedSlots(slots: Slot[], sessions: Session[]): Set<number> {
  const claimed = new Set<number>();
  for (const se of sessions) {
    let i = slotFor(slots, mytMinutes(se.in));
    if (i < 0) continue;
    while (i < slots.length && claimed.has(i)) i++;
    if (i < slots.length) claimed.add(i);
  }
  return claimed;
}

/**
 * THE RULE. A clock-in at `minute` may open a session only for an unclaimed
 * shift: the one it is for, or failing that the next unclaimed one still
 * ahead. No shifts at all → "no_slots" (a rest day with nothing on the
 * roster). Every shift already clocked → "all_claimed".
 */
export function canClockIn(
  slots: Slot[], sessions: Session[], minute: number,
): { ok: true; slot: Slot | null } | { ok: false; reason: "no_slots" | "all_claimed" } {
  /* v1.134.2 - a REST DAY with nothing on the roster is ONE clock-in, not
     none. The CEO: a rest day worked is "for me to decide either OT or
     replacement leave" - and there is nothing to decide about a day the
     clock refused to record. One session; the decision is his. */
  if (slots.length === 0) {
    return sessions.length === 0 ? { ok: true, slot: null } : { ok: false, reason: "all_claimed" };
  }
  const claimed = claimedSlots(slots, sessions);
  const i = slotFor(slots, minute);
  if (i >= 0 && !claimed.has(i)) return { ok: true, slot: slots[i]! };
  const ahead = slots.findIndex((s, j) => !claimed.has(j) && s.end > minute);
  if (ahead >= 0) return { ok: true, slot: slots[ahead]! };
  return { ok: false, reason: "all_claimed" };
}

/** "10:00-18:00 · 20:00-22:00 (Sara Beauty)" — the day's shifts as a person reads them. */
export function slotsLabel(slots: Slot[]): string {
  const hh = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  return slots.map((s) => `${hh(s.start)}-${hh(Math.min(s.end, 24 * 60))}${s.what ? ` (${s.what})` : ""}`).join(" · ");
}
