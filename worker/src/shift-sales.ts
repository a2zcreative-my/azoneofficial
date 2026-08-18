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
 * All timestamps are SQLite UTC strings ("YYYY-MM-DD HH:MM:SS") — they
 * compare correctly as plain strings, which is what makes this cheap.
 */

export interface ShiftPunch { user_id: number; type: string; created_at: string }
export interface ShiftOrder { created_at: string; cents: number | null }

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

/** Credit each order to everyone on shift when it landed, split equally.
    Returns Map<user_id, cents>. Orders with nobody on shift are skipped. */
export function shiftSalesSplit(
  punches: ShiftPunch[],
  orders: ShiftOrder[],
  nowUtc: string,
): Map<number, number> {
  const shifts = pairShifts(punches, nowUtc);
  const out = new Map<number, number>();
  for (const o of orders) {
    if (o.cents == null || o.cents <= 0) continue;
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
