"use client";

/* v1.8.0 — reference-design dashboard cards: the attendance donut, today's
   assignments table, and the compact month-by-month bars. All fed by data
   the dashboard already loads (summary + revenue) or the roster endpoint. */

import { useEffect, useState } from "react";
import { makeApi } from "@/lib/api";
import { Donut } from "@/components/ui/donut";
import { card, th, td, chipSuccess, chipWarn, chipNeutral } from "@/lib/ui-styles";
import { fmtRM, ym } from "@/lib/format";

const api = makeApi("/staff");

/* ---- Attendance today (donut) ---- */
export function AttendanceDonutCard({ onTime, late, staffTotal, onOpen }: {
  onTime: number; late: number; staffTotal: number; onOpen?: () => void;
}) {
  const notIn = Math.max(0, staffTotal - onTime - late);
  return (
    <button type="button" onClick={onOpen} className={`${card} block w-full text-left transition-colors hover:border-primary`}>
      <p className="text-sm font-semibold">Attendance today</p>
      <div className="mt-2">
        <Donut
          centerLabel={String(staffTotal)}
          centerSub="staff"
          /* v1.15.0: the ring uses the VALIDATED chart steps, not the status
             text tokens. Two reasons: --warning/--danger are not separable
             from each other (dE 2.8 deuteranopia, 9.9 normal vision), and in
             dark mode --success flips to a light text-grade green that reads
             wrong as a fill. --ring-* passes every check in both themes. */
          slices={[
            { label: "On time", value: onTime, color: "var(--ring-ontime)" },
            { label: "Late", value: late, color: "var(--ring-late)" },
            { label: "Not clocked in", value: notIn, color: "var(--ring-absent)" },
          ]}
        />
      </div>
    </button>
  );
}

/* ---- Today's assignments (table) ---- */
interface RosterSessionLite {
  id: number; session_date: string; start_time: string; end_time: string | null;
  platform: string; status: string; client: string | null; host_name: string;
}

export function TodayAssignmentsCard({ onOpenRoster }: { onOpenRoster?: () => void }) {
  const [sessions, setSessions] = useState<RosterSessionLite[] | null>(null);
  useEffect(() => {
    void api<{ sessions: RosterSessionLite[]; days: string[] }>(`/roster`).then((r) => {
      if (r.ok && r.data?.sessions) {
        const todayS = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
        setSessions(r.data.sessions.filter((s) => s.session_date === todayS && s.status !== "cancelled"));
      } else setSessions([]);
    });
  }, []);
  return (
    <div className={card}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold">Assignments today</p>
        {onOpenRoster && (
          <button type="button" className="text-gold-deep text-xs font-medium underline" onClick={onOpenRoster}>
            Open roster ↗
          </button>
        )}
      </div>
      {!sessions ? (
        <p className="text-muted-foreground mt-2 text-sm">Loading…</p>
      ) : sessions.length === 0 ? (
        <p className="text-muted-foreground mt-2 text-sm">No live sessions scheduled today.</p>
      ) : (
        <table className="mt-2 w-full border-collapse text-sm">
          <thead><tr className="border-border border-b">
            <th className={th}>HOST</th><th className={th}>CLIENT</th><th className={th}>TIME</th><th className={th}>STATUS</th>
          </tr></thead>
          <tbody>
            {sessions.slice(0, 8).map((s) => (
              <tr key={s.id} className="border-border border-b last:border-0">
                <td className={td}>
                  <span className="bg-brand mr-1.5 inline-flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold text-white" aria-hidden>
                    {s.host_name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase()}
                  </span>
                  {s.host_name.split(" ")[0]}
                </td>
                <td className={td}><span className={chipNeutral}>{s.client ?? s.platform}</span></td>
                <td className={`${td} tabular-nums whitespace-nowrap`}>{s.start_time}{s.end_time ? `–${s.end_time}` : ""}</td>
                <td className={td}>
                  <span className={s.status === "completed" ? chipSuccess : chipWarn}>{s.status === "completed" ? "✓ done" : "scheduled"}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/* ---- Month-by-month bars (this year, all channels) ---- */
export function MonthlyBarsCard({ months }: { months: { month: string; cents: number }[] }) {
  if (months.length === 0) return null;
  const max = Math.max(...months.map((m) => m.cents), 1);
  const best = months.reduce((a, m) => (m.cents > a.cents ? m : a), months[0]!);
  return (
    <div className={card}>
      <p className="text-sm font-semibold">Sales by month</p>
      <p className="text-muted-foreground mt-0.5 text-xs">Every channel · bar vs your best month.</p>
      <div className="mt-3 flex items-end gap-1.5" style={{ height: 84 }} aria-hidden>
        {months.map((m) => (
          <div key={m.month} className="flex flex-1 flex-col items-center gap-1" title={`${ym(m.month)} · ${fmtRM(m.cents)}`}>
            <div className={`w-full rounded-t-md ${m.month === best.month ? "bg-gold-solid" : "bg-brand/25"}`}
              style={{ height: `${Math.max(6, (m.cents / max) * 68)}px` }} />
            <span className="text-muted-foreground text-[9px] tabular-nums">{m.month.slice(5)}</span>
          </div>
        ))}
      </div>
      <p className="text-muted-foreground mt-1.5 text-[11px]">🏆 Best: {ym(best.month)} · {fmtRM(best.cents)}</p>
    </div>
  );
}
