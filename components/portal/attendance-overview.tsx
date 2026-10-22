"use client";

/* v1.191.0 - THE ATTENDANCE OVERVIEW, laid out as the owner's reference photo
   (22-10-2026: "should follow exactly as per previous photo shared"):

     five tiles        On time · Late · Not clocked in (the dashboard summary's
                       own verdicts, with their share bars), Currently on shift
                       (the monitor's latest punch per person) and Total
                       working hours today (first clock-in to last clock-out
                       per person - the rule the records table uses - with the
                       open shifts counted to now)
     today's table     every active person: clock in, clock out, hours, status
                       and where the first punch was made, with a search, a
                       role filter and a status filter over the same rows
     right column      the attendance donut and the quick actions (unchanged)
     calendar strip    the month, one cell a day: how many people clocked in
                       of the staff count, coloured good / partial / low; the
                       arrows move the month (the report the Team tab reads)
     issues            today's late arrivals and the people not clocked in
     recent activity   today's clock-ins and clock-outs, newest first

   Everything comes from GETs the managers already call: /staff/attendance/
   monitor, /staff/dashboard/attendance-today, /staff/attendance/report and the
   dashboard summary handed in. Nothing here writes; no rule changed. The
   colour of a calendar day is a reading aid, not an attendance verdict. */

import { useEffect, useMemo, useState } from "react";
import { L } from "@/components/portal/page-shared";
import { mytTime } from "@/components/portal/page-shared";
import { gpsLabel, type DashSummary } from "@/components/portal/dashboard";
import { AttendanceTodayCard } from "@/components/portal/dashboard-cards";
import { Avatar } from "@/components/ui/avatar";
import { AppIcon } from "@/components/ui/app-icon";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { SkelRows } from "@/components/ui/skeleton";
import { useCachedApi } from "@/lib/cached-api";
import { mytDateOf, mytToday } from "@/lib/format";
import { properName } from "@/lib/names";
import { btnSm, card, chipSmDanger, chipSmInfo, chipSmNeutral, chipSmSuccess, chipSmWarn, inputClassSm, selectClassSm } from "@/lib/ui-styles";
import type { TabName } from "@/lib/portal-tabs";
import css from "./attendance-panel.module.css";

type MonStaff = {
  id: number; name: string; role: string; employment_status?: string | null;
  in_at?: string | null; out_at?: string | null; last_type?: string | null; shifts?: number; in_gps?: string | null;
};
type Monitor = { date: string; staff: MonStaff[]; geofence?: { lat: number; lng: number; radius_m: number; label?: string } | null };
type Today = {
  cutoff?: string;
  on_time?: { id: number; first_in: string }[];
  late?: { id: number; name: string; first_in: string }[];
  not_in?: { id: number; name: string; position?: string | null; leave_type?: string | null }[];
};
type Report = { records?: { user_id?: number; type: string; created_at: string }[] };
export type OverviewTab = "mine" | "roster" | "team" | "reports" | "settings";

const ROLE: Record<string, string> = {
  ceo: "CEO", coo: "COO", cco: "CCO", hr_admin: "HR Admin", sales_marketing: "Sales & Marketing",
  marketing: "Marketing", editor: "Editor", live_host: "Live Host",
};
const roleName = (r: string) => ROLE[r] ?? r.replace(/_/g, " ");
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const minutesBetween = (a: string, b: string) =>
  Math.max(0, Math.round((new Date(b.replace(" ", "T") + "Z").getTime() - new Date(a.replace(" ", "T") + "Z").getTime()) / 60000));
