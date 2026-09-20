/**
 * v1.25.6 — shift-based TikTok sales attribution (CEO: "sales marketing when
 * clock in then it is supposed to capture their sales").
 *
 * Pure functions, no imports — deliberately, so tests/shift-sales-split.mjs
 * can import this file directly (node --experimental-strip-types) and prove
 * the pairing/splitting rules on real scenarios instead of trusting a copy.
 *
 * Rules (all the CEO's calls, 18-08-2026):
 *  - Every TikTok order landing while a sales_marketing person is clocked in
 *    is credited to them — INCLUDING orders inside a live session (the host
 *    keeps their credit too; he chose "all orders during shift" knowingly).
 *  - Several sales_marketing people on shift at once → the order is split
 *    equally, remainder cents to the first, so the team never invents money.
 *  - A forgotten clock-out cannot hoover up the whole night: a shift with no
 *    real clock-out is cut off at 23:59:59 MYT of the day it started (or at
 *    the next clock-in, whichever is earlier). A genuine overnight shift —
 *    one with a real clock-out after midnight — is honoured as punched.
 *
 * v1.171.0 — THE CEO, 20-09-2026, looking at two TikTok orders (18:53 and
 * 19:30) credited to a person whose sales duty ended at 18:00 and who was
 * simply still clocked in: *"Sales performance is incorrect ... the other
 * staff that was clock out late she was the one make the sales! not this
 * staff making the sales!"*. He chose "live host wins, shift capped":
 *
 *  - AN ORDER INSIDE A LIVE SESSION BELONGS TO THAT LIVE'S HOST, and to
 *    nobody else. The floor is not selling while the live is selling. (The
 *    host's own credit is added by the caller's live-session query, which is
 *    why this function simply skips those orders — `lives`.)
 *  - OUTSIDE A LIVE, a person earns only INSIDE THEIR PLANNED SELLING HOURS
 *    - the sales duty on the roster board - intersected with the hours they
 *    actually punched. Clocking out late earns nothing after the planned
 *    end; clocking in early earns nothing before the planned start
 *    (`duties`).
 *  - A DAY WITH NEITHER A DUTY NOR A LIVE CREDITS NOBODY. His words for the
 *    19:30 order. An order nobody was rostered to sell is the company's, not
 *    a windfall for whoever forgot to clock out.
 *
 * Both `lives` and `duties` are optional: omit them and the pre-v1.171.0
 * rules apply unchanged, which is what a database older than the sales-duty
 * migration (0128) gets.
 *
 * All timestamps are SQLite UTC strings ("YYYY-MM-DD HH:MM:SS") — they
 * compare correctly as plain strings, which is what makes this cheap.
 */

export interface ShiftPunch { user_id: number; type: string; created_at: string }
export interface ShiftOrder { created_at: string; cents: number | null }
/** v1.171.0 — a planned selling window, in MYT wall clock: one person, one
    day, "HH:MM"–"HH:MM". A row of `sales_shifts` (the roster's sales duty). */
export interface DutyWindow { user_id: number; date: string; start: string; end: string }
/** v1.171.0 — a live session window, MYT wall clock. Orders landing inside
    one belong to its host, so the shift split skips them entirely. */
export interface LiveWindow { date: string; start: string; end: string }

/** MYT wall-clock parts of a UTC timestamp. */
export function mytParts(utc: string): { date: string; hm: string } {
  const s = new Date(new Date(utc.replace(" ", "T") + "Z").getTime() + 8 * 3600_000).toISOString();
  return { date: s.slice(0, 10), hm: s.slice(11, 16) };
}

/** MYT date + "HH:MM" (+ seconds) → the same instant as a UTC SQLite string. */
function utcOf(date: string, hm: string, secs: string): string {
  return new Date(Date.parse(`${date}T${hm}:${secs}Z`) - 8 * 3600_000)
    .toISOString().slice(0, 19).replace("T", " ");
}

/** True when the instant falls inside any of the live windows (inclusive). */
export function inAnyLive(utc: string, lives: LiveWindow[]): boolean {
  const { date, hm } = mytParts(utc);
  return lives.some((l) => l.date === date && hm >= l.start && hm <= l.end);
}

/** v1.171.0 — cut punched shifts down to the hours the person was ROSTERED
    to sell. A punched shift with no duty that day survives nowhere: no plan,
    no credit. The end minute is inclusive (an order at 18:00:30 on an
    18:00 duty still counts; 18:01 does not). */
