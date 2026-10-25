/* v1.208.0 - ONE PAIRING RULE ON EVERY SCREEN.

   The owner's On Shift brief (25-10-2026): "Attendance owns or consumes
   history and calculations." The audit before it found the person's own
   hours worked out three ways:

     server     worker/src/clock-day.ts pairSessions - in, out, in, out,
                in the order they happened (payroll, OT, the report)
     Dashboard  its own copy of that pairing, with a 16-hour cap
     Attendance first clock-in to last clock-out - which counted the three
                hours at home between an 11:00-17:00 and a 20:00-22:00 shift

   The owner chose "use paired shifts": every screen now pairs punches with
   THIS function, a copy of the server's pairSessions kept import-free so the
   browser bundle does not reach into the worker. tests/on-shift-module.mjs
   bundles both and runs them on the same punches; they must agree.

   Display only. Payroll reads the server and only approved punches; these
   screens show every punch the person pressed, pending ones included, as
   they always have. */

/** One punch, as stored: SQLite UTC "YYYY-MM-DD HH:MM:SS". */
export interface Punch { type: string; at: string }

/** One stretch of work. `out` is null while it is still open. */
export interface Session { in: string; out: string | null; minutes: number }

const ms = (at: string): number => Date.parse(`${at.replace(" ", "T")}Z`);

/** The server's rule, word for word: a clock-in while one is open changes
    nothing, a clock-out with nothing open is ignored. */
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

/** The Malaysia date of a stored UTC stamp. */
export const mytDay = (at: string): string => new Date(ms(at) + 8 * 3600 * 1000).toISOString().slice(0, 10);

export interface DayHours {
  date: string;
  sessions: Session[];
  /** closed sessions only, in minutes */
  minutes: number;
  /** the last session of the day has no clock-out */
  open: boolean;
}

/** A month of punches, grouped by Malaysia day, newest day first. */
export function daysOf(records: { type: string; created_at: string }[]): DayHours[] {
  const by = new Map<string, Punch[]>();
  for (const r of records) {
    if (r.type !== "clock_in" && r.type !== "clock_out") continue;
    const d = mytDay(r.created_at);
    const list = by.get(d) ?? [];
    list.push({ type: r.type, at: r.created_at });
    by.set(d, list);
  }
  return [...by.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([date, list]) => {
      const sessions = pairSessions(list);
      const last = sessions[sessions.length - 1];
      return { date, sessions, minutes: sessionMinutes(sessions), open: Boolean(last && !last.out) };
    });
}

/** "7h 05m" */
export const hoursLabel = (minutes: number): string =>
  `${Math.floor(minutes / 60)}h ${String(Math.round(minutes % 60)).padStart(2, "0")}m`;
