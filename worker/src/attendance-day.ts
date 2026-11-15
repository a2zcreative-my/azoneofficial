/* v1.307.0 - ATTENDANCE WORKSPACE 4.0: THE ONE ATTENDANCE VERDICT (the CEO,
   14-11-2026, "approve as the recommendation and correct it the error issue";
   claude/ATTENDANCE-WORKSPACE-4.0-BLUEPRINT.md section 6, A-1 and A-5).

   Before this file there were two engines. The Overview, the Dashboard's
   donut and /dashboard/attendance-today called everybody without a clock-in
   "Not clocked in" and everybody in after a fixed 10:00 "late" - so on
   Saturday 14 November 2026 all seven staff, on their rest day, were "Not
   clocked in". The verification report used each person's own schedule, but
   counted TODAY as absent the moment it was opened and had no grace. Every
   screen now asks this one function, in this order (the first match wins):

     1 not employed that day          -> not counted
     2 a rest day in their own week   -> rest_day   (a punch is "worked on a day off")
     3 a holiday they are entitled to -> holiday    (the same)
     4 approved full-day leave        -> leave
     5 clocked in (approved punches)  -> present / late (after start + grace) /
                                         on shift / missing clock-out
     6 only an unapproved punch       -> pending   (counts for nothing yet)
     7 nothing at all                 -> not_due before start + grace,
                                         not_in until the last block ends,
                                         absent only after that

   Pure: no database, no clock. tests/attendance4.mjs runs it directly. */

/** A5 - the grace before a clock-in is late, effective-dated so a month
    already measured and paid never moves. Approved 14-11-2026: 10 minutes,
    from the first working day after the approval. Before it: none, as it
    always was. A change is a new row here (one release), never an edit of
    an old one. */
export const LATE_GRACE: readonly { from: string; minutes: number }[] = [
  { from: "2026-11-16", minutes: 10 },
];
export function graceOn(day: string): number {
  let g = 0;
  for (const r of LATE_GRACE) if (day >= r.from) g = r.minutes;
  return g;
}

/** How long an open session may run past the last block before it is a
    missing clock-out - the same hour the end-of-shift reminder waits. */
export const MISSING_OUT_AFTER_MINUTES = 60;

export type DayStatus =
  | "not_employed" | "rest_day" | "holiday" | "leave"
  | "present" | "late" | "on_shift" | "missing_out"
  | "pending" | "not_due" | "not_in" | "absent";

export interface Window { start: number; end: number }
export interface DaySession { inMin: number; outMin: number | null }

export interface DayInput {
  day: string;            // YYYY-MM-DD, Malaysia
  today: string;          // YYYY-MM-DD, Malaysia
  nowMin: number;         // minutes since midnight now, Malaysia
  employed: boolean;
  restDay: boolean;       // no block in the person's own week that day
  holiday: string | null; // a holiday name they are entitled to, or null
  fullLeave: string | null; // approved full-day leave type, or null
  partialLeave: boolean;  // approved partial leave touching the day
  pattern: Window[];      // the day's pattern blocks
  assigned: Window[];     // roster commitments (lives, task blocks, sales duty)
  sessions: DaySession[]; // APPROVED punches, paired, in order
  pendingPunches: number; // punches waiting for approval that day
}

export interface DayVerdict {
  status: DayStatus;
  late: boolean;
  lateMinutes: number;
  /** a punch on a rest day or holiday - shown for review, never dropped */
  workedOffDay: boolean;
  /** the first block's start and the last block's end, minutes; null on a day off */
  start: number | null;
  end: number | null;
}

const merged = (a: Window[], b: Window[]): Window[] => {
  const all = [...a, ...b].filter((w) => w.end > w.start).sort((x, y) => x.start - y.start || x.end - y.end);
  const out: Window[] = [];
  for (const w of all) {
    const last = out[out.length - 1];
    if (last && w.start <= last.end) last.end = Math.max(last.end, w.end);
    else out.push({ ...w });
  }
  return out;
};

/** The start a clock-in is judged against - the block it falls in, else the
    next one ahead, else the last one behind (staff.ts lateAgainst, the rule
    the verification report has used since v1.133.0). */
export function lateStart(pattern: Window[], minute: number): number | null {
  const inside = pattern.find((w) => minute >= w.start && minute <= w.end);
  if (inside) return inside.start;
  const next = pattern.find((w) => w.start > minute);
  if (next) return next.start;
  return pattern.length ? pattern[pattern.length - 1]!.start : null;
}

/** Late or not, by the person's own schedule plus the grace. A clock-in for a
    roster commitment outside the pattern is not late (the verification rule). */
export function lateBy(pattern: Window[], assigned: Window[], inMin: number, grace: number): number {
  const inAssigned = assigned.some((w) => inMin >= w.start && inMin <= w.end);
  const inPattern = pattern.some((w) => inMin >= w.start && inMin <= w.end);
  if (inAssigned && !inPattern) return 0;
  const s = lateStart(pattern, inMin);
  if (s === null) return 0;
  return inMin - s > grace ? inMin - s : 0;
}

export function dayVerdict(x: DayInput): DayVerdict {
  const blocks = merged(x.pattern, x.assigned);
  const start = blocks.length ? blocks[0]!.start : null;
  const end = blocks.length ? blocks[blocks.length - 1]!.end : null;
  const worked = x.sessions.length > 0;
  const base = { late: false, lateMinutes: 0, workedOffDay: false, start, end };
  if (!x.employed) return { ...base, status: "not_employed" };
  if ((x.restDay && x.assigned.length === 0) || blocks.length === 0) return { ...base, status: "rest_day", workedOffDay: worked, start: null, end: null };
  if (x.holiday) return { ...base, status: "holiday", workedOffDay: worked };
  if (x.fullLeave) return { ...base, status: "leave" };

  const past = x.day < x.today;
  const isToday = x.day === x.today;
  const grace = graceOn(x.day);
  if (worked) {
    const first = x.sessions[0]!;
    const lm = lateBy(x.pattern, x.assigned, first.inMin, grace);
    const last = x.sessions[x.sessions.length - 1]!;
    const open = last.outMin === null;
    const overdue = open && (past || (isToday && end !== null && x.nowMin > end + MISSING_OUT_AFTER_MINUTES));
    const status: DayStatus = overdue ? "missing_out" : open ? "on_shift" : lm > 0 ? "late" : "present";
    return { ...base, status, late: lm > 0, lateMinutes: lm };
  }
  if (x.pendingPunches > 0) return { ...base, status: "pending" };
  if (x.partialLeave) return { ...base, status: "leave" };
  if (x.day > x.today) return { ...base, status: "not_due" };
  if (isToday) {
    if (start !== null && x.nowMin < start + grace) return { ...base, status: "not_due" };
    if (end !== null && x.nowMin <= end) return { ...base, status: "not_in" };
  }
  return { ...base, status: "absent" };
}

/** Malaysia "now" as a day and a minute, from a UTC millisecond clock. */
export function mytNow(ms: number): { today: string; nowMin: number } {
  const t = new Date(ms + 8 * 3600 * 1000);
  return { today: t.toISOString().slice(0, 10), nowMin: t.getUTCHours() * 60 + t.getUTCMinutes() };
}
