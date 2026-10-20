/* ot-pending.ts - v1.181.10: ONE ANSWER TO "WHICH OVERTIME IS WAITING".
 *
 * The CEO, 15-10-2026, on the dashboard: the tile said "6 OT PENDING" and
 * the card it opens listed three. Both were right about different things.
 * The tile counted ROWS of ot_records, and every stretch of overtime is two
 * rows - an OT in and an OT out - so three stretches counted six. The card
 * paired the rows into days and listed those. The Desk paired them a third
 * way, and unlike the card it still offered a month whose payslips were
 * already released.
 *
 * Three readers, three answers. This module is the one reader: the
 * dashboard tile counts what it returns, the Desk lists what it returns, and
 * the approvals card lists what it returns with the roster beside it. A
 * number on the dashboard is a promise about what opening it will show.
 *
 * What counts as waiting, in one place:
 *   - pending rows only (a decided stretch is history);
 *   - never in a month whose payslips are released (v1.159.8 - there is no
 *     payslip left for the decision to reach);
 *   - one entry per person per day, its stretches summed pair by pair (a
 *     day can hold an early start and a late finish);
 *   - only a day with at least one CLOSED stretch - an OT in with no OT out
 *     is not decidable yet, so it is not a decision waiting on anybody.
 */
import type { Env } from "./index";
import { pairSessions, sessionMinutes, type Punch, type Session } from "./clock-day";

export interface PendingOtDay {
  user_id: number;
  name: string;
  /** The day, YYYY-MM-DD, Malaysia time. */
  d: string;
  /** The closed stretches of that day, in order. Never empty. */
  closed: Session[];
  /** Minutes across every closed stretch. */
  minutes: number;
  /** UTC timestamp of the day's last OT out. */
  last_out: string;
}

type Row = { user_id: number; name: string; d: string; type: string; created_at: string };

export async function pendingOtDays(env: Env): Promise<PendingOtDay[]> {
  const cols = `SELECT o.user_id, COALESCE(NULLIF(TRIM(u.full_name), ''), u.name) AS name,
                date(o.created_at, '+8 hours') AS d, o.type, o.created_at
           FROM ot_records o JOIN users u ON u.id = o.user_id`;
  const { results: rows } = await env.DB.prepare(
    `${cols}
          WHERE o.status = 'pending'
            AND NOT EXISTS (SELECT 1 FROM payslip_releases pr WHERE pr.month = strftime('%Y-%m', o.created_at, '+8 hours'))
          ORDER BY o.created_at`,
  ).all<Row>()
    /* a database from before payslip_releases (0028) has no released month */
    .catch(() => env.DB.prepare(`${cols} WHERE o.status = 'pending' ORDER BY o.created_at`).all<Row>());

  const byDay = new Map<string, { user_id: number; name: string; d: string; punches: Punch[] }>();
  for (const r of rows ?? []) {
    const k = `${r.user_id}|${r.d}`;
    const g = byDay.get(k) ?? { user_id: r.user_id, name: r.name, d: r.d, punches: [] };
    g.punches.push({ type: r.type === "ot_in" ? "clock_in" : "clock_out", at: r.created_at });
    byDay.set(k, g);
  }
  const out: PendingOtDay[] = [];
  for (const g of byDay.values()) {
    const closed = pairSessions(g.punches).filter((x) => x.out);
    if (closed.length === 0) continue; // an OT in with no OT out is not decidable yet
    out.push({
      user_id: g.user_id, name: g.name, d: g.d, closed,
      minutes: sessionMinutes(closed),
      last_out: closed[closed.length - 1]!.out!,
    });
  }
  /* newest day first; within a day, by name, so the order never shuffles */
  out.sort((a, b) => b.d.localeCompare(a.d) || a.name.localeCompare(b.name));
  return out;
}
