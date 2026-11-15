"use client";

/* v1.191.0 - DAILY ATTENDANCE STATISTIC (the owner's Dashboard photo: a bar
   per column, present / late / leave against a 100% track). Here a bar is a
   DAY of this month and its height is a share of the people DUE that day.

   v1.307.0 - Attendance Workspace 4.0 (A-1): the bars are counts of THE verdict
   (GET /staff/attendance/month-days, worker/src/attendance-day.ts). Before, a
   fixed 10:00 decided "late" for everybody and the track was the whole
   headcount, so a Saturday read as a day nobody came. Now late is after each
   person's own start plus the grace, and a day's track is the people due at
   work that day - a rest day or a holiday has no track at all.
     on time   due, clocked in, not late
     late      due, clocked in after their start + grace
     on leave  approved leave that day
     the rest  the faint track above them: due and not in. A reading aid; it decides nothing. */

import { useMemo } from "react";
import { L, MANAGE_ROLES } from "@/components/portal/page-shared";
import { AppIcon } from "@/components/ui/app-icon";
import { SkelRows } from "@/components/ui/skeleton";
import { useCachedApi } from "@/lib/cached-api";
import { mytToday } from "@/lib/format";
import { card } from "@/lib/ui-styles";
import css from "./attendance-chart.module.css";

type MonthDays = { month: string; days: { d: string; due: number; on_time: number; late: number; leave: number; absent: number }[] };

export function DailyAttendanceChart({ role, onOpen }: { role: string; onOpen?: () => void }) {
  const allowed = MANAGE_ROLES.includes(role);
  const month = mytToday().slice(0, 7);
  const md = useCachedApi<MonthDays>(allowed ? `/staff/attendance/month-days?month=${month}` : null, true, ["attendance"]);
  const days = useMemo(() => {
    const today = mytToday();
    return (md.data?.days ?? []).filter((d) => d.d <= today).map((d) => ({ date: d.d, day: Number(d.d.slice(8, 10)), onTime: d.on_time, late: d.late, onLeave: d.leave, due: d.due + d.leave }));
  }, [md.data]);

  if (!allowed) return null;
  const today = days[days.length - 1];
  const pctOf = (n: number, of: number) => (of > 0 ? Math.min(100, (n / of) * 100) : 0);
  const share = (n: number) => `${Math.round(pctOf(n, today?.due ?? 0))}%`;
  const busy = md.loading && !md.data;

  return (
    <section className={card}>
      <div className={css.head}>
        <p className={css.title}>
          {L("Daily Attendance Statistic", "Statistik Kehadiran Harian")}
          <span className={css.info} title={L("Each bar is a day this month, as a share of the people due at work that day: on time, late (after their own start plus the grace), on leave. The faint rest is due and not in. A rest day or holiday has no bar.", "Setiap bar ialah satu hari bulan ini, sebagai bahagian orang yang bertugas hari itu: tepat waktu, lewat (selepas waktu mula sendiri campur tempoh ihsan), bercuti. Baki pudar ialah bertugas tetapi tidak masuk. Hari rehat atau cuti umum tiada bar.")}><AppIcon name="info" /></span>
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
                title={`${d.date} · ${L("on time", "tepat waktu")} ${d.onTime} · ${L("late", "lewat")} ${d.late} · ${L("on leave", "bercuti")} ${d.onLeave} · ${L("of", "daripada")} ${d.due} ${L("due", "bertugas")}`}>
                <div className={css.track}>
                  {/* bottom up: on time, late, leave (the track's column is reversed) */}
                  {d.onTime > 0 && <span className={`${css.seg} ${css.sOn}`} style={{ height: `${pctOf(d.onTime, d.due)}%` }} />}
                  {d.late > 0 && <span className={`${css.seg} ${css.sLate}`} style={{ height: `${pctOf(d.late, d.due)}%` }} />}
                  {d.onLeave > 0 && <span className={`${css.seg} ${css.sLeave}`} style={{ height: `${pctOf(d.onLeave, d.due)}%` }} />}
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
