"use client";

/* v1.191.0 - DAILY ATTENDANCE STATISTIC (the owner's Dashboard photo: a bar
   per column, present / late / leave against a 100% track). Here a bar is a
   DAY of this month and its height is a share of the staff count:

     on time   people whose first clock-in that day was at or before 10:00
               MYT (the cutoff the attendance donut and /dashboard/
               attendance-today use)
     late      people whose first clock-in was after it
     on leave  people with approved leave covering the day who did not clock in
     the rest  the faint track above them: not in, not on leave

   Read from GETs managers already make: the month's punch report (the same
   cached request the Attendance calendar reads), the month's leave and the
   dashboard summary's staff count. A reading aid; it decides nothing. */

import { useMemo } from "react";
import { L, MANAGE_ROLES } from "@/components/portal/page-shared";
import type { DashSummary } from "@/components/portal/dashboard";
import { AppIcon } from "@/components/ui/app-icon";
import { SkelRows } from "@/components/ui/skeleton";
import { useCachedApi } from "@/lib/cached-api";
import { mytDateOf, mytToday } from "@/lib/format";
import { card } from "@/lib/ui-styles";
import css from "./attendance-chart.module.css";

const CUTOFF = "10:00";
const mytHm = (ts: string) => {
  const d = new Date(new Date(ts.replace(" ", "T") + (ts.endsWith("Z") ? "" : "Z")).getTime() + 8 * 3600 * 1000);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
};

export function DailyAttendanceChart({ role, onOpen }: { role: string; onOpen?: () => void }) {
  const allowed = MANAGE_ROLES.includes(role);
  const month = mytToday().slice(0, 7);
  const report = useCachedApi<{ records?: { user_id?: number; type: string; created_at: string }[] }>(allowed ? `/staff/attendance/report?month=${month}` : null, true, ["attendance"]);
  const leave = useCachedApi<{ leave?: { user_id: number; start_date: string; end_date: string; status: string }[] }>(allowed ? "/staff/leave/month" : null, true, ["leave"]);
  const sum = useCachedApi<DashSummary>(allowed ? "/staff/dashboard/summary" : null);
  const total = sum.data?.staff_total ?? 0;

  const days = useMemo(() => {
    const today = mytToday();
    const first = new Map<string, Map<number, string>>(); // day -> user -> first clock-in HH:MM
    for (const r of report.data?.records ?? []) {
      if (r.type !== "clock_in" || r.user_id == null) continue;
      const d = mytDateOf(r.created_at);
      const hm = mytHm(r.created_at);
      const m = first.get(d) ?? new Map<number, string>();
      const was = m.get(r.user_id);
      if (!was || hm < was) m.set(r.user_id, hm);
      first.set(d, m);
    }
    const approved = (leave.data?.leave ?? []).filter((l) => l.status === "approved");
    const out: { date: string; day: number; onTime: number; late: number; onLeave: number }[] = [];
    const last = Number(today.slice(8, 10));
    for (let i = 1; i <= last; i++) {
      const date = `${month}-${String(i).padStart(2, "0")}`;
      const m = first.get(date) ?? new Map<number, string>();
      let onTime = 0, late = 0;
      for (const hm of m.values()) { if (hm > CUTOFF) late++; else onTime++; }
      const onLeave = new Set(approved.filter((l) => l.start_date <= date && l.end_date >= date && !m.has(l.user_id)).map((l) => l.user_id)).size;
      out.push({ date, day: i, onTime, late, onLeave });
    }
    return out;
  }, [report.data, leave.data, month]);

  if (!allowed) return null;
  const pct = (n: number) => (total > 0 ? Math.min(100, (n / total) * 100) : 0);
  const today = days[days.length - 1];
  const share = (n: number) => `${Math.round(pct(n))}%`;
  const busy = report.loading || sum.loading || leave.loading;

  return (
    <section className={card}>
      <div className={css.head}>
        <p className={css.title}>
          {L("Daily Attendance Statistic", "Statistik Kehadiran Harian")}
          <span className={css.info} title={L("Each bar is a day this month, as a share of the staff count: on time, late (first clock-in after 10:00), on leave. The faint rest is not in.", "Setiap bar ialah satu hari bulan ini, sebagai bahagian bilangan kakitangan: tepat waktu, lewat (masuk pertama selepas 10:00), bercuti. Baki pudar ialah tidak masuk.")}><AppIcon name="info" /></span>
        </p>
        <div className={css.legend} aria-label={L("Today", "Hari ini")}>
          <span><i className={`${css.key} ${css.kOn}`} />{L("On time", "Tepat waktu")} {today ? share(today.onTime) : "—"}</span>
          <span><i className={`${css.key} ${css.kLate}`} />{L("Late", "Lewat")} {today ? share(today.late) : "—"}</span>
          <span><i className={`${css.key} ${css.kLeave}`} />{L("Leave", "Cuti")} {today ? share(today.onLeave) : "—"}</span>
          {onOpen && <button type="button" className={css.open} onClick={onOpen}>{L("Daily", "Harian")} <AppIcon name="next" /></button>}
        </div>
      </div>
      {busy ? <SkelRows rows={4} /> : (
        <div className={css.plot} role="img" aria-label={L("Daily attendance this month as a share of staff", "Kehadiran harian bulan ini sebagai bahagian kakitangan")}>
          <div className={css.axis} aria-hidden>
            {["100%", "75%", "50%", "25%", "0%"].map((t) => <span key={t}>{t}</span>)}
          </div>
          <div className={css.bars}>
            {days.map((d) => (
              <div key={d.date} className={css.col}
                title={`${d.date} · ${L("on time", "tepat waktu")} ${d.onTime} · ${L("late", "lewat")} ${d.late} · ${L("on leave", "bercuti")} ${d.onLeave}${total ? ` · ${L("of", "daripada")} ${total}` : ""}`}>
                <div className={css.track}>
                  {/* bottom up: on time, late, leave (the track's column is reversed) */}
                  {d.onTime > 0 && <span className={`${css.seg} ${css.sOn}`} style={{ height: `${pct(d.onTime)}%` }} />}
                  {d.late > 0 && <span className={`${css.seg} ${css.sLate}`} style={{ height: `${pct(d.late)}%` }} />}
                  {d.onLeave > 0 && <span className={`${css.seg} ${css.sLeave}`} style={{ height: `${pct(d.onLeave)}%` }} />}
                </div>
                <span className={css.x}>{d.day}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