export function clipToDuty(
  shifts: { uid: number; from: string; to: string }[],
  duties: DutyWindow[],
): { uid: number; from: string; to: string }[] {
  const out: { uid: number; from: string; to: string }[] = [];
  for (const s of shifts) {
    for (const d of duties) {
      if (d.user_id !== s.uid) continue;
      const from = utcOf(d.date, d.start, "00");
      const to = utcOf(d.date, d.end, "59");
      const lo = s.from > from ? s.from : from;
      const hi = s.to < to ? s.to : to;
      if (lo <= hi) out.push({ uid: s.uid, from: lo, to: hi });
    }
  }
  return out;
}

/** 23:59:59 MYT of the MYT day containing the given UTC timestamp, as UTC. */
export function mytDayEndUtc(utc: string): string {
  const t = new Date(utc.replace(" ", "T") + "Z").getTime() + 8 * 3600_000;
  const d = new Date(t); // UTC fields now read as MYT wall clock
  const end = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59) - 8 * 3600_000;
  return new Date(end).toISOString().slice(0, 19).replace("T", " ");
}

/** Pair clock_in/clock_out punches into shift windows per user. */
export function pairShifts(
  punches: ShiftPunch[],
  nowUtc: string,
): { uid: number; from: string; to: string }[] {
  const shifts: { uid: number; from: string; to: string }[] = [];
  const sorted = [...punches].sort(
    (a, b) => a.user_id - b.user_id || (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0),
  );
  let prevUid: number | null = null;
  let openFrom: string | null = null;
  const min = (a: string, b: string) => (a < b ? a : b);
  const closeOpen = (uid: number, at: string) => {
    if (openFrom === null) return;
    const to = min(at, mytDayEndUtc(openFrom)); // no real clock-out → capped at day end
    if (to > openFrom) shifts.push({ uid, from: openFrom, to });
    openFrom = null;
  };
  for (const p of sorted) {
    if (p.user_id !== prevUid) {
      if (prevUid !== null) closeOpen(prevUid, nowUtc);
      prevUid = p.user_id;
    }
    if (p.type === "clock_in") {
      closeOpen(p.user_id, p.created_at); // clock_in while open supersedes
      openFrom = p.created_at;
    } else if (p.type === "clock_out" && openFrom !== null) {
      if (p.created_at > openFrom) shifts.push({ uid: p.user_id, from: openFrom, to: p.created_at });
      openFrom = null;
    }
  }
  if (prevUid !== null) closeOpen(prevUid, nowUtc);
  return shifts;
}

/** Credit each order to everyone selling when it landed, split equally.
    Returns Map<user_id, cents>. Orders with nobody on a rostered shift - and
    every order that belongs to a live host - are skipped (v1.171.0). */
export function shiftSalesSplit(
  punches: ShiftPunch[],
  orders: ShiftOrder[],
  nowUtc: string,
  opts: { duties?: DutyWindow[]; lives?: LiveWindow[] } = {},
): Map<number, number> {
  let shifts = pairShifts(punches, nowUtc);
  /* v1.171.0 - the planned hours win over the punched ones. `undefined`
     means the caller could not read a plan at all (pre-0128), and the old
     "whoever is clocked in" rule stands; an EMPTY list means there are no
     planned selling hours in the range, which credits nobody - the CEO's
     call, and the reason it is a different thing from undefined. */
  if (opts.duties) shifts = clipToDuty(shifts, opts.duties);
  const lives = opts.lives ?? [];
  const out = new Map<number, number>();
  for (const o of orders) {
    if (o.cents == null || o.cents <= 0) continue;
    /* inside a live - the host sold it, and the caller credits them */
    if (lives.length > 0 && inAnyLive(o.created_at, lives)) continue;
    const uids = [...new Set(
      shifts.filter((s) => o.created_at >= s.from && o.created_at <= s.to).map((s) => s.uid),
    )];
    if (uids.length === 0) continue;
    const share = Math.floor(o.cents / uids.length);
    uids.forEach((uid, i) => {
      const cents = i === 0 ? o.cents! - share * (uids.length - 1) : share;
      out.set(uid, (out.get(uid) ?? 0) + cents);
    });
  }
  return out;
}