const hm = (min: number) => `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, "0")}m`;
const toMin = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
const shiftMonth = (ym: string, d: number) => {
  const [y, m] = ym.split("-").map(Number) as [number, number];
  const t = new Date(Date.UTC(y, m - 1 + d, 1));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}`;
};

type Status = "on_time" | "late" | "on_shift" | "not_in" | "leave";

export function AttendanceOverview({ summary, open, go }: {
  summary: DashSummary | null;
  open: (t: OverviewTab) => void;
  go: (t: TabName) => void;
}) {
  const mon = useCachedApi<Monitor>("/staff/attendance/monitor", true, ["attendance"]);
  const today = useCachedApi<Today>("/staff/dashboard/attendance-today", true, ["attendance"]);
  const [calMonth, setCalMonth] = useState(() => mytToday().slice(0, 7));
  const report = useCachedApi<Report>(`/staff/attendance/report?month=${calMonth}`, true, ["attendance"]);
  /* the clock the hours are counted to: read when the page opens (render
     stays pure) and again with the monitor every two minutes */
  const [now, setNow] = useState<number>(() => Date.now());
  const refreshMon = mon.refresh;
  const refreshToday = today.refresh;
  useEffect(() => {
    const t = setInterval(() => { setNow(Date.now()); refreshMon(); refreshToday(); }, 120000);
    return () => clearInterval(t);
  }, [refreshMon, refreshToday]);

  const [q, setQ] = useState("");
  const [roleF, setRoleF] = useState("");
  const [statusF, setStatusF] = useState<"" | Status>("");

  const staff = useMemo(() => mon.data?.staff ?? [], [mon.data]);
  const fence = mon.data?.geofence ?? null;
  const cutoff = today.data?.cutoff ?? "10:00";
  const lateIds = new Set((today.data?.late ?? []).map((p) => p.id));
  const leaveIds = new Set((today.data?.not_in ?? []).filter((p) => p.leave_type).map((p) => p.id));
  const stillIn = (s: MonStaff) => (s.last_type ? s.last_type === "clock_in" : Boolean(s.in_at && !s.out_at));
  const statusOf = (s: MonStaff): Status =>
    !s.in_at ? (leaveIds.has(s.id) ? "leave" : "not_in") : stillIn(s) ? "on_shift" : lateIds.has(s.id) ? "late" : "on_time";
  const minutesOf = (s: MonStaff) => {
    if (!s.in_at) return 0;
    /* an open shift counts to now only on the monitor's own day */
    if (stillIn(s)) return mon.data?.date !== mytToday() ? 0 : minutesBetween(s.in_at, new Date(now).toISOString().replace("T", " ").slice(0, 19));
    return s.out_at ? minutesBetween(s.in_at, s.out_at) : 0;
  };

  /* ---- the five tiles ---- */
  const onTime = summary?.attendance_on_time ?? null;
  const late = summary?.attendance_late ?? null;
  const total = summary?.staff_total ?? 0;
  const notIn = onTime != null && late != null ? Math.max(0, total - onTime - late) : null;
  const pct = (n: number | null) => (n != null && total > 0 ? Math.round((n / total) * 100) : 0);
  const onShift = mon.data ? staff.filter(stillIn).length : null;
  const totalMin = staff.reduce((a, s) => a + minutesOf(s), 0);

  /* ---- today's table ---- */
  const needle = q.trim().toLowerCase();
  const rows = staff.filter((s) =>
    (!needle || s.name.toLowerCase().includes(needle))
    && (!roleF || s.role === roleF)
    && (!statusF || statusOf(s) === statusF));
  const roles = [...new Set(staff.map((s) => s.role))];
  const STATUS_CHIP: Record<Status, [string, string]> = {
    on_time: [chipSmSuccess, L("On time", "Tepat waktu")],
    late: [chipSmWarn, L("Late", "Lewat")],
    on_shift: [chipSmInfo, L("On shift", "Sedang syif")],
    not_in: [chipSmDanger, L("Not clocked in", "Belum masuk")],
    leave: [chipSmNeutral, L("On leave", "Bercuti")],
  };
  const placeOf = (s: MonStaff) => {
    if (!s.in_at) return "—";
    const g = gpsLabel(s.in_gps, fence);
    return g.ok === true ? L("Office", "Pejabat") : g.ok === false ? L("Outside", "Di luar") : "—";
  };
  const todayLabel = (() => {
    const d = mon.data?.date ?? mytToday();
    const [y, m, dd] = d.split("-").map(Number) as [number, number, number];
    return `${dd} ${MONTHS[m - 1]} ${y}`;
  })();

  /* ---- the month strip ---- */
  const days = useMemo(() => {
    const [y, m] = calMonth.split("-").map(Number) as [number, number];
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const todayS = mytToday();
    const byDay = new Map<string, Set<number>>();
    for (const r of report.data?.records ?? []) {
      if (r.type !== "clock_in" || r.user_id == null) continue;
      const d = mytDateOf(r.created_at);
      const set = byDay.get(d) ?? new Set<number>();
      set.add(r.user_id);
      byDay.set(d, set);
    }
    const out: { date: string; dow: number; day: number; n: number; future: boolean; today: boolean }[] = [];
    for (let i = 1; i <= last; i++) {
      const date = `${calMonth}-${String(i).padStart(2, "0")}`;
      if (date > todayS) break;
      out.push({ date, dow: new Date(`${date}T00:00:00Z`).getUTCDay(), day: i, n: byDay.get(date)?.size ?? 0, future: false, today: date === todayS });
    }
    return out;
  }, [calMonth, report.data]);
  const dayTone = (n: number, dow: number) =>
    n === 0 ? (dow === 0 || dow === 6 ? css.dayOff : css.dayLow)
      : total > 0 && n >= total ? css.dayGood : total > 0 && n / total >= 0.5 ? css.dayPart : css.dayLow;
  const monthTitle = (() => { const [y, m] = calMonth.split("-").map(Number) as [number, number]; return `${MONTHS[m - 1]} ${y}`; })();

  /* ---- issues and recent activity ---- */
  const weekend = [0, 6].includes(new Date(`${mytToday()}T00:00:00Z`).getUTCDay());
  const issues = [
    ...(today.data?.late ?? []).map((p) => ({
      key: `late-${p.id}`, id: p.id, name: p.name, chip: chipSmWarn, word: L("Late arrival", "Lewat tiba"),
      time: `${p.first_in} (${minutesAfter(p.first_in, cutoff)} ${L("mins late", "minit lewat")})`,
    })),
    ...(weekend ? [] : (today.data?.not_in ?? []).filter((p) => !p.leave_type).map((p) => ({
      key: `in-${p.id}`, id: p.id, name: p.name, chip: chipSmDanger, word: L("Not clocked in", "Belum masuk"), time: "—",
    }))),
  ];
  const activity = staff.flatMap((s) => [
    ...(s.in_at ? [{ at: s.in_at, s, what: lateIds.has(s.id) ? "in_late" as const : "in" as const }] : []),
    ...(s.out_at && !stillIn(s) ? [{ at: s.out_at, s, what: "out" as const }] : []),
  ]).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 5);

  return (
    <>
      <KpiRow label={L("Today", "Hari ini")}>
        <KpiTile icon="person" tone="green" label={L("On Time", "Tepat Waktu")} value={onTime ?? 0} busy={onTime == null}
          sub={total > 0 ? L(`${pct(onTime)}% of ${total} staff`, `${pct(onTime)}% daripada ${total} kakitangan`) : undefined}
          bar={{ pct: pct(onTime), tone: "green" }} />
        <KpiTile icon="time" tone="gold" label={L("Late", "Lewat")} value={late ?? 0} busy={late == null}
          sub={total > 0 ? L(`${pct(late)}% of ${total} staff`, `${pct(late)}% daripada ${total} kakitangan`) : undefined}
          bar={{ pct: pct(late), tone: "gold" }} />
        <KpiTile icon="error" tone="red" label={L("Not Clocked In", "Belum Daftar Masuk")} value={notIn ?? 0} busy={notIn == null}
          sub={total > 0 ? L(`${pct(notIn)}% of ${total} staff`, `${pct(notIn)}% daripada ${total} kakitangan`) : undefined}
          bar={{ pct: pct(notIn), tone: "red" }} />
        <KpiTile icon="time" tone="blue" label={L("Currently On Shift", "Sedang Bersyif")} value={onShift ?? 0} busy={onShift == null}
          link={{ label: L("View live status", "Lihat status langsung"), onClick: () => document.getElementById("attendance-monitor")?.scrollIntoView({ behavior: "smooth", block: "start" }) }} />
        <KpiTile icon="chart" tone="gold" label={L("Total Working Hours", "Jumlah Jam Bekerja")} value={hm(totalMin)} busy={!mon.data}
          sub={L("today, first clock-in to last clock-out", "hari ini, masuk pertama ke keluar terakhir")} />
      </KpiRow>

      <div className={css.split}>
        <section id="attendance-monitor" className={`${card} ${css.monitor}`}>
          <div className={css.head}>
            <div className={css.lead}>
              <span className={`${css.well} ${css.gold}`}><AppIcon name="time" /></span>
              <div className={css.headText}>
                <p className={css.title}>{L(`Today's attendance — ${todayLabel}`, `Kehadiran hari ini — ${todayLabel}`)} <span className={chipSmSuccess}>● {L("Live", "Langsung")}</span></p>
                <p className={css.sub}>{L("Real-time snapshot of all active staff. Refreshes every 2 minutes.", "Paparan langsung semua kakitangan aktif. Dimuat semula setiap 2 minit.")}</p>
              </div>
            </div>
            <div className={css.filters}>
              <label className={css.search}>
                <AppIcon name="search" className={css.searchIcon} />
                <input className={inputClassSm} value={q} onChange={(e) => setQ(e.target.value)} placeholder={L("Search staff…", "Cari kakitangan…")} aria-label={L("Search staff", "Cari kakitangan")} />
              </label>
              <select className={selectClassSm} value={roleF} onChange={(e) => setRoleF(e.target.value)} aria-label={L("Role", "Peranan")}>
                <option value="">{L("All roles", "Semua peranan")}</option>
                {roles.map((r) => <option key={r} value={r}>{roleName(r)}</option>)}
              </select>
              <select className={selectClassSm} value={statusF} onChange={(e) => setStatusF(e.target.value as "" | Status)} aria-label={L("Status", "Status")}>
                <option value="">{L("All status", "Semua status")}</option>
                {(Object.keys(STATUS_CHIP) as Status[]).map((k) => <option key={k} value={k}>{STATUS_CHIP[k][1]}</option>)}
              </select>
            </div>
          </div>
          <div className={css.tWrap}>
            <table className={css.t}>
              <thead>
                <tr>
                  <th>{L("No.", "No.")}</th><th>{L("Name", "Nama")}</th><th>{L("Role", "Peranan")}</th>
                  <th>{L("Clock In", "Masuk")}</th><th>{L("Clock Out", "Keluar")}</th><th>{L("Hours", "Jam")}</th>
                  <th>{L("Status", "Status")}</th><th>{L("Location", "Lokasi")}</th>
                </tr>
              </thead>
              <tbody>
                {!mon.data ? (
                  <tr><td colSpan={8}><SkelRows rows={5} /></td></tr>
                ) : rows.length === 0 ? (
                  <tr><td colSpan={8} className={css.none}>{staff.length === 0 ? L("No active staff.", "Tiada kakitangan aktif.") : L("Nobody matches that.", "Tiada yang sepadan.")}</td></tr>
                ) : rows.map((s, i) => {
                  const st = statusOf(s);
                  const min = minutesOf(s);
                  return (
                    <tr key={s.id}>
                      <td className={css.muted}>{i + 1}</td>
                      <td><span className={css.who}><Avatar name={properName(s.name)} size="sm" /><span className={css.name}>{properName(s.name)}</span></span></td>
                      <td className={css.muted}>{roleName(s.role)}</td>
                      <td>{s.in_at ? <span className={lateIds.has(s.id) ? chipSmWarn : chipSmSuccess}>{mytTime(s.in_at)}</span> : <span className={css.muted}>—</span>}</td>
                      <td>{s.out_at && !stillIn(s) ? mytTime(s.out_at) : <span className={css.muted}>—</span>}</td>
                      <td>{s.in_at && (min > 0) ? hm(min) : <span className={css.muted}>—</span>}</td>
                      <td><span className={STATUS_CHIP[st][0]}>{STATUS_CHIP[st][1]}</span></td>
                      <td className={css.muted}>{placeOf(s)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <div className={css.aside}>
          {!summary ? (
            <div className={card} aria-busy="true"><SkelRows rows={3} /></div>
          ) : summary.attendance_on_time == null || summary.attendance_late == null ? null : (
            <AttendanceTodayCard onTime={summary.attendance_on_time} late={summary.attendance_late} staffTotal={summary.staff_total ?? 0} />
          )}
          <section className={card}>
            <p className={css.title}>{L("Quick actions", "Tindakan pantas")}</p>
            <div className={css.quick}>
              <button type="button" className={css.qa} onClick={() => go("On Shift")}><span className={`${css.qaIcon} ${css.gold}`}><AppIcon name="time" /></span>{L("Clock in / out", "Daftar masuk / keluar")}</button>
              <button type="button" className={css.qa} onClick={() => go("Leave")}><span className={`${css.qaIcon} ${css.blue}`}><AppIcon name="holiday" /></span>{L("Apply leave", "Mohon cuti")}</button>
              <button type="button" className={css.qa} onClick={() => open("roster")}><span className={`${css.qaIcon} ${css.blue}`}><AppIcon name="date" /></span>{L("View roster", "Lihat roster")}</button>
              <button type="button" className={css.qa} onClick={() => open("reports")}><span className={`${css.qaIcon} ${css.red}`}><AppIcon name="chart" /></span>{L("Team report", "Laporan pasukan")}</button>
            </div>
          </section>
        </div>
      </div>

      <section className={card}>
        <div className={css.head}>
          <div className={css.lead}>
            <span className={`${css.well} ${css.gold}`}><AppIcon name="date" /></span>
            <div className={css.headText}>
              <p className={css.title}>{L("Attendance calendar — ", "Kalendar kehadiran — ")}<span className={css.month}>{monthTitle}</span></p>
              <p className={css.sub}>{L("People clocked in each day, of today's staff count. Green = everyone, yellow = half or more, red = fewer.", "Orang yang daftar masuk setiap hari, daripada bilangan kakitangan hari ini. Hijau = semua, kuning = separuh atau lebih, merah = kurang.")}</p>
            </div>
          </div>
          <div className={css.calNav}>
            <button type="button" className={btnSm} aria-label={L("Previous month", "Bulan sebelumnya")} onClick={() => setCalMonth((m) => shiftMonth(m, -1))}><AppIcon name="previous" /></button>
            <button type="button" className={btnSm} aria-label={L("Next month", "Bulan seterusnya")} disabled={calMonth >= mytToday().slice(0, 7)} onClick={() => setCalMonth((m) => shiftMonth(m, 1))}><AppIcon name="next" /></button>
            <button type="button" className={btnSm} onClick={() => setCalMonth(mytToday().slice(0, 7))}>{L("Today", "Hari ini")}</button>
          </div>
        </div>
        <div className={css.cal}>
          {report.loading ? <SkelRows rows={1} /> : days.map((d) => (
            <div key={d.date} className={`${css.day} ${d.today ? css.dayToday : ""}`}>
              <span className={css.dow}>{DOW[d.dow]}</span>
              <span className={css.dnum}>{d.day}</span>
              {d.n === 0 && (d.dow === 0 || d.dow === 6)
                ? <span className={css.dcount}>–</span>
                : <><span aria-hidden className={`${css.dot} ${dayTone(d.n, d.dow)}`} /><span className={`${css.dcount} ${dayTone(d.n, d.dow)}`}>{d.n}/{total || "?"}</span></>}
            </div>
          ))}
        </div>
      </section>

      <div className={css.split2}>
        <section className={card}>
          <div className={css.head}>
            <div className={css.lead}>
              <span className={`${css.well} ${css.red}`}><AppIcon name="warning" /></span>
              <div className={css.headText}>
                <p className={css.title}>{L("Attendance issues", "Isu kehadiran")} {issues.length > 0 && <span className={chipSmDanger}>{L(`${issues.length} issue${issues.length === 1 ? "" : "s"} today`, `${issues.length} isu hari ini`)}</span>}</p>
                <p className={css.sub}>{L("Staff with attendance issues that need attention.", "Kakitangan dengan isu kehadiran yang perlu perhatian.")}</p>
              </div>
            </div>
          </div>
          {!today.data ? <SkelRows rows={3} /> : issues.length === 0 ? (
            <p className={css.none}>{L("No attendance issues today.", "Tiada isu kehadiran hari ini.")}</p>
          ) : (
            <div className={css.tWrap}>
              <table className={css.t}>
                <thead><tr><th>{L("Name", "Nama")}</th><th>{L("Issue", "Isu")}</th><th>{L("Time", "Masa")}</th><th>{L("Action", "Tindakan")}</th></tr></thead>
                <tbody>
                  {issues.map((it) => (
                    <tr key={it.key}>
                      <td><span className={css.who}><Avatar name={properName(it.name)} size="sm" /><span className={css.name}>{properName(it.name)}</span></span></td>
                      <td><span className={it.chip}>{it.word}</span></td>
                      <td className={css.muted}>{it.time}</td>
                      <td><button type="button" className={btnSm} onClick={() => open("team")}>{L("View", "Lihat")}</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className={card}>
          <div className={css.head}>
            <div className={css.lead}>
              <span className={`${css.well} ${css.gold}`}><AppIcon name="refresh" /></span>
              <div className={css.headText}>
                <p className={css.title}>{L("Recent activity", "Aktiviti terkini")}</p>
                <p className={css.sub}>{L("Today's clock-ins and clock-outs, newest first.", "Daftar masuk dan keluar hari ini, terbaru dahulu.")}</p>
              </div>
            </div>
            <button type="button" className={btnSm} onClick={() => open("team")}>{L("View all", "Lihat semua")}</button>
          </div>
          {!mon.data ? <SkelRows rows={4} /> : activity.length === 0 ? (
            <p className={css.none}>{L("No punches yet today.", "Belum ada punch hari ini.")}</p>
          ) : (
            <div className={css.tWrap}>
              <table className={css.t}>
                <thead><tr><th>{L("Time", "Masa")}</th><th>{L("Staff", "Kakitangan")}</th><th>{L("Activity", "Aktiviti")}</th><th>{L("Location", "Lokasi")}</th></tr></thead>
                <tbody>
                  {activity.map((a, i) => (
                    <tr key={i}>
                      <td className={css.muted}>{mytTime(a.at)}</td>
                      <td><span className={css.who}><Avatar name={properName(a.s.name)} size="sm" /><span className={css.name}>{properName(a.s.name)}</span></span></td>
                      <td><span aria-hidden className={`${css.dot} ${a.what === "out" ? css.dayOff : a.what === "in_late" ? css.dayPart : css.dayGood}`} />
                        {a.what === "out" ? L("Clocked out", "Daftar keluar") : a.what === "in_late" ? L("Clocked in (late)", "Daftar masuk (lewat)") : L("Clocked in", "Daftar masuk")}</td>
                      <td className={css.muted}>{a.what === "out" ? "—" : placeOf(a.s)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </>
  );
}

function minutesAfter(hhmm: string, cutoff: string) {
  return Math.max(0, toMin(hhmm) - toMin(cutoff));
}
